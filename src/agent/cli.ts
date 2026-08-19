#!/usr/bin/env node
import { dirname, isAbsolute, join, normalize } from 'node:path'
import { readAgentConfig } from './config.ts'
import {
  applyStoredPlan,
  applyStoredReleaseRollbackPlan,
  applyStoredReleaseRetentionPlan,
  applyStoredReleasePlan,
  createStoredPlan,
  createStoredReleaseRollbackPlan,
  createStoredReleaseRetentionPlan,
  createStoredReleasePlan,
  inspectAgent,
  inspectReleaseAgent,
  readOrRecoverAction,
  readOrRecoverReleaseRollbackAction,
  readOrRecoverReleaseAction,
  readReleaseRetentionActionStatus,
  safeRuntimeError,
} from './runtime.ts'
import type { FleetPlanApproval } from './protocol.ts'
import type { FleetReleaseApproval, FleetReleaseRollbackApproval } from './release-protocol.ts'
import type { FleetReleaseRetentionApproval } from './release-retention.ts'
import {
  listFleetTasks,
  pruneFleetTasks,
  receiveA2AMessage,
  resumeAcceptedTasks,
  runTaskWorker,
  safeA2ARuntimeError,
  signA2AMessage,
  verifyA2AMessage,
  type FleetTerminalTaskState,
} from '../a2a/runtime.ts'
import { FLEET_A2A_KINDS, type FleetA2AEnvelope, type FleetA2AKind } from '../a2a/protocol.ts'
import { doctorAgent } from './doctor.ts'
import {
  applyFederationInboxPrune,
  acknowledgeFederationMessage,
  listFederationInbox,
  planFederationInboxPrune,
  safeFederationError,
  type FleetFederationPruneCandidate,
} from '../federation/inbox.ts'

const MAX_INPUT_BYTES = 64 * 1024
const shutdown = new AbortController()
let receivedSignal: 'SIGINT' | 'SIGTERM' | undefined

function beginShutdown(signal: 'SIGINT' | 'SIGTERM'): void {
  if (receivedSignal !== undefined) return
  receivedSignal = signal
  shutdown.abort(new Error('fleet agent received ' + signal))
}

const onSigint = () => beginShutdown('SIGINT')
const onSigterm = () => beginShutdown('SIGTERM')
process.on('SIGINT', onSigint)
process.on('SIGTERM', onSigterm)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactObject(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!isRecord(value)) throw Object.assign(new TypeError(label + ' must be an object'), { code: 'invalid-payload' })
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw Object.assign(new TypeError(label + ' has unsupported or missing fields'), { code: 'invalid-payload' })
  }
  return value
}

function stringField(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value !== value.trim()) {
    throw Object.assign(new TypeError(field + ' must be a trimmed non-empty string'), { code: 'invalid-payload' })
  }
  return value
}

async function readStdin(): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
    size += buffer.length
    if (size > MAX_INPUT_BYTES) throw Object.assign(new Error('request body is too large'), { code: 'invalid-payload' })
    chunks.push(buffer)
  }
  const source = Buffer.concat(chunks).toString('utf8').trim()
  return source === '' ? null : JSON.parse(source) as unknown
}

type AgentCliCommand =
  | 'inspect' | 'plan' | 'apply' | 'status'
  | 'release-inspect' | 'release-plan' | 'release-apply' | 'release-status'
  | 'release-rollback-plan' | 'release-rollback-apply' | 'release-rollback-status'
  | 'release-retention-plan' | 'release-retention-apply' | 'release-retention-status'
  | 'a2a-sign' | 'a2a-verify' | 'a2a-receive' | 'task-worker' | 'tasks-list' | 'tasks-prune' | 'tasks-resume'
  | 'federation-list' | 'federation-ack' | 'federation-retention-plan' | 'federation-prune' | 'doctor'

function parseArgs(argv: string[]): { configPath: string; command: AgentCliCommand } {
  if (argv.length !== 3 || argv[0] !== '--config') throw Object.assign(new Error('usage: dsh-fleet-agent --config <path> <command>'), { code: 'invalid-invocation' })
  const configPath = argv[1] as string
  if (!isAbsolute(configPath) || normalize(configPath) !== configPath || configPath.includes('\0')) {
    throw Object.assign(new Error('config path must be absolute'), { code: 'invalid-invocation' })
  }
  const command = argv[2]
  if (![
    'inspect', 'plan', 'apply', 'status',
    'release-inspect', 'release-plan', 'release-apply', 'release-status',
    'release-rollback-plan', 'release-rollback-apply', 'release-rollback-status',
    'release-retention-plan', 'release-retention-apply', 'release-retention-status',
    'a2a-sign', 'a2a-verify', 'a2a-receive', 'task-worker', 'tasks-list', 'tasks-prune', 'tasks-resume',
    'federation-list', 'federation-ack', 'federation-retention-plan', 'federation-prune', 'doctor',
  ].includes(command as string)) {
    throw Object.assign(new Error('unsupported command'), { code: 'invalid-invocation' })
  }
  return { configPath, command: command as AgentCliCommand }
}

async function dispatch(): Promise<unknown> {
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    throw Object.assign(new Error('fleet agent refuses to run as root'), { code: 'root-refused' })
  }
  const { configPath, command } = parseArgs(process.argv.slice(2))
  const config = await readAgentConfig(configPath)
  const payload = await readStdin()
  const agentPath = process.argv[1]
  if (agentPath === undefined || !isAbsolute(agentPath) || normalize(agentPath) !== agentPath) {
    throw Object.assign(new Error('fleet agent executable path must be absolute'), { code: 'invalid-invocation' })
  }
  const workerLaunch = { nodeBinary: process.execPath, agentPath, configPath }
  if (command === 'doctor') {
    if (payload !== null && (isRecord(payload) ? Object.keys(payload).length !== 0 : true)) {
      throw Object.assign(new Error('doctor payload must be empty'), { code: 'invalid-payload' })
    }
    return doctorAgent(config, new Date(), shutdown.signal)
  }
  if (command === 'a2a-sign') {
    const body = isRecord(payload) && Object.hasOwn(payload, 'recipientTeamId')
      ? exactObject(payload, ['kind', 'payload', 'recipientDeviceId', 'recipientTeamId'], 'A2A sign payload')
      : exactObject(payload, ['kind', 'payload', 'recipientDeviceId'], 'A2A sign payload')
    const kind = stringField(body.kind, 'kind')
    if (!FLEET_A2A_KINDS.includes(kind as FleetA2AKind)) throw Object.assign(new Error('unsupported A2A kind'), { code: 'invalid-payload' })
    if (!isRecord(body.payload)) throw Object.assign(new Error('A2A payload must be an object'), { code: 'invalid-payload' })
    return signA2AMessage(
      config,
      stringField(body.recipientDeviceId, 'recipientDeviceId'),
      kind as FleetA2AKind,
      body.payload,
      new Date(),
      body.recipientTeamId === undefined ? undefined : stringField(body.recipientTeamId, 'recipientTeamId'),
    )
  }
  if (command === 'a2a-receive') {
    const body = exactObject(payload, ['envelope'], 'A2A receive payload')
    return receiveA2AMessage(config, body.envelope as FleetA2AEnvelope, workerLaunch, new Date())
  }
  if (command === 'a2a-verify') {
    const body = exactObject(payload, ['envelope'], 'A2A verify payload')
    return verifyA2AMessage(config, body.envelope as FleetA2AEnvelope, new Date())
  }
  if (command === 'task-worker') {
    const body = exactObject(payload, ['taskId'], 'task worker payload')
    return runTaskWorker(config, stringField(body.taskId, 'taskId'), join(dirname(agentPath), 'worker.mjs'))
  }
  if (command === 'tasks-list') {
    const body = exactObject(payload, ['limit'], 'tasks-list payload')
    if (typeof body.limit !== 'number' || !Number.isSafeInteger(body.limit) || body.limit < 1 || body.limit > 100) {
      throw Object.assign(new Error('tasks-list limit must be an integer from 1 to 100'), { code: 'invalid-payload' })
    }
    return listFleetTasks(config, body.limit)
  }
  if (command === 'tasks-prune') {
    const body = exactObject(payload, ['olderThan', 'states'], 'tasks-prune payload')
    if (!Array.isArray(body.states) || body.states.some(state => typeof state !== 'string')) {
      throw Object.assign(new Error('tasks-prune states must be strings'), { code: 'invalid-payload' })
    }
    return pruneFleetTasks(config, {
      olderThan: stringField(body.olderThan, 'olderThan'),
      states: body.states as FleetTerminalTaskState[],
    })
  }
  if (command === 'tasks-resume') {
    if (payload !== null && (isRecord(payload) ? Object.keys(payload).length !== 0 : true)) {
      throw Object.assign(new Error('tasks-resume payload must be empty'), { code: 'invalid-payload' })
    }
    return { resumed: await resumeAcceptedTasks(config, workerLaunch) }
  }
  if (command === 'federation-list') {
    const body = exactObject(payload, ['limit'], 'federation-list payload')
    if (typeof body.limit !== 'number' || !Number.isSafeInteger(body.limit) || body.limit < 1 || body.limit > 100) {
      throw Object.assign(new Error('federation-list limit must be an integer from 1 to 100'), { code: 'invalid-payload' })
    }
    return listFederationInbox(join(config.stateDir, 'federation'), { limit: body.limit })
  }
  if (command === 'federation-ack') {
    const body = exactObject(payload, ['disposition', 'messageId', 'payloadDigest'], 'federation-ack payload')
    const disposition = stringField(body.disposition, 'disposition')
    if (disposition !== 'acknowledged' && disposition !== 'dismissed') {
      throw Object.assign(new Error('federation acknowledgement disposition is invalid'), { code: 'invalid-payload' })
    }
    return acknowledgeFederationMessage({
      rootDirectory: join(config.stateDir, 'federation'),
      messageId: stringField(body.messageId, 'messageId'),
      expectedPayloadDigest: stringField(body.payloadDigest, 'payloadDigest'),
      disposition,
      acknowledgedAt: new Date(),
    })
  }
  if (command === 'federation-retention-plan') {
    const body = exactObject(payload, ['acknowledgedRetentionMs', 'expiredRetentionMs', 'maxEntries'], 'federation retention payload')
    for (const field of ['acknowledgedRetentionMs', 'expiredRetentionMs', 'maxEntries'] as const) {
      if (typeof body[field] !== 'number' || !Number.isSafeInteger(body[field])) {
        throw Object.assign(new Error(field + ' must be an integer'), { code: 'invalid-payload' })
      }
    }
    const items = await listFederationInbox(join(config.stateDir, 'federation'), { limit: 500 })
    return {
      generatedAt: new Date().toISOString(),
      candidates: planFederationInboxPrune(items, {
        acknowledgedRetentionMs: body.acknowledgedRetentionMs as number,
        expiredRetentionMs: body.expiredRetentionMs as number,
        maxEntries: body.maxEntries as number,
      }),
    }
  }
  if (command === 'federation-prune') {
    const body = exactObject(payload, ['candidates', 'policy'], 'federation-prune payload')
    const policy = exactObject(body.policy, ['acknowledgedRetentionMs', 'expiredRetentionMs', 'maxEntries'], 'federation-prune policy')
    for (const field of ['acknowledgedRetentionMs', 'expiredRetentionMs', 'maxEntries'] as const) {
      if (typeof policy[field] !== 'number' || !Number.isSafeInteger(policy[field])) {
        throw Object.assign(new Error(field + ' must be an integer'), { code: 'invalid-payload' })
      }
    }
    if (!Array.isArray(body.candidates)) {
      throw Object.assign(new Error('federation-prune candidates must be an array'), { code: 'invalid-payload' })
    }
    return applyFederationInboxPrune({
      rootDirectory: join(config.stateDir, 'federation'),
      candidates: body.candidates as FleetFederationPruneCandidate[],
      policy: {
        acknowledgedRetentionMs: policy.acknowledgedRetentionMs as number,
        expiredRetentionMs: policy.expiredRetentionMs as number,
        maxEntries: policy.maxEntries as number,
      },
      now: new Date(),
    })
  }
  if (command === 'release-inspect' || command === 'release-plan') {
    if (payload !== null && (isRecord(payload) ? Object.keys(payload).length !== 0 : true)) {
      throw Object.assign(new Error(command + ' payload must be empty'), { code: 'invalid-payload' })
    }
    return command === 'release-inspect'
      ? inspectReleaseAgent(config, new Date(), shutdown.signal)
      : createStoredReleasePlan(config, new Date(), shutdown.signal)
  }
  if (command === 'release-status') {
    const body = exactObject(payload, ['planId'], 'release status payload')
    const action = await readOrRecoverReleaseAction(config, stringField(body.planId, 'planId'))
    if (action === null) throw Object.assign(new Error('release action not found'), { code: 'action-not-found' })
    return action
  }
  if (command === 'release-apply') {
    const body = exactObject(payload, ['approval'], 'release apply payload')
    return applyStoredReleasePlan(config, body.approval as FleetReleaseApproval, new Date(), shutdown.signal)
  }
  if (command === 'release-rollback-plan') {
    const body = exactObject(payload, ['transitionPlanId'], 'release rollback plan payload')
    return createStoredReleaseRollbackPlan(
      config,
      stringField(body.transitionPlanId, 'transitionPlanId'),
      new Date(),
      shutdown.signal,
    )
  }
  if (command === 'release-rollback-status') {
    const body = exactObject(payload, ['planId'], 'release rollback status payload')
    const action = await readOrRecoverReleaseRollbackAction(config, stringField(body.planId, 'planId'))
    if (action === null) throw Object.assign(new Error('release rollback action not found'), { code: 'action-not-found' })
    return action
  }
  if (command === 'release-rollback-apply') {
    const body = exactObject(payload, ['approval'], 'release rollback apply payload')
    return applyStoredReleaseRollbackPlan(config, body.approval as FleetReleaseRollbackApproval, new Date(), shutdown.signal)
  }
  if (command === 'release-retention-plan') {
    if (payload !== null && (isRecord(payload) ? Object.keys(payload).length !== 0 : true)) {
      throw Object.assign(new Error('release retention plan payload must be empty'), { code: 'invalid-payload' })
    }
    return createStoredReleaseRetentionPlan(config, new Date())
  }
  if (command === 'release-retention-status') {
    const body = exactObject(payload, ['planId'], 'release retention status payload')
    const action = await readReleaseRetentionActionStatus(config, stringField(body.planId, 'planId'))
    if (action === null) throw Object.assign(new Error('release retention action not found'), { code: 'action-not-found' })
    return action
  }
  if (command === 'release-retention-apply') {
    const body = exactObject(payload, ['approval'], 'release retention apply payload')
    return applyStoredReleaseRetentionPlan(config, body.approval as FleetReleaseRetentionApproval, new Date())
  }
  if (command === 'inspect') {
    if (payload !== null && (isRecord(payload) ? Object.keys(payload).length !== 0 : true)) {
      throw Object.assign(new Error('inspect payload must be empty'), { code: 'invalid-payload' })
    }
    return inspectAgent(config, new Date(), shutdown.signal)
  }
  if (command === 'plan') {
    const body = exactObject(payload, ['pluginId'], 'plan payload')
    return createStoredPlan(config, stringField(body.pluginId, 'pluginId'), new Date(), shutdown.signal)
  }
  if (command === 'status') {
    const body = exactObject(payload, ['planId'], 'status payload')
    const action = await readOrRecoverAction(config, stringField(body.planId, 'planId'))
    if (action === null) throw Object.assign(new Error('action not found'), { code: 'action-not-found' })
    return action
  }
  const body = exactObject(payload, ['approval'], 'apply payload')
  return applyStoredPlan(config, body.approval as FleetPlanApproval, new Date(), shutdown.signal)
}

try {
  const value = await dispatch()
  process.stdout.write(JSON.stringify({ ok: true, value }) + '\n')
} catch (error: unknown) {
  const a2a = safeA2ARuntimeError(error)
  const federation = safeFederationError(error)
  process.stdout.write(JSON.stringify({
    ok: false,
    error: a2a.code !== 'internal' ? a2a : federation.code !== 'internal' ? federation : safeRuntimeError(error),
  }) + '\n')
} finally {
  process.off('SIGINT', onSigint)
  process.off('SIGTERM', onSigterm)
  if (receivedSignal === 'SIGINT') process.exitCode = 130
  if (receivedSignal === 'SIGTERM') process.exitCode = 143
}

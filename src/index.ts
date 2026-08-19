import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir, hostname, platform, arch } from 'node:os'
import { basename, join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import type { RpcResult } from '@deepseek-ai/dsh-host-apiproxy/api'
import type {
  AgentActionRecord,
  AgentInspection,
  ReleaseActionRecord,
  ReleaseAgentInspection,
  ReleaseRollbackActionRecord,
  ReleaseRetentionActionRecord,
} from './agent/runtime.ts'
import type { FleetAgentDoctorReport } from './agent/doctor.ts'
import { FLEET_AGENT_PROTOCOL_VERSION, canonicalJson, type FleetPlan, type FleetPlanApproval } from './agent/protocol.ts'
import {
  FLEET_RELEASE_PROTOCOL_VERSION,
  validateFleetReleaseRollbackPlan,
  type FleetReleaseApproval,
  type FleetReleasePlan,
  type FleetReleaseRollbackApproval,
  type FleetReleaseRollbackPlan,
} from './agent/release-protocol.ts'
import {
  FLEET_RELEASE_RETENTION_PROTOCOL_VERSION,
  validateFleetReleaseRetentionPlan,
  type FleetReleaseRetentionApproval,
  type FleetReleaseRetentionPlan,
} from './agent/release-retention.ts'
import {
  isFleetFederationAdvisoryKind,
  validateA2APayload,
  type FleetA2AEnvelope,
  type FleetFederationAdvisoryKind,
  type FleetFederationApprovalDecision,
  type FleetFederationApprovalDecisionPayload,
  type FleetTaskApprovalDecision,
  type FleetTaskApprovalDecisionPayload,
  type FleetTaskApprovalRequestPayload,
} from './a2a/protocol.ts'
import type { FleetA2AReceipt, FleetTaskCatalog, FleetTaskCatalogItem, FleetTaskPruneResult, FleetTerminalTaskState } from './a2a/runtime.ts'
import type {
  AcknowledgeFederationMessageResult,
  FleetFederationInboxItem,
  FleetFederationPruneCandidate,
} from './federation/inbox.ts'
import { AgentClientError, assertAgentIdentity, createAgentClient, type AgentCommand, type AgentTargetConfig } from './host/agent-client.ts'
import { digestInstalledArtifact } from './host/artifacts.ts'
import { parseFleetManifest, reconcileFleet } from './host/core.ts'
import {
  inspectCurrentRuntimeIdentity,
  validateRuntimeIdentity,
  type FleetRuntimeIdentity,
} from './host/runtime-identity.ts'
import { createUpdateMonitor, type UpdateMode } from './host/updates.ts'
import { normalizeDeviceId, type FleetManifest, type FleetStatus, type RuntimePhase, type RuntimePluginEntry } from './shared.ts'

export const name = 'fleet'
export const inject = ['connection', 'loader']
export const RPC_CHANNEL = '/dsh-fleet'
export const AGENT_RPC_CHANNEL = '/dsh-fleet-agent'

export interface ConvergenceConfig {
  enabled?: boolean
  principalId?: string
  timeoutMs?: number
  targets?: AgentTargetConfig[]
  signerDeviceId?: string
}

export interface Config {
  deviceId?: string
  manifestPath?: string
  desiredManifestPath?: string
  profile?: string
  dshHome?: string
  dshBinary?: string
  artifactStore?: string
  updateCheck?: boolean
  updateCacheMs?: number
  updateTimeoutMs?: number
  convergence?: ConvergenceConfig
}

interface ProfileManifest {
  dependencies?: Record<string, string>
  dsh?: { profile?: { bundles?: string[] } }
}

interface LoaderEntryLike {
  id: string
  options: { name: string; group?: boolean }
  disabled?: boolean
  fiber?: { state: number }
}

interface HostContext {
  connection: HostConnectionHandle
  loader: { entries(): Iterable<LoaderEntryLike> }
}

export interface FleetHostDependencies {
  inspectRuntimeIdentity?: () => Promise<FleetRuntimeIdentity>
}

export type FleetStatusWithRuntimeIdentity = FleetStatus & { runtimeIdentity: FleetRuntimeIdentity }

const PHASES: Record<number, RuntimePhase> = {
  0: 'pending',
  1: 'loading',
  2: 'active',
  3: 'failed',
  4: null,
  5: 'unloading',
}

function expandHome(value: string): string {
  if (value === '~') return homedir()
  if (value.startsWith('~/')) return join(homedir(), value.slice(2))
  if (!value.includes('/')) return value
  return resolve(value)
}

function defaultDshBinary(): string {
  const current = process.argv[1]
  const candidates = [
    ...(current !== undefined && (basename(current) === 'dsh' || current.includes('/@deepseek-ai/dsh/')) ? [current] : []),
    join(homedir(), '.local/bin/dsh'),
    join(homedir(), '.npm-global/bin/dsh'),
  ]
  return candidates.find(candidate => existsSync(candidate)) ?? 'dsh'
}

function resolveConfig(config: Config | undefined) {
  const dshHome = expandHome(config?.dshHome ?? process.env.DSH_HOME ?? '~/.dsh')
  const manifestPath = expandHome(config?.manifestPath ?? process.env.DSH_FLEET_MANIFEST ?? '~/.dsh/fleet/fleet.lock.yaml')
  const boundedNumber = (value: number | undefined, fallback: number, minimum: number, maximum: number) =>
    value === undefined || !Number.isFinite(value) ? fallback : Math.min(maximum, Math.max(minimum, Math.round(value)))
  return {
    deviceId: normalizeDeviceId(config?.deviceId ?? process.env.DSH_FLEET_DEVICE_ID ?? hostname()),
    manifestPath,
    desiredManifestPath: expandHome(config?.desiredManifestPath ?? process.env.DSH_FLEET_DESIRED_MANIFEST ?? manifestPath),
    profile: (config?.profile ?? process.env.DSH_FLEET_PROFILE ?? 'web').trim(),
    dshHome,
    dshBinary: expandHome(config?.dshBinary ?? process.env.DSH_FLEET_DSH_BINARY ?? defaultDshBinary()),
    artifactStore: expandHome(config?.artifactStore ?? process.env.DSH_FLEET_ARTIFACT_STORE ?? '~/.dsh/fleet/artifacts'),
    updateCheck: config?.updateCheck !== false,
    updateCacheMs: boundedNumber(config?.updateCacheMs, 6 * 60 * 60 * 1000, 60 * 1000, 24 * 60 * 60 * 1000),
    updateTimeoutMs: boundedNumber(config?.updateTimeoutMs, 5000, 1000, 15_000),
    convergence: {
      enabled: config?.convergence?.enabled === true,
      principalId: (config?.convergence?.principalId ?? process.env.USER ?? 'local-owner').trim(),
      timeoutMs: boundedNumber(config?.convergence?.timeoutMs, 180_000, 5000, 10 * 60 * 1000),
      targets: config?.convergence?.targets ?? [],
      signerDeviceId: config?.convergence?.signerDeviceId === undefined
        ? undefined
        : normalizeDeviceId(config.convergence.signerDeviceId, 'convergence.signerDeviceId'),
    },
  }
}

function readDshVersion(binary: string): string | null {
  try {
    return execFileSync(binary, ['--version'], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null
  } catch {
    return null
  }
}

function runtimeSnapshot(loader: HostContext['loader']): RuntimePluginEntry[] {
  const entries: RuntimePluginEntry[] = []
  for (const entry of loader.entries()) {
    if (entry.options.group) continue
    entries.push({
      entryId: entry.id,
      moduleName: entry.options.name,
      enabled: entry.disabled !== true,
      fiberPhase: entry.fiber === undefined ? null : (PHASES[entry.fiber.state] ?? null),
    })
  }
  return entries
}

async function readProfile(path: string): Promise<{ dependencies: Record<string, string>; bundles: string[] }> {
  const parsed = JSON.parse(await readFile(path, 'utf8')) as ProfileManifest
  return {
    dependencies: parsed.dependencies ?? {},
    bundles: parsed.dsh?.profile?.bundles ?? [],
  }
}

const EMPTY_MANIFEST: FleetManifest = {
  schemaVersion: 1,
  team: { id: 'unavailable' },
  devices: {},
  plugins: [],
}

export async function collectFleetStatus(
  ctx: Pick<HostContext, 'loader'>,
  configInput?: Config,
  hostDependencies: FleetHostDependencies = {},
): Promise<FleetStatusWithRuntimeIdentity> {
  const config = resolveConfig(configInput)
  const runtimeIdentity = await (hostDependencies.inspectRuntimeIdentity ?? inspectCurrentRuntimeIdentity)()
  validateRuntimeIdentity(runtimeIdentity)
  const profilePath = join(config.dshHome, 'profiles', config.profile, 'package.json')
  const runtime = runtimeSnapshot(ctx.loader)
  let manifest = EMPTY_MANIFEST
  let manifestLoaded = false
  let manifestError: string | undefined
  try {
    manifest = parseFleetManifest(await readFile(config.manifestPath, 'utf8'))
    manifestLoaded = true
  } catch (error: unknown) {
    manifestError = error instanceof Error ? error.message : String(error)
  }
  let dependencies: Record<string, string> = {}
  let bundles: string[] = []
  try {
    const profile = await readProfile(profilePath)
    dependencies = profile.dependencies
    bundles = profile.bundles
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    manifestError = manifestError === undefined ? 'profile: ' + message : manifestError + '; profile: ' + message
  }
  const result = reconcileFleet({
    manifest,
    deviceId: config.deviceId,
    profile: config.profile,
    dependencies,
    artifactDigests: Object.fromEntries((await Promise.all(reconcileFleet({
      manifest,
      deviceId: config.deviceId,
      profile: config.profile,
      dependencies,
      bundles,
      runtime: [],
    }).plugins.filter(plugin => plugin.desiredArtifactDigest !== undefined).map(async plugin => {
      const digest = await digestInstalledArtifact(
        join(config.dshHome, 'profiles', config.profile),
        config.artifactStore,
        dependencies[plugin.id] ?? '',
      )
      return digest === undefined ? null : [plugin.id, digest] as const
    }))).filter((entry): entry is readonly [string, string] => entry !== null)),
    bundles,
    runtime,
  })
  const deviceSpec = result.device
  return {
    generatedAt: new Date().toISOString(),
    device: {
      id: config.deviceId,
      registered: deviceSpec !== undefined,
      ...(deviceSpec?.assignedTo === undefined ? {} : { assignedTo: deviceSpec.assignedTo }),
      ...(deviceSpec === undefined ? {} : { class: deviceSpec.class, channel: deviceSpec.channel }),
      hostname: hostname(),
      platform: platform(),
      arch: arch(),
      nodeVersion: process.version,
    },
    dsh: { version: runtimeIdentity.dshVersion, profile: config.profile },
    runtimeIdentity,
    manifest: {
      path: config.manifestPath,
      loaded: manifestLoaded,
      ...(manifestLoaded ? { teamId: manifest.team.id } : {}),
      ...(manifestError === undefined ? {} : { error: manifestError }),
    },
    runtime: {
      failedModules: [...new Set(runtime
        .filter(entry => entry.enabled && entry.fiberPhase === 'failed')
        .map(entry => entry.moduleName))].sort(),
    },
    summary: result.summary,
    plugins: result.plugins,
    unmanaged: result.unmanaged,
  }
}

const ok = (value: unknown): RpcResult<unknown> => ({ ok: true, value })
const fail = (message: string): RpcResult<unknown> => ({ ok: false, error: { code: 'internal', message, details: {} } })

function closedPayload(payload: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) throw new TypeError(label + ' must be an object')
  const value = payload as Record<string, unknown>
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(label + ' has unsupported or missing fields')
  }
  return value
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value !== value.trim()) throw new TypeError(field + ' must be a trimmed non-empty string')
  return value
}

const TASK_CATALOG_STATES = new Set(['accepted', 'running', 'cancel-requested', 'succeeded', 'failed', 'cancelled'])
const TERMINAL_TASK_STATES = new Set<FleetTerminalTaskState>(['succeeded', 'failed', 'cancelled'])

function canonicalTimestamp(value: unknown, field: string): string {
  const result = requiredString(value, field)
  const time = Date.parse(result)
  if (!Number.isFinite(time) || new Date(time).toISOString() !== result) throw new TypeError(field + ' must be a canonical timestamp')
  return result
}

function taskCatalog(value: unknown, targetDeviceId: string): FleetTaskCatalog {
  const body = closedPayload(value, ['generatedAt', 'tasks'], 'task catalog')
  if (!Array.isArray(body.tasks)) throw new TypeError('task catalog tasks must be an array')
  const tasks = body.tasks.map((item, index) => {
    const row = closedPayload(item, [
      'createdAt', 'errorCode', 'profile', 'resultDigest', 'state', 'targetDeviceId', 'taskId', 'updatedAt', 'workspaceId',
    ], `task catalog tasks[${index}]`)
    const taskId = requiredString(row.taskId, `task catalog tasks[${index}].taskId`)
    validateA2APayload('task.status', { taskId })
    const state = requiredString(row.state, `task catalog tasks[${index}].state`)
    if (!TASK_CATALOG_STATES.has(state)) throw new TypeError(`task catalog tasks[${index}].state is invalid`)
    if (row.targetDeviceId !== targetDeviceId) throw new TypeError(`task catalog tasks[${index}] targets another device`)
    const nullable = (field: 'errorCode' | 'resultDigest') => {
      const raw = row[field]
      if (raw === null) return null
      const text = requiredString(raw, `task catalog tasks[${index}].${field}`)
      if (field === 'resultDigest' && !/^[0-9a-f]{64}$/.test(text)) throw new TypeError(`task catalog tasks[${index}].resultDigest is invalid`)
      return text
    }
    return {
      taskId,
      state: state as FleetTaskCatalogItem['state'],
      targetDeviceId,
      workspaceId: requiredString(row.workspaceId, `task catalog tasks[${index}].workspaceId`),
      profile: requiredString(row.profile, `task catalog tasks[${index}].profile`),
      createdAt: canonicalTimestamp(row.createdAt, `task catalog tasks[${index}].createdAt`),
      updatedAt: canonicalTimestamp(row.updatedAt, `task catalog tasks[${index}].updatedAt`),
      errorCode: nullable('errorCode'),
      resultDigest: nullable('resultDigest'),
    }
  })
  return { generatedAt: canonicalTimestamp(body.generatedAt, 'task catalog generatedAt'), tasks }
}

function taskPruneResult(value: unknown): FleetTaskPruneResult {
  const body = closedPayload(value, ['pruned', 'skippedActive'], 'task prune result')
  if (typeof body.pruned !== 'number' || !Number.isSafeInteger(body.pruned) || body.pruned < 0 ||
      typeof body.skippedActive !== 'number' || !Number.isSafeInteger(body.skippedActive) || body.skippedActive < 0) {
    throw new TypeError('task prune result counts must be non-negative integers')
  }
  return { pruned: body.pruned, skippedActive: body.skippedActive }
}

function taskResumeResult(value: unknown): { resumed: number } {
  const body = closedPayload(value, ['resumed'], 'tasks resume result')
  if (typeof body.resumed !== 'number' || !Number.isSafeInteger(body.resumed) || body.resumed < 0) {
    throw new TypeError('tasks resume result must be a non-negative integer')
  }
  return { resumed: body.resumed }
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/
const FEDERATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const MESSAGE_ID_PATTERN = /^msg:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const AGENT_ACTION_STATES = new Set([
  'approved', 'staging', 'staged', 'applying', 'restarting', 'verifying', 'succeeded',
  'rollback', 'rollback-restarting', 'rollback-verifying', 'rolled-back', 'manual-intervention',
])

function sha256Digest(value: unknown, field: string): string {
  const result = requiredString(value, field)
  if (!SHA256_PATTERN.test(result)) throw new TypeError(field + ' must be a lowercase SHA-256 digest')
  return result
}

function federationIdentifier(value: unknown, field: string): string {
  const result = requiredString(value, field)
  if (!FEDERATION_ID_PATTERN.test(result)) throw new TypeError(field + ' is invalid')
  return result
}

function namespacedMessageId(value: unknown, field: string): string {
  const result = requiredString(value, field)
  if (!MESSAGE_ID_PATTERN.test(result)) throw new TypeError(field + ' is invalid')
  return result
}

function federationEnvelope(value: unknown, label = 'federation envelope'): FleetA2AEnvelope {
  const body = closedPayload(value, [
    'expiresAt', 'issuedAt', 'kind', 'messageId', 'payload', 'payloadDigest', 'recipient',
    'schemaVersion', 'sender', 'signature', 'teamId',
  ], label)
  if (body.schemaVersion !== 2) throw new TypeError(label + ' schemaVersion is invalid')
  const kind = requiredString(body.kind, label + '.kind') as FleetFederationAdvisoryKind
  if (!isFleetFederationAdvisoryKind(kind)) throw new TypeError(label + ' kind is not a federation advisory')
  const sender = closedPayload(body.sender, ['deviceId', 'keyId', 'principalId'], label + '.sender')
  const recipient = closedPayload(body.recipient, ['deviceId', 'teamId'], label + '.recipient')
  federationIdentifier(body.teamId, label + '.teamId')
  federationIdentifier(sender.principalId, label + '.sender.principalId')
  federationIdentifier(sender.deviceId, label + '.sender.deviceId')
  const keyId = requiredString(sender.keyId, label + '.sender.keyId')
  if (!/^ed25519:[0-9a-f]{64}$/.test(keyId)) throw new TypeError(label + '.sender.keyId is invalid')
  federationIdentifier(recipient.teamId, label + '.recipient.teamId')
  federationIdentifier(recipient.deviceId, label + '.recipient.deviceId')
  namespacedMessageId(body.messageId, label + '.messageId')
  const issuedAt = canonicalTimestamp(body.issuedAt, label + '.issuedAt')
  const expiresAt = canonicalTimestamp(body.expiresAt, label + '.expiresAt')
  if (Date.parse(expiresAt) <= Date.parse(issuedAt)) throw new TypeError(label + ' validity window is invalid')
  sha256Digest(body.payloadDigest, label + '.payloadDigest')
  if (!/^[A-Za-z0-9_-]{86}$/.test(requiredString(body.signature, label + '.signature'))) {
    throw new TypeError(label + '.signature is invalid')
  }
  validateA2APayload(kind, body.payload)
  return value as FleetA2AEnvelope
}

function federationInbox(value: unknown, localTeamId: string, localDeviceId: string): FleetFederationInboxItem[] {
  if (!Array.isArray(value) || value.length > 100) throw new TypeError('federation inbox must be a bounded array')
  const seen = new Set<string>()
  return value.map((entry, index) => {
    const item = closedPayload(entry, ['acknowledgement', 'expired', 'record'], `federation inbox[${index}]`)
    if (typeof item.expired !== 'boolean') throw new TypeError(`federation inbox[${index}].expired must be boolean`)
    const record = closedPayload(item.record, ['envelope', 'receivedAt', 'schemaVersion'], `federation inbox[${index}].record`)
    if (record.schemaVersion !== 1) throw new TypeError(`federation inbox[${index}].record schema is invalid`)
    canonicalTimestamp(record.receivedAt, `federation inbox[${index}].record.receivedAt`)
    const envelope = federationEnvelope(record.envelope, `federation inbox[${index}].record.envelope`)
    if (envelope.teamId === localTeamId || envelope.recipient.teamId !== localTeamId ||
        envelope.recipient.deviceId !== localDeviceId) {
      throw new TypeError(`federation inbox[${index}] is not a foreign message for this fixed signer`)
    }
    if (seen.has(envelope.messageId)) throw new TypeError('federation inbox contains duplicate message ids')
    seen.add(envelope.messageId)
    let acknowledgement = null
    if (item.acknowledgement !== null) {
      const ack = closedPayload(item.acknowledgement, [
        'acknowledgedAt', 'disposition', 'messageId', 'payloadDigest', 'schemaVersion',
      ], `federation inbox[${index}].acknowledgement`)
      if (ack.schemaVersion !== 1 || (ack.disposition !== 'acknowledged' && ack.disposition !== 'dismissed') ||
          ack.messageId !== envelope.messageId || ack.payloadDigest !== envelope.payloadDigest) {
        throw new TypeError(`federation inbox[${index}].acknowledgement does not match its message`)
      }
      canonicalTimestamp(ack.acknowledgedAt, `federation inbox[${index}].acknowledgement.acknowledgedAt`)
      acknowledgement = ack
    }
    return {
      record: { schemaVersion: 1, receivedAt: record.receivedAt as string, envelope },
      acknowledgement: acknowledgement as FleetFederationInboxItem['acknowledgement'],
      expired: item.expired,
    }
  })
}

function federationAcknowledgement(
  value: unknown,
  expected: { disposition: 'acknowledged' | 'dismissed'; messageId: string; payloadDigest: string },
): AcknowledgeFederationMessageResult {
  const body = closedPayload(value, ['acknowledgement', 'status'], 'federation acknowledgement result')
  if (body.status !== 'acknowledged' && body.status !== 'duplicate') throw new TypeError('federation acknowledgement status is invalid')
  const ack = closedPayload(body.acknowledgement, [
    'acknowledgedAt', 'disposition', 'messageId', 'payloadDigest', 'schemaVersion',
  ], 'federation acknowledgement')
  if (ack.schemaVersion !== 1 || (ack.disposition !== 'acknowledged' && ack.disposition !== 'dismissed')) {
    throw new TypeError('federation acknowledgement is invalid')
  }
  namespacedMessageId(ack.messageId, 'federation acknowledgement.messageId')
  sha256Digest(ack.payloadDigest, 'federation acknowledgement.payloadDigest')
  canonicalTimestamp(ack.acknowledgedAt, 'federation acknowledgement.acknowledgedAt')
  if (ack.messageId !== expected.messageId || ack.payloadDigest !== expected.payloadDigest ||
      ack.disposition !== expected.disposition) {
    throw new TypeError('federation acknowledgement does not match the requested first-final disposition')
  }
  return value as AcknowledgeFederationMessageResult
}

function federationRetentionPlan(value: unknown): { generatedAt: string; candidates: FleetFederationPruneCandidate[] } {
  const body = closedPayload(value, ['candidates', 'generatedAt'], 'federation retention plan')
  const generatedAt = canonicalTimestamp(body.generatedAt, 'federation retention plan.generatedAt')
  if (!Array.isArray(body.candidates) || body.candidates.length > 500) throw new TypeError('federation retention candidates are invalid')
  const candidates = body.candidates.map((candidate, index) => {
    const row = closedPayload(candidate, ['messageId', 'payloadDigest', 'reason'], `federation retention candidates[${index}]`)
    if (row.reason !== 'acknowledged-retention' && row.reason !== 'expired-retention' && row.reason !== 'capacity') {
      throw new TypeError(`federation retention candidates[${index}].reason is invalid`)
    }
    const reason: FleetFederationPruneCandidate['reason'] = row.reason
    return {
      messageId: namespacedMessageId(row.messageId, `federation retention candidates[${index}].messageId`),
      payloadDigest: sha256Digest(row.payloadDigest, `federation retention candidates[${index}].payloadDigest`),
      reason,
    }
  })
  return { generatedAt, candidates }
}

function releaseAction(value: unknown, deviceId: string, profile: string): ReleaseActionRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('release action is invalid')
  const action = value as Partial<ReleaseActionRecord>
  if (action.deviceId !== deviceId || action.profile !== profile || typeof action.planId !== 'string' ||
      typeof action.planDigest !== 'string' || !SHA256_PATTERN.test(action.planDigest) ||
      typeof action.releaseId !== 'string' || typeof action.releaseVersion !== 'string' ||
      typeof action.releaseDigest !== 'string' || !SHA256_PATTERN.test(action.releaseDigest) ||
      typeof action.fromManifestDigest !== 'string' || !SHA256_PATTERN.test(action.fromManifestDigest) ||
      typeof action.toManifestDigest !== 'string' || !SHA256_PATTERN.test(action.toManifestDigest) ||
      (action.fromReleaseDigest !== null && (typeof action.fromReleaseDigest !== 'string' || !SHA256_PATTERN.test(action.fromReleaseDigest))) ||
      typeof action.toReleaseDigest !== 'string' || !SHA256_PATTERN.test(action.toReleaseDigest) ||
      typeof action.rollbackDescriptorDigest !== 'string' || !SHA256_PATTERN.test(action.rollbackDescriptorDigest) ||
      typeof action.state !== 'string' || !AGENT_ACTION_STATES.has(action.state) ||
      typeof action.updatedAt !== 'string') throw new TypeError('release action does not match the requested device and profile')
  canonicalTimestamp(action.updatedAt, 'release action.updatedAt')
  return value as ReleaseActionRecord
}

function releaseRollbackAction(value: unknown, deviceId: string, profile: string): ReleaseRollbackActionRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('release rollback action is invalid')
  const action = value as Partial<ReleaseRollbackActionRecord>
  if (action.deviceId !== deviceId || action.profile !== profile || typeof action.planId !== 'string' ||
      typeof action.planDigest !== 'string' || !SHA256_PATTERN.test(action.planDigest) ||
      typeof action.transitionPlanId !== 'string' || !/^release-plan:[0-9a-f]{64}$/.test(action.transitionPlanId) ||
      typeof action.fromManifestDigest !== 'string' || !SHA256_PATTERN.test(action.fromManifestDigest) ||
      typeof action.toManifestDigest !== 'string' || !SHA256_PATTERN.test(action.toManifestDigest) ||
      typeof action.fromReleaseDigest !== 'string' || !SHA256_PATTERN.test(action.fromReleaseDigest) ||
      (action.toReleaseDigest !== null && (typeof action.toReleaseDigest !== 'string' || !SHA256_PATTERN.test(action.toReleaseDigest))) ||
      typeof action.state !== 'string' || !AGENT_ACTION_STATES.has(action.state) || typeof action.updatedAt !== 'string') {
    throw new TypeError('release rollback action does not match the requested device and profile')
  }
  canonicalTimestamp(action.updatedAt, 'release rollback action.updatedAt')
  return value as ReleaseRollbackActionRecord
}

function releaseRetentionAction(
  value: unknown,
  expected: {
    approvalId?: string
    deviceId: string
    planDigest: string
    planId: string
    principalId: string
    profile: string
  },
): ReleaseRetentionActionRecord {
  const action = closedPayload(value, [
    'activeBackupQuarantinePrepared', 'activeBackupRemoved', 'activeTransitionPlanId', 'approvalId',
    'currentTransitionPlanId', 'deviceId', 'idempotencyKey', 'planDigest', 'planId', 'principalId',
    'profile', 'removedTransitionPlanIds', 'result', 'state', 'updatedAt',
  ], 'release retention action')
  if (action.planId !== expected.planId || action.planDigest !== expected.planDigest ||
      action.deviceId !== expected.deviceId || action.profile !== expected.profile ||
      action.principalId !== expected.principalId ||
      (expected.approvalId !== undefined && action.approvalId !== expected.approvalId)) {
    throw new TypeError('release retention action does not match its approved plan and principal')
  }
  if (typeof action.approvalId !== 'string' || !FEDERATION_ID_PATTERN.test(action.approvalId) ||
      typeof action.idempotencyKey !== 'string' || !SHA256_PATTERN.test(action.idempotencyKey) ||
      (action.currentTransitionPlanId !== null &&
        (typeof action.currentTransitionPlanId !== 'string' || !/^release-plan:[0-9a-f]{64}$/.test(action.currentTransitionPlanId))) ||
      (action.activeTransitionPlanId !== null &&
        (typeof action.activeTransitionPlanId !== 'string' || !/^release-plan:[0-9a-f]{64}$/.test(action.activeTransitionPlanId))) ||
      typeof action.activeBackupQuarantinePrepared !== 'boolean' || typeof action.activeBackupRemoved !== 'boolean' ||
      !Array.isArray(action.removedTransitionPlanIds)) {
    throw new TypeError('release retention action progress is invalid')
  }
  const removedTransitionPlanIds = action.removedTransitionPlanIds
  if (removedTransitionPlanIds.some(id => typeof id !== 'string' || !/^release-plan:[0-9a-f]{64}$/.test(id)) ||
      new Set(removedTransitionPlanIds).size !== removedTransitionPlanIds.length ||
      removedTransitionPlanIds.some((id, index) => index > 0 && id <= removedTransitionPlanIds[index - 1]!)) {
    throw new TypeError('release retention action progress is invalid')
  }
  if (action.currentTransitionPlanId !== null && removedTransitionPlanIds.includes(action.currentTransitionPlanId) ||
      action.activeTransitionPlanId !== null && removedTransitionPlanIds.includes(action.activeTransitionPlanId)) {
    throw new TypeError('release retention action cannot remove an active or current transition')
  }
  canonicalTimestamp(action.updatedAt, 'release retention action.updatedAt')
  if (action.state !== 'approved' && action.state !== 'applying' && action.state !== 'succeeded') {
    throw new TypeError('release retention action state is invalid')
  }
  if (action.state === 'succeeded' ? action.result !== 'success' : action.result !== null) {
    throw new TypeError('release retention action result is inconsistent with its state')
  }
  if (action.activeTransitionPlanId === null &&
      (action.activeBackupQuarantinePrepared !== false || action.activeBackupRemoved !== false)) {
    throw new TypeError('release retention action has unbound backup progress')
  }
  return value as ReleaseRetentionActionRecord
}

async function digestManifest(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path, 'utf8'), 'utf8').digest('hex')
}

async function loadManifestBinding(path: string): Promise<{ manifest: FleetManifest; digest: string }> {
  const source = await readFile(path, 'utf8')
  return {
    manifest: parseFleetManifest(source),
    digest: createHash('sha256').update(source, 'utf8').digest('hex'),
  }
}

export function assertAgentConfiguration(
  expected: { deviceId: string; profile: string; manifestDigest: string },
  response: { deviceId: string; profile: string; manifestDigest: string },
): void {
  assertAgentIdentity(expected.deviceId, response)
  if (response.profile !== expected.profile) {
    throw new AgentClientError('agent-profile-mismatch', 'fleet agent profile does not match the configured Host profile')
  }
  if (response.manifestDigest !== expected.manifestDigest) {
    throw new AgentClientError('agent-manifest-mismatch', 'fleet agent manifest does not match the configured Host manifest')
  }
}

export function apply(ctx: Context, config?: Config, hostDependencies: FleetHostDependencies = {}): void {
  const host = ctx as unknown as HostContext
  const resolved = resolveConfig(config)
  const updates = createUpdateMonitor({
    enabled: resolved.updateCheck,
    cacheMs: resolved.updateCacheMs,
    timeoutMs: resolved.updateTimeoutMs,
    deviceId: resolved.deviceId,
    manifestPath: resolved.manifestPath,
    profileDir: join(resolved.dshHome, 'profiles', resolved.profile),
    profile: resolved.profile,
    dshVersion: readDshVersion(resolved.dshBinary),
  })
  const agents = createAgentClient(resolved.convergence)
  const assertActiveRoute = async (deviceId: string): Promise<{ manifest: FleetManifest; digest: string }> => {
    const binding = await loadManifestBinding(resolved.desiredManifestPath)
    if (binding.manifest.devices[deviceId] === undefined) {
      throw new AgentClientError('target-revoked', 'target is not authorized by the active Fleet manifest')
    }
    if (!resolved.convergence.targets.some(target => target.deviceId === deviceId)) {
      throw new AgentClientError('target-not-found', 'fleet target is not configured')
    }
    return binding
  }
  const callActiveAgent = async <T>(
    deviceId: string,
    command: AgentCommand,
    payload: unknown,
    signal?: AbortSignal,
  ): Promise<T> => {
    await assertActiveRoute(deviceId)
    return agents.call<T>(deviceId, command, payload, signal)
  }
  const federationSigner = async (signal?: AbortSignal): Promise<{
    deviceId: string
    teamId: string
    principalId: string
    keyId: string
  }> => {
    const deviceId = resolved.convergence.signerDeviceId
    if (deviceId === undefined) throw new AgentClientError('a2a-signer-missing', 'a fixed local A2A signer is not configured')
    const target = resolved.convergence.targets.find(candidate => candidate.deviceId === deviceId)
    if (target === undefined || target.transport !== 'local') {
      throw new AgentClientError('a2a-signer-invalid', 'A2A signer must be a configured local Agent target')
    }
    const report = await callActiveAgent<FleetAgentDoctorReport>(deviceId, 'doctor', null, signal)
    if (report.protocolVersion !== 1 || report.ready !== true || report.deviceId !== deviceId ||
        !FEDERATION_ID_PATTERN.test(report.teamId) || report.principalId !== resolved.convergence.principalId ||
        !/^ed25519:[0-9a-f]{64}$/.test(report.identityKeyId)) {
      throw new AgentClientError('a2a-signer-unready', 'local A2A signer doctor identity is invalid')
    }
    return { deviceId, teamId: report.teamId, principalId: report.principalId, keyId: report.identityKeyId }
  }
  const signFederationAdvisory = async (
    recipientTeamId: string,
    recipientDeviceId: string,
    kind: Exclude<FleetFederationAdvisoryKind, 'receipt'>,
    advisoryPayload: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<FleetA2AEnvelope> => {
    const signer = await federationSigner(signal)
    const targetTeamId = federationIdentifier(recipientTeamId, 'recipientTeamId')
    const targetDeviceId = normalizeDeviceId(federationIdentifier(recipientDeviceId, 'recipientDeviceId'))
    if (targetTeamId === signer.teamId) throw new AgentClientError('federation-same-team', 'cross-team export requires a foreign recipient team')
    validateA2APayload(kind, advisoryPayload)
    const envelope = federationEnvelope(await callActiveAgent<FleetA2AEnvelope>(signer.deviceId, 'a2a-sign', {
      recipientDeviceId: targetDeviceId,
      recipientTeamId: targetTeamId,
      kind,
      payload: advisoryPayload,
    }, signal), 'signed federation export')
    if (envelope.kind !== kind || envelope.teamId !== signer.teamId || envelope.sender.deviceId !== signer.deviceId ||
        envelope.sender.principalId !== signer.principalId || envelope.sender.keyId !== signer.keyId ||
        envelope.recipient.teamId !== targetTeamId || envelope.recipient.deviceId !== targetDeviceId ||
        canonicalJson(envelope.payload) !== canonicalJson(advisoryPayload)) {
      throw new AgentClientError('federation-export-mismatch', 'signed federation export does not match its requested binding')
    }
    return envelope
  }
  const signedTaskCall = async (
    targetDeviceId: string,
    kind: 'task.submit' | 'task.status' | 'task.cancel',
    taskPayload: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<FleetA2AEnvelope> => {
    const signerDeviceId = resolved.convergence.signerDeviceId
    if (signerDeviceId === undefined) throw new AgentClientError('a2a-signer-missing', 'a fixed local A2A signer is not configured')
    const signer = resolved.convergence.targets.find(target => target.deviceId === signerDeviceId)
    if (signer === undefined || signer.transport !== 'local') {
      throw new AgentClientError('a2a-signer-invalid', 'A2A signer must be a configured local Agent target')
    }
    await assertActiveRoute(targetDeviceId)
    await assertActiveRoute(signerDeviceId)
    const envelope = await callActiveAgent<FleetA2AEnvelope>(signerDeviceId, 'a2a-sign', {
      recipientDeviceId: targetDeviceId,
      kind,
      payload: taskPayload,
    }, signal)
    const receipt = await callActiveAgent<FleetA2AReceipt>(targetDeviceId, 'a2a-receive', { envelope }, signal)
    if (receipt.requestMessageId !== envelope.messageId || typeof receipt.response !== 'object' || receipt.response === null) {
      throw new AgentClientError('a2a-receipt-invalid', 'target returned an invalid A2A receipt')
    }
    const verified = await callActiveAgent<FleetA2AEnvelope>(signerDeviceId, 'a2a-verify', { envelope: receipt.response }, signal)
    if (verified.sender.deviceId !== targetDeviceId || verified.payload.taskId !== taskPayload.taskId ||
        (verified.kind !== 'task.progress' && verified.kind !== 'task.result' && verified.kind !== 'task.approval.request')) {
      throw new AgentClientError('a2a-response-mismatch', 'signed task response does not match the requested target and task')
    }
    return verified
  }
  host.connection.rpc.handle(RPC_CHANNEL, async (endpoint, payload) => {
    try {
      if (endpoint === 'status') return ok(await collectFleetStatus(host, config, hostDependencies))
      if (endpoint === 'updates') {
        let mode: UpdateMode = 'if-stale'
        if (payload !== null && payload !== undefined) {
          if (typeof payload !== 'object' || Array.isArray(payload) || !('mode' in payload)) throw new TypeError('updates payload must contain mode')
          const candidate = (payload as { mode?: unknown }).mode
          if (candidate !== 'cache' && candidate !== 'if-stale' && candidate !== 'force') throw new TypeError('invalid updates mode')
          mode = candidate
        }
        return ok(await updates.get(mode))
      }
      return fail('unknown endpoint: ' + endpoint)
    } catch (error: unknown) {
      return fail(error instanceof Error ? error.message : String(error))
    }
  }, { authority: 'loopback' })
  host.connection.rpc.handle(AGENT_RPC_CHANNEL, async (endpoint, payload, signal) => {
    try {
      if (endpoint === 'targets') {
        if (payload !== null && (typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).length !== 0)) {
          throw new TypeError('targets payload must be empty')
        }
        if (!agents.enabled) return ok({ enabled: false, targets: [] })
        const binding = await loadManifestBinding(resolved.desiredManifestPath)
        const targets = await Promise.all(agents.targets.map(async target => {
          try {
            const releaseMode = binding.manifest.schemaVersion === 2
            const inspection = releaseMode
              ? await callActiveAgent<ReleaseAgentInspection>(target.deviceId, 'release-inspect', null, signal)
              : await callActiveAgent<AgentInspection>(target.deviceId, 'inspect', null, signal)
            if (releaseMode && 'kind' in inspection && inspection.kind === 'profile-release') {
              assertAgentIdentity(target.deviceId, inspection)
              if (!SHA256_PATTERN.test(inspection.observedRuntimeDigest) ||
                  (inspection.observedServiceDefinitionDigest !== null &&
                    !SHA256_PATTERN.test(inspection.observedServiceDefinitionDigest))) {
                throw new AgentClientError('agent-runtime-identity-invalid', 'fleet agent runtime identity is invalid')
              }
              if (inspection.profile !== resolved.profile) {
                throw new AgentClientError('agent-profile-mismatch', 'fleet agent profile does not match the configured Host profile')
              }
              if (inspection.desiredManifestDigest !== binding.digest) {
                throw new AgentClientError('agent-manifest-mismatch', 'fleet agent desired manifest does not match the configured Host manifest')
              }
            } else {
              assertAgentConfiguration({ deviceId: target.deviceId, profile: resolved.profile, manifestDigest: binding.digest }, inspection)
            }
            let readiness: FleetAgentDoctorReport | undefined
            let readinessErrorCode: string | undefined
            if (releaseMode) {
              try {
                readiness = await callActiveAgent<FleetAgentDoctorReport>(target.deviceId, 'doctor', null, signal)
              } catch (error: unknown) {
                readinessErrorCode = error instanceof AgentClientError ? error.code : 'agent-readiness-unavailable'
              }
            }
            return {
              ...target,
              online: true,
              mode: releaseMode ? 'profile-release' : 'single-plugin',
              inspection,
              ...(readiness === undefined ? {} : { readiness }),
              ...(readinessErrorCode === undefined ? {} : { readinessErrorCode }),
            }
          } catch (error: unknown) {
            const code = error instanceof AgentClientError ? error.code : 'agent-unavailable'
            return { ...target, online: false, errorCode: code }
          }
        }))
        const signerDeviceId = resolved.convergence.signerDeviceId
        const signerConfig = signerDeviceId === undefined ? undefined : agents.targets.find(target => target.deviceId === signerDeviceId)
        const signerTarget = signerDeviceId === undefined ? undefined : targets.find(target => target.deviceId === signerDeviceId)
        const signer = signerDeviceId === undefined
          ? { configured: false, ready: false, errorCode: 'a2a-signer-missing' }
          : signerConfig?.transport !== 'local'
            ? { configured: true, deviceId: signerDeviceId, ready: false, errorCode: 'a2a-signer-invalid' }
            : signerTarget?.online === true && 'readiness' in signerTarget
              ? { configured: true, deviceId: signerDeviceId, ready: true }
              : { configured: true, deviceId: signerDeviceId, ready: false, errorCode: 'a2a-signer-unready' }
        return ok({ enabled: true, signer, targets })
      }
      if (endpoint === 'plan') {
        const body = closedPayload(payload, ['deviceId', 'pluginId'], 'plan payload')
        const deviceId = requiredString(body.deviceId, 'deviceId')
        const pluginId = requiredString(body.pluginId, 'pluginId')
        const plan = await callActiveAgent<FleetPlan>(deviceId, 'plan', { pluginId }, signal)
        assertAgentConfiguration({
          deviceId,
          profile: resolved.profile,
          manifestDigest: await digestManifest(resolved.manifestPath),
        }, plan)
        return ok(plan)
      }
      if (endpoint === 'release-plan') {
        const body = closedPayload(payload, ['deviceId'], 'release plan payload')
        const deviceId = requiredString(body.deviceId, 'deviceId')
        const plan = await callActiveAgent<FleetReleasePlan>(deviceId, 'release-plan', null, signal)
        assertAgentIdentity(deviceId, plan)
        if (plan.profile !== resolved.profile) throw new AgentClientError('agent-profile-mismatch', 'fleet agent profile does not match the configured Host profile')
        if (plan.toManifestDigest !== await digestManifest(resolved.desiredManifestPath)) {
          throw new AgentClientError('agent-manifest-mismatch', 'release transition does not target the active Host manifest')
        }
        return ok(plan)
      }
      if (endpoint === 'release-rollback-plan') {
        const body = closedPayload(payload, ['deviceId', 'transitionPlanId'], 'release rollback plan payload')
        const deviceId = normalizeDeviceId(requiredString(body.deviceId, 'deviceId'))
        const transitionPlanId = requiredString(body.transitionPlanId, 'transitionPlanId')
        const transition = releaseAction(
          await callActiveAgent<ReleaseActionRecord>(deviceId, 'release-status', { planId: transitionPlanId }, signal),
          deviceId,
          resolved.profile,
        )
        if (transition.planId !== transitionPlanId || transition.state !== 'succeeded' || transition.result !== 'success') {
          throw new AgentClientError('rollback-not-available', 'only a successfully applied release transition can be rolled back')
        }
        const plan = await callActiveAgent<FleetReleaseRollbackPlan>(deviceId, 'release-rollback-plan', { transitionPlanId }, signal)
        validateFleetReleaseRollbackPlan(plan)
        const activeManifestDigest = await digestManifest(resolved.desiredManifestPath)
        if (plan.deviceId !== deviceId || plan.profile !== resolved.profile || plan.transitionPlanId !== transitionPlanId ||
            plan.transitionPlanDigest !== transition.planDigest || plan.fromManifestDigest !== transition.toManifestDigest ||
            plan.toManifestDigest !== transition.fromManifestDigest || plan.fromReleaseDigest !== transition.toReleaseDigest ||
            plan.toReleaseDigest !== transition.fromReleaseDigest || plan.fromManifestDigest !== activeManifestDigest) {
          throw new AgentClientError('release-rollback-mismatch', 'release rollback plan is not the exact inverse of the active successful transition')
        }
        if (Date.parse(plan.expiresAt) <= Date.now()) throw new AgentClientError('plan-expired', 'release rollback plan has expired')
        return ok(plan)
      }
      if (endpoint === 'release-retention-plan') {
        const body = closedPayload(payload, ['deviceId'], 'release retention plan payload')
        const deviceId = normalizeDeviceId(requiredString(body.deviceId, 'deviceId'))
        const plan = await callActiveAgent<FleetReleaseRetentionPlan>(deviceId, 'release-retention-plan', null, signal)
        validateFleetReleaseRetentionPlan(plan)
        assertAgentIdentity(deviceId, plan)
        if (plan.profile !== resolved.profile) {
          throw new AgentClientError('agent-profile-mismatch', 'release retention plan profile does not match the configured Host profile')
        }
        if (Date.parse(plan.expiresAt) <= Date.now()) throw new AgentClientError('plan-expired', 'release retention plan has expired')
        return ok(plan)
      }
      if (endpoint === 'approve') {
        const body = closedPayload(payload, ['approvalId', 'deviceId', 'planDigest', 'planExpiresAt', 'planId', 'profile'], 'approve payload')
        const deviceId = requiredString(body.deviceId, 'deviceId')
        const approvedAt = new Date()
        const planExpiresAt = new Date(requiredString(body.planExpiresAt, 'planExpiresAt'))
        if (!Number.isFinite(planExpiresAt.getTime()) || planExpiresAt <= approvedAt) throw new TypeError('planExpiresAt must be in the future')
        const approval: FleetPlanApproval = {
          protocolVersion: FLEET_AGENT_PROTOCOL_VERSION,
          approvalId: requiredString(body.approvalId, 'approvalId'),
          principalId: resolved.convergence.principalId,
          planId: requiredString(body.planId, 'planId'),
          planDigest: sha256Digest(body.planDigest, 'planDigest'),
          deviceId,
          profile: requiredString(body.profile, 'profile'),
          approvedAt: approvedAt.toISOString(),
          expiresAt: new Date(Math.min(planExpiresAt.getTime(), approvedAt.getTime() + 2 * 60 * 1000)).toISOString(),
        }
        return ok(await callActiveAgent<AgentActionRecord>(deviceId, 'apply', { approval }, signal))
      }
      if (endpoint === 'release-approve') {
        const body = closedPayload(payload, [
          'approvalId', 'deviceId', 'fromManifestDigest', 'fromReleaseDigest', 'planDigest', 'planExpiresAt',
          'planId', 'profile', 'toManifestDigest', 'toReleaseDigest',
        ], 'release approve payload')
        const deviceId = requiredString(body.deviceId, 'deviceId')
        const profile = requiredString(body.profile, 'profile')
        if (profile !== resolved.profile) throw new AgentClientError('agent-profile-mismatch', 'release approval profile does not match the configured Host profile')
        const fromManifestDigest = sha256Digest(body.fromManifestDigest, 'fromManifestDigest')
        const toManifestDigest = sha256Digest(body.toManifestDigest, 'toManifestDigest')
        const fromReleaseDigest = body.fromReleaseDigest === null ? null : sha256Digest(body.fromReleaseDigest, 'fromReleaseDigest')
        const toReleaseDigest = sha256Digest(body.toReleaseDigest, 'toReleaseDigest')
        if (toManifestDigest !== await digestManifest(resolved.desiredManifestPath)) {
          throw new AgentClientError('agent-manifest-mismatch', 'release approval no longer targets the desired Host manifest')
        }
        const approvedAt = new Date()
        const planExpiresAt = new Date(requiredString(body.planExpiresAt, 'planExpiresAt'))
        if (!Number.isFinite(planExpiresAt.getTime()) || planExpiresAt <= approvedAt) throw new TypeError('planExpiresAt must be in the future')
        const approval: FleetReleaseApproval = {
          protocolVersion: FLEET_RELEASE_PROTOCOL_VERSION,
          kind: 'profile-release',
          approvalId: requiredString(body.approvalId, 'approvalId'),
          principalId: resolved.convergence.principalId,
          planId: requiredString(body.planId, 'planId'),
          planDigest: sha256Digest(body.planDigest, 'planDigest'),
          deviceId,
          profile,
          fromManifestDigest,
          toManifestDigest,
          fromReleaseDigest,
          toReleaseDigest,
          approvedAt: approvedAt.toISOString(),
          expiresAt: new Date(Math.min(planExpiresAt.getTime(), approvedAt.getTime() + 2 * 60 * 1000)).toISOString(),
        }
        return ok(await callActiveAgent<ReleaseActionRecord>(deviceId, 'release-apply', { approval }, signal))
      }
      if (endpoint === 'release-rollback-approve') {
        const body = closedPayload(payload, [
          'approvalId', 'deviceId', 'fromManifestDigest', 'fromReleaseDigest', 'planDigest', 'planExpiresAt',
          'planId', 'profile', 'toManifestDigest', 'toReleaseDigest', 'transitionPlanId',
        ], 'release rollback approve payload')
        const deviceId = normalizeDeviceId(requiredString(body.deviceId, 'deviceId'))
        const profile = requiredString(body.profile, 'profile')
        if (profile !== resolved.profile) throw new AgentClientError('agent-profile-mismatch', 'release rollback profile does not match the configured Host profile')
        const transitionPlanId = requiredString(body.transitionPlanId, 'transitionPlanId')
        const transition = releaseAction(
          await callActiveAgent<ReleaseActionRecord>(deviceId, 'release-status', { planId: transitionPlanId }, signal),
          deviceId,
          profile,
        )
        if (transition.planId !== transitionPlanId || transition.state !== 'succeeded' || transition.result !== 'success') {
          throw new AgentClientError('rollback-not-available', 'release transition is no longer eligible for explicit rollback')
        }
        const fromManifestDigest = sha256Digest(body.fromManifestDigest, 'fromManifestDigest')
        const toManifestDigest = sha256Digest(body.toManifestDigest, 'toManifestDigest')
        const fromReleaseDigest = sha256Digest(body.fromReleaseDigest, 'fromReleaseDigest')
        const toReleaseDigest = body.toReleaseDigest === null ? null : sha256Digest(body.toReleaseDigest, 'toReleaseDigest')
        if (fromManifestDigest !== transition.toManifestDigest || toManifestDigest !== transition.fromManifestDigest ||
            fromReleaseDigest !== transition.toReleaseDigest || toReleaseDigest !== transition.fromReleaseDigest ||
            fromManifestDigest !== await digestManifest(resolved.desiredManifestPath)) {
          throw new AgentClientError('release-rollback-mismatch', 'release rollback approval does not invert the active successful transition')
        }
        const approvedAt = new Date()
        const planExpiresAt = new Date(requiredString(body.planExpiresAt, 'planExpiresAt'))
        if (!Number.isFinite(planExpiresAt.getTime()) || planExpiresAt <= approvedAt) throw new TypeError('planExpiresAt must be in the future')
        const approval: FleetReleaseRollbackApproval = {
          protocolVersion: FLEET_RELEASE_PROTOCOL_VERSION,
          kind: 'profile-release-rollback',
          approvalId: requiredString(body.approvalId, 'approvalId'),
          principalId: resolved.convergence.principalId,
          planId: requiredString(body.planId, 'planId'),
          planDigest: sha256Digest(body.planDigest, 'planDigest'),
          transitionPlanId,
          deviceId,
          profile,
          fromManifestDigest,
          toManifestDigest,
          fromReleaseDigest,
          toReleaseDigest,
          approvedAt: approvedAt.toISOString(),
          expiresAt: new Date(Math.min(planExpiresAt.getTime(), approvedAt.getTime() + 2 * 60 * 1000)).toISOString(),
        }
        const action = releaseRollbackAction(
          await callActiveAgent<ReleaseRollbackActionRecord>(deviceId, 'release-rollback-apply', { approval }, signal),
          deviceId,
          profile,
        )
        if (action.planId !== approval.planId || action.transitionPlanId !== transitionPlanId) {
          throw new AgentClientError('release-rollback-mismatch', 'release rollback action does not match its approved plan')
        }
        return ok(action)
      }
      if (endpoint === 'release-retention-approve') {
        const body = closedPayload(payload, [
          'approvalId', 'deviceId', 'planDigest', 'planExpiresAt', 'planId', 'profile',
        ], 'release retention approve payload')
        const deviceId = normalizeDeviceId(requiredString(body.deviceId, 'deviceId'))
        const profile = federationIdentifier(body.profile, 'profile')
        if (profile !== resolved.profile) {
          throw new AgentClientError('agent-profile-mismatch', 'release retention approval profile does not match the configured Host profile')
        }
        const planDigest = sha256Digest(body.planDigest, 'planDigest')
        const planId = requiredString(body.planId, 'planId')
        if (planId !== 'release-retention-plan:' + planDigest) throw new TypeError('release retention planId does not match planDigest')
        const approvalId = federationIdentifier(body.approvalId, 'approvalId')
        const principalId = federationIdentifier(resolved.convergence.principalId, 'principalId')
        const approvedAt = new Date()
        const planExpiresAt = new Date(canonicalTimestamp(body.planExpiresAt, 'planExpiresAt'))
        if (planExpiresAt <= approvedAt) throw new TypeError('planExpiresAt must be in the future')
        const approval: FleetReleaseRetentionApproval = {
          protocolVersion: FLEET_RELEASE_RETENTION_PROTOCOL_VERSION,
          kind: 'profile-release-retention',
          approvalId,
          principalId,
          planId,
          planDigest,
          deviceId,
          profile,
          approvedAt: approvedAt.toISOString(),
          expiresAt: new Date(Math.min(planExpiresAt.getTime(), approvedAt.getTime() + 2 * 60 * 1000)).toISOString(),
        }
        const action = releaseRetentionAction(
          await callActiveAgent<ReleaseRetentionActionRecord>(deviceId, 'release-retention-apply', { approval }, signal),
          { approvalId, deviceId, planDigest, planId, principalId, profile },
        )
        return ok(action)
      }
      if (endpoint === 'action-status') {
        const body = closedPayload(payload, ['deviceId', 'planId'], 'status payload')
        const deviceId = requiredString(body.deviceId, 'deviceId')
        const planId = requiredString(body.planId, 'planId')
        return ok(await callActiveAgent<AgentActionRecord>(deviceId, 'status', { planId }, signal))
      }
      if (endpoint === 'release-action-status') {
        const body = closedPayload(payload, ['deviceId', 'planId'], 'release status payload')
        const deviceId = requiredString(body.deviceId, 'deviceId')
        const planId = requiredString(body.planId, 'planId')
        return ok(await callActiveAgent<ReleaseActionRecord>(deviceId, 'release-status', { planId }, signal))
      }
      if (endpoint === 'release-rollback-action-status') {
        const body = closedPayload(payload, ['deviceId', 'planId'], 'release rollback status payload')
        const deviceId = normalizeDeviceId(requiredString(body.deviceId, 'deviceId'))
        const planId = requiredString(body.planId, 'planId')
        const action = releaseRollbackAction(
          await callActiveAgent<ReleaseRollbackActionRecord>(deviceId, 'release-rollback-status', { planId }, signal),
          deviceId,
          resolved.profile,
        )
        if (action.planId !== planId) throw new AgentClientError('release-rollback-mismatch', 'release rollback status does not match the requested plan')
        return ok(action)
      }
      if (endpoint === 'release-retention-action-status') {
        const body = closedPayload(payload, ['deviceId', 'planId'], 'release retention status payload')
        const deviceId = normalizeDeviceId(requiredString(body.deviceId, 'deviceId'))
        const planId = requiredString(body.planId, 'planId')
        const match = /^release-retention-plan:([0-9a-f]{64})$/.exec(planId)
        if (match?.[1] === undefined) throw new TypeError('release retention planId is invalid')
        const action = releaseRetentionAction(
          await callActiveAgent<ReleaseRetentionActionRecord>(deviceId, 'release-retention-status', { planId }, signal),
          {
            deviceId,
            planDigest: match[1],
            planId,
            principalId: federationIdentifier(resolved.convergence.principalId, 'principalId'),
            profile: resolved.profile,
          },
        )
        return ok(action)
      }
      if (endpoint === 'federation-list') {
        const body = closedPayload(payload, ['limit'], 'federation list payload')
        if (typeof body.limit !== 'number' || !Number.isSafeInteger(body.limit) || body.limit < 1 || body.limit > 100) {
          throw new TypeError('federation list limit must be an integer from 1 to 100')
        }
        const signer = await federationSigner(signal)
        return ok(federationInbox(
          await callActiveAgent<FleetFederationInboxItem[]>(signer.deviceId, 'federation-list', { limit: body.limit }, signal),
          signer.teamId,
          signer.deviceId,
        ))
      }
      if (endpoint === 'ack') {
        const body = closedPayload(payload, ['disposition', 'messageId', 'payloadDigest'], 'federation acknowledgement payload')
        const disposition = body.disposition
        if (disposition !== 'acknowledged' && disposition !== 'dismissed') {
          throw new TypeError('federation acknowledgement disposition is invalid')
        }
        const signer = await federationSigner(signal)
        const acknowledgement: {
          disposition: 'acknowledged' | 'dismissed'
          messageId: string
          payloadDigest: string
        } = {
          disposition,
          messageId: namespacedMessageId(body.messageId, 'messageId'),
          payloadDigest: sha256Digest(body.payloadDigest, 'payloadDigest'),
        }
        return ok(federationAcknowledgement(await callActiveAgent<AcknowledgeFederationMessageResult>(
          signer.deviceId,
          'federation-ack',
          acknowledgement,
          signal,
        ), acknowledgement))
      }
      if (endpoint === 'retention-plan') {
        if (payload !== null) throw new TypeError('federation retention plan payload must be null')
        const signer = await federationSigner(signal)
        return ok(federationRetentionPlan(await callActiveAgent(
          signer.deviceId,
          'federation-retention-plan',
          {
            acknowledgedRetentionMs: 30 * 24 * 60 * 60 * 1000,
            expiredRetentionMs: 30 * 24 * 60 * 60 * 1000,
            maxEntries: 500,
          },
          signal,
        )))
      }
      if (endpoint === 'import') {
        const body = closedPayload(payload, ['envelope'], 'federation import payload')
        const signer = await federationSigner(signal)
        const incoming = federationEnvelope(body.envelope, 'federation import envelope')
        if (incoming.teamId === signer.teamId || incoming.recipient.teamId !== signer.teamId ||
            incoming.recipient.deviceId !== signer.deviceId) {
          throw new AgentClientError('federation-recipient-mismatch', 'federation import must be a foreign advisory addressed to the fixed local signer')
        }
        const receipt = await callActiveAgent<FleetA2AReceipt>(signer.deviceId, 'a2a-receive', { envelope: incoming }, signal)
        if (receipt.requestMessageId !== incoming.messageId) {
          throw new AgentClientError('a2a-receipt-invalid', 'federation import returned an unrelated receipt')
        }
        const signedReceipt = federationEnvelope(receipt.response, 'federation import receipt')
        const expectedStatus = incoming.kind === 'handoff' ? 'stored' : 'accepted'
        if (signedReceipt.kind !== 'receipt' || signedReceipt.teamId !== signer.teamId ||
            signedReceipt.sender.deviceId !== signer.deviceId || signedReceipt.sender.principalId !== signer.principalId ||
            signedReceipt.sender.keyId !== signer.keyId || signedReceipt.recipient.teamId !== incoming.teamId ||
            signedReceipt.recipient.deviceId !== incoming.sender.deviceId ||
            signedReceipt.payload.requestMessageId !== incoming.messageId || signedReceipt.payload.status !== expectedStatus) {
          throw new AgentClientError('a2a-receipt-invalid', 'federation import returned an invalid signed receipt')
        }
        return ok(signedReceipt)
      }
      if (endpoint === 'handoff-export') {
        const body = closedPayload(payload, [
          'artifactRefs', 'handoffId', 'recipientDeviceId', 'recipientTeamId', 'summary', 'taskId',
        ], 'federation handoff export payload')
        const handoffPayload = {
          handoffId: requiredString(body.handoffId, 'handoffId'),
          taskId: body.taskId === null ? null : requiredString(body.taskId, 'taskId'),
          summary: requiredString(body.summary, 'summary'),
          artifactRefs: body.artifactRefs,
        }
        return ok(await signFederationAdvisory(
          requiredString(body.recipientTeamId, 'recipientTeamId'),
          requiredString(body.recipientDeviceId, 'recipientDeviceId'),
          'handoff',
          handoffPayload,
          signal,
        ))
      }
      if (endpoint === 'approval-request-export') {
        const body = closedPayload(payload, [
          'approvalId', 'expiresAt', 'recipientDeviceId', 'recipientTeamId', 'summary', 'taskId',
        ], 'federation approval request export payload')
        const expiresAt = canonicalTimestamp(body.expiresAt, 'expiresAt')
        const now = Date.now()
        if (Date.parse(expiresAt) <= now || Date.parse(expiresAt) > now + 24 * 60 * 60 * 1000) {
          throw new TypeError('federation approval request expiry must be within the next 24 hours')
        }
        const requestPayload = {
          approvalId: requiredString(body.approvalId, 'approvalId'),
          taskId: requiredString(body.taskId, 'taskId'),
          summary: requiredString(body.summary, 'summary'),
          expiresAt,
        }
        return ok(await signFederationAdvisory(
          requiredString(body.recipientTeamId, 'recipientTeamId'),
          requiredString(body.recipientDeviceId, 'recipientDeviceId'),
          'approval.request',
          requestPayload,
          signal,
        ))
      }
      if (endpoint === 'approval-decision-export') {
        const body = closedPayload(payload, ['decision', 'request'], 'federation approval decision export payload')
        const decision = requiredString(body.decision, 'decision') as FleetFederationApprovalDecision
        if (decision !== 'endorsed' && decision !== 'declined') throw new TypeError('federation approval decision is invalid')
        const signer = await federationSigner(signal)
        const supplied = federationEnvelope(body.request, 'federation approval request')
        if (supplied.kind !== 'approval.request' || supplied.teamId === signer.teamId ||
            supplied.recipient.teamId !== signer.teamId || supplied.recipient.deviceId !== signer.deviceId) {
          throw new AgentClientError('federation-approval-mismatch', 'approval decision requires a foreign request addressed to the fixed local signer')
        }
        const request = federationEnvelope(
          await callActiveAgent<FleetA2AEnvelope>(signer.deviceId, 'a2a-verify', { envelope: supplied }, signal),
          'verified federation approval request',
        )
        if (request.kind !== 'approval.request' || request.messageId !== supplied.messageId ||
            request.payloadDigest !== supplied.payloadDigest || request.teamId !== supplied.teamId ||
            request.sender.deviceId !== supplied.sender.deviceId || Date.parse(request.expiresAt) <= Date.now() ||
            Date.parse(request.payload.expiresAt as string) <= Date.now()) {
          throw new AgentClientError('federation-approval-mismatch', 'verified federation approval request is stale or does not match the supplied envelope')
        }
        const decisionPayload: FleetFederationApprovalDecisionPayload = {
          approvalId: request.payload.approvalId as string,
          taskId: request.payload.taskId as string,
          approvalRequestMessageId: request.messageId,
          approvalRequestPayloadDigest: request.payloadDigest,
          decision,
          decidedAt: new Date().toISOString(),
        }
        return ok(await signFederationAdvisory(
          request.teamId,
          request.sender.deviceId,
          'approval.decision',
          decisionPayload,
          signal,
        ))
      }
      if (endpoint === 'task-submit') {
        const body = closedPayload(payload, ['policyId', 'profile', 'prompt', 'targetDeviceId', 'taskId', 'workspaceId'], 'task submit payload')
        const targetDeviceId = normalizeDeviceId(requiredString(body.targetDeviceId, 'targetDeviceId'))
        const taskId = requiredString(body.taskId, 'taskId')
        const workspaceId = requiredString(body.workspaceId, 'workspaceId')
        const profile = requiredString(body.profile, 'profile')
        const policyId = requiredString(body.policyId, 'policyId')
        const prompt = requiredString(body.prompt, 'prompt')
        validateA2APayload('task.status', { taskId })
        const desiredBinding = await assertActiveRoute(targetDeviceId)
        const liveBinding = await loadManifestBinding(resolved.manifestPath)
        if (desiredBinding.manifest.schemaVersion !== 2 || desiredBinding.manifest.v2?.assignments[targetDeviceId]?.[resolved.profile] === undefined) {
          throw new AgentClientError('task-target-not-assigned', 'task target is not assigned to the active profile release')
        }
        const inspection = await callActiveAgent<ReleaseAgentInspection>(targetDeviceId, 'release-inspect', null, signal)
        assertAgentIdentity(targetDeviceId, inspection)
        if (inspection.profile !== resolved.profile || inspection.liveManifestDigest !== liveBinding.digest ||
            inspection.desiredManifestDigest !== desiredBinding.digest || liveBinding.digest !== desiredBinding.digest) {
          throw new AgentClientError('task-release-mismatch', 'task target and Host must agree on the same live and desired Fleet manifest')
        }
        if (inspection.currentRelease === null || inspection.currentRelease.releaseDigest !== inspection.assignedRelease.releaseDigest ||
            inspection.currentRelease.releaseId !== inspection.assignedRelease.releaseId ||
            inspection.currentRelease.releaseVersion !== inspection.assignedRelease.releaseVersion || inspection.changes.length !== 0) {
          throw new AgentClientError('task-target-not-aligned', 'task target must be fully aligned with its assigned release')
        }
        if (!inspection.tasks.enabled) throw new AgentClientError('tasks-disabled', 'remote tasks are disabled on this target')
        if (!inspection.tasks.workspaceIds.includes(workspaceId) || !inspection.tasks.profiles.includes(profile)) {
          throw new AgentClientError('task-policy-denied', 'task workspace or profile is not enabled on this target')
        }
        if (!Array.isArray(inspection.tasks.executionProfiles) || !Array.isArray(inspection.tasks.profiles) ||
            !inspection.tasks.profiles.every(candidate => typeof candidate === 'string')) {
          throw new AgentClientError('task-profile-unbound', 'target did not bind its executable task profiles')
        }
        const executionProfileBindings = new Map<string, string>()
        for (const candidate of inspection.tasks.executionProfiles as unknown[]) {
          if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
            throw new AgentClientError('task-profile-unbound', 'task execution profile hash is missing, duplicated, or invalid')
          }
          const binding = candidate as Record<string, unknown>
          if (Object.keys(binding).length !== 2 || !Object.hasOwn(binding, 'profile') || !Object.hasOwn(binding, 'profileHash') ||
              typeof binding.profile !== 'string' || !inspection.tasks.profiles.includes(binding.profile) ||
              typeof binding.profileHash !== 'string' || !SHA256_PATTERN.test(binding.profileHash) ||
              executionProfileBindings.has(binding.profile)) {
            throw new AgentClientError('task-profile-unbound', 'task execution profile hash is missing, duplicated, or invalid')
          }
          executionProfileBindings.set(binding.profile, binding.profileHash)
        }
        const executionProfileHash = executionProfileBindings.get(profile)
        if (executionProfileHash === undefined || executionProfileBindings.size !== inspection.tasks.profiles.length ||
            new Set(inspection.tasks.profiles).size !== inspection.tasks.profiles.length) {
          throw new AgentClientError('task-profile-unbound', 'task execution profile hash is missing, duplicated, or invalid')
        }
        const policy = inspection.tasks.policies.find(candidate => candidate.policyId === policyId)
        if (policy === undefined) throw new AgentClientError('task-policy-denied', 'requested task policy is not enabled on this target')
        const timeoutMs = Math.min(10 * 60 * 1000, inspection.tasks.timeoutMs ?? 10 * 60 * 1000)
        const taskPayload = {
          taskId,
          workspaceId,
          profile,
          executionProfileHash,
          manifestDigest: liveBinding.digest,
          releaseDigest: inspection.currentRelease.releaseDigest,
          policyId: policy.policyId,
          policyDigest: policy.policyDigest,
          deadline: new Date(Date.now() + timeoutMs).toISOString(),
          prompt,
        }
        validateA2APayload('task.submit', taskPayload)
        const response = await signedTaskCall(targetDeviceId, 'task.submit', taskPayload, signal)
        return ok({ taskId: taskPayload.taskId, response })
      }
      if (endpoint === 'task-approval-decision') {
        const body = closedPayload(payload, ['decision', 'request', 'targetDeviceId', 'taskId'], 'task approval decision payload')
        const targetDeviceId = normalizeDeviceId(requiredString(body.targetDeviceId, 'targetDeviceId'))
        const taskId = requiredString(body.taskId, 'taskId')
        const decision = requiredString(body.decision, 'decision') as FleetTaskApprovalDecision
        if (decision !== 'allowed-once' && decision !== 'rejected') throw new TypeError('decision must be allowed-once or rejected')
        const signerDeviceId = resolved.convergence.signerDeviceId
        if (signerDeviceId === undefined) throw new AgentClientError('a2a-signer-missing', 'a fixed local A2A signer is not configured')
        const signer = resolved.convergence.targets.find(target => target.deviceId === signerDeviceId)
        if (signer === undefined || signer.transport !== 'local') {
          throw new AgentClientError('a2a-signer-invalid', 'A2A signer must be a configured local Agent target')
        }
        await assertActiveRoute(targetDeviceId)
        await assertActiveRoute(signerDeviceId)
        const request = await callActiveAgent<FleetA2AEnvelope>(signerDeviceId, 'a2a-verify', { envelope: body.request }, signal)
        if (request.kind !== 'task.approval.request' || request.sender.deviceId !== targetDeviceId || request.payload.taskId !== taskId) {
          throw new AgentClientError('task-approval-mismatch', 'signed approval request does not match the target and task')
        }
        const requestPayload = request.payload as FleetTaskApprovalRequestPayload
        validateA2APayload('task.approval.request', requestPayload)
        if (Date.parse(requestPayload.expiresAt) <= Date.now()) {
          throw new AgentClientError('task-approval-expired', 'signed task approval request has expired')
        }
        const decisionPayload: FleetTaskApprovalDecisionPayload = {
          approvalId: requestPayload.approvalId,
          taskId,
          approvalRequestMessageId: request.messageId,
          approvalRequestPayloadDigest: request.payloadDigest,
          taskBindingDigest: requestPayload.taskBindingDigest,
          toolCallId: requestPayload.toolCallId,
          argumentsDigest: requestPayload.argumentsDigest,
          decision,
          decidedAt: new Date().toISOString(),
        }
        validateA2APayload('task.approval.decision', decisionPayload)
        const envelope = await callActiveAgent<FleetA2AEnvelope>(signerDeviceId, 'a2a-sign', {
          recipientDeviceId: targetDeviceId,
          kind: 'task.approval.decision',
          payload: decisionPayload,
        }, signal)
        const receipt = await callActiveAgent<FleetA2AReceipt>(targetDeviceId, 'a2a-receive', { envelope }, signal)
        if (receipt.requestMessageId !== envelope.messageId) {
          throw new AgentClientError('a2a-receipt-invalid', 'target returned an invalid approval receipt')
        }
        const verified = await callActiveAgent<FleetA2AEnvelope>(signerDeviceId, 'a2a-verify', { envelope: receipt.response }, signal)
        if (verified.kind !== 'receipt' || verified.sender.deviceId !== targetDeviceId ||
            verified.payload.requestMessageId !== envelope.messageId || verified.payload.status !== 'accepted') {
          throw new AgentClientError('a2a-response-mismatch', 'signed approval receipt does not match the decision')
        }
        return ok({ taskId, response: verified })
      }
      if (endpoint === 'task-status' || endpoint === 'task-cancel') {
        const body = closedPayload(payload, ['targetDeviceId', 'taskId'], 'task control payload')
        const targetDeviceId = normalizeDeviceId(requiredString(body.targetDeviceId, 'targetDeviceId'))
        const taskId = requiredString(body.taskId, 'taskId')
        validateA2APayload(endpoint === 'task-status' ? 'task.status' : 'task.cancel', { taskId })
        const response = await signedTaskCall(targetDeviceId, endpoint === 'task-status' ? 'task.status' : 'task.cancel', { taskId }, signal)
        return ok({ taskId, response })
      }
      if (endpoint === 'tasks-list') {
        const body = closedPayload(payload, ['limit', 'targetDeviceId'], 'tasks-list payload')
        const targetDeviceId = normalizeDeviceId(requiredString(body.targetDeviceId, 'targetDeviceId'))
        if (typeof body.limit !== 'number' || !Number.isSafeInteger(body.limit) || body.limit < 1 || body.limit > 100) {
          throw new TypeError('tasks-list limit must be an integer from 1 to 100')
        }
        return ok(taskCatalog(await callActiveAgent<FleetTaskCatalog>(targetDeviceId, 'tasks-list', { limit: body.limit }, signal), targetDeviceId))
      }
      if (endpoint === 'tasks-prune') {
        const body = closedPayload(payload, ['olderThan', 'states', 'targetDeviceId'], 'tasks-prune payload')
        const targetDeviceId = normalizeDeviceId(requiredString(body.targetDeviceId, 'targetDeviceId'))
        const olderThan = canonicalTimestamp(body.olderThan, 'olderThan')
        if (!Array.isArray(body.states) || body.states.length === 0 || body.states.length > TERMINAL_TASK_STATES.size ||
            body.states.some(state => typeof state !== 'string' || !TERMINAL_TASK_STATES.has(state as FleetTerminalTaskState)) ||
            new Set(body.states).size !== body.states.length) {
          throw new TypeError('tasks-prune states must be unique terminal task states')
        }
        return ok(taskPruneResult(await callActiveAgent<FleetTaskPruneResult>(targetDeviceId, 'tasks-prune', {
          olderThan,
          states: body.states,
        }, signal)))
      }
      if (endpoint === 'tasks-resume') {
        const body = closedPayload(payload, ['targetDeviceId'], 'tasks resume payload')
        const targetDeviceId = normalizeDeviceId(requiredString(body.targetDeviceId, 'targetDeviceId'))
        return ok(taskResumeResult(await callActiveAgent<{ resumed: number }>(targetDeviceId, 'tasks-resume', null, signal)))
      }
      return fail('unknown agent endpoint: ' + endpoint)
    } catch (error: unknown) {
      if (error instanceof AgentClientError) return fail(error.message)
      return fail(error instanceof Error ? error.message : String(error))
    }
  }, { authority: 'loopback' })
}

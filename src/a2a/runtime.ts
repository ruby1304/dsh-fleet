import { spawn } from 'node:child_process'
import { createHash, createPublicKey, randomUUID } from 'node:crypto'
import { constants, existsSync } from 'node:fs'
import { link, lstat, mkdir, open, readdir, realpath, rename, rm } from 'node:fs/promises'
import { dirname, isAbsolute, join, normalize } from 'node:path'
import {
  assertA2AReadyConfig,
  type CanonicalTaskPolicy,
  type A2AReadyFleetAgentConfig,
  type FleetAgentConfig,
} from '../agent/config.ts'
import { readAppliedRelease } from '../agent/runtime.ts'
import { sha256Canonical } from '../agent/protocol.ts'
import { createAllowedOnceToken, createTaskBindingDigest } from '../worker/context.ts'
import { resolveTaskPolicy, classifyTaskToolCall, validateTaskToolFilesystemScope } from '../worker/policy.ts'
import { assertExecutionProfileHash } from '../worker/profile.ts'
import {
  approvalSegment,
  parseTaskApprovalIntent,
  TASK_APPROVAL_DECISION_SCHEMA_VERSION,
  TASK_WORKER_CONTEXT_SCHEMA_VERSION,
  type FleetTaskApprovalDecisionFile,
  type FleetTaskApprovalIntent,
  type FleetTaskWorkerContext,
} from '../worker/state.ts'
import {
  FLEET_A2A_KINDS,
  a2aKeyId,
  createA2AEnvelope,
  isFleetFederationAdvisoryKind,
  validateA2APayload,
  verifyA2AEnvelope,
  type FleetA2AEnvelope,
  type FleetA2AKind,
  type FleetA2ATrustEntry,
  type FleetTaskApprovalDecisionPayload,
  type FleetTaskApprovalRequestPayload,
  type FleetTaskSubmitPayload,
} from './protocol.ts'
import { federationReceiptPayload, receiveFederationEnvelope } from '../federation/inbox.ts'

export interface FleetA2ATrustStore {
  schemaVersion: 1 | 2
  teamId: string
  entries: FleetA2ATrustEntry[]
}

export type FleetTaskState = 'accepted' | 'running' | 'cancel-requested' | 'succeeded' | 'failed' | 'cancelled'
export type FleetTerminalTaskState = Extract<FleetTaskState, 'succeeded' | 'failed' | 'cancelled'>

export interface FleetTaskRecord {
  schemaVersion: 1 | 2 | 3
  taskId: string
  requestMessageId: string
  senderDeviceId: string
  senderPrincipalId: string
  senderKeyId: string | null
  workspaceId: string
  workspacePath: string | null
  profile: string
  executionProfileHash: string | null
  promptDigest: string
  manifestDigest: string | null
  releaseDigest: string | null
  policyId: string | null
  policyDigest: string | null
  taskBindingDigest: string | null
  state: FleetTaskState
  createdAt: string
  updatedAt: string
  deadlineAt: string
  resultDigest: string | null
  errorCode: string | null
}

export interface FleetTaskCatalogItem {
  taskId: string
  state: FleetTaskState
  targetDeviceId: string
  workspaceId: string
  profile: string
  createdAt: string
  updatedAt: string
  errorCode: string | null
  resultDigest: string | null
}

export interface FleetTaskCatalog {
  generatedAt: string
  tasks: FleetTaskCatalogItem[]
}

export interface FleetTaskPruneResult {
  pruned: number
  skippedActive: number
}

interface FleetTaskRequest {
  schemaVersion: 1 | 2 | 3
  taskId: string
  requestMessageId: string
  senderDeviceId: string
  senderPrincipalId: string
  senderKeyId: string | null
  workspaceId: string
  workspacePath: string | null
  profile: string
  executionProfileHash: string | null
  promptDigest: string
  manifestDigest: string | null
  releaseDigest: string | null
  policyId: string | null
  policyDigest: string | null
  taskBindingDigest: string | null
  deadline: string | null
  prompt: string
}

export interface A2AWorkerLaunch {
  nodeBinary: string
  agentPath: string
  configPath: string
}

export interface A2ARuntimeLockHooks {
  /** Test seam for replacing a stale pathname after observation but before the hard-link CAS claim. */
  beforeStaleLockClaim?: (path: string) => void | Promise<void>
}

export interface FleetA2AReceipt {
  requestMessageId: string
  response: FleetA2AEnvelope
}

interface StoredFleetA2AReceipt {
  schemaVersion: 1
  requestEnvelopeDigest: string
  receiptDigest: string
  receipt: FleetA2AReceipt
}

class FleetA2ARuntimeError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'FleetA2ARuntimeError'
    this.code = code
  }
}

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function readStoredReceipt(value: unknown, envelope: FleetA2AEnvelope): FleetA2AReceipt {
  const raw = stateRecord(value, ['schemaVersion', 'requestEnvelopeDigest', 'receiptDigest', 'receipt'], 'A2A receipt state')
  if (raw.schemaVersion !== 1 || typeof raw.requestEnvelopeDigest !== 'string' || !/^[0-9a-f]{64}$/.test(raw.requestEnvelopeDigest) ||
      typeof raw.receiptDigest !== 'string' || !/^[0-9a-f]{64}$/.test(raw.receiptDigest)) {
    throw new FleetA2ARuntimeError('receipt-state-invalid', 'A2A receipt state is invalid or legacy-unbound')
  }
  if (raw.requestEnvelopeDigest !== sha256Canonical(envelope)) {
    throw new FleetA2ARuntimeError('message-id-conflict', 'A2A message id is already bound to a different signed envelope')
  }
  const receiptRaw = stateRecord(raw.receipt, ['requestMessageId', 'response'], 'A2A receipt')
  if (receiptRaw.requestMessageId !== envelope.messageId || sha256Canonical(raw.receipt) !== raw.receiptDigest ||
      typeof receiptRaw.response !== 'object' || receiptRaw.response === null || Array.isArray(receiptRaw.response)) {
    throw new FleetA2ARuntimeError('receipt-state-invalid', 'A2A receipt state does not match its request')
  }
  const response = receiptRaw.response as unknown as FleetA2AEnvelope
  try {
    validateA2APayload(response.kind, response.payload)
  } catch {
    throw new FleetA2ARuntimeError('receipt-state-invalid', 'A2A receipt response payload is invalid')
  }
  if (response.recipient?.teamId !== envelope.teamId || response.recipient.deviceId !== envelope.sender.deviceId) {
    throw new FleetA2ARuntimeError('receipt-state-invalid', 'A2A receipt response targets another sender')
  }
  return raw.receipt as FleetA2AReceipt
}

function storedReceipt(envelope: FleetA2AEnvelope, receipt: FleetA2AReceipt): StoredFleetA2AReceipt {
  return {
    schemaVersion: 1,
    requestEnvelopeDigest: sha256Canonical(envelope),
    receiptDigest: sha256Canonical(receipt),
    receipt,
  }
}

async function ensureDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 })
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  await ensureDirectory(dirname(path))
  const temporary = path + '.' + randomUUID() + '.tmp'
  let handle
  try {
    handle = await open(temporary, 'wx', 0o600)
    await handle.writeFile(JSON.stringify(value, null, 2) + '\n')
    await handle.sync()
    await handle.close()
    handle = undefined
    await rename(temporary, path)
  } catch (error: unknown) {
    await handle?.close()
    await rm(temporary, { force: true })
    throw error
  }
}

async function atomicText(path: string, value: string): Promise<void> {
  await ensureDirectory(dirname(path))
  const temporary = path + '.' + randomUUID() + '.tmp'
  let handle
  try {
    handle = await open(temporary, 'wx', 0o600)
    await handle.writeFile(value)
    await handle.sync()
    await handle.close()
    handle = undefined
    await rename(temporary, path)
  } catch (error: unknown) {
    await handle?.close()
    await rm(temporary, { force: true })
    throw error
  }
}

async function exclusiveJson(path: string, value: unknown): Promise<void> {
  await ensureDirectory(dirname(path))
  let handle
  try {
    handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)
    await handle.writeFile(JSON.stringify(value, null, 2) + '\n')
    await handle.sync()
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
      throw new FleetA2ARuntimeError('unsafe-state-file', 'A2A state accepts regular files only')
    }
    throw error
  } finally {
    await handle?.close()
  }
}

async function readRegularFile(path: string, privateFile = false): Promise<string> {
  let handle
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    const info = await handle.stat()
    if (!info.isFile()) throw new FleetA2ARuntimeError('unsafe-state-file', 'A2A state accepts regular files only')
    if (privateFile && ((info.mode & 0o077) !== 0 || (typeof process.getuid === 'function' && info.uid !== process.getuid()))) {
      throw new FleetA2ARuntimeError('unsafe-state-permissions', 'private A2A state must be owner-only and owned by the current user')
    }
    return await handle.readFile('utf8')
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') throw new FleetA2ARuntimeError('unsafe-state-file', 'A2A state accepts regular files only')
    throw error
  } finally {
    await handle?.close()
  }
}

function exactKeys(value: unknown, keys: readonly string[], field: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new FleetA2ARuntimeError('invalid-config', field + ' must be an object')
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new FleetA2ARuntimeError('invalid-config', field + ' has unsupported or missing fields')
  }
}

export async function readA2ATrustStore(config: A2AReadyFleetAgentConfig): Promise<Map<string, FleetA2ATrustEntry>> {
  const raw: unknown = JSON.parse(await readRegularFile(config.a2a.trustStorePath))
  exactKeys(raw, ['schemaVersion', 'teamId', 'entries'], 'trust store')
  if ((raw.schemaVersion !== 1 && raw.schemaVersion !== 2) || raw.teamId !== config.a2a.teamId || !Array.isArray(raw.entries)) {
    throw new FleetA2ARuntimeError('invalid-config', 'trust store schema or team identity is invalid')
  }
  const trust = new Map<string, FleetA2ATrustEntry>()
  for (let index = 0; index < raw.entries.length; index += 1) {
    const entry = raw.entries[index]
    exactKeys(entry, raw.schemaVersion === 1
      ? ['keyId', 'principalId', 'deviceId', 'publicKeyPem', 'allowedKinds']
      : ['teamId', 'keyId', 'principalId', 'deviceId', 'publicKeyPem', 'allowedKinds'], `trust store entries[${index}]`)
    if (typeof entry.keyId !== 'string' || typeof entry.principalId !== 'string' || typeof entry.deviceId !== 'string' ||
        typeof entry.publicKeyPem !== 'string' || !Array.isArray(entry.allowedKinds) ||
        entry.allowedKinds.some(kind => typeof kind !== 'string' || !FLEET_A2A_KINDS.includes(kind as FleetA2AKind))) {
      throw new FleetA2ARuntimeError('invalid-config', 'trust store entry is invalid')
    }
    const senderTeamId = raw.schemaVersion === 1 ? config.a2a.teamId : entry.teamId
    if (typeof senderTeamId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(senderTeamId) ||
        !/^ed25519:[0-9a-f]{64}$/.test(entry.keyId) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(entry.principalId) ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(entry.deviceId) || new Set(entry.allowedKinds).size !== entry.allowedKinds.length) {
      throw new FleetA2ARuntimeError('invalid-config', 'trust store entry identity or capabilities are invalid')
    }
    try {
      if (a2aKeyId(entry.publicKeyPem) !== entry.keyId) throw new Error('key mismatch')
    } catch {
      throw new FleetA2ARuntimeError('invalid-config', 'trust store entry key identity is invalid')
    }
    if (trust.has(entry.keyId)) throw new FleetA2ARuntimeError('invalid-config', 'trust store key ids must be unique')
    trust.set(entry.keyId, { ...entry, teamId: senderTeamId } as unknown as FleetA2ATrustEntry)
  }
  return trust
}

async function privateKeyPem(config: A2AReadyFleetAgentConfig): Promise<string> {
  return readRegularFile(config.a2a.privateKeyPath, true)
}

export async function signA2AMessage(
  config: FleetAgentConfig,
  recipientDeviceId: string,
  kind: FleetA2AKind,
  payload: Record<string, unknown>,
  now = new Date(),
  recipientTeamId?: string,
): Promise<FleetA2AEnvelope> {
  assertA2AReadyConfig(config)
  const ttlMs = messageTtlMs(config, kind, payload, now, recipientTeamId !== undefined && recipientTeamId !== config.a2a.teamId)
  return createA2AEnvelope({
    teamId: config.a2a.teamId,
    sender: { principalId: config.a2a.principalId, deviceId: config.deviceId },
    recipient: { teamId: recipientTeamId ?? config.a2a.teamId, deviceId: recipientDeviceId },
    kind,
    payload,
    privateKey: await privateKeyPem(config),
    now,
    ttlMs,
  })
}

function messageTtlMs(
  config: A2AReadyFleetAgentConfig,
  kind: FleetA2AKind,
  payload: Record<string, unknown>,
  now: Date,
  foreign: boolean,
): number {
  const shortTtlMs = Math.min(5 * 60 * 1000, config.a2a.maxMessageTtlMs)
  if (!foreign || !isFleetFederationAdvisoryKind(kind)) return shortTtlMs
  if (kind !== 'approval.request') return config.a2a.maxMessageTtlMs
  const payloadExpiry = typeof payload.expiresAt === 'string' ? Date.parse(payload.expiresAt) : Number.NaN
  const remainingMs = payloadExpiry - now.getTime()
  if (!Number.isFinite(remainingMs) || remainingMs < 1000) {
    throw new FleetA2ARuntimeError('message-expired', 'federation approval request expires too soon to sign')
  }
  return Math.min(config.a2a.maxMessageTtlMs, remainingMs)
}

export async function verifyA2AMessage(
  config: FleetAgentConfig,
  value: unknown,
  now = new Date(),
): Promise<FleetA2AEnvelope> {
  assertA2AReadyConfig(config)
  return verifyA2AEnvelope(value, {
    expectedTeamId: config.a2a.teamId,
    expectedDeviceId: config.deviceId,
    trust: await readA2ATrustStore(config),
    now,
    maxTtlMs: config.a2a.maxMessageTtlMs,
  })
}

function taskSegment(taskId: string): string {
  const match = /^task:([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/.exec(taskId)
  if (match?.[1] === undefined) throw new FleetA2ARuntimeError('invalid-task-id', 'task id is invalid')
  return match[1]
}

function taskDirectory(config: FleetAgentConfig, taskId: string): string {
  return join(config.stateDir, 'tasks', taskSegment(taskId))
}

const TASK_STATES = new Set<FleetTaskState>(['accepted', 'running', 'cancel-requested', 'succeeded', 'failed', 'cancelled'])

function stateRecord(value: unknown, keys: readonly string[], field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new FleetA2ARuntimeError('invalid-task-state', field + ' must be an object')
  const raw = value as Record<string, unknown>
  const actual = Object.keys(raw).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new FleetA2ARuntimeError('invalid-task-state', field + ' has unsupported or missing fields')
  }
  return raw
}

function stateText(value: unknown, field: string, max = 128): string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim() || value.length > max || /[\r\n\0]/.test(value)) {
    throw new FleetA2ARuntimeError('invalid-task-state', field + ' is invalid')
  }
  return value
}

function stateTime(value: unknown, field: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(Date.parse(value)).toISOString() !== value) {
    throw new FleetA2ARuntimeError('invalid-task-state', field + ' is invalid')
  }
  return value
}

function stateDigest(value: unknown, field: string, nullable = false): string | null {
  if (nullable && value === null) return null
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) throw new FleetA2ARuntimeError('invalid-task-state', field + ' is invalid')
  return value
}

function parseTaskRecord(value: unknown, expectedTaskId: string): FleetTaskRecord {
  const schema = typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>).schemaVersion
    : undefined
  const legacy = schema === 1
  const executionBound = schema === 3
  const raw = stateRecord(value, legacy ? [
    'schemaVersion', 'taskId', 'requestMessageId', 'senderDeviceId', 'senderPrincipalId', 'workspaceId', 'profile',
    'promptDigest', 'state', 'createdAt', 'updatedAt', 'deadlineAt', 'resultDigest', 'errorCode',
  ] : executionBound ? [
    'schemaVersion', 'taskId', 'requestMessageId', 'senderDeviceId', 'senderPrincipalId', 'senderKeyId',
    'workspaceId', 'workspacePath', 'profile', 'executionProfileHash', 'promptDigest', 'manifestDigest', 'releaseDigest', 'policyId',
    'policyDigest', 'taskBindingDigest', 'state', 'createdAt', 'updatedAt', 'deadlineAt', 'resultDigest', 'errorCode',
  ] : [
    'schemaVersion', 'taskId', 'requestMessageId', 'senderDeviceId', 'senderPrincipalId', 'senderKeyId',
    'workspaceId', 'workspacePath', 'profile', 'promptDigest', 'manifestDigest', 'releaseDigest', 'policyId',
    'policyDigest', 'taskBindingDigest', 'state', 'createdAt', 'updatedAt', 'deadlineAt', 'resultDigest', 'errorCode',
  ], 'task record')
  const taskId = stateText(raw.taskId, 'task record.taskId')
  taskSegment(taskId)
  const state = stateText(raw.state, 'task record.state', 24) as FleetTaskState
  if ((raw.schemaVersion !== 1 && raw.schemaVersion !== 2 && raw.schemaVersion !== 3) || taskId !== expectedTaskId || !TASK_STATES.has(state)) {
    throw new FleetA2ARuntimeError('invalid-task-state', 'task record identity, schema or state is invalid')
  }
  const errorCode = raw.errorCode === null ? null : stateText(raw.errorCode, 'task record.errorCode', 64)
  return {
    schemaVersion: raw.schemaVersion,
    taskId,
    requestMessageId: stateText(raw.requestMessageId, 'task record.requestMessageId', 64),
    senderDeviceId: stateText(raw.senderDeviceId, 'task record.senderDeviceId', 64),
    senderPrincipalId: stateText(raw.senderPrincipalId, 'task record.senderPrincipalId', 64),
    senderKeyId: legacy ? null : stateText(raw.senderKeyId, 'task record.senderKeyId', 80),
    workspaceId: stateText(raw.workspaceId, 'task record.workspaceId', 64),
    workspacePath: legacy ? null : stateText(raw.workspacePath, 'task record.workspacePath', 4096),
    profile: stateText(raw.profile, 'task record.profile', 64),
    executionProfileHash: executionBound ? stateDigest(raw.executionProfileHash, 'task record.executionProfileHash') : null,
    promptDigest: stateDigest(raw.promptDigest, 'task record.promptDigest')!,
    manifestDigest: legacy ? null : stateDigest(raw.manifestDigest, 'task record.manifestDigest'),
    releaseDigest: legacy ? null : stateDigest(raw.releaseDigest, 'task record.releaseDigest'),
    policyId: legacy ? null : stateText(raw.policyId, 'task record.policyId', 64),
    policyDigest: legacy ? null : stateDigest(raw.policyDigest, 'task record.policyDigest'),
    taskBindingDigest: legacy ? null : stateDigest(raw.taskBindingDigest, 'task record.taskBindingDigest'),
    state,
    createdAt: stateTime(raw.createdAt, 'task record.createdAt'),
    updatedAt: stateTime(raw.updatedAt, 'task record.updatedAt'),
    deadlineAt: stateTime(raw.deadlineAt, 'task record.deadlineAt'),
    resultDigest: stateDigest(raw.resultDigest, 'task record.resultDigest', true),
    errorCode,
  }
}

function parseTaskRequest(value: unknown, expectedTaskId: string): FleetTaskRequest {
  const schema = typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>).schemaVersion
    : undefined
  const legacy = schema === 1
  const executionBound = schema === 3
  const raw = stateRecord(value, legacy ? [
    'schemaVersion', 'taskId', 'requestMessageId', 'senderDeviceId', 'senderPrincipalId', 'workspaceId', 'profile', 'promptDigest', 'prompt',
  ] : executionBound ? [
    'schemaVersion', 'taskId', 'requestMessageId', 'senderDeviceId', 'senderPrincipalId', 'senderKeyId',
    'workspaceId', 'workspacePath', 'profile', 'executionProfileHash', 'promptDigest', 'manifestDigest', 'releaseDigest', 'policyId',
    'policyDigest', 'taskBindingDigest', 'deadline', 'prompt',
  ] : [
    'schemaVersion', 'taskId', 'requestMessageId', 'senderDeviceId', 'senderPrincipalId', 'senderKeyId',
    'workspaceId', 'workspacePath', 'profile', 'promptDigest', 'manifestDigest', 'releaseDigest', 'policyId',
    'policyDigest', 'taskBindingDigest', 'deadline', 'prompt',
  ], 'task request')
  if ((raw.schemaVersion !== 1 && raw.schemaVersion !== 2 && raw.schemaVersion !== 3) || raw.taskId !== expectedTaskId || typeof raw.prompt !== 'string' || raw.prompt.length === 0 || raw.prompt.includes('\0')) {
    throw new FleetA2ARuntimeError('invalid-task-state', 'task request identity, schema or prompt is invalid')
  }
  const promptDigest = stateDigest(raw.promptDigest, 'task request.promptDigest')!
  if (hash(raw.prompt) !== promptDigest) throw new FleetA2ARuntimeError('invalid-task-state', 'task request prompt digest is invalid')
  return {
    schemaVersion: raw.schemaVersion,
    taskId: expectedTaskId,
    requestMessageId: stateText(raw.requestMessageId, 'task request.requestMessageId', 64),
    senderDeviceId: stateText(raw.senderDeviceId, 'task request.senderDeviceId', 64),
    senderPrincipalId: stateText(raw.senderPrincipalId, 'task request.senderPrincipalId', 64),
    senderKeyId: legacy ? null : stateText(raw.senderKeyId, 'task request.senderKeyId', 80),
    workspaceId: stateText(raw.workspaceId, 'task request.workspaceId', 64),
    workspacePath: legacy ? null : stateText(raw.workspacePath, 'task request.workspacePath', 4096),
    profile: stateText(raw.profile, 'task request.profile', 64),
    executionProfileHash: executionBound ? stateDigest(raw.executionProfileHash, 'task request.executionProfileHash') : null,
    promptDigest,
    manifestDigest: legacy ? null : stateDigest(raw.manifestDigest, 'task request.manifestDigest'),
    releaseDigest: legacy ? null : stateDigest(raw.releaseDigest, 'task request.releaseDigest'),
    policyId: legacy ? null : stateText(raw.policyId, 'task request.policyId', 64),
    policyDigest: legacy ? null : stateDigest(raw.policyDigest, 'task request.policyDigest'),
    taskBindingDigest: legacy ? null : stateDigest(raw.taskBindingDigest, 'task request.taskBindingDigest'),
    deadline: legacy ? null : stateTime(raw.deadline, 'task request.deadline'),
    prompt: raw.prompt,
  }
}

async function readTaskRecord(config: FleetAgentConfig, taskId: string): Promise<FleetTaskRecord | null> {
  try {
    return parseTaskRecord(JSON.parse(await readRegularFile(join(taskDirectory(config, taskId), 'record.json'))) as unknown, taskId)
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

async function taskDirectoryEntries(config: FleetAgentConfig): Promise<Array<{ name: string }>> {
  const root = join(config.stateDir, 'tasks')
  let info
  try {
    info = await lstat(root)
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new FleetA2ARuntimeError('unsafe-state-file', 'task state root must be a real directory')
  }
  if ((info.mode & 0o077) !== 0) {
    throw new FleetA2ARuntimeError('unsafe-state-permissions', 'task state root must be owner-only')
  }
  const entries = await readdir(root, { withFileTypes: true })
  return entries.flatMap(entry => entry.isDirectory() &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(entry.name)
    ? [{ name: entry.name }]
    : [])
}

export async function listFleetTasks(config: FleetAgentConfig, limit = 50, now = new Date()): Promise<FleetTaskCatalog> {
  assertA2AReadyConfig(config)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new FleetA2ARuntimeError('invalid-payload', 'task list limit must be an integer from 1 to 100')
  }
  const records = await Promise.all((await taskDirectoryEntries(config)).map(async entry =>
    readTaskRecord(config, 'task:' + entry.name)))
  const tasks = records.flatMap(record => record === null ? [] : [{
    taskId: record.taskId,
    state: record.state,
    targetDeviceId: config.deviceId,
    workspaceId: record.workspaceId,
    profile: record.profile,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    errorCode: record.errorCode,
    resultDigest: record.resultDigest,
  }]).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.taskId.localeCompare(left.taskId)).slice(0, limit)
  return { generatedAt: now.toISOString(), tasks }
}

export async function pruneFleetTasks(
  config: FleetAgentConfig,
  input: { olderThan: string; states: FleetTerminalTaskState[] },
): Promise<FleetTaskPruneResult> {
  assertA2AReadyConfig(config)
  const olderThanMs = Date.parse(input.olderThan)
  if (!Number.isFinite(olderThanMs) || new Date(olderThanMs).toISOString() !== input.olderThan) {
    throw new FleetA2ARuntimeError('invalid-payload', 'tasks prune olderThan must be a canonical timestamp')
  }
  const allowed = new Set<FleetTerminalTaskState>(['succeeded', 'failed', 'cancelled'])
  if (!Array.isArray(input.states) || input.states.length === 0 || input.states.length > allowed.size ||
      input.states.some(state => !allowed.has(state)) || new Set(input.states).size !== input.states.length) {
    throw new FleetA2ARuntimeError('invalid-payload', 'tasks prune states must be unique terminal task states')
  }
  const selected = new Set(input.states)
  let pruned = 0
  let skippedActive = 0
  for (const entry of await taskDirectoryEntries(config)) {
    const taskId = 'task:' + entry.name
    const record = await readTaskRecord(config, taskId)
    if (record === null || Date.parse(record.updatedAt) >= olderThanMs) continue
    if (!selected.has(record.state as FleetTerminalTaskState)) {
      if (!allowed.has(record.state as FleetTerminalTaskState)) skippedActive += 1
      continue
    }
    if (await processLockActive(join(taskDirectory(config, taskId), 'worker.lock'))) {
      skippedActive += 1
      continue
    }
    await rm(taskDirectory(config, taskId), { recursive: true, force: false })
    pruned += 1
  }
  return { pruned, skippedActive }
}

async function readTaskRequest(config: FleetAgentConfig, taskId: string): Promise<FleetTaskRequest | null> {
  try {
    return parseTaskRequest(JSON.parse(await readRegularFile(join(taskDirectory(config, taskId), 'request.json'))) as unknown, taskId)
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

async function saveTaskRecord(config: FleetAgentConfig, record: FleetTaskRecord, state: FleetTaskState, fields: Partial<FleetTaskRecord> = {}): Promise<FleetTaskRecord> {
  const next: FleetTaskRecord = { ...record, ...fields, state, updatedAt: new Date().toISOString() }
  await atomicJson(join(taskDirectory(config, record.taskId), 'record.json'), next)
  return next
}

function workerPayload(record: FleetTaskRecord, result: string | null): { kind: 'task.progress' | 'task.result'; payload: Record<string, unknown> } {
  if (record.state === 'accepted' || record.state === 'running' || record.state === 'cancel-requested') {
    return {
      kind: 'task.progress',
      payload: { taskId: record.taskId, state: record.state, updatedAt: record.updatedAt },
    }
  }
  const preview = result === null || result.trim().length === 0 ? null : result.slice(0, 32 * 1024)
  return {
    kind: 'task.result',
    payload: {
      taskId: record.taskId,
      state: record.state,
      updatedAt: record.updatedAt,
      resultDigest: record.resultDigest,
      result: preview,
      truncated: result !== null && result.length > 32 * 1024,
      errorCode: record.errorCode,
    },
  }
}

async function taskResult(config: FleetAgentConfig, taskId: string): Promise<{ record: FleetTaskRecord; result: string | null }> {
  let record = await readTaskRecord(config, taskId)
  if (record === null) throw new FleetA2ARuntimeError('task-not-found', 'task was not found')
  let result: string | null = null
  try {
    result = await readRegularFile(join(taskDirectory(config, taskId), 'result.txt'))
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  if (record.state === 'accepted' || record.state === 'running' || record.state === 'cancel-requested') {
    const workerActive = await processLockActive(join(taskDirectory(config, taskId), 'worker.lock'))
    if (!workerActive && result !== null && record.state !== 'accepted') {
      record = await saveTaskRecord(config, record, 'succeeded', { resultDigest: hash(result), errorCode: null })
    } else if (!workerActive && record.state === 'cancel-requested' && existsSync(join(taskDirectory(config, taskId), 'cancel'))) {
      record = await saveTaskRecord(config, record, 'cancelled', { errorCode: 'cancelled' })
    } else if (!workerActive && (record.state === 'running' || Date.now() > Date.parse(record.deadlineAt) + 30_000)) {
      record = await saveTaskRecord(config, record, 'failed', { errorCode: 'worker-lost' })
    }
  }
  return { record, result }
}

async function launchTaskWorker(launch: A2AWorkerLaunch, taskId: string): Promise<void> {
  const child = spawn(launch.nodeBinary, [launch.agentPath, '--config', launch.configPath, 'task-worker'], {
    detached: process.platform !== 'win32',
    stdio: ['pipe', 'ignore', 'ignore'],
    shell: false,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  })
  child.stdin.on('error', () => undefined)
  child.stdin.end(JSON.stringify({ taskId }) + '\n')
  child.unref()
}

interface ProcessLock {
  path: string
  source: string
  token: string
  dev: number
  ino: number
}

interface ProcessLockSnapshot {
  source: string
  token: string | null
  dev: number
  ino: number
  mtimeMs: number
}

type ProcessLockObservation =
  | { state: 'missing' }
  | { state: 'active' }
  | { state: 'stale'; snapshot: ProcessLockSnapshot }

function processLockToken(source: string): string | null {
  try {
    const owner = JSON.parse(source) as { token?: unknown }
    return typeof owner.token === 'string' ? owner.token : null
  } catch {
    return null
  }
}

async function readProcessLockSnapshot(path: string): Promise<ProcessLockSnapshot | null> {
  let handle
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    const info = await handle.stat()
    if (!info.isFile()) throw new FleetA2ARuntimeError('unsafe-state-file', 'A2A lock must be a regular file')
    const source = await handle.readFile('utf8')
    return { source, token: processLockToken(source), dev: info.dev, ino: info.ino, mtimeMs: info.mtimeMs }
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
      throw new FleetA2ARuntimeError('unsafe-state-file', 'A2A lock must not be a symbolic link')
    }
    throw error
  } finally {
    await handle?.close()
  }
}

async function observeProcessLock(path: string): Promise<ProcessLockObservation> {
  const snapshot = await readProcessLockSnapshot(path)
  if (snapshot === null) return { state: 'missing' }
  try {
    const owner = JSON.parse(snapshot.source) as { pid?: unknown }
    if (typeof owner.pid === 'number' && Number.isSafeInteger(owner.pid) && owner.pid > 0 && snapshot.token !== null) {
      return await processAlive(owner.pid) ? { state: 'active' } : { state: 'stale', snapshot }
    }
  } catch {
    // A partially written lock is reaped only after a grace period below.
  }
  return Date.now() - snapshot.mtimeMs > 30_000 ? { state: 'stale', snapshot } : { state: 'active' }
}

function sameProcessLockIdentity(
  snapshot: Pick<ProcessLockSnapshot, 'source' | 'token' | 'dev' | 'ino'> | null,
  expected: Pick<ProcessLockSnapshot, 'source' | 'token' | 'dev' | 'ino'>,
): boolean {
  return snapshot !== null && snapshot.dev === expected.dev && snapshot.ino === expected.ino &&
    snapshot.source === expected.source && snapshot.token === expected.token
}

async function casUnlinkProcessLock(path: string, expected: ProcessLockSnapshot): Promise<boolean> {
  const claimPath = path + '.reap-' + hash(expected.source)
  try {
    await link(path, claimPath)
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || (error as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw error
  }
  try {
    const [claimed, current] = await Promise.all([
      readProcessLockSnapshot(claimPath),
      readProcessLockSnapshot(path),
    ])
    if (!sameProcessLockIdentity(claimed, expected) || !sameProcessLockIdentity(current, expected)) return false
    await rm(path)
    return true
  } finally {
    await rm(claimPath, { force: true })
  }
}

async function reclaimStaleProcessLock(
  path: string,
  observation: Extract<ProcessLockObservation, { state: 'stale' }>,
  hooks?: A2ARuntimeLockHooks,
): Promise<boolean> {
  await hooks?.beforeStaleLockClaim?.(path)
  return casUnlinkProcessLock(path, observation.snapshot)
}

async function createProcessLock(path: string, fields: Record<string, unknown> = {}): Promise<ProcessLock | null> {
  const token = randomUUID()
  let handle
  let createdLock: ProcessLock | undefined
  try {
    handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)
    const info = await handle.stat()
    const source = JSON.stringify({ ...fields, pid: process.pid, token, at: new Date().toISOString() }) + '\n'
    createdLock = { path, source, token, dev: info.dev, ino: info.ino }
    await handle.writeFile(source)
    await handle.sync()
    return createdLock
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return null
    if (createdLock !== undefined) {
      try {
        await releaseProcessLock(createdLock)
      } catch {
        // A partial or replaced pathname is left for the stale-lock CAS reaper.
      }
    }
    throw error
  } finally {
    await handle?.close()
  }
}

async function acquireProcessLock(
  path: string,
  busyCode: string,
  busyMessage: string,
  hooks?: A2ARuntimeLockHooks,
): Promise<ProcessLock> {
  await ensureDirectory(dirname(path))
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const created = await createProcessLock(path)
    if (created !== null) return created
    const observation = await observeProcessLock(path)
    if (observation.state === 'missing') continue
    if (observation.state === 'active') throw new FleetA2ARuntimeError(busyCode, busyMessage)
    if (!await reclaimStaleProcessLock(path, observation, hooks)) {
      const current = await observeProcessLock(path)
      if (current.state === 'active') throw new FleetA2ARuntimeError(busyCode, busyMessage)
    }
  }
  throw new FleetA2ARuntimeError(busyCode, busyMessage)
}

async function releaseProcessLock(lock: ProcessLock): Promise<void> {
  try {
    const snapshot = await readProcessLockSnapshot(lock.path)
    if (snapshot === null || !sameProcessLockIdentity(snapshot, lock)) return
    await casUnlinkProcessLock(lock.path, snapshot)
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

async function processLockActive(path: string): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const observation = await observeProcessLock(path)
    if (observation.state === 'missing') return false
    if (observation.state === 'active') return true
    if (await reclaimStaleProcessLock(path, observation)) return false
  }
  return true
}

function taskMatchesEnvelope(
  record: FleetTaskRecord,
  envelope: FleetA2AEnvelope,
  payload: FleetTaskSubmitPayload,
): boolean {
  if (record.schemaVersion !== 3 || record.workspacePath === null || record.executionProfileHash === null || record.taskBindingDigest === null) return false
  let binding: string
  try {
    binding = createTaskBindingDigest({
      teamId: envelope.teamId,
      submitMessageId: envelope.messageId,
      submitPayloadDigest: envelope.payloadDigest,
      sender: envelope.sender,
      recipientDeviceId: envelope.recipient.deviceId,
      taskId: payload.taskId,
      workspaceId: payload.workspaceId,
      workspacePath: record.workspacePath,
      profile: payload.profile,
      executionProfileHash: payload.executionProfileHash,
      manifestDigest: payload.manifestDigest,
      releaseDigest: payload.releaseDigest,
      policyId: payload.policyId,
      policyDigest: payload.policyDigest,
      deadline: payload.deadline,
    })
  } catch {
    return false
  }
  return record.promptDigest === hash(payload.prompt) && record.senderDeviceId === envelope.sender.deviceId &&
    record.senderPrincipalId === envelope.sender.principalId && record.senderKeyId === envelope.sender.keyId &&
    record.workspaceId === payload.workspaceId && record.profile === payload.profile &&
    record.executionProfileHash === payload.executionProfileHash &&
    record.manifestDigest === payload.manifestDigest && record.releaseDigest === payload.releaseDigest &&
    record.policyId === payload.policyId && record.policyDigest === payload.policyDigest &&
    record.deadlineAt === payload.deadline && record.taskBindingDigest === binding
}

async function taskWorkspace(config: A2AReadyFleetAgentConfig, workspaceId: string): Promise<string> {
  const configured = config.tasks.workspaces[workspaceId]
  if (configured === undefined) throw new FleetA2ARuntimeError('task-policy-denied', 'task workspace is not allowed by local policy')
  const info = await lstat(configured).catch(() => undefined)
  if (info === undefined || info.isSymbolicLink() || !info.isDirectory()) {
    throw new FleetA2ARuntimeError('task-policy-denied', 'task workspace must be an existing real directory')
  }
  return realpath(configured)
}

async function assertTaskReleaseBinding(
  config: A2AReadyFleetAgentConfig,
  manifestDigest: string,
  releaseDigest: string,
): Promise<void> {
  const liveManifest = await readRegularFile(config.manifestPath)
  if (hash(liveManifest) !== manifestDigest) {
    throw new FleetA2ARuntimeError('task-release-mismatch', 'task manifest does not match the active profile manifest')
  }
  const applied = await readAppliedRelease(config)
  if (applied === null || applied.releaseDigest !== releaseDigest) {
    throw new FleetA2ARuntimeError('task-release-mismatch', 'task release does not match the active applied release')
  }
}

async function assertTaskExecutionProfile(
  config: A2AReadyFleetAgentConfig,
  profile: string,
  executionProfileHash: string,
): Promise<void> {
  try {
    await assertExecutionProfileHash(config.dshHome, profile, executionProfileHash)
  } catch {
    throw new FleetA2ARuntimeError(
      'task-execution-profile-mismatch',
      'task execution profile no longer matches its signed profile hash',
    )
  }
}

function taskPolicy(
  config: A2AReadyFleetAgentConfig,
  policyId: string,
  policyDigest: string,
): CanonicalTaskPolicy {
  try {
    return resolveTaskPolicy(config.tasks, policyId, policyDigest)
  } catch {
    throw new FleetA2ARuntimeError('task-policy-denied', 'task policy is not installed, enabled, or digest-matched locally')
  }
}

function assertTaskOwner(record: FleetTaskRecord, envelope: FleetA2AEnvelope): void {
  if ((record.schemaVersion !== 2 && record.schemaVersion !== 3) || record.senderKeyId === null) {
    throw new FleetA2ARuntimeError('legacy-task-owner-unbound', 'legacy tasks cannot be controlled through the signed task channel')
  }
  if (record.senderDeviceId !== envelope.sender.deviceId ||
      record.senderPrincipalId !== envelope.sender.principalId ||
      record.senderKeyId !== envelope.sender.keyId) {
    throw new FleetA2ARuntimeError('task-owner-mismatch', 'the signed caller does not own this task')
  }
}

function assertBoundTaskState(record: FleetTaskRecord, request: FleetTaskRequest): asserts record is FleetTaskRecord & {
  schemaVersion: 3
  senderKeyId: string
  workspacePath: string
  executionProfileHash: string
  manifestDigest: string
  releaseDigest: string
  policyId: string
  policyDigest: string
  taskBindingDigest: string
} {
  if (record.schemaVersion !== 3 || request.schemaVersion !== 3 || record.senderKeyId === null ||
      record.workspacePath === null || record.manifestDigest === null || record.releaseDigest === null ||
      record.executionProfileHash === null || record.policyId === null || record.policyDigest === null || record.taskBindingDigest === null ||
      request.senderKeyId !== record.senderKeyId || request.workspacePath !== record.workspacePath ||
      request.executionProfileHash !== record.executionProfileHash ||
      request.manifestDigest !== record.manifestDigest || request.releaseDigest !== record.releaseDigest ||
      request.policyId !== record.policyId || request.policyDigest !== record.policyDigest ||
      request.taskBindingDigest !== record.taskBindingDigest || request.deadline !== record.deadlineAt) {
    throw new FleetA2ARuntimeError('task-binding-invalid', 'task execution requires an intact schema-v3 release, profile and policy binding')
  }
}

async function assertExecutableTaskBinding(
  config: A2AReadyFleetAgentConfig,
  record: FleetTaskRecord,
  request: FleetTaskRequest,
): Promise<{ workspacePath: string; policy: CanonicalTaskPolicy }> {
  assertBoundTaskState(record, request)
  if (request.requestMessageId !== record.requestMessageId || request.senderDeviceId !== record.senderDeviceId ||
      request.senderPrincipalId !== record.senderPrincipalId || request.workspaceId !== record.workspaceId ||
      request.profile !== record.profile || request.promptDigest !== record.promptDigest) {
    throw new FleetA2ARuntimeError('task-request-mismatch', 'task request does not match its durable record')
  }
  if (Date.now() >= Date.parse(record.deadlineAt)) {
    throw new FleetA2ARuntimeError('task-timeout', 'task deadline has expired')
  }
  await assertTaskReleaseBinding(config, record.manifestDigest, record.releaseDigest)
  await assertTaskExecutionProfile(config, record.profile, record.executionProfileHash)
  const policy = taskPolicy(config, record.policyId, record.policyDigest)
  const workspacePath = await taskWorkspace(config, record.workspaceId)
  if (workspacePath !== record.workspacePath) {
    throw new FleetA2ARuntimeError('task-policy-denied', 'task workspace binding changed after acceptance')
  }
  return { workspacePath, policy }
}

async function acceptTask(
  config: A2AReadyFleetAgentConfig,
  envelope: FleetA2AEnvelope,
  launch: A2AWorkerLaunch,
): Promise<FleetTaskRecord> {
  if (!config.tasks.enabled) throw new FleetA2ARuntimeError('tasks-disabled', 'remote tasks are disabled on this device')
  const payload = envelope.payload as FleetTaskSubmitPayload
  if (!config.tasks.profiles.includes(payload.profile)) {
    throw new FleetA2ARuntimeError('task-policy-denied', 'task workspace or profile is not allowed by local policy')
  }
  const deadline = Date.parse(payload.deadline)
  if (deadline <= Date.now() || deadline > Date.parse(envelope.issuedAt) + config.tasks.timeoutMs) {
    throw new FleetA2ARuntimeError('task-policy-denied', 'task deadline is expired or exceeds the local task timeout')
  }
  await assertTaskReleaseBinding(config, payload.manifestDigest, payload.releaseDigest)
  await assertTaskExecutionProfile(config, payload.profile, payload.executionProfileHash)
  taskPolicy(config, payload.policyId, payload.policyDigest)
  const workspacePath = await taskWorkspace(config, payload.workspaceId)
  const taskBindingDigest = createTaskBindingDigest({
    teamId: envelope.teamId,
    submitMessageId: envelope.messageId,
    submitPayloadDigest: envelope.payloadDigest,
    sender: envelope.sender,
    recipientDeviceId: config.deviceId,
    taskId: payload.taskId,
    workspaceId: payload.workspaceId,
    workspacePath,
    profile: payload.profile,
    executionProfileHash: payload.executionProfileHash,
    manifestDigest: payload.manifestDigest,
    releaseDigest: payload.releaseDigest,
    policyId: payload.policyId,
    policyDigest: payload.policyDigest,
    deadline: payload.deadline,
  })
  const directory = taskDirectory(config, payload.taskId)
  const promptDigest = hash(payload.prompt)
  await ensureDirectory(directory)
  let creationLock: ProcessLock
  try {
    creationLock = await acquireProcessLock(join(directory, 'create.lock'), 'task-in-progress', 'task creation is already in progress')
  } catch (error: unknown) {
    if ((error as { code?: unknown }).code !== 'task-in-progress') throw error
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const existing = await readTaskRecord(config, payload.taskId)
      if (existing !== null) {
        if (!taskMatchesEnvelope(existing, envelope, payload)) {
          throw new FleetA2ARuntimeError('task-id-conflict', 'task id is already bound to a different request')
        }
        return existing
      }
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    throw error
  }
  try {
    const existing = await readTaskRecord(config, payload.taskId)
    if (existing !== null) {
      if (!taskMatchesEnvelope(existing, envelope, payload)) {
        throw new FleetA2ARuntimeError('task-id-conflict', 'task id is already bound to a different request')
      }
      return existing
    }
    const storedRequest = await readTaskRequest(config, payload.taskId)
    if (storedRequest !== null && (storedRequest.schemaVersion !== 3 || storedRequest.promptDigest !== promptDigest ||
        storedRequest.prompt !== payload.prompt || storedRequest.senderDeviceId !== envelope.sender.deviceId ||
        storedRequest.senderPrincipalId !== envelope.sender.principalId || storedRequest.senderKeyId !== envelope.sender.keyId ||
        storedRequest.workspaceId !== payload.workspaceId || storedRequest.workspacePath !== workspacePath ||
        storedRequest.profile !== payload.profile || storedRequest.executionProfileHash !== payload.executionProfileHash ||
        storedRequest.manifestDigest !== payload.manifestDigest ||
        storedRequest.releaseDigest !== payload.releaseDigest || storedRequest.policyId !== payload.policyId ||
        storedRequest.policyDigest !== payload.policyDigest || storedRequest.taskBindingDigest !== taskBindingDigest ||
        storedRequest.deadline !== payload.deadline)) {
      throw new FleetA2ARuntimeError('task-id-conflict', 'task id is already bound to a different request')
    }
    const request: FleetTaskRequest = storedRequest ?? {
      schemaVersion: 3,
      taskId: payload.taskId,
      requestMessageId: envelope.messageId,
      senderDeviceId: envelope.sender.deviceId,
      senderPrincipalId: envelope.sender.principalId,
      senderKeyId: envelope.sender.keyId,
      workspaceId: payload.workspaceId,
      workspacePath,
      profile: payload.profile,
      executionProfileHash: payload.executionProfileHash,
      promptDigest,
      manifestDigest: payload.manifestDigest,
      releaseDigest: payload.releaseDigest,
      policyId: payload.policyId,
      policyDigest: payload.policyDigest,
      taskBindingDigest,
      deadline: payload.deadline,
      prompt: payload.prompt,
    }
    if (storedRequest === null) await atomicJson(join(directory, 'request.json'), request)
    const createdAt = new Date().toISOString()
    const record: FleetTaskRecord = {
      schemaVersion: 3,
      taskId: payload.taskId,
      requestMessageId: request.requestMessageId,
      senderDeviceId: request.senderDeviceId,
      senderPrincipalId: request.senderPrincipalId,
      senderKeyId: envelope.sender.keyId,
      workspaceId: request.workspaceId,
      workspacePath,
      profile: request.profile,
      executionProfileHash: payload.executionProfileHash,
      promptDigest: request.promptDigest,
      manifestDigest: payload.manifestDigest,
      releaseDigest: payload.releaseDigest,
      policyId: payload.policyId,
      policyDigest: payload.policyDigest,
      taskBindingDigest,
      state: 'accepted',
      createdAt,
      updatedAt: createdAt,
      deadlineAt: payload.deadline,
      resultDigest: null,
      errorCode: null,
    }
    await atomicJson(join(directory, 'record.json'), record)
    await launchTaskWorker(launch, payload.taskId)
    return record
  } finally {
    await releaseProcessLock(creationLock)
  }
}

async function approvalDirectories(config: FleetAgentConfig, taskId: string): Promise<string[]> {
  const root = join(taskDirectory(config, taskId), 'approvals')
  let info
  try {
    info = await lstat(root)
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 ||
      (typeof process.getuid === 'function' && info.uid !== process.getuid())) {
    throw new FleetA2ARuntimeError('unsafe-state-permissions', 'task approval state must be an owner-only real directory')
  }
  return (await readdir(root, { withFileTypes: true }))
    .flatMap(entry => entry.isDirectory() && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(entry.name)
      ? [join(root, entry.name)]
      : [])
    .sort()
}

async function readApprovalIntent(path: string): Promise<FleetTaskApprovalIntent> {
  try {
    return parseTaskApprovalIntent(JSON.parse(await readRegularFile(path, true)) as unknown)
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw error
    if (error instanceof FleetA2ARuntimeError) throw error
    throw new FleetA2ARuntimeError('task-approval-state-invalid', 'task approval intent is invalid')
  }
}

async function validatePendingApproval(
  config: A2AReadyFleetAgentConfig,
  record: FleetTaskRecord & {
    schemaVersion: 3
    workspacePath: string
    executionProfileHash: string
    policyId: string
    policyDigest: string
    taskBindingDigest: string
  },
  policy: CanonicalTaskPolicy,
  intent: FleetTaskApprovalIntent,
): Promise<void> {
  if (intent.taskId !== record.taskId || intent.taskBindingDigest !== record.taskBindingDigest ||
      intent.executionProfileHash !== record.executionProfileHash) {
    throw new FleetA2ARuntimeError('task-approval-state-invalid', 'task approval intent is bound to another task')
  }
  await assertTaskExecutionProfile(config, record.profile, record.executionProfileHash)
  const classification = classifyTaskToolCall({
    policy,
    workspacePath: record.workspacePath,
    toolName: intent.toolName,
    arguments: intent.arguments,
  })
  if (classification.decision !== 'ask' || classification.capability !== intent.capability ||
      classification.argumentsDigest !== intent.argumentsDigest) {
    throw new FleetA2ARuntimeError('task-approval-state-invalid', 'task approval intent no longer matches local policy')
  }
  if (!await validateTaskToolFilesystemScope({
    workspacePath: record.workspacePath,
    toolName: intent.toolName,
    arguments: intent.arguments,
  })) {
    throw new FleetA2ARuntimeError('task-approval-state-invalid', 'task approval intent resolves outside the workspace boundary')
  }
}

async function verifyCachedApprovalRequest(
  config: A2AReadyFleetAgentConfig,
  record: FleetTaskRecord,
  value: unknown,
  now: Date,
): Promise<FleetA2AEnvelope> {
  const privatePem = await privateKeyPem(config)
  const publicPem = createPublicKey(privatePem).export({ type: 'spki', format: 'pem' }).toString()
  const keyId = a2aKeyId(publicPem)
  const envelope = verifyA2AEnvelope(value, {
    expectedTeamId: config.a2a.teamId,
    expectedDeviceId: record.senderDeviceId,
    trust: new Map([[keyId, {
      teamId: config.a2a.teamId,
      keyId,
      principalId: config.a2a.principalId,
      deviceId: config.deviceId,
      publicKeyPem: publicPem,
      allowedKinds: ['task.approval.request'] as FleetA2AKind[],
    }]]),
    now,
    maxTtlMs: config.a2a.maxMessageTtlMs,
  })
  if (envelope.kind !== 'task.approval.request') {
    throw new FleetA2ARuntimeError('task-approval-state-invalid', 'cached task approval request has the wrong kind')
  }
  return envelope
}

async function approvalRequestEnvelope(
  config: A2AReadyFleetAgentConfig,
  record: FleetTaskRecord & {
    schemaVersion: 3
    workspacePath: string
    executionProfileHash: string
    policyId: string
    policyDigest: string
    taskBindingDigest: string
  },
  approvalDirectory: string,
  intent: FleetTaskApprovalIntent,
  now: Date,
): Promise<FleetA2AEnvelope> {
  const path = join(approvalDirectory, 'request-envelope.json')
  try {
    return await verifyCachedApprovalRequest(config, record, JSON.parse(await readRegularFile(path, true)) as unknown, now)
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const lock = await acquireProcessLock(path + '.lock', 'task-approval-in-progress', 'task approval request is being prepared')
  try {
    try {
      return await verifyCachedApprovalRequest(config, record, JSON.parse(await readRegularFile(path, true)) as unknown, now)
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const payload: FleetTaskApprovalRequestPayload = {
      approvalId: intent.approvalId,
      taskId: record.taskId,
      taskBindingDigest: record.taskBindingDigest,
      toolCallId: intent.toolCallId,
      toolName: intent.toolName,
      arguments: intent.arguments,
      argumentsDigest: intent.argumentsDigest,
      capability: intent.capability,
      summary: `${intent.toolName} requests one ${intent.capability} execution`,
      expiresAt: intent.expiresAt,
    }
    validateA2APayload('task.approval.request', payload)
    const envelope = await signA2AMessage(config, record.senderDeviceId, 'task.approval.request', payload, now)
    await atomicJson(path, envelope)
    return envelope
  } finally {
    await releaseProcessLock(lock)
  }
}

async function pendingApprovalResponse(
  config: A2AReadyFleetAgentConfig,
  record: FleetTaskRecord,
  now: Date,
): Promise<FleetA2AEnvelope | null> {
  if (record.schemaVersion !== 3 || record.workspacePath === null || record.executionProfileHash === null ||
      record.policyId === null || record.policyDigest === null || record.taskBindingDigest === null) return null
  const bound = record as FleetTaskRecord & {
    schemaVersion: 3
    workspacePath: string
    executionProfileHash: string
    policyId: string
    policyDigest: string
    taskBindingDigest: string
  }
  const policy = taskPolicy(config, bound.policyId, bound.policyDigest)
  for (const directory of await approvalDirectories(config, record.taskId)) {
    if (existsSync(join(directory, 'decision.json')) || existsSync(join(directory, 'consumed.json'))) continue
    const intent = await readApprovalIntent(join(directory, 'intent.json'))
    if (Date.parse(intent.expiresAt) <= now.getTime()) continue
    await validatePendingApproval(config, bound, policy, intent)
    return approvalRequestEnvelope(config, bound, directory, intent, now)
  }
  return null
}

async function acceptApprovalDecision(
  config: A2AReadyFleetAgentConfig,
  envelope: FleetA2AEnvelope,
  now: Date,
): Promise<void> {
  const payload = envelope.payload as FleetTaskApprovalDecisionPayload
  const record = await readTaskRecord(config, payload.taskId)
  if (record === null) throw new FleetA2ARuntimeError('task-not-found', 'task was not found')
  assertTaskOwner(record, envelope)
  if (record.schemaVersion !== 3 || record.workspacePath === null || record.executionProfileHash === null ||
      record.policyId === null || record.policyDigest === null || record.taskBindingDigest === null ||
      record.taskBindingDigest !== payload.taskBindingDigest) {
    throw new FleetA2ARuntimeError('task-binding-invalid', 'approval decision does not match an executable task')
  }
  if (record.state === 'succeeded' || record.state === 'failed' || record.state === 'cancelled') {
    throw new FleetA2ARuntimeError('task-not-active', 'approval decisions are accepted only for active tasks')
  }
  const directory = join(taskDirectory(config, payload.taskId), 'approvals', approvalSegment(payload.approvalId))
  const intent = await readApprovalIntent(join(directory, 'intent.json'))
  await validatePendingApproval(config, record as typeof record & {
    schemaVersion: 3
    workspacePath: string
    executionProfileHash: string
    policyId: string
    policyDigest: string
    taskBindingDigest: string
  }, taskPolicy(config, record.policyId, record.policyDigest), intent)
  const request = await verifyCachedApprovalRequest(
    config,
    record,
    JSON.parse(await readRegularFile(join(directory, 'request-envelope.json'), true)) as unknown,
    now,
  )
  const requestPayload = request.payload as FleetTaskApprovalRequestPayload
  if (payload.approvalId !== intent.approvalId || payload.approvalRequestMessageId !== request.messageId ||
      payload.approvalRequestPayloadDigest !== request.payloadDigest || payload.toolCallId !== intent.toolCallId ||
      payload.argumentsDigest !== intent.argumentsDigest || requestPayload.approvalId !== intent.approvalId ||
      requestPayload.taskBindingDigest !== record.taskBindingDigest) {
    throw new FleetA2ARuntimeError('task-approval-mismatch', 'approval decision does not match the signed approval request')
  }
  const decidedAt = Date.parse(payload.decidedAt)
  if (decidedAt < Date.parse(request.issuedAt) || decidedAt > now.getTime() + 30_000 ||
      decidedAt >= Date.parse(intent.expiresAt)) {
    throw new FleetA2ARuntimeError('task-approval-expired', 'approval decision is outside the signed approval window')
  }
  const token = payload.decision === 'allowed-once' ? createAllowedOnceToken({
    approvalId: payload.approvalId,
    approvalRequestMessageId: request.messageId,
    approvalRequestPayloadDigest: request.payloadDigest,
    decisionMessageId: envelope.messageId,
    decisionPayloadDigest: envelope.payloadDigest,
    taskBindingDigest: record.taskBindingDigest,
    executionProfileHash: record.executionProfileHash,
    toolCallId: intent.toolCallId,
    toolName: intent.toolName,
    argumentsDigest: intent.argumentsDigest,
    expiresAt: intent.expiresAt,
  }) : null
  const decision: FleetTaskApprovalDecisionFile = {
    schemaVersion: TASK_APPROVAL_DECISION_SCHEMA_VERSION,
    decision: payload.decision,
    decisionEnvelope: envelope,
    token,
  }
  const lock = await acquireProcessLock(join(directory, 'decision.lock'), 'task-approval-in-progress', 'task approval decision is being recorded')
  try {
    if (existsSync(join(directory, 'decision.json'))) {
      const existing = JSON.parse(await readRegularFile(join(directory, 'decision.json'), true)) as unknown
      if (sha256Canonical(existing) === sha256Canonical(decision)) return
      throw new FleetA2ARuntimeError('task-approval-already-decided', 'the first signed approval decision is final')
    }
    await exclusiveJson(join(directory, 'decision.json'), decision)
  } finally {
    await releaseProcessLock(lock)
  }
}

async function requestCancellation(config: FleetAgentConfig, envelope: FleetA2AEnvelope): Promise<FleetTaskRecord> {
  const taskId = envelope.payload.taskId as string
  const record = await readTaskRecord(config, taskId)
  if (record === null) throw new FleetA2ARuntimeError('task-not-found', 'task was not found')
  assertTaskOwner(record, envelope)
  if (record.state === 'succeeded' || record.state === 'failed' || record.state === 'cancelled') return record
  const marker = join(taskDirectory(config, taskId), 'cancel')
  let handle
  try {
    handle = await open(marker, 'wx', 0o600)
    await handle.writeFile(new Date().toISOString() + '\n')
    await handle.sync()
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  } finally {
    await handle?.close()
  }
  return saveTaskRecord(config, record, 'cancel-requested')
}

async function receiptResponse(
  config: A2AReadyFleetAgentConfig,
  envelope: FleetA2AEnvelope,
  launch: A2AWorkerLaunch,
  now: Date,
): Promise<FleetA2AEnvelope> {
  let response: { kind: FleetA2AKind; payload: Record<string, unknown> }
  if (envelope.teamId !== config.a2a.teamId) {
    const received = await receiveFederationEnvelope({
      rootDirectory: join(config.stateDir, 'federation'),
      value: envelope,
      verification: {
        expectedTeamId: config.a2a.teamId,
        expectedDeviceId: config.deviceId,
        trust: await readA2ATrustStore(config),
        now,
        maxTtlMs: config.a2a.maxMessageTtlMs,
      },
      receivedAt: now,
    })
    response = { kind: 'receipt', payload: federationReceiptPayload(received.record) }
  } else if (envelope.kind === 'task.submit') {
    const record = await acceptTask(config, envelope, launch)
    response = workerPayload(record, null)
  } else if (envelope.kind === 'task.status') {
    const taskId = envelope.payload.taskId as string
    const ownerRecord = await readTaskRecord(config, taskId)
    if (ownerRecord === null) throw new FleetA2ARuntimeError('task-not-found', 'task was not found')
    assertTaskOwner(ownerRecord, envelope)
    const approval = await pendingApprovalResponse(config, ownerRecord, now)
    if (approval !== null) return approval
    const { record, result } = await taskResult(config, taskId)
    response = workerPayload(record, result)
  } else if (envelope.kind === 'task.cancel') {
    const record = await requestCancellation(config, envelope)
    response = workerPayload(record, null)
  } else if (envelope.kind === 'task.approval.decision') {
    await acceptApprovalDecision(config, envelope, now)
    response = { kind: 'receipt', payload: { requestMessageId: envelope.messageId, status: 'accepted' } }
  } else {
    const inboxPath = join(config.stateDir, 'a2a', 'inbox', hash(envelope.messageId) + '.json')
    await atomicJson(inboxPath, envelope)
    response = { kind: 'receipt', payload: { requestMessageId: envelope.messageId, status: envelope.kind === 'handoff' ? 'stored' : 'accepted' } }
  }
  return createA2AEnvelope({
    teamId: config.a2a.teamId,
    sender: { principalId: config.a2a.principalId, deviceId: config.deviceId },
    recipient: { teamId: envelope.teamId, deviceId: envelope.sender.deviceId },
    kind: response.kind,
    payload: response.payload,
    privateKey: await privateKeyPem(config),
    now,
    ttlMs: messageTtlMs(config, response.kind, response.payload, now, envelope.teamId !== config.a2a.teamId),
  })
}

export async function receiveA2AMessage(
  config: FleetAgentConfig,
  value: unknown,
  launch: A2AWorkerLaunch,
  now = new Date(),
  lockHooks?: A2ARuntimeLockHooks,
): Promise<FleetA2AReceipt> {
  assertA2AReadyConfig(config)
  const envelope = await verifyA2AMessage(config, value, now)
  const receiptPath = join(config.stateDir, 'a2a', 'receipts', hash(envelope.messageId) + '.json')
  const lockPath = receiptPath + '.lock'
  try {
    return readStoredReceipt(JSON.parse(await readRegularFile(receiptPath)) as unknown, envelope)
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  let lock: ProcessLock
  try {
    lock = await acquireProcessLock(lockPath, 'message-in-progress', 'A2A message is already being processed', lockHooks)
  } catch (error: unknown) {
    if ((error as { code?: unknown }).code !== 'message-in-progress') throw error
    for (let attempt = 0; attempt < 80; attempt += 1) {
      try {
        return readStoredReceipt(JSON.parse(await readRegularFile(receiptPath)) as unknown, envelope)
      } catch (readError: unknown) {
        if ((readError as NodeJS.ErrnoException).code !== 'ENOENT') throw readError
      }
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    throw error
  }
  try {
    try {
      return readStoredReceipt(JSON.parse(await readRegularFile(receiptPath)) as unknown, envelope)
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const response = await receiptResponse(config, envelope, launch, now)
    const receipt = { requestMessageId: envelope.messageId, response }
    await atomicJson(receiptPath, storedReceipt(envelope, receipt))
    return receipt
  } finally {
    await releaseProcessLock(lock)
  }
}

interface TaskProcessResult {
  stdout: string
  code: number
  reason?: 'cancelled' | 'timeout' | 'output-limit'
}

function taskEnvironment(
  config: FleetAgentConfig,
  input: { permissionMode: CanonicalTaskPolicy['permissionMode']; contextPath: string },
): NodeJS.ProcessEnv {
  const path = [dirname(config.dshBinary), dirname(process.execPath), '/opt/homebrew/bin', '/usr/bin', '/bin'].join(':')
  const env: NodeJS.ProcessEnv = {
    DSH_HOME: config.dshHome,
    DSH_PERMISSION_MODE: input.permissionMode,
    DSH_FLEET_TASK_CONTEXT: input.contextPath,
    PATH: path,
    GIT_TERMINAL_PROMPT: '0',
  }
  for (const key of ['HOME', 'USER', 'LOGNAME', 'TMPDIR', 'LANG', 'LC_ALL', 'SHELL', 'TERM']) {
    if (process.env[key] !== undefined) env[key] = process.env[key]
  }
  return env
}

async function runTaskProcess(
  config: A2AReadyFleetAgentConfig,
  record: FleetTaskRecord,
  request: FleetTaskRequest,
  cancelPath: string,
  workerBundlePath: string,
): Promise<TaskProcessResult> {
  const { workspacePath, policy } = await assertExecutableTaskBinding(config, record, request)
  if (!isAbsolute(workerBundlePath) || normalize(workerBundlePath) !== workerBundlePath || /[\r\n\0]/.test(workerBundlePath)) {
    throw new FleetA2ARuntimeError('worker-bundle-invalid', 'task worker bundle path must be a normalized absolute path')
  }
  const workerInfo = await lstat(workerBundlePath).catch(() => undefined)
  if (workerInfo === undefined || workerInfo.isSymbolicLink() || !workerInfo.isFile() ||
      (typeof process.getuid === 'function' && workerInfo.uid !== process.getuid())) {
    throw new FleetA2ARuntimeError('worker-bundle-invalid', 'task worker bundle must be a real file owned by the current user')
  }
  const directory = taskDirectory(config, record.taskId)
  const contextPath = join(directory, 'worker-context.json')
  const approvalsDir = join(directory, 'approvals')
  const workerContext: FleetTaskWorkerContext = {
    schemaVersion: TASK_WORKER_CONTEXT_SCHEMA_VERSION,
    taskId: record.taskId,
    taskBindingDigest: record.taskBindingDigest!,
    dshHome: config.dshHome,
    profile: record.profile,
    executionProfileHash: record.executionProfileHash!,
    workspacePath,
    policy,
    approvalsDir,
    cancelPath,
    deadline: record.deadlineAt,
  }
  await atomicJson(contextPath, workerContext)
  const patchPath = join(directory, 'worker.patch.yml')
  await atomicText(patchPath, [
    '- update:',
    '    id: approval',
    '    config:',
    '      policy: "never"',
    '- insert:',
    '    - id: fleet-task-policy',
    `      name: ${JSON.stringify(workerBundlePath)}`,
    '',
  ].join('\n'))
  const timeoutMs = Math.min(config.tasks.timeoutMs, Date.parse(record.deadlineAt) - Date.now())
  if (timeoutMs <= 0) throw new FleetA2ARuntimeError('task-timeout', 'task deadline has expired')
  return new Promise((resolve, reject) => {
    const grouped = process.platform !== 'win32'
    const child = spawn(config.dshBinary, ['--profile', request.profile, '--patch', patchPath, request.prompt], {
      cwd: workspacePath,
      env: taskEnvironment(config, { permissionMode: policy.permissionMode, contextPath }),
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      detached: grouped,
    })
    let stdout = ''
    let bytes = 0
    let reason: TaskProcessResult['reason']
    let settled = false
    const kill = (signal: NodeJS.Signals) => {
      try {
        if (grouped && child.pid !== undefined) process.kill(-child.pid, signal)
        else child.kill(signal)
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
      }
    }
    const stop = (next: NonNullable<TaskProcessResult['reason']>) => {
      if (reason !== undefined || settled) return
      reason = next
      kill('SIGTERM')
      forceTimer = setTimeout(() => kill('SIGKILL'), 2000)
      forceTimer.unref()
    }
    const timeout = setTimeout(() => stop('timeout'), timeoutMs)
    timeout.unref()
    const cancel = setInterval(() => { if (existsSync(cancelPath)) stop('cancelled') }, 200)
    cancel.unref()
    let forceTimer: NodeJS.Timeout | undefined
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      const remaining = config.tasks.maxOutputBytes - bytes
      if (remaining > 0) stdout += Buffer.from(chunk).subarray(0, remaining).toString('utf8')
      bytes += Buffer.byteLength(chunk)
      if (bytes > config.tasks.maxOutputBytes) stop('output-limit')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes > config.tasks.maxOutputBytes) stop('output-limit')
    })
    child.once('error', error => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      clearInterval(cancel)
      if (forceTimer !== undefined) clearTimeout(forceTimer)
      reject(error)
    })
    child.once('close', code => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      clearInterval(cancel)
      if (forceTimer !== undefined) clearTimeout(forceTimer)
      resolve({ stdout, code: code ?? 1, ...(reason === undefined ? {} : { reason }) })
    })
  })
}

async function processAlive(pid: number): Promise<boolean> {
  try { process.kill(pid, 0); return true } catch (error: unknown) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

async function acquireTaskSlot(config: A2AReadyFleetAgentConfig, taskId: string): Promise<ProcessLock> {
  const directory = join(config.stateDir, 'tasks', '.slots')
  await ensureDirectory(directory)
  for (;;) {
    for (let index = 0; index < config.tasks.maxConcurrent; index += 1) {
      const path = join(directory, String(index) + '.lock')
      const created = await createProcessLock(path, { taskId })
      if (created !== null) return created
      const observation = await observeProcessLock(path)
      if (observation.state === 'stale') await reclaimStaleProcessLock(path, observation)
    }
    if (existsSync(join(taskDirectory(config, taskId), 'cancel'))) throw new FleetA2ARuntimeError('task-cancelled', 'task was cancelled while queued')
    await new Promise(resolve => setTimeout(resolve, 500))
  }
}

export async function runTaskWorker(
  config: FleetAgentConfig,
  taskId: string,
  workerBundlePath: string,
): Promise<FleetTaskRecord> {
  assertA2AReadyConfig(config)
  const directory = taskDirectory(config, taskId)
  const workerLock = join(directory, 'worker.lock')
  try {
    const existing = await readTaskRecord(config, taskId)
    if (existing === null) throw new FleetA2ARuntimeError('task-not-found', 'task was not found')
  } catch (error: unknown) {
    throw error
  }
  let worker: ProcessLock
  try {
    worker = await acquireProcessLock(workerLock, 'worker-in-progress', 'task worker is already running')
  } catch (error: unknown) {
    if ((error as { code?: unknown }).code === 'worker-in-progress') {
      const existing = await readTaskRecord(config, taskId)
      if (existing === null) throw new FleetA2ARuntimeError('task-not-found', 'task was not found')
      return existing
    }
    throw error
  }
  let slot: ProcessLock | undefined
  try {
    let record = await readTaskRecord(config, taskId)
    if (record === null) throw new FleetA2ARuntimeError('task-not-found', 'task was not found')
    if (['succeeded', 'failed', 'cancelled'].includes(record.state)) return record
    const request = await readTaskRequest(config, taskId)
    if (request === null) throw new FleetA2ARuntimeError('task-request-mismatch', 'task request is missing')
    await assertExecutableTaskBinding(config, record, request)
    const cancelPath = join(directory, 'cancel')
    if (existsSync(cancelPath)) return saveTaskRecord(config, record, 'cancelled', { errorCode: 'cancelled' })
    slot = await acquireTaskSlot(config, taskId)
    if (existsSync(cancelPath)) return saveTaskRecord(config, record, 'cancelled', { errorCode: 'cancelled' })
    record = await saveTaskRecord(config, record, 'running')
    const result = await runTaskProcess(config, record, request, cancelPath, workerBundlePath)
    if (result.reason === 'cancelled') return saveTaskRecord(config, record, 'cancelled', { errorCode: 'cancelled' })
    if (result.reason !== undefined) return saveTaskRecord(config, record, 'failed', { errorCode: result.reason })
    if (result.code !== 0) return saveTaskRecord(config, record, 'failed', { errorCode: 'dsh-task-failed' })
    await atomicText(join(directory, 'result.txt'), result.stdout)
    return saveTaskRecord(config, record, 'succeeded', { resultDigest: hash(result.stdout), errorCode: null })
  } catch (error: unknown) {
    const record = await readTaskRecord(config, taskId)
    if (record === null || ['succeeded', 'failed', 'cancelled'].includes(record.state)) throw error
    const code = typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : 'task-worker-failed'
    return saveTaskRecord(config, record, code === 'task-cancelled' ? 'cancelled' : 'failed', { errorCode: code })
  } finally {
    if (slot !== undefined) {
      try {
        await releaseProcessLock(slot)
      } catch {
        // A missing slot is already released; an altered slot belongs to another worker.
      }
    }
    await releaseProcessLock(worker)
  }
}

export async function resumeAcceptedTasks(config: FleetAgentConfig, launch: A2AWorkerLaunch): Promise<number> {
  assertA2AReadyConfig(config)
  if (!config.tasks.enabled) return 0
  const root = join(config.stateDir, 'tasks')
  let entries
  try { entries = await readdir(root, { withFileTypes: true }) } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0
    throw error
  }
  let resumed = 0
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[0-9a-f-]{36}$/.test(entry.name)) continue
    const taskId = 'task:' + entry.name
    const record = await readTaskRecord(config, taskId)
    if (record === null || !['accepted', 'running', 'cancel-requested'].includes(record.state)) continue
    const active = await processLockActive(join(taskDirectory(config, taskId), 'worker.lock'))
    if (active) continue
    if (record.state === 'accepted' && Date.now() < Date.parse(record.deadlineAt)) {
      const request = await readTaskRequest(config, taskId)
      if (request === null) {
        await saveTaskRecord(config, record, 'failed', { errorCode: 'task-request-mismatch' })
        continue
      }
      try {
        await assertExecutableTaskBinding(config, record, request)
        await launchTaskWorker(launch, taskId)
        resumed += 1
      } catch (error: unknown) {
        const code = typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : 'task-binding-invalid'
        await saveTaskRecord(config, record, 'failed', { errorCode: code })
      }
    } else {
      await taskResult(config, taskId)
    }
  }
  return resumed
}

export function safeA2ARuntimeError(error: unknown): { code: string; message: string } {
  const raw = typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : 'internal'
  const code = /^[a-z0-9-]+$/.test(raw) ? raw : 'internal'
  const messages: Record<string, string> = {
    'invalid-envelope': 'A2A envelope is invalid',
    'invalid-payload': 'A2A payload is invalid',
    'invalid-time': 'A2A message time window is invalid',
    'message-expired': 'A2A message has expired',
    'trust-denied': 'A2A sender is not trusted for this action',
    'signature-invalid': 'A2A signature is invalid',
    'recipient-mismatch': 'A2A message targets another device',
    'tasks-disabled': 'remote tasks are disabled on this device',
    'task-policy-denied': 'task workspace or profile is not allowed',
    'task-not-found': 'task was not found',
    'task-id-conflict': 'task id is already bound to a different request',
    'task-in-progress': 'task creation is already in progress',
    'invalid-task-state': 'durable task state is invalid',
    'message-in-progress': 'A2A message is already being processed',
    'message-id-conflict': 'A2A message id is bound to another signed request',
    'receipt-state-invalid': 'A2A receipt state is invalid',
    'unsafe-key-permissions': 'A2A private key permissions are unsafe',
    'unsafe-state-file': 'durable task state contains an unsafe file',
    'unsafe-state-permissions': 'durable task state permissions are unsafe',
  }
  return { code: Object.hasOwn(messages, code) ? code : 'internal', message: messages[code] ?? 'A2A request failed' }
}

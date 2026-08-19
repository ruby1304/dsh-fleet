import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { constants, existsSync } from 'node:fs'
import { lstat, mkdir, open, readdir, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  assertA2AReadyConfig,
  type A2AReadyFleetAgentConfig,
  type FleetAgentConfig,
} from '../agent/config.ts'
import {
  FLEET_A2A_KINDS,
  a2aKeyId,
  createA2AEnvelope,
  verifyA2AEnvelope,
  type FleetA2AEnvelope,
  type FleetA2AKind,
  type FleetA2ATrustEntry,
} from './protocol.ts'

export interface FleetA2ATrustStore {
  schemaVersion: 1
  teamId: string
  entries: FleetA2ATrustEntry[]
}

export type FleetTaskState = 'accepted' | 'running' | 'cancel-requested' | 'succeeded' | 'failed' | 'cancelled'

export interface FleetTaskRecord {
  schemaVersion: 1
  taskId: string
  requestMessageId: string
  senderDeviceId: string
  senderPrincipalId: string
  workspaceId: string
  profile: string
  promptDigest: string
  state: FleetTaskState
  createdAt: string
  updatedAt: string
  deadlineAt: string
  resultDigest: string | null
  errorCode: string | null
}

interface FleetTaskRequest {
  schemaVersion: 1
  taskId: string
  requestMessageId: string
  senderDeviceId: string
  senderPrincipalId: string
  workspaceId: string
  profile: string
  promptDigest: string
  prompt: string
}

export interface A2AWorkerLaunch {
  nodeBinary: string
  agentPath: string
  configPath: string
}

export interface FleetA2AReceipt {
  requestMessageId: string
  response: FleetA2AEnvelope
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

async function readRegularFile(path: string, privateFile = false): Promise<string> {
  let handle
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    const info = await handle.stat()
    if (!info.isFile()) throw new FleetA2ARuntimeError('unsafe-state-file', 'A2A state accepts regular files only')
    if (privateFile && (info.mode & 0o077) !== 0) {
      throw new FleetA2ARuntimeError('unsafe-key-permissions', 'A2A private key must not be accessible by group or others')
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
  if (raw.schemaVersion !== 1 || raw.teamId !== config.a2a.teamId || !Array.isArray(raw.entries)) {
    throw new FleetA2ARuntimeError('invalid-config', 'trust store schema or team identity is invalid')
  }
  const trust = new Map<string, FleetA2ATrustEntry>()
  for (let index = 0; index < raw.entries.length; index += 1) {
    const entry = raw.entries[index]
    exactKeys(entry, ['keyId', 'principalId', 'deviceId', 'publicKeyPem', 'allowedKinds'], `trust store entries[${index}]`)
    if (typeof entry.keyId !== 'string' || typeof entry.principalId !== 'string' || typeof entry.deviceId !== 'string' ||
        typeof entry.publicKeyPem !== 'string' || !Array.isArray(entry.allowedKinds) ||
        entry.allowedKinds.some(kind => typeof kind !== 'string' || !FLEET_A2A_KINDS.includes(kind as FleetA2AKind))) {
      throw new FleetA2ARuntimeError('invalid-config', 'trust store entry is invalid')
    }
    if (!/^ed25519:[0-9a-f]{64}$/.test(entry.keyId) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(entry.principalId) ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(entry.deviceId) || new Set(entry.allowedKinds).size !== entry.allowedKinds.length) {
      throw new FleetA2ARuntimeError('invalid-config', 'trust store entry identity or capabilities are invalid')
    }
    try {
      if (a2aKeyId(entry.publicKeyPem) !== entry.keyId) throw new Error('key mismatch')
    } catch {
      throw new FleetA2ARuntimeError('invalid-config', 'trust store entry key identity is invalid')
    }
    if (trust.has(entry.keyId)) throw new FleetA2ARuntimeError('invalid-config', 'trust store key ids must be unique')
    trust.set(entry.keyId, entry as unknown as FleetA2ATrustEntry)
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
): Promise<FleetA2AEnvelope> {
  assertA2AReadyConfig(config)
  return createA2AEnvelope({
    teamId: config.a2a.teamId,
    sender: { principalId: config.a2a.principalId, deviceId: config.deviceId },
    recipient: { deviceId: recipientDeviceId },
    kind,
    payload,
    privateKey: await privateKeyPem(config),
    now,
    ttlMs: Math.min(5 * 60 * 1000, config.a2a.maxMessageTtlMs),
  })
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
  const raw = stateRecord(value, [
    'schemaVersion', 'taskId', 'requestMessageId', 'senderDeviceId', 'senderPrincipalId', 'workspaceId', 'profile',
    'promptDigest', 'state', 'createdAt', 'updatedAt', 'deadlineAt', 'resultDigest', 'errorCode',
  ], 'task record')
  const taskId = stateText(raw.taskId, 'task record.taskId')
  taskSegment(taskId)
  const state = stateText(raw.state, 'task record.state', 24) as FleetTaskState
  if (raw.schemaVersion !== 1 || taskId !== expectedTaskId || !TASK_STATES.has(state)) {
    throw new FleetA2ARuntimeError('invalid-task-state', 'task record identity, schema or state is invalid')
  }
  const errorCode = raw.errorCode === null ? null : stateText(raw.errorCode, 'task record.errorCode', 64)
  return {
    schemaVersion: 1,
    taskId,
    requestMessageId: stateText(raw.requestMessageId, 'task record.requestMessageId', 64),
    senderDeviceId: stateText(raw.senderDeviceId, 'task record.senderDeviceId', 64),
    senderPrincipalId: stateText(raw.senderPrincipalId, 'task record.senderPrincipalId', 64),
    workspaceId: stateText(raw.workspaceId, 'task record.workspaceId', 64),
    profile: stateText(raw.profile, 'task record.profile', 64),
    promptDigest: stateDigest(raw.promptDigest, 'task record.promptDigest')!,
    state,
    createdAt: stateTime(raw.createdAt, 'task record.createdAt'),
    updatedAt: stateTime(raw.updatedAt, 'task record.updatedAt'),
    deadlineAt: stateTime(raw.deadlineAt, 'task record.deadlineAt'),
    resultDigest: stateDigest(raw.resultDigest, 'task record.resultDigest', true),
    errorCode,
  }
}

function parseTaskRequest(value: unknown, expectedTaskId: string): FleetTaskRequest {
  const raw = stateRecord(value, [
    'schemaVersion', 'taskId', 'requestMessageId', 'senderDeviceId', 'senderPrincipalId', 'workspaceId', 'profile', 'promptDigest', 'prompt',
  ], 'task request')
  if (raw.schemaVersion !== 1 || raw.taskId !== expectedTaskId || typeof raw.prompt !== 'string' || raw.prompt.length === 0 || raw.prompt.includes('\0')) {
    throw new FleetA2ARuntimeError('invalid-task-state', 'task request identity, schema or prompt is invalid')
  }
  const promptDigest = stateDigest(raw.promptDigest, 'task request.promptDigest')!
  if (hash(raw.prompt) !== promptDigest) throw new FleetA2ARuntimeError('invalid-task-state', 'task request prompt digest is invalid')
  return {
    schemaVersion: 1,
    taskId: expectedTaskId,
    requestMessageId: stateText(raw.requestMessageId, 'task request.requestMessageId', 64),
    senderDeviceId: stateText(raw.senderDeviceId, 'task request.senderDeviceId', 64),
    senderPrincipalId: stateText(raw.senderPrincipalId, 'task request.senderPrincipalId', 64),
    workspaceId: stateText(raw.workspaceId, 'task request.workspaceId', 64),
    profile: stateText(raw.profile, 'task request.profile', 64),
    promptDigest,
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
  token: string
}

async function staleProcessLock(path: string): Promise<boolean> {
  let source: string
  try {
    source = await readRegularFile(path)
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true
    throw error
  }
  try {
    const owner = JSON.parse(source) as { pid?: unknown; token?: unknown }
    if (typeof owner.pid === 'number' && Number.isSafeInteger(owner.pid) && owner.pid > 0 && typeof owner.token === 'string') {
      return !await processAlive(owner.pid)
    }
  } catch {
    // A partially written lock is reaped only after a grace period below.
  }
  const info = await lstat(path)
  return Date.now() - info.mtimeMs > 30_000
}

async function acquireProcessLock(path: string, busyCode: string, busyMessage: string): Promise<ProcessLock> {
  await ensureDirectory(dirname(path))
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const token = randomUUID()
    let handle
    try {
      handle = await open(path, 'wx', 0o600)
      await handle.writeFile(JSON.stringify({ pid: process.pid, token, at: new Date().toISOString() }) + '\n')
      await handle.sync()
      return { path, token }
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      if (!await staleProcessLock(path)) throw new FleetA2ARuntimeError(busyCode, busyMessage)
      await rm(path, { force: true })
    } finally {
      await handle?.close()
    }
  }
  throw new FleetA2ARuntimeError(busyCode, busyMessage)
}

async function releaseProcessLock(lock: ProcessLock): Promise<void> {
  try {
    const owner = JSON.parse(await readRegularFile(lock.path)) as { token?: unknown }
    if (owner.token === lock.token) await rm(lock.path, { force: true })
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

async function processLockActive(path: string): Promise<boolean> {
  try {
    if (!await staleProcessLock(path)) return true
    await rm(path, { force: true })
    return false
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

function taskMatchesEnvelope(
  record: FleetTaskRecord,
  envelope: FleetA2AEnvelope,
  payload: { taskId: string; workspaceId: string; profile: string; prompt: string },
): boolean {
  return record.promptDigest === hash(payload.prompt) && record.senderDeviceId === envelope.sender.deviceId &&
    record.senderPrincipalId === envelope.sender.principalId && record.workspaceId === payload.workspaceId && record.profile === payload.profile
}

async function acceptTask(
  config: A2AReadyFleetAgentConfig,
  envelope: FleetA2AEnvelope,
  launch: A2AWorkerLaunch,
): Promise<FleetTaskRecord> {
  if (!config.tasks.enabled) throw new FleetA2ARuntimeError('tasks-disabled', 'remote tasks are disabled on this device')
  const payload = envelope.payload as { taskId: string; workspaceId: string; profile: string; prompt: string }
  if (config.tasks.workspaces[payload.workspaceId] === undefined || !config.tasks.profiles.includes(payload.profile)) {
    throw new FleetA2ARuntimeError('task-policy-denied', 'task workspace or profile is not allowed by local policy')
  }
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
    if (storedRequest !== null && (storedRequest.promptDigest !== promptDigest || storedRequest.prompt !== payload.prompt ||
        storedRequest.senderDeviceId !== envelope.sender.deviceId || storedRequest.senderPrincipalId !== envelope.sender.principalId ||
        storedRequest.workspaceId !== payload.workspaceId || storedRequest.profile !== payload.profile)) {
      throw new FleetA2ARuntimeError('task-id-conflict', 'task id is already bound to a different request')
    }
    const request: FleetTaskRequest = storedRequest ?? {
      schemaVersion: 1,
      taskId: payload.taskId,
      requestMessageId: envelope.messageId,
      senderDeviceId: envelope.sender.deviceId,
      senderPrincipalId: envelope.sender.principalId,
      workspaceId: payload.workspaceId,
      profile: payload.profile,
      promptDigest,
      prompt: payload.prompt,
    }
    if (storedRequest === null) await atomicJson(join(directory, 'request.json'), request)
    const createdAt = new Date().toISOString()
    const record: FleetTaskRecord = {
      schemaVersion: 1,
      taskId: payload.taskId,
      requestMessageId: request.requestMessageId,
      senderDeviceId: request.senderDeviceId,
      senderPrincipalId: request.senderPrincipalId,
      workspaceId: request.workspaceId,
      profile: request.profile,
      promptDigest: request.promptDigest,
      state: 'accepted',
      createdAt,
      updatedAt: createdAt,
      deadlineAt: new Date(Date.parse(createdAt) + config.tasks.timeoutMs).toISOString(),
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

async function requestCancellation(config: FleetAgentConfig, taskId: string): Promise<FleetTaskRecord> {
  const record = await readTaskRecord(config, taskId)
  if (record === null) throw new FleetA2ARuntimeError('task-not-found', 'task was not found')
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
  if (envelope.kind === 'task.submit') {
    const record = await acceptTask(config, envelope, launch)
    response = workerPayload(record, null)
  } else if (envelope.kind === 'task.status') {
    const { record, result } = await taskResult(config, envelope.payload.taskId as string)
    response = workerPayload(record, result)
  } else if (envelope.kind === 'task.cancel') {
    const record = await requestCancellation(config, envelope.payload.taskId as string)
    response = workerPayload(record, null)
  } else {
    const inboxPath = join(config.stateDir, 'a2a', 'inbox', hash(envelope.messageId) + '.json')
    await atomicJson(inboxPath, envelope)
    response = { kind: 'receipt', payload: { requestMessageId: envelope.messageId, status: envelope.kind === 'handoff' ? 'stored' : 'accepted' } }
  }
  return createA2AEnvelope({
    teamId: config.a2a.teamId,
    sender: { principalId: config.a2a.principalId, deviceId: config.deviceId },
    recipient: { deviceId: envelope.sender.deviceId },
    kind: response.kind,
    payload: response.payload,
    privateKey: await privateKeyPem(config),
    now,
    ttlMs: Math.min(5 * 60 * 1000, config.a2a.maxMessageTtlMs),
  })
}

export async function receiveA2AMessage(
  config: FleetAgentConfig,
  value: unknown,
  launch: A2AWorkerLaunch,
  now = new Date(),
): Promise<FleetA2AReceipt> {
  assertA2AReadyConfig(config)
  const envelope = await verifyA2AMessage(config, value, now)
  const receiptPath = join(config.stateDir, 'a2a', 'receipts', hash(envelope.messageId) + '.json')
  const lockPath = receiptPath + '.lock'
  try {
    const existing = JSON.parse(await readRegularFile(receiptPath)) as FleetA2AReceipt
    return existing
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const lock = await acquireProcessLock(lockPath, 'message-in-progress', 'A2A message is already being processed')
  try {
    try {
      const existing = JSON.parse(await readRegularFile(receiptPath)) as FleetA2AReceipt
      return existing
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const response = await receiptResponse(config, envelope, launch, now)
    const receipt = { requestMessageId: envelope.messageId, response }
    await atomicJson(receiptPath, receipt)
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

function taskEnvironment(config: FleetAgentConfig): NodeJS.ProcessEnv {
  const path = [dirname(config.dshBinary), dirname(process.execPath), '/opt/homebrew/bin', '/usr/bin', '/bin'].join(':')
  const env: NodeJS.ProcessEnv = { DSH_HOME: config.dshHome, PATH: path, GIT_TERMINAL_PROMPT: '0' }
  for (const key of ['HOME', 'USER', 'LOGNAME', 'TMPDIR', 'LANG', 'LC_ALL', 'SHELL', 'TERM']) {
    if (process.env[key] !== undefined) env[key] = process.env[key]
  }
  return env
}

async function runTaskProcess(
  config: A2AReadyFleetAgentConfig,
  request: FleetTaskRequest,
  cancelPath: string,
): Promise<TaskProcessResult> {
  const workspace = config.tasks.workspaces[request.workspaceId]
  if (workspace === undefined || !config.tasks.profiles.includes(request.profile)) {
    throw new FleetA2ARuntimeError('task-policy-denied', 'task no longer matches local policy')
  }
  const workspaceInfo = await lstat(workspace).catch(() => undefined)
  if (workspaceInfo === undefined) {
    throw new FleetA2ARuntimeError('task-policy-denied', 'task workspace is unavailable')
  }
  if (workspaceInfo.isSymbolicLink() || !workspaceInfo.isDirectory()) {
    throw new FleetA2ARuntimeError('task-policy-denied', 'task workspace must be a real directory')
  }
  return new Promise((resolve, reject) => {
    const grouped = process.platform !== 'win32'
    const child = spawn(config.dshBinary, ['--profile', request.profile, request.prompt], {
      cwd: workspace,
      env: taskEnvironment(config),
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
    const timeout = setTimeout(() => stop('timeout'), config.tasks.timeoutMs)
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

async function acquireTaskSlot(config: A2AReadyFleetAgentConfig, taskId: string): Promise<{ path: string; token: string }> {
  const directory = join(config.stateDir, 'tasks', '.slots')
  await ensureDirectory(directory)
  const token = randomUUID()
  for (;;) {
    for (let index = 0; index < config.tasks.maxConcurrent; index += 1) {
      const path = join(directory, String(index) + '.lock')
      try {
        const handle = await open(path, 'wx', 0o600)
        await handle.writeFile(JSON.stringify({ pid: process.pid, taskId, token }) + '\n')
        await handle.close()
        return { path, token }
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        try {
          if (await staleProcessLock(path)) await rm(path, { force: true })
        } catch (readError: unknown) {
          if ((readError as NodeJS.ErrnoException).code === 'ENOENT') continue
          throw readError
        }
      }
    }
    if (existsSync(join(taskDirectory(config, taskId), 'cancel'))) throw new FleetA2ARuntimeError('task-cancelled', 'task was cancelled while queued')
    await new Promise(resolve => setTimeout(resolve, 500))
  }
}

export async function runTaskWorker(config: FleetAgentConfig, taskId: string): Promise<FleetTaskRecord> {
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
  let slot: { path: string; token: string } | undefined
  try {
    let record = await readTaskRecord(config, taskId)
    if (record === null) throw new FleetA2ARuntimeError('task-not-found', 'task was not found')
    if (['succeeded', 'failed', 'cancelled'].includes(record.state)) return record
    const request = await readTaskRequest(config, taskId)
    if (request === null || request.requestMessageId !== record.requestMessageId || request.senderDeviceId !== record.senderDeviceId ||
        request.senderPrincipalId !== record.senderPrincipalId || request.workspaceId !== record.workspaceId ||
        request.profile !== record.profile || request.promptDigest !== record.promptDigest) {
      throw new FleetA2ARuntimeError('task-request-mismatch', 'task request does not match its durable record')
    }
    const cancelPath = join(directory, 'cancel')
    if (existsSync(cancelPath)) return saveTaskRecord(config, record, 'cancelled', { errorCode: 'cancelled' })
    slot = await acquireTaskSlot(config, taskId)
    if (existsSync(cancelPath)) return saveTaskRecord(config, record, 'cancelled', { errorCode: 'cancelled' })
    record = await saveTaskRecord(config, record, 'running')
    const result = await runTaskProcess(config, request, cancelPath)
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
        const owner = JSON.parse(await readRegularFile(slot.path)) as { token?: unknown }
        if (owner.token === slot.token) await rm(slot.path, { force: true })
      } catch {
        // A missing slot is already released; an altered slot belongs to another worker.
      }
    }
    await releaseProcessLock(worker)
  }
}

export async function resumeAcceptedTasks(config: FleetAgentConfig, launch: A2AWorkerLaunch): Promise<number> {
  assertA2AReadyConfig(config)
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
    if (record.state === 'accepted' && Date.now() <= Date.parse(record.deadlineAt) + 30_000) {
      await launchTaskWorker(launch, taskId)
      resumed += 1
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
    'unsafe-key-permissions': 'A2A private key permissions are unsafe',
  }
  return { code: Object.hasOwn(messages, code) ? code : 'internal', message: messages[code] ?? 'A2A request failed' }
}

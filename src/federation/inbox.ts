import { constants } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { isAbsolute, join, normalize } from 'node:path'
import { link, lstat, mkdir, open, readdir, unlink } from 'node:fs/promises'
import { canonicalJson, sha256Canonical } from '../agent/protocol.ts'
import {
  FLEET_A2A_KINDS,
  FLEET_A2A_SCHEMA_VERSION,
  isFleetFederationAdvisoryKind,
  validateA2APayload,
  verifyA2AEnvelope,
  type FleetA2AEnvelope,
  type FleetA2AKind,
  type VerifyA2AEnvelopeInput,
} from '../a2a/protocol.ts'

const INBOX_SCHEMA_VERSION = 1 as const
const ACK_SCHEMA_VERSION = 1 as const
const MAX_STATE_FILE_BYTES = 64 * 1024
const MESSAGE_ID_PATTERN = /^msg:([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/
const KEY_ID_PATTERN = /^ed25519:[0-9a-f]{64}$/
const DIGEST_PATTERN = /^[0-9a-f]{64}$/
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{86}$/
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

declare const VERIFIED_FOREIGN_FEDERATION: unique symbol

/** A signature-verified foreign advisory envelope. It cannot represent task execution. */
export type VerifiedForeignFederationEnvelope = FleetA2AEnvelope & {
  readonly [VERIFIED_FOREIGN_FEDERATION]: true
}

export interface FleetFederationInboxRecord {
  schemaVersion: typeof INBOX_SCHEMA_VERSION
  receivedAt: string
  envelope: FleetA2AEnvelope
}

export type FleetFederationAcknowledgementDisposition = 'acknowledged' | 'dismissed'

export interface FleetFederationAcknowledgement {
  schemaVersion: typeof ACK_SCHEMA_VERSION
  messageId: string
  payloadDigest: string
  disposition: FleetFederationAcknowledgementDisposition
  acknowledgedAt: string
}

export interface FleetFederationInboxItem {
  record: FleetFederationInboxRecord
  acknowledgement: FleetFederationAcknowledgement | null
  expired: boolean
}

export interface ReceiveFederationEnvelopeInput {
  rootDirectory: string
  value: unknown
  verification: VerifyA2AEnvelopeInput
  receivedAt?: Date | string
}

export interface ReceiveFederationEnvelopeResult {
  status: 'stored' | 'duplicate'
  record: FleetFederationInboxRecord
}

export interface AcknowledgeFederationMessageInput {
  rootDirectory: string
  messageId: string
  expectedPayloadDigest: string
  disposition: FleetFederationAcknowledgementDisposition
  acknowledgedAt?: Date | string
}

export interface AcknowledgeFederationMessageResult {
  status: 'acknowledged' | 'duplicate'
  acknowledgement: FleetFederationAcknowledgement
}

export interface FleetFederationRetentionPolicy {
  acknowledgedRetentionMs: number
  expiredRetentionMs: number
  maxEntries: number
}

export type FleetFederationPruneReason =
  | 'acknowledged-retention'
  | 'expired-retention'
  | 'capacity'

export interface FleetFederationPruneCandidate {
  messageId: string
  payloadDigest: string
  reason: FleetFederationPruneReason
}

export type FleetFederationPruneSkipReason =
  | 'missing'
  | 'changed'
  | 'not-eligible'
  | 'plan-changed'
  | 'busy'

export interface ApplyFederationInboxPruneInput {
  rootDirectory: string
  candidates: readonly FleetFederationPruneCandidate[]
  policy: FleetFederationRetentionPolicy
  now?: Date | string
}

export interface ApplyFederationInboxPruneResult {
  pruned: FleetFederationPruneCandidate[]
  skipped: Array<{
    candidate: FleetFederationPruneCandidate
    reason: FleetFederationPruneSkipReason
  }>
}

export type FleetFederationApprovalView =
  | {
    kind: 'approval.request'
    approvalId: string
    taskId: string
    summary: string
    expiresAt: string
  }
  | {
    kind: 'approval.decision'
    approvalId: string
    taskId: string
    approvalRequestMessageId: string
    approvalRequestPayloadDigest: string
    decision: 'endorsed' | 'declined'
    decidedAt: string
  }

export type FleetFederationErrorCode =
  | 'not-foreign-advisory'
  | 'invalid-state'
  | 'unsafe-state-path'
  | 'unsafe-state-permissions'
  | 'message-conflict'
  | 'acknowledgement-conflict'
  | 'message-not-found'
  | 'message-busy'
  | 'retention-invalid'

export class FleetFederationError extends Error {
  readonly code: FleetFederationErrorCode

  constructor(code: FleetFederationErrorCode, message: string) {
    super(message)
    this.name = 'FleetFederationError'
    this.code = code
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactKeys(value: unknown, keys: readonly string[], field: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw new FleetFederationError('invalid-state', field + ' must be an object')
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new FleetFederationError('invalid-state', field + ' has unsupported or missing fields')
  }
}

function identifier(value: unknown, field: string): string {
  if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value)) {
    throw new FleetFederationError('invalid-state', field + ' is invalid')
  }
  return value
}

function messageId(value: unknown, field = 'messageId'): string {
  if (typeof value !== 'string' || !MESSAGE_ID_PATTERN.test(value)) {
    throw new FleetFederationError('invalid-state', field + ' is invalid')
  }
  return value
}

function digest(value: unknown, field: string): string {
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) {
    throw new FleetFederationError('invalid-state', field + ' is invalid')
  }
  return value
}

function canonicalTime(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new FleetFederationError('invalid-state', field + ' is invalid')
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new FleetFederationError('invalid-state', field + ' is invalid')
  }
  return value
}

function nowIso(value: Date | string | undefined): string {
  const date = value === undefined ? new Date() : value instanceof Date ? new Date(value.getTime()) : new Date(value)
  if (!Number.isFinite(date.getTime())) throw new FleetFederationError('invalid-state', 'time must be valid')
  return date.toISOString()
}

function stateRoot(value: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1024 || value.includes('\0') ||
      !isAbsolute(value) || normalize(value) !== value || value === '/') {
    throw new FleetFederationError('unsafe-state-path', 'federation inbox root must be a normalized absolute non-root path')
  }
  return value
}

function messageSegment(value: string): string {
  const match = MESSAGE_ID_PATTERN.exec(value)
  if (match?.[1] === undefined) throw new FleetFederationError('invalid-state', 'messageId is invalid')
  return match[1]
}

function inboxDirectory(rootDirectory: string): string {
  return join(rootDirectory, 'inbox')
}

function acknowledgementsDirectory(rootDirectory: string): string {
  return join(rootDirectory, 'acknowledgements')
}

function locksDirectory(rootDirectory: string): string {
  return join(rootDirectory, 'locks')
}

function inboxPath(rootDirectory: string, id: string): string {
  return join(inboxDirectory(rootDirectory), messageSegment(id) + '.json')
}

function acknowledgementPath(rootDirectory: string, id: string): string {
  return join(acknowledgementsDirectory(rootDirectory), messageSegment(id) + '.json')
}

function lockPath(rootDirectory: string, id: string): string {
  return join(locksDirectory(rootDirectory), messageSegment(id) + '.lock')
}

function assertOwned(info: Awaited<ReturnType<typeof lstat>>, field: string): void {
  if (typeof process.getuid === 'function' && info.uid !== process.getuid()) {
    throw new FleetFederationError('unsafe-state-permissions', field + ' must be owned by the current user')
  }
}

async function assertPrivateDirectory(path: string, field: string): Promise<void> {
  const info = await lstat(path)
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new FleetFederationError('unsafe-state-path', field + ' must be a real directory, not a symlink')
  }
  assertOwned(info, field)
  if ((info.mode & 0o077) !== 0) {
    throw new FleetFederationError('unsafe-state-permissions', field + ' must be owner-only (0700)')
  }
}

async function ensureLayout(rootValue: string): Promise<string> {
  const rootDirectory = stateRoot(rootValue)
  await mkdir(rootDirectory, { recursive: true, mode: 0o700 })
  await assertPrivateDirectory(rootDirectory, 'federation inbox root')
  for (const directory of [inboxDirectory(rootDirectory), acknowledgementsDirectory(rootDirectory), locksDirectory(rootDirectory)]) {
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await assertPrivateDirectory(directory, 'federation inbox directory')
  }
  return rootDirectory
}

async function readPrivateJson(path: string): Promise<unknown> {
  let handle
  try {
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    const info = await handle.stat()
    if (!info.isFile() || info.size > MAX_STATE_FILE_BYTES) {
      throw new FleetFederationError('invalid-state', 'federation state must be a bounded regular file')
    }
    assertOwned(info, 'federation state file')
    if ((info.mode & 0o077) !== 0) {
      throw new FleetFederationError('unsafe-state-permissions', 'federation state files must be owner-only (0600)')
    }
    const source = await handle.readFile('utf8')
    try {
      return JSON.parse(source) as unknown
    } catch {
      throw new FleetFederationError('invalid-state', 'federation state file must contain JSON')
    }
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
      throw new FleetFederationError('unsafe-state-path', 'federation state files cannot be symlinks')
    }
    throw error
  } finally {
    await handle?.close()
  }
}

async function createExclusivePrivateJson(path: string, value: unknown): Promise<'created' | 'exists'> {
  const directory = path.slice(0, path.lastIndexOf('/'))
  const temporaryPath = join(directory, '.tmp-' + randomUUID())
  let handle
  try {
    handle = await open(temporaryPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600)
    await handle.writeFile(JSON.stringify(value, null, 2) + '\n', 'utf8')
    await handle.sync()
    await handle.close()
    handle = undefined
    try {
      await link(temporaryPath, path)
      return 'created'
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return 'exists'
      throw error
    }
  } finally {
    await handle?.close()
    try {
      await unlink(temporaryPath)
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}

async function assertPrivateRegularFile(path: string, field: string): Promise<void> {
  const info = await lstat(path)
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new FleetFederationError('unsafe-state-path', field + ' must be a real regular file, not a symlink')
  }
  assertOwned(info, field)
  if ((info.mode & 0o077) !== 0) {
    throw new FleetFederationError('unsafe-state-permissions', field + ' must be owner-only (0600)')
  }
}

async function acquireMessageLock(rootDirectory: string, id: string): Promise<null | (() => Promise<void>)> {
  const path = lockPath(rootDirectory, id)
  let handle
  try {
    handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600)
    await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }) + '\n', 'utf8')
    await handle.sync()
  } catch (error: unknown) {
    const created = handle !== undefined
    await handle?.close()
    if (created) {
      try {
        await unlink(path)
      } catch (cleanupError: unknown) {
        if ((cleanupError as NodeJS.ErrnoException).code !== 'ENOENT') throw cleanupError
      }
    }
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      await assertPrivateRegularFile(path, 'federation message lock')
      return null
    }
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
      throw new FleetFederationError('unsafe-state-path', 'federation message lock cannot be a symlink')
    }
    throw error
  }
  await handle.close()
  return async () => {
    await assertPrivateRegularFile(path, 'federation message lock')
    await unlink(path)
  }
}

function parseStoredEnvelope(value: unknown): FleetA2AEnvelope {
  exactKeys(value, [
    'schemaVersion', 'teamId', 'messageId', 'sender', 'recipient', 'kind',
    'issuedAt', 'expiresAt', 'payloadDigest', 'payload', 'signature',
  ], 'stored federation envelope')
  if (value.schemaVersion !== FLEET_A2A_SCHEMA_VERSION || typeof value.kind !== 'string' ||
      !FLEET_A2A_KINDS.includes(value.kind as FleetA2AKind) || !isFleetFederationAdvisoryKind(value.kind as FleetA2AKind)) {
    throw new FleetFederationError('invalid-state', 'stored federation envelope schema or kind is invalid')
  }
  exactKeys(value.sender, ['principalId', 'deviceId', 'keyId'], 'stored federation sender')
  exactKeys(value.recipient, ['teamId', 'deviceId'], 'stored federation recipient')
  const teamId = identifier(value.teamId, 'stored federation sender teamId')
  identifier(value.sender.principalId, 'stored federation sender principalId')
  identifier(value.sender.deviceId, 'stored federation sender deviceId')
  if (typeof value.sender.keyId !== 'string' || !KEY_ID_PATTERN.test(value.sender.keyId)) {
    throw new FleetFederationError('invalid-state', 'stored federation sender keyId is invalid')
  }
  const recipientTeamId = identifier(value.recipient.teamId, 'stored federation recipient teamId')
  identifier(value.recipient.deviceId, 'stored federation recipient deviceId')
  if (teamId === recipientTeamId) {
    throw new FleetFederationError('invalid-state', 'federation inbox accepts foreign-team messages only')
  }
  messageId(value.messageId)
  const issuedAt = canonicalTime(value.issuedAt, 'stored federation issuedAt')
  const expiresAt = canonicalTime(value.expiresAt, 'stored federation expiresAt')
  if (Date.parse(expiresAt) <= Date.parse(issuedAt)) {
    throw new FleetFederationError('invalid-state', 'stored federation validity window is invalid')
  }
  const payloadDigest = digest(value.payloadDigest, 'stored federation payloadDigest')
  try {
    validateA2APayload(value.kind as FleetA2AKind, value.payload)
  } catch {
    throw new FleetFederationError('invalid-state', 'stored federation payload is invalid')
  }
  if (sha256Canonical(value.payload) !== payloadDigest) {
    throw new FleetFederationError('invalid-state', 'stored federation payload digest does not match')
  }
  if (typeof value.signature !== 'string' || !SIGNATURE_PATTERN.test(value.signature)) {
    throw new FleetFederationError('invalid-state', 'stored federation signature is invalid')
  }
  return value as unknown as FleetA2AEnvelope
}

export function parseFederationInboxRecord(value: unknown): FleetFederationInboxRecord {
  exactKeys(value, ['schemaVersion', 'receivedAt', 'envelope'], 'federation inbox record')
  if (value.schemaVersion !== INBOX_SCHEMA_VERSION) {
    throw new FleetFederationError('invalid-state', 'federation inbox record schema is invalid')
  }
  return {
    schemaVersion: INBOX_SCHEMA_VERSION,
    receivedAt: canonicalTime(value.receivedAt, 'federation receivedAt'),
    envelope: parseStoredEnvelope(value.envelope),
  }
}

export function parseFederationAcknowledgement(value: unknown): FleetFederationAcknowledgement {
  exactKeys(value, ['schemaVersion', 'messageId', 'payloadDigest', 'disposition', 'acknowledgedAt'], 'federation acknowledgement')
  if (value.schemaVersion !== ACK_SCHEMA_VERSION ||
      (value.disposition !== 'acknowledged' && value.disposition !== 'dismissed')) {
    throw new FleetFederationError('invalid-state', 'federation acknowledgement schema or disposition is invalid')
  }
  return {
    schemaVersion: ACK_SCHEMA_VERSION,
    messageId: messageId(value.messageId),
    payloadDigest: digest(value.payloadDigest, 'federation acknowledgement payloadDigest'),
    disposition: value.disposition,
    acknowledgedAt: canonicalTime(value.acknowledgedAt, 'federation acknowledgedAt'),
  }
}

export function verifyForeignFederationEnvelope(
  value: unknown,
  input: VerifyA2AEnvelopeInput,
): VerifiedForeignFederationEnvelope {
  const envelope = verifyA2AEnvelope(value, input)
  if (envelope.teamId === input.expectedTeamId || !isFleetFederationAdvisoryKind(envelope.kind)) {
    throw new FleetFederationError('not-foreign-advisory', 'federation inbox accepts verified foreign advisory messages only')
  }
  return envelope as VerifiedForeignFederationEnvelope
}

export async function receiveFederationEnvelope(
  input: ReceiveFederationEnvelopeInput,
): Promise<ReceiveFederationEnvelopeResult> {
  const receivedAt = nowIso(input.receivedAt ?? input.verification.now)
  const envelope = verifyForeignFederationEnvelope(input.value, { ...input.verification, now: receivedAt })
  const rootDirectory = await ensureLayout(input.rootDirectory)
  const path = inboxPath(rootDirectory, envelope.messageId)
  const record: FleetFederationInboxRecord = { schemaVersion: INBOX_SCHEMA_VERSION, receivedAt, envelope }
  if (await createExclusivePrivateJson(path, record) === 'created') return { status: 'stored', record }
  const existing = parseFederationInboxRecord(await readPrivateJson(path))
  if (canonicalJson(existing.envelope) !== canonicalJson(envelope)) {
    throw new FleetFederationError('message-conflict', 'messageId is already bound to a different signed envelope')
  }
  return { status: 'duplicate', record: existing }
}

async function readInboxRecord(rootDirectory: string, id: string): Promise<FleetFederationInboxRecord> {
  try {
    return parseFederationInboxRecord(await readPrivateJson(inboxPath(rootDirectory, id)))
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new FleetFederationError('message-not-found', 'federation inbox message was not found')
    }
    throw error
  }
}

async function readAcknowledgement(rootDirectory: string, id: string): Promise<FleetFederationAcknowledgement | null> {
  try {
    return parseFederationAcknowledgement(await readPrivateJson(acknowledgementPath(rootDirectory, id)))
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export async function acknowledgeFederationMessage(
  input: AcknowledgeFederationMessageInput,
): Promise<AcknowledgeFederationMessageResult> {
  const rootDirectory = await ensureLayout(input.rootDirectory)
  const id = messageId(input.messageId)
  const expectedPayloadDigest = digest(input.expectedPayloadDigest, 'expectedPayloadDigest')
  if (input.disposition !== 'acknowledged' && input.disposition !== 'dismissed') {
    throw new FleetFederationError('invalid-state', 'acknowledgement disposition is invalid')
  }
  const release = await acquireMessageLock(rootDirectory, id)
  if (release === null) throw new FleetFederationError('message-busy', 'federation message is being updated')
  try {
    const record = await readInboxRecord(rootDirectory, id)
    if (record.envelope.payloadDigest !== expectedPayloadDigest) {
      throw new FleetFederationError('acknowledgement-conflict', 'acknowledgement payload digest does not match the stored message')
    }
    const acknowledgedAt = nowIso(input.acknowledgedAt)
    if (Date.parse(acknowledgedAt) < Date.parse(record.receivedAt)) {
      throw new FleetFederationError('invalid-state', 'acknowledgement cannot predate receipt')
    }
    const acknowledgement: FleetFederationAcknowledgement = {
      schemaVersion: ACK_SCHEMA_VERSION,
      messageId: id,
      payloadDigest: expectedPayloadDigest,
      disposition: input.disposition,
      acknowledgedAt,
    }
    const path = acknowledgementPath(rootDirectory, id)
    if (await createExclusivePrivateJson(path, acknowledgement) === 'created') {
      return { status: 'acknowledged', acknowledgement }
    }
    const existing = parseFederationAcknowledgement(await readPrivateJson(path))
    if (existing.messageId !== id || existing.payloadDigest !== expectedPayloadDigest || existing.disposition !== input.disposition) {
      throw new FleetFederationError('acknowledgement-conflict', 'the first federation acknowledgement is final')
    }
    return { status: 'duplicate', acknowledgement: existing }
  } finally {
    await release()
  }
}

async function existingPrivateDirectory(path: string, field: string): Promise<boolean> {
  try {
    await assertPrivateDirectory(path, field)
    return true
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function readAllFederationInbox(rootDirectory: string, now: number): Promise<FleetFederationInboxItem[]> {
  if (!await existingPrivateDirectory(rootDirectory, 'federation inbox root') ||
      !await existingPrivateDirectory(inboxDirectory(rootDirectory), 'federation inbox directory')) return []
  const hasAcknowledgements = await existingPrivateDirectory(acknowledgementsDirectory(rootDirectory), 'federation acknowledgements directory')
  const entries = await readdir(inboxDirectory(rootDirectory), { withFileTypes: true })
  const records: FleetFederationInboxItem[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !/^[0-9a-f-]{36}\.json$/.test(entry.name)) continue
    const record = parseFederationInboxRecord(await readPrivateJson(join(inboxDirectory(rootDirectory), entry.name)))
    if (entry.name !== messageSegment(record.envelope.messageId) + '.json') {
      throw new FleetFederationError('invalid-state', 'federation inbox filename does not match its message id')
    }
    const acknowledgement = hasAcknowledgements ? await readAcknowledgement(rootDirectory, record.envelope.messageId) : null
    if (acknowledgement !== null && (acknowledgement.messageId !== record.envelope.messageId ||
        acknowledgement.payloadDigest !== record.envelope.payloadDigest)) {
      throw new FleetFederationError('invalid-state', 'federation acknowledgement does not match its inbox message')
    }
    records.push({ record, acknowledgement, expired: now >= Date.parse(record.envelope.expiresAt) })
  }
  records.sort((left, right) => {
    const time = Date.parse(right.record.receivedAt) - Date.parse(left.record.receivedAt)
    return time === 0 ? left.record.envelope.messageId.localeCompare(right.record.envelope.messageId) : time
  })
  return records
}

export async function listFederationInbox(
  rootValue: string,
  options: { now?: Date | string; limit?: number } = {},
): Promise<FleetFederationInboxItem[]> {
  const rootDirectory = stateRoot(rootValue)
  const now = Date.parse(nowIso(options.now))
  const limit = options.limit ?? 100
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
    throw new FleetFederationError('invalid-state', 'federation inbox limit must be an integer from 1 to 500')
  }
  return (await readAllFederationInbox(rootDirectory, now)).slice(0, limit)
}

/**
 * Returns display-only artifact labels. Callers must render them as plain text;
 * this module intentionally has no resolver, downloader, URL opener or filesystem lookup.
 */
export function federationArtifactLabels(record: FleetFederationInboxRecord): string[] {
  if (record.envelope.kind !== 'handoff') return []
  return [...(record.envelope.payload.artifactRefs as string[])]
}

/** Advisory approval metadata only. It deliberately cannot produce a task allowed-once token. */
export function federationApprovalView(record: FleetFederationInboxRecord): FleetFederationApprovalView | null {
  const payload = record.envelope.payload
  if (record.envelope.kind === 'approval.request') {
    return {
      kind: 'approval.request',
      approvalId: payload.approvalId as string,
      taskId: payload.taskId as string,
      summary: payload.summary as string,
      expiresAt: payload.expiresAt as string,
    }
  }
  if (record.envelope.kind === 'approval.decision') {
    return {
      kind: 'approval.decision',
      approvalId: payload.approvalId as string,
      taskId: payload.taskId as string,
      approvalRequestMessageId: payload.approvalRequestMessageId as string,
      approvalRequestPayloadDigest: payload.approvalRequestPayloadDigest as string,
      decision: payload.decision as 'endorsed' | 'declined',
      decidedAt: payload.decidedAt as string,
    }
  }
  return null
}

/** All federation messages are merely stored; a receipt never means task or tool authorization. */
export function federationReceiptPayload(record: FleetFederationInboxRecord): {
  requestMessageId: string
  status: 'stored'
} {
  return { requestMessageId: record.envelope.messageId, status: 'stored' }
}

function retentionInteger(value: number, field: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new FleetFederationError('retention-invalid', `${field} must be an integer from ${min} to ${max}`)
  }
  return value
}

/**
 * Pure retention planner. Unexpired messages and fresh unacknowledged
 * messages are never selected, even if the inbox is above maxEntries.
 */
export function planFederationInboxPrune(
  items: readonly FleetFederationInboxItem[],
  policy: FleetFederationRetentionPolicy,
  nowValue: Date | string = new Date(),
): FleetFederationPruneCandidate[] {
  const now = Date.parse(nowIso(nowValue))
  const acknowledgedRetentionMs = retentionInteger(policy.acknowledgedRetentionMs, 'acknowledgedRetentionMs', 60_000, 365 * 24 * 60 * 60 * 1000)
  const expiredRetentionMs = retentionInteger(policy.expiredRetentionMs, 'expiredRetentionMs', 60_000, 365 * 24 * 60 * 60 * 1000)
  const maxEntries = retentionInteger(policy.maxEntries, 'maxEntries', 1, 100_000)
  const selected = new Map<string, FleetFederationPruneCandidate>()
  const ordered = [...items].sort((left, right) => Date.parse(left.record.receivedAt) - Date.parse(right.record.receivedAt))
  const seen = new Set<string>()
  for (const item of ordered) {
    const id = item.record.envelope.messageId
    messageId(id)
    digest(item.record.envelope.payloadDigest, 'retention payloadDigest')
    canonicalTime(item.record.receivedAt, 'retention receivedAt')
    canonicalTime(item.record.envelope.expiresAt, 'retention expiresAt')
    if (seen.has(id)) throw new FleetFederationError('invalid-state', 'retention items must have unique message ids')
    seen.add(id)
    if (item.acknowledgement !== null && (item.acknowledgement.messageId !== id ||
        item.acknowledgement.payloadDigest !== item.record.envelope.payloadDigest)) {
      throw new FleetFederationError('invalid-state', 'retention acknowledgement does not match its message')
    }
    if (item.acknowledgement !== null) canonicalTime(item.acknowledgement.acknowledgedAt, 'retention acknowledgedAt')
    const expired = now >= Date.parse(item.record.envelope.expiresAt)
    if (expired && item.acknowledgement !== null && now - Date.parse(item.acknowledgement.acknowledgedAt) >= acknowledgedRetentionMs) {
      selected.set(id, { messageId: id, payloadDigest: item.record.envelope.payloadDigest, reason: 'acknowledged-retention' })
    } else if (expired && item.acknowledgement === null && now - Date.parse(item.record.envelope.expiresAt) >= expiredRetentionMs) {
      selected.set(id, { messageId: id, payloadDigest: item.record.envelope.payloadDigest, reason: 'expired-retention' })
    }
  }
  let remaining = ordered.length - selected.size
  if (remaining > maxEntries) {
    for (const item of ordered) {
      if (remaining <= maxEntries) break
      const id = item.record.envelope.messageId
      if (selected.has(id)) continue
      if (now < Date.parse(item.record.envelope.expiresAt)) continue
      selected.set(id, { messageId: id, payloadDigest: item.record.envelope.payloadDigest, reason: 'capacity' })
      remaining -= 1
    }
  }
  return ordered.flatMap(item => {
    const candidate = selected.get(item.record.envelope.messageId)
    return candidate === undefined ? [] : [candidate]
  })
}

function parsePruneCandidate(value: unknown): FleetFederationPruneCandidate {
  exactKeys(value, ['messageId', 'payloadDigest', 'reason'], 'federation prune candidate')
  if (value.reason !== 'acknowledged-retention' && value.reason !== 'expired-retention' && value.reason !== 'capacity') {
    throw new FleetFederationError('retention-invalid', 'federation prune candidate reason is invalid')
  }
  return {
    messageId: messageId(value.messageId, 'federation prune candidate messageId'),
    payloadDigest: digest(value.payloadDigest, 'federation prune candidate payloadDigest'),
    reason: value.reason,
  }
}

async function deleteFederationInboxItem(
  rootDirectory: string,
  expected: FleetFederationInboxItem,
): Promise<boolean> {
  const id = expected.record.envelope.messageId
  let currentRecord: FleetFederationInboxRecord
  try {
    currentRecord = await readInboxRecord(rootDirectory, id)
  } catch (error: unknown) {
    if (error instanceof FleetFederationError && error.code === 'message-not-found') return false
    throw error
  }
  const currentAcknowledgement = await readAcknowledgement(rootDirectory, id)
  if (canonicalJson(currentRecord) !== canonicalJson(expected.record) ||
      canonicalJson(currentAcknowledgement) !== canonicalJson(expected.acknowledgement)) return false

  if (currentAcknowledgement !== null) {
    const path = acknowledgementPath(rootDirectory, id)
    await assertPrivateRegularFile(path, 'federation acknowledgement')
    await unlink(path)
  }
  const path = inboxPath(rootDirectory, id)
  await assertPrivateRegularFile(path, 'federation inbox record')
  await unlink(path)
  return true
}

/**
 * Applies only candidates that still occur in a freshly recomputed retention
 * plan. Every message is locked, reread and compared before its fixed inbox
 * and acknowledgement paths are removed. No caller-provided path is used.
 */
export async function applyFederationInboxPrune(
  input: ApplyFederationInboxPruneInput,
): Promise<ApplyFederationInboxPruneResult> {
  const nowText = nowIso(input.now)
  const now = Date.parse(nowText)
  planFederationInboxPrune([], input.policy, nowText)
  if (!Array.isArray(input.candidates)) {
    throw new FleetFederationError('retention-invalid', 'federation prune candidates must be an array')
  }
  const candidates = input.candidates.map(parsePruneCandidate)
  const seen = new Set<string>()
  for (const candidate of candidates) {
    if (seen.has(candidate.messageId)) {
      throw new FleetFederationError('retention-invalid', 'federation prune candidates must have unique message ids')
    }
    seen.add(candidate.messageId)
  }
  if (candidates.length === 0) return { pruned: [], skipped: [] }

  const rootDirectory = await ensureLayout(input.rootDirectory)
  const result: ApplyFederationInboxPruneResult = { pruned: [], skipped: [] }
  for (const candidate of candidates) {
    const release = await acquireMessageLock(rootDirectory, candidate.messageId)
    if (release === null) {
      result.skipped.push({ candidate, reason: 'busy' })
      continue
    }
    try {
      const items = await readAllFederationInbox(rootDirectory, now)
      const current = items.find(item => item.record.envelope.messageId === candidate.messageId)
      if (current === undefined) {
        result.skipped.push({ candidate, reason: 'missing' })
        continue
      }
      if (current.record.envelope.payloadDigest !== candidate.payloadDigest) {
        result.skipped.push({ candidate, reason: 'changed' })
        continue
      }
      const currentPlan = planFederationInboxPrune(items, input.policy, nowText)
      const planned = currentPlan.find(item => item.messageId === candidate.messageId)
      if (planned === undefined) {
        result.skipped.push({ candidate, reason: 'not-eligible' })
        continue
      }
      if (planned.payloadDigest !== candidate.payloadDigest || planned.reason !== candidate.reason) {
        result.skipped.push({ candidate, reason: 'plan-changed' })
        continue
      }
      if (now < Date.parse(current.record.envelope.expiresAt)) {
        result.skipped.push({ candidate, reason: 'not-eligible' })
        continue
      }
      if (!await deleteFederationInboxItem(rootDirectory, current)) {
        result.skipped.push({ candidate, reason: 'changed' })
        continue
      }
      result.pruned.push(candidate)
    } finally {
      await release()
    }
  }
  return result
}

export function safeFederationError(error: unknown): { code: string; message: string } {
  const raw = typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : 'internal'
  const messages: Record<FleetFederationErrorCode, string> = {
    'not-foreign-advisory': 'only signed foreign advisory messages are accepted',
    'invalid-state': 'federation inbox state or request is invalid',
    'unsafe-state-path': 'federation inbox contains an unsafe path',
    'unsafe-state-permissions': 'federation inbox permissions are unsafe',
    'message-conflict': 'federation message id is already bound to different content',
    'acknowledgement-conflict': 'the first federation acknowledgement is final',
    'message-not-found': 'federation message was not found',
    'message-busy': 'federation message is being updated',
    'retention-invalid': 'federation retention request is invalid',
  }
  return Object.hasOwn(messages, raw)
    ? { code: raw, message: messages[raw as FleetFederationErrorCode] }
    : { code: 'internal', message: 'federation request failed' }
}

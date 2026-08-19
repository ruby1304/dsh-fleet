import {
  createPrivateKey,
  createPublicKey,
  randomUUID,
  sign as cryptoSign,
  verify as cryptoVerify,
  type KeyObject,
} from 'node:crypto'
import { canonicalJson, sha256Canonical } from '../agent/protocol.ts'
import { normalizeDeviceId } from '../shared.ts'

export const FLEET_A2A_SCHEMA_VERSION = 1 as const
export const FLEET_A2A_KINDS = [
  'task.submit', 'task.status', 'task.cancel', 'task.progress', 'task.result',
  'approval.request', 'approval.decision', 'handoff',
  'receipt',
] as const

export type FleetA2AKind = (typeof FLEET_A2A_KINDS)[number]

export interface FleetA2ASender {
  principalId: string
  deviceId: string
  keyId: string
}

export interface FleetA2ARecipient {
  deviceId: string
}

export interface FleetA2AEnvelopeBody {
  schemaVersion: typeof FLEET_A2A_SCHEMA_VERSION
  teamId: string
  messageId: string
  sender: FleetA2ASender
  recipient: FleetA2ARecipient
  kind: FleetA2AKind
  issuedAt: string
  expiresAt: string
  payloadDigest: string
  payload: Record<string, unknown>
}

export interface FleetA2AEnvelope extends FleetA2AEnvelopeBody {
  signature: string
}

export interface FleetA2ATrustEntry {
  keyId: string
  principalId: string
  deviceId: string
  publicKeyPem: string
  allowedKinds: FleetA2AKind[]
}

export interface CreateA2AEnvelopeInput {
  teamId: string
  sender: Omit<FleetA2ASender, 'keyId'>
  recipient: FleetA2ARecipient
  kind: FleetA2AKind
  payload: Record<string, unknown>
  privateKey: string | Buffer | KeyObject
  now?: Date | string
  ttlMs?: number
  messageId?: string
}

export interface VerifyA2AEnvelopeInput {
  expectedTeamId: string
  expectedDeviceId: string
  trust: ReadonlyMap<string, FleetA2ATrustEntry> | Readonly<Record<string, FleetA2ATrustEntry>>
  now?: Date | string
  maxTtlMs?: number
}

export type FleetA2AErrorCode =
  | 'invalid-envelope'
  | 'invalid-payload'
  | 'invalid-time'
  | 'message-expired'
  | 'trust-denied'
  | 'signature-invalid'
  | 'recipient-mismatch'

export class FleetA2AError extends Error {
  readonly code: FleetA2AErrorCode

  constructor(code: FleetA2AErrorCode, message: string) {
    super(message)
    this.name = 'FleetA2AError'
    this.code = code
  }
}

const BODY_KEYS = [
  'schemaVersion', 'teamId', 'messageId', 'sender', 'recipient', 'kind', 'issuedAt', 'expiresAt', 'payloadDigest', 'payload',
] as const
const ENVELOPE_KEYS = [...BODY_KEYS, 'signature'] as const
const SENDER_KEYS = ['principalId', 'deviceId', 'keyId'] as const
const RECIPIENT_KEYS = ['deviceId'] as const
const MAX_PAYLOAD_BYTES = 48 * 1024
const DEFAULT_TTL_MS = 5 * 60 * 1000
const DEFAULT_MAX_TTL_MS = 15 * 60 * 1000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactKeys(value: unknown, keys: readonly string[], field: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw new FleetA2AError('invalid-envelope', field + ' must be an object')
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new FleetA2AError('invalid-envelope', field + ' has unsupported or missing fields')
  }
}

function text(value: unknown, field: string, maxLength = 128): string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim() || value.length > maxLength || /[\r\n\0]/.test(value)) {
    throw new FleetA2AError('invalid-payload', field + ' must be a bounded trimmed string')
  }
  return value
}

function longText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength || value.includes('\0')) {
    throw new FleetA2AError('invalid-payload', field + ' must be bounded non-empty text')
  }
  return value
}

function identifier(value: unknown, field: string): string {
  const result = text(value, field, 64)
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(result)) throw new FleetA2AError('invalid-payload', field + ' is invalid')
  return result
}

function messageId(value: unknown, field: string, prefix: 'msg' | 'task' | 'approval' | 'handoff'): string {
  const result = text(value, field, 64)
  if (!new RegExp('^' + prefix + ':[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$').test(result)) {
    throw new FleetA2AError('invalid-payload', field + ' must be a namespaced UUID')
  }
  return result
}

function digest(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) throw new FleetA2AError('invalid-envelope', field + ' must be a lowercase SHA-256 digest')
  return value
}

function canonicalTime(value: unknown, field: string): number {
  if (typeof value !== 'string') throw new FleetA2AError('invalid-time', field + ' must be a canonical ISO timestamp')
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new FleetA2AError('invalid-time', field + ' must be a canonical ISO timestamp')
  }
  return timestamp
}

function boundedInteger(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new FleetA2AError('invalid-payload', `${field} must be an integer from ${min} to ${max}`)
  }
  return value
}

function exactPayload(payload: Record<string, unknown>, keys: readonly string[], kind: FleetA2AKind): void {
  const actual = Object.keys(payload).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new FleetA2AError('invalid-payload', kind + ' payload has unsupported or missing fields')
  }
}

function taskId(value: unknown): string {
  return messageId(value, 'payload.taskId', 'task')
}

export function validateA2APayload(kind: FleetA2AKind, payload: unknown): asserts payload is Record<string, unknown> {
  if (!isRecord(payload)) throw new FleetA2AError('invalid-payload', kind + ' payload must be an object')
  if (Buffer.byteLength(canonicalJson(payload), 'utf8') > MAX_PAYLOAD_BYTES) {
    throw new FleetA2AError('invalid-payload', 'A2A payload exceeds the size limit')
  }
  if (kind === 'task.submit') {
    exactPayload(payload, ['taskId', 'workspaceId', 'profile', 'prompt'], kind)
    taskId(payload.taskId)
    identifier(payload.workspaceId, 'payload.workspaceId')
    identifier(payload.profile, 'payload.profile')
    longText(payload.prompt, 'payload.prompt', 32 * 1024)
    return
  }
  if (kind === 'task.status' || kind === 'task.cancel') {
    exactPayload(payload, ['taskId'], kind)
    taskId(payload.taskId)
    return
  }
  if (kind === 'task.progress') {
    exactPayload(payload, ['taskId', 'state', 'updatedAt'], kind)
    taskId(payload.taskId)
    if (!['accepted', 'running', 'cancel-requested'].includes(text(payload.state, 'payload.state', 24))) throw new FleetA2AError('invalid-payload', 'task progress state is invalid')
    canonicalTime(payload.updatedAt, 'payload.updatedAt')
    return
  }
  if (kind === 'task.result') {
    exactPayload(payload, ['taskId', 'state', 'updatedAt', 'resultDigest', 'result', 'truncated', 'errorCode'], kind)
    taskId(payload.taskId)
    if (!['succeeded', 'failed', 'cancelled'].includes(text(payload.state, 'payload.state', 16))) throw new FleetA2AError('invalid-payload', 'task result state is invalid')
    canonicalTime(payload.updatedAt, 'payload.updatedAt')
    if (payload.resultDigest !== null) digest(payload.resultDigest, 'payload.resultDigest')
    if (payload.result !== null) longText(payload.result, 'payload.result', 32 * 1024)
    if (typeof payload.truncated !== 'boolean') throw new FleetA2AError('invalid-payload', 'payload.truncated must be boolean')
    if (payload.errorCode !== null) identifier(payload.errorCode, 'payload.errorCode')
    return
  }
  if (kind === 'approval.request') {
    exactPayload(payload, ['approvalId', 'taskId', 'summary', 'expiresAt'], kind)
    messageId(payload.approvalId, 'payload.approvalId', 'approval')
    taskId(payload.taskId)
    longText(payload.summary, 'payload.summary', 2048)
    canonicalTime(payload.expiresAt, 'payload.expiresAt')
    return
  }
  if (kind === 'approval.decision') {
    exactPayload(payload, ['approvalId', 'taskId', 'decision'], kind)
    messageId(payload.approvalId, 'payload.approvalId', 'approval')
    taskId(payload.taskId)
    if (!['approved', 'denied'].includes(text(payload.decision, 'payload.decision', 16))) throw new FleetA2AError('invalid-payload', 'approval decision is invalid')
    return
  }
  if (kind === 'receipt') {
    exactPayload(payload, ['requestMessageId', 'status'], kind)
    messageId(payload.requestMessageId, 'payload.requestMessageId', 'msg')
    if (!['accepted', 'stored'].includes(text(payload.status, 'payload.status', 16))) throw new FleetA2AError('invalid-payload', 'receipt status is invalid')
    return
  }
  exactPayload(payload, ['handoffId', 'taskId', 'summary', 'artifactRefs'], kind)
  messageId(payload.handoffId, 'payload.handoffId', 'handoff')
  if (payload.taskId !== null) taskId(payload.taskId)
  longText(payload.summary, 'payload.summary', 8192)
  if (!Array.isArray(payload.artifactRefs) || payload.artifactRefs.length > 32 || payload.artifactRefs.some(ref => {
    try { text(ref, 'payload.artifactRefs[]', 512); return false } catch { return true }
  })) throw new FleetA2AError('invalid-payload', 'handoff artifactRefs are invalid')
}

function privateKey(value: CreateA2AEnvelopeInput['privateKey']): KeyObject {
  const key = value instanceof Object && 'type' in value ? value as KeyObject : createPrivateKey(value)
  if (key.asymmetricKeyType !== 'ed25519' || key.type !== 'private') throw new FleetA2AError('invalid-envelope', 'A2A private key must be Ed25519')
  return key
}

function publicKey(value: string): KeyObject {
  const key = createPublicKey(value)
  if (key.asymmetricKeyType !== 'ed25519' || key.type !== 'public') throw new FleetA2AError('trust-denied', 'trusted A2A key must be Ed25519')
  return key
}

export function a2aKeyId(key: string | Buffer | KeyObject): string {
  const publicObject = key instanceof Object && 'type' in key
    ? ((key as KeyObject).type === 'private' ? createPublicKey(key as KeyObject) : key as KeyObject)
    : createPublicKey(key)
  if (publicObject.asymmetricKeyType !== 'ed25519') throw new FleetA2AError('invalid-envelope', 'A2A key must be Ed25519')
  const der = publicObject.export({ type: 'spki', format: 'der' })
  return 'ed25519:' + sha256Canonical({ der: Buffer.from(der).toString('base64') })
}

function nowIso(value: Date | string | undefined): string {
  const date = value === undefined ? new Date() : value instanceof Date ? new Date(value.getTime()) : new Date(value)
  if (!Number.isFinite(date.getTime())) throw new FleetA2AError('invalid-time', 'now must be a valid timestamp')
  return date.toISOString()
}

export function createA2AEnvelope(input: CreateA2AEnvelopeInput): FleetA2AEnvelope {
  if (!FLEET_A2A_KINDS.includes(input.kind)) throw new FleetA2AError('invalid-payload', 'unsupported A2A kind')
  validateA2APayload(input.kind, input.payload)
  const key = privateKey(input.privateKey)
  const issuedAt = nowIso(input.now)
  const ttlMs = input.ttlMs ?? DEFAULT_TTL_MS
  boundedInteger(ttlMs, 'ttlMs', 1000, DEFAULT_MAX_TTL_MS)
  const body: FleetA2AEnvelopeBody = {
    schemaVersion: FLEET_A2A_SCHEMA_VERSION,
    teamId: identifier(input.teamId, 'teamId'),
    messageId: input.messageId === undefined ? 'msg:' + randomUUID() : messageId(input.messageId, 'messageId', 'msg'),
    sender: {
      principalId: identifier(input.sender.principalId, 'sender.principalId'),
      deviceId: normalizeDeviceId(input.sender.deviceId, 'sender.deviceId'),
      keyId: a2aKeyId(key),
    },
    recipient: { deviceId: normalizeDeviceId(input.recipient.deviceId, 'recipient.deviceId') },
    kind: input.kind,
    issuedAt,
    expiresAt: new Date(Date.parse(issuedAt) + ttlMs).toISOString(),
    payloadDigest: sha256Canonical(input.payload),
    payload: input.payload,
  }
  const signature = cryptoSign(null, Buffer.from(canonicalJson(body), 'utf8'), key).toString('base64url')
  return { ...body, signature }
}

function trustEntry(
  trust: VerifyA2AEnvelopeInput['trust'],
  keyId: string,
): FleetA2ATrustEntry | undefined {
  if (typeof (trust as ReadonlyMap<string, FleetA2ATrustEntry>).get === 'function') {
    return (trust as ReadonlyMap<string, FleetA2ATrustEntry>).get(keyId)
  }
  return (trust as Readonly<Record<string, FleetA2ATrustEntry>>)[keyId]
}

export function verifyA2AEnvelope(value: unknown, input: VerifyA2AEnvelopeInput): FleetA2AEnvelope {
  exactKeys(value, ENVELOPE_KEYS, 'A2A envelope')
  const envelope = value as unknown as FleetA2AEnvelope
  if (envelope.schemaVersion !== FLEET_A2A_SCHEMA_VERSION || !FLEET_A2A_KINDS.includes(envelope.kind)) {
    throw new FleetA2AError('invalid-envelope', 'unsupported A2A envelope version or kind')
  }
  exactKeys(envelope.sender, SENDER_KEYS, 'sender')
  exactKeys(envelope.recipient, RECIPIENT_KEYS, 'recipient')
  identifier(envelope.teamId, 'teamId')
  messageId(envelope.messageId, 'messageId', 'msg')
  identifier(envelope.sender.principalId, 'sender.principalId')
  normalizeDeviceId(envelope.sender.deviceId, 'sender.deviceId')
  normalizeDeviceId(envelope.recipient.deviceId, 'recipient.deviceId')
  if (!/^ed25519:[0-9a-f]{64}$/.test(envelope.sender.keyId)) throw new FleetA2AError('invalid-envelope', 'sender.keyId is invalid')
  digest(envelope.payloadDigest, 'payloadDigest')
  validateA2APayload(envelope.kind, envelope.payload)
  if (sha256Canonical(envelope.payload) !== envelope.payloadDigest) throw new FleetA2AError('signature-invalid', 'A2A payload digest does not match')
  const issuedAt = canonicalTime(envelope.issuedAt, 'issuedAt')
  const expiresAt = canonicalTime(envelope.expiresAt, 'expiresAt')
  const now = Date.parse(nowIso(input.now))
  const maxTtlMs = input.maxTtlMs ?? DEFAULT_MAX_TTL_MS
  boundedInteger(maxTtlMs, 'maxTtlMs', 1000, 24 * 60 * 60 * 1000)
  if (expiresAt <= issuedAt || expiresAt - issuedAt > maxTtlMs || issuedAt > now + 30_000) {
    throw new FleetA2AError('invalid-time', 'A2A envelope validity window is invalid')
  }
  if (now >= expiresAt) throw new FleetA2AError('message-expired', 'A2A envelope has expired')
  if (envelope.teamId !== input.expectedTeamId || envelope.recipient.deviceId !== input.expectedDeviceId) {
    throw new FleetA2AError('recipient-mismatch', 'A2A envelope targets a different team or device')
  }
  const trusted = trustEntry(input.trust, envelope.sender.keyId)
  if (trusted === undefined || trusted.principalId !== envelope.sender.principalId || trusted.deviceId !== envelope.sender.deviceId ||
      !trusted.allowedKinds.includes(envelope.kind)) {
    throw new FleetA2AError('trust-denied', 'A2A sender is not trusted for this message kind')
  }
  if (a2aKeyId(trusted.publicKeyPem) !== trusted.keyId || trusted.keyId !== envelope.sender.keyId) {
    throw new FleetA2AError('trust-denied', 'A2A trust entry key identity is invalid')
  }
  if (typeof envelope.signature !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(envelope.signature)) {
    throw new FleetA2AError('signature-invalid', 'A2A signature encoding is invalid')
  }
  const signature = Buffer.from(envelope.signature, 'base64url')
  const body = Object.fromEntries(BODY_KEYS.map(key => [key, envelope[key]])) as unknown as FleetA2AEnvelopeBody
  if (!cryptoVerify(null, Buffer.from(canonicalJson(body), 'utf8'), publicKey(trusted.publicKeyPem), signature)) {
    throw new FleetA2AError('signature-invalid', 'A2A signature is invalid')
  }
  return envelope
}

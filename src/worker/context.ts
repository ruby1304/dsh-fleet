import { isAbsolute, normalize } from 'node:path'
import { canonicalJson, sha256Canonical } from '../agent/protocol.ts'

export const MAX_TASK_TOOL_ARGUMENT_BYTES = 16 * 1024
export const TASK_BINDING_SCHEMA_VERSION = 2 as const
export const ALLOWED_ONCE_TOKEN_SCHEMA_VERSION = 2 as const

export type WorkerPolicyErrorCode =
  | 'invalid-arguments'
  | 'arguments-too-large'
  | 'invalid-context'

export class WorkerPolicyError extends Error {
  readonly code: WorkerPolicyErrorCode

  constructor(code: WorkerPolicyErrorCode, message: string) {
    super(message)
    this.name = 'WorkerPolicyError'
    this.code = code
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function boundedText(value: unknown, field: string, maxLength = 128): string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim() ||
      value.length > maxLength || /[\r\n\0]/.test(value)) {
    throw new WorkerPolicyError('invalid-context', field + ' must be a bounded trimmed string')
  }
  return value
}

function safeIdentifier(value: unknown, field: string): string {
  const result = boundedText(value, field, 64)
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(result)) {
    throw new WorkerPolicyError('invalid-context', field + ' is invalid')
  }
  return result
}

function namespacedId(value: unknown, field: string, prefix: 'msg' | 'task' | 'approval'): string {
  const result = boundedText(value, field, 64)
  if (!new RegExp('^' + prefix + ':[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$').test(result)) {
    throw new WorkerPolicyError('invalid-context', field + ' must be a namespaced UUID')
  }
  return result
}

function digest(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    throw new WorkerPolicyError('invalid-context', field + ' must be a lowercase SHA-256 digest')
  }
  return value
}

function canonicalTimestamp(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new WorkerPolicyError('invalid-context', field + ' must be a canonical ISO timestamp')
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new WorkerPolicyError('invalid-context', field + ' must be a canonical ISO timestamp')
  }
  return value
}

function absolutePath(value: unknown, field: string): string {
  const result = boundedText(value, field, 4096)
  if (!isAbsolute(result) || normalize(result) !== result) {
    throw new WorkerPolicyError('invalid-context', field + ' must be a normalized absolute path')
  }
  return result
}

function canonicalArguments(toolArguments: unknown, maxBytes: number): string {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_TASK_TOOL_ARGUMENT_BYTES) {
    throw new WorkerPolicyError('invalid-context', 'maxBytes exceeds the Fleet tool-argument ceiling')
  }
  if (!isRecord(toolArguments)) {
    throw new WorkerPolicyError('invalid-arguments', 'tool arguments must be a JSON object')
  }
  let canonical: string
  try {
    canonical = canonicalJson(toolArguments)
  } catch (error) {
    throw new WorkerPolicyError('invalid-arguments', error instanceof Error ? error.message : 'tool arguments are not canonical JSON')
  }
  if (Buffer.byteLength(canonical, 'utf8') > maxBytes) {
    throw new WorkerPolicyError('arguments-too-large', `tool arguments exceed ${maxBytes} bytes`)
  }
  return canonical
}

export function canonicalToolArguments(
  toolArguments: unknown,
  maxBytes = MAX_TASK_TOOL_ARGUMENT_BYTES,
): string {
  return canonicalArguments(toolArguments, maxBytes)
}

export function digestToolArguments(
  toolArguments: unknown,
  maxBytes = MAX_TASK_TOOL_ARGUMENT_BYTES,
): string {
  const canonical = canonicalArguments(toolArguments, maxBytes)
  return sha256Canonical(JSON.parse(canonical) as unknown)
}

export interface TaskBindingInput {
  teamId: string
  submitMessageId: string
  submitPayloadDigest: string
  sender: {
    principalId: string
    deviceId: string
    keyId: string
  }
  recipientDeviceId: string
  taskId: string
  workspaceId: string
  workspacePath: string
  profile: string
  executionProfileHash: string
  manifestDigest: string
  releaseDigest: string
  policyId: string
  policyDigest: string
  deadline: string
}

export function createTaskBindingDigest(input: TaskBindingInput): string {
  const senderKeyId = boundedText(input.sender.keyId, 'sender.keyId', 80)
  if (!/^ed25519:[0-9a-f]{64}$/.test(senderKeyId)) {
    throw new WorkerPolicyError('invalid-context', 'sender.keyId must be an Ed25519 key id')
  }
  const binding = {
    schemaVersion: TASK_BINDING_SCHEMA_VERSION,
    teamId: safeIdentifier(input.teamId, 'teamId'),
    submitMessageId: namespacedId(input.submitMessageId, 'submitMessageId', 'msg'),
    submitPayloadDigest: digest(input.submitPayloadDigest, 'submitPayloadDigest'),
    sender: {
      principalId: safeIdentifier(input.sender.principalId, 'sender.principalId'),
      deviceId: safeIdentifier(input.sender.deviceId, 'sender.deviceId'),
      keyId: senderKeyId,
    },
    recipientDeviceId: safeIdentifier(input.recipientDeviceId, 'recipientDeviceId'),
    taskId: namespacedId(input.taskId, 'taskId', 'task'),
    workspaceId: safeIdentifier(input.workspaceId, 'workspaceId'),
    workspacePath: absolutePath(input.workspacePath, 'workspacePath'),
    profile: safeIdentifier(input.profile, 'profile'),
    executionProfileHash: digest(input.executionProfileHash, 'executionProfileHash'),
    manifestDigest: digest(input.manifestDigest, 'manifestDigest'),
    releaseDigest: digest(input.releaseDigest, 'releaseDigest'),
    policyId: safeIdentifier(input.policyId, 'policyId'),
    policyDigest: digest(input.policyDigest, 'policyDigest'),
    deadline: canonicalTimestamp(input.deadline, 'deadline'),
  }
  return sha256Canonical(binding)
}

export interface AllowedOnceTokenInput {
  approvalId: string
  approvalRequestMessageId: string
  approvalRequestPayloadDigest: string
  decisionMessageId: string
  decisionPayloadDigest: string
  taskBindingDigest: string
  executionProfileHash: string
  toolCallId: string
  toolName: string
  argumentsDigest: string
  expiresAt: string
}

export interface AllowedOnceToken extends AllowedOnceTokenInput {
  schemaVersion: typeof ALLOWED_ONCE_TOKEN_SCHEMA_VERSION
  consumedAt: string | null
}

export function createAllowedOnceToken(input: AllowedOnceTokenInput): AllowedOnceToken {
  return {
    schemaVersion: ALLOWED_ONCE_TOKEN_SCHEMA_VERSION,
    approvalId: namespacedId(input.approvalId, 'approvalId', 'approval'),
    approvalRequestMessageId: namespacedId(input.approvalRequestMessageId, 'approvalRequestMessageId', 'msg'),
    approvalRequestPayloadDigest: digest(input.approvalRequestPayloadDigest, 'approvalRequestPayloadDigest'),
    decisionMessageId: namespacedId(input.decisionMessageId, 'decisionMessageId', 'msg'),
    decisionPayloadDigest: digest(input.decisionPayloadDigest, 'decisionPayloadDigest'),
    taskBindingDigest: digest(input.taskBindingDigest, 'taskBindingDigest'),
    executionProfileHash: digest(input.executionProfileHash, 'executionProfileHash'),
    toolCallId: boundedText(input.toolCallId, 'toolCallId'),
    toolName: safeIdentifier(input.toolName, 'toolName'),
    argumentsDigest: digest(input.argumentsDigest, 'argumentsDigest'),
    expiresAt: canonicalTimestamp(input.expiresAt, 'expiresAt'),
    consumedAt: null,
  }
}

export interface ToolExecutionBinding {
  taskBindingDigest: string
  executionProfileHash: string
  toolCallId: string
  toolName: string
  arguments: Record<string, unknown>
}

export type AllowedOnceDenialReason =
  | 'invalid-token'
  | 'already-consumed'
  | 'expired'
  | 'binding-mismatch'
  | 'invalid-arguments'

export type AllowedOnceConsumeResult =
  | { allowed: true; reason: 'allowed-once'; token: AllowedOnceToken }
  | { allowed: false; reason: AllowedOnceDenialReason; token: AllowedOnceToken }

function validateAllowedOnceToken(token: AllowedOnceToken): void {
  if (token.schemaVersion !== ALLOWED_ONCE_TOKEN_SCHEMA_VERSION) {
    throw new WorkerPolicyError('invalid-context', 'allowed-once token schema is unsupported')
  }
  namespacedId(token.approvalId, 'approvalId', 'approval')
  namespacedId(token.approvalRequestMessageId, 'approvalRequestMessageId', 'msg')
  digest(token.approvalRequestPayloadDigest, 'approvalRequestPayloadDigest')
  namespacedId(token.decisionMessageId, 'decisionMessageId', 'msg')
  digest(token.decisionPayloadDigest, 'decisionPayloadDigest')
  digest(token.taskBindingDigest, 'taskBindingDigest')
  digest(token.executionProfileHash, 'executionProfileHash')
  boundedText(token.toolCallId, 'toolCallId')
  safeIdentifier(token.toolName, 'toolName')
  digest(token.argumentsDigest, 'argumentsDigest')
  canonicalTimestamp(token.expiresAt, 'expiresAt')
  if (token.consumedAt !== null) canonicalTimestamp(token.consumedAt, 'consumedAt')
}

export function consumeAllowedOnceToken(
  token: AllowedOnceToken,
  execution: ToolExecutionBinding,
  now: Date | string,
  maxArgumentsBytes = MAX_TASK_TOOL_ARGUMENT_BYTES,
): AllowedOnceConsumeResult {
  try {
    validateAllowedOnceToken(token)
  } catch {
    return { allowed: false, reason: 'invalid-token', token }
  }
  if (token.consumedAt !== null) return { allowed: false, reason: 'already-consumed', token }

  let consumedAt: string
  try {
    consumedAt = canonicalTimestamp(now instanceof Date ? now.toISOString() : now, 'now')
  } catch {
    return { allowed: false, reason: 'invalid-token', token }
  }
  if (Date.parse(consumedAt) >= Date.parse(token.expiresAt)) {
    return { allowed: false, reason: 'expired', token }
  }
  if (execution.taskBindingDigest !== token.taskBindingDigest ||
      execution.executionProfileHash !== token.executionProfileHash ||
      execution.toolCallId !== token.toolCallId || execution.toolName !== token.toolName) {
    return { allowed: false, reason: 'binding-mismatch', token }
  }

  let argumentsDigest: string
  try {
    argumentsDigest = digestToolArguments(execution.arguments, maxArgumentsBytes)
  } catch {
    return { allowed: false, reason: 'invalid-arguments', token }
  }
  if (argumentsDigest !== token.argumentsDigest) {
    return { allowed: false, reason: 'binding-mismatch', token }
  }
  return { allowed: true, reason: 'allowed-once', token: { ...token, consumedAt } }
}

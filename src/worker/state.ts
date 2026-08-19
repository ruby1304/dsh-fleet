import { isAbsolute, normalize } from 'node:path'
import type { FleetA2AEnvelope, FleetTaskApprovalCapability } from '../a2a/protocol.ts'
import {
  calculateTaskPolicyDigest,
  type CanonicalTaskPolicy,
  type CanonicalTaskPolicyBody,
} from '../agent/config.ts'
import {
  digestToolArguments,
  type AllowedOnceToken,
} from './context.ts'

export const TASK_WORKER_CONTEXT_SCHEMA_VERSION = 2 as const
export const TASK_APPROVAL_INTENT_SCHEMA_VERSION = 2 as const
export const TASK_APPROVAL_DECISION_SCHEMA_VERSION = 2 as const

export interface FleetTaskWorkerContext {
  schemaVersion: typeof TASK_WORKER_CONTEXT_SCHEMA_VERSION
  taskId: string
  taskBindingDigest: string
  dshHome: string
  profile: string
  executionProfileHash: string
  workspacePath: string
  policy: CanonicalTaskPolicy
  approvalsDir: string
  cancelPath: string
  deadline: string
}

export interface FleetTaskApprovalIntent {
  schemaVersion: typeof TASK_APPROVAL_INTENT_SCHEMA_VERSION
  approvalId: string
  taskId: string
  taskBindingDigest: string
  executionProfileHash: string
  toolCallId: string
  toolName: string
  arguments: Record<string, unknown>
  argumentsDigest: string
  capability: FleetTaskApprovalCapability
  expiresAt: string
}

export interface FleetTaskApprovalDecisionFile {
  schemaVersion: typeof TASK_APPROVAL_DECISION_SCHEMA_VERSION
  decision: 'allowed-once' | 'rejected'
  decisionEnvelope: FleetA2AEnvelope
  token: AllowedOnceToken | null
}

function record(value: unknown, keys: readonly string[], field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError(field + ' must be an object')
  const raw = value as Record<string, unknown>
  const actual = Object.keys(raw).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(field + ' has unsupported or missing fields')
  }
  return raw
}

function text(value: unknown, field: string, max = 128): string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim() || value.length > max || /[\r\n\0]/.test(value)) {
    throw new TypeError(field + ' must be bounded text')
  }
  return value
}

function id(value: unknown, field: string, prefix: 'task' | 'approval'): string {
  const result = text(value, field, 64)
  if (!new RegExp('^' + prefix + ':[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$').test(result)) {
    throw new TypeError(field + ' must be a namespaced UUID')
  }
  return result
}

function digest(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) throw new TypeError(field + ' must be a SHA-256 digest')
  return value
}

function timestamp(value: unknown, field: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(Date.parse(value)).toISOString() !== value) {
    throw new TypeError(field + ' must be a canonical timestamp')
  }
  return value
}

function absolutePath(value: unknown, field: string): string {
  const result = text(value, field, 4096)
  if (!isAbsolute(result) || normalize(result) !== result) throw new TypeError(field + ' must be a normalized absolute path')
  return result
}

function parsePolicy(value: unknown): CanonicalTaskPolicy {
  const raw = record(value, [
    'schemaVersion', 'policyId', 'permissionMode', 'workspaceScope', 'defaultDecision', 'safeTools',
    'approvalRequiredTools', 'hardDeniedTools', 'allowBackground', 'maxArgumentsBytes', 'policyDigest',
  ], 'worker policy')
  if (raw.schemaVersion !== 1 || (raw.policyId !== 'readonly-v1' && raw.policyId !== 'workspace-write-ask-v1') ||
      (raw.permissionMode !== 'read-only' && raw.permissionMode !== 'workspace-write') ||
      raw.workspaceScope !== 'configured-workspace' || raw.defaultDecision !== 'deny' || raw.allowBackground !== false ||
      !Number.isSafeInteger(raw.maxArgumentsBytes) || typeof raw.maxArgumentsBytes !== 'number' || raw.maxArgumentsBytes < 1 || raw.maxArgumentsBytes > 16 * 1024) {
    throw new TypeError('worker policy is invalid')
  }
  for (const field of ['safeTools', 'approvalRequiredTools', 'hardDeniedTools'] as const) {
    const values = raw[field]
    if (!Array.isArray(values) || values.some(item => typeof item !== 'string') || new Set(values).size !== values.length) {
      throw new TypeError('worker policy tool lists are invalid')
    }
  }
  const policy = raw as unknown as CanonicalTaskPolicy
  const { policyDigest: rawDigest, ...body } = policy
  if (digest(rawDigest, 'worker policy digest') !== calculateTaskPolicyDigest(body as CanonicalTaskPolicyBody)) {
    throw new TypeError('worker policy digest does not match')
  }
  return policy
}

export function parseTaskWorkerContext(value: unknown): FleetTaskWorkerContext {
  const raw = record(value, [
    'schemaVersion', 'taskId', 'taskBindingDigest', 'dshHome', 'profile', 'executionProfileHash',
    'workspacePath', 'policy', 'approvalsDir', 'cancelPath', 'deadline',
  ], 'task worker context')
  if (raw.schemaVersion !== TASK_WORKER_CONTEXT_SCHEMA_VERSION) throw new TypeError('task worker context schema is unsupported')
  return {
    schemaVersion: TASK_WORKER_CONTEXT_SCHEMA_VERSION,
    taskId: id(raw.taskId, 'taskId', 'task'),
    taskBindingDigest: digest(raw.taskBindingDigest, 'taskBindingDigest'),
    dshHome: absolutePath(raw.dshHome, 'dshHome'),
    profile: text(raw.profile, 'profile', 64),
    executionProfileHash: digest(raw.executionProfileHash, 'executionProfileHash'),
    workspacePath: absolutePath(raw.workspacePath, 'workspacePath'),
    policy: parsePolicy(raw.policy),
    approvalsDir: absolutePath(raw.approvalsDir, 'approvalsDir'),
    cancelPath: absolutePath(raw.cancelPath, 'cancelPath'),
    deadline: timestamp(raw.deadline, 'deadline'),
  }
}

export function parseTaskApprovalIntent(value: unknown): FleetTaskApprovalIntent {
  const raw = record(value, [
    'schemaVersion', 'approvalId', 'taskId', 'taskBindingDigest', 'executionProfileHash', 'toolCallId', 'toolName', 'arguments',
    'argumentsDigest', 'capability', 'expiresAt',
  ], 'task approval intent')
  if (raw.schemaVersion !== TASK_APPROVAL_INTENT_SCHEMA_VERSION ||
      (raw.capability !== 'workspace-mutation' && raw.capability !== 'command-execution' && raw.capability !== 'network-access')) {
    throw new TypeError('task approval intent schema or capability is invalid')
  }
  if (typeof raw.arguments !== 'object' || raw.arguments === null || Array.isArray(raw.arguments)) {
    throw new TypeError('task approval intent arguments must be an object')
  }
  const argumentsDigest = digest(raw.argumentsDigest, 'argumentsDigest')
  if (digestToolArguments(raw.arguments) !== argumentsDigest) throw new TypeError('task approval intent arguments digest does not match')
  return {
    schemaVersion: TASK_APPROVAL_INTENT_SCHEMA_VERSION,
    approvalId: id(raw.approvalId, 'approvalId', 'approval'),
    taskId: id(raw.taskId, 'taskId', 'task'),
    taskBindingDigest: digest(raw.taskBindingDigest, 'taskBindingDigest'),
    executionProfileHash: digest(raw.executionProfileHash, 'executionProfileHash'),
    toolCallId: text(raw.toolCallId, 'toolCallId'),
    toolName: text(raw.toolName, 'toolName', 64),
    arguments: raw.arguments as Record<string, unknown>,
    argumentsDigest,
    capability: raw.capability,
    expiresAt: timestamp(raw.expiresAt, 'expiresAt'),
  }
}

export function approvalSegment(approvalId: string): string {
  return id(approvalId, 'approvalId', 'approval').slice('approval:'.length)
}

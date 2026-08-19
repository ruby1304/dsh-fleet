import { lstat, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  calculateTaskPolicyDigest,
  LOCAL_TASK_POLICIES,
  TASK_POLICY_IDS,
  type AgentTasksConfig,
  type CanonicalTaskPolicy,
  type CanonicalTaskPolicyBody,
  type TaskPolicyDecision,
  type TaskPolicyId,
} from '../agent/config.ts'
import { digestToolArguments, WorkerPolicyError } from './context.ts'

export type TaskApprovalCapability =
  | 'workspace-mutation'
  | 'command-execution'
  | 'network-access'

export type TaskToolClassificationReason =
  | 'safe-read'
  | 'signed-approval-required'
  | 'hard-denied-tool'
  | 'unknown-tool'
  | 'not-permitted-by-policy'
  | 'workspace-scope-denied'
  | 'background-execution-denied'
  | 'permission-escalation-denied'
  | 'invalid-arguments'
  | 'arguments-too-large'
  | 'invalid-policy'

export interface TaskToolClassification {
  decision: TaskPolicyDecision
  capability: TaskApprovalCapability | null
  argumentsDigest: string | null
  reason: TaskToolClassificationReason
}

export type TaskPolicyResolutionErrorCode =
  | 'unknown-policy'
  | 'policy-not-enabled'
  | 'policy-digest-mismatch'
  | 'invalid-local-policy'

export class TaskPolicyResolutionError extends Error {
  readonly code: TaskPolicyResolutionErrorCode

  constructor(code: TaskPolicyResolutionErrorCode, message: string) {
    super(message)
    this.name = 'TaskPolicyResolutionError'
    this.code = code
  }
}

function isTaskPolicyId(value: string): value is TaskPolicyId {
  return TASK_POLICY_IDS.includes(value as TaskPolicyId)
}

function policyBody(policy: CanonicalTaskPolicy): CanonicalTaskPolicyBody {
  const { policyDigest: _policyDigest, ...body } = policy
  return body
}

function hasValidLocalDigest(policy: CanonicalTaskPolicy): boolean {
  if (!isTaskPolicyId(policy.policyId)) return false
  const installed = LOCAL_TASK_POLICIES[policy.policyId]
  return policy.policyDigest === installed.policyDigest &&
    calculateTaskPolicyDigest(policyBody(policy)) === installed.policyDigest
}

export function resolveTaskPolicy(
  tasks: AgentTasksConfig,
  policyId: string,
  policyDigest: string,
): CanonicalTaskPolicy {
  if (!isTaskPolicyId(policyId)) {
    throw new TaskPolicyResolutionError('unknown-policy', 'requested task policy is not installed')
  }
  if (!/^[0-9a-f]{64}$/.test(policyDigest)) {
    throw new TaskPolicyResolutionError('policy-digest-mismatch', 'requested task policy digest is invalid')
  }
  if (tasks.policyIds?.includes(policyId) !== true) {
    throw new TaskPolicyResolutionError('policy-not-enabled', 'requested task policy is not enabled locally')
  }
  const policy = tasks.policies?.[policyId]
  if (policy === undefined || !hasValidLocalDigest(policy)) {
    throw new TaskPolicyResolutionError('invalid-local-policy', 'local task policy is missing or has lost integrity')
  }
  if (policy.policyDigest !== policyDigest) {
    throw new TaskPolicyResolutionError('policy-digest-mismatch', 'requested task policy digest does not match the local policy')
  }
  return policy
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isWorkspacePath(workspacePath: string, value: unknown, optional: boolean): boolean {
  if (value === undefined) return optional
  if (typeof value !== 'string' || value.trim().length === 0 || value.includes('\0')) return false
  const root = resolve(workspacePath)
  const target = resolve(root, value)
  const fromRoot = relative(root, target)
  return fromRoot === '' || (!fromRoot.startsWith('..' + sep) && fromRoot !== '..' && !isAbsolute(fromRoot))
}

function globPatternStaysWithinWorkspace(value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0') || isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value)) {
    return false
  }
  return !value.split(/[\\/]+/).includes('..')
}

function workspaceScopedToolArguments(
  toolName: string,
  toolArguments: Record<string, unknown>,
  workspacePath: string,
): boolean {
  if (toolName === 'read' || toolName === 'read_image' || toolName === 'write' || toolName === 'edit') {
    return isWorkspacePath(workspacePath, toolArguments.file_path, false)
  }
  if (toolName === 'glob') {
    return isWorkspacePath(workspacePath, toolArguments.path, true) && globPatternStaysWithinWorkspace(toolArguments.pattern)
  }
  if (toolName === 'grep') return isWorkspacePath(workspacePath, toolArguments.path, true)
  if (toolName === 'bash' || toolName === 'pwsh') return isWorkspacePath(workspacePath, toolArguments.workdir, true)
  return true
}

function contained(root: string, target: string): boolean {
  const fromRoot = relative(root, target)
  return fromRoot === '' || (!fromRoot.startsWith('..' + sep) && fromRoot !== '..' && !isAbsolute(fromRoot))
}

function filesystemTarget(
  toolName: string,
  toolArguments: Record<string, unknown>,
): { path: string; mutable: boolean } | null {
  if (toolName === 'read' || toolName === 'read_image') {
    return typeof toolArguments.file_path === 'string' ? { path: toolArguments.file_path, mutable: false } : null
  }
  if (toolName === 'write' || toolName === 'edit') {
    return typeof toolArguments.file_path === 'string' ? { path: toolArguments.file_path, mutable: true } : null
  }
  if (toolName === 'glob' || toolName === 'grep' || toolName === 'bash' || toolName === 'pwsh') {
    const value = toolArguments.path ?? toolArguments.workdir ?? '.'
    return typeof value === 'string' ? { path: value, mutable: false } : null
  }
  return null
}

/**
 * Re-resolves filesystem targets immediately before execution. Lexical scope
 * checks alone are insufficient because a path inside the workspace may be a
 * symlink to data outside it. Mutable targets also reject every symlink path
 * component and existing hard-linked files.
 */
export async function validateTaskToolFilesystemScope(input: {
  workspacePath: string
  toolName: string
  arguments: unknown
}): Promise<boolean> {
  if (!isAbsolute(input.workspacePath) || resolve(input.workspacePath) !== input.workspacePath || !isRecord(input.arguments)) return false
  const targetInput = filesystemTarget(input.toolName, input.arguments)
  if (targetInput === null) return true
  let root: string
  try {
    root = await realpath(input.workspacePath)
  } catch {
    return false
  }
  if (root !== input.workspacePath) return false
  const target = resolve(root, targetInput.path)
  if (!contained(root, target)) return false
  if (!targetInput.mutable) {
    try {
      return contained(root, await realpath(target))
    } catch {
      return false
    }
  }

  const pathFromRoot = relative(root, target)
  if (pathFromRoot === '') return false
  let current = root
  const segments = pathFromRoot.split(sep)
  for (let index = 0; index < segments.length; index += 1) {
    current = join(current, segments[index]!)
    let info
    try {
      info = await lstat(current)
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true
      return false
    }
    if (info.isSymbolicLink()) return false
    let resolved: string
    try {
      resolved = await realpath(current)
    } catch {
      return false
    }
    if (!contained(root, resolved)) return false
    if (index === segments.length - 1 && info.isFile() && info.nlink > 1) return false
  }
  return true
}

function capabilityFor(toolName: string): TaskApprovalCapability | null {
  if (toolName === 'write' || toolName === 'edit') return 'workspace-mutation'
  if (toolName === 'bash' || toolName === 'pwsh') return 'command-execution'
  if (toolName === 'web_search' || toolName === 'web_fetch') return 'network-access'
  return null
}

function denied(
  reason: TaskToolClassificationReason,
  argumentsDigest: string | null,
): TaskToolClassification {
  return { decision: 'deny', capability: null, argumentsDigest, reason }
}

export function classifyTaskToolCall(input: {
  policy: CanonicalTaskPolicy
  workspacePath: string
  toolName: string
  arguments: unknown
}): TaskToolClassification {
  if (!hasValidLocalDigest(input.policy)) return denied('invalid-policy', null)
  if (!isAbsolute(input.workspacePath) || resolve(input.workspacePath) !== input.workspacePath || !isRecord(input.arguments)) {
    return denied('invalid-arguments', null)
  }

  let argumentsDigest: string
  try {
    argumentsDigest = digestToolArguments(input.arguments, input.policy.maxArgumentsBytes)
  } catch (error) {
    return denied(error instanceof WorkerPolicyError && error.code === 'arguments-too-large'
      ? 'arguments-too-large'
      : 'invalid-arguments', null)
  }

  if (input.policy.hardDeniedTools.includes(input.toolName)) {
    return denied('hard-denied-tool', argumentsDigest)
  }
  const isSafe = input.policy.safeTools.includes(input.toolName)
  const needsApproval = input.policy.approvalRequiredTools.includes(input.toolName)
  if (!isSafe && !needsApproval) {
    const installedTool = Object.values(LOCAL_TASK_POLICIES).some(policy =>
      policy.safeTools.includes(input.toolName) || policy.approvalRequiredTools.includes(input.toolName) || policy.hardDeniedTools.includes(input.toolName))
    return denied(installedTool ? 'not-permitted-by-policy' : 'unknown-tool', argumentsDigest)
  }
  if (!workspaceScopedToolArguments(input.toolName, input.arguments, input.workspacePath)) {
    return denied('workspace-scope-denied', argumentsDigest)
  }
  if ((input.toolName === 'bash' || input.toolName === 'pwsh') && input.arguments.run_in_background === true) {
    return denied('background-execution-denied', argumentsDigest)
  }
  if (Object.hasOwn(input.arguments, 'sandbox_permissions') || Object.hasOwn(input.arguments, 'justification')) {
    return denied('permission-escalation-denied', argumentsDigest)
  }
  if (isSafe) return { decision: 'safe', capability: null, argumentsDigest, reason: 'safe-read' }

  const capability = capabilityFor(input.toolName)
  if (capability === null) return denied('invalid-policy', argumentsDigest)
  return { decision: 'ask', capability, argumentsDigest, reason: 'signed-approval-required' }
}

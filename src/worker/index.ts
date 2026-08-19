import { randomUUID } from 'node:crypto'
import { constants, existsSync } from 'node:fs'
import { lstat, mkdir, open, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { validateA2APayload, type FleetA2AEnvelope } from '../a2a/protocol.ts'
import { consumeAllowedOnceToken, type AllowedOnceToken } from './context.ts'
import { classifyTaskToolCall, validateTaskToolFilesystemScope } from './policy.ts'
import { assertExecutionProfileHash } from './profile.ts'
import {
  approvalSegment,
  parseTaskWorkerContext,
  TASK_APPROVAL_DECISION_SCHEMA_VERSION,
  TASK_APPROVAL_INTENT_SCHEMA_VERSION,
  type FleetTaskApprovalDecisionFile,
  type FleetTaskApprovalIntent,
} from './state.ts'

export const name = 'fleet-task-policy'
export const inject = ['tools']

interface ToolExecutionLike {
  readonly callId: string
  readonly name: string
  readonly arguments: unknown
  readonly signal: AbortSignal
}

interface WorkerContextLike {
  tools: { guard(callback: (execution: ToolExecutionLike) => string | undefined): () => void }
  on(
    name: 'tools/pre-execute',
    callback: (execution: ToolExecutionLike, next: () => Promise<{ kind: 'allow' | 'deny' | 'ask'; reason?: string }>) => Promise<{ kind: 'allow' | 'deny' | 'ask'; reason?: string }>,
    options?: { prepend?: boolean },
  ): () => void
}

function ownerOnly(info: { mode: number; uid: number }, field: string): void {
  if ((info.mode & 0o077) !== 0) throw new Error(field + ' must be owner-only')
  if (typeof process.getuid === 'function' && info.uid !== process.getuid()) throw new Error(field + ' must be owned by the current user')
}

async function readPrivateFile(path: string): Promise<string> {
  let handle
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    const info = await handle.stat()
    if (!info.isFile()) throw new Error('Fleet task policy state must use regular files')
    ownerOnly(info, 'Fleet task policy state')
    return await handle.readFile('utf8')
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') throw new Error('Fleet task policy state must not use symbolic links')
    throw error
  } finally {
    await handle?.close()
  }
}

async function ensurePrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 })
  const info = await lstat(path)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Fleet task approval state must be a real directory')
  ownerOnly(info, 'Fleet task approval directory')
}

async function writeExclusiveJson(path: string, value: unknown): Promise<void> {
  await ensurePrivateDirectory(dirname(path))
  let handle
  try {
    handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)
    await handle.writeFile(JSON.stringify(value, null, 2) + '\n')
    await handle.sync()
  } finally {
    await handle?.close()
  }
}

async function replacePrivateJson(path: string, value: unknown): Promise<void> {
  await ensurePrivateDirectory(dirname(path))
  const temporary = path + '.' + randomUUID() + '.tmp'
  try {
    await writeExclusiveJson(temporary, value)
    await rename(temporary, path)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}

function decisionFile(value: unknown): FleetTaskApprovalDecisionFile {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('approval decision must be an object')
  const raw = value as Record<string, unknown>
  const expected = ['decision', 'decisionEnvelope', 'schemaVersion', 'token']
  const actual = Object.keys(raw).sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error('approval decision has unsupported or missing fields')
  }
  if (raw.schemaVersion !== TASK_APPROVAL_DECISION_SCHEMA_VERSION ||
      (raw.decision !== 'allowed-once' && raw.decision !== 'rejected') ||
      typeof raw.decisionEnvelope !== 'object' || raw.decisionEnvelope === null || Array.isArray(raw.decisionEnvelope)) {
    throw new Error('approval decision is invalid')
  }
  const envelope = raw.decisionEnvelope as FleetA2AEnvelope
  if (envelope.kind !== 'task.approval.decision') throw new Error('approval decision envelope kind is invalid')
  validateA2APayload(envelope.kind, envelope.payload)
  if (envelope.payload.decision !== raw.decision) throw new Error('approval decision does not match its signed payload')
  if (raw.decision === 'rejected') {
    if (raw.token !== null) throw new Error('rejected approval must not contain a token')
    return { schemaVersion: TASK_APPROVAL_DECISION_SCHEMA_VERSION, decision: 'rejected', decisionEnvelope: envelope, token: null }
  }
  if (typeof raw.token !== 'object' || raw.token === null || Array.isArray(raw.token)) throw new Error('allowed approval token is missing')
  return {
    schemaVersion: TASK_APPROVAL_DECISION_SCHEMA_VERSION,
    decision: 'allowed-once',
    decisionEnvelope: envelope,
    token: raw.token as AllowedOnceToken,
  }
}

async function waitForApproval(
  worker: ReturnType<typeof parseTaskWorkerContext>,
  execution: ToolExecutionLike,
  classification: ReturnType<typeof classifyTaskToolCall>,
): Promise<boolean> {
  if (classification.decision !== 'ask' || classification.capability === null || classification.argumentsDigest === null ||
      typeof execution.arguments !== 'object' || execution.arguments === null || Array.isArray(execution.arguments)) return false
  const approvalId = 'approval:' + randomUUID()
  const approvalDirectory = join(worker.approvalsDir, approvalSegment(approvalId))
  await ensurePrivateDirectory(approvalDirectory)
  const expiresAt = new Date(Math.min(Date.parse(worker.deadline), Date.now() + 5 * 60 * 1000)).toISOString()
  if (Date.parse(expiresAt) <= Date.now()) return false
  const intent: FleetTaskApprovalIntent = {
    schemaVersion: TASK_APPROVAL_INTENT_SCHEMA_VERSION,
    approvalId,
    taskId: worker.taskId,
    taskBindingDigest: worker.taskBindingDigest,
    executionProfileHash: worker.executionProfileHash,
    toolCallId: execution.callId,
    toolName: execution.name,
    arguments: execution.arguments as Record<string, unknown>,
    argumentsDigest: classification.argumentsDigest,
    capability: classification.capability,
    expiresAt,
  }
  await writeExclusiveJson(join(approvalDirectory, 'intent.json'), intent)
  const decisionPath = join(approvalDirectory, 'decision.json')
  const consumedPath = join(approvalDirectory, 'consumed.json')
  while (!execution.signal.aborted && !existsSync(worker.cancelPath) && Date.now() < Date.parse(expiresAt)) {
    try {
      const decision = decisionFile(JSON.parse(await readPrivateFile(decisionPath)) as unknown)
      if (decision.decision === 'rejected' || decision.token === null || existsSync(consumedPath)) return false
      const result = consumeAllowedOnceToken(decision.token, {
        taskBindingDigest: worker.taskBindingDigest,
        executionProfileHash: worker.executionProfileHash,
        toolCallId: execution.callId,
        toolName: execution.name,
        arguments: execution.arguments as Record<string, unknown>,
      }, new Date())
      if (!result.allowed) return false
      await writeExclusiveJson(consumedPath, result.token)
      return true
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  await replacePrivateJson(join(approvalDirectory, 'expired.json'), { expiredAt: new Date().toISOString() })
  return false
}

export async function apply(ctx: Context): Promise<void> {
  const contextPath = process.env.DSH_FLEET_TASK_CONTEXT
  if (contextPath === undefined || contextPath.length === 0) throw new Error('DSH_FLEET_TASK_CONTEXT is required')
  const worker = parseTaskWorkerContext(JSON.parse(await readPrivateFile(contextPath)) as unknown)
  if (Date.now() >= Date.parse(worker.deadline)) throw new Error('Fleet task context has expired')
  await assertExecutionProfileHash(worker.dshHome, worker.profile, worker.executionProfileHash)
  await ensurePrivateDirectory(worker.approvalsDir)
  const runtime = ctx as unknown as WorkerContextLike
  const granted = new WeakSet<object>()
  runtime.on('tools/pre-execute', async (execution, next) => {
    try {
      await assertExecutionProfileHash(worker.dshHome, worker.profile, worker.executionProfileHash)
    } catch {
      return { kind: 'deny', reason: 'Fleet task policy denied: execution profile changed after task acceptance' }
    }
    const classification = classifyTaskToolCall({
      policy: worker.policy,
      workspacePath: worker.workspacePath,
      toolName: execution.name,
      arguments: execution.arguments,
    })
    if (classification.decision === 'deny') return { kind: 'deny', reason: 'Fleet task policy denied: ' + classification.reason }
    if (!await validateTaskToolFilesystemScope({
      workspacePath: worker.workspacePath,
      toolName: execution.name,
      arguments: execution.arguments,
    })) return { kind: 'deny', reason: 'Fleet task policy denied: resolved path escapes or changes the workspace boundary' }
    if (classification.decision === 'safe') return next()
    if (!await waitForApproval(worker, execution, classification)) {
      return { kind: 'deny', reason: 'Fleet signed approval was rejected, expired, cancelled, or unavailable' }
    }
    try {
      await assertExecutionProfileHash(worker.dshHome, worker.profile, worker.executionProfileHash)
    } catch {
      return { kind: 'deny', reason: 'Fleet task policy denied: execution profile changed during approval' }
    }
    granted.add(execution)
    return next()
  }, { prepend: true })
  runtime.tools.guard(execution => {
    const classification = classifyTaskToolCall({
      policy: worker.policy,
      workspacePath: worker.workspacePath,
      toolName: execution.name,
      arguments: execution.arguments,
    })
    if (classification.decision === 'safe') return undefined
    if (classification.decision === 'ask' && granted.delete(execution)) return undefined
    return 'Fleet final execution guard denied this tool call'
  })
}

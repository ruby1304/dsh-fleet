import { spawn } from 'node:child_process'
import { isAbsolute, normalize } from 'node:path'

const MAX_OUTPUT_BYTES = 1024 * 1024
const NON_MUTATION_TERMINATION_GRACE_MS = 30_000
// The Agent may use shutdown to durably reach a recoverable mutation state.
const MUTATION_TERMINATION_GRACE_MS = 10 * 60_000
const LOCAL_GROUP_DRAIN_MS = 2_000

export type AgentTransport = 'local' | 'ssh'
export type AgentCommand = 'inspect' | 'plan' | 'apply' | 'status'

export interface AgentTargetConfig {
  deviceId: string
  transport: AgentTransport
  sshHost?: string
  nodeBinary: string
  agentPath: string
  configPath: string
}

export interface AgentClientConfig {
  enabled: boolean
  timeoutMs: number
  targets: AgentTargetConfig[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export class AgentClientError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'AgentClientError'
    this.code = code
  }
}

interface AgentCallOptions {
  terminationGraceMs?: number
}

type StopReason = 'cancelled' | 'timeout' | 'output-limit'

function isMutationCommand(command: AgentCommand): boolean {
  return command === 'apply' || command === 'status'
}

export function agentTerminationGraceMs(command: AgentCommand): number {
  return isMutationCommand(command) ? MUTATION_TERMINATION_GRACE_MS : NON_MUTATION_TERMINATION_GRACE_MS
}

function safePath(value: string, field: string): string {
  if (!isAbsolute(value) || normalize(value) !== value || !/^\/[A-Za-z0-9._/-]+$/.test(value)) {
    throw new TypeError(field + ' must be a normalized absolute path without shell metacharacters')
  }
  return value
}

function nonEmpty(value: string, field: string): string {
  if (value.trim().length === 0) throw new TypeError(field + ' must not be empty')
  return value.trim()
}

export function validateAgentTarget(target: AgentTargetConfig): AgentTargetConfig {
  const deviceId = nonEmpty(target.deviceId, 'target.deviceId')
  if (!/^[A-Za-z0-9._-]+$/.test(deviceId)) throw new TypeError('target.deviceId contains unsupported characters')
  if (target.transport !== 'local' && target.transport !== 'ssh') throw new TypeError('target.transport must be local or ssh')
  const sshHost = target.sshHost?.trim()
  if (target.transport === 'ssh' && (sshHost === undefined || sshHost.startsWith('-') || !/^[A-Za-z0-9._-]+$/.test(sshHost))) {
    throw new TypeError('target.sshHost must be a configured host alias')
  }
  if (target.transport === 'local' && sshHost !== undefined) throw new TypeError('local target must not define sshHost')
  return {
    deviceId,
    transport: target.transport,
    ...(sshHost === undefined ? {} : { sshHost }),
    nodeBinary: safePath(target.nodeBinary, 'target.nodeBinary'),
    agentPath: safePath(target.agentPath, 'target.agentPath'),
    configPath: safePath(target.configPath, 'target.configPath'),
  }
}

function childInvocation(target: AgentTargetConfig, command: AgentCommand): { file: string; args: string[] } {
  const agentArgs = [target.nodeBinary, target.agentPath, '--config', target.configPath, command]
  if (target.transport === 'local') return { file: target.nodeBinary, args: agentArgs.slice(1) }
  return {
    file: '/usr/bin/ssh',
    args: [
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=8',
      '-o', 'ServerAliveInterval=5',
      '-o', 'ServerAliveCountMax=2',
      '--',
      target.sshHost as string,
      ...agentArgs,
    ],
  }
}

function safeAgentError(value: unknown): AgentClientError {
  const messages: Record<string, string> = {
    'unsupported-dsh-version': 'target DSH must be upgraded to rc.7 before convergence',
    'already-aligned': 'plugin is already aligned',
    'plugin-not-targeted': 'plugin is not targeted to this device',
    'plan-not-found': 'approved plan was not found',
    'approval-mismatch': 'approval no longer matches current target state',
    'plan-expired': 'plan has expired',
    'approval-expired': 'approval has expired',
  }
  const candidate = isRecord(value) ? value.code : undefined
  const code = typeof candidate === 'string' && Object.hasOwn(messages, candidate) ? candidate : 'agent-rejected'
  return new AgentClientError(code, messages[code] ?? 'fleet agent rejected the request')
}

export function interruptedAgentError(
  command: AgentCommand,
  reason: StopReason,
  terminationUnknown: boolean,
  mutationMayHaveStarted = true,
): AgentClientError {
  if (isMutationCommand(command) && mutationMayHaveStarted) {
    return new AgentClientError(
      'agent-mutation-unknown',
      'fleet mutation state is unknown; recover it with action-status before continuing',
    )
  }
  if (terminationUnknown) {
    return new AgentClientError(
      'agent-termination-unknown',
      'fleet agent process-group termination could not be confirmed',
    )
  }
  if (reason === 'cancelled') return new AgentClientError('cancelled', 'fleet agent request was cancelled')
  if (reason === 'timeout') return new AgentClientError('agent-timeout', 'fleet agent did not answer before the timeout')
  return new AgentClientError('agent-output-limit', 'fleet agent exceeded the output limit')
}

export function callAgent<T>(
  targetInput: AgentTargetConfig,
  command: AgentCommand,
  payload: unknown,
  timeoutMs: number,
  signal?: AbortSignal,
  options: AgentCallOptions = {},
): Promise<T> {
  const target = validateAgentTarget(targetInput)
  const invocation = childInvocation(target, command)
  const terminationGraceMs = options.terminationGraceMs ?? agentTerminationGraceMs(command)
  if (!Number.isSafeInteger(terminationGraceMs) || terminationGraceMs < 0) {
    throw new TypeError('terminationGraceMs must be a non-negative safe integer')
  }
  const request = JSON.stringify(payload) + '\n'
  return new Promise((resolve, reject) => {
    const isAborted = () => signal?.aborted === true
    if (isAborted()) {
      reject(new AgentClientError('cancelled', 'fleet agent request was cancelled'))
      return
    }
    const grouped = target.transport === 'local' && process.platform !== 'win32'
    const child = spawn(invocation.file, invocation.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      detached: grouped,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    })
    let stdout = ''
    let stdoutBytes = 0
    let stderrBytes = 0
    let settled = false
    let stopReason: StopReason | undefined
    let terminationUnknown = false
    let transportFailed = false
    let forceTimer: NodeJS.Timeout | undefined
    let timer: NodeJS.Timeout | undefined
    const killTransport = (killSignal: NodeJS.Signals) => {
      try {
        if (grouped && child.pid !== undefined) process.kill(-child.pid, killSignal)
        else child.kill(killSignal)
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
          try {
            child.kill(killSignal)
          } catch {
            // The close/error event remains the source of truth for process completion.
          }
        }
      }
    }
    const localGroupExists = () => {
      if (!grouped || child.pid === undefined) return false
      try {
        process.kill(-child.pid, 0)
        return true
      } catch (error: unknown) {
        return (error as NodeJS.ErrnoException).code !== 'ESRCH'
      }
    }
    const stopLocalGroup = async () => {
      if (!localGroupExists()) return
      killTransport('SIGKILL')
      const deadline = Date.now() + LOCAL_GROUP_DRAIN_MS
      while (localGroupExists() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10))
      terminationUnknown = localGroupExists()
    }
    const finish = (action: () => void) => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      if (forceTimer !== undefined) clearTimeout(forceTimer)
      signal?.removeEventListener('abort', abort)
      action()
    }
    const stop = (reason: StopReason) => {
      if (settled || stopReason !== undefined) return
      stopReason = reason
      if (timer !== undefined) clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      child.stdin.destroy()
      killTransport('SIGTERM')
      forceTimer = setTimeout(() => {
        killTransport('SIGKILL')
      }, terminationGraceMs)
      forceTimer.unref()
    }
    const abort = () => stop('cancelled')
    timer = setTimeout(() => stop('timeout'), timeoutMs)
    timer.unref()
    signal?.addEventListener('abort', abort, { once: true })
    if (isAborted()) abort()
    child.once('error', () => {
      transportFailed = true
      if (child.pid === undefined) {
        finish(() => reject(stopReason === undefined
          ? new AgentClientError('agent-unavailable', 'fleet agent transport is unavailable')
          : interruptedAgentError(command, stopReason, false, false)))
      }
    })
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      if (stopReason !== undefined) return
      stdoutBytes += Buffer.byteLength(chunk)
      if (stdoutBytes > MAX_OUTPUT_BYTES) {
        stop('output-limit')
        return
      }
      stdout += chunk
    })
    child.stderr.on('data', (chunk: Buffer) => {
      if (stopReason !== undefined) return
      stderrBytes += chunk.length
      if (stderrBytes > MAX_OUTPUT_BYTES) stop('output-limit')
    })
    child.once('close', async code => {
      if (stopReason !== undefined) await stopLocalGroup()
      finish(() => {
        if (stopReason !== undefined) {
          reject(interruptedAgentError(command, stopReason, terminationUnknown))
          return
        }
        if (transportFailed) {
          reject(new AgentClientError('agent-unavailable', 'fleet agent transport is unavailable'))
          return
        }
        if (code !== 0) {
          reject(new AgentClientError('agent-failed', 'fleet agent command failed'))
          return
        }
        let response: unknown
        try {
          response = JSON.parse(stdout) as unknown
        } catch {
          reject(new AgentClientError('agent-protocol', 'fleet agent returned an invalid response'))
          return
        }
        if (!isRecord(response) || typeof response.ok !== 'boolean') {
          reject(new AgentClientError('agent-protocol', 'fleet agent returned an invalid response'))
          return
        }
        if (response.ok !== true) {
          reject(safeAgentError(response.error))
          return
        }
        if (!Object.hasOwn(response, 'value')) {
          reject(new AgentClientError('agent-protocol', 'fleet agent returned an invalid response'))
          return
        }
        resolve(response.value as T)
      })
    })
    child.stdin.on('error', () => {
      // A child may close stdin before reading the request; close/error handles the outcome.
    })
    if (stopReason === undefined) child.stdin.end(request)
  })
}

export function createAgentClient(config: AgentClientConfig) {
  const targets = config.targets.map(validateAgentTarget)
  const ids = new Set<string>()
  for (const target of targets) {
    if (ids.has(target.deviceId)) throw new TypeError('fleet target deviceId values must be unique')
    ids.add(target.deviceId)
  }
  const byId = new Map(targets.map(target => [target.deviceId, target]))
  return {
    enabled: config.enabled,
    targets: targets.map(target => ({ deviceId: target.deviceId, transport: target.transport })),
    async call<T>(deviceId: string, command: AgentCommand, payload: unknown, signal?: AbortSignal): Promise<T> {
      if (!config.enabled) throw new AgentClientError('agent-disabled', 'fleet convergence is disabled')
      const target = byId.get(deviceId)
      if (target === undefined) throw new AgentClientError('target-not-found', 'fleet target is not configured')
      return callAgent<T>(target, command, payload, config.timeoutMs, signal)
    },
  }
}

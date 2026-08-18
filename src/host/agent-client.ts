import { spawn } from 'node:child_process'
import { isAbsolute, normalize } from 'node:path'

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

export function callAgent<T>(targetInput: AgentTargetConfig, command: AgentCommand, payload: unknown, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  const target = validateAgentTarget(targetInput)
  const invocation = childInvocation(target, command)
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new AgentClientError('cancelled', 'fleet agent request was cancelled'))
      return
    }
    const child = spawn(invocation.file, invocation.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    })
    let stdout = ''
    let stderrBytes = 0
    let settled = false
    const finish = (action: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      action()
    }
    const abort = () => {
      child.kill('SIGTERM')
      finish(() => reject(new AgentClientError('cancelled', 'fleet agent request was cancelled')))
    }
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      finish(() => reject(new AgentClientError('agent-timeout', 'fleet agent did not answer before the timeout')))
    }, timeoutMs)
    timer.unref()
    signal?.addEventListener('abort', abort, { once: true })
    child.once('error', () => finish(() => reject(new AgentClientError('agent-unavailable', 'fleet agent transport is unavailable'))))
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      if (stdout.length <= 1024 * 1024) stdout += chunk
      if (stdout.length > 1024 * 1024) child.kill('SIGTERM')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.length
      if (stderrBytes > 1024 * 1024) child.kill('SIGTERM')
    })
    child.once('close', code => {
      finish(() => {
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
    child.stdin.end(JSON.stringify(payload) + '\n')
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

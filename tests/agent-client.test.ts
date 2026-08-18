import { access, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  agentTerminationGraceMs,
  callAgent,
  createAgentClient,
  interruptedAgentError,
  validateAgentTarget,
  type AgentTargetConfig,
} from '../src/host/agent-client.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fakeAgent(source: string): Promise<AgentTargetConfig> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-fleet-agent-client-'))
  roots.push(root)
  const nodeBinary = join(root, 'node')
  const agentPath = join(root, 'agent.mjs')
  const configPath = join(root, 'agent.config.json')
  await symlink(process.execPath, nodeBinary)
  await writeFile(agentPath, source)
  await writeFile(configPath, '{}\n')
  return {
    deviceId: 'local-smoke',
    transport: 'local',
    nodeBinary,
    agentPath,
    configPath,
  }
}

async function waitForFile(path: string, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await access(path)
      return
    } catch {
      await new Promise(resolve => setTimeout(resolve, 10))
    }
  }
  throw new Error('timed out waiting for fixture file: ' + path)
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error: unknown) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

function validTarget(): AgentTargetConfig {
  return {
    deviceId: 'worker',
    transport: 'local',
    nodeBinary: '/opt/homebrew/bin/node',
    agentPath: '/Users/example/src/dsh-fleet/agent.mjs',
    configPath: '/Users/example/.config/dsh-fleet/agent.json',
  }
}

describe('agent target validation', () => {
  it.each([
    ['nodeBinary', '/opt/homebrew/bin/node;touch-pwned'],
    ['agentPath', '/Users/example/src/agent$(id).mjs'],
    ['configPath', '/Users/example/config.json\n--evil'],
    ['agentPath', '/Users/example/src/../secret/agent.mjs'],
  ] satisfies Array<[keyof AgentTargetConfig, string]>)('rejects injection or non-normalized %s paths', (field, value) => {
    expect(() => validateAgentTarget({ ...validTarget(), [field]: value })).toThrowError(
      expect.objectContaining({ message: expect.stringContaining('normalized absolute path') }),
    )
  })

  it.each([
    'worker-mac;touch-pwned',
    'worker-mac -oProxyCommand=evil',
    'user@worker-mac',
    'worker-mac\nother-host',
    '-V',
    '-F',
  ])('rejects unsafe SSH host aliases without starting SSH: %j', sshHost => {
    expect(() => validateAgentTarget({
      ...validTarget(),
      transport: 'ssh',
      sshHost,
    })).toThrowError(expect.objectContaining({ message: 'target.sshHost must be a configured host alias' }))
  })
})

describe('interrupted agent errors', () => {
  it.each([
    ['apply', 'cancelled'],
    ['apply', 'timeout'],
    ['apply', 'output-limit'],
    ['status', 'cancelled'],
    ['status', 'timeout'],
    ['status', 'output-limit'],
  ] as const)(
    'keeps an interrupted %s mutation unknown after %s',
    (command, reason) => {
      expect(interruptedAgentError(command, reason, false)).toMatchObject({
        code: 'agent-mutation-unknown',
        message: 'fleet mutation state is unknown; recover it with action-status before continuing',
      })
    },
  )

  it.each(['apply', 'status'] as const)('keeps a %s cancellation definitive before the process starts', command => {
    expect(interruptedAgentError(command, 'cancelled', false, false)).toMatchObject({
      code: 'cancelled',
      message: 'fleet agent request was cancelled',
    })
  })

  it('uses a fixed termination error when a non-mutating local process group cannot be drained', () => {
    expect(interruptedAgentError('inspect', 'cancelled', true)).toMatchObject({
      code: 'agent-termination-unknown',
      message: 'fleet agent process-group termination could not be confirmed',
    })
  })

  it('allows the Agent full mutation convergence time before forced termination', () => {
    expect(agentTerminationGraceMs('apply')).toBe(10 * 60_000)
    expect(agentTerminationGraceMs('status')).toBe(10 * 60_000)
    expect(agentTerminationGraceMs('inspect')).toBe(30_000)
    expect(agentTerminationGraceMs('plan')).toBe(30_000)
  })
})

describe('local agent transport', () => {
  it('sends one JSON request on stdin and returns the decoded value', async () => {
    const target = await fakeAgent(`
      const chunks = []
      for await (const chunk of process.stdin) chunks.push(chunk)
      const raw = Buffer.concat(chunks).toString('utf8')
      process.stdout.write(JSON.stringify({
        ok: true,
        value: {
          payload: JSON.parse(raw),
          argv: process.argv.slice(2),
          lineTerminated: raw.endsWith('\\n'),
          lineCount: raw.split('\\n').length - 1,
        },
      }))
    `)

    await expect(callAgent<{
      payload: unknown
      argv: string[]
      lineTerminated: boolean
      lineCount: number
    }>(target, 'inspect', { requestId: 'request-01', nested: { enabled: true } }, 2_000)).resolves.toEqual({
      payload: { requestId: 'request-01', nested: { enabled: true } },
      argv: ['--config', target.configPath, 'inspect'],
      lineTerminated: true,
      lineCount: 1,
    })
  })

  it('maps a non-zero exit to a fixed error without exposing output', async () => {
    const target = await fakeAgent(`
      process.stderr.write('token=non-zero-secret')
      process.stdout.write('stdout-secret')
      process.exit(23)
    `)

    const error = await callAgent(target, 'status', {}, 2_000).catch((reason: unknown) => reason)
    expect(error).toMatchObject({
      name: 'AgentClientError',
      code: 'agent-failed',
      message: 'fleet agent command failed',
    })
    expect(String(error)).not.toContain('secret')
  })

  it('maps invalid JSON to a fixed protocol error without exposing stdout', async () => {
    const target = await fakeAgent(`process.stdout.write('token=invalid-json-secret')`)

    const error = await callAgent(target, 'inspect', {}, 2_000).catch((reason: unknown) => reason)
    expect(error).toMatchObject({
      name: 'AgentClientError',
      code: 'agent-protocol',
      message: 'fleet agent returned an invalid response',
    })
    expect(String(error)).not.toContain('secret')
  })

  it.each(['null', '{}', '{"ok":true}'])('rejects a malformed JSON envelope without throwing: %s', async source => {
    const target = await fakeAgent(`process.stdout.write(${JSON.stringify(source)})`)
    await expect(callAgent(target, 'inspect', {}, 2_000)).rejects.toMatchObject({
      name: 'AgentClientError',
      code: 'agent-protocol',
      message: 'fleet agent returned an invalid response',
    })
  })

  it('waits for stdout to close before parsing a larger response', async () => {
    const target = await fakeAgent(`
      process.stdout.write(JSON.stringify({ ok: true, value: { payload: 'x'.repeat(512 * 1024) } }))
    `)
    const result = await callAgent<{ payload: string }>(target, 'inspect', {}, 2_000)
    expect(result.payload).toHaveLength(512 * 1024)
  })

  it('maps an agent-declared failure to a fixed rejection without exposing its message', async () => {
    const target = await fakeAgent(`
      process.stdout.write(JSON.stringify({
        ok: false,
        error: { code: 'request-denied', message: 'token=agent-declared-secret' },
      }))
    `)

    const error = await callAgent(target, 'plan', {}, 2_000).catch((reason: unknown) => reason)
    expect(error).toMatchObject({
      name: 'AgentClientError',
      code: 'agent-rejected',
      message: 'fleet agent rejected the request',
    })
    expect(String(error)).not.toContain('secret')
  })

  it('terminates and rejects an agent that exceeds the configured timeout', async () => {
    const target = await fakeAgent(`
      import { spawn } from 'node:child_process'
      import { writeFile } from 'node:fs/promises'
      const worker = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        detached: true,
        stdio: 'ignore',
      })
      process.on('SIGTERM', () => {
        process.kill(-worker.pid, 'SIGTERM')
        worker.once('close', async () => {
          await writeFile(process.env.DSH_FLEET_TEST_CLOSED_FILE, 'closed')
          process.exit(0)
        })
      })
      await writeFile(process.env.DSH_FLEET_TEST_PID_FILE, String(worker.pid))
      setInterval(() => {}, 1_000)
    `)
    const root = target.configPath.slice(0, target.configPath.lastIndexOf('/'))
    const pidFile = join(root, 'worker.pid')
    const closedFile = join(root, 'worker.closed')
    const originalPidFile = process.env.DSH_FLEET_TEST_PID_FILE
    const originalClosedFile = process.env.DSH_FLEET_TEST_CLOSED_FILE
    process.env.DSH_FLEET_TEST_PID_FILE = pidFile
    process.env.DSH_FLEET_TEST_CLOSED_FILE = closedFile
    const request = callAgent(target, 'status', {}, 250)
    try {
      await expect(request).rejects.toMatchObject({
        name: 'AgentClientError',
        code: 'agent-mutation-unknown',
        message: 'fleet mutation state is unknown; recover it with action-status before continuing',
      })
      await expect(readFile(closedFile, 'utf8')).resolves.toBe('closed')
      const pid = Number(await readFile(pidFile, 'utf8'))
      expect(processAlive(pid)).toBe(false)
    } finally {
      if (originalPidFile === undefined) delete process.env.DSH_FLEET_TEST_PID_FILE
      else process.env.DSH_FLEET_TEST_PID_FILE = originalPidFile
      if (originalClosedFile === undefined) delete process.env.DSH_FLEET_TEST_CLOSED_FILE
      else process.env.DSH_FLEET_TEST_CLOSED_FILE = originalClosedFile
    }
  })

  it('waits for a detached descendant to stop before rejecting an abort', async () => {
    const target = await fakeAgent(`
      import { spawn } from 'node:child_process'
      import { writeFile } from 'node:fs/promises'
      const worker = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        detached: true,
        stdio: 'ignore',
      })
      process.on('SIGTERM', () => {
        process.kill(-worker.pid, 'SIGTERM')
        worker.once('close', async () => {
          await writeFile(process.env.DSH_FLEET_TEST_CLOSED_FILE, 'closed')
          process.exit(0)
        })
      })
      await writeFile(process.env.DSH_FLEET_TEST_PID_FILE, String(worker.pid))
      setInterval(() => {}, 1_000)
    `)
    const root = target.configPath.slice(0, target.configPath.lastIndexOf('/'))
    const pidFile = join(root, 'worker.pid')
    const closedFile = join(root, 'worker.closed')
    const originalPidFile = process.env.DSH_FLEET_TEST_PID_FILE
    const originalClosedFile = process.env.DSH_FLEET_TEST_CLOSED_FILE
    process.env.DSH_FLEET_TEST_PID_FILE = pidFile
    process.env.DSH_FLEET_TEST_CLOSED_FILE = closedFile
    const controller = new AbortController()
    const request = callAgent(target, 'apply', {}, 2_000, controller.signal)
    try {
      await waitForFile(pidFile)
      controller.abort()
      await expect(request).rejects.toMatchObject({
        name: 'AgentClientError',
        code: 'agent-mutation-unknown',
        message: 'fleet mutation state is unknown; recover it with action-status before continuing',
      })
      await expect(readFile(closedFile, 'utf8')).resolves.toBe('closed')
      const pid = Number(await readFile(pidFile, 'utf8'))
      expect(processAlive(pid)).toBe(false)
    } finally {
      if (originalPidFile === undefined) delete process.env.DSH_FLEET_TEST_PID_FILE
      else process.env.DSH_FLEET_TEST_PID_FILE = originalPidFile
      if (originalClosedFile === undefined) delete process.env.DSH_FLEET_TEST_CLOSED_FILE
      else process.env.DSH_FLEET_TEST_CLOSED_FILE = originalClosedFile
    }
  })

  it('escalates from TERM to KILL and waits for close', async () => {
    const target = await fakeAgent(`
      import { writeFile } from 'node:fs/promises'
      process.on('SIGTERM', () => {})
      await writeFile(process.env.DSH_FLEET_TEST_PID_FILE, String(process.pid))
      setInterval(() => {}, 1_000)
    `)
    const root = target.configPath.slice(0, target.configPath.lastIndexOf('/'))
    const pidFile = join(root, 'agent.pid')
    const originalPidFile = process.env.DSH_FLEET_TEST_PID_FILE
    process.env.DSH_FLEET_TEST_PID_FILE = pidFile
    const controller = new AbortController()
    const request = callAgent(target, 'status', {}, 2_000, controller.signal, { terminationGraceMs: 50 })
    try {
      await waitForFile(pidFile)
      controller.abort()
      await expect(request).rejects.toMatchObject({
        code: 'agent-mutation-unknown',
        message: 'fleet mutation state is unknown; recover it with action-status before continuing',
      })
      const pid = Number(await readFile(pidFile, 'utf8'))
      expect(processAlive(pid)).toBe(false)
    } finally {
      if (originalPidFile === undefined) delete process.env.DSH_FLEET_TEST_PID_FILE
      else process.env.DSH_FLEET_TEST_PID_FILE = originalPidFile
    }
  })

  it('reports an unknown mutation after a local apply requires KILL', async () => {
    const target = await fakeAgent(`
      import { writeFile } from 'node:fs/promises'
      process.on('SIGTERM', () => {})
      await writeFile(process.env.DSH_FLEET_TEST_PID_FILE, String(process.pid))
      setInterval(() => {}, 1_000)
    `)
    const root = target.configPath.slice(0, target.configPath.lastIndexOf('/'))
    const pidFile = join(root, 'agent.pid')
    const originalPidFile = process.env.DSH_FLEET_TEST_PID_FILE
    process.env.DSH_FLEET_TEST_PID_FILE = pidFile
    const controller = new AbortController()
    const request = callAgent(target, 'apply', {}, 2_000, controller.signal, { terminationGraceMs: 50 })
    try {
      await waitForFile(pidFile)
      controller.abort()
      await expect(request).rejects.toMatchObject({
        name: 'AgentClientError',
        code: 'agent-mutation-unknown',
        message: 'fleet mutation state is unknown; recover it with action-status before continuing',
      })
      const pid = Number(await readFile(pidFile, 'utf8'))
      expect(processAlive(pid)).toBe(false)
    } finally {
      if (originalPidFile === undefined) delete process.env.DSH_FLEET_TEST_PID_FILE
      else process.env.DSH_FLEET_TEST_PID_FILE = originalPidFile
    }
  })

  it('kills same-group survivors and reports the recovery mutation as unknown', async () => {
    const target = await fakeAgent(`
      import { spawn } from 'node:child_process'
      import { writeFile } from 'node:fs/promises'
      const worker = spawn(process.execPath, ['-e', \`
        process.on('SIGTERM', () => {})
        process.send('ready')
        setInterval(() => {}, 1000)
      \`], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
      process.on('SIGTERM', () => process.exit(0))
      worker.once('message', async () => {
        await writeFile(process.env.DSH_FLEET_TEST_PID_FILE, String(worker.pid))
      })
      setInterval(() => {}, 1_000)
    `)
    const root = target.configPath.slice(0, target.configPath.lastIndexOf('/'))
    const pidFile = join(root, 'worker.pid')
    const originalPidFile = process.env.DSH_FLEET_TEST_PID_FILE
    process.env.DSH_FLEET_TEST_PID_FILE = pidFile
    const controller = new AbortController()
    const request = callAgent(target, 'status', {}, 2_000, controller.signal, { terminationGraceMs: 500 })
    try {
      await waitForFile(pidFile)
      controller.abort()
      await expect(request).rejects.toMatchObject({
        code: 'agent-mutation-unknown',
        message: 'fleet mutation state is unknown; recover it with action-status before continuing',
      })
      const pid = Number(await readFile(pidFile, 'utf8'))
      expect(processAlive(pid)).toBe(false)
    } finally {
      if (originalPidFile === undefined) delete process.env.DSH_FLEET_TEST_PID_FILE
      else process.env.DSH_FLEET_TEST_PID_FILE = originalPidFile
    }
  })

  it.each(['apply', 'status'] as const)('does not start an SSH %s when its signal is already aborted', async command => {
    const controller = new AbortController()
    controller.abort()
    await expect(callAgent({
      ...validTarget(),
      transport: 'ssh',
      sshHost: 'must-not-be-contacted',
    }, command, {}, 2_000, controller.signal)).rejects.toMatchObject({
      code: 'cancelled',
      message: 'fleet agent request was cancelled',
    })
  })

  it.each(['stdout', 'stderr'] as const)('terminates and rejects a non-mutating agent that exceeds the %s limit', async stream => {
    const target = await fakeAgent(`
      process.on('SIGTERM', () => process.exit(0))
      process.${stream}.write('x'.repeat(1024 * 1024 + 1))
      setInterval(() => {}, 1_000)
    `)

    await expect(callAgent(target, 'inspect', {}, 2_000, undefined, { terminationGraceMs: 50 })).rejects.toMatchObject({
      name: 'AgentClientError',
      code: 'agent-output-limit',
      message: 'fleet agent exceeded the output limit',
    })
  })
})

describe('configured agent client', () => {
  it('returns fixed disabled and target-not-found errors before spawning an agent', async () => {
    const disabled = createAgentClient({ enabled: false, timeoutMs: 100, targets: [] })
    await expect(disabled.call('missing', 'inspect', {})).rejects.toMatchObject({
      name: 'AgentClientError',
      code: 'agent-disabled',
      message: 'fleet convergence is disabled',
    })

    const enabled = createAgentClient({ enabled: true, timeoutMs: 100, targets: [] })
    await expect(enabled.call('missing', 'inspect', {})).rejects.toMatchObject({
      name: 'AgentClientError',
      code: 'target-not-found',
      message: 'fleet target is not configured',
    })
  })

  it('rejects duplicate device ids before building an ambiguous route map', () => {
    expect(() => createAgentClient({
      enabled: true,
      timeoutMs: 100,
      targets: [validTarget(), { ...validTarget(), transport: 'ssh', sshHost: 'worker-mac' }],
    })).toThrowError('fleet target deviceId values must be unique')
  })
})

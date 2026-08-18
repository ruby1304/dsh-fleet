import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  callAgent,
  createAgentClient,
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

function validTarget(): AgentTargetConfig {
  return {
    deviceId: 'm3-worker',
    transport: 'local',
    nodeBinary: '/opt/homebrew/bin/node',
    agentPath: '/Users/qudian/dev/dsh-fleet/agent.mjs',
    configPath: '/Users/qudian/.dsh-fleet-agent/config.json',
  }
}

describe('agent target validation', () => {
  it.each([
    ['nodeBinary', '/opt/homebrew/bin/node;touch-pwned'],
    ['agentPath', '/Users/qudian/dev/agent$(id).mjs'],
    ['configPath', '/Users/qudian/config.json\n--evil'],
    ['agentPath', '/Users/qudian/dev/../secret/agent.mjs'],
  ] satisfies Array<[keyof AgentTargetConfig, string]>)('rejects injection or non-normalized %s paths', (field, value) => {
    expect(() => validateAgentTarget({ ...validTarget(), [field]: value })).toThrowError(
      expect.objectContaining({ message: expect.stringContaining('normalized absolute path') }),
    )
  })

  it.each([
    'm3-mac;touch-pwned',
    'm3-mac -oProxyCommand=evil',
    'user@m3-mac',
    'm3-mac\nother-host',
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
    const target = await fakeAgent(`setInterval(() => {}, 1_000)`)

    await expect(callAgent(target, 'status', {}, 50)).rejects.toMatchObject({
      name: 'AgentClientError',
      code: 'agent-timeout',
      message: 'fleet agent did not answer before the timeout',
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
      targets: [validTarget(), { ...validTarget(), transport: 'ssh', sshHost: 'm3-mac' }],
    })).toThrowError('fleet target deviceId values must be unique')
  })
})

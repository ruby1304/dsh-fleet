import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { parseAgentConfig, assertMutationReadyConfig } from '../src/agent/config.ts'
import { parseFleetManifest } from '../src/host/core.ts'

const root = fileURLToPath(new URL('..', import.meta.url))

describe('public examples', () => {
  test('manifest is generic, parseable, and uses immutable stable sources', async () => {
    const source = await readFile(join(root, 'examples/fleet.lock.yaml'), 'utf8')
    const manifest = parseFleetManifest(source)

    expect(manifest.team.id).toBe('example-team')
    expect(Object.keys(manifest.devices)).toEqual(['controller', 'worker'])
    expect(source).not.toContain(['/Users', 'qudian'].join('/'))

    const stable = manifest.plugins.filter(plugin => plugin.target?.devices?.includes('worker'))
    expect(stable).toHaveLength(2)
    expect(stable.every(plugin =>
      (plugin.source === 'npm' && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(plugin.revision ?? '')) ||
      (plugin.source?.startsWith('github:') === true && /^[0-9a-f]{40}$/.test(plugin.revision ?? '')),
    )).toBe(true)
  })

  test('Agent example is mutation-ready and targets the example worker', async () => {
    const config = parseAgentConfig(JSON.parse(await readFile(join(root, 'examples/agent.config.json'), 'utf8')) as unknown)
    assertMutationReadyConfig(config)
    expect(config.deviceId).toBe('worker')
    expect(config.restart.port).toBe(3211)
    expect(config.health.requireFleetRpc).toBe(true)
  })
})

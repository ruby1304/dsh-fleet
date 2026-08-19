import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { parseAgentConfig, assertA2AReadyConfig, assertMutationReadyConfig, assertReleaseReadyConfig } from '../src/agent/config.ts'
import { parseFleetManifest } from '../src/host/core.ts'
import { instantiateTeamPack, parseTeamOverlay, parseTeamPack } from '../src/bootstrap/team-pack.ts'

const root = fileURLToPath(new URL('..', import.meta.url))

describe('public examples', () => {
  test('manifest is generic, parseable, and uses one immutable public/private release', async () => {
    const source = await readFile(join(root, 'examples/fleet.lock.yaml'), 'utf8')
    const manifest = parseFleetManifest(source)

    expect(manifest.team.id).toBe('example-team')
    expect(Object.keys(manifest.devices)).toEqual(['controller', 'worker'])
    expect(source).not.toMatch(/\/Users\/(?!example(?:\/|$))/)

    const stable = manifest.plugins.filter(plugin => plugin.target?.devices?.includes('worker'))
    expect(stable).toHaveLength(2)
    expect(stable).toEqual(expect.arrayContaining([
      expect.objectContaining({ visibility: 'public', source: 'npm', revision: '1.0.0' }),
      expect.objectContaining({ visibility: 'private', source: 'artifact', artifactDigest: 'a'.repeat(64) }),
    ]))
  })

  test('Agent example is release/A2A-ready and defaults remote task execution off', async () => {
    const config = parseAgentConfig(JSON.parse(await readFile(join(root, 'examples/agent.config.json'), 'utf8')) as unknown)
    assertMutationReadyConfig(config)
    assertReleaseReadyConfig(config)
    assertA2AReadyConfig(config)
    expect(config.deviceId).toBe('worker')
    expect(config.restart.port).toBe(3211)
    expect(config.health.requireFleetRpc).toBe(true)
    expect(config.tasks.enabled).toBe(false)
  })

  test('public pack and private overlay reproduce the packaged manifest shape', async () => {
    const pack = parseTeamPack(await readFile(join(root, 'examples/team-pack.yaml'), 'utf8'))
    const overlaySource = await readFile(join(root, 'examples/device-overlay.yaml'), 'utf8')
    expect(overlaySource).not.toMatch(/\/Users\/(?!example(?:\/|$))/)
    const rendered = instantiateTeamPack(pack, parseTeamOverlay(overlaySource))
    const manifest = parseFleetManifest(rendered.manifestYaml)
    expect(manifest.v2?.assignments.worker?.web).toBe('web-1.0.0')
    expect(manifest.plugins.map(plugin => plugin.visibility).sort()).toEqual(['private', 'public'])
  })
})

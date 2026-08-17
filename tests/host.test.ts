import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectFleetStatus } from '../src/index.ts'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('collectFleetStatus', () => {
  it('projects manifest, profile and live loader state without mutation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-fleet-'))
    roots.push(root)
    const profileDir = join(root, 'profiles', 'web')
    await mkdir(profileDir, { recursive: true })
    const manifestPath = join(root, 'fleet.lock.yaml')
    await writeFile(manifestPath, `schemaVersion: 1
team:
  id: test-team
devices:
  worker:
    assignedTo: ruby
    class: always-on-worker
    channel: stable
plugins:
  - id: plugin-a
    spec: 1.0.0
    profiles: [web]
`)
    await writeFile(join(profileDir, 'package.json'), JSON.stringify({
      dependencies: { 'plugin-a': '1.0.0', extra: '2.0.0' },
      dsh: { profile: { bundles: ['plugin-a', 'extra'] } },
    }))
    const status = await collectFleetStatus({
      loader: {
        entries: () => [
          { id: 'a', options: { name: 'plugin-a' }, fiber: { state: 2 } },
          { id: 'x', options: { name: 'extra' }, fiber: { state: 2 } },
        ],
      },
    }, {
      deviceId: 'worker',
      manifestPath,
      profile: 'web',
      dshHome: root,
      dshBinary: '/usr/bin/false',
    })
    expect(status.device).toMatchObject({ id: 'worker', registered: true, assignedTo: 'ruby', class: 'always-on-worker', channel: 'stable' })
    expect(status.manifest).toMatchObject({ loaded: true, teamId: 'test-team' })
    expect(status.plugins).toHaveLength(1)
    expect(status.plugins[0]?.state).toBe('aligned')
    expect(status.unmanaged).toEqual([{ id: 'extra', actualSpec: '2.0.0' }])
    expect(status.dsh.version).toBeNull()
  })

  it('fails closed into a visible manifest error when the file is absent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-fleet-'))
    roots.push(root)
    const profileDir = join(root, 'profiles', 'web')
    await mkdir(profileDir, { recursive: true })
    await writeFile(join(profileDir, 'package.json'), JSON.stringify({ dependencies: {}, dsh: { profile: { bundles: [] } } }))
    const status = await collectFleetStatus({ loader: { entries: () => [] } }, {
      deviceId: 'unknown', manifestPath: join(root, 'missing.yaml'), profile: 'web', dshHome: root, dshBinary: '/usr/bin/false',
    })
    expect(status.manifest.loaded).toBe(false)
    expect(status.manifest.error).toBeTruthy()
    expect(status.device.registered).toBe(false)
    expect(status.summary.desired).toBe(0)
  })
})

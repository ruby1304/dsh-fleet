import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, collectFleetStatus } from '../src/index.ts'

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

describe('Host', () => {
  it('registers the loopback RPC channel and serves fleet status', async () => {
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
    class: always-on-worker
    channel: stable
plugins: []
`)
    await writeFile(join(profileDir, 'package.json'), JSON.stringify({
      dependencies: {},
      dsh: { profile: { bundles: [] } },
    }))

    let registration: {
      channel: string
      handler: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>
      options?: { authority?: string }
    } | undefined
    const ctx = {
      connection: {
        rpc: {
          handle: (channel: string, handler: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>, options?: { authority?: string }) => {
            registration = { channel, handler, ...(options === undefined ? {} : { options }) }
          },
        },
      },
      loader: { entries: () => [] },
    }

    apply(ctx as never, {
      deviceId: 'worker',
      manifestPath,
      profile: 'web',
      dshHome: root,
      dshBinary: '/usr/bin/false',
    })

    expect(registration).toMatchObject({ channel: '/dsh-fleet', options: { authority: 'loopback' } })
    expect(registration).toBeDefined()
    const response = await registration!.handler('status', undefined, new AbortController().signal)
    expect(response).toMatchObject({
      ok: true,
      value: {
        device: { id: 'worker', registered: true },
        manifest: { loaded: true, teamId: 'test-team' },
        summary: { desired: 0 },
      },
    })
  })
})

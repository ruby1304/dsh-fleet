import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, assertAgentConfiguration, collectFleetStatus } from '../src/index.ts'
import { digestInstalledArtifact } from '../src/host/artifacts.ts'

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
    assignedTo: owner
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
          { id: 'broken', options: { name: 'unmanaged-broken' }, fiber: { state: 3 } },
        ],
      },
    }, {
      deviceId: 'worker',
      manifestPath,
      profile: 'web',
      dshHome: root,
      dshBinary: '/usr/bin/false',
    })
    expect(status.device).toMatchObject({ id: 'worker', registered: true, assignedTo: 'owner', class: 'always-on-worker', channel: 'stable' })
    expect(status.manifest).toMatchObject({ loaded: true, teamId: 'test-team' })
    expect(status.plugins).toHaveLength(1)
    expect(status.plugins[0]?.state).toBe('aligned')
    expect(status.unmanaged).toEqual([{ id: 'extra', actualSpec: '2.0.0' }])
    expect(status.runtime.failedModules).toEqual(['unmanaged-broken'])
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

  it('verifies a private release artifact inside the configured content store', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-fleet-'))
    roots.push(root)
    const profileDir = join(root, 'profiles', 'web')
    const artifactStore = join(root, 'artifacts')
    await Promise.all([mkdir(profileDir, { recursive: true }), mkdir(artifactStore, { recursive: true })])
    const artifactPath = join(artifactStore, 'private.tgz')
    const artifact = 'private plugin tarball fixture'
    const digest = createHash('sha256').update(artifact).digest('hex')
    await writeFile(artifactPath, artifact)
    const manifestPath = join(root, 'fleet.lock.yaml')
    await writeFile(manifestPath, `schemaVersion: 2
team: { id: test-team }
devices:
  worker: { class: always-on-worker, channel: stable }
profileReleases:
  web-release:
    version: 1.0.0
    profile: web
    dshRange: ">=0.1.0-rc.7 <0.2.0"
    plugins:
      - id: plugin-private
        visibility: private
        source: { kind: artifact, version: 1.0.0, digest: ${digest} }
assignments:
  worker: { web: web-release }
`)
    await writeFile(join(profileDir, 'package.json'), JSON.stringify({
      dependencies: { 'plugin-private': `file:${artifactPath}` },
      dsh: { profile: { bundles: ['plugin-private'] } },
    }))
    const status = await collectFleetStatus({
      loader: { entries: () => [{ id: 'private', options: { name: 'plugin-private' }, fiber: { state: 2 } }] },
    }, {
      deviceId: 'worker', manifestPath, profile: 'web', dshHome: root, dshBinary: '/usr/bin/false', artifactStore,
    })
    expect(status.plugins[0]).toMatchObject({
      id: 'plugin-private',
      state: 'aligned',
      desiredArtifactDigest: digest,
      actualArtifactDigest: digest,
      visibility: 'private',
      releaseId: 'web-release',
    })
  })
})

describe('private artifact containment', () => {
  it('hashes only regular tgz files within the configured store', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-fleet-artifact-'))
    roots.push(root)
    const profileDir = join(root, 'profile')
    const store = join(root, 'store')
    await Promise.all([mkdir(profileDir), mkdir(store)])
    const inside = join(store, 'inside.tgz')
    const outside = join(root, 'outside.tgz')
    const linked = join(store, 'linked.tgz')
    await Promise.all([writeFile(inside, 'inside'), writeFile(outside, 'outside')])
    await symlink(outside, linked)
    expect(await digestInstalledArtifact(profileDir, store, `file:${inside}`)).toBe(createHash('sha256').update('inside').digest('hex'))
    expect(await digestInstalledArtifact(profileDir, store, `file:${outside}`)).toBeUndefined()
    expect(await digestInstalledArtifact(profileDir, store, `file:${linked}`)).toBeUndefined()
    expect(await digestInstalledArtifact(profileDir, store, 'https://example.invalid/plugin.tgz')).toBeUndefined()
  })
})

describe('Host', () => {
  it('rejects a target whose device, profile, or manifest identity differs from the Host binding', () => {
    const expected = { deviceId: 'worker', profile: 'web', manifestDigest: 'a'.repeat(64) }
    expect(() => assertAgentConfiguration(expected, { ...expected, deviceId: 'other' })).toThrowError(
      expect.objectContaining({ code: 'agent-identity-mismatch' }),
    )
    expect(() => assertAgentConfiguration(expected, { ...expected, profile: 'other' })).toThrowError(
      expect.objectContaining({ code: 'agent-profile-mismatch' }),
    )
    expect(() => assertAgentConfiguration(expected, { ...expected, manifestDigest: 'b'.repeat(64) })).toThrowError(
      expect.objectContaining({ code: 'agent-manifest-mismatch' }),
    )
    expect(() => assertAgentConfiguration(expected, expected)).not.toThrow()
  })

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

    const registrations = new Map<string, {
      channel: string
      handler: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>
      options?: { authority?: string }
    }>()
    const ctx = {
      connection: {
        rpc: {
          handle: (channel: string, handler: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>, options?: { authority?: string }) => {
            registrations.set(channel, { channel, handler, ...(options === undefined ? {} : { options }) })
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
      updateCheck: false,
    })

    const registration = registrations.get('/dsh-fleet')
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
    const updates = await registration!.handler('updates', { mode: 'cache' }, new AbortController().signal)
    expect(updates).toEqual({ ok: true, value: { enabled: false, cached: false, stale: false } })
    const invalid = await registration!.handler('updates', { mode: 'install' }, new AbortController().signal)
    expect(invalid).toMatchObject({ ok: false, error: { message: 'invalid updates mode' } })

    const agent = registrations.get('/dsh-fleet-agent')
    expect(agent).toMatchObject({ channel: '/dsh-fleet-agent', options: { authority: 'loopback' } })
    const targets = await agent!.handler('targets', null, new AbortController().signal)
    expect(targets).toEqual({ ok: true, value: { enabled: false, targets: [] } })
    const arbitrary = await agent!.handler('plan', {
      deviceId: 'worker', pluginId: 'plugin-a', command: 'anything', argv: ['anything'], spec: 'latest',
    }, new AbortController().signal)
    expect(arbitrary).toMatchObject({ ok: false, error: { message: 'plan payload has unsupported or missing fields' } })
    const invalidTask = await agent!.handler('task-submit', {
      targetDeviceId: 'worker', taskId: 'task:not-a-uuid', workspaceId: 'repo', profile: 'headless', prompt: 'safe task',
    }, new AbortController().signal)
    expect(invalidTask).toMatchObject({ ok: false, error: { message: 'payload.taskId must be a namespaced UUID' } })
  })
})

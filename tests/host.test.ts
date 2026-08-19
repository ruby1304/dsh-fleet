import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, assertAgentConfiguration, collectFleetStatus } from '../src/index.ts'
import { createFleetReleaseRollbackPlan } from '../src/agent/release-protocol.ts'
import { createFleetReleaseRetentionPlan } from '../src/agent/release-retention.ts'
import { digestInstalledArtifact } from '../src/host/artifacts.ts'
import type { AgentTargetConfig } from '../src/host/agent-client.ts'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function fakeHostAgent(deviceId: string, source: string): Promise<AgentTargetConfig> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-fleet-host-agent-'))
  roots.push(root)
  const nodeBinary = join(root, 'node')
  const agentPath = join(root, 'agent.mjs')
  const configPath = join(root, 'agent.json')
  await symlink(process.execPath, nodeBinary)
  await writeFile(agentPath, source)
  await writeFile(configPath, '{}\n')
  return { deviceId, transport: 'local', nodeBinary, agentPath, configPath }
}

function hostRegistrations() {
  const registrations = new Map<string, {
    handler: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>
  }>()
  return {
    registrations,
    ctx: {
      connection: { rpc: { handle: (channel: string, handler: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>) => {
        registrations.set(channel, { handler })
      } } },
      loader: { entries: () => [] },
    },
  }
}

const v2Manifest = (releaseId: string) => `schemaVersion: 2
team: { id: local-team }
devices:
  worker: { assignedTo: owner, class: always-on-worker, channel: stable }
profileReleases:
  old-web:
    version: 1.0.0
    profile: web
    dshRange: ">=0.1.0-rc.7 <0.2.0"
    plugins:
      - id: plugin-a
        visibility: public
        source: { kind: npm, version: 1.0.0 }
  new-web:
    version: 2.0.0
    profile: web
    dshRange: ">=0.1.0-rc.7 <0.2.0"
    plugins:
      - id: plugin-a
        visibility: public
        source: { kind: npm, version: 2.0.0 }
assignments:
  worker: { web: ${releaseId} }
`

function runtimeIdentity(dshVersion = '0.1.0-rc.7') {
  const identity = {
    nodeRealpath: '/usr/local/bin/node',
    dshEntrypointRealpath: '/opt/dsh/dist/cli.mjs',
    dshPackageRealpath: '/opt/dsh',
    dshVersion,
    entrypointDigest: '1'.repeat(64),
    packageJsonDigest: '2'.repeat(64),
  }
  return {
    ...identity,
    runtimeDigest: createHash('sha256').update(JSON.stringify(identity)).digest('hex'),
  }
}

const runtimeDependencies = { inspectRuntimeIdentity: async () => runtimeIdentity() }

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
    }, runtimeDependencies)
    expect(status.device).toMatchObject({ id: 'worker', registered: true, assignedTo: 'owner', class: 'always-on-worker', channel: 'stable' })
    expect(status.manifest).toMatchObject({ loaded: true, teamId: 'test-team' })
    expect(status.plugins).toHaveLength(1)
    expect(status.plugins[0]?.state).toBe('aligned')
    expect(status.unmanaged).toEqual([{ id: 'extra', actualSpec: '2.0.0' }])
    expect(status.runtime.failedModules).toEqual(['unmanaged-broken'])
    expect(status.dsh.version).toBe('0.1.0-rc.7')
    expect(status.runtimeIdentity).toEqual(runtimeIdentity())
  })

  it('fails closed into a visible manifest error when the file is absent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-fleet-'))
    roots.push(root)
    const profileDir = join(root, 'profiles', 'web')
    await mkdir(profileDir, { recursive: true })
    await writeFile(join(profileDir, 'package.json'), JSON.stringify({ dependencies: {}, dsh: { profile: { bundles: [] } } }))
    const status = await collectFleetStatus({ loader: { entries: () => [] } }, {
      deviceId: 'unknown', manifestPath: join(root, 'missing.yaml'), profile: 'web', dshHome: root, dshBinary: '/usr/bin/false',
    }, runtimeDependencies)
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
    }, runtimeDependencies)
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
    }, runtimeDependencies)

    const registration = registrations.get('/dsh-fleet')
    expect(registration).toMatchObject({ channel: '/dsh-fleet', options: { authority: 'loopback' } })
    expect(registration).toBeDefined()
    const response = await registration!.handler('status', undefined, new AbortController().signal)
    expect(response).toMatchObject({
      ok: true,
      value: {
        device: { id: 'worker', registered: true },
        dsh: { version: '0.1.0-rc.7', profile: 'web' },
        manifest: { loaded: true, teamId: 'test-team' },
        runtimeIdentity: runtimeIdentity(),
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
      targetDeviceId: 'worker', taskId: 'task:not-a-uuid', workspaceId: 'repo', profile: 'headless',
      policyId: 'readonly-v1', prompt: 'safe task',
    }, new AbortController().signal)
    expect(invalidTask).toMatchObject({ ok: false, error: { message: 'payload.taskId must be a namespaced UUID' } })
    const invalidList = await agent!.handler('tasks-list', {
      targetDeviceId: 'worker', limit: 20, prompt: 'must not cross the catalog boundary',
    }, new AbortController().signal)
    expect(invalidList).toMatchObject({ ok: false, error: { message: 'tasks-list payload has unsupported or missing fields' } })
    const activePrune = await agent!.handler('tasks-prune', {
      targetDeviceId: 'worker', olderThan: '2026-08-19T00:00:00.000Z', states: ['running'],
    }, new AbortController().signal)
    expect(activePrune).toMatchObject({ ok: false, error: { message: 'tasks-prune states must be unique terminal task states' } })
  })

  it('keeps live and desired manifests separate during a generation rollout', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-fleet-live-desired-'))
    roots.push(root)
    const livePath = join(root, 'live.yaml')
    const desiredPath = join(root, 'desired.yaml')
    const liveSource = v2Manifest('old-web')
    const desiredSource = v2Manifest('new-web')
    await Promise.all([writeFile(livePath, liveSource), writeFile(desiredPath, desiredSource)])
    const liveDigest = createHash('sha256').update(liveSource).digest('hex')
    const desiredDigest = createHash('sha256').update(desiredSource).digest('hex')
    const inspection = {
      protocolVersion: 1,
      kind: 'profile-release',
      deviceId: 'worker',
      profile: 'web',
      dshVersion: '0.1.0-rc.7',
      manifestDigest: liveDigest,
      liveManifestDigest: liveDigest,
      desiredManifestDigest: desiredDigest,
      observedRuntimeDigest: '4'.repeat(64),
      observedServiceDefinitionDigest: null,
      profileHash: '1'.repeat(64),
      currentRelease: { releaseId: 'old-web', releaseVersion: '1.0.0', releaseDigest: '2'.repeat(64) },
      assignedRelease: { releaseId: 'new-web', releaseVersion: '2.0.0', releaseDigest: '3'.repeat(64) },
      changes: [{ pluginId: 'plugin-a', action: 'update' }],
      tasks: { enabled: true, timeoutMs: 60_000, workspaceIds: ['repo'], profiles: ['headless'], executionProfiles: [
        { profile: 'headless', profileHash: '5'.repeat(64) },
      ], policies: [
        { policyId: 'readonly-v1', policyDigest: '4'.repeat(64), permissionMode: 'read-only' },
      ] },
    }
    const releasePlan = {
      protocolVersion: 2,
      kind: 'profile-release',
      planId: 'release-plan:' + '5'.repeat(64),
      digest: '5'.repeat(64),
      deviceId: 'worker',
      profile: 'web',
      fromManifestDigest: liveDigest,
      toManifestDigest: desiredDigest,
      fromReleaseDigest: '2'.repeat(64),
      toReleaseDigest: '3'.repeat(64),
      observedRuntimeDigest: '4'.repeat(64),
      observedServiceDefinitionDigest: null,
    }
    const target = await fakeHostAgent('worker', `
      let raw = ''
      for await (const chunk of process.stdin) raw += chunk
      const command = process.argv.at(-1)
      const inspection = ${JSON.stringify(inspection)}
      const releasePlan = ${JSON.stringify(releasePlan)}
      const doctor = { protocolVersion: 1, ready: true, deviceId: 'worker', teamId: 'local-team' }
      const value = command === 'release-inspect' ? inspection : command === 'release-plan' ? releasePlan : doctor
      process.stdout.write(JSON.stringify({ ok: true, value }))
    `)
    const { ctx, registrations } = hostRegistrations()
    apply(ctx as never, {
      deviceId: 'worker', manifestPath: livePath, desiredManifestPath: desiredPath, profile: 'web', dshHome: root,
      dshBinary: '/usr/bin/false', updateCheck: false,
      convergence: { enabled: true, principalId: 'owner', targets: [target] },
    })
    const handler = registrations.get('/dsh-fleet-agent')!.handler
    const targets = await handler('targets', null, new AbortController().signal) as { ok: boolean; value: { targets: Array<{ online: boolean }> } }
    expect(targets.ok).toBe(true)
    expect(targets.value.targets[0]?.online).toBe(true)
    const plan = await handler('release-plan', { deviceId: 'worker' }, new AbortController().signal)
    expect(plan).toMatchObject({ ok: true, value: { toManifestDigest: desiredDigest } })
    const staleApproval = await handler('release-approve', {
      approvalId: 'stale-release-approval',
      deviceId: 'worker',
      fromManifestDigest: liveDigest,
      fromReleaseDigest: '2'.repeat(64),
      planDigest: '5'.repeat(64),
      planExpiresAt: '2099-08-19T10:05:00.000Z',
      planId: 'release-plan:' + '5'.repeat(64),
      profile: 'web',
      toManifestDigest: liveDigest,
      toReleaseDigest: '3'.repeat(64),
    }, new AbortController().signal)
    expect(staleApproval).toMatchObject({ ok: false, error: { message: expect.stringContaining('desired Host manifest') } })
    const task = await handler('task-submit', {
      targetDeviceId: 'worker', taskId: 'task:11111111-1111-4111-8111-111111111111', workspaceId: 'repo',
      profile: 'headless', policyId: 'readonly-v1', prompt: 'read only check',
    }, new AbortController().signal)
    expect(task).toMatchObject({ ok: false, error: { message: expect.stringContaining('same live and desired Fleet manifest') } })
  })

  it('binds an accepted task to the exact inspected execution profile hash', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-fleet-task-profile-'))
    roots.push(root)
    const manifestPath = join(root, 'fleet.yaml')
    const source = v2Manifest('new-web')
    await writeFile(manifestPath, source)
    const manifestDigest = createHash('sha256').update(source).digest('hex')
    const executionProfileHash = '5'.repeat(64)
    const releaseDigest = '6'.repeat(64)
    const taskId = 'task:12121212-1212-4212-8212-121212121212'
    const inspection = {
      protocolVersion: 1,
      kind: 'profile-release',
      deviceId: 'worker',
      profile: 'web',
      dshVersion: '0.1.0-rc.7',
      manifestDigest,
      liveManifestDigest: manifestDigest,
      desiredManifestDigest: manifestDigest,
      observedRuntimeDigest: '9'.repeat(64),
      observedServiceDefinitionDigest: null,
      profileHash: '7'.repeat(64),
      currentRelease: { releaseId: 'new-web', releaseVersion: '2.0.0', releaseDigest },
      assignedRelease: { releaseId: 'new-web', releaseVersion: '2.0.0', releaseDigest },
      changes: [],
      tasks: {
        enabled: true,
        timeoutMs: 60_000,
        workspaceIds: ['repo'],
        profiles: ['headless'],
        executionProfiles: [{ profile: 'headless', profileHash: executionProfileHash }],
        policies: [{ policyId: 'readonly-v1', policyDigest: '8'.repeat(64), permissionMode: 'read-only' }],
      },
    }
    const target = await fakeHostAgent('worker', `
      let raw = ''
      for await (const chunk of process.stdin) raw += chunk
      const payload = JSON.parse(raw)
      const command = process.argv.at(-1)
      let value
      if (command === 'release-inspect') value = ${JSON.stringify(inspection)}
      else if (command === 'a2a-sign') {
        if (payload.kind === 'task.submit' && payload.payload.executionProfileHash !== ${JSON.stringify(executionProfileHash)}) {
          process.stdout.write(JSON.stringify({ ok: false, error: { code: 'request-denied' } }))
          process.exit(0)
        }
        value = { messageId: 'msg:13131313-1313-4313-8313-131313131313', sender: { deviceId: 'worker' }, recipient: { deviceId: payload.recipientDeviceId }, kind: payload.kind, payload: payload.payload }
      } else if (command === 'a2a-receive') {
        value = { requestMessageId: payload.envelope.messageId, response: { sender: { deviceId: 'worker' }, kind: 'task.progress', payload: { taskId: payload.envelope.payload.taskId, state: 'accepted', updatedAt: '2026-08-19T10:00:00.000Z' } } }
      } else value = payload.envelope
      process.stdout.write(JSON.stringify({ ok: true, value }))
    `)
    const { ctx, registrations } = hostRegistrations()
    apply(ctx as never, {
      deviceId: 'worker', manifestPath, desiredManifestPath: manifestPath, profile: 'web', dshHome: root,
      dshBinary: '/usr/bin/false', updateCheck: false,
      convergence: { enabled: true, principalId: 'owner', signerDeviceId: 'worker', targets: [target] },
    })
    const handler = registrations.get('/dsh-fleet-agent')!.handler
    const result = await handler('task-submit', {
      targetDeviceId: 'worker', taskId, workspaceId: 'repo', profile: 'headless', policyId: 'readonly-v1', prompt: 'inspect repository',
    }, new AbortController().signal)
    expect(result).toMatchObject({ ok: true, value: { taskId, response: { kind: 'task.progress', payload: { state: 'accepted' } } } })
  })

  it('exposes rollback only as the exact inverse of a successful release transition', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-fleet-host-rollback-'))
    roots.push(root)
    const manifestPath = join(root, 'fleet.yaml')
    const source = v2Manifest('new-web')
    await writeFile(manifestPath, source)
    const activeDigest = createHash('sha256').update(source).digest('hex')
    const transitionDigest = '6'.repeat(64)
    const transitionPlanId = 'release-plan:' + transitionDigest
    const transition = {
      planId: transitionPlanId,
      planDigest: transitionDigest,
      approvalId: 'release-approval',
      principalId: 'owner',
      idempotencyKey: '7'.repeat(64),
      deviceId: 'worker',
      profile: 'web',
      releaseId: 'new-web',
      releaseVersion: '2.0.0',
      releaseDigest: '8'.repeat(64),
      fromManifestDigest: '9'.repeat(64),
      toManifestDigest: activeDigest,
      fromReleaseDigest: 'a'.repeat(64),
      toReleaseDigest: '8'.repeat(64),
      rollbackDescriptorDigest: 'b'.repeat(64),
      stageProfile: 'stage',
      backupProfile: 'backup',
      state: 'succeeded',
      updatedAt: '2026-08-19T10:00:00.000Z',
      result: 'success',
    }
    const rollbackPlan = createFleetReleaseRollbackPlan({
      protocolVersion: 2,
      kind: 'profile-release-rollback',
      transitionPlanId,
      transitionPlanDigest: transitionDigest,
      deviceId: 'worker',
      profile: 'web',
      fromManifestDigest: activeDigest,
      toManifestDigest: transition.fromManifestDigest,
      fromReleaseDigest: transition.toReleaseDigest,
      toReleaseDigest: transition.fromReleaseDigest,
      fromProfileHash: 'c'.repeat(64),
      toProfileHash: 'd'.repeat(64),
      observedDshVersion: '0.1.0-rc.7',
      observedRuntimeDigest: 'e'.repeat(64),
      observedServiceDefinitionDigest: 'f'.repeat(64),
      createdAt: '2026-08-19T10:01:00.000Z',
      expiresAt: '2099-08-19T10:06:00.000Z',
    })
    const rollbackAction = {
      planId: rollbackPlan.planId,
      planDigest: rollbackPlan.digest,
      transitionPlanId,
      approvalId: 'rollback-approval',
      principalId: 'owner',
      idempotencyKey: 'e'.repeat(64),
      deviceId: 'worker',
      profile: 'web',
      fromManifestDigest: rollbackPlan.fromManifestDigest,
      toManifestDigest: rollbackPlan.toManifestDigest,
      fromReleaseDigest: rollbackPlan.fromReleaseDigest,
      toReleaseDigest: rollbackPlan.toReleaseDigest,
      state: 'succeeded',
      updatedAt: '2026-08-19T10:03:00.000Z',
      result: 'success',
    }
    const target = await fakeHostAgent('worker', `
      let raw = ''
      for await (const chunk of process.stdin) raw += chunk
      const command = process.argv.at(-1)
      const value = command === 'release-status' ? ${JSON.stringify(transition)}
        : command === 'release-rollback-plan' ? ${JSON.stringify(rollbackPlan)}
        : ${JSON.stringify(rollbackAction)}
      process.stdout.write(JSON.stringify({ ok: true, value }))
    `)
    const { ctx, registrations } = hostRegistrations()
    apply(ctx as never, {
      deviceId: 'worker', manifestPath, desiredManifestPath: manifestPath, profile: 'web', dshHome: root,
      dshBinary: '/usr/bin/false', updateCheck: false,
      convergence: { enabled: true, principalId: 'owner', targets: [target] },
    })
    const handler = registrations.get('/dsh-fleet-agent')!.handler
    await expect(handler('release-rollback-plan', {
      deviceId: 'worker', transitionPlanId, force: true,
    }, new AbortController().signal)).resolves.toMatchObject({ ok: false })
    await expect(handler('release-rollback-plan', {
      deviceId: 'worker', transitionPlanId,
    }, new AbortController().signal)).resolves.toEqual({ ok: true, value: rollbackPlan })
    const applied = await handler('release-rollback-approve', {
      approvalId: 'rollback-approval',
      deviceId: 'worker',
      fromManifestDigest: rollbackPlan.fromManifestDigest,
      fromReleaseDigest: rollbackPlan.fromReleaseDigest,
      planDigest: rollbackPlan.digest,
      planExpiresAt: rollbackPlan.expiresAt,
      planId: rollbackPlan.planId,
      profile: rollbackPlan.profile,
      toManifestDigest: rollbackPlan.toManifestDigest,
      toReleaseDigest: rollbackPlan.toReleaseDigest,
      transitionPlanId,
    }, new AbortController().signal)
    expect(applied).toEqual({ ok: true, value: rollbackAction })
    await expect(handler('release-rollback-action-status', {
      deviceId: 'worker', planId: rollbackPlan.planId,
    }, new AbortController().signal)).resolves.toEqual({ ok: true, value: rollbackAction })
  })

  it('requires a closed explicit approval before applying a bound release retention plan', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-fleet-host-retention-'))
    roots.push(root)
    const manifestPath = join(root, 'fleet.yaml')
    await writeFile(manifestPath, v2Manifest('new-web'))
    const currentTransitionPlanId = 'release-plan:' + 'a'.repeat(64)
    const previousTransitionPlanId = 'release-plan:' + 'b'.repeat(64)
    const removedTransitionPlanId = 'release-plan:' + 'c'.repeat(64)
    const plan = createFleetReleaseRetentionPlan({
      protocolVersion: 1,
      kind: 'profile-release-retention',
      deviceId: 'worker',
      profile: 'web',
      currentTransitionPlanId,
      retainedTransitionPlanIds: [currentTransitionPlanId, previousTransitionPlanId],
      entries: [{
        transitionPlanId: removedTransitionPlanId,
        descriptorDigest: 'd'.repeat(64),
        backupProfile: 'fleet-backup-' + '1'.repeat(24),
        backupManifestDigest: 'e'.repeat(64),
        backupProfileHash: 'f'.repeat(64),
        reason: 'superseded',
      }],
      orphanBackupProfiles: [],
      orphanStageProfiles: ['fleet-stage-' + '2'.repeat(24)],
      orphanFailedProfiles: [],
      createdAt: '2099-08-19T10:00:00.000Z',
      expiresAt: '2099-08-19T10:05:00.000Z',
    })
    const action = {
      planId: plan.planId,
      planDigest: plan.digest,
      approvalId: 'retention-approval',
      principalId: 'owner',
      idempotencyKey: '3'.repeat(64),
      deviceId: 'worker',
      profile: 'web',
      currentTransitionPlanId,
      state: 'succeeded',
      removedTransitionPlanIds: [removedTransitionPlanId],
      activeTransitionPlanId: null,
      activeBackupQuarantinePrepared: false,
      activeBackupRemoved: false,
      updatedAt: '2099-08-19T10:02:00.000Z',
      result: 'success',
    }
    const target = await fakeHostAgent('worker', `
      let raw = ''
      for await (const chunk of process.stdin) raw += chunk
      const payload = JSON.parse(raw)
      const command = process.argv.at(-1)
      if (command === 'release-retention-apply' && (payload.approval.principalId !== 'owner' ||
          payload.approval.planId !== ${JSON.stringify(plan.planId)} || payload.approval.planDigest !== ${JSON.stringify(plan.digest)})) {
        process.stdout.write(JSON.stringify({ ok: false, error: { code: 'approval-mismatch' } }))
      } else {
        const value = command === 'release-retention-plan' ? ${JSON.stringify(plan)} : ${JSON.stringify(action)}
        process.stdout.write(JSON.stringify({ ok: true, value }))
      }
    `)
    const { ctx, registrations } = hostRegistrations()
    apply(ctx as never, {
      deviceId: 'worker', manifestPath, desiredManifestPath: manifestPath, profile: 'web', dshHome: root,
      dshBinary: '/usr/bin/false', updateCheck: false,
      convergence: { enabled: true, principalId: 'owner', targets: [target] },
    })
    const handler = registrations.get('/dsh-fleet-agent')!.handler
    await expect(handler('release-retention-plan', { deviceId: 'worker', apply: true }, new AbortController().signal))
      .resolves.toMatchObject({ ok: false, error: { message: expect.stringContaining('unsupported or missing fields') } })
    await expect(handler('release-retention-plan', { deviceId: 'worker' }, new AbortController().signal))
      .resolves.toEqual({ ok: true, value: plan })
    await expect(handler('release-retention-approve', {
      approvalId: 'retention-approval', deviceId: 'worker', planDigest: plan.digest,
      planExpiresAt: plan.expiresAt, planId: plan.planId, profile: 'web',
    }, new AbortController().signal)).resolves.toEqual({ ok: true, value: action })
    await expect(handler('release-retention-action-status', {
      deviceId: 'worker', planId: plan.planId,
    }, new AbortController().signal)).resolves.toEqual({ ok: true, value: action })
  })

  it('keeps cross-team advisory import, export, acknowledgement and retention on the fixed local signer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-fleet-host-federation-'))
    roots.push(root)
    const manifestPath = join(root, 'fleet.yaml')
    await writeFile(manifestPath, v2Manifest('new-web'))
    const incoming = {
      schemaVersion: 2,
      teamId: 'foreign-team',
      messageId: 'msg:22222222-2222-4222-8222-222222222222',
      sender: { principalId: 'peer-owner', deviceId: 'peer-device', keyId: 'ed25519:' + '1'.repeat(64) },
      recipient: { teamId: 'local-team', deviceId: 'worker' },
      kind: 'approval.request',
      issuedAt: '2026-08-19T10:00:00.000Z',
      expiresAt: '2099-08-19T10:15:00.000Z',
      payloadDigest: '2'.repeat(64),
      payload: {
        approvalId: 'approval:33333333-3333-4333-8333-333333333333',
        taskId: 'task:44444444-4444-4444-8444-444444444444',
        summary: 'Review the handoff metadata',
        expiresAt: '2099-08-19T10:12:00.000Z',
      },
      signature: 'A'.repeat(86),
    }
    const target = await fakeHostAgent('worker', `
      let raw = ''
      for await (const chunk of process.stdin) raw += chunk
      const payload = JSON.parse(raw)
      const command = process.argv.at(-1)
      const envelope = ${JSON.stringify(incoming)}
      const makeEnvelope = (kind, body, recipientTeamId, recipientDeviceId) => ({
        schemaVersion: 2, teamId: 'local-team', messageId: 'msg:55555555-5555-4555-8555-555555555555',
        sender: { principalId: 'owner', deviceId: 'worker', keyId: 'ed25519:' + '3'.repeat(64) },
        recipient: { teamId: recipientTeamId, deviceId: recipientDeviceId }, kind,
        issuedAt: '2026-08-19T10:01:00.000Z', expiresAt: '2099-08-19T10:06:00.000Z',
        payloadDigest: '4'.repeat(64), payload: body, signature: 'B'.repeat(86),
      })
      let value
      if (command === 'doctor') value = { protocolVersion: 1, ready: true, deviceId: 'worker', teamId: 'local-team', principalId: 'owner', identityKeyId: 'ed25519:' + '3'.repeat(64) }
      else if (command === 'federation-list') value = [{ record: { schemaVersion: 1, receivedAt: '2026-08-19T10:00:30.000Z', envelope }, acknowledgement: null, expired: false }]
      else if (command === 'federation-ack') value = { status: 'acknowledged', acknowledgement: { schemaVersion: 1, messageId: payload.messageId, payloadDigest: payload.payloadDigest, disposition: payload.disposition, acknowledgedAt: '2026-08-19T10:02:00.000Z' } }
      else if (command === 'federation-retention-plan') value = { generatedAt: '2026-08-19T10:02:00.000Z', candidates: [] }
      else if (command === 'a2a-verify') value = payload.envelope
      else if (command === 'a2a-receive') value = { requestMessageId: payload.envelope.messageId, response: makeEnvelope('receipt', { requestMessageId: payload.envelope.messageId, status: payload.envelope.kind === 'handoff' ? 'stored' : 'accepted' }, payload.envelope.teamId, payload.envelope.sender.deviceId) }
      else value = makeEnvelope(payload.kind, payload.payload, payload.recipientTeamId, payload.recipientDeviceId)
      process.stdout.write(JSON.stringify({ ok: true, value }))
    `)
    const { ctx, registrations } = hostRegistrations()
    apply(ctx as never, {
      deviceId: 'worker', manifestPath, desiredManifestPath: manifestPath, profile: 'web', dshHome: root,
      dshBinary: '/usr/bin/false', updateCheck: false,
      convergence: { enabled: true, principalId: 'owner', signerDeviceId: 'worker', targets: [target] },
    })
    const handler = registrations.get('/dsh-fleet-agent')!.handler
    await expect(handler('federation-list', { limit: 50 }, new AbortController().signal)).resolves.toMatchObject({
      ok: true, value: [{ record: { envelope: { teamId: 'foreign-team' } }, acknowledgement: null }],
    })
    await expect(handler('import', { envelope: incoming }, new AbortController().signal)).resolves.toMatchObject({
      ok: true, value: { kind: 'receipt', payload: { requestMessageId: incoming.messageId, status: 'accepted' } },
    })
    await expect(handler('handoff-export', {
      recipientTeamId: 'local-team', recipientDeviceId: 'peer-device',
      handoffId: 'handoff:66666666-6666-4666-8666-666666666666', taskId: null, summary: 'same team', artifactRefs: [],
    }, new AbortController().signal)).resolves.toMatchObject({ ok: false, error: { message: expect.stringContaining('foreign recipient team') } })
    await expect(handler('handoff-export', {
      recipientTeamId: 'foreign-team', recipientDeviceId: 'peer-device',
      handoffId: 'handoff:66666666-6666-4666-8666-666666666666', taskId: null, summary: 'manual handoff', artifactRefs: ['artifact-label'],
    }, new AbortController().signal)).resolves.toMatchObject({
      ok: true, value: { kind: 'handoff', recipient: { teamId: 'foreign-team', deviceId: 'peer-device' } },
    })
    await expect(handler('approval-decision-export', {
      request: incoming, decision: 'endorsed',
    }, new AbortController().signal)).resolves.toMatchObject({
      ok: true,
      value: {
        kind: 'approval.decision',
        payload: {
          approvalRequestMessageId: incoming.messageId,
          approvalRequestPayloadDigest: incoming.payloadDigest,
          decision: 'endorsed',
        },
      },
    })
    await expect(handler('ack', {
      messageId: incoming.messageId, payloadDigest: incoming.payloadDigest, disposition: 'acknowledged',
    }, new AbortController().signal)).resolves.toMatchObject({ ok: true, value: { status: 'acknowledged' } })
    await expect(handler('retention-plan', null, new AbortController().signal)).resolves.toEqual({
      ok: true, value: { generatedAt: '2026-08-19T10:02:00.000Z', candidates: [] },
    })
  })
})

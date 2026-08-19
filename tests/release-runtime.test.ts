import { createHash, generateKeyPairSync } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { FleetAgentConfig } from '../src/agent/config.ts'
import {
  applyStoredReleasePlan,
  createStoredReleasePlan,
  inspectReleaseAgent,
  readAppliedRelease,
} from '../src/agent/runtime.ts'
import { doctorAgent } from '../src/agent/doctor.ts'
import type { FleetReleaseApproval, FleetReleasePlan } from '../src/agent/release-protocol.ts'

const roots: string[] = []
const servers: ReturnType<typeof createServer>[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.close(error => error === undefined ? resolve() : reject(error))
  })))
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function setup(
  approvedIntegrity = 'sha512-YWJjZA==',
  associatedIntegrity = approvedIntegrity,
  runtimeMode: 'current' | 'legacy-before-install' | 'legacy-always' = 'current',
  initialLinks = false,
  runtimeManifestBinding: 'profile-local' | 'external' = 'profile-local',
): Promise<{
  config: FleetAgentConfig
  profileDir: string
  artifactDigest: string
  failHealthMarker: string
  commandLog: string
  legacyPublic: string
  legacyPrivate: string
}> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-fleet-release-runtime-'))
  roots.push(root)
  const binDir = join(root, 'bin')
  const dshHome = join(root, 'dsh-home')
  const profileDir = join(dshHome, 'profiles', 'web')
  const artifactStore = join(root, 'artifacts')
  const stateDir = join(root, 'state')
  const failHealthMarker = join(root, 'fail-health')
  const workspace = join(root, 'workspace')
  const commandLog = join(root, 'commands.log')
  const legacyPublic = join(root, 'legacy-public')
  const legacyPrivate = join(root, 'legacy-private')
  await Promise.all([
    mkdir(binDir, { recursive: true }),
    mkdir(profileDir, { recursive: true }),
    mkdir(join(profileDir, 'node_modules'), { recursive: true }),
    mkdir(artifactStore, { recursive: true }),
    mkdir(workspace, { recursive: true }),
    mkdir(legacyPublic, { recursive: true }),
    mkdir(legacyPrivate, { recursive: true }),
  ])
  if (initialLinks) {
    await Promise.all([
      writeFile(join(legacyPublic, 'package.json'), JSON.stringify({ name: 'public-plugin', version: '0.1.0' })),
      writeFile(join(legacyPrivate, 'package.json'), JSON.stringify({ name: 'private-plugin', version: '0.1.0' })),
      mkdir(join(legacyPublic, 'node_modules'), { recursive: true }),
      mkdir(join(legacyPrivate, 'node_modules'), { recursive: true }),
      symlink(legacyPublic, join(profileDir, 'node_modules', 'public-plugin'), 'dir'),
      symlink(legacyPrivate, join(profileDir, 'node_modules', 'private-plugin'), 'dir'),
    ])
    await Promise.all([
      writeFile(join(legacyPublic, 'node_modules', 'keep'), 'keep\n'),
      writeFile(join(legacyPrivate, 'node_modules', 'keep'), 'keep\n'),
    ])
  }
  await writeFile(join(profileDir, 'package.json'), JSON.stringify({
    name: 'test-profile',
    private: true,
    dependencies: {
      ...(initialLinks ? { 'public-plugin': 'link:' + legacyPublic, 'private-plugin': 'link:' + legacyPrivate } : {}),
      unmanaged: '9.9.9',
    },
    dsh: { profile: { bundles: [...(initialLinks ? ['public-plugin', 'private-plugin'] : []), 'unmanaged'] } },
  }, null, 2) + '\n')
  await writeFile(join(profileDir, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n")
  await writeFile(join(profileDir, 'pnpm-workspace.yaml'), 'packages: []\n')
  await writeFile(join(profileDir, 'cordis.patch.yml'), '[]\n')
  await writeFile(join(profileDir, 'fleet.lock.yaml'), `schemaVersion: 1
team: { id: test-team }
devices:
  worker: { assignedTo: owner, class: always-on-worker, channel: stable }
plugins: []
`)

  const artifact = 'private plugin artifact fixture'
  const artifactDigest = createHash('sha256').update(artifact).digest('hex')
  await writeFile(join(artifactStore, artifactDigest + '.tgz'), artifact)
  const manifestPath = join(root, 'fleet.lock.yaml')
  await writeFile(manifestPath, `schemaVersion: 2
team: { id: test-team }
devices:
  worker: { assignedTo: owner, class: always-on-worker, channel: stable }
profileReleases:
  stable-web:
    version: 3.0.0
    profile: web
    dshRange: ">=0.1.0-rc.7 <0.2.0"
    plugins:
      - id: public-plugin
        visibility: public
        source: { kind: npm, version: 1.2.3, integrity: ${approvedIntegrity} }
      - id: private-plugin
        visibility: private
        source: { kind: artifact, version: 2.0.0, digest: ${artifactDigest} }
assignments:
  worker: { web: stable-web }
`)

  const dshBinary = join(binDir, 'dsh')
  await writeFile(dshBinary, `#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const args = process.argv.slice(2)
fs.appendFileSync(${JSON.stringify(commandLog)}, args.join(' ') + '\\n')
if (args[0] === '--version') { process.stdout.write('0.1.0-rc.7\\n'); process.exit(0) }
if (args[0] === '--profile' && args[2] === '--dump-config') { process.stdout.write('[]\\n'); process.exit(0) }
if (args[0] !== 'plugin' || args[1] !== '--profile') process.exit(9)
const profileDir = path.join(process.env.DSH_HOME, 'profiles', args[2])
const packagePath = path.join(profileDir, 'package.json')
const manifest = JSON.parse(fs.readFileSync(packagePath, 'utf8'))
manifest.dependencies ||= {}
manifest.dsh ||= { profile: { bundles: [] } }
manifest.dsh.profile ||= { bundles: [] }
manifest.dsh.profile.bundles ||= []
if (args[3] === 'remove') {
  const existing = manifest.dependencies[args[4]]
  if (typeof existing === 'string' && existing.startsWith('link:')) {
    fs.rmSync(path.join(existing.slice('link:'.length), 'node_modules'), { recursive: true, force: true })
  }
  delete manifest.dependencies[args[4]]
  manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter(id => id !== args[4])
  fs.rmSync(path.join(profileDir, 'node_modules', args[4]), { recursive: true, force: true })
} else if (args[3] === 'add') {
  const input = args[4]
  const artifact = input.endsWith('.tgz')
  const split = input.lastIndexOf('@')
  const id = artifact ? 'private-plugin' : input.slice(0, split)
  const spec = artifact ? 'file:' + input : input.slice(split + 1)
  manifest.dependencies[id] = spec
  if (!manifest.dsh.profile.bundles.includes(id)) manifest.dsh.profile.bundles.push(id)
  const moduleDir = path.join(profileDir, 'node_modules', id)
  if (!fs.existsSync(moduleDir)) {
    fs.mkdirSync(moduleDir, { recursive: true })
    fs.writeFileSync(path.join(moduleDir, 'package.json'), JSON.stringify({
      name: id,
      version: id === 'public-plugin' ? '1.2.3' : '2.0.0',
    }))
  }
  if (id === 'public-plugin') fs.writeFileSync(path.join(profileDir, 'pnpm-lock.yaml'), [
    "lockfileVersion: '9.0'",
    'importers:',
    '  .:',
    '    dependencies:',
    '      public-plugin:',
    '        specifier: 1.2.3',
    '        version: 1.2.3',
    'packages:',
    '  public-plugin@1.2.3:',
    '    resolution:',
    '      integrity: ${associatedIntegrity}',
    '  unrelated@9.9.9:',
    '    resolution:',
    '      integrity: ${approvedIntegrity}',
    '',
  ].join('\\n'))
} else process.exit(8)
fs.writeFileSync(packagePath, JSON.stringify(manifest, null, 2) + '\\n')
`)
  const pnpmBinary = join(binDir, 'pnpm')
  await writeFile(pnpmBinary, `#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const args = process.argv.slice(2)
if (args[0] === '--version') { process.stdout.write('11.22.0\\n'); process.exit(0) }
if (args[0] !== 'install') process.exit(9)
const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'))
for (const id of ['public-plugin', 'private-plugin']) {
  if (manifest.dependencies?.[id] === undefined) continue
  const moduleDir = path.join(process.cwd(), 'node_modules', id)
  if (!fs.existsSync(moduleDir)) {
    fs.mkdirSync(moduleDir, { recursive: true })
    fs.writeFileSync(path.join(moduleDir, 'package.json'), JSON.stringify({
      name: id,
      version: id === 'public-plugin' ? '1.2.3' : '2.0.0',
    }))
  }
}
`)
  const tarBinary = join(binDir, 'tar')
  await writeFile(tarBinary, `#!/usr/bin/env node
process.stdout.write(JSON.stringify({
  name: 'private-plugin',
  version: '2.0.0',
  dsh: { bundle: { patch: './cordis.patch.yml' } }
}))
`)
  const screenBinary = join(binDir, 'screen')
  const lsofBinary = join(binDir, 'lsof')
  const psBinary = join(binDir, 'ps')
  await writeFile(screenBinary, '#!/bin/sh\nexit 0\n')
  await writeFile(lsofBinary, '#!/bin/sh\nexit 1\n')
  await writeFile(psBinary, '#!/bin/sh\nexit 1\n')
  await Promise.all([dshBinary, pnpmBinary, tarBinary, screenBinary, lsofBinary, psBinary].map(path => chmod(path, 0o755)))
  const identity = generateKeyPairSync('ed25519')
  const privateKeyPath = join(root, 'identity.private.pem')
  const trustStorePath = join(root, 'trust-store.json')
  await writeFile(privateKeyPath, identity.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
  await writeFile(trustStorePath, JSON.stringify({ schemaVersion: 1, teamId: 'test-team', entries: [] }, null, 2) + '\n')

  const health = createServer((request, response) => {
    if (request.method !== 'POST') {
      response.writeHead(200).end('ready\n')
      return
    }
    const chunks: Buffer[] = []
    request.on('data', chunk => chunks.push(Buffer.from(chunk)))
    request.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { rpcId: string }
      const profile = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8')) as {
        dependencies?: Record<string, string>
      }
      const privateInstalled = profile.dependencies?.['private-plugin']?.startsWith('file:') === true
      const fail = existsSync(failHealthMarker) && privateInstalled
      const omitRuntime = runtimeMode === 'legacy-always' ||
        (runtimeMode === 'legacy-before-install' && !privateInstalled)
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({
        type: 'server-response',
        rpcId: body.rpcId,
        result: {
          ok: true,
          value: {
            manifest: { path: runtimeManifestBinding === 'profile-local' ? join(profileDir, 'fleet.lock.yaml') : manifestPath },
            summary: { failed: 0 },
            plugins: [
              { id: 'public-plugin', state: profile.dependencies?.['public-plugin'] === '1.2.3' ? 'aligned' : 'missing' },
              { id: 'private-plugin', state: privateInstalled ? 'aligned' : 'missing' },
            ],
            ...(omitRuntime ? {} : { runtime: { failedModules: fail ? ['private-plugin'] : [] } }),
          },
        },
      }))
    })
  })
  await new Promise<void>((resolve, reject) => {
    health.once('error', reject)
    health.listen(0, '127.0.0.1', resolve)
  })
  servers.push(health)
  const port = (health.address() as AddressInfo).port
  return {
    profileDir,
    artifactDigest,
    failHealthMarker,
    commandLog,
    legacyPublic,
    legacyPrivate,
    config: {
      schemaVersion: 2,
      deviceId: 'worker',
      manifestPath,
      dshHome,
      dshBinary,
      pnpmBinary,
      profile: 'web',
      stateDir,
      planTtlMs: 300_000,
      artifactStore,
      tarBinary,
      restart: {
        kind: 'screen',
        screenBinary,
        lsofBinary,
        psBinary,
        ownerMarkers: ['fake-dsh'],
        sessionName: 'fake-dsh',
        host: '127.0.0.1',
        port,
        managedPorts: [port],
      },
      health: { url: `http://127.0.0.1:${port}`, timeoutMs: 1500, requireFleetRpc: true },
      a2a: {
        teamId: 'test-team', principalId: 'owner', privateKeyPath, trustStorePath, maxMessageTtlMs: 900_000,
      },
      tasks: {
        enabled: false, workspaces: { repo: workspace }, profiles: ['web'], timeoutMs: 60_000,
        maxOutputBytes: 64 * 1024, maxConcurrent: 1,
      },
    },
  }
}

function approval(plan: FleetReleasePlan): FleetReleaseApproval {
  return {
    protocolVersion: 1,
    kind: 'profile-release',
    approvalId: 'release-approval',
    principalId: 'owner',
    planId: plan.planId,
    planDigest: plan.digest,
    deviceId: plan.deviceId,
    profile: plan.profile,
    approvedAt: new Date(Date.parse(plan.createdAt) + 1000).toISOString(),
    expiresAt: new Date(Date.parse(plan.createdAt) + 120_000).toISOString(),
  }
}

describe('atomic profile release runtime', () => {
  it('stages, atomically swaps, verifies and records one public/private release', async () => {
    const { config, profileDir, artifactDigest } = await setup()
    const now = new Date('2026-08-19T08:00:00.000Z')
    const inspection = await inspectReleaseAgent(config, now)
    expect(inspection).toMatchObject({
      kind: 'profile-release',
      assignedRelease: { releaseId: 'stable-web', releaseVersion: '3.0.0' },
    })
    expect(inspection.changes.map(change => [change.pluginId, change.action])).toEqual([
      ['private-plugin', 'install'],
      ['public-plugin', 'install'],
    ])
    const plan = await createStoredReleasePlan(config, now)
    expect(JSON.stringify(plan)).not.toContain(config.artifactStore)
    const result = await applyStoredReleasePlan(config, approval(plan), new Date('2026-08-19T08:01:00.000Z'))
    expect(result).toMatchObject({ state: 'succeeded', result: 'success', releaseId: 'stable-web' })
    const profile = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
      dsh: { profile: { bundles: string[] } }
    }
    expect(profile.dependencies).toMatchObject({ 'public-plugin': '1.2.3', unmanaged: '9.9.9' })
    expect(profile.dependencies['private-plugin']).toBe(`file:${config.artifactStore}/${artifactDigest}.tgz`)
    expect(profile.dsh.profile.bundles).toEqual(expect.arrayContaining(['public-plugin', 'private-plugin', 'unmanaged']))
    expect(await readFile(join(profileDir, 'fleet.lock.yaml'), 'utf8')).toBe(await readFile(config.manifestPath, 'utf8'))
    expect(await readAppliedRelease(config)).toMatchObject({ releaseId: 'stable-web', releaseVersion: '3.0.0' })
    expect((await readdir(join(config.dshHome, 'profiles'))).sort()).toEqual(['web'])
    expect(await applyStoredReleasePlan(config, approval(plan), new Date('2026-08-19T08:01:01.000Z'))).toEqual(result)
  })

  it('restores the old profile when post-swap runtime health fails', async () => {
    const { config, profileDir, failHealthMarker } = await setup()
    const before = await readFile(join(profileDir, 'package.json'), 'utf8')
    const beforeRuntimeManifest = await readFile(join(profileDir, 'fleet.lock.yaml'), 'utf8')
    const plan = await createStoredReleasePlan(config, new Date('2026-08-19T08:00:00.000Z'))
    await writeFile(failHealthMarker, 'fail\n')
    const result = await applyStoredReleasePlan(config, approval(plan), new Date('2026-08-19T08:01:00.000Z'))
    expect(result).toMatchObject({ state: 'rolled-back', result: 'rolled-back', errorCode: 'runtime-modules-failed' })
    expect(await readFile(join(profileDir, 'package.json'), 'utf8')).toBe(before)
    expect(await readFile(join(profileDir, 'fleet.lock.yaml'), 'utf8')).toBe(beforeRuntimeManifest)
    expect(await readAppliedRelease(config)).toBeNull()
    expect((await readdir(join(config.dshHome, 'profiles'))).sort()).toEqual(['web'])
  })

  it('atomically swaps a new runtime manifest even when plugin coordinates are unchanged', async () => {
    const { config, profileDir } = await setup()
    const first = await createStoredReleasePlan(config, new Date('2026-08-19T08:00:00.000Z'))
    await expect(applyStoredReleasePlan(config, approval(first), new Date('2026-08-19T08:01:00.000Z'))).resolves.toMatchObject({
      state: 'succeeded',
      result: 'success',
    })
    const nextManifest = (await readFile(config.manifestPath, 'utf8'))
      .replace('stable-web:', 'stable-web-next:')
      .replace('version: 3.0.0', 'version: 3.0.1')
      .replace('{ web: stable-web }', '{ web: stable-web-next }')
    await writeFile(config.manifestPath, nextManifest)
    const second = await createStoredReleasePlan(config, new Date('2026-08-19T08:02:00.000Z'))
    expect(second.changes).toEqual([])
    expect(second.restartRequired).toBe(true)
    await expect(applyStoredReleasePlan(config, approval(second), new Date('2026-08-19T08:03:00.000Z'))).resolves.toMatchObject({
      state: 'succeeded',
      result: 'success',
      releaseId: 'stable-web-next',
    })
    expect(await readFile(join(profileDir, 'fleet.lock.yaml'), 'utf8')).toBe(nextManifest)
    expect(await readAppliedRelease(config)).toMatchObject({ releaseId: 'stable-web-next', releaseVersion: '3.0.1' })
  })

  it('rejects an approved npm integrity that appears only on an unrelated lock entry', async () => {
    const { config, profileDir } = await setup('sha512-WFla', 'sha512-YWJjZA==')
    const before = await readFile(join(profileDir, 'package.json'), 'utf8')
    const plan = await createStoredReleasePlan(config, new Date('2026-08-19T08:00:00.000Z'))
    const result = await applyStoredReleasePlan(config, approval(plan), new Date('2026-08-19T08:01:00.000Z'))
    expect(result).toMatchObject({ state: 'rolled-back', errorCode: 'npm-integrity-mismatch' })
    expect(await readFile(join(profileDir, 'package.json'), 'utf8')).toBe(before)
  })

  it('doctors release, health, identity, trust, executable and workspace readiness without mutation', async () => {
    const { config } = await setup()
    await expect(doctorAgent(config, new Date('2026-08-19T08:00:00.000Z'))).resolves.toMatchObject({
      ready: true,
      deviceId: 'worker',
      profile: 'web',
      releaseId: 'stable-web',
      healthVerified: true,
      trustedPeerCount: 0,
      tasksEnabled: false,
      workspaceIds: ['repo'],
      executableChecks: expect.arrayContaining(['dsh', 'pnpm', 'tar', 'screen', 'lsof', 'ps']),
    })
  })

  it('rejects a runtime still bound to an external manifest path', async () => {
    const { config } = await setup('sha512-YWJjZA==', 'sha512-YWJjZA==', 'current', false, 'external')
    await expect(doctorAgent(config, new Date('2026-08-19T08:00:00.000Z'))).rejects.toMatchObject({
      code: 'fleet-runtime-manifest-path-mismatch',
    })
  })

  it('accepts a legacy preflight response while requiring current runtime health after the swap', async () => {
    const { config } = await setup('sha512-YWJjZA==', 'sha512-YWJjZA==', 'legacy-before-install')
    await expect(doctorAgent(config, new Date('2026-08-19T08:00:00.000Z'))).resolves.toMatchObject({ ready: true })
    const plan = await createStoredReleasePlan(config, new Date('2026-08-19T08:00:00.000Z'))
    await expect(applyStoredReleasePlan(config, approval(plan), new Date('2026-08-19T08:01:00.000Z'))).resolves.toMatchObject({
      state: 'succeeded',
      result: 'success',
    })
  })

  it('rolls back when the post-swap response still omits runtime health', async () => {
    const { config } = await setup('sha512-YWJjZA==', 'sha512-YWJjZA==', 'legacy-always')
    const plan = await createStoredReleasePlan(config, new Date('2026-08-19T08:00:00.000Z'))
    await expect(applyStoredReleasePlan(config, approval(plan), new Date('2026-08-19T08:01:00.000Z'))).resolves.toMatchObject({
      state: 'rolled-back',
      result: 'rolled-back',
      errorCode: 'fleet-rpc-unhealthy',
    })
    expect(await readAppliedRelease(config)).toBeNull()
  })

  it('replaces mutable bindings without running a destructive package remove', async () => {
    const { config, commandLog, profileDir, legacyPublic, legacyPrivate } = await setup('sha512-YWJjZA==', 'sha512-YWJjZA==', 'current', true)
    const plan = await createStoredReleasePlan(config, new Date('2026-08-19T08:00:00.000Z'))
    expect(plan.changes.map(change => [change.pluginId, change.action])).toEqual([
      ['private-plugin', 'update'],
      ['public-plugin', 'update'],
    ])
    await expect(applyStoredReleasePlan(config, approval(plan), new Date('2026-08-19T08:01:00.000Z'))).resolves.toMatchObject({
      state: 'succeeded',
      result: 'success',
    })
    const commands = (await readFile(commandLog, 'utf8')).trim().split('\n')
    for (const pluginId of ['private-plugin', 'public-plugin']) {
      const added = commands.findIndex(command => command.includes(' add ') && command.includes(pluginId === 'private-plugin' ? '.tgz' : pluginId + '@'))
      expect(commands.some(command => command.includes(' remove ' + pluginId))).toBe(false)
      expect(added).toBeGreaterThanOrEqual(0)
    }
    expect(existsSync(join(legacyPublic, 'node_modules', 'keep'))).toBe(true)
    expect(existsSync(join(legacyPrivate, 'node_modules', 'keep'))).toBe(true)
    expect(JSON.parse(await readFile(join(profileDir, 'node_modules/private-plugin/package.json'), 'utf8'))).toMatchObject({ version: '2.0.0' })
    expect(JSON.parse(await readFile(join(profileDir, 'node_modules/public-plugin/package.json'), 'utf8'))).toMatchObject({ version: '1.2.3' })
  })
})

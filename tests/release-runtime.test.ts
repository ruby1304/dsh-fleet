import { createHash, generateKeyPairSync } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LOCAL_TASK_POLICIES, parseAgentConfig, type FleetAgentConfig } from '../src/agent/config.ts'
import {
  applyStoredReleaseRollbackPlan,
  applyStoredReleasePlan,
  createStoredReleaseRollbackPlan,
  createStoredReleasePlan,
  inspectReleaseAgent,
  readAppliedRelease,
  readOrRecoverReleaseAction,
  readOrRecoverReleaseRollbackAction,
} from '../src/agent/runtime.ts'
import { doctorAgent } from '../src/agent/doctor.ts'
import { inspectCurrentRuntimeIdentity } from '../src/host/runtime-identity.ts'
import type {
  FleetReleaseApproval,
  FleetReleasePlan,
  FleetReleaseRollbackApproval,
  FleetReleaseRollbackPlan,
} from '../src/agent/release-protocol.ts'

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
  desiredManifestPath: string
  profileDir: string
  artifactDigest: string
  failHealthMarker: string
  changeDshVersionOnStageMarker: string
  changeServiceOnStageMarker: string
  armWrongRuntimeAfterStartMarker: string
  delayLaunchdExitMarker: string
  runtimeSelectionMarker: string
  commandLog: string
  legacyPublic: string
  legacyPrivate: string
  launchdConfig: FleetAgentConfig
}> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-fleet-release-runtime-'))
  roots.push(root)
  const binDir = join(root, 'bin')
  const dshHome = join(root, 'dsh-home')
  const profileDir = join(dshHome, 'profiles', 'web')
  const artifactStore = join(root, 'artifacts')
  const stateDir = join(root, 'state')
  const failHealthMarker = join(root, 'fail-health')
  const changeDshVersionOnStageMarker = join(root, 'change-dsh-version-on-stage')
  const dshVersionChangedMarker = join(root, 'dsh-version-changed')
  const changeServiceOnStageMarker = join(root, 'change-service-on-stage')
  const armWrongRuntimeAfterStartMarker = join(root, 'arm-wrong-runtime-after-start')
  const delayLaunchdExitMarker = join(root, 'delay-launchd-exit')
  const serviceExitReadyAtMarker = join(root, 'service-exit-ready-at')
  const runtimeSelectionMarker = join(root, 'runtime-selection')
  const serviceStoppedMarker = join(root, 'service-stopped')
  const workspace = join(root, 'workspace')
  const commandLog = join(root, 'commands.log')
  const legacyPublic = join(root, 'legacy-public')
  const legacyPrivate = join(root, 'legacy-private')
  const runtimePackages = Object.fromEntries(['a', 'b', 'rc5'].map(id => [
    id,
    join(root, 'runtime', id, 'node_modules', '@deepseek-ai', 'dsh'),
  ])) as Record<'a' | 'b' | 'rc5', string>
  await Promise.all([
    mkdir(binDir, { recursive: true }),
    mkdir(profileDir, { recursive: true }),
    mkdir(join(profileDir, 'node_modules'), { recursive: true }),
    mkdir(artifactStore, { recursive: true }),
    mkdir(workspace, { recursive: true }),
    mkdir(legacyPublic, { recursive: true }),
    mkdir(legacyPrivate, { recursive: true }),
    ...Object.values(runtimePackages).map(path => mkdir(join(path, 'lib'), { recursive: true })),
  ])
  await Promise.all((Object.entries(runtimePackages) as Array<['a' | 'b' | 'rc5', string]>).flatMap(([id, packageRoot]) => [
    writeFile(join(packageRoot, 'lib', 'bin.js'), `process.stdout.write(${JSON.stringify(id)})\n`),
    writeFile(join(packageRoot, 'package.json'), JSON.stringify({
      name: '@deepseek-ai/dsh',
      version: id === 'rc5' ? '0.1.0-rc.5' : '0.1.0-rc.8',
    }) + '\n'),
  ]))
  const runtimeIdentities = Object.fromEntries(await Promise.all(
    (Object.entries(runtimePackages) as Array<['a' | 'b' | 'rc5', string]>).map(async ([id, packageRoot]) => [
      id,
      await inspectCurrentRuntimeIdentity({ execPath: process.execPath, entrypointPath: join(packageRoot, 'lib', 'bin.js') }),
    ]),
  )) as Record<'a' | 'b' | 'rc5', Awaited<ReturnType<typeof inspectCurrentRuntimeIdentity>>>
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
  await writeFile(join(profileDir, 'cordis.yml'), 'root: preserved\n')
  await writeFile(join(profileDir, 'fleet.lock.yaml'), `schemaVersion: 1
team: { id: test-team }
devices:
  worker: { assignedTo: owner, class: always-on-worker, channel: stable }
plugins: []
`)

  const artifact = 'private plugin artifact fixture'
  const artifactDigest = createHash('sha256').update(artifact).digest('hex')
  await writeFile(join(artifactStore, artifactDigest + '.tgz'), artifact)
  const desiredManifestPath = join(root, 'fleet.lock.yaml')
  await writeFile(desiredManifestPath, `schemaVersion: 2
team: { id: test-team }
devices:
  worker: { assignedTo: owner, class: always-on-worker, channel: stable }
profileReleases:
  stable-web:
    version: 3.0.0
    profile: web
    dshRange: "0.1.0-rc.8"
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
if (args[0] === '--version') {
  process.stdout.write(fs.existsSync(${JSON.stringify(dshVersionChangedMarker)}) ? '0.1.0-rc.7\\n' : '0.1.0-rc.8\\n')
  process.exit(0)
}
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
  if (fs.existsSync(${JSON.stringify(changeDshVersionOnStageMarker)})) {
    fs.writeFileSync(${JSON.stringify(dshVersionChangedMarker)}, 'changed\\n')
  }
  if (fs.existsSync(${JSON.stringify(changeServiceOnStageMarker)})) {
    fs.writeFileSync(${JSON.stringify(runtimeSelectionMarker)}, 'b\\n')
  }
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
fs.appendFileSync(${JSON.stringify(commandLog)}, 'pnpm ' + args.join(' ') + '\\n')
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
      const failureMode = existsSync(failHealthMarker) ? readFileSync(failHealthMarker, 'utf8').trim() : ''
      const runtimeManifest = readFileSync(join(profileDir, 'fleet.lock.yaml'), 'utf8')
      const fail = privateInstalled && (failureMode === 'fail' || (failureMode === 'next' && runtimeManifest.includes('version: 3.0.1')))
      const omitRuntime = runtimeMode === 'legacy-always' ||
        (runtimeMode === 'legacy-before-install' && !privateInstalled)
      const omitRuntimeIdentity = (runtimeMode === 'legacy-before-install' && !privateInstalled) ||
        (runtimeMode === 'legacy-always' && privateInstalled)
      const runtimeSelection = existsSync(runtimeSelectionMarker)
        ? readFileSync(runtimeSelectionMarker, 'utf8').trim() as 'a' | 'b' | 'rc5'
        : 'a'
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({
        type: 'server-response',
        rpcId: body.rpcId,
        result: {
          ok: true,
          value: {
            manifest: { path: runtimeManifestBinding === 'profile-local' ? join(profileDir, 'fleet.lock.yaml') : desiredManifestPath },
            summary: { failed: 0 },
            plugins: [
              { id: 'public-plugin', state: profile.dependencies?.['public-plugin'] === '1.2.3' ? 'aligned' : 'missing' },
              { id: 'private-plugin', state: privateInstalled ? 'aligned' : 'missing' },
            ],
            ...(omitRuntime ? {} : { runtime: { failedModules: fail ? ['private-plugin'] : [] } }),
            ...(omitRuntimeIdentity ? {} : { runtimeIdentity: runtimeIdentities[runtimeSelection] }),
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
  const launchctlBinary = join(binDir, 'launchctl')
  const launchdLsofBinary = join(binDir, 'launchd-lsof')
  const launchdPsBinary = join(binDir, 'launchd-ps')
  const serviceTarget = 'gui/502/com.example.dsh-web'
  await writeFile(launchctlBinary, `#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const args = process.argv.slice(2)
fs.appendFileSync(${JSON.stringify(commandLog)}, 'launchctl ' + args.join(' ') + '\\n')
const selection = () => fs.existsSync(${JSON.stringify(runtimeSelectionMarker)})
  ? fs.readFileSync(${JSON.stringify(runtimeSelectionMarker)}, 'utf8').trim()
  : 'a'
const exitReadyAt = () => fs.existsSync(${JSON.stringify(serviceExitReadyAtMarker)})
  ? Number(fs.readFileSync(${JSON.stringify(serviceExitReadyAtMarker)}, 'utf8').trim())
  : null
if (args[0] === 'print' && args[1] === ${JSON.stringify(serviceTarget)}) {
  if (fs.existsSync(${JSON.stringify(serviceStoppedMarker)}) &&
      (exitReadyAt() === null || Date.now() >= exitReadyAt())) {
    process.stdout.write(${JSON.stringify(serviceTarget)} + ' = {\\n\\tstate = not running\\n}\\n')
    process.exit(0)
  }
  const id = selection()
  const packages = ${JSON.stringify(runtimePackages)}
  const entrypoint = path.join(packages[id], 'lib', 'bin.js')
  process.stdout.write(${JSON.stringify(serviceTarget)} + ' = {\\n' +
    '\\tprogram = ' + ${JSON.stringify(process.execPath)} + '\\n' +
    '\\targuments = {\\n' +
    '\\t\\t' + ${JSON.stringify(process.execPath)} + '\\n' +
    '\\t\\t' + entrypoint + '\\n' +
    '\\t\\tweb\\n\\t\\t--host\\n\\t\\t127.0.0.1\\n\\t\\t--port\\n\\t\\t' + ${JSON.stringify(String(port))} + '\\n' +
    '\\t}\\n\\tenvironment = {\\n\\t\\tPATH => /usr/bin:/bin\\n\\t\\tDSH_HOME => ' + ${JSON.stringify(dshHome)} + '\\n\\t}\\n' +
    '\\tpid = ' + ${JSON.stringify(String(process.pid))} + '\\n}\\n')
  process.exit(0)
}
if (args[0] === 'kill') {
  fs.writeFileSync(${JSON.stringify(serviceStoppedMarker)}, 'stopped\\n')
  if (fs.existsSync(${JSON.stringify(delayLaunchdExitMarker)})) {
    fs.writeFileSync(${JSON.stringify(serviceExitReadyAtMarker)}, String(Date.now() + 250) + '\\n')
  } else {
    fs.rmSync(${JSON.stringify(serviceExitReadyAtMarker)}, { force: true })
  }
  fs.rmSync(${JSON.stringify(runtimeSelectionMarker)}, { force: true })
  process.exit(0)
}
if (args[0] === 'kickstart') {
  if (exitReadyAt() !== null && Date.now() < exitReadyAt()) process.exit(12)
  fs.rmSync(${JSON.stringify(serviceStoppedMarker)}, { force: true })
  fs.rmSync(${JSON.stringify(serviceExitReadyAtMarker)}, { force: true })
  if (fs.existsSync(${JSON.stringify(armWrongRuntimeAfterStartMarker)})) {
    fs.writeFileSync(${JSON.stringify(runtimeSelectionMarker)}, 'b\\n')
    fs.rmSync(${JSON.stringify(armWrongRuntimeAfterStartMarker)}, { force: true })
  }
  process.exit(0)
}
process.exit(9)
`)
  await writeFile(launchdLsofBinary, `#!/usr/bin/env node
const fs = require('node:fs')
if (!fs.existsSync(${JSON.stringify(serviceStoppedMarker)})) process.stdout.write(${JSON.stringify(String(process.pid) + '\n')})
`)
  await writeFile(launchdPsBinary, `#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const id = fs.existsSync(${JSON.stringify(runtimeSelectionMarker)})
  ? fs.readFileSync(${JSON.stringify(runtimeSelectionMarker)}, 'utf8').trim()
  : 'a'
process.stdout.write(${JSON.stringify(process.execPath + ' ')} + path.join(${JSON.stringify(runtimePackages.a)}, '..', '..', '..', '..', '..') +
  ' @deepseek-ai/dsh/lib/bin.js web --host 127.0.0.1 --port ' + ${JSON.stringify(String(port))} + '\\n')
void id
`)
  await Promise.all([launchctlBinary, launchdLsofBinary, launchdPsBinary].map(path => chmod(path, 0o755)))
  const config: FleetAgentConfig = {
    schemaVersion: 2,
    deviceId: 'worker',
    manifestPath: join(profileDir, 'fleet.lock.yaml'),
    desiredManifestPath,
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
      policyIds: ['readonly-v1'],
      policies: { 'readonly-v1': LOCAL_TASK_POLICIES['readonly-v1'] },
    },
  }
  return {
    profileDir,
    desiredManifestPath,
    artifactDigest,
    failHealthMarker,
    changeDshVersionOnStageMarker,
    changeServiceOnStageMarker,
    armWrongRuntimeAfterStartMarker,
    delayLaunchdExitMarker,
    runtimeSelectionMarker,
    commandLog,
    legacyPublic,
    legacyPrivate,
    config,
    launchdConfig: {
      ...config,
      restart: {
        kind: 'launchd',
        launchctlBinary,
        lsofBinary: launchdLsofBinary,
        psBinary: launchdPsBinary,
        ownerMarkers: ['@deepseek-ai/dsh/lib/bin.js'],
        serviceTarget,
        host: '127.0.0.1',
        port,
        managedPorts: [port],
      },
    },
  }
}

function approval(plan: FleetReleasePlan): FleetReleaseApproval {
  return {
    protocolVersion: 2,
    kind: 'profile-release',
    approvalId: 'release-approval',
    principalId: 'owner',
    planId: plan.planId,
    planDigest: plan.digest,
    deviceId: plan.deviceId,
    profile: plan.profile,
    fromManifestDigest: plan.fromManifestDigest,
    toManifestDigest: plan.toManifestDigest,
    fromReleaseDigest: plan.fromReleaseDigest,
    toReleaseDigest: plan.toReleaseDigest,
    approvedAt: new Date(Date.parse(plan.createdAt) + 1000).toISOString(),
    expiresAt: new Date(Date.parse(plan.createdAt) + 120_000).toISOString(),
  }
}

function rollbackApproval(plan: FleetReleaseRollbackPlan): FleetReleaseRollbackApproval {
  return {
    protocolVersion: 2,
    kind: 'profile-release-rollback',
    approvalId: 'release-rollback-approval',
    principalId: 'owner',
    planId: plan.planId,
    planDigest: plan.digest,
    transitionPlanId: plan.transitionPlanId,
    deviceId: plan.deviceId,
    profile: plan.profile,
    fromManifestDigest: plan.fromManifestDigest,
    toManifestDigest: plan.toManifestDigest,
    fromReleaseDigest: plan.fromReleaseDigest,
    toReleaseDigest: plan.toReleaseDigest,
    approvedAt: new Date(Date.parse(plan.createdAt) + 1000).toISOString(),
    expiresAt: new Date(Date.parse(plan.createdAt) + 120_000).toISOString(),
  }
}

describe('atomic profile release runtime', () => {
  it('migrates a pre-0.4 schema 2 manifestPath into a desired candidate while fixing live to the profile', async () => {
    const { config, desiredManifestPath, profileDir } = await setup()
    if (config.tasks === undefined) throw new Error('test task config is missing')
    const serializedConfig: FleetAgentConfig = {
      ...config,
      manifestPath: desiredManifestPath,
      health: { ...config.health, timeoutMs: 3000 },
      tasks: { ...config.tasks },
    }
    delete serializedConfig.desiredManifestPath
    if (serializedConfig.tasks !== undefined) delete serializedConfig.tasks.policies
    const parsed = parseAgentConfig(serializedConfig)
    expect(parsed.manifestPath).toBe(join(profileDir, 'fleet.lock.yaml'))
    expect(parsed.desiredManifestPath).toBe(desiredManifestPath)
  })

  it('stages, atomically swaps, verifies and records one public/private release', async () => {
    const { config, desiredManifestPath, profileDir, artifactDigest } = await setup()
    const now = new Date('2026-08-19T08:00:00.000Z')
    const inspection = await inspectReleaseAgent(config, now)
    expect(inspection).toMatchObject({
      kind: 'profile-release',
      manifestDigest: inspection.desiredManifestDigest,
      liveManifestDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
      desiredManifestDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
      assignedRelease: { releaseId: 'stable-web', releaseVersion: '3.0.0' },
      tasks: {
        timeoutMs: 60_000,
        executionProfiles: [{
          profile: 'web',
          profileHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        }],
        policies: [{
          policyId: 'readonly-v1',
          policyDigest: LOCAL_TASK_POLICIES['readonly-v1'].policyDigest,
          permissionMode: 'read-only',
        }],
      },
      retention: {
        retainedCount: 0,
        eligibleCount: 0,
        orphanCount: 0,
      },
    })
    expect(inspection.manifestDigest).toBe(inspection.desiredManifestDigest)
    expect(inspection.liveManifestDigest).not.toBe(inspection.desiredManifestDigest)
    expect(JSON.stringify(inspection.tasks)).not.toContain('safeTools')
    expect(JSON.stringify(inspection.tasks)).not.toContain('hardDeniedTools')
    expect(inspection.tasks.executionProfiles[0]?.profileHash).toBe(inspection.profileHash)
    expect(inspection.changes.map(change => [change.pluginId, change.action])).toEqual([
      ['private-plugin', 'install'],
      ['public-plugin', 'install'],
    ])
    const plan = await createStoredReleasePlan(config, now)
    expect(JSON.stringify(plan)).not.toContain(config.artifactStore)
    const result = await applyStoredReleasePlan(config, approval(plan), new Date('2026-08-19T08:01:00.000Z'))
    expect(result).toMatchObject({
      state: 'succeeded',
      result: 'success',
      releaseId: 'stable-web',
      fromManifestDigest: plan.fromManifestDigest,
      toManifestDigest: plan.toManifestDigest,
      fromReleaseDigest: plan.fromReleaseDigest,
      toReleaseDigest: plan.toReleaseDigest,
      rollbackDescriptorDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
    })
    const profile = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
      dsh: { profile: { bundles: string[] } }
    }
    expect(profile.dependencies).toMatchObject({ 'public-plugin': '1.2.3', unmanaged: '9.9.9' })
    expect(profile.dependencies['private-plugin']).toBe(`file:${config.artifactStore}/${artifactDigest}.tgz`)
    expect(profile.dsh.profile.bundles).toEqual(expect.arrayContaining(['public-plugin', 'private-plugin', 'unmanaged']))
    expect(await readFile(join(profileDir, 'cordis.yml'), 'utf8')).toBe('root: preserved\n')
    expect(await readFile(join(profileDir, 'fleet.lock.yaml'), 'utf8')).toBe(await readFile(desiredManifestPath, 'utf8'))
    expect(await readAppliedRelease(config)).toMatchObject({
      schemaVersion: 2,
      releaseId: 'stable-web',
      releaseVersion: '3.0.0',
      transitionPlanId: plan.planId,
      transitionPlanDigest: plan.digest,
    })
    expect(await readdir(join(config.dshHome, 'profiles'))).toEqual(expect.arrayContaining([
      'web',
      expect.stringMatching(/^fleet-backup-[0-9a-f]{24}$/),
    ]))
    expect(await applyStoredReleasePlan(config, approval(plan), new Date('2026-08-19T08:01:01.000Z'))).toEqual(result)
  })

  it('binds a launchd release to the exact running DSH and service definition', async () => {
    const { launchdConfig } = await setup()
    const plan = await createStoredReleasePlan(launchdConfig, new Date('2026-08-19T08:00:00.000Z'))
    expect(plan).toMatchObject({
      observedDshVersion: '0.1.0-rc.8',
      observedRuntimeDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
      observedServiceDefinitionDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
    })
    await expect(applyStoredReleasePlan(
      launchdConfig,
      approval(plan),
      new Date('2026-08-19T08:01:00.000Z'),
    )).resolves.toMatchObject({ state: 'succeeded', result: 'success' })
  })

  it('waits for the old launchd job to exit after its listener is released', async () => {
    const { launchdConfig, delayLaunchdExitMarker } = await setup()
    const plan = await createStoredReleasePlan(launchdConfig, new Date('2026-08-19T08:00:00.000Z'))
    await writeFile(delayLaunchdExitMarker, 'armed\n')
    await expect(applyStoredReleasePlan(
      launchdConfig,
      approval(plan),
      new Date('2026-08-19T08:01:00.000Z'),
    )).resolves.toMatchObject({ state: 'succeeded', result: 'success' })
  })

  it('rejects launchd rc.5 even when the configured release tool reports rc.8', async () => {
    const { launchdConfig, runtimeSelectionMarker } = await setup()
    await writeFile(runtimeSelectionMarker, 'rc5\n')
    await expect(createStoredReleasePlan(
      launchdConfig,
      new Date('2026-08-19T08:00:00.000Z'),
    )).rejects.toMatchObject({ code: 'runtime-identity-mismatch' })
  })

  it('rejects a launchd service definition change after staging and before stop', async () => {
    const { launchdConfig, changeServiceOnStageMarker, commandLog, profileDir } = await setup()
    const before = await readFile(join(profileDir, 'package.json'), 'utf8')
    const plan = await createStoredReleasePlan(launchdConfig, new Date('2026-08-19T08:00:00.000Z'))
    await writeFile(changeServiceOnStageMarker, 'armed\n')
    await expect(applyStoredReleasePlan(
      launchdConfig,
      approval(plan),
      new Date('2026-08-19T08:01:00.000Z'),
    )).resolves.toMatchObject({ state: 'manual-intervention', result: 'manual-intervention', errorCode: 'approval-mismatch' })
    expect(await readFile(join(profileDir, 'package.json'), 'utf8')).toBe(before)
    expect(await readFile(commandLog, 'utf8')).not.toContain('launchctl kill ')
  })

  it('automatically rolls back when launchd restarts into another runtime', async () => {
    const { launchdConfig, armWrongRuntimeAfterStartMarker, profileDir } = await setup()
    const before = await readFile(join(profileDir, 'package.json'), 'utf8')
    const plan = await createStoredReleasePlan(launchdConfig, new Date('2026-08-19T08:00:00.000Z'))
    await writeFile(armWrongRuntimeAfterStartMarker, 'armed\n')
    await expect(applyStoredReleasePlan(
      launchdConfig,
      approval(plan),
      new Date('2026-08-19T08:01:00.000Z'),
    )).resolves.toMatchObject({ state: 'rolled-back', result: 'rolled-back', errorCode: 'approval-mismatch' })
    expect(await readFile(join(profileDir, 'package.json'), 'utf8')).toBe(before)
    expect(await readAppliedRelease(launchdConfig)).toBeNull()
  })

  it('restores the old profile when post-swap runtime health fails', async () => {
    const { config, profileDir, failHealthMarker } = await setup()
    const before = await readFile(join(profileDir, 'package.json'), 'utf8')
    const beforeRuntimeManifest = await readFile(join(profileDir, 'fleet.lock.yaml'), 'utf8')
    const beforeCordis = await readFile(join(profileDir, 'cordis.yml'), 'utf8')
    const plan = await createStoredReleasePlan(config, new Date('2026-08-19T08:00:00.000Z'))
    await writeFile(failHealthMarker, 'fail\n')
    const result = await applyStoredReleasePlan(config, approval(plan), new Date('2026-08-19T08:01:00.000Z'))
    expect(result).toMatchObject({ state: 'rolled-back', result: 'rolled-back', errorCode: 'runtime-modules-failed' })
    expect(await readFile(join(profileDir, 'package.json'), 'utf8')).toBe(before)
    expect(await readFile(join(profileDir, 'fleet.lock.yaml'), 'utf8')).toBe(beforeRuntimeManifest)
    expect(await readFile(join(profileDir, 'cordis.yml'), 'utf8')).toBe(beforeCordis)
    expect(await readAppliedRelease(config)).toBeNull()
    expect((await readdir(join(config.dshHome, 'profiles'))).sort()).toEqual(['web'])
  })

  it('restores the exact previous applied marker during automatic rollback', async () => {
    const { config, desiredManifestPath, failHealthMarker } = await setup()
    const first = await createStoredReleasePlan(config, new Date('2026-08-19T08:00:00.000Z'))
    await applyStoredReleasePlan(config, approval(first), new Date('2026-08-19T08:01:00.000Z'))
    const previousApplied = await readAppliedRelease(config)
    const nextManifest = (await readFile(desiredManifestPath, 'utf8'))
      .replace('stable-web:', 'stable-web-next:')
      .replace('version: 3.0.0', 'version: 3.0.1')
      .replace('{ web: stable-web }', '{ web: stable-web-next }')
    await writeFile(desiredManifestPath, nextManifest)
    const second = await createStoredReleasePlan(config, new Date('2026-08-19T08:02:00.000Z'))
    await writeFile(failHealthMarker, 'next\n')
    await expect(applyStoredReleasePlan(config, approval(second), new Date('2026-08-19T08:03:00.000Z'))).resolves.toMatchObject({
      state: 'rolled-back',
      result: 'rolled-back',
      errorCode: 'runtime-modules-failed',
    })
    expect(await readAppliedRelease(config)).toEqual(previousApplied)
    expect((await inspectReleaseAgent(config, new Date('2026-08-19T08:03:30.000Z'))).retention).toMatchObject({
      retainedCount: 1,
      eligibleCount: 0,
      invalidTransitionCount: 0,
    })
  }, 15_000)

  it('recovers a committed transition as succeeded only while its descriptor and backup remain durable', async () => {
    const { config } = await setup()
    const plan = await createStoredReleasePlan(config, new Date('2026-08-19T08:00:00.000Z'))
    const applied = await applyStoredReleasePlan(config, approval(plan), new Date('2026-08-19T08:01:00.000Z'))
    const actionPath = join(config.stateDir, 'release-actions', plan.planId.slice('release-plan:'.length) + '.json')
    const interrupted = { ...applied, state: 'verifying' }
    delete interrupted.result
    await writeFile(actionPath, JSON.stringify(interrupted, null, 2) + '\n')
    const recovered = await readOrRecoverReleaseAction(config, plan.planId)
    expect(recovered).toMatchObject({ state: 'succeeded', result: 'success' })
    if (recovered === null) throw new Error('recovered release action is missing')
    expect(await readdir(join(config.dshHome, 'profiles'))).toEqual(expect.arrayContaining([
      expect.stringMatching(/^fleet-backup-[0-9a-f]{24}$/),
    ]))
    await writeFile(actionPath, JSON.stringify({ ...recovered, toManifestDigest: '0'.repeat(64) }, null, 2) + '\n')
    await expect(readOrRecoverReleaseAction(config, plan.planId)).rejects.toMatchObject({ code: 'action-state-invalid' })
  })

  it('plans and applies an exact, idempotent rollback from the retained backup', async () => {
    const { config, profileDir } = await setup()
    const beforeProfile = await readFile(join(profileDir, 'package.json'), 'utf8')
    const beforeManifest = await readFile(join(profileDir, 'fleet.lock.yaml'), 'utf8')
    const transition = await createStoredReleasePlan(config, new Date('2026-08-19T08:00:00.000Z'))
    await expect(applyStoredReleasePlan(config, approval(transition), new Date('2026-08-19T08:01:00.000Z'))).resolves.toMatchObject({
      state: 'succeeded',
      result: 'success',
    })

    const plan = await createStoredReleaseRollbackPlan(config, transition.planId, new Date('2026-08-19T08:02:00.000Z'))
    expect(plan).toMatchObject({
      transitionPlanId: transition.planId,
      fromManifestDigest: transition.toManifestDigest,
      toManifestDigest: transition.fromManifestDigest,
      fromReleaseDigest: transition.toReleaseDigest,
      toReleaseDigest: transition.fromReleaseDigest,
    })
    const exactApproval = rollbackApproval(plan)
    const result = await applyStoredReleaseRollbackPlan(config, exactApproval, new Date('2026-08-19T08:03:00.000Z'))
    expect(result).toMatchObject({
      state: 'succeeded',
      result: 'success',
      transitionPlanId: transition.planId,
      fromManifestDigest: plan.fromManifestDigest,
      toManifestDigest: plan.toManifestDigest,
      fromReleaseDigest: plan.fromReleaseDigest,
      toReleaseDigest: plan.toReleaseDigest,
    })
    expect(await readFile(join(profileDir, 'package.json'), 'utf8')).toBe(beforeProfile)
    expect(await readFile(join(profileDir, 'fleet.lock.yaml'), 'utf8')).toBe(beforeManifest)
    expect(await readAppliedRelease(config)).toBeNull()
    expect((await inspectReleaseAgent(config, new Date('2026-08-19T08:03:30.000Z'))).retention).toMatchObject({
      retainedCount: 0,
      eligibleCount: 0,
      invalidTransitionCount: 0,
    })
    expect(await applyStoredReleaseRollbackPlan(config, exactApproval, new Date('2026-08-19T09:00:00.000Z'))).toEqual(result)
    await expect(applyStoredReleaseRollbackPlan(config, {
      ...exactApproval,
      approvalId: 'different-release-rollback-approval',
    }, new Date('2026-08-19T09:00:00.000Z'))).rejects.toMatchObject({ code: 'idempotency-conflict' })
    expect(await readOrRecoverReleaseRollbackAction(config, plan.planId)).toEqual(result)
  })

  it('refuses rollback planning after the applied release marker loses transition ownership', async () => {
    const { config } = await setup()
    const transition = await createStoredReleasePlan(config, new Date('2026-08-19T08:00:00.000Z'))
    await applyStoredReleasePlan(config, approval(transition), new Date('2026-08-19T08:01:00.000Z'))
    await rm(join(config.stateDir, 'releases', 'web.json'))
    await expect(createStoredReleaseRollbackPlan(config, transition.planId, new Date('2026-08-19T08:02:00.000Z'))).rejects.toMatchObject({
      code: 'release-ownership-conflict',
    })
  })

  it('rolls back a marker-only release adoption without swapping the live profile', async () => {
    const { config, profileDir } = await setup()
    const initial = await createStoredReleasePlan(config, new Date('2026-08-19T08:00:00.000Z'))
    await applyStoredReleasePlan(config, approval(initial), new Date('2026-08-19T08:01:00.000Z'))
    await rm(join(config.stateDir, 'releases', 'web.json'))
    const beforeProfile = await readFile(join(profileDir, 'package.json'), 'utf8')
    const adoption = await createStoredReleasePlan(config, new Date('2026-08-19T08:02:00.000Z'))
    expect(adoption).toMatchObject({ restartRequired: false, fromReleaseDigest: null })
    await applyStoredReleasePlan(config, approval(adoption), new Date('2026-08-19T08:03:00.000Z'))

    const rollback = await createStoredReleaseRollbackPlan(config, adoption.planId, new Date('2026-08-19T08:04:00.000Z'))
    expect(rollback).toMatchObject({
      fromManifestDigest: rollback.toManifestDigest,
      toReleaseDigest: null,
      fromProfileHash: rollback.toProfileHash,
    })
    await expect(applyStoredReleaseRollbackPlan(config, rollbackApproval(rollback), new Date('2026-08-19T08:05:00.000Z'))).resolves.toMatchObject({
      state: 'succeeded',
      result: 'success',
    })
    expect(await readAppliedRelease(config)).toBeNull()
    expect(await readFile(join(profileDir, 'package.json'), 'utf8')).toBe(beforeProfile)
  })

  it('atomically swaps a new runtime manifest even when plugin coordinates are unchanged', async () => {
    const { config, desiredManifestPath, profileDir } = await setup()
    const first = await createStoredReleasePlan(config, new Date('2026-08-19T08:00:00.000Z'))
    await expect(applyStoredReleasePlan(config, approval(first), new Date('2026-08-19T08:01:00.000Z'))).resolves.toMatchObject({
      state: 'succeeded',
      result: 'success',
    })
    const nextManifest = (await readFile(desiredManifestPath, 'utf8'))
      .replace('stable-web:', 'stable-web-next:')
      .replace('version: 3.0.0', 'version: 3.0.1')
      .replace('{ web: stable-web }', '{ web: stable-web-next }')
    await writeFile(desiredManifestPath, nextManifest)
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

  it('rejects unknown top-level profile state instead of dropping it during a release', async () => {
    const { config, profileDir } = await setup()
    await writeFile(join(profileDir, 'operator-notes.txt'), 'must survive\n')
    await expect(createStoredReleasePlan(config, new Date('2026-08-19T08:00:00.000Z'))).rejects.toMatchObject({
      code: 'profile-layout-unsupported',
    })
    expect(await readFile(join(profileDir, 'operator-notes.txt'), 'utf8')).toBe('must survive\n')
  })

  it('rechecks the DSH version after staging and requires intervention without swapping the profile', async () => {
    const { config, profileDir, changeDshVersionOnStageMarker } = await setup()
    const beforeProfile = await readFile(join(profileDir, 'package.json'), 'utf8')
    const beforeManifest = await readFile(join(profileDir, 'fleet.lock.yaml'), 'utf8')
    const plan = await createStoredReleasePlan(config, new Date('2026-08-19T08:00:00.000Z'))
    await writeFile(changeDshVersionOnStageMarker, 'armed\n')
    await expect(applyStoredReleasePlan(config, approval(plan), new Date('2026-08-19T08:01:00.000Z'))).resolves.toMatchObject({
      state: 'manual-intervention',
      result: 'manual-intervention',
      errorCode: 'runtime-identity-mismatch',
    })
    expect(await readFile(join(profileDir, 'package.json'), 'utf8')).toBe(beforeProfile)
    expect(await readFile(join(profileDir, 'fleet.lock.yaml'), 'utf8')).toBe(beforeManifest)
    expect(await readAppliedRelease(config)).toBeNull()
    expect((await readdir(join(config.dshHome, 'profiles'))).sort()).toEqual(['web'])
  })

  it('doctors release, health, identity, trust, executable and workspace readiness without mutation', async () => {
    const { config } = await setup()
    await expect(doctorAgent(config, new Date('2026-08-19T08:00:00.000Z'))).resolves.toMatchObject({
      ready: true,
      deviceId: 'worker',
      profile: 'web',
      releaseId: 'stable-web',
      healthVerified: true,
      teamId: 'test-team',
      principalId: 'owner',
      identityKeyId: expect.stringMatching(/^ed25519:[0-9a-f]{64}$/),
      trustedPeerCount: 0,
      trustedPeers: [],
      tasksEnabled: false,
      workspaceIds: ['repo'],
      taskProfiles: ['web'],
      retention: {
        retainedCount: 0,
        eligibleCount: 0,
        orphanCount: 0,
      },
      executableChecks: expect.arrayContaining(['dsh', 'pnpm', 'tar', 'screen', 'lsof', 'ps']),
    })
  })

  it('rejects a runtime still bound to an external manifest path', async () => {
    const { config } = await setup('sha512-YWJjZA==', 'sha512-YWJjZA==', 'current', false, 'external')
    await expect(doctorAgent(config, new Date('2026-08-19T08:00:00.000Z'))).rejects.toMatchObject({
      code: 'fleet-runtime-manifest-path-mismatch',
    })
  })

  it('rejects a legacy screen preflight that cannot bind the running process identity', async () => {
    const { config } = await setup('sha512-YWJjZA==', 'sha512-YWJjZA==', 'legacy-before-install')
    await expect(doctorAgent(config, new Date('2026-08-19T08:00:00.000Z'))).rejects.toMatchObject({
      code: 'runtime-identity-unavailable',
    })
  })

  it('bridges a legacy launchd Host through its exact service definition, then requires RPC identity', async () => {
    const { launchdConfig } = await setup('sha512-YWJjZA==', 'sha512-YWJjZA==', 'legacy-before-install')
    await expect(doctorAgent(launchdConfig, new Date('2026-08-19T08:00:00.000Z'))).resolves.toMatchObject({ ready: true })
    const plan = await createStoredReleasePlan(launchdConfig, new Date('2026-08-19T08:00:00.000Z'))
    await expect(applyStoredReleasePlan(
      launchdConfig,
      approval(plan),
      new Date('2026-08-19T08:01:00.000Z'),
    )).resolves.toMatchObject({ state: 'succeeded', result: 'success' })
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
    const lockOnly = commands.findIndex(command => command === 'pnpm install --lockfile-only --ignore-scripts')
    expect(lockOnly).toBeGreaterThanOrEqual(0)
    for (const pluginId of ['private-plugin', 'public-plugin']) {
      const added = commands.findIndex(command => command.includes(' add ') && command.includes(pluginId === 'private-plugin' ? '.tgz' : pluginId + '@'))
      expect(commands.some(command => command.includes(' remove ' + pluginId))).toBe(false)
      expect(added).toBeGreaterThan(lockOnly)
    }
    expect(existsSync(join(legacyPublic, 'node_modules', 'keep'))).toBe(true)
    expect(existsSync(join(legacyPrivate, 'node_modules', 'keep'))).toBe(true)
    expect(JSON.parse(await readFile(join(profileDir, 'node_modules/private-plugin/package.json'), 'utf8'))).toMatchObject({ version: '2.0.0' })
    expect(JSON.parse(await readFile(join(profileDir, 'node_modules/public-plugin/package.json'), 'utf8'))).toMatchObject({ version: '1.2.3' })
  })
})

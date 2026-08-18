import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import type { FleetAgentConfig } from '../src/agent/config.ts'
import { applyStoredPlan, createStoredPlan, inspectAgent, readOrRecoverAction } from '../src/agent/runtime.ts'
import { validateFleetPlanApproval, type FleetPlan, type FleetPlanApproval } from '../src/agent/protocol.ts'

const roots: string[] = []
const servers: ReturnType<typeof createServer>[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.close(error => error === undefined ? resolve() : reject(error))
  })))
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function setup(): Promise<{
  root: string
  config: FleetAgentConfig
  profileDir: string
  failMarker: string
  slowMarker: string
  outputLimitMarker: string
  descendantLeakMarker: string
  hangMarker: string
  timeoutVersionMarker: string
  descendantPidPath: string
  changeDuringVersionMarker: string
  runtimeFailureMarker: string
  auditFailureMarker: string
}> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-fleet-agent-runtime-'))
  roots.push(root)
  const binDir = join(root, 'bin')
  const dshHome = join(root, 'dsh-home')
  const profileDir = join(dshHome, 'profiles', 'web')
  const stateDir = join(root, 'state')
  const manifestPath = join(root, 'fleet.lock.yaml')
  const dshBinary = join(binDir, 'dsh')
  const pnpmBinary = join(binDir, 'pnpm')
  const failMarker = join(root, 'fail-apply')
  const slowMarker = join(root, 'slow-apply')
  const outputLimitMarker = join(root, 'output-limit-apply')
  const descendantLeakMarker = join(root, 'descendant-leak-apply')
  const hangMarker = join(root, 'hang-apply')
  const timeoutVersionMarker = join(root, 'timeout-version')
  const descendantPidPath = join(root, 'descendant.pid')
  const changeDuringVersionMarker = join(root, 'change-during-version')
  const runtimeFailureMarker = join(root, 'runtime-failure')
  const auditFailureMarker = join(root, 'audit-failure')
  const materializedMarker = join(profileDir, 'node_modules', 'plugin-a.spec')
  await mkdir(binDir, { recursive: true })
  await mkdir(profileDir, { recursive: true })
  await writeFile(join(profileDir, 'package.json'), JSON.stringify({
    name: 'test-profile',
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: [] } },
  }, null, 2))
  await writeFile(join(profileDir, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n")
  await writeFile(manifestPath, `schemaVersion: 1
team:
  id: test
devices:
  worker:
    class: always-on-worker
    channel: stable
plugins:
  - id: plugin-a
    source: npm
    revision: 1.2.3
    profiles: [web]
    target: { devices: [worker] }
`)
  await writeFile(pnpmBinary, `#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const args = process.argv.slice(2)
if (args[0] === '--version') { process.stdout.write('11.22.0\\n'); process.exit(0) }
if (args.join(' ') !== 'install --frozen-lockfile --ignore-scripts') process.exit(8)
const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'))
const marker = ${JSON.stringify(materializedMarker)}
if (manifest.dependencies?.['plugin-a'] === undefined) fs.rmSync(marker, { force: true })
else { fs.mkdirSync(path.dirname(marker), { recursive: true }); fs.writeFileSync(marker, manifest.dependencies['plugin-a']) }
`)
  await writeFile(dshBinary, `#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const args = process.argv.slice(2)
function spawnIgnoringTerm() {
  const child = spawn(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'], { stdio: 'ignore' })
  fs.writeFileSync(${JSON.stringify(descendantPidPath)}, String(child.pid))
}
if (args[0] === '--version') {
  if (fs.existsSync(${JSON.stringify(timeoutVersionMarker)})) {
    fs.rmSync(${JSON.stringify(timeoutVersionMarker)})
    spawnIgnoringTerm()
    setInterval(() => {}, 1000)
    return
  }
  if (fs.existsSync(${JSON.stringify(changeDuringVersionMarker)})) {
    fs.rmSync(${JSON.stringify(changeDuringVersionMarker)})
    const packagePath = path.join(process.env.DSH_HOME, 'profiles', 'web', 'package.json')
    const profile = JSON.parse(fs.readFileSync(packagePath, 'utf8'))
    profile.changedDuringVersion = true
    fs.writeFileSync(packagePath, JSON.stringify(profile, null, 2) + '\\n')
  }
  process.stdout.write('0.1.0-rc.7\\n'); process.exit(0)
}
if (args.includes('--dump-config')) { process.stdout.write('[]\\n'); process.exit(0) }
if (args[0] !== 'plugin' || args[1] !== '--profile' || args[3] !== 'add') process.exit(9)
if (fs.existsSync(${JSON.stringify(slowMarker)})) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500)
const profileDir = path.join(process.env.DSH_HOME, 'profiles', args[2])
const packagePath = path.join(profileDir, 'package.json')
const manifest = JSON.parse(fs.readFileSync(packagePath, 'utf8'))
const packageArg = args[4]
const split = packageArg.lastIndexOf('@')
const id = packageArg.slice(0, split)
const spec = packageArg.slice(split + 1)
manifest.dependencies[id] = spec
if (!manifest.dsh.profile.bundles.includes(id)) manifest.dsh.profile.bundles.push(id)
fs.writeFileSync(packagePath, JSON.stringify(manifest, null, 2) + '\\n')
fs.mkdirSync(path.dirname(${JSON.stringify(materializedMarker)}), { recursive: true })
fs.writeFileSync(${JSON.stringify(materializedMarker)}, spec)
if (fs.existsSync(${JSON.stringify(outputLimitMarker)})) {
  fs.rmSync(${JSON.stringify(outputLimitMarker)})
  spawnIgnoringTerm()
  process.stdout.write('x'.repeat(1024 * 1024 + 65536))
  setInterval(() => {}, 1000)
  return
}
if (fs.existsSync(${JSON.stringify(descendantLeakMarker)})) {
  fs.rmSync(${JSON.stringify(descendantLeakMarker)})
  spawnIgnoringTerm()
  process.exit(0)
}
if (fs.existsSync(${JSON.stringify(hangMarker)})) {
  fs.rmSync(${JSON.stringify(hangMarker)})
  spawnIgnoringTerm()
  setInterval(() => {}, 1000)
  return
}
if (fs.existsSync(${JSON.stringify(auditFailureMarker)})) {
  const auditPath = ${JSON.stringify(join(stateDir, 'audit.jsonl'))}
  fs.rmSync(auditPath, { force: true })
  fs.mkdirSync(auditPath)
}
if (fs.existsSync(${JSON.stringify(failMarker)})) process.exit(7)
`)
  const screenBinary = join(binDir, 'screen')
  const lsofBinary = join(binDir, 'lsof')
  const psBinary = join(binDir, 'ps')
  await writeFile(screenBinary, `#!/usr/bin/env node
if (process.argv.includes('-X') || process.argv.includes('-dmS')) process.exit(0)
process.exit(9)
`)
  await writeFile(lsofBinary, '#!/bin/sh\nexit 1\n')
  await writeFile(psBinary, '#!/bin/sh\nexit 1\n')
  await chmod(dshBinary, 0o755)
  await chmod(pnpmBinary, 0o755)
  await Promise.all([screenBinary, lsofBinary, psBinary].map(path => chmod(path, 0o755)))
  const healthServer = createServer((request, response) => {
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
      const failureMode = existsSync(runtimeFailureMarker) ? readFileSync(runtimeFailureMarker, 'utf8').trim() : ''
      const runtimeFailed = failureMode === 'always' || (failureMode === 'after-install' && profile.dependencies?.['plugin-a'] !== undefined)
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({
        type: 'server-response',
        rpcId: body.rpcId,
        result: {
          ok: true,
          value: {
            summary: { failed: 0 },
            plugins: [{ id: 'plugin-a', state: profile.dependencies?.['plugin-a'] === undefined ? 'missing' : 'aligned' }],
            runtime: { failedModules: runtimeFailed ? ['broken-runtime-module'] : [] },
          },
        },
      }))
    })
  })
  await new Promise<void>((resolve, reject) => {
    healthServer.once('error', reject)
    healthServer.listen(0, '127.0.0.1', resolve)
  })
  servers.push(healthServer)
  const healthPort = (healthServer.address() as AddressInfo).port
  return {
    root,
    profileDir,
    failMarker,
    slowMarker,
    outputLimitMarker,
    descendantLeakMarker,
    hangMarker,
    timeoutVersionMarker,
    descendantPidPath,
    changeDuringVersionMarker,
    runtimeFailureMarker,
    auditFailureMarker,
    config: {
      schemaVersion: 1,
      deviceId: 'worker',
      manifestPath,
      dshHome,
      dshBinary,
      pnpmBinary,
      profile: 'web',
      stateDir,
      planTtlMs: 300_000,
      restart: {
        kind: 'screen',
        screenBinary,
        lsofBinary,
        psBinary,
        ownerMarkers: ['fake-dsh'],
        sessionName: 'fake-dsh',
        host: '127.0.0.1',
        port: healthPort,
      },
      health: { url: `http://127.0.0.1:${healthPort}`, timeoutMs: 3000, requireFleetRpc: true },
    },
  }
}

function approval(plan: FleetPlan): FleetPlanApproval {
  return {
    protocolVersion: 1,
    approvalId: 'approval-test',
    principalId: 'owner',
    planId: plan.planId,
    planDigest: plan.digest,
    deviceId: plan.deviceId,
    profile: plan.profile,
    approvedAt: new Date(Date.parse(plan.createdAt) + 1000).toISOString(),
    expiresAt: new Date(Date.parse(plan.createdAt) + 120_000).toISOString(),
  }
}

async function waitForFile(path: string, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await stat(path)
      return
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error('timed out waiting for ' + path)
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error: unknown) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

describe('fleet agent runtime', () => {
  it('inspects, stores, approves and applies one exact package idempotently', async () => {
    const { config, profileDir } = await setup()
    const now = new Date('2026-08-18T08:00:00.000Z')
    const inspection = await inspectAgent(config, now)
    expect(inspection).toMatchObject({
      deviceId: 'worker',
      dshVersion: '0.1.0-rc.7',
      candidates: [{ pluginId: 'plugin-a', action: 'install', exactToSpec: '1.2.3' }],
    })
    const plan = await createStoredPlan(config, 'plugin-a', now)
    const first = await applyStoredPlan(config, approval(plan), new Date('2026-08-18T08:01:30.000Z'))
    expect(first).toMatchObject({ state: 'succeeded', result: 'success', principalId: 'owner' })
    const profile = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8')) as { dependencies: Record<string, string> }
    expect(profile.dependencies['plugin-a']).toBe('1.2.3')
    const duplicate = await applyStoredPlan(config, approval(plan), new Date('2026-08-18T08:01:31.000Z'))
    expect(duplicate).toEqual(first)
  })

  it('restores the exact profile snapshot when the controlled install fails', async () => {
    const { config, profileDir, failMarker } = await setup()
    const before = await readFile(join(profileDir, 'package.json'), 'utf8')
    const plan = await createStoredPlan(config, 'plugin-a', new Date('2026-08-18T08:00:00.000Z'))
    await writeFile(failMarker, 'fail\n')
    const result = await applyStoredPlan(config, approval(plan), new Date('2026-08-18T08:01:30.000Z'))
    expect(result).toMatchObject({ state: 'rolled-back', result: 'rolled-back', errorCode: 'command-failed' })
    expect(await readFile(join(profileDir, 'package.json'), 'utf8')).toBe(before)
    await expect(readFile(join(profileDir, 'node_modules', 'plugin-a.spec'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('kills a TERM-ignoring descendant on output overflow before rollback starts', async () => {
    const { config, outputLimitMarker, descendantPidPath } = await setup()
    const plan = await createStoredPlan(config, 'plugin-a', new Date('2026-08-18T08:00:00.000Z'))
    await writeFile(outputLimitMarker, 'overflow\n')
    const result = await applyStoredPlan(config, approval(plan), new Date('2026-08-18T08:01:30.000Z'))
    expect(result).toMatchObject({ state: 'rolled-back', errorCode: 'command-output-limit' })
    const descendantPid = Number(await readFile(descendantPidPath, 'utf8'))
    expect(processAlive(descendantPid)).toBe(false)
  }, 15_000)

  it('rejects a successful leader that leaves a TERM-ignoring same-group descendant', async () => {
    const { config, descendantLeakMarker, descendantPidPath } = await setup()
    const plan = await createStoredPlan(config, 'plugin-a', new Date('2026-08-18T08:00:00.000Z'))
    await writeFile(descendantLeakMarker, 'leak\n')
    const result = await applyStoredPlan(config, approval(plan), new Date('2026-08-18T08:01:30.000Z'))
    expect(result).toMatchObject({ state: 'rolled-back', errorCode: 'command-descendant-leak' })
    const descendantPid = Number(await readFile(descendantPidPath, 'utf8'))
    expect(processAlive(descendantPid)).toBe(false)
  }, 15_000)

  it('kills the mutation group on shutdown, then completes rollback without the cancelled signal', async () => {
    const { config, profileDir, hangMarker, descendantPidPath } = await setup()
    const plan = await createStoredPlan(config, 'plugin-a', new Date('2026-08-18T08:00:00.000Z'))
    await writeFile(hangMarker, 'hang\n')
    const controller = new AbortController()
    const applying = applyStoredPlan(config, approval(plan), new Date('2026-08-18T08:01:30.000Z'), controller.signal)
    await waitForFile(descendantPidPath)
    controller.abort()
    const rolledBack = await applying
    expect(rolledBack).toMatchObject({ state: 'rolled-back', result: 'rolled-back', errorCode: 'agent-shutdown' })
    const descendantPid = Number(await readFile(descendantPidPath, 'utf8'))
    expect(processAlive(descendantPid)).toBe(false)
    const restored = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8')) as { dependencies: Record<string, string> }
    expect(restored.dependencies['plugin-a']).toBeUndefined()
    expect(await readOrRecoverAction(config, plan.planId)).toEqual(rolledBack)
  }, 15_000)

  it('kills a TERM-ignoring descendant and confirms the process group on timeout', async () => {
    const { config, timeoutVersionMarker, descendantPidPath } = await setup()
    await writeFile(timeoutVersionMarker, 'timeout\n')
    await expect(createStoredPlan(config, 'plugin-a', new Date('2026-08-18T08:00:00.000Z')))
      .rejects.toMatchObject({ code: 'command-timeout' })
    const descendantPid = Number(await readFile(descendantPidPath, 'utf8'))
    expect(processAlive(descendantPid)).toBe(false)
  }, 20_000)

  it('continues rollback when failure audit persistence breaks after mutation', async () => {
    const { config, profileDir, failMarker, auditFailureMarker } = await setup()
    const before = await readFile(join(profileDir, 'package.json'), 'utf8')
    const plan = await createStoredPlan(config, 'plugin-a', new Date('2026-08-18T08:00:00.000Z'))
    await Promise.all([
      writeFile(failMarker, 'fail\n'),
      writeFile(auditFailureMarker, 'break-audit\n'),
    ])
    const result = await applyStoredPlan(config, approval(plan), new Date('2026-08-18T08:01:30.000Z'))
    expect(result).toMatchObject({ state: 'manual-intervention', result: 'manual-intervention', errorCode: 'state-persistence-failed' })
    expect(await readFile(join(profileDir, 'package.json'), 'utf8')).toBe(before)
    await expect(readFile(join(profileDir, 'node_modules', 'plugin-a.spec'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('does not persist terminal success when its required audit append fails', async () => {
    const { config, profileDir, auditFailureMarker } = await setup()
    const plan = await createStoredPlan(config, 'plugin-a', new Date('2026-08-18T08:00:00.000Z'))
    await writeFile(auditFailureMarker, 'break-audit\n')
    const result = await applyStoredPlan(config, approval(plan), new Date('2026-08-18T08:01:30.000Z'))
    expect(result).toMatchObject({ state: 'manual-intervention', result: 'manual-intervention', errorCode: 'state-persistence-failed' })
    const profile = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8')) as { dependencies: Record<string, string> }
    expect(profile.dependencies['plugin-a']).toBeUndefined()
  })

  it('invalidates approval when the profile changes after planning', async () => {
    const { config, profileDir } = await setup()
    const plan = await createStoredPlan(config, 'plugin-a', new Date('2026-08-18T08:00:00.000Z'))
    const profilePath = join(profileDir, 'package.json')
    const profile = JSON.parse(await readFile(profilePath, 'utf8')) as Record<string, unknown>
    await writeFile(profilePath, JSON.stringify({ ...profile, changed: true }, null, 2))
    await expect(applyStoredPlan(config, approval(plan), new Date('2026-08-18T08:01:30.000Z')))
      .rejects.toMatchObject({ code: 'approval-mismatch' })
  })

  it('keeps inspection available but fails closed when mutation safety is not configured', async () => {
    const { config, profileDir } = await setup()
    config.restart = { kind: 'none' }
    config.health = { timeoutMs: 3000, requireFleetRpc: false }
    const now = new Date('2026-08-18T08:00:00.000Z')
    expect((await inspectAgent(config, now)).candidates).toHaveLength(1)
    const plan = await createStoredPlan(config, 'plugin-a', now)
    await expect(applyStoredPlan(config, approval(plan), new Date('2026-08-18T08:01:30.000Z')))
      .rejects.toMatchObject({ code: 'unsafe-mutation-config' })
    const profile = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8')) as { dependencies: Record<string, string> }
    expect(profile.dependencies['plugin-a']).toBeUndefined()
  })

  it('preflights global Loader failures before snapshot or action mutation', async () => {
    const { config, runtimeFailureMarker } = await setup()
    const plan = await createStoredPlan(config, 'plugin-a', new Date('2026-08-18T08:00:00.000Z'))
    await writeFile(runtimeFailureMarker, 'always\n')
    await expect(applyStoredPlan(config, approval(plan), new Date('2026-08-18T08:01:30.000Z')))
      .rejects.toMatchObject({ code: 'runtime-modules-failed' })
    await expect(readFile(join(config.stateDir, 'actions', plan.digest + '.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(join(config.stateDir, 'snapshots', plan.digest))).rejects.toMatchObject({ code: 'ENOENT' })
  }, 10_000)

  it('uses one profile snapshot for state and snapshot persistence, then rejects a live change before mutation', async () => {
    const { config, profileDir, changeDuringVersionMarker } = await setup()
    const original = await readFile(join(profileDir, 'package.json'), 'utf8')
    const plan = await createStoredPlan(config, 'plugin-a', new Date('2026-08-18T08:00:00.000Z'))
    await writeFile(changeDuringVersionMarker, 'change\n')
    await expect(applyStoredPlan(config, approval(plan), new Date('2026-08-18T08:01:30.000Z')))
      .rejects.toMatchObject({ code: 'approval-mismatch' })
    expect(await readFile(join(config.stateDir, 'snapshots', plan.digest, 'package.json'), 'utf8')).toBe(original)
    await expect(readFile(join(config.stateDir, 'actions', plan.digest + '.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(profileDir, 'package.json'), 'utf8')).not.toBe(original)
  })

  it('rolls back when the post-apply Fleet RPC reports any failed runtime module', async () => {
    const { config, profileDir, runtimeFailureMarker } = await setup()
    const before = await readFile(join(profileDir, 'package.json'), 'utf8')
    const plan = await createStoredPlan(config, 'plugin-a', new Date('2026-08-18T08:00:00.000Z'))
    await writeFile(runtimeFailureMarker, 'after-install\n')
    const result = await applyStoredPlan(config, approval(plan), new Date('2026-08-18T08:01:30.000Z'))
    expect(result).toMatchObject({ state: 'rolled-back', result: 'rolled-back', errorCode: 'runtime-modules-failed' })
    expect(await readFile(join(profileDir, 'package.json'), 'utf8')).toBe(before)
  }, 15_000)

  it('serializes concurrent apply attempts for the same profile', async () => {
    const { config, slowMarker } = await setup()
    const plan = await createStoredPlan(config, 'plugin-a', new Date('2026-08-18T08:00:00.000Z'))
    await writeFile(slowMarker, 'slow\n')
    const results = await Promise.allSettled([
      applyStoredPlan(config, approval(plan), new Date('2026-08-18T08:01:30.000Z')),
      applyStoredPlan(config, approval(plan), new Date('2026-08-18T08:01:30.000Z')),
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find(result => result.status === 'rejected')
    expect(rejected).toMatchObject({ status: 'rejected', reason: { code: 'agent-busy' } })
  })

  it('lets only one concurrent contender reclaim a stale lock inode', async () => {
    const { config, slowMarker } = await setup()
    const plan = await createStoredPlan(config, 'plugin-a', new Date('2026-08-18T08:00:00.000Z'))
    const lockDir = join(config.stateDir, 'locks')
    await mkdir(lockDir, { recursive: true })
    const identity = createHash('sha256').update(config.dshHome + '\0' + config.profile).digest('hex')
    const lockPath = join(lockDir, identity + '.lock')
    await writeFile(lockPath, JSON.stringify({ token: 'old-token', pid: 999999, createdAt: '2026-08-18T07:00:00.000Z' }) + '\n')
    const old = new Date(Date.now() - 20_000)
    await utimes(lockPath, old, old)
    await writeFile(slowMarker, 'slow\n')
    const results = await Promise.allSettled([
      applyStoredPlan(config, approval(plan), new Date('2026-08-18T08:01:30.000Z')),
      applyStoredPlan(config, approval(plan), new Date('2026-08-18T08:01:30.000Z')),
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.find(result => result.status === 'rejected'))
      .toMatchObject({ status: 'rejected', reason: { code: 'agent-busy' } })
    expect((await readdir(lockDir)).filter(name => name.includes('.reap-'))).toEqual([])
  })

  it('rolls back an interrupted nonterminal action even after its approval expires', async () => {
    const { config, profileDir } = await setup()
    const plan = await createStoredPlan(config, 'plugin-a', new Date('2026-08-18T08:00:00.000Z'))
    const originalApproval = approval(plan)
    const validation = validateFleetPlanApproval(plan, originalApproval, new Date('2026-08-18T08:01:30.000Z'))
    const snapshotDir = join(config.stateDir, 'snapshots', plan.digest)
    await mkdir(snapshotDir, { recursive: true })
    for (const name of ['package.json', 'pnpm-lock.yaml'] as const) {
      await copyFile(join(profileDir, name), join(snapshotDir, name))
    }
    await writeFile(join(snapshotDir, 'snapshot.json'), JSON.stringify({
      planId: plan.planId,
      digest: plan.digest,
      manifestDigest: plan.manifestDigest,
      profileHash: plan.profileHash,
      profileDirectoryPresent: true,
      present: {
        'package.json': true,
        'pnpm-lock.yaml': true,
        'pnpm-workspace.yaml': false,
        'cordis.patch.yml': false,
      },
    }, null, 2))
    const actionDir = join(config.stateDir, 'actions')
    await mkdir(actionDir, { recursive: true })
    await writeFile(join(actionDir, plan.digest + '.json'), JSON.stringify({
      planId: plan.planId,
      planDigest: plan.digest,
      approvalId: originalApproval.approvalId,
      principalId: originalApproval.principalId,
      idempotencyKey: validation.idempotencyKey,
      deviceId: plan.deviceId,
      profile: plan.profile,
      pluginId: plan.pluginId,
      action: plan.action,
      state: 'applying',
      updatedAt: '2026-08-18T08:01:00.000Z',
    }, null, 2))
    const recovered = await applyStoredPlan(config, originalApproval, new Date('2026-08-18T08:10:00.000Z'))
    expect(recovered).toMatchObject({ state: 'rolled-back', result: 'rolled-back', errorCode: 'interrupted-action' })
  })

  it('verifies all snapshot bytes before touching the live profile during recovery', async () => {
    const { config, profileDir } = await setup()
    const plan = await createStoredPlan(config, 'plugin-a', new Date('2026-08-18T08:00:00.000Z'))
    const originalApproval = approval(plan)
    const validation = validateFleetPlanApproval(plan, originalApproval, new Date('2026-08-18T08:01:30.000Z'))
    const snapshotDir = join(config.stateDir, 'snapshots', plan.digest)
    await mkdir(snapshotDir, { recursive: true })
    for (const name of ['package.json', 'pnpm-lock.yaml'] as const) {
      await copyFile(join(profileDir, name), join(snapshotDir, name))
    }
    await writeFile(join(snapshotDir, 'snapshot.json'), JSON.stringify({
      planId: plan.planId,
      digest: plan.digest,
      manifestDigest: plan.manifestDigest,
      profileHash: plan.profileHash,
      profileDirectoryPresent: true,
      present: {
        'package.json': true,
        'pnpm-lock.yaml': true,
        'pnpm-workspace.yaml': false,
        'cordis.patch.yml': false,
      },
    }, null, 2))
    const tampered = JSON.parse(await readFile(join(snapshotDir, 'package.json'), 'utf8')) as { dependencies: Record<string, string> }
    tampered.dependencies['plugin-a'] = '9.9.9'
    await writeFile(join(snapshotDir, 'package.json'), JSON.stringify(tampered, null, 2) + '\n')
    const livePath = join(profileDir, 'package.json')
    const live = JSON.parse(await readFile(livePath, 'utf8')) as Record<string, unknown>
    const liveBeforeRecovery = JSON.stringify({ ...live, localSentinel: true }, null, 2) + '\n'
    await writeFile(livePath, liveBeforeRecovery)
    const actionDir = join(config.stateDir, 'actions')
    await mkdir(actionDir, { recursive: true })
    await writeFile(join(actionDir, plan.digest + '.json'), JSON.stringify({
      planId: plan.planId,
      planDigest: plan.digest,
      approvalId: originalApproval.approvalId,
      principalId: originalApproval.principalId,
      idempotencyKey: validation.idempotencyKey,
      deviceId: plan.deviceId,
      profile: plan.profile,
      pluginId: plan.pluginId,
      action: plan.action,
      state: 'applying',
      updatedAt: '2026-08-18T08:01:00.000Z',
    }, null, 2))
    const result = await applyStoredPlan(config, originalApproval, new Date('2026-08-18T08:01:30.000Z'))
    expect(result).toMatchObject({ state: 'manual-intervention', errorCode: 'rollback-failed' })
    expect(await readFile(livePath, 'utf8')).toBe(liveBeforeRecovery)
  })

  it('waits for the Fleet RPC target to become active after HTTP starts', async () => {
    const { config } = await setup()
    let checks = 0
    const server = createServer((request, response) => {
      if (request.method !== 'POST') {
        response.writeHead(200).end('ready\n')
        return
      }
      const chunks: Buffer[] = []
      request.on('data', chunk => chunks.push(Buffer.from(chunk)))
      request.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { rpcId: string }
        checks += 1
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({
          type: 'server-response',
          rpcId: body.rpcId,
          result: {
            ok: true,
            value: {
              summary: { failed: 0 },
              plugins: [{ id: 'plugin-a', state: checks >= 2 ? 'aligned' : 'runtime-inactive' }],
              runtime: { failedModules: [] },
            },
          },
        }))
      })
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    try {
      const port = (server.address() as AddressInfo).port
      config.health = { url: `http://127.0.0.1:${port}`, timeoutMs: 3000, requireFleetRpc: true }
      if (config.restart.kind !== 'screen') throw new Error('test requires screen restart')
      config.restart.port = port
      const plan = await createStoredPlan(config, 'plugin-a', new Date('2026-08-18T08:00:00.000Z'))
      const result = await applyStoredPlan(config, approval(plan), new Date('2026-08-18T08:01:30.000Z'))
      expect(result).toMatchObject({ state: 'succeeded', result: 'success' })
      expect(checks).toBeGreaterThanOrEqual(2)
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error === undefined ? resolve() : reject(error)))
    }
  })

  it('does not wait on stdio inherited by a detached screen child', async () => {
    const { config, root } = await setup()
    const screenBinary = join(root, 'bin', 'screen')
    const lsofBinary = join(root, 'bin', 'lsof')
    const psBinary = join(root, 'bin', 'ps')
    await writeFile(screenBinary, `#!/usr/bin/env node
const { spawn } = require('node:child_process')
if (process.argv.includes('-X')) process.exit(0)
if (!process.argv.includes('-dmS')) process.exit(9)
const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 2000)'], { detached: true, stdio: 'inherit' })
child.unref()
`)
    await writeFile(lsofBinary, '#!/bin/sh\nexit 1\n')
    await writeFile(psBinary, '#!/bin/sh\nexit 1\n')
    await Promise.all([screenBinary, lsofBinary, psBinary].map(path => chmod(path, 0o755)))
    config.restart = {
      kind: 'screen',
      screenBinary,
      lsofBinary,
      psBinary,
      ownerMarkers: ['fake-dsh'],
      sessionName: 'fake-dsh',
      host: '127.0.0.1',
      port: Number(new URL(config.health.url as string).port),
    }
    const plan = await createStoredPlan(config, 'plugin-a', new Date('2026-08-18T08:00:00.000Z'))
    const result = await applyStoredPlan(config, approval(plan), new Date('2026-08-18T08:01:30.000Z'))
    expect(result).toMatchObject({ state: 'succeeded', result: 'success' })
  })
})

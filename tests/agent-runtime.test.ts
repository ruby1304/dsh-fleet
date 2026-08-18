import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import type { FleetAgentConfig } from '../src/agent/config.ts'
import { applyStoredPlan, createStoredPlan, inspectAgent } from '../src/agent/runtime.ts'
import { validateFleetPlanApproval, type FleetPlan, type FleetPlanApproval } from '../src/agent/protocol.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function setup(): Promise<{ root: string; config: FleetAgentConfig; profileDir: string; failMarker: string; slowMarker: string }> {
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
  m3-worker:
    class: always-on-worker
    channel: stable
plugins:
  - id: plugin-a
    source: npm
    revision: 1.2.3
    profiles: [web]
    target: { devices: [m3-worker] }
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
const args = process.argv.slice(2)
if (args[0] === '--version') { process.stdout.write('0.1.0-rc.7\\n'); process.exit(0) }
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
if (fs.existsSync(${JSON.stringify(failMarker)})) process.exit(7)
`)
  await chmod(dshBinary, 0o755)
  await chmod(pnpmBinary, 0o755)
  return {
    root,
    profileDir,
    failMarker,
    slowMarker,
    config: {
      schemaVersion: 1,
      deviceId: 'm3-worker',
      manifestPath,
      dshHome,
      dshBinary,
      pnpmBinary,
      profile: 'web',
      stateDir,
      planTtlMs: 300_000,
      restart: { kind: 'none' },
      health: { timeoutMs: 3000, requireFleetRpc: false },
    },
  }
}

function approval(plan: FleetPlan): FleetPlanApproval {
  return {
    protocolVersion: 1,
    approvalId: 'approval-test',
    principalId: 'ruby',
    planId: plan.planId,
    planDigest: plan.digest,
    deviceId: plan.deviceId,
    profile: plan.profile,
    approvedAt: new Date(Date.parse(plan.createdAt) + 1000).toISOString(),
    expiresAt: new Date(Date.parse(plan.createdAt) + 120_000).toISOString(),
  }
}

describe('fleet agent runtime', () => {
  it('inspects, stores, approves and applies one exact package idempotently', async () => {
    const { config, profileDir } = await setup()
    const now = new Date('2026-08-18T08:00:00.000Z')
    const inspection = await inspectAgent(config, now)
    expect(inspection).toMatchObject({
      deviceId: 'm3-worker',
      dshVersion: '0.1.0-rc.7',
      candidates: [{ pluginId: 'plugin-a', action: 'install', exactToSpec: '1.2.3' }],
    })
    const plan = await createStoredPlan(config, 'plugin-a', now)
    const first = await applyStoredPlan(config, approval(plan), new Date('2026-08-18T08:01:30.000Z'))
    expect(first).toMatchObject({ state: 'succeeded', result: 'success', principalId: 'ruby' })
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

  it('invalidates approval when the profile changes after planning', async () => {
    const { config, profileDir } = await setup()
    const plan = await createStoredPlan(config, 'plugin-a', new Date('2026-08-18T08:00:00.000Z'))
    const profilePath = join(profileDir, 'package.json')
    const profile = JSON.parse(await readFile(profilePath, 'utf8')) as Record<string, unknown>
    await writeFile(profilePath, JSON.stringify({ ...profile, changed: true }, null, 2))
    await expect(applyStoredPlan(config, approval(plan), new Date('2026-08-18T08:01:30.000Z')))
      .rejects.toMatchObject({ code: 'approval-mismatch' })
  })

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
if (process.argv.includes('-DmS')) {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 2000)'], { detached: true, stdio: 'inherit' })
  child.unref()
}
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
      port: 3211,
    }
    const plan = await createStoredPlan(config, 'plugin-a', new Date('2026-08-18T08:00:00.000Z'))
    const result = await applyStoredPlan(config, approval(plan), new Date('2026-08-18T08:01:30.000Z'))
    expect(result).toMatchObject({ state: 'succeeded', result: 'success' })
  })
})

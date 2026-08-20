import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { chmod, mkdtemp, mkdir, open, readFile, readlink, rename, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { stringify } from 'yaml'
import { describe, expect, it } from 'vitest'
import {
  activateBootstrapGeneration,
  assembleBootstrapGeneration,
  createBootstrapIdentity,
  inspectBootstrapGeneration,
  planBootstrapSet,
  renderBootstrapBundle,
  renderBootstrapSet,
  rollbackBootstrapGeneration,
} from '../src/bootstrap/runtime.ts'
import { parseAgentConfig } from '../src/agent/config.ts'
import { sha256Canonical } from '../src/agent/protocol.ts'
import { parseFleetManifest } from '../src/host/core.ts'

const GENERATION_LIFECYCLE_LOCK_NAME = '.generation-lifecycle.lock'

function definitelyDeadPid(): number {
  const pid = 0x7fffffff
  try {
    process.kill(pid, 0)
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return pid
  }
  throw new TypeError('test fixture could not find a definitely dead pid')
}

async function writeLifecycleLock(
  rootDirectory: string,
  pid: number,
  token = 'lock:' + randomUUID(),
): Promise<{ lockPath: string; token: string }> {
  const lockPath = join(rootDirectory, GENERATION_LIFECYCLE_LOCK_NAME)
  const body = {
    schemaVersion: 1 as const,
    pid,
    token,
    createdAt: '2026-08-19T12:00:00.000Z',
    rootDigest: createHash('sha256').update(rootDirectory).digest('hex'),
  }
  await mkdir(lockPath, { mode: 0o700 })
  await chmod(lockPath, 0o700)
  await writeFile(join(lockPath, 'owner.json'), JSON.stringify({
    ...body,
    lockDigest: sha256Canonical(body),
  }, null, 2) + '\n', { mode: 0o600 })
  await chmod(join(lockPath, 'owner.json'), 0o600)
  return { lockPath, token }
}

function probeAgent(marker: string): string {
  return `#!/usr/bin/env node
import { writeFile, readFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
const configPath = process.argv[3]
const config = JSON.parse(await readFile(configPath, 'utf8'))
const worker = await readFile(join(dirname(process.argv[1]), 'worker.mjs'), 'utf8')
if (process.env.DSH_FLEET_PROBE_STARTED) await writeFile(process.env.DSH_FLEET_PROBE_STARTED, 'started')
await new Promise(resolve => setTimeout(resolve, 75))
process.stdout.write(JSON.stringify({
  agentMarker: ${JSON.stringify(marker)},
  configGeneration: basename(dirname(configPath)),
  desiredGeneration: basename(dirname(config.desiredManifestPath)),
  workerMarker: /marker = "([^"]+)"/.exec(worker)?.[1],
}) + '\\n')
`
}

function invokeGenerationLauncher(
  launcherPath: string,
  configPath: string,
  extraArgs: string[] = [],
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [launcherPath, '--config', configPath, 'inspect', ...extraArgs], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.once('error', reject)
    child.once('close', code => resolve({ code, stdout, stderr }))
    child.stdin.end('{}\n')
  })
}

async function waitForPath(path: string): Promise<void> {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    try {
      await stat(path)
      return
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new TypeError('timed out waiting for probe path')
}

async function readRegularFileWithMode(path: string, expectedMode: number): Promise<string> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const info = await handle.stat()
    expect(info.isFile()).toBe(true)
    expect(info.mode & 0o777).toBe(expectedMode)
    return await handle.readFile('utf8')
  } finally {
    await handle.close()
  }
}

function packValue() {
  return {
    schemaVersion: 1,
    pack: { id: 'engineering', version: '1.0.0' },
    profile: { id: 'headless', dshRange: '0.1.0-rc.8' },
    publicPlugins: [{ id: 'dsh-public-tool', source: { kind: 'npm', version: '1.0.0', integrity: 'sha512-QUJDRA==' } }],
    taskPolicy: { profiles: ['headless'], workspaceIds: ['fleet-repo'] },
    trustAnchors: [],
  }
}

function overlayValue(
  root: string,
  deviceId = 'worker',
  releaseId = 'headless-r1',
  digest = 'a'.repeat(64),
  policyIds?: string[],
) {
  const generationRoot = join(root, `fleet-${deviceId}`)
  return {
    schemaVersion: 1,
    team: { id: 'example-team' },
    device: { id: deviceId, assignedTo: 'owner', class: 'always-on-worker', channel: 'stable' },
    route: {
      transport: 'local',
      nodeBinary: '/opt/homebrew/bin/node',
      agentPath: join(generationRoot, 'current', 'agent.mjs'),
      configPath: join(generationRoot, 'current', 'agent.config.json'),
    },
    release: { id: releaseId, version: '1.0.0' },
    privatePlugins: [{ id: 'dsh-private-tool', version: '2.0.0', digest }],
    workspacePaths: { 'fleet-repo': join(root, `workspace-${deviceId}`) },
    trustedPeers: [],
    agent: {
      dshHome: join(root, `dsh-home-${deviceId}`),
      dshBinary: join(root, 'runtime/bin/dsh'),
      pnpmBinary: join(root, 'runtime/bin/pnpm'),
      stateDir: join(root, `state-${deviceId}`),
      artifactStore: join(root, 'artifacts'),
      tarBinary: '/usr/bin/tar',
      planTtlMs: 300000,
      restart: {
        kind: 'launchd', launchctlBinary: '/bin/launchctl', lsofBinary: '/usr/sbin/lsof', psBinary: '/bin/ps',
        ownerMarkers: ['@deepseek-ai/dsh/lib/bin.js'], serviceTarget: 'gui/502/com.example.dsh',
        host: '127.0.0.1', port: 3211, managedPorts: [3211],
      },
      health: { url: 'http://127.0.0.1:3211', timeoutMs: 45000, requireFleetRpc: true },
      maxMessageTtlMs: 900000,
      tasks: {
        enabled: true,
        timeoutMs: 3600000,
        maxOutputBytes: 1048576,
        maxConcurrent: 1,
        ...(policyIds === undefined ? {} : { policyIds }),
      },
    },
  }
}

async function writePrivateOverlay(path: string, value: ReturnType<typeof overlayValue>): Promise<void> {
  await writeFile(path, stringify(value), { mode: 0o600 })
  await chmod(path, 0o600)
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-fleet-bootstrap-'))
  const identityDirectory = join(root, 'identity')
  const outputDirectory = join(root, 'release-1')
  const packPath = join(root, 'team-pack.yaml')
  const overlayPath = join(root, 'device-overlay.yaml')
  const agentBundlePath = join(root, 'built-agent.mjs')
  const workerBundlePath = join(root, 'built-worker.mjs')
  const bootstrapBundlePath = join(root, 'built-bootstrap.mjs')
  await mkdir(identityDirectory, { mode: 0o700 })
  await writeFile(packPath, stringify(packValue()))
  await writePrivateOverlay(overlayPath, overlayValue(root))
  await writeFile(agentBundlePath, '#!/usr/bin/env node\nexport const bundle = "agent"\n', { mode: 0o700 })
  await writeFile(workerBundlePath, 'export const bundle = "worker"\n', { mode: 0o600 })
  await writeFile(bootstrapBundlePath, '#!/usr/bin/env node\nexport const bundle = "bootstrap"\n', { mode: 0o700 })
  return {
    root, identityDirectory, outputDirectory, packPath, overlayPath,
    agentBundlePath, workerBundlePath, bootstrapBundlePath,
  }
}

describe('team bootstrap runtime', () => {
  it('creates an owner-only Ed25519 identity and a validated immutable device bundle', async () => {
    const paths = await fixture()
    const identity = await createBootstrapIdentity({
      outputDirectory: paths.identityDirectory,
      teamId: 'example-team', principalId: 'owner', deviceId: 'worker',
    })
    expect((await stat(identity.privateKeyPath)).mode & 0o777).toBe(0o600)
    expect((await stat(identity.invitePath)).mode & 0o777).toBe(0o600)

    const rendered = await renderBootstrapBundle(paths)
    expect(rendered.manifestDigest).toMatch(/^[0-9a-f]{64}$/)
    expect(parseFleetManifest(await readFile(rendered.manifestPath, 'utf8')).schemaVersion).toBe(2)
    const agent = parseAgentConfig(JSON.parse(await readFile(rendered.agentConfigPath, 'utf8')) as unknown)
    expect(agent.a2a).toEqual(expect.objectContaining({ teamId: 'example-team', principalId: 'owner', privateKeyPath: identity.privateKeyPath }))
    expect(agent.tasks?.workspaces).toEqual({ 'fleet-repo': join(paths.root, 'workspace-worker') })
    expect((await stat(rendered.agentConfigPath)).mode & 0o777).toBe(0o600)
  })

  it('renders a second worker with both installed task policies but no serialized tool rules', async () => {
    const paths = await fixture()
    await writePrivateOverlay(paths.overlayPath, overlayValue(
      paths.root,
      'worker-two',
      'headless-worker-r1',
      'b'.repeat(64),
      ['readonly-v1', 'workspace-write-ask-v1'],
    ))
    await createBootstrapIdentity({
      outputDirectory: paths.identityDirectory,
      teamId: 'example-team', principalId: 'owner', deviceId: 'worker-two',
    })

    const rendered = await renderBootstrapBundle(paths)
    const serializedAgent = JSON.parse(await readFile(rendered.agentConfigPath, 'utf8')) as {
      tasks: Record<string, unknown>
    }
    expect(serializedAgent.tasks.policyIds).toEqual(['readonly-v1', 'workspace-write-ask-v1'])
    expect(serializedAgent.tasks).not.toHaveProperty('policies')
    expect(parseAgentConfig(serializedAgent).tasks?.policyIds).toEqual([
      'readonly-v1',
      'workspace-write-ask-v1',
    ])
    expect(JSON.parse(await readFile(rendered.taskPolicyPath, 'utf8'))).toEqual({
      profiles: ['headless'],
      workspaces: { 'fleet-repo': join(paths.root, 'workspace-worker-two') },
    })
  })

  it('refuses identity reuse, output overwrites and an identity for another device', async () => {
    const paths = await fixture()
    await createBootstrapIdentity({ outputDirectory: paths.identityDirectory, teamId: 'example-team', principalId: 'owner', deviceId: 'worker' })
    await expect(createBootstrapIdentity({
      outputDirectory: paths.identityDirectory, teamId: 'example-team', principalId: 'owner', deviceId: 'worker',
    })).rejects.toThrow(/refuses to overwrite/)
    await renderBootstrapBundle(paths)
    await expect(renderBootstrapBundle(paths)).rejects.toThrow(/refuses to overwrite/)

    const other = await fixture()
    await createBootstrapIdentity({ outputDirectory: other.identityDirectory, teamId: 'example-team', principalId: 'owner', deviceId: 'other-worker' })
    await expect(renderBootstrapBundle(other)).rejects.toThrow(/does not match the overlay/)
  })

  it('refuses a private overlay that is readable by another user', async () => {
    const paths = await fixture()
    await createBootstrapIdentity({
      outputDirectory: paths.identityDirectory,
      teamId: 'example-team', principalId: 'owner', deviceId: 'worker',
    })
    await chmod(paths.overlayPath, 0o644)
    await expect(renderBootstrapBundle(paths)).rejects.toThrow(/bootstrap overlay must be owner-only/)
    await expect(planBootstrapSet({ packPath: paths.packPath, overlayPaths: [paths.overlayPath] }))
      .rejects.toThrow(/bootstrap overlay must be owner-only/)
  })

  it('plans and renders the same canonical manifest for three device generations', async () => {
    const paths = await fixture()
    const identityRoot = join(paths.root, 'identities')
    const outputA = join(paths.root, 'generation-a')
    const outputB = join(paths.root, 'generation-b')
    const outputC = join(paths.root, 'generation-c')
    await mkdir(identityRoot, { mode: 0o700 })
    const overlayPaths = [
      paths.overlayPath,
      join(paths.root, 'controller-overlay.yaml'),
      join(paths.root, 'worker-c-overlay.yaml'),
    ]
    await writePrivateOverlay(overlayPaths[1]!, overlayValue(paths.root, 'controller', 'headless-r2', 'b'.repeat(64)))
    await writePrivateOverlay(overlayPaths[2]!, overlayValue(paths.root, 'worker-c', 'headless-r3', 'c'.repeat(64)))
    for (const deviceId of ['worker', 'controller', 'worker-c']) {
      await createBootstrapIdentity({
        outputDirectory: join(identityRoot, deviceId),
        teamId: 'example-team',
        principalId: 'owner',
        deviceId,
      })
    }

    const forwardPlan = await planBootstrapSet({ packPath: paths.packPath, overlayPaths })
    const reversePlan = await planBootstrapSet({ packPath: paths.packPath, overlayPaths: [...overlayPaths].reverse() })
    expect(reversePlan.manifestYaml).toBe(forwardPlan.manifestYaml)
    expect(reversePlan.manifestDigest).toBe(forwardPlan.manifestDigest)
    expect(forwardPlan.devices.map(device => device.deviceId)).toEqual(['controller', 'worker', 'worker-c'])

    const forward = await renderBootstrapSet({
      packPath: paths.packPath,
      overlayPaths,
      identityDirectory: join(identityRoot, 'controller'),
      deviceId: 'controller',
      outputDirectory: outputA,
    })
    const reverse = await renderBootstrapSet({
      packPath: paths.packPath,
      overlayPaths: [...overlayPaths].reverse(),
      identityDirectory: join(identityRoot, 'worker'),
      deviceId: 'worker',
      outputDirectory: outputB,
    })
    const third = await renderBootstrapSet({
      packPath: paths.packPath,
      overlayPaths: [overlayPaths[1]!, overlayPaths[0]!, overlayPaths[2]!],
      identityDirectory: join(identityRoot, 'worker-c'),
      deviceId: 'worker-c',
      outputDirectory: outputC,
    })
    expect(forward.manifestDigest).toBe(reverse.manifestDigest)
    expect(new Set([forward.manifestDigest, reverse.manifestDigest, third.manifestDigest])).toEqual(new Set([forwardPlan.manifestDigest]))
    for (const rendered of [forward, reverse, third]) {
      expect(await readRegularFileWithMode(rendered.manifestPath, 0o600)).toBe(forwardPlan.manifestYaml)
      expect((await stat(rendered.trustStorePath)).mode & 0o777).toBe(0o600)
      const agent = parseAgentConfig(JSON.parse(
        await readRegularFileWithMode(rendered.agentConfigPath, 0o600),
      ) as unknown)
      expect(agent.deviceId).toBe(rendered.deviceId)
      expect(agent.manifestPath).toBe(join(paths.root, `dsh-home-${rendered.deviceId}`, 'profiles', 'headless', 'fleet.lock.yaml'))
      expect(agent.desiredManifestPath).toBe(rendered.manifestPath)
      expect(agent.tasks?.workspaces).toEqual({ 'fleet-repo': join(paths.root, `workspace-${rendered.deviceId}`) })
      expect(JSON.parse(await readRegularFileWithMode(rendered.taskPolicyPath, 0o600))).toEqual({
        profiles: ['headless'],
        workspaces: { 'fleet-repo': join(paths.root, `workspace-${rendered.deviceId}`) },
      })
    }
    await expect(renderBootstrapSet({
      packPath: paths.packPath,
      overlayPaths,
      identityDirectory: join(identityRoot, 'controller'),
      deviceId: 'controller',
      outputDirectory: outputA,
    })).rejects.toThrow(/refuses to overwrite/)
  })

  it('preflights the selected local identity before creating any render-set output', async () => {
    const paths = await fixture()
    const identityRoot = join(paths.root, 'identities')
    const outputDirectory = join(paths.root, 'generation-failed')
    const secondOverlayPath = join(paths.root, 'controller-overlay.yaml')
    await mkdir(identityRoot, { mode: 0o700 })
    await writePrivateOverlay(secondOverlayPath, overlayValue(paths.root, 'controller', 'headless-r2', 'b'.repeat(64)))
    await createBootstrapIdentity({
      outputDirectory: join(identityRoot, 'worker'), teamId: 'example-team', principalId: 'owner', deviceId: 'worker',
    })
    await createBootstrapIdentity({
      outputDirectory: join(identityRoot, 'controller'), teamId: 'example-team', principalId: 'owner', deviceId: 'wrong-device',
    })

    await expect(renderBootstrapSet({
      packPath: paths.packPath,
      overlayPaths: [paths.overlayPath, secondOverlayPath],
      identityDirectory: join(identityRoot, 'controller'),
      deviceId: 'controller',
      outputDirectory,
    })).rejects.toThrow(/does not match the overlay/)
    await expect(stat(join(outputDirectory, 'fleet.lock.yaml'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(join(outputDirectory, 'agent.config.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('assembles and inspects an immutable generation with bundles, routes and manifest bindings', async () => {
    const paths = await fixture()
    const controllerOverlayPath = join(paths.root, 'controller-overlay.yaml')
    await writePrivateOverlay(controllerOverlayPath, overlayValue(paths.root, 'controller'))
    await createBootstrapIdentity({
      outputDirectory: paths.identityDirectory,
      teamId: 'example-team', principalId: 'owner', deviceId: 'worker',
    })
    const rootDirectory = join(paths.root, 'fleet-worker')
    const assembled = await assembleBootstrapGeneration({
      packPath: paths.packPath,
      overlayPaths: [controllerOverlayPath, paths.overlayPath],
      rootDirectory,
      generationId: 'generation-1',
      identityDirectory: paths.identityDirectory,
      deviceId: 'worker',
      agentBundlePath: paths.agentBundlePath,
      workerBundlePath: paths.workerBundlePath,
      bootstrapBundlePath: paths.bootstrapBundlePath,
      now: '2026-08-19T12:00:00.000Z',
    })
    const inspected = await inspectBootstrapGeneration({ rootDirectory, generationId: 'generation-1' })
    expect(inspected.generationDigest).toBe(assembled.generationDigest)
    expect(inspected.manifestDigest).toBe(assembled.manifestDigest)
    expect(Object.keys(inspected.files).sort()).toEqual([
      'agent.config.json', 'agent.mjs', 'bootstrap.mjs', 'fleet.lock.yaml', 'launcher.mjs', 'routes.json',
      'task-policy.json', 'trust-store.json', 'worker.mjs',
    ])
    expect((await stat(inspected.generationPath)).mode & 0o777).toBe(0o500)
    expect((await stat(join(inspected.generationPath, 'agent.mjs'))).mode & 0o777).toBe(0o500)
    const agentConfig = JSON.parse(await readRegularFileWithMode(
      join(inspected.generationPath, 'agent.config.json'),
      0o400,
    )) as Record<string, unknown>
    expect(agentConfig.manifestPath).toBe(join(paths.root, 'dsh-home-worker', 'profiles', 'headless', 'fleet.lock.yaml'))
    expect(agentConfig.desiredManifestPath).toBe(join(inspected.generationPath, 'fleet.lock.yaml'))
    const routes = JSON.parse(await readFile(join(inspected.generationPath, 'routes.json'), 'utf8')) as { routes: unknown[] }
    expect(routes.routes).toEqual([
      expect.objectContaining({ deviceId: 'controller', transport: 'local' }),
      expect.objectContaining({
        deviceId: 'worker', transport: 'local', agentPath: join(rootDirectory, 'current', 'launcher.mjs'),
        configPath: join(rootDirectory, 'current', 'agent.config.json'),
      }),
    ])
    await expect(assembleBootstrapGeneration({
      packPath: paths.packPath,
      overlayPaths: [paths.overlayPath, controllerOverlayPath],
      rootDirectory,
      generationId: 'generation-1',
      identityDirectory: paths.identityDirectory,
      deviceId: 'worker',
      agentBundlePath: paths.agentBundlePath,
      workerBundlePath: paths.workerBundlePath,
    })).rejects.toThrow(/refuses to overwrite/)
  })

  it('pins agent, config and worker to one generation while current switches and rejects unsafe launcher state', async () => {
    const paths = await fixture()
    await createBootstrapIdentity({
      outputDirectory: paths.identityDirectory,
      teamId: 'example-team', principalId: 'owner', deviceId: 'worker',
    })
    const rootDirectory = join(paths.root, 'fleet-worker')
    for (const [generationId, marker] of [['generation-1', 'one'], ['generation-2', 'two']] as const) {
      await writeFile(paths.agentBundlePath, probeAgent(marker), { mode: 0o700 })
      await writeFile(paths.workerBundlePath, `export const marker = ${JSON.stringify(marker)}\n`, { mode: 0o600 })
      await assembleBootstrapGeneration({
        packPath: paths.packPath,
        overlayPaths: [paths.overlayPath],
        rootDirectory,
        generationId,
        identityDirectory: paths.identityDirectory,
        deviceId: 'worker',
        agentBundlePath: paths.agentBundlePath,
        workerBundlePath: paths.workerBundlePath,
      })
    }
    await activateBootstrapGeneration({ rootDirectory, generationId: 'generation-1', expectedCurrent: null })
    const currentLauncher = join(rootDirectory, 'current', 'launcher.mjs')
    const currentConfig = join(rootDirectory, 'current', 'agent.config.json')
    const startedPath = join(paths.root, 'generation-probe-started')
    const inFlight = invokeGenerationLauncher(currentLauncher, currentConfig, [], {
      ...process.env,
      DSH_FLEET_PROBE_STARTED: startedPath,
    })
    await Promise.race([
      waitForPath(startedPath),
      inFlight.then(result => { throw new TypeError('launcher exited before probe start: ' + JSON.stringify(result)) }),
    ])
    await activateBootstrapGeneration({
      rootDirectory, generationId: 'generation-2', expectedCurrent: 'generation-1',
    })
    const first = await inFlight
    expect(first).toMatchObject({ code: 0, stderr: '' })
    expect(JSON.parse(first.stdout)).toEqual({
      agentMarker: 'one', configGeneration: 'generation-1', desiredGeneration: 'generation-1', workerMarker: 'one',
    })
    const second = await invokeGenerationLauncher(currentLauncher, currentConfig)
    expect(second).toMatchObject({ code: 0, stderr: '' })
    expect(JSON.parse(second.stdout)).toEqual({
      agentMarker: 'two', configGeneration: 'generation-2', desiredGeneration: 'generation-2', workerMarker: 'two',
    })

    const trustedLauncher = join(rootDirectory, 'generations', 'generation-1', 'launcher.mjs')
    const extraArgument = await invokeGenerationLauncher(trustedLauncher, currentConfig, ['--unexpected'])
    expect(extraArgument.code).toBe(70)
    expect(extraArgument.stderr).toMatch(/exactly --config/)

    await unlink(join(rootDirectory, 'current'))
    await symlink('/tmp/dsh-fleet-absolute-escape', join(rootDirectory, 'current'))
    const absoluteEscape = await invokeGenerationLauncher(trustedLauncher, currentConfig)
    expect(absoluteEscape.code).toBe(70)
    expect(absoluteEscape.stderr).toMatch(/one relative generations/)
    await unlink(join(rootDirectory, 'current'))
    await symlink('../relative-escape', join(rootDirectory, 'current'))
    const relativeEscape = await invokeGenerationLauncher(trustedLauncher, currentConfig)
    expect(relativeEscape.code).toBe(70)
    expect(relativeEscape.stderr).toMatch(/one relative generations/)
    await unlink(join(rootDirectory, 'current'))
    await symlink('generations/generation-2', join(rootDirectory, 'current'))

    const generationTwo = join(rootDirectory, 'generations', 'generation-2')
    const generationTwoConfig = join(generationTwo, 'agent.config.json')
    const originalConfig = await readFile(generationTwoConfig, 'utf8')
    await chmod(generationTwo, 0o700)
    await unlink(generationTwoConfig)
    await writeFile(generationTwoConfig, originalConfig.replace('"deviceId": "worker"', '"deviceId": "attacker"'), { mode: 0o400 })
    await chmod(generationTwoConfig, 0o400)
    await chmod(generationTwo, 0o500)
    const replacedConfig = await invokeGenerationLauncher(trustedLauncher, currentConfig)
    expect(replacedConfig.code).toBe(70)
    expect(replacedConfig.stderr).toMatch(/integrity mismatch: agent.config.json/)

    await chmod(generationTwo, 0o700)
    await unlink(generationTwoConfig)
    await writeFile(generationTwoConfig, originalConfig, { mode: 0o400 })
    await chmod(generationTwoConfig, 0o400)
    const generationTwoLauncher = join(generationTwo, 'launcher.mjs')
    const originalLauncher = await readFile(generationTwoLauncher, 'utf8')
    await unlink(generationTwoLauncher)
    await writeFile(generationTwoLauncher, originalLauncher + '// replaced\n', { mode: 0o500 })
    await chmod(generationTwoLauncher, 0o500)
    await chmod(generationTwo, 0o500)
    const replacedLauncher = await invokeGenerationLauncher(trustedLauncher, currentConfig)
    expect(replacedLauncher.code).toBe(70)
    expect(replacedLauncher.stderr).toMatch(/integrity mismatch: launcher.mjs/)
  })

  it('atomically activates with CAS and rolls back exactly to journal.previous', async () => {
    const paths = await fixture()
    await createBootstrapIdentity({
      outputDirectory: paths.identityDirectory,
      teamId: 'example-team', principalId: 'owner', deviceId: 'worker',
    })
    const rootDirectory = join(paths.root, 'fleet-worker')
    for (const [generationId, now] of [
      ['generation-1', '2026-08-19T12:00:00.000Z'],
      ['generation-2', '2026-08-19T12:01:00.000Z'],
    ] as const) {
      await assembleBootstrapGeneration({
        packPath: paths.packPath,
        overlayPaths: [paths.overlayPath],
        rootDirectory,
        generationId,
        identityDirectory: paths.identityDirectory,
        deviceId: 'worker',
        agentBundlePath: paths.agentBundlePath,
        workerBundlePath: paths.workerBundlePath,
        now,
      })
    }

    await activateBootstrapGeneration({
      rootDirectory, generationId: 'generation-1', expectedCurrent: null, now: '2026-08-19T12:02:00.000Z',
    })
    expect(await readlink(join(rootDirectory, 'current'))).toBe('generations/generation-1')
    await expect(activateBootstrapGeneration({
      rootDirectory, generationId: 'generation-2', expectedCurrent: null, now: '2026-08-19T12:03:00.000Z',
    })).rejects.toThrow(/CAS mismatch/)
    expect(await readlink(join(rootDirectory, 'current'))).toBe('generations/generation-1')

    const activated = await activateBootstrapGeneration({
      rootDirectory, generationId: 'generation-2', expectedCurrent: 'generation-1', now: '2026-08-19T12:04:00.000Z',
    })
    expect(activated).toMatchObject({ previous: 'generation-1', current: 'generation-2' })
    await expect(rollbackBootstrapGeneration({
      rootDirectory, expectedCurrent: 'generation-1', now: '2026-08-19T12:05:00.000Z',
    })).rejects.toThrow(/CAS mismatch/)
    expect(await readlink(join(rootDirectory, 'current'))).toBe('generations/generation-2')

    const journalPath = join(rootDirectory, 'activation-journal.json')
    const committedJournalSource = await readFile(journalPath, 'utf8')
    const tamperedJournal = JSON.parse(committedJournalSource) as Record<string, unknown>
    tamperedJournal.previous = 'generation-tampered'
    await writeFile(journalPath, JSON.stringify(tamperedJournal, null, 2) + '\n')
    await expect(rollbackBootstrapGeneration({
      rootDirectory, expectedCurrent: 'generation-2', now: '2026-08-19T12:05:30.000Z',
    })).rejects.toThrow(/journal digest/)
    expect(await readlink(join(rootDirectory, 'current'))).toBe('generations/generation-2')
    await writeFile(journalPath, committedJournalSource)

    const rolledBack = await rollbackBootstrapGeneration({
      rootDirectory, expectedCurrent: 'generation-2', now: '2026-08-19T12:06:00.000Z',
    })
    expect(rolledBack).toMatchObject({ previous: 'generation-2', current: 'generation-1' })
    expect(await readlink(join(rootDirectory, 'current'))).toBe('generations/generation-1')
    const journal = JSON.parse(await readFile(journalPath, 'utf8')) as Record<string, unknown>
    expect(journal).toMatchObject({ previous: 'generation-1', next: 'generation-2', state: 'rolled-back' })
  })

  it('leaves current untorn on either side of the atomic activation rename', async () => {
    const paths = await fixture()
    await createBootstrapIdentity({
      outputDirectory: paths.identityDirectory,
      teamId: 'example-team', principalId: 'owner', deviceId: 'worker',
    })
    const rootDirectory = join(paths.root, 'fleet-worker')
    for (const generationId of ['generation-1', 'generation-2']) {
      await assembleBootstrapGeneration({
        packPath: paths.packPath,
        overlayPaths: [paths.overlayPath],
        rootDirectory,
        generationId,
        identityDirectory: paths.identityDirectory,
        deviceId: 'worker',
        agentBundlePath: paths.agentBundlePath,
        workerBundlePath: paths.workerBundlePath,
      })
    }
    await activateBootstrapGeneration({ rootDirectory, generationId: 'generation-1', expectedCurrent: null })
    await expect(activateBootstrapGeneration({
      rootDirectory,
      generationId: 'generation-2',
      expectedCurrent: 'generation-1',
      hooks: { beforeCurrentSwap: () => { throw new Error('simulated crash before rename') } },
    })).rejects.toThrow(/simulated crash/)
    expect(await readlink(join(rootDirectory, 'current'))).toBe('generations/generation-1')
    expect(JSON.parse(await readFile(join(rootDirectory, 'activation-journal.json'), 'utf8'))).toEqual(
      expect.objectContaining({ previous: 'generation-1', next: 'generation-2', state: 'prepared' }),
    )
    await writeLifecycleLock(rootDirectory, definitelyDeadPid())
    await rollbackBootstrapGeneration({ rootDirectory, expectedCurrent: 'generation-1' })
    expect(await readlink(join(rootDirectory, 'current'))).toBe('generations/generation-1')
    await expect(stat(join(rootDirectory, GENERATION_LIFECYCLE_LOCK_NAME))).rejects.toMatchObject({ code: 'ENOENT' })

    await expect(activateBootstrapGeneration({
      rootDirectory,
      generationId: 'generation-2',
      expectedCurrent: 'generation-1',
      hooks: { afterCurrentSwap: () => { throw new Error('simulated crash after rename') } },
    })).rejects.toThrow(/simulated crash/)
    expect(await readlink(join(rootDirectory, 'current'))).toBe('generations/generation-2')
    expect(JSON.parse(await readFile(join(rootDirectory, 'activation-journal.json'), 'utf8'))).toEqual(
      expect.objectContaining({ previous: 'generation-1', next: 'generation-2', state: 'prepared' }),
    )
    await writeLifecycleLock(rootDirectory, definitelyDeadPid())
    await rollbackBootstrapGeneration({ rootDirectory, expectedCurrent: 'generation-2' })
    expect(await readlink(join(rootDirectory, 'current'))).toBe('generations/generation-1')
    await expect(stat(join(rootDirectory, GENERATION_LIFECYCLE_LOCK_NAME))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('never steals live, symlinked, broad-permission or replaced lifecycle locks', async () => {
    const paths = await fixture()
    await createBootstrapIdentity({
      outputDirectory: paths.identityDirectory,
      teamId: 'example-team', principalId: 'owner', deviceId: 'worker',
    })
    const rootDirectory = join(paths.root, 'fleet-worker')
    await assembleBootstrapGeneration({
      packPath: paths.packPath,
      overlayPaths: [paths.overlayPath],
      rootDirectory,
      generationId: 'generation-1',
      identityDirectory: paths.identityDirectory,
      deviceId: 'worker',
      agentBundlePath: paths.agentBundlePath,
      workerBundlePath: paths.workerBundlePath,
    })

    const live = await writeLifecycleLock(rootDirectory, process.pid)
    await expect(activateBootstrapGeneration({
      rootDirectory, generationId: 'generation-1', expectedCurrent: null,
    })).rejects.toThrow(/live owner/)
    expect(JSON.parse(await readFile(join(live.lockPath, 'owner.json'), 'utf8'))).toEqual(
      expect.objectContaining({ pid: process.pid, token: live.token }),
    )
    await rm(live.lockPath, { recursive: true })

    const redirectedLock = join(paths.root, 'redirected-lifecycle-lock')
    await mkdir(redirectedLock, { mode: 0o700 })
    await symlink(redirectedLock, join(rootDirectory, GENERATION_LIFECYCLE_LOCK_NAME))
    await expect(activateBootstrapGeneration({
      rootDirectory, generationId: 'generation-1', expectedCurrent: null,
    })).rejects.toThrow(/real directory/)
    await unlink(join(rootDirectory, GENERATION_LIFECYCLE_LOCK_NAME))

    const symlinkRecordTarget = join(paths.root, 'outside-owner.json')
    await writeFile(symlinkRecordTarget, '{}\n', { mode: 0o600 })
    await mkdir(join(rootDirectory, GENERATION_LIFECYCLE_LOCK_NAME), { mode: 0o700 })
    await symlink(symlinkRecordTarget, join(rootDirectory, GENERATION_LIFECYCLE_LOCK_NAME, 'owner.json'))
    await expect(activateBootstrapGeneration({
      rootDirectory, generationId: 'generation-1', expectedCurrent: null,
    })).rejects.toThrow(/symbolic link/)
    await rm(join(rootDirectory, GENERATION_LIFECYCLE_LOCK_NAME), { recursive: true })

    const broad = await writeLifecycleLock(rootDirectory, definitelyDeadPid())
    await chmod(broad.lockPath, 0o755)
    await expect(activateBootstrapGeneration({
      rootDirectory, generationId: 'generation-1', expectedCurrent: null,
    })).rejects.toThrow(/owner-only/)
    await rm(broad.lockPath, { recursive: true })

    const broadRecord = await writeLifecycleLock(rootDirectory, definitelyDeadPid())
    await chmod(join(broadRecord.lockPath, 'owner.json'), 0o644)
    await expect(activateBootstrapGeneration({
      rootDirectory, generationId: 'generation-1', expectedCurrent: null,
    })).rejects.toThrow(/private regular file/)
    await rm(broadRecord.lockPath, { recursive: true })

    const displacedLock = join(rootDirectory, '.generation-lifecycle.displaced-test')
    let replacementToken = ''
    await expect(activateBootstrapGeneration({
      rootDirectory,
      generationId: 'generation-1',
      expectedCurrent: null,
      hooks: {
        beforeCurrentSwap: async () => {
          await rename(join(rootDirectory, GENERATION_LIFECYCLE_LOCK_NAME), displacedLock)
          replacementToken = (await writeLifecycleLock(rootDirectory, process.pid)).token
        },
      },
    })).rejects.toThrow(/lock was replaced/)
    await expect(stat(join(rootDirectory, 'current'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(JSON.parse(await readFile(join(rootDirectory, GENERATION_LIFECYCLE_LOCK_NAME, 'owner.json'), 'utf8'))).toEqual(
      expect.objectContaining({ token: replacementToken, pid: process.pid }),
    )
    expect(JSON.parse(await readFile(join(rootDirectory, 'activation-journal.json'), 'utf8'))).toEqual(
      expect.objectContaining({ previous: null, next: 'generation-1', state: 'prepared' }),
    )
    await rm(join(rootDirectory, GENERATION_LIFECYCLE_LOCK_NAME), { recursive: true })
    await rm(displacedLock, { recursive: true })
  })

  it('rejects malicious symlinks and relaxed generation permissions', async () => {
    const symlinkPaths = await fixture()
    await createBootstrapIdentity({
      outputDirectory: symlinkPaths.identityDirectory,
      teamId: 'example-team', principalId: 'owner', deviceId: 'worker',
    })
    const redirectedRoot = join(symlinkPaths.root, 'redirected-root')
    await mkdir(redirectedRoot, { mode: 0o700 })
    await symlink(redirectedRoot, join(symlinkPaths.root, 'fleet-worker'))
    await expect(assembleBootstrapGeneration({
      packPath: symlinkPaths.packPath,
      overlayPaths: [symlinkPaths.overlayPath],
      rootDirectory: join(symlinkPaths.root, 'fleet-worker'),
      generationId: 'generation-1',
      identityDirectory: symlinkPaths.identityDirectory,
      deviceId: 'worker',
      agentBundlePath: symlinkPaths.agentBundlePath,
      workerBundlePath: symlinkPaths.workerBundlePath,
    })).rejects.toThrow(/real directory/)

    const paths = await fixture()
    await createBootstrapIdentity({
      outputDirectory: paths.identityDirectory,
      teamId: 'example-team', principalId: 'owner', deviceId: 'worker',
    })
    const rootDirectory = join(paths.root, 'fleet-worker')
    const assembled = await assembleBootstrapGeneration({
      packPath: paths.packPath,
      overlayPaths: [paths.overlayPath],
      rootDirectory,
      generationId: 'generation-1',
      identityDirectory: paths.identityDirectory,
      deviceId: 'worker',
      agentBundlePath: paths.agentBundlePath,
      workerBundlePath: paths.workerBundlePath,
    })
    await chmod(join(assembled.generationPath, 'agent.config.json'), 0o644)
    await expect(inspectBootstrapGeneration({ rootDirectory, generationId: 'generation-1' }))
      .rejects.toThrow(/owner-only|integrity mismatch/)

    await chmod(join(assembled.generationPath, 'agent.config.json'), 0o400)
    await symlink('../../outside-generation-root', join(rootDirectory, 'current'))
    await expect(activateBootstrapGeneration({
      rootDirectory, generationId: 'generation-1', expectedCurrent: null,
    })).rejects.toThrow(/current must point to generations/)
    await unlink(join(rootDirectory, 'current'))

    await chmod(assembled.generationPath, 0o700)
    await unlink(join(assembled.generationPath, 'agent.mjs'))
    await symlink(paths.agentBundlePath, join(assembled.generationPath, 'agent.mjs'))
    await chmod(assembled.generationPath, 0o500)
    await expect(inspectBootstrapGeneration({ rootDirectory, generationId: 'generation-1' }))
      .rejects.toThrow(/symbolic link/)
  })
})

import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { appendFile, copyFile, lstat, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { parseFleetManifest } from '../host/core.ts'
import type { FleetManifest } from '../shared.ts'
import type { FleetAgentConfig } from './config.ts'
import { createAgentPlan } from './planner.ts'
import {
  FleetProtocolError,
  validateFleetPlan,
  validateFleetPlanApproval,
  type FleetPlan,
  type FleetPlanApproval,
} from './protocol.ts'

const SNAPSHOT_FILES = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'cordis.patch.yml'] as const
const MAX_OUTPUT_BYTES = 1024 * 1024

export type AgentActionState =
  | 'approved'
  | 'staging'
  | 'staged'
  | 'applying'
  | 'restarting'
  | 'verifying'
  | 'succeeded'
  | 'rollback'
  | 'rollback-restarting'
  | 'rollback-verifying'
  | 'rolled-back'
  | 'manual-intervention'

export interface AgentActionRecord {
  planId: string
  planDigest: string
  approvalId: string
  principalId: string
  idempotencyKey: string
  deviceId: string
  profile: string
  pluginId: string
  action: FleetPlan['action']
  state: AgentActionState
  updatedAt: string
  result?: 'success' | 'rolled-back' | 'manual-intervention'
  errorCode?: string
}

export interface AgentCandidate {
  pluginId: string
  action: FleetPlan['action']
  fromSpec: string | null
  exactToSpec: string
  sourceKind: FleetPlan['sourceKind']
}

export interface AgentInspection {
  protocolVersion: 1
  deviceId: string
  profile: string
  dshVersion: string
  manifestDigest: string
  profileHash: string
  candidates: AgentCandidate[]
}

interface ProfileManifest {
  dependencies?: Record<string, string>
}

interface LoadedState {
  manifest: FleetManifest
  manifestDigest: string
  dependencies: Record<string, string>
  profileHash: string
  dshVersion: string
}

interface RunOptions {
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
  allowFailure?: boolean
  cwd?: string
}

interface SnapshotMetadata {
  planId: string
  digest: string
  manifestDigest: string
  profileHash: string
  profileDirectoryPresent: boolean
  present: Record<(typeof SNAPSHOT_FILES)[number], boolean>
}

class AgentRuntimeError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'AgentRuntimeError'
    this.code = code
  }
}

function profileDir(config: FleetAgentConfig): string {
  return join(config.dshHome, 'profiles', config.profile)
}

function controlledEnv(config: FleetAgentConfig): NodeJS.ProcessEnv {
  const path = [dirname(config.pnpmBinary), dirname(config.dshBinary), '/opt/homebrew/bin', '/usr/bin', '/bin'].join(':')
  const env: NodeJS.ProcessEnv = {}
  for (const key of ['HOME', 'USER', 'LOGNAME', 'TMPDIR', 'LANG', 'LC_ALL', 'SHELL', 'TERM', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME']) {
    if (process.env[key] !== undefined) env[key] = process.env[key]
  }
  return { ...env, DSH_HOME: config.dshHome, PATH: path, GIT_TERMINAL_PROMPT: '0' }
}

function runFile(file: string, args: string[], options: RunOptions = {}): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const grouped = process.platform !== 'win32'
    const child = spawn(file, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      detached: grouped,
      ...(options.env === undefined ? {} : { env: options.env }),
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false
    let forceTimer: NodeJS.Timeout | undefined
    const killTree = (signal: NodeJS.Signals) => {
      try {
        if (grouped && child.pid !== undefined) process.kill(-child.pid, signal)
        else child.kill(signal)
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
      }
    }
    const finish = (action: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (forceTimer !== undefined) clearTimeout(forceTimer)
      action()
    }
    const timer = setTimeout(() => {
      timedOut = true
      killTree('SIGTERM')
      forceTimer = setTimeout(() => killTree('SIGKILL'), 2000)
      forceTimer.unref()
    }, options.timeoutMs ?? 120_000)
    timer.unref()
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
      if (Buffer.byteLength(stdout) > MAX_OUTPUT_BYTES) child.kill('SIGTERM')
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
      if (Buffer.byteLength(stderr) > MAX_OUTPUT_BYTES) child.kill('SIGTERM')
    })
    child.once('error', () => finish(() => {
      reject(new AgentRuntimeError('command-unavailable', 'required executable is unavailable'))
    }))
    child.once('close', code => finish(() => {
      const exitCode = code ?? 1
      if (timedOut) {
        reject(new AgentRuntimeError('command-timeout', 'controlled command exceeded its timeout'))
      } else if (exitCode !== 0 && options.allowFailure !== true) {
        reject(new AgentRuntimeError('command-failed', 'controlled command failed'))
      } else resolve({ stdout, stderr, code: exitCode })
    }))
  })
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

async function readRegularOptional(path: string): Promise<string | null> {
  try {
    const info = await lstat(path)
    if (info.isSymbolicLink() || !info.isFile()) throw new AgentRuntimeError('unsafe-profile-file', 'profile state accepts regular files only')
    return await readFile(path, 'utf8')
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export async function computeProfileHash(config: FleetAgentConfig): Promise<string> {
  const dir = profileDir(config)
  const files: Record<string, string | null> = {}
  for (const name of SNAPSHOT_FILES) files[name] = await readRegularOptional(join(dir, name))
  return sha256(JSON.stringify(files))
}

async function readDshVersion(config: FleetAgentConfig): Promise<string> {
  const result = await runFile(config.dshBinary, ['--version'], { env: controlledEnv(config), timeoutMs: 10_000 })
  const version = result.stdout.trim()
  if (version.length === 0) throw new AgentRuntimeError('dsh-version-unavailable', 'DSH version is unavailable')
  return version
}

async function loadState(config: FleetAgentConfig): Promise<LoadedState> {
  const manifestSource = await readFile(config.manifestPath, 'utf8')
  const manifest = parseFleetManifest(manifestSource)
  const profileSource = await readRegularOptional(join(profileDir(config), 'package.json'))
  const parsed = profileSource === null ? {} : JSON.parse(profileSource) as ProfileManifest
  return {
    manifest,
    manifestDigest: sha256(manifestSource),
    dependencies: parsed.dependencies ?? {},
    profileHash: await computeProfileHash(config),
    dshVersion: await readDshVersion(config),
  }
}

function planPath(config: FleetAgentConfig, planId: string): string {
  if (!/^plan:[0-9a-f]{64}$/.test(planId)) throw new AgentRuntimeError('invalid-plan-id', 'plan id is invalid')
  return join(config.stateDir, 'plans', planId.slice(5) + '.json')
}

function actionPath(config: FleetAgentConfig, planId: string): string {
  if (!/^plan:[0-9a-f]{64}$/.test(planId)) throw new AgentRuntimeError('invalid-plan-id', 'plan id is invalid')
  return join(config.stateDir, 'actions', planId.slice(5) + '.json')
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = path + '.' + randomUUID() + '.tmp'
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
  await rename(temporary, path)
}

async function readJson<T>(path: string): Promise<T | null> {
  const source = await readOptional(path)
  return source === null ? null : JSON.parse(source) as T
}

async function audit(config: FleetAgentConfig, event: Record<string, unknown>): Promise<void> {
  await mkdir(config.stateDir, { recursive: true, mode: 0o700 })
  await appendFile(join(config.stateDir, 'audit.jsonl'), JSON.stringify({
    eventId: randomUUID(),
    at: new Date().toISOString(),
    deviceId: config.deviceId,
    ...event,
  }) + '\n', { mode: 0o600 })
}

async function processIsAlive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0)
    return true
  } catch (error: unknown) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

async function withProfileLock<T>(config: FleetAgentConfig, operation: () => Promise<T>): Promise<T> {
  const lockDir = join(config.stateDir, 'locks')
  await mkdir(lockDir, { recursive: true, mode: 0o700 })
  const identity = sha256(config.dshHome + '\0' + config.profile)
  const lockPath = join(lockDir, identity + '.lock')
  const token = randomUUID()
  for (;;) {
    try {
      const handle = await open(lockPath, 'wx', 0o600)
      try {
        await handle.writeFile(JSON.stringify({ token, pid: process.pid, createdAt: new Date().toISOString() }) + '\n')
      } finally {
        await handle.close()
      }
      break
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      let owner: { token?: unknown; pid?: unknown; createdAt?: unknown } | null = null
      let ageMs = 0
      try {
        const info = await lstat(lockPath)
        if (info.isSymbolicLink() || !info.isFile()) throw new AgentRuntimeError('unsafe-state-file', 'fleet lock must be a regular file')
        ageMs = Date.now() - info.mtimeMs
        owner = JSON.parse(await readFile(lockPath, 'utf8')) as { token?: unknown; pid?: unknown; createdAt?: unknown }
      } catch (readError: unknown) {
        if ((readError as NodeJS.ErrnoException).code === 'ENOENT') continue
        if (readError instanceof AgentRuntimeError) throw readError
      }
      const ownerPid = typeof owner?.pid === 'number' && Number.isSafeInteger(owner.pid) && owner.pid > 0 ? owner.pid : null
      const active = ownerPid !== null && await processIsAlive(ownerPid)
      if (active || (ownerPid === null && ageMs < 10_000)) {
        throw new AgentRuntimeError('agent-busy', 'another fleet action is already running for this profile')
      }
      await rm(lockPath, { force: true })
    }
  }
  try {
    return await operation()
  } finally {
    try {
      const owner = JSON.parse(await readFile(lockPath, 'utf8')) as { token?: unknown }
      if (owner.token === token) await rm(lockPath, { force: true })
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}

async function saveAction(config: FleetAgentConfig, record: AgentActionRecord, state: AgentActionState, fields: Partial<AgentActionRecord> = {}): Promise<AgentActionRecord> {
  const next: AgentActionRecord = { ...record, ...fields, state, updatedAt: new Date().toISOString() }
  await atomicJson(actionPath(config, record.planId), next)
  return next
}

async function snapshotProfile(config: FleetAgentConfig, plan: FleetPlan): Promise<void> {
  const destination = join(config.stateDir, 'snapshots', plan.digest)
  await rm(destination, { recursive: true, force: true })
  await mkdir(destination, { recursive: true, mode: 0o700 })
  let profileDirectoryPresent = true
  try {
    const info = await lstat(profileDir(config))
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new AgentRuntimeError('unsafe-profile-directory', 'profile state accepts a regular directory only')
    }
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    profileDirectoryPresent = false
  }
  const present = {} as Record<(typeof SNAPSHOT_FILES)[number], boolean>
  for (const name of SNAPSHOT_FILES) {
    const source = join(profileDir(config), name)
    try {
      const info = await lstat(source)
      if (info.isSymbolicLink() || !info.isFile()) throw new AgentRuntimeError('unsafe-profile-file', 'profile snapshots accept regular files only')
      await copyFile(source, join(destination, name))
      present[name] = true
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      present[name] = false
    }
  }
  if (profileDirectoryPresent && (present['package.json'] !== true || present['pnpm-lock.yaml'] !== true)) {
    throw new AgentRuntimeError('profile-not-snapshotable', 'an existing profile requires package.json and pnpm-lock.yaml for rollback')
  }
  await atomicJson(join(destination, 'snapshot.json'), {
    planId: plan.planId,
    digest: plan.digest,
    manifestDigest: plan.manifestDigest,
    profileHash: plan.profileHash,
    profileDirectoryPresent,
    present,
  } satisfies SnapshotMetadata)
}

async function restoreProfile(config: FleetAgentConfig, plan: FleetPlan): Promise<void> {
  const source = join(config.stateDir, 'snapshots', plan.digest)
  const metadataSource = await readRegularOptional(join(source, 'snapshot.json'))
  if (metadataSource === null) throw new AgentRuntimeError('snapshot-missing', 'profile snapshot is unavailable')
  const metadata = JSON.parse(metadataSource) as SnapshotMetadata
  if (metadata.planId !== plan.planId || metadata.digest !== plan.digest ||
      metadata.manifestDigest !== plan.manifestDigest || metadata.profileHash !== plan.profileHash) {
    throw new AgentRuntimeError('snapshot-mismatch', 'profile snapshot does not match the approved plan')
  }
  const targetDir = profileDir(config)
  try {
    const info = await lstat(targetDir)
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new AgentRuntimeError('unsafe-profile-directory', 'profile state accepts a regular directory only')
    }
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  if (metadata.profileDirectoryPresent !== true) {
    await rm(targetDir, { recursive: true, force: true })
    return
  }
  if (metadata.present['package.json'] !== true || metadata.present['pnpm-lock.yaml'] !== true) {
    throw new AgentRuntimeError('snapshot-mismatch', 'profile snapshot cannot rebuild the dependency tree')
  }
  await mkdir(targetDir, { recursive: true, mode: 0o700 })
  for (const name of SNAPSHOT_FILES) {
    const destination = join(targetDir, name)
    await rm(destination, { force: true })
    if (metadata.present[name] === true) await copyFile(join(source, name), destination)
  }
  await runFile(config.pnpmBinary, ['install', '--frozen-lockfile', '--ignore-scripts'], {
    cwd: targetDir,
    env: controlledEnv(config),
    timeoutMs: 120_000,
  })
  if (await computeProfileHash(config) !== plan.profileHash) {
    throw new AgentRuntimeError('rollback-profile-mismatch', 'restored profile does not match the approved snapshot')
  }
}

async function restartDsh(config: FleetAgentConfig): Promise<void> {
  if (config.restart.kind === 'none') return
  const env = controlledEnv(config)
  await runFile(config.restart.screenBinary, ['-S', config.restart.sessionName, '-X', 'quit'], {
    env,
    timeoutMs: 10_000,
    allowFailure: true,
  })
  const listeners = await runFile(config.restart.lsofBinary, [
    '-nP', '-t', '-iTCP:' + String(config.restart.port), '-sTCP:LISTEN',
  ], { env, timeoutMs: 10_000, allowFailure: true })
  const pids = listeners.stdout.trim() === '' ? [] : listeners.stdout.trim().split(/\s+/).map(value => Number(value))
  if (pids.some(pid => !Number.isSafeInteger(pid) || pid <= 0) || pids.length > 1) {
    throw new AgentRuntimeError('restart-owner-ambiguous', 'DSH restart found an ambiguous listener owner')
  }
  const listenerPid = pids[0]
  if (listenerPid !== undefined) {
    const owner = await runFile(config.restart.psBinary, ['-p', String(listenerPid), '-o', 'command='], {
      env,
      timeoutMs: 10_000,
    })
    const command = owner.stdout.trim()
    const hasWebToken = /(?:^|\s)web(?:\s|$)/.test(command)
    const hasPort = command.includes('--port ' + String(config.restart.port))
    const hasOwnerMarker = config.restart.ownerMarkers.some(marker => command.includes(marker))
    if (!hasOwnerMarker || !hasWebToken || !hasPort) {
      throw new AgentRuntimeError('restart-owner-mismatch', 'configured port is not owned by a recognizable DSH Web process')
    }
    try {
      process.kill(listenerPid, 'SIGTERM')
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    }
    const deadline = Date.now() + 5000
    while (Date.now() < deadline && await processIsAlive(listenerPid)) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    if (await processIsAlive(listenerPid)) {
      try {
        process.kill(listenerPid, 'SIGKILL')
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
      }
    }
  }
  const start = await runFile(config.restart.screenBinary, [
    '-DmS', config.restart.sessionName,
    '/usr/bin/env', 'DSH_HOME=' + config.dshHome, 'PATH=' + env.PATH,
    config.dshBinary, 'web', '--host', config.restart.host, '--port', String(config.restart.port),
  ], { env, timeoutMs: 10_000, allowFailure: true })
  if (start.code !== 0) throw new AgentRuntimeError('restart-failed', 'DSH restart failed')
}

async function waitForHttp(url: string, timeoutMs: number): Promise<Response> {
  const deadline = Date.now() + timeoutMs
  let last: unknown
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(Math.min(3000, Math.max(1, deadline - Date.now()))) })
      if (response.ok) return response
      last = response.status
    } catch (error: unknown) {
      last = error
    }
    await new Promise(resolve => setTimeout(resolve, 350))
  }
  void last
  throw new AgentRuntimeError('health-timeout', 'DSH health endpoint did not recover before timeout')
}

async function verifyHealth(config: FleetAgentConfig, plan?: FleetPlan): Promise<void> {
  await runFile(config.dshBinary, ['--profile', config.profile, '--dump-config'], {
    env: controlledEnv(config),
    timeoutMs: 20_000,
  })
  if (plan !== undefined) {
    const source = await readRegularOptional(join(profileDir(config), 'package.json'))
    if (source === null) throw new AgentRuntimeError('profile-missing', 'DSH profile is missing after apply')
    const parsed = JSON.parse(source) as ProfileManifest
    if (parsed.dependencies?.[plan.pluginId] !== plan.exactToSpec) {
      throw new AgentRuntimeError('profile-mismatch', 'installed dependency does not match the approved plan')
    }
  }
  if (config.health.url === undefined) return
  await waitForHttp(config.health.url, config.health.timeoutMs)
  if (!config.health.requireFleetRpc) return
  const endpoint = new URL('/dsh-fleet/status', config.health.url)
  const deadline = Date.now() + config.health.timeoutMs
  let targetPending = plan !== undefined
  while (Date.now() < deadline) {
    const rpcId = 'fleet-agent-health-' + randomUUID()
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId, method: 'status', payload: null }),
        signal: AbortSignal.timeout(Math.min(3000, Math.max(1, deadline - Date.now()))),
      })
      if (response.ok) {
        const body = await response.json() as {
          rpcId?: unknown
          result?: { ok?: unknown; value?: { summary?: { failed?: unknown }; plugins?: Array<{ id?: unknown; state?: unknown }> } }
        }
        const fleetHealthy = body.rpcId === rpcId && body.result?.ok === true && body.result.value?.summary?.failed === 0
        const target = plan === undefined ? undefined : body.result?.value?.plugins?.find(item => item.id === plan.pluginId)
        targetPending = plan !== undefined && target?.state !== 'aligned'
        if (fleetHealthy && !targetPending) return
      }
    } catch {
      // Startup is eventually consistent; retry until the bounded deadline.
    }
    await new Promise(resolve => setTimeout(resolve, 350))
  }
  if (targetPending) throw new AgentRuntimeError('plugin-not-active', 'approved plugin did not become active')
  throw new AgentRuntimeError('fleet-rpc-unhealthy', 'Fleet RPC reported an unhealthy runtime')
}

function installArgument(plan: FleetPlan): string {
  return plan.pluginId + '@' + plan.exactToSpec
}

async function applyPackage(config: FleetAgentConfig, plan: FleetPlan): Promise<void> {
  await runFile(config.pnpmBinary, ['--version'], { env: controlledEnv(config), timeoutMs: 10_000 })
  await runFile(config.dshBinary, [
    'plugin', '--profile', config.profile, 'add', installArgument(plan), '--save-exact', '--ignore-scripts',
  ], { env: controlledEnv(config), timeoutMs: 120_000 })
}

export async function inspectAgent(config: FleetAgentConfig, now = new Date()): Promise<AgentInspection> {
  const state = await loadState(config)
  const ids = [...new Set(state.manifest.plugins.map(plugin => plugin.id))].sort()
  const candidates: AgentCandidate[] = []
  for (const pluginId of ids) {
    try {
      const plan = createAgentPlan({
        manifest: state.manifest,
        manifestDigest: state.manifestDigest,
        dependencies: state.dependencies,
        profileHash: state.profileHash,
        observedDshVersion: state.dshVersion,
        now,
        pluginId,
        deviceId: config.deviceId,
        profile: config.profile,
        planTtlMs: config.planTtlMs,
      })
      candidates.push({
        pluginId: plan.pluginId,
        action: plan.action,
        fromSpec: plan.fromSpec,
        exactToSpec: plan.exactToSpec,
        sourceKind: plan.sourceKind,
      })
    } catch (error: unknown) {
      const code = (error as { code?: unknown }).code
      if (code !== 'already-aligned' && code !== 'plugin-not-targeted') throw error
    }
  }
  return {
    protocolVersion: 1,
    deviceId: config.deviceId,
    profile: config.profile,
    dshVersion: state.dshVersion,
    manifestDigest: state.manifestDigest,
    profileHash: state.profileHash,
    candidates,
  }
}

export async function createStoredPlan(config: FleetAgentConfig, pluginId: string, now = new Date()): Promise<FleetPlan> {
  const state = await loadState(config)
  const plan = createAgentPlan({
    manifest: state.manifest,
    manifestDigest: state.manifestDigest,
    dependencies: state.dependencies,
    profileHash: state.profileHash,
    observedDshVersion: state.dshVersion,
    now,
    pluginId,
    deviceId: config.deviceId,
    profile: config.profile,
    planTtlMs: config.planTtlMs,
  })
  await atomicJson(planPath(config, plan.planId), plan)
  await audit(config, { type: 'plan/created', planId: plan.planId, pluginId: plan.pluginId, action: plan.action })
  return plan
}

export async function readAction(config: FleetAgentConfig, planId: string): Promise<AgentActionRecord | null> {
  return readJson<AgentActionRecord>(actionPath(config, planId))
}

async function recoverInterrupted(config: FleetAgentConfig, plan: FleetPlan, record: AgentActionRecord): Promise<AgentActionRecord> {
  let current = await saveAction(config, record, 'rollback', { errorCode: 'interrupted-action' })
  try {
    await restoreProfile(config, plan)
    current = await saveAction(config, current, 'rollback-restarting')
    await restartDsh(config)
    current = await saveAction(config, current, 'rollback-verifying')
    await verifyHealth(config)
    current = await saveAction(config, current, 'rolled-back', { result: 'rolled-back' })
    await audit(config, { type: 'capability/rolled-back', planId: plan.planId, result: 'interrupted-action' })
    return current
  } catch {
    current = await saveAction(config, current, 'manual-intervention', { result: 'manual-intervention', errorCode: 'rollback-failed' })
    await audit(config, { type: 'capability/failed', planId: plan.planId, result: 'manual-intervention' })
    return current
  }
}

async function applyStoredPlanLocked(config: FleetAgentConfig, approval: FleetPlanApproval, now: Date): Promise<AgentActionRecord> {
  const plan = await readJson<FleetPlan>(planPath(config, approval.planId))
  if (plan === null) throw new AgentRuntimeError('plan-not-found', 'approved plan was not found')
  validateFleetPlan(plan)
  const existing = await readAction(config, plan.planId)
  let validation: ReturnType<typeof validateFleetPlanApproval>
  try {
    validation = validateFleetPlanApproval(plan, approval, now)
  } catch (error: unknown) {
    if (existing !== null && existing.state !== 'succeeded' && existing.state !== 'rolled-back' && existing.state !== 'manual-intervention') {
      return recoverInterrupted(config, plan, existing)
    }
    throw error
  }
  if (existing !== null) {
    if (existing.idempotencyKey !== validation.idempotencyKey) {
      if (existing.state !== 'succeeded' && existing.state !== 'rolled-back' && existing.state !== 'manual-intervention') {
        return recoverInterrupted(config, plan, existing)
      }
      throw new AgentRuntimeError('idempotency-conflict', 'plan already has a different approval')
    }
    if (existing.state === 'succeeded' || existing.state === 'rolled-back' || existing.state === 'manual-intervention') return existing
    return recoverInterrupted(config, plan, existing)
  }
  const currentState = await loadState(config)
  if (currentState.manifestDigest !== plan.manifestDigest || currentState.profileHash !== plan.profileHash || currentState.dshVersion !== plan.observedDshVersion) {
    throw new FleetProtocolError('approval-mismatch', 'manifest, profile or DSH version changed after the plan was created')
  }
  const recordSeed: AgentActionRecord = {
    planId: plan.planId,
    planDigest: plan.digest,
    approvalId: approval.approvalId,
    principalId: approval.principalId,
    idempotencyKey: validation.idempotencyKey,
    deviceId: plan.deviceId,
    profile: plan.profile,
    pluginId: plan.pluginId,
    action: plan.action,
    state: 'staged',
    updatedAt: new Date().toISOString(),
  }
  await audit(config, { type: 'plan/approved', planId: plan.planId, approvalId: approval.approvalId, principalId: approval.principalId })
  await snapshotProfile(config, plan)
  let record = await saveAction(config, recordSeed, 'staged')
  try {
    record = await saveAction(config, record, 'applying')
    await applyPackage(config, plan)
    record = await saveAction(config, record, 'restarting')
    await restartDsh(config)
    record = await saveAction(config, record, 'verifying')
    await verifyHealth(config, plan)
    record = await saveAction(config, record, 'succeeded', { result: 'success' })
    await audit(config, { type: 'capability/applied', planId: plan.planId, pluginId: plan.pluginId, result: 'success' })
    return record
  } catch (error: unknown) {
    const errorCode = typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : 'apply-failed'
    record = await saveAction(config, record, 'rollback', { errorCode })
    await audit(config, { type: 'capability/failed', planId: plan.planId, pluginId: plan.pluginId, result: errorCode })
    try {
      await restoreProfile(config, plan)
      record = await saveAction(config, record, 'rollback-restarting')
      await restartDsh(config)
      record = await saveAction(config, record, 'rollback-verifying')
      await verifyHealth(config)
      record = await saveAction(config, record, 'rolled-back', { result: 'rolled-back' })
      await audit(config, { type: 'capability/rolled-back', planId: plan.planId, result: errorCode })
      return record
    } catch {
      record = await saveAction(config, record, 'manual-intervention', { result: 'manual-intervention', errorCode: 'rollback-failed' })
      await audit(config, { type: 'capability/failed', planId: plan.planId, result: 'manual-intervention' })
      return record
    }
  }
}

export async function applyStoredPlan(config: FleetAgentConfig, approval: FleetPlanApproval, now = new Date()): Promise<AgentActionRecord> {
  return withProfileLock(config, () => applyStoredPlanLocked(config, approval, now))
}

export async function readOrRecoverAction(config: FleetAgentConfig, planId: string): Promise<AgentActionRecord | null> {
  return withProfileLock(config, async () => {
    const record = await readAction(config, planId)
    if (record === null || record.state === 'succeeded' || record.state === 'rolled-back' || record.state === 'manual-intervention') return record
    const plan = await readJson<FleetPlan>(planPath(config, planId))
    if (plan === null) throw new AgentRuntimeError('plan-not-found', 'approved plan was not found')
    validateFleetPlan(plan)
    return recoverInterrupted(config, plan, record)
  })
}

export function safeRuntimeError(error: unknown): { code: string; message: string } {
  const code = typeof (error as { code?: unknown }).code === 'string' && /^[a-z0-9-]+$/.test((error as { code: string }).code)
    ? (error as { code: string }).code
    : 'internal'
  const messages: Record<string, string> = {
    'unsupported-dsh-version': 'target DSH must be 0.1.0-rc.7 or a compatible pre-0.2 release',
    'already-aligned': 'plugin is already aligned',
    'plugin-not-targeted': 'plugin is not targeted to this device',
    'plan-not-found': 'approved plan was not found',
    'approval-mismatch': 'approval no longer matches current target state',
    'plan-expired': 'plan has expired',
    'approval-expired': 'approval has expired',
    'command-failed': 'controlled DSH command failed',
    'command-timeout': 'controlled DSH command exceeded its timeout',
    'agent-busy': 'another fleet action is already running for this profile',
    'health-timeout': 'DSH did not become healthy before timeout',
    'plugin-not-active': 'plugin did not become active; profile was rolled back',
  }
  return { code, message: messages[code] ?? 'fleet agent request failed' }
}

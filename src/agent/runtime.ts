import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { link, lstat, mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { parseFleetManifest } from '../host/core.ts'
import type { FleetManifest } from '../shared.ts'
import { assertMutationReadyConfig, type FleetAgentConfig } from './config.ts'
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
const TERMINATION_GRACE_MS = 2000
const TERMINATION_CONFIRM_MS = 5000

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
  profileSnapshot: ProfileSnapshot
  dshVersion: string
}

interface RunOptions {
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
  allowFailure?: boolean
  cwd?: string
  ignoreOutput?: boolean
  signal?: AbortSignal | undefined
}

type ProfileFiles = Record<(typeof SNAPSHOT_FILES)[number], string | null>

interface ProfileSnapshot {
  directoryPresent: boolean
  files: ProfileFiles
  hash: string
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
  const path = [...new Set([
    dirname(config.pnpmBinary),
    dirname(config.dshBinary),
    dirname(process.execPath),
    '/opt/homebrew/bin',
    '/usr/bin',
    '/bin',
  ])].join(':')
  const env: NodeJS.ProcessEnv = {}
  for (const key of ['HOME', 'USER', 'LOGNAME', 'TMPDIR', 'LANG', 'LC_ALL', 'SHELL', 'TERM', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME']) {
    if (process.env[key] !== undefined) env[key] = process.env[key]
  }
  return { ...env, DSH_HOME: config.dshHome, PATH: path, GIT_TERMINAL_PROMPT: '0' }
}

function abortError(): AgentRuntimeError {
  return new AgentRuntimeError('agent-shutdown', 'fleet agent shutdown interrupted the controlled command')
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw abortError()
}

function processGroupIsAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0)
    return true
  } catch (error: unknown) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (predicate()) {
    if (Date.now() >= deadline) return false
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  return true
}

function runFile(file: string, args: string[], options: RunOptions = {}): Promise<{ stdout: string; stderr: string; code: number }> {
  throwIfAborted(options.signal)
  return new Promise((resolve, reject) => {
    const grouped = process.platform !== 'win32'
    const child = spawn(file, args, {
      stdio: options.ignoreOutput === true ? 'ignore' : ['ignore', 'pipe', 'pipe'],
      shell: false,
      detached: grouped,
      ...(options.env === undefined ? {} : { env: options.env }),
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    })
    let stdout = ''
    let stderr = ''
    let stdoutBytes = 0
    let stderrBytes = 0
    let settled = false
    let termination: AgentRuntimeError | null = null
    let closeCode: number | null = null
    let leaderClosed = false
    let resolveLeaderClosed: (() => void) | undefined
    const leaderClosedPromise = new Promise<void>(resolve => { resolveLeaderClosed = resolve })
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
      options.signal?.removeEventListener('abort', onAbort)
      action()
    }
    const terminate = (reason: AgentRuntimeError) => {
      if (termination !== null || settled) return
      termination = reason
      clearTimeout(timer)
      void (async () => {
        try {
          killTree('SIGTERM')
          const pid = child.pid
          const stoppedAfterTerm = grouped && pid !== undefined
            ? await waitUntil(() => processGroupIsAlive(pid), TERMINATION_GRACE_MS)
            : await waitUntil(() => !leaderClosed, TERMINATION_GRACE_MS)
          if (!stoppedAfterTerm) {
            killTree('SIGKILL')
            const stoppedAfterKill = grouped && pid !== undefined
              ? await waitUntil(() => processGroupIsAlive(pid), TERMINATION_CONFIRM_MS)
              : await waitUntil(() => !leaderClosed, TERMINATION_CONFIRM_MS)
            if (!stoppedAfterKill) {
              finish(() => reject(new AgentRuntimeError('command-cleanup-failed', 'controlled command process group could not be terminated')))
              return
            }
          }
          if (!leaderClosed) {
            await Promise.race([
              leaderClosedPromise,
              new Promise(resolve => setTimeout(resolve, TERMINATION_CONFIRM_MS)),
            ])
          }
          if (!leaderClosed) {
            finish(() => reject(new AgentRuntimeError('command-cleanup-failed', 'controlled command leader did not close after termination')))
            return
          }
          finish(() => reject(reason))
        } catch {
          finish(() => reject(new AgentRuntimeError('command-cleanup-failed', 'controlled command process group cleanup failed')))
        }
      })()
    }
    const onAbort = () => terminate(abortError())
    const timer = setTimeout(() => terminate(new AgentRuntimeError('command-timeout', 'controlled command exceeded its timeout')), options.timeoutMs ?? 120_000)
    timer.unref()
    options.signal?.addEventListener('abort', onAbort, { once: true })
    if (options.signal?.aborted === true) onAbort()
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      const bytes = Buffer.byteLength(chunk)
      if (stdoutBytes < MAX_OUTPUT_BYTES) {
        stdout += Buffer.from(chunk).subarray(0, Math.max(0, MAX_OUTPUT_BYTES - stdoutBytes)).toString('utf8')
      }
      stdoutBytes += bytes
      if (stdoutBytes > MAX_OUTPUT_BYTES) terminate(new AgentRuntimeError('command-output-limit', 'controlled command exceeded its output limit'))
    })
    child.stderr?.on('data', (chunk: string) => {
      const bytes = Buffer.byteLength(chunk)
      if (stderrBytes < MAX_OUTPUT_BYTES) {
        stderr += Buffer.from(chunk).subarray(0, Math.max(0, MAX_OUTPUT_BYTES - stderrBytes)).toString('utf8')
      }
      stderrBytes += bytes
      if (stderrBytes > MAX_OUTPUT_BYTES) terminate(new AgentRuntimeError('command-output-limit', 'controlled command exceeded its output limit'))
    })
    child.once('error', () => {
      leaderClosed = true
      resolveLeaderClosed?.()
      if (termination === null) finish(() => reject(new AgentRuntimeError('command-unavailable', 'required executable is unavailable')))
    })
    child.once('close', code => {
      leaderClosed = true
      closeCode = code
      resolveLeaderClosed?.()
      if (termination !== null) return
      if (grouped && child.pid !== undefined && processGroupIsAlive(child.pid)) {
        terminate(new AgentRuntimeError('command-descendant-leak', 'controlled command exited with a live process-group descendant'))
        return
      }
      const exitCode = closeCode ?? 1
      if (exitCode !== 0 && options.allowFailure !== true) {
        finish(() => reject(new AgentRuntimeError('command-failed', 'controlled command failed')))
      } else finish(() => resolve({ stdout, stderr, code: exitCode }))
    })
  })
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

interface RegularFileSnapshot {
  source: string
  dev: number
  ino: number
  mtimeMs: number
}

async function readRegularFileSnapshot(path: string): Promise<RegularFileSnapshot | null> {
  let handle
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    const info = await handle.stat()
    if (info.isSymbolicLink() || !info.isFile()) throw new AgentRuntimeError('unsafe-profile-file', 'profile state accepts regular files only')
    return { source: await handle.readFile('utf8'), dev: info.dev, ino: info.ino, mtimeMs: info.mtimeMs }
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') throw new AgentRuntimeError('unsafe-profile-file', 'profile state accepts regular files only')
    throw error
  } finally {
    await handle?.close()
  }
}

async function readRegularOptional(path: string): Promise<string | null> {
  return (await readRegularFileSnapshot(path))?.source ?? null
}

async function readProfileSnapshot(config: FleetAgentConfig): Promise<ProfileSnapshot> {
  const dir = profileDir(config)
  let directoryPresent = true
  try {
    const info = await lstat(dir)
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new AgentRuntimeError('unsafe-profile-directory', 'profile state accepts a regular directory only')
    }
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    directoryPresent = false
  }
  const files = {} as ProfileFiles
  for (const name of SNAPSHOT_FILES) files[name] = await readRegularOptional(join(dir, name))
  return { directoryPresent, files, hash: sha256(JSON.stringify(files)) }
}

export async function computeProfileHash(config: FleetAgentConfig): Promise<string> {
  return (await readProfileSnapshot(config)).hash
}

async function readDshVersion(config: FleetAgentConfig, signal?: AbortSignal): Promise<string> {
  const result = await runFile(config.dshBinary, ['--version'], { env: controlledEnv(config), timeoutMs: 10_000, signal })
  const version = result.stdout.trim()
  if (version.length === 0) throw new AgentRuntimeError('dsh-version-unavailable', 'DSH version is unavailable')
  return version
}

async function loadState(config: FleetAgentConfig, signal?: AbortSignal): Promise<LoadedState> {
  throwIfAborted(signal)
  const manifestSource = await readFile(config.manifestPath, 'utf8')
  const manifest = parseFleetManifest(manifestSource)
  const profile = await readProfileSnapshot(config)
  const profileSource = profile.files['package.json']
  const parsed = profileSource === null ? {} : JSON.parse(profileSource) as ProfileManifest
  return {
    manifest,
    manifestDigest: sha256(manifestSource),
    dependencies: parsed.dependencies ?? {},
    profileHash: profile.hash,
    profileSnapshot: profile,
    dshVersion: await readDshVersion(config, signal),
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
  const directory = dirname(path)
  await ensureDurableDirectory(directory)
  const temporary = path + '.' + randomUUID() + '.tmp'
  let handle
  try {
    handle = await open(temporary, 'wx', 0o600)
    await handle.writeFile(JSON.stringify(value, null, 2) + '\n')
    await handle.sync()
    await handle.close()
    handle = undefined
    await rename(temporary, path)
    await syncDirectory(directory)
  } catch (error: unknown) {
    await handle?.close()
    await rm(temporary, { force: true })
    throw error
  }
}

async function readJson<T>(path: string): Promise<T | null> {
  const source = await readRegularOptional(path)
  return source === null ? null : JSON.parse(source) as T
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function ensureDurableDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 })
  await syncDirectory(path)
  const parent = dirname(path)
  if (parent !== path) await syncDirectory(parent)
}

async function durableWriteFile(path: string, source: string): Promise<void> {
  const directory = dirname(path)
  await ensureDurableDirectory(directory)
  const handle = await open(path, 'wx', 0o600)
  try {
    await handle.writeFile(source)
    await handle.sync()
  } finally {
    await handle.close()
  }
  await syncDirectory(directory)
}

async function audit(config: FleetAgentConfig, event: Record<string, unknown>): Promise<void> {
  await ensureDurableDirectory(config.stateDir)
  const handle = await open(join(config.stateDir, 'audit.jsonl'), 'a', 0o600)
  try {
    await handle.writeFile(JSON.stringify({
      eventId: randomUUID(),
      at: new Date().toISOString(),
      deviceId: config.deviceId,
      ...event,
    }) + '\n')
    await handle.sync()
  } finally {
    await handle.close()
  }
  await syncDirectory(config.stateDir)
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
  await ensureDurableDirectory(lockDir)
  const identity = sha256(config.dshHome + '\0' + config.profile)
  const lockPath = join(lockDir, identity + '.lock')
  const token = randomUUID()
  for (;;) {
    try {
      const handle = await open(lockPath, 'wx', 0o600)
      try {
        await handle.writeFile(JSON.stringify({ token, pid: process.pid, createdAt: new Date().toISOString() }) + '\n')
        await handle.sync()
      } finally {
        await handle.close()
      }
      await syncDirectory(lockDir)
      break
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      let owner: { token?: unknown; pid?: unknown; createdAt?: unknown } | null = null
      let ageMs = 0
      let ownerSource: string | null = null
      let ownerIdentity: Pick<RegularFileSnapshot, 'dev' | 'ino'> | null = null
      try {
        const snapshot = await readRegularFileSnapshot(lockPath)
        if (snapshot === null) continue
        ageMs = Date.now() - snapshot.mtimeMs
        ownerSource = snapshot.source
        ownerIdentity = { dev: snapshot.dev, ino: snapshot.ino }
        owner = JSON.parse(ownerSource) as { token?: unknown; pid?: unknown; createdAt?: unknown }
      } catch (readError: unknown) {
        if ((readError as NodeJS.ErrnoException).code === 'ENOENT') continue
        if ((readError as NodeJS.ErrnoException).code === 'ELOOP') throw new AgentRuntimeError('unsafe-state-file', 'fleet lock must be a regular file')
        if (readError instanceof AgentRuntimeError) throw readError
      }
      const ownerPid = typeof owner?.pid === 'number' && Number.isSafeInteger(owner.pid) && owner.pid > 0 ? owner.pid : null
      const active = ownerPid !== null && await processIsAlive(ownerPid)
      if (active || (ownerPid === null && ageMs < 10_000)) {
        throw new AgentRuntimeError('agent-busy', 'another fleet action is already running for this profile')
      }
      if (ownerSource === null || ownerIdentity === null) throw new AgentRuntimeError('agent-busy', 'fleet lock ownership could not be verified')
      const oldToken = typeof owner?.token === 'string' && owner.token.length > 0 ? owner.token : ownerSource
      const claimPath = lockPath + '.reap-' + sha256(oldToken)
      try {
        await link(lockPath, claimPath)
      } catch (claimError: unknown) {
        if ((claimError as NodeJS.ErrnoException).code === 'ENOENT') continue
        if ((claimError as NodeJS.ErrnoException).code === 'EEXIST') {
          throw new AgentRuntimeError('agent-busy', 'another fleet agent is reclaiming a stale profile lock')
        }
        throw claimError
      }
      try {
        const claimed = await readRegularFileSnapshot(claimPath)
        const current = await readRegularFileSnapshot(lockPath)
        if (claimed === null || current === null ||
            claimed.dev !== ownerIdentity.dev || claimed.ino !== ownerIdentity.ino ||
            current.dev !== ownerIdentity.dev || current.ino !== ownerIdentity.ino) continue
        await rm(lockPath)
        await syncDirectory(lockDir)
      } finally {
        await rm(claimPath, { force: true })
        await syncDirectory(lockDir)
      }
    }
  }
  try {
    return await operation()
  } finally {
    try {
      const source = await readRegularOptional(lockPath)
      if (source !== null) {
        const owner = JSON.parse(source) as { token?: unknown }
        if (owner.token === token) {
          await rm(lockPath, { force: true })
          await syncDirectory(lockDir)
        }
      }
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

function transitionAction(record: AgentActionRecord, state: AgentActionState, fields: Partial<AgentActionRecord> = {}): AgentActionRecord {
  return { ...record, ...fields, state, updatedAt: new Date().toISOString() }
}

async function saveActionBestEffort(
  config: FleetAgentConfig,
  record: AgentActionRecord,
  state: AgentActionState,
  fields: Partial<AgentActionRecord> = {},
): Promise<{ record: AgentActionRecord; failed: boolean }> {
  const next = transitionAction(record, state, fields)
  try {
    await atomicJson(actionPath(config, record.planId), next)
    return { record: next, failed: false }
  } catch {
    return { record: next, failed: true }
  }
}

async function auditBestEffort(config: FleetAgentConfig, event: Record<string, unknown>): Promise<boolean> {
  try {
    await audit(config, event)
    return true
  } catch {
    return false
  }
}

async function snapshotProfile(config: FleetAgentConfig, plan: FleetPlan, profile: ProfileSnapshot): Promise<void> {
  if (profile.hash !== plan.profileHash) {
    throw new AgentRuntimeError('profile-snapshot-mismatch', 'profile snapshot does not match the approved plan')
  }
  const destination = join(config.stateDir, 'snapshots', plan.digest)
  await rm(destination, { recursive: true, force: true })
  await ensureDurableDirectory(destination)
  const present = {} as Record<(typeof SNAPSHOT_FILES)[number], boolean>
  for (const name of SNAPSHOT_FILES) {
    const source = profile.files[name]
    if (source !== null) {
      await durableWriteFile(join(destination, name), source)
      present[name] = true
    } else {
      present[name] = false
    }
  }
  if (profile.directoryPresent && (present['package.json'] !== true || present['pnpm-lock.yaml'] !== true)) {
    throw new AgentRuntimeError('profile-not-snapshotable', 'an existing profile requires package.json and pnpm-lock.yaml for rollback')
  }
  await atomicJson(join(destination, 'snapshot.json'), {
    planId: plan.planId,
    digest: plan.digest,
    manifestDigest: plan.manifestDigest,
    profileHash: plan.profileHash,
    profileDirectoryPresent: profile.directoryPresent,
    present,
  } satisfies SnapshotMetadata)
  await syncDirectory(destination)
}

async function restoreProfile(config: FleetAgentConfig, plan: FleetPlan): Promise<void> {
  const source = join(config.stateDir, 'snapshots', plan.digest)
  try {
    const info = await lstat(source)
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new AgentRuntimeError('unsafe-state-file', 'profile snapshot must be a regular directory')
    }
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new AgentRuntimeError('snapshot-missing', 'profile snapshot is unavailable')
    throw error
  }
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
    const files = {} as ProfileFiles
    for (const name of SNAPSHOT_FILES) files[name] = await readRegularOptional(join(source, name))
    if (sha256(JSON.stringify(files)) !== plan.profileHash || SNAPSHOT_FILES.some(name => files[name] !== null || metadata.present[name] !== false)) {
      throw new AgentRuntimeError('snapshot-mismatch', 'profile snapshot contents do not match the approved plan')
    }
    await rm(targetDir, { recursive: true, force: true })
    return
  }
  if (metadata.present['package.json'] !== true || metadata.present['pnpm-lock.yaml'] !== true) {
    throw new AgentRuntimeError('snapshot-mismatch', 'profile snapshot cannot rebuild the dependency tree')
  }
  const files = {} as ProfileFiles
  for (const name of SNAPSHOT_FILES) {
    files[name] = await readRegularOptional(join(source, name))
    if ((files[name] !== null) !== (metadata.present[name] === true)) {
      throw new AgentRuntimeError('snapshot-mismatch', 'profile snapshot file set does not match its metadata')
    }
  }
  if (sha256(JSON.stringify(files)) !== plan.profileHash) {
    throw new AgentRuntimeError('snapshot-mismatch', 'profile snapshot contents do not match the approved plan')
  }
  await mkdir(targetDir, { recursive: true, mode: 0o700 })
  for (const name of SNAPSHOT_FILES) {
    const destination = join(targetDir, name)
    await rm(destination, { force: true })
    const contents = files[name]
    if (contents !== null) await durableWriteFile(destination, contents)
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

async function restartDsh(config: FleetAgentConfig, signal?: AbortSignal): Promise<void> {
  assertMutationReadyConfig(config)
  throwIfAborted(signal)
  const env = controlledEnv(config)
  await runFile(config.restart.screenBinary, ['-S', config.restart.sessionName, '-X', 'quit'], {
    env,
    timeoutMs: 10_000,
    allowFailure: true,
    signal,
  })
  const listeners = await runFile(config.restart.lsofBinary, [
    '-nP', '-t', '-iTCP:' + String(config.restart.port), '-sTCP:LISTEN',
  ], { env, timeoutMs: 10_000, allowFailure: true, signal })
  const pids = listeners.stdout.trim() === '' ? [] : listeners.stdout.trim().split(/\s+/).map(value => Number(value))
  if (pids.some(pid => !Number.isSafeInteger(pid) || pid <= 0) || pids.length > 1) {
    throw new AgentRuntimeError('restart-owner-ambiguous', 'DSH restart found an ambiguous listener owner')
  }
  const listenerPid = pids[0]
  if (listenerPid !== undefined) {
    const owner = await runFile(config.restart.psBinary, ['-p', String(listenerPid), '-o', 'command='], {
      env,
      timeoutMs: 10_000,
      signal,
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
      throwIfAborted(signal)
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
    '-dmS', config.restart.sessionName,
    '/usr/bin/env', 'DSH_HOME=' + config.dshHome, 'PATH=' + env.PATH,
    config.dshBinary, 'web', '--host', config.restart.host, '--port', String(config.restart.port),
  ], { env, timeoutMs: 10_000, allowFailure: true, ignoreOutput: true, signal })
  if (start.code !== 0) throw new AgentRuntimeError('restart-failed', 'DSH restart failed')
}

async function waitForHttp(url: string, timeoutMs: number, signal?: AbortSignal): Promise<Response> {
  const deadline = Date.now() + timeoutMs
  let last: unknown
  while (Date.now() < deadline) {
    throwIfAborted(signal)
    try {
      const timeout = AbortSignal.timeout(Math.min(3000, Math.max(1, deadline - Date.now())))
      const requestSignal = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
      const response = await fetch(url, { signal: requestSignal })
      if (response.ok) return response
      last = response.status
    } catch (error: unknown) {
      throwIfAborted(signal)
      last = error
    }
    await new Promise(resolve => setTimeout(resolve, 350))
  }
  void last
  throw new AgentRuntimeError('health-timeout', 'DSH health endpoint did not recover before timeout')
}

async function verifyHealth(config: FleetAgentConfig, plan?: FleetPlan, signal?: AbortSignal): Promise<void> {
  assertMutationReadyConfig(config)
  await runFile(config.dshBinary, ['--profile', config.profile, '--dump-config'], {
    env: controlledEnv(config),
    timeoutMs: 20_000,
    signal,
  })
  if (plan !== undefined) {
    const source = await readRegularOptional(join(profileDir(config), 'package.json'))
    if (source === null) throw new AgentRuntimeError('profile-missing', 'DSH profile is missing after apply')
    const parsed = JSON.parse(source) as ProfileManifest
    if (parsed.dependencies?.[plan.pluginId] !== plan.exactToSpec) {
      throw new AgentRuntimeError('profile-mismatch', 'installed dependency does not match the approved plan')
    }
  }
  await waitForHttp(config.health.url, config.health.timeoutMs, signal)
  const endpoint = new URL('/dsh-fleet/status', config.health.url)
  const deadline = Date.now() + config.health.timeoutMs
  let targetPending = plan !== undefined
  let runtimeFailed = false
  while (Date.now() < deadline) {
    throwIfAborted(signal)
    const rpcId = 'fleet-agent-health-' + randomUUID()
    try {
      const timeout = AbortSignal.timeout(Math.min(3000, Math.max(1, deadline - Date.now())))
      const requestSignal = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId, method: 'status', payload: null }),
        signal: requestSignal,
      })
      if (response.ok) {
        const body = await response.json() as {
          rpcId?: unknown
          result?: {
            ok?: unknown
            value?: {
              summary?: { failed?: unknown }
              plugins?: Array<{ id?: unknown; state?: unknown }>
              runtime?: { failedModules?: unknown }
            }
          }
        }
        const failedModules = body.result?.value?.runtime?.failedModules
        runtimeFailed = Array.isArray(failedModules) && failedModules.length > 0
        const fleetHealthy = body.rpcId === rpcId && body.result?.ok === true &&
          body.result.value?.summary?.failed === 0 && Array.isArray(failedModules) && failedModules.length === 0
        const target = plan === undefined ? undefined : body.result?.value?.plugins?.find(item => item.id === plan.pluginId)
        targetPending = plan !== undefined && target?.state !== 'aligned'
        if (fleetHealthy && !targetPending) return
      }
    } catch {
      throwIfAborted(signal)
      // Startup is eventually consistent; retry until the bounded deadline.
    }
    await new Promise(resolve => setTimeout(resolve, 350))
  }
  if (runtimeFailed) throw new AgentRuntimeError('runtime-modules-failed', 'DSH Loader reports failed runtime modules')
  if (targetPending) throw new AgentRuntimeError('plugin-not-active', 'approved plugin did not become active')
  throw new AgentRuntimeError('fleet-rpc-unhealthy', 'Fleet RPC reported an unhealthy runtime')
}

function installArgument(plan: FleetPlan): string {
  return plan.pluginId + '@' + plan.exactToSpec
}

async function applyPackage(config: FleetAgentConfig, plan: FleetPlan, signal?: AbortSignal): Promise<void> {
  await runFile(config.pnpmBinary, ['--version'], { env: controlledEnv(config), timeoutMs: 10_000, signal })
  await runFile(config.dshBinary, [
    'plugin', '--profile', config.profile, 'add', installArgument(plan), '--save-exact', '--ignore-scripts',
  ], { env: controlledEnv(config), timeoutMs: 120_000, signal })
}

export async function inspectAgent(config: FleetAgentConfig, now = new Date(), signal?: AbortSignal): Promise<AgentInspection> {
  const state = await loadState(config, signal)
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

export async function createStoredPlan(config: FleetAgentConfig, pluginId: string, now = new Date(), signal?: AbortSignal): Promise<FleetPlan> {
  const state = await loadState(config, signal)
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
  let persistenceFailed = false
  let saved = await saveActionBestEffort(config, record, 'rollback', { errorCode: 'interrupted-action' })
  let current = saved.record
  persistenceFailed ||= saved.failed
  try {
    await restoreProfile(config, plan)
    saved = await saveActionBestEffort(config, current, 'rollback-restarting')
    current = saved.record
    persistenceFailed ||= saved.failed
    await restartDsh(config)
    saved = await saveActionBestEffort(config, current, 'rollback-verifying')
    current = saved.record
    persistenceFailed ||= saved.failed
    await verifyHealth(config)
    saved = await saveActionBestEffort(config, current, 'rolled-back', { result: 'rolled-back' })
    current = saved.record
    persistenceFailed ||= saved.failed
    persistenceFailed ||= !(await auditBestEffort(config, { type: 'capability/rolled-back', planId: plan.planId, result: 'interrupted-action' }))
    if (!persistenceFailed) return current
  } catch {
    // Fall through to the durable/manual terminal state below.
  }
  saved = await saveActionBestEffort(config, current, 'manual-intervention', {
    result: 'manual-intervention',
    errorCode: persistenceFailed ? 'state-persistence-failed' : 'rollback-failed',
  })
  current = saved.record
  await auditBestEffort(config, { type: 'capability/failed', planId: plan.planId, result: 'manual-intervention' })
  return current
}

async function applyStoredPlanLocked(
  config: FleetAgentConfig,
  approval: FleetPlanApproval,
  now: Date,
  signal?: AbortSignal,
): Promise<AgentActionRecord> {
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
  const currentState = await loadState(config, signal)
  if (currentState.manifestDigest !== plan.manifestDigest || currentState.profileHash !== plan.profileHash || currentState.dshVersion !== plan.observedDshVersion) {
    throw new FleetProtocolError('approval-mismatch', 'manifest, profile or DSH version changed after the plan was created')
  }
  await verifyHealth(config, undefined, signal)
  throwIfAborted(signal)
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
  throwIfAborted(signal)
  await snapshotProfile(config, plan, currentState.profileSnapshot)
  if (await computeProfileHash(config) !== plan.profileHash) {
    throw new FleetProtocolError('approval-mismatch', 'profile changed while the approved snapshot was being persisted')
  }
  let record = await saveAction(config, recordSeed, 'staged')
  await audit(config, { type: 'plan/approved', planId: plan.planId, approvalId: approval.approvalId, principalId: approval.principalId })
  try {
    throwIfAborted(signal)
    record = await saveAction(config, record, 'applying')
    if (await computeProfileHash(config) !== plan.profileHash) {
      throw new FleetProtocolError('approval-mismatch', 'profile changed immediately before the approved mutation')
    }
    await applyPackage(config, plan, signal)
    throwIfAborted(signal)
    record = await saveAction(config, record, 'restarting')
    await restartDsh(config, signal)
    throwIfAborted(signal)
    record = await saveAction(config, record, 'verifying')
    await verifyHealth(config, plan, signal)
    throwIfAborted(signal)
    await audit(config, { type: 'capability/applied', planId: plan.planId, pluginId: plan.pluginId, result: 'success' })
    record = await saveAction(config, record, 'succeeded', { result: 'success' })
    return record
  } catch (error: unknown) {
    const errorCode = typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : 'apply-failed'
    let persistenceFailed = false
    let saved = await saveActionBestEffort(config, record, 'rollback', { errorCode })
    record = saved.record
    persistenceFailed ||= saved.failed
    persistenceFailed ||= !(await auditBestEffort(config, {
      type: 'capability/failed', planId: plan.planId, pluginId: plan.pluginId, result: errorCode,
    }))
    if (errorCode === 'command-cleanup-failed') {
      saved = await saveActionBestEffort(config, record, 'manual-intervention', {
        result: 'manual-intervention',
        errorCode,
      })
      record = saved.record
      await auditBestEffort(config, { type: 'capability/failed', planId: plan.planId, result: 'manual-intervention' })
      return record
    }
    try {
      await restoreProfile(config, plan)
      saved = await saveActionBestEffort(config, record, 'rollback-restarting')
      record = saved.record
      persistenceFailed ||= saved.failed
      await restartDsh(config)
      saved = await saveActionBestEffort(config, record, 'rollback-verifying')
      record = saved.record
      persistenceFailed ||= saved.failed
      await verifyHealth(config)
      saved = await saveActionBestEffort(config, record, 'rolled-back', { result: 'rolled-back' })
      record = saved.record
      persistenceFailed ||= saved.failed
      persistenceFailed ||= !(await auditBestEffort(config, { type: 'capability/rolled-back', planId: plan.planId, result: errorCode }))
      if (!persistenceFailed) return record
    } catch {
      // Fall through to a best-effort manual terminal record.
    }
    saved = await saveActionBestEffort(config, record, 'manual-intervention', {
      result: 'manual-intervention',
      errorCode: persistenceFailed ? 'state-persistence-failed' : 'rollback-failed',
    })
    record = saved.record
    await auditBestEffort(config, { type: 'capability/failed', planId: plan.planId, result: 'manual-intervention' })
    return record
  }
}

export async function applyStoredPlan(
  config: FleetAgentConfig,
  approval: FleetPlanApproval,
  now = new Date(),
  signal?: AbortSignal,
): Promise<AgentActionRecord> {
  assertMutationReadyConfig(config)
  return withProfileLock(config, () => applyStoredPlanLocked(config, approval, now, signal))
}

export async function readOrRecoverAction(config: FleetAgentConfig, planId: string): Promise<AgentActionRecord | null> {
  return withProfileLock(config, async () => {
    const record = await readAction(config, planId)
    if (record === null || record.state === 'succeeded' || record.state === 'rolled-back' || record.state === 'manual-intervention') return record
    assertMutationReadyConfig(config)
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
    'command-output-limit': 'controlled DSH command exceeded its output limit',
    'command-descendant-leak': 'controlled command left a background descendant; the profile was rolled back',
    'command-cleanup-failed': 'controlled command process cleanup failed; manual intervention is required',
    'agent-shutdown': 'fleet agent shutdown interrupted the action',
    'agent-busy': 'another fleet action is already running for this profile',
    'unsafe-mutation-config': 'mutation requires restart and loopback Fleet RPC health verification',
    'health-timeout': 'DSH did not become healthy before timeout',
    'plugin-not-active': 'plugin did not become active; profile was rolled back',
    'runtime-modules-failed': 'DSH runtime has failed modules; profile was rolled back',
  }
  return { code, message: messages[code] ?? 'fleet agent request failed' }
}

import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { link, lstat, mkdir, open, readFile, realpath, rename, rm } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { digestInstalledArtifact } from '../host/artifacts.ts'
import { parseFleetManifest } from '../host/core.ts'
import type { FleetManifest } from '../shared.ts'
import {
  assertMutationReadyConfig,
  assertReleaseReadyConfig,
  type FleetAgentConfig,
  type ReleaseReadyFleetAgentConfig,
} from './config.ts'
import { createAgentPlan } from './planner.ts'
import {
  FleetProtocolError,
  validateFleetPlan,
  validateFleetPlanApproval,
  type FleetPlan,
  type FleetPlanApproval,
} from './protocol.ts'
import { createReleasePlan } from './release-planner.ts'
import {
  validateFleetAppliedRelease,
  validateFleetReleaseApproval,
  validateFleetReleasePlan,
  type FleetAppliedRelease,
  type FleetReleaseApproval,
  type FleetReleasePlan,
  type FleetReleasePluginBinding,
} from './release-protocol.ts'

const RUNTIME_MANIFEST_FILENAME = 'fleet.lock.yaml'
const SNAPSHOT_FILES = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'cordis.patch.yml', RUNTIME_MANIFEST_FILENAME] as const
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

export interface ReleaseAgentInspection {
  protocolVersion: 1
  kind: 'profile-release'
  deviceId: string
  profile: string
  dshVersion: string
  manifestDigest: string
  profileHash: string
  currentRelease: Pick<FleetAppliedRelease, 'releaseId' | 'releaseVersion' | 'releaseDigest'> | null
  assignedRelease: { releaseId: string; releaseVersion: string; releaseDigest: string }
  changes: FleetReleasePlan['changes']
  tasks: { enabled: boolean; workspaceIds: string[]; profiles: string[] }
}

export interface ReleaseActionRecord {
  planId: string
  planDigest: string
  approvalId: string
  principalId: string
  idempotencyKey: string
  deviceId: string
  profile: string
  releaseId: string
  releaseVersion: string
  releaseDigest: string
  stageProfile: string
  backupProfile: string
  state: AgentActionState
  updatedAt: string
  result?: 'success' | 'rolled-back' | 'manual-intervention'
  errorCode?: string
}

interface ProfileManifest {
  dependencies?: Record<string, string>
  dsh?: { profile?: { bundles?: string[] } }
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
  allowDescendants?: boolean
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

function runtimeManifestPath(config: FleetAgentConfig): string {
  return join(profileDir(config), RUNTIME_MANIFEST_FILENAME)
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
  return {
    ...env,
    DSH_HOME: config.dshHome,
    PATH: path,
    GIT_TERMINAL_PROMPT: '0',
    npm_config_ignore_scripts: 'true',
    PNPM_CONFIG_IGNORE_SCRIPTS: 'true',
  }
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
      if (options.allowDescendants !== true && grouped && child.pid !== undefined && processGroupIsAlive(child.pid)) {
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

async function listenerPids(config: FleetAgentConfig, port: number, signal?: AbortSignal): Promise<number[]> {
  if (config.restart.kind === 'none') return []
  const listeners = await runFile(config.restart.lsofBinary, [
    '-nP', '-t', '-iTCP:' + String(port), '-sTCP:LISTEN',
  ], { env: controlledEnv(config), timeoutMs: 10_000, allowFailure: true, signal })
  const pids = listeners.stdout.trim() === '' ? [] : listeners.stdout.trim().split(/\s+/).map(value => Number(value))
  if (pids.some(pid => !Number.isSafeInteger(pid) || pid <= 0) || pids.length > 1) {
    throw new AgentRuntimeError('restart-owner-ambiguous', 'DSH restart found an ambiguous listener owner')
  }
  return pids
}

async function verifyListenerOwner(config: FleetAgentConfig, pid: number, port: number, signal?: AbortSignal): Promise<void> {
  if (config.restart.kind === 'none') throw new AgentRuntimeError('unsafe-mutation-config', 'restart owner is not configured')
  const owner = await runFile(config.restart.psBinary, ['-p', String(pid), '-o', 'command='], {
    env: controlledEnv(config),
    timeoutMs: 10_000,
    signal,
  })
  const command = owner.stdout.trim()
  const hasOwnerMarker = config.restart.ownerMarkers.some(marker => command.includes(marker))
  const isMainPort = port === config.restart.port
  const hasWebToken = /(?:^|\s)web(?:\s|$)/.test(command)
  const hasPort = command.includes('--port ' + String(config.restart.port))
  if (!hasOwnerMarker || (isMainPort && (!hasWebToken || !hasPort))) {
    throw new AgentRuntimeError('restart-owner-mismatch', 'configured port is not owned by a recognizable DSH process')
  }
}

async function stopDsh(config: FleetAgentConfig, signal?: AbortSignal): Promise<void> {
  assertMutationReadyConfig(config)
  throwIfAborted(signal)
  const env = controlledEnv(config)
  const ports = config.restart.managedPorts ?? [config.restart.port]
  const owners = new Map<number, number>()
  for (const port of ports) {
    const pid = (await listenerPids(config, port, signal))[0]
    if (pid !== undefined) {
      await verifyListenerOwner(config, pid, port, signal)
      owners.set(port, pid)
    }
  }
  if (config.restart.kind === 'screen') {
    await runFile(config.restart.screenBinary, ['-S', config.restart.sessionName, '-X', 'quit'], {
      env,
      timeoutMs: 10_000,
      allowFailure: true,
      signal,
    })
  } else {
    await runFile(config.restart.launchctlBinary, ['kill', 'SIGTERM', config.restart.serviceTarget], {
      env,
      timeoutMs: 10_000,
      allowFailure: owners.size === 0,
      signal,
    })
  }
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    throwIfAborted(signal)
    const active = (await Promise.all(ports.map(port => listenerPids(config, port, signal)))).flat()
    if (active.length === 0) return
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  if (config.restart.kind === 'screen') {
    for (const pid of new Set(owners.values())) {
      try { process.kill(pid, 'SIGTERM') } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
      }
    }
    await new Promise(resolve => setTimeout(resolve, 500))
    for (const pid of new Set(owners.values())) {
      if (await processIsAlive(pid)) {
        try { process.kill(pid, 'SIGKILL') } catch (error: unknown) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
        }
      }
    }
    const active = (await Promise.all(ports.map(port => listenerPids(config, port, signal)))).flat()
    if (active.length === 0) return
  }
  throw new AgentRuntimeError('restart-cleanup-failed', 'managed DSH listeners did not exit cleanly')
}

async function startDsh(config: FleetAgentConfig, signal?: AbortSignal): Promise<void> {
  assertMutationReadyConfig(config)
  throwIfAborted(signal)
  const env = controlledEnv(config)
  if (config.restart.kind === 'screen') {
    const start = await runFile(config.restart.screenBinary, [
      '-dmS', config.restart.sessionName,
      '/usr/bin/env', 'DSH_HOME=' + config.dshHome, 'PATH=' + env.PATH,
      config.dshBinary, 'web', '--host', config.restart.host, '--port', String(config.restart.port),
    ], { env, timeoutMs: 10_000, allowFailure: true, allowDescendants: true, ignoreOutput: true, signal })
    if (start.code !== 0) throw new AgentRuntimeError('restart-failed', 'DSH restart failed')
    return
  }
  await runFile(config.restart.launchctlBinary, ['kickstart', config.restart.serviceTarget], {
    env,
    timeoutMs: 10_000,
    signal,
  })
}

async function restartDsh(config: FleetAgentConfig, signal?: AbortSignal): Promise<void> {
  await stopDsh(config, signal)
  await startDsh(config, signal)
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

async function verifyHealth(
  config: FleetAgentConfig,
  plan?: FleetPlan,
  signal?: AbortSignal,
  expectedPluginIds: readonly string[] = [],
  expectedManifestPath?: string,
): Promise<void> {
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
  const targetIds = plan === undefined ? [...expectedPluginIds] : [plan.pluginId]
  let targetPending = targetIds.length > 0
  let runtimeFailed = false
  let manifestPathMismatch = false
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
              manifest?: { path?: unknown }
              summary?: { failed?: unknown }
              plugins?: Array<{ id?: unknown; state?: unknown }>
              runtime?: { failedModules?: unknown }
            }
          }
        }
        const failedModules = body.result?.value?.runtime?.failedModules
        runtimeFailed = Array.isArray(failedModules) && failedModules.length > 0
        const runtimeHealthy = (Array.isArray(failedModules) && failedModules.length === 0) ||
          (failedModules === undefined && targetIds.length === 0)
        manifestPathMismatch = expectedManifestPath !== undefined && body.result?.value?.manifest?.path !== expectedManifestPath
        const fleetHealthy = body.rpcId === rpcId && body.result?.ok === true &&
          body.result.value?.summary?.failed === 0 && runtimeHealthy && !manifestPathMismatch
        const plugins = body.result?.value?.plugins ?? []
        targetPending = targetIds.some(id => plugins.find(item => item.id === id)?.state !== 'aligned')
        if (fleetHealthy && !targetPending) return
      }
    } catch {
      throwIfAborted(signal)
      // Startup is eventually consistent; retry until the bounded deadline.
    }
    await new Promise(resolve => setTimeout(resolve, 350))
  }
  if (runtimeFailed) throw new AgentRuntimeError('runtime-modules-failed', 'DSH Loader reports failed runtime modules')
  if (manifestPathMismatch) throw new AgentRuntimeError('fleet-runtime-manifest-path-mismatch', 'Fleet runtime is not bound to the profile-local manifest')
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

function releasePlanPath(config: FleetAgentConfig, planId: string): string {
  if (!/^release-plan:[0-9a-f]{64}$/.test(planId)) throw new AgentRuntimeError('invalid-plan-id', 'release plan id is invalid')
  return join(config.stateDir, 'release-plans', planId.slice('release-plan:'.length) + '.json')
}

function releaseActionPath(config: FleetAgentConfig, planId: string): string {
  if (!/^release-plan:[0-9a-f]{64}$/.test(planId)) throw new AgentRuntimeError('invalid-plan-id', 'release plan id is invalid')
  return join(config.stateDir, 'release-actions', planId.slice('release-plan:'.length) + '.json')
}

function appliedReleasePath(config: FleetAgentConfig): string {
  return join(config.stateDir, 'releases', config.profile + '.json')
}

function releaseProfileNames(plan: FleetReleasePlan): { stageProfile: string; backupProfile: string; failedProfile: string } {
  const suffix = plan.digest.slice(0, 24)
  return {
    stageProfile: 'fleet-stage-' + suffix,
    backupProfile: 'fleet-backup-' + suffix,
    failedProfile: 'fleet-failed-' + suffix,
  }
}

async function regularDirectoryExists(path: string): Promise<boolean> {
  try {
    const info = await lstat(path)
    if (info.isSymbolicLink() || !info.isDirectory()) throw new AgentRuntimeError('unsafe-profile-directory', 'release swap paths must be regular directories')
    return true
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

export async function readAppliedRelease(config: FleetAgentConfig): Promise<FleetAppliedRelease | null> {
  const value = await readJson<FleetAppliedRelease>(appliedReleasePath(config))
  if (value === null) return null
  validateFleetAppliedRelease(value)
  if (value.deviceId !== config.deviceId || value.profile !== config.profile) {
    throw new AgentRuntimeError('applied-release-mismatch', 'applied release identity does not match this Agent')
  }
  return value
}

async function currentArtifactDigests(
  config: ReleaseReadyFleetAgentConfig,
  state: LoadedState,
): Promise<Record<string, string>> {
  const releaseId = state.manifest.v2?.assignments[config.deviceId]?.[config.profile]
  const release = releaseId === undefined ? undefined : state.manifest.v2?.profileReleases[releaseId]
  const entries = await Promise.all((release?.plugins ?? []).filter(plugin => plugin.source.kind === 'artifact').map(async plugin => {
    const actualSpec = state.dependencies[plugin.id]
    if (actualSpec === undefined) return null
    const digest = await digestInstalledArtifact(profileDir(config), config.artifactStore, actualSpec)
    return digest === undefined ? null : [plugin.id, digest] as const
  }))
  return Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => entry !== null))
}

async function buildReleasePlan(
  config: ReleaseReadyFleetAgentConfig,
  now: Date,
  signal?: AbortSignal,
): Promise<{ plan: FleetReleasePlan; state: LoadedState; appliedRelease: FleetAppliedRelease | null }> {
  const state = await loadState(config, signal)
  const appliedRelease = await readAppliedRelease(config)
  const runtimeManifestSource = state.profileSnapshot.files[RUNTIME_MANIFEST_FILENAME]
  const plan = createReleasePlan({
    manifest: state.manifest,
    manifestDigest: state.manifestDigest,
    runtimeManifestDigest: runtimeManifestSource === null ? null : sha256(runtimeManifestSource),
    dependencies: state.dependencies,
    artifactDigests: await currentArtifactDigests(config, state),
    appliedRelease,
    profileHash: state.profileHash,
    observedDshVersion: state.dshVersion,
    now,
    deviceId: config.deviceId,
    profile: config.profile,
    planTtlMs: config.planTtlMs,
  })
  return { plan, state, appliedRelease }
}

export async function inspectReleaseAgent(
  config: FleetAgentConfig,
  now = new Date(),
  signal?: AbortSignal,
): Promise<ReleaseAgentInspection> {
  assertReleaseReadyConfig(config)
  const { plan, appliedRelease } = await buildReleasePlan(config, now, signal)
  return {
    protocolVersion: 1,
    kind: 'profile-release',
    deviceId: plan.deviceId,
    profile: plan.profile,
    dshVersion: plan.observedDshVersion,
    manifestDigest: plan.manifestDigest,
    profileHash: plan.profileHash,
    currentRelease: appliedRelease === null ? null : {
      releaseId: appliedRelease.releaseId,
      releaseVersion: appliedRelease.releaseVersion,
      releaseDigest: appliedRelease.releaseDigest,
    },
    assignedRelease: {
      releaseId: plan.releaseId,
      releaseVersion: plan.releaseVersion,
      releaseDigest: plan.releaseDigest,
    },
    changes: plan.changes,
    tasks: {
      enabled: config.tasks?.enabled === true && config.a2a !== undefined,
      workspaceIds: Object.keys(config.tasks?.workspaces ?? {}).sort(),
      profiles: [...(config.tasks?.profiles ?? [])].sort(),
    },
  }
}

export async function verifyReleaseAgentHealth(
  config: FleetAgentConfig,
  signal?: AbortSignal,
): Promise<void> {
  assertReleaseReadyConfig(config)
  await verifyHealth(config, undefined, signal, [], runtimeManifestPath(config))
}

export async function createStoredReleasePlan(
  config: FleetAgentConfig,
  now = new Date(),
  signal?: AbortSignal,
): Promise<FleetReleasePlan> {
  assertReleaseReadyConfig(config)
  const { plan } = await buildReleasePlan(config, now, signal)
  await atomicJson(releasePlanPath(config, plan.planId), plan)
  await audit(config, {
    type: 'profile-release/plan-created',
    planId: plan.planId,
    releaseId: plan.releaseId,
    releaseVersion: plan.releaseVersion,
    changes: plan.changes.map(change => ({ pluginId: change.pluginId, action: change.action })),
  })
  return plan
}

async function readReleaseAction(config: FleetAgentConfig, planId: string): Promise<ReleaseActionRecord | null> {
  return readJson<ReleaseActionRecord>(releaseActionPath(config, planId))
}

async function saveReleaseAction(
  config: FleetAgentConfig,
  record: ReleaseActionRecord,
  state: AgentActionState,
  fields: Partial<ReleaseActionRecord> = {},
): Promise<ReleaseActionRecord> {
  const next = { ...record, ...fields, state, updatedAt: new Date().toISOString() }
  await atomicJson(releaseActionPath(config, record.planId), next)
  return next
}

async function saveReleaseActionBestEffort(
  config: FleetAgentConfig,
  record: ReleaseActionRecord,
  state: AgentActionState,
  fields: Partial<ReleaseActionRecord> = {},
): Promise<{ record: ReleaseActionRecord; failed: boolean }> {
  const next = { ...record, ...fields, state, updatedAt: new Date().toISOString() }
  try {
    await atomicJson(releaseActionPath(config, record.planId), next)
    return { record: next, failed: false }
  } catch {
    return { record: next, failed: true }
  }
}

function configForProfile(config: ReleaseReadyFleetAgentConfig, profile: string): ReleaseReadyFleetAgentConfig {
  return { ...config, profile }
}

async function resolveReleaseArtifact(
  config: ReleaseReadyFleetAgentConfig,
  plugin: FleetReleasePluginBinding,
  signal?: AbortSignal,
): Promise<string> {
  if (plugin.sourceKind !== 'artifact' || plugin.artifactDigest === null || plugin.packageVersion === null) {
    throw new AgentRuntimeError('artifact-binding-invalid', 'private artifact binding is incomplete')
  }
  const path = join(config.artifactStore, plugin.artifactDigest + '.tgz')
  const actualDigest = await digestInstalledArtifact(profileDir(config), config.artifactStore, 'file:' + path)
  if (actualDigest !== plugin.artifactDigest) {
    throw new AgentRuntimeError('artifact-digest-mismatch', 'private artifact is missing or does not match its approved digest')
  }
  const extracted = await runFile(config.tarBinary, ['-xOf', path, 'package/package.json'], {
    env: controlledEnv(config),
    timeoutMs: 20_000,
    signal,
  })
  let manifest: { name?: unknown; version?: unknown; dsh?: { bundle?: { patch?: unknown } } }
  try {
    manifest = JSON.parse(extracted.stdout) as typeof manifest
  } catch {
    throw new AgentRuntimeError('artifact-manifest-invalid', 'private artifact package manifest is invalid')
  }
  if (manifest.name !== plugin.pluginId || manifest.version !== plugin.packageVersion || typeof manifest.dsh?.bundle?.patch !== 'string') {
    throw new AgentRuntimeError('artifact-identity-mismatch', 'private artifact package identity, version or DSH bundle metadata does not match the release')
  }
  return path
}

async function releaseInstallArgument(
  config: ReleaseReadyFleetAgentConfig,
  plugin: FleetReleasePluginBinding,
  signal?: AbortSignal,
): Promise<string> {
  if (plugin.sourceKind === 'artifact') return resolveReleaseArtifact(config, plugin, signal)
  return plugin.pluginId + '@' + plugin.exactSpec
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function npmLockBindsIntegrity(lockSource: string, plugin: FleetReleasePluginBinding): boolean {
  if (plugin.sourceKind !== 'npm' || plugin.integrity === null || plugin.packageVersion === null) return false
  let lock: Record<string, unknown> | null
  try {
    lock = objectValue(parseYaml(lockSource) as unknown)
  } catch {
    return false
  }
  const importers = objectValue(lock?.importers)
  const rootImporter = objectValue(importers?.['.'])
  const dependencyGroups = ['dependencies', 'optionalDependencies', 'devDependencies']
  let dependency: Record<string, unknown> | null = null
  for (const group of dependencyGroups) {
    const candidate = objectValue(objectValue(rootImporter?.[group])?.[plugin.pluginId])
    if (candidate !== null) {
      dependency = candidate
      break
    }
  }
  if (dependency?.specifier !== plugin.exactSpec || typeof dependency.version !== 'string') return false
  const lockedVersion = dependency.version
  if (lockedVersion !== plugin.packageVersion && !lockedVersion.startsWith(plugin.packageVersion + '(')) return false
  const packages = objectValue(lock?.packages)
  if (packages === null) return false
  const expectedKey = plugin.pluginId + '@' + lockedVersion
  for (const [rawKey, value] of Object.entries(packages)) {
    const key = rawKey.startsWith('/') ? rawKey.slice(1) : rawKey
    if (key !== expectedKey) continue
    const resolution = objectValue(objectValue(value)?.resolution)
    return resolution?.integrity === plugin.integrity
  }
  return false
}

async function verifyReleaseProfileFiles(
  config: ReleaseReadyFleetAgentConfig,
  plan: FleetReleasePlan,
  profile: string,
): Promise<void> {
  const targetConfig = configForProfile(config, profile)
  const runtimeManifestSource = await readRegularOptional(runtimeManifestPath(targetConfig))
  if (runtimeManifestSource === null || sha256(runtimeManifestSource) !== plan.manifestDigest) {
    throw new AgentRuntimeError('release-runtime-manifest-mismatch', 'release profile does not contain the approved Fleet runtime manifest')
  }
  parseFleetManifest(runtimeManifestSource)
  const source = await readRegularOptional(join(profileDir(targetConfig), 'package.json'))
  if (source === null) throw new AgentRuntimeError('profile-missing', 'staged release profile is missing')
  const parsed = JSON.parse(source) as ProfileManifest
  const dependencies = parsed.dependencies ?? {}
  const bundles = parsed.dsh?.profile?.bundles ?? []
  const lockSource = await readRegularOptional(join(profileDir(targetConfig), 'pnpm-lock.yaml'))
  if (lockSource === null) throw new AgentRuntimeError('profile-lock-missing', 'release profile lockfile is missing')
  const materializedProfileRoot = await realpath(profileDir(targetConfig))
  for (const plugin of plan.plugins) {
    const actualSpec = dependencies[plugin.pluginId]
    if (actualSpec === undefined || !bundles.includes(plugin.pluginId)) {
      throw new AgentRuntimeError('release-profile-mismatch', 'release plugin is missing from dependencies or DSH bundles')
    }
    if (plugin.sourceKind === 'artifact') {
      const digest = await digestInstalledArtifact(profileDir(targetConfig), config.artifactStore, actualSpec)
      if (digest !== plugin.artifactDigest) throw new AgentRuntimeError('artifact-digest-mismatch', 'materialized private artifact digest does not match the release')
    } else if (actualSpec !== plugin.exactSpec) {
      throw new AgentRuntimeError('release-profile-mismatch', 'materialized public plugin spec does not match the release')
    }
    if (plugin.sourceKind === 'npm' && !npmLockBindsIntegrity(lockSource, plugin)) {
      throw new AgentRuntimeError('npm-integrity-mismatch', 'pnpm lockfile does not contain the approved npm integrity')
    }
    let materializedPath: string
    try {
      materializedPath = await realpath(join(materializedProfileRoot, 'node_modules', plugin.pluginId))
    } catch {
      throw new AgentRuntimeError('release-profile-materialization-missing', 'release plugin is missing from the materialized dependency tree')
    }
    const materializedRelative = relative(materializedProfileRoot, materializedPath)
    if (materializedRelative === '' || materializedRelative === '..' || materializedRelative.startsWith('..' + sep) || isAbsolute(materializedRelative)) {
      throw new AgentRuntimeError('release-profile-external-link', 'release plugin resolves outside the staged profile')
    }
    const materializedManifest = await readRegularOptional(join(materializedPath, 'package.json'))
    if (materializedManifest === null) {
      throw new AgentRuntimeError('release-profile-materialization-missing', 'release plugin package metadata is missing')
    }
    const materialized = JSON.parse(materializedManifest) as { name?: unknown; version?: unknown }
    if (materialized.name !== plugin.pluginId || (plugin.packageVersion !== null && materialized.version !== plugin.packageVersion)) {
      throw new AgentRuntimeError('release-profile-materialization-mismatch', 'materialized release plugin identity does not match the approved release')
    }
  }
  for (const change of plan.changes.filter(change => change.action === 'remove')) {
    if (dependencies[change.pluginId] !== undefined || bundles.includes(change.pluginId)) {
      throw new AgentRuntimeError('release-profile-mismatch', 'retired release plugin remains in the staged profile')
    }
  }
  await runFile(config.dshBinary, ['--profile', profile, '--dump-config'], {
    env: controlledEnv(config),
    timeoutMs: 20_000,
  })
}

async function removeChangedReleaseBindings(
  config: ReleaseReadyFleetAgentConfig,
  plan: FleetReleasePlan,
): Promise<void> {
  const removedIds = new Set(plan.changes
    .filter(change => change.action === 'remove' || change.action === 'update')
    .map(change => change.pluginId))
  if (removedIds.size === 0) return
  const packagePath = join(profileDir(config), 'package.json')
  const source = await readRegularOptional(packagePath)
  if (source === null) throw new AgentRuntimeError('profile-missing', 'staged release profile is missing')
  const parsed = JSON.parse(source) as ProfileManifest & Record<string, unknown>
  const dependencies = parsed.dependencies ?? {}
  for (const id of removedIds) delete dependencies[id]
  parsed.dependencies = dependencies
  const profile = parsed.dsh?.profile
  if (profile !== undefined) profile.bundles = (profile.bundles ?? []).filter(id => !removedIds.has(id))
  await rm(packagePath, { force: true })
  await durableWriteFile(packagePath, JSON.stringify(parsed, null, 2) + '\n')
}

async function stageRelease(
  config: ReleaseReadyFleetAgentConfig,
  plan: FleetReleasePlan,
  snapshot: ProfileSnapshot,
  signal?: AbortSignal,
): Promise<void> {
  if (!snapshot.directoryPresent || snapshot.files['package.json'] === null || snapshot.files['pnpm-lock.yaml'] === null) {
    throw new AgentRuntimeError('profile-not-stageable', 'atomic release requires an existing profile with package.json and pnpm-lock.yaml')
  }
  const { stageProfile } = releaseProfileNames(plan)
  const stageConfig = configForProfile(config, stageProfile)
  const stageDir = profileDir(stageConfig)
  await rm(stageDir, { recursive: true, force: true })
  await ensureDurableDirectory(stageDir)
  for (const name of SNAPSHOT_FILES) {
    const source = snapshot.files[name]
    if (source !== null) await durableWriteFile(join(stageDir, name), source)
  }
  if (await computeProfileHash(stageConfig) !== plan.profileHash) {
    throw new AgentRuntimeError('profile-stage-mismatch', 'staged profile does not match the approved source profile')
  }
  const runtimeManifestSource = await readRegularOptional(config.manifestPath)
  if (runtimeManifestSource === null || sha256(runtimeManifestSource) !== plan.manifestDigest) {
    throw new AgentRuntimeError('release-runtime-manifest-mismatch', 'approved Fleet runtime manifest is missing or changed')
  }
  await rm(runtimeManifestPath(stageConfig), { force: true })
  await durableWriteFile(runtimeManifestPath(stageConfig), runtimeManifestSource)
  await runFile(config.pnpmBinary, ['--version'], { env: controlledEnv(config), timeoutMs: 10_000, signal })
  await removeChangedReleaseBindings(stageConfig, plan)
  if (plan.changes.some(change => change.action === 'remove' || change.action === 'update')) {
    await runFile(config.pnpmBinary, ['install', '--lockfile-only', '--ignore-scripts'], {
      cwd: stageDir,
      env: controlledEnv(config),
      timeoutMs: 120_000,
      signal,
    })
  }
  const bindings = new Map(plan.plugins.map(plugin => [plugin.pluginId, plugin]))
  for (const change of plan.changes) {
    throwIfAborted(signal)
    if (change.action === 'remove') continue
    const plugin = bindings.get(change.pluginId)
    if (plugin === undefined) throw new AgentRuntimeError('release-plan-invalid', 'release change has no final plugin binding')
    const argument = await releaseInstallArgument(config, plugin, signal)
    await runFile(config.dshBinary, [
      'plugin', '--profile', stageProfile, 'add', argument, '--save-exact', '--ignore-scripts',
    ], { env: controlledEnv(config), timeoutMs: 120_000, signal })
  }
  await runFile(config.pnpmBinary, ['install', '--frozen-lockfile', '--ignore-scripts'], {
    cwd: stageDir,
    env: controlledEnv(config),
    timeoutMs: 120_000,
    signal,
  })
  await verifyReleaseProfileFiles(config, plan, stageProfile)
}

async function ensureServiceStarted(config: ReleaseReadyFleetAgentConfig): Promise<void> {
  const running = (await listenerPids(config, config.restart.port))[0] !== undefined
  if (!running) await startDsh(config)
}

async function swapStagedRelease(config: ReleaseReadyFleetAgentConfig, plan: FleetReleasePlan, signal?: AbortSignal): Promise<void> {
  const names = releaseProfileNames(plan)
  const profilesRoot = dirname(profileDir(config))
  const liveDir = profileDir(config)
  const stageDir = join(profilesRoot, names.stageProfile)
  const backupDir = join(profilesRoot, names.backupProfile)
  if (!await regularDirectoryExists(stageDir)) throw new AgentRuntimeError('release-stage-missing', 'staged release directory is missing')
  await rm(backupDir, { recursive: true, force: true })
  await stopDsh(config, signal)
  throwIfAborted(signal)
  await rename(liveDir, backupDir)
  await syncDirectory(profilesRoot)
  try {
    await rename(stageDir, liveDir)
    await syncDirectory(profilesRoot)
  } catch (error: unknown) {
    await rename(backupDir, liveDir)
    await syncDirectory(profilesRoot)
    await startDsh(config)
    throw error
  }
}

async function persistAppliedRelease(config: FleetAgentConfig, plan: FleetReleasePlan): Promise<FleetAppliedRelease> {
  const applied: FleetAppliedRelease = {
    schemaVersion: 1,
    deviceId: plan.deviceId,
    profile: plan.profile,
    releaseId: plan.releaseId,
    releaseVersion: plan.releaseVersion,
    releaseDigest: plan.releaseDigest,
    plugins: plan.plugins,
    appliedAt: new Date().toISOString(),
  }
  validateFleetAppliedRelease(applied)
  await atomicJson(appliedReleasePath(config), applied)
  return applied
}

async function rollbackRelease(
  config: ReleaseReadyFleetAgentConfig,
  plan: FleetReleasePlan,
  record: ReleaseActionRecord,
  errorCode: string,
): Promise<ReleaseActionRecord> {
  const names = releaseProfileNames(plan)
  const profilesRoot = dirname(profileDir(config))
  const liveDir = profileDir(config)
  const stageDir = join(profilesRoot, names.stageProfile)
  const backupDir = join(profilesRoot, names.backupProfile)
  const failedDir = join(profilesRoot, names.failedProfile)
  let current = (await saveReleaseActionBestEffort(config, record, 'rollback', { errorCode })).record
  try {
    if (await regularDirectoryExists(backupDir)) {
      try { await stopDsh(config) } catch {
        const active = (await listenerPids(config, config.restart.port))[0]
        if (active !== undefined) throw new AgentRuntimeError('restart-cleanup-failed', 'cannot stop the failed release for rollback')
      }
      await rm(failedDir, { recursive: true, force: true })
      if (await regularDirectoryExists(liveDir)) await rename(liveDir, failedDir)
      await rename(backupDir, liveDir)
      await syncDirectory(profilesRoot)
    }
    await rm(stageDir, { recursive: true, force: true })
    current = await saveReleaseAction(config, current, 'rollback-restarting')
    await ensureServiceStarted(config)
    current = await saveReleaseAction(config, current, 'rollback-verifying')
    await verifyHealth(config, undefined, undefined, [], runtimeManifestPath(config))
    await rm(failedDir, { recursive: true, force: true })
    await auditBestEffort(config, { type: 'profile-release/rolled-back', planId: plan.planId, releaseId: plan.releaseId, result: errorCode })
    return saveReleaseAction(config, current, 'rolled-back', { result: 'rolled-back', errorCode })
  } catch {
    await auditBestEffort(config, { type: 'profile-release/manual-intervention', planId: plan.planId, releaseId: plan.releaseId, result: errorCode })
    return (await saveReleaseActionBestEffort(config, current, 'manual-intervention', {
      result: 'manual-intervention',
      errorCode: 'rollback-failed',
    })).record
  }
}

async function recoverReleaseInterrupted(
  config: ReleaseReadyFleetAgentConfig,
  plan: FleetReleasePlan,
  record: ReleaseActionRecord,
): Promise<ReleaseActionRecord> {
  const applied = await readAppliedRelease(config)
  if (applied?.releaseDigest === plan.releaseDigest) {
    try {
      await verifyReleaseProfileFiles(config, plan, config.profile)
      await ensureServiceStarted(config)
      await verifyHealth(config, undefined, undefined, plan.plugins.map(plugin => plugin.pluginId), runtimeManifestPath(config))
      const names = releaseProfileNames(plan)
      const profilesRoot = dirname(profileDir(config))
      await Promise.all([
        rm(join(profilesRoot, names.stageProfile), { recursive: true, force: true }),
        rm(join(profilesRoot, names.backupProfile), { recursive: true, force: true }),
        rm(join(profilesRoot, names.failedProfile), { recursive: true, force: true }),
      ])
      return saveReleaseAction(config, record, 'succeeded', { result: 'success' })
    } catch {
      // A persisted release without a healthy matching profile must be recovered through rollback below.
    }
  }
  return rollbackRelease(config, plan, record, 'interrupted-action')
}

async function applyStoredReleasePlanLocked(
  config: ReleaseReadyFleetAgentConfig,
  approval: FleetReleaseApproval,
  now: Date,
  signal?: AbortSignal,
): Promise<ReleaseActionRecord> {
  const plan = await readJson<FleetReleasePlan>(releasePlanPath(config, approval.planId))
  if (plan === null) throw new AgentRuntimeError('plan-not-found', 'approved release plan was not found')
  validateFleetReleasePlan(plan)
  const existing = await readReleaseAction(config, plan.planId)
  let validation: ReturnType<typeof validateFleetReleaseApproval>
  try {
    validation = validateFleetReleaseApproval(plan, approval, now)
  } catch (error: unknown) {
    if (existing !== null && !['succeeded', 'rolled-back', 'manual-intervention'].includes(existing.state)) {
      return recoverReleaseInterrupted(config, plan, existing)
    }
    throw error
  }
  if (existing !== null) {
    if (existing.idempotencyKey !== validation.idempotencyKey) {
      if (!['succeeded', 'rolled-back', 'manual-intervention'].includes(existing.state)) {
        return recoverReleaseInterrupted(config, plan, existing)
      }
      throw new AgentRuntimeError('idempotency-conflict', 'release plan already has a different approval')
    }
    if (['succeeded', 'rolled-back', 'manual-intervention'].includes(existing.state)) return existing
    return recoverReleaseInterrupted(config, plan, existing)
  }
  const current = await loadState(config, signal)
  if (current.manifestDigest !== plan.manifestDigest || current.profileHash !== plan.profileHash || current.dshVersion !== plan.observedDshVersion) {
    throw new FleetProtocolError('approval-mismatch', 'manifest, profile or DSH version changed after the release plan was created')
  }
  await verifyHealth(config, undefined, signal, [], runtimeManifestPath(config))
  const names = releaseProfileNames(plan)
  let record: ReleaseActionRecord = {
    planId: plan.planId,
    planDigest: plan.digest,
    approvalId: approval.approvalId,
    principalId: approval.principalId,
    idempotencyKey: validation.idempotencyKey,
    deviceId: plan.deviceId,
    profile: plan.profile,
    releaseId: plan.releaseId,
    releaseVersion: plan.releaseVersion,
    releaseDigest: plan.releaseDigest,
    stageProfile: names.stageProfile,
    backupProfile: names.backupProfile,
    state: 'approved',
    updatedAt: new Date().toISOString(),
  }
  record = await saveReleaseAction(config, record, 'approved')
  await audit(config, {
    type: 'profile-release/approved', planId: plan.planId, releaseId: plan.releaseId,
    approvalId: approval.approvalId, principalId: approval.principalId,
  })
  let releaseCommitted = false
  try {
    if (!plan.restartRequired) {
      await verifyReleaseProfileFiles(config, plan, config.profile)
      await verifyHealth(config, undefined, signal, plan.plugins.map(plugin => plugin.pluginId), runtimeManifestPath(config))
      await persistAppliedRelease(config, plan)
      releaseCommitted = true
      record = await saveReleaseAction(config, record, 'succeeded', { result: 'success' })
      await auditBestEffort(config, { type: 'profile-release/applied', planId: plan.planId, releaseId: plan.releaseId, result: 'adopted' })
      return record
    }
    record = await saveReleaseAction(config, record, 'staging')
    await stageRelease(config, plan, current.profileSnapshot, signal)
    throwIfAborted(signal)
    if (await computeProfileHash(config) !== plan.profileHash) {
      throw new FleetProtocolError('approval-mismatch', 'live profile changed while the release was staged')
    }
    record = await saveReleaseAction(config, record, 'staged')
    record = await saveReleaseAction(config, record, 'applying')
    await swapStagedRelease(config, plan, signal)
    throwIfAborted(signal)
    record = await saveReleaseAction(config, record, 'restarting')
    await startDsh(config, signal)
    throwIfAborted(signal)
    record = await saveReleaseAction(config, record, 'verifying')
    await verifyReleaseProfileFiles(config, plan, config.profile)
    await verifyHealth(config, undefined, signal, plan.plugins.map(plugin => plugin.pluginId), runtimeManifestPath(config))
    throwIfAborted(signal)
    await persistAppliedRelease(config, plan)
    releaseCommitted = true
    record = await saveReleaseAction(config, record, 'succeeded', { result: 'success' })
    await auditBestEffort(config, { type: 'profile-release/applied', planId: plan.planId, releaseId: plan.releaseId, result: 'success' })
    const profilesRoot = dirname(profileDir(config))
    await rm(join(profilesRoot, names.backupProfile), { recursive: true, force: true }).catch(() => undefined)
    return record
  } catch (error: unknown) {
    if (releaseCommitted) return recoverReleaseInterrupted(config, plan, record)
    const errorCode = typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : 'release-apply-failed'
    await auditBestEffort(config, { type: 'profile-release/failed', planId: plan.planId, releaseId: plan.releaseId, result: errorCode })
    return rollbackRelease(config, plan, record, errorCode)
  }
}

export async function applyStoredReleasePlan(
  config: FleetAgentConfig,
  approval: FleetReleaseApproval,
  now = new Date(),
  signal?: AbortSignal,
): Promise<ReleaseActionRecord> {
  assertReleaseReadyConfig(config)
  return withProfileLock(config, () => applyStoredReleasePlanLocked(config, approval, now, signal))
}

export async function readOrRecoverReleaseAction(config: FleetAgentConfig, planId: string): Promise<ReleaseActionRecord | null> {
  assertReleaseReadyConfig(config)
  return withProfileLock(config, async () => {
    const record = await readReleaseAction(config, planId)
    if (record === null || ['succeeded', 'rolled-back', 'manual-intervention'].includes(record.state)) return record
    const plan = await readJson<FleetReleasePlan>(releasePlanPath(config, planId))
    if (plan === null) throw new AgentRuntimeError('plan-not-found', 'approved release plan was not found')
    validateFleetReleasePlan(plan)
    return recoverReleaseInterrupted(config, plan, record)
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

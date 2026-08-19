import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir, hostname, platform, arch } from 'node:os'
import { basename, join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import type { RpcResult } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { AgentActionRecord, AgentInspection, ReleaseActionRecord, ReleaseAgentInspection } from './agent/runtime.ts'
import { FLEET_AGENT_PROTOCOL_VERSION, type FleetPlan, type FleetPlanApproval } from './agent/protocol.ts'
import { FLEET_RELEASE_PROTOCOL_VERSION, type FleetReleaseApproval, type FleetReleasePlan } from './agent/release-protocol.ts'
import { validateA2APayload, type FleetA2AEnvelope } from './a2a/protocol.ts'
import type { FleetA2AReceipt } from './a2a/runtime.ts'
import { AgentClientError, assertAgentIdentity, createAgentClient, type AgentTargetConfig } from './host/agent-client.ts'
import { digestInstalledArtifact } from './host/artifacts.ts'
import { parseFleetManifest, reconcileFleet } from './host/core.ts'
import { createUpdateMonitor, type UpdateMode } from './host/updates.ts'
import { normalizeDeviceId, type FleetManifest, type FleetStatus, type RuntimePhase, type RuntimePluginEntry } from './shared.ts'

export const name = 'fleet'
export const inject = ['connection', 'loader']
export const RPC_CHANNEL = '/dsh-fleet'
export const AGENT_RPC_CHANNEL = '/dsh-fleet-agent'

export interface ConvergenceConfig {
  enabled?: boolean
  principalId?: string
  timeoutMs?: number
  targets?: AgentTargetConfig[]
  signerDeviceId?: string
}

export interface Config {
  deviceId?: string
  manifestPath?: string
  profile?: string
  dshHome?: string
  dshBinary?: string
  artifactStore?: string
  updateCheck?: boolean
  updateCacheMs?: number
  updateTimeoutMs?: number
  convergence?: ConvergenceConfig
}

interface ProfileManifest {
  dependencies?: Record<string, string>
  dsh?: { profile?: { bundles?: string[] } }
}

interface LoaderEntryLike {
  id: string
  options: { name: string; group?: boolean }
  disabled?: boolean
  fiber?: { state: number }
}

interface HostContext {
  connection: HostConnectionHandle
  loader: { entries(): Iterable<LoaderEntryLike> }
}

const PHASES: Record<number, RuntimePhase> = {
  0: 'pending',
  1: 'loading',
  2: 'active',
  3: 'failed',
  4: null,
  5: 'unloading',
}

function expandHome(value: string): string {
  if (value === '~') return homedir()
  if (value.startsWith('~/')) return join(homedir(), value.slice(2))
  if (!value.includes('/')) return value
  return resolve(value)
}

function defaultDshBinary(): string {
  const current = process.argv[1]
  const candidates = [
    ...(current !== undefined && (basename(current) === 'dsh' || current.includes('/@deepseek-ai/dsh/')) ? [current] : []),
    join(homedir(), '.local/bin/dsh'),
    join(homedir(), '.npm-global/bin/dsh'),
  ]
  return candidates.find(candidate => existsSync(candidate)) ?? 'dsh'
}

function resolveConfig(config: Config | undefined) {
  const dshHome = expandHome(config?.dshHome ?? process.env.DSH_HOME ?? '~/.dsh')
  const boundedNumber = (value: number | undefined, fallback: number, minimum: number, maximum: number) =>
    value === undefined || !Number.isFinite(value) ? fallback : Math.min(maximum, Math.max(minimum, Math.round(value)))
  return {
    deviceId: normalizeDeviceId(config?.deviceId ?? process.env.DSH_FLEET_DEVICE_ID ?? hostname()),
    manifestPath: expandHome(config?.manifestPath ?? process.env.DSH_FLEET_MANIFEST ?? '~/.dsh/fleet/fleet.lock.yaml'),
    profile: (config?.profile ?? process.env.DSH_FLEET_PROFILE ?? 'web').trim(),
    dshHome,
    dshBinary: expandHome(config?.dshBinary ?? process.env.DSH_FLEET_DSH_BINARY ?? defaultDshBinary()),
    artifactStore: expandHome(config?.artifactStore ?? process.env.DSH_FLEET_ARTIFACT_STORE ?? '~/.dsh/fleet/artifacts'),
    updateCheck: config?.updateCheck !== false,
    updateCacheMs: boundedNumber(config?.updateCacheMs, 6 * 60 * 60 * 1000, 60 * 1000, 24 * 60 * 60 * 1000),
    updateTimeoutMs: boundedNumber(config?.updateTimeoutMs, 5000, 1000, 15_000),
    convergence: {
      enabled: config?.convergence?.enabled === true,
      principalId: (config?.convergence?.principalId ?? process.env.USER ?? 'local-owner').trim(),
      timeoutMs: boundedNumber(config?.convergence?.timeoutMs, 180_000, 5000, 10 * 60 * 1000),
      targets: config?.convergence?.targets ?? [],
      signerDeviceId: config?.convergence?.signerDeviceId === undefined
        ? undefined
        : normalizeDeviceId(config.convergence.signerDeviceId, 'convergence.signerDeviceId'),
    },
  }
}

function readDshVersion(binary: string): string | null {
  try {
    return execFileSync(binary, ['--version'], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null
  } catch {
    return null
  }
}

function runtimeSnapshot(loader: HostContext['loader']): RuntimePluginEntry[] {
  const entries: RuntimePluginEntry[] = []
  for (const entry of loader.entries()) {
    if (entry.options.group) continue
    entries.push({
      entryId: entry.id,
      moduleName: entry.options.name,
      enabled: entry.disabled !== true,
      fiberPhase: entry.fiber === undefined ? null : (PHASES[entry.fiber.state] ?? null),
    })
  }
  return entries
}

async function readProfile(path: string): Promise<{ dependencies: Record<string, string>; bundles: string[] }> {
  const parsed = JSON.parse(await readFile(path, 'utf8')) as ProfileManifest
  return {
    dependencies: parsed.dependencies ?? {},
    bundles: parsed.dsh?.profile?.bundles ?? [],
  }
}

const EMPTY_MANIFEST: FleetManifest = {
  schemaVersion: 1,
  team: { id: 'unavailable' },
  devices: {},
  plugins: [],
}

export async function collectFleetStatus(ctx: Pick<HostContext, 'loader'>, configInput?: Config): Promise<FleetStatus> {
  const config = resolveConfig(configInput)
  const profilePath = join(config.dshHome, 'profiles', config.profile, 'package.json')
  const runtime = runtimeSnapshot(ctx.loader)
  let manifest = EMPTY_MANIFEST
  let manifestLoaded = false
  let manifestError: string | undefined
  try {
    manifest = parseFleetManifest(await readFile(config.manifestPath, 'utf8'))
    manifestLoaded = true
  } catch (error: unknown) {
    manifestError = error instanceof Error ? error.message : String(error)
  }
  let dependencies: Record<string, string> = {}
  let bundles: string[] = []
  try {
    const profile = await readProfile(profilePath)
    dependencies = profile.dependencies
    bundles = profile.bundles
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    manifestError = manifestError === undefined ? 'profile: ' + message : manifestError + '; profile: ' + message
  }
  const result = reconcileFleet({
    manifest,
    deviceId: config.deviceId,
    profile: config.profile,
    dependencies,
    artifactDigests: Object.fromEntries((await Promise.all(reconcileFleet({
      manifest,
      deviceId: config.deviceId,
      profile: config.profile,
      dependencies,
      bundles,
      runtime: [],
    }).plugins.filter(plugin => plugin.desiredArtifactDigest !== undefined).map(async plugin => {
      const digest = await digestInstalledArtifact(
        join(config.dshHome, 'profiles', config.profile),
        config.artifactStore,
        dependencies[plugin.id] ?? '',
      )
      return digest === undefined ? null : [plugin.id, digest] as const
    }))).filter((entry): entry is readonly [string, string] => entry !== null)),
    bundles,
    runtime,
  })
  const deviceSpec = result.device
  return {
    generatedAt: new Date().toISOString(),
    device: {
      id: config.deviceId,
      registered: deviceSpec !== undefined,
      ...(deviceSpec?.assignedTo === undefined ? {} : { assignedTo: deviceSpec.assignedTo }),
      ...(deviceSpec === undefined ? {} : { class: deviceSpec.class, channel: deviceSpec.channel }),
      hostname: hostname(),
      platform: platform(),
      arch: arch(),
      nodeVersion: process.version,
    },
    dsh: { version: readDshVersion(config.dshBinary), profile: config.profile },
    manifest: {
      path: config.manifestPath,
      loaded: manifestLoaded,
      ...(manifestLoaded ? { teamId: manifest.team.id } : {}),
      ...(manifestError === undefined ? {} : { error: manifestError }),
    },
    runtime: {
      failedModules: [...new Set(runtime
        .filter(entry => entry.enabled && entry.fiberPhase === 'failed')
        .map(entry => entry.moduleName))].sort(),
    },
    summary: result.summary,
    plugins: result.plugins,
    unmanaged: result.unmanaged,
  }
}

const ok = (value: unknown): RpcResult<unknown> => ({ ok: true, value })
const fail = (message: string): RpcResult<unknown> => ({ ok: false, error: { code: 'internal', message, details: {} } })

function closedPayload(payload: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) throw new TypeError(label + ' must be an object')
  const value = payload as Record<string, unknown>
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(label + ' has unsupported or missing fields')
  }
  return value
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value !== value.trim()) throw new TypeError(field + ' must be a trimmed non-empty string')
  return value
}

async function digestManifest(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path, 'utf8'), 'utf8').digest('hex')
}

async function loadManifestBinding(path: string): Promise<{ manifest: FleetManifest; digest: string }> {
  const source = await readFile(path, 'utf8')
  return {
    manifest: parseFleetManifest(source),
    digest: createHash('sha256').update(source, 'utf8').digest('hex'),
  }
}

export function assertAgentConfiguration(
  expected: { deviceId: string; profile: string; manifestDigest: string },
  response: { deviceId: string; profile: string; manifestDigest: string },
): void {
  assertAgentIdentity(expected.deviceId, response)
  if (response.profile !== expected.profile) {
    throw new AgentClientError('agent-profile-mismatch', 'fleet agent profile does not match the configured Host profile')
  }
  if (response.manifestDigest !== expected.manifestDigest) {
    throw new AgentClientError('agent-manifest-mismatch', 'fleet agent manifest does not match the configured Host manifest')
  }
}

export function apply(ctx: Context, config?: Config): void {
  const host = ctx as unknown as HostContext
  const resolved = resolveConfig(config)
  const updates = createUpdateMonitor({
    enabled: resolved.updateCheck,
    cacheMs: resolved.updateCacheMs,
    timeoutMs: resolved.updateTimeoutMs,
    deviceId: resolved.deviceId,
    manifestPath: resolved.manifestPath,
    profileDir: join(resolved.dshHome, 'profiles', resolved.profile),
    profile: resolved.profile,
    dshVersion: readDshVersion(resolved.dshBinary),
  })
  const agents = createAgentClient(resolved.convergence)
  const signedTaskCall = async (
    targetDeviceId: string,
    kind: 'task.submit' | 'task.status' | 'task.cancel',
    taskPayload: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<FleetA2AEnvelope> => {
    const signerDeviceId = resolved.convergence.signerDeviceId
    if (signerDeviceId === undefined) throw new AgentClientError('a2a-signer-missing', 'a fixed local A2A signer is not configured')
    const signer = resolved.convergence.targets.find(target => target.deviceId === signerDeviceId)
    if (signer === undefined || signer.transport !== 'local') {
      throw new AgentClientError('a2a-signer-invalid', 'A2A signer must be a configured local Agent target')
    }
    const envelope = await agents.call<FleetA2AEnvelope>(signerDeviceId, 'a2a-sign', {
      recipientDeviceId: targetDeviceId,
      kind,
      payload: taskPayload,
    }, signal)
    const receipt = await agents.call<FleetA2AReceipt>(targetDeviceId, 'a2a-receive', { envelope }, signal)
    if (receipt.requestMessageId !== envelope.messageId || typeof receipt.response !== 'object' || receipt.response === null) {
      throw new AgentClientError('a2a-receipt-invalid', 'target returned an invalid A2A receipt')
    }
    const verified = await agents.call<FleetA2AEnvelope>(signerDeviceId, 'a2a-verify', { envelope: receipt.response }, signal)
    if (verified.sender.deviceId !== targetDeviceId || verified.payload.taskId !== taskPayload.taskId ||
        (verified.kind !== 'task.progress' && verified.kind !== 'task.result')) {
      throw new AgentClientError('a2a-response-mismatch', 'signed task response does not match the requested target and task')
    }
    return verified
  }
  host.connection.rpc.handle(RPC_CHANNEL, async (endpoint, payload) => {
    try {
      if (endpoint === 'status') return ok(await collectFleetStatus(host, config))
      if (endpoint === 'updates') {
        let mode: UpdateMode = 'if-stale'
        if (payload !== null && payload !== undefined) {
          if (typeof payload !== 'object' || Array.isArray(payload) || !('mode' in payload)) throw new TypeError('updates payload must contain mode')
          const candidate = (payload as { mode?: unknown }).mode
          if (candidate !== 'cache' && candidate !== 'if-stale' && candidate !== 'force') throw new TypeError('invalid updates mode')
          mode = candidate
        }
        return ok(await updates.get(mode))
      }
      return fail('unknown endpoint: ' + endpoint)
    } catch (error: unknown) {
      return fail(error instanceof Error ? error.message : String(error))
    }
  }, { authority: 'loopback' })
  host.connection.rpc.handle(AGENT_RPC_CHANNEL, async (endpoint, payload, signal) => {
    try {
      if (endpoint === 'targets') {
        if (payload !== null && (typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).length !== 0)) {
          throw new TypeError('targets payload must be empty')
        }
        if (!agents.enabled) return ok({ enabled: false, targets: [] })
        const binding = await loadManifestBinding(resolved.manifestPath)
        const targets = await Promise.all(agents.targets.map(async target => {
          try {
            const releaseMode = binding.manifest.schemaVersion === 2
            const inspection = releaseMode
              ? await agents.call<ReleaseAgentInspection>(target.deviceId, 'release-inspect', null, signal)
              : await agents.call<AgentInspection>(target.deviceId, 'inspect', null, signal)
            assertAgentConfiguration({ deviceId: target.deviceId, profile: resolved.profile, manifestDigest: binding.digest }, inspection)
            return { ...target, online: true, mode: releaseMode ? 'profile-release' : 'single-plugin', inspection }
          } catch (error: unknown) {
            const code = error instanceof AgentClientError ? error.code : 'agent-unavailable'
            return { ...target, online: false, errorCode: code }
          }
        }))
        return ok({ enabled: true, targets })
      }
      if (endpoint === 'plan') {
        const body = closedPayload(payload, ['deviceId', 'pluginId'], 'plan payload')
        const deviceId = requiredString(body.deviceId, 'deviceId')
        const pluginId = requiredString(body.pluginId, 'pluginId')
        const plan = await agents.call<FleetPlan>(deviceId, 'plan', { pluginId }, signal)
        assertAgentConfiguration({
          deviceId,
          profile: resolved.profile,
          manifestDigest: await digestManifest(resolved.manifestPath),
        }, plan)
        return ok(plan)
      }
      if (endpoint === 'release-plan') {
        const body = closedPayload(payload, ['deviceId'], 'release plan payload')
        const deviceId = requiredString(body.deviceId, 'deviceId')
        const plan = await agents.call<FleetReleasePlan>(deviceId, 'release-plan', null, signal)
        assertAgentConfiguration({
          deviceId,
          profile: resolved.profile,
          manifestDigest: await digestManifest(resolved.manifestPath),
        }, plan)
        return ok(plan)
      }
      if (endpoint === 'approve') {
        const body = closedPayload(payload, ['approvalId', 'deviceId', 'planDigest', 'planExpiresAt', 'planId', 'profile'], 'approve payload')
        const deviceId = requiredString(body.deviceId, 'deviceId')
        const approvedAt = new Date()
        const planExpiresAt = new Date(requiredString(body.planExpiresAt, 'planExpiresAt'))
        if (!Number.isFinite(planExpiresAt.getTime()) || planExpiresAt <= approvedAt) throw new TypeError('planExpiresAt must be in the future')
        const approval: FleetPlanApproval = {
          protocolVersion: FLEET_AGENT_PROTOCOL_VERSION,
          approvalId: requiredString(body.approvalId, 'approvalId'),
          principalId: resolved.convergence.principalId,
          planId: requiredString(body.planId, 'planId'),
          planDigest: requiredString(body.planDigest, 'planDigest'),
          deviceId,
          profile: requiredString(body.profile, 'profile'),
          approvedAt: approvedAt.toISOString(),
          expiresAt: new Date(Math.min(planExpiresAt.getTime(), approvedAt.getTime() + 2 * 60 * 1000)).toISOString(),
        }
        return ok(await agents.call<AgentActionRecord>(deviceId, 'apply', { approval }, signal))
      }
      if (endpoint === 'release-approve') {
        const body = closedPayload(payload, ['approvalId', 'deviceId', 'planDigest', 'planExpiresAt', 'planId', 'profile'], 'release approve payload')
        const deviceId = requiredString(body.deviceId, 'deviceId')
        const approvedAt = new Date()
        const planExpiresAt = new Date(requiredString(body.planExpiresAt, 'planExpiresAt'))
        if (!Number.isFinite(planExpiresAt.getTime()) || planExpiresAt <= approvedAt) throw new TypeError('planExpiresAt must be in the future')
        const approval: FleetReleaseApproval = {
          protocolVersion: FLEET_RELEASE_PROTOCOL_VERSION,
          kind: 'profile-release',
          approvalId: requiredString(body.approvalId, 'approvalId'),
          principalId: resolved.convergence.principalId,
          planId: requiredString(body.planId, 'planId'),
          planDigest: requiredString(body.planDigest, 'planDigest'),
          deviceId,
          profile: requiredString(body.profile, 'profile'),
          approvedAt: approvedAt.toISOString(),
          expiresAt: new Date(Math.min(planExpiresAt.getTime(), approvedAt.getTime() + 2 * 60 * 1000)).toISOString(),
        }
        return ok(await agents.call<ReleaseActionRecord>(deviceId, 'release-apply', { approval }, signal))
      }
      if (endpoint === 'action-status') {
        const body = closedPayload(payload, ['deviceId', 'planId'], 'status payload')
        const deviceId = requiredString(body.deviceId, 'deviceId')
        const planId = requiredString(body.planId, 'planId')
        return ok(await agents.call<AgentActionRecord>(deviceId, 'status', { planId }, signal))
      }
      if (endpoint === 'release-action-status') {
        const body = closedPayload(payload, ['deviceId', 'planId'], 'release status payload')
        const deviceId = requiredString(body.deviceId, 'deviceId')
        const planId = requiredString(body.planId, 'planId')
        return ok(await agents.call<ReleaseActionRecord>(deviceId, 'release-status', { planId }, signal))
      }
      if (endpoint === 'task-submit') {
        const body = closedPayload(payload, ['profile', 'prompt', 'targetDeviceId', 'taskId', 'workspaceId'], 'task submit payload')
        const targetDeviceId = normalizeDeviceId(requiredString(body.targetDeviceId, 'targetDeviceId'))
        const taskPayload = {
          taskId: requiredString(body.taskId, 'taskId'),
          workspaceId: requiredString(body.workspaceId, 'workspaceId'),
          profile: requiredString(body.profile, 'profile'),
          prompt: requiredString(body.prompt, 'prompt'),
        }
        validateA2APayload('task.submit', taskPayload)
        const response = await signedTaskCall(targetDeviceId, 'task.submit', taskPayload, signal)
        return ok({ taskId: taskPayload.taskId, response })
      }
      if (endpoint === 'task-status' || endpoint === 'task-cancel') {
        const body = closedPayload(payload, ['targetDeviceId', 'taskId'], 'task control payload')
        const targetDeviceId = normalizeDeviceId(requiredString(body.targetDeviceId, 'targetDeviceId'))
        const taskId = requiredString(body.taskId, 'taskId')
        validateA2APayload(endpoint === 'task-status' ? 'task.status' : 'task.cancel', { taskId })
        const response = await signedTaskCall(targetDeviceId, endpoint === 'task-status' ? 'task.status' : 'task.cancel', { taskId }, signal)
        return ok({ taskId, response })
      }
      if (endpoint === 'tasks-resume') {
        const body = closedPayload(payload, ['targetDeviceId'], 'tasks resume payload')
        const targetDeviceId = normalizeDeviceId(requiredString(body.targetDeviceId, 'targetDeviceId'))
        return ok(await agents.call<{ resumed: number }>(targetDeviceId, 'tasks-resume', null, signal))
      }
      return fail('unknown agent endpoint: ' + endpoint)
    } catch (error: unknown) {
      if (error instanceof AgentClientError) return fail(error.message)
      return fail(error instanceof Error ? error.message : String(error))
    }
  }, { authority: 'loopback' })
}

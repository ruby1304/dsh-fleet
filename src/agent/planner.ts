import type { FleetDeviceSpec, FleetManifest, FleetPluginSpec } from '../shared.ts'
import {
  FLEET_AGENT_PROTOCOL_VERSION,
  FleetProtocolError,
  createFleetPlan,
  exactSourceKind,
  isSupportedDshVersion,
  isSafeNpmPackageName,
  type FleetPlan,
  type FleetPlanSourceKind,
} from './protocol.ts'

export const FLEET_PLAN_TTL_MS = 5 * 60 * 1000

export interface CreateAgentPlanInput {
  manifest: FleetManifest
  manifestDigest: string
  dependencies: Readonly<Record<string, string>>
  profileHash: string
  observedDshVersion: string
  now: Date | string
  pluginId: string
  deviceId: string
  profile: string
  planTtlMs?: number
}

export type FleetPlannerErrorCode =
  | 'invalid-input'
  | 'unsupported-dsh-version'
  | 'unknown-device'
  | 'device-not-stable'
  | 'plugin-not-targeted'
  | 'ambiguous-plugin'
  | 'unsupported-source'
  | 'already-aligned'

export class FleetPlannerError extends Error {
  readonly code: FleetPlannerErrorCode

  constructor(code: FleetPlannerErrorCode, message: string) {
    super(message)
    this.name = 'FleetPlannerError'
    this.code = code
  }
}

const INPUT_KEYS = [
  'manifest',
  'manifestDigest',
  'dependencies',
  'profileHash',
  'observedDshVersion',
  'now',
  'pluginId',
  'deviceId',
  'profile',
  'planTtlMs',
] as const
const MANIFEST_KEYS = ['schemaVersion', 'team', 'devices', 'plugins'] as const
const TEAM_KEYS = ['id', 'name'] as const
const DEVICE_KEYS = ['assignedTo', 'class', 'channel', 'labels'] as const
const PLUGIN_KEYS = ['id', 'spec', 'source', 'revision', 'profiles', 'runtimeModules', 'target'] as const
const TARGET_KEYS = ['devices', 'classes', 'channels'] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function rejectUnknownKeys(value: unknown, keys: readonly string[], label: string): void {
  if (!isRecord(value)) throw new FleetPlannerError('invalid-input', label + ' must be an object')
  const allowed = new Set(keys)
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new FleetPlannerError('invalid-input', label + ' contains unsupported field ' + JSON.stringify(key))
  }
}

function trimmed(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new FleetPlannerError('invalid-input', field + ' must be a non-empty string')
  }
  return value.trim()
}

function canonicalNow(value: Date | string): string {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)
  if (!Number.isFinite(date.getTime())) throw new FleetPlannerError('invalid-input', 'now must be a valid timestamp')
  return date.toISOString()
}

function targetsDevice(plugin: FleetPluginSpec, deviceId: string, device: FleetDeviceSpec): boolean {
  const target = plugin.target
  if (target === undefined) return true
  rejectUnknownKeys(target, TARGET_KEYS, 'plugin.target')
  if (target.devices !== undefined && !target.devices.includes(deviceId)) return false
  if (target.classes !== undefined && !target.classes.includes(device.class)) return false
  if (target.channels !== undefined && !target.channels.includes(device.channel)) return false
  return true
}

function desiredExactSource(plugin: FleetPluginSpec): { sourceKind: FleetPlanSourceKind; exactToSpec: string } {
  rejectUnknownKeys(plugin, PLUGIN_KEYS, 'plugin')
  const spec = trimmed(plugin.spec, 'plugin.spec')
  if (plugin.source === undefined) {
    const sourceKind = exactSourceKind(spec)
    if (sourceKind === null) throw new FleetPlannerError('unsupported-source', 'stable plans require exact npm semver or github:owner/repo#40sha')
    return { sourceKind, exactToSpec: spec }
  }
  const source = trimmed(plugin.source, 'plugin.source')
  if (source === 'npm') {
    const revision = trimmed(plugin.revision, 'plugin.revision')
    if (spec !== revision || exactSourceKind(revision) !== 'npm') {
      throw new FleetPlannerError('unsupported-source', 'npm plans require one exact semver revision')
    }
    return { sourceKind: 'npm', exactToSpec: revision }
  }
  if (/^github:[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(source)) {
    const revision = trimmed(plugin.revision, 'plugin.revision')
    if (!/^[0-9a-fA-F]{40}$/.test(revision)) {
      throw new FleetPlannerError('unsupported-source', 'GitHub plans require a 40-hex commit revision')
    }
    const exactToSpec = source + '#' + revision.toLowerCase()
    if (spec.toLowerCase() !== exactToSpec.toLowerCase()) {
      throw new FleetPlannerError('unsupported-source', 'plugin.spec must match its exact GitHub source and revision')
    }
    return { sourceKind: 'github', exactToSpec }
  }
  throw new FleetPlannerError('unsupported-source', 'URLs, tags, links, files, workspaces and shell sources are not supported')
}

function selectedPlugin(manifest: FleetManifest, pluginId: string, profile: string, deviceId: string, device: FleetDeviceSpec): FleetPluginSpec {
  const matches = manifest.plugins.filter(plugin =>
    plugin.id === pluginId &&
    (plugin.profiles === undefined || plugin.profiles.includes(profile)) &&
    targetsDevice(plugin, deviceId, device),
  )
  if (matches.length === 0) throw new FleetPlannerError('plugin-not-targeted', 'plugin is not targeted to this device and profile')
  if (matches.length !== 1) throw new FleetPlannerError('ambiguous-plugin', 'more than one plugin variant targets this device and profile')
  return matches[0] as FleetPluginSpec
}

export function createAgentPlan(input: CreateAgentPlanInput): FleetPlan {
  rejectUnknownKeys(input, INPUT_KEYS, 'planner input')
  rejectUnknownKeys(input.manifest, MANIFEST_KEYS, 'manifest')
  rejectUnknownKeys(input.manifest.team, TEAM_KEYS, 'manifest.team')
  if (input.manifest.schemaVersion !== 1 || !Array.isArray(input.manifest.plugins) || !isRecord(input.manifest.devices)) {
    throw new FleetPlannerError('invalid-input', 'planner requires a parsed schemaVersion 1 manifest')
  }
  if (!isRecord(input.dependencies)) throw new FleetPlannerError('invalid-input', 'dependencies must be an object')
  const deviceId = trimmed(input.deviceId, 'deviceId')
  const profile = trimmed(input.profile, 'profile')
  const pluginId = trimmed(input.pluginId, 'pluginId')
  if (!isSafeNpmPackageName(pluginId)) {
    throw new FleetPlannerError('invalid-input', 'pluginId must be one literal lowercase npm package name')
  }
  const observedDshVersion = trimmed(input.observedDshVersion, 'observedDshVersion')
  if (!isSupportedDshVersion(observedDshVersion)) {
    throw new FleetPlannerError('unsupported-dsh-version', 'DSH version is outside the supported agent range')
  }
  const device = input.manifest.devices[deviceId]
  if (device === undefined) throw new FleetPlannerError('unknown-device', 'device is not registered in the manifest')
  rejectUnknownKeys(device, DEVICE_KEYS, 'device')
  if (device.channel !== 'stable') throw new FleetPlannerError('device-not-stable', 'this planner slice only supports stable devices')
  const plugin = selectedPlugin(input.manifest, pluginId, profile, deviceId, device)
  const { sourceKind, exactToSpec } = desiredExactSource(plugin)
  const actualSpec = input.dependencies[pluginId]
  if (actualSpec === exactToSpec) throw new FleetPlannerError('already-aligned', 'plugin is already aligned; no plan is created')
  if (actualSpec !== undefined && (typeof actualSpec !== 'string' || actualSpec.trim().length === 0)) {
    throw new FleetPlannerError('invalid-input', 'installed dependency spec must be a non-empty string')
  }
  const createdAt = canonicalNow(input.now)
  const planTtlMs = input.planTtlMs ?? FLEET_PLAN_TTL_MS
  if (!Number.isSafeInteger(planTtlMs) || planTtlMs < 60_000 || planTtlMs > 60 * 60 * 1000) {
    throw new FleetPlannerError('invalid-input', 'planTtlMs must be an integer from 60000 to 3600000')
  }
  const expiresAt = new Date(Date.parse(createdAt) + planTtlMs).toISOString()
  try {
    return createFleetPlan({
      protocolVersion: FLEET_AGENT_PROTOCOL_VERSION,
      deviceId,
      profile,
      manifestDigest: trimmed(input.manifestDigest, 'manifestDigest').toLowerCase(),
      profileHash: trimmed(input.profileHash, 'profileHash').toLowerCase(),
      observedDshVersion,
      pluginId,
      action: actualSpec === undefined ? 'install' : 'update',
      fromSpec: actualSpec ?? null,
      exactToSpec,
      sourceKind,
      restartRequired: true,
      createdAt,
      expiresAt,
    })
  } catch (error: unknown) {
    if (error instanceof FleetProtocolError) throw error
    throw new FleetPlannerError('invalid-input', error instanceof Error ? error.message : String(error))
  }
}

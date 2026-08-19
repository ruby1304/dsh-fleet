import { createHash } from 'node:crypto'
import { satisfies } from 'semver'
import type { FleetManifest, FleetProfileRelease, FleetReleasePlugin } from '../shared.ts'
import { FleetProtocolError, isSupportedDshVersion, sha256Canonical } from './protocol.ts'
import {
  FLEET_RELEASE_PROTOCOL_VERSION,
  createFleetReleasePlan,
  type FleetAppliedRelease,
  type FleetReleaseChange,
  type FleetReleasePlan,
  type FleetReleasePluginBinding,
} from './release-protocol.ts'

export const FLEET_RELEASE_PLAN_TTL_MS = 10 * 60 * 1000

export interface CreateReleasePlanInput {
  manifest: FleetManifest
  manifestDigest: string
  liveManifestDigest?: string
  runtimeManifestDigest: string | null
  dependencies: Readonly<Record<string, string>>
  artifactDigests?: Readonly<Record<string, string>>
  appliedRelease?: FleetAppliedRelease | null
  profileHash: string
  observedDshVersion: string
  observedRuntimeDigest: string
  observedServiceDefinitionDigest: string | null
  now: Date | string
  deviceId: string
  profile: string
  planTtlMs?: number
}

export type FleetReleasePlannerErrorCode =
  | 'invalid-input'
  | 'unsupported-dsh-version'
  | 'unknown-device'
  | 'device-not-stable'
  | 'release-not-assigned'
  | 'release-incompatible'
  | 'release-ownership-conflict'

export class FleetReleasePlannerError extends Error {
  readonly code: FleetReleasePlannerErrorCode

  constructor(code: FleetReleasePlannerErrorCode, message: string) {
    super(message)
    this.name = 'FleetReleasePlannerError'
    this.code = code
  }
}

function trimmed(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    throw new FleetReleasePlannerError('invalid-input', field + ' must be a trimmed non-empty string')
  }
  return value
}

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function binding(plugin: FleetReleasePlugin): FleetReleasePluginBinding {
  const runtimeModules = [...(plugin.runtimeModules ?? [plugin.id])].sort()
  if (plugin.source.kind === 'npm') {
    if (plugin.source.integrity === undefined) {
      throw new FleetReleasePlannerError('invalid-input', 'atomic npm releases require a SHA-512 integrity lock for ' + plugin.id)
    }
    return {
      pluginId: plugin.id,
      visibility: plugin.visibility,
      sourceKind: 'npm',
      exactSpec: plugin.source.version,
      artifactDigest: null,
      packageVersion: plugin.source.version,
      integrity: plugin.source.integrity,
      runtimeModules,
    }
  }
  if (plugin.source.kind === 'github') {
    return {
      pluginId: plugin.id,
      visibility: plugin.visibility,
      sourceKind: 'github',
      exactSpec: 'github:' + plugin.source.repository + '#' + plugin.source.revision,
      artifactDigest: null,
      packageVersion: null,
      integrity: null,
      runtimeModules,
    }
  }
  return {
    pluginId: plugin.id,
    visibility: plugin.visibility,
    sourceKind: 'artifact',
    exactSpec: 'artifact:sha256:' + plugin.source.digest,
    artifactDigest: plugin.source.digest,
    packageVersion: plugin.source.version,
    integrity: null,
    runtimeModules,
  }
}

function assignedRelease(input: CreateReleasePlanInput): FleetProfileRelease {
  if (input.manifest.schemaVersion !== 2 || input.manifest.v2 === undefined) {
    throw new FleetReleasePlannerError('invalid-input', 'atomic release planning requires a parsed schemaVersion 2 manifest')
  }
  const device = input.manifest.devices[input.deviceId]
  if (device === undefined) throw new FleetReleasePlannerError('unknown-device', 'device is not registered in the manifest')
  if (device.channel !== 'stable') throw new FleetReleasePlannerError('device-not-stable', 'atomic release planning is enabled only for stable devices')
  const releaseId = input.manifest.v2.assignments[input.deviceId]?.[input.profile]
  if (releaseId === undefined) throw new FleetReleasePlannerError('release-not-assigned', 'no profile release is assigned to this device and profile')
  const release = input.manifest.v2.profileReleases[releaseId]
  if (release === undefined || release.profile !== input.profile) {
    throw new FleetReleasePlannerError('invalid-input', 'assigned release is missing or targets a different profile')
  }
  return release
}

function currentMatches(binding: FleetReleasePluginBinding, actualSpec: string | undefined, artifactDigests: Readonly<Record<string, string>>): boolean {
  if (actualSpec === undefined) return false
  return binding.sourceKind === 'artifact'
    ? artifactDigests[binding.pluginId] === binding.artifactDigest
    : actualSpec === binding.exactSpec
}

function buildChanges(
  plugins: FleetReleasePluginBinding[],
  dependencies: Readonly<Record<string, string>>,
  artifactDigests: Readonly<Record<string, string>>,
  previous: FleetAppliedRelease | null | undefined,
): FleetReleaseChange[] {
  const finalIds = new Set(plugins.map(plugin => plugin.pluginId))
  const changes: FleetReleaseChange[] = []
  for (const plugin of plugins) {
    const actualSpec = dependencies[plugin.pluginId]
    if (currentMatches(plugin, actualSpec, artifactDigests)) continue
    changes.push({
      pluginId: plugin.pluginId,
      visibility: plugin.visibility,
      sourceKind: plugin.sourceKind,
      action: actualSpec === undefined ? 'install' : 'update',
      fromSpecDigest: actualSpec === undefined ? null : digest(actualSpec),
      exactToSpec: plugin.exactSpec,
      artifactDigest: plugin.artifactDigest,
    })
  }
  for (const plugin of previous?.plugins ?? []) {
    if (finalIds.has(plugin.pluginId)) continue
    const actualSpec = dependencies[plugin.pluginId]
    if (actualSpec === undefined) continue
    if (!currentMatches(plugin, actualSpec, artifactDigests)) {
      throw new FleetReleasePlannerError(
        'release-ownership-conflict',
        'live binding for ' + plugin.pluginId + ' no longer matches the previously applied release marker',
      )
    }
    changes.push({
      pluginId: plugin.pluginId,
      visibility: plugin.visibility,
      sourceKind: plugin.sourceKind,
      action: 'remove',
      fromSpecDigest: digest(actualSpec),
      exactToSpec: null,
      artifactDigest: null,
    })
  }
  return changes.sort((a, b) => a.pluginId.localeCompare(b.pluginId))
}

function canonicalNow(value: Date | string): string {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)
  if (!Number.isFinite(date.getTime())) throw new FleetReleasePlannerError('invalid-input', 'now must be a valid timestamp')
  return date.toISOString()
}

export function createReleasePlan(input: CreateReleasePlanInput): FleetReleasePlan {
  const deviceId = trimmed(input.deviceId, 'deviceId')
  const profile = trimmed(input.profile, 'profile')
  if (deviceId !== input.deviceId || profile !== input.profile) throw new FleetReleasePlannerError('invalid-input', 'identity fields must be canonical')
  const observedDshVersion = trimmed(input.observedDshVersion, 'observedDshVersion')
  if (!isSupportedDshVersion(observedDshVersion)) {
    throw new FleetReleasePlannerError('unsupported-dsh-version', 'DSH version is outside the supported Agent range')
  }
  const release = assignedRelease(input)
  if (!satisfies(observedDshVersion, release.dshRange, { includePrerelease: true })) {
    throw new FleetReleasePlannerError('release-incompatible', 'assigned release does not support the observed DSH version')
  }
  const plugins = release.plugins.map(binding).sort((a, b) => a.pluginId.localeCompare(b.pluginId))
  const changes = buildChanges(plugins, input.dependencies, input.artifactDigests ?? {}, input.appliedRelease)
  const createdAt = canonicalNow(input.now)
  const planTtlMs = input.planTtlMs ?? FLEET_RELEASE_PLAN_TTL_MS
  if (!Number.isSafeInteger(planTtlMs) || planTtlMs < 60_000 || planTtlMs > 60 * 60 * 1000) {
    throw new FleetReleasePlannerError('invalid-input', 'planTtlMs must be an integer from 60000 to 3600000')
  }
  const releaseDigest = sha256Canonical({ releaseId: release.id, releaseVersion: release.version, profile, plugins })
  const toManifestDigest = trimmed(input.manifestDigest, 'manifestDigest').toLowerCase()
  const fromManifestDigest = trimmed(
    input.liveManifestDigest ?? input.runtimeManifestDigest ?? input.manifestDigest,
    'liveManifestDigest',
  ).toLowerCase()
  try {
    return createFleetReleasePlan({
      protocolVersion: FLEET_RELEASE_PROTOCOL_VERSION,
      kind: 'profile-release',
      deviceId,
      profile,
      fromManifestDigest,
      toManifestDigest,
      fromReleaseDigest: input.appliedRelease?.releaseDigest ?? null,
      toReleaseDigest: releaseDigest,
      manifestDigest: toManifestDigest,
      profileHash: trimmed(input.profileHash, 'profileHash').toLowerCase(),
      observedDshVersion,
      observedRuntimeDigest: trimmed(input.observedRuntimeDigest, 'observedRuntimeDigest').toLowerCase(),
      observedServiceDefinitionDigest: input.observedServiceDefinitionDigest === null
        ? null
        : trimmed(input.observedServiceDefinitionDigest, 'observedServiceDefinitionDigest').toLowerCase(),
      releaseId: release.id,
      releaseVersion: release.version,
      releaseDigest,
      plugins,
      changes,
      restartRequired: changes.length > 0 || fromManifestDigest !== toManifestDigest,
      createdAt,
      expiresAt: new Date(Date.parse(createdAt) + planTtlMs).toISOString(),
    })
  } catch (error: unknown) {
    if (error instanceof FleetProtocolError) throw error
    throw new FleetReleasePlannerError('invalid-input', error instanceof Error ? error.message : String(error))
  }
}

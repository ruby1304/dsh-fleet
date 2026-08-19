export type DeviceClass = 'portable-control' | 'always-on-worker' | 'member-workstation' | 'service-node' | string

export const DEVICE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

export function normalizeDeviceId(value: unknown, field = 'deviceId'): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(field + ' must be a non-empty string')
  }
  const deviceId = value.trim()
  if (!DEVICE_ID_PATTERN.test(deviceId)) {
    throw new TypeError(field + ' must be 1 to 64 ASCII letters, digits, dots, underscores or hyphens and start with a letter or digit')
  }
  return deviceId
}

export interface FleetDeviceSpec {
  assignedTo?: string
  class: DeviceClass
  channel: string
  labels?: string[]
}

export interface FleetPluginTarget {
  devices?: string[]
  classes?: string[]
  channels?: string[]
}

export interface FleetPluginSpec {
  id: string
  spec: string
  source?: string
  revision?: string
  visibility?: 'public' | 'private'
  artifactDigest?: string
  releaseId?: string
  releaseVersion?: string
  profiles?: string[]
  runtimeModules?: string[]
  target?: FleetPluginTarget
}

export interface FleetNpmSource {
  kind: 'npm'
  version: string
  integrity?: string
}

export interface FleetGitHubSource {
  kind: 'github'
  repository: string
  revision: string
}

export interface FleetArtifactSource {
  kind: 'artifact'
  digest: string
  version: string
}

export type FleetReleasePluginSource = FleetNpmSource | FleetGitHubSource | FleetArtifactSource

export interface FleetReleasePlugin {
  id: string
  visibility: 'public' | 'private'
  source: FleetReleasePluginSource
  runtimeModules?: string[]
}

export interface FleetProfileRelease {
  id: string
  version: string
  profile: string
  dshRange: string
  plugins: FleetReleasePlugin[]
}

export interface FleetManifestV2Metadata {
  profileReleases: Record<string, FleetProfileRelease>
  assignments: Record<string, Record<string, string>>
}

export interface FleetManifest {
  schemaVersion: 1 | 2
  team: { id: string; name?: string }
  devices: Record<string, FleetDeviceSpec>
  plugins: FleetPluginSpec[]
  v2?: FleetManifestV2Metadata
}

export type RuntimePhase = 'pending' | 'loading' | 'active' | 'failed' | 'unloading' | null

export interface RuntimePluginEntry {
  entryId: string
  moduleName: string
  enabled: boolean
  fiberPhase: RuntimePhase
}

export type PluginDriftState = 'aligned' | 'missing' | 'spec-drift' | 'runtime-failed' | 'runtime-inactive'

export interface PluginStatus {
  id: string
  desiredSpec: string
  desiredSource?: string
  desiredRevision?: string
  visibility?: 'public' | 'private'
  releaseId?: string
  releaseVersion?: string
  desiredArtifactDigest?: string
  actualArtifactDigest?: string
  actualSpec?: string
  runtimeModules: string[]
  runtimePhase: RuntimePhase
  state: PluginDriftState
}

export interface FleetSummary {
  desired: number
  aligned: number
  missing: number
  drifted: number
  failed: number
  unmanaged: number
}

export interface FleetStatus {
  generatedAt: string
  device: {
    id: string
    registered: boolean
    assignedTo?: string
    class?: string
    channel?: string
    hostname: string
    platform: string
    arch: string
    nodeVersion: string
  }
  dsh: {
    version: string | null
    profile: string
  }
  manifest: {
    path: string
    loaded: boolean
    teamId?: string
    error?: string
  }
  runtime: {
    failedModules: string[]
  }
  summary: FleetSummary
  plugins: PluginStatus[]
  unmanaged: Array<{ id: string; actualSpec: string }>
}

export type FleetUpdateSource = 'npm' | 'github' | 'local' | 'unknown'
export type FleetUpdateState = 'current' | 'available' | 'local' | 'missing' | 'error' | 'unsupported'

export interface FleetUpdateItem {
  id: string
  kind: 'dsh' | 'plugin'
  managed: boolean
  source: FleetUpdateSource
  state: FleetUpdateState
  changeKind?: 'version' | 'head-changed'
  currentVersion?: string
  latestVersion?: string
  currentRevision?: string
  latestRevision?: string
  sourceUrl?: string
  errorCode?: 'registry-unavailable' | 'github-unavailable' | 'not-installed' | 'unsupported-source'
}

export interface FleetUpdateSummary {
  tracked: number
  available: number
  current: number
  local: number
  missing: number
  errors: number
  unsupported: number
}

export interface FleetUpdateSnapshot {
  checkedAt: string
  refreshAfter: string
  summary: FleetUpdateSummary
  items: FleetUpdateItem[]
}

export interface FleetUpdates {
  enabled: boolean
  cached: boolean
  stale: boolean
  lastAttemptAt?: string
  snapshot?: FleetUpdateSnapshot
}

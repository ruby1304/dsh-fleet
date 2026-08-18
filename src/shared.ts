export type DeviceClass = 'portable-control' | 'always-on-worker' | 'member-workstation' | 'service-node' | string

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
  profiles?: string[]
  runtimeModules?: string[]
  target?: FleetPluginTarget
}

export interface FleetManifest {
  schemaVersion: 1
  team: { id: string; name?: string }
  devices: Record<string, FleetDeviceSpec>
  plugins: FleetPluginSpec[]
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
  summary: FleetSummary
  plugins: PluginStatus[]
  unmanaged: Array<{ id: string; actualSpec: string }>
}

import { parse as parseYaml } from 'yaml'
import type {
  FleetDeviceSpec,
  FleetManifest,
  FleetPluginSpec,
  FleetStatus,
  PluginStatus,
  RuntimePhase,
  RuntimePluginEntry,
} from '../shared.ts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function strings(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || item.trim().length === 0)) {
    throw new TypeError(field + ' must be an array of non-empty strings')
  }
  return value.map(item => (item as string).trim())
}

function nonEmpty(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new TypeError(field + ' must be a non-empty string')
  return value.trim()
}

function parseDevice(value: unknown, field: string): FleetDeviceSpec {
  if (!isRecord(value)) throw new TypeError(field + ' must be an object')
  const assignedTo = value.assignedTo === undefined ? undefined : nonEmpty(value.assignedTo, field + '.assignedTo')
  const labels = strings(value.labels, field + '.labels')
  return {
    ...(assignedTo === undefined ? {} : { assignedTo }),
    class: nonEmpty(value.class, field + '.class'),
    channel: nonEmpty(value.channel, field + '.channel'),
    ...(labels === undefined ? {} : { labels }),
  }
}

function parsePlugin(value: unknown, index: number): FleetPluginSpec {
  const field = 'plugins[' + index + ']'
  if (!isRecord(value)) throw new TypeError(field + ' must be an object')
  const profiles = strings(value.profiles, field + '.profiles')
  const runtimeModules = strings(value.runtimeModules, field + '.runtimeModules')
  let target: FleetPluginSpec['target']
  if (value.target !== undefined) {
    if (!isRecord(value.target)) throw new TypeError(field + '.target must be an object')
    const devices = strings(value.target.devices, field + '.target.devices')
    const classes = strings(value.target.classes, field + '.target.classes')
    const channels = strings(value.target.channels, field + '.target.channels')
    target = {
      ...(devices === undefined ? {} : { devices }),
      ...(classes === undefined ? {} : { classes }),
      ...(channels === undefined ? {} : { channels }),
    }
  }
  return {
    id: nonEmpty(value.id, field + '.id'),
    spec: nonEmpty(value.spec, field + '.spec'),
    ...(profiles === undefined ? {} : { profiles }),
    ...(runtimeModules === undefined ? {} : { runtimeModules }),
    ...(target === undefined ? {} : { target }),
  }
}

export function parseFleetManifest(source: string): FleetManifest {
  const raw: unknown = parseYaml(source)
  if (!isRecord(raw)) throw new TypeError('fleet manifest must be an object')
  if (raw.schemaVersion !== 1) throw new TypeError('schemaVersion must equal 1')
  if (!isRecord(raw.team)) throw new TypeError('team must be an object')
  const teamId = nonEmpty(raw.team.id, 'team.id')
  const teamName = raw.team.name === undefined ? undefined : nonEmpty(raw.team.name, 'team.name')
  if (!isRecord(raw.devices)) throw new TypeError('devices must be an object')
  const devices: Record<string, FleetDeviceSpec> = {}
  for (const [id, value] of Object.entries(raw.devices)) devices[nonEmpty(id, 'device id')] = parseDevice(value, 'devices.' + id)
  if (!Array.isArray(raw.plugins)) throw new TypeError('plugins must be an array')
  const plugins = raw.plugins.map(parsePlugin)
  const seen = new Set<string>()
  for (const plugin of plugins) {
    if (seen.has(plugin.id)) throw new TypeError('duplicate plugin id ' + JSON.stringify(plugin.id))
    seen.add(plugin.id)
  }
  return {
    schemaVersion: 1,
    team: { id: teamId, ...(teamName === undefined ? {} : { name: teamName }) },
    devices,
    plugins,
  }
}

function targetsDevice(plugin: FleetPluginSpec, deviceId: string, device: FleetDeviceSpec | undefined): boolean {
  const target = plugin.target
  if (target === undefined) return true
  if (target.devices !== undefined && !target.devices.includes(deviceId)) return false
  if (target.classes !== undefined && (device === undefined || !target.classes.includes(device.class))) return false
  if (target.channels !== undefined && (device === undefined || !target.channels.includes(device.channel))) return false
  return true
}

function strongestPhase(entries: RuntimePluginEntry[], modules: string[]): RuntimePhase {
  const phases = entries.filter(entry => modules.includes(entry.moduleName)).map(entry => entry.fiberPhase)
  if (phases.includes('failed')) return 'failed'
  if (phases.includes('active')) return 'active'
  if (phases.includes('loading')) return 'loading'
  if (phases.includes('pending')) return 'pending'
  if (phases.includes('unloading')) return 'unloading'
  return null
}

export interface ReconcileInput {
  manifest: FleetManifest
  deviceId: string
  profile: string
  dependencies: Record<string, string>
  bundles: string[]
  runtime: RuntimePluginEntry[]
}

export interface ReconcileResult {
  device?: FleetDeviceSpec
  plugins: PluginStatus[]
  unmanaged: Array<{ id: string; actualSpec: string }>
  summary: FleetStatus['summary']
}

export function reconcileFleet(input: ReconcileInput): ReconcileResult {
  const device = input.manifest.devices[input.deviceId]
  const desired = input.manifest.plugins
    .filter(plugin => plugin.profiles === undefined || plugin.profiles.includes(input.profile))
    .filter(plugin => targetsDevice(plugin, input.deviceId, device))
    .sort((a, b) => a.id.localeCompare(b.id))
  const plugins = desired.map((plugin): PluginStatus => {
    const actualSpec = input.dependencies[plugin.id]
    const runtimeModules = plugin.runtimeModules ?? [plugin.id]
    const runtimePhase = strongestPhase(input.runtime, runtimeModules)
    let state: PluginStatus['state']
    if (actualSpec === undefined) state = 'missing'
    else if (actualSpec !== plugin.spec) state = 'spec-drift'
    else if (runtimePhase === 'failed') state = 'runtime-failed'
    else if (runtimePhase !== 'active') state = 'runtime-inactive'
    else state = 'aligned'
    return {
      id: plugin.id,
      desiredSpec: plugin.spec,
      ...(actualSpec === undefined ? {} : { actualSpec }),
      runtimeModules,
      runtimePhase,
      state,
    }
  })
  const desiredIds = new Set(desired.map(plugin => plugin.id))
  const dependencyBundles = input.bundles.filter(id => Object.hasOwn(input.dependencies, id))
  const unmanaged = dependencyBundles
    .filter(id => !desiredIds.has(id))
    .sort()
    .map(id => ({ id, actualSpec: input.dependencies[id] as string }))
  const summary = {
    desired: plugins.length,
    aligned: plugins.filter(item => item.state === 'aligned').length,
    missing: plugins.filter(item => item.state === 'missing').length,
    drifted: plugins.filter(item => item.state === 'spec-drift' || item.state === 'runtime-inactive').length,
    failed: plugins.filter(item => item.state === 'runtime-failed').length,
    unmanaged: unmanaged.length,
  }
  return { ...(device === undefined ? {} : { device }), plugins, unmanaged, summary }
}

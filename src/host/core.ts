import { parse as parseYaml } from 'yaml'
import type {
  FleetDeviceSpec,
  FleetManifest,
  FleetPluginSpec,
  FleetPluginTarget,
  FleetStatus,
  PluginStatus,
  RuntimePhase,
  RuntimePluginEntry,
} from '../shared.ts'
import { normalizeDeviceId } from '../shared.ts'

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

function dependencySpec(source: string, revision: string | undefined, field: string): string {
  if (source.includes('#')) throw new TypeError(field + ' must not contain # when revision is separate')
  if (source === 'link:' || source.startsWith('link:')) {
    if (revision !== undefined) throw new TypeError(field + '.revision is not allowed for link sources')
    return source
  }
  if (source === 'npm') {
    if (revision === undefined) throw new TypeError(field + '.revision is required for npm source')
    return revision
  }
  return revision === undefined ? source : source + '#' + revision
}

function parsePlugin(value: unknown, index: number): FleetPluginSpec {
  const field = 'plugins[' + index + ']'
  if (!isRecord(value)) throw new TypeError(field + ' must be an object')
  const profiles = strings(value.profiles, field + '.profiles')
  const runtimeModules = strings(value.runtimeModules, field + '.runtimeModules')
  let target: FleetPluginTarget | undefined
  if (value.target !== undefined) {
    if (!isRecord(value.target)) throw new TypeError(field + '.target must be an object')
    const devices = strings(value.target.devices, field + '.target.devices')?.map((id, targetIndex) =>
      normalizeDeviceId(id, `${field}.target.devices[${targetIndex}]`))
    const classes = strings(value.target.classes, field + '.target.classes')
    const channels = strings(value.target.channels, field + '.target.channels')
    target = {
      ...(devices === undefined ? {} : { devices }),
      ...(classes === undefined ? {} : { classes }),
      ...(channels === undefined ? {} : { channels }),
    }
  }
  const id = nonEmpty(value.id, field + '.id')
  const hasSpec = value.spec !== undefined
  const hasSource = value.source !== undefined || value.revision !== undefined
  if (hasSpec === hasSource) throw new TypeError(field + ' must specify exactly one of spec or source')
  const spec = hasSpec ? nonEmpty(value.spec, field + '.spec') : undefined
  const source = hasSource ? nonEmpty(value.source, field + '.source') : undefined
  const revision = value.revision === undefined ? undefined : nonEmpty(value.revision, field + '.revision')
  const derived = spec ?? dependencySpec(source as string, revision, field)
  return {
    id,
    spec: derived,
    ...(source === undefined ? {} : { source, ...(revision === undefined ? {} : { revision }) }),
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
  for (const [id, value] of Object.entries(raw.devices)) {
    const deviceId = normalizeDeviceId(id, 'device id')
    devices[deviceId] = parseDevice(value, 'devices.' + deviceId)
  }
  if (!Array.isArray(raw.plugins)) throw new TypeError('plugins must be an array')
  const plugins = raw.plugins.map(parsePlugin)
  for (const plugin of plugins) {
    const stable = Object.entries(devices).some(([id, device]) =>
      device.channel === 'stable' && targetsDevice(plugin, id, device),
    )
    if (stable) {
      if (plugin.source?.startsWith('link:') || plugin.spec.startsWith('link:')) {
        throw new TypeError('stable plugin ' + JSON.stringify(plugin.id) + ' must not use a link source')
      }
      const exactSemver = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(plugin.spec)
      const exactSha = plugin.source !== 'npm' && !plugin.source?.startsWith('link:') &&
        (/^[0-9a-fA-F]{40}$/.test(plugin.revision ?? '') || /#[0-9a-fA-F]{40}$/.test(plugin.spec))
      if (!exactSemver && !exactSha) {
        throw new TypeError('stable plugin ' + JSON.stringify(plugin.id) + ' must use immutable exact semver or commit SHA')
      }
    }
  }
  for (let i = 0; i < plugins.length; i++) for (let j = i + 1; j < plugins.length; j++) {
    if (plugins[i]?.id !== plugins[j]?.id) continue
    const a = plugins[i] as FleetPluginSpec
    const b = plugins[j] as FleetPluginSpec
    const overlap = Object.keys(devices).some(id => targetsDevice(a, id, devices[id]) && targetsDevice(b, id, devices[id])) &&
      (a.profiles === undefined || b.profiles === undefined || a.profiles.some(profile => b.profiles?.includes(profile)))
    if (overlap) throw new TypeError('duplicate plugin id ' + JSON.stringify(a.id))
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
      ...(plugin.source === undefined ? {} : {
        desiredSource: plugin.source,
        ...(plugin.revision === undefined ? {} : { desiredRevision: plugin.revision }),
      }),
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
  return {
    ...(device === undefined ? {} : { device }),
    plugins,
    unmanaged,
    summary,
  }
}

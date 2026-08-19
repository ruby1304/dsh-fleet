import { parse as parseYaml } from 'yaml'
import { valid, validRange } from 'semver'
import type {
  FleetDeviceSpec,
  FleetManifest,
  FleetManifestV2Metadata,
  FleetPluginSpec,
  FleetPluginTarget,
  FleetProfileRelease,
  FleetReleasePlugin,
  FleetReleasePluginSource,
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

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], field: string): void {
  const extras = Object.keys(value).filter(key => !allowed.includes(key))
  if (extras.length > 0) throw new TypeError(field + ' contains unsupported fields: ' + extras.sort().join(', '))
}

function safeIdentifier(value: unknown, field: string): string {
  const id = nonEmpty(value, field)
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id)) {
    throw new TypeError(field + ' must be 1 to 64 ASCII letters, digits, dots, underscores or hyphens')
  }
  return id
}

function safePackageName(value: unknown, field: string): string {
  const id = nonEmpty(value, field)
  if (id.length > 214 || id !== id.toLowerCase() || !/^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/.test(id)) {
    throw new TypeError(field + ' must be one literal lowercase npm package name')
  }
  return id
}

function exactSemver(value: unknown, field: string): string {
  const version = nonEmpty(value, field)
  if (valid(version) !== version) throw new TypeError(field + ' must be an exact semantic version')
  return version
}

function sha256Digest(value: unknown, field: string): string {
  const digest = nonEmpty(value, field)
  if (!/^[0-9a-f]{64}$/.test(digest)) throw new TypeError(field + ' must be a lowercase SHA-256 digest')
  return digest
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

function parseReleaseSource(value: unknown, field: string, visibility: 'public' | 'private'): FleetReleasePluginSource {
  if (!isRecord(value)) throw new TypeError(field + ' must be an object')
  const kind = nonEmpty(value.kind, field + '.kind')
  if (kind === 'npm') {
    exactKeys(value, ['kind', 'version', 'integrity'], field)
    if (visibility !== 'public') throw new TypeError(field + ' private plugins must use content-addressed artifact sources')
    const integrity = value.integrity === undefined ? undefined : nonEmpty(value.integrity, field + '.integrity')
    if (integrity !== undefined && !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(integrity)) {
      throw new TypeError(field + '.integrity must be one SHA-512 Subresource Integrity value')
    }
    return {
      kind: 'npm',
      version: exactSemver(value.version, field + '.version'),
      ...(integrity === undefined ? {} : { integrity }),
    }
  }
  if (kind === 'github') {
    exactKeys(value, ['kind', 'repository', 'revision'], field)
    if (visibility !== 'public') throw new TypeError(field + ' private plugins must use content-addressed artifact sources')
    const repository = nonEmpty(value.repository, field + '.repository')
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(repository)) {
      throw new TypeError(field + '.repository must be owner/repository without a URL or revision')
    }
    const revision = nonEmpty(value.revision, field + '.revision')
    if (!/^[0-9a-f]{40}$/.test(revision)) throw new TypeError(field + '.revision must be a lowercase 40-character commit SHA')
    return { kind: 'github', repository, revision }
  }
  if (kind === 'artifact') {
    exactKeys(value, ['kind', 'digest', 'version'], field)
    if (visibility !== 'private') throw new TypeError(field + ' artifact sources must be declared private')
    return {
      kind: 'artifact',
      digest: sha256Digest(value.digest, field + '.digest'),
      version: exactSemver(value.version, field + '.version'),
    }
  }
  throw new TypeError(field + '.kind must be npm, github or artifact')
}

function parseReleasePlugin(value: unknown, field: string): FleetReleasePlugin {
  if (!isRecord(value)) throw new TypeError(field + ' must be an object')
  exactKeys(value, ['id', 'visibility', 'source', 'runtimeModules'], field)
  if (value.visibility !== 'public' && value.visibility !== 'private') {
    throw new TypeError(field + '.visibility must be public or private')
  }
  const runtimeModules = strings(value.runtimeModules, field + '.runtimeModules')
  return {
    id: safePackageName(value.id, field + '.id'),
    visibility: value.visibility,
    source: parseReleaseSource(value.source, field + '.source', value.visibility),
    ...(runtimeModules === undefined ? {} : { runtimeModules }),
  }
}

function parseProfileRelease(id: string, value: unknown, field: string): FleetProfileRelease {
  if (!isRecord(value)) throw new TypeError(field + ' must be an object')
  exactKeys(value, ['id', 'version', 'profile', 'dshRange', 'plugins'], field)
  if (value.id !== undefined && safeIdentifier(value.id, field + '.id') !== id) {
    throw new TypeError(field + '.id must match its profileReleases key')
  }
  const dshRange = nonEmpty(value.dshRange, field + '.dshRange')
  if (validRange(dshRange) === null) throw new TypeError(field + '.dshRange must be a valid semantic-version range')
  if (!Array.isArray(value.plugins) || value.plugins.length === 0) throw new TypeError(field + '.plugins must be a non-empty array')
  const plugins = value.plugins.map((plugin, index) => parseReleasePlugin(plugin, `${field}.plugins[${index}]`))
  const seen = new Set<string>()
  for (const plugin of plugins) {
    if (seen.has(plugin.id)) throw new TypeError(field + ' contains duplicate plugin id ' + JSON.stringify(plugin.id))
    seen.add(plugin.id)
  }
  return {
    id,
    version: exactSemver(value.version, field + '.version'),
    profile: safeIdentifier(value.profile, field + '.profile'),
    dshRange,
    plugins,
  }
}

function releasePluginSpec(plugin: FleetReleasePlugin): Pick<FleetPluginSpec, 'spec' | 'source' | 'revision' | 'artifactDigest'> {
  if (plugin.source.kind === 'npm') {
    return { spec: plugin.source.version, source: 'npm', revision: plugin.source.version }
  }
  if (plugin.source.kind === 'github') {
    const source = 'github:' + plugin.source.repository
    return { spec: source + '#' + plugin.source.revision, source, revision: plugin.source.revision }
  }
  return {
    spec: 'artifact:sha256:' + plugin.source.digest,
    source: 'artifact',
    revision: plugin.source.version,
    artifactDigest: plugin.source.digest,
  }
}

function parseManifestV2(raw: Record<string, unknown>, team: FleetManifest['team'], devices: Record<string, FleetDeviceSpec>): FleetManifest {
  exactKeys(raw, ['schemaVersion', 'team', 'devices', 'profileReleases', 'assignments'], 'fleet manifest')
  if (!isRecord(raw.profileReleases)) throw new TypeError('profileReleases must be an object')
  const profileReleases: Record<string, FleetProfileRelease> = {}
  for (const [rawId, value] of Object.entries(raw.profileReleases)) {
    const id = safeIdentifier(rawId, 'profile release id')
    profileReleases[id] = parseProfileRelease(id, value, 'profileReleases.' + id)
  }
  if (Object.keys(profileReleases).length === 0) throw new TypeError('profileReleases must not be empty')
  if (!isRecord(raw.assignments)) throw new TypeError('assignments must be an object')
  const assignments: FleetManifestV2Metadata['assignments'] = {}
  const plugins: FleetPluginSpec[] = []
  for (const [rawDeviceId, value] of Object.entries(raw.assignments)) {
    const deviceId = normalizeDeviceId(rawDeviceId, 'assignment device id')
    if (devices[deviceId] === undefined) throw new TypeError('assignments.' + deviceId + ' references an unknown device')
    if (!isRecord(value) || Object.keys(value).length === 0) {
      throw new TypeError('assignments.' + deviceId + ' must be a non-empty profile-to-release object')
    }
    const deviceAssignments: Record<string, string> = {}
    for (const [rawProfile, rawReleaseId] of Object.entries(value)) {
      const profile = safeIdentifier(rawProfile, `assignments.${deviceId} profile`)
      const releaseId = safeIdentifier(rawReleaseId, `assignments.${deviceId}.${profile}`)
      const release = profileReleases[releaseId]
      if (release === undefined) throw new TypeError(`assignments.${deviceId}.${profile} references unknown release ${JSON.stringify(releaseId)}`)
      if (release.profile !== profile) {
        throw new TypeError(`assignments.${deviceId}.${profile} references release for profile ${JSON.stringify(release.profile)}`)
      }
      deviceAssignments[profile] = releaseId
      for (const plugin of release.plugins) {
        plugins.push({
          id: plugin.id,
          ...releasePluginSpec(plugin),
          visibility: plugin.visibility,
          releaseId,
          releaseVersion: release.version,
          profiles: [profile],
          ...(plugin.runtimeModules === undefined ? {} : { runtimeModules: plugin.runtimeModules }),
          target: { devices: [deviceId] },
        })
      }
    }
    assignments[deviceId] = deviceAssignments
  }
  return {
    schemaVersion: 2,
    team,
    devices,
    plugins,
    v2: { profileReleases, assignments },
  }
}

export function parseFleetManifest(source: string): FleetManifest {
  const raw: unknown = parseYaml(source)
  if (!isRecord(raw)) throw new TypeError('fleet manifest must be an object')
  if (raw.schemaVersion !== 1 && raw.schemaVersion !== 2) throw new TypeError('schemaVersion must equal 1 or 2')
  if (!isRecord(raw.team)) throw new TypeError('team must be an object')
  if (raw.schemaVersion === 2) exactKeys(raw.team, ['id', 'name'], 'team')
  const teamId = nonEmpty(raw.team.id, 'team.id')
  const teamName = raw.team.name === undefined ? undefined : nonEmpty(raw.team.name, 'team.name')
  if (!isRecord(raw.devices)) throw new TypeError('devices must be an object')
  const devices: Record<string, FleetDeviceSpec> = {}
  for (const [id, value] of Object.entries(raw.devices)) {
    const deviceId = normalizeDeviceId(id, 'device id')
    if (raw.schemaVersion === 2 && isRecord(value)) exactKeys(value, ['assignedTo', 'class', 'channel', 'labels'], 'devices.' + deviceId)
    devices[deviceId] = parseDevice(value, 'devices.' + deviceId)
  }
  const team = { id: teamId, ...(teamName === undefined ? {} : { name: teamName }) }
  if (raw.schemaVersion === 2) return parseManifestV2(raw, team, devices)
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
    team,
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
  artifactDigests?: Record<string, string>
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
    const actualArtifactDigest = input.artifactDigests?.[plugin.id]
    const runtimeModules = plugin.runtimeModules ?? [plugin.id]
    const runtimePhase = strongestPhase(input.runtime, runtimeModules)
    let state: PluginStatus['state']
    if (actualSpec === undefined) state = 'missing'
    else if (plugin.artifactDigest !== undefined && actualArtifactDigest !== plugin.artifactDigest) state = 'spec-drift'
    else if (plugin.artifactDigest === undefined && actualSpec !== plugin.spec) state = 'spec-drift'
    else if (runtimePhase === 'failed') state = 'runtime-failed'
    else if (runtimePhase !== 'active') state = 'runtime-inactive'
    else state = 'aligned'
    return {
      id: plugin.id,
      desiredSpec: plugin.spec,
      ...(plugin.visibility === undefined ? {} : { visibility: plugin.visibility }),
      ...(plugin.releaseId === undefined ? {} : { releaseId: plugin.releaseId }),
      ...(plugin.releaseVersion === undefined ? {} : { releaseVersion: plugin.releaseVersion }),
      ...(plugin.artifactDigest === undefined ? {} : { desiredArtifactDigest: plugin.artifactDigest }),
      ...(actualArtifactDigest === undefined ? {} : { actualArtifactDigest }),
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

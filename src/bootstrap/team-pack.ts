import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { valid } from 'semver'
import { isAbsolute, normalize } from 'node:path'
import { parseFleetManifest } from '../host/core.ts'
import {
  a2aKeyId,
  FLEET_A2A_KINDS,
  isFleetFederationAdvisoryKind,
  type FleetA2AKind,
  type FleetA2ATrustEntry,
} from '../a2a/protocol.ts'
import {
  assertA2AReadyConfig,
  assertReleaseReadyConfig,
  parseAgentConfig,
  type AgentHealthConfig,
  type AgentRestartConfig,
  type TaskPolicyId,
} from '../agent/config.ts'

export interface FleetTeamPack {
  schemaVersion: 1
  pack: { id: string; version: string }
  profile: { id: string; dshRange: string }
  publicPlugins: Array<{
    id: string
    source:
      | { kind: 'npm'; version: string; integrity: string }
      | { kind: 'github'; repository: string; revision: string }
    runtimeModules?: string[]
  }>
  taskPolicy: { profiles: string[]; workspaceIds: string[] }
  trustAnchors: FleetA2ATrustEntry[]
}

export interface FleetTeamOverlay {
  schemaVersion: 1
  team: { id: string; name?: string }
  device: { id: string; assignedTo: string; class: string; channel: 'stable' }
  route: FleetTeamRoute
  release: { id: string; version: string }
  privatePlugins: Array<{
    id: string
    version: string
    digest: string
    runtimeModules?: string[]
  }>
  workspacePaths: Record<string, string>
  trustedPeers: FleetA2ATrustEntry[]
  agent: FleetTeamAgentSettings
}

export type FleetTeamRoute =
  | {
    transport: 'local'
    nodeBinary: string
    agentPath: string
    configPath: string
  }
  | {
    transport: 'ssh'
    sshHost: string
    nodeBinary: string
    agentPath: string
    configPath: string
  }

export interface FleetTeamAgentSettings {
  dshHome: string
  dshBinary: string
  pnpmBinary: string
  stateDir: string
  artifactStore: string
  tarBinary: string
  planTtlMs: number
  restart: AgentRestartConfig
  health: AgentHealthConfig
  maxMessageTtlMs: number
  tasks: {
    enabled: boolean
    timeoutMs: number
    maxOutputBytes: number
    maxConcurrent: number
    policyIds: TaskPolicyId[]
  }
}

export interface InstantiatedTeamPack {
  manifestYaml: string
  trustStoreJson: string
  taskPolicy: { profiles: string[]; workspaces: Record<string, string> }
}

export interface InstantiatedTeamPackDevice {
  deviceId: string
  releaseId: string
  overlay: FleetTeamOverlay
  trustStoreJson: string
  taskPolicy: { profiles: string[]; workspaces: Record<string, string> }
}

export interface InstantiatedTeamPackSet {
  manifestYaml: string
  devices: InstantiatedTeamPackDevice[]
}

export type FleetGenerationRoute = FleetTeamRoute & { deviceId: string }

export interface FleetGenerationRoutes {
  schemaVersion: 1
  teamId: string
  routes: FleetGenerationRoute[]
}

export interface TeamPackOutputPaths {
  manifestPath: string
  desiredManifestPath?: string
  trustStorePath: string
  privateKeyPath: string
}

function compareCanonicalIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], field: string): void {
  const extras = Object.keys(value).filter(key => !allowed.includes(key))
  if (extras.length > 0) throw new TypeError(field + ' contains unsupported fields: ' + extras.sort().join(', '))
}

function text(value: unknown, field: string, max = 128): string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim() || value.length > max || /[\r\n\0]/.test(value)) {
    throw new TypeError(field + ' must be a bounded trimmed string')
  }
  return value
}

function publicKeyText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096 || value.includes('\0')) {
    throw new TypeError(field + ' must be a bounded PEM public key')
  }
  const pem = value.replace(/\r\n/g, '\n').trim()
  if (!pem.startsWith('-----BEGIN PUBLIC KEY-----\n') || !pem.endsWith('\n-----END PUBLIC KEY-----')) {
    throw new TypeError(field + ' must be a PEM public key')
  }
  return pem + '\n'
}

function identifier(value: unknown, field: string): string {
  const id = text(value, field, 64)
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id)) throw new TypeError(field + ' contains unsupported characters')
  return id
}

function packageId(value: unknown, field: string): string {
  const id = text(value, field, 214)
  if (id !== id.toLowerCase() || !/^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/.test(id)) {
    throw new TypeError(field + ' must be a literal lowercase npm package name')
  }
  return id
}

function exactVersion(value: unknown, field: string): string {
  const version = text(value, field, 128)
  if (valid(version) !== version) throw new TypeError(field + ' must be an exact semantic version')
  return version
}

function routePath(value: unknown, field: string): string {
  const path = text(value, field, 1024)
  if (!isAbsolute(path) || normalize(path) !== path || !/^\/[A-Za-z0-9._/-]+$/.test(path)) {
    throw new TypeError(field + ' must be a normalized absolute path without shell metacharacters')
  }
  return path
}

function parseRoute(value: unknown): FleetTeamRoute {
  if (!isRecord(value)) throw new TypeError('route must be an object')
  const transport = text(value.transport, 'route.transport', 16)
  if (transport !== 'local' && transport !== 'ssh') throw new TypeError('route.transport must be local or ssh')
  exactKeys(value, transport === 'local'
    ? ['transport', 'nodeBinary', 'agentPath', 'configPath']
    : ['transport', 'sshHost', 'nodeBinary', 'agentPath', 'configPath'], 'route')
  const common = {
    nodeBinary: routePath(value.nodeBinary, 'route.nodeBinary'),
    agentPath: routePath(value.agentPath, 'route.agentPath'),
    configPath: routePath(value.configPath, 'route.configPath'),
  }
  if (transport === 'local') return { transport, ...common }
  const sshHost = text(value.sshHost, 'route.sshHost', 253)
  if (sshHost.startsWith('-') || !/^[A-Za-z0-9._-]+$/.test(sshHost)) {
    throw new TypeError('route.sshHost must be a configured host alias')
  }
  return { transport, sshHost, ...common }
}

export function parseGenerationRoutes(source: string): FleetGenerationRoutes {
  let value: unknown
  try {
    value = JSON.parse(source) as unknown
  } catch {
    throw new TypeError('routes.json must contain JSON')
  }
  if (!isRecord(value)) throw new TypeError('routes.json must be an object')
  exactKeys(value, ['schemaVersion', 'teamId', 'routes'], 'routes.json')
  if (value.schemaVersion !== 1 || !Array.isArray(value.routes) || value.routes.length === 0) {
    throw new TypeError('routes.json schema or routes are invalid')
  }
  const routes = value.routes.map((entry, index): FleetGenerationRoute => {
    const field = `routes[${index}]`
    if (!isRecord(entry)) throw new TypeError(field + ' must be an object')
    const deviceId = identifier(entry.deviceId, field + '.deviceId')
    const { deviceId: _deviceId, ...routeValue } = entry
    return { deviceId, ...parseRoute(routeValue) } as FleetGenerationRoute
  })
  const deviceIds = routes.map(route => route.deviceId)
  if (new Set(deviceIds).size !== deviceIds.length) throw new TypeError('routes.json device ids must be unique')
  if (deviceIds.some((deviceId, index) => index > 0 && compareCanonicalIds(deviceIds[index - 1]!, deviceId) >= 0)) {
    throw new TypeError('routes.json routes must be sorted by device id')
  }
  return { schemaVersion: 1, teamId: identifier(value.teamId, 'routes.json teamId'), routes }
}

export function createGenerationRoutes(instantiated: InstantiatedTeamPackSet): string {
  const first = instantiated.devices[0]
  if (first === undefined) throw new TypeError('generation routes require at least one device')
  const value: FleetGenerationRoutes = {
    schemaVersion: 1,
    teamId: first.overlay.team.id,
    routes: instantiated.devices.map(device => ({ deviceId: device.deviceId, ...device.overlay.route }) as FleetGenerationRoute),
  }
  return JSON.stringify(value, null, 2) + '\n'
}

function strings(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some(item => typeof item !== 'string')) {
    throw new TypeError(field + ' must be a non-empty string array')
  }
  const values = value.map((item, index) => identifier(item, `${field}[${index}]`))
  if (new Set(values).size !== values.length) throw new TypeError(field + ' must not contain duplicates')
  return values
}

function runtimeModules(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length === 0 || value.some(item => typeof item !== 'string')) {
    throw new TypeError(field + ' must be a non-empty package-name array')
  }
  const values = value.map((item, index) => packageId(item, `${field}[${index}]`))
  if (new Set(values).size !== values.length) throw new TypeError(field + ' must not contain duplicates')
  return values
}

function trustEntry(value: unknown, field: string, federationOnly: boolean): FleetA2ATrustEntry {
  if (!isRecord(value)) throw new TypeError(field + ' must be an object')
  exactKeys(value, ['teamId', 'keyId', 'principalId', 'deviceId', 'publicKeyPem', 'allowedKinds'], field)
  const allowedKinds = value.allowedKinds
  if (!Array.isArray(allowedKinds) || allowedKinds.length === 0 || allowedKinds.some(kind => typeof kind !== 'string' || !FLEET_A2A_KINDS.includes(kind as FleetA2AKind))) {
    throw new TypeError(field + '.allowedKinds is invalid')
  }
  if (federationOnly && allowedKinds.some(kind => !isFleetFederationAdvisoryKind(kind as FleetA2AKind))) {
    throw new TypeError(field + ' public federation anchors cannot grant task execution')
  }
  if (new Set(allowedKinds).size !== allowedKinds.length) throw new TypeError(field + '.allowedKinds must not contain duplicates')
  const keyId = text(value.keyId, field + '.keyId', 80)
  if (!/^ed25519:[0-9a-f]{64}$/.test(keyId)) throw new TypeError(field + '.keyId is invalid')
  const publicKeyPem = publicKeyText(value.publicKeyPem, field + '.publicKeyPem')
  let derivedKeyId: string
  try {
    derivedKeyId = a2aKeyId(publicKeyPem)
  } catch {
    throw new TypeError(field + '.publicKeyPem must contain an Ed25519 public key')
  }
  if (derivedKeyId !== keyId) throw new TypeError(field + '.keyId does not match publicKeyPem')
  return {
    teamId: identifier(value.teamId, field + '.teamId'),
    keyId,
    principalId: identifier(value.principalId, field + '.principalId'),
    deviceId: identifier(value.deviceId, field + '.deviceId'),
    publicKeyPem,
    allowedKinds: allowedKinds as FleetA2AKind[],
  }
}

export function parseTeamPack(source: string): FleetTeamPack {
  const raw: unknown = parseYaml(source)
  if (!isRecord(raw)) throw new TypeError('team pack must be an object')
  exactKeys(raw, ['schemaVersion', 'pack', 'profile', 'publicPlugins', 'taskPolicy', 'trustAnchors'], 'team pack')
  if (raw.schemaVersion !== 1) throw new TypeError('team pack schemaVersion must equal 1')
  if (!isRecord(raw.pack) || !isRecord(raw.profile) || !isRecord(raw.taskPolicy)) throw new TypeError('team pack sections must be objects')
  exactKeys(raw.pack, ['id', 'version'], 'pack')
  exactKeys(raw.profile, ['id', 'dshRange'], 'profile')
  exactKeys(raw.taskPolicy, ['profiles', 'workspaceIds'], 'taskPolicy')
  if (!Array.isArray(raw.publicPlugins) || raw.publicPlugins.length === 0) throw new TypeError('publicPlugins must be a non-empty array')
  const publicPlugins = raw.publicPlugins.map((value, index) => {
    const field = `publicPlugins[${index}]`
    if (!isRecord(value)) throw new TypeError(field + ' must be an object')
    exactKeys(value, ['id', 'source', 'runtimeModules'], field)
    if (!isRecord(value.source)) throw new TypeError(field + '.source must be an object')
    const kind = text(value.source.kind, field + '.source.kind')
    let source: FleetTeamPack['publicPlugins'][number]['source']
    if (kind === 'npm') {
      exactKeys(value.source, ['kind', 'version', 'integrity'], field + '.source')
      const integrity = text(value.source.integrity, field + '.source.integrity', 512)
      if (!/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(integrity)) throw new TypeError(field + '.source.integrity is invalid')
      source = { kind: 'npm', version: exactVersion(value.source.version, field + '.source.version'), integrity }
    } else if (kind === 'github') {
      exactKeys(value.source, ['kind', 'repository', 'revision'], field + '.source')
      const repository = text(value.source.repository, field + '.source.repository', 256)
      const revision = text(value.source.revision, field + '.source.revision', 40)
      if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || !/^[0-9a-f]{40}$/.test(revision)) {
        throw new TypeError(field + '.source must use owner/repository and a lowercase 40-character SHA')
      }
      source = { kind: 'github', repository, revision }
    } else throw new TypeError(field + '.source.kind must be npm or github')
    const modules = runtimeModules(value.runtimeModules, field + '.runtimeModules')
    return { id: packageId(value.id, field + '.id'), source, ...(modules === undefined ? {} : { runtimeModules: modules }) }
  })
  const ids = publicPlugins.map(plugin => plugin.id)
  if (new Set(ids).size !== ids.length) throw new TypeError('publicPlugins ids must be unique')
  const trustAnchors = raw.trustAnchors === undefined ? [] : raw.trustAnchors
  if (!Array.isArray(trustAnchors)) throw new TypeError('trustAnchors must be an array')
  return {
    schemaVersion: 1,
    pack: { id: identifier(raw.pack.id, 'pack.id'), version: exactVersion(raw.pack.version, 'pack.version') },
    profile: { id: identifier(raw.profile.id, 'profile.id'), dshRange: text(raw.profile.dshRange, 'profile.dshRange', 256) },
    publicPlugins,
    taskPolicy: {
      profiles: strings(raw.taskPolicy.profiles, 'taskPolicy.profiles'),
      workspaceIds: strings(raw.taskPolicy.workspaceIds, 'taskPolicy.workspaceIds'),
    },
    trustAnchors: trustAnchors.map((entry, index) => trustEntry(entry, `trustAnchors[${index}]`, true)),
  }
}

export function parseTeamOverlay(source: string): FleetTeamOverlay {
  const raw: unknown = parseYaml(source)
  if (!isRecord(raw)) throw new TypeError('team overlay must be an object')
  exactKeys(raw, ['schemaVersion', 'team', 'device', 'route', 'release', 'privatePlugins', 'workspacePaths', 'trustedPeers', 'agent'], 'team overlay')
  if (raw.schemaVersion !== 1 || !isRecord(raw.team) || !isRecord(raw.device) || !isRecord(raw.release) || !isRecord(raw.workspacePaths) || !isRecord(raw.agent)) {
    throw new TypeError('team overlay schema or sections are invalid')
  }
  exactKeys(raw.team, ['id', 'name'], 'team')
  exactKeys(raw.device, ['id', 'assignedTo', 'class', 'channel'], 'device')
  exactKeys(raw.release, ['id', 'version'], 'release')
  if (raw.device.channel !== 'stable') throw new TypeError('device.channel must be stable')
  const privatePluginsRaw = raw.privatePlugins ?? []
  if (!Array.isArray(privatePluginsRaw)) throw new TypeError('privatePlugins must be an array')
  const privatePlugins = privatePluginsRaw.map((value, index) => {
    const field = `privatePlugins[${index}]`
    if (!isRecord(value)) throw new TypeError(field + ' must be an object')
    exactKeys(value, ['id', 'version', 'digest', 'runtimeModules'], field)
    const digest = text(value.digest, field + '.digest', 64)
    if (!/^[0-9a-f]{64}$/.test(digest)) throw new TypeError(field + '.digest must be lowercase SHA-256')
    const modules = runtimeModules(value.runtimeModules, field + '.runtimeModules')
    return {
      id: packageId(value.id, field + '.id'), version: exactVersion(value.version, field + '.version'), digest,
      ...(modules === undefined ? {} : { runtimeModules: modules }),
    }
  })
  const privatePluginIds = privatePlugins.map(plugin => plugin.id)
  if (new Set(privatePluginIds).size !== privatePluginIds.length) throw new TypeError('privatePlugins ids must be unique')
  const workspacePaths: Record<string, string> = {}
  for (const [rawId, path] of Object.entries(raw.workspacePaths)) {
    const id = identifier(rawId, 'workspace id')
    const absolute = text(path, `workspacePaths.${id}`, 1024)
    if (!isAbsolute(absolute) || normalize(absolute) !== absolute) throw new TypeError(`workspacePaths.${id} must be a normalized absolute path`)
    workspacePaths[id] = absolute
  }
  if (!Array.isArray(raw.trustedPeers)) throw new TypeError('trustedPeers must be an array')
  exactKeys(raw.agent, [
    'dshHome', 'dshBinary', 'pnpmBinary', 'stateDir', 'artifactStore', 'tarBinary', 'planTtlMs',
    'restart', 'health', 'maxMessageTtlMs', 'tasks',
  ], 'agent')
  if (!isRecord(raw.agent.tasks)) throw new TypeError('agent.tasks must be an object')
  exactKeys(raw.agent.tasks, ['enabled', 'timeoutMs', 'maxOutputBytes', 'maxConcurrent', 'policyIds'], 'agent.tasks')
  const teamId = identifier(raw.team.id, 'team.id')
  const deviceId = identifier(raw.device.id, 'device.id')
  const principalId = identifier(raw.device.assignedTo, 'device.assignedTo')
  const trustedPeers = raw.trustedPeers.map((entry, index) => trustEntry(entry, `trustedPeers[${index}]`, false))
  for (const peer of trustedPeers) {
    if (peer.teamId !== teamId && peer.allowedKinds.some(kind => !isFleetFederationAdvisoryKind(kind))) {
      throw new TypeError('foreign trustedPeers can grant advisory federation messages only')
    }
  }
  const probe = parseAgentConfig({
    schemaVersion: 2,
    deviceId,
    manifestPath: '/tmp/dsh-fleet-bootstrap/fleet.lock.yaml',
    dshHome: raw.agent.dshHome,
    dshBinary: raw.agent.dshBinary,
    pnpmBinary: raw.agent.pnpmBinary,
    profile: 'bootstrap',
    stateDir: raw.agent.stateDir,
    planTtlMs: raw.agent.planTtlMs,
    restart: raw.agent.restart,
    health: raw.agent.health,
    artifactStore: raw.agent.artifactStore,
    tarBinary: raw.agent.tarBinary,
    a2a: {
      teamId,
      principalId,
      privateKeyPath: '/tmp/dsh-fleet-bootstrap/identity.private.pem',
      trustStorePath: '/tmp/dsh-fleet-bootstrap/trust-store.json',
      maxMessageTtlMs: raw.agent.maxMessageTtlMs,
    },
    tasks: {
      enabled: raw.agent.tasks.enabled,
      workspaces: workspacePaths,
      profiles: ['bootstrap'],
      timeoutMs: raw.agent.tasks.timeoutMs,
      maxOutputBytes: raw.agent.tasks.maxOutputBytes,
      maxConcurrent: raw.agent.tasks.maxConcurrent,
      policyIds: raw.agent.tasks.policyIds,
    },
  })
  assertReleaseReadyConfig(probe)
  assertA2AReadyConfig(probe)
  return {
    schemaVersion: 1,
    team: {
      id: teamId,
      ...(raw.team.name === undefined ? {} : { name: text(raw.team.name, 'team.name', 128) }),
    },
    device: {
      id: deviceId,
      assignedTo: principalId,
      class: identifier(raw.device.class, 'device.class'),
      channel: 'stable',
    },
    route: parseRoute(raw.route),
    release: { id: identifier(raw.release.id, 'release.id'), version: exactVersion(raw.release.version, 'release.version') },
    privatePlugins,
    workspacePaths,
    trustedPeers,
    agent: {
      dshHome: probe.dshHome,
      dshBinary: probe.dshBinary,
      pnpmBinary: probe.pnpmBinary,
      stateDir: probe.stateDir,
      artifactStore: probe.artifactStore,
      tarBinary: probe.tarBinary,
      planTtlMs: probe.planTtlMs,
      restart: probe.restart,
      health: probe.health,
      maxMessageTtlMs: probe.a2a.maxMessageTtlMs,
      tasks: {
        enabled: probe.tasks.enabled,
        timeoutMs: probe.tasks.timeoutMs,
        maxOutputBytes: probe.tasks.maxOutputBytes,
        maxConcurrent: probe.tasks.maxConcurrent,
        policyIds: probe.tasks.policyIds,
      },
    },
  }
}

function absoluteOutputPath(value: string, field: string): string {
  if (!isAbsolute(value) || normalize(value) !== value || value.includes('\0')) {
    throw new TypeError(field + ' must be a normalized absolute path')
  }
  return value
}

export function createTeamAgentConfig(
  pack: FleetTeamPack,
  overlay: FleetTeamOverlay,
  paths: TeamPackOutputPaths,
): string {
  const parsed = parseAgentConfig({
    schemaVersion: 2,
    deviceId: overlay.device.id,
    manifestPath: absoluteOutputPath(paths.manifestPath, 'manifestPath'),
    ...(paths.desiredManifestPath === undefined ? {} : {
      desiredManifestPath: absoluteOutputPath(paths.desiredManifestPath, 'desiredManifestPath'),
    }),
    dshHome: overlay.agent.dshHome,
    dshBinary: overlay.agent.dshBinary,
    pnpmBinary: overlay.agent.pnpmBinary,
    profile: pack.profile.id,
    stateDir: overlay.agent.stateDir,
    planTtlMs: overlay.agent.planTtlMs,
    restart: overlay.agent.restart,
    health: overlay.agent.health,
    artifactStore: overlay.agent.artifactStore,
    tarBinary: overlay.agent.tarBinary,
    a2a: {
      teamId: overlay.team.id,
      principalId: overlay.device.assignedTo,
      privateKeyPath: absoluteOutputPath(paths.privateKeyPath, 'privateKeyPath'),
      trustStorePath: absoluteOutputPath(paths.trustStorePath, 'trustStorePath'),
      maxMessageTtlMs: overlay.agent.maxMessageTtlMs,
    },
    tasks: {
      enabled: overlay.agent.tasks.enabled,
      workspaces: overlay.workspacePaths,
      profiles: pack.taskPolicy.profiles,
      timeoutMs: overlay.agent.tasks.timeoutMs,
      maxOutputBytes: overlay.agent.tasks.maxOutputBytes,
      maxConcurrent: overlay.agent.tasks.maxConcurrent,
      policyIds: overlay.agent.tasks.policyIds,
    },
  })
  assertReleaseReadyConfig(parsed)
  assertA2AReadyConfig(parsed)
  const { policies: _resolvedPolicies, ...serializableTasks } = parsed.tasks
  const config = { ...parsed, tasks: serializableTasks }
  return JSON.stringify(config, null, 2) + '\n'
}

export function instantiateTeamPack(pack: FleetTeamPack, overlay: FleetTeamOverlay): InstantiatedTeamPack {
  const instantiated = instantiateTeamPackSet(pack, [overlay])
  const device = instantiated.devices[0]
  if (device === undefined) throw new TypeError('team pack set did not produce a device')
  return {
    manifestYaml: instantiated.manifestYaml,
    trustStoreJson: device.trustStoreJson,
    taskPolicy: device.taskPolicy,
  }
}

function assertWorkspaceInstantiation(pack: FleetTeamPack, overlay: FleetTeamOverlay): void {
  const workspaceIds = Object.keys(overlay.workspacePaths).sort()
  const expectedWorkspaceIds = [...pack.taskPolicy.workspaceIds].sort()
  if (workspaceIds.length !== expectedWorkspaceIds.length || workspaceIds.some((id, index) => id !== expectedWorkspaceIds[index])) {
    throw new TypeError('overlay workspacePaths must exactly instantiate the pack workspaceIds')
  }
}

function assertStableSources(pack: FleetTeamPack, overlay: FleetTeamOverlay): void {
  if (overlay.device.channel !== 'stable') throw new TypeError('device.channel must be stable')
  const publicPluginIds = new Set<string>()
  for (const plugin of pack.publicPlugins) {
    if (publicPluginIds.has(plugin.id)) throw new TypeError('publicPlugins ids must be unique')
    publicPluginIds.add(plugin.id)
    if (plugin.source.kind === 'npm') {
      if (valid(plugin.source.version) !== plugin.source.version || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(plugin.source.integrity)) {
        throw new TypeError('public npm plugin source must use an exact version and sha512 integrity: ' + plugin.id)
      }
    } else if (!/^[0-9a-f]{40}$/.test(plugin.source.revision)) {
      throw new TypeError('public GitHub plugin source must use a lowercase 40-character SHA: ' + plugin.id)
    }
  }
  const privatePluginIds = new Set<string>()
  for (const plugin of overlay.privatePlugins) {
    if (privatePluginIds.has(plugin.id)) throw new TypeError('privatePlugins ids must be unique')
    privatePluginIds.add(plugin.id)
    if (valid(plugin.version) !== plugin.version || !/^[0-9a-f]{64}$/.test(plugin.digest)) {
      throw new TypeError('private plugin source must use an exact version and lowercase SHA-256: ' + plugin.id)
    }
  }
}

function releaseForOverlay(pack: FleetTeamPack, overlay: FleetTeamOverlay) {
  const publicIds = new Set(pack.publicPlugins.map(plugin => plugin.id))
  for (const plugin of overlay.privatePlugins) {
    if (publicIds.has(plugin.id)) throw new TypeError('private plugin id conflicts with a public pack plugin: ' + plugin.id)
  }
  const releasePlugins = [
    ...[...pack.publicPlugins].sort((left, right) => compareCanonicalIds(left.id, right.id)).map(plugin => ({
      id: plugin.id,
      visibility: 'public',
      source: plugin.source.kind === 'npm'
        ? { kind: 'npm' as const, version: plugin.source.version, integrity: plugin.source.integrity }
        : { kind: 'github' as const, repository: plugin.source.repository, revision: plugin.source.revision },
      ...(plugin.runtimeModules === undefined ? {} : { runtimeModules: [...plugin.runtimeModules].sort() }),
    })),
    ...[...overlay.privatePlugins].sort((left, right) => compareCanonicalIds(left.id, right.id)).map(plugin => ({
      id: plugin.id,
      visibility: 'private',
      source: { kind: 'artifact', version: plugin.version, digest: plugin.digest },
      ...(plugin.runtimeModules === undefined ? {} : { runtimeModules: [...plugin.runtimeModules].sort() }),
    })),
  ]
  return {
    version: overlay.release.version,
    profile: pack.profile.id,
    dshRange: pack.profile.dshRange,
    plugins: releasePlugins,
  }
}

function deviceTrustAndPolicy(pack: FleetTeamPack, overlay: FleetTeamOverlay): Pick<InstantiatedTeamPackDevice, 'trustStoreJson' | 'taskPolicy'> {
  const trustEntries = [...pack.trustAnchors, ...overlay.trustedPeers]
  const keys = new Set<string>()
  for (const entry of trustEntries) {
    if (keys.has(entry.keyId)) throw new TypeError('duplicate trust key id: ' + entry.keyId)
    keys.add(entry.keyId)
  }
  return {
    trustStoreJson: JSON.stringify({ schemaVersion: 2, teamId: overlay.team.id, entries: trustEntries }, null, 2) + '\n',
    taskPolicy: { profiles: pack.taskPolicy.profiles, workspaces: overlay.workspacePaths },
  }
}

export function instantiateTeamPackSet(pack: FleetTeamPack, overlays: FleetTeamOverlay[]): InstantiatedTeamPackSet {
  if (overlays.length === 0) throw new TypeError('team pack set requires at least one device overlay')
  const orderedOverlays = [...overlays].sort((left, right) => compareCanonicalIds(left.device.id, right.device.id))
  const canonicalTeam = orderedOverlays[0]?.team
  if (canonicalTeam === undefined) throw new TypeError('team pack set requires at least one device overlay')
  const seenDevices = new Set<string>()
  const releases = new Map<string, ReturnType<typeof releaseForOverlay>>()
  const devices: InstantiatedTeamPackDevice[] = []

  for (const overlay of orderedOverlays) {
    if (overlay.team.id !== canonicalTeam.id || overlay.team.name !== canonicalTeam.name) {
      throw new TypeError('all overlays must use the exact same team id and name')
    }
    if (seenDevices.has(overlay.device.id)) throw new TypeError('duplicate device id: ' + overlay.device.id)
    seenDevices.add(overlay.device.id)
    assertWorkspaceInstantiation(pack, overlay)
    assertStableSources(pack, overlay)
    const release = releaseForOverlay(pack, overlay)
    const existingRelease = releases.get(overlay.release.id)
    if (existingRelease !== undefined && JSON.stringify(existingRelease) !== JSON.stringify(release)) {
      throw new TypeError('release id has conflicting definitions: ' + overlay.release.id)
    }
    if (existingRelease === undefined) releases.set(overlay.release.id, release)
    devices.push({
      deviceId: overlay.device.id,
      releaseId: overlay.release.id,
      overlay,
      ...deviceTrustAndPolicy(pack, overlay),
    })
  }

  const manifestDevices = Object.fromEntries(devices.map(device => [device.deviceId, {
    assignedTo: device.overlay.device.assignedTo,
    class: device.overlay.device.class,
    channel: device.overlay.device.channel,
  }]))
  const manifestReleases = Object.fromEntries([...releases.entries()].sort(([left], [right]) => compareCanonicalIds(left, right)))
  const assignments = Object.fromEntries(devices.map(device => [device.deviceId, { [pack.profile.id]: device.releaseId }]))
  const manifestObject = {
    schemaVersion: 2,
    team: {
      id: canonicalTeam.id,
      ...(canonicalTeam.name === undefined ? {} : { name: canonicalTeam.name }),
    },
    devices: manifestDevices,
    profileReleases: manifestReleases,
    assignments,
  }
  const manifestYaml = stringifyYaml(manifestObject, { lineWidth: 0 })
  parseFleetManifest(manifestYaml)
  return { manifestYaml, devices }
}

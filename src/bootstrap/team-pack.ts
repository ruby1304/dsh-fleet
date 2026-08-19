import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { valid } from 'semver'
import { isAbsolute, normalize } from 'node:path'
import { parseFleetManifest } from '../host/core.ts'
import { a2aKeyId, FLEET_A2A_KINDS, type FleetA2AKind, type FleetA2ATrustEntry } from '../a2a/protocol.ts'
import {
  assertA2AReadyConfig,
  assertReleaseReadyConfig,
  parseAgentConfig,
  type AgentHealthConfig,
  type AgentRestartConfig,
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
  }
}

export interface InstantiatedTeamPack {
  manifestYaml: string
  trustStoreJson: string
  taskPolicy: { profiles: string[]; workspaces: Record<string, string> }
}

export interface TeamPackOutputPaths {
  manifestPath: string
  trustStorePath: string
  privateKeyPath: string
}

const FEDERATION_KINDS = new Set<FleetA2AKind>(['handoff', 'approval.request', 'approval.decision', 'receipt'])

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
  return strings(value, field)
}

function trustEntry(value: unknown, field: string, federationOnly: boolean): FleetA2ATrustEntry {
  if (!isRecord(value)) throw new TypeError(field + ' must be an object')
  exactKeys(value, ['keyId', 'principalId', 'deviceId', 'publicKeyPem', 'allowedKinds'], field)
  const allowedKinds = value.allowedKinds
  if (!Array.isArray(allowedKinds) || allowedKinds.length === 0 || allowedKinds.some(kind => typeof kind !== 'string' || !FLEET_A2A_KINDS.includes(kind as FleetA2AKind))) {
    throw new TypeError(field + '.allowedKinds is invalid')
  }
  if (federationOnly && allowedKinds.some(kind => !FEDERATION_KINDS.has(kind as FleetA2AKind))) {
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
  exactKeys(raw, ['schemaVersion', 'team', 'device', 'release', 'privatePlugins', 'workspacePaths', 'trustedPeers', 'agent'], 'team overlay')
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
  exactKeys(raw.agent.tasks, ['enabled', 'timeoutMs', 'maxOutputBytes', 'maxConcurrent'], 'agent.tasks')
  const teamId = identifier(raw.team.id, 'team.id')
  const deviceId = identifier(raw.device.id, 'device.id')
  const principalId = identifier(raw.device.assignedTo, 'device.assignedTo')
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
    release: { id: identifier(raw.release.id, 'release.id'), version: exactVersion(raw.release.version, 'release.version') },
    privatePlugins,
    workspacePaths,
    trustedPeers: raw.trustedPeers.map((entry, index) => trustEntry(entry, `trustedPeers[${index}]`, false)),
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
  const config = parseAgentConfig({
    schemaVersion: 2,
    deviceId: overlay.device.id,
    manifestPath: absoluteOutputPath(paths.manifestPath, 'manifestPath'),
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
    },
  })
  assertReleaseReadyConfig(config)
  assertA2AReadyConfig(config)
  return JSON.stringify(config, null, 2) + '\n'
}

export function instantiateTeamPack(pack: FleetTeamPack, overlay: FleetTeamOverlay): InstantiatedTeamPack {
  const workspaceIds = Object.keys(overlay.workspacePaths).sort()
  const expectedWorkspaceIds = [...pack.taskPolicy.workspaceIds].sort()
  if (workspaceIds.length !== expectedWorkspaceIds.length || workspaceIds.some((id, index) => id !== expectedWorkspaceIds[index])) {
    throw new TypeError('overlay workspacePaths must exactly instantiate the pack workspaceIds')
  }
  const publicIds = new Set(pack.publicPlugins.map(plugin => plugin.id))
  for (const plugin of overlay.privatePlugins) {
    if (publicIds.has(plugin.id)) throw new TypeError('private plugin id conflicts with a public pack plugin: ' + plugin.id)
  }
  const releasePlugins = [
    ...pack.publicPlugins.map(plugin => ({ id: plugin.id, visibility: 'public', source: plugin.source, ...(plugin.runtimeModules === undefined ? {} : { runtimeModules: plugin.runtimeModules }) })),
    ...overlay.privatePlugins.map(plugin => ({
      id: plugin.id,
      visibility: 'private',
      source: { kind: 'artifact', version: plugin.version, digest: plugin.digest },
      ...(plugin.runtimeModules === undefined ? {} : { runtimeModules: plugin.runtimeModules }),
    })),
  ]
  const manifestObject = {
    schemaVersion: 2,
    team: overlay.team,
    devices: {
      [overlay.device.id]: {
        assignedTo: overlay.device.assignedTo,
        class: overlay.device.class,
        channel: overlay.device.channel,
      },
    },
    profileReleases: {
      [overlay.release.id]: {
        version: overlay.release.version,
        profile: pack.profile.id,
        dshRange: pack.profile.dshRange,
        plugins: releasePlugins,
      },
    },
    assignments: { [overlay.device.id]: { [pack.profile.id]: overlay.release.id } },
  }
  const manifestYaml = stringifyYaml(manifestObject, { lineWidth: 0 })
  parseFleetManifest(manifestYaml)
  const trustEntries = [...pack.trustAnchors, ...overlay.trustedPeers]
  const keys = new Set<string>()
  for (const entry of trustEntries) {
    if (keys.has(entry.keyId)) throw new TypeError('duplicate trust key id: ' + entry.keyId)
    keys.add(entry.keyId)
  }
  return {
    manifestYaml,
    trustStoreJson: JSON.stringify({ schemaVersion: 1, teamId: overlay.team.id, entries: trustEntries }, null, 2) + '\n',
    taskPolicy: { profiles: pack.taskPolicy.profiles, workspaces: overlay.workspacePaths },
  }
}

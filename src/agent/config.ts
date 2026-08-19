import { readFile } from 'node:fs/promises'
import { isAbsolute, join, normalize } from 'node:path'
import { normalizeDeviceId } from '../shared.ts'
import { sha256Canonical } from './protocol.ts'
import { MAX_TASK_TOOL_ARGUMENT_BYTES } from '../worker/context.ts'

export interface AgentRestartNone {
  kind: 'none'
}

export interface AgentRestartScreen {
  kind: 'screen'
  screenBinary: string
  lsofBinary: string
  psBinary: string
  ownerMarkers: string[]
  sessionName: string
  host: string
  port: number
  managedPorts?: number[]
}

export interface AgentRestartLaunchd {
  kind: 'launchd'
  launchctlBinary: string
  lsofBinary: string
  psBinary: string
  ownerMarkers: string[]
  serviceTarget: string
  host: string
  port: number
  managedPorts?: number[]
}

export type AgentRestartConfig = AgentRestartNone | AgentRestartScreen | AgentRestartLaunchd

export interface AgentHealthConfig {
  url?: string
  timeoutMs: number
  requireFleetRpc: boolean
}

export interface AgentA2AConfig {
  teamId: string
  principalId: string
  privateKeyPath: string
  trustStorePath: string
  maxMessageTtlMs: number
}

export const TASK_POLICY_SCHEMA_VERSION = 1 as const
export const TASK_POLICY_IDS = ['readonly-v1', 'workspace-write-ask-v1'] as const
export type TaskPolicyId = (typeof TASK_POLICY_IDS)[number]
export type TaskPermissionMode = 'read-only' | 'workspace-write'
export type TaskPolicyDecision = 'safe' | 'ask' | 'deny'

export interface CanonicalTaskPolicyBody {
  schemaVersion: typeof TASK_POLICY_SCHEMA_VERSION
  policyId: TaskPolicyId
  permissionMode: TaskPermissionMode
  workspaceScope: 'configured-workspace'
  defaultDecision: 'deny'
  safeTools: readonly string[]
  approvalRequiredTools: readonly string[]
  hardDeniedTools: readonly string[]
  allowBackground: false
  maxArgumentsBytes: number
}

export interface CanonicalTaskPolicy extends CanonicalTaskPolicyBody {
  policyDigest: string
}

export type AgentTaskPolicySet = Readonly<Partial<Record<TaskPolicyId, CanonicalTaskPolicy>>>

const SAFE_READ_TOOLS = ['glob', 'grep', 'read', 'read_image'] as const
const APPROVAL_REQUIRED_TOOLS = ['bash', 'edit', 'pwsh', 'web_fetch', 'web_search', 'write'] as const
const HARD_DENIED_TOOLS = [
  'cordis_define', 'cordis_inspect_list', 'cordis_inspect_query', 'cordis_inspect_self',
  'cordis_run', 'cordis_stop', 'cordis_undefine',
  'create_goal', 'followup_task', 'interrupt_agent', 'job_kill', 'job_list', 'job_output',
  'list_agents', 'ralph', 'report', 'run_code', 'send_message', 'skill', 'spawn_agent',
  'str_replace_editor', 'todo_write', 'update_goal', 'wait_agent', 'workflow',
] as const

export function calculateTaskPolicyDigest(policy: CanonicalTaskPolicyBody): string {
  return sha256Canonical(policy)
}

function defineTaskPolicy(input: {
  policyId: TaskPolicyId
  permissionMode: TaskPermissionMode
  approvalRequiredTools: readonly string[]
}): CanonicalTaskPolicy {
  const body: CanonicalTaskPolicyBody = Object.freeze({
    schemaVersion: TASK_POLICY_SCHEMA_VERSION,
    policyId: input.policyId,
    permissionMode: input.permissionMode,
    workspaceScope: 'configured-workspace',
    defaultDecision: 'deny',
    safeTools: Object.freeze([...SAFE_READ_TOOLS]),
    approvalRequiredTools: Object.freeze([...input.approvalRequiredTools]),
    hardDeniedTools: Object.freeze([...HARD_DENIED_TOOLS]),
    allowBackground: false,
    maxArgumentsBytes: MAX_TASK_TOOL_ARGUMENT_BYTES,
  })
  return Object.freeze({ ...body, policyDigest: calculateTaskPolicyDigest(body) })
}

export const LOCAL_TASK_POLICIES: Readonly<Record<TaskPolicyId, CanonicalTaskPolicy>> = Object.freeze({
  'readonly-v1': defineTaskPolicy({
    policyId: 'readonly-v1',
    permissionMode: 'read-only',
    approvalRequiredTools: [],
  }),
  'workspace-write-ask-v1': defineTaskPolicy({
    policyId: 'workspace-write-ask-v1',
    permissionMode: 'workspace-write',
    approvalRequiredTools: APPROVAL_REQUIRED_TOOLS,
  }),
})

export interface AgentTasksConfig {
  enabled: boolean
  workspaces: Record<string, string>
  profiles: string[]
  timeoutMs: number
  maxOutputBytes: number
  maxConcurrent: number
  policyIds?: TaskPolicyId[]
  policies?: AgentTaskPolicySet
}

export interface ResolvedAgentTasksConfig extends AgentTasksConfig {
  policyIds: TaskPolicyId[]
  policies: AgentTaskPolicySet
}

export interface FleetAgentConfig {
  schemaVersion: 1 | 2
  deviceId: string
  manifestPath: string
  desiredManifestPath?: string
  dshHome: string
  dshBinary: string
  pnpmBinary: string
  profile: string
  stateDir: string
  planTtlMs: number
  restart: AgentRestartConfig
  health: AgentHealthConfig
  artifactStore?: string
  tarBinary?: string
  a2a?: AgentA2AConfig
  tasks?: AgentTasksConfig
}

export interface MutationReadyFleetAgentConfig extends FleetAgentConfig {
  restart: AgentRestartScreen | AgentRestartLaunchd
  health: AgentHealthConfig & { url: string; requireFleetRpc: true }
}

export interface ReleaseReadyFleetAgentConfig extends MutationReadyFleetAgentConfig {
  schemaVersion: 2
  artifactStore: string
  tarBinary: string
  desiredManifestPath: string
}

export interface A2AReadyFleetAgentConfig extends FleetAgentConfig {
  schemaVersion: 2
  a2a: AgentA2AConfig
  tasks: ResolvedAgentTasksConfig
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmpty(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new TypeError(field + ' must be a non-empty string')
  return value.trim()
}

function absolutePath(value: unknown, field: string): string {
  const path = nonEmpty(value, field)
  if (!isAbsolute(path) || normalize(path) !== path || path.includes('\0')) throw new TypeError(field + ' must be a normalized absolute path')
  return path
}

function boundedInt(value: unknown, field: string, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new TypeError(`${field} must be an integer from ${min} to ${max}`)
  }
  return value
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], field: string): void {
  const extra = Object.keys(value).filter(key => !allowed.includes(key))
  if (extra.length > 0) throw new TypeError(field + ' contains unsupported fields: ' + extra.sort().join(', '))
}

function parseRestart(value: unknown): AgentRestartConfig {
  if (!isRecord(value)) throw new TypeError('restart must be an object')
  const kind = nonEmpty(value.kind, 'restart.kind')
  if (kind === 'none') {
    exactKeys(value, ['kind'], 'restart')
    return { kind: 'none' }
  }
  if (kind !== 'screen' && kind !== 'launchd') throw new TypeError('restart.kind must be none, screen or launchd')
  exactKeys(value, kind === 'screen'
    ? ['kind', 'screenBinary', 'lsofBinary', 'psBinary', 'ownerMarkers', 'sessionName', 'host', 'port', 'managedPorts']
    : ['kind', 'launchctlBinary', 'lsofBinary', 'psBinary', 'ownerMarkers', 'serviceTarget', 'host', 'port', 'managedPorts'], 'restart')
  const host = nonEmpty(value.host, 'restart.host')
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') throw new TypeError('restart.host must be loopback')
  if (!Array.isArray(value.ownerMarkers) || value.ownerMarkers.length === 0 || value.ownerMarkers.length > 8 ||
      value.ownerMarkers.some(marker => typeof marker !== 'string' || marker.trim() !== marker || marker.length === 0 || marker.length > 240 || /[\r\n\0]/.test(marker))) {
    throw new TypeError('restart.ownerMarkers must contain 1 to 8 fixed command fragments')
  }
  const port = boundedInt(value.port, 'restart.port', 0, 1024, 65535)
  const rawManagedPorts = value.managedPorts ?? [port]
  if (!Array.isArray(rawManagedPorts) || rawManagedPorts.length === 0 || rawManagedPorts.length > 16 ||
      rawManagedPorts.some(item => typeof item !== 'number' || !Number.isSafeInteger(item) || item < 1024 || item > 65535) ||
      new Set(rawManagedPorts).size !== rawManagedPorts.length || !rawManagedPorts.includes(port)) {
    throw new TypeError('restart.managedPorts must be 1 to 16 unique ports including restart.port')
  }
  const common = {
    lsofBinary: absolutePath(value.lsofBinary, 'restart.lsofBinary'),
    psBinary: absolutePath(value.psBinary, 'restart.psBinary'),
    ownerMarkers: value.ownerMarkers as string[],
    host,
    port,
    managedPorts: rawManagedPorts as number[],
  }
  if (kind === 'screen') {
    const sessionName = nonEmpty(value.sessionName, 'restart.sessionName')
    if (!/^[A-Za-z0-9._-]+$/.test(sessionName)) throw new TypeError('restart.sessionName contains unsupported characters')
    return {
      kind: 'screen',
      screenBinary: absolutePath(value.screenBinary, 'restart.screenBinary'),
      sessionName,
      ...common,
    }
  }
  const serviceTarget = nonEmpty(value.serviceTarget, 'restart.serviceTarget')
  if (!/^(?:gui|user)\/[1-9][0-9]*\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(serviceTarget)) {
    throw new TypeError('restart.serviceTarget must be a fixed gui/UID/label or user/UID/label target')
  }
  return {
    kind: 'launchd',
    launchctlBinary: absolutePath(value.launchctlBinary, 'restart.launchctlBinary'),
    serviceTarget,
    ...common,
  }
}

function parseHealth(value: unknown): AgentHealthConfig {
  if (value === undefined) return { timeoutMs: 45_000, requireFleetRpc: false }
  if (!isRecord(value)) throw new TypeError('health must be an object')
  exactKeys(value, ['url', 'timeoutMs', 'requireFleetRpc'], 'health')
  let url: string | undefined
  if (value.url !== undefined) {
    url = nonEmpty(value.url, 'health.url')
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' || (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost' && parsed.hostname !== '[::1]')) {
      throw new TypeError('health.url must be a loopback http URL')
    }
    if (parsed.username !== '' || parsed.password !== '') throw new TypeError('health.url must not contain credentials')
  }
  const requireFleetRpc = value.requireFleetRpc ?? false
  if (typeof requireFleetRpc !== 'boolean') throw new TypeError('health.requireFleetRpc must be boolean')
  if (requireFleetRpc && url === undefined) throw new TypeError('health.requireFleetRpc needs health.url')
  return {
    ...(url === undefined ? {} : { url }),
    timeoutMs: boundedInt(value.timeoutMs, 'health.timeoutMs', 45_000, 3_000, 120_000),
    requireFleetRpc,
  }
}

function safeIdentifier(value: unknown, field: string): string {
  const id = nonEmpty(value, field)
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id)) throw new TypeError(field + ' contains unsupported characters')
  return id
}

function parseA2A(value: unknown): AgentA2AConfig | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new TypeError('a2a must be an object')
  exactKeys(value, ['teamId', 'principalId', 'privateKeyPath', 'trustStorePath', 'maxMessageTtlMs'], 'a2a')
  return {
    teamId: safeIdentifier(value.teamId, 'a2a.teamId'),
    principalId: safeIdentifier(value.principalId, 'a2a.principalId'),
    privateKeyPath: absolutePath(value.privateKeyPath, 'a2a.privateKeyPath'),
    trustStorePath: absolutePath(value.trustStorePath, 'a2a.trustStorePath'),
    maxMessageTtlMs: boundedInt(value.maxMessageTtlMs, 'a2a.maxMessageTtlMs', 15 * 60 * 1000, 60_000, 24 * 60 * 60 * 1000),
  }
}

function parseTasks(value: unknown): ResolvedAgentTasksConfig | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new TypeError('tasks must be an object')
  exactKeys(value, ['enabled', 'workspaces', 'profiles', 'timeoutMs', 'maxOutputBytes', 'maxConcurrent', 'policyIds'], 'tasks')
  if (typeof value.enabled !== 'boolean') throw new TypeError('tasks.enabled must be boolean')
  if (!isRecord(value.workspaces)) throw new TypeError('tasks.workspaces must be an object')
  const workspaces: Record<string, string> = {}
  for (const [rawId, path] of Object.entries(value.workspaces)) {
    const id = safeIdentifier(rawId, 'tasks workspace id')
    workspaces[id] = absolutePath(path, 'tasks.workspaces.' + id)
  }
  if (value.enabled && Object.keys(workspaces).length === 0) throw new TypeError('enabled tasks require at least one workspace')
  if (!Array.isArray(value.profiles) || value.profiles.length === 0 || value.profiles.length > 16 ||
      value.profiles.some(profile => typeof profile !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(profile)) ||
      new Set(value.profiles).size !== value.profiles.length) {
    throw new TypeError('tasks.profiles must contain 1 to 16 unique safe profile ids')
  }
  const rawPolicyIds = value.policyIds ?? ['readonly-v1']
  if (!Array.isArray(rawPolicyIds) || rawPolicyIds.length === 0 || rawPolicyIds.length > TASK_POLICY_IDS.length ||
      rawPolicyIds.some(policyId => typeof policyId !== 'string' || !TASK_POLICY_IDS.includes(policyId as TaskPolicyId)) ||
      new Set(rawPolicyIds).size !== rawPolicyIds.length) {
    throw new TypeError('tasks.policyIds must contain unique installed task policy ids')
  }
  const policyIds = [...rawPolicyIds] as TaskPolicyId[]
  const policies: Partial<Record<TaskPolicyId, CanonicalTaskPolicy>> = {}
  for (const policyId of policyIds) policies[policyId] = LOCAL_TASK_POLICIES[policyId]
  return {
    enabled: value.enabled,
    workspaces,
    profiles: value.profiles as string[],
    timeoutMs: boundedInt(value.timeoutMs, 'tasks.timeoutMs', 60 * 60 * 1000, 60_000, 6 * 60 * 60 * 1000),
    maxOutputBytes: boundedInt(value.maxOutputBytes, 'tasks.maxOutputBytes', 1024 * 1024, 4096, 1024 * 1024),
    maxConcurrent: boundedInt(value.maxConcurrent, 'tasks.maxConcurrent', 1, 1, 4),
    policyIds,
    policies: Object.freeze(policies),
  }
}

export function parseAgentConfig(value: unknown): FleetAgentConfig {
  if (!isRecord(value)) throw new TypeError('agent config must be an object')
  exactKeys(value, [
    'schemaVersion', 'deviceId', 'manifestPath', 'desiredManifestPath', 'dshHome', 'dshBinary', 'pnpmBinary', 'profile', 'stateDir',
    'planTtlMs', 'restart', 'health', 'artifactStore', 'tarBinary', 'a2a', 'tasks',
  ], 'agent config')
  if (value.schemaVersion !== 1 && value.schemaVersion !== 2) throw new TypeError('agent config schemaVersion must equal 1 or 2')
  const profile = nonEmpty(value.profile, 'profile')
  if (!/^[A-Za-z0-9._-]+$/.test(profile)) throw new TypeError('profile contains unsupported characters')
  const dshHome = absolutePath(value.dshHome, 'dshHome')
  const configuredManifestPath = absolutePath(value.manifestPath, 'manifestPath')
  const profileManifestPath = join(dshHome, 'profiles', profile, 'fleet.lock.yaml')
  let manifestPath = configuredManifestPath
  let desiredManifestPath: string | undefined
  if (value.schemaVersion === 2) {
    if (value.desiredManifestPath === undefined) {
      // Compatibility for pre-0.4 generated configs: the old manifestPath was the desired candidate.
      manifestPath = profileManifestPath
      desiredManifestPath = configuredManifestPath
    } else {
      desiredManifestPath = absolutePath(value.desiredManifestPath, 'desiredManifestPath')
      if (configuredManifestPath !== profileManifestPath) {
        throw new TypeError('schemaVersion 2 manifestPath must be the profile-local live Fleet manifest')
      }
    }
  } else if (value.desiredManifestPath !== undefined) {
    throw new TypeError('schemaVersion 1 must not define desiredManifestPath')
  }
  const artifactStore = value.artifactStore === undefined ? undefined : absolutePath(value.artifactStore, 'artifactStore')
  const tarBinary = value.tarBinary === undefined ? undefined : absolutePath(value.tarBinary, 'tarBinary')
  if (value.schemaVersion === 2 && (artifactStore === undefined || tarBinary === undefined)) {
    throw new TypeError('schemaVersion 2 requires artifactStore and tarBinary')
  }
  const a2a = parseA2A(value.a2a)
  const tasks = parseTasks(value.tasks)
  if (tasks?.enabled === true && a2a === undefined) throw new TypeError('enabled tasks require a2a identity and trust configuration')
  return {
    schemaVersion: value.schemaVersion,
    deviceId: normalizeDeviceId(value.deviceId),
    manifestPath,
    ...(desiredManifestPath === undefined ? {} : { desiredManifestPath }),
    dshHome,
    dshBinary: absolutePath(value.dshBinary, 'dshBinary'),
    pnpmBinary: absolutePath(value.pnpmBinary, 'pnpmBinary'),
    profile,
    stateDir: absolutePath(value.stateDir, 'stateDir'),
    planTtlMs: boundedInt(value.planTtlMs, 'planTtlMs', 10 * 60 * 1000, 60_000, 60 * 60 * 1000),
    restart: parseRestart(value.restart),
    health: parseHealth(value.health),
    ...(artifactStore === undefined ? {} : { artifactStore }),
    ...(tarBinary === undefined ? {} : { tarBinary }),
    ...(a2a === undefined ? {} : { a2a }),
    ...(tasks === undefined ? {} : { tasks }),
  }
}

export function assertReleaseReadyConfig(config: FleetAgentConfig): asserts config is ReleaseReadyFleetAgentConfig {
  assertMutationReadyConfig(config)
  const expectedManifestPath = join(config.dshHome, 'profiles', config.profile, 'fleet.lock.yaml')
  if (config.schemaVersion !== 2 || config.artifactStore === undefined || config.tarBinary === undefined ||
      config.desiredManifestPath === undefined || config.manifestPath !== expectedManifestPath) {
    throw mutationConfigError('atomic profile releases require schemaVersion 2, a profile-local live manifest, a desired manifest, artifactStore and tarBinary')
  }
}

export function assertA2AReadyConfig(config: FleetAgentConfig): asserts config is A2AReadyFleetAgentConfig {
  if (config.schemaVersion !== 2 || config.a2a === undefined || config.tasks === undefined) {
    throw mutationConfigError('A2A requires schemaVersion 2 with identity, trust and task policy')
  }
  if (config.tasks.policyIds === undefined || config.tasks.policies === undefined) {
    throw mutationConfigError('A2A task execution requires resolved local task policies')
  }
}

function mutationConfigError(message: string): TypeError & { code: string } {
  return Object.assign(new TypeError(message), { code: 'unsafe-mutation-config' })
}

export function assertMutationReadyConfig(config: FleetAgentConfig): asserts config is MutationReadyFleetAgentConfig {
  if (config.restart.kind === 'none') {
    throw mutationConfigError('mutation requires a configured DSH restart')
  }
  if (config.health.url === undefined || config.health.requireFleetRpc !== true) {
    throw mutationConfigError('mutation requires a loopback health URL with Fleet RPC verification')
  }
  let health: URL
  try {
    health = new URL(config.health.url)
  } catch {
    throw mutationConfigError('mutation health URL is invalid')
  }
  if (health.protocol !== 'http:' ||
      (health.hostname !== '127.0.0.1' && health.hostname !== 'localhost' && health.hostname !== '[::1]') ||
      health.username !== '' || health.password !== '') {
    throw mutationConfigError('mutation health URL must be credential-free loopback HTTP')
  }
  const healthPort = health.port === '' ? 80 : Number(health.port)
  if (healthPort !== config.restart.port) {
    throw mutationConfigError('mutation health URL must verify the configured restart port')
  }
}

export async function readAgentConfig(path: string): Promise<FleetAgentConfig> {
  return parseAgentConfig(JSON.parse(await readFile(path, 'utf8')) as unknown)
}

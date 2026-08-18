import { readFile } from 'node:fs/promises'
import { isAbsolute, normalize } from 'node:path'

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
}

export type AgentRestartConfig = AgentRestartNone | AgentRestartScreen

export interface AgentHealthConfig {
  url?: string
  timeoutMs: number
  requireFleetRpc: boolean
}

export interface FleetAgentConfig {
  schemaVersion: 1
  deviceId: string
  manifestPath: string
  dshHome: string
  dshBinary: string
  pnpmBinary: string
  profile: string
  stateDir: string
  planTtlMs: number
  restart: AgentRestartConfig
  health: AgentHealthConfig
}

export interface MutationReadyFleetAgentConfig extends FleetAgentConfig {
  restart: AgentRestartScreen
  health: AgentHealthConfig & { url: string; requireFleetRpc: true }
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
  if (kind !== 'screen') throw new TypeError('restart.kind must be none or screen')
  exactKeys(value, ['kind', 'screenBinary', 'lsofBinary', 'psBinary', 'ownerMarkers', 'sessionName', 'host', 'port'], 'restart')
  const sessionName = nonEmpty(value.sessionName, 'restart.sessionName')
  if (!/^[A-Za-z0-9._-]+$/.test(sessionName)) throw new TypeError('restart.sessionName contains unsupported characters')
  const host = nonEmpty(value.host, 'restart.host')
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') throw new TypeError('restart.host must be loopback')
  if (!Array.isArray(value.ownerMarkers) || value.ownerMarkers.length === 0 || value.ownerMarkers.length > 8 ||
      value.ownerMarkers.some(marker => typeof marker !== 'string' || marker.trim() !== marker || marker.length === 0 || marker.length > 240 || /[\r\n\0]/.test(marker))) {
    throw new TypeError('restart.ownerMarkers must contain 1 to 8 fixed command fragments')
  }
  return {
    kind: 'screen',
    screenBinary: absolutePath(value.screenBinary, 'restart.screenBinary'),
    lsofBinary: absolutePath(value.lsofBinary, 'restart.lsofBinary'),
    psBinary: absolutePath(value.psBinary, 'restart.psBinary'),
    ownerMarkers: value.ownerMarkers as string[],
    sessionName,
    host,
    port: boundedInt(value.port, 'restart.port', 0, 1024, 65535),
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

export function parseAgentConfig(value: unknown): FleetAgentConfig {
  if (!isRecord(value)) throw new TypeError('agent config must be an object')
  exactKeys(value, [
    'schemaVersion', 'deviceId', 'manifestPath', 'dshHome', 'dshBinary', 'pnpmBinary', 'profile', 'stateDir',
    'planTtlMs', 'restart', 'health',
  ], 'agent config')
  if (value.schemaVersion !== 1) throw new TypeError('agent config schemaVersion must equal 1')
  const profile = nonEmpty(value.profile, 'profile')
  if (!/^[A-Za-z0-9._-]+$/.test(profile)) throw new TypeError('profile contains unsupported characters')
  return {
    schemaVersion: 1,
    deviceId: nonEmpty(value.deviceId, 'deviceId'),
    manifestPath: absolutePath(value.manifestPath, 'manifestPath'),
    dshHome: absolutePath(value.dshHome, 'dshHome'),
    dshBinary: absolutePath(value.dshBinary, 'dshBinary'),
    pnpmBinary: absolutePath(value.pnpmBinary, 'pnpmBinary'),
    profile,
    stateDir: absolutePath(value.stateDir, 'stateDir'),
    planTtlMs: boundedInt(value.planTtlMs, 'planTtlMs', 10 * 60 * 1000, 60_000, 60 * 60 * 1000),
    restart: parseRestart(value.restart),
    health: parseHealth(value.health),
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

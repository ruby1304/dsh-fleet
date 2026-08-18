import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir, hostname, platform, arch } from 'node:os'
import { join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { parseFleetManifest, reconcileFleet } from './host/core.ts'
import { createUpdateMonitor, type UpdateMode } from './host/updates.ts'
import type { FleetManifest, FleetStatus, RuntimePhase, RuntimePluginEntry } from './shared.ts'

export const name = 'fleet'
export const inject = ['connection', 'loader']
export const RPC_CHANNEL = '/dsh-fleet'

export interface Config {
  deviceId?: string
  manifestPath?: string
  profile?: string
  dshHome?: string
  dshBinary?: string
  updateCheck?: boolean
  updateCacheMs?: number
  updateTimeoutMs?: number
}

interface ProfileManifest {
  dependencies?: Record<string, string>
  dsh?: { profile?: { bundles?: string[] } }
}

interface LoaderEntryLike {
  id: string
  options: { name: string; group?: boolean }
  disabled?: boolean
  fiber?: { state: number }
}

interface HostContext {
  connection: {
    rpc: {
      handle(channel: string, handler: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>, options?: { authority?: string }): unknown
    }
  }
  loader: { entries(): Iterable<LoaderEntryLike> }
}

const PHASES: Record<number, RuntimePhase> = {
  0: 'pending',
  1: 'loading',
  2: 'active',
  3: 'failed',
  4: null,
  5: 'unloading',
}

function expandHome(value: string): string {
  if (value === '~') return homedir()
  if (value.startsWith('~/')) return join(homedir(), value.slice(2))
  if (!value.includes('/')) return value
  return resolve(value)
}

function resolveConfig(config: Config | undefined) {
  const dshHome = expandHome(config?.dshHome ?? process.env.DSH_HOME ?? '~/.dsh')
  const defaultBinary = join(homedir(), '.local/bin/dsh')
  const boundedNumber = (value: number | undefined, fallback: number, minimum: number, maximum: number) =>
    value === undefined || !Number.isFinite(value) ? fallback : Math.min(maximum, Math.max(minimum, Math.round(value)))
  return {
    deviceId: (config?.deviceId ?? process.env.DSH_FLEET_DEVICE_ID ?? hostname()).trim(),
    manifestPath: expandHome(config?.manifestPath ?? process.env.DSH_FLEET_MANIFEST ?? '~/.dsh/fleet/fleet.lock.yaml'),
    profile: (config?.profile ?? process.env.DSH_FLEET_PROFILE ?? 'web').trim(),
    dshHome,
    dshBinary: expandHome(config?.dshBinary ?? process.env.DSH_FLEET_DSH_BINARY ?? (existsSync(defaultBinary) ? defaultBinary : 'dsh')),
    updateCheck: config?.updateCheck !== false,
    updateCacheMs: boundedNumber(config?.updateCacheMs, 6 * 60 * 60 * 1000, 60 * 1000, 24 * 60 * 60 * 1000),
    updateTimeoutMs: boundedNumber(config?.updateTimeoutMs, 5000, 1000, 15_000),
  }
}

function readDshVersion(binary: string): string | null {
  try {
    return execFileSync(binary, ['--version'], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null
  } catch {
    return null
  }
}

function runtimeSnapshot(loader: HostContext['loader']): RuntimePluginEntry[] {
  const entries: RuntimePluginEntry[] = []
  for (const entry of loader.entries()) {
    if (entry.options.group) continue
    entries.push({
      entryId: entry.id,
      moduleName: entry.options.name,
      enabled: entry.disabled !== true,
      fiberPhase: entry.fiber === undefined ? null : (PHASES[entry.fiber.state] ?? null),
    })
  }
  return entries
}

async function readProfile(path: string): Promise<{ dependencies: Record<string, string>; bundles: string[] }> {
  const parsed = JSON.parse(await readFile(path, 'utf8')) as ProfileManifest
  return {
    dependencies: parsed.dependencies ?? {},
    bundles: parsed.dsh?.profile?.bundles ?? [],
  }
}

const EMPTY_MANIFEST: FleetManifest = {
  schemaVersion: 1,
  team: { id: 'unavailable' },
  devices: {},
  plugins: [],
}

export async function collectFleetStatus(ctx: Pick<HostContext, 'loader'>, configInput?: Config): Promise<FleetStatus> {
  const config = resolveConfig(configInput)
  const profilePath = join(config.dshHome, 'profiles', config.profile, 'package.json')
  let manifest = EMPTY_MANIFEST
  let manifestLoaded = false
  let manifestError: string | undefined
  try {
    manifest = parseFleetManifest(await readFile(config.manifestPath, 'utf8'))
    manifestLoaded = true
  } catch (error: unknown) {
    manifestError = error instanceof Error ? error.message : String(error)
  }
  let dependencies: Record<string, string> = {}
  let bundles: string[] = []
  try {
    const profile = await readProfile(profilePath)
    dependencies = profile.dependencies
    bundles = profile.bundles
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    manifestError = manifestError === undefined ? 'profile: ' + message : manifestError + '; profile: ' + message
  }
  const result = reconcileFleet({
    manifest,
    deviceId: config.deviceId,
    profile: config.profile,
    dependencies,
    bundles,
    runtime: runtimeSnapshot(ctx.loader),
  })
  const deviceSpec = result.device
  return {
    generatedAt: new Date().toISOString(),
    device: {
      id: config.deviceId,
      registered: deviceSpec !== undefined,
      ...(deviceSpec?.assignedTo === undefined ? {} : { assignedTo: deviceSpec.assignedTo }),
      ...(deviceSpec === undefined ? {} : { class: deviceSpec.class, channel: deviceSpec.channel }),
      hostname: hostname(),
      platform: platform(),
      arch: arch(),
      nodeVersion: process.version,
    },
    dsh: { version: readDshVersion(config.dshBinary), profile: config.profile },
    manifest: {
      path: config.manifestPath,
      loaded: manifestLoaded,
      ...(manifestLoaded ? { teamId: manifest.team.id } : {}),
      ...(manifestError === undefined ? {} : { error: manifestError }),
    },
    summary: result.summary,
    plugins: result.plugins,
    unmanaged: result.unmanaged,
  }
}

const ok = (value: unknown) => ({ ok: true, value })
const fail = (message: string) => ({ ok: false, error: { code: 'internal', message, details: {} } })

export function apply(ctx: Context, config?: Config): void {
  const host = ctx as unknown as HostContext
  const resolved = resolveConfig(config)
  const updates = createUpdateMonitor({
    enabled: resolved.updateCheck,
    cacheMs: resolved.updateCacheMs,
    timeoutMs: resolved.updateTimeoutMs,
    deviceId: resolved.deviceId,
    manifestPath: resolved.manifestPath,
    profileDir: join(resolved.dshHome, 'profiles', resolved.profile),
    profile: resolved.profile,
    dshVersion: readDshVersion(resolved.dshBinary),
  })
  host.connection.rpc.handle(RPC_CHANNEL, async (endpoint, payload) => {
    try {
      if (endpoint === 'status') return ok(await collectFleetStatus(host, config))
      if (endpoint === 'updates') {
        let mode: UpdateMode = 'if-stale'
        if (payload !== null && payload !== undefined) {
          if (typeof payload !== 'object' || Array.isArray(payload) || !('mode' in payload)) throw new TypeError('updates payload must contain mode')
          const candidate = (payload as { mode?: unknown }).mode
          if (candidate !== 'cache' && candidate !== 'if-stale' && candidate !== 'force') throw new TypeError('invalid updates mode')
          mode = candidate
        }
        return ok(await updates.get(mode))
      }
      return fail('unknown endpoint: ' + endpoint)
    } catch (error: unknown) {
      return fail(error instanceof Error ? error.message : String(error))
    }
  }, { authority: 'loopback' })
}

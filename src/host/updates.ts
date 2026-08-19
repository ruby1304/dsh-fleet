import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { gt as semverGt, valid as validSemver, validRange as validSemverRange } from 'semver'
import { parse as parseYaml } from 'yaml'
import { parseFleetManifest, reconcileFleet } from './core.ts'
import type {
  FleetUpdateItem,
  FleetUpdateSnapshot,
  FleetUpdates,
  PluginStatus,
} from '../shared.ts'

const NPM_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i
export interface UpdateRuntimeConfig {
  enabled: boolean
  cacheMs: number
  timeoutMs: number
  deviceId: string
  manifestPath: string
  profileDir: string
  profile: string
  dshVersion: string | null
}

export interface UpdateProbe {
  npmLatest(packageName: string, timeoutMs: number): Promise<string>
  githubHead(repository: string, timeoutMs: number): Promise<string>
}

interface ProfileLockDependency {
  specifier?: string
  version?: string
}

interface ProfileLock {
  importers?: Record<string, {
    dependencies?: Record<string, ProfileLockDependency | string>
  }>
}

interface ProfileManifest {
  dependencies?: Record<string, string>
  dsh?: { profile?: { bundles?: string[] } }
}

interface SourceDescriptor {
  source: FleetUpdateItem['source']
  packageName?: string
  repository?: string
  sourceUrl?: string
}

export interface UpdateMonitorDependencies {
  now?: () => number
  probe?: UpdateProbe
  collect?: (config: UpdateRuntimeConfig, probe: UpdateProbe, now: number) => Promise<FleetUpdateSnapshot>
}

export const systemUpdateProbe: UpdateProbe = {
  async npmLatest(packageName, timeoutMs) {
    const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`, {
      headers: { accept: 'application/json' },
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) throw new Error('registry probe failed')
    const payload = await response.json() as { version?: unknown }
    if (typeof payload.version !== 'string' || payload.version.trim().length === 0) throw new Error('registry returned an invalid version')
    return payload.version.trim()
  },
  async githubHead(repository, timeoutMs) {
    const match = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\.git$/.exec(repository)
    if (match?.[1] === undefined || match[2] === undefined) throw new Error('unsupported GitHub repository')
    const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(match[1])}/${encodeURIComponent(match[2])}/commits?per_page=1`, {
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'dsh-fleet',
        'x-github-api-version': '2026-03-10',
      },
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) throw new Error('GitHub probe failed')
    const payload = await response.json() as Array<{ sha?: unknown }>
    const revision = Array.isArray(payload) ? payload[0]?.sha : undefined
    if (typeof revision !== 'string' || !/^[0-9a-f]{40}$/i.test(revision)) throw new Error('GitHub returned no HEAD revision')
    return revision.toLowerCase()
  },
}

function githubDescriptor(spec: string): SourceDescriptor | undefined {
  const shorthand = /^github:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:#.*)?$/.exec(spec)
  const url = /^(?:git\+)?https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:#.*)?$/.exec(spec)
  const match = shorthand ?? url
  if (match?.[1] === undefined || match[2] === undefined) return undefined
  const owner = match[1]
  const repositoryName = match[2].replace(/\.git$/, '')
  return {
    source: 'github',
    repository: `https://github.com/${owner}/${repositoryName}.git`,
    sourceUrl: `https://github.com/${owner}/${repositoryName}`,
  }
}

function describeSource(id: string, spec: string): SourceDescriptor {
  const localPath = spec.startsWith('file:') ? spec.slice('file:'.length) : spec
  const localTarball = /\.tgz$/i.test(localPath) && (
    spec.startsWith('file:') || localPath.startsWith('/') || localPath.startsWith('./') ||
    localPath.startsWith('../') || /^[A-Za-z]:[\\/]/.test(localPath)
  )
  if (localTarball) return { source: 'artifact' }
  if (/^(?:link|file|workspace):/.test(spec) || spec.startsWith('/') || spec.startsWith('./') || spec.startsWith('../')) {
    return { source: 'local' }
  }
  const github = githubDescriptor(spec)
  if (github !== undefined) return github
  if (NPM_NAME.test(id) && (validSemverRange(spec) !== null || /^[a-z][a-z0-9._-]*$/i.test(spec))) {
    return { source: 'npm', packageName: id, sourceUrl: `https://www.npmjs.com/package/${encodeURIComponent(id)}` }
  }
  return { source: 'unknown' }
}

function resolvedRevision(value: string | undefined, spec: string): string | undefined {
  const fromLock = value?.match(/[0-9a-f]{40}/i)?.[0]
  if (fromLock !== undefined) return fromLock.toLowerCase()
  const fragment = spec.match(/#([0-9a-f]{40})$/i)?.[1]
  return fragment?.toLowerCase()
}

function isAvailable(current: string, latest: string): boolean {
  const currentSemver = validSemver(current)
  const latestSemver = validSemver(latest)
  if (currentSemver !== null && latestSemver !== null) return semverGt(latestSemver, currentSemver)
  return current !== latest
}

async function readInstalledPackage(profileDir: string, id: string): Promise<{ version: string; private: boolean; access?: string; registry?: string } | undefined> {
  try {
    const raw = JSON.parse(await readFile(join(profileDir, 'node_modules', id, 'package.json'), 'utf8')) as {
      version?: unknown
      private?: unknown
      publishConfig?: { access?: unknown; registry?: unknown }
    }
    if (typeof raw.version !== 'string' || raw.version.trim().length === 0) return undefined
    const registry = typeof raw.publishConfig?.registry === 'string' ? raw.publishConfig.registry : undefined
    const access = typeof raw.publishConfig?.access === 'string' ? raw.publishConfig.access : undefined
    return {
      version: raw.version.trim(),
      private: raw.private === true,
      ...(access === undefined ? {} : { access }),
      ...(registry === undefined ? {} : { registry }),
    }
  } catch {
    return undefined
  }
}

async function readProfile(config: UpdateRuntimeConfig): Promise<{
  dependencies: Record<string, string>
  bundles: string[]
  desired: Map<string, PluginStatus>
  lockVersions: Record<string, string>
}> {
  const profileManifest = JSON.parse(await readFile(join(config.profileDir, 'package.json'), 'utf8')) as ProfileManifest
  const dependencies = profileManifest.dependencies ?? {}
  const bundles = profileManifest.dsh?.profile?.bundles ?? []
  let desired = new Map<string, PluginStatus>()
  try {
    const manifest = parseFleetManifest(await readFile(config.manifestPath, 'utf8'))
    const result = reconcileFleet({
      manifest,
      deviceId: config.deviceId,
      profile: config.profile,
      dependencies,
      bundles,
      runtime: [],
    })
    desired = new Map(result.plugins.map(plugin => [plugin.id, plugin]))
  } catch {
    // Update discovery can still inspect installed bundles while status reports the manifest error.
  }
  const lockVersions: Record<string, string> = {}
  try {
    const lock = parseYaml(await readFile(join(config.profileDir, 'pnpm-lock.yaml'), 'utf8')) as ProfileLock
    for (const [id, dependency] of Object.entries(lock.importers?.['.']?.dependencies ?? {})) {
      const version = typeof dependency === 'string' ? dependency : dependency.version
      if (version !== undefined) lockVersions[id] = version
    }
  } catch {
    // A missing lockfile degrades Git revision comparison without blocking npm checks.
  }
  return { dependencies, bundles, desired, lockVersions }
}

async function checkCore(config: UpdateRuntimeConfig, probe: UpdateProbe): Promise<FleetUpdateItem> {
  const base: FleetUpdateItem = {
    id: '@deepseek-ai/dsh',
    kind: 'dsh',
    managed: true,
    source: 'npm',
    sourceUrl: 'https://www.npmjs.com/package/%40deepseek-ai%2Fdsh',
    ...(config.dshVersion === null ? {} : { currentVersion: config.dshVersion }),
    state: 'error',
  }
  if (config.dshVersion === null) return { ...base, errorCode: 'not-installed' }
  try {
    const latestVersion = await probe.npmLatest('@deepseek-ai/dsh', config.timeoutMs)
    const available = isAvailable(config.dshVersion, latestVersion)
    return {
      ...base,
      latestVersion,
      state: available ? 'available' : 'current',
      ...(available ? { changeKind: 'version' as const } : {}),
    }
  } catch {
    return { ...base, errorCode: 'registry-unavailable' }
  }
}

async function checkPlugin(
  id: string,
  spec: string,
  managed: boolean,
  lockVersion: string | undefined,
  config: UpdateRuntimeConfig,
  probe: UpdateProbe,
): Promise<FleetUpdateItem> {
  const descriptor = describeSource(id, spec)
  const installedPackage = await readInstalledPackage(config.profileDir, id)
  const currentVersion = installedPackage?.version
  const installed = installedPackage !== undefined
  const base: FleetUpdateItem = {
    id,
    kind: 'plugin',
    managed,
    source: descriptor.source,
    ...(currentVersion === undefined ? {} : { currentVersion }),
    ...(descriptor.sourceUrl === undefined ? {} : { sourceUrl: descriptor.sourceUrl }),
    state: installed ? 'unsupported' : 'missing',
    ...(!installed ? { errorCode: 'not-installed' as const } : {}),
  }
  if (descriptor.source === 'local' || descriptor.source === 'artifact') return { ...base, state: installed ? 'local' : 'missing' }
  if (descriptor.source === 'npm' && descriptor.packageName !== undefined) {
    const privateSource = installedPackage?.private === true
      || (id.startsWith('@') && installedPackage?.access !== 'public')
      || (installedPackage?.registry !== undefined && !/^https:\/\/registry\.npmjs\.org\/?$/i.test(installedPackage.registry))
    if (privateSource) {
      return { ...base, state: 'unsupported', errorCode: 'unsupported-source' }
    }
    try {
      const latestVersion = await probe.npmLatest(descriptor.packageName, config.timeoutMs)
      if (currentVersion === undefined) return { ...base, latestVersion }
      const available = isAvailable(currentVersion, latestVersion)
      return {
        ...base,
        latestVersion,
        state: available ? 'available' : 'current',
        ...(available ? { changeKind: 'version' as const } : {}),
      }
    } catch {
      return { ...base, state: 'error', errorCode: 'registry-unavailable' }
    }
  }
  if (descriptor.source === 'github' && descriptor.repository !== undefined) {
    const currentRevision = resolvedRevision(lockVersion, spec)
    try {
      const latestRevision = await probe.githubHead(descriptor.repository, config.timeoutMs)
      if (!installed) return { ...base, latestRevision }
      if (currentRevision === undefined) {
        return { ...base, latestRevision, state: 'unsupported', errorCode: 'unsupported-source' }
      }
      return {
        ...base,
        currentRevision,
        latestRevision,
        state: currentRevision === latestRevision ? 'current' : 'available',
        ...(currentRevision === latestRevision ? {} : { changeKind: 'head-changed' as const }),
      }
    } catch {
      return {
        ...base,
        ...(currentRevision === undefined ? {} : { currentRevision }),
        state: 'error',
        errorCode: 'github-unavailable',
      }
    }
  }
  return { ...base, state: installed ? 'unsupported' : 'missing', errorCode: installed ? 'unsupported-source' : 'not-installed' }
}

function summarize(items: FleetUpdateItem[]): FleetUpdateSnapshot['summary'] {
  return {
    tracked: items.length,
    available: items.filter(item => item.state === 'available').length,
    current: items.filter(item => item.state === 'current').length,
    local: items.filter(item => item.state === 'local').length,
    missing: items.filter(item => item.state === 'missing').length,
    errors: items.filter(item => item.state === 'error').length,
    unsupported: items.filter(item => item.state === 'unsupported').length,
  }
}

const STATE_ORDER: Record<FleetUpdateItem['state'], number> = {
  available: 0,
  error: 1,
  missing: 2,
  local: 3,
  unsupported: 4,
  current: 5,
}

async function mapLimit<T, R>(values: T[], limit: number, worker: (value: T) => Promise<R>): Promise<R[]> {
  const result = new Array<R>(values.length)
  let cursor = 0
  async function consume(): Promise<void> {
    while (cursor < values.length) {
      const index = cursor++
      const value = values[index]
      if (value !== undefined) result[index] = await worker(value)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, consume))
  return result
}

export async function collectFleetUpdates(
  config: UpdateRuntimeConfig,
  probe: UpdateProbe = systemUpdateProbe,
  now = Date.now(),
): Promise<FleetUpdateSnapshot> {
  const profile = await readProfile(config)
  const core = checkCore(config, probe)
  const desiredSpecs = new Map([...profile.desired].map(([id, plugin]) => [id, plugin.actualSpec ?? plugin.desiredSpec]))
  const ids = [...new Set(profile.bundles.filter(id => Object.hasOwn(profile.dependencies, id)))]
  const plugins = await mapLimit(ids, 4, id => checkPlugin(
      id,
      profile.dependencies[id] ?? desiredSpecs.get(id) ?? '',
      profile.desired.has(id),
      profile.lockVersions[id],
      config,
      probe,
    ))
  plugins.sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.id.localeCompare(b.id))
  const items = [await core, ...plugins]
  return {
    checkedAt: new Date(now).toISOString(),
    refreshAfter: new Date(now + config.cacheMs).toISOString(),
    summary: summarize(items),
    items,
  }
}

async function inputFingerprint(config: UpdateRuntimeConfig): Promise<string> {
  const paths = [join(config.profileDir, 'package.json'), join(config.profileDir, 'pnpm-lock.yaml'), config.manifestPath]
  const parts = await Promise.all(paths.map(async path => {
    try {
      const metadata = await stat(path)
      return `${path}:${metadata.size}:${metadata.mtimeMs}`
    } catch {
      return `${path}:missing`
    }
  }))
  return [config.dshVersion ?? 'unknown', ...parts].join('|')
}

export type UpdateMode = 'cache' | 'if-stale' | 'force'

export function createUpdateMonitor(config: UpdateRuntimeConfig, dependencies: UpdateMonitorDependencies = {}) {
  const now = dependencies.now ?? Date.now
  const probe = dependencies.probe ?? systemUpdateProbe
  const collect = dependencies.collect ?? collectFleetUpdates
  let cached: FleetUpdateSnapshot | undefined
  let cachedFingerprint: string | undefined
  let lastAttemptAt: number | undefined
  let inFlight: Promise<FleetUpdateSnapshot> | undefined

  return {
    async get(mode: UpdateMode = 'if-stale'): Promise<FleetUpdates> {
      if (!config.enabled) return { enabled: false, cached: false, stale: false }
      const currentTime = now()
      const fingerprint = await inputFingerprint(config)
      const inputsChanged = cachedFingerprint !== undefined && cachedFingerprint !== fingerprint
      const expired = cached !== undefined && Date.parse(cached.refreshAfter) <= currentTime
      const stale = inputsChanged || expired
      const report = (snapshot: FleetUpdateSnapshot | undefined, fromCache: boolean, reportStale: boolean): FleetUpdates => ({
        enabled: true,
        cached: fromCache,
        stale: reportStale,
        ...(lastAttemptAt === undefined ? {} : { lastAttemptAt: new Date(lastAttemptAt).toISOString() }),
        ...(snapshot === undefined ? {} : { snapshot }),
      })
      if (mode === 'cache') return report(cached, cached !== undefined, stale)
      if (mode === 'if-stale' && cached !== undefined && !stale) return report(cached, true, false)
      if (mode === 'force' && cached !== undefined && !stale && lastAttemptAt !== undefined && currentTime - lastAttemptAt < 60_000) {
        return report(cached, true, stale)
      }
      if (inFlight === undefined) {
        lastAttemptAt = currentTime
        inFlight = (async () => {
          const snapshot = await collect(config, probe, currentTime)
          if (await inputFingerprint(config) !== fingerprint) throw new Error('fleet inputs changed during update check')
          cached = snapshot
          cachedFingerprint = fingerprint
          return snapshot
        })()
      }
      const refresh = inFlight
      try {
        return report(await refresh, false, false)
      } finally {
        if (inFlight === refresh) inFlight = undefined
      }
    },
  }
}

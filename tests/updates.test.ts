import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { collectFleetUpdates, createUpdateMonitor, systemUpdateProbe } from '../src/testing.ts'
import type { FleetUpdateSnapshot, UpdateProbe, UpdateRuntimeConfig } from '../src/testing.ts'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function fixture(): Promise<{ config: UpdateRuntimeConfig; files: string[] }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-fleet-updates-'))
  roots.push(root)
  const profileDir = join(root, 'profiles', 'web')
  await mkdir(profileDir, { recursive: true })
  const packagePath = join(profileDir, 'package.json')
  const lockPath = join(profileDir, 'pnpm-lock.yaml')
  const manifestPath = join(root, 'fleet.lock.yaml')
  await writeFile(packagePath, JSON.stringify({
    dependencies: {
      'npm-plugin': '^1.0.0',
      'github-plugin': 'github:team/github-plugin',
      'local-plugin': 'link:/tmp/local-plugin',
      'artifact-plugin': 'file:/tmp/artifacts/artifact-plugin-1.0.0-deadbeef.tgz',
      'alias-plugin': 'npm:real-plugin@1.0.0',
      'private-plugin': '^1.0.0',
      'plain-library': '^9.0.0',
    },
    dsh: { profile: { bundles: ['npm-plugin', 'github-plugin', 'local-plugin', 'artifact-plugin', 'alias-plugin', 'private-plugin'] } },
  }))
  await writeFile(lockPath, `lockfileVersion: '9.0'
importers:
  .:
    dependencies:
      npm-plugin: { specifier: ^1.0.0, version: 1.0.0 }
      github-plugin:
        specifier: github:team/github-plugin
        version: https://codeload.github.com/team/github-plugin/tar.gz/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
      local-plugin: { specifier: 'link:/tmp/local-plugin', version: 'link:/tmp/local-plugin' }
      artifact-plugin: { specifier: 'file:/tmp/artifacts/artifact-plugin-1.0.0-deadbeef.tgz', version: 'file:/tmp/artifacts/artifact-plugin-1.0.0-deadbeef.tgz' }
      alias-plugin: { specifier: 'npm:real-plugin@1.0.0', version: 1.0.0 }
      private-plugin: { specifier: ^1.0.0, version: 1.0.0 }
      plain-library: { specifier: ^9.0.0, version: 9.0.0 }
`)
  await writeFile(manifestPath, `schemaVersion: 1
team: { id: test }
devices: { device: { class: portable-control, channel: dev } }
plugins:
  - { id: npm-plugin, source: npm, revision: ^1.0.0 }
  - { id: github-plugin, source: github:team/github-plugin }
  - { id: local-plugin, source: 'link:/tmp/local-plugin' }
  - { id: artifact-plugin, source: 'file:/tmp/artifacts/artifact-plugin-1.0.0-deadbeef.tgz' }
`)
  for (const [id, version] of [['npm-plugin', '1.0.0'], ['github-plugin', '2.0.0'], ['local-plugin', '0.0.0-dev'], ['artifact-plugin', '1.0.0'], ['alias-plugin', '1.0.0']] as const) {
    const directory = join(profileDir, 'node_modules', id)
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'package.json'), JSON.stringify({ name: id, version }))
  }
  const privateDirectory = join(profileDir, 'node_modules', 'private-plugin')
  await mkdir(privateDirectory, { recursive: true })
  await writeFile(join(privateDirectory, 'package.json'), JSON.stringify({ name: 'private-plugin', version: '1.0.0', private: true }))
  return {
    config: {
      enabled: true,
      cacheMs: 6 * 60 * 60 * 1000,
      timeoutMs: 1000,
      deviceId: 'device',
      manifestPath,
      profileDir,
      profile: 'web',
      dshVersion: '0.1.0-rc.5',
    },
    files: [packagePath, lockPath, manifestPath],
  }
}

describe('collectFleetUpdates', () => {
  it('tracks core, npm, GitHub and local bundles without touching fleet inputs', async () => {
    const { config, files } = await fixture()
    const before = await Promise.all(files.map(async path => ({
      content: await readFile(path, 'utf8'),
      mtimeMs: (await stat(path)).mtimeMs,
    })))
    const probe: UpdateProbe = {
      npmLatest: vi.fn(async packageName => packageName === '@deepseek-ai/dsh' ? '0.1.0-rc.8' : '1.1.0'),
      githubHead: vi.fn(async () => 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'),
    }

    const report = await collectFleetUpdates(config, probe, Date.parse('2026-08-18T06:00:00.000Z'))

    expect(report.checkedAt).toBe('2026-08-18T06:00:00.000Z')
    expect(report.summary).toEqual({ tracked: 7, available: 3, current: 0, local: 2, missing: 0, errors: 0, unsupported: 2 })
    expect(report.items[0]).toMatchObject({
      id: '@deepseek-ai/dsh', kind: 'dsh', source: 'npm', state: 'available',
      currentVersion: '0.1.0-rc.5', latestVersion: '0.1.0-rc.8', changeKind: 'version',
    })
    expect(report.items.find(item => item.id === 'npm-plugin')).toMatchObject({
      state: 'available', currentVersion: '1.0.0', latestVersion: '1.1.0', changeKind: 'version', managed: true,
    })
    expect(report.items.find(item => item.id === 'github-plugin')).toMatchObject({
      state: 'available', changeKind: 'head-changed',
      currentRevision: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      latestRevision: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    })
    expect(report.items.find(item => item.id === 'local-plugin')).toMatchObject({ state: 'local', source: 'local' })
    expect(report.items.find(item => item.id === 'artifact-plugin')).toMatchObject({ state: 'local', source: 'artifact', currentVersion: '1.0.0' })
    expect(report.items.find(item => item.id === 'alias-plugin')).toMatchObject({ state: 'unsupported', source: 'unknown' })
    expect(report.items.find(item => item.id === 'private-plugin')).toMatchObject({ state: 'unsupported', source: 'npm' })
    expect(report.items.some(item => item.id === 'plain-library')).toBe(false)
    expect(probe.npmLatest).toHaveBeenCalledTimes(2)
    expect(probe.githubHead).toHaveBeenCalledWith('https://github.com/team/github-plugin.git', 1000)

    const after = await Promise.all(files.map(async path => ({
      content: await readFile(path, 'utf8'),
      mtimeMs: (await stat(path)).mtimeMs,
    })))
    expect(after).toEqual(before)
  })

  it('keeps source failures explicit instead of reporting them as current', async () => {
    const { config } = await fixture()
    const probe: UpdateProbe = {
      npmLatest: vi.fn(async () => { throw new Error('secret registry detail') }),
      githubHead: vi.fn(async () => { throw new Error('credential detail') }),
    }
    const report = await collectFleetUpdates(config, probe)
    expect(report.summary).toMatchObject({ tracked: 7, errors: 3, current: 0, local: 2, unsupported: 2 })
    expect(report.items.find(item => item.id === '@deepseek-ai/dsh')).toMatchObject({ state: 'error', errorCode: 'registry-unavailable' })
    expect(report.items.find(item => item.id === 'npm-plugin')).toMatchObject({ state: 'error', errorCode: 'registry-unavailable' })
    expect(report.items.find(item => item.id === 'github-plugin')).toMatchObject({ state: 'error', errorCode: 'github-unavailable' })
    expect(JSON.stringify(report)).not.toContain('secret registry detail')
    expect(JSON.stringify(report)).not.toContain('credential detail')
  })

  it('uses credential-free public HTTPS probes and rejects non-GitHub repositories', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      expect(headers.has('authorization')).toBe(false)
      expect(init?.credentials).toBe('omit')
      expect(init?.redirect).toBe('error')
      const url = String(input)
      if (url.startsWith('https://api.github.com/')) expect(headers.get('x-github-api-version')).toBe('2026-03-10')
      const payload = url.startsWith('https://registry.npmjs.org/')
        ? { version: '1.2.3' }
        : [{ sha: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB' }]
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      await expect(systemUpdateProbe.githubHead('https://github.com/team/repository.git', 2000))
        .resolves.toBe('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')
      expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://api.github.com/repos/team/repository/commits?per_page=1')
      expect(fetchMock.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ credentials: 'omit', redirect: 'error' }))
      await expect(systemUpdateProbe.npmLatest('@team/public-package', 2000)).resolves.toBe('1.2.3')
      expect(String(fetchMock.mock.calls[1]?.[0])).toBe('https://registry.npmjs.org/%40team%2Fpublic-package/latest')
      expect(fetchMock.mock.calls[1]?.[1]).toEqual(expect.objectContaining({ credentials: 'omit', redirect: 'error' }))

      for (const repository of [
        'https://example.com/team/repository.git',
        'https://github.com.evil.example/team/repository.git',
        'https://github.com/team/repository.git?redirect=https://example.com',
        'https://github.com/team%2Fevil/repository.git',
        'https://github.com/_team/repository.git',
        'https://github.com/team/repository-.git',
        'https://github.com/team/repository.git\n',
      ]) {
        await expect(systemUpdateProbe.githubHead(repository, 2000)).rejects.toThrow('unsupported GitHub repository')
      }
      for (const packageName of [
        'UPPERCASE',
        '@team',
        '@team/package/extra',
        '../package',
        'package%2fescape',
        'package.',
        'package\n',
        'a'.repeat(215),
      ]) {
        await expect(systemUpdateProbe.npmLatest(packageName, 2000)).rejects.toThrow('unsupported npm package name')
      }
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('createUpdateMonitor', () => {
  it('supports cache-only reads, TTL refresh, force debounce and input invalidation', async () => {
    const { config } = await fixture()
    let now = Date.parse('2026-08-18T06:00:00.000Z')
    let serial = 0
    const collect = vi.fn(async (_config: UpdateRuntimeConfig, _probe: UpdateProbe, checkedAt: number): Promise<FleetUpdateSnapshot> => ({
      checkedAt: new Date(checkedAt).toISOString(),
      refreshAfter: new Date(checkedAt + 1000).toISOString(),
      summary: { tracked: 0, available: serial++, current: 0, local: 0, missing: 0, errors: 0, unsupported: 0 },
      items: [],
    }))
    const monitor = createUpdateMonitor({ ...config, cacheMs: 1000 }, { now: () => now, collect })

    expect(await monitor.get('cache')).toEqual({ enabled: true, cached: false, stale: false })
    const first = await monitor.get('if-stale')
    expect(first).toMatchObject({ enabled: true, cached: false, stale: false, snapshot: { summary: { available: 0 } } })
    expect(collect).toHaveBeenCalledTimes(1)

    expect(await monitor.get('if-stale')).toMatchObject({ cached: true, stale: false, snapshot: { summary: { available: 0 } } })
    expect(await monitor.get('force')).toMatchObject({ cached: true, snapshot: { summary: { available: 0 } } })
    expect(collect).toHaveBeenCalledTimes(1)

    now += 61_000
    expect(await monitor.get('force')).toMatchObject({ cached: false, snapshot: { summary: { available: 1 } } })
    expect(collect).toHaveBeenCalledTimes(2)

    await writeFile(join(config.profileDir, 'package.json'), JSON.stringify({ changed: true, padding: 'fingerprint' }))
    expect(await monitor.get('cache')).toMatchObject({ cached: true, stale: true })
    now += 61_000
    await monitor.get('if-stale')
    expect(collect).toHaveBeenCalledTimes(3)
  })

  it('merges concurrent refreshes and can be disabled without probing', async () => {
    const { config } = await fixture()
    let release: ((value: FleetUpdateSnapshot) => void) | undefined
    const collect = vi.fn(() => new Promise<FleetUpdateSnapshot>(resolve => { release = resolve }))
    const monitor = createUpdateMonitor(config, { collect })
    const first = monitor.get('if-stale')
    const second = monitor.get('force')
    await vi.waitFor(() => expect(collect).toHaveBeenCalledOnce())
    release?.({
      checkedAt: new Date().toISOString(), refreshAfter: new Date(Date.now() + 1000).toISOString(),
      summary: { tracked: 0, available: 0, current: 0, local: 0, missing: 0, errors: 0, unsupported: 0 }, items: [],
    })
    await Promise.all([first, second])
    expect(collect).toHaveBeenCalledOnce()

    const disabledCollect = vi.fn()
    const disabled = createUpdateMonitor({ ...config, enabled: false }, { collect: disabledCollect })
    expect(await disabled.get('force')).toEqual({ enabled: false, cached: false, stale: false })
    expect(disabledCollect).not.toHaveBeenCalled()
  })

  it('rejects every joined refresh when inputs change during collection', async () => {
    const { config, files } = await fixture()
    let release: ((value: FleetUpdateSnapshot) => void) | undefined
    const collect = vi.fn(() => new Promise<FleetUpdateSnapshot>(resolve => { release = resolve }))
    const monitor = createUpdateMonitor(config, { collect })
    const first = monitor.get('if-stale')
    await vi.waitFor(() => expect(collect).toHaveBeenCalledOnce())
    const second = monitor.get('force')
    await new Promise(resolve => setTimeout(resolve, 20))
    const settled = Promise.allSettled([first, second])
    await writeFile(files[0]!, JSON.stringify({ changedDuringRefresh: true, padding: 'fingerprint-must-change' }))
    release?.({
      checkedAt: new Date().toISOString(), refreshAfter: new Date(Date.now() + 1000).toISOString(),
      summary: { tracked: 0, available: 0, current: 0, local: 0, missing: 0, errors: 0, unsupported: 0 }, items: [],
    })

    const results = await settled
    expect(results.map(result => result.status)).toEqual(['rejected', 'rejected'])
    for (const result of results) {
      if (result.status === 'rejected') expect(result.reason).toMatchObject({ message: 'fleet inputs changed during update check' })
    }
    expect(collect).toHaveBeenCalledOnce()
  })
})

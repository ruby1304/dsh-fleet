import { describe, expect, it } from 'vitest'
import { parseFleetManifest, reconcileFleet } from '../src/testing.ts'

const source = `schemaVersion: 1
team:
  id: example-team
devices:
  controller:
    assignedTo: owner
    class: portable-control
    channel: dev
  worker:
    assignedTo: owner
    class: always-on-worker
    channel: stable
plugins:
  - id: plugin-a
    spec: 1.0.0
    profiles: [web]
  - id: plugin-b
    spec: github:team/plugin-b#aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
    target:
      channels: [stable]
  - id: plugin-c
    spec: 2.0.0
    target:
      devices: [controller]
    runtimeModules: [plugin-c-host]
`

const v2Source = `schemaVersion: 2
team:
  id: example-team
devices:
  controller:
    assignedTo: owner
    class: portable-control
    channel: stable
  worker:
    assignedTo: owner
    class: always-on-worker
    channel: stable
profileReleases:
  control-web:
    version: 2026.8.19-1
    profile: web
    dshRange: "0.1.0-rc.8"
    plugins:
      - id: dsh-public
        visibility: public
        source:
          kind: npm
          version: 1.2.3
      - id: dsh-private
        visibility: private
        source:
          kind: artifact
          version: 4.5.6
          digest: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
  worker-web:
    version: 2026.8.19-2
    profile: web
    dshRange: "0.1.0-rc.8"
    plugins:
      - id: dsh-worker
        visibility: public
        source:
          kind: github
          repository: example/dsh-worker
          revision: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
assignments:
  controller:
    web: control-web
  worker:
    web: worker-web
`

describe('parseFleetManifest', () => {
  it('parses devices, targets and runtime module aliases', () => {
    const manifest = parseFleetManifest(source)
    expect(manifest.team.id).toBe('example-team')
    expect(manifest.devices.controller?.class).toBe('portable-control')
    expect(manifest.plugins[2]?.runtimeModules).toEqual(['plugin-c-host'])
  })

  it('derives dependency specs from source and revision', () => {
    const manifest = parseFleetManifest(`schemaVersion: 1
team: { id: test }
devices: { controller: { class: portable-control, channel: dev } }
plugins:
  - { id: npm-plugin, source: npm, revision: ^0.1.0 }
  - { id: github-plugin, source: github:team/plugin, revision: abc }
  - { id: link-plugin, source: link:/tmp/plugin }
`)
    expect(manifest.plugins.map(plugin => plugin.spec)).toEqual(['^0.1.0', 'github:team/plugin#abc', 'link:/tmp/plugin'])
  })

  it('allows non-overlapping duplicate variants but rejects overlap', () => {
    const manifest = parseFleetManifest(`schemaVersion: 1
team: { id: test }
devices:
  dev: { class: portable-control, channel: dev }
  stable: { class: always-on-worker, channel: stable }
plugins:
  - { id: variant, spec: 1.0.0, target: { devices: [dev] } }
  - { id: variant, spec: 2.0.0, target: { devices: [stable] } }
`)
    expect(manifest.plugins).toHaveLength(2)
    expect(() => parseFleetManifest(`schemaVersion: 1
team: { id: test }
devices: { dev: { class: portable-control, channel: dev } }
plugins:
  - { id: variant, spec: 1.0.0 }
  - { id: variant, spec: 2.0.0, target: { devices: [dev] } }
`)).toThrow(/duplicate plugin id/)
  })

  it('rejects mutable stable variants and link revisions', () => {
    expect(() => parseFleetManifest(source.replace('spec: github:team/plugin-b#aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'source: github:team/plugin-b\n    revision: abc'))).toThrow(/stable plugin/)
    expect(() => parseFleetManifest(source.replace(
      'spec: 1.0.0\n    profiles: [web]',
      'spec: ^1.0.0\n    profiles: [web]\n    target:\n      classes: [always-on-worker]',
    ))).toThrow(/stable plugin/)
    expect(() => parseFleetManifest(`schemaVersion: 1
team: { id: test }
devices: { worker: { class: worker, channel: stable } }
plugins: [{ id: x, source: link:/tmp/x, revision: abc }]
`)).toThrow(/link sources/)
  })

  it('rejects unknown schema versions', () => {
    expect(() => parseFleetManifest(source.replace('schemaVersion: 1', 'schemaVersion: 3'))).toThrow(/schemaVersion/)
  })

  it('rejects device ids that cannot be used consistently by Host and Agent routing', () => {
    expect(() => parseFleetManifest(source.replace('  controller:', '  "controller worker":'))).toThrow(/device id/)
    expect(() => parseFleetManifest(source.replace('devices: [controller]', 'devices: ["controller worker"]'))).toThrow(/target.devices/)
  })

  it('normalizes schema v2 atomic profile releases with public and private plugins', () => {
    const manifest = parseFleetManifest(v2Source)
    expect(manifest.schemaVersion).toBe(2)
    expect(manifest.v2?.assignments).toEqual({ controller: { web: 'control-web' }, worker: { web: 'worker-web' } })
    expect(manifest.v2?.profileReleases['control-web']?.plugins).toHaveLength(2)
    expect(manifest.plugins.find(plugin => plugin.id === 'dsh-public')).toMatchObject({
      spec: '1.2.3',
      source: 'npm',
      releaseId: 'control-web',
      releaseVersion: '2026.8.19-1',
      visibility: 'public',
      profiles: ['web'],
      target: { devices: ['controller'] },
    })
    expect(manifest.plugins.find(plugin => plugin.id === 'dsh-private')).toMatchObject({
      spec: 'artifact:sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      source: 'artifact',
      artifactDigest: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      visibility: 'private',
    })
  })

  it('rejects mutable, misplaced and ambiguous schema v2 release inputs', () => {
    expect(() => parseFleetManifest(v2Source.replace('version: 1.2.3', 'version: ^1.2.3'))).toThrow(/exact semantic version/)
    expect(() => parseFleetManifest(v2Source.replace('visibility: private\n        source:\n          kind: artifact', 'visibility: public\n        source:\n          kind: artifact'))).toThrow(/declared private/)
    expect(() => parseFleetManifest(v2Source.replace('web: control-web', 'web: missing-release'))).toThrow(/unknown release/)
    expect(() => parseFleetManifest(v2Source.replace(
      '      - id: dsh-private',
      '      - id: dsh-public',
    ))).toThrow(/duplicate plugin id/)
    expect(() => parseFleetManifest(v2Source.replace(
      'assignments:\n  controller:',
      'assignments:\n  unknown:',
    ))).toThrow(/unknown device/)
  })
})

describe('reconcileFleet', () => {
  it('selects by device and channel and reports aligned, drift, failed and unmanaged states', () => {
    const result = reconcileFleet({
      manifest: parseFleetManifest(source),
      deviceId: 'controller',
      profile: 'web',
      dependencies: {
        'plugin-a': '1.0.0',
        'plugin-c': '1.9.0',
        extra: '3.0.0',
      },
      bundles: ['plugin-a', 'plugin-c', 'extra'],
      runtime: [
        { entryId: 'a', moduleName: 'plugin-a', enabled: true, fiberPhase: 'active' },
        { entryId: 'c', moduleName: 'plugin-c-host', enabled: true, fiberPhase: 'failed' },
      ],
    })
    expect(result.plugins.map(item => [item.id, item.state])).toEqual([
      ['plugin-a', 'aligned'],
      ['plugin-c', 'spec-drift'],
    ])
    expect(result.plugins.find(item => item.id === 'plugin-a')).toMatchObject({ desiredSpec: '1.0.0' })
    expect(result.unmanaged).toEqual([{ id: 'extra', actualSpec: '3.0.0' }])
    expect(result.summary).toEqual({ desired: 2, aligned: 1, missing: 0, drifted: 1, failed: 0, unmanaged: 1 })
  })

  it('reports runtime failure after the desired spec matches', () => {
    const result = reconcileFleet({
      manifest: parseFleetManifest(source),
      deviceId: 'controller',
      profile: 'web',
      dependencies: { 'plugin-a': '1.0.0', 'plugin-c': '2.0.0' },
      bundles: ['plugin-a', 'plugin-c'],
      runtime: [
        { entryId: 'a', moduleName: 'plugin-a', enabled: true, fiberPhase: 'active' },
        { entryId: 'c', moduleName: 'plugin-c-host', enabled: true, fiberPhase: 'failed' },
      ],
    })
    expect(result.plugins.find(item => item.id === 'plugin-c')?.state).toBe('runtime-failed')
    expect(result.summary.failed).toBe(1)
  })

  it('selects stable-only plugins for the worker', () => {
    const result = reconcileFleet({
      manifest: parseFleetManifest(source),
      deviceId: 'worker',
      profile: 'web',
      dependencies: {},
      bundles: [],
      runtime: [],
    })
    expect(result.plugins.map(item => item.id)).toEqual(['plugin-a', 'plugin-b'])
    expect(result.summary.missing).toBe(2)
  })

  it('reconciles private artifacts by content digest instead of machine-specific file paths', () => {
    const manifest = parseFleetManifest(v2Source)
    const aligned = reconcileFleet({
      manifest,
      deviceId: 'controller',
      profile: 'web',
      dependencies: {
        'dsh-public': '1.2.3',
        'dsh-private': 'file:/Users/example/.local/share/dsh-fleet/artifacts/private.tgz',
      },
      artifactDigests: { 'dsh-private': 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
      bundles: ['dsh-public', 'dsh-private'],
      runtime: [
        { entryId: 'public', moduleName: 'dsh-public', enabled: true, fiberPhase: 'active' },
        { entryId: 'private', moduleName: 'dsh-private', enabled: true, fiberPhase: 'active' },
      ],
    })
    expect(aligned.plugins.map(plugin => [plugin.id, plugin.state])).toEqual([
      ['dsh-private', 'aligned'],
      ['dsh-public', 'aligned'],
    ])
    expect(aligned.plugins[0]).toMatchObject({
      visibility: 'private',
      releaseId: 'control-web',
      actualArtifactDigest: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    })
    const drifted = reconcileFleet({
      ...aligned,
      manifest,
      deviceId: 'controller',
      profile: 'web',
      dependencies: { 'dsh-private': 'file:/tmp/private.tgz' },
      artifactDigests: { 'dsh-private': 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' },
      bundles: ['dsh-private'],
      runtime: [{ entryId: 'private', moduleName: 'dsh-private', enabled: true, fiberPhase: 'active' }],
    })
    expect(drifted.plugins.find(plugin => plugin.id === 'dsh-private')?.state).toBe('spec-drift')
  })
})

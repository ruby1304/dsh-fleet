import { describe, expect, it } from 'vitest'
import { parseFleetManifest, reconcileFleet } from '../src/testing.ts'

const source = `schemaVersion: 1
team:
  id: example-team
devices:
  m5:
    assignedTo: owner
    class: portable-control
    channel: dev
  m3:
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
      devices: [m5]
    runtimeModules: [plugin-c-host]
`

describe('parseFleetManifest', () => {
  it('parses devices, targets and runtime module aliases', () => {
    const manifest = parseFleetManifest(source)
    expect(manifest.team.id).toBe('example-team')
    expect(manifest.devices.m5?.class).toBe('portable-control')
    expect(manifest.plugins[2]?.runtimeModules).toEqual(['plugin-c-host'])
  })

  it('derives dependency specs from source and revision', () => {
    const manifest = parseFleetManifest(`schemaVersion: 1
team: { id: test }
devices: { m5: { class: portable-control, channel: dev } }
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
devices: { m3: { class: worker, channel: stable } }
plugins: [{ id: x, source: link:/tmp/x, revision: abc }]
`)).toThrow(/link sources/)
  })

  it('rejects unknown schema versions', () => {
    expect(() => parseFleetManifest(source.replace('schemaVersion: 1', 'schemaVersion: 2'))).toThrow(/schemaVersion/)
  })
})

describe('reconcileFleet', () => {
  it('selects by device and channel and reports aligned, drift, failed and unmanaged states', () => {
    const result = reconcileFleet({
      manifest: parseFleetManifest(source),
      deviceId: 'm5',
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
      deviceId: 'm5',
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
      deviceId: 'm3',
      profile: 'web',
      dependencies: {},
      bundles: [],
      runtime: [],
    })
    expect(result.plugins.map(item => item.id)).toEqual(['plugin-a', 'plugin-b'])
    expect(result.summary.missing).toBe(2)
  })
})

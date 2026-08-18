import { describe, expect, it } from 'vitest'
import type { FleetManifest, FleetPluginSpec } from '../src/shared.ts'
import {
  canonicalJson,
  validateFleetPlan,
  validateFleetPlanApproval,
  type FleetPlanApproval,
} from '../src/agent/protocol.ts'
import { createAgentPlan } from '../src/agent/planner.ts'
import { assertMutationReadyConfig, parseAgentConfig } from '../src/agent/config.ts'

const MANIFEST_DIGEST = 'a'.repeat(64)
const PROFILE_HASH = 'b'.repeat(64)
const GIT_SHA = 'c'.repeat(40)
const NOW = '2026-08-18T08:00:00.000Z'

function manifest(plugin: FleetPluginSpec): FleetManifest {
  return {
    schemaVersion: 1,
    team: { id: 'example-team' },
    devices: {
      worker: { class: 'always-on-worker', channel: 'stable' },
    },
    plugins: [{ ...plugin, profiles: ['web'], target: { devices: ['worker'] } }],
  }
}

function npmPlugin(spec = '1.2.3'): FleetPluginSpec {
  return { id: 'plugin-a', spec, source: 'npm', revision: spec }
}

function input(plugin: FleetPluginSpec = npmPlugin(), dependencies: Record<string, string> = {}) {
  return {
    manifest: manifest(plugin),
    manifestDigest: MANIFEST_DIGEST,
    dependencies,
    profileHash: PROFILE_HASH,
    observedDshVersion: '0.1.0-rc.7',
    now: NOW,
    pluginId: plugin.id,
    deviceId: 'worker',
    profile: 'web',
  }
}

describe('fleet agent protocol and planner', () => {
  it('uses deterministic canonical JSON and stable plan hashes', () => {
    expect(canonicalJson({ z: 1, a: { y: 2, x: 3 } })).toBe('{"a":{"x":3,"y":2},"z":1}')
    const first = createAgentPlan(input())
    const second = createAgentPlan({ ...input(), dependencies: Object.fromEntries([]) })
    expect(second).toEqual(first)
    expect(first.digest).toMatch(/^[0-9a-f]{64}$/)
    expect(first.planId).toBe('plan:' + first.digest)
    const changed = createAgentPlan({ ...input(), profileHash: 'd'.repeat(64) })
    expect(changed.digest).not.toBe(first.digest)
  })

  it('detects any plan body change after the digest is issued', () => {
    const plan = createAgentPlan(input())
    expect(() => validateFleetPlan({ ...plan, pluginId: 'substituted-plugin' })).toThrow(/digest/)
  })

  it('accepts rc.7 and rejects rc.5', () => {
    expect(createAgentPlan(input()).observedDshVersion).toBe('0.1.0-rc.7')
    expect(() => createAgentPlan({ ...input(), observedDshVersion: '0.1.0-rc.5' }))
      .toThrowError(expect.objectContaining({ code: 'unsupported-dsh-version' }))
  })

  it('creates an install plan for an exact npm version', () => {
    const plan = createAgentPlan(input())
    expect(plan).toMatchObject({
      protocolVersion: 1,
      deviceId: 'worker',
      profile: 'web',
      pluginId: 'plugin-a',
      action: 'install',
      fromSpec: null,
      exactToSpec: '1.2.3',
      sourceKind: 'npm',
      restartRequired: true,
      createdAt: NOW,
      expiresAt: '2026-08-18T08:05:00.000Z',
    })
  })

  it('creates an update plan for an exact GitHub commit', () => {
    const source = 'github:ruby1304/plugin-a'
    const plugin: FleetPluginSpec = { id: 'plugin-a', source, revision: GIT_SHA, spec: source + '#' + GIT_SHA }
    const plan = createAgentPlan(input(plugin, { 'plugin-a': source + '#' + 'd'.repeat(40) }))
    expect(plan).toMatchObject({
      action: 'update',
      fromSpec: source + '#' + 'd'.repeat(40),
      exactToSpec: source + '#' + GIT_SHA,
      sourceKind: 'github',
    })
  })

  it.each([
    ['npm range', { id: 'plugin-a', spec: '^1.2.3', source: 'npm', revision: '^1.2.3' }],
    ['npm tag', { id: 'plugin-a', spec: 'latest', source: 'npm', revision: 'latest' }],
    ['GitHub tag', { id: 'plugin-a', spec: 'github:ruby1304/plugin-a#main' }],
    ['link', { id: 'plugin-a', spec: 'link:/tmp/plugin-a' }],
    ['file', { id: 'plugin-a', spec: 'file:/tmp/plugin-a' }],
    ['workspace', { id: 'plugin-a', spec: 'workspace:*' }],
    ['URL', { id: 'plugin-a', spec: 'https://example.com/plugin-a.tgz' }],
  ] satisfies Array<[string, FleetPluginSpec]>)('rejects mutable or unsafe %s sources', (_label, plugin) => {
    expect(() => createAgentPlan(input(plugin))).toThrow()
  })

  it('rejects arbitrary shell fields instead of silently ignoring them', () => {
    const unsafePlugin = { ...npmPlugin(), shell: 'rm -rf /' } as FleetPluginSpec
    expect(() => createAgentPlan(input(unsafePlugin))).toThrow(/unsupported field/)
    expect(() => createAgentPlan({ ...input(), command: 'anything' } as Parameters<typeof createAgentPlan>[0]))
      .toThrow(/unsupported field/)
  })

  it.each([
    'alias@npm:other-package',
    '-dangerous-option',
    'plugin@name',
    '@scope/name@npm:other-package',
    'UPPERCASE',
  ])('rejects a package id that could change pnpm argument meaning: %s', pluginId => {
    const plugin = { ...npmPlugin(), id: pluginId }
    expect(() => createAgentPlan(input(plugin))).toThrow(/literal lowercase npm package name/)
  })

  it('uses the configured bounded plan lifetime', () => {
    const plan = createAgentPlan({ ...input(), planTtlMs: 10 * 60 * 1000 })
    expect(plan.expiresAt).toBe('2026-08-18T08:10:00.000Z')
    expect(() => createAgentPlan({ ...input(), planTtlMs: 1000 })).toThrow(/planTtlMs/)
  })

  it('requires a loopback health URL when Fleet RPC health is enabled', () => {
    expect(() => parseAgentConfig({
      schemaVersion: 1,
      deviceId: 'worker',
      manifestPath: '/tmp/fleet.lock.yaml',
      dshHome: '/tmp/dsh-home',
      dshBinary: '/tmp/dsh',
      pnpmBinary: '/tmp/pnpm',
      profile: 'web',
      stateDir: '/tmp/fleet-state',
      planTtlMs: 300_000,
      restart: { kind: 'none' },
      health: { timeoutMs: 45_000, requireFleetRpc: true },
    })).toThrow(/needs health.url/)
  })

  it('keeps read-only config valid but rejects it for mutation', () => {
    const config = parseAgentConfig({
      schemaVersion: 1,
      deviceId: 'worker',
      manifestPath: '/tmp/fleet.lock.yaml',
      dshHome: '/tmp/dsh-home',
      dshBinary: '/tmp/dsh',
      pnpmBinary: '/tmp/pnpm',
      profile: 'web',
      stateDir: '/tmp/fleet-state',
      planTtlMs: 300_000,
      restart: { kind: 'none' },
      health: { timeoutMs: 45_000, requireFleetRpc: false },
    })
    expect(config.restart).toEqual({ kind: 'none' })
    expect(() => assertMutationReadyConfig(config))
      .toThrowError(expect.objectContaining({ code: 'unsafe-mutation-config' }))
  })

  it('requires mutation health to verify the configured loopback restart port', () => {
    const base = {
      schemaVersion: 1,
      deviceId: 'worker',
      manifestPath: '/tmp/fleet.lock.yaml',
      dshHome: '/tmp/dsh-home',
      dshBinary: '/tmp/dsh',
      pnpmBinary: '/tmp/pnpm',
      profile: 'web',
      stateDir: '/tmp/fleet-state',
      planTtlMs: 300_000,
      restart: {
        kind: 'screen',
        screenBinary: '/usr/bin/screen',
        lsofBinary: '/usr/sbin/lsof',
        psBinary: '/bin/ps',
        ownerMarkers: ['fake-dsh'],
        sessionName: 'fake-dsh',
        host: '127.0.0.1',
        port: 3211,
      },
      health: { url: 'http://127.0.0.1:3211', timeoutMs: 45_000, requireFleetRpc: true },
    }
    const config = parseAgentConfig(base)
    expect(() => assertMutationReadyConfig(config)).not.toThrow()
    const mismatch = parseAgentConfig({ ...base, health: { ...base.health, url: 'http://127.0.0.1:3212' } })
    expect(() => assertMutationReadyConfig(mismatch)).toThrow(/restart port/)
  })

  it('rejects an already aligned plugin instead of creating a no-op plan', () => {
    expect(() => createAgentPlan(input(npmPlugin(), { 'plugin-a': '1.2.3' })))
      .toThrowError(expect.objectContaining({ code: 'already-aligned' }))
  })

  it('validates approval binding, expiry and idempotency', () => {
    const plan = createAgentPlan(input())
    const approval: FleetPlanApproval = {
      protocolVersion: 1,
      approvalId: 'approval-01',
      principalId: 'owner',
      planId: plan.planId,
      planDigest: plan.digest,
      deviceId: plan.deviceId,
      profile: plan.profile,
      approvedAt: '2026-08-18T08:01:00.000Z',
      expiresAt: '2026-08-18T08:04:00.000Z',
    }
    const first = validateFleetPlanApproval(plan, approval, '2026-08-18T08:02:00.000Z')
    const duplicate = validateFleetPlanApproval(plan, approval, '2026-08-18T08:02:00.000Z')
    expect(duplicate.idempotencyKey).toBe(first.idempotencyKey)
    expect(() => validateFleetPlanApproval(plan, approval, '2026-08-18T08:04:00.000Z')).toThrow(/expired/)
    expect(() => validateFleetPlanApproval(plan, { ...approval, planDigest: 'd'.repeat(64) }, '2026-08-18T08:02:00.000Z'))
      .toThrow(/not bound/)
    expect(() => validateFleetPlanApproval(plan, { ...approval, deviceId: 'other-device' }, '2026-08-18T08:02:00.000Z'))
      .toThrow(/not bound/)
    expect(() => validateFleetPlanApproval(plan, { ...approval, profile: 'other-profile' }, '2026-08-18T08:02:00.000Z'))
      .toThrow(/not bound/)
  })
})

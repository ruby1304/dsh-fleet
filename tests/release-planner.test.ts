import { describe, expect, it } from 'vitest'
import { parseFleetManifest } from '../src/host/core.ts'
import { createReleasePlan } from '../src/agent/release-planner.ts'
import {
  validateFleetReleaseApproval,
  validateFleetReleasePlan,
  type FleetAppliedRelease,
  type FleetReleaseApproval,
} from '../src/agent/release-protocol.ts'

const manifestSource = `schemaVersion: 2
team: { id: test-team }
devices:
  worker: { assignedTo: owner, class: always-on-worker, channel: stable }
profileReleases:
  stable-web:
    version: 3.0.0
    profile: web
    dshRange: ">=0.1.0-rc.7 <0.2.0"
    plugins:
      - id: public-plugin
        visibility: public
        source: { kind: npm, version: 1.2.3, integrity: sha512-YWJjZA== }
      - id: private-plugin
        visibility: private
        runtimeModules: [private-host]
        source:
          kind: artifact
          version: 2.0.0
          digest: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
assignments:
  worker: { web: stable-web }
`

function create(overrides: Partial<Parameters<typeof createReleasePlan>[0]> = {}) {
  return createReleasePlan({
    manifest: parseFleetManifest(manifestSource),
    manifestDigest: 'a'.repeat(64),
    dependencies: {},
    profileHash: 'c'.repeat(64),
    observedDshVersion: '0.1.0-rc.7',
    now: new Date('2026-08-19T00:00:00.000Z'),
    deviceId: 'worker',
    profile: 'web',
    ...overrides,
  })
}

describe('atomic profile release planner', () => {
  it('creates one immutable batch plan for public and private plugins without leaking local paths', () => {
    const plan = create({
      dependencies: {
        'public-plugin': '1.2.3',
        'private-plugin': 'file:/Users/owner/private/plugin.tgz',
      },
      artifactDigests: { 'private-plugin': 'd'.repeat(64) },
    })
    validateFleetReleasePlan(plan)
    expect(plan).toMatchObject({
      kind: 'profile-release',
      releaseId: 'stable-web',
      releaseVersion: '3.0.0',
      restartRequired: true,
      changes: [{
        pluginId: 'private-plugin',
        action: 'update',
        exactToSpec: 'artifact:sha256:' + 'b'.repeat(64),
        artifactDigest: 'b'.repeat(64),
      }],
    })
    expect(plan.plugins.map(plugin => plugin.pluginId)).toEqual(['private-plugin', 'public-plugin'])
    expect(JSON.stringify(plan)).not.toContain('/Users/owner/private')
    expect(plan.changes[0]?.fromSpecDigest).toMatch(/^[0-9a-f]{64}$/)
  })

  it('adopts an already materialized release without an unnecessary restart', () => {
    const plan = create({
      dependencies: { 'public-plugin': '1.2.3', 'private-plugin': 'file:/artifact-store/private.tgz' },
      artifactDigests: { 'private-plugin': 'b'.repeat(64) },
    })
    expect(plan.changes).toEqual([])
    expect(plan.restartRequired).toBe(false)
  })

  it('removes only plugins owned by the previously applied release', () => {
    const oldPlugin = {
      pluginId: 'old-plugin',
      visibility: 'public' as const,
      sourceKind: 'npm' as const,
      exactSpec: '1.0.0',
      artifactDigest: null,
      packageVersion: '1.0.0',
      integrity: 'sha512-YWJjZA==',
      runtimeModules: ['old-plugin'],
    }
    const previous: FleetAppliedRelease = {
      schemaVersion: 1,
      deviceId: 'worker',
      profile: 'web',
      releaseId: 'old-web',
      releaseVersion: '2.0.0',
      releaseDigest: 'e'.repeat(64),
      plugins: [oldPlugin],
      appliedAt: '2026-08-18T00:00:00.000Z',
    }
    const plan = create({
      dependencies: { 'old-plugin': '1.0.0', unmanaged: '9.9.9' },
      appliedRelease: previous,
    })
    expect(plan.changes.find(change => change.pluginId === 'old-plugin')).toMatchObject({ action: 'remove', exactToSpec: null })
    expect(plan.changes.find(change => change.pluginId === 'unmanaged')).toBeUndefined()
  })

  it('binds approvals to the exact batch plan and expiry window', () => {
    const plan = create()
    const approval: FleetReleaseApproval = {
      protocolVersion: 1,
      kind: 'profile-release',
      approvalId: 'approval-1',
      principalId: 'owner',
      planId: plan.planId,
      planDigest: plan.digest,
      deviceId: plan.deviceId,
      profile: plan.profile,
      approvedAt: '2026-08-19T00:00:10.000Z',
      expiresAt: '2026-08-19T00:02:00.000Z',
    }
    expect(validateFleetReleaseApproval(plan, approval, '2026-08-19T00:01:00.000Z').idempotencyKey).toMatch(/^[0-9a-f]{64}$/)
    expect(() => validateFleetReleaseApproval(plan, { ...approval, planDigest: 'f'.repeat(64) }, '2026-08-19T00:01:00.000Z')).toThrow(/does not match/)
    expect(() => validateFleetReleaseApproval(plan, approval, '2026-08-19T00:03:00.000Z')).toThrow(/expired/)
  })

  it('fails closed for non-v2, non-stable and incompatible assignments', () => {
    const v1 = parseFleetManifest(`schemaVersion: 1
team: { id: test }
devices: { worker: { class: always-on-worker, channel: stable } }
plugins: []
`)
    expect(() => create({ manifest: v1 })).toThrow(/schemaVersion 2/)
    expect(() => create({ manifest: parseFleetManifest(manifestSource.replace('channel: stable', 'channel: dev')) })).toThrow(/stable devices/)
    expect(() => create({ manifest: parseFleetManifest(manifestSource.replace('>=0.1.0-rc.7 <0.2.0', '>=1.0.0')) })).toThrow(/does not support/)
  })
})

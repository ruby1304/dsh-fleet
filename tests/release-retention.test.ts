import { describe, expect, it } from 'vitest'
import {
  createFleetReleaseRetentionPlan,
  validateFleetReleaseRetentionApproval,
  validateFleetReleaseRetentionPlan,
  type FleetReleaseRetentionApproval,
} from '../src/agent/release-retention.ts'

function plan() {
  return createFleetReleaseRetentionPlan({
    protocolVersion: 1,
    kind: 'profile-release-retention',
    deviceId: 'worker',
    profile: 'web',
    currentTransitionPlanId: 'release-plan:' + 'c'.repeat(64),
    retainedTransitionPlanIds: [
      'release-plan:' + 'b'.repeat(64),
      'release-plan:' + 'c'.repeat(64),
    ],
    entries: [{
      transitionPlanId: 'release-plan:' + 'a'.repeat(64),
      descriptorDigest: 'd'.repeat(64),
      backupProfile: 'fleet-backup-' + 'e'.repeat(24),
      backupManifestDigest: 'f'.repeat(64),
      backupProfileHash: '1'.repeat(64),
      reason: 'superseded',
    }],
    orphanBackupProfiles: ['fleet-backup-' + '9'.repeat(24)],
    orphanStageProfiles: ['fleet-stage-' + '8'.repeat(24)],
    orphanFailedProfiles: ['fleet-failed-' + '7'.repeat(24)],
    createdAt: '2026-08-19T00:00:00.000Z',
    expiresAt: '2026-08-19T00:10:00.000Z',
  })
}

describe('release backup retention protocol', () => {
  it('binds the retained chain, exact backup state and orphan inventory', () => {
    const value = plan()
    expect(() => validateFleetReleaseRetentionPlan(value)).not.toThrow()
    expect(value).toMatchObject({
      planId: 'release-retention-plan:' + value.digest,
      digest: expect.stringMatching(/^[0-9a-f]{64}$/),
    })
    expect(() => validateFleetReleaseRetentionPlan({
      ...value,
      entries: [{ ...value.entries[0]!, backupProfileHash: '2'.repeat(64) }],
    })).toThrow(/identity/)
  })

  it('requires an explicit, exact and unexpired approval', () => {
    const value = plan()
    const approval: FleetReleaseRetentionApproval = {
      protocolVersion: 1,
      kind: 'profile-release-retention',
      approvalId: 'retention-approval-1',
      principalId: 'owner',
      planId: value.planId,
      planDigest: value.digest,
      deviceId: value.deviceId,
      profile: value.profile,
      approvedAt: '2026-08-19T00:00:10.000Z',
      expiresAt: '2026-08-19T00:05:00.000Z',
    }
    expect(validateFleetReleaseRetentionApproval(value, approval, '2026-08-19T00:01:00.000Z').idempotencyKey).toMatch(/^[0-9a-f]{64}$/)
    expect(() => validateFleetReleaseRetentionApproval(value, { ...approval, planDigest: '0'.repeat(64) }, '2026-08-19T00:01:00.000Z')).toThrow(/does not match/)
    expect(() => validateFleetReleaseRetentionApproval(value, approval, '2026-08-19T00:06:00.000Z')).toThrow(/expired/)
  })

  it('never treats current or retained transitions as prune candidates', () => {
    const value = plan()
    const { planId: _planId, digest: _digest, ...body } = value
    expect(() => createFleetReleaseRetentionPlan({
      ...body,
      entries: [{ ...value.entries[0]!, transitionPlanId: value.currentTransitionPlanId! }],
    })).toThrow(/cannot be pruned/)
  })

  it('supports a legacy or empty state with no transition chain', () => {
    const value = plan()
    const { planId: _planId, digest: _digest, ...body } = value
    expect(() => createFleetReleaseRetentionPlan({
      ...body,
      currentTransitionPlanId: null,
      retainedTransitionPlanIds: [],
      entries: [],
    })).not.toThrow()
    expect(() => createFleetReleaseRetentionPlan({
      ...body,
      currentTransitionPlanId: null,
      retainedTransitionPlanIds: [value.retainedTransitionPlanIds[0]!],
      entries: [],
    })).toThrow(/require a current transition/)
    expect(() => createFleetReleaseRetentionPlan({
      ...body,
      currentTransitionPlanId: null,
      retainedTransitionPlanIds: [],
    })).toThrow(/entries require a current transition/)
  })

  it('fixes the retained rollback window at two transitions', () => {
    const value = plan()
    const { planId: _planId, digest: _digest, ...body } = value
    expect(() => createFleetReleaseRetentionPlan({
      ...body,
      retainedTransitionPlanIds: [
        ...body.retainedTransitionPlanIds,
        'release-plan:' + 'e'.repeat(64),
      ].sort(),
    })).toThrow(/at most the current and previous/)
  })
})

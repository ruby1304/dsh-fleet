import { FleetProtocolError, canonicalJson, sha256Canonical } from './protocol.ts'

export const FLEET_RELEASE_RETENTION_PROTOCOL_VERSION = 1 as const

export interface FleetReleaseRetentionEntry {
  transitionPlanId: string
  descriptorDigest: string
  backupProfile: string | null
  backupManifestDigest: string | null
  backupProfileHash: string | null
  reason: 'superseded'
}

export interface FleetReleaseRetentionPlanBody {
  protocolVersion: typeof FLEET_RELEASE_RETENTION_PROTOCOL_VERSION
  kind: 'profile-release-retention'
  deviceId: string
  profile: string
  currentTransitionPlanId: string | null
  retainedTransitionPlanIds: string[]
  entries: FleetReleaseRetentionEntry[]
  orphanBackupProfiles: string[]
  orphanStageProfiles: string[]
  orphanFailedProfiles: string[]
  createdAt: string
  expiresAt: string
}

export interface FleetReleaseRetentionPlan extends FleetReleaseRetentionPlanBody {
  planId: string
  digest: string
}

export interface FleetReleaseRetentionApproval {
  protocolVersion: typeof FLEET_RELEASE_RETENTION_PROTOCOL_VERSION
  kind: 'profile-release-retention'
  approvalId: string
  principalId: string
  planId: string
  planDigest: string
  deviceId: string
  profile: string
  approvedAt: string
  expiresAt: string
}

const BODY_KEYS = [
  'protocolVersion', 'kind', 'deviceId', 'profile', 'currentTransitionPlanId',
  'retainedTransitionPlanIds', 'entries', 'orphanBackupProfiles', 'orphanStageProfiles',
  'orphanFailedProfiles', 'createdAt', 'expiresAt',
] as const
const PLAN_KEYS = [...BODY_KEYS, 'planId', 'digest'] as const
const ENTRY_KEYS = [
  'transitionPlanId', 'descriptorDigest', 'backupProfile', 'backupManifestDigest', 'backupProfileHash', 'reason',
] as const
const APPROVAL_KEYS = [
  'protocolVersion', 'kind', 'approvalId', 'principalId', 'planId', 'planDigest',
  'deviceId', 'profile', 'approvedAt', 'expiresAt',
] as const

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new FleetProtocolError('invalid-payload', label + ' must be an object')
  }
  return value as Record<string, unknown>
}

function exact(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  const body = object(value, label)
  const actual = Object.keys(body).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new FleetProtocolError('invalid-payload', label + ' has unsupported or missing fields')
  }
  return body
}

function identifier(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)) {
    throw new FleetProtocolError('invalid-payload', label + ' is invalid')
  }
}

function digest(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    throw new FleetProtocolError('invalid-digest', label + ' must be a lowercase SHA-256 digest')
  }
}

function transitionId(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^release-plan:[0-9a-f]{64}$/.test(value)) {
    throw new FleetProtocolError('invalid-payload', label + ' is invalid')
  }
}

function timestamp(value: unknown, label: string): number {
  if (typeof value !== 'string') throw new FleetProtocolError('invalid-time', label + ' must be a canonical timestamp')
  const time = Date.parse(value)
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) {
    throw new FleetProtocolError('invalid-time', label + ' must be a canonical timestamp')
  }
  return time
}

function sortedUnique(values: unknown, label: string, validate: (value: unknown, label: string) => asserts value is string): string[] {
  if (!Array.isArray(values)) throw new FleetProtocolError('invalid-payload', label + ' must be an array')
  values.forEach((value, index) => validate(value, `${label}[${index}]`))
  if (new Set(values).size !== values.length || values.some((value, index) => index > 0 && value <= values[index - 1]!)) {
    throw new FleetProtocolError('invalid-payload', label + ' must be unique and sorted')
  }
  return values as string[]
}

function validateEntry(value: unknown, index: number): asserts value is FleetReleaseRetentionEntry {
  const body = exact(value, ENTRY_KEYS, `entries[${index}]`)
  transitionId(body.transitionPlanId, `entries[${index}].transitionPlanId`)
  digest(body.descriptorDigest, `entries[${index}].descriptorDigest`)
  if (body.backupProfile === null) {
    if (body.backupManifestDigest !== null || body.backupProfileHash !== null) {
      throw new FleetProtocolError('invalid-payload', 'marker-only retention entries cannot bind a backup')
    }
  } else {
    if (typeof body.backupProfile !== 'string' || !/^fleet-backup-[0-9a-f]{24}$/.test(body.backupProfile)) {
      throw new FleetProtocolError('invalid-payload', 'retention backup profile is invalid')
    }
    digest(body.backupManifestDigest, `entries[${index}].backupManifestDigest`)
    digest(body.backupProfileHash, `entries[${index}].backupProfileHash`)
  }
  if (body.reason !== 'superseded') throw new FleetProtocolError('invalid-payload', 'retention reason is invalid')
}

function validateBody(value: FleetReleaseRetentionPlanBody): void {
  exact(value, BODY_KEYS, 'release retention plan body')
  if (value.protocolVersion !== FLEET_RELEASE_RETENTION_PROTOCOL_VERSION || value.kind !== 'profile-release-retention') {
    throw new FleetProtocolError('invalid-protocol', 'unsupported release retention protocol')
  }
  identifier(value.deviceId, 'deviceId')
  identifier(value.profile, 'profile')
  if (value.currentTransitionPlanId !== null) transitionId(value.currentTransitionPlanId, 'currentTransitionPlanId')
  const retained = sortedUnique(value.retainedTransitionPlanIds, 'retainedTransitionPlanIds', transitionId)
  if (retained.length > 2) {
    throw new FleetProtocolError('invalid-payload', 'release retention keeps at most the current and previous transitions')
  }
  if (value.currentTransitionPlanId !== null && !retained.includes(value.currentTransitionPlanId)) {
    throw new FleetProtocolError('invalid-payload', 'retained transitions must include the current transition')
  }
  if (value.currentTransitionPlanId === null && retained.length !== 0) {
    throw new FleetProtocolError('invalid-payload', 'retained transitions require a current transition')
  }
  if (!Array.isArray(value.entries)) throw new FleetProtocolError('invalid-payload', 'entries must be an array')
  value.entries.forEach(validateEntry)
  if (value.currentTransitionPlanId === null && value.entries.length !== 0) {
    throw new FleetProtocolError('invalid-payload', 'retention entries require a current transition')
  }
  const entryIds = value.entries.map(entry => entry.transitionPlanId)
  if (new Set(entryIds).size !== entryIds.length || entryIds.some((id, index) => index > 0 && id <= entryIds[index - 1]!)) {
    throw new FleetProtocolError('invalid-payload', 'retention entries must be unique and sorted')
  }
  if (entryIds.some(id => retained.includes(id))) {
    throw new FleetProtocolError('invalid-payload', 'retained transitions cannot be pruned')
  }
  sortedUnique(value.orphanBackupProfiles, 'orphanBackupProfiles', (item, label): asserts item is string => {
    if (typeof item !== 'string' || !/^fleet-backup-[0-9a-f]{24}$/.test(item)) {
      throw new FleetProtocolError('invalid-payload', label + ' is invalid')
    }
  })
  sortedUnique(value.orphanStageProfiles, 'orphanStageProfiles', (item, label): asserts item is string => {
    if (typeof item !== 'string' || !/^fleet-stage-[0-9a-f]{24}$/.test(item)) {
      throw new FleetProtocolError('invalid-payload', label + ' is invalid')
    }
  })
  sortedUnique(value.orphanFailedProfiles, 'orphanFailedProfiles', (item, label): asserts item is string => {
    if (typeof item !== 'string' || !/^fleet-failed-[0-9a-f]{24}$/.test(item)) {
      throw new FleetProtocolError('invalid-payload', label + ' is invalid')
    }
  })
  const createdAt = timestamp(value.createdAt, 'createdAt')
  const expiresAt = timestamp(value.expiresAt, 'expiresAt')
  if (expiresAt <= createdAt || expiresAt - createdAt > 60 * 60 * 1000) {
    throw new FleetProtocolError('invalid-time', 'release retention plan lifetime is invalid')
  }
}

export function createFleetReleaseRetentionPlan(body: FleetReleaseRetentionPlanBody): FleetReleaseRetentionPlan {
  validateBody(body)
  const digest = sha256Canonical(body)
  return Object.freeze({ ...body, planId: 'release-retention-plan:' + digest, digest })
}

export function validateFleetReleaseRetentionPlan(value: FleetReleaseRetentionPlan): void {
  exact(value, PLAN_KEYS, 'release retention plan')
  const body = Object.fromEntries(BODY_KEYS.map(key => [key, value[key]])) as unknown as FleetReleaseRetentionPlanBody
  validateBody(body)
  digest(value.digest, 'digest')
  if (value.planId !== 'release-retention-plan:' + value.digest || sha256Canonical(body) !== value.digest) {
    throw new FleetProtocolError('plan-integrity-failed', 'release retention plan identity is invalid')
  }
}

export function validateFleetReleaseRetentionApproval(
  plan: FleetReleaseRetentionPlan,
  approval: FleetReleaseRetentionApproval,
  now: Date | string,
): { idempotencyKey: string } {
  validateFleetReleaseRetentionPlan(plan)
  const body = exact(approval, APPROVAL_KEYS, 'release retention approval')
  if (body.protocolVersion !== FLEET_RELEASE_RETENTION_PROTOCOL_VERSION || body.kind !== 'profile-release-retention') {
    throw new FleetProtocolError('invalid-protocol', 'unsupported release retention approval protocol')
  }
  for (const field of ['approvalId', 'principalId'] as const) identifier(body[field], field)
  if (body.planId !== plan.planId || body.deviceId !== plan.deviceId || body.profile !== plan.profile) {
    throw new FleetProtocolError('approval-mismatch', 'release retention approval does not match its plan')
  }
  digest(body.planDigest, 'planDigest')
  if (body.planDigest !== plan.digest) throw new FleetProtocolError('approval-mismatch', 'release retention digest does not match its plan')
  const approvedAt = timestamp(body.approvedAt, 'approvedAt')
  const expiresAt = timestamp(body.expiresAt, 'approval.expiresAt')
  const nowAt = now instanceof Date ? now.getTime() : timestamp(now, 'now')
  if (expiresAt <= approvedAt || approvedAt < Date.parse(plan.createdAt) || approvedAt >= Date.parse(plan.expiresAt)) {
    throw new FleetProtocolError('approval-mismatch', 'release retention approval is outside its plan window')
  }
  if (expiresAt > Date.parse(plan.expiresAt)) {
    throw new FleetProtocolError('approval-mismatch', 'release retention approval cannot outlive its plan')
  }
  if (nowAt >= Date.parse(plan.expiresAt)) throw new FleetProtocolError('plan-expired', 'release retention plan has expired')
  if (nowAt >= expiresAt) throw new FleetProtocolError('approval-expired', 'release retention approval has expired')
  return { idempotencyKey: sha256Canonical({ planDigest: plan.digest, approval: JSON.parse(canonicalJson(approval)) as unknown }) }
}

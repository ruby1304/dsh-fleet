import { createHash } from 'node:crypto'
import { satisfies, valid } from 'semver'

export const FLEET_AGENT_PROTOCOL_VERSION = 1 as const
export const FLEET_AGENT_DSH_RANGE = '>=0.1.0-rc.7 <0.2.0'

export type FleetPlanAction = 'install' | 'update'
export type FleetPlanSourceKind = 'npm' | 'github'

export interface FleetPlanBody {
  protocolVersion: typeof FLEET_AGENT_PROTOCOL_VERSION
  deviceId: string
  profile: string
  manifestDigest: string
  profileHash: string
  observedDshVersion: string
  pluginId: string
  action: FleetPlanAction
  fromSpec: string | null
  exactToSpec: string
  sourceKind: FleetPlanSourceKind
  restartRequired: true
  createdAt: string
  expiresAt: string
}

export interface FleetPlan extends FleetPlanBody {
  planId: string
  digest: string
}

export interface FleetPlanApproval {
  protocolVersion: typeof FLEET_AGENT_PROTOCOL_VERSION
  approvalId: string
  principalId: string
  planId: string
  planDigest: string
  deviceId: string
  profile: string
  approvedAt: string
  expiresAt: string
}

export interface ApprovalValidation {
  idempotencyKey: string
}

export type FleetProtocolErrorCode =
  | 'invalid-protocol'
  | 'invalid-payload'
  | 'invalid-digest'
  | 'invalid-time'
  | 'unsupported-dsh-version'
  | 'unsupported-source'
  | 'invalid-action'
  | 'plan-integrity-failed'
  | 'plan-expired'
  | 'approval-expired'
  | 'approval-mismatch'

export class FleetProtocolError extends Error {
  readonly code: FleetProtocolErrorCode

  constructor(code: FleetProtocolErrorCode, message: string) {
    super(message)
    this.name = 'FleetProtocolError'
    this.code = code
  }
}

const PLAN_BODY_KEYS = [
  'protocolVersion',
  'deviceId',
  'profile',
  'manifestDigest',
  'profileHash',
  'observedDshVersion',
  'pluginId',
  'action',
  'fromSpec',
  'exactToSpec',
  'sourceKind',
  'restartRequired',
  'createdAt',
  'expiresAt',
] as const

const PLAN_KEYS = [...PLAN_BODY_KEYS, 'planId', 'digest'] as const
const APPROVAL_KEYS = [
  'protocolVersion',
  'approvalId',
  'principalId',
  'planId',
  'planDigest',
  'deviceId',
  'profile',
  'approvedAt',
  'expiresAt',
] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertExactKeys(value: unknown, keys: readonly string[], label: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw new FleetProtocolError('invalid-payload', label + ' must be an object')
  const expected = new Set(keys)
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) throw new FleetProtocolError('invalid-payload', label + ' contains unsupported field ' + JSON.stringify(key))
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) throw new FleetProtocolError('invalid-payload', label + ' is missing field ' + JSON.stringify(key))
  }
}

function assertNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0 || value !== value.trim()) {
    throw new FleetProtocolError('invalid-payload', field + ' must be a trimmed non-empty string')
  }
}

function assertDigest(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    throw new FleetProtocolError('invalid-digest', field + ' must be a lowercase SHA-256 digest')
  }
}

function parseCanonicalTime(value: unknown, field: string): number {
  if (typeof value !== 'string') throw new FleetProtocolError('invalid-time', field + ' must be an ISO timestamp')
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new FleetProtocolError('invalid-time', field + ' must be a canonical ISO timestamp')
  }
  return timestamp
}

function exactNpmVersion(value: string): boolean {
  return valid(value) === value
}

function exactGitHubRevision(value: string): boolean {
  return /^github:[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?#[0-9a-f]{40}$/.test(value)
}

export function isSafeNpmPackageName(value: string): boolean {
  if (value.length === 0 || value.length > 214 || value !== value.toLowerCase()) return false
  return /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/.test(value)
}

export function exactSourceKind(value: string): FleetPlanSourceKind | null {
  if (exactNpmVersion(value)) return 'npm'
  if (exactGitHubRevision(value)) return 'github'
  return null
}

export function isSupportedDshVersion(value: string): boolean {
  return valid(value) === value && satisfies(value, FLEET_AGENT_DSH_RANGE, { includePrerelease: true })
}

function validatePlanBody(value: FleetPlanBody): void {
  assertExactKeys(value, PLAN_BODY_KEYS, 'plan body')
  if (value.protocolVersion !== FLEET_AGENT_PROTOCOL_VERSION) {
    throw new FleetProtocolError('invalid-protocol', 'unsupported fleet agent protocol version')
  }
  assertNonEmpty(value.deviceId, 'deviceId')
  assertNonEmpty(value.profile, 'profile')
  assertDigest(value.manifestDigest, 'manifestDigest')
  assertDigest(value.profileHash, 'profileHash')
  assertNonEmpty(value.observedDshVersion, 'observedDshVersion')
  if (!isSupportedDshVersion(value.observedDshVersion)) {
    throw new FleetProtocolError('unsupported-dsh-version', 'DSH version is outside ' + FLEET_AGENT_DSH_RANGE)
  }
  assertNonEmpty(value.pluginId, 'pluginId')
  if (!isSafeNpmPackageName(value.pluginId)) {
    throw new FleetProtocolError('invalid-payload', 'pluginId must be one literal lowercase npm package name')
  }
  if (value.action !== 'install' && value.action !== 'update') {
    throw new FleetProtocolError('invalid-action', 'action must be install or update')
  }
  if (value.action === 'install' && value.fromSpec !== null) {
    throw new FleetProtocolError('invalid-action', 'install plans must bind fromSpec to null')
  }
  if (value.action === 'update') {
    assertNonEmpty(value.fromSpec, 'fromSpec')
    if (value.fromSpec === value.exactToSpec) {
      throw new FleetProtocolError('invalid-action', 'update plans must change the dependency spec')
    }
  }
  assertNonEmpty(value.exactToSpec, 'exactToSpec')
  if (exactSourceKind(value.exactToSpec) !== value.sourceKind) {
    throw new FleetProtocolError('unsupported-source', 'exactToSpec does not match sourceKind or is mutable')
  }
  if (value.restartRequired !== true) {
    throw new FleetProtocolError('invalid-payload', 'restartRequired must be true for this protocol slice')
  }
  const createdAt = parseCanonicalTime(value.createdAt, 'createdAt')
  const expiresAt = parseCanonicalTime(value.expiresAt, 'expiresAt')
  if (expiresAt <= createdAt) throw new FleetProtocolError('invalid-time', 'expiresAt must be after createdAt')
}

function canonicalize(value: unknown, seen: Set<object>): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new FleetProtocolError('invalid-payload', 'canonical JSON rejects non-finite numbers')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new FleetProtocolError('invalid-payload', 'canonical JSON rejects cycles')
    seen.add(value)
    const encoded = '[' + value.map(item => canonicalize(item, seen)).join(',') + ']'
    seen.delete(value)
    return encoded
  }
  if (isRecord(value)) {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new FleetProtocolError('invalid-payload', 'canonical JSON accepts only plain objects')
    }
    if (seen.has(value)) throw new FleetProtocolError('invalid-payload', 'canonical JSON rejects cycles')
    seen.add(value)
    const encoded = '{' + Object.keys(value).sort().map(key => {
      const item = value[key]
      if (item === undefined) throw new FleetProtocolError('invalid-payload', 'canonical JSON rejects undefined')
      return JSON.stringify(key) + ':' + canonicalize(item, seen)
    }).join(',') + '}'
    seen.delete(value)
    return encoded
  }
  throw new FleetProtocolError('invalid-payload', 'value is not representable as canonical JSON')
}

export function canonicalJson(value: unknown): string {
  return canonicalize(value, new Set<object>())
}

export function sha256Canonical(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')
}

export function createFleetPlan(body: FleetPlanBody): FleetPlan {
  validatePlanBody(body)
  const digest = sha256Canonical(body)
  return Object.freeze({ ...body, planId: 'plan:' + digest, digest })
}

export function validateFleetPlan(value: FleetPlan): void {
  assertExactKeys(value, PLAN_KEYS, 'plan')
  const body: FleetPlanBody = {
    protocolVersion: value.protocolVersion,
    deviceId: value.deviceId,
    profile: value.profile,
    manifestDigest: value.manifestDigest,
    profileHash: value.profileHash,
    observedDshVersion: value.observedDshVersion,
    pluginId: value.pluginId,
    action: value.action,
    fromSpec: value.fromSpec,
    exactToSpec: value.exactToSpec,
    sourceKind: value.sourceKind,
    restartRequired: value.restartRequired,
    createdAt: value.createdAt,
    expiresAt: value.expiresAt,
  }
  validatePlanBody(body)
  assertDigest(value.digest, 'digest')
  const digest = sha256Canonical(body)
  if (value.digest !== digest || value.planId !== 'plan:' + digest) {
    throw new FleetProtocolError('plan-integrity-failed', 'plan id or digest does not match its canonical body')
  }
}

function asTimestamp(value: Date | string, field: string): number {
  if (value instanceof Date) {
    const timestamp = value.getTime()
    if (!Number.isFinite(timestamp)) throw new FleetProtocolError('invalid-time', field + ' is invalid')
    return timestamp
  }
  return parseCanonicalTime(value, field)
}

export function validateFleetPlanApproval(
  plan: FleetPlan,
  approval: FleetPlanApproval,
  now: Date | string,
): ApprovalValidation {
  validateFleetPlan(plan)
  assertExactKeys(approval, APPROVAL_KEYS, 'approval')
  if (approval.protocolVersion !== FLEET_AGENT_PROTOCOL_VERSION) {
    throw new FleetProtocolError('invalid-protocol', 'unsupported approval protocol version')
  }
  assertNonEmpty(approval.approvalId, 'approvalId')
  assertNonEmpty(approval.principalId, 'approval.principalId')
  assertNonEmpty(approval.planId, 'approval.planId')
  assertDigest(approval.planDigest, 'approval.planDigest')
  assertNonEmpty(approval.deviceId, 'approval.deviceId')
  assertNonEmpty(approval.profile, 'approval.profile')
  const approvedAt = parseCanonicalTime(approval.approvedAt, 'approvedAt')
  const expiresAt = parseCanonicalTime(approval.expiresAt, 'approval.expiresAt')
  const nowAt = asTimestamp(now, 'now')
  const planCreatedAt = Date.parse(plan.createdAt)
  const planExpiresAt = Date.parse(plan.expiresAt)
  if (approval.planId !== plan.planId || approval.planDigest !== plan.digest ||
      approval.deviceId !== plan.deviceId || approval.profile !== plan.profile) {
    throw new FleetProtocolError('approval-mismatch', 'approval is not bound to this exact plan, device and profile')
  }
  if (approvedAt < planCreatedAt || expiresAt <= approvedAt || expiresAt > planExpiresAt) {
    throw new FleetProtocolError('approval-mismatch', 'approval lifetime is outside the plan lifetime')
  }
  if (nowAt < approvedAt) throw new FleetProtocolError('approval-mismatch', 'approval is not active yet')
  if (nowAt >= planExpiresAt) throw new FleetProtocolError('plan-expired', 'plan has expired')
  if (nowAt >= expiresAt) throw new FleetProtocolError('approval-expired', 'approval has expired')
  return Object.freeze({ idempotencyKey: 'approval:' + sha256Canonical(approval) })
}

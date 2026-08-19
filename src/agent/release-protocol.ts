import { valid } from 'semver'
import {
  FleetProtocolError,
  canonicalJson,
  isSafeNpmPackageName,
  isSupportedDshVersion,
  sha256Canonical,
} from './protocol.ts'

export const FLEET_RELEASE_PROTOCOL_VERSION = 1 as const

export type FleetReleaseSourceKind = 'npm' | 'github' | 'artifact'
export type FleetReleaseChangeAction = 'install' | 'update' | 'remove'

export interface FleetReleasePluginBinding {
  pluginId: string
  visibility: 'public' | 'private'
  sourceKind: FleetReleaseSourceKind
  exactSpec: string
  artifactDigest: string | null
  packageVersion: string | null
  integrity: string | null
  runtimeModules: string[]
}

export interface FleetReleaseChange {
  pluginId: string
  visibility: 'public' | 'private'
  sourceKind: FleetReleaseSourceKind
  action: FleetReleaseChangeAction
  fromSpecDigest: string | null
  exactToSpec: string | null
  artifactDigest: string | null
}

export interface FleetReleasePlanBody {
  protocolVersion: typeof FLEET_RELEASE_PROTOCOL_VERSION
  kind: 'profile-release'
  deviceId: string
  profile: string
  manifestDigest: string
  profileHash: string
  observedDshVersion: string
  releaseId: string
  releaseVersion: string
  releaseDigest: string
  plugins: FleetReleasePluginBinding[]
  changes: FleetReleaseChange[]
  restartRequired: boolean
  createdAt: string
  expiresAt: string
}

export interface FleetReleasePlan extends FleetReleasePlanBody {
  planId: string
  digest: string
}

export interface FleetReleaseApproval {
  protocolVersion: typeof FLEET_RELEASE_PROTOCOL_VERSION
  kind: 'profile-release'
  approvalId: string
  principalId: string
  planId: string
  planDigest: string
  deviceId: string
  profile: string
  approvedAt: string
  expiresAt: string
}

export interface FleetAppliedRelease {
  schemaVersion: 1
  deviceId: string
  profile: string
  releaseId: string
  releaseVersion: string
  releaseDigest: string
  plugins: FleetReleasePluginBinding[]
  appliedAt: string
}

const PLAN_BODY_KEYS = [
  'protocolVersion', 'kind', 'deviceId', 'profile', 'manifestDigest', 'profileHash', 'observedDshVersion',
  'releaseId', 'releaseVersion', 'releaseDigest', 'plugins', 'changes', 'restartRequired', 'createdAt', 'expiresAt',
] as const
const PLAN_KEYS = [...PLAN_BODY_KEYS, 'planId', 'digest'] as const
const PLUGIN_KEYS = [
  'pluginId', 'visibility', 'sourceKind', 'exactSpec', 'artifactDigest', 'packageVersion', 'integrity', 'runtimeModules',
] as const
const CHANGE_KEYS = ['pluginId', 'visibility', 'sourceKind', 'action', 'fromSpecDigest', 'exactToSpec', 'artifactDigest'] as const
const APPROVAL_KEYS = [
  'protocolVersion', 'kind', 'approvalId', 'principalId', 'planId', 'planDigest', 'deviceId', 'profile', 'approvedAt', 'expiresAt',
] as const
const APPLIED_KEYS = [
  'schemaVersion', 'deviceId', 'profile', 'releaseId', 'releaseVersion', 'releaseDigest', 'plugins', 'appliedAt',
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

function assertString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    throw new FleetProtocolError('invalid-payload', field + ' must be a trimmed non-empty string')
  }
}

function assertIdentifier(value: unknown, field: string): asserts value is string {
  assertString(value, field)
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)) {
    throw new FleetProtocolError('invalid-payload', field + ' contains unsupported characters')
  }
}

function assertDigest(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    throw new FleetProtocolError('invalid-digest', field + ' must be a lowercase SHA-256 digest')
  }
}

function parseTime(value: unknown, field: string): number {
  if (typeof value !== 'string') throw new FleetProtocolError('invalid-time', field + ' must be a canonical ISO timestamp')
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new FleetProtocolError('invalid-time', field + ' must be a canonical ISO timestamp')
  }
  return timestamp
}

function assertVisibility(value: unknown, field: string): asserts value is 'public' | 'private' {
  if (value !== 'public' && value !== 'private') throw new FleetProtocolError('invalid-payload', field + ' must be public or private')
}

function assertSourceKind(value: unknown, field: string): asserts value is FleetReleaseSourceKind {
  if (value !== 'npm' && value !== 'github' && value !== 'artifact') {
    throw new FleetProtocolError('unsupported-source', field + ' must be npm, github or artifact')
  }
}

function validateExactSource(sourceKind: FleetReleaseSourceKind, exactSpec: string, artifactDigest: string | null, visibility: 'public' | 'private'): void {
  if (sourceKind === 'npm') {
    if (visibility !== 'public' || valid(exactSpec) !== exactSpec || artifactDigest !== null) {
      throw new FleetProtocolError('unsupported-source', 'npm bindings require a public exact semantic version')
    }
    return
  }
  if (sourceKind === 'github') {
    if (visibility !== 'public' || !/^github:[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?#[0-9a-f]{40}$/.test(exactSpec) || artifactDigest !== null) {
      throw new FleetProtocolError('unsupported-source', 'GitHub bindings require a public repository and exact lowercase commit SHA')
    }
    return
  }
  if (visibility !== 'private' || artifactDigest === null) {
    throw new FleetProtocolError('unsupported-source', 'artifact bindings must be private and content addressed')
  }
  assertDigest(artifactDigest, 'artifactDigest')
  if (exactSpec !== 'artifact:sha256:' + artifactDigest) {
    throw new FleetProtocolError('unsupported-source', 'artifact exactSpec must bind its SHA-256 digest')
  }
}

function validatePlugin(value: FleetReleasePluginBinding, index: number): void {
  const field = `plugins[${index}]`
  assertExactKeys(value, PLUGIN_KEYS, field)
  assertString(value.pluginId, field + '.pluginId')
  if (!isSafeNpmPackageName(value.pluginId)) throw new FleetProtocolError('invalid-payload', field + '.pluginId is invalid')
  assertVisibility(value.visibility, field + '.visibility')
  assertSourceKind(value.sourceKind, field + '.sourceKind')
  assertString(value.exactSpec, field + '.exactSpec')
  if (value.artifactDigest !== null) assertDigest(value.artifactDigest, field + '.artifactDigest')
  if (value.packageVersion !== null && valid(value.packageVersion) !== value.packageVersion) {
    throw new FleetProtocolError('invalid-payload', field + '.packageVersion must be an exact semantic version or null')
  }
  if (value.integrity !== null && !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(value.integrity)) {
    throw new FleetProtocolError('invalid-payload', field + '.integrity must be one SHA-512 SRI value or null')
  }
  if (!Array.isArray(value.runtimeModules) || value.runtimeModules.length === 0 || value.runtimeModules.some(module => typeof module !== 'string' || module.length === 0 || module !== module.trim())) {
    throw new FleetProtocolError('invalid-payload', field + '.runtimeModules must contain trimmed non-empty strings')
  }
  validateExactSource(value.sourceKind, value.exactSpec, value.artifactDigest, value.visibility)
  if (value.sourceKind === 'npm' && (value.packageVersion !== value.exactSpec || value.integrity === null)) {
    throw new FleetProtocolError('unsupported-source', 'npm release bindings require version and integrity locks')
  }
  if (value.sourceKind === 'github' && (value.packageVersion !== null || value.integrity !== null)) {
    throw new FleetProtocolError('unsupported-source', 'GitHub release bindings do not accept packageVersion or integrity')
  }
  if (value.sourceKind === 'artifact' && (value.packageVersion === null || value.integrity !== null)) {
    throw new FleetProtocolError('unsupported-source', 'artifact release bindings require packageVersion and use digest instead of SRI')
  }
}

function validateChange(value: FleetReleaseChange, index: number): void {
  const field = `changes[${index}]`
  assertExactKeys(value, CHANGE_KEYS, field)
  assertString(value.pluginId, field + '.pluginId')
  if (!isSafeNpmPackageName(value.pluginId)) throw new FleetProtocolError('invalid-payload', field + '.pluginId is invalid')
  assertVisibility(value.visibility, field + '.visibility')
  assertSourceKind(value.sourceKind, field + '.sourceKind')
  if (value.action !== 'install' && value.action !== 'update' && value.action !== 'remove') {
    throw new FleetProtocolError('invalid-action', field + '.action must be install, update or remove')
  }
  if (value.action === 'install' ? value.fromSpecDigest !== null : value.fromSpecDigest === null) {
    throw new FleetProtocolError('invalid-action', field + '.fromSpecDigest does not match its action')
  }
  if (value.fromSpecDigest !== null) assertDigest(value.fromSpecDigest, field + '.fromSpecDigest')
  if (value.action === 'remove') {
    if (value.exactToSpec !== null || value.artifactDigest !== null) {
      throw new FleetProtocolError('invalid-action', 'remove changes must not contain a target spec or artifact digest')
    }
  } else {
    assertString(value.exactToSpec, field + '.exactToSpec')
    if (value.artifactDigest !== null) assertDigest(value.artifactDigest, field + '.artifactDigest')
    validateExactSource(value.sourceKind, value.exactToSpec, value.artifactDigest, value.visibility)
  }
}

function validatePlanBody(value: FleetReleasePlanBody): void {
  assertExactKeys(value, PLAN_BODY_KEYS, 'release plan body')
  if (value.protocolVersion !== FLEET_RELEASE_PROTOCOL_VERSION || value.kind !== 'profile-release') {
    throw new FleetProtocolError('invalid-protocol', 'unsupported release protocol')
  }
  assertIdentifier(value.deviceId, 'deviceId')
  assertIdentifier(value.profile, 'profile')
  assertDigest(value.manifestDigest, 'manifestDigest')
  assertDigest(value.profileHash, 'profileHash')
  assertString(value.observedDshVersion, 'observedDshVersion')
  if (!isSupportedDshVersion(value.observedDshVersion)) {
    throw new FleetProtocolError('unsupported-dsh-version', 'DSH version is outside the supported Agent range')
  }
  assertIdentifier(value.releaseId, 'releaseId')
  assertString(value.releaseVersion, 'releaseVersion')
  if (valid(value.releaseVersion) !== value.releaseVersion) {
    throw new FleetProtocolError('invalid-payload', 'releaseVersion must be an exact semantic version')
  }
  assertDigest(value.releaseDigest, 'releaseDigest')
  if (!Array.isArray(value.plugins) || value.plugins.length === 0) throw new FleetProtocolError('invalid-payload', 'plugins must not be empty')
  value.plugins.forEach(validatePlugin)
  if (!Array.isArray(value.changes)) throw new FleetProtocolError('invalid-payload', 'changes must be an array')
  value.changes.forEach(validateChange)
  const pluginIds = value.plugins.map(plugin => plugin.pluginId)
  const changeIds = value.changes.map(change => change.pluginId)
  if (new Set(pluginIds).size !== pluginIds.length || new Set(changeIds).size !== changeIds.length) {
    throw new FleetProtocolError('invalid-payload', 'plugin and change ids must be unique')
  }
  if (pluginIds.some((id, index) => index > 0 && id <= (pluginIds[index - 1] as string)) ||
      changeIds.some((id, index) => index > 0 && id <= (changeIds[index - 1] as string))) {
    throw new FleetProtocolError('invalid-payload', 'plugins and changes must be sorted by pluginId')
  }
  const finalIds = new Set(pluginIds)
  for (const change of value.changes) {
    if (change.action === 'remove' ? finalIds.has(change.pluginId) : !finalIds.has(change.pluginId)) {
      throw new FleetProtocolError('invalid-action', 'change set does not match the final plugin set')
    }
  }
  if (value.restartRequired !== (value.changes.length > 0)) {
    throw new FleetProtocolError('invalid-payload', 'restartRequired must reflect whether the release changes the profile')
  }
  const expectedReleaseDigest = sha256Canonical({
    releaseId: value.releaseId,
    releaseVersion: value.releaseVersion,
    profile: value.profile,
    plugins: value.plugins,
  })
  if (value.releaseDigest !== expectedReleaseDigest) {
    throw new FleetProtocolError('plan-integrity-failed', 'releaseDigest does not match the final release')
  }
  const createdAt = parseTime(value.createdAt, 'createdAt')
  const expiresAt = parseTime(value.expiresAt, 'expiresAt')
  if (expiresAt <= createdAt) throw new FleetProtocolError('invalid-time', 'expiresAt must be after createdAt')
}

export function createFleetReleasePlan(body: FleetReleasePlanBody): FleetReleasePlan {
  validatePlanBody(body)
  const digest = sha256Canonical(body)
  return Object.freeze({ ...body, planId: 'release-plan:' + digest, digest })
}

export function validateFleetReleasePlan(value: FleetReleasePlan): void {
  assertExactKeys(value, PLAN_KEYS, 'release plan')
  const body = Object.fromEntries(PLAN_BODY_KEYS.map(key => [key, value[key]])) as unknown as FleetReleasePlanBody
  validatePlanBody(body)
  assertDigest(value.digest, 'digest')
  const digest = sha256Canonical(body)
  if (value.digest !== digest || value.planId !== 'release-plan:' + digest) {
    throw new FleetProtocolError('plan-integrity-failed', 'release plan id or digest does not match its canonical body')
  }
}

export function validateFleetReleaseApproval(plan: FleetReleasePlan, approval: FleetReleaseApproval, now: Date | string): { idempotencyKey: string } {
  validateFleetReleasePlan(plan)
  assertExactKeys(approval, APPROVAL_KEYS, 'release approval')
  if (approval.protocolVersion !== FLEET_RELEASE_PROTOCOL_VERSION || approval.kind !== 'profile-release') {
    throw new FleetProtocolError('invalid-protocol', 'unsupported release approval protocol')
  }
  for (const [field, value] of Object.entries({
    approvalId: approval.approvalId,
    principalId: approval.principalId,
    planId: approval.planId,
    deviceId: approval.deviceId,
    profile: approval.profile,
  })) assertString(value, field)
  assertDigest(approval.planDigest, 'planDigest')
  const approvedAt = parseTime(approval.approvedAt, 'approvedAt')
  const expiresAt = parseTime(approval.expiresAt, 'approval.expiresAt')
  const nowAt = now instanceof Date ? now.getTime() : parseTime(now, 'now')
  if (!Number.isFinite(nowAt)) throw new FleetProtocolError('invalid-time', 'now is invalid')
  if (expiresAt <= approvedAt || approvedAt < Date.parse(plan.createdAt) || approvedAt >= Date.parse(plan.expiresAt)) {
    throw new FleetProtocolError('approval-mismatch', 'approval time is outside the release plan validity window')
  }
  if (nowAt >= Date.parse(plan.expiresAt)) throw new FleetProtocolError('plan-expired', 'release plan has expired')
  if (nowAt >= expiresAt) throw new FleetProtocolError('approval-expired', 'release approval has expired')
  if (approval.planId !== plan.planId || approval.planDigest !== plan.digest || approval.deviceId !== plan.deviceId || approval.profile !== plan.profile) {
    throw new FleetProtocolError('approval-mismatch', 'release approval does not match its plan')
  }
  return { idempotencyKey: sha256Canonical({ planDigest: plan.digest, approval: JSON.parse(canonicalJson(approval)) as unknown }) }
}

export function validateFleetAppliedRelease(value: FleetAppliedRelease): void {
  assertExactKeys(value, APPLIED_KEYS, 'applied release')
  if (value.schemaVersion !== 1) throw new FleetProtocolError('invalid-protocol', 'unsupported applied release schema')
  assertIdentifier(value.deviceId, 'deviceId')
  assertIdentifier(value.profile, 'profile')
  assertIdentifier(value.releaseId, 'releaseId')
  assertString(value.releaseVersion, 'releaseVersion')
  if (valid(value.releaseVersion) !== value.releaseVersion) throw new FleetProtocolError('invalid-payload', 'releaseVersion must be exact')
  assertDigest(value.releaseDigest, 'releaseDigest')
  if (!Array.isArray(value.plugins) || value.plugins.length === 0) throw new FleetProtocolError('invalid-payload', 'plugins must not be empty')
  value.plugins.forEach(validatePlugin)
  const ids = value.plugins.map(plugin => plugin.pluginId)
  if (new Set(ids).size !== ids.length || ids.some((id, index) => index > 0 && id <= (ids[index - 1] as string))) {
    throw new FleetProtocolError('invalid-payload', 'applied release plugins must be unique and sorted')
  }
  parseTime(value.appliedAt, 'appliedAt')
  const digest = sha256Canonical({
    releaseId: value.releaseId,
    releaseVersion: value.releaseVersion,
    profile: value.profile,
    plugins: value.plugins,
  })
  if (digest !== value.releaseDigest) throw new FleetProtocolError('plan-integrity-failed', 'applied release digest is invalid')
}

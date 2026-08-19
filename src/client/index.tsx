import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import type { RpcResult } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { FleetPlan } from '../agent/protocol.ts'
import type { FleetReleasePlan, FleetReleaseRollbackPlan } from '../agent/release-protocol.ts'
import type {
  AgentActionRecord,
  AgentActionState,
  AgentInspection,
  ReleaseActionRecord,
  ReleaseAgentInspection,
  ReleaseRollbackActionRecord,
  ReleaseRetentionActionRecord,
} from '../agent/runtime.ts'
import type { FleetReleaseRetentionPlan } from '../agent/release-retention.ts'
import type { FleetAgentDoctorReport } from '../agent/doctor.ts'
import type { FleetTaskCatalog, FleetTaskCatalogItem, FleetTaskState } from '../a2a/runtime.ts'
import type { FleetA2AEnvelope, FleetFederationAdvisoryKind, FleetTaskApprovalRequestPayload } from '../a2a/protocol.ts'
import type {
  AcknowledgeFederationMessageResult,
  FleetFederationInboxItem,
  FleetFederationPruneCandidate,
} from '../federation/inbox.ts'
import type {
  FleetStatus,
  FleetUpdateItem,
  FleetUpdates,
  PluginDriftState,
} from '../shared.ts'

export const inject = ['slots', 'connection']
const CHANNEL = '/dsh-fleet'
const AGENT_CHANNEL = '/dsh-fleet-agent'

const SM = {
  bg: '#eef0f2',
  bg2: '#e6e9ed',
  panel: '#ffffff',
  panelSoft: '#fafbfc',
  fg: '#181a1c',
  fg2: '#5f6670',
  fg3: '#9aa3ad',
  fg4: '#c2cad3',
  good: '#0e8a4f',
  goodSoft: '#e1f3ea',
  bad: '#e0411b',
  badSoft: '#fdecdf',
  warn: '#c98a14',
  warnSoft: '#fbf2dd',
  info: '#0f5f6e',
  infoSoft: '#e0eef0',
  border: 'rgba(20,30,50,0.08)',
  borderStrong: 'rgba(20,30,50,0.13)',
  shadowCard: '0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(20,30,50,0.10)',
  fontSans: '"Noto Sans SC","PingFang SC","Source Han Sans SC",-apple-system,sans-serif',
  fontMono: '"JetBrains Mono","SF Mono","Cascadia Code",Menlo,monospace',
} as const

interface ClientContextLike {
  connection: { rpc: ClientConnectionRpc }
  slots: {
    inject(name: string, setup: () => unknown): unknown
    register(descriptor: Record<string, unknown>, component: React.ComponentType): unknown
  }
}

interface AgentTargetView {
  deviceId: string
  transport: 'local' | 'ssh'
  online: boolean
  mode?: 'single-plugin' | 'profile-release'
  errorCode?: string
  inspection?: AgentInspection | ReleaseAgentInspection
  readiness?: FleetAgentDoctorReport
  readinessErrorCode?: string
}

interface AgentTargetsView {
  enabled: boolean
  signer?: { configured: boolean; deviceId?: string; ready: boolean; errorCode?: string }
  targets: AgentTargetView[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function rpcValue<T>(result: RpcResult<unknown>, guard: (value: unknown) => value is T, fallback: string): T {
  if (!result.ok) throw new Error(result.error.message)
  if (!guard(result.value)) throw new Error(fallback)
  return result.value
}

function isFleetStatus(value: unknown): value is FleetStatus {
  return isRecord(value) && isRecord(value.device) && isRecord(value.runtime) &&
    Array.isArray(value.runtime.failedModules) && value.runtime.failedModules.every(item => typeof item === 'string') &&
    isRecord(value.summary) && Array.isArray(value.plugins)
}

function isFleetUpdates(value: unknown): value is FleetUpdates {
  return isRecord(value) && typeof value.enabled === 'boolean' && typeof value.cached === 'boolean' && typeof value.stale === 'boolean'
}

function isReleaseRetentionInspection(value: unknown): boolean {
  if (!isRecord(value) || !hasExactKeys(value, [
    'eligibleCount', 'invalidTransitionCount', 'orphanBackupCount', 'orphanCount', 'orphanFailedCount',
    'orphanStageCount', 'retainedCount',
  ])) return false
  const fields = [
    'eligibleCount', 'invalidTransitionCount', 'orphanBackupCount', 'orphanCount', 'orphanFailedCount',
    'orphanStageCount', 'retainedCount',
  ] as const
  if (fields.some(field => typeof value[field] !== 'number' || !Number.isSafeInteger(value[field]) || value[field] < 0)) return false
  const counts = value as Record<(typeof fields)[number], number>
  return counts.orphanCount === counts.orphanBackupCount + counts.orphanStageCount + counts.orphanFailedCount
}

function isAgentTargets(value: unknown): value is AgentTargetsView {
  if (!isRecord(value) || typeof value.enabled !== 'boolean' || !Array.isArray(value.targets)) return false
  return value.targets.every(target => {
    if (!isRecord(target) || typeof target.deviceId !== 'string' ||
        (target.transport !== 'local' && target.transport !== 'ssh') || typeof target.online !== 'boolean') return false
    if (target.mode !== undefined && target.mode !== 'single-plugin' && target.mode !== 'profile-release') return false
    if (target.errorCode !== undefined && typeof target.errorCode !== 'string') return false
    if (target.readinessErrorCode !== undefined && typeof target.readinessErrorCode !== 'string') return false
    if (target.readiness !== undefined && (!isRecord(target.readiness) || target.readiness.protocolVersion !== 1 ||
        target.readiness.ready !== true || target.readiness.deviceId !== target.deviceId ||
        typeof target.readiness.teamId !== 'string' ||
        typeof target.readiness.principalId !== 'string' || typeof target.readiness.identityKeyId !== 'string' ||
        typeof target.readiness.observedRuntimeDigest !== 'string' || !/^[0-9a-f]{64}$/.test(target.readiness.observedRuntimeDigest) ||
        (target.readiness.observedServiceDefinitionDigest !== null &&
          (typeof target.readiness.observedServiceDefinitionDigest !== 'string' ||
            !/^[0-9a-f]{64}$/.test(target.readiness.observedServiceDefinitionDigest))) ||
        typeof target.readiness.trustedPeerCount !== 'number' || !Number.isSafeInteger(target.readiness.trustedPeerCount) ||
        target.readiness.trustedPeerCount < 0 || typeof target.readiness.tasksEnabled !== 'boolean' ||
        !Array.isArray(target.readiness.workspaceIds) || target.readiness.workspaceIds.some(id => typeof id !== 'string') ||
        !Array.isArray(target.readiness.taskProfiles) || target.readiness.taskProfiles.some(profile => typeof profile !== 'string') ||
        !Array.isArray(target.readiness.trustedPeers) || target.readiness.trustedPeers.some(peer => !isRecord(peer) ||
          typeof peer.keyId !== 'string' || typeof peer.principalId !== 'string' || typeof peer.deviceId !== 'string' ||
          !Array.isArray(peer.allowedKinds) || peer.allowedKinds.some(kind => typeof kind !== 'string')))) return false
    if (target.inspection === undefined) return target.online === false
    const inspection = target.inspection
    if (!isRecord(inspection) || inspection.protocolVersion !== 1 || typeof inspection.deviceId !== 'string' ||
      typeof inspection.profile !== 'string' || typeof inspection.dshVersion !== 'string' ||
      typeof inspection.manifestDigest !== 'string' || typeof inspection.profileHash !== 'string') return false
    if (inspection.kind === 'profile-release') {
      if (!isRecord(inspection.tasks) || !Array.isArray(inspection.tasks.profiles) ||
          !inspection.tasks.profiles.every(profile => typeof profile === 'string')) return false
      const tasks = inspection.tasks
      const profiles = tasks.profiles as string[]
      return typeof inspection.liveManifestDigest === 'string' && typeof inspection.desiredManifestDigest === 'string' &&
        typeof inspection.observedRuntimeDigest === 'string' && /^[0-9a-f]{64}$/.test(inspection.observedRuntimeDigest) &&
        (inspection.observedServiceDefinitionDigest === null || typeof inspection.observedServiceDefinitionDigest === 'string' &&
          /^[0-9a-f]{64}$/.test(inspection.observedServiceDefinitionDigest)) &&
        isRecord(inspection.assignedRelease) && typeof inspection.assignedRelease.releaseId === 'string' &&
        typeof inspection.assignedRelease.releaseVersion === 'string' && typeof inspection.assignedRelease.releaseDigest === 'string' &&
        (inspection.currentRelease === null || isRecord(inspection.currentRelease) && typeof inspection.currentRelease.releaseId === 'string' &&
          typeof inspection.currentRelease.releaseVersion === 'string' && typeof inspection.currentRelease.releaseDigest === 'string') &&
        Array.isArray(inspection.changes) &&
        inspection.changes.every(change => isRecord(change) && typeof change.pluginId === 'string' &&
          (change.action === 'install' || change.action === 'update' || change.action === 'remove')) &&
        typeof tasks.enabled === 'boolean' &&
        Array.isArray(tasks.workspaceIds) && tasks.workspaceIds.every(id => typeof id === 'string') &&
        Array.isArray(tasks.executionProfiles) && tasks.executionProfiles.every(binding => isRecord(binding) &&
          typeof binding.profile === 'string' && profiles.includes(binding.profile) &&
          typeof binding.profileHash === 'string' && /^[0-9a-f]{64}$/.test(binding.profileHash)) &&
        tasks.executionProfiles.length === profiles.length &&
        new Set(tasks.executionProfiles.map(binding => (binding as { profile: string }).profile)).size === tasks.executionProfiles.length &&
        (tasks.timeoutMs === null || typeof tasks.timeoutMs === 'number' && Number.isSafeInteger(tasks.timeoutMs)) &&
        Array.isArray(tasks.policies) && tasks.policies.every(policy => isRecord(policy) &&
          typeof policy.policyId === 'string' && typeof policy.policyDigest === 'string' &&
          (policy.permissionMode === 'read-only' || policy.permissionMode === 'workspace-write')) &&
        isReleaseRetentionInspection(inspection.retention)
    }
    return Array.isArray(inspection.candidates) && inspection.candidates.every(candidate =>
        isRecord(candidate) && typeof candidate.pluginId === 'string' &&
        (candidate.action === 'install' || candidate.action === 'update') &&
        (candidate.fromSpec === null || typeof candidate.fromSpec === 'string') &&
        typeof candidate.exactToSpec === 'string' &&
        (candidate.sourceKind === 'npm' || candidate.sourceKind === 'github'))
  }) && (value.signer === undefined || (isRecord(value.signer) && typeof value.signer.configured === 'boolean' &&
    typeof value.signer.ready === 'boolean' && (value.signer.deviceId === undefined || typeof value.signer.deviceId === 'string') &&
    (value.signer.errorCode === undefined || typeof value.signer.errorCode === 'string')))
}

function isFleetPlan(value: unknown): value is FleetPlan {
  return isRecord(value) && typeof value.planId === 'string' && typeof value.digest === 'string' &&
    typeof value.deviceId === 'string' && typeof value.profile === 'string' && typeof value.pluginId === 'string' &&
    (value.action === 'install' || value.action === 'update') && typeof value.exactToSpec === 'string' &&
    typeof value.expiresAt === 'string'
}

function isFleetReleasePlan(value: unknown): value is FleetReleasePlan {
  return isRecord(value) && value.kind === 'profile-release' && typeof value.planId === 'string' &&
    typeof value.digest === 'string' && typeof value.deviceId === 'string' && typeof value.profile === 'string' &&
    typeof value.fromManifestDigest === 'string' && typeof value.toManifestDigest === 'string' &&
    (value.fromReleaseDigest === null || typeof value.fromReleaseDigest === 'string') &&
    typeof value.toReleaseDigest === 'string' &&
    typeof value.observedRuntimeDigest === 'string' && /^[0-9a-f]{64}$/.test(value.observedRuntimeDigest) &&
    (value.observedServiceDefinitionDigest === null || typeof value.observedServiceDefinitionDigest === 'string' && /^[0-9a-f]{64}$/.test(value.observedServiceDefinitionDigest)) &&
    typeof value.releaseId === 'string' && typeof value.releaseVersion === 'string' &&
    Array.isArray(value.plugins) && Array.isArray(value.changes) && typeof value.expiresAt === 'string'
}

function isFleetReleaseRollbackPlan(value: unknown): value is FleetReleaseRollbackPlan {
  return isRecord(value) && value.protocolVersion === 2 && value.kind === 'profile-release-rollback' &&
    typeof value.planId === 'string' && /^release-rollback-plan:[0-9a-f]{64}$/.test(value.planId) &&
    typeof value.digest === 'string' && /^[0-9a-f]{64}$/.test(value.digest) && value.planId === 'release-rollback-plan:' + value.digest &&
    typeof value.transitionPlanId === 'string' && /^release-plan:[0-9a-f]{64}$/.test(value.transitionPlanId) &&
    typeof value.transitionPlanDigest === 'string' && value.transitionPlanId === 'release-plan:' + value.transitionPlanDigest &&
    typeof value.deviceId === 'string' && typeof value.profile === 'string' &&
    typeof value.fromManifestDigest === 'string' && /^[0-9a-f]{64}$/.test(value.fromManifestDigest) &&
    typeof value.toManifestDigest === 'string' && /^[0-9a-f]{64}$/.test(value.toManifestDigest) &&
    typeof value.fromReleaseDigest === 'string' && /^[0-9a-f]{64}$/.test(value.fromReleaseDigest) &&
    (value.toReleaseDigest === null || typeof value.toReleaseDigest === 'string' && /^[0-9a-f]{64}$/.test(value.toReleaseDigest)) &&
    typeof value.fromProfileHash === 'string' && /^[0-9a-f]{64}$/.test(value.fromProfileHash) &&
    typeof value.toProfileHash === 'string' && /^[0-9a-f]{64}$/.test(value.toProfileHash) &&
    typeof value.observedDshVersion === 'string' &&
    typeof value.observedRuntimeDigest === 'string' && /^[0-9a-f]{64}$/.test(value.observedRuntimeDigest) &&
    (value.observedServiceDefinitionDigest === null || typeof value.observedServiceDefinitionDigest === 'string' && /^[0-9a-f]{64}$/.test(value.observedServiceDefinitionDigest)) &&
    isCanonicalTimestamp(value.createdAt) && isCanonicalTimestamp(value.expiresAt) &&
    Date.parse(value.expiresAt) > Date.parse(value.createdAt)
}

const RELEASE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const RELEASE_TRANSITION_ID_PATTERN = /^release-plan:[0-9a-f]{64}$/
const RELEASE_RETENTION_PLAN_ID_PATTERN = /^release-retention-plan:[0-9a-f]{64}$/
const RELEASE_BACKUP_PROFILE_PATTERN = /^fleet-backup-[0-9a-f]{24}$/
const RELEASE_STAGE_PROFILE_PATTERN = /^fleet-stage-[0-9a-f]{24}$/
const RELEASE_FAILED_PROFILE_PATTERN = /^fleet-failed-[0-9a-f]{24}$/

function isSortedUniqueMatching(value: unknown, pattern: RegExp): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string' && pattern.test(item)) &&
    value.every((item, index) => index === 0 || item > value[index - 1]!)
}

function isFleetReleaseRetentionPlan(value: unknown): value is FleetReleaseRetentionPlan {
  if (!isRecord(value) || !hasExactKeys(value, [
    'createdAt', 'currentTransitionPlanId', 'deviceId', 'digest', 'entries', 'expiresAt', 'kind',
    'orphanBackupProfiles', 'orphanFailedProfiles', 'orphanStageProfiles', 'planId', 'profile',
    'protocolVersion', 'retainedTransitionPlanIds',
  ]) || value.protocolVersion !== 1 || value.kind !== 'profile-release-retention' ||
      typeof value.deviceId !== 'string' || !RELEASE_IDENTIFIER_PATTERN.test(value.deviceId) ||
      typeof value.profile !== 'string' || !RELEASE_IDENTIFIER_PATTERN.test(value.profile) ||
      typeof value.digest !== 'string' || !/^[0-9a-f]{64}$/.test(value.digest) ||
      typeof value.planId !== 'string' || !RELEASE_RETENTION_PLAN_ID_PATTERN.test(value.planId) ||
      value.planId !== 'release-retention-plan:' + value.digest ||
      !isCanonicalTimestamp(value.createdAt) || !isCanonicalTimestamp(value.expiresAt) ||
      Date.parse(value.expiresAt) <= Date.parse(value.createdAt) ||
      Date.parse(value.expiresAt) - Date.parse(value.createdAt) > 60 * 60 * 1000 ||
      !isSortedUniqueMatching(value.retainedTransitionPlanIds, RELEASE_TRANSITION_ID_PATTERN) ||
      value.retainedTransitionPlanIds.length > 2 ||
      !isSortedUniqueMatching(value.orphanBackupProfiles, RELEASE_BACKUP_PROFILE_PATTERN) ||
      !isSortedUniqueMatching(value.orphanStageProfiles, RELEASE_STAGE_PROFILE_PATTERN) ||
      !isSortedUniqueMatching(value.orphanFailedProfiles, RELEASE_FAILED_PROFILE_PATTERN) ||
      !Array.isArray(value.entries)) return false
  const retainedTransitionPlanIds = value.retainedTransitionPlanIds as string[]
  const currentTransitionPlanId = value.currentTransitionPlanId
  if (currentTransitionPlanId !== null &&
      (typeof currentTransitionPlanId !== 'string' || !RELEASE_TRANSITION_ID_PATTERN.test(currentTransitionPlanId))) return false
  if (currentTransitionPlanId === null
    ? retainedTransitionPlanIds.length !== 0 || value.entries.length !== 0
    : !retainedTransitionPlanIds.includes(currentTransitionPlanId)) return false
  const entryIds: string[] = []
  for (const entry of value.entries) {
    if (!isRecord(entry) || !hasExactKeys(entry, [
      'backupManifestDigest', 'backupProfile', 'backupProfileHash', 'descriptorDigest', 'reason', 'transitionPlanId',
    ]) || typeof entry.transitionPlanId !== 'string' || !RELEASE_TRANSITION_ID_PATTERN.test(entry.transitionPlanId) ||
        typeof entry.descriptorDigest !== 'string' || !/^[0-9a-f]{64}$/.test(entry.descriptorDigest) ||
        entry.reason !== 'superseded') return false
    if (entry.backupProfile === null) {
      if (entry.backupManifestDigest !== null || entry.backupProfileHash !== null) return false
    } else if (typeof entry.backupProfile !== 'string' || !RELEASE_BACKUP_PROFILE_PATTERN.test(entry.backupProfile) ||
        typeof entry.backupManifestDigest !== 'string' || !/^[0-9a-f]{64}$/.test(entry.backupManifestDigest) ||
        typeof entry.backupProfileHash !== 'string' || !/^[0-9a-f]{64}$/.test(entry.backupProfileHash)) return false
    entryIds.push(entry.transitionPlanId)
  }
  return entryIds.every((id, index) => (index === 0 || id > entryIds[index - 1]!) &&
    !retainedTransitionPlanIds.includes(id))
}

function isAgentAction(value: unknown): value is AgentActionRecord | ReleaseActionRecord {
  const states = new Set([
    'approved', 'staging', 'staged', 'applying', 'restarting', 'verifying', 'succeeded',
    'rollback', 'rollback-restarting', 'rollback-verifying', 'rolled-back', 'manual-intervention',
  ])
  return isRecord(value) && typeof value.planId === 'string' && typeof value.state === 'string' && states.has(value.state) &&
    (typeof value.pluginId === 'string' || typeof value.releaseId === 'string') && typeof value.updatedAt === 'string'
}

function isReleaseRollbackAction(value: unknown): value is ReleaseRollbackActionRecord {
  const states = new Set([
    'approved', 'staging', 'staged', 'applying', 'restarting', 'verifying', 'succeeded',
    'rollback', 'rollback-restarting', 'rollback-verifying', 'rolled-back', 'manual-intervention',
  ])
  return isRecord(value) && typeof value.planId === 'string' && /^release-rollback-plan:[0-9a-f]{64}$/.test(value.planId) &&
    typeof value.planDigest === 'string' && value.planId === 'release-rollback-plan:' + value.planDigest &&
    typeof value.transitionPlanId === 'string' && typeof value.deviceId === 'string' && typeof value.profile === 'string' &&
    typeof value.fromManifestDigest === 'string' && typeof value.toManifestDigest === 'string' &&
    typeof value.fromReleaseDigest === 'string' && (value.toReleaseDigest === null || typeof value.toReleaseDigest === 'string') &&
    typeof value.state === 'string' && states.has(value.state) && isCanonicalTimestamp(value.updatedAt) &&
    (value.result === undefined || value.result === 'success' || value.result === 'manual-intervention') &&
    (value.errorCode === undefined || typeof value.errorCode === 'string')
}

function isReleaseRetentionAction(value: unknown): value is ReleaseRetentionActionRecord {
  if (!isRecord(value) || !hasExactKeys(value, [
    'activeBackupQuarantinePrepared', 'activeBackupRemoved', 'activeTransitionPlanId', 'approvalId',
    'currentTransitionPlanId', 'deviceId', 'idempotencyKey', 'planDigest', 'planId', 'principalId',
    'profile', 'removedTransitionPlanIds', 'result', 'state', 'updatedAt',
  ]) || typeof value.planId !== 'string' || !RELEASE_RETENTION_PLAN_ID_PATTERN.test(value.planId) ||
      typeof value.planDigest !== 'string' || !/^[0-9a-f]{64}$/.test(value.planDigest) ||
      value.planId !== 'release-retention-plan:' + value.planDigest ||
      typeof value.approvalId !== 'string' || !RELEASE_IDENTIFIER_PATTERN.test(value.approvalId) ||
      typeof value.principalId !== 'string' || !RELEASE_IDENTIFIER_PATTERN.test(value.principalId) ||
      typeof value.idempotencyKey !== 'string' || !/^[0-9a-f]{64}$/.test(value.idempotencyKey) ||
      typeof value.deviceId !== 'string' || !RELEASE_IDENTIFIER_PATTERN.test(value.deviceId) ||
      typeof value.profile !== 'string' || !RELEASE_IDENTIFIER_PATTERN.test(value.profile) ||
      (value.currentTransitionPlanId !== null &&
        (typeof value.currentTransitionPlanId !== 'string' || !RELEASE_TRANSITION_ID_PATTERN.test(value.currentTransitionPlanId))) ||
      (value.activeTransitionPlanId !== null &&
        (typeof value.activeTransitionPlanId !== 'string' || !RELEASE_TRANSITION_ID_PATTERN.test(value.activeTransitionPlanId))) ||
      typeof value.activeBackupQuarantinePrepared !== 'boolean' || typeof value.activeBackupRemoved !== 'boolean' ||
      !isSortedUniqueMatching(value.removedTransitionPlanIds, RELEASE_TRANSITION_ID_PATTERN) ||
      !isCanonicalTimestamp(value.updatedAt) ||
      (value.state !== 'approved' && value.state !== 'applying' && value.state !== 'succeeded') ||
      (value.state === 'succeeded' ? value.result !== 'success' : value.result !== null)) return false
  if (value.currentTransitionPlanId !== null && value.removedTransitionPlanIds.includes(value.currentTransitionPlanId) ||
      value.activeTransitionPlanId !== null && value.removedTransitionPlanIds.includes(value.activeTransitionPlanId)) return false
  return value.activeTransitionPlanId !== null ||
    value.activeBackupQuarantinePrepared === false && value.activeBackupRemoved === false
}

interface FleetTaskReply {
  taskId: string
  response: FleetA2AEnvelope
}

function isFleetTaskReply(value: unknown): value is FleetTaskReply {
  if (!isRecord(value) || typeof value.taskId !== 'string' || !isTaskId(value.taskId) || !isRecord(value.response) ||
      !isRecord(value.response.payload)) return false
  const payload = value.response.payload
  if (payload.taskId !== value.taskId) return false
  if (value.response.kind === 'task.progress' || value.response.kind === 'task.result') {
    return typeof payload.state === 'string' && TASK_STATES.has(payload.state as FleetTaskState) &&
      isCanonicalTimestamp(payload.updatedAt) &&
      (payload.result === undefined || payload.result === null || typeof payload.result === 'string') &&
      (payload.truncated === undefined || typeof payload.truncated === 'boolean') &&
      (payload.errorCode === undefined || payload.errorCode === null || typeof payload.errorCode === 'string')
  }
  if (value.response.kind !== 'task.approval.request' || value.response.schemaVersion !== 2 ||
      typeof value.response.teamId !== 'string' || typeof value.response.messageId !== 'string' ||
      typeof value.response.payloadDigest !== 'string' || typeof value.response.signature !== 'string' ||
      !isRecord(value.response.sender) || !isRecord(value.response.recipient)) return false
  return typeof payload.approvalId === 'string' && typeof payload.taskBindingDigest === 'string' &&
    typeof payload.toolCallId === 'string' && typeof payload.toolName === 'string' && isRecord(payload.arguments) &&
    typeof payload.argumentsDigest === 'string' &&
    (payload.capability === 'workspace-mutation' || payload.capability === 'command-execution' || payload.capability === 'network-access') &&
    typeof payload.summary === 'string' && isCanonicalTimestamp(payload.expiresAt)
}

interface FleetTaskApprovalDecisionReply {
  taskId: string
  response: { kind: 'receipt'; payload: { requestMessageId: string; status: 'accepted' } }
}

function isApprovalDecisionReply(value: unknown): value is FleetTaskApprovalDecisionReply {
  return isRecord(value) && typeof value.taskId === 'string' && isTaskId(value.taskId) && isRecord(value.response) &&
    value.response.kind === 'receipt' && isRecord(value.response.payload) &&
    typeof value.response.payload.requestMessageId === 'string' && value.response.payload.status === 'accepted'
}

const TASK_REFERENCE_STORAGE_KEY = 'dsh-fleet.task-reference.v1'
const TASK_ID_PATTERN = /^task:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

interface StoredTaskReference {
  targetDeviceId: string
  taskId: string
}

function isTaskId(value: string): boolean {
  return TASK_ID_PATTERN.test(value)
}

const TASK_STATES = new Set<FleetTaskState>(['accepted', 'running', 'cancel-requested', 'succeeded', 'failed', 'cancelled'])

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const time = Date.parse(value)
  return Number.isFinite(time) && new Date(time).toISOString() === value
}

const FEDERATION_MESSAGE_ID_PATTERN = /^msg:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const FEDERATION_NAMED_ID_PATTERN = /^(?:approval|handoff):[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const FEDERATION_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

function isFederationPayload(kind: FleetFederationAdvisoryKind, value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false
  if (kind === 'handoff') {
    return hasExactKeys(value, ['artifactRefs', 'handoffId', 'summary', 'taskId']) &&
      typeof value.handoffId === 'string' && FEDERATION_NAMED_ID_PATTERN.test(value.handoffId) && value.handoffId.startsWith('handoff:') &&
      (value.taskId === null || typeof value.taskId === 'string' && isTaskId(value.taskId)) &&
      typeof value.summary === 'string' && value.summary.trim().length > 0 && value.summary.length <= 8192 && !value.summary.includes('\0') &&
      Array.isArray(value.artifactRefs) && value.artifactRefs.length <= 32 && value.artifactRefs.every(ref =>
        typeof ref === 'string' && ref.trim().length > 0 && ref === ref.trim() && ref.length <= 512 && !/[\r\n\0]/.test(ref))
  }
  if (kind === 'approval.request') {
    return hasExactKeys(value, ['approvalId', 'expiresAt', 'summary', 'taskId']) &&
      typeof value.approvalId === 'string' && FEDERATION_NAMED_ID_PATTERN.test(value.approvalId) && value.approvalId.startsWith('approval:') &&
      typeof value.taskId === 'string' && isTaskId(value.taskId) && typeof value.summary === 'string' &&
      value.summary.trim().length > 0 && value.summary.length <= 2048 && !value.summary.includes('\0') && isCanonicalTimestamp(value.expiresAt)
  }
  if (kind === 'approval.decision') {
    return hasExactKeys(value, [
      'approvalId', 'approvalRequestMessageId', 'approvalRequestPayloadDigest', 'decidedAt', 'decision', 'taskId',
    ]) && typeof value.approvalId === 'string' && FEDERATION_NAMED_ID_PATTERN.test(value.approvalId) &&
      value.approvalId.startsWith('approval:') && typeof value.taskId === 'string' && isTaskId(value.taskId) &&
      typeof value.approvalRequestMessageId === 'string' && FEDERATION_MESSAGE_ID_PATTERN.test(value.approvalRequestMessageId) &&
      typeof value.approvalRequestPayloadDigest === 'string' && /^[0-9a-f]{64}$/.test(value.approvalRequestPayloadDigest) &&
      (value.decision === 'endorsed' || value.decision === 'declined') && isCanonicalTimestamp(value.decidedAt)
  }
  return hasExactKeys(value, ['requestMessageId', 'status']) &&
    typeof value.requestMessageId === 'string' && FEDERATION_MESSAGE_ID_PATTERN.test(value.requestMessageId) &&
    (value.status === 'accepted' || value.status === 'stored')
}

function isFederationEnvelope(value: unknown): value is FleetA2AEnvelope {
  if (!isRecord(value) || !hasExactKeys(value, [
    'expiresAt', 'issuedAt', 'kind', 'messageId', 'payload', 'payloadDigest', 'recipient',
    'schemaVersion', 'sender', 'signature', 'teamId',
  ]) || value.schemaVersion !== 2 || typeof value.kind !== 'string' ||
      !['handoff', 'approval.request', 'approval.decision', 'receipt'].includes(value.kind) ||
      typeof value.teamId !== 'string' || !FEDERATION_IDENTIFIER_PATTERN.test(value.teamId) ||
      typeof value.messageId !== 'string' || !FEDERATION_MESSAGE_ID_PATTERN.test(value.messageId) ||
      !isCanonicalTimestamp(value.issuedAt) || !isCanonicalTimestamp(value.expiresAt) ||
      Date.parse(value.expiresAt) <= Date.parse(value.issuedAt) ||
      typeof value.payloadDigest !== 'string' || !/^[0-9a-f]{64}$/.test(value.payloadDigest) ||
      typeof value.signature !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(value.signature) ||
      !isRecord(value.sender) || !hasExactKeys(value.sender, ['deviceId', 'keyId', 'principalId']) ||
      typeof value.sender.principalId !== 'string' || !FEDERATION_IDENTIFIER_PATTERN.test(value.sender.principalId) ||
      typeof value.sender.deviceId !== 'string' || !FEDERATION_IDENTIFIER_PATTERN.test(value.sender.deviceId) ||
      typeof value.sender.keyId !== 'string' || !/^ed25519:[0-9a-f]{64}$/.test(value.sender.keyId) ||
      !isRecord(value.recipient) || !hasExactKeys(value.recipient, ['deviceId', 'teamId']) ||
      typeof value.recipient.teamId !== 'string' || !FEDERATION_IDENTIFIER_PATTERN.test(value.recipient.teamId) ||
      typeof value.recipient.deviceId !== 'string' || !FEDERATION_IDENTIFIER_PATTERN.test(value.recipient.deviceId)) return false
  return isFederationPayload(value.kind as FleetFederationAdvisoryKind, value.payload)
}

function isFederationInbox(value: unknown): value is FleetFederationInboxItem[] {
  return Array.isArray(value) && value.length <= 100 && value.every(item => {
    if (!isRecord(item) || !hasExactKeys(item, ['acknowledgement', 'expired', 'record']) || typeof item.expired !== 'boolean' ||
        !isRecord(item.record) || !hasExactKeys(item.record, ['envelope', 'receivedAt', 'schemaVersion']) ||
        item.record.schemaVersion !== 1 || !isCanonicalTimestamp(item.record.receivedAt) || !isFederationEnvelope(item.record.envelope)) return false
    if (item.acknowledgement === null) return true
    const ack = item.acknowledgement
    return isRecord(ack) && hasExactKeys(ack, ['acknowledgedAt', 'disposition', 'messageId', 'payloadDigest', 'schemaVersion']) &&
      ack.schemaVersion === 1 && (ack.disposition === 'acknowledged' || ack.disposition === 'dismissed') &&
      ack.messageId === item.record.envelope.messageId && ack.payloadDigest === item.record.envelope.payloadDigest &&
      isCanonicalTimestamp(ack.acknowledgedAt)
  })
}

function isFederationAcknowledgement(value: unknown): value is AcknowledgeFederationMessageResult {
  if (!isRecord(value) || !hasExactKeys(value, ['acknowledgement', 'status']) ||
      (value.status !== 'acknowledged' && value.status !== 'duplicate') || !isRecord(value.acknowledgement)) return false
  const ack = value.acknowledgement
  return hasExactKeys(ack, ['acknowledgedAt', 'disposition', 'messageId', 'payloadDigest', 'schemaVersion']) && ack.schemaVersion === 1 &&
    (ack.disposition === 'acknowledged' || ack.disposition === 'dismissed') &&
    typeof ack.messageId === 'string' && FEDERATION_MESSAGE_ID_PATTERN.test(ack.messageId) &&
    typeof ack.payloadDigest === 'string' && /^[0-9a-f]{64}$/.test(ack.payloadDigest) && isCanonicalTimestamp(ack.acknowledgedAt)
}

interface FederationRetentionPlan {
  generatedAt: string
  candidates: FleetFederationPruneCandidate[]
}

function isFederationRetentionPlan(value: unknown): value is FederationRetentionPlan {
  return isRecord(value) && hasExactKeys(value, ['candidates', 'generatedAt']) && isCanonicalTimestamp(value.generatedAt) &&
    Array.isArray(value.candidates) && value.candidates.length <= 500 && value.candidates.every(candidate =>
      isRecord(candidate) && hasExactKeys(candidate, ['messageId', 'payloadDigest', 'reason']) &&
      typeof candidate.messageId === 'string' && FEDERATION_MESSAGE_ID_PATTERN.test(candidate.messageId) &&
      typeof candidate.payloadDigest === 'string' && /^[0-9a-f]{64}$/.test(candidate.payloadDigest) &&
      (candidate.reason === 'acknowledged-retention' || candidate.reason === 'expired-retention' || candidate.reason === 'capacity'))
}

function isFleetTaskCatalog(value: unknown): value is FleetTaskCatalog {
  if (!isRecord(value) || Object.keys(value).sort().join(',') !== 'generatedAt,tasks' ||
      !isCanonicalTimestamp(value.generatedAt) || !Array.isArray(value.tasks)) return false
  const taskKeys = 'createdAt,errorCode,profile,resultDigest,state,targetDeviceId,taskId,updatedAt,workspaceId'
  return value.tasks.every(task => isRecord(task) && Object.keys(task).sort().join(',') === taskKeys &&
    typeof task.taskId === 'string' && isTaskId(task.taskId) &&
    typeof task.state === 'string' && TASK_STATES.has(task.state as FleetTaskState) &&
    typeof task.targetDeviceId === 'string' && task.targetDeviceId.length > 0 &&
    typeof task.workspaceId === 'string' && task.workspaceId.length > 0 &&
    typeof task.profile === 'string' && task.profile.length > 0 &&
    isCanonicalTimestamp(task.createdAt) && isCanonicalTimestamp(task.updatedAt) &&
    (task.errorCode === null || typeof task.errorCode === 'string') &&
    (task.resultDigest === null || typeof task.resultDigest === 'string' && /^[0-9a-f]{64}$/.test(task.resultDigest)))
}

function isFleetTaskPruneResult(value: unknown): value is { pruned: number; skippedActive: number } {
  return isRecord(value) && Object.keys(value).sort().join(',') === 'pruned,skippedActive' &&
    typeof value.pruned === 'number' && Number.isSafeInteger(value.pruned) && value.pruned >= 0 &&
    typeof value.skippedActive === 'number' && Number.isSafeInteger(value.skippedActive) && value.skippedActive >= 0
}

function isFleetTaskResumeResult(value: unknown): value is { resumed: number } {
  return isRecord(value) && Object.keys(value).join(',') === 'resumed' &&
    typeof value.resumed === 'number' && Number.isSafeInteger(value.resumed) && value.resumed >= 0
}

function taskStateLabel(state: FleetTaskState): string {
  if (state === 'accepted') return '已接收'
  if (state === 'running') return '执行中'
  if (state === 'cancel-requested') return '正在取消'
  if (state === 'succeeded') return '已完成'
  if (state === 'failed') return '失败'
  return '已取消'
}

function taskStateColor(state: FleetTaskState): string {
  if (state === 'succeeded') return SM.good
  if (state === 'failed' || state === 'cancelled') return SM.bad
  return SM.warn
}

function isStoredTaskReference(value: unknown): value is StoredTaskReference {
  if (!isRecord(value) || Object.keys(value).length !== 2 ||
      typeof value.targetDeviceId !== 'string' || typeof value.taskId !== 'string') return false
  return value.targetDeviceId.length > 0 && value.targetDeviceId.length <= 256 && !value.targetDeviceId.includes('\0') &&
    isTaskId(value.taskId)
}

function readStoredTaskReference(): StoredTaskReference | null {
  try {
    const storage = window.localStorage
    if (storage === undefined) return null
    const raw = storage.getItem(TASK_REFERENCE_STORAGE_KEY)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    if (isStoredTaskReference(parsed)) return parsed
    storage.removeItem(TASK_REFERENCE_STORAGE_KEY)
  } catch {
    // Storage is optional (private mode, denied access, SSR, or corrupt JSON).
    try {
      window.localStorage?.removeItem(TASK_REFERENCE_STORAGE_KEY)
    } catch {
      // Access can remain denied; the in-memory fallback is still safe.
    }
  }
  return null
}

function writeStoredTaskReference(reference: StoredTaskReference): void {
  try {
    const storage = window.localStorage
    if (storage === undefined) return
    storage.setItem(TASK_REFERENCE_STORAGE_KEY, JSON.stringify({
      targetDeviceId: reference.targetDeviceId,
      taskId: reference.taskId,
    }))
  } catch {
    // Task recovery is best effort and must not block the signed A2A request.
  }
}

function clearStoredTaskReference(): void {
  try {
    window.localStorage?.removeItem(TASK_REFERENCE_STORAGE_KEY)
  } catch {
    // Keep clearing the in-memory reference even when storage is unavailable.
  }
}

const driftColors: Record<PluginDriftState, string> = {
  aligned: SM.good,
  missing: SM.bad,
  'spec-drift': SM.warn,
  'runtime-failed': SM.bad,
  'runtime-inactive': SM.warn,
}

function driftLabel(state: PluginDriftState): string {
  if (state === 'aligned') return '一致'
  if (state === 'missing') return '缺失'
  if (state === 'spec-drift') return '版本漂移'
  if (state === 'runtime-failed') return '加载失败'
  return '未激活'
}

function updateColor(item: FleetUpdateItem): string {
  if (item.state === 'current') return SM.good
  if (item.state === 'available') return SM.warn
  if (item.state === 'error' || item.state === 'missing') return SM.bad
  if (item.state === 'local') return SM.info
  return SM.fg3
}

function updateLabel(item: FleetUpdateItem): string {
  if (item.state === 'current') return '已是最新'
  if (item.state === 'available') return item.changeKind === 'head-changed' ? '上游有变化' : '可更新'
  if (item.state === 'local') return item.source === 'artifact' ? '已固定' : '本地链接'
  if (item.state === 'missing') return '未安装'
  if (item.state === 'error') return '检查失败'
  return '不支持检查'
}

function sourceLabel(item: FleetUpdateItem): string {
  if (item.kind === 'dsh') return 'CORE'
  if (item.source === 'github') return 'GitHub'
  if (item.source === 'npm') return 'npm'
  if (item.source === 'artifact') return 'tarball'
  if (item.source === 'local') return 'local'
  return 'other'
}

function shortRevision(value: string | undefined): string | undefined {
  return value?.slice(0, 7)
}

function versionText(item: FleetUpdateItem): string {
  if (item.source === 'github') {
    const current = shortRevision(item.currentRevision)
    const latest = shortRevision(item.latestRevision)
    if (current !== undefined && latest !== undefined) return `${current} → ${latest}`
    if (latest !== undefined) return `HEAD ${latest}`
  }
  if (item.currentVersion !== undefined && item.latestVersion !== undefined) {
    return `${item.currentVersion} → ${item.latestVersion}`
  }
  if (item.currentVersion !== undefined && item.state === 'local') {
    return item.source === 'artifact' ? `${item.currentVersion} · 不可变制品` : `${item.currentVersion} · 实时源码`
  }
  if (item.latestVersion !== undefined) return `最新 ${item.latestVersion}`
  if (item.errorCode === 'registry-unavailable') return 'npm 查询不可用'
  if (item.errorCode === 'github-unavailable') return 'GitHub 查询不可用'
  if (item.errorCode === 'not-installed') return '目标包未安装'
  return '暂无可比较版本'
}

function formatCheckedAt(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '未知时间'
  return date.toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

function Dot({ color, size = 7 }: { color: string; size?: number }): React.ReactElement {
  return <span aria-hidden="true" style={{ width: size, height: size, flexShrink: 0, borderRadius: 999, background: color }} />
}

function Pill({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'warn' }): React.ReactElement {
  return <span style={{
    display: 'inline-flex', alignItems: 'center', minHeight: 20, padding: '1px 7px', borderRadius: 999,
    background: tone === 'warn' ? SM.warnSoft : SM.bg2, color: tone === 'warn' ? SM.warn : SM.fg2,
    fontFamily: SM.fontMono, fontSize: 10.5, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
  }}>{children}</span>
}

function RefreshIcon(): React.ReactElement {
  return <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 11a8 8 0 1 0-2.34 5.66" />
    <path d="M20 4v7h-7" />
  </svg>
}

function FleetIcon(): React.ReactElement {
  return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="7" height="6" rx="2" />
    <rect x="14" y="4" width="7" height="6" rx="2" />
    <rect x="8.5" y="15" width="7" height="5" rx="2" />
    <path d="M6.5 10v2.5H12M17.5 10v2.5H12M12 12.5V15" />
  </svg>
}

function StatusView({ status, error }: { status: FleetStatus | null; error: string | null }): React.ReactElement {
  if (status === null) return <div style={{ padding: 14, color: error === null ? SM.fg3 : SM.bad, fontFamily: SM.fontMono }}>{error ?? '载入中…'}</div>
  return <>
    {error !== null && <div style={{ margin: '0 12px 10px', padding: '8px 10px', borderRadius: 10, background: SM.badSoft, color: SM.bad, fontFamily: SM.fontMono }}>{error}</div>}
    <div style={{ margin: '0 12px 10px', padding: 12, borderRadius: 12, background: SM.panel }}>
      <div style={{ display: 'grid', gridTemplateColumns: '76px minmax(0,1fr)', gap: '5px 8px', color: SM.fg2 }}>
        <span>设备</span><span style={{ color: SM.fg, fontFamily: SM.fontMono }}>{status.device.id}{status.device.registered ? '' : '（未登记）'}</span>
        <span>设备类型</span><span style={{ fontFamily: SM.fontMono }}>{status.device.class ?? '—'}</span>
        <span>通道</span><span style={{ fontFamily: SM.fontMono }}>{status.device.channel ?? '—'}</span>
        <span>DSH</span><span style={{ fontFamily: SM.fontMono }}>{status.dsh.version ?? '未知'} · {status.dsh.profile}</span>
        <span>清单</span><span style={{ color: status.manifest.loaded ? SM.good : SM.bad, overflowWrap: 'anywhere' }}>{status.manifest.loaded ? status.manifest.teamId : status.manifest.error}</span>
      </div>
    </div>
    <div style={{
      margin: '0 12px 10px', padding: '9px 10px', borderRadius: 10, background: SM.panelSoft,
      color: SM.fg2, fontFamily: SM.fontMono, fontVariantNumeric: 'tabular-nums', lineHeight: 1.65,
    }}>
      期望 {status.summary.desired} · 一致 {status.summary.aligned} · 缺失 {status.summary.missing}<br />
      漂移 {status.summary.drifted} · 失败 {status.summary.failed} · 未管理 {status.summary.unmanaged}<br />
      <span title={status.runtime.failedModules.join(', ')} style={{ color: status.runtime.failedModules.length > 0 ? SM.bad : SM.fg2 }}>
        Loader 失败 {status.runtime.failedModules.length}{status.runtime.failedModules.length > 0 ? ` · ${status.runtime.failedModules.join(', ')}` : ''}
      </span>
    </div>
    <div style={{ margin: '0 12px 12px', borderRadius: 12, background: SM.panel, overflow: 'hidden' }}>
      {status.plugins.map(plugin => <div key={plugin.id} style={{
        display: 'grid', gridTemplateColumns: '8px minmax(0,1fr) auto', alignItems: 'center', gap: 8,
        minHeight: 40, padding: '4px 10px', borderBottom: `1px solid ${SM.border}`,
      }}>
        <Dot color={driftColors[plugin.state]} />
        <span title={plugin.id} style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: SM.fontMono }}>{plugin.id}</span>
        <span style={{ color: driftColors[plugin.state], whiteSpace: 'nowrap' }}>{driftLabel(plugin.state)}</span>
      </div>)}
      {status.unmanaged.map(plugin => <div key={'unmanaged:' + plugin.id} style={{
        display: 'grid', gridTemplateColumns: '8px minmax(0,1fr) auto', alignItems: 'center', gap: 8,
        minHeight: 40, padding: '4px 10px', borderBottom: `1px solid ${SM.border}`,
      }}>
        <Dot color={SM.fg3} />
        <span title={plugin.id} style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: SM.fontMono }}>{plugin.id}</span>
        <span style={{ color: SM.fg3 }}>未管理</span>
      </div>)}
      {status.plugins.length === 0 && status.unmanaged.length === 0 && <div style={{ padding: 12, color: SM.fg3 }}>没有可展示的插件</div>}
    </div>
  </>
}

function UpdatesView({
  updates,
  loading,
  error,
  onRefresh,
}: {
  updates: FleetUpdates | null
  loading: boolean
  error: string | null
  onRefresh: () => void
}): React.ReactElement {
  const snapshot = updates?.snapshot
  const visibleItems = snapshot?.items.filter(item => item.kind === 'dsh' || item.state !== 'current') ?? []
  const hiddenCurrent = snapshot?.items.filter(item => item.kind === 'plugin' && item.state === 'current').length ?? 0
  const artifactCount = snapshot?.items.filter(item => item.state === 'local' && item.source === 'artifact').length ?? 0
  const liveLocalCount = (snapshot?.summary.local ?? 0) - artifactCount
  return <div style={{ padding: '0 12px 12px' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: SM.fg, fontSize: 13, fontWeight: 600 }}>更新检查</div>
        <div title={snapshot?.checkedAt} style={{ color: updates?.stale ? SM.warn : SM.fg3, fontSize: 10.5, fontFamily: SM.fontMono, fontVariantNumeric: 'tabular-nums' }}>
          {snapshot === undefined ? (loading ? '检查中…' : '尚未检查') : `${updates?.stale ? '缓存已过期 · ' : ''}${formatCheckedAt(snapshot.checkedAt)}`}
        </div>
      </div>
      <button type="button" onClick={onRefresh} disabled={loading || updates?.enabled === false} style={{
        minHeight: 30, padding: '4px 10px', border: `1px solid ${SM.borderStrong}`, borderRadius: 999,
        background: SM.panel, color: loading ? SM.fg3 : SM.fg2, cursor: loading ? 'default' : 'pointer',
        fontFamily: SM.fontSans, fontSize: 11.5,
      }}>{loading ? '检查中…' : '重新检查'}</button>
    </div>
    <div style={{ marginBottom: 10, color: SM.fg3, fontSize: 10.5, lineHeight: 1.5 }}>
      只读比较公开发布源，不会安装、修改配置或重启 DSH。
    </div>
    {error !== null && <div style={{ marginBottom: 10, padding: '8px 10px', borderRadius: 10, background: SM.badSoft, color: SM.bad, fontFamily: SM.fontMono }}>{error}</div>}
    {updates?.enabled === false && <div style={{ padding: 12, borderRadius: 10, background: SM.panel, color: SM.fg3 }}>更新检查已在配置中关闭</div>}
    {snapshot !== undefined && <>
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 9,
        fontFamily: SM.fontMono, fontVariantNumeric: 'tabular-nums',
      }}>
        <Pill tone={snapshot.summary.available > 0 ? 'warn' : 'neutral'}>{snapshot.summary.available} 个变化</Pill>
        <Pill>{snapshot.summary.current} 个最新</Pill>
        {artifactCount > 0 && <Pill>{artifactCount} 个制品</Pill>}
        {liveLocalCount > 0 && <Pill>{liveLocalCount} 个本地链接</Pill>}
        {snapshot.summary.errors > 0 && <Pill tone="warn">{snapshot.summary.errors} 个失败</Pill>}
      </div>
      <div style={{ borderRadius: 12, background: SM.panel, overflow: 'hidden' }}>
        {visibleItems.map(item => <div key={`${item.kind}:${item.id}`} style={{
          display: 'grid', gridTemplateColumns: '8px minmax(0,1fr) auto', gap: 8, alignItems: 'center',
          minHeight: 48, padding: '5px 10px', borderBottom: `1px solid ${SM.border}`,
        }}>
          <Dot color={updateColor(item)} />
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <span title={item.id} style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: SM.fg, fontFamily: SM.fontMono, fontSize: 11.5 }}>{item.kind === 'dsh' ? 'DSH Core' : item.id}</span>
              <Pill>{sourceLabel(item)}</Pill>
              {item.sourceUrl !== undefined && <a href={item.sourceUrl} target="_blank" rel="noreferrer" aria-label={`打开 ${item.id} 发布源`} style={{ color: SM.fg3, textDecoration: 'none' }}>↗</a>}
            </div>
            <div title={[item.currentRevision, item.latestRevision].filter(Boolean).join(' → ')} style={{
              marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              color: SM.fg3, fontFamily: SM.fontMono, fontSize: 10.5, fontVariantNumeric: 'tabular-nums',
            }}>{versionText(item)}</div>
          </div>
          <span style={{ color: updateColor(item), whiteSpace: 'nowrap', fontSize: 11 }}>{updateLabel(item)}</span>
        </div>)}
        {hiddenCurrent > 0 && <div style={{ padding: '9px 10px', color: SM.good, fontSize: 11 }}>{hiddenCurrent} 个插件已是最新</div>}
        {visibleItems.length === 0 && hiddenCurrent === 0 && <div style={{ padding: 12, color: SM.fg3 }}>没有可检查的项目</div>}
      </div>
    </>}
    {snapshot === undefined && updates?.enabled !== false && !loading && error === null && <div style={{ padding: 12, borderRadius: 10, background: SM.panel, color: SM.fg3 }}>切到此页时会按需检查；结果缓存 6 小时。</div>}
  </div>
}

function actionLabel(state: AgentActionState): string {
  if (state === 'succeeded') return '已完成'
  if (state === 'rolled-back') return '已自动回滚'
  if (state === 'manual-intervention') return '需要人工处理'
  if (state.startsWith('rollback')) return '正在回滚'
  if (state === 'verifying') return '正在健康检查'
  if (state === 'restarting') return '正在重启'
  if (state === 'applying') return '正在安装'
  return '正在准备'
}

function actionColor(state: AgentActionState): string {
  if (state === 'succeeded') return SM.good
  if (state === 'rolled-back' || state === 'manual-intervention' || state.startsWith('rollback')) return SM.bad
  return SM.warn
}

function OperationsView({
  targets,
  plan,
  action,
  rollbackPlan,
  rollbackAction,
  retentionPlan,
  retentionAction,
  loading,
  error,
  armed,
  rollbackArmed,
  retentionArmed,
  onArm,
  onRollbackArm,
  onRetentionArm,
  onReload,
  onPlan,
  onApprove,
  onRollbackPlan,
  onRollbackApprove,
  onRetentionPlan,
  onRetentionApprove,
}: {
  targets: AgentTargetsView | null
  plan: FleetPlan | FleetReleasePlan | null
  action: AgentActionRecord | ReleaseActionRecord | null
  rollbackPlan: FleetReleaseRollbackPlan | null
  rollbackAction: ReleaseRollbackActionRecord | null
  retentionPlan: FleetReleaseRetentionPlan | null
  retentionAction: ReleaseRetentionActionRecord | null
  loading: boolean
  error: string | null
  armed: boolean
  rollbackArmed: boolean
  retentionArmed: boolean
  onArm(value: boolean): void
  onRollbackArm(value: boolean): void
  onRetentionArm(value: boolean): void
  onReload(): void
  onPlan(deviceId: string, pluginId?: string): void
  onApprove(): void
  onRollbackPlan(deviceId: string, transitionPlanId: string): void
  onRollbackApprove(): void
  onRetentionPlan(deviceId: string): void
  onRetentionApprove(): void
}): React.ReactElement {
  const rollbackAvailable = action !== null && 'releaseId' in action && action.state === 'succeeded' &&
    action.result === 'success' && typeof action.rollbackDescriptorDigest === 'string'
  return <div style={{ padding: '0 12px 12px' }}>
    <div style={{ marginBottom: 10, padding: '9px 10px', borderRadius: 10, background: SM.panelSoft, color: SM.fg2, lineHeight: 1.55 }}>
      v2 设备按完整 Profile Release 原子切换；公开包与私有制品一起审批、验证和回滚。旧版 v1 设备仍保留单插件兼容流程。
    </div>
    {error !== null && <div style={{ marginBottom: 10, padding: '9px 10px', borderRadius: 10, background: SM.badSoft, color: SM.bad, fontFamily: SM.fontMono }}>{error}</div>}
    {targets?.enabled === false && <div style={{ padding: 12, borderRadius: 10, background: SM.panel, color: SM.fg3 }}>远程收敛未启用</div>}
    {targets === null && error === null && <div style={{ padding: 12, color: SM.fg3 }}>载入中…</div>}
    {targets?.targets.map(target => {
      const release = target.inspection !== undefined && 'kind' in target.inspection && target.inspection.kind === 'profile-release'
        ? target.inspection
        : null
      const legacy = target.inspection !== undefined && !('kind' in target.inspection) ? target.inspection : null
      const releaseRegistered = release !== null && release.changes.length === 0 && release.currentRelease !== null &&
        release.currentRelease.releaseId === release.assignedRelease.releaseId &&
        release.currentRelease.releaseVersion === release.assignedRelease.releaseVersion &&
        release.currentRelease.releaseDigest === release.assignedRelease.releaseDigest
      const retentionCandidates = release === null ? 0 : release.retention.eligibleCount
      return <div key={target.deviceId} style={{ marginBottom: 10, borderRadius: 12, background: SM.panel, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 11px', borderBottom: `1px solid ${SM.border}` }}>
          <Dot color={target.online ? SM.good : SM.bad} />
          <strong style={{ flex: 1, fontFamily: SM.fontMono }}>{target.deviceId}</strong>
          {release !== null && <Pill>RELEASE</Pill>}
          <span style={{ color: SM.fg3, fontFamily: SM.fontMono }}>{target.inspection?.dshVersion ?? target.errorCode ?? '离线'}</span>
        </div>
        {target.online && release !== null && <div style={{ padding: '10px 11px' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong style={{ fontFamily: SM.fontMono }}>{release.assignedRelease.releaseId}@{release.assignedRelease.releaseVersion}</strong>
              <div style={{ marginTop: 3, color: releaseRegistered ? SM.good : SM.warn }}>
                {releaseRegistered ? 'Release 已登记，文件一致' : release.changes.length === 0 ? '文件一致，尚未登记 Release' : `${release.changes.length} 项原子变更`}
              </div>
              <div style={{ marginTop: 3, color: release.liveManifestDigest === release.desiredManifestDigest ? SM.good : SM.warn, fontFamily: SM.fontMono, fontSize: 10.5 }}>
                live {release.liveManifestDigest.slice(0, 12)} · desired {release.desiredManifestDigest.slice(0, 12)}
              </div>
              <div style={{ marginTop: 3, color: SM.fg3, fontFamily: SM.fontMono, fontSize: 10.5 }}>
                runtime {release.observedRuntimeDigest.slice(0, 12)} · service {release.observedServiceDefinitionDigest?.slice(0, 12) ?? 'screen'}
              </div>
            </div>
            {!releaseRegistered && <button type="button" disabled={loading} onClick={() => onPlan(target.deviceId)} style={{
              minHeight: 30, padding: '4px 10px', border: 0, borderRadius: 9, background: SM.infoSoft, color: SM.info,
              cursor: loading ? 'default' : 'pointer', fontFamily: SM.fontSans,
            }}>{release.changes.length === 0 ? '生成登记计划' : '生成原子计划'}</button>}
          </div>
          {release.changes.map(change => <div key={change.pluginId} style={{ marginTop: 6, color: SM.fg3, fontFamily: SM.fontMono, fontSize: 10.5 }}>
            {change.action.toUpperCase()} · {change.pluginId}
          </div>)}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, paddingTop: 8, borderTop: `1px solid ${SM.border}` }}>
            <div style={{ flex: 1, color: retentionCandidates > 0 ? SM.warn : SM.fg3, fontSize: 10.5 }}>
              保留 {release.retention.retainedCount} 个 transition · 可清理 {release.retention.eligibleCount} 个 superseded transition ·
              孤立目录（仅审计、不自动删除）{release.retention.orphanCount}（backup {release.retention.orphanBackupCount} / stage {release.retention.orphanStageCount} / failed {release.retention.orphanFailedCount}）
              {release.retention.invalidTransitionCount > 0 && <span style={{ display: 'block', marginTop: 2, color: SM.bad }}>另有 {release.retention.invalidTransitionCount} 个无效 transition，不会自动清理。</span>}
            </div>
            {retentionCandidates > 0 && <button type="button" disabled={loading} onClick={() => onRetentionPlan(target.deviceId)} style={{
              minHeight: 30, padding: '4px 10px', border: `1px solid ${SM.borderStrong}`, borderRadius: 9,
              background: SM.panel, color: SM.warn, cursor: loading ? 'default' : 'pointer', fontFamily: SM.fontSans,
            }}>预览备份清理</button>}
          </div>
        </div>}
        {target.online && legacy?.candidates.map(candidate => <div key={candidate.pluginId} style={{
          display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 8, alignItems: 'center',
          minHeight: 48, padding: '7px 10px', borderBottom: `1px solid ${SM.border}`,
        }}>
          <div style={{ minWidth: 0 }}>
            <div title={candidate.pluginId} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: SM.fontMono }}>{candidate.pluginId}</div>
            <div title={candidate.exactToSpec} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: SM.fg3, fontFamily: SM.fontMono, fontSize: 10.5 }}>
              {candidate.action === 'install' ? '安装' : '更新'} → {candidate.exactToSpec}
            </div>
          </div>
          <button type="button" disabled={loading} onClick={() => onPlan(target.deviceId, candidate.pluginId)} style={{
            minHeight: 28, padding: '4px 9px', border: 0, borderRadius: 9, background: SM.infoSoft, color: SM.info,
            cursor: loading ? 'default' : 'pointer', fontFamily: SM.fontSans,
          }}>生成计划</button>
        </div>)}
        {target.online && legacy?.candidates.length === 0 && <div style={{ padding: 10, color: SM.good }}>该设备已经一致</div>}
      </div>
    })}
    {plan !== null && <div style={{ marginBottom: 10, padding: 11, borderRadius: 12, background: SM.panel, boxShadow: SM.shadowCard }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
        <Dot color={SM.warn} />
        <strong>待批准计划</strong>
        <span style={{ marginLeft: 'auto', color: SM.fg3, fontFamily: SM.fontMono }}>
          {'kind' in plan ? 'PROFILE RELEASE' : plan.action === 'install' ? 'INSTALL' : 'UPDATE'}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '72px minmax(0,1fr)', gap: '5px 8px', color: SM.fg2 }}>
        <span>设备</span><span style={{ fontFamily: SM.fontMono }}>{plan.deviceId}</span>
        {'kind' in plan ? <>
          <span>Release</span><span style={{ fontFamily: SM.fontMono }}>{plan.releaseId}@{plan.releaseVersion}</span>
          <span>插件</span><span style={{ fontFamily: SM.fontMono }}>{plan.plugins.length} 个，{plan.changes.length} 项变更</span>
          <span>原子性</span><span>整组 stage → rename → health → rollback</span>
          <span>运行身份</span><span style={{ fontFamily: SM.fontMono }}>{plan.observedRuntimeDigest.slice(0, 12)}</span>
          <span>服务定义</span><span style={{ fontFamily: SM.fontMono }}>{plan.observedServiceDefinitionDigest?.slice(0, 12) ?? '未托管'}</span>
        </> : <>
          <span>插件</span><span style={{ fontFamily: SM.fontMono }}>{plan.pluginId}</span>
          <span>目标</span><span title={plan.exactToSpec} style={{ overflowWrap: 'anywhere', fontFamily: SM.fontMono }}>{plan.exactToSpec}</span>
        </>}
        <span>计划</span><span title={plan.planId} style={{ fontFamily: SM.fontMono }}>{plan.digest.slice(0, 12)}</span>
        <span>过期</span><span style={{ fontFamily: SM.fontMono, fontVariantNumeric: 'tabular-nums' }}>{formatCheckedAt(plan.expiresAt)}</span>
      </div>
      {'kind' in plan && plan.changes.map(change => <div key={change.pluginId} style={{ marginTop: 5, color: SM.fg3, fontFamily: SM.fontMono, fontSize: 10.5 }}>
        {change.action.toUpperCase()} · {change.pluginId} · {change.visibility}
      </div>)}
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 10, color: SM.fg2, cursor: 'pointer' }}>
        <input type="checkbox" checked={armed} onChange={event => onArm(event.currentTarget.checked)} />
        <span>我确认由 {plan.deviceId} 执行这一{'kind' in plan ? '完整 Profile Release' : '精确插件计划'}；失败时自动回滚。</span>
      </label>
      <button type="button" disabled={!armed || loading} onClick={onApprove} style={{
        width: '100%', minHeight: 32, marginTop: 10, border: 0, borderRadius: 10,
        background: armed && !loading ? SM.bad : SM.fg4, color: SM.panel,
        cursor: armed && !loading ? 'pointer' : 'default', fontFamily: SM.fontSans, fontWeight: 600,
      }}>{loading ? '执行中…' : '批准并执行一次'}</button>
    </div>}
    {action !== null && <div style={{ marginBottom: 10, padding: 10, borderRadius: 10, background: action.state === 'succeeded' ? SM.goodSoft : SM.badSoft, color: actionColor(action.state) }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}><Dot color={actionColor(action.state)} /><strong>{actionLabel(action.state)}</strong></div>
      <div style={{ marginTop: 4, fontFamily: SM.fontMono, fontVariantNumeric: 'tabular-nums' }}>
        {'releaseId' in action ? `${action.releaseId}@${action.releaseVersion}` : action.pluginId} · {action.updatedAt.slice(0, 19).replace('T', ' ')}
      </div>
    </div>}
    {rollbackAvailable && rollbackPlan === null && rollbackAction === null && <button type="button" disabled={loading} onClick={() => onRollbackPlan(action.deviceId, action.planId)} style={{
      width: '100%', minHeight: 32, marginBottom: 10, border: `1px solid ${SM.borderStrong}`, borderRadius: 10,
      background: SM.panel, color: SM.bad, cursor: loading ? 'default' : 'pointer', fontFamily: SM.fontSans,
    }}>生成回滚计划</button>}
    {rollbackPlan !== null && <div style={{ marginBottom: 10, padding: 11, borderRadius: 12, background: SM.badSoft, color: SM.fg2 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8, color: SM.bad }}>
        <Dot color={SM.bad} /><strong>显式 Release 回滚</strong>
      </div>
      <div style={{ lineHeight: 1.65 }}>
        <div>设备：<span style={{ fontFamily: SM.fontMono }}>{rollbackPlan.deviceId}</span></div>
        <div>原 Release 计划：<span title={rollbackPlan.transitionPlanId} style={{ fontFamily: SM.fontMono }}>{rollbackPlan.transitionPlanDigest.slice(0, 12)}</span></div>
        <div>当前 → 上一版本：<span style={{ fontFamily: SM.fontMono }}>{rollbackPlan.fromReleaseDigest.slice(0, 12)} → {rollbackPlan.toReleaseDigest?.slice(0, 12) ?? '未登记'}</span></div>
        <div>运行身份：<span style={{ fontFamily: SM.fontMono }}>{rollbackPlan.observedRuntimeDigest.slice(0, 12)} · service {rollbackPlan.observedServiceDefinitionDigest?.slice(0, 12) ?? '未托管'}</span></div>
        <div>计划过期：<span style={{ fontFamily: SM.fontMono }}>{formatCheckedAt(rollbackPlan.expiresAt)}</span></div>
      </div>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 9, color: SM.bad, cursor: 'pointer' }}>
        <input type="checkbox" checked={rollbackArmed} onChange={event => onRollbackArm(event.currentTarget.checked)} />
        <span>我确认将 {rollbackPlan.deviceId} 恢复到该 Release 之前保留的 Profile；这不是普通失败的自动回滚。</span>
      </label>
      <button type="button" disabled={!rollbackArmed || loading} onClick={onRollbackApprove} style={{
        width: '100%', minHeight: 32, marginTop: 9, border: 0, borderRadius: 10,
        background: rollbackArmed && !loading ? SM.bad : SM.fg4, color: SM.panel,
        cursor: rollbackArmed && !loading ? 'pointer' : 'default', fontFamily: SM.fontSans, fontWeight: 600,
      }}>{loading ? '回滚中…' : '确认执行回滚'}</button>
    </div>}
    {rollbackAction !== null && <div style={{ marginBottom: 10, padding: 10, borderRadius: 10, background: rollbackAction.state === 'succeeded' ? SM.goodSoft : SM.badSoft, color: actionColor(rollbackAction.state) }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <Dot color={actionColor(rollbackAction.state)} />
        <strong>{rollbackAction.state === 'succeeded' ? '已恢复上一版本' : actionLabel(rollbackAction.state)}</strong>
      </div>
      <div style={{ marginTop: 4, fontFamily: SM.fontMono, fontVariantNumeric: 'tabular-nums' }}>
        {rollbackAction.transitionPlanId.slice(0, 25)} · {rollbackAction.updatedAt.slice(0, 19).replace('T', ' ')}
      </div>
    </div>}
    {retentionPlan !== null && <div style={{ marginBottom: 10, padding: 11, borderRadius: 12, background: SM.warnSoft, color: SM.fg2 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8, color: SM.warn }}>
        <Dot color={SM.warn} /><strong>Release 备份清理预览</strong>
      </div>
      <div style={{ marginBottom: 7 }}>设备：<span style={{ fontFamily: SM.fontMono }}>{retentionPlan.deviceId}</span> · 计划过期：{formatCheckedAt(retentionPlan.expiresAt)}</div>
      <div style={{ marginBottom: 7, color: SM.good }}>
        明确保留：{retentionPlan.retainedTransitionPlanIds.length === 0
          ? '无已登记 transition'
          : retentionPlan.retainedTransitionPlanIds.map(id => id.slice(0, 25)).join('、')}
      </div>
      {retentionPlan.entries.map(entry => <div key={entry.transitionPlanId} style={{ marginTop: 5, padding: 7, borderRadius: 8, background: SM.panel }}>
        <strong style={{ color: SM.bad }}>将删除 superseded transition</strong>
        <div title={entry.transitionPlanId} style={{ marginTop: 2, fontFamily: SM.fontMono }}>{entry.transitionPlanId}</div>
        <div style={{ marginTop: 2 }}>同时删除备份：<span style={{ fontFamily: SM.fontMono }}>{entry.backupProfile ?? '无备份目录，仅删除 transition/descriptor'}</span></div>
      </div>)}
      {retentionPlan.orphanBackupProfiles.map(profile => <div key={profile} style={{ marginTop: 5, color: SM.warn }}>发现孤立 backup：<span style={{ fontFamily: SM.fontMono }}>{profile}</span>；不会由本计划删除，需人工审计。</div>)}
      {retentionPlan.orphanStageProfiles.map(profile => <div key={profile} style={{ marginTop: 5, color: SM.warn }}>发现孤立 stage：<span style={{ fontFamily: SM.fontMono }}>{profile}</span>；不会由本计划删除，需人工审计。</div>)}
      {retentionPlan.orphanFailedProfiles.map(profile => <div key={profile} style={{ marginTop: 5, color: SM.warn }}>发现孤立 failed：<span style={{ fontFamily: SM.fontMono }}>{profile}</span>；不会由本计划删除，需人工审计。</div>)}
      {retentionPlan.entries.length === 0
        ? <div style={{ color: SM.good }}>当前计划没有可执行的 superseded transition 删除项；孤立目录仅供审计。</div>
        : <>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 10, color: SM.bad, cursor: 'pointer' }}>
            <input type="checkbox" checked={retentionArmed} onChange={event => onRetentionArm(event.currentTarget.checked)} />
            <span>我确认永久删除上面逐项列出的 exact superseded transition 及其绑定备份；当前与上一 transition 保留，孤立目录不会由本计划删除。</span>
          </label>
          <button type="button" disabled={!retentionArmed || loading} onClick={onRetentionApprove} style={{
            width: '100%', minHeight: 32, marginTop: 9, border: 0, borderRadius: 10,
            background: retentionArmed && !loading ? SM.bad : SM.fg4, color: SM.panel,
            cursor: retentionArmed && !loading ? 'pointer' : 'default', fontFamily: SM.fontSans, fontWeight: 600,
          }}>{loading ? '清理中…' : '确认执行备份清理'}</button>
        </>}
    </div>}
    {retentionAction !== null && <div style={{ marginBottom: 10, padding: 10, borderRadius: 10, background: retentionAction.state === 'succeeded' ? SM.goodSoft : SM.warnSoft, color: retentionAction.state === 'succeeded' ? SM.good : SM.warn }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <Dot color={retentionAction.state === 'succeeded' ? SM.good : SM.warn} />
        <strong>{retentionAction.state === 'succeeded' ? '备份保留清理已完成' : '备份保留清理进行中'}</strong>
      </div>
      <div style={{ marginTop: 4 }}>已删除 {retentionAction.removedTransitionPlanIds.length} 个 superseded transition · {formatCheckedAt(retentionAction.updatedAt)}</div>
    </div>}
    <button type="button" onClick={onReload} disabled={loading} style={{
      width: '100%', minHeight: 30, border: `1px solid ${SM.borderStrong}`, borderRadius: 10,
      background: SM.panel, color: SM.fg2, cursor: loading ? 'default' : 'pointer', fontFamily: SM.fontSans,
    }}>刷新目标状态</button>
  </div>
}

function TasksView({
  targets,
  targetDeviceId,
  workspaceId,
  profile,
  policyId,
  prompt,
  taskId,
  reply,
  catalog,
  catalogLoading,
  catalogError,
  catalogNotice,
  pruneArmed,
  loading,
  error,
  onTarget,
  onWorkspace,
  onProfile,
  onPolicy,
  onPrompt,
  onTaskId,
  onClear,
  onSubmit,
  onStatus,
  onCancel,
  onApprovalDecision,
  onReloadTargets,
  onRefreshCatalog,
  onTrack,
  onResume,
  onArmPrune,
  onPrune,
}: {
  targets: AgentTargetsView | null
  targetDeviceId: string
  workspaceId: string
  profile: string
  policyId: string
  prompt: string
  taskId: string
  reply: FleetTaskReply | null
  catalog: FleetTaskCatalog | null
  catalogLoading: boolean
  catalogError: string | null
  catalogNotice: string | null
  pruneArmed: boolean
  loading: boolean
  error: string | null
  onTarget(value: string): void
  onWorkspace(value: string): void
  onProfile(value: string): void
  onPolicy(value: string): void
  onPrompt(value: string): void
  onTaskId(value: string): void
  onClear(): void
  onSubmit(): void
  onStatus(): void
  onCancel(): void
  onApprovalDecision(decision: 'allowed-once' | 'rejected'): void
  onReloadTargets(): void
  onRefreshCatalog(): void
  onTrack(task: FleetTaskCatalogItem): void
  onResume(): void
  onArmPrune(): void
  onPrune(): void
}): React.ReactElement {
  const releaseTargets = (targets?.targets ?? []).flatMap(target => {
    const inspection = target.inspection
    return target.online && inspection !== undefined && 'kind' in inspection && inspection.kind === 'profile-release'
      ? [{ target, deviceId: target.deviceId, tasks: inspection.tasks }]
      : []
  })
  const selected = releaseTargets.find(target => target.deviceId === targetDeviceId)
  const selectedExecutionProfile = selected?.tasks.executionProfiles.find(binding => binding.profile === profile)
  const taskPayload = reply !== null && (reply.response.kind === 'task.progress' || reply.response.kind === 'task.result')
    ? reply.response.payload
    : null
  const approval = reply?.response.kind === 'task.approval.request'
    ? reply.response.payload as FleetTaskApprovalRequestPayload
    : null
  const state = taskPayload?.state as FleetTaskState | undefined
  const terminal = state === 'succeeded' || state === 'failed' || state === 'cancelled'
  const emptyReason = targets === null
    ? '正在读取设备与任务策略…'
    : targets.enabled === false
      ? '远程收敛尚未启用。请先配置固定 Agent 目标。'
      : targets.targets.length === 0
        ? '尚未配置任何 Agent 目标。'
        : targets.targets.every(target => !target.online)
          ? '所有目标设备均离线；请检查固定传输和 Agent 服务。'
          : releaseTargets.length === 0
            ? '在线目标仍使用旧版单插件模式，尚不支持可恢复任务目录。'
            : releaseTargets.every(target => !target.tasks.enabled)
              ? '目标设备在线，但 A2A 任务策略尚未启用。'
              : null
  return <div style={{ padding: '0 12px 12px' }}>
    <div style={{ marginBottom: 10, padding: '9px 10px', borderRadius: 10, background: SM.panelSoft, color: SM.fg2, lineHeight: 1.55 }}>
      任务通过设备签名的 A2A 消息提交。目标机只接受下方列出的 workspace/profile ID；没有任意 shell、argv 或路径入口。
    </div>
    {error !== null && <div style={{ marginBottom: 10, padding: '9px 10px', borderRadius: 10, background: SM.badSoft, color: SM.bad, fontFamily: SM.fontMono }}>{error}</div>}
    {emptyReason !== null && <div style={{ marginBottom: 10, padding: 12, borderRadius: 10, background: SM.panel, color: SM.fg3 }}>{emptyReason}</div>}
    <button type="button" onClick={onReloadTargets} disabled={loading} style={{
      width: '100%', minHeight: 30, marginBottom: 10, border: `1px solid ${SM.borderStrong}`, borderRadius: 10,
      background: SM.panel, color: SM.fg2, cursor: loading ? 'default' : 'pointer', fontFamily: SM.fontSans,
    }}>重新读取设备状态</button>
    {(releaseTargets.length > 0 || targetDeviceId !== '') && <div style={{ marginBottom: 10, padding: 11, borderRadius: 12, background: SM.panel }}>
      <label style={{ display: 'grid', gap: 5, marginBottom: 9, color: SM.fg2 }}>
        <span>目标设备</span>
        <select value={targetDeviceId} disabled={loading || taskId !== ''} onChange={event => onTarget(event.currentTarget.value)} style={{ minHeight: 34, border: `1px solid ${SM.borderStrong}`, borderRadius: 9, background: SM.panel, color: SM.fg }}>
          {targetDeviceId !== '' && selected === undefined && <option value={targetDeviceId}>{targetDeviceId}（已保存）</option>}
          {releaseTargets.map(target => <option key={target.deviceId} value={target.deviceId}>{target.deviceId}{target.tasks.enabled ? '' : '（任务关闭）'}</option>)}
        </select>
      </label>
      {selected !== undefined && <div style={{ color: SM.fg2, lineHeight: 1.65 }}>
        <div>策略：{selected.tasks.enabled ? '已启用' : '已关闭'} · Workspace {selected.tasks.workspaceIds.join(', ') || '无'} · Profile {selected.tasks.profiles.join(', ') || '无'}</div>
        {selectedExecutionProfile !== undefined && <div title={selectedExecutionProfile.profileHash} style={{ fontFamily: SM.fontMono, fontSize: 10.5 }}>
          execution {selectedExecutionProfile.profile} · {selectedExecutionProfile.profileHash.slice(0, 12)}
        </div>}
        <div style={{ color: selected.target.inspection !== undefined && 'kind' in selected.target.inspection && selected.target.inspection.liveManifestDigest === selected.target.inspection.desiredManifestDigest ? SM.good : SM.warn, fontFamily: SM.fontMono, fontSize: 10.5 }}>
          live {selected.target.inspection !== undefined && 'kind' in selected.target.inspection ? selected.target.inspection.liveManifestDigest.slice(0, 12) : '—'} · desired {selected.target.inspection !== undefined && 'kind' in selected.target.inspection ? selected.target.inspection.desiredManifestDigest.slice(0, 12) : '—'}
        </div>
        {selected.target.readiness !== undefined ? <>
          <div>身份：{selected.target.readiness.teamId}/{selected.target.readiness.principalId}</div>
          <div title={selected.target.readiness.identityKeyId} style={{ overflowWrap: 'anywhere', fontFamily: SM.fontMono, fontSize: 10.5 }}>Key {selected.target.readiness.identityKeyId}</div>
          <div>受信任 Peer：{selected.target.readiness.trustedPeerCount} · Doctor 就绪</div>
        </> : <div style={{ color: SM.warn }}>Doctor：{selected.target.readinessErrorCode ?? '尚无就绪信息'}</div>}
        {targets?.signer !== undefined && <div style={{ color: targets.signer.ready ? SM.good : SM.warn }}>
          本地签名器：{targets.signer.ready ? `就绪 · ${targets.signer.deviceId}` : targets.signer.errorCode ?? '未就绪'}
        </div>}
      </div>}
    </div>}
    {selected?.tasks.enabled === true && <div style={{ padding: 11, borderRadius: 12, background: SM.panel }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <label style={{ display: 'grid', gap: 5, color: SM.fg2 }}>
          <span>Workspace ID</span>
          <select value={workspaceId} onChange={event => onWorkspace(event.currentTarget.value)} style={{ minHeight: 34, border: `1px solid ${SM.borderStrong}`, borderRadius: 9, background: SM.panel, color: SM.fg }}>
            {(selected?.tasks.workspaceIds ?? []).map(id => <option key={id} value={id}>{id}</option>)}
          </select>
        </label>
        <label style={{ display: 'grid', gap: 5, color: SM.fg2 }}>
          <span>Profile</span>
          <select value={profile} onChange={event => onProfile(event.currentTarget.value)} style={{ minHeight: 34, border: `1px solid ${SM.borderStrong}`, borderRadius: 9, background: SM.panel, color: SM.fg }}>
            {(selected?.tasks.profiles ?? []).map(id => <option key={id} value={id}>{id}</option>)}
          </select>
        </label>
      </div>
      <label style={{ display: 'grid', gap: 5, marginTop: 9, color: SM.fg2 }}>
        <span>执行策略</span>
        <select value={policyId} onChange={event => onPolicy(event.currentTarget.value)} style={{ minHeight: 34, border: `1px solid ${SM.borderStrong}`, borderRadius: 9, background: SM.panel, color: SM.fg }}>
          {(selected?.tasks.policies ?? []).map(policy => <option key={policy.policyId} value={policy.policyId}>
            {policy.policyId} · {policy.permissionMode === 'read-only' ? '只读' : '工作区写入，逐次审批'}
          </option>)}
        </select>
      </label>
      {selected?.tasks.policies.find(policy => policy.policyId === policyId)?.permissionMode === 'workspace-write' && <div style={{ marginTop: 7, padding: 7, borderRadius: 8, background: SM.warnSoft, color: SM.warn }}>
        写入、命令和联网工具仍需逐次签名批准；未知工具和越出 workspace 的调用始终拒绝。
      </div>}
      <label style={{ display: 'grid', gap: 5, marginTop: 9, color: SM.fg2 }}>
        <span>任务</span>
        <textarea value={prompt} onChange={event => onPrompt(event.currentTarget.value)} rows={5} maxLength={32 * 1024} placeholder="描述要由目标 DSH 完成的任务" style={{ resize: 'vertical', padding: 9, border: `1px solid ${SM.borderStrong}`, borderRadius: 9, background: SM.panel, color: SM.fg, fontFamily: SM.fontSans }} />
      </label>
      <button type="button" disabled={loading || taskId !== '' || prompt.trim().length === 0 || workspaceId === '' || profile === '' || policyId === ''} onClick={onSubmit} style={{
        width: '100%', minHeight: 34, marginTop: 10, border: 0, borderRadius: 10,
        background: loading || taskId !== '' || prompt.trim().length === 0 ? SM.fg4 : SM.info, color: SM.panel,
        cursor: loading || taskId !== '' || prompt.trim().length === 0 || workspaceId === '' || profile === '' || policyId === '' ? 'default' : 'pointer', fontWeight: 600,
      }}>{loading ? '提交中…' : '签名并提交任务'}</button>
      {taskId !== '' && <div style={{ marginTop: 7, color: SM.warn }}>已有任务引用；请先查询、取消，或明确清除记录后再新建任务。</div>}
    </div>}
    {targetDeviceId !== '' && <div data-dsh-fleet-task-recovery style={{ marginTop: 10, padding: 11, borderRadius: 12, background: SM.panel }}>
      <div style={{ marginBottom: 7, color: SM.fg2 }}>恢复目标：<span style={{ fontFamily: SM.fontMono }}>{targetDeviceId}</span></div>
      <label style={{ display: 'grid', gap: 5, color: SM.fg2 }}>
        <span>Task ID</span>
        <input aria-label="Task ID" value={taskId} disabled={loading} onChange={event => onTaskId(event.currentTarget.value.trim())} placeholder="task:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" autoComplete="off" spellCheck={false} style={{ minHeight: 34, padding: '0 9px', border: `1px solid ${SM.borderStrong}`, borderRadius: 9, background: SM.panel, color: SM.fg, fontFamily: SM.fontMono }} />
      </label>
      <div style={{ marginTop: 6, color: SM.fg3 }}>浏览器会尝试只保存目标设备和 Task ID，不保存任务描述或输出。</div>
      <div style={{ display: 'flex', gap: 8, marginTop: 9 }}>
        <button type="button" disabled={loading || !isTaskId(taskId)} onClick={onStatus} style={{ flex: 1, minHeight: 30, border: `1px solid ${SM.borderStrong}`, borderRadius: 9, background: SM.panel, color: SM.fg2 }}>查询任务</button>
        <button type="button" disabled={loading || (taskId === '' && reply === null)} onClick={onClear} style={{ flex: 1, minHeight: 30, border: 0, borderRadius: 9, background: SM.bg2, color: SM.fg2 }}>清除记录</button>
      </div>
    </div>}
    {reply !== null && taskPayload !== null && <div style={{ marginTop: 10, padding: 11, borderRadius: 12, background: SM.panel }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <Dot color={taskStateColor(state!)} />
        <strong style={{ flex: 1 }}>{taskStateLabel(state!)}</strong>
        <span style={{ color: SM.fg3, fontVariantNumeric: 'tabular-nums' }}>更新时间：{typeof taskPayload.updatedAt === 'string' ? formatCheckedAt(taskPayload.updatedAt) : '—'}</span>
      </div>
      <div style={{ marginTop: 5, overflowWrap: 'anywhere', color: SM.fg3, fontFamily: SM.fontMono }}>{reply.taskId}</div>
      {taskPayload.result !== undefined && taskPayload.result !== null && <pre style={{ margin: '9px 0 0', padding: 9, maxHeight: 260, overflow: 'auto', whiteSpace: 'pre-wrap', borderRadius: 9, background: SM.panelSoft, color: SM.fg, fontFamily: SM.fontMono }}>
        {String(taskPayload.result)}{taskPayload.truncated ? '\n…结果已截断；完整结果保留在目标设备。' : ''}
      </pre>}
      {taskPayload.errorCode !== undefined && taskPayload.errorCode !== null && <div style={{ marginTop: 7, color: SM.bad, fontFamily: SM.fontMono }}>{String(taskPayload.errorCode)}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 9 }}>
        <button type="button" disabled={loading} onClick={onStatus} style={{ flex: 1, minHeight: 30, border: `1px solid ${SM.borderStrong}`, borderRadius: 9, background: SM.panel, color: SM.fg2 }}>刷新状态</button>
        {!terminal && <button type="button" disabled={loading} onClick={onCancel} style={{ flex: 1, minHeight: 30, border: 0, borderRadius: 9, background: SM.badSoft, color: SM.bad }}>请求取消</button>}
      </div>
    </div>}
    {reply !== null && approval !== null && <div data-dsh-fleet-task-approval style={{ marginTop: 10, padding: 11, borderRadius: 12, background: SM.warnSoft, border: `1px solid ${SM.warn}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <Dot color={SM.warn} />
        <strong style={{ flex: 1 }}>目标机请求一次工具批准</strong>
        <span style={{ color: Date.parse(approval.expiresAt) <= Date.now() ? SM.bad : SM.fg3 }}>截止 {formatCheckedAt(approval.expiresAt)}</span>
      </div>
      <div style={{ marginTop: 7, color: SM.fg2 }}>目标 {targetDeviceId} · {approval.capability} · <span style={{ fontFamily: SM.fontMono }}>{approval.toolName}</span></div>
      <div style={{ marginTop: 5, color: SM.fg2 }}>{approval.summary}</div>
      <pre style={{ margin: '8px 0 0', padding: 9, maxHeight: 260, overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', borderRadius: 9, background: SM.panel, color: SM.fg, fontFamily: SM.fontMono }}>
        {JSON.stringify(approval.arguments, null, 2)}
      </pre>
      <div title={approval.argumentsDigest} style={{ marginTop: 6, overflowWrap: 'anywhere', color: SM.fg3, fontFamily: SM.fontMono, fontSize: 10.5 }}>参数 SHA-256 {approval.argumentsDigest}</div>
      <div style={{ marginTop: 6, color: SM.fg3 }}>批准只对这一个 task、tool call 和参数摘要有效，执行一次即消费；不会生成永久授权。</div>
      <div style={{ display: 'flex', gap: 8, marginTop: 9 }}>
        <button type="button" disabled={loading || Date.parse(approval.expiresAt) <= Date.now()} onClick={() => onApprovalDecision('allowed-once')} style={{ flex: 1, minHeight: 32, border: 0, borderRadius: 9, background: SM.warn, color: SM.panel, fontWeight: 600 }}>仅允许这一次</button>
        <button type="button" disabled={loading} onClick={() => onApprovalDecision('rejected')} style={{ flex: 1, minHeight: 32, border: 0, borderRadius: 9, background: SM.badSoft, color: SM.bad, fontWeight: 600 }}>拒绝</button>
      </div>
    </div>}
    {targetDeviceId !== '' && <div style={{ marginTop: 10, padding: 11, borderRadius: 12, background: SM.panel }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <strong style={{ flex: 1 }}>最近任务</strong>
        <button type="button" disabled={catalogLoading} onClick={onRefreshCatalog} style={{ minHeight: 28, border: `1px solid ${SM.borderStrong}`, borderRadius: 8, background: SM.panel, color: SM.fg2 }}>
          {catalogLoading ? '读取中…' : '刷新'}
        </button>
        <button type="button" disabled={loading || catalogLoading || (catalog?.tasks.length ?? 0) === 0} onClick={pruneArmed ? onPrune : onArmPrune} title="只删除 30 天前已完成、失败或取消的任务；不会删除活动任务" style={{ minHeight: 28, border: 0, borderRadius: 8, background: pruneArmed ? SM.badSoft : SM.bg2, color: pruneArmed ? SM.bad : SM.fg2 }}>
          {pruneArmed ? `确认清理 ${targetDeviceId}` : '准备清理 30 天前终态'}
        </button>
      </div>
      <button type="button" disabled={loading || catalogLoading} onClick={onResume} style={{ width: '100%', minHeight: 29, marginBottom: 7, border: `1px solid ${SM.borderStrong}`, borderRadius: 8, background: SM.panel, color: SM.fg2 }}>
        检查并恢复未完成任务
      </button>
      <div style={{ marginBottom: 7, color: SM.fg3 }}>读取设备状态不会启动任务；只有点击上方按钮才会检查并恢复目标机上的未完成任务。</div>
      {pruneArmed && <div style={{ marginBottom: 7, padding: 7, borderRadius: 8, background: SM.badSoft, color: SM.bad }}>
        再次点击将永久删除 {targetDeviceId} 上 30 天前已完成、失败或取消的任务元数据；活动任务不会删除。切换目标或刷新目录会取消确认。
      </div>}
      {catalogNotice !== null && <div style={{ marginBottom: 7, color: SM.good }}>{catalogNotice}</div>}
      {catalogError !== null && <div style={{ marginBottom: 7, color: SM.bad, fontFamily: SM.fontMono }}>{catalogError}</div>}
      {catalog !== null && catalog.tasks.length === 0 && catalogError === null && <div style={{ color: SM.fg3 }}>该设备还没有可展示的持久任务记录。</div>}
      {catalog?.tasks.map(task => <div key={task.taskId} style={{ padding: '8px 0', borderTop: `1px solid ${SM.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <Dot color={taskStateColor(task.state)} />
          <strong style={{ color: taskStateColor(task.state) }}>{taskStateLabel(task.state)}</strong>
          <span style={{ marginLeft: 'auto', color: SM.fg3, fontVariantNumeric: 'tabular-nums' }}>更新时间：{formatCheckedAt(task.updatedAt)}</span>
        </div>
        <div style={{ marginTop: 4, overflowWrap: 'anywhere', fontFamily: SM.fontMono, fontSize: 10.5 }}>{task.taskId}</div>
        <div style={{ marginTop: 3, color: SM.fg3 }}>目标 {task.targetDeviceId} · Workspace {task.workspaceId} · Profile {task.profile}</div>
        {task.errorCode !== null && <div style={{ marginTop: 3, color: SM.bad, fontFamily: SM.fontMono }}>{task.errorCode}</div>}
        <button type="button" disabled={loading || taskId !== ''} onClick={() => onTrack(task)} style={{ width: '100%', minHeight: 27, marginTop: 6, border: `1px solid ${SM.borderStrong}`, borderRadius: 8, background: SM.panel, color: SM.fg2 }}>
          跟踪此任务
        </button>
      </div>)}
    </div>}
  </div>
}

function CollaborationView({
  items,
  loading,
  error,
  notice,
  retention,
  importJson,
  exportKind,
  recipientTeamId,
  recipientDeviceId,
  summary,
  taskId,
  artifactRefs,
  output,
  onImportJson,
  onExportKind,
  onRecipientTeamId,
  onRecipientDeviceId,
  onSummary,
  onTaskId,
  onArtifactRefs,
  onReload,
  onImport,
  onExport,
  onAcknowledge,
  onDecision,
  onRetentionPlan,
}: {
  items: FleetFederationInboxItem[] | null
  loading: boolean
  error: string | null
  notice: string | null
  retention: FederationRetentionPlan | null
  importJson: string
  exportKind: 'handoff' | 'approval.request'
  recipientTeamId: string
  recipientDeviceId: string
  summary: string
  taskId: string
  artifactRefs: string
  output: string
  onImportJson(value: string): void
  onExportKind(value: 'handoff' | 'approval.request'): void
  onRecipientTeamId(value: string): void
  onRecipientDeviceId(value: string): void
  onSummary(value: string): void
  onTaskId(value: string): void
  onArtifactRefs(value: string): void
  onReload(): void
  onImport(): void
  onExport(): void
  onAcknowledge(item: FleetFederationInboxItem, disposition: 'acknowledged' | 'dismissed'): void
  onDecision(item: FleetFederationInboxItem, decision: 'endorsed' | 'declined'): void
  onRetentionPlan(): void
}): React.ReactElement {
  const exportReady = FEDERATION_IDENTIFIER_PATTERN.test(recipientTeamId) && FEDERATION_IDENTIFIER_PATTERN.test(recipientDeviceId) &&
    summary.trim().length > 0 && (exportKind === 'handoff' ? taskId === '' || isTaskId(taskId) : isTaskId(taskId))
  return <div style={{ padding: '0 12px 12px' }}>
    <div style={{ marginBottom: 10, padding: '9px 10px', borderRadius: 10, background: SM.panelSoft, color: SM.fg2, lineHeight: 1.55 }}>
      跨团队协作只交换签名的交接与审批元数据。这里不连接 Relay，不执行任务，也不会自动打开 artifactRefs 中的 URL 或文件。
    </div>
    {error !== null && <div style={{ marginBottom: 10, padding: 9, borderRadius: 9, background: SM.badSoft, color: SM.bad, fontFamily: SM.fontMono }}>{error}</div>}
    {notice !== null && <div style={{ marginBottom: 10, padding: 9, borderRadius: 9, background: SM.goodSoft, color: SM.good }}>{notice}</div>}
    <div style={{ marginBottom: 10, padding: 11, borderRadius: 12, background: SM.panel }}>
      <div style={{ display: 'flex', gap: 7, alignItems: 'center', marginBottom: 8 }}>
        <strong style={{ flex: 1 }}>收件箱</strong>
        <button type="button" disabled={loading} onClick={onRetentionPlan} style={{ minHeight: 28, border: 0, borderRadius: 8, background: SM.bg2, color: SM.fg2 }}>保留计划</button>
        <button type="button" disabled={loading} onClick={onReload} style={{ minHeight: 28, border: 0, borderRadius: 8, background: SM.bg2, color: SM.fg2 }}>刷新</button>
      </div>
      {items === null && !loading && <div style={{ color: SM.fg3 }}>尚未读取协作收件箱。</div>}
      {items?.length === 0 && <div style={{ color: SM.fg3 }}>没有跨团队消息。</div>}
      {items?.map(item => {
        const envelope = item.record.envelope
        const payload = envelope.payload
        const acknowledged = item.acknowledgement !== null
        return <div key={envelope.messageId} style={{ marginTop: 8, padding: 9, border: `1px solid ${SM.border}`, borderRadius: 10, background: SM.panelSoft }}>
          <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
            <strong style={{ fontFamily: SM.fontMono }}>{envelope.teamId}/{envelope.sender.deviceId}</strong>
            <Pill>{envelope.kind}</Pill>
            {item.expired && <Pill tone="warn">已过期</Pill>}
            {item.acknowledgement !== null && <span style={{ marginLeft: 'auto', color: SM.fg3 }}>{item.acknowledgement.disposition === 'acknowledged' ? '已确认' : '已忽略'}</span>}
          </div>
          <div style={{ marginTop: 6, color: SM.fg2, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {typeof payload.summary === 'string' ? payload.summary : envelope.kind === 'receipt' ? `Receipt · ${String(payload.requestMessageId)}` : String(payload.decision ?? envelope.kind)}
          </div>
          {envelope.kind === 'handoff' && Array.isArray(payload.artifactRefs) && payload.artifactRefs.length > 0 && <div style={{ marginTop: 6 }}>
            <div style={{ color: SM.fg3 }}>artifactRefs（纯文本）</div>
            {payload.artifactRefs.map((ref, index) => <div key={index} style={{ marginTop: 2, overflowWrap: 'anywhere', fontFamily: SM.fontMono, color: SM.fg2 }}>{String(ref)}</div>)}
          </div>}
          <div style={{ display: 'flex', gap: 7, marginTop: 8 }}>
            <button type="button" disabled={loading || acknowledged} onClick={() => onAcknowledge(item, 'acknowledged')} style={{ minHeight: 28, border: 0, borderRadius: 8, background: SM.goodSoft, color: SM.good }}>确认</button>
            <button type="button" disabled={loading || acknowledged} onClick={() => onAcknowledge(item, 'dismissed')} style={{ minHeight: 28, border: 0, borderRadius: 8, background: SM.bg2, color: SM.fg2 }}>忽略</button>
            {envelope.kind === 'approval.request' && !item.expired && <>
              <button type="button" disabled={loading} onClick={() => onDecision(item, 'endorsed')} style={{ marginLeft: 'auto', minHeight: 28, border: 0, borderRadius: 8, background: SM.infoSoft, color: SM.info }}>背书并导出</button>
              <button type="button" disabled={loading} onClick={() => onDecision(item, 'declined')} style={{ minHeight: 28, border: 0, borderRadius: 8, background: SM.badSoft, color: SM.bad }}>拒绝并导出</button>
            </>}
          </div>
        </div>
      })}
      {retention !== null && <div style={{ marginTop: 9, padding: 8, borderRadius: 9, background: SM.warnSoft, color: SM.warn }}>
        保留计划仅预览：{retention.candidates.length} 条候选，不会自动删除。
        {retention.candidates.map(candidate => <div key={candidate.messageId} style={{ marginTop: 3, fontFamily: SM.fontMono }}>{candidate.messageId} · {candidate.reason}</div>)}
      </div>}
    </div>
    <div style={{ marginBottom: 10, padding: 11, borderRadius: 12, background: SM.panel }}>
      <strong>导入签名 Envelope</strong>
      <textarea aria-label="导入 Envelope JSON" value={importJson} disabled={loading} maxLength={64 * 1024} onChange={event => onImportJson(event.currentTarget.value)} rows={5} placeholder="粘贴收到的 JSON" style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', marginTop: 8, padding: 8, border: `1px solid ${SM.borderStrong}`, borderRadius: 9, fontFamily: SM.fontMono }} />
      <button type="button" disabled={loading || importJson.trim() === ''} onClick={onImport} style={{ width: '100%', minHeight: 30, marginTop: 7, border: 0, borderRadius: 9, background: SM.infoSoft, color: SM.info }}>验证并导入</button>
    </div>
    <div style={{ padding: 11, borderRadius: 12, background: SM.panel }}>
      <strong>创建导出 Envelope</strong>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
        <label style={{ display: 'grid', gap: 4, color: SM.fg2 }}><span>类型</span><select value={exportKind} disabled={loading} onChange={event => onExportKind(event.currentTarget.value as 'handoff' | 'approval.request')}><option value="handoff">交接</option><option value="approval.request">审批请求</option></select></label>
        <label style={{ display: 'grid', gap: 4, color: SM.fg2 }}><span>对方 Team</span><input value={recipientTeamId} disabled={loading} maxLength={64} onChange={event => onRecipientTeamId(event.currentTarget.value)} /></label>
        <label style={{ display: 'grid', gap: 4, color: SM.fg2 }}><span>对方 Device</span><input value={recipientDeviceId} disabled={loading} maxLength={64} onChange={event => onRecipientDeviceId(event.currentTarget.value)} /></label>
        <label style={{ display: 'grid', gap: 4, color: SM.fg2 }}><span>Task ID{exportKind === 'handoff' ? '（可选）' : ''}</span><input value={taskId} disabled={loading} maxLength={64} onChange={event => onTaskId(event.currentTarget.value)} /></label>
      </div>
      <label style={{ display: 'grid', gap: 4, marginTop: 8, color: SM.fg2 }}><span>摘要</span><textarea value={summary} disabled={loading} onChange={event => onSummary(event.currentTarget.value)} rows={3} maxLength={exportKind === 'handoff' ? 8192 : 2048} /></label>
      {exportKind === 'handoff' && <label style={{ display: 'grid', gap: 4, marginTop: 8, color: SM.fg2 }}><span>artifactRefs（每行一个，只作为文本）</span><textarea value={artifactRefs} disabled={loading} maxLength={16 * 1024} onChange={event => onArtifactRefs(event.currentTarget.value)} rows={3} /></label>}
      <button type="button" disabled={loading || !exportReady} onClick={onExport} style={{ width: '100%', minHeight: 30, marginTop: 8, border: 0, borderRadius: 9, background: SM.infoSoft, color: SM.info }}>生成签名 Envelope</button>
      {output !== '' && <label style={{ display: 'grid', gap: 4, marginTop: 9, color: SM.fg2 }}><span>复制下面的 JSON</span><textarea aria-label="导出 Envelope JSON" readOnly value={output} rows={8} style={{ resize: 'vertical', fontFamily: SM.fontMono }} /></label>}
    </div>
  </div>
}

export function FleetSettings({ ctx }: { ctx: ClientContextLike }): React.ReactElement {
  const [initialTaskReference] = useState<StoredTaskReference | null>(() => readStoredTaskReference())
  const [tab, setTab] = useState<'status' | 'updates' | 'operations' | 'tasks' | 'federation'>('status')
  const [status, setStatus] = useState<FleetStatus | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [statusLoading, setStatusLoading] = useState(false)
  const [updates, setUpdates] = useState<FleetUpdates | null>(null)
  const [updateError, setUpdateError] = useState<string | null>(null)
  const [updateLoading, setUpdateLoading] = useState(false)
  const [agentTargets, setAgentTargets] = useState<AgentTargetsView | null>(null)
  const [agentPlan, setAgentPlan] = useState<FleetPlan | FleetReleasePlan | null>(null)
  const [agentAction, setAgentAction] = useState<AgentActionRecord | ReleaseActionRecord | null>(null)
  const [rollbackPlan, setRollbackPlan] = useState<FleetReleaseRollbackPlan | null>(null)
  const [rollbackAction, setRollbackAction] = useState<ReleaseRollbackActionRecord | null>(null)
  const [releaseRetentionPlan, setReleaseRetentionPlan] = useState<FleetReleaseRetentionPlan | null>(null)
  const [releaseRetentionAction, setReleaseRetentionAction] = useState<ReleaseRetentionActionRecord | null>(null)
  const [agentError, setAgentError] = useState<string | null>(null)
  const [agentLoading, setAgentLoading] = useState(false)
  const [approvalArmed, setApprovalArmed] = useState(false)
  const [rollbackArmed, setRollbackArmed] = useState(false)
  const [releaseRetentionArmed, setReleaseRetentionArmed] = useState(false)
  const [taskTarget, setTaskTarget] = useState(initialTaskReference?.targetDeviceId ?? '')
  const [taskWorkspace, setTaskWorkspace] = useState('')
  const [taskProfile, setTaskProfile] = useState('')
  const [taskPolicy, setTaskPolicy] = useState('')
  const [taskPrompt, setTaskPrompt] = useState('')
  const [taskId, setTaskId] = useState(initialTaskReference?.taskId ?? '')
  const [taskReply, setTaskReply] = useState<FleetTaskReply | null>(null)
  const [taskError, setTaskError] = useState<string | null>(null)
  const [taskLoading, setTaskLoading] = useState(false)
  const [taskCatalog, setTaskCatalog] = useState<FleetTaskCatalog | null>(null)
  const [taskCatalogTarget, setTaskCatalogTarget] = useState('')
  const [taskCatalogError, setTaskCatalogError] = useState<string | null>(null)
  const [taskCatalogNotice, setTaskCatalogNotice] = useState<string | null>(null)
  const [taskCatalogLoading, setTaskCatalogLoading] = useState(false)
  const [taskPruneArmed, setTaskPruneArmed] = useState(false)
  const [federationItems, setFederationItems] = useState<FleetFederationInboxItem[] | null>(null)
  const [federationLoading, setFederationLoading] = useState(false)
  const [federationError, setFederationError] = useState<string | null>(null)
  const [federationNotice, setFederationNotice] = useState<string | null>(null)
  const [federationRetention, setFederationRetention] = useState<FederationRetentionPlan | null>(null)
  const [federationImportJson, setFederationImportJson] = useState('')
  const [federationExportKind, setFederationExportKind] = useState<'handoff' | 'approval.request'>('handoff')
  const [federationRecipientTeam, setFederationRecipientTeam] = useState('')
  const [federationRecipientDevice, setFederationRecipientDevice] = useState('')
  const [federationSummary, setFederationSummary] = useState('')
  const [federationTaskId, setFederationTaskId] = useState('')
  const [federationArtifactRefs, setFederationArtifactRefs] = useState('')
  const [federationOutput, setFederationOutput] = useState('')
  const statusInFlight = useRef<Promise<void> | null>(null)
  const updatesInFlight = useRef<Promise<void> | null>(null)
  const agentsInFlight = useRef<Promise<void> | null>(null)
  const agentMutationInFlight = useRef(false)
  const taskMutationInFlight = useRef(false)
  const taskCatalogInFlight = useRef<{ targetDeviceId: string; promise: Promise<void> } | null>(null)
  const taskCatalogMutationInFlight = useRef(false)
  const taskCatalogEpoch = useRef(0)
  const taskPollFailures = useRef(0)
  const taskEpoch = useRef(0)
  const restoredTaskChecked = useRef(false)
  const federationInFlight = useRef<Promise<void> | null>(null)
  const federationMutationInFlight = useRef(false)
  const federationEpoch = useRef(0)

  const loadStatus = useCallback(async () => {
    if (statusInFlight.current !== null) return statusInFlight.current
    const request = (async () => {
      setStatusLoading(true)
      try {
        const result = await ctx.connection.rpc.call(CHANNEL, 'status', null)
        setStatus(rpcValue(result, isFleetStatus, 'fleet status unavailable'))
        setStatusError(null)
      } catch (cause: unknown) {
        setStatusError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        setStatusLoading(false)
      }
    })()
    statusInFlight.current = request
    try {
      await request
    } finally {
      statusInFlight.current = null
    }
  }, [ctx])

  const loadUpdates = useCallback(async (mode: 'if-stale' | 'force' = 'if-stale') => {
    if (updatesInFlight.current !== null) return updatesInFlight.current
    const request = (async () => {
      setUpdateLoading(true)
      try {
        const result = await ctx.connection.rpc.call(CHANNEL, 'updates', { mode })
        setUpdates(rpcValue(result, isFleetUpdates, 'update check unavailable'))
        setUpdateError(null)
      } catch (cause: unknown) {
        setUpdateError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        setUpdateLoading(false)
      }
    })()
    updatesInFlight.current = request
    try {
      await request
    } finally {
      updatesInFlight.current = null
    }
  }, [ctx])

  const loadAgentTargets = useCallback(async () => {
    if (agentsInFlight.current !== null) return agentsInFlight.current
    const request = (async () => {
      setAgentLoading(true)
      try {
        const result = await ctx.connection.rpc.call(AGENT_CHANNEL, 'targets', null)
        setAgentTargets(rpcValue(result, isAgentTargets, 'fleet targets unavailable'))
        setAgentError(null)
      } catch (cause: unknown) {
        setAgentError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        setAgentLoading(false)
      }
    })()
    agentsInFlight.current = request
    try {
      await request
    } finally {
      agentsInFlight.current = null
    }
  }, [ctx])

  const loadFederationInbox = useCallback(async () => {
    if (federationInFlight.current !== null) return federationInFlight.current
    const requestEpoch = ++federationEpoch.current
    const request = (async () => {
      setFederationLoading(true)
      try {
        const result = await ctx.connection.rpc.call(AGENT_CHANNEL, 'federation-list', { limit: 50 })
        const items = rpcValue(result, isFederationInbox, 'federation inbox unavailable')
        if (federationEpoch.current !== requestEpoch) return
        setFederationItems(items)
        setFederationError(null)
      } catch (cause: unknown) {
        if (federationEpoch.current !== requestEpoch) return
        setFederationError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        if (federationEpoch.current === requestEpoch) setFederationLoading(false)
      }
    })()
    federationInFlight.current = request
    try {
      await request
    } finally {
      if (federationInFlight.current === request) federationInFlight.current = null
    }
  }, [ctx])

  const loadTaskCatalog = useCallback(async (targetDeviceId: string, force = false) => {
    if (targetDeviceId === '') return
    const existing = taskCatalogInFlight.current
    if (!force && existing !== null && existing.targetDeviceId === targetDeviceId) return existing.promise
    if (force) taskCatalogEpoch.current += 1
    const requestEpoch = taskCatalogEpoch.current
    setTaskPruneArmed(false)
    setTaskCatalogLoading(true)
    setTaskCatalogError(null)
    const request = (async () => {
      try {
        const result = await ctx.connection.rpc.call(AGENT_CHANNEL, 'tasks-list', { targetDeviceId, limit: 20 })
        const nextCatalog = rpcValue(result, isFleetTaskCatalog, 'fleet task catalog unavailable')
        if (nextCatalog.tasks.some(task => task.targetDeviceId !== targetDeviceId)) {
          throw new Error('fleet task catalog contains another target')
        }
        if (taskCatalogEpoch.current !== requestEpoch) return
        setTaskCatalog(nextCatalog)
        setTaskCatalogTarget(targetDeviceId)
        setTaskCatalogError(null)
      } catch (cause: unknown) {
        if (taskCatalogEpoch.current !== requestEpoch) return
        setTaskCatalog(null)
        setTaskCatalogTarget(targetDeviceId)
        setTaskCatalogError(cause instanceof Error ? cause.message : String(cause))
      }
    })()
    const entry = { targetDeviceId, promise: request }
    taskCatalogInFlight.current = entry
    try {
      await request
    } finally {
      if (taskCatalogInFlight.current === entry) taskCatalogInFlight.current = null
      if (taskCatalogEpoch.current === requestEpoch) setTaskCatalogLoading(false)
    }
  }, [ctx])

  const pruneTaskCatalog = useCallback(async () => {
    if (taskTarget === '' || taskMutationInFlight.current || taskCatalogMutationInFlight.current || taskCatalogInFlight.current !== null) return
    taskCatalogMutationInFlight.current = true
    setTaskPruneArmed(false)
    const requestTarget = taskTarget
    const requestEpoch = taskCatalogEpoch.current
    let refresh = false
    setTaskCatalogLoading(true)
    setTaskCatalogError(null)
    setTaskCatalogNotice(null)
    try {
      const olderThan = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      const result = await ctx.connection.rpc.call(AGENT_CHANNEL, 'tasks-prune', {
        targetDeviceId: requestTarget,
        olderThan,
        states: ['succeeded', 'failed', 'cancelled'],
      })
      const outcome = rpcValue(result, isFleetTaskPruneResult, 'fleet task prune result unavailable')
      if (taskCatalogEpoch.current !== requestEpoch) return
      setTaskCatalogNotice(`已清理 ${outcome.pruned} 个终态任务；跳过 ${outcome.skippedActive} 个活动任务。`)
      refresh = true
    } catch (cause: unknown) {
      if (taskCatalogEpoch.current !== requestEpoch) return
      setTaskCatalogError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      taskCatalogMutationInFlight.current = false
      if (taskCatalogEpoch.current === requestEpoch) setTaskCatalogLoading(false)
    }
    if (refresh && taskCatalogEpoch.current === requestEpoch) await loadTaskCatalog(requestTarget, true)
  }, [ctx, loadTaskCatalog, taskTarget])

  const resumeTasks = useCallback(async () => {
    if (taskTarget === '' || taskMutationInFlight.current || taskCatalogMutationInFlight.current) return
    taskCatalogMutationInFlight.current = true
    setTaskPruneArmed(false)
    const requestTarget = taskTarget
    const requestEpoch = taskCatalogEpoch.current
    let refresh = false
    setTaskCatalogLoading(true)
    setTaskCatalogError(null)
    setTaskCatalogNotice(null)
    try {
      const result = await ctx.connection.rpc.call(AGENT_CHANNEL, 'tasks-resume', { targetDeviceId: requestTarget })
      const outcome = rpcValue(result, isFleetTaskResumeResult, 'fleet task resume result unavailable')
      if (taskCatalogEpoch.current !== requestEpoch) return
      setTaskCatalogNotice(`已检查目标机；恢复 ${outcome.resumed} 个未完成任务。`)
      refresh = true
    } catch (cause: unknown) {
      if (taskCatalogEpoch.current !== requestEpoch) return
      setTaskCatalogError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      taskCatalogMutationInFlight.current = false
      if (taskCatalogEpoch.current === requestEpoch) setTaskCatalogLoading(false)
    }
    if (refresh && taskCatalogEpoch.current === requestEpoch) await loadTaskCatalog(requestTarget, true)
  }, [ctx, loadTaskCatalog, taskTarget])

  const requestPlan = useCallback(async (deviceId: string, pluginId?: string) => {
    if (agentMutationInFlight.current) return
    agentMutationInFlight.current = true
    setAgentLoading(true)
    setAgentPlan(null)
    setAgentAction(null)
    setRollbackPlan(null)
    setRollbackAction(null)
    setReleaseRetentionPlan(null)
    setReleaseRetentionAction(null)
    setApprovalArmed(false)
    setRollbackArmed(false)
    setReleaseRetentionArmed(false)
    try {
      const releaseMode = pluginId === undefined
      const result = await ctx.connection.rpc.call(
        AGENT_CHANNEL,
        releaseMode ? 'release-plan' : 'plan',
        releaseMode ? { deviceId } : { deviceId, pluginId },
      )
      setAgentPlan(releaseMode
        ? rpcValue(result, isFleetReleasePlan, 'fleet release plan unavailable')
        : rpcValue(result, isFleetPlan, 'fleet plan unavailable'))
      setAgentError(null)
    } catch (cause: unknown) {
      setAgentError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      agentMutationInFlight.current = false
      setAgentLoading(false)
    }
  }, [ctx])

  const approvePlan = useCallback(async () => {
    if (agentPlan === null || !approvalArmed || agentMutationInFlight.current) return
    agentMutationInFlight.current = true
    const approvedPlan = agentPlan
    const releaseMode = 'kind' in approvedPlan
    setAgentLoading(true)
    setApprovalArmed(false)
    setRollbackPlan(null)
    setRollbackAction(null)
    setRollbackArmed(false)
    setReleaseRetentionPlan(null)
    setReleaseRetentionAction(null)
    setReleaseRetentionArmed(false)
    try {
      const result = await ctx.connection.rpc.call(AGENT_CHANNEL, releaseMode ? 'release-approve' : 'approve', {
        approvalId: crypto.randomUUID(),
        deviceId: approvedPlan.deviceId,
        planDigest: approvedPlan.digest,
        planExpiresAt: approvedPlan.expiresAt,
        planId: approvedPlan.planId,
        profile: approvedPlan.profile,
        ...(releaseMode ? {
          fromManifestDigest: approvedPlan.fromManifestDigest,
          toManifestDigest: approvedPlan.toManifestDigest,
          fromReleaseDigest: approvedPlan.fromReleaseDigest,
          toReleaseDigest: approvedPlan.toReleaseDigest,
        } : {}),
      })
      setAgentAction(rpcValue(result, isAgentAction, 'fleet action result unavailable'))
      setAgentPlan(null)
      setAgentError(null)
      void loadAgentTargets()
    } catch (cause: unknown) {
      const applyError = cause instanceof Error ? cause.message : String(cause)
      try {
        const status = await ctx.connection.rpc.call(AGENT_CHANNEL, releaseMode ? 'release-action-status' : 'action-status', {
          deviceId: approvedPlan.deviceId,
          planId: approvedPlan.planId,
        })
        setAgentAction(rpcValue(status, isAgentAction, 'fleet action status unavailable'))
        setAgentPlan(null)
        setAgentError(null)
        void loadAgentTargets()
      } catch {
        setAgentError(applyError)
      }
    } finally {
      agentMutationInFlight.current = false
      setAgentLoading(false)
    }
  }, [agentPlan, approvalArmed, ctx, loadAgentTargets])

  const requestRollbackPlan = useCallback(async (deviceId: string, transitionPlanId: string) => {
    if (agentMutationInFlight.current) return
    agentMutationInFlight.current = true
    setAgentLoading(true)
    setRollbackPlan(null)
    setRollbackAction(null)
    setRollbackArmed(false)
    setReleaseRetentionPlan(null)
    setReleaseRetentionAction(null)
    setReleaseRetentionArmed(false)
    try {
      const result = await ctx.connection.rpc.call(AGENT_CHANNEL, 'release-rollback-plan', { deviceId, transitionPlanId })
      const next = rpcValue(result, isFleetReleaseRollbackPlan, 'fleet release rollback plan unavailable')
      if (next.deviceId !== deviceId || next.transitionPlanId !== transitionPlanId) {
        throw new Error('fleet release rollback plan does not match the requested transition')
      }
      setRollbackPlan(next)
      setAgentError(null)
    } catch (cause: unknown) {
      setAgentError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      agentMutationInFlight.current = false
      setAgentLoading(false)
    }
  }, [ctx])

  const approveRollbackPlan = useCallback(async () => {
    if (rollbackPlan === null || !rollbackArmed || agentMutationInFlight.current) return
    agentMutationInFlight.current = true
    const approvedPlan = rollbackPlan
    setAgentLoading(true)
    setRollbackArmed(false)
    try {
      const result = await ctx.connection.rpc.call(AGENT_CHANNEL, 'release-rollback-approve', {
        approvalId: crypto.randomUUID(),
        deviceId: approvedPlan.deviceId,
        fromManifestDigest: approvedPlan.fromManifestDigest,
        fromReleaseDigest: approvedPlan.fromReleaseDigest,
        planDigest: approvedPlan.digest,
        planExpiresAt: approvedPlan.expiresAt,
        planId: approvedPlan.planId,
        profile: approvedPlan.profile,
        toManifestDigest: approvedPlan.toManifestDigest,
        toReleaseDigest: approvedPlan.toReleaseDigest,
        transitionPlanId: approvedPlan.transitionPlanId,
      })
      const action = rpcValue(result, isReleaseRollbackAction, 'fleet release rollback result unavailable')
      if (action.planId !== approvedPlan.planId || action.transitionPlanId !== approvedPlan.transitionPlanId) {
        throw new Error('fleet release rollback result does not match the approved plan')
      }
      setRollbackAction(action)
      setRollbackPlan(null)
      setAgentError(null)
      void loadAgentTargets()
    } catch (cause: unknown) {
      const applyError = cause instanceof Error ? cause.message : String(cause)
      try {
        const status = await ctx.connection.rpc.call(AGENT_CHANNEL, 'release-rollback-action-status', {
          deviceId: approvedPlan.deviceId,
          planId: approvedPlan.planId,
        })
        const action = rpcValue(status, isReleaseRollbackAction, 'fleet release rollback status unavailable')
        if (action.planId !== approvedPlan.planId || action.transitionPlanId !== approvedPlan.transitionPlanId) {
          throw new Error('fleet release rollback status does not match the approved plan')
        }
        setRollbackAction(action)
        setRollbackPlan(null)
        setAgentError(null)
        void loadAgentTargets()
      } catch {
        setAgentError(applyError)
      }
    } finally {
      agentMutationInFlight.current = false
      setAgentLoading(false)
    }
  }, [ctx, loadAgentTargets, rollbackArmed, rollbackPlan])

  const requestReleaseRetentionPlan = useCallback(async (deviceId: string) => {
    if (agentMutationInFlight.current) return
    agentMutationInFlight.current = true
    setAgentLoading(true)
    setAgentPlan(null)
    setAgentAction(null)
    setRollbackPlan(null)
    setRollbackAction(null)
    setApprovalArmed(false)
    setRollbackArmed(false)
    setReleaseRetentionPlan(null)
    setReleaseRetentionAction(null)
    setReleaseRetentionArmed(false)
    try {
      const result = await ctx.connection.rpc.call(AGENT_CHANNEL, 'release-retention-plan', { deviceId })
      const next = rpcValue(result, isFleetReleaseRetentionPlan, 'fleet release retention plan unavailable')
      if (next.deviceId !== deviceId || Date.parse(next.expiresAt) <= Date.now()) {
        throw new Error('fleet release retention plan does not match the requested target or is expired')
      }
      setReleaseRetentionPlan(next)
      setAgentError(null)
    } catch (cause: unknown) {
      setAgentError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      agentMutationInFlight.current = false
      setAgentLoading(false)
    }
  }, [ctx])

  const approveReleaseRetentionPlan = useCallback(async () => {
    if (releaseRetentionPlan === null || !releaseRetentionArmed || agentMutationInFlight.current) return
    agentMutationInFlight.current = true
    const approvedPlan = releaseRetentionPlan
    const approvalId = crypto.randomUUID()
    setAgentLoading(true)
    setReleaseRetentionArmed(false)
    try {
      const result = await ctx.connection.rpc.call(AGENT_CHANNEL, 'release-retention-approve', {
        approvalId,
        deviceId: approvedPlan.deviceId,
        planDigest: approvedPlan.digest,
        planExpiresAt: approvedPlan.expiresAt,
        planId: approvedPlan.planId,
        profile: approvedPlan.profile,
      })
      const action = rpcValue(result, isReleaseRetentionAction, 'fleet release retention result unavailable')
      if (action.planId !== approvedPlan.planId || action.planDigest !== approvedPlan.digest ||
          action.deviceId !== approvedPlan.deviceId || action.profile !== approvedPlan.profile || action.approvalId !== approvalId) {
        throw new Error('fleet release retention result does not match the approved plan')
      }
      setReleaseRetentionAction(action)
      setReleaseRetentionPlan(null)
      setAgentError(null)
      void loadAgentTargets()
    } catch (cause: unknown) {
      const applyError = cause instanceof Error ? cause.message : String(cause)
      try {
        const status = await ctx.connection.rpc.call(AGENT_CHANNEL, 'release-retention-action-status', {
          deviceId: approvedPlan.deviceId,
          planId: approvedPlan.planId,
        })
        const action = rpcValue(status, isReleaseRetentionAction, 'fleet release retention status unavailable')
        if (action.planId !== approvedPlan.planId || action.planDigest !== approvedPlan.digest ||
            action.deviceId !== approvedPlan.deviceId || action.profile !== approvedPlan.profile || action.approvalId !== approvalId) {
          throw new Error('fleet release retention status does not match the approved plan')
        }
        setReleaseRetentionAction(action)
        setReleaseRetentionPlan(null)
        setAgentError(null)
        void loadAgentTargets()
      } catch {
        setAgentError(applyError)
      }
    } finally {
      agentMutationInFlight.current = false
      setAgentLoading(false)
    }
  }, [ctx, loadAgentTargets, releaseRetentionArmed, releaseRetentionPlan])

  const taskCall = useCallback(async (
    endpoint: 'task-submit' | 'task-status' | 'task-cancel',
    override?: StoredTaskReference,
  ) => {
    const effectiveTarget = override?.targetDeviceId ?? taskTarget
    const effectiveTaskId = override?.taskId ?? taskId.trim()
    if (taskMutationInFlight.current || effectiveTarget === '') return
    if (endpoint === 'task-submit' && taskId !== '') {
      setTaskError('请先处理或清除当前任务引用')
      return
    }
    const requestTaskId = endpoint === 'task-submit' ? 'task:' + crypto.randomUUID() : effectiveTaskId
    if (!isTaskId(requestTaskId)) {
      setTaskError('请输入有效的 Task ID')
      return
    }
    const requestTarget = effectiveTarget
    const requestEpoch = endpoint === 'task-submit' ? ++taskEpoch.current : taskEpoch.current
    const reference = { targetDeviceId: requestTarget, taskId: requestTaskId }
    if (endpoint === 'task-submit') {
      setTaskId(requestTaskId)
      setTaskReply(null)
      setTaskCatalogNotice(null)
    }
    writeStoredTaskReference(reference)
    taskMutationInFlight.current = true
    setTaskLoading(true)
    try {
      const payload = endpoint === 'task-submit'
        ? { ...reference, workspaceId: taskWorkspace, profile: taskProfile, policyId: taskPolicy, prompt: taskPrompt.trim() }
        : reference
      const result = await ctx.connection.rpc.call(AGENT_CHANNEL, endpoint, payload)
      const nextReply = rpcValue(result, isFleetTaskReply, 'fleet task response unavailable')
      if (nextReply.taskId !== requestTaskId) throw new Error('fleet task response does not match the requested task')
      if (taskEpoch.current !== requestEpoch) return
      taskPollFailures.current = 0
      setTaskReply(nextReply)
      setTaskId(nextReply.taskId)
      setTaskError(null)
      const nextState = nextReply.response.kind === 'task.progress' || nextReply.response.kind === 'task.result'
        ? nextReply.response.payload.state
        : undefined
      if (endpoint !== 'task-status' || nextState === 'succeeded' || nextState === 'failed' || nextState === 'cancelled') {
        void loadTaskCatalog(requestTarget, true)
      }
    } catch (cause: unknown) {
      if (taskEpoch.current !== requestEpoch) return
      if (endpoint === 'task-status') taskPollFailures.current = Math.min(taskPollFailures.current + 1, 4)
      setTaskError(cause instanceof Error ? cause.message : String(cause))
      if (endpoint === 'task-submit') void loadTaskCatalog(requestTarget, true)
    } finally {
      taskMutationInFlight.current = false
      setTaskLoading(false)
    }
  }, [ctx, loadTaskCatalog, taskId, taskPolicy, taskProfile, taskPrompt, taskTarget, taskWorkspace])

  const decideTaskApproval = useCallback(async (decision: 'allowed-once' | 'rejected') => {
    if (taskMutationInFlight.current || taskReply?.response.kind !== 'task.approval.request' ||
        taskTarget === '' || !isTaskId(taskId)) return
    const request = taskReply.response
    const requestTarget = taskTarget
    const requestTaskId = taskId
    const requestEpoch = taskEpoch.current
    taskMutationInFlight.current = true
    setTaskLoading(true)
    let refresh = false
    try {
      const result = await ctx.connection.rpc.call(AGENT_CHANNEL, 'task-approval-decision', {
        targetDeviceId: requestTarget,
        taskId: requestTaskId,
        request,
        decision,
      })
      const receipt = rpcValue(result, isApprovalDecisionReply, 'fleet task approval receipt unavailable')
      if (receipt.taskId !== requestTaskId || taskEpoch.current !== requestEpoch || taskTarget !== requestTarget || taskId !== requestTaskId) return
      setTaskReply(null)
      setTaskError(null)
      refresh = true
    } catch (cause: unknown) {
      if (taskEpoch.current === requestEpoch) setTaskError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      taskMutationInFlight.current = false
      if (taskEpoch.current === requestEpoch) setTaskLoading(false)
    }
    if (refresh && taskEpoch.current === requestEpoch) {
      void taskCall('task-status', { targetDeviceId: requestTarget, taskId: requestTaskId })
    }
  }, [ctx, taskCall, taskId, taskReply, taskTarget])

  const acknowledgeFederation = useCallback(async (
    item: FleetFederationInboxItem,
    disposition: 'acknowledged' | 'dismissed',
  ) => {
    if (federationMutationInFlight.current || item.acknowledgement !== null) return
    federationMutationInFlight.current = true
    const requestEpoch = ++federationEpoch.current
    setFederationLoading(true)
    setFederationNotice(null)
    let refresh = false
    try {
      const envelope = item.record.envelope
      const result = await ctx.connection.rpc.call(AGENT_CHANNEL, 'ack', {
        disposition,
        messageId: envelope.messageId,
        payloadDigest: envelope.payloadDigest,
      })
      const ack = rpcValue(result, isFederationAcknowledgement, 'federation acknowledgement unavailable')
      if (ack.acknowledgement.messageId !== envelope.messageId || ack.acknowledgement.payloadDigest !== envelope.payloadDigest) {
        throw new Error('federation acknowledgement does not match the selected message')
      }
      if (federationEpoch.current !== requestEpoch) return
      setFederationNotice(disposition === 'acknowledged' ? '消息已确认；首次处置为最终结果。' : '消息已忽略；首次处置为最终结果。')
      setFederationError(null)
      refresh = true
    } catch (cause: unknown) {
      if (federationEpoch.current === requestEpoch) setFederationError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      federationMutationInFlight.current = false
      if (federationEpoch.current === requestEpoch) setFederationLoading(false)
    }
    if (refresh && federationEpoch.current === requestEpoch) await loadFederationInbox()
  }, [ctx, loadFederationInbox])

  const importFederation = useCallback(async () => {
    if (federationMutationInFlight.current) return
    let envelope: FleetA2AEnvelope
    try {
      const parsed: unknown = JSON.parse(federationImportJson)
      if (!isFederationEnvelope(parsed)) throw new Error('粘贴内容不是受支持的严格 Federation Envelope')
      envelope = parsed
    } catch (cause: unknown) {
      setFederationError(cause instanceof Error ? cause.message : String(cause))
      return
    }
    federationMutationInFlight.current = true
    const requestEpoch = ++federationEpoch.current
    setFederationLoading(true)
    setFederationNotice(null)
    let refresh = false
    try {
      const result = await ctx.connection.rpc.call(AGENT_CHANNEL, 'import', { envelope })
      const receipt = rpcValue(result, isFederationEnvelope, 'signed federation receipt unavailable')
      const expectedStatus = envelope.kind === 'handoff' ? 'stored' : 'accepted'
      if (receipt.kind !== 'receipt' || receipt.payload.requestMessageId !== envelope.messageId || receipt.payload.status !== expectedStatus) {
        throw new Error('signed federation receipt does not match the imported message')
      }
      if (federationEpoch.current !== requestEpoch) return
      setFederationOutput(JSON.stringify(receipt, null, 2))
      setFederationImportJson('')
      setFederationNotice(envelope.kind === 'handoff'
        ? '已验证并保存；下面仅返回签名 receipt。'
        : '已验证并接收；下面仅返回签名 receipt。')
      setFederationError(null)
      refresh = true
    } catch (cause: unknown) {
      if (federationEpoch.current === requestEpoch) setFederationError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      federationMutationInFlight.current = false
      if (federationEpoch.current === requestEpoch) setFederationLoading(false)
    }
    if (refresh && federationEpoch.current === requestEpoch) await loadFederationInbox()
  }, [ctx, federationImportJson, loadFederationInbox])

  const exportFederation = useCallback(async () => {
    if (federationMutationInFlight.current) return
    const recipientTeamId = federationRecipientTeam.trim()
    const recipientDeviceId = federationRecipientDevice.trim()
    const summary = federationSummary.trim()
    const requestTaskId = federationTaskId.trim()
    if (!FEDERATION_IDENTIFIER_PATTERN.test(recipientTeamId) || !FEDERATION_IDENTIFIER_PATTERN.test(recipientDeviceId) ||
        summary === '' || (federationExportKind === 'approval.request' ? !isTaskId(requestTaskId) : requestTaskId !== '' && !isTaskId(requestTaskId))) {
      setFederationError('请填写有效的对方 Team/Device、摘要和 Task ID')
      return
    }
    const refs = federationArtifactRefs.split(/\r?\n/).map(value => value.trim()).filter(Boolean)
    if (refs.length > 32 || refs.some(value => value.length > 512 || /[\r\n\0]/.test(value))) {
      setFederationError('artifactRefs 最多 32 行，每行不超过 512 字符')
      return
    }
    federationMutationInFlight.current = true
    const requestEpoch = ++federationEpoch.current
    setFederationLoading(true)
    setFederationNotice(null)
    try {
      const endpoint = federationExportKind === 'handoff' ? 'handoff-export' : 'approval-request-export'
      const payload = federationExportKind === 'handoff'
        ? {
            recipientTeamId,
            recipientDeviceId,
            handoffId: 'handoff:' + crypto.randomUUID(),
            taskId: requestTaskId === '' ? null : requestTaskId,
            summary,
            artifactRefs: refs,
          }
        : {
            recipientTeamId,
            recipientDeviceId,
            approvalId: 'approval:' + crypto.randomUUID(),
            taskId: requestTaskId,
            summary,
            expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
          }
      const result = await ctx.connection.rpc.call(AGENT_CHANNEL, endpoint, payload)
      const envelope = rpcValue(result, isFederationEnvelope, 'signed federation export unavailable')
      if (envelope.kind !== federationExportKind || envelope.recipient.teamId !== recipientTeamId ||
          envelope.recipient.deviceId !== recipientDeviceId) throw new Error('signed federation export does not match the form')
      if (federationEpoch.current !== requestEpoch) return
      setFederationOutput(JSON.stringify(envelope, null, 2))
      setFederationError(null)
      setFederationNotice('签名 Envelope 已生成；请人工复制给对方。')
    } catch (cause: unknown) {
      if (federationEpoch.current === requestEpoch) setFederationError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      federationMutationInFlight.current = false
      if (federationEpoch.current === requestEpoch) setFederationLoading(false)
    }
  }, [ctx, federationArtifactRefs, federationExportKind, federationRecipientDevice, federationRecipientTeam, federationSummary, federationTaskId])

  const decideFederationApproval = useCallback(async (
    item: FleetFederationInboxItem,
    decision: 'endorsed' | 'declined',
  ) => {
    if (federationMutationInFlight.current || item.record.envelope.kind !== 'approval.request' || item.expired) return
    federationMutationInFlight.current = true
    const requestEpoch = ++federationEpoch.current
    setFederationLoading(true)
    setFederationNotice(null)
    try {
      const result = await ctx.connection.rpc.call(AGENT_CHANNEL, 'approval-decision-export', {
        request: item.record.envelope,
        decision,
      })
      const envelope = rpcValue(result, isFederationEnvelope, 'signed federation approval decision unavailable')
      if (envelope.kind !== 'approval.decision' || envelope.recipient.teamId !== item.record.envelope.teamId ||
          envelope.recipient.deviceId !== item.record.envelope.sender.deviceId ||
          envelope.payload.approvalRequestMessageId !== item.record.envelope.messageId ||
          envelope.payload.approvalRequestPayloadDigest !== item.record.envelope.payloadDigest || envelope.payload.decision !== decision) {
        throw new Error('signed federation approval decision does not match the incoming request')
      }
      if (federationEpoch.current !== requestEpoch) return
      setFederationOutput(JSON.stringify(envelope, null, 2))
      setFederationError(null)
      setFederationNotice(decision === 'endorsed' ? '背书 Envelope 已生成；它不授予任务工具权限。' : '拒绝 Envelope 已生成。')
    } catch (cause: unknown) {
      if (federationEpoch.current === requestEpoch) setFederationError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      federationMutationInFlight.current = false
      if (federationEpoch.current === requestEpoch) setFederationLoading(false)
    }
  }, [ctx])

  const planFederationRetention = useCallback(async () => {
    if (federationMutationInFlight.current) return
    federationMutationInFlight.current = true
    const requestEpoch = ++federationEpoch.current
    setFederationLoading(true)
    setFederationNotice(null)
    try {
      const result = await ctx.connection.rpc.call(AGENT_CHANNEL, 'retention-plan', null)
      const plan = rpcValue(result, isFederationRetentionPlan, 'federation retention plan unavailable')
      if (federationEpoch.current !== requestEpoch) return
      setFederationRetention(plan)
      setFederationError(null)
      setFederationNotice('保留计划只读生成，没有删除任何消息。')
    } catch (cause: unknown) {
      if (federationEpoch.current === requestEpoch) setFederationError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      federationMutationInFlight.current = false
      if (federationEpoch.current === requestEpoch) setFederationLoading(false)
    }
  }, [ctx])

  useEffect(() => {
    void loadStatus()
    const timer = window.setInterval(() => { if (!document.hidden) void loadStatus() }, 30_000)
    return () => window.clearInterval(timer)
  }, [loadStatus])

  useEffect(() => {
    if (initialTaskReference === null || restoredTaskChecked.current) return
    restoredTaskChecked.current = true
    void taskCall('task-status')
  }, [initialTaskReference, taskCall])

  useEffect(() => {
    if (tab !== 'updates' || updates !== null || updateError !== null || updateLoading) return
    void loadUpdates('if-stale')
  }, [loadUpdates, tab, updateError, updateLoading, updates])

  useEffect(() => {
    if ((tab !== 'operations' && tab !== 'tasks') || agentTargets !== null || agentError !== null || agentLoading) return
    void loadAgentTargets()
  }, [agentError, agentLoading, agentTargets, loadAgentTargets, tab])

  useEffect(() => {
    if (tab !== 'federation' || federationItems !== null || federationError !== null || federationLoading) return
    void loadFederationInbox()
  }, [federationError, federationItems, federationLoading, loadFederationInbox, tab])

  useEffect(() => {
    if (tab === 'operations') return
    setApprovalArmed(false)
    setRollbackArmed(false)
    setReleaseRetentionArmed(false)
  }, [tab])

  useEffect(() => {
    if (agentTargets === null) return
    const available = agentTargets.targets.flatMap(target => {
      const inspection = target.inspection
      return target.online && inspection !== undefined && 'kind' in inspection && inspection.kind === 'profile-release'
        ? [{ deviceId: target.deviceId, tasks: inspection.tasks }]
        : []
    })
    const selected = taskTarget === ''
      ? available.find(target => target.tasks.enabled) ?? available[0]
      : available.find(target => target.deviceId === taskTarget)
    if (selected === undefined) return
    if (taskTarget !== selected.deviceId) {
      taskEpoch.current += 1
      taskCatalogEpoch.current += 1
      setTaskTarget(selected.deviceId)
      setTaskCatalog(null)
      setTaskCatalogTarget('')
      setTaskCatalogError(null)
      setTaskCatalogNotice(null)
      setTaskCatalogLoading(false)
      setTaskPruneArmed(false)
    }
    if (!selected.tasks.workspaceIds.includes(taskWorkspace)) setTaskWorkspace(selected.tasks.workspaceIds[0] ?? '')
    if (!selected.tasks.profiles.includes(taskProfile)) setTaskProfile(selected.tasks.profiles[0] ?? '')
    if (!selected.tasks.policies.some(policy => policy.policyId === taskPolicy)) {
      setTaskPolicy(selected.tasks.policies.find(policy => policy.policyId === 'readonly-v1')?.policyId ?? selected.tasks.policies[0]?.policyId ?? '')
    }
  }, [agentTargets, taskPolicy, taskProfile, taskTarget, taskWorkspace])

  useEffect(() => {
    if (tab !== 'tasks' || taskTarget === '' || taskCatalogTarget === taskTarget || taskCatalogLoading) return
    void loadTaskCatalog(taskTarget)
  }, [loadTaskCatalog, tab, taskCatalogLoading, taskCatalogTarget, taskTarget])

  useEffect(() => {
    const state = taskReply !== null && (taskReply.response.kind === 'task.progress' || taskReply.response.kind === 'task.result')
      ? taskReply.response.payload.state
      : undefined
    if (taskLoading || taskTarget === '' || !isTaskId(taskId) ||
        (state !== 'accepted' && state !== 'running' && state !== 'cancel-requested')) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const delay = Math.min(2_000 * (2 ** taskPollFailures.current), 30_000)
    const schedule = () => {
      timer = setTimeout(async () => {
        if (cancelled) return
        if (!document.hidden) await taskCall('task-status')
        if (!cancelled) schedule()
      }, delay)
    }
    schedule()
    return () => {
      cancelled = true
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [taskCall, taskError, taskId, taskLoading, taskReply, taskTarget])

  const driftIssues = useMemo(() => status === null
    ? 0
    : status.summary.missing + status.summary.drifted + status.summary.failed + status.summary.unmanaged,
  [status])
  const availableUpdates = updates?.snapshot?.summary.available ?? 0
  const updateFailures = updates?.snapshot?.summary.errors ?? 0
  const runtimeFailures = status?.runtime.failedModules.length ?? 0
  const tone = statusError !== null || status?.manifest.loaded === false || (status?.summary.failed ?? 0) > 0 || runtimeFailures > 0 || updateError !== null || updateFailures > 0 || agentError !== null || federationError !== null || agentAction?.state === 'manual-intervention' || rollbackAction?.state === 'manual-intervention'
    ? SM.bad
    : driftIssues > 0 || availableUpdates > 0 || updates?.stale === true
      ? SM.warn
      : status === null ? SM.fg3 : SM.good
  return <section aria-label="DSH Fleet" data-dsh-fleet-settings style={{
    width: '100%', height: '100%', maxWidth: 960, minWidth: 0, minHeight: 0,
    display: 'flex', boxSizing: 'border-box', overflow: 'hidden', fontFamily: SM.fontSans,
    fontSize: 12, color: SM.fg, border: `1px solid ${SM.border}`, borderRadius: 18, background: SM.bg,
  }}>
      <div data-dsh-fleet-panel style={{
      width: '100%', height: '100%', minWidth: 0, minHeight: 0, display: 'flex',
      flexDirection: 'column', overflow: 'hidden', background: SM.bg,
    }}>
      <div style={{ padding: '14px 16px 11px', background: SM.panel, borderBottom: `1px solid ${SM.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ display: 'grid', placeItems: 'center', color: SM.fg2 }}><FleetIcon /></span>
          <Dot color={tone} size={8} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <strong style={{ display: 'block', fontSize: 15 }}>DSH Fleet</strong>
            <span style={{ color: SM.fg3 }}>设备、Profile Release 与远程执行</span>
          </div>
          <button type="button" aria-label="刷新状态" title="刷新状态" onClick={() => void loadStatus()} disabled={statusLoading} style={{
            width: 30, height: 30, display: 'grid', placeItems: 'center', border: 0, borderRadius: 10,
            background: SM.panelSoft, color: statusLoading ? SM.fg3 : SM.fg2, cursor: statusLoading ? 'default' : 'pointer',
          }}><RefreshIcon /></button>
        </div>
        <div data-dsh-fleet-tabs role="tablist" aria-label="Fleet 视图" style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(48px, 100%), 1fr))',
          gap: 4, marginTop: 9, padding: 3, borderRadius: 12, background: SM.bg2,
        }}>
          {(['status', 'updates', 'operations', 'tasks', 'federation'] as const).map(key => <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)} style={{
            minWidth: 0, minHeight: 28, padding: '0 3px', border: 0, borderRadius: 9, background: tab === key ? SM.fg : 'transparent',
            color: tab === key ? SM.panel : SM.fg2, cursor: 'pointer', fontFamily: SM.fontSans, fontSize: 11,
            whiteSpace: 'normal', overflowWrap: 'anywhere',
          }}>{key === 'status' ? '状态' : key === 'updates' ? `更新${availableUpdates > 0 ? ` ${availableUpdates}` : ''}` : key === 'operations' ? '发布' : key === 'tasks' ? '任务' : '协作'}</button>)}
        </div>
      </div>
      <div data-dsh-fleet-scroll style={{
        flex: 1, minHeight: 0, paddingTop: 10, overflowY: 'auto', overscrollBehavior: 'contain', background: SM.bg,
      }}>
        {tab === 'status'
          ? <StatusView status={status} error={statusError} />
          : tab === 'updates'
            ? <UpdatesView updates={updates} loading={updateLoading} error={updateError} onRefresh={() => void loadUpdates('force')} />
            : tab === 'operations' ? <OperationsView
                targets={agentTargets}
                plan={agentPlan}
                action={agentAction}
                rollbackPlan={rollbackPlan}
                rollbackAction={rollbackAction}
                retentionPlan={releaseRetentionPlan}
                retentionAction={releaseRetentionAction}
                loading={agentLoading}
                error={agentError}
                armed={approvalArmed}
                rollbackArmed={rollbackArmed}
                retentionArmed={releaseRetentionArmed}
                onArm={setApprovalArmed}
                onRollbackArm={setRollbackArmed}
                onRetentionArm={setReleaseRetentionArmed}
                onReload={() => {
                  setApprovalArmed(false)
                  setRollbackArmed(false)
                  setReleaseRetentionArmed(false)
                  setRollbackPlan(null)
                  setReleaseRetentionPlan(null)
                  setAgentTargets(null)
                  setAgentError(null)
                  void loadAgentTargets()
                }}
                onPlan={(deviceId, pluginId) => void requestPlan(deviceId, pluginId)}
                onApprove={() => void approvePlan()}
                onRollbackPlan={(deviceId, transitionPlanId) => void requestRollbackPlan(deviceId, transitionPlanId)}
                onRollbackApprove={() => void approveRollbackPlan()}
                onRetentionPlan={deviceId => void requestReleaseRetentionPlan(deviceId)}
                onRetentionApprove={() => void approveReleaseRetentionPlan()}
              />
              : tab === 'tasks' ? <TasksView
                  targets={agentTargets}
                  targetDeviceId={taskTarget}
                  workspaceId={taskWorkspace}
                  profile={taskProfile}
                  policyId={taskPolicy}
                  prompt={taskPrompt}
                  taskId={taskId}
                  reply={taskReply}
                  catalog={taskCatalogTarget === taskTarget ? taskCatalog : null}
                  catalogLoading={taskCatalogLoading}
                  catalogError={taskCatalogTarget === taskTarget ? taskCatalogError : null}
                  catalogNotice={taskCatalogNotice}
                  pruneArmed={taskPruneArmed}
                  loading={taskLoading || agentLoading}
                  error={taskError ?? agentError}
                  onTarget={value => {
                    taskEpoch.current += 1
                    taskCatalogEpoch.current += 1
                    taskPollFailures.current = 0
                    setTaskTarget(value)
                    setTaskPolicy('')
                    setTaskReply(null)
                    setTaskId('')
                    setTaskError(null)
                    setTaskCatalog(null)
                    setTaskCatalogTarget('')
                    setTaskCatalogError(null)
                    setTaskCatalogNotice(null)
                    setTaskCatalogLoading(false)
                    setTaskPruneArmed(false)
                    clearStoredTaskReference()
                  }}
                  onWorkspace={setTaskWorkspace}
                  onProfile={setTaskProfile}
                  onPolicy={setTaskPolicy}
                  onPrompt={setTaskPrompt}
                  onTaskId={value => {
                    taskEpoch.current += 1
                    taskPollFailures.current = 0
                    setTaskId(value)
                    setTaskReply(null)
                    setTaskError(null)
                    clearStoredTaskReference()
                  }}
                  onClear={() => {
                    taskEpoch.current += 1
                    taskPollFailures.current = 0
                    setTaskId('')
                    setTaskReply(null)
                    setTaskError(null)
                    clearStoredTaskReference()
                  }}
                  onSubmit={() => void taskCall('task-submit')}
                  onStatus={() => void taskCall('task-status')}
                  onCancel={() => void taskCall('task-cancel')}
                  onApprovalDecision={decision => void decideTaskApproval(decision)}
                  onReloadTargets={() => {
                    taskCatalogEpoch.current += 1
                    setAgentTargets(null)
                    setAgentError(null)
                    setTaskCatalog(null)
                    setTaskCatalogTarget('')
                    setTaskCatalogError(null)
                    setTaskCatalogNotice(null)
                    setTaskCatalogLoading(false)
                    setTaskPruneArmed(false)
                    void loadAgentTargets()
                  }}
                  onRefreshCatalog={() => {
                    setTaskPruneArmed(false)
                    taskCatalogEpoch.current += 1
                    setTaskCatalogTarget('')
                    setTaskCatalogError(null)
                    setTaskCatalogNotice(null)
                    void loadTaskCatalog(taskTarget, true)
                  }}
                  onTrack={task => {
                    taskEpoch.current += 1
                    taskPollFailures.current = 0
                    const reference = { targetDeviceId: task.targetDeviceId, taskId: task.taskId }
                    setTaskTarget(reference.targetDeviceId)
                    setTaskId(reference.taskId)
                    setTaskReply(null)
                    setTaskError(null)
                    writeStoredTaskReference(reference)
                    void taskCall('task-status', reference)
                  }}
                  onResume={() => void resumeTasks()}
                  onArmPrune={() => setTaskPruneArmed(true)}
                  onPrune={() => void pruneTaskCatalog()}
                />
                : <CollaborationView
                    items={federationItems}
                    loading={federationLoading}
                    error={federationError}
                    notice={federationNotice}
                    retention={federationRetention}
                    importJson={federationImportJson}
                    exportKind={federationExportKind}
                    recipientTeamId={federationRecipientTeam}
                    recipientDeviceId={federationRecipientDevice}
                    summary={federationSummary}
                    taskId={federationTaskId}
                    artifactRefs={federationArtifactRefs}
                    output={federationOutput}
                    onImportJson={value => { setFederationImportJson(value); setFederationError(null) }}
                    onExportKind={value => { setFederationExportKind(value); setFederationOutput(''); setFederationError(null) }}
                    onRecipientTeamId={value => { setFederationRecipientTeam(value); setFederationOutput(''); setFederationError(null) }}
                    onRecipientDeviceId={value => { setFederationRecipientDevice(value); setFederationOutput(''); setFederationError(null) }}
                    onSummary={value => { setFederationSummary(value); setFederationOutput(''); setFederationError(null) }}
                    onTaskId={value => { setFederationTaskId(value); setFederationOutput(''); setFederationError(null) }}
                    onArtifactRefs={value => { setFederationArtifactRefs(value); setFederationOutput(''); setFederationError(null) }}
                    onReload={() => {
                      setFederationRetention(null)
                      setFederationNotice(null)
                      void loadFederationInbox()
                    }}
                    onImport={() => void importFederation()}
                    onExport={() => void exportFederation()}
                    onAcknowledge={(item, disposition) => void acknowledgeFederation(item, disposition)}
                    onDecision={(item, decision) => void decideFederationApproval(item, decision)}
                    onRetentionPlan={() => void planFederationRetention()}
                  />}
      </div>
    </div>
  </section>
}

export function FleetCard({ ctx }: { ctx: ClientContextLike; wide?: boolean }): React.ReactElement {
  return <FleetSettings ctx={ctx} />
}

export function apply(ctx: ClientContextLike): void {
  ctx.slots.inject('settings.section', () => ctx.slots.register(
    { name: 'settings.section', id: 'dsh-fleet', order: 65, label: 'Fleet' },
    () => <FleetSettings ctx={ctx} />,
  ))
}

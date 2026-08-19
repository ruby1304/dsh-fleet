import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { access, lstat } from 'node:fs/promises'
import { readA2ATrustStore, signA2AMessage } from '../a2a/runtime.ts'
import {
  assertA2AReadyConfig,
  assertReleaseReadyConfig,
  type A2AReadyFleetAgentConfig,
  type FleetAgentConfig,
  type ReleaseReadyFleetAgentConfig,
} from './config.ts'
import { inspectReleaseAgent, verifyReleaseAgentHealth, type ReleaseRetentionInspection } from './runtime.ts'

export interface FleetAgentDoctorReport {
  protocolVersion: 1
  ready: true
  deviceId: string
  profile: string
  releaseId: string
  releaseVersion: string
  healthVerified: true
  observedRuntimeDigest: string
  observedServiceDefinitionDigest: string | null
  teamId: string
  principalId: string
  identityKeyId: string
  trustedPeerCount: number
  trustedPeers: Array<{
    keyId: string
    principalId: string
    deviceId: string
    allowedKinds: string[]
  }>
  tasksEnabled: boolean
  workspaceIds: string[]
  taskProfiles: string[]
  retention: ReleaseRetentionInspection
  executableChecks: string[]
}

type DoctorReadyConfig = ReleaseReadyFleetAgentConfig & A2AReadyFleetAgentConfig

function assertDoctorReady(config: FleetAgentConfig): asserts config is DoctorReadyConfig {
  assertReleaseReadyConfig(config)
  assertA2AReadyConfig(config)
}

async function requireExecutable(path: string, id: string): Promise<string> {
  const info = await lstat(path)
  if (!info.isFile() && !info.isSymbolicLink()) throw new TypeError(id + ' executable path is not a file')
  await access(path, constants.X_OK)
  return id
}

async function requireRealDirectory(path: string, id: string): Promise<void> {
  const info = await lstat(path)
  if (info.isSymbolicLink() || !info.isDirectory()) throw new TypeError(id + ' must be a real directory')
}

export async function doctorAgent(
  config: FleetAgentConfig,
  now = new Date(),
  signal?: AbortSignal,
): Promise<FleetAgentDoctorReport> {
  assertDoctorReady(config)
  const executablePaths: Array<[string, string]> = [
    ['dsh', config.dshBinary],
    ['pnpm', config.pnpmBinary],
    ['tar', config.tarBinary],
  ]
  if (config.restart.kind === 'screen') {
    executablePaths.push(['screen', config.restart.screenBinary], ['lsof', config.restart.lsofBinary], ['ps', config.restart.psBinary])
  } else {
    executablePaths.push(['launchctl', config.restart.launchctlBinary], ['lsof', config.restart.lsofBinary], ['ps', config.restart.psBinary])
  }
  const executableChecks = await Promise.all(executablePaths.map(([id, path]) => requireExecutable(path, id)))
  await requireRealDirectory(config.artifactStore, 'artifactStore')
  for (const [workspaceId, path] of Object.entries(config.tasks.workspaces)) await requireRealDirectory(path, 'workspace ' + workspaceId)
  const trust = await readA2ATrustStore(config)
  const identityProbe = await signA2AMessage(config, config.deviceId, 'handoff', {
    handoffId: 'handoff:' + randomUUID(),
    taskId: null,
    summary: 'dsh-fleet doctor identity check',
    artifactRefs: [],
  }, now)
  const inspection = await inspectReleaseAgent(config, now, signal)
  await verifyReleaseAgentHealth(config, signal)
  return {
    protocolVersion: 1,
    ready: true,
    deviceId: config.deviceId,
    profile: config.profile,
    releaseId: inspection.assignedRelease.releaseId,
    releaseVersion: inspection.assignedRelease.releaseVersion,
    healthVerified: true,
    observedRuntimeDigest: inspection.observedRuntimeDigest,
    observedServiceDefinitionDigest: inspection.observedServiceDefinitionDigest,
    teamId: config.a2a.teamId,
    principalId: config.a2a.principalId,
    identityKeyId: identityProbe.sender.keyId,
    trustedPeerCount: trust.size,
    trustedPeers: [...trust.values()].map(entry => ({
      keyId: entry.keyId,
      principalId: entry.principalId,
      deviceId: entry.deviceId,
      allowedKinds: [...entry.allowedKinds],
    })).sort((left, right) => left.deviceId.localeCompare(right.deviceId) || left.keyId.localeCompare(right.keyId)),
    tasksEnabled: config.tasks.enabled,
    workspaceIds: Object.keys(config.tasks.workspaces).sort(),
    taskProfiles: [...config.tasks.profiles].sort(),
    retention: inspection.retention,
    executableChecks,
  }
}

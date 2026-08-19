import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { FleetAgentConfig } from '../src/agent/config.ts'
import {
  applyStoredReleaseRetentionPlan,
  computeProfileHash,
  createStoredReleaseRetentionPlan,
  readReleaseRetentionActionStatus,
} from '../src/agent/runtime.ts'
import {
  createFleetReleasePlan,
  type FleetAppliedRelease,
  type FleetReleasePlan,
  type FleetReleasePluginBinding,
} from '../src/agent/release-protocol.ts'
import { sha256Canonical } from '../src/agent/protocol.ts'
import {
  validateFleetReleaseRetentionApproval,
  type FleetReleaseRetentionApproval,
  type FleetReleaseRetentionPlan,
} from '../src/agent/release-retention.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

const plugin: FleetReleasePluginBinding = {
  pluginId: 'public-plugin',
  visibility: 'public',
  sourceKind: 'npm',
  exactSpec: '1.2.3',
  artifactDigest: null,
  packageVersion: '1.2.3',
  integrity: 'sha512-YWJjZA==',
  runtimeModules: ['public-plugin'],
}

function sha256(source: string): string {
  return createHash('sha256').update(source).digest('hex')
}

async function writeProfile(path: string, label: string): Promise<string> {
  const manifest = `schemaVersion: 1\nteam: { id: test-team }\ndevices:\n  worker: { assignedTo: owner, class: always-on-worker, channel: stable }\nplugins: []\n# ${label}\n`
  await mkdir(path, { recursive: true })
  await writeFile(join(path, 'package.json'), JSON.stringify({ name: label, private: true, dependencies: {} }, null, 2) + '\n')
  await writeFile(join(path, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n")
  await writeFile(join(path, 'pnpm-workspace.yaml'), 'packages: []\n')
  await writeFile(join(path, 'cordis.patch.yml'), '[]\n')
  await writeFile(join(path, 'cordis.yml'), `root: ${label}\n`)
  await writeFile(join(path, 'fleet.lock.yaml'), manifest)
  return manifest
}

async function fixture(): Promise<{ config: FleetAgentConfig; profilesRoot: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-fleet-retention-'))
  roots.push(root)
  const dshHome = join(root, 'dsh-home')
  const profilesRoot = join(dshHome, 'profiles')
  const profile = join(profilesRoot, 'web')
  const stateDir = join(root, 'state')
  const artifactStore = join(root, 'artifacts')
  await Promise.all([
    writeProfile(profile, 'live'),
    mkdir(join(stateDir, 'release-plans'), { recursive: true }),
    mkdir(join(stateDir, 'release-actions'), { recursive: true }),
    mkdir(join(stateDir, 'release-rollbacks'), { recursive: true }),
    mkdir(join(stateDir, 'releases'), { recursive: true }),
    mkdir(artifactStore, { recursive: true }),
  ])
  const config: FleetAgentConfig = {
    schemaVersion: 2,
    deviceId: 'worker',
    manifestPath: join(profile, 'fleet.lock.yaml'),
    desiredManifestPath: join(root, 'desired.yaml'),
    dshHome,
    dshBinary: '/bin/sh',
    pnpmBinary: '/bin/sh',
    profile: 'web',
    stateDir,
    planTtlMs: 300_000,
    artifactStore,
    tarBinary: '/bin/sh',
    restart: {
      kind: 'screen',
      screenBinary: '/bin/sh',
      lsofBinary: '/bin/sh',
      psBinary: '/bin/sh',
      ownerMarkers: ['fixture'],
      sessionName: 'fixture',
      host: '127.0.0.1',
      port: 3211,
      managedPorts: [3211],
    },
    health: { url: 'http://127.0.0.1:3211', timeoutMs: 3000, requireFleetRpc: true },
  }
  await writeFile(config.desiredManifestPath!, await readFile(config.manifestPath, 'utf8'))
  return { config, profilesRoot }
}

async function appendTransition(
  config: FleetAgentConfig,
  previous: FleetAppliedRelease | null,
  ordinal: number,
  markerOnly = false,
): Promise<{ plan: FleetReleasePlan; marker: FleetAppliedRelease; backupProfile: string | null }> {
  const createdAt = new Date(Date.UTC(2026, 7, 19, 0, ordinal, 0)).toISOString()
  const releaseId = `release-${ordinal}`
  const releaseVersion = `1.0.${ordinal}`
  const releaseDigest = sha256Canonical({ releaseId, releaseVersion, profile: 'web', plugins: [plugin] })
  let backupProfileHash = '0'.repeat(64)
  let fromManifestDigest = sha256(`marker-only-${ordinal}`)
  let temporaryBackup: string | null = null
  if (!markerOnly) {
    temporaryBackup = `retention-fixture-${ordinal}`
    const source = await writeProfile(join(config.dshHome, 'profiles', temporaryBackup), `backup-${ordinal}`)
    fromManifestDigest = sha256(source)
    backupProfileHash = await computeProfileHash({ ...config, profile: temporaryBackup })
  }
  const toManifestDigest = markerOnly ? fromManifestDigest : sha256(`release-manifest-${ordinal}`)
  const plan = createFleetReleasePlan({
    protocolVersion: 2,
    kind: 'profile-release',
    deviceId: 'worker',
    profile: 'web',
    fromManifestDigest,
    toManifestDigest,
    fromReleaseDigest: previous?.releaseDigest ?? null,
    toReleaseDigest: releaseDigest,
    manifestDigest: toManifestDigest,
    profileHash: backupProfileHash,
    observedDshVersion: '0.1.0-rc.7',
    observedRuntimeDigest: '1'.repeat(64),
    observedServiceDefinitionDigest: null,
    releaseId,
    releaseVersion,
    releaseDigest,
    plugins: [plugin],
    changes: [],
    restartRequired: !markerOnly,
    createdAt,
    expiresAt: new Date(Date.parse(createdAt) + 300_000).toISOString(),
  })
  const suffix = plan.digest.slice(0, 24)
  const backupProfile = markerOnly ? null : 'fleet-backup-' + suffix
  if (temporaryBackup !== null && backupProfile !== null) {
    await rename(join(config.dshHome, 'profiles', temporaryBackup), join(config.dshHome, 'profiles', backupProfile))
  }
  const descriptor = {
    schemaVersion: 1,
    transitionPlanId: plan.planId,
    transitionPlanDigest: plan.digest,
    deviceId: plan.deviceId,
    profile: plan.profile,
    fromManifestDigest: plan.fromManifestDigest,
    toManifestDigest: plan.toManifestDigest,
    fromReleaseDigest: plan.fromReleaseDigest,
    toReleaseDigest: plan.toReleaseDigest,
    fromProfileHash: plan.profileHash,
    backupProfile,
    previousAppliedRelease: previous,
    createdAt,
  }
  const marker: FleetAppliedRelease = {
    schemaVersion: 2,
    deviceId: plan.deviceId,
    profile: plan.profile,
    releaseId,
    releaseVersion,
    releaseDigest,
    plugins: [plugin],
    appliedAt: createdAt,
    transitionPlanId: plan.planId,
    transitionPlanDigest: plan.digest,
  }
  const action = {
    planId: plan.planId,
    planDigest: plan.digest,
    approvalId: `approval-${ordinal}`,
    principalId: 'owner',
    idempotencyKey: sha256(`approval-${ordinal}`),
    deviceId: plan.deviceId,
    profile: plan.profile,
    releaseId,
    releaseVersion,
    releaseDigest,
    fromManifestDigest: plan.fromManifestDigest,
    toManifestDigest: plan.toManifestDigest,
    fromReleaseDigest: plan.fromReleaseDigest,
    toReleaseDigest: plan.toReleaseDigest,
    rollbackDescriptorDigest: sha256Canonical(descriptor),
    stageProfile: 'fleet-stage-' + suffix,
    backupProfile: 'fleet-backup-' + suffix,
    state: 'succeeded',
    updatedAt: createdAt,
    result: 'success',
  }
  const file = plan.digest + '.json'
  await Promise.all([
    writeFile(join(config.stateDir, 'release-plans', file), JSON.stringify(plan, null, 2) + '\n'),
    writeFile(join(config.stateDir, 'release-actions', file), JSON.stringify(action, null, 2) + '\n'),
    writeFile(join(config.stateDir, 'release-rollbacks', file), JSON.stringify(descriptor, null, 2) + '\n'),
  ])
  return { plan, marker, backupProfile }
}

async function installMarker(config: FleetAgentConfig, marker: FleetAppliedRelease): Promise<void> {
  await writeFile(join(config.stateDir, 'releases', 'web.json'), JSON.stringify(marker, null, 2) + '\n')
}

function retentionApproval(plan: FleetReleaseRetentionPlan): FleetReleaseRetentionApproval {
  return {
    protocolVersion: 1,
    kind: 'profile-release-retention',
    approvalId: 'retention-approval',
    principalId: 'owner',
    planId: plan.planId,
    planDigest: plan.digest,
    deviceId: plan.deviceId,
    profile: plan.profile,
    approvedAt: new Date(Date.parse(plan.createdAt) + 1000).toISOString(),
    expiresAt: new Date(Date.parse(plan.createdAt) + 120_000).toISOString(),
  }
}

describe('release retention runtime', () => {
  it('retains current/previous, explicitly removes N+2 superseded transitions and only reports orphans', async () => {
    const { config, profilesRoot } = await fixture()
    const transitions: Awaited<ReturnType<typeof appendTransition>>[] = []
    let previous: FleetAppliedRelease | null = null
    for (let ordinal = 1; ordinal <= 4; ordinal += 1) {
      const transition = await appendTransition(config, previous, ordinal, ordinal === 2)
      transitions.push(transition)
      previous = transition.marker
    }
    await installMarker(config, previous!)
    const orphanBackup = 'fleet-backup-' + 'a'.repeat(24)
    const orphanStage = 'fleet-stage-' + 'b'.repeat(24)
    const orphanFailed = 'fleet-failed-' + 'c'.repeat(24)
    await Promise.all([
      mkdir(join(profilesRoot, orphanBackup)),
      mkdir(join(profilesRoot, orphanStage)),
      mkdir(join(profilesRoot, orphanFailed)),
    ])

    const plan = await createStoredReleaseRetentionPlan(config, new Date('2026-08-19T01:00:00.000Z'))
    expect(plan.retainedTransitionPlanIds).toEqual([
      transitions[2]!.plan.planId,
      transitions[3]!.plan.planId,
    ].sort())
    expect(plan.entries.map(entry => entry.transitionPlanId)).toEqual([
      transitions[0]!.plan.planId,
      transitions[1]!.plan.planId,
    ].sort())
    expect(plan.entries.find(entry => entry.transitionPlanId === transitions[1]!.plan.planId)?.backupProfile).toBeNull()
    expect(plan).toMatchObject({
      orphanBackupProfiles: [orphanBackup],
      orphanStageProfiles: [orphanStage],
      orphanFailedProfiles: [orphanFailed],
    })

    const result = await applyStoredReleaseRetentionPlan(config, retentionApproval(plan), new Date('2026-08-19T01:01:00.000Z'))
    expect(result).toMatchObject({ state: 'succeeded', result: 'success' })
    expect(result.removedTransitionPlanIds).toEqual(plan.entries.map(entry => entry.transitionPlanId))
    for (const transition of transitions.slice(0, 2)) {
      await expect(readFile(join(config.stateDir, 'release-rollbacks', transition.plan.digest + '.json'))).rejects.toMatchObject({ code: 'ENOENT' })
      if (transition.backupProfile !== null) {
        await expect(readFile(join(profilesRoot, transition.backupProfile, 'package.json'))).rejects.toMatchObject({ code: 'ENOENT' })
      }
    }
    for (const transition of transitions.slice(2)) {
      await expect(readFile(join(config.stateDir, 'release-rollbacks', transition.plan.digest + '.json'), 'utf8')).resolves.toContain(transition.plan.planId)
      if (transition.backupProfile !== null) {
        await expect(readFile(join(profilesRoot, transition.backupProfile, 'package.json'), 'utf8')).resolves.toContain('backup')
      }
    }
    for (const orphan of [orphanBackup, orphanStage, orphanFailed]) {
      await expect(stat(join(profilesRoot, orphan))).resolves.toMatchObject({})
    }
    expect(await applyStoredReleaseRetentionPlan(config, retentionApproval(plan), new Date('2026-08-19T02:00:00.000Z'))).toEqual(result)
    expect(await readReleaseRetentionActionStatus(config, plan.planId)).toEqual(result)

    await installMarker(config, transitions[2]!.marker)
    const afterRollback = await createStoredReleaseRetentionPlan(config, new Date('2026-08-19T02:01:00.000Z'))
    expect(afterRollback.retainedTransitionPlanIds).toEqual([transitions[2]!.plan.planId])
    expect(afterRollback.entries).toEqual([])
  })

  it('invalidates an old plan after backup tamper or a newly applied release', async () => {
    const { config, profilesRoot } = await fixture()
    let previous: FleetAppliedRelease | null = null
    const transitions: Awaited<ReturnType<typeof appendTransition>>[] = []
    for (let ordinal = 1; ordinal <= 3; ordinal += 1) {
      const transition = await appendTransition(config, previous, ordinal)
      transitions.push(transition)
      previous = transition.marker
    }
    await installMarker(config, previous!)
    const tamperPlan = await createStoredReleaseRetentionPlan(config, new Date('2026-08-19T01:00:00.000Z'))
    await writeFile(join(profilesRoot, transitions[0]!.backupProfile!, 'cordis.yml'), 'tampered: true\n')
    await expect(applyStoredReleaseRetentionPlan(config, retentionApproval(tamperPlan), new Date('2026-08-19T01:01:00.000Z')))
      .rejects.toMatchObject({ code: 'retention-plan-stale' })
    await expect(readFile(join(config.stateDir, 'release-rollbacks', transitions[0]!.plan.digest + '.json'), 'utf8')).resolves.toContain(transitions[0]!.plan.planId)

    await rm(join(profilesRoot, transitions[0]!.backupProfile!), { recursive: true })
    await writeProfile(join(profilesRoot, transitions[0]!.backupProfile!), 'backup-1')
    const freshPlan = await createStoredReleaseRetentionPlan(config, new Date('2026-08-19T01:02:00.000Z'))
    const next = await appendTransition(config, previous, 4)
    await installMarker(config, next.marker)
    await expect(applyStoredReleaseRetentionPlan(config, retentionApproval(freshPlan), new Date('2026-08-19T01:03:00.000Z')))
      .rejects.toMatchObject({ code: 'retention-plan-stale' })
  })

  it('resumes a partially removed quarantine without reinterpreting it as tamper', async () => {
    const { config, profilesRoot } = await fixture()
    let previous: FleetAppliedRelease | null = null
    const transitions: Awaited<ReturnType<typeof appendTransition>>[] = []
    for (let ordinal = 1; ordinal <= 3; ordinal += 1) {
      const transition = await appendTransition(config, previous, ordinal)
      transitions.push(transition)
      previous = transition.marker
    }
    await installMarker(config, previous!)
    const plan = await createStoredReleaseRetentionPlan(config, new Date('2026-08-19T01:00:00.000Z'))
    const approval = retentionApproval(plan)
    const identity = validateFleetReleaseRetentionApproval(plan, approval, approval.approvedAt)
    const entry = plan.entries[0]!
    const quarantine = 'fleet-failed-' + sha256Canonical({
      kind: 'release-retention-quarantine',
      planId: plan.planId,
      transitionPlanId: entry.transitionPlanId,
    }).slice(0, 24)
    await rename(join(profilesRoot, entry.backupProfile!), join(profilesRoot, quarantine))
    await rm(join(profilesRoot, quarantine, 'cordis.yml'))
    await mkdir(join(config.stateDir, 'release-retention-actions'), { recursive: true })
    await writeFile(join(config.stateDir, 'release-retention-actions', plan.digest + '.json'), JSON.stringify({
      planId: plan.planId,
      planDigest: plan.digest,
      approvalId: approval.approvalId,
      principalId: approval.principalId,
      idempotencyKey: identity.idempotencyKey,
      deviceId: plan.deviceId,
      profile: plan.profile,
      currentTransitionPlanId: plan.currentTransitionPlanId,
      state: 'applying',
      removedTransitionPlanIds: [],
      activeTransitionPlanId: entry.transitionPlanId,
      activeBackupQuarantinePrepared: true,
      activeBackupRemoved: false,
      updatedAt: '2026-08-19T01:00:30.000Z',
      result: null,
    }, null, 2) + '\n')

    const result = await applyStoredReleaseRetentionPlan(config, approval, new Date('2026-08-19T01:01:00.000Z'))
    expect(result).toMatchObject({ state: 'succeeded', result: 'success' })
    await expect(stat(join(profilesRoot, quarantine))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(config.stateDir, 'release-rollbacks', transitions[0]!.plan.digest + '.json')))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })
})

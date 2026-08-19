import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LOCAL_TASK_POLICIES, type FleetAgentConfig } from '../src/agent/config.ts'
import { sha256Canonical } from '../src/agent/protocol.ts'
import type { FleetAppliedRelease, FleetReleasePluginBinding } from '../src/agent/release-protocol.ts'
import {
  listFleetTasks,
  pruneFleetTasks,
  receiveA2AMessage,
  resumeAcceptedTasks,
  runTaskWorker,
  signA2AMessage,
  type A2AWorkerLaunch,
} from '../src/a2a/runtime.ts'
import {
  a2aKeyId,
  createA2AEnvelope,
  verifyA2AEnvelope,
  type FleetA2AKind,
  type FleetA2ATrustEntry,
} from '../src/a2a/protocol.ts'
import { digestToolArguments } from '../src/worker/context.ts'
import { computeExecutionProfileHash } from '../src/worker/profile.ts'
import { listFederationInbox } from '../src/federation/inbox.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-fleet-a2a-'))
  roots.push(root)
  const workspace = join(root, 'workspace')
  const artifactStore = join(root, 'artifacts')
  const bin = join(root, 'bin')
  await Promise.all([mkdir(workspace), mkdir(artifactStore), mkdir(bin)])
  const workerBundlePath = join(root, 'worker.mjs')
  await writeFile(workerBundlePath, 'export const name = "test-worker"\nexport async function apply() {}\n')
  const dshBinary = join(bin, 'dsh')
  await writeFile(dshBinary, `#!/usr/bin/env node
const args = process.argv.slice(2)
if (args[0] !== '--profile' || args[1] !== 'headless' || args[2] !== '--patch') process.exit(8)
if (!process.env.DSH_FLEET_TASK_CONTEXT || !process.env.DSH_PERMISSION_MODE) process.exit(9)
process.stdout.write('completed: ' + args[4] + '\\n')
`)
  await chmod(dshBinary, 0o755)
  const tarBinary = join(bin, 'tar')
  const pnpmBinary = join(bin, 'pnpm')
  await writeFile(tarBinary, '#!/bin/sh\nexit 0\n')
  await writeFile(pnpmBinary, '#!/bin/sh\nexit 0\n')
  await Promise.all([chmod(tarBinary, 0o755), chmod(pnpmBinary, 0o755)])

  const controllerKeys = generateKeyPairSync('ed25519')
  const intruderKeys = generateKeyPairSync('ed25519')
  const workerKeys = generateKeyPairSync('ed25519')
  const controllerPublic = controllerKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const workerPublic = workerKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const controllerPrivatePath = join(root, 'controller.key')
  const workerPrivatePath = join(root, 'worker.key')
  await Promise.all([
    writeFile(controllerPrivatePath, controllerKeys.privateKey.export({ type: 'pkcs8', format: 'pem' })),
    writeFile(workerPrivatePath, workerKeys.privateKey.export({ type: 'pkcs8', format: 'pem' })),
  ])
  await Promise.all([chmod(controllerPrivatePath, 0o600), chmod(workerPrivatePath, 0o600)])
  const controllerKeyId = a2aKeyId(controllerKeys.publicKey)
  const intruderKeyId = a2aKeyId(intruderKeys.publicKey)
  const workerKeyId = a2aKeyId(workerKeys.publicKey)
  const controllerTrust: FleetA2ATrustEntry = {
    teamId: 'example-team',
    keyId: controllerKeyId,
    principalId: 'owner',
    deviceId: 'controller',
    publicKeyPem: controllerPublic,
    allowedKinds: ['task.submit', 'task.status', 'task.cancel', 'task.approval.decision', 'handoff'],
  }
  const intruderTrust: FleetA2ATrustEntry = {
    teamId: 'example-team',
    keyId: intruderKeyId,
    principalId: 'other-owner',
    deviceId: 'other-controller',
    publicKeyPem: intruderKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    allowedKinds: ['task.status', 'task.cancel', 'task.approval.decision'],
  }
  const workerTrust: FleetA2ATrustEntry = {
    teamId: 'example-team',
    keyId: workerKeyId,
    principalId: 'worker-agent',
    deviceId: 'worker',
    publicKeyPem: workerPublic,
    allowedKinds: ['task.progress', 'task.result', 'receipt'],
  }
  const workerTrustPath = join(root, 'worker-trust.json')
  const controllerTrustPath = join(root, 'controller-trust.json')
  await Promise.all([
    writeFile(workerTrustPath, JSON.stringify({ schemaVersion: 2, teamId: 'example-team', entries: [controllerTrust, intruderTrust] }, null, 2)),
    writeFile(controllerTrustPath, JSON.stringify({ schemaVersion: 2, teamId: 'example-team', entries: [workerTrust] }, null, 2)),
  ])
  const dshHome = join(root, 'dsh-home')
  const manifestPath = join(dshHome, 'profiles', 'web', 'fleet.lock.yaml')
  const executionProfilePath = join(dshHome, 'profiles', 'headless')
  const manifestSource = 'schemaVersion: 2\nteam:\n  id: example-team\ndevices:\n  worker:\n    class: always-on-worker\n    channel: stable\nprofileReleases: {}\nassignments: {}\n'
  await Promise.all([
    mkdir(join(dshHome, 'profiles', 'web'), { recursive: true }),
    mkdir(executionProfilePath, { recursive: true }),
  ])
  await writeFile(manifestPath, manifestSource)
  await Promise.all([
    writeFile(join(executionProfilePath, 'package.json'), JSON.stringify({ name: 'headless-profile', private: true }) + '\n'),
    writeFile(join(executionProfilePath, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n'),
    writeFile(join(executionProfilePath, 'cordis.yml'), '[]\n'),
  ])
  const executionProfileHash = await computeExecutionProfileHash(dshHome, 'headless')
  const manifestDigest = createHash('sha256').update(manifestSource).digest('hex')
  const artifactDigest = 'a'.repeat(64)
  const plugins: FleetReleasePluginBinding[] = [{
    pluginId: 'dsh-fleet',
    visibility: 'private',
    sourceKind: 'artifact',
    exactSpec: 'artifact:sha256:' + artifactDigest,
    artifactDigest,
    packageVersion: '0.4.0',
    integrity: null,
    runtimeModules: ['fleet'],
  }]
  const releaseDigest = sha256Canonical({ releaseId: 'worker-release', releaseVersion: '1.0.0', profile: 'web', plugins })
  const base = {
    schemaVersion: 2 as const,
    manifestPath,
    dshHome,
    dshBinary,
    pnpmBinary,
    profile: 'web',
    planTtlMs: 300_000,
    artifactStore,
    tarBinary,
    restart: { kind: 'none' as const },
    health: { timeoutMs: 3000, requireFleetRpc: false },
    tasks: {
      enabled: true,
      workspaces: { repo: workspace },
      profiles: ['headless'],
      timeoutMs: 60_000,
      maxOutputBytes: 64 * 1024,
      maxConcurrent: 1,
      policyIds: ['readonly-v1', 'workspace-write-ask-v1'] as Array<'readonly-v1' | 'workspace-write-ask-v1'>,
      policies: {
        'readonly-v1': LOCAL_TASK_POLICIES['readonly-v1'],
        'workspace-write-ask-v1': LOCAL_TASK_POLICIES['workspace-write-ask-v1'],
      },
    },
  }
  const workerConfig: FleetAgentConfig = {
    ...base,
    deviceId: 'worker',
    stateDir: join(root, 'worker-state'),
    a2a: {
      teamId: 'example-team', principalId: 'worker-agent', privateKeyPath: workerPrivatePath,
      trustStorePath: workerTrustPath, maxMessageTtlMs: 15 * 60 * 1000,
    },
  }
  const applied: FleetAppliedRelease = {
    schemaVersion: 1,
    deviceId: 'worker',
    profile: 'web',
    releaseId: 'worker-release',
    releaseVersion: '1.0.0',
    releaseDigest,
    plugins,
    appliedAt: new Date().toISOString(),
  }
  await mkdir(join(workerConfig.stateDir, 'releases'), { recursive: true })
  await writeFile(join(workerConfig.stateDir, 'releases', 'web.json'), JSON.stringify(applied, null, 2) + '\n')
  const launch: A2AWorkerLaunch = {
    nodeBinary: '/usr/bin/true',
    agentPath: '/tmp/ignored-agent.mjs',
    configPath: '/tmp/ignored-agent.json',
  }
  const controllerTrustMap = new Map([[workerKeyId, workerTrust]])
  return {
    root, workspace, workerBundlePath, workerConfig, launch, controllerKeys, intruderKeys,
    controllerTrustMap, manifestDigest, releaseDigest, executionProfilePath, executionProfileHash,
  }
}

function message(
  keys: ReturnType<typeof generateKeyPairSync>,
  kind: FleetA2AKind,
  payload: Record<string, unknown>,
  sender: { principalId: string; deviceId: string } = { principalId: 'owner', deviceId: 'controller' },
) {
  return createA2AEnvelope({
    teamId: 'example-team',
    sender,
    recipient: { deviceId: 'worker' },
    kind,
    payload,
    privateKey: keys.privateKey,
    now: new Date(),
  })
}

function taskPayload(
  state: Awaited<ReturnType<typeof setup>>,
  taskId: string,
  input: Partial<Record<'workspaceId' | 'profile' | 'executionProfileHash' | 'prompt' | 'manifestDigest' | 'releaseDigest' | 'policyId' | 'policyDigest' | 'deadline', string>> = {},
): Record<string, unknown> {
  const policyId = input.policyId ?? 'readonly-v1'
  const policy = policyId === 'workspace-write-ask-v1'
    ? LOCAL_TASK_POLICIES['workspace-write-ask-v1']
    : LOCAL_TASK_POLICIES['readonly-v1']
  return {
    taskId,
    workspaceId: input.workspaceId ?? 'repo',
    profile: input.profile ?? 'headless',
    executionProfileHash: input.executionProfileHash ?? state.executionProfileHash,
    manifestDigest: input.manifestDigest ?? state.manifestDigest,
    releaseDigest: input.releaseDigest ?? state.releaseDigest,
    policyId,
    policyDigest: input.policyDigest ?? policy.policyDigest,
    deadline: input.deadline ?? new Date(Date.now() + 45_000).toISOString(),
    prompt: input.prompt ?? 'run the release checks',
  }
}

async function installApprovalIntent(
  state: Awaited<ReturnType<typeof setup>>,
  taskId: string,
  input: { approvalId?: string; expiresAt?: string; toolCallId?: string; arguments?: Record<string, unknown> } = {},
) {
  const taskDirectory = join(state.workerConfig.stateDir, 'tasks', taskId.slice('task:'.length))
  const record = JSON.parse(await readFile(join(taskDirectory, 'record.json'), 'utf8')) as {
    taskBindingDigest: string
    executionProfileHash: string
  }
  const approvalId = input.approvalId ?? 'approval:' + randomUUID()
  const approvalDirectory = join(taskDirectory, 'approvals', approvalId.slice('approval:'.length))
  const argumentsValue = input.arguments ?? { file_path: 'safe.txt', content: 'approved content' }
  const intent = {
    schemaVersion: 2,
    approvalId,
    taskId,
    taskBindingDigest: record.taskBindingDigest,
    executionProfileHash: record.executionProfileHash,
    toolCallId: input.toolCallId ?? 'call-1',
    toolName: 'write',
    arguments: argumentsValue,
    argumentsDigest: digestToolArguments(argumentsValue),
    capability: 'workspace-mutation',
    expiresAt: input.expiresAt ?? new Date(Date.now() + 30_000).toISOString(),
  }
  await mkdir(approvalDirectory, { recursive: true, mode: 0o700 })
  const intentPath = join(approvalDirectory, 'intent.json')
  await writeFile(intentPath, JSON.stringify(intent, null, 2) + '\n', { mode: 0o600 })
  await chmod(approvalDirectory, 0o700)
  await chmod(intentPath, 0o600)
  return { approvalDirectory, intent }
}

describe('durable A2A task channel', () => {
  it('accepts a signed task, survives the request boundary, runs DSH in a fixed workspace and returns a signed result', async () => {
    const state = await setup()
    const { workerConfig, launch, controllerKeys, controllerTrustMap, workerBundlePath } = state
    const taskId = 'task:' + randomUUID()
    const submit = message(controllerKeys, 'task.submit', taskPayload(state, taskId))
    const accepted = await receiveA2AMessage(workerConfig, submit, launch)
    expect(accepted.requestMessageId).toBe(submit.messageId)
    expect(accepted.response).toMatchObject({
      kind: 'task.progress',
      payload: { taskId, state: 'accepted' },
    })
    expect(verifyA2AEnvelope(accepted.response, {
      expectedTeamId: 'example-team', expectedDeviceId: 'controller', trust: controllerTrustMap, now: new Date(),
    })).toEqual(accepted.response)

    const finished = await runTaskWorker(workerConfig, taskId, workerBundlePath)
    expect(finished).toMatchObject({ state: 'succeeded', resultDigest: expect.stringMatching(/^[0-9a-f]{64}$/) })
    const status = message(controllerKeys, 'task.status', { taskId })
    const result = await receiveA2AMessage(workerConfig, status, launch)
    expect(result.response).toMatchObject({
      kind: 'task.result',
      payload: {
        taskId,
        state: 'succeeded',
        result: 'completed: run the release checks\n',
        truncated: false,
        errorCode: null,
      },
    })
    expect(verifyA2AEnvelope(result.response, {
      expectedTeamId: 'example-team', expectedDeviceId: 'controller', trust: controllerTrustMap, now: new Date(),
    })).toEqual(result.response)

    const replay = await receiveA2AMessage(workerConfig, submit, launch)
    expect(replay).toEqual(accepted)
  })

  it('applies local workspace policy and persists cancellation before execution', async () => {
    const state = await setup()
    const { workerConfig, launch, controllerKeys, workerBundlePath } = state
    const deniedTaskId = 'task:' + randomUUID()
    const denied = message(controllerKeys, 'task.submit', taskPayload(state, deniedTaskId, { workspaceId: 'unknown', prompt: 'do not run' }))
    await expect(receiveA2AMessage(workerConfig, denied, launch)).rejects.toMatchObject({ code: 'task-policy-denied' })

    const taskId = 'task:' + randomUUID()
    const submit = message(controllerKeys, 'task.submit', taskPayload(state, taskId, { prompt: 'wait' }))
    await receiveA2AMessage(workerConfig, submit, launch)
    const cancel = message(controllerKeys, 'task.cancel', { taskId })
    const cancellation = await receiveA2AMessage(workerConfig, cancel, launch)
    expect(cancellation.response).toMatchObject({ kind: 'task.progress', payload: { state: 'cancel-requested' } })
    await expect(runTaskWorker(workerConfig, taskId, workerBundlePath)).resolves.toMatchObject({ state: 'cancelled', errorCode: 'cancelled' })
  })

  it('reaps crashed receipt, task-create, worker and concurrency-slot locks through the shared CAS path', async () => {
    const state = await setup()
    const { workerConfig, launch, controllerKeys, workerBundlePath } = state
    const taskId = 'task:' + randomUUID()
    const submit = message(controllerKeys, 'task.submit', taskPayload(state, taskId, { prompt: 'recover locks' }))
    const receiptDirectory = join(workerConfig.stateDir, 'a2a', 'receipts')
    await mkdir(receiptDirectory, { recursive: true })
    const receiptLock = join(receiptDirectory, createHash('sha256').update(submit.messageId).digest('hex') + '.json.lock')
    await writeFile(receiptLock, JSON.stringify({ pid: 2_147_483_647, token: randomUUID() }))
    const taskDirectory = join(workerConfig.stateDir, 'tasks', taskId.slice('task:'.length))
    await mkdir(taskDirectory, { recursive: true, mode: 0o700 })
    await writeFile(join(taskDirectory, 'create.lock'), JSON.stringify({ pid: 2_147_483_647, token: randomUUID() }))

    await expect(receiveA2AMessage(workerConfig, submit, launch)).resolves.toMatchObject({ response: { payload: { state: 'accepted' } } })
    const workerLock = join(taskDirectory, 'worker.lock')
    await writeFile(workerLock, JSON.stringify({ pid: 2_147_483_647, token: randomUUID() }))
    const slotDirectory = join(workerConfig.stateDir, 'tasks', '.slots')
    await mkdir(slotDirectory, { recursive: true, mode: 0o700 })
    await writeFile(join(slotDirectory, '0.lock'), JSON.stringify({ pid: 2_147_483_647, token: randomUUID() }))
    await expect(runTaskWorker(workerConfig, taskId, workerBundlePath)).resolves.toMatchObject({ state: 'succeeded' })
  })

  it('does not unlink a live replacement that wins the stale-lock reclaim race', async () => {
    const state = await setup()
    const { workerConfig, launch, controllerKeys } = state
    const taskId = 'task:' + randomUUID()
    const submit = message(controllerKeys, 'task.submit', taskPayload(state, taskId, { prompt: 'lock race' }))
    const receiptDirectory = join(workerConfig.stateDir, 'a2a', 'receipts')
    await mkdir(receiptDirectory, { recursive: true })
    const receiptLock = join(receiptDirectory, createHash('sha256').update(submit.messageId).digest('hex') + '.json.lock')
    await writeFile(receiptLock, JSON.stringify({ pid: 2_147_483_647, token: 'stale' }) + '\n')
    const replacementToken = randomUUID()
    let replaced = false
    await expect(receiveA2AMessage(workerConfig, submit, launch, new Date(), {
      beforeStaleLockClaim: async path => {
        if (replaced) return
        replaced = true
        await rm(path)
        await writeFile(path, JSON.stringify({ pid: process.pid, token: replacementToken }) + '\n')
      },
    })).rejects.toMatchObject({ code: 'message-in-progress' })
    expect(JSON.parse(await readFile(receiptLock, 'utf8'))).toMatchObject({ pid: process.pid, token: replacementToken })
  })

  it('serializes concurrent signed submissions for the same durable task id', async () => {
    const state = await setup()
    const { workerConfig, launch, controllerKeys, workerBundlePath } = state
    const taskId = 'task:' + randomUUID()
    const submit = message(controllerKeys, 'task.submit', taskPayload(state, taskId, { prompt: 'run once' }))
    const [first, second] = await Promise.all([
      receiveA2AMessage(workerConfig, submit, launch),
      receiveA2AMessage(workerConfig, submit, launch),
    ])
    expect(first.response).toMatchObject({ payload: { taskId, state: 'accepted' } })
    expect(second.response).toMatchObject({ payload: { taskId, state: 'accepted' } })
    await expect(runTaskWorker(workerConfig, taskId, workerBundlePath)).resolves.toMatchObject({ state: 'succeeded' })
  })

  it('lists only owner-safe task metadata and explicitly prunes old terminal tasks without deleting active work', async () => {
    const state = await setup()
    const { workerConfig, launch, controllerKeys, workerBundlePath } = state
    const completedTaskId = 'task:' + randomUUID()
    const activeTaskId = 'task:' + randomUUID()
    await receiveA2AMessage(workerConfig, message(controllerKeys, 'task.submit', taskPayload(state, completedTaskId, { prompt: 'private completed prompt' })), launch)
    await runTaskWorker(workerConfig, completedTaskId, workerBundlePath)
    await receiveA2AMessage(workerConfig, message(controllerKeys, 'task.submit', taskPayload(state, activeTaskId, { prompt: 'private active prompt' })), launch)

    const catalog = await listFleetTasks(workerConfig, 10, new Date('2026-08-19T10:00:00.000Z'))
    expect(catalog.generatedAt).toBe('2026-08-19T10:00:00.000Z')
    expect(catalog.tasks).toHaveLength(2)
    expect(catalog.tasks.find(task => task.taskId === completedTaskId)).toMatchObject({
      state: 'succeeded', targetDeviceId: 'worker', workspaceId: 'repo', profile: 'headless',
      resultDigest: expect.stringMatching(/^[0-9a-f]{64}$/), errorCode: null,
    })
    expect(Object.keys(catalog.tasks[0]!).sort()).toEqual([
      'createdAt', 'errorCode', 'profile', 'resultDigest', 'state', 'targetDeviceId', 'taskId', 'updatedAt', 'workspaceId',
    ])
    const serialized = JSON.stringify(catalog)
    expect(serialized).not.toContain('private completed prompt')
    expect(serialized).not.toContain('private active prompt')
    expect(serialized).not.toContain('completed:')

    const prune = await pruneFleetTasks(workerConfig, {
      olderThan: new Date(Date.now() + 60_000).toISOString(),
      states: ['succeeded', 'failed', 'cancelled'],
    })
    expect(prune).toEqual({ pruned: 1, skippedActive: 1 })
    const after = await listFleetTasks(workerConfig)
    expect(after.tasks.map(task => task.taskId)).toEqual([activeTaskId])
  })

  it('refuses catalog access when the durable task root is not owner-only and does not resume while tasks are disabled', async () => {
    const state = await setup()
    const { workerConfig, launch, controllerKeys } = state
    const taskId = 'task:' + randomUUID()
    await receiveA2AMessage(workerConfig, message(controllerKeys, 'task.submit', taskPayload(state, taskId, { prompt: 'stay accepted' })), launch)
    await expect(resumeAcceptedTasks({
      ...workerConfig,
      tasks: { ...workerConfig.tasks!, enabled: false },
    }, launch)).resolves.toBe(0)
    await chmod(join(workerConfig.stateDir, 'tasks'), 0o755)
    await expect(listFleetTasks(workerConfig)).rejects.toMatchObject({ code: 'unsafe-state-permissions' })
  })

  it('binds status and cancellation to the exact submitting principal, device and key', async () => {
    const state = await setup()
    const { workerConfig, launch, controllerKeys, intruderKeys } = state
    const taskId = 'task:' + randomUUID()
    const submit = message(controllerKeys, 'task.submit', taskPayload(state, taskId, { prompt: 'owner-bound work' }))
    await receiveA2AMessage(workerConfig, submit, launch)

    const foreignSender = { principalId: 'other-owner', deviceId: 'other-controller' }
    await expect(receiveA2AMessage(
      workerConfig,
      message(intruderKeys, 'task.status', { taskId }, foreignSender),
      launch,
    )).rejects.toMatchObject({ code: 'task-owner-mismatch' })
    await expect(receiveA2AMessage(
      workerConfig,
      message(intruderKeys, 'task.cancel', { taskId }, foreignSender),
      launch,
    )).rejects.toMatchObject({ code: 'task-owner-mismatch' })

    const conflictingReplay = message(controllerKeys, 'task.submit', taskPayload(state, taskId, { prompt: 'owner-bound work' }))
    await expect(receiveA2AMessage(workerConfig, conflictingReplay, launch))
      .rejects.toMatchObject({ code: 'task-id-conflict' })
  })

  it('fails closed when manifest, release or local policy binding differs', async () => {
    const state = await setup()
    const { workerConfig, launch, controllerKeys, workerBundlePath } = state
    for (const override of [
      { manifestDigest: 'b'.repeat(64) },
      { releaseDigest: 'c'.repeat(64) },
      { policyDigest: 'd'.repeat(64) },
      { executionProfileHash: 'e'.repeat(64) },
    ]) {
      const taskId = 'task:' + randomUUID()
      await expect(receiveA2AMessage(
        workerConfig,
        message(controllerKeys, 'task.submit', taskPayload(state, taskId, override)),
        launch,
      )).rejects.toMatchObject({ code: expect.stringMatching(/^task-(release-mismatch|policy-denied|execution-profile-mismatch)$/) })
    }

    const acceptedTaskId = 'task:' + randomUUID()
    await receiveA2AMessage(
      workerConfig,
      message(controllerKeys, 'task.submit', taskPayload(state, acceptedTaskId)),
      launch,
    )
    await writeFile(workerConfig.manifestPath, 'changed after acceptance\n')
    await expect(runTaskWorker(workerConfig, acceptedTaskId, workerBundlePath))
      .resolves.toMatchObject({ state: 'failed', errorCode: 'task-release-mismatch' })
  })

  it('rechecks the execution profile before worker launch', async () => {
    const state = await setup()
    const { workerConfig, launch, controllerKeys, workerBundlePath, executionProfilePath } = state
    const taskId = 'task:' + randomUUID()
    await receiveA2AMessage(workerConfig, message(controllerKeys, 'task.submit', taskPayload(state, taskId)), launch)
    await writeFile(join(executionProfilePath, 'cordis.yml'), '- changed-after-acceptance\n')
    await expect(runTaskWorker(workerConfig, taskId, workerBundlePath)).resolves.toMatchObject({
      state: 'failed',
      errorCode: 'task-execution-profile-mismatch',
    })
  })

  it('rechecks the execution profile before recording an approval decision', async () => {
    const state = await setup()
    const { workerConfig, launch, controllerKeys, executionProfilePath } = state
    const taskId = 'task:' + randomUUID()
    await receiveA2AMessage(workerConfig, message(controllerKeys, 'task.submit', taskPayload(state, taskId, {
      policyId: 'workspace-write-ask-v1',
    })), launch)
    const { approvalDirectory, intent } = await installApprovalIntent(state, taskId)
    const request = (await receiveA2AMessage(
      workerConfig,
      message(controllerKeys, 'task.status', { taskId }),
      launch,
    )).response
    await writeFile(join(executionProfilePath, 'cordis.yml'), '- changed-before-decision\n')
    const decision = message(controllerKeys, 'task.approval.decision', {
      approvalId: intent.approvalId,
      taskId,
      approvalRequestMessageId: request.messageId,
      approvalRequestPayloadDigest: request.payloadDigest,
      taskBindingDigest: intent.taskBindingDigest,
      toolCallId: intent.toolCallId,
      argumentsDigest: intent.argumentsDigest,
      decision: 'allowed-once',
      decidedAt: new Date().toISOString(),
    })
    await expect(receiveA2AMessage(workerConfig, decision, launch))
      .rejects.toMatchObject({ code: 'task-execution-profile-mismatch' })
    await expect(readFile(join(approvalDirectory, 'decision.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('gives foreign federation approvals their bounded payload lifetime while keeping same-team traffic short', async () => {
    const state = await setup()
    const now = new Date('2026-08-19T00:00:00.000Z')
    const federationTrust = new Map([...state.controllerTrustMap].map(([keyId, entry]) => [keyId, {
      ...entry,
      allowedKinds: [...entry.allowedKinds, 'approval.request', 'approval.decision'] as FleetA2AKind[],
    }]))
    const requestExpiry = new Date(now.getTime() + 12 * 60 * 1000).toISOString()
    const advisory = await signA2AMessage(state.workerConfig, 'partner-controller', 'approval.request', {
      approvalId: 'approval:' + randomUUID(),
      taskId: 'task:' + randomUUID(),
      summary: 'Review within the signed advisory window.',
      expiresAt: requestExpiry,
    }, now, 'partner-team')
    expect(advisory.expiresAt).toBe(requestExpiry)
    expect(verifyA2AEnvelope(advisory, {
      expectedTeamId: 'partner-team',
      expectedDeviceId: 'partner-controller',
      trust: federationTrust,
      now: new Date(now.getTime() + 10 * 60 * 1000),
      maxTtlMs: state.workerConfig.a2a!.maxMessageTtlMs,
    })).toEqual(advisory)

    const decision = await signA2AMessage(state.workerConfig, 'partner-controller', 'approval.decision', {
      approvalId: advisory.payload.approvalId,
      taskId: advisory.payload.taskId,
      approvalRequestMessageId: advisory.messageId,
      approvalRequestPayloadDigest: advisory.payloadDigest,
      decision: 'endorsed',
      decidedAt: now.toISOString(),
    }, now, 'partner-team')
    expect(Date.parse(decision.expiresAt) - Date.parse(decision.issuedAt)).toBe(15 * 60 * 1000)
    expect(verifyA2AEnvelope(decision, {
      expectedTeamId: 'partner-team',
      expectedDeviceId: 'partner-controller',
      trust: federationTrust,
      now: new Date(now.getTime() + 10 * 60 * 1000),
      maxTtlMs: state.workerConfig.a2a!.maxMessageTtlMs,
    })).toEqual(decision)

    const sameTeam = await signA2AMessage(state.workerConfig, 'controller', 'task.progress', {
      taskId: 'task:' + randomUUID(),
      state: 'running',
      updatedAt: now.toISOString(),
    }, now)
    expect(Date.parse(sameTeam.expiresAt) - Date.parse(sameTeam.issuedAt)).toBe(5 * 60 * 1000)
  })

  it('requires an exact signed approval request and makes the first decision final', async () => {
    const state = await setup()
    const { workerConfig, launch, controllerKeys } = state
    const taskId = 'task:' + randomUUID()
    await receiveA2AMessage(
      workerConfig,
      message(controllerKeys, 'task.submit', taskPayload(state, taskId, {
        policyId: 'workspace-write-ask-v1',
        prompt: 'write an approved file',
      })),
      launch,
    )
    const { approvalDirectory, intent } = await installApprovalIntent(state, taskId)
    const status = message(controllerKeys, 'task.status', { taskId })
    const pending = await receiveA2AMessage(workerConfig, status, launch)
    expect(pending.response).toMatchObject({
      kind: 'task.approval.request',
      payload: {
        approvalId: intent.approvalId,
        taskId,
        taskBindingDigest: intent.taskBindingDigest,
        toolCallId: intent.toolCallId,
        argumentsDigest: intent.argumentsDigest,
      },
    })

    const request = pending.response
    const decidedAt = new Date().toISOString()
    const decisionPayload = {
      approvalId: intent.approvalId,
      taskId,
      approvalRequestMessageId: request.messageId,
      approvalRequestPayloadDigest: request.payloadDigest,
      taskBindingDigest: intent.taskBindingDigest,
      toolCallId: intent.toolCallId,
      argumentsDigest: intent.argumentsDigest,
      decision: 'allowed-once',
      decidedAt,
    }
    const decision = message(controllerKeys, 'task.approval.decision', decisionPayload)
    await expect(receiveA2AMessage(workerConfig, decision, launch)).resolves.toMatchObject({
      response: { kind: 'receipt', payload: { status: 'accepted' } },
    })
    const stored = JSON.parse(await readFile(join(approvalDirectory, 'decision.json'), 'utf8')) as {
      decision: string; token: { consumedAt: string | null; argumentsDigest: string }
    }
    expect(stored).toMatchObject({
      decision: 'allowed-once',
      token: { consumedAt: null, argumentsDigest: intent.argumentsDigest },
    })

    const decisionReceiptPath = join(
      workerConfig.stateDir,
      'a2a',
      'receipts',
      createHash('sha256').update(decision.messageId).digest('hex') + '.json',
    )
    await rm(decisionReceiptPath)
    await expect(receiveA2AMessage(workerConfig, decision, launch)).resolves.toMatchObject({
      response: { kind: 'receipt', payload: { status: 'accepted' } },
    })

    const secondDecision = message(controllerKeys, 'task.approval.decision', {
      ...decisionPayload,
      decision: 'rejected',
      decidedAt: new Date().toISOString(),
    })
    await expect(receiveA2AMessage(workerConfig, secondDecision, launch))
      .rejects.toMatchObject({ code: 'task-approval-already-decided' })
  })

  it('rejects mutated and expired approval decisions without minting a token', async () => {
    const state = await setup()
    const { workerConfig, launch, controllerKeys } = state
    const taskId = 'task:' + randomUUID()
    await receiveA2AMessage(
      workerConfig,
      message(controllerKeys, 'task.submit', taskPayload(state, taskId, {
        policyId: 'workspace-write-ask-v1',
        prompt: 'approval mismatch checks',
      })),
      launch,
    )
    const now = new Date()
    const expiresAt = new Date(now.getTime() + 1000).toISOString()
    const { approvalDirectory, intent } = await installApprovalIntent(state, taskId, { expiresAt })
    const pending = await receiveA2AMessage(workerConfig, message(controllerKeys, 'task.status', { taskId }), launch, now)
    const request = pending.response
    const baseDecision = {
      approvalId: intent.approvalId,
      taskId,
      approvalRequestMessageId: request.messageId,
      approvalRequestPayloadDigest: request.payloadDigest,
      taskBindingDigest: intent.taskBindingDigest,
      toolCallId: intent.toolCallId,
      argumentsDigest: intent.argumentsDigest,
      decision: 'allowed-once',
      decidedAt: now.toISOString(),
    }
    await expect(receiveA2AMessage(
      workerConfig,
      message(controllerKeys, 'task.approval.decision', { ...baseDecision, argumentsDigest: 'f'.repeat(64) }),
      launch,
      now,
    )).rejects.toMatchObject({ code: 'task-approval-mismatch' })
    expect(await readFile(join(approvalDirectory, 'intent.json'), 'utf8')).toContain(intent.argumentsDigest)

    const expiredNow = new Date(now.getTime() + 2000)
    await expect(receiveA2AMessage(
      workerConfig,
      message(controllerKeys, 'task.approval.decision', { ...baseDecision, decidedAt: expiredNow.toISOString() }),
      launch,
      expiredNow,
    )).rejects.toMatchObject({ code: 'task-approval-expired' })
    await expect(readFile(join(approvalDirectory, 'decision.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('stores foreign advisory messages separately and signs the receipt back to the sender team', async () => {
    const state = await setup()
    const { workerConfig, launch, controllerTrustMap } = state
    const partnerKeys = generateKeyPairSync('ed25519')
    const partnerPublic = partnerKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString()
    const partnerTrust: FleetA2ATrustEntry = {
      teamId: 'partner-team',
      keyId: a2aKeyId(partnerKeys.publicKey),
      principalId: 'partner-owner',
      deviceId: 'partner-controller',
      publicKeyPem: partnerPublic,
      allowedKinds: ['handoff'],
    }
    const trustStore = JSON.parse(await readFile(workerConfig.a2a!.trustStorePath, 'utf8')) as {
      schemaVersion: number; teamId: string; entries: FleetA2ATrustEntry[]
    }
    trustStore.entries.push(partnerTrust)
    await writeFile(workerConfig.a2a!.trustStorePath, JSON.stringify(trustStore, null, 2) + '\n')
    const envelope = createA2AEnvelope({
      teamId: 'partner-team',
      sender: { principalId: 'partner-owner', deviceId: 'partner-controller' },
      recipient: { teamId: 'example-team', deviceId: 'worker' },
      kind: 'handoff',
      payload: {
        handoffId: 'handoff:' + randomUUID(),
        taskId: null,
        summary: 'Review this advisory only.',
        artifactRefs: ['display-only:release-digest'],
      },
      privateKey: partnerKeys.privateKey,
    })
    const receipt = await receiveA2AMessage(workerConfig, envelope, launch)
    expect(receipt.response).toMatchObject({
      teamId: 'example-team',
      recipient: { teamId: 'partner-team', deviceId: 'partner-controller' },
      kind: 'receipt',
      payload: { requestMessageId: envelope.messageId, status: 'stored' },
    })
    expect(verifyA2AEnvelope(receipt.response, {
      expectedTeamId: 'partner-team',
      expectedDeviceId: 'partner-controller',
      trust: controllerTrustMap,
      now: new Date(),
    })).toEqual(receipt.response)
    const inbox = await listFederationInbox(join(workerConfig.stateDir, 'federation'))
    expect(inbox).toHaveLength(1)
    expect(inbox[0]?.record.envelope).toEqual(envelope)
  })

  it('binds a cached receipt to the complete signed request, not only its message id', async () => {
    const state = await setup()
    const { workerConfig, launch, controllerKeys } = state
    const messageId = 'msg:' + randomUUID()
    const first = createA2AEnvelope({
      teamId: 'example-team',
      sender: { principalId: 'owner', deviceId: 'controller' },
      recipient: { deviceId: 'worker' },
      kind: 'handoff',
      payload: { handoffId: 'handoff:' + randomUUID(), taskId: null, summary: 'first', artifactRefs: [] },
      privateKey: controllerKeys.privateKey,
      messageId,
    })
    const conflicting = createA2AEnvelope({
      teamId: 'example-team',
      sender: { principalId: 'owner', deviceId: 'controller' },
      recipient: { deviceId: 'worker' },
      kind: 'handoff',
      payload: { handoffId: 'handoff:' + randomUUID(), taskId: null, summary: 'different', artifactRefs: [] },
      privateKey: controllerKeys.privateKey,
      messageId,
    })
    await expect(receiveA2AMessage(workerConfig, first, launch)).resolves.toMatchObject({
      response: { kind: 'receipt', payload: { requestMessageId: messageId } },
    })
    await expect(receiveA2AMessage(workerConfig, conflicting, launch))
      .rejects.toMatchObject({ code: 'message-id-conflict' })
  })
})

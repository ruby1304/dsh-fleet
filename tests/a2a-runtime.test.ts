import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { FleetAgentConfig } from '../src/agent/config.ts'
import {
  receiveA2AMessage,
  runTaskWorker,
  type A2AWorkerLaunch,
} from '../src/a2a/runtime.ts'
import {
  a2aKeyId,
  createA2AEnvelope,
  verifyA2AEnvelope,
  type FleetA2AKind,
  type FleetA2ATrustEntry,
} from '../src/a2a/protocol.ts'

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
  const dshBinary = join(bin, 'dsh')
  await writeFile(dshBinary, `#!/usr/bin/env node
const args = process.argv.slice(2)
if (args[0] !== '--profile' || args[1] !== 'headless') process.exit(8)
process.stdout.write('completed: ' + args[2] + '\\n')
`)
  await chmod(dshBinary, 0o755)
  const tarBinary = join(bin, 'tar')
  const pnpmBinary = join(bin, 'pnpm')
  await writeFile(tarBinary, '#!/bin/sh\nexit 0\n')
  await writeFile(pnpmBinary, '#!/bin/sh\nexit 0\n')
  await Promise.all([chmod(tarBinary, 0o755), chmod(pnpmBinary, 0o755)])

  const controllerKeys = generateKeyPairSync('ed25519')
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
  const workerKeyId = a2aKeyId(workerKeys.publicKey)
  const controllerTrust: FleetA2ATrustEntry = {
    keyId: controllerKeyId,
    principalId: 'owner',
    deviceId: 'controller',
    publicKeyPem: controllerPublic,
    allowedKinds: ['task.submit', 'task.status', 'task.cancel', 'handoff'],
  }
  const workerTrust: FleetA2ATrustEntry = {
    keyId: workerKeyId,
    principalId: 'worker-agent',
    deviceId: 'worker',
    publicKeyPem: workerPublic,
    allowedKinds: ['task.progress', 'task.result', 'receipt'],
  }
  const workerTrustPath = join(root, 'worker-trust.json')
  const controllerTrustPath = join(root, 'controller-trust.json')
  await Promise.all([
    writeFile(workerTrustPath, JSON.stringify({ schemaVersion: 1, teamId: 'ruby-team', entries: [controllerTrust] }, null, 2)),
    writeFile(controllerTrustPath, JSON.stringify({ schemaVersion: 1, teamId: 'ruby-team', entries: [workerTrust] }, null, 2)),
  ])
  const base = {
    schemaVersion: 2 as const,
    manifestPath: join(root, 'fleet.yaml'),
    dshHome: join(root, 'dsh-home'),
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
    },
  }
  const workerConfig: FleetAgentConfig = {
    ...base,
    deviceId: 'worker',
    stateDir: join(root, 'worker-state'),
    a2a: {
      teamId: 'ruby-team', principalId: 'worker-agent', privateKeyPath: workerPrivatePath,
      trustStorePath: workerTrustPath, maxMessageTtlMs: 15 * 60 * 1000,
    },
  }
  const launch: A2AWorkerLaunch = {
    nodeBinary: '/usr/bin/true',
    agentPath: '/tmp/ignored-agent.mjs',
    configPath: '/tmp/ignored-agent.json',
  }
  const controllerTrustMap = new Map([[workerKeyId, workerTrust]])
  return { root, workerConfig, launch, controllerKeys, controllerTrustMap }
}

function message(
  keys: ReturnType<typeof generateKeyPairSync>,
  kind: FleetA2AKind,
  payload: Record<string, unknown>,
) {
  return createA2AEnvelope({
    teamId: 'ruby-team',
    sender: { principalId: 'owner', deviceId: 'controller' },
    recipient: { deviceId: 'worker' },
    kind,
    payload,
    privateKey: keys.privateKey,
    now: new Date(),
  })
}

describe('durable A2A task channel', () => {
  it('accepts a signed task, survives the request boundary, runs DSH in a fixed workspace and returns a signed result', async () => {
    const { workerConfig, launch, controllerKeys, controllerTrustMap } = await setup()
    const taskId = 'task:' + randomUUID()
    const submit = message(controllerKeys, 'task.submit', {
      taskId,
      workspaceId: 'repo',
      profile: 'headless',
      prompt: 'run the release checks',
    })
    const accepted = await receiveA2AMessage(workerConfig, submit, launch)
    expect(accepted.requestMessageId).toBe(submit.messageId)
    expect(accepted.response).toMatchObject({
      kind: 'task.progress',
      payload: { taskId, state: 'accepted' },
    })
    expect(verifyA2AEnvelope(accepted.response, {
      expectedTeamId: 'ruby-team', expectedDeviceId: 'controller', trust: controllerTrustMap, now: new Date(),
    })).toEqual(accepted.response)

    const finished = await runTaskWorker(workerConfig, taskId)
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
      expectedTeamId: 'ruby-team', expectedDeviceId: 'controller', trust: controllerTrustMap, now: new Date(),
    })).toEqual(result.response)

    const replay = await receiveA2AMessage(workerConfig, submit, launch)
    expect(replay).toEqual(accepted)
  })

  it('applies local workspace policy and persists cancellation before execution', async () => {
    const { workerConfig, launch, controllerKeys } = await setup()
    const denied = message(controllerKeys, 'task.submit', {
      taskId: 'task:' + randomUUID(), workspaceId: 'unknown', profile: 'headless', prompt: 'do not run',
    })
    await expect(receiveA2AMessage(workerConfig, denied, launch)).rejects.toMatchObject({ code: 'task-policy-denied' })

    const taskId = 'task:' + randomUUID()
    const submit = message(controllerKeys, 'task.submit', { taskId, workspaceId: 'repo', profile: 'headless', prompt: 'wait' })
    await receiveA2AMessage(workerConfig, submit, launch)
    const cancel = message(controllerKeys, 'task.cancel', { taskId })
    const cancellation = await receiveA2AMessage(workerConfig, cancel, launch)
    expect(cancellation.response).toMatchObject({ kind: 'task.progress', payload: { state: 'cancel-requested' } })
    await expect(runTaskWorker(workerConfig, taskId)).resolves.toMatchObject({ state: 'cancelled', errorCode: 'cancelled' })
  })

  it('reaps crashed receipt and worker locks without replaying a completed request', async () => {
    const { workerConfig, launch, controllerKeys } = await setup()
    const taskId = 'task:' + randomUUID()
    const submit = message(controllerKeys, 'task.submit', { taskId, workspaceId: 'repo', profile: 'headless', prompt: 'recover locks' })
    const receiptDirectory = join(workerConfig.stateDir, 'a2a', 'receipts')
    await mkdir(receiptDirectory, { recursive: true })
    const receiptLock = join(receiptDirectory, createHash('sha256').update(submit.messageId).digest('hex') + '.json.lock')
    await writeFile(receiptLock, JSON.stringify({ pid: 2_147_483_647, token: randomUUID() }))

    await expect(receiveA2AMessage(workerConfig, submit, launch)).resolves.toMatchObject({ response: { payload: { state: 'accepted' } } })
    const workerLock = join(workerConfig.stateDir, 'tasks', taskId.slice('task:'.length), 'worker.lock')
    await writeFile(workerLock, JSON.stringify({ pid: 2_147_483_647, token: randomUUID() }))
    await expect(runTaskWorker(workerConfig, taskId)).resolves.toMatchObject({ state: 'succeeded' })
  })

  it('serializes concurrent signed submissions for the same durable task id', async () => {
    const { workerConfig, launch, controllerKeys } = await setup()
    const taskId = 'task:' + randomUUID()
    const payload = { taskId, workspaceId: 'repo', profile: 'headless', prompt: 'run once' }
    const [first, second] = await Promise.all([
      receiveA2AMessage(workerConfig, message(controllerKeys, 'task.submit', payload), launch),
      receiveA2AMessage(workerConfig, message(controllerKeys, 'task.submit', payload), launch),
    ])
    expect(first.response).toMatchObject({ payload: { taskId, state: 'accepted' } })
    expect(second.response).toMatchObject({ payload: { taskId, state: 'accepted' } })
    await expect(runTaskWorker(workerConfig, taskId)).resolves.toMatchObject({ state: 'succeeded' })
  })
})

import { generateKeyPairSync } from 'node:crypto'
import { chmod, lstat, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  a2aKeyId,
  createA2AEnvelope,
  type FleetA2AEnvelope,
  type FleetA2AKind,
  type FleetA2ATrustEntry,
} from '../src/a2a/protocol.ts'
import {
  acknowledgeFederationMessage,
  applyFederationInboxPrune,
  federationApprovalView,
  federationArtifactLabels,
  federationReceiptPayload,
  listFederationInbox,
  planFederationInboxPrune,
  receiveFederationEnvelope,
  type FleetFederationInboxItem,
  type FleetFederationInboxRecord,
} from '../src/federation/inbox.ts'

const roots: string[] = []
const TASK_ID = 'task:11111111-1111-4111-8111-111111111111'
const APPROVAL_ID = 'approval:33333333-3333-4333-8333-333333333333'
const RETENTION_POLICY = {
  acknowledgedRetentionMs: 5 * 60_000,
  expiredRetentionMs: 5 * 60_000,
  maxEntries: 100,
} as const

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function stateRoot(): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), 'dsh-fleet-federation-'))
  roots.push(parent)
  return join(parent, 'state')
}

function foreignFixture(
  kind: FleetA2AKind = 'handoff',
  payload: Record<string, unknown> = {
    handoffId: 'handoff:44444444-4444-4444-8444-444444444444',
    taskId: null,
    summary: 'Review the bounded release notes.',
    artifactRefs: ['https://artifacts.invalid/display-only', 'release-sha256-abc123'],
  },
  options: { messageId?: string; now?: string; ttlMs?: number } = {},
) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const keyId = a2aKeyId(publicKey)
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const trust: Record<string, FleetA2ATrustEntry> = {
    [keyId]: {
      teamId: 'partner-team', keyId, principalId: 'partner-owner', deviceId: 'partner-controller', publicKeyPem,
      allowedKinds: [kind],
    },
  }
  const envelope = createA2AEnvelope({
    teamId: 'partner-team',
    sender: { principalId: 'partner-owner', deviceId: 'partner-controller' },
    recipient: { teamId: 'example-team', deviceId: 'worker' },
    kind,
    payload,
    privateKey,
    now: options.now ?? '2026-08-19T00:00:00.000Z',
    ...(options.ttlMs === undefined ? {} : { ttlMs: options.ttlMs }),
    ...(options.messageId === undefined ? {} : { messageId: options.messageId }),
  })
  return { privateKey, publicKeyPem, keyId, trust, envelope }
}

function verification(trust: Record<string, FleetA2ATrustEntry>, now = '2026-08-19T00:01:00.000Z') {
  return { expectedTeamId: 'example-team', expectedDeviceId: 'worker', trust, now }
}

describe('owner-only advisory federation inbox', () => {
  it('stores metadata once, lists it, and exposes artifact references only as plain labels', async () => {
    const rootDirectory = await stateRoot()
    const { envelope, trust } = foreignFixture()
    const first = await receiveFederationEnvelope({ rootDirectory, value: envelope, verification: verification(trust) })
    const duplicate = await receiveFederationEnvelope({ rootDirectory, value: envelope, verification: verification(trust) })

    expect(first.status).toBe('stored')
    expect(duplicate).toEqual({ status: 'duplicate', record: first.record })
    expect((await lstat(rootDirectory)).mode & 0o777).toBe(0o700)
    expect((await lstat(join(rootDirectory, 'inbox'))).mode & 0o777).toBe(0o700)
    const items = await listFederationInbox(rootDirectory, { now: '2026-08-19T00:01:00.000Z' })
    expect(items).toHaveLength(1)
    expect(items[0]?.record.envelope.teamId).toBe('partner-team')
    expect(items[0]?.record.envelope.recipient.teamId).toBe('example-team')
    expect(federationArtifactLabels(items[0]!.record)).toEqual([
      'https://artifacts.invalid/display-only',
      'release-sha256-abc123',
    ])
    const storedFile = join(rootDirectory, 'inbox', envelope.messageId.slice(4) + '.json')
    expect((await lstat(storedFile)).mode & 0o777).toBe(0o600)
  })

  it('rejects a second signed envelope that reuses a message id with different metadata', async () => {
    const rootDirectory = await stateRoot()
    const fixture = foreignFixture()
    await receiveFederationEnvelope({ rootDirectory, value: fixture.envelope, verification: verification(fixture.trust) })
    const changed = createA2AEnvelope({
      teamId: 'partner-team',
      sender: { principalId: 'partner-owner', deviceId: 'partner-controller' },
      recipient: { teamId: 'example-team', deviceId: 'worker' },
      kind: 'handoff',
      payload: { ...fixture.envelope.payload, summary: 'A different signed handoff.' },
      privateKey: fixture.privateKey,
      now: '2026-08-19T00:00:00.000Z',
      messageId: fixture.envelope.messageId,
    })
    await expect(receiveFederationEnvelope({
      rootDirectory, value: changed, verification: verification(fixture.trust),
    })).rejects.toMatchObject({ code: 'message-conflict' })
  })

  it('rejects foreign task messages even when a trust entry is accidentally overprivileged', async () => {
    const rootDirectory = await stateRoot()
    const fixture = foreignFixture('task.submit', {
      taskId: TASK_ID,
      workspaceId: 'project',
      profile: 'headless',
      executionProfileHash: '9'.repeat(64),
      manifestDigest: 'a'.repeat(64),
      releaseDigest: 'b'.repeat(64),
      policyId: 'readonly-v1',
      policyDigest: 'c'.repeat(64),
      deadline: '2026-08-19T00:10:00.000Z',
      prompt: 'This must never execute across teams.',
    })
    await expect(receiveFederationEnvelope({
      rootDirectory, value: fixture.envelope, verification: verification(fixture.trust),
    })).rejects.toThrow(/advisory federation messages only/)

    const sameTeam = foreignFixture()
    const localTrust = {
      [sameTeam.keyId]: { ...sameTeam.trust[sameTeam.keyId]!, teamId: 'example-team' },
    }
    const localEnvelope = createA2AEnvelope({
      teamId: 'example-team',
      sender: { principalId: 'partner-owner', deviceId: 'partner-controller' },
      recipient: { teamId: 'example-team', deviceId: 'worker' },
      kind: 'handoff',
      payload: sameTeam.envelope.payload,
      privateKey: sameTeam.privateKey,
      now: '2026-08-19T00:00:00.000Z',
    })
    await expect(receiveFederationEnvelope({
      rootDirectory, value: localEnvelope, verification: verification(localTrust),
    })).rejects.toMatchObject({ code: 'not-foreign-advisory' })
  })

  it('makes the first acknowledgement final and keeps advisory approval separate from tool authorization', async () => {
    const rootDirectory = await stateRoot()
    const fixture = foreignFixture('approval.request', {
      approvalId: APPROVAL_ID,
      taskId: TASK_ID,
      summary: 'Should the partner continue its own release?',
      expiresAt: '2026-08-19T00:04:00.000Z',
    })
    const received = await receiveFederationEnvelope({ rootDirectory, value: fixture.envelope, verification: verification(fixture.trust) })
    const input = {
      rootDirectory,
      messageId: fixture.envelope.messageId,
      expectedPayloadDigest: fixture.envelope.payloadDigest,
      disposition: 'acknowledged' as const,
      acknowledgedAt: '2026-08-19T00:02:00.000Z',
    }
    expect((await acknowledgeFederationMessage(input)).status).toBe('acknowledged')
    expect((await acknowledgeFederationMessage({ ...input, acknowledgedAt: '2026-08-19T00:03:00.000Z' })).status).toBe('duplicate')
    await expect(acknowledgeFederationMessage({ ...input, disposition: 'dismissed' })).rejects.toMatchObject({
      code: 'acknowledgement-conflict',
    })
    expect(federationApprovalView(received.record)).toEqual({
      kind: 'approval.request',
      approvalId: APPROVAL_ID,
      taskId: TASK_ID,
      summary: 'Should the partner continue its own release?',
      expiresAt: '2026-08-19T00:04:00.000Z',
    })
    expect(federationReceiptPayload(received.record)).toEqual({ requestMessageId: fixture.envelope.messageId, status: 'stored' })
    expect(federationApprovalView(received.record)).not.toHaveProperty('allowedOnceToken')
  })

  it('fails closed on loose state permissions and symlinked inbox records', async () => {
    const rootDirectory = await stateRoot()
    const first = foreignFixture()
    await receiveFederationEnvelope({ rootDirectory, value: first.envelope, verification: verification(first.trust) })
    await chmod(rootDirectory, 0o755)
    await expect(listFederationInbox(rootDirectory)).rejects.toMatchObject({ code: 'unsafe-state-permissions' })
    await chmod(rootDirectory, 0o700)

    const second = foreignFixture('handoff', {
      handoffId: 'handoff:55555555-5555-4555-8555-555555555555', taskId: null, summary: 'Second.', artifactRefs: [],
    }, { messageId: 'msg:66666666-6666-4666-8666-666666666666' })
    await symlink('/etc/hosts', join(rootDirectory, 'inbox', second.envelope.messageId.slice(4) + '.json'))
    await expect(receiveFederationEnvelope({
      rootDirectory, value: second.envelope, verification: verification(second.trust),
    })).rejects.toMatchObject({ code: 'unsafe-state-path' })
  })

  it('plans retention without selecting fresh unacknowledged messages', () => {
    const makeItem = (
      id: string,
      issuedAt: string,
      receivedAt: string,
      acknowledgementAt: string | null,
    ): FleetFederationInboxItem => {
      const fixture = foreignFixture('handoff', {
        handoffId: 'handoff:77777777-7777-4777-8777-777777777777', taskId: null, summary: id, artifactRefs: [],
      }, { messageId: id, now: issuedAt, ttlMs: 60_000 })
      const record: FleetFederationInboxRecord = { schemaVersion: 1, receivedAt, envelope: fixture.envelope as FleetA2AEnvelope }
      return {
        record,
        acknowledgement: acknowledgementAt === null ? null : {
          schemaVersion: 1,
          messageId: id,
          payloadDigest: fixture.envelope.payloadDigest,
          disposition: 'acknowledged',
          acknowledgedAt: acknowledgementAt,
        },
        expired: Date.parse(fixture.envelope.expiresAt) <= Date.parse('2026-08-19T00:20:00.000Z'),
      }
    }
    const oldAcknowledged = makeItem(
      'msg:11111111-1111-4111-8111-111111111111',
      '2026-08-19T00:00:00.000Z', '2026-08-19T00:00:10.000Z', '2026-08-19T00:02:00.000Z',
    )
    const oldExpired = makeItem(
      'msg:22222222-2222-4222-8222-222222222222',
      '2026-08-19T00:01:00.000Z', '2026-08-19T00:01:10.000Z', null,
    )
    const fresh = makeItem(
      'msg:33333333-3333-4333-8333-333333333333',
      '2026-08-19T00:19:30.000Z', '2026-08-19T00:19:31.000Z', null,
    )
    expect(planFederationInboxPrune([fresh, oldExpired, oldAcknowledged], {
      acknowledgedRetentionMs: 5 * 60_000,
      expiredRetentionMs: 5 * 60_000,
      maxEntries: 100,
    }, '2026-08-19T00:20:00.000Z')).toEqual([
      expect.objectContaining({ messageId: oldAcknowledged.record.envelope.messageId, reason: 'acknowledged-retention' }),
      expect.objectContaining({ messageId: oldExpired.record.envelope.messageId, reason: 'expired-retention' }),
    ])
    expect(planFederationInboxPrune([fresh, oldExpired, oldAcknowledged], {
      acknowledgedRetentionMs: 60 * 60_000,
      expiredRetentionMs: 60 * 60_000,
      maxEntries: 1,
    }, '2026-08-19T00:20:00.000Z').map(candidate => candidate.messageId)).toEqual([
      oldAcknowledged.record.envelope.messageId,
      oldExpired.record.envelope.messageId,
    ])
  })

  it('CAS-prunes an exact current plan and removes only its inbox record and acknowledgement', async () => {
    const rootDirectory = await stateRoot()
    const first = foreignFixture()
    const second = foreignFixture('handoff', {
      handoffId: 'handoff:88888888-8888-4888-8888-888888888888', taskId: null, summary: 'Keep this message.', artifactRefs: [],
    }, { messageId: 'msg:88888888-8888-4888-8888-888888888888' })
    await receiveFederationEnvelope({ rootDirectory, value: first.envelope, verification: verification(first.trust) })
    await receiveFederationEnvelope({ rootDirectory, value: second.envelope, verification: verification(second.trust) })
    await acknowledgeFederationMessage({
      rootDirectory,
      messageId: first.envelope.messageId,
      expectedPayloadDigest: first.envelope.payloadDigest,
      disposition: 'acknowledged',
      acknowledgedAt: '2026-08-19T00:02:00.000Z',
    })
    const items = await listFederationInbox(rootDirectory, { now: '2026-08-19T00:20:00.000Z', limit: 10 })
    const plan = planFederationInboxPrune(items, RETENTION_POLICY, '2026-08-19T00:20:00.000Z')
    const firstCandidate = plan.find(candidate => candidate.messageId === first.envelope.messageId)
    expect(firstCandidate).toEqual(expect.objectContaining({ reason: 'acknowledged-retention' }))

    const result = await applyFederationInboxPrune({
      rootDirectory,
      candidates: [firstCandidate!],
      policy: RETENTION_POLICY,
      now: '2026-08-19T00:20:00.000Z',
    })
    expect(result).toEqual({ pruned: [firstCandidate], skipped: [] })
    expect((await listFederationInbox(rootDirectory, { now: '2026-08-19T00:20:00.000Z', limit: 10 }))
      .map(item => item.record.envelope.messageId)).toEqual([second.envelope.messageId])
    await expect(lstat(join(rootDirectory, 'inbox', first.envelope.messageId.slice(4) + '.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(lstat(join(rootDirectory, 'acknowledgements', first.envelope.messageId.slice(4) + '.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('skips stale digest, changed reason and fresh unacknowledged candidates without deleting state', async () => {
    const rootDirectory = await stateRoot()
    const old = foreignFixture()
    const fresh = foreignFixture('handoff', {
      handoffId: 'handoff:99999999-9999-4999-8999-999999999999', taskId: null, summary: 'Fresh.', artifactRefs: [],
    }, {
      messageId: 'msg:99999999-9999-4999-8999-999999999999',
      now: '2026-08-19T00:19:30.000Z',
    })
    await receiveFederationEnvelope({ rootDirectory, value: old.envelope, verification: verification(old.trust) })
    await receiveFederationEnvelope({
      rootDirectory,
      value: fresh.envelope,
      verification: verification(fresh.trust, '2026-08-19T00:19:40.000Z'),
    })
    const oldPlan = planFederationInboxPrune(
      await listFederationInbox(rootDirectory, { now: '2026-08-19T00:20:00.000Z', limit: 10 }),
      RETENTION_POLICY,
      '2026-08-19T00:20:00.000Z',
    ).find(candidate => candidate.messageId === old.envelope.messageId)!
    const result = await applyFederationInboxPrune({
      rootDirectory,
      candidates: [
        { ...oldPlan, payloadDigest: '0'.repeat(64) },
        { messageId: fresh.envelope.messageId, payloadDigest: fresh.envelope.payloadDigest, reason: 'capacity' },
      ],
      policy: RETENTION_POLICY,
      now: '2026-08-19T00:20:00.000Z',
    })
    expect(result.pruned).toEqual([])
    expect(result.skipped.map(item => item.reason)).toEqual(['changed', 'not-eligible'])

    const changedReason = await applyFederationInboxPrune({
      rootDirectory,
      candidates: [{ ...oldPlan, reason: 'capacity' }],
      policy: RETENTION_POLICY,
      now: '2026-08-19T00:20:00.000Z',
    })
    expect(changedReason.skipped).toEqual([{ candidate: { ...oldPlan, reason: 'capacity' }, reason: 'plan-changed' }])
    expect(await listFederationInbox(rootDirectory, { now: '2026-08-19T00:20:00.000Z', limit: 10 })).toHaveLength(2)
  })

  it('rechecks acknowledgement state under the message lock before applying an older plan', async () => {
    const rootDirectory = await stateRoot()
    const fixture = foreignFixture()
    await receiveFederationEnvelope({ rootDirectory, value: fixture.envelope, verification: verification(fixture.trust) })
    const oldPlan = planFederationInboxPrune(
      await listFederationInbox(rootDirectory, { now: '2026-08-19T00:20:00.000Z' }),
      RETENTION_POLICY,
      '2026-08-19T00:20:00.000Z',
    )
    expect(oldPlan[0]?.reason).toBe('expired-retention')
    await acknowledgeFederationMessage({
      rootDirectory,
      messageId: fixture.envelope.messageId,
      expectedPayloadDigest: fixture.envelope.payloadDigest,
      disposition: 'acknowledged',
      acknowledgedAt: '2026-08-19T00:19:30.000Z',
    })
    const result = await applyFederationInboxPrune({
      rootDirectory,
      candidates: oldPlan,
      policy: RETENTION_POLICY,
      now: '2026-08-19T00:20:00.000Z',
    })
    expect(result).toEqual({
      pruned: [],
      skipped: [{ candidate: oldPlan[0], reason: 'not-eligible' }],
    })
    expect(await listFederationInbox(rootDirectory, { now: '2026-08-19T00:20:00.000Z' })).toHaveLength(1)
  })

  it('rejects arbitrary candidate paths, loose files and symlinked acknowledgements', async () => {
    const rootDirectory = await stateRoot()
    const fixture = foreignFixture()
    await receiveFederationEnvelope({ rootDirectory, value: fixture.envelope, verification: verification(fixture.trust) })
    const plan = planFederationInboxPrune(
      await listFederationInbox(rootDirectory, { now: '2026-08-19T00:20:00.000Z' }),
      RETENTION_POLICY,
      '2026-08-19T00:20:00.000Z',
    )
    await expect(applyFederationInboxPrune({
      rootDirectory,
      candidates: [{ ...plan[0]!, path: '/etc/hosts' } as never],
      policy: RETENTION_POLICY,
      now: '2026-08-19T00:20:00.000Z',
    })).rejects.toThrow(/unsupported or missing fields/)

    const recordPath = join(rootDirectory, 'inbox', fixture.envelope.messageId.slice(4) + '.json')
    await chmod(recordPath, 0o644)
    await expect(applyFederationInboxPrune({
      rootDirectory, candidates: plan, policy: RETENTION_POLICY, now: '2026-08-19T00:20:00.000Z',
    })).rejects.toMatchObject({ code: 'unsafe-state-permissions' })
    await chmod(recordPath, 0o600)

    const acknowledgementPath = join(rootDirectory, 'acknowledgements', fixture.envelope.messageId.slice(4) + '.json')
    await symlink('/etc/hosts', acknowledgementPath)
    await expect(applyFederationInboxPrune({
      rootDirectory, candidates: plan, policy: RETENTION_POLICY, now: '2026-08-19T00:20:00.000Z',
    })).rejects.toMatchObject({ code: 'unsafe-state-path' })
  })

  it('skips a candidate whose owner-only message lock is already held', async () => {
    const rootDirectory = await stateRoot()
    const fixture = foreignFixture()
    await receiveFederationEnvelope({ rootDirectory, value: fixture.envelope, verification: verification(fixture.trust) })
    const plan = planFederationInboxPrune(
      await listFederationInbox(rootDirectory, { now: '2026-08-19T00:20:00.000Z' }),
      RETENTION_POLICY,
      '2026-08-19T00:20:00.000Z',
    )
    await writeFile(join(rootDirectory, 'locks', fixture.envelope.messageId.slice(4) + '.lock'), 'held\n', { mode: 0o600 })
    expect(await applyFederationInboxPrune({
      rootDirectory, candidates: plan, policy: RETENTION_POLICY, now: '2026-08-19T00:20:00.000Z',
    })).toEqual({ pruned: [], skipped: [{ candidate: plan[0], reason: 'busy' }] })
    expect(await listFederationInbox(rootDirectory, { now: '2026-08-19T00:20:00.000Z' })).toHaveLength(1)
  })
})

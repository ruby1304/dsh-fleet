import { link, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertA2AReadyConfig,
  calculateTaskPolicyDigest,
  LOCAL_TASK_POLICIES,
  parseAgentConfig,
  type CanonicalTaskPolicy,
} from '../src/agent/config.ts'
import {
  consumeAllowedOnceToken,
  createAllowedOnceToken,
  createTaskBindingDigest,
  digestToolArguments,
  MAX_TASK_TOOL_ARGUMENT_BYTES,
  type TaskBindingInput,
} from '../src/worker/context.ts'
import { classifyTaskToolCall, resolveTaskPolicy, validateTaskToolFilesystemScope } from '../src/worker/policy.ts'
import { assertExecutionProfileHash, computeExecutionProfileHash } from '../src/worker/profile.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

function configValue(policyIds?: string[]) {
  return {
    schemaVersion: 2,
    deviceId: 'worker',
    manifestPath: '/tmp/dsh-fleet/fleet.lock.yaml',
    dshHome: '/tmp/dsh-fleet/dsh-home',
    dshBinary: '/tmp/dsh-fleet/bin/dsh',
    pnpmBinary: '/tmp/dsh-fleet/bin/pnpm',
    profile: 'web',
    stateDir: '/tmp/dsh-fleet/state',
    planTtlMs: 600_000,
    restart: { kind: 'none' },
    health: { timeoutMs: 45_000, requireFleetRpc: false },
    artifactStore: '/tmp/dsh-fleet/artifacts',
    tarBinary: '/usr/bin/tar',
    a2a: {
      teamId: 'example-team',
      principalId: 'owner',
      privateKeyPath: '/tmp/dsh-fleet/identity/private.pem',
      trustStorePath: '/tmp/dsh-fleet/trust.json',
      maxMessageTtlMs: 900_000,
    },
    tasks: {
      enabled: true,
      workspaces: { repo: '/tmp/dsh-fleet/workspace' },
      profiles: ['headless'],
      timeoutMs: 600_000,
      maxOutputBytes: 262_144,
      maxConcurrent: 1,
      ...(policyIds === undefined ? {} : { policyIds }),
    },
  }
}

function body(policy: CanonicalTaskPolicy) {
  const { policyDigest: _policyDigest, ...result } = policy
  return result
}

const bindingInput: TaskBindingInput = {
  teamId: 'example-team',
  submitMessageId: 'msg:11111111-1111-4111-8111-111111111111',
  submitPayloadDigest: 'a'.repeat(64),
  sender: {
    principalId: 'owner',
    deviceId: 'controller',
    keyId: 'ed25519:' + 'b'.repeat(64),
  },
  recipientDeviceId: 'worker',
  taskId: 'task:22222222-2222-4222-8222-222222222222',
  workspaceId: 'repo',
  workspacePath: '/tmp/dsh-fleet/workspace',
  profile: 'headless',
  executionProfileHash: '9'.repeat(64),
  manifestDigest: 'c'.repeat(64),
  releaseDigest: 'd'.repeat(64),
  policyId: 'readonly-v1',
  policyDigest: 'e'.repeat(64),
  deadline: '2026-08-19T00:10:00.000Z',
}

describe('canonical local task policy', () => {
  it('defaults to readonly and computes stable digests after config parsing', () => {
    const defaultConfig = parseAgentConfig(configValue())
    assertA2AReadyConfig(defaultConfig)
    expect(defaultConfig.tasks.policyIds).toEqual(['readonly-v1'])
    expect(defaultConfig.tasks.policies['workspace-write-ask-v1']).toBeUndefined()

    const first = parseAgentConfig(configValue(['readonly-v1', 'workspace-write-ask-v1']))
    const second = parseAgentConfig(configValue(['workspace-write-ask-v1', 'readonly-v1']))
    assertA2AReadyConfig(first)
    assertA2AReadyConfig(second)
    for (const policyId of ['readonly-v1', 'workspace-write-ask-v1'] as const) {
      const policy = first.tasks.policies[policyId]!
      expect(policy.policyDigest).toBe(calculateTaskPolicyDigest(body(policy)))
      expect(second.tasks.policies[policyId]?.policyDigest).toBe(policy.policyDigest)
      expect(policy.permissionMode).not.toBe('danger-full-access')
      expect(policy.defaultDecision).toBe('deny')
    }
  })

  it('rejects unknown or injected policies and requires an exact local digest', () => {
    expect(() => parseAgentConfig(configValue(['danger-full-access']))).toThrow(/installed task policy ids/)
    const injected = configValue() as ReturnType<typeof configValue> & { tasks: Record<string, unknown> }
    injected.tasks.customPolicies = { danger: { permissionMode: 'danger-full-access' } }
    expect(() => parseAgentConfig(injected)).toThrow(/unsupported fields/)

    const readonlyConfig = parseAgentConfig(configValue())
    assertA2AReadyConfig(readonlyConfig)
    expect(() => resolveTaskPolicy(
      readonlyConfig.tasks,
      'workspace-write-ask-v1',
      LOCAL_TASK_POLICIES['workspace-write-ask-v1'].policyDigest,
    )).toThrow(expect.objectContaining({ code: 'policy-not-enabled' }))

    const writeConfig = parseAgentConfig(configValue(['readonly-v1', 'workspace-write-ask-v1']))
    assertA2AReadyConfig(writeConfig)
    expect(() => resolveTaskPolicy(writeConfig.tasks, 'workspace-write-ask-v1', '0'.repeat(64)))
      .toThrow(expect.objectContaining({ code: 'policy-digest-mismatch' }))
    expect(resolveTaskPolicy(
      writeConfig.tasks,
      'workspace-write-ask-v1',
      LOCAL_TASK_POLICIES['workspace-write-ask-v1'].policyDigest,
    )).toBe(LOCAL_TASK_POLICIES['workspace-write-ask-v1'])
  })
})

describe('pure worker tool policy', () => {
  it('allows only workspace-scoped reads and denies unknown tools by default', () => {
    const policy = LOCAL_TASK_POLICIES['readonly-v1']
    expect(classifyTaskToolCall({
      policy, workspacePath: '/tmp/dsh-fleet/workspace', toolName: 'read', arguments: { file_path: 'src/index.ts' },
    })).toMatchObject({ decision: 'safe', reason: 'safe-read' })
    expect(classifyTaskToolCall({
      policy, workspacePath: '/tmp/dsh-fleet/workspace', toolName: 'read', arguments: { file_path: '../secret' },
    })).toMatchObject({ decision: 'deny', reason: 'workspace-scope-denied' })
    expect(classifyTaskToolCall({
      policy, workspacePath: '/tmp/dsh-fleet/workspace', toolName: 'private_deploy', arguments: {},
    })).toMatchObject({ decision: 'deny', reason: 'unknown-tool' })
    expect(classifyTaskToolCall({
      policy, workspacePath: '/tmp/dsh-fleet/workspace', toolName: 'write', arguments: { file_path: 'safe.txt', content: 'x' },
    })).toMatchObject({ decision: 'deny', reason: 'not-permitted-by-policy' })
  })

  it('asks only for bounded foreground mutations and denies escalation or delegation', () => {
    const policy = LOCAL_TASK_POLICIES['workspace-write-ask-v1']
    expect(classifyTaskToolCall({
      policy, workspacePath: '/tmp/dsh-fleet/workspace', toolName: 'edit',
      arguments: { file_path: 'src/index.ts', old_string: 'a', new_string: 'b' },
    })).toMatchObject({ decision: 'ask', capability: 'workspace-mutation' })
    expect(classifyTaskToolCall({
      policy, workspacePath: '/tmp/dsh-fleet/workspace', toolName: 'bash',
      arguments: { command: 'npm test', description: 'Run tests', run_in_background: true },
    })).toMatchObject({ decision: 'deny', reason: 'background-execution-denied' })
    expect(classifyTaskToolCall({
      policy, workspacePath: '/tmp/dsh-fleet/workspace', toolName: 'write',
      arguments: { file_path: 'safe.txt', content: 'x', sandbox_permissions: 'danger-full-access' },
    })).toMatchObject({ decision: 'deny', reason: 'permission-escalation-denied' })
    expect(classifyTaskToolCall({
      policy, workspacePath: '/tmp/dsh-fleet/workspace', toolName: 'run_code', arguments: { code: 'return 1' },
    })).toMatchObject({ decision: 'deny', reason: 'hard-denied-tool' })
  })

  it('uses canonical argument digests and enforces the 16 KiB ceiling', () => {
    expect(digestToolArguments({ b: 2, a: 1 })).toBe(digestToolArguments({ a: 1, b: 2 }))
    expect(() => digestToolArguments({ content: 'x'.repeat(MAX_TASK_TOOL_ARGUMENT_BYTES) }))
      .toThrow(expect.objectContaining({ code: 'arguments-too-large' }))
    expect(classifyTaskToolCall({
      policy: LOCAL_TASK_POLICIES['workspace-write-ask-v1'],
      workspacePath: '/tmp/dsh-fleet/workspace',
      toolName: 'write',
      arguments: { file_path: 'safe.txt', content: 'x'.repeat(MAX_TASK_TOOL_ARGUMENT_BYTES) },
    })).toMatchObject({ decision: 'deny', reason: 'arguments-too-large', argumentsDigest: null })
  })

  it('resolves symlinks and hard links before allowing workspace file access', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-fleet-worker-scope-'))
    temporaryRoots.push(root)
    const workspacePath = join(root, 'workspace')
    const outside = join(root, 'outside')
    await Promise.all([mkdir(workspacePath), mkdir(outside)])
    const workspace = await realpath(workspacePath)
    await writeFile(join(workspace, 'inside.txt'), 'inside\n')
    await writeFile(join(outside, 'secret.txt'), 'secret\n')
    await symlink(join(outside, 'secret.txt'), join(workspace, 'escaped-read.txt'))
    await symlink(outside, join(workspace, 'escaped-directory'))
    await link(join(outside, 'secret.txt'), join(workspace, 'hard-linked-write.txt'))

    await expect(validateTaskToolFilesystemScope({
      workspacePath: workspace, toolName: 'read', arguments: { file_path: 'inside.txt' },
    })).resolves.toBe(true)
    await expect(validateTaskToolFilesystemScope({
      workspacePath: workspace, toolName: 'read', arguments: { file_path: 'escaped-read.txt' },
    })).resolves.toBe(false)
    await expect(validateTaskToolFilesystemScope({
      workspacePath: workspace, toolName: 'write', arguments: { file_path: 'escaped-directory/new.txt', content: 'x' },
    })).resolves.toBe(false)
    await expect(validateTaskToolFilesystemScope({
      workspacePath: workspace, toolName: 'write', arguments: { file_path: 'hard-linked-write.txt', content: 'x' },
    })).resolves.toBe(false)
    await expect(validateTaskToolFilesystemScope({
      workspacePath: workspace, toolName: 'write', arguments: { file_path: 'new/sub/file.txt', content: 'x' },
    })).resolves.toBe(true)
  })
})

describe('task binding and allowed-once consumption', () => {
  it('hashes the complete reproducible execution profile and detects later drift', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-fleet-execution-profile-'))
    temporaryRoots.push(root)
    const profileDirectory = join(root, 'profiles', 'headless')
    await mkdir(profileDirectory, { recursive: true })
    await Promise.all([
      writeFile(join(profileDirectory, 'package.json'), '{"private":true}\n'),
      writeFile(join(profileDirectory, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n'),
      writeFile(join(profileDirectory, 'pnpm-workspace.yaml'), 'packages: []\n'),
      writeFile(join(profileDirectory, 'cordis.patch.yml'), '[]\n'),
      writeFile(join(profileDirectory, 'cordis.yml'), '[]\n'),
      writeFile(join(profileDirectory, 'fleet.lock.yaml'), 'schemaVersion: 2\n'),
    ])
    const profileHash = await computeExecutionProfileHash(root, 'headless')
    await expect(assertExecutionProfileHash(root, 'headless', profileHash)).resolves.toBeUndefined()
    await writeFile(join(profileDirectory, 'cordis.patch.yml'), '- changed: true\n')
    await expect(assertExecutionProfileHash(root, 'headless', profileHash))
      .rejects.toMatchObject({ code: 'execution-profile-invalid' })
  })

  it('binds sender key, signed payload, release, policy, deadline and local workspace', () => {
    const digest = createTaskBindingDigest(bindingInput)
    const variants: TaskBindingInput[] = [
      { ...bindingInput, submitPayloadDigest: 'f'.repeat(64) },
      { ...bindingInput, sender: { ...bindingInput.sender, principalId: 'other-owner' } },
      { ...bindingInput, sender: { ...bindingInput.sender, deviceId: 'other-controller' } },
      { ...bindingInput, sender: { ...bindingInput.sender, keyId: 'ed25519:' + 'f'.repeat(64) } },
      { ...bindingInput, workspaceId: 'other-repo' },
      { ...bindingInput, workspacePath: '/tmp/dsh-fleet/other-workspace' },
      { ...bindingInput, executionProfileHash: 'f'.repeat(64) },
      { ...bindingInput, manifestDigest: 'f'.repeat(64) },
      { ...bindingInput, releaseDigest: 'f'.repeat(64) },
      { ...bindingInput, policyId: 'workspace-write-ask-v1' },
      { ...bindingInput, policyDigest: 'f'.repeat(64) },
      { ...bindingInput, deadline: '2026-08-19T00:11:00.000Z' },
    ]
    expect(digest).toMatch(/^[0-9a-f]{64}$/)
    for (const variant of variants) expect(createTaskBindingDigest(variant)).not.toBe(digest)
  })

  it('consumes an exact approval token once and fails closed on replay or mismatch', () => {
    const toolArguments = { file_path: 'safe.txt', content: 'approved content' }
    const token = createAllowedOnceToken({
      approvalId: 'approval:33333333-3333-4333-8333-333333333333',
      approvalRequestMessageId: 'msg:44444444-4444-4444-8444-444444444444',
      approvalRequestPayloadDigest: '1'.repeat(64),
      decisionMessageId: 'msg:55555555-5555-4555-8555-555555555555',
      decisionPayloadDigest: '2'.repeat(64),
      taskBindingDigest: '3'.repeat(64),
      executionProfileHash: '4'.repeat(64),
      toolCallId: 'call-1',
      toolName: 'write',
      argumentsDigest: digestToolArguments(toolArguments),
      expiresAt: '2026-08-19T00:05:00.000Z',
    })
    const mismatch = consumeAllowedOnceToken(token, {
      taskBindingDigest: token.taskBindingDigest,
      executionProfileHash: token.executionProfileHash,
      toolCallId: token.toolCallId,
      toolName: token.toolName,
      arguments: { ...toolArguments, content: 'different' },
    }, '2026-08-19T00:01:00.000Z')
    expect(mismatch).toMatchObject({ allowed: false, reason: 'binding-mismatch', token: { consumedAt: null } })

    const profileMismatch = consumeAllowedOnceToken(token, {
      taskBindingDigest: token.taskBindingDigest,
      executionProfileHash: '5'.repeat(64),
      toolCallId: token.toolCallId,
      toolName: token.toolName,
      arguments: toolArguments,
    }, '2026-08-19T00:01:00.000Z')
    expect(profileMismatch).toMatchObject({ allowed: false, reason: 'binding-mismatch', token: { consumedAt: null } })

    const first = consumeAllowedOnceToken(token, {
      taskBindingDigest: token.taskBindingDigest,
      executionProfileHash: token.executionProfileHash,
      toolCallId: token.toolCallId,
      toolName: token.toolName,
      arguments: toolArguments,
    }, '2026-08-19T00:01:00.000Z')
    expect(first).toMatchObject({ allowed: true, reason: 'allowed-once', token: { consumedAt: '2026-08-19T00:01:00.000Z' } })
    const replay = consumeAllowedOnceToken(first.token, {
      taskBindingDigest: token.taskBindingDigest,
      executionProfileHash: token.executionProfileHash,
      toolCallId: token.toolCallId,
      toolName: token.toolName,
      arguments: toolArguments,
    }, '2026-08-19T00:02:00.000Z')
    expect(replay).toMatchObject({ allowed: false, reason: 'already-consumed' })
  })
})

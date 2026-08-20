import TestRenderer, { act } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { apply, FleetCard } from '../src/client/index.tsx'
import type { FleetStatus, FleetUpdates } from '../src/shared.ts'

function renderedText(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(renderedText).join('')
  if (value !== null && typeof value === 'object' && 'children' in value) {
    return renderedText((value as { children?: unknown }).children)
  }
  return ''
}

const status: FleetStatus = {
  generatedAt: '2026-01-01T00:00:00.000Z',
  device: {
    id: 'device-01',
    registered: true,
    assignedTo: 'alice',
    class: 'portable-control',
    channel: 'stable',
    hostname: 'control-host',
    platform: 'darwin',
    arch: 'arm64',
    nodeVersion: 'v22.14.0',
  },
  dsh: { version: '1.2.3', profile: 'control' },
  manifest: { path: '/fleet.yml', loaded: true, teamId: 'team-a' },
  runtime: { failedModules: ['unmanaged-broken'] },
  summary: { desired: 3, aligned: 1, missing: 1, drifted: 1, failed: 0, unmanaged: 1 },
  plugins: [{ id: 'plugin-a', desiredSpec: '1.0.0', runtimeModules: [], runtimePhase: 'active', state: 'aligned' }],
  unmanaged: [{ id: 'plugin-extra', actualSpec: '2.0.0' }],
}

const updateReport: FleetUpdates = {
  enabled: true,
  cached: false,
  stale: false,
  lastAttemptAt: '2026-01-01T00:00:00.000Z',
  snapshot: {
    checkedAt: '2026-01-01T00:00:00.000Z',
    refreshAfter: '2026-01-01T06:00:00.000Z',
    summary: { tracked: 6, available: 2, current: 1, local: 2, missing: 0, errors: 1, unsupported: 0 },
    items: [
      {
        id: '@deepseek-ai/dsh', kind: 'dsh', managed: true, source: 'npm', state: 'available', changeKind: 'version',
        currentVersion: '0.1.0-rc.5', latestVersion: '0.1.0-rc.8',
      },
      {
        id: 'github-plugin', kind: 'plugin', managed: true, source: 'github', state: 'available', changeKind: 'head-changed',
        currentVersion: '1.0.0', currentRevision: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', latestRevision: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      },
      { id: 'local-plugin', kind: 'plugin', managed: true, source: 'local', state: 'local', currentVersion: '0.1.0' },
      { id: 'artifact-plugin', kind: 'plugin', managed: true, source: 'artifact', state: 'local', currentVersion: '1.0.0' },
      { id: 'broken-plugin', kind: 'plugin', managed: true, source: 'npm', state: 'error', errorCode: 'registry-unavailable' },
      { id: 'current-plugin', kind: 'plugin', managed: true, source: 'npm', state: 'current', currentVersion: '2.0.0', latestVersion: '2.0.0' },
    ],
  },
}

const exactGitHubSpec = 'github:team/plugin-a#bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const fleetPlan = {
  protocolVersion: 1,
  planId: 'plan:' + 'a'.repeat(64),
  digest: 'a'.repeat(64),
  deviceId: 'worker',
  profile: 'web',
  manifestDigest: 'b'.repeat(64),
  profileHash: 'c'.repeat(64),
  observedDshVersion: '0.1.0-rc.8',
  pluginId: 'plugin-a',
  action: 'install',
  fromSpec: null,
  exactToSpec: exactGitHubSpec,
  sourceKind: 'github',
  restartRequired: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  expiresAt: '2026-01-01T00:05:00.000Z',
}

function targetReport(candidates: Array<Record<string, unknown>>) {
  return {
    enabled: true,
    targets: [{
      deviceId: 'worker',
      transport: 'ssh',
      online: true,
      inspection: {
        protocolVersion: 1,
        deviceId: 'worker',
        profile: 'web',
        dshVersion: '0.1.0-rc.8',
        manifestDigest: 'b'.repeat(64),
        liveManifestDigest: 'b'.repeat(64),
        desiredManifestDigest: 'b'.repeat(64),
        profileHash: 'c'.repeat(64),
        candidates,
      },
    }],
  }
}

const assignedRelease = { releaseId: 'stable-web', releaseVersion: '3.0.0', releaseDigest: 'd'.repeat(64) }

function releaseTargetReport(options: {
  currentRelease?: typeof assignedRelease
  changes?: Array<Record<string, unknown>>
  tasksEnabled?: boolean
  readiness?: boolean
  liveManifestDigest?: string
  desiredManifestDigest?: string
  retention?: {
    retainedCount: number
    eligibleCount: number
    orphanBackupCount: number
    orphanStageCount: number
    orphanFailedCount: number
    orphanCount: number
    invalidTransitionCount: number
  }
} = {}) {
  return {
    enabled: true,
    ...(options.readiness ? { signer: { configured: true, deviceId: 'worker', ready: true } } : {}),
    targets: [{
      deviceId: 'worker',
      transport: 'ssh',
      online: true,
      mode: 'profile-release',
      ...(options.readiness ? {
        readiness: {
          protocolVersion: 1,
          ready: true,
          deviceId: 'worker',
          profile: 'web',
          releaseId: 'stable-web',
          releaseVersion: '3.0.0',
          healthVerified: true,
          teamId: 'team-a',
          principalId: 'owner',
          identityKeyId: 'ed25519:' + 'a'.repeat(64),
          observedRuntimeDigest: '4'.repeat(64),
          observedServiceDefinitionDigest: null,
          trustedPeerCount: 1,
          trustedPeers: [{
            keyId: 'ed25519:' + 'b'.repeat(64), principalId: 'owner', deviceId: 'worker-2', allowedKinds: ['task.submit'],
          }],
          tasksEnabled: options.tasksEnabled ?? true,
          workspaceIds: ['fleet-repo'],
          taskProfiles: ['headless'],
          executableChecks: ['dsh'],
        },
      } : {}),
      inspection: {
        protocolVersion: 1,
        kind: 'profile-release',
        deviceId: 'worker',
        profile: 'web',
        dshVersion: '0.1.0-rc.8',
        manifestDigest: 'b'.repeat(64),
        liveManifestDigest: options.liveManifestDigest ?? 'b'.repeat(64),
        desiredManifestDigest: options.desiredManifestDigest ?? 'b'.repeat(64),
        observedRuntimeDigest: '4'.repeat(64),
        observedServiceDefinitionDigest: null,
        profileHash: 'c'.repeat(64),
        currentRelease: options.currentRelease ?? null,
        assignedRelease,
        changes: options.changes ?? [],
        tasks: {
          enabled: options.tasksEnabled ?? true,
          timeoutMs: 600_000,
          workspaceIds: ['fleet-repo'],
          profiles: ['headless'],
          executionProfiles: [{ profile: 'headless', profileHash: '3'.repeat(64) }],
          policies: [
            { policyId: 'readonly-v1', policyDigest: '1'.repeat(64), permissionMode: 'read-only' },
            { policyId: 'workspace-write-ask-v1', policyDigest: '2'.repeat(64), permissionMode: 'workspace-write' },
          ],
        },
        retention: options.retention ?? {
          retainedCount: 0, eligibleCount: 0, orphanBackupCount: 0, orphanStageCount: 0,
          orphanFailedCount: 0, orphanCount: 0, invalidTransitionCount: 0,
        },
      },
    }],
  }
}

function taskCatalog(tasks: Array<Record<string, unknown>> = []) {
  return { generatedAt: '2026-08-19T10:00:00.000Z', tasks }
}

function taskCatalogItem(
  taskId: string,
  targetDeviceId = 'worker',
  state: 'accepted' | 'running' | 'cancel-requested' | 'succeeded' | 'failed' | 'cancelled' = 'succeeded',
) {
  return {
    taskId,
    state,
    targetDeviceId,
    workspaceId: 'fleet-repo',
    profile: 'headless',
    createdAt: '2026-08-19T08:00:00.000Z',
    updatedAt: '2026-08-19T09:00:00.000Z',
    errorCode: state === 'failed' ? 'dsh-task-failed' : null,
    resultDigest: state === 'succeeded' ? 'e'.repeat(64) : null,
  }
}

const federationEnvelope = (
  kind: 'handoff' | 'approval.request' | 'approval.decision' | 'receipt',
  payload: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
) => ({
  schemaVersion: 2,
  teamId: 'foreign-team',
  messageId: 'msg:22222222-2222-4222-8222-222222222222',
  sender: { principalId: 'peer-owner', deviceId: 'peer-device', keyId: 'ed25519:' + 'a'.repeat(64) },
  recipient: { teamId: 'team-a', deviceId: 'worker' },
  kind,
  issuedAt: '2026-08-19T10:00:00.000Z',
  expiresAt: '2099-08-19T10:15:00.000Z',
  payloadDigest: 'b'.repeat(64),
  payload,
  signature: 'A'.repeat(86),
  ...overrides,
})

const federationApprovalRequest = federationEnvelope('approval.request', {
  approvalId: 'approval:33333333-3333-4333-8333-333333333333',
  taskId: 'task:44444444-4444-4444-8444-444444444444',
  summary: '请确认跨团队交接范围',
  expiresAt: '2099-08-19T10:12:00.000Z',
})

const federationHandoff = federationEnvelope('handoff', {
  handoffId: 'handoff:55555555-5555-4555-8555-555555555555',
  taskId: null,
  summary: '仅供人工检查的交接',
  artifactRefs: ['https://example.invalid/do-not-open', '/tmp/do-not-open'],
}, { messageId: 'msg:66666666-6666-4666-8666-666666666666', payloadDigest: 'c'.repeat(64) })

describe('dsh-fleet client slots', () => {
  it('registers Fleet as a first-class Settings section and leaves the sidebar footer untouched', () => {
    let setup: (() => unknown) | undefined
    const register = vi.fn((_descriptor: Record<string, unknown>, _component: unknown) => () => {})
    const inject = vi.fn((name: string, callback: () => unknown) => {
      expect(name).toBe('settings.section')
      setup = callback
      return () => {}
    })

    apply({
      connection: { rpc: { call: vi.fn() } },
      slots: { inject, register },
    } as never)

    expect(inject).toHaveBeenCalledOnce()
    expect(register).not.toHaveBeenCalled()

    setup?.()
    expect(register).toHaveBeenCalledOnce()
    expect(register.mock.calls[0]?.[0]).toMatchObject({
      name: 'settings.section',
      id: 'dsh-fleet',
      order: 65,
      label: 'Fleet',
    })
  })

  it('renders as an in-flow Settings page without fixed-position collision geometry', async () => {
    vi.stubGlobal('window', { setInterval: vi.fn(() => 1), clearInterval: vi.fn() })
    vi.stubGlobal('document', { hidden: false })
    const ctx = { connection: { rpc: { call: vi.fn().mockResolvedValue({ ok: true, value: status }) } }, slots: {} } as never
    let component: TestRenderer.ReactTestRenderer | undefined
    try {
      await act(async () => {
        component = TestRenderer.create(<FleetCard ctx={ctx} />)
        await Promise.resolve()
      })
      const root = component!.root.findByProps({ 'data-dsh-fleet-settings': true })
      expect(root.props.style).toMatchObject({
        width: '100%', height: '100%', maxWidth: 960, minHeight: 0,
        display: 'flex', boxSizing: 'border-box', overflow: 'hidden',
      })
      expect(root.props.style.position).not.toBe('fixed')
      expect(root.props.style.background).toBeTruthy()
      expect(component!.root.findByProps({ 'data-dsh-fleet-panel': true }).props.style).toMatchObject({
        height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden',
      })
      expect(component!.root.findByProps({ 'data-dsh-fleet-scroll': true }).props.style).toMatchObject({
        flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain',
      })
      expect(component!.root.findByProps({ 'data-dsh-fleet-tabs': true }).props.style).toMatchObject({
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(48px, 100%), 1fr))',
      })
      for (const tab of component!.root.findAllByProps({ role: 'tab' })) {
        expect(tab.props.style).toMatchObject({ minWidth: 0, whiteSpace: 'normal', overflowWrap: 'anywhere' })
      }
      expect(component!.root.findAllByProps({ 'data-dsh-fleet-action': true })).toHaveLength(0)
    } finally {
      await act(async () => { component?.unmount() })
      vi.unstubAllGlobals()
    }
  })

  it('loads status in the Settings page, shows device and summary fields, and refreshes', async () => {
    const interval = vi.fn(() => 1)
    const clearInterval = vi.fn()
    vi.stubGlobal('window', { setInterval: interval, clearInterval })
    vi.stubGlobal('document', { hidden: false })

    const call = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: status })
      .mockResolvedValueOnce({ ok: true, value: { ...status, summary: { ...status.summary, aligned: 2, missing: 0 } } })
    const ctx = { connection: { rpc: { call } }, slots: {} } as never
    let component: TestRenderer.ReactTestRenderer | undefined
    try {
      await act(async () => {
        component = TestRenderer.create(<FleetCard ctx={ctx} />)
        await Promise.resolve()
      })
      expect(call).toHaveBeenCalledWith('/dsh-fleet', 'status', null)
      expect(interval).toHaveBeenCalledOnce()

      expect(component!.root.findAllByType('strong').some(strong => strong.children.includes('DSH Fleet'))).toBe(true)
      const text = renderedText(component!.toJSON())
      expect(text).toContain('device-01')
      expect(text).toContain('portable-control')
      expect(text).toContain('stable')
      expect(text).toContain('期望 3 · 一致 1 · 缺失 1')
      expect(text).toContain('漂移 1 · 失败 0 · 未管理 1')
      expect(text).toContain('Loader 失败 1 · unmanaged-broken')

      const refresh = component!.root.findAllByType('button').find(button => button.props['aria-label'] === '刷新状态')
      expect(refresh).toBeDefined()
      await act(async () => {
        refresh!.props.onClick()
        await Promise.resolve()
      })
      expect(call).toHaveBeenCalledTimes(2)
    } finally {
      await act(async () => { component?.unmount() })
      vi.unstubAllGlobals()
    }
  })

  it('checks updates only after opening the update tab and keeps force refresh separate', async () => {
    const interval = vi.fn(() => 1)
    vi.stubGlobal('window', { setInterval: interval, clearInterval: vi.fn() })
    vi.stubGlobal('document', { hidden: false })
    const call = vi.fn(async (_channel: string, endpoint: string) => endpoint === 'status'
      ? { ok: true, value: status }
      : { ok: true, value: updateReport })
    const ctx = { connection: { rpc: { call } }, slots: {} } as never
    let component: TestRenderer.ReactTestRenderer | undefined
    try {
      await act(async () => {
        component = TestRenderer.create(<FleetCard ctx={ctx} />)
        await Promise.resolve()
      })
      expect(call.mock.calls.filter(([, endpoint]) => endpoint === 'updates')).toHaveLength(0)

      const updateTab = component!.root.findAllByType('button').find(button => button.props.role === 'tab' && renderedText(button.props.children).startsWith('更新'))
      await act(async () => {
        updateTab!.props.onClick()
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(call).toHaveBeenCalledWith('/dsh-fleet', 'updates', { mode: 'if-stale' })
      expect(interval).toHaveBeenCalledOnce()
      const text = renderedText(component!.toJSON())
      expect(text).toContain('2 个变化')
      expect(text).toContain('DSH Core')
      expect(text).toContain('0.1.0-rc.5 → 0.1.0-rc.8')
      expect(text).toContain('aaaaaaa → bbbbbbb')
      expect(text).toContain('上游有变化')
      expect(text).toContain('本地链接')
      expect(text).toContain('1 个制品')
      expect(text).toContain('1 个本地链接')
      expect(text).toContain('tarball')
      expect(text).toContain('1.0.0 · 不可变制品')
      expect(text).toContain('已固定')
      expect(text).toContain('npm 查询不可用')
      expect(text).toContain('1 个插件已是最新')

      const refresh = component!.root.findAllByType('button').find(button => button.props.children === '重新检查')
      await act(async () => {
        refresh!.props.onClick()
        await Promise.resolve()
      })
      expect(call).toHaveBeenCalledWith('/dsh-fleet', 'updates', { mode: 'force' })
    } finally {
      await act(async () => { component?.unmount() })
      vi.unstubAllGlobals()
    }
  })

  it('shows an initial status RPC failure instead of remaining in loading state', async () => {
    vi.stubGlobal('window', { setInterval: vi.fn(() => 1), clearInterval: vi.fn() })
    vi.stubGlobal('document', { hidden: false })
    const call = vi.fn(async () => ({ ok: false, error: { message: 'initial status unavailable' } }))
    const ctx = { connection: { rpc: { call } }, slots: {} } as never
    let component: TestRenderer.ReactTestRenderer | undefined
    try {
      await act(async () => {
        component = TestRenderer.create(<FleetCard ctx={ctx} />)
        await Promise.resolve()
      })
      expect(renderedText(component!.toJSON())).toContain('initial status unavailable')
      expect(renderedText(component!.toJSON())).not.toContain('载入中…')
    } finally {
      await act(async () => { component?.unmount() })
      vi.unstubAllGlobals()
    }
  })

  it('stops automatic retries after an update error and leaves manual retry enabled', async () => {
    vi.stubGlobal('window', { setInterval: vi.fn(() => 1), clearInterval: vi.fn() })
    vi.stubGlobal('document', { hidden: false })
    const call = vi.fn(async (_channel: string, endpoint: string) => endpoint === 'status'
      ? { ok: true, value: status }
      : { ok: false, error: { message: 'unknown endpoint: updates' } })
    const ctx = { connection: { rpc: { call } }, slots: {} } as never
    let component: TestRenderer.ReactTestRenderer | undefined
    try {
      await act(async () => {
        component = TestRenderer.create(<FleetCard ctx={ctx} />)
        await Promise.resolve()
      })
      const updateTab = component!.root.findAllByType('button').find(button => button.props.role === 'tab' && renderedText(button.props.children).startsWith('更新'))
      await act(async () => {
        updateTab!.props.onClick()
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(call.mock.calls.filter(([, endpoint]) => endpoint === 'updates')).toHaveLength(1)
      expect(renderedText(component!.toJSON())).toContain('unknown endpoint: updates')
      const retry = component!.root.findAllByType('button').find(button => button.props.children === '重新检查')
      expect(retry?.props.disabled).toBe(false)
    } finally {
      await act(async () => { component?.unmount() })
      vi.unstubAllGlobals()
    }
  })

  it('plans an exact operation, confirms once, recovers a failed approval through action-status, and refreshes targets', async () => {
    vi.stubGlobal('window', { setInterval: vi.fn(() => 1), clearInterval: vi.fn() })
    vi.stubGlobal('document', { hidden: false })
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'approval-01') })

    let targetLoads = 0
    const call = vi.fn(async (channel: string, endpoint: string) => {
      if (channel === '/dsh-fleet' && endpoint === 'status') return { ok: true, value: status }
      if (channel === '/dsh-fleet-agent' && endpoint === 'targets') {
        targetLoads += 1
        return {
          ok: true,
          value: targetLoads === 1
            ? targetReport([{
                pluginId: 'plugin-a',
                action: 'install',
                fromSpec: null,
                exactToSpec: exactGitHubSpec,
                sourceKind: 'github',
              }])
            : targetReport([]),
        }
      }
      if (channel === '/dsh-fleet-agent' && endpoint === 'plan') return { ok: true, value: fleetPlan }
      if (channel === '/dsh-fleet-agent' && endpoint === 'approve') {
        return { ok: false, error: { message: 'connection lost after approval' } }
      }
      if (channel === '/dsh-fleet-agent' && endpoint === 'action-status') {
        return {
          ok: true,
          value: {
            planId: fleetPlan.planId,
            pluginId: fleetPlan.pluginId,
            state: 'rolled-back',
            updatedAt: '2026-01-01T00:02:00.000Z',
          },
        }
      }
      return { ok: false, error: { message: `unexpected RPC ${channel} ${endpoint}` } }
    })
    const ctx = { connection: { rpc: { call } }, slots: {} } as never
    let component: TestRenderer.ReactTestRenderer | undefined

    try {
      await act(async () => {
        component = TestRenderer.create(<FleetCard ctx={ctx} />)
        await Promise.resolve()
      })
      const operationsTab = component!.root.findAllByType('button').find(button =>
        button.props.role === 'tab' && renderedText(button.props.children) === '发布',
      )
      await act(async () => {
        operationsTab!.props.onClick()
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(call).toHaveBeenCalledWith('/dsh-fleet-agent', 'targets', null)
      expect(renderedText(component!.toJSON())).toContain(`安装 → ${exactGitHubSpec}`)

      const planButton = component!.root.findAllByType('button').find(button => button.props.children === '生成计划')
      await act(async () => {
        planButton!.props.onClick()
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(call).toHaveBeenCalledWith('/dsh-fleet-agent', 'plan', { deviceId: 'worker', pluginId: 'plugin-a' })
      const plannedText = renderedText(component!.toJSON())
      expect(plannedText).toContain('待批准计划')
      expect(plannedText).toContain('INSTALL')
      expect(plannedText).toContain('worker')
      expect(plannedText).toContain('plugin-a')
      expect(plannedText).toContain(exactGitHubSpec)
      expect(plannedText).toContain(fleetPlan.digest.slice(0, 12))

      const confirmation = component!.root.findByType('input')
      let approveButton = component!.root.findAllByType('button').find(button => button.props.children === '批准并执行一次')
      expect(approveButton?.props.disabled).toBe(true)
      await act(async () => { confirmation.props.onChange({ currentTarget: { checked: true } }) })
      approveButton = component!.root.findAllByType('button').find(button => button.props.children === '批准并执行一次')
      expect(approveButton?.props.disabled).toBe(false)

      await act(async () => {
        approveButton!.props.onClick()
        for (let index = 0; index < 8; index += 1) await Promise.resolve()
      })
      expect(call).toHaveBeenCalledWith('/dsh-fleet-agent', 'approve', {
        approvalId: 'approval-01',
        deviceId: fleetPlan.deviceId,
        planDigest: fleetPlan.digest,
        planExpiresAt: fleetPlan.expiresAt,
        planId: fleetPlan.planId,
        profile: fleetPlan.profile,
      })
      expect(call).toHaveBeenCalledWith('/dsh-fleet-agent', 'action-status', {
        deviceId: fleetPlan.deviceId,
        planId: fleetPlan.planId,
      })
      expect(call.mock.calls.filter(([channel, endpoint]) => channel === '/dsh-fleet-agent' && endpoint === 'targets')).toHaveLength(2)
      const recoveredText = renderedText(component!.toJSON())
      expect(recoveredText).toContain('已自动回滚')
      expect(recoveredText).toContain('该设备已经一致')
      expect(recoveredText).not.toContain('待批准计划')
      expect(recoveredText).not.toContain('connection lost after approval')
    } finally {
      await act(async () => { component?.unmount() })
      vi.unstubAllGlobals()
    }
  })

  it('distinguishes an unregistered matching release, a registered release, and pending atomic changes', async () => {
    vi.stubGlobal('window', { setInterval: vi.fn(() => 1), clearInterval: vi.fn() })
    vi.stubGlobal('document', { hidden: false })
    const reports = [
      releaseTargetReport(),
      releaseTargetReport({ currentRelease: assignedRelease }),
      releaseTargetReport({ changes: [{ pluginId: 'plugin-a', action: 'update' }] }),
    ]
    let targetLoads = 0
    const call = vi.fn(async (channel: string, endpoint: string) => {
      if (channel === '/dsh-fleet' && endpoint === 'status') return { ok: true, value: status }
      if (channel === '/dsh-fleet-agent' && endpoint === 'targets') {
        return { ok: true, value: reports[Math.min(targetLoads++, reports.length - 1)] }
      }
      return { ok: false, error: { message: `unexpected RPC ${channel} ${endpoint}` } }
    })
    const ctx = { connection: { rpc: { call } }, slots: {} } as never
    let component: TestRenderer.ReactTestRenderer | undefined
    try {
      await act(async () => {
        component = TestRenderer.create(<FleetCard ctx={ctx} />)
        await Promise.resolve()
      })
      const operationsTab = component!.root.findAllByType('button').find(button =>
        button.props.role === 'tab' && renderedText(button.props.children) === '发布',
      )
      await act(async () => {
        operationsTab!.props.onClick()
        for (let index = 0; index < 4; index += 1) await Promise.resolve()
      })
      expect(renderedText(component!.toJSON())).toContain('文件一致，尚未登记 Release')
      expect(component!.root.findAllByType('button').some(button => button.props.children === '生成登记计划')).toBe(true)

      let reload = component!.root.findAllByType('button').find(button => button.props.children === '刷新目标状态')
      await act(async () => {
        reload!.props.onClick()
        for (let index = 0; index < 4; index += 1) await Promise.resolve()
      })
      expect(renderedText(component!.toJSON())).toContain('Release 已登记，文件一致')
      expect(component!.root.findAllByType('button').some(button => button.props.children === '生成登记计划')).toBe(false)

      reload = component!.root.findAllByType('button').find(button => button.props.children === '刷新目标状态')
      await act(async () => {
        reload!.props.onClick()
        for (let index = 0; index < 4; index += 1) await Promise.resolve()
      })
      expect(renderedText(component!.toJSON())).toContain('1 项原子变更')
      expect(component!.root.findAllByType('button').some(button => button.props.children === '生成原子计划')).toBe(true)
    } finally {
      await act(async () => { component?.unmount() })
      vi.unstubAllGlobals()
    }
  })

  it('loads a metadata-only durable catalog, shows readiness, and explicitly prunes old terminal tasks', async () => {
    vi.stubGlobal('window', { setInterval: vi.fn(() => 1), clearInterval: vi.fn() })
    vi.stubGlobal('document', { hidden: false })
    const taskId = 'task:77777777-7777-4777-8777-777777777777'
    let listCalls = 0
    let resumeCalls = 0
    let pruned = false
    const call = vi.fn(async (channel: string, endpoint: string, payload: unknown) => {
      if (channel === '/dsh-fleet' && endpoint === 'status') return { ok: true, value: status }
      if (channel === '/dsh-fleet-agent' && endpoint === 'targets') {
        return { ok: true, value: releaseTargetReport({ readiness: true }) }
      }
      if (channel === '/dsh-fleet-agent' && endpoint === 'tasks-list') {
        expect(payload).toEqual({ targetDeviceId: 'worker', limit: 20 })
        listCalls += 1
        return { ok: true, value: taskCatalog(pruned ? [] : [taskCatalogItem(taskId, 'worker', 'failed')]) }
      }
      if (channel === '/dsh-fleet-agent' && endpoint === 'tasks-resume') {
        resumeCalls += 1
        expect(payload).toEqual({ targetDeviceId: 'worker' })
        return { ok: true, value: { resumed: 1 } }
      }
      if (channel === '/dsh-fleet-agent' && endpoint === 'tasks-prune') {
        const body = payload as { targetDeviceId: string; olderThan: string; states: string[] }
        expect(body.targetDeviceId).toBe('worker')
        expect(new Date(body.olderThan).toISOString()).toBe(body.olderThan)
        expect(body.states).toEqual(['succeeded', 'failed', 'cancelled'])
        expect(Object.keys(body).sort()).toEqual(['olderThan', 'states', 'targetDeviceId'])
        pruned = true
        return { ok: true, value: { pruned: 1, skippedActive: 2 } }
      }
      return { ok: false, error: { message: `unexpected RPC ${channel} ${endpoint}` } }
    })
    const ctx = { connection: { rpc: { call } }, slots: {} } as never
    let component: TestRenderer.ReactTestRenderer | undefined
    try {
      await act(async () => {
        component = TestRenderer.create(<FleetCard ctx={ctx} />)
        await Promise.resolve()
      })
      const tasksTab = component!.root.findAllByType('button').find(button =>
        button.props.role === 'tab' && renderedText(button.props.children) === '任务',
      )
      await act(async () => {
        tasksTab!.props.onClick()
        for (let index = 0; index < 8; index += 1) await Promise.resolve()
      })
      const text = renderedText(component!.toJSON())
      expect(text).toContain('身份：team-a/owner')
      expect(text).toContain('本地签名器：就绪 · worker')
      expect(text).toContain(`execution headless · ${'3'.repeat(12)}`)
      expect(text).toContain('读取设备状态不会启动任务')
      expect(resumeCalls).toBe(0)
      expect(text).toContain(taskId)
      expect(text).toContain('失败')
      expect(text).toContain('更新时间：')
      expect(text).toContain('目标 worker · Workspace fleet-repo · Profile headless')
      expect(text).not.toContain('prompt')
      expect(text).not.toContain('result')

      const resume = component!.root.findAllByType('button').find(button => button.props.children === '检查并恢复未完成任务')
      await act(async () => {
        resume!.props.onClick()
        for (let index = 0; index < 8; index += 1) await Promise.resolve()
      })
      expect(resumeCalls).toBe(1)
      expect(renderedText(component!.toJSON())).toContain('已检查目标机；恢复 1 个未完成任务。')

      let prune = component!.root.findAllByType('button').find(button => button.props.children === '准备清理 30 天前终态')
      expect(prune?.props.disabled).toBe(false)
      await act(async () => { prune!.props.onClick() })
      expect(call.mock.calls.filter(([, endpoint]) => endpoint === 'tasks-prune')).toHaveLength(0)
      expect(renderedText(component!.toJSON())).toContain('再次点击将永久删除 worker 上 30 天前')

      const refreshCatalog = component!.root.findAllByType('button').find(button => button.props.children === '刷新')
      await act(async () => {
        refreshCatalog!.props.onClick()
        for (let index = 0; index < 8; index += 1) await Promise.resolve()
      })
      expect(component!.root.findAllByType('button').some(button => button.props.children === '准备清理 30 天前终态')).toBe(true)
      expect(renderedText(component!.toJSON())).not.toContain('再次点击将永久删除 worker 上 30 天前')

      prune = component!.root.findAllByType('button').find(button => button.props.children === '准备清理 30 天前终态')
      await act(async () => { prune!.props.onClick() })
      const confirmPrune = component!.root.findAllByType('button').find(button => button.props.children === '确认清理 worker')
      await act(async () => {
        confirmPrune!.props.onClick()
        for (let index = 0; index < 8; index += 1) await Promise.resolve()
      })
      expect(call.mock.calls.filter(([, endpoint]) => endpoint === 'tasks-prune')).toHaveLength(1)
      expect(listCalls).toBeGreaterThanOrEqual(4)
      expect(renderedText(component!.toJSON())).toContain('已清理 1 个终态任务；跳过 2 个活动任务。')
      expect(renderedText(component!.toJSON())).toContain('该设备还没有可展示的持久任务记录。')
      expect(renderedText(component!.toJSON())).not.toContain(taskId)
    } finally {
      await act(async () => { component?.unmount() })
      vi.unstubAllGlobals()
    }
  })

  it('submits only fixed workspace/profile task ids and renders recoverable A2A task status', async () => {
    vi.stubGlobal('window', { setInterval: vi.fn(() => 1), clearInterval: vi.fn() })
    vi.stubGlobal('document', { hidden: false })
    const taskId = 'task:11111111-1111-4111-8111-111111111111'
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => taskId.slice('task:'.length)) })
    const call = vi.fn(async (channel: string, endpoint: string, payload: unknown) => {
      if (channel === '/dsh-fleet' && endpoint === 'status') return { ok: true, value: status }
      if (channel === '/dsh-fleet-agent' && endpoint === 'targets') return { ok: true, value: releaseTargetReport() }
      if (channel === '/dsh-fleet-agent' && endpoint === 'tasks-list') return { ok: true, value: taskCatalog() }
      if (channel === '/dsh-fleet-agent' && endpoint === 'task-submit') {
        expect(payload).toEqual({
          targetDeviceId: 'worker', taskId, workspaceId: 'fleet-repo', profile: 'headless',
          policyId: 'readonly-v1', prompt: 'run remote checks',
        })
        return {
          ok: true,
          value: { taskId, response: { kind: 'task.progress', payload: { taskId, state: 'accepted', updatedAt: '2026-01-01T00:00:00.000Z' } } },
        }
      }
      if (channel === '/dsh-fleet-agent' && endpoint === 'task-status') {
        expect(payload).toEqual({ targetDeviceId: 'worker', taskId })
        return {
          ok: true,
          value: {
            taskId,
            response: {
              kind: 'task.result',
              payload: {
                taskId, state: 'succeeded', updatedAt: '2026-01-01T00:01:00.000Z',
                result: 'all checks passed', truncated: false, errorCode: null,
              },
            },
          },
        }
      }
      return { ok: false, error: { message: `unexpected RPC ${channel} ${endpoint}` } }
    })
    const ctx = { connection: { rpc: { call } }, slots: {} } as never
    let component: TestRenderer.ReactTestRenderer | undefined
    try {
      await act(async () => {
        component = TestRenderer.create(<FleetCard ctx={ctx} />)
        await Promise.resolve()
      })
      const tasksTab = component!.root.findAllByType('button').find(button =>
        button.props.role === 'tab' && renderedText(button.props.children) === '任务',
      )
      await act(async () => {
        tasksTab!.props.onClick()
        for (let index = 0; index < 5; index += 1) await Promise.resolve()
      })
      expect(renderedText(component!.toJSON())).toContain('fleet-repo')
      const textarea = component!.root.findByType('textarea')
      await act(async () => { textarea.props.onChange({ currentTarget: { value: 'run remote checks' } }) })
      const submit = component!.root.findAllByType('button').find(button => button.props.children === '签名并提交任务')
      expect(submit?.props.disabled).toBe(false)
      await act(async () => {
        submit!.props.onClick()
        for (let index = 0; index < 5; index += 1) await Promise.resolve()
      })
      expect(renderedText(component!.toJSON())).toContain('已接收')
      const refresh = component!.root.findAllByType('button').find(button => button.props.children === '刷新状态')
      await act(async () => {
        refresh!.props.onClick()
        for (let index = 0; index < 5; index += 1) await Promise.resolve()
      })
      const text = renderedText(component!.toJSON())
      expect(text).toContain('已完成')
      expect(text).toContain('all checks passed')
    } finally {
      await act(async () => { component?.unmount() })
      vi.unstubAllGlobals()
    }
  })

  it('automatically polls active tasks and backs off after a transient status failure', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('window', { setInterval: vi.fn(() => 1), clearInterval: vi.fn() })
    vi.stubGlobal('document', { hidden: false })
    const taskId = 'task:88888888-8888-4888-8888-888888888888'
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => taskId.slice('task:'.length)) })
    let statusCalls = 0
    const call = vi.fn(async (channel: string, endpoint: string) => {
      if (channel === '/dsh-fleet' && endpoint === 'status') return { ok: true, value: status }
      if (channel === '/dsh-fleet-agent' && endpoint === 'targets') return { ok: true, value: releaseTargetReport() }
      if (channel === '/dsh-fleet-agent' && endpoint === 'tasks-list') return { ok: true, value: taskCatalog() }
      if (channel === '/dsh-fleet-agent' && endpoint === 'task-submit') {
        return {
          ok: true,
          value: { taskId, response: { kind: 'task.progress', payload: { taskId, state: 'accepted', updatedAt: '2026-08-19T08:00:00.000Z' } } },
        }
      }
      if (channel === '/dsh-fleet-agent' && endpoint === 'task-status') {
        statusCalls += 1
        if (statusCalls === 1) return { ok: false, error: { message: 'temporary status outage' } }
        return {
          ok: true,
          value: {
            taskId,
            response: { kind: 'task.result', payload: {
              taskId, state: 'succeeded', updatedAt: '2026-08-19T08:01:00.000Z', result: null, truncated: false, errorCode: null,
            } },
          },
        }
      }
      return { ok: false, error: { message: `unexpected RPC ${channel} ${endpoint}` } }
    })
    const ctx = { connection: { rpc: { call } }, slots: {} } as never
    let component: TestRenderer.ReactTestRenderer | undefined
    try {
      await act(async () => {
        component = TestRenderer.create(<FleetCard ctx={ctx} />)
        await Promise.resolve()
      })
      const tasksTab = component!.root.findAllByType('button').find(button =>
        button.props.role === 'tab' && renderedText(button.props.children) === '任务',
      )
      await act(async () => {
        tasksTab!.props.onClick()
        for (let index = 0; index < 6; index += 1) await Promise.resolve()
      })
      await act(async () => {
        component!.root.findByType('textarea').props.onChange({ currentTarget: { value: 'poll me' } })
      })
      const submit = component!.root.findAllByType('button').find(button => button.props.children === '签名并提交任务')
      await act(async () => {
        submit!.props.onClick()
        for (let index = 0; index < 6; index += 1) await Promise.resolve()
      })
      expect(renderedText(component!.toJSON())).toContain('已接收')
      expect(statusCalls).toBe(0)

      await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })
      expect(statusCalls).toBe(1)
      expect(renderedText(component!.toJSON())).toContain('temporary status outage')
      await act(async () => { await vi.advanceTimersByTimeAsync(3_999) })
      expect(statusCalls).toBe(1)
      await act(async () => { await vi.advanceTimersByTimeAsync(1) })
      expect(statusCalls).toBe(2)
      expect(renderedText(component!.toJSON())).toContain('已完成')
    } finally {
      await act(async () => { component?.unmount() })
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })

  it('restores the saved target and task id after reload without persisting task output', async () => {
    const taskId = 'task:22222222-2222-4222-8222-222222222222'
    const localStorage = {
      getItem: vi.fn(() => JSON.stringify({ targetDeviceId: 'worker', taskId })),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    }
    vi.stubGlobal('window', { setInterval: vi.fn(() => 1), clearInterval: vi.fn(), localStorage })
    vi.stubGlobal('document', { hidden: false })
    const call = vi.fn(async (channel: string, endpoint: string, payload: unknown) => {
      if (channel === '/dsh-fleet' && endpoint === 'status') return { ok: true, value: status }
      if (channel === '/dsh-fleet-agent' && endpoint === 'targets') return { ok: true, value: releaseTargetReport() }
      if (channel === '/dsh-fleet-agent' && endpoint === 'tasks-list') return { ok: true, value: taskCatalog() }
      if (channel === '/dsh-fleet-agent' && endpoint === 'task-status') {
        expect(payload).toEqual({ targetDeviceId: 'worker', taskId })
        return {
          ok: true,
          value: {
            taskId,
            response: {
              kind: 'task.result',
              payload: {
                taskId, state: 'succeeded', updatedAt: '2026-01-01T00:01:00.000Z',
                result: 'sensitive remote output', truncated: false, errorCode: null,
              },
            },
          },
        }
      }
      return { ok: false, error: { message: `unexpected RPC ${channel} ${endpoint}` } }
    })
    const ctx = { connection: { rpc: { call } }, slots: {} } as never
    let component: TestRenderer.ReactTestRenderer | undefined
    try {
      await act(async () => {
        component = TestRenderer.create(<FleetCard ctx={ctx} />)
        for (let index = 0; index < 5; index += 1) await Promise.resolve()
      })
      expect(call).toHaveBeenCalledWith('/dsh-fleet-agent', 'task-status', { targetDeviceId: 'worker', taskId })
      expect(localStorage.setItem).toHaveBeenCalled()
      const persisted = localStorage.setItem.mock.calls.at(-1)?.[1] as string
      expect(JSON.parse(persisted)).toEqual({ targetDeviceId: 'worker', taskId })
      expect(persisted).not.toContain('sensitive remote output')

      const tasksTab = component!.root.findAllByType('button').find(button =>
        button.props.role === 'tab' && renderedText(button.props.children) === '任务',
      )
      await act(async () => {
        tasksTab!.props.onClick()
        for (let index = 0; index < 5; index += 1) await Promise.resolve()
      })
      expect(component!.root.findByProps({ 'aria-label': 'Task ID' }).props.value).toBe(taskId)
      expect(renderedText(component!.toJSON())).toContain('sensitive remote output')
    } finally {
      await act(async () => { component?.unmount() })
      vi.unstubAllGlobals()
    }
  })

  it('prestores a client task id and recovers it after the submit response is lost', async () => {
    const taskId = 'task:55555555-5555-4555-8555-555555555555'
    let stored: string | null = null
    const localStorage = {
      getItem: vi.fn(() => stored),
      setItem: vi.fn((_key: string, value: string) => { stored = value }),
      removeItem: vi.fn(() => { stored = null }),
    }
    vi.stubGlobal('window', { setInterval: vi.fn(() => 1), clearInterval: vi.fn(), localStorage })
    vi.stubGlobal('document', { hidden: false })
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => taskId.slice('task:'.length)) })
    let submitCalls = 0
    const call = vi.fn(async (channel: string, endpoint: string, payload: unknown) => {
      if (channel === '/dsh-fleet' && endpoint === 'status') return { ok: true, value: status }
      if (channel === '/dsh-fleet-agent' && endpoint === 'targets') return { ok: true, value: releaseTargetReport() }
      if (channel === '/dsh-fleet-agent' && endpoint === 'tasks-list') return { ok: true, value: taskCatalog() }
      if (channel === '/dsh-fleet-agent' && endpoint === 'task-submit') {
        submitCalls += 1
        expect(payload).toEqual({
          targetDeviceId: 'worker', taskId, workspaceId: 'fleet-repo', profile: 'headless',
          policyId: 'readonly-v1', prompt: 'ambiguous submit',
        })
        expect(JSON.parse(stored!)).toEqual({ targetDeviceId: 'worker', taskId })
        return { ok: false, error: { message: 'connection lost after target accepted' } }
      }
      if (channel === '/dsh-fleet-agent' && endpoint === 'task-status') {
        expect(payload).toEqual({ targetDeviceId: 'worker', taskId })
        return {
          ok: true,
          value: { taskId, response: { kind: 'task.progress', payload: { taskId, state: 'running', updatedAt: '2026-01-01T00:00:30.000Z' } } },
        }
      }
      return { ok: false, error: { message: `unexpected RPC ${channel} ${endpoint}` } }
    })
    const ctx = { connection: { rpc: { call } }, slots: {} } as never
    let component: TestRenderer.ReactTestRenderer | undefined
    try {
      await act(async () => {
        component = TestRenderer.create(<FleetCard ctx={ctx} />)
        await Promise.resolve()
      })
      const tasksTab = component!.root.findAllByType('button').find(button =>
        button.props.role === 'tab' && renderedText(button.props.children) === '任务',
      )
      await act(async () => {
        tasksTab!.props.onClick()
        for (let index = 0; index < 5; index += 1) await Promise.resolve()
      })
      await act(async () => {
        component!.root.findByType('textarea').props.onChange({ currentTarget: { value: 'ambiguous submit' } })
      })
      let submit = component!.root.findAllByType('button').find(button => button.props.children === '签名并提交任务')
      await act(async () => {
        submit!.props.onClick()
        for (let index = 0; index < 5; index += 1) await Promise.resolve()
      })
      expect(submitCalls).toBe(1)
      expect(renderedText(component!.toJSON())).toContain('connection lost after target accepted')
      expect(component!.root.findByProps({ 'aria-label': 'Task ID' }).props.value).toBe(taskId)
      submit = component!.root.findAllByType('button').find(button => button.props.children === '签名并提交任务')
      expect(submit?.props.disabled).toBe(true)
      expect(renderedText(component!.toJSON())).toContain('明确清除记录后再新建任务')
      await act(async () => {
        submit!.props.onClick()
        await Promise.resolve()
      })
      expect(submitCalls).toBe(1)

      await act(async () => { component!.unmount() })
      component = undefined
      await act(async () => {
        component = TestRenderer.create(<FleetCard ctx={ctx} />)
        for (let index = 0; index < 5; index += 1) await Promise.resolve()
      })
      expect(call).toHaveBeenCalledWith('/dsh-fleet-agent', 'task-status', { targetDeviceId: 'worker', taskId })
    } finally {
      await act(async () => { component?.unmount() })
      vi.unstubAllGlobals()
    }
  })

  it('ignores a delayed task response after the target reference changes', async () => {
    const taskId = 'task:66666666-6666-4666-8666-666666666666'
    let stored: string | null = null
    const localStorage = {
      getItem: vi.fn(() => stored),
      setItem: vi.fn((_key: string, value: string) => { stored = value }),
      removeItem: vi.fn(() => { stored = null }),
    }
    vi.stubGlobal('window', { setInterval: vi.fn(() => 1), clearInterval: vi.fn(), localStorage })
    vi.stubGlobal('document', { hidden: false })
    let resolveStatus: ((value: unknown) => void) | undefined
    const delayedStatus = new Promise<unknown>(resolve => { resolveStatus = resolve })
    const targets = releaseTargetReport()
    targets.targets.push({
      ...targets.targets[0]!,
      deviceId: 'worker-2',
      inspection: { ...targets.targets[0]!.inspection, deviceId: 'worker-2' },
    })
    const call = vi.fn(async (channel: string, endpoint: string) => {
      if (channel === '/dsh-fleet' && endpoint === 'status') return { ok: true, value: status }
      if (channel === '/dsh-fleet-agent' && endpoint === 'targets') return { ok: true, value: targets }
      if (channel === '/dsh-fleet-agent' && endpoint === 'tasks-list') return { ok: true, value: taskCatalog() }
      if (channel === '/dsh-fleet-agent' && endpoint === 'task-status') return await delayedStatus
      return { ok: false, error: { message: `unexpected RPC ${channel} ${endpoint}` } }
    })
    const ctx = { connection: { rpc: { call } }, slots: {} } as never
    let component: TestRenderer.ReactTestRenderer | undefined
    try {
      await act(async () => {
        component = TestRenderer.create(<FleetCard ctx={ctx} />)
        await Promise.resolve()
      })
      const tasksTab = component!.root.findAllByType('button').find(button =>
        button.props.role === 'tab' && renderedText(button.props.children) === '任务',
      )
      await act(async () => {
        tasksTab!.props.onClick()
        for (let index = 0; index < 5; index += 1) await Promise.resolve()
      })
      let taskInput = component!.root.findByProps({ 'aria-label': 'Task ID' })
      await act(async () => { taskInput.props.onChange({ currentTarget: { value: taskId } }) })
      const query = component!.root.findAllByType('button').find(button => button.props.children === '查询任务')
      await act(async () => {
        query!.props.onClick()
        await Promise.resolve()
      })
      taskInput = component!.root.findByProps({ 'aria-label': 'Task ID' })
      const targetSelect = component!.root.findAllByType('select').find(select => select.props.value === 'worker')
      expect(taskInput.props.disabled).toBe(true)
      expect(targetSelect?.props.disabled).toBe(true)
      await act(async () => { targetSelect!.props.onChange({ currentTarget: { value: 'worker-2' } }) })
      expect(stored).toBeNull()

      await act(async () => {
        resolveStatus?.({
          ok: true,
          value: { taskId, response: { kind: 'task.progress', payload: { taskId, state: 'running', updatedAt: '2026-01-01T00:00:30.000Z' } } },
        })
        for (let index = 0; index < 5; index += 1) await Promise.resolve()
      })
      expect(component!.root.findAllByType('select').some(select => select.props.value === 'worker-2')).toBe(true)
      expect(component!.root.findByProps({ 'aria-label': 'Task ID' }).props.value).toBe('')
      expect(renderedText(component!.toJSON())).not.toContain('执行中')
      expect(stored).toBeNull()
    } finally {
      await act(async () => { component?.unmount() })
      vi.unstubAllGlobals()
    }
  })

  it('does not let a delayed catalog from the previous target overwrite the selected target', async () => {
    vi.stubGlobal('window', { setInterval: vi.fn(() => 1), clearInterval: vi.fn() })
    vi.stubGlobal('document', { hidden: false })
    const workerTask = 'task:99999999-9999-4999-8999-999999999999'
    const worker2Task = 'task:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    let resolveWorker: ((value: unknown) => void) | undefined
    const delayedWorker = new Promise<unknown>(resolve => { resolveWorker = resolve })
    const targets = releaseTargetReport()
    targets.targets.push({
      ...targets.targets[0]!,
      deviceId: 'worker-2',
      inspection: { ...targets.targets[0]!.inspection, deviceId: 'worker-2' },
    })
    const call = vi.fn(async (channel: string, endpoint: string, payload: unknown) => {
      if (channel === '/dsh-fleet' && endpoint === 'status') return { ok: true, value: status }
      if (channel === '/dsh-fleet-agent' && endpoint === 'targets') return { ok: true, value: targets }
      if (channel === '/dsh-fleet-agent' && endpoint === 'tasks-list') {
        const targetDeviceId = (payload as { targetDeviceId: string }).targetDeviceId
        if (targetDeviceId === 'worker') return await delayedWorker
        return { ok: true, value: taskCatalog([taskCatalogItem(worker2Task, 'worker-2')]) }
      }
      return { ok: false, error: { message: `unexpected RPC ${channel} ${endpoint}` } }
    })
    const ctx = { connection: { rpc: { call } }, slots: {} } as never
    let component: TestRenderer.ReactTestRenderer | undefined
    try {
      await act(async () => {
        component = TestRenderer.create(<FleetCard ctx={ctx} />)
        await Promise.resolve()
      })
      const tasksTab = component!.root.findAllByType('button').find(button =>
        button.props.role === 'tab' && renderedText(button.props.children) === '任务',
      )
      await act(async () => {
        tasksTab!.props.onClick()
        for (let index = 0; index < 6; index += 1) await Promise.resolve()
      })
      expect(call.mock.calls.some(([, endpoint, payload]) => endpoint === 'tasks-list' &&
        (payload as { targetDeviceId?: string }).targetDeviceId === 'worker')).toBe(true)

      const targetSelect = component!.root.findAllByType('select').find(select => select.props.value === 'worker')
      await act(async () => {
        targetSelect!.props.onChange({ currentTarget: { value: 'worker-2' } })
        for (let index = 0; index < 6; index += 1) await Promise.resolve()
      })
      expect(renderedText(component!.toJSON())).toContain(worker2Task)

      await act(async () => {
        resolveWorker?.({ ok: true, value: taskCatalog([taskCatalogItem(workerTask)]) })
        for (let index = 0; index < 6; index += 1) await Promise.resolve()
      })
      expect(component!.root.findAllByType('select').some(select => select.props.value === 'worker-2')).toBe(true)
      expect(renderedText(component!.toJSON())).toContain(worker2Task)
      expect(renderedText(component!.toJSON())).not.toContain(workerTask)
    } finally {
      await act(async () => { component?.unmount() })
      vi.unstubAllGlobals()
    }
  })

  it('drops invalid saved data and allows a manual task id lookup', async () => {
    const taskId = 'task:33333333-3333-4333-8333-333333333333'
    const localStorage = {
      getItem: vi.fn(() => JSON.stringify({ targetDeviceId: 'worker', taskId, result: 'must not be accepted' })),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    }
    vi.stubGlobal('window', { setInterval: vi.fn(() => 1), clearInterval: vi.fn(), localStorage })
    vi.stubGlobal('document', { hidden: false })
    const call = vi.fn(async (channel: string, endpoint: string, payload: unknown) => {
      if (channel === '/dsh-fleet' && endpoint === 'status') return { ok: true, value: status }
      if (channel === '/dsh-fleet-agent' && endpoint === 'targets') return { ok: true, value: releaseTargetReport() }
      if (channel === '/dsh-fleet-agent' && endpoint === 'tasks-list') return { ok: true, value: taskCatalog() }
      if (channel === '/dsh-fleet-agent' && endpoint === 'task-status') {
        expect(payload).toEqual({ targetDeviceId: 'worker', taskId })
        return {
          ok: true,
          value: { taskId, response: { kind: 'task.progress', payload: { taskId, state: 'running', updatedAt: '2026-01-01T00:00:30.000Z' } } },
        }
      }
      return { ok: false, error: { message: `unexpected RPC ${channel} ${endpoint}` } }
    })
    const ctx = { connection: { rpc: { call } }, slots: {} } as never
    let component: TestRenderer.ReactTestRenderer | undefined
    try {
      await act(async () => {
        component = TestRenderer.create(<FleetCard ctx={ctx} />)
        for (let index = 0; index < 3; index += 1) await Promise.resolve()
      })
      expect(localStorage.removeItem).toHaveBeenCalledWith('dsh-fleet.task-reference.v1')
      expect(call.mock.calls.filter(([, endpoint]) => endpoint === 'task-status')).toHaveLength(0)

      const tasksTab = component!.root.findAllByType('button').find(button =>
        button.props.role === 'tab' && renderedText(button.props.children) === '任务',
      )
      await act(async () => {
        tasksTab!.props.onClick()
        for (let index = 0; index < 5; index += 1) await Promise.resolve()
      })
      const taskInput = component!.root.findByProps({ 'aria-label': 'Task ID' })
      expect(taskInput.props.value).toBe('')
      await act(async () => { taskInput.props.onChange({ currentTarget: { value: taskId } }) })
      const query = component!.root.findAllByType('button').find(button => button.props.children === '查询任务')
      expect(query?.props.disabled).toBe(false)
      await act(async () => {
        query!.props.onClick()
        for (let index = 0; index < 5; index += 1) await Promise.resolve()
      })
      expect(renderedText(component!.toJSON())).toContain('执行中')
      const persisted = localStorage.setItem.mock.calls.at(-1)?.[1] as string
      expect(JSON.parse(persisted)).toEqual({ targetDeviceId: 'worker', taskId })
      expect(persisted).not.toContain('must not be accepted')
    } finally {
      await act(async () => { component?.unmount() })
      vi.unstubAllGlobals()
    }
  })

  it('clears a recovered task reference from memory and local storage', async () => {
    const taskId = 'task:44444444-4444-4444-8444-444444444444'
    const localStorage = {
      getItem: vi.fn(() => JSON.stringify({ targetDeviceId: 'worker', taskId })),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    }
    vi.stubGlobal('window', { setInterval: vi.fn(() => 1), clearInterval: vi.fn(), localStorage })
    vi.stubGlobal('document', { hidden: false })
    const call = vi.fn(async (channel: string, endpoint: string) => {
      if (channel === '/dsh-fleet' && endpoint === 'status') return { ok: true, value: status }
      if (channel === '/dsh-fleet-agent' && endpoint === 'targets') return { ok: true, value: releaseTargetReport() }
      if (channel === '/dsh-fleet-agent' && endpoint === 'tasks-list') return { ok: true, value: taskCatalog() }
      if (channel === '/dsh-fleet-agent' && endpoint === 'task-status') {
        return {
          ok: true,
          value: { taskId, response: { kind: 'task.progress', payload: { taskId, state: 'accepted', updatedAt: '2026-01-01T00:00:00.000Z' } } },
        }
      }
      return { ok: false, error: { message: `unexpected RPC ${channel} ${endpoint}` } }
    })
    const ctx = { connection: { rpc: { call } }, slots: {} } as never
    let component: TestRenderer.ReactTestRenderer | undefined
    try {
      await act(async () => {
        component = TestRenderer.create(<FleetCard ctx={ctx} />)
        for (let index = 0; index < 5; index += 1) await Promise.resolve()
      })
      const tasksTab = component!.root.findAllByType('button').find(button =>
        button.props.role === 'tab' && renderedText(button.props.children) === '任务',
      )
      await act(async () => {
        tasksTab!.props.onClick()
        for (let index = 0; index < 5; index += 1) await Promise.resolve()
      })
      expect(renderedText(component!.toJSON())).toContain('已接收')
      const clear = component!.root.findAllByType('button').find(button => button.props.children === '清除记录')
      await act(async () => { clear!.props.onClick() })
      expect(localStorage.removeItem).toHaveBeenCalledWith('dsh-fleet.task-reference.v1')
      expect(component!.root.findByProps({ 'aria-label': 'Task ID' }).props.value).toBe('')
      expect(renderedText(component!.toJSON())).not.toContain('已接收')
    } finally {
      await act(async () => { component?.unmount() })
      vi.unstubAllGlobals()
    }
  })

  it('offers an explicit two-step rollback only after a successful Release and recovers its status', async () => {
    vi.stubGlobal('window', { setInterval: vi.fn(() => 1), clearInterval: vi.fn() })
    vi.stubGlobal('document', { hidden: false })
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => '77777777-7777-4777-8777-777777777777') })
    const transitionDigest = '5'.repeat(64)
    const transitionPlanId = 'release-plan:' + transitionDigest
    const releasePlan = {
      protocolVersion: 2,
      kind: 'profile-release',
      planId: transitionPlanId,
      digest: transitionDigest,
      deviceId: 'worker',
      profile: 'web',
      fromManifestDigest: '6'.repeat(64),
      toManifestDigest: 'b'.repeat(64),
      fromReleaseDigest: '7'.repeat(64),
      toReleaseDigest: assignedRelease.releaseDigest,
      manifestDigest: 'b'.repeat(64),
      profileHash: '8'.repeat(64),
      observedDshVersion: '0.1.0-rc.8',
      observedRuntimeDigest: '2'.repeat(64),
      observedServiceDefinitionDigest: '3'.repeat(64),
      releaseId: assignedRelease.releaseId,
      releaseVersion: assignedRelease.releaseVersion,
      releaseDigest: assignedRelease.releaseDigest,
      plugins: [{ pluginId: 'plugin-a', visibility: 'public', sourceKind: 'npm', exactSpec: '2.0.0', artifactDigest: null, packageVersion: '2.0.0', integrity: null, runtimeModules: [] }],
      changes: [{ pluginId: 'plugin-a', visibility: 'public', sourceKind: 'npm', action: 'update', fromSpecDigest: '9'.repeat(64), exactToSpec: '2.0.0', artifactDigest: null }],
      restartRequired: true,
      createdAt: '2026-08-19T10:00:00.000Z',
      expiresAt: '2099-08-19T10:05:00.000Z',
    }
    const releaseAction = {
      planId: transitionPlanId,
      planDigest: transitionDigest,
      approvalId: 'release-approval',
      principalId: 'owner',
      idempotencyKey: 'a'.repeat(64),
      deviceId: 'worker',
      profile: 'web',
      releaseId: assignedRelease.releaseId,
      releaseVersion: assignedRelease.releaseVersion,
      releaseDigest: assignedRelease.releaseDigest,
      fromManifestDigest: releasePlan.fromManifestDigest,
      toManifestDigest: releasePlan.toManifestDigest,
      fromReleaseDigest: releasePlan.fromReleaseDigest,
      toReleaseDigest: releasePlan.toReleaseDigest,
      rollbackDescriptorDigest: 'c'.repeat(64),
      stageProfile: 'stage',
      backupProfile: 'backup',
      state: 'succeeded',
      updatedAt: '2026-08-19T10:02:00.000Z',
      result: 'success',
    }
    const rollbackDigest = 'd'.repeat(64)
    const rollbackPlan = {
      protocolVersion: 2,
      kind: 'profile-release-rollback',
      planId: 'release-rollback-plan:' + rollbackDigest,
      digest: rollbackDigest,
      transitionPlanId,
      transitionPlanDigest: transitionDigest,
      deviceId: 'worker',
      profile: 'web',
      fromManifestDigest: releasePlan.toManifestDigest,
      toManifestDigest: releasePlan.fromManifestDigest,
      fromReleaseDigest: releasePlan.toReleaseDigest,
      toReleaseDigest: releasePlan.fromReleaseDigest,
      fromProfileHash: 'e'.repeat(64),
      toProfileHash: 'f'.repeat(64),
      observedDshVersion: '0.1.0-rc.8',
      observedRuntimeDigest: '2'.repeat(64),
      observedServiceDefinitionDigest: '3'.repeat(64),
      createdAt: '2026-08-19T10:03:00.000Z',
      expiresAt: '2099-08-19T10:08:00.000Z',
    }
    const rollbackAction = {
      planId: rollbackPlan.planId,
      planDigest: rollbackPlan.digest,
      transitionPlanId,
      approvalId: 'rollback-approval',
      principalId: 'owner',
      idempotencyKey: '1'.repeat(64),
      deviceId: 'worker',
      profile: 'web',
      fromManifestDigest: rollbackPlan.fromManifestDigest,
      toManifestDigest: rollbackPlan.toManifestDigest,
      fromReleaseDigest: rollbackPlan.fromReleaseDigest,
      toReleaseDigest: rollbackPlan.toReleaseDigest,
      state: 'succeeded',
      updatedAt: '2026-08-19T10:04:00.000Z',
      result: 'success',
    }
    const call = vi.fn(async (channel: string, endpoint: string) => {
      if (channel === '/dsh-fleet' && endpoint === 'status') return { ok: true, value: status }
      if (channel === '/dsh-fleet-agent' && endpoint === 'targets') {
        return { ok: true, value: releaseTargetReport({ currentRelease: assignedRelease, changes: [{ pluginId: 'plugin-a', action: 'update' }] }) }
      }
      if (endpoint === 'release-plan') return { ok: true, value: releasePlan }
      if (endpoint === 'release-approve') return { ok: true, value: releaseAction }
      if (endpoint === 'release-rollback-plan') return { ok: true, value: rollbackPlan }
      if (endpoint === 'release-rollback-approve') return { ok: false, error: { message: 'connection lost after rollback approval' } }
      if (endpoint === 'release-rollback-action-status') return { ok: true, value: rollbackAction }
      return { ok: false, error: { message: `unexpected RPC ${channel} ${endpoint}` } }
    })
    const ctx = { connection: { rpc: { call } }, slots: {} } as never
    let component: TestRenderer.ReactTestRenderer | undefined
    try {
      await act(async () => {
        component = TestRenderer.create(<FleetCard ctx={ctx} />)
        await Promise.resolve()
      })
      const operations = component!.root.findAllByType('button').find(button => button.props.role === 'tab' && renderedText(button.props.children) === '发布')
      await act(async () => { operations!.props.onClick(); for (let index = 0; index < 5; index += 1) await Promise.resolve() })
      const forwardPlan = component!.root.findAllByType('button').find(button => button.props.children === '生成原子计划')
      await act(async () => { forwardPlan!.props.onClick(); for (let index = 0; index < 5; index += 1) await Promise.resolve() })
      expect(renderedText(component!.toJSON())).toContain(`运行身份${releasePlan.observedRuntimeDigest.slice(0, 12)}`)
      expect(renderedText(component!.toJSON())).toContain(`服务定义${releasePlan.observedServiceDefinitionDigest.slice(0, 12)}`)
      await act(async () => { component!.root.findByType('input').props.onChange({ currentTarget: { checked: true } }) })
      const approve = component!.root.findAllByType('button').find(button => button.props.children === '批准并执行一次')
      await act(async () => { approve!.props.onClick(); for (let index = 0; index < 8; index += 1) await Promise.resolve() })
      expect(renderedText(component!.toJSON())).toContain('生成回滚计划')

      let rollback = component!.root.findAllByType('button').find(button => button.props.children === '生成回滚计划')
      await act(async () => { rollback!.props.onClick(); for (let index = 0; index < 5; index += 1) await Promise.resolve() })
      expect(renderedText(component!.toJSON())).toContain('显式 Release 回滚')
      expect(renderedText(component!.toJSON())).toContain(`运行身份：${rollbackPlan.observedRuntimeDigest.slice(0, 12)}`)
      await act(async () => { component!.root.findByType('input').props.onChange({ currentTarget: { checked: true } }) })
      const refresh = component!.root.findAllByType('button').find(button => button.props.children === '刷新目标状态')
      await act(async () => { refresh!.props.onClick(); for (let index = 0; index < 5; index += 1) await Promise.resolve() })
      expect(renderedText(component!.toJSON())).not.toContain('显式 Release 回滚')

      rollback = component!.root.findAllByType('button').find(button => button.props.children === '生成回滚计划')
      await act(async () => { rollback!.props.onClick(); for (let index = 0; index < 5; index += 1) await Promise.resolve() })
      const confirmation = component!.root.findByType('input')
      let execute = component!.root.findAllByType('button').find(button => button.props.children === '确认执行回滚')
      expect(execute?.props.disabled).toBe(true)
      await act(async () => { confirmation.props.onChange({ currentTarget: { checked: true } }) })
      execute = component!.root.findAllByType('button').find(button => button.props.children === '确认执行回滚')
      await act(async () => { execute!.props.onClick(); for (let index = 0; index < 10; index += 1) await Promise.resolve() })
      expect(call).toHaveBeenCalledWith('/dsh-fleet-agent', 'release-rollback-action-status', { deviceId: 'worker', planId: rollbackPlan.planId })
      expect(renderedText(component!.toJSON())).toContain('已恢复上一版本')
      expect(renderedText(component!.toJSON())).not.toContain('connection lost after rollback approval')
    } finally {
      await act(async () => { component?.unmount() })
      vi.unstubAllGlobals()
    }
  })

  it('keeps a rollout target visible while showing distinct live and desired manifest bindings', async () => {
    vi.stubGlobal('window', { setInterval: vi.fn(() => 1), clearInterval: vi.fn() })
    vi.stubGlobal('document', { hidden: false })
    const live = '1'.repeat(64)
    const desired = '2'.repeat(64)
    const call = vi.fn(async (channel: string, endpoint: string) => {
      if (channel === '/dsh-fleet' && endpoint === 'status') return { ok: true, value: status }
      if (channel === '/dsh-fleet-agent' && endpoint === 'targets') return { ok: true, value: releaseTargetReport({
        liveManifestDigest: live,
        desiredManifestDigest: desired,
        changes: [{ pluginId: 'plugin-a', action: 'update' }],
      }) }
      return { ok: false, error: { message: `unexpected RPC ${channel} ${endpoint}` } }
    })
    const ctx = { connection: { rpc: { call } }, slots: {} } as never
    let component: TestRenderer.ReactTestRenderer | undefined
    try {
      await act(async () => { component = TestRenderer.create(<FleetCard ctx={ctx} />); await Promise.resolve() })
      const operations = component!.root.findAllByType('button').find(button => button.props.role === 'tab' && renderedText(button.props.children) === '发布')
      await act(async () => { operations!.props.onClick(); for (let index = 0; index < 5; index += 1) await Promise.resolve() })
      const text = renderedText(component!.toJSON())
      expect(text).toContain('worker')
      expect(text).toContain(`live ${live.slice(0, 12)} · desired ${desired.slice(0, 12)}`)
      expect(component!.root.findAllByType('button').some(button => button.props.children === '生成原子计划')).toBe(true)
    } finally {
      await act(async () => { component?.unmount() })
      vi.unstubAllGlobals()
    }
  })

  it('previews exact release retention deletions and requires a second confirmation before apply', async () => {
    vi.stubGlobal('window', { setInterval: vi.fn(() => 1), clearInterval: vi.fn() })
    vi.stubGlobal('document', { hidden: false })
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => '77777777-7777-4777-8777-777777777777') })
    const currentTransitionPlanId = 'release-plan:' + 'a'.repeat(64)
    const previousTransitionPlanId = 'release-plan:' + 'b'.repeat(64)
    const removedTransitionPlanId = 'release-plan:' + 'c'.repeat(64)
    const retentionDigest = 'd'.repeat(64)
    const retentionPlan = {
      protocolVersion: 1,
      kind: 'profile-release-retention',
      deviceId: 'worker',
      profile: 'web',
      currentTransitionPlanId,
      retainedTransitionPlanIds: [currentTransitionPlanId, previousTransitionPlanId],
      entries: [{
        transitionPlanId: removedTransitionPlanId,
        descriptorDigest: 'e'.repeat(64),
        backupProfile: 'fleet-backup-' + '1'.repeat(24),
        backupManifestDigest: 'f'.repeat(64),
        backupProfileHash: '1'.repeat(64),
        reason: 'superseded',
      }],
      orphanBackupProfiles: [],
      orphanStageProfiles: ['fleet-stage-' + '2'.repeat(24)],
      orphanFailedProfiles: [],
      createdAt: '2099-08-19T10:00:00.000Z',
      expiresAt: '2099-08-19T10:05:00.000Z',
      planId: 'release-retention-plan:' + retentionDigest,
      digest: retentionDigest,
    }
    const retentionAction = {
      planId: retentionPlan.planId,
      planDigest: retentionPlan.digest,
      approvalId: '77777777-7777-4777-8777-777777777777',
      principalId: 'owner',
      idempotencyKey: '2'.repeat(64),
      deviceId: 'worker',
      profile: 'web',
      currentTransitionPlanId,
      state: 'succeeded',
      removedTransitionPlanIds: [removedTransitionPlanId],
      activeTransitionPlanId: null,
      activeBackupQuarantinePrepared: false,
      activeBackupRemoved: false,
      updatedAt: '2099-08-19T10:02:00.000Z',
      result: 'success',
    }
    const targets = releaseTargetReport({
      currentRelease: assignedRelease,
      retention: {
        retainedCount: 2, eligibleCount: 1, orphanBackupCount: 0, orphanStageCount: 1,
        orphanFailedCount: 0, orphanCount: 1, invalidTransitionCount: 0,
      },
    })
    const call = vi.fn(async (channel: string, endpoint: string, payload: unknown) => {
      if (channel === '/dsh-fleet' && endpoint === 'status') return { ok: true, value: status }
      if (endpoint === 'targets') return { ok: true, value: targets }
      if (endpoint === 'release-retention-plan') {
        expect(payload).toEqual({ deviceId: 'worker' })
        return { ok: true, value: retentionPlan }
      }
      if (endpoint === 'release-retention-approve') return { ok: false, error: { message: 'connection lost after retention approval' } }
      if (endpoint === 'release-retention-action-status') return { ok: true, value: retentionAction }
      return { ok: false, error: { message: `unexpected RPC ${channel} ${endpoint}` } }
    })
    const ctx = { connection: { rpc: { call } }, slots: {} } as never
    let component: TestRenderer.ReactTestRenderer | undefined
    try {
      await act(async () => { component = TestRenderer.create(<FleetCard ctx={ctx} />); await Promise.resolve() })
      const operations = component!.root.findAllByType('button').find(button => button.props.role === 'tab' && renderedText(button.props.children) === '发布')
      await act(async () => { operations!.props.onClick(); for (let index = 0; index < 6; index += 1) await Promise.resolve() })
      let text = renderedText(component!.toJSON())
      expect(text).toContain('可清理 1 个 superseded transition')
      expect(call.mock.calls.some(([, endpoint]) => endpoint === 'release-retention-plan')).toBe(false)

      const preview = component!.root.findAllByType('button').find(button => button.props.children === '预览备份清理')
      await act(async () => { preview!.props.onClick(); for (let index = 0; index < 6; index += 1) await Promise.resolve() })
      text = renderedText(component!.toJSON())
      expect(text).toContain(removedTransitionPlanId)
      expect(text).toContain('fleet-backup-' + '1'.repeat(24))
      expect(text).toContain('fleet-stage-' + '2'.repeat(24))
      expect(text).toContain('不会由本计划删除，需人工审计')
      expect(text).not.toContain('将删除孤立 stage')
      expect(call.mock.calls.some(([, endpoint]) => endpoint === 'release-retention-approve')).toBe(false)

      let applyRetention = component!.root.findAllByType('button').find(button => button.props.children === '确认执行备份清理')
      expect(applyRetention?.props.disabled).toBe(true)
      const confirmation = component!.root.findAllByType('input').find(input => input.props.type === 'checkbox')
      await act(async () => { confirmation!.props.onChange({ currentTarget: { checked: true } }) })
      applyRetention = component!.root.findAllByType('button').find(button => button.props.children === '确认执行备份清理')
      await act(async () => { applyRetention!.props.onClick(); for (let index = 0; index < 8; index += 1) await Promise.resolve() })
      expect(call).toHaveBeenCalledWith('/dsh-fleet-agent', 'release-retention-action-status', {
        deviceId: 'worker', planId: retentionPlan.planId,
      })
      expect(renderedText(component!.toJSON())).toContain('备份保留清理已完成')
      expect(renderedText(component!.toJSON())).not.toContain('connection lost after retention approval')
    } finally {
      await act(async () => { component?.unmount() })
      vi.unstubAllGlobals()
    }
  })

  it('uses a manual collaboration tab for strict federation inbox, receipt, decisions and retention preview', async () => {
    vi.stubGlobal('window', { setInterval: vi.fn(() => 1), clearInterval: vi.fn() })
    vi.stubGlobal('document', { hidden: false })
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => '77777777-7777-4777-8777-777777777777') })
    let acknowledged = false
    const decision = federationEnvelope('approval.decision', {
      approvalId: federationApprovalRequest.payload.approvalId,
      taskId: federationApprovalRequest.payload.taskId,
      approvalRequestMessageId: federationApprovalRequest.messageId,
      approvalRequestPayloadDigest: federationApprovalRequest.payloadDigest,
      decision: 'endorsed',
      decidedAt: '2026-08-19T10:03:00.000Z',
    }, {
      teamId: 'team-a',
      sender: { principalId: 'owner', deviceId: 'worker', keyId: 'ed25519:' + 'd'.repeat(64) },
      recipient: { teamId: 'foreign-team', deviceId: 'peer-device' },
      messageId: 'msg:88888888-8888-4888-8888-888888888888',
      payloadDigest: 'e'.repeat(64),
      signature: 'B'.repeat(86),
    })
    const receipt = federationEnvelope('receipt', {
      requestMessageId: federationHandoff.messageId,
      status: 'stored',
    }, {
      teamId: 'team-a',
      sender: { principalId: 'owner', deviceId: 'worker', keyId: 'ed25519:' + 'd'.repeat(64) },
      recipient: { teamId: 'foreign-team', deviceId: 'peer-device' },
      messageId: 'msg:99999999-9999-4999-8999-999999999999',
      payloadDigest: 'f'.repeat(64),
      signature: 'C'.repeat(86),
    })
    const approvalReceipt = federationEnvelope('receipt', {
      requestMessageId: federationApprovalRequest.messageId,
      status: 'accepted',
    }, {
      teamId: 'team-a',
      sender: { principalId: 'owner', deviceId: 'worker', keyId: 'ed25519:' + 'd'.repeat(64) },
      recipient: { teamId: 'foreign-team', deviceId: 'peer-device' },
      messageId: 'msg:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      payloadDigest: '1'.repeat(64),
      signature: 'D'.repeat(86),
    })
    const call = vi.fn(async (channel: string, endpoint: string, payload: unknown) => {
      if (channel === '/dsh-fleet' && endpoint === 'status') return { ok: true, value: status }
      if (endpoint === 'federation-list') return { ok: true, value: [
        {
          record: { schemaVersion: 1, receivedAt: '2026-08-19T10:00:30.000Z', envelope: federationApprovalRequest },
          acknowledgement: acknowledged ? { schemaVersion: 1, messageId: federationApprovalRequest.messageId, payloadDigest: federationApprovalRequest.payloadDigest, disposition: 'acknowledged', acknowledgedAt: '2026-08-19T10:04:00.000Z' } : null,
          expired: false,
        },
        { record: { schemaVersion: 1, receivedAt: '2026-08-19T10:00:20.000Z', envelope: federationHandoff }, acknowledgement: null, expired: false },
      ] }
      if (endpoint === 'approval-decision-export') {
        expect(payload).toEqual({ request: federationApprovalRequest, decision: 'endorsed' })
        return { ok: true, value: decision }
      }
      if (endpoint === 'ack') {
        acknowledged = true
        return { ok: true, value: { status: 'acknowledged', acknowledgement: { schemaVersion: 1, messageId: federationApprovalRequest.messageId, payloadDigest: federationApprovalRequest.payloadDigest, disposition: 'acknowledged', acknowledgedAt: '2026-08-19T10:04:00.000Z' } } }
      }
      if (endpoint === 'retention-plan') return { ok: true, value: { generatedAt: '2026-08-19T10:05:00.000Z', candidates: [{ messageId: federationApprovalRequest.messageId, payloadDigest: federationApprovalRequest.payloadDigest, reason: 'acknowledged-retention' }] } }
      if (endpoint === 'import') {
        const imported = (payload as { envelope: typeof federationHandoff }).envelope
        if (imported.messageId === federationHandoff.messageId) return { ok: true, value: receipt }
        if (imported.messageId === federationApprovalRequest.messageId) return { ok: true, value: approvalReceipt }
      }
      if (endpoint === 'approval-request-export') {
        const request = payload as Record<string, unknown>
        return { ok: true, value: federationEnvelope('approval.request', {
          approvalId: request.approvalId,
          taskId: request.taskId,
          summary: request.summary,
          expiresAt: request.expiresAt,
        }, {
          teamId: 'team-a',
          sender: { principalId: 'owner', deviceId: 'worker', keyId: 'ed25519:' + 'd'.repeat(64) },
          recipient: { teamId: request.recipientTeamId, deviceId: request.recipientDeviceId },
          messageId: 'msg:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          payloadDigest: '1'.repeat(64),
          signature: 'D'.repeat(86),
        }) }
      }
      return { ok: false, error: { message: `unexpected RPC ${channel} ${endpoint}` } }
    })
    const ctx = { connection: { rpc: { call } }, slots: {} } as never
    let component: TestRenderer.ReactTestRenderer | undefined
    try {
      await act(async () => { component = TestRenderer.create(<FleetCard ctx={ctx} />); await Promise.resolve() })
      const collaboration = component!.root.findAllByType('button').find(button => button.props.role === 'tab' && renderedText(button.props.children) === '协作')
      await act(async () => { collaboration!.props.onClick(); for (let index = 0; index < 6; index += 1) await Promise.resolve() })
      let text = renderedText(component!.toJSON())
      expect(text).toContain('foreign-team/peer-device')
      expect(text).toContain('https://example.invalid/do-not-open')
      expect(component!.root.findAllByType('a')).toHaveLength(0)

      const endorse = component!.root.findAllByType('button').find(button => button.props.children === '背书并导出')
      await act(async () => { endorse!.props.onClick(); for (let index = 0; index < 5; index += 1) await Promise.resolve() })
      expect(renderedText(component!.toJSON())).toContain('它不授予任务工具权限')
      expect(component!.root.findByProps({ 'aria-label': '导出 Envelope JSON' }).props.value).toContain('approval.decision')

      const confirm = component!.root.findAllByType('button').find(button => button.props.children === '确认')
      await act(async () => { confirm!.props.onClick(); for (let index = 0; index < 8; index += 1) await Promise.resolve() })
      expect(renderedText(component!.toJSON())).toContain('首次处置为最终结果')
      expect(component!.root.findAllByType('button').find(button => button.props.children === '忽略')?.props.disabled).toBe(true)

      const retention = component!.root.findAllByType('button').find(button => button.props.children === '保留计划')
      await act(async () => { retention!.props.onClick(); for (let index = 0; index < 5; index += 1) await Promise.resolve() })
      text = renderedText(component!.toJSON())
      expect(text).toContain('保留计划仅预览：1 条候选，不会自动删除')
      expect(call.mock.calls.some(([, endpoint]) => endpoint.includes('prune'))).toBe(false)

      const importBox = component!.root.findByProps({ 'aria-label': '导入 Envelope JSON' })
      await act(async () => { importBox.props.onChange({ currentTarget: { value: JSON.stringify(federationHandoff) } }) })
      const importButton = component!.root.findAllByType('button').find(button => button.props.children === '验证并导入')
      await act(async () => { importButton!.props.onClick(); for (let index = 0; index < 8; index += 1) await Promise.resolve() })
      expect(renderedText(component!.toJSON())).toContain('下面仅返回签名 receipt')
      expect(component!.root.findByProps({ 'aria-label': '导出 Envelope JSON' }).props.value).toContain('"status": "stored"')

      await act(async () => { importBox.props.onChange({ currentTarget: { value: JSON.stringify(federationApprovalRequest) } }) })
      await act(async () => { importButton!.props.onClick(); for (let index = 0; index < 8; index += 1) await Promise.resolve() })
      expect(renderedText(component!.toJSON())).toContain('已验证并接收')
      expect(component!.root.findByProps({ 'aria-label': '导出 Envelope JSON' }).props.value).toContain('"status": "accepted"')

      const kind = component!.root.findAllByType('select')[0]!
      await act(async () => { kind.props.onChange({ currentTarget: { value: 'approval.request' } }) })
      const inputs = component!.root.findAllByType('input')
      await act(async () => {
        inputs[0]!.props.onChange({ currentTarget: { value: 'foreign-team' } })
        inputs[1]!.props.onChange({ currentTarget: { value: 'peer-device' } })
        inputs[2]!.props.onChange({ currentTarget: { value: 'task:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' } })
      })
      const summaryBox = component!.root.findAllByType('textarea').find(node => node.props['aria-label'] === undefined && node.props.readOnly !== true)
      await act(async () => { summaryBox!.props.onChange({ currentTarget: { value: '请对方确认交接' } }) })
      const exportButton = component!.root.findAllByType('button').find(button => button.props.children === '生成签名 Envelope')
      await act(async () => { exportButton!.props.onClick(); for (let index = 0; index < 5; index += 1) await Promise.resolve() })
      expect(call.mock.calls.some(([, endpoint]) => endpoint === 'approval-request-export')).toBe(true)
      expect(component!.root.findByProps({ 'aria-label': '导出 Envelope JSON' }).props.value).toContain('approval.request')
    } finally {
      await act(async () => { component?.unmount() })
      vi.unstubAllGlobals()
    }
  })
})

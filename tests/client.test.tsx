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
        currentVersion: '0.1.0-rc.5', latestVersion: '0.1.0-rc.7',
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
  observedDshVersion: '0.1.0-rc.7',
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
        dshVersion: '0.1.0-rc.7',
        manifestDigest: 'b'.repeat(64),
        profileHash: 'c'.repeat(64),
        candidates,
      },
    }],
  }
}

function releaseTargetReport() {
  return {
    enabled: true,
    targets: [{
      deviceId: 'worker',
      transport: 'ssh',
      online: true,
      mode: 'profile-release',
      inspection: {
        protocolVersion: 1,
        kind: 'profile-release',
        deviceId: 'worker',
        profile: 'web',
        dshVersion: '0.1.0-rc.7',
        manifestDigest: 'b'.repeat(64),
        profileHash: 'c'.repeat(64),
        currentRelease: null,
        assignedRelease: { releaseId: 'stable-web', releaseVersion: '3.0.0', releaseDigest: 'd'.repeat(64) },
        changes: [],
        tasks: { enabled: true, workspaceIds: ['fleet-repo'], profiles: ['headless'] },
      },
    }],
  }
}

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
      expect(text).toContain('0.1.0-rc.5 → 0.1.0-rc.7')
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

  it('submits only fixed workspace/profile task ids and renders recoverable A2A task status', async () => {
    vi.stubGlobal('window', { setInterval: vi.fn(() => 1), clearInterval: vi.fn() })
    vi.stubGlobal('document', { hidden: false })
    const taskId = 'task:11111111-1111-4111-8111-111111111111'
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => taskId.slice('task:'.length)) })
    const call = vi.fn(async (channel: string, endpoint: string, payload: unknown) => {
      if (channel === '/dsh-fleet' && endpoint === 'status') return { ok: true, value: status }
      if (channel === '/dsh-fleet-agent' && endpoint === 'targets') return { ok: true, value: releaseTargetReport() }
      if (channel === '/dsh-fleet-agent' && endpoint === 'task-submit') {
        expect(payload).toEqual({
          targetDeviceId: 'worker', taskId, workspaceId: 'fleet-repo', profile: 'headless', prompt: 'run remote checks',
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
      expect(renderedText(component!.toJSON())).toContain('accepted')
      const refresh = component!.root.findAllByType('button').find(button => button.props.children === '刷新状态')
      await act(async () => {
        refresh!.props.onClick()
        for (let index = 0; index < 5; index += 1) await Promise.resolve()
      })
      const text = renderedText(component!.toJSON())
      expect(text).toContain('succeeded')
      expect(text).toContain('all checks passed')
    } finally {
      await act(async () => { component?.unmount() })
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
      if (channel === '/dsh-fleet-agent' && endpoint === 'task-submit') {
        submitCalls += 1
        expect(payload).toEqual({
          targetDeviceId: 'worker', taskId, workspaceId: 'fleet-repo', profile: 'headless', prompt: 'ambiguous submit',
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
      expect(renderedText(component!.toJSON())).not.toContain('running')
      expect(stored).toBeNull()
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
      expect(renderedText(component!.toJSON())).toContain('running')
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
      expect(renderedText(component!.toJSON())).toContain('accepted')
      const clear = component!.root.findAllByType('button').find(button => button.props.children === '清除记录')
      await act(async () => { clear!.props.onClick() })
      expect(localStorage.removeItem).toHaveBeenCalledWith('dsh-fleet.task-reference.v1')
      expect(component!.root.findByProps({ 'aria-label': 'Task ID' }).props.value).toBe('')
      expect(renderedText(component!.toJSON())).not.toContain('accepted')
    } finally {
      await act(async () => { component?.unmount() })
      vi.unstubAllGlobals()
    }
  })
})

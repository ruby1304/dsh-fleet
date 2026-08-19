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
    summary: { tracked: 5, available: 2, current: 1, local: 1, missing: 0, errors: 1, unsupported: 0 },
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

describe('dsh-fleet client slots', () => {
  it('uses the sidebar footer action instead of a fixed shell overlay', () => {
    let setup: (() => unknown) | undefined
    const register = vi.fn((_descriptor: Record<string, unknown>, _component: unknown) => () => {})
    const inject = vi.fn((name: string, callback: () => unknown) => {
      expect(name).toBe('sidebar.footer.action')
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
      name: 'sidebar.footer.action',
      id: 'dsh-fleet',
      order: 110,
    })
  })

  it('renders as an in-flow wide row or compact rail action', async () => {
    vi.stubGlobal('window', { setInterval: vi.fn(() => 1), clearInterval: vi.fn() })
    vi.stubGlobal('document', { hidden: false })
    const ctx = { connection: { rpc: { call: vi.fn().mockResolvedValue({ ok: true, value: status }) } }, slots: {} } as never
    let component: TestRenderer.ReactTestRenderer | undefined
    try {
      await act(async () => {
        component = TestRenderer.create(<FleetCard ctx={ctx} wide />)
        await Promise.resolve()
      })
      const wideRoot = component!.root.findByProps({ 'data-dsh-fleet-action': true })
      expect(wideRoot.props.style).toMatchObject({ position: 'relative', width: '100%', height: 42 })
      expect(wideRoot.props.style.position).not.toBe('fixed')

      await act(async () => { component!.update(<FleetCard ctx={ctx} wide={false} />) })
      const railRoot = component!.root.findByProps({ 'data-dsh-fleet-action': true })
      expect(railRoot.props.style).toMatchObject({ width: 36, height: 36 })
    } finally {
      await act(async () => { component?.unmount() })
      vi.unstubAllGlobals()
    }
  })

  it('loads status initially, expands the card, shows device and summary fields, and refreshes', async () => {
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

      const closedButton = component!.root.findAllByType('button').find(button =>
        button.findAllByType('strong').some(strong => strong.children.includes('Fleet')),
      )
      expect(closedButton).toBeDefined()
      await act(async () => { closedButton!.props.onClick() })
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

      const toggle = component!.root.findAllByType('button').find(button => button.props['aria-expanded'] === false)
      await act(async () => { toggle!.props.onClick() })
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
      expect(renderedText(component!.toJSON())).toContain('状态获取失败')
      expect(renderedText(component!.toJSON())).not.toContain('载入中…')

      const toggle = component!.root.findAllByType('button').find(button => button.props['aria-expanded'] === false)
      await act(async () => { toggle!.props.onClick() })
      expect(renderedText(component!.toJSON())).toContain('initial status unavailable')
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
      const toggle = component!.root.findAllByType('button').find(button => button.props['aria-expanded'] === false)
      await act(async () => { toggle!.props.onClick() })
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
      const toggle = component!.root.findAllByType('button').find(button => button.props['aria-expanded'] === false)
      await act(async () => { toggle!.props.onClick() })

      const operationsTab = component!.root.findAllByType('button').find(button =>
        button.props.role === 'tab' && renderedText(button.props.children) === '操作',
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
})

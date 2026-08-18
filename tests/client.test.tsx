import TestRenderer, { act } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { apply, FleetCard } from '../src/client/index.tsx'
import type { FleetStatus } from '../src/shared.ts'

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
  summary: { desired: 3, aligned: 1, missing: 1, drifted: 1, failed: 0, unmanaged: 1 },
  plugins: [{ id: 'plugin-a', desiredSpec: '1.0.0', runtimeModules: [], runtimePhase: 'active', state: 'aligned' }],
  unmanaged: [{ id: 'plugin-extra', actualSpec: '2.0.0' }],
}

describe('dsh-fleet client slots', () => {
  it('waits for shell.overlay before registering the fleet card', () => {
    let setup: (() => unknown) | undefined
    const register = vi.fn((_descriptor: Record<string, unknown>, _component: unknown) => () => {})
    const inject = vi.fn((name: string, callback: () => unknown) => {
      expect(name).toBe('shell.overlay')
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
      name: 'shell.overlay',
      id: 'dsh-fleet',
      order: 110,
    })
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
      expect(text).toContain('期望 3 · 一致 1 · 缺失 1 · 漂移 1 · 失败 0 · 未管理 1')

      const refresh = component!.root.findAllByType('button').find(button => button.props.children === '刷新')
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
})

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import type { FleetStatus, PluginDriftState } from '../shared.ts'

export const inject = ['slots', 'connection']
const CHANNEL = '/dsh-fleet'

interface RpcResult {
  ok: boolean
  value?: FleetStatus
  error?: { message?: string }
}

interface ClientContextLike {
  connection: { rpc: { call(channel: string, endpoint: string, payload: unknown): Promise<RpcResult> } }
  slots: {
    inject(name: string, setup: () => unknown): unknown
    register(descriptor: Record<string, unknown>, component: React.ComponentType): unknown
  }
}

const colors: Record<PluginDriftState, string> = {
  aligned: '#16a34a',
  missing: '#dc2626',
  'spec-drift': '#d97706',
  'runtime-failed': '#dc2626',
  'runtime-inactive': '#d97706',
}

function stateLabel(state: PluginDriftState): string {
  if (state === 'aligned') return '一致'
  if (state === 'missing') return '缺失'
  if (state === 'spec-drift') return '版本漂移'
  if (state === 'runtime-failed') return '加载失败'
  return '未激活'
}

export function FleetCard({ ctx }: { ctx: ClientContextLike }): React.ReactElement {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<FleetStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (loading) return
    setLoading(true)
    try {
      const result = await ctx.connection.rpc.call(CHANNEL, 'status', null)
      if (!result.ok || result.value === undefined) throw new Error(result.error?.message ?? 'fleet status unavailable')
      setStatus(result.value)
      setError(null)
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [ctx, loading])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => { if (!document.hidden) void load() }, 30000)
    return () => window.clearInterval(timer)
  }, [])

  const issues = useMemo(() => status === null
    ? 0
    : status.summary.missing + status.summary.drifted + status.summary.failed + status.summary.unmanaged,
  [status])
  const tone = error !== null || status?.manifest.loaded === false ? '#dc2626' : issues > 0 ? '#d97706' : '#16a34a'

  return <div style={{ position: 'fixed', left: 16, bottom: 16, zIndex: 950, pointerEvents: 'auto', fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif', fontSize: 12, color: '#202124' }}>
    {open && <div style={{ width: 360, maxHeight: '62vh', overflow: 'auto', marginBottom: 8, border: '1px solid rgba(0,0,0,.12)', borderRadius: 12, background: '#fff', boxShadow: '0 8px 28px rgba(0,0,0,.16)', padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <strong style={{ flex: 1, fontSize: 14 }}>DSH Fleet</strong>
        <button type="button" onClick={() => void load()} disabled={loading} style={{ border: 0, borderRadius: 7, padding: '5px 8px', cursor: 'pointer' }}>{loading ? '检查中…' : '刷新'}</button>
      </div>
      {error !== null && <div style={{ color: '#dc2626', marginBottom: 8 }}>{error}</div>}
      {status !== null && <>
        <div style={{ display: 'grid', gridTemplateColumns: '82px 1fr', gap: '4px 8px', color: '#596069', marginBottom: 10 }}>
          <span>设备</span><span>{status.device.id}{status.device.registered ? '' : '（未登记）'}</span>
          <span>设备类型</span><span>{status.device.class ?? '—'}</span>
          <span>通道</span><span>{status.device.channel ?? '—'}</span>
          <span>DSH</span><span>{status.dsh.version ?? '未知'} · {status.dsh.profile}</span>
          <span>清单</span><span style={{ color: status.manifest.loaded ? '#16a34a' : '#dc2626' }}>{status.manifest.loaded ? status.manifest.teamId : status.manifest.error}</span>
        </div>
        <div style={{ padding: 8, borderRadius: 8, background: '#f5f6f7', marginBottom: 8 }}>
          期望 {status.summary.desired} · 一致 {status.summary.aligned} · 缺失 {status.summary.missing} · 漂移 {status.summary.drifted} · 失败 {status.summary.failed} · 未管理 {status.summary.unmanaged}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {status.plugins.map(plugin => <div key={plugin.id} style={{ display: 'grid', gridTemplateColumns: '8px minmax(0,1fr) auto', alignItems: 'center', gap: 7, padding: '6px 4px', borderBottom: '1px solid rgba(0,0,0,.06)' }}>
            <span style={{ width: 7, height: 7, borderRadius: 99, background: colors[plugin.state] }} />
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }} title={plugin.id}>{plugin.id}</span>
            <span style={{ color: colors[plugin.state] }}>{stateLabel(plugin.state)}</span>
          </div>)}
          {status.unmanaged.map(plugin => <div key={'unmanaged:' + plugin.id} style={{ display: 'grid', gridTemplateColumns: '8px minmax(0,1fr) auto', alignItems: 'center', gap: 7, padding: '6px 4px' }}>
            <span style={{ width: 7, height: 7, borderRadius: 99, background: '#64748b' }} />
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{plugin.id}</span>
            <span style={{ color: '#64748b' }}>未管理</span>
          </div>)}
        </div>
      </>}
    </div>}
    <button type="button" onClick={() => setOpen(value => !value)} style={{ display: 'flex', alignItems: 'center', gap: 7, border: '1px solid rgba(0,0,0,.12)', borderRadius: 999, background: '#fff', boxShadow: '0 3px 12px rgba(0,0,0,.12)', padding: '7px 11px', cursor: 'pointer', color: '#202124' }}>
      <span style={{ width: 8, height: 8, borderRadius: 99, background: tone }} />
      <strong>Fleet</strong>
      <span style={{ color: '#667085' }}>{status === null ? '…' : issues === 0 ? '一致' : issues + ' 项差异'}</span>
    </button>
  </div>
}

export function apply(ctx: ClientContextLike): void {
  ctx.slots.inject('shell.overlay', () => ctx.slots.register(
    { name: 'shell.overlay', id: 'dsh-fleet', order: 110, label: () => 'DSH Fleet' },
    () => <FleetCard ctx={ctx} />,
  ))
}

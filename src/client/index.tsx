import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  FleetStatus,
  FleetUpdateItem,
  FleetUpdates,
  PluginDriftState,
} from '../shared.ts'

export const inject = ['slots', 'connection']
const CHANNEL = '/dsh-fleet'

const SM = {
  bg: '#eef0f2',
  bg2: '#e6e9ed',
  panel: '#ffffff',
  panelSoft: '#fafbfc',
  fg: '#181a1c',
  fg2: '#5f6670',
  fg3: '#9aa3ad',
  fg4: '#c2cad3',
  good: '#0e8a4f',
  goodSoft: '#e1f3ea',
  bad: '#e0411b',
  badSoft: '#fdecdf',
  warn: '#c98a14',
  warnSoft: '#fbf2dd',
  info: '#0f5f6e',
  infoSoft: '#e0eef0',
  border: 'rgba(20,30,50,0.08)',
  borderStrong: 'rgba(20,30,50,0.13)',
  shadowCard: '0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(20,30,50,0.10)',
  fontSans: '"Noto Sans SC","PingFang SC","Source Han Sans SC",-apple-system,sans-serif',
  fontMono: '"JetBrains Mono","SF Mono","Cascadia Code",Menlo,monospace',
} as const

interface RpcResult<T> {
  ok: boolean
  value?: T
  error?: { message?: string }
}

interface ClientContextLike {
  connection: { rpc: { call<T>(channel: string, endpoint: string, payload: unknown): Promise<RpcResult<T>> } }
  slots: {
    inject(name: string, setup: () => unknown): unknown
    register(descriptor: Record<string, unknown>, component: React.ComponentType): unknown
  }
}

const driftColors: Record<PluginDriftState, string> = {
  aligned: SM.good,
  missing: SM.bad,
  'spec-drift': SM.warn,
  'runtime-failed': SM.bad,
  'runtime-inactive': SM.warn,
}

function driftLabel(state: PluginDriftState): string {
  if (state === 'aligned') return '一致'
  if (state === 'missing') return '缺失'
  if (state === 'spec-drift') return '版本漂移'
  if (state === 'runtime-failed') return '加载失败'
  return '未激活'
}

function updateColor(item: FleetUpdateItem): string {
  if (item.state === 'current') return SM.good
  if (item.state === 'available') return SM.warn
  if (item.state === 'error' || item.state === 'missing') return SM.bad
  if (item.state === 'local') return SM.info
  return SM.fg3
}

function updateLabel(item: FleetUpdateItem): string {
  if (item.state === 'current') return '已是最新'
  if (item.state === 'available') return item.changeKind === 'head-changed' ? '上游有变化' : '可更新'
  if (item.state === 'local') return '本地链接'
  if (item.state === 'missing') return '未安装'
  if (item.state === 'error') return '检查失败'
  return '不支持检查'
}

function sourceLabel(item: FleetUpdateItem): string {
  if (item.kind === 'dsh') return 'CORE'
  if (item.source === 'github') return 'GitHub'
  if (item.source === 'npm') return 'npm'
  if (item.source === 'local') return 'local'
  return 'other'
}

function shortRevision(value: string | undefined): string | undefined {
  return value?.slice(0, 7)
}

function versionText(item: FleetUpdateItem): string {
  if (item.source === 'github') {
    const current = shortRevision(item.currentRevision)
    const latest = shortRevision(item.latestRevision)
    if (current !== undefined && latest !== undefined) return `${current} → ${latest}`
    if (latest !== undefined) return `HEAD ${latest}`
  }
  if (item.currentVersion !== undefined && item.latestVersion !== undefined) {
    return `${item.currentVersion} → ${item.latestVersion}`
  }
  if (item.currentVersion !== undefined && item.state === 'local') return `${item.currentVersion} · 实时源码`
  if (item.latestVersion !== undefined) return `最新 ${item.latestVersion}`
  if (item.errorCode === 'registry-unavailable') return 'npm 查询不可用'
  if (item.errorCode === 'github-unavailable') return 'GitHub 查询不可用'
  if (item.errorCode === 'not-installed') return '目标包未安装'
  return '暂无可比较版本'
}

function formatCheckedAt(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '未知时间'
  return date.toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

function Dot({ color, size = 7 }: { color: string; size?: number }): React.ReactElement {
  return <span aria-hidden="true" style={{ width: size, height: size, flexShrink: 0, borderRadius: 999, background: color }} />
}

function Pill({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'warn' }): React.ReactElement {
  return <span style={{
    display: 'inline-flex', alignItems: 'center', minHeight: 20, padding: '1px 7px', borderRadius: 999,
    background: tone === 'warn' ? SM.warnSoft : SM.bg2, color: tone === 'warn' ? SM.warn : SM.fg2,
    fontFamily: SM.fontMono, fontSize: 10.5, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
  }}>{children}</span>
}

function RefreshIcon(): React.ReactElement {
  return <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 11a8 8 0 1 0-2.34 5.66" />
    <path d="M20 4v7h-7" />
  </svg>
}

function StatusView({ status, error }: { status: FleetStatus | null; error: string | null }): React.ReactElement {
  if (status === null) return <div style={{ padding: 14, color: error === null ? SM.fg3 : SM.bad, fontFamily: SM.fontMono }}>{error ?? '载入中…'}</div>
  return <>
    {error !== null && <div style={{ margin: '0 12px 10px', padding: '8px 10px', borderRadius: 10, background: SM.badSoft, color: SM.bad, fontFamily: SM.fontMono }}>{error}</div>}
    <div style={{ margin: '0 12px 10px', padding: 12, borderRadius: 12, background: SM.panel }}>
      <div style={{ display: 'grid', gridTemplateColumns: '76px minmax(0,1fr)', gap: '5px 8px', color: SM.fg2 }}>
        <span>设备</span><span style={{ color: SM.fg, fontFamily: SM.fontMono }}>{status.device.id}{status.device.registered ? '' : '（未登记）'}</span>
        <span>设备类型</span><span style={{ fontFamily: SM.fontMono }}>{status.device.class ?? '—'}</span>
        <span>通道</span><span style={{ fontFamily: SM.fontMono }}>{status.device.channel ?? '—'}</span>
        <span>DSH</span><span style={{ fontFamily: SM.fontMono }}>{status.dsh.version ?? '未知'} · {status.dsh.profile}</span>
        <span>清单</span><span style={{ color: status.manifest.loaded ? SM.good : SM.bad, overflowWrap: 'anywhere' }}>{status.manifest.loaded ? status.manifest.teamId : status.manifest.error}</span>
      </div>
    </div>
    <div style={{
      margin: '0 12px 10px', padding: '9px 10px', borderRadius: 10, background: SM.panelSoft,
      color: SM.fg2, fontFamily: SM.fontMono, fontVariantNumeric: 'tabular-nums', lineHeight: 1.65,
    }}>
      期望 {status.summary.desired} · 一致 {status.summary.aligned} · 缺失 {status.summary.missing}<br />
      漂移 {status.summary.drifted} · 失败 {status.summary.failed} · 未管理 {status.summary.unmanaged}
    </div>
    <div style={{ margin: '0 12px 12px', borderRadius: 12, background: SM.panel, overflow: 'hidden' }}>
      {status.plugins.map(plugin => <div key={plugin.id} style={{
        display: 'grid', gridTemplateColumns: '8px minmax(0,1fr) auto', alignItems: 'center', gap: 8,
        minHeight: 40, padding: '4px 10px', borderBottom: `1px solid ${SM.border}`,
      }}>
        <Dot color={driftColors[plugin.state]} />
        <span title={plugin.id} style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: SM.fontMono }}>{plugin.id}</span>
        <span style={{ color: driftColors[plugin.state], whiteSpace: 'nowrap' }}>{driftLabel(plugin.state)}</span>
      </div>)}
      {status.unmanaged.map(plugin => <div key={'unmanaged:' + plugin.id} style={{
        display: 'grid', gridTemplateColumns: '8px minmax(0,1fr) auto', alignItems: 'center', gap: 8,
        minHeight: 40, padding: '4px 10px', borderBottom: `1px solid ${SM.border}`,
      }}>
        <Dot color={SM.fg3} />
        <span title={plugin.id} style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: SM.fontMono }}>{plugin.id}</span>
        <span style={{ color: SM.fg3 }}>未管理</span>
      </div>)}
      {status.plugins.length === 0 && status.unmanaged.length === 0 && <div style={{ padding: 12, color: SM.fg3 }}>没有可展示的插件</div>}
    </div>
  </>
}

function UpdatesView({
  updates,
  loading,
  error,
  onRefresh,
}: {
  updates: FleetUpdates | null
  loading: boolean
  error: string | null
  onRefresh: () => void
}): React.ReactElement {
  const snapshot = updates?.snapshot
  const visibleItems = snapshot?.items.filter(item => item.kind === 'dsh' || item.state !== 'current') ?? []
  const hiddenCurrent = snapshot?.items.filter(item => item.kind === 'plugin' && item.state === 'current').length ?? 0
  return <div style={{ padding: '0 12px 12px' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: SM.fg, fontSize: 13, fontWeight: 600 }}>更新检查</div>
        <div title={snapshot?.checkedAt} style={{ color: updates?.stale ? SM.warn : SM.fg3, fontSize: 10.5, fontFamily: SM.fontMono, fontVariantNumeric: 'tabular-nums' }}>
          {snapshot === undefined ? (loading ? '检查中…' : '尚未检查') : `${updates?.stale ? '缓存已过期 · ' : ''}${formatCheckedAt(snapshot.checkedAt)}`}
        </div>
      </div>
      <button type="button" onClick={onRefresh} disabled={loading || updates?.enabled === false} style={{
        minHeight: 30, padding: '4px 10px', border: `1px solid ${SM.borderStrong}`, borderRadius: 999,
        background: SM.panel, color: loading ? SM.fg3 : SM.fg2, cursor: loading ? 'default' : 'pointer',
        fontFamily: SM.fontSans, fontSize: 11.5,
      }}>{loading ? '检查中…' : '重新检查'}</button>
    </div>
    <div style={{ marginBottom: 10, color: SM.fg3, fontSize: 10.5, lineHeight: 1.5 }}>
      只读比较公开发布源，不会安装、修改配置或重启 DSH。
    </div>
    {error !== null && <div style={{ marginBottom: 10, padding: '8px 10px', borderRadius: 10, background: SM.badSoft, color: SM.bad, fontFamily: SM.fontMono }}>{error}</div>}
    {updates?.enabled === false && <div style={{ padding: 12, borderRadius: 10, background: SM.panel, color: SM.fg3 }}>更新检查已在配置中关闭</div>}
    {snapshot !== undefined && <>
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 9,
        fontFamily: SM.fontMono, fontVariantNumeric: 'tabular-nums',
      }}>
        <Pill tone={snapshot.summary.available > 0 ? 'warn' : 'neutral'}>{snapshot.summary.available} 个变化</Pill>
        <Pill>{snapshot.summary.current} 个最新</Pill>
        <Pill>{snapshot.summary.local} 个本地</Pill>
        {snapshot.summary.errors > 0 && <Pill tone="warn">{snapshot.summary.errors} 个失败</Pill>}
      </div>
      <div style={{ borderRadius: 12, background: SM.panel, overflow: 'hidden' }}>
        {visibleItems.map(item => <div key={`${item.kind}:${item.id}`} style={{
          display: 'grid', gridTemplateColumns: '8px minmax(0,1fr) auto', gap: 8, alignItems: 'center',
          minHeight: 48, padding: '5px 10px', borderBottom: `1px solid ${SM.border}`,
        }}>
          <Dot color={updateColor(item)} />
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <span title={item.id} style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: SM.fg, fontFamily: SM.fontMono, fontSize: 11.5 }}>{item.kind === 'dsh' ? 'DSH Core' : item.id}</span>
              <Pill>{sourceLabel(item)}</Pill>
              {item.sourceUrl !== undefined && <a href={item.sourceUrl} target="_blank" rel="noreferrer" aria-label={`打开 ${item.id} 发布源`} style={{ color: SM.fg3, textDecoration: 'none' }}>↗</a>}
            </div>
            <div title={[item.currentRevision, item.latestRevision].filter(Boolean).join(' → ')} style={{
              marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              color: SM.fg3, fontFamily: SM.fontMono, fontSize: 10.5, fontVariantNumeric: 'tabular-nums',
            }}>{versionText(item)}</div>
          </div>
          <span style={{ color: updateColor(item), whiteSpace: 'nowrap', fontSize: 11 }}>{updateLabel(item)}</span>
        </div>)}
        {hiddenCurrent > 0 && <div style={{ padding: '9px 10px', color: SM.good, fontSize: 11 }}>{hiddenCurrent} 个插件已是最新</div>}
        {visibleItems.length === 0 && hiddenCurrent === 0 && <div style={{ padding: 12, color: SM.fg3 }}>没有可检查的项目</div>}
      </div>
    </>}
    {snapshot === undefined && updates?.enabled !== false && !loading && error === null && <div style={{ padding: 12, borderRadius: 10, background: SM.panel, color: SM.fg3 }}>切到此页时会按需检查；结果缓存 6 小时。</div>}
  </div>
}

export function FleetCard({ ctx }: { ctx: ClientContextLike }): React.ReactElement {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'status' | 'updates'>('status')
  const [status, setStatus] = useState<FleetStatus | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [statusLoading, setStatusLoading] = useState(false)
  const [updates, setUpdates] = useState<FleetUpdates | null>(null)
  const [updateError, setUpdateError] = useState<string | null>(null)
  const [updateLoading, setUpdateLoading] = useState(false)
  const statusInFlight = useRef<Promise<void> | null>(null)
  const updatesInFlight = useRef<Promise<void> | null>(null)

  const loadStatus = useCallback(async () => {
    if (statusInFlight.current !== null) return statusInFlight.current
    const request = (async () => {
      setStatusLoading(true)
      try {
        const result = await ctx.connection.rpc.call<FleetStatus>(CHANNEL, 'status', null)
        if (!result.ok || result.value === undefined) throw new Error(result.error?.message ?? 'fleet status unavailable')
        setStatus(result.value)
        setStatusError(null)
      } catch (cause: unknown) {
        setStatusError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        setStatusLoading(false)
      }
    })()
    statusInFlight.current = request
    try {
      await request
    } finally {
      statusInFlight.current = null
    }
  }, [ctx])

  const loadUpdates = useCallback(async (mode: 'if-stale' | 'force' = 'if-stale') => {
    if (updatesInFlight.current !== null) return updatesInFlight.current
    const request = (async () => {
      setUpdateLoading(true)
      try {
        const result = await ctx.connection.rpc.call<FleetUpdates>(CHANNEL, 'updates', { mode })
        if (!result.ok || result.value === undefined) throw new Error(result.error?.message ?? 'update check unavailable')
        setUpdates(result.value)
        setUpdateError(null)
      } catch (cause: unknown) {
        setUpdateError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        setUpdateLoading(false)
      }
    })()
    updatesInFlight.current = request
    try {
      await request
    } finally {
      updatesInFlight.current = null
    }
  }, [ctx])

  useEffect(() => {
    void loadStatus()
    const timer = window.setInterval(() => { if (!document.hidden) void loadStatus() }, 30_000)
    return () => window.clearInterval(timer)
  }, [loadStatus])

  useEffect(() => {
    if (!open || tab !== 'updates' || updates !== null || updateError !== null || updateLoading) return
    void loadUpdates('if-stale')
  }, [loadUpdates, open, tab, updateError, updateLoading, updates])

  const driftIssues = useMemo(() => status === null
    ? 0
    : status.summary.missing + status.summary.drifted + status.summary.failed + status.summary.unmanaged,
  [status])
  const availableUpdates = updates?.snapshot?.summary.available ?? 0
  const updateFailures = updates?.snapshot?.summary.errors ?? 0
  const tone = statusError !== null || status?.manifest.loaded === false || (status?.summary.failed ?? 0) > 0 || updateError !== null || updateFailures > 0
    ? SM.bad
    : driftIssues > 0 || availableUpdates > 0 || updates?.stale === true
      ? SM.warn
      : status === null ? SM.fg3 : SM.good
  const closedText = status === null
    ? (statusError === null ? '载入中…' : '状态获取失败')
    : [
        driftIssues === 0 ? '一致' : `${driftIssues} 项差异`,
        updateError !== null || updateFailures > 0
          ? '更新检查失败'
          : availableUpdates > 0 ? `${availableUpdates} 个更新` : undefined,
      ]
        .filter((value): value is string => value !== undefined).join(' · ')

  return <div style={{
    position: 'fixed', left: 14, bottom: 14, zIndex: 950, pointerEvents: 'auto',
    width: 380, maxWidth: 'calc(100vw - 28px)', fontFamily: SM.fontSans, fontSize: 12, color: SM.fg,
  }}>
    {open && <div style={{
      maxHeight: '68vh', overflow: 'auto', marginBottom: 8, border: `1px solid ${SM.border}`,
      borderRadius: 20, background: SM.bg, boxShadow: SM.shadowCard,
    }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 1, padding: '11px 12px 9px', background: SM.panel, borderBottom: `1px solid ${SM.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Dot color={tone} size={8} />
          <strong style={{ flex: 1, fontSize: 14 }}>DSH Fleet</strong>
          <button type="button" aria-label="刷新状态" title="刷新状态" onClick={() => void loadStatus()} disabled={statusLoading} style={{
            width: 30, height: 30, display: 'grid', placeItems: 'center', border: 0, borderRadius: 10,
            background: SM.panelSoft, color: statusLoading ? SM.fg3 : SM.fg2, cursor: statusLoading ? 'default' : 'pointer',
          }}><RefreshIcon /></button>
        </div>
        <div role="tablist" aria-label="Fleet 视图" style={{ display: 'flex', gap: 4, marginTop: 9, padding: 3, borderRadius: 999, background: SM.bg2 }}>
          {(['status', 'updates'] as const).map(key => <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)} style={{
            flex: 1, minHeight: 28, border: 0, borderRadius: 999, background: tab === key ? SM.fg : 'transparent',
            color: tab === key ? SM.panel : SM.fg2, cursor: 'pointer', fontFamily: SM.fontSans, fontSize: 11.5,
          }}>{key === 'status' ? '状态' : `更新${availableUpdates > 0 ? ` ${availableUpdates}` : ''}`}</button>)}
        </div>
      </div>
      <div style={{ paddingTop: 10 }}>
        {tab === 'status'
          ? <StatusView status={status} error={statusError} />
          : <UpdatesView updates={updates} loading={updateLoading} error={updateError} onRefresh={() => void loadUpdates('force')} />}
      </div>
    </div>}
    <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)} style={{
      display: 'flex', alignItems: 'center', gap: 7, minHeight: 36, border: `1px solid ${SM.borderStrong}`,
      borderRadius: 999, background: SM.panel, boxShadow: SM.shadowCard, padding: '7px 12px', cursor: 'pointer', color: SM.fg,
    }}>
      <Dot color={tone} size={8} />
      <strong>Fleet</strong>
      <span style={{ color: SM.fg2, fontFamily: SM.fontMono, fontVariantNumeric: 'tabular-nums' }}>{closedText}</span>
    </button>
  </div>
}

export function apply(ctx: ClientContextLike): void {
  ctx.slots.inject('shell.overlay', () => ctx.slots.register(
    { name: 'shell.overlay', id: 'dsh-fleet', order: 110, label: () => 'DSH Fleet' },
    () => <FleetCard ctx={ctx} />,
  ))
}

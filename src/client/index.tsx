import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import type { RpcResult } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { FleetPlan } from '../agent/protocol.ts'
import type { AgentActionRecord, AgentInspection } from '../agent/runtime.ts'
import type {
  FleetStatus,
  FleetUpdateItem,
  FleetUpdates,
  PluginDriftState,
} from '../shared.ts'

export const inject = ['slots', 'connection']
const CHANNEL = '/dsh-fleet'
const AGENT_CHANNEL = '/dsh-fleet-agent'

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

interface ClientContextLike {
  connection: { rpc: ClientConnectionRpc }
  slots: {
    inject(name: string, setup: () => unknown): unknown
    register(descriptor: Record<string, unknown>, component: React.ComponentType): unknown
  }
}

interface AgentTargetView {
  deviceId: string
  transport: 'local' | 'ssh'
  online: boolean
  errorCode?: string
  inspection?: AgentInspection
}

interface AgentTargetsView {
  enabled: boolean
  targets: AgentTargetView[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function rpcValue<T>(result: RpcResult<unknown>, guard: (value: unknown) => value is T, fallback: string): T {
  if (!result.ok) throw new Error(result.error.message)
  if (!guard(result.value)) throw new Error(fallback)
  return result.value
}

function isFleetStatus(value: unknown): value is FleetStatus {
  return isRecord(value) && isRecord(value.device) && isRecord(value.runtime) &&
    Array.isArray(value.runtime.failedModules) && value.runtime.failedModules.every(item => typeof item === 'string') &&
    isRecord(value.summary) && Array.isArray(value.plugins)
}

function isFleetUpdates(value: unknown): value is FleetUpdates {
  return isRecord(value) && typeof value.enabled === 'boolean' && typeof value.cached === 'boolean' && typeof value.stale === 'boolean'
}

function isAgentTargets(value: unknown): value is AgentTargetsView {
  if (!isRecord(value) || typeof value.enabled !== 'boolean' || !Array.isArray(value.targets)) return false
  return value.targets.every(target => {
    if (!isRecord(target) || typeof target.deviceId !== 'string' ||
        (target.transport !== 'local' && target.transport !== 'ssh') || typeof target.online !== 'boolean') return false
    if (target.errorCode !== undefined && typeof target.errorCode !== 'string') return false
    if (target.inspection === undefined) return target.online === false
    const inspection = target.inspection
    return isRecord(inspection) && inspection.protocolVersion === 1 && typeof inspection.deviceId === 'string' &&
      typeof inspection.profile === 'string' && typeof inspection.dshVersion === 'string' &&
      typeof inspection.manifestDigest === 'string' && typeof inspection.profileHash === 'string' &&
      Array.isArray(inspection.candidates) && inspection.candidates.every(candidate =>
        isRecord(candidate) && typeof candidate.pluginId === 'string' &&
        (candidate.action === 'install' || candidate.action === 'update') &&
        (candidate.fromSpec === null || typeof candidate.fromSpec === 'string') &&
        typeof candidate.exactToSpec === 'string' &&
        (candidate.sourceKind === 'npm' || candidate.sourceKind === 'github'))
  })
}

function isFleetPlan(value: unknown): value is FleetPlan {
  return isRecord(value) && typeof value.planId === 'string' && typeof value.digest === 'string' &&
    typeof value.deviceId === 'string' && typeof value.profile === 'string' && typeof value.pluginId === 'string' &&
    (value.action === 'install' || value.action === 'update') && typeof value.exactToSpec === 'string' &&
    typeof value.expiresAt === 'string'
}

function isAgentAction(value: unknown): value is AgentActionRecord {
  const states = new Set([
    'approved', 'staging', 'staged', 'applying', 'restarting', 'verifying', 'succeeded',
    'rollback', 'rollback-restarting', 'rollback-verifying', 'rolled-back', 'manual-intervention',
  ])
  return isRecord(value) && typeof value.planId === 'string' && typeof value.state === 'string' && states.has(value.state) &&
    typeof value.pluginId === 'string' && typeof value.updatedAt === 'string'
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
      漂移 {status.summary.drifted} · 失败 {status.summary.failed} · 未管理 {status.summary.unmanaged}<br />
      <span title={status.runtime.failedModules.join(', ')} style={{ color: status.runtime.failedModules.length > 0 ? SM.bad : SM.fg2 }}>
        Loader 失败 {status.runtime.failedModules.length}{status.runtime.failedModules.length > 0 ? ` · ${status.runtime.failedModules.join(', ')}` : ''}
      </span>
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

function actionLabel(state: AgentActionRecord['state']): string {
  if (state === 'succeeded') return '已完成'
  if (state === 'rolled-back') return '已自动回滚'
  if (state === 'manual-intervention') return '需要人工处理'
  if (state.startsWith('rollback')) return '正在回滚'
  if (state === 'verifying') return '正在健康检查'
  if (state === 'restarting') return '正在重启'
  if (state === 'applying') return '正在安装'
  return '正在准备'
}

function actionColor(state: AgentActionRecord['state']): string {
  if (state === 'succeeded') return SM.good
  if (state === 'rolled-back' || state === 'manual-intervention' || state.startsWith('rollback')) return SM.bad
  return SM.warn
}

function OperationsView({
  targets,
  plan,
  action,
  loading,
  error,
  armed,
  onArm,
  onReload,
  onPlan,
  onApprove,
}: {
  targets: AgentTargetsView | null
  plan: FleetPlan | null
  action: AgentActionRecord | null
  loading: boolean
  error: string | null
  armed: boolean
  onArm(value: boolean): void
  onReload(): void
  onPlan(deviceId: string, pluginId: string): void
  onApprove(): void
}): React.ReactElement {
  return <div style={{ padding: '0 12px 12px' }}>
    <div style={{ marginBottom: 10, padding: '9px 10px', borderRadius: 10, background: SM.panelSoft, color: SM.fg2, lineHeight: 1.55 }}>
      仅允许清单内的精确版本。每次只处理一个插件，并在目标机快照、重启、健康检查；失败自动回滚。
    </div>
    {error !== null && <div style={{ marginBottom: 10, padding: '9px 10px', borderRadius: 10, background: SM.badSoft, color: SM.bad, fontFamily: SM.fontMono }}>{error}</div>}
    {targets?.enabled === false && <div style={{ padding: 12, borderRadius: 10, background: SM.panel, color: SM.fg3 }}>远程收敛未启用</div>}
    {targets === null && error === null && <div style={{ padding: 12, color: SM.fg3 }}>载入中…</div>}
    {targets?.targets.map(target => <div key={target.deviceId} style={{ marginBottom: 10, borderRadius: 12, background: SM.panel, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 11px', borderBottom: `1px solid ${SM.border}` }}>
        <Dot color={target.online ? SM.good : SM.bad} />
        <strong style={{ flex: 1, fontFamily: SM.fontMono }}>{target.deviceId}</strong>
        <span style={{ color: SM.fg3, fontFamily: SM.fontMono }}>{target.inspection?.dshVersion ?? target.errorCode ?? '离线'}</span>
      </div>
      {target.online && target.inspection?.candidates.map(candidate => <div key={candidate.pluginId} style={{
        display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 8, alignItems: 'center',
        minHeight: 48, padding: '7px 10px', borderBottom: `1px solid ${SM.border}`,
      }}>
        <div style={{ minWidth: 0 }}>
          <div title={candidate.pluginId} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: SM.fontMono }}>{candidate.pluginId}</div>
          <div title={candidate.exactToSpec} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: SM.fg3, fontFamily: SM.fontMono, fontSize: 10.5 }}>
            {candidate.action === 'install' ? '安装' : '更新'} → {candidate.exactToSpec}
          </div>
        </div>
        <button type="button" disabled={loading} onClick={() => onPlan(target.deviceId, candidate.pluginId)} style={{
          minHeight: 28, padding: '4px 9px', border: 0, borderRadius: 9, background: SM.infoSoft, color: SM.info,
          cursor: loading ? 'default' : 'pointer', fontFamily: SM.fontSans,
        }}>生成计划</button>
      </div>)}
      {target.online && target.inspection?.candidates.length === 0 && <div style={{ padding: 10, color: SM.good }}>该设备已经一致</div>}
    </div>)}
    {plan !== null && <div style={{ marginBottom: 10, padding: 11, borderRadius: 12, background: SM.panel, boxShadow: SM.shadowCard }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
        <Dot color={SM.warn} />
        <strong>待批准计划</strong>
        <span style={{ marginLeft: 'auto', color: SM.fg3, fontFamily: SM.fontMono }}>{plan.action === 'install' ? 'INSTALL' : 'UPDATE'}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '72px minmax(0,1fr)', gap: '5px 8px', color: SM.fg2 }}>
        <span>设备</span><span style={{ fontFamily: SM.fontMono }}>{plan.deviceId}</span>
        <span>插件</span><span style={{ fontFamily: SM.fontMono }}>{plan.pluginId}</span>
        <span>目标</span><span title={plan.exactToSpec} style={{ overflowWrap: 'anywhere', fontFamily: SM.fontMono }}>{plan.exactToSpec}</span>
        <span>计划</span><span title={plan.planId} style={{ fontFamily: SM.fontMono }}>{plan.digest.slice(0, 12)}</span>
        <span>过期</span><span style={{ fontFamily: SM.fontMono, fontVariantNumeric: 'tabular-nums' }}>{formatCheckedAt(plan.expiresAt)}</span>
      </div>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 10, color: SM.fg2, cursor: 'pointer' }}>
        <input type="checkbox" checked={armed} onChange={event => onArm(event.currentTarget.checked)} />
        <span>我确认由 {plan.deviceId} 执行这一精确计划；失败时自动回滚。</span>
      </label>
      <button type="button" disabled={!armed || loading} onClick={onApprove} style={{
        width: '100%', minHeight: 32, marginTop: 10, border: 0, borderRadius: 10,
        background: armed && !loading ? SM.bad : SM.fg4, color: SM.panel,
        cursor: armed && !loading ? 'pointer' : 'default', fontFamily: SM.fontSans, fontWeight: 600,
      }}>{loading ? '执行中…' : '批准并执行一次'}</button>
    </div>}
    {action !== null && <div style={{ marginBottom: 10, padding: 10, borderRadius: 10, background: action.state === 'succeeded' ? SM.goodSoft : SM.badSoft, color: actionColor(action.state) }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}><Dot color={actionColor(action.state)} /><strong>{actionLabel(action.state)}</strong></div>
      <div style={{ marginTop: 4, fontFamily: SM.fontMono, fontVariantNumeric: 'tabular-nums' }}>{action.pluginId} · {action.updatedAt.slice(0, 19).replace('T', ' ')}</div>
    </div>}
    <button type="button" onClick={onReload} disabled={loading} style={{
      width: '100%', minHeight: 30, border: `1px solid ${SM.borderStrong}`, borderRadius: 10,
      background: SM.panel, color: SM.fg2, cursor: loading ? 'default' : 'pointer', fontFamily: SM.fontSans,
    }}>刷新目标状态</button>
  </div>
}

export function FleetCard({ ctx }: { ctx: ClientContextLike }): React.ReactElement {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'status' | 'updates' | 'operations'>('status')
  const [status, setStatus] = useState<FleetStatus | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [statusLoading, setStatusLoading] = useState(false)
  const [updates, setUpdates] = useState<FleetUpdates | null>(null)
  const [updateError, setUpdateError] = useState<string | null>(null)
  const [updateLoading, setUpdateLoading] = useState(false)
  const [agentTargets, setAgentTargets] = useState<AgentTargetsView | null>(null)
  const [agentPlan, setAgentPlan] = useState<FleetPlan | null>(null)
  const [agentAction, setAgentAction] = useState<AgentActionRecord | null>(null)
  const [agentError, setAgentError] = useState<string | null>(null)
  const [agentLoading, setAgentLoading] = useState(false)
  const [approvalArmed, setApprovalArmed] = useState(false)
  const statusInFlight = useRef<Promise<void> | null>(null)
  const updatesInFlight = useRef<Promise<void> | null>(null)
  const agentsInFlight = useRef<Promise<void> | null>(null)
  const agentMutationInFlight = useRef(false)

  const loadStatus = useCallback(async () => {
    if (statusInFlight.current !== null) return statusInFlight.current
    const request = (async () => {
      setStatusLoading(true)
      try {
        const result = await ctx.connection.rpc.call(CHANNEL, 'status', null)
        setStatus(rpcValue(result, isFleetStatus, 'fleet status unavailable'))
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
        const result = await ctx.connection.rpc.call(CHANNEL, 'updates', { mode })
        setUpdates(rpcValue(result, isFleetUpdates, 'update check unavailable'))
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

  const loadAgentTargets = useCallback(async () => {
    if (agentsInFlight.current !== null) return agentsInFlight.current
    const request = (async () => {
      setAgentLoading(true)
      try {
        const result = await ctx.connection.rpc.call(AGENT_CHANNEL, 'targets', null)
        setAgentTargets(rpcValue(result, isAgentTargets, 'fleet targets unavailable'))
        setAgentError(null)
      } catch (cause: unknown) {
        setAgentError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        setAgentLoading(false)
      }
    })()
    agentsInFlight.current = request
    try {
      await request
    } finally {
      agentsInFlight.current = null
    }
  }, [ctx])

  const requestPlan = useCallback(async (deviceId: string, pluginId: string) => {
    if (agentMutationInFlight.current) return
    agentMutationInFlight.current = true
    setAgentLoading(true)
    setAgentPlan(null)
    setAgentAction(null)
    setApprovalArmed(false)
    try {
      const result = await ctx.connection.rpc.call(AGENT_CHANNEL, 'plan', { deviceId, pluginId })
      setAgentPlan(rpcValue(result, isFleetPlan, 'fleet plan unavailable'))
      setAgentError(null)
    } catch (cause: unknown) {
      setAgentError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      agentMutationInFlight.current = false
      setAgentLoading(false)
    }
  }, [ctx])

  const approvePlan = useCallback(async () => {
    if (agentPlan === null || !approvalArmed || agentMutationInFlight.current) return
    agentMutationInFlight.current = true
    const approvedPlan = agentPlan
    setAgentLoading(true)
    setApprovalArmed(false)
    try {
      const result = await ctx.connection.rpc.call(AGENT_CHANNEL, 'approve', {
        approvalId: crypto.randomUUID(),
        deviceId: approvedPlan.deviceId,
        planDigest: approvedPlan.digest,
        planExpiresAt: approvedPlan.expiresAt,
        planId: approvedPlan.planId,
        profile: approvedPlan.profile,
      })
      setAgentAction(rpcValue(result, isAgentAction, 'fleet action result unavailable'))
      setAgentPlan(null)
      setAgentError(null)
      void loadAgentTargets()
    } catch (cause: unknown) {
      const applyError = cause instanceof Error ? cause.message : String(cause)
      try {
        const status = await ctx.connection.rpc.call(AGENT_CHANNEL, 'action-status', {
          deviceId: approvedPlan.deviceId,
          planId: approvedPlan.planId,
        })
        setAgentAction(rpcValue(status, isAgentAction, 'fleet action status unavailable'))
        setAgentPlan(null)
        setAgentError(null)
        void loadAgentTargets()
      } catch {
        setAgentError(applyError)
      }
    } finally {
      agentMutationInFlight.current = false
      setAgentLoading(false)
    }
  }, [agentPlan, approvalArmed, ctx, loadAgentTargets])

  useEffect(() => {
    void loadStatus()
    const timer = window.setInterval(() => { if (!document.hidden) void loadStatus() }, 30_000)
    return () => window.clearInterval(timer)
  }, [loadStatus])

  useEffect(() => {
    if (!open || tab !== 'updates' || updates !== null || updateError !== null || updateLoading) return
    void loadUpdates('if-stale')
  }, [loadUpdates, open, tab, updateError, updateLoading, updates])

  useEffect(() => {
    if (!open || tab !== 'operations' || agentTargets !== null || agentError !== null || agentLoading) return
    void loadAgentTargets()
  }, [agentError, agentLoading, agentTargets, loadAgentTargets, open, tab])

  const driftIssues = useMemo(() => status === null
    ? 0
    : status.summary.missing + status.summary.drifted + status.summary.failed + status.summary.unmanaged,
  [status])
  const availableUpdates = updates?.snapshot?.summary.available ?? 0
  const updateFailures = updates?.snapshot?.summary.errors ?? 0
  const runtimeFailures = status?.runtime.failedModules.length ?? 0
  const tone = statusError !== null || status?.manifest.loaded === false || (status?.summary.failed ?? 0) > 0 || runtimeFailures > 0 || updateError !== null || updateFailures > 0 || agentError !== null || agentAction?.state === 'manual-intervention'
    ? SM.bad
    : driftIssues > 0 || availableUpdates > 0 || updates?.stale === true
      ? SM.warn
      : status === null ? SM.fg3 : SM.good
  const closedText = status === null
    ? (statusError === null ? '载入中…' : '状态获取失败')
    : [
        driftIssues === 0 && runtimeFailures === 0 ? '一致' : driftIssues > 0 ? `${driftIssues} 项差异` : undefined,
        runtimeFailures > 0 ? `Loader ${runtimeFailures} 失败` : undefined,
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
          {(['status', 'updates', 'operations'] as const).map(key => <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)} style={{
            flex: 1, minHeight: 28, border: 0, borderRadius: 999, background: tab === key ? SM.fg : 'transparent',
            color: tab === key ? SM.panel : SM.fg2, cursor: 'pointer', fontFamily: SM.fontSans, fontSize: 11.5,
          }}>{key === 'status' ? '状态' : key === 'updates' ? `更新${availableUpdates > 0 ? ` ${availableUpdates}` : ''}` : '操作'}</button>)}
        </div>
      </div>
      <div style={{ paddingTop: 10 }}>
        {tab === 'status'
          ? <StatusView status={status} error={statusError} />
          : tab === 'updates'
            ? <UpdatesView updates={updates} loading={updateLoading} error={updateError} onRefresh={() => void loadUpdates('force')} />
            : <OperationsView
                targets={agentTargets}
                plan={agentPlan}
                action={agentAction}
                loading={agentLoading}
                error={agentError}
                armed={approvalArmed}
                onArm={setApprovalArmed}
                onReload={() => { setAgentTargets(null); setAgentError(null); void loadAgentTargets() }}
                onPlan={(deviceId, pluginId) => void requestPlan(deviceId, pluginId)}
                onApprove={() => void approvePlan()}
              />}
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

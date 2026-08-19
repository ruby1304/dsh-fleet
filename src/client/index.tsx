import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import type { RpcResult } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { FleetPlan } from '../agent/protocol.ts'
import type { FleetReleasePlan } from '../agent/release-protocol.ts'
import type {
  AgentActionRecord,
  AgentActionState,
  AgentInspection,
  ReleaseActionRecord,
  ReleaseAgentInspection,
} from '../agent/runtime.ts'
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
  mode?: 'single-plugin' | 'profile-release'
  errorCode?: string
  inspection?: AgentInspection | ReleaseAgentInspection
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
    if (target.mode !== undefined && target.mode !== 'single-plugin' && target.mode !== 'profile-release') return false
    if (target.errorCode !== undefined && typeof target.errorCode !== 'string') return false
    if (target.inspection === undefined) return target.online === false
    const inspection = target.inspection
    if (!isRecord(inspection) || inspection.protocolVersion !== 1 || typeof inspection.deviceId !== 'string' ||
      typeof inspection.profile !== 'string' || typeof inspection.dshVersion !== 'string' ||
      typeof inspection.manifestDigest !== 'string' || typeof inspection.profileHash !== 'string') return false
    if (inspection.kind === 'profile-release') {
      return isRecord(inspection.assignedRelease) && typeof inspection.assignedRelease.releaseId === 'string' &&
        typeof inspection.assignedRelease.releaseVersion === 'string' && Array.isArray(inspection.changes) &&
        inspection.changes.every(change => isRecord(change) && typeof change.pluginId === 'string' &&
          (change.action === 'install' || change.action === 'update' || change.action === 'remove')) &&
        isRecord(inspection.tasks) && typeof inspection.tasks.enabled === 'boolean' &&
        Array.isArray(inspection.tasks.workspaceIds) && inspection.tasks.workspaceIds.every(id => typeof id === 'string') &&
        Array.isArray(inspection.tasks.profiles) && inspection.tasks.profiles.every(profile => typeof profile === 'string')
    }
    return Array.isArray(inspection.candidates) && inspection.candidates.every(candidate =>
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

function isFleetReleasePlan(value: unknown): value is FleetReleasePlan {
  return isRecord(value) && value.kind === 'profile-release' && typeof value.planId === 'string' &&
    typeof value.digest === 'string' && typeof value.deviceId === 'string' && typeof value.profile === 'string' &&
    typeof value.releaseId === 'string' && typeof value.releaseVersion === 'string' &&
    Array.isArray(value.plugins) && Array.isArray(value.changes) && typeof value.expiresAt === 'string'
}

function isAgentAction(value: unknown): value is AgentActionRecord | ReleaseActionRecord {
  const states = new Set([
    'approved', 'staging', 'staged', 'applying', 'restarting', 'verifying', 'succeeded',
    'rollback', 'rollback-restarting', 'rollback-verifying', 'rolled-back', 'manual-intervention',
  ])
  return isRecord(value) && typeof value.planId === 'string' && typeof value.state === 'string' && states.has(value.state) &&
    (typeof value.pluginId === 'string' || typeof value.releaseId === 'string') && typeof value.updatedAt === 'string'
}

interface FleetTaskReply {
  taskId: string
  response: {
    kind: 'task.progress' | 'task.result'
    payload: {
      taskId: string
      state: string
      updatedAt: string
      result?: string | null
      truncated?: boolean
      errorCode?: string | null
    }
  }
}

function isFleetTaskReply(value: unknown): value is FleetTaskReply {
  if (!isRecord(value) || typeof value.taskId !== 'string' || !isRecord(value.response) ||
      (value.response.kind !== 'task.progress' && value.response.kind !== 'task.result') || !isRecord(value.response.payload)) return false
  const payload = value.response.payload
  return payload.taskId === value.taskId && typeof payload.state === 'string' && typeof payload.updatedAt === 'string' &&
    (payload.result === undefined || payload.result === null || typeof payload.result === 'string') &&
    (payload.truncated === undefined || typeof payload.truncated === 'boolean') &&
    (payload.errorCode === undefined || payload.errorCode === null || typeof payload.errorCode === 'string')
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
  if (item.state === 'local') return item.source === 'artifact' ? '已固定' : '本地链接'
  if (item.state === 'missing') return '未安装'
  if (item.state === 'error') return '检查失败'
  return '不支持检查'
}

function sourceLabel(item: FleetUpdateItem): string {
  if (item.kind === 'dsh') return 'CORE'
  if (item.source === 'github') return 'GitHub'
  if (item.source === 'npm') return 'npm'
  if (item.source === 'artifact') return 'tarball'
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
  if (item.currentVersion !== undefined && item.state === 'local') {
    return item.source === 'artifact' ? `${item.currentVersion} · 不可变制品` : `${item.currentVersion} · 实时源码`
  }
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

function FleetIcon(): React.ReactElement {
  return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="7" height="6" rx="2" />
    <rect x="14" y="4" width="7" height="6" rx="2" />
    <rect x="8.5" y="15" width="7" height="5" rx="2" />
    <path d="M6.5 10v2.5H12M17.5 10v2.5H12M12 12.5V15" />
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
  const artifactCount = snapshot?.items.filter(item => item.state === 'local' && item.source === 'artifact').length ?? 0
  const liveLocalCount = (snapshot?.summary.local ?? 0) - artifactCount
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
        {artifactCount > 0 && <Pill>{artifactCount} 个制品</Pill>}
        {liveLocalCount > 0 && <Pill>{liveLocalCount} 个本地链接</Pill>}
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

function actionLabel(state: AgentActionState): string {
  if (state === 'succeeded') return '已完成'
  if (state === 'rolled-back') return '已自动回滚'
  if (state === 'manual-intervention') return '需要人工处理'
  if (state.startsWith('rollback')) return '正在回滚'
  if (state === 'verifying') return '正在健康检查'
  if (state === 'restarting') return '正在重启'
  if (state === 'applying') return '正在安装'
  return '正在准备'
}

function actionColor(state: AgentActionState): string {
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
  plan: FleetPlan | FleetReleasePlan | null
  action: AgentActionRecord | ReleaseActionRecord | null
  loading: boolean
  error: string | null
  armed: boolean
  onArm(value: boolean): void
  onReload(): void
  onPlan(deviceId: string, pluginId?: string): void
  onApprove(): void
}): React.ReactElement {
  return <div style={{ padding: '0 12px 12px' }}>
    <div style={{ marginBottom: 10, padding: '9px 10px', borderRadius: 10, background: SM.panelSoft, color: SM.fg2, lineHeight: 1.55 }}>
      v2 设备按完整 Profile Release 原子切换；公开包与私有制品一起审批、验证和回滚。旧版 v1 设备仍保留单插件兼容流程。
    </div>
    {error !== null && <div style={{ marginBottom: 10, padding: '9px 10px', borderRadius: 10, background: SM.badSoft, color: SM.bad, fontFamily: SM.fontMono }}>{error}</div>}
    {targets?.enabled === false && <div style={{ padding: 12, borderRadius: 10, background: SM.panel, color: SM.fg3 }}>远程收敛未启用</div>}
    {targets === null && error === null && <div style={{ padding: 12, color: SM.fg3 }}>载入中…</div>}
    {targets?.targets.map(target => {
      const release = target.inspection !== undefined && 'kind' in target.inspection && target.inspection.kind === 'profile-release'
        ? target.inspection
        : null
      const legacy = target.inspection !== undefined && !('kind' in target.inspection) ? target.inspection : null
      return <div key={target.deviceId} style={{ marginBottom: 10, borderRadius: 12, background: SM.panel, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 11px', borderBottom: `1px solid ${SM.border}` }}>
          <Dot color={target.online ? SM.good : SM.bad} />
          <strong style={{ flex: 1, fontFamily: SM.fontMono }}>{target.deviceId}</strong>
          {release !== null && <Pill>RELEASE</Pill>}
          <span style={{ color: SM.fg3, fontFamily: SM.fontMono }}>{target.inspection?.dshVersion ?? target.errorCode ?? '离线'}</span>
        </div>
        {target.online && release !== null && <div style={{ padding: '10px 11px' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong style={{ fontFamily: SM.fontMono }}>{release.assignedRelease.releaseId}@{release.assignedRelease.releaseVersion}</strong>
              <div style={{ marginTop: 3, color: release.changes.length === 0 ? SM.good : SM.warn }}>
                {release.changes.length === 0 ? '文件已一致，等待登记 release' : `${release.changes.length} 项原子变更`}
              </div>
            </div>
            <button type="button" disabled={loading} onClick={() => onPlan(target.deviceId)} style={{
              minHeight: 30, padding: '4px 10px', border: 0, borderRadius: 9, background: SM.infoSoft, color: SM.info,
              cursor: loading ? 'default' : 'pointer', fontFamily: SM.fontSans,
            }}>生成原子计划</button>
          </div>
          {release.changes.map(change => <div key={change.pluginId} style={{ marginTop: 6, color: SM.fg3, fontFamily: SM.fontMono, fontSize: 10.5 }}>
            {change.action.toUpperCase()} · {change.pluginId}
          </div>)}
        </div>}
        {target.online && legacy?.candidates.map(candidate => <div key={candidate.pluginId} style={{
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
        {target.online && legacy?.candidates.length === 0 && <div style={{ padding: 10, color: SM.good }}>该设备已经一致</div>}
      </div>
    })}
    {plan !== null && <div style={{ marginBottom: 10, padding: 11, borderRadius: 12, background: SM.panel, boxShadow: SM.shadowCard }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
        <Dot color={SM.warn} />
        <strong>待批准计划</strong>
        <span style={{ marginLeft: 'auto', color: SM.fg3, fontFamily: SM.fontMono }}>
          {'kind' in plan ? 'PROFILE RELEASE' : plan.action === 'install' ? 'INSTALL' : 'UPDATE'}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '72px minmax(0,1fr)', gap: '5px 8px', color: SM.fg2 }}>
        <span>设备</span><span style={{ fontFamily: SM.fontMono }}>{plan.deviceId}</span>
        {'kind' in plan ? <>
          <span>Release</span><span style={{ fontFamily: SM.fontMono }}>{plan.releaseId}@{plan.releaseVersion}</span>
          <span>插件</span><span style={{ fontFamily: SM.fontMono }}>{plan.plugins.length} 个，{plan.changes.length} 项变更</span>
          <span>原子性</span><span>整组 stage → rename → health → rollback</span>
        </> : <>
          <span>插件</span><span style={{ fontFamily: SM.fontMono }}>{plan.pluginId}</span>
          <span>目标</span><span title={plan.exactToSpec} style={{ overflowWrap: 'anywhere', fontFamily: SM.fontMono }}>{plan.exactToSpec}</span>
        </>}
        <span>计划</span><span title={plan.planId} style={{ fontFamily: SM.fontMono }}>{plan.digest.slice(0, 12)}</span>
        <span>过期</span><span style={{ fontFamily: SM.fontMono, fontVariantNumeric: 'tabular-nums' }}>{formatCheckedAt(plan.expiresAt)}</span>
      </div>
      {'kind' in plan && plan.changes.map(change => <div key={change.pluginId} style={{ marginTop: 5, color: SM.fg3, fontFamily: SM.fontMono, fontSize: 10.5 }}>
        {change.action.toUpperCase()} · {change.pluginId} · {change.visibility}
      </div>)}
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 10, color: SM.fg2, cursor: 'pointer' }}>
        <input type="checkbox" checked={armed} onChange={event => onArm(event.currentTarget.checked)} />
        <span>我确认由 {plan.deviceId} 执行这一{'kind' in plan ? '完整 Profile Release' : '精确插件计划'}；失败时自动回滚。</span>
      </label>
      <button type="button" disabled={!armed || loading} onClick={onApprove} style={{
        width: '100%', minHeight: 32, marginTop: 10, border: 0, borderRadius: 10,
        background: armed && !loading ? SM.bad : SM.fg4, color: SM.panel,
        cursor: armed && !loading ? 'pointer' : 'default', fontFamily: SM.fontSans, fontWeight: 600,
      }}>{loading ? '执行中…' : '批准并执行一次'}</button>
    </div>}
    {action !== null && <div style={{ marginBottom: 10, padding: 10, borderRadius: 10, background: action.state === 'succeeded' ? SM.goodSoft : SM.badSoft, color: actionColor(action.state) }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}><Dot color={actionColor(action.state)} /><strong>{actionLabel(action.state)}</strong></div>
      <div style={{ marginTop: 4, fontFamily: SM.fontMono, fontVariantNumeric: 'tabular-nums' }}>
        {'releaseId' in action ? `${action.releaseId}@${action.releaseVersion}` : action.pluginId} · {action.updatedAt.slice(0, 19).replace('T', ' ')}
      </div>
    </div>}
    <button type="button" onClick={onReload} disabled={loading} style={{
      width: '100%', minHeight: 30, border: `1px solid ${SM.borderStrong}`, borderRadius: 10,
      background: SM.panel, color: SM.fg2, cursor: loading ? 'default' : 'pointer', fontFamily: SM.fontSans,
    }}>刷新目标状态</button>
  </div>
}

function TasksView({
  targets,
  targetDeviceId,
  workspaceId,
  profile,
  prompt,
  reply,
  loading,
  error,
  onTarget,
  onWorkspace,
  onProfile,
  onPrompt,
  onSubmit,
  onStatus,
  onCancel,
}: {
  targets: AgentTargetsView | null
  targetDeviceId: string
  workspaceId: string
  profile: string
  prompt: string
  reply: FleetTaskReply | null
  loading: boolean
  error: string | null
  onTarget(value: string): void
  onWorkspace(value: string): void
  onProfile(value: string): void
  onPrompt(value: string): void
  onSubmit(): void
  onStatus(): void
  onCancel(): void
}): React.ReactElement {
  const taskTargets = (targets?.targets ?? []).flatMap(target => {
    const inspection = target.inspection
    return target.online && inspection !== undefined && 'kind' in inspection && inspection.kind === 'profile-release' && inspection.tasks.enabled
      ? [{ deviceId: target.deviceId, tasks: inspection.tasks }]
      : []
  })
  const selected = taskTargets.find(target => target.deviceId === targetDeviceId)
  const state = reply?.response.payload.state
  const terminal = state === 'succeeded' || state === 'failed' || state === 'cancelled'
  return <div style={{ padding: '0 12px 12px' }}>
    <div style={{ marginBottom: 10, padding: '9px 10px', borderRadius: 10, background: SM.panelSoft, color: SM.fg2, lineHeight: 1.55 }}>
      任务通过设备签名的 A2A 消息提交。目标机只接受下方列出的 workspace/profile ID；没有任意 shell、argv 或路径入口。
    </div>
    {error !== null && <div style={{ marginBottom: 10, padding: '9px 10px', borderRadius: 10, background: SM.badSoft, color: SM.bad, fontFamily: SM.fontMono }}>{error}</div>}
    {targets === null && error === null && <div style={{ padding: 12, color: SM.fg3 }}>载入任务策略…</div>}
    {targets !== null && taskTargets.length === 0 && <div style={{ padding: 12, borderRadius: 10, background: SM.panel, color: SM.fg3 }}>没有启用 A2A 任务策略的在线设备</div>}
    {taskTargets.length > 0 && <div style={{ padding: 11, borderRadius: 12, background: SM.panel }}>
      <label style={{ display: 'grid', gap: 5, marginBottom: 9, color: SM.fg2 }}>
        <span>目标设备</span>
        <select value={targetDeviceId} onChange={event => onTarget(event.currentTarget.value)} style={{ minHeight: 34, border: `1px solid ${SM.borderStrong}`, borderRadius: 9, background: SM.panel, color: SM.fg }}>
          {taskTargets.map(target => <option key={target.deviceId} value={target.deviceId}>{target.deviceId}</option>)}
        </select>
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <label style={{ display: 'grid', gap: 5, color: SM.fg2 }}>
          <span>Workspace ID</span>
          <select value={workspaceId} onChange={event => onWorkspace(event.currentTarget.value)} style={{ minHeight: 34, border: `1px solid ${SM.borderStrong}`, borderRadius: 9, background: SM.panel, color: SM.fg }}>
            {(selected?.tasks.workspaceIds ?? []).map(id => <option key={id} value={id}>{id}</option>)}
          </select>
        </label>
        <label style={{ display: 'grid', gap: 5, color: SM.fg2 }}>
          <span>Profile</span>
          <select value={profile} onChange={event => onProfile(event.currentTarget.value)} style={{ minHeight: 34, border: `1px solid ${SM.borderStrong}`, borderRadius: 9, background: SM.panel, color: SM.fg }}>
            {(selected?.tasks.profiles ?? []).map(id => <option key={id} value={id}>{id}</option>)}
          </select>
        </label>
      </div>
      <label style={{ display: 'grid', gap: 5, marginTop: 9, color: SM.fg2 }}>
        <span>任务</span>
        <textarea value={prompt} onChange={event => onPrompt(event.currentTarget.value)} rows={5} maxLength={32 * 1024} placeholder="描述要由目标 DSH 完成的任务" style={{ resize: 'vertical', padding: 9, border: `1px solid ${SM.borderStrong}`, borderRadius: 9, background: SM.panel, color: SM.fg, fontFamily: SM.fontSans }} />
      </label>
      <button type="button" disabled={loading || prompt.trim().length === 0 || workspaceId === '' || profile === ''} onClick={onSubmit} style={{
        width: '100%', minHeight: 34, marginTop: 10, border: 0, borderRadius: 10,
        background: loading || prompt.trim().length === 0 ? SM.fg4 : SM.info, color: SM.panel,
        cursor: loading ? 'default' : 'pointer', fontWeight: 600,
      }}>{loading ? '提交中…' : '签名并提交任务'}</button>
    </div>}
    {reply !== null && <div style={{ marginTop: 10, padding: 11, borderRadius: 12, background: SM.panel }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <Dot color={state === 'succeeded' ? SM.good : state === 'failed' || state === 'cancelled' ? SM.bad : SM.warn} />
        <strong style={{ flex: 1 }}>{state}</strong>
        <span style={{ color: SM.fg3, fontFamily: SM.fontMono }}>{reply.taskId.slice(5, 13)}</span>
      </div>
      {reply.response.payload.result !== undefined && reply.response.payload.result !== null && <pre style={{ margin: '9px 0 0', padding: 9, maxHeight: 260, overflow: 'auto', whiteSpace: 'pre-wrap', borderRadius: 9, background: SM.panelSoft, color: SM.fg, fontFamily: SM.fontMono }}>
        {reply.response.payload.result}{reply.response.payload.truncated ? '\n…结果已截断；完整结果保留在目标设备。' : ''}
      </pre>}
      {reply.response.payload.errorCode !== undefined && reply.response.payload.errorCode !== null && <div style={{ marginTop: 7, color: SM.bad, fontFamily: SM.fontMono }}>{reply.response.payload.errorCode}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 9 }}>
        <button type="button" disabled={loading} onClick={onStatus} style={{ flex: 1, minHeight: 30, border: `1px solid ${SM.borderStrong}`, borderRadius: 9, background: SM.panel, color: SM.fg2 }}>刷新状态</button>
        {!terminal && <button type="button" disabled={loading} onClick={onCancel} style={{ flex: 1, minHeight: 30, border: 0, borderRadius: 9, background: SM.badSoft, color: SM.bad }}>请求取消</button>}
      </div>
    </div>}
  </div>
}

export function FleetSettings({ ctx }: { ctx: ClientContextLike }): React.ReactElement {
  const [tab, setTab] = useState<'status' | 'updates' | 'operations' | 'tasks'>('status')
  const [status, setStatus] = useState<FleetStatus | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [statusLoading, setStatusLoading] = useState(false)
  const [updates, setUpdates] = useState<FleetUpdates | null>(null)
  const [updateError, setUpdateError] = useState<string | null>(null)
  const [updateLoading, setUpdateLoading] = useState(false)
  const [agentTargets, setAgentTargets] = useState<AgentTargetsView | null>(null)
  const [agentPlan, setAgentPlan] = useState<FleetPlan | FleetReleasePlan | null>(null)
  const [agentAction, setAgentAction] = useState<AgentActionRecord | ReleaseActionRecord | null>(null)
  const [agentError, setAgentError] = useState<string | null>(null)
  const [agentLoading, setAgentLoading] = useState(false)
  const [approvalArmed, setApprovalArmed] = useState(false)
  const [taskTarget, setTaskTarget] = useState('')
  const [taskWorkspace, setTaskWorkspace] = useState('')
  const [taskProfile, setTaskProfile] = useState('')
  const [taskPrompt, setTaskPrompt] = useState('')
  const [taskReply, setTaskReply] = useState<FleetTaskReply | null>(null)
  const [taskError, setTaskError] = useState<string | null>(null)
  const [taskLoading, setTaskLoading] = useState(false)
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

  const requestPlan = useCallback(async (deviceId: string, pluginId?: string) => {
    if (agentMutationInFlight.current) return
    agentMutationInFlight.current = true
    setAgentLoading(true)
    setAgentPlan(null)
    setAgentAction(null)
    setApprovalArmed(false)
    try {
      const releaseMode = pluginId === undefined
      const result = await ctx.connection.rpc.call(
        AGENT_CHANNEL,
        releaseMode ? 'release-plan' : 'plan',
        releaseMode ? { deviceId } : { deviceId, pluginId },
      )
      setAgentPlan(releaseMode
        ? rpcValue(result, isFleetReleasePlan, 'fleet release plan unavailable')
        : rpcValue(result, isFleetPlan, 'fleet plan unavailable'))
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
    const releaseMode = 'kind' in approvedPlan
    setAgentLoading(true)
    setApprovalArmed(false)
    try {
      const result = await ctx.connection.rpc.call(AGENT_CHANNEL, releaseMode ? 'release-approve' : 'approve', {
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
        const status = await ctx.connection.rpc.call(AGENT_CHANNEL, releaseMode ? 'release-action-status' : 'action-status', {
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

  const taskCall = useCallback(async (endpoint: 'task-submit' | 'task-status' | 'task-cancel') => {
    if (taskLoading || taskTarget === '') return
    setTaskLoading(true)
    try {
      const payload = endpoint === 'task-submit'
        ? { targetDeviceId: taskTarget, workspaceId: taskWorkspace, profile: taskProfile, prompt: taskPrompt.trim() }
        : { targetDeviceId: taskTarget, taskId: taskReply?.taskId }
      const result = await ctx.connection.rpc.call(AGENT_CHANNEL, endpoint, payload)
      setTaskReply(rpcValue(result, isFleetTaskReply, 'fleet task response unavailable'))
      setTaskError(null)
    } catch (cause: unknown) {
      setTaskError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setTaskLoading(false)
    }
  }, [ctx, taskLoading, taskProfile, taskPrompt, taskReply?.taskId, taskTarget, taskWorkspace])

  useEffect(() => {
    void loadStatus()
    const timer = window.setInterval(() => { if (!document.hidden) void loadStatus() }, 30_000)
    return () => window.clearInterval(timer)
  }, [loadStatus])

  useEffect(() => {
    if (tab !== 'updates' || updates !== null || updateError !== null || updateLoading) return
    void loadUpdates('if-stale')
  }, [loadUpdates, tab, updateError, updateLoading, updates])

  useEffect(() => {
    if ((tab !== 'operations' && tab !== 'tasks') || agentTargets !== null || agentError !== null || agentLoading) return
    void loadAgentTargets()
  }, [agentError, agentLoading, agentTargets, loadAgentTargets, tab])

  useEffect(() => {
    if (agentTargets === null) return
    const available = agentTargets.targets.flatMap(target => {
      const inspection = target.inspection
      return target.online && inspection !== undefined && 'kind' in inspection && inspection.kind === 'profile-release' && inspection.tasks.enabled
        ? [{ deviceId: target.deviceId, tasks: inspection.tasks }]
        : []
    })
    const selected = available.find(target => target.deviceId === taskTarget) ?? available[0]
    if (selected === undefined) return
    if (taskTarget !== selected.deviceId) setTaskTarget(selected.deviceId)
    if (!selected.tasks.workspaceIds.includes(taskWorkspace)) setTaskWorkspace(selected.tasks.workspaceIds[0] ?? '')
    if (!selected.tasks.profiles.includes(taskProfile)) setTaskProfile(selected.tasks.profiles[0] ?? '')
  }, [agentTargets, taskProfile, taskTarget, taskWorkspace])

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
  return <section aria-label="DSH Fleet" data-dsh-fleet-settings style={{
    width: '100%', height: '100%', maxWidth: 960, minWidth: 0, minHeight: 0,
    display: 'flex', boxSizing: 'border-box', overflow: 'hidden', fontFamily: SM.fontSans,
    fontSize: 12, color: SM.fg, border: `1px solid ${SM.border}`, borderRadius: 18, background: SM.bg,
  }}>
      <div data-dsh-fleet-panel style={{
      width: '100%', height: '100%', minWidth: 0, minHeight: 0, display: 'flex',
      flexDirection: 'column', overflow: 'hidden', background: SM.bg,
    }}>
      <div style={{ padding: '14px 16px 11px', background: SM.panel, borderBottom: `1px solid ${SM.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ display: 'grid', placeItems: 'center', color: SM.fg2 }}><FleetIcon /></span>
          <Dot color={tone} size={8} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <strong style={{ display: 'block', fontSize: 15 }}>DSH Fleet</strong>
            <span style={{ color: SM.fg3 }}>设备、Profile Release 与远程执行</span>
          </div>
          <button type="button" aria-label="刷新状态" title="刷新状态" onClick={() => void loadStatus()} disabled={statusLoading} style={{
            width: 30, height: 30, display: 'grid', placeItems: 'center', border: 0, borderRadius: 10,
            background: SM.panelSoft, color: statusLoading ? SM.fg3 : SM.fg2, cursor: statusLoading ? 'default' : 'pointer',
          }}><RefreshIcon /></button>
        </div>
        <div role="tablist" aria-label="Fleet 视图" style={{ display: 'flex', gap: 4, marginTop: 9, padding: 3, borderRadius: 999, background: SM.bg2 }}>
          {(['status', 'updates', 'operations', 'tasks'] as const).map(key => <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)} style={{
            flex: 1, minHeight: 28, border: 0, borderRadius: 999, background: tab === key ? SM.fg : 'transparent',
            color: tab === key ? SM.panel : SM.fg2, cursor: 'pointer', fontFamily: SM.fontSans, fontSize: 11.5,
          }}>{key === 'status' ? '状态' : key === 'updates' ? `更新${availableUpdates > 0 ? ` ${availableUpdates}` : ''}` : key === 'operations' ? '发布' : '任务'}</button>)}
        </div>
      </div>
      <div data-dsh-fleet-scroll style={{
        flex: 1, minHeight: 0, paddingTop: 10, overflowY: 'auto', overscrollBehavior: 'contain', background: SM.bg,
      }}>
        {tab === 'status'
          ? <StatusView status={status} error={statusError} />
          : tab === 'updates'
            ? <UpdatesView updates={updates} loading={updateLoading} error={updateError} onRefresh={() => void loadUpdates('force')} />
            : tab === 'operations' ? <OperationsView
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
              />
              : <TasksView
                  targets={agentTargets}
                  targetDeviceId={taskTarget}
                  workspaceId={taskWorkspace}
                  profile={taskProfile}
                  prompt={taskPrompt}
                  reply={taskReply}
                  loading={taskLoading}
                  error={taskError ?? agentError}
                  onTarget={value => { setTaskTarget(value); setTaskReply(null) }}
                  onWorkspace={setTaskWorkspace}
                  onProfile={setTaskProfile}
                  onPrompt={setTaskPrompt}
                  onSubmit={() => void taskCall('task-submit')}
                  onStatus={() => void taskCall('task-status')}
                  onCancel={() => void taskCall('task-cancel')}
                />}
      </div>
    </div>
  </section>
}

export function FleetCard({ ctx }: { ctx: ClientContextLike; wide?: boolean }): React.ReactElement {
  return <FleetSettings ctx={ctx} />
}

export function apply(ctx: ClientContextLike): void {
  ctx.slots.inject('settings.section', () => ctx.slots.register(
    { name: 'settings.section', id: 'dsh-fleet', order: 65, label: 'Fleet' },
    () => <FleetSettings ctx={ctx} />,
  ))
}

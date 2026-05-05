import { useEffect, useRef, useMemo, type CSSProperties } from 'react'
import type { QuestPlanRow } from '@/views/utils/todo'
import { useQuestPlan } from '@/views/hooks/useQuestPlan'

interface ProgressPanelProps {
  questId: string
}

type ProgressSurface = 'detail' | 'rail' | 'inline'

// ─── Colors ────────────────────────────────────────────────────────────────────

function resolveIndicatorColor(state: QuestPlanRow['state']): string {
  if (state === 'done') return 'var(--progress-done, #22c55e)'
  if (state === 'doing') return 'var(--progress-doing, #3b82f6)'
  if (state === 'waiting') return 'var(--progress-waiting, #f59e0b)'
  if (state === 'cancelled') return 'var(--progress-cancelled, #9ca3af)'
  return 'var(--progress-pending, #d1d5db)'
}

function resolveSummaryColor(summary: { waiting: number; doing: number; done: number; total: number }): string {
  if (summary.waiting > 0) return '#f59e0b'
  if (summary.doing > 0) return '#3b82f6'
  if (summary.total > 0 && summary.done === summary.total) return '#22c55e'
  return '#9ca3af'
}

function stateLabel(state: QuestPlanRow['state']): string {
  if (state === 'doing') return '进行中'
  if (state === 'waiting') return '等待中'
  if (state === 'done') return '已完成'
  if (state === 'cancelled') return '已取消'
  return '待开始'
}

// ─── Spinner ────────────────────────────────────────────────────────────────────

function Spinner({ size = 11 }: { size?: number }) {
  return (
    <span
      className="pluse-progress-spinner"
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  )
}

// ─── Status indicator icon ─────────────────────────────────────────────────────

function StatusIcon({ row }: { row: QuestPlanRow }) {
  const color = resolveIndicatorColor(row.state)
  if (row.state === 'doing') return <Spinner size={11} />
  if (row.state === 'done') {
    return (
      <svg className="pluse-progress-icon" width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
        <circle cx="6.5" cy="6.5" r="6" fill={color} />
        <path d="M4 6.5l2 2 3.5-3.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (row.state === 'waiting') {
    return (
      <svg className="pluse-progress-icon" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <circle cx="6" cy="6" r="4.8" stroke={color} strokeWidth="1.4" />
        <circle cx="6" cy="6" r="1.6" fill={color} />
      </svg>
    )
  }
  if (row.state === 'cancelled') {
    return (
      <svg className="pluse-progress-icon" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <circle cx="6" cy="6" r="5" stroke={color} strokeWidth="1.2" />
        <path d="M3.5 6h5" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    )
  }
  return (
    <svg className="pluse-progress-icon" width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
      <circle cx="5.5" cy="5.5" r="5" stroke={color} strokeWidth="1.2" />
    </svg>
  )
}

// ─── Single plan item ──────────────────────────────────────────────────────────

function canToggleRow(row: QuestPlanRow): boolean {
  return row.createdBy === 'human' || row.state === 'waiting'
}

function QuestPlanItem({
  row,
  index,
  total,
  onToggle,
}: {
  row: QuestPlanRow
  index: number
  total: number
  onToggle?: (row: QuestPlanRow) => void
}) {
  const isDone = row.state === 'done'
  const isCancelled = row.state === 'cancelled'
  const isDoing = row.state === 'doing'
  const isPending = row.state === 'pending'
  const isWaiting = row.state === 'waiting'
  const toggleable = Boolean(onToggle) && canToggleRow(row)
  const helperText = row.helperText?.trim()
  const isLast = index === total - 1

  // Text color
  const textColor = isDone || isCancelled
    ? 'var(--text-muted)'
    : isDoing
      ? 'var(--text)'
      : isWaiting
        ? 'var(--warning)'
        : isPending
          ? 'var(--text-secondary)'
          : 'var(--text-secondary)'

  const indicatorColor = resolveIndicatorColor(row.state)

  const itemStyle: CSSProperties = {
    animationDelay: `${index * 48}ms`,
    opacity: isCancelled ? 0.45 : 1,
  }

  const indicator = (
    <span
      className="pluse-progress-indicator-wrap"
      style={{ color: indicatorColor }}
      aria-hidden="true"
    >
      {isDoing ? (
        // Glow ring behind spinner for "doing" state
        <span className="pluse-progress-doing-ring" />
      ) : null}
      <StatusIcon row={row} />
      {/* Vertical connector line */}
      {!isLast ? (
        <span
          className={`pluse-progress-track${isDone ? ' is-done' : ''}`}
          aria-hidden="true"
        />
      ) : null}
    </span>
  )

  const indicatorNode = toggleable ? (
    <button
      type="button"
      className="pluse-progress-indicator-btn"
      onClick={() => onToggle?.(row)}
      aria-label={isDone ? '恢复计划项' : '完成计划项'}
      title={isDone ? '恢复计划项' : '完成计划项'}
    >
      {indicator}
    </button>
  ) : (
    <span className="pluse-progress-indicator-btn" aria-hidden="true">
      {indicator}
    </span>
  )

  return (
    <div
      className={`pluse-progress-item${isDoing ? ' is-doing' : ''}${isDone ? ' is-done' : ''}${isCancelled ? ' is-cancelled' : ''}${isWaiting ? ' is-waiting' : ''}`}
      style={itemStyle}
    >
      {indicatorNode}
      <div className="pluse-progress-item-body">
        <div
          className="pluse-progress-item-title"
          style={{
            color: textColor,
            fontWeight: isDoing ? 600 : 400,
            textDecoration: isCancelled ? 'line-through' : 'none',
          }}
        >
          {row.displayText}
        </div>
        {helperText ? (
          <div
            className="pluse-progress-item-helper"
            style={{ color: isWaiting ? 'var(--warning)' : 'var(--text-muted)' }}
          >
            {helperText}
          </div>
        ) : null}
        <div className="pluse-progress-item-meta">
          <span
            className="pluse-progress-state-badge"
            style={{
              color: isDoing
                ? '#3b82f6'
                : isWaiting
                  ? 'var(--warning)'
                  : isDone
                    ? '#22c55e'
                    : 'var(--text-muted)',
            }}
          >
            {stateLabel(row.state)}
          </span>
          <span className="pluse-progress-meta-dot" aria-hidden="true">·</span>
          <span className="pluse-progress-meta-source">
            {row.createdBy === 'human' ? 'Human' : row.createdBy === 'ai' ? 'AI' : 'System'}
          </span>
        </div>
      </div>
    </div>
  )
}

// ─── Sequence ─────────────────────────────────────────────────────────────────

function QuestPlanSequence({
  rows,
  onToggle,
}: {
  rows: QuestPlanRow[]
  onToggle?: (row: QuestPlanRow) => void
}) {
  return (
    <div className="pluse-progress-sequence">
      {rows.map((row, index) => (
        <QuestPlanItem
          key={row.id}
          row={row}
          index={index}
          total={rows.length}
          onToggle={onToggle}
        />
      ))}
    </div>
  )
}

// ─── Summary bar ──────────────────────────────────────────────────────────────

function ProgressSummaryBar({
  summary,
}: {
  summary: { pending: number; doing: number; done: number; waiting: number; total: number }
}) {
  if (summary.total === 0) return null
  const pct = Math.round((summary.done / summary.total) * 100)

  return (
    <div className="pluse-progress-summary-bar">
      <div className="pluse-progress-bar-track">
        <div
          className="pluse-progress-bar-fill"
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
      <span className="pluse-progress-bar-label">{pct}%</span>
    </div>
  )
}

// ─── Rail surface ──────────────────────────────────────────────────────────────

function QuestPlanSurface({
  questId,
  surface,
}: {
  questId: string
  surface: ProgressSurface
}) {
  const { rows, summary, loading, error, setTodoDone } = useQuestPlan(questId)
  const scrollRef = useRef<HTMLDivElement>(null)
  const hasScrolledRef = useRef(false)

  // 首次加载完成后滚到底部（显示最新步骤）
  useEffect(() => {
    if (loading || rows.length === 0) return
    if (hasScrolledRef.current) return
    hasScrolledRef.current = true
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [loading, rows.length])

  // questId 切换时重置，确保切换会话后重新滚到底
  useEffect(() => {
    hasScrolledRef.current = false
  }, [questId])

  const summaryText = useMemo(() => {
    const parts: string[] = []
    if (summary.done > 0) parts.push(`${summary.done} 已完成`)
    if (summary.doing > 0) parts.push(`${summary.doing} 进行中`)
    if (summary.waiting > 0) parts.push(`${summary.waiting} 等待中`)
    if (summary.pending > 0) parts.push(`${summary.pending} 待开始`)
    return parts.length > 0 ? parts.join(' · ') : '暂无条目'
  }, [summary])

  const accentColor = resolveSummaryColor(summary)

  const handleToggle = async (row: QuestPlanRow) => {
    await setTodoDone(row.id, row.state !== 'done')
  }

  if (loading) {
    return (
      <div className="pluse-progress-surface-shell">
        <div className="pluse-progress-loading">
          <Spinner size={12} />
          <span>加载中…</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="pluse-progress-surface-shell">
        <div className="pluse-progress-error">
          <span>{error}</span>
        </div>
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="pluse-progress-surface-shell">
        <div className="pluse-progress-empty">
          <p>
            {surface === 'rail'
              ? '进入会话后，计划流会自动出现在这里。'
              : 'AI 执行时，当前会话的计划流会自动出现在这里。'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="pluse-progress-surface-shell">
      {/* Header */}
      <div className="pluse-progress-rail-head">
        <span className="pluse-progress-rail-dot" style={{ background: accentColor }} />
        <div className="pluse-progress-rail-head-copy">
          <strong>当前会话计划</strong>
          <span>{summaryText}</span>
        </div>
        <span className="pluse-progress-rail-count">{summary.total}</span>
      </div>

      {/* Progress bar */}
      <ProgressSummaryBar summary={summary} />

      {/* Items */}
      <div className="pluse-progress-list-scroll" ref={scrollRef}>
        <QuestPlanSequence rows={rows} onToggle={handleToggle} />
      </div>
    </div>
  )
}

// ─── Exports ───────────────────────────────────────────────────────────────────

export function ProgressRailPanel({ questId }: ProgressPanelProps) {
  return <QuestPlanSurface questId={questId} surface="rail" />
}

export function ProgressPanel({ questId }: ProgressPanelProps) {
  return <QuestPlanSurface questId={questId} surface="detail" />
}

// ─── Inline card (kept for API compat but returns null) ───────────────────────
// Inline card was removed from ChatView; this stub prevents import errors elsewhere.
export function ProgressInlineCard(_props: ProgressPanelProps) {
  return null
}

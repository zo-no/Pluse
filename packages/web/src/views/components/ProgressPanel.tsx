import { useEffect, useRef, useMemo, useState, type CSSProperties } from 'react'
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

function QuestPlanItem({
  row,
  index,
  total,
  visualDone,
  onVisualToggle,
}: {
  row: QuestPlanRow
  index: number
  total: number
  visualDone?: boolean
  onVisualToggle?: (id: string) => void
}) {
  // 纯视觉覆盖：waiting/human 条目可被用户点击标记为视觉完成
  const isVisuallyDone = visualDone ?? false
  const canVisualToggle = (row.state === 'waiting' || row.createdBy === 'human') && Boolean(onVisualToggle)

  const isDone = row.state === 'done' || isVisuallyDone
  const isCancelled = row.state === 'cancelled'
  const isDoing = !isVisuallyDone && row.state === 'doing'
  const isPending = !isVisuallyDone && row.state === 'pending'
  const isWaiting = !isVisuallyDone && row.state === 'waiting'
  const toggleable = canVisualToggle
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
      <span className="pluse-progress-indicator-core">
        {isDoing ? (
          // Glow ring behind spinner for "doing" state
          <span className="pluse-progress-doing-ring" />
        ) : null}
        <StatusIcon row={row} />
      </span>
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
      onClick={() => onVisualToggle?.(row.id)}
      aria-label={isVisuallyDone ? '恢复' : '标记完成'}
      title={isVisuallyDone ? '恢复' : '标记完成'}
    >
      {indicator}
    </button>
  ) : (
    <span className="pluse-progress-indicator-btn" aria-hidden="true">
      {indicator}
    </span>
  )

  const isHuman = row.createdBy === 'human'

  return (
    <div
      className={`pluse-progress-item${isDoing ? ' is-doing' : ''}${isDone ? ' is-done' : ''}${isCancelled ? ' is-cancelled' : ''}${isWaiting ? ' is-waiting' : ''}${isHuman ? ' is-human' : ''}`}
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
      </div>
    </div>
  )
}

// ─── Sequence ─────────────────────────────────────────────────────────────────

function QuestPlanSequence({
  rows,
  visualDoneSet,
  onVisualToggle,
}: {
  rows: QuestPlanRow[]
  visualDoneSet: Set<string>
  onVisualToggle: (id: string) => void
}) {
  return (
    <div className="pluse-progress-sequence">
      {rows.map((row, index) => (
        <QuestPlanItem
          key={row.id}
          row={row}
          index={index}
          total={rows.length}
          visualDone={visualDoneSet.has(row.id)}
          onVisualToggle={onVisualToggle}
        />
      ))}
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
  const { rows, summary, loading, error } = useQuestPlan(questId)
  // 纯视觉完成状态，不写后端
  const [visualDoneSet, setVisualDoneSet] = useState<Set<string>>(new Set())

  const handleVisualToggle = (id: string) => {
    setVisualDoneSet(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const scrollRef = useRef<HTMLDivElement>(null)
  const prevRowsLengthRef = useRef(0)

  // 每次条目数量增加时，滚到底部（显示最新步骤）
  useEffect(() => {
    if (loading || rows.length === 0) return
    if (rows.length <= prevRowsLengthRef.current) return
    prevRowsLengthRef.current = rows.length
    // 等待进入动画完成后再滚动（动画时长 280ms + buffer）
    const timer = setTimeout(() => {
      const el = scrollRef.current
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    }, 320)
    return () => clearTimeout(timer)
  }, [loading, rows.length])

  // questId 切换时重置计数，确保切换会话后重新滚到底
  useEffect(() => {
    prevRowsLengthRef.current = 0
  }, [questId])

  const summaryText = useMemo(() => {
    const parts: string[] = []
    if (summary.doing > 0) parts.push(`${summary.doing} 项进行中`)
    if (summary.waiting > 0) parts.push(`${summary.waiting} 项等待中`)
    if (summary.pending > 0) parts.push(`${summary.pending} 项待开始`)
    if (summary.cancelled > 0) parts.push(`${summary.cancelled} 项已取消`)
    if (parts.length > 0) return parts.join(' · ')
    if (summary.total > 0) return '全部完成'
    return '暂无条目'
  }, [summary])

  const accentColor = resolveSummaryColor(summary)

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
        <span className="pluse-progress-rail-title">计划</span>
        <span className="pluse-progress-rail-summary">{summaryText}</span>
        <span className="pluse-progress-rail-count">{summary.total}</span>
      </div>

      {/* Items */}
      <div className="pluse-progress-list-scroll" ref={scrollRef}>
        <QuestPlanSequence rows={rows} visualDoneSet={visualDoneSet} onVisualToggle={handleVisualToggle} />
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

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { SseMessage, Todo } from '@pluse/types'
import * as api from '@/api/client'
import { useSseEvent } from '@/views/hooks/useSseEvent'

interface ProgressPanelProps {
  questId: string
}

// ── 旋转动画：doing spinner ───────────────────────────────────────────────
function Spinner() {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 10,
        height: 10,
        border: '1.5px solid currentColor',
        borderTopColor: 'transparent',
        borderRadius: '50%',
        animation: 'pluse-spin 0.7s linear infinite',
        flexShrink: 0,
      }}
    />
  )
}

// ── 单条 AI Progress 条目 ─────────────────────────────────────────────────
function AiProgressItem({ item }: { item: Todo }) {
  const isDone = item.status === 'done'
  const isRunning = item.status === 'doing'
  const isCancelled = item.status === 'cancelled'
  const label = isRunning && item.activeForm ? item.activeForm : item.title

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        padding: '5px 0',
        opacity: isCancelled ? 0.4 : 1,
      }}
    >
      {/* 状态指示器 */}
      <div
        style={{
          width: 14,
          height: 14,
          flexShrink: 0,
          marginTop: 2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: isDone ? '#22c55e' : isRunning ? '#3b82f6' : '#9ca3af',
        }}
      >
        {isRunning ? (
          <Spinner />
        ) : isDone ? (
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <circle cx="6.5" cy="6.5" r="6" fill="#22c55e" />
            <path d="M4 6.5l2 2 3.5-3.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
            <circle cx="5.5" cy="5.5" r="5" stroke="#d1d5db" strokeWidth="1.2" />
          </svg>
        )}
      </div>

      {/* 文本 */}
      <span
        style={{
          fontSize: 12.5,
          lineHeight: '19px',
          color: isDone
            ? '#9ca3af'
            : isRunning
              ? '#111827'
              : '#374151',
          fontWeight: isRunning ? 500 : 400,
          textDecoration: isCancelled ? 'line-through' : 'none',
          flex: 1,
          minWidth: 0,
          wordBreak: 'break-word',
        }}
      >
        {label}
      </span>
    </div>
  )
}

// ── 单条人工/等待 Todo 条目 ────────────────────────────────────────────────
function HumanTodoItem({
  item,
  onToggle,
}: {
  item: Todo
  onToggle: (id: string, done: boolean) => void
}) {
  const isDone = item.status === 'done'
  const isWaiting = Boolean(item.waitingInstructions) && !isDone

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        padding: '4px 6px',
        marginLeft: -6,
        marginRight: -6,
        borderRadius: 6,
        background: isWaiting ? 'rgba(251, 191, 36, 0.08)' : 'transparent',
      }}
    >
      {/* 复选框 */}
      <button
        type="button"
        onClick={() => onToggle(item.id, !isDone)}
        title={isDone ? '点击取消完成' : '点击标记完成'}
        style={{
          width: 13,
          height: 13,
          borderRadius: 3,
          border: isDone
            ? '1.5px solid #22c55e'
            : isWaiting
              ? '1.5px solid #f59e0b'
              : '1.5px solid #d1d5db',
          background: isDone ? '#22c55e' : 'transparent',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          marginTop: 3,
          padding: 0,
          outline: 'none',
          transition: 'border-color 0.15s, background 0.15s',
        }}
      >
        {isDone && (
          <svg width="8" height="8" viewBox="0 0 9 9" fill="none">
            <path d="M1.5 4.5l2 2 3.5-3.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>

      <div style={{ flex: 1, minWidth: 0 }}>
        {/* 标题 */}
        <div
          style={{
            fontSize: 12,
            lineHeight: '18px',
            color: isDone
              ? '#9ca3af'
              : isWaiting
                ? '#92400e'
                : '#374151',
            textDecoration: isDone ? 'line-through' : 'none',
            wordBreak: 'break-word',
          }}
        >
          {item.title}
        </div>

        {/* 等待说明 */}
        {isWaiting && (
          <div
            style={{
              fontSize: 11,
              lineHeight: '15px',
              color: '#b45309',
              marginTop: 2,
            }}
          >
            {item.waitingInstructions}
          </div>
        )}
      </div>

      {/* AI 标记 */}
      {item.createdBy === 'ai' && isWaiting && (
        <span
          style={{
            fontSize: 10,
            color: '#f59e0b',
            fontWeight: 600,
            flexShrink: 0,
            marginTop: 2,
            letterSpacing: '0.02em',
          }}
        >
          AI
        </span>
      )}
    </div>
  )
}

// ── 可折叠 Progress 卡片（嵌入到聊天区域，.coworker 风格）──────────────────
export function ProgressInlineCard({ questId }: ProgressPanelProps) {
  const [items, setItems] = useState<Todo[]>([])
  const [loading, setLoading] = useState(true)
  const [collapsed, setCollapsed] = useState(true)

  const fetchProgress = useCallback(async () => {
    const result = await api.getQuestProgress(questId)
    if (result.ok) setItems(result.data)
    setLoading(false)
  }, [questId])

  useEffect(() => {
    setLoading(true)
    void fetchProgress()
  }, [fetchProgress])

  // useSseEvent uses useEffectEvent internally — no need for useCallback wrapper
  useSseEvent((event: SseMessage) => {
    if ((event.type === 'todo_updated' || event.type === 'todo_deleted')
      && (event.data as { originQuestId?: string }).originQuestId === questId) {
      void fetchProgress()
    }
  })

  const handleToggle = useCallback(
    async (id: string, done: boolean) => {
      await api.updateTodo(id, { status: done ? 'done' : 'pending' })
      void fetchProgress()
    },
    [fetchProgress],
  )

  // 分组
  const aiItems = items.filter((t) => t.createdBy !== 'human')
  const humanItems = items.filter((t) => t.createdBy === 'human')
  const waitingItems = aiItems.filter((t) => t.waitingInstructions && t.status !== 'done')
  const pureAiItems = aiItems.filter((t) => !t.waitingInstructions || t.status === 'done')

  const hasAi = pureAiItems.length > 0
  const hasHuman = humanItems.length > 0 || waitingItems.length > 0
  const isEmpty = items.length === 0

  const hasRunning = pureAiItems.some((t) => t.status === 'doing')
  const hasWaiting = waitingItems.length > 0

  if (loading || isEmpty) return null

  const runningCount = pureAiItems.filter((t) => t.status === 'doing').length
  const doneCount = pureAiItems.filter((t) => t.status === 'done').length
  const totalCount = items.length
  const pendingHuman = [...waitingItems, ...humanItems.filter(t => t.status !== 'done')].length

  // 状态点颜色：进行中=蓝，等待=橙，全完成=绿
  const dotColor = hasWaiting ? '#f59e0b' : hasRunning ? '#3b82f6' : '#22c55e'

  // 摘要文字精确对照 .coworker：「Todos · 2 items · 1 done」格式
  const summaryParts: string[] = [`${totalCount} 条`]
  if (doneCount > 0) summaryParts.push(`${doneCount} 已完成`)
  if (runningCount > 0) summaryParts.push(`${runningCount} 进行中`)
  if (pendingHuman > 0) summaryParts.push(`${pendingHuman} 待处理`)
  const summary = summaryParts.join(' · ')

  return (
    <div className="pluse-inline-todo-bar">
      {/* 折叠触发行 */}
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="pluse-inline-todo-trigger"
      >
        {/* 状态点 */}
        <span
          className="pluse-inline-todo-dot"
          style={{
            background: dotColor,
            boxShadow: hasRunning ? `0 0 0 3px ${dotColor}30` : 'none',
          }}
        />
        {/* 标题 */}
        <span className="pluse-inline-todo-label">
          {hasWaiting ? '等待处理' : 'Todos'}
        </span>
        {/* 摘要（灰色，中点分隔） */}
        <span className="pluse-inline-todo-summary">· {summary}</span>
        {/* 箭头 */}
        <span
          className="pluse-inline-todo-chevron"
          style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}
        >
          ›
        </span>
      </button>

      {/* 展开内容区 */}
      {!collapsed && (
        <div className="pluse-inline-todo-body">
          {hasAi && (
            <div style={{ marginBottom: hasHuman ? 4 : 0 }}>
              {pureAiItems.map((item) => (
                <AiProgressItem key={item.id} item={item} />
              ))}
            </div>
          )}
          {hasHuman && (
            <div>
              {hasAi && <div className="pluse-inline-todo-divider" />}
              {waitingItems.map((item) => (
                <HumanTodoItem key={item.id} item={item} onToggle={handleToggle} />
              ))}
              {humanItems.map((item) => (
                <HumanTodoItem key={item.id} item={item} onToggle={handleToggle} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── 任务详情页使用的展开 Progress 面板 ─────────────────────────────────────
export function ProgressPanel({ questId }: ProgressPanelProps) {
  const [items, setItems] = useState<Todo[]>([])
  const [loading, setLoading] = useState(true)

  const fetchProgress = useCallback(async () => {
    const result = await api.getQuestProgress(questId)
    if (result.ok) setItems(result.data)
    setLoading(false)
  }, [questId])

  useEffect(() => {
    setLoading(true)
    void fetchProgress()
  }, [fetchProgress])

  // useSseEvent uses useEffectEvent internally — no need for useCallback wrapper
  useSseEvent((event: SseMessage) => {
    if ((event.type === 'todo_updated' || event.type === 'todo_deleted')
      && (event.data as { originQuestId?: string }).originQuestId === questId) {
      void fetchProgress()
    }
  })

  const handleToggle = useCallback(
    async (id: string, done: boolean) => {
      await api.updateTodo(id, { status: done ? 'done' : 'pending' })
      void fetchProgress()
    },
    [fetchProgress],
  )

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <PanelHeader />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: 12, color: '#9ca3af' }}>加载中…</span>
        </div>
      </div>
    )
  }

  const aiItems = items.filter((t) => t.createdBy !== 'human')
  const humanItems = items.filter((t) => t.createdBy === 'human')
  const waitingItems = aiItems.filter((t) => t.waitingInstructions && t.status !== 'done')
  const pureAiItems = aiItems.filter((t) => !t.waitingInstructions || t.status === 'done')

  const hasAi = pureAiItems.length > 0
  const hasHuman = humanItems.length > 0 || waitingItems.length > 0
  const isEmpty = items.length === 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <PanelHeader />
      {isEmpty ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 16px' }}>
          <p style={{ fontSize: 12, color: '#9ca3af', textAlign: 'center', lineHeight: '18px' }}>
            AI 执行任务时<br />进度将自动出现在这里
          </p>
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px 12px' }}>
          {hasAi && (
            <>
              <SectionLabel>执行进度</SectionLabel>
              <div>
                {pureAiItems.map((item) => (
                  <AiProgressItem key={item.id} item={item} />
                ))}
              </div>
            </>
          )}
          {hasHuman && (
            <>
              <SectionLabel>待处理</SectionLabel>
              <div>
                {waitingItems.map((item) => (
                  <HumanTodoItem key={item.id} item={item} onToggle={handleToggle} />
                ))}
                {humanItems.map((item) => (
                  <HumanTodoItem key={item.id} item={item} onToggle={handleToggle} />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function PanelHeader() {
  return (
    <div
      style={{
        padding: '10px 12px',
        borderBottom: '1px solid #f3f4f6',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#3b82f6', flexShrink: 0 }} />
      <h3 style={{ margin: 0, fontSize: 12, fontWeight: 600, color: '#374151', letterSpacing: '0.01em' }}>
        Progress
      </h3>
    </div>
  )
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '8px 0 4px' }}>
      <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#9ca3af' }}>
        {children}
      </span>
      <div style={{ flex: 1, height: 1, background: '#f3f4f6' }} />
    </div>
  )
}
import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { RuntimeModelCatalog, RuntimeTool, Run, Session, SessionEvent, UpdateSessionInput } from '@melody-sync/types'
import * as api from '@/api/client'
import { SendIcon } from './icons'

interface ChatViewProps {
  sessionId: string
  onSessionLoaded?: (session: Session) => void
}

function formatTime(value: number): string {
  const date = new Date(value < 1_000_000_000_000 ? value * 1000 : value)
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(date)
}

function formatRunState(value: string): string {
  if (value === 'running') return '运行中'
  if (value === 'completed') return '已完成'
  if (value === 'failed') return '失败'
  if (value === 'cancelled') return '已取消'
  if (value === 'accepted') return '已排队'
  return value
}

function ToolUseCard({ event }: { event: SessionEvent }) {
  const raw = event.content ?? event.toolInput ?? ''
  let toolName = '工具调用'
  let inputPreview = raw

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (parsed.name && typeof parsed.name === 'string') toolName = parsed.name
    if (parsed.input) inputPreview = JSON.stringify(parsed.input, null, 2)
  } catch {
    // raw content, use as-is
  }

  return (
    <details className="pulse-event-card pulse-tool-card">
      <summary>
        <span className="pulse-tool-label">
          <span className="pulse-tool-icon">⚙</span>
          {toolName}
        </span>
        <span className="pulse-event-time">{formatTime(event.timestamp)}</span>
      </summary>
      <pre>{inputPreview}</pre>
    </details>
  )
}

function ToolResultCard({ event }: { event: SessionEvent }) {
  const raw = event.content ?? event.output ?? event.bodyPreview ?? ''
  let isError = false
  let content = raw

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (parsed.type === 'tool_result') {
      isError = parsed.is_error === true
      if (Array.isArray(parsed.content)) {
        content = (parsed.content as Array<{ text?: string }>).map((c) => c.text ?? '').join('\n')
      }
    }
  } catch {
    // raw content
  }

  return (
    <details className={`pulse-event-card pulse-tool-result-card${isError ? ' is-error' : ''}`}>
      <summary>
        <span className="pulse-tool-label">
          <span className="pulse-tool-icon">{isError ? '✗' : '✓'}</span>
          工具结果
        </span>
        <span className="pulse-event-time">{formatTime(event.timestamp)}</span>
      </summary>
      <pre>{content}</pre>
    </details>
  )
}

function ReasoningCard({ event }: { event: SessionEvent }) {
  const raw = event.content ?? event.bodyPreview ?? ''
  return (
    <details className="pulse-event-card pulse-reasoning-card">
      <summary>
        <span className="pulse-tool-label">
          <span className="pulse-tool-icon">💭</span>
          思考过程
        </span>
        <span className="pulse-event-time">{formatTime(event.timestamp)}</span>
      </summary>
      <pre>{raw}</pre>
    </details>
  )
}

function EventCard({ event }: { event: SessionEvent }) {
  if (event.type === 'message') {
    if (event.role === 'user') {
      return (
        <div className="pulse-message-row is-user">
          <div className="pulse-message-stack">
            <div className="pulse-user-bubble">{event.content}</div>
            <span className="pulse-message-time">{formatTime(event.timestamp)}</span>
          </div>
        </div>
      )
    }

    return (
      <div className="pulse-message-row is-assistant">
        <div className="pulse-assistant-copy pulse-markdown">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{event.content ?? ''}</ReactMarkdown>
        </div>
        <span className="pulse-message-time">{formatTime(event.timestamp)}</span>
      </div>
    )
  }

  if (event.type === 'tool_use') return <ToolUseCard event={event} />
  if (event.type === 'tool_result') return <ToolResultCard event={event} />
  if (event.type === 'reasoning') return <ReasoningCard event={event} />

  const label = event.type === 'status'
    ? '状态'
    : event.type === 'file_change'
      ? '文件变更'
      : event.type === 'usage'
        ? '用量'
        : '事件'

  return (
    <details className="pulse-event-card">
      <summary>
        <span>{label}</span>
        <span className="pulse-event-time">{formatTime(event.timestamp)}</span>
      </summary>
      <pre>{event.content ?? event.output ?? event.toolInput ?? event.bodyPreview ?? ''}</pre>
    </details>
  )
}

export function ChatView({ sessionId, onSessionLoaded }: ChatViewProps) {
  const [session, setSession] = useState<Session | null>(null)
  const [events, setEvents] = useState<SessionEvent[]>([])
  const [runs, setRuns] = useState<Run[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [runtimeTools, setRuntimeTools] = useState<RuntimeTool[]>([])
  const [catalog, setCatalog] = useState<RuntimeModelCatalog | null>(null)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  async function refreshSession() {
    const result = await api.getSession(sessionId)
    if (!result.ok) return
    setSession(result.data)
    onSessionLoaded?.(result.data)
  }

  async function refreshThread() {
    const [eventsResult, runsResult] = await Promise.all([
      api.getSessionEvents(sessionId),
      api.getSessionRuns(sessionId),
    ])
    if (eventsResult.ok) setEvents(eventsResult.data.items)
    if (runsResult.ok) setRuns(runsResult.data)
  }

  useEffect(() => {
    void refreshSession()
  }, [sessionId, onSessionLoaded])

  useEffect(() => {
    void refreshThread()
  }, [sessionId])

  useEffect(() => {
    void api.getRuntimeTools().then((result) => {
      if (result.ok) setRuntimeTools(result.data)
    })
  }, [])

  useEffect(() => {
    if (!session?.tool) return
    void api.getRuntimeModelCatalog(session.tool).then((result) => {
      if (result.ok) setCatalog(result.data)
    })
  }, [session?.tool])

  useEffect(() => {
    const es = new EventSource(`/api/events?sessionId=${sessionId}`)
    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data as string) as { type: string }
        if (event.type === 'session_updated') {
          void refreshSession()
          void refreshThread()
        }
      } catch {}
    }
    return () => es.close()
  }, [sessionId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [events])

  const effortOptions = useMemo(() => {
    if (!catalog || catalog.reasoning.kind !== 'enum') return []
    return catalog.effortLevels ?? []
  }, [catalog])

  const latestRun = runs[0] ?? null

  async function patchSession(patch: UpdateSessionInput) {
    const result = await api.updateSession(sessionId, patch)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setSession(result.data)
    onSessionLoaded?.(result.data)
  }

  async function handleSend() {
    if (!draft.trim() || sending || !session) return
    setSending(true)
    setError(null)
    const result = await api.sendMessage(sessionId, {
      text: draft.trim(),
      tool: session.tool,
      model: session.model ?? null,
      effort: session.effort ?? null,
      thinking: session.thinking,
    })
    setSending(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setDraft('')
    setSession(result.data.session)
    onSessionLoaded?.(result.data.session)
    await refreshThread()
  }

  async function handleCancel() {
    if (!session?.activeRunId || cancelling) return
    setCancelling(true)
    setError(null)
    const result = await api.cancelRun(session.activeRunId)
    setCancelling(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    await refreshSession()
    await refreshThread()
  }

  if (!session) {
    return <div className="pulse-page pulse-page-loading">正在加载会话…</div>
  }

  return (
    <div className="pulse-page pulse-session-page">
      <div className="pulse-chat-shell">

        <div className="pulse-thread">
          <div className="pulse-thread-inner">
            {events.length === 0 ? (
              <div className="pulse-empty-state pulse-chat-empty">
                <h2>开始当前任务</h2>
                <p>Pulse 会沿着这个项目的上下文继续。</p>
              </div>
            ) : null}
            {events.map((event) => <EventCard key={event.seq} event={event} />)}
            <div ref={bottomRef} />
          </div>
        </div>

        <footer className="pulse-composer">
          <div className="pulse-composer-toolbar">
            <div className="pulse-inline-status">
              {session.activeRunId ? <span>当前有运行中的回合</span> : <span>Cmd / Ctrl + Enter</span>}
              {latestRun ? <span>最近一次运行：{formatRunState(latestRun.state)}</span> : null}
            </div>
          </div>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault()
                void handleSend()
              }
            }}
            placeholder="给当前会话发送消息…"
            rows={4}
          />
          <div className="pulse-composer-actions">
            <div className="pulse-runtime-controls pulse-runtime-controls-inline">
              <select value={session.tool ?? 'codex'} onChange={(event) => void patchSession({ tool: event.target.value })}>
                {runtimeTools.map((tool) => (
                  <option key={tool.id} value={tool.id}>{tool.name}</option>
                ))}
              </select>
              <select value={session.model ?? ''} onChange={(event) => void patchSession({ model: event.target.value || null })}>
                <option value="">默认模型</option>
                {catalog?.models.map((model) => (
                  <option key={model.id} value={model.id}>{model.label}</option>
                ))}
              </select>
              {!!effortOptions.length && (
                <select value={session.effort ?? ''} onChange={(event) => void patchSession({ effort: event.target.value || null })}>
                  <option value="">默认推理强度</option>
                  {effortOptions.map((effort) => (
                    <option key={effort} value={effort}>{effort}</option>
                  ))}
                </select>
              )}
            </div>
            <div className="pulse-composer-send-group">
              {session.activeRunId ? (
                <button
                  type="button"
                  className="pulse-button pulse-button-danger"
                  onClick={() => void handleCancel()}
                  disabled={cancelling}
                  aria-label={cancelling ? '取消中' : '停止'}
                  title={cancelling ? '取消中' : '停止'}
                >
                  {cancelling ? '…' : '■'}
                </button>
              ) : null}
              <button
                type="button"
                className="pulse-icon-button pulse-send-btn"
                onClick={() => void handleSend()}
                disabled={sending || !!session.activeRunId}
                aria-label={sending ? '发送中' : '发送'}
                title="发送 (Cmd+Enter)"
              >
                <SendIcon className="pulse-icon" />
              </button>
            </div>
          </div>
          {error ? <p className="pulse-error">{error}</p> : null}
        </footer>
      </div>
    </div>
  )
}

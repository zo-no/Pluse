import { useEffect, useMemo, useRef, useState } from 'react'
import type { RuntimeModelCatalog, RuntimeTool, Run, Session, SessionEvent, UpdateSessionInput } from '@melody-sync/types'
import * as api from '@/api/client'

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
        <div className="pulse-assistant-copy">{event.content}</div>
        <span className="pulse-message-time">{formatTime(event.timestamp)}</span>
      </div>
    )
  }

  const label = event.type === 'tool_use'
    ? '工具调用'
    : event.type === 'tool_result'
      ? '工具结果'
      : event.type === 'reasoning'
        ? '推理'
        : event.type === 'status'
          ? '状态'
          : '事件'

  return (
    <details className="pulse-event-card">
      <summary>{label}</summary>
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
    if (!session?.activeRunId) return
    const timer = window.setInterval(() => {
      void refreshSession()
      void refreshThread()
    }, 900)
    return () => window.clearInterval(timer)
  }, [session?.activeRunId, sessionId])

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

  if (!session) {
    return <div className="pulse-page pulse-page-loading">正在加载会话…</div>
  }

  return (
      <div className="pulse-page pulse-session-page">
      <div className="pulse-chat-shell">
        <header className="pulse-chat-head">
          <div className="pulse-chat-heading">
            <span className="pulse-section-kicker">会话</span>
            <h1>{session.name}</h1>
            <div className="pulse-chat-meta">
              <span className="pulse-inline-pill">{session.tool ?? 'codex'}</span>
              {session.model ? <span className="pulse-inline-pill">{session.model}</span> : null}
              {session.effort ? <span className="pulse-inline-pill">{session.effort}</span> : null}
              {latestRun ? (
                <span className={`pulse-inline-pill${latestRun.state === 'running' ? ' is-running' : ''}`}>
                  {formatRunState(latestRun.state)}
                </span>
              ) : null}
            </div>
          </div>
        </header>

        <div className="pulse-thread">
          <div className="pulse-thread-inner">
            {events.length === 0 ? (
              <div className="pulse-empty-state pulse-chat-empty">
                <h2>还没有消息</h2>
                <p>先发出第一条指令，当前会话会沿着这个项目的上下文继续工作。</p>
              </div>
            ) : null}
            {events.map((event) => <EventCard key={event.seq} event={event} />)}
            <div ref={bottomRef} />
          </div>
        </div>

        <footer className="pulse-composer">
          <div className="pulse-composer-toolbar">
            <span className="pulse-composer-kicker">发送给当前会话</span>
            <div className="pulse-inline-status">
              {session.activeRunId ? <span>当前有运行中的回合。</span> : <span>Ctrl / Cmd + Enter 发送</span>}
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
            <button type="button" className="pulse-button" onClick={() => void handleSend()} disabled={sending}>
              {sending ? '发送中…' : '发送'}
            </button>
          </div>
          {error ? <p className="pulse-error">{error}</p> : null}
        </footer>
      </div>
    </div>
  )
}

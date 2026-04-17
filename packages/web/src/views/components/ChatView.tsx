import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { MessageAttachment, RuntimeModelCatalog, RuntimeTool, Run, Session, SessionEvent, UpdateSessionInput } from '@pluse/types'
import * as api from '@/api/client'
import type { UploadedAsset } from '@/api/client'
import { AttachIcon, SendIcon } from './icons'

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
    <details className="pluse-event-card pluse-tool-card">
      <summary>
        <span className="pluse-tool-label">
          <span className="pluse-tool-icon">⚙</span>
          {toolName}
        </span>
        <span className="pluse-event-time">{formatTime(event.timestamp)}</span>
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
    <details className={`pluse-event-card pluse-tool-result-card${isError ? ' is-error' : ''}`}>
      <summary>
        <span className="pluse-tool-label">
          <span className="pluse-tool-icon">{isError ? '✗' : '✓'}</span>
          工具结果
        </span>
        <span className="pluse-event-time">{formatTime(event.timestamp)}</span>
      </summary>
      <pre>{content}</pre>
    </details>
  )
}

function ReasoningCard({ event }: { event: SessionEvent }) {
  const raw = event.content ?? event.bodyPreview ?? ''
  return (
    <details className="pluse-event-card pluse-reasoning-card">
      <summary>
        <span className="pluse-tool-label">
          <span className="pluse-tool-icon">💭</span>
          思考过程
        </span>
        <span className="pluse-event-time">{formatTime(event.timestamp)}</span>
      </summary>
      <pre>{raw}</pre>
    </details>
  )
}

function EventCard({ event }: { event: SessionEvent }) {
  if (event.type === 'message') {
    if (event.role === 'user') {
      return (
        <div className="pluse-message-row is-user">
          <div className="pluse-message-stack">
            <div className="pluse-user-bubble">{event.content}</div>
            <span className="pluse-message-time">{formatTime(event.timestamp)}</span>
          </div>
        </div>
      )
    }

    return (
      <div className="pluse-message-row is-assistant">
        <div className="pluse-assistant-copy pluse-markdown">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{event.content ?? ''}</ReactMarkdown>
        </div>
        <span className="pluse-message-time">{formatTime(event.timestamp)}</span>
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
    <details className="pluse-event-card">
      <summary>
        <span>{label}</span>
        <span className="pluse-event-time">{formatTime(event.timestamp)}</span>
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
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [previewUrls, setPreviewUrls] = useState<(string | null)[]>([])
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const MAX_ATTACHMENTS = 4
  const MAX_FILE_SIZE = 20 * 1024 * 1024

  function addFiles(files: File[]) {
    const oversized = files.find((f) => f.size > MAX_FILE_SIZE)
    if (oversized) { setUploadError(`文件 ${oversized.name} 超过 20MB 限制`); return }
    setPendingFiles((prev) => {
      const merged = [...prev, ...files].slice(0, MAX_ATTACHMENTS)
      if (prev.length + files.length > MAX_ATTACHMENTS) setUploadError(`最多附加 ${MAX_ATTACHMENTS} 个文件`)
      // build preview URLs for new files
      const newUrls = files.slice(0, MAX_ATTACHMENTS - prev.length).map((f) =>
        f.type.startsWith('image/') ? URL.createObjectURL(f) : null
      )
      setPreviewUrls((prevUrls) => [...prevUrls, ...newUrls].slice(0, MAX_ATTACHMENTS))
      return merged
    })
    setUploadError(null)
  }

  function removeFile(index: number) {
    setPreviewUrls((prev) => {
      const url = prev[index]
      if (url) URL.revokeObjectURL(url)
      return prev.filter((_, i) => i !== index)
    })
    setPendingFiles((prev) => prev.filter((_, i) => i !== index))
  }

  // release all ObjectURLs when files are cleared after send
  function clearPendingFiles() {
    previewUrls.forEach((url) => { if (url) URL.revokeObjectURL(url) })
    setPendingFiles([])
    setPreviewUrls([])
  }

  function getFileTypeLabel(file: File): string {
    const ext = file.name.lastIndexOf('.') >= 0
      ? file.name.slice(file.name.lastIndexOf('.') + 1).toUpperCase().slice(0, 8)
      : ''
    if (ext) return ext
    if (file.type.startsWith('image/')) return 'IMAGE'
    if (file.type.startsWith('video/')) return 'VIDEO'
    if (file.type.startsWith('audio/')) return 'AUDIO'
    return 'FILE'
  }

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
    if (!error) return
    const t = setTimeout(() => setError(null), 4000)
    return () => clearTimeout(t)
  }, [error])

  useEffect(() => {
    if (!uploadError) return
    const t = setTimeout(() => setUploadError(null), 4000)
    return () => clearTimeout(t)
  }, [uploadError])

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
    if ((!draft.trim() && pendingFiles.length === 0) || sending || !session) return
    setSending(true)
    setError(null)
    setUploadError(null)

    // Upload pending files first
    let attachments: MessageAttachment[] = []
    if (pendingFiles.length > 0) {
      const results = await Promise.all(pendingFiles.map((f) => api.uploadAsset(sessionId, f)))
      const failed = results.find((r) => !r.ok)
      if (failed && !failed.ok) {
        setSending(false)
        setUploadError(failed.error)
        return
      }
      attachments = (results as Array<{ ok: true; data: UploadedAsset }>).map((r) => ({
        assetId: r.data.id,
        filename: r.data.filename,
        savedPath: r.data.savedPath,
        mimeType: r.data.mimeType,
      }))
    }

    const result = await api.sendMessage(sessionId, {
      text: draft.trim() || '请查看附件',
      tool: session.tool,
      model: session.model ?? null,
      effort: session.effort ?? null,
      thinking: session.thinking,
      attachments: attachments.length > 0 ? attachments : undefined,
    })
    setSending(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setDraft('')
    clearPendingFiles()
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
    return <div className="pluse-page pluse-page-loading">正在加载会话…</div>
  }

  return (
    <div className="pluse-page pluse-session-page">
      <div className="pluse-chat-shell">

        <div className="pluse-thread">
          <div className="pluse-thread-inner">
            {events.length === 0 ? (
              <div className="pluse-empty-state pluse-chat-empty">
                <h2>开始当前任务</h2>
                <p>Pulse 会沿着这个项目的上下文继续。</p>
              </div>
            ) : null}
            {events.map((event) => <EventCard key={event.seq} event={event} />)}
            <div ref={bottomRef} />
          </div>
        </div>

        <footer className="pluse-composer">
          <div className="pluse-composer-toolbar">
            <div className="pluse-inline-status">
              {session.activeRunId ? <span>当前有运行中的回合</span> : <span>Cmd / Ctrl + Enter</span>}
              {latestRun ? <span>最近一次运行：{formatRunState(latestRun.state)}</span> : null}
            </div>
          </div>
          {pendingFiles.length > 0 && (
            <div className="pluse-attachment-strip">
              {pendingFiles.map((file, i) => {
                const url = previewUrls[i]
                const isImage = file.type.startsWith('image/')
                return (
                  <div key={i} className="pluse-attachment-item">
                    {isImage && url ? (
                      <img src={url} alt={file.name} className="pluse-attachment-thumb" />
                    ) : (
                      <div className="pluse-attachment-file-chip">
                        <span className="pluse-attachment-file-name">{file.name}</span>
                        <span className="pluse-attachment-file-type">{getFileTypeLabel(file)}</span>
                      </div>
                    )}
                    <button
                      type="button"
                      className="pluse-attachment-remove-btn"
                      onClick={() => removeFile(i)}
                      aria-label="移除"
                    >×</button>
                  </div>
                )
              })}
            </div>
          )}
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault()
                void handleSend()
              }
            }}
            onPaste={(event) => {
              // Use items API for better compatibility (supports screenshots)
              const items = event.clipboardData?.items
              if (!items) return
              const files: File[] = []
              for (const item of Array.from(items)) {
                const file = typeof item.getAsFile === 'function' ? item.getAsFile() : null
                if (file) files.push(file)
              }
              if (files.length > 0) {
                event.preventDefault()
                addFiles(files)
              }
            }}
            placeholder="给当前会话发送消息…"
            rows={4}
          />
          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => { if (e.target.files) addFiles(Array.from(e.target.files)); e.target.value = '' }}
          />
          <div className="pluse-composer-actions">
            <div className="pluse-runtime-controls pluse-runtime-controls-inline">
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
            <div className="pluse-composer-send-group">
              <button
                type="button"
                className="pluse-icon-button"
                onClick={() => fileInputRef.current?.click()}
                disabled={sending || !!session.activeRunId || pendingFiles.length >= MAX_ATTACHMENTS}
                aria-label="附加文件"
                title="附加文件"
              >
                <AttachIcon className="pluse-icon" />
              </button>
              {session.activeRunId ? (
                <button
                  type="button"
                  className="pluse-button pluse-button-danger"
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
                className="pluse-icon-button pluse-send-btn"
                onClick={() => void handleSend()}
                disabled={sending || !!session.activeRunId}
                aria-label={sending ? '发送中' : '发送'}
                title="发送 (Cmd+Enter)"
              >
                <SendIcon className="pluse-icon" />
              </button>
            </div>
          </div>
          {uploadError ? <p className="pluse-error">{uploadError}</p> : null}
          {error ? <p className="pluse-error">{error}</p> : null}
        </footer>
      </div>
    </div>
  )
}

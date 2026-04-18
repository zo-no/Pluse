import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { MessageAttachment, Quest, QuestEvent, Run, RuntimeModelCatalog, RuntimeTool, UpdateQuestInput } from '@pluse/types'
import * as api from '@/api/client'
import { displaySessionName } from '@/views/utils/display'
import { AttachIcon, ConvertIcon, SendIcon } from './icons'

const DRAWING_MODEL_KEYWORDS = ['image', 'dalle', 'flux', 'imagen', 'midjourney', 'stable', 'draw', 'painting']

const DRAWING_MARKDOWN_IMAGE_REGEX = /!\[[^\]]*\]\([^)]+\)|\bhttps?:\/\/[^\s]+\.(?:png|jpe?g|gif|webp|svg|bmp)\b/i
const DRAWING_TOOL_RESULT_IMAGE_REGEX = /\b\.(?:png|jpe?g|gif|webp|svg|bmp)\b/i

interface ChatViewProps {
  questId: string
  onQuestLoaded?: (quest: Quest) => void
  onDataChanged?: () => Promise<void> | void
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

function queuePreview(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  if (!compact) return '空白消息'
  return compact.length > 48 ? `${compact.slice(0, 45)}...` : compact
}

function isDrawingModel(model?: string): boolean {
  if (!model) return false
  const normalized = model.toLowerCase()
  return DRAWING_MODEL_KEYWORDS.some((keyword) => normalized.includes(keyword))
}

function isDrawingEvent(event?: QuestEvent): boolean {
  if (!event) return false
  const content = `${event.content ?? ''} ${event.output ?? ''} ${event.toolInput ?? ''} ${event.bodyPreview ?? ''}`
  if (DRAWING_MARKDOWN_IMAGE_REGEX.test(content)) return true
  if (event.type === 'tool_result' && DRAWING_TOOL_RESULT_IMAGE_REGEX.test(content)) return true
  if (event.type === 'status' && DRAWING_TOOL_RESULT_IMAGE_REGEX.test(content)) return true
  return false
}

const DRAFT_STORAGE_PREFIX = 'pluse:chat-draft:'

function draftStorageKey(questId: string): string {
  return `${DRAFT_STORAGE_PREFIX}${questId}`
}

function loadDraft(questId: string): string {
  if (typeof window === 'undefined') return ''
  try {
    return window.sessionStorage.getItem(draftStorageKey(questId)) ?? ''
  } catch {
    return ''
  }
}

function persistDraft(questId: string, value: string): void {
  if (typeof window === 'undefined') return
  try {
    if (value) window.sessionStorage.setItem(draftStorageKey(questId), value)
    else window.sessionStorage.removeItem(draftStorageKey(questId))
  } catch {
    // Ignore storage failures.
  }
}

function clearDraft(questId: string): void {
  persistDraft(questId, '')
}

function ToolUseCard({ event }: { event: QuestEvent }) {
  const raw = event.content ?? event.toolInput ?? ''
  let toolName = '工具调用'
  let inputPreview = raw

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (parsed.name && typeof parsed.name === 'string') toolName = parsed.name
    if (parsed.input) inputPreview = JSON.stringify(parsed.input, null, 2)
  } catch {
    // Keep raw preview.
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

function ToolResultCard({ event }: { event: QuestEvent }) {
  const raw = event.content ?? event.output ?? event.bodyPreview ?? ''
  let isError = false
  let content = raw

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (parsed.type === 'tool_result') {
      isError = parsed.is_error === true
      if (Array.isArray(parsed.content)) {
        content = (parsed.content as Array<{ text?: string }>).map((item) => item.text ?? '').join('\n')
      }
    }
  } catch {
    // Keep raw preview.
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

function ReasoningCard({ event }: { event: QuestEvent }) {
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

function StatusLine({ event }: { event: QuestEvent }) {
  const content = event.content ?? event.output ?? event.toolInput ?? event.bodyPreview ?? ''
  return (
    <div className="pluse-status-line">
      <span className="pluse-status-line-label">状态</span>
      <span className="pluse-status-line-content">{content}</span>
      <span className="pluse-event-time">{formatTime(event.timestamp)}</span>
    </div>
  )
}

function EventCard({ event }: { event: QuestEvent }) {
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
  if (event.type === 'status') return <StatusLine event={event} />

  const label = event.type === 'file_change'
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

export function ChatView({ questId, onQuestLoaded, onDataChanged }: ChatViewProps) {
  const [quest, setQuest] = useState<Quest | null>(null)
  const [events, setEvents] = useState<QuestEvent[]>([])
  const [runs, setRuns] = useState<Run[]>([])
  const [draft, setDraft] = useState(() => loadDraft(questId))
  const [inputHeight, setInputHeight] = useState<number | null>(null)
  const [hasManualInputResize, setHasManualInputResize] = useState(false)
  const [sending, setSending] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [runtimeTools, setRuntimeTools] = useState<RuntimeTool[]>([])
  const [catalog, setCatalog] = useState<RuntimeModelCatalog | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [previewUrls, setPreviewUrls] = useState<(string | null)[]>([])
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [removingRequestId, setRemovingRequestId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const reloadTimer = useRef<number | null>(null)

  const MAX_ATTACHMENTS = 4
  const MAX_FILE_SIZE = 20 * 1024 * 1024

  function getViewportHeight(): number {
    if (typeof window === 'undefined') return 0
    return Math.round(window.visualViewport?.height ?? window.innerHeight)
  }

  function getMobileInitialInputHeight(): number {
    const viewportHeight = getViewportHeight()
    return Math.max(120, Math.min(220, Math.round(viewportHeight * 0.2)))
  }

  function addFiles(files: File[]) {
    const oversized = files.find((file) => file.size > MAX_FILE_SIZE)
    if (oversized) {
      setUploadError(`文件 ${oversized.name} 超过 20MB 限制`)
      return
    }
    setPendingFiles((previous) => {
      const merged = [...previous, ...files].slice(0, MAX_ATTACHMENTS)
      if (previous.length + files.length > MAX_ATTACHMENTS) {
        setUploadError(`最多附加 ${MAX_ATTACHMENTS} 个文件`)
      }
      const newUrls = files
        .slice(0, MAX_ATTACHMENTS - previous.length)
        .map((file) => file.type.startsWith('image/') ? URL.createObjectURL(file) : null)
      setPreviewUrls((previousUrls) => [...previousUrls, ...newUrls].slice(0, MAX_ATTACHMENTS))
      return merged
    })
    setUploadError(null)
  }

  function removeFile(index: number) {
    setPreviewUrls((previous) => {
      const url = previous[index]
      if (url) URL.revokeObjectURL(url)
      return previous.filter((_, itemIndex) => itemIndex !== index)
    })
    setPendingFiles((previous) => previous.filter((_, itemIndex) => itemIndex !== index))
  }

  function clearPendingFiles() {
    previewUrls.forEach((url) => {
      if (url) URL.revokeObjectURL(url)
    })
    setPendingFiles([])
    setPreviewUrls([])
  }

  function getFileTypeLabel(file: File): string {
    const extension = file.name.lastIndexOf('.') >= 0
      ? file.name.slice(file.name.lastIndexOf('.') + 1).toUpperCase().slice(0, 8)
      : ''
    if (extension) return extension
    if (file.type.startsWith('image/')) return 'IMAGE'
    if (file.type.startsWith('video/')) return 'VIDEO'
    if (file.type.startsWith('audio/')) return 'AUDIO'
    return 'FILE'
  }

  async function refreshQuest() {
    const result = await api.getQuest(questId)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setQuest(result.data)
    onQuestLoaded?.(result.data)
  }

  async function refreshThread() {
    const [eventsResult, runsResult] = await Promise.all([
      api.getQuestEvents(questId),
      api.getQuestRuns(questId),
    ])
    if (eventsResult.ok) setEvents(eventsResult.data.items)
    if (runsResult.ok) setRuns(runsResult.data)
  }

  useEffect(() => {
    void refreshQuest()
    void refreshThread()
  }, [questId])

  useEffect(() => {
    setDraft(loadDraft(questId))
    setInputHeight(null)
    setHasManualInputResize(false)
  }, [questId])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.innerWidth > 860 || hasManualInputResize) return

    const syncInputHeight = () => {
      setInputHeight(getMobileInitialInputHeight())
    }

    syncInputHeight()
    window.addEventListener('resize', syncInputHeight)
    window.visualViewport?.addEventListener('resize', syncInputHeight)
    return () => {
      window.removeEventListener('resize', syncInputHeight)
      window.visualViewport?.removeEventListener('resize', syncInputHeight)
    }
  }, [hasManualInputResize, questId])

  useEffect(() => {
    persistDraft(questId, draft)
  }, [questId, draft])

  useEffect(() => {
    void api.getRuntimeTools().then((result) => {
      if (result.ok) setRuntimeTools(result.data)
    })
  }, [])

  useEffect(() => {
    if (!quest?.tool) return
    void api.getRuntimeModelCatalog(quest.tool).then((result) => {
      if (result.ok) setCatalog(result.data)
    })
  }, [quest?.tool])

  useEffect(() => {
    const source = new EventSource(`/api/events?questId=${encodeURIComponent(questId)}`)
    source.onmessage = () => {
      if (reloadTimer.current) window.clearTimeout(reloadTimer.current)
      reloadTimer.current = window.setTimeout(() => {
        void refreshQuest()
        void refreshThread()
        void onDataChanged?.()
      }, 200)
    }
    return () => {
      source.close()
      if (reloadTimer.current) window.clearTimeout(reloadTimer.current)
    }
  }, [questId, onDataChanged])

  useEffect(() => {
    if (!error) return
    const timeout = setTimeout(() => setError(null), 4000)
    return () => clearTimeout(timeout)
  }, [error])

  useEffect(() => {
    if (!uploadError) return
    const timeout = setTimeout(() => setUploadError(null), 4000)
    return () => clearTimeout(timeout)
  }, [uploadError])

  const isDrawingMode = useMemo(() => {
    if (isDrawingModel(quest?.model)) return true
    const latestEvent = events[events.length - 1]
    return isDrawingEvent(latestEvent)
  }, [quest?.model, events])

  useEffect(() => {
    if (!isDrawingMode) return
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [events, isDrawingMode])

  const effortOptions = useMemo(() => {
    if (!catalog || catalog.reasoning.kind !== 'enum') return []
    return catalog.effortLevels ?? []
  }, [catalog])

  const latestRun = runs[0] ?? null

  function handleResizeStart(event: ReactPointerEvent<HTMLButtonElement>) {
    const textarea = textareaRef.current
    if (!textarea) return
    event.preventDefault()
    const startY = event.clientY
    const startHeight = textarea.getBoundingClientRect().height

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const nextHeight = startHeight - (moveEvent.clientY - startY)
      const maxHeight = Math.max(160, Math.floor(getViewportHeight() * 0.45))
      setHasManualInputResize(true)
      setInputHeight(Math.min(maxHeight, Math.max(52, Math.round(nextHeight))))
    }

    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
  }

  async function patchQuest(patch: UpdateQuestInput) {
    const result = await api.updateQuest(questId, patch)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setQuest(result.data)
    onQuestLoaded?.(result.data)
    await onDataChanged?.()
  }

  async function handleSend() {
    if ((!draft.trim() && pendingFiles.length === 0) || sending || !quest) return
    setSending(true)
    setError(null)
    setUploadError(null)

    let attachments: MessageAttachment[] = []
    if (pendingFiles.length > 0) {
      const results = await Promise.all(pendingFiles.map((file) => api.uploadAsset(questId, file)))
      const failed = results.find((result) => !result.ok)
      if (failed && !failed.ok) {
        setSending(false)
        setUploadError(failed.error)
        return
      }
      attachments = results.map((result) => {
        if (!result.ok) throw new Error('unexpected upload failure')
        return {
          assetId: result.data.id,
          filename: result.data.filename,
          savedPath: result.data.savedPath,
          mimeType: result.data.mimeType,
        }
      })
    }

    const result = await api.sendQuestMessage(questId, {
      text: draft.trim() || '请查看附件',
      tool: quest.tool,
      model: quest.model ?? null,
      effort: quest.effort ?? null,
      thinking: quest.thinking,
      attachments: attachments.length > 0 ? attachments : undefined,
    })
    setSending(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setDraft('')
    clearDraft(questId)
    clearPendingFiles()
    if (result.data.quest) {
      setQuest(result.data.quest)
      onQuestLoaded?.(result.data.quest)
    }
    await refreshThread()
    await onDataChanged?.()
  }

  async function handleCancel() {
    if (!quest?.activeRunId || cancelling) return
    setCancelling(true)
    setError(null)
    const result = await api.cancelRun(quest.activeRunId)
    setCancelling(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    await refreshQuest()
    await refreshThread()
  }

  async function handleClearQueue() {
    const result = await api.clearQuestQueue(questId)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setQuest(result.data)
    onQuestLoaded?.(result.data)
    await onDataChanged?.()
  }

  async function handleRemoveQueuedRequest(requestId: string) {
    setRemovingRequestId(requestId)
    const result = await api.cancelQueuedRequest(questId, requestId)
    setRemovingRequestId(null)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setQuest(result.data)
    onQuestLoaded?.(result.data)
    await onDataChanged?.()
  }

  if (!quest) {
    return <div className="pluse-page pluse-page-loading">正在加载会话…</div>
  }

  return (
    <div className="pluse-page pluse-session-page">
      <div className="pluse-chat-shell">
        <div className="pluse-thread">
          <div className="pluse-thread-inner">
            {events.length === 0 ? (
              <div className="pluse-empty-state pluse-chat-empty">
                <h2>开始会话</h2>
              </div>
            ) : null}
            {events.map((event) => <EventCard key={event.seq} event={event} />)}
            <div ref={bottomRef} />
          </div>
        </div>

        <footer className="pluse-composer">
          <button
            type="button"
            className="pluse-composer-resize-handle"
            onPointerDown={handleResizeStart}
            aria-label="调整输入区高度"
            title="拖动调整输入区高度"
          >
            <span />
          </button>
          {quest.followUpQueue.length > 0 ? (
            <div
              className="pluse-event-card"
              style={{ display: 'grid', gap: 8, marginBottom: 12, padding: 12 }}
            >
              <div className="pluse-inline-status" style={{ justifyContent: 'space-between' }}>
                <span>排队中的消息</span>
                <span>{quest.followUpQueue.length}</span>
              </div>
              {quest.followUpQueue.map((item) => (
                <div
                  key={item.requestId}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 10,
                    padding: '8px 10px',
                    borderRadius: 12,
                    border: '1px solid rgba(148, 163, 184, 0.16)',
                    background: 'rgba(15, 23, 42, 0.04)',
                  }}
                >
                  <div style={{ minWidth: 0, display: 'grid', gap: 2 }}>
                    <strong style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {queuePreview(item.text)}
                    </strong>
                    <span className="pluse-message-time">{formatTime(Date.parse(item.queuedAt))}</span>
                  </div>
                  <button
                    type="button"
                    className="pluse-attachment-remove-btn"
                    onClick={() => void handleRemoveQueuedRequest(item.requestId)}
                    disabled={removingRequestId === item.requestId}
                    aria-label="移除排队消息"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <div className="pluse-composer-settings">
            <div className="pluse-composer-toolbar">
              <div className="pluse-composer-mainline">
                <div className="pluse-inline-status pluse-inline-status-compact">
                  {quest.activeRunId ? <span>运行中</span> : <span>Cmd / Ctrl + Enter</span>}
                  {latestRun ? <span>上次：{formatRunState(latestRun.state)}</span> : null}
                  {quest.followUpQueue.length > 0 ? <span>排队 {quest.followUpQueue.length}</span> : null}
                </div>
                <div className="pluse-runtime-controls pluse-runtime-controls-inline pluse-runtime-controls-composer-compact">
                  <select value={quest.tool ?? 'codex'} onChange={(event) => void patchQuest({ tool: event.target.value })}>
                    {runtimeTools.map((tool) => (
                      <option key={tool.id} value={tool.id}>{tool.name}</option>
                    ))}
                  </select>
                  <select value={quest.tool === 'claude' ? quest.model ?? 'sonnet' : quest.tool === 'codex' ? quest.model ?? '5.3-codex-spark' : quest.model ?? ''} onChange={(event) => void patchQuest({ model: event.target.value || null })}>
                    {catalog?.models.map((model) => (
                      <option key={model.id} value={model.id}>{model.label}</option>
                    ))}
                  </select>
                  {!!effortOptions.length ? (
                    <select value={quest.tool === 'codex' ? quest.effort ?? 'low' : quest.effort ?? ''} onChange={(event) => void patchQuest({ effort: event.target.value || null })}>
                      {effortOptions.map((effort) => (
                        <option key={effort} value={effort}>{effort}</option>
                      ))}
                    </select>
                  ) : null}
                </div>
                <div className="pluse-composer-quick-actions">
                  {quest.followUpQueue.length > 0 ? (
                    <button
                      type="button"
                      className="pluse-button pluse-button-ghost pluse-button-compact"
                      onClick={() => void handleClearQueue()}
                      title="清空排队消息"
                    >
                      清空队列
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="pluse-icon-button pluse-transfer-action"
                    title="转任务"
                    aria-label="转任务"
                    onClick={() => void patchQuest({ kind: 'task', title: displaySessionName(quest.name), status: 'pending' })}
                    disabled={Boolean(quest.activeRunId)}
                  >
                    <ConvertIcon className="pluse-icon" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {pendingFiles.length > 0 ? (
            <div className="pluse-attachment-strip">
              {pendingFiles.map((file, index) => {
                const previewUrl = previewUrls[index]
                const isImage = file.type.startsWith('image/')
                return (
                  <div key={`${file.name}:${index}`} className="pluse-attachment-item">
                    {isImage && previewUrl ? (
                      <img src={previewUrl} alt={file.name} className="pluse-attachment-thumb" />
                    ) : (
                      <div className="pluse-attachment-file-chip">
                        <span className="pluse-attachment-file-name">{file.name}</span>
                        <span className="pluse-attachment-file-type">{getFileTypeLabel(file)}</span>
                      </div>
                    )}
                    <button
                      type="button"
                      className="pluse-attachment-remove-btn"
                      onClick={() => removeFile(index)}
                      aria-label="移除"
                    >
                      ×
                    </button>
                  </div>
                )
              })}
            </div>
          ) : null}

          <div className="pluse-composer-input-shell">
            <textarea
              ref={textareaRef}
              value={draft}
              style={inputHeight ? { height: `${inputHeight}px` } : undefined}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault()
                  void handleSend()
                }
              }}
              onPaste={(event) => {
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
              rows={2}
            />
            <div className="pluse-composer-input-actions">
              <button
                type="button"
                className="pluse-icon-button"
                onClick={() => fileInputRef.current?.click()}
                disabled={sending || pendingFiles.length >= MAX_ATTACHMENTS}
                aria-label="附加文件"
                title="附加文件"
              >
                <AttachIcon className="pluse-icon" />
              </button>
              {quest.activeRunId ? (
                <button
                  type="button"
                  className="pluse-button pluse-button-danger"
                  onClick={() => void handleCancel()}
                  disabled={cancelling}
                >
                  <span className="pluse-label-desktop">{cancelling ? '取消中…' : '停止'}</span>
                  <span className="pluse-label-mobile" aria-hidden="true">⏹</span>
                </button>
              ) : null}
              <button
                type="button"
                className="pluse-icon-button pluse-send-btn"
                onClick={() => void handleSend()}
                disabled={sending}
                aria-label={sending ? '发送中' : '发送'}
                title="发送 (Cmd+Enter)"
              >
                <SendIcon className="pluse-icon" />
              </button>
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={(event) => {
              if (event.target.files) addFiles(Array.from(event.target.files))
              event.target.value = ''
            }}
          />

          <div className="pluse-composer-toolbar">
            <div className="pluse-inline-status">
              {uploadError ? <span>{uploadError}</span> : null}
              {error ? <span>{error}</span> : null}
            </div>
          </div>
        </footer>
      </div>
    </div>
  )
}

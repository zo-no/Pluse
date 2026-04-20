import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { MessageAttachment, Quest, QuestEvent, QueuedMessage, Run, RuntimeModelCatalog, RuntimeTool, UpdateQuestInput } from '@pluse/types'
import * as api from '@/api/client'
import { useI18n } from '@/i18n'
import { displaySessionName } from '@/views/utils/display'
import { buildFallbackRuntimeModelCatalog, defaultRuntimeEffortId, defaultRuntimeModelId, resolveRuntimeEffortSelection, resolveRuntimeModelSelection } from '@/views/utils/runtime'
import { parseSseMessage } from '@/views/utils/sse'
import { AttachIcon, ConvertIcon, SendIcon } from './icons'
import { TaskComposerModal } from './TaskComposerModal'

const DRAWING_MODEL_KEYWORDS = ['image', 'dalle', 'flux', 'imagen', 'midjourney', 'stable', 'draw', 'painting']

const DRAWING_MARKDOWN_IMAGE_REGEX = /!\[[^\]]*\]\([^)]+\)|\bhttps?:\/\/[^\s]+\.(?:png|jpe?g|gif|webp|svg|bmp)\b/i
const DRAWING_TOOL_RESULT_IMAGE_REGEX = /\b\.(?:png|jpe?g|gif|webp|svg|bmp)\b/i

interface ChatViewProps {
  questId: string
  onQuestLoaded?: (quest: Quest) => void
  onDataChanged?: () => Promise<void> | void
}

function formatTime(value: number, locale = 'zh-CN'): string {
  const date = new Date(value < 1_000_000_000_000 ? value * 1000 : value)
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(date)
}

function formatRelativeTime(value: number, t?: (key: string, values?: Record<string, string | number>) => string): string {
  const target = value < 1_000_000_000_000 ? value * 1000 : value
  const now = Date.now()
  const delta = Math.max(0, now - target)
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour

  if (delta < minute) return t ? t('刚刚') : '刚刚'
  if (delta < hour) return t ? t('{count} 分钟前', { count: Math.floor(delta / minute) }) : `${Math.floor(delta / minute)} 分钟前`
  if (delta < day) return t ? t('{count} 小时前', { count: Math.floor(delta / hour) }) : `${Math.floor(delta / hour)} 小时前`
  return t ? t('{count} 天前', { count: Math.floor(delta / day) }) : `${Math.floor(delta / day)} 天前`
}

function formatRunState(value: string, t?: (key: string) => string): string {
  if (value === 'running') return t ? t('运行中') : '运行中'
  if (value === 'completed') return t ? t('已完成') : '已完成'
  if (value === 'failed') return t ? t('失败') : '失败'
  if (value === 'cancelled') return t ? t('已取消') : '已取消'
  if (value === 'accepted') return t ? t('已排队') : '已排队'
  return value
}

function compactText(value: string, maxLength = 88): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized
}

function summarizeFailureReason(value?: string, t?: (key: string) => string): string {
  if (!value) return ''
  if (value.includes('failed to open state db') || value.includes('state runtime')) return t ? t('Codex 运行时状态库异常') : 'Codex 运行时状态库异常'
  if (value.includes('model is not supported')) return t ? t('当前 Codex 模型不可用') : '当前 Codex 模型不可用'
  const firstMeaningfulLine = value
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line && !/^\d{4}-\d{2}-\d{2}T/.test(line))
  return compactText((firstMeaningfulLine ?? value).replace(/^Error:\s*/, ''), 72)
}

function queuePreview(value: string, t?: (key: string) => string): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  if (!compact) return t ? t('空白消息') : '空白消息'
  return compact.length > 48 ? `${compact.slice(0, 45)}...` : compact
}

function queuedMessageText(item: QueuedMessage): string {
  return item.displayText ?? item.text
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

type MetaEventDisplay = {
  label: string
  icon: string
  content: string
  isError?: boolean
}

type ThreadSegment =
  | { kind: 'message'; key: string; event: QuestEvent }
  | { kind: 'meta'; key: string; events: QuestEvent[] }

function describeMetaEvent(event: QuestEvent, t?: (key: string) => string): MetaEventDisplay {
  if (event.type === 'tool_use') {
    const raw = event.content ?? event.toolInput ?? ''
    let toolName = t ? t('工具调用') : '工具调用'
    let inputPreview = raw
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      if (parsed.name && typeof parsed.name === 'string') toolName = parsed.name
      if (parsed.input) inputPreview = JSON.stringify(parsed.input, null, 2)
    } catch {
      // Keep raw preview.
    }
    return { label: t ? t('工具调用') : '工具调用', icon: '⚙', content: `${toolName}: ${inputPreview}` }
  }

  if (event.type === 'tool_result') {
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
    return { label: t ? t('工具结果') : '工具结果', icon: isError ? '✗' : '✓', content, isError }
  }

  if (event.type === 'reasoning') {
    return {
      label: t ? t('思考过程') : '思考过程',
      icon: '💭',
      content: event.content ?? event.bodyPreview ?? '',
    }
  }

  if (event.type === 'status') {
    const content = event.content ?? event.output ?? event.toolInput ?? event.bodyPreview ?? ''
    return {
      label: t ? t('状态') : '状态',
      icon: '·',
      content,
      isError: content.toLowerCase().startsWith('error:'),
    }
  }

  return {
    label: event.type === 'file_change'
      ? (t ? t('文件变更') : '文件变更')
      : event.type === 'usage'
        ? (t ? t('用量') : '用量')
        : (t ? t('事件') : '事件'),
    icon: '•',
    content: event.content ?? event.output ?? event.toolInput ?? event.bodyPreview ?? '',
  }
}

function buildThreadSegments(events: QuestEvent[]): ThreadSegment[] {
  const segments: ThreadSegment[] = []
  let pendingMeta: QuestEvent[] = []

  const flushMeta = () => {
    if (pendingMeta.length === 0) return
    segments.push({
      kind: 'meta',
      key: `meta:${pendingMeta[0]!.seq}`,
      events: pendingMeta,
    })
    pendingMeta = []
  }

  for (const event of events) {
    if (event.type === 'message') {
      flushMeta()
      segments.push({ kind: 'message', key: `message:${event.seq}`, event })
      continue
    }
    pendingMeta.push(event)
  }

  flushMeta()
  return segments
}

function MessageEventCard({
  event,
  locale,
  t,
}: {
  event: QuestEvent
  locale: string
  t: (key: string, values?: Record<string, string | number>) => string
}) {
  if (event.role === 'user') {
    return (
      <div className="pluse-message-row is-user">
        <div className="pluse-user-bubble-shell">
          <div className="pluse-user-bubble">{event.content}</div>
          <span className="pluse-message-time">{formatTime(event.timestamp, locale)}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="pluse-message-row is-assistant">
      <div className="pluse-message-head is-assistant">
        <span className="pluse-assistant-stamp" title={formatTime(event.timestamp, locale)}>{formatRelativeTime(event.timestamp, t)}</span>
      </div>
      <div className="pluse-assistant-copy pluse-markdown">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{event.content ?? ''}</ReactMarkdown>
      </div>
    </div>
  )
}

function MetaEventEntry({
  event,
  t,
}: {
  event: QuestEvent
  t: (key: string) => string
}) {
  const meta = describeMetaEvent(event, t)
  if (!meta.content) {
    return (
      <div className={`pluse-meta-chip${meta.isError ? ' is-error' : ''}`}>
        <span className="pluse-meta-chip-icon">{meta.icon}</span>
        <span className="pluse-meta-chip-title">{meta.label}</span>
      </div>
    )
  }
  return (
    <details className={`pluse-meta-chip is-expandable${meta.isError ? ' is-error' : ''}`}>
      <summary className="pluse-meta-chip-summary">
        <span className="pluse-meta-chip-icon">{meta.icon}</span>
        <span className="pluse-meta-chip-title">{meta.label}</span>
        <span className="pluse-meta-chip-content">{compactText(meta.content, 80)}</span>
      </summary>
      <pre className="pluse-meta-chip-detail">{meta.content}</pre>
    </details>
  )
}

function MetaEventGroup({
  events,
  t,
}: {
  events: QuestEvent[]
  t: (key: string) => string
}) {
  return (
    <div className="pluse-meta-group-body">
      {events.map((event) => <MetaEventEntry key={event.seq} event={event} t={t} />)}
    </div>
  )
}

export function ChatView({ questId, onQuestLoaded, onDataChanged }: ChatViewProps) {
  const { locale, t } = useI18n()
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
  const [convertTaskModalOpen, setConvertTaskModalOpen] = useState(false)
  const [newMessageCount, setNewMessageCount] = useState(0)
  const [composerHeight, setComposerHeight] = useState(110)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const composerRef = useRef<HTMLElement>(null)
  const threadRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const reloadTimer = useRef<number | null>(null)
  const eventCountRef = useRef(0)
  const isAtBottomRef = useRef(true)
  const [showScrollBottom, setShowScrollBottom] = useState(false)

  const MAX_ATTACHMENTS = 4
  const MAX_FILE_SIZE = 20 * 1024 * 1024

  function getViewportHeight(): number {
    if (typeof window === 'undefined') return 0
    return Math.round(window.visualViewport?.height ?? window.innerHeight)
  }

  function getMobileInitialInputHeight(): number {
    const viewportHeight = getViewportHeight()
    return Math.max(72, Math.min(128, Math.round(viewportHeight * 0.115)))
  }

  function addFiles(files: File[]) {
    const oversized = files.find((file) => file.size > MAX_FILE_SIZE)
    if (oversized) {
      setUploadError(t('文件 {name} 超过 20MB 限制', { name: oversized.name }))
      return
    }
    setPendingFiles((previous) => {
      const merged = [...previous, ...files].slice(0, MAX_ATTACHMENTS)
      if (previous.length + files.length > MAX_ATTACHMENTS) {
        setUploadError(t('最多附加 {count} 个文件', { count: MAX_ATTACHMENTS }))
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

  async function refreshThread(scrollToEnd = false) {
    const [eventsResult, runsResult] = await Promise.all([
      api.getQuestEvents(questId),
      api.getQuestRuns(questId),
    ])
    if (eventsResult.ok) setEvents(eventsResult.data.items)
    if (runsResult.ok) setRuns(runsResult.data)
    if (scrollToEnd) {
      requestAnimationFrame(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'instant' })
      })
    }
  }

  useEffect(() => {
    setQuest(null)
    setEvents([])
    setRuns([])
    void refreshQuest()
    void refreshThread(true)
  }, [questId])

  useEffect(() => {
    eventCountRef.current = 0
    setNewMessageCount(0)
    isAtBottomRef.current = true
    setShowScrollBottom(false)
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
      if (result.ok && result.data.models.length > 0) setCatalog(result.data)
      else setCatalog(buildFallbackRuntimeModelCatalog(quest.tool))
    })
  }, [quest?.tool])

  useEffect(() => {
    const source = new EventSource(`/api/events?questId=${encodeURIComponent(questId)}`)
    let pendingQuestRefresh = false
    let pendingThreadRefresh = false
    let pendingProjectRefresh = false

    source.onmessage = (message) => {
      const event = parseSseMessage(message.data)
      if (!event) return

      if (event.type === 'quest_updated') {
        pendingQuestRefresh = true
        pendingProjectRefresh = true
      }
      if (event.type === 'run_updated') {
        pendingQuestRefresh = true
        pendingThreadRefresh = true
      }
      if (event.type === 'run_line') {
        pendingThreadRefresh = true
      }
      if (!pendingQuestRefresh && !pendingThreadRefresh && !pendingProjectRefresh) return

      if (reloadTimer.current) window.clearTimeout(reloadTimer.current)
      reloadTimer.current = window.setTimeout(() => {
        const shouldRefreshQuest = pendingQuestRefresh
        const shouldRefreshThread = pendingThreadRefresh
        const shouldRefreshProject = pendingProjectRefresh

        pendingQuestRefresh = false
        pendingThreadRefresh = false
        pendingProjectRefresh = false

        if (shouldRefreshQuest) void refreshQuest()
        if (shouldRefreshThread) void refreshThread()
        if (shouldRefreshProject) void onDataChanged?.()
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
  const threadSegments = useMemo(() => buildThreadSegments(events), [events])

  const updateScrollBottomVisibility = useCallback(() => {
    const thread = threadRef.current
    if (!thread) return
    const distanceToBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight
    const shouldShow = distanceToBottom > 72
    isAtBottomRef.current = !shouldShow
    setShowScrollBottom(shouldShow)
  }, [])

  function scrollToBottom(behavior: ScrollBehavior = 'smooth') {
    setNewMessageCount(0)
    isAtBottomRef.current = true
    setShowScrollBottom(false)
    bottomRef.current?.scrollIntoView({ behavior })
  }

  useEffect(() => {
    const previousCount = eventCountRef.current
    const nextCount = events.length
    const delta = nextCount - previousCount
    if (delta > 0 && !isAtBottomRef.current) {
      setNewMessageCount((current) => current + delta)
    }
    if (isAtBottomRef.current) {
      setNewMessageCount(0)
    }
    eventCountRef.current = nextCount
  }, [events.length])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => updateScrollBottomVisibility())
    return () => window.cancelAnimationFrame(frame)
  }, [events, updateScrollBottomVisibility])

  useEffect(() => {
    const composer = composerRef.current
    if (!composer) return

    const syncComposerMetrics = () => {
      setComposerHeight(Math.round(composer.getBoundingClientRect().height))
      updateScrollBottomVisibility()
    }

    syncComposerMetrics()

    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => syncComposerMetrics())
    observer.observe(composer)
    return () => observer.disconnect()
  }, [quest?.id, updateScrollBottomVisibility])

  const chatShellStyle = useMemo<CSSProperties & { '--chat-composer-height': string }>(() => ({
    '--chat-composer-height': `${composerHeight}px`,
  }), [composerHeight])

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
      text: draft.trim() || t('请查看附件'),
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
    return <div className="pluse-page pluse-page-loading">{t('正在加载会话…')}</div>
  }

  return (
    <div className="pluse-page pluse-session-page">
      <div className="pluse-chat-shell" style={chatShellStyle}>
        <div className="pluse-thread" ref={threadRef} onScroll={updateScrollBottomVisibility}>
          <div className="pluse-thread-inner">
            {events.length === 0 ? (
              <div className="pluse-empty-state pluse-chat-empty">
                <h2>{t('开始会话')}</h2>
              </div>
            ) : null}
            {threadSegments.map((segment) => segment.kind === 'message'
              ? <MessageEventCard key={segment.key} event={segment.event} locale={locale} t={t} />
              : <MetaEventGroup key={segment.key} events={segment.events} t={t} />)}
            <div ref={bottomRef} />
          </div>
        </div>
        {showScrollBottom ? (
          <button
            type="button"
            className="pluse-scroll-bottom-btn"
            onClick={() => scrollToBottom()}
            aria-label={newMessageCount > 0 ? t('有 {count} 条新消息，滚动到底部', { count: newMessageCount }) : t('滚动到底部')}
            title={newMessageCount > 0 ? t('有 {count} 条新消息', { count: newMessageCount }) : t('滚动到底部')}
          >
            <span className="pluse-scroll-bottom-icon" aria-hidden="true">↓</span>
            {newMessageCount > 0 ? (
              <span className="pluse-scroll-bottom-badge" aria-hidden="true">
                {newMessageCount > 99 ? '99+' : newMessageCount}
              </span>
            ) : null}
          </button>
        ) : null}

        <footer className="pluse-composer" ref={composerRef}>
          <button
            type="button"
            className="pluse-composer-resize-handle"
            onPointerDown={handleResizeStart}
            aria-label={t('调整输入区高度')}
            title={t('拖动调整输入区高度')}
          >
            <span />
          </button>
          {quest.followUpQueue.length > 0 ? (
            <div className="pluse-queue-panel">
              <div className="pluse-queue-panel-head">
                <div className="pluse-inline-status pluse-inline-status-compact">
                  <span>{t('待发送 {count}', { count: quest.followUpQueue.length })}</span>
                  <span>{t('当前回复结束后自动发送')}</span>
                </div>
                <button
                  type="button"
                  className="pluse-button pluse-button-ghost pluse-button-compact"
                  onClick={() => void handleClearQueue()}
                  title={t('清空排队消息')}
                >
                  {t('清空队列')}
                </button>
              </div>
              <div className="pluse-queue-chip-list">
                {quest.followUpQueue.map((item) => (
                  <div key={item.requestId} className="pluse-queue-item">
                    <div className="pluse-queue-item-copy">
                      <strong className="pluse-queue-item-title">
                        {queuePreview(queuedMessageText(item), t)}
                      </strong>
                      <span className="pluse-queue-item-meta">{formatTime(Date.parse(item.queuedAt), locale)}</span>
                    </div>
                    <button
                      type="button"
                      className="pluse-queue-item-remove"
                      onClick={() => void handleRemoveQueuedRequest(item.requestId)}
                      disabled={removingRequestId === item.requestId}
                      aria-label={t('移除排队消息')}
                      title={t('移除排队消息')}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="pluse-composer-settings">
            <div className="pluse-composer-toolbar">
              <div className="pluse-composer-mainline">
                <div className="pluse-inline-status pluse-inline-status-compact">
                  {quest.activeRunId ? <span>{t('运行中')}</span> : null}
                  {quest.followUpQueue.length > 0 ? <span>{t('待发送 {count}', { count: quest.followUpQueue.length })}</span> : null}
                  {!quest.activeRunId && quest.followUpQueue.length === 0 ? <span>{t('Enter 发送')}</span> : null}
                  {latestRun && (!quest.activeRunId || latestRun.state !== 'running') ? <span>{t('上次：{{state}}', { state: formatRunState(latestRun.state, t) })}</span> : null}
                  {latestRun?.state === 'failed' && latestRun.failureReason ? <span>{summarizeFailureReason(latestRun.failureReason, t)}</span> : null}
                </div>
                <div className="pluse-runtime-controls pluse-runtime-controls-inline pluse-runtime-controls-composer-compact">
                  <select
                    value={quest.tool ?? 'codex'}
                    onChange={(event) => {
                      const tool = event.target.value
                      setCatalog(buildFallbackRuntimeModelCatalog(tool))
                      void patchQuest({
                        tool,
                        model: defaultRuntimeModelId(tool),
                        effort: defaultRuntimeEffortId(tool),
                      })
                    }}
                  >
                    {runtimeTools.map((tool) => (
                      <option key={tool.id} value={tool.id}>{tool.name}</option>
                    ))}
                  </select>
                  <select value={resolveRuntimeModelSelection(quest.tool, quest.model, catalog)} onChange={(event) => void patchQuest({ model: event.target.value || null })}>
                    {catalog?.models.map((model) => (
                      <option key={model.id} value={model.id}>{model.label}</option>
                    ))}
                  </select>
                  {!!effortOptions.length ? (
                    <select value={resolveRuntimeEffortSelection(quest.tool, quest.effort, catalog)} onChange={(event) => void patchQuest({ effort: event.target.value || null })}>
                      {effortOptions.map((effort) => (
                        <option key={effort} value={effort}>{effort}</option>
                      ))}
                    </select>
                  ) : null}
                </div>
                <div className="pluse-composer-quick-actions">
                  <button
                    type="button"
                    className="pluse-icon-button pluse-transfer-action"
                    title={t('转任务')}
                    aria-label={t('转任务')}
                    onClick={() => setConvertTaskModalOpen(true)}
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
                      aria-label={t('移除')}
                      title={t('移除')}
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
                if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
                if (event.metaKey || event.ctrlKey || event.shiftKey) return
                event.preventDefault()
                void handleSend()
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
              placeholder={t('给当前会话发送消息…')}
              rows={2}
            />
            <div className="pluse-composer-input-actions">
              <button
                type="button"
                className="pluse-icon-button"
                onClick={() => fileInputRef.current?.click()}
                disabled={sending || pendingFiles.length >= MAX_ATTACHMENTS}
                aria-label={t('附加文件')}
                title={t('附加文件')}
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
                  <span className="pluse-label-desktop">{cancelling ? t('取消中…') : t('停止')}</span>
                  <span className="pluse-label-mobile" aria-hidden="true">⏹</span>
                </button>
              ) : null}
              <button
                type="button"
                className="pluse-icon-button pluse-send-btn"
                onClick={() => void handleSend()}
                disabled={sending}
                aria-label={sending ? t('发送中') : t('发送')}
                title={t('发送 (Enter) · 换行 (Cmd/Ctrl+Enter)')}
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

        <TaskComposerModal
          open={convertTaskModalOpen}
          projectId={quest.projectId}
          projectName={null}
          initialKind="ai"
          conversionQuestId={quest.id}
          conversionQuestName={displaySessionName(quest.name, t)}
          conversionQuestDescription={quest.description ?? ''}
          conversionPrompt=""
          conversionContinueQuest={true}
          onClose={() => setConvertTaskModalOpen(false)}
          onCreated={async () => {
            await onDataChanged?.()
          }}
        />
      </div>
    </div>
  )
}

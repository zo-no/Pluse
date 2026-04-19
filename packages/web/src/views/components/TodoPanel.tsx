import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation, useNavigate, type Location as RouterLocation } from 'react-router-dom'
import type { Quest, Todo, UpdateTodoInput } from '@pluse/types'
import * as api from '@/api/client'
import { useI18n } from '@/i18n'
import { displayTaskName } from '@/views/utils/display'
import { parseSseMessage } from '@/views/utils/sse'
import { formatTodoDueAt, formatTodoRepeat, formatTodoScheduleSummary, fromDateTimeLocalValue, toDateTimeLocalValue } from '@/views/utils/todo'
import { ArchiveIcon, CheckIcon, ClockIcon, CloseIcon, PlayIcon, PlusIcon, RouteIcon, SparkIcon } from './icons'
import { TaskComposerModal, type TaskComposerKind } from './TaskComposerModal'

interface TodoPanelProps {
  projectId: string | null
  projectName?: string | null
  activeQuestId?: string | null
  activeQuest?: Quest | null
  onRequestClose?: () => void
  onDataChanged?: () => Promise<void> | void
}

type ScopeTab = 'global' | 'project' | 'session'
type SourceTab = 'human' | 'ai'

type RailTaskItem =
  | { entityType: 'quest'; quest: Quest; archived: boolean }
  | { entityType: 'todo'; todo: Todo; archived: boolean }

function taskOverlayState(location: RouterLocation): { backgroundLocation: RouterLocation } {
  return { backgroundLocation: location }
}

function formatDateTime(value?: string, locale = 'zh-CN', t?: (key: string) => string): string {
  if (!value) return t ? t('未记录') : '未记录'
  return new Intl.DateTimeFormat(locale, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatSidebarTime(value?: string, t?: (key: string, values?: Record<string, string | number>) => string): string {
  if (!value) return ''
  const timestamp = new Date(value).getTime()
  const delta = Math.max(0, Date.now() - timestamp)
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour
  const week = 7 * day
  if (delta < minute) return t ? t('刚刚') : '刚刚'
  if (delta < hour) return t ? t('{count} 分钟', { count: Math.max(1, Math.floor(delta / minute)) }) : `${Math.max(1, Math.floor(delta / minute))} 分钟`
  if (delta < day) return t ? t('{count} 小时', { count: Math.max(1, Math.floor(delta / hour)) }) : `${Math.max(1, Math.floor(delta / hour))} 小时`
  if (delta < week) return t ? t('{count} 天', { count: Math.max(1, Math.floor(delta / day)) }) : `${Math.max(1, Math.floor(delta / day))} 天`
  return t ? t('{count} 周', { count: Math.max(1, Math.floor(delta / week)) }) : `${Math.max(1, Math.floor(delta / week))} 周`
}

function taskLabel(quest: Quest, t?: (key: string) => string): string {
  return displayTaskName(quest.title || quest.name, t)
}

function taskStatusLabel(status?: Quest['status'], t?: (key: string) => string): string {
  if (status === 'running') return t ? t('运行中') : '运行中'
  if (status === 'pending') return t ? t('待处理') : '待处理'
  if (status === 'done') return t ? t('已完成') : '已完成'
  if (status === 'failed') return t ? t('失败') : '失败'
  if (status === 'cancelled') return t ? t('已取消') : '已取消'
  return t ? t('待处理') : '待处理'
}

function todoStatusLabel(status: Todo['status'], t?: (key: string) => string): string {
  if (status === 'done') return t ? t('已完成') : '已完成'
  if (status === 'cancelled') return t ? t('已取消') : '已取消'
  return t ? t('待处理') : '待处理'
}

function isClosedQuest(quest: Quest): boolean {
  return quest.status === 'done' || quest.status === 'failed' || quest.status === 'cancelled'
}

function sortByUpdatedAt<T extends { updatedAt: string }>(items: T[]): T[] {
  return [...items].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
}

function sortOpenTodos(items: Todo[]): Todo[] {
  return [...items].sort((left, right) => {
    const leftDue = left.dueAt ? Date.parse(left.dueAt) : Number.POSITIVE_INFINITY
    const rightDue = right.dueAt ? Date.parse(right.dueAt) : Number.POSITIVE_INFINITY
    if (leftDue !== rightDue) return leftDue - rightDue
    return Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
  })
}

function railTaskUpdatedAt(item: RailTaskItem): string {
  return item.entityType === 'todo' ? item.todo.updatedAt : item.quest.updatedAt
}

function sortRailTaskItems(items: RailTaskItem[]): RailTaskItem[] {
  return [...items].sort((left, right) => Date.parse(railTaskUpdatedAt(right)) - Date.parse(railTaskUpdatedAt(left)))
}

function createTodoItems(items: Todo[], archived = false): RailTaskItem[] {
  return items.map((todo) => ({ entityType: 'todo', todo, archived }))
}

function createQuestItems(items: Quest[], archived = false): RailTaskItem[] {
  return items.map((quest) => ({ entityType: 'quest', quest, archived }))
}

function resolveScopeData(params: {
  scope: ScopeTab
  projectTasks: Quest[]
  projectArchivedTasks: Quest[]
  projectTodos: Todo[]
  projectArchivedTodos: Todo[]
  globalTasks: Quest[]
  globalArchivedTasks: Quest[]
  globalTodos: Todo[]
  globalArchivedTodos: Todo[]
  sessionTasks: Quest[]
  sessionArchivedTasks: Quest[]
  sessionTodos: Todo[]
  sessionArchivedTodos: Todo[]
}): { tasks: Quest[]; archivedTasks: Quest[]; todos: Todo[]; archivedTodos: Todo[] } {
  if (params.scope === 'global') {
    return {
      tasks: params.globalTasks,
      archivedTasks: params.globalArchivedTasks,
      todos: params.globalTodos,
      archivedTodos: params.globalArchivedTodos,
    }
  }
  if (params.scope === 'session') {
    return {
      tasks: params.sessionTasks,
      archivedTasks: params.sessionArchivedTasks,
      todos: params.sessionTodos,
      archivedTodos: params.sessionArchivedTodos,
    }
  }
  return {
    tasks: params.projectTasks,
    archivedTasks: params.projectArchivedTasks,
    todos: params.projectTodos,
    archivedTodos: params.projectArchivedTodos,
  }
}

function formatScopeEmptyMessage(
  scope: ScopeTab,
  source: SourceTab,
  t?: (key: string) => string,
): string {
  if (scope === 'session' && source === 'ai') return t ? t('当前会话暂无 AI 任务。') : '当前会话暂无 AI 任务。'
  if (scope === 'session' && source === 'human') return t ? t('当前会话暂无待办。') : '当前会话暂无待办。'
  return source === 'ai'
    ? (t ? t('当前范围暂无 AI 任务。') : '当前范围暂无 AI 任务。')
    : (t ? t('当前范围暂无待办。') : '当前范围暂无待办。')
}

export function TodoPanel({
  projectId,
  projectName,
  activeQuestId,
  activeQuest,
  onRequestClose,
  onDataChanged,
}: TodoPanelProps) {
  const { locale, t } = useI18n()
  const navigate = useNavigate()
  const location = useLocation()
  const [tasks, setTasks] = useState<Quest[]>([])
  const [archivedTasks, setArchivedTasks] = useState<Quest[]>([])
  const [todos, setTodos] = useState<Todo[]>([])
  const [archivedTodos, setArchivedTodos] = useState<Todo[]>([])
  const [globalTasks, setGlobalTasks] = useState<Quest[]>([])
  const [globalArchivedTasks, setGlobalArchivedTasks] = useState<Quest[]>([])
  const [globalTodos, setGlobalTodos] = useState<Todo[]>([])
  const [globalArchivedTodos, setGlobalArchivedTodos] = useState<Todo[]>([])
  const [scopeTab, setScopeTab] = useState<ScopeTab>('project')
  const [scopeModes, setScopeModes] = useState<Record<ScopeTab, SourceTab>>({
    global: 'human',
    project: 'human',
    session: 'human',
  })
  const [historyExpandedByView, setHistoryExpandedByView] = useState<Record<string, boolean>>({})
  const [archivedExpanded, setArchivedExpanded] = useState(false)
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [createModalKind, setCreateModalKind] = useState<TaskComposerKind>('human')
  const [selectedTodoId, setSelectedTodoId] = useState<string | null>(null)
  const [todoEditOpen, setTodoEditOpen] = useState(false)
  const [todoDraft, setTodoDraft] = useState({
    title: '',
    waitingInstructions: '',
    description: '',
    dueAt: '',
    repeat: 'none' as Todo['repeat'],
  })
  const [todoSaving, setTodoSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)

  async function loadData() {
    const [globalTaskResult, globalArchivedTaskResult, globalTodoResult, globalArchivedTodoResult] = await Promise.all([
      api.getQuests({ kind: 'task', deleted: false }),
      api.getQuests({ kind: 'task', deleted: true }),
      api.getTodos({ deleted: false }),
      api.getTodos({ deleted: true }),
    ])

    if (!globalTaskResult.ok) {
      setError(globalTaskResult.error)
      return
    }
    if (!globalArchivedTaskResult.ok) {
      setError(globalArchivedTaskResult.error)
      return
    }
    if (!globalTodoResult.ok) {
      setError(globalTodoResult.error)
      return
    }
    if (!globalArchivedTodoResult.ok) {
      setError(globalArchivedTodoResult.error)
      return
    }

    setGlobalTasks(globalTaskResult.data)
    setGlobalArchivedTasks(globalArchivedTaskResult.data)
    setGlobalTodos(globalTodoResult.data)
    setGlobalArchivedTodos(globalArchivedTodoResult.data)

    if (!projectId) {
      setTasks([])
      setArchivedTasks([])
      setTodos([])
      setArchivedTodos([])
      setError(null)
      return
    }

    const [taskResult, archivedTaskResult, todoResult, archivedTodoResult] = await Promise.all([
      api.getQuests({ projectId, kind: 'task', deleted: false }),
      api.getQuests({ projectId, kind: 'task', deleted: true }),
      api.getTodos({ projectId, deleted: false }),
      api.getTodos({ projectId, deleted: true }),
    ])

    if (!taskResult.ok) {
      setError(taskResult.error)
      return
    }
    if (!archivedTaskResult.ok) {
      setError(archivedTaskResult.error)
      return
    }
    if (!todoResult.ok) {
      setError(todoResult.error)
      return
    }
    if (!archivedTodoResult.ok) {
      setError(archivedTodoResult.error)
      return
    }

    setTasks(taskResult.data)
    setArchivedTasks(archivedTaskResult.data)
    setTodos(todoResult.data)
    setArchivedTodos(archivedTodoResult.data)
    setError(null)
  }

  function setSourceTab(tab: ScopeTab, source: SourceTab) {
    setScopeModes((current) => ({ ...current, [tab]: source }))
  }

  useEffect(() => {
    void loadData()
  }, [projectId, reloadTick])

  useEffect(() => {
    if (!projectId) return
    const source = new EventSource(`/api/events?projectId=${encodeURIComponent(projectId)}`)
    let reloadTimer: number | null = null
    source.onmessage = (message) => {
      const event = parseSseMessage(message.data)
      if (!event) return
      if (
        event.type !== 'quest_updated'
        && event.type !== 'quest_deleted'
        && event.type !== 'todo_updated'
        && event.type !== 'todo_deleted'
      ) return
      if (reloadTimer) window.clearTimeout(reloadTimer)
      reloadTimer = window.setTimeout(() => {
        setReloadTick((value) => value + 1)
      }, 120)
    }
    return () => {
      source.close()
      if (reloadTimer) window.clearTimeout(reloadTimer)
    }
  }, [projectId])

  async function handleUpdateTodo(todo: Todo, patch: UpdateTodoInput): Promise<boolean> {
    const result = await api.updateTodo(todo.id, {
      title: patch.title,
      description: patch.description === undefined ? undefined : patch.description ?? null,
      waitingInstructions: patch.waitingInstructions === undefined ? undefined : patch.waitingInstructions ?? null,
      dueAt: patch.dueAt === undefined ? undefined : patch.dueAt ?? null,
      repeat: patch.repeat,
      originQuestId: patch.originQuestId === undefined ? undefined : patch.originQuestId ?? null,
      status: patch.status,
    })
    if (!result.ok) {
      setError(result.error)
      return false
    }
    await loadData()
    await onDataChanged?.()
    return true
  }

  async function handleArchiveTodo(todo: Todo, deleted: boolean) {
    const result = await api.updateTodo(todo.id, { deleted })
    if (!result.ok) {
      setError(result.error)
      return
    }
    await loadData()
    await onDataChanged?.()
  }

  async function handleTriggerQuest(quest: Quest) {
    const result = await api.startQuestRun(quest.id, { trigger: 'manual', triggeredBy: 'human' })
    if (!result.ok) {
      setError(result.error)
      return
    }
    await loadData()
    await onDataChanged?.()
  }

  async function handleArchiveQuest(questId: string, archived: boolean) {
    const allKnownTasks = [...tasks, ...archivedTasks, ...globalTasks, ...globalArchivedTasks]
    const unarchivedNavigationPool = [...tasks, ...globalTasks]
      .filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index)
    const quest = allKnownTasks.find((item) => item.id === questId)
    if (!quest) return
    if (archived && quest.activeRunId) {
      const confirmed = window.confirm(t('当前任务正在运行，归档前会先取消当前执行。继续吗？'))
      if (!confirmed) return
      const cancelled = await api.cancelRun(quest.activeRunId)
      if (!cancelled.ok) {
        setError(cancelled.error)
        return
      }
      let cleared = false
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const current = await api.getQuest(questId)
        if (current.ok && !current.data.activeRunId) {
          cleared = true
          break
        }
        await new Promise((resolve) => window.setTimeout(resolve, 150))
      }
      if (!cleared) {
        setError(t('当前执行尚未完全停止，请稍后再试'))
        return
      }
    }
    const result = await api.updateQuest(questId, { deleted: archived })
    if (!result.ok) {
      setError(result.error)
      return
    }
    if (archived && activeQuestId === questId && projectId) {
      const index = unarchivedNavigationPool.findIndex((item) => item.id === questId)
      const nextQuest = index >= 0 ? (unarchivedNavigationPool[index + 1] || unarchivedNavigationPool[index - 1]) : null
      if (nextQuest) navigate(`/quests/${nextQuest.id}`)
      else navigate(`/projects/${projectId}`)
    }
    await loadData()
    await onDataChanged?.()
  }

  const sourceTab = scopeModes[scopeTab]
  const scopeData = useMemo(
    () => resolveScopeData({
      scope: scopeTab,
      projectTasks: tasks,
      projectArchivedTasks: archivedTasks,
      projectTodos: todos,
      projectArchivedTodos: archivedTodos,
      globalTasks,
      globalArchivedTasks,
      globalTodos,
      globalArchivedTodos,
      sessionTasks: activeQuest?.kind === 'task' && activeQuest.id ? [activeQuest] : [],
      sessionArchivedTasks: [],
      sessionTodos: globalTodos.filter((todo) => todo.originQuestId === activeQuestId),
      sessionArchivedTodos: globalArchivedTodos.filter((todo) => todo.originQuestId === activeQuestId),
    }),
    [scopeTab, tasks, archivedTasks, todos, archivedTodos, globalTasks, globalArchivedTasks, globalTodos, globalArchivedTodos, projectId, activeQuest, activeQuestId],
  )

  const visibleTodos = useMemo(
    () => sourceTab === 'ai' ? [] : scopeData.todos,
    [scopeData.todos, sourceTab],
  )

  const visibleTasks = useMemo(
    () => sourceTab === 'human' ? [] : scopeData.tasks,
    [scopeData.tasks, sourceTab],
  )

  const visibleArchivedTasks = useMemo(
    () => sourceTab === 'human' ? [] : scopeData.archivedTasks,
    [scopeData.archivedTasks, sourceTab],
  )

  const visibleArchivedTodos = useMemo(
    () => sourceTab === 'ai' ? [] : scopeData.archivedTodos,
    [scopeData.archivedTodos, sourceTab],
  )

  const openHumanTodos = useMemo(
    () => sortOpenTodos(visibleTodos.filter((todo) => todo.status === 'pending')),
    [visibleTodos],
  )

  const openAiTasks = useMemo(
    () => sortByUpdatedAt(visibleTasks.filter((quest) => !isClosedQuest(quest))),
    [visibleTasks],
  )

  const historyHumanTodos = useMemo(
    () => sortByUpdatedAt(visibleTodos.filter((todo) => todo.status !== 'pending')),
    [visibleTodos],
  )

  const historyAiTasks = useMemo(
    () => sortByUpdatedAt(visibleTasks.filter((quest) => isClosedQuest(quest))),
    [visibleTasks],
  )

  const activeItems = useMemo(
    () => sortRailTaskItems([
      ...createTodoItems(openHumanTodos),
      ...createQuestItems(openAiTasks),
    ]),
    [openHumanTodos, openAiTasks],
  )

  const historyItems = useMemo(
    () => sortRailTaskItems([
      ...createTodoItems(historyHumanTodos),
      ...createQuestItems(historyAiTasks),
    ]),
    [historyHumanTodos, historyAiTasks],
  )

  const visibleArchivedItems = useMemo(
    () => sortRailTaskItems([
      ...createTodoItems(visibleArchivedTodos, true),
      ...createQuestItems(visibleArchivedTasks, true),
    ]),
    [visibleArchivedTasks, visibleArchivedTodos],
  )

  const scopeCounts = useMemo(
    () => ({
      global: globalTasks.length + globalTodos.length,
      project: tasks.length + todos.length,
      session: (activeQuest?.kind === 'task' ? 1 : 0) + (activeQuestId ? globalTodos.filter((todo) => todo.originQuestId === activeQuestId).length : 0),
      pending: openHumanTodos.length + openAiTasks.length,
      done: historyHumanTodos.length + historyAiTasks.length,
    }),
    [activeQuest?.kind, activeQuestId, globalTasks.length, globalTodos.length, tasks.length, todos.length, openHumanTodos.length, openAiTasks.length, historyHumanTodos.length, historyAiTasks.length],
  )
  const allKnownTodos = useMemo(() => {
    const deduped = new Map<string, Todo>()
    for (const item of [...todos, ...archivedTodos, ...globalTodos, ...globalArchivedTodos]) {
      deduped.set(item.id, item)
    }
    return Array.from(deduped.values())
  }, [todos, archivedTodos, globalTodos, globalArchivedTodos])
  const selectedTodo = useMemo(
    () => (selectedTodoId ? allKnownTodos.find((todo) => todo.id === selectedTodoId) ?? null : null),
    [allKnownTodos, selectedTodoId],
  )
  const modalRoot = typeof document !== 'undefined' ? document.body : null

  const questLinkState = taskOverlayState(location)
  const historySectionKey = `${scopeTab}:${sourceTab}`
  const historyExpanded = historyExpandedByView[historySectionKey] ?? false
  const historyDoneCount = useMemo(
    () => historyItems.filter((item) => (
      item.entityType === 'todo'
        ? item.todo.status === 'done'
        : item.quest.status === 'done'
    )).length,
    [historyItems],
  )
  const historySectionLabel = historyDoneCount === historyItems.length ? t('已完成') : t('已处理')

  useEffect(() => {
    if (!selectedTodo) {
      setTodoEditOpen(false)
      setTodoDraft({
        title: '',
        waitingInstructions: '',
        description: '',
        dueAt: '',
        repeat: 'none',
      })
      return
    }
    setTodoDraft({
      title: selectedTodo.title,
      waitingInstructions: selectedTodo.waitingInstructions ?? '',
      description: selectedTodo.description ?? '',
      dueAt: toDateTimeLocalValue(selectedTodo.dueAt),
      repeat: selectedTodo.repeat,
    })
    setTodoEditOpen(false)
  }, [selectedTodoId, selectedTodo?.updatedAt])

  useEffect(() => {
    if (!selectedTodoId) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedTodoId(null)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedTodoId])

  function openCreateModal(kind: TaskComposerKind) {
    setCreateModalKind(kind)
    setCreateModalOpen(true)
  }

  async function handleSaveSelectedTodo() {
    if (!selectedTodo) return
    const nextTitle = todoDraft.title.trim()
    if (!nextTitle) {
      setError(t('任务标题不能为空'))
      return
    }
    setTodoSaving(true)
    const ok = await handleUpdateTodo(selectedTodo, {
      title: nextTitle,
      waitingInstructions: todoDraft.waitingInstructions.trim() || null,
      description: todoDraft.description.trim() || null,
      dueAt: todoDraft.dueAt.trim() ? fromDateTimeLocalValue(todoDraft.dueAt) ?? null : null,
      repeat: todoDraft.repeat,
    })
    setTodoSaving(false)
    if (ok) setTodoEditOpen(false)
  }

  function renderQuestItem(quest: Quest, archived = false) {
    const isActive = activeQuestId === quest.id
    const canTrigger = !archived && !quest.activeRunId && quest.enabled !== false
    return (
      <article
        key={quest.id}
        className={`pluse-sidebar-item pluse-sidebar-row pluse-task-list-item${isActive ? ' is-active' : ''}${archived ? ' is-archived' : ''}`}
      >
        <Link
          className="pluse-sidebar-item-main pluse-task-list-main"
          to={`/quests/${quest.id}`}
          state={questLinkState}
          onClick={() => onRequestClose?.()}
        >
          <div className="pluse-task-list-copy">
            <div className="pluse-sidebar-item-title">
              <span className="pluse-task-kind-badge" aria-label={t('AI 任务')} title={t('AI 任务')}>
                <SparkIcon className="pluse-icon" />
              </span>
              <strong>{taskLabel(quest, t)}</strong>
            </div>
            <div className="pluse-task-list-meta" title={formatDateTime(quest.updatedAt, locale, t)}>
              <span className={`pluse-task-list-state is-${quest.activeRunId ? 'running' : quest.status ?? 'pending'}`}>
                {quest.activeRunId ? t('运行中') : taskStatusLabel(quest.status, t)}
              </span>
              <span className="pluse-task-list-dot" aria-hidden="true">·</span>
              <span className="pluse-meta-inline">
                <ClockIcon className="pluse-icon pluse-inline-icon" />
                {formatSidebarTime(quest.updatedAt, t)}
              </span>
            </div>
          </div>
        </Link>
        <div className="pluse-sidebar-item-actions">
          {canTrigger ? (
            <button
              type="button"
              className="pluse-sidebar-action-btn"
              onClick={(event) => {
                event.preventDefault()
                void handleTriggerQuest(quest)
              }}
              aria-label={t('立即触发')}
              title={t('立即触发')}
            >
              <PlayIcon className="pluse-icon" />
            </button>
          ) : null}
          <button
            type="button"
            className="pluse-sidebar-action-btn"
            onClick={(event) => {
              event.preventDefault()
              void handleArchiveQuest(quest.id, !archived)
            }}
            aria-label={archived ? t('恢复任务') : t('归档任务')}
            title={archived ? t('恢复任务') : t('归档任务')}
          >
            <ArchiveIcon className="pluse-icon" />
          </button>
        </div>
      </article>
    )
  }

  function renderTodoItem(todo: Todo, archived = false) {
    const hasSource = Boolean(todo.originQuestId)
    const isActive = hasSource && todo.originQuestId === activeQuestId
    const isDone = todo.status === 'done'
    const isRecurring = todo.repeat !== 'none'
    const canToggle = !archived && todo.status !== 'cancelled'
    const scheduleSummary = formatTodoScheduleSummary(todo, locale, t)
    return (
      <article
        key={todo.id}
        className={`pluse-sidebar-item pluse-sidebar-row pluse-task-list-item is-todo${isActive ? ' is-active' : ''}${archived ? ' is-archived' : ''}${isDone ? ' is-done' : ''}`}
      >
        <button
          type="button"
          className={`pluse-todo-toggle${isDone ? ' is-done' : ''}`}
          onClick={() => void handleUpdateTodo(todo, { status: isDone ? 'pending' : 'done' })}
          aria-label={isDone ? t('恢复任务') : isRecurring ? t('完成本次') : t('完成任务')}
          title={isDone ? t('恢复任务') : isRecurring ? t('完成本次') : t('完成任务')}
          disabled={!canToggle}
        >
          {isDone ? <CheckIcon className="pluse-icon" /> : null}
        </button>
        <button
          type="button"
          className="pluse-task-list-main pluse-sidebar-item-main-button pluse-task-list-detail-trigger"
          onClick={() => setSelectedTodoId(todo.id)}
          aria-label={`${t('任务详情')} · ${todo.title}`}
        >
          <div className="pluse-task-list-copy">
            <div className="pluse-sidebar-item-title">
              <strong>{todo.title}</strong>
            </div>
            {scheduleSummary ? <p className="pluse-task-list-note">{scheduleSummary}</p> : null}
            <div className="pluse-task-list-meta" title={formatDateTime(todo.updatedAt, locale, t)}>
              <span className={`pluse-task-list-state is-${todo.status}`}>{todoStatusLabel(todo.status, t)}</span>
              <span className="pluse-task-list-dot" aria-hidden="true">·</span>
              <span className="pluse-meta-inline">
                <ClockIcon className="pluse-icon pluse-inline-icon" />
                {formatSidebarTime(todo.updatedAt, t)}
              </span>
            </div>
          </div>
        </button>
        <div className="pluse-sidebar-item-actions">
          {todo.originQuestId ? (
            <Link
              className={`pluse-sidebar-action-btn pluse-task-source-link${isActive ? ' is-active' : ''}`}
              to={`/quests/${todo.originQuestId}`}
              state={questLinkState}
              onClick={() => {
                setSelectedTodoId(null)
                onRequestClose?.()
              }}
              aria-label={t('来源会话')}
              title={t('来源会话')}
            >
              <RouteIcon className="pluse-icon" />
            </Link>
          ) : null}
          {archived ? (
            <button
              type="button"
              className="pluse-sidebar-action-btn"
              onClick={() => void handleArchiveTodo(todo, false)}
              aria-label={t('恢复任务')}
              title={t('恢复任务')}
            >
              <ArchiveIcon className="pluse-icon" />
            </button>
          ) : (
            <>
              <button
                type="button"
                className="pluse-sidebar-action-btn"
                onClick={() => void handleArchiveTodo(todo, true)}
                aria-label={t('归档任务')}
                title={t('归档任务')}
              >
                <ArchiveIcon className="pluse-icon" />
              </button>
            </>
          )}
        </div>
      </article>
    )
  }

  return (
    <>
      <aside className="pluse-rail">
        <div className="pluse-mobile-panel-header">
          <button type="button" className="pluse-icon-button" onClick={onRequestClose} aria-label={t('关闭任务面板')} title={t('关闭任务面板')}>
            <CloseIcon className="pluse-icon" />
          </button>
        </div>

        <div className="pluse-rail-head pluse-rail-head-rich">
          <div className="pluse-rail-kicker">{t('任务')}</div>
          <div className="pluse-rail-head-identity">
            <div className="pluse-rail-head-copy">
              <strong>{projectName || t('当前项目')}</strong>
            </div>
          </div>
          <div className="pluse-rail-tabs-row">
            <div className="pluse-rail-tabs pluse-rail-tabs-compact pluse-rail-scope-tabs">
              <button type="button" className={`pluse-tab${scopeTab === 'global' ? ' is-active' : ''}`} onClick={() => setScopeTab('global')}>
                {t('全局')}
                <span className="pluse-tab-count">{scopeCounts.global}</span>
              </button>
              <button type="button" className={`pluse-tab${scopeTab === 'project' ? ' is-active' : ''}`} onClick={() => setScopeTab('project')}>
                {t('项目')}
                <span className="pluse-tab-count">{scopeCounts.project}</span>
              </button>
              <button type="button" className={`pluse-tab${scopeTab === 'session' ? ' is-active' : ''}`} onClick={() => setScopeTab('session')}>
                {t('会话')}
                <span className="pluse-tab-count">{scopeCounts.session}</span>
              </button>
            </div>
            <div className="pluse-rail-source-switch" role="tablist" aria-label={t('任务类型')}>
              <button
                type="button"
                className={`pluse-tab pluse-rail-source-tab${sourceTab === 'human' ? ' is-active' : ''}`}
                onClick={() => setSourceTab(scopeTab, 'human')}
              >
                {t('人类')}
              </button>
              <button
                type="button"
                className={`pluse-tab pluse-rail-source-tab${sourceTab === 'ai' ? ' is-active' : ''}`}
                onClick={() => setSourceTab(scopeTab, 'ai')}
              >
                {t('AI')}
              </button>
            </div>
          </div>
        </div>

        <div className="pluse-task-list">
          {activeItems.length > 0 ? (
            <div className="pluse-note-list pluse-task-stream">
              {activeItems.map((item) => (
                item.entityType === 'todo'
                  ? renderTodoItem(item.todo, item.archived)
                  : renderQuestItem(item.quest, item.archived)
              ))}
            </div>
          ) : null}

          {historyItems.length > 0 ? (
            <section className="pluse-task-history">
              <button
                type="button"
                className="pluse-sidebar-archive-toggle"
                onClick={() => setHistoryExpandedByView((current) => ({
                  ...current,
                  [historySectionKey]: !historyExpanded,
                }))}
              >
                <span>{historyExpanded ? '▾' : '▸'} {historySectionLabel} ({historyItems.length})</span>
              </button>
              {historyExpanded ? (
                <div className="pluse-note-list pluse-task-history-list">
                  {historyItems.map((item) => (
                    item.entityType === 'todo'
                      ? renderTodoItem(item.todo, item.archived)
                      : renderQuestItem(item.quest, item.archived)
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}

          {activeItems.length === 0 && historyItems.length === 0 ? (
            <div className="pluse-rail-empty pluse-task-empty-state">
              <strong>{t('暂无任务')}</strong>
              <p>{formatScopeEmptyMessage(scopeTab, sourceTab, t)}</p>
            </div>
          ) : null}

          {visibleArchivedItems.length > 0 ? (
            <section className="pluse-task-archive">
              <button
                type="button"
                className="pluse-sidebar-archive-toggle"
                onClick={() => setArchivedExpanded((value) => !value)}
              >
                <span>{archivedExpanded ? '▾' : '▸'} {t('归档任务')} ({visibleArchivedItems.length})</span>
              </button>
              {archivedExpanded ? (
                <div className="pluse-note-list" style={{ marginTop: 8 }}>
                  {visibleArchivedItems.map((item) => (
                    item.entityType === 'todo'
                      ? renderTodoItem(item.todo, item.archived)
                      : renderQuestItem(item.quest, item.archived)
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}
        </div>

        <section className="pluse-rail-section-new-task">
          <button
            type="button"
            className="pluse-sidebar-chip-link pluse-sidebar-new-session-card pluse-rail-new-task-card"
            onClick={() => openCreateModal(sourceTab)}
            aria-label={t('新建任务')}
            disabled={!projectId}
          >
            <PlusIcon className="pluse-icon" />
            <span>{t('新建任务')}</span>
          </button>
        </section>

        {error ? <p className="pluse-error" style={{ padding: '0 14px 14px' }}>{error}</p> : null}
      </aside>

      <TaskComposerModal
        open={createModalOpen}
        projectId={projectId}
        projectName={projectName}
        initialKind={createModalKind}
        onClose={() => setCreateModalOpen(false)}
        onCreated={async ({ kind }) => {
          await loadData()
          await onDataChanged?.()
          if (kind === 'ai') onRequestClose?.()
        }}
      />

      {selectedTodo && modalRoot ? createPortal(
        <div className="pluse-modal-backdrop pluse-todo-detail-backdrop" onClick={() => setSelectedTodoId(null)}>
          <section
            className="pluse-modal-panel pluse-todo-detail-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`todo-detail-title-${selectedTodo.id}`}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="pluse-todo-detail-head">
              <div className="pluse-todo-detail-identity">
                <span className="pluse-task-detail-kicker">{t('人类任务')}</span>
                <div className="pluse-task-detail-title-row">
                  <h2 id={`todo-detail-title-${selectedTodo.id}`}>{selectedTodo.title}</h2>
                </div>
                <div className="pluse-task-detail-meta">
                  <span>{todoStatusLabel(selectedTodo.status, t)}</span>
                  <span>{formatDateTime(selectedTodo.updatedAt, locale, t)}</span>
                </div>
              </div>
              <button
                type="button"
                className="pluse-icon-button"
                onClick={() => setSelectedTodoId(null)}
                aria-label={t('关闭')}
                title={t('关闭')}
              >
                <CloseIcon className="pluse-icon" />
              </button>
            </header>

            <div className="pluse-todo-detail-body">
              {todoEditOpen ? (
                <div className="pluse-form-grid pluse-todo-detail-form">
                  <label>
                    <span>{t('标题')}</span>
                    <input
                      value={todoDraft.title}
                      onChange={(event) => setTodoDraft((current) => ({ ...current, title: event.target.value }))}
                      placeholder={t('输入任务标题')}
                      maxLength={160}
                    />
                  </label>
                  <label>
                    <span>{t('等待说明')}</span>
                    <textarea
                      value={todoDraft.waitingInstructions}
                      onChange={(event) => setTodoDraft((current) => ({ ...current, waitingInstructions: event.target.value }))}
                      placeholder={t('补充等待谁、等什么、满足什么条件后继续')}
                      rows={4}
                    />
                  </label>
                  <label>
                    <span>{t('时间')}</span>
                    <input
                      type="datetime-local"
                      value={todoDraft.dueAt}
                      onChange={(event) => setTodoDraft((current) => ({ ...current, dueAt: event.target.value }))}
                    />
                  </label>
                  <label>
                    <span>{t('重复')}</span>
                    <select
                      value={todoDraft.repeat}
                      onChange={(event) => setTodoDraft((current) => ({ ...current, repeat: event.target.value as Todo['repeat'] }))}
                    >
                      <option value="none">{formatTodoRepeat('none', t)}</option>
                      <option value="daily">{formatTodoRepeat('daily', t)}</option>
                      <option value="weekly">{formatTodoRepeat('weekly', t)}</option>
                      <option value="monthly">{formatTodoRepeat('monthly', t)}</option>
                    </select>
                  </label>
                  <label>
                    <span>{t('备注')}</span>
                    <textarea
                      value={todoDraft.description}
                      onChange={(event) => setTodoDraft((current) => ({ ...current, description: event.target.value }))}
                      placeholder={t('补充上下文、链接或补充说明')}
                      rows={5}
                    />
                  </label>
                </div>
              ) : (
                <>
                  {(selectedTodo.dueAt || selectedTodo.repeat !== 'none') ? (
                    <section className="pluse-todo-detail-section">
                      <h3>{t('计划')}</h3>
                      <div className="pluse-todo-detail-pills">
                        {selectedTodo.dueAt ? <span className="pluse-sidebar-badge">{t('截止')} {formatTodoDueAt(selectedTodo.dueAt, locale, t)}</span> : null}
                        {selectedTodo.repeat !== 'none' ? <span className="pluse-sidebar-badge">{formatTodoRepeat(selectedTodo.repeat, t)}</span> : null}
                      </div>
                    </section>
                  ) : null}

                  {selectedTodo.waitingInstructions ? (
                    <section className="pluse-todo-detail-section">
                      <h3>{t('等待说明')}</h3>
                      <p>{selectedTodo.waitingInstructions}</p>
                    </section>
                  ) : null}

                  {selectedTodo.description ? (
                    <section className="pluse-todo-detail-section">
                      <h3>{t('说明')}</h3>
                      <p>{selectedTodo.description}</p>
                    </section>
                  ) : null}

                  {selectedTodo.originQuestId ? (
                    <section className="pluse-todo-detail-section">
                      <h3>{t('来源')}</h3>
                      <Link
                        className="pluse-sidebar-chip-link"
                        to={`/quests/${selectedTodo.originQuestId}`}
                        state={questLinkState}
                        onClick={() => {
                          setSelectedTodoId(null)
                          onRequestClose?.()
                        }}
                      >
                        {t('来源会话')}
                      </Link>
                    </section>
                  ) : null}
                </>
              )}
            </div>

            <footer className="pluse-todo-detail-actions">
              {selectedTodo.deleted ? (
                <button
                  type="button"
                  className="pluse-button pluse-button-ghost"
                  onClick={() => void handleArchiveTodo(selectedTodo, false)}
                >
                  {t('恢复任务')}
                </button>
              ) : (
                <>
                  {todoEditOpen ? (
                    <>
                      <button
                        type="button"
                        className="pluse-button"
                        onClick={() => void handleSaveSelectedTodo()}
                        disabled={todoSaving || !todoDraft.title.trim()}
                      >
                        {todoSaving ? t('保存中…') : t('保存修改')}
                      </button>
                      <button
                        type="button"
                        className="pluse-button pluse-button-ghost"
                        onClick={() => {
                          setTodoDraft({
                            title: selectedTodo.title,
                            waitingInstructions: selectedTodo.waitingInstructions ?? '',
                            description: selectedTodo.description ?? '',
                            dueAt: toDateTimeLocalValue(selectedTodo.dueAt),
                            repeat: selectedTodo.repeat,
                          })
                          setTodoEditOpen(false)
                        }}
                        disabled={todoSaving}
                      >
                        {t('取消')}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="pluse-button pluse-button-ghost"
                      onClick={() => setTodoEditOpen(true)}
                    >
                      {t('编辑')}
                    </button>
                  )}
                  {selectedTodo.status === 'pending' ? (
                    <button
                      type="button"
                      className="pluse-button"
                      onClick={() => void handleUpdateTodo(selectedTodo, { status: 'done' })}
                      disabled={todoSaving}
                    >
                      {selectedTodo.repeat !== 'none' ? t('完成本次') : t('完成任务')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="pluse-button pluse-button-ghost"
                      onClick={() => void handleUpdateTodo(selectedTodo, { status: 'pending' })}
                      disabled={todoSaving}
                    >
                      {t('恢复任务')}
                    </button>
                  )}
                  <button
                    type="button"
                    className="pluse-button pluse-button-ghost"
                    onClick={() => void handleArchiveTodo(selectedTodo, true)}
                    disabled={todoSaving}
                  >
                    {t('归档任务')}
                  </button>
                </>
              )}
            </footer>
          </section>
        </div>,
        modalRoot,
      ) : null}
    </>
  )
}

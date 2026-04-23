import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation, useNavigate, type Location as RouterLocation } from 'react-router-dom'
import type { Project, Quest, Todo, UpdateTodoInput } from '@pluse/types'
import * as api from '@/api/client'
import { useI18n } from '@/i18n'
import { useSseEvent } from '@/views/hooks/useSseEvent'
import { displayTaskName } from '@/views/utils/display'
import { formatTodoDueAt, formatTodoRepeat, fromDateTimeLocalValue, toDateTimeLocalValue } from '@/views/utils/todo'
import { ArchiveIcon, CheckIcon, ClockIcon, CloseIcon, PlayIcon, PlusIcon, RouteIcon, SparkIcon } from './icons'
import { TaskComposerModal, type TaskComposerKind } from './TaskComposerModal'

interface TodoPanelProps {
  projectId: string | null
  projectName?: string | null
  projectWorkDir?: string | null
  projects: Project[]
  activeQuestId?: string | null
  onSelectProject?: (projectId: string) => void
  onRequestClose?: () => void
  onDataChanged?: () => Promise<void> | void
}

type ScopeTab = 'global' | 'project'
type SourceTab = 'human' | 'ai'
type AutomationSectionKey = 'running' | 'attention' | 'recurring' | 'scheduled' | 'manual'

type RailTaskItem =
  | { entityType: 'quest'; quest: Quest; archived: boolean }
  | { entityType: 'todo'; todo: Todo; archived: boolean }

function taskOverlayState(location: RouterLocation): { backgroundLocation: RouterLocation } {
  // If already in an overlay, reuse the existing background to avoid nesting overlays
  const existingBackground = (location.state as { backgroundLocation?: RouterLocation } | null)?.backgroundLocation
  return { backgroundLocation: existingBackground ?? location }
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
  if (status === 'pending') return t ? t('待触发') : '待触发'
  if (status === 'done') return t ? t('已执行') : '已执行'
  if (status === 'failed') return t ? t('失败') : '失败'
  if (status === 'cancelled') return t ? t('已取消') : '已取消'
  return t ? t('待触发') : '待触发'
}

function todoStatusLabel(status: Todo['status'], t?: (key: string) => string): string {
  if (status === 'done') return t ? t('已完成') : '已完成'
  if (status === 'cancelled') return t ? t('已取消') : '已取消'
  return t ? t('待处理') : '待处理'
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
}): { tasks: Quest[]; archivedTasks: Quest[]; todos: Todo[]; archivedTodos: Todo[] } {
  if (params.scope === 'global') {
    return {
      tasks: params.globalTasks,
      archivedTasks: params.globalArchivedTasks,
      todos: params.globalTodos,
      archivedTodos: params.globalArchivedTodos,
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
  _scope: ScopeTab,
  source: SourceTab,
  t?: (key: string) => string,
): string {
  return source === 'ai'
    ? (t ? t('当前范围暂无自动化。') : '当前范围暂无自动化。')
    : (t ? t('当前范围暂无待办。') : '当前范围暂无待办。')
}

function automationSectionKey(quest: Quest): AutomationSectionKey {
  if (quest.activeRunId || quest.status === 'running') return 'running'
  if (quest.status === 'failed' || quest.status === 'cancelled') return 'attention'
  if (quest.scheduleKind === 'recurring') return 'recurring'
  if (quest.scheduleKind === 'scheduled') return 'scheduled'
  return 'manual'
}

function automationSectionLabel(key: AutomationSectionKey, t: (key: string) => string): string {
  if (key === 'running') return t('运行中')
  if (key === 'attention') return t('异常')
  if (key === 'recurring') return t('周期')
  if (key === 'scheduled') return t('定时')
  return t('手动')
}

function buildAutomationSections(tasks: Quest[]): Array<{ key: AutomationSectionKey; items: Quest[] }> {
  const order: AutomationSectionKey[] = ['running', 'attention', 'recurring', 'scheduled', 'manual']
  const grouped = new Map<AutomationSectionKey, Quest[]>()
  for (const quest of sortByUpdatedAt(tasks)) {
    const key = automationSectionKey(quest)
    grouped.set(key, [...(grouped.get(key) ?? []), quest])
  }
  return order
    .map((key) => ({ key, items: grouped.get(key) ?? [] }))
    .filter((entry) => entry.items.length > 0)
}

function groupTodosByProject(
  todos: Todo[],
  projects: Project[],
  t: (key: string) => string,
): Array<{ key: string; label: string; items: Todo[] }> {
  const projectMap = new Map(projects.map((project) => [project.id, project] as const))
  const groups = new Map<string, Todo[]>()

  for (const todo of todos) {
    groups.set(todo.projectId, [...(groups.get(todo.projectId) ?? []), todo])
  }

  return Array.from(groups.entries())
    .sort(([leftId], [rightId]) => {
      const left = projectMap.get(leftId)
      const right = projectMap.get(rightId)
      if (left && right) return left.name.localeCompare(right.name, 'zh-Hans-CN')
      if (left) return -1
      if (right) return 1
      return leftId.localeCompare(rightId)
    })
    .map(([projectId, items]) => ({
      key: projectId,
      label: projectMap.get(projectId)?.name ?? `${t('项目')} ${projectId}`,
      items,
    }))
}

const QuestRailItem = memo(function QuestRailItem({
  quest,
  archived,
  activeQuestId,
  locale,
  t,
  questLinkState,
  onRequestClose,
  onTriggerQuest,
  onArchiveQuest,
}: {
  quest: Quest
  archived: boolean
  activeQuestId?: string | null
  locale: string
  t: (key: string, values?: Record<string, string | number>) => string
  questLinkState: { backgroundLocation: RouterLocation }
  onRequestClose?: () => void
  onTriggerQuest: (quest: Quest) => void
  onArchiveQuest: (questId: string, archived: boolean) => void
}) {
  const isActive = activeQuestId === quest.id
  const canTrigger = !archived && !quest.activeRunId && quest.enabled !== false

  return (
    <article
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
            <span className="pluse-task-kind-badge" aria-label={t('自动化')} title={t('自动化')}>
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
              onTriggerQuest(quest)
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
            onArchiveQuest(quest.id, !archived)
          }}
          aria-label={archived ? t('恢复任务') : t('归档任务')}
          title={archived ? t('恢复任务') : t('归档任务')}
        >
          <ArchiveIcon className="pluse-icon" />
        </button>
      </div>
    </article>
  )
})

const TodoRailItem = memo(function TodoRailItem({
  todo,
  archived,
  activeQuestId,
  locale,
  t,
  onOpenTodo,
  onToggleTodoStatus,
  onArchiveTodo,
  onOpenTodoSource,
  onRequestClose,
}: {
  todo: Todo
  archived: boolean
  activeQuestId?: string | null
  locale: string
  t: (key: string, values?: Record<string, string | number>) => string
  onOpenTodo: (todoId: string) => void
  onToggleTodoStatus: (todo: Todo, nextStatus: Todo['status']) => void
  onArchiveTodo: (todo: Todo, archived: boolean) => void
  onOpenTodoSource: () => void
  onRequestClose?: () => void
}) {
  const hasSource = Boolean(todo.originQuestId)
  const isActive = hasSource && todo.originQuestId === activeQuestId
  const isDone = todo.status === 'done'
  const isRecurring = todo.repeat !== 'none'
  const canToggle = !archived && todo.status !== 'cancelled'
  const visibleTags = todo.tags.slice(0, 3)
  const extraTagCount = Math.max(0, todo.tags.length - visibleTags.length)

  return (
    <article
      className={`pluse-sidebar-item pluse-sidebar-row pluse-task-list-item is-todo${isActive ? ' is-active' : ''}${archived ? ' is-archived' : ''}${isDone ? ' is-done' : ''}`}
    >
      <button
        type="button"
        className={`pluse-todo-toggle${isDone ? ' is-done' : ''}`}
        onClick={() => onToggleTodoStatus(todo, isDone ? 'pending' : 'done')}
        aria-label={isDone ? t('恢复任务') : isRecurring ? t('完成本次') : t('完成任务')}
        title={isDone ? t('恢复任务') : isRecurring ? t('完成本次') : t('完成任务')}
        disabled={!canToggle}
      >
        {isDone ? <CheckIcon className="pluse-icon" /> : null}
      </button>
      <button
        type="button"
        className="pluse-task-list-main pluse-sidebar-item-main-button pluse-task-list-detail-trigger"
        onClick={() => onOpenTodo(todo.id)}
        aria-label={`${t('待办详情')} · ${todo.title}`}
      >
        <div className="pluse-task-list-copy">
          <div className="pluse-sidebar-item-title">
            {todo.priority !== 'normal' ? <span className={`pluse-todo-priority-dot is-${todo.priority}`} aria-label={todo.priority} /> : null}
            <strong>{todo.title}</strong>
          </div>
          <div className="pluse-task-list-meta" title={formatDateTime(todo.updatedAt, locale, t)}>
            <span className={`pluse-task-list-state is-${todo.status}`}>{todoStatusLabel(todo.status, t)}</span>
            <span className="pluse-task-list-dot" aria-hidden="true">·</span>
            <span className="pluse-meta-inline">
              <ClockIcon className="pluse-icon pluse-inline-icon" />
              {formatSidebarTime(todo.updatedAt, t)}
            </span>
          </div>
          {visibleTags.length > 0 ? (
            <div className="pluse-todo-tags" aria-label={t('标签')}>
              {visibleTags.map((tag) => (
                <span key={tag} className="pluse-todo-tag">
                  {tag}
                </span>
              ))}
              {extraTagCount > 0 ? (
                <span className="pluse-todo-tag pluse-todo-tag-more">
                  +{extraTagCount}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </button>
      <div className="pluse-sidebar-item-actions">
        {todo.originQuestId ? (
          <Link
            className={`pluse-sidebar-action-btn pluse-task-source-link${isActive ? ' is-active' : ''}`}
            to={`/quests/${todo.originQuestId}`}
            onClick={() => {
              onOpenTodoSource()
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
            onClick={() => onArchiveTodo(todo, false)}
            aria-label={t('恢复任务')}
            title={t('恢复任务')}
          >
            <ArchiveIcon className="pluse-icon" />
          </button>
        ) : (
          <button
            type="button"
            className="pluse-sidebar-action-btn"
            onClick={() => onArchiveTodo(todo, true)}
            aria-label={t('归档任务')}
            title={t('归档任务')}
          >
            <ArchiveIcon className="pluse-icon" />
          </button>
        )}
      </div>
    </article>
  )
})

export function TodoPanel({
  projectId,
  projectName,
  projects,
  activeQuestId,
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
  })
  const [sectionExpandedByKey, setSectionExpandedByKey] = useState<Record<string, boolean>>({})
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
    priority: 'normal' as Todo['priority'],
    tags: [] as string[],
    tagInput: '',
  })
  const [todoSaving, setTodoSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)
  const [filterTags, setFilterTags] = useState<string[]>([])
  const [projectTags, setProjectTags] = useState<string[]>([])
  const reloadTimerRef = useRef<number | null>(null)
  const pendingDataReloadRef = useRef(false)
  const dataRequestSeqRef = useRef(0)

  const loadData = useCallback(async () => {
    const requestId = dataRequestSeqRef.current + 1
    dataRequestSeqRef.current = requestId
    const [globalTaskResult, globalArchivedTaskResult, globalTodoResult, globalArchivedTodoResult] = await Promise.all([
      api.getQuests({ kind: 'task', deleted: false }),
      api.getQuests({ kind: 'task', deleted: true }),
      api.getTodos({ deleted: false }),
      api.getTodos({ deleted: true }),
    ])
    if (requestId !== dataRequestSeqRef.current) return

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
      setProjectTags([])
      setError(null)
      return
    }

    const [taskResult, archivedTaskResult, todoResult, archivedTodoResult] = await Promise.all([
      api.getQuests({ projectId, kind: 'task', deleted: false }),
      api.getQuests({ projectId, kind: 'task', deleted: true }),
      api.getTodos({ projectId, deleted: false }),
      api.getTodos({ projectId, deleted: true }),
    ])
    if (requestId !== dataRequestSeqRef.current) return

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

    const tagsResult = await api.getProjectTags(projectId)
    if (requestId !== dataRequestSeqRef.current) return
    if (tagsResult.ok) setProjectTags(tagsResult.data.tags)
  }, [projectId])

  function setSourceTab(tab: ScopeTab, source: SourceTab) {
    setScopeModes((current) => ({ ...current, [tab]: source }))
  }

  function isSectionExpanded(key: string, defaultExpanded = true): boolean {
    return sectionExpandedByKey[key] ?? defaultExpanded
  }

  function toggleSectionExpanded(key: string, defaultExpanded = true): void {
    setSectionExpandedByKey((current) => ({
      ...current,
      [key]: !(current[key] ?? defaultExpanded),
    }))
  }

  useEffect(() => {
    void loadData()
    return () => {
      dataRequestSeqRef.current += 1
    }
  }, [loadData, projectId, reloadTick])

  useEffect(() => {
    return () => {
      if (reloadTimerRef.current) {
        window.clearTimeout(reloadTimerRef.current)
        reloadTimerRef.current = null
      }
      pendingDataReloadRef.current = false
    }
  }, [])

  useEffect(() => {
    pendingDataReloadRef.current = false
    if (reloadTimerRef.current) {
      window.clearTimeout(reloadTimerRef.current)
      reloadTimerRef.current = null
    }
  }, [projectId])

  useEffect(() => {
    setFilterTags((current) => current.filter((tag) =>
      projectTags.some((projectTag) => projectTag.toLowerCase() === tag.toLowerCase())
    ))
  }, [projectTags])

  useSseEvent(
    (event) => {
      const shouldReloadData = (
        event.type === 'quest_updated'
        || event.type === 'quest_deleted'
        || event.type === 'todo_updated'
        || event.type === 'todo_deleted'
      ) && (projectId == null || event.data.projectId === projectId)
      if (!shouldReloadData) return

      if (shouldReloadData) pendingDataReloadRef.current = true
      if (reloadTimerRef.current) window.clearTimeout(reloadTimerRef.current)
      reloadTimerRef.current = window.setTimeout(() => {
        const nextDataReload = pendingDataReloadRef.current
        pendingDataReloadRef.current = false

        if (nextDataReload) setReloadTick((value) => value + 1)
      }, 300)
    },
    {
      onReconnect: () => {
        pendingDataReloadRef.current = false
        if (reloadTimerRef.current) {
          window.clearTimeout(reloadTimerRef.current)
          reloadTimerRef.current = null
        }
        void loadData()
      },
    },
  )

  const handleUpdateTodo = useCallback(async (todo: Todo, patch: UpdateTodoInput): Promise<boolean> => {
    const result = await api.updateTodo(todo.id, {
      title: patch.title,
      description: patch.description === undefined ? undefined : patch.description ?? null,
      waitingInstructions: patch.waitingInstructions === undefined ? undefined : patch.waitingInstructions ?? null,
      dueAt: patch.dueAt === undefined ? undefined : patch.dueAt ?? null,
      repeat: patch.repeat,
      originQuestId: patch.originQuestId === undefined ? undefined : patch.originQuestId ?? null,
      status: patch.status,
      priority: patch.priority,
      tags: patch.tags,
    })
    if (!result.ok) {
      setError(result.error)
      return false
    }
    await loadData()
    await onDataChanged?.()
    return true
  }, [loadData, onDataChanged])

  const handleArchiveTodo = useCallback(async (todo: Todo, deleted: boolean) => {
    const result = await api.updateTodo(todo.id, { deleted })
    if (!result.ok) {
      setError(result.error)
      return
    }
    await loadData()
    await onDataChanged?.()
  }, [loadData, onDataChanged])

  const handleTriggerQuest = useCallback(async (quest: Quest) => {
    const result = await api.startQuestRun(quest.id, { trigger: 'manual', triggeredBy: 'human' })
    if (!result.ok) {
      setError(result.error)
      return
    }
    await loadData()
    await onDataChanged?.()
  }, [loadData, onDataChanged])

  const handleArchiveQuest = useCallback(async (questId: string, archived: boolean) => {
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
  }, [activeQuestId, archivedTasks, globalArchivedTasks, globalTasks, loadData, navigate, onDataChanged, projectId, t, tasks])

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
    }),
    [scopeTab, tasks, archivedTasks, todos, archivedTodos, globalTasks, globalArchivedTasks, globalTodos, globalArchivedTodos],
  )

  const visibleTodos = useMemo(() => {
    if (sourceTab === 'ai') return []
    const base = scopeData.todos
    if (filterTags.length === 0) return base
    return base.filter((todo) =>
      filterTags.some((ft) => todo.tags.some((tag) => tag.toLowerCase() === ft.toLowerCase()))
    )
  }, [scopeData.todos, sourceTab, filterTags])

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
  const hasActiveTagFilter = filterTags.length > 0

  const humanCount = useMemo(
    () => scopeData.todos.filter((t) => t.status === 'pending').length,
    [scopeData.todos],
  )

  const aiCount = useMemo(
    () => scopeData.tasks.length,
    [scopeData.tasks],
  )

  const openHumanTodos = useMemo(
    () => sortOpenTodos(visibleTodos.filter((todo) => todo.status === 'pending')),
    [visibleTodos],
  )
  const groupedOpenHumanTodos = useMemo(
    () => scopeTab === 'global' ? groupTodosByProject(openHumanTodos, projects, t) : [],
    [scopeTab, openHumanTodos, projects, t],
  )

  const historyHumanTodos = useMemo(
    () => sortByUpdatedAt(visibleTodos.filter((todo) => todo.status !== 'pending')),
    [visibleTodos],
  )
  const groupedHistoryHumanTodos = useMemo(
    () => scopeTab === 'global' ? groupTodosByProject(historyHumanTodos, projects, t) : [],
    [scopeTab, historyHumanTodos, projects, t],
  )

  const automationSections = useMemo(
    () => buildAutomationSections(visibleTasks).map((entry) => ({
      ...entry,
      label: automationSectionLabel(entry.key, t),
    })),
    [t, visibleTasks],
  )

  const visibleArchivedItems = useMemo(
    () => hasActiveTagFilter
      ? []
      : sortRailTaskItems([
          ...createTodoItems(visibleArchivedTodos, true),
          ...createQuestItems(visibleArchivedTasks, true),
        ]),
    [hasActiveTagFilter, visibleArchivedTasks, visibleArchivedTodos],
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

  const questLinkState = useMemo(
    () => taskOverlayState(location),
    [location],
  )
  const historySectionKey = `${scopeTab}:${sourceTab}:todos`
  const historyExpanded = historyExpandedByView[historySectionKey] ?? false
  const hasVisibleContent = (
    openHumanTodos.length > 0
    || historyHumanTodos.length > 0
    || automationSections.length > 0
  )

  useEffect(() => {
    if (!selectedTodo) {
      setTodoEditOpen(false)
      setTodoDraft({
        title: '',
        waitingInstructions: '',
        description: '',
        dueAt: '',
        repeat: 'none',
        priority: 'normal',
        tags: [],
        tagInput: '',
      })
      return
    }
    setTodoDraft({
      title: selectedTodo.title,
      waitingInstructions: selectedTodo.waitingInstructions ?? '',
      description: selectedTodo.description ?? '',
      dueAt: toDateTimeLocalValue(selectedTodo.dueAt),
      repeat: selectedTodo.repeat,
      priority: selectedTodo.priority,
      tags: selectedTodo.tags,
      tagInput: '',
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
      priority: todoDraft.priority,
      tags: todoDraft.tags,
    })
    setTodoSaving(false)
    if (ok) setTodoEditOpen(false)
  }

  const handleOpenTodo = useCallback((todoId: string) => {
    setSelectedTodoId(todoId)
  }, [])

  const handleToggleTodoStatus = useCallback((todo: Todo, nextStatus: Todo['status']) => {
    void handleUpdateTodo(todo, { status: nextStatus })
  }, [handleUpdateTodo])

  const handleOpenTodoSource = useCallback(() => {
    setSelectedTodoId(null)
  }, [])

  return (
    <>
      <aside className="pluse-rail">
        <div className="pluse-mobile-panel-header">
          <button type="button" className="pluse-icon-button" onClick={onRequestClose} aria-label={t('关闭任务面板')} title={t('关闭任务面板')}>
            <CloseIcon className="pluse-icon" />
          </button>
        </div>

        <div className="pluse-rail-head pluse-rail-head-sidebar">
          <div className="pluse-sidebar-project-context">
            <span className="pluse-sidebar-project-context-domain">{`${t('任务栏')}-${t('项目')}`}</span>
            <div className="pluse-project-switcher">
              <button
                type="button"
                className="pluse-project-switcher-btn"
                disabled
                aria-label={t('当前项目')}
                title={t('当前项目')}
              >
                <div className="pluse-project-switcher-label">
                  <strong>{projectName || t('当前项目')}</strong>
                </div>
              </button>
            </div>
          </div>
          <div className="pluse-sidebar-tabs pluse-task-panel-tabs" role="tablist" aria-label={t('任务视图')}>
            <button type="button" className={`pluse-sidebar-tab pluse-task-panel-tab${scopeTab === 'global' ? ' is-active' : ''}`} onClick={() => setScopeTab('global')}>
              {t('全局')}
            </button>
            <button type="button" className={`pluse-sidebar-tab pluse-task-panel-tab${scopeTab === 'project' ? ' is-active' : ''}`} onClick={() => setScopeTab('project')}>
              {t('项目')}
            </button>
          </div>
        </div>

        {projectTags.length > 0 ? (
          <div className="pluse-sidebar-search pluse-todo-tag-filter-row">
            {projectTags.map((tag) => (
              <button
                key={tag}
                type="button"
                className={`pluse-todo-tag-chip${filterTags.includes(tag) ? ' is-active' : ''}`}
                onClick={() => setFilterTags((current) =>
                  current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag]
                )}
              >
                {tag}
              </button>
            ))}
          </div>
        ) : null}

        <div className="pluse-task-list">

          {sourceTab !== 'ai' && scopeTab === 'global' ? (
            <>
              {groupedOpenHumanTodos.map((group) => {
                const sectionKey = `global:human:open:${group.key}`
                const expanded = isSectionExpanded(sectionKey)
                return (
                <section key={`global-open-${group.key}`} className="pluse-domain-group pluse-task-stream">
                  <div className="pluse-domain-group-head">
                    <button
                      type="button"
                      className="pluse-domain-group-toggle"
                      onClick={() => toggleSectionExpanded(sectionKey)}
                    >
                      <span className="pluse-domain-group-chevron" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
                      <div className="pluse-domain-group-copy">
                        <strong>{group.label}</strong>
                        <span>{group.items.length}</span>
                      </div>
                    </button>
                  </div>
                  {expanded ? (
                    <div className="pluse-note-list">
                      {group.items.map((todo) => (
                        <TodoRailItem
                          key={todo.id}
                          todo={todo}
                          archived={false}
                          activeQuestId={activeQuestId}
                          locale={locale}
                          t={t}
                          onOpenTodo={handleOpenTodo}
                          onToggleTodoStatus={handleToggleTodoStatus}
                          onArchiveTodo={handleArchiveTodo}
                          onOpenTodoSource={handleOpenTodoSource}
                          onRequestClose={onRequestClose}
                        />
                      ))}
                    </div>
                  ) : null}
                </section>
                )
              })}

              {groupedHistoryHumanTodos.length > 0 ? (
                <section className="pluse-domain-group pluse-task-history">
                  <div className="pluse-domain-group-head">
                    <button
                      type="button"
                      className="pluse-domain-group-toggle"
                      onClick={() => toggleSectionExpanded('global:human:history', false)}
                    >
                      <span className="pluse-domain-group-chevron" aria-hidden="true">{isSectionExpanded('global:human:history', false) ? '▾' : '▸'}</span>
                      <div className="pluse-domain-group-copy">
                        <strong>{t('历史')}</strong>
                        <span>{historyHumanTodos.length}</span>
                      </div>
                    </button>
                  </div>
                  {isSectionExpanded('global:human:history', false) ? (
                    <div className="pluse-task-history-list">
                      {groupedHistoryHumanTodos.map((group) => {
                        const sectionKey = `global:human:history:${group.key}`
                        const expanded = isSectionExpanded(sectionKey, false)
                        return (
                          <section key={`global-history-${group.key}`} className="pluse-domain-group pluse-task-history">
                            <div className="pluse-domain-group-head">
                              <button
                                type="button"
                                className="pluse-domain-group-toggle"
                                onClick={() => toggleSectionExpanded(sectionKey, false)}
                              >
                                <span className="pluse-domain-group-chevron" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
                                <div className="pluse-domain-group-copy">
                                  <strong>{group.label}</strong>
                                  <span>{group.items.length}</span>
                                </div>
                              </button>
                            </div>
                            {expanded ? (
                              <div className="pluse-note-list pluse-task-history-list">
                                {group.items.map((todo) => (
                                  <TodoRailItem
                                    key={todo.id}
                                    todo={todo}
                                    archived={false}
                                    activeQuestId={activeQuestId}
                                    locale={locale}
                                    t={t}
                                    onOpenTodo={handleOpenTodo}
                                    onToggleTodoStatus={handleToggleTodoStatus}
                                    onArchiveTodo={handleArchiveTodo}
                                    onOpenTodoSource={handleOpenTodoSource}
                                    onRequestClose={onRequestClose}
                                  />
                                ))}
                              </div>
                            ) : null}
                          </section>
                        )
                      })}
                    </div>
                  ) : null}
                </section>
              ) : null}
            </>
          ) : null}

          {sourceTab !== 'ai' && scopeTab !== 'global' && openHumanTodos.length > 0 ? (
            <section className="pluse-domain-group pluse-task-stream">
              <div className="pluse-domain-group-head">
                <button
                  type="button"
                  className="pluse-domain-group-toggle"
                  onClick={() => toggleSectionExpanded(`${scopeTab}:${sourceTab}:open`)}
                >
                  <span className="pluse-domain-group-chevron" aria-hidden="true">{isSectionExpanded(`${scopeTab}:${sourceTab}:open`) ? '▾' : '▸'}</span>
                  <div className="pluse-domain-group-copy">
                    <strong>{t('待办')}</strong>
                    <span>{openHumanTodos.length}</span>
                  </div>
                </button>
              </div>
              {isSectionExpanded(`${scopeTab}:${sourceTab}:open`) ? (
                <div className="pluse-note-list">
                  {openHumanTodos.map((todo) => (
                    <TodoRailItem
                      key={todo.id}
                      todo={todo}
                      archived={false}
                      activeQuestId={activeQuestId}
                      locale={locale}
                      t={t}
                      onOpenTodo={handleOpenTodo}
                      onToggleTodoStatus={handleToggleTodoStatus}
                      onArchiveTodo={handleArchiveTodo}
                      onOpenTodoSource={handleOpenTodoSource}
                      onRequestClose={onRequestClose}
                    />
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}

          {sourceTab !== 'ai' && scopeTab !== 'global' && historyHumanTodos.length > 0 ? (
            <section className="pluse-domain-group pluse-task-history">
              <div className="pluse-domain-group-head">
                <button
                  type="button"
                  className="pluse-domain-group-toggle"
                  onClick={() => setHistoryExpandedByView((current) => ({
                    ...current,
                    [historySectionKey]: !historyExpanded,
                  }))}
                >
                  <span className="pluse-domain-group-chevron" aria-hidden="true">{historyExpanded ? '▾' : '▸'}</span>
                  <div className="pluse-domain-group-copy">
                    <strong>{t('历史')}</strong>
                    <span>{historyHumanTodos.length}</span>
                  </div>
                </button>
              </div>
              {historyExpanded ? (
                <div className="pluse-note-list pluse-task-history-list">
                  {historyHumanTodos.map((todo) => (
                    <TodoRailItem
                      key={todo.id}
                      todo={todo}
                      archived={false}
                      activeQuestId={activeQuestId}
                      locale={locale}
                      t={t}
                      onOpenTodo={handleOpenTodo}
                      onToggleTodoStatus={handleToggleTodoStatus}
                      onArchiveTodo={handleArchiveTodo}
                      onOpenTodoSource={handleOpenTodoSource}
                      onRequestClose={onRequestClose}
                    />
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}

          {sourceTab !== 'human' ? automationSections.map((section) => {
            const sectionKey = `${scopeTab}:${sourceTab}:automation:${section.key}`
            const expanded = isSectionExpanded(sectionKey)
            return (
            <section key={section.key} className="pluse-domain-group pluse-task-stream">
              <div className="pluse-domain-group-head">
                <button
                  type="button"
                  className="pluse-domain-group-toggle"
                  onClick={() => toggleSectionExpanded(sectionKey)}
                >
                  <span className="pluse-domain-group-chevron" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
                  <div className="pluse-domain-group-copy">
                    <strong>{section.label}</strong>
                    <span>{section.items.length}</span>
                  </div>
                </button>
              </div>
              {expanded ? (
                <div className="pluse-note-list">
                  {section.items.map((quest) => (
                    <QuestRailItem
                      key={quest.id}
                      quest={quest}
                      archived={false}
                      activeQuestId={activeQuestId}
                      locale={locale}
                      t={t}
                      questLinkState={questLinkState}
                      onRequestClose={onRequestClose}
                      onTriggerQuest={handleTriggerQuest}
                      onArchiveQuest={handleArchiveQuest}
                    />
                  ))}
                </div>
              ) : null}
            </section>
            )
          }) : null}

          {!hasVisibleContent ? (
            <div className="pluse-rail-empty pluse-task-empty-state">
              <strong>{t('暂无任务')}</strong>
              <p>{formatScopeEmptyMessage(scopeTab, sourceTab, t)}</p>
            </div>
          ) : null}

          {visibleArchivedItems.length > 0 ? (
            <section className="pluse-domain-group pluse-task-archive">
              <div className="pluse-domain-group-head">
                <button
                  type="button"
                  className="pluse-domain-group-toggle"
                  onClick={() => setArchivedExpanded((value) => !value)}
                >
                  <span className="pluse-domain-group-chevron" aria-hidden="true">{archivedExpanded ? '▾' : '▸'}</span>
                  <div className="pluse-domain-group-copy">
                    <strong>{t('归档')}</strong>
                    <span>{visibleArchivedItems.length}</span>
                  </div>
                </button>
              </div>
              {archivedExpanded ? (
                <div className="pluse-note-list" style={{ marginTop: 8 }}>
                  {visibleArchivedItems.map((item) => (
                    item.entityType === 'todo'
                      ? (
                          <TodoRailItem
                            key={item.todo.id}
                            todo={item.todo}
                            archived={item.archived}
                            activeQuestId={activeQuestId}
                            locale={locale}
                            t={t}
                            onOpenTodo={handleOpenTodo}
                            onToggleTodoStatus={handleToggleTodoStatus}
                            onArchiveTodo={handleArchiveTodo}
                            onOpenTodoSource={handleOpenTodoSource}
                            onRequestClose={onRequestClose}
                          />
                        )
                      : (
                          <QuestRailItem
                            key={item.quest.id}
                            quest={item.quest}
                            archived={item.archived}
                            activeQuestId={activeQuestId}
                            locale={locale}
                            t={t}
                            questLinkState={questLinkState}
                            onRequestClose={onRequestClose}
                            onTriggerQuest={handleTriggerQuest}
                            onArchiveQuest={handleArchiveQuest}
                          />
                        )
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}
        </div>

        <section className="pluse-rail-section-new-task">
          <div className="pluse-rail-source-switch" role="tablist" aria-label={t('对象类型')}>
            <button
              type="button"
              className={`pluse-tab pluse-rail-source-tab${sourceTab === 'human' ? ' is-active' : ''}`}
              onClick={() => setSourceTab(scopeTab, 'human')}
            >
              {t('待办')}
              {humanCount > 0 ? <span className="pluse-tab-count">{humanCount}</span> : null}
            </button>
            <button
              type="button"
              className={`pluse-tab pluse-rail-source-tab${sourceTab === 'ai' ? ' is-active' : ''}`}
              onClick={() => setSourceTab(scopeTab, 'ai')}
            >
              {t('自动化')}
              {aiCount > 0 ? <span className="pluse-tab-count">{aiCount}</span> : null}
            </button>
          </div>
          <button
            type="button"
            className="pluse-sidebar-chip-link pluse-sidebar-new-session-card pluse-rail-new-task-card"
            onClick={() => openCreateModal(sourceTab)}
            aria-label={sourceTab === 'human' ? t('新建待办') : t('新建自动化')}
            disabled={!projectId}
          >
            <PlusIcon className="pluse-icon" />
            <span>{sourceTab === 'human' ? t('新建待办') : t('新建自动化')}</span>
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
                <span className="pluse-task-detail-kicker">{t('待办')}</span>
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
                  <div className="pluse-form-field">
                    <span>{t('优先级')}</span>
                    <div className="pluse-priority-selector">
                      {(['urgent', 'high', 'normal', 'low'] as const).map((p) => (
                        <button
                          key={p}
                          type="button"
                          className={`pluse-priority-option is-${p}${todoDraft.priority === p ? ' is-active' : ''}`}
                          onClick={() => setTodoDraft((current) => ({ ...current, priority: p }))}
                        >
                          {p === 'urgent' ? t('紧急') : p === 'high' ? t('高') : p === 'normal' ? t('普通') : t('低')}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="pluse-form-field">
                    <span>{t('标签')}</span>
                    <div className="pluse-tags-editor">
                      {todoDraft.tags.map((tag) => (
                        <span key={tag} className="pluse-todo-tag pluse-todo-tag-removable">
                          {tag}
                          <button
                            type="button"
                            className="pluse-todo-tag-remove"
                            onClick={() => setTodoDraft((current) => ({ ...current, tags: current.tags.filter((t) => t !== tag) }))}
                            aria-label={`${t('移除标签')} ${tag}`}
                          >×</button>
                        </span>
                      ))}
                      <input
                        className="pluse-tags-input"
                        value={todoDraft.tagInput}
                        onChange={(event) => setTodoDraft((current) => ({ ...current, tagInput: event.target.value }))}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ',') {
                            event.preventDefault()
                            const newTag = todoDraft.tagInput.trim().replace(/,+$/, '')
                            if (newTag && !todoDraft.tags.some((t) => t.toLowerCase() === newTag.toLowerCase())) {
                              setTodoDraft((current) => ({ ...current, tags: [...current.tags, newTag], tagInput: '' }))
                            } else {
                              setTodoDraft((current) => ({ ...current, tagInput: '' }))
                            }
                          } else if (event.key === 'Backspace' && !todoDraft.tagInput && todoDraft.tags.length > 0) {
                            setTodoDraft((current) => ({ ...current, tags: current.tags.slice(0, -1) }))
                          }
                        }}
                        placeholder={todoDraft.tags.length === 0 ? t('输入标签，回车确认') : ''}
                        list="pluse-project-tags-datalist"
                      />
                      <datalist id="pluse-project-tags-datalist">
                        {projectTags.filter((tag) => !todoDraft.tags.includes(tag)).map((tag) => (
                          <option key={tag} value={tag} />
                        ))}
                      </datalist>
                    </div>
                  </div>
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
                  {(selectedTodo.priority !== 'normal' || selectedTodo.tags.length > 0) ? (
                    <section className="pluse-todo-detail-section">
                      <div className="pluse-todo-detail-pills">
                        {selectedTodo.priority !== 'normal' ? (
                          <span className={`pluse-sidebar-badge pluse-priority-badge is-${selectedTodo.priority}`}>
                            {selectedTodo.priority === 'urgent' ? t('紧急') : selectedTodo.priority === 'high' ? t('高优先级') : t('低优先级')}
                          </span>
                        ) : null}
                        {selectedTodo.tags.map((tag) => (
                          <span key={tag} className="pluse-todo-tag">{tag}</span>
                        ))}
                      </div>
                    </section>
                  ) : null}
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
                            priority: selectedTodo.priority,
                            tags: selectedTodo.tags,
                            tagInput: '',
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

import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, type Location as RouterLocation } from 'react-router-dom'
import type { Quest, Todo } from '@pluse/types'
import * as api from '@/api/client'
import { displayTaskName } from '@/views/utils/display'
import { ArchiveIcon, CheckIcon, ClockIcon, CloseIcon, PlayIcon, PlusIcon, SparkIcon, TrashIcon, UserIcon } from './icons'
import { TaskComposerModal, type TaskComposerKind } from './TaskComposerModal'

interface TodoPanelProps {
  projectId: string | null
  projectName?: string | null
  activeQuestId?: string | null
  onRequestClose?: () => void
  onDataChanged?: () => Promise<void> | void
}

type TaskTab = 'all' | 'human' | 'ai'

function taskOverlayState(location: RouterLocation): { backgroundLocation: RouterLocation } {
  return { backgroundLocation: location }
}

function formatDateTime(value?: string): string {
  if (!value) return '未记录'
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatSidebarTime(value?: string): string {
  if (!value) return ''
  const timestamp = new Date(value).getTime()
  const delta = Math.max(0, Date.now() - timestamp)
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour
  const week = 7 * day
  if (delta < minute) return '刚刚'
  if (delta < hour) return `${Math.max(1, Math.floor(delta / minute))} 分钟`
  if (delta < day) return `${Math.max(1, Math.floor(delta / hour))} 小时`
  if (delta < week) return `${Math.max(1, Math.floor(delta / day))} 天`
  return `${Math.max(1, Math.floor(delta / week))} 周`
}

function taskLabel(quest: Quest): string {
  return displayTaskName(quest.title || quest.name)
}

function taskStatusLabel(status?: Quest['status']): string {
  if (status === 'running') return '运行中'
  if (status === 'pending') return '待处理'
  if (status === 'done') return '已完成'
  if (status === 'failed') return '失败'
  if (status === 'cancelled') return '已取消'
  return '待处理'
}

function todoStatusLabel(status: Todo['status']): string {
  if (status === 'done') return '已完成'
  if (status === 'cancelled') return '已取消'
  return '待处理'
}

function isClosedQuest(quest: Quest): boolean {
  return quest.status === 'done' || quest.status === 'failed' || quest.status === 'cancelled'
}

function sortByUpdatedAt<T extends { updatedAt: string }>(items: T[]): T[] {
  return [...items].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
}

function isTodoItem(item: Quest | Todo): item is Todo {
  return 'originQuestId' in item
}

export function TodoPanel({ projectId, projectName, activeQuestId, onRequestClose, onDataChanged }: TodoPanelProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const [tasks, setTasks] = useState<Quest[]>([])
  const [archivedTasks, setArchivedTasks] = useState<Quest[]>([])
  const [todos, setTodos] = useState<Todo[]>([])
  const [tab, setTab] = useState<TaskTab>('all')
  const [archivedExpanded, setArchivedExpanded] = useState(false)
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [createModalKind, setCreateModalKind] = useState<TaskComposerKind>('human')
  const [error, setError] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)

  async function loadData() {
    if (!projectId) {
      setTasks([])
      setArchivedTasks([])
      setTodos([])
      return
    }

    const [taskResult, archivedTaskResult, todoResult] = await Promise.all([
      api.getQuests({ projectId, kind: 'task', deleted: false }),
      api.getQuests({ projectId, kind: 'task', deleted: true }),
      api.getTodos({ projectId }),
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

    setTasks(taskResult.data)
    setArchivedTasks(archivedTaskResult.data)
    setTodos(todoResult.data)
    setError(null)
  }

  useEffect(() => {
    void loadData()
  }, [projectId, reloadTick])

  useEffect(() => {
    if (!projectId) return
    const source = new EventSource(`/api/events?projectId=${encodeURIComponent(projectId)}`)
    source.onmessage = () => {
      setReloadTick((value) => value + 1)
    }
    return () => source.close()
  }, [projectId])

  async function handleUpdateTodo(todo: Todo, patch: Partial<Todo>) {
    const result = await api.updateTodo(todo.id, {
      title: patch.title,
      description: patch.description === undefined ? undefined : patch.description ?? null,
      waitingInstructions: patch.waitingInstructions === undefined ? undefined : patch.waitingInstructions ?? null,
      originQuestId: patch.originQuestId === undefined ? undefined : patch.originQuestId ?? null,
      status: patch.status,
    })
    if (!result.ok) {
      setError(result.error)
      return
    }
    await loadData()
    await onDataChanged?.()
  }

  async function handleDeleteTodo(todo: Todo) {
    if (!window.confirm(`删除任务“${todo.title}”？`)) return
    const result = await api.deleteTodo(todo.id)
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
    const quest = [...tasks, ...archivedTasks].find((item) => item.id === questId)
    if (!quest) return
    if (archived && quest.activeRunId) {
      const confirmed = window.confirm('当前任务正在运行，归档前会先取消当前执行。继续吗？')
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
        setError('当前执行尚未完全停止，请稍后再试')
        return
      }
    }
    const result = await api.updateQuest(questId, { deleted: archived })
    if (!result.ok) {
      setError(result.error)
      return
    }
    if (archived && activeQuestId === questId && projectId) {
      const index = tasks.findIndex((quest) => quest.id === questId)
      const nextQuest = index >= 0 ? (tasks[index + 1] || tasks[index - 1]) : null
      if (nextQuest) navigate(`/quests/${nextQuest.id}`)
      else navigate(`/projects/${projectId}`)
    }
    await loadData()
    await onDataChanged?.()
  }

  async function handleDeleteQuest(questId: string) {
    const result = await api.deleteQuest(questId)
    if (!result.ok) {
      setError(result.error)
      return
    }
    if (activeQuestId === questId && projectId) {
      const index = tasks.findIndex((quest) => quest.id === questId)
      const nextQuest = index >= 0 ? (tasks[index + 1] || tasks[index - 1]) : null
      if (nextQuest) navigate(`/quests/${nextQuest.id}`)
      else navigate(`/projects/${projectId}`)
    }
    await loadData()
    await onDataChanged?.()
  }

  const visibleTodos = useMemo(
    () => tab === 'ai' ? [] : todos,
    [todos, tab],
  )

  const visibleTasks = useMemo(
    () => tab === 'human' ? [] : tasks,
    [tasks, tab],
  )

  const visibleArchivedTasks = useMemo(
    () => sortByUpdatedAt(tab === 'human' ? [] : archivedTasks),
    [archivedTasks, tab],
  )

  const openHumanTodos = useMemo(
    () => sortByUpdatedAt(visibleTodos.filter((todo) => todo.status === 'pending')),
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

  const visibleItems = useMemo(
    () => sortByUpdatedAt([
      ...openHumanTodos,
      ...openAiTasks,
      ...historyHumanTodos,
      ...historyAiTasks,
    ]),
    [openHumanTodos, openAiTasks, historyHumanTodos, historyAiTasks],
  )

  const counts = useMemo(
    () => ({
      all: tasks.length + todos.length,
      human: todos.length,
      ai: tasks.length,
      pending: openHumanTodos.length + openAiTasks.length,
      done: historyHumanTodos.length + historyAiTasks.length,
    }),
    [tasks.length, todos.length, openHumanTodos.length, openAiTasks.length, historyHumanTodos.length, historyAiTasks.length],
  )

  const questLinkState = taskOverlayState(location)

  function openCreateModal(kind: TaskComposerKind) {
    setCreateModalKind(kind)
    setCreateModalOpen(true)
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
              <span className="pluse-task-kind-badge" aria-label="AI 任务" title="AI 任务">
                <SparkIcon className="pluse-icon" />
              </span>
              <strong>{taskLabel(quest)}</strong>
            </div>
            <div className="pluse-task-list-meta" title={formatDateTime(quest.updatedAt)}>
              <span className={`pluse-task-list-state is-${quest.activeRunId ? 'running' : quest.status ?? 'pending'}`}>
                {quest.activeRunId ? '运行中' : taskStatusLabel(quest.status)}
              </span>
              <span className="pluse-task-list-dot" aria-hidden="true">·</span>
              <span className="pluse-meta-inline">
                <ClockIcon className="pluse-icon pluse-inline-icon" />
                {formatSidebarTime(quest.updatedAt)}
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
              aria-label="立即触发"
              title="立即触发"
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
            aria-label={archived ? '恢复任务' : '归档任务'}
            title={archived ? '恢复任务' : '归档任务'}
          >
            <ArchiveIcon className="pluse-icon" />
          </button>
          <button
            type="button"
            className="pluse-sidebar-action-btn is-danger"
            onClick={(event) => {
              event.preventDefault()
              void handleDeleteQuest(quest.id)
            }}
            aria-label="删除任务"
            title="删除任务"
          >
            <TrashIcon className="pluse-icon" />
          </button>
        </div>
      </article>
    )
  }

  function renderTodoItem(todo: Todo) {
    const hasSource = Boolean(todo.originQuestId)
    const isActive = hasSource && todo.originQuestId === activeQuestId
    return (
      <article
        key={todo.id}
        className={`pluse-sidebar-item pluse-sidebar-row pluse-task-list-item${isActive ? ' is-active' : ''}`}
      >
        <div className="pluse-sidebar-item-main pluse-task-list-main">
          <div className="pluse-task-list-copy">
            <div className="pluse-sidebar-item-title">
              <span className="pluse-task-kind-badge" aria-label="人类任务" title="人类任务">
                <UserIcon className="pluse-icon" />
              </span>
              <strong>{todo.title}</strong>
            </div>
            <div className="pluse-task-list-meta" title={formatDateTime(todo.updatedAt)}>
              <span className={`pluse-task-list-state is-${todo.status}`}>{todoStatusLabel(todo.status)}</span>
              <span className="pluse-task-list-dot" aria-hidden="true">·</span>
              <span className="pluse-meta-inline">
                <ClockIcon className="pluse-icon pluse-inline-icon" />
                {formatSidebarTime(todo.updatedAt)}
              </span>
            </div>
          </div>
        </div>
        <div className="pluse-sidebar-item-actions">
          {todo.originQuestId ? (
            <Link
              className="pluse-sidebar-chip-link pluse-sidebar-chip-link-sm"
              to={`/quests/${todo.originQuestId}`}
              onClick={() => onRequestClose?.()}
            >
              来源
            </Link>
          ) : null}
          {todo.status === 'pending' ? (
            <button
              type="button"
              className="pluse-sidebar-action-btn"
              onClick={() => void handleUpdateTodo(todo, { status: 'done' })}
              aria-label="完成任务"
              title="完成任务"
            >
              <CheckIcon className="pluse-icon" />
            </button>
          ) : (
            <button
              type="button"
              className="pluse-sidebar-action-btn"
              onClick={() => void handleUpdateTodo(todo, { status: 'pending' })}
              aria-label="恢复任务"
              title="恢复任务"
            >
              <PlusIcon className="pluse-icon" />
            </button>
          )}
          <button
            type="button"
            className="pluse-sidebar-action-btn is-danger"
            onClick={() => void handleDeleteTodo(todo)}
            aria-label="删除任务"
            title="删除任务"
          >
            <TrashIcon className="pluse-icon" />
          </button>
        </div>
      </article>
    )
  }

  return (
    <>
      <aside className="pluse-rail">
        <div className="pluse-mobile-panel-header">
          <button type="button" className="pluse-icon-button" onClick={onRequestClose} aria-label="关闭任务面板">
            <CloseIcon className="pluse-icon" />
          </button>
        </div>

        <div className="pluse-rail-head pluse-rail-head-rich">
          <div className="pluse-rail-kicker">任务</div>
          <div className="pluse-rail-head-row">
            <div className="pluse-rail-head-info">
              <span className="pluse-rail-head-label">{projectName || '当前项目'}</span>
              <span className="pluse-rail-head-count">{counts[tab]}</span>
            </div>
          </div>
          <div className="pluse-rail-tabs">
            <button type="button" className={`pluse-tab${tab === 'all' ? ' is-active' : ''}`} onClick={() => setTab('all')}>
              全部
              <span className="pluse-tab-count">{counts.all}</span>
            </button>
            <button type="button" className={`pluse-tab${tab === 'human' ? ' is-active' : ''}`} onClick={() => setTab('human')}>
              人类
              <span className="pluse-tab-count">{counts.human}</span>
            </button>
            <button type="button" className={`pluse-tab${tab === 'ai' ? ' is-active' : ''}`} onClick={() => setTab('ai')}>
              AI
              <span className="pluse-tab-count">{counts.ai}</span>
            </button>
          </div>
        </div>

        <div className="pluse-task-list">
          {visibleItems.length > 0 ? (
            <div className="pluse-note-list pluse-task-stream">
              {visibleItems.map((item) => (isTodoItem(item) ? renderTodoItem(item) : renderQuestItem(item)))}
            </div>
          ) : (
            <div className="pluse-rail-empty pluse-task-empty-state">
              <strong>暂无任务</strong>
              <p>{tab === 'ai' ? '新建 AI。' : tab === 'human' ? '记录待办。' : '统一展示。'}</p>
            </div>
          )}

          {visibleArchivedTasks.length > 0 ? (
            <section className="pluse-task-archive">
              <button
                type="button"
                className="pluse-sidebar-archive-toggle"
                onClick={() => setArchivedExpanded((value) => !value)}
              >
                <span>{archivedExpanded ? '▾' : '▸'} 归档任务 ({visibleArchivedTasks.length})</span>
              </button>
              {archivedExpanded ? (
                <div className="pluse-note-list" style={{ marginTop: 8 }}>
                  {visibleArchivedTasks.map((quest) => renderQuestItem(quest, true))}
                </div>
              ) : null}
            </section>
          ) : null}
        </div>

        <section className="pluse-rail-section-new-task">
          <button
            type="button"
            className="pluse-sidebar-chip-link pluse-sidebar-new-session-card pluse-rail-new-task-card"
            onClick={() => openCreateModal(tab === 'ai' ? 'ai' : 'human')}
            aria-label="新建任务"
            disabled={!projectId}
          >
            <PlusIcon className="pluse-icon" />
            <span>新建任务</span>
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
    </>
  )
}

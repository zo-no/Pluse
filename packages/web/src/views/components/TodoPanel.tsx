import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, type Location as RouterLocation } from 'react-router-dom'
import type { Quest, Todo } from '@pluse/types'
import * as api from '@/api/client'
import { displayTaskName } from '@/views/utils/display'
import { ArchiveIcon, CheckIcon, CloseIcon, PlusIcon, SparkIcon, TrashIcon, UserIcon } from './icons'
import { TaskComposerModal, type TaskComposerKind } from './TaskComposerModal'

interface TodoPanelProps {
  projectId: string | null
  projectName?: string | null
  activeQuestId?: string | null
  onRequestClose?: () => void
  onDataChanged?: () => Promise<void> | void
}

type TaskTab = 'all' | 'human' | 'ai'

function taskOverlayState(location: RouterLocation, fallbackPath?: string | null): { backgroundLocation: RouterLocation } {
  const state = location.state as { backgroundLocation?: RouterLocation } | null
  if (state?.backgroundLocation) return { backgroundLocation: state.backgroundLocation }
  if (fallbackPath && location.pathname.startsWith('/quests/')) {
    return {
      backgroundLocation: {
        ...location,
        pathname: fallbackPath,
        search: '',
        hash: '',
        state: null,
      },
    }
  }
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

function taskLabel(quest: Quest): string {
  return displayTaskName(quest.title || quest.name)
}

function taskSummary(quest: Quest): string {
  return quest.description || ''
}

function todoSummary(todo: Todo): string {
  return todo.waitingInstructions || todo.description || ''
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

  const questLinkState = taskOverlayState(location, projectId ? `/projects/${projectId}` : null)

  function openCreateModal(kind: TaskComposerKind) {
    setCreateModalKind(kind)
    setCreateModalOpen(true)
  }

  function renderQuestItem(quest: Quest, archived = false) {
    const isActive = activeQuestId === quest.id
    return (
      <article
        key={quest.id}
        className={`pluse-note-item pluse-task-line pluse-task-compact${isActive ? ' is-active' : ''}`}
      >
        <Link
          className="pluse-task-line-main"
          to={`/quests/${quest.id}`}
          state={questLinkState}
          onClick={() => onRequestClose?.()}
        >
          <strong>{taskLabel(quest)}</strong>
          {taskSummary(quest) ? <span>{taskSummary(quest)}</span> : null}
        </Link>
        <div className="pluse-task-line-meta">
          <span className="pluse-sidebar-badge" aria-label="AI 任务" title="AI 任务">
            <SparkIcon className="pluse-icon" />
          </span>
          <span className={`pluse-task-status is-${quest.status ?? 'pending'}`}>{taskStatusLabel(quest.status)}</span>
          <span className="pluse-output-row-meta">
            {quest.activeRunId ? <span className="pluse-sidebar-badge is-running">运行中</span> : null}
            <span>{formatDateTime(quest.updatedAt)}</span>
          </span>
          <div className="pluse-task-line-actions">
            <button
              type="button"
              className="pluse-row-action"
              onClick={() => void handleArchiveQuest(quest.id, !archived)}
              aria-label={archived ? '恢复任务' : '归档任务'}
              title={archived ? '恢复任务' : '归档任务'}
            >
              <ArchiveIcon className="pluse-icon" />
            </button>
            <button
              type="button"
              className="pluse-row-action"
              onClick={() => void handleDeleteQuest(quest.id)}
              aria-label="删除任务"
              title="删除任务"
            >
              <TrashIcon className="pluse-icon" />
            </button>
          </div>
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
        className={`pluse-note-item pluse-task-line pluse-task-compact${isActive ? ' is-active' : ''}`}
      >
        <div className="pluse-task-line-main">
          <strong>{todo.title}</strong>
          {todoSummary(todo) ? <span>{todoSummary(todo)}</span> : null}
        </div>
        <div className="pluse-task-line-meta">
          <span className="pluse-sidebar-badge" aria-label="人类任务" title="人类任务">
            <UserIcon className="pluse-icon" />
          </span>
          <span className={`pluse-task-status is-${todo.status}`}>{todoStatusLabel(todo.status)}</span>
          <span className="pluse-output-row-meta">
            <span>{formatDateTime(todo.updatedAt)}</span>
            {todo.originQuestId ? (
              <Link
                className="pluse-sidebar-chip-link pluse-sidebar-chip-link-sm"
                to={`/quests/${todo.originQuestId}`}
                onClick={() => onRequestClose?.()}
              >
                来源
              </Link>
            ) : null}
          </span>
          <div className="pluse-task-line-actions">
            {todo.status === 'pending' ? (
              <button
                type="button"
                className="pluse-row-action"
                onClick={() => void handleUpdateTodo(todo, { status: 'done' })}
                aria-label="完成任务"
                title="完成任务"
              >
                <CheckIcon className="pluse-icon" />
              </button>
            ) : (
              <button
                type="button"
                className="pluse-row-action"
                onClick={() => void handleUpdateTodo(todo, { status: 'pending' })}
                aria-label="恢复任务"
                title="恢复任务"
              >
                <PlusIcon className="pluse-icon" />
              </button>
            )}
            <button
              type="button"
              className="pluse-row-action"
              onClick={() => void handleDeleteTodo(todo)}
              aria-label="删除任务"
              title="删除任务"
            >
              <TrashIcon className="pluse-icon" />
            </button>
          </div>
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
            <button
              type="button"
              className="pluse-icon-button pluse-rail-create-btn"
              onClick={() => openCreateModal(tab === 'ai' ? 'ai' : 'human')}
              aria-label="创建任务"
              title="创建任务"
              disabled={!projectId}
            >
              <PlusIcon className="pluse-icon" />
            </button>
          </div>
          <div className="pluse-rail-summary">
            <span>进行中 {counts.pending}</span>
            <span>已完成 {counts.done}</span>
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
              <strong>还没有任务</strong>
              <p>{tab === 'ai' ? '从这里新建一个 AI 任务。' : tab === 'human' ? '记录一条人类任务。' : 'AI 任务和人类任务会统一出现在这里。'}</p>
              <button
                type="button"
                className="pluse-button pluse-task-empty-action"
                onClick={() => openCreateModal(tab === 'ai' ? 'ai' : 'human')}
                disabled={!projectId}
              >
                <PlusIcon className="pluse-icon" />
                新建任务
              </button>
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

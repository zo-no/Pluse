import { useEffect, useState, type FormEvent } from 'react'
import { useLocation, useNavigate, type Location as RouterLocation } from 'react-router-dom'
import * as api from '@/api/client'
import { CloseIcon, SparkIcon, UserIcon } from './icons'

export type TaskComposerKind = 'human' | 'ai'

interface TaskComposerModalProps {
  open: boolean
  projectId: string | null
  projectName?: string | null
  initialKind?: TaskComposerKind
  originQuestId?: string | null
  originQuestLabel?: string | null
  onClose: () => void
  onCreated?: (result: { kind: TaskComposerKind; id: string }) => Promise<void> | void
}

function defaultTitle(kind: TaskComposerKind): string {
  return kind === 'ai' ? '新 AI 任务' : '新任务'
}

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

export function TaskComposerModal({
  open,
  projectId,
  projectName,
  initialKind = 'human',
  originQuestId,
  originQuestLabel,
  onClose,
  onCreated,
}: TaskComposerModalProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const [kind, setKind] = useState<TaskComposerKind>(initialKind)
  const [title, setTitle] = useState('')
  const [instructions, setInstructions] = useState('')
  const [description, setDescription] = useState('')
  const [continueQuest, setContinueQuest] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setKind(initialKind)
    setTitle('')
    setInstructions('')
    setDescription('')
    setContinueQuest(true)
    setError(null)
  }, [open, initialKind, originQuestId])

  useEffect(() => {
    if (!open) return
    document.body.classList.add('pluse-modal-open')
    function handleKeydown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !saving) onClose()
    }
    window.addEventListener('keydown', handleKeydown)
    return () => {
      document.body.classList.remove('pluse-modal-open')
      window.removeEventListener('keydown', handleKeydown)
    }
  }, [open, saving, onClose])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!projectId || !title.trim() || saving) return
    setSaving(true)
    setError(null)

    if (kind === 'ai') {
      const result = await api.createQuest({
        projectId,
        kind: 'task',
        createdBy: 'human',
        tool: 'codex',
        title: title.trim() || defaultTitle(kind),
        description: description.trim() || undefined,
        status: 'pending',
        enabled: true,
        scheduleKind: 'once',
        executorKind: 'ai_prompt',
        executorConfig: { prompt: instructions.trim() || '' },
        executorOptions: { continueQuest },
      })
      setSaving(false)
      if (!result.ok) {
        setError(result.error)
        return
      }
      await onCreated?.({ kind, id: result.data.id })
      onClose()
      navigate(`/quests/${result.data.id}`, { state: taskOverlayState(location, projectId ? `/projects/${projectId}` : null) })
      return
    }

    const result = await api.createTodo({
      projectId,
      originQuestId: originQuestId || undefined,
      createdBy: 'human',
      title: title.trim() || defaultTitle(kind),
      description: description.trim() || undefined,
      waitingInstructions: instructions.trim() || undefined,
    })
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    await onCreated?.({ kind, id: result.data.id })
    onClose()
  }

  if (!open) return null

  return (
    <div
      className="pluse-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose()
      }}
    >
      <section
        className="pluse-modal-panel pluse-task-modal-panel"
        role="dialog"
        aria-modal="true"
        aria-label="创建任务"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="pluse-task-modal-head">
          <div className="pluse-task-modal-title">
            <span className="pluse-task-modal-kicker">{projectName || '当前项目'}</span>
            <h2>创建任务</h2>
            <p>{kind === 'ai' ? '让 AI 持续执行一件事。' : '记录需要人完成的下一步。'}</p>
          </div>
          <button type="button" className="pluse-icon-button" onClick={onClose} aria-label="关闭" disabled={saving}>
            <CloseIcon className="pluse-icon" />
          </button>
        </header>

        <form className="pluse-task-modal-body" onSubmit={handleSubmit}>
          <div className="pluse-task-modal-modes" role="tablist" aria-label="任务类型">
            <button
              type="button"
              className={`pluse-task-modal-mode${kind === 'human' ? ' is-active' : ''}`}
              onClick={() => setKind('human')}
            >
              <span className="pluse-task-modal-mode-icon">
                <UserIcon className="pluse-icon" />
              </span>
              <span className="pluse-task-modal-mode-copy">
                <strong>人类</strong>
                <span>待办、提醒、线下动作</span>
              </span>
            </button>
            <button
              type="button"
              className={`pluse-task-modal-mode${kind === 'ai' ? ' is-active' : ''}`}
              onClick={() => setKind('ai')}
            >
              <span className="pluse-task-modal-mode-icon">
                <SparkIcon className="pluse-icon" />
              </span>
              <span className="pluse-task-modal-mode-copy">
                <strong>AI</strong>
                <span>提示词、运行、追踪结果</span>
              </span>
            </button>
          </div>

          <div className="pluse-task-modal-grid">
            <label className="pluse-task-modal-field">
              <span>标题</span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={defaultTitle(kind)}
                autoFocus
              />
            </label>

            <label className="pluse-task-modal-field pluse-task-modal-field-span">
              <span>{kind === 'ai' ? '给 AI 的提示' : '等待说明 / 下一步'}</span>
              <textarea
                rows={4}
                value={instructions}
                onChange={(event) => setInstructions(event.target.value)}
                placeholder={kind === 'ai' ? '例如：每天检查 PR 状态并总结风险。' : '例如：等设计确认后补首页插图。'}
              />
            </label>

            <label className="pluse-task-modal-field pluse-task-modal-field-span">
              <span>补充描述</span>
              <textarea
                rows={3}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="上下文、约束、验收标准。"
              />
            </label>
          </div>

          <div className="pluse-task-modal-meta">
            {originQuestId ? (
              <div className="pluse-task-modal-source">
                <span className="pluse-sidebar-badge">
                  {originQuestLabel || '当前会话'}
                </span>
                <small>会关联到当前内容</small>
              </div>
            ) : (
              <div className="pluse-task-modal-source">
                <span className="pluse-sidebar-badge">{projectName || '当前项目'}</span>
                <small>会加入右侧统一任务列表</small>
              </div>
            )}

            {kind === 'ai' ? (
              <div className="pluse-task-modal-switch">
                <button
                  type="button"
                  className={`pluse-tab${continueQuest ? ' is-active' : ''}`}
                  onClick={() => setContinueQuest(true)}
                >
                  继续上下文
                </button>
                <button
                  type="button"
                  className={`pluse-tab${!continueQuest ? ' is-active' : ''}`}
                  onClick={() => setContinueQuest(false)}
                >
                  独立运行
                </button>
              </div>
            ) : null}
          </div>

          {error ? <p className="pluse-error">{error}</p> : null}

          <footer className="pluse-task-modal-actions">
            <button type="button" className="pluse-button pluse-button-ghost" onClick={onClose} disabled={saving}>
              取消
            </button>
            <button type="submit" className="pluse-button" disabled={!projectId || !title.trim() || saving}>
              {saving ? '创建中…' : kind === 'ai' ? '创建 AI 任务' : '创建人类任务'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  )
}

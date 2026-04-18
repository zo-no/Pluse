import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate, type Location as RouterLocation } from 'react-router-dom'
import type { AiPromptConfig, RuntimeModelCatalog, RuntimeTool, ScriptConfig } from '@pluse/types'
import * as api from '@/api/client'
import {
  buildFallbackRuntimeModelCatalog,
  defaultRuntimeEffortId,
  defaultRuntimeModelId,
  resolveRuntimeEffortSelection,
  resolveRuntimeModelSelection,
} from '@/views/utils/runtime'
import { CloseIcon, SparkIcon, UserIcon } from './icons'

export type TaskComposerKind = 'human' | 'ai'

interface TaskComposerModalProps {
  open: boolean
  projectId: string | null
  projectName?: string | null
  initialKind?: TaskComposerKind
  conversionQuestId?: string | null
  conversionQuestName?: string | null
  conversionQuestDescription?: string | null
  conversionPrompt?: string | null
  conversionContinueQuest?: boolean
  originQuestId?: string | null
  originQuestLabel?: string | null
  onClose: () => void
  onCreated?: (result: { kind: TaskComposerKind; id: string }) => Promise<void> | void
}

const FALLBACK_RUNTIME_TOOLS: RuntimeTool[] = [
  { id: 'codex', name: 'Codex', command: 'codex', runtimeFamily: 'codex-json', builtin: true, available: true },
  { id: 'claude', name: 'Claude Code', command: 'claude', runtimeFamily: 'claude-stream-json', builtin: true, available: true },
]

function defaultTitle(kind: TaskComposerKind): string {
  return kind === 'ai' ? '新 AI 任务' : '新任务'
}

function defaultTaskTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

function taskOverlayState(location: RouterLocation): { backgroundLocation: RouterLocation } {
  return { backgroundLocation: location }
}

function buildAiPayload(input: {
  title: string
  description: string
  tool: string
  model: string
  effort: string
  thinking: boolean
  reviewOnComplete: boolean
  continueQuest: boolean
  executorKind: 'ai_prompt' | 'script'
  prompt: string
  command: string
  workDir: string
  envText: string
  timeout: string
  scheduleKind: 'once' | 'scheduled' | 'recurring'
  runAt: string
  cron: string
}): {
  kind: 'task'
  createdBy: 'human'
  tool: string
  model: string | null
  effort: string | null
  thinking: boolean
  title: string
  description?: string
  enabled: boolean
  reviewOnComplete: boolean
  status: 'pending'
  scheduleKind: 'once' | 'scheduled' | 'recurring'
  scheduleConfig: { cron?: string; runAt?: string; timezone?: string } | null
  executorKind: 'ai_prompt' | 'script'
  executorConfig: AiPromptConfig | ScriptConfig
  executorOptions: { continueQuest: boolean; timeout?: number }
} {
  const parsedTimeout = Number(input.timeout)
  const timeoutValue = input.timeout.trim() && Number.isFinite(parsedTimeout) ? parsedTimeout : undefined
  const envEntries = input.envText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const index = line.indexOf('=')
      if (index === -1) return null
      return [line.slice(0, index).trim(), line.slice(index + 1).trim()] as const
    })
    .filter((entry): entry is readonly [string, string] => Boolean(entry && entry[0]))

  const executorConfig: AiPromptConfig | ScriptConfig = input.executorKind === 'script'
    ? {
        command: input.command.trim(),
        workDir: input.workDir.trim() || undefined,
        env: envEntries.length ? Object.fromEntries(envEntries) : undefined,
        timeout: timeoutValue,
      }
    : {
        prompt: input.prompt.trim(),
        agent: input.tool === 'claude' ? 'claude' : 'codex',
        model: input.model || undefined,
      }

  return {
    kind: 'task' as const,
    createdBy: 'human' as const,
    tool: input.tool,
    model: input.model || null,
    effort: input.effort || null,
    thinking: input.thinking,
    title: input.title,
    description: input.description || undefined,
    enabled: true,
    reviewOnComplete: input.reviewOnComplete,
    status: 'pending' as const,
    scheduleKind: input.scheduleKind,
    scheduleConfig: input.scheduleKind === 'scheduled'
      ? { runAt: input.runAt, timezone: defaultTaskTimezone() }
      : input.scheduleKind === 'recurring'
        ? { cron: input.cron, timezone: defaultTaskTimezone() }
        : null,
    executorKind: input.executorKind,
    executorConfig,
    executorOptions: {
      continueQuest: input.continueQuest,
      timeout: input.executorKind === 'ai_prompt' ? timeoutValue : undefined,
    },
  }
}

export function TaskComposerModal({
  open,
  projectId,
  projectName,
  initialKind = 'human',
  conversionQuestId,
  conversionQuestName,
  conversionQuestDescription,
  conversionPrompt,
  conversionContinueQuest = true,
  originQuestId,
  originQuestLabel,
  onClose,
  onCreated,
}: TaskComposerModalProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const isConversionMode = Boolean(conversionQuestId)
  const [kind, setKind] = useState<TaskComposerKind>(initialKind)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [waitingInstructions, setWaitingInstructions] = useState('')
  const [tool, setTool] = useState<'claude' | 'codex'>('codex')
  const [model, setModel] = useState(defaultRuntimeModelId('codex'))
  const [effort, setEffort] = useState(defaultRuntimeEffortId('codex'))
  const [thinking, setThinking] = useState(false)
  const [reviewOnComplete, setReviewOnComplete] = useState(false)
  const [continueQuest, setContinueQuest] = useState(true)
  const [executorKind, setExecutorKind] = useState<'ai_prompt' | 'script'>('ai_prompt')
  const [prompt, setPrompt] = useState('')
  const [command, setCommand] = useState('')
  const [workDir, setWorkDir] = useState('')
  const [envText, setEnvText] = useState('')
  const [timeout, setTimeoutValue] = useState('')
  const [scheduleKind, setScheduleKind] = useState<'once' | 'scheduled' | 'recurring'>('once')
  const [runAt, setRunAt] = useState('')
  const [cron, setCron] = useState('')
  const [runtimeTools, setRuntimeTools] = useState<RuntimeTool[]>(FALLBACK_RUNTIME_TOOLS)
  const [catalog, setCatalog] = useState<RuntimeModelCatalog | null>(buildFallbackRuntimeModelCatalog('codex'))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setKind(isConversionMode ? 'ai' : initialKind)
    setTitle(conversionQuestName ?? '')
    setDescription(conversionQuestDescription ?? '')
    setWaitingInstructions('')
    setTool('codex')
    setModel(defaultRuntimeModelId('codex'))
    setEffort(defaultRuntimeEffortId('codex'))
    setThinking(false)
    setReviewOnComplete(false)
    setContinueQuest(conversionContinueQuest)
    setExecutorKind('ai_prompt')
    setPrompt(conversionPrompt ?? '')
    setCommand('')
    setWorkDir('')
    setEnvText('')
    setTimeoutValue('')
    setScheduleKind('once')
    setRunAt('')
    setCron('')
    setRuntimeTools(FALLBACK_RUNTIME_TOOLS)
    setCatalog(buildFallbackRuntimeModelCatalog('codex'))
    setError(null)
  }, [
    open,
    initialKind,
    isConversionMode,
    conversionQuestName,
    conversionQuestDescription,
    conversionPrompt,
    conversionContinueQuest,
  ])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void api.getRuntimeTools().then((result) => {
      if (cancelled) return
      setRuntimeTools(result.ok && result.data.length > 0 ? result.data : FALLBACK_RUNTIME_TOOLS)
    })
    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    if (!open || kind !== 'ai') return
    let cancelled = false
    void api.getRuntimeModelCatalog(tool).then((result) => {
      if (cancelled) return
      const nextCatalog = result.ok && result.data.models.length > 0 ? result.data : buildFallbackRuntimeModelCatalog(tool)
      setCatalog(nextCatalog)
      setModel((current) => resolveRuntimeModelSelection(tool, current, nextCatalog))
      setEffort((current) => resolveRuntimeEffortSelection(tool, current, nextCatalog))
    })
    return () => {
      cancelled = true
    }
  }, [open, kind, tool])

  useEffect(() => {
    if (!open || kind !== 'ai') return
    setModel((current) => resolveRuntimeModelSelection(tool, current, catalog))
    setEffort((current) => resolveRuntimeEffortSelection(tool, current, catalog))
  }, [open, kind, tool, catalog])

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

  const toolLabel = useMemo(
    () => runtimeTools.find((item) => item.id === tool)?.name ?? tool,
    [runtimeTools, tool],
  )
  const resolvedModel = useMemo(() => resolveRuntimeModelSelection(tool, model, catalog), [tool, model, catalog])
  const effortOptions = useMemo(() => catalog?.effortLevels ?? [], [catalog])
  const modelLabel = useMemo(
    () => catalog?.models.find((item) => item.id === resolvedModel)?.label ?? resolvedModel,
    [catalog, resolvedModel],
  )
  const effortLabel = useMemo(
    () => resolveRuntimeEffortSelection(tool, effort, catalog) || '默认',
    [tool, effort, catalog],
  )

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!projectId || !title.trim() || saving) return
    setSaving(true)
    setError(null)

    if (kind === 'ai') {
      const payload = buildAiPayload({
        title: title.trim() || defaultTitle(kind),
        description: description.trim(),
        tool,
        model: resolvedModel,
        effort: resolveRuntimeEffortSelection(tool, effort, catalog),
        thinking,
        reviewOnComplete,
        continueQuest,
        executorKind,
        prompt,
        command,
        workDir,
        envText,
        timeout,
        scheduleKind,
        runAt,
        cron,
      })

      const result = conversionQuestId
        ? await api.updateQuest(conversionQuestId, payload)
        : await api.createQuest({
            projectId,
            ...payload,
          })

      setSaving(false)
      if (!result.ok) {
        setError(result.error)
        return
      }

      await onCreated?.({ kind, id: result.data.id })
      onClose()
      if (conversionQuestId) {
        navigate(`/quests/${result.data.id}`, { state: taskOverlayState(location), replace: true })
      }
      return
    }

    const result = await api.createTodo({
      projectId,
      originQuestId: originQuestId || undefined,
      createdBy: 'human',
      title: title.trim() || defaultTitle(kind),
      description: description.trim() || undefined,
      waitingInstructions: waitingInstructions.trim() || undefined,
    })
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    await onCreated?.({ kind, id: result.data.id })
    onClose()
  }

  if (!open || typeof document === 'undefined') return null

  return createPortal(
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
            <h2>{isConversionMode ? '转换为任务' : '创建任务'}</h2>
          </div>
          <button type="button" className="pluse-icon-button" onClick={onClose} aria-label="关闭" disabled={saving}>
            <CloseIcon className="pluse-icon" />
          </button>
        </header>

        <form className="pluse-task-modal-body" onSubmit={handleSubmit}>
          <div className="pluse-task-modal-summary">
            <span className="pluse-sidebar-badge">{projectName || '当前项目'}</span>
            <span className="pluse-inline-pill">{kind === 'ai' ? 'AI 任务' : '人类任务'}</span>
            {kind === 'ai' ? (
              <>
                <span className="pluse-sidebar-badge">{toolLabel}</span>
                <span className="pluse-sidebar-badge">{modelLabel}</span>
                <span className="pluse-sidebar-badge">{effortLabel}</span>
              </>
            ) : null}
            {originQuestId ? <span className="pluse-sidebar-badge">{originQuestLabel || '来源会话'}</span> : null}
          </div>

          {isConversionMode ? null : (
            <div className="pluse-task-modal-modes" role="tablist" aria-label="任务类型">
              <button
                type="button"
                className={`pluse-task-modal-mode${kind === 'human' ? ' is-active' : ''}`}
                onClick={() => setKind('human')}
              >
                <span className="pluse-task-modal-mode-icon">
                  <UserIcon className="pluse-icon" />
                </span>
                <strong>人类</strong>
              </button>
              <button
                type="button"
                className={`pluse-task-modal-mode${kind === 'ai' ? ' is-active' : ''}`}
                onClick={() => setKind('ai')}
              >
                <span className="pluse-task-modal-mode-icon">
                  <SparkIcon className="pluse-icon" />
                </span>
                <strong>AI</strong>
              </button>
            </div>
          )}

          <section className="pluse-task-modal-section">
            <header className="pluse-task-modal-section-head">
              <h3>基础</h3>
            </header>
            <div className="pluse-task-modal-grid">
              <label className="pluse-task-modal-field pluse-task-modal-field-span">
                <span>标题</span>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder={defaultTitle(kind)}
                  autoFocus
                />
              </label>

              <label className="pluse-task-modal-field pluse-task-modal-field-span">
                <span>说明</span>
                <textarea
                  rows={3}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="上下文、约束、验收标准。"
                />
              </label>
            </div>
          </section>

          {kind === 'human' ? (
            <section className="pluse-task-modal-section">
              <header className="pluse-task-modal-section-head">
                <h3>等待</h3>
              </header>
              <div className="pluse-task-modal-grid">
                <label className="pluse-task-modal-field pluse-task-modal-field-span">
                  <span>等待说明</span>
                  <textarea
                    rows={4}
                    value={waitingInstructions}
                    onChange={(event) => setWaitingInstructions(event.target.value)}
                    placeholder="例如：等设计确认后再继续。"
                  />
                </label>
              </div>
            </section>
          ) : (
            <>
              <section className="pluse-task-modal-section">
                <header className="pluse-task-modal-section-head">
                  <h3>执行</h3>
                </header>
                <div className="pluse-task-modal-grid">
                  <label className="pluse-task-modal-field">
                    <span>工具</span>
                    <select
                      value={tool}
                      onChange={(event) => {
                        const nextTool = event.target.value === 'claude' ? 'claude' : 'codex'
                        setTool(nextTool)
                        setCatalog(buildFallbackRuntimeModelCatalog(nextTool))
                        setModel(defaultRuntimeModelId(nextTool))
                        setEffort(defaultRuntimeEffortId(nextTool))
                      }}
                    >
                      {runtimeTools.map((item) => (
                        <option key={item.id} value={item.id}>{item.name}</option>
                      ))}
                    </select>
                  </label>

                  <label className="pluse-task-modal-field">
                    <span>模型</span>
                    <select value={resolvedModel} onChange={(event) => setModel(event.target.value)}>
                      {catalog?.models.map((item) => (
                        <option key={item.id} value={item.id}>{item.label}</option>
                      ))}
                    </select>
                  </label>

                  {effortOptions.length > 0 ? (
                    <label className="pluse-task-modal-field">
                      <span>推理强度</span>
                      <select value={resolveRuntimeEffortSelection(tool, effort, catalog)} onChange={(event) => setEffort(event.target.value)}>
                        {effortOptions.map((item) => (
                          <option key={item} value={item}>{item}</option>
                        ))}
                      </select>
                    </label>
                  ) : null}

                  <label className="pluse-task-modal-field">
                    <span>深度思考</span>
                    <select value={thinking ? 'true' : 'false'} onChange={(event) => setThinking(event.target.value === 'true')}>
                      <option value="false">关闭</option>
                      <option value="true">开启</option>
                    </select>
                  </label>

                  <label className="pluse-task-modal-field">
                    <span>完成后复盘</span>
                    <select value={reviewOnComplete ? 'true' : 'false'} onChange={(event) => setReviewOnComplete(event.target.value === 'true')}>
                      <option value="false">关闭</option>
                      <option value="true">开启</option>
                    </select>
                  </label>

                  <label className="pluse-task-modal-field">
                    <span>沿用上下文</span>
                    <select value={continueQuest ? 'true' : 'false'} onChange={(event) => setContinueQuest(event.target.value === 'true')}>
                      <option value="true">继续上下文</option>
                      <option value="false">独立运行</option>
                    </select>
                  </label>
                </div>
              </section>

              <section className="pluse-task-modal-section">
                <header className="pluse-task-modal-section-head">
                  <h3>执行器</h3>
                </header>
                <div className="pluse-task-modal-grid">
                  <label className="pluse-task-modal-field">
                    <span>执行类型</span>
                    <select value={executorKind} onChange={(event) => setExecutorKind(event.target.value as 'ai_prompt' | 'script')}>
                      <option value="ai_prompt">AI 提示词</option>
                      <option value="script">脚本</option>
                    </select>
                  </label>

                  {executorKind === 'ai_prompt' ? (
                    <>
                      <label className="pluse-task-modal-field pluse-task-modal-field-span">
                        <span>提示词</span>
                        <textarea
                          rows={7}
                          value={prompt}
                          onChange={(event) => setPrompt(event.target.value)}
                          placeholder="输入提示词"
                        />
                      </label>
                    </>
                  ) : (
                    <>
                      <label className="pluse-task-modal-field pluse-task-modal-field-span">
                        <span>命令</span>
                        <textarea
                          rows={4}
                          value={command}
                          onChange={(event) => setCommand(event.target.value)}
                          placeholder="pnpm test"
                        />
                      </label>

                      <label className="pluse-task-modal-field">
                        <span>工作目录</span>
                        <input
                          value={workDir}
                          onChange={(event) => setWorkDir(event.target.value)}
                          placeholder="/abs/path"
                        />
                      </label>

                      <label className="pluse-task-modal-field">
                        <span>超时（秒）</span>
                        <input
                          value={timeout}
                          onChange={(event) => setTimeoutValue(event.target.value)}
                          placeholder="300"
                        />
                      </label>

                      <label className="pluse-task-modal-field pluse-task-modal-field-span">
                        <span>环境变量</span>
                        <textarea
                          rows={4}
                          value={envText}
                          onChange={(event) => setEnvText(event.target.value)}
                          placeholder={'FOO=bar\nNODE_ENV=production'}
                        />
                      </label>
                    </>
                  )}
                </div>
              </section>

              <section className="pluse-task-modal-section">
                <header className="pluse-task-modal-section-head">
                  <h3>调度</h3>
                </header>
                <div className="pluse-task-modal-grid">
                  <label className="pluse-task-modal-field">
                    <span>调度方式</span>
                    <select value={scheduleKind} onChange={(event) => setScheduleKind(event.target.value as 'once' | 'scheduled' | 'recurring')}>
                      <option value="once">手动</option>
                      <option value="scheduled">定时</option>
                      <option value="recurring">周期</option>
                    </select>
                  </label>

                  {scheduleKind === 'scheduled' ? (
                    <label className="pluse-task-modal-field pluse-task-modal-field-span">
                      <span>运行时间</span>
                      <input
                        value={runAt}
                        onChange={(event) => setRunAt(event.target.value)}
                        placeholder="2026-04-18T10:00:00+08:00"
                      />
                    </label>
                  ) : null}

                  {scheduleKind === 'recurring' ? (
                    <label className="pluse-task-modal-field pluse-task-modal-field-span">
                      <span>Cron</span>
                      <input
                        value={cron}
                        onChange={(event) => setCron(event.target.value)}
                        placeholder="0 9 * * *"
                      />
                    </label>
                  ) : null}
                </div>
              </section>
            </>
          )}

          {error ? <p className="pluse-error">{error}</p> : null}

          <footer className="pluse-task-modal-actions">
            <button type="button" className="pluse-button pluse-button-ghost" onClick={onClose} disabled={saving}>
              取消
            </button>
            <button type="submit" className="pluse-button" disabled={!projectId || !title.trim() || saving}>
              {saving ? '保存中…' : isConversionMode ? '保存并转换' : kind === 'ai' ? '创建 AI 任务' : '创建人类任务'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  , document.body)
}

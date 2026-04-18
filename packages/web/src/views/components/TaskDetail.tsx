import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useLocation, useNavigate, type Location as RouterLocation } from 'react-router-dom'
import type { Quest, QuestOp, Run, RuntimeModelCatalog, RuntimeTool } from '@pluse/types'
import * as api from '@/api/client'
import { displaySessionName, displayTaskName } from '@/views/utils/display'
import { CloseIcon, ConvertIcon, PlayIcon, PlusIcon, TrashIcon } from './icons'
import { TaskComposerModal } from './TaskComposerModal'

interface TaskDetailProps {
  questId: string
  onQuestLoaded?: (quest: Quest) => void
  onDataChanged?: () => Promise<void> | void
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

function formatStatus(status?: string): string {
  if (!status) return '未设置'
  if (status === 'pending') return '待处理'
  if (status === 'running') return '运行中'
  if (status === 'done' || status === 'completed') return '已完成'
  if (status === 'failed') return '失败'
  if (status === 'cancelled') return '已取消'
  if (status === 'idle') return '空闲'
  return status
}

function formatTrigger(trigger: Run['trigger']): string {
  if (trigger === 'chat') return '会话'
  if (trigger === 'manual') return '手动'
  return '自动'
}

function formatScheduleKind(value?: Quest['scheduleKind']): string {
  if (value === 'scheduled') return '定时'
  if (value === 'recurring') return '周期'
  return '手动'
}

function formatOp(op: QuestOp['op']): string {
  if (op === 'created') return '已创建'
  if (op === 'kind_changed') return '形态切换'
  if (op === 'triggered') return '已触发'
  if (op === 'done') return '已完成'
  if (op === 'failed') return '失败'
  if (op === 'cancelled') return '已取消'
  if (op === 'status_changed') return '状态变更'
  if (op === 'deleted') return '已删除'
  return op
}

function envToText(value: Record<string, string> | undefined): string {
  if (!value) return ''
  return Object.entries(value)
    .map(([key, item]) => `${key}=${item}`)
    .join('\n')
}

function parseEnvText(value: string): Record<string, string> | undefined {
  const entries = value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const index = line.indexOf('=')
      if (index === -1) return null
      return [line.slice(0, index).trim(), line.slice(index + 1).trim()] as const
    })
    .filter((entry): entry is readonly [string, string] => Boolean(entry && entry[0]))

  if (!entries.length) return undefined
  return Object.fromEntries(entries)
}

interface TaskDetailLocationState {
  backgroundLocation?: RouterLocation
  nextQuestId?: string
}

function resolveCloseTarget(location: RouterLocation, fallback: string): string {
  const state = location.state as TaskDetailLocationState | null
  if (state?.nextQuestId) return `/quests/${state.nextQuestId}`
  const background = state?.backgroundLocation
  return background ? `${background.pathname}${background.search}${background.hash}` : fallback
}

export function TaskDetail({ questId, onQuestLoaded, onDataChanged }: TaskDetailProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const [quest, setQuest] = useState<Quest | null>(null)
  const [runs, setRuns] = useState<Run[]>([])
  const [ops, setOps] = useState<QuestOp[]>([])
  const [tools, setTools] = useState<RuntimeTool[]>([])
  const [catalog, setCatalog] = useState<RuntimeModelCatalog | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createTaskModalOpen, setCreateTaskModalOpen] = useState(false)
  const [form, setForm] = useState({
    title: '',
    description: '',
    tool: 'codex',
    model: '',
    effort: '',
    thinking: false,
    enabled: true,
    reviewOnComplete: false,
    executorKind: 'ai_prompt' as 'ai_prompt' | 'script',
    prompt: '',
    command: '',
    workDir: '',
    envText: '',
    timeout: '',
    continueQuest: true,
    scheduleKind: 'once' as 'once' | 'scheduled' | 'recurring',
    runAt: '',
    cron: '',
    timezone: '',
  })
  const reloadTimer = useRef<number | null>(null)

  async function loadData() {
    const [questResult, runsResult, opsResult, toolsResult] = await Promise.all([
      api.getQuest(questId),
      api.getQuestRuns(questId),
      api.getQuestOps(questId),
      api.getRuntimeTools(),
    ])
    if (!questResult.ok) {
      setError(questResult.error)
      return
    }

    const nextQuest = questResult.data
    const executorConfig = nextQuest.executorConfig
    const timeoutValue = nextQuest.executorKind === 'script'
      ? executorConfig && 'timeout' in executorConfig ? executorConfig.timeout : undefined
      : nextQuest.executorOptions?.timeout

    setQuest(nextQuest)
    onQuestLoaded?.(nextQuest)
    setRuns(runsResult.ok ? runsResult.data : [])
    setOps(opsResult.ok ? opsResult.data : [])
    setTools(toolsResult.ok ? toolsResult.data : [])
    setForm({
      title: displayTaskName(nextQuest.title ?? nextQuest.name),
      description: nextQuest.description ?? '',
      tool: nextQuest.tool ?? 'codex',
      model: nextQuest.tool === 'codex' ? (nextQuest.model ?? '5.3-codex-spark') : nextQuest.tool === 'claude' ? (nextQuest.model ?? 'sonnet') : (nextQuest.model ?? ''),
      effort: nextQuest.tool === 'codex' ? (nextQuest.effort ?? 'low') : (nextQuest.effort ?? ''),
      thinking: nextQuest.thinking ?? false,
      enabled: nextQuest.enabled !== false,
      reviewOnComplete: nextQuest.reviewOnComplete === true,
      executorKind: nextQuest.executorKind === 'script' ? 'script' : 'ai_prompt',
      prompt: nextQuest.executorKind === 'ai_prompt' && executorConfig && 'prompt' in executorConfig ? executorConfig.prompt : '',
      command: nextQuest.executorKind === 'script' && executorConfig && 'command' in executorConfig ? executorConfig.command : '',
      workDir: nextQuest.executorKind === 'script' && executorConfig && 'workDir' in executorConfig ? executorConfig.workDir ?? '' : '',
      envText: nextQuest.executorKind === 'script' && executorConfig && 'env' in executorConfig ? envToText(executorConfig.env) : '',
      timeout: timeoutValue === undefined ? '' : String(timeoutValue),
      continueQuest: nextQuest.executorOptions?.continueQuest !== false,
      scheduleKind: nextQuest.scheduleKind ?? 'once',
      runAt: nextQuest.scheduleConfig?.runAt ?? '',
      cron: nextQuest.scheduleConfig?.cron ?? '',
      timezone: nextQuest.scheduleConfig?.timezone ?? '',
    })
    setError(null)
  }

  useEffect(() => {
    void loadData()
  }, [questId])

  useEffect(() => {
    void api.getRuntimeModelCatalog(form.tool).then((result) => {
      if (result.ok) setCatalog(result.data)
      else setCatalog(null)
    })
  }, [form.tool])

  useEffect(() => {
    const source = new EventSource(`/api/events?questId=${encodeURIComponent(questId)}`)
    source.onmessage = () => {
      if (reloadTimer.current) window.clearTimeout(reloadTimer.current)
      reloadTimer.current = window.setTimeout(() => {
        void loadData()
        void onDataChanged?.()
      }, 200)
    }
    return () => {
      source.close()
      if (reloadTimer.current) window.clearTimeout(reloadTimer.current)
    }
  }, [questId, onDataChanged])

  const effortOptions = useMemo(() => catalog?.effortLevels ?? [], [catalog])
  const toolLabel = useMemo(
    () => tools.find((tool) => tool.id === form.tool)?.name ?? form.tool,
    [form.tool, tools],
  )
  const selectedModelLabel = useMemo(() => catalog?.models.find((model) => model.id === form.model)?.label ?? form.model, [catalog, form.model])
  const closeTarget = resolveCloseTarget(location, quest ? `/projects/${quest.projectId}` : '/')

  function closeModal() {
    navigate(closeTarget, { replace: true })
  }

  useEffect(() => {
    function handleKeydown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !createTaskModalOpen) {
        closeModal()
      }
    }
    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
  }, [createTaskModalOpen, closeTarget])

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!quest) return
    if (quest.activeRunId && form.enabled === false) {
      const confirmed = window.confirm('当前任务正在运行，停用前会先取消当前执行。继续吗？')
      if (!confirmed) return
      const cancelled = await api.cancelRun(quest.activeRunId)
      if (!cancelled.ok) {
        setError(cancelled.error)
        return
      }
      let cleared = false
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const current = await api.getQuest(quest.id)
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
    setSaving(true)
    const timeoutValue = form.timeout.trim() ? Number(form.timeout) : undefined
    const env = parseEnvText(form.envText)

    const result = await api.updateQuest(quest.id, {
      kind: 'task',
      title: form.title.trim() || '未命名任务',
      description: form.description.trim() || null,
      tool: form.tool,
      model: form.model || null,
      effort: form.effort || null,
      thinking: form.thinking,
      enabled: form.enabled,
      reviewOnComplete: form.reviewOnComplete,
      executorKind: form.executorKind,
      executorConfig: form.executorKind === 'script'
        ? {
            command: form.command.trim(),
            workDir: form.workDir.trim() || undefined,
            env,
            timeout: timeoutValue,
          }
        : {
            prompt: form.prompt,
            agent: form.tool === 'claude' ? 'claude' : 'codex',
            model: form.model || undefined,
          },
      executorOptions: {
        continueQuest: form.continueQuest,
        timeout: form.executorKind === 'ai_prompt' ? timeoutValue : undefined,
      },
      scheduleKind: form.scheduleKind,
      scheduleConfig: form.scheduleKind === 'scheduled'
        ? { runAt: form.runAt, timezone: form.timezone.trim() || undefined }
        : form.scheduleKind === 'recurring'
          ? { cron: form.cron, timezone: form.timezone.trim() || undefined }
          : null,
      status: quest.status === 'idle' ? 'pending' : quest.status,
    })
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setQuest(result.data)
    onQuestLoaded?.(result.data)
    await onDataChanged?.()
  }

  async function handleRunNow() {
    if (!quest) return
    const result = await api.startQuestRun(quest.id, { trigger: 'manual', triggeredBy: 'human' })
    if (!result.ok) {
      setError(result.error)
      return
    }
    await loadData()
    await onDataChanged?.()
  }

  async function handleCancelRun() {
    if (!quest?.activeRunId) return
    const result = await api.cancelRun(quest.activeRunId)
    if (!result.ok) {
      setError(result.error)
      return
    }
    await loadData()
  }

  async function handleDeleteTask() {
    if (!quest) return
    const confirmed = window.confirm(`删除 AI 任务“${displayTaskName(quest.title ?? quest.name)}”？`)
    if (!confirmed) return
    const result = await api.deleteQuest(quest.id)
    if (!result.ok) {
      setError(result.error)
      return
    }
    await onDataChanged?.()
    const questsResult = await api.getQuests({ projectId: quest.projectId, deleted: false })
    const state = location.state as TaskDetailLocationState | null
    const fallback = state?.nextQuestId
      ? `/quests/${state.nextQuestId}`
      : questsResult.ok
        ? (() => {
          const quests = questsResult.data
          const index = quests.findIndex((item) => item.id === quest.id)
          const nextQuest = index >= 0 ? quests[index + 1] || quests[index - 1] : null
          return nextQuest ? `/quests/${nextQuest.id}` : `/projects/${quest.projectId}`
        })()
        : `/projects/${quest.projectId}`
    navigate(fallback, { replace: true })
  }

  async function handleSwitchToSession() {
    if (!quest) return
    const result = await api.updateQuest(quest.id, {
      kind: 'session',
      name: displaySessionName(quest.title ?? quest.name),
    })
    if (!result.ok) {
      setError(result.error)
      return
    }
    onQuestLoaded?.(result.data)
    await onDataChanged?.()
    navigate(`/quests/${result.data.id}`, { replace: true })
  }

  return (
    <>
      <div
        className="pluse-modal-backdrop pluse-task-detail-backdrop"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget && !saving && !createTaskModalOpen) closeModal()
        }}
      >
        <section
          className="pluse-modal-panel pluse-task-detail-modal"
          role="dialog"
          aria-modal="true"
          aria-label={quest ? `任务 ${displayTaskName(quest.title ?? quest.name)}` : '任务详情'}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <header className="pluse-task-detail-head">
            <div className="pluse-task-detail-identity">
              <span className="pluse-task-detail-kicker">AI 任务</span>
              <div className="pluse-task-detail-title-row">
                <h2>{quest ? (form.title || '未命名任务') : '正在加载任务…'}</h2>
                {quest ? <span className={`pluse-task-status is-${quest.status ?? 'idle'}`}>{formatStatus(quest.status)}</span> : null}
                {quest?.activeRunId ? <span className="pluse-inline-pill is-running">运行中</span> : null}
              </div>
              {quest && form.description ? <p className="pluse-task-detail-summary">{form.description}</p> : null}
              {quest ? (
                <div className="pluse-task-detail-meta">
                  <span>{toolLabel}</span>
                  <span>{selectedModelLabel}</span>
                  <span>{formatScheduleKind(form.scheduleKind)}</span>
                  <span>{form.continueQuest ? '继续上下文' : '独立运行'}</span>
                  {!form.enabled ? <span>已暂停</span> : null}
                </div>
              ) : null}
            </div>
            <button type="button" className="pluse-icon-button" onClick={closeModal} aria-label="关闭任务详情">
              <CloseIcon className="pluse-icon" />
            </button>
          </header>

          {!quest ? (
            <div className="pluse-task-detail-loading">
              <p className="pluse-empty-inline">{error ? `加载失败：${error}` : '正在加载任务…'}</p>
            </div>
          ) : (
            <form className="pluse-task-detail-form" onSubmit={save}>
              <div className="pluse-task-detail-toolbar">
                <div className="pluse-task-detail-toolbar-group">
                  <button type="submit" className="pluse-button" disabled={saving}>
                    {saving ? '保存中…' : '保存'}
                  </button>
                  <button
                    type="button"
                    className="pluse-button pluse-button-ghost"
                    onClick={() => void handleRunNow()}
                    disabled={Boolean(quest.activeRunId) || quest.enabled === false}
                  >
                    <PlayIcon className="pluse-icon" />
                    立即运行
                  </button>
                  {quest.activeRunId ? (
                    <button type="button" className="pluse-button pluse-button-danger" onClick={() => void handleCancelRun()}>
                      停止
                    </button>
                  ) : null}
                </div>
                <div className="pluse-task-detail-toolbar-group">
                  <button
                    type="button"
                    className="pluse-icon-button"
                    title="转会话"
                    aria-label="转会话"
                    onClick={() => void handleSwitchToSession()}
                    disabled={Boolean(quest.activeRunId)}
                  >
                    <ConvertIcon className="pluse-icon" />
                  </button>
                  <button
                    type="button"
                    className="pluse-button pluse-button-ghost"
                    onClick={() => setCreateTaskModalOpen(true)}
                  >
                    <PlusIcon className="pluse-icon" />
                    人类任务
                  </button>
                  <button type="button" className="pluse-button pluse-button-ghost" onClick={() => void handleDeleteTask()}>
                    <TrashIcon className="pluse-icon" />
                    删除
                  </button>
                </div>
              </div>

              <div className="pluse-task-detail-body">
                <section className="pluse-task-detail-section">
                  <header className="pluse-task-detail-section-head">
                    <div>
                      <h3>基础</h3>
                      <p>标题、运行时配置和任务状态。</p>
                    </div>
                  </header>
                  <div className="pluse-form-grid">
                    <label>
                      <span>标题</span>
                      <input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} />
                    </label>
                    <label>
                      <span>工具</span>
                      <select value={form.tool} onChange={(event) => setForm((current) => ({ ...current, tool: event.target.value }))}>
                        {tools.map((tool) => (
                          <option key={tool.id} value={tool.id}>{tool.name}</option>
                        ))}
                      </select>
                    </label>
                    <label className="pluse-form-span">
                      <span>说明</span>
                      <textarea
                        rows={3}
                        value={form.description}
                        onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                      />
                    </label>
                      <label>
                      <span>模型</span>
                      <select value={form.model} onChange={(event) => setForm((current) => ({ ...current, model: event.target.value }))}>
                        {catalog?.models.map((model) => (
                          <option key={model.id} value={model.id}>{model.label}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>推理强度</span>
                      <select value={form.effort} onChange={(event) => setForm((current) => ({ ...current, effort: event.target.value }))}>
                        {effortOptions.map((effort) => (
                          <option key={effort} value={effort}>{effort}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>状态</span>
                      <select value={form.enabled ? 'true' : 'false'} onChange={(event) => setForm((current) => ({ ...current, enabled: event.target.value === 'true' }))}>
                        <option value="true">启用</option>
                        <option value="false">暂停</option>
                      </select>
                    </label>
                    <label>
                      <span>深度思考</span>
                      <select value={form.thinking ? 'true' : 'false'} onChange={(event) => setForm((current) => ({ ...current, thinking: event.target.value === 'true' }))}>
                        <option value="false">关闭</option>
                        <option value="true">开启</option>
                      </select>
                    </label>
                    <label>
                      <span>完成后复盘</span>
                      <select value={form.reviewOnComplete ? 'true' : 'false'} onChange={(event) => setForm((current) => ({ ...current, reviewOnComplete: event.target.value === 'true' }))}>
                        <option value="false">关闭</option>
                        <option value="true">开启</option>
                      </select>
                    </label>
                    <label>
                      <span>沿用上下文</span>
                      <select value={form.continueQuest ? 'true' : 'false'} onChange={(event) => setForm((current) => ({ ...current, continueQuest: event.target.value === 'true' }))}>
                        <option value="true">继续上下文</option>
                        <option value="false">独立运行</option>
                      </select>
                    </label>
                  </div>
                </section>

                <section className="pluse-task-detail-section">
                  <header className="pluse-task-detail-section-head">
                    <div>
                      <h3>执行</h3>
                      <p>定义 AI 提示词或脚本命令。</p>
                    </div>
                  </header>
                  <div className="pluse-form-grid">
                    <label>
                      <span>执行类型</span>
                      <select value={form.executorKind} onChange={(event) => setForm((current) => ({ ...current, executorKind: event.target.value as 'ai_prompt' | 'script' }))}>
                        <option value="ai_prompt">AI 提示词</option>
                        <option value="script">脚本</option>
                      </select>
                    </label>
                    <label>
                      <span>超时（秒）</span>
                      <input
                        value={form.timeout}
                        onChange={(event) => setForm((current) => ({ ...current, timeout: event.target.value }))}
                        placeholder="300"
                      />
                    </label>
                    {form.executorKind === 'ai_prompt' ? (
                      <label className="pluse-form-span">
                        <span>提示词</span>
                        <textarea
                          rows={9}
                          value={form.prompt}
                          onChange={(event) => setForm((current) => ({ ...current, prompt: event.target.value }))}
                          placeholder="输入提示词"
                        />
                      </label>
                    ) : (
                      <>
                        <label className="pluse-form-span">
                          <span>命令</span>
                          <textarea
                            rows={4}
                            value={form.command}
                            onChange={(event) => setForm((current) => ({ ...current, command: event.target.value }))}
                            placeholder="pnpm test"
                          />
                        </label>
                        <label>
                          <span>工作目录</span>
                          <input
                            value={form.workDir}
                            onChange={(event) => setForm((current) => ({ ...current, workDir: event.target.value }))}
                            placeholder="/abs/path"
                          />
                        </label>
                        <label className="pluse-form-span">
                          <span>环境变量</span>
                          <textarea
                            rows={4}
                            value={form.envText}
                            onChange={(event) => setForm((current) => ({ ...current, envText: event.target.value }))}
                            placeholder={'FOO=bar\nNODE_ENV=production'}
                          />
                        </label>
                      </>
                    )}
                  </div>
                </section>

                <section className="pluse-task-detail-section">
                  <header className="pluse-task-detail-section-head">
                    <div>
                      <h3>调度</h3>
                      <p>控制手动、定时或周期执行。</p>
                    </div>
                  </header>
                  <div className="pluse-form-grid">
                    <label>
                      <span>调度方式</span>
                      <select value={form.scheduleKind} onChange={(event) => setForm((current) => ({ ...current, scheduleKind: event.target.value as 'once' | 'scheduled' | 'recurring' }))}>
                        <option value="once">手动</option>
                        <option value="scheduled">定时</option>
                        <option value="recurring">周期</option>
                      </select>
                    </label>
                    <label>
                      <span>时区</span>
                      <input
                        value={form.timezone}
                        onChange={(event) => setForm((current) => ({ ...current, timezone: event.target.value }))}
                        placeholder="Asia/Shanghai"
                      />
                    </label>
                    {form.scheduleKind === 'scheduled' ? (
                      <label className="pluse-form-span">
                        <span>运行时间</span>
                        <input
                          value={form.runAt}
                          onChange={(event) => setForm((current) => ({ ...current, runAt: event.target.value }))}
                          placeholder="2026-04-18T10:00:00+08:00"
                        />
                      </label>
                    ) : null}
                    {form.scheduleKind === 'recurring' ? (
                      <label className="pluse-form-span">
                        <span>Cron</span>
                        <input
                          value={form.cron}
                          onChange={(event) => setForm((current) => ({ ...current, cron: event.target.value }))}
                          placeholder="0 9 * * *"
                        />
                      </label>
                    ) : null}
                  </div>
                  <div className="pluse-trigger-row">
                    <div className="pluse-trigger-item">
                      <span>上次运行</span>
                      <strong>{formatDateTime(quest.scheduleConfig?.lastRunAt)}</strong>
                    </div>
                    <div className="pluse-trigger-item">
                      <span>下次运行</span>
                      <strong>{formatDateTime(quest.scheduleConfig?.nextRunAt)}</strong>
                    </div>
                  </div>
                </section>

                <section className="pluse-task-detail-section">
                  <header className="pluse-task-detail-section-head">
                    <div>
                      <h3>运行记录</h3>
                      <p>查看最近执行结果和失败原因。</p>
                    </div>
                  </header>
                  <div className="pluse-output-list">
                    {runs.length > 0 ? runs.map((run) => (
                      <div key={run.id} className="pluse-note-item">
                        <div>
                          <strong>{formatStatus(run.state)}</strong>
                          <p>{run.tool}/{run.model} · {formatTrigger(run.trigger)} · {formatDateTime(run.createdAt)}</p>
                          {run.failureReason ? <p>{run.failureReason}</p> : null}
                        </div>
                      </div>
                    )) : (
                      <p className="pluse-empty-inline">暂无运行历史</p>
                    )}
                  </div>
                </section>

                <section className="pluse-task-detail-section">
                  <header className="pluse-task-detail-section-head">
                    <div>
                      <h3>活动</h3>
                      <p>记录任务状态与配置变化。</p>
                    </div>
                  </header>
                  <div className="pluse-output-list">
                    {ops.length > 0 ? ops.map((op) => (
                      <div key={op.id} className="pluse-note-item">
                        <div>
                          <strong>{formatOp(op.op)}</strong>
                          <p>{formatDateTime(op.createdAt)} · {op.actor}</p>
                          {op.note ? <p>{op.note}</p> : null}
                          {!op.note && (op.fromStatus || op.toStatus) ? (
                            <p>{op.fromStatus ?? 'n/a'} → {op.toStatus ?? 'n/a'}</p>
                          ) : null}
                        </div>
                      </div>
                    )) : (
                      <p className="pluse-empty-inline">暂无活动日志</p>
                    )}
                  </div>
                </section>

                {error ? <p className="pluse-error">{error}</p> : null}
              </div>
            </form>
          )}
        </section>
      </div>

      {quest ? (
        <TaskComposerModal
          open={createTaskModalOpen}
          projectId={quest.projectId}
          initialKind="human"
          originQuestId={quest.id}
          originQuestLabel={displayTaskName(quest.title ?? quest.name)}
          onClose={() => setCreateTaskModalOpen(false)}
          onCreated={async () => {
            await onDataChanged?.()
          }}
        />
      ) : null}
    </>
  )
}

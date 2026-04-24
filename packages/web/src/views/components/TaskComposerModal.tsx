import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate, type Location as RouterLocation } from 'react-router-dom'
import type { AiPromptConfig, RuntimeModelCatalog, RuntimeTool, ScriptConfig, TodoRepeat } from '@pluse/types'
import * as api from '@/api/client'
import { useI18n } from '@/i18n'
import { formatTodoRepeat, fromDateTimeLocalValue, toDateTimeLocalValue } from '@/views/utils/todo'
import {
  buildFallbackRuntimeModelCatalog,
  defaultRuntimeEffortId,
  defaultRuntimeModelId,
  runtimeAgentForTool,
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
  { id: 'mc', name: 'MC (--code)', command: 'mc --code', runtimeFamily: 'claude-stream-json', builtin: true, available: true },
]

type SegmentedOption<T extends string> = {
  value: T
  label: string
}

type TaskRecurringPreset = 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'custom'

type ParsedRecurringSchedule = {
  preset: TaskRecurringPreset
  time: string
  weekday: string
  monthDay: string
  customCron: string
}

type TranslateFn = (key: string, values?: Record<string, string | number>) => string

function defaultTitle(kind: TaskComposerKind, t?: (key: string) => string): string {
  if (kind === 'ai') return t ? t('新自动化') : '新自动化'
  return t ? t('新待办') : '新待办'
}

function defaultTaskTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

function padNumber(value: number): string {
  return String(value).padStart(2, '0')
}

function formatEffortLabel(value: string, t: TranslateFn): string {
  if (value === 'low') return t('低')
  if (value === 'medium') return t('标准')
  if (value === 'high') return t('高')
  if (value === 'xhigh') return t('超高')
  return value
}

function formatLocalTime(hour: number, minute: number): string {
  return `${padNumber(hour)}:${padNumber(minute)}`
}

function parseTimeInput(value: string): { hour: number; minute: number } {
  const match = value.match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return { hour: 9, minute: 0 }
  const hour = Math.min(23, Math.max(0, Number.parseInt(match[1] ?? '9', 10)))
  const minute = Math.min(59, Math.max(0, Number.parseInt(match[2] ?? '0', 10)))
  return { hour, minute }
}

function normalizeCronWeekdayToken(value: string): string {
  return value === '7' ? '0' : value
}

function nextWeekdayAt(base: Date, weekday: number, hour: number, minute: number): Date {
  const next = new Date(base)
  next.setHours(hour, minute, 0, 0)
  let offset = (weekday - next.getDay() + 7) % 7
  if (offset === 0 && next.getTime() <= base.getTime()) offset = 7
  next.setDate(next.getDate() + offset)
  return next
}

function buildRecurringCron(input: ParsedRecurringSchedule): string | null {
  if (input.preset === 'custom') return input.customCron.trim() || null

  const { hour, minute } = parseTimeInput(input.time)
  const cronPrefix = `${minute} ${hour}`
  if (input.preset === 'daily') return `${cronPrefix} * * *`
  if (input.preset === 'weekdays') return `${cronPrefix} * * 1-5`
  if (input.preset === 'weekly') return `${cronPrefix} * * ${normalizeCronWeekdayToken(input.weekday || '1')}`
  const monthDay = Math.min(31, Math.max(1, Number.parseInt(input.monthDay || '1', 10) || 1))
  return `${cronPrefix} ${monthDay} * *`
}

function formatRecurringSummary(input: ParsedRecurringSchedule, t: TranslateFn): string {
  const weekdayLabel = input.weekday === '1' ? t('每周一')
    : input.weekday === '2' ? t('每周二')
      : input.weekday === '3' ? t('每周三')
        : input.weekday === '4' ? t('每周四')
          : input.weekday === '5' ? t('每周五')
            : input.weekday === '6' ? t('每周六')
              : t('每周日')

  if (input.preset === 'daily') return t('每天 {{time}}', { time: input.time })
  if (input.preset === 'weekdays') return t('工作日 {{time}}', { time: input.time })
  if (input.preset === 'weekly') return t('{{day}} {{time}}', { day: weekdayLabel, time: input.time })
  if (input.preset === 'monthly') return t('每月 {{day}} 日 {{time}}', { day: input.monthDay || '1', time: input.time })
  return input.customCron.trim() ? t('自定义 Cron · {{cron}}', { cron: input.customCron.trim() }) : t('自定义周期')
}

function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T
  options: Array<SegmentedOption<T>>
  onChange: (value: T) => void
  ariaLabel: string
}) {
  return (
    <div className="pluse-task-segmented" role="tablist" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          className={`pluse-task-segmented-option${value === option.value ? ' is-active' : ''}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function TaskSettingSwitch({
  label,
  note,
  checked,
  onChange,
}: {
  label: string
  note: string
  checked: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <button type="button" className={`pluse-task-setting-switch${checked ? ' is-on' : ''}`} onClick={() => onChange(!checked)}>
      <span className="pluse-task-setting-switch-copy">
        <strong>{label}</strong>
        <span>{note}</span>
      </span>
      <span className={`pluse-toggle${checked ? ' is-on' : ''}`} aria-hidden="true" />
    </button>
  )
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
        agent: runtimeAgentForTool(input.tool),
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
  const { t } = useI18n()
  const navigate = useNavigate()
  const location = useLocation()
  const isConversionMode = Boolean(conversionQuestId)
  const [kind, setKind] = useState<TaskComposerKind>(initialKind)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [waitingInstructions, setWaitingInstructions] = useState('')
  const [dueAt, setDueAt] = useState('')
  const [repeat, setRepeat] = useState<TodoRepeat>('none')
  const [tool, setTool] = useState<string>('codex')
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
  const [recurringPreset, setRecurringPreset] = useState<TaskRecurringPreset>('daily')
  const [recurringTime, setRecurringTime] = useState('09:00')
  const [recurringWeekday, setRecurringWeekday] = useState('1')
  const [recurringMonthDay, setRecurringMonthDay] = useState(String(new Date().getDate()))
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
    setDueAt('')
    setRepeat('none')
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
    setRecurringPreset('daily')
    setRecurringTime('09:00')
    setRecurringWeekday('1')
    setRecurringMonthDay(String(new Date().getDate()))
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
    () => formatEffortLabel(resolveRuntimeEffortSelection(tool, effort, catalog) || t('默认'), t),
    [tool, effort, catalog, t],
  )
  const toolOptions = useMemo<Array<SegmentedOption<string>>>(
    () => runtimeTools.map((item) => ({ value: item.id, label: item.name })),
    [runtimeTools],
  )
  const effortChoiceOptions = useMemo<Array<SegmentedOption<string>>>(
    () => effortOptions.map((item) => ({ value: item, label: formatEffortLabel(item, t) })),
    [effortOptions, t],
  )
  const executorKindOptions = useMemo<Array<SegmentedOption<'ai_prompt' | 'script'>>>(
    () => [
      { value: 'ai_prompt', label: t('AI 提示词') },
      { value: 'script', label: t('脚本') },
    ],
    [t],
  )
  const scheduleKindOptions = useMemo<Array<SegmentedOption<'once' | 'scheduled' | 'recurring'>>>(
    () => [
      { value: 'once', label: t('手动') },
      { value: 'scheduled', label: t('定时') },
      { value: 'recurring', label: t('周期') },
    ],
    [t],
  )
  const recurringPresetOptions = useMemo<Array<SegmentedOption<TaskRecurringPreset>>>(
    () => [
      { value: 'daily', label: t('每天') },
      { value: 'weekdays', label: t('工作日') },
      { value: 'weekly', label: t('每周') },
      { value: 'monthly', label: t('每月') },
      { value: 'custom', label: t('自定义') },
    ],
    [t],
  )
  const recurringWeekdayOptions = useMemo<Array<SegmentedOption<string>>>(
    () => [
      { value: '1', label: t('周一') },
      { value: '2', label: t('周二') },
      { value: '3', label: t('周三') },
      { value: '4', label: t('周四') },
      { value: '5', label: t('周五') },
      { value: '6', label: t('周六') },
      { value: '0', label: t('周日') },
    ],
    [t],
  )
  const todoRepeatOptions = useMemo<Array<SegmentedOption<TodoRepeat>>>(
    () => [
      { value: 'none', label: formatTodoRepeat('none', t) },
      { value: 'daily', label: formatTodoRepeat('daily', t) },
      { value: 'weekly', label: formatTodoRepeat('weekly', t) },
      { value: 'monthly', label: formatTodoRepeat('monthly', t) },
    ],
    [t],
  )
  const scheduledQuickOptions = useMemo(() => {
    const now = new Date()
    const tonight = new Date(now)
    tonight.setHours(18, 0, 0, 0)
    const tonightLabel = tonight.getTime() > now.getTime() ? t('今晚 18:00') : t('明晚 18:00')
    if (tonight.getTime() <= now.getTime()) tonight.setDate(tonight.getDate() + 1)

    const tomorrowMorning = new Date(now)
    tomorrowMorning.setDate(now.getDate() + 1)
    tomorrowMorning.setHours(9, 0, 0, 0)

    const tomorrowAfternoon = new Date(now)
    tomorrowAfternoon.setDate(now.getDate() + 1)
    tomorrowAfternoon.setHours(15, 0, 0, 0)

    const nextMondayMorning = nextWeekdayAt(now, 1, 9, 0)

    return [
      { id: 'tonight', label: tonightLabel, value: toDateTimeLocalValue(tonight.toISOString()) },
      { id: 'tomorrow-morning', label: t('明早 09:00'), value: toDateTimeLocalValue(tomorrowMorning.toISOString()) },
      { id: 'tomorrow-afternoon', label: t('明天下午 15:00'), value: toDateTimeLocalValue(tomorrowAfternoon.toISOString()) },
      { id: 'next-monday', label: t('下周一 09:00'), value: toDateTimeLocalValue(nextMondayMorning.toISOString()) },
    ]
  }, [t])
  const recurringSummary = useMemo(
    () => formatRecurringSummary({
      preset: recurringPreset,
      time: recurringTime,
      weekday: recurringWeekday,
      monthDay: recurringMonthDay,
      customCron: cron,
    }, t),
    [recurringMonthDay, recurringPreset, recurringTime, recurringWeekday, cron, t],
  )
  const scheduledSummary = useMemo(() => {
    const iso = fromDateTimeLocalValue(runAt)
    return iso
      ? new Intl.DateTimeFormat('zh-CN', {
          month: 'numeric',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }).format(new Date(iso))
      : t('尚未设置时间')
  }, [runAt, t])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!projectId || !title.trim() || saving) return
    setSaving(true)
    setError(null)

    if (kind === 'ai') {
      const scheduledRunAt = scheduleKind === 'scheduled' ? fromDateTimeLocalValue(runAt) : undefined
      const recurringCron = scheduleKind === 'recurring'
        ? buildRecurringCron({
            preset: recurringPreset,
            time: recurringTime,
            weekday: recurringWeekday,
            monthDay: recurringMonthDay,
            customCron: cron,
          })
        : null

      if (scheduleKind === 'scheduled' && !scheduledRunAt) {
        setSaving(false)
        setError(t('请选择运行时间'))
        return
      }

      if (scheduleKind === 'recurring' && !recurringCron) {
        setSaving(false)
        setError(recurringPreset === 'custom' ? t('请输入 Cron 表达式') : t('请完善周期设置'))
        return
      }

      const payload = buildAiPayload({
        title: title.trim() || defaultTitle(kind, t),
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
        runAt: scheduledRunAt ?? '',
        cron: recurringCron ?? '',
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
      title: title.trim() || defaultTitle(kind, t),
      description: description.trim() || undefined,
      waitingInstructions: waitingInstructions.trim() || undefined,
      dueAt: fromDateTimeLocalValue(dueAt),
      repeat,
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
        aria-label={isConversionMode ? t('转为自动化') : kind === 'ai' ? t('创建自动化') : t('创建待办')}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="pluse-task-modal-head">
          <div className="pluse-task-modal-title">
            <span className="pluse-task-modal-kicker">{projectName || t('当前项目')}</span>
            <h2>{isConversionMode ? t('转为自动化') : kind === 'ai' ? t('创建自动化') : t('创建待办')}</h2>
          </div>
          <button type="button" className="pluse-icon-button" onClick={onClose} aria-label={t('关闭')} title={t('关闭')} disabled={saving}>
            <CloseIcon className="pluse-icon" />
          </button>
        </header>

        <form className="pluse-task-modal-body" onSubmit={handleSubmit}>
          <div className="pluse-task-modal-summary">
            <span className="pluse-sidebar-badge">{projectName || t('当前项目')}</span>
            <span className="pluse-inline-pill">{kind === 'ai' ? t('自动化') : t('待办')}</span>
            {kind === 'ai' ? (
              <>
                <span className="pluse-sidebar-badge">{toolLabel}</span>
                <span className="pluse-sidebar-badge">{modelLabel}</span>
                <span className="pluse-sidebar-badge">{effortLabel}</span>
              </>
            ) : null}
            {originQuestId ? <span className="pluse-sidebar-badge">{originQuestLabel || t('来源会话')}</span> : null}
          </div>

          {isConversionMode ? null : (
            <div className="pluse-task-modal-modes" role="tablist" aria-label={t('对象类型')}>
              <button
                type="button"
                className={`pluse-task-modal-mode${kind === 'human' ? ' is-active' : ''}`}
                onClick={() => setKind('human')}
              >
                <span className="pluse-task-modal-mode-icon">
                  <UserIcon className="pluse-icon" />
                </span>
                <strong>{t('待办')}</strong>
              </button>
              <button
                type="button"
                className={`pluse-task-modal-mode${kind === 'ai' ? ' is-active' : ''}`}
                onClick={() => setKind('ai')}
              >
                <span className="pluse-task-modal-mode-icon">
                  <SparkIcon className="pluse-icon" />
                </span>
                <strong>{t('自动化')}</strong>
              </button>
            </div>
          )}

          <section className="pluse-task-modal-section">
            <header className="pluse-task-modal-section-head">
              <h3>{t('基础')}</h3>
            </header>
            <div className="pluse-task-modal-grid">
              <label className="pluse-task-modal-field pluse-task-modal-field-span">
                <span>{t('标题')}</span>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder={defaultTitle(kind, t)}
                  autoFocus
                />
              </label>

              <label className="pluse-task-modal-field pluse-task-modal-field-span">
                <span>{t('说明')}</span>
                <textarea
                  rows={3}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder={t('上下文、约束、验收标准。')}
                />
              </label>
            </div>
          </section>

          {kind === 'human' ? (
            <section className="pluse-task-modal-section">
              <header className="pluse-task-modal-section-head">
                <h3>{t('计划')}</h3>
              </header>
              <div className="pluse-task-modal-grid">
                <label className="pluse-task-modal-field">
                  <span>{t('时间')}</span>
                  <input
                    type="datetime-local"
                    value={dueAt}
                    onChange={(event) => setDueAt(event.target.value)}
                  />
                </label>
                <div className="pluse-task-modal-field">
                  <span>{t('重复')}</span>
                  <SegmentedControl value={repeat} options={todoRepeatOptions} onChange={setRepeat} ariaLabel={t('重复')} />
                </div>
              </div>
            </section>
          ) : null}

          {kind === 'human' ? (
            <section className="pluse-task-modal-section">
              <header className="pluse-task-modal-section-head">
                <h3>{t('等待')}</h3>
              </header>
              <div className="pluse-task-modal-grid">
                <label className="pluse-task-modal-field pluse-task-modal-field-span">
                  <span>{t('等待说明')}</span>
                  <textarea
                    rows={4}
                    value={waitingInstructions}
                    onChange={(event) => setWaitingInstructions(event.target.value)}
                    placeholder={t('例如：等设计确认后再继续。')}
                  />
                </label>
              </div>
            </section>
          ) : (
            <>
              <section className="pluse-task-modal-section">
                <header className="pluse-task-modal-section-head">
                  <h3>{t('执行')}</h3>
                </header>
                <div className="pluse-task-modal-grid pluse-task-detail-config-grid">
                  <div className="pluse-task-modal-field pluse-task-modal-field-span">
                    <span>{t('工具')}</span>
                    <SegmentedControl
                      value={tool}
                      options={toolOptions}
                      ariaLabel={t('工具')}
                      onChange={(nextTool) => {
                        setTool(nextTool)
                        setCatalog(buildFallbackRuntimeModelCatalog(nextTool))
                        setModel(defaultRuntimeModelId(nextTool))
                        setEffort(defaultRuntimeEffortId(nextTool))
                      }}
                    />
                  </div>

                  <label className="pluse-task-modal-field">
                    <span>{t('模型')}</span>
                    <select value={resolvedModel} onChange={(event) => setModel(event.target.value)}>
                      {catalog?.models.map((item) => (
                        <option key={item.id} value={item.id}>{item.label}</option>
                      ))}
                    </select>
                  </label>

                  {effortOptions.length > 0 ? (
                    <div className="pluse-task-modal-field">
                      <span>{t('推理强度')}</span>
                      <SegmentedControl
                        value={resolveRuntimeEffortSelection(tool, effort, catalog)}
                        options={effortChoiceOptions}
                        ariaLabel={t('推理强度')}
                        onChange={setEffort}
                      />
                    </div>
                  ) : null}

                  <div className="pluse-task-toggle-grid pluse-task-modal-field-span">
                    <TaskSettingSwitch
                      label={t('继续上下文')}
                      note={t('保留当前 Quest 的上下文继续跑')}
                      checked={continueQuest}
                      onChange={setContinueQuest}
                    />
                    <TaskSettingSwitch
                      label={t('深度思考')}
                      note={t('需要时让模型展开更长推理')}
                      checked={thinking}
                      onChange={setThinking}
                    />
                    <TaskSettingSwitch
                      label={t('运行后复盘')}
                      note={t('任务结束后补一条 review todo')}
                      checked={reviewOnComplete}
                      onChange={setReviewOnComplete}
                    />
                  </div>
                </div>
              </section>

              <section className="pluse-task-modal-section">
                <header className="pluse-task-modal-section-head">
                  <h3>{t('执行器')}</h3>
                </header>
                <div className="pluse-task-modal-grid pluse-task-detail-config-grid">
                  <div className="pluse-task-modal-field pluse-task-modal-field-span">
                    <span>{t('执行类型')}</span>
                    <SegmentedControl value={executorKind} options={executorKindOptions} onChange={setExecutorKind} ariaLabel={t('执行类型')} />
                  </div>

                  {executorKind === 'ai_prompt' ? (
                    <>
                      <label className="pluse-task-modal-field pluse-task-modal-field-span">
                        <span>{t('提示词')}</span>
                        <textarea
                          rows={7}
                          value={prompt}
                          onChange={(event) => setPrompt(event.target.value)}
                          placeholder={t('输入提示词')}
                        />
                      </label>
                    </>
                  ) : (
                    <>
                      <label className="pluse-task-modal-field pluse-task-modal-field-span">
                        <span>{t('命令')}</span>
                        <textarea
                          rows={4}
                          value={command}
                          onChange={(event) => setCommand(event.target.value)}
                          placeholder="pnpm test"
                        />
                      </label>

                      <label className="pluse-task-modal-field">
                        <span>{t('工作目录')}</span>
                        <input
                          value={workDir}
                          onChange={(event) => setWorkDir(event.target.value)}
                          placeholder="/abs/path"
                        />
                      </label>

                      <label className="pluse-task-modal-field">
                        <span>{t('超时（秒）')}</span>
                        <input
                          value={timeout}
                          onChange={(event) => setTimeoutValue(event.target.value)}
                          placeholder="300"
                        />
                      </label>

                      <label className="pluse-task-modal-field pluse-task-modal-field-span">
                        <span>{t('环境变量')}</span>
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
                  <h3>{t('调度')}</h3>
                </header>
                <div className="pluse-task-modal-grid pluse-task-detail-config-grid">
                  <div className="pluse-task-modal-field pluse-task-modal-field-span">
                    <span>{t('调度方式')}</span>
                    <SegmentedControl value={scheduleKind} options={scheduleKindOptions} onChange={setScheduleKind} ariaLabel={t('调度方式')} />
                  </div>

                  {scheduleKind === 'once' ? (
                    <p className="pluse-task-detail-inline-note pluse-task-modal-field-span">{t('仅在你手动点击运行时执行。')}</p>
                  ) : null}

                  {scheduleKind === 'scheduled' ? (
                    <>
                      <div className="pluse-task-modal-field pluse-task-modal-field-span">
                        <span>{t('快捷设置')}</span>
                        <div className="pluse-task-quick-presets">
                          {scheduledQuickOptions.map((option) => (
                            <button
                              key={option.id}
                              type="button"
                              className={`pluse-task-quick-preset${runAt === option.value ? ' is-active' : ''}`}
                              onClick={() => setRunAt(option.value)}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <label className="pluse-task-modal-field">
                        <span>{t('运行时间')}</span>
                        <input type="datetime-local" value={runAt} onChange={(event) => setRunAt(event.target.value)} />
                      </label>
                      <p className="pluse-task-detail-inline-note pluse-task-modal-field-span">
                        {t('计划时间：{{time}}', { time: scheduledSummary })} · {t('自动按本机时区执行')}
                      </p>
                    </>
                  ) : null}

                  {scheduleKind === 'recurring' ? (
                    <>
                      <div className="pluse-task-modal-field pluse-task-modal-field-span">
                        <span>{t('重复频率')}</span>
                        <SegmentedControl value={recurringPreset} options={recurringPresetOptions} onChange={setRecurringPreset} ariaLabel={t('重复频率')} />
                      </div>
                      {recurringPreset === 'custom' ? (
                        <label className="pluse-task-modal-field pluse-task-modal-field-span">
                          <span>Cron</span>
                          <input value={cron} onChange={(event) => setCron(event.target.value)} placeholder="0 9 * * 1-5" />
                        </label>
                      ) : (
                        <>
                          <label className="pluse-task-modal-field">
                            <span>{t('执行时间')}</span>
                            <input type="time" value={recurringTime} onChange={(event) => setRecurringTime(event.target.value)} />
                          </label>
                          {recurringPreset === 'weekly' ? (
                            <div className="pluse-task-modal-field pluse-task-modal-field-span">
                              <span>{t('星期')}</span>
                              <SegmentedControl value={recurringWeekday} options={recurringWeekdayOptions} onChange={setRecurringWeekday} ariaLabel={t('星期')} />
                            </div>
                          ) : null}
                          {recurringPreset === 'monthly' ? (
                            <label className="pluse-task-modal-field">
                              <span>{t('日期')}</span>
                              <input type="number" min="1" max="31" value={recurringMonthDay} onChange={(event) => setRecurringMonthDay(event.target.value)} />
                            </label>
                          ) : null}
                        </>
                      )}
                      <p className="pluse-task-detail-inline-note pluse-task-modal-field-span">
                        {recurringSummary} · {t('自动按本机时区执行')}
                      </p>
                    </>
                  ) : null}
                </div>
              </section>
            </>
          )}

          {error ? <p className="pluse-error">{error}</p> : null}

          <footer className="pluse-task-modal-actions">
            <button type="button" className="pluse-button pluse-button-ghost" onClick={onClose} disabled={saving}>
              {t('取消')}
            </button>
            <button type="submit" className="pluse-button" disabled={!projectId || !title.trim() || saving}>
              {saving ? t('保存中…') : isConversionMode ? t('保存并转换') : kind === 'ai' ? t('创建自动化') : t('创建待办')}
            </button>
          </footer>
        </form>
      </section>
    </div>
  , document.body)
}

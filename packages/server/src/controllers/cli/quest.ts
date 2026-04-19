import { readFileSync } from 'node:fs'
import { Command } from 'commander'
import type {
  AiPromptConfig,
  CreateQuestInput,
  ExecutorOptions,
  MoveQuestInput,
  Quest,
  ScheduleConfig,
  ScriptConfig,
  UpdateQuestInput,
} from '@pluse/types'
import { getQuest, listQuests } from '../../models/quest'
import type { StartQuestRunResult, SubmitQuestMessageResult } from '../../runtime/session-runner'
import { startQuestRun, submitQuestMessage } from '../../runtime/session-runner'
import { createQuestWithEffects, deleteQuestWithEffects, moveQuestWithEffects, updateQuestWithEffects } from '../../services/quests'
import { daemonRequest, getCliMode, resolveDaemonBaseUrl } from '../../support/cli-runtime'

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2))
}

function printQuest(quest: Quest): void {
  console.log(`${quest.id}  ${quest.kind}  ${quest.name ?? quest.title ?? 'Untitled'}`)
  console.log(`  project: ${quest.projectId}`)
  console.log(`  status: ${quest.status ?? 'n/a'}  tool: ${quest.tool ?? 'codex'}`)
}

type SharedTaskOptionFlags = {
  scheduleKind?: Quest['scheduleKind']
  cron?: string
  runAt?: string
  timezone?: string
  executorKind?: Quest['executorKind']
  prompt?: string
  promptFile?: string
  continueQuest?: boolean
  freshContext?: boolean
  var?: string[]
  command?: string
  workDir?: string
  env?: string[]
  timeout?: number
  enable?: boolean
  disable?: boolean
  reviewOnComplete?: boolean
  order?: number
  effort?: string
  thinking?: boolean
}

type QuestCreateOptions = SharedTaskOptionFlags & {
  projectId: string
  kind: Quest['kind']
  name?: string
  title?: string
  description?: string
  tool?: string
  model?: string
  status?: Quest['status']
  json: boolean
}

type QuestUpdateOptions = SharedTaskOptionFlags & {
  kind?: Quest['kind']
  name?: string
  title?: string
  description?: string
  status?: Quest['status']
  tool?: string
  model?: string
  pin?: boolean
  unpin?: boolean
  json: boolean
}

function collectRepeated(value: string, previous: string[] = []): string[] {
  return [...previous, value]
}

function hasValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0
  return value !== undefined
}

function parseKeyValueEntries(values: string[] | undefined, label: string): Record<string, string> | undefined {
  if (!values || values.length === 0) return undefined
  const record: Record<string, string> = {}
  for (const value of values) {
    const index = value.indexOf('=')
    if (index <= 0) {
      throw new Error(`${label} must use key=value format`)
    }
    const key = value.slice(0, index).trim()
    const rawValue = value.slice(index + 1)
    if (!key) {
      throw new Error(`${label} must use key=value format`)
    }
    record[key] = rawValue
  }
  return record
}

function readPromptValue(prompt?: string, promptFile?: string): string | undefined {
  if (prompt !== undefined && promptFile !== undefined) {
    throw new Error('Use either --prompt or --prompt-file, not both')
  }
  if (promptFile === undefined) return prompt
  try {
    return readFileSync(promptFile, 'utf8')
  } catch (error) {
    throw new Error(`Failed to read prompt file ${promptFile}: ${String(error)}`)
  }
}

function hasTaskOnlyCreateFlags(opts: QuestCreateOptions): boolean {
  return [
    opts.status,
    opts.scheduleKind,
    opts.cron,
    opts.runAt,
    opts.timezone,
    opts.executorKind,
    opts.prompt,
    opts.promptFile,
    opts.continueQuest,
    opts.freshContext,
    opts.var,
    opts.command,
    opts.workDir,
    opts.env,
    opts.timeout,
    opts.enable,
    opts.disable,
    opts.reviewOnComplete,
    opts.order,
  ].some(hasValue)
}

function hasTaskOnlyUpdateFlags(opts: QuestUpdateOptions): boolean {
  return [
    opts.scheduleKind,
    opts.cron,
    opts.runAt,
    opts.timezone,
    opts.executorKind,
    opts.prompt,
    opts.promptFile,
    opts.continueQuest,
    opts.freshContext,
    opts.var,
    opts.command,
    opts.workDir,
    opts.env,
    opts.timeout,
    opts.enable,
    opts.disable,
    opts.reviewOnComplete,
    opts.order,
  ].some(hasValue)
}

function resolveSchedulePatch(opts: SharedTaskOptionFlags, existing?: Quest): Pick<CreateQuestInput, 'scheduleKind' | 'scheduleConfig'> | Pick<UpdateQuestInput, 'scheduleKind' | 'scheduleConfig'> | {} {
  const scheduleFlagUsed = [opts.scheduleKind, opts.cron, opts.runAt, opts.timezone].some(hasValue)
  if (!scheduleFlagUsed) return {}

  const nextScheduleKind = opts.scheduleKind ?? existing?.scheduleKind
  if (!nextScheduleKind) {
    throw new Error('Schedule options require --schedule-kind')
  }
  if (opts.cron && nextScheduleKind !== 'recurring') {
    throw new Error('--cron can only be used with --schedule-kind recurring')
  }
  if (opts.runAt && nextScheduleKind !== 'scheduled') {
    throw new Error('--run-at can only be used with --schedule-kind scheduled')
  }
  if (opts.timezone && nextScheduleKind === 'once') {
    throw new Error('--timezone cannot be used with --schedule-kind once')
  }

  const previousConfig = existing?.scheduleKind === nextScheduleKind ? existing.scheduleConfig ?? {} : {}
  if (nextScheduleKind === 'once') {
    return {
      scheduleKind: nextScheduleKind,
      scheduleConfig: {},
    }
  }

  const scheduleConfig: ScheduleConfig = {}
  if (previousConfig.lastRunAt) scheduleConfig.lastRunAt = previousConfig.lastRunAt
  if (previousConfig.nextRunAt) scheduleConfig.nextRunAt = previousConfig.nextRunAt
  if (opts.timezone !== undefined) {
    scheduleConfig.timezone = opts.timezone
  } else if (previousConfig.timezone) {
    scheduleConfig.timezone = previousConfig.timezone
  }

  if (nextScheduleKind === 'recurring') {
    const cron = opts.cron ?? previousConfig.cron
    if (!cron?.trim()) {
      throw new Error('Recurring tasks require --cron')
    }
    scheduleConfig.cron = cron
  }

  if (nextScheduleKind === 'scheduled') {
    const runAt = opts.runAt ?? previousConfig.runAt
    if (!runAt?.trim()) {
      throw new Error('Scheduled tasks require --run-at')
    }
    scheduleConfig.runAt = runAt
  }

  return {
    scheduleKind: nextScheduleKind,
    scheduleConfig,
  }
}

function resolveExecutorPatch(opts: SharedTaskOptionFlags, existing?: Quest): Pick<CreateQuestInput, 'executorKind' | 'executorConfig' | 'executorOptions'> | Pick<UpdateQuestInput, 'executorKind' | 'executorConfig' | 'executorOptions'> | {} {
  const hasPromptFamilyFlags = [opts.prompt, opts.promptFile, opts.continueQuest, opts.freshContext, opts.var].some(hasValue)
  const hasScriptFamilyFlags = [opts.command, opts.workDir, opts.env, opts.timeout].some(hasValue)

  if (!hasPromptFamilyFlags && !hasScriptFamilyFlags && opts.executorKind === undefined) {
    return {}
  }
  if (opts.continueQuest !== undefined && opts.freshContext !== undefined) {
    throw new Error('Use either --continue-quest or --fresh-context, not both')
  }

  const promptValue = readPromptValue(opts.prompt, opts.promptFile)
  const envPatch = parseKeyValueEntries(opts.env, '--env')
  const varPatch = parseKeyValueEntries(opts.var, '--var')

  let nextExecutorKind = opts.executorKind
  if (!nextExecutorKind) {
    if (hasPromptFamilyFlags && !hasScriptFamilyFlags) {
      nextExecutorKind = 'ai_prompt'
    } else if (hasScriptFamilyFlags && !hasPromptFamilyFlags) {
      nextExecutorKind = 'script'
    } else {
      nextExecutorKind = existing?.executorKind
    }
  }
  if (!nextExecutorKind) {
    throw new Error('Executor options require --executor-kind')
  }

  if (nextExecutorKind === 'ai_prompt' && hasScriptFamilyFlags) {
    throw new Error('Script options cannot be used with ai_prompt executor')
  }
  if (nextExecutorKind === 'script' && hasPromptFamilyFlags) {
    throw new Error('Prompt options cannot be used with script executor')
  }

  if (nextExecutorKind === 'ai_prompt') {
    const previousConfig = existing?.executorKind === 'ai_prompt' && existing.executorConfig && 'prompt' in existing.executorConfig
      ? existing.executorConfig as AiPromptConfig
      : undefined
    const prompt = promptValue ?? previousConfig?.prompt
    if (!prompt?.trim()) {
      throw new Error('ai_prompt executor requires --prompt or --prompt-file on first set')
    }
    const patch: Pick<CreateQuestInput, 'executorKind' | 'executorConfig' | 'executorOptions'> = {
      executorKind: nextExecutorKind,
      executorConfig: { prompt },
    }
    if (opts.continueQuest !== undefined || opts.freshContext !== undefined || varPatch) {
      const existingOptions = existing?.executorOptions ?? {}
      const nextOptions: ExecutorOptions = {}
      if (opts.continueQuest !== undefined) nextOptions.continueQuest = true
      if (opts.freshContext !== undefined) nextOptions.continueQuest = false
      if (varPatch) {
        nextOptions.customVars = {
          ...(existing?.executorKind === 'ai_prompt' ? existingOptions.customVars ?? {} : {}),
          ...varPatch,
        }
      }
      patch.executorOptions = nextOptions
    }
    return patch
  }

  const previousConfig = existing?.executorKind === 'script' && existing.executorConfig && 'command' in existing.executorConfig
    ? existing.executorConfig as ScriptConfig
    : undefined
  const command = opts.command ?? previousConfig?.command
  if (!command?.trim()) {
    throw new Error('script executor requires --command on first set')
  }
  const executorConfig: ScriptConfig = { command }
  if (opts.workDir !== undefined) {
    executorConfig.workDir = opts.workDir
  } else if (previousConfig?.workDir) {
    executorConfig.workDir = previousConfig.workDir
  }
  if (opts.timeout !== undefined) {
    executorConfig.timeout = opts.timeout
  } else if (previousConfig?.timeout !== undefined) {
    executorConfig.timeout = previousConfig.timeout
  }
  const env = {
    ...(previousConfig?.env ?? {}),
    ...(envPatch ?? {}),
  }
  if (Object.keys(env).length > 0) {
    executorConfig.env = env
  }
  return {
    executorKind: nextExecutorKind,
    executorConfig,
  }
}

function buildTaskCreateInput(opts: QuestCreateOptions): Partial<CreateQuestInput> {
  if (opts.enable && opts.disable) {
    throw new Error('Use either --enable or --disable, not both')
  }
  if (opts.kind !== 'task') {
    if (hasTaskOnlyCreateFlags(opts)) {
      throw new Error('Task-only quest flags require --kind task')
    }
    return {}
  }

  const input: Partial<CreateQuestInput> = {
    status: opts.status,
    enabled: opts.enable ? true : opts.disable ? false : undefined,
    reviewOnComplete: opts.reviewOnComplete,
    order: opts.order,
  }
  Object.assign(input, resolveSchedulePatch(opts))
  Object.assign(input, resolveExecutorPatch(opts))
  return input
}

function buildTaskUpdatePatch(existing: Quest, opts: QuestUpdateOptions): Partial<UpdateQuestInput> {
  if (opts.enable && opts.disable) {
    throw new Error('Use either --enable or --disable, not both')
  }
  const nextKind = opts.kind ?? existing.kind
  if (nextKind !== 'task' && hasTaskOnlyUpdateFlags(opts)) {
    throw new Error('Task-only quest flags require the resulting quest kind to be task')
  }
  if (nextKind !== 'task') return {}

  const patch: Partial<UpdateQuestInput> = {
    reviewOnComplete: opts.reviewOnComplete,
    order: opts.order,
    enabled: opts.enable ? true : opts.disable ? false : undefined,
  }
  Object.assign(patch, resolveSchedulePatch(opts, existing))
  Object.assign(patch, resolveExecutorPatch(opts, existing))
  return patch
}

async function loadQuest(baseUrl: string | null, id: string): Promise<Quest> {
  const quest = baseUrl ? await daemonRequest<Quest>(baseUrl, `/api/quests/${id}`) : getQuest(id)
  if (!quest) throw new Error(`Quest not found: ${id}`)
  return quest
}

function addSharedTaskOptions(command: Command): Command {
  return command
    .option('--status <status>', 'Quest status')
    .option('--effort <effort>', 'Reasoning effort')
    .option('--thinking', 'Enable thinking mode')
    .option('--no-thinking', 'Disable thinking mode')
    .option('--enable', 'Enable task scheduling')
    .option('--disable', 'Disable task scheduling')
    .option('--schedule-kind <kind>', 'Task schedule kind')
    .option('--cron <expr>', 'Recurring cron expression')
    .option('--run-at <iso>', 'Scheduled run time (ISO 8601)')
    .option('--timezone <tz>', 'Task schedule timezone')
    .option('--executor-kind <kind>', 'Task executor kind')
    .option('--prompt <text>', 'Prompt text for ai_prompt executor')
    .option('--prompt-file <path>', 'Read prompt text from file')
    .option('--continue-quest', 'Resume the existing AI context')
    .option('--fresh-context', 'Force each task run to use a new context')
    .option('--var <key=value>', 'Set an ai_prompt custom variable', collectRepeated, [])
    .option('--command <shell>', 'Shell command for script executor')
    .option('--work-dir <path>', 'Working directory for script executor')
    .option('--env <key=value>', 'Set a script environment variable', collectRepeated, [])
    .option('--timeout <seconds>', 'Script timeout in seconds', (value: string) => {
      const parsed = Number.parseInt(value, 10)
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error('--timeout must be a positive integer')
      }
      return parsed
    })
    .option('--review-on-complete', 'Create a review todo when the task completes')
    .option('--no-review-on-complete', 'Do not create a review todo when the task completes')
    .option('--order <n>', 'Task sort order', (value: string) => {
      const parsed = Number.parseInt(value, 10)
      if (!Number.isInteger(parsed)) {
        throw new Error('--order must be an integer')
      }
      return parsed
    })
}

export const questCommand = new Command('quest')
questCommand.description('Manage quests')

questCommand
  .command('list')
  .option('--project-id <id>', 'Project id')
  .option('--kind <kind>', 'session or task')
  .option('--status <status>', 'Quest status')
  .option('--search <query>', 'Search string')
  .option('--json', 'Output as JSON', false)
  .action(async (opts: { projectId?: string; kind?: Quest['kind']; status?: Quest['status']; search?: string; json: boolean }) => {
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode)
    const params = new URLSearchParams()
    if (opts.projectId) params.set('projectId', opts.projectId)
    if (opts.kind) params.set('kind', opts.kind)
    if (opts.status) params.set('status', opts.status)
    if (opts.search) params.set('search', opts.search)
    const quests = baseUrl
      ? await daemonRequest<Quest[]>(baseUrl, `/api/quests${params.toString() ? `?${params.toString()}` : ''}`)
      : listQuests({ projectId: opts.projectId, kind: opts.kind, status: opts.status, deleted: false })
    if (opts.json) {
      printJson(quests)
      return
    }
    quests.forEach(printQuest)
  })

questCommand
  .command('get <id>')
  .option('--json', 'Output as JSON', false)
  .action(async (id: string, opts: { json: boolean }) => {
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode)
    const quest = baseUrl ? await daemonRequest<Quest>(baseUrl, `/api/quests/${id}`) : getQuest(id)
    if (!quest) throw new Error(`Quest not found: ${id}`)
    opts.json ? printJson(quest) : printQuest(quest)
  })

const taskQuestCreateExample = [
  'Example task quest:',
  '  pluse quest create --project-id proj_music --kind task --title "Music Essay"',
  '    --tool codex --model gpt-5.3-codex --schedule-kind recurring --cron "*/30 * * * *"',
  '    --timezone Asia/Shanghai --executor-kind ai_prompt',
  '    --prompt "Use the local NetEase CLI in this project to read the current song, then write a short Chinese essay about the mood of the track."',
  '    --continue-quest --review-on-complete --enable',
].join('\n')

const questCreateCommand = questCommand
  .command('create')
  .description('Create a quest; task quests can include schedule and executor settings in one command')
  .requiredOption('--project-id <id>', 'Project id')
  .requiredOption('--kind <kind>', 'session or task')
  .option('--name <name>', 'Session-style name')
  .option('--title <title>', 'Task-style title')
  .option('--description <description>', 'Description')
  .option('--tool <tool>', 'codex or claude')
  .option('--model <model>', 'Model id')
  .option('--json', 'Output as JSON', false)
addSharedTaskOptions(questCreateCommand)
questCreateCommand
  .addHelpText('after', `\n${taskQuestCreateExample}\n`)
  .action(async (opts: QuestCreateOptions) => {
    const input: CreateQuestInput = {
      projectId: opts.projectId,
      kind: opts.kind,
      name: opts.name,
      title: opts.title,
      description: opts.description,
      tool: opts.tool,
      model: opts.model,
      effort: opts.effort,
      thinking: opts.thinking,
      createdBy: 'human',
      ...buildTaskCreateInput(opts),
    }
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode, { requireWrite: true })
    const quest = baseUrl
      ? await daemonRequest<Quest>(baseUrl, '/api/quests', { method: 'POST', body: JSON.stringify(input) })
      : createQuestWithEffects(input)
    opts.json ? printJson(quest) : printQuest(quest)
  })

const questUpdateCommand = questCommand
  .command('update <id>')
  .description('Update quest fields; task quests support the same schedule and executor flags as create')
  .option('--kind <kind>', 'session or task')
  .option('--name <name>', 'Name')
  .option('--title <title>', 'Title')
  .option('--description <description>', 'Description')
  .option('--tool <tool>', 'Tool')
  .option('--model <model>', 'Model')
  .option('--pin', 'Pin quest')
  .option('--unpin', 'Unpin quest')
  .option('--json', 'Output as JSON', false)
addSharedTaskOptions(questUpdateCommand)
questUpdateCommand
  .action(async (id: string, opts: QuestUpdateOptions) => {
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode, { requireWrite: true })
    const existing = await loadQuest(baseUrl, id)
    const patch: UpdateQuestInput = {
      kind: opts.kind,
      name: opts.name,
      title: opts.title,
      description: opts.description,
      status: opts.status,
      tool: opts.tool,
      model: opts.model,
      effort: opts.effort,
      thinking: opts.thinking,
      pinned: opts.pin ? true : opts.unpin ? false : undefined,
      ...buildTaskUpdatePatch(existing, opts),
    }
    const quest = baseUrl
      ? await daemonRequest<Quest>(baseUrl, `/api/quests/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })
      : updateQuestWithEffects(id, patch)
    opts.json ? printJson(quest) : printQuest(quest)
  })

questCommand
  .command('move <id>')
  .requiredOption('--to-project-id <id>', 'Target project id')
  .option('--json', 'Output as JSON', false)
  .action(async (id: string, opts: { toProjectId: string; json: boolean }) => {
    const input: MoveQuestInput = {
      targetProjectId: opts.toProjectId,
    }
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode, { requireWrite: true })
    const quest = baseUrl
      ? await daemonRequest<Quest>(baseUrl, `/api/quests/${id}/move`, { method: 'POST', body: JSON.stringify(input) })
      : moveQuestWithEffects(id, input)
    opts.json ? printJson(quest) : printQuest(quest)
  })

questCommand
  .command('delete <id>')
  .option('--confirm', 'Skip confirmation prompt', false)
  .action(async (id: string, opts: { confirm: boolean }) => {
    if (!opts.confirm) {
      console.error('Add --confirm to archive this quest.')
      process.exit(1)
    }
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode, { requireWrite: true })
    if (baseUrl) {
      await daemonRequest(baseUrl, `/api/quests/${id}`, { method: 'DELETE' })
    } else {
      deleteQuestWithEffects(id)
    }
    console.log(`Quest ${id} archived.`)
  })

questCommand
  .command('message <id>')
  .requiredOption('--text <text>', 'Message text')
  .option('--tool <tool>', 'codex or claude')
  .option('--model <model>', 'Model id')
  .option('--json', 'Output as JSON', false)
  .action(async (id: string, opts: { text: string; tool?: string; model?: string; json: boolean }) => {
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode, { requireWrite: true })
    const result: SubmitQuestMessageResult = baseUrl
      ? await daemonRequest<SubmitQuestMessageResult>(baseUrl, `/api/quests/${id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ text: opts.text, tool: opts.tool, model: opts.model }),
      })
      : submitQuestMessage({ questId: id, text: opts.text, tool: opts.tool, model: opts.model })
    opts.json ? printJson(result) : console.log(result.queued ? 'Queued' : `Started ${result.run?.id ?? ''}`.trim())
  })

questCommand
  .command('run <id>')
  .option('--json', 'Output as JSON', false)
  .action(async (id: string, opts: { json: boolean }) => {
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode, { requireWrite: true })
    const result: StartQuestRunResult = baseUrl
      ? await daemonRequest<StartQuestRunResult>(baseUrl, `/api/quests/${id}/run`, { method: 'POST', body: JSON.stringify({ trigger: 'manual', triggeredBy: 'cli' }) })
      : await startQuestRun({ questId: id, trigger: 'manual', triggeredBy: 'cli' })
    opts.json ? printJson(result) : console.log(result.skipped ? 'Skipped' : `Started ${result.run?.id ?? ''}`.trim())
  })

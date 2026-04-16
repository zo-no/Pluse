import { Command } from 'commander'
import type { CreateTaskInput, Task, UpdateTaskInput } from '@melody-sync/types'
import { getTaskView, createTaskWithEffects, updateTaskWithEffects, deleteTaskWithEffects, listTaskViews, runTaskNow, markTaskDone, cancelTask } from '../../services/tasks'
import { daemonRequest, getCliMode, resolveDaemonBaseUrl } from '../../support/cli-runtime'

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2))
}

function buildTaskInput(opts: any): CreateTaskInput {
  const surface = opts.surface ?? 'project'
  const visibleInChat = opts.visibleInChat ?? surface === 'chat_short'
  const executor = opts.executor === 'script'
    ? { kind: 'script' as const, command: opts.command, workDir: opts.workDir }
    : opts.executor === 'http'
      ? { kind: 'http' as const, url: opts.url, method: opts.method ?? 'POST' }
      : opts.prompt
        ? { kind: 'ai_prompt' as const, prompt: opts.prompt, agent: opts.agent ?? 'codex', model: opts.model }
        : undefined

  const scheduleConfig = opts.kind === 'scheduled' && opts.scheduledAt
    ? { kind: 'scheduled' as const, scheduledAt: opts.scheduledAt }
    : opts.kind === 'recurring' && opts.cron
      ? { kind: 'recurring' as const, cron: opts.cron, timezone: opts.timezone }
      : undefined

  return {
    projectId: opts.projectId,
    sessionId: opts.sessionId,
    title: opts.title,
    description: opts.description,
    assignee: opts.assignee ?? 'human',
    kind: opts.kind ?? 'once',
    surface,
    visibleInChat,
    origin: opts.origin ?? 'manual',
    executor,
    scheduleConfig,
    enabled: opts.enabled !== false,
    createdBy: opts.createdBy ?? 'human',
    waitingInstructions: opts.waitingInstructions,
  }
}

export const taskCommand = new Command('task')
taskCommand.description('Manage Pulse tasks')

taskCommand
  .command('list')
  .option('--project-id <id>', 'Filter by project id')
  .option('--session-id <id>', 'Filter by session id')
  .option('--surface <surface>', 'chat_short or project')
  .option('--visible-in-chat', 'Only include visible chat tasks')
  .option('--status <status>', 'Filter by status')
  .option('--kind <kind>', 'Filter by kind')
  .option('--json', 'Output as JSON', false)
  .action(async (opts: any) => {
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode)
    const params = new URLSearchParams()
    if (opts.projectId) params.set('projectId', opts.projectId)
    if (opts.sessionId) params.set('sessionId', opts.sessionId)
    if (opts.surface) params.set('surface', opts.surface)
    if (opts.visibleInChat) params.set('visibleInChat', 'true')
    if (opts.status) params.set('status', opts.status)
    if (opts.kind) params.set('kind', opts.kind)
    const path = `/api/tasks${params.toString() ? `?${params.toString()}` : ''}`
    const tasks: Task[] = baseUrl ? await daemonRequest<Task[]>(baseUrl, path) : listTaskViews({
      projectId: opts.projectId,
      sessionId: opts.sessionId,
      surface: opts.surface,
      visibleInChat: opts.visibleInChat ? true : undefined,
      status: opts.status,
      kind: opts.kind,
    })
    opts.json ? printJson(tasks) : tasks.forEach((task) => console.log(`${task.id}  ${task.title}`))
  })

taskCommand
  .command('get <id>')
  .option('--json', 'Output as JSON', false)
  .action(async (id: string, opts: { json: boolean }) => {
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode)
    const task: Task | null = baseUrl ? await daemonRequest<Task>(baseUrl, `/api/tasks/${id}`) : getTaskView(id)
    if (!task) throw new Error(`Task not found: ${id}`)
    opts.json ? printJson(task) : console.log(`${task.id}  ${task.title}`)
  })

taskCommand
  .command('create')
  .requiredOption('--project-id <id>', 'Owning project id')
  .requiredOption('--title <title>', 'Task title')
  .option('--session-id <id>', 'Session id')
  .option('--description <description>', 'Task description')
  .option('--assignee <assignee>', 'ai or human')
  .option('--kind <kind>', 'once | scheduled | recurring')
  .option('--surface <surface>', 'chat_short | project')
  .option('--visible-in-chat', 'Expose in chat rail')
  .option('--origin <origin>', 'agent | manual | scheduler | system')
  .option('--executor <kind>', 'script | http')
  .option('--command <command>', 'Script command')
  .option('--work-dir <path>', 'Executor work dir override')
  .option('--url <url>', 'HTTP executor URL')
  .option('--method <method>', 'HTTP executor method')
  .option('--prompt <prompt>', 'AI prompt executor template')
  .option('--agent <agent>', 'codex or claude')
  .option('--model <model>', 'AI model')
  .option('--scheduled-at <iso>', 'Scheduled run time')
  .option('--cron <expr>', 'Recurring cron')
  .option('--timezone <tz>', 'Recurring task timezone')
  .option('--waiting-instructions <text>', 'Human task guidance')
  .option('--json', 'Output as JSON', false)
  .action(async (opts: any) => {
    const input = buildTaskInput(opts)
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode, { requireWrite: true })
    const task: Task = baseUrl
      ? await daemonRequest<Task>(baseUrl, '/api/tasks', { method: 'POST', body: JSON.stringify(input) })
      : createTaskWithEffects(input)
    opts.json ? printJson(task) : console.log(`${task.id}  ${task.title}`)
  })

taskCommand
  .command('update <id>')
  .option('--title <title>', 'Task title')
  .option('--description <description>', 'Task description')
  .option('--status <status>', 'Task status')
  .option('--surface <surface>', 'chat_short | project')
  .option('--visible-in-chat', 'Expose in chat rail')
  .option('--hide-in-chat', 'Hide from chat rail')
  .option('--json', 'Output as JSON', false)
  .action(async (id: string, opts: any) => {
    const patch: UpdateTaskInput = {
      title: opts.title,
      description: opts.description,
      status: opts.status,
      surface: opts.surface,
      visibleInChat: opts.visibleInChat ? true : opts.hideInChat ? false : undefined,
    }
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode, { requireWrite: true })
    const task: Task = baseUrl
      ? await daemonRequest<Task>(baseUrl, `/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })
      : updateTaskWithEffects(id, patch)
    opts.json ? printJson(task) : console.log(`${task.id}  ${task.title}`)
  })

taskCommand
  .command('run <id>')
  .action(async (id: string) => {
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode, { requireWrite: true })
    if (baseUrl) {
      await daemonRequest(baseUrl, `/api/tasks/${id}/run`, { method: 'POST' })
    } else {
      await runTaskNow(id, 'cli')
    }
  })

taskCommand
  .command('done <id>')
  .option('--output <text>', 'Completion output')
  .option('--json', 'Output as JSON', false)
  .action(async (id: string, opts: { output?: string; json: boolean }) => {
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode, { requireWrite: true })
    const task: Task = baseUrl
      ? await daemonRequest<Task>(baseUrl, `/api/tasks/${id}/done`, { method: 'POST', body: JSON.stringify({ output: opts.output }) })
      : await markTaskDone(id, opts.output)
    opts.json ? printJson(task) : console.log(`${task.id}  ${task.title}`)
  })

taskCommand
  .command('cancel <id>')
  .option('--json', 'Output as JSON', false)
  .action(async (id: string, opts: { json: boolean }) => {
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode, { requireWrite: true })
    const task: Task = baseUrl
      ? await daemonRequest<Task>(baseUrl, `/api/tasks/${id}/cancel`, { method: 'POST' })
      : cancelTask(id)
    opts.json ? printJson(task) : console.log(`${task.id}  ${task.title}`)
  })

taskCommand
  .command('delete <id>')
  .action(async (id: string) => {
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode, { requireWrite: true })
    if (baseUrl) {
      await daemonRequest(baseUrl, `/api/tasks/${id}`, { method: 'DELETE' })
    } else {
      deleteTaskWithEffects(id)
    }
  })

import { Command } from 'commander'
import type { CreateTaskInput, Task, UpdateTaskInput } from '@pluse/types'
import { getTaskView, createTaskWithEffects, updateTaskWithEffects, deleteTaskWithEffects, listTaskViews, runTaskNow, markTaskDone, cancelTask } from '../../services/tasks'
import { daemonRequest, getCliMode, resolveDaemonBaseUrl } from '../../support/cli-runtime'

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2))
}

function buildTaskInput(opts: any): CreateTaskInput {
  const executor = opts.executor === 'script'
    ? { kind: 'script' as const, command: opts.command, workDir: opts.workDir }
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
    originSessionId: opts.originSessionId,
    title: opts.title,
    description: opts.description,
    assignee: opts.assignee ?? 'human',
    kind: opts.kind ?? 'once',
    executor,
    scheduleConfig,
    enabled: opts.enabled !== false,
    createdBy: opts.createdBy ?? 'human',
    waitingInstructions: opts.waitingInstructions,
    reviewOnComplete: opts.reviewOnComplete,
  }
}

export const taskCommand = new Command('task')
taskCommand.description('Manage Pluse tasks')

taskCommand
  .command('list')
  .option('--project-id <id>', 'Filter by project id')
  .option('--session-id <id>', 'Filter by session id')
  .option('--status <status>', 'Filter by status')
  .option('--assignee <assignee>', 'Filter by assignee (ai|human)')
  .option('--kind <kind>', 'Filter by kind')
  .option('--json', 'Output as JSON', false)
  .action(async (opts: any) => {
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode)
    const params = new URLSearchParams()
    if (opts.projectId) params.set('projectId', opts.projectId)
    if (opts.sessionId) params.set('sessionId', opts.sessionId)
    if (opts.status) params.set('status', opts.status)
    if (opts.assignee) params.set('assignee', opts.assignee)
    if (opts.kind) params.set('kind', opts.kind)
    const path = `/api/tasks${params.toString() ? `?${params.toString()}` : ''}`
    const tasks: Task[] = baseUrl ? await daemonRequest<Task[]>(baseUrl, path) : listTaskViews({
      projectId: opts.projectId,
      sessionId: opts.sessionId,
      status: opts.status,
      assignee: opts.assignee,
      kind: opts.kind,
    })
    opts.json ? printJson(tasks) : tasks.forEach((task) => console.log(`${task.id}  [${task.assignee}] ${task.title}`))
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
  .option('--origin-session-id <id>', 'Origin session id (traceability)')
  .option('--description <description>', 'Task description')
  .option('--assignee <assignee>', 'ai or human')
  .option('--kind <kind>', 'once | scheduled | recurring')
  .option('--executor <kind>', 'script | ai_prompt')
  .option('--command <command>', 'Script command')
  .option('--work-dir <path>', 'Executor work dir override')
  .option('--prompt <prompt>', 'AI prompt executor template')
  .option('--agent <agent>', 'codex or claude')
  .option('--model <model>', 'AI model')
  .option('--scheduled-at <iso>', 'Scheduled run time')
  .option('--cron <expr>', 'Recurring cron')
  .option('--timezone <tz>', 'Recurring task timezone')
  .option('--waiting-instructions <text>', 'Human task guidance')
  .option('--review-on-complete', 'Create a human review task on completion')
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
  .option('--json', 'Output as JSON', false)
  .action(async (id: string, opts: any) => {
    const patch: UpdateTaskInput = {
      title: opts.title,
      description: opts.description,
      status: opts.status,
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
  .command('block <id>')
  .requiredOption('--by <blockerId>', 'Task id that blocks this task')
  .option('--json', 'Output as JSON', false)
  .action(async (id: string, opts: { by: string; json: boolean }) => {
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode, { requireWrite: true })
    const task: Task = baseUrl
      ? await daemonRequest<Task>(baseUrl, `/api/tasks/${id}/block`, { method: 'POST', body: JSON.stringify({ blockerId: opts.by }) })
      : updateTaskWithEffects(id, { blockedByTaskId: opts.by, status: 'blocked' })
    opts.json ? printJson(task) : console.log(`${task.id}  blocked by ${opts.by}`)
  })

taskCommand
  .command('unblock <id>')
  .option('--json', 'Output as JSON', false)
  .action(async (id: string, opts: { json: boolean }) => {
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode, { requireWrite: true })
    const task: Task = baseUrl
      ? await daemonRequest<Task>(baseUrl, `/api/tasks/${id}/block`, { method: 'DELETE' })
      : updateTaskWithEffects(id, { blockedByTaskId: null, status: 'pending' })
    opts.json ? printJson(task) : console.log(`${task.id}  unblocked`)
  })

taskCommand
  .command('create-session <id>')
  .option('--name <name>', 'Session name')
  .option('--json', 'Output as JSON', false)
  .action(async (id: string, opts: { name?: string; json: boolean }) => {
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode, { requireWrite: true })
    const result = baseUrl
      ? await daemonRequest<{ session: unknown; task: Task }>(baseUrl, `/api/tasks/${id}/create-session`, { method: 'POST', body: JSON.stringify({ name: opts.name }) })
      : null
    opts.json ? printJson(result) : console.log(`Session created for task ${id}`)
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

import { Command } from 'commander'
import type { CreateTodoInput, Quest, Todo, UpdateTodoInput } from '@pluse/types'
import { getQuest } from '../../models/quest'
import { getTodo, listQuestProgress } from '../../models/todo'
import { createTodoWithEffects, updateTodoWithEffects } from '../../services/todos'
import { daemonRequest, getCliMode, resolveDaemonBaseUrl } from '../../support/cli-runtime'

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2))
}

async function resolveQuestProjectId(baseUrl: string | null, questId: string): Promise<string | undefined> {
  if (baseUrl) {
    return (await daemonRequest<Quest>(baseUrl, `/api/quests/${questId}`)).projectId
  }
  return getQuest(questId)?.projectId
}

export const progressCommand = new Command('progress')
progressCommand.description('Manage quest progress items for AI plan/progress tracking')

progressCommand
  .command('list')
  .description('List progress items for a quest')
  .requiredOption('--quest-id <id>', 'Quest id')
  .option('--status <status>', 'pending, doing, done, or cancelled')
  .option('--json', 'Output as JSON', false)
  .action(async (opts: { questId: string; status?: Todo['status']; json: boolean }) => {
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode)
    let todos = baseUrl
      ? await daemonRequest<Todo[]>(baseUrl, `/api/quests/${opts.questId}/progress`)
      : listQuestProgress(opts.questId)

    if (opts.status) {
      todos = todos.filter((todo) => todo.status === opts.status)
    }

    if (opts.json) {
      printJson(todos)
      return
    }

    for (const todo of todos) {
      console.log(`${todo.id}  ${todo.status}  ${todo.title}`)
    }
  })

progressCommand
  .command('create')
  .description('Create a quest progress item for AI plan/progress tracking')
  .requiredOption('--quest-id <id>', 'Quest id')
  .option('--project-id <id>', 'Project id (optional; inferred from quest when possible)')
  .requiredOption('--title <title>', 'Task description (shown to user)')
  .option('--active-form <text>', 'In-progress description (defaults to title)')
  .option('--waiting <instructions>', 'Waiting for human: describe what the human needs to do')
  .option('--for <who>', 'Who this item is for: "ai" (default) or "human"', 'ai')
  .option('--order <n>', 'Display order (number)', '0')
  .option('--json', 'Output as JSON', false)
  .action(async (opts: {
    questId: string
    projectId?: string
    title: string
    activeForm?: string
    waiting?: string
    for: 'ai' | 'human'
    order: string
    json: boolean
  }) => {
    if (opts.for !== 'ai' && opts.for !== 'human') {
      console.error(`Invalid --for value: "${opts.for}". Use "ai" or "human".`)
      process.exit(1)
    }

    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode, { requireWrite: true })
    const projectId = opts.projectId ?? await resolveQuestProjectId(baseUrl, opts.questId)
    if (!projectId) {
      console.error('projectId is required. Pass --project-id or ensure the quest exists.')
      process.exit(1)
    }

    const forHuman = opts.for === 'human'
    const input: CreateTodoInput = {
      projectId,
      title: opts.title,
      activeForm: forHuman ? undefined : (opts.activeForm ?? opts.title),
      waitingInstructions: opts.waiting ?? (forHuman ? opts.title : undefined),
      originQuestId: opts.questId,
      createdBy: forHuman ? 'human' : 'ai',
      status: 'pending',
      order: parseInt(opts.order, 10) || 0,
    }
    const todo = baseUrl
      ? await daemonRequest<Todo>(baseUrl, '/api/todos', { method: 'POST', body: JSON.stringify(input) })
      : createTodoWithEffects(input)
    opts.json ? printJson(todo) : console.log(todo.id)
  })

progressCommand
  .command('wait <id>')
  .description('Block until a progress item is marked done or cancelled')
  .option('--timeout <seconds>', 'Max wait time in seconds (default: 600)', '600')
  .option('--interval <ms>', 'Poll interval in milliseconds (default: 2000)', '2000')
  .action(async (id: string, opts: { timeout: string; interval: string }) => {
    const timeoutMs = parseInt(opts.timeout, 10) * 1000
    const intervalMs = parseInt(opts.interval, 10)
    const deadline = Date.now() + timeoutMs
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode)

    const fetchTodo = async (): Promise<Todo> => {
      const todo = baseUrl
        ? await daemonRequest<Todo>(baseUrl, `/api/todos/${id}`)
        : getTodo(id)
      if (!todo) throw new Error(`Todo not found: ${id}`)
      return todo
    }

    const initial = await fetchTodo()
    if (initial.status === 'done' || initial.status === 'cancelled') {
      console.log(`${id}  ${initial.status}  ${initial.title}`)
      process.exit(initial.status === 'done' ? 0 : 1)
    }

    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
      const todo = await fetchTodo()
      if (todo.status === 'done' || todo.status === 'cancelled') {
        console.log(`${id}  ${todo.status}  ${todo.title}`)
        process.exit(todo.status === 'done' ? 0 : 1)
      }
    }

    console.error(`Timeout: todo ${id} was not completed within ${opts.timeout}s`)
    process.exit(2)
  })

progressCommand
  .command('update <id>')
  .description('Update a quest progress item status or display text')
  .option('--status <status>', 'pending | doing | done | cancelled')
  .option('--title <title>', 'Update task title')
  .option('--active-form <text>', 'Update in-progress description')
  .option('--json', 'Output as JSON', false)
  .action(async (id: string, opts: {
    status?: Todo['status']
    title?: string
    activeForm?: string
    json: boolean
  }) => {
    const validStatuses: Todo['status'][] = ['pending', 'doing', 'done', 'cancelled']
    if (opts.status !== undefined && !validStatuses.includes(opts.status)) {
      console.error(`Invalid status: ${opts.status}. Use: ${validStatuses.join(', ')}`)
      process.exit(1)
    }
    if (opts.status === undefined && opts.title === undefined && opts.activeForm === undefined) {
      console.error('At least one of --status, --title, or --active-form is required')
      process.exit(1)
    }
    const patch: UpdateTodoInput = {}
    if (opts.status !== undefined) patch.status = opts.status
    if (opts.title !== undefined) patch.title = opts.title
    if (opts.activeForm !== undefined) patch.activeForm = opts.activeForm
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode, { requireWrite: true })
    const todo = baseUrl
      ? await daemonRequest<Todo>(baseUrl, `/api/todos/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })
      : updateTodoWithEffects(id, patch)
    opts.json ? printJson(todo) : console.log(`${todo.id}  ${todo.status}  ${todo.title}`)
  })

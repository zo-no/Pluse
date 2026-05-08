import { Command } from 'commander'
import type { CreateTodoInput, Quest, Todo, TodoPriority, UpdateTodoInput } from '@pluse/types'
import { getQuest } from '../../models/quest'
import { getTodo, listQuestProgress, listTodos } from '../../models/todo'
import { createTodoWithEffects, deleteTodoWithEffects, updateTodoWithEffects } from '../../services/todos'
import { daemonRequest, getCliMode, resolveDaemonBaseUrl } from '../../support/cli-runtime'

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2))
}

function printTodo(todo: Todo): void {
  const priorityMark = todo.priority !== 'normal' ? ` [${todo.priority}]` : ''
  console.log(`${todo.id}  ${todo.status}${priorityMark}  ${todo.title}`)
  console.log(`  project: ${todo.projectId}`)
  if (todo.tags.length > 0) console.log(`  tags: ${todo.tags.join(', ')}`)
  if (todo.waitingInstructions) console.log(`  waiting: ${todo.waitingInstructions}`)
  if (todo.dueAt) console.log(`  due: ${todo.dueAt}`)
  if (todo.repeat !== 'none') console.log(`  repeat: ${todo.repeat}`)
}

async function resolveQuestProjectId(baseUrl: string | null, questId: string): Promise<string | undefined> {
  if (baseUrl) {
    return (await daemonRequest<Quest>(baseUrl, `/api/quests/${questId}`)).projectId
  }
  return getQuest(questId)?.projectId
}

export const todoCommand = new Command('todo')
todoCommand.description('Manage todos')

todoCommand
  .command('list')
  .option('--project-id <id>', 'Project id')
  .option('--quest-id <id>', 'Quest id (returns progress items for this quest)')
  .option('--status <status>', 'pending, doing, done, or cancelled')
  .option('--priority <priority>', 'urgent, high, normal, or low')
  .option('--tags <tags>', 'Comma-separated tags to filter by (OR semantics)')
  .option('--json', 'Output as JSON', false)
  .action(async (opts: { projectId?: string; questId?: string; status?: Todo['status']; priority?: TodoPriority; tags?: string; json: boolean }) => {
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode)
    const tags = opts.tags ? opts.tags.split(',').map((t) => t.trim()).filter(Boolean) : undefined
    const params = new URLSearchParams()
    if (opts.projectId) params.set('projectId', opts.projectId)
    if (opts.status) params.set('status', opts.status)
    if (opts.priority) params.set('priority', opts.priority)
    if (tags?.length) params.set('tags', tags.join(','))

    let todos = opts.questId
      ? baseUrl
        ? await daemonRequest<Todo[]>(baseUrl, `/api/quests/${opts.questId}/progress`)
        : listQuestProgress(opts.questId)
      : baseUrl
        ? await daemonRequest<Todo[]>(baseUrl, `/api/todos${params.toString() ? `?${params.toString()}` : ''}`)
        : listTodos({ projectId: opts.projectId, status: opts.status, priority: opts.priority, tags, deleted: false })

    if (opts.questId) {
      todos = todos.filter((todo) => {
        if (opts.status && todo.status !== opts.status) return false
        if (opts.priority && todo.priority !== opts.priority) return false
        if (tags?.length && !todo.tags.some((tag) => tags.some((candidate) => candidate.toLowerCase() === tag.toLowerCase()))) {
          return false
        }
        return true
      })
    }

    if (opts.json) {
      printJson(todos)
      return
    }
    todos.forEach(printTodo)
  })

todoCommand
  .command('get <id>')
  .option('--json', 'Output as JSON', false)
  .action(async (id: string, opts: { json: boolean }) => {
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode)
    const todo = baseUrl ? await daemonRequest<Todo>(baseUrl, `/api/todos/${id}`) : getTodo(id)
    if (!todo) throw new Error(`Todo not found: ${id}`)
    opts.json ? printJson(todo) : printTodo(todo)
  })

todoCommand
  .command('create')
  .requiredOption('--project-id <id>', 'Project id')
  .requiredOption('--title <title>', 'Todo title')
  .option('--description <description>', 'Description')
  .option('--waiting <instructions>', 'Waiting instructions')
  .option('--due-at <time>', 'Due time (ISO 8601)')
  .option('--repeat <repeat>', 'none, daily, weekly, or monthly')
  .option('--priority <priority>', 'urgent, high, normal, or low')
  .option('--tags <tags>', 'Comma-separated tags')
  .option('--origin-quest-id <id>', 'Origin quest')
  .option('--status <status>', 'pending, doing, done, or cancelled')
  .option('--order <n>', 'Display order (number)', '0')
  .option('--created-by <who>', 'human, ai, or system', 'human')
  .option('--json', 'Output as JSON', false)
  .action(async (opts: {
    projectId: string
    title: string
    description?: string
    waiting?: string
    dueAt?: string
    repeat?: Todo['repeat']
    priority?: TodoPriority
    tags?: string
    originQuestId?: string
    status?: Todo['status']
    order: string
    createdBy: Todo['createdBy']
    json: boolean
  }) => {
    const tags = opts.tags ? opts.tags.split(',').map((t) => t.trim()).filter(Boolean) : undefined
    const input: CreateTodoInput = {
      projectId: opts.projectId,
      title: opts.title,
      description: opts.description,
      waitingInstructions: opts.waiting,
      dueAt: opts.dueAt,
      repeat: opts.repeat,
      priority: opts.priority,
      tags,
      originQuestId: opts.originQuestId,
      createdBy: opts.createdBy,
      status: opts.status,
      order: parseInt(opts.order, 10) || 0,
    }
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode, { requireWrite: true })
    const todo = baseUrl
      ? await daemonRequest<Todo>(baseUrl, '/api/todos', { method: 'POST', body: JSON.stringify(input) })
      : createTodoWithEffects(input)
    opts.json ? printJson(todo) : printTodo(todo)
  })

todoCommand
  .command('update <id>')
  .option('--title <title>', 'Todo title')
  .option('--description <description>', 'Description')
  .option('--waiting <instructions>', 'Waiting instructions')
  .option('--due-at <time>', 'Due time (ISO 8601)')
  .option('--repeat <repeat>', 'none, daily, weekly, or monthly')
  .option('--clear-due', 'Clear due time', false)
  .option('--status <status>', 'pending, doing, done, or cancelled')
  .option('--priority <priority>', 'urgent, high, normal, or low')
  .option('--tags <tags>', 'Comma-separated tags (replaces all existing tags)')
  .option('--add-tags <tags>', 'Comma-separated tags to add')
  .option('--remove-tags <tags>', 'Comma-separated tags to remove')
  .option('--order <n>', 'Display order (number)')
  .option('--active-form <text>', 'In-progress description')
  .option('--json', 'Output as JSON', false)
  .action(async (id: string, opts: {
    title?: string
    description?: string
    waiting?: string
    dueAt?: string
    repeat?: Todo['repeat']
    clearDue: boolean
    status?: Todo['status']
    priority?: TodoPriority
    tags?: string
    addTags?: string
    removeTags?: string
    order?: string
    activeForm?: string
    json: boolean
  }) => {
    const patch: UpdateTodoInput = {
      title: opts.title,
      description: opts.description,
      waitingInstructions: opts.waiting,
      repeat: opts.repeat,
      status: opts.status,
      priority: opts.priority,
      activeForm: opts.activeForm,
    }
    if (opts.clearDue) patch.dueAt = null
    else if (opts.dueAt) patch.dueAt = opts.dueAt
    if (opts.order !== undefined) patch.order = parseInt(opts.order, 10) || 0

    const hasTagOps = opts.tags !== undefined || opts.addTags !== undefined || opts.removeTags !== undefined
    if (hasTagOps) {
      const mode = getCliMode()
      const baseUrl = await resolveDaemonBaseUrl(mode)
      const current = baseUrl
        ? await daemonRequest<Todo>(baseUrl, `/api/todos/${id}`)
        : getTodo(id)
      if (!current) throw new Error(`Todo not found: ${id}`)

      let resolvedTags: string[] = opts.tags !== undefined
        ? opts.tags.split(',').map((t) => t.trim()).filter(Boolean)
        : [...current.tags]

      if (opts.addTags) {
        const toAdd = opts.addTags.split(',').map((t) => t.trim()).filter(Boolean)
        for (const tag of toAdd) {
          if (!resolvedTags.some((t) => t.toLowerCase() === tag.toLowerCase())) {
            resolvedTags.push(tag)
          }
        }
      }
      if (opts.removeTags) {
        const toRemove = new Set(opts.removeTags.split(',').map((t) => t.trim().toLowerCase()))
        resolvedTags = resolvedTags.filter((t) => !toRemove.has(t.toLowerCase()))
      }
      patch.tags = resolvedTags
    }

    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode, { requireWrite: true })
    const todo = baseUrl
      ? await daemonRequest<Todo>(baseUrl, `/api/todos/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })
      : updateTodoWithEffects(id, patch)
    opts.json ? printJson(todo) : printTodo(todo)
  })

todoCommand
  .command('done <id>')
  .option('--json', 'Output as JSON', false)
  .action(async (id: string, opts: { json: boolean }) => {
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode, { requireWrite: true })
    const todo = baseUrl
      ? await daemonRequest<Todo>(baseUrl, `/api/todos/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'done' }) })
      : updateTodoWithEffects(id, { status: 'done' })
    opts.json ? printJson(todo) : printTodo(todo)
  })

todoCommand
  .command('delete <id>')
  .option('--confirm', 'Skip confirmation prompt', false)
  .action(async (id: string, opts: { confirm: boolean }) => {
    if (!opts.confirm) {
      console.error('Add --confirm to archive this todo.')
      process.exit(1)
    }
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode, { requireWrite: true })
    if (baseUrl) {
      await daemonRequest(baseUrl, `/api/todos/${id}`, { method: 'DELETE' })
    } else {
      deleteTodoWithEffects(id)
    }
    console.log(`Todo ${id} archived.`)
  })

// ─── Progress 专用命令（AI 执行任务时使用）────────────────────────────────────

// ─── Progress 专用命令（复刻 Claude Code TodoWrite 机制）────────────────────
// 对应 Claude Code 原生格式: { content, status, activeForm }
// content   → title（任务标题，静态显示）
// activeForm → activeForm（进行时描述，doing 时显示，可与 title 相同）
// status    → pending | doing | done | cancelled

todoCommand
  .command('progress-create')
  .description('Create a progress item for the current quest')
  .requiredOption('--quest-id <id>', 'Quest id')
  .option('--project-id <id>', 'Project id (optional; inferred from quest when possible)')
  .requiredOption('--title <title>', 'Task description (shown to user)')
  .option('--active-form <text>', 'In-progress description, e.g. "正在分析代码" (defaults to title)')
  .option('--waiting <instructions>', 'Blocking human input needed before continuing; avoid low-value completion follow-ups')
  .option('--for <who>', 'Advanced: "ai" (default, AI execution step) or "human" for an explicit human todo', 'ai')
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

todoCommand
  .command('progress-wait <id>')
  .description('Block until a progress item is marked done or cancelled (for AI plan-then-execute flows)')
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

todoCommand
  .command('progress-update <id>')
  .description('Update a progress item status (mirrors Claude Code TodoWrite)')
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

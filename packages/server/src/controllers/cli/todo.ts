import { Command } from 'commander'
import type { CreateTodoInput, Todo, TodoPriority, UpdateTodoInput } from '@pluse/types'
import { getTodo, listTodos } from '../../models/todo'
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

export const todoCommand = new Command('todo')
todoCommand.description('Manage todos')

todoCommand
  .command('list')
  .option('--project-id <id>', 'Project id')
  .option('--status <status>', 'pending or done')
  .option('--priority <priority>', 'urgent, high, normal, or low')
  .option('--tags <tags>', 'Comma-separated tags to filter by (OR semantics)')
  .option('--json', 'Output as JSON', false)
  .action(async (opts: { projectId?: string; status?: Todo['status']; priority?: TodoPriority; tags?: string; json: boolean }) => {
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode)
    const tags = opts.tags ? opts.tags.split(',').map((t) => t.trim()).filter(Boolean) : undefined
    const params = new URLSearchParams()
    if (opts.projectId) params.set('projectId', opts.projectId)
    if (opts.status) params.set('status', opts.status)
    if (opts.priority) params.set('priority', opts.priority)
    if (tags?.length) params.set('tags', tags.join(','))
    const todos = baseUrl
      ? await daemonRequest<Todo[]>(baseUrl, `/api/todos${params.toString() ? `?${params.toString()}` : ''}`)
      : listTodos({ projectId: opts.projectId, status: opts.status, priority: opts.priority, tags, deleted: false })
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
      createdBy: 'ai',
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
  .option('--status <status>', 'pending or done')
  .option('--priority <priority>', 'urgent, high, normal, or low')
  .option('--tags <tags>', 'Comma-separated tags (replaces all existing tags)')
  .option('--add-tags <tags>', 'Comma-separated tags to add')
  .option('--remove-tags <tags>', 'Comma-separated tags to remove')
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
    json: boolean
  }) => {
    const patch: UpdateTodoInput = {
      title: opts.title,
      description: opts.description,
      waitingInstructions: opts.waiting,
      repeat: opts.repeat,
      status: opts.status,
      priority: opts.priority,
    }
    if (opts.clearDue) patch.dueAt = null
    else if (opts.dueAt) patch.dueAt = opts.dueAt

    // Resolve tags: replace → add → remove
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

import { Command } from 'commander'
import type { CreateTodoInput, Todo, UpdateTodoInput } from '@pluse/types'
import { getTodo, listTodos } from '../../models/todo'
import { createTodoWithEffects, deleteTodoWithEffects, updateTodoWithEffects } from '../../services/todos'
import { daemonRequest, getCliMode, resolveDaemonBaseUrl } from '../../support/cli-runtime'

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2))
}

function printTodo(todo: Todo): void {
  console.log(`${todo.id}  ${todo.status}  ${todo.title}`)
  console.log(`  project: ${todo.projectId}`)
  if (todo.waitingInstructions) console.log(`  waiting: ${todo.waitingInstructions}`)
}

export const todoCommand = new Command('todo')
todoCommand.description('Manage todos')

todoCommand
  .command('list')
  .option('--project-id <id>', 'Project id')
  .option('--status <status>', 'pending or done')
  .option('--json', 'Output as JSON', false)
  .action(async (opts: { projectId?: string; status?: Todo['status']; json: boolean }) => {
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode)
    const params = new URLSearchParams()
    if (opts.projectId) params.set('projectId', opts.projectId)
    if (opts.status) params.set('status', opts.status)
    const todos = baseUrl
      ? await daemonRequest<Todo[]>(baseUrl, `/api/todos${params.toString() ? `?${params.toString()}` : ''}`)
      : listTodos({ projectId: opts.projectId, status: opts.status, deleted: false })
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
  .option('--origin-quest-id <id>', 'Origin quest')
  .option('--json', 'Output as JSON', false)
  .action(async (opts: { projectId: string; title: string; description?: string; waiting?: string; originQuestId?: string; json: boolean }) => {
    const input: CreateTodoInput = {
      projectId: opts.projectId,
      title: opts.title,
      description: opts.description,
      waitingInstructions: opts.waiting,
      originQuestId: opts.originQuestId,
      createdBy: 'human',
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
  .option('--status <status>', 'pending or done')
  .option('--json', 'Output as JSON', false)
  .action(async (id: string, opts: { title?: string; description?: string; waiting?: string; status?: Todo['status']; json: boolean }) => {
    const patch: UpdateTodoInput = {
      title: opts.title,
      description: opts.description,
      waitingInstructions: opts.waiting,
      status: opts.status,
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

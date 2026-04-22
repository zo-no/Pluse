import { Command } from 'commander'
import type { CreateSessionCategoryInput, SessionCategory, UpdateSessionCategoryInput } from '@pluse/types'
import {
  createSessionCategoryWithEffects,
  deleteSessionCategoryWithEffects,
  listSessionCategoryViews,
  updateSessionCategoryWithEffects,
} from '../../services/session-categories'
import { daemonRequest, getCliMode, resolveDaemonBaseUrl } from '../../support/cli-runtime'

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2))
}

function printSessionCategory(category: SessionCategory): void {
  console.log(`${category.id}  ${category.name}`)
  if (category.description) console.log(`  description: ${category.description}`)
  console.log(`  collapsed: ${category.collapsed}`)
}

function parseBoolean(value: string): boolean {
  if (value === 'true') return true
  if (value === 'false') return false
  throw new Error('Expected true or false')
}

export const sessionCategoryCommand = new Command('session-category')
sessionCategoryCommand.description('Manage session categories')

sessionCategoryCommand
  .command('list')
  .requiredOption('--project-id <id>', 'Project id')
  .option('--json', 'Output as JSON', false)
  .action(async (opts: { projectId: string; json: boolean }) => {
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode)
    const categories: SessionCategory[] = baseUrl
      ? await daemonRequest<SessionCategory[]>(baseUrl, `/api/projects/${opts.projectId}/session-categories`)
      : listSessionCategoryViews(opts.projectId)
    opts.json ? printJson(categories) : categories.forEach(printSessionCategory)
  })

sessionCategoryCommand
  .command('create')
  .requiredOption('--project-id <id>', 'Project id')
  .requiredOption('--name <name>', 'Category name')
  .option('--description <text>', 'Description')
  .option('--collapsed <boolean>', 'Collapsed state', parseBoolean)
  .option('--json', 'Output as JSON', false)
  .action(async (opts: { projectId: string; name: string; description?: string; collapsed?: boolean; json: boolean }) => {
    const input: CreateSessionCategoryInput = {
      projectId: opts.projectId,
      name: opts.name,
      description: opts.description,
      collapsed: opts.collapsed,
    }
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode, { requireWrite: true })
    const category: SessionCategory = baseUrl
      ? await daemonRequest<SessionCategory>(baseUrl, `/api/projects/${opts.projectId}/session-categories`, { method: 'POST', body: JSON.stringify(input) })
      : createSessionCategoryWithEffects(input)
    opts.json ? printJson(category) : printSessionCategory(category)
  })

sessionCategoryCommand
  .command('update <id>')
  .option('--name <name>', 'Category name')
  .option('--description <text>', 'Description')
  .option('--collapsed <boolean>', 'Collapsed state', parseBoolean)
  .option('--json', 'Output as JSON', false)
  .action(async (id: string, opts: { name?: string; description?: string; collapsed?: boolean; json: boolean }) => {
    const patch: UpdateSessionCategoryInput = {
      name: opts.name,
      description: opts.description,
      collapsed: opts.collapsed,
    }
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode, { requireWrite: true })
    const category: SessionCategory = baseUrl
      ? await daemonRequest<SessionCategory>(baseUrl, `/api/session-categories/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })
      : updateSessionCategoryWithEffects(id, patch)
    opts.json ? printJson(category) : printSessionCategory(category)
  })

sessionCategoryCommand
  .command('delete <id>')
  .option('--confirm', 'Skip confirmation prompt', false)
  .option('--json', 'Output as JSON', false)
  .action(async (id: string, opts: { confirm: boolean; json: boolean }) => {
    if (!opts.confirm) {
      console.error('Add --confirm to delete this session category.')
      process.exit(1)
    }
    const mode = getCliMode()
    const baseUrl = await resolveDaemonBaseUrl(mode, { requireWrite: true })
    if (baseUrl) {
      await daemonRequest(baseUrl, `/api/session-categories/${id}`, { method: 'DELETE' })
    } else {
      deleteSessionCategoryWithEffects(id)
    }
    opts.json ? printJson({ deleted: true }) : console.log(`Session category ${id} deleted.`)
  })

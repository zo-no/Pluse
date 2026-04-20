import { existsSync, readFileSync } from 'node:fs'
import type { Quest } from '@pluse/types'
import type { Run } from '@pluse/types'
import { getGlobalHooksPath, getProjectHooksPath } from '../support/paths'
import { updateQuest } from '../models/quest'
import { createTodoWithEffects } from './todos'
import { getProject } from '../models/project'

export type HookEvent = 'run_completed' | 'run_failed'

interface HookFilter {
  kind?: 'session' | 'task'
  triggeredBy?: string[]
}

interface HighlightQuestAction {
  type: 'highlight_quest'
}

interface CreateTodoAction {
  type: 'create_todo'
  title: string
  description?: string
}

type HookAction = HighlightQuestAction | CreateTodoAction

interface Hook {
  id: string
  event: HookEvent
  filter?: HookFilter
  actions: HookAction[]
}

interface HooksConfig {
  hooks: Hook[]
}

function loadHooksFile(path: string): Hook[] {
  if (!existsSync(path)) return []
  try {
    const raw = readFileSync(path, 'utf-8')
    const config = JSON.parse(raw) as HooksConfig
    return Array.isArray(config.hooks) ? config.hooks : []
  } catch {
    return []
  }
}

function mergeHooks(global: Hook[], project: Hook[]): Hook[] {
  const map = new Map<string, Hook>()
  for (const hook of global) map.set(hook.id, hook)
  for (const hook of project) map.set(hook.id, hook)
  return Array.from(map.values())
}

function renderTemplate(template: string, ctx: { quest: Quest; run: Run }): string {
  return template
    .replace(/\{\{quest\.name\}\}/g, ctx.quest.name ?? ctx.quest.title ?? ctx.quest.id)
    .replace(/\{\{quest\.id\}\}/g, ctx.quest.id)
    .replace(/\{\{run\.id\}\}/g, ctx.run.id)
}

function matchesFilter(hook: Hook, event: HookEvent, quest: Quest, run: Run): boolean {
  if (hook.event !== event) return false
  const f = hook.filter
  if (!f) return true
  if (f.kind && f.kind !== quest.kind) return false
  if (f.triggeredBy && !f.triggeredBy.includes(run.triggeredBy)) return false
  return true
}

export function runHooks(event: HookEvent, ctx: { quest: Quest; run: Run }): void {
  const { quest, run } = ctx
  const project = getProject(quest.projectId)

  const globalHooks = loadHooksFile(getGlobalHooksPath())
  const projectHooks = project?.workDir ? loadHooksFile(getProjectHooksPath(project.workDir)) : []
  const hooks = mergeHooks(globalHooks, projectHooks)

  for (const hook of hooks) {
    if (!matchesFilter(hook, event, quest, run)) continue
    for (const action of hook.actions) {
      if (action.type === 'highlight_quest') {
        updateQuest(quest.id, { unread: true })
      } else if (action.type === 'create_todo') {
        createTodoWithEffects({
          projectId: quest.projectId,
          originQuestId: quest.id,
          createdBy: 'system',
          title: renderTemplate(action.title, ctx),
          description: action.description ? renderTemplate(action.description, ctx) : undefined,
        })
      }
    }
  }
}

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Quest } from '@pluse/types'
import type { Run } from '@pluse/types'
import { getGlobalHooksPath, getProjectHooksPath } from '../support/paths'
import { getRunsByQuest } from '../models/run'
import { updateQuest } from '../models/quest'
import { ensureReviewReminderWithEffects } from './reminders'
import { createTodoWithEffects } from './todos'
import { getProject } from '../models/project'
import { runSessionClassificationInBackground } from './session-classifier'

export type HookEvent = 'run_completed' | 'run_failed'

interface HookFilter {
  kind?: 'session' | 'task'
  trigger?: string[]
  triggeredBy?: string[]
  firstCompletedChatRun?: boolean
}

interface HighlightQuestAction {
  type: 'highlight_quest'
}

interface CreateTodoAction {
  type: 'create_todo'
  title: string
  description?: string
  tags?: string[]
}

interface ShellAction {
  type: 'shell'
  command: string
}

interface AgentClassifySessionAction {
  type: 'agent_classify_session'
  allowCreateSessionCategory?: boolean
}

type HookAction = HighlightQuestAction | CreateTodoAction | ShellAction | AgentClassifySessionAction

export interface Hook {
  id: string
  event: HookEvent
  enabled?: boolean
  filter?: HookFilter
  actions: HookAction[]
}

export interface HooksConfig {
  hooks: Hook[]
}

// 内置默认配置：文件不存在时返回此配置
const DEFAULT_HOOKS_CONFIG: HooksConfig = {
  hooks: [
    {
      id: 'notify-on-session-complete',
      event: 'run_completed',
      enabled: true,
      filter: { kind: 'session', triggeredBy: ['human'] },
      actions: [
        { type: 'highlight_quest' },
        { type: 'create_todo', title: '{{quest.name}}', tags: ['review'] },
      ],
    },
    {
      id: 'notify-on-session-failed',
      event: 'run_failed',
      enabled: true,
      filter: { kind: 'session', triggeredBy: ['human'] },
      actions: [
        { type: 'highlight_quest' },
        { type: 'create_todo', title: '{{quest.name}}', tags: ['failed'] },
      ],
    },
    {
      id: 'speak-on-session-complete',
      event: 'run_completed',
      enabled: false,
      filter: { kind: 'session', triggeredBy: ['human'] },
      actions: [
        {
          type: 'shell',
          command: "kairos {{project.name.shell}}，{{quest.name.shell}}完成了",
        },
      ],
    },
    {
      id: 'classify-first-session-run',
      event: 'run_completed',
      enabled: false,
      filter: {
        kind: 'session',
        trigger: ['chat'],
        firstCompletedChatRun: true,
      },
      actions: [
        {
          type: 'agent_classify_session',
          allowCreateSessionCategory: true,
        },
      ],
    },
  ],
}

function loadHooksFile(path: string): Hook[] {
  if (!existsSync(path)) return []
  try {
    const raw = readFileSync(path, 'utf-8')
    const config = JSON.parse(raw) as HooksConfig
    return Array.isArray(config.hooks) ? config.hooks : []
  } catch (error) {
    console.error(`[hooks] Failed to load hooks file at ${path}:`, error)
    return []
  }
}

function mergeHooks(global: Hook[], project: Hook[]): Hook[] {
  const map = new Map<string, Hook>()
  for (const hook of global) map.set(hook.id, hook)
  for (const hook of project) map.set(hook.id, hook)
  return Array.from(map.values())
}

export function shellEscape(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'"
}

export function renderTemplate(
  template: string,
  ctx: { quest: Quest; run: Run; project: ReturnType<typeof getProject> }
): string {
  const projectName = ctx.project?.name ?? ''
  const questName = ctx.quest.name ?? ctx.quest.title ?? ctx.quest.id
  return template
    .replace(/\{\{project\.name\.shell\}\}/g, shellEscape(projectName))
    .replace(/\{\{quest\.name\.shell\}\}/g, shellEscape(questName))
    .replace(/\{\{quest\.id\.shell\}\}/g, shellEscape(ctx.quest.id))
    .replace(/\{\{run\.id\.shell\}\}/g, shellEscape(ctx.run.id))
    .replace(/\{\{project\.name\}\}/g, projectName)
    .replace(/\{\{quest\.name\}\}/g, questName)
    .replace(/\{\{quest\.id\}\}/g, ctx.quest.id)
    .replace(/\{\{run\.id\}\}/g, ctx.run.id)
}

function matchesFilter(hook: Hook, event: HookEvent, quest: Quest, run: Run): boolean {
  if (hook.enabled === false) return false
  if (hook.event !== event) return false
  const f = hook.filter
  if (!f) return true
  if (f.kind && f.kind !== quest.kind) return false
  if (f.trigger && !f.trigger.includes(run.trigger)) return false
  if (f.triggeredBy && !f.triggeredBy.includes(run.triggeredBy)) return false
  if (f.firstCompletedChatRun) {
    const completedChatRuns = getRunsByQuest(quest.id)
      .filter((entry) => entry.trigger === 'chat' && entry.state === 'completed')
    if (completedChatRuns.length !== 1 || completedChatRuns[0]?.id !== run.id) return false
  }
  return true
}

// 公开 API：读写全局 hooks.json
export function loadGlobalHooksConfig(): HooksConfig {
  const path = getGlobalHooksPath()
  if (!existsSync(path)) return DEFAULT_HOOKS_CONFIG
  try {
    const raw = readFileSync(path, 'utf-8')
    return JSON.parse(raw) as HooksConfig
  } catch {
    return DEFAULT_HOOKS_CONFIG
  }
}

export function saveGlobalHooksConfig(config: HooksConfig): void {
  const path = getGlobalHooksPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(config, null, 2), 'utf-8')
}

export function patchHook(id: string, patch: Partial<Pick<Hook, 'enabled'>>): HooksConfig {
  const config = loadGlobalHooksConfig()
  const idx = config.hooks.findIndex((h) => h.id === id)
  if (idx < 0) {
    // hook 不在文件里，从默认配置里找模板插入
    const defaultHook = DEFAULT_HOOKS_CONFIG.hooks.find((h) => h.id === id)
    if (!defaultHook) throw new Error(`Hook not found: ${id}`)
    config.hooks.push({ ...defaultHook, ...patch })
  } else {
    config.hooks[idx] = { ...config.hooks[idx], ...patch }
  }
  saveGlobalHooksConfig(config)
  return config
}

export function runHooks(event: HookEvent, ctx: { quest: Quest; run: Run }): void {
  const { quest, run } = ctx
  const project = getProject(quest.projectId)
  const fullCtx = { quest, run, project }

  const globalHooks = loadHooksFile(getGlobalHooksPath())
  const projectHooks = project?.workDir ? loadHooksFile(getProjectHooksPath(project.workDir)) : []
  const hooks = mergeHooks(globalHooks, projectHooks)

  for (const hook of hooks) {
    if (!matchesFilter(hook, event, quest, run)) continue
    for (const action of hook.actions) {
      if (action.type === 'highlight_quest') {
        updateQuest(quest.id, { unread: true })
      } else if (action.type === 'create_todo') {
        const todoInput = {
          projectId: quest.projectId,
          originQuestId: quest.id,
          createdBy: 'system' as const,
          title: renderTemplate(action.title, fullCtx),
          description: action.description ? renderTemplate(action.description, fullCtx) : undefined,
          tags: action.tags,
        }
        if ((action.tags ?? []).some((tag) => tag.trim().toLowerCase() === 'review')) {
          ensureReviewReminderWithEffects({
            projectId: todoInput.projectId,
            originQuestId: todoInput.originQuestId,
            originRunId: run.id,
            createdBy: todoInput.createdBy,
            type: 'review',
            title: todoInput.title,
            body: todoInput.description,
          })
        } else {
          createTodoWithEffects(todoInput)
        }
      } else if (action.type === 'shell') {
        const rendered = renderTemplate(action.command, fullCtx)
        try {
          const child = Bun.spawn(['sh', '-c', rendered], {
            detached: true,
            stdout: 'ignore',
            stderr: 'ignore',
          })
          child.unref()
        } catch (error) {
          console.warn('[hooks] shell action failed to spawn:', error instanceof Error ? error.message : error)
        }
      } else if (action.type === 'agent_classify_session') {
        runSessionClassificationInBackground({
          questId: quest.id,
          allowCreateSessionCategory: action.allowCreateSessionCategory,
        })
      }
    }
  }
}

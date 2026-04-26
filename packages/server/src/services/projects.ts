import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import type { OpenProjectInput, Project, ProjectManifest, ProjectOverview, ProjectRecentOutput, Quest, Run, Todo, UpdateProjectInput } from '@pluse/types'
import { getDb } from '../db'
import { getDomain } from '../models/domain'
import { listProjectActivity } from '../models/project-activity'
import {
  createProjectRecord,
  deleteProjectRecord,
  getActiveProjectByName,
  getProject,
  getProjectByWorkDir,
  listProjects,
  updateProject as updateProjectRecord,
  upsertProjectRecord,
} from '../models/project'
import { getRunsByProject } from '../models/run'
import { listQuests } from '../models/quest'
import { listTodos } from '../models/todo'
import { emit } from './events'
import {
  ensureDir,
  getDefaultEntryProjectDir,
  getProjectManifestDir,
  getProjectManifestPath,
  getSystemRuntimeDir,
  resolveWorkDir,
} from '../support/paths'

export const INBOX_PROJECT_ID = 'proj_inbox'
export const LEGACY_INBOX_PROJECT_ID = INBOX_PROJECT_ID
export const DEFAULT_ENTRY_PROJECT_ID = 'proj_self_dialogue'
export const DEFAULT_ENTRY_PROJECT_NAME = '自我对话'
export const SYSTEM_PROJECT_ID = 'proj_system'

const DEFAULT_ENTRY_PROJECT_ICON = '人'
const DEFAULT_ENTRY_PROJECT_GOAL = '在这里和 AI 一起挖掘真实需求、许下愿望、抒发欲望，并把混沌的想法整理成可以继续推进的 Quest / Todo。'
const DEFAULT_ENTRY_PROJECT_DESCRIPTION = '自我对话是 Pluse 的默认入口。首次使用和回到首页时，用户会优先进入这里，把还没有归属的念头、冲动、焦虑、愿望和需求先说出来，再逐步澄清它们是否要变成具体项目、会话、自动化或待办。'

function now(): string {
  return new Date().toISOString()
}

function readManifest(workDir: string): ProjectManifest | null {
  const path = getProjectManifestPath(workDir)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as ProjectManifest
  } catch {
    return null
  }
}

function writeManifest(manifest: ProjectManifest): void {
  ensureDir(getProjectManifestDir(manifest.workDir))
  writeFileSync(getProjectManifestPath(manifest.workDir), JSON.stringify(manifest, null, 2))
}

function manifestFromProject(project: Project): ProjectManifest {
  return {
    projectId: project.id,
    name: project.name,
    icon: project.icon,
    goal: project.goal,
    workDir: project.workDir,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  }
}

function assertDomainAssignable(domainId: string | null | undefined): void {
  if (domainId === undefined || domainId === null) return
  const domain = getDomain(domainId)
  if (!domain) {
    throw new Error(`Domain not found: ${domainId}`)
  }
}

function defaultProjectName(workDir: string): string {
  return basename(workDir) || 'Project'
}

function getMostRelevantScheduleQuest(projectTasks: Quest[]): Quest | null {
  return projectTasks.find((quest) => quest.enabled && (quest.scheduleKind === 'recurring' || quest.scheduleKind === 'scheduled'))
    ?? null
}

function deriveSchedule(quest: Quest | null, runs: Run[]): ProjectOverview['schedule'] {
  if (!quest) return null
  const latestRun = runs.find((run) => run.questId === quest.id)
  const config = quest.scheduleConfig ?? {}
  if (quest.scheduleKind === 'recurring') {
    return {
      lastRunAt: config.lastRunAt ?? latestRun?.completedAt ?? latestRun?.startedAt,
      nextRunAt: config.nextRunAt,
    }
  }
  if (quest.scheduleKind === 'scheduled') {
    return {
      lastRunAt: latestRun?.completedAt ?? latestRun?.startedAt,
      nextRunAt: quest.status === 'done' || quest.status === 'cancelled' ? undefined : config.runAt,
    }
  }
  if (!latestRun) return null
  return {
    lastRunAt: latestRun.completedAt ?? latestRun.startedAt,
  }
}

function getRecentOutputs(projectId: string, sessions: Quest[], tasks: Quest[]): ProjectRecentOutput[] {
  const questMap = new Map([...sessions, ...tasks].map((quest) => [quest.id, quest]))

  const outputs: ProjectRecentOutput[] = getRunsByProject(projectId, 16)
    .filter((run) => run.completedAt || run.finalizedAt || ['completed', 'failed', 'cancelled'].includes(run.state))
    .map((run) => ({
      id: run.id,
      kind: questMap.get(run.questId)?.kind === 'task' ? 'task_run' : 'chat_run',
      title: questMap.get(run.questId)?.name ?? questMap.get(run.questId)?.title ?? '未命名 Quest',
      status: run.state,
      completedAt: run.completedAt ?? run.finalizedAt,
      summary: run.failureReason ?? (run.state === 'cancelled' ? '本次执行已取消。' : undefined),
      questId: run.questId,
    }))

  const getSortTime = (item: ProjectRecentOutput) => item.completedAt ? Date.parse(item.completedAt) : 0

  return outputs
    .sort((a, b) => getSortTime(b) - getSortTime(a))
    .slice(0, 12)
}

function reassignProjectReferences(fromId: string, toId: string): void {
  const db = getDb()
  const tx = db.transaction(() => {
    db.run(`UPDATE quests SET project_id = ? WHERE project_id = ?`, [toId, fromId])
    db.run(`UPDATE todos SET project_id = ? WHERE project_id = ?`, [toId, fromId])
    db.run(`UPDATE reminders SET project_id = ? WHERE project_id = ?`, [toId, fromId])
    db.run(`UPDATE runs SET project_id = ? WHERE project_id = ?`, [toId, fromId])
    db.run(`DELETE FROM projects WHERE id = ?`, [fromId])
  })
  tx()
}

function mergeProjectReferences(fromId: string, toId: string): void {
  if (fromId === toId) return
  const db = getDb()
  const tx = db.transaction(() => {
    const legacyCategories = db.query<{ id: string; name: string }, [string]>(
      'SELECT id, name FROM session_categories WHERE project_id = ?'
    ).all(fromId)

    for (const category of legacyCategories) {
      const existing = db.query<{ id: string }, [string, string]>(
        'SELECT id FROM session_categories WHERE project_id = ? AND name = ? LIMIT 1'
      ).get(toId, category.name)
      if (existing) {
        db.run('UPDATE quests SET session_category_id = ? WHERE session_category_id = ?', [existing.id, category.id])
        db.run('DELETE FROM session_categories WHERE id = ?', [category.id])
      } else {
        db.run('UPDATE session_categories SET project_id = ?, updated_at = ? WHERE id = ?', [toId, now(), category.id])
      }
    }

    db.run(
      `UPDATE quests
       SET codex_thread_id = NULL
       WHERE project_id = ?
         AND codex_thread_id IS NOT NULL
         AND codex_thread_id IN (
           SELECT codex_thread_id FROM quests WHERE project_id = ? AND codex_thread_id IS NOT NULL
         )`,
      [fromId, toId],
    )
    db.run(
      `UPDATE quests
       SET claude_session_id = NULL
       WHERE project_id = ?
         AND claude_session_id IS NOT NULL
         AND claude_session_id IN (
           SELECT claude_session_id FROM quests WHERE project_id = ? AND claude_session_id IS NOT NULL
         )`,
      [fromId, toId],
    )

    db.run('UPDATE quests SET project_id = ? WHERE project_id = ?', [toId, fromId])
    db.run('UPDATE todos SET project_id = ? WHERE project_id = ?', [toId, fromId])
    db.run('UPDATE reminders SET project_id = ? WHERE project_id = ?', [toId, fromId])
    db.run('UPDATE runs SET project_id = ? WHERE project_id = ?', [toId, fromId])
    db.run('UPDATE project_activity SET project_id = ? WHERE project_id = ?', [toId, fromId])
    db.run('UPDATE notifications SET project_id = ? WHERE project_id = ?', [toId, fromId])
  })
  tx()
}

function alignProjectToManifest(projectId: string, manifest: ProjectManifest, seed?: Partial<OpenProjectInput>): Project {
  const project = updateProjectRecord(projectId, {
    name: seed?.name ?? manifest.name,
    icon: seed?.icon ?? manifest.icon ?? null,
    goal: seed?.goal ?? manifest.goal ?? null,
    workDir: manifest.workDir,
    systemPrompt: seed?.systemPrompt,
    domainId: seed?.domainId,
    pinned: seed?.pinned,
    archived: false,
  })
  writeManifest(manifestFromProject(project))
  emit({ type: 'project_updated', data: { projectId: project.id } })
  return project
}

function createProjectForManifest(manifest: ProjectManifest, seed?: Partial<OpenProjectInput>): Project {
  const created = createProjectRecord({
    id: manifest.projectId,
    name: seed?.name ?? manifest.name,
    icon: seed?.icon ?? manifest.icon,
    goal: seed?.goal ?? manifest.goal,
    workDir: manifest.workDir,
    systemPrompt: seed?.systemPrompt,
    domainId: seed?.domainId,
    pinned: seed?.pinned ?? false,
    createdAt: manifest.createdAt,
    updatedAt: manifest.updatedAt,
  })
  writeManifest(manifestFromProject(created))
  emit({ type: 'project_opened', data: { projectId: created.id } })
  return created
}

export function ensureBuiltinProjects(): void {
  const ts = now()
  ensureDefaultEntryProject(ts)

  upsertProjectRecord({
    id: SYSTEM_PROJECT_ID,
    name: 'System',
    goal: '系统内部运行任务。',
    workDir: getSystemRuntimeDir(),
    archived: false,
    pinned: false,
    visibility: 'system',
    createdAt: getProject(SYSTEM_PROJECT_ID)?.createdAt ?? ts,
    updatedAt: ts,
  })
}

function ensureDefaultEntryProject(ts: string): Project {
  const existingEntry = getActiveProjectByName(DEFAULT_ENTRY_PROJECT_NAME)
    ?? getProject(DEFAULT_ENTRY_PROJECT_ID)
  const legacyInbox = getProject(LEGACY_INBOX_PROJECT_ID)

  if (existingEntry && existingEntry.id !== legacyInbox?.id) {
    const entry = updateProjectRecord(existingEntry.id, {
      name: DEFAULT_ENTRY_PROJECT_NAME,
      icon: existingEntry.icon ?? DEFAULT_ENTRY_PROJECT_ICON,
      goal: DEFAULT_ENTRY_PROJECT_GOAL,
      description: DEFAULT_ENTRY_PROJECT_DESCRIPTION,
      domainId: null,
      pinned: true,
      archived: false,
    })
    if (legacyInbox) {
      mergeProjectReferences(legacyInbox.id, entry.id)
      upsertProjectRecord({
        ...legacyInbox,
        name: 'Legacy Inbox',
        goal: '旧默认入口，关联数据已迁移到自我对话。',
        description: '保留这条隐藏记录是为了避免旧 manifest 或外部引用立即失效。',
        archived: true,
        pinned: false,
        visibility: 'system',
        updatedAt: ts,
      })
    }
    writeManifest(manifestFromProject(entry))
    return entry
  }

  if (legacyInbox) {
    const entry = updateProjectRecord(legacyInbox.id, {
      name: DEFAULT_ENTRY_PROJECT_NAME,
      icon: legacyInbox.icon ?? DEFAULT_ENTRY_PROJECT_ICON,
      goal: DEFAULT_ENTRY_PROJECT_GOAL,
      description: DEFAULT_ENTRY_PROJECT_DESCRIPTION,
      workDir: getDefaultEntryProjectDir(),
      domainId: null,
      pinned: true,
      archived: false,
    })
    writeManifest(manifestFromProject(entry))
    return entry
  }

  const entry = upsertProjectRecord({
    id: DEFAULT_ENTRY_PROJECT_ID,
    name: DEFAULT_ENTRY_PROJECT_NAME,
    icon: DEFAULT_ENTRY_PROJECT_ICON,
    goal: DEFAULT_ENTRY_PROJECT_GOAL,
    description: DEFAULT_ENTRY_PROJECT_DESCRIPTION,
    workDir: getDefaultEntryProjectDir(),
    domainId: undefined,
    archived: false,
    pinned: true,
    visibility: 'user',
    createdAt: getProject(DEFAULT_ENTRY_PROJECT_ID)?.createdAt ?? ts,
    updatedAt: ts,
  })
  writeManifest(manifestFromProject(entry))
  return entry
}

export function listVisibleProjects(): Project[] {
  ensureBuiltinProjects()
  return listProjects({ includeArchived: false, includeSystem: false })
}

export function openProject(input: OpenProjectInput): Project {
  ensureBuiltinProjects()
  const workDir = resolveWorkDir(input.workDir)
  const manifest = readManifest(workDir)
  const byWorkDir = getProjectByWorkDir(workDir)
  assertDomainAssignable(input.domainId)

  if (!manifest && !byWorkDir) {
    const created = createProjectRecord({
      name: input.name?.trim() || defaultProjectName(workDir),
      icon: input.icon,
      goal: input.goal,
      description: input.description,
      workDir,
      systemPrompt: input.systemPrompt,
      domainId: input.domainId,
      pinned: input.pinned,
    })
    writeManifest(manifestFromProject(created))
    emit({ type: 'project_opened', data: { projectId: created.id } })
    return created
  }

  if (!manifest && byWorkDir) {
    const updated = updateProjectRecord(byWorkDir.id, {
      name: input.name || byWorkDir.name,
      icon: input.icon === undefined ? byWorkDir.icon ?? null : input.icon ?? null,
      goal: input.goal === undefined ? byWorkDir.goal ?? null : input.goal ?? null,
      description: input.description === undefined ? byWorkDir.description ?? null : input.description ?? null,
      systemPrompt: input.systemPrompt === undefined ? byWorkDir.systemPrompt ?? null : input.systemPrompt ?? null,
      domainId: input.domainId !== undefined ? input.domainId : byWorkDir.domainId ?? undefined,
      pinned: input.pinned ?? byWorkDir.pinned,
      archived: false,
    })
    writeManifest(manifestFromProject(updated))
    emit({ type: 'project_opened', data: { projectId: updated.id } })
    return updated
  }

  if (manifest && !byWorkDir) {
    const byManifestId = getProject(manifest.projectId)
    if (!byManifestId) {
      return createProjectForManifest(
        {
          ...manifest,
          name: input.name || manifest.name,
          goal: input.goal === undefined ? manifest.goal : input.goal,
          workDir,
          updatedAt: now(),
        },
        input,
      )
    }

    if (byManifestId.workDir && byManifestId.workDir !== workDir) {
      if (existsSync(byManifestId.workDir)) {
        const copied = createProjectRecord({
          name: input.name || manifest.name || defaultProjectName(workDir),
          icon: input.icon ?? manifest.icon,
          goal: input.goal === undefined ? manifest.goal : input.goal,
          workDir,
          systemPrompt: input.systemPrompt,
          domainId: input.domainId,
          pinned: input.pinned,
        })
        writeManifest(manifestFromProject(copied))
        emit({ type: 'project_opened', data: { projectId: copied.id } })
        return copied
      }

      return alignProjectToManifest(byManifestId.id, {
        ...manifest,
        name: input.name || manifest.name,
        goal: input.goal === undefined ? manifest.goal : input.goal,
        workDir,
        updatedAt: now(),
      }, input)
    }

    return alignProjectToManifest(byManifestId.id, {
      ...manifest,
      name: input.name || manifest.name,
      goal: input.goal === undefined ? manifest.goal : input.goal,
      workDir,
      updatedAt: now(),
    }, input)
  }

  const manifestId = manifest!.projectId
  if (byWorkDir!.id !== manifestId) {
    if (getProject(manifestId)) {
      reassignProjectReferences(byWorkDir!.id, manifestId)
      return alignProjectToManifest(manifestId, {
        ...manifest!,
        name: input.name || manifest!.name,
        goal: input.goal === undefined ? manifest!.goal : input.goal,
        workDir,
        updatedAt: now(),
      }, input)
    }

    reassignProjectReferences(byWorkDir!.id, manifestId)
    return createProjectForManifest({
      ...manifest!,
      name: input.name || manifest!.name,
      goal: input.goal === undefined ? manifest!.goal : input.goal,
      workDir,
      updatedAt: now(),
    }, input)
  }

  return alignProjectToManifest(byWorkDir!.id, {
    ...manifest!,
    name: input.name || manifest!.name,
    goal: input.goal === undefined ? manifest!.goal : input.goal,
    workDir,
    updatedAt: now(),
  }, input)
}

export function updateProject(id: string, input: UpdateProjectInput): Project {
  const project = getProject(id)
  if (!project) throw new Error(`Project not found: ${id}`)
  if (project.id === SYSTEM_PROJECT_ID && input.archived) {
    throw new Error('System project cannot be archived')
  }
  if (
    input.archived
    && (
      project.id === DEFAULT_ENTRY_PROJECT_ID
      || project.id === LEGACY_INBOX_PROJECT_ID
      || project.name === DEFAULT_ENTRY_PROJECT_NAME
    )
  ) {
    throw new Error('Default entry project cannot be archived')
  }
  assertDomainAssignable(input.domainId)
  const updated = updateProjectRecord(id, input)
  if (updated.visibility === 'user') {
    writeManifest(manifestFromProject(updated))
  }
  emit({ type: 'project_updated', data: { projectId: updated.id } })
  return updated
}

export function archiveProject(id: string): Project {
  const project = getProject(id)
  if (
    id === LEGACY_INBOX_PROJECT_ID
    || id === DEFAULT_ENTRY_PROJECT_ID
    || id === SYSTEM_PROJECT_ID
    || project?.name === DEFAULT_ENTRY_PROJECT_NAME
  ) {
    throw new Error('Built-in projects cannot be archived')
  }
  return updateProject(id, { archived: true })
}

export function getProjectOverview(id: string): ProjectOverview | null {
  const project = getProject(id)
  if (!project) return null
  const sessions = listQuests({ projectId: id, kind: 'session', deleted: false })
  const tasks = listQuests({ projectId: id, kind: 'task', deleted: false })
  const todos = listTodos({ projectId: id, deleted: false })
  const waitingTodos = todos.filter((todo) => todo.status === 'pending' && Boolean(todo.waitingInstructions || todo.description))
  const runs = getRunsByProject(id, 24)
  const schedule = deriveSchedule(getMostRelevantScheduleQuest(tasks), runs)
  return {
    project,
    sessions,
    tasks,
    todos,
    waitingTodos,
    recentActivity: listProjectActivity(id, 20),
    recentOutputs: getRecentOutputs(id, sessions, tasks),
    schedule,
    counts: {
      sessions: sessions.length,
      tasks: tasks.length,
      todos: todos.length,
    },
  }
}

export function deleteProjectWithCascade(id: string): void {
  archiveProject(id)
}

export function removeProjectRecord(id: string): void {
  deleteProjectRecord(id)
}

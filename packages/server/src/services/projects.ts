import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { OpenProjectInput, Project, ProjectManifest, ProjectOverview, ProjectRecentOutput, Quest, Run, Todo, UpdateProjectInput } from '@pluse/types'
import { getDb } from '../db'
import {
  createProjectRecord,
  deleteProjectRecord,
  getProject,
  getProjectByWorkDir,
  listProjects,
  updateProject as updateProjectRecord,
  upsertProjectRecord,
} from '../models/project'
import { getRunsByProject } from '../models/run'
import { listQuests } from '../models/quest'
import { listTodos, updateTodo } from '../models/todo'
import { emit } from './events'
import {
  ensureDir,
  getAssetsDir,
  getHistoryRoot,
  getInboxDir,
  getProjectManifestDir,
  getProjectManifestPath,
  getSystemRuntimeDir,
  resolveWorkDir,
} from '../support/paths'

export const INBOX_PROJECT_ID = 'proj_inbox'
export const SYSTEM_PROJECT_ID = 'proj_system'

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
    goal: project.goal,
    workDir: project.workDir,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
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
    db.run(`UPDATE runs SET project_id = ? WHERE project_id = ?`, [toId, fromId])
    db.run(`DELETE FROM projects WHERE id = ?`, [fromId])
  })
  tx()
}

function alignProjectToManifest(projectId: string, manifest: ProjectManifest, seed?: Partial<OpenProjectInput>): Project {
  const project = updateProjectRecord(projectId, {
    name: seed?.name ?? manifest.name,
    goal: seed?.goal ?? manifest.goal ?? null,
    workDir: manifest.workDir,
    systemPrompt: seed?.systemPrompt,
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
    goal: seed?.goal ?? manifest.goal,
    workDir: manifest.workDir,
    systemPrompt: seed?.systemPrompt,
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
  const inboxWorkDir = getInboxDir()
  const inbox = upsertProjectRecord({
    id: INBOX_PROJECT_ID,
    name: 'Inbox',
    goal: '默认收纳临时会话和短期跟进事项。',
    workDir: inboxWorkDir,
    archived: false,
    pinned: true,
    visibility: 'user',
    createdAt: getProject(INBOX_PROJECT_ID)?.createdAt ?? ts,
    updatedAt: ts,
  })
  writeManifest(manifestFromProject(inbox))

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

export function listVisibleProjects(): Project[] {
  ensureBuiltinProjects()
  return listProjects({ includeArchived: false, includeSystem: false })
}

export function openProject(input: OpenProjectInput): Project {
  ensureBuiltinProjects()
  const workDir = resolveWorkDir(input.workDir)
  const manifest = readManifest(workDir)
  const byWorkDir = getProjectByWorkDir(workDir)

  if (!manifest && !byWorkDir) {
    const created = createProjectRecord({
      name: input.name?.trim() || defaultProjectName(workDir),
      goal: input.goal,
      workDir,
      systemPrompt: input.systemPrompt,
      pinned: input.pinned,
    })
    writeManifest(manifestFromProject(created))
    emit({ type: 'project_opened', data: { projectId: created.id } })
    return created
  }

  if (!manifest && byWorkDir) {
    const updated = updateProjectRecord(byWorkDir.id, {
      name: input.name || byWorkDir.name,
      goal: input.goal === undefined ? byWorkDir.goal ?? null : input.goal ?? null,
      systemPrompt: input.systemPrompt === undefined ? byWorkDir.systemPrompt ?? null : input.systemPrompt ?? null,
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
          goal: input.goal === undefined ? manifest.goal : input.goal,
          workDir,
          systemPrompt: input.systemPrompt,
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
  const updated = updateProjectRecord(id, input)
  if (updated.visibility === 'user') {
    writeManifest(manifestFromProject(updated))
  }
  emit({ type: 'project_updated', data: { projectId: updated.id } })
  return updated
}

export function archiveProject(id: string): Project {
  if (id === INBOX_PROJECT_ID || id === SYSTEM_PROJECT_ID) {
    throw new Error('Built-in projects cannot be archived')
  }
  return updateProject(id, { archived: true })
}

export function getProjectOverview(id: string): ProjectOverview | null {
  const project = getProject(id)
  if (!project) return null
  const sessions = listQuests({ projectId: id, kind: 'session', deleted: false })
  const tasks = listQuests({ projectId: id, kind: 'task', deleted: false })
  const todos = listTodos({ projectId: id })
  const waitingTodos = todos.filter((todo) => todo.status === 'pending' && Boolean(todo.waitingInstructions || todo.description))
  const runs = getRunsByProject(id, 24)
  const schedule = deriveSchedule(getMostRelevantScheduleQuest(tasks), runs)
  return {
    project,
    sessions,
    tasks,
    todos,
    waitingTodos,
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
  const db = getDb()
  const quests = listQuests({ projectId: id })
  for (const todo of listTodos({ projectId: id })) {
    if (todo.originQuestId) {
      updateTodo(todo.id, { originQuestId: null })
    }
  }
  db.run(`DELETE FROM run_spool WHERE run_id IN (SELECT id FROM runs WHERE project_id = ?)`, [id])
  db.run(`DELETE FROM runs WHERE project_id = ?`, [id])
  db.run(`DELETE FROM assets WHERE quest_id IN (SELECT id FROM quests WHERE project_id = ?)`, [id])
  db.run(`DELETE FROM quest_ops WHERE quest_id IN (SELECT id FROM quests WHERE project_id = ?)`, [id])
  db.run(`DELETE FROM todos WHERE project_id = ?`, [id])
  db.run(`DELETE FROM quests WHERE project_id = ?`, [id])
  deleteProjectRecord(id)
  for (const quest of quests) {
    rmSync(join(getHistoryRoot(), quest.id), { recursive: true, force: true })
    rmSync(getAssetsDir(quest.id), { recursive: true, force: true })
  }
  emit({ type: 'project_updated', data: { projectId: id } })
}

export function removeProjectRecord(id: string): void {
  deleteProjectRecord(id)
}

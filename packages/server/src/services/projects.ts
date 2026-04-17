import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import type { OpenProjectInput, Project, ProjectManifest, ProjectOverview, ProjectRecentOutput, Task, TaskRun, UpdateProjectInput } from '@pluse/types'
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
import { listSessions } from '../models/session'
import { listTasks } from '../models/task'
import { getTaskRunsByProject } from '../models/task-run'
import { emit } from './events'
import {
  ensureDir,
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

function isBrainTask(task: Task): boolean {
  return task.createdBy === 'system' && task.kind === 'recurring' && task.title === 'Project Brain'
}

function getMostRelevantScheduleTask(projectTasks: Task[]): Task | null {
  return projectTasks.find((task) => task.enabled && isBrainTask(task))
    ?? projectTasks.find((task) => task.enabled && (task.kind === 'recurring' || task.kind === 'scheduled'))
    ?? null
}

function deriveSchedule(task: Task | null, taskRuns: TaskRun[]): ProjectOverview['schedule'] {
  if (!task) return null
  const latestRun = taskRuns.find((run) => run.taskId === task.id)
  const config = task.scheduleConfig
  if (config?.kind === 'recurring') {
    return {
      lastRunAt: config.lastRunAt ?? latestRun?.completedAt ?? latestRun?.startedAt,
      nextRunAt: config.nextRunAt,
    }
  }
  if (config?.kind === 'scheduled') {
    return {
      lastRunAt: latestRun?.completedAt ?? latestRun?.startedAt,
      nextRunAt: task.status === 'done' || task.status === 'cancelled' ? undefined : config.scheduledAt,
    }
  }
  if (!latestRun) return null
  return {
    lastRunAt: latestRun.completedAt ?? latestRun.startedAt,
  }
}

function getRecentOutputs(projectId: string, sessions: ProjectOverview['sessions'], tasks: Task[]): ProjectRecentOutput[] {
  const sessionMap = new Map(sessions.map((session) => [session.id, session]))
  const taskMap = new Map(tasks.map((task) => [task.id, task]))

  const sessionOutputs: ProjectRecentOutput[] = getRunsByProject(projectId, 16)
    .filter((run) => run.completedAt || run.finalizedAt || ['completed', 'failed', 'cancelled'].includes(run.state))
    .map((run) => ({
      id: run.id,
      kind: 'session_run',
      title: sessionMap.get(run.sessionId)?.name ?? '未命名会话',
      status: run.state,
      completedAt: run.completedAt ?? run.finalizedAt,
      summary: run.failureReason ?? (run.result === 'cancelled' ? '本次执行已取消。' : undefined),
      sessionId: run.sessionId,
    }))

  const taskOutputs: ProjectRecentOutput[] = getTaskRunsByProject(projectId, 16)
    .filter((run) => run.status !== 'running')
    .map((run) => ({
      id: run.id,
      kind: 'task_run',
      title: taskMap.get(run.taskId)?.title ?? '未命名任务',
      status: run.status,
      completedAt: run.completedAt ?? run.startedAt,
      summary: run.error ?? taskMap.get(run.taskId)?.completionOutput,
      sessionId: run.sessionId,
      taskId: run.taskId,
    }))

  const getSortTime = (item: ProjectRecentOutput) => item.completedAt ? Date.parse(item.completedAt) : 0

  return [...sessionOutputs, ...taskOutputs]
    .sort((a, b) => getSortTime(b) - getSortTime(a))
    .slice(0, 12)
}

function reassignProjectReferences(fromId: string, toId: string): void {
  const db = getDb()
  const tx = db.transaction(() => {
    db.run(`UPDATE sessions SET project_id = ? WHERE project_id = ?`, [toId, fromId])
    db.run(`UPDATE tasks SET project_id = ? WHERE project_id = ?`, [toId, fromId])
    db.run(`UPDATE task_runs SET project_id = ? WHERE project_id = ?`, [toId, fromId])
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
  const sessions = listSessions({ projectId: id, archived: false })
  const tasks = listTasks({ projectId: id })
  const taskRuns = getTaskRunsByProject(id, 24)
  const brainTask = tasks.find(isBrainTask) ?? null
  const waitingTasks = tasks.filter((task) => task.status === 'blocked' || Boolean(task.waitingInstructions))
  const schedule = deriveSchedule(getMostRelevantScheduleTask(tasks), taskRuns)
  return {
    project,
    sessions,
    tasks,
    brainTask,
    waitingTasks,
    projectTasks: tasks,
    recentOutputs: getRecentOutputs(id, sessions, tasks),
    schedule,
    counts: {
      sessions: sessions.length,
      chatShortTasks: 0,
      projectTasks: tasks.length,
    },
  }
}

export function deleteProjectWithCascade(id: string): void {
  const db = getDb()
  // 级联删除顺序（遵循外键约束）
  // task 相关（有 project_id 外键）
  db.run(`DELETE FROM task_run_spool WHERE run_id IN (SELECT id FROM task_runs WHERE project_id = ?)`, [id])
  db.run(`DELETE FROM task_runs WHERE project_id = ?`, [id])
  db.run(`DELETE FROM task_logs WHERE task_id IN (SELECT id FROM tasks WHERE project_id = ?)`, [id])
  db.run(`DELETE FROM task_ops WHERE task_id IN (SELECT id FROM tasks WHERE project_id = ?)`, [id])
  db.run(`DELETE FROM tasks WHERE project_id = ?`, [id])
  // session 相关（session events 存文件系统，runs 有 session_id 外键）
  db.run(`DELETE FROM runs WHERE session_id IN (SELECT id FROM sessions WHERE project_id = ?)`, [id])
  db.run(`DELETE FROM sessions WHERE project_id = ?`, [id])
  deleteProjectRecord(id)
  emit({ type: 'project_updated', data: { projectId: id } })
}

export function removeProjectRecord(id: string): void {
  deleteProjectRecord(id)
}

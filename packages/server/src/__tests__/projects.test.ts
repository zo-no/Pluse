import { beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { cpSync, existsSync, readFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import type { Project, ProjectManifest, ProjectOverview, Session, Task } from '@melody-sync/types'
import { createRun, updateRun } from '../models/run'
import { completeTaskRun, createTaskRun } from '../models/task-run'
import { GET, PATCH, POST, makeWorkDir, resetTestDb, setupTestDb } from './helpers'

beforeAll(() => setupTestDb())
beforeEach(() => resetTestDb())

async function openProject(workDir: string, seed: Partial<{ name: string; goal: string; pinned: boolean; systemPrompt: string }> = {}) {
  const result = await POST<Project>('/api/projects/open', {
    workDir,
    ...seed,
  })
  expect(result.status).toBe(201)
  expect(result.json.ok).toBe(true)
  if (!result.json.ok) throw new Error(result.json.error)
  return result.json.data
}

describe('GET /api/projects', () => {
  it('returns Inbox and hides internal system project', async () => {
    const { status, json } = await GET<Project[]>('/api/projects')
    expect(status).toBe(200)
    expect(json.ok).toBe(true)
    if (!json.ok) return

    expect(json.data.some((project) => project.id === 'proj_inbox')).toBe(true)
    expect(json.data.some((project) => project.id === 'proj_system')).toBe(false)
  })
})

describe('POST /api/projects/open', () => {
  it('creates a project, persists manifest, and reopens idempotently', async () => {
    const workDir = makeWorkDir('alpha')
    const created = await openProject(workDir, { name: 'Alpha', goal: 'Fuse the product', pinned: true })

    expect(created.name).toBe('Alpha')
    expect(created.workDir).toBe(workDir)
    expect(created.pinned).toBe(true)

    const manifestPath = join(workDir, '.pulse', 'project.json')
    expect(existsSync(manifestPath)).toBe(true)

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as ProjectManifest
    expect(manifest.projectId).toBe(created.id)
    expect(manifest.workDir).toBe(workDir)

    const reopened = await openProject(workDir)
    expect(reopened.id).toBe(created.id)
  })

  it('preserves identity on move and forks identity on copy', async () => {
    const sourceDir = makeWorkDir('source')
    const created = await openProject(sourceDir, { name: 'Source' })

    const movedDir = join(join(sourceDir, '..'), 'moved')
    renameSync(sourceDir, movedDir)
    const moved = await openProject(movedDir)
    expect(moved.id).toBe(created.id)
    expect(moved.workDir).toBe(movedDir)

    const copiedDir = makeWorkDir('copied')
    cpSync(join(movedDir, '.pulse'), join(copiedDir, '.pulse'), { recursive: true })
    const copied = await openProject(copiedDir)
    expect(copied.id).not.toBe(created.id)
    expect(copied.workDir).toBe(copiedDir)
  })
})

describe('project updates and overview', () => {
  it('updates project fields, archives it, and exposes the derived workspace overview', async () => {
    const workDir = makeWorkDir('overview')
    const project = await openProject(workDir, { name: 'Overview Project' })

    const updated = await PATCH<Project>(`/api/projects/${project.id}`, {
      name: 'Overview Project Renamed',
      goal: 'Track merged work',
      systemPrompt: 'Use Pulse tools when helpful.',
      pinned: true,
    })
    expect(updated.status).toBe(200)
    expect(updated.json.ok).toBe(true)
    if (!updated.json.ok) return
    expect(updated.json.data.systemPrompt).toBe('Use Pulse tools when helpful.')

    const session = await POST<Session>('/api/sessions', {
      projectId: project.id,
      name: 'Workspace Session',
    })
    expect(session.status).toBe(201)
    expect(session.json.ok).toBe(true)
    if (!session.json.ok) return

    const brainTask = await POST<Task>('/api/tasks', {
      projectId: project.id,
      title: 'Project Brain',
      description: 'Periodic review for this project.',
      assignee: 'ai',
      kind: 'recurring',
      surface: 'project',
      visibleInChat: false,
      origin: 'system',
      createdBy: 'system',
      enabled: true,
      scheduleConfig: {
        kind: 'recurring',
        cron: '*/30 * * * *',
        timezone: 'Asia/Shanghai',
        lastRunAt: '2026-04-17T00:00:00.000Z',
        nextRunAt: '2026-04-17T00:30:00.000Z',
      },
    })
    expect(brainTask.status).toBe(201)
    expect(brainTask.json.ok).toBe(true)
    if (!brainTask.json.ok) return

    const waitingTask = await POST<Task>('/api/tasks', {
      projectId: project.id,
      title: 'Need product decision',
      description: 'Waiting on the final product copy.',
      assignee: 'human',
      kind: 'once',
      surface: 'project',
      visibleInChat: false,
      origin: 'manual',
      createdBy: 'human',
      waitingInstructions: 'Confirm the final product copy before shipping.',
    })
    expect(waitingTask.status).toBe(201)
    expect(waitingTask.json.ok).toBe(true)
    if (!waitingTask.json.ok) return

    const blockedTask = await PATCH<Task>(`/api/tasks/${waitingTask.json.data.id}`, {
      status: 'blocked',
    })
    expect(blockedTask.status).toBe(200)
    expect(blockedTask.json.ok).toBe(true)
    if (!blockedTask.json.ok) return

    const projectTask = await POST<Task>('/api/tasks', {
      projectId: project.id,
      title: 'Weekly cleanup',
      description: 'Sweep stale task state and summarize changes.',
      assignee: 'ai',
      kind: 'scheduled',
      surface: 'project',
      visibleInChat: false,
      origin: 'scheduler',
      createdBy: 'system',
      enabled: true,
      scheduleConfig: {
        kind: 'scheduled',
        scheduledAt: '2026-04-18T09:00:00.000Z',
      },
    })
    expect(projectTask.status).toBe(201)
    expect(projectTask.json.ok).toBe(true)
    if (!projectTask.json.ok) return

    const sessionRun = createRun({
      sessionId: session.json.data.id,
      requestId: 'req_project_overview',
      tool: 'codex',
      model: 'gpt-5.4',
      thinking: true,
    })
    updateRun(sessionRun.id, {
      state: 'completed',
      result: 'success',
      startedAt: '2026-04-17T01:00:00.000Z',
      completedAt: '2026-04-17T01:03:00.000Z',
      finalizedAt: '2026-04-17T01:03:00.000Z',
    })

    const taskRun = createTaskRun(projectTask.json.data.id, project.id, 'manual', session.json.data.id)
    completeTaskRun(taskRun.id, 'done', undefined, session.json.data.id)

    const overview = await GET<ProjectOverview>(`/api/projects/${project.id}/overview`)
    expect(overview.status).toBe(200)
    expect(overview.json.ok).toBe(true)
    if (!overview.json.ok) return
    expect(overview.json.data.project.id).toBe(project.id)
    expect(overview.json.data.counts.sessions).toBe(1)
    expect(overview.json.data.brainTask?.id).toBe(brainTask.json.data.id)
    expect(overview.json.data.waitingTasks.map((task) => task.id)).toContain(waitingTask.json.data.id)
    expect(overview.json.data.projectTasks.map((task) => task.id)).toEqual(
      expect.arrayContaining([brainTask.json.data.id, waitingTask.json.data.id, projectTask.json.data.id]),
    )
    expect(overview.json.data.schedule?.lastRunAt).toBe('2026-04-17T00:00:00.000Z')
    expect(typeof overview.json.data.schedule?.nextRunAt).toBe('string')
    expect(overview.json.data.recentOutputs.some((item) => item.kind === 'session_run' && item.sessionId === session.json.data.id)).toBe(true)
    expect(overview.json.data.recentOutputs.some((item) => item.kind === 'task_run' && item.taskId === projectTask.json.data.id)).toBe(true)

    const archived = await POST<Project>(`/api/projects/${project.id}/archive`)
    expect(archived.status).toBe(200)
    expect(archived.json.ok).toBe(true)

    const projects = await GET<Project[]>('/api/projects')
    expect(projects.json.ok).toBe(true)
    if (!projects.json.ok) return
    expect(projects.json.data.some((item) => item.id === project.id)).toBe(false)
  })
})

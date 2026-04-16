import { beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import type { Project, ProjectOverview, Session, Task } from '@melody-sync/types'
import { GET, PATCH, POST, makeWorkDir, resetTestDb, setupTestDb } from './helpers'

beforeAll(() => setupTestDb())
beforeEach(() => resetTestDb())

async function setupProjectAndSession(): Promise<{ project: Project; session: Session }> {
  const projectResult = await POST<Project>('/api/projects/open', {
    workDir: makeWorkDir('task-project'),
    name: 'Task Project',
  })
  expect(projectResult.json.ok).toBe(true)
  if (!projectResult.json.ok) throw new Error(projectResult.json.error)

  const sessionResult = await POST<Session>('/api/sessions', {
    projectId: projectResult.json.data.id,
    name: 'Task Session',
  })
  expect(sessionResult.json.ok).toBe(true)
  if (!sessionResult.json.ok) throw new Error(sessionResult.json.error)

  return {
    project: projectResult.json.data,
    session: sessionResult.json.data,
  }
}

describe('task HTTP routes', () => {
  it('separates chat-short tasks from project tasks and exposes overview counts', async () => {
    const { project, session } = await setupProjectAndSession()

    const chatTask = await POST<Task>('/api/tasks', {
      projectId: project.id,
      sessionId: session.id,
      title: 'Reply to session result',
      assignee: 'ai',
      kind: 'once',
      surface: 'chat_short',
      visibleInChat: true,
      origin: 'agent',
      createdBy: 'ai',
    })
    expect(chatTask.status).toBe(201)
    expect(chatTask.json.ok).toBe(true)

    const recurringTask = await POST<Task>('/api/tasks', {
      projectId: project.id,
      title: 'Weekly cleanup',
      assignee: 'human',
      kind: 'recurring',
      surface: 'project',
      visibleInChat: false,
      origin: 'manual',
      createdBy: 'human',
      scheduleConfig: {
        kind: 'recurring',
        cron: '0 9 * * 1',
        timezone: 'Asia/Shanghai',
      },
    })
    expect(recurringTask.status).toBe(201)
    expect(recurringTask.json.ok).toBe(true)

    const sessionTasks = await GET<Task[]>(`/api/tasks?sessionId=${session.id}&surface=chat_short&visibleInChat=true`)
    expect(sessionTasks.json.ok).toBe(true)
    if (!sessionTasks.json.ok) return
    expect(sessionTasks.json.data).toHaveLength(1)

    const projectTasks = await GET<Task[]>(`/api/tasks?projectId=${project.id}&surface=project`)
    expect(projectTasks.json.ok).toBe(true)
    if (!projectTasks.json.ok) return
    expect(projectTasks.json.data).toHaveLength(1)

    const overview = await GET<ProjectOverview>(`/api/projects/${project.id}/overview`)
    expect(overview.json.ok).toBe(true)
    if (!overview.json.ok) return
    expect(overview.json.data.counts.chatShortTasks).toBe(1)
    expect(overview.json.data.counts.projectTasks).toBe(1)
  })

  it('updates task status and visibility', async () => {
    const { project, session } = await setupProjectAndSession()

    const created = await POST<Task>('/api/tasks', {
      projectId: project.id,
      sessionId: session.id,
      title: 'Follow up',
      assignee: 'human',
      kind: 'once',
      surface: 'chat_short',
      visibleInChat: true,
      origin: 'manual',
      createdBy: 'human',
    })
    expect(created.json.ok).toBe(true)
    if (!created.json.ok) return

    const updated = await PATCH<Task>(`/api/tasks/${created.json.data.id}`, {
      status: 'done',
      visibleInChat: false,
      completionOutput: 'Completed through review',
    })
    expect(updated.status).toBe(200)
    expect(updated.json.ok).toBe(true)
    if (!updated.json.ok) return
    expect(updated.json.data.status).toBe('done')
    expect(updated.json.data.visibleInChat).toBe(false)
  })
})

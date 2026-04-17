import { beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import type { Project, Session, Task } from '@pluse/types'
import { DEL, GET, PATCH, POST, makeWorkDir, resetTestDb, setupTestDb } from './helpers'

beforeAll(() => setupTestDb())
beforeEach(() => resetTestDb())

async function setup(): Promise<{ project: Project; session: Session }> {
  const p = await POST<Project>('/api/projects/open', {
    workDir: makeWorkDir('task-project'),
    name: 'Task Project',
  })
  expect(p.json.ok).toBe(true)
  if (!p.json.ok) throw new Error(p.json.error)

  const s = await POST<Session>('/api/sessions', {
    projectId: p.json.data.id,
    name: 'Task Session',
  })
  expect(s.json.ok).toBe(true)
  if (!s.json.ok) throw new Error(s.json.error)

  return { project: p.json.data, session: s.json.data }
}

describe('task CRUD', () => {
  it('creates and retrieves a task', async () => {
    const { project, session } = await setup()

    const created = await POST<Task>('/api/tasks', {
      projectId: project.id,
      sessionId: session.id,
      originSessionId: session.id,
      title: 'Write tests',
      assignee: 'human',
      kind: 'once',
      createdBy: 'human',
    })
    expect(created.status).toBe(201)
    expect(created.json.ok).toBe(true)
    if (!created.json.ok) return
    expect(created.json.data.title).toBe('Write tests')
    expect(created.json.data.assignee).toBe('human')
    expect(created.json.data.createdBy).toBe('human')
    expect(created.json.data.originSessionId).toBe(session.id)

    const fetched = await GET<Task>(`/api/tasks/${created.json.data.id}`)
    expect(fetched.json.ok).toBe(true)
    if (!fetched.json.ok) return
    expect(fetched.json.data.id).toBe(created.json.data.id)
  })

  it('lists tasks by project', async () => {
    const { project } = await setup()

    await POST('/api/tasks', { projectId: project.id, title: 'Task A', assignee: 'ai', kind: 'once', createdBy: 'ai' })
    await POST('/api/tasks', { projectId: project.id, title: 'Task B', assignee: 'human', kind: 'once', createdBy: 'human' })

    const all = await GET<Task[]>(`/api/tasks?projectId=${project.id}`)
    expect(all.json.ok).toBe(true)
    if (!all.json.ok) return
    expect(all.json.data).toHaveLength(2)

    const aiOnly = await GET<Task[]>(`/api/tasks?projectId=${project.id}&assignee=ai`)
    expect(aiOnly.json.ok).toBe(true)
    if (!aiOnly.json.ok) return
    expect(aiOnly.json.data).toHaveLength(1)
    expect(aiOnly.json.data[0].title).toBe('Task A')
  })

  it('updates task status and completionOutput', async () => {
    const { project } = await setup()

    const created = await POST<Task>('/api/tasks', {
      projectId: project.id,
      title: 'Do something',
      assignee: 'human',
      kind: 'once',
      createdBy: 'human',
    })
    expect(created.json.ok).toBe(true)
    if (!created.json.ok) return

    const updated = await PATCH<Task>(`/api/tasks/${created.json.data.id}`, {
      status: 'done',
      completionOutput: 'All done',
    })
    expect(updated.status).toBe(200)
    expect(updated.json.ok).toBe(true)
    if (!updated.json.ok) return
    expect(updated.json.data.status).toBe('done')
    expect(updated.json.data.completionOutput).toBe('All done')
  })

  it('deletes a task', async () => {
    const { project } = await setup()

    const created = await POST<Task>('/api/tasks', {
      projectId: project.id,
      title: 'Temp task',
      assignee: 'human',
      kind: 'once',
      createdBy: 'human',
    })
    expect(created.json.ok).toBe(true)
    if (!created.json.ok) return

    const deleted = await DEL(`/api/tasks/${created.json.data.id}`)
    expect(deleted.status).toBe(200)

    const fetched = await GET<Task>(`/api/tasks/${created.json.data.id}`)
    expect(fetched.status).toBe(404)
  })
})

describe('task block / unblock', () => {
  it('blocks and unblocks a task', async () => {
    const { project } = await setup()

    const blocker = await POST<Task>('/api/tasks', {
      projectId: project.id, title: 'Blocker', assignee: 'ai', kind: 'once', createdBy: 'ai',
    })
    const blocked = await POST<Task>('/api/tasks', {
      projectId: project.id, title: 'Blocked', assignee: 'ai', kind: 'once', createdBy: 'ai',
    })
    expect(blocker.json.ok && blocked.json.ok).toBe(true)
    if (!blocker.json.ok || !blocked.json.ok) return

    const blockResult = await POST<Task>(`/api/tasks/${blocked.json.data.id}/block`, {
      blockerId: blocker.json.data.id,
    })
    expect(blockResult.status).toBe(200)
    expect(blockResult.json.ok).toBe(true)
    if (!blockResult.json.ok) return
    expect(blockResult.json.data.status).toBe('blocked')
    expect(blockResult.json.data.blockedByTaskId).toBe(blocker.json.data.id)

    const unblockResult = await DEL(`/api/tasks/${blocked.json.data.id}/block`)
    expect(unblockResult.status).toBe(200)
    const unblocked = await GET<Task>(`/api/tasks/${blocked.json.data.id}`)
    expect(unblocked.json.ok).toBe(true)
    if (!unblocked.json.ok) return
    expect(unblocked.json.data.status).toBe('pending')
    expect(unblocked.json.data.blockedByTaskId).toBeUndefined()
  })

  it('rejects blocking across different projects', async () => {
    const p1 = await POST<Project>('/api/projects/open', { workDir: makeWorkDir('proj1'), name: 'P1' })
    const p2 = await POST<Project>('/api/projects/open', { workDir: makeWorkDir('proj2'), name: 'P2' })
    expect(p1.json.ok && p2.json.ok).toBe(true)
    if (!p1.json.ok || !p2.json.ok) return

    const t1 = await POST<Task>('/api/tasks', { projectId: p1.json.data.id, title: 'T1', assignee: 'ai', kind: 'once', createdBy: 'ai' })
    const t2 = await POST<Task>('/api/tasks', { projectId: p2.json.data.id, title: 'T2', assignee: 'ai', kind: 'once', createdBy: 'ai' })
    expect(t1.json.ok && t2.json.ok).toBe(true)
    if (!t1.json.ok || !t2.json.ok) return

    const result = await POST(`/api/tasks/${t2.json.data.id}/block`, { blockerId: t1.json.data.id })
    expect(result.status).toBe(400)
  })
})

describe('task create-session', () => {
  it('creates a session from a task', async () => {
    const { project } = await setup()

    const task = await POST<Task>('/api/tasks', {
      projectId: project.id, title: 'AI work', assignee: 'ai', kind: 'once', createdBy: 'ai',
    })
    expect(task.json.ok).toBe(true)
    if (!task.json.ok) return

    const result = await POST<{ session: Session; task: Task }>(`/api/tasks/${task.json.data.id}/create-session`, {
      name: 'AI work session',
    })
    expect(result.status).toBe(201)
    expect(result.json.ok).toBe(true)
    if (!result.json.ok) return
    expect(result.json.data.session.sourceTaskId).toBe(task.json.data.id)
    expect(result.json.data.session.projectId).toBe(project.id)
    expect(result.json.data.session.createdBy).toBe('system')
    expect(result.json.data.task?.sessionId).toBe(result.json.data.session.id)
  })
})

describe('session create-task', () => {
  it('creates a task from a session', async () => {
    const { session } = await setup()

    const result = await POST<Task>(`/api/sessions/${session.id}/create-task`, {
      title: 'Follow-up work',
      assignee: 'ai',
      description: 'Do some follow-up',
    })
    expect(result.status).toBe(201)
    expect(result.json.ok).toBe(true)
    if (!result.json.ok) return
    expect(result.json.data.originSessionId).toBe(session.id)
    expect(result.json.data.sessionId).toBe(session.id)
    expect(result.json.data.assignee).toBe('ai')
    expect(result.json.data.createdBy).toBe('human')
  })

  it('creates a human task with waitingInstructions', async () => {
    const { session } = await setup()

    const result = await POST<Task>(`/api/sessions/${session.id}/create-task`, {
      title: 'Review output',
      assignee: 'human',
      waitingInstructions: 'Please check the generated code',
    })
    expect(result.status).toBe(201)
    expect(result.json.ok).toBe(true)
    if (!result.json.ok) return
    expect(result.json.data.assignee).toBe('human')
    expect(result.json.data.waitingInstructions).toBe('Please check the generated code')
  })
})

describe('GET /api/commands', () => {
  it('returns command catalog grouped by module', async () => {
    const result = await GET<{ modules: Array<{ name: string; commands: unknown[] }> }>('/api/commands')
    expect(result.status).toBe(200)
    expect(result.json.ok).toBe(true)
    if (!result.json.ok) return

    const modules = result.json.data.modules
    const names = modules.map((m) => m.name)
    expect(names).toContain('session')
    expect(names).toContain('task')
    expect(names).toContain('project')
    expect(names).toContain('commands')

    const taskModule = modules.find((m) => m.name === 'task')!
    const cmdNames = taskModule.commands.map((c: any) => c.name)
    expect(cmdNames).toContain('task list')
    expect(cmdNames).toContain('task create')
    expect(cmdNames).toContain('task done')
    expect(cmdNames).toContain('task block')
    expect(cmdNames).toContain('task unblock')
    expect(cmdNames).toContain('task create-session')

    const sessionModule = modules.find((m) => m.name === 'session')!
    const sessionCmdNames = sessionModule.commands.map((c: any) => c.name)
    expect(sessionCmdNames).toContain('session create-task')

    // each command has cli + api fields
    for (const mod of modules) {
      for (const cmd of mod.commands as any[]) {
        expect(typeof cmd.cli).toBe('string')
        expect(typeof cmd.api).toBe('string')
        expect(typeof cmd.description).toBe('string')
      }
    }
  })
})

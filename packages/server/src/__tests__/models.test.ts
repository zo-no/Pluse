import { beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { createProjectRecord, deleteProjectRecord, getProject, listProjects, updateProject } from '../models/project'
import {
  createSession,
  dequeueFollowUp,
  enqueueFollowUp,
  getFollowUpQueue,
  getSession,
  listSessions,
  updateSession,
} from '../models/session'
import { cancelRun, createRun, getRun, getRunsBySession, updateRun } from '../models/run'
import { createTask, deleteTask, getTask, listTasks, updateTask } from '../models/task'
import { resetTestDb, setupTestDb } from './helpers'

beforeAll(() => setupTestDb())
beforeEach(() => resetTestDb())

describe('project model', () => {
  it('creates, lists, updates and deletes Pulse projects', () => {
    const project = createProjectRecord({ name: 'Alpha', workDir: '/tmp/pulse-alpha' })
    expect(project.id).toMatch(/^proj_/)
    expect(project.workDir).toBe('/tmp/pulse-alpha')
    expect(project.visibility).toBe('user')

    expect(listProjects()).toHaveLength(1)

    const updated = updateProject(project.id, {
      name: 'Alpha Renamed',
      goal: 'Ship Pulse',
      systemPrompt: 'Stay focused.',
      pinned: true,
    })
    expect(updated.name).toBe('Alpha Renamed')
    expect(updated.goal).toBe('Ship Pulse')
    expect(updated.systemPrompt).toBe('Stay focused.')
    expect(updated.pinned).toBe(true)

    deleteProjectRecord(project.id)
    expect(getProject(project.id)).toBeNull()
  })
})

describe('session model', () => {
  it('creates and filters sessions by project and archived state', () => {
    const project = createProjectRecord({ name: 'Project', workDir: '/tmp/project' })
    const otherProject = createProjectRecord({ name: 'Other', workDir: '/tmp/other' })

    const primary = createSession({ projectId: project.id, name: 'Main Session', tool: 'codex' })
    createSession({ projectId: otherProject.id, name: 'Other Session', tool: 'claude' })

    expect(getSession(primary.id)?.projectId).toBe(project.id)
    expect(listSessions({ projectId: project.id })).toHaveLength(1)

    const archived = updateSession(primary.id, { archived: true, pinned: true })
    expect(archived.archived).toBe(true)
    expect(archived.archivedAt).toBeTruthy()

    expect(listSessions({ projectId: project.id })).toHaveLength(0)
    expect(listSessions({ projectId: project.id, archived: true })).toHaveLength(1)
  })

  it('stores and drains follow-up queue entries', () => {
    const project = createProjectRecord({ name: 'Project', workDir: '/tmp/project' })
    const session = createSession({ projectId: project.id, name: 'Queued Session' })

    enqueueFollowUp(session.id, {
      requestId: 'req_1',
      text: 'Check project overview',
      tool: 'codex',
      model: null,
      effort: 'medium',
      thinking: false,
    })
    enqueueFollowUp(session.id, {
      requestId: 'req_1',
      text: 'duplicate should be ignored',
      tool: 'codex',
      model: null,
      effort: 'high',
      thinking: true,
    })

    expect(getFollowUpQueue(session.id)).toHaveLength(1)
    expect(dequeueFollowUp(session.id)?.requestId).toBe('req_1')
    expect(dequeueFollowUp(session.id)).toBeNull()
  })
})

describe('run model', () => {
  it('creates, updates and cancels runs', () => {
    const project = createProjectRecord({ name: 'Project', workDir: '/tmp/project' })
    const session = createSession({ projectId: project.id, name: 'Run Session' })
    const run = createRun({
      sessionId: session.id,
      requestId: 'req_1',
      tool: 'codex',
      model: 'gpt-5.4',
    })

    expect(getRun(run.id)?.state).toBe('accepted')

    const running = updateRun(run.id, { state: 'running', startedAt: new Date().toISOString() })
    expect(running.state).toBe('running')

    const cancelled = cancelRun(run.id)
    expect(cancelled.cancelRequested).toBe(true)
    expect(getRunsBySession(session.id)).toHaveLength(1)
  })
})

describe('task model', () => {
  it('creates, filters, updates and deletes project and chat tasks', () => {
    const project = createProjectRecord({ name: 'Project', workDir: '/tmp/project' })
    const session = createSession({ projectId: project.id, name: 'Task Session' })

    const chatTask = createTask({
      projectId: project.id,
      sessionId: session.id,
      title: 'Follow up with agent',
      assignee: 'ai',
      kind: 'once',
      surface: 'chat_short',
      visibleInChat: true,
      origin: 'agent',
      createdBy: 'ai',
    })
    const projectTask = createTask({
      projectId: project.id,
      title: 'Nightly cleanup',
      assignee: 'human',
      kind: 'recurring',
      surface: 'project',
      visibleInChat: false,
      origin: 'system',
      createdBy: 'system',
      scheduleConfig: {
        kind: 'recurring',
        cron: '0 * * * *',
        timezone: 'Asia/Shanghai',
      },
    })

    expect(listTasks({ projectId: project.id })).toHaveLength(2)
    expect(listTasks({ sessionId: session.id, visibleInChat: true })).toHaveLength(1)
    expect(listTasks({ projectId: project.id, surface: 'project' })).toHaveLength(1)

    const updated = updateTask(chatTask.id, { status: 'done', completionOutput: 'handled' })
    expect(updated?.status).toBe('done')
    expect(updated?.completionOutput).toBe('handled')

    expect(getTask(projectTask.id)?.kind).toBe('recurring')
    expect(deleteTask(projectTask.id)).toBe(true)
    expect(getTask(projectTask.id)).toBeNull()
  })
})

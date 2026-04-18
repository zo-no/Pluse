import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  ApiResult,
  PagedResult,
  Project,
  ProjectOverview,
  Quest,
  QuestEvent,
  QuestOp,
  Run,
  Todo,
  UploadedAsset,
} from '@pluse/types'
import type { StartQuestRunResult, SubmitQuestMessageResult } from '../runtime/session-runner'
import { appendEvent } from '../models/history'
import { getQuest } from '../models/quest'
import { getRun, getRunsByQuest } from '../models/run'
import { listTodos } from '../models/todo'
import { stopScheduler } from '../services/scheduler'
import { getAssetsDir, getHistoryRoot } from '../support/paths'
import { DEL, GET, PATCH, POST, getTestRoot, makeWorkDir, resetTestDb, setupTestDb, waitFor } from './helpers'

const RUNTIME_ENV_KEYS = [
  'PLUSE_CODEX_COMMAND',
  'PLUSE_FAKE_CODEX_ARGS_LOG',
  'PLUSE_FAKE_CODEX_AUTO_RENAME_FAIL',
  'PLUSE_FAKE_CODEX_AUTO_RENAME_REPLY',
  'PLUSE_FAKE_CODEX_DELAY_SECONDS',
  'PLUSE_FAKE_CODEX_FAIL_ON_RESUME',
  'PLUSE_FAKE_CODEX_REPLY',
  'PLUSE_FAKE_CODEX_THREAD_ID',
]

function resetRuntimeEnv(): void {
  for (const key of RUNTIME_ENV_KEYS) {
    delete process.env[key]
  }
}

function mustOk<T>(response: { json: ApiResult<T> }): T {
  expect(response.json.ok).toBe(true)
  if (!response.json.ok) {
    throw new Error(response.json.error)
  }
  return response.json.data
}

async function openProject(name: string): Promise<Project> {
  const response = await POST<Project>('/api/projects/open', {
    workDir: makeWorkDir(name),
    name,
  })
  expect(response.status).toBe(201)
  return mustOk(response)
}

async function createQuest(input: Record<string, unknown>): Promise<Quest> {
  const response = await POST<Quest>('/api/quests', input)
  expect(response.status).toBe(201)
  return mustOk(response)
}

function installFakeCodex(): { commandPath: string; argsLogPath: string } {
  const binDir = join(getTestRoot(), 'bin')
  const commandPath = join(binDir, 'fake-codex.sh')
  const argsLogPath = join(getTestRoot(), 'fake-codex-args.log')

  mkdirSync(binDir, { recursive: true })
  writeFileSync(commandPath, `#!/bin/sh
set -eu
if [ -n "\${PLUSE_FAKE_CODEX_ARGS_LOG:-}" ]; then
  printf '%s\\n' "$*" >> "$PLUSE_FAKE_CODEX_ARGS_LOG"
fi
if [ -n "\${PLUSE_FAKE_CODEX_DELAY_SECONDS:-}" ]; then
  sleep "$PLUSE_FAKE_CODEX_DELAY_SECONDS"
fi
if [ "\${PLUSE_FAKE_CODEX_FAIL_ON_RESUME:-}" = "1" ]; then
  case " $* " in
    *" resume "*)
      printf '%s\\n' "resume thread expired" >&2
      exit 1
      ;;
  esac
fi
reply="\${PLUSE_FAKE_CODEX_REPLY:-Fake reply}"
case "$*" in
  *"Generate a short title for this Pluse session based on the first round conversation."*)
    if [ "\${PLUSE_FAKE_CODEX_AUTO_RENAME_FAIL:-}" = "1" ]; then
      printf '%s\\n' "auto rename failed" >&2
      exit 1
    fi
    if [ -n "\${PLUSE_FAKE_CODEX_AUTO_RENAME_REPLY:-}" ]; then
      reply="\${PLUSE_FAKE_CODEX_AUTO_RENAME_REPLY}"
    fi
    ;;
esac
thread="\${PLUSE_FAKE_CODEX_THREAD_ID:-thread_fake}"
printf '{"thread_id":"%s","type":"message","role":"assistant","content":"%s"}\\n' "$thread" "$reply"
`)
  chmodSync(commandPath, 0o755)
  writeFileSync(argsLogPath, '')

  process.env['PLUSE_CODEX_COMMAND'] = commandPath
  process.env['PLUSE_FAKE_CODEX_ARGS_LOG'] = argsLogPath
  process.env['PLUSE_FAKE_CODEX_REPLY'] = 'Fake reply'
  process.env['PLUSE_FAKE_CODEX_THREAD_ID'] = 'thread_fake'
  delete process.env['PLUSE_FAKE_CODEX_AUTO_RENAME_FAIL']
  delete process.env['PLUSE_FAKE_CODEX_AUTO_RENAME_REPLY']
  delete process.env['PLUSE_FAKE_CODEX_DELAY_SECONDS']

  return { commandPath, argsLogPath }
}

beforeAll(() => setupTestDb())

beforeEach(() => {
  stopScheduler()
  resetRuntimeEnv()
  resetTestDb()
})

afterAll(() => {
  stopScheduler()
  resetRuntimeEnv()
})

describe('quest/todo/run APIs', () => {
  it('creates quests, updates kind/state, and exposes only quest/todo command modules', async () => {
    const project = await openProject('quests')

    const session = await createQuest({
      projectId: project.id,
      kind: 'session',
      name: 'Design Review',
      tool: 'codex',
    })

    const task = await createQuest({
      projectId: project.id,
      kind: 'task',
      title: 'Nightly Sync',
      description: 'Refresh the project snapshot',
      tool: 'codex',
      executorKind: 'script',
      executorConfig: { command: "printf 'ok\\n'" },
      scheduleKind: 'recurring',
      scheduleConfig: {
        cron: '0 * * * *',
        timezone: 'Asia/Shanghai',
      },
      status: 'done',
    })

    const sessions = await GET<Quest[]>(`/api/quests?projectId=${project.id}&kind=session&search=design`)
    expect(sessions.status).toBe(200)
    expect(mustOk(sessions).map((quest) => quest.id)).toEqual([session.id])

    const switchedToSession = await PATCH<Quest>(`/api/quests/${task.id}`, { kind: 'session' })
    expect(switchedToSession.status).toBe(200)
    const switchedToSessionData = mustOk(switchedToSession)
    expect(switchedToSessionData.kind).toBe('session')
    expect(switchedToSessionData.status).toBe('idle')
    expect(switchedToSessionData.scheduleKind).toBe('recurring')
    expect(switchedToSessionData.executorKind).toBe('script')

    const switchedBackToTask = await PATCH<Quest>(`/api/quests/${task.id}`, { kind: 'task' })
    expect(switchedBackToTask.status).toBe(200)
    const switchedBackToTaskData = mustOk(switchedBackToTask)
    expect(switchedBackToTaskData.kind).toBe('task')
    expect(switchedBackToTaskData.status).toBe('pending')
    expect(switchedBackToTaskData.scheduleKind).toBe('recurring')
    expect(switchedBackToTaskData.title).toBe('Nightly Sync')

    const clearedFields = await PATCH<Quest>(`/api/quests/${task.id}`, {
      description: null,
      model: null,
      executorConfig: null,
      scheduleConfig: null,
    })
    expect(clearedFields.status).toBe(200)
    const clearedFieldsData = mustOk(clearedFields)
    expect(clearedFieldsData.description).toBeUndefined()
    expect(clearedFieldsData.model).toBeUndefined()
    expect(clearedFieldsData.executorConfig).toBeUndefined()
    expect(clearedFieldsData.scheduleConfig).toBeUndefined()

    const todo = await POST<Todo>('/api/todos', {
      projectId: project.id,
      originQuestId: switchedBackToTaskData.id,
      title: 'Need PM confirmation',
      waitingInstructions: 'Ask PM whether the nightly sync can run against prod snapshots.',
    })
    expect(todo.status).toBe(201)
    const todoData = mustOk(todo)
    expect(todoData.status).toBe('pending')

    const overview = await GET<ProjectOverview>(`/api/projects/${project.id}/overview`)
    expect(overview.status).toBe(200)
    const overviewData = mustOk(overview)
    expect(overviewData.counts).toEqual({ sessions: 1, tasks: 1, todos: 1 })
    expect(overviewData.waitingTodos.map((item) => item.id)).toEqual([todoData.id])

    const finishedTodo = await PATCH<Todo>(`/api/todos/${todoData.id}`, {
      status: 'done',
      description: 'Confirmed by PM',
    })
    expect(finishedTodo.status).toBe(200)
    expect(mustOk(finishedTodo).status).toBe('done')

    const doneTodos = await GET<Todo[]>(`/api/todos?projectId=${project.id}&status=done`)
    expect(doneTodos.status).toBe(200)
    expect(mustOk(doneTodos).map((item) => item.id)).toEqual([todoData.id])

    const linkedQuest = await createQuest({
      projectId: project.id,
      kind: 'session',
      name: 'Disposable Quest',
    })
    const linkedTodo = await POST<Todo>('/api/todos', {
      projectId: project.id,
      originQuestId: linkedQuest.id,
      title: 'Quest-linked todo',
    })
    expect(linkedTodo.status).toBe(201)
    expect((await DEL<{ deleted: true }>(`/api/quests/${linkedQuest.id}`)).status).toBe(200)
    const refreshedLinkedTodo = await GET<Todo>(`/api/todos/${mustOk(linkedTodo).id}`)
    expect(refreshedLinkedTodo.status).toBe(200)
    expect(mustOk(refreshedLinkedTodo).originQuestId).toBeUndefined()

    const ops = await GET<QuestOp[]>(`/api/quests/${task.id}/ops`)
    expect(ops.status).toBe(200)
    expect(mustOk(ops).filter((entry) => entry.op === 'kind_changed')).toHaveLength(2)

    const deletedTodo = await DEL<{ deleted: true }>(`/api/todos/${todoData.id}`)
    expect(deletedTodo.status).toBe(200)
    expect((await GET(`/api/todos/${todoData.id}`)).status).toBe(404)

    const commands = await GET<{ modules: Array<{ name: string; commands: Array<{ name: string; api: string }> }> }>('/api/commands')
    expect(commands.status).toBe(200)
    const commandCatalog = mustOk(commands)
    const moduleNames = commandCatalog.modules.map((module) => module.name)
    expect(moduleNames).toEqual(['quest', 'todo', 'run', 'project', 'commands'])
    expect(moduleNames).not.toContain('session')
    expect(moduleNames).not.toContain('task')
    const todoModule = commandCatalog.modules.find((module) => module.name === 'todo')
    expect(todoModule?.commands.map((command) => command.name)).toEqual(['todo list', 'todo get', 'todo create', 'todo done', 'todo update', 'todo delete'])
    expect(todoModule?.commands.some((command) => command.api.includes('/cancel'))).toBe(false)
    expect(todoModule?.commands.some((command) => command.api.includes('/done'))).toBe(false)
  })

  it('persists assets under quest storage and removes quest data when deleting a project', async () => {
    const project = await openProject('assets')
    const quest = await createQuest({
      projectId: project.id,
      kind: 'session',
      name: 'Attachment Thread',
    })

    appendEvent(quest.id, {
      timestamp: Date.now(),
      type: 'message',
      role: 'user',
      content: 'Keep this file attached.',
    })

    const formData = new FormData()
    formData.set('questId', quest.id)
    formData.set('file', new File(['hello asset'], 'notes.txt', { type: 'text/plain' }))

    const uploaded = await POST<UploadedAsset>('/api/assets/upload', formData)
    expect(uploaded.status).toBe(201)
    const uploadedData = mustOk(uploaded)
    expect(uploadedData.questId).toBe(quest.id)
    expect(uploadedData.savedPath.startsWith(getAssetsDir(quest.id))).toBe(true)
    expect(existsSync(uploadedData.savedPath)).toBe(true)

    const fetchedAsset = await GET<UploadedAsset>(`/api/assets/${uploadedData.id}`)
    expect(fetchedAsset.status).toBe(200)
    expect(mustOk(fetchedAsset).filename).toBe('notes.txt')

    const historyDir = join(getHistoryRoot(), quest.id)
    expect(existsSync(historyDir)).toBe(true)

    const deleted = await DEL<{ deleted: true }>(`/api/projects/${project.id}`)
    expect(deleted.status).toBe(200)
    expect((await GET(`/api/projects/${project.id}`)).status).toBe(404)
    expect((await GET(`/api/quests/${quest.id}`)).status).toBe(404)
    expect((await GET(`/api/assets/${uploadedData.id}`)).status).toBe(404)
    expect(existsSync(uploadedData.savedPath)).toBe(false)
    expect(existsSync(historyDir)).toBe(false)
  })

  it('queues session chat messages, supports queue cancellation, and auto-runs the next follow-up', async () => {
    const { argsLogPath } = installFakeCodex()
    process.env['PLUSE_FAKE_CODEX_DELAY_SECONDS'] = '0.2'
    process.env['PLUSE_FAKE_CODEX_REPLY'] = 'Queued reply'
    process.env['PLUSE_FAKE_CODEX_AUTO_RENAME_REPLY'] = 'Launch checklist plan'
    process.env['PLUSE_FAKE_CODEX_THREAD_ID'] = 'thread_chat'

    const project = await openProject('chat-runtime')
    const quest = await createQuest({
      projectId: project.id,
      kind: 'session',
      tool: 'codex',
    })

    const firstMessage = await POST<SubmitQuestMessageResult>(`/api/quests/${quest.id}/messages`, {
      text: 'Plan launch checklist',
      requestId: 'chat-1',
    })
    expect(firstMessage.status).toBe(200)
    const firstMessageData = mustOk(firstMessage)
    expect(firstMessageData.queued).toBe(false)
    expect(firstMessageData.run?.id).toBeTruthy()

    const duplicate = await POST<SubmitQuestMessageResult>(`/api/quests/${quest.id}/messages`, {
      text: 'Plan launch checklist',
      requestId: 'chat-1',
    })
    expect(duplicate.status).toBe(200)
    expect(mustOk(duplicate).run?.id).toBe(firstMessageData.run?.id)

    const queuedTwo = await POST<SubmitQuestMessageResult>(`/api/quests/${quest.id}/messages`, {
      text: 'Summarize owners',
      requestId: 'chat-2',
    })
    const queuedThree = await POST<SubmitQuestMessageResult>(`/api/quests/${quest.id}/messages`, {
      text: 'Summarize blockers',
      requestId: 'chat-3',
    })
    expect(mustOk(queuedTwo).queued).toBe(true)
    expect(mustOk(queuedThree).queued).toBe(true)

    const removedQueued = await DEL<Quest>(`/api/quests/${quest.id}/queue/chat-2`)
    expect(removedQueued.status).toBe(200)
    expect(mustOk(removedQueued).followUpQueue.map((entry) => entry.requestId)).toEqual(['chat-3'])

    const clearedQueue = await DEL<Quest>(`/api/quests/${quest.id}/queue`)
    expect(clearedQueue.status).toBe(200)
    expect(mustOk(clearedQueue).followUpQueue).toHaveLength(0)

    const queuedFinal = await POST<SubmitQuestMessageResult>(`/api/quests/${quest.id}/messages`, {
      text: 'Summarize risks',
      requestId: 'chat-4',
    })
    expect(mustOk(queuedFinal).queued).toBe(true)

    await waitFor(() => {
      const runs = getRunsByQuest(quest.id)
      expect(runs).toHaveLength(2)
      expect(runs.every((run) => run.state === 'completed')).toBe(true)
      const freshQuest = getQuest(quest.id)
      expect(freshQuest).not.toBeNull()
      expect(freshQuest?.activeRunId).toBeUndefined()
      expect(freshQuest?.followUpQueue).toHaveLength(0)
      return runs
    }, { timeoutMs: 6_000 })

    const freshQuest = getQuest(quest.id)
    expect(freshQuest?.name).toBe('Launch checklist plan')
    expect(freshQuest?.codexThreadId).toBe('thread_chat')
    const argsLog = readFileSync(argsLogPath, 'utf8')
    expect(argsLog).toContain('exec --json')
    expect(argsLog).toContain('Generate a short title for this Pluse session based on the first round conversation.')

    const events = await GET<PagedResult<QuestEvent>>(`/api/quests/${quest.id}/events`)
    expect(events.status).toBe(200)
    expect(mustOk(events).items.some((event) => event.type === 'message' && event.role === 'assistant' && event.content === 'Queued reply')).toBe(true)

    const runs = await GET<Run[]>(`/api/quests/${quest.id}/runs`)
    expect(runs.status).toBe(200)
    const runList = mustOk(runs)
    expect(runList).toHaveLength(2)
    expect(runList.every((run) => run.codexThreadId === 'thread_chat')).toBe(true)
  })

  it('falls back to the first user message when AI auto rename fails', async () => {
    installFakeCodex()
    process.env['PLUSE_FAKE_CODEX_REPLY'] = 'First reply'
    process.env['PLUSE_FAKE_CODEX_AUTO_RENAME_FAIL'] = '1'
    process.env['PLUSE_FAKE_CODEX_THREAD_ID'] = 'thread_fallback'

    const project = await openProject('chat-auto-rename-fallback')
    const quest = await createQuest({
      projectId: project.id,
      kind: 'session',
      tool: 'codex',
    })

    const started = await POST<SubmitQuestMessageResult>(`/api/quests/${quest.id}/messages`, {
      text: 'Prepare release readiness checklist',
      requestId: 'rename-fallback-1',
    })
    expect(started.status).toBe(200)
    expect(mustOk(started).queued).toBe(false)

    await waitFor(() => {
      const freshQuest = getQuest(quest.id)
      expect(freshQuest?.activeRunId).toBeUndefined()
      expect(freshQuest?.autoRenamePending).toBeUndefined()
      expect(freshQuest?.name).toBe('Prepare release readiness checklist')
      return freshQuest
    }, { timeoutMs: 6_000 })
  })

  it('enforces manual task run conflicts, skips overlapping automation runs, and records review todos', async () => {
    const project = await openProject('script-task')
    const task = await createQuest({
      projectId: project.id,
      kind: 'task',
      title: 'Nightly Build',
      tool: 'codex',
      executorKind: 'script',
      executorConfig: {
        command: "printf 'line-one\\nline-two\\n'; sleep 0.2",
      },
      reviewOnComplete: true,
    })

    const started = await POST<StartQuestRunResult>(`/api/quests/${task.id}/run`, {
      requestId: 'task-1',
      trigger: 'manual',
      triggeredBy: 'api',
    })
    expect(started.status).toBe(200)
    const startedData = mustOk(started)
    expect(startedData.skipped).toBe(false)
    expect(startedData.run?.id).toBeTruthy()

    const conflict = await POST(`/api/quests/${task.id}/run`, {
      requestId: 'task-2',
      trigger: 'manual',
      triggeredBy: 'api',
    })
    expect(conflict.status).toBe(409)

    const skipped = await POST<StartQuestRunResult>(`/api/quests/${task.id}/run`, {
      requestId: 'task-3',
      trigger: 'automation',
      triggeredBy: 'scheduler',
    })
    expect(skipped.status).toBe(200)
    expect(mustOk(skipped).skipped).toBe(true)

    await waitFor(() => {
      const run = getRun(startedData.run!.id)
      expect(run?.state).toBe('completed')
      return run
    }, { timeoutMs: 6_000 })

    const spool = await GET<Array<{ id: number; ts: string; line: string }>>(`/api/runs/${startedData.run!.id}/spool`)
    expect(spool.status).toBe(200)
    expect(mustOk(spool).map((line) => line.line)).toEqual(['line-one', 'line-two'])

    const refreshedTask = getQuest(task.id)
    expect(refreshedTask?.status).toBe('done')
    expect(refreshedTask?.completionOutput).toBe('line-two')

    const questOps = await GET<QuestOp[]>(`/api/quests/${task.id}/ops`)
    expect(questOps.status).toBe(200)
    const questOpsData = mustOk(questOps)
    expect(questOpsData.some((entry) => entry.op === 'triggered')).toBe(true)
    expect(questOpsData.some((entry) => entry.op === 'done')).toBe(true)

    await waitFor(() => {
      const todos = listTodos({ projectId: project.id, status: 'pending' })
      expect(todos.some((todo) => todo.originQuestId === task.id && todo.title.includes('Review: Nightly Build'))).toBe(true)
      return todos
    })
  })

  it('returns cancelled task runs to pending status', async () => {
    const project = await openProject('cancel-task')
    const task = await createQuest({
      projectId: project.id,
      kind: 'task',
      title: 'Cancelable Task',
      tool: 'codex',
      executorKind: 'script',
      executorConfig: {
        command: 'sleep 1',
      },
      scheduleKind: 'recurring',
    })

    const started = await POST<StartQuestRunResult>(`/api/quests/${task.id}/run`, {
      requestId: 'cancel-task-1',
      trigger: 'manual',
      triggeredBy: 'api',
    })
    expect(started.status).toBe(200)
    const startedData = mustOk(started)

    const cancelled = await POST<Run>(`/api/runs/${startedData.run!.id}/cancel`)
    expect(cancelled.status).toBe(200)

    await waitFor(() => {
      const run = getRun(startedData.run!.id)
      expect(run?.state).toBe('cancelled')
      const refreshedTask = getQuest(task.id)
      expect(refreshedTask?.status).toBe('pending')
      return run
    }, { timeoutMs: 6_000 })
  })

  it('honors continueQuest=false for task AI prompts and resumes when continueQuest=true', async () => {
    const { argsLogPath } = installFakeCodex()
    process.env['PLUSE_FAKE_CODEX_REPLY'] = 'AI task reply'

    const project = await openProject('ai-task')

    process.env['PLUSE_FAKE_CODEX_THREAD_ID'] = 'thread_fresh'
    const noResumeTask = await createQuest({
      projectId: project.id,
      kind: 'task',
      title: 'Fresh Context Task',
      tool: 'codex',
      codexThreadId: 'thread_prev',
      executorKind: 'ai_prompt',
      executorConfig: {
        prompt: 'Write a short status update for {projectName}.',
      },
      executorOptions: {
        continueQuest: false,
      },
    })

    const firstRun = await POST<StartQuestRunResult>(`/api/quests/${noResumeTask.id}/run`, {
      requestId: 'ai-task-1',
      trigger: 'manual',
      triggeredBy: 'api',
    })
    expect(firstRun.status).toBe(200)
    const firstRunData = mustOk(firstRun)

    await waitFor(() => {
      const run = getRun(firstRunData.run!.id)
      expect(run?.state).toBe('completed')
      return run
    }, { timeoutMs: 6_000 })

    const firstInvocation = readFileSync(argsLogPath, 'utf8')
    expect(firstInvocation).not.toContain('resume thread_prev')
    expect(getQuest(noResumeTask.id)?.codexThreadId).toBe('thread_prev')
    expect(getRun(firstRunData.run!.id)?.codexThreadId).toBe('thread_fresh')

    writeFileSync(argsLogPath, '')
    process.env['PLUSE_FAKE_CODEX_THREAD_ID'] = 'thread_recovered'
    process.env['PLUSE_FAKE_CODEX_FAIL_ON_RESUME'] = '1'

    const resumeTask = await createQuest({
      projectId: project.id,
      kind: 'task',
      title: 'Resume Context Task',
      tool: 'codex',
      codexThreadId: 'thread_resume_from',
      executorKind: 'ai_prompt',
      executorConfig: {
        prompt: 'Continue the previous task context.',
      },
      executorOptions: {
        continueQuest: true,
      },
    })

    const secondRun = await POST<StartQuestRunResult>(`/api/quests/${resumeTask.id}/run`, {
      requestId: 'ai-task-2',
      trigger: 'manual',
      triggeredBy: 'api',
    })
    expect(secondRun.status).toBe(200)
    const secondRunData = mustOk(secondRun)

    await waitFor(() => {
      const run = getRun(secondRunData.run!.id)
      expect(run?.state).toBe('completed')
      return run
    }, { timeoutMs: 6_000 })

    const secondInvocation = readFileSync(argsLogPath, 'utf8')
    expect((secondInvocation.match(/exec --json/g) ?? [])).toHaveLength(2)
    expect((secondInvocation.match(/resume thread_resume_from/g) ?? [])).toHaveLength(1)
    expect(getQuest(resumeTask.id)?.codexThreadId).toBe('thread_recovered')

    const retryEvents = await GET<PagedResult<QuestEvent>>(`/api/quests/${resumeTask.id}/events`)
    expect(retryEvents.status).toBe(200)
    expect(mustOk(retryEvents).items.some((event) => event.type === 'status' && event.content?.includes('retrying with history injection'))).toBe(true)
  })
})

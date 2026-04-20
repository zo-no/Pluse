import { describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Quest } from '@pluse/types'
import { setDb } from '../db'
import { createProjectRecord } from '../models/project'
import { createQuest } from '../models/quest'
import { createRun } from '../models/run'

type CliResult = {
  exitCode: number
  stdout: string
  stderr: string
}

type Sandbox = {
  root: string
  dbPath: string
  workDir: string
  fakeCodex: string
  db: Database
}

const CLI_PATH = resolve(import.meta.dir, '../cli.ts')
const REPO_ROOT = resolve(import.meta.dir, '../../../..')

function decode(bytes: Uint8Array | ArrayBuffer | null | undefined): string {
  if (!bytes) return ''
  return new TextDecoder().decode(bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes)
}

function makeFakeCodexScript(): string {
  return `#!/bin/sh
set -eu

if [ -n "\${PLUSE_FAKE_CODEX_DELAY_SECONDS:-}" ]; then
  sleep "\${PLUSE_FAKE_CODEX_DELAY_SECONDS}"
fi

if [ "\${PLUSE_FAKE_CODEX_FAIL_ON_RESUME:-}" = "1" ]; then
  case " $* " in
    *" resume "*)
      printf '%s\n' "resume thread expired" >&2
      exit 1
      ;;
  esac
fi

reply="\${PLUSE_FAKE_CODEX_REPLY:-Fake reply}"
case "$*" in
  *"Generate a short title for this Pluse session based on the first round conversation."*)
    if [ "\${PLUSE_FAKE_CODEX_AUTO_RENAME_FAIL:-}" = "1" ]; then
      printf '%s\n' "auto rename failed" >&2
      exit 1
    fi
    if [ -n "\${PLUSE_FAKE_CODEX_AUTO_RENAME_REPLY:-}" ]; then
      reply="\${PLUSE_FAKE_CODEX_AUTO_RENAME_REPLY}"
    fi
    ;;
esac

thread="\${PLUSE_FAKE_CODEX_THREAD_ID:-thread_fake}"
printf '{"thread_id":"%s","type":"message","role":"assistant","content":"%s"}\n' "$thread" "$reply"
`
}

function createSandbox(): Sandbox {
  const root = mkdtempSync(join(tmpdir(), 'pluse-cli-'))
  const runtimeDir = join(root, 'runtime')
  const workDir = join(root, 'work')
  const binDir = join(root, 'bin')
  mkdirSync(runtimeDir, { recursive: true })
  mkdirSync(workDir, { recursive: true })
  mkdirSync(binDir, { recursive: true })

  const fakeCodex = join(binDir, 'fake-codex.sh')
  writeFileSync(fakeCodex, makeFakeCodexScript())
  chmodSync(fakeCodex, 0o755)

  const dbPath = join(runtimeDir, 'pluse.db')
  const db = new Database(dbPath, { create: true })
  setDb(db)

  return { root, dbPath, workDir, fakeCodex, db }
}

function cleanupSandbox(sandbox: Sandbox): void {
  try {
    sandbox.db.close(false)
  } catch {
    // ignore close races in tests
  }
  rmSync(sandbox.root, { recursive: true, force: true })
}

function runCli(
  sandbox: Sandbox,
  args: string[],
  extraEnv: Record<string, string> = {},
): CliResult {
  const proc = Bun.spawnSync(['bun', CLI_PATH, ...args], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PLUSE_CLI_MODE: 'offline',
      PLUSE_ROOT: sandbox.root,
      PLUSE_DB_PATH: sandbox.dbPath,
      PLUSE_CODEX_COMMAND: sandbox.fakeCodex,
      ...extraEnv,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  return {
    exitCode: proc.exitCode,
    stdout: decode(proc.stdout).trim(),
    stderr: decode(proc.stderr).trim(),
  }
}

function expectOk(result: CliResult): string {
  if (result.exitCode !== 0) {
    throw new Error(`CLI failed (${result.exitCode})\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
  }
  return result.stdout
}

function parseJson<T>(result: CliResult): T {
  return JSON.parse(expectOk(result)) as T
}

function expectFailure(result: CliResult, message: string): void {
  expect(result.exitCode).not.toBe(0)
  expect(`${result.stdout}\n${result.stderr}`).toContain(message)
}

describe('pluse cli', () => {
  it('covers auth and command catalog commands', () => {
    const sandbox = createSandbox()
    try {
      const setup = runCli(sandbox, ['auth', 'setup', '--username', 'alice', '--password', 'secret'])
      expect(setup.exitCode).toBe(0)
      expect(setup.stdout).toContain('configured auth for alice')

      const token = runCli(sandbox, ['auth', 'token'])
      expect(token.exitCode).toBe(0)
      expect(token.stdout).toMatch(/^[0-9a-f]{64}$/)

      const catalog = parseJson<{ modules: Array<{ name: string; commands: Array<{ name: string }> }> }>(
        runCli(sandbox, ['commands', '--json']),
      )
      const projectModule = catalog.modules.find((module) => module.name === 'project')
      expect(projectModule?.commands.map((command) => command.name)).toEqual([
        'project list',
        'project get',
        'project overview',
        'project open',
        'project update',
        'project archive',
        'project delete',
      ])
    } finally {
      cleanupSandbox(sandbox)
    }
  })

  it('covers project commands end to end', () => {
    const sandbox = createSandbox()
    try {
      const project = parseJson<{ id: string; name: string; goal?: string; pinned?: boolean }>(
        runCli(sandbox, [
          'project',
          'open',
          '--work-dir',
          sandbox.workDir,
          '--name',
          'Alpha',
          '--goal',
          'Ship it',
          '--pin',
          '--json',
        ]),
      )
      expect(project.name).toBe('Alpha')
      expect(project.goal).toBe('Ship it')
      expect(project.pinned).toBe(true)

      const sessionQuest = parseJson<{ id: string; kind: string; name?: string }>(
        runCli(sandbox, [
          'quest',
          'create',
          '--project-id',
          project.id,
          '--kind',
          'session',
          '--name',
          'CLI Session',
          '--json',
        ]),
      )
      expect(sessionQuest.kind).toBe('session')

      const taskQuest = parseJson<{ id: string; kind: string; title?: string }>(
        runCli(sandbox, [
          'quest',
          'create',
          '--project-id',
          project.id,
          '--kind',
          'task',
          '--title',
          'CLI Task',
          '--json',
        ]),
      )
      expect(taskQuest.kind).toBe('task')

      const todo = parseJson<{ id: string; title: string; status: string; dueAt?: string; repeat: string }>(
        runCli(sandbox, [
          'todo',
          'create',
          '--project-id',
          project.id,
          '--title',
          'Project todo',
          '--waiting',
          'Please review this.',
          '--json',
        ]),
      )
      expect(todo.status).toBe('pending')

      const listBeforeArchive = parseJson<Array<{ id: string; name: string }>>(
        runCli(sandbox, ['project', 'list', '--json']),
      )
      expect(listBeforeArchive.some((item) => item.id === project.id)).toBe(true)

      const overview = parseJson<{
        counts: { sessions: number; tasks: number; todos: number }
        waitingTodos: Array<{ id: string }>
      }>(runCli(sandbox, ['project', 'overview', project.id, '--json']))
      expect(overview.counts).toEqual({ sessions: 1, tasks: 1, todos: 1 })
      expect(overview.waitingTodos.map((item) => item.id)).toEqual([todo.id])

      const updated = parseJson<{ id: string; goal?: string }>(
        runCli(sandbox, ['project', 'update', project.id, '--goal', 'Updated goal', '--json']),
      )
      expect(updated.goal).toBe('Updated goal')

      const archived = parseJson<{ archived: boolean }>(
        runCli(sandbox, ['project', 'archive', project.id, '--json']),
      )
      expect(archived.archived).toBe(true)

      const listAfterArchive = parseJson<Array<{ id: string }>>(
        runCli(sandbox, ['project', 'list', '--json']),
      )
      expect(listAfterArchive.some((item) => item.id === project.id)).toBe(false)

      const deleted = parseJson<{ archived: boolean }>(
        runCli(sandbox, ['project', 'delete', project.id, '--confirm', '--json']),
      )
      expect(deleted.archived).toBe(true)

      const afterDelete = parseJson<{ id: string; archived?: boolean }>(
        runCli(sandbox, ['project', 'get', project.id, '--json']),
      )
      expect(afterDelete.archived).toBe(true)
    } finally {
      cleanupSandbox(sandbox)
    }
  })

  it('covers domain commands and project domain assignment', () => {
    const sandbox = createSandbox()
    try {
      const createdDomain = parseJson<{ id: string; name: string }>(
        runCli(sandbox, ['domain', 'create', '--name', '事业', '--description', 'Primary work', '--json']),
      )
      expect(createdDomain.name).toBe('事业')

      const project = parseJson<{ id: string; domainId?: string }>(
        runCli(sandbox, [
          'project',
          'open',
          '--work-dir',
          sandbox.workDir,
          '--name',
          'Alpha',
          '--domain-id',
          createdDomain.id,
          '--json',
        ]),
      )
      expect(project.domainId).toBe(createdDomain.id)

      const reopened = parseJson<{ id: string; domainId?: string }>(
        runCli(sandbox, ['project', 'open', '--work-dir', sandbox.workDir, '--name', 'Reloaded', '--json']),
      )
      expect(reopened.domainId).toBe(createdDomain.id)

      const defaults = parseJson<Array<{ name: string }>>(
        runCli(sandbox, ['domain', 'defaults', '--json']),
      )
      expect(defaults.some((domain) => domain.name === '财富')).toBe(true)
      expect(defaults.some((domain) => domain.name === '事业')).toBe(false)

      const updatedProject = parseJson<{ domainId?: string }>(
        runCli(sandbox, ['project', 'update', project.id, '--clear-domain', '--json']),
      )
      expect(updatedProject.domainId).toBeUndefined()

      const reassignedProject = parseJson<{ domainId?: string }>(
        runCli(sandbox, ['project', 'update', project.id, '--domain-id', createdDomain.id, '--json']),
      )
      expect(reassignedProject.domainId).toBe(createdDomain.id)

      const deleted = parseJson<{ deleted: boolean }>(
        runCli(sandbox, ['domain', 'delete', createdDomain.id, '--confirm', '--json']),
      )
      expect(deleted.deleted).toBe(true)

      const afterDelete = parseJson<{ domainId?: string }>(
        runCli(sandbox, ['project', 'get', project.id, '--json']),
      )
      expect(afterDelete.domainId).toBeUndefined()
    } finally {
      cleanupSandbox(sandbox)
    }
  })

  it('shows the full task quest CLI surface in help output', () => {
    const sandbox = createSandbox()
    try {
      const createHelp = runCli(sandbox, ['quest', 'create', '--help'])
      expect(createHelp.exitCode).toBe(0)
      expect(createHelp.stdout).toContain('--schedule-kind <kind>')
      expect(createHelp.stdout).toContain('--executor-kind <kind>')
      expect(createHelp.stdout).toContain('--prompt-file <path>')
      expect(createHelp.stdout).toContain('Example task quest:')
      expect(createHelp.stdout).toContain('*/30 * * * *')

      const updateHelp = runCli(sandbox, ['quest', 'update', '--help'])
      expect(updateHelp.exitCode).toBe(0)
      expect(updateHelp.stdout).toContain('--command <shell>')
      expect(updateHelp.stdout).toContain('--review-on-complete')
      expect(updateHelp.stdout).toContain('--timeout <seconds>')
    } finally {
      cleanupSandbox(sandbox)
    }
  })

  it('creates fully configured task quests from cli flags', () => {
    const sandbox = createSandbox()
    try {
      const project = createProjectRecord({
        name: 'Task Quest Project',
        workDir: sandbox.workDir,
        pinned: false,
      })
      const promptFile = join(sandbox.root, 'music-prompt.txt')
      const promptFromFile = 'Read the current song with the local NetEase CLI, then write a compact Chinese essay.'
      writeFileSync(promptFile, promptFromFile)

      const recurringPromptTask = parseJson<Quest>(
        runCli(sandbox, [
          'quest',
          'create',
          '--project-id',
          project.id,
          '--kind',
          'task',
          '--title',
          'Music Essay',
          '--description',
          'Every 30 minutes write about the current song.',
          '--tool',
          'codex',
          '--model',
          'gpt-5.3-codex',
          '--status',
          'pending',
          '--enable',
          '--schedule-kind',
          'recurring',
          '--cron',
          '*/30 * * * *',
          '--timezone',
          'Asia/Shanghai',
          '--executor-kind',
          'ai_prompt',
          '--prompt',
          'Use the local NetEase CLI in this project to read the current track, then write a short Chinese essay about the mood of the song.',
          '--continue-quest',
          '--var',
          'source=netease-cli',
          '--var',
          'tone=warm',
          '--review-on-complete',
          '--order',
          '3',
          '--effort',
          'high',
          '--thinking',
          '--json',
        ]),
      )
      expect(recurringPromptTask.kind).toBe('task')
      expect(recurringPromptTask.title).toBe('Music Essay')
      expect(recurringPromptTask.status).toBe('pending')
      expect(recurringPromptTask.enabled).toBe(true)
      expect(recurringPromptTask.scheduleKind).toBe('recurring')
      expect(recurringPromptTask.scheduleConfig?.cron).toBe('*/30 * * * *')
      expect(recurringPromptTask.scheduleConfig?.timezone).toBe('Asia/Shanghai')
      expect(recurringPromptTask.scheduleConfig?.nextRunAt).toBeTruthy()
      expect(recurringPromptTask.executorKind).toBe('ai_prompt')
      expect(recurringPromptTask.executorConfig).toEqual({
        prompt: 'Use the local NetEase CLI in this project to read the current track, then write a short Chinese essay about the mood of the song.',
      })
      expect(recurringPromptTask.executorOptions).toEqual({
        continueQuest: true,
        customVars: {
          source: 'netease-cli',
          tone: 'warm',
        },
      })
      expect(recurringPromptTask.reviewOnComplete).toBe(true)
      expect(recurringPromptTask.order).toBe(3)
      expect(recurringPromptTask.effort).toBe('high')
      expect(recurringPromptTask.thinking).toBe(true)

      const scheduledPromptTask = parseJson<Quest>(
        runCli(sandbox, [
          'quest',
          'create',
          '--project-id',
          project.id,
          '--kind',
          'task',
          '--title',
          'Music Essay From File',
          '--schedule-kind',
          'scheduled',
          '--run-at',
          '2099-01-02T03:04:05.000Z',
          '--timezone',
          'UTC',
          '--executor-kind',
          'ai_prompt',
          '--prompt-file',
          promptFile,
          '--fresh-context',
          '--var',
          'tone=quiet',
          '--no-review-on-complete',
          '--json',
        ]),
      )
      expect(scheduledPromptTask.enabled).toBe(true)
      expect(scheduledPromptTask.scheduleKind).toBe('scheduled')
      expect(scheduledPromptTask.scheduleConfig?.runAt).toBe('2099-01-02T03:04:05.000Z')
      expect(scheduledPromptTask.scheduleConfig?.timezone).toBe('UTC')
      expect(scheduledPromptTask.scheduleConfig?.nextRunAt).toBeTruthy()
      expect(scheduledPromptTask.executorKind).toBe('ai_prompt')
      expect(scheduledPromptTask.executorConfig).toEqual({ prompt: promptFromFile })
      expect(scheduledPromptTask.executorOptions).toEqual({
        continueQuest: false,
        customVars: {
          tone: 'quiet',
        },
      })
      expect(scheduledPromptTask.reviewOnComplete).toBe(false)

      const scriptTask = parseJson<Quest>(
        runCli(sandbox, [
          'quest',
          'create',
          '--project-id',
          project.id,
          '--kind',
          'task',
          '--title',
          'Script Task',
          '--schedule-kind',
          'once',
          '--executor-kind',
          'script',
          '--command',
          "printf 'hello\\n'",
          '--work-dir',
          sandbox.workDir,
          '--env',
          'TOKEN=abc',
          '--env',
          'MODE=test',
          '--timeout',
          '45',
          '--json',
        ]),
      )
      expect(scriptTask.scheduleKind).toBe('once')
      expect(scriptTask.scheduleConfig).toEqual({})
      expect(scriptTask.executorKind).toBe('script')
      expect(scriptTask.executorConfig).toEqual({
        command: "printf 'hello\\n'",
        workDir: sandbox.workDir,
        env: {
          TOKEN: 'abc',
          MODE: 'test',
        },
        timeout: 45,
      })

      const disabledRecurringTask = parseJson<Quest>(
        runCli(sandbox, [
          'quest',
          'create',
          '--project-id',
          project.id,
          '--kind',
          'task',
          '--title',
          'Disabled Recurring Task',
          '--disable',
          '--schedule-kind',
          'recurring',
          '--cron',
          '*/30 * * * *',
          '--timezone',
          'Asia/Shanghai',
          '--executor-kind',
          'ai_prompt',
          '--prompt',
          'Inspect the current music context but stay disabled until re-enabled.',
          '--json',
        ]),
      )
      expect(disabledRecurringTask.enabled).toBe(false)
      expect(disabledRecurringTask.scheduleKind).toBe('recurring')
      expect(disabledRecurringTask.scheduleConfig?.cron).toBe('*/30 * * * *')
      expect(disabledRecurringTask.scheduleConfig?.nextRunAt).toBeUndefined()
    } finally {
      cleanupSandbox(sandbox)
    }
  })

  it('updates task quests with schedule and executor flags', () => {
    const sandbox = createSandbox()
    try {
      const project = createProjectRecord({
        name: 'Task Update Project',
        workDir: sandbox.workDir,
        pinned: false,
      })
      const task = createQuest({
        projectId: project.id,
        kind: 'task',
        title: 'Patch Me',
        status: 'pending',
        enabled: true,
        scheduleKind: 'once',
        scheduleConfig: {},
        executorKind: 'ai_prompt',
        executorConfig: { prompt: 'Initial prompt' },
        executorOptions: { continueQuest: true, customVars: { tone: 'warm' } },
        reviewOnComplete: false,
        order: 1,
        tool: 'codex',
        model: 'gpt-5.3-codex',
        effort: 'high',
        thinking: true,
      })

      const updated = parseJson<Quest>(
        runCli(sandbox, [
          'quest',
          'update',
          task.id,
          '--status',
          'done',
          '--schedule-kind',
          'scheduled',
          '--run-at',
          '2099-01-03T00:00:00.000Z',
          '--timezone',
          'UTC',
          '--executor-kind',
          'script',
          '--command',
          "printf 'updated\\n'",
          '--work-dir',
          sandbox.workDir,
          '--env',
          'API_KEY=secret',
          '--timeout',
          '60',
          '--review-on-complete',
          '--order',
          '9',
          '--effort',
          'low',
          '--no-thinking',
          '--json',
        ]),
      )
      expect(updated.status).toBe('done')
      expect(updated.enabled).toBe(true)
      expect(updated.scheduleKind).toBe('scheduled')
      expect(updated.scheduleConfig?.runAt).toBe('2099-01-03T00:00:00.000Z')
      expect(updated.scheduleConfig?.timezone).toBe('UTC')
      expect(updated.scheduleConfig?.nextRunAt).toBeTruthy()
      expect(updated.executorKind).toBe('script')
      expect(updated.executorConfig).toEqual({
        command: "printf 'updated\\n'",
        workDir: sandbox.workDir,
        env: {
          API_KEY: 'secret',
        },
        timeout: 60,
      })
      expect(updated.reviewOnComplete).toBe(true)
      expect(updated.order).toBe(9)
      expect(updated.effort).toBe('low')
      expect(updated.thinking).toBe(false)
    } finally {
      cleanupSandbox(sandbox)
    }
  })

  it('rejects invalid task quest cli flag combinations', () => {
    const sandbox = createSandbox()
    try {
      const project = createProjectRecord({
        name: 'Invalid Task Flags',
        workDir: sandbox.workDir,
        pinned: false,
      })
      const promptFile = join(sandbox.root, 'invalid-prompt.txt')
      writeFileSync(promptFile, 'Read the current song and summarize it.')

      expectFailure(
        runCli(sandbox, [
          'quest',
          'create',
          '--project-id',
          project.id,
          '--kind',
          'session',
          '--schedule-kind',
          'recurring',
          '--cron',
          '*/30 * * * *',
        ]),
        'Task-only quest flags require --kind task',
      )

      expectFailure(
        runCli(sandbox, [
          'quest',
          'create',
          '--project-id',
          project.id,
          '--kind',
          'task',
          '--executor-kind',
          'ai_prompt',
          '--prompt',
          'hello',
          '--prompt-file',
          promptFile,
        ]),
        'Use either --prompt or --prompt-file, not both',
      )

      expectFailure(
        runCli(sandbox, [
          'quest',
          'create',
          '--project-id',
          project.id,
          '--kind',
          'task',
          '--schedule-kind',
          'recurring',
        ]),
        'Recurring tasks require --cron',
      )

      expectFailure(
        runCli(sandbox, [
          'quest',
          'create',
          '--project-id',
          project.id,
          '--kind',
          'task',
          '--schedule-kind',
          'scheduled',
        ]),
        'Scheduled tasks require --run-at',
      )

      expectFailure(
        runCli(sandbox, [
          'quest',
          'create',
          '--project-id',
          project.id,
          '--kind',
          'task',
          '--executor-kind',
          'ai_prompt',
          '--prompt',
          'hello',
          '--continue-quest',
          '--fresh-context',
        ]),
        'Use either --continue-quest or --fresh-context, not both',
      )

      const sessionQuest = createQuest({
        projectId: project.id,
        kind: 'session',
        name: 'No Task Flags',
      })
      expectFailure(
        runCli(sandbox, [
          'quest',
          'update',
          sessionQuest.id,
          '--schedule-kind',
          'recurring',
          '--cron',
          '*/30 * * * *',
        ]),
        'Task-only quest flags require the resulting quest kind to be task',
      )
    } finally {
      cleanupSandbox(sandbox)
    }
  })

  it('covers quest and run commands', () => {
    const sandbox = createSandbox()
    try {
      const project = createProjectRecord({
        name: 'Runtime Project',
        workDir: sandbox.workDir,
        pinned: false,
      })
      const targetProject = createProjectRecord({
        name: 'Runtime Target',
        workDir: join(sandbox.root, 'work-target'),
        pinned: false,
      })

      const sessionCli = parseJson<{ id: string; kind: string; name?: string }>(
        runCli(sandbox, [
          'quest',
          'create',
          '--project-id',
          project.id,
          '--kind',
          'session',
          '--name',
          'CLI Quest',
          '--json',
        ]),
      )
      expect(sessionCli.kind).toBe('session')

      const messageQuest = createQuest({
        projectId: project.id,
        kind: 'session',
        name: 'Message Quest',
        autoRenamePending: false,
      })

      const taskQuest = createQuest({
        projectId: project.id,
        kind: 'task',
        title: 'Script Task',
        executorKind: 'script',
        executorConfig: { command: "printf 'alpha\\nbeta\\n'" },
        scheduleKind: 'recurring',
        scheduleConfig: {
          cron: '0 * * * *',
          timezone: 'UTC',
        },
      })

      const questList = parseJson<Array<{ id: string; kind: string }>>(
        runCli(sandbox, ['quest', 'list', '--project-id', project.id, '--json']),
      )
      expect(questList.map((item) => item.id)).toEqual(expect.arrayContaining([sessionCli.id, messageQuest.id, taskQuest.id]))

      const questGet = parseJson<{ id: string; name?: string }>(
        runCli(sandbox, ['quest', 'get', sessionCli.id, '--json']),
      )
      expect(questGet.id).toBe(sessionCli.id)

      const questUpdated = parseJson<{ id: string; name?: string; pinned?: boolean }>(
        runCli(sandbox, ['quest', 'update', sessionCli.id, '--name', 'Renamed CLI Quest', '--pin', '--json']),
      )
      expect(questUpdated.name).toBe('Renamed CLI Quest')
      expect(questUpdated.pinned).toBe(true)

      const messageResult = parseJson<{
        queued: boolean
        run: { id: string; state: string } | null
        quest: { id: string } | null
      }>(
        runCli(
          sandbox,
          ['quest', 'message', messageQuest.id, '--text', 'Hello from CLI', '--json'],
          {
            PLUSE_FAKE_CODEX_REPLY: 'Message reply',
          },
        ),
      )
      expect(messageResult.queued).toBe(false)
      expect(messageResult.run?.id).toMatch(/^run_/)

      const messageRun = parseJson<{ id: string; state: string; tool: string }>(
        runCli(sandbox, ['run', 'get', messageResult.run!.id, '--json']),
      )
      expect(messageRun.state).toBe('completed')

      const questRunResult = parseJson<{
        skipped: boolean
        run: { id: string; state: string } | null
        quest: { id: string } | null
      }>(runCli(sandbox, ['quest', 'run', taskQuest.id, '--json']))
      expect(questRunResult.skipped).toBe(false)
      expect(questRunResult.run?.id).toMatch(/^run_/)

      const taskRun = parseJson<{ id: string; state: string; questId: string }>(
        runCli(sandbox, ['run', 'get', questRunResult.run!.id, '--json']),
      )
      expect(taskRun.state).toBe('completed')
      expect(taskRun.questId).toBe(taskQuest.id)

      const taskRuns = parseJson<Array<{ id: string; state: string }>>(
        runCli(sandbox, ['run', 'list', taskQuest.id, '--json']),
      )
      expect(taskRuns.map((run) => run.id)).toContain(questRunResult.run!.id)

      const spool = parseJson<Array<{ line: string }>>(
        runCli(sandbox, ['run', 'spool', questRunResult.run!.id, '--json']),
      )
      expect(spool.map((entry) => entry.line)).toEqual(['alpha', 'beta'])

      const taskDisabled = parseJson<{ id: string; enabled?: boolean }>(
        runCli(sandbox, ['quest', 'update', taskQuest.id, '--disable', '--json']),
      )
      expect(taskDisabled.enabled).toBe(false)

      const taskEnabled = parseJson<{ id: string; enabled?: boolean }>(
        runCli(sandbox, ['quest', 'update', taskQuest.id, '--enable', '--json']),
      )
      expect(taskEnabled.enabled).toBe(true)

      const movedQuest = parseJson<{ id: string; projectId: string }>(
        runCli(sandbox, ['quest', 'move', taskQuest.id, '--to-project-id', targetProject.id, '--json']),
      )
      expect(movedQuest.projectId).toBe(targetProject.id)

      const sourceQuestListAfterMove = parseJson<Array<{ id: string }>>(
        runCli(sandbox, ['quest', 'list', '--project-id', project.id, '--json']),
      )
      expect(sourceQuestListAfterMove.some((item) => item.id === taskQuest.id)).toBe(false)

      const targetQuestListAfterMove = parseJson<Array<{ id: string }>>(
        runCli(sandbox, ['quest', 'list', '--project-id', targetProject.id, '--json']),
      )
      expect(targetQuestListAfterMove.some((item) => item.id === taskQuest.id)).toBe(true)

      const cancelQuest = createQuest({
        projectId: project.id,
        kind: 'task',
        title: 'Cancelable Task',
      })
      const cancelRun = createRun({
        questId: cancelQuest.id,
        projectId: project.id,
        requestId: 'req-cancel',
        trigger: 'manual',
        triggeredBy: 'cli',
        tool: 'codex',
        model: 'gpt-5.3-codex',
        effort: 'low',
        thinking: false,
      })

      const canceled = parseJson<{ id: string; cancelRequested?: boolean }>(
        runCli(sandbox, ['run', 'cancel', cancelRun.id, '--json']),
      )
      expect(canceled.cancelRequested).toBe(true)

      const canceledRun = parseJson<{ id: string; cancelRequested?: boolean }>(
        runCli(sandbox, ['run', 'get', cancelRun.id, '--json']),
      )
      expect(canceledRun.cancelRequested).toBe(true)

      const deleted = runCli(sandbox, ['quest', 'delete', sessionCli.id, '--confirm'])
      expect(deleted.exitCode).toBe(0)
      expect(deleted.stdout).toContain(`Quest ${sessionCli.id} archived.`)

      const afterDelete = parseJson<{ id: string; deleted?: boolean }>(
        runCli(sandbox, ['quest', 'get', sessionCli.id, '--json']),
      )
      expect(afterDelete.deleted).toBe(true)
    } finally {
      cleanupSandbox(sandbox)
    }
  })

  it('covers todo commands', () => {
    const sandbox = createSandbox()
    try {
      const project = createProjectRecord({
        name: 'Todo Project',
        workDir: sandbox.workDir,
        pinned: false,
      })

      const todo = parseJson<{ id: string; title: string; status: string; dueAt?: string; repeat?: string }>(
        runCli(sandbox, [
          'todo',
          'create',
          '--project-id',
          project.id,
          '--title',
          'CLI Todo',
          '--description',
          'Initial description',
          '--waiting',
          'Please review this.',
          '--due-at',
          '2026-04-20T02:00:00.000Z',
          '--repeat',
          'daily',
          '--json',
        ]),
      )
      expect(todo.status).toBe('pending')
      expect(todo.dueAt).toBe('2026-04-20T02:00:00.000Z')
      expect(todo.repeat).toBe('daily')

      const todos = parseJson<Array<{ id: string; title: string; status: string }>>(
        runCli(sandbox, ['todo', 'list', '--project-id', project.id, '--status', 'pending', '--json']),
      )
      expect(todos.map((item) => item.id)).toContain(todo.id)

      const fetched = parseJson<{ id: string; title: string; description?: string }>(
        runCli(sandbox, ['todo', 'get', todo.id, '--json']),
      )
      expect(fetched.title).toBe('CLI Todo')

      const updated = parseJson<{ id: string; description?: string; waitingInstructions?: string }>(
        runCli(sandbox, ['todo', 'update', todo.id, '--description', 'Updated description', '--waiting', 'Need approval', '--json']),
      )
      expect(updated.description).toBe('Updated description')
      expect(updated.waitingInstructions).toBe('Need approval')

      const done = parseJson<{ id: string; status: string }>(
        runCli(sandbox, ['todo', 'done', todo.id, '--json']),
      )
      expect(done.status).toBe('done')

      const doneTodos = parseJson<Array<{ id: string; status: string }>>(
        runCli(sandbox, ['todo', 'list', '--project-id', project.id, '--status', 'done', '--json']),
      )
      expect(doneTodos.map((item) => item.id)).toContain(todo.id)

      const pendingTodosAfterDone = parseJson<Array<{ id: string; status: string; repeat: string; dueAt?: string }>>(
        runCli(sandbox, ['todo', 'list', '--project-id', project.id, '--status', 'pending', '--json']),
      )
      expect(pendingTodosAfterDone.some((item) => item.id !== todo.id && item.repeat === 'daily' && item.dueAt === '2026-04-21T02:00:00.000Z')).toBe(true)

      const deleted = runCli(sandbox, ['todo', 'delete', todo.id, '--confirm'])
      expect(deleted.exitCode).toBe(0)
      expect(deleted.stdout).toContain(`Todo ${todo.id} archived.`)

      const deletedTodo = parseJson<{ id: string; deleted?: boolean }>(
        runCli(sandbox, ['todo', 'get', todo.id, '--json']),
      )
      expect(deletedTodo.deleted).toBe(true)
    } finally {
      cleanupSandbox(sandbox)
    }
  })
})

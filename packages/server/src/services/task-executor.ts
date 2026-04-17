import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import { resolve } from 'node:path'
import type { AiPromptExecutor, ScriptExecutor, Task } from '@pluse/types'
import { getProject } from '../models/project'
import { createSession } from '../models/session'
import { updateTask } from '../models/task'
import { appendSpoolLine, completeTaskRun, createTaskRun } from '../models/task-run'
import { buildTaskSystemPrompt } from './system-prompt'
import { emit } from './events'

const runningProcs = new Map<string, ChildProcess>()

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? `{${key}}`)
}

function buildVars(task: Task): Record<string, string> {
  const project = getProject(task.projectId)
  return {
    date: new Date().toISOString().slice(0, 10),
    datetime: new Date().toISOString(),
    taskTitle: task.title,
    taskDescription: task.description ?? '',
    projectId: task.projectId,
    projectName: project?.name ?? '',
    projectGoal: project?.goal ?? '',
    workDir: project?.workDir ?? '',
    completionOutput: task.completionOutput ?? '',
    lastOutput: task.completionOutput ?? '',
    ...(task.executorOptions?.customVars ?? {}),
  }
}

function ensureTaskSession(task: Task): string {
  // 懒加载：Task 第一次执行时按需创建 Session
  if (task.sessionId) return task.sessionId
  const project = getProject(task.projectId)
  const session = createSession({
    projectId: task.projectId,
    name: task.title,
    createdBy: 'system',
    sourceTaskId: task.id,
    tool: (task.executor as AiPromptExecutor)?.agent ?? 'codex',
  })
  updateTask(task.id, { sessionId: session.id })
  return session.id
}

function buildSystemPrompt(task: Task): string | null {
  const project = getProject(task.projectId)
  if (!project) return null
  const sessionId = task.sessionId ?? `(pending for task ${task.id})`
  return buildTaskSystemPrompt(project, task.id, task.title, sessionId)
}

function resolveCwd(task: Task, override?: string): string {
  const project = getProject(task.projectId)
  return resolve(override || project?.workDir || process.cwd())
}

export interface ExecutionResult {
  success: boolean
  output: string
  error?: string
  sessionId?: string
}

export function killTask(taskId: string): boolean {
  const proc = runningProcs.get(taskId)
  if (!proc) return false
  proc.kill('SIGTERM')
  setTimeout(() => {
    if (runningProcs.has(taskId)) proc.kill('SIGKILL')
  }, 5_000)
  return true
}

async function executeScript(task: Task): Promise<ExecutionResult> {
  const executor = task.executor as ScriptExecutor
  const cwd = resolveCwd(task, executor.workDir)
  const timeout = (executor.timeout ?? 300) * 1000

  return new Promise((resolveResult) => {
    const proc = spawn('sh', ['-c', executor.command], {
      cwd,
      env: { ...process.env, ...(executor.env ?? {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    runningProcs.set(task.id, proc)
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    proc.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
    proc.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))

    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      proc.kill('SIGTERM')
      setTimeout(() => proc.kill('SIGKILL'), 15_000)
    }, timeout)

    proc.on('close', (code) => {
      clearTimeout(timer)
      runningProcs.delete(task.id)
      const output = [...stdout, ...stderr].map((item) => item.toString()).join('')
      if (timedOut) {
        resolveResult({ success: false, output, error: 'execution timeout' })
      } else if (code === 0) {
        resolveResult({ success: true, output })
      } else {
        resolveResult({ success: false, output, error: `exited with code ${code}` })
      }
    })

    proc.on('error', (err) => {
      clearTimeout(timer)
      runningProcs.delete(task.id)
      resolveResult({ success: false, output: '', error: err.message })
    })
  })
}

function buildClaudeArgs(task: Task, userPrompt: string, systemAppend: string | null): string[] {
  const executor = task.executor as AiPromptExecutor
  const args: string[] = ['-p', userPrompt, '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions']
  if (executor.model) args.push('--model', executor.model)
  if (systemAppend) args.push('--system-prompt', systemAppend)
  if (task.executorOptions?.continueSession && task.lastSessionId) {
    args.push('--resume', task.lastSessionId)
  }
  return args
}

function buildCodexArgs(task: Task, userPrompt: string, systemAppend: string | null): string[] {
  const executor = task.executor as AiPromptExecutor
  const fullPrompt = systemAppend?.trim()
    ? `Project instructions:\n${systemAppend.trim()}\n\n${userPrompt}`
    : userPrompt

  if (task.executorOptions?.continueSession && task.lastSessionId) {
    const args = ['exec', 'resume', task.lastSessionId, fullPrompt, '--json', '--full-auto']
    if (executor.model) args.push('--model', executor.model)
    return args
  }

  const args = ['exec', fullPrompt, '--json', '--full-auto']
  if (executor.model) args.push('--model', executor.model)
  return args
}

function extractClaudeSessionId(line: string): string | undefined {
  try {
    const obj = JSON.parse(line)
    if (obj.type === 'system' && obj.session_id) return obj.session_id as string
  } catch {}
}

function extractCodexSessionId(line: string): string | undefined {
  try {
    const obj = JSON.parse(line)
    if (obj.session_id) return obj.session_id as string
    if (obj.thread_id) return obj.thread_id as string
  } catch {}
}

async function executeAiPrompt(task: Task, triggeredBy: 'manual' | 'scheduler' | 'api' | 'cli'): Promise<ExecutionResult> {
  const executor = task.executor as AiPromptExecutor
  const agent = executor.agent ?? 'codex'

  // 懒加载 Session：continueSession=false 时每次新建，否则复用或首次创建
  if (!task.executorOptions?.continueSession) {
    task = { ...task, sessionId: undefined }
  }
  const sessionId = ensureTaskSession(task)
  task = { ...task, sessionId }

  const cwd = resolveCwd(task)
  const userPrompt = interpolate(executor.prompt, buildVars(task))
  const systemAppend = buildSystemPrompt(task)
  const bin = agent === 'claude'
    ? (process.env['PLUSE_CLAUDE_COMMAND']?.trim() || process.env['PULSE_CLAUDE_COMMAND']?.trim() || 'claude')
    : (process.env['PLUSE_CODEX_COMMAND']?.trim() || process.env['PULSE_CODEX_COMMAND']?.trim() || 'codex')
  const args = agent === 'claude' ? buildClaudeArgs(task, userPrompt, systemAppend) : buildCodexArgs(task, userPrompt, systemAppend)
  const run = createTaskRun(task.id, task.projectId, triggeredBy, task.sessionId)

  return new Promise((resolveResult) => {
    const proc = spawn(bin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    runningProcs.set(task.id, proc)

    let lastAssistantText = ''
    let sessionId: string | undefined
    let timedOut = false
    const stderrLines: string[] = []

    const rl = createInterface({ input: proc.stdout })
    rl.on('line', (line) => {
      appendSpoolLine(run.id, line)
      emit({ type: 'run_line', data: { taskId: task.id, projectId: task.projectId, runId: run.id, line, ts: new Date().toISOString() } })

      if (!sessionId) {
        sessionId = agent === 'claude' ? extractClaudeSessionId(line) : extractCodexSessionId(line)
      }

      try {
        const obj = JSON.parse(line)
        if (agent === 'claude' && obj.type === 'assistant') {
          const content = obj.message?.content
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === 'text') lastAssistantText = block.text
            }
          }
        } else if (agent === 'codex') {
          if (obj.type === 'message' && obj.role === 'assistant' && typeof obj.content === 'string') {
            lastAssistantText = obj.content
          }
          if (obj.type === 'item.completed' && obj.item?.type === 'agent_message' && typeof obj.item.text === 'string') {
            lastAssistantText = obj.item.text
          }
        }
      } catch {}
    })

    proc.stderr.on('data', (chunk: Buffer) => stderrLines.push(chunk.toString()))

    const timer = setTimeout(() => {
      timedOut = true
      proc.kill('SIGTERM')
      setTimeout(() => proc.kill('SIGKILL'), 15_000)
    }, 300_000)

    proc.on('close', (code) => {
      clearTimeout(timer)
      runningProcs.delete(task.id)
      const stderr = stderrLines.join('')

      if (timedOut) {
        completeTaskRun(run.id, 'failed', 'execution timeout', sessionId)
        resolveResult({ success: false, output: lastAssistantText, error: 'execution timeout', sessionId })
      } else if (code === 0) {
        completeTaskRun(run.id, 'done', undefined, sessionId)
        resolveResult({ success: true, output: lastAssistantText, sessionId })
      } else {
        const err = stderr || `exited with code ${code}`
        completeTaskRun(run.id, 'failed', err, sessionId)
        resolveResult({ success: false, output: lastAssistantText, error: err, sessionId })
      }
    })

    proc.on('error', (err) => {
      clearTimeout(timer)
      runningProcs.delete(task.id)
      completeTaskRun(run.id, 'failed', err.message)
      resolveResult({ success: false, output: '', error: err.message })
    })
  })
}

export async function executeTask(task: Task, triggeredBy: 'manual' | 'scheduler' | 'api' | 'cli'): Promise<ExecutionResult> {
  if (!task.executor) {
    return { success: false, output: '', error: 'task executor is missing' }
  }

  if (task.executor.kind === 'script') {
    return executeScript(task)
  }
  return executeAiPrompt(task, triggeredBy)
}

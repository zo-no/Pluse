import { randomBytes } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { copyFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type {
  MessageAttachment,
  Quest,
  QuestEvent,
  Run,
  RunTrigger,
  RunTriggeredBy,
} from '@pluse/types'
import { appendEvent, listEvents } from '../models/history'
import { createProjectActivity } from '../models/project-activity'
import { createQuestOp } from '../models/quest-op'
import {
  clearFollowUps,
  dequeueFollowUp,
  enqueueFollowUp,
  getQuest,
  listQuestsPendingAutoRename,
  listQuestsWithPendingQueue,
  removeFollowUp,
  updateQuest,
} from '../models/quest'
import { getProject } from '../models/project'
import {
  appendRunSpoolLine,
  cancelRun,
  createRun,
  getLatestRunForQuest,
  getRun,
  getRunByQuestRequestId,
  getRunsByQuest,
  updateRun,
} from '../models/run'
import { emit } from '../services/events'
import { buildSessionSystemPrompt, buildTaskSystemPrompt } from '../services/system-prompt'
import { ensureReviewTodoWithEffects } from '../services/todos'
import { runHooks } from '../services/hooks'
import { getManagedCodexHome } from '../support/paths'
import { getRuntimeModelCatalog, normalizeClaudeModelId, normalizeCodexModelId } from './catalog'

type ToolName = 'codex' | 'claude'
type ProviderEvent = Omit<QuestEvent, 'seq'>

type ActiveRunner = {
  child: ChildProcess
  reason?: 'cancelled' | 'timeout'
  timeoutId?: Timer
  killGraceId?: Timer
}

type RuntimePreferences = {
  tool: ToolName
  model: string
  effort: string | null
  thinking: boolean
}

type TokenUsage = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  costUsd?: number
}

type ProviderParseResult = {
  events: ProviderEvent[]
  assistantText?: string
  claudeSessionId?: string
  codexThreadId?: string
  providerError?: string
  tokenUsage?: TokenUsage
}

type AutoRenameSnapshot = {
  fallbackSource: string
  transcript: string
}

export interface SubmitQuestMessageInput {
  questId: string
  text: string
  requestId?: string
  tool?: string
  model?: string | null
  effort?: string | null
  thinking?: boolean
  attachments?: MessageAttachment[]
}

export interface SubmitQuestMessageResult {
  queued: boolean
  run: Run | null
  quest: Quest | null
}

export interface StartQuestRunInput {
  questId: string
  requestId?: string
  trigger: RunTrigger
  triggeredBy: RunTriggeredBy
}

export interface StartQuestRunResult {
  skipped: boolean
  run: Run | null
  quest: Quest | null
}

const RUN_TIMEOUT_MS = parsePositiveInt(process.env['PLUSE_RUN_TIMEOUT_MS'] ?? process.env['PULSE_RUN_TIMEOUT_MS'], 300_000)
const RUN_KILL_GRACE_MS = parsePositiveInt(process.env['PLUSE_RUN_KILL_GRACE_MS'] ?? process.env['PULSE_RUN_KILL_GRACE_MS'], 15_000)
const AUTO_RENAME_TIMEOUT_MS = parsePositiveInt(process.env['PLUSE_AUTO_RENAME_TIMEOUT_MS'] ?? process.env['PULSE_AUTO_RENAME_TIMEOUT_MS'], 30_000)
const activeRunners = new Map<string, ActiveRunner>()
const CODEX_AUTH_FILENAME = 'auth.json'
const AUTO_RENAME_SYSTEM_PROMPT = [
  'You generate short titles for Pluse session quests.',
  'Return only the title text.',
  'Use the conversation language when it is clear.',
  'Be concrete and specific, not generic.',
  'For Chinese titles, prefer 4 to 8 characters.',
  'For non-Chinese titles, prefer 2 to 6 words.',
  'Do not use quotes, prefixes, markdown, or trailing punctuation unless necessary.',
].join('\n')

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function nowIso(): string {
  return new Date().toISOString()
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'unknown runtime error'
}

function isInFlightRunState(state: Run['state']): boolean {
  return state === 'accepted' || state === 'running'
}

function isQuestBusyForChat(quest: Quest): boolean {
  if (quest.activeRunId) {
    const activeRun = getRun(quest.activeRunId)
    if (activeRun && isInFlightRunState(activeRun.state)) return true
  }

  const latestRun = getLatestRunForQuest(quest.id)
  return Boolean(latestRun && isInFlightRunState(latestRun.state))
}

function genRequestId(): string {
  return 'req_' + randomBytes(8).toString('hex')
}

function makeEvent(event: Omit<ProviderEvent, 'timestamp'>): ProviderEvent {
  return { timestamp: Date.now(), ...event }
}

function makeStatusEvent(content: string): ProviderEvent {
  return makeEvent({ type: 'status', content })
}

function makeMessageEvent(role: 'user' | 'assistant', content: string): ProviderEvent {
  return makeEvent({ type: 'message', role, content })
}

function makeReasoningEvent(content: string): ProviderEvent {
  return makeEvent({ type: 'reasoning', role: 'assistant', content })
}

function makeToolUseEvent(toolInput: string): ProviderEvent {
  return makeEvent({ type: 'tool_use', role: 'assistant', toolInput })
}

function makeToolResultEvent(output: string): ProviderEvent {
  return makeEvent({ type: 'tool_result', output })
}

function makeUsageEvent(parts: Array<string | null | undefined>): ProviderEvent {
  return makeEvent({ type: 'usage', content: parts.filter(Boolean).join(' · ') })
}

function safeJsonParse(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

function normalizeProviderError(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const line = value
      .split('\n')
      .map((part) => part.trim())
      .find((part) => part && !part.startsWith('at '))
    return line?.replace(/^Error:\s*/, '')
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return normalizeProviderError(record.error ?? record.message)
  }
  return undefined
}

function normalizeText(value: unknown): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return value
    .map((entry) => {
      if (typeof entry === 'string') return entry
      if (entry && typeof entry === 'object' && 'text' in entry && typeof entry.text === 'string') {
        return entry.text
      }
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

function summarizeStderr(lines: string[]): string {
  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
    .trim()
}

function resolveFailureReason(
  code: number | null,
  signal: NodeJS.Signals | null,
  providerError: string | undefined,
  stderrLines: string[],
): string | undefined {
  if (providerError) return providerError
  if (code === 0 && !signal) return undefined
  const stderr = summarizeStderr(stderrLines)
  return stderr || `exited with code ${code ?? 'null'}${signal ? ` (${signal})` : ''}`
}

function labelForMime(mimeType: string): string {
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/')) return 'video'
  return 'file'
}

function buildRecordedUserText(input: SubmitQuestMessageInput): string {
  const attachments = (input.attachments ?? []).map((asset) => `[User attached ${labelForMime(asset.mimeType)}: ${asset.filename}]`)
  return [attachments.join('\n'), input.text.trim()].filter(Boolean).join('\n\n')
}

function buildAttachmentPrompt(input: SubmitQuestMessageInput): string {
  const attachments = (input.attachments ?? []).map((asset) => `[User attached ${labelForMime(asset.mimeType)}: ${asset.filename} -> ${asset.savedPath}]`)
  return [attachments.join('\n'), input.text.trim()].filter(Boolean).join('\n\n')
}

function resolveTool(tool?: string | null): ToolName {
  return tool?.trim().toLowerCase() === 'claude' ? 'claude' : 'codex'
}

function resolveModel(tool: ToolName, requested?: string | null): string {
  const next = requested?.trim()
  if (next) return tool === 'codex' ? normalizeCodexModelId(next) : normalizeClaudeModelId(next)
  return getRuntimeModelCatalog(tool).defaultModel ?? (tool === 'claude' ? 'sonnet[1m]' : 'gpt-5.3-codex-spark')
}

function resolveToolCommand(tool: ToolName): string {
  if (tool === 'claude') {
    return process.env['PLUSE_CLAUDE_COMMAND']?.trim() || process.env['PULSE_CLAUDE_COMMAND']?.trim() || 'claude'
  }
  return process.env['PLUSE_CODEX_COMMAND']?.trim() || process.env['PULSE_CODEX_COMMAND']?.trim() || 'codex'
}

function syncManagedCodexAuth(): string {
  const managedHome = getManagedCodexHome()
  const sourceHome = process.env['CODEX_HOME']?.trim() || join(homedir(), '.codex')
  const sourceAuthPath = join(sourceHome, CODEX_AUTH_FILENAME)
  const targetAuthPath = join(managedHome, CODEX_AUTH_FILENAME)

  if (!existsSync(sourceAuthPath)) return managedHome

  try {
    const sourceAuth = readFileSync(sourceAuthPath, 'utf8')
    const targetAuth = existsSync(targetAuthPath) ? readFileSync(targetAuthPath, 'utf8') : null
    if (sourceAuth !== targetAuth) writeFileSync(targetAuthPath, sourceAuth, 'utf8')
  } catch {
    try {
      copyFileSync(sourceAuthPath, targetAuthPath)
    } catch {
      // Ignore sync failures and let Codex surface its own auth error.
    }
  }

  return managedHome
}

function runtimeEnvForTool(tool: ToolName): NodeJS.ProcessEnv {
  if (tool !== 'codex') return process.env
  return {
    ...process.env,
    CODEX_HOME: syncManagedCodexAuth(),
  }
}

function validateProjectWorkingDirectory(projectPath: string): string | null {
  try {
    const stats = statSync(projectPath)
    return stats.isDirectory() ? null : `project path is not a directory: ${projectPath}`
  } catch {
    return `project path does not exist: ${projectPath}`
  }
}

function buildHistoryPrompt(questId: string, latestText: string): string {
  const conversation = listEvents(questId)
    .filter((event) => event.type === 'message' && (event.role === 'user' || event.role === 'assistant'))
    .slice(-40)
    .map((event) => `${event.role === 'assistant' ? 'Assistant' : 'User'}:\n${event.content ?? ''}`)
    .join('\n\n')
  if (!conversation.trim()) return latestText
  return [
    'You are continuing an existing Pluse quest.',
    'Use the previous quest messages as context and respond to the latest input only.',
    conversation,
    latestText,
  ].join('\n\n')
}

function buildTaskPrompt(quest: Quest): string {
  if (quest.executorKind !== 'ai_prompt') {
    throw new Error('Quest executor is not ai_prompt')
  }
  const config = quest.executorConfig
  if (!config || !('prompt' in config) || !config.prompt?.trim()) {
    throw new Error('Quest ai prompt is missing')
  }

  const project = getProject(quest.projectId)
  const vars: Record<string, string> = {
    date: new Date().toISOString().slice(0, 10),
    datetime: nowIso(),
    questId: quest.id,
    questTitle: quest.title ?? quest.name ?? '',
    questDescription: quest.description ?? '',
    projectId: quest.projectId,
    projectName: project?.name ?? '',
    projectGoal: project?.goal ?? '',
    workDir: project?.workDir ?? '',
    completionOutput: quest.completionOutput ?? '',
    ...(quest.executorOptions?.customVars ?? {}),
  }

  return config.prompt.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? `{${key}}`)
}

function buildScriptCommand(quest: Quest): { command: string; timeoutMs: number; env: Record<string, string>; cwd: string } {
  if (quest.executorKind !== 'script') throw new Error('Quest executor is not script')
  const config = quest.executorConfig
  if (!config || !('command' in config) || !config.command?.trim()) {
    throw new Error('Quest script command is missing')
  }
  const project = getProject(quest.projectId)
  return {
    command: config.command,
    timeoutMs: ((config.timeout ?? quest.executorOptions?.timeout ?? 300) * 1000),
    env: config.env ?? {},
    cwd: config.workDir ?? project?.workDir ?? process.cwd(),
  }
}

function validateTaskRunConfig(quest: Quest): string | null {
  if (quest.executorKind === 'script') {
    const config = quest.executorConfig
    if (!config || !('command' in config) || !config.command?.trim()) {
      return 'Quest script command is missing'
    }
    return null
  }

  if (quest.executorKind === 'ai_prompt') {
    const config = quest.executorConfig
    if (!config || !('prompt' in config) || !config.prompt?.trim()) {
      return 'Quest ai prompt is missing'
    }
    return null
  }

  return 'Quest executor is not configured'
}

function questRuntimePreferences(quest: Quest, overrides?: Partial<RuntimePreferences>): RuntimePreferences {
  const tool = overrides?.tool ?? resolveTool(quest.tool)
  return {
    tool,
    model: overrides?.model ?? resolveModel(tool, quest.model),
    effort: overrides?.effort ?? quest.effort ?? (tool === 'codex' ? 'low' : null),
    thinking: overrides?.thinking ?? (tool === 'claude' ? quest.thinking === true : false),
  }
}

function systemPromptForQuest(quest: Quest): string | undefined {
  const project = getProject(quest.projectId)
  if (!project) return undefined
  return quest.kind === 'task'
    ? buildTaskSystemPrompt(project, quest)
    : buildSessionSystemPrompt(project, quest)
}

function shouldContinueQuestContext(quest: Quest): boolean {
  return quest.kind === 'session' || quest.executorOptions?.continueQuest !== false
}

function shouldPersistQuestProviderIds(quest: Quest): boolean {
  return quest.kind === 'session' || quest.executorOptions?.continueQuest !== false
}

function shouldRetryResumeFailure(failureReason: string | undefined, sawProviderOutput: boolean): boolean {
  if (!failureReason || sawProviderOutput) return false
  return /resume|thread|session|conversation|context|expired|not found|invalid/i.test(failureReason)
}

function fallbackQuestName(source: string): string {
  const compact = source
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return compact.length > 48 ? `${compact.slice(0, 45).trim()}...` : compact
}

function normalizeGeneratedQuestName(value: string): string {
  const singleLine = value
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean) ?? ''
  const normalized = singleLine
    .replace(/^title:\s*/i, '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return fallbackQuestName(normalized)
}

function buildAutoRenameSnapshot(questId: string): AutoRenameSnapshot | null {
  const messages = listEvents(questId)
    .filter((event) =>
      event.type === 'message'
      && (event.role === 'user' || event.role === 'assistant')
      && event.content?.trim())
    .slice(0, 6)

  const fallbackSource = messages.find((event) => event.role === 'user')?.content?.trim()
  if (!fallbackSource) return null

  return {
    fallbackSource,
    transcript: messages
      .map((event) => `${event.role === 'assistant' ? 'Assistant' : 'User'}:\n${event.content?.trim() ?? ''}`)
      .join('\n\n'),
  }
}

function buildAutoRenamePrompt(snapshot: AutoRenameSnapshot): string {
  return [
    'Generate a short title for this Pluse session based on the first round conversation.',
    'Conversation:',
    snapshot.transcript,
    'Return only the title.',
  ].join('\n\n')
}

function parseClaudeLine(line: string): ProviderParseResult {
  const obj = safeJsonParse(line)
  if (!obj) return { events: [] }
  const events: ProviderEvent[] = []
  let assistantText = ''
  let claudeSessionId: string | undefined
  let providerError: string | undefined

  if (obj.type === 'system' && typeof obj.session_id === 'string' && obj.session_id.trim()) {
    claudeSessionId = obj.session_id.trim()
  }

  if (obj.type === 'assistant' && obj.message && typeof obj.message === 'object') {
    const content = (obj.message as Record<string, unknown>).content
    if (Array.isArray(content)) {
      for (const block of content) {
        if (!block || typeof block !== 'object') continue
        const entry = block as Record<string, unknown>
        if (entry.type === 'text' && typeof entry.text === 'string' && entry.text.trim()) {
          assistantText = entry.text
          events.push(makeMessageEvent('assistant', entry.text))
        } else if (entry.type === 'thinking' && typeof entry.thinking === 'string' && entry.thinking.trim()) {
          events.push(makeReasoningEvent(entry.thinking))
        } else if (entry.type === 'tool_use') {
          const input = typeof entry.input === 'string' ? entry.input : JSON.stringify(entry.input ?? {}, null, 2)
          events.push(makeToolUseEvent(`${String(entry.name ?? 'tool')}\n${input}`.trim()))
        } else if (entry.type === 'tool_result') {
          events.push(makeToolResultEvent(normalizeText(entry.content)))
        }
      }
    }
  }

  let tokenUsage: TokenUsage | undefined
  if (obj.type === 'result') {
    const usage = obj.usage && typeof obj.usage === 'object' ? obj.usage as Record<string, unknown> : {}
    events.push(makeUsageEvent([
      typeof usage.input_tokens === 'number' ? `input ${usage.input_tokens}` : null,
      typeof usage.output_tokens === 'number' ? `output ${usage.output_tokens}` : null,
    ]))
    // Extract token usage — note Claude API uses cache_read_input_tokens / cache_creation_input_tokens
    if (typeof usage.input_tokens === 'number' || typeof usage.output_tokens === 'number') {
      tokenUsage = {
        inputTokens: typeof usage.input_tokens === 'number' ? usage.input_tokens : 0,
        outputTokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : 0,
        cacheReadTokens: typeof usage.cache_read_input_tokens === 'number' ? usage.cache_read_input_tokens : 0,
        cacheCreationTokens: typeof usage.cache_creation_input_tokens === 'number' ? usage.cache_creation_input_tokens : 0,
        costUsd: typeof obj.total_cost_usd === 'number' ? obj.total_cost_usd : undefined,
      }
    }
    providerError = normalizeProviderError(obj.error)
  } else if (obj.type === 'error') {
    providerError = normalizeProviderError(obj.error ?? obj.message)
  }

  return { events, assistantText, claudeSessionId, providerError, tokenUsage }
}

function parseCodexLine(line: string): ProviderParseResult {
  const obj = safeJsonParse(line)
  if (!obj) return { events: [] }
  const events: ProviderEvent[] = []
  let assistantText = ''
  const codexThreadId = typeof obj.thread_id === 'string'
    ? obj.thread_id.trim()
    : typeof obj.session_id === 'string'
      ? obj.session_id.trim()
      : undefined

  if (obj.type === 'message' && obj.role === 'assistant' && typeof obj.content === 'string' && obj.content.trim()) {
    assistantText = obj.content
    events.push(makeMessageEvent('assistant', obj.content))
  } else if (obj.type === 'item.completed' && obj.item && typeof obj.item === 'object') {
    const item = obj.item as Record<string, unknown>
    if (item.type === 'agent_message' && typeof item.text === 'string' && item.text.trim()) {
      assistantText = item.text
      events.push(makeMessageEvent('assistant', item.text))
    } else if (item.type === 'reasoning' && typeof item.text === 'string' && item.text.trim()) {
      events.push(makeReasoningEvent(item.text))
    } else if (item.type === 'tool_call') {
      const input = typeof item.input === 'string' ? item.input : JSON.stringify(item.input ?? {}, null, 2)
      events.push(makeToolUseEvent(`${String(item.name ?? 'tool')}\n${input}`.trim()))
    } else if (item.type === 'tool_result' && typeof item.output === 'string' && item.output.trim()) {
      events.push(makeToolResultEvent(item.output))
    }
  } else if (obj.type === 'reasoning' && typeof obj.text === 'string' && obj.text.trim()) {
    events.push(makeReasoningEvent(obj.text))
  } else if (obj.type === 'error') {
    return { events, assistantText, codexThreadId, providerError: normalizeProviderError(obj.error ?? obj.message) }
  }

  return { events, assistantText, codexThreadId }
}

function parseProviderLine(tool: ToolName, line: string): ProviderParseResult {
  return tool === 'claude' ? parseClaudeLine(line) : parseCodexLine(line)
}

function buildClaudeArgs(prompt: string, options: { model?: string; effort?: string | null; thinking?: boolean; systemPrompt?: string; resumeSessionId?: string }): string[] {
  const args = ['--print', prompt, '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions']
  if (options.model) args.push('--model', options.model)
  const effort = options.effort?.trim() || (options.thinking ? 'high' : '')
  if (effort) args.push('--effort', effort)
  if (options.systemPrompt?.trim()) args.push('--system-prompt', options.systemPrompt.trim())
  if (options.resumeSessionId?.trim()) args.push('--resume', options.resumeSessionId.trim())
  return args
}

function buildCodexArgs(prompt: string, options: { model?: string; effort?: string | null; systemPrompt?: string; threadId?: string }): string[] {
  const args = ['exec', '--json', '--dangerously-bypass-approvals-and-sandbox', '--skip-git-repo-check']
  if (options.model) args.push('-m', options.model)
  if (options.effort) args.push('-c', `model_reasoning_effort=${JSON.stringify(options.effort)}`)
  const fullPrompt = options.systemPrompt?.trim() ? `Project instructions:\n${options.systemPrompt.trim()}\n\n${prompt}` : prompt
  if (options.threadId?.trim()) {
    args.push('resume', options.threadId.trim(), fullPrompt)
  } else {
    args.push(fullPrompt)
  }
  return args
}

function wireLineStream(stream: NodeJS.ReadableStream | null, onLine: (line: string) => void): void {
  if (!stream) return
  let buffer = ''
  stream.on('data', (chunk) => {
    buffer += chunk.toString()
    while (true) {
      const newlineIndex = buffer.indexOf('\n')
      if (newlineIndex === -1) break
      const line = buffer.slice(0, newlineIndex)
      buffer = buffer.slice(newlineIndex + 1)
      if (line.trim()) onLine(line)
    }
  })
  stream.on('end', () => {
    if (buffer.trim()) onLine(buffer)
  })
}

function emitQuestUpdated(questId: string): void {
  const quest = getQuest(questId)
  if (!quest) return
  emit({ type: 'quest_updated', data: { questId: quest.id, projectId: quest.projectId } })
}

function emitRunUpdated(runId: string): void {
  const run = getRun(runId)
  if (!run) return
  emit({ type: 'run_updated', data: { runId: run.id, questId: run.questId, projectId: run.projectId } })
}

function appendQuestEvents(questId: string, events: ProviderEvent[]): void {
  for (const event of events) {
    appendEvent(questId, event)
  }
}

function persistProviderIds(
  questId: string,
  runId: string,
  ids: { codexThreadId?: string; claudeSessionId?: string },
  options: { updateQuest: boolean },
): void {
  const quest = getQuest(questId)
  const run = getRun(runId)
  if (!quest || !run) return

  const questPatch: Parameters<typeof updateQuest>[1] = {}
  const runPatch: Partial<Run> = {}
  if (options.updateQuest && ids.codexThreadId && quest.codexThreadId !== ids.codexThreadId) questPatch.codexThreadId = ids.codexThreadId
  if (options.updateQuest && ids.claudeSessionId && quest.claudeSessionId !== ids.claudeSessionId) questPatch.claudeSessionId = ids.claudeSessionId
  if (ids.codexThreadId && run.codexThreadId !== ids.codexThreadId) runPatch.codexThreadId = ids.codexThreadId
  if (ids.claudeSessionId && run.claudeSessionId !== ids.claudeSessionId) runPatch.claudeSessionId = ids.claudeSessionId
  if (Object.keys(questPatch).length > 0) updateQuest(questId, questPatch)
  if (Object.keys(runPatch).length > 0) updateRun(runId, runPatch)
}

function clearRunnerTimers(handle: ActiveRunner): void {
  if (handle.timeoutId) clearTimeout(handle.timeoutId)
  if (handle.killGraceId) clearTimeout(handle.killGraceId)
}

function requestTermination(runId: string, reason: 'cancelled' | 'timeout'): void {
  const handle = activeRunners.get(runId)
  if (!handle) return
  handle.reason = reason
  if (!handle.child.killed) handle.child.kill('SIGTERM')
  if (!handle.killGraceId) {
    handle.killGraceId = setTimeout(() => {
      if (!handle.child.killed) handle.child.kill('SIGKILL')
    }, RUN_KILL_GRACE_MS)
  }
}

function ensureTaskReviewTodo(quest: Quest, succeeded: boolean): void {
  if (!succeeded || !quest.reviewOnComplete || quest.kind !== 'task' || quest.deleted) return
  ensureReviewTodoWithEffects({
    projectId: quest.projectId,
    originQuestId: quest.id,
    createdBy: 'system',
    title: `Review: ${quest.title ?? quest.name ?? quest.id}`,
    waitingInstructions: `Task "${quest.title ?? quest.name ?? quest.id}" completed. Please review the output and close the todo when done.`,
    tags: ['review'],
  })
}

async function generateQuestNameWithProvider(quest: Quest, snapshot: AutoRenameSnapshot): Promise<string | null> {
  const project = getProject(quest.projectId)
  if (!project) return null

  const workingDirectoryError = validateProjectWorkingDirectory(project.workDir)
  if (workingDirectoryError) return null

  const renameTool = resolveTool(quest.tool)
  const runtime = questRuntimePreferences(quest, {
    tool: renameTool,
    model: renameTool === 'codex' ? getRuntimeModelCatalog('codex').defaultModel ?? undefined : undefined,
    effort: 'low',
    thinking: false,
  })
  const tool = runtime.tool
  const command = resolveToolCommand(tool)
  const args = tool === 'claude'
      ? buildClaudeArgs(
        buildAutoRenamePrompt(snapshot),
        {
          model: runtime.model,
          effort: runtime.effort,
          thinking: false,
          systemPrompt: AUTO_RENAME_SYSTEM_PROMPT,
        },
      )
    : buildCodexArgs(
      buildAutoRenamePrompt(snapshot),
      {
        model: runtime.model,
        effort: 'low',
        systemPrompt: AUTO_RENAME_SYSTEM_PROMPT,
      },
    )

  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: project.workDir,
      env: runtimeEnvForTool(tool),
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let lastAssistantText = ''
    let lastProviderError: string | undefined
    const stderrLines: string[] = []
    let timedOut = false
    let killGraceId: Timer | undefined

    const timeoutId = setTimeout(() => {
      timedOut = true
      if (!child.killed) child.kill('SIGTERM')
      killGraceId = setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL')
      }, RUN_KILL_GRACE_MS)
    }, AUTO_RENAME_TIMEOUT_MS)

    wireLineStream(child.stdout, (line) => {
      const parsed = parseProviderLine(tool, line)
      if (parsed.assistantText?.trim()) lastAssistantText = parsed.assistantText
      if (parsed.providerError) lastProviderError = parsed.providerError
    })
    wireLineStream(child.stderr, (line) => {
      stderrLines.push(line)
    })

    child.once('error', () => {
      clearTimeout(timeoutId)
      if (killGraceId) clearTimeout(killGraceId)
      resolve(null)
    })

    child.once('close', (code, signal) => {
      clearTimeout(timeoutId)
      if (killGraceId) clearTimeout(killGraceId)

      if (timedOut) {
        resolve(null)
        return
      }

      const failureReason = resolveFailureReason(code, signal, lastProviderError, stderrLines)
      if (failureReason) {
        resolve(null)
        return
      }

      const name = normalizeGeneratedQuestName(lastAssistantText)
      resolve(name || null)
    })
  })
}

async function maybeAutoRenameQuest(questId: string, snapshot: AutoRenameSnapshot | null): Promise<void> {
  const quest = getQuest(questId)
  if (!quest || quest.kind !== 'session' || !quest.autoRenamePending) return

  const fallbackName = snapshot?.fallbackSource ? fallbackQuestName(snapshot.fallbackSource) : ''
  const generatedName = snapshot ? await generateQuestNameWithProvider(quest, snapshot) : null
  const freshQuest = getQuest(questId)
  if (!freshQuest || freshQuest.kind !== 'session' || !freshQuest.autoRenamePending) return

  updateQuest(questId, {
    name: generatedName ?? (fallbackName || freshQuest.name),
    autoRenamePending: false,
  })
  emitQuestUpdated(questId)
}

function scheduleAutoRename(questId: string): void {
  const quest = getQuest(questId)
  if (!quest || quest.kind !== 'session' || !quest.autoRenamePending || isQuestBusyForChat(quest)) return
  if (!getRunsByQuest(quest.id).some((run) => run.trigger === 'chat')) return

  const autoRenameSnapshot = buildAutoRenameSnapshot(quest.id)
  queueMicrotask(() => {
    void maybeAutoRenameQuest(quest.id, autoRenameSnapshot)
  })
}

function maybeStartNextFollowUp(questId: string): void {
  const quest = getQuest(questId)
  if (!quest || quest.kind !== 'session' || isQuestBusyForChat(quest)) return
  const next = dequeueFollowUp(questId)
  if (!next.message) return
  const message = next.message
  const queuedQuest = getQuest(questId)
  if (!queuedQuest) return
  appendEvent(questId, makeMessageEvent('user', message.displayText ?? message.text))
  const runtime = questRuntimePreferences(queuedQuest, {
    tool: resolveTool(message.tool),
    model: message.model ?? resolveModel(resolveTool(message.tool)),
    effort: message.effort,
    thinking: message.thinking,
  })
  const run = createAcceptedRun(queuedQuest, message.requestId, 'chat', 'human', runtime)
  queueMicrotask(() => {
    void executeQuestRun(run.id, questId, message.promptText ?? message.text)
  })
}

function finalizeRun(runId: string, state: Run['state'], failureReason?: string, assistantText?: string): void {
  const run = getRun(runId)
  const quest = run ? getQuest(run.questId) : null
  if (!run || !quest) return

  const nextQuestStatus = quest.kind === 'task'
    ? state === 'completed'
      ? quest.scheduleKind === 'recurring' ? 'pending' : 'done'
      : state === 'cancelled'
        ? 'pending'
        : 'failed'
    : 'idle'

  updateRun(runId, {
    state,
    failureReason,
    completedAt: nowIso(),
    finalizedAt: nowIso(),
    runnerProcessId: undefined,
  })

  updateQuest(quest.id, {
    activeRunId: null,
    status: nextQuestStatus,
    completionOutput: quest.kind === 'task' && assistantText ? assistantText : quest.completionOutput ?? null,
  })

  if (quest.kind === 'task') {
    createQuestOp({
      questId: quest.id,
      op: state === 'completed' ? 'done' : state === 'cancelled' ? 'cancelled' : 'failed',
      actor: 'system',
      fromStatus: 'running',
      toStatus: nextQuestStatus,
      note: failureReason,
    })
    createProjectActivity({
      projectId: quest.projectId,
      subjectType: 'task',
      subjectId: quest.id,
      questId: quest.id,
      title: quest.title?.trim() || quest.name?.trim() || '未命名任务',
      op: state === 'completed' ? 'done' : state === 'cancelled' ? 'cancelled' : 'failed',
      actor: 'system',
      fromStatus: 'running',
      toStatus: nextQuestStatus,
      note: failureReason,
    })
  }

  if (quest.kind === 'session' && run.trigger === 'chat' && quest.autoRenamePending) {
    scheduleAutoRename(quest.id)
  }

  ensureTaskReviewTodo(quest, state === 'completed')
  emitRunUpdated(runId)
  emitQuestUpdated(quest.id)
  if (quest.kind === 'session') maybeStartNextFollowUp(quest.id)

  if (state === 'completed' || state === 'failed') {
    const hookEvent = state === 'completed' ? 'run_completed' : 'run_failed'
    const runSnapshot = getRun(runId)
    if (runSnapshot) {
      queueMicrotask(() => {
        try {
          runHooks(hookEvent, { quest, run: runSnapshot })
        } catch (error) {
          console.error('[hooks] runHooks failed:', error)
        }
      })
    }
  }
}

function createAcceptedRun(
  quest: Quest,
  requestId: string,
  trigger: RunTrigger,
  triggeredBy: RunTriggeredBy,
  runtime: RuntimePreferences,
): Run {
  const run = createRun({
    questId: quest.id,
    projectId: quest.projectId,
    requestId,
    trigger,
    triggeredBy,
    tool: runtime.tool,
    model: runtime.model,
    effort: runtime.effort ?? undefined,
    thinking: runtime.thinking,
    claudeSessionId: runtime.tool === 'claude' ? quest.claudeSessionId : undefined,
    codexThreadId: runtime.tool === 'codex' ? quest.codexThreadId : undefined,
  })
  updateQuest(quest.id, {
    activeRunId: run.id,
    tool: runtime.tool,
    model: runtime.model,
    effort: runtime.effort,
    thinking: runtime.thinking,
    status: quest.kind === 'task' ? 'running' : quest.status ?? 'idle',
  })
  if (quest.kind === 'task') {
    createQuestOp({
      questId: quest.id,
      op: 'triggered',
      actor: triggeredBy === 'scheduler' ? 'scheduler' : 'human',
      fromStatus: quest.status,
      toStatus: 'running',
    })
    createProjectActivity({
      projectId: quest.projectId,
      subjectType: 'task',
      subjectId: quest.id,
      questId: quest.id,
      title: quest.title?.trim() || quest.name?.trim() || '未命名任务',
      op: 'triggered',
      actor: triggeredBy === 'scheduler' ? 'scheduler' : 'human',
      fromStatus: quest.status,
      toStatus: 'running',
    })
  }
  emitRunUpdated(run.id)
  emitQuestUpdated(quest.id)
  return run
}

async function executeScriptRun(runId: string, questId: string): Promise<void> {
  const quest = getQuest(questId)
  const run = getRun(runId)
  if (!quest || !run) return
  const { command, timeoutMs, env, cwd } = buildScriptCommand(quest)

  const child = spawn('sh', ['-c', command], {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const handle: ActiveRunner = { child }
  activeRunners.set(runId, handle)
  updateRun(runId, { state: 'running', startedAt: nowIso(), runnerProcessId: child.pid ?? undefined })
  emitRunUpdated(runId)

  let lastLine = ''
  let stderr = ''
  const onLine = (line: string) => {
    lastLine = line
    appendRunSpoolLine(runId, line)
    emit({ type: 'run_line', data: { runId, questId, projectId: quest.projectId, line, ts: nowIso() } })
  }
  wireLineStream(child.stdout, onLine)
  wireLineStream(child.stderr, (line) => {
    stderr += `${line}\n`
    onLine(line)
  })

  handle.timeoutId = setTimeout(() => requestTermination(runId, 'timeout'), timeoutMs)

  child.once('error', (error) => {
    clearRunnerTimers(handle)
    activeRunners.delete(runId)
    appendQuestEvents(questId, [makeStatusEvent(`error: ${error.message}`)])
    finalizeRun(runId, 'failed', error.message, lastLine)
  })

  child.once('close', (code) => {
    clearRunnerTimers(handle)
    activeRunners.delete(runId)
    if (handle.reason === 'cancelled') {
      appendQuestEvents(questId, [makeStatusEvent('cancelled')])
      finalizeRun(runId, 'cancelled', 'cancelled', lastLine)
      return
    }
    if (handle.reason === 'timeout') {
      appendQuestEvents(questId, [makeStatusEvent('error: script run timed out')])
      finalizeRun(runId, 'failed', 'script run timed out', lastLine)
      return
    }
    if (code === 0) {
      finalizeRun(runId, 'completed', undefined, lastLine)
      return
    }
    const failure = stderr.trim() || `exited with code ${code}`
    appendQuestEvents(questId, [makeStatusEvent(`error: ${failure}`)])
    finalizeRun(runId, 'failed', failure, lastLine)
  })
}

type ProviderAttemptResult = {
  state: Run['state']
  failureReason?: string
  assistantText?: string
  retryWithHistory?: boolean
  tokenUsage?: TokenUsage
}

async function executeProviderRun(runId: string, questId: string, latestPrompt: string): Promise<void> {
  const quest = getQuest(questId)
  const run = getRun(runId)
  if (!quest || !run) return
  const project = getProject(quest.projectId)
  if (!project) {
    appendQuestEvents(questId, [makeStatusEvent('error: project not found')])
    finalizeRun(runId, 'failed', 'project not found')
    return
  }

  const workingDirectoryError = validateProjectWorkingDirectory(project.workDir)
  if (workingDirectoryError) {
    appendQuestEvents(questId, [makeStatusEvent(`error: ${workingDirectoryError}`)])
    finalizeRun(runId, 'failed', workingDirectoryError)
    return
  }

  const tool = resolveTool(run.tool)
  const command = resolveToolCommand(tool)
  const canContinueContext = shouldContinueQuestContext(quest)
  const updateQuestProviderIds = shouldPersistQuestProviderIds(quest)
  const initialNativeResume = tool === 'claude'
    ? canContinueContext && Boolean(run.claudeSessionId)
    : canContinueContext && Boolean(run.codexThreadId)

  const attempt = (nativeResume: boolean): Promise<ProviderAttemptResult> => new Promise((resolve) => {
    const currentRun = getRun(runId)
    const currentQuest = getQuest(questId)
    if (!currentRun || !currentQuest) {
      resolve({ state: 'failed', failureReason: 'run or quest not found' })
      return
    }

    const prompt = nativeResume
      ? latestPrompt
      : canContinueContext
        ? buildHistoryPrompt(questId, latestPrompt)
        : latestPrompt
    const args = tool === 'claude'
      ? buildClaudeArgs(
        prompt,
        {
          model: currentRun.model,
          effort: currentRun.effort,
          thinking: currentRun.thinking,
          systemPrompt: systemPromptForQuest(currentQuest),
          resumeSessionId: nativeResume ? currentRun.claudeSessionId : undefined,
        },
      )
      : buildCodexArgs(
        prompt,
        {
          model: currentRun.model,
          effort: currentRun.effort,
          systemPrompt: systemPromptForQuest(currentQuest),
          threadId: nativeResume ? currentRun.codexThreadId : undefined,
        },
      )

    const child = spawn(command, args, {
      cwd: project.workDir,
      env: runtimeEnvForTool(tool),
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const handle: ActiveRunner = { child }
    activeRunners.set(runId, handle)
    updateRun(runId, {
      state: 'running',
      startedAt: currentRun.startedAt ?? nowIso(),
      runnerProcessId: child.pid ?? undefined,
    })
    emitRunUpdated(runId)
    appendQuestEvents(questId, [makeStatusEvent(`Running with ${tool}${nativeResume ? ' (resume)' : ''}`)])

    let sawProviderOutput = false
    let lastAssistantText = ''
    let lastProviderError: string | undefined
    const stderrLines: string[] = []
    // Declared inside attempt() so each call gets its own independent variable
    let capturedTokenUsage: TokenUsage | undefined

    wireLineStream(child.stdout, (line) => {
      appendRunSpoolLine(runId, line)
      emit({ type: 'run_line', data: { runId, questId, projectId: currentQuest.projectId, line, ts: nowIso() } })
      const parsed = parseProviderLine(tool, line)
      if (parsed.assistantText?.trim()) lastAssistantText = parsed.assistantText
      if (parsed.providerError) lastProviderError = parsed.providerError
      if (parsed.tokenUsage) capturedTokenUsage = parsed.tokenUsage
      if (
        parsed.events.length > 0
        || Boolean(parsed.assistantText?.trim())
        || Boolean(parsed.codexThreadId)
        || Boolean(parsed.claudeSessionId)
      ) {
        sawProviderOutput = true
      }
      persistProviderIds(
        questId,
        runId,
        {
          codexThreadId: parsed.codexThreadId,
          claudeSessionId: parsed.claudeSessionId,
        },
        { updateQuest: updateQuestProviderIds },
      )
      appendQuestEvents(questId, parsed.events)
    })
    wireLineStream(child.stderr, (line) => {
      stderrLines.push(line)
    })

    handle.timeoutId = setTimeout(() => requestTermination(runId, 'timeout'), RUN_TIMEOUT_MS)

    child.once('error', (error) => {
      clearRunnerTimers(handle)
      activeRunners.delete(runId)
      resolve({ state: 'failed', failureReason: error.message, assistantText: lastAssistantText, tokenUsage: capturedTokenUsage })
    })

    child.once('close', (code, signal) => {
      clearRunnerTimers(handle)
      activeRunners.delete(runId)
      if (handle.reason === 'cancelled') {
        resolve({ state: 'cancelled', failureReason: 'cancelled', assistantText: lastAssistantText, tokenUsage: capturedTokenUsage })
        return
      }
      if (handle.reason === 'timeout') {
        resolve({ state: 'failed', failureReason: `${tool} run timed out`, assistantText: lastAssistantText, tokenUsage: capturedTokenUsage })
        return
      }
      const failureReason = resolveFailureReason(code, signal, lastProviderError, stderrLines)
      if (!failureReason && code === 0) {
        resolve({ state: 'completed', assistantText: lastAssistantText, tokenUsage: capturedTokenUsage })
        return
      }
      resolve({
        state: 'failed',
        failureReason,
        assistantText: lastAssistantText,
        tokenUsage: capturedTokenUsage,
        retryWithHistory: nativeResume && shouldRetryResumeFailure(failureReason, sawProviderOutput),
      })
    })
  })

  const firstAttempt = await attempt(initialNativeResume)
  if (firstAttempt.retryWithHistory) {
    appendQuestEvents(questId, [makeStatusEvent('resume failed, retrying with history injection')])
    const fallbackAttempt = await attempt(false)
    // Use fallbackAttempt's tokenUsage (firstAttempt's is discarded — it failed before completion)
    if (fallbackAttempt.tokenUsage) updateRun(runId, fallbackAttempt.tokenUsage)
    if (fallbackAttempt.state === 'completed') {
      finalizeRun(runId, 'completed', undefined, fallbackAttempt.assistantText)
      return
    }
    if (fallbackAttempt.state === 'cancelled') {
      appendQuestEvents(questId, [makeStatusEvent('cancelled')])
      finalizeRun(runId, 'cancelled', fallbackAttempt.failureReason, fallbackAttempt.assistantText)
      return
    }
    appendQuestEvents(questId, [makeStatusEvent(`error: ${fallbackAttempt.failureReason}`)])
    finalizeRun(runId, 'failed', fallbackAttempt.failureReason, fallbackAttempt.assistantText)
    return
  }

  if (firstAttempt.tokenUsage) updateRun(runId, firstAttempt.tokenUsage)
  if (firstAttempt.state === 'completed') {
    finalizeRun(runId, 'completed', undefined, firstAttempt.assistantText)
    return
  }
  if (firstAttempt.state === 'cancelled') {
    appendQuestEvents(questId, [makeStatusEvent('cancelled')])
    finalizeRun(runId, 'cancelled', firstAttempt.failureReason, firstAttempt.assistantText)
    return
  }
  appendQuestEvents(questId, [makeStatusEvent(`error: ${firstAttempt.failureReason}`)])
  finalizeRun(runId, 'failed', firstAttempt.failureReason, firstAttempt.assistantText)
}

async function executeQuestRun(runId: string, questId: string, promptText?: string): Promise<void> {
  try {
    const quest = getQuest(questId)
    const run = getRun(runId)
    if (!quest || !run) return
    if (run.cancelRequested) {
      finalizeRun(runId, 'cancelled', 'cancelled')
      return
    }
    if (quest.kind === 'task' && quest.executorKind === 'script') {
      await executeScriptRun(runId, questId)
      return
    }
    const prompt = promptText ?? (quest.kind === 'task' ? buildTaskPrompt(quest) : '')
    await executeProviderRun(runId, questId, prompt)
  } catch (error) {
    const run = getRun(runId)
    if (!run || !isInFlightRunState(run.state)) return
    const failureReason = normalizeErrorMessage(error)
    appendQuestEvents(questId, [makeStatusEvent(`error: ${failureReason}`)])
    finalizeRun(runId, 'failed', failureReason)
  }
}

export async function startQuestRun(input: StartQuestRunInput): Promise<StartQuestRunResult> {
  const quest = getQuest(input.questId)
  if (!quest) throw new Error(`Quest not found: ${input.questId}`)
  if (quest.deleted) throw new Error('Quest is archived')
  const existingRun = input.requestId ? getRunByQuestRequestId(quest.id, input.requestId) : null
  if (existingRun) {
    return { skipped: false, run: existingRun, quest: getQuest(quest.id) }
  }

  if (isQuestBusyForChat(quest)) {
    if (input.trigger === 'automation') {
      return { skipped: true, run: null, quest }
    }
    throw new Error('QUEST_RUN_CONFLICT')
  }

  if (quest.kind !== 'task') {
    throw new Error('Only task quests can be triggered via /run')
  }
  if (quest.enabled === false) {
    throw new Error('Quest is disabled')
  }
  const runConfigError = validateTaskRunConfig(quest)
  if (runConfigError) {
    throw new Error(runConfigError)
  }

  const runtime = questRuntimePreferences(quest)
  const requestId = input.requestId?.trim() || genRequestId()
  const run = createAcceptedRun(quest, requestId, input.trigger, input.triggeredBy, runtime)
  queueMicrotask(() => {
    void executeQuestRun(run.id, quest.id)
  })
  return { skipped: false, run, quest: getQuest(quest.id) }
}

export function submitQuestMessage(input: SubmitQuestMessageInput): SubmitQuestMessageResult {
  const initialQuest = getQuest(input.questId)
  if (!initialQuest) throw new Error(`Quest not found: ${input.questId}`)
  if (initialQuest.kind !== 'session') throw new Error('Only session quests accept chat messages')
  if (initialQuest.deleted) throw new Error('Quest is archived')

  const requestId = input.requestId?.trim() || genRequestId()
  const existingRun = getRunByQuestRequestId(initialQuest.id, requestId)
  if (existingRun) {
    return { queued: false, run: existingRun, quest: getQuest(initialQuest.id) }
  }

  const recordedText = buildRecordedUserText(input)
  const aiPromptText = buildAttachmentPrompt(input)
  const nextTool = input.tool ? resolveTool(input.tool) : resolveTool(initialQuest.tool)
  const nextModel = input.model === undefined
    ? initialQuest.model ?? null
    : input.model === null
      ? null
      : resolveModel(nextTool, input.model)

  const updatedQuest = updateQuest(initialQuest.id, {
    tool: input.tool ? nextTool : initialQuest.tool ?? null,
    model: nextModel,
    effort: input.effort !== undefined ? input.effort : initialQuest.effort ?? null,
    thinking: input.thinking !== undefined ? input.thinking : initialQuest.thinking === true,
  })

  const runtime = questRuntimePreferences(updatedQuest, {
    tool: input.tool ? nextTool : undefined,
    model: nextModel ?? undefined,
    effort: input.effort ?? undefined,
    thinking: input.thinking,
  })

  if (isQuestBusyForChat(updatedQuest)) {
    enqueueFollowUp(updatedQuest.id, {
      requestId,
      text: aiPromptText,
      displayText: recordedText,
      promptText: aiPromptText,
      tool: runtime.tool,
      model: runtime.model,
      effort: runtime.effort,
      thinking: runtime.thinking,
      queuedAt: nowIso(),
    })
    emitQuestUpdated(updatedQuest.id)
    return { queued: true, run: null, quest: getQuest(updatedQuest.id) }
  }

  appendEvent(initialQuest.id, makeMessageEvent('user', recordedText))
  const run = createAcceptedRun(updatedQuest, requestId, 'chat', 'human', runtime)
  queueMicrotask(() => {
    void executeQuestRun(run.id, updatedQuest.id, aiPromptText)
  })
  return { queued: false, run, quest: getQuest(updatedQuest.id) }
}

export function cancelActiveRun(id: string): Run {
  const run = getRun(id)
  if (!run) throw new Error(`Run not found: ${id}`)
  const next = cancelRun(id)
  requestTermination(id, 'cancelled')
  emitRunUpdated(id)
  return next
}

export function cancelQueuedRequest(questId: string, requestId: string): Quest {
  removeFollowUp(questId, requestId)
  emitQuestUpdated(questId)
  const quest = getQuest(questId)
  if (!quest) throw new Error(`Quest not found: ${questId}`)
  return quest
}

export function clearQueuedRequests(questId: string): Quest {
  clearFollowUps(questId)
  emitQuestUpdated(questId)
  const quest = getQuest(questId)
  if (!quest) throw new Error(`Quest not found: ${questId}`)
  return quest
}

export function recoverFollowUpQueues(): void {
  for (const quest of listQuestsWithPendingQueue()) {
    if (isQuestBusyForChat(quest)) continue
    maybeStartNextFollowUp(quest.id)
  }
}

export function recoverPendingSessionAutoRenames(): void {
  for (const quest of listQuestsPendingAutoRename()) {
    scheduleAutoRename(quest.id)
  }
}

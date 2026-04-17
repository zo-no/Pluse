import { randomBytes } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { statSync } from 'node:fs'
import type { Run, SessionEvent, UpdateSessionInput, QueuedMessage } from '@pluse/types'
import { appendEvent, listEvents } from '../models/history'
import { getProject } from '../models/project'
import { buildSessionSystemPrompt } from '../services/system-prompt'
import { createRun, getRun, getRunsBySession, updateRun } from '../models/run'
import {
  dequeueFollowUp,
  enqueueFollowUp,
  getSession,
  listSessionsWithPendingQueue,
  updateSession,
} from '../models/session'

const DEFAULT_TOOL = 'codex'
const RUN_TIMEOUT_MS = parsePositiveInt(process.env['PLUSE_RUN_TIMEOUT_MS'] ?? process.env['PULSE_RUN_TIMEOUT_MS'] ?? process.env['MELODYSYNC_RUN_TIMEOUT_MS'], 300_000)
const RUN_KILL_GRACE_MS = parsePositiveInt(process.env['PLUSE_RUN_KILL_GRACE_MS'] ?? process.env['PULSE_RUN_KILL_GRACE_MS'] ?? process.env['MELODYSYNC_RUN_KILL_GRACE_MS'], 15_000)
const DEFAULT_MODELS: Record<string, string> = {
  codex: process.env['PLUSE_DEFAULT_CODEX_MODEL']?.trim() ?? process.env['PULSE_DEFAULT_CODEX_MODEL']?.trim() ?? process.env['MELODYSYNC_DEFAULT_CODEX_MODEL']?.trim() ?? '',
  claude: process.env['PLUSE_DEFAULT_CLAUDE_MODEL']?.trim() ?? process.env['PULSE_DEFAULT_CLAUDE_MODEL']?.trim() ?? process.env['MELODYSYNC_DEFAULT_CLAUDE_MODEL']?.trim() ?? '',
}

type ActiveRunner = {
  child: ChildProcess
  reason?: 'cancelled' | 'timeout'
  timeoutId?: Timer
  killGraceId?: Timer
}

type ToolName = 'codex' | 'claude'

const activeRunners = new Map<string, ActiveRunner>()

export interface SubmitSessionMessageInput {
  sessionId: string
  text: string
  requestId?: string
  tool?: string
  model?: string | null
  effort?: string | null
  thinking?: boolean
  attachments?: Array<{
    assetId: string
    filename: string
    savedPath: string
    mimeType: string
  }>
}

export interface SubmitSessionMessageResult {
  queued: boolean
  run: Run | null
  session: ReturnType<typeof getSession>
}

type ProviderEvent = Omit<SessionEvent, 'seq'>
type ProviderParseResult = {
  events: ProviderEvent[]
  claudeSessionId?: string
  codexThreadId?: string
  providerError?: string
}

type RuntimePreferences = Omit<QueuedMessage, 'requestId' | 'text'>

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function nowIso(): string {
  return new Date().toISOString()
}

function genRequestId(): string {
  return 'req_' + randomBytes(8).toString('hex')
}

function makeStatusEvent(content: string): ProviderEvent {
  return {
    timestamp: Date.now(),
    type: 'status',
    content,
  }
}

function makeMessageEvent(role: 'user' | 'assistant', content: string): ProviderEvent {
  return {
    timestamp: Date.now(),
    type: 'message',
    role,
    content,
  }
}

function makeReasoningEvent(content: string): ProviderEvent {
  return {
    timestamp: Date.now(),
    type: 'reasoning',
    role: 'assistant',
    content,
  }
}

function makeToolUseEvent(toolInput: string): ProviderEvent {
  return {
    timestamp: Date.now(),
    type: 'tool_use',
    role: 'assistant',
    toolInput,
  }
}

function makeToolResultEvent(output: string): ProviderEvent {
  return {
    timestamp: Date.now(),
    type: 'tool_result',
    output,
  }
}

function makeFileChangeEvent(content: string): ProviderEvent {
  return {
    timestamp: Date.now(),
    type: 'file_change',
    content,
  }
}

function makeUsageEvent(parts: Array<string | null | undefined>): ProviderEvent {
  return {
    timestamp: Date.now(),
    type: 'usage',
    content: parts.filter(Boolean).join(' · '),
  }
}

function safeJsonParse(value: string): unknown | null {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function normalizeTextBlockArray(value: unknown): string {
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

function normalizeProviderError(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const firstLine = value
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith('at ') && !line.startsWith('[ede_diagnostic]'))
    return firstLine?.replace(/^Error:\s*/, '') || undefined
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const normalized = normalizeProviderError(entry)
      if (normalized) return normalized
    }
    return undefined
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (typeof record.message === 'string') return normalizeProviderError(record.message)
    if (typeof record.error === 'string') return normalizeProviderError(record.error)
  }

  return undefined
}

function parseClaudeLine(line: string): ProviderParseResult {
  const parsed = safeJsonParse(line)
  if (!parsed || typeof parsed !== 'object') return { events: [] }

  const obj = parsed as Record<string, any>
  const events: ProviderEvent[] = []
  const result: ProviderParseResult = { events }

  switch (obj.type) {
    case 'system':
      if (obj.subtype === 'init') {
        events.push(makeStatusEvent(`Claude session started (${obj.session_id || 'unknown'})`))
        if (typeof obj.session_id === 'string' && obj.session_id.trim()) {
          result.claudeSessionId = obj.session_id.trim()
        }
      } else if (obj.subtype === 'api_retry') {
        const attempt = Number.isFinite(obj.attempt) ? obj.attempt : '?'
        const maxRetries = Number.isFinite(obj.max_retries) ? obj.max_retries : '?'
        const reason = typeof obj.error === 'string' && obj.error.trim() ? obj.error.trim() : 'unknown'
        const status = Number.isFinite(obj.error_status) ? ` (${obj.error_status})` : ''
        events.push(makeStatusEvent(`Claude retry ${attempt}/${maxRetries}: ${reason}${status}`))
      } else if (typeof obj.subtype === 'string') {
        events.push(makeStatusEvent(`Claude: ${obj.subtype}`))
      }
      break

    case 'assistant': {
      const content = obj.message?.content
      if (Array.isArray(content)) {
        for (const block of content) {
          if (!block || typeof block !== 'object') continue
          if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
            events.push(makeMessageEvent('assistant', block.text))
          } else if (block.type === 'thinking' && typeof block.thinking === 'string' && block.thinking.trim()) {
            events.push(makeReasoningEvent(block.thinking))
          } else if (block.type === 'tool_use') {
            const input = typeof block.input === 'string'
              ? block.input
              : JSON.stringify(block.input ?? {}, null, 2)
            events.push(makeToolUseEvent(`${block.name || 'tool'}\n${input}`.trim()))
          } else if (block.type === 'tool_result') {
            const output = normalizeTextBlockArray(block.content)
            events.push(makeToolResultEvent(output || JSON.stringify(block.content ?? '')))
          }
        }
      }
      break
    }

    case 'user': {
      const content = obj.message?.content
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block?.type !== 'tool_result') continue
          const output = normalizeTextBlockArray(block.content)
          events.push(makeToolResultEvent(output || JSON.stringify(block.content ?? '')))
        }
      }
      break
    }

    case 'result': {
      const usage = obj.usage ?? {}
      const inputTokens = Number.isFinite(usage.input_tokens) ? usage.input_tokens : null
      const cacheCreate = Number.isFinite(usage.cache_creation_input_tokens) ? usage.cache_creation_input_tokens : 0
      const cacheRead = Number.isFinite(usage.cache_read_input_tokens) ? usage.cache_read_input_tokens : 0
      const outputTokens = Number.isFinite(usage.output_tokens) ? usage.output_tokens : null
      if (inputTokens !== null || outputTokens !== null) {
        events.push(makeUsageEvent([
          inputTokens !== null ? `input ${inputTokens}` : null,
          outputTokens !== null ? `output ${outputTokens}` : null,
          cacheCreate || cacheRead ? `cache ${cacheCreate + cacheRead}` : null,
        ]))
      }
      if (obj.is_error === true) {
        const errorMessage =
          normalizeProviderError(obj.errors)
          || normalizeProviderError(obj.error)
          || normalizeProviderError(obj.result)
        if (errorMessage) {
          result.providerError = errorMessage
          events.push(makeStatusEvent(`Claude error: ${errorMessage}`))
        }
      }
      break
    }

    case 'stream_event': {
      const evt = obj.event
      if (
        evt?.type === 'content_block_delta'
        && evt.delta?.type === 'thinking_delta'
        && typeof evt.delta.thinking === 'string'
        && evt.delta.thinking.trim()
      ) {
        events.push(makeReasoningEvent(evt.delta.thinking))
      }
      break
    }

    default:
      break
  }

  return result
}

function parseCodexCompletedItem(item: Record<string, any>): ProviderEvent[] {
  const events: ProviderEvent[] = []

  switch (item.type) {
    case 'agent_message':
      if (typeof item.text === 'string' && item.text.trim()) {
        events.push(makeMessageEvent('assistant', item.text))
      }
      break

    case 'reasoning':
      if (typeof item.text === 'string' && item.text.trim()) {
        events.push(makeReasoningEvent(item.text))
      }
      break

    case 'command_execution': {
      const command = typeof item.command === 'string' ? item.command : ''
      if (command) {
        events.push(makeToolUseEvent(`bash\n${command}`))
      }
      const output = typeof item.aggregated_output === 'string' ? item.aggregated_output : ''
      if (output || item.status === 'failed') {
        events.push(makeToolResultEvent(output || `Command failed (${item.exit_code ?? 'unknown'})`))
      }
      break
    }

    case 'mcp_tool_call': {
      const toolName = [item.server, item.tool].filter(Boolean).join('/')
      const args = JSON.stringify(item.arguments ?? {}, null, 2)
      events.push(makeToolUseEvent(`${toolName || 'tool'}\n${args}`.trim()))
      if (item.error?.message) {
        events.push(makeToolResultEvent(`Error: ${item.error.message}`))
      } else if (item.result !== undefined) {
        events.push(makeToolResultEvent(JSON.stringify(item.result, null, 2)))
      }
      break
    }

    case 'file_change':
      if (Array.isArray(item.changes)) {
        for (const change of item.changes) {
          if (!change) continue
          const label = [change.path, change.kind].filter(Boolean).join(' · ')
          if (label) events.push(makeFileChangeEvent(label))
        }
      }
      break

    case 'web_search':
      if (typeof item.query === 'string' && item.query.trim()) {
        events.push(makeToolUseEvent(`web_search\n${item.query}`))
      }
      break

    case 'todo_list':
      if (Array.isArray(item.items) && item.items.length > 0) {
        const text = item.items
          .map((entry) => `${entry.completed ? '[x]' : '[ ]'} ${entry.text ?? ''}`.trim())
          .join('\n')
        if (text) events.push(makeMessageEvent('assistant', text))
      }
      break

    case 'error':
      if (typeof item.message === 'string' && item.message.trim()) {
        events.push(makeStatusEvent(`Codex error: ${item.message}`))
      }
      break

    default:
      break
  }

  return events
}

function parseCodexLine(line: string): ProviderParseResult {
  const parsed = safeJsonParse(line)
  if (!parsed || typeof parsed !== 'object') return { events: [] }

  const obj = parsed as Record<string, any>
  switch (obj.type) {
    case 'thread.started':
      return {
        events: [makeStatusEvent(`Codex thread started (${obj.thread_id || 'unknown'})`)],
        codexThreadId: typeof obj.thread_id === 'string' && obj.thread_id.trim()
          ? obj.thread_id.trim()
          : undefined,
      }
    case 'turn.completed': {
      const usage = obj.usage ?? {}
      const inputTokens = Number.isFinite(usage.input_tokens) ? usage.input_tokens : null
      const cachedTokens = Number.isFinite(usage.cached_input_tokens) ? usage.cached_input_tokens : null
      const outputTokens = Number.isFinite(usage.output_tokens) ? usage.output_tokens : null
      return {
        events: [
          makeUsageEvent([
            inputTokens !== null ? `input ${inputTokens}` : null,
            cachedTokens !== null ? `cached ${cachedTokens}` : null,
            outputTokens !== null ? `output ${outputTokens}` : null,
          ]),
        ],
      }
    }
    case 'turn.failed':
      return {
        events: [makeStatusEvent(`Codex error: ${obj.error?.message || 'unknown error'}`)],
        providerError: normalizeProviderError(obj.error?.message) || 'unknown error',
      }
    case 'item.completed':
      return {
        events: obj.item && typeof obj.item === 'object'
          ? parseCodexCompletedItem(obj.item)
          : [],
      }
    case 'error':
      return {
        events: [makeStatusEvent(`Codex error: ${obj.message || 'unknown error'}`)],
        providerError: normalizeProviderError(obj.message) || 'unknown error',
      }
    default:
      return { events: [] }
  }
}

function parseProviderLine(tool: ToolName, line: string): ProviderParseResult {
  return tool === 'claude' ? parseClaudeLine(line) : parseCodexLine(line)
}

function resolveToolPreference(tool?: string, model?: string): ToolName {
  const normalizedTool = tool?.trim().toLowerCase()
  if (normalizedTool === 'claude') return 'claude'
  if (normalizedTool === 'codex') return 'codex'
  if (typeof model === 'string' && model.toLowerCase().includes('claude')) return 'claude'
  return 'codex'
}

function resolveModel(tool: ToolName, model?: string): string {
  const trimmed = model?.trim()
  if (trimmed) return trimmed
  return DEFAULT_MODELS[tool] ?? ''
}

function hasSubmittedPreference<K extends keyof SubmitSessionMessageInput>(
  input: SubmitSessionMessageInput,
  key: K,
): boolean {
  return input[key] !== undefined
}

function buildSessionPreferencePatch(
  sessionId: string,
  input: SubmitSessionMessageInput,
): UpdateSessionInput {
  const session = getSession(sessionId)
  if (!session) return {}

  const patch: UpdateSessionInput = {}

  if (hasSubmittedPreference(input, 'model')) {
    patch.model = input.model ?? null
  }
  if (hasSubmittedPreference(input, 'effort')) {
    patch.effort = input.effort ?? null
  }
  if (hasSubmittedPreference(input, 'thinking')) {
    patch.thinking = input.thinking === true
  }
  if (hasSubmittedPreference(input, 'tool') || hasSubmittedPreference(input, 'model')) {
    patch.tool = resolveToolPreference(
      hasSubmittedPreference(input, 'tool') ? input.tool : session.tool,
      hasSubmittedPreference(input, 'model') ? input.model ?? undefined : session.model,
    )
  }

  return patch
}

function persistSubmittedPreferences(sessionId: string, input: SubmitSessionMessageInput): void {
  const patch = buildSessionPreferencePatch(sessionId, input)
  if (Object.keys(patch).length === 0) return
  updateSession(sessionId, patch)
}

function snapshotSessionPreferences(sessionId: string): RuntimePreferences {
  const session = getSession(sessionId)
  if (!session) {
    return {
      tool: DEFAULT_TOOL,
      model: null,
      effort: null,
      thinking: false,
    }
  }

  return {
    tool: resolveToolPreference(session.tool, session.model),
    model: session.model ?? null,
    effort: session.effort ?? null,
    thinking: session.thinking === true,
  }
}

function resolveRunPreferences(
  sessionId: string,
  preferences?: RuntimePreferences,
): Required<RuntimePreferences> {
  const session = getSession(sessionId)
  if (!session) {
    return {
      tool: DEFAULT_TOOL,
      model: null,
      effort: null,
      thinking: false,
    }
  }

  const tool = resolveToolPreference(preferences?.tool ?? session.tool, preferences?.model ?? session.model ?? undefined)
  return {
    tool,
    model: preferences?.model ?? session.model ?? null,
    effort: tool === 'codex' ? (preferences?.effort ?? session.effort ?? null) : null,
    thinking: tool === 'claude' ? (preferences?.thinking ?? (session.thinking === true)) : false,
  }
}

function resolveToolCommand(tool: ToolName): string {
  if (tool === 'claude') {
    return process.env['PLUSE_CLAUDE_COMMAND']?.trim() || process.env['PULSE_CLAUDE_COMMAND']?.trim() || process.env['MELODYSYNC_CLAUDE_COMMAND']?.trim() || 'claude'
  }
  return process.env['PLUSE_CODEX_COMMAND']?.trim() || process.env['PULSE_CODEX_COMMAND']?.trim() || process.env['MELODYSYNC_CODEX_COMMAND']?.trim() || 'codex'
}

function validateProjectWorkingDirectory(projectPath: string): string | null {
  try {
    const stats = statSync(projectPath)
    if (!stats.isDirectory()) {
      return `project path is not a directory: ${projectPath}`
    }
    return null
  } catch {
    return `project path does not exist: ${projectPath}`
  }
}

function getSessionSystemPrompt(projectId: string, sessionId: string): string | undefined {
  const project = getProject(projectId)
  if (!project) return undefined
  return buildSessionSystemPrompt(project, sessionId)
}

function resolveSpawnFailureMessage(
  error: Error & { code?: string },
  tool: ToolName,
  command: string,
): string {
  if (error.code === 'ENOENT') {
    return `${tool} command not found: ${command}`
  }
  return error.message
}

function buildCodexArgs(prompt: string, options: {
  model?: string
  effort?: string
  systemPrompt?: string
  threadId?: string
}): string[] {
  const args = [
    'exec',
    '--json',
    '--dangerously-bypass-approvals-and-sandbox',
    '--skip-git-repo-check',
  ]

  if (options.model) {
    args.push('-m', options.model)
  }
  if (options.effort) {
    args.push('-c', `model_reasoning_effort=${JSON.stringify(options.effort)}`)
  }

  const fullPrompt = options.systemPrompt?.trim()
    ? `Project instructions:\n${options.systemPrompt.trim()}\n\n${prompt}`
    : prompt

  if (options.threadId?.trim()) {
    args.push('resume', options.threadId.trim(), fullPrompt)
  } else {
    args.push(fullPrompt)
  }
  return args
}

function buildClaudeArgs(prompt: string, options: {
  model?: string
  thinking?: boolean
  systemPrompt?: string
  resumeSessionId?: string
}): string[] {
  const args = [
    '-p',
    prompt,
    '--output-format',
    'stream-json',
    '--verbose',
    '--dangerously-skip-permissions',
  ]

  if (options.model) {
    args.push('--model', options.model)
  }
  if (options.thinking) {
    args.push('--effort', 'high')
  }
  if (options.systemPrompt?.trim()) {
    args.push('--system-prompt', options.systemPrompt.trim())
  }
  if (options.resumeSessionId?.trim()) {
    args.push('--resume', options.resumeSessionId.trim())
  }

  return args
}

function buildPrompt(sessionId: string, recordedText: string, opts: { nativeResume: boolean }): string {
  if (opts.nativeResume) {
    return recordedText
  }

  const conversation = listEvents(sessionId)
    .filter((event) => event.type === 'message' && (event.role === 'user' || event.role === 'assistant'))
    .slice(-40)
    .map((event) => `${event.role === 'assistant' ? 'Assistant' : 'User'}:\n${event.content ?? ''}`)
    .join('\n\n')

  return [
    'You are continuing an existing Pluse conversation.',
    'Use the prior messages as context and reply only to the latest user message.',
    conversation,
  ].join('\n\n')
}

function labelForMime(mimeType: string): string {
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/')) return 'video'
  return 'file'
}

// Text recorded in session_events (shown to user — no local paths)
function buildRecordedUserText(input: SubmitSessionMessageInput): string {
  const base = input.text.trim()
  const attachmentLines = (input.attachments ?? [])
    .map((a) => `[User attached ${labelForMime(a.mimeType)}: ${a.filename}]`)
  if (attachmentLines.length === 0) return base
  return `${attachmentLines.join('\n')}\n\n${base}`.trim()
}

// Prompt sent to AI — includes local savedPath so AI can read the file
function buildAiPromptText(input: SubmitSessionMessageInput): string {
  const base = input.text.trim()
  const attachmentLines = (input.attachments ?? [])
    .map((a) => `[User attached ${labelForMime(a.mimeType)}: ${a.filename} -> ${a.savedPath}]`)
  if (attachmentLines.length === 0) return base
  return `${attachmentLines.join('\n')}\n\n${base}`.trim()
}

function appendProviderEvents(sessionId: string, events: ProviderEvent[]): void {
  for (const event of events) {
    if (
      event.type !== 'message'
      && event.type !== 'reasoning'
      && event.type !== 'tool_use'
      && event.type !== 'tool_result'
      && event.type !== 'status'
      && event.type !== 'file_change'
      && event.type !== 'usage'
    ) {
      continue
    }
    appendEvent(sessionId, event)
  }
}

function persistResumeIds(sessionId: string, runId: string, ids: {
  claudeSessionId?: string
  codexThreadId?: string
}): void {
  const session = getSession(sessionId)
  const run = getRun(runId)
  if (!session || !run) return

  const sessionPatch: UpdateSessionInput = {}
  const runPatch: Partial<Run> = {}

  if (ids.claudeSessionId && session.claudeSessionId !== ids.claudeSessionId) {
    sessionPatch['claudeSessionId'] = ids.claudeSessionId
  }
  if (ids.codexThreadId && session.codexThreadId !== ids.codexThreadId) {
    sessionPatch['codexThreadId'] = ids.codexThreadId
  }
  if (ids.claudeSessionId && run.claudeSessionId !== ids.claudeSessionId) {
    runPatch['claudeSessionId'] = ids.claudeSessionId
  }
  if (ids.codexThreadId && run.codexThreadId !== ids.codexThreadId) {
    runPatch['codexThreadId'] = ids.codexThreadId
  }

  if (Object.keys(sessionPatch).length > 0) {
    updateSession(sessionId, sessionPatch)
  }
  if (Object.keys(runPatch).length > 0) {
    updateRun(runId, runPatch)
  }
}

function wireLineStream(
  stream: NodeJS.ReadableStream | null,
  onLine: (line: string) => void,
): void {
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

function clearRunnerTimers(handle: ActiveRunner): void {
  if (handle.timeoutId) clearTimeout(handle.timeoutId)
  if (handle.killGraceId) clearTimeout(handle.killGraceId)
}

function requestTermination(runId: string, reason: 'cancelled' | 'timeout'): void {
  const handle = activeRunners.get(runId)
  if (!handle) return

  handle.reason = reason
  if (!handle.child.killed) {
    handle.child.kill('SIGTERM')
  }
  if (!handle.killGraceId) {
    handle.killGraceId = setTimeout(() => {
      if (!handle.child.killed) {
        handle.child.kill('SIGKILL')
      }
    }, RUN_KILL_GRACE_MS)
  }
}

function finalizeRun(runId: string, patch: Partial<Run>, sessionId: string): void {
  const existing = getRun(runId)
  if (!existing) return

  updateRun(runId, {
    ...patch,
    completedAt: existing.completedAt ?? nowIso(),
    finalizedAt: nowIso(),
  })

  const session = getSession(sessionId)
  if (session?.activeRunId === runId) {
    updateSession(sessionId, { activeRunId: null })
  }

  // autoRenamePending: 首轮 Run 完成后触发 AI 命名
  if (patch.state === 'completed' && session?.autoRenamePending) {
    const runCount = getRunsBySession(sessionId).length
    if (runCount === 1) {
      queueMicrotask(() => void autoRenameSession(sessionId))
    }
  }

  const next = dequeueFollowUp(sessionId)
  if (next) {
    startRunForSession(sessionId, next.requestId, next.text, {
      tool: next.tool,
      model: next.model,
      effort: next.effort,
      thinking: next.thinking,
    })
  }
}

async function autoRenameSession(sessionId: string): Promise<void> {
  const session = getSession(sessionId)
  if (!session?.autoRenamePending) return

  const events = listEvents(sessionId)
  const messages = events
    .filter((e) => e.type === 'message')
    .slice(0, 6)
    .map((e) => `${e.role === 'user' ? 'User' : 'Assistant'}: ${(e.content ?? e.bodyPreview ?? '').slice(0, 300)}`)
    .join('\n')

  if (!messages) return

  const tool = (session.tool ?? DEFAULT_TOOL) as ToolName
  const command = resolveToolCommand(tool)
  const prompt = `Based on this conversation, generate a concise title (5-10 words, in the same language as the conversation). Reply with ONLY the title, no quotes or punctuation:\n\n${messages}`

  try {
    const args = tool === 'claude'
      ? ['-p', prompt, '--output-format', 'text']
      : ['exec', '--dangerously-bypass-approvals-and-sandbox', '--skip-git-repo-check', prompt]

    const result = await new Promise<string>((resolve, reject) => {
      const proc = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
      const chunks: Buffer[] = []
      proc.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
      proc.on('close', (code) => {
        if (code === 0) resolve(Buffer.concat(chunks).toString().trim())
        else reject(new Error(`exit ${code}`))
      })
      proc.on('error', reject)
      setTimeout(() => { proc.kill(); reject(new Error('timeout')) }, 30_000)
    })

    const name = result.split('\n')[0]?.trim().slice(0, 100)
    if (name) {
      updateSession(sessionId, { name, autoRenamePending: false })
    }
  } catch {
    // 命名失败不重试，保留默认名称
    updateSession(sessionId, { autoRenamePending: false })
  }
}

function startRunForSession(
  sessionId: string,
  requestId: string,
  recordedText: string,
  preferences?: RuntimePreferences,
): Run {
  const session = getSession(sessionId)
  if (!session) throw new Error(`Session not found: ${sessionId}`)

  const runtimePreferences = resolveRunPreferences(sessionId, preferences)
  const tool = runtimePreferences.tool as ToolName
  const run = createRun({
    sessionId,
    requestId,
    tool,
    model: resolveModel(tool, runtimePreferences.model ?? undefined),
    effort: runtimePreferences.effort ?? undefined,
    thinking: runtimePreferences.thinking,
    claudeSessionId: tool === 'claude' ? session.claudeSessionId : undefined,
    codexThreadId: tool === 'codex' ? session.codexThreadId : undefined,
  })

  updateSession(sessionId, { activeRunId: run.id, tool })
  queueMicrotask(() => {
    void executeRun(run.id, sessionId, recordedText)
  })
  return run
}

async function executeRun(runId: string, sessionId: string, recordedText: string): Promise<void> {
  const session = getSession(sessionId)
  const run = getRun(runId)
  if (!session || !run) return

  const project = getProject(session.projectId)
  if (!project) {
    appendProviderEvents(sessionId, [makeStatusEvent(`error: project not found for session ${sessionId}`)])
    finalizeRun(runId, {
      state: 'failed',
      result: 'error',
      failureReason: 'project_not_found',
    }, sessionId)
    return
  }

  const workingDirectoryError = validateProjectWorkingDirectory(project.workDir)
  if (workingDirectoryError) {
    appendProviderEvents(sessionId, [makeStatusEvent(`error: ${workingDirectoryError}`)])
    finalizeRun(runId, {
      state: 'failed',
      result: 'error',
      failureReason: workingDirectoryError,
    }, sessionId)
    return
  }

  if (run.cancelRequested) {
    appendProviderEvents(sessionId, [makeStatusEvent('cancelled')])
    finalizeRun(runId, {
      state: 'cancelled',
      result: 'cancelled',
      failureReason: 'cancelled',
    }, sessionId)
    return
  }

  const tool = resolveToolPreference(run.tool, run.model)
  const nativeResume = tool === 'claude'
    ? Boolean(run.claudeSessionId)
    : Boolean(run.codexThreadId)
  const prompt = buildPrompt(sessionId, recordedText, { nativeResume })
  const command = resolveToolCommand(tool)
  const args = tool === 'claude'
    ? buildClaudeArgs(prompt, {
      model: run.model || undefined,
      thinking: run.thinking,
      systemPrompt: getSessionSystemPrompt(project.id, sessionId),
      resumeSessionId: run.claudeSessionId,
    })
    : buildCodexArgs(prompt, {
      model: run.model || undefined,
      effort: run.effort,
      systemPrompt: getSessionSystemPrompt(project.id, sessionId),
      threadId: run.codexThreadId,
    })

  const stderrLines: string[] = []
  let lastProviderError: string | undefined
  let finalized = false

  try {
    const child = spawn(command, args, {
      cwd: project.workDir,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const handle: ActiveRunner = { child }
    activeRunners.set(runId, handle)

    updateRun(runId, {
      state: 'running',
      startedAt: nowIso(),
      runnerProcessId: child.pid ?? undefined,
    })
    appendProviderEvents(sessionId, [makeStatusEvent(`Running with ${tool}${nativeResume ? ' (resume)' : ''}`)])

    wireLineStream(child.stdout, (line) => {
      const parsed = parseProviderLine(tool, line)
      if (parsed.providerError) {
        lastProviderError = parsed.providerError
      }
      persistResumeIds(sessionId, runId, {
        claudeSessionId: parsed.claudeSessionId,
        codexThreadId: parsed.codexThreadId,
      })
      appendProviderEvents(sessionId, parsed.events)
    })

    wireLineStream(child.stderr, (line) => {
      stderrLines.push(line)
    })

    handle.timeoutId = setTimeout(() => {
      appendProviderEvents(sessionId, [makeStatusEvent(`error: ${tool} run timed out`)]);
      requestTermination(runId, 'timeout')
    }, RUN_TIMEOUT_MS)

    child.once('error', (error) => {
      if (finalized) return
      finalized = true
      clearRunnerTimers(handle)
      activeRunners.delete(runId)
      const message = resolveSpawnFailureMessage(error, tool, command)
      appendProviderEvents(sessionId, [makeStatusEvent(`error: ${message}`)])
      finalizeRun(runId, {
        state: 'failed',
        result: 'error',
        failureReason: message,
      }, sessionId)
    })

    child.once('close', (code, signal) => {
      if (finalized) return
      finalized = true
      clearRunnerTimers(handle)
      activeRunners.delete(runId)

      const terminalReason = handle.reason
      if (terminalReason === 'cancelled') {
        appendProviderEvents(sessionId, [makeStatusEvent('cancelled')])
        finalizeRun(runId, {
          state: 'cancelled',
          result: 'cancelled',
          failureReason: 'cancelled',
        }, sessionId)
        return
      }

      if (terminalReason === 'timeout') {
        finalizeRun(runId, {
          state: 'failed',
          result: 'error',
          failureReason: 'timeout',
        }, sessionId)
        return
      }

      if (signal || code !== 0) {
        const failureReason = lastProviderError || stderrLines.at(-1)?.trim() || `process exited with code ${code ?? 'unknown'}`
        appendProviderEvents(sessionId, [makeStatusEvent(`error: ${failureReason}`)])
        finalizeRun(runId, {
          state: 'failed',
          result: 'error',
          failureReason,
        }, sessionId)
        return
      }

      if (lastProviderError) {
        appendProviderEvents(sessionId, [makeStatusEvent(`error: ${lastProviderError}`)])
        finalizeRun(runId, {
          state: 'failed',
          result: 'error',
          failureReason: lastProviderError,
        }, sessionId)
        return
      }

      finalizeRun(runId, {
        state: 'completed',
        result: 'success',
      }, sessionId)
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    appendProviderEvents(sessionId, [makeStatusEvent(`error: ${message}`)])
    finalizeRun(runId, {
      state: 'failed',
      result: 'error',
      failureReason: message,
    }, sessionId)
  }
}

export function submitSessionMessage(input: SubmitSessionMessageInput): SubmitSessionMessageResult {
  const initialSession = getSession(input.sessionId)
  if (!initialSession) throw new Error(`Session not found: ${input.sessionId}`)

  persistSubmittedPreferences(input.sessionId, input)
  const session = getSession(input.sessionId)
  if (!session) throw new Error(`Session not found: ${input.sessionId}`)

  const requestId = input.requestId?.trim() || genRequestId()
  const recordedText = buildRecordedUserText(input)
  const aiPromptText = buildAiPromptText(input)
  const runtimePreferences = snapshotSessionPreferences(input.sessionId)

  appendEvent(input.sessionId, makeMessageEvent('user', recordedText))

  if (session.activeRunId) {
    enqueueFollowUp(input.sessionId, {
      requestId,
      text: aiPromptText,
      tool: runtimePreferences.tool,
      model: runtimePreferences.model,
      effort: runtimePreferences.effort,
      thinking: runtimePreferences.thinking,
    })
    return {
      queued: true,
      run: null,
      session: getSession(input.sessionId),
    }
  }

  const run = startRunForSession(input.sessionId, requestId, aiPromptText, runtimePreferences)
  return {
    queued: false,
    run,
    session: getSession(input.sessionId),
  }
}

export function cancelActiveRun(runId: string): Run {
  const run = updateRun(runId, { cancelRequested: true })
  requestTermination(runId, 'cancelled')
  return run
}

// server 启动时恢复未消费的 followUpQueue
export function recoverFollowUpQueues(): void {
  const sessions = listSessionsWithPendingQueue()
  for (const session of sessions) {
    if (session.activeRunId) continue  // 已有运行中的 run，跳过
    const next = dequeueFollowUp(session.id)
    if (!next) continue
    try {
      startRunForSession(session.id, next.requestId, next.text, {
        tool: next.tool,
        model: next.model,
        effort: next.effort,
        thinking: next.thinking,
      })
    } catch {
      // 单个 session 恢复失败不影响其他 session
    }
  }
}

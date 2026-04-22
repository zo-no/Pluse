import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Quest } from '@pluse/types'
import { listEvents } from '../models/history'
import { getQuest } from '../models/quest'
import { getProject } from '../models/project'
import { getSessionCategory } from '../models/session-category'
import { getManagedCodexHome } from '../support/paths'
import { getRuntimeModelCatalog, normalizeClaudeModelId, normalizeCodexModelId } from '../runtime/catalog'
import { createOrReuseSessionCategory, listSessionCategoryViews } from './session-categories'
import { updateQuestWithEffects } from './quests'

type ToolName = 'codex' | 'claude'

type ClassificationDecision =
  | { mode: 'noop' }
  | { mode: 'assign'; sessionCategoryId: string }
  | { mode: 'create_or_reuse'; name: string; description?: string }
  | { mode: 'clear' }

const CODEX_AUTH_FILENAME = 'auth.json'
const SESSION_CLASSIFY_TIMEOUT_MS = parsePositiveInt(
  process.env['PLUSE_SESSION_CLASSIFY_TIMEOUT_MS'] ?? process.env['PULSE_SESSION_CLASSIFY_TIMEOUT_MS'],
  30_000,
)
const FALLBACK_CATEGORY_NAME = '临时探索'
const FALLBACK_CATEGORY_DESCRIPTION = '首轮会话完成后暂未匹配到稳定主题的会话。'
const SESSION_CLASSIFY_SYSTEM_PROMPT = [
  'You classify Pluse session quests into reusable project-scoped categories.',
  'Return JSON only.',
  'Prefer reusing an existing category when it is clearly compatible.',
  'For any normal first-round conversation, you must return either assign or create_or_reuse.',
  `If the topic is broad, temporary, or unclear, classify it into a broad holding category such as ${FALLBACK_CATEGORY_NAME} instead of noop.`,
  'Use {"mode":"noop"} only when there is no usable user message to classify.',
  'Allowed JSON shapes:',
  '{"mode":"noop"}',
  '{"mode":"assign","sessionCategoryId":"sc_xxx"}',
  '{"mode":"create_or_reuse","name":"...","description":"..."}',
  '{"mode":"clear"}',
].join('\n')

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
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
      // Let Codex surface auth errors on its own.
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

function buildClaudeArgs(prompt: string, options: { model?: string }): string[] {
  const args = ['--print', prompt, '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions']
  if (options.model) args.push('--model', options.model)
  args.push('--effort', 'low')
  args.push('--system-prompt', SESSION_CLASSIFY_SYSTEM_PROMPT)
  return args
}

function buildCodexArgs(prompt: string, options: { model?: string }): string[] {
  const args = ['exec', '--json', '--dangerously-bypass-approvals-and-sandbox', '--skip-git-repo-check']
  if (options.model) args.push('-m', options.model)
  args.push('-c', `model_reasoning_effort=${JSON.stringify('low')}`)
  args.push(`Project instructions:\n${SESSION_CLASSIFY_SYSTEM_PROMPT}\n\n${prompt}`)
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

function parseClaudeAssistantText(line: string): { assistantText?: string; providerError?: string } {
  const obj = safeJsonParse(line)
  if (!obj) return {}

  if (obj.type === 'assistant' && obj.message && typeof obj.message === 'object') {
    const content = (obj.message as Record<string, unknown>).content
    if (Array.isArray(content)) {
      for (const block of content) {
        if (!block || typeof block !== 'object') continue
        const entry = block as Record<string, unknown>
        if (entry.type === 'text' && typeof entry.text === 'string' && entry.text.trim()) {
          return { assistantText: entry.text }
        }
      }
    }
  }

  if (obj.type === 'result') {
    return { providerError: normalizeProviderError(obj.error) }
  }

  if (obj.type === 'error') {
    return { providerError: normalizeProviderError(obj.error ?? obj.message) }
  }

  return {}
}

function parseCodexAssistantText(line: string): { assistantText?: string; providerError?: string } {
  const obj = safeJsonParse(line)
  if (!obj) return {}

  if (obj.type === 'message' && obj.role === 'assistant' && typeof obj.content === 'string' && obj.content.trim()) {
    return { assistantText: obj.content }
  }

  if (obj.type === 'item.completed' && obj.item && typeof obj.item === 'object') {
    const item = obj.item as Record<string, unknown>
    if (item.type === 'agent_message' && typeof item.text === 'string' && item.text.trim()) {
      return { assistantText: item.text }
    }
    if (item.type === 'tool_result') {
      const output = normalizeText(item.output)
      if (output.trim()) return { assistantText: output }
    }
  }

  if (obj.type === 'error') {
    return { providerError: normalizeProviderError(obj.error ?? obj.message) }
  }

  return {}
}

function extractJsonText(value: string): string {
  const trimmed = value.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (fenced?.[1]) return fenced[1].trim()
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1)
  return trimmed
}

function normalizeDecision(value: string): ClassificationDecision | null {
  const parsed = safeJsonParse(extractJsonText(value))
  if (!parsed) return null

  const mode = typeof parsed.mode === 'string' ? parsed.mode.trim() : ''
  if (mode === 'noop') return { mode: 'noop' }
  if (mode === 'clear') return { mode: 'clear' }
  if (mode === 'assign' && typeof parsed.sessionCategoryId === 'string' && parsed.sessionCategoryId.trim()) {
    return { mode: 'assign', sessionCategoryId: parsed.sessionCategoryId.trim() }
  }
  if (mode === 'create_or_reuse' && typeof parsed.name === 'string' && parsed.name.trim()) {
    return {
      mode: 'create_or_reuse',
      name: parsed.name.trim(),
      description: typeof parsed.description === 'string' && parsed.description.trim() ? parsed.description.trim() : undefined,
    }
  }
  return null
}

function buildClassificationTranscript(questId: string): string | null {
  const messages = listEvents(questId)
    .filter((event) =>
      event.type === 'message'
      && (event.role === 'user' || event.role === 'assistant')
      && event.content?.trim())
    .slice(0, 8)

  if (messages.length === 0) return null

  return messages
    .map((event) => `${event.role === 'assistant' ? 'Assistant' : 'User'}:\n${event.content?.trim() ?? ''}`)
    .join('\n\n')
}

function buildClassificationPrompt(quest: Quest): string | null {
  const categories = listSessionCategoryViews(quest.projectId).map((category) => ({
    id: category.id,
    name: category.name,
    description: category.description ?? '',
  }))
  const transcript = buildClassificationTranscript(quest.id)
  if (!transcript) return null

  return [
    'Classify this Pluse session into an existing or new reusable project category.',
    `Quest id: ${quest.id}`,
    `Quest name: ${quest.name ?? ''}`,
    'Existing categories:',
    JSON.stringify(categories, null, 2),
    'First-round transcript:',
    transcript,
    [
      'Return JSON only.',
      'Prefer assign when an existing category fits.',
      'For normal conversations you must return assign or create_or_reuse.',
      `If the topic is ambiguous or temporary, use create_or_reuse with a broad holding category such as ${FALLBACK_CATEGORY_NAME}.`,
      'Only return {"mode":"noop"} when there is no usable user message to classify.',
    ].join('\n'),
  ].join('\n\n')
}

function assignFallbackCategory(quest: Quest, allowCreateSessionCategory: boolean): void {
  if (!allowCreateSessionCategory) return
  const category = createOrReuseSessionCategory(quest.projectId, {
    name: FALLBACK_CATEGORY_NAME,
    description: FALLBACK_CATEGORY_DESCRIPTION,
  })
  updateQuestWithEffects(quest.id, { sessionCategoryId: category.id })
}

async function classifySessionWithProvider(quest: Quest): Promise<ClassificationDecision | null> {
  const project = getProject(quest.projectId)
  if (!project) return null

  const workingDirectoryError = validateProjectWorkingDirectory(project.workDir)
  if (workingDirectoryError) return null

  const prompt = buildClassificationPrompt(quest)
  if (!prompt) return null

  const tool = resolveTool(quest.tool)
  const model = resolveModel(tool, quest.model)
  const command = resolveToolCommand(tool)
  const args = tool === 'claude'
    ? buildClaudeArgs(prompt, { model })
    : buildCodexArgs(prompt, { model })

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
      }, 15_000)
    }, SESSION_CLASSIFY_TIMEOUT_MS)

    wireLineStream(child.stdout, (line) => {
      const parsed = tool === 'claude' ? parseClaudeAssistantText(line) : parseCodexAssistantText(line)
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
        console.warn('[session-classifier] provider failed:', failureReason)
        resolve(null)
        return
      }
      resolve(lastAssistantText ? normalizeDecision(lastAssistantText) : null)
    })
  })
}

async function classifySessionQuest(questId: string, allowCreateSessionCategory: boolean): Promise<void> {
  const quest = getQuest(questId)
  if (!quest || quest.kind !== 'session' || quest.sessionCategoryId) return

  const decision = await classifySessionWithProvider(quest)
  const freshQuest = getQuest(questId)
  if (!freshQuest || freshQuest.projectId !== quest.projectId || freshQuest.kind !== 'session' || freshQuest.sessionCategoryId) {
    return
  }

  if (!decision || decision.mode === 'noop') {
    assignFallbackCategory(freshQuest, allowCreateSessionCategory)
    return
  }

  if (decision.mode === 'assign') {
    const category = getSessionCategory(decision.sessionCategoryId)
    if (!category || category.projectId !== freshQuest.projectId) {
      assignFallbackCategory(freshQuest, allowCreateSessionCategory)
      return
    }
    updateQuestWithEffects(freshQuest.id, { sessionCategoryId: category.id })
    return
  }

  if (decision.mode === 'create_or_reuse') {
    if (!allowCreateSessionCategory) {
      assignFallbackCategory(freshQuest, allowCreateSessionCategory)
      return
    }
    const category = createOrReuseSessionCategory(freshQuest.projectId, {
      name: decision.name,
      description: decision.description,
    })
    updateQuestWithEffects(freshQuest.id, { sessionCategoryId: category.id })
    return
  }

  if (decision.mode === 'clear') {
    assignFallbackCategory(freshQuest, allowCreateSessionCategory)
  }
}

export function runSessionClassificationInBackground(input: {
  questId: string
  allowCreateSessionCategory?: boolean
}): void {
  void classifySessionQuest(input.questId, input.allowCreateSessionCategory !== false).catch((error) => {
    console.warn(
      '[session-classifier] classification failed:',
      error instanceof Error ? error.message : String(error),
    )
  })
}

import { spawn } from 'node:child_process'
import { statSync } from 'node:fs'
import type { Quest } from '@pluse/types'
import { listEvents } from '../models/history'
import { getQuest } from '../models/quest'
import { getProject } from '../models/project'
import { getSessionCategory } from '../models/session-category'
import { syncManagedCodexHome } from '../support/codex-home'
import { getRuntimeModelCatalog, normalizeClaudeModelId, normalizeCodexModelId } from '../runtime/catalog'
import {
  isRuntimeCommandAvailable,
  resolveRuntimeCommandSpec,
  resolveRuntimeToolFamily,
  type RuntimeToolName,
} from '../runtime/command'
import { createOrReuseSessionCategory, listSessionCategoryViews } from './session-categories'
import { updateQuestWithEffects } from './quests'

type ToolFamily = 'claude' | 'codex' | 'gemini'

type ClassificationDecision =
  | { mode: 'noop' }
  | { mode: 'assign'; sessionCategoryId: string }
  | { mode: 'create_or_reuse'; name: string; description?: string }
  | { mode: 'clear' }

const SESSION_CLASSIFY_TIMEOUT_MS = parsePositiveInt(
  process.env['PLUSE_SESSION_CLASSIFY_TIMEOUT_MS'],
  30_000,
)
const FALLBACK_CATEGORY_NAME = '临时探索'
const FALLBACK_CATEGORY_DESCRIPTION = '首轮会话完成后暂未匹配到稳定主题的会话。'
const SESSION_CLASSIFY_SYSTEM_PROMPT = [
  '你负责将 Pluse 会话归入可复用的项目级分类。',
  '只返回 JSON，不要任何解释。',
  '优先复用已有分类（当内容明确兼容时）。',
  '对任何正常的首轮会话，必须返回 assign 或 create_or_reuse。',
  `话题宽泛、临时或不明确时，归入"${FALLBACK_CATEGORY_NAME}"这样的兜底分类，而不是返回 noop。`,
  '只有在没有可用用户消息时才返回 {"mode":"noop"}。',
  '',
  '创建新分类时，name 要求：',
  '- 中文名词短语，4～8 字',
  '- 反映该类会话的核心主题，而非某次会话的具体内容',
  '- 示例："前端组件开发"、"数据库优化"、"产品需求分析"、"Bug 排查"',
  '',
  '允许的 JSON 格式：',
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

function resolveToolFamily(questTool?: string | null): ToolFamily {
  return resolveRuntimeToolFamily(questTool)
}

function resolveToolName(questTool?: string | null): RuntimeToolName {
  const normalized = questTool?.trim().toLowerCase()
  if (normalized === 'codex') return 'codex'
  if (normalized === 'gemini') return 'gemini'
  if (normalized === 'mc') return 'mc'
  // claude 及其他未知值都走 mc（默认的 claude proxy）
  return 'mc'
}

function resolveModel(family: ToolFamily, requested?: string | null): string {
  const next = requested?.trim()
  if (next) {
    if (family === 'codex') return normalizeCodexModelId(next)
    return normalizeClaudeModelId(next)
  }
  return getRuntimeModelCatalog(family === 'codex' ? 'codex' : 'claude').defaultModel
    ?? (family === 'codex' ? 'gpt-5.4' : 'sonnet')
}

function runtimeEnvForToolName(toolName: RuntimeToolName): NodeJS.ProcessEnv {
  if (toolName !== 'codex') return process.env
  return {
    ...process.env,
    CODEX_HOME: syncManagedCodexHome(),
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
    '将此 Pluse 会话归入现有或新建的项目级分类。',
    `Quest id: ${quest.id}`,
    `会话名称：${quest.name ?? ''}`,
    '现有分类：',
    JSON.stringify(categories, null, 2),
    '首轮对话记录：',
    transcript,
    [
      '只返回 JSON。',
      '有合适的已有分类时优先使用 assign。',
      '正常会话必须返回 assign 或 create_or_reuse。',
      `话题模糊或临时时，用 create_or_reuse 并将名称设为"${FALLBACK_CATEGORY_NAME}"这样的兜底分类。`,
      '没有可用用户消息时才返回 {"mode":"noop"}。',
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

  const toolName = resolveToolName(quest.tool)
  const family = resolveToolFamily(quest.tool)
  const commandSpec = resolveRuntimeCommandSpec(toolName)
  if (!isRuntimeCommandAvailable(commandSpec)) {
    console.warn('[session-classifier] tool not available:', toolName, commandSpec.display)
    return null
  }
  const model = resolveModel(family, quest.model)
  const extraArgs = family === 'codex'
    ? buildCodexArgs(prompt, { model })
    : buildClaudeArgs(prompt, { model })
  const args = [...commandSpec.args, ...extraArgs]

  return await new Promise((resolve) => {
    const child = spawn(commandSpec.file, args, {
      cwd: project.workDir,
      env: runtimeEnvForToolName(toolName),
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
      const parsed = family === 'codex' ? parseCodexAssistantText(line) : parseClaudeAssistantText(line)
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

  // 工具调用失败（null）：跳过，不写入任何分类
  if (!decision) return

  // AI 判断无内容可分类：走 fallback
  if (decision.mode === 'noop') {
    assignFallbackCategory(freshQuest, allowCreateSessionCategory)
    return
  }

  if (decision.mode === 'assign') {
    const category = getSessionCategory(decision.sessionCategoryId)
    if (!category || category.projectId !== freshQuest.projectId) {
      // AI 返回了不属于本项目的分类 ID，降级到 fallback
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
    // clear：明确清空分类，不归入临时探索
    updateQuestWithEffects(freshQuest.id, { sessionCategoryId: null })
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

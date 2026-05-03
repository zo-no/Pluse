import type { RuntimeModelCatalog, RuntimeTool } from '@pluse/types'

type CatalogModel = RuntimeModelCatalog['models'][number]

export const FALLBACK_RUNTIME_TOOLS: RuntimeTool[] = [
  { id: 'codex', name: 'Codex', command: 'codex', runtimeFamily: 'codex-json', builtin: true, available: true },
  { id: 'claude', name: 'Claude Code', command: 'claude', runtimeFamily: 'claude-stream-json', builtin: true, available: true },
  { id: 'gemini', name: 'Gemini CLI', command: 'gemini', runtimeFamily: 'gemini-stream-json', builtin: true, available: true },
  { id: 'mc', name: 'MC (--code)', command: 'mc --code', runtimeFamily: 'claude-stream-json', builtin: true, available: true },
]

export const DEFAULT_CODEX_MODEL_ID = 'gpt-5.4'
export const DEFAULT_CLAUDE_MODEL_ID = 'sonnet'
export const DEFAULT_GEMINI_MODEL_ID = 'gemini-3-flash-preview'

const FALLBACK_CODEX_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh']
const CODEX_MODEL_ALIASES: Record<string, string> = {
  '5.5': 'gpt-5.5',
  'codex5.5': 'gpt-5.5',
  'codex-5.5': 'gpt-5.5',
  '5.3-codex-spark': 'gpt-5.3-codex-spark',
  '5.3-codex': 'gpt-5.3-codex',
  '5.2-codex': 'gpt-5.2-codex',
  '5.1-codex-max': 'gpt-5.1-codex-max',
  '5.1-codex-mini': 'gpt-5.1-codex-mini',
}
const FALLBACK_CODEX_MODELS: CatalogModel[] = [
  { id: 'gpt-5.5', label: 'GPT-5.5', defaultEffort: 'medium', effortLevels: FALLBACK_CODEX_EFFORT_LEVELS },
  { id: 'gpt-5.4', label: 'GPT-5.4', defaultEffort: 'medium', effortLevels: FALLBACK_CODEX_EFFORT_LEVELS },
  { id: 'gpt-5.2-codex', label: 'GPT-5.2-Codex', defaultEffort: 'medium', effortLevels: FALLBACK_CODEX_EFFORT_LEVELS },
  { id: 'gpt-5.1-codex-max', label: 'GPT-5.1-Codex-Max', defaultEffort: 'medium', effortLevels: FALLBACK_CODEX_EFFORT_LEVELS },
  { id: 'gpt-5.4-mini', label: 'GPT-5.4-Mini', defaultEffort: 'medium', effortLevels: FALLBACK_CODEX_EFFORT_LEVELS },
  { id: 'gpt-5.3-codex', label: 'GPT-5.3-Codex', defaultEffort: 'medium', effortLevels: FALLBACK_CODEX_EFFORT_LEVELS },
  { id: 'gpt-5.3-codex-spark', label: 'GPT-5.3-Codex-Spark', defaultEffort: 'high', effortLevels: FALLBACK_CODEX_EFFORT_LEVELS },
  { id: 'gpt-5.2', label: 'GPT-5.2', defaultEffort: 'medium', effortLevels: FALLBACK_CODEX_EFFORT_LEVELS },
  { id: 'gpt-5.1-codex-mini', label: 'GPT-5.1-Codex-Mini', defaultEffort: 'medium', effortLevels: FALLBACK_CODEX_EFFORT_LEVELS },
]

const FALLBACK_CLAUDE_MODELS: RuntimeModelCatalog['models'] = [
  { id: 'sonnet', label: 'Sonnet 4.6' },
  { id: 'sonnet[1m]', label: 'Sonnet 4.6 (1M)' },
  { id: 'opus', label: 'Opus 4.7' },
  { id: 'opus[1m]', label: 'Opus 4.7 (1M)' },
  { id: 'haiku', label: 'Haiku 4.5' },
  { id: 'haiku[1m]', label: 'Haiku 4.5 (1M)' },
]

const FALLBACK_GEMINI_MODELS: RuntimeModelCatalog['models'] = [
  { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
  { id: 'gemini-2.0-pro', label: 'Gemini 2.0 Pro' },
  { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
  { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
]

export function isClaudeRuntimeTool(tool?: string | null): boolean {
  const normalized = tool?.trim().toLowerCase()
  return normalized === 'claude' || normalized === 'mc'
}

export function isGeminiRuntimeTool(tool?: string | null): boolean {
  return tool?.trim().toLowerCase() === 'gemini'
}

export function runtimeAgentForTool(tool?: string | null): 'claude' | 'codex' | 'gemini' {
  if (isClaudeRuntimeTool(tool)) return 'claude'
  if (isGeminiRuntimeTool(tool)) return 'gemini'
  return 'codex'
}

export function defaultRuntimeModelId(tool?: string | null): string {
  if (isClaudeRuntimeTool(tool)) return DEFAULT_CLAUDE_MODEL_ID
  if (isGeminiRuntimeTool(tool)) return DEFAULT_GEMINI_MODEL_ID
  return DEFAULT_CODEX_MODEL_ID
}

export function defaultRuntimeEffortId(tool?: string | null, catalog?: RuntimeModelCatalog | null): string {
  if (isClaudeRuntimeTool(tool)) return ''
  return catalog?.reasoning.kind === 'enum'
    ? (catalog.reasoning.default ?? catalog.effortLevels?.[0] ?? 'low')
    : catalog?.effortLevels?.[0] ?? 'low'
}

export function normalizeCodexModelId(value?: string | null): string {
  const trimmed = value?.trim().toLowerCase()
  if (!trimmed || trimmed === 'default') return DEFAULT_CODEX_MODEL_ID
  return CODEX_MODEL_ALIASES[trimmed] ?? trimmed
}

export function normalizeGeminiModelId(value?: string | null): string {
  const trimmed = value?.trim().toLowerCase()
  if (!trimmed || trimmed === 'default') return DEFAULT_GEMINI_MODEL_ID
  return trimmed
}

export function normalizeClaudeModelId(value?: string | null): string {
  const trimmed = value?.trim().toLowerCase()
  if (!trimmed || trimmed === 'default') return DEFAULT_CLAUDE_MODEL_ID

  if (trimmed === 'sonnet[1m]' || trimmed === 'claude-sonnet-4-6[1m]') return 'sonnet[1m]'
  if (trimmed === 'sonnet' || trimmed === 'claude-sonnet-4-6') return 'sonnet'

  if (trimmed === 'opus[1m]' || trimmed === 'claude-opus-4-6[1m]' || trimmed === 'claude-opus-4-7[1m]') return 'opus[1m]'
  if (trimmed === 'opus' || trimmed === 'claude-opus-4-6' || trimmed === 'claude-opus-4-7') return 'opus'

  if (
    trimmed === 'haiku[1m]'
    || trimmed === 'claude-haiku-4-5[1m]'
    || trimmed === 'claude-haiku-4-5-20251001[1m]'
  ) return 'haiku[1m]'
  if (trimmed === 'haiku' || trimmed === 'claude-haiku-4-5' || trimmed === 'claude-haiku-4-5-20251001') return 'haiku'

  return trimmed
}

export function resolveRuntimeModelSelection(tool?: string | null, model?: string | null, catalog?: RuntimeModelCatalog | null): string {
  const normalizedTool = tool?.trim().toLowerCase()
  const normalized = isClaudeRuntimeTool(normalizedTool)
    ? normalizeClaudeModelId(model)
    : isGeminiRuntimeTool(normalizedTool)
      ? normalizeGeminiModelId(model)
      : normalizeCodexModelId(model)

  if (catalog?.models.some((item) => item.id === normalized)) return normalized

  const catalogDefault = catalog?.defaultModel?.trim()
  if (catalog && catalogDefault && catalog.models.some((item) => item.id === catalogDefault)) return catalogDefault

  const fallback = defaultRuntimeModelId(normalizedTool)
  if (catalog?.models.some((item) => item.id === fallback)) return fallback

  return catalog?.models[0]?.id ?? fallback
}

export function resolveRuntimeEffortSelection(tool?: string | null, effort?: string | null, catalog?: RuntimeModelCatalog | null): string {
  if (isClaudeRuntimeTool(tool)) return effort?.trim() ?? ''

  const trimmed = effort?.trim()
  if (trimmed) return trimmed

  return defaultRuntimeEffortId(tool, catalog)
}

export function buildFallbackRuntimeModelCatalog(tool?: string | null): RuntimeModelCatalog {
  if (isClaudeRuntimeTool(tool)) {
    return {
      models: FALLBACK_CLAUDE_MODELS,
      effortLevels: null,
      defaultModel: DEFAULT_CLAUDE_MODEL_ID,
      reasoning: { kind: 'toggle', label: 'Thinking' },
    }
  }

  if (isGeminiRuntimeTool(tool)) {
    return {
      models: FALLBACK_GEMINI_MODELS,
      effortLevels: null,
      defaultModel: DEFAULT_GEMINI_MODEL_ID,
      reasoning: { kind: 'toggle', label: 'Thinking' },
    }
  }

  return {
    models: FALLBACK_CODEX_MODELS,
    effortLevels: FALLBACK_CODEX_EFFORT_LEVELS,
    defaultModel: DEFAULT_CODEX_MODEL_ID,
    reasoning: {
      kind: 'enum',
      label: 'Thinking',
      levels: FALLBACK_CODEX_EFFORT_LEVELS,
      default: FALLBACK_CODEX_MODELS.find((model) => model.id === DEFAULT_CODEX_MODEL_ID)?.defaultEffort ?? 'high',
    },
  }
}

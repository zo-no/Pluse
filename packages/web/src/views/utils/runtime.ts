import type { RuntimeModelCatalog } from '@pluse/types'

type CatalogModel = RuntimeModelCatalog['models'][number]

export const DEFAULT_CODEX_MODEL_ID = 'gpt-5.3-codex-spark'
export const DEFAULT_CLAUDE_MODEL_ID = 'sonnet[1m]'

const FALLBACK_CODEX_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh']
const CODEX_MODEL_ALIASES: Record<string, string> = {
  '5.3-codex-spark': 'gpt-5.3-codex-spark',
  '5.3-codex': 'gpt-5.3-codex',
  '5.2-codex': 'gpt-5.2-codex',
  '5.1-codex-max': 'gpt-5.1-codex-max',
  '5.1-codex-mini': 'gpt-5.1-codex-mini',
}
const FALLBACK_CODEX_MODELS: CatalogModel[] = [
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
  { id: 'sonnet[1m]', label: 'Sonnet 4.6' },
  { id: 'opus[1m]', label: 'Opus 4.7' },
  { id: 'haiku[1m]', label: 'Haiku 4.5' },
]

export function defaultRuntimeModelId(tool?: string | null): string {
  return tool?.trim().toLowerCase() === 'claude' ? DEFAULT_CLAUDE_MODEL_ID : DEFAULT_CODEX_MODEL_ID
}

export function defaultRuntimeEffortId(tool?: string | null, catalog?: RuntimeModelCatalog | null): string {
  if (tool?.trim().toLowerCase() === 'claude') return ''
  return catalog?.reasoning.kind === 'enum'
    ? (catalog.reasoning.default ?? catalog.effortLevels?.[0] ?? 'low')
    : catalog?.effortLevels?.[0] ?? 'low'
}

export function normalizeCodexModelId(value?: string | null): string {
  const trimmed = value?.trim().toLowerCase()
  if (!trimmed || trimmed === 'default') return DEFAULT_CODEX_MODEL_ID
  return CODEX_MODEL_ALIASES[trimmed] ?? trimmed
}

export function normalizeClaudeModelId(value?: string | null): string {
  const trimmed = value?.trim().toLowerCase()
  if (!trimmed || trimmed === 'default') return DEFAULT_CLAUDE_MODEL_ID

  if (
    trimmed === 'sonnet'
    || trimmed === 'sonnet[1m]'
    || trimmed === 'claude-sonnet-4-6'
    || trimmed === 'claude-sonnet-4-6[1m]'
  ) {
    return 'sonnet[1m]'
  }

  if (
    trimmed === 'opus'
    || trimmed === 'opus[1m]'
    || trimmed === 'claude-opus-4-6'
    || trimmed === 'claude-opus-4-6[1m]'
    || trimmed === 'claude-opus-4-7'
    || trimmed === 'claude-opus-4-7[1m]'
  ) {
    return 'opus[1m]'
  }

  if (
    trimmed === 'haiku'
    || trimmed === 'haiku[1m]'
    || trimmed === 'claude-haiku-4-5'
    || trimmed === 'claude-haiku-4-5[1m]'
    || trimmed === 'claude-haiku-4-5-20251001'
    || trimmed === 'claude-haiku-4-5-20251001[1m]'
  ) {
    return 'haiku[1m]'
  }

  return trimmed
}

export function resolveRuntimeModelSelection(tool?: string | null, model?: string | null, catalog?: RuntimeModelCatalog | null): string {
  const normalizedTool = tool?.trim().toLowerCase()
  const normalized = normalizedTool === 'claude'
    ? normalizeClaudeModelId(model)
    : normalizeCodexModelId(model)

  if (catalog?.models.some((item) => item.id === normalized)) return normalized

  const catalogDefault = catalog?.defaultModel?.trim()
  if (catalog && catalogDefault && catalog.models.some((item) => item.id === catalogDefault)) return catalogDefault

  const fallback = defaultRuntimeModelId(normalizedTool)
  if (catalog?.models.some((item) => item.id === fallback)) return fallback

  return catalog?.models[0]?.id ?? fallback
}

export function resolveRuntimeEffortSelection(tool?: string | null, effort?: string | null, catalog?: RuntimeModelCatalog | null): string {
  if (tool?.trim().toLowerCase() === 'claude') return effort?.trim() ?? ''

  const trimmed = effort?.trim()
  if (trimmed) return trimmed

  return defaultRuntimeEffortId(tool, catalog)
}

export function buildFallbackRuntimeModelCatalog(tool?: string | null): RuntimeModelCatalog {
  if (tool?.trim().toLowerCase() === 'claude') {
    return {
      models: FALLBACK_CLAUDE_MODELS,
      effortLevels: null,
      defaultModel: DEFAULT_CLAUDE_MODEL_ID,
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

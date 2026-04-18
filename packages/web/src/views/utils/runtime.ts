import type { RuntimeModelCatalog } from '@pluse/types'

export const DEFAULT_CODEX_MODEL_ID = 'gpt-5.3-codex'
export const DEFAULT_CLAUDE_MODEL_ID = 'sonnet'

const FALLBACK_CODEX_MODEL: RuntimeModelCatalog['models'][number] = {
  id: DEFAULT_CODEX_MODEL_ID,
  label: 'GPT-5.3-Codex',
  defaultEffort: 'low',
  effortLevels: ['low', 'medium', 'high', 'xhigh'],
}

const FALLBACK_CLAUDE_MODELS: RuntimeModelCatalog['models'] = [
  { id: 'sonnet', label: 'Sonnet 4.6' },
  { id: 'opus', label: 'Opus 4.6' },
  { id: 'haiku', label: 'Haiku 4.5' },
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
  const trimmed = value?.trim()
  if (!trimmed || trimmed === 'default' || trimmed === '5.3-codex-spark') return DEFAULT_CODEX_MODEL_ID
  return trimmed
}

export function resolveRuntimeModelSelection(tool?: string | null, model?: string | null, catalog?: RuntimeModelCatalog | null): string {
  const normalizedTool = tool?.trim().toLowerCase()
  const normalized = normalizedTool === 'claude'
    ? model?.trim() || DEFAULT_CLAUDE_MODEL_ID
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
      defaultModel: null,
      reasoning: { kind: 'toggle', label: 'Thinking' },
    }
  }

  return {
    models: [FALLBACK_CODEX_MODEL],
    effortLevels: FALLBACK_CODEX_MODEL.effortLevels ?? ['low', 'medium', 'high', 'xhigh'],
    defaultModel: DEFAULT_CODEX_MODEL_ID,
    reasoning: {
      kind: 'enum',
      label: 'Thinking',
      levels: FALLBACK_CODEX_MODEL.effortLevels ?? ['low', 'medium', 'high', 'xhigh'],
      default: FALLBACK_CODEX_MODEL.defaultEffort ?? 'low',
    },
  }
}

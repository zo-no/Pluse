import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { RuntimeModelCatalog, RuntimeTool } from '@pluse/types'

type ToolName = 'codex' | 'claude'
type CatalogModel = RuntimeModelCatalog['models'][number]

const CLAUDE_MODELS = [
  { id: 'sonnet', label: 'Sonnet 4.6' },
  { id: 'opus', label: 'Opus 4.6' },
  { id: 'haiku', label: 'Haiku 4.5' },
]

const CODEX_DEFAULT_MODEL = 'gpt-5.3-codex-spark'
const DEFAULT_CODEX_EFFORT = 'high'
const DEFAULT_CODEX_REASONING_LEVELS = ['low', 'medium', 'high', 'xhigh']
const CODEX_MODEL_ALIASES: Record<string, string> = {
  '5.3-codex-spark': 'gpt-5.3-codex-spark',
  '5.3-codex': 'gpt-5.3-codex',
  '5.2-codex': 'gpt-5.2-codex',
  '5.1-codex-max': 'gpt-5.1-codex-max',
  '5.1-codex-mini': 'gpt-5.1-codex-mini',
}
const KNOWN_CODEX_MODELS: CatalogModel[] = [
  { id: 'gpt-5.4', label: 'GPT-5.4', defaultEffort: 'medium', effortLevels: DEFAULT_CODEX_REASONING_LEVELS },
  { id: 'gpt-5.2-codex', label: 'GPT-5.2-Codex', defaultEffort: 'medium', effortLevels: DEFAULT_CODEX_REASONING_LEVELS },
  { id: 'gpt-5.1-codex-max', label: 'GPT-5.1-Codex-Max', defaultEffort: 'medium', effortLevels: DEFAULT_CODEX_REASONING_LEVELS },
  { id: 'gpt-5.4-mini', label: 'GPT-5.4-Mini', defaultEffort: 'medium', effortLevels: DEFAULT_CODEX_REASONING_LEVELS },
  { id: 'gpt-5.3-codex', label: 'GPT-5.3-Codex', defaultEffort: 'medium', effortLevels: DEFAULT_CODEX_REASONING_LEVELS },
  { id: 'gpt-5.3-codex-spark', label: 'GPT-5.3-Codex-Spark', defaultEffort: 'high', effortLevels: DEFAULT_CODEX_REASONING_LEVELS },
  { id: 'gpt-5.2', label: 'GPT-5.2', defaultEffort: 'medium', effortLevels: DEFAULT_CODEX_REASONING_LEVELS },
  { id: 'gpt-5.1-codex-mini', label: 'GPT-5.1-Codex-Mini', defaultEffort: 'medium', effortLevels: DEFAULT_CODEX_REASONING_LEVELS },
]
const CODEX_MODEL_LABELS: Record<string, string> = Object.fromEntries(
  KNOWN_CODEX_MODELS.map((model) => [model.id, model.label]),
)
const KNOWN_CODEX_MODEL_ORDER = new Map<string, number>(
  KNOWN_CODEX_MODELS.map((model, index) => [model.id, index]),
)

const BUILTIN_TOOLS: Array<Omit<RuntimeTool, 'available' | 'command'>> = [
  {
    id: 'codex',
    name: 'Codex',
    runtimeFamily: 'codex-json',
    builtin: true,
  },
  {
    id: 'claude',
    name: 'Claude Code',
    runtimeFamily: 'claude-stream-json',
    builtin: true,
  },
]

let cachedCodexCatalog: RuntimeModelCatalog | null = null

export function normalizeCodexModelId(value?: string | null): string {
  const trimmed = value?.trim().toLowerCase()
  if (!trimmed || trimmed === 'default') return CODEX_DEFAULT_MODEL
  return CODEX_MODEL_ALIASES[trimmed] ?? trimmed
}

function resolveToolCommand(tool: ToolName): string {
  if (tool === 'claude') {
    return process.env['PLUSE_CLAUDE_COMMAND']?.trim()
      || process.env['PULSE_CLAUDE_COMMAND']?.trim()
      || process.env['MELODYSYNC_CLAUDE_COMMAND']?.trim()
      || 'claude'
  }
  return process.env['PLUSE_CODEX_COMMAND']?.trim()
    || process.env['PULSE_CODEX_COMMAND']?.trim()
    || process.env['MELODYSYNC_CODEX_COMMAND']?.trim()
    || 'codex'
}

function isCommandAvailable(command: string): boolean {
  const trimmed = command.trim()
  if (!trimmed) return false

  if (trimmed.includes('/')) {
    return existsSync(trimmed)
  }

  return typeof Bun.which === 'function' ? Boolean(Bun.which(trimmed)) : true
}

function buildEmptyCatalog(): RuntimeModelCatalog {
  return {
    models: [],
    effortLevels: null,
    defaultModel: null,
    reasoning: { kind: 'none', label: 'Thinking' },
  }
}

function buildClaudeCatalog(): RuntimeModelCatalog {
  return {
    models: CLAUDE_MODELS,
    effortLevels: null,
    defaultModel: null,
    reasoning: { kind: 'toggle', label: 'Thinking' },
  }
}

function getCodexModelsCachePath(): string {
  return join(homedir(), '.codex', 'models_cache.json')
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  const seen = new Set<string>()
  const result: string[] = []
  for (const entry of value) {
    const next = typeof entry === 'string'
      ? entry.trim()
      : entry && typeof entry === 'object' && typeof entry.effort === 'string'
        ? entry.effort.trim()
        : ''
    if (!next || seen.has(next)) continue
    seen.add(next)
    result.push(next)
  }
  return result
}

function codexModelLabel(id: string, label?: string): string {
  return CODEX_MODEL_LABELS[id] ?? label?.trim() ?? id
}

function mergeKnownCodexModels(models: CatalogModel[]): CatalogModel[] {
  const merged = new Map<string, CatalogModel>()

  for (const model of models) {
    merged.set(model.id, model)
  }
  for (const model of KNOWN_CODEX_MODELS) {
    const existing = merged.get(model.id)
    merged.set(
      model.id,
      existing
        ? {
            ...existing,
            label: codexModelLabel(model.id, existing.label),
            defaultEffort: existing.defaultEffort || model.defaultEffort,
            effortLevels: existing.effortLevels?.length ? existing.effortLevels : model.effortLevels,
          }
        : { ...model },
    )
  }

  return [...merged.values()].sort((a, b) => {
    const orderA = KNOWN_CODEX_MODEL_ORDER.get(a.id)
    const orderB = KNOWN_CODEX_MODEL_ORDER.get(b.id)
    if (orderA !== undefined && orderB !== undefined) return orderA - orderB
    if (orderA !== undefined) return -1
    if (orderB !== undefined) return 1
    return a.label.localeCompare(b.label)
  })
}

function buildFallbackCodexCatalog(): RuntimeModelCatalog {
  const models = KNOWN_CODEX_MODELS.map((model) => ({ ...model }))
  const effortLevels = [...new Set([
    ...DEFAULT_CODEX_REASONING_LEVELS,
    ...models.flatMap((model) => model.effortLevels ?? []),
  ])]
  const defaultEffort = models.find((model) => model.id === CODEX_DEFAULT_MODEL)?.defaultEffort
    ?? DEFAULT_CODEX_EFFORT

  return {
    models,
    effortLevels,
    defaultModel: CODEX_DEFAULT_MODEL,
    reasoning: {
      kind: 'enum',
      label: 'Thinking',
      levels: effortLevels,
      default: defaultEffort,
    },
  }
}

function buildCodexCatalog(): RuntimeModelCatalog {
  if (cachedCodexCatalog) return cachedCodexCatalog

  try {
    const raw = readFileSync(getCodexModelsCachePath(), 'utf8')
    const parsed = JSON.parse(raw) as { models?: Array<Record<string, unknown>> }
    const models: CatalogModel[] = []
    for (const model of parsed.models ?? []) {
      if (model.visibility !== 'list' || model.supported_in_api === false) continue

      const slug = String(model.slug ?? '').trim()
      if (!slug) continue

      const id = normalizeCodexModelId(slug)
      const label = codexModelLabel(id, String(model.display_name ?? model.slug ?? '').trim())
      if (!id || !label) continue

      const effortLevels = toStringArray(model.supported_reasoning_levels)
      const defaultEffort = typeof model.default_reasoning_level === 'string'
        ? model.default_reasoning_level.trim()
        : 'medium'
      models.push({
        id,
        label,
        defaultEffort,
        effortLevels,
      })
    }
    const mergedModels = mergeKnownCodexModels(models)

    const effortLevels = [...new Set([
      ...DEFAULT_CODEX_REASONING_LEVELS,
      ...mergedModels.flatMap((model) => model.effortLevels ?? []),
    ])]
    const defaultEffort = mergedModels.find((model) => model.id === CODEX_DEFAULT_MODEL)?.defaultEffort
      ?? DEFAULT_CODEX_EFFORT

    cachedCodexCatalog = {
      models: mergedModels,
      effortLevels,
      defaultModel: CODEX_DEFAULT_MODEL,
      reasoning: {
        kind: 'enum',
        label: 'Thinking',
        levels: effortLevels,
        default: defaultEffort || effortLevels[0] || DEFAULT_CODEX_EFFORT,
      },
    }
    return cachedCodexCatalog
  } catch {
    cachedCodexCatalog = buildFallbackCodexCatalog()
    return cachedCodexCatalog
  }
}

export function listRuntimeTools(): RuntimeTool[] {
  return BUILTIN_TOOLS.map((tool) => {
    const command = resolveToolCommand(tool.id as ToolName)
    return {
      ...tool,
      command,
      available: isCommandAvailable(command),
    }
  })
}

export function getRuntimeModelCatalog(toolId?: string | null): RuntimeModelCatalog {
  switch (toolId?.trim()) {
    case 'claude':
      return buildClaudeCatalog()
    case 'codex':
      return buildCodexCatalog()
    default:
      return buildEmptyCatalog()
  }
}

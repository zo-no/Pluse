import { spawnSync } from 'node:child_process'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { RuntimeModelCatalog, RuntimeTool } from '@pluse/types'
import {
  isClaudeRuntimeTool,
  isRuntimeCommandAvailable,
  resolveRuntimeCommandSpec,
  type RuntimeToolName,
} from './command'
import { getSourceCodexHome } from '../support/codex-home'
type CatalogModel = RuntimeModelCatalog['models'][number]

const CLAUDE_MODELS = [
  { id: 'sonnet[1m]', label: 'Sonnet 4.6' },
  { id: 'opus[1m]', label: 'Opus 4.7' },
  { id: 'haiku[1m]', label: 'Haiku 4.5' },
]
const DEFAULT_CLAUDE_MODEL = 'sonnet[1m]'

const CODEX_DEFAULT_MODEL = 'gpt-5.4'
const DEFAULT_CODEX_EFFORT = 'high'
const DEFAULT_CODEX_REASONING_LEVELS = ['low', 'medium', 'high', 'xhigh']
const CODEX_MODEL_CATALOG_REFRESH_MS = parsePositiveInt(
  process.env['PLUSE_CODEX_MODEL_CATALOG_REFRESH_MS']?.trim()
    || process.env['PULSE_CODEX_MODEL_CATALOG_REFRESH_MS']?.trim(),
  60 * 60 * 1000,
)
const CODEX_MODEL_CATALOG_RETRY_MS = 60 * 1000
const CODEX_MODEL_ALIASES: Record<string, string> = {
  '5.5': 'gpt-5.5',
  'codex5.5': 'gpt-5.5',
  'codex-5.5': 'gpt-5.5',
  '5.3-codex-spark': 'gpt-5.3-codex',
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
  {
    id: 'mc',
    name: 'MC (--code)',
    runtimeFamily: 'claude-stream-json',
    builtin: true,
  },
]

let cachedCodexCatalog: RuntimeModelCatalog | null = null
let cachedCodexCatalogSignature: string | null = null
let lastCodexCatalogRefreshAttemptAt = 0

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function normalizeCodexModelId(value?: string | null): string {
  const trimmed = value?.trim().toLowerCase()
  if (!trimmed || trimmed === 'default') return CODEX_DEFAULT_MODEL
  return CODEX_MODEL_ALIASES[trimmed] ?? trimmed
}

export function normalizeClaudeModelId(value?: string | null): string {
  const trimmed = value?.trim().toLowerCase()
  if (!trimmed || trimmed === 'default') return DEFAULT_CLAUDE_MODEL

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
    defaultModel: DEFAULT_CLAUDE_MODEL,
    reasoning: { kind: 'toggle', label: 'Thinking' },
  }
}

function getCodexModelsCachePath(): string {
  return join(getSourceCodexHome(), 'models_cache.json')
}

function getCodexModelsCacheSignature(): string {
  try {
    const stats = statSync(getCodexModelsCachePath())
    return `${stats.mtimeMs}:${stats.size}`
  } catch {
    return 'missing'
  }
}

function isCodexModelsCacheStale(now: number): boolean {
  try {
    const stats = statSync(getCodexModelsCachePath())
    return now - stats.mtimeMs >= CODEX_MODEL_CATALOG_REFRESH_MS
  } catch {
    return true
  }
}

function refreshCodexModelsCacheIfNeeded(): void {
  const now = Date.now()
  if (!isCodexModelsCacheStale(now)) return
  if (now - lastCodexCatalogRefreshAttemptAt < CODEX_MODEL_CATALOG_RETRY_MS) return
  lastCodexCatalogRefreshAttemptAt = now

  const command = resolveRuntimeCommandSpec('codex')
  if (!isRuntimeCommandAvailable(command)) return

  try {
    const result = spawnSync(command.file, [...command.args, 'debug', 'models'], {
      encoding: 'utf8',
      env: { ...process.env, CODEX_HOME: getSourceCodexHome() },
      maxBuffer: 16 * 1024 * 1024,
      timeout: 10_000,
    })
    if (result.status !== 0 || !result.stdout.trim()) return

    const parsed = JSON.parse(result.stdout) as { models?: unknown }
    if (!Array.isArray(parsed.models)) return

    writeFileSync(getCodexModelsCachePath(), JSON.stringify(parsed), 'utf8')
  } catch {
    // Keep the last known Codex catalog if refresh fails.
  }
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
    if (!existing) continue
    merged.set(model.id, {
      ...existing,
      label: codexModelLabel(model.id, existing.label),
      defaultEffort: existing.defaultEffort || model.defaultEffort,
      effortLevels: existing.effortLevels?.length ? existing.effortLevels : model.effortLevels,
    })
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
  refreshCodexModelsCacheIfNeeded()
  const signature = getCodexModelsCacheSignature()
  if (cachedCodexCatalog && cachedCodexCatalogSignature === signature) return cachedCodexCatalog

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
    if (models.length === 0) throw new Error('empty codex model catalog')

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
    cachedCodexCatalogSignature = signature
    return cachedCodexCatalog
  } catch {
    cachedCodexCatalog = buildFallbackCodexCatalog()
    cachedCodexCatalogSignature = signature
    return cachedCodexCatalog
  }
}

export function listRuntimeTools(): RuntimeTool[] {
  return BUILTIN_TOOLS.map((tool) => {
    const command = resolveRuntimeCommandSpec(tool.id as RuntimeToolName)
    return {
      ...tool,
      command: command.display,
      available: isRuntimeCommandAvailable(command),
    }
  })
}

export function getRuntimeModelCatalog(toolId?: string | null): RuntimeModelCatalog {
  const normalized = toolId?.trim().toLowerCase()
  if (!normalized) return buildEmptyCatalog()
  if (isClaudeRuntimeTool(normalized)) return buildClaudeCatalog()
  if (normalized === 'codex') return buildCodexCatalog()
  return buildEmptyCatalog()
}

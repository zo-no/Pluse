import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { RuntimeModelCatalog, RuntimeTool } from '@pluse/types'

type ToolName = 'codex' | 'claude'

const CLAUDE_MODELS = [
  { id: 'sonnet', label: 'Sonnet 4.6' },
  { id: 'opus', label: 'Opus 4.6' },
  { id: 'haiku', label: 'Haiku 4.5' },
]

const CODEX_DEFAULT_MODEL = '5.3-codex-spark'
const DEFAULT_CODEX_EFFORT = 'low'
const DEFAULT_CODEX_REASONING_LEVELS = ['low', 'medium', 'high', 'xhigh']
const CODEX_MODEL_LABELS: Record<string, string> = {
  'gpt-5.4': 'GPT-5.4',
  'gpt-5.4-mini': 'GPT-5.4-Mini',
  'gpt-5.3-codex': 'GPT-5.3-Codex',
  '5.3-codex-spark': 'GPT-5.3-Codex-Spark',
  'gpt-5.2': 'GPT-5.2',
}

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

function buildFallbackCodexCatalog(): RuntimeModelCatalog {
  const fallbackModel = {
    id: CODEX_DEFAULT_MODEL,
    label: codexModelLabel(CODEX_DEFAULT_MODEL),
    defaultEffort: DEFAULT_CODEX_EFFORT,
    effortLevels: DEFAULT_CODEX_REASONING_LEVELS,
  }

  return {
    models: [fallbackModel],
    effortLevels: DEFAULT_CODEX_REASONING_LEVELS,
    defaultModel: CODEX_DEFAULT_MODEL,
    reasoning: {
      kind: 'enum',
      label: 'Thinking',
      levels: DEFAULT_CODEX_REASONING_LEVELS,
      default: DEFAULT_CODEX_EFFORT,
    },
  }
}

function buildCodexCatalog(): RuntimeModelCatalog {
  if (cachedCodexCatalog) return cachedCodexCatalog

  try {
    const raw = readFileSync(getCodexModelsCachePath(), 'utf8')
    const parsed = JSON.parse(raw) as { models?: Array<Record<string, unknown>> }
    const models = (parsed.models ?? [])
      .filter((model) => model.visibility === 'list')
      .map((model) => {
        const id = String(model.slug ?? '').trim()
        const effortLevels = toStringArray(model.supported_reasoning_levels)
        const defaultEffort = typeof model.default_reasoning_level === 'string'
          ? model.default_reasoning_level.trim()
          : 'medium'
        return {
          id,
          label: codexModelLabel(id, String(model.display_name ?? model.slug ?? '').trim()),
          defaultEffort,
          effortLevels,
        }
      })
      .filter((model) => model.id && model.label)

    if (!models.some((model) => model.id === CODEX_DEFAULT_MODEL)) {
      models.unshift({
        id: CODEX_DEFAULT_MODEL,
        label: codexModelLabel(CODEX_DEFAULT_MODEL),
        defaultEffort: DEFAULT_CODEX_EFFORT,
        effortLevels: DEFAULT_CODEX_REASONING_LEVELS,
      })
    }

    const effortLevels = [...new Set([
      ...DEFAULT_CODEX_REASONING_LEVELS,
      ...models.flatMap((model) => model.effortLevels ?? []),
    ])]
    const defaultEffort = models.find((model) => model.id === CODEX_DEFAULT_MODEL)?.defaultEffort
      ?? DEFAULT_CODEX_EFFORT

    cachedCodexCatalog = {
      models,
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

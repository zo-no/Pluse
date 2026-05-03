import { existsSync } from 'node:fs'
import { expandToolPath } from '../support/tool-env'

export type RuntimeToolName = 'codex' | 'claude' | 'mc' | 'gemini'
export type RuntimeToolFamily = 'codex' | 'claude' | 'gemini'

export type RuntimeCommandSpec = {
  display: string
  file: string
  args: string[]
}

const DEFAULT_CLAUDE_PROXY_COMMAND = 'mc --code'

function envCommandKeys(tool: RuntimeToolName): string[] {
  if (tool === 'claude') {
    return ['PLUSE_CLAUDE_COMMAND', 'PULSE_CLAUDE_COMMAND', 'MELODYSYNC_CLAUDE_COMMAND']
  }
  if (tool === 'gemini') {
    return ['PLUSE_GEMINI_COMMAND', 'PULSE_GEMINI_COMMAND']
  }
  if (tool === 'mc') {
    return [
      'PLUSE_MC_COMMAND',
      'PULSE_MC_COMMAND',
      'MELODYSYNC_MC_COMMAND',
      'PLUSE_CLAUDE_PROXY_COMMAND',
      'PULSE_CLAUDE_PROXY_COMMAND',
    ]
  }
  return ['PLUSE_CODEX_COMMAND', 'PULSE_CODEX_COMMAND', 'MELODYSYNC_CODEX_COMMAND']
}

function readConfiguredCommand(tool: RuntimeToolName): string | null {
  for (const key of envCommandKeys(tool)) {
    const value = process.env[key]?.trim()
    if (value) return value
  }
  return null
}

function pushToken(tokens: string[], current: string): string {
  if (current) tokens.push(current)
  return ''
}

function splitCommandString(value: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | '\'' | null = null
  let escaping = false

  for (const char of value) {
    if (escaping) {
      current += char
      escaping = false
      continue
    }

    if (char === '\\' && quote !== '\'') {
      escaping = true
      continue
    }

    if (quote) {
      if (char === quote) {
        quote = null
      } else {
        current += char
      }
      continue
    }

    if (char === '"' || char === '\'') {
      quote = char
      continue
    }

    if (/\s/.test(char)) {
      current = pushToken(tokens, current)
      continue
    }

    current += char
  }

  if (escaping) current += '\\'
  pushToken(tokens, current)
  return tokens
}

function buildCommandSpec(raw: string): RuntimeCommandSpec | null {
  const display = raw.trim()
  if (!display) return null

  const tokens = splitCommandString(display)
  const [file, ...args] = tokens
  if (!file?.trim()) return null
  return {
    display,
    file: file.trim(),
    args,
  }
}

function isExecutableAvailable(file: string): boolean {
  const trimmed = file.trim()
  if (!trimmed) return false
  if (trimmed.includes('/')) return existsSync(trimmed)
  if (typeof Bun.which !== 'function') return true
  return Boolean(Bun.which(trimmed, { PATH: expandToolPath() }))
}

export function isRuntimeCommandAvailable(spec: RuntimeCommandSpec | null): boolean {
  return Boolean(spec && isExecutableAvailable(spec.file))
}

export function isClaudeRuntimeTool(tool?: string | null): boolean {
  const normalized = tool?.trim().toLowerCase()
  return normalized === 'claude' || normalized === 'mc'
}

export function isGeminiRuntimeTool(tool?: string | null): boolean {
  const normalized = tool?.trim().toLowerCase()
  return normalized === 'gemini'
}

export function resolveRuntimeToolFamily(tool?: string | null): RuntimeToolFamily {
  if (isClaudeRuntimeTool(tool)) return 'claude'
  if (isGeminiRuntimeTool(tool)) return 'gemini'
  return 'codex'
}

export function normalizeRuntimeToolName(tool?: string | null): RuntimeToolName {
  const normalized = tool?.trim().toLowerCase()
  if (normalized === 'claude' || normalized === 'mc' || normalized === 'gemini') return normalized
  return 'codex'
}

export function resolveRuntimeCommandSpec(tool: RuntimeToolName): RuntimeCommandSpec {
  const configured = readConfiguredCommand(tool)
  const fromConfig = configured ? buildCommandSpec(configured) : null
  if (fromConfig) return fromConfig

  if (tool === 'claude') {
    return buildCommandSpec('claude')!
  }

  if (tool === 'gemini') {
    return buildCommandSpec('gemini')!
  }

  if (tool === 'mc') {
    return buildCommandSpec(DEFAULT_CLAUDE_PROXY_COMMAND)!
  }

  return buildCommandSpec('codex')!
}

export function resolveClaudeProxyCommandSpec(): RuntimeCommandSpec | null {
  const proxy = resolveRuntimeCommandSpec('mc')
  return isRuntimeCommandAvailable(proxy) ? proxy : null
}

export function sameRuntimeCommand(a: RuntimeCommandSpec | null, b: RuntimeCommandSpec | null): boolean {
  if (!a || !b) return false
  return a.file === b.file
    && a.args.length === b.args.length
    && a.args.every((value, index) => value === b.args[index])
}

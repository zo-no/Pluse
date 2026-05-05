const COMMON_BIN_PATHS = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
]

export function expandToolPath(currentPath = process.env.PATH ?? '', home = process.env.HOME ?? ''): string {
  const homeBinPaths = home
    ? [
      `${home}/.bun/bin`,
      `${home}/.local/bin`,
      `${home}/.openclaw/tools/node/bin`,
      `${home}/.claude/local/bin`,
      `${home}/.npm-global/bin`,
    ]
    : []

  const seen = new Set<string>()
  const paths: string[] = []
  for (const path of [...homeBinPaths, ...currentPath.split(':'), ...COMMON_BIN_PATHS]) {
    const normalized = path.trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    paths.push(normalized)
  }

  return paths.join(':')
}

export function createToolEnv(): Record<string, string | undefined> {
  return {
    ...process.env,
    PATH: expandToolPath(),
  }
}

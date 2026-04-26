import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { getManagedCodexHome } from './paths'

const CODEX_SYNC_FILENAMES = ['auth.json', 'models_cache.json']

function resolveSourceCodexHome(managedHome: string): string {
  const configured = process.env['CODEX_HOME']?.trim()
  if (configured && resolve(configured) !== resolve(managedHome)) return configured
  return join(homedir(), '.codex')
}

function syncCodexFile(sourcePath: string, targetPath: string): void {
  if (!existsSync(sourcePath)) return

  try {
    const source = readFileSync(sourcePath, 'utf8')
    const target = existsSync(targetPath) ? readFileSync(targetPath, 'utf8') : null
    if (source !== target) writeFileSync(targetPath, source, 'utf8')
  } catch {
    try {
      copyFileSync(sourcePath, targetPath)
    } catch {
      // Let Codex surface auth/cache errors on its own.
    }
  }
}

export function getSourceCodexHome(): string {
  return resolveSourceCodexHome(getManagedCodexHome())
}

export function syncManagedCodexHome(): string {
  const managedHome = getManagedCodexHome()
  const sourceHome = resolveSourceCodexHome(managedHome)

  for (const filename of CODEX_SYNC_FILENAMES) {
    syncCodexFile(join(sourceHome, filename), join(managedHome, filename))
  }

  return managedHome
}

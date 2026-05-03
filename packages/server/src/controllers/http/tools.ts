import { Hono } from 'hono'
import { access, chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createToolEnv } from '../../support/tool-env'

const toolsRouter = new Hono()

const KAIROS_REPO_URL = 'https://github.com/zo-no/kairos.git'
const KAIROS_REF = 'main'

interface CommandResult {
  exitCode: number
  stdout: string
  stderr: string
}

async function readStream(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) return ''
  return new Response(stream).text()
}

async function runCommand(
  args: string[],
  options: { cwd?: string; env?: Record<string, string | undefined> } = {},
): Promise<CommandResult> {
  try {
    const proc = Bun.spawn(args, {
      cwd: options.cwd,
      env: options.env,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const stdoutPromise = readStream(proc.stdout)
    const stderrPromise = readStream(proc.stderr)
    const exitCode = await proc.exited
    const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise])
    return { exitCode, stdout, stderr }
  } catch (error) {
    return {
      exitCode: -1,
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error),
    }
  }
}

function compactCommandOutput(result: CommandResult): string {
  const output = `${result.stderr}\n${result.stdout}`.trim()
  if (!output) return `exit code ${result.exitCode}`
  return output.length > 4000 ? output.slice(-4000) : output
}

function decodeOutput(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes).trim()
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function getKairosVersion(path: string, env: Record<string, string | undefined>): Promise<string | null> {
  const result = await runCommand([path, '--version'], { env })
  if (result.exitCode !== 0) return null
  return result.stdout.trim() || null
}

/** Prevent concurrent installs */
let installLock = false

/**
 * GET /api/tools/kairos
 * Detect whether kairos CLI is installed and available in PATH.
 */
toolsRouter.get('/tools/kairos', async (c) => {
  const env = createToolEnv()
  const result = Bun.spawnSync(['which', 'kairos'], {
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const path = result.exitCode === 0 ? decodeOutput(result.stdout) : null
  const version = path ? await getKairosVersion(path, env) : null
  const installed = path != null && version != null
  return c.json({
    ok: true,
    data: {
      installed,
      path,
      version,
      source: { repo: KAIROS_REPO_URL, ref: KAIROS_REF },
    },
  })
})

/**
 * POST /api/tools/kairos/install
 * Clone and build kairos from GitHub, output binary to ~/.bun/bin/kairos.
 * Uses async Bun.spawn() to avoid blocking the event loop during the ~15-30s install.
 */
toolsRouter.post('/tools/kairos/install', async (c) => {
  if (installLock) {
    return c.json({ ok: false, error: 'installation already in progress' }, 409)
  }
  installLock = true
  let tmpDir: string | null = null

  try {
    const home = process.env.HOME ?? ''
    if (!home) {
      return c.json({ ok: false, error: 'HOME is not set; cannot install kairos' }, 500)
    }

    const env = createToolEnv()
    const binDir = join(home, '.bun', 'bin')
    const outfile = join(binDir, 'kairos')
    const toolsRoot = join(home, '.pluse', 'tools')
    const installDir = join(toolsRoot, 'kairos')
    const tmpRoot = join(home, '.pluse', 'tmp')
    tmpDir = join(tmpRoot, `kairos-install-${Date.now()}`)

    await rm(tmpDir, { recursive: true, force: true })
    await mkdir(tmpRoot, { recursive: true })
    await mkdir(binDir, { recursive: true })
    await mkdir(toolsRoot, { recursive: true })

    const cloneResult = await runCommand([
      'git',
      'clone',
      '--depth=1',
      '--branch',
      KAIROS_REF,
      KAIROS_REPO_URL,
      tmpDir,
    ], { env })
    if (cloneResult.exitCode !== 0) {
      return c.json({ ok: false, error: `download from GitHub failed: ${compactCommandOutput(cloneResult)}` }, 500)
    }

    const installResult = await runCommand([
      process.execPath,
      'install',
      '--production',
    ], { cwd: tmpDir, env })
    if (installResult.exitCode !== 0) {
      return c.json({ ok: false, error: `dependency install failed: ${compactCommandOutput(installResult)}` }, 500)
    }

    await rm(installDir, { recursive: true, force: true })
    await rename(tmpDir, installDir)
    tmpDir = null

    const entrypoint = join(installDir, 'src', 'index.ts')
    await writeFile(
      outfile,
      `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(entrypoint)} "$@"\n`,
      'utf-8',
    )

    if (!await fileExists(outfile)) {
      return c.json({ ok: false, error: `wrapper was not created at ${outfile}` }, 500)
    }
    await chmod(outfile, 0o755).catch(() => {})
    const version = await getKairosVersion(outfile, env)
    if (!version) {
      return c.json({ ok: false, error: 'kairos wrapper was created but failed verification with --version' }, 500)
    }

    return c.json({
      ok: true,
      data: {
        path: outfile,
        version,
        sourcePath: installDir,
        source: { repo: KAIROS_REPO_URL, ref: KAIROS_REF },
      },
    })
  } finally {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    installLock = false
  }
})

export { toolsRouter }

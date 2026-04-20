import { Hono } from 'hono'

const toolsRouter = new Hono()

/**
 * Expand PATH to include common user bin directories that may not be present
 * in the server process environment (e.g. ~/.bun/bin is not in PATH by default).
 */
function expandPath(): string {
  const home = process.env.HOME ?? ''
  const extra = [
    `${home}/.bun/bin`,
    `${home}/.local/bin`,
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ]
  const current = process.env.PATH ?? ''
  return [...extra, current].join(':')
}

/** Prevent concurrent installs */
let installLock = false

/**
 * GET /api/tools/kairos
 * Detect whether kairos CLI is installed and available in PATH.
 */
toolsRouter.get('/tools/kairos', (c) => {
  const result = Bun.spawnSync(['which', 'kairos'], {
    env: { ...process.env, PATH: expandPath() },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const installed = result.exitCode === 0
  const path = installed ? new TextDecoder().decode(result.stdout).trim() : null
  return c.json({ ok: true, data: { installed, path } })
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

  try {
    const home = process.env.HOME ?? ''
    const binDir = `${home}/.bun/bin`
    const outfile = `${binDir}/kairos`
    const tmpDir = `${home}/.pluse/tmp/kairos-install`
    const env = { ...process.env, PATH: expandPath() }

    // Clean up any leftover tmp dir from a previous failed install
    await Bun.spawn(['rm', '-rf', tmpDir], { env, stdout: 'ignore', stderr: 'ignore' }).exited

    // Clone the repository
    const cloneProc = Bun.spawn(
      ['git', 'clone', '--depth=1', 'https://github.com/zo-no/kairos.git', tmpDir],
      { env, stdout: 'pipe', stderr: 'pipe' }
    )
    const cloneExit = await cloneProc.exited
    if (cloneExit !== 0) {
      const stderr = await new Response(cloneProc.stderr).text()
      await Bun.spawn(['rm', '-rf', tmpDir], { env, stdout: 'ignore', stderr: 'ignore' }).exited
      return c.json({ ok: false, error: `clone failed: ${stderr.trim()}` }, 500)
    }

    // Ensure the output directory exists
    await Bun.spawn(['mkdir', '-p', binDir], { env, stdout: 'ignore', stderr: 'ignore' }).exited

    // Build the binary
    const buildProc = Bun.spawn(
      ['bun', 'build', '--compile', `--outfile=${outfile}`, 'src/index.ts'],
      { cwd: tmpDir, env, stdout: 'pipe', stderr: 'pipe' }
    )
    const buildExit = await buildProc.exited

    // Always clean up tmp dir
    await Bun.spawn(['rm', '-rf', tmpDir], { env, stdout: 'ignore', stderr: 'ignore' }).exited

    if (buildExit !== 0) {
      const stderr = await new Response(buildProc.stderr).text()
      return c.json({ ok: false, error: `build failed: ${stderr.trim()}` }, 500)
    }

    return c.json({ ok: true, data: { path: outfile } })
  } finally {
    installLock = false
  }
})

export { toolsRouter }

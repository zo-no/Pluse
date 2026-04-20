import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Hono } from 'hono'
import type { ApiErr } from '@pluse/types'
import { authRouter } from './controllers/http/auth'
import { assetsRouter } from './controllers/http/assets'
import { commandsRouter } from './controllers/http/commands'
import { eventsRouter } from './controllers/http/events'
import { projectsRouter } from './controllers/http/projects'
import { settingsRouter } from './controllers/http/settings'
import { hooksRouter } from './controllers/http/hooks'
import { questsRouter } from './controllers/http/quests'
import { runsRouter } from './controllers/http/runs'
import { todosRouter } from './controllers/http/todos'
import { runtimeRouter } from './controllers/http/runtime'
import { toolsRouter } from './controllers/http/tools'
import { getDb } from './db'
import { requireAuth } from './middleware/auth'
import { ensureBuiltinProjects } from './services/projects'
import { reconcile, startScheduler, stopScheduler } from './services/scheduler'
import { recoverFollowUpQueues } from './runtime/session-runner'
import { getServerMetadataPath, getWebDistRoot } from './support/paths'

const DEFAULT_PORT = 7760
const webDistRoot = getWebDistRoot()

export const app = new Hono()

app.get('/health', (c) => c.json({ ok: true, service: 'pluse', ts: Date.now() }))

app.route('/', authRouter)
app.use('/api/*', requireAuth)
app.route('/api', projectsRouter)
app.route('/api', questsRouter)
app.route('/api', runsRouter)
app.route('/api', todosRouter)
app.route('/api', settingsRouter)
app.route('/api', hooksRouter)
app.route('/api', runtimeRouter)
app.route('/api', toolsRouter)
app.route('/api', eventsRouter)
app.route('/api', commandsRouter)
app.route('/api', assetsRouter)

app.onError((err, c) => {
  console.error('[pluse] unhandled error:', err)
  const body: ApiErr = { ok: false, error: err.message ?? 'Internal server error' }
  return c.json(body, 500)
})

app.notFound(async (c) => {
  if (c.req.path.startsWith('/api/')) {
    const body: ApiErr = { ok: false, error: `Not found: ${c.req.method} ${c.req.path}` }
    return c.json(body, 404)
  }

  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    const body: ApiErr = { ok: false, error: `Not found: ${c.req.method} ${c.req.path}` }
    return c.json(body, 404)
  }

  const relativePath = c.req.path === '/' ? '/index.html' : c.req.path
  const assetPath = join(webDistRoot, relativePath.replace(/^\/+/, ''))
  if (existsSync(assetPath)) {
    return new Response(Bun.file(assetPath))
  }

  const indexPath = join(webDistRoot, 'index.html')
  if (existsSync(indexPath)) {
    return new Response(Bun.file(indexPath))
  }

  return c.text('Pluse frontend is not built yet. Run `pnpm build` in the workspace.', 503)
})

function writeServerMetadata(port: number): void {
  writeFileSync(
    getServerMetadataPath(),
    JSON.stringify({
      port,
      pid: process.pid,
      startedAt: new Date().toISOString(),
      service: 'pluse',
    }, null, 2),
  )
}

function bootstrap(): void {
  getDb()
  ensureBuiltinProjects()
  reconcile()
  startScheduler()
  recoverFollowUpQueues()
}

export function startServer(port: number = DEFAULT_PORT): void {
  bootstrap()
  const server = Bun.serve({
    port,
    fetch: app.fetch,
    idleTimeout: 0,
  })
  const listeningPort = server.port ?? port
  writeServerMetadata(listeningPort)
  console.log(`[pluse] listening on http://localhost:${listeningPort}`)

  const shutdown = () => {
    stopScheduler()
    server.stop(true)
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

if (import.meta.main) {
  const port = process.env['PORT'] ? parseInt(process.env['PORT'], 10) : DEFAULT_PORT
  startServer(port)
}

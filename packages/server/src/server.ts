import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Hono } from 'hono'
import type { ApiErr } from '@melody-sync/types'
import { authRouter } from './controllers/http/auth'
import { eventsRouter } from './controllers/http/events'
import { projectsRouter } from './controllers/http/projects'
import { runsRouter } from './controllers/http/runs'
import { sessionsRouter } from './controllers/http/sessions'
import { tasksRouter } from './controllers/http/tasks'
import { runtimeRouter } from './controllers/http/runtime'
import { getDb } from './db'
import { requireAuth } from './middleware/auth'
import { ensureBuiltinProjects } from './services/projects'
import { reconcile, startScheduler, stopScheduler } from './services/scheduler'
import { getServerMetadataPath, getWebDistRoot } from './support/paths'

const DEFAULT_PORT = 7760
const webDistRoot = getWebDistRoot()

export const app = new Hono()

app.get('/health', (c) => c.json({ ok: true, service: 'pulse', ts: Date.now() }))

app.route('/', authRouter)
app.use('/api/*', requireAuth)
app.route('/api', projectsRouter)
app.route('/api', sessionsRouter)
app.route('/api', runsRouter)
app.route('/api', tasksRouter)
app.route('/api', runtimeRouter)
app.route('/api', eventsRouter)

app.onError((err, c) => {
  console.error('[pulse] unhandled error:', err)
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

  return c.text('Pulse frontend is not built yet. Run `pnpm build` in the workspace.', 503)
})

function writeServerMetadata(port: number): void {
  writeFileSync(
    getServerMetadataPath(),
    JSON.stringify({
      port,
      pid: process.pid,
      startedAt: new Date().toISOString(),
      service: 'pulse',
    }, null, 2),
  )
}

function bootstrap(): void {
  getDb()
  ensureBuiltinProjects()
  reconcile()
  startScheduler()
}

export function startServer(port: number = DEFAULT_PORT): void {
  bootstrap()
  const server = Bun.serve({ port, fetch: app.fetch })
  const listeningPort = server.port ?? port
  writeServerMetadata(listeningPort)
  console.log(`[pulse] listening on http://localhost:${listeningPort}`)

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

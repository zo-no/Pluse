import { Hono } from 'hono'
import { z } from 'zod'
import { loadGlobalHooksConfig, patchHook } from '../../services/hooks'

const hooksRouter = new Hono()

hooksRouter.get('/hooks', (c) => {
  const config = loadGlobalHooksConfig()
  return c.json({ ok: true, data: config })
})

const PatchHookSchema = z.object({
  enabled: z.boolean(),
})

hooksRouter.patch('/hooks/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json().catch(() => null)
  if (!body) return c.json({ ok: false, error: 'invalid body' }, 400)
  const parsed = PatchHookSchema.safeParse(body)
  if (!parsed.success) return c.json({ ok: false, error: 'invalid body' }, 400)
  try {
    const config = patchHook(id, parsed.data)
    return c.json({ ok: true, data: config })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error'
    if (message.startsWith('Hook not found:')) {
      return c.json({ ok: false, error: message }, 404)
    }
    return c.json({ ok: false, error: message }, 500)
  }
})

export { hooksRouter }

import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { z } from 'zod'
import type { ApiResult, AppSettings, UpdateAppSettingsInput } from '@pluse/types'
import { getSetting, setSetting } from '../../models/settings'
import { getCliCatalogCommand, saveCliCatalogCommand } from '../../services/cli-catalog-command'

function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data }
}

function errBody(error: string): ApiResult<never> {
  return { ok: false, error }
}

function sc(n: number): ContentfulStatusCode {
  return n as ContentfulStatusCode
}

const UpdateSettingsSchema = z.object({
  globalSystemPrompt: z.string().nullable().optional(),
  cliCatalogCommand: z.string().nullable().optional(),
})

function readSettings(): AppSettings {
  return {
    globalSystemPrompt: getSetting('global_system_prompt')?.trim() ?? '',
    cliCatalogCommand: getCliCatalogCommand(),
  }
}

export const settingsRouter = new Hono()

settingsRouter.get('/settings', (c) => {
  return c.json(ok<AppSettings>(readSettings()))
})

settingsRouter.patch('/settings', async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(errBody('Invalid JSON body'), sc(400))
  }

  const parsed = UpdateSettingsSchema.safeParse(body)
  if (!parsed.success) return c.json(errBody(parsed.error.message), sc(400))

  try {
    const input = parsed.data as UpdateAppSettingsInput
    if ('globalSystemPrompt' in input) {
      setSetting('global_system_prompt', input.globalSystemPrompt?.trim() ?? '')
    }
    if ('cliCatalogCommand' in input) {
      saveCliCatalogCommand(input.cliCatalogCommand)
    }
    return c.json(ok<AppSettings>(readSettings()))
  } catch (error) {
    return c.json(errBody(error instanceof Error ? error.message : String(error)), sc(500))
  }
})

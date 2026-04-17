import { Hono } from 'hono'
import type { ApiResult, RuntimeModelCatalog, RuntimeTool } from '@pluse/types'
import { getRuntimeModelCatalog, listRuntimeTools } from '../../runtime/catalog'

function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data }
}

function errBody(error: string): ApiResult<never> {
  return { ok: false, error }
}

export const runtimeRouter = new Hono()

runtimeRouter.get('/tools', (c) => {
  try {
    return c.json(ok<RuntimeTool[]>(listRuntimeTools()))
  } catch (error) {
    return c.json(errBody(String(error)), 500)
  }
})

runtimeRouter.get('/models', (c) => {
  try {
    return c.json(ok<RuntimeModelCatalog>(getRuntimeModelCatalog(c.req.query('tool'))))
  } catch (error) {
    return c.json(errBody(String(error)), 500)
  }
})

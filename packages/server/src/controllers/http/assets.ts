import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { Hono } from 'hono'
import type { ApiResult } from '@melody-sync/types'
import { getAssetsDir } from '../../support/paths'

const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20MB

export interface Asset {
  id: string
  sessionId: string
  filename: string
  savedPath: string
  mimeType: string
  sizeBytes: number
  createdAt: string
}

// in-memory store — assets are ephemeral, tied to server lifetime
const assets = new Map<string, Asset>()

function newId(): string {
  return 'asset_' + randomBytes(6).toString('hex')
}

export function getAsset(id: string): Asset | null {
  return assets.get(id) ?? null
}

function labelForMime(mimeType: string): string {
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/')) return 'video'
  return 'file'
}

export function prependAttachmentPaths(
  prompt: string,
  attachments: Array<{ filename: string; savedPath: string; mimeType: string }>,
): string {
  if (!attachments.length) return prompt
  const refs = attachments
    .map((a) => `[User attached ${labelForMime(a.mimeType)}: ${a.filename} -> ${a.savedPath}]`)
    .join('\n')
  return `${refs}\n\n${prompt}`
}

export const assetsRouter = new Hono()

assetsRouter.post('/assets/upload', async (c) => {
  let formData: FormData
  try {
    formData = await c.req.formData()
  } catch {
    return c.json({ ok: false, error: 'Invalid multipart form data' } as ApiResult<never>, 400)
  }

  const sessionId = formData.get('sessionId')
  const file = formData.get('file')

  if (!sessionId || typeof sessionId !== 'string') {
    return c.json({ ok: false, error: 'sessionId is required' } as ApiResult<never>, 400)
  }
  if (!file || !(file instanceof File)) {
    return c.json({ ok: false, error: 'file is required' } as ApiResult<never>, 400)
  }
  if (file.size > MAX_FILE_SIZE) {
    return c.json({ ok: false, error: `File too large (max ${MAX_FILE_SIZE / 1024 / 1024}MB)` } as ApiResult<never>, 400)
  }

  const id = newId()
  const timestamp = Date.now()
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const filename = `${timestamp}-${safeName}`
  const dir = getAssetsDir(sessionId)
  const savedPath = join(dir, filename)

  const buffer = await file.arrayBuffer()
  writeFileSync(savedPath, Buffer.from(buffer))

  const asset: Asset = {
    id,
    sessionId,
    filename: file.name,
    savedPath,
    mimeType: file.type || 'application/octet-stream',
    sizeBytes: file.size,
    createdAt: new Date().toISOString(),
  }
  assets.set(id, asset)

  return c.json({ ok: true, data: asset } as ApiResult<Asset>, 201)
})

assetsRouter.get('/assets/:id', (c) => {
  const asset = getAsset(c.req.param('id'))
  if (!asset) return c.json({ ok: false, error: 'Asset not found' } as ApiResult<never>, 404)
  return c.json({ ok: true, data: asset } as ApiResult<Asset>)
})

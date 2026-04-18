import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Hono } from 'hono'
import type { ApiResult, UploadedAsset } from '@pluse/types'
import { createAsset, getAsset } from '../../models/asset'
import { getQuest } from '../../models/quest'
import { getAssetsDir } from '../../support/paths'

const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20MB

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

  const questId = formData.get('questId')
  const file = formData.get('file')

  if (!questId || typeof questId !== 'string') {
    return c.json({ ok: false, error: 'questId is required' } as ApiResult<never>, 400)
  }
  if (!file || !(file instanceof File)) {
    return c.json({ ok: false, error: 'file is required' } as ApiResult<never>, 400)
  }
  if (file.size > MAX_FILE_SIZE) {
    return c.json({ ok: false, error: `File too large (max ${MAX_FILE_SIZE / 1024 / 1024}MB)` } as ApiResult<never>, 400)
  }
  if (!getQuest(questId)) {
    return c.json({ ok: false, error: 'Quest not found' } as ApiResult<never>, 404)
  }

  const timestamp = Date.now()
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const filename = `${timestamp}-${safeName}`
  const dir = getAssetsDir(questId)
  const savedPath = join(dir, filename)
  // Guard against path traversal
  if (!resolve(savedPath).startsWith(resolve(dir))) {
    return c.json({ ok: false, error: 'Invalid filename' } as ApiResult<never>, 400)
  }

  const buffer = await file.arrayBuffer()
  writeFileSync(savedPath, Buffer.from(buffer))

  const asset = createAsset({
    questId,
    filename: file.name,
    savedPath,
    mimeType: file.type || 'application/octet-stream',
    sizeBytes: file.size,
  })

  return c.json({ ok: true, data: asset } as ApiResult<UploadedAsset>, 201)
})

assetsRouter.get('/assets/:id', (c) => {
  const asset = getAsset(c.req.param('id'))
  if (!asset) return c.json({ ok: false, error: 'Asset not found' } as ApiResult<never>, 404)
  return c.json({ ok: true, data: asset } as ApiResult<UploadedAsset>)
})

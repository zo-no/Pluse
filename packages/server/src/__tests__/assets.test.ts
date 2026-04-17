import { beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import type { Project, Session } from '@melody-sync/types'
import { POST, GET, makeWorkDir, resetTestDb, setupTestDb, apiReq } from './helpers'
import { prependAttachmentPaths } from '../controllers/http/assets'

beforeAll(() => setupTestDb())
beforeEach(() => resetTestDb())

async function setupSession(): Promise<{ project: Project; session: Session }> {
  const p = await POST<Project>('/api/projects/open', { workDir: makeWorkDir('assets-project'), name: 'P' })
  if (!p.json.ok) throw new Error(p.json.error)
  const s = await POST<Session>('/api/sessions', { projectId: p.json.data.id, name: 'S' })
  if (!s.json.ok) throw new Error(s.json.error)
  return { project: p.json.data, session: s.json.data }
}

describe('POST /api/assets/upload', () => {
  it('uploads a text file and returns asset metadata', async () => {
    const { session } = await setupSession()

    const form = new FormData()
    form.append('sessionId', session.id)
    form.append('file', new File(['hello world'], 'test.txt', { type: 'text/plain' }))

    const result = await apiReq('POST', '/api/assets/upload', form)
    expect(result.status).toBe(201)
    expect(result.json.ok).toBe(true)
    if (!result.json.ok) return

    const asset = result.json.data as any
    expect(asset.id).toMatch(/^asset_/)
    expect(asset.sessionId).toBe(session.id)
    expect(asset.filename).toBe('test.txt')
    expect(asset.mimeType).toContain('text/plain')
    expect(asset.sizeBytes).toBe(11)
    expect(typeof asset.savedPath).toBe('string')
    expect(asset.savedPath).toContain(session.id)
  })

  it('rejects missing sessionId', async () => {
    const form = new FormData()
    form.append('file', new File(['x'], 'x.txt', { type: 'text/plain' }))
    const result = await apiReq('POST', '/api/assets/upload', form)
    expect(result.status).toBe(400)
  })

  it('rejects missing file', async () => {
    const { session } = await setupSession()
    const form = new FormData()
    form.append('sessionId', session.id)
    const result = await apiReq('POST', '/api/assets/upload', form)
    expect(result.status).toBe(400)
  })

  it('returns asset via GET /api/assets/:id', async () => {
    const { session } = await setupSession()
    const form = new FormData()
    form.append('sessionId', session.id)
    form.append('file', new File(['data'], 'doc.md', { type: 'text/markdown' }))

    const upload = await apiReq('POST', '/api/assets/upload', form)
    expect(upload.json.ok).toBe(true)
    if (!upload.json.ok) return

    const asset = upload.json.data as any
    const fetched = await GET(`/api/assets/${asset.id}`)
    expect(fetched.status).toBe(200)
    expect(fetched.json.ok).toBe(true)
    if (!fetched.json.ok) return
    expect((fetched.json.data as any).id).toBe(asset.id)
  })

  it('returns 404 for unknown asset', async () => {
    const result = await GET('/api/assets/asset_unknown')
    expect(result.status).toBe(404)
  })
})

describe('prependAttachmentPaths', () => {
  it('returns prompt unchanged when no attachments', () => {
    expect(prependAttachmentPaths('hello', [])).toBe('hello')
  })

  it('prepends image attachment', () => {
    const result = prependAttachmentPaths('describe this', [
      { filename: 'photo.png', savedPath: '/tmp/photo.png', mimeType: 'image/png' },
    ])
    expect(result).toBe('[User attached image: photo.png -> /tmp/photo.png]\n\ndescribe this')
  })

  it('prepends file attachment', () => {
    const result = prependAttachmentPaths('review this', [
      { filename: 'report.pdf', savedPath: '/tmp/report.pdf', mimeType: 'application/pdf' },
    ])
    expect(result).toBe('[User attached file: report.pdf -> /tmp/report.pdf]\n\nreview this')
  })

  it('prepends video attachment', () => {
    const result = prependAttachmentPaths('watch this', [
      { filename: 'clip.mp4', savedPath: '/tmp/clip.mp4', mimeType: 'video/mp4' },
    ])
    expect(result).toBe('[User attached video: clip.mp4 -> /tmp/clip.mp4]\n\nwatch this')
  })

  it('prepends multiple attachments', () => {
    const result = prependAttachmentPaths('see both', [
      { filename: 'a.png', savedPath: '/tmp/a.png', mimeType: 'image/png' },
      { filename: 'b.txt', savedPath: '/tmp/b.txt', mimeType: 'text/plain' },
    ])
    expect(result).toContain('[User attached image: a.png -> /tmp/a.png]')
    expect(result).toContain('[User attached file: b.txt -> /tmp/b.txt]')
    expect(result).toContain('see both')
  })
})

import { randomBytes } from 'node:crypto'
import type { UploadedAsset } from '@pluse/types'
import { getDb } from '../db'

function genId(): string {
  return 'asset_' + randomBytes(8).toString('hex')
}

type AssetRow = {
  id: string
  quest_id: string
  filename: string
  saved_path: string
  mime_type: string
  size_bytes: number
  created_at: string
}

function rowToAsset(row: AssetRow): UploadedAsset {
  return {
    id: row.id,
    questId: row.quest_id,
    filename: row.filename,
    savedPath: row.saved_path,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
  }
}

export function createAsset(input: Omit<UploadedAsset, 'id' | 'createdAt'>): UploadedAsset {
  const db = getDb()
  const id = genId()
  const createdAt = new Date().toISOString()
  db.run(
    `INSERT INTO assets (
      id, quest_id, filename, saved_path, mime_type, size_bytes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, input.questId, input.filename, input.savedPath, input.mimeType, input.sizeBytes, createdAt],
  )
  return { id, createdAt, ...input }
}

export function getAsset(id: string): UploadedAsset | null {
  const db = getDb()
  const row = db.query<AssetRow, [string]>('SELECT * FROM assets WHERE id = ?').get(id)
  return row ? rowToAsset(row) : null
}

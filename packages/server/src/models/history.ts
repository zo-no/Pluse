import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { SessionEvent } from '@melody-sync/types'
import { getHistoryRoot } from '../support/paths'

function sessionDir(sessionId: string): string {
  return resolve(getHistoryRoot(), sessionId)
}

function eventsDir(sessionId: string): string {
  return resolve(sessionDir(sessionId), 'events')
}

function metaPath(sessionId: string): string {
  return resolve(sessionDir(sessionId), 'meta.json')
}

function seqFilename(seq: number): string {
  return `${seq.toString().padStart(9, '0')}.json`
}

function atomicWrite(filePath: string, content: string): void {
  const tmp = `${filePath}.tmp`
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(tmp, content, 'utf8')
  renameSync(tmp, filePath)
}

interface HistoryMeta {
  latestSeq: number
  size: number
  lastEventAt: string
}

export function getHistoryMeta(sessionId: string): HistoryMeta | null {
  try {
    return JSON.parse(readFileSync(metaPath(sessionId), 'utf8')) as HistoryMeta
  } catch {
    return null
  }
}

export function listEvents(
  sessionId: string,
  opts: { limit?: number; offset?: number } = {},
): SessionEvent[] {
  let files: string[]
  try {
    files = readdirSync(eventsDir(sessionId))
      .filter((file) => file.endsWith('.json'))
      .sort()
  } catch {
    return []
  }

  const offset = opts.offset ?? 0
  const limit = opts.limit ?? files.length
  return files.slice(offset, offset + limit).flatMap((file) => {
    try {
      return [JSON.parse(readFileSync(resolve(eventsDir(sessionId), file), 'utf8')) as SessionEvent]
    } catch {
      return []
    }
  })
}

export function appendEvent(sessionId: string, event: Omit<SessionEvent, 'seq'>): SessionEvent {
  const meta = getHistoryMeta(sessionId)
  const nextSeq = (meta?.latestSeq ?? -1) + 1
  const full: SessionEvent = { ...event, seq: nextSeq }

  atomicWrite(resolve(eventsDir(sessionId), seqFilename(nextSeq)), JSON.stringify(full))

  let size = meta?.size ?? 0
  try {
    size = statSync(eventsDir(sessionId)).size
  } catch {}

  atomicWrite(metaPath(sessionId), JSON.stringify({
    latestSeq: nextSeq,
    size,
    lastEventAt: new Date().toISOString(),
  }))

  return full
}

export function getEventBody(sessionId: string, seq: number): string | null {
  try {
    return readFileSync(resolve(eventsDir(sessionId), seqFilename(seq)), 'utf8')
  } catch {
    return null
  }
}

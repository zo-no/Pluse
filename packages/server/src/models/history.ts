import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { QuestEvent } from '@pluse/types'
import { getHistoryRoot } from '../support/paths'

function questDir(questId: string): string {
  return resolve(getHistoryRoot(), questId)
}

function eventsDir(questId: string): string {
  return resolve(questDir(questId), 'events')
}

function metaPath(questId: string): string {
  return resolve(questDir(questId), 'meta.json')
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

export function getHistoryMeta(questId: string): HistoryMeta | null {
  try {
    return JSON.parse(readFileSync(metaPath(questId), 'utf8')) as HistoryMeta
  } catch {
    return null
  }
}

export function listEvents(
  questId: string,
  opts: { limit?: number; offset?: number } = {},
): QuestEvent[] {
  let files: string[]
  try {
    files = readdirSync(eventsDir(questId))
      .filter((file) => file.endsWith('.json'))
      .sort()
  } catch {
    return []
  }

  const offset = opts.offset ?? 0
  const limit = opts.limit ?? files.length
  return files.slice(offset, offset + limit).flatMap((file) => {
    try {
      return [JSON.parse(readFileSync(resolve(eventsDir(questId), file), 'utf8')) as QuestEvent]
    } catch {
      return []
    }
  })
}

export function appendEvent(questId: string, event: Omit<QuestEvent, 'seq'>): QuestEvent {
  const meta = getHistoryMeta(questId)
  const nextSeq = (meta?.latestSeq ?? -1) + 1
  const full: QuestEvent = { ...event, seq: nextSeq }

  atomicWrite(resolve(eventsDir(questId), seqFilename(nextSeq)), JSON.stringify(full))

  let size = meta?.size ?? 0
  try {
    size = statSync(eventsDir(questId)).size
  } catch {}

  atomicWrite(metaPath(questId), JSON.stringify({
    latestSeq: nextSeq,
    size,
    lastEventAt: new Date().toISOString(),
  }))

  return full
}

export function getEventBody(questId: string, seq: number): string | null {
  try {
    return readFileSync(resolve(eventsDir(questId), seqFilename(seq)), 'utf8')
  } catch {
    return null
  }
}

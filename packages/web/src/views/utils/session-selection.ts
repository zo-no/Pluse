import type { Quest } from '@pluse/types'
import * as api from '@/api/client'

const LAST_SESSION_STORAGE_KEY = 'pluse:last-session-by-project'

type SessionSelectionMap = Record<string, string>

function readStoredSelections(): SessionSelectionMap {
  if (typeof window === 'undefined') return {}
  const raw = window.localStorage.getItem(LAST_SESSION_STORAGE_KEY)
  if (!raw) return {}

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([projectId, questId]) => Boolean(projectId) && typeof questId === 'string' && questId.trim().length > 0,
      ),
    )
  } catch {
    return {}
  }
}

function writeStoredSelections(value: SessionSelectionMap): void {
  if (typeof window === 'undefined') return
  const entries = Object.entries(value).filter(([projectId, questId]) => projectId && questId)
  if (entries.length === 0) {
    window.localStorage.removeItem(LAST_SESSION_STORAGE_KEY)
    return
  }
  window.localStorage.setItem(LAST_SESSION_STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)))
}

export function rememberLastSession(projectId: string, questId: string): void {
  if (!projectId || !questId || typeof window === 'undefined') return
  const current = readStoredSelections()
  if (current[projectId] === questId) return
  current[projectId] = questId
  writeStoredSelections(current)
}

export function clearRememberedSession(projectId: string, questId?: string): void {
  if (!projectId || typeof window === 'undefined') return
  const current = readStoredSelections()
  if (!(projectId in current)) return
  if (questId && current[projectId] !== questId) return
  delete current[projectId]
  writeStoredSelections(current)
}

export function getPreferredSessionFromList(
  projectId: string,
  sessions: Array<Pick<Quest, 'id'>>,
): string | null {
  if (sessions.length === 0) {
    clearRememberedSession(projectId)
    return null
  }

  const current = readStoredSelections()
  const rememberedQuestId = current[projectId]
  if (rememberedQuestId && sessions.some((quest) => quest.id === rememberedQuestId)) {
    return rememberedQuestId
  }

  if (rememberedQuestId) {
    delete current[projectId]
    writeStoredSelections(current)
  }

  return sessions[0]?.id ?? null
}

export async function getPreferredSession(projectId: string): Promise<Quest | null> {
  const current = readStoredSelections()
  const rememberedQuestId = current[projectId]

  if (rememberedQuestId) {
    const remembered = await api.getQuest(rememberedQuestId)
    if (
      remembered.ok
      && remembered.data.projectId === projectId
      && remembered.data.kind === 'session'
      && !remembered.data.deleted
    ) {
      return remembered.data
    }

    delete current[projectId]
    writeStoredSelections(current)
  }

  const result = await api.getQuests({ projectId, kind: 'session', deleted: false, limit: 1 })
  if (!result.ok) return null
  const nextQuest = result.data[0] ?? null
  if (!nextQuest) clearRememberedSession(projectId)
  return nextQuest
}

export async function getPreferredSessionId(projectId: string): Promise<string | null> {
  const quest = await getPreferredSession(projectId)
  return quest?.id ?? null
}

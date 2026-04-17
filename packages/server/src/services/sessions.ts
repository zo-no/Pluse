import type { CreateSessionInput, Session, UpdateSessionInput } from '@pluse/types'
import { createSession, deleteSession, getSession, listSessions, updateSession } from '../models/session'
import { emit } from './events'

export function listSessionViews(projectId?: string, archived?: boolean): Session[] {
  return listSessions({ projectId, archived })
}

export function createSessionWithEffects(input: CreateSessionInput): Session {
  const session = createSession(input)
  emit({ type: 'session_updated', data: { sessionId: session.id, projectId: session.projectId } })
  return session
}

export function updateSessionWithEffects(id: string, input: UpdateSessionInput): Session {
  const session = updateSession(id, input)
  emit({ type: 'session_updated', data: { sessionId: session.id, projectId: session.projectId } })
  return session
}

export function deleteSessionWithEffects(id: string): void {
  const session = getSession(id)
  if (!session) return
  deleteSession(id)
  emit({ type: 'session_updated', data: { sessionId: id, projectId: session.projectId } })
}

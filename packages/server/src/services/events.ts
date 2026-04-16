export type PulseEvent =
  | { type: 'connected'; data: { ts: string } }
  | { type: 'project_opened' | 'project_updated'; data: { projectId: string } }
  | { type: 'session_updated'; data: { sessionId: string; projectId: string } }
  | { type: 'task_created' | 'task_updated' | 'task_deleted'; data: { taskId: string; projectId: string; sessionId?: string } }
  | { type: 'run_line'; data: { taskId: string; projectId: string; runId: string; line: string; ts: string } }

type Listener = (event: PulseEvent) => void

const listeners = new Set<Listener>()

export function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function emit(event: PulseEvent): void {
  for (const listener of listeners) {
    listener(event)
  }
}

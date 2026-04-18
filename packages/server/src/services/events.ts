import type { SseMessage } from '@pluse/types'

export type PluseEvent = SseMessage

type Listener = (event: PluseEvent) => void

const listeners = new Set<Listener>()

export function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function emit(event: PluseEvent): void {
  for (const listener of listeners) {
    listener(event)
  }
}

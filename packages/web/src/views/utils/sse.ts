import type { SseMessage } from '@pluse/types'

export function parseSseMessage(raw: string): SseMessage | null {
  try {
    const parsed = JSON.parse(raw) as SseMessage
    return parsed && typeof parsed === 'object' && 'type' in parsed ? parsed : null
  } catch {
    return null
  }
}

import { Hono } from 'hono'
import type { SseMessage } from '@pluse/types'
import { subscribe } from '../../services/events'

export const eventsRouter = new Hono()

eventsRouter.get('/events', (c) => {
  const projectId = c.req.query('projectId')
  const questId = c.req.query('questId')

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder()
      const send = (data: string) => {
        try {
          controller.enqueue(enc.encode(`data: ${data}\n\n`))
        } catch {}
      }

      send(JSON.stringify({ type: 'connected', data: { ts: new Date().toISOString() } }))

      const unsub = subscribe((event: SseMessage) => {
        if (projectId && 'projectId' in event.data && event.data.projectId !== projectId) return
        if (questId && 'questId' in event.data && event.data.questId !== questId) return
        if (questId && 'originQuestId' in event.data && event.data.originQuestId !== questId) return
        send(JSON.stringify(event))
      })

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(enc.encode(': heartbeat\n\n'))
        } catch {
          clearInterval(heartbeat)
        }
      }, 30_000)

      c.req.raw.signal.addEventListener('abort', () => {
        unsub()
        clearInterval(heartbeat)
        try { controller.close() } catch {}
      })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
})

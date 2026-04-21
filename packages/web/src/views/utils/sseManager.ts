import type { SseMessage } from '@pluse/types'
import { parseSseMessage } from './sse'

type SseSubscription = {
  id: number
  handler: (event: SseMessage) => void
  onReconnect: () => void
}

type SubscribeOptions = {
  onReconnect?: () => void
}

const CLOSE_DELAY_MS = 200
const INITIAL_RECONNECT_DELAY_MS = 1000
const MAX_RECONNECT_DELAY_MS = 30_000

class SseManager {
  private subscribers = new Map<number, SseSubscription>()
  private source: EventSource | null = null
  private reconnectTimer: number | null = null
  private closeTimer: number | null = null
  private nextId = 1
  private reconnectAttempt = 0
  private awaitingReconnect = false
  private hasConnected = false

  subscribe(handler: (event: SseMessage) => void, options: SubscribeOptions = {}): () => void {
    this.cancelClose()

    const id = this.nextId
    this.nextId += 1
    this.subscribers.set(id, {
      id,
      handler,
      onReconnect: options.onReconnect ?? noop,
    })
    this.ensureConnected()

    return () => {
      this.subscribers.delete(id)
      if (this.subscribers.size === 0) this.scheduleClose()
    }
  }

  private ensureConnected(): void {
    if (this.source || this.reconnectTimer || this.subscribers.size === 0) return
    this.connect()
  }

  private connect(): void {
    if (this.source || this.subscribers.size === 0) return

    const source = new EventSource('/api/events')
    this.source = source

    source.onmessage = (message) => {
      const event = parseSseMessage(message.data)
      if (!event) return

      if (event.type === 'connected') this.handleConnected()
      this.dispatch(event)
    }

    source.onerror = () => {
      if (this.source !== source) return

      this.cleanupSource({ close: true })
      if (this.subscribers.size === 0) {
        this.awaitingReconnect = false
        return
      }

      if (this.hasConnected) this.awaitingReconnect = true
      this.scheduleReconnect()
    }
  }

  private handleConnected(): void {
    const shouldNotifyReconnect = this.awaitingReconnect

    this.awaitingReconnect = false
    this.hasConnected = true
    this.reconnectAttempt = 0

    if (!shouldNotifyReconnect) return
    for (const subscriber of this.subscribers.values()) {
      subscriber.onReconnect()
    }
  }

  private dispatch(event: SseMessage): void {
    for (const subscriber of this.subscribers.values()) {
      subscriber.handler(event)
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer != null || this.subscribers.size === 0) return

    const delay = Math.min(INITIAL_RECONNECT_DELAY_MS * (2 ** this.reconnectAttempt), MAX_RECONNECT_DELAY_MS)
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null
      this.reconnectAttempt += 1
      this.ensureConnected()
    }, delay)
  }

  private scheduleClose(): void {
    if (this.closeTimer != null) return

    this.closeTimer = window.setTimeout(() => {
      this.closeTimer = null
      if (this.subscribers.size > 0) return

      this.cancelReconnect()
      this.cleanupSource({ close: true })
      this.awaitingReconnect = false
    }, CLOSE_DELAY_MS)
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer == null) return
    window.clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }

  private cancelClose(): void {
    if (this.closeTimer == null) return
    window.clearTimeout(this.closeTimer)
    this.closeTimer = null
  }

  private cleanupSource({ close }: { close: boolean }): void {
    if (!this.source) return

    const source = this.source
    this.source = null
    source.onmessage = null
    source.onerror = null
    if (close) source.close()
  }
}

function noop(): void {}

export const sseManager = new SseManager()

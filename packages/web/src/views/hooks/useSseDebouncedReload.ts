import { useEffect, useRef } from 'react'
import type { SseMessage } from '@pluse/types'
import { useSseEvent } from './useSseEvent'

type UseSseDebouncedReloadOptions = {
  shouldReload: (event: SseMessage) => boolean
  onReload: () => void
  onReconnect?: () => void
  delay?: number
}

/**
 * Subscribes to SSE events, debounces matching events, and calls `onReload`.
 * Replaces the repeated `pendingRef + timerRef + setTimeout(300)` pattern.
 */
export function useSseDebouncedReload({
  shouldReload,
  onReload,
  onReconnect,
  delay = 300,
}: UseSseDebouncedReloadOptions): void {
  const timerRef = useRef<number | null>(null)
  const pendingRef = useRef(false)

  useSseEvent(
    (event) => {
      if (!shouldReload(event)) return
      pendingRef.current = true
      if (timerRef.current) window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => {
        if (!pendingRef.current) return
        pendingRef.current = false
        timerRef.current = null
        onReload()
      }, delay)
    },
    {
      onReconnect: () => {
        pendingRef.current = false
        if (timerRef.current) {
          window.clearTimeout(timerRef.current)
          timerRef.current = null
        }
        onReconnect?.()
      },
    },
  )

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
    }
  }, [])
}

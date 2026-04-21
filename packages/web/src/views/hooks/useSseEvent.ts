import { useEffect, useEffectEvent } from 'react'
import type { SseMessage } from '@pluse/types'
import { sseManager } from '@/views/utils/sseManager'

type UseSseEventOptions = {
  onReconnect?: () => void
}

export function useSseEvent(
  handler: (event: SseMessage) => void,
  options?: UseSseEventOptions,
): void {
  const onMessage = useEffectEvent(handler)
  const onReconnect = useEffectEvent(() => {
    options?.onReconnect?.()
  })

  useEffect(() => {
    return sseManager.subscribe(
      (event) => {
        onMessage(event)
      },
      {
        onReconnect: () => {
          onReconnect()
        },
      },
    )
  }, [])
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SseMessage, Todo } from '@pluse/types'
import * as api from '@/api/client'
import { useSseEvent } from '@/views/hooks/useSseEvent'
import { projectQuestPlanRows, summarizeQuestPlanRows, type QuestPlanRow } from '@/views/utils/todo'

type QuestPlanSummary = ReturnType<typeof summarizeQuestPlanRows>

export interface UseQuestPlanResult {
  items: Todo[]
  rows: QuestPlanRow[]
  summary: QuestPlanSummary
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  setTodoDone: (id: string, done: boolean) => Promise<boolean>
}

function isQuestPlanEvent(event: SseMessage, questId: string): boolean {
  if (event.type !== 'todo_updated' && event.type !== 'todo_deleted') return false
  return (event.data as { originQuestId?: string }).originQuestId === questId
}

export function useQuestPlan(questId?: string | null): UseQuestPlanResult {
  const [items, setItems] = useState<Todo[]>([])
  const [loading, setLoading] = useState(Boolean(questId))
  const [error, setError] = useState<string | null>(null)
  const requestSeqRef = useRef(0)

  const refresh = useCallback(async () => {
    const requestId = requestSeqRef.current + 1
    requestSeqRef.current = requestId

    if (!questId) {
      setItems([])
      setError(null)
      setLoading(false)
      return
    }

    setLoading(true)
    const result = await api.getQuestProgress(questId)
    if (requestId !== requestSeqRef.current) return

    if (!result.ok) {
      setError(result.error)
      setItems([])
      setLoading(false)
      return
    }

    setItems(result.data)
    setError(null)
    setLoading(false)
  }, [questId])

  useEffect(() => {
    void refresh()
    return () => {
      requestSeqRef.current += 1
    }
  }, [refresh])

  useSseEvent(
    (event) => {
      if (!questId || !isQuestPlanEvent(event, questId)) return
      void refresh()
    },
    {
      onReconnect: () => {
        if (!questId) return
        void refresh()
      },
    },
  )

  const rows = useMemo(() => projectQuestPlanRows(items), [items])
  const summary = useMemo(() => summarizeQuestPlanRows(rows), [rows])

  const setTodoDone = useCallback(async (id: string, done: boolean) => {
    const result = await api.updateTodo(id, { status: done ? 'done' : 'pending' })
    if (!result.ok) {
      setError(result.error)
      return false
    }
    await refresh()
    return true
  }, [refresh])

  return {
    items,
    rows,
    summary,
    loading,
    error,
    refresh,
    setTodoDone,
  }
}

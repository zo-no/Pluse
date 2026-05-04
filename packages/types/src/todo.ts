export type TodoStatus = 'pending' | 'doing' | 'done' | 'cancelled'
export type TodoCreatedBy = 'human' | 'ai' | 'system'
export type TodoRepeat = 'none' | 'daily' | 'weekly' | 'monthly'
export type TodoPriority = 'urgent' | 'high' | 'normal' | 'low'

export interface Todo {
  id: string
  projectId: string
  createdBy: TodoCreatedBy
  originQuestId?: string
  title: string
  description?: string
  waitingInstructions?: string
  dueAt?: string
  repeat: TodoRepeat
  priority: TodoPriority
  tags: string[]
  status: TodoStatus
  activeForm?: string
  order: number
  deleted?: boolean
  deletedAt?: string
  createdAt: string
  updatedAt: string
}

export interface CreateTodoInput {
  projectId: string
  createdBy?: TodoCreatedBy
  originQuestId?: string | null
  title: string
  description?: string
  waitingInstructions?: string
  dueAt?: string
  repeat?: TodoRepeat
  priority?: TodoPriority
  tags?: string[]
  status?: TodoStatus
  activeForm?: string
  order?: number
  deleted?: boolean
}

export interface UpdateTodoInput {
  originQuestId?: string | null
  title?: string
  description?: string | null
  waitingInstructions?: string | null
  dueAt?: string | null
  repeat?: TodoRepeat
  priority?: TodoPriority
  tags?: string[] | null
  status?: TodoStatus
  activeForm?: string | null
  order?: number
  deleted?: boolean
}

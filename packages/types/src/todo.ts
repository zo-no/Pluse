export type TodoStatus = 'pending' | 'done' | 'cancelled'
export type TodoCreatedBy = 'human' | 'ai' | 'system'
export type TodoRepeat = 'none' | 'daily' | 'weekly' | 'monthly'

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
  status: TodoStatus
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
  status?: TodoStatus
  deleted?: boolean
}

export interface UpdateTodoInput {
  originQuestId?: string | null
  title?: string
  description?: string | null
  waitingInstructions?: string | null
  dueAt?: string | null
  repeat?: TodoRepeat
  status?: TodoStatus
  deleted?: boolean
}

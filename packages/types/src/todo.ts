export type TodoStatus = 'pending' | 'done' | 'cancelled'
export type TodoCreatedBy = 'human' | 'ai' | 'system'

export interface Todo {
  id: string
  projectId: string
  createdBy: TodoCreatedBy
  originQuestId?: string
  title: string
  description?: string
  waitingInstructions?: string
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
  status?: TodoStatus
  deleted?: boolean
}

export interface UpdateTodoInput {
  originQuestId?: string | null
  title?: string
  description?: string | null
  waitingInstructions?: string | null
  status?: TodoStatus
  deleted?: boolean
}

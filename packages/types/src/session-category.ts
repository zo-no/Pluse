export interface SessionCategory {
  id: string
  projectId: string
  name: string
  description?: string
  collapsed: boolean
  createdAt: string
  updatedAt: string
}

export interface CreateSessionCategoryInput {
  projectId: string
  name: string
  description?: string
  collapsed?: boolean
}

export interface UpdateSessionCategoryInput {
  name?: string | null
  description?: string | null
  collapsed?: boolean
}

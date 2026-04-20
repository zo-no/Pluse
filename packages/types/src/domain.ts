export interface Domain {
  id: string
  name: string
  description?: string
  icon?: string
  color?: string
  orderIndex: number
  deleted?: boolean
  deletedAt?: string
  createdAt: string
  updatedAt: string
}

export interface CreateDomainInput {
  name: string
  description?: string
  icon?: string
  color?: string
  orderIndex?: number
}

export interface UpdateDomainInput {
  name?: string
  description?: string | null
  icon?: string | null
  color?: string | null
  orderIndex?: number | null
}

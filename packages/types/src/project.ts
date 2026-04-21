export type ProjectVisibility = 'user' | 'system'

export interface ProjectManifest {
  projectId: string
  name: string
  icon?: string
  goal?: string
  workDir: string
  createdAt: string
  updatedAt: string
}

export interface Project {
  id: string
  name: string
  icon?: string
  goal?: string
  description?: string
  workDir: string
  systemPrompt?: string
  domainId?: string
  archived: boolean
  pinned: boolean
  visibility: ProjectVisibility
  createdAt: string
  updatedAt: string
}

export interface CreateProjectInput {
  name: string
  icon?: string
  workDir: string
  goal?: string
  description?: string
  systemPrompt?: string
  domainId?: string | null
  pinned?: boolean
}

export interface OpenProjectInput {
  workDir: string
  name?: string
  icon?: string
  goal?: string
  description?: string
  systemPrompt?: string
  domainId?: string | null
  pinned?: boolean
}

export interface UpdateProjectInput {
  name?: string
  icon?: string | null
  goal?: string | null
  description?: string | null
  systemPrompt?: string | null
  domainId?: string | null
  pinned?: boolean
  archived?: boolean
}

import type {
  ApiResult,
  AuthMe,
  CreateProjectInput,
  CreateSessionInput,
  CreateTaskInput,
  OpenProjectInput,
  PagedResult,
  Project,
  ProjectOverview,
  Run,
  RuntimeModelCatalog,
  RuntimeTool,
  SendMessageInput,
  Session,
  SessionEvent,
  Task,
  UpdateProjectInput,
  UpdateSessionInput,
  UpdateTaskInput,
} from '@melody-sync/types'

const BASE = '/api'

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const prefix = `${name}=`
  for (const part of document.cookie.split(';')) {
    const value = part.trim()
    if (value.startsWith(prefix)) return value.slice(prefix.length)
  }
  return null
}

async function request<T>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
  const headers = new Headers()
  if (body !== undefined) {
    headers.set('Content-Type', 'application/json')
  }
  if (method !== 'GET' && method !== 'HEAD') {
    const csrfToken = getCookie('pulse_csrf')
    if (csrfToken) headers.set('X-CSRF-Token', csrfToken)
  }

  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      credentials: 'include',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }

  let json: unknown
  try {
    json = await res.json()
  } catch {
    return { ok: false, error: `HTTP ${res.status}: invalid JSON response` }
  }

  return json as ApiResult<T>
}

export function getAuthMe(): Promise<ApiResult<AuthMe>> {
  return request<AuthMe>('GET', '/auth/me')
}

export function login(body: { username?: string; password?: string; token?: string }): Promise<ApiResult<{ ok: true }>> {
  return fetch('/auth/login', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((res) => res.json() as Promise<ApiResult<{ ok: true }>>)
}

export function logout(): Promise<ApiResult<{ ok: true }>> {
  const csrfToken = getCookie('pulse_csrf')
  return fetch('/auth/logout', {
    method: 'POST',
    credentials: 'include',
    headers: csrfToken ? { 'X-CSRF-Token': csrfToken } : undefined,
  }).then((res) => res.json() as Promise<ApiResult<{ ok: true }>>)
}

export function getProjects(): Promise<ApiResult<Project[]>> {
  return request<Project[]>('GET', '/projects')
}

export function openProject(input: OpenProjectInput): Promise<ApiResult<Project>> {
  return request<Project>('POST', '/projects/open', input)
}

export function getProject(id: string): Promise<ApiResult<Project>> {
  return request<Project>('GET', `/projects/${id}`)
}

export function getProjectOverview(id: string): Promise<ApiResult<ProjectOverview>> {
  return request<ProjectOverview>('GET', `/projects/${id}/overview`)
}

export function updateProject(id: string, input: UpdateProjectInput): Promise<ApiResult<Project>> {
  return request<Project>('PATCH', `/projects/${id}`, input)
}

export function archiveProject(id: string): Promise<ApiResult<Project>> {
  return request<Project>('POST', `/projects/${id}/archive`)
}

export function getSessions(opts?: { projectId?: string; archived?: boolean }): Promise<ApiResult<Session[]>> {
  const params = new URLSearchParams()
  if (opts?.projectId) params.set('projectId', opts.projectId)
  if (opts?.archived !== undefined) params.set('archived', String(opts.archived))
  return request<Session[]>('GET', `/sessions${params.toString() ? `?${params.toString()}` : ''}`)
}

export function getSession(id: string): Promise<ApiResult<Session>> {
  return request<Session>('GET', `/sessions/${id}`)
}

export function createSession(input: CreateSessionInput): Promise<ApiResult<Session>> {
  return request<Session>('POST', '/sessions', input)
}

export function updateSession(id: string, input: UpdateSessionInput): Promise<ApiResult<Session>> {
  return request<Session>('PATCH', `/sessions/${id}`, input)
}

export function deleteSession(id: string): Promise<ApiResult<{ deleted: boolean }>> {
  return request<{ deleted: boolean }>('DELETE', `/sessions/${id}`)
}

export function getSessionEvents(id: string): Promise<ApiResult<PagedResult<SessionEvent>>> {
  return request<PagedResult<SessionEvent>>('GET', `/sessions/${id}/events`)
}

export function sendMessage(id: string, input: SendMessageInput): Promise<ApiResult<{ queued: boolean; run: Run | null; session: Session }>> {
  return request('POST', `/sessions/${id}/messages`, input)
}

export function getSessionRuns(id: string): Promise<ApiResult<Run[]>> {
  return request<Run[]>('GET', `/sessions/${id}/runs`)
}

export function cancelRun(id: string): Promise<ApiResult<Run>> {
  return request<Run>('POST', `/runs/${id}/cancel`)
}

export function getTasks(params: {
  projectId?: string
  sessionId?: string
  surface?: string
  visibleInChat?: boolean
  kind?: string
  status?: string
} = {}): Promise<ApiResult<Task[]>> {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value))
  }
  return request<Task[]>('GET', `/tasks${search.toString() ? `?${search.toString()}` : ''}`)
}

export function createTask(input: CreateTaskInput): Promise<ApiResult<Task>> {
  return request<Task>('POST', '/tasks', input)
}

export function updateTask(id: string, input: UpdateTaskInput): Promise<ApiResult<Task>> {
  return request<Task>('PATCH', `/tasks/${id}`, input)
}

export function runTask(id: string): Promise<ApiResult<{ ok: true }>> {
  return request<{ ok: true }>('POST', `/tasks/${id}/run`)
}

export function completeTask(id: string, output?: string): Promise<ApiResult<Task>> {
  return request<Task>('POST', `/tasks/${id}/done`, { output })
}

export function cancelTask(id: string): Promise<ApiResult<Task>> {
  return request<Task>('POST', `/tasks/${id}/cancel`)
}

export function deleteTask(id: string): Promise<ApiResult<{ deleted: boolean }>> {
  return request<{ deleted: boolean }>('DELETE', `/tasks/${id}`)
}

export function getRuntimeTools(): Promise<ApiResult<RuntimeTool[]>> {
  return request<RuntimeTool[]>('GET', '/tools')
}

export function getRuntimeModelCatalog(tool: string): Promise<ApiResult<RuntimeModelCatalog>> {
  return request<RuntimeModelCatalog>('GET', `/models?tool=${encodeURIComponent(tool)}`)
}

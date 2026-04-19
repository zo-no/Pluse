import type {
  ApiResult,
  AuthMe,
  CreateQuestInput,
  CreateTodoInput,
  OpenProjectInput,
  PagedResult,
  Project,
  ProjectOverview,
  Quest,
  QuestEvent,
  QuestOp,
  Run,
  RuntimeModelCatalog,
  RuntimeTool,
  SendMessageInput,
  AppSettings,
  Todo,
  UpdateProjectInput,
  UpdateQuestInput,
  UpdateTodoInput,
  UpdateAppSettingsInput,
  UploadedAsset,
} from '@pluse/types'

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

export function deleteProject(id: string): Promise<ApiResult<{ deleted: boolean }>> {
  return request<{ deleted: boolean }>('DELETE', `/projects/${id}`)
}

export function getSettings(): Promise<ApiResult<AppSettings>> {
  return request<AppSettings>('GET', '/settings')
}

export function updateSettings(input: UpdateAppSettingsInput): Promise<ApiResult<AppSettings>> {
  return request<AppSettings>('PATCH', '/settings', input)
}

export function getQuests(params: {
  projectId?: string
  kind?: Quest['kind']
  status?: Quest['status']
  search?: string
  deleted?: boolean
} = {}): Promise<ApiResult<Quest[]>> {
  const search = new URLSearchParams()
  if (params.projectId) search.set('projectId', params.projectId)
  if (params.kind) search.set('kind', params.kind)
  if (params.status) search.set('status', params.status)
  if (params.search) search.set('search', params.search)
  if (params.deleted !== undefined) search.set('deleted', String(params.deleted))
  return request<Quest[]>('GET', `/quests${search.toString() ? `?${search.toString()}` : ''}`)
}

export function getQuest(id: string): Promise<ApiResult<Quest>> {
  return request<Quest>('GET', `/quests/${id}`)
}

export function createQuest(input: CreateQuestInput): Promise<ApiResult<Quest>> {
  return request<Quest>('POST', '/quests', input)
}

export function updateQuest(id: string, input: UpdateQuestInput): Promise<ApiResult<Quest>> {
  return request<Quest>('PATCH', `/quests/${id}`, input)
}

export function deleteQuest(id: string): Promise<ApiResult<{ deleted: boolean }>> {
  return request<{ deleted: boolean }>('DELETE', `/quests/${id}`)
}

export function getQuestEvents(id: string): Promise<ApiResult<PagedResult<QuestEvent>>> {
  return request<PagedResult<QuestEvent>>('GET', `/quests/${id}/events`)
}

export function getQuestOps(id: string): Promise<ApiResult<QuestOp[]>> {
  return request<QuestOp[]>('GET', `/quests/${id}/ops`)
}

export function sendQuestMessage(id: string, input: SendMessageInput): Promise<ApiResult<{ queued: boolean; run: Run | null; quest: Quest | null }>> {
  return request('POST', `/quests/${id}/messages`, input)
}

export function startQuestRun(id: string, input: { requestId?: string; trigger?: 'manual' | 'automation'; triggeredBy?: 'human' | 'scheduler' | 'api' | 'cli' } = {}): Promise<ApiResult<{ skipped: boolean; run: Run | null; quest: Quest | null }>> {
  return request('POST', `/quests/${id}/run`, input)
}

export function clearQuestQueue(id: string): Promise<ApiResult<Quest>> {
  return request<Quest>('DELETE', `/quests/${id}/queue`)
}

export function cancelQueuedRequest(id: string, requestId: string): Promise<ApiResult<Quest>> {
  return request<Quest>('DELETE', `/quests/${id}/queue/${encodeURIComponent(requestId)}`)
}

export function getQuestRuns(id: string): Promise<ApiResult<Run[]>> {
  return request<Run[]>('GET', `/quests/${id}/runs`)
}

export function getRun(id: string): Promise<ApiResult<Run>> {
  return request<Run>('GET', `/runs/${id}`)
}

export function getRunSpool(id: string): Promise<ApiResult<Array<{ id: number; ts: string; line: string }>>> {
  return request<Array<{ id: number; ts: string; line: string }>>('GET', `/runs/${id}/spool`)
}

export function cancelRun(id: string): Promise<ApiResult<Run>> {
  return request<Run>('POST', `/runs/${id}/cancel`)
}

export function getTodos(params: { projectId?: string; status?: Todo['status']; deleted?: boolean } = {}): Promise<ApiResult<Todo[]>> {
  const search = new URLSearchParams()
  if (params.projectId) search.set('projectId', params.projectId)
  if (params.status) search.set('status', params.status)
  if (params.deleted !== undefined) search.set('deleted', params.deleted ? 'true' : 'false')
  return request<Todo[]>('GET', `/todos${search.toString() ? `?${search.toString()}` : ''}`)
}

export function getTodo(id: string): Promise<ApiResult<Todo>> {
  return request<Todo>('GET', `/todos/${id}`)
}

export function createTodo(input: CreateTodoInput): Promise<ApiResult<Todo>> {
  return request<Todo>('POST', '/todos', input)
}

export function updateTodo(id: string, input: UpdateTodoInput): Promise<ApiResult<Todo>> {
  return request<Todo>('PATCH', `/todos/${id}`, input)
}

export function deleteTodo(id: string): Promise<ApiResult<{ deleted: boolean }>> {
  return request<{ deleted: boolean }>('DELETE', `/todos/${id}`)
}

export async function uploadAsset(questId: string, file: File): Promise<ApiResult<UploadedAsset>> {
  const form = new FormData()
  form.append('questId', questId)
  form.append('file', file)
  const csrfToken = getCookie('pulse_csrf')
  const headers = new Headers()
  if (csrfToken) headers.set('X-CSRF-Token', csrfToken)
  let res: Response
  try {
    res = await fetch(`${BASE}/assets/upload`, { method: 'POST', credentials: 'include', headers, body: form })
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
  return res.json() as Promise<ApiResult<UploadedAsset>>
}

export function getRuntimeTools(): Promise<ApiResult<RuntimeTool[]>> {
  return request<RuntimeTool[]>('GET', '/tools')
}

export function getRuntimeModelCatalog(tool: string): Promise<ApiResult<RuntimeModelCatalog>> {
  return request<RuntimeModelCatalog>('GET', `/models?tool=${encodeURIComponent(tool)}`)
}

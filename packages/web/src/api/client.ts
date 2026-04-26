import type {
  ApiResult,
  AuthMe,
  CreateDomainInput,
  CreateQuestInput,
  CreateReminderInput,
  CreateTodoInput,
  Domain,
  OpenProjectInput,
  PagedResult,
  Project,
  ProjectOverview,
  Quest,
  QuestEvent,
  QuestOp,
  Reminder,
  ReminderListOrder,
  ReminderProjectPrioritySetting,
  Run,
  RuntimeModelCatalog,
  RuntimeTool,
  SendMessageInput,
  SessionCategory,
  AppSettings,
  SetReminderProjectPriorityInput,
  SetReminderProjectPriorityResult,
  Todo,
  TokenUsageSummary,
  UpdateDomainInput,
  UpdateProjectInput,
  UpdateQuestInput,
  UpdateReminderInput,
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

interface RequestOptions {
  /** Request timeout in milliseconds. If exceeded, returns an error result. */
  timeout?: number
}

async function request<T>(method: string, path: string, body?: unknown, options?: RequestOptions): Promise<ApiResult<T>> {
  const headers = new Headers()
  if (body !== undefined) {
    headers.set('Content-Type', 'application/json')
  }
  if (method !== 'GET' && method !== 'HEAD') {
    const csrfToken = getCookie('pulse_csrf')
    if (csrfToken) headers.set('X-CSRF-Token', csrfToken)
  }

  const controller = options?.timeout != null ? new AbortController() : undefined
  const timer = controller != null
    ? setTimeout(() => controller.abort(), options!.timeout!)
    : undefined

  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      credentials: 'include',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller?.signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { ok: false, error: 'Request timed out' }
    }
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  } finally {
    if (timer != null) clearTimeout(timer)
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

export function getDomains(params: { deleted?: boolean } = {}): Promise<ApiResult<Domain[]>> {
  const search = new URLSearchParams()
  if (params.deleted !== undefined) search.set('deleted', params.deleted ? 'true' : 'false')
  return request<Domain[]>('GET', `/domains${search.toString() ? `?${search.toString()}` : ''}`)
}

export function createDomain(input: CreateDomainInput): Promise<ApiResult<Domain>> {
  return request<Domain>('POST', '/domains', input)
}

export function createDefaultDomains(): Promise<ApiResult<Domain[]>> {
  return request<Domain[]>('POST', '/domains/defaults')
}

export function updateDomain(id: string, input: UpdateDomainInput): Promise<ApiResult<Domain>> {
  return request<Domain>('PATCH', `/domains/${id}`, input)
}

export function deleteDomain(id: string): Promise<ApiResult<{ deleted: boolean }>> {
  return request<{ deleted: boolean }>('DELETE', `/domains/${id}`)
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

export function getProjectTokenSummary(id: string): Promise<ApiResult<TokenUsageSummary>> {
  return request<TokenUsageSummary>('GET', `/projects/${id}/token-summary`)
}

export function getSessionCategories(projectId: string): Promise<ApiResult<SessionCategory[]>> {
  return request<SessionCategory[]>('GET', `/projects/${projectId}/session-categories`)
}

export function createSessionCategory(projectId: string, input: { name: string; description?: string; collapsed?: boolean }): Promise<ApiResult<SessionCategory>> {
  return request<SessionCategory>('POST', `/projects/${projectId}/session-categories`, input)
}

export function updateSessionCategory(id: string, input: { name?: string | null; description?: string | null; collapsed?: boolean }): Promise<ApiResult<SessionCategory>> {
  return request<SessionCategory>('PATCH', `/session-categories/${id}`, input)
}

export function deleteSessionCategory(id: string): Promise<ApiResult<{ deleted: boolean }>> {
  return request<{ deleted: boolean }>('DELETE', `/session-categories/${id}`)
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

export interface HookItem {
  id: string
  enabled?: boolean
}

export interface HooksConfig {
  hooks: HookItem[]
}

export function getHooks(): Promise<ApiResult<HooksConfig>> {
  return request<HooksConfig>('GET', '/hooks')
}

export function updateHook(id: string, enabled: boolean): Promise<ApiResult<HooksConfig>> {
  return request<HooksConfig>('PATCH', `/hooks/${encodeURIComponent(id)}`, { enabled })
}

export function getQuests(params: {
  projectId?: string
  kind?: Quest['kind']
  status?: Quest['status']
  search?: string
  deleted?: boolean
  limit?: number
} = {}): Promise<ApiResult<Quest[]>> {
  const search = new URLSearchParams()
  if (params.projectId) search.set('projectId', params.projectId)
  if (params.kind) search.set('kind', params.kind)
  if (params.status) search.set('status', params.status)
  if (params.search) search.set('search', params.search)
  if (params.deleted !== undefined) search.set('deleted', String(params.deleted))
  if (params.limit !== undefined) search.set('limit', String(params.limit))
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

export function getProjectTags(projectId: string): Promise<ApiResult<{ tags: string[] }>> {
  return request<{ tags: string[] }>('GET', `/todos/tags?projectId=${encodeURIComponent(projectId)}`)
}

export function getReminders(params: {
  projectId?: string
  type?: Reminder['type']
  priority?: Reminder['priority']
  originQuestId?: string
  originRunId?: string
  time?: 'all' | 'due' | 'future'
  order?: ReminderListOrder
} = {}): Promise<ApiResult<Reminder[]>> {
  const search = new URLSearchParams()
  if (params.projectId) search.set('projectId', params.projectId)
  if (params.type) search.set('type', params.type)
  if (params.priority) search.set('priority', params.priority)
  if (params.originQuestId) search.set('originQuestId', params.originQuestId)
  if (params.originRunId) search.set('originRunId', params.originRunId)
  if (params.time) search.set('time', params.time)
  if (params.order) search.set('order', params.order)
  return request<Reminder[]>('GET', `/reminders${search.toString() ? `?${search.toString()}` : ''}`)
}

export function getReminderProjectPriorities(): Promise<ApiResult<ReminderProjectPrioritySetting[]>> {
  return request<ReminderProjectPrioritySetting[]>('GET', '/reminders/project-priorities')
}

export function setReminderProjectPriority(
  projectId: string,
  input: SetReminderProjectPriorityInput,
): Promise<ApiResult<SetReminderProjectPriorityResult>> {
  return request<SetReminderProjectPriorityResult>('PATCH', `/reminders/project-priorities/${projectId}`, input)
}

export function getReminder(id: string): Promise<ApiResult<Reminder>> {
  return request<Reminder>('GET', `/reminders/${id}`)
}

export function createReminder(input: CreateReminderInput): Promise<ApiResult<Reminder>> {
  return request<Reminder>('POST', '/reminders', input)
}

export function updateReminder(id: string, input: UpdateReminderInput): Promise<ApiResult<Reminder>> {
  return request<Reminder>('PATCH', `/reminders/${id}`, input)
}

export function deleteReminder(id: string): Promise<ApiResult<{ deleted: boolean }>> {
  return request<{ deleted: boolean }>('DELETE', `/reminders/${id}`)
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

export interface KairosStatus {
  installed: boolean
  path: string | null
}

export function getKairosStatus(): Promise<ApiResult<KairosStatus>> {
  return request<KairosStatus>('GET', '/tools/kairos')
}

export function installKairos(): Promise<ApiResult<{ path: string }>> {
  return request<{ path: string }>('POST', '/tools/kairos/install', undefined, { timeout: 60000 })
}

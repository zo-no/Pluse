import { useMemo, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import type { Domain, Project, ProjectPriority } from '@pluse/types'
import * as api from '@/api/client'
import { useI18n } from '@/i18n'
import { getPreferredSessionId } from '@/views/utils/session-selection'
import { PlusIcon, SettingsIcon, SlidersIcon, TrashIcon } from './icons'

interface DomainSidebarProps {
  domains: Domain[]
  projects: Project[]
  activeProjectId: string | null
  onSelectProject: (projectId: string) => void
  onProjectsChanged: () => Promise<void>
  onDomainsChanged: () => Promise<void>
  onCreateProject: () => void
  onNavigate?: () => void
}

type DomainFormState = {
  name: string
  description: string
}

const EMPTY_FORM: DomainFormState = {
  name: '',
  description: '',
}

function projectAvatar(project: Project): string {
  const icon = project.icon?.trim()
  if (icon) return icon
  const name = project.name.trim()
  return name ? name[0]!.toUpperCase() : '#'
}

function shortProjectPath(value: string): string {
  const normalized = value.replace(/^\/Users\/[^/]+/, '~')
  const isHome = normalized.startsWith('~/')
  const parts = normalized.replace(/^~\//, '').replace(/^\//, '').split('/').filter(Boolean)
  if (parts.length <= 4) return normalized
  return `${isHome ? '~/' : '/'}${parts.slice(0, 2).join('/')}/…/${parts.slice(-2).join('/')}`
}

function projectPriorityLabel(priority: ProjectPriority, t: (key: string) => string): string {
  if (priority === 'mainline') return t('主线')
  if (priority === 'priority') return t('优先')
  if (priority === 'low') return t('低优先')
  return t('普通')
}

export function DomainSidebar({
  domains,
  projects,
  activeProjectId,
  onSelectProject,
  onProjectsChanged,
  onDomainsChanged,
  onCreateProject,
  onNavigate,
}: DomainSidebarProps) {
  const navigate = useNavigate()
  const { t } = useI18n()
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [createForm, setCreateForm] = useState<DomainFormState>(EMPTY_FORM)
  const [editForm, setEditForm] = useState<DomainFormState>(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingDeleteDomain, setPendingDeleteDomain] = useState<Domain | null>(null)

  const projectsByDomainId = useMemo(() => {
    const grouped = new Map<string, Project[]>()
    const ungrouped: Project[] = []

    for (const project of projects) {
      if (project.domainId) {
        const current = grouped.get(project.domainId)
        if (current) current.push(project)
        else grouped.set(project.domainId, [project])
      } else {
        ungrouped.push(project)
      }
    }

    return { grouped, ungrouped }
  }, [projects])

  function isExpanded(key: string): boolean {
    return expanded[key] ?? true
  }

  function toggleExpanded(key: string): void {
    setExpanded((current) => ({
      ...current,
      [key]: !(current[key] ?? true),
    }))
  }

  function openProject(projectId: string): void {
    onSelectProject(projectId)
    onNavigate?.()
    navigate(`/projects/${projectId}`)
  }

  async function openProjectFirstSession(projectId: string): Promise<void> {
    onSelectProject(projectId)
    onNavigate?.()
    const questId = await getPreferredSessionId(projectId)
    if (questId) {
      navigate(`/quests/${questId}`)
      return
    }
    navigate(`/projects/${projectId}`)
  }

  function resetCreateForm(): void {
    setCreateForm(EMPTY_FORM)
    setCreating(false)
  }

  async function handleCreateDomain(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    const result = await api.createDomain({
      name: createForm.name,
      description: createForm.description || undefined,
    })
    setSubmitting(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    resetCreateForm()
    await onDomainsChanged()
  }

  async function handleCreateDefaults() {
    setSubmitting(true)
    setError(null)
    const result = await api.createDefaultDomains()
    setSubmitting(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    await onDomainsChanged()
  }

  function startEdit(domain: Domain): void {
    setEditingId(domain.id)
    setEditForm({
      name: domain.name,
      description: domain.description ?? '',
    })
    setError(null)
  }

  async function handleUpdateDomain(event: FormEvent) {
    event.preventDefault()
    if (!editingId) return
    setSubmitting(true)
    setError(null)
    const result = await api.updateDomain(editingId, {
      name: editForm.name,
      description: editForm.description || null,
    })
    setSubmitting(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setEditingId(null)
    setEditForm(EMPTY_FORM)
    await onDomainsChanged()
  }

  function requestDeleteDomain(domain: Domain) {
    setPendingDeleteDomain(domain)
    setError(null)
  }

  async function handleDeleteDomain() {
    if (!pendingDeleteDomain) return
    setSubmitting(true)
    setError(null)
    const result = await api.deleteDomain(pendingDeleteDomain.id)
    setSubmitting(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    if (editingId === pendingDeleteDomain.id) {
      setEditingId(null)
      setEditForm(EMPTY_FORM)
    }
    setPendingDeleteDomain(null)
    await Promise.all([onDomainsChanged(), onProjectsChanged()])
  }

  function renderProject(project: Project) {
    const isActive = project.id === activeProjectId
    return (
      <div
        key={project.id}
        className={`pluse-sidebar-item pluse-domain-project-item${isActive ? ' is-active' : ''}`}
      >
        <button
          type="button"
          className="pluse-project-avatar pluse-project-avatar-button"
          onClick={() => openProject(project.id)}
          aria-label={t('打开')}
          title={t('打开')}
        >
          {projectAvatar(project)}
        </button>
        <button
          type="button"
          className="pluse-sidebar-item-main pluse-domain-project-main"
          onClick={() => void openProjectFirstSession(project.id)}
        >
            <div className="pluse-domain-project-copy">
              <div className="pluse-sidebar-item-title">
                <strong>{project.name}</strong>
                <span className={`pluse-project-priority-badge is-${project.priority}`}>{projectPriorityLabel(project.priority, t)}</span>
              </div>
              <p title={project.workDir}>{shortProjectPath(project.workDir)}</p>
            </div>
        </button>
        <div className="pluse-sidebar-item-actions pluse-domain-project-actions">
          <button
            type="button"
            className="pluse-sidebar-more-btn pluse-domain-project-action"
            onClick={() => {
              onNavigate?.()
              navigate(`/projects/${project.id}`)
            }}
            aria-label={t('项目设置')}
            title={t('项目设置')}
          >
            <SlidersIcon className="pluse-icon" />
          </button>
        </div>
      </div>
    )
  }

  function renderGroup(options: {
    key: string
    title: string
    count: number
    projects: Project[]
    domain?: Domain
  }) {
    const open = isExpanded(options.key)
    const editing = options.domain && editingId === options.domain.id

    return (
      <section key={options.key} className="pluse-domain-group">
        {editing ? (
          <form className="pluse-sidebar-form pluse-domain-form" onSubmit={handleUpdateDomain}>
            <input
              value={editForm.name}
              onChange={(event) => setEditForm((current) => ({ ...current, name: event.target.value }))}
              placeholder={t('领域名称')}
              required
            />
            <textarea
              value={editForm.description}
              onChange={(event) => setEditForm((current) => ({ ...current, description: event.target.value }))}
              placeholder={t('描述（可选）')}
              rows={2}
            />
            <div className="pluse-domain-form-actions">
              <button type="submit" className="pluse-button" disabled={submitting}>
                {submitting ? t('保存中…') : t('保存')}
              </button>
              <button
                type="button"
                className="pluse-button pluse-button-ghost"
                onClick={() => {
                  setEditingId(null)
                  setEditForm(EMPTY_FORM)
                }}
              >
                {t('取消')}
              </button>
            </div>
          </form>
        ) : (
          <>
            <div className="pluse-domain-group-head">
              <button type="button" className="pluse-domain-group-toggle" onClick={() => toggleExpanded(options.key)}>
                <span className="pluse-domain-group-chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
                <div className="pluse-domain-group-copy">
                  <strong>{options.title}</strong>
                  <span>{t('{count} 个项目', { count: options.count })}</span>
                </div>
              </button>
              {options.domain ? (
                <div className="pluse-domain-group-actions">
                  <button
                    type="button"
                    className="pluse-sidebar-action-btn"
                    onClick={() => startEdit(options.domain!)}
                    aria-label={t('编辑领域')}
                    title={t('编辑领域')}
                  >
                    <SettingsIcon className="pluse-icon" />
                  </button>
                  <button
                    type="button"
                    className="pluse-sidebar-action-btn"
                    onClick={() => requestDeleteDomain(options.domain!)}
                    aria-label={t('删除领域')}
                    title={t('删除领域')}
                  >
                    <TrashIcon className="pluse-icon" />
                  </button>
                </div>
              ) : null}
            </div>
            {open ? (
              <div className="pluse-domain-project-list">
                {options.projects.length > 0
                  ? options.projects.map(renderProject)
                  : <p className="pluse-empty-inline">{t('暂无项目')}</p>}
              </div>
            ) : null}
          </>
        )}
      </section>
    )
  }

  return (
    <div className="pluse-sidebar-scroll-pane">
      <section className="pluse-sidebar-section pluse-sidebar-section-list">
        <div className="pluse-sidebar-list pluse-sidebar-list-dense">
          {creating ? (
            <form className="pluse-sidebar-form pluse-domain-form" onSubmit={handleCreateDomain}>
              <input
                value={createForm.name}
                onChange={(event) => setCreateForm((current) => ({ ...current, name: event.target.value }))}
                placeholder={t('领域名称')}
                required
              />
              <textarea
                value={createForm.description}
                onChange={(event) => setCreateForm((current) => ({ ...current, description: event.target.value }))}
                placeholder={t('描述（可选）')}
                rows={2}
              />
              <div className="pluse-domain-form-actions">
                <button type="submit" className="pluse-button" disabled={submitting}>
                  {submitting ? t('保存中…') : t('保存')}
                </button>
                <button type="button" className="pluse-button pluse-button-ghost" onClick={resetCreateForm}>
                  {t('取消')}
                </button>
              </div>
            </form>
          ) : null}

          {domains.length === 0 && !creating ? (
            <p className="pluse-domain-empty">{t('还没有领域，创建分组或套用默认模板。')}</p>
          ) : null}

          {renderGroup({
            key: 'ungrouped',
            title: t('未分组'),
            count: projectsByDomainId.ungrouped.length,
            projects: projectsByDomainId.ungrouped,
          })}

          {domains.map((domain) => renderGroup({
            key: domain.id,
            title: domain.name,
            count: projectsByDomainId.grouped.get(domain.id)?.length ?? 0,
            projects: projectsByDomainId.grouped.get(domain.id) ?? [],
            domain,
          }))}

          <div className="pluse-domain-toolbar pluse-domain-toolbar-subtle">
            <button
              type="button"
              className="pluse-sidebar-chip-link pluse-sidebar-chip-link-sm"
              onClick={onCreateProject}
              disabled={submitting}
            >
              <PlusIcon className="pluse-icon" />
              <span>{t('新建项目')}</span>
            </button>
            <button
              type="button"
              className="pluse-sidebar-chip-link pluse-sidebar-chip-link-sm"
              onClick={() => setCreating(true)}
              disabled={submitting}
            >
              <PlusIcon className="pluse-icon" />
              <span>{t('新建领域')}</span>
            </button>
            <button
              type="button"
              className="pluse-sidebar-chip-link pluse-sidebar-chip-link-sm"
              onClick={() => void handleCreateDefaults()}
              disabled={submitting}
            >
              <span>{t('使用默认模板')}</span>
            </button>
          </div>
        </div>

        {error ? <p className="pluse-error" style={{ padding: '0 8px 8px' }}>{error}</p> : null}
      </section>

      {pendingDeleteDomain && typeof document !== 'undefined'
        ? createPortal(
          <div className="pluse-modal-backdrop" onClick={() => setPendingDeleteDomain(null)}>
            <section
              className="pluse-modal-panel pluse-domain-delete-modal"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="pluse-task-modal-head">
                <div className="pluse-task-modal-title">
                  <span className="pluse-task-modal-kicker">{t('危险操作')}</span>
                  <h2>{t('删除领域')}</h2>
                </div>
              </div>
              <div className="pluse-task-modal-body">
                <p className="pluse-info-copy">
                  {t('删除后，下面的项目会回到未分组。此操作不可撤销。')}
                </p>
                <div className="pluse-delete-confirm">
                  <p>
                    {t('确认删除领域')}
                    {' '}
                    <strong>{pendingDeleteDomain.name}</strong>
                    {' '}
                    {t('？')}
                  </p>
                  <div className="pluse-delete-confirm-actions">
                    <button
                      type="button"
                      className="pluse-button pluse-button-danger"
                      onClick={() => void handleDeleteDomain()}
                      disabled={submitting}
                    >
                      {submitting ? t('删除中…') : t('确认删除')}
                    </button>
                    <button
                      type="button"
                      className="pluse-button pluse-button-ghost"
                      onClick={() => setPendingDeleteDomain(null)}
                      disabled={submitting}
                    >
                      {t('取消')}
                    </button>
                  </div>
                </div>
              </div>
            </section>
          </div>,
          document.body,
        )
        : null}
    </div>
  )
}

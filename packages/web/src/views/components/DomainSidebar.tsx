import { useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Domain, Project } from '@pluse/types'
import * as api from '@/api/client'
import { useI18n } from '@/i18n'
import { ArchiveIcon, PlusIcon, SettingsIcon } from './icons'

interface DomainSidebarProps {
  domains: Domain[]
  projects: Project[]
  activeProjectId: string | null
  onSelectProject: (projectId: string) => void
  onProjectsChanged: () => Promise<void>
  onDomainsChanged: () => Promise<void>
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

export function DomainSidebar({
  domains,
  projects,
  activeProjectId,
  onSelectProject,
  onProjectsChanged,
  onDomainsChanged,
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
    return expanded[key] ?? false
  }

  function toggleExpanded(key: string): void {
    setExpanded((current) => ({
      ...current,
      [key]: !(current[key] ?? false),
    }))
  }

  function openProject(projectId: string): void {
    onSelectProject(projectId)
    onNavigate?.()
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

  async function handleDeleteDomain(domain: Domain) {
    const confirmed = window.confirm(t('归档该领域后，下面的项目会回到未分组。继续吗？'))
    if (!confirmed) return
    setSubmitting(true)
    setError(null)
    const result = await api.deleteDomain(domain.id)
    setSubmitting(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    if (editingId === domain.id) {
      setEditingId(null)
      setEditForm(EMPTY_FORM)
    }
    await Promise.all([onDomainsChanged(), onProjectsChanged()])
  }

  function renderProject(project: Project) {
    return (
      <button
        key={project.id}
        type="button"
        className={`pluse-project-picker-item pluse-domain-project-item${project.id === activeProjectId ? ' is-active' : ''}`}
        onClick={() => openProject(project.id)}
      >
        <span className="pluse-sidebar-dot" aria-hidden="true" />
        <div className="pluse-project-picker-item-text">
          <strong>{project.name}</strong>
          <span>{project.workDir.replace(/^\/Users\/[^/]+/, '~')}</span>
        </div>
      </button>
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
                    onClick={() => void handleDeleteDomain(options.domain!)}
                    aria-label={t('归档领域')}
                    title={t('归档领域')}
                  >
                    <ArchiveIcon className="pluse-icon" />
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
          <div className="pluse-info-block pluse-domain-summary">
            <div className="pluse-sidebar-header-row">
              <div>
                <h2>{t('全部项目')}</h2>
                <p>{t('{count} 个项目', { count: projects.length })}</p>
              </div>
            </div>
            <div className="pluse-domain-toolbar">
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
            <div className="pluse-info-block pluse-domain-empty">
              <div className="pluse-sidebar-header-row">
                <div>
                  <h2>{t('还没有领域')}</h2>
                  <p>{t('先创建一个分组，或者直接套用默认模板。')}</p>
                </div>
              </div>
            </div>
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
        </div>

        {error ? <p className="pluse-error" style={{ padding: '0 8px 8px' }}>{error}</p> : null}
      </section>
    </div>
  )
}

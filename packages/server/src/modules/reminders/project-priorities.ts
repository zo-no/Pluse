import type {
  ReminderProjectPriority,
  ReminderProjectPrioritySetting,
  SetReminderProjectPriorityResult,
} from '@pluse/types'
import { getDb } from '../../db'
import { getProject, listProjects, updateProject } from '../../models/project'

function now(): string {
  return new Date().toISOString()
}

function defaultSetting(projectId: string, updatedAt?: string): ReminderProjectPrioritySetting {
  return {
    projectId,
    priority: 'normal',
    updatedAt,
  }
}

function priorityRank(priority: ReminderProjectPriority): number {
  if (priority === 'mainline') return 0
  if (priority === 'priority') return 1
  if (priority === 'normal') return 2
  return 3
}

export function listReminderProjectPriorities(): ReminderProjectPrioritySetting[] {
  return listProjects({ includeArchived: false, includeSystem: false })
    .filter((project) => project.priority !== 'normal')
    .sort((left, right) => {
      const priorityDelta = priorityRank(left.priority) - priorityRank(right.priority)
      if (priorityDelta !== 0) return priorityDelta
      return Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
    })
    .map((project) => ({
      projectId: project.id,
      priority: project.priority,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    }))
}

export function getReminderProjectPriority(projectId: string): ReminderProjectPrioritySetting {
  const project = getProject(projectId)
  return project
    ? {
        projectId: project.id,
        priority: project.priority,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      }
    : defaultSetting(projectId)
}

export function setReminderProjectPriority(
  projectId: string,
  priority: ReminderProjectPriority,
): SetReminderProjectPriorityResult {
  const project = getProject(projectId)
  if (!project || project.visibility === 'system' || project.archived) {
    throw new Error(`Project not found: ${projectId}`)
  }

  const db = getDb()
  const ts = now()
  const tx = db.transaction(() => {
    if (priority === 'mainline') {
      db.run(
        `UPDATE projects
            SET priority = 'priority',
                updated_at = ?
          WHERE priority = 'mainline'
            AND id <> ?
            AND visibility = 'user'
            AND archived = 0`,
        [ts, projectId],
      )
      db.run(
        `UPDATE reminder_project_priorities
            SET priority = 'priority',
                updated_at = ?
          WHERE priority = 'mainline'
            AND project_id <> ?`,
        [ts, projectId],
      )
    }

    updateProject(projectId, { priority })
    if (priority === 'normal') {
      db.run('DELETE FROM reminder_project_priorities WHERE project_id = ?', [projectId])
    } else {
      db.run(
        `INSERT INTO reminder_project_priorities (project_id, priority, created_at, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(project_id) DO UPDATE SET priority = excluded.priority, updated_at = excluded.updated_at`,
        [projectId, priority, ts, ts],
      )
    }
  })
  tx()

  return {
    setting: getReminderProjectPriority(projectId),
    settings: listReminderProjectPriorities(),
  }
}

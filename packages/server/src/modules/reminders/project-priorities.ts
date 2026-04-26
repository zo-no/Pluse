import type {
  ReminderProjectPriority,
  ReminderProjectPrioritySetting,
  SetReminderProjectPriorityResult,
} from '@pluse/types'
import { getDb } from '../../db'
import { getProject } from '../../models/project'

type ReminderProjectPriorityRow = {
  project_id: string
  priority: ReminderProjectPriority
  created_at: string
  updated_at: string
}

function now(): string {
  return new Date().toISOString()
}

function rowToSetting(row: ReminderProjectPriorityRow): ReminderProjectPrioritySetting {
  return {
    projectId: row.project_id,
    priority: row.priority,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function defaultSetting(projectId: string, updatedAt?: string): ReminderProjectPrioritySetting {
  return {
    projectId,
    priority: 'normal',
    updatedAt,
  }
}

export function listReminderProjectPriorities(): ReminderProjectPrioritySetting[] {
  const db = getDb()
  const rows = db.query<ReminderProjectPriorityRow, []>(
    `SELECT * FROM reminder_project_priorities
      ORDER BY
        CASE priority
          WHEN 'mainline' THEN 0
          WHEN 'priority' THEN 1
          ELSE 2
        END ASC,
        updated_at DESC`,
  ).all()
  return rows.map(rowToSetting)
}

export function getReminderProjectPriority(projectId: string): ReminderProjectPrioritySetting {
  const db = getDb()
  const row = db.query<ReminderProjectPriorityRow, [string]>(
    'SELECT * FROM reminder_project_priorities WHERE project_id = ?',
  ).get(projectId)
  return row ? rowToSetting(row) : defaultSetting(projectId)
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
        `UPDATE reminder_project_priorities
           SET priority = 'priority',
               updated_at = ?
         WHERE priority = 'mainline'
           AND project_id <> ?`,
        [ts, projectId],
      )
    }

    if (priority === 'normal') {
      db.run('DELETE FROM reminder_project_priorities WHERE project_id = ?', [projectId])
      return
    }

    db.run(
      `INSERT INTO reminder_project_priorities (project_id, priority, created_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET
         priority = excluded.priority,
         updated_at = excluded.updated_at`,
      [projectId, priority, ts, ts],
    )
  })
  tx()

  return {
    setting: priority === 'normal' ? defaultSetting(projectId, ts) : getReminderProjectPriority(projectId),
    settings: listReminderProjectPriorities(),
  }
}

import { resolve } from 'node:path'
import type { Project } from '@melody-sync/types'
import { getSetting } from '../models/settings'

function getPulseCliCommand(): string {
  return process.env['PULSE_CLI_COMMAND']?.trim()
    || `bun ${resolve(import.meta.dirname, '../cli.ts')}`
}

// ─── 共用系统说明（所有执行上下文都注入） ───────────────────────────────────

const PULSE_CONCEPT_BLOCK = `你在 Pulse 系统中运行。

Pulse 的核心概念：
- Project（项目）：工作容器，对应本地文件夹，包含若干会话和任务
- Session（会话）：与 AI 的持续对话，消息历史保存在会话中
- Task（任务）：独立工作单元，可由 AI 或人类执行
- Session 和 Task 均归属于 Project，可互相关联和转换：
    - 会话中可以创建任务（AI 或人类的 todo）
    - AI Task 执行时关联一个 Session 作为上下文
    - Task.originSessionId 记录任务在哪个会话里被创建
    - Session.sourceTaskId 记录会话由哪个任务触发
- 切换上下文时（会话↔任务），用 projectId 作为锚点查全局状态`

// ─── 第一层：系统级提示 ────────────────────────────────────────────────────

function buildLayer1(): string {
  return getSetting('global_system_prompt')?.trim() ?? ''
}

// ─── 第二层：项目级提示 ────────────────────────────────────────────────────

function buildLayer2(project: Project): string {
  const parts: string[] = []
  if (project.goal?.trim()) parts.push(`项目目标：${project.goal.trim()}`)
  if (project.systemPrompt?.trim()) parts.push(project.systemPrompt.trim())
  return parts.join('\n\n')
}

// ─── 第三层：Session 执行上下文 ────────────────────────────────────────────

export function buildSessionSystemPrompt(
  project: Project,
  sessionId: string,
): string {
  const cli = getPulseCliCommand()
  const layer3 = [
    PULSE_CONCEPT_BLOCK,
    '',
    '当前上下文：会话',
    '',
    `项目: ${project.name} (${project.id})`,
    `会话: ${sessionId}`,
    `工作目录: ${project.workDir ?? ''}`,
    '',
    '你正在与人类对话。',
    '需要执行独立的自动化工作时，创建 AI Task 而不是在会话里直接完成。',
    '需要人类处理某件事时，创建 Human Task 并填写 waitingInstructions。',
    '',
    `运行 \`${cli} commands\` 查看所有可用能力。`,
  ].join('\n')

  return [buildLayer1(), buildLayer2(project), layer3]
    .filter(Boolean)
    .join('\n\n')
}

// ─── 第三层：Task 执行上下文 ───────────────────────────────────────────────

export function buildTaskSystemPrompt(
  project: Project,
  taskId: string,
  taskTitle: string,
  sessionId: string,
): string {
  const cli = getPulseCliCommand()
  const layer3 = [
    PULSE_CONCEPT_BLOCK,
    '',
    '当前上下文：任务执行',
    '',
    `项目: ${project.name} (${project.id})`,
    `任务: ${taskTitle} (${taskId})`,
    `会话: ${sessionId}`,
    `工作目录: ${project.workDir ?? ''}`,
    '',
    '你正在执行一个自动化任务。',
    `完成后运行 \`${cli} task done ${taskId} --output "..."\` 标记结果。`,
    '需要人类介入时，创建 Human Task 并说明原因。',
    `查看任务来源：\`${cli} task get ${taskId}\`（originSessionId 字段）。`,
    '',
    `运行 \`${cli} commands\` 查看所有可用能力。`,
  ].join('\n')

  return [buildLayer1(), buildLayer2(project), layer3]
    .filter(Boolean)
    .join('\n\n')
}

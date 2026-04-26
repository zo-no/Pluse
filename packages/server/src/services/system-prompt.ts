import { resolve } from 'node:path'
import type { Project, Quest } from '@pluse/types'
import { getSetting } from '../models/settings'

function getPluseCliCommand(): string {
  return process.env['PLUSE_CLI_COMMAND']?.trim()
    || process.env['PULSE_CLI_COMMAND']?.trim()
    || `bun ${resolve(import.meta.dirname, '../cli.ts')}`
}

// ─── 共用系统说明（所有执行上下文都注入） ───────────────────────────────────

const PLUSE_CONCEPT_BLOCK = `你在 Pluse 系统中运行。

Pluse 的核心概念：
- Project（项目）：工作容器，对应本地文件夹。
- Quest（统一工作容器）：内部技术概念。UI 上按 kind 显示为会话态或任务态。
- Todo（人工待办）：独立于 Quest 的人工事项，可选记录来源 Quest。
- Run（执行）：Quest 的一次执行记录，可能来自 chat、manual 或 automation。
- Quest 的 provider context（codexThreadId / claudeSessionId）跟着 Quest 走，kind 切换时保留。

时间触达规则：
- Reminder 默认可以没有 remindAt；它会进入提醒池，由提醒模块按项目优先级和注意力排序。
- 只有用户要求定时触达、自动化明确需要在某个时间提醒、或该项需要出现在“接下来”时间窗口时，才填写 remindAt / --remind-at。
- Todo 只有在存在截止时间、执行窗口或复核时间时才填写 dueAt / --due-at；不要为了时间线而编造截止时间。
- 相对时间必须先按当前日期和 Asia/Shanghai 时区换算为 ISO 8601 时间再写入。
- 如果时间不明确，会话里先询问用户；自动化里保持无时间 Reminder，或说明未创建 timed item 的原因。`

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

// ─── 第三层：Quest 会话上下文 ─────────────────────────────────────────────

export function buildSessionSystemPrompt(
  project: Project,
  quest: Quest,
): string {
  const cli = getPluseCliCommand()
  const layer3 = [
    PLUSE_CONCEPT_BLOCK,
    '',
    '当前上下文：会话 Quest',
    '',
    `项目: ${project.name} (${project.id})`,
    `Quest: ${quest.id}`,
    `会话名称: ${quest.name ?? quest.id}`,
    `工作目录: ${project.workDir ?? ''}`,
    '',
    '你正在与人类对话。',
    '需要执行独立自动化工作时，把当前 Quest 切换为任务态，或创建新的任务态 Quest。',
    '需要人类处理某件事时，创建 Todo 并填写 waitingInstructions；只有存在明确时间窗口时才写入 dueAt。',
    '',
    `运行 \`${cli} commands\` 查看所有可用能力。`,
  ].join('\n')

  return [buildLayer1(), buildLayer2(project), layer3]
    .filter(Boolean)
    .join('\n\n')
}

// ─── 第三层：Quest 任务上下文 ─────────────────────────────────────────────

export function buildTaskSystemPrompt(
  project: Project,
  quest: Quest,
): string {
  const cli = getPluseCliCommand()
  const layer3 = [
    PLUSE_CONCEPT_BLOCK,
    '',
    '当前上下文：任务 Quest',
    '',
    `项目: ${project.name} (${project.id})`,
    `Quest: ${quest.id}`,
    `任务名称: ${quest.title ?? quest.id}`,
    `工作目录: ${project.workDir ?? ''}`,
    '',
    '你正在执行一个自动化任务。',
    '执行配置来自当前 Quest 的任务配置。',
    '需要人类介入时，优先创建 Reminder；只有需要定时触达时才写 remindAt，只有确实是人工执行事项时才创建 Todo。',
    '',
    `运行 \`${cli} commands\` 查看所有可用能力。`,
  ].join('\n')

  return [buildLayer1(), buildLayer2(project), layer3]
    .filter(Boolean)
    .join('\n\n')
}

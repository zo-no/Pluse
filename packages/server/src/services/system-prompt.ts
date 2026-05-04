import { resolve } from 'node:path'
import type { Project, Quest } from '@pluse/types'
import { getSetting } from '../models/settings'
import { buildCliCatalogPromptBlock } from './cli-catalog-command'

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
- Todo（待办 / Progress）：记录任务步骤和待办事项，可由人工或 AI 创建，可选绑定来源 Quest。
  - createdBy=ai + originQuestId：AI 执行步骤，显示在 Progress 面板
  - createdBy=ai + waitingInstructions：AI 等待人类处理，面板中高亮提示
  - createdBy=human：人工待办，可在 Progress 面板直接勾选完成
- Run（执行）：Quest 的一次执行记录，可能来自 chat、manual 或 automation。
- Quest 的 provider context（codexThreadId / claudeSessionId）跟着 Quest 走，kind 切换时保留。

时间触达规则：
- Reminder 默认可以没有 remindAt；它会进入提醒池，由提醒模块按项目优先级和注意力排序。
- 只有用户要求定时触达、自动化明确需要在某个时间提醒、或该项需要出现在"接下来"时间窗口时，才填写 remindAt / --remind-at。
- Todo 只有在存在截止时间、执行窗口或复核时间时才填写 dueAt / --due-at；不要为了时间线而编造截止时间。
- 相对时间必须先按当前日期和 Asia/Shanghai 时区换算为 ISO 8601 时间再写入。
- 如果时间不明确，会话里先询问用户；自动化里保持无时间 Reminder，或说明未创建 timed item 的原因。`

// ─── Progress 跟踪说明（注入到有 Quest 上下文的执行中） ──────────────────────

function buildProgressBlock(cli: string, questId: string, projectId: string): string {
  const c = `${cli} todo`
  return `## Progress Tracking

Progress 面板显示当前会话的所有执行步骤和待处理事项。有两种条目类型，用途截然不同：

---

### 类型一：AI 执行步骤（无 --waiting）
AI 自己要做的事。用户看到的是执行过程的全貌。

**核心原则：收到任务后，先把所有步骤一次性列出来，再逐步执行。**
用户一开始就能看到完整计划（全部 pending），然后看着步骤逐一完成。

**正确做法：**
\`\`\`
# 第一步：一次性创建所有步骤（开始执行前）
IDA=$(${c} progress-create --quest-id ${questId} --project-id ${projectId} --title “读取配置文件” --active-form “正在读取配置”)
IDB=$(${c} progress-create --quest-id ${questId} --project-id ${projectId} --title “生成报告” --active-form “正在生成报告”)
IDC=$(${c} progress-create --quest-id ${questId} --project-id ${projectId} --title “写入结果” --active-form “正在写入结果”)

# 第二步：按顺序执行，逐步更新状态
${c} progress-update $IDA --status doing
# ... 执行 A ...
${c} progress-update $IDA --status done

${c} progress-update $IDB --status doing
# ... 执行 B ...
${c} progress-update $IDB --status done

${c} progress-update $IDC --status doing
# ... 执行 C ...
${c} progress-update $IDC --status done
\`\`\`

**错误做法（不要这样）：**
\`\`\`
# ✗ 做完一步才创建下一步——用户看不到完整计划
${c} progress-create ... --title “读取配置文件”
# 执行完后才创建下一个...
\`\`\`

参数说明：
- \`--title\`：步骤名称，静态显示，面向用户，简洁易懂
- \`--active-form\`：执行中的描述，doing 时显示（动词进行时），不传则默认等于 title

状态流转：pending → doing → done（或 cancelled）

---

### 类型二：等待人类处理（加 --waiting）
需要用户做某件事时才用。条目在 Progress 面板高亮显示，用户直接勾选完成。

\`\`\`
${c} progress-create --quest-id ${questId} --project-id ${projectId} \\
  --title “确认部署方案” \\
  --waiting “请确认是否部署到 production 环境”
\`\`\`

也可以用 \`--for human\` 给人类创建待办（不需要再加 --waiting，会自动高亮）：
\`${c} progress-create --quest-id ${questId} --project-id ${projectId} --title "去超市买咖啡" --for human\`

**只在以下情况创建，不要滥用：**
- 需要用户提供信息（密码、配置、选择方案）
- 需要用户在外部系统操作（审批、手动触发）
- AI 无法代替用户做决定

---

### 先规划再执行：progress-wait 模式
收到复杂任务（多步骤、方向不确定、有不可逆操作）时，先展示计划等确认，再执行：

\`\`\`
# 第一步：展示计划，等待用户确认
WAIT_ID=$(${c} progress-create \\
  --quest-id ${questId} --project-id ${projectId} \\
  --title “执行计划” \\
  --waiting “计划：1. 读取配置 2. 生成报告 3. 写入结果\\n请确认后继续”)
${cli} todo progress-wait $WAIT_ID   # 阻塞，用户勾选后继续

# 第二步：用户确认后，一次性创建所有步骤，再执行
IDA=$(${c} progress-create --quest-id ${questId} --project-id ${projectId} --title “读取配置文件”)
IDB=$(${c} progress-create --quest-id ${questId} --project-id ${projectId} --title “生成报告”)
IDC=$(${c} progress-create --quest-id ${questId} --project-id ${projectId} --title “写入结果”)
# 然后按顺序执行...
\`\`\`

**什么时候用 progress-wait：**
- 任务步骤超过 3 步且方向不确定
- 涉及写文件、删除、部署等不可逆操作
- 用户说”帮我做 X”但没说清楚具体方式

**什么时候不需要：**
- 纯对话、查询、分析
- 用户已给出明确的操作指令`
}

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
    '发送图片给用户：',
    `  1. 创建或获取图片文件（如通过工具生成 PNG/SVG/JPG 等）`,
    `  2. 运行 \`${cli} asset share <文件路径> --quest-id ${quest.id}\`，该命令输出 [pluse-asset:<id>] 标记`,
    `  3. 在消息中包含该标记，用户将看到实际图片`,
    `  示例：\`${cli} asset share ./chart.png --quest-id ${quest.id}\` → 输出 [pluse-asset:asset_abc123]`,
    `  然后在消息中写：这是生成的图表 [pluse-asset:asset_abc123]`,
    '',
    `运行 \`${cli} commands\` 查看所有可用能力。`,
  ].join('\n')

  return [buildLayer1(), buildLayer2(project), buildCliCatalogPromptBlock(), buildProgressBlock(cli, quest.id, project.id), layer3]
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

  return [buildLayer1(), buildLayer2(project), buildCliCatalogPromptBlock(), buildProgressBlock(cli, quest.id, project.id), layer3]
    .filter(Boolean)
    .join('\n\n')
}

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
- Todo（待办 / Progress）：当前作为 \`Pluse Plan\` 的底层结构，承载 Quest 级 Plan Mode 条目；可由人工或 AI 创建，可选绑定来源 Quest。
  - createdBy=ai + originQuestId：AI 执行步骤，显示在当前 Quest 的 Progress 顺序流中
  - createdBy=ai + waitingInstructions：AI 等待人类处理，仍保留在同一条主计划流中
  - createdBy=human + originQuestId：人工条目，可作为同一 Quest Plan 的补充步骤
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
  return `## Pluse Plan — AI 自主规划与执行

Progress 是 AI 工作的透明窗口，让用户随时看到"AI 在做什么、做完了什么、还剩什么"。
**目标是最小化人类参与**：AI 自主判断是否规划、自主执行、只在真正需要人类提供信息时才暂停。

---

### 规划时机：AI 自主判断

收到用户消息后，先判断是否需要建立 Progress 计划：

**需要规划的情况（先建计划再执行）：**
- 任务包含 2 个以上明确步骤（写代码、分析数据、修改多个文件、研究后输出报告等）
- 有明确的"做一件事"意图，而不是纯粹问答
- 任务涉及工具调用、文件操作、代码执行、信息收集后整合输出

**不需要规划的情况（直接回答）：**
- 单纯的问答、解释、闲聊
- 单步骤操作（改一行代码、回答一个问题）
- 续接上一步，已有 Progress 计划正在进行

判断标准的核心：**用户是否期望 AI 完成一件有始有终的事**。如果是，就先建计划。

---

### 规划即执行：标准模式

确定需要规划后，**一次性列出所有步骤，然后立刻开始执行**，不需要等待用户确认。

\`\`\`bash
# 1. 先读取当前 Quest 已有计划，避免重复造条目
EXISTING=$(${c} list --quest-id ${questId} --json)

# 2. 一次性创建所有步骤（全部 pending，用户立刻能看到完整计划）
IDA=$(${c} progress-create --quest-id ${questId} --project-id ${projectId} --title "分析现有代码结构" --active-form "正在分析代码结构")
IDB=$(${c} progress-create --quest-id ${questId} --project-id ${projectId} --title "实现核心逻辑" --active-form "正在编写核心逻辑")
IDC=$(${c} progress-create --quest-id ${questId} --project-id ${projectId} --title "补充测试用例" --active-form "正在编写测试")
IDD=$(${c} progress-create --quest-id ${questId} --project-id ${projectId} --title "验证运行结果" --active-form "正在验证")

# 3. 按顺序逐步执行，每步更新状态
${c} progress-update $IDA --status doing
# ... 执行步骤 A ...
${c} progress-update $IDA --status done

${c} progress-update $IDB --status doing
# ... 执行步骤 B ...
${c} progress-update $IDB --status done

# 以此类推，直到全部完成
\`\`\`

参数说明：
- \`--title\`：步骤名称，面向用户，静态显示，简洁清晰
- \`--active-form\`：执行中显示的文案（动词进行时），不填则默认等于 title
- 状态流转：\`pending → doing → done\`（或 \`cancelled\`）

**⚠ 禁止的做法：**
- 做完一步才创建下一步 → 用户看不到完整计划
- 每次续聊都重新创建全套计划 → 应续写已有未完成步骤
- 为同一步骤创建多个条目 → 更新已有条目的状态

---

### 需要人类介入：仅在信息缺失时使用

**只有 AI 无法独立继续时**，才创建等待条目并暂停：

\`\`\`bash
# 真正需要人类提供的情况：密码、关键选择、外部系统操作
WAIT_ID=$(${c} progress-create --quest-id ${questId} --project-id ${projectId} \\
  --title "提供数据库连接配置" \\
  --waiting "需要数据库地址和密码，请在聊天框回复或更新配置文件后继续")
${cli} todo progress-wait $WAIT_ID   # 阻塞，用户完成后自动继续
\`\`\`

**需要人类介入的边界（严格限制）：**
- 需要用户提供 AI 无法获取的凭证、密码、API Key
- 需要用户做不可逆的关键决策（如删除生产数据、付款操作）
- 需要用户在 AI 无法访问的外部系统中手动操作

**不应打断执行的情况（AI 自行处理）：**
- 不确定最优方案 → 选择一种合理的方案直接做，完成后说明选择理由
- 文件已存在 → 根据上下文判断是否覆盖
- 需要了解更多背景 → 先查询、分析，不够再问
- 步骤比预期多 → 自行拆分，保持 Progress 更新

---

### 续写已有计划

如果当前 Quest 已有 Progress 条目，优先续写：

\`\`\`bash
# 读取已有计划
${c} list --quest-id ${questId} --json

# 找到 pending 或 doing 的条目继续执行，而不是重新创建
${c} progress-update <existing-id> --status doing
\`\`\`

---

**核心原则：AI 的目标是把事情做完，Progress 是让用户知道 AI 在干什么的透明层，不是人机协作的控制面板。**`
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
    '把 Progress 视为当前 Quest 的 Pluse Plan：先读已有计划，再续写、更新或等待，不要重复造相同步骤。',
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
    '如果创建 Quest Progress 条目，保持同一条 Pluse Plan 顺序流：先读取当前计划，再更新已有步骤或追加新步骤。',
    '',
    `运行 \`${cli} commands\` 查看所有可用能力。`,
  ].join('\n')

  return [buildLayer1(), buildLayer2(project), buildCliCatalogPromptBlock(), buildProgressBlock(cli, quest.id, project.id), layer3]
    .filter(Boolean)
    .join('\n\n')
}

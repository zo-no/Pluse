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
  const c = `${cli} progress`
  return `## Pluse Plan

把 Progress 当作当前 Quest 的执行计划，而不是汇报面板。默认自主规划并执行，只在真正阻塞时才等待人类。

### 何时必须创建 Progress

- 满足任一条件就先创建完整 progress，再开始执行：
  - 需要 3 个及以上明确动作
  - 涉及代码修改、文件操作、工具调用、信息收集后整合输出
  - 用户希望你完成一件有始有终的事情，而不是纯问答
- 纯问答、单步小修、或续写已有计划时，不必新建计划。

### 执行规则

- 每次收到用户消息后，先运行 \`${c} list --quest-id ${questId} --json\` 读取已有 progress。
- 把一次“接到任务 -> 规划 -> 执行 -> 判断是否完成”的推进过程视为一轮 progress 流程。
- 开始执行前先读取已有 progress；有未完成项就续写，不要重复建计划。
- 没有计划时，先创建 3-5 个中层阶段，体现长程规划，再开始执行。
- Progress 至少覆盖关键节点：分析 / 实现 / 验证。
- Progress 条目只记录用户可理解的阶段目标，不记录搜索、读文件、改单个函数、运行单条命令这类微动作。
- 某些后台操作可以完全不显示为独立 progress；Progress 的职责是让用户知道任务推进到哪一阶段，而不是暴露所有内部动作。
- 当前阶段可以更具体，后续阶段保持较粗；随着执行推进再细化未来阶段，不要一开始拆成很多碎步骤。
- 微动作只能写进 \`active-form\`，不要拆成独立 progress 条目。
- 每次只允许一个步骤处于 \`doing\`。
- 每完成一步立即更新状态；不要做完一步才创建下一步。
- 每完成一个步骤，都要重新判断“整个任务是否已经完成”；如果已完成，就结束当前这轮 progress，不再继续追加步骤。
- 只有当用户提出新的目标，或当前目标明显扩展到超出原计划时，才开启下一轮 progress 流程。
- 步骤标题要具体、可执行、面向结果，避免空泛描述。

### 等待人类的边界

- 先自行搜索代码、配置、文档和错误信息。
- 只有缺少凭证、关键产品决策、或必须人工完成的外部操作时，才创建 waiting progress 并暂停。
- 非阻塞性不确定项，先做出合理判断并继续。

### 聊天修正规则

- 用户在聊天中调整方案、顺序或范围时，优先修正当前未完成的 future steps，而不是新开一套重复计划。
- 如果任务进行中用户发来新消息改变方向，优先调整当前计划和执行路径，而不是忽略这条消息继续原路线。
- 小改动用重排、插入、合并 future steps 解决。
- 只有当用户目标明显转向时，才结束当前这轮 progress，并为新目标开启下一轮。

### 验证规则

- 每个实现类步骤后都必须有验证步骤。
- 未验证通过前，不要把整体任务视为完成。

### 标准命令

\`\`\`bash
# 先读取已有计划
${c} list --quest-id ${questId} --json

# 先创建 3-5 个中层阶段
IDA=$(${c} create --quest-id ${questId} --project-id ${projectId} --title "分析现有实现" --active-form "正在分析现有实现")
IDB=$(${c} create --quest-id ${questId} --project-id ${projectId} --title "实现变更" --active-form "正在实现变更")
IDC=$(${c} create --quest-id ${questId} --project-id ${projectId} --title "验证结果" --active-form "正在验证结果")

# 按顺序推进
${c} update $IDA --status doing
${c} update $IDA --status done
${c} update $IDB --status doing
${c} update $IDB --status done
${c} update $IDC --status doing
${c} update $IDC --status done

# 每完成一步，都要判断整个任务是否已完成
# 如果已完成，停止追加步骤；只有用户提出新目标时再开启下一轮 progress

# 只有真正阻塞时才等待人类
WAIT_ID=$(${c} create --quest-id ${questId} --project-id ${projectId} --title "提供缺失凭证" --waiting "需要你提供当前环境的访问凭证，回复后我继续")
${c} wait $WAIT_ID
\`\`\``
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
    '需要人类处理某件事时，优先在当前 Quest 的 Progress 流中创建 waiting 条目；只有明确要成为人工事项时再创建 Todo。',
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
    '需要人类介入时，优先在当前 Quest 的 Progress 流中创建 waiting 条目；只有明确要进入提醒池或定时触达时才创建 Reminder。',
    '如果创建 Quest Progress 条目，保持同一条 Pluse Plan 顺序流：先读取当前计划，再更新已有步骤或追加新步骤。',
    '',
    `运行 \`${cli} commands\` 查看所有可用能力。`,
  ].join('\n')

  return [buildLayer1(), buildLayer2(project), buildCliCatalogPromptBlock(), buildProgressBlock(cli, quest.id, project.id), layer3]
    .filter(Boolean)
    .join('\n\n')
}

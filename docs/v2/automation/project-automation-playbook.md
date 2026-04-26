# Project Automation Playbook

**状态**: draft
**用途**: 为每个 Project 接入自动化时提供统一工作法，避免每次从空白 prompt 开始。

## 为什么先不是 Codex Skill

当前更适合先做成 Pluse 项目内的接入 playbook，而不是直接做外部 Codex Skill。

原因：

- 自动化的核心边界在 Pluse：Project / Quest / Reminder / Todo / Run，而不是 Codex 本身。
- 未来要复用的能力应进入 Pluse 的项目自动化模板或 CLI generator。
- Skill 更适合作为“生成接入方案”的外部助手，但不应成为业务规则的唯一来源。

推荐路径：

1. 先用本文档稳定项目接入模板。
2. 为 2-3 个项目手工创建 L1 自动化，验证噪音、边界和提醒质量。
3. 再沉淀为 `pluse automation seed <project-id>` 或 Codex Skill。

## 接入前必须写清楚

每个项目接入自动化前，先回答：

| 字段 | 说明 |
| --- | --- |
| 项目目标 | 这个项目最终要推进什么 |
| 闭环周期 | 每日 / 每周 / 每月，或事件触发 |
| 自动化职责 | 它只负责观察、判断、提醒、记录中的哪些动作 |
| 允许透出 | 什么情况下可以创建 Reminder |
| 默认预算 | 每次运行最多创建几条 Reminder |
| 时间策略 | 哪些 Reminder 需要定时触达，哪些只进入提醒池 |
| 禁止事项 | 不允许跨项目、不允许做的判断或动作 |

## 成熟度

| 等级 | 运行方式 | 允许动作 |
| --- | --- | --- |
| L0 配置中 | 不启用或手动运行 | 只验证 prompt |
| L1 静默运行 | 定期运行，不主动提醒 | 只输出 run summary |
| L2 摘要运行 | 低频摘要 | 只在缺少信息或明显阻塞时提醒 |
| L3 提醒运行 | 稳定后开启提醒 | 每次运行有提醒预算 |
| L4 强干预 | 高优先主线项目 | 可主动推进关键动作，但仍需边界 |

默认新项目只到 L1/L2。

## 标准 Prompt 骨架

```text
运行边界：
你是「{projectName}」项目的项目内自动化代理。
只处理 projectId={projectId} 内的事实、提醒、待办和 Quest。
不要跨项目管理，不要替用户做最终决策。

必须先读取事实：
1. date（使用 Asia/Shanghai）
2. pluse project overview {projectId} --json
3. pluse reminder list --project-id {projectId} --time all --json
4. pluse todo list --project-id {projectId} --json
5. pluse quest list --project-id {projectId} --kind task --json

输出规则：
- 默认只在 run 输出里总结，不创建提醒。
- 只有满足允许透出条件时才创建 Reminder。
- 每次运行最多创建 {budget} 条 Reminder。
- 创建前先检查 reminder list，避免重复。
- Reminder 默认可以没有 `remindAt`，它会进入提醒池，由提醒模块按项目优先级和注意力排序。
- 只有需要在某个时间触达用户，或希望出现在「接下来」时间窗口时，才写 `remindAt` / `--remind-at`。
- 需要写时间时，使用 Asia/Shanghai 视角换算为 ISO 8601；不要为了进入时间线而编造时间。
- 如果只是通知用户，优先用 Reminder；只有确实是人工执行事项时才创建 Todo。
- Todo 只有存在截止时间、执行窗口或复核时间时才写 `dueAt` / `--due-at`。
- 不创建 Todo。

创建提醒命令：
pluse reminder create --project-id {projectId} --title "..." --body "..." --type follow_up --priority normal --json

定时提醒命令：
pluse reminder create --project-id {projectId} --title "..." --body "..." --type follow_up --priority normal --remind-at "2026-04-27T09:00:00+08:00" --json
```

## 财务管理接入边界

项目：`proj_8b56c6bd25ce5f09`

目标：

- 周度盘点财务现实。
- 月度复盘资产 / 支出 / 收入结构。
- 投资或大额消费前提醒复核。

允许：

- 识别未完成的财务信息补齐、预算、复盘、风险复核。
- 对“买入、卖出、投资、港股、美股、大额支出”等待办创建复核提醒。
- 发现缺少本周快照时创建一条补充提醒。

禁止：

- 不自动交易。
- 不给最终投资建议。
- 不推荐具体标的、仓位、买卖时点。
- 不读取银行流水、交易明细、账户密码、支付信息。
- 不跨项目管理收入、内容或生活项目。

默认预算：

- L1/L2 初版每周运行一次。
- 每次最多创建 1 条 Reminder。
- `reviewOnComplete=false`，避免每次运行都进入提醒。

时间策略：

- 默认创建无时间 Reminder，让提醒模块按项目优先级触达。
- 只有投资/大额消费复核发生在明确日期、周检希望第二天固定触达、或用户已经给出时间时，才写 `remindAt`。

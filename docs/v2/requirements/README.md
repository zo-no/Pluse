# v2 Requirements Index

## 目的

这个目录只记录 `Requirement`，不记录设计方案和实现细节。

每一份 requirement 文档都应该回答：

- 真实问题是什么
- 当前为什么值得做
- 解决后的成功状态是什么
- 暂时不解决什么

## 结构规则

- 一个 requirement 文件只讨论一个核心问题
- 文件名统一使用 `NNNN-kebab-case.md`
- 每份文档都至少包含：`状态`、`类型`、`优先级`
- priority 只表达产品推进顺序，不直接等同于实现难度
- 新 requirement 加入前，先判断它是否真的是独立问题，还是现有 requirement 的子点
- 宏大问题优先保持为一个清晰的 umbrella requirement，再通过 design/spec 分期实现

## 当前需求栈

### P0

- [0001-human-workload-control.md](./0001-human-workload-control.md)
  - 核心问题：用户工作负载失控，长期重要任务被即时噪音挤压
  - 说明：这是当前主矛盾，也是后续 Todo / Agent / notification 体系的上位需求

- [0004-ai-task-result-handling.md](./0004-ai-task-result-handling.md)
  - 核心问题：待办与自动化的产品边界不清晰，自动化仍被误表述为可完成、可处理的对象
  - 说明：这条需求先锁定对象语义和工作面板边界，再决定后续更深的状态设计

- [0009-project-automation-closed-loop.md](./0009-project-automation-closed-loop.md)
  - 核心问题：自动化接入后缺少项目内闭环、跨项目总控、渐进成熟度和信息透出预算
  - 说明：这是将自动化从“更多定时任务”推进为“项目自维护系统”的上位需求

### P1

- [0010-project-priority-tiers-and-visibility.md](./0010-project-priority-tiers-and-visibility.md)
  - 核心问题：项目长期重要性只存在于提醒侧，缺少统一的四档项目优先级、低优先停放层和入口透出
  - 说明：这是 `0001-human-workload-control` 在跨项目层面的基础能力，先于更复杂的提醒预算和全局负载控制

- [0008-service-supervision-and-recovery.md](./0008-service-supervision-and-recovery.md)
  - 核心问题：Pluse 日常服务依赖临时终端进程，退出后 Web/API 不可用，缺少常驻、恢复和诊断入口
  - 说明：这是把 Pluse 从开发进程提升为日常本机工作台的基础可靠性需求

- [0005-quest-lifecycle-linked-dependent-cleanup.md](./0005-quest-lifecycle-linked-dependent-cleanup.md)
  - 核心问题：Quest 归档不会收敛由它派生的 review 信号，系统缺少关联对象的生命周期归属规则
  - 说明：这是开始 Todo / 会话剪枝前需要先锁定的基础边界

- [0003-agent-driven-session-classification.md](./0003-agent-driven-session-classification.md)
  - 核心问题：会话空间只有时间排序，缺少可被 Agent 维护的稳定语义结构
  - 说明：这是会话导航与长期上下文承接的基础能力，但优先级低于 `0001-human-workload-control`

### P2

- [0002-inbox-capture.md](./0002-inbox-capture.md)
  - 核心问题：缺少足够轻的临时捕获入口
  - 说明：这是重要补充能力，但优先级低于工作负载控制

- [0006-quick-select-and-copy-session-id.md](./0006-quick-select-and-copy-session-id.md)
  - 核心问题：会话消息操作中，复制会话 ID 步骤过长
  - 说明：是会话日常操作效率的直接提效需求，目标是会话列表单按钮复制 ID

- [0007-proactive-daily-record.md](./0007-proactive-daily-record.md)
  - 核心问题：长期项目缺少固定、可持续的人类日常信息采集入口
  - 说明：这是“主动记录”需求，围绕项目级每日日记式窗口，形成长期可积累数据

## 当前顺序

建议默认按以下顺序推进：

1. 先确认 `0001-human-workload-control`
2. 在 `0001` 边界内同步确认 `0004-ai-task-result-handling`
3. 基于 `0009` 锁定项目级自动化闭环、跨项目总控和渐进接入规则
4. 先锁定 `0010-project-priority-tiers-and-visibility`，把项目级主线保护、低优先停放层和入口透出口径统一
5. 先基于 `0004` 收敛 Todo / Automation 边界与工作面板 IA
6. 再将 `0001` 拆成多期 `spec`
7. 先锁定 `0005-quest-lifecycle-linked-dependent-cleanup`，避免 Todo / Session 剪枝没有生命周期边界
8. 再看 `0003-agent-driven-session-classification` 是否应独立推进，还是挂接到更大的会话导航主线中
9. 再看 `0002-inbox-capture` 是否需要独立 design，还是作为后续能力挂接到已有设计中
10. 再推进 `0006-quick-select-and-copy-session-id` 作为 `session` 日常操作提效项

## 维护规则

- 当 requirement 进入 design 阶段时，不从这里移除，只更新状态
- 如果 requirement 被合并、废弃或降级，应在这里明确记录
- 不允许绕过这个索引页，随意在 `requirements/` 下堆文件而不更新目录说明

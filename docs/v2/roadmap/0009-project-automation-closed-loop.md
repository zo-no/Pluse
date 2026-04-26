# 0009 — Project Automation Closed Loop Roadmap

**当前状态**: `spec`
**当前焦点**: 自动化面板 Phase 1 spec review + 生活项目 7 天试点 + 财务管理 L1 周检初版

## 已完成产物

- `requirements/0009-project-automation-closed-loop.md`
- `designs/0009-project-automation-closed-loop.md`
- `specs/0009-automation-panel-phase-1.md`
- `automation/project-automation-playbook.md`
- `automation/finance-weekly-guard-prompt.md`

## 当前试点

| 项目 | 状态 | 时间窗口 | 当前目标 |
| --- | --- | --- | --- |
| 生活 | `L3` 试点 | 2026-04-26 至 2026-05-03 | 验证晨间、午间、晚间、睡前、记录员闭环是否真的降低管理负担 |
| 财务管理 | `L1/L2` 初版 | 2026-04-26 起 | 周度守门，只做事实盘点、风险复核和最多一条 Reminder |

## 暂停接入

在生活试点结束前，其他项目只允许低频、低透出自动化。

允许做的前置工作：

- 为其他项目记录候选自动化
- 讨论接入顺序
- 设计控制台和透出策略
- 做静默级别的 prompt 草稿
- 做 L1/L2 低频试点，但必须明确提醒预算和禁止事项

不做：

- 一次性打开多个项目的周期提醒
- 让生活自动化跨项目管理
- 把自动化运行结果全部推到右侧栏

## 下一批候选

| 顺序 | 项目 | 目标等级 | 判断点 |
| --- | --- | --- | --- |
| 1 | 自我对话 | `L1` | 是否作为长期跨项目总控 |
| 2 | 财务管理 | `L1/L2` | 周度盘点和月度复盘是否足够低噪音 |
| 3 | AI硬核自媒体 | `L1/L2` | 是否进入近期主线 |
| 4 | Pluse | `L1` | 是否只做流程检查和阻塞提醒 |

## 当前阻塞

- 自动化透出策略还没有结构化字段
- 自动化成熟度还只是产品口径，没有进入系统模型
- 自动化面板 Phase 1 需要用户确认 spec 后再进入编码
- 后续全局自动化控制台还没有独立 spec

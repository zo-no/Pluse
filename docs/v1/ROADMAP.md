# Pluse v1 Roadmap

## 核心方向

v1 的核心目标：**让 Agent 可以自主配置自己的工作环境**，人类从"盯着看"变成"按需介入"。

## 功能列表

| # | 功能 | 状态 | Spec |
|---|------|------|------|
| 0001 | Hooks 机制 — 事件驱动的自动化配置系统 | ✅ 已完成 | [0001-hooks.md](./specs/0001-hooks.md) |
| 0002 | Hooks 设置 — 用户可控的 Todo 推送开关 | ✅ 已完成 | [0002-hooks-settings.md](./specs/0002-hooks-settings.md) |
| 0003 | 成本可见性 — token 采集、价格估算、多层级展示 | draft | [0003-cost-visibility.md](./specs/0003-cost-visibility.md) |
| 0004a | Todo 优先级与标签 — priority 排序、tags 分类与过滤 | ✅ 已完成 | [0004-todo-priority-tags.md](./specs/0004-todo-priority-tags.md) |
| 0004b | Shell Hook Action — hooks 触发任意 shell 命令 | ✅ 已完成 | [0004-shell-hook-action.md](./specs/0004-shell-hook-action.md) |
| 0005 | 会话失败 Todo 通知 — run_failed 触发高亮与待办 | ✅ 已完成 | [0005-session-failed-todo.md](./specs/0005-session-failed-todo.md) |
| 0006 | Hook 自动 Todo 标签 — 会话完成/失败 Todo 自动打 tag | ✅ 已完成 | [0006-hook-todo-tags.md](./specs/0006-hook-todo-tags.md) |

## 设计原则

1. **CLI 优先** — 所有配置可以通过文件完成，Agent 可以读写
2. **极致体验** — 状态持久化到 DB，多端一致，刷新不丢失
3. **可组合** — 小功能通过 hooks 组合出复杂行为，不硬编码

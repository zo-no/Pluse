# Pluse 架构概览

> 本文档是当前正式口径，由 core specs（0003/0004/0005）收敛而来。
> **当前实现不做旧 `sessions/tasks/task_runs/task_ops` 表结构兼容，直接使用 Quest 统一模型。**

---

## 核心概念

Pluse 当前的产品模型基于四个核心对象：

### Project（项目）
文件系统目录，对应一个有目标的活项目。Project 是所有其他对象的归属容器。

### Quest（统一工作容器）
Project 内统一的 AI 工作容器，是聊天、手动执行、自动执行的共同载体。Quest 有 `kind` 字段（`session` | `task`），用户可手动切换，但同一时刻只能是其中一种。

**命名约定：**

| 层级 | session 态 | task 态 |
|------|-----------|---------|
| 代码 / 数据库 | Quest (kind='session') | Quest (kind='task') |
| 英文 UI | Session | Task |
| 中文 UI | 会话 | 任务 |

### Todo（人工待办）
需要人来处理的独立工作项。Todo 不属于任何 Quest（只是可选地记录来源 Quest），与 AI 对话上下文无关。AI 通过 API/CLI 主动查询 Todo，不做事件推送。

---

## 对象关系

```
Project (1)
  ├── Quest (n)
  │     ├── Run (n)          — 所有执行记录（chat / manual / automation）
  │     └── QuestOp (n)      — 状态变更日志
  └── Todo (n)               — 独立人工待办，可选关联来源 Quest
```

---

## 技术栈

- **后端**：Bun + SQLite（via bun:sqlite）
- **前端**：React + Vite + Tailwind
- **共享类型**：packages/types
- **AI 执行**：fork 子进程调用 Codex CLI / Claude CLI
- **实时推送**：SSE（Server-Sent Events）
- **国际化**：i18n（Quest 的 kind 在 UI 层翻译为 Session/Task）

---

## 关键设计决策

### Quest 有 kind 字段，互斥可切换

Quest 用 `kind` 区分 session 态和 task 态，两种形态互斥，用户可手动切换。切换时 AI provider context（codexThreadId / claudeSessionId）保留不变。

**理由：** session 态出现在会话列表，task 态出现在任务列表，两者的 UI 展示和调度行为差异显著，需要明确区分。

### Provider Context Id 不是 Quest 主键

`codexThreadId` / `claudeSessionId` 是 provider 侧的上下文标识，存储在 Quest 上，但不是 Quest 的主键。Quest 的主键是 Pluse 自己生成的 `qst_xxx`。

**理由：** Provider context 可能过期、失效或切换，不能作为稳定标识。

### 调度配置直接放在 Quest 上

task 态的调度配置（scheduleKind / scheduleConfig / executorKind / executorConfig）是 Quest 自身的字段，不需要独立子对象。

**理由：** 一个 Quest 在 task 态时只对应一套执行配置，子对象增加复杂度而不带来额外价值。

### 同一 Quest 同时只有一个活跃 Run

`quest.activeRunId` 是串行执行的保证。Chat 消息入 followUpQueue，调度器跳过，Manual run 返回 409。

**理由：** AI provider 的 thread/session 是有序的，并发写入导致上下文错乱。

### Todo 独立建模，AI 主动查询

Todo 不属于 Quest，AI 在执行时通过 API/CLI 主动查询，不做事件推送机制。

**理由：** 避免复杂的事件机制，保持系统简单。

---

## 与旧模型的主要差异

| 旧模型 | 当前模型 |
|----|-----|
| Session + Task 双主对象（两张表） | Quest 单一对象（一张表，kind 区分） |
| Task 执行自动创建 Session | task 态 Quest 直接执行，不创建额外对象 |
| Session ↔ Task 是两个独立对象的关联 | kind 切换是同一 Quest 的形态变化 |
| Human Task 是 Task 的子类型（assignee='human'） | Todo 独立对象 |
| codexThreadId 存在 Session 上 | codexThreadId 存在 Quest 上，kind 切换时保留 |
| UI：Session 列表 + Task 列表（两套独立入口） | UI：会话列表（kind='session'）+ 任务列表（kind='task'） |

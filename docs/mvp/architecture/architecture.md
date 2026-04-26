# Pluse 架构概览

> 本文档是当前正式口径，由 core specs（0003/0004/0005）收敛而来。
> **当前实现不做旧 `sessions/tasks/task_runs/task_ops` 表结构兼容，直接使用 Quest 统一模型。**

---

## 核心概念

Pluse 当前的产品模型基于五个核心对象：

### Domain（领域）
Project 的可选上层分组，只负责组织项目，不直接承载 Quest / Todo / Run。Domain 的删除语义是归档；归档后其下 Project 自动回到“未分组”。

### Project（项目）
文件系统目录，对应一个有目标的活项目。Project 是 Quest 与 Todo 的直接归属容器；Run / QuestOp / UploadedAsset 通过 Quest 归属到 Project。Domain 只是它的可选上层组织层。

内置默认入口 Project 为未分组下的“自我对话”。首次使用时服务端会自动创建该 Project；已有同名 Project 时会优先采用已有项目，并强制移回未分组，同时把旧 `Inbox` 默认入口的数据迁入其中。它用于承接用户尚未归类的自我探索：挖掘真实需求、许下愿望、抒发欲望，并把混沌想法逐步整理成 Quest / Todo。

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

### 删除即归档
Domain、Quest、Todo、Project 的用户删除操作统一视为软删除/归档。默认 active 视图只显示未归档对象；归档内容只在专门的归档区展示，并支持恢复。

---

## 对象关系

```
Domain (optional)
  └── Project (n)
        ├── Quest (n)
        │     ├── Run (n)          — 所有执行记录（chat / manual / automation）
        │     ├── QuestOp (n)      — 状态变更日志
        │     └── UploadedAsset (n) — Quest 级附件元数据，按 questId 落盘
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
- **鉴权**：CLI 配置凭据，Web 登录后使用 cookie session；CLI / 自动化可用 Bearer token

---

## 关键设计决策

### 业务 API 默认必须鉴权

除 `/health` 和 `/api/auth/me` 这类探测接口外，所有 `/api/*` 业务接口都必须通过鉴权后才能访问。系统不允许因为尚未配置密码或 token 而自动放行业务 API。

**登录流程：**

1. 用户先在服务端本机的 Pluse 仓库根目录执行 `pnpm pluse auth setup --password ...` 配置密码，可选配置 username；如果已安装全局 CLI，也可使用 `pluse auth setup ...`。
2. Web 端通过 `/auth/login` 使用密码或 API token 登录。
3. 登录成功后服务端写入 `pulse_session` HttpOnly cookie 和 `pulse_csrf` cookie。
4. 后续浏览器请求依赖 `pulse_session` 识别会话；`POST` / `PATCH` / `PUT` / `DELETE` 还必须带 `X-CSRF-Token`，值与 `pulse_csrf` cookie 及服务端 session 记录一致。

CLI / 自动化调用可以使用 `Authorization: Bearer <token>`，token 由 `pnpm pluse auth token` 或全局 `pluse auth token` 生成并存储在 `auth` 表中。Bearer 调用不走 CSRF，因为它不依赖浏览器 cookie。

**理由：** Pluse 是远程 AI 工作台，会暴露项目路径、运行历史、附件和执行能力；未登录即可使用会形成直接安全隐患。首次凭据通过本机 CLI 配置，而不是 Web 首访注册，避免远程访问者抢先初始化密码。

### Quest 有 kind 字段，互斥可切换

Quest 用 `kind` 区分 session 态和 task 态，两种形态互斥，用户可手动切换。切换时 AI provider context（codexThreadId / claudeSessionId）保留不变。

**理由：** session 态出现在左侧会话列表，task 态出现在右侧统一任务面板，两者的 UI 展示和调度行为差异显著，需要明确区分。

### Domain 只组织 Project，不参与执行语义

Domain 只提供跨项目的长期分组与导航入口，不改变 Project 的本质，也不影响 Quest 的 provider context、调度和运行历史。

**理由：** 用户需要一个稳定的上层信息架构来组织多个长期项目，但暂时不需要把目标系统、预算、复盘或运行时行为提升到 Domain 层。

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
| UI：Session 列表 + Task 列表（两套独立入口） | UI：左侧 `会话 | 领域` 导航 + 右侧统一任务面板（Quest task + Todo） |

# Pluse UI 设计

> 本文档替换旧的 Quest + Automations Tab 口径。
> 正式依据：`0011-thread-centric-ia` + 当前实现。

---

## 设计原则

- 侧边栏继续区分 **Sessions** 与 **Tasks**，但两者都来自同一张 `quests` 表。
- Quest 详情统一走 `/quests/:id`，不再让 URL 绑定 `session` / `task` 语义。
- Todo 是独立对象，不挂在 Quest tab 下；统一放在全局右侧面板。
- 任务详情必须同时展示：
  - 当前配置
  - 最近运行历史
  - `QuestOp` 活动日志
- 会话详情必须保留：
  - 消息流
  - 附件发送
  - 运行时 tool/model 切换

---

## 整体布局

```text
┌──────────────────────────────┬──────────────────────────────────────┬──────────────────────┐
│ 左侧栏                        │ 主内容区                               │ 右侧 Todo 面板         │
│                              │                                        │                      │
│ Projects                     │ /projects/:id                          │ Todos                │
│ Sessions                     │ /quests/:id                            │ 全项目 Todo 列表      │
│ Tasks                        │                                        │ 来源 Quest 跳转       │
└──────────────────────────────┴──────────────────────────────────────┴──────────────────────┘
```

### 左侧栏

- 顶部是项目列表与项目打开入口。
- 中间拆成两个 section：
  - `Sessions`
  - `Tasks`
- 两个 section 都来自 `quests`，仅按 `kind` 过滤。
- Session 支持本地搜索。
- 支持直接新建 session quest / task quest。

### 主内容区

- `/projects/:id`
  - 项目概览页
  - 展示 sessions/tasks/todos 计数、最近输出、项目信息
- `/quests/:id`
  - 统一 Quest 详情页
  - 根据 `quest.kind` 渲染成会话视图或任务视图

### 右侧 Todo 面板

- 始终显示当前项目 Todo。
- 支持新建、完成、删除。
- 每条 Todo 可显示 `originQuestId`，点击跳回对应 Quest。
- 不做独立 Todo SSE；依赖项目/Quest 事件和本地操作后主动刷新。

---

## Session 详情

Session 详情对应 `kind='session'` 的 Quest。

### 顶部控制区

- 会话名称编辑
- tool 选择
- model 选择
- `Switch To Task`
- `Clear Queue`
- 当前 follow-up queue 数量

### 中间内容区

- 展示 Quest 事件流（messages / reasoning / tool_use / tool_result / status）
- SSE 订阅 `/api/events?questId=...`，收到相关失效事件后重拉

### 底部输入区

- 文本输入
- 附件上传
- 发送消息
- 展示最近一次 run 状态

### Session 特有交互

- 首个 chat run 结束后触发 auto-rename；命名结果异步回写到会话标题。
- 附件上传参数使用 `questId`。
- 会话忙时，新消息进入 follow-up queue，而不是报错。

---

## Task 详情

Task 详情对应 `kind='task'` 的 Quest。

### 顶部控制区

- 任务标题 / 描述编辑
- 启用状态
- tool / model / effort / thinking
- `Run Now`
- `Switch To Session`
- `Create Todo`

### 执行配置区

- `executorKind`
  - `ai_prompt`
  - `script`
- `executorConfig`
  - prompt / command / timeout / env / workDir
- `executorOptions`
  - `continueQuest`
  - `reviewOnComplete`
  - 其他运行时选项

### 调度配置区

- `scheduleKind`
  - `once`
  - `scheduled`
  - `recurring`
- `scheduleConfig`
  - `runAt`
  - `cron`
  - `timezone`
  - `nextRunAt`
  - `lastRunAt`

### 运行历史区

- 展示最近 runs
- 显示 state / trigger / createdAt / failureReason

### 活动日志区

- 展示 `QuestOp`
- 至少覆盖：
  - `created`
  - `kind_changed`
  - `triggered`
  - `done`
  - `failed`
  - `cancelled`

---

## Kind 切换规则

### task -> session

- 仍然是同一个 Quest，只更新 `kind`
- 调度暂停
- 任务配置保留：
  - `scheduleKind`
  - `scheduleConfig`
  - `executorKind`
  - `executorConfig`
  - `executorOptions`
- UI 不再用 task `status` 驱动主状态展示

### session -> task

- 仍然是同一个 Quest
- `status` 重置为 `pending`
- 已有 provider context 保留
- 随后可立即手动运行或等待调度

---

## 不再采用的旧设计

- 不做 `Automations Tab`
- 不做 Quest 内嵌 Todo Tab
- 不做 `/sessions/:id` / `/tasks/:id`
- 不保留旧 `TaskRail`
- 不保留“Task 执行后自动创建 Session”的体验

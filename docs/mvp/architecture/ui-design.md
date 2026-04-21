# Pluse UI 设计

> 本文档替换旧的 Quest + Automations Tab 口径。
> 正式依据：`0011-thread-centric-ia` + 当前实现。

---

## 设计原则

- 左侧栏承担项目切换、Domain 分组入口和轻量会话入口，不再在左侧重复任务列表。
- 右侧栏是统一任务面板，同时展示 AI 任务（`Quest kind='task'`）和人类 Todo。
- Domain 只组织 Project，不引入单独的 Domain 详情页或 Domain 级执行语义。
- 所有用户删除动作统一为归档：active 列表隐藏，归档区折叠展示，可恢复。
- Quest 详情统一走 `/quests/:id`，不再让 URL 绑定 `session` / `task` 语义。
- Todo 是独立对象，不挂在 Quest tab 下；只在右侧统一任务面板里出现。
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
┌──────────────────────────────┬──────────────────────────────────────┬────────────────────────────┐
│ 左侧栏                        │ 主内容区                               │ 右侧任务面板                  │
│                              │                                        │                            │
│ 项目切换 + 领域 / 会话           │ /projects/:id                          │ 全部 / 人类 / AI            │
│                              │ /quests/:id                            │ Quest(task) + Todo 统一列表 │
│                              │                                        │ 来源 Quest 跳转 / 归档区     │
└──────────────────────────────┴──────────────────────────────────────┴────────────────────────────┘
```

### 左侧栏

- 顶部是项目切换器；当前项目摘要与项目设置入口位于项目列表上方。
- 顶部导航切为两个 tab：
  - `领域`
  - `会话`
- 默认优先落在 `会话` tab。
- `领域` tab 下展示跨项目的 Domain 分组视图：
  - 顶部显示“全部项目”统计
  - 支持新建 Domain 与一键套用默认模板
  - 展示“未分组”和各 Domain 的折叠分组
  - 每个 Domain 可编辑、归档；归档后其下 Project 自动回到“未分组”
  - 点击 Project 直接切换并进入 `/projects/:id`
- `会话` tab 不再承担完整的 Session 列表切换；当前实现仅保留会话入口说明与“新建会话”动作。
- Session 的实际切换发生在主工作区，而不是左侧重复渲染一份列表。
- 左侧与项目切换会记住每个 Project 上次打开的会话；再次进入该 Project 时优先恢复该会话。
- 若某个 Project 还没有记忆中的会话，则默认进入当前排序下的第一个会话；若没有任何会话，则停留在 `/projects/:id`。
- 新建 Project 表单和项目设置页都允许选择 `Domain`；为空时归入“未分组”。

### 主内容区

- `/projects/:id`
  - 项目概览页
  - 只展示全局概览、最近输出、项目信息
  - 项目 header 可显示当前所属 Domain
  - 不重复渲染会话列表或任务列表
- `/quests/:id`
  - 统一 Quest 详情页
  - 根据 `quest.kind` 渲染成会话视图或任务视图

### 右侧任务面板

- 始终显示当前项目的统一任务列表：
  - AI 任务来自 `Quest(kind='task')`
  - 人类任务来自 `Todo`
- 顶部筛选固定为 `全部 / 人类 / AI`。
- 主列表先展示 active 项：
  - 人类任务：`status='pending'`
  - AI 任务：`status in ('pending', 'running')`
- active 项之后展示已完成/失败/取消的历史项，仍属于主列表。
- 归档项不进入主列表，只在折叠的“归档任务”区显示。
- AI 任务支持 `Run Now` 与归档；人类任务支持完成、恢复、归档。
- Todo 若存在 `originQuestId`，可点击跳回对应 Quest。
- 新建任务使用一个全局弹窗，统一覆盖 AI 任务与人类 Todo。
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
- 不做 `/domains/:id`
- 不做 `/sessions/:id` / `/tasks/:id`
- 不保留旧 `TaskRail`
- 不保留“Task 执行后自动创建 Session”的体验

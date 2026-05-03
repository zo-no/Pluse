# 0012 — Check-ins Design

**状态**: accepted
**类型**: design
**关联 requirement**: `docs/v2/requirements/0012-check-in-reminders.md`

## 设计目标

把打卡收敛为独立的轻量回执能力：

- Reminder 继续负责当前注意力触达
- Check-in 负责当前待回执行为证据
- Check-in Record 负责长期事实记录
- Quest / Agent 负责决定何时创建下一条 Check-in

## 对象边界

### Reminder

Reminder 是当前注意力对象。

Reminder 不承担历史分析，不做归档状态，不做软删除。

普通提醒处理后直接删除，不生成 Check-in Record。

### Check-in

Check-in 是当前待回执对象。它表达：系统需要用户对某个行为或状态给出一次事实回执。

它不是 Todo：

- 不表示人工承诺
- 不进入 Todo 状态流
- 不显示 Todo 前面的圆圈交互
- 不复用 Todo 的归档、重复、等待等语义

它也不是 Reminder：

- 不复用 Reminder 的 `type`
- 不进入提醒归档或提醒分析
- 完成时必须先写 Check-in Record，再删除当前 Check-in

### Check-in Record

Check-in Record 是完成打卡后留下的事实。

因为当前 Check-in 会被删除，record 保存打卡项快照，而不是依赖外键回查当前项：

- `checkInId`
- `projectId`
- `originQuestId`
- `originRunId`
- `title`
- `body`
- `remindAt`
- `checkedAt`
- `createdBy`
- `note`

## UI 设计

工作台顶部对象切换为 `待办 / 提醒 / 打卡`。

列表交互：

- 普通提醒：点击正文打开详情；来源 Quest 用独立图标跳转；✅ 删除提醒
- 当前打卡项：点击正文优先进入来源 Quest；独立详情入口查看全文；✅ 一键完成，写空备注 record 并删除当前打卡项

详情交互：

- 普通提醒详情只展示标题、内容、来源、时间、优先级、延后和完成
- 打卡详情展示标题、内容、来源、时间、优先级和可选备注输入框
- 点击“完成打卡”写入 record 并删除当前打卡项

第一期打卡主要由 Quest / Agent / API / CLI 创建；UI 可保留轻量新建入口，但不把它设计成 Reminder 的类型选择。

## API / CLI 设计

当前打卡项：

```text
GET /api/check-ins?projectId=<id>
POST /api/check-ins
PATCH /api/check-ins/:id
DELETE /api/check-ins/:id
pluse check-in list --project-id <id> [--json]
pluse check-in create --project-id <id> --title "..." [--remind-at <time>] [--json]
```

完成打卡并记录事实：

```text
POST /api/check-ins/:id/complete
pluse check-in complete <id> [--note <note>] [--json]
```

读取记录：

```text
GET /api/check-in-records?projectId=<id>
pluse check-in records --project-id <id> [--json]
```

约束：

- 完成接口在同一事务内写 record 并删除当前 Check-in
- 普通删除 Check-in 不生成 record，表示这次触达被移除
- Reminder API 不创建 Check-in；历史 `/api/reminders/:id/check-in` 只作为过渡兼容入口

## Agent 规则

Agent 创建提醒时必须先判断对象语义：

- 只是通知或提醒：普通 Reminder
- 需要人类行为回执：Check-in
- 需要人工完成一项工作：Todo

默认提醒可以没有时间。

默认 Check-in 也可以没有时间。

如果提醒或 Check-in 和某个时间窗口有关，Agent 应写 `remindAt`，方便时间线展示和后续判断。

## 不做

- 不做周期打卡
- 不做 missed 对象
- 不做打卡历史 UI
- 不做提醒归档
- 不做 tag
- 不把 Check-in 并入 Todo

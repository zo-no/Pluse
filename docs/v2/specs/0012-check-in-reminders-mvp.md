# 0012 — Check-ins MVP

**状态**: accepted
**类型**: spec
**关联 requirement**: `docs/v2/requirements/0012-check-in-reminders.md`
**关联 design**: `docs/v2/designs/0012-check-in-reminders.md`

## Summary

本期实现独立打卡 MVP：Check-in 作为当前待回执对象，由 Quest / Agent / API / CLI 创建；用户完成时写入 Check-in Record，并删除当前 Check-in。

## Data / Types

- `ReminderType` 不包含 `check_in`；Reminder 继续只表达当前注意力消息。
- 新增 `CheckIn`，表达当前待用户回执的行为证据请求。
- 新增 `CheckInRecord`。
- 新增 `check_ins` 表，保存当前待回执项。
- 新增 `check_in_records` 表，保存 Check-in 快照，不对 `checkInId` 建外键依赖。
- Record 字段包含：`id`、`projectId`、`checkInId`、`originQuestId`、`originRunId`、`title`、`body`、`remindAt`、`checkedAt`、`createdBy`、`note`、`createdAt`、`updatedAt`。

## API / CLI

- `GET /api/check-ins`
  - 返回当前待回执 Check-in。
  - 支持按 `projectId`、`originQuestId`、`originRunId`、`priority`、`time` 过滤。
- `POST /api/check-ins`
- `PATCH /api/check-ins/:id`
- `DELETE /api/check-ins/:id`
- `POST /api/check-ins/:id/complete`
  - 写入 Check-in Record 后硬删除当前 Check-in。
  - 返回创建的 record。
- `GET /api/check-in-records`
  - 支持按 `projectId`、`checkInId`、`originQuestId`、`originRunId` 过滤。
- `pluse check-in list --project-id <id> [--json]`
- `pluse check-in create --project-id <id> --title "..." [--remind-at <time>] [--json]`
- `pluse check-in complete <id> [--note <note>] [--json]`
- `pluse check-in records --project-id <id> [--json]`

## UI

- 工作台对象 tab 包含 `待办 / 提醒 / 打卡`。
- 提醒列表只展示普通提醒。
- 打卡列表只展示当前 Check-in。
- 列表 ✅ 对 Check-in 执行一键完成，写空备注 record 并删除当前项。
- 打卡详情提供备注输入和“完成打卡”。
- 点击打卡正文优先进入来源 Quest；详情入口负责查看全文和备注完成。

## Acceptance

- 普通提醒删除后不生成 Check-in Record。
- Check-in 完成后，当前 Check-in 不再可查询，Check-in Record 仍可查询。
- 普通提醒调用过渡 check-in 接口返回错误，且提醒不被删除。
- Todo、Automation、普通 Reminder 的现有行为不变。

## 不做

- 周期、missed、next active、stopped
- 打卡统计或历史 UI
- 补记入口
- tag / 分类
- Todo 状态流复用

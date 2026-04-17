# 0004 — 任务详情侧面板 + Task Review 工作流前端

**状态**: approved  
**优先级**: high  
**估算**: M

## 背景

TaskRail 目前只有卡片列表，点击任务无任何响应。Human Task 的 `waitingInstructions` 没有展示入口，用户无法方便地标记完成或查看执行历史。参考 conductor 的 TaskDetail 组件设计。

## 目标

- 点击 TaskRail 任务卡片，右侧展开详情面板
- Human Task 展示 `waitingInstructions`，有"完成"按钮（可选填输出）
- AI Task 展示执行历史（runs + logs），有"运行"按钮
- 支持删除任务

## 不在范围内

- 任务编辑（修改 title/prompt 等）
- 创建新任务的 UI（AI 通过 CLI 创建）

## 方案设计

### TaskRail 变更

- 任务卡片点击后设置 `selectedTaskId`
- 卡片高亮选中状态
- `waitingInstructions` 在卡片上显示一行预览（Human Task）

### TaskDetail 新组件

`packages/web/src/views/components/TaskDetail.tsx`

三个 Tab：
- **信息**：description、waitingInstructions、executor、scheduleConfig、completionOutput、blockedByTaskId
- **历史**：task runs 列表，显示状态/时间/耗时，点击展开 spool 输出
- **操作日志**：task ops 时间线

底部操作栏：
- Human pending → "完成"按钮（点击后展开输入框填写 output，可选）
- AI pending/failed → "运行"按钮
- AI running → 运行中指示器
- 所有状态 → 删除按钮（低调，需确认）
- AI 任务 → 启用/暂停 toggle

### 布局

TaskRail 拆分为左右两列：
- 左列（任务列表）：固定宽度
- 右列（详情面板）：选中任务时展开，无选中时隐藏

## API 依赖

- `GET /api/tasks/:id/runs` ✅ 已有
- `GET /api/tasks/:id/logs` ✅ 已有  
- `GET /api/tasks/:id/ops` ✅ 已有
- `POST /api/tasks/:id/done` ✅ 已有
- `POST /api/tasks/:id/run` ✅ 已有
- `DELETE /api/tasks/:id` ✅ 已有
- `PATCH /api/tasks/:id` ✅ 已有（enabled toggle）

## 验收标准

- [ ] 点击任务卡片展开详情面板
- [ ] Human Task 显示 waitingInstructions，有"完成"按钮
- [ ] AI Task 有"运行"按钮，running 时显示指示器
- [ ] 历史 tab 显示 runs 列表
- [ ] 删除任务有二次确认
- [ ] 关闭按钮收起详情面板

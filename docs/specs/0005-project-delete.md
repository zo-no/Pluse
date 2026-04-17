# 0005 — 项目完全删除

**状态**: approved  
**优先级**: medium  
**估算**: S

## 背景

目前只有归档，无法彻底删除项目。需要级联删除所有关联数据。

## 方案设计

### 后端

`DELETE /api/projects/:id`

级联删除顺序（外键约束）：
1. task_run_spool → task_runs → task_logs → task_ops → tasks
2. session_events → runs → sessions
3. projects

CLI：`pulse project delete <id> [--confirm]`

### 前端

项目设置页（ProjectPage 的 settings tab）底部加"删除项目"按钮，点击弹出确认对话框，输入项目名称确认后执行删除，删除后跳转到首页。

## 验收标准

- [ ] `DELETE /api/projects/:id` 级联删除所有数据
- [ ] 前端有删除入口和确认对话框
- [ ] 删除后跳转首页
- [ ] `pulse project delete <id>` CLI 命令可用

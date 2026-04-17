# Pluse v2 UI 设计

> 正式口径，由 0011-quest-centric-ia.md 收敛而来。

---

## 整体布局

```
┌──────────────────────┬─────────────────────────────────────────┐
│ 侧边栏 (280px)        │ 主区域                                   │
│                      │                                          │
│  [项目名称 ▾]         │  Quest 名称                [设置]       │
│  ────────────────    │  ──────────────────────────────────────  │
│  + 新建 Quest        │  [Chat] [Automations (n)] [Todos (n)]   │
│  ────────────────    │  ──────────────────────────────────────  │
│  Quest 1  [●]        │                                          │
│  Quest 2  [auto]     │  （Tab 内容区）                           │
│  Quest 3            │                                          │
│  ...                 │                                          │
│  ────────────────    │                                          │
│  Todos (3)           │                                          │
└──────────────────────┴─────────────────────────────────────────┘
```

---

## 侧边栏

### Quest 列表

每条 Quest 显示：名称 + 最后活动时间 + 状态标签

- `[●]` 有活跃 Run（动态圆点）
- `[auto]` 有至少一个 enabled Automation
- 右键菜单：重命名、置顶/取消置顶、归档、删除

### Todos 入口（底部）

显示项目内未完成 Todo 数量，点击打开全局 Todo 面板。

---

## Quest 详情页

### Chat Tab

- 消息历史 + 输入区（与 v1 Session 聊天视图一致）
- Automation run 在消息流中以分隔行标注：
  ```
  ──── Automation: "每日代码审查" · 2026-04-17 09:00 ────
  ```
- 不创建额外 Quest，所有输出写入同一 Quest

### Automations Tab

列出 Quest 下所有 Automation：
- 标题、调度描述、执行器类型、上次执行时间、状态
- enabled 开关 + 手动触发按钮 `[▶]`
- 点击展开详情：调度配置、执行器配置、执行历史（最近 N 次）

### Todos Tab

列出 `originQuestId = quest.id` 的 Todo，可标记完成/取消。

---

## 全局 Todo 面板

- 显示项目内所有未完成 Todo
- 每条 Todo 显示来源 Quest（若有），点击跳转
- 可新建不关联 Quest 的 Todo

---

## 不再保留的 v1 设计

- Session 一级导航 → Quest 列表
- Task 列表（TaskRail）→ Quest 详情 → Automations Tab
- Session ↔ Task 互转按钮 → 删除
- 系统自动创建的 Session → 不再存在

# 0005 — 会话失败 Todo 通知

**状态**: done  
**优先级**: medium  
**估算**: S

## 背景

当前 hooks 机制只在 `run_completed` 时触发通知（高亮 + Todo）。
`run_failed` 事件虽然已在代码里定义，但默认配置里没有对应 hook，
导致单轮会话失败时用户完全无感知。

## 目标

- 会话失败后自动创建 Todo 通知用户
- 设置页面可控开关（与"完成通知"对称）

## 不在范围内

- 失败原因不写入 Todo（标题够用）
- 不处理 task 类型的失败通知（本期只做 session）

## 方案设计

### 后端变更

**`packages/server/src/services/hooks.ts`**

`DEFAULT_HOOKS_CONFIG` 新增一条 hook：

```json
{
  "id": "notify-on-session-failed",
  "event": "run_failed",
  "enabled": true,
  "filter": { "kind": "session", "triggeredBy": ["human"] },
  "actions": [
    { "type": "highlight_quest" },
    { "type": "create_todo", "title": "查看失败会话：{{quest.name}}" }
  ]
}
```

无其他后端改动，`run_failed` 事件已完整支持。

### 前端变更

**`packages/web/src/pages/SettingsPage.tsx`**

在"通知"section 的"会话完成后创建待办"开关下方，新增：

- **会话失败后创建待办**（开关）
  - 说明文字：「AI 执行出错时，自动在待办列表创建提醒」
  - 对应 hook id：`notify-on-session-failed`
  - 读取/写入逻辑与现有开关完全一致

## 验收标准

- [x] 会话单轮失败后，自动创建 Todo「查看失败会话：xxx」
- [x] 设置页"通知"section 显示两个开关，失败通知开关默认开启
- [x] 关闭失败通知开关后，失败不再创建 Todo
- [x] 已有的完成通知行为不受影响

## 备注

- `DEFAULT_HOOKS_CONFIG` 变更只影响首次使用（`~/.pluse/hooks.json` 不存在时）；
  已有用户需手动在 `~/.pluse/hooks.json` 加入新 hook，或通过设置页开关触发写入。
- `patchHook` 已改为：找不到 hook 时从 `DEFAULT_HOOKS_CONFIG` 取模板插入，设置页开关可直接操作新 hook。
- 前端文件路径为 `packages/web/src/views/pages/SettingsPage.tsx`（非 spec 中写的 `pages/`）。

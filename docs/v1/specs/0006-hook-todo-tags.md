# 0006 — Hook 自动 Todo 标签

**状态**: done  
**优先级**: low  
**估算**: XS

## 背景

0004 为 Todo 引入了 tags 能力，但 hooks 自动创建的 Todo（查看会话、查看失败会话）没有利用这个能力。
用户无法通过 tag 过滤栏快速定位"需要查看的会话"或"失败的会话"，需要手动翻找。

## 目标

- `notify-on-session-complete` hook 创建的 Todo 自动带 `review` tag
- `notify-on-session-failed` hook 创建的 Todo 自动带 `failed` tag
- 用户可在 tag 过滤栏点击 `review` / `failed` 快速筛选

## 不在范围内

- 不支持在设置页自定义 hook 自动 tag（tag 硬编码在默认配置里）
- 不修改已有的存量 Todo（只影响新触发的 hook）
- 不为其他 hook（如 speak-on-session-complete）添加 tag

## 方案设计

### 后端变更

**`packages/server/src/services/hooks.ts`**

1. `CreateTodoAction` 接口新增可选字段 `tags?: string[]`

2. `DEFAULT_HOOKS_CONFIG` 两条 hook 的 `create_todo` action 加入 tags，并去掉标题前缀（tag 已表达语义）：
   - `notify-on-session-complete`：`title: '{{quest.name}}'`，`tags: ['review']`
   - `notify-on-session-failed`：`title: '{{quest.name}}'`，`tags: ['failed']`

3. `runHooks` 执行 `create_todo` action 时，将 `action.tags` 传入 `createTodoWithEffects`

### 前端变更

无前端变更。tag 过滤栏已在 0004 中实现，新 tag 会自动出现在过滤栏。

## 验收标准

- [x] 会话完成后创建的 Todo 带有 `review` tag
- [x] 会话失败后创建的 Todo 带有 `failed` tag
- [x] tag 过滤栏可点击 `review` / `failed` 筛选对应 Todo
- [x] 存量 Todo 不受影响

## 备注

- `DEFAULT_HOOKS_CONFIG` 变更只影响未写入 `~/.pluse/hooks.json` 的用户（即首次使用或未覆盖默认配置的用户）；
  已有自定义 hooks.json 的用户需手动更新，或删除 hooks.json 重新生成
- `CreateTodoAction.tags` 为可选字段，不填时行为与之前一致，向后兼容

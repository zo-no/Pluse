# 0001 — Session 实时推送（SSE 替换轮询）

**状态**: done  
**优先级**: high  
**估算**: S

## 背景

`ChatView.tsx` 目前用 `setInterval(900ms)` 轮询 session 和 thread 数据。后端已有完整的 SSE 端点（`GET /events?sessionId=xxx`）和 heartbeat 机制，只需前端接入。

## 目标

- AI 会话结束时前端立即收到通知并刷新，无需等待轮询周期
- 减少无效 HTTP 请求

## 不在范围内

- 流式输出（逐 token 显示）
- 全局事件订阅（仅 ChatView 内 session 级别）

## 方案设计

### 后端

无需变更。`GET /events?sessionId=xxx` 已支持：
- `session_updated` 事件（run 开始/结束时触发）
- `connected` 确认事件
- 30s heartbeat（保活）
- abort signal 清理

### 前端变更（ChatView.tsx）

**替换逻辑**：

1. 移除 `session.activeRunId` 触发的 `setInterval(900ms)` 轮询
2. 组件 mount 时建立 `EventSource` 连接 `/events?sessionId=xxx`
3. 收到 `session_updated` 事件时调用 `refreshSession()` + `refreshThread()`
4. 组件 unmount 时关闭 `EventSource`

**断线重连**：使用 `EventSource` 原生重连（浏览器自动处理，默认 3s 重试）。无需手动实现。

**保留轮询的场景**：无。SSE 连接期间不需要轮询兜底——heartbeat 已保活，断线后浏览器自动重连。

## 验收标准

- [ ] AI run 结束后，ChatView 在 1s 内刷新（不再依赖 900ms 轮询周期）
- [ ] 切换 session 时旧连接关闭，新连接建立
- [ ] 网络断开重连后恢复正常推送
- [ ] 无 setInterval 残留

## 关键文件

- `packages/web/src/views/components/ChatView.tsx` — 唯一改动文件

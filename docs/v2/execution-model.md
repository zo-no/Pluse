# 执行模型

## Run 生命周期

```
用户发送消息
  → POST /api/sessions/:id/messages
  → 若 session.activeRunId 存在：消息进入 follow-up queue，返回 { queued: true }
  → 若空闲：创建 Run（state='accepted'），更新 session.activeRunId
  → fork Claude CLI 子进程
  → Run state='running'，记录 runnerProcessId
  → 子进程流式输出写入 spool.jsonl
  → server 轮询 spool，通过 WebSocket 推送 run delta 给前端
  → 子进程退出
  → finalize：spool 归一化写入 session_events
  → Run state='completed'，session.activeRunId=null
  → WebSocket 推送 session invalidation
  → 检查 follow-up queue，若有消息则取出继续执行
```

## Follow-up Queue

当 session.activeRunId 非空时，新消息进入队列：

- 同一 requestId 不重复入队（幂等）
- 当前 Run 完成后自动取队首执行
- 执行完继续检查队列，直到清空

队列存储在 sessions 表的 `follow_up_queue` 字段（JSON 数组）。

## Fork 子进程

```typescript
// 伪代码
const proc = Bun.spawn(
  ['claude', '--model', run.model, '--output-format', 'stream-json', ...],
  {
    cwd: project.path,          // 工作目录 = project 的本地文件夹
    env: { ...process.env },
    stdout: 'pipe',
    stderr: 'pipe',
  }
)
```

**System prompt 注入：**
- project.systemPrompt 通过 `--system-prompt` 参数传入
- 若 project.systemPrompt 为空则不传

**输出写入 spool：**
```
~/.melodysync/runtime/runs/<runId>/spool.jsonl
```
每行一个 JSON 对象，格式由 Claude CLI `--output-format stream-json` 决定。

## Spool 归一化

Run 完成后，server 将 spool.jsonl 解析并写入 session_events：

| spool 事件类型 | → session_events 类型 |
|---|---|
| 用户消息 | message（role=user） |
| assistant 文本 | message（role=assistant） |
| thinking | reasoning |
| tool_use | tool_use |
| tool_result | tool_result |
| usage | usage |

## 取消

用户点击取消：
1. `POST /api/runs/:id/cancel`
2. server 设置 `run.cancelRequested=true`
3. 向 runnerProcessId 发送 SIGTERM
4. 等待 15 秒 grace period
5. 若进程仍存活，发送 SIGKILL
6. Run state='cancelled'，result='cancelled'

## 超时

- 默认超时：300 秒
- 超时后：先 SIGTERM，15 秒后 SIGKILL
- Run state='failed'，failureReason='timeout'

## 启动时恢复

server 启动时检查所有 state='accepted' 或 state='running' 的 Run：
- 若 runnerProcessId 对应的进程已不存在：Run state='failed'，failureReason='process_lost'
- session.activeRunId 清空
- 检查 follow-up queue，若有消息重新触发执行

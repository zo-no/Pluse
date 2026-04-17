# Pluse v2 执行模型

> 正式口径，由 0005-thread-execution-model.md 收敛而来。

---

## 三种触发来源

| 触发来源 | `runs.trigger` | `runs.triggered_by` | 入口 |
|---------|---------------|---------------------|------|
| 用户发消息 | `chat` | `human` | `POST /api/quests/:id/messages` |
| 用户手动触发执行 | `manual` | `human` | `POST /api/quests/:id/run` |
| 调度器自动触发 | `automation` | `scheduler` | 内部调度器 |

---

## Run 生命周期

```
触发 → 创建 Run（state='accepted'）→ quest.activeRunId = run.id
  → fork AI 子进程 → Run state='running'
  → 流式输出写入 run_spool → SSE 推送前端
  → 子进程退出
  → finalize：spool 归一化写入历史文件（~/.pluse/runtime/quests/{questId}/events/）
  → Run state='completed'|'failed'|'cancelled'
  → 回写 Quest（provider context id、status、completionOutput）
  → quest.activeRunId = null
  → SSE 推送 quest invalidation
  → 检查 followUpQueue
```

---

## 并发约束

**同一 Quest 同时只能有一个活跃 Run。**

| 操作 | Quest 有活跃 Run 时 |
|------|---------------------|
| Chat（新消息） | 入 followUpQueue |
| Manual run | [▶] 按钮禁用，不可触发 |
| Automation 调度 | 跳过本次，不入队 |

---

## Follow-up Queue

- 只有 `chat` 触发的消息才入队
- 同一 `requestId` 不重复入队（幂等）
- Run 完成后自动消费队首
- 服务重启后恢复未消费的队列

---

## continueQuest 执行策略

**continueQuest = true（默认）：** 优先 native resume（传 codexThreadId / claudeSessionId），失败则降级为 history injection。

**continueQuest = false：** 强制新上下文，不传 resume id，run 完成后不更新 Quest 的 provider context id。

---

## 子进程执行

```typescript
const proc = Bun.spawn(
  ['codex', '--thread', quest.codexThreadId, ...],
  {
    cwd: project.workDir,
    env: { ...process.env },
    stdout: 'pipe',
    stderr: 'pipe',
  }
)
```

输出写入：`~/.pluse/runtime/runs/<runId>/spool.jsonl`

---

## 超时与取消

- 默认超时：300 秒（task 态可通过 `executorConfig.timeout` 覆盖）
- 超时/取消：SIGTERM → 15 秒 grace → SIGKILL
- 取消后：task 态 quest.status = 'pending'（不算失败）

---

## 服务启动恢复

1. 检测 state='accepted'|'running' 的 Run，进程不存在则标记 `process_lost`
2. 重新注册所有 enabled=true 且 kind='task' 的 Quest 调度器
3. 恢复 followUpQueue 中未消费的消息
4. once 任务：runAt 已过且 status='pending' 立即触发；status='failed' 不重触发

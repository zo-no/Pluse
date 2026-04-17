# 0004 — 跨 Agent 上下文模型

**状态**: draft  
**类型**: core  
**优先级**: high  
**依赖**: 0003-quest-unified-model.md

---

## 背景

Pluse 支持 Codex 和 Claude 两个 agent。同一个 Quest 可能在不同时间使用不同 agent 执行。本 spec 定义上下文延续的机制。

---

## 核心原则

**Pluse 自己的记录是 source of truth。**

历史消息存储在文件系统（`~/.pluse/runtime/quests/{questId}/events/`），不依赖 provider 侧的 context 来保存历史。Provider context id（codexThreadId / claudeSessionId）只是加速手段——有的话用 native resume，没有的话降级为历史注入。

---

## Provider Context Id 的定位

`codexThreadId` 和 `claudeSessionId` 存储在 Quest 上，但它们：

- **不是 Quest 的主键**：Quest 的 id 是 `qst_xxx`
- **可以为空**：Quest 刚创建时没有，第一次 Run 完成后才有
- **可以失效**：provider 侧 context 有 TTL，过期后无法 resume
- **项目内唯一**：唯一索引是 `(project_id, codex_thread_id)`

---

## 上下文延续策略

每次 Run 执行时，按以下优先级决定如何传递上下文：

```
1. 有对应 agent 的 provider context id（且 continueQuest=true）
   → native resume：直接传 codexThreadId / claudeSessionId 给 CLI
   → AI 在 provider 侧续接完整上下文

2. 没有 provider context id，或 continueQuest=false
   → history injection：从文件系统读取最近 N 条消息，拼入 prompt
   → AI 通过注入的历史感知之前的工作

3. history injection 失败（历史为空）
   → 以新上下文开始，不报错
```

**实现（伪代码）：**
```typescript
const nativeResume = tool === 'claude'
  ? Boolean(quest.claudeSessionId) && continueQuest
  : Boolean(quest.codexThreadId) && continueQuest

function buildPrompt(questId, newMessage, { nativeResume }) {
  if (nativeResume) return newMessage

  const history = listEvents(questId)
    .filter(e => e.type === 'message')
    .slice(-40)
    .map(e => `${e.role}: ${e.content}`)
    .join('\n\n')

  return history
    ? `[Prior context]\n${history}\n\n[New message]\n${newMessage}`
    : newMessage
}
```

---

## Provider Context Id 的写回

Run 执行过程中，从 AI 输出流实时解析 provider context id，立即持久化：

```typescript
wireLineStream(child.stdout, (line) => {
  const parsed = parseProviderLine(tool, line)
  persistResumeIds(questId, runId, {
    claudeSessionId: parsed.claudeSessionId,
    codexThreadId: parsed.codexThreadId,
  })
})
```

Run 完成后，Quest 上的 `codexThreadId` / `claudeSessionId` 是最新值，下次执行直接用。

---

## Codex 和 Claude 的兼容性

Codex 和 Claude 的 provider context 相互兼容，同一个 Quest 切换 agent 时可以尝试 resume。如果 resume 失败（context 过期或不兼容），自动降级为 history injection，不报错给用户。

---

## 历史文件存储

```
~/.pluse/runtime/quests/{questId}/events/
  000000000.json
  000000001.json
  ...
  meta.json
```

每个文件是一个 SessionEvent，按 seq 序号命名。`meta.json` 记录最新 seq 和统计信息。

---

## 不需要的复杂机制

以下机制**不需要实现**：

- `quest_agent_state` 独立表：Quest 上的 `codexThreadId` / `claudeSessionId` 已足够
- Summary injection：历史注入直接用原始消息，不需要 AI 生成摘要
- 跨 agent 的 context 迁移协议：降级为 history injection 即可

---

## 验收标准

- [ ] Run 执行时正确判断是否使用 native resume
- [ ] native resume 失败时自动降级为 history injection，不报错
- [ ] provider context id 从输出流实时解析并写回 Quest
- [ ] 历史文件存储在 `~/.pluse/runtime/quests/{questId}/events/`
- [ ] `continueQuest=false` 时强制使用新上下文，不传 resume id

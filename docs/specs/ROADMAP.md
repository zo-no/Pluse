# Pluse 功能 Roadmap

## 实现顺序与优先级

### 第一批 — 核心功能缺陷（影响实际使用）

| # | 功能 | Spec | 状态 |
|---|------|------|------|
| 1 | Session 实时推送（SSE 替换轮询） | 0001-sse-realtime.md | ✅ done |
| 2 | Session / Task 数据模型重新设计 | 0002-data-model-redesign.md | ✅ done |
| 3 | Session 自动重命名 | — | ✅ done（含于 0002） |

### 第二批 — 重要增强

| # | 功能 | Spec | 状态 |
|---|------|------|------|
| 4 | 任务详情侧面板 + Task Review 前端 | 0004-task-detail-panel.md | ✅ done |
| 5 | 项目完全删除 | 0005-project-delete.md | ✅ done |
| 6 | — | — | 合并至 #4 |

### 第三批 — 可选功能

| # | 功能 | Spec | 状态 |
|---|------|------|------|
| 7 | 文件附件上传 | 0007-file-attachments.md | ✅ done |
| 8 | Session Follow-up 队列消费 | — | ✅ done（含于 0002） |
| 9 | 会话搜索 | 0009-session-search.md | ✅ done |

---

每个功能开始前需先讨论方案，写 spec，确认后再实现。

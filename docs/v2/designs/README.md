# v2 Designs Index

## 目的

这个目录记录已经确认需求后的系统设计。

每份 design 文档应回答：

- 需求将以什么能力结构被满足
- 关键边界和对象是什么
- 有哪些方案取舍
- 哪些内容分期实现

## 结构规则

- 每份 design 都应明确引用对应的 requirement 编号
- 可以一个 requirement 对应一份 design，也可以一份 umbrella design 拆多个 phase
- design 可以讨论分期，但不直接下沉到 API、字段、命令级实现细节

## 当前状态

- 当前总 design：
  - [0001-human-workload-control.md](./0001-human-workload-control.md)
  - [0004-automation-ia-and-naming.md](./0004-automation-ia-and-naming.md)
  - [0004-automation-result-attention.md](./0004-automation-result-attention.md)
    - 当前用于承接 Todo / Automation workspace IA，而不是更深的 result-attention 状态机
  - [0003-agent-driven-session-classification.md](./0003-agent-driven-session-classification.md)
  - [0005-quest-lifecycle-linked-dependent-cleanup.md](./0005-quest-lifecycle-linked-dependent-cleanup.md)

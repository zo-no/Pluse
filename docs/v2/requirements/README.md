# v2 Requirements Index

## 目的

这个目录只记录 `Requirement`，不记录设计方案和实现细节。

每一份 requirement 文档都应该回答：

- 真实问题是什么
- 当前为什么值得做
- 解决后的成功状态是什么
- 暂时不解决什么

## 结构规则

- 一个 requirement 文件只讨论一个核心问题
- 文件名统一使用 `NNNN-kebab-case.md`
- 每份文档都至少包含：`状态`、`类型`、`优先级`
- priority 只表达产品推进顺序，不直接等同于实现难度
- 新 requirement 加入前，先判断它是否真的是独立问题，还是现有 requirement 的子点
- 宏大问题优先保持为一个清晰的 umbrella requirement，再通过 design/spec 分期实现

## 当前需求栈

### P0

- [0001-human-workload-control.md](./0001-human-workload-control.md)
  - 核心问题：用户工作负载失控，长期重要任务被即时噪音挤压
  - 说明：这是当前主矛盾，也是后续 Todo / Agent / notification 体系的上位需求

### P1

- 暂无

### P2

- [0002-inbox-capture.md](./0002-inbox-capture.md)
  - 核心问题：缺少足够轻的临时捕获入口
  - 说明：这是重要补充能力，但优先级低于工作负载控制

## 当前顺序

建议默认按以下顺序推进：

1. 先确认 `0001-human-workload-control`
2. 基于 `0001` 写对应 `design`
3. 再将 `0001` 拆成多期 `spec`
4. 再看 `0002-inbox-capture` 是否需要独立 design，还是作为后续能力挂接到已有设计中

## 维护规则

- 当 requirement 进入 design 阶段时，不从这里移除，只更新状态
- 如果 requirement 被合并、废弃或降级，应在这里明确记录
- 不允许绕过这个索引页，随意在 `requirements/` 下堆文件而不更新目录说明

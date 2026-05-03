# 0013 — CLI Catalog Command

**状态**: accepted
**类型**: requirement
**优先级**: medium

## 背景

Pluse 会把 Project / Quest / Todo / Run 等系统上下文注入给 Agent，也会提示 Agent 通过 `pluse commands` 查看 Pluse 自身能力。

但用户本机或个人工具链里还可能有一组外部 CLI 指令。Pluse 不需要逐条管理这些 CLI，只需要知道“运行哪条命令可以查询这组指令”。

## 真实问题

用户需要一个全局位置，设置一条 **CLI 集合查询命令**。

Agent 拿到这条命令后，可以在需要时运行它，查看当前环境里有哪些外部 CLI / 指令可用，以及这些指令如何使用。

如果在 Pluse 里逐条登记 CLI，会带来不必要的维护成本，也会和外部工具自身的 command catalog 重复。

## 顶层目标

Pluse 需要支持全局的 CLI catalog command：

- 用户在全局设置里填写一条命令行。
- 这条命令用于查询当前环境所有外部 CLI / 指令。
- Pluse 只把这条命令注入 Quest system prompt。
- Pluse 不扫描 PATH，不维护逐条 CLI 列表，不执行或校验这条命令。

## 成功状态

- 用户能在全局设置页设置或清空 CLI 集合查询命令。
- 新建或运行 Quest 时，Agent 能在 system prompt 中看到这条查询命令。
- 未设置时不注入相关 prompt block。
- Pluse 的 runtime tools、自身 command catalog 和外部 CLI 集合查询命令三类概念保持清晰。

## 不在范围内

- Project 级 CLI catalog command
- 外部 CLI 逐条登记
- 自动检测、自动安装或版本检测
- 命令执行面板
- 权限模型和参数白名单
- 与 custom runtime tools 合并

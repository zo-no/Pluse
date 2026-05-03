# 0013 — CLI Catalog Command Design

**状态**: accepted
**类型**: design
**关联 requirement**: `docs/v2/requirements/0013-cli-catalog-command.md`

## 设计目标

提供一个全局、轻量的外部 CLI 集合入口。

它回答的是：“Agent 要查看当前环境所有外部 CLI / 指令时，应该运行哪条命令？”

## 能力边界

CLI catalog command 不属于现有 runtime tool。

- Runtime tool：决定 Quest 由哪个 AI 执行器运行，例如 Codex、Claude 或自定义 AI runtime。
- Pluse command catalog：描述 Pluse 自身 API / CLI 能力，例如 `pluse commands`。
- CLI catalog command：描述用户工具链提供的外部指令集合查询入口。

Pluse 不解释这条命令输出，也不提供执行 API。Agent 是否实际运行命令，仍由当前运行时和用户环境决定。

## 数据形态

全局设置中保存一个字符串：

- `cliCatalogCommand`

本期使用 settings key/value 存储：

- key：`cli_catalog_command`
- value：trim 后的命令行字符串

空字符串表示未配置。

## UI 形态

全局设置页新增「CLI 集合」区块：

- 一个输入框用于填写查询命令。
- 保存使用现有全局保存按钮。
- 不提供逐条 CLI 的新增、编辑、删除、启停。

## Prompt 注入

Quest system prompt 中新增一个独立 block：

```text
外部 CLI 集合：
用户声明可通过以下命令查看当前环境可用的外部 CLI / 指令集合；Pluse 未执行校验，也不会代为执行。
运行 `my-cli commands` 查看所有可用外部 CLI 指令。
```

这个 block 位于全局 prompt / 项目 prompt 之后、Quest 运行上下文之前。

未配置命令时不注入这个 block。

## 不做

- 不做 PATH 扫描
- 不做命令存在性检测
- 不做执行权限或白名单
- 不做 per-project 覆盖
- 不维护逐条 CLI 列表
- 不和 custom runtime tools 合并

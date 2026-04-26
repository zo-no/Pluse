# Automation Notes

这个目录记录项目自动化接入过程中的可复用方法、prompt 草稿和试点边界。

它不是正式 spec 目录。进入工程实现前，仍然需要把稳定内容沉淀到 `requirements/`、`designs/` 或 `specs/`。

## 当前文件

- [project-automation-playbook.md](./project-automation-playbook.md)：项目自动化接入 playbook，用于判断一个项目应该如何从 L0/L1 逐步接入。
- [finance-weekly-guard-prompt.md](./finance-weekly-guard-prompt.md)：财务管理周度守门自动化的初版 prompt。

## 提醒时间策略

- Reminder 默认可以没有时间，它首先是提醒池里的注意事项。
- `remindAt` 只用于明确的定时触达，或需要进入「接下来」时间窗口的事项。
- Todo 的 `dueAt` 只用于明确截止时间、执行窗口或复核时间，不为了时间线而编造。

# 0012 — Check-ins

**状态**: accepted
**类型**: requirement
**优先级**: medium

## 背景

Pluse 当前已经有 Reminder，用来把需要人类注意的信息上浮出来。

但 Quest / Agent 有时不只是想“通知用户一件事”，而是需要确认一次人类行为是否发生，例如：

- 今天是否完成了晨间启动
- 某个项目是否已做最小复盘
- 财务快照是否已经补齐
- 运动、睡眠、学习等行为是否有一次实际回执

这类需求不能放进 Todo。Todo 表达人工承诺和执行事项；打卡表达一次轻量行为回执。

## 真实问题

如果打卡仍然只是普通 Reminder，会出现几个问题：

1. **提醒可以被看到，但行为没有事实记录**
   - 用户点掉提醒后，系统无法知道这次行为是否真的发生。

2. **Quest / Agent 无法读取稳定回执**
   - 后续自动化只能在聊天文本里猜测，不能可靠判断用户有没有回应。

3. **Reminder、Todo、Check-in 的边界会重新混乱**
   - 打卡不是 Todo，也不是提醒的一个 tag；它是独立的当前回执对象，完成后留下长期事实记录。

## 顶层目标

Pluse 需要支持独立的 **Check-in / 打卡** 能力。

打卡的目标是：

- 由 Quest / Agent / API / CLI 创建
- 作为当前待回执对象出现在工作台的打卡 tab
- 用户完成时写入一条 Check-in Record
- 当前打卡项完成后直接删除，不归档、不软删除
- Check-in Record 作为长期事实供 Quest / Agent / Automation 查询

## 核心需求

### 1. Check-in 是独立对象，不是 Reminder 类型

系统需要区分：

- 普通提醒：看到或处理后直接删除
- 当前打卡项：完成时写入一次 Check-in Record，然后删除当前打卡项
- 长期打卡记录：保留给 Quest / Agent / Automation 溯源和规划

Check-in 不复用 Reminder 的 `type`，也不引入 tag。Reminder 继续只负责当前注意力触达；Check-in 负责需要人类行为证据的回执。

### 2. 打卡完成必须留下记录

Check-in Record 至少需要保存：

- 项目
- 原打卡项 ID
- 原打卡项标题和说明快照
- 来源 Quest / Run
- 原触达时间快照
- 打卡发生时间
- 记录人
- 可选备注

因为当前打卡项完成后会被删除，record 不能依赖原打卡项行继续存在。

### 3. 打卡没有自己的周期系统

打卡不负责周期、missed 状态或下一次触达。

如果后续还需要打卡，由 Quest / Agent / Automation 再创建新的 Check-in。

### 4. UI 必须轻

第一期 UI 只做：

- 工作台有独立的 `打卡` tab
- 点击正文能查看完整详情
- ✅ 一键完成打卡
- 详情里允许填写可选备注后完成

不做统计面板，不做补记入口。

### 5. Agent 使用约束

Agent 只有在需要“人类行为证据”时才创建 Check-in。

如果只是通知用户，使用普通 Reminder。
如果是明确人工执行事项，使用 Todo。

## 成功状态

- 用户能在独立打卡 tab 里处理当前打卡项，但不会感觉它变成了 Todo 或 Reminder。
- 打卡完成后当前项消失，Check-in Record 仍可查询。
- 自动化可以读取记录判断用户是否回应。
- 普通 Reminder、Todo、Automation 的边界不被重新混合。

## 不在范围内

- 周期性打卡规则
- missed / stopped / next active 状态机
- 打卡统计、连续天数、趋势图
- 打卡 tag 或分类
- Todo / Automation 数据结构融合

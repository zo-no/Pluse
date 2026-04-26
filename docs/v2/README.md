# Pluse v2 文档约定

v2 不再默认从“想做什么功能”出发，而是先从“真实需求是什么”出发。

默认研发流程：

1. `Requirement`
   - 先写清楚问题、痛点、边界和成功标准
   - 不提前设计实现方案

2. `Design`
   - 在需求确认后，讨论系统结构、能力边界和方案取舍

3. `Spec`
   - 最后才写工程实现 spec，用于指导编码

## 产品边界

Pluse 的职责是提供 Agent 与 Human 协作所需的产品能力、状态语义和承接闭环，而不是内置某一种固定的方法论。

- Pluse 负责开放能力边界与协作基础设施
- Pluse 负责承接 Quest / Run / Todo / Human / Agent 之间的系统行为
- 具体的协作方法论，例如什么时候该建 Todo、什么时候该 review、什么时候该 ask human，默认属于 Agent 层
- 这类方法论优先放在 `skill`、`prompt` 或 agent policy 中，而不是轻易固化进产品内核

设计判断优先遵循：

- 先判断某个东西是不是产品能力
- 如果只是协作方法论，优先放到 Agent 层
- 只有当它需要稳定的系统承接、跨 Agent 通用语义或产品级状态闭环时，才进入 Pluse 本体

## 目录结构

```text
docs/v2/
├── README.md
├── ROADMAP.md
├── roadmap/
│   └── 0001-human-workload-control.md
├── requirements/
│   └── README.md
├── designs/
│   └── README.md
└── specs/
    └── README.md
```

## 使用规则

- `ROADMAP.md` 和 `roadmap/` 只记录当前状态、当前焦点和已完成产物
- `requirements/` 只写需求，不写实现细节
- `designs/` 解决“做成什么形态”
- `specs/` 解决“具体怎么实现”
- 对于非琐碎功能和系统改造，没有确认过的 spec，不开始编码

## 文档组织规则

- 每一层目录都应有自己的 `README.md` 作为索引和结构说明
- 一个文件只承载一个明确主题，不把多个大需求混写进同一篇文档
- 文件命名统一采用 `NNNN-kebab-case.md`
- `roadmap/` 只做推进索引，不重复 requirement/design/spec 正文
- `requirements/` 负责列出当前需求池、优先级和依赖关系
- `designs/` 与 `specs/` 需引用对应的 requirement 编号，避免脱节
- 如果一个想法还只是临时记录，不足以形成独立 requirement，应先记入 Todo 或讨论，不直接污染正式文档树

## 当前入口

- v2 结构说明：`README.md`
- 路线图总览：`ROADMAP.md`
- 主线进度：`roadmap/0001-human-workload-control.md`
- 需求索引：`requirements/README.md`
- 设计索引：`designs/README.md`
- 实现索引：`specs/README.md`

## 产品默认入口

Pluse 的默认项目入口是未分组下的“自我对话”。它不是普通收件箱，而是用户与 AI 一起挖掘真实需求、许下愿望、抒发欲望并澄清下一步行动的起点。首次使用时系统会自动创建该项目；已有同名项目时，以已有项目作为入口，并移回未分组。

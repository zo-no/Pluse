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

## 目录结构

```text
docs/v2/
├── README.md
├── requirements/
│   └── README.md
├── designs/
└── specs/
```

## 使用规则

- `requirements/` 只写需求，不写实现细节
- `designs/` 解决“做成什么形态”
- `specs/` 解决“具体怎么实现”
- 对于非琐碎功能和系统改造，没有确认过的 spec，不开始编码

## 文档组织规则

- 每一层目录都应有自己的 `README.md` 作为索引和结构说明
- 一个文件只承载一个明确主题，不把多个大需求混写进同一篇文档
- 文件命名统一采用 `NNNN-kebab-case.md`
- `requirements/` 负责列出当前需求池、优先级和依赖关系
- `designs/` 与 `specs/` 需引用对应的 requirement 编号，避免脱节
- 如果一个想法还只是临时记录，不足以形成独立 requirement，应先记入 Todo 或讨论，不直接污染正式文档树

## 当前入口

- v2 结构说明：`README.md`
- 需求索引：`requirements/README.md`

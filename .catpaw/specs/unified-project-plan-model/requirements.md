# Requirements Document

## Introduction

本功能将 `Progress` 重新定义为一个**会话级别**的 `Plan_Model` 视图。用户在进入某个 Quest 时，需要立刻看到这个会话“之前做了什么、现在做到哪一步、接下来还有什么”，并且这些步骤在会话生命周期内持续保留。底层先继续复用现有 `Todo` 数据结构，但产品表达上，`Progress` 是顺序化的会话计划流，而不是普通待办列表。

## Glossary

- **Project**: 项目容器，对应一个本地工作目录。
- **Quest**: Project 下的统一工作容器，`kind='session'` 或 `kind='task'`。
- **Plan_Model**: 绑定到单个 Quest 的顺序化工作模型，用于表达当前会话的计划、执行与历史。
- **Plan_Item**: `Plan_Model` 中的单个工作项；可以来自 Human_User，也可以来自 Agent_Run。
- **Progress_Panel**: Quest 内展示 `Plan_Model` 的界面区域。
- **Human_User**: 通过 UI 或 CLI 创建、更新工作项的人类用户。
- **Agent_Run**: 绑定到 Quest 的一次 AI 执行过程。
- **Waiting_Item**: 因等待外部输入、确认或依赖而暂时不能继续推进的 `Plan_Item`。

## Requirements

### Requirement 1

**User Story:** As a user, I want one session-level progress view, so that I can immediately understand what the current Quest has done and what remains.

#### Acceptance Criteria

1. WHEN a user opens a Quest, THE Progress_Panel SHALL display the Plan_Items associated with that Quest in one session-level view.
2. WHEN a Plan_Item is associated with a different Quest, THE Progress_Panel SHALL exclude that Plan_Item from the current Quest view.
3. THE Progress_Panel SHALL preserve a Quest's Plan_Items across page reloads and later visits.
4. WHEN a Plan_Item is associated with a Quest, THE Progress_Panel SHALL provide the Quest context for that Plan_Item without requiring a second storage model.

### Requirement 2

**User Story:** As a user, I want Progress to look like a plan sequence instead of a status board, so that I can follow execution in the order it was planned.

#### Acceptance Criteria

1. WHEN multiple Plan_Items exist for the same Quest, THE Progress_Panel SHALL present the Plan_Items in a deterministic sequence.
2. WHEN two Plan_Items have different explicit sequence values, THE Progress_Panel SHALL present the lower sequence value first.
3. WHEN two Plan_Items have the same explicit sequence value, THE Progress_Panel SHALL present the earlier created Plan_Item first.
4. THE Progress_Panel SHALL preserve completed Plan_Items in the same ordered sequence.

### Requirement 3

**User Story:** As a user, I want clear progress states, so that I can distinguish pending work, active work, blocked work, and completed work.

#### Acceptance Criteria

1. WHEN a Plan_Item is created and no work has started, THE Progress_Panel SHALL display the Plan_Item as pending.
2. WHEN work on a Plan_Item has started and is not completed, THE Progress_Panel SHALL display the Plan_Item as doing.
3. WHEN a Plan_Item cannot continue until new external input arrives, THE Progress_Panel SHALL display the Plan_Item as waiting.
4. WHEN work on a Plan_Item is completed, THE Progress_Panel SHALL display the Plan_Item as done.

### Requirement 4

**User Story:** As an agent-driven system user, I want the agent to maintain the current session plan, so that the Progress view reflects the real execution path.

#### Acceptance Criteria

1. WHEN an Agent_Run starts executing a Quest, THE Agent_Run SHALL read the current Quest Plan before creating new Plan_Items.
2. WHEN an Agent_Run extends an existing Quest plan, THE Agent_Run SHALL append or update Plan_Items without breaking the existing sequence.
3. WHEN an Agent_Run completes a step, THE Agent_Run SHALL update the corresponding Plan_Item instead of creating a duplicate completed item.
4. WHEN an Agent_Run pauses for human input, THE Agent_Run SHALL preserve the blocked Plan_Item in the Quest Progress view.

### Requirement 5

**User Story:** As a collaborator, I want human todos and agent plan items to share one structure for now, so that the system can evolve incrementally without introducing a second model too early.

#### Acceptance Criteria

1. WHEN a Human_User creates a Todo associated with the current Quest, THE Progress_Panel SHALL be able to render that Todo using the same Plan_Item data structure.
2. WHEN an Agent_Run creates a work item associated with the current Quest, THE Progress_Panel SHALL render that work item using the same Plan_Item data structure.
3. WHEN a Human_User archives or deletes a Plan_Item, THE Progress_Panel SHALL remove that Plan_Item from the active Quest view.
4. WHERE a future UI branch is introduced for human items, THE Plan_Model SHALL continue using the same underlying data structure.

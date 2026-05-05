# Implementation Plan: Pluse Plan

## Overview

Convert the `Pluse Plan` design into incremental code-generation steps that first add a quest-aware `Progress` tab in the right rail, then unify Quest progress projection and rendering, and finally tighten the server-side agent contract so the UI and runtime share one Quest-level Plan Mode.

## Tasks

- [x] 1. Add a quest-aware `Progress` entry to the right rail
- [x] 1.1 Update [packages/web/src/views/components/TodoPanel.tsx](packages/web/src/views/components/TodoPanel.tsx) to add `Progress` as a top-level rail tab before `待办 / 提醒 / 打卡`
  - Gate the tab on `activeQuestId` so it is only enabled when a Quest is active
  - Show Quest-specific empty/disabled copy instead of reusing the generic todo empty state
  - Keep existing todo/reminder/check-in tabs unchanged outside the new Progress branch
  - _Requirements: 1.1, 1.2, 1.3_
- [~]* 1.2 Write unit tests with TestAgent tool for right-rail tab activation and Quest-empty states
  - Cover `activeQuestId` present vs absent and tab switching behavior
  - _Requirements: 1.1, 1.2, 1.3_

- [x] 2. Create a shared Quest Plan projection for ordered plan rows
- [x] 2.1 Add a shared Plan-row mapper/hook in the web layer that converts `Todo[]` from `GET /api/quests/:id/progress` into one ordered Quest Plan stream
  - Encode stable ordering by `order`, `createdAt`, then `id`
  - Project `doing` items to `activeForm ?? title`
  - Project unfinished items with `waitingInstructions` to a visible waiting presentation without moving them into a separate list
  - _Requirements: 2.1, 2.2, 2.3, 3.2, 3.3, 5.1, 5.2_
- [~]* 2.2 Write property test for Quest Plan scoping and ordering
  - **Property 1: Quest plan contains all non-deleted quest items**
  - **Property 2: Plan order follows explicit sequence**
  - **Validates: Requirements 1.1, 1.2, 1.3, 2.1, 2.2, 2.3**
- [~]* 2.3 Write unit tests with TestAgent tool for the Plan-row mapper
  - Cover deterministic ordering, `activeForm` fallback, and waiting projection
  - _Requirements: 3.2, 3.3, 5.1, 5.2_

- [x] 3. Refactor Quest Progress surfaces into one ordered Plan Mode rendering
- [x] 3.1 Update [packages/web/src/views/components/ProgressPanel.tsx](packages/web/src/views/components/ProgressPanel.tsx) to render a single ordered sequence instead of separate AI / Human / Waiting sections
  - Keep done items in the same stream with weaker visual emphasis
  - Preserve waiting items in place with helper text
  - Reuse the shared Plan-row projection from Task 2
  - _Requirements: 2.4, 3.1, 3.2, 3.3, 3.4, 5.1, 5.2_
- [x] 3.2 Update the inline Quest summary in [packages/web/src/views/components/ProgressPanel.tsx](packages/web/src/views/components/ProgressPanel.tsx) and [packages/web/src/views/components/ChatView.tsx](packages/web/src/views/components/ChatView.tsx) to use the same ordered Plan rows and status summary
  - Ensure the inline card remains a secondary surface while matching the right rail data exactly
  - _Requirements: 1.3, 2.4, 3.1, 3.2, 3.3, 3.4_
- [~]* 3.3 Write property test for visible state mapping in the main sequence
  - **Property 3: Doing and waiting states render the correct presentation**
  - **Property 4: Done items remain in sequence until archive or delete**
  - **Validates: Requirements 2.4, 3.2, 3.3, 3.4, 4.4, 5.3**
- [~]* 3.4 Write unit tests with TestAgent tool for [packages/web/src/views/components/ProgressPanel.tsx](packages/web/src/views/components/ProgressPanel.tsx)
  - Cover ordered rendering, waiting helper text, and done-history retention
  - _Requirements: 2.4, 3.2, 3.3, 3.4, 5.3_

- [x] 4. Tighten the server-side agent contract around `Pluse Plan`
- [x] 4.1 Update [packages/server/src/services/system-prompt.ts](packages/server/src/services/system-prompt.ts) so the runtime instructions explicitly describe `Pluse Plan` as the Quest-level Plan Mode
  - Require agents to read the current Quest plan before creating new items
  - Preserve the “plan first, then execute” and `progress-wait` flows
  - Keep waiting items in the same main sequence semantics
  - _Requirements: 4.1, 4.2, 4.3, 4.4_
- [x] 4.2 Align [packages/server/src/controllers/cli/todo.ts](packages/server/src/controllers/cli/todo.ts) and related progress helpers with the shared Quest Plan contract
  - Preserve current `progress-create / progress-update / progress-wait` semantics
  - Ensure human and agent Quest-bound items continue to share one underlying data structure
  - _Requirements: 4.2, 4.3, 5.1, 5.2, 5.4_
- [~]* 4.3 Write unit tests with TestAgent tool for the progress CLI and prompt contract files
  - Verify read-before-write guidance, waiting flows, and quest-bound item semantics
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.4_

- [x] 5. Wire the full Quest Plan experience together
- [x] 5.1 Update [packages/web/src/views/pages/MainPage.tsx](packages/web/src/views/pages/MainPage.tsx) and any rail plumbing needed so the right rail, Quest detail, and inline summary all read the same active Quest lifecycle
  - Ensure the `Progress` tab always follows the current `activeQuestId`
  - Avoid duplicated fetch and render logic across rail and inline surfaces
  - _Requirements: 1.1, 1.3, 4.2, 4.4, 5.2_
- [~]* 5.2 Write integration tests for Quest Plan persistence and refresh behavior
  - **Property 5: Agent updates preserve plan continuity**
  - **Property 6: Human and agent items share one rendering model**
  - Validate Quest refresh, history retention, and mixed human/agent rendering
  - _Requirements: 1.3, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3, 5.4_

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Implementation language: TypeScript (`packages/web`, `packages/server`) with Bun/React runtime boundaries
- Each property-based test should run at least 100 iterations and reference the matching design property
- Unit test tasks should be implemented via the TestAgent workflow, with one generation task per target file or class
- The old project-level `0014-project-progress-panel*` documents are no longer implementation sources and should not guide code changes for this feature

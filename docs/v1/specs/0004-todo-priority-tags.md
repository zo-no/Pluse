# 0004 — Todo 优先级与标签

**状态**: done  
**优先级**: medium  
**估算**: M

## 背景

当前 Todo 只有 status / dueAt / repeat 等基础字段，缺少两个高频需求：

1. **优先级**：AI 创建 Todo 时无法表达紧迫程度，人类也无法快速区分哪些事最重要
2. **标签**：无法对 Todo 分类（如 "bug"、"frontend"、"blocking"），多项目协作时尤为缺失

## 目标

- Todo 支持设置优先级（priority），影响列表排序和视觉呈现
- Todo 支持打多个自由文本标签（tags），支持按标签过滤
- CLI / API / 前端 UI 全链路支持读写

## 不在范围内

- 项目级预定义标签管理（标签完全自由文本，不需要预先配置）
- 标签的颜色自定义
- 优先级的拖拽排序（不引入 order 字段）
- Todo 之间的依赖关系

---

## 方案设计

### 数据模型

#### 新增字段

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `priority` | TEXT | `'normal'` | 枚举：`urgent / high / normal / low` |
| `tags` | TEXT | `'[]'` | JSON 数组，存储字符串列表 |

#### Priority 枚举语义

| 值 | 语义 | UI 表现 |
|----|------|---------|
| `urgent` | 阻塞性，需立即处理 | 红色指示点 |
| `high` | 重要，今日内处理 | 橙色指示点 |
| `normal` | 默认优先级 | 不显示指示点 |
| `low` | 有空再做 | 灰色指示点 |

#### Tags 存储

```sql
tags TEXT NOT NULL DEFAULT '[]'
-- 示例：'["bug","frontend","blocking"]'
```

存为 JSON 字符串，读取时 parse，写入时 stringify。  
不建独立关联表——Todo 数量级不大，JSON 列足够，避免 JOIN 复杂度。

写入时自动去重，大小写保留原始输入，过滤时不区分大小写（`LOWER()` 处理）。

#### 排序规则变更

加入 priority 后，新的排序优先级（priority 优先于 dueAt，urgent 无论截止时间都排最前）：

```sql
ORDER BY
  status = 'pending' DESC,
  CASE priority
    WHEN 'urgent' THEN 0
    WHEN 'high'   THEN 1
    WHEN 'normal' THEN 2
    WHEN 'low'    THEN 3
    ELSE 2
  END ASC,
  CASE WHEN status = 'pending' AND due_at IS NOT NULL THEN 0 ELSE 1 END ASC,
  due_at ASC,
  updated_at DESC
```

---

### 后端变更

#### 1. DB Migration（`packages/server/src/db/index.ts`）

在服务启动时执行，用 `try/catch` 包裹，列已存在时忽略错误（幂等）：

```typescript
try { db.run(`ALTER TABLE todos ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal'`) } catch {}
try { db.run(`ALTER TABLE todos ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'`) } catch {}
```

存量数据自动获得默认值：`priority = 'normal'`，`tags = '[]'`。

#### 2. 类型定义（`packages/types/src/todo.ts`）

```typescript
export type TodoPriority = 'urgent' | 'high' | 'normal' | 'low'

export interface Todo {
  // ...现有字段不变...
  priority: TodoPriority   // 新增
  tags: string[]           // 新增
}

export interface CreateTodoInput {
  // ...现有字段不变...
  priority?: TodoPriority  // 新增，默认 'normal'
  tags?: string[]          // 新增，默认 []
}

export interface UpdateTodoInput {
  // ...现有字段不变...
  priority?: TodoPriority  // 新增
  tags?: string[] | null   // 新增，null 表示清空为 []
}
```

#### 3. Model 层（`packages/server/src/models/todo.ts`）

- `TodoRow` 新增 `priority: string`、`tags: string` 字段
- `rowToTodo` 解析：`tags: JSON.parse(row.tags ?? '[]')`，`priority: row.priority as TodoPriority`
- `createTodo` 写入 `priority`（默认 `'normal'`）和 `JSON.stringify([...new Set(tags ?? [])])`
- `updateTodo` 支持更新 `priority` 和 `tags`（tags 为 null 时写入 `'[]'`，否则去重后 stringify）
- `listTodos` 更新排序 SQL（见上）
- `listTodos` 新增 `tags` 过滤参数（OR 语义：包含任一指定 tag 即返回）：

```sql
-- 过滤包含任一指定 tag 的 Todo（大小写不敏感）
WHERE EXISTS (
  SELECT 1 FROM json_each(todos.tags)
  WHERE LOWER(json_each.value) IN (LOWER(?), LOWER(?), ...)
)
```

#### 4. HTTP API（`packages/server/src/controllers/http/todos.ts`）

- `POST /todos`：接受 `priority`、`tags` 字段
- `PATCH /todos/:id`：接受 `priority`、`tags` 字段
- `GET /todos`：接受 `tags` 查询参数（逗号分隔，如 `?tags=bug,frontend`），OR 语义
- `GET /todos/tags`：**新接口**，接受 `projectId` 查询参数，返回该项目内所有已用标签列表（用于前端补全）

  ```
  GET /todos/tags?projectId=proj_xxx
  → { tags: ["bug", "frontend", "blocking"] }
  ```

  注意：此路由需注册在 `GET /todos/:id` **之前**，避免路由冲突（`:id` 会匹配 `tags`）。

#### 5. CLI（`packages/server/src/controllers/cli/todo.ts`）

新增参数：

```
todo create
  --priority urgent|high|normal|low   # 默认 normal
  --tags "bug,frontend"               # 逗号分隔，完整设置

todo update <id>
  --priority high                     # 更新优先级
  --tags "bug,frontend"               # 完整替换 tags 数组
  --add-tags "newTag"                 # 追加 tag（不影响已有）
  --remove-tags "oldTag"              # 移除指定 tag

todo list
  --tags "bug,frontend"               # 按 tag 过滤（OR 语义）
  --priority urgent|high|normal|low   # 按 priority 过滤
```

`--tags` / `--add-tags` / `--remove-tags` 可同时使用，执行顺序：先 `--tags` 替换，再 `--add-tags` 追加，再 `--remove-tags` 移除。

---

### 前端变更

#### 1. 状态变更（`TodoPanel.tsx`）

`todoDraft` 新增两个字段，打开 modal 时从 todo 对象初始化：

```typescript
const [todoDraft, setTodoDraft] = useState({
  title: '',
  waitingInstructions: '',
  description: '',
  dueAt: '',
  repeat: 'none' as Todo['repeat'],
  priority: 'normal' as Todo['priority'],  // 新增
  tags: [] as string[],                    // 新增
})
```

新增 tag 过滤状态：

```typescript
const [filterTags, setFilterTags] = useState<string[]>([])
```

新增项目已用标签缓存（用于补全）：

```typescript
const [projectTags, setProjectTags] = useState<string[]>([])
```

#### 2. Todo 列表项（`renderTodoItem`）

在 `pluse-task-list-copy` 内，title 行之后、meta 行之前，新增两处展示：

**Priority 指示点**：嵌入 title 行左侧（`normal` 不显示）

```tsx
<div className="pluse-sidebar-item-title">
  {todo.priority !== 'normal' && (
    <span className={`pluse-todo-priority-dot is-${todo.priority}`} />
  )}
  <strong>{todo.title}</strong>
</div>
```

**Tags 徽章**：scheduleSummary 同级，放在其下方

```tsx
{todo.tags.length > 0 && (
  <div className="pluse-todo-tags">
    {todo.tags.map(tag => (
      <span key={tag} className="pluse-todo-tag">{tag}</span>
    ))}
  </div>
)}
```

#### 3. Tag 过滤栏

位置：`pluse-task-list` 顶部，列表内容上方，**始终展示**（不随 tag 选中状态显隐）。

展示项目内所有已用 tags（从 `GET /todos/tags?projectId=xxx` 加载），每个 tag 是可点击的 chip，选中高亮，支持多选（OR 语义）。无 tag 时不渲染该区域。

```tsx
{projectTags.length > 0 && (
  <div className="pluse-todo-tag-filter">
    {projectTags.map(tag => (
      <button
        key={tag}
        type="button"
        className={`pluse-todo-tag-chip${filterTags.includes(tag) ? ' is-active' : ''}`}
        onClick={() => toggleFilterTag(tag)}
      >
        {tag}
      </button>
    ))}
  </div>
)}
```

`filterTags` 参与 `visibleTodos` 的 `useMemo` 计算，有选中时在客户端过滤（不重新请求 API）。

#### 4. Todo 编辑模态框

视图模式新增 priority 和 tags 展示。

编辑模式新增两个字段（插入在现有字段之间，位置：title 之后、waitingInstructions 之前）：

**Priority 选择器**：4 个选项的 segmented control

```tsx
<div className="pluse-form-field">
  <label>{t('优先级')}</label>
  <div className="pluse-priority-selector">
    {(['urgent', 'high', 'normal', 'low'] as const).map(p => (
      <button
        key={p}
        type="button"
        className={`pluse-priority-option${todoDraft.priority === p ? ' is-active' : ''}`}
        onClick={() => setTodoDraft(d => ({ ...d, priority: p }))}
      >
        {priorityLabel(p, t)}
      </button>
    ))}
  </div>
</div>
```

**Tags 输入**：chip 列表 + 文本输入，回车或逗号确认添加，已有 tags 显示为可删除的 chip，输入时展示 `projectTags` 中的补全建议

---

## 验收标准

- [ ] 存量 Todo 的 priority 默认为 `normal`，tags 默认为 `[]`，服务重启后 migration 幂等执行
- [ ] `todo create --priority urgent --tags "bug,blocking"` 能正确创建
- [ ] `todo update <id> --priority high` 能更新优先级
- [ ] `todo update <id> --add-tags "newTag"` 追加 tag 不影响已有 tags
- [ ] `todo update <id> --remove-tags "oldTag"` 移除指定 tag
- [ ] `todo list` 结果按 priority 排序（urgent 最前，同 priority 内按 dueAt）
- [ ] `todo list --tags bug` 过滤出包含 "bug" 标签的 Todo（大小写不敏感）
- [ ] `GET /todos?tags=bug` 过滤正常
- [ ] `GET /todos/tags?projectId=xxx` 返回项目内所有已用标签
- [ ] 前端 Todo 列表项展示 priority 指示点（normal 不显示）和 tags 徽章
- [ ] 前端 tag 过滤栏始终展示，点击 chip 可多选过滤，无 tag 时不渲染
- [ ] 前端编辑模态框可修改 priority（segmented control）和 tags（chip 输入）
- [ ] 输入 tag 时展示项目内已有 tags 补全建议
- [ ] AI 通过 CLI 创建 Todo 时可指定 priority 和 tags

## 备注

- `GET /todos/tags` 路由必须注册在 `GET /todos/:id` 之前，避免路由匹配冲突
- Tags 写入时自动去重，大小写保留原始输入
- Tags 过滤为 OR 语义（包含任一指定 tag 即返回）
- `--tags` / `--add-tags` / `--remove-tags` 执行顺序：替换 → 追加 → 移除
- 前端 tag 过滤在客户端进行（不重新请求 API），`filterTags` 参与 `visibleTodos` 的 useMemo
- `projectTags` 在 `loadData` 时一并加载，todo 更新后重新加载（可能有新 tag 产生）

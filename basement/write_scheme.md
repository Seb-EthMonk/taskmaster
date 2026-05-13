# Taskmaster — Write Scheme Reference

Quick-reference for writing schema-compliant data in alternate (no-API) mode.
All values here must be used exactly — no variations, no invented fields.

---

## Task Fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | string | yes | Auto-generated: `task-001`, `task-002` … padded to 3 digits |
| `title` | string | yes | Short human-readable name |
| `description` | string | no | Full description, may include markdown |
| `status` | string | yes | See Status Values below |
| `priority` | string | yes | See Priority Values below |
| `tier` | integer | yes | Must be integer `0`–`5` (or higher). Never a string. |
| `agent` | string\|null | no | Agent name or `null` |
| `created` | ISO 8601 | yes | Set once on creation, never modified |
| `started` | ISO 8601\|null | no | Set when status becomes `in_progress` |
| `completed` | ISO 8601\|null | no | Set when status becomes `done` |
| `locked_by` | string\|null | no | Agent name holding lock, or `null` |
| `locked_at` | ISO 8601\|null | no | When lock was acquired, or `null` |
| `reclaim_after` | ISO 8601\|null | no | Lock expiry — use `null` in alternate mode |
| `heartbeat_interval` | integer | no | Default: `30` |
| `gate` | string\|null | no | `"qa"`, `"security"`, `"review"`, or `null` |
| `depends_on` | string[] | no | Array of task IDs. Empty array `[]` if none. |
| `requires_human` | boolean | no | Default: `false` |
| `last_updated_by` | string\|null | no | Agent name or `"system"` |
| `last_updated_at` | ISO 8601 | no | Updated on every write |

**Null fields must be `null` — never `""`, `"none"`, or omitted.**

---

## Status Values

```
pending      — available, waiting to be claimed
in_progress  — actively being worked
done         — finished successfully
failed       — execution failed
blocked      — cannot proceed (dependency or gate)
```

---

## Priority Values

```
low  |  medium  |  high  |  critical
```

---

## Tier Numbers

| Number | Name |
|--------|------|
| `0` | Discovery |
| `1` | Strategy |
| `2` | Architecture |
| `3` | Execution |
| `4` | Delivery |
| `5` | Final |

Tiers 6+ are valid — rendered as "Tier N".

---

## Project Status Values

```
active            — normal working state
awaiting_approval — tier complete, waiting for sign-off
paused            — workflow halted
completed         — all tiers done
archived          — moved to archive/ directory
```

---

## tasks.json Structure

```json
{
  "tasks": [],
  "approvedTier": null,
  "paused": false,
  "metadata": {
    "totalTasks": 0,
    "completedTasks": 0,
    "inProgressTasks": 0,
    "pendingTasks": 0,
    "created": "<ISO 8601>",
    "updated": "<ISO 8601>"
  }
}
```

- `approvedTier` — integer or `null`. Set after explicit tier approval.
- `paused` — boolean. Set to `true` only when user halts the workflow.
- Recount and update all metadata fields after every write.

---

## project.md Frontmatter

```yaml
---
id: project-slug
name: Human Readable Name
status: active
currentTier: 0
lastAccessed: <ISO 8601>
created: YYYY-MM-DD
isArchived: false
---
```

Optional fields: `emoji`, `type`

---

## Agent File Frontmatter

```yaml
---
name: Agent Name
description: What this agent does
tools: [Read, Write, Edit, Bash, Grep, Glob]
expansion: expansion-name
model: optional-model-override
emoji: 🎨
---
```

---

## Log Line Format

```
[AGENT <ROLE>: <TAG>] <ISO 8601> | <context> | <description>
```

Valid tags: `STARTED`, `COMPLETED`, `BLOCKED`, `DISCOVERED`, `DECISION`, `PROGRESS`, `TIER_COMPLETE`, `ERROR`, `INFO`, `QUERY`, `COMMENT`

Example:
```
[AGENT CODER: STARTED] 2026-02-27T10:05:00Z | task-003 | Beginning auth implementation
[AGENT CODER: COMPLETED] 2026-02-27T11:00:00Z | task-003 | Auth complete, tests passing
```

---

## Task ID Generation

Find the highest numeric suffix in the existing `tasks[]` array, increment by 1, pad to 3 digits:

- Existing max: `task-007` → next: `task-008`
- No tasks yet → start at `task-001`

---

## Metadata Recount Formula

After any write to `tasks.json`:

```
totalTasks     = tasks[].length
completedTasks = tasks[].filter(t => t.status === "done").length
inProgressTasks = tasks[].filter(t => t.status === "in_progress").length
pendingTasks   = tasks[].filter(t => t.status === "pending").length
updated        = <current ISO 8601 timestamp>
```

---

## Timestamps

Always use ISO 8601 with UTC timezone: `2026-02-27T10:00:00Z`

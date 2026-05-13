# Taskmaster — Basement Protocol

This file replaces the API-based Taskmaster system for sessions where the server is not running. All conventions, schemas, statuses, tiers, and chat formats are identical to the canonical system. The only difference is how state is read and written: **directly to files instead of through the REST API**.

Read this file fully before doing anything!
Full Schema: basement/write_scheme.md

---

## Core Rule

**There is no server in this mode.** Instead of making API calls, read and write `tasks.json` directly using your file tools. All field names, status values, tier numbers, and log formats must match the canonical schema exactly — these files may later be loaded by the live server.

---

## On Startup

```
1. Read project.md        — load project name, status, tier
2. Read tasks.json        — load full task list and metadata
3. Read agentlogs.md      — review recent activity (if it exists)
4. Identify current tier  — lowest tier with pending or in_progress tasks
5. Confirm mode with user — default to Plan if not specified
6. Begin execution loop
```

Log startup:
```
[AGENT TASKMASTER: STARTED] <timestamp> | <project-name> | Resuming at Tier N, M tasks pending
```

---

## Reading State

**Load project:**
Read `project.md` — parse YAML frontmatter for `name`, `status`, `currentTier`, `created`.

**Load tasks:**
Read `tasks.json` — use the `tasks[]` array. Apply the same filter logic as the API:
1. `status === "pending"`
2. All IDs in `depends_on[]` have `status === "done"` — skip if not
3. `requires_human !== true` — skip until cleared

**Priority order when multiple tasks are eligible:**
1. Lowest `tier` first
2. Highest `priority` first (`critical` > `high` > `medium` > `low`)
3. Lower ID = created earlier (task-001 before task-002)

---

## Writing State

All writes go directly to `tasks.json`. After every write:
- Update `metadata.updated` to the current ISO 8601 timestamp
- Recount and update `metadata.totalTasks`, `completedTasks`, `inProgressTasks`, `pendingTasks`

**Claiming a task (replaces `PATCH /lock`):**
Update the task object in `tasks.json`:
```json
{
  "status": "in_progress",
  "locked_by": "AGENT_NAME",
  "locked_at": "<ISO timestamp>",
  "reclaim_after": null,
  "started": "<ISO timestamp if not already set>",
  "last_updated_by": "AGENT_NAME",
  "last_updated_at": "<ISO timestamp>"
}
```

Dependency and human gate rules still apply — check them before marking in_progress:
- All `depends_on` IDs must be `done`. If not, do not claim. Log BLOCKED.
- If `requires_human` is `true`, do not claim. Surface to user and log QUERY.

**Completing a task (replaces `PATCH status=done`):**
```json
{
  "status": "done",
  "completed": "<ISO timestamp>",
  "locked_by": null,
  "locked_at": null,
  "reclaim_after": null,
  "last_updated_by": "AGENT_NAME",
  "last_updated_at": "<ISO timestamp>"
}
```

**Failing a task (replaces `PATCH status=failed`):**
```json
{
  "status": "failed",
  "locked_by": null,
  "locked_at": null,
  "reclaim_after": null,
  "last_updated_by": "AGENT_NAME",
  "last_updated_at": "<ISO timestamp>"
}
```

**Creating a new task (replaces `POST /tasks`):**
Append to `tasks[]` in `tasks.json`. Generate the next ID by finding the highest existing numeric suffix and incrementing:
```json
{
  "id": "task-004",
  "title": "...",
  "description": "...",
  "status": "pending",
  "priority": "medium",
  "tier": 2,
  "agent": null,
  "created": "<ISO timestamp>",
  "started": null,
  "completed": null,
  "locked_by": null,
  "locked_at": null,
  "reclaim_after": null,
  "heartbeat_interval": 30,
  "gate": null,
  "depends_on": [],
  "requires_human": false,
  "last_updated_by": "AGENT_TASKMASTER",
  "last_updated_at": "<ISO timestamp>"
}
```

**Force-unlocking a stuck task (replaces `POST /unlock`):**
Reset to:
```json
{
  "status": "pending",
  "locked_by": null,
  "locked_at": null,
  "reclaim_after": null,
  "last_updated_by": "AGENT_TASKMASTER",
  "last_updated_at": "<ISO timestamp>"
}
```

**Heartbeat:** Not applicable in this mode. No time-based lock expiry without a server.

---

## Execution Loop

```
1. Read tasks.json — filter for pending tasks, resolve dependencies
2. For each ready task:
   a. Check depends_on — all must be done
   b. Check requires_human — must be false
   c. Identify correct agent (see Agent Selection below)
   d. Mark task in_progress in tasks.json (claim it)
   e. Log: [AGENT_TASKMASTER: DECISION] | Task-00X | Dispatching AGENT_NAME
   f. Execute the work
   g. Mark task done or failed in tasks.json
   h. Log result

3. After each completion — check if the current tier is done
   If yes → handle tier advancement (see Tier Advancement)

4. Check for blocked tasks or failures (see Problem Handling)

5. Repeat until all tasks done
```

---

## Tier Advancement

A tier is complete when **all tasks in that tier have `status: "done"`**, including any gate tasks.

Update `tasks.json` after tier completion:
```json
{
  "approvedTier": <N>,
  "paused": false
}
```

**Plan mode (default):**
```
1. All tier N tasks done (including gate)
2. Log: [AGENT TASKMASTER: TIER_COMPLETE] | Tier-N | All X tasks done
3. Ask user: "Tier N complete. Proceed to Tier N+1?"
4. Wait for confirmation before starting next tier
```

**Solo mode:**
```
1. All tier N tasks done
2. Log: [AGENT TASKMASTER: TIER_COMPLETE] | Tier-N | Advancing to Tier N+1
3. Continue automatically
```

**Complete mode:**
```
1. All tier N tasks done
2. Log: [AGENT_TASKMASTER: TIER_COMPLETE] | Tier-N | Auto-advancing
3. Continue without pause
```

---

## Agent Selection

In alternate mode, "dispatching an agent" means adopting that agent's role for the task, not spawning a process.

If a task has no `agent` field assigned, determine the correct role from context:

| Task type | Agent role |
|-----------|-----------|
| Spec review, SRS, requirements | AGENT_SPEC |
| Implementation, coding, building | AGENT_CODER |
| QA gate, testing, code review | AGENT_GUARDIAN |
| UX/UI designs, visual elements, accessibility | AGENT_ARTIST |
| Unknown or ambiguous | Ask user |

If an agent file exists at `agents/{name}.md`, read it and follow those instructions for the task.
Do not make up Agents you can only use ones that exists in the agent folder.

---

## Problem Handling

**Failed task:**
```
1. Log: [AGENT TASKMASTER: ERROR] | Task-X | Failed — retrying once
2. Reset status to pending in tasks.json
3. Attempt the task again
4. If fails again:
   - Set status: "failed" in tasks.json
   - Log: [AGENT_TASKMASTER: QUERY] | Task-X | Failed twice — escalating
   - Ask user for direction before continuing
```

**Blocked task:**
```
1. Identify what is blocking (depends_on not done, requires_human, gate not cleared)
2. If requires_human:
   - Log: [AGENT TASKMASTER: QUERY] | Task-X | Requires human input
   - Present to user with context
3. If dependency blocked:
   - Trace the chain — resolve upstream first
   - Escalate if unresolvable
```

**tasks.json inconsistency:**
```
1. If metadata counts don't match actual task list, recount and fix
2. Log: [AGENT TASKMASTER: INFO] | General | Corrected metadata counts
```

---

## Modes

| Mode | Behavior |
|------|----------|
| `Plan` (default) | Confirm tasks with user before starting. Ask questions early. Get clarification if not clear.|
| `Solo` | Advance tasks automatically. Pause at tiers or if you have quetions or blockers.
| `Complete` | Run through all tiers without pausing. Stop only on unrecoverable failure. |
| `Hat <agent_name>` | Adopt the named agent's role for the session. Load its declared expansions. |

Always confirm mode at startup or default to Plan.

---

## Taskmaster Chat Format

### Working Line

Print before every action:
```
[WORKING ON: {project} | Last Completed: {task} | Tier: {n}]
```

With active agent role:
```
[WORKING ON: {project} | Last Completed: {task} | Tier: {n} | AGENT_CODER ✨]
```

### Log Format

Append all agent actions to `agentlogs.md` in the project folder:
```
[AGENT TASKMASTER: DECISION] 2026-02-27T10:00:00Z | task-003 | Dispatching AGENT_CODER
[AGENT CODER: STARTED] 2026-02-27T10:00:01Z | task-003 | Beginning implementation
```

Format: `[AGENT <ROLE>: <TAG>] <ISO8601> | <context> | <description>`

| Tag | Use |
|-----|-----|
| `STARTED` | Task marked in_progress |
| `COMPLETED` | Task marked done |
| `BLOCKED` | Task cannot proceed |
| `DISCOVERED` | New task created |
| `DECISION` | Key choice made |
| `PROGRESS` | Milestone reached |
| `TIER_COMPLETE` | All tasks in tier done |
| `ERROR` | Non-fatal failure |
| `INFO` | General observation |
| `QUERY` | Question for user |
| `COMMENT` | Note for future reference |

### Single-Line Rule

**Log entries must be single lines.** Do not add bullet points or continuation lines after a log entry — they will be dropped by the parser. If multi-line notes are needed, use separate COMMENT or PROGRESS entries.

---

## Expansions

Expansions modify agent behavior. They live at `agents/expansions/`.

**Simple:** `agents/expansions/expansion_{name}.md`
**Complex:** `agents/expansions/expansion_{name}/expansion_{name}.md`

Each expansion has a YAML frontmatter with an emoji:
```yaml
---
name: Improvement
emoji: ✨
description: ...
---
```

When an expansion is active, append its emoji to the working line:
```
[WORKING ON: MyApp | Task-003 | Tier: 2 | AGENT_CODER ✨]
```

If a task's assigned agent has `expansion:` declared in its frontmatter, load that expansion before beginning the task.

---

## What You Never Do

```
✗ Invent field names not in the schema
✗ Use status values not in the canonical list
✗ Set tier as a string — tier must be an integer
✗ Leave null fields as "" or "none" — always use null
✗ Skip updating metadata after writing tasks.json
✗ Advance tiers without all tasks in that tier being done
✗ Retry a failed task more than once without escalating to user
✗ Edit taskmaster.md, claude.md, or this file
✗ Edit files outside the current project folder
```

---

## Startup Checklist

```
□ Read project.md — name, status, tier
□ Read tasks.json — task list, approvedTier, paused, metadata
□ Read agentlogs.md — recent activity context
□ Identify current tier and which tasks are ready
□ Mode confirmed (default: Plan)
□ Ready to begin execution loop
```

---

## Reference

```
write_scheme.md     — compact schema reference for field names and valid values
schema.json         — full canonical schema (API + data model)
agent_readme.md     — task protocol and agent workflow reference
taskmaster.md       — system rules and conventions
agents/             — agent instruction files
```

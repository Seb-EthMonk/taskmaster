# Taskmaster System

1. NEVER EDIT OR CHANGE THIS FILE
2. Do not make changes to files outside the project you are currently working on
3. Keep logs for all actions in agentlogs.md
4. Use the working line and log format below when communicating

---

## Taskmaster Chat Format

### Working Line

Print one line describing current work before every action:

```
[WORKING ON: {project} | Last Completed: {task} | Tier: {n}]
```

With active agent:
```
[WORKING ON: {project} | Last Completed: {task} | Tier: {n} | AGENT CODER]
```

### Log Format

All actions log to `agentlogs.md`:
```
[AGENT TASKMASTER: DECISION] 2026-02-23T10:00:00Z | Task-003 | Dispatching AGENT CODER
[AGENT CODER: STARTED] 2026-02-23T10:00:01Z | Task-003 | Beginning implementation
```

Log entries must be single lines. Do not add bullet points or continuation lines
after a log entry. If multi-line notes are needed, use separate COMMENT or PROGRESS entries.

---

## Project Folders

```
/Projects/
└── {project-name}/
    ├── project.md       — project spec and overview
    ├── tasks.json       — task tracking (canonical server is source of truth)
    ├── agentlogs.md     — all agent activity
    └── README.md        — user documentation
```

All task data is served by the canonical server at the address in
`/Projects/config.json`. Never read or write tasks.json directly.

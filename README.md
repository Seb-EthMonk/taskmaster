# TaskMaster

AI agent orchestration for software projects. Structured tasks, tiered execution, with a real-time dashboard.

---

![Taskmaster Screenshot](https://github.com/Seb-EthMonk/taskmaster/blob/main/screenshot.png)

## What It Does

TaskMaster lets an AI assistant run multi-step software projects with structure:

- **Tiered workflow** — 6 phases from Discovery to Final, with approval gates
- **Task dependencies** — tasks wait for their prerequisites to complete
- **Agent dispatch** — specialist agents (Coder, Artist, Guardian, etc.) handle different work types
- **Live dashboard** — Vue UI showing project state, agent activity, and logs in real time
- **Human gates** — the AI pauses at checkpoints and asks before proceeding

You manage your projects and work with Taskmaster to distribute work to your AI agents.

---

## The Core Idea

TaskMaster exists because AI agents hit limits. Context windows fill up. Long sessions degrade. Single agents try to do too much and lose track.

The solution is **projects as memory**. Each project is a folder on disk with its own spec, task list, and activity log. The AI reads the project state, does the next task, writes what happened, and stops. If the session ends, the next session picks up exactly where it left off. Nothing is lost.

This means you can:
- **Pause work** at any point and resume hours or days later
- **Switch models** — start with one model, continue with a cheaper one, come back
- **Use different harnesses** — use with any AI client that can call the REST API
- **Run multiple projects** in parallel without cross-contamination

The project folder is the source of truth. The AI is just the worker.

---

## Quick Start

From the TaskMaster root directory:

```bash
npm run start:tm
```

This starts all three services in one terminal with color-coded output:

| Label | Service | Color |
|-------|---------|-------|
| `server` | REST API + WebSocket | cyan |
| `mcp` | MCP server (Claude Code) | yellow |
| `client` | Vue dashboard | green |

Services:
- REST API — `http://localhost:3000`
- Dashboard — `http://localhost:8040`

Ctrl+C stops all three.

### Manual startup (alternative)

If you need to run services individually:

```bash
# Terminal 1 — REST API + WebSocket server
cd server && npm run dev

# Terminal 2 — MCP server (only needed for Claude Code)
cd server && npm run mcp:dev

# Terminal 3 — Vue dashboard
cd client && npm run dev
```

The AI connects to the REST API directly. The MCP server is only needed when using Claude Code.

---

## How It Works

```
AI Assistant (AGENT TASKMASTER)
        |
        | HTTP REST API
        v
   REST Server  <---->  WebSocket
        |                     |
        v                     v
   projects/             Vue Dashboard
   (tasks, logs)         (real-time view)
```

The AI reads project state through the REST API, claims tasks, dispatches specialist agents, and monitors progress. The dashboard shows everything live.

---

## Projects

Each project lives in `projects/{name}/`:

| File | Purpose |
|------|---------|
| `project.md` | Spec, overview, decisions |
| `tasks.json` | Canonical task state (server-managed) |
| `agentlogs.md` | Full agent activity log |

Tasks move through tiers (0–5). A gate task at the end of each tier blocks advancement until cleared.

Because every project is self-contained in a folder, you can:
- Create as many projects as you want
- Archive old projects without losing history
- Copy a project and fork it
- Open a project in any AI client that can call the REST API

---

## Tasks

```
pending → [lock] → in_progress → [done] → done
                           → [failed] → failed
```

- `tier` — which phase (0–5)
- `depends_on` — prerequisite task IDs
- `requires_human` — blocks until you clear it
- `gate` — tier checkpoint (`qa`, `security`, `review`)
- `locked_by` / `reclaim_after` — prevents collisions, auto-expires

Agents send heartbeats every 30s to keep locks alive.

---

## Agents

Markdown files in `agents/` define roles and protocols:

| Agent | Handles |
|-------|---------|
| **TASKMASTER** | Orchestration, dispatch, monitoring |
| **CODER** | Implementation |
| **ARTIST** | Design, UI, visual work |
| **GUARDIAN** | Security gates, compliance |
| **RESEARCHER** | Technical discovery |

### Sub-Agents

When a task needs specialised work, the orchestrator dispatches a sub-agent. The sub-agent gets the task description, works on it, and reports back. The orchestrator never does the work itself — it coordinates.

### Sub-Models via call_llm

For large or isolated subtasks (generating a full file, summarising research, reading multiple files), agents can delegate to cheaper/faster models through the `call_llm` tool. This lets you use Gemini Flash for quick ingestion, DeepSeek for coding, or Qwen for scaffolding — while the main model stays as the orchestrator. The tool reads files server-side, inlines them into the prompt, and returns the response.

---

## Activity & Ports

The dashboard has an **Activity** page showing three things:

1. **Active Agents** — which agents are currently running and on what tasks
2. **Project Agent Logs** — historical activity from all project `agentlogs.md` files
3. **System Events** — file changes, tier transitions, errors

A **Ports Manager** page shows which ports are in use by TaskMaster services and other local processes, so you can spot conflicts when spinning up multiple projects or services.

---

## Energy System

TaskMaster has an optional energy system. Dispatching tasks consumes energy. When energy runs out, work pauses until you "feed" the TaskMaster — a small friction mechanism to prevent runaway agent loops and keep you aware of how much computation is being used.

---

## Modes

| Mode | Behaviour |
|------|-----------|
| **Plan** (default) | Pause at tier gates, ask for approval |
| **Solo** | Run autonomously, stop only when blocked |
| **Complete** | Run until done, auto-advance through gates |

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Server | Node.js, Express, TypeScript |
| API | REST + WebSocket |
| Cache | In-memory with file watcher hydration |
| Dashboard | Vue 3, Vite, WebSocket |
| Process | npm scripts |

---

## API

REST API (`:3000`) exposes all operations:

- `GET /api/projects` — list all projects
- `GET /api/projects/:id` — get project with tasks
- `POST /api/projects` — create project
- `POST /api/projects/:id/tasks` — create task
- `PATCH /api/projects/:id/tasks/:taskId/lock` — claim task
- `PATCH /api/projects/:id/tasks/:taskId` — update task (mark done, etc.)
- `POST /api/projects/:id/tasks/:taskId/unlock` — force unlock
- `POST /api/projects/:id/approve-tier` — advance tier
- `GET /api/settings` — get settings (providers, model defaults)
- `POST /api/settings/test-model` — test an LLM provider

See `mcp_schema.json` and `schema.json` for full schema.

---

## Project Structure

```
projects/{name}/
  project.md
  tasks.json
  agentlogs.md

agents/
  coder.md, artist.md, spec.md, guardian.md, ...

server/src/
  index.ts          # Express server entry
  routes/           # REST API routes
  mcp-index.ts      # MCP server entry (optional, for Claude Code)
  mcp/tools/        # Tool registrations
  cache/            # In-memory state
  scanner/          # Disk hydration
  watcher/          # File watcher

client/             # Vue dashboard
config.json         # Server address + settings
```

---

## Basement Mode (No Server Required)

If you don't want to run the server — or can't — TaskMaster has a fallback called **Basement Mode**. It works without any API, server, or WebSocket. The AI reads and writes `tasks.json` directly using its file tools.

Everything else stays the same: the task schema, tier structure, dependency rules, agent roles, and log format are all identical to the live server version. Files written in Basement Mode can be loaded by the live server later with no conversion needed.

**When to use it:**
- You want to try TaskMaster without setting up Node.js
- The server isn't running and you need to keep working

**How to use it:**

Point your AI assistant to the Basement files:

```
basement/write_taskmaster.md   — orchestrator protocol for serverless mode
basement/write_scheme.md       — compact schema reference
```

The AI reads `write_taskmaster.md` as its operating instructions, then manages your project by editing `tasks.json` and `agentlogs.md` directly. No installation required.

---

## MCP Server (Optional)

**The MCP server is not required.** Any AI that can make HTTP requests works with TaskMaster through the REST API directly — no MCP setup needed.

MCP is only useful if you are using **Claude Code** and want the AI to call TaskMaster tools natively without writing raw HTTP calls.

If you do want MCP, the server is included in `npm run start:tm` automatically. To start it manually:

```bash
cd server && npm run mcp:dev
```

To connect Claude Code, create `.claude/settings.json` in the project root:

```json
{
  "mcpServers": {
    "taskmaster": {
      "command": "/absolute/path/to/this/repo/server/node_modules/.bin/tsx",
      "args": ["/absolute/path/to/this/repo/server/src/mcp-index.ts"],
      "type": "stdio"
    }
  }
}
```

Replace `/absolute/path/to/this/repo` with your actual path. This file is in `.gitignore` — each developer sets it up locally for their own machine.

The MCP server exposes the same operations as the REST API, just over stdio JSON-RPC.

---

## License

MIT © 2026 Seb-EthMonk

See [LICENSE](./LICENSE) for full terms. Attribution is required — if you fork, distribute, or build on this project, you must retain the copyright notice.

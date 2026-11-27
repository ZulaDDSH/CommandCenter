# Command Center: overview for AI agents

The Command Center is a local web panel that queues coding tasks and runs them on Freebuff, Codex, Cursor, OpenCode or Claude, whichever has room. It runs on this PC only.

- URL: `http://127.0.0.1:4021` (the port can differ if `PORT` was set; the panel that gave you this text is the one to use).
- This guide: `curl.exe -s http://127.0.0.1:4021/ai-guide`. Every file in `docs/ai-guide/` is joined in name order.
- `<root>` below means the Command Center folder (the one holding `viewer/`, `lib/` and `tools/`).

## Rules for every agent

1. **Report file.** Your task text names a report path. Before you finish, write a short report there: what you changed, what you checked, what is left. A task is only done when that file exists.
2. **Board.** Read the board before you start and post what others need. Read: `curl.exe -s http://127.0.0.1:4021/board`. Post: `curl.exe -s -X POST --data-binary "short note" "http://127.0.0.1:4021/board?from=<your name>"`. Keep notes short. Never post secrets, tokens or personal data.
3. **Sub-tasks.** If your job is big, split it. Add each part as its own task (see Tasks below, or `node "<root>/tools/cc.mjs" task add --title "T" --prompt-file task.md --parent <your task id>`). Do not run extra copies of yourself by hand.
4. **Never exceed the limits.** The limits are in Setup and shown by `GET /setup` (`config.maxClis`, `config.maxParallel`). Before starting a second Freebuff CLI ask `GET /spawn-check?kind=code|light|read`; start one only when it answers `"spawn": true`. Do not start Codex, Cursor or OpenCode work outside the panel; add a task instead.
5. **Stay in your folder.** Work only inside the folder your task gives you. Do not edit the Command Center itself unless your task says so.
6. **Do not touch other people's processes.** Never kill or restart the panel, the relay or a CLI you did not start.
7. **No personal data.** Do not write user names, emails, tokens or absolute paths of this PC into shipped files.

## Endpoints

Reads are plain GET. Writes are POST and the panel refuses a POST from another web origin (a plain `curl` is fine).

| Method and path | What it does |
|---|---|
| `GET /tasks` | All tasks, the dispatcher state and the Freebuff driver state. |
| `POST /tasks` | Add a task. JSON body: `{"text": "...", "kind": "code\|light\|read", "provider": "auto\|freebuff\|codex\|cursor\|opencode\|claude", "model": "...", "cwd": "<folder>", "title": "...", "parent": "<task id>"}`. Only `text` is required. `claude` runs only when named; a task with a `parent` is a sub-task (see the orchestrator section). |
| `POST /tasks/<id>/cancel`, `/retry`, `/done` | Change a task. |
| `GET /task-log?id=<id>` | A task's log and report text. |
| `GET /spawn-check?kind=code` | Whether a new Freebuff CLI may start now, and why. |
| `GET /board`, `POST /board?from=<name>` | The shared notes (add `?json=1` to read as JSON). |
| `GET /usage?p=freebuff\|codex\|cursor\|opencode\|route` | Cached usage for a tool and where the next task goes. Add `&fresh=1` to refresh. |
| `GET /sessions`, `GET /session?p=<tool>&id=<id>` | Session lists and one session's steps. |
| `GET /setup` | Settings and status of every tool, the relay and the hook (read only for you). |
| `GET /debug` | Every health check as rows `{group, name, ok, detail, fix}`. |
| `GET /director` | Goals, machines and pull requests. See `70-director.md` for the write routes. |
| `GET /ai-guide` | This guide as plain text. |

Other guide files cover tools, the archive and more. Endpoints that other parts add (models, archive, hooks and MCP, Claude) are described in their own files.

## Statuses

A task is `waiting`, `starting`, `running`, `done`, `failed` or `cancelled`. A waiting task shows a `reason` (for example a limit is full). It is tried again every 5 seconds.

## Quick start for a worker agent

1. `curl.exe -s http://127.0.0.1:4021/board` and read it.
2. Read your task file and do the work in your folder.
3. Post one short board note if you found something others need.
4. Write the report file named in your task. Stop.

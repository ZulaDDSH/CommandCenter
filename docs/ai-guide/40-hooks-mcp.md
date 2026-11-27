# Hooks and MCP page (AI guide)

The "Hooks & MCP" tab lists every hook, MCP server and plugin switch on this PC and lets the user turn each one on or off. Use it as an agent only through the HTTP endpoints below, on the live panel at `http://127.0.0.1:4021`. Never edit `~/.claude/settings.json`, `~/.claude.json`, `~/.codex/config.toml`, the OpenCode config or `~/.cursor/mcp.json` by hand for this; the panel keeps backups and checks for changes.

## What it reads

| Source | What is listed |
|---|---|
| `~/.claude/settings.json`, `settings.local.json`, and the same two files in the project's `.claude/` | Claude Code hooks and `enabledPlugins` |
| Installed Claude plugins (`~/.claude/plugins/installed_plugins.json`, `installPath`) | Plugin hooks and plugin MCP servers (read-only; turn the plugin off instead) |
| `~/.claude.json` (top level and per project `mcpServers`), project `.mcp.json` | Claude MCP servers |
| `~/.codex/config.toml` `[mcp_servers.*]` | Codex MCP servers (`enabled = false` switches one off) |
| `~/.config/opencode/opencode.json` (or `.jsonc`) `mcp.<name>.enabled` | OpenCode MCP servers |
| `~/.cursor/mcp.json`, project `.cursor/mcp.json` | Cursor MCP servers |

Only the program and script file names of a command are shown, and only the scheme and host of a URL, so env values, headers, tokens and URL paths never reach the page. Lists are read with `GET`.

## Endpoints

`GET /ext/list` returns `{ rows, files, stash, counts }`. Each row has `id`, `section` (`hooks`, `mcp`, `plugins`), `app`, `name`, `what`, `source`, `on`, `rev`, `ro` (true means read-only), `note`, `locked`, `stashed`.

```
curl.exe -s http://127.0.0.1:4021/ext/list
```

`POST /ext/toggle` with a JSON body `{ "id": "<row id>", "on": true|false, "rev": "<row rev>" }`. Always send the `rev` you just read.

- 200: done. Tell the user to restart the CLI so it applies.
- 409: the file changed since you read it (a running CLI saves `~/.claude.json` often). Read the list again and retry once.
- 422: the file has hand-formatted parts and changing it would reformat it. Ask the user; if they agree, resend with `"reformat": true`.
- 400 or 404: read-only row, locked file, or the row is gone.

Only toggle what the user asked for. Do not toggle anything while a task that needs that hook or server is running.

## How off and on work

- Hooks and Claude or Cursor MCP servers have no off switch of their own. Turning one off moves its entry to `disabled-extensions.json` in the Command Center folder and removes it from the config; turning it on puts it back in the same place.
- Codex and OpenCode servers use their own `enabled` flag.
- Plugins use `enabledPlugins` in the settings file.
- Every write first copies the file to `backups/` in the Command Center folder (newest 10 per file kept), writes a temporary file, renames it, and reads it back. If the read-back fails the old file is restored.

`disabled-extensions.json` and `backups/` can hold secrets from the configs, so they stay on this PC and are never copied or committed.

## Testing

Set `CC_EXT_HOME` to a scratch folder holding copies of the config files (`.claude/settings.json`, `.claude.json`, `.codex/config.toml`, `.config/opencode/opencode.json`, `.cursor/mcp.json`, plus `project/`). The panel then reads and writes only there, and keeps its stash and backups under `<scratch>/cc-root`.

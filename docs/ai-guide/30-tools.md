# Script tools: do many steps in one call

Every tool call you make costs a whole turn, and each turn resends your whole history. If a job needs five reads, two searches and an edit, write one small JavaScript script and run it once. The script does all the steps and returns only the short answer you need. This saves tokens and time.

## When to use a script

Use a script when:
- you would make three or more tool calls that do not depend on what you think in between (find files, read them, grep, count, summarize);
- you need the same change in many files;
- you need to look at several Command Center things at once (tasks, board, budget);
- the raw output is big and you only need a small part of it.

Do not use a script when one plain tool call does the job, or when you need to read the output and think before the next step.

## How to run one

`<root>` is the Command Center folder (the one with `tools/` in it).

- Any agent with a shell (Freebuff, Codex, Cursor, OpenCode, Claude): write the script to a file or pipe it in.
  `node "<root>/tools/cc.mjs" run my-script.js`
  `echo "return 1+1" | node "<root>/tools/cc.mjs" run -`
  Flags: `--timeout 60000` (ms, default 60000), `--cwd <folder>` (where relative paths start; default is your current folder), `--dry-run` (panel POSTs are shown, not sent). They may go before or after the file name. Every other word after the file name arrives in the `args` array unchanged, so `--title` there is an argument. A script cannot receive a literal `--timeout`, `--cwd` or `--dry-run` in `args`.
- Agents with MCP (Claude, Codex, OpenCode, Cursor, after Setup registers it): call the `run_script` tool with `code`. Also `cc_task_add`, `cc_board_post`, `cc_budget`.

The script is the body of an async function. Use `await` freely. `return` a value: text is printed as is, anything else as JSON. `console.log` lines are printed above the result. Errors print as `Error: message` and the CLI exits with code 1.

## Shortcuts (no script needed)

- `node "<root>/tools/cc.mjs" task add --title "T" --prompt-file task.md [--provider codex --model M --parent ID --cwd DIR --kind code|light|read]`
- `node "<root>/tools/cc.mjs" task list`
- `node "<root>/tools/cc.mjs" task log <id>`
- `node "<root>/tools/cc.mjs" board` (read) and `board post "text" [--from name]`
- `node "<root>/tools/cc.mjs" budget`
- `node "<root>/tools/cc.mjs" guide` (prints this guide and the others)

## The API inside a script

| Call | What it gives |
|---|---|
| `read(path, {from, to})` | File text. `from` and `to` are 1-based line numbers. |
| `write(path, text)` | Writes a file, makes folders. `{path, chars}` |
| `edit(path, old, new)` | Replaces one exact piece of text. Throws if it is missing or appears more than once (add more context). Works on CRLF files. |
| `glob(pattern, {cwd, max})` | Sorted file paths, `node_modules` and `.git` skipped. |
| `grep(regex, {path, glob, max})` | `[{file, line, text}]`, default 100 hits. Skips binary files and files over 2 MB. |
| `ls(dir)` | `[{name, type, size}]` |
| `git(...args)` | Output of a git command. Throws if git fails. Start with an object to set a folder: `git({cwd: 'sub'}, 'status')`. |
| `run(cmd, args, {cwd, timeout, input})` | `{code, stdout, stderr}`. No shell. `.cmd` programs (like `codex`) work; arguments with `"`, `%`, a newline, or a quoted argument ending in a backslash are refused for `.cmd` programs. |
| `fetchJson(url)` | GET from the panel only (`http://127.0.0.1:4021`, or `CC_PORT`), 15 s timeout. Paths like `/tasks` work. |
| `panel.tasks()` | All tasks without their long text. |
| `panel.taskLog(id, {tail})` | `{task, log, report}`, last `tail` characters (default 4000). |
| `panel.addTask({title, prompt, provider, model, cwd, parent, kind})` | Queues a task. It starts real work, so only add what you mean to. |
| `panel.board()` / `panel.board(text, from)` | Read the board / post a note. |
| `panel.budget()` | `{route, models}`: usage and which provider is next. |
| `args` | Extra command-line words. |

Paths are relative to `--cwd` (or the folder you run from). Scripts are not sandboxed: they can do what your shell can. Global `fetch` and `run('curl', ...)` work, so a script can reach any URL. The rule to never POST to port 4021 is a convention you must follow. `--dry-run` only blocks panel POSTs; `write`, `edit`, `run` and `git` still run. Do not write scripts that delete things you did not make. The `backups/` folder (copies of private config such as `~/.claude.json`, made by `tools/register.mjs`) must not be shared.

## Five worked examples

### 1. Find, read and summarize

```js
const hits = grep('TODO|FIXME', { glob: 'src/**/*.js', max: 40 });
const byFile = {};
for (const h of hits) (byFile[h.file] ??= []).push(`${h.line}: ${h.text}`);
return byFile;
```

### 2. Edit many files

```js
const files = glob('src/**/*.js');
const changed = [];
for (const f of files) {
  if (!read(f).includes('oldName(')) continue;
  const text = read(f).split('oldName(').join('newName(');
  write(f, text);
  changed.push(f);
}
return { changed, diff: git('diff', '--stat') };
```
For one exact change use `edit('src/a.js', 'const x = 1;', 'const x = 2;')`; it refuses to guess.

### 3. Check task status

```js
const t = await panel.tasks();
const mine = t.filter(x => x.status === 'running' || x.status === 'waiting');
return mine.map(x => `${x.id} ${x.status} ${x.title}${x.reason ? ' (' + x.reason + ')' : ''}`);
```
For one task: `(await panel.taskLog('cc-abc-1234')).report`.

### 4. Post a board note

```js
const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
await panel.board(`Finished the parser change on ${branch}. Tests pass. Ready for review.`, 'codex-parser');
return 'posted';
```
Keep notes short. Never post secrets.

### 5. Plan sub-tasks

```js
const files = glob('docs/**/*.md');
const out = [];
for (const f of files.slice(0, 5)) {
  out.push(await panel.addTask({
    title: `Proofread ${f}`,
    prompt: `Read ${f}. Fix spelling and unclear sentences. Change nothing else.`,
    kind: 'light',
  }));
}
return out.map(t => t.id);
```
Test a plan first with `--dry-run`: it returns the request instead of sending it.

## Limits

- A script stops after 60 s by default (`--timeout`, or `timeout_ms` in MCP). `run` and `git` calls default to 30 s and are clamped to the script timeout. `fetchJson` times out after 15 s.
- Output is cut at 20000 characters and ends with a "truncated" note. Return less: counts, short lines, only the parts you need.
- `fetchJson` and `panel.*` only talk to the Command Center on 127.0.0.1.
- `console.log` is collected and shown with the result; it never goes to the MCP channel.
- `edit` needs a unique match; `grep` stops at `max` hits; `glob` returns at most 1000 paths.
- Scripts run in a worker thread. A script stuck inside a long native call can only be stopped by the timeout of that call, so give `run` a `timeout`.

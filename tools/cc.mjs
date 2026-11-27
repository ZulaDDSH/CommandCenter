#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi, format } from './cc-lib.mjs';
import { runScript } from './run-script.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = `Command Center tools. Usage:
  node tools/cc.mjs run <file.js|-> [args...] [--timeout ms] [--cwd dir] [--dry-run]
  node tools/cc.mjs task add --title T (--prompt-file F | --prompt P) [--provider P --model M --parent ID --cwd D --kind K] [--dry-run]
  node tools/cc.mjs task list | task log <id>
  node tools/cc.mjs board [post <text> [--from name]]
  node tools/cc.mjs budget
  node tools/cc.mjs guide`;

const RUN_FLAGS = ['timeout', 'cwd', 'dry-run'];
const ALL_FLAGS = [...RUN_FLAGS, 'title', 'prompt', 'prompt-file', 'provider', 'model', 'parent', 'kind', 'from'];
const flags = {}, pos = [];
const argv = process.argv.slice(2);
const known = argv[0] === 'run' ? RUN_FLAGS : ALL_FLAGS;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i], name = a.slice(2);
  if (!a.startsWith('--') || !known.includes(name)) pos.push(a);
  else if (name === 'dry-run') flags[name] = true;
  else flags[name] = argv[++i];
}
const out = s => process.stdout.write(s.endsWith('\n') ? s : s + '\n');
class Fail extends Error {}
const fail = s => { throw new Fail(s); };
const opts = { cwd: flags.cwd ? path.resolve(flags.cwd) : process.cwd(), dryRun: flags['dry-run'] || process.env.CC_DRY_RUN === '1' };

async function main() {
  const [cmd, sub, ...rest] = pos;
  if (cmd === 'run') {
    if (!sub) fail('run needs a script file or - for stdin.');
    const code = sub === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(sub, 'utf8');
    const t = +flags.timeout;
    const r = await runScript(code, { ...opts, args: rest, ...(Number.isFinite(t) && t > 0 ? { timeout: t } : {}) });
    if (!r.ok) fail(r.text);
    out(r.text);
    return;
  }
  const api = createApi(opts), p = api.panel;
  if (cmd === 'task' && sub === 'add') {
    const prompt = flags['prompt-file'] ? fs.readFileSync(flags['prompt-file'], 'utf8') : flags.prompt;
    out(format(await p.addTask({ title: flags.title, prompt, provider: flags.provider, model: flags.model, parent: flags.parent, cwd: flags.cwd ? opts.cwd : undefined, kind: flags.kind })));
  } else if (cmd === 'task' && sub === 'list') {
    out((await p.tasks()).map(t => `${t.id}  ${t.status.padEnd(9)} ${(t.ranOn ?? t.provider).padEnd(8)} ${t.title}`).join('\n') || 'No tasks.');
  } else if (cmd === 'task' && sub === 'log' && rest[0]) {
    const r = await p.taskLog(rest[0], { tail: 8000 });
    out(`${r.task.id} ${r.task.status}: ${r.task.title}\n--- log ---\n${r.log}\n--- report ---\n${r.report}`);
  } else if (cmd === 'board' && sub === 'post' && rest.length) {
    out(format(await p.board(rest.join(' '), flags.from)));
  } else if (cmd === 'board' && !sub) {
    out(format((await p.board()).map(n => `[${n.at}] ${n.from}: ${n.text}`).join('\n\n') || 'The board is empty.'));
  } else if (cmd === 'budget' && !sub) {
    out(format(await p.budget()));
  } else if (cmd === 'guide') {
    const dir = path.join(ROOT, 'docs/ai-guide');
    out(fs.readdirSync(dir).filter(f => f.endsWith('.md')).sort().map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n\n'));
  } else fail(USAGE);
}
main().catch(e => { process.stderr.write(`${e instanceof Fail ? e.message : `Error: ${e.message}`}\n`); process.exitCode = 1; });

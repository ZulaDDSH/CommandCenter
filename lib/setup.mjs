import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { config, ROOT } from './config.mjs';
import { which, cursorPs1 } from './cli.mjs';

const HOME = os.homedir();
const win = process.platform === 'win32';
export const RUNTIME_DEFAULT = path.join(ROOT, 'runtime/node_modules/agent-interop-runtime');
export const runtimeDir = () => config().runtimeDir || RUNTIME_DEFAULT;
const q = s => `"${s}"`;
const slash = x => String(x).replace(/\\/g, '/');
const [MIN_MAJOR, MIN_MINOR] = [22, 13];
export const nodeOk = (v = process.versions.node) => { const [a, b] = v.split('.').map(Number); return a > MIN_MAJOR || (a === MIN_MAJOR && b >= MIN_MINOR); };

export const PROVIDERS = {
  freebuff: {
    name: 'Freebuff', what: 'Free hours of DeepSeek, Beam and Solar Pro each day. The main coder.',
    bin: 'freebuff', install: 'npm install -g freebuff', login: 'freebuff login',
    signedIn: () => fs.existsSync(path.join(HOME, '.config/manicode/credentials.json')), docs: 'https://www.npmjs.com/package/freebuff', site: 'https://codebuff.com',
  },
  codex: {
    name: 'Codex', what: 'OpenAI coding agent on your ChatGPT plan. Used when Freebuff hours run out.',
    bin: 'codex', install: 'npm install -g @openai/codex', login: 'codex login',
    signedIn: () => fs.existsSync(path.join(HOME, '.codex/auth.json')), docs: 'https://developers.openai.com/codex/cli', site: 'https://openai.com/codex',
  },
  cursor: {
    name: 'Cursor', what: 'Cursor agent (Composer model) on your Cursor plan.',
    bin: 'cursor-agent', install: win ? `powershell -NoProfile -ExecutionPolicy Bypass -Command "irm 'https://cursor.com/install?win32=true' | iex"` : 'curl https://cursor.com/install -fsS | bash',
    login: 'cursor-agent login', signedIn: null, docs: 'https://cursor.com/cli', site: 'https://cursor.com',
  },
  opencode: {
    name: 'OpenCode', what: 'OpenCode with the OpenCode Go plan (DeepSeek). The last fallback.',
    bin: 'opencode', install: 'npm install -g opencode-ai', login: 'opencode auth login',
    signedIn: () => fs.existsSync(path.join(HOME, '.local/share/opencode/auth.json')), docs: 'https://opencode.ai/docs', site: 'https://opencode.ai',
  },
  claude: {
    name: 'Claude', what: 'Claude Code on your Claude plan. The lead that can send work to the others through the relay.',
    bin: 'claude', install: 'npm install -g @anthropic-ai/claude-code', login: 'claude', loginNote: 'Claude opens. Type /login inside it, then follow the browser.',
    signedIn: () => fs.existsSync(path.join(HOME, '.claude/.credentials.json')), docs: 'https://docs.claude.com/en/docs/claude-code/overview', site: 'https://claude.com/product/claude-code',
  },
};

const installed = p => p === 'cursor' ? !!(which('cursor-agent') || cursorPs1()) : !!which(PROVIDERS[p].bin);

const SETTINGS = () => path.join(HOME, '.claude/settings.json');
const HOOK_MARK = 'freebuff-one-cli.mjs';
const HOOK_MATCHER = 'mcp__agent-interop-runtime__create_session|mcp__agent-interop-runtime__send_session_message';
const hookCommand = () => `node ${q(slash(path.join(ROOT, 'hooks', HOOK_MARK)))}`;
export function hookSnippet() {
  return { file: SETTINGS(), json: { hooks: { PreToolUse: [{ matcher: HOOK_MATCHER, hooks: [{ type: 'command', command: hookCommand() }] }] } } };
}

function claudeKnowsRelay() { try { return fs.readFileSync(path.join(HOME, '.claude.json'), 'utf8').includes('agent-interop-runtime'); } catch { return false; } }

function readSettings() {
  const f = SETTINGS();
  let raw;
  try { raw = fs.readFileSync(f, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return { raw: null, json: {} }; throw e; }
  let json;
  try { const t = raw.replace(/^\uFEFF/, ''); json = t.trim() ? JSON.parse(t) : {}; } catch { throw new Error(`${slash(f)} is not valid JSON. Fix that file by hand first; nothing was changed.`); }
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error(`${slash(f)} is not a JSON object. Nothing was changed.`);
  return { raw, json };
}

const hookEntries = json => (Array.isArray(json.hooks?.PreToolUse) ? json.hooks.PreToolUse : []).flatMap(g => (Array.isArray(g?.hooks) ? g.hooks : []).filter(h => String(h?.command ?? '').includes(HOOK_MARK)).map(h => ({ command: h.command, matcher: g.matcher })));
const sameCmd = (a, b) => process.platform === 'win32' ? String(a).toLowerCase().replace(/\\/g, '/') === String(b).toLowerCase().replace(/\\/g, '/') : a === b;
const isOurs = h => sameCmd(h.command, hookCommand()) && h.matcher === HOOK_MATCHER;

function hookState() {
  try { const e = hookEntries(readSettings().json); return e.length === 1 && isOurs(e[0]) ? 'ok' : e.length ? 'other' : 'none'; } catch { return 'none'; }
}

function writeSettings(raw, json, backupDir) {
  const f = SETTINGS();
  if (raw !== null) { fs.mkdirSync(backupDir, { recursive: true }); fs.copyFileSync(f, path.join(backupDir, `settings.json.${new Date().toISOString().replace(/[:.]/g, '-')}`)); }
  else fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.cc-tmp`;
  fs.writeFileSync(tmp, JSON.stringify(json, null, 2));
  fs.renameSync(tmp, f);
  JSON.parse(fs.readFileSync(f, 'utf8'));
}

function stripHook(json, onlyOurs = false) {
  let n = 0;
  if (!Array.isArray(json.hooks?.PreToolUse)) return 0;
  json.hooks.PreToolUse = json.hooks.PreToolUse.filter(g => {
    if (!Array.isArray(g?.hooks)) return true;
    const keep = g.hooks.filter(h => onlyOurs ? !sameCmd(h?.command, hookCommand()) : !String(h?.command ?? '').includes(HOOK_MARK));
    const gone = g.hooks.length - keep.length;
    n += gone; g.hooks = keep;
    return keep.length > 0 || gone === 0;
  });
  if (!json.hooks.PreToolUse.length) delete json.hooks.PreToolUse;
  if (!Object.keys(json.hooks).length) delete json.hooks;
  return n;
}

export function installHook(backupDir = path.join(ROOT, 'backups')) {
  const { raw, json } = readSettings();
  const have = hookEntries(json);
  if (have.length === 1 && isOurs(have[0])) return { changed: false };
  if (json.hooks != null && (typeof json.hooks !== 'object' || Array.isArray(json.hooks) || (json.hooks.PreToolUse != null && !Array.isArray(json.hooks.PreToolUse)))) throw new Error(`The hooks section in ${slash(SETTINGS())} has an unexpected shape. Nothing was changed.`);
  stripHook(json);
  json.hooks ??= {};
  json.hooks.PreToolUse = [...(json.hooks.PreToolUse ?? []), hookSnippet().json.hooks.PreToolUse[0]];
  writeSettings(raw, json, backupDir);
  return { changed: true };
}

export function removeHook(backupDir = path.join(ROOT, 'backups')) {
  let st;
  try { st = readSettings(); } catch (e) { return { changed: false, error: e.message }; }
  if (!stripHook(st.json, true)) return { changed: false };
  writeSettings(st.raw, st.json, backupDir);
  return { changed: true };
}

export function repos() {
  const roots = new Set(), c = config();
  if (c.projectDir) roots.add(path.dirname(path.resolve(c.projectDir)));
  for (const d of ['Projects', 'source', 'source/repos', 'repos', 'dev', 'code', 'Documents/GitHub', 'GitHub', 'Documents/Projects']) roots.add(path.join(HOME, d));
  const out = new Map();
  const add = d => { if (fs.existsSync(path.join(d, '.git'))) out.set(slash(d).toLowerCase(), { name: path.basename(d), path: slash(d) }); };
  if (c.projectDir) add(path.resolve(c.projectDir));
  for (const r of roots) {
    let ents = [];
    try { ents = fs.readdirSync(r, { withFileTypes: true }); } catch {}
    for (const e of ents) if (e.isDirectory() && !e.name.startsWith('.')) add(path.join(r, e.name));
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 80);
}

export function status(cursorUsage) {
  const providers = Object.fromEntries(Object.entries(PROVIDERS).map(([k, p]) => {
    const inst = installed(k);
    const signed = !inst ? false : p.signedIn ? p.signedIn() : k === 'cursor' ? cursorUsage?.loggedIn ?? null : null;
    return [k, { name: p.name, what: p.what, enabled: !!config().providers[k], installed: inst, signedIn: signed, install: p.install, login: p.login, loginNote: p.loginNote ?? '', docs: p.docs, site: p.site }];
  }));
  const rt = runtimeDir();
  const mcp = `claude mcp add -s user agent-interop-runtime -e CURSOR_AGENT_COMMAND=cursor-agent${win ? '.cmd' : ''} -- node ${q(path.join(rt, 'dist/src/cli.js'))} serve`;
  const hs = hookState();
  return {
    config: config(), root: slash(ROOT), providers,
    prereqs: {
      node: { ok: nodeOk(), detail: `Node ${process.version} (needs ${MIN_MAJOR}.${MIN_MINOR} or newer)` },
      git: { ok: !!which('git'), detail: which('git') ?? 'not found' },
      claude: { ok: !!which('claude'), detail: which('claude') ?? 'not found (optional, only for the Claude lead)' },
      runtime: { ok: fs.existsSync(path.join(rt, 'package.json')), detail: slash(rt), registered: claudeKnowsRelay(), install: `npm install --prefix ${q(path.join(ROOT, 'runtime'))} agent-interop-runtime@1.1.0`, mcp },
    },
    hook: { file: slash(SETTINGS()), state: hs, installed: hs === 'ok' },
    tools: { register: fs.existsSync(path.join(ROOT, 'tools/register.mjs')) },
  };
}

export function command(p, a) {
  if (p === 'runtime' && a === 'install') return status().prereqs.runtime.install;
  if (p === 'runtime' && a === 'mcp') return status().prereqs.runtime.mcp;
  if (p === 'runtime' && a === 'patch') return `node ${q(slash(path.join(ROOT, 'relay/reapply.mjs')))}`;
  if (!Object.hasOwn(PROVIDERS, p) || !['install', 'login'].includes(a)) return null;
  return PROVIDERS[p][a] ?? null;
}

const sha = f => { try { return createHash('sha256').update(fs.readFileSync(f)).digest('hex'); } catch { return null; } };

export async function debug(ctx) {
  const c = config(), checks = [];
  const add = (group, name, ok, detail, fix) => checks.push({ group, name, ok, detail, fix });
  add('Setup', 'Settings file', c.exists, c.exists ? path.join(ROOT, 'config.json') : 'No config.json yet.', 'Open the Setup tab. Changes save by themselves.');
  add('Setup', 'Node version', nodeOk(), `Node ${process.version} (needs ${MIN_MAJOR}.${MIN_MINOR} or newer)`, 'Install the current Node LTS from https://nodejs.org, then restart the panel.');
  add('Setup', 'Project folder', !!c.projectDir && fs.existsSync(c.projectDir), c.projectDir || 'not set', 'Pick the project folder in Setup.');
  let writable = false;
  try { fs.mkdirSync(c.reportsDir, { recursive: true }); const f = path.join(c.reportsDir, '.cc-write-test'); fs.writeFileSync(f, 'x'); fs.unlinkSync(f); writable = true; } catch {}
  add('Setup', 'Reports folder can be written', writable, c.reportsDir, 'Pick a folder you can write to in Setup.');
  const st = status(ctx.cursorUsage);
  for (const [k, p] of Object.entries(st.providers)) {
    if (!p.enabled) { add('Providers', `${p.name}`, null, 'Turned off in Setup.', ''); continue; }
    add('Providers', `${p.name} installed`, p.installed, p.installed ? which(PROVIDERS[k].bin) ?? cursorPs1() : 'not found on PATH', `Run: ${p.install}`);
    add('Providers', `${p.name} signed in`, p.signedIn, p.signedIn == null ? 'Still checking.' : p.signedIn ? 'yes' : 'no', `Run: ${p.login}`);
    const u = ctx.usage[k];
    if (u) add('Providers', `${p.name} usage reader`, u.loading ? null : !u.error, u.loading ? 'Still reading.' : u.error ?? 'reads fine', 'Press Refresh usage on its tab, then check the error text.');
  }
  const rt = runtimeDir();
  add('Relay', 'Relay runtime found', st.prereqs.runtime.ok, rt, `Run: ${st.prereqs.runtime.install}`);
  add('Relay', 'node-pty (drives Freebuff)', fs.existsSync(path.join(rt, 'node_modules/node-pty')) || fs.existsSync(path.join(rt, '../node-pty')), 'Needed to start Freebuff CLIs.', 'Reinstall the runtime; node-pty comes with it.');
  for (const n of ['pty.js', 'adapters.js']) {
    const live = sha(path.join(rt, 'dist/src', n)), want = sha(path.join(ROOT, 'relay', `${n}.patched`));
    add('Relay', `${n} patch applied`, !!live && live === want, live ? (live === want ? 'matches relay/' + n + '.patched' : 'runtime has a different copy') : 'runtime file missing', 'Run: node relay/reapply.mjs, then restart the agent-interop-runtime MCP server.');
  }
  const drv = ctx.freebuffDriver();
  add('Relay', 'Freebuff driver loads in the panel', drv.loaded ? true : drv.error ? false : null, drv.loaded ? `${drv.own.length} panel CLI(s)` : drv.error ?? 'Loads on the first Freebuff task.', 'Check the relay runtime in Setup.');
  if (!drv.loaded && !drv.error && st.prereqs.runtime.ok) {
    try { await import(pathToFileURL(path.join(rt, 'dist/src/pty.js')).href); checks.at(-1).ok = true; checks.at(-1).detail = 'Module loads.'; } catch (e) { checks.at(-1).ok = false; checks.at(-1).detail = e.message; }
  }
  add('Relay', 'Claude knows the relay (MCP)', st.prereqs.runtime.registered, st.prereqs.runtime.registered ? 'agent-interop-runtime is registered' : 'not registered', 'Press Register with Claude in the Relay card on the Setup tab.');
  add('Relay', 'One-CLI hook installed', st.hook.installed, st.hook.state === 'other' ? `${st.hook.file} has a different or extra Command Center hook` : st.hook.file, 'Press Install hook in the Relay card on the Setup tab.');
  const port = await fetch('http://127.0.0.1:4096/', { signal: AbortSignal.timeout(2000) }).then(() => true, () => false);
  add('Relay', 'OpenCode server on port 4096', c.providers.opencode ? port : null, port ? 'answering' : 'not answering (only the relay needs it)', 'Run start.ps1, or: opencode serve --hostname 127.0.0.1 --port 4096');
  const age = Date.now() - ctx.dispatcher.lastTick;
  add('Tasks', 'Task dispatcher running', age < 15000 && !ctx.dispatcher.error, ctx.dispatcher.error ?? `last check ${Math.round(age / 1000)} s ago`, 'Restart the panel (start.ps1).');
  let spawn = null;
  try { spawn = ctx.spawnDecision('code'); } catch (e) { spawn = { error: e.message }; }
  add('Tasks', 'Freebuff start rule works', !spawn.error, spawn.error ?? spawn.why, 'Check the Freebuff usage reader above.');
  let boardOk = true;
  try { fs.accessSync(path.dirname(ctx.boardFile), fs.constants.W_OK); } catch { boardOk = false; }
  add('Tasks', 'Team board can be written', boardOk, ctx.boardFile, 'Make the Command Center folder writable.');
  const homeRe = HOME.length > 3 ? new RegExp(HOME.split(/[\\/]/).map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\\\/]') + '(?![^\\\\/])', process.platform === 'win32' ? 'gi' : 'g') : null;
  const tidy = s => typeof s === 'string' && homeRe ? s.replace(homeRe, '~') : s;
  return checks.concat(await loadChecks(ctx)).map(r => ({ ...r, detail: tidy(r.detail), fix: tidy(r.fix) }));
}

const CHECK_MS = 15000;
async function loadChecks(ctx) {
  const dir = path.join(ROOT, 'lib/checks'), rows = [];
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => f.endsWith('.mjs')).sort(); } catch {}
  for (const f of files) {
    const name = f.replace(/\.mjs$/, '');
    try {
      const mod = await import(pathToFileURL(path.join(dir, f)).href);
      const got = await Promise.race([mod.default(ctx), new Promise((_, no) => setTimeout(() => no(new Error(`took over ${CHECK_MS / 1000} seconds`)), CHECK_MS).unref())]);
      if (!Array.isArray(got)) throw new Error('did not return a list of rows');
      for (const r of got) rows.push({ group: String(r?.group ?? name), name: String(r?.name ?? name), ok: r?.ok === true ? true : r?.ok === false ? false : null, detail: String(r?.detail ?? ''), fix: r?.fix ? String(r.fix) : '' });
    } catch (e) { rows.push({ group: 'Checks', name: `Check file ${f}`, ok: false, detail: `Failed to run: ${e.message}`, fix: `Fix or remove lib/checks/${f}.` }); }
  }
  return rows;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [what, a, b] = process.argv.slice(2);
  if (what === 'command') console.log(command(a, b) ?? '');
  else if (what === 'hook' && ['install', 'remove'].includes(a)) {
    let r;
    try { r = (a === 'install' ? installHook : removeHook)(b || undefined); } catch (e) { r = { error: e.message }; }
    console.log(r.error ?? (r.changed ? `hook ${a} done` : 'hook: nothing to do'));
    process.exitCode = r.error ? 1 : 0;
  } else { console.error('usage: node lib/setup.mjs command <provider|runtime> <install|login|mcp|patch> | hook <install|remove> [backupDir]'); process.exitCode = 2; }
}

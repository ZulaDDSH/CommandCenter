import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { all as providerUsage } from '../usage/providers.mjs';
import { pick as route } from '../route.mjs';
import { config, ROOT } from '../lib/config.mjs';
import { lists as sessionLists, details as sessionDetails } from '../lib/sessions.mjs';
import { decorate, metaFor } from '../lib/session-meta.mjs';
import * as tasks from '../lib/tasks.mjs';
import * as setup from '../lib/setup.mjs';
import { listModels } from '../lib/models.mjs';
const REFRESH = { freebuff: 300000, fbmodels: 1800000, codex: 60000, opencode: 600000, cursor: 1800000, claude: 3600000, route: 300000 };
const usage = {};
function cachedUsage(name, fresh) {
  const u = usage[name] ??= { at: 0, busy: false, body: '{"loading":true}' };
  if ((fresh || Date.now() - u.at > REFRESH[name]) && !u.busy) {
    u.busy = true;
    (name === 'route' ? route() : providerUsage[name]())
      .then(v => { u.body = JSON.stringify({ ...v, fetchedAt: Date.now() }); },
            e => { u.body = JSON.stringify({ error: String(e?.message ?? e).slice(0, 200), fetchedAt: Date.now() }); })
      .finally(() => { u.busy = false; u.at = Date.now(); });
  }
  return u.body;
}

const PROJECTS = path.join(os.homedir(), '.config/manicode/projects');
const REPO = () => config().projectDir;
const REPORTS = () => config().reportsDir;
function chatDirs() {
  const out = [];
  try { for (const p of fs.readdirSync(PROJECTS)) try { for (const d of fs.readdirSync(path.join(PROJECTS, p, 'chats'))) out.push({ name: d, dir: path.join(PROJECTS, p, 'chats', d) }); } catch {} } catch {}
  return out.sort((a, b) => b.name.localeCompare(a.name)).slice(0, 40);
}
const PORT = Number(process.env.PORT ?? 4021);
const clip = (s, n) => (s = String(s ?? ''), s.length > n ? s.slice(0, n) + `\n… ${s.length - n} more chars` : s);
const git = (cwd, ...args) => spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', maxBuffer: 64 << 20 }).stdout ?? '';

function toolSummary(b) {
  const i = b.input ?? {};
  if (i.command) return i.command;
  if (Array.isArray(i.paths)) return i.paths.map(p => typeof p === 'string' ? p : p?.path ?? JSON.stringify(p)).join(', ');
  return i.path ?? i.pattern ?? i.query ?? JSON.stringify(i);
}

const worktree = slug => !REPO() ? null : [slug, slug.replace(/-r\d+$/, '')].map(s => `${REPO()}/.worktrees/fb-${s}`).find(p => fs.existsSync(p)) ?? null;

function baseOf(wt) {
  const branch = git(wt, 'rev-parse', '--abbrev-ref', 'HEAD').trim();
  const log = git(wt, 'reflog', 'show', '--format=%H', branch).trim().split('\n').filter(Boolean);
  return log.at(-1) || git(wt, 'merge-base', 'HEAD', defaultBase(wt)).trim();
}
function defaultBase(wt) {
  const up = git(wt, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}').trim();
  if (up) return up;
  const head = git(wt, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD').trim();
  if (head) return head;
  return ['origin/main', 'origin/master', 'main', 'master'].find(b => git(wt, 'rev-parse', '--verify', '--quiet', b).trim()) ?? 'HEAD';
}

const cache = new Map();
function changes(slug, done) {
  const wt = worktree(slug);
  if (!wt) return null;
  const hit = cache.get(slug);
  if (hit && Date.now() - hit.t < (done ? 600000 : 15000)) return hit.v;
  const base = baseOf(wt);
  const files = git(wt, 'diff', '--numstat', base).trim().split('\n').filter(Boolean).map(l => {
    const [a, d, ...p] = l.split('\t');
    return { path: p.join('\t'), add: +a || 0, del: +d || 0 };
  });
  for (const p of git(wt, 'ls-files', '--others', '--exclude-standard').trim().split('\n').filter(Boolean)) {
    let n = 0;
    try { n = fs.readFileSync(path.join(wt, p), 'utf8').split('\n').length; } catch {}
    files.push({ path: p, add: n, del: 0, isNew: true });
  }
  const commits = git(wt, 'log', '--format=%h %s', `${base}..HEAD`).trim().split('\n').filter(Boolean);
  const v = { base: base.slice(0, 9), branch: git(wt, 'rev-parse', '--abbrev-ref', 'HEAD').trim(), commits, files,
    add: files.reduce((s, f) => s + f.add, 0), del: files.reduce((s, f) => s + f.del, 0) };
  cache.set(slug, { t: Date.now(), v });
  return v;
}

function fileDiff(slug, file) {
  const wt = worktree(slug);
  if (!wt || path.isAbsolute(file) || !path.resolve(wt, file).startsWith(path.resolve(wt) + path.sep)) return '';
  const tracked = git(wt, 'ls-files', '--error-unmatch', '--', file).trim();
  if (tracked) return git(wt, 'diff', baseOf(wt), '--', file);
  return spawnSync('git', ['-C', wt, 'diff', '--no-index', '--', '/dev/null', file], { encoding: 'utf8', maxBuffer: 64 << 20 }).stdout ?? '';
}

const LOGOUT = { codex: 'codex logout', cursor: 'cursor-agent logout', opencode: 'opencode auth logout' };
const LIVE = path.join(os.homedir(), '.config/manicode');
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const WORK = /^(Start agent|End agent|[send-message]|[message-queue]|Main prompt finished)/;
const pidCache = new Map();
function chatPid(dir) {
  const file = path.join(dir, 'log.jsonl');
  try {
    const st = fs.statSync(file), hit = pidCache.get(file);
    if (hit && hit.size === st.size && hit.mtime === st.mtimeMs) return hit.pid;
    const fd = fs.openSync(file, 'r');
    let first = '', tail = '';
    try {
      const head = Buffer.alloc(Math.min(8192, st.size)); fs.readSync(fd, head, 0, head.length, 0); first = head.toString('utf8').split(String.fromCharCode(10), 1)[0];
      const n = Math.min(131072, st.size), buf = Buffer.alloc(n); fs.readSync(fd, buf, 0, n, st.size - n); tail = buf.toString('utf8');
    } finally { fs.closeSync(fd); }
    let pid = null;
    try { pid = JSON.parse(first).pid ?? null; } catch {}
    for (const l of tail.split(String.fromCharCode(10)).reverse()) {
      try { const o = JSON.parse(l); if (WORK.test(String(o.msg)) && Number.isInteger(o.pid)) { pid = o.pid; break; } } catch {}
    }
    pidCache.set(file, { size: st.size, mtime: st.mtimeMs, pid });
    return pid;
  } catch { return null; }
}
function liveInfo(dir) {
  const pid = chatPid(dir);
  if (!pid || !alive(pid)) return { expiresAt: null, hourOver: false };
  try { const e = JSON.parse(fs.readFileSync(path.join(LIVE, `freebuff-live-${pid}.json`), 'utf8')).expiresAt; if (e > Date.now()) return { expiresAt: e, hourOver: false }; } catch {}
  return { expiresAt: null, hourOver: true };
}

const json = s => { try { return JSON.parse(s); } catch { return {}; } };
const KINDS = { code: 'coding', light: 'light coding', read: 'read-only' };
const MAX_CLIS = () => config().maxClis;
let sessMemo = { at: 0, v: [] };
const memoSessions = () => (Date.now() - sessMemo.at > 4000 && (sessMemo = { at: Date.now(), v: loadSessions() }), sessMemo.v);
function spawnDecision(kind = 'code', modelKey) {
  if (!KINDS[kind]) kind = 'code';
  const clis = (fs.existsSync(LIVE) ? fs.readdirSync(LIVE) : []).map(f => /^freebuff-live-(\d+)\.json$/.exec(f)).filter(Boolean)
    .map(m => { let l = {}; try { l = json(fs.readFileSync(path.join(LIVE, m[0]), 'utf8')); } catch {} return { pid: Number(m[1]), expiresAt: l.expiresAt ?? 0, modelKey: l.model ?? null }; })
    .filter(c => alive(c.pid));
  const fb = json(cachedUsage('freebuff')), fm = json(cachedUsage('fbmodels')), rows = fm.rows ?? [];
  const sessions = memoSessions().filter(s => !s.archived);
  const pending = tasks.pendingClis(new Set(clis.map(c => c.pid)));
  for (const c of clis) {
    const mine = sessions.filter(s => chatPid(s.dir) === c.pid);
    Object.assign(c, { model: rows.find(r => r.key === c.modelKey)?.name ?? null, working: mine.filter(s => !s.queued).map(s => s.slug), queued: mine.filter(s => s.queued).map(s => s.slug), minsLeft: Math.max(0, Math.round((c.expiresAt - Date.now()) / 60000)) });
  }
  const roles = { code: rows.find(r => r.key === (fm.current || fm.recommendedKey)), light: rows.find(r => /^beam\b/i.test(r.name)), read: rows.find(r => /^solar pro\b/i.test(r.name)) };
  const [h, m] = fb.today?.left ? String(fb.today.left).split(':').map(Number) : [NaN, NaN];
  const costOf = k => rows.find(r => r.key === k)?.hours ?? roles.code?.hours ?? 0;
  const committed = clis.reduce((a, c) => a + c.minsLeft / 60 * costOf(c.modelKey), 0) + pending.reduce((a, c) => a + costOf(c.modelKey), 0);
  const leftFor = r => r?.hours == null || Number.isNaN(h) ? null : r.hours === 0 ? Infinity : Math.floor((h + (m || 0) / 60 - committed) / r.hours);
  const asked = modelKey ? rows.find(r => r.key === modelKey) : null;
  let model = asked ?? roles[kind] ?? roles.code, note = '';
  if (!asked && kind === 'code' && roles.light && (leftFor(model) ?? 2) < 2) { note = `Only ${leftFor(model)} h of ${model.name} left, so Beam codes. `; model = roles.light; }
  const useLeft = leftFor(model), free = model?.hours === 0;
  const max = MAX_CLIS();
  const all = [...clis, ...pending.map(p => ({ pid: p.pid, modelKey: p.modelKey, model: rows.find(r => r.key === p.modelKey)?.name ?? null, minsLeft: 60, working: [], queued: [], pending: true }))];
  const base = { kind, clis: all, max, model: model?.name ?? null, modelKey: model?.key ?? null, cost: model?.hours, useLeft: useLeft === Infinity ? 'unlimited' : useLeft, codeLeft: leftFor(roles.code) === Infinity ? 'unlimited' : leftFor(roles.code), roles: Object.fromEntries(Object.entries(roles).map(([k, r]) => [k, r?.name ?? null])), waiting: clis.reduce((a, c) => a + c.queued.length, 0) };
  const same = clis.filter(c => !model || c.modelKey === model.key);
  const idle = same.find(c => !c.working.length && !c.queued.length);
  const least = l => [...l].sort((a, b) => a.queued.length - b.queued.length)[0];
  const queueOn = least(same.length ? same : clis) ?? { pid: null, queued: [] };
  const qNote = same.length ? '' : ` No CLI runs ${model?.name ?? 'that model'}, so the task runs on that CLI's model.`;
  const on = `${KINDS[kind]} on ${model?.name ?? 'the saved model'}`;
  if (!all.length) return { ...base, spawn: true, why: `${note}No freebuff CLI is running; a new one starts ${on}.` };
  if (idle) return { ...base, spawn: false, target: idle.pid, why: `${note}CLI pid ${idle.pid} runs ${model?.name ?? 'the saved model'} and is idle; send the task there.` };
  if (all.length >= max) return { ...base, spawn: false, target: queueOn.pid, why: `${note}${all.length} CLIs running (max ${max}); queue on pid ${queueOn.pid}.${qNote}` };
  if (!free && useLeft == null) return { ...base, spawn: false, target: queueOn.pid, why: `Hours not read yet; queue on pid ${queueOn.pid}.${qNote}` };
  if (!free && useLeft < 2) return { ...base, spawn: false, target: queueOn.pid, why: `Only ${useLeft} h of ${model.name} left after the running CLIs; queue on pid ${queueOn.pid}.${qNote}` };
  return { ...base, spawn: true, why: `${note}${same.length ? `Every ${model.name} CLI is busy` : `No CLI runs ${model.name}`}, so a new CLI starts ${on}${free ? ' (free)' : ` (${base.useLeft} h of it left)`}.` };
}

const allModels = fresh => listModels({ fbRows: json(cachedUsage('fbmodels')).rows, fresh });
const BOARD = path.join(ROOT, 'board.jsonl');
const boardNotes = () => { try { return fs.readFileSync(BOARD, 'utf8').split('\n').filter(Boolean).slice(-100).map(json); } catch { return []; } };

const rates = new Map();
function tokenRate(key, chars) {
  const now = Date.now(), s = rates.get(key) ?? [];
  if (s.length && chars < s.at(-1).c) s.length = 0;
  if (!s.length || s.at(-1).c !== chars || now - s.at(-1).t > 10000) s.push({ t: now, c: chars });
  while (s.length > 2 && now - s[1].t > 120000) s.shift();
  rates.set(key, s);
  const a = s[0], b = s.at(-1), secs = (now - a.t) / 1000;
  return { tokens: Math.round(chars / 4), tps: secs > 5 ? Math.round((b.c - a.c) / 4 / secs * 10) / 10 : null };
}

const SLUG = /(?:fb-briefs|tasks)\/([\w-]+)\.md/;
function splitChat(msgs, chatName) {
  const segs = [];
  let cur = -1, lastAi = false;
  for (const m of msgs) {
    if (m.variant === 'user') {
      const slug = m.content?.match(SLUG)?.[1];
      if (!slug || slug === '_common') {
        if (cur < 0) { segs.push({ slug: `chat-${chatName}`, title: String(m.content ?? '').trim().split('\n')[0].slice(0, 80), steps: [], ai: 0, chars: 0 }); cur = 0; }
        segs[cur].steps.push({ k: 'user', text: m.content }); continue;
      }
      segs.push({ slug, steps: [{ k: 'user', text: m.content }], ai: 0, chars: 0 });
      if (cur < 0 || lastAi) cur = segs.length - 1;
      lastAi = false;
      continue;
    }
    const blocks = (m.blocks ?? []).filter(b => b.type === 'text' || b.type === 'tool');
    if (!blocks.length || cur < 0) continue;
    const raw = JSON.stringify(m);
    const next = segs.findIndex((s, i) => i > cur && (raw.includes(`fb-briefs/${s.slug}.md`) || raw.includes(`tasks/${s.slug}.md`)));
    if (next > 0) cur = next;
    const seg = segs[cur];
    seg.ai++; lastAi = true;
    for (const b of blocks) {
      if (b.type === 'text' && b.content?.trim()) { seg.steps.push({ k: 'text', text: b.content }); seg.chars += b.content.length; }
      else if (b.type === 'tool') { seg.steps.push({ k: 'tool', id: b.toolCallId, name: b.toolName, input: clip(toolSummary(b), 600), output: clip(b.output, 6000) }); seg.chars += JSON.stringify(b.input ?? {}).length; }
    }
  }
  return segs;
}

function loadSessions() {
  const out = [];
  for (const { name, dir } of chatDirs()) {
    const file = path.join(dir, 'chat-messages.json');
    let msgs;
    try { msgs = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { continue; }
    const mtime = fs.statSync(file).mtimeMs;
    for (const seg of splitChat(msgs, name)) {
      const slug = seg.slug;
      if (out.some(s => s.slug === slug)) continue;
      const reportFile = path.join(REPORTS(), `${slug}.md`);
      const report = fs.existsSync(reportFile) ? fs.readFileSync(reportFile, 'utf8') : null;
      const queued = !report && !seg.ai;
      out.push({ slug, title: seg.title, dir, queued, archived: !!report, ...(report || queued ? { expiresAt: null, hourOver: false } : liveInfo(dir)), mtime, steps: seg.steps, report,
        rate: report || queued ? { tokens: Math.round(seg.chars / 4), tps: null } : tokenRate(`${dir}:${slug}`, seg.chars),
        changes: changes(slug, !!report) });
    }
  }
  return out;
}

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const staticFile = p => p === '/' ? 'index.html' : /^\/[\w-]+\.(js|css)$/.test(p) && fs.existsSync(path.join(PUBLIC, p.slice(1))) ? p.slice(1) : null;
const ROUTES = [];
for (const f of fs.readdirSync(path.join(ROOT, 'lib/routes')).filter(f => f.endsWith('.mjs')).sort()) ROUTES.push((await import(pathToFileURL(path.join(ROOT, 'lib/routes', f)).href)).default);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const sameOrigin = req => !req.headers.origin || [`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`].includes(req.headers.origin);
const send = (res, code, body, type = 'application/json') => { res.writeHead(code, { 'content-type': type }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
const readBody = (req, max) => new Promise((ok, fail) => {
  let b = ''; req.setEncoding('utf8');
  req.on('data', c => { b += c; if (b.length > max) { fail(new Error(`body over ${max} chars`)); req.destroy(); } });
  req.on('end', () => ok(b)); req.on('error', fail);
});
const openTerminal = (title, cmd) => { const c = spawn('cmd.exe', ['/c', `start "${title}" cmd /k ${cmd}`], { windowsVerbatimArguments: true, detached: true, stdio: 'ignore' }); c.on('error', e => console.error(`terminal: ${e.message}`)); c.unref(); };
process.on('uncaughtException', e => console.error(`uncaught: ${e.stack ?? e}`));

let sessCache = { at: 0, body: '[]' };
function allSessions() {
  if (Date.now() - sessCache.at < 15000) return sessCache.body;
  const out = decorate('freebuff', loadSessions().filter(s => !s.archived).map(s => ({ provider: 'freebuff', id: s.slug, title: s.title ?? s.slug, cwd: worktree(s.slug), mtime: s.mtime, state: !s.queued && Date.now() - s.mtime < 120000 ? 'working' : 'idle' })));
  for (const [p, fn] of Object.entries(sessionLists)) {
    if (!config().providers[p]) continue;
    try { out.push(...fn(15)); } catch (e) { out.push({ provider: p, id: '', title: `Could not read ${p} sessions: ${e.message}`, state: 'done', mtime: 0 }); }
  }
  sessCache = { at: Date.now(), body: JSON.stringify(out) };
  return sessCache.body;
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'), q = k => u.searchParams.get(k) ?? '';
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(req.headers.host ?? '')) return send(res, 421, 'wrong host', 'text/plain');
  if (req.method === 'POST' && !sameOrigin(req)) return send(res, 403, 'cross-origin post refused', 'text/plain');
  if (/^(cross|same)-site$/.test(req.headers['sec-fetch-site'] ?? '')) return send(res, 403, 'cross-site request refused', 'text/plain');
  try {
    const sf = staticFile(u.pathname);
    if (sf) return send(res, 200, fs.readFileSync(path.join(PUBLIC, sf), 'utf8'), TYPES[path.extname(sf)]);
    const ctx = { req, res, u, q, send, readBody, openTerminal, loadSessions, worktree, cachedUsage, json, allModels, clearSessions: () => { sessCache.at = 0; } };
    for (const r of ROUTES) if (await r(ctx)) return;
    if (u.pathname === '/api') {
      const meta = metaFor();
      return send(res, 200, loadSessions().filter(s => !meta('freebuff', s.slug).deleted).map(s => { const v = meta('freebuff', s.slug); const idle = !s.expiresAt && Date.now() - s.mtime > 72e5; return { ...s, hourOver: s.hourOver && !idle, label: v.name ?? '', hidden: !!v.archived || idle }; }));
    }
    if (u.pathname === '/usage') {
      const p = q('p') || 'freebuff';
      return Object.hasOwn(REFRESH, p) ? send(res, 200, cachedUsage(p, u.searchParams.has('fresh'))) : send(res, 404, { error: 'unknown provider' });
    }
    if (u.pathname === '/auth' && req.method === 'POST') {
      const p = q('p'), a = q('a'), cmd = a === 'logout' ? (Object.hasOwn(LOGOUT, p) ? LOGOUT[p] : null) : setup.command(p, 'login');
      if (!cmd || !['login', 'logout'].includes(a)) return send(res, 400, 'unknown', 'text/plain');
      openTerminal(`${p} ${a}`, cmd);
      if (usage[p]) usage[p].at = 0;
      if (usage.route) usage.route.at = 0;
      return send(res, 200, 'opened', 'text/plain');
    }
    if (u.pathname === '/spawn-check') {
      const kind = q('kind') || 'code';
      let d;
      try { d = tasks.spawnApproval(kind, q('cli') || null) ?? spawnDecision(kind, q('model') || undefined); } catch (e) { d = { spawn: false, clis: [], max: MAX_CLIS(), why: `Spawn check failed: ${e.message}` }; }
      return send(res, 200, d);
    }
    if (u.pathname === '/board' && req.method === 'POST') {
      const text = (await readBody(req, 8000)).trim(), from = (q('from') || 'agent').slice(0, 60);
      if (!text) return send(res, 400, 'empty note', 'text/plain');
      fs.appendFileSync(BOARD, JSON.stringify({ at: new Date().toISOString(), from, text }) + '\n');
      return send(res, 200, 'posted', 'text/plain');
    }
    if (u.pathname === '/board') {
      const notes = boardNotes();
      if (u.searchParams.has('json')) return send(res, 200, notes);
      return send(res, 200, notes.map(n => `[${n.at}] ${n.from}: ${n.text}`).join('\n\n') || 'The board is empty.', 'text/plain; charset=utf-8');
    }
    if (u.pathname === '/fb-model' && req.method === 'POST') {
      const key = q('key');
      let rows = [];
      try { rows = JSON.parse(usage.fbmodels?.body ?? '{}').rows ?? []; } catch {}
      if (!rows.some(r => r.key === key)) return send(res, 400, 'unknown model', 'text/plain');
      const file = path.join(os.homedir(), '.config/manicode/settings.json');
      let s = {};
      try { s = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
      fs.writeFileSync(file, JSON.stringify({ ...s, freebuffModelKey: key }, null, 2));
      usage.fbmodels.body = JSON.stringify({ ...JSON.parse(usage.fbmodels.body), current: key });
      return send(res, 200, 'saved', 'text/plain');
    }
    if (u.pathname === '/diff') return send(res, 200, fileDiff(q('slug'), q('file')), 'text/plain; charset=utf-8');
    if (u.pathname === '/sessions') return send(res, 200, allSessions());
    if (u.pathname === '/session') {
      const fn = Object.hasOwn(sessionDetails, q('p')) ? sessionDetails[q('p')] : null;
      if (!fn) return send(res, 404, { error: 'unknown provider' });
      const s = fn(q('id'));
      return s ? send(res, 200, s) : send(res, 404, { error: 'session not found' });
    }
    if (u.pathname === '/tasks' && req.method === 'POST') {
      let input;
      try { input = JSON.parse(await readBody(req, 60000)); } catch (e) { return send(res, 400, { error: `Bad request: ${e.message}` }); }
      try { const t = tasks.add(input); tasks.tick(); return send(res, 200, t); } catch (e) { return send(res, 400, { error: e.message }); }
    }
    if (u.pathname === '/tasks') {
      let list = tasks.list();
      if (q('parent')) { const kin = new Set([q('parent')]); for (let n = 0; n < 4; n++) for (const t of list) if (kin.has(t.parent)) kin.add(t.id); kin.delete(q('parent')); list = list.filter(t => kin.has(t.id)); }
      if (u.searchParams.has('brief')) list = list.map(({ text, ...t }) => t);
      return send(res, 200, { tasks: list, dispatcher: tasks.state, driver: tasks.freebuffDriver() });
    }
    const tm = /^\/tasks\/([\w-]+)\/(cancel|retry|done)$/.exec(u.pathname);
    if (tm && req.method === 'POST') {
      if (tm[2] === 'retry') {
        let force = false;
        try { force = JSON.parse((await readBody(req, 2000)).trim() || '{}').force === true; } catch {}
        const t = tasks.retry(tm[1], { force });
        if (t?.orphanAlive) return send(res, 409, { error: `The agent process ${t.orphanAlive} from before the restart is still running and may still be editing the folder. End it first, or retry anyway with force.`, orphanPid: t.orphanAlive });
        if (t) tasks.tick();
        return t ? send(res, 200, t) : send(res, 400, { error: 'That task cannot do that now.' });
      }
      const r = tm[2] === 'cancel' ? tasks.cancel(tm[1]) : tasks.markDone(tm[1]);
      if (r.ok) return send(res, 200, r.task);
      return send(res, r.code === 'not-found' ? 404 : 409, { error: r.why, code: r.code });
    }
    if (u.pathname === '/task-log') {
      const t = tasks.get(q('id'));
      if (!t) return send(res, 404, { error: 'unknown task' });
      return send(res, 200, { task: t, log: tasks.readTail(tasks.logFile(t.id), 20000), report: tasks.readTail(tasks.reportFile(t.id), 20000) });
    }
    if (u.pathname === '/setup') return send(res, 200, setup.status(json(cachedUsage('cursor'))));
    if (u.pathname === '/setup/run' && req.method === 'POST') {
      const cmd = setup.command(q('p'), q('a'));
      if (!cmd || !['install', 'login', 'mcp'].includes(q('a'))) return send(res, 400, 'unknown', 'text/plain');
      openTerminal(`${q('p')} ${q('a')}`, cmd);
      for (const k of [q('p'), 'route']) if (usage[k]) usage[k].at = 0;
      return send(res, 200, 'opened', 'text/plain');
    }
    if (u.pathname === '/debug') {
      const names = ['freebuff', 'codex', 'cursor', 'opencode'];
      const ctx = { cursorUsage: json(cachedUsage('cursor')), usage: Object.fromEntries(names.map(n => [n, json(cachedUsage(n))])), freebuffDriver: tasks.freebuffDriver, dispatcher: tasks.state, spawnDecision, boardFile: BOARD };
      return send(res, 200, await setup.debug(ctx));
    }
    send(res, 404, 'not found', 'text/plain');
  } catch (e) {
    if (!res.headersSent) send(res, 500, { error: e.message });
  }
}).listen(PORT, '127.0.0.1', () => console.log(`Command Center on http://127.0.0.1:${PORT}`));

tasks.init({ spawnDecision, route: () => json(cachedUsage('route')), usage: n => json(cachedUsage(n)), models: () => allModels() });
if (!process.env.CC_NO_DISPATCH) tasks.startDispatcher();

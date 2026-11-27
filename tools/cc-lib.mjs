import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const OUT_CAP = 20000;
const SKIP = new Set(['node_modules', '.git']);
const POST_ORIGIN = 'http://127.0.0.1:4021';

export const cap = (s, n = OUT_CAP) => s.length > n ? `${s.slice(0, n)}\n[truncated: ${s.length - n} more chars; return less]` : s;

const winCache = new Map();
function resolveWin(cmd) {
  if (process.platform !== 'win32' || /[\\/]/.test(cmd) || /\.\w+$/.test(cmd)) return cmd;
  if (!winCache.has(cmd)) {
    const r = spawnSync('where.exe', [cmd], { encoding: 'utf8', windowsHide: true, timeout: 10000, cwd: os.tmpdir() });
    const hits = r.status === 0 ? r.stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean) : [];
    winCache.set(cmd, hits.find(h => /\.(exe|com|cmd|bat)$/i.test(h)) ?? cmd);
  }
  return winCache.get(cmd);
}

const needsQuote = a => /[\s&|<>^()!,;=]/.test(a) || a === '';
// invariant: args reach cmd.exe only inside double quotes; quotes, %, newlines and quoted args ending in a backslash are refused
function shimArgs(file, args) {
  for (const a of [file, ...args]) if (/["%\r\n]/.test(a) || (needsQuote(a) && a.endsWith('\\'))) throw new Error(`Cannot pass this to a .cmd program safely (quote, percent, newline, or a quoted arg ending in a backslash): ${a.slice(0, 40)}`);
  const q = a => needsQuote(a) ? `"${a}"` : a;
  return ['cmd.exe', ['/d', '/s', '/c', `"${[file, ...args].map(q).join(' ')}"`], { windowsVerbatimArguments: true }];
}

export function createApi({ cwd = process.cwd(), port = Number(process.env.CC_PORT ?? 4021), dryRun = process.env.CC_DRY_RUN === '1', maxMs = 120000 } = {}) {
  const at = p => path.resolve(cwd, String(p));
  const limit = Number.isFinite(+maxMs) && +maxMs > 0 ? +maxMs : 120000;
  const clampMs = ms => Math.min(Number.isFinite(+ms) && +ms > 0 ? +ms : 30000, limit);
  const base = `http://127.0.0.1:${port}`;

  const read = (p, { from, to } = {}) => {
    const t = fs.readFileSync(at(p), 'utf8');
    if (from == null && to == null) return t;
    return t.split(/\r?\n/).slice(Math.max((from ?? 1) - 1, 0), to ?? undefined).join('\n');
  };
  const write = (p, text) => { const f = at(p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, String(text)); return { path: f, chars: String(text).length }; };
  const edit = (p, oldText, newText) => {
    const f = at(p), src = fs.readFileSync(f, 'utf8');
    let o = String(oldText), n = String(newText);
    if (!o) throw new Error('edit: old text is empty');
    const crlf = src.includes('\r\n');
    if (crlf) n = n.replace(/\r?\n/g, '\r\n');
    let parts = src.split(o);
    if (parts.length === 1 && crlf) { o = o.replace(/\r?\n/g, '\r\n'); parts = src.split(o); }
    if (parts.length === 1) throw new Error(`edit: text not found in ${p}`);
    if (parts.length > 2) throw new Error(`edit: text matches ${parts.length - 1} times in ${p}; add more context to make it unique`);
    fs.writeFileSync(f, parts.join(n));
    return { path: f, replaced: 1 };
  };
  const glob = (pattern, o = {}) => {
    const dir = o.cwd ? at(o.cwd) : cwd;
    return fs.globSync(pattern, { cwd: dir, exclude: n => SKIP.has(n) }).map(s => s.replace(/\\/g, '/')).sort().slice(0, o.max ?? 1000);
  };
  const ls = d => fs.readdirSync(at(d ?? '.'), { withFileTypes: true }).map(e => {
    let size = null; if (e.isFile()) try { size = fs.statSync(path.join(e.parentPath, e.name)).size; } catch {}
    return { name: e.name, type: e.isDirectory() ? 'dir' : 'file', size };
  });
  const grep = (regex, { path: p = '.', glob: g, max = 100 } = {}) => {
    const re = new RegExp(regex.source ?? regex, (regex.flags ?? '').replace(/[gy]/g, ''));
    const root = at(p), out = [];
    const files = fs.statSync(root).isFile() ? [root] : fs.globSync(g ?? '**/*', { cwd: root, exclude: n => SKIP.has(n) }).map(s => path.join(root, s));
    for (const f of files.sort()) {
      if (out.length >= max) break;
      let buf; try { const st = fs.statSync(f); if (!st.isFile() || st.size > 2 << 20) continue; buf = fs.readFileSync(f); } catch { continue; }
      if (buf.subarray(0, 4096).includes(0)) continue;
      const lines = buf.toString('utf8').split(/\r?\n/);
      for (let i = 0; i < lines.length && out.length < max; i++) if (re.test(lines[i])) out.push({ file: path.relative(cwd, f).replace(/\\/g, '/'), line: i + 1, text: lines[i].trim().slice(0, 300) });
    }
    return out;
  };

  const run = (cmd, args = [], o = {}) => {
    let file = resolveWin(String(cmd)), a = args.map(String), opt = { windowsVerbatimArguments: false };
    if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(file)) [file, a, opt] = shimArgs(file, a);
    const r = spawnSync(file, a, { ...opt, cwd: o.cwd ? at(o.cwd) : cwd, input: o.input, encoding: 'utf8', timeout: clampMs(o.timeout), maxBuffer: 64 << 20, windowsHide: true, shell: false });
    if (r.error) throw new Error(`${r.error.code === 'ETIMEDOUT' ? 'timed out' : r.error.message}: ${cmd}`);
    return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };
  const git = (...args) => {
    const o = args[0] && typeof args[0] === 'object' ? args.shift() : {};
    const r = run('git', args, o);
    if (r.code !== 0) throw new Error(`git ${args.join(' ')} failed (${r.code}): ${r.stderr.trim()}`);
    return r.stdout.trimEnd();
  };

  const target = u => { const url = new URL(u, base); if (url.origin !== base) throw new Error(`fetchJson only talks to ${base}`); return url; };
  async function call(method, u, body, extra) {
    const url = target(u), headers = { Origin: POST_ORIGIN, ...extra };
    if (method === 'POST' && dryRun) return { dryRun: true, method, url: url.href, headers, body };
    const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(15000) });
    const text = await res.text();
    let v = text; try { v = JSON.parse(text); } catch {}
    if (!res.ok) throw new Error(`${method} ${url.pathname} gave ${res.status}: ${String(typeof v === 'string' ? v : v?.error ?? text).slice(0, 200)}`);
    return v;
  }
  const fetchJson = u => call('GET', u);

  const panel = {
    tasks: async () => (await call('GET', '/tasks')).tasks.map(({ text, ...t }) => t),
    taskLog: async (id, { tail = 4000 } = {}) => { const r = await call('GET', `/task-log?id=${encodeURIComponent(id)}`); return { task: r.task, log: r.log.slice(-tail), report: r.report.slice(-tail) }; },
    addTask: ({ title, prompt, provider, model, cwd: c, parent, kind } = {}) => {
      if (!String(prompt ?? '').trim()) throw new Error('addTask: prompt is empty');
      return call('POST', '/tasks', JSON.stringify({ title, text: prompt, prompt, provider, model, cwd: c, parent, kind }), { 'content-type': 'application/json' });
    },
    board: async (text, from = 'agent') => {
      if (text == null) return call('GET', '/board?json');
      return call('POST', `/board?from=${encodeURIComponent(String(from).slice(0, 60))}`, String(text), { 'content-type': 'text/plain' });
    },
    budget: async () => {
      const get = p => call('GET', p).catch(e => ({ error: e.message }));
      const [budget, route, models] = await Promise.all([get('/budget'), get('/usage?p=route'), get('/models')]);
      return { budget: budget.error?.includes('404') ? null : budget, route, models: models.error?.includes('404') ? null : models };
    },
  };

  return { read, write, edit, glob, grep, ls, git, run, fetchJson, panel };
}

export function format(v, logs = []) {
  const body = v === undefined ? '(no return value)' : typeof v === 'string' ? v : JSON.stringify(v, null, 1) ?? String(v);
  return cap(logs.length ? `${logs.join('\n')}\n--- result ---\n${body}` : body);
}

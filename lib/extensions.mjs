import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT, config } from './config.mjs';

export function envCtx() {
  const t = process.env.CC_EXT_HOME;
  if (t) return { home: t, root: path.join(t, 'cc-root'), project: path.join(t, 'project'), test: true };
  return { home: os.homedir(), root: ROOT, project: config().projectDir || '', test: false };
}

const sha = s => createHash('sha1').update(s).digest('hex').slice(0, 16);
const rd = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
const parseJson = t => { try { return JSON.parse(t.replace(/^﻿/, '')); } catch { return undefined; } };
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const fail = (status, message) => Object.assign(new Error(message), { status });
const short = (s, n) => (s = String(s ?? '').replace(/\s+/g, ' ').trim(), s.length > n ? s.slice(0, n - 1) + '…' : s);
const safeUrl = s => { try { const u = new URL(String(s)); return `${u.protocol}//${u.host}`; } catch { return 'a remote address'; } };
const safe = s => {
  const w = String(s ?? '').trim().split(/\s+/).filter(x => x && !/^\w+=/.test(x)).map(x => x.replace(/["']/g, ''));
  if (!w.length) return '';
  if (/^\w+:\/\//.test(w[0])) return safeUrl(w[0]);
  const base = x => x.split(/[\\/]/).pop(), scr = w.slice(1).find(x => /\.(?:mjs|cjs|js|ts|py|ps1|sh|cmd|bat)$/i.test(x));
  return short(scr ? `${base(w[0])} ${base(scr)}` : base(w[0]), 80);
};
const hookWhat = h => h.command ? safe(h.command) : h.url ? safeUrl(h.url) : h.prompt ? short(h.prompt, 80) : h.type;
const pretty = (c, f) => { let p = f.replace(/\\/g, '/'); const h = c.home.replace(/\\/g, '/'), pr = (c.project || '').replace(/\\/g, '/'); if (pr && p.startsWith(pr + '/')) return '<project>' + p.slice(pr.length); return p.startsWith(h + '/') ? '~' + p.slice(h.length) : p; };

function fmtOf(t) {
  const bom = t.startsWith('﻿'), b = bom ? t.slice(1) : t, eol = b.includes('\r\n') ? '\r\n' : '\n';
  const m = /\r?\n([ \t]+)\S/.exec(b);
  return { bom, eol, indent: m ? m[1] : 2, tail: b.endsWith(eol) };
}
function ser(o, f) {
  let s = JSON.stringify(o, null, f.indent);
  if (f.eol !== '\n') s = s.replace(/\n/g, f.eol);
  return (f.bom ? '﻿' : '') + s + (f.tail ? f.eol : '');
}
function insertAt(obj, idx, key, val) {
  const e = Object.entries(obj);
  e.splice(Math.min(idx, e.length), 0, [key, val]);
  for (const k of Object.keys(obj)) delete obj[k];
  for (const [k, v] of e) obj[k] = v;
}
const getPath = (o, p) => p.reduce((x, k) => (isObj(x) ? x[k] : undefined), o);
function ensurePath(o, p) { let x = o; for (const k of p) { if (!isObj(x[k])) x[k] = {}; x = x[k]; } return x; }

function stripJsonc(t) {
  let out = '', i = 0, str = false;
  while (i < t.length) {
    const ch = t[i], two = t.slice(i, i + 2);
    if (str) { out += ch; if (ch === '\\') { out += t[i + 1] ?? ''; i += 2; continue; } if (ch === '"') str = false; i++; continue; }
    if (ch === '"') { str = true; out += ch; i++; } else if (two === '//') { while (i < t.length && t[i] !== '\n') i++; } else if (two === '/*') { i = t.indexOf('*/', i + 2); i = i < 0 ? t.length : i + 2; } else { out += ch; i++; }
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

const EV = {
  PreToolUse: 'Before a tool runs', PostToolUse: 'After a tool runs', Stop: 'When Claude finishes a reply', SubagentStop: 'When a helper agent finishes',
  SessionStart: 'When a session starts', SessionEnd: 'When a session ends', UserPromptSubmit: 'When you send a message', Notification: 'When Claude shows a notice',
  PreCompact: 'Before the chat is shortened', PostToolUseFailure: 'After a tool fails', PermissionRequest: 'When Claude asks permission',
};
function hookName(h) {
  const cmd = String(h.command ?? ''), first = cmd.trim().split(/\s+/)[0].replace(/["']/g, '');
  if (/^\w+:\/\//.test(first)) return safeUrl(first);
  let b = /([\w.-]+)\.(?:mjs|js|cjs|ps1|py|sh|cmd|exe)\b/i.exec(cmd)?.[1] ?? (cmd ? path.basename(cmd.trim().split(/\s+/)[0].replace(/["']/g, '')) : h.type === 'prompt' ? 'prompt check' : h.type === 'agent' ? 'agent check' : h.type || 'hook');
  b = b.replace(/[-_.]+/g, ' ').trim();
  return b.charAt(0).toUpperCase() + b.slice(1);
}
function hookRow(c, file, rev, ev, h, matcher, extra) {
  const what = `${EV[ev] ?? ev}${matcher ? ` (for ${short(matcher, 60)})` : ''}. Runs: ${hookWhat(h)}`;
  return { section: 'hooks', app: 'Claude Code', name: hookName(h), what, source: pretty(c, file), path: file, rev, ro: false, how: 'hook', ...extra };
}

function serverWhat(cfg) {
  if (!isObj(cfg)) return '';
  if (cfg.url) return `Remote server: ${safeUrl(cfg.url)}`;
  const cmd = Array.isArray(cfg.command) ? cfg.command : [cfg.command, ...(Array.isArray(cfg.args) ? cfg.args : [])];
  return `Runs: ${safe(cmd.filter(Boolean).join(' '))}`;
}

function tomlLines(t) { return t.match(/[^\n]*\n|[^\n]+$/g) ?? []; }
function bracketDelta(line, st) {
  let d = 0, i = 0;
  while (i < line.length) {
    if (st.ml) { const j = line.indexOf(st.ml, i); if (j < 0) return d; i = j + 3; st.ml = null; continue; }
    const ch = line[i];
    if (ch === '#') break;
    if (line.startsWith('"""', i) || line.startsWith("'''", i)) { st.ml = line.slice(i, i + 3); i += 3; continue; }
    if (ch === '"') { i++; while (i < line.length && line[i] !== '"') i += line[i] === '\\' ? 2 : 1; i++; continue; }
    if (ch === "'") { const j = line.indexOf("'", i + 1); i = j < 0 ? line.length : j + 1; continue; }
    if (ch === '[' || ch === '{') d++; else if (ch === ']' || ch === '}') d--;
    i++;
  }
  return d;
}
const SRV = /^\s*\[\s*mcp_servers\s*\.\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_-]+))\s*\]\s*(?:#.*)?\r?\n?$/;
const ENAB = /^(\s*enabled\s*=\s*)(true|false)([^\S\r\n]*(?:#.*?)?\r?\n?)$/;
export function tomlServers(text) {
  const lines = tomlLines(text), out = [], st = { ml: null };
  let depth = 0, cur = null;
  lines.forEach((ln, i) => {
    if (depth === 0 && !st.ml && /^\s*\[/.test(ln)) {
      const m = SRV.exec(ln);
      cur = m ? { name: m[1] ?? m[2] ?? m[3], header: i, enabledAt: -1, enabled: true, body: [] } : null;
      if (cur) out.push(cur);
    } else if (cur) {
      if (depth === 0 && !st.ml) { const e = ENAB.exec(ln); if (e) { cur.enabledAt = i; cur.enabled = e[2] === 'true'; } }
      cur.body.push(ln);
    }
    depth += bracketDelta(/^\s*\[/.test(ln) && depth === 0 ? '' : ln, st);
    if (depth < 0) depth = 0;
  });
  for (const s of out) {
    const b = s.body.join('');
    const cmd = /^\s*command\s*=\s*(?:'([^']*)'|"([^"]*)")/m.exec(b), url = /^\s*url\s*=\s*(?:'([^']*)'|"([^"]*)")/m.exec(b);
    const args = /^\s*args\s*=\s*\[([\s\S]*?)\]/m.exec(b)?.[1], list = args ? [...args.matchAll(/'([^']*)'|"([^"]*)"/g)].map(x => x[1] ?? x[2]) : [];
    s.cfg = url ? { url: url[1] ?? url[2] } : { command: [path.basename(String(cmd?.[1] ?? cmd?.[2] ?? '').replace(/\\/g, '/')), ...list] };
  }
  return { lines, servers: out };
}
function tomlSet(text, name, on, entries, id, file) {
  const { lines, servers } = tomlServers(text), s = servers.find(x => x.name === name);
  if (!s) throw fail(404, `Server ${name} is not in the file any more. Reload the page.`);
  let next = entries.filter(e => !(e.kind === 'flag' && e.id === id));
  if (!on) {
    if (s.enabledAt >= 0) lines[s.enabledAt] = lines[s.enabledAt].replace(ENAB, '$1false$3');
    else {
      const h = lines[s.header], eol = /\r\n$/.test(h) ? '\r\n' : '\n';
      lines[s.header] = /\n$/.test(h) ? h : h + eol;
      lines.splice(s.header + 1, 0, 'enabled = false' + eol);
      next.push({ kind: 'flag', id, file, added: true });
    }
  } else if (s.enabledAt >= 0) {
    if (entries.some(e => e.kind === 'flag' && e.id === id) && /^\s*enabled\s*=\s*false\s*\r?\n?$/.test(lines[s.enabledAt])) lines.splice(s.enabledAt, 1);
    else lines[s.enabledAt] = lines[s.enabledAt].replace(ENAB, '$1true$3');
  }
  return { text: lines.join(''), entries: next };
}

const readStash = c => {
  const f = path.join(c.root, 'disabled-extensions.json'), t = rd(f);
  if (t === null) return { file: f, text: null, entries: [], ok: true };
  const o = parseJson(t);
  return Array.isArray(o?.entries) ? { file: f, text: t, entries: o.entries, ok: true } : { file: f, text: t, entries: [], ok: false, error: 'The saved-extensions file does not parse.' };
};
function writeStash(c, entries) {
  const f = path.join(c.root, 'disabled-extensions.json');
  fs.mkdirSync(c.root, { recursive: true });
  const tmp = f + '.tmp' + process.pid, text = JSON.stringify({ version: 1, entries }, null, 2) + '\n';
  fs.writeFileSync(tmp, text); fs.renameSync(tmp, f);
  if (!Array.isArray(parseJson(rd(f) ?? '')?.entries)) throw fail(500, 'The saved-extensions file could not be written.');
}

function claudeFiles(c) {
  const out = [path.join(c.home, '.claude/settings.json'), path.join(c.home, '.claude/settings.local.json')];
  if (c.project) out.push(path.join(c.project, '.claude/settings.json'), path.join(c.project, '.claude/settings.local.json'));
  return out;
}

export function listAll(c = envCtx()) {
  const rows = [], files = [], stash = readStash(c), live = new Set(), texts = new Map();
  const load = f => {
    if (!texts.has(f)) {
      const t = rd(f), o = t === null ? null : parseJson(t);
      texts.set(f, { text: t, obj: o, rev: sha(t ?? '') });
      files.push({ path: f, pretty: pretty(c, f), exists: t !== null, ok: t === null ? null : isObj(o), error: t !== null && !isObj(o) ? 'Does not parse as JSON.' : '' });
    }
    return texts.get(f);
  };
  const add = r => { rows.push({ id: sha([r.how, r.path, JSON.stringify(r.scope ?? ''), r.name, r.loc ? JSON.stringify(r.loc) : "", r.key ?? "", r.what].join('|')), on: true, ...r }); };
  const addHooks = f => {
    const { obj, rev } = load(f);
    if (!isObj(obj?.hooks)) return;
    for (const [ev, groups] of Object.entries(obj.hooks)) if (Array.isArray(groups)) groups.forEach((g, gi) => (Array.isArray(g?.hooks) ? g.hooks : []).forEach((h, hi) => isObj(h) && add(hookRow(c, f, rev, ev, h, g.matcher, { loc: { ev, gi, hi }, name: hookName(h) }))));
  };
  const plugins = new Map();
  for (const f of claudeFiles(c)) {
    addHooks(f);
    const { obj, rev } = load(f);
    if (isObj(obj?.enabledPlugins)) for (const [k, v] of Object.entries(obj.enabledPlugins)) plugins.set(k, { file: f, rev, on: v === true });
  }

  const installed = parseJson(rd(path.join(c.home, '.claude/plugins/installed_plugins.json')) ?? '')?.plugins ?? {};
  const userSettings = path.join(c.home, '.claude/settings.json');
  for (const k of Object.keys(installed)) if (!plugins.has(k)) plugins.set(k, { file: userSettings, rev: load(userSettings).rev, on: false });
  for (const [k, p] of plugins) {
    const inst = Array.isArray(installed[k]) ? installed[k][0] : null, dir = inst?.installPath;
    const meta = dir ? parseJson(rd(path.join(dir, '.claude-plugin/plugin.json')) ?? '') : null;
    add({ section: 'plugins', app: 'Claude Code', how: 'plugin', name: k.split('@')[0], what: short(meta?.description || `Plugin ${k}${inst?.version ? ' version ' + inst.version : ''}`, 160), source: pretty(c, p.file), path: p.file, rev: p.rev, on: p.on, key: k, ro: false, note: inst ? '' : 'Not installed on this PC.' });
    if (!dir) continue;
    const ph = parseJson(rd(path.join(dir, 'hooks/hooks.json')) ?? '');
    for (const [ev, groups] of Object.entries(ph?.hooks ?? {})) for (const g of Array.isArray(groups) ? groups : []) for (const h of Array.isArray(g?.hooks) ? g.hooks : []) if (isObj(h))
      add({ section: 'hooks', app: 'Claude Code', how: 'pluginhook', name: hookName(h), what: `${EV[ev] ?? ev}${g.matcher ? ` (for ${short(g.matcher, 60)})` : ''}. Runs: ${hookWhat(h)}`, source: `plugin ${k.split('@')[0]}`, path: path.join(dir, 'hooks/hooks.json'), rev: '', on: p.on, ro: true, note: `Comes with plugin ${k.split('@')[0]}. Turn the plugin on or off instead.`, scope: k });
    const pm = parseJson(rd(path.join(dir, '.mcp.json')) ?? '') ?? parseJson(rd(path.join(dir, '.claude-plugin/plugin.json')) ?? '');
    const servers = isObj(pm?.mcpServers) ? pm.mcpServers : isObj(pm) && pm.mcpServers === undefined && !pm.name ? pm : {};
    for (const [n, cfg] of Object.entries(servers)) if (isObj(cfg)) add({ section: 'mcp', app: 'Claude Code (plugin)', how: 'pluginmcp', name: n, what: serverWhat(cfg), source: `plugin ${k.split('@')[0]}`, path: path.join(dir, '.mcp.json'), rev: '', on: p.on, ro: true, note: `Comes with plugin ${k.split('@')[0]}. Turn the plugin on or off instead.`, scope: k });
  }

  const addJsonMcp = (f, app, scope, label) => {
    const { obj, rev } = load(f), h = getPath(obj, scope);
    if (isObj(h)) for (const [n, cfg] of Object.entries(h)) add({ section: 'mcp', app: label ? `${app} (${label})` : app, how: 'mcp', name: n, what: serverWhat(cfg), source: pretty(c, f), path: f, rev, ro: false, scope });
  };
  const cj = path.join(c.home, '.claude.json');
  addJsonMcp(cj, 'Claude Code', ['mcpServers']);
  for (const p of Object.keys(load(cj).obj?.projects ?? {})) addJsonMcp(cj, 'Claude Code', ['projects', p, 'mcpServers'], `project ${path.basename(p)}`);
  if (c.project) addJsonMcp(path.join(c.project, '.mcp.json'), 'Claude Code', ['mcpServers'], 'this project');
  addJsonMcp(path.join(c.home, '.cursor/mcp.json'), 'Cursor', ['mcpServers']);
  if (c.project) addJsonMcp(path.join(c.project, '.cursor/mcp.json'), 'Cursor', ['mcpServers'], 'this project');

  const toml = path.join(c.home, '.codex/config.toml'), tt = rd(toml);
  files.push({ path: toml, pretty: pretty(c, toml), exists: tt !== null, ok: tt === null ? null : true, error: '' });
  if (tt !== null) for (const s of tomlServers(tt).servers) add({ section: 'mcp', app: 'Codex', how: 'toml', name: s.name, what: serverWhat(s.cfg), source: pretty(c, toml), path: toml, rev: sha(tt), on: s.enabled, ro: false });

  for (const nm of ['opencode.json', 'opencode.jsonc']) {
    const f = path.join(c.home, '.config/opencode', nm), t = rd(f);
    if (t === null) continue;
    const plain = parseJson(t), o = plain ?? parseJson(stripJsonc(t));
    files.push({ path: f, pretty: pretty(c, f), exists: true, ok: isObj(o), error: isObj(o) ? '' : 'Does not parse as JSON.' });
    if (isObj(o?.mcp)) for (const [n, cfg] of Object.entries(o.mcp)) add({ section: 'mcp', app: 'OpenCode', how: 'flag', name: n, what: serverWhat(cfg), source: pretty(c, f), path: f, rev: sha(t), on: cfg?.enabled !== false, ro: false, scope: ['mcp'], locked: plain === undefined ? 'This file has comments, so it cannot be changed safely. Edit it by hand.' : '' });
  }

  for (const r of rows) live.add(r.id);
  for (const e of stash.entries) {
    if (!isObj(e) || live.has(e.id) || typeof e.file !== 'string' || (e.kind === 'hook' ? !isObj(e.hook) : e.kind !== 'mcp')) continue;
    const t = rd(e.file), base = { id: e.id, on: false, path: e.file, rev: sha(t ?? ''), ro: false, source: pretty(c, e.file), stashed: true };
    if (e.kind === 'hook') rows.push({ ...hookRow(c, e.file, base.rev, e.event, e.hook, e.group?.matcher, {}), ...base, how: 'hook' });
    else rows.push({ ...base, section: 'mcp', app: e.app ?? 'Claude Code', how: 'mcp', name: e.name, what: serverWhat(e.cfg), scope: e.scope });
  }
  return { rows, files, stash, counts: { hooks: rows.filter(r => r.section === 'hooks').length, mcp: rows.filter(r => r.section === 'mcp').length, plugins: rows.filter(r => r.section === 'plugins').length } };
}

export const publicRow = ({ loc, scope, how, stashed, key, ...r }) => ({ ...r, stashed: !!stashed });

function backup(c, f, text) {
  const dir = path.join(c.root, 'backups'), prefix = `${path.basename(path.dirname(f)).replace(/^\./, '')}-${path.basename(f)}-${sha(path.resolve(f)).slice(0, 6)}`;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${prefix}.${new Date().toISOString().replace(/[:.]/g, '-')}`), text);
  const old = fs.readdirSync(dir).filter(n => n.startsWith(prefix + '.')).sort().slice(0, -10);
  for (const n of old) try { fs.unlinkSync(path.join(dir, n)); } catch {}
}
function safeWrite(c, file, text, rev, valid) {
  const cur = rd(file);
  if (sha(cur ?? '') !== rev) throw fail(409, 'That file changed since this page read it (a running CLI may have saved it). Reload the page and try again.');
  if (cur !== null) backup(c, file, cur);
  const tmp = file + '.cc-tmp' + process.pid;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, text); fs.renameSync(tmp, file);
  } finally { try { fs.unlinkSync(tmp); } catch {} }
  const back = rd(file);
  if (back !== text || !valid(back)) {
    if (cur !== null) fs.writeFileSync(file, cur);
    throw fail(500, 'The file did not read back correctly, so the old copy was put back.');
  }
}

function hookOff(o, row, entries) {
  const { ev, gi, hi } = row.loc, arr = o.hooks[ev], g = arr[gi], hook = g.hooks[hi];
  const e = { kind: 'hook', id: row.id, file: row.path, event: ev, gi, hi, ei: Object.keys(o.hooks).indexOf(ev), group: structuredClone(g), hook };
  g.hooks.splice(hi, 1);
  if (!g.hooks.length) { arr.splice(gi, 1); e.groupRemoved = true; if (!arr.length) { delete o.hooks[ev]; e.eventRemoved = true; } }
  return [...entries.filter(x => x.id !== row.id), e];
}
function hookOn(o, row, entries) {
  const e = entries.find(x => x.id === row.id && x.kind === 'hook');
  if (!e) throw fail(404, 'No saved copy of this hook was found.');
  if (!isObj(o.hooks)) o.hooks = {};
  let arr = o.hooks[e.event];
  if (!Array.isArray(arr)) { arr = []; insertAt(o.hooks, e.ei, e.event, arr); }
  const same = g => (g?.matcher ?? null) === (e.group?.matcher ?? null);
  const g = same(arr[e.gi]) ? arr[e.gi] : arr.find(same);
  if (e.groupRemoved || !g || !Array.isArray(g.hooks)) { const ng = structuredClone(e.group); ng.hooks = [e.hook]; arr.splice(Math.min(e.gi, arr.length), 0, ng); }
  else g.hooks.splice(Math.min(e.hi, g.hooks.length), 0, e.hook);
  return entries.filter(x => x !== e);
}
function mcpOff(o, row, entries) {
  const h = getPath(o, row.scope), idx = Object.keys(h).indexOf(row.name);
  const e = { kind: 'mcp', id: row.id, file: row.path, app: row.app, scope: row.scope, name: row.name, cfg: h[row.name], idx };
  delete h[row.name];
  return [...entries.filter(x => x.id !== row.id), e];
}
function mcpOn(o, row, entries) {
  const e = entries.find(x => x.id === row.id && x.kind === 'mcp');
  if (!e) throw fail(404, 'No saved copy of this server was found.');
  const h = ensurePath(o, e.scope);
  if (Object.hasOwn(h, e.name)) throw fail(409, `A server called ${e.name} already exists in that file.`);
  insertAt(h, e.idx, e.name, e.cfg);
  return entries.filter(x => x !== e);
}
function flagSet(o, row, on, entries) {
  const cfg = getPath(o, [...row.scope, row.name]);
  if (!isObj(cfg)) throw fail(404, 'That server is not in the file any more. Reload the page.');
  const mine = entries.find(x => x.kind === 'flag' && x.id === row.id);
  if (!on) { const had = Object.hasOwn(cfg, 'enabled'); cfg.enabled = false; return had ? entries : [...entries.filter(x => x !== mine), { kind: 'flag', id: row.id, file: row.path, added: true }]; }
  if (mine) delete cfg.enabled; else cfg.enabled = true;
  return entries.filter(x => x !== mine);
}

export function toggle(c, { id, on, rev, reformat }) {
  if (typeof id !== 'string' || typeof on !== 'boolean') throw fail(400, 'Bad request.');
  const row = listAll(c).rows.find(r => r.id === id);
  if (!row) throw fail(404, 'That item is not there any more. Reload the page.');
  if (row.ro) throw fail(400, row.note || 'This one cannot be switched here.');
  if (row.locked) throw fail(400, row.locked);
  if (row.on === on) return { ok: true, note: 'Already in that state.' };
  if (rev !== row.rev) throw fail(409, 'That file changed since this page read it. Reload the page and try again.');
  const stash = readStash(c);
  if (!stash.ok) throw fail(500, stash.error);
  const text = rd(row.path);
  let next, entries = stash.entries;

  if (row.how === 'toml') {
    const r = tomlSet(text, row.name, on, entries, row.id, row.path);
    next = r.text; entries = r.entries;
  } else {
    if (text === null) throw fail(404, 'The file is gone. Reload the page.');
    const o = parseJson(text), f = fmtOf(text);
    if (!isObj(o)) throw fail(500, 'The file does not parse, so it was left alone.');
    if (ser(o, f) !== text && !reformat) throw fail(422, 'This file has hand-formatted parts. Changing it would reformat it (a backup is kept). Confirm to go ahead.');
    if (row.how === 'hook') entries = on ? hookOn(o, row, entries) : hookOff(o, row, entries);
    else if (row.how === 'mcp') entries = on ? mcpOn(o, row, entries) : mcpOff(o, row, entries);
    else if (row.how === 'flag') entries = flagSet(o, row, on, entries);
    else if (row.how === 'plugin') { if (!isObj(o.enabledPlugins)) o.enabledPlugins = {}; o.enabledPlugins[row.key] = on; }
    else throw fail(400, 'Unknown kind.');
    next = ser(o, f);
  }
  const valid = row.how === 'toml' ? () => true : t => isObj(parseJson(t));
  if (!on && row.how !== 'plugin') {
    writeStash(c, entries);
    try { safeWrite(c, row.path, next, row.rev, valid); } catch (e) { try { writeStash(c, stash.entries); } catch {} throw e; }
  } else {
    safeWrite(c, row.path, next, row.rev, valid);
    if (row.how !== 'plugin') try { writeStash(c, entries); } catch (e) { return { ok: true, note: 'Done, but the saved copy could not be cleaned up: ' + e.message }; }
  }
  return { ok: true, note: 'Done. Restart the CLI for this to apply.' };
}

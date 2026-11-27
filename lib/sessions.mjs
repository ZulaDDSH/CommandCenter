import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { newestFiles } from '../usage/providers.mjs';
import { decorate, decorateOne, moveToTrash } from './session-meta.mjs';

const HOME = os.homedir();
const clip = (s, n) => (s = String(s ?? ''), s.length > n ? s.slice(0, n) + `\n… ${s.length - n} more chars` : s);
const jsonOr = (s, d = null) => { try { return JSON.parse(s); } catch { return d; } };
const textOf = c => typeof c === 'string' ? c : Array.isArray(c) ? c.map(x => x?.text ?? (typeof x === 'string' ? x : '')).filter(Boolean).join('\n') : c == null ? '' : JSON.stringify(c);
const stateOf = (mtime, finished) => finished ? 'done' : Date.now() - mtime < 120000 ? 'working' : 'idle';
const NOISE = /^(# AGENTS\.md|<environment_context>|<user_instructions>|<permissions|<user_info>|<system)/;

const CODEX = path.join(HOME, '.codex/sessions');
function codexNames() {
  const names = new Map();
  try { for (const l of fs.readFileSync(path.join(HOME, '.codex/session_index.jsonl'), 'utf8').split('\n')) { const o = jsonOr(l); if (o?.id) names.set(o.id, o.thread_name); } } catch {}
  return names;
}
function codexParse(file, names, full) {
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => jsonOr(l)).filter(Boolean);
  const meta = lines[0]?.payload ?? {}, id = path.basename(file, '.jsonl').slice(-36);
  const spawn = meta.source?.subagent?.thread_spawn;
  let title = names.get(id) ?? (spawn ? `${meta.agent_nickname ?? 'subagent'}: ${String(meta.agent_path ?? spawn.agent_path ?? '').split('/').filter(Boolean).pop() ?? ''}` : '');
  const steps = [], calls = new Map();
  let finished = false, model = '';
  for (const o of lines) {
    const p = o.payload ?? {};
    if (o.type === 'turn_context' && p.model) model = String(p.model);
    if (o.type === 'event_msg' && p.type === 'task_started') finished = false;
    if (o.type === 'event_msg' && p.type === 'task_complete') finished = true;
    if (o.type === 'event_msg' && p.type === 'user_message' && !title) title = String(p.message ?? '').trim().split('\n')[0];
    if (!full || o.type !== 'response_item') continue;
    if (p.type === 'message' && p.role === 'user') { const t = textOf(p.content).trim(); if (t && !NOISE.test(t)) steps.push({ k: 'user', text: clip(t, 8000) }); }
    else if (p.type === 'agent_message') { const t = textOf(p.content).trim(); if (t) steps.push({ k: 'user', text: clip(`${p.author ?? ''} → ${p.recipient ?? ''}\n${t}`, 8000) }); }
    else if (p.type === 'message' && p.role === 'assistant') { const t = textOf(p.content).trim(); if (t) steps.push({ k: 'text', text: t }); }
    else if (p.type === 'function_call' || p.type === 'custom_tool_call') {
      const step = { k: 'tool', name: p.name ?? 'tool', input: clip(p.encrypted_content && /^gAAAA/.test(String(p.arguments)) ? '(encrypted)' : p.input ?? p.arguments ?? '', 600), output: '' };
      calls.set(p.call_id, step); steps.push(step);
    } else if (p.type === 'function_call_output' || p.type === 'custom_tool_call_output') {
      const s = calls.get(p.call_id); if (s) s.output = clip(textOf(p.output), 6000);
    }
  }
  const mtime = fs.statSync(file).mtimeMs;
  return { provider: 'codex', id, title: String(title || id.slice(0, 8)).slice(0, 140), cwd: meta.cwd ?? '', started: meta.timestamp ?? null, model, mtime, state: stateOf(mtime, finished), steps };
}
export function codexList(n = 25) {
  const names = codexNames();
  return newestFiles(CODEX, /^rollout-.*\.jsonl$/, n).map(f => { try { const { steps, ...s } = codexParse(f.p, names, false); return s; } catch { return null; } }).filter(Boolean);
}
export function codexSession(id) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const f = newestFiles(CODEX, new RegExp(`^rollout-.*-${id}\\.jsonl$`), 1)[0];
  return f ? codexParse(f.p, codexNames(), true) : null;
}

const OPENCODE_DB = path.join(HOME, '.local/share/opencode/opencode.db');
const openDb = f => new DatabaseSync(f, { readOnly: true });
export function opencodeList(n = 25) {
  if (!fs.existsSync(OPENCODE_DB)) return [];
  const db = openDb(OPENCODE_DB);
  try {
    return db.prepare('select id, title, directory, time_created, time_updated, parent_id from session where time_archived is null order by time_updated desc limit ?').all(n).map(r => {
      const last = db.prepare('select data from message where session_id = ? order by time_created desc limit 1').get(r.id);
      const d = jsonOr(last?.data, {});
      const finished = d.role !== 'assistant' ? false : !!d.time?.completed;
      return { provider: 'opencode', id: r.id, title: r.title, cwd: r.directory, started: new Date(r.time_created).toISOString(), model: String(d.modelID ?? d.model?.modelID ?? ''), mtime: r.time_updated, state: stateOf(r.time_updated, finished), sub: !!r.parent_id };
    });
  } finally { db.close(); }
}
export function opencodeSession(id) {
  if (!/^ses_\w+$/.test(id) || !fs.existsSync(OPENCODE_DB)) return null;
  const db = openDb(OPENCODE_DB);
  try {
    const s = opencodeList(200).find(x => x.id === id);
    if (!s) return null;
    const roles = new Map(db.prepare('select id, data from message where session_id = ?').all(id).map(m => [m.id, jsonOr(m.data, {}).role]));
    const steps = [];
    for (const p of db.prepare('select message_id, data from part where session_id = ? order by time_created, id').all(id)) {
      const d = jsonOr(p.data, {}), role = roles.get(p.message_id);
      if (d.type === 'text' && d.text?.trim() && !d.synthetic) steps.push({ k: role === 'user' ? 'user' : 'text', text: role === 'user' ? clip(d.text, 8000) : d.text });
      else if (d.type === 'tool') steps.push({ k: 'tool', name: d.tool ?? 'tool', input: clip(d.state?.title || JSON.stringify(d.state?.input ?? {}), 600), output: clip(d.state?.output ?? d.state?.error ?? (d.state?.status === 'running' ? '' : d.state?.status ?? ''), 6000) });
    }
    return { ...s, steps };
  } finally { db.close(); }
}

const CURSOR = path.join(HOME, '.cursor/chats');
function cursorDbs() {
  const out = [];
  try {
    for (const a of fs.readdirSync(CURSOR)) for (const b of fs.readdirSync(path.join(CURSOR, a))) {
      const f = path.join(CURSOR, a, b, 'store.db');
      if (!fs.existsSync(f)) continue;
      const mtime = Math.max(...[f, f + '-wal'].map(x => { try { return fs.statSync(x).mtimeMs; } catch { return 0; } }));
      out.push({ f, id: b, mtime });
    }
  } catch {}
  return out.sort((x, y) => y.mtime - x.mtime);
}
function cursorRead(entry, full) {
  const db = openDb(entry.f);
  try {
    const metaHex = db.prepare("select value from meta where key = '0'").get()?.value ?? '';
    const meta = jsonOr(Buffer.from(metaHex, 'hex').toString('utf8'), {});
    let cwd = '';
    const steps = [], calls = new Map();
    for (const r of db.prepare('select data from blobs order by rowid').all()) {
      const m = jsonOr(Buffer.from(r.data).toString('utf8'));
      if (!m?.role) continue;
      const parts = Array.isArray(m.content) ? m.content : [{ type: 'text', text: textOf(m.content) }];
      for (const c of parts) {
        if (m.role === 'user' && c.type === 'text') {
          cwd ||= c.text.match(/Workspace Path: (.+)/)?.[1]?.trim() ?? '';
          const q = c.text.match(/<user_query>\s*([\s\S]*?)\s*<\/user_query>/)?.[1];
          if (q && full) steps.push({ k: 'user', text: clip(q, 8000) });
        } else if (!full) continue;
        else if (m.role === 'assistant' && c.type === 'text' && c.text?.trim()) steps.push({ k: 'text', text: c.text });
        else if (m.role === 'assistant' && c.type === 'tool-call') { const s = { k: 'tool', name: c.toolName, input: clip(JSON.stringify(c.args ?? {}), 600), output: '' }; calls.set(c.toolCallId, s); steps.push(s); }
        else if (m.role === 'tool' && c.type === 'tool-result') { const s = calls.get(c.toolCallId); if (s) s.output = clip(textOf(c.result), 6000); }
      }
    }
    return { provider: 'cursor', id: entry.id, title: meta.name || entry.id.slice(0, 8), cwd, started: meta.createdAt ? new Date(meta.createdAt).toISOString() : null, model: meta.lastUsedModel && meta.lastUsedModel !== 'default' ? String(meta.lastUsedModel) : '', mtime: entry.mtime, state: stateOf(entry.mtime, false), steps: full ? steps : undefined };
  } finally { db.close(); }
}
export function cursorList(n = 25) {
  return cursorDbs().slice(0, n).map(e => { try { return cursorRead(e, false); } catch { return null; } }).filter(Boolean);
}
export function cursorSession(id) {
  const e = cursorDbs().find(x => x.id === id);
  return e ? cursorRead(e, true) : null;
}

const CLAUDE = path.join(process.env.CC_EXT_HOME || HOME, '.claude/projects');
const CLAUDE_NOISE = /^(<system-reminder|<local-command|<user-prompt-submit-hook|<command-message|Caveat:|\[Request interrupted)/;
const HEAD = 1 << 20, TAIL = 16 << 20;
function readRange(file, start, len) {
  const fd = fs.openSync(file, 'r');
  try { const b = Buffer.alloc(len); const n = fs.readSync(fd, b, 0, len, start); return b.toString('utf8', 0, n); } finally { fs.closeSync(fd); }
}
const jsonLines = s => s.split('\n').map(l => (l.length > 2 && l[0] === '{' ? jsonOr(l) : null)).filter(Boolean);
function claudeFiles() {
  const out = [];
  try {
    for (const d of fs.readdirSync(CLAUDE, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const dir = path.join(CLAUDE, d.name);
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.jsonl')) continue;
        try { const st = fs.statSync(path.join(dir, f)); out.push({ f: path.join(dir, f), id: f.slice(0, -6), mtime: st.mtimeMs, size: st.size, dir: d.name }); } catch {}
      }
    }
  } catch {}
  return out.sort((a, b) => b.mtime - a.mtime);
}
const claudeState = mtime => { const age = Date.now() - mtime; return age < 120000 ? 'working' : age < 6 * 3600000 ? 'idle' : 'done'; };
function claudeUserText(c) {
  const t = (typeof c === 'string' ? c : c?.type === 'text' ? c.text : '') ?? '';
  const cmd = /<command-name>\s*([^<]*?)\s*<\/command-name>(?:[\s\S]*?<command-args>([\s\S]*?)<\/command-args>)?/.exec(t);
  const s = (cmd ? `${cmd[1]} ${cmd[2] ?? ''}` : t).trim();
  return !s || CLAUDE_NOISE.test(s) || NOISE.test(s) ? '' : s;
}
const claudeInput = i => {
  if (!i || typeof i !== 'object') return clip(i, 600);
  const v = i.command ?? i.file_path ?? i.pattern ?? i.url ?? i.query ?? i.description ?? i.prompt ?? i.path;
  return clip(typeof v === 'string' ? v : JSON.stringify(i), 600);
};
const claudeCache = new Map();
function claudeHead(e) {
  const key = e.f + e.mtime + e.size, hit = claudeCache.get(key);
  if (hit) return hit;
  let cwd = '', started = null, title = '', ai = '', model = '';
  try {
    for (const o of jsonLines(readRange(e.f, 0, Math.min(e.size, HEAD)))) {
      cwd ||= o.cwd ?? ''; started ||= o.timestamp ?? null;
      if (o.type === 'ai-title' && !ai) ai = o.aiTitle ?? '';
      if (!title && o.type === 'user' && !o.isMeta && !o.isSidechain) { const c = o.message?.content; title = claudeUserText(Array.isArray(c) ? c.find(x => x?.type === 'text' && claudeUserText(x)) : c).split('\n')[0]; }
      if (!model && o.type === 'assistant' && o.message?.model && o.message.model !== '<synthetic>') model = String(o.message.model);
      if (cwd && title && model) break;
    }
  } catch {}
  const r = { provider: 'claude', id: e.id, title: String(title || ai || e.id.slice(0, 8)).slice(0, 140), cwd, started, model, mtime: e.mtime, state: claudeState(e.mtime) };
  if (claudeCache.size > 1000) claudeCache.clear();
  claudeCache.set(key, r);
  return r;
}
export function claudeList(n = 25) {
  return claudeFiles().slice(0, n).map(e => ({ ...claudeHead(e), cwd: claudeHead(e).cwd || e.dir }));
}
function claudeSteps(lines, calls, sub) {
  const steps = [];
  let side = [];
  const flush = () => { if (side.length) { steps.push({ k: 'tool', name: 'subagent', input: side.length + ' steps', output: clip(side.join('\n'), 6000) }); side = []; } };
  for (const o of lines) {
    if (o.type !== 'user' && o.type !== 'assistant') continue;
    const parts = Array.isArray(o.message?.content) ? o.message.content : [{ type: 'text', text: o.message?.content }];
    if (o.isSidechain && !sub) { for (const c of parts) if (c?.type === 'text' && c.text?.trim()) side.push(clip(c.text.trim(), 300)); else if (c?.type === 'tool_use') side.push('> ' + c.name + ' ' + claudeInput(c.input)); continue; }
    flush();
    for (const c of parts) {
      if (o.type === 'user' && c?.type === 'tool_result') { const s = calls.get(c.tool_use_id); if (s) s.output = clip(textOf(c.content), 6000); }
      else if (o.type === 'user' && !o.isMeta) { const t = claudeUserText(c); if (t) steps.push({ k: 'user', text: clip(t, 8000) }); }
      else if (o.type === 'assistant' && c?.type === 'text' && c.text?.trim()) steps.push({ k: 'text', text: c.text });
      else if (o.type === 'assistant' && c?.type === 'tool_use') { const s = { k: 'tool', name: c.name ?? 'tool', input: claudeInput(c.input), output: '' }; calls.set(c.id, s); steps.push(s); }
    }
  }
  flush();
  return steps;
}
export function claudeSession(id) {
  if (!/^[\w-]{8,64}$/.test(id)) return null;
  const e = claudeFiles().find(x => x.id === id);
  if (!e) return null;
  const head = claudeHead(e), cut = e.size > TAIL;
  let text = readRange(e.f, cut ? e.size - TAIL : 0, Math.min(e.size, TAIL));
  if (cut) text = text.slice(text.indexOf('\n') + 1);
  const lines = jsonLines(text), calls = new Map(), steps = claudeSteps(lines, calls, false);
  if (cut) steps.unshift({ k: 'text', text: `Showing only the last ${TAIL >> 20} MB of this ${Math.round(e.size / 1048576)} MB session.` });
  const subDir = path.join(path.dirname(e.f), e.id, 'subagents');
  try {
    for (const f of fs.readdirSync(subDir).filter(f => f.endsWith('.meta.json')).map(f => { try { return [f, fs.statSync(path.join(subDir, f)).mtimeMs]; } catch { return null; } }).filter(Boolean).sort((a, b) => a[1] - b[1]).slice(-200).map(x => x[0])) {
      const meta = jsonOr(fs.readFileSync(path.join(subDir, f), 'utf8'), {}), step = calls.get(meta.toolUseId);
      const jl = path.join(subDir, f.replace('.meta.json', '.jsonl'));
      if (!step || !fs.existsSync(jl)) continue;
      const size = fs.statSync(jl).size, inner = claudeSteps(jsonLines(readRange(jl, Math.max(0, size - (2 << 20)), Math.min(size, 2 << 20))), new Map(), true);
      const txt = inner.map(s => s.k === 'tool' ? '> ' + s.name + ' ' + s.input : (s.k === 'user' ? 'prompt: ' : '') + s.text).join('\n');
      step.output = clip((step.output ? step.output + '\n\n' : '') + '--- helper agent steps ---\n' + txt, 6000);
    }
  } catch {}
  let model = '';
  for (let i = lines.length - 1; i >= 0 && !model; i--) if (lines[i].type === 'assistant' && lines[i].message?.model !== '<synthetic>') model = lines[i].message?.model ?? '';
  return { ...head, model: model || head.model, steps };
}

function opencodeInfo(id) {
  if (!/^ses_\w+$/.test(id) || !fs.existsSync(OPENCODE_DB)) return null;
  const db = openDb(OPENCODE_DB);
  try {
    const r = db.prepare('select time_updated from session where id = ?').get(id);
    if (!r) return null;
    const d = jsonOr(db.prepare('select data from message where session_id = ? order by time_created desc limit 1').get(id)?.data, {});
    return { state: stateOf(r.time_updated, d.role === 'assistant' && !!d.time?.completed) };
  } finally { db.close(); }
}
const idOk = id => /^[\w-]{8,64}$/.test(id);
export const removal = {
  codex: id => {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const f = newestFiles(CODEX, new RegExp(`^rollout-.*-${id}\\.jsonl$`), 1)[0];
    return f ? { state: codexParse(f.p, codexNames(), false).state, trash: { root: CODEX, paths: [f.p] } } : null;
  },
  claude: id => {
    const e = idOk(id) && claudeFiles().find(x => x.id === id);
    return e ? { state: claudeState(e.mtime), trash: { root: CLAUDE, paths: [e.f, path.join(path.dirname(e.f), e.id)] } } : null;
  },
  cursor: id => {
    const e = cursorDbs().find(x => x.id === id);
    return e ? { state: stateOf(e.mtime, false), trash: { root: CURSOR, paths: [path.dirname(e.f)] } } : null;
  },
  opencode: opencodeInfo,
};
export function trashSession(provider, trash) {
  for (const p of trash.paths) if (fs.existsSync(p)) moveToTrash(provider, trash.root, p);
}

const raw = { codex: codexList, opencode: opencodeList, cursor: cursorList, claude: claudeList };
const rawDetails = { codex: codexSession, opencode: opencodeSession, cursor: cursorSession, claude: claudeSession };
export const lists = Object.fromEntries(Object.entries(raw).map(([p, fn]) => [p, n => decorate(p, fn(n))]));
export const details = Object.fromEntries(Object.entries(rawDetails).map(([p, fn]) => [p, id => decorateOne(p, fn(id))]));

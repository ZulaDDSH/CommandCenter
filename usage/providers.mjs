import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBin, runCall, cursorCall } from './exec.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const run = (cmd, args, timeout = 60000) => runBin(cmd, args, timeout);

export async function freebuff() {
  const { err, out } = await run('powershell', ['-NoProfile', '-File', path.join(here, 'freebuff-usage.ps1'), '-json'], 30000);
  try { return JSON.parse(out); } catch { return { error: String(err?.message ?? out).slice(0, 200) }; }
}

export async function fbmodels() {
  const { err, out } = await run('powershell', ['-NoProfile', '-File', path.join(here, 'freebuff-usage.ps1'), '-models'], 30000);
  let m;
  try { m = JSON.parse(out); } catch { return { error: String(err?.message ?? out).slice(0, 200) }; }
  const byDigest = new Map(Object.keys(m.prices ?? {}).map(id => [modelDigest(id), id]));
  for (const r of m.rows) {
    const id = (r.digests ?? []).map(d => byDigest.get(d)).find(Boolean);
    if (id) Object.assign(r, { modelId: id, hours: m.prices[id] / 5, notice: m.priceNotices?.[id] ?? null });
    delete r.digests;
  }
  delete m.prices; delete m.priceNotices;
  return m;
}

export function modelDigest(id) {
  const s = `freebuff-legacy-model:${id}`;
  let a = 2166136261, b = 1523705862;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = Math.imul(a ^ c, 16777619) >>> 0; b = Math.imul(b ^ c, 1540483477) >>> 0; }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

export function newestFiles(dir, re, n) {
  const all = [];
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else if (re.test(e.name)) all.push({ p, m: fs.statSync(p).mtimeMs });
  } };
  try { walk(dir); } catch { return []; }
  return all.sort((a, b) => b.m - a.m).slice(0, n);
}

const CODEX_SESSIONS = path.join(os.homedir(), '.codex/sessions');
export async function codex() {
  const files = newestFiles(CODEX_SESSIONS, /^rollout-.*\.jsonl$/, 40);
  let limits = null, seenAt = null;
  for (const f of files) {
    const lines = fs.readFileSync(f.p, 'utf8').split('\n');
    for (let i = lines.length - 1; i >= 0 && !limits; i--) {
      if (!lines[i].includes('"rate_limits"')) continue;
      try {
        const o = JSON.parse(lines[i]);
        const find = v => v && typeof v === 'object' ? (v.rate_limits ?? Object.values(v).map(find).find(Boolean)) : null;
        limits = find(o); seenAt = o.timestamp ?? new Date(f.m).toISOString();
      } catch {}
    }
    if (limits) break;
  }
  const names = new Map();
  try { for (const l of fs.readFileSync(path.join(os.homedir(), '.codex/session_index.jsonl'), 'utf8').split('\n')) { try { const o = JSON.parse(l); names.set(o.id, o.thread_name); } catch {} } } catch {}
  const sessions = files.slice(0, 15).map(f => {
    let cwd = '', started = '', title = '';
    const id = path.basename(f.p, '.jsonl').slice(-36);
    try {
      const lines = fs.readFileSync(f.p, 'utf8').split('\n');
      const meta = JSON.parse(lines[0]); cwd = meta.payload?.cwd ?? ''; started = meta.payload?.timestamp ?? meta.timestamp;
      const p = meta.payload ?? {}, spawn = p.source?.subagent?.thread_spawn;
      title = names.get(id) ?? (spawn ? `${p.agent_nickname ?? 'subagent'}: ${String(p.agent_path ?? spawn.agent_path ?? '').split('/').filter(Boolean).pop() ?? ''}` + (names.get(spawn.parent_thread_id) ? ` (in "${names.get(spawn.parent_thread_id)}")` : '') : '');
      for (const l of lines) { if (title) break; if (!l.includes('"user_message"')) continue; try { title = JSON.parse(l).payload?.message?.trim().split('\n')[0] ?? ''; } catch {} }
    } catch {}
    return { id, title: title.slice(0, 120), cwd, started, mtime: f.m };
  });
  const win = w => w && { usedPercent: w.used_percent, windowMinutes: w.window_minutes, resetsAt: w.resets_at ? new Date(w.resets_at * 1000).toISOString() : null };
  return limits
    ? { plan: limits.plan_type, primary: win(limits.primary), secondary: win(limits.secondary), reached: limits.rate_limit_reached_type, seenAt, sessions }
    : { error: 'no rate_limits line in recent Codex sessions', sessions };
}

const OPENCODE = 'opencode';
function parseStats(text) {
  const num = label => text.match(new RegExp(`│${label}\\s+([^│]+?)\\s*│`))?.[1]?.trim() ?? null;
  return { sessions: num('Sessions'), cost: num('Total Cost'), input: num('Input'), output: num('Output') };
}
export async function opencode() {
  const [day, week] = await Promise.all([run(OPENCODE, ['stats', '--days', '1']), run(OPENCODE, ['stats', '--days', '7'])]);
  if (day.err && !day.out) return { error: String(day.err.message).slice(0, 200) };
  return { today: parseStats(day.out), week: parseStats(week.out), limits: 'OpenCode Go plan limits are not exposed locally' };
}

export async function cursor() {
  const { out: raw, err } = await runCall(() => cursorCall(['about']), 30000);
  const out = raw.replace(/\x1b\[[0-9;]*m/g, '');
  if (!out && err) return { error: String(err.message).slice(0, 200) };
  const email = out.match(/User Email\s+(.+)/)?.[1]?.trim() ?? '';
  const loggedIn = !!email && !/not logged in/i.test(email);
  return { loggedIn, version: out.match(/CLI Version\s+(\S+)/)?.[1] ?? null, note: loggedIn ? 'signed in; cursor-agent has no usage command' : 'not signed in: run cursor-agent login' };
}

export async function claude() {
  return { note: 'The Claude CLI has no usage readout. Paid plan: keep it for the hardest work.' };
}

export const all ={ freebuff, fbmodels, codex, opencode, cursor, claude };

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import crypto from 'node:crypto';
import { config, ROOT } from './config.mjs';
import { runtimeDir } from './setup.mjs';
import { binCall, childEnv, cursorCall, isInstalled } from '../usage/exec.mjs';
import { MODEL_RE, EFFORTS } from './models.mjs';
import { buildPrompt } from './orchestrator.mjs';
import { gate as directorGate } from './director.mjs';
import * as worktrees from './worktrees.mjs';
import { redact } from './machines.mjs';

const FILE = path.join(ROOT, 'tasks.json');
const OWNER = `${os.hostname()}:${process.pid}:${Math.random().toString(36).slice(2, 8)}`;
const LEASE_MS = 120000;
const newToken = () => crypto.randomBytes(9).toString('hex');
const leaseExpired = l => !l || !l.expiresAt || Date.parse(l.expiresAt) <= Date.now();
const DIR = path.join(ROOT, 'tasks');
const LOGS = path.join(ROOT, 'logs');
const MANICODE = path.join(os.homedir(), '.config/manicode');
const PROVIDERS = ['freebuff', 'codex', 'cursor', 'opencode', 'claude', 'antigravity'];
const OPT_IN = ['claude', 'antigravity'];
const KINDS = ['code', 'light', 'read'];
const READ_ENFORCED = ['codex', 'claude', 'cursor', 'opencode', 'antigravity'];
const READ_REFUSED = 'Freebuff cannot enforce a read-only task: it only gets the request in the prompt. Give it to Codex, Claude, Cursor, OpenCode or Antigravity, or make it a code task.';
const LIVE = ['waiting', 'starting', 'running'];
const MAX_DEPTH = 3, MAX_CHILDREN = 8, MAX_LIVE = 60, ORCH_MAX = 2, MAX_RESUMES = 5, GRACE = 60000, RESUME_HOURS = 2;
const AUTH_RE = /oauth (session|token)|(session|token) (has )?expired|not logged in|log ?in again|please (run )?\/?log ?in|sign ?in again|unauthori[sz]ed|authentication (is )?required|invalid (credentials|api key)/i;
const fwd = p => p.replace(/\\/g, '/');
const now = () => new Date().toISOString();

let tasks = [];
try { tasks = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}
let writing = false, dirty = false;

function touch() {
  if (!writing) throw new Error('the task store is written only inside a locked update');
  dirty = true;
}

function flush() {
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(tasks, null, 2));
  fs.renameSync(tmp, FILE);
}
const STORE_LOCK = path.join(ROOT, 'state', 'store.lock');
const pause = ms => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch {} };

function readStore() {
  try {
    const rows = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return Array.isArray(rows) ? rows : null;
  } catch { return null; }
}

function syncFromDisk() {
  const disk = readStore();
  if (!disk) return null;
  const live = new Map(tasks.map(t => [t.id, t]));
  tasks = disk.map(row => {
    const t = live.get(row.id);
    if (!t) return row;
    for (const k of Object.keys(t)) if (!(k in row)) delete t[k];
    return Object.assign(t, row);
  });
  return tasks;
}

function withStoreLock(fn) {
  fs.mkdirSync(path.dirname(STORE_LOCK), { recursive: true });
  const deadline = Date.now() + 10000;
  let held = false;
  try {
    for (;;) {
      try {
        const fd = fs.openSync(STORE_LOCK, 'wx');
        fs.writeSync(fd, `${process.pid} ${Date.now()}`);
        fs.closeSync(fd);
        held = true;
        break;
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
        let age = 0;
        try { age = Date.now() - fs.statSync(STORE_LOCK).mtimeMs; } catch { continue; }
        if (age > 30000) { try { fs.unlinkSync(STORE_LOCK); } catch {} continue; }
        if (Date.now() > deadline) throw Object.assign(new Error('another writer is holding the task store'), { code: 'store-busy' });
        pause(10 + Math.floor(Math.random() * 25));
      }
    }
    return fn();
  } finally {
    if (held) try { fs.unlinkSync(STORE_LOCK); } catch {}
  }
}

function update(fn) {
  if (writing) return fn(tasks);
  let out;
  withStoreLock(() => {
    syncFromDisk();
    writing = true;
    dirty = false;
    try {
      out = fn(tasks);
      if (dirty) flush();
    } finally {
      writing = false;
      dirty = false;
    }
  });
  return out;
}

function setFields(id, fields) {
  return update(list => {
    const t = list.find(x => x.id === id);
    if (!t) return false;
    let same = true;
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined) {
        if (k in t) { delete t[k]; same = false; }
      } else if (t[k] !== v) { t[k] = v; same = false; }
    }
    if (same) return false;
    touch();
    return t;
  });
}

function claim(t) {
  const prev = t.lease;
  const keep = prev && prev.owner === OWNER && prev.token && !leaseExpired(prev) ? prev.token : null;
  t.lease = { owner: OWNER, token: keep ?? newToken(), at: now(), ttl: LEASE_MS, expiresAt: new Date(Date.now() + LEASE_MS).toISOString() };
  t.heartbeatAt = now();
  return t.lease;
}

function holderGone(t) {
  const lease = t.lease;
  if (!lease || leaseExpired(lease)) return true;
  const [host, pid] = String(lease.owner ?? '').split(':');
  if (host !== os.hostname()) return false;
  const n = Number(pid);
  if (!n || n === process.pid) return true;
  try { process.kill(n, 0); return false; } catch { return true; }
}

const pidAlive = pid => { try { process.kill(Number(pid), 0); return true; } catch (e) { return e.code === 'EPERM'; } };

export function recoverAtBoot() {
  let n = 0;
  try {
    update(() => {
      for (const t of tasks) {
        if (t.status !== 'running' && t.status !== 'starting') continue;
        if (!holderGone(t)) continue;
        n++;
        claim(t);
        const canContinue = t.ranOn === 'freebuff' && t.conversationId && (t.resumes ?? 0) < MAX_RESUMES;
        if (canContinue) Object.assign(t, { status: 'waiting', reason: 'The panel restarted. It continues the same Freebuff chat when hours allow.', resume: { cliId: null, conversationId: t.conversationId, modelKey: null, model: t.model ?? null, why: 'the panel restarted', at: now() } });
        else {
          const orphan = t.pid && t.pid !== process.pid && pidAlive(t.pid);
          Object.assign(t, { status: 'interrupted', endedAt: now(), note: `The panel restarted while this task ran, so its progress is unknown.${orphan ? ` The agent process ${t.pid} is still running on this PC and may still be editing the folder; the panel did not start it again and cannot stop it. End it yourself first.` : ''} Check the folder, then press Resume.` });
          if (orphan) t.orphanPid = t.pid;
        }
      }
      if (n) touch();
    });
  } catch { return 0; }
  return n;
}

let hooks = { spawnDecision: () => ({ clis: [], max: 0 }), route: () => null, usage: () => null, models: async () => ({}) };
export const init = h => { hooks = { ...hooks, ...h }; };
export const state = { lastTick: 0, error: null, owner: OWNER, bootRecovered: 0 };

const children = new Map();
const clis = new Map();
let mgr = null, mgrError = null, fbStarting = false, approval = null, driverFail = null, promptEnv = {};

export function spawnApproval(kind, cli) {
  return approval && approval.kind === kind && (!cli || cli === approval.cli) && Date.now() < approval.until ? approval.decision : null;
}

export function pendingClis(livePids) {
  return [...clis.entries()].filter(([, c]) => !c.exited && Date.now() - c.startedAtMs < 90000 && !(c.pid && livePids.has(c.pid))).map(([id, c]) => ({ id, pid: c.pid ?? null, modelKey: c.modelKey ?? null }));
}

async function manager() {
  if (mgr) return mgr;
  const dir = runtimeDir();
  try { mgr = new (await import(pathToFileURL(path.join(dir, 'dist/src/pty.js')).href)).CliPtyManager(); mgrError = null; }
  catch (e) { mgrError = e.message; throw new Error(`Could not load the Freebuff driver from runtimeDir: ${e.message}`); }
  return mgr;
}

async function driverOk(reasons) {
  if (mgr) return true;
  if (driverFail && Date.now() - driverFail.at < 60000) { reasons.push(`Freebuff: ${driverFail.msg}`); return false; }
  try { await manager(); driverFail = null; return true; }
  catch (e) { driverFail = { at: Date.now(), msg: e.message }; reasons.push(`Freebuff: ${e.message}`); return false; }
}

export const list = () => tasks;
export const get = id => tasks.find(t => t.id === id);
export const reportFile = id => path.join(config().reportsDir, `${id}.md`);
export const taskFile = id => path.join(DIR, `${id}.md`);
export const logFile = id => path.join(LOGS, `${id}.log`);
const isLive = t => LIVE.includes(t.status);
const orch = () => { const c = config(), o = { mode: 'orchestrated', ...c.orchestrator }; if (o.mode !== 'orchestrated') return null; const ok = x => x !== 'antigravity' && c.providers?.[x] && (x === 'freebuff' || isInstalled(x)), p = PROVIDERS.includes(o.provider) && ok(o.provider) ? o.provider : ['claude', 'codex', 'opencode', 'cursor', 'freebuff'].find(ok); return p ? { ...o, provider: p, model: p === o.provider ? o.model : '', effort: p === o.provider ? o.effort : '' } : null; };
const teamCheck = (parent, provider, model) => {
  const team = config().team ?? [];
  if (!team.length || !parent || !orchestratorOf(parent)) return;
  if (!team.some(m => m.provider === provider && m.model === model)) throw new Error(`The person picked these models: ${team.map(m => `${m.provider} ${m.model}`).join(', ')}. Give this task one of them: a provider and its model.`);
};
const orchestratorOf = t => { for (let x = t, n = 0; x && n < 10; x = get(x.parent), n++) if (x.role === 'orchestrator') return x; return null; };

export function add(input) {
  const text = String(input.text ?? input.prompt ?? '').trim();
  if (!text) throw new Error('The task text is empty.');
  if (text.length > 50000) throw new Error('The task text is over 50000 characters.');
  const parent = input.parent ? get(String(input.parent)) : null;
  if (input.parent && !parent) throw new Error(`The parent task ${String(input.parent).slice(0, 40)} does not exist.`);
  if (parent && !isLive(parent)) throw new Error('The parent task has finished, so it cannot add sub-tasks.');
  const depth = parent ? (parent.depth ?? 0) + 1 : 0;
  if (depth > MAX_DEPTH) throw new Error(`Sub-tasks can go at most ${MAX_DEPTH} levels deep.`);
  if (parent && tasks.filter(x => x.parent === parent.id && isLive(x)).length >= MAX_CHILDREN) throw new Error(`This task already has ${MAX_CHILDREN} live sub-tasks. Wait for some to finish.`);
  if (tasks.filter(isLive).length >= MAX_LIVE) throw new Error(`There are already ${MAX_LIVE} live tasks. Wait for some to finish.`);
  let kind = KINDS.includes(input.kind) ? input.kind : 'code';
  let provider = PROVIDERS.includes(input.provider) ? input.provider : 'auto';
  if (kind === 'read' && provider === 'freebuff') throw new Error(READ_REFUSED);
  const model = String(input.model ?? '').trim();
  if (model && !MODEL_RE.test(model)) throw new Error('The model name has characters that are not allowed.');
  if (model && provider === 'auto') throw new Error('Pick a provider together with a model.');
  const cwd = String(input.cwd || parent?.cwd || config().projectDir || ROOT);
  if (!fs.existsSync(cwd)) throw new Error(`The folder ${cwd} does not exist.`);
  if (provider !== 'auto' && !config().providers[provider]) throw new Error(`${provider} is turned off in Setup.`);
  const id = `cc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const title = String(input.title || text.split('\n')[0]).trim().slice(0, 100);
  const deps = Array.isArray(input.dependsOn) ? [...new Set(input.dependsOn.map(String).filter(x => x !== id))].slice(0, 8) : [];
  for (const d of deps) if (!get(d)) throw new Error(`The task ${d} it depends on does not exist.`);
  const t = { id, title, text, kind, provider, cwd, status: 'waiting', createdAt: now(), reason: 'Waiting for the next check (every 5 seconds).' };
  if (deps.length) t.dependsOn = deps;
  if (input.goal) t.goal = String(input.goal).slice(0, 60);
  if (input.afterTask) t.afterTask = String(input.afterTask).slice(0, 60);
  t.priority = Number.isFinite(Number(input.priority)) ? Math.min(5, Math.max(1, Number(input.priority))) : 3;
  if (model) t.modelPref = model;
  const o = orch();
  if (!parent && !input.direct && provider === 'auto' && o) {
    if (!config().providers[o.provider]) throw new Error(`The orchestrator provider ${o.provider} is turned off in Setup.`);
    Object.assign(t, { role: 'orchestrator', kind: 'code', provider: o.provider });
    if (o.model) t.modelPref = o.model;
  }
  if (parent) {
    teamCheck(parent, provider, model);
    Object.assign(t, { parent: parent.id, depth });
    const boss = orchestratorOf(parent);
    if (o && boss && boss.id !== parent.id && isLive(boss)) Object.assign(t, { hold: boss.id, reason: `Waiting for the orchestrator (${boss.id}) to approve this sub-task.` });
  }
  update(list => { list.push(t); touch(); });
  return t;
}

export function approve(id, edits = {}) {
  const t = get(id);
  if (!t || t.status !== 'waiting' || !t.hold) return null;
  const e = edits ?? {}, next = {};
  if (e.title != null) next.title = String(e.title).trim().slice(0, 100) || t.title;
  const text = e.text ?? e.prompt;
  if (text != null) { const s = String(text).trim(); if (!s || s.length > 50000) throw new Error('The edited task text is empty or over 50000 characters.'); next.text = s; }
  if (e.kind != null) { if (!KINDS.includes(e.kind)) throw new Error('Unknown kind.'); next.kind = e.kind; }
  if (e.provider != null) {
    if (e.provider !== 'auto' && !PROVIDERS.includes(e.provider)) throw new Error('Unknown provider.');
    if (e.provider !== 'auto' && !config().providers[e.provider]) throw new Error(`${e.provider} is turned off in Setup.`);
    next.provider = e.provider;
  }
  let model;
  if (e.model != null) {
    model = String(e.model).trim();
    if (model && !MODEL_RE.test(model)) throw new Error('The model name has characters that are not allowed.');
    if (model && (next.provider ?? t.provider) === 'auto') throw new Error('Pick a provider together with a model.');
  }
  teamCheck(get(t.parent), next.provider ?? t.provider, model ?? t.modelPref ?? '');
  const out = update(list => {
    const row = list.find(x => x.id === id);
    if (!row || row.status !== 'waiting' || !row.hold) return false;
    Object.assign(row, next);
    if (model) row.modelPref = model; else if (model === '') delete row.modelPref;
    delete row.hold;
    row.approvedAt = now(); row.reason = 'Approved. Waiting for the next check (every 5 seconds).';
    touch();
    return row;
  });
  return out || null;
}

function release(t) {
  for (const c of clis.values()) if (c.taskId === t.id) c.taskId = null;
  const ch = children.get(t.id);
  if (ch) { killTree(ch.pid); children.delete(t.id); }
}
const killTree = pid => { if (!pid) return; if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(pid), '/t', '/f'], { windowsHide: true }); else try { process.kill(pid); } catch {} };

const refuse = (code, why, task) => ({ ok: false, code, why, task });

export function closeTask(id, status, note, proof = {}) {
  let out;
  try {
    out = update(() => {
      const t = tasks.find(x => x.id === id);
      if (!t) return refuse('not-found', `There is no task ${id}.`);
      if (!LIVE.includes(t.status)) return refuse('already-closed', `Task ${id} is already ${t.status}.`, t);
      const lease = t.lease;
      if (lease) {
        if (proof.token) {
          if (leaseExpired(lease)) return refuse('lease-expired', `Task ${id}: this writer's lease expired at ${lease.expiresAt ?? 'an unknown time'}, so its result was refused and nothing was changed.`, t);
          if (lease.token !== proof.token) return refuse('lease-lost', `Task ${id} was re-claimed by ${lease.owner} under a newer lease. This writer's result was refused and nothing was changed.`, t);
        } else if (proof.panel) {
          if (lease.owner !== OWNER) return refuse('lease-foreign', `Task ${id} is leased to ${lease.owner}. This panel did not start it, so it will not close it.`, t);
        } else {
          return refuse('lease-foreign', `Task ${id} is leased to ${lease.owner} and the caller presented no lease of its own.`, t);
        }
      } else if (proof.token) {
        return refuse('lease-lost', `Task ${id} holds no lease any more, so this writer's claim on it is gone. Nothing was changed.`, t);
      }
      Object.assign(t, { status, endedAt: now(), note: note ?? t.note, reason: undefined, expiresAt: undefined, hold: undefined, lease: undefined, heartbeatAt: undefined });
      release(t); touch();
      return { ok: true, task: t };
    });
  } catch (e) {
    return refuse('store-busy', `Task ${id} was not changed: ${String(e?.message ?? e)}. Try again.`);
  }
  return out;
}

function finish(t, status, note, proof) {
  return closeTask(t?.id, status, note, proof ?? (t?.lease?.owner === OWNER && t.lease.token ? { token: t.lease.token } : { panel: true }));
}

export function cancel(id, note, proof = { panel: true }) {
  const cli = [...clis.entries()].find(([, c]) => c.taskId === id);
  const r = closeTask(id, 'cancelled', note ?? 'Cancelled from the panel.', proof);
  if (!r.ok) return r;
  if (cli && mgr) try { mgr.stop(cli[0]); } catch {}
  for (const k of tasks.filter(x => x.parent === id && isLive(x))) cancel(k.id, 'Cancelled because its parent task was cancelled.', proof);
  return r;
}
export function markDone(id) { return closeTask(id, 'done', 'Marked done from the panel.', { panel: true }); }
export function resumeInterrupted(id, { force = false } = {}) {
  const out = update(list => {
    const t = list.find(x => x.id === id);
    if (!t || t.status !== 'interrupted') return false;
    if (t.orphanPid && !force && pidAlive(t.orphanPid)) return { orphanAlive: t.orphanPid };
    for (const k of ['endedAt', 'note', 'ranOn', 'cli', 'model', 'pid', 'exitCode', 'lease', 'heartbeatAt', 'orphanPid']) delete t[k];
    Object.assign(t, { status: 'waiting', reason: 'Resumed by you after an interruption. Waiting for the next check.', resume: { why: 'it was interrupted by a restart', at: now() } });
    touch();
    return t;
  });
  return out || null;
}
export function retry(id, { force = false } = {}) {
  const out = update(list => {
    const t = list.find(x => x.id === id);
    if (!t || !['failed', 'cancelled', 'done', 'interrupted'].includes(t.status)) return false;
    if (t.orphanPid && !force && pidAlive(t.orphanPid)) return { orphanAlive: t.orphanPid };
    for (const k of ['startedAt', 'endedAt', 'ranOn', 'note', 'cli', 'model', 'pid', 'resume', 'resumes', 'expiresAt', 'conversationId', 'orphanPid', 'needsLogin']) delete t[k];
    Object.assign(t, { status: 'waiting', reason: 'Waiting for the next check (every 5 seconds).' });
    touch();
    return t;
  });
  return out || null;
}

function modelFor(t, p) {
  if (t.modelPref && t.provider === p) return t.modelPref;
  return (orch() && t.role !== 'orchestrator' ? config().workerModels?.[p] : null) || null;
}

function writeTaskFile(t, provider) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.mkdirSync(config().reportsDir, { recursive: true });
  const c = config(), from = `${provider}-${t.id}`, port = process.env.PORT ?? 4021, rs = t.resume;
  const boss = orchestratorOf(t);
  const sub = (t.depth ?? 0) < MAX_DEPTH && t.role !== 'orchestrator' ? [
    `Sub-agents: if part of this work should go to another agent, you may add sub-tasks (at most ${MAX_CHILDREN} live under this task, ${MAX_DEPTH} levels deep). Your task id is ${t.id}.`,
    `Add one: node "${fwd(ROOT)}/tools/cc.mjs" task add --title "Name" --prompt-file job.md --parent ${t.id} [--provider P --model M --kind code|light|read]`,
    `${orch() && boss ? 'Your orchestrator must approve each one first; it stays waiting until then. ' : ''}Watch them: curl.exe -s "http://127.0.0.1:${port}/tasks?parent=${t.id}&brief=1". Their reports are ${fwd(c.reportsDir)}/<their id>.md.`, ''] : [];
  const body = t.role === 'orchestrator' ? buildPrompt(t, { tasks, usage: hooks.usage, models: promptEnv.models ?? {}, route: hooks.route() }) : [
    `# Task ${t.id}: ${t.title}`, '',
    t.kind === 'read' ? 'This is a read-only task: do not edit, create, commit or push any file except the report file below. If you cannot write files, your final answer is saved as the report.\n' : '',
    rs ? `Resuming: an earlier run of this task stopped (${rs.why}). Some of the work may already be done. Check the folder (for example git status) before you repeat anything, then finish the job.\n` : '',
    ...(t.worktree?.path ? [`Work folder: ${fwd(t.worktree.path)}${t.worktree.branch ? ` on branch ${t.worktree.branch}` : ''}. This is a worktree for this task alone. Never edit the repository's main checkout.`, ''] : []),
    t.text, '', '---', '',
    `When you finish, write a short report to ${fwd(reportFile(t.id))} : what you did, the files you changed, and anything left. The Command Center marks the task done when that file appears.`, '',
    ...sub,
    'Team board: other agents (Freebuff, Codex, Cursor, OpenCode, Claude) share notes there.',
    'Read it before you start: curl.exe -s http://127.0.0.1:4021/board',
    `Post what another agent needs (file maps, findings, blockers, a line when you finish): curl.exe -s -X POST "http://127.0.0.1:4021/board?from=${from}" --data-binary "your note"`,
    'Keep notes short and never post secrets.', '',
  ].join('\n');
  fs.writeFileSync(taskFile(t.id), body);
  return `Read and do the task in the file at: ${fwd(taskFile(t.id))} (the whole line after the colon is the path, spaces included)`;
}

const running = p => tasks.filter(t => (t.status === 'running' || t.status === 'starting') && t.ranOn === p && (p === 'antigravity' || t.role !== 'orchestrator')).length;

function candidates(t) {
  const c = config();
  if (t.provider !== 'auto') return [t.provider];
  const on = PROVIDERS.filter(p => !OPT_IN.includes(p) && c.providers[p]);
  let list;
  if (t.kind === 'read') list = on.filter(p => READ_ENFORCED.includes(p));
  else if (t.kind !== 'code') list = ['freebuff', ...on];
  else {
    const ranked = (hooks.route()?.ranked ?? []).map(x => x.provider).filter(p => on.includes(p));
    list = [...ranked, ...(on.includes('freebuff') ? ['freebuff'] : [])];
  }
  if (t.resume && on.includes('freebuff')) list.unshift('freebuff');
  return [...new Set(list)].filter(p => on.includes(p));
}

const hoursOk = d => d.cost === 0 || d.useLeft === 'unlimited' || (typeof d.useLeft === 'number' && d.useLeft >= RESUME_HOURS);

function freebuffPlan(t) {
  const rs = t.resume;
  const pref = rs?.modelKey || modelFor(t, 'freebuff') || undefined;
  let d = hooks.spawnDecision(t.kind, pref);
  if (rs && pref && !hoursOk(d)) d = hooks.spawnDecision(t.kind);
  const ok = hoursOk(d);
  const lead = rs ? `Ran out of time. Resumes when ${RESUME_HOURS} h of ${d.model ?? rs.model ?? 'its model'} are free (${d.useLeft ?? '?'} left now). ` : '';
  const idle = [...clis.entries()].filter(([, c]) => !c.taskId && !c.exited);
  const own = idle.find(([id]) => id === rs?.cliId) ?? idle.find(([, c]) => !d.modelKey || c.modelKey === d.modelKey) ?? idle[0];
  if (own && (!rs || ok)) return { reuse: own[0], d, cont: !!rs && own[0] === rs.cliId };
  if (fbStarting) return { wait: lead + 'Another Freebuff CLI is starting; one starts at a time.' };
  if (d.clis.length >= d.max) return { wait: `${lead}${d.clis.length} of ${d.max} Freebuff CLIs are running and none of the panel's own is free.` };
  if (!ok) return { wait: lead + (rs ? '' : d.useLeft == null ? 'Freebuff hours are not read yet.' : `Only ${d.useLeft} h of ${d.model} left.`) };
  return { spawn: true, d };
}

function worktreeFor(t) {
  const w = worktrees.prepare(t);
  if (!w) return null;
  if (!w.ok) {
    if (w.soft) { setFields(t.id, { worktreeNote: w.why }); return null; }
    throw new Error(`No worktree: ${w.why}`);
  }
  if (w.reused) return w.path;
  update(() => {
    Object.assign(t, { worktree: { path: w.path, branch: w.branch ?? null, at: now() }, cwd: w.path });
    delete t.worktreeNote;
    touch();
  });
  return w.path;
}

async function startFreebuff(t, plan) {
  worktreeFor(t);
  const rs = t.resume, pointer = writeTaskFile(t, 'freebuff'), tag = `[${t.kind}] `;
  const cont = () => `${tag}Your Freebuff hour ran out and you are resuming. Read the task file again (path, spaces included: '${fwd(taskFile(t.id))}') and carry on from where you stopped. If the report file already exists and is complete, do nothing.`;
  let id = plan.reuse;
  if (id) {
    clis.get(id).taskId = t.id;
    update(() => { claim(t); Object.assign(t, { status: 'running', ranOn: 'freebuff', startedAt: now(), cli: id, model: plan.d.model, reason: undefined, expiresAt: undefined }); touch(); });
    const m = await manager();
    if (t.status !== 'running') return;
    if (!plan.cont) { await m.send(id, '/new', t.cwd); if (t.status !== 'running') return; }
    await m.send(id, plan.cont ? cont() : `${tag}${pointer}`, t.cwd);
    update(() => { if (t.resume) { t.lastResumeAt = now(); delete t.resume; touch(); } });
    return;
  }
  id = `cc-fb-${Date.now().toString(36)}`;
  const useCont = rs?.conversationId && !(rs.cliId && clis.get(rs.cliId) && !clis.get(rs.cliId).exited);
  clis.set(id, { taskId: t.id, modelKey: plan.d.modelKey, exited: false, startedAtMs: Date.now() });
  update(() => { claim(t); Object.assign(t, { status: 'starting', ranOn: 'freebuff', startedAt: now(), cli: id, model: plan.d.model, reason: undefined, expiresAt: undefined }); touch(); });
  fbStarting = true;
  approval = { kind: t.kind, cli: id, until: Date.now() + 60000, decision: { ...plan.d, spawn: true, why: `Command Center task ${t.id} approved a new CLI.` } };
  try {
    const m = await manager();
    const snap = await m.send(id, useCont ? cont() : `${tag}${pointer}`, t.cwd, useCont ? rs.conversationId : undefined);
    const cli = clis.get(id);
    if (t.status !== 'starting') { try { m.sessions.get(id)?.term.kill(); } catch {} clis.delete(id); return; }
    if (cli) cli.pid = snap?.pid;
    update(() => {
      t.pid = snap?.pid; t.conversationId = snap?.conversationId ?? t.conversationId; t.status = 'running';
      if (t.resume) { t.lastResumeAt = now(); delete t.resume; }
      touch();
    });
  } catch (e) { clis.delete(id); throw e; }
  finally { fbStarting = false; if (approval?.cli === id) approval = null; }
}

function fbFail(t, e) {
  if (t.status === 'waiting') { finish(t, 'failed', `Freebuff could not take it: ${e.message}`); return; }
  if (!['starting', 'running'].includes(t.status)) return;
  if (/FREEBUFF_SPAWN_BLOCKED|FREEBUFF_CLI_ALREADY_RUNNING/.test(e.message)) {
    release(t);
    update(() => { Object.assign(t, { status: 'waiting', startedAt: undefined, reason: `Freebuff would not start another CLI yet: ${e.message.slice(0, 200)}` }); touch(); });
  } else finish(t, 'failed', `Freebuff could not take it: ${e.message}`);
}

function effortFor(t, p, model) {
  const c = config(), own = t.role === 'orchestrator' ? (c.orchestrator?.provider === p ? c.orchestrator.effort : '') : (c.team ?? []).find(m => m.provider === p && m.model === model)?.effort;
  return (EFFORTS[p] ?? []).includes(own) ? own : (p === 'codex' ? c.models.codexEffort : p === 'opencode' ? 'high' : '');
}

function childCall(t, p, pointer, model) {
  const c = config(), read = t.kind === 'read', rd = c.reportsDir, eff = effortFor(t, p, model);
  if (p === 'codex') return { call: binCall('codex', ['exec', '--cd', t.cwd, '-m', model, '-c', `model_reasoning_effort=${eff}`, '-s', read ? 'read-only' : 'workspace-write', ...(read ? [] : ['--add-dir', rd, '-c', 'sandbox_workspace_write.network_access=true']), '--skip-git-repo-check', '-']), stdin: pointer };
  if (p === 'opencode') return { call: binCall('opencode', ['run', '--dir', t.cwd, '-m', model, '--variant', eff, ...(read ? ['--agent', 'plan'] : []), '--title', `${t.id} ${t.title}`.replace(/[^\w .:-]/g, ' ').slice(0, 80), pointer]) };
  if (p === 'claude') return { call: binCall('claude', ['-p', '--model', model, ...(eff ? ['--effort', eff] : []), '--permission-mode', read ? 'plan' : 'acceptEdits', '--add-dir', rd, ...(read ? [] : ['--allowedTools', 'Bash', 'Edit', 'Write', 'Read', 'Glob', 'Grep']), '--output-format', 'text']), stdin: pointer };
  if (p === 'antigravity') return { call: binCall('agy', ['-p', pointer, '--model', model, '--output-format', 'text', ...(read ? ['--mode', 'plan'] : [])]) };
  return { call: cursorCall(['-p', '--trust', '--workspace', t.cwd, ...(read ? [] : ['--force']), '--model', model, '--output-format', 'text', pointer]) };
}

function failCause(id) {
  const line = readTail(logFile(id), 4000).split('\n').map(x => x.replace(/\x1b\[[0-9;]*m/g, '').trim()).filter(Boolean).reverse().find(x => /error|fail|denied|invalid|not found|unauthor|rejected|unsupported|quota|limit|expired|oauth|log ?in\b|sign ?in|authentication/i.test(x));
  return line ? ` Last error: ${redact(line).slice(0, 240)}` : ' Open the log for details.';
}

function startChild(t, p, override = null) {
  const c = config(), model = modelFor(t, p) || c.models[p], eff = effortFor(t, p, model);
  worktreeFor(t);
  const pointer = writeTaskFile(t, p);
  const { call, stdin = null } = override ? override() : childCall(t, p, pointer, model);
  fs.mkdirSync(LOGS, { recursive: true });
  const fd = fs.openSync(logFile(t.id), 'a');
  let child;
  try {
    fs.writeSync(fd, `[${now()}] ${call.cmd} ${call.args.map(a => a.includes(pointer) ? a.replace(pointer, '<prompt>') : a).join(' ')}\n`);
    child = spawn(call.cmd, call.args, { cwd: t.cwd, windowsHide: true, stdio: [stdin ? 'pipe' : 'ignore', fd, fd], ...call.opts, env: childEnv(call.opts?.env) });
  } finally { fs.closeSync(fd); }
  if (stdin) { child.stdin.on('error', () => {}); child.stdin.end(stdin); }
  children.set(t.id, child);
  update(() => { claim(t); Object.assign(t, { status: 'running', ranOn: p, startedAt: now(), pid: child.pid, model: eff ? `${model} (${eff})` : model, reason: undefined }); touch(); });
  child.on('error', e => { fs.appendFileSync(logFile(t.id), `\n[${now()}] could not start: ${e.message}\n`); finish(t, 'failed', `Could not start ${p}: ${e.message}`); });
  child.on('exit', code => {
    children.delete(t.id);
    if (typeof code === 'number') update(() => { const row = get(t.id); if (!row) return false; row.exitCode = code; touch(); return row; });
    if (t.status !== 'running') return;
    if (code === 0) {
      if (!hasReport(t)) { const tail = readTail(logFile(t.id), 6000); fs.writeFileSync(reportFile(t.id), `# ${t.id} (no report written; last output)\n\n${tail}`); }
      finish(t, 'done', `${p} finished.`);
    } else {
      const why = failCause(t.id), login = AUTH_RE.test(why);
      if (login) update(() => { const row = get(t.id); if (!row) return false; row.needsLogin = p; touch(); return row; });
      finish(t, 'failed', `${p} stopped with exit code ${code}.${why}${login ? ` Log in to ${p} again, then press Retry.` : ''}`);
    }
  });
}

export async function sendToDirector(id, text) {
  const t = get(id), c = t?.cli ? clis.get(t.cli) : null;
  if (!t || t.status !== 'running' || t.ranOn !== 'freebuff' || !c || c.exited) return { ok: false, why: 'The director is not a live Freebuff chat any more.' };
  try { await (await manager()).send(t.cli, text, t.cwd); return { ok: true }; } catch (e) { return { ok: false, why: `Freebuff would not take the text: ${String(e.message).slice(0, 200)}` }; }
}

export function amend(id, extra) {
  const t = get(id);
  if (!t || t.status !== 'waiting') return false;
  setFields(id, { text: `${t.text}\n\n${extra}`.slice(0, 50000) });
  return true;
}

export function startForCheck(id, provider = 'codex', override = null) {
  const t = get(id);
  if (!t) throw new Error(`unknown task ${id}`);
  startChild(t, provider, override);
  return get(id);
}

export function readTail(f, n) { try { const s = fs.readFileSync(f, 'utf8'); return s.length > n ? '…' + s.slice(-n) : s; } catch { return ''; } }
const hasReport = t => { try { const s = fs.statSync(reportFile(t.id)); return s.size > 0 && s.mtimeMs >= Date.parse(t.startedAt) - 1000; } catch { return false; } };

function liveFiles() {
  const m = new Map();
  try {
    for (const f of fs.readdirSync(MANICODE)) {
      const x = /^freebuff-live-(\d+)\.json$/.exec(f); if (!x) continue;
      try { const l = JSON.parse(fs.readFileSync(path.join(MANICODE, f), 'utf8')); m.set(Number(x[1]), { expiresAt: l.expiresAt, model: l.model }); } catch {}
    }
  } catch {}
  return m;
}

function requeueResume(t, cli, why) {
  if (t.status !== 'running') return;
  if ((t.resumes ?? 0) + 1 > MAX_RESUMES) return finish(t, 'failed', `Freebuff ran out of time ${MAX_RESUMES} times for this task. Press Retry to start it again.`);
  if (cli) { cli.taskId = null; cli.hadHour = false; cli.missingSince = null; }
  update(() => {
    const row = get(t.id);
    if (!row) return false;
    row.resumes = (row.resumes ?? 0) + 1;
    row.resume = { cliId: cli && !cli.exited ? row.cli : null, conversationId: row.conversationId ?? null, modelKey: cli?.modelKey ?? null, model: row.model ?? null, why, at: now() };
    Object.assign(row, { status: 'waiting', expiresAt: undefined, reason: `Ran out of time (${why}). Resumes when ${RESUME_HOURS} h of ${row.model ?? 'its model'} are free.` });
    touch();
    return row;
  });
}

export function heartbeat() {
  return update(() => {
  let changed = false;
  for (const t of tasks) {
    if (!LIVE.includes(t.status) || t.status === 'waiting') continue;
    const lease = t.lease;
    if (lease && lease.owner !== OWNER && !leaseExpired(lease)) continue;
    if (lease && lease.owner === OWNER && lease.token) {
      if (Date.now() - Date.parse(lease.at ?? 0) > 20000) {
        t.lease = { ...lease, at: now(), ttl: LEASE_MS, expiresAt: new Date(Date.now() + LEASE_MS).toISOString() };
        t.heartbeatAt = now();
        changed = true;
      }
      continue;
    }
    claim(t);
    changed = true;
  }
  if (changed) touch();
  return changed;
  });
}

let ticking = false;
export async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    heartbeat();
    const c = config(), live = liveFiles();
    for (const [id, cli] of clis) {
      const s = mgr?.sessions.get(id);
      if (s?.exited || (!s && !fbStarting)) {
        cli.exited = true; clis.delete(id);
        const t = cli.taskId && get(cli.taskId);
        if (t && t.status === 'running') {
          if (hasReport(t)) finish(t, 'done', 'Report written.');
          else if (cli.hadHour) requeueResume(t, cli, 'the Freebuff CLI closed');
          else finish(t, 'failed', 'The Freebuff CLI closed before the report was written.');
        } else if (t) finish(t, 'failed', 'The Freebuff CLI closed before the report was written.');
        continue;
      }
      if (s?.term?.pid) cli.pid = s.term.pid;
      const l = cli.pid ? live.get(cli.pid) : null;
      cli.liveNow = !!(l && l.expiresAt > Date.now());
      if (cli.liveNow) { cli.hadHour = true; cli.expiresAt = l.expiresAt; cli.missingSince = null; }
      else if (cli.hadHour) cli.missingSince ??= Date.now();
      const t = cli.taskId && get(cli.taskId);
      if (t && s?.conversationId && t.conversationId !== s.conversationId) setFields(t.id, { conversationId: s.conversationId });
    }
    for (const t of tasks) {
      if (t.status === 'waiting' && t.resume && hasReport(t)) { finish(t, 'done', 'Report written.'); continue; }
      if (t.status === 'waiting' && t.hold && !isLive(get(t.hold) ?? { status: 'done' })) { finish(t, 'cancelled', 'Its orchestrator finished before approving this sub-task.'); continue; }
      if (t.status !== 'running') continue;
      if (t.ranOn === 'freebuff') {
        if (hasReport(t)) { finish(t, 'done', 'Report written.'); continue; }
        const cli = clis.get(t.cli);
        if (cli) {
          setFields(t.id, { expiresAt: cli.liveNow ? new Date(cli.expiresAt).toISOString() : undefined });
          if (cli.hadHour && cli.missingSince && Date.now() - cli.missingSince > GRACE) { requeueResume(t, cli, 'its Freebuff hour ended'); continue; }
        }
      }
      if (Date.now() - Date.parse(t.startedAt) > c.stuckAfterMin * 60000 && !t.note) setFields(t.id, { note: `Running for over ${c.stuckAfterMin} minutes. Open its session to check it is still working.` });
    }
    const todo = tasks.filter(x => x.status === 'waiting' && !x.hold);
    if (todo.some(x => x.role === 'orchestrator')) promptEnv = { models: await hooks.models().catch(() => ({})) };
    for (const t of todo) {
      if (t.status !== 'waiting') continue;
      const blocked = directorGate(t, tasks);
      if (blocked) { setFields(t.id, { reason: blocked }); continue; }
      const reasons = [];
      let started = false;
      if (t.role === 'orchestrator' && tasks.filter(x => x.role === 'orchestrator' && (x.status === 'running' || x.status === 'starting')).length >= ORCH_MAX) reasons.push(`${ORCH_MAX} orchestrators are already running.`);
      else for (const p of candidates(t)) {
        if (!c.providers[p]) { reasons.push(`${p} is turned off in Setup.`); continue; }
        if (!isInstalled(p)) { reasons.push(`${p} is not installed.`); continue; }
        if (t.kind === 'read' && !READ_ENFORCED.includes(p)) {
          if (t.provider === 'freebuff') { finish(t, 'failed', READ_REFUSED); started = true; break; }
          reasons.push(READ_REFUSED); continue;
        }
        if (p === 'freebuff') {
          if (!await driverOk(reasons)) continue;
          if (t.status !== 'waiting') break;
          const plan = freebuffPlan(t);
          if (plan.wait) { reasons.push(`Freebuff: ${plan.wait}`); continue; }
          startFreebuff(t, plan).catch(e => fbFail(t, e));
        } else {
          const cap = c.maxParallel[p] ?? 1;
          if ((t.role !== 'orchestrator' || p === 'antigravity') && running(p) >= cap) { reasons.push(`${p}: ${running(p)} of ${cap} allowed tasks are running.`); continue; }
          try { startChild(t, p); }
          catch (e) { finish(t, 'failed', `Could not start ${p}: ${e.message}`); }
        }
        started = true; break;
      }
      if (!started && t.status === 'waiting') {
        const reason = reasons.join(' ') || (t.provider === 'auto' ? (candidates(t).length ? 'No provider is free yet (usage still loading).' : t.kind === 'read' ? `No provider can take this read-only task by automatic routing. Turn on Codex, Cursor or OpenCode in Setup, or name Claude or Antigravity for the task. ${READ_REFUSED}` : 'No provider can take this by automatic routing (Claude and Antigravity are used only when a task names them, or Claude as the director). Pick a provider for the task or turn another one on in Setup.') : 'Waiting for a free slot.');
        setFields(t.id, { reason });
      }
    }
    state.error = null;
  } catch (e) { state.error = e.message; }
  finally { state.lastTick = Date.now(); ticking = false; }
}

export const freebuffDriver = () => ({ loaded: !!mgr, error: mgrError, own: [...clis.entries()].map(([id, c]) => ({ id, ...c, pid: mgr?.sessions.get(id)?.term?.pid ?? null })) });
function holdPanelLock() {
  const dir = path.join(ROOT, 'state');
  const file = path.join(dir, 'panel.lock');
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  const write = () => { const fd = fs.openSync(file, 'w'); fs.writeSync(fd, `${process.pid}\n${OWNER}\n${now()}\n`); fs.closeSync(fd); };
  try {
    const fd = fs.openSync(file, 'wx');
    fs.writeSync(fd, `${process.pid}\n${OWNER}\n${now()}\n`);
    fs.closeSync(fd);
    return true;
  } catch {
    let pid = 0;
    try { pid = Number(String(fs.readFileSync(file, 'utf8')).split('\n')[0]); } catch {}
    let alive = false;
    try { if (pid && pid !== process.pid) { process.kill(pid, 0); alive = true; } } catch {}
    if (!alive) { try { write(); return true; } catch { return false; } }
    if (pid === process.pid) { try { write(); return true; } catch { return false; } }
    state.error = `Another panel (process ${pid}) is already dispatching tasks from this folder. This panel shows the work but does not start any.`;
    return false;
  }
}

export function startDispatcher() {
  if (!holdPanelLock()) return;
  state.bootRecovered = recoverAtBoot();
  const release = () => { try { fs.unlinkSync(path.join(ROOT, 'state', 'panel.lock')); } catch {} };
  process.on('exit', release);
  setInterval(tick, 5000);
  tick();
}

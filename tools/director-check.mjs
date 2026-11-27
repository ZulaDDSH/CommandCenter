#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KEEP = process.argv.includes('--keep');
const WIN = process.platform === 'win32';
const results = [];
let failed = 0;

const ok = (name, detail = '') => { results.push({ ok: true, name }); console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`); };
const bad = (name, detail = '') => { failed++; results.push({ ok: false, name, detail }); console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); };
const must = (name, cond, detail = '') => { cond ? ok(name, detail) : bad(name, detail); return !!cond; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const samePath = (a, b) => { const n = s => String(s ?? '').replace(/\\/g, '/').replace(/\/+$/, ''); return WIN ? n(a).toLowerCase() === n(b).toLowerCase() : n(a) === n(b); };

const SKIP_DIRS = new Set(['node_modules', '.git', '.freebuff', 'backups', 'logs', 'tasks', 'reports', 'state', 'trash']);

function walk(dir, out = []) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(p, out);
    } else if (/\.(mjs|js)$/.test(e.name)) out.push(p);
  }
  return out;
}

function parseFiles() {
  const files = new Set();
  for (const rel of ['viewer/server.mjs', 'route.mjs']) files.add(path.join(ROOT, rel));
  for (const dir of ['lib', 'tools', 'usage', 'hooks', 'viewer/public']) for (const f of walk(path.join(ROOT, dir))) files.add(f);
  return [...files].sort();
}

function parseAll() {
  console.log('\nParse checks');
  const files = parseFiles();
  const broken = [];
  for (const f of files) {
    const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
    if (r.status !== 0) broken.push(`${path.relative(ROOT, f).replace(/\\/g, '/')}: ${String(r.stderr || r.stdout).split('\n').find(l => /Error|error/.test(l)) ?? ''}`.trim());
  }
  must(`${files.length} modules parse (node --check)`, broken.length === 0, broken.length ? broken.slice(0, 5).join(' | ') : '');
  return broken.length === 0;
}

function safeTmp() {
  const base = os.tmpdir();
  const dir = path.join(base, `cc-director-check-${process.pid}-${Math.random().toString(36).slice(2, 7)}`);
  if (/\s/.test(dir)) throw new Error(`The temp folder "${dir}" contains a space; point TEMP at a path without spaces.`);
  return dir;
}

const EXCLUDED_TOP = new Set(['config.json', 'config.json.tmp', 'tasks.json', 'tasks', 'logs', 'reports', 'board.jsonl', 'runtime', 'backups',
  'disabled-extensions.json', 'session-meta.json', 'session-meta.json.tmp', 'trash', 'goals.json', 'machines.json', 'state', '.cc-install', '.freebuff', '.git']);

function copyApp(dest) {
  const filter = src => {
    const rel = path.relative(ROOT, src).replace(/\\/g, '/');
    if (!rel) return true;
    const top = rel.split('/')[0];
    if (EXCLUDED_TOP.has(top)) return false;
    if (rel === 'docs/code-notes' || rel.startsWith('docs/code-notes/')) return false;
    if (rel === 'docs/director' || rel.startsWith('docs/director/')) return false;
    return true;
  };
  for (const dir of ['lib', 'viewer', 'usage', 'hooks', 'tools', 'docs/ai-guide']) {
    fs.cpSync(path.join(ROOT, dir), path.join(dest, dir), { recursive: true, filter });
  }
  for (const f of ['route.mjs', 'README.md', '.gitignore']) fs.copyFileSync(path.join(ROOT, f), path.join(dest, f));
  for (const d of ['tasks', 'reports', 'logs']) fs.mkdirSync(path.join(dest, d), { recursive: true });
}

function initRepo(dir) {
  const g = (args, cwd = dir) => spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true });
  const id = ['-c', 'user.email=cc-check@example.invalid', '-c', 'user.name=Director Check'];
  g(['init', '-b', 'main']);
  g(['add', '-A']);
  const r = g([...id, 'commit', '-m', 'scratch import of the app copy']);
  if (r.status !== 0) throw new Error(`the scratch commit failed: ${String(r.stderr || r.stdout || '').trim().slice(0, 300)}`);
  return g;
}

const FAKE = `import fs from 'node:fs';
import path from 'node:path';

const chunk = new Promise(res => {
  let s = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { s += d; });
  process.stdin.on('end', () => res(s));
  process.stdin.on('error', () => res(s));
});
const input = await Promise.race([chunk, new Promise(r => setTimeout(() => r(''), 2000))]);
const m = /the file at:\\s*(.+?)\\s*\\(the whole line/.exec(input);
if (!m) { console.log('fake agent: no task pointer on stdin'); process.exit(0); }
const taskFile = m[1];
if (process.env.CC_FAKE_MARK) fs.writeFileSync(process.env.CC_FAKE_MARK, String(process.pid));
const ms = Number(process.env.CC_FAKE_SLEEP_MS || 0);
if (ms > 0) { const end = Date.now() + ms; while (Date.now() < end) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250); }
let body = '';
try { body = fs.readFileSync(taskFile, 'utf8'); } catch (e) { console.log('fake agent: cannot read ' + taskFile + ': ' + e.message); process.exit(0); }
const hit = /reports[\\/\\\\]([\\w-]+)\\.md/.exec(body);
const dir = process.env.CC_FAKE_REPORTS;
if (hit && dir) {
  const folder = (/Work folder: (\\S+)/.exec(body) || [])[1] || '';
  fs.writeFileSync(path.join(dir, hit[1] + '.md'), '# fake agent report\\n\\nRan in: ' + folder + '\\n\\nNo file in the repository was changed by this check.\\n');
  console.log('fake agent: report written for ' + hit[1]);
} else {
  console.log('fake agent: finished without a report path');
}
process.exit(0);
`;

function fakeBin(dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'fake-agent.mjs'), FAKE);
  if (WIN) {
    fs.writeFileSync(path.join(dir, 'codex.cmd'), '@echo off\r\nnode "%~dp0fake-agent.mjs" %*\r\nexit /b %ERRORLEVEL%\r\n');
  } else {
    const p = path.join(dir, 'codex');
    fs.writeFileSync(p, '#!/bin/sh\nexec "' + process.execPath + '" "' + path.join(dir, 'fake-agent.mjs') + '" "$@"\n');
    fs.chmodSync(p, 0o755);
  }
}

const REPORTS = 'reports';

function writeConfig(app, projectDir, patch = {}) {
  const cfg = {
    setupDone: true,
    providers: { freebuff: false, codex: true, cursor: false, opencode: false, claude: false },
    projectDir,
    reportsDir: path.join(app, REPORTS),
    runtimeDir: '',
    maxClis: 1,
    maxParallel: { codex: 2, cursor: 1, opencode: 2, claude: 1 },
    stuckAfterMin: 90,
    taskWorktrees: true,
    mergeEnabled: false,
    models: { codex: 'gpt-check', codexEffort: 'low', cursor: 'none', opencode: 'none', claude: 'none' },
    orchestrator: { mode: 'orchestrated', provider: 'codex', model: '' },
    workerModels: { codex: 'gpt-check' },
    ...patch,
  };
  fs.writeFileSync(path.join(app, 'config.json'), JSON.stringify(cfg, null, 2));
}

const freePort = () => new Promise((res, rej) => {
  const s = net.createServer();
  s.once('error', rej);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
});

async function startPanel({ app, bin, port, log, extraEnv = {} }) {
  const fd = fs.openSync(log, 'a');
  const child = spawn(process.execPath, [path.join(app, 'viewer', 'server.mjs')], {
    cwd: app,
    windowsHide: true,
    stdio: ['ignore', fd, fd],
    env: {
      ...process.env,
      PORT: String(port),
      PATH: bin + path.delimiter + (process.env.PATH ?? process.env.Path ?? ''),
      CC_FAKE_REPORTS: path.join(app, REPORTS),
      CC_FAKE_MARK: path.join(app, 'state', 'fake-ran'),
      CC_FAKE_SLEEP_MS: '0',
      CC_PEER_CHECK_PEER: 'check-secret-not-real',
      ...extraEnv,
    },
  });
  fs.closeSync(fd);
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    try { const r = await fetch(`http://127.0.0.1:${port}/tasks`, { signal: AbortSignal.timeout(1500) }); if (r.ok) return child; } catch {}
    if (child.exitCode != null) throw new Error(`the panel exited with ${child.exitCode}; see ${log}`);
    await sleep(250);
  }
  throw new Error(`the panel did not answer on 127.0.0.1:${port} within 25 s; see ${log}`);
}

function killPanel(child) {
  if (!child || child.exitCode != null) return;
  if (WIN) spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true });
  else { try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {} } }
}

async function http(port, p, init) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}${p}`, { ...init, signal: AbortSignal.timeout(30000) });
    const text = await r.text();
    let body = null;
    try { body = JSON.parse(text); } catch {}
    return { status: r.status, text, body };
  } catch (e) { return { status: 0, text: String(e.message), body: null }; }
}
const getJson = async (port, p) => (await http(port, p)).body;
const postJson = (port, p, b) => http(port, p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b ?? {}) });

async function until(fn, ms = 20000, step = 400) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch {} await sleep(step); }
  return null;
}

const tmp = safeTmp();
const app = path.join(tmp, 'app');
const plain = path.join(tmp, 'plain');
const bin = path.join(tmp, 'bin');
const log = path.join(tmp, 'panel.log');
const lines = [];
const keepState = () => KEEP || failed > 0;
const summary = () => {
  if (!keepState()) return;
  console.log(`\nTemp folder kept: ${tmp.replace(/\\/g, '/')}`);
  try { lines.push(fs.readFileSync(log, 'utf8').split('\n').slice(-60).join('\n')); } catch {}
  if (lines.length) console.log('\nLast panel log lines:\n' + lines.join('\n'));
};

let current = null;

try {
  fs.mkdirSync(tmp, { recursive: true });
  copyApp(app);
  fakeBin(bin);
  fs.mkdirSync(plain, { recursive: true });
  fs.mkdirSync(path.join(app, 'state'), { recursive: true });
  writeConfig(app, app);
  const git = initRepo(app);

  const parsed = parseAll();

  const port1 = await freePort();
  console.log(`\nPanel on 127.0.0.1:${port1} (throwaway state in ${app.replace(/\\/g, '/')})`);
  current = await startPanel({ app, bin, port: port1, log });
  ok('panel answers from a temp state dir on 127.0.0.1');

  console.log('\nPre-existing routes still behave');
  const home = await http(port1, '/');
  must('GET / serves the page', home.status === 200 && /<title>Command Center<\/title>/.test(home.text), `HTTP ${home.status}`);
  must('GET /director.js is served', (await http(port1, '/director.js')).status === 200);
  must('GET /director.css is served', (await http(port1, '/director.css')).status === 200);

  const t0 = await http(port1, '/tasks');
  must('GET /tasks returns tasks + dispatcher', t0.status === 200 && Array.isArray(t0.body?.tasks) && !!t0.body?.dispatcher, `HTTP ${t0.status}`);
  const disp = await until(async () => { const b = await getJson(port1, '/tasks'); return b?.dispatcher?.lastTick ? b.dispatcher : null; }, 12000);
  must('the dispatcher is ticking', !!disp, disp ? `last tick ${new Date(disp.lastTick).toISOString()}` : 'no tick within 12 s');

  const board = await http(port1, '/board');
  must('GET /board returns text', board.status === 200 && typeof board.text === 'string', `HTTP ${board.status}`);
  const note = `director-check ${Date.now()}`;
  const posted = await http(port1, `/board?from=director-check`, { method: 'POST', body: note });
  must('POST /board accepts a note', posted.status === 200, `HTTP ${posted.status}`);
  must('the note is readable back', (await http(port1, '/board')).text.includes(note));

  const setup = await http(port1, '/setup');
  must('GET /setup returns settings', setup.status === 200 && setup.body?.config?.projectDir === app, `HTTP ${setup.status}`);
  const usage = await http(port1, '/usage?p=route');
  must('GET /usage?p=route returns JSON', usage.status === 200 && !!usage.body, `HTTP ${usage.status}`);
  const uCodex = await http(port1, '/usage?p=codex');
  must('GET /usage?p=codex returns JSON', uCodex.status === 200 && !!uCodex.body, `HTTP ${uCodex.status}`);
  const sess = await until(async () => { const r = await http(port1, '/sessions'); return r.status === 200 ? r : null; }, 45000);
  must('GET /sessions returns a list', !!sess && Array.isArray(sess.body), sess ? `HTTP ${sess.status}, ${sess.body.length} row(s)` : 'did not answer within 45 s');

  console.log('\nMachine inventory and the signed hello');
  const peerName = 'check-peer';
  const peerId = 'm-' + crypto.createHash('sha256').update(peerName).digest('hex').slice(0, 10);
  const added = await postJson(port1, '/director/machines/add', { name: peerName, url: 'http://127.0.0.1:1' });
  must('a machine can be listed', added.status === 200 && added.body?.peer?.id === peerId, added.body?.error ?? `HTTP ${added.status}`);
  const checkOffline = await postJson(port1, '/director/machines/check', { id: peerId });
  must('an unreachable machine is not claimed online', checkOffline.status === 200 && checkOffline.body?.ok === false, checkOffline.body?.status ?? `HTTP ${checkOffline.status}`);
  const inv0 = await getJson(port1, '/director/machines');
  must('it is reported offline, not online', !!inv0?.peers?.length && inv0.peers.every(p => p.status !== 'online'), (inv0?.peers ?? []).map(p => p.status).join(','));

  const ts = Date.now();
  const goodSig = crypto.createHmac('sha256', 'check-secret-not-real').update(`${peerId}.${ts}`).digest('hex');
  const hello = await http(port1, '/machine/hello', { method: 'POST', headers: { 'content-type': 'application/json', 'x-cc-peer': peerId, 'x-cc-ts': String(ts), 'x-cc-sig': goodSig }, body: '{}' });
  must('a correctly signed hello is accepted', hello.status === 200 && !!hello.body?.capabilities, hello.body?.error ?? `HTTP ${hello.status}`);
  const inv1 = await getJson(port1, '/director/machines');
  must('only then is the machine reported online', inv1?.peers?.[0]?.status === 'online', inv1?.peers?.[0]?.status ?? 'none');
  const badHello = await http(port1, '/machine/hello', { method: 'POST', headers: { 'content-type': 'application/json', 'x-cc-peer': peerId, 'x-cc-ts': String(ts), 'x-cc-sig': '00'.repeat(32) }, body: '{}' });
  must('a bad signature is refused', badHello.status === 403, `HTTP ${badHello.status}`);
  const staleHello = await http(port1, '/machine/hello', { method: 'POST', headers: { 'content-type': 'application/json', 'x-cc-peer': peerId, 'x-cc-ts': String(Date.now() - 120000), 'x-cc-sig': goodSig }, body: '{}' });
  must('a replayed old timestamp is refused', staleHello.status === 400, `HTTP ${staleHello.status}`);

  console.log('\nOne goal end to end');
  const mk = await postJson(port1, '/director/goal', {
    title: 'Director check goal', text: 'Prove the slice: submit a goal and let the dispatcher assign it.',
    priority: 2, projectDir: app, limits: { maxLive: 2, maxTasks: 6, taskMinutes: 30 },
  });
  must('POST /director/goal creates a goal and a task', mk.status === 200 && !!mk.body?.goal?.id && !!mk.body?.task?.id, `HTTP ${mk.status}${mk.body?.error ? ` — ${mk.body.error}` : ''}`);
  const goalId = mk.body?.goal?.id;
  const taskId = mk.body?.task?.id;
  must('the goal points at its task', mk.body?.goal?.taskId === taskId, `${mk.body?.goal?.taskId} vs ${taskId}`);
  must('the task carries the goal id', mk.body?.task?.goal === goalId);

  const started = taskId ? await until(async () => {
    const b = await getJson(port1, '/tasks');
    const t = (b?.tasks ?? []).find(x => x.id === taskId);
    return t && (t.status === 'running' || t.status === 'done') ? t : null;
  }, 25000) : null;
  must('the dispatcher assigned the task to an agent', !!started && started.ranOn === 'codex',
    started ? `status ${started.status} on ${started.ranOn ?? 'nothing'}` : 'never left waiting');
  const wtExpected = path.join(app, 'git', taskId ?? '').replace(/\\/g, '/');
  must('the task ran in <repo>/git/<task-id>', samePath(started?.worktree?.path, wtExpected), `${started?.worktree?.path ?? 'none'} vs ${wtExpected}`);
  must('that worktree exists on disk', !!started?.worktree?.path && fs.existsSync(started.worktree.path));
  must('it is on branch cc/<task-id>', started?.worktree?.branch === `cc/${taskId}`, started?.worktree?.branch ?? 'none');
  const wtList = git(['worktree', 'list', '--porcelain']).stdout ?? '';
  must('git knows the worktree', wtList.includes(taskId ?? '\u0000'));
  must('the worktree is not the project folder itself', !samePath(started?.worktree?.path, app), `${started?.worktree?.path ?? 'none'} vs ${app}`);
  must('the normal task did not take the soft fallback', !started?.worktreeNote, started?.worktreeNote ?? '');
  const mainStatus = (git(['status', '--porcelain']).stdout ?? '').trim();
  must('the main checkout was not edited', mainStatus === '', mainStatus.split('\n').slice(0, 3).join(' | '));

  const done = taskId ? await until(async () => {
    const b = await getJson(port1, '/tasks');
    const t = (b?.tasks ?? []).find(x => x.id === taskId);
    return t && ['done', 'failed', 'cancelled'].includes(t.status) ? t : null;
  }, 30000) : null;
  must('the task finished done', done?.status === 'done', done ? `status ${done.status}: ${done.note ?? ''}` : 'never finished');
  must('its exit code was recorded', done?.exitCode === 0, String(done?.exitCode));
  must('the agent was the fake, not a real CLI', fs.existsSync(path.join(app, 'state', 'fake-ran')));

  const dash = await getJson(port1, '/director');
  const g1 = (dash?.goals ?? []).find(g => g.id === goalId);
  const ev = g1?.evidence?.[0];
  must('the dashboard lists the goal', !!g1, `${(dash?.goals ?? []).length} goal(s)`);
  must('it has a result with evidence', !!ev && !!ev.report && ev.report.bytes > 0, ev?.report ? `${ev.report.path} (${ev.report.bytes} bytes)` : 'no report');
  must('the evidence names the worktree head', !!ev?.worktree?.head, ev?.worktree?.head ?? 'none');
  must('the evidence quotes the report', !!ev?.report?.head && /fake agent report/.test(ev.report.head));
  must('the goal stage is done', g1?.stage === 'done', g1?.stage ?? 'none');

  const soft = await postJson(port1, '/tasks', { text: 'Probe: a folder that is not a repository.', title: 'soft fallback probe', provider: 'codex', goal: goalId, cwd: plain });
  const softId = soft.body?.id;
  const softTask = softId ? await until(async () => {
    const b = await getJson(port1, '/tasks');
    const t = (b?.tasks ?? []).find(x => x.id === softId);
    return t && ['running', 'done'].includes(t.status) ? t : null;
  }, 30000) : null;
  must('a folder that is not a repo reports the fallback, not silence', !!softTask?.worktreeNote && !softTask?.worktree?.path, softTask?.worktreeNote ?? 'no note');

  console.log('\nGate, pause, stop, resume');
  const paused = await postJson(port1, `/director/goal/${goalId}/pause`);
  must('pause sets the goal paused', paused.body?.goal?.status === 'paused', paused.body?.goal?.status ?? `HTTP ${paused.status}`);
  const held = await postJson(port1, '/tasks', { text: 'Held by the paused goal.', title: 'held check', provider: 'codex', goal: goalId });
  const heldId = held.body?.id;
  must('a task can be added under a paused goal', held.status === 200 && !!heldId, `HTTP ${held.status}${held.body?.error ? ` — ${held.body.error}` : ''}`);
  const gated = await until(async () => {
    const b = await getJson(port1, '/tasks');
    const t = (b?.tasks ?? []).find(x => x.id === heldId);
    return t && t.status === 'waiting' && /^Paused:/.test(t.reason ?? '') ? t : null;
  }, 15000);
  must('the gate holds it with the paused reason', !!gated, gated?.reason ?? 'it did not stay waiting with a paused reason');
  await sleep(6000);
  const stillHeld = (await getJson(port1, '/tasks'))?.tasks?.find(x => x.id === heldId);
  must('it is still waiting 6 s later', stillHeld?.status === 'waiting', stillHeld?.status ?? 'gone');

  const stopped = await postJson(port1, `/director/goal/${goalId}/stop`);
  must('stop sets the goal stopped', stopped.body?.goal?.status === 'stopped', stopped.body?.goal?.status ?? `HTTP ${stopped.status}`);
  must('stop cancelled the held task', (await getJson(port1, '/tasks'))?.tasks?.find(x => x.id === heldId)?.status === 'cancelled');

  const resumed = await postJson(port1, `/director/goal/${goalId}/resume`);
  must('resume sets the goal active', resumed.body?.goal?.status === 'active', resumed.body?.goal?.status ?? `HTTP ${resumed.status}`);
  const after = await postJson(port1, '/tasks', { text: 'Runs after the goal was resumed.', title: 'resume check', provider: 'codex', goal: goalId });
  const afterId = after.body?.id;
  const ranAfter = await until(async () => {
    const b = await getJson(port1, '/tasks');
    const t = (b?.tasks ?? []).find(x => x.id === afterId);
    return t && ['running', 'done'].includes(t.status) ? t : null;
  }, 25000);
  must('resume lets a new task run', !!ranAfter, ranAfter?.status ?? 'still waiting');

  console.log('\nMerge approval is refused, not implied');
  const noMerge = await postJson(port1, '/director/merge', { number: 1, repo: 'x/y', confirm: '1' });
  must('merge is refused while mergeEnabled is off', noMerge.status === 409 && /turned off/.test(noMerge.body?.error ?? ''), `HTTP ${noMerge.status} — ${noMerge.body?.error ?? ''}`);
  const badConfirm = await postJson(port1, '/director/merge', { number: 1, repo: 'x/y', confirm: '2' });
  must('it stays refused even with a wrong confirmation', badConfirm.status === 409 && /turned off/.test(badConfirm.body?.error ?? ''), `HTTP ${badConfirm.status}`);

  killPanel(current);
  current = null;
  await sleep(1500);

  console.log('\nInterruption (panel killed while a task runs)');
  writeConfig(app, app, { mergeEnabled: true });
  const port2 = await freePort();
  current = await startPanel({ app, bin, port: port2, log, extraEnv: { CC_FAKE_SLEEP_MS: '900000' } });
  const mk2 = await postJson(port2, '/director/goal', { title: 'Interrupt goal', text: 'Stay running long enough to be killed.', priority: 3, projectDir: app, limits: { maxLive: 2, taskMinutes: 30 } });
  const goal2 = mk2.body?.goal?.id, task2 = mk2.body?.task?.id;
  must('a second goal starts a task', mk2.status === 200 && !!task2, `HTTP ${mk2.status}${mk2.body?.error ? ` — ${mk2.body.error}` : ''}`);

  const running2 = task2 ? await until(async () => {
    const b = await getJson(port2, '/tasks');
    const t = (b?.tasks ?? []).find(x => x.id === task2);
    return t && t.status === 'running' && t.worktree?.path && t.pid ? t : null;
  }, 30000) : null;
  must('the task is running with a pid and a worktree', !!running2, running2 ? `pid ${running2.pid}, ${running2.worktree.path}` : 'never reached running');
  const wt2 = running2?.worktree?.path;

  const leased = task2 ? await until(async () => {
    const b = await getJson(port2, '/tasks');
    const t = (b?.tasks ?? []).find(x => x.id === task2);
    return t?.lease?.owner && t?.heartbeatAt ? t : null;
  }, 15000) : null;
  must('a lease owner and heartbeat were recorded', !!leased?.lease?.owner, leased?.heartbeatAt ? `heartbeat ${leased.heartbeatAt}` : 'no lease within 15 s');
  const dash2 = await getJson(port2, '/director');
  const agent2 = ((dash2?.goals ?? []).find(g => g.id === goal2)?.agents ?? []).find(a => a.taskId === task2);
  must('the Director panel shows that worktree and owner', !!agent2?.worktree && !!agent2?.leaseOwner, `${agent2?.worktree ?? 'no worktree'} / ${agent2?.leaseOwner ?? 'no owner'}`);

  killPanel(current);
  current = null;
  await sleep(2000);

  const port3 = await freePort();
  current = await startPanel({ app, bin, port: port3, log });
  const recovered = await until(async () => {
    const b = await getJson(port3, '/tasks');
    const t = (b?.tasks ?? []).find(x => x.id === task2);
    return t && t.status === 'interrupted' ? b : null;
  }, 20000);
  must('the task recovered as interrupted, not failed', !!recovered, recovered ? '' : 'not interrupted within 20 s');
  const after3 = (recovered?.tasks ?? []).filter(t => t.id === task2);
  must('exactly one task carries that id', after3.length === 1, `${after3.length} copies`);
  must('the worktree path is unchanged', samePath(after3[0]?.worktree?.path, wt2), `${after3[0]?.worktree?.path} vs ${wt2}`);
  must('the worktree still exists', !!wt2 && fs.existsSync(wt2));
  const fresh = await until(async () => { const b = await getJson(port3, '/tasks'); return b?.dispatcher?.lastTick && Date.now() - b.dispatcher.lastTick < 15000 ? b.dispatcher : null; }, 15000);
  must('the new panel took over the stale dispatcher lock', !!fresh, fresh ? 'ticking' : 'dispatcher did not start');
  await sleep(6000);
  must('an interrupted task is not restarted on its own', (await getJson(port3, '/tasks'))?.tasks?.find(x => x.id === task2)?.status === 'interrupted');

  const resumedTask = await postJson(port3, `/director/task/${task2}/resume`);
  must('resume accepts the interrupted task', resumedTask.status === 200 && resumedTask.body?.status === 'waiting', `HTTP ${resumedTask.status}`);
  const back = await until(async () => {
    const b = await getJson(port3, '/tasks');
    const t = (b?.tasks ?? []).find(x => x.id === task2);
    return t && t.status === 'done' ? t : null;
  }, 30000);
  must('it finishes after the resume', back?.status === 'done', back?.status ?? 'did not finish');
  must('it reused the same worktree', samePath(back?.worktree?.path, wt2), `${back?.worktree?.path} vs ${wt2}`);
  const gitDirs = fs.existsSync(path.join(app, 'git')) ? fs.readdirSync(path.join(app, 'git')) : [];
  must('no second worktree was made for it', gitDirs.filter(d => d === task2).length === 1, `${gitDirs.length} worktree(s) under git/`);

  const wrong = await postJson(port3, '/director/merge', { number: 7, repo: 'a/b', confirm: '8' });
  must('merge refuses a confirmation that is not the PR number', wrong.status === 400 && /Type the pull request number/.test(wrong.body?.error ?? ''), `HTTP ${wrong.status} — ${wrong.body?.error ?? ''}`);

  const doc = await http(port3, '/director');
  must('the dashboard still answers with goals', doc.status === 200 && Array.isArray(doc.body?.goals), `HTTP ${doc.status}`);

  killPanel(current);
  current = null;
  ok(parsed ? 'parse checks passed before the run' : 'parse checks reported failures above');
} catch (e) {
  bad('check run completed', e?.stack ? String(e.stack).split('\n').slice(0, 4).join(' | ') : String(e?.message ?? e));
  try { if (current) killPanel(current); } catch {}
} finally {
  try { if (current) killPanel(current); } catch {}
  summary();
  if (!keepState()) { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }
  console.log(`\n${results.filter(r => r.ok).length} passed, ${failed} failed`);
  if (failed) {
    console.log('Failures:');
    for (const r of results.filter(x => !x.ok)) console.log(`  - ${r.name}${r.detail ? `: ${r.detail}` : ''}`);
  }
  process.exit(failed ? 1 : 0);
}

#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KEEP = process.argv.includes('--keep');
const WIN = process.platform === 'win32';
const results = [];
let failed = 0;

const ok = (name, detail = '') => { results.push({ ok: true, name }); console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`); };
const bad = (name, detail = '') => { failed++; results.push({ ok: false, name, detail }); console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); };
const must = (name, cond, detail = '') => { cond ? ok(name, detail) : bad(name, detail); return !!cond; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const samePath = (a, b) => { const n = s => { let p = String(s ?? ''); try { p = fs.realpathSync.native(p); } catch {} return p.replace(/\\/g, '/').replace(/\/+$/, ''); }; return WIN ? n(a).toLowerCase() === n(b).toLowerCase() : n(a) === n(b); };

const storePath = () => path.join(app, 'tasks.json');
const readStore = () => { try { return JSON.parse(fs.readFileSync(storePath(), 'utf8')); } catch { return []; } };
const setLease = (id, lease) => {
  const list = readStore();
  const t = list.find(x => x.id === id);
  if (!t) throw new Error(`no ${id} in the store`);
  if (lease) t.lease = lease; else delete t.lease;
  fs.writeFileSync(storePath() + '.check', JSON.stringify(list, null, 2));
  fs.renameSync(storePath() + '.check', storePath());
  return t;
};
const stamp = (ms = 120000) => ({ owner: 'other-host:1:x', at: new Date().toISOString(), ttl: 120000, expiresAt: new Date(Date.now() + ms).toISOString() });
const seedRow = row => {
  const list = readStore();
  list.push(row);
  fs.writeFileSync(storePath() + '.check', JSON.stringify(list, null, 2));
  fs.renameSync(storePath() + '.check', storePath());
};
const fakeToken = () => crypto.randomBytes(6).toString('hex');
const PEER_ENV = ['CC', 'PEER', 'SECRET'].join('_');
const PEER_VALUE = crypto.randomBytes(16).toString('hex');
let secondWriter = null;
const second = async () => (secondWriter ??= await import(pathToFileURL(path.join(app, 'lib', 'tasks.mjs')).href));

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

if (process.argv.slice(2)[0] === 'debug') process.exit(0);
const chunk = new Promise(res => {
  let s = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { s += d; if (s.includes('the whole line')) res(s); });
  process.stdin.on('end', () => res(s));
  process.stdin.on('error', () => res(s));
});
const input = await Promise.race([chunk, new Promise(r => setTimeout(() => r(''), 30000))]);
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
      [PEER_ENV]: PEER_VALUE,
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
let extra = null;

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
  const sessRows = (sess?.body ?? []).filter(s => s.id);
  must('every session row says running, recent, unknown or finished, never a bare "working"', sessRows.every(s => ['running', 'recent', 'unknown', 'finished'].includes(s.live) && s.liveWhy), JSON.stringify(sessRows.find(s => !s.live)));
  must('no history session claims to be running without a process id', sessRows.every(s => s.live !== 'running' || s.provider === 'freebuff'));
  must('a provider that returned more than 15 sessions ends with a visible limit note', Object.entries(sessRows.filter(s => s.provider !== 'freebuff').reduce((a, s) => (a[s.provider] = (a[s.provider] ?? 0) + 1, a), {})).every(([p, n]) => n <= 15) && (sess?.body ?? []).filter(s => !s.id && s.note).every(s => /latest 15/.test(s.title)));

  console.log('\nMachine inventory and the signed hello');
  const peerName = 'check-peer';
  const peerId = 'm-' + crypto.createHash('sha256').update(peerName).digest('hex').slice(0, 12);
  const added = await postJson(port1, '/director/machines/add', { name: peerName, url: 'http://127.0.0.1:1' });
  must('a machine can be listed by name and address only', added.status === 200 && !!added.body?.peer?.key && added.body?.peer?.id == null, added.body?.error ?? `HTTP ${added.status}`);
  const checkOffline = await postJson(port1, '/director/machines/check', { key: added.body?.peer?.key });
  must('an unreachable machine is not claimed online', checkOffline.status === 200 && checkOffline.body?.ok === false, checkOffline.body?.status ?? `HTTP ${checkOffline.status}`);
  const inv0 = await getJson(port1, '/director/machines');
  must('it is reported offline, not online', !!inv0?.peers?.length && inv0.peers.every(p => p.status !== 'online'), (inv0?.peers ?? []).map(p => p.status).join(','));

  const ts = Date.now();  const sign = (id, t, nonce, p, raw, name = '') => crypto.createHmac('sha256', PEER_VALUE).update([id, t, nonce, p, name, crypto.createHash('sha256').update(raw).digest('hex')].join('.')).digest('hex');
  const signedHeaders = (t, nonce, p, raw, name) => ({ 'content-type': 'application/json', 'x-cc-peer': peerId, ...(name ? { 'x-cc-name': name } : {}), 'x-cc-ts': String(t), 'x-cc-nonce': nonce, 'x-cc-sig': sign(peerId, t, nonce, p, raw, name ?? '') });
  const rawHello = '{}', nonce1 = 'a1'.repeat(12);
  const goodSig = sign(peerId, ts, nonce1, '/machine/hello', rawHello);
  const hello = await http(port1, '/machine/hello', { method: 'POST', headers: signedHeaders(ts, nonce1, '/machine/hello', rawHello, peerName), body: rawHello });
  must('a correctly signed hello is accepted', hello.status === 200 && !!hello.body?.capabilities, hello.body?.error ?? `HTTP ${hello.status}`);
  const inv1 = await getJson(port1, '/director/machines');
  must('only then is the machine reported online', inv1?.peers?.[0]?.status === 'online', inv1?.peers?.[0]?.status ?? 'none');
  must('the host learned the id the machine signs with', inv1?.peers?.[0]?.id === peerId, inv1?.peers?.[0]?.id ?? 'none');
  must('pairing uses one secret name, not one per machine', (inv1?.peers ?? []).every(p => !('secretEnv' in p)));
  const badHello = await http(port1, '/machine/hello', { method: 'POST', headers: { 'content-type': 'application/json', 'x-cc-peer': peerId, 'x-cc-ts': String(ts), 'x-cc-nonce': 'b2'.repeat(12), 'x-cc-sig': '00'.repeat(32) }, body: '{}' });
  must('a bad signature is refused', badHello.status === 403, `HTTP ${badHello.status}`);
  const staleTs = Date.now() - 120000, staleNonce = 'c3'.repeat(12);
  const staleHello = await http(port1, '/machine/hello', { method: 'POST', headers: signedHeaders(staleTs, staleNonce, '/machine/hello', rawHello), body: rawHello });
  must('a correctly signed hello with an old timestamp is refused', staleHello.status === 400, `HTTP ${staleHello.status}`);
  const replay = await http(port1, '/machine/hello', { method: 'POST', headers: { 'content-type': 'application/json', 'x-cc-peer': peerId, 'x-cc-ts': String(ts), 'x-cc-nonce': nonce1, 'x-cc-sig': goodSig }, body: rawHello });
  must('the same signed hello sent twice is refused the second time', replay.status === 409, `HTTP ${replay.status}`);
  const tsB = Date.now(), nonceB = 'd4'.repeat(12);
  const otherPath = await http(port1, '/machine/claim', { method: 'POST', headers: { 'content-type': 'application/json', 'x-cc-peer': peerId, 'x-cc-ts': String(tsB), 'x-cc-nonce': nonceB, 'x-cc-sig': sign(peerId, tsB, nonceB, '/machine/hello', rawHello) }, body: rawHello });
  must('a signature made for the hello cannot be used on the claim route', otherPath.status === 403, `HTTP ${otherPath.status}`);
  const tsC = Date.now(), nonceC = 'e5'.repeat(12);
  const changedBody = await http(port1, '/machine/hello', { method: 'POST', headers: { 'content-type': 'application/json', 'x-cc-peer': peerId, 'x-cc-ts': String(tsC), 'x-cc-nonce': nonceC, 'x-cc-sig': sign(peerId, tsC, nonceC, '/machine/hello', rawHello) }, body: '{"capabilities":{"claim":{"supported":true}}}' });
  must('a signed hello with a changed body is refused', changedBody.status === 403, `HTTP ${changedBody.status}`);
  const tsD = Date.now(), nonceD = 'f6'.repeat(12);
  const claimOk = await http(port1, '/machine/claim', { method: 'POST', headers: signedHeaders(tsD, nonceD, '/machine/claim', '{"task":null}'), body: '{"task":null}' });
  must('a correctly signed claim is still refused as unsupported (no remote execution exists)', claimOk.status === 501 && claimOk.body?.supported === false, `HTTP ${claimOk.status}`);
  const inv2 = await getJson(port1, '/director/machines');
  must('the refused changed-body hello stored no capabilities from its body', !inv2?.peers?.[0]?.capabilities?.claim, JSON.stringify(inv2?.peers?.[0]?.capabilities ?? null));
  const tsE = Date.now(), nonceE = '17'.repeat(12);
  const renamed = await http(port1, '/machine/hello', { method: 'POST', headers: { ...signedHeaders(tsE, nonceE, '/machine/hello', rawHello, peerName), 'x-cc-name': 'someone-else' }, body: rawHello });
  must('a signed hello with its name header changed in transit is refused', renamed.status === 403, `HTTP ${renamed.status}`);

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
  const foreign = await postJson(port1, '/tasks', { text: 'Leased elsewhere.', title: 'foreign lease check', provider: 'codex', goal: goalId });
  const foreignId = foreign.body?.id;
  setLease(foreignId, { ...stamp(), token: fakeToken() });
  const refusedCancel = await postJson(port1, `/tasks/${foreignId}/cancel`, {});
  must('the panel refuses to cancel a task leased elsewhere', refusedCancel.status === 409 && refusedCancel.body?.code === 'lease-foreign', `HTTP ${refusedCancel.status} ${refusedCancel.body?.code ?? ''}`);
  must('the task leased elsewhere was not cancelled by the refused request', (await getJson(port1, '/tasks'))?.tasks?.find(x => x.id === foreignId)?.status === 'waiting');
  const foreignRows = readStore();
  const foreignRow = foreignRows.find(x => x.id === foreignId);
  if (foreignRow) Object.assign(foreignRow, { status: 'cancelled', endedAt: new Date().toISOString(), reason: 'Closed by the check after the refusal test.' }), delete foreignRow.lease;
  fs.writeFileSync(storePath() + '.check', JSON.stringify(foreignRows, null, 2));
  fs.renameSync(storePath() + '.check', storePath());
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
  const stoppedTask = (await getJson(port1, '/tasks'))?.tasks?.find(x => x.id === heldId);
  must('stop cancelled the held task', stoppedTask?.status === 'cancelled', `${stoppedTask?.status ?? 'gone'}; cancelled ${stopped.body?.cancelled ?? '?'}; lease ${stoppedTask?.lease?.owner ?? 'none'}`);

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
  const peerSecret = crypto.randomBytes(18).toString('hex');
  current = await startPanel({ app, bin, port: port2, log, extraEnv: { CC_FAKE_SLEEP_MS: '900000', [PEER_ENV]: peerSecret } });
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

  console.log('\nA reply to a running one-shot director is not claimed as delivered');
  must('the dashboard says a reply to this running codex run becomes a hand-off', (dash2?.goals ?? []).find(g => g.id === goal2)?.steering?.mode === 'handoff', JSON.stringify((dash2?.goals ?? []).find(g => g.id === goal2)?.steering));
  const noText = await postJson(port2, `/director/goal/${goal2}/steer`, { text: '   ' });
  must('an empty reply is refused', noText.status === 400, `HTTP ${noText.status}`);
  const reply = await postJson(port2, `/director/goal/${goal2}/steer`, { text: 'Also write the result to NOTES.md.' });
  must('a reply is accepted', reply.status === 200 && !!reply.body?.task?.id, `HTTP ${reply.status} ${reply.body?.error ?? ''}`);
  must('it is reported as queued, not sent', reply.body?.delivery?.mode === 'queued', JSON.stringify(reply.body?.delivery));
  must('the message says the running director has not received it', /NOT received/.test(reply.body?.note ?? ''), reply.body?.note ?? '');
  const handoffId = reply.body?.task?.id;
  const handoff = (await getJson(port2, '/tasks'))?.tasks?.find(x => x.id === handoffId);
  must('the hand-off carries the original goal and the new note', /Stay running long enough to be killed\./.test(handoff?.text ?? '') && /Also write the result to NOTES\.md\./.test(handoff?.text ?? ''), (handoff?.text ?? '').slice(0, 120));
  must('the hand-off waits behind the running director', handoff?.afterTask === task2, handoff?.afterTask ?? 'no afterTask');
  const heldReason = await until(async () => {
    const t = (await getJson(port2, '/tasks'))?.tasks?.find(x => x.id === handoffId);
    return t?.status === 'waiting' && /Waiting for the running director/.test(t.reason ?? '') ? t : null;
  }, 15000);
  must('the dispatcher keeps it waiting with that reason', !!heldReason, heldReason?.reason ?? 'it did not stay waiting');
  must('the running director was not stopped or changed', (await getJson(port2, '/tasks'))?.tasks?.find(x => x.id === task2)?.status === 'running');
  const thread = ((await getJson(port2, '/director'))?.goals ?? []).find(g => g.id === goal2)?.thread ?? [];
  must('the chat records what happened to the reply', thread.some(m => m.who === 'you' && /Also write the result/.test(m.text) && /NOT received/.test(m.delivery ?? '')), JSON.stringify(thread.map(m => m.delivery)));
  await postJson(port2, `/tasks/${handoffId}/cancel`, {});

  console.log('\nRead-only is refused where it cannot be enforced');
  const roFree = await postJson(port2, '/tasks', { text: 'Look only.', title: 'read-only freebuff check', provider: 'freebuff', kind: 'read' });
  must('a read-only task for Freebuff is refused with the reason', roFree.status === 400 && /cannot enforce a read-only task/.test(roFree.body?.error ?? ''), `HTTP ${roFree.status} ${roFree.body?.error ?? ''}`);

  console.log('\nLease fencing (a writer that does not hold the lease cannot close the task)');
  const beforeKill = readStore().find(x => x.id === task2);
  const token1 = beforeKill?.lease?.token;
  const otherToken = fakeToken(), expiredToken = fakeToken(), takeoverToken = fakeToken();
  must('the running task carries a lease token', !!token1, token1 ?? 'no token');
  const writer = await second();
  const record = () => JSON.stringify(readStore().find(x => x.id === task2) ?? null);
  const baseline = record();

  const wrongToken = writer.closeTask(task2, 'done', 'stale writer', { token: otherToken });
  must('a writer with the wrong token is refused', wrongToken.ok === false && wrongToken.code === 'lease-lost', wrongToken.code ?? 'accepted');
  must('the refused close left the task untouched', record() === baseline, 'task record changed');

  setLease(task2, { ...stamp(), token: takeoverToken });
  const stale = writer.closeTask(task2, 'done', 'previous owner', { token: token1 });
  must('the previous owner cannot close a re-claimed task', stale.ok === false && stale.code === 'lease-lost', stale.code ?? 'accepted');
  must('the new owner still holds it after that attempt', readStore().find(x => x.id === task2)?.lease?.token === takeoverToken);
  must('the task is still running, not closed', readStore().find(x => x.id === task2)?.status === 'running', readStore().find(x => x.id === task2)?.status);

  const asPanel = writer.closeTask(task2, 'done', 'panel', { panel: true });
  must('a panel does not close a task leased to another owner', asPanel.ok === false && asPanel.code === 'lease-foreign', asPanel.code ?? 'accepted');

  setLease(task2, { ...stamp(-60000), token: expiredToken, expiresAt: new Date(Date.now() - 60000).toISOString() });
  const expired = writer.closeTask(task2, 'done', 'expired lease', { token: expiredToken });
  must('an expired lease cannot close a task', expired.ok === false && expired.code === 'lease-expired', expired.code ?? 'accepted');
  must('the expired-lease attempt also changed nothing', readStore().find(x => x.id === task2)?.status === 'running', readStore().find(x => x.id === task2)?.status);

  setLease(task2, beforeKill.lease);
  must('the original lease is back in place', readStore().find(x => x.id === task2)?.lease?.token === token1);

  console.log('\nA second panel starts while the first is running a task');
  const port2b = await freePort();
  extra = await startPanel({ app, bin, port: port2b, log });
  const bSees = await getJson(port2b, '/tasks');
  must('the second panel answers but starts no dispatcher', bSees?.dispatcher?.bootRecovered === 0 && /already dispatching/.test(bSees?.dispatcher?.error ?? ''), `bootRecovered ${bSees?.dispatcher?.bootRecovered}, error ${bSees?.dispatcher?.error ?? 'none'}`);
  const bTask = (bSees?.tasks ?? []).find(x => x.id === task2);
  must('the second panel sees the task as running, not interrupted', bTask?.status === 'running', bTask?.status ?? 'missing');
  must('the second panel did not take the task', bTask?.lease?.token === token1 && bTask?.lease?.owner === beforeKill.lease.owner, `${bTask?.lease?.token} vs ${token1}`);
  const afterSecond = readStore().find(x => x.id === task2);
  must('the stored task is untouched by the second panel', afterSecond?.status === 'running' && afterSecond?.lease?.token === token1, `${afterSecond?.status} / ${afterSecond?.lease?.token}`);

  const directRecover = writer.recoverAtBoot();
  must('recovery run beside a live holder takes nothing', directRecover === 0, `${directRecover} task(s) taken`);
  const afterDirect = readStore().find(x => x.id === task2);
  must('the live holder still has the task after that recovery', afterDirect?.status === 'running' && afterDirect?.lease?.token === token1, `${afterDirect?.status} / ${afterDirect?.lease?.token}`);

  const tickA = (await getJson(port2, '/tasks'))?.dispatcher?.lastTick ?? 0;
  await sleep(6500);
  const tickA2 = (await getJson(port2, '/tasks'))?.dispatcher?.lastTick ?? 0;
  must('the first panel is still dispatching', tickA2 > tickA, `${tickA} -> ${tickA2}`);
  const stillMine = (await getJson(port2, '/tasks'))?.tasks?.find(x => x.id === task2);
  must('the first panel still holds the running task', stillMine?.status === 'running' && stillMine?.lease?.token === token1, `${stillMine?.status} / ${stillMine?.lease?.token}`);

  killPanel(extra);
  extra = null;

  console.log('\nA lease held by another host');
  const awayId = 'away-lease-check';
  const awayToken = fakeToken();
  seedRow({ id: awayId, title: 'Leased to another host', text: 'held elsewhere', status: 'running', provider: 'codex', kind: 'light', ranOn: 'codex', startedAt: new Date().toISOString(), createdAt: new Date().toISOString(), lease: { ...stamp(), token: awayToken } });
  const awayTaken = writer.recoverAtBoot();
  const awayRow = readStore().find(x => x.id === awayId);
  must('a fresh lease on another host is not recovered', awayRow?.status === 'running' && awayRow?.lease?.token === awayToken, `${awayRow?.status} / ${awayRow?.lease?.token} / ${awayTaken} taken`);
  const awayCancel = await postJson(port2, `/tasks/${awayId}/cancel`, {});
  must('the panel refuses to cancel a task leased to another host', awayCancel.status === 409 && awayCancel.body?.code === 'lease-foreign', `HTTP ${awayCancel.status} ${awayCancel.body?.code ?? ''}`);
  const awayDone = await postJson(port2, `/tasks/${awayId}/done`, {});
  must('the panel refuses to mark it done', awayDone.status === 409 && awayDone.body?.code === 'lease-foreign', `HTTP ${awayDone.status} ${awayDone.body?.code ?? ''}`);
  const awayStill = readStore().find(x => x.id === awayId);
  must('the task is untouched after both refusals', awayStill?.status === 'running' && awayStill?.lease?.token === awayToken, `${awayStill?.status} / ${awayStill?.lease?.token}`);
  const awayCleaned = readStore().map(x => x.id === awayId ? { ...x, status: 'cancelled', endedAt: new Date().toISOString(), reason: 'Closed by the check after the away-lease test.' } : x);
  for (const row of awayCleaned) if (row.id === awayId) delete row.lease;
  fs.writeFileSync(storePath() + '.check', JSON.stringify(awayCleaned, null, 2));
  fs.renameSync(storePath() + '.check', storePath());

  const afterBoth = (await getJson(port2, '/tasks'))?.tasks?.find(x => x.id === task2);
  must('the task survives the second panel coming and going', afterBoth?.status === 'running' && afterBoth?.lease?.token === token1, `${afterBoth?.status} / ${afterBoth?.lease?.token}`);

  console.log('\nA second machine joins with its own process, token and data dir');
  const secondName = 'check-workstation-b';
  const peerAdded = await postJson(port2, '/director/machines/add', { name: secondName, url: 'http://127.0.0.1:1' });
  must('the host lists a second machine', peerAdded.status === 200 && !!peerAdded.body?.peer?.key, peerAdded.body?.error ?? `HTTP ${peerAdded.status}`);
  const listed = (await getJson(port2, '/director/machines'))?.peers?.find(x => x.name === secondName);
  must('a listed machine is not authenticated until it signs', listed?.authenticated === false && listed?.status === 'offline', `${listed?.status} / authenticated ${listed?.authenticated}`);

  const peerRoot = path.join(tmp, 'peer');
  const peerRun = spawnSync(process.execPath, [path.join(app, 'tools', 'peer.mjs'), 'join', '--host', `http://127.0.0.1:${port2}`, '--name', 'check-host', '--task', task2], {
    encoding: 'utf8', timeout: 90000, windowsHide: true,
    env: { ...process.env, CC_ROOT: peerRoot, CC_MACHINE_NAME: secondName, [PEER_ENV]: peerSecret, CC_FAKE_SLEEP_MS: '0' },
  });
  const peerLine = String(peerRun.stdout ?? '').trim().split(/\r?\n/).filter(Boolean).pop() ?? '';
  let peer = null;
  try { peer = JSON.parse(peerLine); } catch {}
  must('the second machine runs from its own data directory', !!peer?.root && samePath(peer.root, peerRoot), peer?.root ?? peerLine.slice(0, 140));
  const selfIdHere = (await getJson(port2, '/director/machines'))?.self?.id;
  must('it has its own machine id, distinct from this host', !!peer?.selfId && peer.selfId !== selfIdHere, `${peer?.selfId ?? 'none'} vs ${selfIdHere ?? 'none'}`);
  must('it reports its own capabilities', !!peer?.capabilities?.providers && peer.capabilities.claim?.supported === false, Object.keys(peer?.capabilities?.providers ?? {}).join(',') || 'none');
  must('its signed hello is accepted', peer?.hello?.ok === true && peer.hello.status === 'online', `${peer?.hello?.status ?? 'none'} ${peer?.hello?.why ?? ''}`);
  must('it cannot claim work, even authenticated', peer?.claim?.status === 501 && peer.claim.code === 'claim-unsupported' && peer.claim.supported === false, `HTTP ${peer?.claim?.status} ${peer?.claim?.code ?? ''}`);
  must('it cannot claim work without valid credentials', peer?.claimBad?.status === 403, `HTTP ${peer?.claimBad?.status} ${peer?.claimBad?.code ?? ''}`);
  must('its own store holds none of this host tasks', peer?.hasTask === false && peer?.ownTasks === 0, `${peer?.ownTasks} task(s), host task present ${peer?.hasTask}`);

  const afterPeer = (await getJson(port2, '/director/machines'))?.peers?.find(x => x.name === secondName);
  must('the host records it as an authenticated machine', afterPeer?.status === 'online' && afterPeer?.authenticated === true, `${afterPeer?.status} / authenticated ${afterPeer?.authenticated}`);
  must('the host learned its own-signed id, capabilities and availability', afterPeer?.id === peer?.selfId && !!afterPeer?.capabilities?.providers && afterPeer?.available === true, `${afterPeer?.id ?? 'none'} / available ${afterPeer?.available}`);
  const peerTask = (await getJson(port2, '/tasks'))?.tasks?.find(x => x.id === task2);
  must('the second machine neither recovered nor interrupted the task', peerTask?.status === 'running' && peerTask?.lease?.token === token1 && peerTask?.lease?.owner === beforeKill.lease.owner, `${peerTask?.status} / ${peerTask?.lease?.token}`);
  const taskMachines = ((await getJson(port2, '/tasks'))?.tasks ?? []).map(x => x.machine).filter(m => m && m !== 'local');
  must('no task was handed to that machine', taskMachines.length === 0, taskMachines.join(',') || 'none');
  const tickP = (await getJson(port2, '/tasks'))?.dispatcher?.lastTick ?? 0;
  await sleep(6500);
  const tickP2 = (await getJson(port2, '/tasks'))?.dispatcher?.lastTick ?? 0;
  must('the first host kept dispatching throughout', tickP2 > tickP, `${tickP} -> ${tickP2}`);
  must('the task is still the first host business', readStore().find(x => x.id === task2)?.lease?.token === token1);

  killPanel(current);
  current = null;
  await sleep(2000);

  const afterKill = readStore().find(x => x.id === task2);
  must('the killed panel left the task running under its lease', afterKill?.status === 'running' && afterKill?.lease?.token === token1, `${afterKill?.status} / ${afterKill?.lease?.token}`);
  setLease(task2, { ...stamp(), token: takeoverToken });
  const late = writer.closeTask(task2, 'done', 'crashed writer coming back', { token: token1 });
  must('a crashed writer cannot close a task another owner has taken', late.ok === false && late.code === 'lease-lost', late.code ?? 'accepted');
  must('the takeover lease survived that attempt', readStore().find(x => x.id === task2)?.lease?.token === takeoverToken);
  setLease(task2, afterKill.lease);

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
  const recLease = readStore().find(x => x.id === task2)?.lease;
  must('recovery re-claimed the task under a new token', !!recLease?.token && recLease.token !== token1, `${recLease?.token ?? 'none'} vs ${token1 ?? 'none'}`);
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

  const noStage = await postJson(port3, '/director/stage', { title: 'must not be written', evidence: 'x' });
  must('the panel has no second writer for the stage log', noStage.status === 404 && !fs.existsSync(path.join(app, 'docs', 'director', 'STAGES.md')), `HTTP ${noStage.status}`);
  must('the director module has no stage writer left', !/appendStage/.test(fs.readFileSync(path.join(app, 'lib', 'director.mjs'), 'utf8')));

  const doc = await http(port3, '/director');
  must('the dashboard still answers with goals', doc.status === 200 && Array.isArray(doc.body?.goals), `HTTP ${doc.status}`);

  killPanel(current);
  current = null;

  console.log('\nTwo writers close unrelated tasks at once');
  const seedRace = (id, token) => {
    const list = readStore();
    list.push({ id, title: `Racing writer ${id}`, status: 'running', provider: 'codex', kind: 'light', createdAt: new Date().toISOString(), startedAt: new Date().toISOString(), ranOn: 'codex', lease: { owner: 'other-host:1:x', token, at: new Date().toISOString(), ttl: 120000, expiresAt: new Date(Date.now() + 120000).toISOString() } });
    fs.writeFileSync(storePath() + '.check', JSON.stringify(list, null, 2));
    fs.renameSync(storePath() + '.check', storePath());
  };
  const raceModule = pathToFileURL(path.join(app, 'lib', 'tasks.mjs')).href;
  const closer = (taskId, token, at) => new Promise(resolve => {
    const code = `import(${JSON.stringify(raceModule)}).then(m => { while (Date.now() < ${at}) {} const r = m.closeTask(${JSON.stringify(taskId)}, 'done', 'closed by a racing writer', { token: ${JSON.stringify(token)} }); console.log(JSON.stringify({ ok: r.ok, code: r.code || null, status: r.task?.status || null })); }, e => console.log(JSON.stringify({ ok: false, code: String((e && e.message) || e) })));`;
    const p = spawn(process.execPath, ['-e', code], { windowsHide: true, env: { ...process.env } });
    let out = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { out += d; });
    p.on('close', () => resolve(out.trim().split(/\r?\n/).filter(Boolean).pop() ?? ''));
  });
  const rounds = 8;
  let lostRounds = 0, refusedRounds = 0;
  for (let i = 0; i < rounds; i++) {
    const a = `race-${i}-a`, b = `race-${i}-b`;
    const ta = fakeToken(), tb = fakeToken();
    seedRace(a, ta);
    seedRace(b, tb);
    const at = Date.now() + 400;
    const outs = await Promise.all([closer(a, ta, at), closer(b, tb, at)]);
    for (const o of outs) {
      try { if (JSON.parse(o).ok !== true) refusedRounds++; } catch { refusedRounds++; }
    }
    const rows = readStore();
    if (rows.find(x => x.id === a)?.status !== 'done' || rows.find(x => x.id === b)?.status !== 'done') lostRounds++;
  }
  must('both racing writers kept their own update in every round', lostRounds === 0, `${rounds - lostRounds}/${rounds} round(s) kept both`);
  must('neither racing writer was refused', refusedRounds === 0, `${refusedRounds} refusal(s)`);
  must('the store lock is released when the writers are done', !fs.existsSync(path.join(app, 'state', 'store.lock')));
  const cleaned = readStore().filter(x => !String(x.id).startsWith('race-'));
  fs.writeFileSync(storePath() + '.check', JSON.stringify(cleaned, null, 2));
  fs.renameSync(storePath() + '.check', storePath());

  console.log('\nConcurrent writers from separate processes');
  const storeModule = pathToFileURL(path.join(app, 'lib', 'tasks.mjs')).href;
  const storeLockFile = path.join(app, 'state', 'store.lock');
  const leaseNow = token => ({ owner: 'other-host:1:x', token, at: new Date().toISOString(), ttl: 120000, expiresAt: new Date(Date.now() + 120000).toISOString() });
  const childCode = (body, at) => `import(${JSON.stringify(storeModule)}).then(async m => { while (Date.now() < ${at}) {} try { ${body} } catch (e) { console.log(JSON.stringify({ ok: false, error: String((e && e.message) || e) })); } });`;
  const spawnJson = code => new Promise(resolve => {
    const p = spawn(process.execPath, ['-e', code], { windowsHide: true, env: { ...process.env } });
    let out = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { out += d; });
    p.on('close', () => {
      const line = out.trim().split(/\r?\n/).filter(Boolean).pop() ?? '';
      let v = null;
      try { v = JSON.parse(line); } catch {}
      resolve(v ?? { ok: false, error: line.slice(0, 140) });
    });
  });

  const rounds2 = 5;
  let addedMissing = 0, beatMissing = 0, closeMissing = 0, titleLost = 0, titleWon = 0, busyRefusals = 0, retryMissing = 0, startMissing = 0, startNote = '';
  for (let i = 0; i < rounds2; i++) {
    const beatId = `beat-${i}`, closeId = `close-${i}`, fieldId = `field-${i}`, retryId = `retry-${i}`, startId = `start-${i}`;
    const tok = fakeToken();
    const stamp = new Date().toISOString();
    seedRow({ id: beatId, title: `Beat ${i}`, text: 'beat', status: 'running', provider: 'codex', kind: 'light', ranOn: 'codex', startedAt: stamp, createdAt: stamp });
    seedRow({ id: closeId, title: `Close ${i}`, text: 'close', status: 'running', provider: 'codex', kind: 'light', ranOn: 'codex', startedAt: stamp, createdAt: stamp, lease: leaseNow(tok) });
    seedRow({ id: fieldId, title: `Field ${i}`, text: 'field', status: 'waiting', provider: 'codex', kind: 'light', hold: 'cc-boss', createdAt: stamp });
    seedRow({ id: retryId, title: `Retry ${i}`, text: 'retry', status: 'failed', provider: 'codex', kind: 'light', createdAt: stamp, reason: 'failed for the retry race' });
    seedRow({ id: startId, title: `Start ${i}`, text: 'start', status: 'waiting', provider: 'codex', kind: 'light', createdAt: stamp });
    const at = Date.now() + 500;
    const [added, beat, closed, approved, closed2, retried, started] = await Promise.all([
      spawnJson(childCode(`const t = m.add({ text: 'concurrent add ${i}', title: 'concurrent add ${i}' }); console.log(JSON.stringify({ ok: true, id: t.id }));`, at)),
      spawnJson(childCode(`m.heartbeat(); const t = m.get(${JSON.stringify(beatId)}); console.log(JSON.stringify({ ok: !!(t && t.lease), owner: t && t.lease ? t.lease.owner : null }));`, at)),
      spawnJson(childCode(`const r = m.closeTask(${JSON.stringify(closeId)}, 'done', 'closed concurrently', { token: ${JSON.stringify(tok)} }); console.log(JSON.stringify({ ok: !!r.ok, code: r.code || null }));`, at)),
      spawnJson(childCode(`const r = m.approve(${JSON.stringify(fieldId)}, { title: 'renamed by writer' }); console.log(JSON.stringify({ ok: !!r }));`, at)),
      spawnJson(childCode(`const r = m.closeTask(${JSON.stringify(fieldId)}, 'done', 'note from the closer', { panel: true }); console.log(JSON.stringify({ ok: !!r.ok, code: r.code || null }));`, at)),
      spawnJson(childCode(`const r = m.retry(${JSON.stringify(retryId)}); console.log(JSON.stringify({ ok: !!r, status: r && r.status }));`, at)),
      spawnJson(childCode(`const row = m.startForCheck(${JSON.stringify(startId)}, 'codex', () => ({ call: { cmd: process.execPath, args: ['-e', 'setTimeout(() => {}, 20000)'], opts: {} } })); console.log(JSON.stringify({ ok: !!(row && row.status === 'running'), status: row && row.status, owner: row && row.lease ? row.lease.owner : null })); process.exit(0);`, at)),
    ]);
    for (const r of [added, beat, closed, approved, closed2, retried, started]) if (/busy|another writer|only inside a locked update/i.test(String(r?.error ?? ''))) busyRefusals++;
    const rows = readStore();
    if (!added?.id || !rows.some(x => x.id === added.id && x.status === 'waiting')) addedMissing++;
    if (!beat?.ok || !rows.find(x => x.id === beatId)?.lease) beatMissing++;
    if (!closed?.ok || rows.find(x => x.id === closeId)?.status !== 'done') closeMissing++;
    const fieldRow = rows.find(x => x.id === fieldId);
    if (fieldRow?.status !== 'done') closeMissing++;
    if (approved?.ok) { if (fieldRow?.title === 'renamed by writer') titleWon++; else titleLost++; }
    if (!retried?.ok || rows.find(x => x.id === retryId)?.status !== 'waiting') retryMissing++;
    const startRow = rows.find(x => x.id === startId), startClose = rows.find(x => x.id === closeId);
    if (!started?.ok || startRow?.status !== 'running' || !startRow?.lease?.owner || startClose?.status !== 'done') { startMissing++; startNote ||= JSON.stringify({ child: started, row: startRow && { status: startRow.status, owner: startRow.lease && startRow.lease.owner }, close: startClose && startClose.status }); }
  }
  const startedRows = readStore().map(x => String(x.id).startsWith('start-') ? { ...x, status: 'cancelled', endedAt: new Date().toISOString(), reason: 'Closed by the check after the start race.' } : x);
  fs.writeFileSync(storePath() + '.check', JSON.stringify(startedRows, null, 2));
  fs.renameSync(storePath() + '.check', storePath());
  must('every concurrent add survived', addedMissing === 0, `${rounds2 - addedMissing}/${rounds2} rounds kept the new task`);
  must('every concurrent heartbeat kept its lease', beatMissing === 0, `${rounds2 - beatMissing}/${rounds2} rounds kept the lease`);
  must('every concurrent close survived', closeMissing === 0, `${closeMissing} round(s) lost a close`);
  must('a title written beside a close survived on the same task', titleLost === 0 && titleWon > 0, `${titleWon} kept, ${titleLost} lost`);
  must('a retry written beside a close took effect and cost no close', retryMissing === 0, `${rounds2 - retryMissing}/${rounds2} rounds retried`);
  must('a start and a close in one round both survived', startMissing === 0, `${rounds2 - startMissing}/${rounds2} rounds started${startNote ? ' — ' + startNote : ''}`);
  must('no writer was refused because the store was busy', busyRefusals === 0, `${busyRefusals} refusal(s)`);
  must('the store lock is gone after all writers', !fs.existsSync(storeLockFile));

  console.log('\nA writer that cannot get the store lock');
  fs.mkdirSync(path.dirname(storeLockFile), { recursive: true });
  fs.writeFileSync(storeLockFile, 'held by the check');
  const beforeCount = readStore().length;
  const busy = await spawnJson(childCode(`const t = m.add({ text: 'must not land', title: 'must not land' }); console.log(JSON.stringify({ ok: true, id: t.id }));`, Date.now()));
  must('it refuses instead of writing stale state', busy?.ok === false && /busy|another writer/i.test(String(busy?.error ?? '')), String(busy?.error ?? 'wrote anyway').slice(0, 140));
  must('the refused writer changed nothing', readStore().length === beforeCount, `${readStore().length} rows vs ${beforeCount}`);
  fs.unlinkSync(storeLockFile);
  fs.writeFileSync(storeLockFile, 'left by a crashed writer');
  const oldMtime = new Date(Date.now() - 90000);
  fs.utimesSync(storeLockFile, oldMtime, oldMtime);
  const broke = await spawnJson(childCode(`const t = m.add({ text: 'after a stale lock', title: 'after a stale lock' }); console.log(JSON.stringify({ ok: true, id: t.id }));`, Date.now()));
  must('a stale lock is broken instead of blocking forever', !!broke?.id, broke?.id ? `added ${broke.id}` : String(broke?.error ?? 'no id').slice(0, 140));
  must('the broken lock is cleaned up', !fs.existsSync(storeLockFile));

  console.log('\nRecovery on a store left mid-write');
  const recId = 'left-running';
  seedRow({ id: recId, title: 'Left running', text: 'x', status: 'running', provider: 'codex', kind: 'light', ranOn: 'codex', startedAt: new Date().toISOString(), createdAt: new Date().toISOString(), lease: { owner: 'gone-host:1:x', token: fakeToken(), at: new Date().toISOString(), ttl: 120000, expiresAt: new Date(Date.now() - 60000).toISOString() } });
  fs.writeFileSync(storePath() + '.tmp', '{"half":');
  fs.writeFileSync(storeLockFile, 'left by the crash');
  fs.utimesSync(storeLockFile, oldMtime, oldMtime);
  const rec = await spawnJson(childCode(`const n = m.recoverAtBoot(); console.log(JSON.stringify({ ok: true, n }));`, Date.now()));
  must('recovery works on a store left mid-write', rec?.n >= 1, `${rec?.n ?? 'none'} task(s) taken`);
  must('recovery interrupted the dead task', readStore().find(x => x.id === recId)?.status === 'interrupted', readStore().find(x => x.id === recId)?.status ?? 'missing');
  must('recovery left no lock behind', !fs.existsSync(storeLockFile));
  const tidy = readStore().filter(x => !/^(beat|close|field)-/.test(String(x.id)) && x.id !== recId);
  fs.writeFileSync(storePath() + '.check', JSON.stringify(tidy, null, 2));
  fs.renameSync(storePath() + '.check', storePath());

  ok(parsed ? 'parse checks passed before the run' : 'parse checks reported failures above');
} catch (e) {
  bad('check run completed', e?.stack ? String(e.stack).split('\n').slice(0, 4).join(' | ') : String(e?.message ?? e));
  try { if (current) killPanel(current); } catch {}
  try { if (extra) killPanel(extra); } catch {}
} finally {
  try { if (current) killPanel(current); } catch {}
  try { if (extra) killPanel(extra); } catch {}
  summary();
  if (!keepState()) { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }
  console.log(`\n${results.filter(r => r.ok).length} passed, ${failed} failed`);
  if (failed) {
    console.log('Failures:');
    for (const r of results.filter(x => !x.ok)) console.log(`  - ${r.name}${r.detail ? `: ${r.detail}` : ''}`);
  }
  process.exit(failed ? 1 : 0);
}

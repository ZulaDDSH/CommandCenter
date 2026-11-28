#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-pr-auto-dispatch-'));
process.env.CC_ROOT = tmp;
process.on('exit', () => { try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 }); } catch {} });
const M = await import(pathToFileURL(path.join(repo, 'lib', 'pr-auto-dispatch.mjs')).href);

let failed = 0;
const must = (name, cond, detail = '') => { console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : detail ? ` — ${detail}` : ''}`); if (!cond) failed++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TOKEN = 'tok-' + Math.random().toString(36).slice(2);
const MINUTE = 60000;

const BASE = { providers: { freebuff: true, claude: true, cursor: true, opencode: true, codex: true }, maxParallel: { claude: 1, cursor: 1, opencode: 2, codex: 2 }, projectDir: tmp, autoDispatch: { enabled: true, intervalMs: 60000, cooldownMs: 300000, maxAttempts: 2, maxTotalSessions: 30, freebuffSlots: 5, repoDirs: {} } };
const pr = (repoName, number, extra = {}) => ({ repo: repoName, number, author: 'NomadsReach', ci: 'failure', open_findings: 0, branch: `fix-${number}`, head_sha: `sha${number}`, updated_at: new Date(Date.now() - 60 * MINUTE).toISOString(), title: `PR ${number}`, ...extra });

function rig({ prs = [], config = {}, tasks = [], dirs = true, failAdd = [] } = {}) {
  const dir = fs.mkdtempSync(path.join(tmp, 'rig-'));
  const rows = [...tasks];
  const clock = { t: Date.now() };
  const calls = { fetch: [], token: 0, added: [], ticks: 0 };
  const cfg = { ...BASE, ...config, autoDispatch: { ...BASE.autoDispatch, ...config.autoDispatch } };
  const world = { prs, findings: {}, status: 200 };
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.fetch.push({ url, auth: opts.headers.authorization, tool: body.params.name, args: body.params.arguments });
    if (world.status !== 200) { const s = world.status; if (s === 401 && opts.headers.authorization === `Bearer ${TOKEN}-2`) world.status = 200; else return { status: s, ok: false, headers: new Headers(), text: async () => '' }; }
    const out = body.params.name === 'review_list_prs' ? world.prs : world.findings[`${body.params.arguments.repo}#${body.params.arguments.number}`] ?? [];
    return { status: 200, ok: true, headers: new Headers({ 'content-type': 'application/json' }), text: async () => JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify(out) }] } }) };
  };
  const tasksApi = {
    list: () => rows,
    get: id => rows.find(t => t.id === id),
    tick: () => { calls.ticks++; },
    add: input => {
      if (failAdd.includes(input.provider)) throw new Error(`${input.provider} is turned off in Setup.`);
      const t = { id: `t${rows.length + 1}`, title: input.title, text: input.text, status: 'waiting', provider: input.provider, model: input.model, cwd: input.cwd, newSession: !!input.newSession };
      rows.push(t);
      calls.added.push(t);
      return t;
    },
  };
  const exists = p => dirs === true ? true : !!dirs && dirs.includes(p);
  const d = M.createAutoDispatcher({ tasks: tasksApi, getConfig: () => cfg, fetchImpl, getToken: () => `${TOKEN}${calls.token++ ? `-${calls.token}` : ''}`, now: () => clock.t, stateFile: path.join(dir, 'state.json'), boardFile: path.join(dir, 'board.jsonl'), exists, mcpUrl: 'http://review.invalid/mcp' });
  const board = () => { try { return fs.readFileSync(path.join(dir, 'board.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; } };
  return { d, rows, calls, world, clock, cfg, board, stateFile: path.join(dir, 'state.json') };
}

console.log('filtering');
{
  const list = [
    pr('G-A-R-D-E-N/godot', 52), pr('G-A-R-D-E-N/godot', 14), pr('G-A-R-D-E-N/godot', 50), pr('G-A-R-D-E-N/godot', 30), pr('G-A-R-D-E-N/godot', 51),
    pr('G-A-R-D-E-N/Garden-Engine', 1486), pr('G-A-R-D-E-N/Garden-Engine', 1548), pr('G-A-R-D-E-N/Garden-Engine', 1577), pr('G-A-R-D-E-N/Garden-Engine', 1611), pr('G-A-R-D-E-N/Garden-Engine', 1612), pr('G-A-R-D-E-N/Garden-Engine', 1614), pr('G-A-R-D-E-N/Garden-Engine', 1615),
    pr('G-A-R-D-E-N/Garden-Engine', 7, { author: 'darkstar4027' }), pr('G-A-R-D-E-N/Garden-Engine', 8, { author: 'DarkStar4027' }),
    pr('x/y', 1, { ci: 'success', open_findings: 0 }), pr('x/y', 2, { ci: 'success', open_findings: 3 }), pr('x/y', 3, { author: 'someone' }), pr('x/y', 4),
  ].map(M.normalizePr);
  const got = M.selectQueue(list).map(M.prKey).sort();
  must('godot #52 stays eligible, #14-#50 excluded, #51 eligible', got.includes('G-A-R-D-E-N/godot#52') && got.includes('G-A-R-D-E-N/godot#51') && !got.some(k => /godot#(14|30|50)$/.test(k)), got.join(','));
  must('Garden-Engine 1486/1548/1577/1611/1612/1614 excluded, 1615 eligible', !got.some(k => /Garden-Engine#(1486|1548|1577|1611|1612|1614)$/.test(k)) && got.includes('G-A-R-D-E-N/Garden-Engine#1615'));
  must('darkstar4027 excluded in any case', !got.some(k => /Garden-Engine#[78]$/.test(k)));
  must('only failing CI or open findings from NomadsReach', JSON.stringify(got.filter(k => k.startsWith('x/y'))) === '["x/y#2","x/y#4"]', got.join(','));
}

console.log('poller, token and state');
{
  const r = rig({ prs: [pr('a/b', 1)], config: { autoDispatch: { freebuffSlots: 0 } } });
  r.world.status = 401;
  const s1 = await r.d.poll();
  must('HTTP 401 refreshes the token once and retries', r.calls.token === 2 && r.calls.fetch.length === 2 && r.calls.fetch[1].auth === `Bearer ${TOKEN}-2` && !s1.lastError, JSON.stringify({ t: r.calls.token, e: s1.lastError }));
  await r.d.poll();
  must('token is cached between polls', r.calls.token === 2);
  r.clock.t += 5 * MINUTE;
  await r.d.poll();
  must('token is re-read after 4 minutes', r.calls.token === 3);
  must('MCP tool names and arguments', r.calls.fetch.every(c => c.tool === 'review_list_prs') && r.calls.fetch[0].url === 'http://review.invalid/mcp');
  must('token never reaches the snapshot or the state file', !JSON.stringify(r.d.snapshot()).includes(TOKEN) && !fs.readFileSync(r.stateFile, 'utf8').includes(TOKEN));
  const bad = rig({ prs: [pr('a/b', 1)] });
  bad.world.status = 500;
  const s = await bad.d.poll();
  must('a failed poll records lastError and dispatches nothing', /HTTP 500/.test(s.lastError ?? '') && bad.calls.added.length === 0);
  const fresh = fs.existsSync(r.stateFile) ? JSON.parse(fs.readFileSync(r.stateFile, 'utf8')) : null;
  must('state file has tracked, lastPollAt, lastError and no leftover temp file', fresh && fresh.tracked['a/b#1'] && fresh.lastPollAt && 'lastError' in fresh && !fs.existsSync(`${r.stateFile}.tmp`));
}

console.log('prompt and findings');
{
  const r = rig({ prs: [pr('a/b', 5, { ci: 'success', open_findings: 2 })] });
  r.world.findings['a/b#5'] = [{ severity: 'high', file: 'x.cs', line: 9, title: 'Null deref' }, { severity: 'low', title: 'Old', status: 'resolved' }];
  await r.d.poll();
  const text = r.calls.added[0]?.text ?? '';
  must('review_get_findings is called for PRs with open findings', r.calls.fetch.some(c => c.tool === 'review_get_findings' && c.args.number === 5));
  must('prompt names repo, PR, branch, findings and the safety rules', /a\/b#5/.test(text) && /fix-5/.test(text) && /Null deref/.test(text) && !/Old/.test(text) && /Never merge/.test(text) && /no Co-Authored-By/.test(text) && /inline \/\/ comments/.test(text) && /compiled builds/.test(text));
  must('task title carries the repo#number for the lock', r.calls.added[0].title === 'Fix PR a/b#5');
}

console.log('lock, cooldown, cap, escalation, reset');
{
  const r = rig({ prs: [pr('a/b', 1)] });
  await r.d.poll();
  must('first poll dispatches once', r.calls.added.length === 1 && r.d.snapshot().tracked['a/b#1'].attempts === 1);
  await r.d.poll();
  must('per-PR lock: no second task while the first is live', r.calls.added.length === 1 && r.d.snapshot().queue[0].status === 'active');
  r.rows[0].status = 'failed'; r.rows[0].endedAt = new Date(r.clock.t).toISOString();
  r.clock.t += 2 * MINUTE;
  await r.d.poll();
  must('cooldown: no re-dispatch inside 5 minutes', r.calls.added.length === 1 && r.d.snapshot().queue[0].status === 'cooldown');
  r.clock.t += 4 * MINUTE;
  await r.d.poll();
  must('second attempt after the cooldown', r.calls.added.length === 2 && r.d.snapshot().tracked['a/b#1'].attempts === 2);
  r.rows[1].status = 'failed'; r.rows[1].endedAt = new Date(r.clock.t).toISOString();
  r.clock.t += 6 * MINUTE;
  await r.d.poll();
  const e = r.d.snapshot().tracked['a/b#1'];
  must('third strike escalates instead of dispatching', r.calls.added.length === 2 && e.escalatedAt && r.d.snapshot().escalatedCount === 1);
  must('one escalation note on the board', r.board().length === 1 && r.board()[0].type === 'escalation' && /a\/b#1/.test(r.board()[0].text));
  r.clock.t += 6 * MINUTE;
  await r.d.poll();
  must('escalated PR is left alone and not re-posted', r.calls.added.length === 2 && r.board().length === 1);
  r.world.prs = [pr('a/b', 1, { ci: 'success' })];
  await r.d.poll();
  const g = r.d.snapshot().tracked['a/b#1'];
  must('green PR resets attempts and escalation', g.attempts === 0 && !g.escalatedAt);
  r.world.prs = [pr('a/b', 1)];
  r.clock.t += 6 * MINUTE;
  await r.d.poll();
  must('a PR that fails again starts a new cycle', r.calls.added.length === 3);
}
{
  const r = rig({ prs: [pr('a/b', 1)] });
  await r.d.poll();
  r.rows[0].status = 'failed'; r.rows[0].endedAt = new Date(r.clock.t - 20 * MINUTE).toISOString();
  r.clock.t += 10 * MINUTE;
  r.world.prs = [pr('a/b', 1, { head_sha: 'pushed-by-user' })];
  await r.d.poll();
  must('head changed by someone else resets attempts for a fresh cycle', r.calls.added.length === 2 && r.d.snapshot().tracked['a/b#1'].attempts === 1);
  r.clock.t += 6 * MINUTE; r.rows[1].status = 'done'; r.rows[1].endedAt = new Date(r.clock.t - MINUTE).toISOString();
  r.world.prs = [pr('a/b', 1, { head_sha: 'pushed-by-agent' })];
  await r.d.poll();
  must('head pushed by the agent that just finished keeps the attempt count', r.d.snapshot().tracked['a/b#1'].attempts === 2 && r.calls.added.length === 3, JSON.stringify(r.d.snapshot().tracked['a/b#1']));
}
{
  const r = rig({ prs: [pr('a/b', 1, { updated_at: new Date().toISOString() })] });
  await r.d.poll();
  r.rows[0].status = 'failed'; r.rows[0].endedAt = new Date(r.clock.t).toISOString();
  r.clock.t += 6 * MINUTE;
  r.world.prs = [pr('a/b', 1, { updated_at: new Date(r.clock.t - 60000).toISOString() })];
  await r.d.poll();
  must('a push in the last 5 minutes delays the next dispatch', r.calls.added.length === 1 && r.d.snapshot().queue[0].status === 'cooldown');
}

{
  const r = rig({ prs: [pr('a/b', 1)] });
  for (let round = 0; round < 2; round++) {
    r.world.prs = [pr('a/b', 1)];
    await r.d.poll();
    r.rows.at(-1).status = 'failed'; r.rows.at(-1).endedAt = new Date(r.clock.t).toISOString();
    r.clock.t += 6 * MINUTE;
    r.world.prs = [pr('a/b', 1, { ci: 'pending' })];
    await r.d.poll();
    r.clock.t += 6 * MINUTE;
  }
  r.world.prs = [pr('a/b', 1)];
  await r.d.poll();
  must('failure, pending, failure still reaches the cap and escalates', r.calls.added.length === 2 && r.d.snapshot().tracked['a/b#1'].escalatedAt && r.board().length === 1, JSON.stringify(r.d.snapshot().tracked['a/b#1']));
  const again = M.createAutoDispatcher({ tasks: { list: () => r.rows, get: id => r.rows.find(t => t.id === id), add: () => { throw new Error('must not add'); } }, getConfig: () => r.cfg, fetchImpl: async () => ({ status: 200, ok: true, headers: new Headers(), text: async () => JSON.stringify({ result: { content: [{ type: 'text', text: JSON.stringify([pr('a/b', 1)]) }] } }) }), getToken: () => TOKEN, now: () => r.clock.t, stateFile: r.stateFile, boardFile: path.join(tmp, 'again.jsonl') });
  must('attempts and escalation survive a restart', again.snapshot().tracked['a/b#1'].attempts === 2 && !!again.snapshot().tracked['a/b#1'].escalatedAt);
  await again.poll();
  must('a restarted dispatcher does not dispatch an escalated PR', again.snapshot().escalatedCount === 1);
}
{
  const r = rig({ prs: [pr('a/b', 1)] });
  await r.d.poll();
  r.rows[0].status = 'interrupted';
  r.clock.t += 10 * MINUTE;
  await r.d.poll();
  must('an interrupted task still holds the PR lock', r.calls.added.length === 1 && r.d.snapshot().queue[0].status === 'active');
  const bad = rig({ prs: { oops: true } });
  const s = await bad.d.poll();
  must('an unknown response shape is an error, not an empty list', /unknown PR list shape/.test(s.lastError ?? '') && bad.calls.added.length === 0);
  const twice = rig({ prs: [pr('a/b', 1)] });
  twice.world.status = 401;
  twice.calls.token = 0;
  const failing = M.createAutoDispatcher({ tasks: { list: () => [], get: () => null, add: () => { throw new Error('no'); } }, getConfig: () => twice.cfg, fetchImpl: async () => { twice.calls.fetch.push(1); return { status: 401, ok: false, headers: new Headers(), text: async () => '' }; }, getToken: () => TOKEN, stateFile: path.join(tmp, 'twice.json'), boardFile: path.join(tmp, 'twice.jsonl') });
  const t = await failing.poll();
  must('a second 401 stops with an error and no retry loop', /HTTP 401/.test(t.lastError ?? '') && twice.calls.fetch.length === 2);
  const sse = M.createAutoDispatcher({ tasks: { list: () => [], get: () => null, add: () => { throw new Error('no'); } }, getConfig: () => twice.cfg, fetchImpl: async () => ({ status: 200, ok: true, headers: new Headers({ 'content-type': 'text/event-stream' }), text: async () => ['event: message', 'data: ' + JSON.stringify({ result: { structuredContent: { prs: [pr('a/b', 1)] } } }), ''].join(String.fromCharCode(10)) }), getToken: () => TOKEN, stateFile: path.join(tmp, 'sse.json'), boardFile: path.join(tmp, 'sse.jsonl') });
  const q = await sse.poll();
  must('an event-stream reply with structuredContent is read', q.queue.length === 1 && !q.lastError, JSON.stringify(q));
  const corrupt = path.join(tmp, 'corrupt.json');
  fs.writeFileSync(corrupt, JSON.stringify({ tracked: null }));
  const c = M.createAutoDispatcher({ tasks: { list: () => [], get: () => null }, getConfig: () => twice.cfg, getToken: () => TOKEN, stateFile: corrupt, boardFile: path.join(tmp, 'c.jsonl') });
  must('a corrupt state file starts clean', Object.keys(c.snapshot().tracked).length === 0);
}
{
  const r = rig({ prs: [pr('a/b', 1)] });
  let allowed = false;
  const d = M.createAutoDispatcher({ tasks: { list: () => r.rows, get: () => null, add: () => { throw new Error('must not add'); } }, getConfig: () => r.cfg, canRun: () => allowed, fetchImpl: async () => { throw new Error('must not fetch'); }, getToken: () => TOKEN, stateFile: path.join(tmp, 'nolock.json'), boardFile: path.join(tmp, 'nolock.jsonl') });
  const s = await d.poll();
  must('without the dispatcher lock a poll does nothing', s.canRun === false && s.lastPollAt === null && !s.lastError);
}

console.log('slot filling');
{
  const prs = Array.from({ length: 14 }, (_, i) => pr('a/b', i + 1));
  const r = rig({ prs });
  const s = await r.d.poll();
  const by = p => r.calls.added.filter(t => t.provider === p);
  must('5 Freebuff newSession slots first', by('freebuff').length === 5 && by('freebuff').every(t => t.newSession && !t.model) && r.calls.added.slice(0, 5).every(t => t.provider === 'freebuff'));
  must('spill order claude, cursor, opencode, codex', JSON.stringify(r.calls.added.slice(5).map(t => t.provider)) === JSON.stringify(['claude', 'cursor', 'opencode', 'opencode', 'codex', 'codex']), JSON.stringify(r.calls.added.slice(5).map(t => t.provider)));
  must('models: sonnet, composer-2.5, opencode free, gpt-6.1-terra', by('claude')[0].model === 'sonnet' && by('cursor')[0].model === 'composer-2.5' && by('opencode').every(t => t.model === 'opencode/deepseek-v4.1-flash-free') && by('codex').every(t => t.model === 'gpt-6.1-terra'));
  must('gpt-6-astra is never used', !r.calls.added.some(t => /astra/i.test(String(t.model))));
  must('PRs beyond every limit stay queued', s.queueCount === 3 && s.queue.filter(q => q.status === 'no-slot').length === 3, JSON.stringify(s.queue.map(q => q.status)));
  must('each task got ticked', r.calls.ticks === 11);
}
{
  const live = Array.from({ length: 4 }, (_, i) => ({ id: `fb${i}`, title: `other ${i}`, status: i % 2 ? 'running' : 'starting', provider: 'freebuff', ranOn: 'freebuff' }));
  const r = rig({ prs: Array.from({ length: 6 }, (_, i) => pr('a/b', i + 1)), tasks: live });
  await r.d.poll();
  must('live Freebuff tasks count against the 5 slots', r.calls.added.filter(t => t.provider === 'freebuff').length === 1 && r.calls.added[1].provider === 'claude');
}
{
  const live = Array.from({ length: 28 }, (_, i) => ({ id: `o${i}`, title: `other ${i}`, status: ['running', 'starting', 'waiting', 'queued'][i % 4], provider: 'codex', ranOn: 'codex' }));
  const r = rig({ prs: Array.from({ length: 6 }, (_, i) => pr('a/b', i + 1)), tasks: live, config: { maxParallel: { codex: 99 } } });
  const s = await r.d.poll();
  must('stops at 30 live sessions in total', r.calls.added.length === 2 && s.activeCount === 30 && s.queueCount === 4, `${r.calls.added.length} ${s.activeCount} ${s.queueCount}`);
}
{
  const r = rig({ prs: [pr('a/b', 1), pr('a/b', 2)], config: { providers: { freebuff: false, claude: false, cursor: false, opencode: true, codex: true } } });
  await r.d.poll();
  must('providers that are turned off are skipped', r.calls.added.map(t => t.provider).join() === 'opencode,opencode');
  const f = rig({ prs: [pr('a/b', 1)], failAdd: ['freebuff'] });
  await f.d.poll();
  must('a refused Freebuff add spills to the next provider', f.calls.added.length === 1 && f.calls.added[0].provider === 'claude');
}
{
  const repoDir = path.join(tmp, 'repos', 'b');
  const r = rig({ prs: [pr('a/b', 1), pr('a/none', 2)], dirs: [repoDir, path.join(tmp, 'mapped')], config: { autoDispatch: { repoDirs: { 'a/b': path.join(tmp, 'mapped') } } } });
  const s = await r.d.poll();
  must('cwd comes from repoDirs and a missing checkout is skipped with a reason', r.calls.added.length === 1 && r.calls.added[0].cwd === path.join(tmp, 'mapped') && s.queue.find(q => q.repo === 'a/none').status === 'no-checkout' && /repoDirs/.test(s.queue.find(q => q.repo === 'a/none').detail));
  const p = rig({ prs: [pr('a/b', 1)], dirs: [path.join(tmp, 'b')] });
  await p.d.poll();
  must('cwd falls back to a folder named after the repo under projectDir', p.calls.added[0]?.cwd === path.join(tmp, 'b'));
}

console.log('routes and timer');
{
  const r = rig({ prs: [pr('a/b', 1)], config: { autoDispatch: { enabled: false } } });
  let canRun = true, saved = 0;
  const readBody = req => new Promise(ok => { let b = ''; req.on('data', c => { b += c; }); req.on('end', () => ok(b)); });
  const send = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const handler = M.autoDispatchRoute({ dispatcher: r.d, getConfig: () => r.cfg, saveConfig: patch => { saved++; r.cfg.autoDispatch = { ...r.cfg.autoDispatch, ...patch.autoDispatch }; }, readBody, send });
  const gated = M.createAutoDispatcher({ tasks: { list: () => [], get: () => null, add: () => { throw new Error('no'); } }, getConfig: () => r.cfg, canRun: () => canRun, fetchImpl: async () => ({ status: 500, ok: false, headers: new Headers(), text: async () => '' }), getToken: () => TOKEN, stateFile: path.join(tmp, 'gated.json'), boardFile: path.join(tmp, 'gated-board.jsonl') });
  const server = http.createServer(async (req, res) => { const u = new URL(req.url, 'http://x'); if (!(await handler({ req, res, u }))) send(res, 404, {}); });
  await new Promise(ok => server.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${server.address().port}/auto-dispatch`;
  const get = async () => (await fetch(url)).json();
  const post = async body => { const x = await fetch(url, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }); return { code: x.status, body: await x.json() }; };

  const off = await get();
  must('GET reports the shape with the toggle off', off.enabled === false && ['queueCount', 'activeCount', 'escalatedCount', 'lastPollAt', 'lastError', 'queue', 'tracked'].every(k => k in off) && !JSON.stringify(off).includes(TOKEN));
  const on = await post({ enabled: true });
  must('POST enabled:true saves, starts a poll and returns the snapshot', on.code === 200 && on.body.enabled === true && r.cfg.autoDispatch.enabled === true && r.calls.added.length === 1 && on.body.queue.length === 1 && on.body.lastPollAt, JSON.stringify(on.body));
  must('the 60 s timer runs only while enabled', r.d.timerRunning() === true);
  const offAgain = await post({ enabled: false });
  must('POST enabled:false saves and clears the timer', offAgain.body.enabled === false && r.d.timerRunning() === false);
  must('a bad body is refused', (await post('{bad')).code === 400 && (await post({ enabled: 'yes' })).code === 400 && (await post({ maxAttempts: 0 })).code === 400);
  const settings = await post({ maxAttempts: 3, repoDirs: { 'a/b': tmp } });
  must('numeric and repoDirs settings are saved', r.cfg.autoDispatch.maxAttempts === 3 && r.cfg.autoDispatch.repoDirs['a/b'] === tmp && settings.code === 200);
  must('a dispatcher that may run starts its timer when enabled', r.cfg.autoDispatch.enabled === false && (r.cfg.autoDispatch.enabled = true) && gated.sync() === true && gated.timerRunning() === true);
  gated.stop();
  canRun = false;
  must('no timer when this panel does not hold the dispatcher lock', gated.sync() === false && gated.timerRunning() === false);
  r.d.stop();
  server.close();
  must('saveConfig runs only for real changes', saved === 3, String(saved));
}

console.log('config defaults');
{
  const cfgDir = fs.mkdtempSync(path.join(tmp, 'cfg-'));
  fs.writeFileSync(path.join(cfgDir, 'config.json'), JSON.stringify({ autoDispatch: { enabled: true, repoDirs: { 'a/b': 'C:/x' } } }));
  const child = spawn(process.execPath, ['--input-type=module', '-e', `import { config, saveConfig, DEFAULTS } from ${JSON.stringify(pathToFileURL(path.join(repo, 'lib', 'config.mjs')).href)}; const c = config(); const s = saveConfig({ autoDispatch: { cooldownMs: 1 } }); console.log(JSON.stringify({ d: DEFAULTS.autoDispatch, c: c.autoDispatch, s: s.autoDispatch }));`], { env: { ...process.env, CC_ROOT: cfgDir }, stdio: ['ignore', 'pipe', 'inherit'] });
  let out = ''; child.stdout.on('data', x => { out += x; });
  await new Promise(ok => child.on('close', ok));
  const o = JSON.parse(out);
  must('autoDispatch defaults', JSON.stringify(o.d) === JSON.stringify({ enabled: false, intervalMs: 60000, cooldownMs: 300000, maxAttempts: 2, maxTotalSessions: 30, freebuffSlots: 5, repoDirs: {} }));
  must('saved autoDispatch merges over defaults and survives a save', o.c.enabled === true && o.c.maxAttempts === 2 && o.c.repoDirs['a/b'] === 'C:/x' && o.s.cooldownMs === 1 && o.s.enabled === true && o.s.repoDirs['a/b'] === 'C:/x');
}

console.log('real server routes');
{
  const root = fs.mkdtempSync(path.join(tmp, 'panel-'));
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ setupDone: true, providers: { freebuff: false, codex: false, cursor: false, opencode: false, claude: false }, projectDir: root, reportsDir: path.join(root, 'reports') }));
  const port = await new Promise(ok => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
  let seen = 0;
  const review = http.createServer((req, res) => { seen++; res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ result: { content: [{ type: 'text', text: '[]' }] } })); });
  await new Promise(ok => review.listen(0, '127.0.0.1', ok));
  const child = spawn(process.execPath, [path.join(repo, 'viewer', 'server.mjs')], { cwd: root, windowsHide: true, stdio: 'ignore', env: { ...process.env, CC_ROOT: root, PORT: String(port), CC_NO_DISPATCH: '1', PR_REVIEW_MCP_URL: `http://127.0.0.1:${review.address().port}/mcp` } });
  const base = `http://127.0.0.1:${port}`;
  try {
    let up = false;
    for (let i = 0; i < 100 && !up && child.exitCode == null; i++) { try { up = (await fetch(`${base}/auto-dispatch`, { signal: AbortSignal.timeout(1500) })).ok; } catch { await sleep(250); } }
    must('the panel answers GET /auto-dispatch', up);
    if (up) {
      const g = await (await fetch(`${base}/auto-dispatch`)).json();
      must('server GET starts disabled with an empty queue', g.enabled === false && g.queueCount === 0 && Array.isArray(g.queue));
      const p = await fetch(`${base}/auto-dispatch`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true }) });
      const b = await p.json();
      const saved = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
      must('server POST saves config.json; no poll without the dispatcher lock', p.status === 200 && b.enabled === true && b.canRun === false && saved.autoDispatch.enabled === true && b.lastPollAt === null && seen === 0, JSON.stringify(b));
      const d = await (await fetch(`${base}/director?no-gh=1`)).text();
      must('/director and /auto-dispatch carry no token', !/(gh[pous]_[A-Za-z0-9]{20,}|bearer\s)/i.test(d + JSON.stringify(b)));
      const off = await (await fetch(`${base}/auto-dispatch`, { method: 'POST', body: JSON.stringify({ enabled: false }) })).json();
      must('server POST off', off.enabled === false && JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8')).autoDispatch.enabled === false);
    }
  } finally { const closed = new Promise(ok => child.once('close', ok)); child.kill(); await closed; review.close(); }
}

if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\nall pr-auto-dispatch checks passed');

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from './config.mjs';

export const STATE_FILE = path.join(ROOT, 'state', 'pr-auto-dispatch.json');
export const DEFAULT_MCP_URL = 'https://git1.nomadicinteractive.dev/review/mcp';
export const ACTIVE = ['running', 'starting', 'waiting', 'queued'];
const LOCKING = [...ACTIVE, 'interrupted'];
const MODELS = {
  claude: { provider: 'claude', model: 'sonnet' },
  cursor: { provider: 'cursor', model: 'composer-2.5' },
  opencode: { provider: 'opencode', model: 'opencode/deepseek-v4.1-flash-free' },
  codex: { provider: 'codex', model: 'gpt-6-sol' },
  freebuff: { provider: 'freebuff' },
};
const codexModel = m => m && !/astra/i.test(m) ? m : MODELS.codex.model;
const ROUTES = {
  heavy: ['claude', 'cursor', 'codex', 'freebuff', 'opencode'],
  light: ['freebuff', 'opencode', 'cursor', 'claude', 'codex'],
  medium: ['freebuff', 'cursor', 'opencode', 'claude', 'codex'],
};
const HEAVY = /c\+\+|c#|radicle|hkx|previs|opencw|godot|physics|(?<![a-z])(abi|nif|rig|save)s?(?![a-z])/i;

export function routeClass(pr, entry) {
  if ((entry?.attempts ?? 0) >= 1 || pr.open_findings >= 5 || HEAVY.test(`${pr.title} ${pr.branch}`)) return 'heavy';
  return pr.ci !== 'failure' && pr.open_findings <= 2 ? 'light' : 'medium';
}

export const routeChain = (pr, entry, usable, codex) => ROUTES[routeClass(pr, entry)].filter(usable).map(p => p === 'codex' ? { ...MODELS.codex, model: codexModel(codex) } : MODELS[p]);

const AUTHOR = 'nomadsreach';
const TOKEN_TTL = 240000;
const GODOT = 'g-a-r-d-e-n/godot';
const ENGINE = 'g-a-r-d-e-n/garden-engine';
const ENGINE_EXCLUDED = new Set([1486, 1548, 1577, 1611, 1612, 1614]);

export const prKey = pr => `${pr.repo}#${pr.number}`;

export function normalizePr(p) {
  return {
    repo: String(p.repo ?? p.repository ?? p.full_name ?? ''),
    number: Number(p.number ?? p.pr ?? p.pr_number),
    author: String(p.author?.login ?? p.author ?? ''),
    ci: String(p.ci ?? p.ci_status ?? '').toLowerCase(),
    open_findings: Number(p.open_findings ?? p.openFindings ?? 0) || 0,
    title: String(p.title ?? ''),
    branch: String(p.branch ?? p.head_ref ?? p.headRefName ?? ''),
    headSha: String(p.head_sha ?? p.headSha ?? p.sha ?? ''),
    updatedAt: p.updated_at ?? p.updatedAt ?? null,
  };
}

export function isExcluded(pr) {
  const repo = pr.repo.toLowerCase();
  if (pr.author.toLowerCase() === 'darkstar4027') return true;
  if (repo === GODOT && pr.number >= 14 && pr.number <= 50) return true;
  return repo === ENGINE && ENGINE_EXCLUDED.has(pr.number);
}

export const selectQueue = prs => prs.filter(pr => pr.repo && Number.isInteger(pr.number) && !isExcluded(pr)
  && pr.author.toLowerCase() === AUTHOR && (pr.ci === 'failure' || pr.open_findings > 0));

const reasonOf = pr => [pr.ci === 'failure' ? 'ci failing' : '', pr.open_findings > 0 ? `${pr.open_findings} open finding(s)` : ''].filter(Boolean).join(' + ');

export function ghToken() {
  const r = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8', timeout: 15000, windowsHide: true });
  const t = String(r.stdout ?? '').trim();
  if (r.status !== 0 || !t) throw new Error('gh auth token returned no token');
  return t;
}

const unwrap = body => {
  const res = body?.result;
  if (!res) throw new Error(body?.error?.message ?? 'The review service sent no result.');
  if (res.isError) throw new Error(String(res.content?.[0]?.text ?? 'The review service reported an error.').slice(0, 200));
  if (res.structuredContent) return res.structuredContent;
  const text = res.content?.find(c => c.type === 'text')?.text;
  return text ? JSON.parse(text) : res;
};

async function readRpc(r) {
  const raw = await r.text();
  if (!/event-stream/i.test(r.headers?.get?.('content-type') ?? '')) return JSON.parse(raw);
  const data = raw.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).filter(Boolean).at(-1);
  return JSON.parse(data ?? '{}');
}

const fresh = () => ({ tracked: {}, lastPollAt: null, lastError: null });

export function createAutoDispatcher(deps) {
  const { tasks, getConfig, canRun = () => true } = deps;
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const readToken = deps.getToken ?? ghToken;
  const now = deps.now ?? Date.now;
  const stateFile = deps.stateFile ?? STATE_FILE;
  const boardFile = deps.boardFile ?? path.join(ROOT, 'board.jsonl');
  const exists = deps.exists ?? (p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } });
  const mcpUrl = () => deps.mcpUrl ?? process.env.PR_REVIEW_MCP_URL ?? DEFAULT_MCP_URL;
  const cfg = () => ({ enabled: false, intervalMs: 60000, cooldownMs: 300000, maxAttempts: 2, maxTotalSessions: 30, freebuffSlots: 5, repoDirs: {}, ...getConfig().autoDispatch });

  let token = null, tokenAt = 0, timer = null, polling = null, queue = [];
  let state = (() => { try { return { ...fresh(), ...JSON.parse(fs.readFileSync(stateFile, 'utf8')) }; } catch { return fresh(); } })();

  if (!state.tracked || typeof state.tracked !== 'object') state.tracked = {};

  const save = () => {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(`${stateFile}.tmp`, JSON.stringify(state, null, 2));
    fs.renameSync(`${stateFile}.tmp`, stateFile);
  };

  const bearer = force => {
    if (force || !token || now() - tokenAt > TOKEN_TTL) { token = readToken(); tokenAt = now(); }
    return token;
  };

  async function call(name, args) {
    for (let attempt = 0; ; attempt++) {
      const r = await fetchImpl(mcpUrl(), {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${bearer(attempt > 0)}` },
        body: JSON.stringify({ jsonrpc: '2.0', id: now(), method: 'tools/call', params: { name, arguments: args } }),
        signal: AbortSignal.timeout(20000),
      });
      if (r.status === 401 && attempt === 0) { token = null; continue; }
      if (!r.ok) throw new Error(`The review service answered HTTP ${r.status}.`);
      return unwrap(await readRpc(r));
    }
  }

  const listPrs = async () => {
    const out = await call('review_list_prs', {});
    const rows = Array.isArray(out) ? out : out?.pull_requests ?? out?.prs ?? out?.items;
    if (!Array.isArray(rows)) throw new Error('The review service sent an unknown PR list shape.');
    return rows.map(normalizePr);
  };

  const extractFindings = out => {
    if (Array.isArray(out)) return out;
    if (Array.isArray(out?.findings)) return out.findings;
    if (out?.models && typeof out.models === 'object') {
      return Object.entries(out.models).flatMap(([model, list]) => Array.isArray(list) ? list.map(f => ({ ...f, model })) : []);
    }
    return [];
  };

  const isFindingOpen = f => typeof f?.counts_open === 'boolean' ? f.counts_open : !/^(resolved|closed|dismissed|held)$/i.test(String(f?.status ?? ''));

  const findingsText = async pr => {
    try {
      const out = await call('review_get_findings', { repo: pr.repo, number: pr.number });
      const rows = extractFindings(out).filter(isFindingOpen);
      return rows.slice(0, 20).map((f, i) => {
        const tag = f.id ? `${f.model ? `${f.model} ` : ''}${f.id}` : f.model ?? '';
        const file = f.path ?? f.file;
        const loc = file ? `${file}${f.line ? `:${f.line}` : ''}` : '';
        return `${i + 1}. ${[tag, f.severity, loc, f.title ?? f.summary ?? f.message].filter(Boolean).join(' | ')}`.slice(0, 400);
      }).join('\n');
    } catch { return ''; }
  };

  const liveTasks = () => tasks.list().filter(t => ACTIVE.includes(t.status));
  const providerOf = t => t.ranOn || t.provider;
  const titleHas = (t, key) => new RegExp(`(^|[^\\w/.-])${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\d)`).test(String(t.title ?? ''));
  const hasLiveTask = (key, entry) => tasks.list().some(t => LOCKING.includes(t.status) && (t.id === entry?.lastTaskId || titleHas(t, key)));

  function resolveCwd(repo) {
    const c = cfg(), name = repo.split('/').pop();
    const mapped = Object.entries(c.repoDirs ?? {}).find(([k]) => k.toLowerCase() === repo.toLowerCase())?.[1];
    const dirs = [mapped, getConfig().projectDir && path.join(getConfig().projectDir, name), getConfig().projectDir && path.join(getConfig().projectDir, repo)];
    return dirs.filter(Boolean).find(exists) ?? null;
  }

  async function buildPrompt(pr, reason, attempt) {
    const findings = pr.open_findings > 0 ? await findingsText(pr) : '';
    const branchStep = pr.branch
      ? `- Check out the PR branch ${pr.branch} in your own worktree and push fixes to that same branch. Never merge the PR.`
      : `- Resolve the PR branch via \`gh pr view ${pr.number} --repo ${pr.repo} --json headRefName\`, check it out in your own worktree, and push fixes to that branch. Never merge the PR.`;
    return [
      `Fix pull request ${prKey(pr)}${pr.title ? ` (${pr.title})` : ''} on branch ${pr.branch || '(see the PR)'}. Auto-dispatch attempt ${attempt}.`,
      `Why it was picked: ${reason}.`,
      pr.ci === 'failure' ? 'CI is failing: read the failing checks for this PR and fix the cause, not the symptom.' : null,
      findings ? `Open review findings:\n${findings}` : pr.open_findings > 0 ? `The review bot reports ${pr.open_findings} open finding(s); read them in the review service.` : null,
      '',
      'Rules:',
      branchStep,
      '- Do not run local compiled builds; rely on the checks the repository already defines.',
      '- Commits are authored by the user only: no Co-Authored-By trailer and no AI attribution.',
      '- Do not add inline // comments to code.',
      '- Do not touch darkstar4027 branches or files.',
    ].filter(x => x !== null).join('\n');
  }

  function escalate(pr, entry) {
    entry.escalatedAt = new Date(now()).toISOString();
    try { fs.appendFileSync(boardFile, JSON.stringify({ at: entry.escalatedAt, from: 'pr-auto-dispatch', type: 'escalation', text: `PR auto-dispatch gave up on ${prKey(pr)} after ${entry.attempts} attempts (${entry.reason}). A person needs to look at it.` }) + '\n'); } catch (e) { state.lastError = `Could not write the escalation note: ${e.message}`.slice(0, 300); }
  }

  function reconcile(candidates, all) {
    const seen = new Set(candidates.map(prKey)), heads = new Map(all.map(p => [prKey(p), p]));
    for (const [key, entry] of Object.entries(state.tracked)) {
      const pr = heads.get(key);
      if (!seen.has(key)) {
        if (pr && pr.ci === 'success' && pr.open_findings === 0 && (entry.attempts || entry.escalatedAt)) Object.assign(entry, { attempts: 0, escalatedAt: null, reason: 'green' });
        continue;
      }
      const last = entry.lastTaskId ? tasks.get?.(entry.lastTaskId) : null;
      const ours = hasLiveTask(key, entry) || (last?.endedAt && Date.parse(last.endedAt) >= (entry.lastSeenAt ?? 0));
      if (pr.headSha && entry.lastHeadSha && pr.headSha !== entry.lastHeadSha && !ours) Object.assign(entry, { attempts: 0, escalatedAt: null });
      if (pr.headSha && (ours || !entry.lastHeadSha)) entry.lastHeadSha = pr.headSha;
    }
  }

  function dispatchTo(pr, cwd, choice, text) {
    const t = tasks.add({ title: `Fix PR ${prKey(pr)}`.slice(0, 100), text, cwd, kind: 'code', provider: choice.provider, ...(choice.model ? { model: choice.model } : {}), ...(choice.provider === 'freebuff' ? { newSession: true } : {}) });
    tasks.tick?.();
    return t;
  }

  async function run() {
    const c = cfg();
    if (!c.enabled || !canRun()) return snapshot();
    let all;
    try { all = await listPrs(); }
    catch (e) { state.lastError = String(e?.message ?? e).slice(0, 300); save(); return snapshot(); }
    state.lastError = null;
    const candidates = selectQueue(all);
    reconcile(candidates, all);
    const t0 = now();
    const rows = [];
    let live = liveTasks(), total = live.length;
    const count = p => live.filter(t => providerOf(t) === p).length;
    const room = p => getConfig().providers?.[p] && count(p) < (getConfig().maxParallel?.[p] ?? 1);

    for (const pr of candidates) {
      const key = prKey(pr), reason = reasonOf(pr);
      const entry = state.tracked[key] ??= { repo: pr.repo, number: pr.number, branch: pr.branch, lastHeadSha: pr.headSha, attempts: 0, lastDispatchedAt: null, escalatedAt: null, lastTaskId: null, reason };
      Object.assign(entry, { branch: pr.branch, reason, lastSeenAt: t0 });
      const row = { repo: pr.repo, number: pr.number, branch: pr.branch, reason, status: 'queued', detail: '' };
      rows.push(row);
      if (hasLiveTask(key, entry)) { row.status = 'active'; continue; }
      if (entry.escalatedAt) { row.status = 'escalated'; continue; }
      const sinceDispatch = entry.lastDispatchedAt ? t0 - Date.parse(entry.lastDispatchedAt) : Infinity;
      const sincePush = pr.updatedAt && Date.parse(pr.updatedAt) ? t0 - Date.parse(pr.updatedAt) : Infinity;
      if (sinceDispatch < c.cooldownMs || (entry.attempts > 0 && sincePush < c.cooldownMs)) { row.status = 'cooldown'; row.detail = `Waiting out the ${Math.round(c.cooldownMs / 60000)} minute cooldown.`; continue; }
      if (entry.attempts >= c.maxAttempts) { escalate(pr, entry); row.status = 'escalated'; continue; }
      if (total >= c.maxTotalSessions) { row.status = 'no-slot'; row.detail = `${total} live sessions (max ${c.maxTotalSessions}).`; continue; }
      const cwd = resolveCwd(pr.repo);
      if (!cwd) { row.status = 'no-checkout'; row.detail = `No local checkout of ${pr.repo}. Add it to autoDispatch.repoDirs.`; continue; }
      const chain = routeChain(pr, entry, p => p === 'freebuff' ? count(p) < c.freebuffSlots && getConfig().providers?.freebuff : room(p), getConfig().models?.codex);
      let done = false, text = null;
      for (const choice of chain) {
        if (!cfg().enabled) { row.detail = 'Auto-dispatch was turned off.'; break; }
        try {
          text ??= await buildPrompt(pr, reason, entry.attempts + 1);
          if (!cfg().enabled) { row.detail = 'Auto-dispatch was turned off.'; break; }
          const t = dispatchTo(pr, cwd, choice, text);
          Object.assign(entry, { attempts: entry.attempts + 1, lastDispatchedAt: new Date(now()).toISOString(), lastTaskId: t.id, lastHeadSha: pr.headSha || entry.lastHeadSha });
          save();
          live = [...live, { ...t, status: 'waiting', provider: choice.provider }];
          total++;
          Object.assign(row, { status: 'dispatched', taskId: t.id, provider: choice.provider, model: choice.model ?? null });
          done = true;
          break;
        } catch (e) { row.detail = String(e?.message ?? e).slice(0, 200); }
      }
      if (!done && row.status === 'queued') { row.status = 'no-slot'; row.detail ||= 'No provider has a free slot.'; }
    }
    queue = rows;
    state.lastPollAt = new Date(now()).toISOString();
    save();
    return snapshot();
  }

  const poll = () => polling ??= run().finally(() => { polling = null; });

  function snapshot() {
    const waiting = queue.filter(q => !['active', 'escalated', 'dispatched'].includes(q.status));
    return {
      enabled: !!cfg().enabled,
      canRun: !!canRun(),
      queueCount: waiting.length,
      activeCount: liveTasks().length,
      escalatedCount: Object.values(state.tracked).filter(e => e.escalatedAt).length,
      lastPollAt: state.lastPollAt,
      lastError: state.lastError,
      queue: queue.map(q => ({ ...q })),
      tracked: Object.fromEntries(Object.entries(state.tracked).map(([k, e]) => [k, { ...e }])),
    };
  }

  function sync() {
    const c = cfg();
    if (timer) { clearInterval(timer); timer = null; }
    if (c.enabled && canRun()) timer = setInterval(() => { poll().catch(() => {}); }, Math.max(1000, Number(c.intervalMs) || 60000));
    return !!timer;
  }

  return { poll, snapshot, sync, stop: () => { if (timer) clearInterval(timer); timer = null; }, timerRunning: () => !!timer };
}

const NUMERIC = { intervalMs: [10000, 3600000], cooldownMs: [0, 86400000], maxAttempts: [1, 10], maxTotalSessions: [1, 60], freebuffSlots: [0, 30] };

export function parseSettings(b) {
  const out = {};
  if ('enabled' in b) {
    if (typeof b.enabled !== 'boolean') throw new Error('enabled must be true or false.');
    out.enabled = b.enabled;
  }
  for (const [k, [lo, hi]] of Object.entries(NUMERIC)) {
    if (!(k in b)) continue;
    const n = Number(b[k]);
    if (!Number.isInteger(n) || n < lo || n > hi) throw new Error(`${k} must be a whole number from ${lo} to ${hi}.`);
    out[k] = n;
  }
  if ('repoDirs' in b) {
    if (!b.repoDirs || typeof b.repoDirs !== 'object' || Array.isArray(b.repoDirs) || Object.values(b.repoDirs).some(v => typeof v !== 'string')) throw new Error('repoDirs must map "owner/repo" to a folder path.');
    out.repoDirs = b.repoDirs;
  }
  return out;
}

export const autoDispatchRoute = ({ dispatcher, getConfig, saveConfig, readBody, send }) => async ({ req, res, u }) => {
  if (u.pathname !== '/auto-dispatch') return false;
  if (req.method === 'POST') {
    let patch;
    try {
      const raw = (await readBody(req, 20000)).trim();
      const b = raw ? JSON.parse(raw) : {};
      if (!b || typeof b !== 'object' || Array.isArray(b)) throw new Error('The request body must be a JSON object.');
      patch = parseSettings(b);
    } catch (e) { return send(res, 400, { error: e.message }), true; }
    const was = !!getConfig().autoDispatch?.enabled;
    if (Object.keys(patch).length) saveConfig({ autoDispatch: patch });
    dispatcher.sync();
    if (patch.enabled && !was && dispatcher.snapshot().canRun) await dispatcher.poll().catch(() => {});
  } else if (req.method !== 'GET') return send(res, 405, { error: 'Use GET or POST.' }), true;
  return send(res, 200, dispatcher.snapshot()), true;
};

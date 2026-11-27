import { spawnSync } from 'node:child_process';
import { config } from './config.mjs';
import { findBin } from '../usage/exec.mjs';

const FIELD = 'number,title,headRefName,headRefOid,baseRefName,state,isDraft,reviewDecision,mergeable,updatedAt,url,statusCheckRollup,additions,deletions,changedFiles,author';
const PASS = ['SUCCESS', 'NEUTRAL', 'SKIPPED'];
const FAIL = ['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'STALE'];
const cache = new Map();

const gh = (cwd, args, timeout = 25000) => spawnSync('gh', args, { cwd, encoding: 'utf8', timeout, windowsHide: true, maxBuffer: 16 << 20 });

export const available = () => !!findBin('gh');

function rollup(rows) {
  const list = Array.isArray(rows) ? rows : [];
  let pass = 0, fail = 0, pending = 0;
  for (const r of list) {
    const s = String(r?.conclusion ?? r?.state ?? '').toUpperCase();
    if (!s) pending++;
    else if (PASS.includes(s)) pass++;
    else if (FAIL.includes(s)) fail++;
    else pending++;
  }
  return { total: list.length, pass, fail, pending, state: fail ? 'failing' : pending ? 'pending' : list.length ? 'passing' : 'none' };
}

export function repoName(cwd) {
  if (!available()) return null;
  const r = gh(cwd, ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']);
  return r.status === 0 ? String(r.stdout ?? '').trim() || null : null;
}

export function list(opts = {}) {
  const cwd = opts.cwd || config().projectDir || process.cwd();
  const fresh = !!opts.fresh;
  const key = cwd;
  const hit = cache.get(key);
  if (!fresh && hit && Date.now() - hit.at < 60000) return hit.value;
  const base = { available: available(), cwd: cwd.replace(/\\/g, '/'), repo: null, at: new Date().toISOString(), prs: [], error: null, note: null };
  if (!base.available) {
    base.error = 'The gh CLI is not installed or not on PATH, so pull requests and CI are not read. Install it from https://cli.github.com and sign in once.';
    cache.set(key, { at: Date.now(), value: base });
    return base;
  }
  const repo = opts.repo || repoName(cwd);
  base.repo = repo;
  if (!repo) {
    base.error = `gh is installed but ${cwd} is not a GitHub repository it knows. Pick a folder that is one.`;
    cache.set(key, { at: Date.now(), value: base });
    return base;
  }
  const args = ['pr', 'list', '--repo', repo, '--limit', String(Math.min(50, Math.max(1, opts.limit ?? 25))), '--json', FIELD, '--state', opts.state ?? 'open'];
  const r = gh(cwd, args);
  if (r.status !== 0) {
    base.error = `gh pr list failed: ${String(r.stderr || r.stdout || 'no output').trim().slice(0, 300)}`;
    base.why = r.error?.message ?? null;
    cache.set(key, { at: Date.now(), value: base });
    return base;
  }
  let rows = [];
  try { rows = JSON.parse(r.stdout || '[]'); } catch (e) { base.error = `gh returned unreadable JSON: ${e.message}`; cache.set(key, { at: Date.now(), value: base }); return base; }
  base.prs = rows.map(p => {
    const ci = rollup(p.statusCheckRollup);
    return {
      number: p.number,
      title: p.title,
      author: p.author?.login ?? null,
      head: p.headRefName,
      headSha: p.headRefOid ? String(p.headRefOid).slice(0, 12) : null,
      headShaFull: p.headRefOid ?? null,
      base: p.baseRefName ?? null,
      draft: !!p.isDraft,
      state: p.state,
      review: p.reviewDecision || 'NONE',
      mergeable: p.mergeable ?? null,
      url: p.url,
      updatedAt: p.updatedAt,
      additions: p.additions ?? null,
      deletions: p.deletions ?? null,
      changedFiles: p.changedFiles ?? null,
      ci,
      evidence: {
        ci: ci.state === 'passing' ? 'CI passing' : ci.state === 'failing' ? 'CI failing' : ci.state === 'pending' ? 'CI still running' : 'No CI checks reported',
        review: p.reviewDecision === 'APPROVED' ? 'review approved' : p.reviewDecision === 'CHANGES_REQUESTED' ? 'review changes requested' : 'no review decision',
        merged: p.state === 'MERGED',
        inGame: null,
        realData: null,
      },
    };
  });
  cache.set(key, { at: Date.now(), value: base });
  return base;
}

export function one({ cwd, repo, number }) {
  const dir = cwd || config().projectDir || process.cwd();
  if (!available()) return { ok: false, status: 'unavailable', why: 'gh is not installed, so no pull request can be read or merged from here.' };
  const r = gh(dir, ['pr', 'view', String(number), '--repo', repo, '--json', FIELD]);
  if (r.status !== 0) return { ok: false, status: 'error', why: String(r.stderr || r.stdout || '').trim().slice(0, 300) || 'gh pr view failed.' };
  try { const p = JSON.parse(r.stdout || '{}'); return { ok: true, pr: { ...p, ci: rollup(p.statusCheckRollup), headShaFull: p.headRefOid ?? null } }; }
  catch (e) { return { ok: false, status: 'error', why: `Unreadable answer: ${e.message}` }; }
}

export function mergeBlockers(pr) {
  const why = [];
  if (!pr) return ['The pull request could not be read.'];
  if (pr.isDraft) why.push('It is still a draft.');
  if (pr.state && pr.state !== 'OPEN') why.push(`It is ${pr.state}, not open.`);
  if (String(pr.reviewDecision ?? '') === 'CHANGES_REQUESTED') why.push('A review requested changes.');
  const ci = pr.ci && pr.ci.state ? pr.ci : rollup(pr.statusCheckRollup);
  if (ci.state === 'failing') why.push(`${ci.fail} check(s) failed.`);
  if (ci.state === 'pending') why.push(`${ci.pending} check(s) are still running.`);
  if (ci.state === 'none' && pr.statusCheckRollup && Array.isArray(pr.statusCheckRollup) && !pr.statusCheckRollup.length) why.push('No CI checks were reported, so nothing was verified.');
  if (pr.mergeable && pr.mergeable !== 'MERGEABLE') why.push(`GitHub says it is ${pr.mergeable}.`);
  return why;
}

export function merge({ cwd, repo, number, sha, method = 'squash' }) {
  const dir = cwd || config().projectDir || process.cwd();
  if (!available()) return { ok: false, why: 'gh is not installed, so nothing was merged.' };
  if (!['merge', 'squash', 'rebase'].includes(method)) return { ok: false, why: 'Unknown merge method.' };
  const args = ['pr', 'merge', String(number), '--repo', repo, `--${method}`];
  if (sha) args.push('--match-head-commit', String(sha));
  const r = gh(dir, args, 60000);
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().slice(0, 600);
  return r.status === 0 ? { ok: true, out } : { ok: false, why: out || `gh exited ${r.status}.` };
}

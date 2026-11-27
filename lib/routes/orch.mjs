import { config, saveConfig } from '../config.mjs';
import { MODEL_RE, EFFORTS } from '../models.mjs';
import { budget } from '../orchestrator.mjs';
import * as tasks from '../tasks.mjs';

const PROVIDERS = ['freebuff', 'codex', 'cursor', 'opencode', 'claude', 'antigravity'];
const state = () => { const c = config(); return { orchestrator: { mode: 'orchestrated', provider: '', model: '', ...c.orchestrator }, workerModels: c.workerModels ?? {}, team: c.team ?? [], efforts: EFFORTS, providers: c.providers }; };

export default async ({ req, res, u, q, send, readBody, json, cachedUsage, allModels }) => {
  const p = u.pathname;
  if (p === '/models') { send(res, 200, await allModels(u.searchParams.has('fresh'))); return true; }
  if (p === '/budget') { send(res, 200, budget({ tasks: tasks.list(), usage: n => json(cachedUsage(n)), route: json(cachedUsage('route')) })); return true; }
  if (p === '/orch' && req.method === 'GET') { send(res, 200, state()); return true; }
  if (p === '/orch/config' && req.method === 'POST') {
    let b;
    try { b = JSON.parse(await readBody(req, 20000)); } catch (e) { send(res, 400, { error: `Bad request: ${e.message}` }); return true; }
    const o = b.orchestrator ?? {}, w = b.workerModels ?? {}, c = config(), team = [];
    if (!['simple', 'orchestrated'].includes(o.mode)) { send(res, 400, { error: 'Mode must be simple or orchestrated.' }); return true; }
    const model = String(o.model ?? '').trim();
    if (o.mode === 'orchestrated') {
      if (o.provider && !PROVIDERS.includes(o.provider)) { send(res, 400, { error: 'That orchestrator provider is not known.' }); return true; }
      if (o.provider === 'antigravity') { send(res, 400, { error: 'Antigravity runs one task at a time, so it cannot be the director: the director would hold its only slot and every task it hands to Antigravity would wait forever. Pick another director; Antigravity can still be on the team.' }); return true; }
      if (o.provider && !c.providers[o.provider]) { send(res, 400, { error: `${o.provider} is turned off in Setup.` }); return true; }
    }
    if (model && !MODEL_RE.test(model)) { send(res, 400, { error: 'The orchestrator model name has characters that are not allowed.' }); return true; }
    const workerModels = {};
    for (const k of PROVIDERS) {
      const v = String(w[k] ?? '').trim();
      if (v && !MODEL_RE.test(v)) { send(res, 400, { error: `The ${k} worker model name has characters that are not allowed.` }); return true; }
      if (v) workerModels[k] = v;
    }
    const effort = 'effort' in o ? String(o.effort ?? '').trim() : c.orchestrator?.provider === o.provider ? c.orchestrator?.effort ?? '' : '', okEffort = (p, e) => !e || (EFFORTS[p] ?? []).includes(e);
    if (!okEffort(o.provider, effort)) { send(res, 400, { error: `${o.provider} has no reasoning level "${effort}".` }); return true; }
    const given = Array.isArray(b.team);
    if (given && b.team.length > 60) { send(res, 400, { error: 'The team can hold at most 60 models.' }); return true; }
    for (const m of given ? b.team : []) {
      const p = String(m?.provider ?? ''), id = String(m?.model ?? '').trim(), e = String(m?.effort ?? '').trim();
      if (!PROVIDERS.includes(p)) { send(res, 400, { error: `The team has a model on ${p || 'no provider'}, which is not known.` }); return true; }
      if (!c.providers[p]) continue;
      if (!MODEL_RE.test(id)) { send(res, 400, { error: `The team model name ${id.slice(0, 40)} has characters that are not allowed.` }); return true; }
      if (!okEffort(p, e)) { send(res, 400, { error: `${p} has no reasoning level "${e}".` }); return true; }
      if (!team.some(x => x.provider === p && x.model === id)) team.push({ provider: p, model: id, effort: e });
    }
    saveConfig({ orchestrator: { mode: o.mode, provider: PROVIDERS.includes(o.provider) ? o.provider : '', model: PROVIDERS.includes(o.provider) ? model : '', effort: PROVIDERS.includes(o.provider) ? effort : '' }, workerModels, team: given ? team : c.team ?? [] });
    send(res, 200, state());
    return true;
  }
  const m = /^\/tasks\/([\w-]+)\/approve$/.exec(p);
  if (m && req.method === 'POST') {
    let edits = {};
    try { const raw = (await readBody(req, 60000)).trim(); edits = raw ? JSON.parse(raw) : {}; } catch (e) { send(res, 400, { error: `Bad request: ${e.message}` }); return true; }
    try {
      const t = tasks.approve(m[1], edits);
      if (!t) { send(res, 400, { error: 'That task is not waiting for approval.' }); return true; }
      tasks.tick();
      send(res, 200, t);
    } catch (e) { send(res, 400, { error: e.message }); }
    return true;
  }
  return false;
};

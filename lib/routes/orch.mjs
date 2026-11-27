import { config, saveConfig } from '../config.mjs';
import { MODEL_RE } from '../models.mjs';
import { budget } from '../orchestrator.mjs';
import * as tasks from '../tasks.mjs';

const PROVIDERS = ['freebuff', 'codex', 'cursor', 'opencode', 'claude'];
const state = () => { const c = config(); return { orchestrator: { mode: 'orchestrated', provider: '', model: '', ...c.orchestrator }, workerModels: c.workerModels ?? {}, providers: c.providers }; };

export default async ({ req, res, u, q, send, readBody, json, cachedUsage, allModels }) => {
  const p = u.pathname;
  if (p === '/models') { send(res, 200, await allModels(u.searchParams.has('fresh'))); return true; }
  if (p === '/budget') { send(res, 200, budget({ tasks: tasks.list(), usage: n => json(cachedUsage(n)), route: json(cachedUsage('route')) })); return true; }
  if (p === '/orch' && req.method === 'GET') { send(res, 200, state()); return true; }
  if (p === '/orch/config' && req.method === 'POST') {
    let b;
    try { b = JSON.parse(await readBody(req, 20000)); } catch (e) { send(res, 400, { error: `Bad request: ${e.message}` }); return true; }
    const o = b.orchestrator ?? {}, w = b.workerModels ?? {}, c = config();
    if (!['simple', 'orchestrated'].includes(o.mode)) { send(res, 400, { error: 'Mode must be simple or orchestrated.' }); return true; }
    const model = String(o.model ?? '').trim();
    if (o.mode === 'orchestrated') {
      if (o.provider && !PROVIDERS.includes(o.provider)) { send(res, 400, { error: 'That orchestrator provider is not known.' }); return true; }
      if (o.provider && !c.providers[o.provider]) { send(res, 400, { error: `${o.provider} is turned off in Setup.` }); return true; }
    }
    if (model && !MODEL_RE.test(model)) { send(res, 400, { error: 'The orchestrator model name has characters that are not allowed.' }); return true; }
    const workerModels = {};
    for (const k of PROVIDERS) {
      const v = String(w[k] ?? '').trim();
      if (v && !MODEL_RE.test(v)) { send(res, 400, { error: `The ${k} worker model name has characters that are not allowed.` }); return true; }
      if (v) workerModels[k] = v;
    }
    saveConfig({ orchestrator: { mode: o.mode, provider: PROVIDERS.includes(o.provider) ? o.provider : '', model: PROVIDERS.includes(o.provider) ? model : '' }, workerModels });
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

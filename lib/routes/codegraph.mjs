import { config } from '../config.mjs';
import { graph } from '../codegraph-view.mjs';

export default async ({ req, res, u, q, send }) => {
  if (u.pathname !== '/codegraph' || req.method !== 'GET') return false;
  try { send(res, 200, graph(config().projectDir, { query: q('query') || '', id: q('id') || '' })); }
  catch (e) { send(res, 400, { error: e.message }); }
  return true;
};

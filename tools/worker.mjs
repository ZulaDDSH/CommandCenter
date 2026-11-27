import { parentPort, workerData } from 'node:worker_threads';
import { createApi, format } from './cc-lib.mjs';

const { code, args, opts } = workerData;
const logs = [];
const fmt = a => a instanceof Error ? a.stack ?? String(a) : typeof a === 'string' ? a : JSON.stringify(a) ?? String(a);
const add = (...a) => logs.push(a.map(fmt).join(' '));
const con = { log: add, info: add, debug: add, trace: add, warn: add, error: add };
const api = createApi(opts);
const names = ['console', 'args', ...Object.keys(api)];
try {
  const fn = new (Object.getPrototypeOf(async () => {}).constructor)(...names, code);
  const v = await fn(con, args, ...Object.values(api));
  parentPort.postMessage({ ok: true, text: format(v, logs) });
} catch (e) {
  parentPort.postMessage({ ok: false, text: format(`Error: ${e?.message ?? e}`, logs) });
}

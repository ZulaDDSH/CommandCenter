import { Worker } from 'node:worker_threads';

export const DEFAULT_TIMEOUT = 60000;

// invariant: a worker stuck in a native call still dies with the process; run/git timeouts are clamped below the script timeout
export function runScript(code, { timeout: limit = DEFAULT_TIMEOUT, args = [], ...opts } = {}) {
  const timeout = Number.isFinite(+limit) && +limit > 0 ? +limit : DEFAULT_TIMEOUT;
  return new Promise(resolve => {
    const w = new Worker(new URL('./worker.mjs', import.meta.url), { workerData: { code, args, opts: { ...opts, maxMs: timeout } }, stdout: true, stderr: true });
    const timer = setTimeout(() => { w.terminate(); resolve({ ok: false, text: `Error: script ran over ${timeout} ms and was stopped.` }); }, timeout);
    w.once('message', m => { clearTimeout(timer); resolve(m); w.terminate(); });
    w.once('error', e => { clearTimeout(timer); resolve({ ok: false, text: `Error: ${e.message}` }); });
    w.once('exit', () => { clearTimeout(timer); resolve({ ok: false, text: 'Error: script ended without a result.' }); });
  });
}

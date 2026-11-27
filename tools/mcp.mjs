#!/usr/bin/env node
import readline from 'node:readline';
import { createApi, format } from './cc-lib.mjs';
import { runScript } from './run-script.mjs';

const SCRIPT_HELP = `Run a JavaScript async function body that does many reads, searches, edits and Command Center calls in ONE turn; return only the small result you need. Use it instead of several separate tool calls. In scope: read(path,{from,to}), write(path,text), edit(path,old,new) (exact unique match), glob(pattern,{cwd}), grep(regex,{path,glob,max}) -> [{file,line,text}], ls(dir), git(...args), run(cmd,args,{cwd,timeout,input}) -> {code,stdout,stderr}, fetchJson(url) (panel only), panel.tasks(), panel.taskLog(id), panel.addTask({title,prompt,provider,model,cwd,parent}), panel.board(text,from), panel.budget(), console.log, args. Relative paths use cwd. Output over 20000 chars is cut.`;

const TOOLS = [
  { name: 'run_script', description: SCRIPT_HELP, inputSchema: { type: 'object', properties: { code: { type: 'string', description: 'Async function body; use return to give the result.' }, cwd: { type: 'string', description: 'Folder for relative paths (default: server folder).' }, timeout_ms: { type: 'number', description: 'Stop the script after this long (default 60000).' } }, required: ['code'] } },
  { name: 'cc_task_add', description: 'Queue a task in the Command Center. It starts on the best free provider.', inputSchema: { type: 'object', properties: { title: { type: 'string' }, prompt: { type: 'string' }, provider: { type: 'string', enum: ['freebuff', 'codex', 'cursor', 'opencode', 'claude'] }, model: { type: 'string' }, cwd: { type: 'string' }, parent: { type: 'string' } }, required: ['title', 'prompt'] } },
  { name: 'cc_board_post', description: 'Post a short note on the shared team board. Never post secrets.', inputSchema: { type: 'object', properties: { text: { type: 'string' }, from: { type: 'string' } }, required: ['text'] } },
  { name: 'cc_budget', description: 'Show provider usage and which provider the next task would go to.', inputSchema: { type: 'object', properties: {} } },
];

const HANDLERS = {
  run_script: async a => { if (typeof a.code !== 'string') throw new Error('code must be a string'); const r = await runScript(a.code, { cwd: a.cwd || process.cwd(), ...(Number.isFinite(+a.timeout_ms) && +a.timeout_ms > 0 ? { timeout: +a.timeout_ms } : {}) }); return r; },
  cc_task_add: async a => ({ ok: true, text: format(await createApi().panel.addTask(a)) }),
  cc_board_post: async a => ({ ok: true, text: format(await createApi().panel.board(a.text, a.from)) }),
  cc_budget: async () => ({ ok: true, text: format(await createApi().panel.budget()) }),
};

const send = o => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...o })}\n`);
const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05'];

async function handle(m) {
  const { id, method, params } = m;
  if (id === undefined) return;
  if (method === 'initialize') return send({ id, result: { protocolVersion: SUPPORTED.includes(params?.protocolVersion) ? params.protocolVersion : SUPPORTED[0], capabilities: { tools: {} }, serverInfo: { name: 'command-center', version: '1.0.0' } } });
  if (method === 'ping') return send({ id, result: {} });
  if (method === 'tools/list') return send({ id, result: { tools: TOOLS } });
  if (method === 'tools/call') {
    const h = Object.hasOwn(HANDLERS, params?.name) ? HANDLERS[params.name] : null;
    if (!h) return send({ id, error: { code: -32602, message: `Unknown tool: ${params?.name}` } });
    let r;
    try { r = await h(params.arguments ?? {}); } catch (e) { r = { ok: false, text: `Error: ${e.message}` }; }
    return send({ id, result: { content: [{ type: 'text', text: r.text }], ...(r.ok ? {} : { isError: true }) } });
  }
  send({ id, error: { code: -32601, message: `Method not found: ${method}` } });
}

const pending = new Set();
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', line => {
  if (!line.trim()) return;
  let m;
  try { m = JSON.parse(line); } catch { return send({ id: null, error: { code: -32700, message: 'Parse error' } }); }
  if (typeof m !== 'object' || m === null || Array.isArray(m)) return send({ id: null, error: { code: -32600, message: 'Invalid Request' } });
  const p = handle(m).catch(e => m.id !== undefined && send({ id: m.id, error: { code: -32603, message: e.message } })).finally(() => pending.delete(p));
  pending.add(p);
});
rl.on('close', () => Promise.all(pending));

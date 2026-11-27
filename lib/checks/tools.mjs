import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT } from '../config.mjs';

const TOOLS = path.join(ROOT, 'tools');

// invariant: runs inside the panel process, so child processes are async and killed after the timeout
const exec = (script, input, ms = 10000) => new Promise(resolve => {
  const c = spawn(process.execPath, [path.join(TOOLS, script), ...(script === 'cc.mjs' ? ['run', '-'] : [])], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '', err = '';
  const t = setTimeout(() => { c.kill(); resolve({ out, err: `${err} timed out after ${ms} ms` }); }, ms);
  c.stdout.on('data', d => { out += d; });
  c.stderr.on('data', d => { err += d; });
  c.on('error', e => { clearTimeout(t); resolve({ out, err: e.message }); });
  c.on('close', () => { clearTimeout(t); resolve({ out, err }); });
  c.stdin.on('error', () => {});
  c.stdin.end(input);
});

export default async () => {
  const rows = [];
  const cli = await exec('cc.mjs', 'return 1+1');
  rows.push({ group: 'Tools', name: 'Script tool runs (cc.mjs run)', ok: cli.out.trim() === '2', detail: cli.out.trim() === '2' ? 'return 1+1 gave 2' : (cli.err || cli.out).trim().slice(0, 200) || 'no output', fix: 'Check that tools/cc.mjs exists and Node is 22 or newer.' });
  const init = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"debug","version":"1"}}}\n';
  const mcp = await exec('mcp.mjs', init);
  let name = null;
  try { name = JSON.parse(mcp.out.split('\n')[0]).result?.serverInfo?.name; } catch {}
  rows.push({ group: 'Tools', name: 'Script tool MCP server answers', ok: name === 'command-center', detail: name ? `answered as ${name}` : (mcp.err || mcp.out).trim().slice(0, 200) || 'no answer', fix: 'Run: node tools/mcp.mjs and send an initialize line; read the error.' });
  const { registered, CLIS } = await import('../../tools/register.mjs');
  for (const p of CLIS) {
    const on = registered(p);
    rows.push({ group: 'Tools', name: `${p} has the script tool`, ok: on || null, detail: on ? 'registered' : 'not registered (optional; only needed if you use this CLI)', fix: `Run: node tools/register.mjs ${p}` });
  }
  return rows;
};

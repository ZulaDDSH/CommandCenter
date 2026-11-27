import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-data-root-'));
fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ setupDone: true, providers: { freebuff: false, codex: false, cursor: false, opencode: false, claude: false, antigravity: false } }));
const socket = net.createServer();
await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const child = spawn(process.execPath, ['viewer/server.mjs'], { env: { ...process.env, CC_ROOT: root, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
child.stdout.on('data', b => { output += b; });
child.stderr.on('data', b => { output += b; });
try {
  let response;
  for (let i = 0; i < 80 && !response; i++) {
    if (child.exitCode !== null) throw new Error(`Panel exited: ${output}`);
    try { response = await fetch(`http://127.0.0.1:${port}/orch`); }
    catch { await new Promise(resolve => setTimeout(resolve, 250)); }
  }
  assert.ok(response?.ok, `Panel did not load routes with a separate data root: ${output}`);
  const data = await response.json();
  assert.ok(data.orchestrator && data.providers, 'Director settings route should respond');
  const before = await fetch(`http://127.0.0.1:${port}/setup`);
  assert.ok(before.ok, 'Setup should respond before changing settings');
  const saved = await fetch(`http://127.0.0.1:${port}/orch/config`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ orchestrator: { mode: 'simple' } }) });
  assert.ok(saved.ok, 'Director settings should save');
  const after = await fetch(`http://127.0.0.1:${port}/setup`);
  assert.equal((await after.json()).config.orchestrator.mode, 'simple', 'Routes and server should share the same configuration state');
} finally {
  child.kill();
}

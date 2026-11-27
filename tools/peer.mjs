#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../lib/config.mjs';
import * as machines from '../lib/machines.mjs';

const args = process.argv.slice(2);
const cmd = args[0] ?? 'id';
const opt = (k, d = '') => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? String(args[i + 1] ?? d) : d;
};

function ownTasks() {
  try {
    const rows = JSON.parse(fs.readFileSync(path.join(ROOT, 'tasks.json'), 'utf8'));
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function report(extra) {
  console.log(JSON.stringify({
    root: ROOT,
    selfId: machines.selfId(),
    name: machines.localName(),
    capabilities: machines.capabilities(),
    ownTasks: ownTasks().length,
    ...extra,
  }));
}

async function join() {
  const hostUrl = opt('host');
  const hostName = opt('name');
  const taskId = opt('task');
  if (!hostUrl || !hostName) throw new Error('join needs --host http://address and --name <the label you gave this host there>');
  fs.mkdirSync(ROOT, { recursive: true });
  const known = machines.peers().find(p => p.name.toLowerCase() === hostName.toLowerCase());
  const entry = known ?? machines.addPeer({ name: hostName, url: hostUrl });
  const secret = process.env.CC_PEER_SECRET;
  const hello = await machines.handshake(entry.key);
  const claim = await machines.callPeer(hostUrl, '/machine/claim', { secret, selfId: machines.selfId(), body: { task: taskId || null } });
  const claimBad = await machines.callPeer(hostUrl, '/machine/claim', { secret: `${secret ?? ''}-invalid`, selfId: machines.selfId(), body: { task: taskId || null } });
  const ids = ownTasks().map(t => t.id);
  report({
    hello: { ok: !!hello.ok, status: hello.status, why: hello.why ?? null, capabilities: hello.capabilities ?? null },
    claim: { status: claim.status, code: claim.body?.code ?? null, supported: claim.body?.supported ?? null },
    claimBad: { status: claimBad.status, code: claimBad.body?.code ?? null },
    hasTask: taskId ? ids.includes(taskId) : false,
  });
}

try {
  if (cmd === 'id') report({});
  else if (cmd === 'join') await join();
  else throw new Error('Commands: id, join --host <url> --name <label> [--task <id>]');
} catch (e) {
  console.log(JSON.stringify({ error: machines.redact(String(e?.message ?? e)).slice(0, 300) }));
  process.exitCode = 1;
}

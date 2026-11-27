import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-codex-session-'));
process.env.HOME = home;
process.env.CC_ROOT = home;
const dir = path.join(home, '.codex');
fs.mkdirSync(dir);
const id = '01234567-89ab-cdef-0123-456789abcdef';
const state = new DatabaseSync(path.join(dir, 'state_5.sqlite'));
state.exec('create table threads (id text, title text, cwd text, model text, updated_at_ms integer, history_mode text, agent_path text, archived integer)');
state.prepare('insert into threads values (?, ?, ?, ?, ?, ?, ?, 0)').run(id, 'Current session', '/project', 'model', Date.now(), 'paginated', null);
state.close();
const history = new DatabaseSync(path.join(dir, 'thread_history_1.sqlite'));
history.exec('create table thread_turns (thread_id text, status text, rollout_ordinal integer); create table thread_items (thread_id text, item_json text, rollout_ordinal integer)');
history.prepare('insert into thread_turns values (?, ?, ?)').run(id, 'inProgress', 1);
history.prepare('insert into thread_items values (?, ?, ?)').run(id, JSON.stringify({ type: 'userMessage', content: [{ type: 'text', text: 'Hello' }] }), 1);
history.prepare('insert into thread_items values (?, ?, ?)').run(id, JSON.stringify({ type: 'agentMessage', text: 'Working' }), 2);
history.close();
try {
  const { codexList, codexSession, removal } = await import('../lib/sessions.mjs');
  const { liveOf } = await import('../lib/session-meta.mjs');
  const row = codexList(10)[0];
  assert.equal(row.id, id);
  assert.equal(row.turnStatus, 'inProgress');
  assert.equal(liveOf(row).live, 'reported');
  assert.deepEqual(codexSession(id).steps.map(x => x.text), ['Hello', 'Working']);
  assert.equal(removal.codex(id).state, 'working');
  assert.equal(liveOf({ ...row, mtime: Date.now() - 300000 }).live, 'unknown');
  const db = new DatabaseSync(path.join(dir, 'thread_history_1.sqlite'));
  db.exec("update thread_turns set status = 'completed'");
  db.close();
  assert.equal(removal.codex(id).state, 'done');
  assert.equal(removal.codex(id).trash, undefined);
} finally {
  fs.rmSync(home, { recursive: true, force: true });
}

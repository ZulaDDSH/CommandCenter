import fs from 'node:fs';
import path from 'node:path';
import { ROOT, config } from '../config.mjs';
import { available, repoName } from '../github.mjs';
import { repoOf } from '../worktrees.mjs';
import * as machines from '../machines.mjs';
import * as director from '../director.mjs';

export default async () => {
  const out = [];
  const add = (name, ok, detail, fix) => out.push({ group: 'Director', name, ok, detail, fix });
  try {
    const file = path.join(ROOT, 'goals.json');
    if (fs.existsSync(file)) {
      JSON.parse(fs.readFileSync(file, 'utf8'));
      add('Goals file parses', true, `${director.goals().length} goal(s)`, 'Nothing to do.');
    } else add('Goals file parses', true, 'no goals yet; it is made with the first one', 'Nothing to do.');
  } catch (e) { add('Goals file parses', false, e.message, 'Move goals.json aside; the panel makes a new one. Task history is not in it.'); }
  let stateOk = true;
  try { fs.mkdirSync(path.join(ROOT, 'state'), { recursive: true }); fs.accessSync(path.join(ROOT, 'state'), fs.constants.W_OK); } catch { stateOk = false; }
  add('Panel state folder writable', stateOk, path.join(ROOT, 'state'), 'The panel needs to write state/ for the dispatcher lock and the document lock.');
  const c = config();
  const repo = c.projectDir ? repoOf(c.projectDir) : null;
  add('Task worktrees', c.taskWorktrees !== false, c.taskWorktrees === false ? 'turned off: tasks share the main checkout' : repo ? `on: <repo>/git/<task-id> under ${repo}` : `on, but ${c.projectDir || 'the project folder'} is not a git repository`, 'Turn taskWorktrees off only if you want parallel tasks in one checkout.');
  add('GitHub CLI', available(), available() ? (repoName(c.projectDir) || 'gh is installed; this folder is not a GitHub repo it knows') : 'gh is not installed or not on PATH', 'Install gh from https://cli.github.com and run gh auth login once.');
  add('Merging from the panel', true, c.mergeEnabled ? 'on: every merge still needs your approval for that exact commit' : 'off (default): approval can be recorded, nothing is merged', 'Leave it off unless you want the gated merge button.');
  const inv = machines.inventory();
  const unset = inv.peers.filter(p => p.status === 'unconfigured');
  add('Machine connections', unset.length ? null : true, `${inv.peers.length} listed, ${unset.length} without a secret`, unset.length ? `Set ${unset.map(p => p.secretEnv).join(', ')} in the environment before connecting.` : 'Nothing to do.');
  const peersOnline = inv.peers.filter(p => p.status === 'online').length;
  add('Remote machines online', peersOnline ? true : null, peersOnline ? `${peersOnline} answered a signed hello` : 'none: this panel coordinates only this machine', 'Add a machine on the Director tab; a machine shows online only after a signed hello.');
  const lock = path.join(ROOT, 'state', 'panel.lock');
  let lockPid = 0;
  try { lockPid = Number(String(fs.readFileSync(lock, 'utf8')).split('\n')[0]); } catch {}
  add('One dispatcher', true, lockPid ? `panel process ${lockPid} holds the dispatcher lock` : 'no lock file yet', 'Start the panel; a second panel on the same folder serves the page but starts nothing.');
  return out;
};

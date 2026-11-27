// Invariant: a second freebuff CLI requires /spawn-check approval.
import { execFileSync } from 'node:child_process';

const input = JSON.parse(await new Promise((r) => { let s = ''; process.stdin.on('data', (d) => (s += d)); process.stdin.on('end', () => r(s || '{}')); }));
const args = input.tool_input ?? {};
if (args.provider !== 'freebuff') process.exit(0);
const want = String(args.nativeId ?? '').replace(/^freebuff:/, '');
const kind = (/^\s*\[(code|light|read)\]/i.exec(String(args.text ?? '')) ?? [])[1]?.toLowerCase() ?? 'code';

const ps = (cmd) => JSON.parse(execFileSync('powershell', ['-NoProfile', '-Command', `@(${cmd}) | ConvertTo-Json -Compress`], { encoding: 'utf8', windowsHide: true }) || '[]');
let procs;
try { procs = [].concat(ps("Get-CimInstance Win32_Process | Select ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine,@{n='Start';e={$_.CreationDate.ToString('o')}}")); }
catch (e) { process.stderr.write(`Blocked: could not list processes to check for a running freebuff CLI (${e.message}).`); process.exit(2); }
const byPid = new Map(procs.map((p) => [p.ProcessId, p]));
const clis = procs.filter((p) => /\\\.config\\manicode\\freebuff\.exe$/i.test(p.ExecutablePath ?? '') && !/--terminal-command-broker/.test(p.CommandLine ?? ''))
  .map((p) => ({ ...p, id: (/--continue\s+(\S+)/.exec(p.CommandLine ?? '') ?? [])[1] ?? '?', owner: byPid.get(p.ParentProcessId)?.ParentProcessId }));
if (!clis.length) process.exit(0);

let me = process.ppid;
while (me && !/^claude(\.exe)?$/i.test(byPid.get(me)?.Name ?? '')) me = byPid.get(me)?.ParentProcessId;
if (clis.some((c) => c.id === want && c.owner === me)) process.exit(0);

let check = null;
try { check = await (await fetch(`http://127.0.0.1:4021/spawn-check?kind=${kind}`, { signal: AbortSignal.timeout(8000) })).json(); } catch {}
if (check?.spawn) process.exit(0);

const list = clis.map((c) => `- nativeId "${c.id}" (pid ${c.ProcessId}, started ${new Date(c.Start).toLocaleTimeString()}, ${c.owner === me ? 'owned by this session' : 'owned by another session'})`).join('\n');
process.stderr.write(`Blocked: ${check ? check.why : 'the Command Center panel (4021) is not answering, so only one freebuff CLI may run.'}\n${list}\n` +
  `Send the task to that CLI's nativeId from the session that owns it, or wait until /spawn-check allows a new CLI.`);
process.exit(2);

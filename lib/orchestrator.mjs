import path from 'node:path';
import { config, ROOT } from './config.mjs';
import { isInstalled } from '../usage/exec.mjs';

const fwd = p => String(p).replace(/\\/g, '/');
const PROVIDERS = ['freebuff', 'codex', 'cursor', 'opencode', 'claude', 'antigravity'];
const LIVE = ['waiting', 'starting', 'running'];
const port = () => process.env.PORT ?? 4021;
const hm = left => { const [h, m] = String(left ?? '').split(':').map(Number); return Number.isNaN(h) ? null : h + (m || 0) / 60; };
const fresh = w => w && (!w.resetsAt || Date.parse(w.resetsAt) > Date.now());

export function budget({ tasks = [], usage = () => null, route = null } = {}) {
  const c = config(), out = {};
  const live = p => tasks.filter(t => LIVE.includes(t.status) && t.status !== 'waiting' && t.ranOn === p && t.role !== 'orchestrator').length;
  for (const p of PROVIDERS) {
    const e = { enabled: !!c.providers[p], installed: isInstalled(p), running: live(p), max: p === 'freebuff' ? c.maxClis : c.maxParallel[p] ?? 1 };
    const u = p === 'claude' || p === 'antigravity' ? null : usage(p);
    if (p === 'freebuff') {
      const fm = usage('fbmodels')?.rows ?? [], left = hm(u?.today?.left);
      Object.assign(e, { hoursLeft: u?.today?.left ?? null, hoursLimit: u?.today?.limit ?? null, resetsAt: u?.today?.resetAt ?? null, error: u?.error ?? null,
        models: fm.map(r => ({ id: r.key, name: r.name, hoursPerHour: r.hours ?? null, workHoursLeft: r.hours === 0 ? 'unlimited' : r.hours == null || left == null ? null : Math.floor(left / r.hours) })) });
    } else if (p === 'codex') {
      const w = [u?.primary, u?.secondary].filter(Boolean);
      Object.assign(e, { windows: w.map(x => ({ minutes: x.windowMinutes, usedPercent: fresh(x) ? x.usedPercent : null, resetsAt: x.resetsAt, stale: !fresh(x) })), error: u?.error ?? null,
        note: !w.length ? 'no limit data yet: usable' : w.every(x => !fresh(x)) ? 'limit data is old: probably free' : '' });
    } else if (p === 'cursor') Object.assign(e, { signedIn: u?.loggedIn ?? null, note: 'no usage readout; billed on the Cursor plan' });
    else if (p === 'opencode') Object.assign(e, { today: u?.today ?? null, week: u?.week ?? null, note: u?.limits ?? '' });
    else e.note = p === 'antigravity' ? 'no usage readout; Google AI plan limits, one task at a time; its tools need permission rules the person sets, so it mostly answers in text' : 'no usage readout; paid, keep it for the hardest work';
    out[p] = e;
  }
  return { at: new Date().toISOString(), providers: out, auto: route ? { provider: route.provider, model: route.model, why: route.why } : null, workerModels: c.workerModels ?? {} };
}

function budgetText(b) {
  const lines = [];
  for (const [p, e] of Object.entries(b.providers)) {
    const head = `- ${p}: ${!e.enabled ? 'TURNED OFF (do not use)' : !e.installed ? 'NOT INSTALLED (do not use)' : 'on'}; running ${e.running} of ${e.max} at once.`;
    let d = '';
    if (!e.enabled || !e.installed) { lines.push(head); continue; }
    if (p === 'freebuff') d = e.error ? ` Usage unreadable (${e.error}).` : ` ${e.hoursLeft ?? '?'} of ${e.hoursLimit ?? '?'} Freebuff hours left today. Models: ${e.models.map(m => `${m.name} [${m.id}] ${m.hoursPerHour === 0 ? 'free' : m.hoursPerHour == null ? '? h' : m.hoursPerHour + ' h per hour'}${m.workHoursLeft == null ? '' : `, ${m.workHoursLeft} h of work left`}`).join('; ')}.`;
    else if (p === 'codex') d = e.windows.length ? ` ${e.windows.map(x => `${x.minutes ? (x.minutes >= 1440 ? x.minutes / 1440 + '-day' : x.minutes / 60 + '-hour') : ''} window ${x.stale ? 'old data' : 100 - x.usedPercent + '% left'}`).join(', ')}.${e.note ? ' ' + e.note + '.' : ''}` : ` ${e.note}.`;
    else if (p === 'cursor') d = ` ${e.signedIn ? 'signed in' : 'NOT signed in'}; ${e.note}.`;
    else if (p === 'opencode') d = e.today ? ` spent today ${e.today.cost}, last 7 days ${e.week?.cost}; ${e.note}.` : ` ${e.note}.`;
    else d = ` ${e.note}.`;
    lines.push(head + d);
  }
  if (b.auto) lines.push(`- Simple-mode router would pick now: ${b.auto.provider} ${b.auto.model} (${b.auto.why}).`);
  return lines.join('\n');
}

export const budgetSummary = budgetText;

export function buildPrompt(t, { tasks = [], usage, models = {}, route = null } = {}) {
  const c = config(), o = c.orchestrator ?? {}, base = `http://127.0.0.1:${port()}`, rep = d => fwd(path.join(c.reportsDir, `${d}.md`));
  const b = budget({ tasks, usage, route });
  const list = Object.entries(models).map(([p, rows]) => `- ${p}: ${p === 'freebuff' || rows.length <= 14 ? rows.map(r => `${r.name} (id ${r.id || 'saved default'}${r.note ? ', ' + r.note : ''})`).join('; ') : `${rows.length} models; the first ones are ${rows.slice(0, 6).map(r => r.id).join(', ')}. Run GET ${base}/models for all.`}`).join('\n');
  const team = c.team ?? [];
  const teamLines = team.length
    ? ['The person picked exactly these models for you to hand work to. Use only these, and always give a provider and a model that appear here. Each runs at the reasoning level shown and you cannot change it.', '', ...team.map(m => `- ${m.provider} ${m.model}${m.effort ? ` (reasoning ${m.effort})` : ''}`), '', 'A sub-task that names anything else is refused.']
    : ['The person has not limited you to particular models: any model listed above may be used.'];
  const defaults = Object.entries(c.workerModels ?? {}).filter(([, v]) => v).map(([p, v]) => `${p}=${v}`).join(', ') || 'none set (each provider uses its own default)';
  return [
    `# Orchestrator task ${t.id}: ${t.title}`, '',
    'You are the orchestrator. You do not do the work yourself. You plan it, give it to workers on the right provider and model, watch them, check what they report, and write one final report.', '',
    '## The goal', '', t.text, '',
    '## Where you are', '',
    `- Your task id: ${t.id}. Folder: ${fwd(t.cwd)}. Panel: ${base}. Reports folder: ${fwd(c.reportsDir)}.`,
    `- You run on ${t.provider} ${t.modelPref ?? ''}${o.effort ? ` (reasoning ${o.effort})` : ''}. Worker defaults per provider: ${defaults}.`, '',
    '## Budget right now', '',
    `Read at ${b.at}. Get a fresh copy any time: \`curl.exe -s ${base}/budget\` or \`node "${fwd(ROOT)}/tools/cc.mjs" budget\`.`, '',
    budgetText(b), '',
    '## Models each provider offers', '', list || '(model lists not read yet: run GET /models)', '',
    '## Your team', '', ...teamLines, '',
    '## How to pick a worker', '',
    '1. Use the cheapest model that can do the job well. Small, clear edits and reading go to free or cheap models. Hard design, tricky bugs and anything risky go to a stronger one.',
    '2. Use free Freebuff hours first (free models, then the cheapest paid ones). Keep paid quotas (Codex, Cursor, Claude, OpenCode Go, Antigravity) for hard work.',
    '3. Never go over a limit: running counts above are per provider. If a provider is at its limit, give the job to another one or wait. Never use a provider that is turned off or not installed.',
    '4. Give a job to a read-only kind (`"kind":"read"`) when no file should change (it runs only on Codex, Claude, Cursor, OpenCode or Antigravity, each of which has a read-only mode in its own CLI; Codex uses an OS sandbox, the others are CLI modes and not a sandbox; Freebuff has none). Give each worker one clear job, the folder, the files it may touch, and what the report must contain.',
    '5. Do not run two workers on the same files at the same time.', '',
    '## How to create a sub-task', '',
    `Write the job text to a file, then: \`node "${fwd(ROOT)}/tools/cc.mjs" task add --title "Short name" --prompt-file job.md --provider codex --model gpt-6.1-terra --parent ${t.id} --cwd "${fwd(t.cwd)}" --kind code\``,
    `Or with HTTP (put the JSON in a file to avoid quoting trouble): \`curl.exe -s -X POST ${base}/tasks -H "content-type: application/json" --data-binary "@task.json"\` with`,
    `\`{"title":"Short name","prompt":"the job","provider":"codex","model":"gpt-6.1-terra","parent":"${t.id}","cwd":"${fwd(t.cwd)}","kind":"code"}\``,
    'It answers with the new task (note its `id`). `provider` is freebuff, codex, cursor, opencode, claude or antigravity. `model` is an id from the lists above (for Freebuff use the model id in brackets). Leave `provider` out only if you do not mind the panel choosing.',
    `Limits: at most 8 live sub-tasks under you, depth 3, and every sub-task obeys the same provider limits (a task that cannot start yet waits and says why).`, '',
    '## How to watch them', '',
    `- \`curl.exe -s "${base}/tasks?parent=${t.id}&brief=1"\` lists every task under you with its status. Statuses: waiting, starting, running, done, failed, cancelled. A task with \`hold\` is waiting for you to approve it.`,
    `- \`curl.exe -s "${base}/task-log?id=<id>"\` gives its log and report. The report file is ${fwd(c.reportsDir)}/<id>.md.`,
    `- Wait with a pause between checks, for example \`Start-Sleep -Seconds 60\` (PowerShell) or \`node -e "setTimeout(()=>{},60000)"\`. Keep each wait under 10 minutes and check again. A freebuff task may say it ran out of time; it resumes by itself, so wait.`,
    '- A failed or cancelled worker: read its log, then post a fix task (a different model if the first could not do it) or do the missing part with another worker.', '',
    '## Sub-tasks asked for by your workers', '',
    `Workers may ask for sub-agents of their own. Those tasks stay waiting with a \`hold\` of ${t.id} until you decide. Look for them in the list above. Approve (optionally changing title, prompt, provider, model or kind in the JSON body): \`curl.exe -s -X POST ${base}/tasks/<id>/approve -H "content-type: application/json" --data-binary "{}"\`. Refuse: \`curl.exe -s -X POST ${base}/tasks/<id>/cancel\`. Approve only what the goal needs and the budget allows.`, '',
    '## What to do', '',
    '1. Read the goal. Look at the folder if you need to. Make a short plan with independent jobs.',
    '2. Create the sub-tasks with a provider and model each. Post a short note to the team board with the plan.',
    '3. Wait for the reports. Check each one against the folder (files changed, tests if there are any). Do not trust a report you did not check.',
    '4. Post fix tasks where needed. Keep going until the goal is met or you cannot get further.',
    `5. Write ONE final report to ${rep(t.id)}: the goal, each sub-task (id, provider, model, result), what changed, what is left. The panel marks you done when that file appears. Do not write it before the sub-tasks have ended.`, '',
    '---', '',
    'Team board: other agents share notes there.',
    `Read it before you start: curl.exe -s ${base}/board`,
    `Post notes: curl.exe -s -X POST "${base}/board?from=orchestrator-${t.id}" --data-binary "your note". Keep notes short and never post secrets.`, '',
  ].join('\n');
}

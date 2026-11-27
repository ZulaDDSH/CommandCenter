(() => {
const PROV = ['freebuff', 'codex', 'cursor', 'opencode'];
const TOOLS = [...PROV, 'claude', 'antigravity'];
const NAMES = { freebuff: 'Freebuff', codex: 'Codex', cursor: 'Cursor', opencode: 'OpenCode', claude: 'Claude', antigravity: 'Antigravity' };
const FB = 'Freebuff (a new CLI starts)';
const ic = ok => ok === true ? '<span class="pg-ic ok" title="OK">✓</span>' : ok === false ? '<span class="pg-ic bad" title="Needs attention">✗</span>' : '<span class="pg-ic na" title="Off or unknown">●</span>';
const put = (el, html, force) => { if (el && (force || el._h !== html)) { el.innerHTML = html; el._h = html; } };
const mine = (el, id) => el.firstElementChild?.id === id;
const getJson = async url => { const r = await fetch(url); if (!r.ok) throw new Error(`${url} answered ${r.status}`); return r.json(); };
const link = (url, text) => /^https?:\/\//.test(url || '') ? `<a target="_blank" rel="noopener" href="${esc(url)}">${esc(text)}</a>` : '';
const slash = s => String(s ?? '').replace(/\\/g, '/');
const same = (a, b) => !!a && !!b && slash(a).toLowerCase().replace(/\/+$/, '') === slash(b).toLowerCase().replace(/\/+$/, '');

async function writeClip(t) {
  try { await navigator.clipboard.writeText(t); }
  catch { const a = document.createElement('textarea'); a.value = t; document.body.appendChild(a); a.select(); try { document.execCommand('copy'); } catch {} a.remove(); }
}
async function copyText(btn, text) {
  await writeClip(text ?? document.getElementById(btn.dataset.copy)?.textContent ?? '');
  const was = btn.dataset.label ?? (btn.dataset.label = btn.textContent);
  btn.textContent = 'Copied';
  setTimeout(() => { btn.textContent = was; }, 1500);
}

let S = null, F = { repos: [] }, M = null, mAt = 0, msgs = {}, setupBusy = false, picking = null, savedTimer = 0;

const FALLBACK = { codex: ['gpt-6.1-terra', 'gpt-6-luna'], codexEffort: ['low', 'medium', 'high', 'xhigh'], cursor: ['composer-2.5', 'grok-4.7'], opencode: ['opencode-go/deepseek-v4.1-flash'], claude: ['sonnet', 'opus', 'haiku'], antigravity: ['gemini-3.8-flash-medium'] };
function modelList(m, k) {
  const src = m && (m[k] ?? m.models?.[k] ?? m.providers?.[k]?.models ?? m.providers?.[k]);
  const got = Array.isArray(src) ? src.map(x => typeof x === 'string' ? x : x?.id ?? x?.name ?? x?.value).filter(x => typeof x === 'string' && /^[\w.:/@-]{1,80}$/.test(x)) : [];
  return got.length ? [...new Set(got)] : FALLBACK[k];
}

const withCurrent = (opts, v) => v === '' || v == null || opts.some(([x]) => same(x, v) || String(x) === String(v)) ? opts : [...opts, [v, `${v} (current)`]];
const select = (key, value, opts, label, type = '') => `<select class="pg-sel" aria-label="${esc(label)}" data-k="${key}"${type ? ` data-t="${type}"` : ''}>${withCurrent(opts, value).map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(value) || same(v, value) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
const range = (lo, hi) => Array.from({ length: hi - lo + 1 }, (_, i) => [lo + i, `${lo + i}`]);
const fld = (label, ctl, hint) => `<div class="pg-fld"><div class="pg-l">${label}</div><div class="pg-ctl">${ctl}</div>${hint ? `<div class="pg-hint">${hint}</div>` : ''}</div>`;
const pickBtn = (what, text = 'Choose folder…') => `<button class="pill" data-pick="${what}"${picking ? ' disabled' : ''}>${picking === what ? 'Waiting for the folder window…' : text}</button>`;

function toolCard(k) {
  const p = S.providers[k], on = !!S.config.providers[k];
  const sw = `<label class="pg-sw" title="${on ? 'On' : 'Off'}"><input type="checkbox" aria-label="${esc(p.name)}" data-k="providers.${k}"${on ? ' checked' : ''}><span class="pg-slider"></span></label>`;
  let ok = null, line, act = '';
  if (!on) line = 'Turned off. The panel never sends it work.';
  else if (!p.installed) { ok = false; line = 'Not found on the panel’s PATH.'; act = `<button class="pill pg-go" data-run="${k}:install">Install</button>`; }
  else if (p.signedIn === false) { ok = false; line = 'Installed, not signed in.'; act = `<button class="pill pg-go" data-run="${k}:login">Log in</button>`; }
  else if (p.signedIn === null) { line = 'Installed. Sign-in cannot be read from here.'; act = '<button class="pill pg-go" data-recheck="1">Check again</button>'; }
  else { ok = true; line = 'Installed and signed in.'; act = '<button class="pill pg-done" disabled>Done</button>'; }
  const note = on && p.installed && p.signedIn === false && p.loginNote ? `<div class="pg-hint">${esc(p.loginNote)}</div>` : '';
  return `<div class="pg-card${on ? '' : ' off'}"><div class="pg-ch"><b>${esc(p.name)}</b>${sw}</div>
<div class="pg-hint">${esc(p.what)}</div>
<div class="pg-st">${ic(ok)} ${esc(line)}</div>${note}
<div class="pg-row">${act}${msgs[k] ? `<span class="pg-msg">${esc(msgs[k])}</span>` : ''}</div>
<div class="pg-links">${link(p.site, 'Website')} ${link(p.docs, 'Docs')}</div></div>`;
}

const actRow = (key, ok, title, hint, btn) => `<div class="pg-item"><div class="pg-ih">${ic(ok)} <b>${title}</b></div><div class="pg-hint">${hint}</div><div class="pg-row">${btn}${msgs[key] ? `<span class="pg-msg">${esc(msgs[key])}</span>` : ''}</div></div>`;
const doneBtn = '<button class="pill pg-done" disabled>Done</button>';

function relayCard() {
  const r = S.prereqs.runtime, h = S.hook;
  return `<div class="pg-card pg-wide"><div class="pg-ch"><b>Relay</b></div><div class="pg-hint">The relay lets the panel and Claude start and drive Freebuff, Codex and Cursor. Freebuff tasks need it.</div>
<div class="pg-grid">
${actRow('runtime', r.ok, 'Relay program', esc(r.ok ? `Found at ${r.detail}` : 'Not installed yet.'), r.ok ? doneBtn : '<button class="pill pg-go" data-run="runtime:install" data-key="runtime">Install relay</button>')}
${actRow('patch', null, 'Relay patches', 'Needed after every install or update of the relay. Safe to press again.', `<button class="pill" data-post="/setup/patch" data-key="patch"${r.ok ? '' : ' disabled'}>Apply patches</button>`)}
${actRow('mcp', r.registered, 'Tell Claude about the relay', 'Registers the relay with Claude Code so Claude can use it.', r.registered ? doneBtn : `<button class="pill pg-go" data-run="runtime:mcp" data-key="mcp"${r.ok ? '' : ' disabled'}>Register with Claude</button>`)}
${actRow('hook', h.installed, 'One-CLI hook', h.state === 'other' ? 'The hook in the Claude settings is out of date or doubled. Press the button to fix it.' : 'Stops Claude from opening a second Freebuff CLI when the panel says no. A backup of the Claude settings file is made first.', h.installed ? doneBtn : '<button class="pill pg-go" data-post="/setup/hook" data-key="hook">Install hook</button>')}
</div></div>`;
}

function toolsCard() {
  const ok = S.tools?.register;
  const btn = t => `<button class="pill" data-post="/setup/register?t=${t}" data-key="reg-${t}"${ok ? '' : ' disabled'}>Add to ${NAMES[t] ?? 'Cursor'}</button>${msgs[`reg-${t}`] ? `<span class="pg-msg">${esc(msgs[`reg-${t}`])}</span>` : ''}`;
  return `<div class="pg-card pg-wide"><div class="pg-ch"><b>Tools for your programs</b></div><div class="pg-hint">Each button opens a terminal window on this PC that connects that program to the Command Center tools. Follow what it says.${ok ? '' : ' The helper script is not in this copy, so the buttons are off.'}</div>
<div class="pg-row">${['claude', 'codex', 'opencode', 'cursor'].map(btn).join('')}</div></div>`;
}

function foldersCard() {
  const c = S.config, root = S.root, proj = c.projectDir || '';
  const projOpts = [...(proj ? [] : [['', 'Pick a project…']]), ...F.repos.map(r => [r.path, `${r.name}   (${r.path})`])];
  const inside = proj ? `${slash(proj).replace(/\/+$/, '')}/.cc-reports` : '';
  const repOpts = [...(inside ? [[inside, 'Inside the project (.cc-reports)']] : []), [`${root}/reports`, 'In the Command Center folder (reports)']];
  const par = ['codex', 'cursor', 'opencode', 'claude', 'antigravity'].map(k => fld(`${NAMES[k]} tasks per model`, select(`maxParallel.${k}`, c.maxParallel[k], range(0, k === 'antigravity' ? 1 : 10), `${NAMES[k]} tasks per model`, 'int'), k === 'antigravity' ? 'One Antigravity task total; 0 means none.' : `How many tasks may run on each ${NAMES[k]} model. 0 means none.`)).join('');
  const mods = [['codex', 'Codex model'], ['codexEffort', 'Codex effort'], ['cursor', 'Cursor model'], ['opencode', 'OpenCode model'], ['claude', 'Claude model'], ['antigravity', 'Antigravity model']]
    .map(([k, l]) => fld(l, select(`models.${k}`, c.models[k], modelList(M, k).map(x => [x, x]), l), k === 'codexEffort' ? 'How hard Codex thinks.' : `The model used for panel tasks.`)).join('');
  return `<div class="pg-card pg-wide"><div class="pg-ch"><b>Folders and limits</b></div>
<div class="pg-grid">
${fld('Project folder', `${select('projectDir', proj, projOpts, 'Project folder')} ${pickBtn('project')}`, proj ? `Tasks run in ${esc(proj)} unless you pick another. Repos are found next to it and in your Projects or source folders.` : 'The folder your code lives in. Pick a repo from the list or choose a folder.')}
${fld('Reports folder', `${select('reportsDir', c.reportsDir, repOpts, 'Reports folder')} ${pickBtn('reports')}`, 'Where agents write their finished reports.')}
${fld('Relay program folder', `<code class="pg-path">${esc(S.prereqs.runtime.detail)}</code> ${pickBtn('runtime')}${c.runtimeDir ? ' <button class="pill" data-reset="runtimeDir">Use the default</button>' : ''}`, c.runtimeDir ? 'A folder you chose. The default lives inside the Command Center folder.' : 'The default place, inside the Command Center folder.')}
${fld('Freebuff CLIs at most', select('maxClis', c.maxClis, range(1, 10), 'Freebuff CLIs at most', 'int'), 'The most Freebuff windows open at once, counting any you started yourself.')}
${par}
${fld('Mark a task as stuck after', select('stuckAfterMin', c.stuckAfterMin, [30, 60, 90, 120, 180].map(n => [n, `${n} minutes`]), 'Mark a task as stuck after', 'int'), 'A running task older than this gets a note on the Director tab. It is not stopped.')}
${mods}
</div></div>`;
}

function prereqLine() {
  const r = S.prereqs;
  const row = (ok, text, fix) => `<span class="pg-chip">${ic(ok)} ${esc(text)}${ok ? '' : ` ${fix}`}</span>`;
  return row(r.node.ok, r.node.detail, `Get it from ${link('https://nodejs.org', 'nodejs.org')} (or run <code>winget install OpenJS.NodeJS.LTS</code>), then restart the panel.`)
    + row(r.git.ok, `git: ${r.git.detail}`, `Get it from ${link('https://git-scm.com', 'git-scm.com')}.`);
}

function shell() {
  return `<div class="pg setup-page" id="pg-setup"><div class="cc-pagehead"><div><div class="cc-eyebrow">COMMAND CENTER / SETTINGS</div><h2>Set up your workspace</h2><p class="cc-lead">Connect your tools, choose a project, and decide how much can run at once.</p></div><div class="pg-top"><span id="pg-saved" class="pg-saved"></span><button class="pill" data-recheck="1">↻ Check connections</button></div></div>
<div class="setup-intro"><div><b>Start with an agent</b><span>Turn on the tools you want to use. Changes save automatically.</span></div><div id="pg-pre" class="pg-chips"></div></div>
<div class="cc-sectionhead"><div><span class="cc-step">01</span><h3>AI tools</h3><p class="pg-hint">Install or sign in only where needed.</p></div></div><div class="pg-cards" id="pg-tools"></div>
<div class="setup-sections"><details class="setup-section"><summary><span class="cc-step">02</span><span><b>Project &amp; limits</b><small>Folders, models and concurrency</small></span></summary><div id="pg-folders"></div></details>
<details class="setup-section"><summary><span class="cc-step">03</span><span><b>Relay &amp; integrations</b><small>Connect the relay and agent tools</small></span></summary><div id="pg-relay"></div><div id="pg-ttools"></div></details></div></div>`;
}

function paint(root, force) {
  put(root.querySelector('#pg-pre'), prereqLine(), force);
  put(root.querySelector('#pg-tools'), TOOLS.map(toolCard).join(''), force);
  put(root.querySelector('#pg-relay'), relayCard(), force);
  put(root.querySelector('#pg-ttools'), toolsCard(), force);
  put(root.querySelector('#pg-folders'), foldersCard(), force);
}

function flash(root, text, bad) {
  const b = root.querySelector('#pg-saved');
  if (!b) return;
  b.textContent = text; b.className = `pg-saved ${bad ? 'bad' : text ? 'ok' : ''}`;
  clearTimeout(savedTimer);
  if (!bad && text !== 'Saving…') savedTimer = setTimeout(() => { b.textContent = ''; b.className = 'pg-saved'; }, 2500);
}

async function sendJson(url, body) {
  let res, r;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body == null ? undefined : JSON.stringify(body) });
    r = await res.json().catch(() => ({ error: `The panel answered ${res.status}.` }));
    if (!res.ok && !r.error) r.error = `The panel answered ${res.status}.`;
  } catch (e) { r = { error: `Could not reach the panel: ${e.message}` }; }
  return r;
}

async function save(patch, root) {
  if (!S.config.setupDone) patch = { ...patch, setupDone: true };
  flash(root, 'Saving…');
  const r = await sendJson('/setup', patch);
  if (!root.isConnected) return;
  if (r.error) { flash(root, r.error, true); paint(root, true); return; }
  S = r; paint(root, true); flash(root, '✓ Saved');
}

const nest = (key, v) => key.split('.').reverse().reduce((o, k) => ({ [k]: o }), v);
const insideOf = p => p ? `${slash(p).replace(/\/+$/, '')}/.cc-reports` : '';
function projectPatch(dir) {
  const patch = { projectDir: dir };
  if (same(S.config.reportsDir, insideOf(S.config.projectDir))) patch.reportsDir = insideOf(dir);
  return patch;
}

async function pick(what, root) {
  const cur = what === 'project' ? S.config.projectDir : what === 'reports' ? S.config.reportsDir : S.config.runtimeDir || S.prereqs.runtime.detail;
  picking = what; paint(root);
  const r = await sendJson(`/setup/pick-folder?what=${what}&start=${encodeURIComponent(cur || '')}`);
  picking = null;
  if (!root.isConnected) return;
  if (r.error) { flash(root, r.error, true); paint(root); return; }
  if (!r.path) { paint(root); return; }
  if (what === 'project') { if (!F.repos.some(x => same(x.path, r.path))) F.repos = [{ name: r.path.split('/').pop(), path: r.path }, ...F.repos]; await save(projectPatch(r.path), root); }
  else await save({ [what === 'reports' ? 'reportsDir' : 'runtimeDir']: r.path }, root);
}

async function act(btn, root) {
  const key = btn.dataset.key ?? btn.dataset.run.split(':')[0];
  msgs[key] = 'Working…'; paint(root);
  let url = btn.dataset.post;
  if (!url) { const [p, a] = btn.dataset.run.split(':'); url = `/setup/run?p=${encodeURIComponent(p)}&a=${encodeURIComponent(a)}`; }
  let res, text;
  try { res = await fetch(url, { method: 'POST' }); text = await res.text(); } catch (e) { msgs[key] = `Could not reach the panel: ${e.message}`; paint(root); return; }
  let j = null;
  try { j = JSON.parse(text); } catch {}
  if (!res.ok) msgs[key] = j?.error ?? `Failed: ${text.slice(0, 200)}`;
  else if (j?.config) { S = j; delete msgs[key]; flash(root, '✓ Saved'); }
  else msgs[key] = 'A terminal window opened on this PC. Follow it, then come back here.';
  if (root.isConnected) paint(root, true);
}

async function recheck(root) {
  msgs = {};
  try { await loadSetup(); } catch (e) { flash(root, `Could not read the panel: ${e.message}`, true); return; }
  if (root.isConnected) { paint(root, true); flash(root, ''); }
}

function wireSetup(root) {
  root.addEventListener('change', e => {
    const t = e.target;
    if (!t.dataset?.k) return;
    const v = t.type === 'checkbox' ? t.checked : t.dataset.t === 'int' ? Number(t.value) : t.value;
    save(t.dataset.k === 'projectDir' ? projectPatch(v) : nest(t.dataset.k, v), root);
  });
  root.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.pick) return pick(b.dataset.pick, root);
    if (b.dataset.run || b.dataset.post) return act(b, root);
    if (b.dataset.reset) return save({ [b.dataset.reset]: '' }, root);
    if (b.dataset.recheck) return recheck(root);
  });
}

async function loadSetup() {
  [S, F] = await Promise.all([getJson('/setup'), getJson('/setup/folders').catch(() => F)]);
}
async function loadModels(root) {
  if (Date.now() - mAt < 300000) return;
  mAt = Date.now();
  try { M = await getJson('/models'); } catch { M = null; return; }
  if (root.isConnected && tab === 'setup') paint(root);
}

let focusWired = false;
PAGES.setup = async el => {
  if (setupBusy) return;
  setupBusy = true;
  try {
    const first = !mine(el, 'pg-setup');
    if (first) el.innerHTML = '<div class="empty">Loading setup…</div>';
    try { await loadSetup(); } catch (e) { if (first && tab === 'setup') el.innerHTML = `<div class="empty">Could not read the setup from the panel: ${esc(e.message)}. It tries again in a minute.</div>`; return; }
    if (tab !== 'setup') return;
    if (first) { el.innerHTML = shell(); wireSetup(el.firstElementChild); }
    const root = el.firstElementChild;
    paint(root);
    loadModels(root);
    if (!focusWired) { focusWired = true; addEventListener('focus', () => { if (tab === 'setup') PAGES.setup($('prov')); }); }
  } finally { setupBusy = false; }
};

let dbusy = false, dlast = null;
const fixHtml = (f, i) => {
  if (!f) return '';
  const m = /^Run: ([\s\S]*)$/.exec(f);
  if (!m) return `<div class="pg-fix">${esc(f)}</div>`;
  const [cmd, ...rest] = m[1].split(', then ');
  return `<div class="pg-fix">Run: <code id="pg-dx-${i}">${esc(cmd)}</code> <button class="pill" data-copy="pg-dx-${i}">Copy</button>${rest.length ? ' then ' + esc(rest.join(', then ')) : ''}</div>`;
};
function debugHtml(rows) {
  const groups = new Map();
  rows.forEach((r, i) => { if (!groups.has(r.group)) groups.set(r.group, []); groups.get(r.group).push({ ...r, i }); });
  return [...groups].map(([g, rs]) => `<h3>${esc(g)} <span class="pg-hint">${rs.filter(r => r.ok === true).length} of ${rs.length}</span></h3><table class="pg-tbl">${rs.map(r => `<tr><td class="pg-t1">${ic(r.ok)}</td><td class="pg-t2"><b>${esc(r.name)}</b></td><td>${esc(r.detail)}${r.ok !== true ? fixHtml(r.fix, r.i) : ''}</td></tr>`).join('')}</table>`).join('');
}
const debugText = rows => `Command Center debug, ${new Date().toISOString()}\n` + rows.map(r => `[${r.ok === true ? 'ok' : r.ok === false ? 'FAIL' : 'n/a'}] ${r.group} / ${r.name}: ${r.detail ?? ''}${r.ok !== true && r.fix ? `\n      fix: ${r.fix}` : ''}`).join('\n');
async function runDebug(root) {
  if (dbusy) return;
  dbusy = true;
  const st = root.querySelector('#pg-dst'), btn = root.querySelector('[data-run-debug]');
  btn.disabled = true;
  st.innerHTML = '<span class="pg-spin"></span> Checking… this can take a few seconds.';
  try {
    const rows = await getJson('/debug');
    dlast = rows;
    if (!root.isConnected) return;
    const pass = rows.filter(r => r.ok === true).length, bad = rows.filter(r => r.ok === false).length;
    st.innerHTML = `<b class="${bad ? 'pg-sbad' : 'pg-sok'}">${pass} of ${rows.length} checks pass</b>${bad ? ` · ${bad} need attention` : ''} · checked ${new Date().toLocaleTimeString()}`;
    put(root.querySelector('#pg-dbody'), debugHtml(rows));
  } catch (e) {
    if (root.isConnected) st.innerHTML = `<span class="pg-err">Could not run the checks: ${esc(e.message)}</span>`;
  } finally { dbusy = false; btn.disabled = false; }
}
PAGES.debug = async el => {
  if (!mine(el, 'pg-debug')) {
    el.innerHTML = `<div class="pg" id="pg-debug"><h2>Debug</h2><p class="pg-hint">Checks that everything the Command Center needs is in place. Each failing row says how to fix it.</p>
<div class="pg-row"><button class="pill" data-run-debug="1">Run checks</button><button class="pill" data-copy-all="1">Copy all as text</button><span id="pg-dst"></span></div><div id="pg-dbody">${dlast ? debugHtml(dlast) : ''}</div></div>`;
    const root = el.firstElementChild;
    root.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.copy) copyText(b);
      else if (b.dataset.copyAll) { if (dlast) copyText(b, debugText(dlast)); else b.textContent = 'Run the checks first'; }
      else if (b.dataset.runDebug) runDebug(root);
    });
    runDebug(root);
  }
};

function inline(s) {
  return s.split(/(`[^`]+`)/).map((t, i) => i % 2 ? `<code>${esc(t.slice(1, -1))}</code>`
    : esc(t).replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a target="_blank" rel="noopener" href="$2">$1</a>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')).join('');
}
const BLOCK = /^(\s*```|#{1,4}\s|\s*([-*]|\d+\.)\s|\s*\||-{3,}\s*$)/;
function mdToHtml(src) {
  const L = String(src ?? '').replace(/\r/g, '').split('\n');
  let h = '', i = 0, list = null, m;
  const close = () => { if (list) { h += `</${list}>`; list = null; } };
  while (i < L.length) {
    const line = L[i];
    if (/^\s*```/.test(line)) { close(); const buf = []; i++; while (i < L.length && !/^\s*```/.test(L[i])) buf.push(L[i++]); i++; h += `<pre class="pg-pre">${esc(buf.join('\n'))}</pre>`; continue; }
    if ((m = /^(#{1,4})\s+(.*)$/.exec(line))) { close(); const n = m[1].length + 2; h += `<h${n}>${inline(m[2])}</h${n}>`; i++; continue; }
    if ((m = /^\s*([-*]|\d+\.)\s+(.*)$/.exec(line))) { const t = /\d/.test(m[1]) ? 'ol' : 'ul'; if (list !== t) { close(); h += `<${t}>`; list = t; } h += `<li>${inline(m[2])}</li>`; i++; continue; }
    if (/^\s*\|/.test(line)) {
      close();
      const rows = [];
      while (i < L.length && /^\s*\|/.test(L[i])) rows.push(L[i++].trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim()));
      const body = rows.filter(r => !r.every(c => /^:?-{2,}:?$/.test(c)));
      h += `<table class="pg-tbl">${body.map((r, n) => `<tr>${r.map(c => `<${n ? 'td' : 'th'}>${inline(c)}</${n ? 'td' : 'th'}>`).join('')}</tr>`).join('')}</table>`;
      continue;
    }
    if (/^-{3,}\s*$/.test(line)) { close(); h += '<hr>'; i++; continue; }
    if (!line.trim()) { close(); i++; continue; }
    close();
    const buf = [line]; i++;
    while (i < L.length && L[i].trim() && !BLOCK.test(L[i])) buf.push(L[i++]);
    h += `<p>${inline(buf.join(' '))}</p>`;
  }
  close();
  return h;
}

const GUIDE_DEFAULTS = { providers: { freebuff: true, codex: true, cursor: true, opencode: true }, maxClis: 3, maxParallel: { codex: 2, cursor: 1, opencode: 2 }, stuckAfterMin: 90, reportsDir: 'the reports folder', models: {} };

function sim(c, n) {
  const on = PROV.filter(k => c.providers[k]), cap = { ...c.maxParallel };
  let fb = false;
  return Array.from({ length: n }, () => {
    for (const p of on) {
      if (p === 'freebuff') { if (!fb && c.maxClis > 0) { fb = true; return FB; } }
      else if (cap[p] > 0) { cap[p]--; return NAMES[p]; }
    }
    return null;
  });
}

function guideSections(s) {
  const c = { ...GUIDE_DEFAULTS, ...s.config }, root = s.root || 'the Command Center folder', mp = { ...GUIDE_DEFAULTS.maxParallel, ...c.maxParallel };
  c.providers = { ...GUIDE_DEFAULTS.providers, ...c.providers }; c.maxParallel = mp;
  const on = PROV.filter(k => c.providers[k]), list = on.map(k => NAMES[k]).join(', ') || 'none yet';
  const five = sim(c, 5), waiting = sim(c, 8).slice(5).filter(x => !x).length, fbFirst = five[0] === FB;
  const dir = d => esc(String(d).replace(/\\/g, '/'));
  const note = (x, i) => i === 1 && fbFirst && x && x !== FB ? ' Freebuff is still starting the first CLI, so it moves down the list.' : '';
  return [
    ['what', 'What the Command Center is', `<p>It is one place to see and run all your AI coding work. It brings Freebuff, Codex, Cursor, OpenCode and Claude together. You hand it a task, it picks a tool that has room, starts it, and shows you what happens and what is left on each plan.</p>
<p>It runs on this PC only and cannot be reached from other machines. Tools turned on right now: <b>${esc(list)}</b>. Change that in the Setup tab.</p>`],
    ['tabs', 'The tabs', `<ul class="pg-dl">
<li><b>Home</b> an overview of all the tools.</li>
<li><b>Director</b> the one place for work, a chat with your director. Pick the director model, tick the models it may use and how hard each thinks, then say what you want done. It plans the work, hands the parts to agents, approves their sub-tasks, checks their reports and tells you what happened. Everything reports to it. Below the chat: what it handed out, what needs you, the task tree (stop or retry), the team board the agents write, the budget, and the model each tool uses by default.</li>
<li><b>Sessions</b> one list of every agent session (Freebuff, Codex, Cursor, OpenCode, Claude): who, what it is doing, where, when it last moved. Click a row to read it. Click a Freebuff row for the live Freebuff view with the model picker.</li>
<li><b>Archive</b> finished sessions (the ones that wrote a report), so the live lists stay short.</li>
<li><b>Hooks &amp; MCP</b> every hook, MCP server and plugin on this PC for your AI tools, with switches. Each change keeps a backup of the file it touches. Restart the tool for a change to apply.</li>
<li><b>Guide</b> this page. Part 1 is for you. Part 2 is written for AI agents.</li>
<li><b>Debug</b> checks that everything is in place and tells you how to fix what is not. "Copy all as text" gives you the whole result to paste to someone.</li>
<li><b>Setup</b> one page for tools, the relay, folders and limits. Everything saves as soon as you change it.</li></ul>
<p>The line at the top right shows the current automatic routing choice. The Director uses its configured provider, or an available provider when none is usable.</p>`],
    ['setup', 'Setup in one page', `<p>Open the Setup tab. There is nothing to type: you pick from lists and buttons, and a folder window opens when you need to choose a folder.</p>
<ul><li><b>AI tools</b>: one card for each tool. The switch turns it on or off. The big button shows the next thing to do: Install, then Log in, then it says Done. The Website and Docs links open the tool's own pages.</li>
<li><b>Relay</b>: install the relay program, apply its patches, tell Claude about it, and add the one-CLI hook. The hook button changes your Claude settings file; it saves a backup first.</li>
<li><b>Tools for your programs</b>: buttons that connect Claude, Codex, OpenCode or Cursor to the Command Center tools. Each opens a terminal.</li>
<li><b>Folders and limits</b>: pick your project from the list or press Choose folder. Reports can go inside the project. Limits and models are drop-down lists.</li></ul>
<p>Install and Log in open a terminal window. Follow it, then come back: the page checks again by itself.</p>`],
    ['run', 'How a task runs', `<ol>
<li>You add a task. The panel writes it to a file in <code>${dir(root)}/tasks/</code> and puts it in the queue as <b>waiting</b>.</li>
<li>Every 5 seconds the panel checks the queue and picks a tool for each waiting task (next section).</li>
<li>The tool is told to read the task file. The file also says where to write the report.</li>
<li>The agent works, then writes a short report to <code>${dir(c.reportsDir)}/&lt;task id&gt;.md</code>.</li>
<li>When the report appears, the task is <b>done</b>.</li></ol>
<p>Freebuff runs inside a window the panel drives, so it is done when the report file appears. Codex, Cursor and OpenCode run headless (no window). They are done when their process ends: a clean exit means done, anything else means failed. If such a tool ends without writing a report, the panel saves its last output as the report.</p>
<p>A running task older than <b>${esc(c.stuckAfterMin)} minutes</b> gets a note saying so. It is not stopped. Logs are in <code>${dir(root)}/logs/</code>. If the panel itself restarts, running tasks are marked failed; press Retry.</p>`],
    ['smart', 'How sessions start smartly', `<p>The panel never starts more than you allow. Your limits right now:</p>
<ul><li><b>Freebuff</b>: up to ${esc(c.maxClis)} CLIs open at once (it counts any you opened yourself). Only one starts at a time. A new one needs 2 or more hours of the model left, or a free model.</li>
<li><b>Codex</b>: ${esc(mp.codex)} at once. <b>Cursor</b>: ${esc(mp.cursor)} at once. <b>OpenCode</b>: ${esc(mp.opencode)} at once.</li></ul>
<p>With <b>Automatic</b>, the panel tries the tools in this usual order: Freebuff (while it has DeepSeek hours), then Codex (while it is under its limit), then Cursor (if signed in), then OpenCode. If you choose a tool by hand, only that tool is tried. The top-right line shows the live order.</p>
${on.length ? `<div class="pg-ex"><b>Example: you add 5 coding tasks at once</b><ol>${five.map((x, i) => `<li>Task ${i + 1} ${x ? 'starts on <b>' + esc(x) + '</b>.' + note(x, i) : 'waits.'}</li>`).join('')}</ol>
<p>${waiting ? `If you add 3 more straight away, ${waiting} of them wait, because every tool is at its limit. ` : ''}A waiting task shows its reason on the Director tab, for example "codex: ${esc(mp.codex)} of ${esc(mp.codex)} allowed tasks are running." Every 5 seconds it tries again. As soon as a slot frees up, or a Freebuff CLI becomes idle or finishes starting, the next waiting task starts. An idle Freebuff CLI is reused with a fresh chat.</p>
<p class="pg-hint">This assumes each tool is signed in, has room, and Freebuff has hours. The Director tab always shows the real reason.</p></div>` : '<p class="pg-hint">No tool is turned on yet. Open Setup and turn one on.</p>'}`],
    ['kinds', 'Task kinds', `<p>Every task has a kind. For Freebuff it picks the model.</p>
<ul><li><b>Coding</b> (<code>[code]</code>, the default): the model chosen in the Freebuff view, usually DeepSeek. It costs hours. When less than 2 hours of it are left, Beam codes instead.</li>
<li><b>Small coding</b> (<code>[light]</code>): Beam. Free. Good for small, clear changes.</li>
<li><b>Read only</b> (<code>[read]</code>): Solar Pro. Free. For exploring, summaries and reviews. The task is told not to change any file. Codex runs it in a read-only sandbox.</li></ul>
<p>Small and read-only tasks try Freebuff first because it is free, then the other tools in the order Codex, Cursor, OpenCode.</p>`],
    ['hours', 'Freebuff hours', `<p>Freebuff gives you a number of hours each day. They reset at the time shown in the Freebuff view.</p>
<ul><li>DeepSeek costs hours, usually 2 hours of your balance for each hour of work.</li><li>Beam and Solar Pro are free.</li>
<li>An open CLI holds its hours until its time runs out, even while idle. That is why the panel counts running CLIs before it starts another.</li></ul>`],
    ['board', 'The team board', `<p>A shared notepad for every agent. Before a task starts, each agent is told to read it. While it works it posts what others need: a file map, a finding, a blocker, a line when done. You can read it on the Director tab. Only the agents write to it.</p>
<p>Agents read it with <code>curl.exe -s http://127.0.0.1:4021/board</code>. Notes are kept in <code>${dir(root)}/board.jsonl</code>. Keep notes short and never post secrets.</p>`],
    ['relay', 'The relay and its patches', `<p>The relay (agent-interop-runtime) is a small program that lets the panel, and Claude, start and talk to Freebuff, Codex and Cursor. It is installed in <code>${dir(s.prereqs?.runtime?.detail ?? root + '/runtime')}</code>.</p>
<p>Two files in <code>${dir(root)}/relay/</code> are patched copies of its own files:</p>
<ul><li><code>pty.js</code> runs one Freebuff CLI per task, waits 10 seconds for it to start, and runs <code>/compact</code> by itself at 150k tokens.</li>
<li><code>adapters.js</code> gives Cursor and Codex 30 seconds to answer, so they do not time out too early.</li></ul>
<p>Installing or updating the relay writes the original files back. Press <b>Apply patches</b> in the Relay card on the Setup tab. It says "patched" or "already patched", and only patches the known 1.1.0 original. Then <b>restart the relay MCP server</b> (restart Claude Code) so it loads the new files.</p>`],
    ['watch', 'Watching sessions', `<p>The Sessions tab lists every agent session (Freebuff, Codex, Cursor, OpenCode, Claude) and what it is doing. Click a row to see its steps: what it said, the commands it ran and what came back. Use this when a task looks stuck.</p>`],
    ['fix', 'Troubleshooting', `<p>Start with the <b>Debug</b> tab. It runs every check and shows the fix next to each failure. Common ones:</p>
<ul><li><b>Not signed in</b>: use the tool's Log in button (or its card on Setup). A terminal opens; follow it.</li>
<li><b>Usage unreadable</b>: check the Debug tab for the reason. This does not mean the tool ran out, only that the panel could not read it.</li>
<li><b>Dispatcher stopped</b>: the queue is not moving. Restart the panel with the Command Center shortcut or <code>start.ps1</code>.</li>
<li><b>Patch not applied</b>: press Apply patches in the Relay card, then restart the relay MCP server.</li>
<li><b>A task waits for no clear reason</b>: read its reason on the Director tab. Usually a limit is full or hours are low.</li></ul>`],
    ['move', 'Moving to a new PC', `<p>Do not copy this folder to the new PC. It holds your settings, task history, logs and folder paths for this PC. Use the installer instead.</p>
<ol><li>On this PC, run <code>pack.ps1</code> in the Command Center folder. It writes <code>CommandCenter-&lt;date&gt;.zip</code> and lists what it left out on purpose: your settings, tasks, logs, reports, board, relay runtime and backups.</li>
<li>Copy the zip to the new PC and unzip it anywhere.</li>
<li>Double-click <code>Install.cmd</code>. It checks Node.js (22.13 or newer) and git, asks where to install, installs the relay, and makes Start-menu and desktop shortcuts called "Command Center".</li>
<li>The panel opens on Setup. Sign-ins do not travel, so log in to each tool again. Pick your project folder there too.</li></ol>
<p>To remove it later, run <code>uninstall.ps1</code> from the installed folder.</p>`],
  ];
}

let aiText = '';
PAGES.guide = async el => {
  if (mine(el, 'pg-guide')) return;
  el.innerHTML = '<div class="empty">Loading the guide…</div>';
  let s = { config: {}, root: '', prereqs: {} };
  try { s = await getJson('/setup'); } catch {}
  let aiHtml = '<p class="pg-hint">The AI guide could not be loaded.</p>';
  try { const r = await fetch('/ai-guide'); if (r.ok) { aiText = await r.text(); aiHtml = mdToHtml(aiText); } } catch {}
  if (tab !== 'guide') return;
  const secs = guideSections(s);
  el.innerHTML = `<div class="pg pg-guide" id="pg-guide"><div class="cc-pagehead"><div><div class="cc-eyebrow">LEARN / COMMAND CENTER</div><h2>How can we help?</h2><p class="cc-lead">Pick a topic and get just the steps you need.</p></div></div>
<div class="guide-layout"><div class="guide-nav" role="navigation" aria-label="Guide topics"><b>ON THIS PAGE</b>${secs.map(([id, t]) => `<button type="button" data-go="pg-s-${id}">${esc(t)}</button>`).join('')}<button type="button" data-go="pg-part2">Guide for agents</button></div>
<div class="guide-content"><div class="guide-start"><div class="cc-eyebrow">QUICK START</div><h3>From an idea to a result</h3><div class="guide-steps"><span><b>1</b> Connect an agent in Setup</span><span><b>2</b> Give the Director a goal</span><span><b>3</b> Follow work in Sessions</span></div></div>
<h3 class="guide-label">Explore the guide</h3>${secs.map(([id, t, h], i) => `<details class="guide-topic" id="pg-s-${id}"${i === 0 ? ' open' : ''}><summary><span>${esc(t)}</span><small>Read topic</small></summary><div class="guide-body">${h}</div></details>`).join('')}
<details class="guide-topic" id="pg-part2"><summary><span>Guide for agents</span><small>Technical reference</small></summary><div class="guide-body"><p class="pg-hint">Agents can fetch the same text from <code>/ai-guide</code>.</p><div class="pg-row"><button class="pill" data-copy-ai="1">Copy agent guide</button></div><div class="pg-ai">${aiHtml}</div></div></details></div></div></div>`;
  el.firstElementChild.addEventListener('click', e => {
    const b = e.target.closest('button[data-copy]'); if (b) return copyText(b);
    const ai = e.target.closest('button[data-copy-ai]'); if (ai) return copyText(ai, aiText);
    const a = e.target.closest('[data-go]'); if (a) { const target = document.getElementById(a.dataset.go); if (target) { target.open = true; target.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }
  });
};
})();

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';

const names = ['freebuff', 'codex', 'cursor', 'opencode', 'claude', 'antigravity'];
const display = { freebuff: 'Freebuff', codex: 'Codex', cursor: 'Cursor', opencode: 'OpenCode', claude: 'Claude', antigravity: 'Antigravity' };
const providers = Object.fromEntries(names.map(name => [name, { name: display[name], what: `Use ${display[name]}`, installed: true, signedIn: true, site: '', docs: '' }]));
const config = { setupDone: true, providers: Object.fromEntries(names.map(name => [name, true])), maxParallel: { codex: 2, cursor: 1, opencode: 2, claude: 1, antigravity: 1 }, maxClis: 3, stuckAfterMin: 90, models: {}, projectDir: '', reportsDir: '/reports', runtimeDir: '' };
const setup = { config, providers, root: '/workspace', prereqs: { runtime: { ok: true, detail: '/runtime', registered: true }, node: { ok: true, detail: 'Node 22' }, git: { ok: true, detail: 'git' } }, hook: { installed: true }, tools: { register: true } };
const now = Date.now(), stamp = new Date(now).toISOString();
const task = { id: 'example-task', title: 'Director task with a readable title', status: 'cancelled', role: 'orchestrator', kind: 'code', provider: 'codex', ranOn: 'codex', model: 'example-model', cwd: '/workspace/git/example-task', createdAt: stamp, startedAt: stamp, endedAt: stamp, note: 'Stopped with its goal.' };
const session = { id: 'example-session', provider: 'codex', title: 'Example session', model: 'example-model', cwd: '/workspace/project', mtime: now, live: 'recent', liveWhy: 'Recent activity', archived: false };
const sessions = [session, ...Array.from({ length: 26 }, (_, i) => ({ ...session, id: `finished-${i}`, title: `Finished session ${i}`, live: 'finished', mtime: now - i - 1000 }))];
const pullRequest = { number: 12, title: 'A pull request with a descriptive title', url: 'https://example.com/pr/12', head: 'example-branch', headSha: '1234567', headShaFull: '123456789', evidence: { ci: 'passing', review: 'approved' }, ci: { state: 'passing', pass: 1, fail: 0, pending: 0 }, updatedAt: stamp };
let orch = { orchestrator: { mode: 'orchestrated', provider: 'codex' }, team: [], workerModels: {}, efforts: { codex: ['low', 'high'] } };
const reply = pathname => ({
  '/api': [], '/setup': setup, '/setup/folders': { repos: [] }, '/models': { codex: [{ id: 'example-model', name: 'Example Model' }] }, '/board': [],
  '/tasks': { tasks: [task], dispatcher: { lastTick: now } },
  '/director': { goals: [], needsYou: [], dispatcher: { lastTick: now }, config: {}, machines: null, github: { repo: 'example/repo', at: stamp, prs: [pullRequest] } },
  '/orch': orch,
  '/budget': { providers: { codex: { enabled: true, installed: true, running: 0, max: 2 } } },
  '/sessions': sessions, '/session': { ...session, steps: [{ k: 'text', text: 'A long message. '.repeat(60) }] },
  '/archive/sessions': [{ ...session, archived: true }], '/ext/list': { files: [], stash: { ok: true }, rows: [{ section: 'hooks', id: 'example-hook', rev: '1', on: true, name: 'Example hook', app: 'Codex', what: 'Runs before a tool starts.', source: 'Example settings', path: '/workspace/settings' }] },
  '/debug': [{ group: 'System', name: 'Example', ok: false, detail: 'Could not read /workspace/example-with-a-long-name/configuration.json', fix: 'Check the example configuration.' }],
  '/spawn-check': { clis: [], max: 1, roles: {} },
}[pathname]);
const publicDir = path.resolve('viewer/public');
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'POST' && (url.pathname === '/orch/config' || url.pathname === '/setup')) {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      const body = JSON.parse(raw);
      if (url.pathname === '/orch/config') orch = { ...orch, ...body };
      else if (body.providers) Object.assign(config.providers, body.providers);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(url.pathname === '/orch/config' ? orch : setup));
    });
    return;
  }
  if (url.pathname === '/ai-guide') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('# Agent guide\nExample.'); }
  if (url.pathname === '/usage') {
    const p = url.searchParams.get('p');
    const body = p === 'route' ? { provider: 'codex', model: 'example-model', why: 'Available' } : p === 'fbmodels' ? { rows: [] } : { today: { left: '20:00', limit: 24 }, month: { left: 0, limit: 0 }, open: [], fetchedAt: now };
    res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(body));
  }
  const body = reply(url.pathname);
  if (body !== undefined) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(body)); }
  const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  if (!/^[\w.-]+\.(html|js|css)$/.test(name)) { res.writeHead(404); return res.end(); }
  try { const data = fs.readFileSync(path.join(publicDir, name)); res.writeHead(200, { 'Content-Type': name.endsWith('.html') ? 'text/html' : name.endsWith('.css') ? 'text/css' : 'text/javascript' }); res.end(data); }
  catch { res.writeHead(404); res.end(); }
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  fs.mkdirSync('frontend-artifacts', { recursive: true });
  for (const width of [1440, 390]) {
    config.providers.codex = true;
    orch.orchestrator = { mode: 'orchestrated', provider: 'codex' };
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const pages = [['home', '#hm-root'], ['director', '#dr-root'], ['sessions', '.session-table-wrap'], ['archive', '.archive'], ['ext', '.ext'], ['guide', '#pg-guide'], ['debug', '#pg-debug'], ['setup', '#pg-setup']];
    for (const [index, [tab, selector]] of pages.entries()) {
      if (index) await page.locator('#prov').evaluate(el => { el.scrollTop = el.scrollHeight; });
      await page.locator(`#tabs [data-t="${tab}"]`).click();
      await page.locator(selector).waitFor({ state: 'visible' });
      if (tab === 'ext') await page.locator('.ext .xsec').first().waitFor({ state: 'visible' });
      if (tab === 'debug') await page.locator('#pg-dbody .pg-tbl').first().waitFor({ state: 'visible' });
      assert.equal(await page.locator('#prov').evaluate(el => el.scrollTop), 0, `${tab} should open at the top`);
      await page.screenshot({ path: `frontend-artifacts/${width}-${tab}.png` });
      const overflow = await page.locator('#prov').evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth }));
      assert.ok(overflow.scroll <= overflow.width + 1, `${tab} overflows at ${width}px: ${JSON.stringify(overflow)}`);
      if (tab === 'director') {
        await page.locator('[data-panel="models"]').click();
        await page.locator('#dr-models option').first().waitFor({ state: 'attached' });
        await page.locator('#dr-model').focus();
        await page.locator('#dr-models-menu').waitFor({ state: 'visible' });
        await page.keyboard.press('ArrowDown');
        await Promise.all([page.waitForResponse(r => r.url().endsWith('/orch/config') && r.request().method() === 'POST'), page.keyboard.press('Enter')]);
        assert.equal(orch.orchestrator.model, 'example-model');
        await page.locator('[data-panel="advanced"]').click();
        const prs = page.locator('#dr-pr-table');
        await prs.waitFor({ state: 'visible' });
        assert.equal(await prs.getByText(pullRequest.title).count(), 1);
        await prs.screenshot({ path: `frontend-artifacts/${width}-pull-requests.png` });
        const settings = await page.locator('#prov').evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth }));
        assert.ok(settings.scroll <= settings.width + 1, `Director settings overflow at ${width}px: ${JSON.stringify(settings)}`);
        await page.screenshot({ path: `frontend-artifacts/${width}-director-settings.png` });
        await page.locator('[data-panel="tasks"]').click();
        const table = page.locator('#tk-list .tk-table-wrap');
        await table.waitFor({ state: 'visible' });
        assert.equal(await table.getByText(task.title).count(), 1, 'Finished task must appear in the task table');
        await table.screenshot({ path: `frontend-artifacts/${width}-tasks.png` });
        await page.screenshot({ path: `frontend-artifacts/${width}-director-tasks.png` });
        const sizes = await table.evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth }));
        if (width === 390) assert.ok(sizes.scroll > sizes.width, 'Task table should scroll inside its panel at narrow widths');
        const panel = await page.locator('#prov').evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth }));
        assert.ok(panel.scroll <= panel.width + 1, `Director tasks overflow the page at ${width}px: ${JSON.stringify(panel)}`);
        if (width === 390) {
          await page.locator('#prov').evaluate(el => { el.scrollTop = el.scrollHeight; });
          assert.ok(await page.locator('#prov').evaluate(el => el.scrollTop) > 0, 'Director fixture must scroll before testing navigation');
        }
      }
      if (tab === 'sessions') {
        await page.locator('[data-session-provider="claude"]').click();
        await page.getByText('No sessions match these filters.').waitFor({ state: 'visible' });
        assert.equal(await page.evaluate(() => document.activeElement.dataset.sessionProvider), 'claude');
        await page.locator('[data-session-provider="all"]').click();
        await page.locator('#session-state').selectOption('finished');
        assert.match(await page.locator('.sess-all .archive-pager span').innerText(), /26 matching · page 1 of 2/);
        await page.locator('[data-session-page="next"]').click();
        assert.match(await page.locator('.sess-all .archive-pager span').innerText(), /page 2 of 2/);
        await page.locator('#session-state').selectOption('recent');
        await page.locator('#session-search').fill('no matching session');
        await page.getByText('No sessions match these filters.').waitFor({ state: 'visible' });
        await page.locator('#session-search').fill('Example session');
        await page.locator('.session-open').first().click();
        await page.getByRole('dialog').waitFor({ state: 'visible' });
        assert.equal(await page.evaluate(() => document.activeElement.id), 'vclose');
        await page.getByRole('button', { name: 'Show more' }).waitFor({ state: 'visible' });
        await page.screenshot({ path: `frontend-artifacts/${width}-session-dialog.png` });
        await page.getByRole('button', { name: 'Show more' }).focus();
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'vfollow');
        await page.keyboard.press('Shift+Tab');
        assert.equal(await page.evaluate(() => document.activeElement.dataset.expand), `${session.provider}:${session.id}:0`);
        await page.getByRole('button', { name: 'Show more' }).click();
        await page.keyboard.press('Escape');
        assert.equal(await page.getByRole('dialog').isVisible(), false);
      }
      if (tab === 'archive') {
        await page.locator('.asearch').fill('no matching archive');
        await page.getByText('Nothing matches your search.').waitFor({ state: 'visible' });
        await page.locator('.asearch').fill('Example session');
        await page.locator('.arow summary').first().click();
        await page.locator('.arow .aopen').first().waitFor({ state: 'visible' });
      }
      if (tab === 'ext') {
        await page.locator('#xq').fill('no matching hook');
        await page.getByText('Nothing matches your search.').first().waitFor({ state: 'visible' });
      }
      if (tab === 'guide') {
        await page.locator('[data-go="pg-s-tabs"]').click();
        assert.equal(await page.locator('#pg-s-tabs').evaluate(el => el.open), true);
      }
      if (tab === 'setup') {
        await page.getByText('Project & limits').click();
        await page.getByLabel('Project folder').waitFor({ state: 'visible' });
        await page.screenshot({ path: `frontend-artifacts/${width}-setup-project.png` });
        const codex = page.getByLabel('Codex', { exact: true });
        await Promise.all([page.waitForResponse(r => r.url().endsWith('/setup') && r.request().method() === 'POST'), codex.locator('..').click()]);
        await page.waitForFunction(() => document.querySelector('#pg-saved')?.textContent.includes('Saved'));
        assert.equal(config.providers.codex, false);
        assert.equal(await page.getByLabel('Codex', { exact: true }).isChecked(), false);
      }
    }
    assert.deepEqual(errors, [], `Page errors at ${width}px`);
    await page.close();
  }
} finally {
  if (browser) await browser.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}

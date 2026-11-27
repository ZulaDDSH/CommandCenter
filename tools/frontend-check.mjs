import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';

const names = ['freebuff', 'codex', 'cursor', 'opencode', 'claude', 'antigravity'];
const providers = Object.fromEntries(names.map(name => [name, { name, what: `Use ${name}`, installed: true, signedIn: true, site: '', docs: '' }]));
const config = { setupDone: true, providers: Object.fromEntries(names.map(name => [name, true])), maxParallel: { codex: 2, cursor: 1, opencode: 2, claude: 1, antigravity: 1 }, maxClis: 3, stuckAfterMin: 90, models: {}, projectDir: '', reportsDir: '/reports', runtimeDir: '' };
const setup = { config, providers, root: '/workspace', prereqs: { runtime: { ok: true, detail: '/runtime', registered: true }, node: { ok: true, detail: 'Node 22' }, git: { ok: true, detail: 'git' } }, hook: { installed: true }, tools: { register: true } };
const now = Date.now(), stamp = new Date(now).toISOString();
const task = { id: 'example-task', title: 'Director task with a readable title', status: 'cancelled', role: 'orchestrator', kind: 'code', provider: 'codex', ranOn: 'codex', model: 'example-model', cwd: '/workspace/git/example-task', createdAt: stamp, startedAt: stamp, endedAt: stamp, note: 'Stopped with its goal.' };
const session = { id: 'example-session', provider: 'codex', title: 'Example session', model: 'example-model', cwd: '/workspace/project', mtime: now, live: 'recent', liveWhy: 'Recent activity', archived: false };
const reply = pathname => ({
  '/api': [], '/setup': setup, '/setup/folders': { repos: [] }, '/models': {}, '/board': [],
  '/tasks': { tasks: [task], dispatcher: { lastTick: now } },
  '/director': { goals: [], needsYou: [], dispatcher: { lastTick: now }, config: {}, machines: null, github: { prs: [] } },
  '/orch': { orchestrator: { mode: 'orchestrated', provider: 'codex' }, team: [], workerModels: {}, efforts: { codex: ['low', 'high'] } },
  '/budget': { providers: { codex: { enabled: true, installed: true, running: 0, max: 2 } } },
  '/sessions': [session], '/session': { ...session, steps: [{ k: 'text', text: 'A long message. '.repeat(60) }] },
  '/archive/sessions': [{ ...session, archived: true }], '/ext/list': { files: [], stash: { ok: true }, rows: [] },
  '/debug': [{ group: 'System', name: 'Example', ok: true, detail: 'Ready' }],
  '/spawn-check': { clis: [], max: 1, roles: {} },
}[pathname]);
const publicDir = path.resolve('viewer/public');
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
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
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const pages = [['home', '#hm-root'], ['director', '#dr-root'], ['sessions', '.session-table-wrap'], ['archive', '.archive'], ['ext', '.ext'], ['guide', '#pg-guide'], ['debug', '#pg-debug'], ['setup', '#pg-setup']];
    for (const [tab, selector] of pages) {
      await page.locator(`#tabs [data-t="${tab}"]`).click();
      await page.locator(selector).waitFor({ state: 'visible' });
      await page.screenshot({ path: `frontend-artifacts/${width}-${tab}.png` });
      const overflow = await page.locator('#prov').evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth }));
      assert.ok(overflow.scroll <= overflow.width + 1, `${tab} overflows at ${width}px: ${JSON.stringify(overflow)}`);
      if (tab === 'director') {
        await page.locator('[data-panel="tasks"]').click();
        const table = page.locator('.tk-table-wrap');
        await table.waitFor({ state: 'visible' });
        assert.equal(await table.getByText(task.title).count(), 1, 'Finished task must appear in the task table');
        await table.screenshot({ path: `frontend-artifacts/${width}-tasks.png` });
        const sizes = await table.evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth }));
        if (width === 390) assert.ok(sizes.scroll > sizes.width, 'Task table should scroll inside its panel at narrow widths');
        const panel = await page.locator('#prov').evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth }));
        assert.ok(panel.scroll <= panel.width + 1, `Director tasks overflow the page at ${width}px: ${JSON.stringify(panel)}`);
      }
      if (tab === 'sessions') {
        await page.locator('.session-open').first().click();
        await page.getByRole('dialog').waitFor({ state: 'visible' });
        assert.equal(await page.evaluate(() => document.activeElement.id), 'vclose');
        await page.getByRole('button', { name: 'Show more' }).click();
        await page.keyboard.press('Escape');
        assert.equal(await page.getByRole('dialog').isVisible(), false);
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

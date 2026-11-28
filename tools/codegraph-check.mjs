import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-codegraph-'));
try {
  const project = path.join(root, 'project');
  fs.mkdirSync(project);
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ projectDir: project }));
  process.env.CC_ROOT = root;
  const { explore } = await import('./codegraph.mjs');
  assert.throws(() => explore('foo'), /no CodeGraph index/);
  assert.throws(() => explore(''), /query/);
  fs.mkdirSync(path.join(project, '.codegraph'));
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path.join(project, '.codegraph', 'codegraph.db'));
  db.exec("CREATE TABLE nodes (id TEXT PRIMARY KEY, name TEXT, kind TEXT, file_path TEXT, start_line INTEGER); CREATE TABLE edges (source TEXT, target TEXT, kind TEXT); CREATE TABLE files (path TEXT); INSERT INTO files VALUES ('caller.cs'),('target.cs'),('leaf.cs'),('empty.cs'); INSERT INTO nodes VALUES ('a','Caller','method','caller.cs',3),('b','Target','method','target.cs',9),('c','Leaf','method','leaf.cs',4),('d','WeatherKind','enum','leaf.cs',5); INSERT INTO edges VALUES ('a','b','calls'),('a','b','calls'),('b','c','calls');");
  const insert = db.prepare('INSERT INTO nodes VALUES (?,?,?,?,?)');
  for (let i = 0; i < 35; i++) insert.run(`extra${i}`, `Match${i}`, 'enum', 'leaf.cs', i);
  db.exec("INSERT INTO files VALUES ('src_1/test.cs'),('srcX1/diff.cs'); INSERT INTO nodes VALUES ('e','Scoped','method','src_1/test.cs',1),('f','Other','method','srcX1/diff.cs',1); INSERT INTO edges VALUES ('e','f','calls'),('f','e','calls');");
  db.close();
  const { graph } = await import('../lib/codegraph-view.mjs');
  assert.equal(graph(project, { query: 'arget' }).results[0].id, 'b');
  assert.equal(graph(project, { query: 'WeatherKind' }).results[0].kind, 'enum');
  assert.equal(graph(project, { query: 'Match' }).hasMore, true);
  assert.equal(graph(project, { query: 'Match', offset: 30 }).results.length, 5);
  const view = graph(project, { id: 'b' });
  assert.equal(view.center.name, 'Target');
  assert.equal(view.callers[0].name, 'Caller');
  assert.equal(view.callers[0].calls, 2);
  assert.equal(view.callees[0].name, 'Leaf');
  assert.throws(() => graph(project, { id: 'missing' }), /no longer/);
  const { Worker } = await import('node:worker_threads');
  const inspect = (scope = '', file = '') => { const worker = new Worker(new URL('../lib/codegraph-overview-worker.mjs', import.meta.url), { workerData: { project, scope, file } }); return new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); }); };
  const overview = await inspect();
  assert.equal(overview.error, undefined);
  assert.deepEqual(new Set(overview.data.nodes.map(n => n.name)), new Set(['caller.cs', 'target.cs', 'leaf.cs', 'empty.cs', 'src_1', 'srcX1']));
  assert.equal(overview.data.links.find(l => l.source === 'file:caller.cs' && l.target === 'file:target.cs').count, 2);
  const scoped = (await inspect('src_1')).data;
  assert.ok(scoped.nodes.some(n => n.id === 'file:src_1/test.cs'));
  assert.ok(scoped.nodes.some(n => n.id === 'outside:srcX1/diff.cs'));
  assert.equal(scoped.links.length, 2);
  const fileView = (await inspect('', 'src_1/test.cs')).data;
  assert.ok(fileView.nodes.some(n => n.id === 'symbol:e'));
  assert.equal(fileView.links.length, 2);
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'codegraph.cmd'), '@echo off\r\necho %DO_NOT_TRACK% %CODEGRAPH_TELEMETRY% %*\r\n');
  const oldPath = process.env.Path, oldTrack = process.env.DO_NOT_TRACK, oldHome = process.env.USERPROFILE;
  process.env.Path = `${bin};${oldPath || ''}`;
  process.env.USERPROFILE = path.join(root, 'home');
  try {
    const result = explore('Example');
    assert.match(result, /1 0 explore/);
    assert.ok(result.includes(project));
    assert.ok(result.includes('Locate: Example'));
    assert.equal(process.env.DO_NOT_TRACK, oldTrack);
    const bundle = path.join(process.env.USERPROFILE, '.local', 'codegraph', 'node_modules', '@colbymchenry', `codegraph-${process.platform}-${process.arch}`);
    const entry = path.join(bundle, 'lib', 'dist', 'bin');
    fs.mkdirSync(entry, { recursive: true });
    fs.writeFileSync(path.join(bundle, 'node.exe'), 'not an executable');
    fs.writeFileSync(path.join(entry, 'codegraph.js'), '');
    assert.match(explore('Example'), /1 0 explore/);
  } finally {
    if (oldPath === undefined) delete process.env.Path; else process.env.Path = oldPath;
    if (oldHome === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = oldHome;
  }
} finally { fs.rmSync(root, { recursive: true, force: true }); }

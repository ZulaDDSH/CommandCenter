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
  fs.writeFileSync(path.join(project, '.codegraph', 'codegraph.db'), '');
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

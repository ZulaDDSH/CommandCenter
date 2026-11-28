import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findOnPath, registryPathFromOutput, which, windowsCodexApp } from '../lib/cli.mjs';
import { findBin, binCall } from '../usage/exec.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-path-'));
try {
  const first = path.join(root, 'first'), second = path.join(root, 'second');
  fs.mkdirSync(first);
  fs.mkdirSync(second);
  const one = path.join(first, 'cc-fake.EXE'), two = path.join(second, 'cc-fake.CMD');
  fs.writeFileSync(one, '');
  fs.writeFileSync(two, '@echo off\r\n');
  const user = `    Path    REG_EXPAND_SZ    %FAKE_ROOT%\\first`;
  const machine = `    Path    REG_SZ    ${second}`;
  const registryPath = registryPathFromOutput([machine, user], { fake_root: root });
  assert.equal(findOnPath('cc-fake', registryPath), two);
  fs.unlinkSync(two);
  assert.equal(findOnPath('cc-fake', registryPath), one);
  fs.unlinkSync(one);
  fs.writeFileSync(two, '@echo off\r\n');
  assert.equal(findOnPath('../cc-fake', registryPath), null);
  assert.equal(registryPathFromOutput(['not found'], {}), '');
  const old = process.env.Path;
  try {
    process.env.Path = `${first};${second};${old || ''}`;
    const found = which('cc-fake');
    assert.equal(fs.realpathSync.native(found).toLowerCase(), fs.realpathSync.native(two).toLowerCase());
    assert.equal(findBin('cc-fake').toLowerCase(), found.toLowerCase());
    assert.ok(binCall('cc-fake', ['hello']).args.join(' ').toLowerCase().includes('cc-fake.cmd'));
    fs.unlinkSync(two);
    assert.equal(which('cc-fake'), null);
  } finally { if (old === undefined) delete process.env.Path; else process.env.Path = old; }
  const pf = path.join(root, 'pf');
  const older = path.join(pf, 'WindowsApps', 'OpenAI.Codex_26.900.1.0_x64__abc', 'app', 'resources');
  const newer = path.join(pf, 'WindowsApps', 'OpenAI.Codex_26.1120.5083.0_x64__abc', 'app', 'resources');
  fs.mkdirSync(older, { recursive: true });
  fs.mkdirSync(newer, { recursive: true });
  fs.writeFileSync(path.join(older, 'codex.exe'), '');
  fs.writeFileSync(path.join(newer, 'codex.exe'), '');
  assert.equal(windowsCodexApp(pf), path.join(newer, 'codex.exe'));
  assert.equal(windowsCodexApp(path.join(root, 'missing'), ''), null);
} finally { fs.rmSync(root, { recursive: true, force: true }); }

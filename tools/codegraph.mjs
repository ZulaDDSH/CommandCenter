import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from '../lib/config.mjs';
import { createApi } from './cc-lib.mjs';

export function explore(query) {
  const project = config().projectDir;
  if (typeof query !== 'string' || !query.trim() || query.length > 1000) throw new Error('Enter a query of at most 1,000 characters.');
  if (!project || !fs.existsSync(path.join(project, '.codegraph', 'codegraph.db'))) throw new Error('The configured project has no CodeGraph index. Initialize it in the main project checkout first.');
  const root = path.join(os.homedir(), '.local', 'codegraph', 'node_modules', '@colbymchenry', `codegraph-${process.platform}-${process.arch}`);
  const bundled = path.join(root, process.platform === 'win32' ? 'node.exe' : 'node');
  const script = path.join(root, 'lib', 'dist', 'bin', 'codegraph.js');
  const file = fs.existsSync(bundled) && fs.existsSync(script) ? bundled : 'codegraph';
  const args = file === bundled ? [script] : [];
  const previous = { DO_NOT_TRACK: process.env.DO_NOT_TRACK, CODEGRAPH_TELEMETRY: process.env.CODEGRAPH_TELEMETRY, CODEGRAPH_NO_DAEMON: process.env.CODEGRAPH_NO_DAEMON };
  Object.assign(process.env, { DO_NOT_TRACK: '1', CODEGRAPH_TELEMETRY: '0', CODEGRAPH_NO_DAEMON: '1' });
  try {
    const run = (command, prefix) => createApi().run(command, [...prefix, 'explore', '--path', project, '--max-files', '4', `Locate: ${query.trim()}`], { cwd: project, timeout: 30000 });
    let result;
    try { result = run(file, args); } catch (error) { if (file !== bundled) throw error; result = run('codegraph', []); }
    if (result.code !== 0) throw new Error(result.stderr.trim() || 'CodeGraph could not query this project.');
    return result.stdout.slice(0, 20000);
  } finally {
    for (const [k, v] of Object.entries(previous)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
}

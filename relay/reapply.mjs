import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runtimeDir } from '../lib/setup.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const RUNTIME = process.env.AGENT_INTEROP_RUNTIME || runtimeDir();
const sha = f => createHash('sha256').update(readFileSync(f)).digest('hex');
const version = JSON.parse(readFileSync(path.join(RUNTIME, 'package.json'), 'utf8')).version;

let failed = false, changed = false;
for (const name of ['pty.js', 'adapters.js']) {
  const target = path.join(RUNTIME, 'dist/src', name);
  if (sha(target) === sha(path.join(here, `${name}.patched`))) { console.log(`${name}: already patched`); continue; }
  const orig = sha(path.join(here, `${name}.orig`));
  const olderPatch = existsSync(target + '.orig') && sha(target + '.orig') === orig;
  if (version !== '1.1.0' || (sha(target) !== orig && !olderPatch)) {
    console.error(`${name}: runtime ${version} copy is not the known 1.1.0 original; port the patch by hand`);
    failed = true;
    continue;
  }
  if (!olderPatch) copyFileSync(target, target + '.orig');
  copyFileSync(path.join(here, `${name}.patched`), target);
  console.log(`${name}: patched`);
  changed = true;
}
if (changed) console.log('restart the agent-interop-runtime MCP server to load it');
process.exit(failed ? 1 : 0);

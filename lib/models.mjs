import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from './config.mjs';
import { runBin, runCall, cursorCall } from '../usage/exec.mjs';

export const MODEL_RE = /^[\w.:/@[][\w.:/@[\],=+-]{0,99}$/;
const TTL = 600000;
const clean = s => String(s ?? '').replace(/\x1b\[[0-9;]*m/g, '').replace(/[​-‏﻿]/g, '');
const fallback = (id, name, extra = '') => [{ id, name: name ?? id, note: `not read live${extra}` }];

function codexRows(j) {
  return (j.models ?? []).filter(m => m.visibility === 'list').map(m => ({
    id: m.slug, name: m.display_name ?? m.slug,
    note: `${String(m.description ?? '').split('.')[0]}. Effort: ${(m.supported_reasoning_levels ?? []).map(l => l.effort).join(', ')}`.trim(),
  }));
}

async function codex() {
  try { const r = codexRows(JSON.parse(fs.readFileSync(path.join(os.homedir(), '.codex/models_cache.json'), 'utf8'))); if (r.length) return r; } catch {}
  const { out } = await runBin('codex', ['debug', 'models'], 30000);
  try { const r = codexRows(JSON.parse(out)); if (r.length) return r; } catch {}
  return fallback(config().models.codex);
}

async function cursor() {
  const { out } = await runCall(() => cursorCall(['--list-models']), 30000);
  const rows = clean(out).split(/\r?\n/).map(l => /^(\S+) - (.+)$/.exec(l.trim())).filter(Boolean).map(m => {
    const tag = /\((current|default)[^)]*\)/i.exec(m[2]);
    return { id: m[1], name: m[2].replace(/\s*\([^)]*\)\s*$/, '').trim(), note: tag ? tag[0].slice(1, -1) : '' };
  });
  return rows.length ? rows : fallback(config().models.cursor, undefined, ' (sign in to Cursor to list models)');
}

async function opencode() {
  const { out } = await runBin('opencode', ['models'], 30000);
  const rows = clean(out).split(/\r?\n/).map(l => l.trim()).filter(l => /^[\w.-]+\/\S+$/.test(l)).map(id => ({ id, name: id.split('/').slice(1).join('/'), note: id.split('/')[0] + (/free$/.test(id) ? ', free' : '') }));
  return rows.length ? rows : fallback(config().models.opencode);
}

async function claude() {
  const { out } = await runBin('claude', ['--help'], 30000);
  const i = out.indexOf('--model <model>');
  const aliases = i < 0 ? [] : [...clean(out).slice(i, i + 500).matchAll(/'([a-z][a-z0-9-]*)'/g)].map(m => m[1]);
  const list = [...new Set([...aliases, 'sonnet', 'opus', 'haiku'])];
  return list.map(id => ({ id, name: id[0].toUpperCase() + id.slice(1), note: i < 0 ? 'alias (not read live)' : 'alias for the latest ' + id + '; a full model id also works' }));
}

const READERS = { codex, cursor, opencode, claude };
const cache = {};

function freebuff(rows) {
  if (!rows?.length) return fallback('', 'The saved Freebuff model');
  return rows.map(r => ({ id: r.key, name: r.name, note: r.hours == null ? (r.tagline ?? '') : r.hours === 0 ? 'free' : `${r.hours} h of the daily hours per hour of use` }));
}

export async function listModels({ fbRows, fresh } = {}) {
  const c = config(), out = {};
  await Promise.all(Object.keys({ freebuff: 1, ...READERS }).filter(p => c.providers[p]).map(async p => {
    if (p === 'freebuff') { out[p] = freebuff(fbRows); return; }
    const hit = cache[p];
    if (!fresh && hit && Date.now() - hit.at < TTL) { out[p] = hit.rows; return; }
    let rows;
    try { rows = await READERS[p](); } catch (e) { rows = fallback(c.models[p], undefined, `: ${e.message.slice(0, 80)}`); }
    cache[p] = { at: Date.now(), rows };
    out[p] = rows;
  }));
  return out;
}

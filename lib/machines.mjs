import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT, config } from './config.mjs';
import { isInstalled, findBin } from '../usage/exec.mjs';
import { repoOf } from './worktrees.mjs';

const FILE = path.join(ROOT, 'machines.json');
const PROVIDERS = ['freebuff', 'codex', 'cursor', 'opencode', 'claude'];
const TTL = 120000;
const online = new Map();
const now = () => new Date().toISOString();
export const localName = () => String(process.env.CC_MACHINE_NAME ?? '').trim().slice(0, 60) || os.hostname();

let store = null;
function load() {
  if (store) return store;
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}
  store = { version: 1, selfId: String(raw.selfId ?? localId()), peers: Array.isArray(raw.peers) ? raw.peers : [] };
  return store;
}

function localId() {
  const h = crypto.createHash('sha256').update(`${os.hostname()}|${os.userInfo().username}|${ROOT}`).digest('hex').slice(0, 12);
  return `m-${h}`;
}

function save() {
  const s = load();
  fs.writeFileSync(`${FILE}.tmp`, JSON.stringify(s, null, 2));
  fs.renameSync(`${FILE}.tmp`, FILE);
}

export const selfId = () => load().selfId;

export function capabilities() {
  const c = config();
  const providers = {};
  for (const p of PROVIDERS) providers[p] = { enabled: !!c.providers[p], installed: p === 'freebuff' ? true : isInstalled(p) };
  return {
    os: `${process.platform}-${process.arch}`,
    node: process.version,
    hostname: os.hostname(),
    cores: os.cpus()?.length ?? null,
    providers,
    concurrency: { freebuff: c.maxClis ?? 3, ...(c.maxParallel ?? {}) },
    worktrees: !!repoOf(c.projectDir || ROOT),
    canMerge: false,
    claim: {
      supported: false,
      why: 'No other machine can claim or run a task yet. A signed hello proves identity and nothing more: there is no work handoff, no remote worktree and no provider supervision on a peer, so a claim is refused instead of pretended.',
    },
    note: 'Merge is never automated on any machine; it needs your approval for that pull request.',
  };
}

export function localMachine() {
  const c = capabilities();
  return {
    id: load().selfId, name: localName(), kind: 'local', role: 'this machine',
    url: `http://127.0.0.1:${process.env.PORT ?? 4021}`, status: 'online', at: now(),
    lastSeen: now(), capabilities: c,
    note: 'The panel on this PC. It is the only machine that can start or stop tasks right now.',
  };
}

export function peers() {
  const l = load();
  return l.peers.map(p => {
    const live = online.get(p.id);
    const fresh = live && Date.now() - live.at < TTL;
    return {
      id: p.id, name: p.name, url: p.url, secretEnv: p.secretEnv, enabled: p.enabled !== false,
      reportedId: p.reportedId ?? null,
      authenticated: !!fresh,
      available: fresh ? !!live?.available : false,
      status: p.enabled === false ? 'disabled' : !process.env[p.secretEnv] ? 'unconfigured' : fresh ? 'online' : 'offline',
      lastHandshake: live?.at ? new Date(live.at).toISOString() : p.lastHandshake ?? null,
      capabilities: fresh ? live.capabilities : p.capabilities ?? null,
      note: !process.env[p.secretEnv]
        ? `Set ${p.secretEnv} on this PC to its shared secret. Until then the connection is not attempted and nothing is claimed.`
        : fresh ? 'Answered a signed hello.' : 'No signed hello within the last 2 minutes.',
    };
  });
}

export function inventory() {
  return {
    at: now(),
    self: localMachine(),
    peers: peers(),
    bindNote: 'Local services listen on 127.0.0.1 only. A peer on another machine must reach this panel through a tunnel or an explicit reverse proxy you control.',
  };
}

function peerEnvName(name) {
  const base = String(name).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'PEER';
  return `CC_PEER_${base}`;
}

export function addPeer(input = {}) {
  const l = load();
  const name = String(input.name ?? '').trim().slice(0, 60);
  if (!name) throw new Error('Give the machine a name.');
  let url = String(input.url ?? '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s]+$/.test(url)) throw new Error('The address must be a plain http:// or https:// URL.');
  if (l.peers.some(p => p.name.toLowerCase() === name.toLowerCase())) throw new Error(`A machine named ${name} is already listed.`);
  const id = `m-${crypto.createHash('sha256').update(name).digest('hex').slice(0, 10)}`;
  const p = { id, name, url, secretEnv: peerEnvName(name), enabled: true, addedAt: now(), capabilities: null, lastHandshake: null };
  l.peers.push(p);
  save();
  return p;
}

export function removePeer(id) {
  const l = load();
  const i = l.peers.findIndex(p => p.id === id);
  if (i < 0) return null;
  const [p] = l.peers.splice(i, 1);
  online.delete(id);
  save();
  return p;
}

export function setPeerEnabled(id, on) {
  const p = load().peers.find(x => x.id === id);
  if (!p) return null;
  p.enabled = !!on;
  save();
  return p;
}

const hmac = (secret, msg) => crypto.createHmac('sha256', secret).update(msg).digest('hex');

export async function handshake(id) {
  const l = load();
  const p = l.peers.find(x => x.id === id);
  if (!p) throw new Error('That machine is not in the list.');
  if (p.enabled === false) return { ok: false, status: 'disabled', why: 'This machine is turned off in the list.' };
  const secret = process.env[p.secretEnv];
  if (!secret) return { ok: false, status: 'unconfigured', why: `Set ${p.secretEnv} to the shared secret before connecting. Nothing was sent.` };
  const ts = Date.now();
  const sig = hmac(secret, `${l.selfId}.${ts}`);
  let res;
  try {
    res = await fetch(`${p.url}/machine/hello`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-cc-peer': l.selfId, 'x-cc-name': localName(), 'x-cc-ts': String(ts), 'x-cc-sig': sig },
      body: JSON.stringify({ peer: l.selfId, name: localName(), wants: 'hello', capabilities: capabilities(), available: true }),
      signal: AbortSignal.timeout(6000),
    });
  } catch (e) {
    online.delete(p.id);
    return { ok: false, status: 'offline', why: `Could not reach ${p.url}: ${String(e?.message ?? e).slice(0, 160)}` };
  }
  if (!res.ok) {
    online.delete(p.id);
    return { ok: false, status: 'error', why: `${p.url} answered HTTP ${res.status}.` };
  }
  let body = {};
  try { body = await res.json(); } catch {}
  const caps = body?.capabilities ?? {};
  online.set(p.id, { at: Date.now(), capabilities: caps });
  p.lastHandshake = now();
  p.capabilities = caps;
  save();
  return { ok: true, status: 'online', capabilities: caps, machine: { id: body?.id ?? null, name: body?.name ?? p.name } };
}

export function verifyHello(headers = {}, body = {}) {
  const l = load();
  const peerId = String(headers['x-cc-peer'] ?? '');
  const ts = Number(headers['x-cc-ts'] ?? 0);
  const sig = String(headers['x-cc-sig'] ?? '');
  if (!peerId || !ts || !sig) return { ok: false, code: 400, why: 'The hello has no peer id, timestamp or signature.' };
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > 60000) return { ok: false, code: 400, why: 'The hello timestamp is outside 60 seconds (clock skew or a replay).' };
  if (peerId === l.selfId) return { ok: false, code: 400, why: 'A machine cannot call itself.' };
  const name = String(headers['x-cc-name'] ?? '').trim().toLowerCase();
  const peer = l.peers.find(p => p.id === peerId) ?? (name ? l.peers.find(p => p.name.toLowerCase() === name) : null);
  if (!peer) return { ok: false, code: 404, why: 'That machine is not in this inventory. Add it first.' };
  if (peer.enabled === false) return { ok: false, code: 403, why: 'That machine is turned off in this inventory.' };
  const secret = process.env[peer.secretEnv];
  if (!secret) return { ok: false, code: 503, why: `This PC has no ${peer.secretEnv} set, so it cannot verify the caller.` };
  const want = hmac(secret, `${peerId}.${ts}`);
  const a = Buffer.from(want, 'hex'), b = Buffer.from(sig, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, code: 403, why: 'The signature does not match.' };
  const seen = online.get(peer.id);
  const caps = body?.capabilities && typeof body.capabilities === 'object' ? body.capabilities : seen?.capabilities ?? peer.capabilities ?? null;
  const available = typeof body?.available === 'boolean' ? body.available : seen?.available ?? true;
  online.set(peer.id, { at: Date.now(), capabilities: caps, available });
  peer.lastHandshake = now();
  peer.reportedId = peerId;
  peer.capabilities = caps;
  save();
  return { ok: true, peer };
}

export async function callPeer(url, pathname, { secret, selfId, body = {} } = {}) {
  const ts = Date.now();
  const sig = hmac(String(secret ?? ''), `${selfId}.${ts}`);
  const res = await fetch(`${String(url).replace(/\/+$/, '')}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-cc-peer': selfId, 'x-cc-name': localName(), 'x-cc-ts': String(ts), 'x-cc-sig': sig },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(6000),
  }).catch(e => ({ ok: false, status: 0, json: async () => ({ code: 'unreachable', why: String(e?.message ?? e).slice(0, 160) }) }));
  let parsed = null;
  try { parsed = await res.json(); } catch {}
  return { ok: res.ok, status: res.status, body: parsed };
}

export function redact(text) {
  let s = String(text ?? '');
  const home = os.homedir();
  if (home && home.length > 3) {
    const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    s = s.replace(new RegExp(esc(home).replace(/[\\/]/g, '[\\\\/]'), 'gi'), '~');
  }
  return s
    .replace(/\b(bearer|token|secret|password|api[_-]?key)\s*[:=]?\s*[A-Za-z0-9._~+/-]{8,}/gi, '$1 <redacted>')
    .replace(/\b(sk|pk|ghp|gho|github_pat)_[A-Za-z0-9_]{10,}/g, '<redacted>')
    .replace(/([?&](?:token|key|secret|sig)=)[^&\s]+/gi, '$1<redacted>');
}

export const binFor = p => (p === 'cursor' ? findBin('cursor-agent') : findBin(p));

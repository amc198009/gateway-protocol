'use strict';
// Durable store for the Transmission Feed and Practice Rooms.
//
// Backed by Redis when REDIS_URL is set; otherwise a no-op so the server runs
// exactly as before (in-memory, ephemeral). Every method is safe to call
// whether or not Redis is configured or reachable — Redis errors are logged
// and swallowed, never propagated into a request/WS path. The goal is
// durability across deploys/restarts, not correctness coupling: if Redis is
// down, the live server keeps working and simply stops persisting.
//
// Keys:
//   gp:feed            JSON array of feed items (rewritten, debounced)
//   gp:room:<code>     JSON room snapshot { code, wave, hostId, state,
//                      createdAt, lastActivityAt } — no live sockets; TTL'd.

const FEED_KEY = 'gp:feed';
const ROOM_PREFIX = 'gp:room:';
const ROOM_TTL_S = parseInt(process.env.ROOM_TTL_S || String(6 * 3600), 10); // 6h
const FEED_DEBOUNCE_MS = 800;
const ROOM_FLUSH_MS = 3000;

let client = null;
let durable = false;
let feedRef = null;            // latest feed array reference, for debounced save
let feedTimer = null;
const dirtyRooms = new Map();  // code -> live room object, flushed on interval
let flushTimer = null;

function log(...a) { console.log('[Store]', ...a); }
function warn(...a) { console.warn('[Store]', ...a); }

function roomSnapshot(room) {
  return JSON.stringify({
    code: room.code,
    wave: room.wave,
    hostId: room.hostId,
    state: room.state,
    createdAt: room.createdAt,
    lastActivityAt: room.lastActivityAt,
  });
}

async function init() {
  const url = process.env.REDIS_URL;
  if (!url) { log('REDIS_URL not set — running in-memory (ephemeral).'); return { durable: false }; }
  let createClient;
  try { ({ createClient } = require('redis')); }
  catch { warn("'redis' package not installed — running in-memory."); return { durable: false }; }

  try {
    client = createClient({
      url,
      socket: { reconnectStrategy: retries => Math.min(retries * 200, 5000) },
    });
    // A missing 'error' listener makes node-redis throw on transient blips.
    client.on('error', err => warn('redis error:', err && err.message));
    await client.connect();
    durable = true;
    module.exports.durable = true;
    flushTimer = setInterval(flushDirtyRooms, ROOM_FLUSH_MS);
    if (flushTimer.unref) flushTimer.unref();
    log('connected — feed + rooms are durable.');
    return { durable: true };
  } catch (err) {
    warn('connect failed — falling back to in-memory:', err && err.message);
    durable = false;
    client = null;
    return { durable: false };
  }
}

// ── Feed ────────────────────────────────────────────────────────────────
async function loadFeed() {
  if (!durable) return null;
  try {
    const raw = await client.get(FEED_KEY);
    if (!raw) return null;
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : null;
  } catch (err) { warn('loadFeed failed:', err && err.message); return null; }
}

// Debounced full-array rewrite. The feed is small (capped) and writes are
// rate-limited upstream, so coalescing to one write per burst is plenty.
function scheduleFeedSave(feed) {
  if (!durable) return;
  feedRef = feed;
  if (feedTimer) return;
  feedTimer = setTimeout(async () => {
    feedTimer = null;
    try { await client.set(FEED_KEY, JSON.stringify(feedRef)); }
    catch (err) { warn('saveFeed failed:', err && err.message); }
  }, FEED_DEBOUNCE_MS);
  if (feedTimer.unref) feedTimer.unref();
}

// ── Rooms ───────────────────────────────────────────────────────────────
async function loadRooms() {
  if (!durable) return [];
  try {
    const keys = [];
    for await (const key of client.scanIterator({ MATCH: ROOM_PREFIX + '*', COUNT: 200 })) {
      Array.isArray(key) ? keys.push(...key) : keys.push(key);
    }
    if (!keys.length) return [];
    const vals = await client.mGet(keys);
    const out = [];
    for (const v of vals) {
      if (!v) continue;
      try { out.push(JSON.parse(v)); } catch {}
    }
    return out;
  } catch (err) { warn('loadRooms failed:', err && err.message); return []; }
}

// Mark a room dirty; the flush interval serializes its latest state. Throttling
// here keeps frequent host "tick" updates from hammering Redis.
function scheduleRoomSave(room) {
  if (!durable || !room) return;
  dirtyRooms.set(room.code, room);
}

async function flushDirtyRooms() {
  if (!durable || !dirtyRooms.size) return;
  const batch = [...dirtyRooms.values()];
  dirtyRooms.clear();
  for (const room of batch) {
    try { await client.set(ROOM_PREFIX + room.code, roomSnapshot(room), { EX: ROOM_TTL_S }); }
    catch (err) { warn('saveRoom failed:', err && err.message); }
  }
}

async function saveRoomNow(room) {
  if (!durable || !room) return;
  try { await client.set(ROOM_PREFIX + room.code, roomSnapshot(room), { EX: ROOM_TTL_S }); }
  catch (err) { warn('saveRoomNow failed:', err && err.message); }
}

function removeRoom(code) {
  dirtyRooms.delete(code);
  if (!durable) return;
  client.del(ROOM_PREFIX + code).catch(err => warn('removeRoom failed:', err && err.message));
}

async function close() {
  if (flushTimer) clearInterval(flushTimer);
  if (feedTimer) clearTimeout(feedTimer);
  if (durable && feedRef) { try { await client.set(FEED_KEY, JSON.stringify(feedRef)); } catch {} }
  if (durable) { try { await flushDirtyRooms(); await client.quit(); } catch {} }
}

module.exports = {
  durable,
  init,
  loadFeed, scheduleFeedSave,
  loadRooms, scheduleRoomSave, saveRoomNow, removeRoom,
  close,
};

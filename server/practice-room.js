/**
 * Gateway Protocol — Practice Rooms + Transmission Feed reference server
 * ──────────────────────────────────────────────────────────────────────
 * Two services on one port:
 *
 *   WS  ws://HOST:PORT/room/:code   Live-synchronized practice rooms.
 *                                   First joiner is the host (owns the timer).
 *                                   All others mirror the host's state.
 *                                   Server broadcasts presence count + phase.
 *
 *   REST GET/POST /feed              Anonymized Council transmission feed.
 *                                   In-memory ring buffer (LAST_N most recent).
 *                                   No accounts, no user IDs — purely anonymous.
 *
 * Storage: in-memory only. Rooms vanish when last participant leaves; the
 * feed is a ring buffer that wraps at LAST_N. For production, swap the
 * `rooms` Map and `feed` array for Redis/Postgres — see TODO comments
 * inline.
 *
 * Run locally:  npm install && npm start         (listens on :7070)
 * Deploy:       See server/README.md for fly.io / render.com / Railway recipes.
 * ──────────────────────────────────────────────────────────────────────
 */

const http = require('http');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');

const PORT = process.env.PORT || 7070;
const HOST = process.env.HOST || '0.0.0.0';
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';
const FEED_MAX = parseInt(process.env.FEED_MAX || '500', 10);
const ROOM_IDLE_MS = 30 * 60 * 1000; // 30min after last participant — gc

// Mutating routes require this header. Because it's a non-CORS-safelisted
// header, browsers issue a CORS preflight, and the preflight only succeeds
// for our explicit Allow-Headers list. A drive-by CSRF form on a random
// page can't add custom headers, so it can't drive POST /feed or /react.
const CLIENT_HEADER = 'x-gateway-client';

// Simple in-memory token bucket per client IP. Caps abuse before it can
// fill the ring buffer or game the reactions counter. Production should
// use a real rate-limit middleware backed by Redis.
const RL_WINDOW_MS = 60 * 1000;
const RL_LIMITS = { feed_post: 10, feed_react: 30 };
const rlBuckets = new Map(); // key: `${kind}:${ip}` → { count, resetAt }
function rateLimited(kind, ip) {
  const key = kind + ':' + (ip || 'unknown');
  const now = Date.now();
  const bucket = rlBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rlBuckets.set(key, { count: 1, resetAt: now + RL_WINDOW_MS });
    return false;
  }
  bucket.count++;
  return bucket.count > (RL_LIMITS[kind] || 30);
}
function clientIp(req) {
  // Trust X-Forwarded-For only one hop deep (typical proxy layer); fall
  // back to socket.remoteAddress when not behind a proxy.
  const xff = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xff || (req.socket && req.socket.remoteAddress) || 'unknown';
}
function clamp(n, lo, hi, fallback) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(Math.max(v, lo), hi);
}
function clampStr(s, max) {
  return String(s == null ? '' : s).slice(0, max);
}

// ── State (in-memory; swap for Redis in production) ───────────────────
/** @type {Map<string, Room>} */
const rooms = new Map();
const feed = []; // ring buffer, oldest at index 0

/**
 * @typedef {Object} Room
 * @property {string} code
 * @property {number} wave              the Gateway Wave being practiced (1-7)
 * @property {Set<any>} clients          connected WebSocket sockets
 * @property {string|null} hostId        socket id of the host (controls timer)
 * @property {Object} state              broadcasted state: {running, phase, timerSeconds, timerMax, name}
 * @property {number} createdAt
 * @property {number} lastActivityAt
 */

// ── REST handlers (feed) ──────────────────────────────────────────────
function jsonResponse(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': ALLOW_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Gateway-Client',
  });
  res.end(JSON.stringify(body));
}

function handleFeedGet(req, res, url) {
  const params = url.searchParams;
  const wave = params.get('wave');       // string or null
  const freq = params.get('freq');       // string or null
  const code = params.get('code');       // string or null
  const limit = Math.min(parseInt(params.get('limit') || '50', 10), 200);

  // Newest first; clients page by skipping if needed.
  let items = feed.slice().reverse();
  if (wave) items = items.filter(t => String(t.wave) === wave);
  if (freq) items = items.filter(t => String(t.frequency) === freq);
  if (code) items = items.filter(t => String(t.code) === code);
  items = items.slice(0, limit);

  jsonResponse(res, 200, { items, total: feed.length });
}

function handleFeedPost(req, res) {
  // Cap request body to prevent unbounded buffering from a hostile client.
  const MAX_BODY = 8192;
  let body = '';
  let aborted = false;
  req.on('data', c => {
    if (aborted) return;
    body += c;
    if (body.length > MAX_BODY) {
      aborted = true;
      jsonResponse(res, 413, { error: 'body too large' });
      req.destroy();
    }
  });
  req.on('end', () => {
    if (aborted) return;
    let parsed;
    try { parsed = JSON.parse(body); }
    catch { return jsonResponse(res, 400, { error: 'Invalid JSON' }); }

    // Whitelist + cap field lengths. Never echo back any caller-supplied
    // identifier — this feed is anonymous by design.
    const item = {
      id: crypto.randomBytes(6).toString('hex'),
      at: Date.now(),
      wave: clampStr(parsed.wave, 12),
      frequency: clampStr(parsed.frequency, 12),
      code: clampStr(parsed.code, 24),
      transmission: clampStr(parsed.transmission, 2000),
      reactions: 0,
    };
    if (!item.transmission) return jsonResponse(res, 400, { error: 'transmission required' });

    feed.push(item);
    if (feed.length > FEED_MAX) feed.shift();
    jsonResponse(res, 201, { ok: true, id: item.id });
    console.log(`[Feed] +${item.id} wave=${item.wave} code=${item.code}`);
  });
}

function handleFeedReact(req, res, id) {
  const item = feed.find(t => t.id === id);
  if (!item) return jsonResponse(res, 404, { error: 'not found' });
  item.reactions++;
  jsonResponse(res, 200, { ok: true, reactions: item.reactions });
}

// Reject mutating requests that don't carry our custom client header.
// Browsers only allow non-safelisted headers after a successful CORS
// preflight, and a drive-by form on attacker.com can't set them — so
// requiring the header turns POST routes into CSRF-resistant ones.
function requireClient(req, res) {
  if (!req.headers[CLIENT_HEADER]) {
    jsonResponse(res, 403, { error: 'missing client header' });
    return false;
  }
  return true;
}

// ── HTTP server (also hosts the WS upgrade) ───────────────────────────
const server = http.createServer((req, res) => {
  // CORS preflight — must echo the same Allow-Headers as actual responses
  // or the X-Gateway-Client header won't survive the preflight.
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': ALLOW_ORIGIN,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Gateway-Client',
    });
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const path = url.pathname;

  // GET / — health/status
  if (req.method === 'GET' && path === '/') {
    return jsonResponse(res, 200, {
      ok: true, service: 'gateway-protocol-server', rooms: rooms.size, feedSize: feed.length, uptime: Math.round(process.uptime()),
    });
  }
  // GET /feed
  if (req.method === 'GET' && path === '/feed') return handleFeedGet(req, res, url);
  // POST /feed (CSRF-gated + per-IP rate limited)
  if (req.method === 'POST' && path === '/feed') {
    if (!requireClient(req, res)) return;
    if (rateLimited('feed_post', clientIp(req))) return jsonResponse(res, 429, { error: 'slow down' });
    return handleFeedPost(req, res);
  }
  // POST /feed/:id/react (CSRF-gated + per-IP rate limited)
  const reactMatch = path.match(/^\/feed\/([a-f0-9]{12})\/react$/);
  if (req.method === 'POST' && reactMatch) {
    if (!requireClient(req, res)) return;
    if (rateLimited('feed_react', clientIp(req))) return jsonResponse(res, 429, { error: 'slow down' });
    return handleFeedReact(req, res, reactMatch[1]);
  }

  jsonResponse(res, 404, { error: 'not found' });
});

// ── WebSocket server (Practice Rooms) ─────────────────────────────────
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const match = url.pathname.match(/^\/room\/([A-Z0-9]{4,12})$/i);
  if (!match) { socket.destroy(); return; }
  const code = match[1].toUpperCase();
  wss.handleUpgrade(req, socket, head, ws => {
    ws._id = crypto.randomBytes(4).toString('hex');
    ws._code = code;
    joinRoom(ws, code);
  });
});

function joinRoom(ws, code) {
  let room = rooms.get(code);
  if (!room) {
    room = { code, wave: 0, clients: new Set(), hostId: ws._id, state: defaultState(), createdAt: Date.now(), lastActivityAt: Date.now() };
    rooms.set(code, room);
    console.log(`[Room ${code}] created (host=${ws._id})`);
  }
  room.clients.add(ws);
  room.lastActivityAt = Date.now();
  broadcast(room, { type: 'presence', count: room.clients.size, hostId: room.hostId, you: ws._id });
  // Replay current state to the new joiner so they catch up mid-session
  send(ws, { type: 'state', ...room.state, wave: room.wave });

  ws.on('message', raw => handleRoomMessage(ws, room, raw));
  ws.on('close', () => leaveRoom(ws, room));
  ws.on('error', () => leaveRoom(ws, room));
}

function leaveRoom(ws, room) {
  if (!room.clients.delete(ws)) return;
  console.log(`[Room ${room.code}] leave ${ws._id} (remaining=${room.clients.size})`);
  if (!room.clients.size) {
    // Don't delete immediately — give the host a grace period to reconnect.
    setTimeout(() => {
      const r = rooms.get(room.code);
      if (r && !r.clients.size && Date.now() - r.lastActivityAt >= ROOM_IDLE_MS) {
        rooms.delete(r.code);
        console.log(`[Room ${r.code}] gc (idle)`);
      }
    }, ROOM_IDLE_MS);
    return;
  }
  // Promote a new host if the host left
  if (ws._id === room.hostId) {
    const next = room.clients.values().next().value;
    room.hostId = next?._id || null;
    console.log(`[Room ${room.code}] host → ${room.hostId}`);
  }
  broadcast(room, { type: 'presence', count: room.clients.size, hostId: room.hostId });
}

function handleRoomMessage(ws, room, raw) {
  let msg;
  try { msg = JSON.parse(raw.toString()); } catch { return; }
  room.lastActivityAt = Date.now();

  // Wave selection — host-only
  if (msg.type === 'set-wave' && ws._id === room.hostId) {
    room.wave = clamp(parseInt(msg.wave, 10), 0, 7, 0);
    broadcast(room, { type: 'state', ...room.state, wave: room.wave });
    return;
  }
  // Timer control — host-only. Hosts call: start, pause, reset, tick.
  // Every field that becomes part of broadcast state is clamped / length-
  // capped so a malicious host can't poison participants with NaN, huge
  // numbers, or script-shaped session/phase strings.
  if (msg.type === 'timer' && ws._id === room.hostId) {
    const s = room.state;
    const MAX_SEC = 24 * 60 * 60;
    if (msg.action === 'start') {
      s.running = true;
      s.startedAt = Date.now();
      s.timerSeconds = clamp(msg.timerSeconds, 0, MAX_SEC, s.timerSeconds);
      s.timerMax = clamp(msg.timerMax, 0, MAX_SEC, s.timerMax);
      s.sessionName = clampStr(msg.sessionName || s.sessionName, 100);
    }
    if (msg.action === 'pause') { s.running = false; }
    if (msg.action === 'reset') { Object.assign(s, defaultState()); }
    if (msg.action === 'tick') {
      s.timerSeconds = clamp(msg.timerSeconds, 0, MAX_SEC, s.timerSeconds);
      s.phase = clampStr(msg.phase || s.phase, 100);
    }
    broadcast(room, { type: 'state', ...room.state, wave: room.wave });
    return;
  }
  // Cue (host broadcasts a guidance cue to all clients). Renderer escapes
  // before display, but cap length defensively.
  if (msg.type === 'cue' && ws._id === room.hostId) {
    broadcast(room, { type: 'cue', text: clampStr(msg.text, 500) });
    return;
  }
}

function defaultState() {
  return { running: false, timerSeconds: 0, timerMax: 0, phase: '', sessionName: '', startedAt: 0 };
}

function broadcast(room, msg) {
  const payload = JSON.stringify(msg);
  for (const c of room.clients) {
    try { c.send(payload); } catch {}
  }
}
function send(ws, msg) {
  try { ws.send(JSON.stringify(msg)); } catch {}
}

// ── Startup ──────────────────────────────────────────────────────────
server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  ◈  Gateway Protocol Server');
  console.log('  ───────────────────────────────────────────');
  console.log(`  Listening:  http://${HOST}:${PORT}`);
  console.log(`  Origin:     ${ALLOW_ORIGIN}`);
  console.log('  Endpoints:');
  console.log(`    GET  /                    health`);
  console.log(`    GET  /feed?wave=&code=    list transmissions`);
  console.log(`    POST /feed                publish transmission`);
  console.log(`    POST /feed/:id/react      add a reaction`);
  console.log(`    WS   /room/:code          join a practice room`);
  console.log('');
});

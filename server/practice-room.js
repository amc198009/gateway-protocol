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

// Commit pin: baked in at build time via the COMMIT_SHA Docker build-arg
// (see Dockerfile + the fly deploy command in server/README.md). Falls back
// to 'main' when running locally without the build pipeline.
const COMMIT = process.env.FLY_COMMIT_SHA || process.env.COMMIT_SHA || 'main';
const COMMIT_SHORT = COMMIT === 'main' ? 'main' : COMMIT.slice(0, 7);

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
// Styled landing page rendered when a browser hits `GET /`. Matches the
// desktop app's dark + gold aesthetic. Auto-refreshes the live stats
// every 15s via a tiny inline script that re-fetches `/` with JSON Accept.
function renderLanding(stats) {
  const fmtUptime = s => {
    const d = Math.floor(s/86400), h = Math.floor((s%86400)/3600);
    const m = Math.floor((s%3600)/60);
    if (d) return `${d}d ${h}h`;
    if (h) return `${h}h ${m}m`;
    return `${m}m ${s%60}s`;
  };
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Gateway Protocol · Network</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="The reference network server for Gateway Protocol — Community Practice Rooms and the Transmission Feed.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300&family=Montserrat:wght@300;400&display=swap" rel="stylesheet">
<style>
  :root{--bg:#0a0a0d;--card:#13131a;--border:rgba(201,168,76,.15);--gold:#c9a84c;--gold2:#f0d88a;--text:#e8e2d4;--muted:#7a7264;--silver:#c5bdab}
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:var(--bg);color:var(--text);font-family:Montserrat,system-ui,sans-serif;font-weight:300;line-height:1.6;min-height:100vh;overflow-x:hidden}
  body::before{content:'';position:fixed;inset:0;background:radial-gradient(ellipse at top,rgba(201,168,76,.06),transparent 60%),radial-gradient(ellipse at bottom,rgba(201,168,76,.03),transparent 70%);pointer-events:none;z-index:0}
  .wrap{max-width:780px;margin:0 auto;padding:80px 24px;position:relative;z-index:1}
  .hero{text-align:center;margin-bottom:60px}
  .badge{display:inline-flex;align-items:center;gap:8px;font-size:9px;letter-spacing:3px;text-transform:uppercase;color:var(--gold);border:.5px solid var(--border);padding:6px 14px;border-radius:20px;margin-bottom:24px}
  .dot{width:6px;height:6px;border-radius:50%;background:var(--gold);box-shadow:0 0 8px var(--gold);animation:pulse 2s ease-in-out infinite}
  @keyframes pulse{0%,100%{opacity:.4}50%{opacity:1}}
  h1{font-family:'Cormorant Garamond',serif;font-weight:300;font-size:clamp(36px,7vw,64px);letter-spacing:6px;color:var(--gold2);margin-bottom:12px;line-height:1.1}
  .tagline{font-family:'Cormorant Garamond',serif;font-style:italic;font-size:18px;color:var(--silver);letter-spacing:1px;max-width:520px;margin:0 auto}
  .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:1px;background:var(--border);border:.5px solid var(--border);border-radius:6px;overflow:hidden;margin-bottom:48px}
  .stat{background:var(--card);padding:24px 16px;text-align:center}
  .stat-val{font-family:'Cormorant Garamond',serif;font-weight:300;font-size:36px;color:var(--gold2);letter-spacing:2px;line-height:1}
  .stat-lbl{font-size:9px;letter-spacing:2.5px;text-transform:uppercase;color:var(--muted);margin-top:6px}
  .card{background:var(--card);border:.5px solid var(--border);border-radius:6px;padding:32px 28px;margin-bottom:24px}
  .card h2{font-family:'Cormorant Garamond',serif;font-weight:400;font-size:13px;letter-spacing:3px;text-transform:uppercase;color:var(--gold);margin-bottom:18px}
  .card p{font-size:14px;color:var(--silver);line-height:1.8;margin-bottom:14px}
  .card p:last-child{margin-bottom:0}
  .card em{color:var(--gold2);font-style:italic}
  code{font-family:'SF Mono',Menlo,monospace;font-size:12px;background:rgba(0,0,0,.4);padding:2px 8px;border-radius:3px;color:var(--gold);border:.5px solid var(--border)}
  .endpoints{display:flex;flex-direction:column;gap:10px;font-family:'SF Mono',Menlo,monospace;font-size:12px}
  .endpoint{display:flex;gap:14px;align-items:baseline;color:var(--silver);padding:6px 0}
  .method{font-weight:400;color:var(--gold);min-width:48px}
  .ep-desc{color:var(--muted);font-size:11px;margin-left:auto;font-family:Montserrat,sans-serif;letter-spacing:.5px}
  .ctas{display:flex;gap:12px;flex-wrap:wrap;justify-content:center;margin-top:40px}
  .cta{display:inline-flex;align-items:center;gap:8px;font-size:10px;letter-spacing:3px;text-transform:uppercase;color:var(--gold);border:.5px solid var(--gold);padding:14px 22px;border-radius:2px;text-decoration:none;transition:all .25s}
  .cta:hover{background:rgba(201,168,76,.08);color:var(--gold2);border-color:var(--gold2)}
  .cta.primary{background:rgba(201,168,76,.06)}
  footer{margin-top:60px;padding-top:30px;border-top:.5px solid var(--border);text-align:center;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--muted)}
  footer a{color:var(--muted);text-decoration:none;border-bottom:.5px solid transparent;transition:.2s}
  footer a:hover{color:var(--gold);border-color:var(--gold)}
  @media (max-width:560px){.wrap{padding:48px 18px}.stats{grid-template-columns:repeat(3,1fr)}}
</style>
</head>
<body>
<div class="wrap">

  <div class="hero">
    <div class="badge"><span class="dot"></span>Network · Online</div>
    <h1>Gateway Protocol</h1>
    <div class="tagline">The reference network for Community Practice Rooms and the Transmission Feed. <em>Owned, not subscribed.</em></div>
  </div>

  <div class="stats" id="stats">
    <div class="stat"><div class="stat-val" data-stat="rooms">${stats.rooms}</div><div class="stat-lbl">Active Rooms</div></div>
    <div class="stat"><div class="stat-val" data-stat="feed">${stats.feedSize}</div><div class="stat-lbl">Feed Items</div></div>
    <div class="stat"><div class="stat-val" data-stat="uptime">${fmtUptime(stats.uptime)}</div><div class="stat-lbl">Server Uptime</div></div>
  </div>

  <div class="card">
    <h2>What this is</h2>
    <p>This URL isn't a website — it's the <em>backend</em> for the Gateway Protocol desktop app. Practitioners running the app can opt in to two community features that route through here:</p>
    <p><em>Community Practice Rooms.</em> Multiple practitioners doing the same Gateway Wave at the same time. The first joiner hosts; everyone else mirrors the host's timer and phase. Anonymous presence count only — no chat, no video, no identifiers.</p>
    <p><em>Transmission Feed.</em> Opt-in anonymous Council transmissions, filterable by wave / frequency / activation code. A living map of the work the community is doing this week.</p>
    <p>The desktop app itself is fully sovereign. It works <em>without</em> this server — pointing at it just adds the network layer.</p>
  </div>

  <div class="card">
    <h2>Endpoints</h2>
    <div class="endpoints">
      <div class="endpoint"><span class="method">GET</span><span><code>/</code></span><span class="ep-desc">this page</span></div>
      <div class="endpoint"><span class="method">GET</span><span><code>/feed?wave=&code=&limit=</code></span><span class="ep-desc">list transmissions</span></div>
      <div class="endpoint"><span class="method">POST</span><span><code>/feed</code></span><span class="ep-desc">publish a transmission</span></div>
      <div class="endpoint"><span class="method">POST</span><span><code>/feed/:id/react</code></span><span class="ep-desc">+1 reaction</span></div>
      <div class="endpoint"><span class="method">WSS</span><span><code>/room/:code</code></span><span class="ep-desc">join a practice room</span></div>
    </div>
  </div>

  <div class="ctas">
    <a class="cta primary" href="https://github.com/amc198009/gateway-protocol/releases/latest" target="_blank">Download the desktop app ↓</a>
    <a class="cta" href="https://github.com/amc198009/gateway-protocol" target="_blank">View source on GitHub ↗</a>
  </div>

  <footer>
    Gateway Protocol · Reference Server ·
    <a href="https://github.com/amc198009/gateway-protocol/tree/${COMMIT}" target="_blank">Source (${COMMIT_SHORT})</a> ·
    <a href="https://github.com/amc198009/gateway-protocol/blob/${COMMIT}/DRAFT_PRIVACY.md" target="_blank">Privacy (draft)</a>
  </footer>

</div>

<script>
// Auto-refresh stats every 15s. Uses Accept: application/json so the
// server returns the raw stats payload, not this whole HTML page.
async function refresh(){
  try{
    const r = await fetch('/', { headers:{'Accept':'application/json'}, cache:'no-store' });
    const s = await r.json();
    document.querySelector('[data-stat="rooms"]').textContent = s.rooms;
    document.querySelector('[data-stat="feed"]').textContent  = s.feedSize;
    const u = s.uptime|0;
    const d = (u/86400|0), h = ((u%86400)/3600|0), m = ((u%3600)/60|0), sec = u%60;
    document.querySelector('[data-stat="uptime"]').textContent =
      d ? d+'d '+h+'h' : (h ? h+'h '+m+'m' : m+'m '+sec+'s');
  }catch(e){}
}
setInterval(refresh, 15000);
</script>
</body>
</html>`;
}

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

  // GET / — content-negotiated health/landing
  // Browsers send Accept: text/html → serve a styled landing page.
  // The desktop app's fetch() sends Accept: */* → serve JSON unchanged.
  if (req.method === 'GET' && path === '/') {
    const accept = req.headers.accept || '';
    const wantsHTML = accept.includes('text/html') && !accept.startsWith('application/json');
    const stats = {
      ok: true, service: 'gateway-protocol-server',
      rooms: rooms.size, feedSize: feed.length, uptime: Math.round(process.uptime()),
    };
    if (wantsHTML) {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache',
      });
      return res.end(renderLanding(stats));
    }
    return jsonResponse(res, 200, stats);
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

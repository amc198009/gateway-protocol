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
const https = require('https');
const fs = require('fs');
const { join: joinPath } = require('path');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');

// Releases dir baked into the Docker image at build time. `npm run deploy`
// from server/ copies the freshly-built .dmg into ./download/ before
// `fly deploy` so the image carries it. Visitors can pull the build
// directly at /download — no GitHub repo round-trip needed.
const DOWNLOAD_DIR = joinPath(__dirname, 'download');

// Windows/Linux installers are large and platform-built, so — unlike the macOS
// .dmg that's baked into this image — they're published to GitHub Releases by
// .github/workflows/release.yml (which normalizes them to these stable names).
// These routes 302 to the latest release asset; macOS stays served locally.
const RELEASE_BASE = 'https://github.com/amc198009/gateway-protocol/releases/latest/download/';
const RELEASE_ASSETS = {
  'windows':   'Gateway-Protocol-Setup.exe',
  'linux':     'Gateway-Protocol-linux-amd64.deb',
  'linux-rpm': 'Gateway-Protocol-linux-x86_64.rpm',
};

// ── Hosted web app (sovereign BYOK PWA) + PWA assets ───────────────────
// The renderer is copied into ./app at deploy time (`npm run deploy` runs
// `sync:app`, mirroring how ./download carries the .dmg). PWA assets
// (manifest, service worker, icons) live in ./pwa and ship in the image.
// Every served path is a fixed allowlist — no user-controlled fs access, so
// this can't be turned into a path-traversal read.
const APP_DIR = joinPath(__dirname, 'app');
const PWA_DIR = joinPath(__dirname, 'pwa');
const STATIC_ROUTES = {
  '/app':                  { file: joinPath(APP_DIR, 'index.html'),             type: 'text/html; charset=utf-8',  cache: 'no-cache' },
  '/app.js':               { file: joinPath(APP_DIR, 'app.js'),                 type: 'application/javascript',     cache: 'no-cache' },
  '/vendor/three.min.js':  { file: joinPath(APP_DIR, 'vendor', 'three.min.js'), type: 'application/javascript',     cache: 'public, max-age=86400' },
  '/audio-worklet.js':     { file: joinPath(APP_DIR, 'audio-worklet.js'),       type: 'application/javascript',     cache: 'public, max-age=86400' },
  '/manifest.webmanifest': { file: joinPath(PWA_DIR, 'manifest.webmanifest'),   type: 'application/manifest+json',  cache: 'public, max-age=3600' },
  '/sw.js':                { file: joinPath(PWA_DIR, 'sw.js'),                   type: 'application/javascript',     cache: 'no-cache', swScope: true },
  '/icons/icon-192.png':   { file: joinPath(PWA_DIR, 'icons', 'icon-192.png'),  type: 'image/png',                  cache: 'public, max-age=604800' },
  '/icons/icon-512.png':   { file: joinPath(PWA_DIR, 'icons', 'icon-512.png'),  type: 'image/png',                  cache: 'public, max-age=604800' },
  '/icons/icon-180.png':   { file: joinPath(PWA_DIR, 'icons', 'icon-180.png'),  type: 'image/png',                  cache: 'public, max-age=604800' },
  '/qr-app.svg':           { file: joinPath(PWA_DIR, 'qr-app.svg'),             type: 'image/svg+xml',              cache: 'public, max-age=604800' },
};
function serveStatic(res, entry, path) {
  fs.readFile(entry.file, (err, data) => {
    if (err) {
      // A missing /app almost always means a local run without `npm run deploy`
      // (which copies the renderer into ./app). Be explicit about the fix.
      const msg = path === '/app'
        ? 'web app build not present — run `npm run deploy` from server/ (it syncs the renderer into ./app), then redeploy'
        : 'not found';
      return jsonResponse(res, 404, { error: msg });
    }
    const headers = { 'Content-Type': entry.type, 'Cache-Control': entry.cache };
    if (entry.swScope) headers['Service-Worker-Allowed'] = '/'; // allow root-scope SW
    res.writeHead(200, headers);
    res.end(data);
  });
}

// Latest-version metadata for the desktop auto-update notifier. The
// desktop app polls GET /version on launch; if its package.json version
// is older it shows a banner whose "Get update" link points at /download.
// We read the file fresh per request so bumping version.json + redeploying
// is enough to notify everyone (no server restart needed once the new
// image is live).
const VERSION_FILE = joinPath(__dirname, 'version.json');
function readVersion() {
  try {
    const data = JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8'));
    return {
      version: String(data.version || ''),
      releasedAt: data.releasedAt || null,
      notes: typeof data.notes === 'string' ? data.notes.slice(0, 1000) : '',
    };
  } catch (e) { return null; }
}

const PORT = process.env.PORT || 7070;
const HOST = process.env.HOST || '0.0.0.0';
// Production gating: Fly sets FLY_APP_NAME on every deployed machine; an
// explicit NODE_ENV=production also counts. Used to fail fast on unsafe config.
const IS_PRODUCTION = process.env.NODE_ENV === 'production' || !!process.env.FLY_APP_NAME;

// ── CORS allowlist ────────────────────────────────────────────────────
// ALLOW_ORIGIN is a comma-separated allowlist of browser origins permitted to
// read cross-origin responses. The hosted web app is same-origin so it never
// needs CORS; the desktop build runs from file:// (Origin: null) and is allowed
// explicitly below. '*' (the legacy value) keeps the wildcard as an escape
// hatch. The API uses no cookies, so this is defense-in-depth: it stops an
// arbitrary website's JS from reading responses, while first-party clients work.
const CANONICAL_ORIGIN = 'https://gateway-protocol.fly.dev';
const ORIGIN_LIST = (process.env.ALLOW_ORIGIN || CANONICAL_ORIGIN).split(',').map(s => s.trim()).filter(Boolean);
const ALLOW_ANY_ORIGIN = ORIGIN_LIST.includes('*');
const ALLOWED_ORIGINS = new Set(ORIGIN_LIST);
const ALLOW_ORIGIN = ALLOW_ANY_ORIGIN ? '*' : ORIGIN_LIST[0] || CANONICAL_ORIGIN; // startup banner / fallback
// Resolve the Access-Control-Allow-Origin value for one request.
function corsOrigin(req) {
  if (ALLOW_ANY_ORIGIN) return '*';
  const origin = req.headers.origin;
  // Desktop (file://) and non-browser clients send Origin: null or none —
  // first-party and credential-less, so allow them (echoes 'null', which the
  // desktop's null-origin fetch accepts).
  if (!origin || origin === 'null') return 'null';
  if (ALLOWED_ORIGINS.has(origin)) return origin;
  // Not allowlisted: return a value that won't match the caller's Origin, so
  // the browser blocks it from reading the response.
  return ORIGIN_LIST[0] || CANONICAL_ORIGIN;
}
// Phase-A monetization: a single hosted "Founder's Supporter" link
// (Gumroad / Lemon Squeezy / Stripe Payment Link). Pay-what-you-want,
// honor-system — the app stays free. The landing-page CTA only renders
// when this is set, so there's never a dead link. (See MONETIZATION.md.)
const SUPPORT_URL = process.env.SUPPORT_URL || '';
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
const RL_LIMITS = { feed_post: 10, feed_react: 30, api: 20, byok: 30, ws_upgrade: 30 };

// ── WebSocket resource caps (Practice Rooms) ──────────────────────────
// Without these, unauthenticated room sockets are a trivial DoS: huge frames,
// unbounded rooms/clients, and zombie connections that never get cleaned up.
const WS_MAX_PAYLOAD = 8 * 1024;        // 8 KB — room messages are tiny JSON
const MAX_ROOMS = 500;                  // global cap on concurrent rooms
const MAX_CLIENTS_PER_ROOM = 50;        // participants per room
const MAX_WS_PER_IP = 10;               // concurrent sockets from one IP
const WS_HEARTBEAT_MS = 30 * 1000;      // ping interval; drop unanswered peers
const wsPerIp = new Map();              // ip → live socket count
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
// Landing-page inline script (stats auto-refresh). Kept inline but pinned by
// a CSP hash so the page can carry a real script-src 'self' policy. The hash
// is computed once from the exact bytes below, so it can never drift.
const LANDING_SCRIPT = `
var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

function setStat(k,v){ var el=document.querySelector('[data-stat="'+k+'"]'); if(el) el.textContent=v; }

// ── Live stats auto-refresh (Accept: application/json → raw stats payload) ──
async function refresh(){
  try{
    var r = await fetch('/', { headers:{'Accept':'application/json'}, cache:'no-store' });
    var s = await r.json();
    setStat('rooms', s.rooms);
    setStat('feed',  s.feedSize);
    var u = s.uptime|0;
    var d=(u/86400|0), h=((u%86400)/3600|0), m=((u%3600)/60|0), sec=u%60;
    setStat('uptime', d ? d+'d '+h+'h' : (h ? h+'h '+m+'m' : m+'m '+sec+'s'));
  }catch(e){}
}
setInterval(refresh, 15000);

// ── Live Transmission Feed ticker. DOM built via textContent (never innerHTML
//    with feed content) so user-supplied transmissions can't inject markup. ──
function chip(it){
  var s=document.createElement('span'); s.className='tick';
  var label=[it.wave?('Wave '+it.wave):'', it.frequency?(it.frequency+'Hz'):'', it.code?it.code:''].filter(Boolean).join(' · ');
  var b=document.createElement('b'); b.textContent=label||'Transmission';
  var i=document.createElement('i'); i.textContent=(it.transmission||'').slice(0,140);
  s.appendChild(b); s.appendChild(i);
  if(it.reactions){ var e=document.createElement('em'); e.textContent='✦ '+it.reactions; s.appendChild(e); }
  return s;
}
function buildTicker(items){
  var track=document.getElementById('ticker-track'); if(!track) return;
  if(!items || !items.length) return; // keep server-rendered placeholder
  track.innerHTML='';
  for(var pass=0; pass<2; pass++) for(var i=0;i<items.length;i++) track.appendChild(chip(items[i]));
  track.classList.toggle('run', !reduce && items.length>1);
}
async function loadTicker(){
  try{ var r=await fetch('/feed?limit=12',{cache:'no-store'}); var d=await r.json(); buildTicker(d.items||[]); }catch(e){}
}
loadTicker(); setInterval(loadTicker, 20000);

// ── Count-up animation for numeric stats on first paint ──
function countUp(el){
  var target = parseInt(el.getAttribute('data-count')||'0',10);
  if(reduce || !target){ el.textContent = target; return; }
  var start = performance.now(), dur = 1100;
  function step(now){
    var p = Math.min((now-start)/dur, 1), eased = 1-Math.pow(1-p,3);
    el.textContent = Math.round(eased*target);
    if(p<1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}
document.querySelectorAll('[data-count]').forEach(countUp);

// ── Scroll-reveal sections ──
var reveals = document.querySelectorAll('.reveal');
if('IntersectionObserver' in window && !reduce){
  var io = new IntersectionObserver(function(entries){
    entries.forEach(function(en){ if(en.isIntersecting){ en.target.classList.add('in'); io.unobserve(en.target); } });
  }, { threshold: 0.14 });
  reveals.forEach(function(el){ io.observe(el); });
} else {
  reveals.forEach(function(el){ el.classList.add('in'); });
}

// ── Interactive golden field: drifting motes that swirl toward the pointer
//    and parallax on scroll ──
(function(){
  var c = document.getElementById('motes'); if(!c || !c.getContext) return;
  var ctx=c.getContext('2d'), motes=[], N=reduce?0:54, w=1, h=1, dpr=Math.min(window.devicePixelRatio||1,2);
  var mx=-9999, my=-9999, sy=0;
  function rand(a,b){ return a+Math.random()*(b-a); }
  function resize(){ w=c.clientWidth||1; h=c.clientHeight||1; c.width=w*dpr; c.height=h*dpr; ctx.setTransform(dpr,0,0,dpr,0,0); }
  function seed(){ motes=[]; for(var i=0;i<N;i++) motes.push({x:rand(0,w),y:rand(0,h),r:rand(.4,1.8),s:rand(.04,.26),o:rand(.1,.6),tw:rand(0,6.28),vx:0,vy:0}); }
  function tick(){
    ctx.clearRect(0,0,w,h);
    for(var i=0;i<motes.length;i++){
      var m=motes[i], dx=mx-m.x, dy=my-m.y, d2=dx*dx+dy*dy;
      if(d2<16000){ var inv=1/Math.sqrt(d2+1), f=(1-d2/16000)*0.5; m.vx+=dx*inv*f; m.vy+=dy*inv*f; }
      m.vx*=0.9; m.vy*=0.9;
      m.x+=m.vx; m.y+=m.vy-m.s; m.tw+=0.02;
      if(m.y<-4){ m.y=h+4; m.x=rand(0,w); } if(m.x<-6) m.x=w+6; if(m.x>w+6) m.x=-6;
      var o=m.o*(0.55+0.45*Math.sin(m.tw));
      ctx.beginPath(); ctx.arc(m.x, m.y-sy*0.03, m.r, 0, 6.2832);
      ctx.fillStyle='rgba(240,216,138,'+o.toFixed(3)+')'; ctx.fill();
    }
    requestAnimationFrame(tick);
  }
  resize(); seed(); if(N) tick();
  var t; window.addEventListener('resize', function(){ clearTimeout(t); t=setTimeout(function(){ resize(); seed(); }, 200); });
  if(!reduce){
    window.addEventListener('pointermove', function(e){ var b=c.getBoundingClientRect(); mx=e.clientX-b.left; my=e.clientY-b.top; }, {passive:true});
    window.addEventListener('pointerleave', function(){ mx=-9999; my=-9999; });
    window.addEventListener('scroll', function(){ sy=window.scrollY||0; }, {passive:true});
  }
})();

// ── Scrollytelling: the eye opens as you scroll through the Process section ──
(function(){
  if(reduce) return;
  var sec=document.getElementById('process'), eye=document.getElementById('process-eye');
  if(!sec || !eye) return;
  var ticking=false;
  function update(){
    ticking=false;
    var r=sec.getBoundingClientRect(), vh=window.innerHeight||1, total=r.height-vh;
    var p = total>0 ? Math.min(Math.max((-r.top)/total,0),1) : (r.top<vh?1:0);
    eye.style.setProperty('--p', p.toFixed(3));
  }
  window.addEventListener('scroll', function(){ if(!ticking){ ticking=true; requestAnimationFrame(update); } }, {passive:true});
  window.addEventListener('resize', update);
  update();
})();

// ── OS-aware CTAs: tailor the download/web-app wording to the visitor.
//    Desktop is macOS-only today; Windows/Linux are pointed at the web app.
//    Phone copy adapts to iPhone vs Android. SSR default = Mac + iPhone. ──
(function(){
  var ua=navigator.userAgent||'', uad=navigator.userAgentData;
  var plat=(uad && uad.platform) ? uad.platform.toLowerCase() : '';
  var uaMobile=(uad && typeof uad.mobile==='boolean') ? uad.mobile : /Mobi|Android|iPhone|iPad|iPod/i.test(ua);
  var ios=/iPhone|iPad|iPod/i.test(ua) || plat==='ios' || (/Mac/i.test(ua) && navigator.maxTouchPoints>1);
  var android=/Android/i.test(ua) || plat==='android';
  var win=/Windows|Win64|Win32/i.test(ua) || plat.indexOf('win')>=0;
  var linux=!android && (/Linux/i.test(ua) || plat.indexOf('linux')>=0);
  var phone=ios||android, mobile=uaMobile||phone;

  function setText(id,t){ var el=document.getElementById(id); if(el && t!=null) el.textContent=t; }
  function setHref(id,h){ var el=document.getElementById(id); if(el) el.setAttribute('href',h); }
  function hide(id){ var el=document.getElementById(id); if(el) el.style.display='none'; }

  // Hero primary CTA
  if(mobile){ setText('hero-cta','Open the web app →'); setHref('hero-cta','/app'); }
  else if(win){ setText('hero-cta','Download for Windows ↓'); setHref('hero-cta','/download/windows'); }
  else if(linux){ setText('hero-cta','Download for Linux ↓'); setHref('hero-cta','/download/linux'); }

  // Desktop conversion card (macOS keeps the default download)
  if(win){
    setText('cd-title','On your Windows PC');
    setText('cd-body','Native installer (.exe). Unsigned for now, so SmartScreen may warn — click “More info → Run anyway”. Prefer no install? The web app runs in any browser.');
    setText('cd-cta','Download for Windows ↓'); setHref('cd-cta','/download/windows');
  } else if(linux){
    setText('cd-title','On your Linux machine');
    setText('cd-body','Debian/Ubuntu .deb (an .rpm is also published on the Releases page). Or run the sovereign web app in any browser.');
    setText('cd-cta','Download .deb ↓'); setHref('cd-cta','/download/linux');
  }

  // Phone conversion card
  if(android){
    setText('cp-title','On your Android');
    setText('cp-body','Install the web app — bring your own key. Scan to open, then tap “Install app” in the browser menu.');
  } else if(ios){
    setText('cp-title','On your iPhone');
  }

  // macOS Gatekeeper instructions are only relevant to Mac visitors.
  if(mobile||win||linux) hide('install-mac');
})();
`;
const LANDING_SCRIPT_HASH = "'sha256-" + crypto.createHash('sha256').update(LANDING_SCRIPT).digest('base64') + "'";
// CSP for the landing response: external Google Fonts stylesheet + inline
// <style> (style-src), font files (font-src), same-origin stats fetch
// (connect-src), and only the hash-pinned inline script (script-src).
const LANDING_CSP = [
  "default-src 'self'",
  `script-src 'self' ${LANDING_SCRIPT_HASH}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "connect-src 'self'",
  "img-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

function renderLanding(stats) {
  const fmtUptime = s => {
    const d = Math.floor(s/86400), h = Math.floor((s%86400)/3600);
    const m = Math.floor((s%3600)/60);
    if (d) return `${d}d ${h}h`;
    if (h) return `${h}h ${m}m`;
    return `${m}m ${s%60}s`;
  };
  // Feed content is user-supplied — escape before injecting into HTML.
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const recent = feed.slice(-10).reverse();
  const tickerInner = recent.length
    ? recent.map(it => {
        const label = [it.wave ? 'Wave ' + esc(it.wave) : '', it.frequency ? esc(it.frequency) + 'Hz' : '', it.code ? esc(it.code) : ''].filter(Boolean).join(' · ');
        const body = esc(String(it.transmission || '').slice(0, 140));
        return `<span class="tick"><b>${label || 'Transmission'}</b><i>${body}</i>${it.reactions ? `<em>✦ ${it.reactions}</em>` : ''}</span>`;
      }).join('')
    : '<span class="tick tick-empty"><i>The feed is quiet right now — be the first transmission.</i></span>';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Gateway Protocol — Consciousness, Healing & the Gateway Process</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="Gateway Protocol — a sovereign desktop practice platform for the Monroe Gateway Process, with opt-in Community Practice Rooms and the Transmission Feed. Owned, not subscribed.">
<meta name="theme-color" content="#08080b">
<meta property="og:title" content="Gateway Protocol">
<meta property="og:description" content="A sovereign consciousness practice platform. Owned, not subscribed.">
<meta property="og:type" content="website">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;1,300;1,400&family=Montserrat:wght@200;300;400;500&display=swap" rel="stylesheet">
<style>
  :root{
    --bg:#08080b;--card:#13131a;--card2:#17171f;
    --border:rgba(201,168,76,.16);--border2:rgba(201,168,76,.34);
    --gold:#c9a84c;--gold2:#f0d88a;--gold3:#fff7e0;
    --text:#e8e2d4;--muted:#8a8170;--silver:#c5bdab;
    --radius:16px;--ease:cubic-bezier(.22,.61,.36,1);
  }
  *{box-sizing:border-box;margin:0;padding:0}
  html{scroll-behavior:smooth}
  body{background:var(--bg);color:var(--text);font-family:Montserrat,system-ui,sans-serif;font-weight:300;line-height:1.65;min-height:100vh;overflow-x:hidden;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}

  /* ── animated aurora background ── */
  .aurora{position:fixed;inset:0;z-index:0;overflow:hidden;pointer-events:none}
  .aurora i{position:absolute;display:block;border-radius:50%;filter:blur(95px);mix-blend-mode:screen}
  .aurora .o1{width:48vw;height:48vw;left:-10vw;top:-8vw;background:radial-gradient(circle,#c9a84c,transparent 65%);opacity:.16;animation:float1 26s var(--ease) infinite alternate}
  .aurora .o2{width:42vw;height:42vw;right:-12vw;top:14vh;background:radial-gradient(circle,#6a5bd0,transparent 65%);opacity:.10;animation:float2 32s var(--ease) infinite alternate}
  .aurora .o3{width:52vw;height:52vw;left:18vw;bottom:-24vh;background:radial-gradient(circle,#c9a84c,transparent 60%);opacity:.08;animation:float3 30s var(--ease) infinite alternate}
  @keyframes float1{to{transform:translate(9vw,7vh) scale(1.16)}}
  @keyframes float2{to{transform:translate(-7vw,-9vh) scale(1.22)}}
  @keyframes float3{to{transform:translate(-11vw,5vh) scale(1.1)}}
  body::after{content:'';position:fixed;inset:0;z-index:0;pointer-events:none;background:radial-gradient(ellipse at 50% -10%,rgba(201,168,76,.08),transparent 55%)}

  /* ── sticky nav ── */
  .nav{position:sticky;top:0;z-index:20;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);background:rgba(8,8,11,.62);border-bottom:.5px solid rgba(201,168,76,.1)}
  .nav-inner{max-width:1100px;margin:0 auto;padding:14px 24px;display:flex;align-items:center;justify-content:space-between}
  .brand{display:inline-flex;align-items:center;gap:11px;color:var(--gold2);text-decoration:none;font-family:'Cormorant Garamond',serif;font-size:20px;letter-spacing:2px}
  .brand svg{width:28px;height:28px;display:block}
  .nav-links{display:flex;align-items:center;gap:28px}
  .nav-links a{color:var(--silver);text-decoration:none;font-size:11px;letter-spacing:2px;text-transform:uppercase;transition:color .2s}
  .nav-links a:hover{color:var(--gold2)}
  .nav-cta{border:.5px solid var(--border2);padding:9px 17px;border-radius:2px;color:var(--gold)!important;transition:background .2s,color .2s}
  .nav-cta:hover{background:rgba(201,168,76,.1)}
  @media(max-width:600px){.nav-links a:not(.nav-cta){display:none}}

  main{position:relative;z-index:1}
  .section{max-width:1100px;margin:0 auto;padding:92px 24px}
  .eyebrow{display:inline-block;font-size:10px;letter-spacing:3.5px;text-transform:uppercase;color:var(--gold);margin-bottom:14px}
  .section-head{text-align:center;margin-bottom:56px}
  .section-head h2{font-family:'Cormorant Garamond',serif;font-weight:300;font-size:clamp(28px,4.6vw,42px);color:var(--gold2);letter-spacing:1px;line-height:1.15}
  .section-head p{font-size:15px;color:var(--muted);max-width:560px;margin:14px auto 0}

  /* ── hero ── */
  .hero{position:relative;min-height:90vh;display:flex;align-items:center;justify-content:center;text-align:center;padding:80px 24px 64px;overflow:hidden}
  #motes{position:absolute;inset:0;width:100%;height:100%;z-index:0}
  .hero-inner{position:relative;z-index:1;max-width:780px;display:flex;flex-direction:column;align-items:center}
  .emblem{width:116px;height:116px;margin-bottom:30px;filter:drop-shadow(0 0 28px rgba(201,168,76,.42));animation:rise .9s var(--ease) both}
  .eye{width:100%;height:100%;overflow:visible}
  .eye .rO{fill:none;stroke:var(--gold);stroke-width:1;opacity:.45;stroke-dasharray:5 9;transform-origin:50px 50px;animation:spin 44s linear infinite}
  .eye .rI{fill:none;stroke:var(--gold);stroke-width:1.4;opacity:.85}
  .eye .tri{fill:none;stroke:var(--gold2);stroke-width:2;stroke-linejoin:round}
  .eye .pO{fill:none;stroke:var(--gold2);stroke-width:2}
  .eye .pp{fill:var(--gold2);animation:glow 3.2s ease-in-out infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
  @keyframes glow{0%,100%{opacity:.65}50%{opacity:1}}

  .badge{display:inline-flex;align-items:center;gap:8px;font-size:10px;letter-spacing:3px;text-transform:uppercase;color:var(--gold);border:.5px solid var(--border);padding:7px 16px;border-radius:30px;margin-bottom:26px;background:rgba(201,168,76,.04);animation:rise .9s var(--ease) .05s both}
  .dot{width:6px;height:6px;border-radius:50%;background:var(--gold);box-shadow:0 0 10px var(--gold);animation:pulse 2s ease-in-out infinite}
  @keyframes pulse{0%,100%{opacity:.35;transform:scale(.85)}50%{opacity:1;transform:scale(1)}}
  h1{font-family:'Cormorant Garamond',serif;font-weight:300;font-size:clamp(44px,9vw,86px);letter-spacing:5px;line-height:1.05;margin-bottom:20px;background:linear-gradient(100deg,#c9a84c,#f0d88a 30%,#fff7e0 50%,#f0d88a 70%,#c9a84c);background-size:220% auto;-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent;animation:rise 1s var(--ease) .1s both,shimmer 7s linear infinite}
  @keyframes shimmer{to{background-position:220% center}}
  .tagline{font-family:'Cormorant Garamond',serif;font-style:italic;font-size:clamp(17px,2.4vw,23px);color:var(--silver);letter-spacing:.5px;max-width:580px;margin-bottom:38px;animation:rise 1s var(--ease) .18s both}
  .tagline em{color:var(--gold2);font-style:italic}

  /* ── CTAs ── */
  .ctas{display:flex;gap:14px;flex-wrap:wrap;justify-content:center;animation:rise 1s var(--ease) .26s both}
  .cta{position:relative;display:inline-flex;align-items:center;gap:9px;font-size:11px;letter-spacing:2.5px;text-transform:uppercase;text-decoration:none;padding:15px 28px;border-radius:3px;transition:transform .25s var(--ease),box-shadow .25s,background .25s,color .25s,border-color .25s;overflow:hidden}
  .cta.primary{background:linear-gradient(135deg,#f0d88a,#c9a84c);color:#1a1505;font-weight:500;box-shadow:0 8px 30px rgba(201,168,76,.24)}
  .cta.primary:hover{transform:translateY(-3px);box-shadow:0 14px 42px rgba(201,168,76,.4)}
  .cta.primary::before{content:'';position:absolute;top:0;left:-120%;width:60%;height:100%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.55),transparent);transform:skewX(-18deg);transition:left .6s var(--ease)}
  .cta.primary:hover::before{left:140%}
  .cta.ghost{border:.5px solid var(--border2);color:var(--gold)}
  .cta.ghost:hover{background:rgba(201,168,76,.08);color:var(--gold2);transform:translateY(-3px);border-color:var(--gold2)}

  /* ── stats ── */
  .stats{display:flex;gap:0;margin-top:56px;flex-wrap:wrap;justify-content:center;animation:rise 1s var(--ease) .34s both}
  .stat{min-width:120px;padding:0 38px}
  .stat+.stat{border-left:.5px solid var(--border)}
  .stat-val{font-family:'Cormorant Garamond',serif;font-weight:300;font-size:46px;color:var(--gold2);letter-spacing:1px;line-height:1}
  .stat-lbl{font-size:9px;letter-spacing:2.5px;text-transform:uppercase;color:var(--muted);margin-top:9px}
  @media(max-width:560px){.stat{padding:0 22px}.stat+.stat{border-left:none}}

  /* ── feature grid ── */
  .feature-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:18px}
  .feature{position:relative;background:linear-gradient(180deg,var(--card2),var(--card));border:.5px solid var(--border);border-radius:var(--radius);padding:34px 30px;transition:transform .3s var(--ease),border-color .3s,box-shadow .3s}
  .feature:hover{transform:translateY(-6px);border-color:var(--border2);box-shadow:0 20px 54px rgba(0,0,0,.45)}
  .feature .ico{width:48px;height:48px;border-radius:12px;display:flex;align-items:center;justify-content:center;background:rgba(201,168,76,.08);border:.5px solid var(--border);margin-bottom:22px}
  .feature .ico svg{width:24px;height:24px;stroke:var(--gold2);fill:none;stroke-width:1.4;stroke-linecap:round;stroke-linejoin:round}
  .feature h3{font-family:'Cormorant Garamond',serif;font-weight:400;font-size:22px;color:var(--gold2);letter-spacing:.5px;margin-bottom:11px}
  .feature p{font-size:13.5px;color:var(--silver);line-height:1.78}
  .feature p em{color:var(--gold2);font-style:italic}
  .lead{text-align:center;max-width:640px;margin:0 auto 46px;font-size:16px;color:var(--silver);line-height:1.8}
  .lead em{color:var(--gold2);font-style:italic}
  .note{text-align:center;max-width:620px;margin:44px auto 0;font-size:14px;color:var(--muted)}
  .note em{color:var(--gold2);font-style:italic}

  /* ── endpoints ── */
  .card{background:var(--card);border:.5px solid var(--border);border-radius:var(--radius);padding:14px 30px;max-width:780px;margin:0 auto}
  .endpoints{display:flex;flex-direction:column;font-family:'SF Mono',Menlo,monospace;font-size:12.5px}
  .endpoint{display:flex;gap:14px;align-items:baseline;color:var(--silver);padding:13px 6px;border-bottom:.5px solid rgba(201,168,76,.07);transition:background .2s}
  .endpoint:last-child{border-bottom:none}
  .endpoint:hover{background:rgba(201,168,76,.04)}
  .method{font-weight:500;color:var(--gold);min-width:46px}
  code{font-family:'SF Mono',Menlo,monospace;background:rgba(0,0,0,.4);padding:2px 8px;border-radius:3px;color:var(--gold2);border:.5px solid var(--border)}
  .ep-desc{color:var(--muted);font-size:11px;margin-left:auto;font-family:Montserrat,sans-serif;letter-spacing:.5px;text-align:right}

  /* ── install ── */
  .install{max-width:720px}
  .install .card{padding:34px 34px}
  .install h3{font-family:'Cormorant Garamond',serif;font-weight:400;font-size:15px;letter-spacing:2px;text-transform:uppercase;color:var(--gold);margin-bottom:16px}
  .install p{font-size:13.5px;color:var(--silver);line-height:1.8;margin-bottom:8px}
  .install em{color:var(--gold2);font-style:italic}
  .install strong{color:var(--silver);font-weight:400}
  .install ol{margin:14px 0 0;padding-left:20px;display:flex;flex-direction:column;gap:11px}
  .install li{font-size:13px;color:var(--silver);line-height:1.6}
  .install li code{font-size:11.5px;word-break:break-all}

  /* ── footer ── */
  footer{position:relative;z-index:1;margin-top:24px;padding:44px 24px;border-top:.5px solid var(--border);text-align:center;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--muted)}
  footer a{color:var(--muted);text-decoration:none;transition:.2s}
  footer a:hover{color:var(--gold)}

  /* ── motion primitives ── */
  .reveal{opacity:0;transform:translateY(28px);transition:opacity .8s var(--ease),transform .8s var(--ease)}
  .reveal.in{opacity:1;transform:none}
  .feature.reveal{transition-delay:calc(var(--i,0) * .09s)}
  @keyframes rise{from{opacity:0;transform:translateY(26px)}to{opacity:1;transform:none}}

  @media(prefers-reduced-motion:reduce){
    *{animation:none!important;transition:none!important}
    .reveal{opacity:1!important;transform:none!important}
  }
  @media(max-width:560px){.section{padding:66px 18px}.hero{min-height:auto;padding:64px 18px 44px}}

  /* ── live transmission ticker ── */
  .ticker{position:relative;z-index:1;border-top:.5px solid var(--border);border-bottom:.5px solid var(--border);background:rgba(13,13,18,.55);overflow:hidden;-webkit-mask-image:linear-gradient(90deg,transparent,#000 7%,#000 93%,transparent);mask-image:linear-gradient(90deg,transparent,#000 7%,#000 93%,transparent)}
  .ticker-track{display:flex;align-items:center;width:max-content}
  .ticker-track.run{animation:marquee 64s linear infinite}
  .ticker:hover .ticker-track.run{animation-play-state:paused}
  @keyframes marquee{to{transform:translateX(-50%)}}
  .tick{display:inline-flex;align-items:baseline;gap:12px;padding:15px 28px;white-space:nowrap;border-right:.5px solid rgba(201,168,76,.08)}
  .tick b{font-weight:500;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--gold)}
  .tick i{font-family:'Cormorant Garamond',serif;font-style:italic;font-size:15px;color:var(--silver);max-width:48ch;overflow:hidden;text-overflow:ellipsis}
  .tick em{font-style:normal;font-size:11px;color:var(--gold2);opacity:.85}
  .tick-empty i{color:var(--muted)}
  @media(prefers-reduced-motion:reduce){.ticker{overflow-x:auto}.ticker-track.run{animation:none}}

  /* ── product preview (device mock) ── */
  .preview{padding-top:48px}
  .device{max-width:880px;margin:0 auto;border:1px solid rgba(201,168,76,.22);border-radius:16px;background:linear-gradient(180deg,#15151c,#0d0d12);box-shadow:0 40px 90px rgba(0,0,0,.55);overflow:hidden}
  .device-bar{display:flex;gap:7px;padding:13px 16px;border-bottom:.5px solid var(--border);background:rgba(0,0,0,.25)}
  .device-bar span{width:11px;height:11px;border-radius:50%;background:rgba(201,168,76,.25)}
  .device-screen{position:relative;aspect-ratio:16/9;background:radial-gradient(ellipse at 50% 28%,rgba(201,168,76,.09),#08080b 72%);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;overflow:hidden}
  .device-screen::before{content:'';position:absolute;top:-40%;width:55%;height:180%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.05),transparent);transform:skewX(-16deg);animation:sheen 8s ease-in-out infinite}
  @keyframes sheen{0%,100%{left:-50%}50%{left:120%}}
  .mock-eye{width:62px;height:62px;filter:drop-shadow(0 0 16px rgba(201,168,76,.5));animation:breathe 6s ease-in-out infinite}
  @keyframes breathe{0%,100%{transform:scale(1);opacity:.92}50%{transform:scale(1.06);opacity:1}}
  .mock-timer{font-family:'Cormorant Garamond',serif;font-size:clamp(34px,7vw,58px);color:var(--gold2);letter-spacing:6px;line-height:1}
  .mock-sub{font-size:9px;letter-spacing:3px;text-transform:uppercase;color:var(--muted);margin-top:-8px}
  .mock-waves{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;max-width:92%}
  .mw{font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--muted);border:.5px solid var(--border);border-radius:20px;padding:5px 12px}
  .mw.on{color:var(--gold2);border-color:var(--border2);background:rgba(201,168,76,.06);animation:pulseTag 3s ease-in-out infinite}
  @keyframes pulseTag{0%,100%{opacity:.7}50%{opacity:1}}
  .preview .cap{text-align:center;color:var(--muted);font-size:12px;margin-top:18px;font-style:italic}

  /* ── scrollytelling: The Process ── */
  .process{position:relative}
  .process-grid{display:grid;grid-template-columns:1fr 1fr;gap:40px;max-width:1100px;margin:0 auto;padding:0 24px;align-items:start}
  .process-stage{position:sticky;top:0;height:100vh;display:flex;align-items:center;justify-content:center}
  .peye-stage{position:relative;width:min(56vw,300px);height:min(56vw,300px);border-radius:50%;overflow:hidden;--p:0;filter:drop-shadow(0 0 30px rgba(201,168,76,.35))}
  .peye-stage .eye{width:100%;height:100%}
  .lid{position:absolute;left:-2%;width:104%;height:52%;background:#08080b;z-index:2;transition:transform .12s linear}
  .lid-t{top:0;transform:translateY(calc(var(--p) * -103%))}
  .lid-b{bottom:0;transform:translateY(calc(var(--p) * 103%))}
  .process-steps{display:flex;flex-direction:column;gap:46vh;padding:34vh 0}
  .pstep .lvl{font-family:'Cormorant Garamond',serif;font-size:clamp(40px,7vw,56px);color:var(--gold2);line-height:1}
  .pstep h3{font-family:'Cormorant Garamond',serif;font-weight:400;font-size:23px;color:var(--gold);margin:6px 0 10px;letter-spacing:1px}
  .pstep p{font-size:14px;color:var(--silver);line-height:1.8;max-width:430px}
  @media(max-width:760px){
    .process-grid{grid-template-columns:1fr;gap:0}
    .process-stage{position:static;height:auto;padding:24px 0 8px}
    .peye-stage{width:190px;height:190px}
    .process-steps{gap:52px;padding:26px 0}
    .pstep p{max-width:none}
  }
  @media(prefers-reduced-motion:reduce){.peye-stage{--p:1}}

  /* ── conversion band ── */
  .convert{padding-top:48px}
  .conv-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(258px,1fr));gap:18px;max-width:1000px;margin:0 auto}
  .conv-card{background:linear-gradient(180deg,var(--card2),var(--card));border:.5px solid var(--border);border-radius:var(--radius);padding:32px 28px;display:flex;flex-direction:column;align-items:flex-start;gap:14px;transition:transform .3s var(--ease),border-color .3s}
  .conv-card:hover{transform:translateY(-5px);border-color:var(--border2)}
  .conv-card h3{font-family:'Cormorant Garamond',serif;font-weight:400;font-size:23px;color:var(--gold2)}
  .conv-card p{font-size:13.5px;color:var(--silver);line-height:1.75}
  .conv-card .cta{margin-top:6px}
  .conv-card.phone{align-items:center;text-align:center}
  .qr{width:142px;height:142px;border-radius:10px;border:.5px solid var(--border);background:#f0d88a;padding:6px;display:block}
  .conv-card.founder{background:linear-gradient(135deg,rgba(201,168,76,.13),rgba(106,91,208,.08));border-color:var(--border2)}
  .conv-card .tag{font-size:10px;letter-spacing:3px;text-transform:uppercase;color:var(--gold)}
</style>
</head>
<body>
<div class="aurora" aria-hidden="true"><i class="o1"></i><i class="o2"></i><i class="o3"></i></div>

<header class="nav">
  <div class="nav-inner">
    <a class="brand" href="/">
      <svg viewBox="0 0 100 100" fill="none" stroke="#f0d88a" stroke-width="4" aria-hidden="true"><circle cx="50" cy="50" r="42"/><polygon points="50,30 70,66 30,66" stroke-linejoin="round"/><circle cx="50" cy="54" r="5" fill="#f0d88a" stroke="none"/></svg>
      Gateway Protocol
    </a>
    <nav class="nav-links">
      <a href="#features">Features</a>
      <a href="#process">Process</a>
      <a href="#network">Network</a>
      <a class="nav-cta" href="/download">Download</a>
    </nav>
  </div>
</header>

<main>

  <section class="hero">
    <canvas id="motes" aria-hidden="true"></canvas>
    <div class="hero-inner">
      <div class="emblem" aria-hidden="true">
        <svg class="eye" viewBox="0 0 100 100">
          <circle class="rO" cx="50" cy="50" r="47"/>
          <circle class="rI" cx="50" cy="50" r="39"/>
          <polygon class="tri" points="50,28 73,68 27,68"/>
          <circle class="pO" cx="50" cy="55" r="9"/>
          <circle class="pp" cx="50" cy="55" r="4.2"/>
        </svg>
      </div>
      <div class="badge"><span class="dot"></span>Network · Online</div>
      <h1>Gateway Protocol</h1>
      <p class="tagline">A sovereign practice field for the Gateway Process — Community Practice Rooms and the Transmission Feed. <em>Owned, not subscribed.</em></p>
      <div class="ctas">
        <a class="cta primary" id="hero-cta" href="/download">Download for macOS ↓</a>
        ${SUPPORT_URL ? `<a class="cta ghost" href="${SUPPORT_URL}" target="_blank" rel="noopener">◈ Become a Founder ↗</a>` : `<a class="cta ghost" href="#features">Explore the network</a>`}
      </div>
      <div class="stats">
        <div class="stat"><div class="stat-val" data-stat="rooms" data-count="${stats.rooms}">0</div><div class="stat-lbl">Active Rooms</div></div>
        <div class="stat"><div class="stat-val" data-stat="feed" data-count="${stats.feedSize}">0</div><div class="stat-lbl">Feed Items</div></div>
        <div class="stat"><div class="stat-val" data-stat="uptime">${fmtUptime(stats.uptime)}</div><div class="stat-lbl">Uptime</div></div>
      </div>
    </div>
  </section>

  <div class="ticker" aria-label="Live transmission feed">
    <div class="ticker-track" id="ticker-track">${tickerInner}</div>
  </div>

  <section class="section preview">
    <div class="section-head reveal">
      <span class="eyebrow">A glimpse</span>
      <h2>Inside the field</h2>
      <p>A living particle field, layered frequencies, and a Council of Five — wrapped in a calm, cinematic interface.</p>
    </div>
    <div class="device reveal">
      <div class="device-bar"><span></span><span></span><span></span></div>
      <div class="device-screen">
        <div class="mock-eye" aria-hidden="true">
          <svg class="eye" viewBox="0 0 100 100"><circle class="rO" cx="50" cy="50" r="47"/><circle class="rI" cx="50" cy="50" r="39"/><polygon class="tri" points="50,28 73,68 27,68"/><circle class="pO" cx="50" cy="55" r="9"/><circle class="pp" cx="50" cy="55" r="4.2"/></svg>
        </div>
        <div class="mock-timer">21:00</div>
        <div class="mock-sub">Focus 21 · Free Flow</div>
        <div class="mock-waves">
          <span class="mw">Discovery</span>
          <span class="mw on">Threshold</span>
          <span class="mw">Freeing the Self</span>
          <span class="mw">Adventure</span>
        </div>
      </div>
    </div>
    <p class="cap reveal">Representative view — the desktop app renders the field in real time.</p>
  </section>

  <section id="features" class="section">
    <div class="section-head reveal">
      <span class="eyebrow">What this is</span>
      <h2>More than a server</h2>
    </div>
    <p class="lead reveal">This URL isn't a website — it's the <em>backend</em> for the Gateway Protocol desktop app, powering two opt-in community features. The app itself stays fully sovereign.</p>
    <div class="feature-grid">
      <article class="feature reveal" style="--i:0">
        <div class="ico"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="2.6"/><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="10.5"/></svg></div>
        <h3>Community Practice Rooms</h3>
        <p>Multiple practitioners run the same Gateway Wave at once. The first joiner hosts; everyone else mirrors the host's timer and phase. <em>Anonymous presence count only</em> — no chat, no video, no identifiers.</p>
      </article>
      <article class="feature reveal" style="--i:1">
        <div class="ico"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="2.2"/><path d="M5.5 5.5a9 9 0 000 13M18.5 5.5a9 9 0 010 13M8.5 8.5a5 5 0 000 7M15.5 8.5a5 5 0 010 7"/></svg></div>
        <h3>Transmission Feed</h3>
        <p>Opt-in anonymous Council transmissions, filterable by wave, frequency, or activation code. <em>A living map</em> of the work the community is doing this week.</p>
      </article>
      <article class="feature reveal" style="--i:2">
        <div class="ico"><svg viewBox="0 0 24 24"><circle cx="8.5" cy="8.5" r="4.5"/><path d="M11.7 11.7l8 8M16.5 16.5l2-2M18.8 18.8l1.4-1.4"/></svg></div>
        <h3>Sovereign by design</h3>
        <p>The desktop app works <em>without</em> this server — pointing at it just adds the optional network layer. Your keys, your data, your machine. Owned, not subscribed.</p>
      </article>
    </div>
  </section>

  <section id="process" class="process">
    <div class="process-grid">
      <div class="process-stage">
        <div class="peye-stage" id="process-eye">
          <svg class="eye" viewBox="0 0 100 100" aria-hidden="true"><circle class="rO" cx="50" cy="50" r="47"/><circle class="rI" cx="50" cy="50" r="39"/><polygon class="tri" points="50,28 73,68 27,68"/><circle class="pO" cx="50" cy="55" r="9"/><circle class="pp" cx="50" cy="55" r="4.2"/></svg>
          <div class="lid lid-t"></div>
          <div class="lid lid-b"></div>
        </div>
      </div>
      <div class="process-steps">
        <div class="section-head reveal" style="text-align:left;margin-bottom:0">
          <span class="eyebrow">The Gateway Process</span>
          <h2>Expanding states of awareness</h2>
        </div>
        <div class="pstep reveal"><div class="lvl">Focus 10</div><h3>Mind awake, body asleep</h3><p>The foundation. Deep physical relaxation while consciousness stays clear and alert — the doorway to everything that follows.</p></div>
        <div class="pstep reveal"><div class="lvl">Focus 12</div><h3>Expanded awareness</h3><p>Perception reaches beyond the physical senses. The field opens, and attention moves freely past the body's usual edges.</p></div>
        <div class="pstep reveal"><div class="lvl">Focus 15</div><h3>The state of no time</h3><p>Pure being, beyond the pull of past and future. Stillness deep enough that the clock dissolves.</p></div>
        <div class="pstep reveal"><div class="lvl">Focus 21</div><h3>The bridge</h3><p>The far edge of the map — the threshold to other energy systems and realities. Where the Council meets you.</p></div>
      </div>
    </div>
  </section>

  <section id="get" class="section convert">
    <div class="section-head reveal">
      <span class="eyebrow">Begin</span>
      <h2>Two ways in</h2>
      <p>Sovereign on desktop, installable on your phone — owned, not subscribed.</p>
    </div>
    <div class="conv-grid">
      <div class="conv-card reveal" id="card-desktop">
        <h3 id="cd-title">On your Mac</h3>
        <p id="cd-body">The full sovereign desktop app. Encrypted local keys, the complete Council of Five, offline-capable.</p>
        <a class="cta primary" id="cd-cta" href="/download">Download for macOS ↓</a>
      </div>
      <div class="conv-card phone reveal" id="card-phone">
        <h3 id="cp-title">On your phone</h3>
        <p id="cp-body">Install the web app — bring your own key. Scan to open on iPhone, then Share → Add to Home Screen.</p>
        <img class="qr" src="/qr-app.svg" alt="QR code linking to the Gateway Protocol web app" width="142" height="142">
        <a class="cta ghost" href="/app">Open the web app →</a>
      </div>
      ${SUPPORT_URL ? `<div class="conv-card founder reveal">
        <span class="tag">◈ Founder's Edition</span>
        <h3>Pay what you want</h3>
        <p>Support sovereign software and become a founding patron. Pay what feels right — no paywall, only gratitude.</p>
        <a class="cta primary" href="${SUPPORT_URL}" target="_blank" rel="noopener">Become a Founder ↗</a>
      </div>` : ''}
    </div>
  </section>

  <section id="network" class="section">
    <div class="section-head reveal">
      <span class="eyebrow">For developers</span>
      <h2>Endpoints</h2>
      <p>A small, anonymous, in-memory REST + WebSocket surface.</p>
    </div>
    <div class="card reveal">
      <div class="endpoints">
        <div class="endpoint"><span class="method">GET</span><span><code>/</code></span><span class="ep-desc">this page</span></div>
        <div class="endpoint"><span class="method">GET</span><span><code>/download</code></span><span class="ep-desc">macOS .dmg (baked in)</span></div>
        <div class="endpoint"><span class="method">GET</span><span><code>/download/windows · /download/linux</code></span><span class="ep-desc">302 → latest GitHub Release installer</span></div>
        <div class="endpoint"><span class="method">GET</span><span><code>/version</code></span><span class="ep-desc">latest desktop version (drives in-app update banner)</span></div>
        <div class="endpoint"><span class="method">GET</span><span><code>/feed?wave=&code=&limit=</code></span><span class="ep-desc">list transmissions</span></div>
        <div class="endpoint"><span class="method">POST</span><span><code>/feed</code></span><span class="ep-desc">publish a transmission</span></div>
        <div class="endpoint"><span class="method">POST</span><span><code>/feed/:id/react</code></span><span class="ep-desc">+1 reaction</span></div>
        <div class="endpoint"><span class="method">WSS</span><span><code>/room/:code</code></span><span class="ep-desc">join a practice room</span></div>
      </div>
    </div>
  </section>

  <section class="section install reveal" id="install-mac">
    <div class="card">
      <h3>Installing on macOS</h3>
      <p><strong>macOS Intel x64.</strong> Apple Silicon runs via Rosetta; native arm64 is on the roadmap. The app is unsigned (no Apple Developer certificate yet), so the first launch shows <em>“Gateway Protocol cannot be opened because the developer cannot be verified.”</em> That's expected — to open it:</p>
      <ol>
        <li>Drag <strong>Gateway Protocol</strong> into your Applications folder.</li>
        <li>Open <strong>System Settings → Privacy &amp; Security</strong>, scroll down, and click <strong>Open Anyway</strong> next to the Gateway Protocol notice.</li>
        <li>Or, in Terminal: <code>xattr -dr com.apple.quarantine "/Applications/Gateway Protocol.app"</code></li>
      </ol>
      <p>It launches normally after that — the prompt only appears once.</p>
    </div>
  </section>

</main>

<footer>
  Gateway Protocol · Reference Server · build ${COMMIT_SHORT} · <a href="/download">Download</a>
</footer>

<script>${LANDING_SCRIPT}</script>
</body>
</html>`;
}

function jsonResponse(res, status, body, extraHeaders) {
  res.writeHead(status, Object.assign({
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': res._corsOrigin || ALLOW_ORIGIN,
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Gateway-Client, X-Gateway-Id, Authorization',
  }, extraHeaders || {}));
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

// GET /download              → 302 redirect to the .dmg in DOWNLOAD_DIR
// GET /download/<filename>   → stream the .dmg from DOWNLOAD_DIR
// Filenames are whitelisted to `[A-Za-z0-9._-]+\.dmg` so the URL can't
// be coaxed into a path traversal. Missing-build returns a 404 with a
// hint instead of just dead-ending.
function handleDownload(req, res, urlPath) {
  // OS-specific installers live on GitHub Releases (Windows/Linux). Redirect
  // to the latest release asset before touching the local .dmg directory.
  const osKey = urlPath.slice('/download/'.length);
  if (Object.prototype.hasOwnProperty.call(RELEASE_ASSETS, osKey)) {
    res.writeHead(302, { Location: RELEASE_BASE + RELEASE_ASSETS[osKey], 'Cache-Control': 'no-cache' });
    return res.end();
  }

  let files = [];
  try { files = fs.readdirSync(DOWNLOAD_DIR).filter(f => f.toLowerCase().endsWith('.dmg')); }
  catch (e) { /* directory may not exist yet */ }

  if (urlPath === '/download' || urlPath === '/download/') {
    if (!files.length) {
      return jsonResponse(res, 404, { error: 'no build attached to this server — try the Releases page' });
    }
    res.writeHead(302, { Location: '/download/' + encodeURIComponent(files[0]) });
    return res.end();
  }

  const name = decodeURIComponent(urlPath.slice('/download/'.length));
  if (!/^[A-Za-z0-9._-]+\.dmg$/.test(name)) {
    return jsonResponse(res, 400, { error: 'bad filename' });
  }
  const filePath = joinPath(DOWNLOAD_DIR, name);
  let stat;
  try { stat = fs.statSync(filePath); }
  catch (e) { return jsonResponse(res, 404, { error: 'not found' }); }

  const baseHeaders = {
    'Content-Type': 'application/x-apple-diskimage',
    'Content-Disposition': `attachment; filename="${name}"`,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=3600',
    'Access-Control-Allow-Origin': res._corsOrigin || ALLOW_ORIGIN,
    'Vary': 'Origin',
  };

  // Range support — a dropped 99MB download resumes instead of restarting.
  const range = req.headers.range;
  const m = range && /^bytes=(\d+)-(\d*)$/.exec(range);
  if (m) {
    const start = parseInt(m[1], 10);
    const end = m[2] ? Math.min(parseInt(m[2], 10), stat.size - 1) : stat.size - 1;
    if (start > end || start >= stat.size) {
      res.writeHead(416, { ...baseHeaders, 'Content-Range': `bytes */${stat.size}` });
      return res.end();
    }
    res.writeHead(206, { ...baseHeaders, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(filePath, { start, end }).pipe(res);
  }

  res.writeHead(200, { ...baseHeaders, 'Content-Length': stat.size });
  if (req.method === 'HEAD') return res.end(); // size probe — headers only
  fs.createReadStream(filePath).pipe(res);
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

// ── /api/* · LLM + TTS relay (the mobile/PWA backend) ─────────────────────
// Phones can't make the Council/TTS/embed calls the desktop app makes
// (Electron holds the keys; there's no localhost proxy on a phone). This is
// the "managed tier" backend: the server injects ITS OWN keys and forwards
// to the providers, so the client never holds a key.
//
// SECURITY — this is an authenticated-spend surface. It is OFF unless
// ENABLE_API_PROXY=1 AND the relevant provider key env var is set. Even
// then it's protected by: the X-Gateway-Client header (CSRF), a per-IP
// rate limit (RL_LIMITS.api), a request-body cap, a model allowlist, and a
// max_tokens ceiling to bound per-call cost. A truly public deployment
// still needs real auth + billing before launch (see MOBILE.md §Security).
const API_PROXY_ON = process.env.ENABLE_API_PROXY === '1';
const API_KEYS = {
  anthropic: process.env.ANTHROPIC_API_KEY || '',
  openai: process.env.OPENAI_API_KEY || '',
  elevenlabs: process.env.ELEVENLABS_API_KEY || '',
};
const ANTHROPIC_MODELS = new Set(['claude-sonnet-4-20250514']);
const OPENAI_TTS_MODELS = new Set(['tts-1', 'tts-1-hd']);
const OPENAI_EMBED_MODELS = new Set(['text-embedding-3-small', 'text-embedding-3-large']);

// ── Usage governor (the launch-safety layer over /api/*) ──────────────────
// Turns the relay from "anyone can drain my account" into a bounded,
// optionally-gated, metered surface:
//
//   • Access token  — if API_ACCESS_TOKEN is set, every /api POST must send
//     Authorization: Bearer <token>. Empty = open beta (still rate-limited),
//     allowed in dev only; in production the server refuses to start without
//     a token (see the startup safety check before server.listen).
//   • Global budget  — a hard daily credit ceiling across ALL callers. The
//     real spend circuit-breaker: even total abuse can't exceed it.
//   • Per-client budget — a daily ceiling per identity (token / X-Gateway-Id
//     / IP), so one caller can't eat the whole global budget.
//   • Cost weighting — a Council call costs more credits than an embedding,
//     so the budget tracks $ roughly, not raw call count.
//
// State is in-memory: fine for the single-machine deploy (documented), resets
// on restart, resets at UTC midnight. Multi-machine scale needs Redis (see
// MOBILE.md). This is BETA-safe (bounds spend, gates access); a public
// consumer launch still wants real accounts + billing on top.
const API_ACCESS_TOKEN = process.env.API_ACCESS_TOKEN || '';
const API_DAILY_CREDITS = parseInt(process.env.API_DAILY_CREDITS || '5000', 10);
const API_CLIENT_DAILY_CREDITS = parseInt(process.env.API_CLIENT_DAILY_CREDITS || '500', 10);
const CALL_COST = { anthropic: 10, speech: 4, embeddings: 1 }; // rough cost proxy

let _usageDay = '';
let _globalUsed = 0;
const _clientUsed = new Map(); // identity → credits used today
function _today() { return new Date().toISOString().slice(0, 10); }
function _rollDay() {
  const d = _today();
  if (d !== _usageDay) { _usageDay = d; _globalUsed = 0; _clientUsed.clear(); }
}
function _secsToUtcMidnight() {
  const n = new Date();
  const next = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + 1, 0, 0, 0);
  return Math.max(1, Math.round((next - n.getTime()) / 1000));
}
function apiIdentity(req) {
  // Token mode → bucket per token (one shared token = one bucket; the global
  // cap is the backstop). Else a stable client id the app generates, else IP.
  if (API_ACCESS_TOKEN) return 'tok';
  const cid = (req.headers['x-gateway-id'] || '').toString().slice(0, 64);
  if (cid) return 'id:' + cid;
  return 'ip:' + clientIp(req);
}
function requireApiAuth(req, res) {
  if (!API_ACCESS_TOKEN) return true; // open beta
  const m = (req.headers['authorization'] || '').match(/^Bearer\s+(.+)$/i);
  if (!m || m[1] !== API_ACCESS_TOKEN) { jsonResponse(res, 401, { error: 'invalid or missing access token' }); return false; }
  return true;
}
// Reserve credits for a call. Returns null if allowed, or an error descriptor.
function governorReserve(req, kind) {
  _rollDay();
  const cost = CALL_COST[kind] || 1;
  if (_globalUsed + cost > API_DAILY_CREDITS) {
    return { status: 503, body: { error: 'daily capacity reached — resets at 00:00 UTC' } };
  }
  const id = apiIdentity(req);
  const used = _clientUsed.get(id) || 0;
  if (used + cost > API_CLIENT_DAILY_CREDITS) {
    return { status: 429, body: { error: 'your daily quota is used up — resets at 00:00 UTC' } };
  }
  _globalUsed += cost;
  _clientUsed.set(id, used + cost);
  return null;
}

function readBody(req, max) {
  return new Promise((resolve, reject) => {
    let data = '', over = false;
    req.on('data', c => { if (over) return; data += c; if (data.length > max) { over = true; reject(new Error('too large')); } });
    req.on('end', () => { if (!over) resolve(data); });
    req.on('error', reject);
  });
}

// Upstream relay guards: a hung provider must not pin a client connection
// forever, and a runaway response must not be streamed without bound. TTS
// audio is the largest legitimate payload (a few MB), so the cap is generous.
const UPSTREAM_TIMEOUT_MS = 60 * 1000;
const UPSTREAM_MAX_BYTES = 25 * 1024 * 1024; // 25 MB

// Forward a POST upstream with server-injected auth; stream the response back
// (works for JSON and binary/audio alike — content-type is copied through),
// bounded by a timeout and a max response size.
function httpsRelay({ hostname, path: upPath, headers, body }, clientRes) {
  let done = false; // response fully handled (success, cap, or error)
  const fail = (status, msg) => {
    if (done) return; done = true;
    // Only send a JSON error if we haven't started streaming the body yet.
    if (!clientRes.headersSent) { try { jsonResponse(clientRes, status, { error: msg }); } catch (_) {} }
    else { try { clientRes.destroy(); } catch (_) {} }
  };

  const up = https.request(
    { hostname, path: upPath, method: 'POST', headers, timeout: UPSTREAM_TIMEOUT_MS },
    r => {
      clientRes.writeHead(r.statusCode, {
        'Content-Type': r.headers['content-type'] || 'application/json',
        'Access-Control-Allow-Origin': clientRes._corsOrigin || ALLOW_ORIGIN,
        'Vary': 'Origin',
        'Cache-Control': 'no-store',
      });
      let bytes = 0;
      r.on('data', chunk => {
        if (done) return;
        bytes += chunk.length;
        if (bytes > UPSTREAM_MAX_BYTES) {
          done = true;
          try { r.destroy(); } catch (_) {}
          try { clientRes.destroy(); } catch (_) {} // truncate — abuse/oversize
          return;
        }
        clientRes.write(chunk);
      });
      r.on('end', () => { if (!done) { done = true; clientRes.end(); } });
      r.on('error', () => fail(502, 'upstream stream error'));
    }
  );
  up.on('timeout', () => { try { up.destroy(); } catch (_) {} fail(504, 'upstream timeout'); });
  up.on('error', e => fail(502, 'upstream: ' + e.message));
  up.write(body); up.end();
}

async function handleApiAnthropic(req, res) {
  if (!API_KEYS.anthropic) return jsonResponse(res, 503, { error: 'anthropic not configured' });
  let body;
  try { body = JSON.parse(await readBody(req, 64 * 1024)); }
  catch (e) { return jsonResponse(res, e.message === 'too large' ? 413 : 400, { error: e.message === 'too large' ? 'body too large' : 'invalid JSON' }); }
  if (!ANTHROPIC_MODELS.has(body.model)) body.model = 'claude-sonnet-4-20250514';
  body.max_tokens = Math.min(parseInt(body.max_tokens, 10) || 1024, 1500); // cost ceiling
  const out = JSON.stringify(body);
  httpsRelay({
    hostname: 'api.anthropic.com', path: '/v1/messages',
    headers: { 'x-api-key': API_KEYS.anthropic, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(out) },
    body: out,
  }, res);
}

async function handleApiEmbeddings(req, res) {
  if (!API_KEYS.openai) return jsonResponse(res, 503, { error: 'openai not configured' });
  let body;
  try { body = JSON.parse(await readBody(req, 64 * 1024)); }
  catch (e) { return jsonResponse(res, e.message === 'too large' ? 413 : 400, { error: e.message === 'too large' ? 'body too large' : 'invalid JSON' }); }
  if (!OPENAI_EMBED_MODELS.has(body.model)) body.model = 'text-embedding-3-small';
  if (typeof body.input === 'string') body.input = body.input.slice(0, 8000);
  const out = JSON.stringify({ model: body.model, input: body.input });
  httpsRelay({
    hostname: 'api.openai.com', path: '/v1/embeddings',
    headers: { 'Authorization': 'Bearer ' + API_KEYS.openai, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(out) },
    body: out,
  }, res);
}

async function handleApiSpeech(req, res) {
  if (!API_KEYS.openai) return jsonResponse(res, 503, { error: 'openai not configured' });
  let body;
  try { body = JSON.parse(await readBody(req, 16 * 1024)); }
  catch (e) { return jsonResponse(res, e.message === 'too large' ? 413 : 400, { error: e.message === 'too large' ? 'body too large' : 'invalid JSON' }); }
  if (!OPENAI_TTS_MODELS.has(body.model)) body.model = 'tts-1';
  const out = JSON.stringify({
    model: body.model,
    input: String(body.input || '').slice(0, 4000),
    voice: body.voice || 'nova',
    speed: Math.max(0.25, Math.min(2, Number(body.speed) || 0.9)),
    response_format: 'mp3',
  });
  httpsRelay({
    hostname: 'api.openai.com', path: '/v1/audio/speech',
    headers: { 'Authorization': 'Bearer ' + API_KEYS.openai, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(out) },
    body: out,
  }, res);
}

// ── /byok/* · stateless Bring-Your-Own-Key passthrough ────────────────────
// The sovereign PWA backend (Phase A). Same provider relay as /api/*, but the
// CLIENT supplies its OWN key per request via the X-BYOK-Key header. The
// server NEVER stores the key, NEVER uses its own, and the usage governor /
// budget does NOT apply — the user pays their own provider bill. Upstream
// destinations are hardcoded to the two providers, so this is NOT an open
// proxy (a caller can't redirect it elsewhere). It carries no spend liability
// for the operator, so it's ON by default; set ENABLE_BYOK_PROXY=0 to disable.
//
// It still keeps the non-spend rails: the X-Gateway-Client CSRF header, a
// per-IP burst limit (RL_LIMITS.byok), and a request-body cap.
const BYOK_PROXY_ON = process.env.ENABLE_BYOK_PROXY !== '0';

function byokKey(req, res) {
  const k = (req.headers['x-byok-key'] || '').toString().trim();
  if (!k) { jsonResponse(res, 401, { error: 'missing X-BYOK-Key header (bring your own key)' }); return null; }
  return k;
}

async function handleByok(req, res, kind) {
  const key = byokKey(req, res);
  if (!key) return;
  const maxBody = kind === 'speech' ? 16 * 1024 : 256 * 1024; // Council context can be large
  let body;
  try { body = JSON.parse(await readBody(req, maxBody)); }
  catch (e) { return jsonResponse(res, e.message === 'too large' ? 413 : 400, { error: e.message === 'too large' ? 'body too large' : 'invalid JSON' }); }
  if (typeof body.model !== 'string' || !body.model) return jsonResponse(res, 400, { error: 'model required' });

  if (kind === 'anthropic') {
    body.max_tokens = Math.min(parseInt(body.max_tokens, 10) || 1024, 8192); // server-resource sanity cap, not a cost gate
    const out = JSON.stringify(body);
    return httpsRelay({
      hostname: 'api.anthropic.com', path: '/v1/messages',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(out) },
      body: out,
    }, res);
  }
  if (kind === 'embeddings') {
    const out = JSON.stringify({ model: body.model, input: body.input });
    return httpsRelay({
      hostname: 'api.openai.com', path: '/v1/embeddings',
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(out) },
      body: out,
    }, res);
  }
  if (kind === 'speech') {
    const out = JSON.stringify({
      model: body.model,
      input: String(body.input || '').slice(0, 4000),
      voice: body.voice || 'nova',
      speed: clamp(body.speed, 0.25, 2, 0.9),
      response_format: 'mp3',
    });
    return httpsRelay({
      hostname: 'api.openai.com', path: '/v1/audio/speech',
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(out) },
      body: out,
    }, res);
  }
}

// ── HTTP server (also hosts the WS upgrade) ───────────────────────────
const server = http.createServer((req, res) => {
  // Resolve the per-request CORS origin once and stash it, so every responder
  // (jsonResponse, httpsRelay, downloads) reflects the right value.
  res._corsOrigin = corsOrigin(req);
  // CORS preflight — must echo the same Allow-Headers as actual responses
  // or the X-Gateway-Client header won't survive the preflight.
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': res._corsOrigin,
      'Vary': 'Origin',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Gateway-Client, X-Gateway-Id, Authorization, X-BYOK-Key',
      'Access-Control-Max-Age': '600',
    });
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const path = url.pathname;

  // Hosted web app + PWA assets (fixed allowlist; GET only).
  if (req.method === 'GET' && STATIC_ROUTES[path]) return serveStatic(res, STATIC_ROUTES[path], path);

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
        'Content-Security-Policy': LANDING_CSP,
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
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
  // GET|HEAD /download[...]  — direct .dmg distribution baked into the image.
  // HEAD lets browsers/download managers probe size first.
  if ((req.method === 'GET' || req.method === 'HEAD') && (path === '/download' || path.startsWith('/download/'))) {
    return handleDownload(req, res, path);
  }
  // GET /version — desktop app polls this to drive the "update available"
  // banner. Edit version.json before deploying a new build to flip it on
  // for every running app on next launch.
  if (req.method === 'GET' && path === '/version') {
    const v = readVersion();
    if (!v) return jsonResponse(res, 404, { error: 'version info not configured' });
    return jsonResponse(res, 200, { ...v, downloadUrl: '/download' });
  }

  // /api/* — managed LLM/TTS relay for the mobile/PWA client.
  if (path.startsWith('/api/')) {
    if (!API_PROXY_ON) return jsonResponse(res, 503, { error: 'api proxy disabled on this server' });
    // GET /api/status — feature-detect providers + report capacity. No key,
    // no spend, no auth required (so a client can discover it needs a token).
    if (req.method === 'GET' && path === '/api/status') {
      _rollDay();
      const id = apiIdentity(req);
      return jsonResponse(res, 200, {
        providers: { anthropic: !!API_KEYS.anthropic, openai: !!API_KEYS.openai, elevenlabs: !!API_KEYS.elevenlabs },
        authRequired: !!API_ACCESS_TOKEN,
        limits: { dailyCredits: API_DAILY_CREDITS, clientDailyCredits: API_CLIENT_DAILY_CREDITS, costPerCall: CALL_COST },
        remaining: { global: Math.max(0, API_DAILY_CREDITS - _globalUsed), you: Math.max(0, API_CLIENT_DAILY_CREDITS - (_clientUsed.get(id) || 0)) },
        resetInSeconds: _secsToUtcMidnight(),
      });
    }
    if (req.method === 'POST') {
      if (!requireClient(req, res)) return;        // CSRF header
      if (!requireApiAuth(req, res)) return;        // access token (if configured)
      if (rateLimited('api', clientIp(req))) return jsonResponse(res, 429, { error: 'slow down' }); // burst guard
      const kind = path === '/api/anthropic/messages' ? 'anthropic'
        : path === '/api/openai/speech' ? 'speech'
        : path === '/api/openai/embeddings' ? 'embeddings' : null;
      if (!kind) return jsonResponse(res, 404, { error: 'unknown api route' });
      const gov = governorReserve(req, kind); // global + per-client daily budget
      if (gov) return jsonResponse(res, gov.status, gov.body, { 'Retry-After': String(_secsToUtcMidnight()) });
      if (kind === 'anthropic') return handleApiAnthropic(req, res);
      if (kind === 'embeddings') return handleApiEmbeddings(req, res);
      if (kind === 'speech') return handleApiSpeech(req, res);
    }
    return jsonResponse(res, 404, { error: 'unknown api route' });
  }

  // /byok/* — stateless BYOK passthrough for the sovereign PWA. The client
  // brings its own provider key (X-BYOK-Key); no server key, no governor.
  if (path.startsWith('/byok/')) {
    if (!BYOK_PROXY_ON) return jsonResponse(res, 503, { error: 'byok proxy disabled on this server' });
    // GET /byok/status — feature-detect (no key, no spend, no auth).
    if (req.method === 'GET' && path === '/byok/status') {
      return jsonResponse(res, 200, {
        ok: true, mode: 'byok', providers: ['anthropic', 'openai'],
        keyHeader: 'X-BYOK-Key', note: 'bring your own provider key per request',
      });
    }
    if (req.method === 'POST') {
      if (!requireClient(req, res)) return;       // CSRF header (parity with /api)
      if (rateLimited('byok', clientIp(req))) return jsonResponse(res, 429, { error: 'slow down' });
      const kind = path === '/byok/anthropic/messages' ? 'anthropic'
        : path === '/byok/openai/speech' ? 'speech'
        : path === '/byok/openai/embeddings' ? 'embeddings' : null;
      if (!kind) return jsonResponse(res, 404, { error: 'unknown byok route' });
      return handleByok(req, res, kind);
    }
    return jsonResponse(res, 404, { error: 'unknown byok route' });
  }

  jsonResponse(res, 404, { error: 'not found' });
});

// ── WebSocket server (Practice Rooms) ─────────────────────────────────
const wss = new WebSocketServer({ noServer: true, maxPayload: WS_MAX_PAYLOAD });

// Reply with a minimal HTTP error and tear down the socket before any WS
// handshake — used to reject floods/over-capacity upgrades cheaply.
function abortUpgrade(socket, status) {
  const line = status === 429 ? '429 Too Many Requests' : '503 Service Unavailable';
  try { socket.write(`HTTP/1.1 ${line}\r\nConnection: close\r\n\r\n`); } catch {}
  try { socket.destroy(); } catch {}
}

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const match = url.pathname.match(/^\/room\/([A-Z0-9]{4,12})$/i);
  if (!match) { socket.destroy(); return; }
  const ip = clientIp(req);
  // Cheap rejects before allocating a socket: reconnect storms, per-IP floods,
  // and global/per-room capacity. New rooms are created lazily in joinRoom, so
  // the room-cap check here is for the create-vs-join distinction.
  if (rateLimited('ws_upgrade', ip)) { abortUpgrade(socket, 429); return; }
  if ((wsPerIp.get(ip) || 0) >= MAX_WS_PER_IP) { abortUpgrade(socket, 429); return; }
  const code = match[1].toUpperCase();
  const existing = rooms.get(code);
  if (!existing && rooms.size >= MAX_ROOMS) { abortUpgrade(socket, 503); return; }
  if (existing && existing.clients.size >= MAX_CLIENTS_PER_ROOM) { abortUpgrade(socket, 503); return; }
  wss.handleUpgrade(req, socket, head, ws => {
    ws._id = crypto.randomBytes(4).toString('hex');
    ws._code = code;
    ws._ip = ip;
    ws._isAlive = true;
    wsPerIp.set(ip, (wsPerIp.get(ip) || 0) + 1);
    ws.on('pong', () => { ws._isAlive = true; });
    // Decrement the per-IP counter exactly once when this socket closes,
    // independent of room membership bookkeeping.
    ws.on('close', () => {
      const n = (wsPerIp.get(ip) || 1) - 1;
      if (n <= 0) wsPerIp.delete(ip); else wsPerIp.set(ip, n);
    });
    joinRoom(ws, code);
  });
});

// Heartbeat: ping every client each interval and terminate any that didn't
// answer the previous round. terminate() fires 'close', so room + per-IP
// cleanup happen through the normal path.
const wsHeartbeat = setInterval(() => {
  for (const room of rooms.values()) {
    for (const ws of room.clients) {
      if (ws._isAlive === false) { try { ws.terminate(); } catch {} continue; }
      ws._isAlive = false;
      try { ws.ping(); } catch {}
    }
  }
}, WS_HEARTBEAT_MS);
if (wsHeartbeat.unref) wsHeartbeat.unref();
wss.on('close', () => clearInterval(wsHeartbeat));

function joinRoom(ws, code) {
  let room = rooms.get(code);
  if (!room) {
    if (rooms.size >= MAX_ROOMS) { send(ws, { type: 'error', error: 'Server at capacity — try again shortly.' }); try { ws.close(); } catch {} return; }
    room = { code, wave: 0, clients: new Set(), hostId: ws._id, state: defaultState(), createdAt: Date.now(), lastActivityAt: Date.now() };
    rooms.set(code, room);
    console.log(`[Room ${code}] created (host=${ws._id})`);
  } else if (room.clients.size >= MAX_CLIENTS_PER_ROOM) {
    send(ws, { type: 'error', error: 'This room is full.' }); try { ws.close(); } catch {} return;
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

// ── Startup safety check ──────────────────────────────────────────────
// ENABLE_API_PROXY=1 with no API_ACCESS_TOKEN means anyone who can reach the
// server can spend our provider credits (bounded only by the rate limit and
// daily budget — not by authentication). That's fine for local dev, but in
// production we fail fast so the misconfiguration can never ship silently.
if (API_PROXY_ON && !API_ACCESS_TOKEN) {
  if (IS_PRODUCTION) {
    console.error('FATAL: ENABLE_API_PROXY=1 requires API_ACCESS_TOKEN in production — refusing to start the unauthenticated managed relay.');
    process.exit(1);
  }
  console.warn('⚠  API proxy enabled WITHOUT API_ACCESS_TOKEN (open beta). Dev only — set API_ACCESS_TOKEN before deploying.');
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

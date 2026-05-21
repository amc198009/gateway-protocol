# Gateway Protocol — Mobile / PWA Architecture

How the desktop app reaches phones, what's built, and what's left.

## TL;DR

Electron is desktop-only. The path to phones is a **hosted, installable web
app (PWA)** served from this `/server`, with the server acting as the
**managed backend** for the Council / TTS / embeddings calls (because a phone
browser can't safely hold the provider API keys).

- ✅ **Built (this server):** a secured `/api/*` key-injecting relay — the
  backend a phone needs.
- ⏳ **Next (renderer-coupled):** a "web mode" adapter in the renderer, a
  responsive layout pass, PWA manifest + service worker, and iOS audio
  gating.

Desktop stays the **free, sovereign, BYOK** tier. The PWA is the **managed**
tier (server holds the keys) — which is also the natural paid tier (see
§Monetization).

---

## Why not just open the Electron renderer on a phone?

The renderer (`electron-app/renderer/index.html`) makes its AI calls one of
two ways:

1. **Electron:** through `window.gp.*` IPC → the main process holds the
   encrypted keys and calls Anthropic/OpenAI/ElevenLabs.
2. **V1 fallback:** `fetch('http://localhost:5050/...')` against `proxy.js`.

On a phone, **neither exists** — there's no `window.gp` and no localhost
proxy. And we can't ship keys to the browser (they'd be world-readable, and
Anthropic blocks direct browser CORS anyway). So a phone build needs a
**server** that holds the keys and relays the calls. That's what the `/api/*`
endpoints below are.

---

## The `/api/*` relay (BUILT)

A thin, key-injecting proxy. The client sends a normal provider request
**without a key**; the server injects its own key, enforces limits, and pipes
the provider response straight back (JSON or audio).

| Method | Route | Forwards to | Notes |
|---|---|---|---|
| GET | `/api/status` | — | `{anthropic,openai,elevenlabs}` booleans so the client can feature-detect. No key, no spend. |
| POST | `/api/anthropic/messages` | `api.anthropic.com/v1/messages` | Model allowlisted; `max_tokens` clamped ≤1500. |
| POST | `/api/openai/embeddings` | `api.openai.com/v1/embeddings` | `text-embedding-3-*`; input capped 8k chars. |
| POST | `/api/openai/speech` | `api.openai.com/v1/audio/speech` | `tts-1`/`tts-1-hd`; returns `audio/mpeg`. |

### Enabling it

Off unless **both** are true:

```bash
fly secrets set ENABLE_API_PROXY=1
fly secrets set ANTHROPIC_API_KEY=sk-ant-...   # enables /api/anthropic/*
fly secrets set OPENAI_API_KEY=sk-...          # enables /api/openai/*
# ELEVENLABS_API_KEY optional

# Usage governor (optional — sane defaults shown):
fly secrets set API_ACCESS_TOKEN=<random>      # require Bearer token; unset = open beta
fly secrets set API_DAILY_CREDITS=5000         # global daily spend ceiling (credits)
fly secrets set API_CLIENT_DAILY_CREDITS=500   # per-client daily ceiling
# credit cost per call: anthropic=10, speech=4, embeddings=1
```

`/api/status` reports which providers are live, whether a token is required,
the limits, and **remaining credits** (global + yours) so the client can show
"X left today." Each POST route returns `503` if its key is absent.

---

## The `/byok/*` passthrough (BUILT) — the sovereign PWA backend

The Phase-A monetization decision (see `../MONETIZATION.md`) is **sovereign
BYOK**: the web app holds the user's own key and the server never does. So
alongside the managed `/api/*` relay there's a parallel **bring-your-own-key**
family. Same plumbing, opposite key source: the **client** sends its key per
request in the `X-BYOK-Key` header; the server forwards it to the provider and
pipes the response back. **No server key, no governor, no budget** — the user
pays their own provider bill.

| Method | Route | Forwards to | Notes |
|---|---|---|---|
| GET | `/byok/status` | — | `{providers, keyHeader}` for feature-detect. No key, no auth. |
| POST | `/byok/anthropic/messages` | `api.anthropic.com/v1/messages` | Pass `model` through; `max_tokens` clamped ≤8192 (server-resource sanity, not a cost gate). |
| POST | `/byok/openai/embeddings` | `api.openai.com/v1/embeddings` | Pass `model`+`input` through. |
| POST | `/byok/openai/speech` | `api.openai.com/v1/audio/speech` | `input` ≤4k chars; returns `audio/mpeg`. |

- **Auth:** none of the server's. Send the user's provider key as
  `X-BYOK-Key: <key>`. Missing key → `401`.
- **Still requires** the `X-Gateway-Client` header (CSRF parity) and is
  per-IP rate limited (`RL_LIMITS.byok = 30`), body-capped (256k; 16k for
  speech).
- **Not an open proxy:** upstream hosts are hardcoded to the two providers;
  a caller cannot redirect it elsewhere.
- **On by default** (no spend liability for the operator). Disable with
  `ENABLE_BYOK_PROXY=0`. Independent of `ENABLE_API_PROXY`.

### Renderer handoff — what the web build must do to use this

The renderer's web fallback (`electron-app/renderer/index.html`) currently
`fetch()`es `http://localhost:5050/...` (the old local `proxy.js`) with
endpoint shapes `/mirror`, `/tts`, `/pre-session`. To run as a deployed PWA it
must instead, **when `!window.gp`** (non-Electron):

1. Target **same-origin** relative URLs (`{origin}/byok/...`), not
   `localhost:5050`.
2. Use the routes above (the `/byok/anthropic/messages` Messages-API shape,
   not the old `/mirror` shape).
3. Collect the user's key in the browser (localStorage/IndexedDB) and send it
   as `X-BYOK-Key`, plus `X-Gateway-Client: 1`.
4. Provide web fallbacks (or graceful "desktop-only" disables) for the V4
   Council features that are currently Electron-only (monthly patterns,
   affirmations, shadow dialogue, synchronicities).

Once that's done, serving the renderer at `/app` is a trivial static route to
add here. **`/app` is intentionally NOT served yet** — it would call a
nonexistent `localhost:5050` and fail until the above is wired.

---

## Security model (read before exposing publicly)

This is an **authenticated-spend surface** — every call costs the server
owner money. Layered protections (outer → inner):

- **Disabled by default** (`ENABLE_API_PROXY` + per-provider key required).
- **Access token** (`API_ACCESS_TOKEN`): if set, every `/api` POST must send
  `Authorization: Bearer <token>` → gates the relay to people you've given the
  token. Unset = open beta (still bounded by everything below).
- **CSRF gate:** the `X-Gateway-Client` header forces a CORS preflight a
  drive-by page can't satisfy.
- **Per-IP burst limit:** `RL_LIMITS.api` (20/min).
- **Usage governor (the spend circuit-breaker):**
  - **Global daily credit cap** (`API_DAILY_CREDITS`) — a hard ceiling across
    *all* callers. Even total abuse can't exceed it; over the cap → `503`.
  - **Per-client daily cap** (`API_CLIENT_DAILY_CREDITS`) — per identity
    (token / `X-Gateway-Id` / IP); over it → `429`. One caller can't eat the
    whole budget.
  - **Cost-weighted** (anthropic 10 / speech 4 / embeddings 1) so the budget
    tracks dollars, not raw call count. Resets 00:00 UTC.
- **Body caps** (16–64 KB) + **model allowlist** + **`max_tokens` ceiling**.

**Beta-safe, not yet infinite-public-launch-safe.** The governor *bounds*
spend and *gates* access, which is enough for a trusted beta. Two known
limits for a true consumer launch: state is in-memory (fine for the
single-machine deploy; multi-machine needs Redis), and identity is
token/header/IP, not real accounts — a shared carrier IP shares a bucket and
a client id is spoofable (the global cap is the backstop). A public launch
still wants real accounts + per-user metering + billing on top. See
`LAUNCH_CHECKLIST.md`.

---

## What's left (renderer-coupled — Phase 2)

These touch `electron-app/renderer/index.html`, so they should be done by
whoever owns the renderer (to avoid concurrent-edit collisions). Precise spec:

1. **Web-mode adapter in `GP_API`.** Add a third branch alongside Electron /
   V1-proxy: when running as hosted web (no `window.gp`, and a configured
   app origin), route calls to the relay:
   - Council → `POST {origin}/api/anthropic/messages` with the existing
     system prompt + messages (move the `*_SYSTEM_PROMPT` constants from
     `main.js` into a shared file the web client can import).
   - TTS → `POST {origin}/api/openai/speech`.
   - Embeddings → `POST {origin}/api/openai/embeddings`.
   - All with header `X-Gateway-Client: 1`.
   - Detect web mode via `location.origin` (served from the fly host) vs
     `file://` (Electron).

2. **Responsive layout pass.** The renderer is desktop-first (900px centered
   column, only a couple `@media` rules). Needs real small-screen work: the
   nav, panels, modals (shadow dialogue, orbital nav), and cinematic mode on
   a phone viewport. Default to **Field Quality: Low** on mobile GPUs.

3. **PWA assets.** `manifest.webmanifest` (name, icons, `display:standalone`,
   theme color `#02020a`) + a service worker (cache-first for the shell +
   `three.min.js`/fonts, network-only for `/api/*`). Register the SW from the
   renderer. Add the manifest `<link>` + theme-color meta. Serve all of these
   from this server (they live under `server/` so they ship in the Docker
   image; serving the renderer itself means copying it into the image at
   build, like the `.dmg`).

4. **iOS gotchas:**
   - **Audio needs a user gesture** — the AudioContext (Solfeggio, binaural,
     Field Resonance) must start from a tap, not on load. Add a "tap to begin"
     gate.
   - **No autoplay** of TTS without interaction.
   - Native notification scheduler + encrypted key vault don't exist in web —
     use the Web Push + Notifications API (requires the PWA installed) and
     accept that web has no local key vault (managed keys server-side instead).
   - Fullscreen via the Fullscreen API (cinematic mode) is limited on iOS
     Safari — test and fall back to a CSS-only immersive layout.

### Suggested phase order
1. Renderer web-mode adapter (points at the relay — backend already exists).
2. Serve the renderer at `/app` from the server (+ copy into Docker image).
3. PWA manifest + service worker + install prompt.
4. Responsive pass + iOS audio gate.
5. (Launch-gating) auth + per-user metering + billing on `/api/*`.

---

## Monetization tie-in

The relay **is** the managed tier. Clean split:

- **Desktop (free, "Sovereign"):** BYOK, keys encrypted locally, no server
  spend, fully offline-capable. Matches "owned, not subscribed."
- **Mobile/Web (paid, "Managed"):** server holds the keys, works on any
  phone with zero setup, installable. The convenience people pay for.

So mobile doesn't dilute the sovereign promise — it makes sovereignty the
free floor and convenience the paid ceiling. The same `/api/*` work that
enables phones is the work that enables billing.

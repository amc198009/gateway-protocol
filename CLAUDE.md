# Gateway Protocol — Claude context

> Concise, current project memory. Auto-loaded by Claude Code every session.
> Update the **Current state** section after each meaningful change. Deep history
> lives in `HANDOFF.md`, `PROGRESS.md`, the `V*_ROADMAP.md` files, and the memos.

## What this is
A sovereign consciousness-practice platform for the Monroe Gateway Process. Three surfaces, one codebase:
- **Desktop app** — Electron (`electron-app/`), the primary sovereign product. Local keys in the OS keychain (`safeStorage`), works offline.
- **Hosted web app (PWA)** — the same renderer served at `/app` (BYOK: user brings their own key).
- **Reference server** — Node HTTP + WebSocket (`server/practice-room.js`) on **Fly.io** (`gateway-protocol.fly.dev`). Optional, anonymous, in-memory network layer: Community Practice Rooms (`WSS /room/:code`) + the Transmission Feed (`/feed`), plus an optional LLM/TTS relay (`/api/*`, `/byok/*`).

Repo: github.com/amc198009/gateway-protocol · Owner: Arturo (artmor30@gmail.com).

## Current state (snapshot 2026-05-25 — everything below is shipped & merged; nothing in-flight)
- **Desktop:** shipped **v3.3.5** across all 4 platforms (win, mac arm64, mac x64, linux). Deployed version live = 3.3.5.
- **v3.3.5 fix:** cinematic timed-session alignment — ambient panel was leaking into the immersive view (`.ambient-controls` class was never applied), and `.timer-wrap`'s inline `position:relative` overrode the cinematic `position:fixed` (fixed with `!important`). Also brand-styled the range sliders (were native blue).
- **Landing redesign (server-only):** `GET /` is now a cinematic product narrative (Council of Five + live in-browser Mirror demo, 6-movement Protocol, Coherence Bloom, Waves I–VII, honesty matrix). Source: `scripts/landing-source.html` → built by `scripts/build-landing.mjs` → `server/landing.js` (reproducible). Adapted from a Claude.ai artifact export: stripped the tweaks panel + `window.claude`/`postMessage`, swapped inlined base64 fonts for Google Fonts, wired real CTAs + live stats.
- **`/docs` (server-only):** static, brand-consistent developer reference (`renderDocs()` in `server/landing.js`); landing footer links to it.
- **Durable feed + rooms (T9) — shipped & live.** `server/store.js` backs the Transmission Feed + Practice Rooms with **Redis (Upstash on Fly: `gateway-protocol-redis`, iad, pay-as-you-go, eviction disabled)**, activated by the `REDIS_URL` Fly secret. Graceful fallback to in-memory if `REDIS_URL` is unset/unreachable. Rehydrates on boot; a rehydrated room promotes the first reconnecting client to host. Verified in prod: a transmission survived a full `fly apps restart`. **Note:** the `redis` dep is a *production* dep (Docker uses `npm ci --omit=dev`), and `REDIS_URL` was created with the `expect` script `/tmp/provision_redis.exp` because `fly redis create`'s ProdPack prompt can't be answered non-interactively.
- **Docs & continuity:** root `package.json` now has the real project description (version synced to 3.3.5); `README.md` refreshed from desktop-only/V6 framing to the three-surface reality (live links, 4-platform release matrix, V7 changelog). **This `CLAUDE.md` is the cross-session context key** (auto-loaded by Claude Code); a private memory store at `~/.claude/projects/-Users-arturomorales/memory/` holds Arturo's working preferences. Browser recall needs a one-time paste of this file into a claude.ai Project.
- **Recent PRs (all merged to main):** #61 cinematic alignment (v3.3.5) · #62 landing redesign · #63 /docs · #64 CLAUDE.md · #65 README+description · #66 Next-up · #67 snapshot · #68 durable rooms+feed (Redis). No work left in-flight as of this snapshot.
- **V6 roadmap (`V6_ROADMAP.md`):** T1–T9 shipped except T3 = **NO-GO** (MediaPipe facial-affect, to preserve the strict CSP — see `MEDIAPIPE_CSP_MEMO.md`). T8 modularization paused at a clean milestone. esbuild bundler = **DEFER** (`ESBUILD_BUNDLER_MEMO.md`).
## Next up (open threads) — read this first to know what's pending
**Owner-gated — need Arturo's decision or a real-world action (don't just execute):**
- **esbuild bundler** — recommended **DEFER** (`ESBUILD_BUNDLER_MEMO.md`). If pursued: minify-only (Option B) first, then full ES modules. No CSP change.
- **Code-signing (T7)** — desktop builds are **unsigned**; users get an "unverified developer" prompt. Needs a paid Apple Developer cert (~$99/yr) + a Windows cert — a purchase only Arturo can make. Once they exist, wire signing + notarization into the release matrix.

**Ready to execute when Arturo says go (no decision needed):**
- Any visual polish on the new landing / `/docs` he flags after reviewing.
- Optional: re-run the Codex audit on the new `server/landing.js` + `/docs` for a fresh grade.

**Continuity housekeeping:**
- Keep the **Current state** + this **Next up** section updated after each shipped change.
- Browser recall is not automatic — Arturo pastes `CLAUDE.md` into a claude.ai Project once for the browser to "remember."

## Architecture essentials
- **Renderer** (`electron-app/renderer/`): one big `index.html` + a 4-file classic-script chain loaded in order: `app-data.js` → `app-visuals.js` → `app-affect.js` → `app.js` (globals resolve at runtime). Strict CSP: `script-src 'self'` (NO unsafe-inline, NO wasm) — a hard constraint, preserved. Events go through a delegated dispatcher (`GP_ACTIONS` + `data-act`/`data-arg`/`data-id`), not inline handlers.
- **Server** (`server/practice-room.js`): CORS allow-list (`corsOrigin()`), per-IP rate limits, WS DoS hardening (maxPayload, room/client caps, heartbeat), upstream timeout/size caps. Landing + docs imported from `server/landing.js`; the landing's single inline script is **hash-pinned in the CSP** (`LANDING_SCRIPT` is exported verbatim so the sha256 matches the served bytes).
- **Desktop main** (`electron-app/main.js`): `safeStorage` vault, `openExternalSafe`, `httpsPost` with timeout + size cap. `preload.js` exposes set/has only (never get) for secrets.
- **CI** (`.github/workflows/ci.yml`): `node --check` the 4 renderer files + `scripts/a11y-lint.mjs` (static WCAG) + `scripts/perf-budget.mjs` (file-size ceilings). **Release** (`release.yml`): 4-platform Forge matrix; macOS x64 is cross-built on macos-14 (Apple Silicon) to dodge the Intel queue.

## Release / deploy workflow
- **Server-only change** (landing, docs, server logic that doesn't touch the renderer): just `cd server && npm run deploy` (Fly). **Do NOT bump the version** — `server/version.json` drives the desktop update banner, so bumping it for a server-only change would prompt every user to "update" for nothing.
- **Renderer / desktop change:** bump **both** `electron-app/package.json` and `server/version.json` to the same version, commit, deploy server (updates the hosted PWA), then `git tag vX.Y.Z && git push origin vX.Y.Z` to trigger the desktop release build. **Verify both version files are in the commit AND on main before tagging** (a past bug shipped a half-baked branch with only one bumped).
- Standard flow: branch → commit → PR → wait for CI → `gh pr merge --merge --delete-branch` → checkout main + pull → deploy/tag.
- Commit messages with backticks/`'self'` break heredoc eval → use `git commit -F /dev/stdin <<'EOF'`.

## Working preferences (Arturo)
- **Autonomy:** "Never ask me again if I want to proceed — I'll always say yes and I can't be at the computer to wait. Just get everything done." Proceed without confirmation; pick the best option for an A+ result. (Still confirm genuinely irreversible/outward-facing actions.)
- **Docs/prompts for use elsewhere:** when asked to *write* a prompt or doc, deliver it **in chat by default; do not commit it** unless asked. (Auto-committed a marketing asset once — was the wrong call.)
- Goal framing: "the most wonderful app ever created for its purpose" — A+ quality bar.

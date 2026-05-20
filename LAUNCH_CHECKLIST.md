# Launch Checklist

This is what stands between today's V7 codebase and "Gateway Protocol is a real product real humans can sign up for." Items marked ✅ are done. Items marked 🟡 require **your** decisions and external resources. Items marked 🔴 are hard dependencies on infrastructure, legal, or business setup I cannot do autonomously.

This file is **not** a status report — it's the gap analysis.

---

## 0 · What V7 actually ships

What you can do **today, locally**, with V7 fully in place:

- ✅ All V1–V6 features (waves, sessions, Council, cinematic, IndexedDB, etc.)
- ✅ Custom Protocol Builder — compose, save, run, export, import (V7f)
- ✅ Gateway Institute certifications — 4 tracks, signed-JSON + printable PDF (V7e)
- ✅ Biometric HRV tracking — manual entry, 7-day rolling delta (V7d)
- ✅ Semantic journal memory — embeddings via OpenAI, top-K retrieval before each Council call (V7c)
- ✅ Practice Rooms — works **end-to-end** against the reference server in `/server` running on `localhost:7070` (V7a)
- ✅ Transmission Feed — works **end-to-end** against the same local server (V7b)

What requires **deployment + decisions** to be globally available:

- 🟡 Practice Rooms accessible across the internet (need a hosted server)
- 🟡 Transmission Feed accessible across the internet (same server)
- 🔴 100+ concurrent room participants (needs Redis + multi-region + load test)

---

## 1 · Infrastructure (Practice Rooms + Feed)

### 1a · Pick a hosting platform 🟡

Recommended (in order of fit for a WebSocket-heavy workload):

| Platform | Pros | Cons | Monthly cost (est.) |
|---|---|---|---|
| **Fly.io** | Global edge, WS-native, simple Dockerfile, generous free tier | Cold-start on free tier | $0–$30 for early users |
| **Render** | Easy deploy, predictable pricing | Free tier sleeps (kills WS) — needs paid Starter ($7/mo min) | $7–$25 |
| **Railway** | Great DX | Pricing scales fast with traffic | $5–$30 |
| **DigitalOcean App Platform** | Familiar | Less elegant for WS persistence | $5–$15 |

**My recommendation:** **Fly.io**. It's the only one of these that's actually designed for stateful WebSocket workloads at global edge. The reference Dockerfile in `server/README.md` deploys there in one `fly deploy` command.

### 1b · Domain + TLS 🟡

You'll want `wss://api.gatewayprotocol.app/` or similar. Fly issues TLS certs automatically once you add a custom domain (`fly certs add`). Domain itself ~$12/yr at Cloudflare.

### 1c · Production-grade state 🔴

The reference server uses **in-memory state**. That's fine for ≤a few hundred concurrent rooms. Beyond that you'll hit:

- **Multi-instance:** Rooms on different machines can't see each other. Fix: Redis Pub/Sub for room broadcasts + sticky sessions at the LB.
- **Restart wipes everything:** Every deploy kills active rooms. Fix: Redis persists room state across restarts.
- **No moderation queue:** Spam in the feed has nowhere to go. Fix: Postgres for the feed + a takedown table + a tiny admin UI.

Estimated work to add Redis + Postgres + sticky sessions: **2–3 days** of focused work. Tracked in `TODO.md`.

### 1d · Rate limiting + abuse 🔴

Currently zero rate limits. Easy first-pass: `express-rate-limit` (would require migrating the server from raw `http` to Express, ~1 hour). Per-IP limits of 10 feed posts/hour and 5 room creates/hour would block most casual abuse.

### 1e · Load test 🔴

Tool: [Artillery.io](https://www.artillery.io/) with WebSocket scenarios. Target: 100 concurrent rooms × 10 participants each = 1,000 concurrent connections, sustained for 30 min. Not done yet because the server isn't deployed.

---

## 2 · Legal

### 2a · Privacy Policy 🟡

Draft at `DRAFT_PRIVACY.md` — **clearly marked as non-binding draft**. Before launching to real users:

1. Have a lawyer review (a privacy-specialist attorney; ~$1k–$3k for a starter SaaS policy)
2. Make sure the draft accurately reflects what your hosted server actually does (data flows, retention, third parties)
3. Add a `Privacy` link in the app's footer (currently no footer — add one)

**Specific concerns for this app:**
- Journal entries contain spiritual/mental content — a higher sensitivity class than typical SaaS data
- The Transmission Feed publishes user-generated content publicly — content moderation policy required
- API keys (OpenAI/Anthropic/ElevenLabs) live encrypted on user machines, NOT on your servers — say so explicitly, it's a differentiator
- Anthropic / OpenAI / ElevenLabs are third-party processors when their APIs are called — list them

### 2b · Terms of Service 🟡

Same lawyer pass. Key clauses:
- This is not medical or mental health advice
- The Council is a creative AI synthesis, not real Monroe/Lipton/Dispenza/Tesla/Jung
- User-generated transmissions and protocols: user retains copyright, grants the platform a license to display
- Liability cap (especially given the meditative / state-altering nature of the practice)

### 2c · GDPR compliance 🟡

If you take a single EU user, GDPR applies. Minimum to satisfy:
- Lawful basis for each data category (likely "consent" for the feed, "contract" for app function)
- Right to access (export already exists — V5e)
- Right to erasure (the Reset button + a server-side "delete my feed entries" endpoint — **not built yet**)
- Data processing addendum with each subprocessor (OpenAI/Anthropic/ElevenLabs have public DPAs)
- DPO not required unless processing at scale, but good hygiene

Add a `DELETE /feed/by-fingerprint/:hash` endpoint that lets a user purge their contributions. Currently the feed is fully anonymous so this requires a per-user client-side fingerprint stored locally. **Not built yet.**

### 2d · App Store distribution 🟡

If you ever want to ship through the Mac App Store:
- Sandbox-compatible (currently `sandbox:false` for electron-store — need to verify alternate flow)
- Code signing (Apple Developer Program, $99/yr)
- Notarization
- App Store review (which may flag the meditative/biometric claims)

Or stay outside the App Store and distribute the `.dmg` directly with notarization. Much simpler.

### 2e · Trademark / brand 🟡

"Gateway" is potentially trademarked by The Monroe Institute. Check before commercial launch. May need to rename or get a license. Worth a $500 trademark search through a paralegal service before printing T-shirts.

---

## 3 · Monetization (see MONETIZATION.md for the strategy)

### 3a · Stripe account 🟡

If you go with a paid tier (recommended for the hosted Council to subsidize Anthropic costs), you need a Stripe account + business entity. Stripe Connect if you ever do creator revenue share for the marketplace.

### 3b · Business entity 🟡

LLC or C-corp depending on funding plans. ~$500 + a registered agent.

### 3c · Banking + accounting 🟡

Mercury for SaaS-friendly banking, Pilot or a part-time bookkeeper for first year.

---

## 4 · Apps you might want eventually

### 4a · iOS companion (HealthKit live read) 🔴

The biggest user-visible gap. Apple HealthKit is iOS-only. To get **live** HRV from an Apple Watch into Gateway Protocol, you need:

1. A separate iOS app (SwiftUI, ~3 weeks of focused work for an MVP)
2. iCloud sync OR a shared backend OR a peer-to-peer LAN bridge to ferry HRV data into the Mac app

Out of scope here. Currently V7d does manual HRV entry — accurate but not live.

### 4b · Native Mac arm64 build 🟡

Trivial change to `forge.config.js`. Worth doing before broader distribution.

### 4c · Windows + Linux 🟡

Forge supports `maker-squirrel` (Windows) and `maker-deb` / `maker-rpm` (Linux). Add when you have non-Mac users requesting it.

### 4d · Hosted Council ("Gateway Cloud") 🟡

Today: user brings their own Anthropic key. A paid tier could offer "no keys needed, we handle the API" — the user pays a flat monthly fee, you absorb Anthropic costs and take margin. See MONETIZATION.md for math.

---

## 5 · Pre-launch checklist (the one you actually run before going live)

- [ ] Hosted server deployed at `wss://your-domain.tld/`
- [ ] Server has rate limiting + ALLOW_ORIGIN locked down
- [ ] Privacy policy + ToS hosted at stable URLs
- [ ] In-app links to both visible in Settings
- [ ] Apple Developer signing + notarization on the .dmg
- [ ] arm64 native build alongside x64
- [ ] One-click distribution: GitHub Releases page is curated and clean
- [ ] Backup strategy for hosted feed (Postgres daily dumps to S3)
- [ ] Status page (statuspage.io or just a static page) so users know if the server is down
- [ ] Support email or Discord (decide which)
- [ ] At least one load test run (Artillery, 1k concurrent, 30min sustained)
- [ ] Trademark check completed
- [ ] Stripe live mode if monetizing
- [ ] Analytics (privacy-respecting: Plausible or Fathom — NOT Google Analytics)
- [ ] Crash reporting (Sentry self-hosted or skip — your call)
- [ ] First 10 hand-picked users invited to test before public

---

## 6 · What I'd do first if I had a week

If you had 40 hours and wanted to get this to "real beta launch":

1. **Day 1:** `fly deploy` the reference server. Set up domain + TLS. Confirm Practice Rooms work across the internet from your Mac to a friend's Mac.
2. **Day 2:** Add Redis + Pub/Sub to the server (so it survives restarts and can scale to 2+ machines). Add rate limiting.
3. **Day 3:** Draft privacy + terms (use a template like [Termly](https://termly.io) or [GetTerms](https://getterms.io) for $50 — not a substitute for a lawyer but enough for a beta).
4. **Day 4:** Apple Developer signing + arm64 build + new Release.
5. **Day 5:** Artillery load test, fix anything that breaks. Add status page.
6. **Day 6:** Invite 10 trusted practitioners. Watch the logs. Fix what hurts.
7. **Day 7:** Decide based on real usage: hosted Council? Marketplace? Subscription?

The point: this is **buildable**. Everything in this file is concrete. None of it is "we'd need a research breakthrough." It's just work + a credit card.

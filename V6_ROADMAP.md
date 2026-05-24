# V6 — "The Attuned Companion: Adaptive, Embodied, State-of-the-Art"

> **Naming note.** This is the next **UI/UX + experience** track
> (`V3_ROADMAP.md` → `V4_ROADMAP.md` → `V5_ROADMAP.md` → this). It builds
> directly on what shipped in **v3.2.0** (the A+ experience update). Nothing
> here is shipped yet.

**Theme: the app stops *collecting* signals and starts *attuning* to them —
turning the on-device affect layer into a living, adaptive companion, with the
craft (design system, accessibility, performance, trust) of a state-of-the-art
platform.**

The throughline: readable (V1/V2) → immersive + adaptive (V3) → embodied,
everywhere (V4) → responsive + collective (V5) → **attuned + crafted (V6)**.

## What v3.2.0 already shipped (the foundation V6 builds on)
- **Today dashboard** + core-loop navigation; **guided first-run setup**.
- **Mood check-in** + **intent presets**; folded into the Council's
  pre-session recommendation.
- **On-device affect layer (MVP)** — consent-gated **voice** (Web Audio:
  energy/pitch/pace) and **camera stillness/presence** (frame differencing),
  feeding a derived **biofield visualization** and the Council. Nothing is
  recorded, stored, or sent; only confirmed derived numbers persist.
- **Accessibility pass** (focus rings, keyboard-activatable controls,
  `aria-live` regions, modal focus trap), **unified async-state pattern**
  (`GP_ASYNC`), and **launch resilience** (no-WebGL fallback).

V6 turns these MVPs into the headline experience and raises the surrounding
craft to A+.

---

## V6 priorities (in order)

### T1 · Adaptive Practice Engine 2.0 🔴 headline
The signals we now collect (mood, voice, stillness, journal patterns) become a
**transparent recommender** that drives the session, not just a banner.
- Fuse the latest mood + voice + camera + recent journal into one **state
  vector** (valence / arousal / coherence) — the biofield already computes a
  first version of this; promote it to a shared model.
- Recommendations carry a **"because…"** rationale ("because your voice read
  low-energy and you reported foggy, try a short activation at 417 Hz").
- One tap **auto-configures** session + breath + frequency + ambient from the
  recommendation (extends the intent presets).
- **Honest by design:** every input is labeled measured / self-reported /
  interpretive; the user can always override.

**Effort:** large. **Depends on:** v3.2.0 affect layer (done). **Risk:** medium
— must feel insightful, never presumptuous.

### T2 · Live in-session biofeedback 🟢 lead with this
Today the affect check-ins happen *before* practice. Move them *into* it.
- The biofield + breath pacer run **during** a session, responding to live
  signals (camera stillness and/or breath cadence; optional voice between
  phases), entirely on-device.
- A felt **"coherence bloom"** when stillness/steadiness is sustained; gentle
  re-centering when it isn't.
- Session phases can **stretch/shorten** to meet the practitioner's actual
  state instead of a fixed clock (opt-in).

**Effort:** medium–large. **Depends on:** T1 state model. **Risk:** medium —
must be subtle, not twitchy; strict reduced-motion + opt-out.

### T3 · Facial affect, done right (the deferred ML) 🟡
v3.2.0 deliberately shipped frame-differencing stillness instead of facial-affect
ML. V6 does the ML properly:
- **Vendor MediaPipe FaceLandmarker** as bundled WASM + model assets under the
  existing `script-src 'self'` CSP (no CDN); add `/face-landmarker.*` to the
  server static-route allowlist for the hosted build.
- On-device head pose, blink, gaze, and coarse valence/arousal — **strong
  disclaimers**, "visible signals suggest…" framing, never "you feel…".
- Optional **rPPG** (camera pulse → HRV proxy) framed honestly as an estimate.
- **Real-device test matrix** (this can't be validated headless).

**Effort:** large. **Risk:** high (accuracy, ethics, asset size, device
testing). Gate behind explicit consent + clear value.

### T4 · Insight & memory 🟢
Make the accumulating data *legible*.
- **Semantic journal timeline/map** — recurring themes, breakthroughs, and
  emotional arc over time (uses the existing embeddings).
- **Signal trends** — mood / voice-energy / stillness over weeks, shown as
  reflective mirrors (not scores).
- A longitudinal **coherence-arc** dashboard.

**Effort:** medium. **Depends on:** existing embeddings + the new affect data.

### T5 · Design system & craft 🟢
Raise visual/interaction craft to state-of-the-art.
- Extract **design tokens** (spacing, type scale, surfaces, state colors) and a
  small **component layer**; retire ad-hoc inline styles.
- A **command palette (⌘K)** for fast navigation + actions.
- Motion language pass; optional **theme variants** (e.g., a lighter "sanctuary"
  mode) on top of the dark field.
- **Evidence-vs-interpretation labels** + info tooltips across all claims
  (HRV, frequencies, Council, feed) — the audit's copy recommendation.

**Effort:** medium. **Risk:** low; high polish payoff.

### T6 · Accessibility to AA/AAA-grade ♿
Build on the v3.2.0 a11y pass to a full standard.
- Full **WCAG 2.2 AA audit** + automated **axe** checks in CI (extends the
  existing parse-check workflow).
- Complete input labeling, reduced-motion review of *every* animation, a
  screen-reader pass on each screen.
- **i18n scaffolding** (string extraction) for future localization.

**Effort:** medium. **Risk:** low; broadens reach.

### T7 · Platform & trust 🔒
Remove the friction and risk of an unsigned local app.
- **macOS Developer ID signing + notarization**; **Windows Authenticode**
  (replaces the ad-hoc/SmartScreen warnings — see `TODO.md`).
- Real **auto-update** (electron-updater) once signed, replacing the manual
  /download banner.
- **Data portability**: export/import all data (incl. the new affect history)
  and a one-tap **delete-all** for biometric-derived data.
- Offline-first **PWA** polish for the hosted build.

**Effort:** large (signing is paid + procedural). **Risk:** medium.

### T8 · Performance & maintainability ⚙️
The renderer is now a ~280 KB single `app.js` + one large `index.html`.
- **Modularize** into ES modules + a light bundler step; lazy-load heavy
  screens/canvases (Three field, biofield, MediaPipe).
- **CSS containment** on large panels; a **performance budget** check in CI.
- Split the giant `index.html` template into per-screen partials at build time.

**Effort:** large. **Risk:** medium (touches everything — do incrementally
behind tests).

### T9 · Community depth 🌐
Deepen the collective layer (V5's thread).
- **Practice Rooms**: scheduled group sits, richer presence, host controls.
- **Transmission Feed**: curation + lightweight moderation.
- Opt-in **collective biofield** — an anonymized "the field tonight" view.

**Effort:** medium–large. **Depends on:** server state → Redis for multi-machine
(see `server/MOBILE.md`).

---

## Recommended sequence (next 3 increments)
1. **T1 — Adaptive Practice Engine 2.0** (headline; leverages everything just
   shipped, no new deps).
2. **T5 — Design tokens + command palette** (high polish, low risk, makes every
   later screen cheaper to build).
3. **T6 — axe-in-CI + WCAG 2.2 AA audit** (locks in the a11y gains and prevents
   regressions).

Then **T2** (live biofeedback) and **T4** (insight/memory), which both build on
the T1 state model. **T3** (facial ML) and **T7** (signing) are larger, gated
efforts to schedule once the above land.

## Guardrails (carry forward from the audit + v3.2.0)
- **On-device, consent-gated, nothing stored or sent** for all affect signals.
- **Honest framing** — measured vs. self-reported vs. interpretive; never claim
  to measure an aura or diagnose emotion.
- **CSP stays `script-src 'self'`** — bundle, don't CDN (drives T3's vendoring).
- Every increment ships as its own reviewed PR with green CI and a boot smoke
  test; renderer changes deploy to web + the next desktop release.

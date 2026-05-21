# V4 UX/UI — Roadmap & Status

**Theme: Spatial & Embodied, Everywhere.**

The throughline so far: **V1/V2 made it readable → V3 made it immersive and
adaptive → V4 makes it spatial and cross-platform.** V3 shipped the immersive
field, adaptive atmosphere, cinematic mode, and the first living-data visual
(the Consciousness Signature), and left an honest deferred list (see
`V3_ROADMAP.md §Deferred`). V4 picks up exactly those threads and adds a second
axis the project didn't have when V3 was written: a **deployed BYOK web PWA**
(see `server/MOBILE.md`). So V4 is two movements at once — finish making the
interface *spatial*, and make the whole experience *native on a phone*.

This doc tracks intent + status honestly. Nothing here is shipped yet.

---

## Foundation already in place (entering V4)

These landed before/around V4 kickoff and are what V4 builds on:

| Piece | Where | Status |
|---|---|---|
| BYOK web transport (`/byok/*`) | `electron-app/renderer/index.html` · `server/practice-room.js` | ✅ Shipped |
| Unified **API Keys** in Settings (synced) | renderer Settings screen | ✅ Shipped |
| Responsive layout pass (phone viewports) | renderer `@media(max-width:600px)` | ✅ Shipped — the *floor* V4 builds the ceiling on |
| Field Quality auto-Low on mobile GPUs | `THREE_FIELD.init` / `VISUALS.init` | ✅ Shipped |
| Orbital nav (CSS-3D prototype, flagged) | `ORBITAL` module | ✅ Shipped (experimental) |
| Consciousness Signature (living data v1) | Progress screen | ✅ Shipped |

---

## V4 priorities (in order)

### T1 · Shared-element screen morphs — View Transitions API 🟢 lead with this
**Highest polish-per-effort.** A wave card *morphs into* the session screen
(shared-element transition) instead of the current cross-fade. The renderer
already wraps navigation in `document.startViewTransition()` (V3 second wave) —
this extends it from a soft cross-fade to true shared-element morphs by tagging
the source/target elements with `view-transition-name`. Modern Chromium
(Electron) + recent mobile Safari/Chrome support it; reduced-motion + no-API
fallbacks stay. **Effort:** contained. **Risk:** low.

### T2 · Full living data 🟢 contained, high-signal
Extend the Signature approach to two more generative visuals:
- **Monthly patterns** → a constellation of recurring themes over time (size =
  recurrence, links = co-occurrence), fed by the existing `gp:monthly-patterns`
  / BYOK Council call.
- **Synchronicity map** → a timeline/radial field of events (the Synchronicity
  Field canvas from V3 is the seed; V4 makes it narrative — clusters labeled,
  the field "message" surfaced inline).
**Effort:** moderate (data modeling + canvas/WebGL per visual). **Risk:** low.

### T3 · Torus IS the navigation (full WebGL) 🔴 headline, multi-week
Promote orbital nav from the CSS-3D prototype to the real thing: section nodes
mapped onto the **actual Three.js torus geometry**, WebGL raycasting for clicks,
camera fly-through choreography between sections, depth-sorted occlusion. Keep
the flat nav as the accessible default and a screen-reader path; promotion to
default is a usability bet to make with real user feedback, not a rushed swap.
**Effort:** weeks. **Risk:** medium-high (raycasting + camera + a11y fallback).
This is the "the interface *is* the field" moment — give it its own focused build.

### T4 · Adaptive atmosphere → full sensory environment 🔴 multi-week
V3's T2 attunes color + resonance at open and eases the field during a session.
V4 adds a proper **state→environment mapping layer** that also drives particle
density, camera behavior, and ambient layering, and shifts *between* atmospheres
as the practitioner moves through a session — tuned so it's felt, not gimmicky.
**Effort:** weeks (mapping layer + careful tuning). **Risk:** medium.

### T5 · Mobile-native UX + embodiment 🟡 the new axis
The responsive pass is the floor; this is the rest of being a real phone app:
- **PWA install** — `manifest.webmanifest` + service worker (cache-first shell +
  `three.min.js`/fonts, network-only for `/byok/*`), install prompt. *(Spec in
  `server/MOBILE.md §3`; serve from `server/`.)*
- **iOS audio gate** — a "tap to begin" gesture before any AudioContext start
  (Solfeggio, binaural, Field Resonance), since iOS blocks autoplay. *(`§4`)*
- **Touch gestures** — swipe between sections, pull-to-refresh the feed.
- **Haptics synced to breath** — pulses on inhale/exhale. Really wants the **iOS
  companion app**, which *also* unlocks HealthKit live HRV (replacing manual
  entry) — so build them together.
**Effort:** PWA + audio gate are contained; haptics/HealthKit need the iOS
companion (large). **Risk:** the companion app is its own project.

---

## Suggested build order

1. **T1 — View Transitions shared-element morphs** (fast, high polish).
2. **T2 — Full living data** (monthly patterns + synchronicity map).
3. **T5a — PWA install + iOS audio gate** (ships the web PWA for real; small).
4. **T4 — Adaptive atmosphere v3** (sensory environment mapping).
5. **T3 — Torus navigation (full WebGL)** (headline; dedicated build).
6. **T5b — iOS companion** (haptics + HealthKit live HRV, together).

**The honest framing:** T1, T2, and T5a are the high-leverage contained wins to
lead with. T3, T4, and the iOS companion are each multi-week efforts — V4 is
where "spatial" and "embodied" earn their own focused builds, not rushed
bolt-ons. The throughline holds: readable → immersive → **spatial, on every
device you carry.**

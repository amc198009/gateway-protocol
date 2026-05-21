# V3 UX/UI — Roadmap & Status

The V3 vision was "the interface becomes the practice" — the UI stops being a dashboard you operate and becomes an environment you inhabit. This tracks what shipped vs. what's deferred, honestly.

## ✅ Shipped

| # | Feature | What it does |
|---|---|---|
| T1 | **Field Resonance** + polish | Generative ambient drone coupled to the field — pitch tracks frequency, swells with breath, deepens in cinematic, ducks during sessions. Presence slider + 3rd harmonic. Off by default. |
| T2 | **Adaptive Atmosphere** | On open + when a Council recommendation arrives, the field color/intensity + resonance pitch attune to your Council reading, HRV trend, and code of the day. Subtle "Today's field" indicator. |
| T3 | **Spatial depth** | `:has()` depth-of-field — opening a wave card recedes siblings + calms the field; open-card lift; hover micro-lift. Reduced-motion aware. |
| T4 | **Ritual arrival** | Skippable launch sequence: arrive → guided breath → set one intention (seeds the journal). "Don't show again" persists. |
| T5 | **Focus mode + earned minimalism** | `f` / ◎ button strips chrome to the practice. `body[data-tier]` quiets the hero as you advance (tier 4 = bare field + content). |
| T6 | **Consciousness Signature** | Living-data mandala on the Progress screen, generated from your waves/sessions/journal/HRV/frequency. Evolves as you do. |

## ✅ Shipped — second wave (the previously-deferred items)

| Feature | What it does |
|---|---|
| **View Transitions** | Screen navigation wrapped in `document.startViewTransition()` — a soft cross-fade + lift between screens instead of an instant swap. Reduced-motion + no-API fallbacks. |
| **Living data: Synchronicity Field** | A generative canvas plotting every sync by time-of-day (angle) and recency (radius), with faint lines linking temporal clusters and a soft twinkle. Renders on the Synchronicity screen. |
| **Adaptive Atmosphere v2** | The atmosphere now evolves *during* a session, not just at open: the field calms and refines (intensity + particle size ease down) as the practitioner descends through the session, then restores on end/pause/reset. |
| **Orbital navigation (experimental)** | Opt-in 3D ring of section nodes floating over the field (Settings → Visuals → enable, press **O**). Drag or ← → to rotate, click a node to navigate. The flat nav stays the default. A CSS-3D carousel prototype — see note below on the full WebGL version. |

## 🟡 Deferred — genuinely large, honest about why

### Living data (fuller version)
The Consciousness Signature is the first instance. The full vision renders the **monthly patterns** and **synchronicity map** as generative visuals too — a constellation of your themes over time, a timeline of field events. **Why deferred:** each is a substantial viz project (data modeling + canvas/WebGL work). The signature proves the pattern; extending it is incremental.

### Adaptive atmosphere → full sensory environment
T2 attunes color + resonance. The fuller version also drives **particle density, camera behavior, and ambient layering** from state, and shifts **between** atmospheres as you move through a session (not just at open). **Why deferred:** needs a proper state→environment mapping layer and careful tuning so it's felt, not gimmicky. T2 is the foundation it builds on.

### 🟡 The torus IS the navigation — prototype shipped, full version still ahead
The **Orbital navigation** above is the prototype: an opt-in CSS-3D carousel of section nodes over the field, behind a flag, with the flat nav kept as default. It delivers the *feel* of navigating through space.

The **full** version — nodes mapped onto the actual Three.js torus geometry with WebGL raycasting for clicks, camera fly-through choreography, and depth-sorted occlusion — is still a dedicated effort. **Why still deferred:** raycasting + camera choreography + a screen-reader-accessible fallback is weeks of careful work, and the CSS-3D prototype already covers the experience for anyone who wants it. Promoting it from "experimental flag" to "default nav" is a usability bet to make with real user feedback, not a rushed swap.

### 🔴 Touch & haptics
Trackpad Force Touch + haptic pulses synced to breath. **Why deferred:** Electron's haptic access on macOS is limited/private-API territory; reliable haptics really want the **iOS companion app** (also deferred — see `LAUNCH_CHECKLIST.md §4a`). Not buildable well from the desktop renderer today.

### Shared-element screen transitions
T3 added depth-of-field + lifts. The fuller version: a wave card **morphs into** the session screen (shared-element transition) rather than a cross-fade. **Why deferred:** the renderer uses `display:none` screen swaps; true shared-element transitions need either the View Transitions API (some Chromium support — worth a spike) or a hand-rolled FLIP animation layer. A contained next step, not a blocker.

## Suggested next order

1. **View Transitions API spike** — modern Chromium (Electron 33) supports `document.startViewTransition()`. Could deliver shared-element screen morphs with relatively little code. Highest polish-per-effort.
2. **Full living data** — extend the Signature approach to monthly patterns + synchronicities.
3. **Adaptive atmosphere v2** — mid-session atmosphere shifts + particle density.
4. **Torus navigation** — dedicated prototype behind a feature flag, with a 2D fallback kept as default until it's genuinely better.
5. **iOS companion** — unlocks HealthKit live HRV *and* haptics together.

The throughline holds: V1/V2 made it readable; V3 (shipped) made it immersive and adaptive; the deferred items make it *spatial* — and that last leap deserves its own focused build, not a rushed bolt-on.

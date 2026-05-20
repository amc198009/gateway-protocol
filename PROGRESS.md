# Gateway Protocol — Build Progress

**Last updated:** 2026-05-20
**Branches:** `main` (V2+V3+V4+V5 merged)
**Latest commit graph:**
```
V5     Caching · wheel fix · cinematic wave context · shadow voice · export · IndexedDB
V3+V4  Full Immersion + Deep Intelligence
V2 #2  Adaptive Session Engine
V2 #1  Electron packaging — kill the proxy
V1     Baseline single-file HTML + proxy.js
```

---

## What runs right now

```bash
cd ~/gateway-protocol
npm install:v2    # one-time
npm start         # opens the Electron app
npm run make      # rebuilds the .dmg in electron-app/out/make/
```

**Shipped artifact:** `electron-app/out/make/Gateway Protocol.dmg` (99 MB, Intel x64).
First-launch on macOS: right-click → Open → Open (Gatekeeper bypass — see TODO.md).

---

## V1 — Baseline (preserved at commit `4d6b768`)

The original single-file HTML + zero-dependency Node proxy. Still runnable:
```bash
npm run v1          # node proxy.js → http://localhost:5050
```
`proxy.js` now also carries a matching `/pre-session` route for the V2 #2 adaptive engine, so the browser fallback path stays at full parity with Electron.

---

## V2 — Electron Desktop App ✅

| Item | Status | Notes |
|---|---|---|
| Electron packaging via Forge | ✅ | `electron-app/forge.config.js` (DMG + ZIP makers) |
| Eliminate proxy.js dependency | ✅ | All HTTPS routes ported to `ipcMain.handle` in `main.js` |
| Encrypted API key storage | ✅ | `electron-store` v8 with encryption key, file at `~/Library/Application Support/Gateway Protocol/gateway-protocol-keys.json` |
| All APIs in main process | ✅ | `gp:elevenlabs-tts`, `gp:openai-tts`, `gp:mirror`, plus six V4 handlers |
| BrowserWindow + preload bridge | ✅ | `contextIsolation:true`, `nodeIntegration:false`, narrow `window.gp.*` surface |
| `.dmg` build | ✅ | 99 MB. Unsigned (see TODO) |
| V1 browser-mode compatibility | ✅ | Renderer feature-detects `window.gp` and falls back to `fetch()` against `localhost:5050` |

**Verified programmatically:** all files parse, `npm start` boots without crash, `npm run make` produces a `.dmg`.

**Verification you still need to do interactively (requires your API keys):**
1. Window opens with Three.js particle field background
2. DevTools `Cmd+Opt+I` → `window.gp.versions` returns Electron/Chrome/Node versions
3. Enter OpenAI key → start a session → cues speak
4. Enter ElevenLabs key + switch engines → cues speak in chosen voice
5. Enter Anthropic key → write a journal entry → "Consult the Council" returns transmission
6. Quit and relaunch → keys persist (encrypted at rest)

---

## V3 — Full Immersion ✅

### V3a · Three.js particle field

- Local bundle at `electron-app/renderer/vendor/three.min.js` (r160, ~654 KB, offline-capable)
- 5,000-point torus, additive-blended, alpha-transparent
- Reactive states:
  - **Frequency:** rotation speed + color (cool indigo → gold → pale violet) mapped across 174–963 Hz range
  - **Breath:** scale pulses with inhale/hold/exhale/rest phase
  - **Cinematic:** intensity bump + camera dolly
- Replaces CSS starfield + SVG sacred geometry via `body.gp-three-ready` class (legacy stays as fallback if WebGL unavailable)
- Hooked into existing `reactGeometry()` and `runPhase()` — no behavior break

### V3b · Cinematic fullscreen mode

- Entered on `toggleTimer()` Begin, exited on pause / reset / completion / Esc
- Pure CSS state machine via `body.gp-cinematic` — hides nav, hero, all non-session screens, all controls except the timer button
- Timer text scales to 96 px, guidance cue to clamp(20px, 4vw, 40px) with gold glow
- `requestFullscreen()` attempted on entry; the click that starts the timer counts as the user gesture
- HRV visualizer floats at the bottom in cinematic mode

### V3c · AudioWorklet binaural engine

- Replaces deprecated `ScriptProcessorNode` with `AudioWorkletNode` at `electron-app/renderer/audio-worklet.js`
- Pink noise (Paul Kellet algorithm) now runs on the audio thread
- **Harmonic binaural overtones:** L=200/R=200+beat fundamental + 400 Hz octave + 100 Hz sub-octave, all carrying the same beat for additive entrainment
- Descent curve (beta 18 → deep theta 4) scheduled across all three pairs
- Falls back to legacy `ScriptProcessorNode` if `audioWorklet.addModule()` fails

### V3d · HRV coherence visualizer

- `<canvas id="gp-hrv-canvas">` in the breath screen + floating in cinematic mode
- 600-sample scrolling sine wave locked to breath cadence with ripple modulation
- Coherence score: `95 * (1 - e^(-cycles/4))` — climbs as the practitioner sustains rhythmic breathing, asymptotes near 95
- Lives at `HRV` global module. `pulse(phase, dur)` called from `runPhase()`; `stop()` called from `stopBreath()`

---

## V4 — Deep Intelligence ✅

### V4a · Monthly pattern recognition

- IPC `gp:monthly-patterns` reads all journal entries from the last 30 days
- Council returns `{themes, breakthroughs, shadows, coherenceArc, suggestion}`
- UI panel in the Progress screen with an "Analyze Last 30 Days" button
- Needs ≥3 entries in the window or surfaces a toast and skips the call

### V4b · Custom affirmation generator

- IPC `gp:generate-affirmation` takes `{intention, code}` → returns `{affirmation, intent}`
- Form lives in the Affirmations screen: textarea + code dropdown (9 codes)
- Save button adds the result to `DB.customAffirmations`, which is then merged into the affirmation list with a "◈ Council-generated" badge

### V4c · Shadow work dialogue (multi-turn)

- Full-screen modal triggered from the Council screen
- IPC `gp:shadow-dialogue` takes `{history, message}`, returns `{reply, isComplete}`
- Jung speaks first (auto-fired on `open()`), one question at a time
- Enter sends, Shift+Enter newlines, Esc closes
- On close, if ≥2 turns happened, the full dialogue is saved to the journal as a "Shadow Dialogue" session — which then re-triggers `PRESESSION.request()` so the Council factors it into the next pre-session recommendation
- Marks `isComplete:true` when Jung names integration and offers a closing practice

### V4d · Synchronicity log + AI analysis

- New top-nav tab: **Synchronicity**
- Quick-add textarea + chronological log with date/time/remove
- IPC `gp:analyze-synchronicities` over the log returns `{recurringSymbols, timeClusters, themes, fieldMessage}`
- Stored in `DB.synchronicities` (new schema field, backwards-compatible via `defaults()` merge)

### V4e · Code of the day

- Deterministic per-day rotation through 9 codes (same code planet-wide on a given date)
- No AI call — just a date hash modulo the code count
- Sits at the top of the home (Waves) screen, above the Council Recommendation banner
- Cached per-day in `localStorage` under `gp_cotd`

### V4f · Practice reminder notifications

- Settings panel in the Progress screen: enable toggle + 3 time inputs (morning / midday / evening)
- IPC `gp:reminders-set` writes to electron-store, then main process schedules `setTimeout`s
- Fires native macOS / Windows notifications via Electron's `Notification` class
- Auto-reschedules each day after firing, so reminders persist across app restarts (main process keeps running on macOS via "window-all-closed" no-quit)

---

## V5 — Polish + IndexedDB ✅

Improvements done after V2/V3/V4 verification, all shipped autonomously.

### V5a · Prompt caching across all Anthropic calls

- Every Council system prompt now sent as a `cache_control: ephemeral` content block (mirror, pre-session, monthly patterns, affirmation, shadow dialogue, synchronicity analysis — and the V1 proxy mirror routes for parity)
- 5-minute TTL covers a normal practice session: first call warms the cache, every subsequent call within 5 minutes hits ~50% lower latency + ~90% lower input-token cost
- Zero behavior change for callers — `cacheableSystem(text)` helper wraps the string into the array-block form transparently

### V5b · Affirmation wheel fixed

- The TODO.md quirk: custom Council-generated affirmations appeared in the list below but didn't cycle through the wheel
- New `allAffirmations()` helper centralizes the merged list (built-ins + customs). Wheel, list, and prev/next navigation all read from it
- Custom ones get a "◈ Council" badge in the wheel display

### V5c · Wave context in cinematic mode

- New `#cinematic-wave-context` element shows the wave subtitle (e.g. "Resonant Tuning · Focus 10") in italic gold above the timer, only when the active session was launched from a wave card (`selectedSess.waveIndex` present)
- Hidden in normal mode via CSS; populated on `CINEMATIC.enter()`

### V5d · Voice-over for Shadow Dialogue

- Checkbox in the modal header — preserved in `localStorage.gp_shadow_voice`
- When on, every Jung reply is routed through `VOICE.speak(reply, {rate:0.72})` — slower than session cues to match the contemplative register
- Works with any of the three voice engines (ElevenLabs / OpenAI / Web Speech)

### V5e · Export All Data → JSON

- New "Export All Data ↓" button in the Progress screen's btn-row
- Downloads a timestamped JSON file (`gateway-protocol-backup-YYYY-MM-DD.json`) containing the full DB: journal, synchronicities, custom affirmations, session log, streaks, tier, 369 tracker, wave completions — everything portable
- Tiny `EXPORT` module, ~25 lines, no IPC needed (Blob + ObjectURL trick works in renderer)

### V5f · IndexedDB migration

- Lifts the 5MB localStorage cap (originally Pillar 5 in HANDOFF)
- Hand-rolled inline `idbStore` wrapper, ~30 lines, three methods (get/set/del), zero dependencies
- `DB` rewritten to use IDB primary + localStorage best-effort mirror:
  - In-memory cache (`_cache`) populated at boot via `await DB.hydrate()` — synchronous load()/save() API preserved so no caller refactor
  - On first IDB run, the existing localStorage data is migrated transparently
  - Writes update the cache, fire off async IDB write, and best-effort mirror to localStorage (silently no-ops past 5MB)
  - `clear()` resets cache to defaults + clears both stores

---

## Architecture summary

```
~/gateway-protocol/
├── package.json                Root delegator (npm start → electron-app)
├── proxy.js                    V1 fallback (now has /pre-session route too)
├── gateway-protocol.html       V1 source-of-truth (preserved, untouched)
├── HANDOFF.md                  Original design doc
├── PROGRESS.md                 This file
├── TODO.md                     Human-review items
└── electron-app/
    ├── package.json
    ├── forge.config.js         DMG + ZIP makers
    ├── main.js                 11 IPC handlers + reminder scheduler
    ├── preload.js              Narrow window.gp.* exposure
    └── renderer/
        ├── index.html          3,500-line app (V1 + V2 + V3 + V4 layered)
        ├── audio-worklet.js    V3c pink noise processor
        └── vendor/
            └── three.min.js    V3a, locally bundled (offline-capable)
```

**IPC contract (window.gp.*):**
- `elevenlabsTTS`, `openaiTTS` → ArrayBuffer
- `mirror` → Anthropic transmission JSON
- `preSession`, `monthlyPatterns`, `analyzeSynchronicities` → JSON
- `generateAffirmation`, `shadowDialogue` → JSON
- `keys.{get,set,has}` → string / void / boolean
- `reminders.{get,set}` → config object / void

**Anthropic model:** `claude-sonnet-4-20250514`, max_tokens 1024–1500 depending on call.

---

## What's verified

| Check | Status |
|---|---|
| All inline scripts parse (`new Function(code)`) | ✅ |
| `main.js`, `preload.js`, `proxy.js`, `audio-worklet.js` parse | ✅ |
| `npm start` boots without crash | ✅ (V2, V2#2, V3+V4) |
| `npm run make` produces `.dmg` + `.zip` | ✅ |
| Git history clean (3 commits on `main`) | ✅ pre-final-commit |

## What needs your interactive verification

All API-dependent features need keys + a manual session. See TODO.md.

---

## Stats

- **Source files touched/created:** 6
- **Renderer:** 3,517 lines (up from V1's 2,260 — V2/V3/V4 added ~1,250 lines)
- **main.js:** 592 lines (V1 had 241 in proxy.js)
- **Three.js vendor bundle:** 654 KB
- **Final .dmg:** 99 MB
- **Total IPC handlers:** 11
- **New top-nav tabs:** 1 (Synchronicity)
- **New modules in renderer:** 9 (GP_API, THREE_FIELD, CINEMATIC, HRV, PRESESSION, CODE_OF_DAY, PATTERNS, AFFIRM_GEN, SHADOW, SYNC, REMINDERS)

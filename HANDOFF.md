# Gateway Protocol — Claude Code Handoff Document

## What this is
The most advanced personal consciousness and Gateway Process platform ever built as a single HTML file + Node.js proxy. Built iteratively with a 5-agent council (Monroe, Dispenza, Lipton, Tesla, Jung) as the knowledge foundation.

---

## Current file structure

```
gateway-protocol.html   — The full application (2,260 lines)
proxy.js                — Node.js local proxy server (241 lines)
HANDOFF.md              — This document
```

---

## How to run RIGHT NOW

```bash
# Requirements: Node.js (any version ≥ 14)
cd /path/to/files
node proxy.js
# Then open: http://localhost:5050
```

---

## Architecture overview

### Frontend (gateway-protocol.html)
Single-file app. No build step. No npm. Vanilla HTML/CSS/JS.

**Key systems:**
- `DB` — localStorage persistence layer (sessions, streaks, journal, wave completions, tier, 369 tracker)
- `VOICE` — Multi-engine TTS (OpenAI / ElevenLabs / Web Speech browser fallback)
- `AMBIENT` — Web Audio API engine: pink noise + Solfeggio oscillator + binaural beat carrier with auto-descent curve
- `QM` — Quantum Mirror: sends journal entries to Claude via proxy, renders Council of Five transmission
- `TT` — Tesla 369 Tracker: 33-day morning/midday/evening completion grid
- `WAVE_REQS` — Wave unlock gate system (Monroe-accurate progression requirements)
- `TIERS` — Consciousness tier system: Initiate → Practitioner → Adept → Master → Sovereign

### Backend (proxy.js)
Tiny Node.js HTTP server. No npm dependencies. Uses only built-ins (http, https, fs, path).

**Routes:**
```
GET  /        → Serves gateway-protocol.html (fixes file:// CORS issues)
POST /tts     → ElevenLabs TTS relay (CORS bypass)
POST /oai-tts → OpenAI TTS relay (CORS bypass)
POST /mirror  → Anthropic Claude API relay (Quantum Mirror)
```

**Why proxy exists:** ElevenLabs and OpenAI both block direct browser API calls (no CORS headers). The proxy relays requests server-side. Keys are stored in browser localStorage, sent with each request body, and passed through to the respective API. Keys never touch disk.

---

## API keys required

| Key | Where to get | Stored in |
|-----|-------------|-----------|
| OpenAI (`sk-proj-...`) | platform.openai.com → API Keys | localStorage via VOICE._save() |
| ElevenLabs (`sk-...`) | elevenlabs.io → Profile → API Key | localStorage via VOICE._save() |
| Anthropic (`sk-ant-...`) | console.anthropic.com → API Keys | localStorage via QM.saveKey() |

Keys are entered in the UI and saved to localStorage. They're sent in POST request bodies to the proxy.

---

## What V1 has (fully working)

### Content
- 7 Monroe Gateway Waves with accurate Focus levels (3, 10, 12, 15, 21, 23–27)
- 10 Solfeggio frequencies (174Hz–963Hz) with live audio playback
- 6 Breathwork patterns (Coherence 5-5, Gateway 5-5-5, Box 4-4-4, Dispenza 4-0-8, Tesla 3-6-9, Pranayama 4-7-8)
- Pain Dissolution Protocol (5 steps, Monroe/Lipton/Dispenza synthesis)
- Wealth State Programming Protocol (5 steps, Tesla/Monroe/Dispenza/Jung synthesis)
- 9 Code affirmations (55515, 528Hz, 888, 369, 1111, 432Hz, Focus 15, Shadow, Gateway)
- Council of Five agent bios and key transmissions

### Features
- **Wave unlock gates** — Monroe-accurate progression requirements (3/5/7/5/5/3 completions)
- **Timed sessions** (8 sessions: Morning Activation through Full Integration, 10–90 min)
- **Session pairing guide** — Brain.fm + YouTube deep-links per session type
- **Ambient engine** — pink noise + Solfeggio + binaural beat with beta→theta descent curve
- **Voiced guidance** — Monroe-accurate TTS cues at session start, each phase transition, and a 7-cue return ceremony
- **Quantum Mirror** — journal → Claude API → Council of Five transmission (7-field JSON: state, shadow, transmission, wave, frequency, code, practice)
- **Journal** — 6 prompts, auto-save with timestamp, chronological history
- **369 Tesla Tracker** — 33-day grid, desire statement, morning/midday/evening slots
- **Consciousness tier system** — 5 tiers with progress bar
- **30-day session graph** — canvas bar chart of daily practice minutes
- **21-day streak grid** — interactive dot tracker
- **Wave completion tracking** — per-wave counter, unlocks next wave
- **Frequency-reactive sacred geometry** — Flower of Life spins faster/brighter with higher Hz
- **Full persistence** — all data survives page reload via localStorage

---

## V2 Vision — what to build next

### Priority order (highest impact first):

#### 1. Electron packaging (THE unlock)
**Why first:** Eliminates the proxy entirely. APIs called server-side from the main process. No terminal, no CORS, no manual setup. One .dmg install.

**Architecture:**
```
electron-app/
├── main.js          — Main process: API calls, BrowserWindow
├── preload.js       — Contextbridge exposing ipcRenderer
├── renderer/
│   └── index.html   — Current gateway-protocol.html (adapted)
├── package.json
└── forge.config.js  — Electron Forge build config
```

**Key changes from current:**
- Replace `fetch('http://localhost:5050/oai-tts', ...)` with `ipcRenderer.invoke('tts', payload)`
- Replace `fetch('http://localhost:5050/mirror', ...)` with `ipcRenderer.invoke('mirror', payload)`
- Handle all HTTPS API calls in main.js using Node's `https` module (same logic as proxy.js)
- Store API keys in electron-store (encrypted, not localStorage)

**Build:**
```bash
npm install electron electron-forge electron-store
npx electron-forge make
# Outputs: out/make/Gateway Protocol-1.0.0.dmg
```

#### 2. Adaptive session engine
The Quantum Mirror currently responds to single journal entries. Extend it to read the last 7 entries before each session starts and return a pre-session recommendation:
```javascript
// Before session Begin is pressed, call:
POST /mirror with { type: 'pre-session', entries: last7, key }
// Returns: { recommendedWave, recommendedFreq, recommendedBreath, intention }
// Display above timer: "Today the Council recommends: Wave III · 528 Hz · Gateway 5-5-5"
```

#### 3. Session cinematic mode
Full-screen immersive mode. On session start:
```javascript
document.documentElement.requestFullscreen()
// Hide all nav, cards, controls
// Show only: guidance-cue text, sacred geometry (full viewport), ambient visualizer
// Tap anywhere = exit cinematic
```

#### 4. WebGL particle field
Replace CSS starfield with Three.js particle system:
```javascript
// 5000 particles in a torus shape
// Breath phase → expand/contract force
// Active Hz → rotation speed + color temperature
// Brainwave state → particle density gradient
```
Three.js is ~600KB, loads from CDN. Renders in a canvas behind all content.

#### 5. IndexedDB migration
Replace localStorage with IndexedDB:
```javascript
// Current: localStorage.setItem('gateway_protocol_v1', JSON.stringify(data))
// V2: Use idb-keyval (tiny wrapper) or raw IndexedDB API
// Adds: unlimited storage, full-text journal search, export to JSON/PDF
```

---

## Known issues / tech debt

1. **localStorage 5MB limit** — with heavy journal use over months, this will hit. IndexedDB migration is the fix.
2. **Web Speech fallback** — browser TTS quality varies wildly by OS. On Windows it's poor. Electron eliminates this by making OpenAI/ElevenLabs always work.
3. **Sacred geometry** is an inline SVG rotated with CSS animation — not reactive enough. Three.js replaces this entirely in V2.
4. **Session graph** uses `canvas.offsetWidth` which can return 0 if the progress tab hasn't been rendered yet. Fix: use ResizeObserver.
5. **Ambient audio** uses a deprecated `ScriptProcessor` node for pink noise. Should migrate to `AudioWorkletNode` for V2.
6. **Wave locked CSS** uses `opacity:.55` which may not be accessible enough — add `aria-disabled` attribute.

---

## Data schema (localStorage: 'gateway_protocol_v1')

```javascript
{
  sessions: Number,           // total completed sessions
  minutes: Number,            // total practice minutes
  streak: Number[],           // array of completed day indices (0–20)
  waveProgress: Number[],     // legacy (replaced by waveCompletions)
  waveCompletions: Number[],  // [w1count, w2count, w3count, w4count, w5count, w6count, w7count]
  journal: [{                 // array of journal entries
    id: Number,               // Date.now()
    date: String,             // ISO string
    session: String|null,     // session name if active
    data: [{prompt, response}]
  }],
  sessionLog: [{              // for 30-day graph
    date: String,             // YYYY-MM-DD
    minutes: Number
  }],
  tier: Number,               // current tier index (0–4)
  teslaTracker: {             // 369 tracker state
    desire: String,           // the desire statement
    '0-M': true,              // day 0, morning done
    '0-N': true,              // day 0, midday done
    '0-E': true,              // day 0, evening done
    // ... etc
  },
  lastSeen: null              // reserved
}
```

Voice settings (localStorage: 'gp_voice'):
```javascript
{
  elKey: String,       // ElevenLabs API key
  oaiKey: String,      // OpenAI API key
  engine: String,      // 'elevenlabs' | 'openai' | 'webspeech'
  elVoiceId: String,   // ElevenLabs voice ID
  oaiVoice: String     // OpenAI voice name (default: 'nova')
}
```

Anthropic key (localStorage: 'gp_anthropic_key'):
```javascript
String  // raw key value
```

---

## Quantum Mirror system prompt (for Claude Code reference)

The `/mirror` proxy route sends this system prompt to `claude-sonnet-4-20250514`:

> You are the Council of Five — Monroe, Lipton, Dispenza, Tesla, Jung. Read the journal entry and return JSON with 7 fields: stateAssessment, shadowObservation, transmission, wave, frequency, code, practice. Return ONLY valid JSON, no markdown.

Model: `claude-sonnet-4-20250514`
Max tokens: 1024
Temperature: default

---

## ElevenLabs voice IDs (currently in app)

| Name | Voice ID | Character |
|------|----------|-----------|
| Adam | pNInz6obpgDQGcFmaJgB | Deep · Authoritative · Male |
| Rachel | 21m00Tcm4TlvDq8ikWAM | Calm · Warm · Female |
| Bella | EXAVITQu4vr4xnSDxMaL | Soft · Soothing · Female |
| Antoni | ErXwobaYiN019PkySvjV | Smooth · Grounded · Male |
| Josh | TxGEqnHWrfWFTfGW9XjX | Warm · Deep · Male |
| Matilda | g5CIjZEefAph4nQFvHAz | Nurturing · Serene · Female |
| Daniel | onwK4e9ZLuTAKqWW03F9 | Refined · British · Male |
| Charlotte | XB0fDUnXU5powFXDhCwa | Gentle · Clear · Female |

Default: Nova (OpenAI) — warm, engaging female voice at 0.78 speed, tts-1-hd model.

---

## OpenAI TTS voices

onyx (deep male), nova (warm female — DEFAULT), echo (calm male), shimmer (soft female), alloy (neutral), fable (storytelling male)

---

## Solfeggio frequencies in app

174, 285, 396, 417, 432, 528, 639, 741, 852, 963 Hz

Paired to sessions:
- Pain Dissolution → 174 Hz
- Wealth State → 528 Hz
- Sleep Programming → 396 Hz
- Morning Activation → 432 Hz
- Full Integration → 528 Hz
- Deep Coherence → 528 Hz (default)

---

## Session binaural targets

| Session | Beat Hz target | Solfeggio |
|---------|---------------|-----------|
| Morning Activation | 10 Hz alpha | 432 |
| Focus 10 Entry | 7 Hz theta | 432 |
| Deep Coherence | 6 Hz theta | 528 |
| Gateway Immersion | 4 Hz deep theta | 528 |
| Pain Dissolution | 6 Hz theta | 174 |
| Wealth State | 6 Hz theta | 528 |
| Sleep Programming | 2 Hz delta | 396 |
| Full Integration | 4 Hz deep theta | 528 |

Binaural carrier: 200 Hz left ear, 200+beatHz right ear.
Descent curve: beta (18Hz) → alpha (10Hz) → theta (6Hz) → deep theta (4Hz) over session duration.

---

## Council of Five — agent domains

1. **Robert Monroe** — Gateway Process, Hemi-Sync, Focus levels (3/10/12/15/21/23-27), OBE architecture, Resonant Energy Balloon
2. **Dr. Bruce Lipton** — Biology of Belief, subconscious reprogramming, theta state access, epigenetics, 95% subconscious biology rule
3. **Dr. Joe Dispenza** — Neuroscience of transformation, quantum field work, future self visualization, elevated emotions, gamma + delta paradox
4. **Nikola Tesla** — 3-6-9, electromagnetic thought transmission, resonance, frequency as physical reality, ether/field theory
5. **Carl Jung** — Shadow work, individuation, collective unconscious, archetypes, making unconscious conscious

---

## Recommended V2 tech stack

```
Electron 28+          — Desktop packaging, eliminates proxy
electron-store        — Encrypted API key storage
Three.js r128         — WebGL particle field
idb-keyval            — IndexedDB wrapper (2KB)
AudioWorklet API      — Replace deprecated ScriptProcessor
Electron Forge        — Build/package/notarize
```

---

## What makes this different from every other meditation app

1. **Monroe-accurate** — The 7 Waves are mapped precisely to actual Gateway Process Focus levels. Not approximations.
2. **Council intelligence** — The AI responses are filtered through 5 distinct knowledge domains simultaneously. Not a generic LLM response.
3. **Frequency layering** — Pink noise + Solfeggio + binaural beat in simultaneous independent layers. Each adjustable.
4. **Gate system** — Progression is locked. You cannot skip to Focus 21 without establishing Focus 10. This is how Monroe taught it.
5. **Journal that responds** — The Quantum Mirror makes journal entries active documents, not archives.
6. **Owned, not subscribed** — Runs on your machine. Your data stays local. No cloud, no subscription, no tracking.


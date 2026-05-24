# Gateway Protocol

> The most advanced personal consciousness and Gateway Process platform. Monroe-accurate waves. Council of Five intelligence. Frequency layering. Owned, not subscribed.

A desktop application that turns the [Monroe Institute's Gateway Experience](https://www.monroeinstitute.org/) into a runnable practice — with AI guidance from a synthesized "Council of Five" (Monroe, Lipton, Dispenza, Tesla, Jung), real binaural beat generation, and a journal that responds.

```bash
git clone https://github.com/amc198009/gateway-protocol.git
cd gateway-protocol
npm run install:v2     # installs Electron + Forge + electron-store
npm start              # launches the app
```

Or just grab the latest `.dmg` from the [Releases page](https://github.com/amc198009/gateway-protocol/releases).

---

## What's in the box

| Capability | Notes |
|---|---|
| **7 Monroe Gateway Waves** | Wave I (Discovery / Focus 10) through Wave VII (Focus 23–27). Accurate progression gates: you can't skip levels. |
| **10 Solfeggio frequencies** | Live oscillator playback, 174 Hz–963 Hz, color-temperature-mapped to the visual field. |
| **6 Breathwork patterns** | Coherence 5-5, Gateway 5-5-5, Box, Dispenza 4-0-8, Tesla 3-6-9, Pranayama 4-7-8. |
| **8 Guided sessions** | 10–90 min, Morning Activation through Full Integration. Each has Brain.fm / YouTube pairing recommendations. |
| **Voiced guidance** | OpenAI TTS / ElevenLabs / Web Speech fallback. Cues at phase transitions + 7-cue return ceremony. |
| **AudioWorklet binaural engine** | Pink noise on the audio thread. Carrier at 200 Hz + 100 Hz sub-octave + 400 Hz octave for harmonic richness. Descent curve: beta 18 Hz → deep theta 4 Hz over session duration. |
| **Three.js particle field** | 5,000-point torus, frequency-reactive color (indigo → gold → violet), breath-reactive scale, additive blending. Bundled locally; works offline. |
| **Cinematic fullscreen mode** | Auto-engages on session start. Only timer + guidance cue + sacred geometry remain. Esc to exit. |
| **HRV coherence visualizer** | Live sine-wave canvas locked to breath cadence. Score climbs as you sustain rhythm. |
| **Quantum Mirror** | Write a journal entry, hit "Consult the Council" — the five voices synthesize one transmission: state, shadow, guidance, recommended wave + frequency + code + practice. |
| **Adaptive Session Engine** | Council reads your last 7 entries before each session and recommends a wave + frequency + breath + intention + rationale. |
| **Monthly Pattern Recognition** | 30-day journal reading: themes, breakthroughs, unintegrated shadows, coherence arc, next move. |
| **Custom Affirmation Generator** | Pick an activation code + write an intention. Council writes a custom affirmation matching your arc. |
| **Shadow Work Dialogue** | Multi-turn Jung-led conversation. One question at a time, beneath the surface. Saves as a journal entry on close. Optional voice-over. |
| **Synchronicity Log** | Quick-capture meaningful coincidences. Council analyzes recurring symbols, time clusters, and what the field is showing you. |
| **Code of the Day** | Deterministic per-date rotation through 9 activation codes. Same code planet-wide on any given day. |
| **Native Practice Reminders** | Morning / midday / evening notifications, scheduled in the Electron main process. |
| **Full data export** | One-click JSON backup of journal + syncs + customs + everything. |

---

## Architecture

```
┌────────────────────────────── Renderer ──────────────────────────────┐
│  3,680-line single HTML page · vanilla JS · no framework             │
│                                                                       │
│  Three.js particle field    Cinematic mode    HRV visualizer         │
│  AudioWorklet pink noise    Breath engine     Sacred geometry        │
│  Council Recommendation     Code of the Day   Custom Affirmations    │
│  Shadow Dialogue            Synchronicity     Monthly Patterns       │
│                                                                       │
│  ── window.gp.* (contextBridge, narrow surface) ──                   │
└──────────────────────────────────────────────────────────────────────┘
                              ▲                ▲
                              │ IPC            │
┌─────────────────────────────┴────────────────┴───────────────────────┐
│                      Electron Main Process                            │
│                                                                       │
│  11 ipcMain.handle endpoints:                                         │
│   ├── elevenlabs-tts        ├── monthly-patterns                      │
│   ├── openai-tts            ├── generate-affirmation                  │
│   ├── mirror                ├── shadow-dialogue                       │
│   ├── pre-session           ├── analyze-synchronicities               │
│   ├── reminders-{get,set}   └── key-{get,set,has}                     │
│                                                                       │
│  electron-store (encrypted) ── API keys: OpenAI, ElevenLabs, Anthropic│
│  Native Notifications scheduler ── morning/midday/evening reminders   │
│  Anthropic prompt caching (cache_control: ephemeral, 5-min TTL)       │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
            ElevenLabs · OpenAI · Anthropic (claude-sonnet-4)
```

**The Council is not a generic LLM call.** Every Anthropic request is preceded by a curated system prompt that frames the model as the five voices (Monroe, Lipton, Dispenza, Tesla, Jung) speaking in synthesis, with structured JSON output enforced. Eight distinct prompt regimes for eight distinct tasks (mirror, pre-session, monthly patterns, affirmation, shadow dialogue, synchronicity, etc.). All cached.

---

## File layout

```
gateway-protocol/
├── README.md               ← you are here
├── HANDOFF.md              ← original V1 design + V2 backlog (preserved)
├── PROGRESS.md             ← every feature shipped, per layer
├── TODO.md                 ← open decisions + nice-to-haves
├── package.json            ← root delegator (npm start, npm run make)
├── proxy.js                ← V1 fallback server (still works, kept at parity)
├── gateway-protocol.html   ← V1 single-file source (preserved unchanged)
└── electron-app/
    ├── package.json
    ├── forge.config.js     ← .dmg + .zip makers
    ├── main.js             ← Electron main: IPC, key vault, reminders
    ├── preload.js          ← contextBridge → window.gp.*
    └── renderer/
        ├── index.html      ← the app (V2 + V3 + V4 + V5 layered on V1)
        ├── audio-worklet.js
        └── vendor/
            ├── three.min.js    ← bundled, offline
            └── idb-keyval.js   ← (inline wrapper used instead — see DB module)
```

---

## Requirements

- **macOS 10.15+** (Catalina or later) → `.dmg`. **Windows** → Squirrel `Setup.exe`. **Linux** → `.deb` + `.rpm`. All three are configured in `forge.config.js`, but each artifact must be built **on its own OS** (Windows Squirrel needs Windows/wine; `.deb`/`.rpm` need `dpkg`/`rpmbuild`) — a CI matrix (macos/windows/ubuntu runners) is the clean way to produce all three from one tag. All builds are currently unsigned.
- **Node 14+** (only for local development; the .dmg ships its own Node runtime inside Electron).
- **API keys (BYOK):**
  - [OpenAI](https://platform.openai.com/api-keys) for TTS · `sk-proj-...`
  - [ElevenLabs](https://elevenlabs.io/) for premium TTS voices · `sk-...`
  - [Anthropic](https://console.anthropic.com/) for the Council · `sk-ant-...`

Keys are stored locally with [electron-store](https://github.com/sindresorhus/electron-store) encryption at `~/Library/Application Support/Gateway Protocol/gateway-protocol-keys.json`. **They never leave your machine** — there's no cloud, no telemetry, no subscription.

---

## Development

```bash
# From repo root
npm start              # dev mode with hot main-process restart (type 'rs' + Enter)
npm run package        # builds the unpacked .app bundle in electron-app/out/
npm run make           # builds .dmg + .zip in electron-app/out/make/
npm run v1             # runs the V1 browser+proxy mode for comparison
```

The renderer feature-detects `window.gp` — so `electron-app/renderer/index.html` works in both Electron (uses IPC) and a plain browser via `proxy.js` (falls back to `fetch()` against `localhost:5050`). One file, two runtimes.

### Cutting a release

Tag a version and push the tag — the [`Release` workflow](.github/workflows/release.yml) builds on macOS, Windows, and Linux runners and attaches every artifact (`.dmg`, `.zip`, `Setup.exe`, `.deb`, `.rpm`) to the matching GitHub Release automatically:

```bash
# bump electron-app/package.json + server/version.json first, then:
git tag v3.1.0 && git push origin v3.1.0
```

To smoke-test a build without releasing, run the workflow manually (`workflow_dispatch`) — it produces the same binaries as downloadable workflow artifacts but doesn't touch any Release. After releasing, bump `server/version.json` and `npm run deploy` from `server/` so the in-app update banner points users at the new build.

---

## Versions / Changelog

- **V1** — Single-file HTML + zero-dep Node proxy. The original substrate.
- **V2 #1** — Electron packaging. Eliminates the proxy. Encrypted key storage. One-double-click install.
- **V2 #2** — Adaptive Session Engine. Council reads your last 7 journal entries pre-session, recommends wave + freq + breath + intention.
- **V3** — Full Immersion. Three.js particle field, cinematic fullscreen mode, AudioWorklet binaural with harmonic overtones, HRV coherence visualizer.
- **V4** — Deep Intelligence. Monthly pattern recognition, custom affirmation generator, multi-turn Shadow Work dialogue with Jung, synchronicity log + AI analysis, code of the day, native practice reminders.
- **V5** — Polish + IndexedDB. Prompt caching across all Council calls, affirmation wheel fix, wave context in cinematic, voice-over for shadow dialogue, JSON export, IndexedDB primary storage (lifts the 5MB localStorage cap).
- **V6** — Repo + ops. Public README, GitHub Actions CI, HRV polish, Settings screen, GitHub Releases.

See [PROGRESS.md](PROGRESS.md) for the per-feature breakdown.

---

## What makes this different

1. **Monroe-accurate** — The seven Waves map precisely to actual Monroe Gateway Focus levels, not approximations. Progression is gated; you can't skip Focus 21 without establishing Focus 10 first.
2. **Council intelligence** — AI responses pass through five distinct knowledge domains simultaneously. Not a generic prompt — eight specialized prompt regimes for eight tasks, all cached.
3. **Frequency layering** — Pink noise (AudioWorklet) + Solfeggio (oscillator) + harmonic binaural (3-pair carrier) in simultaneous independent layers. Each independently adjustable. Live descent curve from beta to deep theta.
4. **Gate system** — Wave unlocks require N completions of the previous wave (3/5/7/5/5/3). Monroe-faithful.
5. **Journal that responds** — Every entry becomes an active document. The Mirror reads single entries; the Adaptive Session Engine reads the last 7; Monthly Patterns reads 30 days. Each at a different scale of memory.
6. **Owned, not subscribed** — Runs on your machine. Your data stays local. No cloud, no telemetry, no monthly fee. Bring your own API keys.

---

## License

[GNU AGPL-3.0-only](./LICENSE) · Copyright © 2026 AM.

This means you can run it, copy it, modify it, and redistribute it — including running a fork as a public service — provided you also offer the same freedoms to anyone who interacts with your fork. In practical terms: if you stand up a Practice Rooms / Transmission Feed server based on this code and let anyone hit it over the network, you must publish your source. Closed-source SaaS forks are not allowed; community-served forks are welcome. See [LICENSE](./LICENSE) for the full text and [the GNU AGPL FAQ](https://www.gnu.org/licenses/gpl-faq.html) for plain-English notes.

The "Council of Five" prompts synthesize the published frameworks of real people (Monroe, Lipton, Dispenza, Tesla, Jung). Their names appear for narrative coherence; this project is not endorsed by, affiliated with, or licensed by the Monroe Institute, any of the named individuals, or their estates. Use accordingly.

---

🤖 Built collaboratively with [Claude Code](https://claude.com/claude-code).

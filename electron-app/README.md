# Gateway Protocol V2 — Electron app

Desktop port of the V1 single-file HTML. The proxy is gone; HTTPS calls
to ElevenLabs / OpenAI / Anthropic happen in the main process.

## Run from source

```bash
cd electron-app
npm install
npm start
```

## Build a .dmg

```bash
npm run make
# Output: out/make/Gateway Protocol-2.0.0-arm64.dmg
```

## What changed from V1

| V1 (browser + proxy.js) | V2 (Electron) |
|---|---|
| `node proxy.js` then open localhost:5050 | Double-click the .dmg → installed app |
| `fetch('http://localhost:5050/tts', …)` | `window.gp.elevenlabsTTS(…)` over IPC |
| API keys in `localStorage` (plaintext) | API keys in `electron-store` (encrypted at rest) |
| Web Speech fallback when proxy down | OpenAI/ElevenLabs always reachable |
| CORS issues, manual key entry per session | One-time key entry, encrypted, persists |

The renderer HTML is unmodified from V1 in shape — only the three
fetch call sites and the key-storage layer were rewired. It still falls
back to `fetch()` if `window.gp` isn't present, so V1 in a plain
browser keeps working.

## Architecture

```
main.js          Node-side: BrowserWindow + ipcMain handlers for TTS,
                 Mirror, and key storage. Owns all HTTPS.
preload.js       contextBridge → window.gp.* (narrow API to renderer)
renderer/
  index.html     V1 app, three fetch sites swapped to window.gp.*
package.json     Electron + Forge + electron-store
forge.config.js  .dmg build config (DMG + ZIP makers)
```

## V2 backlog (after this ships)

From `../HANDOFF.md`:

1. Adaptive session engine — Mirror reads last 7 entries before session start
2. Cinematic mode — fullscreen, sacred geometry only
3. WebGL particle field — Three.js torus reactive to breath/Hz/state
4. IndexedDB migration — lift the 5MB localStorage ceiling

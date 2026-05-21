# Installing Gateway Protocol (macOS)

The desktop app is distributed two ways:

- **Download the `.dmg`** from the hosted server: <https://gateway-protocol.fly.dev/download>
- **Run from source** (developers): `npm run install:v2 && npm start` from the repo root

This guide is about the `.dmg`.

---

## The "developer cannot be verified" warning

On first launch you'll see:

> **"Gateway Protocol" cannot be opened because the developer cannot be verified.**

**This is expected.** The app is **unsigned** — it hasn't been through Apple's $99/year code-signing + notarization process. macOS Gatekeeper blocks unsigned apps by default. The warning is about *provenance*, not safety: the code is exactly what's in this repo, and you can read every line of it.

### How to open it anyway

Pick whichever is easiest — they all do the same thing (tell macOS you trust this app):

**Option A — System Settings (works on all recent macOS, including Sequoia)**
1. Drag **Gateway Protocol** into your `Applications` folder.
2. Try to open it once (you'll get the warning — click Cancel/OK).
3. Open **System Settings → Privacy & Security**.
4. Scroll down to the message *"Gateway Protocol was blocked…"* and click **Open Anyway**.
5. Confirm. The app launches and won't prompt again.

**Option B — Right-click (macOS Sonoma 14 and earlier)**
1. In `Applications`, **right-click** (or Control-click) *Gateway Protocol*.
2. Choose **Open**, then **Open** again in the dialog.
   - *Note: Apple removed this shortcut in macOS Sequoia 15. Use Option A there.*

**Option C — Terminal (bulletproof, works everywhere)**
```bash
xattr -dr com.apple.quarantine "/Applications/Gateway Protocol.app"
```
This strips the "downloaded from the internet" quarantine flag. After running it, the app opens like any other.

---

## Why isn't it just signed?

Signing + notarization requires:
1. An **Apple Developer Program** membership ($99/year)
2. `APPLE_ID`, `APPLE_PASSWORD` (app-specific), and `APPLE_TEAM_ID` set as environment variables
3. `osxSign` + `osxNotarize` blocks in `electron-app/forge.config.js`

Once that's set up, `npm run make` signs and notarizes automatically, and **nobody sees this warning again**. It's on the roadmap — see `LAUNCH_CHECKLIST.md §2d`.

---

## Apple Silicon (M1/M2/M3/M4)

The current build is **Intel x64**. It runs on Apple Silicon through Rosetta 2 (macOS installs it automatically on first launch if needed). A native arm64 build is planned — it'll be lighter and faster, but the Intel build works fine in the meantime.

---

## Uninstalling

1. Quit the app.
2. Drag `Applications/Gateway Protocol.app` to the Trash.
3. (Optional) Remove its data: `~/Library/Application Support/Gateway Protocol/`

Your journal, synchronicities, and settings live in that folder. **Export them first** (Settings → Data Management → Export All Data) if you want to keep them.

---

## Trouble?

- **"The app is damaged and can't be opened"** — this also comes from the quarantine flag. Run Option C above.
- **App opens but TTS/Council don't work** — you need to add your API keys (OpenAI, ElevenLabs, Anthropic) in the app. They're stored encrypted on your machine and never leave it.
- **Network tab features greyed out** — set a server URL in Settings → Network (use the hosted one with the "Use hosted server" button).

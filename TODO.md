# Gateway Protocol — TODO / Human Review

Things I built but couldn't verify alone, decisions you should make, and known limitations of the autonomous run.

---

## 🔴 Needs your interactive verification

These are wired in code and parse cleanly, but I can't drive them without your API keys and a real screen.

### Per-feature smoke test (do these in order)

| # | Feature | How to verify |
|---|---|---|
| 1 | Three.js field renders | Open the app. You should see a slowly-rotating torus of gold/violet particles behind everything. If not: open DevTools, check console for THREE-related errors. |
| 2 | TTS still works | Set OpenAI key in voice settings. Start "Morning Activation". Cues should speak. Repeat with ElevenLabs key + engine switch. |
| 3 | Quantum Mirror still works | Set Anthropic key. Write a journal entry. "Consult the Council" should return 7 fields. |
| 4 | Pre-session recommendation appears | Write a 2nd journal entry (after #3 there should be 2). The banner above the Wave list should populate with the Council's recommendation. Click "Apply" — should switch to Sessions screen with the recommended wave/freq/breath visually highlighted. |
| 5 | Cinematic mode triggers | Pick any session, click Begin. The whole UI should hide; only the timer + guidance cue + sacred geometry should remain. Esc or the "Esc · exit cinematic" badge should bring it back. |
| 6 | AudioWorklet binaural | Start a session, put on headphones, listen for the rich pink noise + binaural beat. DevTools console should NOT show "ScriptProcessorNode is deprecated." If it does, the worklet path failed and the legacy fallback engaged — check console for the warning. |
| 7 | HRV visualizer | Start breathwork. The scrolling sine wave + coherence score under the breath orb should pulse with each phase. |
| 8 | Code of the day | The card at the top of the home screen should show today's code + intent + 1-sentence transmission. Same code regardless of reload (until midnight). |
| 9 | Monthly patterns | Need ≥3 entries in the last 30 days. Go to Progress, click "Analyze Last 30 Days". |
| 10 | Custom affirmation | Affirmations screen → fill the intention textarea + pick a code → Generate. Save adds it to the list with a "◈ Council-generated" badge. |
| 11 | Shadow dialogue | Council screen → "Begin Dialogue". Jung speaks first. Enter to send. Closing saves the conversation to the journal. |
| 12 | Synchronicity log | New "Synchronicity" tab. Add 3+ entries. Click "Analyze Field" — should return symbols/clusters/themes/message. |
| 13 | Reminder notifications | Progress screen → check "Enable daily reminders" + set times. Set one of them to ~2 minutes from now. Wait. Notification should fire as a native macOS notification. (System Settings → Notifications → Gateway Protocol may need to be enabled the first time.) |

---

## 🟡 Decisions you should make

### 1. Apple Developer code signing

**Status:** Unsigned `.dmg`. macOS Gatekeeper warns on first open ("Apple cannot check it for malicious software"). Workaround: right-click → Open → Open.

**To fix:**
1. Get an Apple Developer ID (~$99/year)
2. Set env vars: `APPLE_ID`, `APPLE_PASSWORD` (app-specific), `APPLE_TEAM_ID`
3. Add `osxSign: {}` and `osxNotarize: { tool: 'notarytool', ... }` blocks to `packagerConfig` in `electron-app/forge.config.js`
4. `npm run make` will sign + notarize automatically

**Decision:** Worth $99/yr for distribution-readiness? If you're only running it yourself, skip.

### 2. Apple Silicon build

**Status:** Build is Intel x64 only (matches your current Mac). Runs on Apple Silicon via Rosetta, but native arm64 would be lighter + faster.

**To add:** In `forge.config.js`, add a `--arch=arm64` build target. Either run two `npm run make` passes (one per arch) or use Forge's multi-arch make.

**Decision:** Add now (cleaner if you ever switch Macs) or defer until you do.

### 3. Three.js bundling strategy

**Status:** Local copy at `electron-app/renderer/vendor/three.min.js` (r160, 654 KB). Three.js marks the UMD `three.min.js` build as deprecated in r150+ — it still works, but they want consumers on ES modules.

**To update:** Migrate the script tag + THREE_FIELD module to import from an ES module bundle. Adds a small bundler step (esbuild, vite, or rolldown).

**Decision:** Defer until either (a) r170 actually removes the UMD build or (b) you want to add more Three.js features that benefit from tree-shaking.

### 4. IndexedDB migration

**Status:** Not built. Was in the original 5-pillar list but dropped from the V2/V3/V4 re-scope. Current persistence is `localStorage` with a 5 MB browser cap.

**Impact:** With Shadow Dialogue saving full conversations + the Synchronicity log growing over time, you'll hit the cap in 6–12 months of heavy use.

**To add:** Wrap `DB.load()` / `DB.save()` with `idb-keyval` (2 KB library). Migrate on first run by reading localStorage, writing to IDB, then deleting localStorage. Estimated 200–300 lines.

**Decision:** Defer until you hit a "QuotaExceededError" toast.

---

## 🟢 Nice-to-haves (not blockers)

- **Cinematic-mode HRV overlay polish** — the bar floats at the bottom and looks slightly disconnected. Could be a circular pulse around the timer ring instead.
- **Wave card in cinematic mode** — currently only the timer + cue show. Could surface "Wave III · Focus 15" at the top for context.
- **Voice-over for Shadow Dialogue** — Jung's replies could be spoken via the same TTS engine if voice is enabled. Currently text-only.
- **Export journal/synchronicities** — JSON download button, useful for backup or external analysis.
- **Dedicated Settings screen** — the reminder settings live in Progress; voice settings live in the Sessions screen. A consolidated Settings tab would be cleaner.
- **Prompt caching on Anthropic calls** — the system prompts for Mirror / preSession / patterns / affirmation / shadow / sync are static and could be cached via the `cache_control` parameter for ~50% latency reduction on repeated calls.
- **HRV "real" mode** — if you add a Bluetooth chest strap or watch integration later, the visualizer could ingest real HRV data instead of breath-derived approximation.
- **Locale support** — all UI text is English. The Cormorant Garamond + Montserrat font stack handles most Latin alphabets, but no translation pipeline exists.

---

## ⚠️ Known quirks

- **Custom affirmations don't refresh the wheel automatically** — `buildAffirmations()` is called after save, but the carousel (`renderCurrentAffirm`) still cycles through the built-in `AFFIRMATIONS` constant only. Custom ones appear in the "all affirmations" list below. If you want them in the wheel rotation, replace the constant reference in `renderCurrentAffirm` with the merged list.
- **Reminders fire only while the app is running** — Electron's main process keeps `setTimeout`s alive. If you fully Quit the app (Cmd+Q), they stop. To make them OS-level persistent, you'd need a launchd agent (macOS) / startup task — out of scope here.
- **The `defer` removal on Three.js was deliberate** — `<script defer>` would race the inline script. Three.js loads synchronously now (~600 KB blocking load on first launch only, then cached).
- **`electron-store` v8 was pinned** — v9+ went ESM-only and isn't compatible with `require()`. Watch out if Dependabot tries to bump it.
- **Anthropic model is hardcoded as `claude-sonnet-4-20250514`** — when a newer Sonnet ships, do a global find-replace in `main.js` + `proxy.js`. Two locations each. (The repository's CLAUDE.md guidance to use the latest model would suggest bumping when 4.6 or later ships.)
- **The shadow dialogue `isComplete:true` signal is honored visually (system message) but doesn't auto-close the modal** — by design, so the practitioner can keep going or close on their own terms.

# Privacy Policy — DRAFT

> ⚠️ **NOT LEGAL ADVICE. NOT BINDING.** This is a starting-point draft to be **reviewed by a privacy attorney** before it's used on a live product. The framing is honest about what the app actually does, but the legal phrasing has not been validated by counsel. Do not publish this as-is. See `LAUNCH_CHECKLIST.md` §2 for the legal pre-launch steps.

---

**Last updated:** _to be filled in when finalized_
**Applies to:** the Gateway Protocol desktop application (the "App") and the optional hosted network services at `<your-domain>` (the "Hosted Services").

## 1 · What we collect — and what we don't

The App is designed to keep your data local by default. Here's the complete inventory:

### Stored only on your machine (we never see it)

- Your journal entries
- Your synchronicity log
- Your custom protocols
- Your custom affirmations
- Your wave completions, session history, streaks, tier
- Your 369 Tesla Tracker entries
- Your HRV readings
- Your API keys (OpenAI, ElevenLabs, Anthropic) — stored encrypted via `electron-store` in `~/Library/Application Support/Gateway Protocol/gateway-protocol-keys.json`
- Semantic embeddings of your journal entries (V7c) — stored in your browser's IndexedDB

We do not have a server that holds copies of any of the above. We cannot read it. We cannot subpoena ourselves into reading it. If your laptop dies, this data dies with it (use the Export All Data button regularly).

### Sent to third-party APIs (only when you use those features, with your keys)

- **OpenAI** — when you use OpenAI TTS or the V7c semantic memory feature. Subject to [OpenAI's privacy policy](https://openai.com/privacy).
- **ElevenLabs** — when you use ElevenLabs TTS. Subject to [ElevenLabs' privacy policy](https://elevenlabs.io/privacy).
- **Anthropic** — when you consult the Council, run a pre-session reading, generate an affirmation, do shadow work, or run pattern/synchronicity analysis. Subject to [Anthropic's privacy policy](https://www.anthropic.com/legal/privacy).

These calls are made directly from your machine using **your** API keys. We are not in the path of these requests.

### Sent to our Hosted Services (only if you opt in)

If you enable network features (Practice Rooms or Transmission Feed) in Settings → Network and configure a server URL pointing at our hosted instance:

- **Practice Rooms:** Your IP address and the timer/phase state of your session are visible to other people in the same room (via the room code) for the duration you are in the room. No identifiers. No journal content.
- **Transmission Feed (if you check "Share anonymously"):** The text of the specific Council transmission you choose to share — and only the text, the wave label, the frequency, and the activation code. No identifiers. No author tag. No timestamp linkable to you.

Our hosted server retains:
- Active room state: in memory, deleted within 30 minutes of the last participant leaving
- Feed entries: in a 500-item ring buffer (older entries fall off automatically)
- Server logs: aggregated request counts only, no IP-level retention beyond 7 days

## 2 · Cookies, tracking, telemetry

**None.** The App does not include any analytics SDK, crash reporter, telemetry, or tracking pixel. The Hosted Services do not set cookies.

If we ever add analytics, it will be:
- Privacy-respecting (Plausible or Fathom, never Google Analytics)
- Aggregate only — no individual session tracking
- Disclosed in this policy with the addition date

## 3 · Children

The App is not directed at children under 16. Don't let kids use a tool that synthesizes the voice of dead consciousness researchers and asks them to do shadow work. It's not for them.

## 4 · Your rights

Whether or not GDPR / CCPA technically applies to you, we extend these rights to everyone:

- **Access:** Click "Export All Data" in Settings. You get the complete machine-readable dump.
- **Erasure:**
  - Local data: Click "Reset All Data" in Settings. Everything is wiped.
  - Hosted feed contributions: _Not yet implemented._ See `LAUNCH_CHECKLIST.md` §2c. Until built: email `[your support email]` with the approximate date/content of your contribution and we'll manually remove from the ring buffer. (Note: many entries naturally fall off within days due to the buffer cap.)
- **Portability:** Same as Access — JSON exports are designed for re-import into other tools.
- **Rectification:** Just edit your local data. There's nothing to correct on our end because we don't have it.

## 5 · Data we will resist sharing

If a government, law enforcement agency, or civil litigant asks us for user data:

- For data stored only on user machines: **We don't have it.** Their target is the user's own device.
- For Hosted Services data: we maintain only what's described in §1 above. We will resist demands that exceed lawful warrants, and we will publish an annual transparency report once we have any meaningful volume of requests to disclose.

We may publish a [warrant canary](https://en.wikipedia.org/wiki/Warrant_canary) in the future.

## 6 · Security

- Local API keys are encrypted at rest via electron-store with a per-app encryption key. This is not bank-grade — it protects against casual file inspection, not a determined attacker with root access to your machine. For higher security, use OS-level encryption (FileVault) on top.
- Hosted Services use TLS (HTTPS / WSS) for all transport.
- The hosted server's source code is at [github.com/amc198009/gateway-protocol](https://github.com/amc198009/gateway-protocol) under `/server` — anyone can audit what it actually does.

## 7 · Third-party DPAs

When operating commercial Hosted Services, we will have Data Processing Agreements with:
- The cloud provider hosting the server (Fly.io, Render, etc.)
- Anthropic (if we ever operate a hosted-Council tier)
- OpenAI (same)
- ElevenLabs (same)
- Stripe (if we ever process payments)

All of these vendors publish standard DPAs that we will execute and link here.

## 8 · Changes to this policy

Material changes will be:
- Announced in the app on the Settings screen (a "Privacy policy updated" notice)
- Documented in the GitHub repo's commit history (so you can always diff what changed)
- Effective 30 days after announcement (gives you time to decide if you still want to use the service)

## 9 · Contact

`[your contact email]`

For specific privacy concerns: `[your privacy email or same as above]`

---

**Drafted by:** the project maintainer, with help from Claude Code. **Not yet reviewed by:** a real attorney. **Status:** DRAFT, do not deploy without legal review.

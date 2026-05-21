# V5 UI/UX — "The Living Mirror: Responsive & Collective"

> **Naming note.** This is the **UI/UX** track (`V3_ROADMAP.md` → `V4_ROADMAP.md`
> → this). The app's *feature* track separately used "V5" (Polish + IndexedDB,
> see `PROGRESS.md`) — different axis. Don't confuse the two.

**Theme: the interface stops reacting to your taps and starts responding to your
physiology, your patterns, and other practitioners.**

The throughline: readable (V1/V2) → immersive + adaptive (V3) → spatial +
embodied, everywhere (V4) → **responsive + collective (V5)**. Where V4 makes the
interface a *space you inhabit on any device*, V5 makes it a *living companion*:
it closes the biofeedback loop, anticipates, and connects you to the collective
field. Nothing here is shipped yet.

## Depends on V4
V5's headline (closed-loop biofeedback, **T1**) is gated on **V4 T6 — the iOS
companion + HealthKit live HRV**. Until live biometrics exist, T1 runs in
"breath-approximated" mode (today's HRV visualizer) and upgrades to real data
when V4 lands. Sequence accordingly.

---

## V5 priorities (in order)

### T1 · Closed-loop biofeedback 🔴 headline — depends on V4 iOS companion
The HRV visualizer becomes **real**, not breath-derived, and drives the
experience live:
- Field intensity, binaural descent rate, and ambient layering respond to **live
  coherence** in real time — high coherence blooms the field and deepens the
  descent; low coherence brings the guidance back to center.
- **Adaptive session pacing** — phases stretch/shorten to meet the practitioner's
  actual nervous-system state, not a fixed clock.
- A true neurofeedback **"coherence lock"** moment on sustained coherence.

**Effort:** large (real-time state→environment loop + tuning). **Risk:** high —
needs the companion; must be *felt*, not twitchy.

### T2 · Ambient & agentic Council 🟢 lead with this
The Council shifts from request-response to **proactive, ambient intelligence**:
- Opt-in **unprompted transmissions** — it notices a pattern across recent
  journals/syncs and surfaces a single quiet line at the right moment, not on a
  button press. Frequency-capped, default off.
- **Voice-first, always-available** Council — press-and-hold (or wake phrase)
  conversational mode, reusing the BYOK Council + TTS plumbing.
- Pre-session **readiness nudge** from live/recent biometrics.

**Effort:** moderate (reuses BYOK Council + TTS; new triggering layer). **Risk:**
medium — the whole bet is *restraint*; an annoying proactive Council is worse
than none.

### T3 · Collective field rendering 🟡 builds on the V7 network
V7 added practice rooms + feed; V5 makes the collective **visible and spatial**:
- **Synchronized group sessions** rendered as one shared scene — each present
  practitioner is a mote in a single field; the host's descent pulls the whole
  field down together.
- **"X in the field now"** — the global network as a living constellation
  (anonymous, aggregate), so solo practice never feels solo.
- Feed transmissions surface as faint **field events**, not a list.

**Effort:** moderate–large (shared-state viz over the existing WS server).
**Risk:** medium — presence privacy + perf with many motes; default to
aggregate/anonymous.

### T4 · Adaptive information architecture 🟢 contained
"Earned minimalism" (V3 T5) deepens from *cosmetic* to *structural*:
- The app **reshapes to your tier/path** — a Sovereign sees a near-bare field +
  practice; an Initiate sees more scaffolding. The Consciousness Signature
  becomes your **navigational identity**, not just a Progress visual.
- Personalized home: today's most-relevant practice surfaced first, from your arc.

**Effort:** moderate (an IA-state layer over existing tier data). **Risk:** low.

### T5 · Inclusive by design — a11y, localization, sensory range 🟢 overdue
First-class, not a footnote (gaps flagged in `TODO.md`):
- **Accessible spatial nav** — keyboard + screen-reader path for the
  torus/orbital navigation; the flat nav stays the guaranteed fallback.
- **Localization pipeline** — externalize UI strings (all English today).
- **Low-sensory "quiet" mode** + **eyes-closed / audio-only navigation** (haptic
  + voice), which pairs naturally with T1/T2.

**Effort:** moderate. **Risk:** low. High goodwill-per-effort.

### T6 · Cross-device continuity 🟡 optional, larger
Hand a session **from phone to desktop mid-practice**; optional
**end-to-end-encrypted** state sync (true to "owned, not subscribed" — opt-in,
E2EE, never a server-readable cloud). Continuity of field state across devices.

**Effort:** large (sync model + E2EE + conflict handling). **Risk:** medium-high
— easy to over-build. Ship **"QR handoff"** first, full sync later.

---

## Suggested build order
1. **T2 — Ambient/agentic Council** (reuses BYOK; high impact; doesn't need V4).
2. **T5 — Inclusive by design** (overdue, contained, broad benefit).
3. **T4 — Adaptive IA** (contained; compounds with everything).
4. **T3 — Collective field** (builds on the V7 server).
5. **T1 — Closed-loop biofeedback** (after V4's iOS companion lands).
6. **T6 — Cross-device continuity** (QR handoff first, full E2EE sync later).

**Honest framing:** T2 / T4 / T5 are the contained, high-leverage wins to lead
with — and none of them depend on V4. T1 is the *soul* of V5 but is gated on the
V4 iOS companion, so it lands later. T3 and T6 are real but easy to over-scope;
ship their minimal form first. The throughline holds: the interface stops being
something you operate, becomes something you inhabit (V3/V4), and in V5 becomes
something that **responds to you and connects you**.

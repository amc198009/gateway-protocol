# Decision memo — Bundling MediaPipe for facial affect (V6·T3) & the CSP trade-off

**Status:** ✅ **DECIDED — NO-GO (2026-05-24).** Keep the model-free camera approach; **no CSP change**. The renderer CSP stays `script-src 'self'` (audit posture preserved). Full MediaPipe facial affect is **won't-do / revisit only if it becomes a priority**. · **Owner:** Arturo · **Prepared by:** Claude
**TL;DR:** Shipping real facial landmarks (head pose / blink / gaze / affect) means adding **`'wasm-unsafe-eval'`** to the renderer CSP — a **global, permanent** relaxation of a hardening we added during the security audit. It's narrower than it sounds, and low marginal risk *given our other controls*, but it's a conscious trade-off. This memo lays out exactly what changes, the risk, alternatives, and a recommendation so you can make a clean go / no-go.

---

## 1. What the feature is
The optional, on-device camera check-in currently uses **model-free frame-differencing** (stillness, fidget, presence — shipped in v3.3.2). "Done right" (T3) means real **face landmarks**: head pose, blink rate, gaze direction, mouth/brow geometry, and coarse valence/arousal — via **MediaPipe Tasks Vision · FaceLandmarker**, running 100% on-device.

## 2. Why it needs a CSP change
MediaPipe FaceLandmarker executes its inference graph as **WebAssembly** (`vision_wasm_internal.{js,wasm}`) and uses WebGL/WebGPU for acceleration.

Our renderer CSP today (post-audit) is:
```
script-src 'self'
```
Chromium **blocks `WebAssembly.compile()` / `instantiate()` under a CSP unless `script-src` contains `'wasm-unsafe-eval'`** (or the broader `'unsafe-eval'`). So MediaPipe will not run until we change the CSP to:
```
script-src 'self' 'wasm-unsafe-eval'
```

**Three hard requirements come with it:**
1. **CSP relaxation** — `'wasm-unsafe-eval'` added to `script-src` (the subject of this memo).
2. **Vendored assets** — the WASM (~3 MB) + model (`face_landmarker.task`, ~3–4 MB) must be **bundled and served from `'self'`**, not the Google CDN (a CDN would also force loosening `connect-src`/`script-src` for `storage.googleapis.com`). That means committing ~6–7 MB of binaries to the repo + adding them to `server/practice-room.js` `STATIC_ROUTES` + the existing `SHA256SUMS` checksum CI step.
3. **Real-device validation** — accuracy, lighting, performance, and the consent UX can only be validated on actual cameras; it cannot be headless-tested.

## 3. What `'wasm-unsafe-eval'` actually permits (and doesn't)
This is the crux, and it's widely misunderstood:

- ✅ It allows **WebAssembly compilation/instantiation** from bytes the page already has.
- ❌ It does **NOT** re-enable JavaScript `eval()`, `new Function()`, or inline scripts. It is **strictly narrower** than `'unsafe-eval'`. (It's a CSP Level 3 keyword added specifically so apps could run WASM without the much broader `'unsafe-eval'`.)
- ❌ It does **not** loosen `connect-src`, `img-src`, etc. — those stay as-is.

**So the only new capability granted is: "code that can already run on the page may also run WebAssembly."**

## 4. Risk assessment
**Threat model:** the danger of `'wasm-unsafe-eval'` is that *if an attacker can already inject/execute script in the renderer*, they could also compile and run arbitrary WASM (e.g., a faster/obfuscated payload).

**But injecting script is already the game-over condition** — and we specifically hardened against it:
- `script-src 'self'` with **no `'unsafe-inline'`** (the CSP refactor) blocks inline/injected `<script>` and event handlers.
- The imported-protocol **XSS fix + sanitization** closed the known injection path.
- The renderer makes provider calls over IPC / same-origin BYOK; no third-party script origins.

So the **marginal** risk of adding `'wasm-unsafe-eval'` is **low and conditional**: it only helps an attacker who has *already* defeated `script-src 'self'`, at which point they have arbitrary JS anyway. WASM doesn't grant new reach (no DOM/network powers beyond what JS already has).

**Honest caveats:**
- The relaxation is **global and permanent** — it applies to the whole renderer for **all** users, including those who never enable the camera. We **cannot** scope it to "only when facial affect is on" (a CSP meta tag is document-wide; nonces/hashes don't apply to WASM).
- It does **weaken** a control we deliberately tightened in the audit (Codex graded the CSP work as part of reaching A). This is a real regression in CSP strictness, even if the practical risk is small.
- Bundling ~6–7 MB of opaque binaries grows the repo and the app; integrity must be pinned (SHA256SUMS) so a supply-chain swap is detectable.

## 5. Alternatives considered
| Option | CSP impact | Notes |
|---|---|---|
| **A. Model-free (shipped)** | none | Stillness/fidget/presence via frame-diff. Honest, limited — no landmarks/affect. **This is live in v3.3.2.** |
| **B. MediaPipe, bundled** | `+ 'wasm-unsafe-eval'` (global, permanent) | Full landmarks/affect, on-device. Vendored assets, real-device test. **This memo's subject.** |
| **C. MediaPipe via CDN** | `'wasm-unsafe-eval'` **and** loosen `connect-src`/`script-src` for googleapis | Strictly worse on CSP + adds a third-party origin + network dependency for a "sovereign" app. **Not recommended.** |
| **D. TensorFlow.js face model** | same `'wasm-unsafe-eval'` (or WebGL) | Same CSP cost; older/heavier face models, less turnkey than MediaPipe. |
| **E. Browser `FaceDetector` API** | none | Not broadly/consistently available across Electron/Chromium; bounding-box only, no landmarks. Unreliable. |

The CSP cost (B vs D) is the same; **B is the cleanest if we proceed at all.** **C is the worst** (don't CDN). **A is the safe status quo.**

## 6. Recommendation
**Lean: defer full MediaPipe unless facial affect is a priority feature — and if we proceed, do it as Option B with strict scoping.**

Rationale: the model-free signals (A, shipped) already give an *honest* settledness read; the *marginal* product value of true facial affect is moderate and **ethically fraught** (face→emotion inference is scientifically contested), while the CSP relaxation is **global, permanent, and walks back an audit win**. The risk is low *today* precisely because of the controls the relaxation slightly erodes — so it's a judgment call about how much we value strict-CSP-as-defense-in-depth vs. the feature.

**If you say GO**, the scoped plan:
1. CSP → `script-src 'self' 'wasm-unsafe-eval'` (renderer meta + landing CSP stays `'self'` only — landing has no WASM).
2. Vendor `vision_wasm_internal.{js,wasm}` + `face_landmarker.task` under `electron-app/renderer/vendor/mediapipe/`; add to `SHA256SUMS` + the checksum CI step; add `/vendor/mediapipe/*` to server `STATIC_ROUTES`.
3. **Lazy-load** the WASM/model only when the user enables facial affect (so the ~7 MB never loads for non-users; the CSP keyword is present regardless).
4. Consent-gated (off by default), camera-on indicator, **no frames stored or sent**, "visible signals *suggest*…" framing, deletable via the existing "Delete check-in data".
5. Feed head-pose/blink/affect into `GP_STATE` (valence/arousal) alongside mood/voice/stillness.
6. **Real-device test matrix** (lighting, skin tones, glasses, neurodivergence caveats) before release; ship behind a flag first.

**If you say NO-GO**, we keep the honest model-free camera signal (A) and mark T3-full "won't do / revisit," with no CSP change. The app stays at the audit's A-grade CSP posture.

## 7. Decision
- [ ] **GO** — accept `'wasm-unsafe-eval'` (global, permanent); proceed with the scoped plan in §6.
- [x] **NO-GO** — keep model-free signals; no CSP change. _(Chosen 2026-05-24. CSP stays `script-src 'self'`; the shipped stillness/fidget/presence camera signals remain the approach. Full MediaPipe facial affect is shelved unless re-prioritized.)_
- [ ] **Defer** — revisit after [date / milestone].

_Once decided, this memo + the choice should be linked from `V6_ROADMAP.md` (T3) and, if NO-GO, from `TODO.md`._

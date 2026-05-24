# Decision memo — Introduce an esbuild bundler for the renderer (V6·T8 next step)

**Status:** awaiting decision · **Owner:** Arturo · **Prepared by:** Claude
**TL;DR:** The renderer is now split into 4 focused classic-script files (good for *maintainability*), but load **performance is unchanged** — all ~290 KB still downloads + parses eagerly every launch. The next real lever is a **build step (esbuild)** that minifies and enables lazy-loading. The cost: the served `app.js` becomes a **build artifact** (not hand-edited), and the change touches **deploy, Electron Forge packaging, and CI** — plus it should be **coordinated with the repo owner**, who is actively editing the codebase. This memo lays out the options and a recommendation for a go/no-go.

---

## 1. Where we are (after T8 steps 1–4)
The renderer loads as a dependency-ordered chain of **classic scripts** (globals, no `import`/`export`):
```
app-data.js (content + Council prompts) → app-visuals.js (field/cinematic/HRV/audio)
→ app-affect.js (mood/voice/camera/biofield/state/palette) → app.js (core)
```
- `app.js`: **295 → 215 KB** (~27% off the monolith). Each file is independently reviewable.
- **But:** the browser/Electron still fetches + parses **all four files, eagerly, on every launch**. Splitting globals improved maintainability, not startup cost. On web there's marginally *more* HTTP overhead (4 requests); on desktop `file://` it's negligible.

## 2. What a bundler would actually buy
With **esbuild** (fast, tiny, zero-config-ish) compiling ES-module sources → one optimized bundle:
- **Minification** — realistically ~290 KB → **~150–180 KB** of JS (≈40% smaller download/parse). The single biggest startup win available.
- **Lazy-loading / code-splitting** — defer rarely-used chunks (e.g., command palette, network layer, the camera/voice affect code) so they load on first use, not at boot. Faster time-to-interactive.
- **True modules** — real `import`/`export`, dead-code elimination (tree-shaking), explicit dependencies instead of load-order-dependent globals (removes a class of "defined before use" footguns).
- **Source maps** — debuggable minified output.

## 3. The cost (why it's a deliberate decision, not "one more step")
- **`app.js` becomes a build artifact.** Today it's hand-edited and committed directly. With a bundler, the *source* lives in `src/*.mjs` and `app.js` (or `app.bundle.js`) is generated. Everyone editing the renderer must run/trust the build.
- **Touches three pipelines:**
  - **Deploy** — `server/package.json` `sync:app` copies `electron-app/renderer/` into the served `app/`. A build must run *before* sync (locally or in CI), and the built bundle must be present.
  - **Electron Forge** — the desktop package bundles `renderer/`; the build must run before `electron-forge make`.
  - **CI** — the parse/a11y/perf checks run against the renderer; they'd run against `src/` + a build step, and the perf budget would target the bundle.
- **ES-module conversion effort.** The 4 files are currently globals with bidirectional references resolved at runtime. Converting to `import`/`export` means making every cross-file dependency explicit — a real, careful pass (though far smaller now that the code is already split into 4 cohesive files).
- **Coordination.** The repo owner is actively working in `practice-room.js`/landing and has a release flow; a build-step change to the shared pipeline should be agreed, not surprise-landed.
- **CSP:** no change needed — esbuild output is plain JS served from `'self'`. (Unlike the MediaPipe/WASM question, the bundler does **not** touch the CSP.)

## 4. Options
| Option | Effort | Perf | Workflow change | Notes |
|---|---|---|---|---|
| **A. Stop here** | none | — | none | Maintainability win banked; classic-script chain stays. Honest, stable. |
| **B. Minify-only build** | small–med | ~40% smaller JS | medium (build artifact + pipelines) | esbuild bundles/minifies the existing files **without** ES-module rewrite. Fastest payoff per effort; still introduces the build-artifact workflow. |
| **C. Full ES modules + bundler** | large | ~40% smaller **+** lazy-loading | medium–high | True `import`/`export`, code-splitting, tree-shaking. The "right" end state; biggest effort. |
| **D. Defer** | none now | — | none | Revisit when there's a perf need or a maintenance lull, with the owner. |

## 5. Recommendation
**Defer the bundler for now (Option D), and if/when pursued, do Option B (minify-only) before C.**

Rationale:
- The **maintainability** goal of T8 is already achieved; the remaining win is **startup performance**, which isn't currently a reported pain point (the app boots fine; the field/WASM-free design is light).
- The bundler's cost is mostly **workflow + coordination**, not code — and that's exactly the kind of change worth doing **deliberately with the owner**, not at the tail of a long autonomous session.
- If a perf need does arise, **Option B (minify-only)** delivers ~80% of the benefit (the size win) for a fraction of C's effort and risk, and it's a clean stepping-stone to C later.

**If GO (B), the scoped plan:**
1. Add `esbuild` devDep + `npm run build:renderer` → bundles `app-data/app-visuals/app-affect/app.js` into one minified `app.bundle.js` (+ source map).
2. `index.html` loads the single bundle; keep the 4 source files as the editable inputs.
3. Wire the build into `sync:app` (server), the Forge `prePackage` hook (desktop), and CI (build, then run a11y/perf against the bundle).
4. Point the perf budget at the bundle (expect ~150–180 KB).
5. Verify: boot smoke (all features), a11y, perf, and a real desktop `make` on one platform.

## 6. Decision
- [ ] **A — Stop** (keep the 4-file classic-script chain; no build step)
- [ ] **B — Minify-only esbuild build** (single minified bundle; pipelines updated)
- [ ] **C — Full ES modules + bundler** (import/export, lazy-loading)
- [ ] **D — Defer** (revisit later, with the owner) ← *recommended*

_T8 is at a clean, shipped milestone (v3.3.4). This memo captures the bundler decision for when you're ready; nothing is blocked on it._

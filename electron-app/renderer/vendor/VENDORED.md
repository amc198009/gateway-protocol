# Vendored third-party libraries

These files are committed to the repo (not pulled from npm at build time) so
the desktop app works fully offline on first launch, with no CDN dependency.

Each file is integrity-pinned by SHA-256 in [`SHA256SUMS`](./SHA256SUMS). CI
runs `sha256sum -c SHA256SUMS` on every push, so any change to a vendored file
that isn't accompanied by a deliberate manifest update fails the build — this
is the supply-chain guard against a silently swapped dependency.

| File | Library | Version | License | Upstream |
|------|---------|---------|---------|----------|
| `three.min.js` | three.js | r169 (inferred from embedded deprecation refs; the SHA-256 below is the authoritative identifier) | MIT | https://github.com/mrdoob/three.js |

## Updating a vendored file

1. Replace the file with the new build.
2. Recompute the hash and rewrite the manifest:
   ```bash
   cd electron-app/renderer/vendor
   sha256sum three.min.js > SHA256SUMS
   ```
3. Update the version row in this file.
4. Commit the file, `SHA256SUMS`, and this doc together — the diff makes the
   dependency bump explicit and reviewable.

## Why not Subresource Integrity (`integrity=...`) on the `<script>` tag?

SRI on a same-origin `file://`/`app://` script in Electron is brittle (a hash
mismatch silently fails the load, which would break the whole Three.js field
with no obvious error). The CI checksum gate gives the same tamper-detection
guarantee without that runtime fragility. If the renderer is ever split into
ES modules served over `http(s)://`, revisit adding SRI then.

## idb-keyval

The README references `idb-keyval`, but the IndexedDB layer is implemented as
a small inline wrapper in `renderer/index.html` (search `idbStore`) — there is
no vendored `idb-keyval.js` file to pin.

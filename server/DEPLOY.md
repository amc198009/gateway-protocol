# Deploy runbook — making `/byok` + `/app` + PWA live

Everything is merged to `main`, but `gateway-protocol.fly.dev` runs the
previous image until someone runs `fly deploy` from a machine with `flyctl`
installed and authenticated. This container has no `flyctl` and no Fly auth,
so the deploy must run from your own computer. Steps below.

> **Precondition:** your local `main` must include the PWA work (the `/app`
> route + the `sync:app`/`build:app` script that copies the renderer into
> `server/app/`). Pull `main` first: `git -C ~/gateway-protocol pull origin main`.

## 1. Install flyctl (one time, no Homebrew needed)

```bash
curl -L https://fly.io/install.sh | sh
```

## 2. Put it on PATH + log in (interactive — run in your own terminal)

```bash
export FLYCTL_INSTALL="$HOME/.fly"
export PATH="$FLYCTL_INSTALL/bin:$PATH"
fly auth login        # opens a browser for SSO
```

## 3. Deploy

```bash
cd ~/gateway-protocol/server && npm run deploy
```

- Use `npm run deploy`, **not** a bare `fly deploy` — the npm script first
  syncs the renderer into `server/app/` so `/app` has files to serve.
  A bare `fly deploy` skips that step and `/app` would 404.
- The app already exists, so this updates the existing machine — no
  `fly launch` needed.
- If Fly ever prompts to scale to 2 machines, **decline**: rooms + feed are
  in-memory and `fly.toml` enforces a single machine.

## 4. Verify it went live

```bash
curl -s https://gateway-protocol.fly.dev/byok/status; echo
curl -s -o /dev/null -w "%{http_code}\n" https://gateway-protocol.fly.dev/app
curl -s https://gateway-protocol.fly.dev/version; echo
```

Success looks like:

| Endpoint | Before (stale image) | After deploy |
|---|---|---|
| `/byok/status` | `404 {"error":"not found"}` | `{"ok":true,"mode":"byok",...}` |
| `/app` | `404` | `200` (text/html) |
| `/version` | old version/timestamp | newer (bump `server/version.json` to make the change obvious) |

Once `/app` returns `200`, open `https://gateway-protocol.fly.dev/app` in
Safari on iPhone → **Share → Add to Home Screen** to install the PWA.

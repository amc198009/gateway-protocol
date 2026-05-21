# Gateway Protocol — Reference Server

The desktop app at `/electron-app` can practice **solo** with no server. To enable **Community Practice Rooms** and the **Transmission Feed** (V7), point the app at a running instance of this server.

This directory is the reference implementation. It runs anywhere Node 18+ runs.

## Run locally (dev)

```bash
cd server
npm install
npm start        # listens on :7070

# Verify:
curl http://localhost:7070/
# → {"ok":true,"service":"gateway-protocol-server","rooms":0,"feedSize":0,"uptime":1}
```

In the desktop app, go to **Settings → Network** and set the server URL to `http://localhost:7070`. Then open the **Network** tab to use Practice Rooms and the Feed.

## Architecture

```
┌──────────── HTTP server on :7070 ────────────┐
│                                              │
│   GET  /              health/status          │
│   GET  /feed?...      list transmissions     │
│   POST /feed          publish transmission   │
│   POST /feed/:id/react   reaction++          │
│                                              │
│   WS   /room/:CODE    practice room          │
│         host-driven timer + phase sync       │
│         anonymous presence count             │
│                                              │
└──────────────────────────────────────────────┘
            │                          │
            ▼                          ▼
    in-memory Map           in-memory ring buffer
    (rooms)                 (feed, capped at FEED_MAX)
```

**State is in-memory.** Rooms disappear when the last participant leaves (after a 30-min grace period). The feed is a ring buffer capped at 500 items by default. For real production, swap both for Redis or Postgres — search the file for "swap for Redis" markers.

## Environment

| Var | Default | Notes |
|---|---|---|
| `PORT` | `7070` | Listen port |
| `HOST` | `0.0.0.0` | Listen host |
| `ALLOW_ORIGIN` | `*` | CORS origin. **Restrict in production** to your app's origin |
| `FEED_MAX` | `500` | Ring buffer size |

## Deploy

### Fly.io (recommended for global low-latency rooms)

```bash
# In /server/
fly launch --no-deploy

# Deploy with the current git HEAD baked in as COMMIT_SHA — the landing
# page footer links source to that exact commit instead of the moving
# `main` ref.
npm run deploy

# (equivalent to:)
# fly deploy --remote-only --build-arg COMMIT_SHA=$(git -C .. rev-parse HEAD)
```

`fly.toml` (create this):
```toml
app = "gateway-protocol"
primary_region = "iad"     # pick closest to your users

[build]
  dockerfile = "Dockerfile"

[http_service]
  internal_port = 7070
  force_https = true
  auto_stop_machines = false   # WebSockets need persistent processes
  min_machines_running = 1

[[services.ports]]
  port = 443
  handlers = ["tls", "http"]
```

`Dockerfile`:
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 7070
ENV PORT=7070
CMD ["node", "practice-room.js"]
```

### Render.com

1. New → Web Service → connect this repo → set Root Directory to `server`
2. Build: `npm ci --omit=dev` · Start: `node practice-room.js`
3. Set env `PORT=10000` (Render's default) — and add a single-line patch: `PORT=${PORT:-7070}` is already in the code, so this just works
4. **Important:** Render's free tier sleeps after 15min of inactivity. WebSockets drop. Use the paid tier for real rooms.

### Railway

Same as Render — connect repo, set Root Directory, deploy. Railway honors `$PORT` natively.

## Scaling

Single Node process per machine. The in-memory state means:
- ✅ A few hundred concurrent connections per machine: fine
- ❌ Sharding across machines: rooms on different boxes can't see each other

For multi-region or horizontal scale, the migration looks like:
1. Add Redis as the state store (replace `rooms` Map and `feed` array)
2. Use Redis Pub/Sub for cross-machine room broadcasts
3. Sticky sessions on the WS layer (so a room's clients all land on the same machine, then Pub/Sub backstops them)
4. Add JWT-based auth if you want non-anonymous rooms

The desktop app's client code is agnostic to any of that.

## Security checklist (before production)

The current code is **deliberately permissive** to make local dev frictionless. Before exposing this on the public internet:

- [ ] Lock `ALLOW_ORIGIN` to your actual app origin
- [ ] Add rate limiting per IP (e.g. `express-rate-limit` if you migrate to Express, or a simple in-process counter)
- [ ] Add input validation beyond the current length caps — sanitize HTML in transmissions before they're stored
- [ ] Add `helmet`-equivalent headers (CSP, X-Frame-Options, etc.)
- [ ] Move to wss:// only (TLS termination at the platform layer, or via a reverse proxy)
- [ ] Add abuse detection: same IP flooding the feed, room code spam, etc.
- [ ] Honor a takedown queue: nothing in the feed should be permanent at this stage
- [ ] Privacy policy + terms of service link in the app pointing at hosted versions
- [ ] Logging strategy: don't log transmission content (it's spiritual journal data)

## License

Same as the parent repo: currently UNLICENSED. Personal use, contributions welcome via PR.

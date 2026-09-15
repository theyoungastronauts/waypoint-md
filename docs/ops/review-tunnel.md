# Public review tunnel

How the public review surface (`/r/*` and `/api/r/*`) becomes reachable from
outside the tailnet, and nothing else does.

This is the runbook for the Mac mini that serves Waypoint. Nothing here is
applied automatically — every step below is run by hand, once.

**What this exposes.** Exactly two path prefixes, on a hostname of their own:

| Public path | Serves |
|---|---|
| `/r/<publication-id>?k=<token>` | The review page for one render |
| `/api/r/<publication-id>` | That page's data, and its comment endpoint |

Everything else — the login page, the queue, the publications UI, `/api/health`,
every other API route — returns 404 **at Cloudflare's edge**, before it reaches
the app. The app's own middleware enforces the same boundary independently
(`lib/auth.ts`, `OPEN_PREFIXES`), so a misconfigured ingress rule cannot open the
authoring surface on its own. The two are the same claim made twice, on purpose.

Authoring stays on `waypoint.home.tylersavery.com` (tailnet only) and is
unaffected by any of this.

## Prerequisites

- `cloudflared` on the Mac mini (2026.7.1 or later): `cloudflared --version`.
- The `tylersavery.com` zone in the Cloudflare account, and `cloudflared` logged
  in to it: `cloudflared tunnel login` (opens a browser, writes
  `~/.cloudflared/cert.pem`). Only needed once per machine.
- Waypoint running on `localhost:3000` under launchd, as it already does.

## 1. Create the tunnel

```bash
cloudflared tunnel create waypoint-review
```

This prints a tunnel UUID and writes `~/.cloudflared/<UUID>.json` (the tunnel's
credentials). Keep the UUID — the config and the launchd job both name it.

A credential from an earlier tunnel already sits in `~/.cloudflared`. Reuse it
only if `cloudflared tunnel list` shows that tunnel is otherwise unused;
otherwise create the new one above, which is cheap.

## 2. Write the ingress config

`~/.cloudflared/config.yml` — the path rules are the security boundary, so read
them once more before saving. Ingress rules are evaluated **in order**, and the
first match wins; the final catch-all is what makes everything else 404.

```yaml
tunnel: <UUID>
credentials-file: /Users/tyler/.cloudflared/<UUID>.json

ingress:
  # The review page and its API — the only two public prefixes.
  - hostname: review.tylersavery.com
    path: ^/r/.+
    service: http://localhost:3000
  - hostname: review.tylersavery.com
    path: ^/api/r/.+
    service: http://localhost:3000

  # Next.js build assets, so the page can load its JS and CSS. Without this the
  # review page renders but never hydrates — no composer, no region marks.
  # These are content-hashed static build output (never gated by the app's
  # middleware, in any deployment) and hold no secret: R2 credentials, the auth
  # token, and every review token are server-side only and never reach a bundle.
  - hostname: review.tylersavery.com
    path: ^/_next/static/.+
    service: http://localhost:3000

  # Everything else on this hostname, and every other hostname.
  - service: http_status:404
```

Validate before running it:

```bash
cloudflared tunnel ingress validate
cloudflared tunnel ingress rule https://review.tylersavery.com/r/abc     # → localhost:3000
cloudflared tunnel ingress rule https://review.tylersavery.com/api/health # → http_status:404
cloudflared tunnel ingress rule https://review.tylersavery.com/login      # → http_status:404
```

The second and third commands are the test that matters. If either resolves to
`localhost:3000`, stop and fix the rules.

## 3. Point DNS at the tunnel

```bash
cloudflared tunnel route dns waypoint-review review.tylersavery.com
```

This creates a proxied CNAME in the zone. Confirm in the Cloudflare dashboard
that the record is **Proxied** (orange cloud), not DNS-only.

## 4. Run it under launchd

`~/Library/LaunchAgents/com.tyler.waypoint-review-tunnel.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.tyler.waypoint-review-tunnel</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/cloudflared</string>
    <string>tunnel</string>
    <string>--config</string>
    <string>/Users/tyler/.cloudflared/config.yml</string>
    <string>run</string>
    <string>waypoint-review</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/Users/tyler/Library/Logs/waypoint-review-tunnel.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/tyler/Library/Logs/waypoint-review-tunnel.err.log</string>
</dict>
</plist>
```

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.tyler.waypoint-review-tunnel.plist
launchctl kickstart -k gui/$(id -u)/com.tyler.waypoint-review-tunnel
```

Check `cloudflared --version` against the path in the plist — Homebrew installs
to `/opt/homebrew/bin` on Apple silicon and `/usr/local/bin` on Intel.

## 5. Tell Waypoint the public hostname

Review links are minted server-side and have to name the public host, since the
authoring UI is served from a different one. Add to `~/.waypoint/env`:

```
WAYPOINT_REVIEW_PUBLIC_URL=https://review.tylersavery.com
```

Then restart the app: `launchctl kickstart -k gui/$(id -u)/com.tyler.waypoint`.

Without it, review links render as relative paths (`/r/<id>?k=…`) and the
Publications UI says so — the links still work for anyone already on the tailnet,
but they are not shareable.

## 6. Verify from outside the tailnet

From a phone on cellular, or any machine not on the tailnet:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://review.tylersavery.com/api/health   # 404
curl -s -o /dev/null -w '%{http_code}\n' https://review.tylersavery.com/login        # 404
curl -s -o /dev/null -w '%{http_code}\n' https://review.tylersavery.com/publications # 404
curl -s -o /dev/null -w '%{http_code}\n' "https://review.tylersavery.com/r/<id>?k=<token>"  # 200
curl -s -o /dev/null -w '%{http_code}\n' "https://review.tylersavery.com/r/<id>?k=wrong"    # 404
```

Then open the review link on the phone and leave a note. The note should appear
attributed to the name the link was minted for.

## Revoking access

Two different things can be revoked, and they are not interchangeable:

**Revoking a review link** (Publications → Review links → Revoke, or
`waypoint links <publication-id> --revoke <link-id>`) kills that URL immediately
and completely. The publication and every note left through the link survive.
There is no cache in front of this — the token is checked in SQLite on every
request. **This is the immediate kill switch; reach for it first.**

**Revoking the publication** deletes the R2 objects, which stops the *file* being
served — eventually. `dropzone.tylersavery.com` is Cloudflare-fronted and the
objects are served with `cache-control: max-age=14400`, so a deleted object can
keep answering **200 from the edge for up to four hours** for anyone who has the
direct file URL. The review page itself goes dark at once (a revoked publication
404s there), but the bytes do not.

So a revoke that has to be immediate takes a third step:

```bash
# Purge the file (and its manifest, if published) from Cloudflare's cache by URL.
curl -X POST "https://api.cloudflare.com/client/v4/zones/<ZONE_ID>/purge_cache" \
  -H "Authorization: Bearer <CACHE_PURGE_TOKEN>" \
  -H "Content-Type: application/json" \
  --data '{"files":[
    "https://dropzone.tylersavery.com/smitty/shares/<uuid>/<name>.mp4",
    "https://dropzone.tylersavery.com/smitty/shares/<uuid>/<name>.manifest.json"
  ]}'
```

The URLs are the ones the publication detail page lists. The API token needs only
the **Zone → Cache Purge** permission on the `tylersavery.com` zone; do not reuse
the tunnel credential for it. The dashboard equivalent is Caching → Configuration
→ Purge Cache → Custom Purge → by URL.

Automating this purge inside `revoke` is the obvious follow-up and is not built:
it needs a second credential in the app's environment, and the link revoke — the
one a leaked *review* URL actually needs — is already instant.

## Troubleshooting

- **The page loads but has no styling and does not respond.** The `/_next/static`
  ingress rule is missing or misordered. Re-run `cloudflared tunnel ingress
  validate` and check rule order.
- **Everything 404s, including `/r/…`.** The catch-all is matching first: the
  `path` regexes are evaluated in order, so the `http_status:404` rule must be
  last and must have no `hostname`.
- **`502 Bad Gateway`.** The tunnel is up but Waypoint is not:
  `launchctl print gui/$(id -u)/com.tyler.waypoint`.
- **A link 404s for the reviewer but works on the tailnet.** The reviewer is
  hitting the public hostname with a token minted before the link was revoked, or
  the publication has since been revoked. Check Publications → Review links.
- **Logs.** `tail -f ~/Library/Logs/waypoint-review-tunnel.log`, and
  `cloudflared tunnel info waypoint-review` for connection state.

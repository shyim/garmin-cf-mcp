# Garmin MCP on Cloudflare Workers

Multi-tenant MCP server for Garmin Connect. A Cloudflare Workers port of
[taxuspt/garmin_mcp](https://github.com/taxuspt/garmin_mcp): the original 156
tools, plus `garmin_status`, `garmin_connect`, `garmin_disconnect`, and
`garmin_api` and `upload_activity_image`.

The public server is **https://garmin.shyim.de/mcp**. Add that URL to an MCP
client, sign in with your Garmin account, and the client can read and update
your Connect data. Each account is its own tenant.

Your Garmin password is sent to Garmin once and never stored. This server keeps
the resulting access tokens, AES-GCM encrypted per account. Sign-in uses the
same mobile flow as
[python-garminconnect](https://github.com/cyberjunky/python-garminconnect).
Garmin does not publish that flow as a public API and may rate-limit or
CAPTCHA it; the sign-in page says so, and pasting `garmin_tokens.json` still
works.

## Connect

Server URL:

```
https://garmin.shyim.de/mcp
```

The client discovers OAuth, opens a browser, and you sign in with your Garmin
email, password, and MFA code if Garmin asks for one. No API key.

**Cursor** — `~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` (one project):

```json
{
  "mcpServers": {
    "garmin": {
      "url": "https://garmin.shyim.de/mcp"
    }
  }
}
```

**Claude Code:**

```
claude mcp add --transport http garmin https://garmin.shyim.de/mcp
```

Then run `/mcp` in Claude Code and finish the browser sign-in.

Other clients that support remote HTTP MCP (Claude, MCP Inspector, and others)
take the same URL.

Returning users get a **Continue as …** button (30-day browser session) instead
of typing the password again for a second client.
[https://garmin.shyim.de/account](https://garmin.shyim.de/account) shows the
connection, lists authorized clients, and can revoke one, sign out, or delete
everything stored here. Your Garmin account itself is not deleted.

## What the tools cover

The client lists every tool. They follow the original server, grouped roughly as:

- activities, splits, weather, gear, manual logs, FIT/GPX/TCX/CSV download links
- sleep, stress, heart rate, HRV, steps, Body Battery, SpO2, respiration, weight
- training status, readiness, load (CTL/ATL/TSB), VO2max, workouts, courses, calendar
- devices, profile, nutrition, goals, badges, challenges

`download_activity_file` returns a link that works for 10 minutes. Workers
cannot write a FIT file to your disk. `set_fit_download_dir` is the one
original tool that has no equivalent.

### Activity photo upload

`upload_activity_image(activity_id, image_base64, filename)` attaches **one**
JPEG or PNG photo to an existing activity using the signed-in user's Garmin
tokens. It does not import activity files or change activity fields.

| Argument | Format |
|---|---|
| `activity_id` | Positive integer, or decimal string (preferred for large IDs) |
| `image_base64` | Padded standard Base64, without whitespace or a `data:` prefix; at most **5 MiB decoded** |
| `filename` | Basename ending in `.jpg`, `.jpeg` or `.png`, at most 128 characters |

The filename and image signature must agree. The tool validates input before
network access, reads the activity's current image IDs, then sends
`POST /activity-service/activity/{id}/image` with multipart field `file`.
`fetch` supplies the Content-Type boundary; the existing token refresh and
per-user token persistence are reused. No external image host, URL fetching,
extra secrets, or persistent image storage is required.

The result separates acceptance from verification:

```json
{
  "activity_id": "123456789",
  "uploaded": true,
  "verified": true,
  "image_ids": ["new-image-id"]
}
```

Verification reads `metadataDTO.activityImages` from `get_activity`, up to
three times with one-second gaps. If the upload returns `imageId`, that new
ID must appear; otherwise exactly one new ID must appear relative to the
pre-upload snapshot. Concurrent uploads can make this fallback ambiguous.
Existing photos alone never count as verification.

If Garmin accepts the POST but visibility cannot be confirmed, the tool returns
`uploaded: true`, `verified: false`, and a warning. A failed/uncertain POST is
an MCP error. **Inspect `get_activity` before retrying either uncertain case**:
the photo may already exist. Only verification GETs are polled; the POST is
not repeated except after the existing client's 401 token-refresh flow.
Garmin may impose additional account/photo limits.

The tool honors `GARMIN_ENABLED_TOOLS` and `GARMIN_DISABLED_TOOLS`. Its MCP
annotations identify it as a non-idempotent write. The generic `garmin_api`
tool remains GET-only.

The request shape and detail-response field were checked against Garmin
Connect web app **5.31.2.2** (2026-11-11), specifically its public
[activity API module](https://connect.garmin.com/web-react/static/js/async/pma.49900eb6.chunk__5.31.2.2.js)
and [activity photo UI](https://connect.garmin.com/web-react/static/js/async/yl.96e48aef.chunk__5.31.2.2.js).
These are undocumented Garmin endpoints. Automated tests mock Garmin;
a real account upload still needs a deployed server and a live smoke test.

For that smoke test, choose an activity you own, note its current image IDs,
call the tool with a small JPEG/PNG encoded as above, then confirm the new
ID in `get_activity.metadataDTO.activityImages` and the photo in Connect.
An accepted but unverified result should be inspected rather than re-uploaded.

## Self-host

You need Node, a Cloudflare account, and a Wrangler login.

```
npm install
npx wrangler login
npx wrangler kv namespace create GARMIN_KV
npx wrangler kv namespace create OAUTH_KV
```

The two namespaces may be the same id; their key prefixes do not collide.
Paste the printed ids into `wrangler.jsonc`. The ids and the
`garmin.shyim.de` route already in that file are the public instance.
Replace both before you deploy, or remove `routes` and use the `workers.dev`
hostname Wrangler prints.

```
openssl rand -hex 32 | npx wrangler secret put ENCRYPTION_KEY
npx wrangler secret put ADMIN_SECRET   # optional, Bearer for /admin/*
npm run deploy
```

Point a client at `https://<your-worker>/mcp`.

`GARMIN_ENABLED_TOOLS` (allowlist) and `GARMIN_DISABLED_TOOLS` (denylist) are
plain vars in `wrangler.jsonc`, comma-separated tool names, same as the
original server. `GARMIN_DOMAIN` is `garmin.com` or `garmin.cn`.

### Local dev

Run `npm run typecheck` and `npm test` (Node 20+). Tests compile into the ignored
`.test-build/` directory and use Node's built-in test runner, with no Garmin
credentials or live writes. They cover multipart bytes and boundaries, token
refresh/retry, tenant domains, validation, verification, errors and tool filters.

```
cp .dev.vars.example .dev.vars
npm run dev
```

`wrangler dev` rewrites request URLs to the first `routes` host. With this
repo's config, that host is `garmin.shyim.de`, so local OAuth metadata shows
that name. Change or remove the route before testing a different deployment.
Hand-testing OAuth then uses `resource=http://<that-host>/mcp`.

### Admin

Optional, `Authorization: Bearer $ADMIN_SECRET`.

- `GET /admin/users` — Garmin-linked tenants (`g_…`, display name, last sign-in).
- `DELETE /admin/users/<userId>` — revoke their grants, delete tokens and the user record.
- `POST /admin/tenants {"label"}` / `GET /admin/tenants` /
  `DELETE /admin/tenants/<id>?wipe=true` — legacy static keys (`mcp_…`).

New users do not need static keys. Existing ones still authenticate to `/mcp`
as `Authorization: Bearer mcp_…`. `/connect?key=…` links Garmin for that key.
The key is a secret; it shows up in browser history when it is in the query
string.

### Auth, in order

1. The client hits `/mcp`, gets 401, and discovers OAuth metadata.
2. It registers (Client ID Metadata Document or dynamic client registration) and opens `/authorize`.
3. The user signs in. The Worker runs Garmin's mobile SSO, exchanges the
   service ticket for DI OAuth tokens, and stores them under
   `garmin:g_<garminProfileId>`.
4. The client receives its own OAuth access and refresh tokens (PKCE, rotating
   refresh). Tool calls use that user's Garmin tokens, which refresh on expiry.

Two fallbacks live on the sign-in page and as tools: paste `garmin_tokens.json`
from the original `garmin-mcp-auth` CLI, or keep using a legacy static key.

### KV layout (`GARMIN_KV`)

| prefix | content |
|---|---|
| `garmin:<userId>` | AES-GCM encrypted DI tokens (`garmin_tokens.json` shape + domain, displayName) |
| `user:<userId>` | display name, full name, domain, created/last sign-in |
| `session:<sid>` | browser session → userId (30 d TTL) |
| `pending:<nonce>` | encrypted in-progress sign-in, including Garmin SSO cookies for MFA (15 min TTL) |
| `dl:<nonce>` | activity download grant (10 min TTL) |
| `tenant-key:<sha256>` / `tenant-user:<id>` | legacy static keys |

`OAUTH_KV` is owned by `@cloudflare/workers-oauth-provider` (clients, grants,
hashed tokens; grant props are encrypted).

Anyone who can read `ENCRYPTION_KEY` can decrypt every stored Garmin session.
Rotate it only with a plan to have users sign in again: old ciphertext will
not open under a new key.

## Differences from the original

- `download_activity_file` returns a temporary URL and a byte size.
  `upload_course` takes inline `gpx_content` instead of a file path.
- FIT analysis (`get_power_duration_curve` and the related tools) uses a
  minimal edge parser for power records, about 1 Hz assumed, instead of
  `fitparse`. The tool output says so.
- Trend tools (`get_training_load_trend`, `get_hrv_trend`, `get_vo2max_trend`,
  `get_respiration_trend`, `get_sleep_summary_range`) compute server-side from
  daily endpoints, as the original does.
- `garmin_api` calls any Connect API GET path the server has not wrapped. The
  path is checked and stays on `connectapi.garmin.com` or `connectapi.garmin.cn`.
- If Garmin later rejects stored tokens, `garmin_status` tells the user to
  sign in again at `/account`. Existing client grants stay valid.

## License

[MIT](LICENSE). Tool definitions and workout templates are adapted from
[taxuspt/garmin_mcp](https://github.com/taxuspt/garmin_mcp). Connect API paths
and the mobile sign-in flow are adapted from
[cyberjunky/python-garminconnect](https://github.com/cyberjunky/python-garminconnect).
Both are MIT. Their copyright notices are in [NOTICE](NOTICE).

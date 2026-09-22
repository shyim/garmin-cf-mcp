// Server-rendered pages (no build step). Everything user- or client-supplied
// goes through esc().
import { esc } from "../util.js";

export function layout(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="robots" content="noindex"/>
<title>${esc(title)}</title>
<style>
:root{color-scheme:light dark;--fg:#111827;--muted:#6b7280;--bg:#fff;--card:#f9fafb;--line:#e5e7eb;--accent:#111827;--accent-fg:#fff;--err:#b91c1c;--ok:#15803d}
@media(prefers-color-scheme:dark){:root{--fg:#f3f4f6;--muted:#9ca3af;--bg:#0b0f19;--card:#111827;--line:#1f2937;--accent:#f3f4f6;--accent-fg:#0b0f19;--err:#f87171;--ok:#4ade80}}
body{font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:3rem auto;padding:0 1rem;line-height:1.5;color:var(--fg);background:var(--bg)}
h1{font-size:1.5rem;margin:0 0 .5rem}h2{font-size:1.05rem;margin:0 0 .5rem}
p{margin:.5rem 0}.muted{color:var(--muted);font-size:.9rem}
code{background:var(--card);border:1px solid var(--line);border-radius:4px;padding:.1rem .3rem;font-size:.9em;word-break:break-all}
label{display:block;font-size:.9rem;margin:.75rem 0 .25rem}
input[type=text],input[type=email],input[type=password],select,textarea{width:100%;box-sizing:border-box;padding:.55rem .65rem;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg);font:inherit}
textarea{min-height:140px;font-family:ui-monospace,monospace;font-size:.85rem}
button{padding:.6rem 1.1rem;border-radius:6px;border:1px solid var(--accent);background:var(--accent);color:var(--accent-fg);cursor:pointer;font:inherit;margin-top:.75rem}
button.secondary{background:transparent;color:var(--fg);border-color:var(--line)}
button.danger{background:transparent;color:var(--err);border-color:var(--err)}
.card{border:1px solid var(--line);background:var(--card);border-radius:10px;padding:1rem 1.25rem;margin:1rem 0}
.err{color:var(--err)}.ok{color:var(--ok)}
details summary{cursor:pointer;color:var(--muted);font-size:.9rem;margin-top:1rem}
table{width:100%;border-collapse:collapse;font-size:.9rem}td,th{text-align:left;padding:.4rem .25rem;border-bottom:1px solid var(--line);vertical-align:top}
.row{display:flex;gap:.5rem;flex-wrap:wrap;align-items:center}
footer{margin-top:2rem;font-size:.85rem;color:var(--muted)}
</style></head><body>${body}
<footer><a href="/">Garmin MCP</a> · <a href="/account">Your account</a></footer></body></html>`;
}

const flash = (o: { error?: string | null; ok?: string | null }) =>
  o.error ? `<p class="err">${esc(o.error)}</p>` : o.ok ? `<p class="ok">${esc(o.ok)}</p>` : "";

export function homePage(mcpUrl: string): string {
  return layout(
    "Garmin MCP",
    `<h1>Garmin Connect MCP</h1>
<p>Give any MCP client access to your Garmin Connect data. Each person signs in
with their own Garmin account; data and tokens are isolated per account.</p>
<div class="card"><h2>Connect a client</h2>
<p>Add this server URL to your MCP client (Claude, Cursor, MCP Inspector, …):</p>
<p><code>${esc(mcpUrl)}</code></p>
<p>The client opens a browser window where you sign in with your Garmin email,
password and (if enabled) MFA code. No API keys, no local tools.</p></div>
<p class="muted">Your Garmin password is sent to Garmin only and never stored.
This server keeps just the resulting access tokens, encrypted per account.
Manage or revoke access any time on <a href="/account">your account page</a>.</p>`,
  );
}

export interface SignInPageOpts {
  nonce: string;
  /** What the user is granting access to, e.g. "Claude" or "your account page". */
  audience: string;
  audienceDetail?: string | null;
  /** If a browser session exists: offer "Continue as …". */
  continueAs?: { displayName: string } | null;
  domainDefault: string;
  error?: string | null;
  allowPaste?: boolean;
}

export function signInPage(o: SignInPageOpts): string {
  const hidden = `<input type="hidden" name="nonce" value="${esc(o.nonce)}"/>`;
  const cont = o.continueAs
    ? `<div class="card"><h2>Continue as ${esc(o.continueAs.displayName)}</h2>
<p class="muted">You signed in on this browser before.</p>
<form method="POST" action="/authorize/continue" class="row">${hidden}
<button type="submit">Continue as ${esc(o.continueAs.displayName)}</button></form>
<form method="POST" action="/authorize/switch">${hidden}<button type="submit" class="secondary">Use a different Garmin account</button></form></div>`
    : "";
  const paste = o.allowPaste === false
    ? ""
    : `<details><summary>Advanced: paste garmin_tokens.json instead</summary>
<form method="POST" action="/authorize/tokens">${hidden}
<p class="muted">If you already have a token file from the <code>garmin-mcp-auth</code> CLI
(taxuspt/garmin_mcp), paste its contents here. Same result, no password needed.</p>
<textarea name="tokens" placeholder='{"di_token":"…","di_refresh_token":"…","di_client_id":"…"}'></textarea>
<label>Garmin region</label><select name="domain">${domainOptions(o.domainDefault)}</select>
<button type="submit" class="secondary">Save tokens</button></form></details>`;
  return layout(
    `Sign in with Garmin`,
    `<h1>Sign in with Garmin</h1>
<p>Grant <strong>${esc(o.audience)}</strong> access to your Garmin Connect data.${
      o.audienceDetail ? ` <span class="muted">${esc(o.audienceDetail)}</span>` : ""
    }</p>
${flash({ error: o.error })}
${cont}
<div class="card"><h2>${o.continueAs ? "Or sign in with another account" : "Garmin account"}</h2>
<form method="POST" action="/authorize/login" autocomplete="on">${hidden}
<label for="email">Email</label><input id="email" type="email" name="email" required autocomplete="username" inputmode="email"/>
<label for="password">Password</label><input id="password" type="password" name="password" required autocomplete="current-password"/>
<label for="domain">Region</label><select id="domain" name="domain">${domainOptions(o.domainDefault)}</select>
<button type="submit">Sign in</button></form>
<p class="muted">Your credentials go straight to Garmin's sign-in service; this server
stores only the resulting access tokens, encrypted for your account. If your
account uses MFA you'll be asked for the code next.</p></div>
${paste}`,
  );
}

function domainOptions(def: string): string {
  return ["garmin.com", "garmin.cn"]
    .map((d) => `<option value="${d}"${d === def ? " selected" : ""}>${d === "garmin.cn" ? "China (garmin.cn)" : "Global (garmin.com)"}</option>`)
    .join("");
}

export function mfaPage(o: { nonce: string; method: string; error?: string | null }): string {
  const how = o.method.toLowerCase().includes("sms") ? "text message" : o.method.toLowerCase().includes("email") ? "email" : o.method;
  return layout(
    "Enter your Garmin MFA code",
    `<h1>One more step</h1>
<p>Garmin sent a verification code via <strong>${esc(how)}</strong>. Enter it below.</p>
${flash({ error: o.error })}
<div class="card"><form method="POST" action="/authorize/mfa" autocomplete="off">
<input type="hidden" name="nonce" value="${esc(o.nonce)}"/>
<label for="code">Verification code</label>
<input id="code" type="text" name="code" required inputmode="numeric" autocomplete="one-time-code" pattern="[0-9A-Za-z]{4,12}" autofocus/>
<button type="submit">Verify</button></form></div>
<p class="muted">Codes expire quickly. If yours stopped working, <a href="javascript:history.back()">go back</a> and sign in again.</p>`,
  );
}

export interface AccountPageOpts {
  displayName: string;
  fullName?: string;
  userId: string;
  connected: boolean;
  tokensUpdatedAt?: string | null;
  tokensValid?: boolean | null;
  grants: { id: string; clientName: string; createdAt: string }[];
  ok?: string | null;
  error?: string | null;
}

export function accountPage(o: AccountPageOpts): string {
  const status = !o.connected
    ? `<p class="err">No Garmin tokens stored — MCP tools will fail until you reconnect.</p>`
    : o.tokensValid === false
      ? `<p class="err">Stored Garmin tokens were rejected by Garmin. Reconnect below.</p>`
      : `<p class="ok">Garmin connected${o.tokensUpdatedAt ? ` · tokens refreshed ${esc(o.tokensUpdatedAt.slice(0, 16).replace("T", " "))} UTC` : ""}.</p>`;
  const grants = o.grants.length
    ? `<table><tr><th>Client</th><th>Since</th><th></th></tr>${o.grants
        .map(
          (g) => `<tr><td>${esc(g.clientName)}</td><td class="muted">${esc(g.createdAt.slice(0, 10))}</td>
<td><form method="POST" action="/account/revoke"><input type="hidden" name="grant" value="${esc(g.id)}"/><button type="submit" class="danger" style="margin:0;padding:.3rem .6rem">Revoke</button></form></td></tr>`,
        )
        .join("")}</table>`
    : `<p class="muted">No MCP clients authorized yet. Add the server URL in your client to get started.</p>`;
  return layout(
    "Your Garmin MCP account",
    `<h1>${esc(o.fullName || o.displayName)}</h1>
<p class="muted">Garmin profile <code>${esc(o.displayName)}</code> · tenant <code>${esc(o.userId)}</code></p>
${flash(o)}
<div class="card"><h2>Garmin connection</h2>${status}
<div class="row"><form method="GET" action="/account/reconnect"><button type="submit" class="secondary">Reconnect / re-sign in</button></form>
${o.connected ? `<form method="POST" action="/account/disconnect"><button type="submit" class="danger">Disconnect Garmin</button></form>` : ""}</div></div>
<div class="card"><h2>Authorized MCP clients</h2>${grants}</div>
<div class="card"><h2>Session &amp; data</h2>
<div class="row"><form method="POST" action="/account/logout"><button type="submit" class="secondary">Sign out of this browser</button></form>
<form method="POST" action="/account/wipe" onsubmit="return confirm('Delete stored Garmin tokens, revoke all MCP clients and forget this account?')"><button type="submit" class="danger">Delete everything</button></form></div>
<p class="muted">Deleting removes your encrypted tokens, every client grant and your user record from this server. Your Garmin account itself is untouched.</p></div>`,
  );
}

export function messagePage(title: string, message: string, opts?: { error?: boolean; backHref?: string; backLabel?: string }): string {
  return layout(
    title,
    `<h1>${esc(title)}</h1><p class="${opts?.error ? "err" : ""}">${esc(message)}</p>
<p><a href="${esc(opts?.backHref ?? "/")}">${esc(opts?.backLabel ?? "← home")}</a></p>`,
  );
}

/** Legacy static-key tenants: status + link to sign in / paste tokens. */
export function legacyConnectPage(o: {
  key: string;
  label: string;
  connected: boolean;
  updatedAt?: string | null;
  error?: string | null;
  ok?: string | null;
}): string {
  return layout(
    "Link Garmin (tenant key)",
    `<h1>Link Garmin</h1>
<p>Tenant <strong>${esc(o.label)}</strong> (legacy static key).</p>
${o.connected ? `<p class="ok">Garmin connected${o.updatedAt ? ` (updated ${esc(o.updatedAt)})` : ""}.</p>` : `<p class="err">No Garmin tokens stored yet.</p>`}
${flash(o)}
<div class="card"><form method="GET" action="/connect/start"><input type="hidden" name="key" value="${esc(o.key)}"/>
<button type="submit">${o.connected ? "Re-sign in with Garmin" : "Sign in with Garmin"}</button></form>
<p class="muted">Opens the Garmin sign-in (email, password, MFA) or lets you paste garmin_tokens.json.</p></div>
${o.connected ? `<form method="POST" action="/disconnect"><input type="hidden" name="key" value="${esc(o.key)}"/><button type="submit" class="danger">Disconnect (delete tokens)</button></form>` : ""}
<p class="muted">Tip: this key-based flow is kept for existing setups. New clients should simply add the MCP URL and use the built-in OAuth sign-in.</p>`,
  );
}

export function keyGatePage(next: string, error?: string | null): string {
  return layout(
    "Enter tenant key",
    `<h1>Tenant key required</h1>${flash({ error })}<form method="GET" action="${esc(next)}">
<label>Legacy tenant key</label><input type="text" name="key" placeholder="mcp_…" autocomplete="off"/>
<button type="submit">Continue</button></form>
<p class="muted">Don't have a key? You don't need one: add the MCP URL to your client and sign in with Garmin.</p>`,
  );
}

// Cloudflare entrypoint: OAuth 2.1 (MCP spec) + built-in "Sign in with Garmin".
//
//   MCP client  →  GET /mcp (401)  →  OAuth discovery  →  /authorize
//   /authorize  →  user signs in with Garmin email/password (+ MFA)
//               →  DI tokens stored encrypted under garmin:g_<profileId>
//               →  completeAuthorization → client gets its own access token.
//
// One Garmin account == one tenant. A browser session cookie lets returning
// users "Continue as …" without retyping their password; /account lists and
// revokes clients. Legacy static tenant keys (`mcp_…`) still work as bearer
// tokens via resolveExternalToken, and /connect?key= still links Garmin.

import { Hono, type Context } from "hono";
import { OAuthProvider, AuthorizationError, type AuthRequest } from "@cloudflare/workers-oauth-provider";
import { createMcpHandler } from "agents/mcp/server";
import type { Env, UserProps } from "./env.js";
import { buildGarminServer } from "./mcp/server.js";
import { loadTokens, saveTokens, deleteTokens, validateTokenShape, type GarminTokens } from "./store/tokens.js";
import { GarminClient, EP } from "./garmin/client.js";
import { startLogin, verifyMfa, fetchIdentity, garminUserId, normalizeDomain, GarminLoginError } from "./garmin/login.js";
import { createPending, loadPending, savePending, deletePending, type Pending, type PendingFlow } from "./auth/pending.js";
import { createSession, readSession, destroySession, sessionCookie, clearSessionCookie } from "./auth/sessions.js";
import { upsertUser, getUser, deleteUser, listUsers } from "./store/users.js";
import { readDownload } from "./store/downloads.js";
import { createTenant, verifyTenantKey, listTenants, revokeTenant, bearerKey } from "./auth/tenants.js";
import { safeEqual, formString } from "./util.js";
import * as pages from "./ui/pages.js";

export type { Env } from "./env.js";

type Ctx = Context<{ Bindings: Env }>;
const app = new Hono<{ Bindings: Env }>();

// ---------- guards ----------
const misconfigured = (c: Ctx) =>
  c.html(pages.messagePage("Server misconfigured", "ENCRYPTION_KEY is not set. Run `wrangler secret put ENCRYPTION_KEY`.", { error: true }), 500);

const expired = (c: Ctx) =>
  c.html(pages.messagePage("Sign-in expired", "This sign-in link expired or was already used. Start again from your MCP client or the account page.", { error: true, backHref: "/account", backLabel: "← account" }), 410);

function requireAdmin(c: Ctx): boolean {
  const key = bearerKey(c.req.raw);
  return !!key && !!c.env.ADMIN_SECRET && safeEqual(key, c.env.ADMIN_SECRET);
}

const unauthorized = () =>
  Response.json({ error: "Unauthorized. Send Authorization: Bearer <admin-secret>." }, { status: 401 });

/** Reject cross-site form posts (defense in depth on top of SameSite=Lax). */
app.use("*", async (c, next) => {
  if (c.req.method === "POST" && !c.req.path.startsWith("/admin/")) {
    const sfs = c.req.header("sec-fetch-site");
    const origin = c.req.header("origin");
    if ((sfs && sfs !== "same-origin" && sfs !== "none") || (origin && origin !== new URL(c.req.url).origin))
      return c.html(pages.messagePage("Blocked", "Cross-site request rejected.", { error: true }), 403);
  }
  await next();
});

// ---------- public ----------
app.get("/", (c) => c.html(pages.homePage(new URL("/mcp", c.req.url).toString())));
app.get("/healthz", (c) => c.text("ok"));

// ---------- OAuth authorize: sign in with Garmin ----------
app.get("/authorize", async (c) => {
  if (!c.env.ENCRYPTION_KEY) return misconfigured(c);
  let authRequest: AuthRequest;
  try {
    authRequest = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
  } catch (e) {
    if (!(e instanceof AuthorizationError)) throw e;
    if (!e.redirectUri)
      return c.html(pages.messagePage("Invalid authorization request", e.description, { error: true }), 400);
    const r = new URL(e.redirectUri);
    r.searchParams.set("error", e.code);
    r.searchParams.set("error_description", e.description);
    if (e.state) r.searchParams.set("state", e.state);
    if (e.issuer) r.searchParams.set("iss", e.issuer);
    return c.redirect(r.toString(), 302);
  }
  let clientName = "an MCP client";
  try {
    const client = await c.env.OAUTH_PROVIDER.lookupClient(authRequest.clientId);
    if (!client) return c.html(pages.messagePage("Unknown client", "This OAuth client is not registered.", { error: true }), 400);
    if (client.clientName) clientName = client.clientName;
  } catch (e) {
    return c.html(pages.messagePage("Client lookup failed", (e as Error).message, { error: true }), 400);
  }
  const pending = await createPending(c.env.GARMIN_KV, c.env.ENCRYPTION_KEY, { mode: "authorize", authRequest, clientName });
  return renderSignIn(c, pending);
});

function describeFlow(flow: PendingFlow, reqUrl: string): { audience: string; detail: string | null } {
  switch (flow.mode) {
    case "authorize": {
      let host = "";
      try { host = new URL(flow.authRequest.redirectUri).host; } catch { /* keep empty */ }
      return { audience: flow.clientName, detail: host ? `(after signing in you'll be sent back to ${host})` : null };
    }
    case "account":
      return { audience: `your account page on ${new URL(reqUrl).host}`, detail: null };
    case "legacy":
      return { audience: `tenant "${flow.label}"`, detail: "(legacy static key)" };
  }
}

async function renderSignIn(c: Ctx, pending: Pending, error?: string | null, opts?: { forceFresh?: boolean }) {
  let continueAs: { displayName: string } | null = null;
  if (!opts?.forceFresh && pending.flow.mode !== "legacy") {
    const session = await readSession(c.env.GARMIN_KV, c.req.raw);
    if (session) {
      const [user, tokens] = await Promise.all([
        getUser(c.env.GARMIN_KV, session.userId),
        loadTokens(c.env.GARMIN_KV, c.env.ENCRYPTION_KEY, session.userId),
      ]);
      if (user && tokens) continueAs = { displayName: user.fullName || user.displayName };
    }
  }
  const { audience, detail } = describeFlow(pending.flow, c.req.url);
  return c.html(
    pages.signInPage({
      nonce: pending.nonce,
      audience,
      audienceDetail: detail,
      continueAs,
      domainDefault: c.env.GARMIN_DOMAIN ?? "garmin.com",
      error: error ?? null,
    }),
    error ? 400 : 200,
  );
}

function loginErrorMessage(e: unknown): string {
  if (e instanceof GarminLoginError) return e.message;
  if (e instanceof Error && e.name === "TimeoutError") return "Garmin did not answer in time. Please try again.";
  return `Sign-in failed: ${(e as Error)?.message ?? String(e)}`;
}

async function pendingFromForm(c: Ctx, form: Record<string, unknown>): Promise<Pending | null> {
  if (!c.env.ENCRYPTION_KEY) return null;
  return loadPending(c.env.GARMIN_KV, c.env.ENCRYPTION_KEY, form.nonce);
}

app.post("/authorize/login", async (c) => {
  const form = await c.req.parseBody();
  const pending = await pendingFromForm(c, form);
  if (!pending) return expired(c);
  const email = formString(form.email).trim();
  const password = formString(form.password);
  const domain = normalizeDomain(form.domain, c.env.GARMIN_DOMAIN);
  if (!email || !password) return renderSignIn(c, pending, "Enter your Garmin email and password.");
  try {
    const result = await startLogin(email, password, domain);
    if (result.status === "mfa") {
      pending.mfa = result.pending;
      await savePending(c.env.GARMIN_KV, c.env.ENCRYPTION_KEY, pending);
      return c.html(pages.mfaPage({ nonce: pending.nonce, method: result.pending.mfaMethod }));
    }
    return finishSignIn(c, pending, result.tokens);
  } catch (e) {
    return renderSignIn(c, pending, loginErrorMessage(e));
  }
});

app.post("/authorize/mfa", async (c) => {
  const form = await c.req.parseBody();
  const pending = await pendingFromForm(c, form);
  if (!pending) return expired(c);
  if (!pending.mfa) return renderSignIn(c, pending, "The verification step expired — sign in again.");
  const code = formString(form.code).trim();
  if (!code) return c.html(pages.mfaPage({ nonce: pending.nonce, method: pending.mfa.mfaMethod, error: "Enter the code." }), 400);
  try {
    const tokens = await verifyMfa(pending.mfa, code);
    return finishSignIn(c, pending, tokens);
  } catch (e) {
    if (e instanceof GarminLoginError && e.kind === "mfa_code")
      return c.html(pages.mfaPage({ nonce: pending.nonce, method: pending.mfa.mfaMethod, error: e.message }), 400);
    delete pending.mfa;
    await savePending(c.env.GARMIN_KV, c.env.ENCRYPTION_KEY, pending);
    return renderSignIn(c, pending, loginErrorMessage(e));
  }
});

app.post("/authorize/tokens", async (c) => {
  const form = await c.req.parseBody();
  const pending = await pendingFromForm(c, form);
  if (!pending) return expired(c);
  let parsed: unknown;
  try {
    parsed = JSON.parse(formString(form.tokens));
  } catch {
    return renderSignIn(c, pending, "That wasn't valid JSON — paste the full garmin_tokens.json.");
  }
  if (!validateTokenShape(parsed)) return renderSignIn(c, pending, "Token file must contain di_token, di_refresh_token and di_client_id.");
  const tokens: GarminTokens = {
    di_token: parsed.di_token,
    di_refresh_token: parsed.di_refresh_token,
    di_client_id: parsed.di_client_id,
    domain: normalizeDomain(form.domain, parsed.domain ?? c.env.GARMIN_DOMAIN),
  };
  return finishSignIn(c, pending, tokens);
});

app.post("/authorize/continue", async (c) => {
  const form = await c.req.parseBody();
  const pending = await pendingFromForm(c, form);
  if (!pending) return expired(c);
  if (pending.flow.mode === "legacy") return renderSignIn(c, pending, "Sign in with Garmin to link this tenant.");
  const session = await readSession(c.env.GARMIN_KV, c.req.raw);
  if (!session) return renderSignIn(c, pending, "Your browser session expired — sign in again.", { forceFresh: true });
  const [user, tokens] = await Promise.all([
    getUser(c.env.GARMIN_KV, session.userId),
    loadTokens(c.env.GARMIN_KV, c.env.ENCRYPTION_KEY, session.userId),
  ]);
  if (!user || !tokens) return renderSignIn(c, pending, "Garmin is no longer connected for this account — sign in again.", { forceFresh: true });
  return completeFlow(c, pending, { userId: session.userId, displayName: user.displayName, fullName: user.fullName });
});

app.post("/authorize/switch", async (c) => {
  const form = await c.req.parseBody();
  const pending = await pendingFromForm(c, form);
  if (!pending) return expired(c);
  const session = await readSession(c.env.GARMIN_KV, c.req.raw);
  if (session) await destroySession(c.env.GARMIN_KV, session.sid);
  c.header("Set-Cookie", clearSessionCookie(c.req.raw));
  return renderSignIn(c, pending, null, { forceFresh: true });
});

/** Tokens in hand (fresh login, MFA, or paste): verify, store, then complete the flow. */
async function finishSignIn(c: Ctx, pending: Pending, tokens: GarminTokens) {
  let identity, verified;
  try {
    ({ identity, tokens: verified } = await fetchIdentity(tokens));
  } catch (e) {
    return renderSignIn(c, pending, `Garmin rejected the tokens: ${(e as Error).message}`);
  }
  const userId = pending.flow.mode === "legacy" ? pending.flow.userId : garminUserId(identity);
  await saveTokens(c.env.GARMIN_KV, c.env.ENCRYPTION_KEY, userId, verified);
  if (pending.flow.mode !== "legacy") {
    await upsertUser(c.env.GARMIN_KV, {
      userId,
      displayName: identity.displayName,
      fullName: identity.fullName,
      domain: verified.domain ?? "garmin.com",
    });
    const session = await createSession(c.env.GARMIN_KV, userId);
    c.header("Set-Cookie", sessionCookie(session.sid, c.req.raw));
  }
  return completeFlow(c, pending, { userId, displayName: identity.displayName, fullName: identity.fullName });
}

async function completeFlow(c: Ctx, pending: Pending, who: { userId: string; displayName: string; fullName?: string }) {
  await deletePending(c.env.GARMIN_KV, pending.nonce);
  switch (pending.flow.mode) {
    case "authorize": {
      const props: UserProps = { userId: who.userId, login: who.displayName, name: who.fullName };
      const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
        request: pending.flow.authRequest,
        userId: who.userId,
        metadata: { clientName: pending.flow.clientName, displayName: who.displayName },
        scope: pending.flow.authRequest.scope,
        props,
      });
      return c.redirect(redirectTo, 302);
    }
    case "account":
      return c.redirect("/account?ok=" + encodeURIComponent("Garmin connected."), 302);
    case "legacy":
      return c.redirect(`/connect?key=${encodeURIComponent(pending.flow.key)}&ok=${encodeURIComponent("Garmin connected.")}`, 302);
  }
}

// ---------- account page (session cookie) ----------
app.get("/account", async (c) => {
  if (!c.env.ENCRYPTION_KEY) return misconfigured(c);
  const session = await readSession(c.env.GARMIN_KV, c.req.raw);
  if (!session) {
    const pending = await createPending(c.env.GARMIN_KV, c.env.ENCRYPTION_KEY, { mode: "account" });
    return renderSignIn(c, pending, null, { forceFresh: true });
  }
  const url = new URL(c.req.url);
  const [user, tokens, grants] = await Promise.all([
    getUser(c.env.GARMIN_KV, session.userId),
    loadTokens(c.env.GARMIN_KV, c.env.ENCRYPTION_KEY, session.userId),
    c.env.OAUTH_PROVIDER.listUserGrants(session.userId).catch(() => ({ items: [] })),
  ]);
  let tokensValid: boolean | null = null;
  if (tokens) {
    const uid = session.userId;
    const client = new GarminClient(tokens, {
      onTokensRefreshed: (t) => saveTokens(c.env.GARMIN_KV, c.env.ENCRYPTION_KEY, uid, t).catch(() => undefined),
    });
    tokensValid = await client.get(EP.socialProfile).then(() => true, () => false);
  }
  return c.html(
    pages.accountPage({
      displayName: user?.displayName ?? tokens?.displayName ?? session.userId,
      fullName: user?.fullName,
      userId: session.userId,
      connected: !!tokens,
      tokensUpdatedAt: tokens?.updatedAt ?? null,
      tokensValid,
      grants: grants.items.map((g) => ({
        id: g.id,
        clientName: (g.metadata as { clientName?: string } | undefined)?.clientName ?? g.clientId,
        createdAt: new Date(g.createdAt * 1000).toISOString(),
      })),
      ok: url.searchParams.get("ok"),
      error: url.searchParams.get("error"),
    }),
  );
});

app.get("/account/reconnect", async (c) => {
  if (!c.env.ENCRYPTION_KEY) return misconfigured(c);
  const pending = await createPending(c.env.GARMIN_KV, c.env.ENCRYPTION_KEY, { mode: "account" });
  return renderSignIn(c, pending, null, { forceFresh: true });
});

async function requireSession(c: Ctx) {
  const session = await readSession(c.env.GARMIN_KV, c.req.raw);
  return session;
}

app.post("/account/disconnect", async (c) => {
  const session = await requireSession(c);
  if (!session) return c.redirect("/account", 302);
  await deleteTokens(c.env.GARMIN_KV, session.userId);
  return c.redirect("/account?ok=" + encodeURIComponent("Garmin tokens deleted. MCP clients stay authorized but will fail until you reconnect."), 302);
});

app.post("/account/revoke", async (c) => {
  const session = await requireSession(c);
  if (!session) return c.redirect("/account", 302);
  const form = await c.req.parseBody();
  const grantId = formString(form.grant);
  if (grantId) await c.env.OAUTH_PROVIDER.revokeGrant(grantId, session.userId).catch(() => undefined);
  return c.redirect("/account?ok=" + encodeURIComponent("Client access revoked."), 302);
});

app.post("/account/logout", async (c) => {
  const session = await requireSession(c);
  if (session) await destroySession(c.env.GARMIN_KV, session.sid);
  c.header("Set-Cookie", clearSessionCookie(c.req.raw));
  return c.redirect("/", 302);
});

async function wipeUser(env: Env, userId: string): Promise<number> {
  let revoked = 0;
  let cursor: string | undefined;
  do {
    const page = await env.OAUTH_PROVIDER.listUserGrants(userId, { cursor }).catch(() => ({ items: [], cursor: undefined }));
    for (const g of page.items) {
      await env.OAUTH_PROVIDER.revokeGrant(g.id, userId).catch(() => undefined);
      revoked++;
    }
    cursor = page.cursor;
  } while (cursor);
  await deleteTokens(env.GARMIN_KV, userId);
  await deleteUser(env.GARMIN_KV, userId);
  return revoked;
}

app.post("/account/wipe", async (c) => {
  const session = await requireSession(c);
  if (!session) return c.redirect("/account", 302);
  await wipeUser(c.env, session.userId);
  await destroySession(c.env.GARMIN_KV, session.sid);
  c.header("Set-Cookie", clearSessionCookie(c.req.raw));
  return c.html(pages.messagePage("Account deleted", "Your tokens, client grants and user record were removed from this server."));
});

// ---------- legacy static-key tenants ----------
app.get("/connect", async (c) => {
  const url = new URL(c.req.url);
  const key = url.searchParams.get("key");
  if (!key) {
    const session = await readSession(c.env.GARMIN_KV, c.req.raw);
    return session ? c.redirect("/account", 302) : c.html(pages.keyGatePage("/connect"));
  }
  const tenant = await verifyTenantKey(c.env.GARMIN_KV, key);
  if (!tenant) return c.html(pages.keyGatePage("/connect", "Unknown or revoked key."), 401);
  const tokens = c.env.ENCRYPTION_KEY ? await loadTokens(c.env.GARMIN_KV, c.env.ENCRYPTION_KEY, tenant.userId) : null;
  return c.html(
    pages.legacyConnectPage({
      key,
      label: tenant.label,
      connected: !!tokens,
      updatedAt: tokens?.updatedAt ?? null,
      error: url.searchParams.get("error"),
      ok: url.searchParams.get("ok"),
    }),
  );
});

app.get("/connect/start", async (c) => {
  if (!c.env.ENCRYPTION_KEY) return misconfigured(c);
  const key = new URL(c.req.url).searchParams.get("key") ?? "";
  const tenant = await verifyTenantKey(c.env.GARMIN_KV, key);
  if (!tenant) return c.html(pages.keyGatePage("/connect", "Unknown or revoked key."), 401);
  const pending = await createPending(c.env.GARMIN_KV, c.env.ENCRYPTION_KEY, {
    mode: "legacy",
    userId: tenant.userId,
    key,
    label: tenant.label,
  });
  return renderSignIn(c, pending, null, { forceFresh: true });
});

app.post("/disconnect", async (c) => {
  const form = await c.req.parseBody();
  const key = formString(form.key);
  const tenant = key ? await verifyTenantKey(c.env.GARMIN_KV, key) : null;
  if (tenant) await deleteTokens(c.env.GARMIN_KV, tenant.userId);
  return c.redirect(tenant ? `/connect?key=${encodeURIComponent(key)}&ok=${encodeURIComponent("Garmin disconnected.")}` : "/connect", 302);
});

// ---------- activity file download via minted link ----------
const DOWNLOAD_TYPES: Record<string, { path: string; type: string }> = {
  fit: { path: "files/activity", type: "application/octet-stream" },
  gpx: { path: "export/gpx/activity", type: "application/gpx+xml" },
  tcx: { path: "export/tcx/activity", type: "application/xml" },
  csv: { path: "export/csv/activity", type: "text/csv" },
};

app.get("/api/download/:nonce", async (c) => {
  if (!c.env.ENCRYPTION_KEY) return c.text("Server misconfigured", 500);
  const grant = await readDownload(c.env.GARMIN_KV, c.req.param("nonce"));
  if (!grant) return c.html(pages.messagePage("Link expired", "Download links are valid for 10 minutes. Ask the tool for a new one.", { error: true }), 404);
  const tokens = await loadTokens(c.env.GARMIN_KV, c.env.ENCRYPTION_KEY, grant.userId);
  if (!tokens) return c.text("Garmin not connected", 400);
  const m = DOWNLOAD_TYPES[grant.format] ?? DOWNLOAD_TYPES.fit;
  const client = new GarminClient(tokens, {
    onTokensRefreshed: (t) => saveTokens(c.env.GARMIN_KV, c.env.ENCRYPTION_KEY, grant.userId, t).catch(() => undefined),
  });
  try {
    const buf = await client.request<ArrayBuffer>("GET", `/download-service/${m.path}/${grant.activityId}`, { raw: true });
    return new Response(buf, {
      headers: {
        "Content-Type": m.type,
        "Content-Disposition": `attachment; filename="activity-${grant.activityId}.${grant.format}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return c.text(`Download failed: ${(e as Error).message}`, 502);
  }
});

// ---------- admin ----------
app.get("/admin/users", async (c) => {
  if (!requireAdmin(c)) return unauthorized();
  return Response.json({ users: await listUsers(c.env.GARMIN_KV) });
});

app.delete("/admin/users/:id", async (c) => {
  if (!requireAdmin(c)) return unauthorized();
  const id = c.req.param("id");
  const existed = !!(await getUser(c.env.GARMIN_KV, id));
  const revokedGrants = await wipeUser(c.env, id);
  return Response.json({ deleted: existed, revokedGrants });
});

app.post("/admin/tenants", async (c) => {
  if (!requireAdmin(c)) return unauthorized();
  let label = `tenant-${new Date().toISOString().slice(0, 10)}`;
  try {
    const body = (await c.req.json()) as { label?: string };
    if (body.label && typeof body.label === "string") label = body.label.slice(0, 80);
  } catch { /* label optional */ }
  const { userId, key } = await createTenant(c.env.GARMIN_KV, label);
  return Response.json({ userId, label, key, note: "Legacy static key — shown once. Prefer the OAuth sign-in for new users." }, { status: 201 });
});

app.get("/admin/tenants", async (c) => {
  if (!requireAdmin(c)) return unauthorized();
  return Response.json({ tenants: await listTenants(c.env.GARMIN_KV) });
});

app.delete("/admin/tenants/:id", async (c) => {
  if (!requireAdmin(c)) return unauthorized();
  const id = c.req.param("id");
  const existed = await revokeTenant(c.env.GARMIN_KV, id);
  const wipe = new URL(c.req.url).searchParams.get("wipe") === "true";
  if (existed && wipe) await deleteTokens(c.env.GARMIN_KV, id).catch(() => undefined);
  return Response.json({ revoked: existed, garmin_wiped: existed && wipe });
});

app.notFound((c) => c.html(pages.messagePage("Not found", "There's nothing here."), 404));

// ---------- protected MCP endpoint (props set by OAuthProvider) ----------
const apiHandler: ExportedHandler<Env> & { fetch: NonNullable<ExportedHandler<Env>["fetch"]> } = {
  async fetch(request, env, ctx) {
    const props = (ctx as ExecutionContext & { props?: Partial<UserProps> }).props;
    if (!props || typeof props.userId !== "string" || !props.userId)
      return Response.json({ error: "invalid_token" }, { status: 401 });
    const user: UserProps = { userId: props.userId, login: props.login ?? props.userId, name: props.name };
    const origin = new URL(request.url).origin;
    const handler = createMcpHandler(async () => {
      try {
        return await buildGarminServer(env, { user, origin });
      } catch (e) {
        console.error("buildGarminServer failed:", e instanceof Error ? e.stack ?? e.message : String(e));
        throw e;
      }
    }, {
      route: "/mcp",
      authContext: { props: { ...user } },
    });
    try {
      return await handler(request, env, ctx);
    } catch (e) {
      console.error("MCP handler failed:", e instanceof Error ? e.stack ?? e.message : String(e));
      return Response.json({ error: "server_error" }, { status: 500 });
    }
  },
};

export default new OAuthProvider<Env>({
  apiRoute: "/mcp",
  apiHandler,
  defaultHandler: { fetch: (request, env, ctx) => app.fetch(request, env, ctx) },
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/oauth/token",
  clientRegistrationEndpoint: "/oauth/register",
  clientIdMetadataDocumentEnabled: true,
  scopesSupported: ["garmin"],
  resourceMetadata: {
    scopes_supported: ["garmin"],
    bearer_methods_supported: ["header"],
    resource_name: "Garmin Connect MCP",
  },
  // Legacy static tenant keys keep working as bearer tokens.
  resolveExternalToken: async ({ token, env }) => {
    if (!token.startsWith("mcp_")) return null;
    const tenant = await verifyTenantKey(env.GARMIN_KV, token);
    if (!tenant) return null;
    const props: UserProps = { userId: tenant.userId, login: tenant.label };
    return { props };
  },
});

// Server-side Garmin Connect sign-in — port of python-garminconnect's
// "mobile" strategy:
//
//   1. GET  sso.<domain>/mobile/sso/en/sign-in           (session cookies)
//   2. POST sso.<domain>/mobile/api/login                → SUCCESSFUL | MFA_REQUIRED
//   3. POST sso.<domain>/mobile/api/mfa/verifyCode       (only when MFA is on)
//   4. POST diauth.<domain>/di-oauth2-service/oauth/token (service ticket →
//           DI OAuth2 access + refresh token — the garmin_tokens.json shape)
//
// Verified from a real Cloudflare Worker: Garmin's SSO answers these calls
// with JSON (no bot challenge). The password is forwarded to Garmin once and
// never stored or logged; only the DI tokens are kept, encrypted per user.

import { EP, GarminClient, NATIVE_HEADERS, basicAuth, decodeJwtPayload } from "./client.js";
import type { GarminTokens } from "../store/tokens.js";

export type GarminDomain = "garmin.com" | "garmin.cn";

export function normalizeDomain(v: unknown, fallback?: string): GarminDomain {
  const d = typeof v === "string" && v ? v : fallback;
  return d === "garmin.cn" ? "garmin.cn" : "garmin.com";
}

const SSO_CLIENT_ID = "GCM_IOS_DARK";
const SSO_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const DI_GRANT_TYPE = "https://connectapi.garmin.com/di-oauth2-service/oauth/grant/service_ticket";
const DI_CLIENT_IDS = [
  "GARMIN_CONNECT_MOBILE_ANDROID_DI_2025Q2",
  "GARMIN_CONNECT_MOBILE_ANDROID_DI_2024Q4",
  "GARMIN_CONNECT_MOBILE_ANDROID_DI",
  "GARMIN_CONNECT_MOBILE_IOS_DI",
];
const TIMEOUT_MS = 25_000;

export type LoginErrorKind = "credentials" | "mfa_code" | "rate_limited" | "captcha" | "blocked" | "unknown";

export class GarminLoginError extends Error {
  constructor(message: string, readonly kind: LoginErrorKind) {
    super(message);
  }
}

/** State needed to finish a sign-in after Garmin asked for an MFA code. */
export interface MfaPending {
  cookies: string;
  mfaMethod: string;
  domain: GarminDomain;
}

export type LoginResult = { status: "ok"; tokens: GarminTokens } | { status: "mfa"; pending: MfaPending };

const serviceUrl = (d: GarminDomain) => `https://mobile.integration.${d}/gcm/ios`;
const ssoQuery = (d: GarminDomain) =>
  new URLSearchParams({ clientId: SSO_CLIENT_ID, locale: "en-US", service: serviceUrl(d) }).toString();

function pageHeaders(): Record<string, string> {
  return {
    "User-Agent": SSO_UA,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Site": "none",
  };
}

function apiHeaders(sso: string, cookies: string): Record<string, string> {
  return {
    "User-Agent": SSO_UA,
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Content-Type": "application/json",
    Origin: sso,
    Referer: `${sso}/mobile/sso/en/sign-in?clientId=${SSO_CLIENT_ID}`,
    ...(cookies ? { Cookie: cookies } : {}),
  };
}

/** Merge Set-Cookie headers from a response into a `k=v; k2=v2` cookie jar. */
function mergeCookies(jar: string, res: Response): string {
  const map = new Map<string, string>();
  const add = (pair: string) => {
    const i = pair.indexOf("=");
    if (i > 0) map.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  };
  for (const part of jar.split(";")) if (part.trim()) add(part);
  for (const sc of res.headers.getSetCookie()) add(sc.split(";")[0]);
  return [...map].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function ssoJson(res: Response): Promise<Record<string, any>> {
  if (res.status === 429)
    throw new GarminLoginError("Garmin is rate-limiting sign-ins right now. Wait a few minutes and try again.", "rate_limited");
  const text = await res.text();
  let json: Record<string, any>;
  try {
    json = JSON.parse(text);
  } catch {
    throw new GarminLoginError(
      `Garmin SSO answered HTTP ${res.status} without JSON (bot challenge?). Try again later or paste garmin_tokens.json instead.`,
      "blocked",
    );
  }
  if (json?.error?.["status-code"] === "429")
    throw new GarminLoginError("Garmin is rate-limiting sign-ins right now. Wait a few minutes and try again.", "rate_limited");
  return json;
}

/** Step 1+2: submit credentials. Returns tokens, or an MFA continuation. */
export async function startLogin(email: string, password: string, domain: GarminDomain): Promise<LoginResult> {
  const sso = `https://sso.${domain}`;
  const r1 = await fetch(`${sso}/mobile/sso/en/sign-in?clientId=${SSO_CLIENT_ID}`, {
    headers: pageHeaders(),
    redirect: "manual",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  await r1.body?.cancel();
  let cookies = mergeCookies("", r1);

  const r2 = await fetch(`${sso}/mobile/api/login?${ssoQuery(domain)}`, {
    method: "POST",
    headers: apiHeaders(sso, cookies),
    body: JSON.stringify({ username: email, password, rememberMe: true, captchaToken: "" }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  cookies = mergeCookies(cookies, r2);
  const json = await ssoJson(r2);
  const type: string | undefined = json?.responseStatus?.type;

  if (type === "SUCCESSFUL" && typeof json.serviceTicketId === "string")
    return { status: "ok", tokens: await exchangeServiceTicket(json.serviceTicketId, domain) };
  if (type === "MFA_REQUIRED")
    return {
      status: "mfa",
      pending: { cookies, mfaMethod: json.customerMfaInfo?.mfaLastMethodUsed || "email", domain },
    };
  if (type === "INVALID_USERNAME_PASSWORD") throw new GarminLoginError("Invalid email or password.", "credentials");
  if (type === "CAPTCHA_REQUIRED")
    throw new GarminLoginError(
      "Garmin wants a CAPTCHA for this sign-in, which cannot be solved here. Sign in once at connect.garmin.com in your browser, then retry — or paste garmin_tokens.json instead.",
      "captcha",
    );
  const msg = json?.responseStatus?.message;
  throw new GarminLoginError(`Garmin sign-in failed: ${type ?? "unknown"}${msg ? ` (${msg})` : ""}`, "unknown");
}

/** Step 3: submit the MFA code Garmin sent (email/SMS/authenticator). */
export async function verifyMfa(p: MfaPending, code: string): Promise<GarminTokens> {
  const sso = `https://sso.${p.domain}`;
  const r = await fetch(`${sso}/mobile/api/mfa/verifyCode?${ssoQuery(p.domain)}`, {
    method: "POST",
    headers: apiHeaders(sso, p.cookies),
    body: JSON.stringify({
      mfaMethod: p.mfaMethod,
      mfaVerificationCode: code.trim(),
      rememberMyBrowser: false,
      reconsentList: [],
      mfaSetup: false,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const json = await ssoJson(r);
  const type: string | undefined = json?.responseStatus?.type;
  if (type === "SUCCESSFUL" && typeof json.serviceTicketId === "string")
    return exchangeServiceTicket(json.serviceTicketId, p.domain);
  throw new GarminLoginError(
    type === "INVALID_MFA_CODE" || type === "MFA_REQUIRED"
      ? "That code was not accepted. Check it and try again."
      : `MFA verification failed: ${type ?? "unknown"}`,
    "mfa_code",
  );
}

/** Step 4: CAS service ticket → DI OAuth2 tokens (garmin_tokens.json shape). */
export async function exchangeServiceTicket(ticket: string, domain: GarminDomain): Promise<GarminTokens> {
  const url = `https://diauth.${domain}/di-oauth2-service/oauth/token`;
  let lastStatus = 0;
  for (const clientId of DI_CLIENT_IDS) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        ...NATIVE_HEADERS,
        Authorization: basicAuth(clientId),
        Accept: "application/json,text/html;q=0.9,*/*;q=0.8",
        "Content-Type": "application/x-www-form-urlencoded",
        "Cache-Control": "no-cache",
      },
      body: new URLSearchParams({
        client_id: clientId,
        service_ticket: ticket,
        grant_type: DI_GRANT_TYPE,
        service_url: serviceUrl(domain),
      }).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 429) throw new GarminLoginError("Garmin token service is rate-limiting. Try again in a few minutes.", "rate_limited");
    lastStatus = res.status;
    if (!res.ok) {
      await res.body?.cancel();
      continue;
    }
    const data = (await res.json()) as { access_token?: string; refresh_token?: string };
    if (!data.access_token || !data.refresh_token) continue;
    const jwtClient = decodeJwtPayload(data.access_token)?.client_id;
    return {
      di_token: data.access_token,
      di_refresh_token: data.refresh_token,
      di_client_id: typeof jwtClient === "string" ? jwtClient : clientId,
      domain,
    };
  }
  throw new GarminLoginError(`Garmin accepted the sign-in but the token exchange failed (HTTP ${lastStatus}).`, "unknown");
}

export interface GarminIdentity {
  /** Stable numeric Garmin profile id (string) — basis for the tenant id. */
  profileId: string;
  displayName: string;
  fullName?: string;
}

/** Resolve who these tokens belong to (also proves the tokens work). */
export async function fetchIdentity(tokens: GarminTokens): Promise<{ identity: GarminIdentity; tokens: GarminTokens }> {
  const client = new GarminClient(tokens);
  const p = await client.get<Record<string, unknown>>(EP.socialProfile);
  const displayName = typeof p?.displayName === "string" ? p.displayName : undefined;
  const pid = p?.profileId ?? p?.id;
  const profileId = typeof pid === "number" || (typeof pid === "string" && pid) ? String(pid) : displayName;
  if (!profileId) throw new Error("Garmin profile response had no id");
  return {
    identity: { profileId, displayName: displayName ?? profileId, fullName: typeof p?.fullName === "string" ? p.fullName : undefined },
    tokens: { ...client.tokens, displayName: displayName ?? client.tokens.displayName },
  };
}

/** Tenant id derived from the Garmin account, so re-signing in maps to the same data. */
export function garminUserId(identity: GarminIdentity): string {
  return `g_${identity.profileId}`;
}

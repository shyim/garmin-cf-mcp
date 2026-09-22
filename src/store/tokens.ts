// Per-user encrypted Garmin token storage (Cloudflare KV + AES-GCM).
//
// Token payload mirrors python-garminconnect's garmin_tokens.json:
//   { "di_token": "...", "di_refresh_token": "...", "di_client_id": "..." }
// Tokens come from the built-in Garmin sign-in (src/garmin/login.ts) or,
// as a fallback, from pasting the file produced by the original local CLI.
// The worker only ever needs the OAuth2 (DI) tokens: API calls use
// `Authorization: Bearer <di_token>` and refresh via diauth when expired.
// Garmin passwords are never stored.

export interface GarminTokens {
  di_token: string;
  di_refresh_token: string;
  di_client_id: string;
  domain?: string; // "garmin.com" | "garmin.cn"
  updatedAt?: string;
  displayName?: string;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

async function importKey(secret: string): Promise<CryptoKey> {
  const hash = await crypto.subtle.digest("SHA-256", enc.encode(secret));
  return crypto.subtle.importKey("raw", hash, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** AES-GCM encrypt any JSON value → base64 (iv || ciphertext). */
export async function encryptJson(secret: string, value: unknown): Promise<string> {
  const key = await importKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = enc.encode(JSON.stringify(value));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
  const buf = new Uint8Array(12 + ct.byteLength);
  buf.set(iv, 0);
  buf.set(new Uint8Array(ct), 12);
  let s = "";
  for (const b of buf) s += String.fromCharCode(b);
  return btoa(s);
}

export async function decryptJson<T>(secret: string, payload: string): Promise<T> {
  const key = await importKey(secret);
  const bin = atob(payload);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  const iv = buf.slice(0, 12);
  const ct = buf.slice(12);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return JSON.parse(dec.decode(pt)) as T;
}

export const encryptTokens = (secret: string, tokens: GarminTokens) => encryptJson(secret, tokens);
export const decryptTokens = (secret: string, payload: string) => decryptJson<GarminTokens>(secret, payload);

function kvKey(userId: string): string {
  return `garmin:${userId}`;
}

export async function saveTokens(kv: KVNamespace, secret: string, userId: string, tokens: GarminTokens): Promise<void> {
  const payload: GarminTokens = { ...tokens, updatedAt: new Date().toISOString() };
  await kv.put(kvKey(userId), await encryptTokens(secret, payload));
}

export async function loadTokens(kv: KVNamespace, secret: string, userId: string): Promise<GarminTokens | null> {
  const raw = await kv.get(kvKey(userId));
  if (!raw) return null;
  try {
    return await decryptTokens(secret, raw);
  } catch {
    return null;
  }
}

export async function deleteTokens(kv: KVNamespace, userId: string): Promise<void> {
  await kv.delete(kvKey(userId));
}

export function validateTokenShape(t: unknown): t is GarminTokens {
  if (!t || typeof t !== "object") return false;
  const o = t as Record<string, unknown>;
  return (
    typeof o.di_token === "string" &&
    typeof o.di_refresh_token === "string" &&
    typeof o.di_client_id === "string" &&
    o.di_token.length > 10 &&
    o.di_refresh_token.length > 10
  );
}

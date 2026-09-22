// Legacy tenant auth: static per-tenant bearer keys, created by an admin.
//
// Kept for existing setups. New users don't need this — they add the MCP URL
// and sign in with Garmin through the OAuth flow (see src/index.ts). Keys
// still work as bearer tokens on /mcp via OAuthProvider.resolveExternalToken,
// and /connect?key= still links Garmin for a key.
//
// Only SHA-256 hashes of keys touch KV; a lookup is a single KV GET.

import { b64url, safeEqual } from "../util.js";

export { safeEqual };

const enc = new TextEncoder();

export interface TenantRecord {
  userId: string;
  label: string;
  keyHash: string;
  createdAt: string;
}

export function newTenantKey(): string {
  return `mcp_${b64url(crypto.getRandomValues(new Uint8Array(24)))}`;
}

export function newUserId(): string {
  return `t_${b64url(crypto.getRandomValues(new Uint8Array(9)))}`;
}

export async function hashKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(key));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const keyKv = (hash: string) => `tenant-key:${hash}`;
const userKv = (userId: string) => `tenant-user:${userId}`;

export async function createTenant(
  kv: KVNamespace,
  label: string,
): Promise<{ userId: string; key: string }> {
  const key = newTenantKey();
  const userId = newUserId();
  const keyHash = await hashKey(key);
  const record: TenantRecord = { userId, label, keyHash, createdAt: new Date().toISOString() };
  await kv.put(keyKv(keyHash), JSON.stringify(record));
  await kv.put(userKv(userId), keyHash);
  return { userId, key };
}

/** Resolve a presented bearer key → tenant, or null. */
export async function verifyTenantKey(
  kv: KVNamespace,
  presented: string,
): Promise<TenantRecord | null> {
  if (!presented || !presented.startsWith("mcp_")) return null;
  const hash = await hashKey(presented);
  const raw = await kv.get(keyKv(hash));
  if (!raw) return null;
  try {
    const rec = JSON.parse(raw) as TenantRecord;
    if (rec.keyHash !== hash || !rec.userId) return null;
    return rec;
  } catch {
    return null;
  }
}

export async function listTenants(kv: KVNamespace): Promise<Omit<TenantRecord, "keyHash">[]> {
  const out: Omit<TenantRecord, "keyHash">[] = [];
  let cursor: string | undefined;
  do {
    const page: { keys: { name: string }[]; list_complete: boolean; cursor?: string } =
      await kv.list({ prefix: "tenant-key:", cursor });
    for (const k of page.keys) {
      const raw = await kv.get(k.name);
      if (!raw) continue;
      try {
        const rec = JSON.parse(raw) as TenantRecord;
        out.push({ userId: rec.userId, label: rec.label, createdAt: rec.createdAt });
      } catch { /* skip corrupt */ }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}

/** Revoke a tenant by userId. Returns true if it existed. */
export async function revokeTenant(kv: KVNamespace, userId: string): Promise<boolean> {
  const hash = await kv.get(userKv(userId));
  if (!hash) return false;
  await kv.delete(keyKv(hash));
  await kv.delete(userKv(userId));
  return true;
}

export function bearerKey(request: Request): string | null {
  const h = request.headers.get("authorization");
  if (!h || !h.startsWith("Bearer ")) return null;
  return h.slice(7).trim() || null;
}

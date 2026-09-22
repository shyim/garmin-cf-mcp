// Short-lived, encrypted state for an in-progress sign-in. The browser only
// holds an opaque nonce (hidden form field); the OAuth request, Garmin SSO
// cookies for a pending MFA step, etc. live in KV for 15 minutes.

import type { AuthRequest } from "@cloudflare/workers-oauth-provider";
import { decryptJson, encryptJson } from "../store/tokens.js";
import type { MfaPending } from "../garmin/login.js";
import { randomId } from "../util.js";

export type PendingFlow =
  /** MCP client is authorizing: finish with completeAuthorization(). */
  | { mode: "authorize"; authRequest: AuthRequest; clientName: string }
  /** User signing in to the /account page. */
  | { mode: "account" }
  /** Legacy static-key tenant (re)linking Garmin on /connect?key=. */
  | { mode: "legacy"; userId: string; key: string; label: string };

export interface Pending {
  nonce: string;
  flow: PendingFlow;
  mfa?: MfaPending;
  createdAt: string;
}

const TTL_SECONDS = 15 * 60;
const kvKey = (nonce: string) => `pending:${nonce}`;

export async function createPending(kv: KVNamespace, secret: string, flow: PendingFlow): Promise<Pending> {
  const p: Pending = { nonce: randomId("p_", 24), flow, createdAt: new Date().toISOString() };
  await savePending(kv, secret, p);
  return p;
}

export async function savePending(kv: KVNamespace, secret: string, p: Pending): Promise<void> {
  await kv.put(kvKey(p.nonce), await encryptJson(secret, p), { expirationTtl: TTL_SECONDS });
}

export async function loadPending(kv: KVNamespace, secret: string, nonce: unknown): Promise<Pending | null> {
  if (typeof nonce !== "string" || !nonce.startsWith("p_")) return null;
  const raw = await kv.get(kvKey(nonce));
  if (!raw) return null;
  try {
    return await decryptJson<Pending>(secret, raw);
  } catch {
    return null;
  }
}

export async function deletePending(kv: KVNamespace, nonce: string): Promise<void> {
  await kv.delete(kvKey(nonce));
}

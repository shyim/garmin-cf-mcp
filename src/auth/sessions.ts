// Browser sessions for the authorize/account pages (cookie → KV record).
// Lets a returning user click "Continue as …" instead of re-entering their
// Garmin password for every new MCP client. Revocable server-side.

import { parseCookies, randomId } from "../util.js";

const COOKIE = "gmcp_session";
const TTL_SECONDS = 30 * 24 * 3600;

export interface Session {
  sid: string;
  userId: string;
  createdAt: string;
}

const kvKey = (sid: string) => `session:${sid}`;

export async function createSession(kv: KVNamespace, userId: string): Promise<Session> {
  const s: Session = { sid: randomId("s_", 32), userId, createdAt: new Date().toISOString() };
  await kv.put(kvKey(s.sid), JSON.stringify(s), { expirationTtl: TTL_SECONDS });
  return s;
}

export async function readSession(kv: KVNamespace, request: Request): Promise<Session | null> {
  const sid = parseCookies(request.headers.get("cookie"))[COOKIE];
  if (!sid || !sid.startsWith("s_")) return null;
  const raw = await kv.get(kvKey(sid));
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Session;
    return s.userId ? s : null;
  } catch {
    return null;
  }
}

export async function destroySession(kv: KVNamespace, sid: string): Promise<void> {
  await kv.delete(kvKey(sid));
}

function secure(request: Request): string {
  return new URL(request.url).protocol === "https:" ? "; Secure" : "";
}

export function sessionCookie(sid: string, request: Request): string {
  return `${COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${TTL_SECONDS}${secure(request)}`;
}

export function clearSessionCookie(request: Request): string {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure(request)}`;
}

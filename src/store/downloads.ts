// One-time-ish download links for activity files. MCP responses can't carry
// binaries and the tool has no access to the client's bearer token, so the
// tool mints a capability URL (random nonce, 10 min TTL) instead.

import { randomId } from "../util.js";

export interface DownloadGrant {
  userId: string;
  activityId: string;
  format: "fit" | "gpx" | "tcx" | "csv";
}

const TTL_SECONDS = 10 * 60;
const kvKey = (nonce: string) => `dl:${nonce}`;

export async function mintDownload(kv: KVNamespace, grant: DownloadGrant): Promise<{ nonce: string; expiresAt: string }> {
  const nonce = randomId("d_", 24);
  await kv.put(kvKey(nonce), JSON.stringify(grant), { expirationTtl: TTL_SECONDS });
  return { nonce, expiresAt: new Date(Date.now() + TTL_SECONDS * 1000).toISOString() };
}

export async function readDownload(kv: KVNamespace, nonce: string): Promise<DownloadGrant | null> {
  if (!nonce.startsWith("d_")) return null;
  const raw = await kv.get(kvKey(nonce));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DownloadGrant;
  } catch {
    return null;
  }
}

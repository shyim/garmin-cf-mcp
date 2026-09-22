// Garmin-linked user records (one per Garmin account = one tenant).
// Storage-visible metadata only — tokens live encrypted under garmin:<userId>.

export interface UserRecord {
  userId: string;
  displayName: string;
  fullName?: string;
  domain: string;
  createdAt: string;
  lastLoginAt: string;
}

const kvKey = (userId: string) => `user:${userId}`;

export async function upsertUser(
  kv: KVNamespace,
  input: Omit<UserRecord, "createdAt" | "lastLoginAt">,
): Promise<UserRecord> {
  const now = new Date().toISOString();
  const existing = await getUser(kv, input.userId);
  const rec: UserRecord = { ...existing, ...input, createdAt: existing?.createdAt ?? now, lastLoginAt: now };
  await kv.put(kvKey(rec.userId), JSON.stringify(rec));
  return rec;
}

export async function getUser(kv: KVNamespace, userId: string): Promise<UserRecord | null> {
  const raw = await kv.get(kvKey(userId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as UserRecord;
  } catch {
    return null;
  }
}

export async function deleteUser(kv: KVNamespace, userId: string): Promise<void> {
  await kv.delete(kvKey(userId));
}

export async function listUsers(kv: KVNamespace): Promise<UserRecord[]> {
  const out: UserRecord[] = [];
  let cursor: string | undefined;
  do {
    const page = await kv.list({ prefix: "user:", cursor });
    for (const k of page.keys) {
      const raw = await kv.get(k.name);
      if (!raw) continue;
      try {
        out.push(JSON.parse(raw) as UserRecord);
      } catch { /* skip corrupt */ }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}

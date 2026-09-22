// Account / connection tools. Always registered — they tell the user how to
// (re)connect Garmin and offer the token-paste fallback.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { tool } from "./shim.js";
import { saveTokens, loadTokens, deleteTokens, validateTokenShape } from "../store/tokens.js";
import { GarminClient, EP } from "../garmin/client.js";
import { fetchIdentity, normalizeDomain } from "../garmin/login.js";
import type { Env } from "../env.js";

interface Ctx {
  env: Env;
  userId: string;
  server: McpServer;
  origin: string;
}

export function registerAccountTools({ env, userId, server, origin }: Ctx) {
  const accountUrl = `${origin}/account`;
  const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });

  tool(server,
    "garmin_status",
    "Check whether a Garmin account is connected for the current user and whether the stored tokens still work. If not connected, tells the user where to sign in.",
    {},
    async () => {
      if (!env.ENCRYPTION_KEY) return text("Server misconfigured: ENCRYPTION_KEY not set.");
      const t = await loadTokens(env.GARMIN_KV, env.ENCRYPTION_KEY, userId);
      if (!t)
        return text(
          `No Garmin account connected for this user. Ask the user to open ${accountUrl} and sign in with their Garmin email/password (MFA supported) — or, as a fallback, call garmin_connect with the contents of a garmin_tokens.json file.`,
        );
      try {
        const c = new GarminClient(t, {
          onTokensRefreshed: (nt) => saveTokens(env.GARMIN_KV, env.ENCRYPTION_KEY, userId, nt).catch(() => undefined),
        });
        const profile = await c.get<Record<string, unknown>>(EP.socialProfile);
        return text(JSON.stringify({
          connected: true,
          displayName: profile?.displayName ?? t.displayName ?? null,
          fullName: profile?.fullName ?? null,
          domain: t.domain ?? "garmin.com",
          tokensUpdatedAt: t.updatedAt ?? null,
          manage: accountUrl,
        }));
      } catch (e) {
        return text(
          `Stored Garmin tokens exist but were rejected: ${(e as Error).message}. Ask the user to sign in again at ${accountUrl}.`,
        );
      }
    },
  );

  tool(server,
    "garmin_connect",
    "Fallback: connect Garmin by storing garmin_tokens.json contents {di_token, di_refresh_token, di_client_id} for the current user. Normally unnecessary — users sign in with Garmin in the browser during OAuth. Tokens are verified against Garmin, then encrypted per user.",
    {
      di_token: z.string().describe("di_token from garmin_tokens.json"),
      di_refresh_token: z.string().describe("di_refresh_token from garmin_tokens.json"),
      di_client_id: z.string().describe("di_client_id from garmin_tokens.json"),
      domain: z.enum(["garmin.com", "garmin.cn"]).optional().describe("Garmin region (default garmin.com)"),
    },
    async ({ di_token, di_refresh_token, di_client_id, domain }) => {
      const tokens = { di_token, di_refresh_token, di_client_id, domain: normalizeDomain(domain, env.GARMIN_DOMAIN) };
      if (!validateTokenShape(tokens)) return text("Invalid token shape — expected {di_token, di_refresh_token, di_client_id}.");
      try {
        const { identity, tokens: verified } = await fetchIdentity(tokens);
        await saveTokens(env.GARMIN_KV, env.ENCRYPTION_KEY, userId, verified);
        return text(`Garmin connected as ${identity.fullName ?? identity.displayName}. Tokens encrypted and stored.`);
      } catch (e) {
        return text(`Tokens rejected by Garmin: ${(e as Error).message}`);
      }
    },
  );

  tool(server,
    "garmin_disconnect",
    "Delete the current user's stored Garmin tokens. The MCP client stays authorized; Garmin tools will fail until the user signs in again.",
    {},
    async () => {
      await deleteTokens(env.GARMIN_KV, userId);
      return text(`Garmin tokens deleted. To reconnect, sign in at ${accountUrl}.`);
    },
  );
}

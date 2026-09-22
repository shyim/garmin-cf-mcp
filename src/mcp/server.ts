// Per-request MCP server factory (stateless, SDK v2 — no Durable Objects).
//
// `user` is the identity the OAuthProvider attached to the request (props from
// the grant created in /authorize, or a legacy static key). Each user gets
// their own GarminClient bound to their encrypted KV tokens (multi-tenant
// isolation); token refreshes are written straight back to KV.

import { McpServer } from "@modelcontextprotocol/server";
import { loadTokens, saveTokens } from "../store/tokens.js";
import { GarminClient } from "../garmin/client.js";
import { registerAccountTools } from "./tools-account.js";
import { registerActivityTools } from "./tools-activities.js";
import { registerHealthTools } from "./tools-health.js";
import { registerMiscTools } from "./tools-misc.js";
import type { Env, UserProps } from "../env.js";

export type { UserProps } from "../env.js";

export async function buildGarminServer(env: Env, req: { user: UserProps; origin: string }): Promise<McpServer> {
  const server = new McpServer({ name: "garmin-cf-mcp", version: "0.2.0" }, { capabilities: {} });
  const { user, origin } = req;

  // Always available: status / connect (token paste) / disconnect.
  registerAccountTools({ env, userId: user.userId, server, origin });

  if (!env.ENCRYPTION_KEY) return server;
  const stored = await loadTokens(env.GARMIN_KV, env.ENCRYPTION_KEY, user.userId).catch(() => null);
  if (!stored) return server;

  const client = new GarminClient(stored, {
    onTokensRefreshed: async (t) => {
      try {
        await saveTokens(env.GARMIN_KV, env.ENCRYPTION_KEY, user.userId, t);
      } catch {
        /* KV write failed — in-memory tokens still valid for this request */
      }
    },
  });

  const ctx = { env, client, server, origin, userId: user.userId };
  registerActivityTools(ctx);
  registerHealthTools(ctx);
  registerMiscTools(ctx);
  return server;
}

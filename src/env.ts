import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

export interface Env {
  /** Tenant/user data: encrypted Garmin tokens, users, sessions, pending sign-ins, legacy keys. */
  GARMIN_KV: KVNamespace;
  /** OAuth 2.1 server state (clients, grants, tokens) — managed by workers-oauth-provider. */
  OAUTH_KV: KVNamespace;
  /** Injected by OAuthProvider at runtime. */
  OAUTH_PROVIDER: OAuthHelpers;
  ENCRYPTION_KEY: string;
  /** Optional: Bearer for /admin/* (legacy static-key tenants + user listing). */
  ADMIN_SECRET?: string;
  GARMIN_DOMAIN?: string;
  GARMIN_ENABLED_TOOLS?: string;
  GARMIN_DISABLED_TOOLS?: string;
}

/** Identity attached to every authenticated MCP request (OAuth grant props or legacy key). */
export interface UserProps {
  userId: string;
  login: string;
  name?: string;
}

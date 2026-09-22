// Scripted import of garmin_tokens.json for a LEGACY static-key tenant (mcp_…).
// OAuth users don't need this — they sign in with Garmin in the browser.
// Usage: node scripts/import-tokens.mjs <tenant-key> <path/to/garmin_tokens.json> [worker-base-url]
import { readFileSync } from "node:fs";

const [tenantKey, tokenPath, base = "http://localhost:8787"] = process.argv.slice(2);
if (!tenantKey || !tokenPath) {
  console.error("Usage: node scripts/import-tokens.mjs <tenant-key> <garmin_tokens.json> [base-url]");
  process.exit(1);
}
const tokens = JSON.parse(readFileSync(tokenPath, "utf8"));
for (const k of ["di_token", "di_refresh_token", "di_client_id"]) {
  if (typeof tokens[k] !== "string" || tokens[k].length < 10) {
    console.error(`Invalid ${tokenPath}: missing ${k}`);
    process.exit(1);
  }
}

// Import via the MCP tool itself (authenticated as the tenant).
const res = await fetch(`${base}/mcp`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    Authorization: `Bearer ${tenantKey}`,
  },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "garmin_connect",
      arguments: {
        di_token: tokens.di_token,
        di_refresh_token: tokens.di_refresh_token,
        di_client_id: tokens.di_client_id,
      },
    },
  }),
});
console.log(`HTTP ${res.status}`);
console.log(await res.text());

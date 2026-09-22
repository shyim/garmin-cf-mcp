// Compat shim: lets domain tool files use the concise v1-style
//   tool(server, name, description, shape, handler)
// while targeting the current SDK v2 (`@modelcontextprotocol/server`)
// + stateless `createMcpHandler` path (no Durable Objects).
import { McpServer } from "@modelcontextprotocol/server";

export type ToolResult = {
  content: { type: "text"; text: string }[];
};

export function tool(
  server: McpServer,
  name: string,
  description: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  shape: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fn: (args: any) => Promise<ToolResult>,
): void {
  server.registerTool(
    name,
    { description, inputSchema: shape },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (args: any) => fn(args),
  );
}

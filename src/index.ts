import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { config } from "dotenv";

import { registerArticleMcpResources } from "./resources/index.js";
import { registerArticleMcpTools } from "./tools/index.js";

config();

export const SERVER_NAME = "Article MCP Server";
export const SERVER_VERSION = "0.2.2";

/**
 * Creates a fully wired Article MCP server instance.
 *
 * @returns MCP server with all Article MCP tools registered.
 */
export function createArticleMcpServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  registerArticleMcpTools(server);
  registerArticleMcpResources(server);

  return server;
}

/**
 * Starts the Article MCP server over stdio transport.
 *
 * @returns A promise that resolves when the server is connected to the transport.
 */
async function main(): Promise<void> {
  const server = createArticleMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Article MCP Server running on Node.js via stdio");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

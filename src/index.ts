import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { config } from "dotenv";

import { registerArticleMcpResources } from "./resources/index.js";
import { registerArticleMcpTools } from "./tools/index.js";

config();

export const SERVER_NAME = "Article MCP Server";
export const SERVER_VERSION = "0.2.2";

/**
 * 创建完成依赖装配的 Article MCP 服务器实例。
 *
 * @returns 已注册全部 Article MCP 工具的 MCP server。
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
 * 通过 stdio 传输启动 Article MCP 服务器。
 *
 * @returns 服务器连接到传输层后完成的 Promise。
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

/**
 * 集中注册 Article MCP 暴露的所有资源。
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { ArticleMcpServices } from "../services/container.js";
import { registerArticleRelationResources } from "./article_relations.js";
import { registerArticleFulltextResources } from "./article_fulltext.js";
import { registerConfigStatusResource } from "./config_status.js";

/**
 * 注册 Article MCP 的资源集合。
 *
 * 当前注册精简状态、全文和文献关系资源。
 *
 * @param server MCP server 实例。
 * @param services Article MCP 服务容器。
 */
export function registerArticleMcpResources(server: McpServer, services: ArticleMcpServices): void {
  registerConfigStatusResource(server);
  registerArticleFulltextResources(server, services);
  registerArticleRelationResources(server, services);
}

/**
 * 集中注册 Article MCP 暴露的所有资源。
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { ArticleMcpServices } from "../services/container.js";
import { registerArticleRelationResources } from "./article_relations.js";
import { registerArticleFulltextResources } from "./article_fulltext.js";

/**
 * 注册 Article MCP 的资源集合。
 *
 * 当前先注册全文资源，后续可继续扩展期刊或配置类资源。
 *
 * @param server MCP server 实例。
 * @param services Article MCP 服务容器。
 */
export function registerArticleMcpResources(server: McpServer, services: ArticleMcpServices): void {
  registerArticleFulltextResources(server, services);
  registerArticleRelationResources(server, services);
}

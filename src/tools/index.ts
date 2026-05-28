import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { SearchCache } from "../middleware/search_cache.js";
import { ToolExecutionPipeline } from "../middleware/index.js";
import { createLoggingMiddleware, createTimingMiddleware } from "../middleware/logging.js";
import { createMCPErrorHandlingMiddleware } from "../middleware/error_handling.js";
import { createArticleMcpServices } from "../services/container.js";
import { JournalQualityCache } from "../services/journal_quality_cache.js";
import { createToolDefinitions, type ArticleMcpToolName } from "./definitions.js";
import { createToolHandlers } from "./handlers.js";
import {
  GetArticleDetailsArgumentsSchema,
  GetJournalQualityArgumentsSchema,
  GetLiteratureRelationsArgumentsSchema,
  GetReferencesArgumentsSchema,
  SearchLiteratureArgumentsSchema,
} from "./schemas.js";

/**
 * 工具运行时 schema 映射
 */
const TOOL_RUNTIME_SCHEMAS = {
  search_literature: SearchLiteratureArgumentsSchema,
  get_article_details: GetArticleDetailsArgumentsSchema,
  get_references: GetReferencesArgumentsSchema,
  get_literature_relations: GetLiteratureRelationsArgumentsSchema,
  get_journal_quality: GetJournalQualityArgumentsSchema,
} as const;

/**
 * 在给定 MCP server 上注册全部 Article MCP 工具。
 *
 * @param server 用于接收工具请求处理器的 MCP server 实例。
 */
export function registerArticleMcpTools(server: McpServer): void {
  const services = createArticleMcpServices();
  const searchCache = new SearchCache();
  const journalQualityCache = new JournalQualityCache();
  const handlers = createToolHandlers(services, searchCache, journalQualityCache);
  const pipeline = new ToolExecutionPipeline([
    createMCPErrorHandlingMiddleware(),
    createLoggingMiddleware(),
    createTimingMiddleware(),
  ]);

  for (const tool of createToolDefinitions()) {
    const toolName = tool.name as ArticleMcpToolName;

    server.registerTool(
      toolName,
      {
        title: tool.annotations?.title,
        description: tool.description,
        annotations: tool.annotations,
        inputSchema: TOOL_RUNTIME_SCHEMAS[toolName],
      },
      async (toolArguments: unknown) =>
        pipeline.execute(toolName, toolArguments, async (context) => {
          const handler = handlers[context.toolName as keyof typeof handlers];
          if (!handler) {
            throw new Error(`Unknown tool: ${context.toolName}`);
          }

          return handler(context.arguments);
        }),
    );
  }
}

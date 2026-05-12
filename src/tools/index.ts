import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  createErrorBoundaryMiddleware,
  createLoggingMiddleware,
  createTimingMiddleware,
  ToolExecutionPipeline,
} from "../middleware/index.js";
import { createArticleMcpServices } from "../services/container.js";
import { TOOL_DEFINITIONS, type ArticleMcpToolName } from "./definitions.js";
import { createToolHandlers } from "./handlers.js";
import {
  GetArticleDetailsArgumentsSchema,
  GetJournalQualityArgumentsSchema,
  GetLiteratureRelationsArgumentsSchema,
  GetReferencesArgumentsSchema,
  SearchLiteratureArgumentsSchema,
} from "./schemas.js";

const TOOL_RUNTIME_SCHEMAS = {
  search_literature: SearchLiteratureArgumentsSchema,
  get_article_details: GetArticleDetailsArgumentsSchema,
  get_references: GetReferencesArgumentsSchema,
  get_literature_relations: GetLiteratureRelationsArgumentsSchema,
  get_journal_quality: GetJournalQualityArgumentsSchema,
} as const;

/**
 * Registers all Article MCP tools on the provided MCP server.
 *
 * @param server MCP server instance to receive tool request handlers.
 */
export function registerArticleMcpTools(server: McpServer): void {
  const services = createArticleMcpServices();
  const handlers = createToolHandlers(services);
  const pipeline = new ToolExecutionPipeline([
    createErrorBoundaryMiddleware(),
    createLoggingMiddleware(),
    createTimingMiddleware(),
  ]);

  for (const tool of TOOL_DEFINITIONS) {
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

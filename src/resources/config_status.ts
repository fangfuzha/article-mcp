/**
 * 注册精简服务状态资源，仅暴露会影响 MCP 工具调用策略的信息。
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";

const STATUS_RESOURCE_URI = "config://status";
const CACHE_TTL_HOURS = 24;

export type ConfigStatusPayload = {
  status: "running";
  api_configuration: {
    easyscholar_available: boolean;
  };
  cache: {
    search_cache_available: boolean;
    journal_quality_cache_available: boolean;
    ttl_hours: number;
  };
  capabilities: {
    fulltext_resource_links: boolean;
    relation_resource_links: boolean;
    structured_tool_output: boolean;
    journal_quality_fallback: "openalex";
  };
};

type ConfigStatusEnvironment = {
  EASYSCHOLAR_SECRET_KEY?: string;
};

/**
 * 注册不会重复 server metadata、tools/list 或 resources/list 的状态资源。
 *
 * @param server MCP server 实例。
 */
export function registerConfigStatusResource(server: McpServer): void {
  server.registerResource(
    "config_status",
    STATUS_RESOURCE_URI,
    {
      title: "Config Status",
      description: "Minimal runtime status that can affect Article MCP tool call strategy.",
      mimeType: "application/json",
    },
    async (uri) => readConfigStatusResource(uri),
  );
}

/**
 * 构造供模型判断调用策略的精简状态载荷。
 *
 * @param env 环境变量对象，便于测试替换。
 * @returns 不包含版本、工具清单、资源清单、本地路径或原始密钥的状态数据。
 */
export function buildConfigStatusPayload(
  env: ConfigStatusEnvironment = process.env,
): ConfigStatusPayload {
  return {
    status: "running",
    api_configuration: {
      easyscholar_available: Boolean(env.EASYSCHOLAR_SECRET_KEY?.trim()),
    },
    cache: {
      search_cache_available: true,
      journal_quality_cache_available: true,
      ttl_hours: CACHE_TTL_HOURS,
    },
    capabilities: {
      fulltext_resource_links: true,
      relation_resource_links: true,
      structured_tool_output: true,
      journal_quality_fallback: "openalex",
    },
  };
}

/**
 * 读取精简状态资源。
 *
 * @param uri 被读取的资源 URI。
 * @param env 环境变量对象，便于测试替换。
 * @returns MCP 资源读取结果。
 */
export async function readConfigStatusResource(
  uri: URL,
  env: ConfigStatusEnvironment = process.env,
): Promise<ReadResourceResult> {
  return {
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(buildConfigStatusPayload(env), null, 2),
      },
    ],
  };
}

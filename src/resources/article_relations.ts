import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";

import type { ArticleMcpServices } from "../services/container.js";
import { createToolHandlers } from "../tools/handlers.js";

type LiteratureRelationsHandler = (toolArguments: unknown) => Promise<CallToolResult>;

const DEFAULT_ID_TYPE = "auto" as const;
const DEFAULT_RELATION_TYPES = ["references", "similar", "citing"] as const;
const DEFAULT_ANALYSIS_TYPE = "basic" as const;
const DEFAULT_MAX_RESULTS = 20;
const DEFAULT_MAX_DEPTH = 1;

const ARTICLE_RELATIONS_RESOURCE_TEMPLATE = new ResourceTemplate(
  "article://relations/{identifier}{?id_type,relation_types,analysis_type,max_results,max_depth,sources}",
  {
    list: async () => ({ resources: [] }),
    complete: {
      identifier: async (value) => completeIdentifier(value),
      id_type: async (value) => completeEnum(value, ["auto", "doi", "pmid", "pmcid"]),
      relation_types: async (value) => completeEnum(value, ["references", "similar", "citing"]),
      analysis_type: async (value) => completeEnum(value, ["basic", "comprehensive", "network"]),
      sources: async (value) =>
        completeEnum(value, ["europe_pmc", "crossref", "openalex", "pubmed"]),
    },
  },
);

/**
 * 注册文献关系资源。
 *
 * @param server MCP 服务器实例。
 * @param services Article MCP 服务容器。
 */
export function registerArticleRelationResources(
  server: McpServer,
  services: ArticleMcpServices,
): void {
  const handlers = createToolHandlers(services);

  server.registerResource(
    "article_relations",
    ARTICLE_RELATIONS_RESOURCE_TEMPLATE,
    {
      title: "Article Relations Resource",
      description: "Recomputes literature relation analysis on demand without server-side caching.",
      mimeType: "application/json",
    },
    async (uri) => readArticleRelationsResource(uri, handlers.get_literature_relations!),
  );
}

/**
 * 构建文献关系资源 URI。
 */
export function buildArticleRelationsResourceUri(options: {
  identifier: string;
  idType?: string;
  relationTypes?: string[];
  analysisType?: string;
  maxResults?: number;
  maxDepth?: number;
  sources?: string[];
}): string {
  const query = new URLSearchParams();
  query.set("id_type", options.idType?.trim() || DEFAULT_ID_TYPE);
  query.set(
    "relation_types",
    normalizeList(options.relationTypes, [...DEFAULT_RELATION_TYPES]).join(","),
  );
  query.set("analysis_type", options.analysisType?.trim() || DEFAULT_ANALYSIS_TYPE);
  query.set("max_results", String(options.maxResults ?? DEFAULT_MAX_RESULTS));
  query.set("max_depth", String(options.maxDepth ?? DEFAULT_MAX_DEPTH));

  const sources = normalizeList(options.sources);
  if (sources.length) {
    query.set("sources", sources.join(","));
  }

  return `article://relations/${encodeURIComponent(options.identifier.trim())}?${query.toString()}`;
}

/**
 * 读取文献关系资源，返回完整结构化 JSON。
 */
export async function readArticleRelationsResource(
  uri: URL,
  handler: LiteratureRelationsHandler,
): Promise<ReadResourceResult> {
  const parsed = parseArticleRelationsResourceUri(uri);
  if (!parsed.ok) {
    return createJsonErrorResourceResult(uri, parsed.error);
  }

  try {
    const result = await handler(parsed.value);
    if (!result) {
      return createJsonErrorResourceResult(uri, "文献关系处理器不可用");
    }

    const structured =
      result.structuredContent && typeof result.structuredContent === "object"
        ? result.structuredContent
        : null;

    if (!structured) {
      return createJsonErrorResourceResult(uri, "文献关系资源未返回结构化内容");
    }

    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(structured, null, 2),
        },
      ],
    };
  } catch (error) {
    return createJsonErrorResourceResult(
      uri,
      error instanceof Error ? error.message : String(error),
      parsed.value,
    );
  }
}

/**
 * 解析文献关系资源 URI。
 */
export function parseArticleRelationsResourceUri(uri: URL):
  | {
      ok: true;
      value: {
        identifier: string;
        identifier_key?: string;
        identifiers?: string[];
        id_type: string;
        relation_types: string[];
        analysis_type: string;
        max_results: number;
        max_depth: number;
        sources?: string[];
      };
    }
  | { ok: false; error: string } {
  if (uri.protocol !== "article:" || uri.hostname !== "relations") {
    return { ok: false, error: `无效的资源 URI: ${uri.href}` };
  }

  const identifier = decodeURIComponent(uri.pathname.replace(/^\//, "")).trim();
  if (!identifier) {
    return { ok: false, error: "文献关系资源缺少 identifier" };
  }

  const idType = uri.searchParams.get("id_type")?.trim() || DEFAULT_ID_TYPE;
  const relationTypes = normalizeQueryList(uri.searchParams.get("relation_types") ?? undefined, [
    ...DEFAULT_RELATION_TYPES,
  ]);
  const analysisType = uri.searchParams.get("analysis_type")?.trim() || DEFAULT_ANALYSIS_TYPE;
  const maxResults = parsePositiveInteger(uri.searchParams.get("max_results"), DEFAULT_MAX_RESULTS);
  const maxDepth = parsePositiveInteger(uri.searchParams.get("max_depth"), DEFAULT_MAX_DEPTH);
  const sources = normalizeQueryList(uri.searchParams.get("sources") ?? undefined);

  return {
    ok: true,
    value: {
      identifier,
      id_type: idType,
      relation_types: relationTypes,
      analysis_type: analysisType,
      max_results: maxResults,
      max_depth: maxDepth,
      ...(sources.length ? { sources } : {}),
    },
  };
}

function createJsonErrorResourceResult(
  uri: URL,
  error: string,
  meta: Record<string, unknown> = {},
): ReadResourceResult {
  return {
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(
          {
            success: false,
            data: null,
            meta,
            error,
          },
          null,
          2,
        ),
      },
    ],
  };
}

function parsePositiveInteger(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function completeIdentifier(value: string): string[] {
  const candidates = ["10.1000/source", "PMC1234567", "12345"];
  const trimmed = value.trim();
  return trimmed
    ? candidates.filter((candidate) => candidate.toLowerCase().includes(trimmed.toLowerCase()))
    : candidates;
}

function completeEnum(value: string, candidates: string[]): string[] {
  const trimmed = value.trim().toLowerCase();
  return trimmed ? candidates.filter((candidate) => candidate.startsWith(trimmed)) : candidates;
}

function normalizeList(values?: string[], defaults: string[] = []): string[] {
  const normalized = (values ?? []).map((value) => value.trim()).filter(Boolean);
  return normalized.length ? normalized : defaults;
}

function normalizeQueryList(value: string | undefined, defaults: string[] = []): string[] {
  if (!value) {
    return defaults;
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

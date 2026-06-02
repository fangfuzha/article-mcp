import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";

import type { ArticleMcpServices } from "../services/container.js";

const DEFAULT_FORMAT = "markdown" as const;
const SUPPORTED_FORMATS = ["markdown", "xml", "text"] as const;

export type ArticleFulltextResourceOptions = {
  format?: string;
  sections?: string[];
};

export type ArticleFulltextResourcePayload = {
  pmcid: string;
  format: string;
  sections: string[] | null;
  fulltext_available: boolean;
  content: string | null;
  preview: string | null;
  resource_uri: string;
  sections_requested?: string[];
  sections_found?: string[];
  sections_missing?: string[];
};

const ARTICLE_FULLTEXT_RESOURCE_TEMPLATE = new ResourceTemplate(
  "article://fulltext/{pmcid}{?format,sections}",
  {
    list: async () => ({ resources: [] }),
    complete: {
      pmcid: async (value) => completePmcid(value),
      format: async (value) => completeFormat(value),
      sections: async (value) => completeSections(value),
    },
  },
);

/**
 * 注册文章全文资源模板。
 *
 * @param server MCP 服务器实例。
 * @param services Article MCP 服务容器。
 */
export function registerArticleFulltextResources(
  server: McpServer,
  services: ArticleMcpServices,
): void {
  server.registerResource(
    "article_fulltext",
    ARTICLE_FULLTEXT_RESOURCE_TEMPLATE,
    {
      title: "Article Fulltext Resource",
      description: "Fetches PMC fulltext on demand without server-side caching.",
      mimeType: "text/markdown",
    },
    async (uri) => readArticleFulltextResource(uri, services),
  );
}

/**
 * 构建文章全文资源 URI。
 *
 * @param pmcid PMCID 标识符。
 * @param options format 与 sections 参数。
 * @returns 规范化后的资源 URI。
 */
export function buildArticleFulltextResourceUri(
  pmcid: string,
  options: ArticleFulltextResourceOptions = {},
): string {
  const normalizedPmcid = normalizePmcid(pmcid);
  const format = normalizeFormat(options.format);
  const sections = normalizeSections(options.sections);

  const query = new URLSearchParams();
  query.set("format", format);
  if (sections.length) {
    query.set("sections", sections.join(","));
  }

  return `article://fulltext/${encodeURIComponent(normalizedPmcid)}?${query.toString()}`;
}

/**
 * 读取文章全文资源。
 *
 * @param uri 资源 URI。
 * @param services Article MCP 服务容器。
 * @returns MCP 资源读取结果。
 */
export async function readArticleFulltextResource(
  uri: URL,
  services: ArticleMcpServices,
): Promise<ReadResourceResult> {
  const parsed = parseArticleFulltextResourceUri(uri);
  if (!parsed.ok) {
    return createJsonErrorResourceResult(uri, parsed.error);
  }

  const { pmcid, format, sections } = parsed.value;
  let fulltext: Record<string, unknown>;

  try {
    fulltext = await services.pubmed.getPMCFulltextHtmlAsync(pmcid, sections ?? undefined);
  } catch (error) {
    return createJsonErrorResourceResult(
      uri,
      error instanceof Error ? error.message : String(error),
      {
        pmcid,
        format,
        sections,
      },
    );
  }

  if (!fulltext.fulltext_available) {
    return createJsonErrorResourceResult(
      uri,
      typeof fulltext.error === "string" ? fulltext.error : `未找到 ${pmcid} 的全文内容`,
      {
        pmcid,
        format,
        sections,
      },
    );
  }

  const selectedContent = selectFulltextContent(fulltext, format);

  return {
    contents: [
      {
        uri: uri.href,
        mimeType: mimeTypeForFormat(format),
        text: String(selectedContent ?? ""),
      },
    ],
  };
}

/**
 * 解析文章全文资源 URI。
 *
 * @param uri 资源 URI。
 * @returns 解析结果。
 */
export function parseArticleFulltextResourceUri(uri: URL):
  | {
      ok: true;
      value: {
        pmcid: string;
        format: string;
        sections: string[] | null;
      };
    }
  | { ok: false; error: string } {
  if (uri.protocol !== "article:" || uri.hostname !== "fulltext") {
    return { ok: false, error: `无效的资源 URI: ${uri.href}` };
  }

  try {
    const pmcid = normalizePmcid(decodeURIComponent(uri.pathname.replace(/^\//, "")));
    const format = parseResourceFormat(uri.searchParams.get("format") ?? undefined);
    const sections = normalizeSectionsFromQuery(uri.searchParams.get("sections") ?? undefined);

    return {
      ok: true,
      value: {
        pmcid,
        format,
        sections,
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
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

function mimeTypeForFormat(format: string): string {
  if (format === "xml") {
    return "application/xml";
  }

  if (format === "text") {
    return "text/plain";
  }

  return "text/markdown";
}

function normalizeFormat(format: string | undefined): string {
  const candidate = (format ?? DEFAULT_FORMAT).trim().toLowerCase();
  return SUPPORTED_FORMATS.includes(candidate as (typeof SUPPORTED_FORMATS)[number])
    ? candidate
    : DEFAULT_FORMAT;
}

function parseResourceFormat(format: string | undefined): string {
  const candidate = (format ?? DEFAULT_FORMAT).trim().toLowerCase();
  if (SUPPORTED_FORMATS.includes(candidate as (typeof SUPPORTED_FORMATS)[number])) {
    return candidate;
  }

  throw new Error(`不支持的全文资源格式: ${format}. 支持的格式: ${SUPPORTED_FORMATS.join(", ")}`);
}

function normalizePmcid(pmcid: string): string {
  const trimmed = pmcid.trim();
  const withPrefix = trimmed.toUpperCase().startsWith("PMC") ? trimmed : `PMC${trimmed}`;
  if (!/^PMC\d+$/i.test(withPrefix)) {
    throw new Error(`无效的 PMCID: ${pmcid}`);
  }

  return withPrefix.toUpperCase();
}

function normalizeSections(sections?: string[]): string[] {
  return (sections ?? []).map((section) => section.trim()).filter((section) => Boolean(section));
}

function normalizeSectionsFromQuery(sections: string | undefined): string[] | null {
  if (!sections) {
    return null;
  }

  const trimmed = sections.trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((section) => String(section).trim()).filter(Boolean);
      }
    } catch {
      // 回退到逗号分隔解析
    }
  }

  return trimmed
    .split(",")
    .map((section) => section.trim())
    .filter(Boolean);
}

function selectFulltextContent(fulltext: Record<string, unknown>, format: string): string {
  if (format === "xml") {
    return String(fulltext.fulltext_xml ?? "");
  }

  if (format === "text") {
    return String(fulltext.fulltext_text ?? "");
  }

  return String(fulltext.fulltext_markdown ?? "");
}

function completePmcid(value: string): string[] {
  const trimmed = value.trim().toUpperCase();
  const candidates = ["PMC1234567", "PMC7654321", "PMC1111111"];

  if (!trimmed) {
    return candidates;
  }

  if (trimmed.startsWith("PMC")) {
    return candidates.filter((candidate) => candidate.startsWith(trimmed));
  }

  return candidates.filter((candidate) => candidate.slice(3).startsWith(trimmed));
}

function completeFormat(value: string): string[] {
  const formats = ["markdown", "xml", "text"];
  const trimmed = value.trim().toLowerCase();
  return trimmed ? formats.filter((format) => format.startsWith(trimmed)) : formats;
}

function completeSections(value: string): string[] {
  const sections = [
    "methods",
    "introduction",
    "results",
    "discussion",
    "conclusion",
    "abstract",
    "references",
  ];
  const trimmed = value.trim().toLowerCase();
  return trimmed ? sections.filter((section) => section.startsWith(trimmed)) : sections;
}

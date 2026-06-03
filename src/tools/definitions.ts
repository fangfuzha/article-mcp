/**
 * 生成 Article MCP 工具定义，包含标题、描述、输入和输出 Schema。
 */
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

import { TOOL_DESCRIPTION_CATALOG, type ToolDescriptionLanguage } from "./descriptions.js";
import { createToolInputSchemas } from "./schemas.js";

export const ARTICLE_MCP_TOOL_NAMES = [
  "search_literature",
  "get_article_details",
  "get_references",
  "get_literature_relations",
  "get_journal_quality",
] as const;

export type ArticleMcpToolName = (typeof ARTICLE_MCP_TOOL_NAMES)[number];

type ToolDescriptionEnvironment = {
  ARTICLE_MCP_LANG?: string;
  ARTICLE_MCP_LANGUAGE?: string;
};

const TOOL_TITLES: Record<ToolDescriptionLanguage, Record<ArticleMcpToolName, string>> = {
  "zh-CN": {
    search_literature: "文献搜索",
    get_article_details: "文献全文",
    get_references: "参考文献",
    get_literature_relations: "文献关系分析",
    get_journal_quality: "期刊质量评估",
  },
  en: {
    search_literature: "Literature Search",
    get_article_details: "Article Full Text",
    get_references: "References",
    get_literature_relations: "Literature Relations",
    get_journal_quality: "Journal Quality",
  },
};

/**
 * 根据 MCP 环境变量解析工具解释语言。
 *
 * @param env 环境变量对象。
 * @returns 支持的工具解释语言，未知值回退到中文。
 */
export function resolveToolDescriptionLanguage(
  env: ToolDescriptionEnvironment = process.env,
): ToolDescriptionLanguage {
  const rawLanguage = (env.ARTICLE_MCP_LANG ?? env.ARTICLE_MCP_LANGUAGE ?? "").trim().toLowerCase();

  if (["en", "en-us", "en_us", "english"].includes(rawLanguage)) {
    return "en";
  }

  return "zh-CN";
}

/**
 * 创建当前 MCP 环境对应语言的工具定义。
 *
 * @param env 环境变量对象。
 * @returns Article MCP 工具定义列表。
 */
export function createToolDefinitions(env: ToolDescriptionEnvironment = process.env) {
  const language = resolveToolDescriptionLanguage(env);
  const descriptions = TOOL_DESCRIPTION_CATALOG[language];
  const schemas = createToolInputSchemas(language);
  const titles = TOOL_TITLES[language];

  return [
    {
      name: "search_literature",
      description: descriptions.search_literature,
      inputSchema: schemas.search_literature,
      annotations: {
        title: titles.search_literature,
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    {
      name: "get_article_details",
      description: descriptions.get_article_details,
      inputSchema: schemas.get_article_details,
      annotations: {
        title: titles.get_article_details,
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    {
      name: "get_references",
      description: descriptions.get_references,
      inputSchema: schemas.get_references,
      annotations: {
        title: titles.get_references,
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    {
      name: "get_literature_relations",
      description: descriptions.get_literature_relations,
      inputSchema: schemas.get_literature_relations,
      annotations: {
        title: titles.get_literature_relations,
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    {
      name: "get_journal_quality",
      description: descriptions.get_journal_quality,
      inputSchema: schemas.get_journal_quality,
      annotations: {
        title: titles.get_journal_quality,
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
  ] as const satisfies readonly Tool[];
}

export const TOOL_DEFINITIONS = createToolDefinitions();

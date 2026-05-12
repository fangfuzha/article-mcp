import type { Tool } from "@modelcontextprotocol/sdk/types.js";

import {
  GET_ARTICLE_DETAILS_DESCRIPTION,
  GET_JOURNAL_QUALITY_DESCRIPTION,
  GET_LITERATURE_RELATIONS_DESCRIPTION,
  GET_REFERENCES_DESCRIPTION,
  SEARCH_LITERATURE_DESCRIPTION,
} from "./descriptions.js";
import {
  GetArticleDetailsInputSchema,
  GetJournalQualityInputSchema,
  GetLiteratureRelationsInputSchema,
  GetReferencesInputSchema,
  SearchLiteratureInputSchema,
} from "./schemas.js";

export const TOOL_DEFINITIONS = [
  {
    name: "search_literature",
    description: SEARCH_LITERATURE_DESCRIPTION,
    inputSchema: SearchLiteratureInputSchema,
    annotations: {
      title: "文献搜索",
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "get_article_details",
    description: GET_ARTICLE_DETAILS_DESCRIPTION,
    inputSchema: GetArticleDetailsInputSchema,
    annotations: {
      title: "文献全文",
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "get_references",
    description: GET_REFERENCES_DESCRIPTION,
    inputSchema: GetReferencesInputSchema,
    annotations: {
      title: "参考文献",
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "get_literature_relations",
    description: GET_LITERATURE_RELATIONS_DESCRIPTION,
    inputSchema: GetLiteratureRelationsInputSchema,
    annotations: {
      title: "文献关系分析",
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "get_journal_quality",
    description: GET_JOURNAL_QUALITY_DESCRIPTION,
    inputSchema: GetJournalQualityInputSchema,
    annotations: {
      title: "期刊质量评估",
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
] as const satisfies readonly Tool[];

export type ArticleMcpToolName = (typeof TOOL_DEFINITIONS)[number]["name"];

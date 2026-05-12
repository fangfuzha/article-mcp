import { z } from "zod";

export type ToolInputSchema = {
  type: "object";
  properties: Record<string, object>;
  required?: string[];
  additionalProperties: false;
};

const stringArraySchema = {
  type: "array",
  items: { type: "string" },
} as const;

const stringOrStringArraySchema = {
  anyOf: [{ type: "string" }, stringArraySchema],
} as const;

const nullableStringOrStringArraySchema = {
  anyOf: [{ type: "string" }, stringArraySchema, { type: "null" }],
} as const;

export const SearchLiteratureInputSchema: ToolInputSchema = {
  type: "object",
  properties: {
    keyword: {
      type: "string",
      description: "搜索关键词（必填）",
    },
    sources: {
      ...stringArraySchema,
      description: "数据源列表（可选，默认根据搜索策略自动选择）",
    },
    max_results: {
      type: "integer",
      default: 10,
      minimum: 1,
      description: "每个源的最大结果数（默认10）",
    },
    search_type: {
      type: "string",
      enum: ["comprehensive", "fast", "precise", "preprint"],
      default: "comprehensive",
      description: "搜索策略（默认comprehensive）",
    },
    use_cache: {
      type: "boolean",
      default: true,
      description: "是否使用24小时缓存（默认true）",
    },
  },
  required: ["keyword"],
  additionalProperties: false,
};

export const GetArticleDetailsInputSchema: ToolInputSchema = {
  type: "object",
  properties: {
    pmcid: {
      ...stringOrStringArraySchema,
      description: "PMCID 标识符（必填）：单个或列表，批量模式最多支持20个 PMCID",
    },
    sections: {
      ...nullableStringOrStringArraySchema,
      default: null,
      description: "全文章节控制；None 获取全部章节，字符串或列表获取指定章节",
    },
    format: {
      type: "string",
      enum: ["markdown", "xml", "text"],
      default: "markdown",
      description: "全文格式（默认markdown）",
    },
  },
  required: ["pmcid"],
  additionalProperties: false,
};

export const GetReferencesInputSchema: ToolInputSchema = {
  type: "object",
  properties: {
    identifier: {
      type: "string",
      description: "文献标识符（必填）：DOI、PMID、PMCID",
    },
    id_type: {
      type: "string",
      enum: ["auto", "doi", "pmid", "pmcid"],
      default: "doi",
      description: "标识符类型（默认doi）",
    },
    sources: {
      ...stringArraySchema,
      default: ["europe_pmc", "crossref"],
      description: "数据源列表",
    },
    max_results: {
      type: "integer",
      default: 20,
      minimum: 1,
      description: "最大参考文献数量（默认20，建议20-100）",
    },
    include_metadata: {
      type: "boolean",
      default: true,
      description: "是否包含详细元数据（默认true）",
    },
  },
  required: ["identifier"],
  additionalProperties: false,
};

export const GetLiteratureRelationsInputSchema: ToolInputSchema = {
  type: "object",
  properties: {
    identifier: {
      ...nullableStringOrStringArraySchema,
      default: null,
      description: "文献标识符（单个）- 向后兼容参数",
    },
    identifiers: {
      ...nullableStringOrStringArraySchema,
      default: null,
      description: "文献标识符（单个或列表）- 主要参数",
    },
    id_type: {
      type: "string",
      enum: ["auto", "doi", "pmid", "pmcid"],
      default: "auto",
      description: "标识符类型（默认auto）",
    },
    relation_types: {
      ...stringArraySchema,
      default: ["references", "similar", "citing"],
      description: "关系类型列表",
    },
    max_results: {
      type: "integer",
      default: 20,
      minimum: 1,
      description: "每种关系类型最大结果数（默认20）",
    },
    sources: {
      ...stringArraySchema,
      default: ["europe_pmc", "crossref", "openalex", "pubmed"],
      description: "数据源列表",
    },
    analysis_type: {
      type: "string",
      enum: ["basic", "comprehensive", "network"],
      default: "basic",
      description: "分析类型（默认basic）",
    },
    max_depth: {
      type: "integer",
      default: 1,
      minimum: 1,
      description: "分析深度（默认1）",
    },
  },
  additionalProperties: false,
};

export const GetJournalQualityInputSchema: ToolInputSchema = {
  type: "object",
  properties: {
    journal_name: {
      ...stringOrStringArraySchema,
      description: "期刊名称（单个或列表）",
    },
    include_metrics: {
      ...nullableStringOrStringArraySchema,
      default: ["impact_factor", "quartile", "jci"],
      description: "返回的指标列表",
    },
    use_cache: {
      type: "boolean",
      default: true,
      description: "是否使用24小时缓存（默认true）",
    },
    sort_by: {
      anyOf: [{ type: "string", enum: ["impact_factor", "quartile", "jci"] }, { type: "null" }],
      default: null,
      description: "排序字段，仅批量查询有效",
    },
    sort_order: {
      type: "string",
      enum: ["desc", "asc"],
      default: "desc",
      description: "排序顺序，仅批量查询有效",
    },
  },
  required: ["journal_name"],
  additionalProperties: false,
};

export const SearchLiteratureArgumentsSchema = z.object({
  keyword: z.string(),
  sources: z.array(z.string()).optional(),
  max_results: z.number().int().positive().default(10),
  search_type: z.enum(["comprehensive", "fast", "precise", "preprint"]).default("comprehensive"),
  use_cache: z.boolean().default(true),
});

export const GetArticleDetailsArgumentsSchema = z.object({
  pmcid: z.union([z.string(), z.array(z.string())]),
  sections: z
    .union([z.string(), z.array(z.string()), z.null()])
    .optional()
    .default(null),
  format: z.enum(["markdown", "xml", "text"]).default("markdown"),
});

export const GetReferencesArgumentsSchema = z.object({
  identifier: z.string(),
  id_type: z.enum(["auto", "doi", "pmid", "pmcid"]).default("doi"),
  sources: z.array(z.string()).optional(),
  max_results: z.number().int().positive().default(20),
  include_metadata: z.boolean().default(true),
});

export const GetLiteratureRelationsArgumentsSchema = z.object({
  identifier: z
    .union([z.string(), z.array(z.string()), z.null()])
    .optional()
    .default(null),
  identifiers: z
    .union([z.string(), z.array(z.string()), z.null()])
    .optional()
    .default(null),
  id_type: z.enum(["auto", "doi", "pmid", "pmcid"]).default("auto"),
  relation_types: z.array(z.string()).optional().default(["references", "similar", "citing"]),
  max_results: z.number().int().positive().default(20),
  sources: z.array(z.string()).optional(),
  analysis_type: z.enum(["basic", "comprehensive", "network"]).default("basic"),
  max_depth: z.number().int().positive().default(1),
});

export const GetJournalQualityArgumentsSchema = z.object({
  journal_name: z.union([z.string(), z.array(z.string())]),
  include_metrics: z
    .union([z.string(), z.array(z.string()), z.null()])
    .optional()
    .default(null),
  use_cache: z.boolean().default(true),
  sort_by: z.enum(["impact_factor", "quartile", "jci"]).nullable().optional().default(null),
  sort_order: z.enum(["desc", "asc"]).default("desc"),
});

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { ArticleMcpServices } from "../services/container.js";
import { SearchCache } from "../middleware/search_cache.js";
import { JournalQualityCache } from "../services/journal_quality_cache.js";
import { buildArticleFulltextResourceUri } from "../resources/article_fulltext.js";
import { buildArticleRelationsResourceUri } from "../resources/article_relations.js";
import type { ArticleMcpToolName } from "./definitions.js";
import {
  GetArticleDetailsArgumentsSchema,
  GetJournalQualityArgumentsSchema,
  GetLiteratureRelationsArgumentsSchema,
  GetReferencesArgumentsSchema,
  SearchLiteratureArgumentsSchema,
} from "./schemas.js";
import { createStructuredToolResult } from "./result_format.js";

export type ToolHandler = (toolArguments: unknown) => Promise<CallToolResult>;
export type ToolHandlerMap = Record<string, ToolHandler>;

type SearchStrategy = {
  defaultSources: string[];
  maxResultsPerSource: number;
  mergeStrategy: "union" | "intersection";
};

type ArticleDetailResult = {
  article: unknown | null;
  fulltextFetched: boolean;
};

const ARTICLE_DETAILS_CONCURRENCY = 5;
const FULLTEXT_PREVIEW_LIMIT = 1200;

const DEFAULT_SEARCH_STRATEGY: SearchStrategy = {
  defaultSources: ["europe_pmc", "pubmed", "arxiv", "crossref", "openalex"],
  maxResultsPerSource: 10,
  mergeStrategy: "union",
};

const SEARCH_STRATEGIES: Record<string, SearchStrategy> = {
  comprehensive: DEFAULT_SEARCH_STRATEGY,
  fast: {
    defaultSources: ["europe_pmc", "pubmed"],
    maxResultsPerSource: 5,
    mergeStrategy: "union",
  },
  precise: {
    defaultSources: ["pubmed", "europe_pmc"],
    maxResultsPerSource: 10,
    mergeStrategy: "intersection",
  },
  preprint: {
    defaultSources: ["arxiv"],
    maxResultsPerSource: 10,
    mergeStrategy: "union",
  },
};

const DEFAULT_JOURNAL_INCLUDE_METRICS = ["impact_factor", "quartile", "jci"] as const;
const OPENALEX_JOURNAL_METRIC_KEYS = [
  "h_index",
  "citation_rate",
  "cited_by_count",
  "works_count",
  "i10_index",
] as const;

/**
 * 创建由具体服务支撑的全部 Article MCP 工具处理器。
 *
 * @param services Article MCP 服务容器。
 * @returns 以 MCP 工具名称为键的工具处理器。
 */
export function createToolHandlers(
  services: ArticleMcpServices,
  searchCache?: SearchCache | null,
  journalQualityCache?: JournalQualityCache | null,
): ToolHandlerMap {
  const cache = searchCache ?? undefined;
  const qualityCache = journalQualityCache ?? undefined;

  return {
    search_literature: (toolArguments) => handleSearchLiterature(services, cache, toolArguments),
    get_article_details: (toolArguments) => handleGetArticleDetails(services, toolArguments),
    get_references: (toolArguments) => handleGetReferences(services, toolArguments),
    get_literature_relations: (toolArguments) =>
      handleGetLiteratureRelations(services, toolArguments),
    get_journal_quality: (toolArguments) =>
      handleGetJournalQuality(services, qualityCache, toolArguments),
  };
}

async function handleSearchLiterature(
  services: ArticleMcpServices,
  searchCache: SearchCache | undefined,
  toolArguments: unknown,
): Promise<CallToolResult> {
  const args = SearchLiteratureArgumentsSchema.parse(toolArguments);
  const strategy = SEARCH_STRATEGIES[args.search_type] ?? DEFAULT_SEARCH_STRATEGY;
  const sources = args.sources?.length ? args.sources : strategy.defaultSources;
  const maxResultsPerSource = Math.min(args.max_results, strategy.maxResultsPerSource);

  // 文件缓存层（Python SearchCache 等价）
  let cacheKey: string | undefined;
  if (searchCache && args.use_cache) {
    cacheKey = SearchCache.generateKey(args.keyword, sources, maxResultsPerSource);
    const cached = (await searchCache.get(cacheKey)) as Record<string, unknown> | null;
    if (cached) {
      cached.cached = true;
      cached.cache_hit = true;
      return structuredResult("search_literature", cached as Record<string, unknown>);
    }
  }

  const resultsBySource: Record<string, unknown[]> = {};
  const cacheHitsBySource: Record<string, boolean> = {};

  /**
   * 记录单个来源的搜索结果，并为文章标注来源级缓存元数据。
   *
   * @param source 搜索来源名称。
   * @param result 服务返回的原始搜索结果。
   */
  const recordSearchResults = (source: string, result: unknown): void => {
    if (!isRecord(result) || !Array.isArray(result.articles) || !result.articles.length) {
      return;
    }

    const sourceCacheHit = Boolean(result.cache_hit);
    cacheHitsBySource[source] = sourceCacheHit;
    resultsBySource[source] = result.articles.map((article) =>
      isRecord(article)
        ? {
            source,
            ...article,
            cache_hit: sourceCacheHit || Boolean(article.cache_hit),
          }
        : article,
    );
  };

  await Promise.all(
    sources.map(async (source) => {
      if (source === "europe_pmc") {
        const result = await services.europePmc.searchAsync(
          args.keyword,
          undefined,
          undefined,
          undefined,
          maxResultsPerSource,
          args.use_cache,
        );
        recordSearchResults(source, result);
      } else if (source === "pubmed") {
        const result = await services.pubmed.searchAsync(
          args.keyword,
          undefined,
          undefined,
          undefined,
          maxResultsPerSource,
          args.use_cache,
        );
        recordSearchResults(source, result);
      } else if (source === "arxiv") {
        const result = await services.arxiv.search({
          keyword: args.keyword,
          max_results: maxResultsPerSource,
          use_cache: args.use_cache,
        });
        recordSearchResults(source, result);
      } else if (source === "crossref") {
        const result = await services.crossref.searchWorksAsync(
          args.keyword,
          maxResultsPerSource,
          args.use_cache,
        );
        recordSearchResults(source, result);
      } else if (source === "openalex") {
        const result = await services.openalex.searchWorksAsync(args.keyword, maxResultsPerSource);
        recordSearchResults(source, result);
      }
    }),
  );

  const sourcesUsed = sources.filter((source) => Object.hasOwn(resultsBySource, source));
  const mergedResults = rankSearchResults(mergeArticles(resultsBySource, strategy.mergeStrategy));
  const cacheHit = Object.values(cacheHitsBySource).some(Boolean);

  const result: Record<string, unknown> = {
    success: true,
    keyword: args.keyword,
    sources_used: sourcesUsed,
    results_by_source: resultsBySource,
    merged_results: mergedResults,
    total_count: sourcesUsed.reduce(
      (sum, source) => sum + (resultsBySource[source]?.length ?? 0),
      0,
    ),
    search_time: 0,
    search_type: args.search_type,
    merge_strategy: strategy.mergeStrategy,
    cache_enabled: args.use_cache,
    cached: cacheHit,
    cache_hit: cacheHit,
    cache_hits_by_source: cacheHitsBySource,
  };

  // 保存到文件缓存
  if (searchCache && cacheKey) {
    await searchCache.set(cacheKey, result);
  }

  return structuredResult("search_literature", result);
}

async function handleGetArticleDetails(
  services: ArticleMcpServices,
  toolArguments: unknown,
): Promise<CallToolResult> {
  const startTime = Date.now();
  const args = GetArticleDetailsArgumentsSchema.parse(toolArguments);
  let pmcidList: string[];
  let sectionList: string[] | undefined;

  try {
    const normalizedPmcid = normalizeMaybeJsonArray(args.pmcid, "pmcid");
    pmcidList = Array.isArray(normalizedPmcid)
      ? normalizedPmcid
      : normalizedPmcid
        ? [normalizedPmcid]
        : [];

    const sections = normalizeMaybeJsonArray(args.sections, "sections");
    sectionList = Array.isArray(sections) ? sections : sections ? [sections] : undefined;
  } catch (error) {
    return structuredResult(
      "get_article_details",
      buildArticleDetailsErrorResult(
        Array.isArray(args.pmcid) ? args.pmcid.length : 1,
        error instanceof Error ? error.message : String(error),
      ),
      { success: false },
    );
  }

  if (!["markdown", "xml", "text"].includes(args.format)) {
    return structuredResult(
      "get_article_details",
      buildArticleDetailsErrorResult(
        pmcidList.length || 1,
        `无效的 format 参数: ${args.format}，有效值为: markdown, xml, text`,
      ),
      { success: false },
    );
  }

  if (!pmcidList.length) {
    return structuredResult("get_article_details", {
      total: 0,
      successful: 0,
      failed: 0,
      articles: [],
      fulltext_stats: null,
      processing_time: 0,
    });
  }

  if (pmcidList.length > 20) {
    return structuredResult(
      "get_article_details",
      {
        total: pmcidList.length,
        successful: 0,
        failed: pmcidList.length,
        articles: [],
        fulltext_stats: null,
        processing_time: 0,
        error: `PMCID 数量超过限制，最多支持20个，当前传入${pmcidList.length}个`,
      },
      { success: false },
    );
  }

  const articleResults = await mapWithConcurrency<string, ArticleDetailResult>(
    pmcidList,
    ARTICLE_DETAILS_CONCURRENCY,
    async (pmcid) => {
      const normalizedPmcid = normalizePmcid(pmcid);
      if (!normalizedPmcid) {
        console.warn(`非 PMCID 格式: ${pmcid}`);
        return { article: null, fulltextFetched: false };
      }

      const result = await services.europePmc.getArticleDetailsAsync(normalizedPmcid, "pmcid");
      const article = result.article;
      if (!article) {
        return { article: null, fulltextFetched: false };
      }

      const fulltext = await services.pubmed.getPMCFulltextHtmlAsync(normalizedPmcid, sectionList);
      let fulltextFetched = false;
      if (fulltext.fulltext_available) {
        const content = selectFulltextContent(fulltext, args.format);
        const resourceUri = buildArticleFulltextResourceUri(normalizedPmcid, {
          format: args.format,
          ...(sectionList ? { sections: sectionList } : {}),
        });
        const preview = truncatePreview(String(content ?? ""), FULLTEXT_PREVIEW_LIMIT);
        (article as unknown as Record<string, unknown>).fulltext = {
          format: args.format,
          content: preview,
          resource_uri: resourceUri,
          truncated: String(content ?? "").length > preview.length,
          fulltext_available: true,
          ...(fulltext.sections_requested
            ? {
                sections_requested: fulltext.sections_requested,
                sections_found: fulltext.sections_found,
                sections_missing: fulltext.sections_missing,
              }
            : {}),
        };
        fulltextFetched = true;
      }

      return { article, fulltextFetched };
    },
  );

  const successfulArticles = articleResults
    .map((result) => result.article)
    .filter((article) => Boolean(article));
  const fulltextFetched = articleResults.filter((result) => result.fulltextFetched).length;

  return structuredResult(
    "get_article_details",
    {
      total: pmcidList.length,
      successful: successfulArticles.length,
      failed: pmcidList.length - successfulArticles.length,
      articles: successfulArticles,
      fulltext_stats: {
        has_pmcid: successfulArticles.length,
        fulltext_fetched: fulltextFetched,
        no_fulltext: successfulArticles.length - fulltextFetched,
      },
      processing_time: Math.round(((Date.now() - startTime) / 1000) * 1000) / 1000,
    },
    {
      meta: buildArticleDetailsMeta(successfulArticles),
    },
  );
}

async function handleGetReferences(
  services: ArticleMcpServices,
  toolArguments: unknown,
): Promise<CallToolResult> {
  const args = GetReferencesArgumentsSchema.parse(toolArguments);
  return structuredResult(
    "get_references",
    await services.referenceService.getReferencesAsync({
      identifier: args.identifier,
      idType: args.id_type,
      maxResults: args.max_results,
      includeMetadata: args.include_metadata,
      ...(args.sources ? { sources: args.sources } : {}),
    }),
  );
}

async function handleGetLiteratureRelations(
  services: ArticleMcpServices,
  toolArguments: unknown,
): Promise<CallToolResult> {
  const args = GetLiteratureRelationsArgumentsSchema.parse(toolArguments);
  const finalIdentifiers = args.identifier ?? args.identifiers;
  const identifiers = Array.isArray(finalIdentifiers)
    ? finalIdentifiers
    : finalIdentifiers
      ? [finalIdentifiers]
      : [];

  const relations = await Promise.all(
    identifiers.slice(0, 20).map(async (identifier) => {
      const idType = args.id_type === "auto" ? extractIdentifierType(identifier) : args.id_type;
      const resolved = await resolveArticleIdentifiers(services, identifier, idType);
      const doiIdentifier = resolved.doi ?? (idType === "doi" ? identifier : null);
      const pmidIdentifier = resolved.pmid ?? (idType === "pmid" ? identifier : null);
      const relationResult: Record<string, unknown> = {
        identifier,
        resolved_identifier: resolved,
      };

      if (args.relation_types.includes("references")) {
        const referenceSources = (
          args.sources?.length ? args.sources : ["europe_pmc", "crossref", "pubmed"]
        ).filter((source) => ["europe_pmc", "crossref", "pubmed"].includes(source));
        const referenceResult = await services.referenceService.getReferencesAsync({
          identifier,
          idType,
          sources: referenceSources,
          maxResults: args.max_results,
          includeMetadata: false,
        });
        relationResult.references = Array.isArray(referenceResult.merged_references)
          ? referenceResult.merged_references
          : [];
      }

      if (args.relation_types.includes("citing") && doiIdentifier) {
        const citations = await services.openalex.getCitationsAsync(
          doiIdentifier,
          args.max_results,
        );
        relationResult.citing = citations.citations || [];
      }

      if (args.relation_types.includes("similar")) {
        const pmid =
          pmidIdentifier ??
          (doiIdentifier ? await services.pubmed.findPmidByDoiAsync(doiIdentifier) : null);
        if (pmid) {
          const similar = await services.pubmed.getSimilarArticlesAsync(
            pmid,
            undefined,
            args.max_results,
          );
          relationResult.similar = similar.similar_articles || [];
        } else {
          relationResult.similar = [];
        }
      }

      return relationResult;
    }),
  );

  const networkData =
    args.analysis_type === "network" || args.analysis_type === "comprehensive"
      ? await buildRelationNetworkData(
          services,
          relations,
          args.max_depth,
          args.max_results,
          args.sources,
        )
      : undefined;

  return structuredResult(
    "get_literature_relations",
    {
      success: true,
      identifier: finalIdentifiers,
      id_type: args.id_type,
      relation_types: args.relation_types,
      analysis_type: args.analysis_type,
      relations,
      ...(networkData ? { network_data: networkData } : {}),
      statistics: {
        total_relations: relations.reduce((sum, item) => sum + countRelationItems(item), 0),
      },
    },
    {
      meta: buildRelationMeta(finalIdentifiers, {
        id_type: args.id_type,
        relation_types: args.relation_types,
        analysis_type: args.analysis_type,
        max_results: args.max_results,
        max_depth: args.max_depth,
        ...(args.sources ? { sources: args.sources } : {}),
      }),
    },
  );
}

async function handleGetJournalQuality(
  services: ArticleMcpServices,
  journalQualityCache: JournalQualityCache | undefined,
  toolArguments: unknown,
): Promise<CallToolResult> {
  const args = GetJournalQualityArgumentsSchema.parse(toolArguments);
  const journalNames = Array.isArray(args.journal_name) ? args.journal_name : [args.journal_name];
  const requestedIncludeMetrics = Array.isArray(args.include_metrics)
    ? args.include_metrics
    : typeof args.include_metrics === "string"
      ? [args.include_metrics]
      : null;

  const journalResults = await Promise.all(
    journalNames.map(async (journalName) => {
      let easyScholarResult: Record<string, unknown> | null = null;
      let openalexMetrics: Record<string, unknown> | null = null;

      if (journalQualityCache && args.use_cache) {
        const cached = await journalQualityCache.getMergedResult(journalName);
        if (cached) {
          easyScholarResult = cached;
        }
      }

      if (!easyScholarResult) {
        easyScholarResult = (await services.easyscholar.getJournalQuality(
          journalName,
        )) as unknown as Record<string, unknown>;
        openalexMetrics = await services.openalexMetrics.getJournalMetrics(
          journalName,
          args.use_cache,
        );

        if (journalQualityCache && args.use_cache && easyScholarResult.success === true) {
          await journalQualityCache.set(journalName, easyScholarResult, openalexMetrics);
        }
      }

      const resolvedEasyScholarResult = easyScholarResult ?? {};
      const easyScholarMetrics = isRecord(resolvedEasyScholarResult.quality_metrics)
        ? resolvedEasyScholarResult.quality_metrics
        : {};
      const resolvedOpenAlexMetrics = isRecord(openalexMetrics) ? openalexMetrics : {};
      const hasEasyScholarMetrics = hasJournalMetricValues(easyScholarMetrics);
      const hasOpenAlexMetrics = hasJournalMetricValues(resolvedOpenAlexMetrics, ["source"]);
      const includeMetrics = resolveJournalIncludeMetrics(
        requestedIncludeMetrics,
        hasEasyScholarMetrics,
        hasOpenAlexMetrics,
      );
      const openAlexOnlyFallback = !hasEasyScholarMetrics && hasOpenAlexMetrics;

      const qualityMetrics = filterMetrics(
        {
          ...easyScholarMetrics,
          ...resolvedOpenAlexMetrics,
        },
        includeMetrics,
      );

      return {
        journal_name: journalName,
        quality_metrics: qualityMetrics,
        ranking_info: resolvedEasyScholarResult.ranking_info,
        data_source: resolveJournalQualityDataSource(
          resolvedEasyScholarResult.data_source,
          hasEasyScholarMetrics,
          hasOpenAlexMetrics,
        ),
        include_metrics: includeMetrics,
        ...(openAlexOnlyFallback
          ? {
              warning: buildJournalQualityFallbackWarning(resolvedEasyScholarResult.error),
            }
          : {}),
      };
    }),
  );

  return structuredResult(
    "get_journal_quality",
    journalNames.length === 1
      ? journalResults[0]
      : {
          success: true,
          journal_results: sortJournalResults(journalResults, args.sort_by, args.sort_order),
          sort_info: args.sort_by ? { field: args.sort_by, order: args.sort_order } : null,
        },
  );
}

function structuredResult(
  toolName: ArticleMcpToolName,
  payload: unknown,
  options: { success?: boolean; meta?: Record<string, unknown> } = {},
): CallToolResult {
  const summary = buildSummary(toolName, payload);
  const success = options.success ?? determineSuccess(payload);

  return createStructuredToolResult(
    {
      success,
      data: payload,
      meta: options.meta ?? {},
      ...(success ? {} : { error: extractErrorMessage(payload, summary) }),
    },
    summary,
    buildExcerpts(toolName, payload),
  );
}

function buildArticleDetailsMeta(articles: unknown[]): Record<string, unknown> {
  const resourceLinks = articles
    .filter(isRecord)
    .map((article) => {
      const fulltext = isRecord(article.fulltext) ? article.fulltext : null;
      const resourceUri = typeof fulltext?.resource_uri === "string" ? fulltext.resource_uri : null;
      if (!resourceUri) {
        return null;
      }

      return {
        type: "fulltext",
        pmcid: String(article.pmcid ?? article.pmc_id ?? "").trim() || null,
        format: typeof fulltext?.format === "string" ? fulltext.format : null,
        resource_uri: resourceUri,
        truncated: Boolean(fulltext?.truncated),
      };
    })
    .filter(Boolean);

  const truncatedCount = resourceLinks.filter(
    (link) => isRecord(link) && link.truncated === true,
  ).length;

  return {
    resource_links: resourceLinks,
    truncation: {
      preview_limit: FULLTEXT_PREVIEW_LIMIT,
      total_articles: articles.length,
      articles_with_resources: resourceLinks.length,
      truncated_articles: truncatedCount,
    },
  };
}

function buildRelationMeta(
  finalIdentifiers: string | string[] | null,
  args: {
    id_type: string;
    relation_types: string[];
    analysis_type: string;
    max_results: number;
    max_depth: number;
    sources?: string[];
  },
): Record<string, unknown> {
  const identifiers = Array.isArray(finalIdentifiers)
    ? finalIdentifiers
    : finalIdentifiers
      ? [finalIdentifiers]
      : [];

  const resourceLinks = identifiers.map((identifier) => ({
    type: "relations",
    identifier,
    resource_uri: buildArticleRelationsResourceUri({
      identifier,
      idType: args.id_type,
      relationTypes: args.relation_types,
      analysisType: args.analysis_type,
      maxResults: args.max_results,
      maxDepth: args.max_depth,
      ...(args.sources ? { sources: args.sources } : {}),
    }),
  }));

  return {
    resource_links: resourceLinks,
    truncation: {
      total_identifiers: identifiers.length,
      relation_types: args.relation_types,
      analysis_type: args.analysis_type,
      max_results: args.max_results,
      max_depth: args.max_depth,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function determineSuccess(payload: unknown): boolean {
  if (!isRecord(payload)) {
    return true;
  }

  if (payload.success === false) {
    return false;
  }

  return !Object.prototype.hasOwnProperty.call(payload, "error");
}

function extractErrorMessage(payload: unknown, fallback: string): string {
  if (!isRecord(payload)) {
    return fallback;
  }

  if (typeof payload.error === "string" && payload.error.trim()) {
    return payload.error;
  }

  return fallback;
}

function buildSummary(toolName: ArticleMcpToolName, payload: unknown): string {
  if (!isRecord(payload)) {
    return `${toolName} 返回了非结构化结果。`;
  }

  if (toolName === "search_literature") {
    const keyword = String(payload.keyword ?? "").trim();
    const sourcesUsed = Array.isArray(payload.sources_used) ? payload.sources_used : [];
    const mergedResults = Array.isArray(payload.merged_results) ? payload.merged_results : [];
    const totalCount = Number(payload.total_count ?? 0);
    const sourceText = sourcesUsed.length ? sourcesUsed.join("、") : "默认来源";
    return `关键词“${keyword || "未命名"}”在 ${sourceText} 中找到 ${totalCount} 条结果，合并后 ${mergedResults.length} 条。`;
  }

  if (toolName === "get_article_details") {
    const successful = Number(payload.successful ?? 0);
    const total = Number(payload.total ?? 0);
    const fulltextStats = isRecord(payload.fulltext_stats) ? payload.fulltext_stats : null;
    const fetched = Number(fulltextStats?.fulltext_fetched ?? 0);
    const totalWithPmcid = Number(fulltextStats?.has_pmcid ?? successful);
    return `已获取 ${successful}/${total} 篇文献详情，其中 ${fetched}/${totalWithPmcid} 篇返回全文。`;
  }

  if (toolName === "get_references") {
    const identifier = String(payload.identifier ?? "").trim();
    const mergedReferences = Array.isArray(payload.merged_references)
      ? payload.merged_references
      : [];
    return `文献 ${identifier || "未知标识符"} 的参考文献已解析，共 ${mergedReferences.length} 条。`;
  }

  if (toolName === "get_literature_relations") {
    const relations = Array.isArray(payload.relations) ? payload.relations : [];
    const statistics = isRecord(payload.statistics) ? payload.statistics : null;
    const totalRelations = Number(statistics?.total_relations ?? 0);
    return `已构建 ${relations.length} 个主体的文献关系图，共 ${totalRelations} 条关系。`;
  }

  if (toolName === "get_journal_quality") {
    if (Array.isArray(payload.journal_results)) {
      return `已批量返回 ${payload.journal_results.length} 本期刊的质量指标。`;
    }

    const journalName = String(payload.journal_name ?? "").trim();
    return `已返回 ${journalName || "目标期刊"} 的质量指标。`;
  }

  return "工具结果已返回。";
}

function buildExcerpts(toolName: ArticleMcpToolName, payload: unknown): string[] {
  if (!isRecord(payload)) {
    return [];
  }

  if (toolName === "search_literature") {
    return extractTitles(Array.isArray(payload.merged_results) ? payload.merged_results : []);
  }

  if (toolName === "get_article_details") {
    return extractTitles(Array.isArray(payload.articles) ? payload.articles : []);
  }

  if (toolName === "get_references") {
    return extractTitles(Array.isArray(payload.merged_references) ? payload.merged_references : []);
  }

  if (toolName === "get_literature_relations") {
    const relations = Array.isArray(payload.relations) ? payload.relations : [];
    return relations.slice(0, 3).map((relation) => {
      if (!isRecord(relation)) {
        return String(relation);
      }

      const identifier = String(relation.identifier ?? "").trim();
      const relationTypes = ["references", "citing", "similar"]
        .filter((key) => Array.isArray(relation[key]))
        .join("、");
      return relationTypes
        ? `${identifier || "未知主体"}：${relationTypes}`
        : identifier || "未命名关系主体";
    });
  }

  if (toolName === "get_journal_quality") {
    if (Array.isArray(payload.journal_results)) {
      return payload.journal_results.slice(0, 3).map((result) => {
        if (!isRecord(result)) {
          return String(result);
        }

        const journalName = String(result.journal_name ?? "").trim() || "未命名期刊";
        const metrics = isRecord(result.quality_metrics) ? result.quality_metrics : {};
        const impactFactor = metrics.impact_factor ?? metrics.jci ?? metrics.quartile;
        return impactFactor !== undefined ? `${journalName}：${String(impactFactor)}` : journalName;
      });
    }

    const metrics = isRecord(payload.quality_metrics) ? payload.quality_metrics : {};
    return Object.entries(metrics)
      .slice(0, 3)
      .map(([key, value]) => `${key}: ${String(value)}`);
  }

  return [];
}

function extractTitles(items: unknown[]): string[] {
  return items.slice(0, 3).map((item) => {
    if (!isRecord(item)) {
      return String(item);
    }

    const title = String(item.title ?? "").trim();
    const doi = String(item.doi ?? item.DOI ?? "").trim();
    const pmcid = String(item.pmcid ?? item.pmc_id ?? "").trim();
    const identifier = doi || pmcid;

    if (title && identifier) {
      return `${title}（${identifier}）`;
    }

    return title || identifier || "未命名条目";
  });
}

function countRelationItems(item: Record<string, unknown>): number {
  return ["references", "citing", "similar"].reduce((sum, key) => {
    const value = item[key];
    return sum + (Array.isArray(value) ? value.length : 0);
  }, 0);
}

function normalizeMaybeJsonArray(
  value: string | string[] | null,
  name: string,
): string | string[] | null {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    return trimmed;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${name} 参数格式错误：检测到字符串化数组，但 JSON 解析失败。请使用 ["value"] 格式。错误详情：${message}`,
      { cause: error },
    );
  }
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
    throw new Error(`${name} 参数格式错误：数组元素必须全部是字符串`);
  }

  return parsed;
}

function normalizePmcid(pmcid: string): string | null {
  const trimmed = pmcid.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = trimmed.startsWith("PMC") ? trimmed : `PMC${trimmed}`;
  return /^PMC\d+$/i.test(normalized) ? normalized.toUpperCase() : null;
}

function buildArticleDetailsErrorResult(total: number, error: string): Record<string, unknown> {
  return {
    total,
    successful: 0,
    failed: total,
    articles: [],
    fulltext_stats: null,
    processing_time: 0,
    error,
  };
}

function selectFulltextContent(fulltext: Record<string, unknown>, format: string): unknown {
  if (format === "xml") {
    return fulltext.fulltext_xml;
  }
  if (format === "text") {
    return fulltext.fulltext_text;
  }
  return fulltext.fulltext_markdown;
}

function truncatePreview(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }

  return `${text.slice(0, limit).trimEnd()}\n\n[全文已截断，请通过资源 URI 重新读取完整内容]`;
}

/**
 * 以指定最大并发数映射条目。
 *
 * @param items 要处理的条目。
 * @param concurrency 同时运行的 mapper 调用上限。
 * @param mapper 处理单个条目的异步映射函数。
 * @returns 与输入条目顺序一致的映射结果。
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex]!, currentIndex);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => worker()),
  );

  return results;
}

function articleKey(article: Record<string, unknown>): string | null {
  const doi = String(article.doi ?? article.DOI ?? "")
    .trim()
    .toLowerCase();
  if (doi) {
    return `doi:${doi}`;
  }

  const title = String(article.title ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  return title ? `title:${title}` : null;
}

function mergeArticles(
  resultsBySource: Record<string, unknown[]>,
  mergeStrategy: "union" | "intersection",
): Array<Record<string, unknown>> {
  const grouped = new Map<string, Record<string, unknown> & { sources: string[] }>();
  const sourceCount = Object.keys(resultsBySource).length;

  for (const [source, articles] of Object.entries(resultsBySource)) {
    for (const rawArticle of articles) {
      const article = isRecord(rawArticle) ? rawArticle : { value: rawArticle };
      const key = articleKey(article) ?? `${source}:${grouped.size}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.sources.push(source);
        Object.assign(existing, article);
      } else {
        grouped.set(key, { source, sources: [source], ...article });
      }
    }
  }

  const merged = Array.from(grouped.values());
  if (mergeStrategy !== "intersection" || sourceCount <= 1) {
    return merged;
  }

  return merged.filter((article) => new Set(article.sources).size > 1);
}

/**
 * 按与 Python 实现一致的来源优先级排序合并后的搜索结果。
 *
 * @param articles 合并后的搜索结果文章。
 * @returns 排序后的文章列表。
 */
function rankSearchResults(
  articles: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const sourcePriority = [
    "nature",
    "science",
    "cell",
    "europe_pmc",
    "pubmed",
    "crossref",
    "openalex",
    "arxiv",
  ];

  return [...articles].sort(
    (left, right) =>
      sourcePriorityScore(left, sourcePriority) - sourcePriorityScore(right, sourcePriority),
  );
}

/**
 * 根据来源元数据计算合并文章的优先级分数。
 *
 * @param article 合并后的文章记录。
 * @param sourcePriority 有序来源优先级列表。
 * @returns 分数越低，排序越靠前。
 */
function sourcePriorityScore(article: Record<string, unknown>, sourcePriority: string[]): number {
  const sources = Array.isArray(article.sources)
    ? article.sources.map((source) => String(source))
    : [article.source, article.source_from].filter(Boolean).map((source) => String(source));

  for (const [index, prioritySource] of sourcePriority.entries()) {
    if (sources.includes(prioritySource)) {
      return index;
    }
  }

  return sourcePriority.length;
}

function extractIdentifierType(identifier: string): "doi" | "pmid" | "pmcid" {
  const normalized = identifier.trim();
  const upper = normalized.toUpperCase();
  if (upper.startsWith("PMC") || upper.startsWith("PMCID:")) {
    return "pmcid";
  }
  if (/^\d+$/.test(normalized) || upper.startsWith("PMID:")) {
    return "pmid";
  }
  return "doi";
}

async function resolveArticleIdentifiers(
  services: ArticleMcpServices,
  identifier: string,
  idType: "auto" | "doi" | "pmid" | "pmcid",
): Promise<{ doi?: string; pmid?: string; pmcid?: string }> {
  const normalizedType = idType === "auto" ? extractIdentifierType(identifier) : idType;
  const normalizedIdentifier = identifier
    .replace(/^DOI:/i, "")
    .replace(/^PMID:/i, "")
    .replace(/^PMCID:/i, "")
    .trim();

  if (normalizedType === "doi") {
    const pmid = await services.pubmed.findPmidByDoiAsync(normalizedIdentifier);
    return { doi: normalizedIdentifier, ...(pmid ? { pmid } : {}) };
  }

  const details = await services.europePmc.getArticleDetailsAsync(
    normalizedIdentifier,
    normalizedType,
  );
  const article = details.article as unknown as Record<string, unknown> | null;
  if (!article) {
    return normalizedType === "pmid"
      ? { pmid: normalizedIdentifier }
      : { pmcid: normalizePmcid(normalizedIdentifier) ?? normalizedIdentifier };
  }

  return {
    ...(typeof article.doi === "string" ? { doi: article.doi } : {}),
    ...(typeof article.pmid === "string" ? { pmid: article.pmid } : {}),
    ...(typeof article.pmcid === "string"
      ? { pmcid: article.pmcid }
      : typeof article.pmc_id === "string"
        ? { pmcid: article.pmc_id }
        : {}),
  };
}

function buildRelationNetwork(relations: Array<Record<string, unknown>>): {
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
  clusters: Record<string, Array<Record<string, unknown>>>;
  metrics: {
    centrality: Record<string, number>;
    citationStrength: Record<string, number>;
    density: number;
  };
} {
  const nodes = new Map<string, Record<string, unknown>>();
  const edges: Array<Record<string, unknown>> = [];
  const degreeCount = new Map<string, number>();
  const citationCount = new Map<string, number>();

  for (const relation of relations) {
    const sourceId = String(relation.identifier);
    nodes.set(sourceId, { id: sourceId, type: "source", label: sourceId });

    for (const relationType of ["references", "citing", "similar"]) {
      const items = relation[relationType];
      if (!Array.isArray(items)) {
        continue;
      }

      for (const item of items) {
        const article: Record<string, unknown> = isRecord(item) ? item : { value: item };
        const targetId =
          String(article.doi ?? article.pmid ?? article.pmcid ?? article.title ?? "").trim() ||
          `${sourceId}:${relationType}:${edges.length}`;
        nodes.set(targetId, {
          id: targetId,
          type: relationType,
          label: article.title ?? targetId,
        });
        edges.push({
          source: sourceId,
          target: targetId,
          relation: relationType,
        });

        // 统计度数和引用强度
        degreeCount.set(sourceId, (degreeCount.get(sourceId) ?? 0) + 1);
        degreeCount.set(targetId, (degreeCount.get(targetId) ?? 0) + 1);
        citationCount.set(sourceId, (citationCount.get(sourceId) ?? 0) + 1);
      }
    }
  }

  const totalEdges = edges.length;
  const totalPossibleEdges = nodes.size * (nodes.size - 1);
  const density = totalPossibleEdges > 0 ? Number((totalEdges / totalPossibleEdges).toFixed(4)) : 0;

  // 计算中心度：度中心度 = 节点度数 / 最大度数
  const maxDegree = Math.max(...degreeCount.values(), 1);
  const centrality: Record<string, number> = {};
  for (const [nodeId, degree] of degreeCount) {
    centrality[nodeId] = Number((degree / maxDegree).toFixed(4));
  }

  // 计算引用强度：归一化引用次数
  const maxCitations = Math.max(...citationCount.values(), 1);
  const citationStrength: Record<string, number> = {};
  for (const [nodeId, count] of citationCount) {
    citationStrength[nodeId] = Number((count / maxCitations).toFixed(4));
  }

  return {
    nodes: Array.from(nodes.values()),
    edges,
    clusters: buildClusters(edges),
    metrics: { centrality, citationStrength, density },
  };
}

/**
 * 基于边的连通性构建聚类。
 * 将共享至少一个节点的边分组到同一聚类中。
 */
function buildClusters(
  edges: Array<Record<string, unknown>>,
): Record<string, Array<Record<string, unknown>>> {
  const nodeToEdge = new Map<string, number[]>();

  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i];
    if (!edge) {
      continue;
    }
    const source = String(edge.source);
    const target = String(edge.target);
    if (!nodeToEdge.has(source)) {
      nodeToEdge.set(source, []);
    }
    if (!nodeToEdge.has(target)) {
      nodeToEdge.set(target, []);
    }
    nodeToEdge.get(source)!.push(i);
    nodeToEdge.get(target)!.push(i);
  }

  const visited = new Set<number>();
  let clusterIndex = 0;
  const clusters: Record<string, Array<Record<string, unknown>>> = {};

  const visitEdge = (edgeIndex: number): void => {
    if (visited.has(edgeIndex)) {
      return;
    }
    visited.add(edgeIndex);
    const edge = edges[edgeIndex];
    if (edge) {
      const key = String(clusterIndex);
      if (!clusters[key]) {
        clusters[key] = [];
      }
      clusters[key]!.push(edge);

      // BFS 遍历相连节点
      for (const nodeId of [edge.source, edge.target]) {
        const connectedEdges = nodeToEdge.get(String(nodeId)) ?? [];
        for (const connectedIndex of connectedEdges) {
          visitEdge(connectedIndex);
        }
      }
    }
  };

  for (let i = 0; i < edges.length; i++) {
    if (!visited.has(i)) {
      visitEdge(i);
      clusterIndex++;
    }
  }

  return clusters;
}

async function buildRelationNetworkData(
  services: ArticleMcpServices,
  relations: Array<Record<string, unknown>>,
  maxDepth: number,
  maxResults: number,
  sources?: string[],
): Promise<{
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
  clusters: Record<string, Array<Record<string, unknown>>>;
  metrics: {
    centrality: Record<string, number>;
    citationStrength: Record<string, number>;
    density: number;
  };
}> {
  const network = buildRelationNetwork(relations);

  if (maxDepth <= 1) {
    return network;
  }

  const nodes = new Map<string, Record<string, unknown>>(
    network.nodes.map((node) => [String(node.id), node]),
  );
  const edges = [...network.edges];
  const referenceSources = (
    sources?.length ? sources : ["europe_pmc", "crossref", "pubmed"]
  ).filter((source) => ["europe_pmc", "crossref", "pubmed"].includes(source));
  const frontier: Array<{
    relationType: "references" | "citing" | "similar";
    nodeId: string;
    identifier: string;
    idType: "doi" | "pmid" | "pmcid";
    depth: number;
  }> = [];
  const expanded = new Set<string>();

  for (const relation of relations) {
    for (const relationType of ["references", "citing", "similar"] as const) {
      const items = relation[relationType];
      if (!Array.isArray(items)) {
        continue;
      }

      for (const item of items) {
        const expansionTarget = relationExpansionTarget(item);
        if (!expansionTarget) {
          continue;
        }

        frontier.push({
          relationType,
          nodeId: expansionTarget.nodeId,
          identifier: expansionTarget.identifier,
          idType: expansionTarget.idType,
          depth: 1,
        });
      }
    }
  }

  while (frontier.length) {
    const current = frontier.shift();
    if (!current || current.depth >= maxDepth) {
      continue;
    }

    const expansionKey =
      `${current.relationType}:${current.idType}:${current.identifier}`.toLowerCase();
    if (expanded.has(expansionKey)) {
      continue;
    }
    expanded.add(expansionKey);

    const relatedItems = await expandRelationBranch(
      services,
      current,
      referenceSources,
      maxResults,
      sources,
    );

    for (const item of relatedItems) {
      const article: Record<string, unknown> = isRecord(item) ? item : { value: item };
      const targetId =
        relationNodeId(article) ?? `${current.nodeId}:${current.relationType}:${edges.length}`;
      const targetTitle = typeof article.title === "string" ? article.title.trim() : "";
      const targetLabel = targetTitle || targetId;
      if (!nodes.has(targetId)) {
        nodes.set(targetId, {
          id: targetId,
          type: current.relationType,
          label: targetLabel,
        });
      }

      const edgeKey = `${current.nodeId}->${targetId}:${current.relationType}`;
      if (!edges.some((edge) => `${edge.source}->${edge.target}:${edge.relation}` === edgeKey)) {
        edges.push({
          source: current.nodeId,
          target: targetId,
          relation: current.relationType,
          depth: current.depth + 1,
        });
      }

      const nextTarget = relationExpansionTarget(article);
      if (nextTarget) {
        frontier.push({
          relationType: current.relationType,
          nodeId: targetId,
          identifier: nextTarget.identifier,
          idType: nextTarget.idType,
          depth: current.depth + 1,
        });
      }
    }
  }

  const finalNodes = Array.from(nodes.values());
  const clusters = buildClusters(edges);
  const metrics = calculateNetworkMetrics(finalNodes, edges);

  return {
    nodes: finalNodes,
    edges,
    clusters,
    metrics,
  };
}

async function expandRelationBranch(
  services: ArticleMcpServices,
  current: {
    relationType: "references" | "citing" | "similar";
    nodeId: string;
    identifier: string;
    idType: "doi" | "pmid" | "pmcid";
    depth: number;
  },
  referenceSources: string[],
  maxResults: number,
  sources?: string[],
): Promise<unknown[]> {
  if (current.relationType === "references") {
    const referenceResult = await services.referenceService.getReferencesAsync({
      identifier: current.identifier,
      idType: current.idType,
      sources: referenceSources,
      maxResults,
      includeMetadata: false,
    });

    return Array.isArray(referenceResult.merged_references)
      ? referenceResult.merged_references
      : [];
  }

  if (current.relationType === "citing") {
    if (sources?.length && !sources.includes("openalex")) {
      return [];
    }

    const resolved = await resolveArticleIdentifiers(services, current.identifier, current.idType);
    const doi = resolved.doi ?? (current.idType === "doi" ? current.identifier : null);
    if (!doi) {
      return [];
    }

    const citations = await services.openalex.getCitationsAsync(doi, maxResults);
    return Array.isArray(citations.citations) ? citations.citations : [];
  }

  if (sources?.length && !sources.includes("pubmed")) {
    return [];
  }

  const resolved = await resolveArticleIdentifiers(services, current.identifier, current.idType);
  const pmid =
    resolved.pmid ??
    (current.idType === "pmid" ? current.identifier : null) ??
    (resolved.doi ? await services.pubmed.findPmidByDoiAsync(resolved.doi) : null);
  if (!pmid) {
    return [];
  }

  const similar = await services.pubmed.getSimilarArticlesAsync(pmid, undefined, maxResults);
  return Array.isArray(similar.similar_articles) ? similar.similar_articles : [];
}

function calculateNetworkMetrics(
  nodes: Array<Record<string, unknown>>,
  edges: Array<Record<string, unknown>>,
): {
  centrality: Record<string, number>;
  citationStrength: Record<string, number>;
  density: number;
} {
  const degreeCount = new Map<string, number>();
  const citationCount = new Map<string, number>();

  for (const edge of edges) {
    const source = String(edge.source);
    const target = String(edge.target);
    degreeCount.set(source, (degreeCount.get(source) ?? 0) + 1);
    degreeCount.set(target, (degreeCount.get(target) ?? 0) + 1);
    citationCount.set(source, (citationCount.get(source) ?? 0) + 1);
  }

  const totalEdges = edges.length;
  const totalPossibleEdges = nodes.length * (nodes.length - 1);
  const density = totalPossibleEdges > 0 ? Number((totalEdges / totalPossibleEdges).toFixed(4)) : 0;

  const maxDegree = Math.max(...degreeCount.values(), 1);
  const centrality: Record<string, number> = {};
  for (const [nodeId, degree] of degreeCount) {
    centrality[nodeId] = Number((degree / maxDegree).toFixed(4));
  }

  const maxCitations = Math.max(...citationCount.values(), 1);
  const citationStrength: Record<string, number> = {};
  for (const [nodeId, count] of citationCount) {
    citationStrength[nodeId] = Number((count / maxCitations).toFixed(4));
  }

  return { centrality, citationStrength, density };
}

function relationExpansionTarget(
  item: unknown,
): { nodeId: string; identifier: string; idType: "doi" | "pmid" | "pmcid" } | null {
  if (!isRecord(item)) {
    return null;
  }

  const doi = String(item.doi ?? item.DOI ?? "").trim();
  if (doi) {
    return { nodeId: doi, identifier: doi, idType: "doi" };
  }

  const pmid = String(item.pmid ?? "").trim();
  if (pmid) {
    return { nodeId: pmid, identifier: pmid, idType: "pmid" };
  }

  const pmcid = String(item.pmcid ?? item.pmc_id ?? "").trim();
  if (pmcid) {
    return { nodeId: pmcid, identifier: pmcid, idType: "pmcid" };
  }

  return null;
}

function relationNodeId(item: Record<string, unknown>): string | null {
  return (
    String(item.doi ?? item.DOI ?? "").trim() ||
    String(item.pmid ?? "").trim() ||
    String(item.pmcid ?? item.pmc_id ?? "").trim() ||
    String(item.title ?? "").trim() ||
    null
  );
}

function filterMetrics(
  metrics: Record<string, unknown>,
  includeMetrics: string[],
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(metrics).filter(([key]) => includeMetrics.includes(key)),
  );
}

/**
 * 判断期刊指标对象是否包含实际可返回的度量值。
 *
 * @param metrics 指标对象。
 * @param ignoredKeys 计算时忽略的字段名。
 * @returns 只要存在至少一个非空指标值则返回 true。
 */
function hasJournalMetricValues(
  metrics: Record<string, unknown>,
  ignoredKeys: string[] = [],
): boolean {
  return Object.entries(metrics).some(([key, value]) => {
    if (ignoredKeys.includes(key)) {
      return false;
    }

    return value !== null && value !== undefined && value !== "";
  });
}

/**
 * 解析期刊质量工具的最终指标过滤列表。
 *
 * @param requestedIncludeMetrics 用户显式请求的指标；为 null 表示使用默认策略。
 * @param hasEasyScholarMetrics EasyScholar 是否返回了可用指标。
 * @param hasOpenAlexMetrics OpenAlex 是否返回了可用指标。
 * @returns 用于最终过滤返回值的指标列表。
 */
function resolveJournalIncludeMetrics(
  requestedIncludeMetrics: string[] | null,
  hasEasyScholarMetrics: boolean,
  hasOpenAlexMetrics: boolean,
): string[] {
  if (requestedIncludeMetrics) {
    return requestedIncludeMetrics;
  }

  if (!hasEasyScholarMetrics && hasOpenAlexMetrics) {
    return [...DEFAULT_JOURNAL_INCLUDE_METRICS, ...OPENALEX_JOURNAL_METRIC_KEYS];
  }

  return [...DEFAULT_JOURNAL_INCLUDE_METRICS];
}

/**
 * 解析期刊质量结果的数据来源字段。
 *
 * @param dataSource EasyScholar 侧已有的数据来源字段。
 * @param hasEasyScholarMetrics EasyScholar 是否返回了可用指标。
 * @param hasOpenAlexMetrics OpenAlex 是否返回了可用指标。
 * @returns 统一后的数据来源标识。
 */
function resolveJournalQualityDataSource(
  dataSource: unknown,
  hasEasyScholarMetrics: boolean,
  hasOpenAlexMetrics: boolean,
): string | null {
  if (typeof dataSource === "string" && dataSource.trim()) {
    return dataSource;
  }

  if (!hasEasyScholarMetrics && hasOpenAlexMetrics) {
    return "openalex";
  }

  return null;
}

/**
 * 为 OpenAlex 退化路径构造可读警告。
 *
 * @param error EasyScholar 返回的原始错误信息。
 * @returns 面向 MCP 调用方的警告文本。
 */
function buildJournalQualityFallbackWarning(error: unknown): string {
  const normalizedError = typeof error === "string" ? error.trim() : "";
  if (normalizedError) {
    return `EasyScholar 不可用（${normalizedError}），当前仅返回 OpenAlex 指标。`;
  }

  return "EasyScholar 不可用，当前仅返回 OpenAlex 指标。";
}

function sortJournalResults<T extends { quality_metrics: Record<string, unknown> }>(
  results: T[],
  sortBy: "impact_factor" | "quartile" | "jci" | null,
  sortOrder: "desc" | "asc",
): T[] {
  if (!sortBy) {
    return results;
  }

  return [...results].sort((left, right) => {
    const leftMetric = metricSortValue(left.quality_metrics[sortBy], sortBy);
    const rightMetric = metricSortValue(right.quality_metrics[sortBy], sortBy);

    if (leftMetric.hasValue !== rightMetric.hasValue) {
      return leftMetric.hasValue ? -1 : 1;
    }

    if (leftMetric.value !== rightMetric.value) {
      return sortOrder === "asc"
        ? leftMetric.value - rightMetric.value
        : rightMetric.value - leftMetric.value;
    }

    const leftName = String((left as Record<string, unknown>).journal_name ?? "");
    const rightName = String((right as Record<string, unknown>).journal_name ?? "");
    return leftName.localeCompare(rightName);
  });
}

function metricSortValue(value: unknown, sortBy: string): { hasValue: boolean; value: number } {
  if (sortBy === "quartile") {
    const normalized = String(value).trim().toUpperCase();
    const order: Record<string, number> = {
      Q1: 4,
      "1区": 4,
      一区: 4,
      中科院一区: 4,
      Q2: 3,
      "2区": 3,
      二区: 3,
      中科院二区: 3,
      Q3: 2,
      "3区": 2,
      三区: 2,
      中科院三区: 2,
      Q4: 1,
      "4区": 1,
      四区: 1,
      中科院四区: 1,
    };
    const mapped = order[normalized];
    return { hasValue: mapped !== undefined, value: mapped ?? 0 };
  }

  if (value === null || value === undefined || value === "") {
    return { hasValue: false, value: 0 };
  }

  const numeric = Number(value);
  return { hasValue: Number.isFinite(numeric), value: Number.isFinite(numeric) ? numeric : 0 };
}

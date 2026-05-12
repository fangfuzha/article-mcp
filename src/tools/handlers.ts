import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { ArticleMcpServices } from "../services/container.js";
import {
  GetArticleDetailsArgumentsSchema,
  GetJournalQualityArgumentsSchema,
  GetLiteratureRelationsArgumentsSchema,
  GetReferencesArgumentsSchema,
  SearchLiteratureArgumentsSchema,
} from "./schemas.js";

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

/**
 * Creates all Article MCP tool handlers backed by concrete services.
 *
 * @param services Article MCP service container.
 * @returns Tool handlers keyed by MCP tool name.
 */
export function createToolHandlers(services: ArticleMcpServices): ToolHandlerMap {
  return {
    search_literature: (toolArguments) => handleSearchLiterature(services, toolArguments),
    get_article_details: (toolArguments) => handleGetArticleDetails(services, toolArguments),
    get_references: (toolArguments) => handleGetReferences(services, toolArguments),
    get_literature_relations: (toolArguments) =>
      handleGetLiteratureRelations(services, toolArguments),
    get_journal_quality: (toolArguments) => handleGetJournalQuality(services, toolArguments),
  };
}

async function handleSearchLiterature(
  services: ArticleMcpServices,
  toolArguments: unknown,
): Promise<CallToolResult> {
  const args = SearchLiteratureArgumentsSchema.parse(toolArguments);
  const strategy = SEARCH_STRATEGIES[args.search_type] ?? DEFAULT_SEARCH_STRATEGY;
  const sources = args.sources?.length ? args.sources : strategy.defaultSources;
  const maxResultsPerSource = Math.min(args.max_results, strategy.maxResultsPerSource);

  const resultsBySource: Record<string, unknown[]> = {};
  const cacheHitsBySource: Record<string, boolean> = {};

  /**
   * Records a source search result and annotates articles with source-level cache metadata.
   *
   * @param source Search source name.
   * @param result Raw service search result.
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

  return textResult({
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
  });
}

async function handleGetArticleDetails(
  services: ArticleMcpServices,
  toolArguments: unknown,
): Promise<CallToolResult> {
  const startTime = Date.now();
  const args = GetArticleDetailsArgumentsSchema.parse(toolArguments);
  const normalizedPmcid = normalizeMaybeJsonArray(args.pmcid, "pmcid");
  const pmcidList = Array.isArray(normalizedPmcid)
    ? normalizedPmcid
    : normalizedPmcid
      ? [normalizedPmcid]
      : [];
  const sections = normalizeMaybeJsonArray(args.sections, "sections");
  const sectionList = Array.isArray(sections) ? sections : sections ? [sections] : undefined;

  if (pmcidList.length > 20) {
    return textResult({
      total: pmcidList.length,
      successful: 0,
      failed: pmcidList.length,
      articles: [],
      fulltext_stats: null,
      processing_time: 0,
      error: `PMCID 数量超过限制，最多支持20个，当前传入${pmcidList.length}个`,
    });
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
        (article as unknown as Record<string, unknown>).fulltext = {
          format: args.format,
          content,
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

  return textResult({
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
  });
}

async function handleGetReferences(
  services: ArticleMcpServices,
  toolArguments: unknown,
): Promise<CallToolResult> {
  const args = GetReferencesArgumentsSchema.parse(toolArguments);
  return textResult(
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

  return textResult({
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
  });
}

async function handleGetJournalQuality(
  services: ArticleMcpServices,
  toolArguments: unknown,
): Promise<CallToolResult> {
  const args = GetJournalQualityArgumentsSchema.parse(toolArguments);
  const journalNames = Array.isArray(args.journal_name) ? args.journal_name : [args.journal_name];
  const includeMetrics = Array.isArray(args.include_metrics)
    ? args.include_metrics
    : args.include_metrics
      ? [args.include_metrics]
      : ["impact_factor", "quartile", "jci"];

  const journalResults = await Promise.all(
    journalNames.map(async (journalName) => {
      const easyScholarResult = await services.easyscholar.getJournalQuality(journalName);
      const openalexMetrics = await services.openalexMetrics.getJournalMetrics(
        journalName,
        args.use_cache,
      );
      const qualityMetrics = filterMetrics(
        {
          ...easyScholarResult.quality_metrics,
          ...(openalexMetrics || {}),
        },
        includeMetrics,
      );

      return {
        journal_name: journalName,
        quality_metrics: qualityMetrics,
        ranking_info: easyScholarResult.ranking_info,
        data_source: easyScholarResult.data_source,
        include_metrics: includeMetrics,
      };
    }),
  );

  return textResult(
    journalNames.length === 1
      ? journalResults[0]
      : {
          success: true,
          journal_results: sortJournalResults(journalResults, args.sort_by, args.sort_order),
          sort_info: args.sort_by ? { field: args.sort_by, order: args.sort_order } : null,
        },
  );
}

function textResult(payload: unknown): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

function selectFulltextContent(fulltext: Record<string, unknown>, format: string): unknown {
  if (format === "xml") {
    return fulltext.fulltext_xml;
  }
  if (format === "text") {
    return fulltext.fulltext_text;
  }
  return fulltext.fulltext_markdown;
}

/**
 * Maps items with a maximum number of in-flight async tasks.
 *
 * @param items Items to process.
 * @param concurrency Maximum number of simultaneously running mapper calls.
 * @param mapper Async mapper for one item.
 * @returns Mapped results in the same order as the input items.
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
 * Sorts merged search results with the same source priority as the Python implementation.
 *
 * @param articles Merged search result articles.
 * @returns Ranked article list.
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
 * Calculates the priority score of a merged article from its source metadata.
 *
 * @param article Merged article record.
 * @param sourcePriority Ordered source priority list.
 * @returns Lower score means higher rank.
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
  clusters: Record<string, unknown>;
} {
  const nodes = new Map<string, Record<string, unknown>>();
  const edges: Array<Record<string, unknown>> = [];

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
      }
    }
  }

  return {
    nodes: Array.from(nodes.values()),
    edges,
    clusters: {},
  };
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
  clusters: Record<string, unknown>;
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
    nodeId: string;
    identifier: string;
    idType: "doi" | "pmid" | "pmcid";
    depth: number;
  }> = [];
  const expanded = new Set<string>();

  for (const relation of relations) {
    for (const relationType of ["references", "citing"] as const) {
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

    const expansionKey = `${current.idType}:${current.identifier}`.toLowerCase();
    if (expanded.has(expansionKey)) {
      continue;
    }
    expanded.add(expansionKey);

    const referenceResult = await services.referenceService.getReferencesAsync({
      identifier: current.identifier,
      idType: current.idType,
      sources: referenceSources,
      maxResults,
      includeMetadata: false,
    });
    const references = Array.isArray(referenceResult.merged_references)
      ? referenceResult.merged_references
      : [];

    for (const item of references) {
      const article: Record<string, unknown> = isRecord(item) ? item : { value: item };
      const targetId = relationNodeId(article) ?? `${current.nodeId}:references:${edges.length}`;
      const targetTitle = typeof article.title === "string" ? article.title.trim() : "";
      const targetLabel = targetTitle || targetId;
      if (!nodes.has(targetId)) {
        nodes.set(targetId, {
          id: targetId,
          type: "references",
          label: targetLabel,
        });
      }

      const edgeKey = `${current.nodeId}->${targetId}:references`;
      if (!edges.some((edge) => `${edge.source}->${edge.target}:${edge.relation}` === edgeKey)) {
        edges.push({
          source: current.nodeId,
          target: targetId,
          relation: "references",
          depth: current.depth + 1,
        });
      }

      const nextTarget = relationExpansionTarget(article);
      if (nextTarget) {
        frontier.push({
          nodeId: targetId,
          identifier: nextTarget.identifier,
          idType: nextTarget.idType,
          depth: current.depth + 1,
        });
      }
    }
  }

  return {
    nodes: Array.from(nodes.values()),
    edges,
    clusters: {},
  };
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

function sortJournalResults<T extends { quality_metrics: Record<string, unknown> }>(
  results: T[],
  sortBy: "impact_factor" | "quartile" | "jci" | null,
  sortOrder: "desc" | "asc",
): T[] {
  if (!sortBy) {
    return results;
  }

  const direction = sortOrder === "asc" ? 1 : -1;
  return [...results].sort((left, right) => {
    const leftValue = metricSortValue(left.quality_metrics[sortBy], sortBy);
    const rightValue = metricSortValue(right.quality_metrics[sortBy], sortBy);
    return (leftValue - rightValue) * direction;
  });
}

function metricSortValue(value: unknown, sortBy: string): number {
  if (sortBy === "quartile") {
    const order: Record<string, number> = { Q1: 4, Q2: 3, Q3: 2, Q4: 1 };
    return order[String(value).toUpperCase()] ?? 0;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

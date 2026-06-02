import { describe, expect, it, vi } from "vitest";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { ArticleMcpServices } from "../src/services/container.js";
import { UnifiedReferenceService } from "../src/services/reference_service.js";
import { createToolHandlers } from "../src/tools/handlers.js";

function parseTextResult(result: CallToolResult): Record<string, any> {
  if (result.structuredContent && typeof result.structuredContent === "object") {
    const structured = result.structuredContent as Record<string, any>;
    const data = structured.data && typeof structured.data === "object" ? structured.data : {};
    return {
      ...structured,
      ...data,
    };
  }

  const textContent = result.content.find((item) => item.type === "text");
  if (!textContent || textContent.type !== "text") {
    throw new Error("工具结果缺少文本内容");
  }

  return JSON.parse(textContent.text) as Record<string, any>;
}

function createMockServices(): ArticleMcpServices {
  const services = {
    europePmc: {
      searchAsync: async () => ({
        articles: [
          {
            title: "Shared article",
            doi: "10.1000/shared",
            journal_name: "Europe PMC Journal",
          },
        ],
        total_count: 1,
      }),
      getArticleDetailsAsync: async (pmcid: string) => ({
        article: {
          pmid: "1",
          title: `Article ${pmcid}`,
          authors: ["A"],
          journal_name: "Journal",
          publication_date: "2026-01-01",
          abstract: "Abstract",
          pmcid,
        },
      }),
      getReferencesAsync: async () => ({
        references: [
          {
            title: "Reference A",
            doi: "10.1000/ref-a",
            authors: ["Europe Author"],
            journal: "Europe PMC Journal",
            abstract: "Europe PMC reference metadata",
            pmid: "12345",
            pmcid: "PMC12345",
          },
        ],
        total_count: 1,
        source: "europe_pmc",
      }),
      searchBatchDoiAsync: async () => [
        {
          title: "Reference A",
          doi: "10.1000/ref-a",
          authorString: "Alice, Bob",
          journalInfo: { journal: { title: "Journal A" } },
          firstPublicationDate: "2025-01-01",
          abstractText: "Metadata",
        },
      ],
    },
    pubmed: {
      searchAsync: async () => ({
        articles: [
          {
            title: "Shared article",
            doi: "10.1000/shared",
            journal_name: "PubMed Journal",
          },
        ],
      }),
      getPMCFulltextHtmlAsync: async (_pmcid: string, sections?: string[]) => ({
        pmc_id: "PMC123",
        fulltext_xml: "<body><sec><title>Methods</title><p>XML body</p></sec></body>",
        fulltext_markdown: "## Methods\n\nMarkdown body",
        fulltext_text: "Methods Text body",
        fulltext_available: true,
        sections_requested: sections,
        sections_found: sections ?? [],
        sections_missing: [],
      }),
      getCitingArticlesAsync: async () => ({
        citing_articles: [
          {
            title: "Reference A",
            doi: "10.1000/ref-a",
            authors: ["Alice"],
            journal_name: "PubMed Journal",
            abstract: "Extra metadata",
          },
        ],
      }),
      findPmidByDoiAsync: async () => "12345",
      getSimilarArticlesAsync: async () => ({
        similar_articles: [
          {
            pmid: "67890",
            title: "Similar article",
            authors: ["Dana"],
            journal_name: "Similar Journal",
            publication_date: "2024-01-01",
            abstract: "Similar abstract",
            doi: "10.1000/similar",
          },
        ],
      }),
    },
    arxiv: {
      search: async () => ({
        articles: [{ title: "Preprint", arxiv_id: "1234.5678" }],
      }),
    },
    crossref: {
      searchWorksAsync: async () => ({
        articles: [{ title: "CrossRef article", doi: "10.1000/crossref" }],
      }),
      getReferencesAsync: async () => ({
        references: [
          {
            title: "Reference A",
            doi: "10.1000/ref-a",
            authors: ["Alice"],
            journal: "CrossRef Journal",
            abstract: "CrossRef metadata",
          },
          {
            title: "Reference B",
            doi: "10.1000/ref-b",
            authors: ["Carol"],
            journal: "CrossRef Journal",
          },
        ],
      }),
    },
    openalex: {
      searchWorksAsync: async () => ({
        articles: [{ title: "OpenAlex article", doi: "10.1000/openalex" }],
      }),
      getCitationsAsync: async () => ({ citations: [] }),
    },
    easyscholar: {
      getJournalQuality: async (journalName: string) => ({
        journal_name: journalName,
        quality_metrics: {
          impact_factor: journalName === "Nature" ? 64 : 55,
          quartile: journalName === "Nature" ? "Q1" : "Q2",
          jci: journalName === "Nature" ? "5" : "4",
        },
        ranking_info: {},
        data_source: "mock",
      }),
    },
    openalexMetrics: {
      getJournalMetrics: async () => ({ h_index: 100, source: "openalex" }),
      batchGetJournalMetrics: async () => [],
    },
  } as unknown as ArticleMcpServices;

  services.referenceService = new UnifiedReferenceService(
    {
      europePmc: services.europePmc,
      crossref: services.crossref,
      pubmed: services.pubmed,
    } as any,
    console,
  );

  return services;
}

describe("tool handlers", () => {
  it("keeps readable content as summary and key excerpts instead of JSON payload", async () => {
    const handlers = createToolHandlers(createMockServices());
    const result = await handlers.search_literature!({
      keyword: "summary",
      sources: ["pubmed", "europe_pmc"],
      max_results: 5,
    });

    const textContent = result.content.find((item) => item.type === "text");

    expect(result.structuredContent).toMatchObject({ success: true });
    expect(textContent?.type).toBe("text");
    if (textContent?.type === "text") {
      expect(textContent.text).toContain("找到");
      expect(textContent.text).toContain("关键摘录:");
      expect(() => JSON.parse(textContent.text)).toThrow();
    }
  });

  it("applies precise search strategy as intersection merge", async () => {
    const handlers = createToolHandlers(createMockServices());
    const result = parseTextResult(
      await handlers.search_literature!({
        keyword: "cancer",
        search_type: "precise",
        max_results: 20,
      }),
    );

    expect(result.sources_used).toEqual(["pubmed", "europe_pmc"]);
    expect(result.merge_strategy).toBe("intersection");
    expect(result.merged_results).toHaveLength(1);
    expect(result.merged_results[0].sources).toEqual(["pubmed", "europe_pmc"]);
  });

  it("forwards search cache options and reports cache hits by source", async () => {
    const calls: Record<string, any[]> = {};
    const services = createMockServices();

    services.europePmc.searchAsync = async (...args: any[]) => {
      calls.europe_pmc = args;
      return {
        articles: [
          {
            pmid: "1",
            title: "Europe cached",
            authors: ["Alice"],
            journal_name: "Europe Journal",
            publication_date: "2026-01-01",
            abstract: "Europe abstract",
            doi: "10.1000/europe",
          },
        ],
        total_count: 1,
        cache_hit: args[5] === true,
      };
    };
    services.pubmed.searchAsync = async (...args: any[]) => {
      calls.pubmed = args;
      return {
        articles: [
          {
            pmid: "2",
            title: "PubMed fresh",
            authors: ["Bob"],
            journal_name: "PubMed Journal",
            publication_date: "2025-01-01",
            abstract: "PubMed abstract",
            doi: "10.1000/pubmed",
          },
        ],
        cache_hit: false,
      };
    };
    services.arxiv.search = async (params: Record<string, unknown>) => {
      calls.arxiv = [params];
      return { articles: [{ title: "Preprint", arxiv_id: "1234.5678" }], cache_hit: false };
    };
    services.crossref.searchWorksAsync = async (...args: any[]) => {
      calls.crossref = args;
      return { articles: [{ title: "CrossRef", doi: "10.1000/crossref" }], cache_hit: false };
    };

    const handlers = createToolHandlers(services);
    const freshResult = parseTextResult(
      await handlers.search_literature!({
        keyword: "cache",
        sources: ["europe_pmc", "pubmed", "arxiv", "crossref"],
        use_cache: false,
      }),
    );

    expect(calls.europe_pmc?.[5]).toBe(false);
    expect(calls.pubmed?.[5]).toBe(false);
    expect(calls.arxiv?.[0].use_cache).toBe(false);
    expect(calls.crossref?.[2]).toBe(false);
    expect(freshResult.cache_enabled).toBe(false);
    expect(freshResult.cache_hit).toBe(false);

    const cachedResult = parseTextResult(
      await handlers.search_literature!({
        keyword: "cache",
        sources: ["europe_pmc"],
        use_cache: true,
      }),
    );

    expect(calls.europe_pmc?.[5]).toBe(true);
    expect(cachedResult.cache_enabled).toBe(true);
    expect(cachedResult.cache_hit).toBe(true);
    expect(cachedResult.cached).toBe(true);
    expect(cachedResult.cache_hits_by_source).toEqual({ europe_pmc: true });
    expect(cachedResult.merged_results[0].cache_hit).toBe(true);
  });

  it("normalizes PMCID arrays and returns requested fulltext format", async () => {
    const handlers = createToolHandlers(createMockServices());
    const result = parseTextResult(
      await handlers.get_article_details!({
        pmcid: '["123"]',
        sections: "methods",
        format: "text",
      }),
    );

    expect(result.successful).toBe(1);
    expect(result.fulltext_stats.fulltext_fetched).toBe(1);
    expect(result.articles[0].pmcid).toBe("PMC123");
    expect(result.articles[0].fulltext).toMatchObject({
      format: "text",
      content: "Methods Text body",
      sections_requested: ["methods"],
      resource_uri: "article://fulltext/PMC123?format=text&sections=methods",
      truncated: false,
    });
    expect(result.meta.resource_links).toEqual([
      {
        type: "fulltext",
        pmcid: "PMC123",
        format: "text",
        resource_uri: "article://fulltext/PMC123?format=text&sections=methods",
        truncated: false,
      },
    ]);
    expect(result.meta.truncation).toMatchObject({
      preview_limit: expect.any(Number),
      total_articles: 1,
      articles_with_resources: 1,
      truncated_articles: 0,
    });
  });

  it("defaults fulltext format to markdown", async () => {
    const handlers = createToolHandlers(createMockServices());
    const result = parseTextResult(
      await handlers.get_article_details!({
        pmcid: "PMC123",
      }),
    );

    expect(result.successful).toBe(1);
    expect(result.articles[0].fulltext).toMatchObject({
      format: "markdown",
      content: "## Methods\n\nMarkdown body",
      resource_uri: "article://fulltext/PMC123?format=markdown",
      truncated: false,
    });
    expect(result.meta.resource_links[0].resource_uri).toBe(
      "article://fulltext/PMC123?format=markdown",
    );
    expect(result.articles[0].fulltext).not.toHaveProperty("fulltext_xml");
    expect(result.articles[0].fulltext).not.toHaveProperty("fulltext_text");
  });

  it("returns xml fulltext content when requested", async () => {
    const handlers = createToolHandlers(createMockServices());
    const result = parseTextResult(
      await handlers.get_article_details!({
        pmcid: "PMC123",
        format: "xml",
      }),
    );

    expect(result.successful).toBe(1);
    expect(result.articles[0].fulltext).toMatchObject({
      format: "xml",
      content: "<body><sec><title>Methods</title><p>XML body</p></sec></body>",
      resource_uri: "article://fulltext/PMC123?format=xml",
      truncated: false,
    });
    expect(result.meta.truncation.truncated_articles).toBe(0);
    expect(result.articles[0].fulltext).not.toHaveProperty("fulltext_markdown");
    expect(result.articles[0].fulltext).not.toHaveProperty("fulltext_text");
  });

  it("returns a friendly error for invalid stringified PMCID arrays", async () => {
    const handlers = createToolHandlers(createMockServices());
    const result = parseTextResult(
      await handlers.get_article_details!({
        pmcid: "[PMC123, PMC456]",
      }),
    );

    expect(result.total).toBe(1);
    expect(result.successful).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.articles).toEqual([]);
    expect(result.error).toContain("pmcid 参数格式错误");
    expect(result.error).toContain('["value"]');
  });

  it("returns an empty batch result for empty PMCID arrays", async () => {
    const handlers = createToolHandlers(createMockServices());
    const result = parseTextResult(
      await handlers.get_article_details!({
        pmcid: [],
      }),
    );

    expect(result.total).toBe(0);
    expect(result.successful).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.articles).toEqual([]);
    expect(result.fulltext_stats).toBeNull();
  });

  it("returns a friendly error object for invalid fulltext formats", async () => {
    const handlers = createToolHandlers(createMockServices());
    const result = parseTextResult(
      await handlers.get_article_details!({
        pmcid: "PMC123",
        format: "invalid",
      }),
    );

    expect(result.total).toBe(1);
    expect(result.successful).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.articles).toEqual([]);
    expect(result.error).toContain("无效的 format 参数");
  });

  it("counts invalid PMCIDs as failed and warns", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const handlers = createToolHandlers(createMockServices());

    try {
      const result = parseTextResult(
        await handlers.get_article_details!({
          pmcid: ["invalid", "123"],
        }),
      );

      expect(result.total).toBe(2);
      expect(result.successful).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.articles[0].pmcid).toBe("PMC123");
      expect(warnSpy).toHaveBeenCalledWith("非 PMCID 格式: invalid");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("rejects batches larger than 20 PMCIDs before fetching", async () => {
    let detailCalls = 0;
    const services = createMockServices();
    services.europePmc.getArticleDetailsAsync = async () => {
      detailCalls += 1;
      return { article: null };
    };

    const handlers = createToolHandlers(services);
    const result = parseTextResult(
      await handlers.get_article_details!({
        pmcid: Array.from({ length: 21 }, (_value, index) => `PMC${index + 1}`),
      }),
    );

    expect(result.total).toBe(21);
    expect(result.successful).toBe(0);
    expect(result.failed).toBe(21);
    expect(result.articles).toEqual([]);
    expect(result.error).toContain("最多支持20个");
    expect(detailCalls).toBe(0);
  });

  it("reports articles that have metadata but no available fulltext", async () => {
    const services = createMockServices();
    services.pubmed.getPMCFulltextHtmlAsync = async () => ({
      pmc_id: "PMC123",
      fulltext_available: false,
      error: "No fulltext available",
    });

    const handlers = createToolHandlers(services);
    const result = parseTextResult(
      await handlers.get_article_details!({
        pmcid: "PMC123",
      }),
    );

    expect(result.successful).toBe(1);
    expect(result.fulltext_stats).toEqual({
      has_pmcid: 1,
      fulltext_fetched: 0,
      no_fulltext: 1,
    });
    expect(result.articles[0]).not.toHaveProperty("fulltext");
  });

  it("deduplicates references and strips metadata when requested", async () => {
    const handlers = createToolHandlers(createMockServices());
    const result = parseTextResult(
      await handlers.get_references!({
        identifier: "10.1000/source",
        id_type: "doi",
        sources: ["crossref", "europe_pmc"],
        include_metadata: false,
      }),
    );

    expect(result.success).toBe(true);
    expect(result.merged_references).toHaveLength(2);
    expect(result.merged_references[0].doi).toBe("10.1000/ref-a");
    expect(result.merged_references[0].source).toBe("europe_pmc");
    expect(result.merged_references[0]).not.toHaveProperty("abstract");
    expect(result.references_by_source.europe_pmc[0]).not.toHaveProperty("abstract");
  });

  it("returns a friendly error when the reference identifier is empty", async () => {
    const handlers = createToolHandlers(createMockServices());
    const result = parseTextResult(
      await handlers.get_references!({
        identifier: "   ",
        id_type: "doi",
      }),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("文献标识符不能为空");
    expect(result.total_count).toBe(0);
    expect(result.sources_used).toEqual([]);
    expect(result.merged_references).toEqual([]);
  });

  it("limits merged references to max_results", async () => {
    const handlers = createToolHandlers(createMockServices());
    const result = parseTextResult(
      await handlers.get_references!({
        identifier: "10.1000/source",
        id_type: "doi",
        sources: ["crossref"],
        max_results: 1,
      }),
    );

    expect(result.success).toBe(true);
    expect(result.total_count).toBe(1);
    expect(result.merged_references).toHaveLength(1);
    expect(result.references_by_source.crossref).toHaveLength(2);
  });

  it("delegates reference orchestration to the unified reference service", async () => {
    const services = createMockServices();
    const referenceResult = {
      success: true,
      identifier: "10.1000/source",
      id_type: "doi",
      resolved_identifier: { doi: "10.1000/source" },
      sources_used: ["crossref"],
      references_by_source: {
        crossref: [{ title: "Delegated Ref", doi: "10.1000/ref-a", source: "crossref" }],
      },
      merged_references: [{ title: "Delegated Ref", doi: "10.1000/ref-a", source: "crossref" }],
      total_count: 1,
      processing_time: 0.01,
    };
    const referenceSpy = vi
      .spyOn(services.referenceService, "getReferencesAsync")
      .mockResolvedValue(referenceResult);

    const handlers = createToolHandlers(services);
    const result = parseTextResult(
      await handlers.get_references!({
        identifier: "10.1000/source",
        id_type: "doi",
        sources: ["crossref"],
        max_results: 3,
        include_metadata: false,
      }),
    );

    expect(referenceSpy).toHaveBeenCalledWith({
      identifier: "10.1000/source",
      idType: "doi",
      sources: ["crossref"],
      maxResults: 3,
      includeMetadata: false,
    });
    expect(result).toMatchObject(referenceResult);
  });

  it("enriches CrossRef references with Europe PMC metadata", async () => {
    const services = createMockServices();
    let requestedDois: string[] = [];

    services.europePmc.getReferencesAsync = async () => ({
      references: [],
      total_count: 0,
      source: "europe_pmc",
    });
    services.crossref.getReferencesAsync = async () => ({
      references: [
        { title: "CrossRef A", doi: "10.1000/ref-a", authors: ["Alice"] },
        { title: "CrossRef B", doi: "10.1000/ref-b", authors: ["Bob"] },
      ],
    });
    services.europePmc.searchBatchDoiAsync = async (dois: string[]) => {
      requestedDois = dois;
      return dois.map((doi) => ({
        title: `Europe PMC ${doi}`,
        doi,
        authorString: "Enriched Author",
        journalInfo: { journal: { title: "Europe PMC Journal" } },
        firstPublicationDate: "2026-02-01",
        abstractText: `Abstract for ${doi}`,
        pmid: "12345",
        pmcid: "PMC12345",
      }));
    };

    const handlers = createToolHandlers(services);
    const result = parseTextResult(
      await handlers.get_references!({
        identifier: "10.1000/source",
        id_type: "doi",
        sources: ["crossref", "europe_pmc"],
        include_metadata: true,
      }),
    );

    expect(requestedDois).toEqual(["10.1000/ref-a", "10.1000/ref-b"]);
    expect(result.merged_references).toHaveLength(2);
    expect(result.merged_references[0]).toMatchObject({
      source: "europe_pmc",
      doi: "10.1000/ref-a",
      abstract: "Abstract for 10.1000/ref-a",
      journal: "Europe PMC Journal",
      pmcid: "PMC12345",
    });
    expect(result.references_by_source.crossref).toHaveLength(2);
    expect(result.references_by_source.europe_pmc).toHaveLength(2);
  });

  it("uses the Europe PMC references endpoint when selected as the only reference source", async () => {
    const services = createMockServices();
    const calls: any[] = [];

    services.europePmc.getReferencesAsync = async (...args: any[]) => {
      calls.push(args);
      return {
        references: [
          {
            title: "Europe Direct Ref",
            doi: "10.1000/europe-direct",
            authors: ["Direct Author"],
            journal: "Direct Journal",
            abstract: "Direct abstract",
          },
        ],
        total_count: 1,
        source: "europe_pmc",
      };
    };

    const handlers = createToolHandlers(services);
    const result = parseTextResult(
      await handlers.get_references!({
        identifier: "PMID:12345",
        id_type: "auto",
        sources: ["europe_pmc"],
      }),
    );

    expect(calls[0]).toEqual(["12345", "pmid", 20]);
    expect(result.sources_used).toEqual(["europe_pmc"]);
    expect(result.merged_references).toHaveLength(1);
    expect(result.merged_references[0]).toMatchObject({
      source: "europe_pmc",
      doi: "10.1000/europe-direct",
      abstract: "Direct abstract",
    });
  });

  it("resolves DOI input before calling Europe PMC references", async () => {
    const services = createMockServices();
    const calls: any[] = [];

    services.pubmed.findPmidByDoiAsync = async () => "67890";
    services.europePmc.getReferencesAsync = async (...args: any[]) => {
      calls.push(args);
      return {
        references: [],
        total_count: 0,
        source: "europe_pmc",
      };
    };

    const handlers = createToolHandlers(services);
    await handlers.get_references!({
      identifier: "10.1000/source",
      id_type: "doi",
      sources: ["europe_pmc"],
      max_results: 5,
    });

    expect(calls[0]).toEqual(["67890", "pmid", 5]);
  });

  it("respects selected literature relation types", async () => {
    const handlers = createToolHandlers(createMockServices());
    const result = parseTextResult(
      await handlers.get_literature_relations!({
        identifiers: "10.1000/source",
        relation_types: ["references", "similar"],
      }),
    );

    expect(result.relations[0]).toHaveProperty("references");
    expect(result.relations[0].similar).toHaveLength(1);
    expect(result.relations[0]).not.toHaveProperty("citing");
  });

  it("reuses the unified reference service for relation reference analysis", async () => {
    const services = createMockServices();
    const referenceSpy = vi
      .spyOn(services.referenceService, "getReferencesAsync")
      .mockResolvedValue({
        success: true,
        identifier: "10.1000/source",
        id_type: "doi",
        resolved_identifier: { doi: "10.1000/source" },
        sources_used: ["crossref"],
        references_by_source: {
          crossref: [{ title: "Relation Ref", doi: "10.1000/ref-a", source: "crossref" }],
        },
        merged_references: [{ title: "Relation Ref", doi: "10.1000/ref-a", source: "crossref" }],
        total_count: 1,
        processing_time: 0.02,
      });

    const handlers = createToolHandlers(services);
    const result = parseTextResult(
      await handlers.get_literature_relations!({
        identifiers: "10.1000/source",
        relation_types: ["references"],
        sources: ["crossref", "openalex"],
        max_results: 4,
      }),
    );

    expect(referenceSpy).toHaveBeenCalledWith({
      identifier: "10.1000/source",
      idType: "doi",
      sources: ["crossref"],
      maxResults: 4,
      includeMetadata: false,
    });
    expect(result.relations[0].references).toEqual([
      { title: "Relation Ref", doi: "10.1000/ref-a", source: "crossref" },
    ]);
  });

  it("builds network data for network relation analysis", async () => {
    const handlers = createToolHandlers(createMockServices());
    const result = parseTextResult(
      await handlers.get_literature_relations!({
        identifiers: "10.1000/source",
        relation_types: ["references", "similar"],
        analysis_type: "network",
      }),
    );

    expect(result.network_data.nodes.length).toBeGreaterThan(1);
    expect(result.network_data.edges.length).toBeGreaterThan(0);
    expect(result.network_data.edges[0]).toMatchObject({
      source: "10.1000/source",
    });
    expect(result.network_data.metrics).toBeDefined();
    expect(result.network_data.metrics.centrality).toBeTypeOf("object");
    expect(result.network_data.metrics.density).toBeTypeOf("number");
    expect(result.network_data.metrics.citationStrength).toBeTypeOf("object");
    expect(typeof result.network_data.clusters).toBe("object");
  });

  it("expands relation networks when max_depth is greater than one", async () => {
    const services = createMockServices();
    vi.spyOn(services.referenceService, "getReferencesAsync").mockImplementation(
      async (options) => {
        if (options.identifier === "10.1000/source") {
          return {
            success: true,
            identifier: "10.1000/source",
            id_type: "doi",
            resolved_identifier: { doi: "10.1000/source" },
            sources_used: ["crossref"],
            references_by_source: {
              crossref: [{ title: "Level 1", doi: "10.1000/level-1", source: "crossref" }],
            },
            merged_references: [{ title: "Level 1", doi: "10.1000/level-1", source: "crossref" }],
            total_count: 1,
            processing_time: 0.01,
          };
        }

        if (options.identifier === "10.1000/level-1") {
          return {
            success: true,
            identifier: "10.1000/level-1",
            id_type: "doi",
            resolved_identifier: { doi: "10.1000/level-1" },
            sources_used: ["crossref"],
            references_by_source: {
              crossref: [{ title: "Level 2", doi: "10.1000/level-2", source: "crossref" }],
            },
            merged_references: [{ title: "Level 2", doi: "10.1000/level-2", source: "crossref" }],
            total_count: 1,
            processing_time: 0.01,
          };
        }

        return {
          success: true,
          identifier: String(options.identifier),
          id_type: options.idType ?? "doi",
          resolved_identifier: {},
          sources_used: [],
          references_by_source: {},
          merged_references: [],
          total_count: 0,
          processing_time: 0.01,
        };
      },
    );

    const handlers = createToolHandlers(services);
    const result = parseTextResult(
      await handlers.get_literature_relations!({
        identifiers: "10.1000/source",
        relation_types: ["references"],
        analysis_type: "network",
        max_depth: 2,
        sources: ["crossref"],
      }),
    );

    expect(result.network_data.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "10.1000/source" }),
        expect.objectContaining({ id: "10.1000/level-1" }),
        expect.objectContaining({ id: "10.1000/level-2" }),
      ]),
    );
    expect(result.network_data.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "10.1000/source", target: "10.1000/level-1" }),
        expect.objectContaining({ source: "10.1000/level-1", target: "10.1000/level-2" }),
      ]),
    );
  });

  it("expands citing and similar relation branches when max_depth is greater than one", async () => {
    const services = createMockServices();

    services.openalex.getCitationsAsync = async (doi: string) => {
      if (doi === "10.1000/source") {
        return {
          success: true,
          citations: [{ title: "Citing Level 1", doi: "10.1000/citing-1" }],
          total_count: 1,
          source: "openalex",
        };
      }

      if (doi === "10.1000/citing-1") {
        return {
          success: true,
          citations: [{ title: "Citing Level 2", doi: "10.1000/citing-2" }],
          total_count: 1,
          source: "openalex",
        };
      }

      return { success: true, citations: [], total_count: 0, source: "openalex" };
    };

    services.pubmed.findPmidByDoiAsync = async (doi: string) => {
      if (doi === "10.1000/source") {
        return "12345";
      }
      if (doi === "10.1000/similar-1") {
        return "20001";
      }
      return "12345";
    };

    services.pubmed.getSimilarArticlesAsync = async (pmid: string) => {
      if (pmid === "12345") {
        return {
          similar_articles: [
            {
              pmid: "20001",
              title: "Similar Level 1",
              doi: "10.1000/similar-1",
              authors: ["Author A"],
              journal_name: "Similar Journal",
              publication_date: "2026-01-01",
              abstract: "Level 1 similar article",
            },
          ],
        };
      }

      if (pmid === "20001") {
        return {
          similar_articles: [
            {
              pmid: "20002",
              title: "Similar Level 2",
              doi: "10.1000/similar-2",
              authors: ["Author B"],
              journal_name: "Similar Journal",
              publication_date: "2026-01-02",
              abstract: "Level 2 similar article",
            },
          ],
        };
      }

      return { similar_articles: [] };
    };

    const handlers = createToolHandlers(services);
    const result = parseTextResult(
      await handlers.get_literature_relations!({
        identifiers: "10.1000/source",
        relation_types: ["citing", "similar"],
        analysis_type: "network",
        max_depth: 2,
        sources: ["openalex", "pubmed"],
      }),
    );

    expect(result.network_data.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "10.1000/citing-1" }),
        expect.objectContaining({ id: "10.1000/citing-2" }),
        expect.objectContaining({ id: "10.1000/similar-1" }),
        expect.objectContaining({ id: "10.1000/similar-2" }),
      ]),
    );
    expect(result.network_data.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "10.1000/source", target: "10.1000/citing-1" }),
        expect.objectContaining({ source: "10.1000/citing-1", target: "10.1000/citing-2" }),
        expect.objectContaining({ source: "10.1000/source", target: "10.1000/similar-1" }),
        expect.objectContaining({ source: "10.1000/similar-1", target: "10.1000/similar-2" }),
      ]),
    );
  });

  it("filters journal metrics and sorts batch results", async () => {
    const handlers = createToolHandlers(createMockServices());
    const result = parseTextResult(
      await handlers.get_journal_quality!({
        journal_name: ["Science", "Nature"],
        include_metrics: ["impact_factor"],
        sort_by: "impact_factor",
        sort_order: "desc",
      }),
    );

    expect(
      result.journal_results.map((item: Record<string, unknown>) => item.journal_name),
    ).toEqual(["Nature", "Science"]);
    expect(result.journal_results[0].quality_metrics).toEqual({ impact_factor: 64 });
    expect(result.sort_info).toEqual({ field: "impact_factor", order: "desc" });
  });
});

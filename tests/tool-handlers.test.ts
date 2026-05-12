import { describe, expect, it, vi } from "vitest";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { ArticleMcpServices } from "../src/services/container.js";
import { createToolHandlers } from "../src/tools/handlers.js";

function parseTextResult(result: CallToolResult): Record<string, any> {
  const textContent = result.content.find((item) => item.type === "text");
  if (!textContent || textContent.type !== "text") {
    throw new Error("工具结果缺少文本内容");
  }

  return JSON.parse(textContent.text) as Record<string, any>;
}

function createMockServices(): ArticleMcpServices {
  return {
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
}

describe("tool handlers", () => {
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
    });
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

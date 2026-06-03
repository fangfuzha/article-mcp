/**
 * 验证外部学术 API 的关键请求参数和字段映射，避免实现偏离真实接口契约。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { CrossRefService } from "../src/services/crossref_service.js";
import { EasyScholarService } from "../src/services/easyscholar_service.js";
import { EuropePMCService } from "../src/services/europe_pmc.js";
import { OpenAlexService } from "../src/services/openalex_service.js";
import { OpenAlexMetricsService } from "../src/services/openalex_metrics_service.js";
import { PubMedService } from "../src/services/pubmed_search.js";
import { ArxivSearchService } from "../src/services/arxiv_search.js";
import { defaultApiClient } from "../src/utils/api_utils.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("external API contract alignment", () => {
  it("does not silently add a Europe PMC FIRST_PDATE filter without date arguments", async () => {
    const getSpy = vi.spyOn(defaultApiClient, "get").mockResolvedValue({
      resultList: { result: [] },
      hitCount: 0,
    });
    const europePmc = new EuropePMCService({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      log: vi.fn(),
    } as unknown as Console);

    await europePmc.searchAsync("cancer immunotherapy", undefined, undefined, undefined, 5, false);

    expect(getSpy).toHaveBeenCalledTimes(1);
    const firstCall = getSpy.mock.calls[0]!;
    expect(firstCall[1]).toMatchObject({
      query: "cancer immunotherapy",
      pageSize: 5,
      format: "json",
      resultType: "core",
    });
    expect(String(firstCall[1].query)).not.toContain("FIRST_PDATE");
  });

  it("adds a Europe PMC FIRST_PDATE filter only when a date range is requested", async () => {
    const getSpy = vi.spyOn(defaultApiClient, "get").mockResolvedValue({
      resultList: { result: [] },
      hitCount: 0,
    });
    const europePmc = new EuropePMCService({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      log: vi.fn(),
    } as unknown as Console);

    await europePmc.searchAsync("cancer", undefined, "2024-01-01", "2024-12-31", 5, false);

    const firstCall = getSpy.mock.calls[0]!;
    expect(String(firstCall[1].query)).toBe(
      "(cancer) AND (FIRST_PDATE:[2024-01-01 TO 2024-12-31])",
    );
  });

  it("uses a configurable Europe PMC rate-limit delay outside tests", () => {
    vi.stubEnv("NODE_ENV", "production");
    const europePmc = new EuropePMCService({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      log: vi.fn(),
    } as unknown as Console);

    expect((europePmc as any).resolveRateLimitDelayMs()).toBe(1000);

    vi.stubEnv("EUROPE_PMC_RATE_LIMIT_MS", "250");
    expect((europePmc as any).resolveRateLimitDelayMs()).toBe(250);
  });

  it("uses publication date fields before Crossref record creation dates", async () => {
    vi.spyOn(defaultApiClient, "getJson").mockResolvedValue({
      message: {
        "total-results": 1,
        items: [
          {
            title: ["A published work"],
            author: [{ given: "Ada", family: "Lovelace" }],
            DOI: "10.5555/published-date",
            created: { "date-time": "2026-06-01T00:00:00Z" },
            issued: { "date-parts": [[2024, 3, 2]] },
            "short-container-title": ["Journal"],
          },
        ],
      },
    });
    const crossref = new CrossRefService();

    const result = await crossref.searchWorksAsync("published work", 1, false);

    expect(result.articles[0].publication_date).toBe("2024-03-02");
  });

  it("searches PubMed DOI by article identifier field instead of a broad keyword term", async () => {
    const getTextSpy = vi.spyOn(defaultApiClient, "getText").mockResolvedValue(`
      <eSearchResult><IdList><Id>123456</Id></IdList></eSearchResult>
    `);
    const pubmed = new PubMedService({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      log: vi.fn(),
    } as unknown as Console);

    await pubmed.findPmidByDoiAsync("10.5555/example.doi");

    const firstCall = getTextSpy.mock.calls[0]!;
    expect(firstCall[1]).toMatchObject({
      tool: "article-mcp",
      db: "pubmed",
      term: '"10.5555/example.doi"[AID]',
      retmax: "1",
      retmode: "xml",
    });
  });

  it("normalizes DOI URLs before querying PubMed article identifiers", async () => {
    const getTextSpy = vi.spyOn(defaultApiClient, "getText").mockResolvedValue(`
      <eSearchResult><IdList><Id>123456</Id></IdList></eSearchResult>
    `);
    const pubmed = new PubMedService({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      log: vi.fn(),
    } as unknown as Console);

    await pubmed.findPmidByDoiAsync("https://doi.org/10.5555/example.doi");

    expect(getTextSpy.mock.calls[0]![1]).toMatchObject({
      term: '"10.5555/example.doi"[AID]',
    });
  });

  it("requests Semantic Scholar citation fields from the citingPaper object", async () => {
    vi.stubEnv("SEMANTIC_SCHOLAR_API_KEY", "semantic-test-key");
    const getJsonSpy = vi.spyOn(defaultApiClient, "getJson").mockResolvedValue({
      data: [
        {
          citingPaper: {
            paperId: "ss-paper-1",
            title: "Semantic Scholar citing paper",
            year: 2024,
            authors: [{ name: "Ada Lovelace" }],
            venue: "Example Venue",
            publicationDate: "2024-02-03",
            externalIds: {
              DOI: "10.5555/semantic-citing",
            },
          },
        },
      ],
    });
    const pubmed = new PubMedService({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      log: vi.fn(),
    } as unknown as Console);

    const result = await pubmed.getCitingArticlesAsync("123456", undefined, 5);

    const firstCall = getJsonSpy.mock.calls[0]!;
    expect(firstCall[0]).toBe("https://api.semanticscholar.org/graph/v1/paper/PMID:123456/citations");
    expect(firstCall[1]).toMatchObject({
      fields:
        "citingPaper.paperId,citingPaper.title,citingPaper.year,citingPaper.authors,citingPaper.venue,citingPaper.externalIds,citingPaper.publicationDate",
      limit: 5,
    });
    expect(firstCall[2]).toMatchObject({
      "x-api-key": "semantic-test-key",
    });
    expect(result.citing_articles[0]).toMatchObject({
      pmid: null,
      title: "Semantic Scholar citing paper",
      authors: ["Ada Lovelace"],
      journal_name: "Example Venue",
      publication_date: "2024-02-03",
      doi: "10.5555/semantic-citing",
      semantic_scholar_id: "ss-paper-1",
    });
  });

  it("fetches PubMed article details by PMID with NCBI EFetch parameters", async () => {
    const getTextSpy = vi.spyOn(defaultApiClient, "getText").mockResolvedValue(`
      <PubmedArticleSet>
        <PubmedArticle>
          <MedlineCitation>
            <PMID>123456</PMID>
            <Article>
              <ArticleTitle>NCBI article</ArticleTitle>
              <Journal>
                <Title>Example Journal</Title>
                <JournalIssue><PubDate><Year>2024</Year></PubDate></JournalIssue>
              </Journal>
            </Article>
          </MedlineCitation>
        </PubmedArticle>
      </PubmedArticleSet>
    `);
    const pubmed = new PubMedService({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      log: vi.fn(),
    } as unknown as Console);

    const result = await pubmed.getArticleDetailsAsync("123456", "pmid");

    expect(result.article?.pmid).toBe("123456");
    expect(getTextSpy).toHaveBeenCalledTimes(1);
    const firstCall = getTextSpy.mock.calls[0]!;
    expect(firstCall[0]).toContain("/efetch.fcgi");
    expect(firstCall[1]).toMatchObject({
      tool: "article-mcp",
      db: "pubmed",
      id: "123456",
      retmode: "xml",
      rettype: "xml",
    });
  });

  it("resolves PMCID through PubMed ESearch before fetching article details", async () => {
    const getTextSpy = vi
      .spyOn(defaultApiClient, "getText")
      .mockResolvedValueOnce(`<eSearchResult><IdList><Id>123456</Id></IdList></eSearchResult>`)
      .mockResolvedValueOnce(`
        <PubmedArticleSet>
          <PubmedArticle>
            <MedlineCitation>
              <PMID>123456</PMID>
              <Article>
                <ArticleTitle>PMCID article</ArticleTitle>
                <Journal>
                  <Title>Example Journal</Title>
                  <JournalIssue><PubDate><Year>2024</Year></PubDate></JournalIssue>
                </Journal>
              </Article>
            </MedlineCitation>
          </PubmedArticle>
        </PubmedArticleSet>
      `);
    const pubmed = new PubMedService({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      log: vi.fn(),
    } as unknown as Console);

    const result = await pubmed.getArticleDetailsAsync("PMC1234567", "pmcid");

    expect(result.article?.pmid).toBe("123456");
    const firstCall = getTextSpy.mock.calls[0]!;
    const secondCall = getTextSpy.mock.calls[1]!;
    expect(firstCall[0]).toContain("/esearch.fcgi");
    expect(firstCall[1]).toMatchObject({
      tool: "article-mcp",
      db: "pubmed",
      term: "PMC1234567[PMCID]",
      retmax: "1",
      retmode: "xml",
    });
    expect(secondCall[0]).toContain("/efetch.fcgi");
    expect(secondCall[1]).toMatchObject({
      tool: "article-mcp",
      db: "pubmed",
      id: "123456",
      retmode: "xml",
      rettype: "xml",
    });
  });

  it("fetches PubMed references with the pubmed_pubmed_refs ELink relation", async () => {
    const getTextSpy = vi
      .spyOn(defaultApiClient, "getText")
      .mockResolvedValueOnce(`
        <eLinkResult>
          <LinkSet>
            <LinkSetDb>
              <Link><Id>234567</Id></Link>
            </LinkSetDb>
          </LinkSet>
        </eLinkResult>
      `)
      .mockResolvedValueOnce(`
        <PubmedArticleSet>
          <PubmedArticle>
            <MedlineCitation>
              <PMID>234567</PMID>
              <Article>
                <ArticleTitle>Referenced PubMed article</ArticleTitle>
                <Journal>
                  <Title>Reference Journal</Title>
                  <JournalIssue><PubDate><Year>2023</Year></PubDate></JournalIssue>
                </Journal>
              </Article>
            </MedlineCitation>
          </PubmedArticle>
        </PubmedArticleSet>
      `);
    const pubmed = new PubMedService({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      log: vi.fn(),
    } as unknown as Console);

    const result = await pubmed.getReferencedArticlesAsync("123456", undefined, 5);

    const elinkCall = getTextSpy.mock.calls[0]!;
    const efetchCall = getTextSpy.mock.calls[1]!;
    expect(elinkCall[0]).toContain("/elink.fcgi");
    expect(elinkCall[1]).toMatchObject({
      tool: "article-mcp",
      dbfrom: "pubmed",
      db: "pubmed",
      id: "123456",
      linkname: "pubmed_pubmed_refs",
      retmode: "xml",
    });
    expect(efetchCall[0]).toContain("/efetch.fcgi");
    expect(efetchCall[1]).toMatchObject({
      tool: "article-mcp",
      db: "pubmed",
      id: "234567",
      retmode: "xml",
      rettype: "xml",
    });
    expect(result.referenced_articles[0]?.title).toBe("Referenced PubMed article");
  });

  it("selects and maps OpenAlex DOI from the Work top-level field", async () => {
    const getSpy = vi.spyOn(defaultApiClient, "get").mockResolvedValue({
      meta: { count: 1 },
      results: [
        {
          id: "https://openalex.org/W123",
          doi: "https://doi.org/10.5555/openalex",
          title: "OpenAlex article",
          publication_date: "2024-03-02",
          authorships: [{ author: { display_name: "Ada Lovelace" } }],
          primary_location: { source: { display_name: "Journal" } },
          open_access: { is_oa: true, oa_url: "https://example.org/article" },
        },
      ],
    });
    const openalex = new OpenAlexService();

    const result = await openalex.searchWorksAsync("openalex article", 1);

    const firstCall = getSpy.mock.calls[0]!;
    expect(String(firstCall[1].select)).toContain("doi");
    expect(String(firstCall[1].select)).toContain("publication_date");
    expect(result.articles[0]?.doi).toBe("https://doi.org/10.5555/openalex");
    expect(result.articles[0]?.publication_date).toBe("2024-03-02");
  });

  it("fetches OpenAlex work details through the DOI entity endpoint", async () => {
    const getSpy = vi.spyOn(defaultApiClient, "get").mockResolvedValue({
      id: "https://openalex.org/W123",
      doi: "https://doi.org/10.5555/openalex-detail",
      title: "OpenAlex detail article",
      publication_date: "2024-03-02",
      authorships: [{ author: { display_name: "Ada Lovelace" } }],
      primary_location: { source: { display_name: "Journal" } },
      open_access: { is_oa: true },
    });
    const openalex = new OpenAlexService();

    const result = await openalex.getWorkByDoiAsync("10.5555/openalex-detail");

    const firstCall = getSpy.mock.calls[0]!;
    expect(firstCall[0]).toBe(
      "https://api.openalex.org/works/https://doi.org/10.5555/openalex-detail",
    );
    expect(String(firstCall[1].select)).toContain("doi");
    expect(result.article).toMatchObject({
      doi: "https://doi.org/10.5555/openalex-detail",
      title: "OpenAlex detail article",
      publication_date: "2024-03-02",
    });
  });

  it("normalizes DOI URLs before querying Crossref work details", async () => {
    const getJsonSpy = vi.spyOn(defaultApiClient, "getJson").mockResolvedValue({
      message: {
        title: ["Crossref detail"],
        DOI: "10.5555/crossref-detail",
      },
    });
    const crossref = new CrossRefService();

    await crossref.getWorkByDoiAsync("https://doi.org/10.5555/crossref-detail");

    expect(getJsonSpy.mock.calls[0]![0]).toBe(
      "https://api.crossref.org/v1/works/10.5555/crossref-detail",
    );
  });

  it("normalizes DOI URLs before querying Europe PMC details", async () => {
    const getSpy = vi.spyOn(defaultApiClient, "get").mockResolvedValue({
      resultList: {
        result: [
          {
            title: "Europe PMC detail",
            doi: "10.5555/europe-detail",
          },
        ],
      },
    });
    const europePmc = new EuropePMCService({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      log: vi.fn(),
    } as unknown as Console);

    await europePmc.getArticleDetailsAsync("https://doi.org/10.5555/europe-detail", "doi");

    expect(getSpy.mock.calls[0]![1]).toMatchObject({
      query: 'DOI:"10.5555/europe-detail"',
    });
  });

  it("reports OpenAlex citation total from meta.count rather than current page length", async () => {
    const getSpy = vi
      .spyOn(defaultApiClient, "get")
      .mockResolvedValueOnce({
        id: "https://openalex.org/W123",
      })
      .mockResolvedValueOnce({
        meta: { count: 42 },
        results: [
          {
            id: "https://openalex.org/W456",
            doi: "https://doi.org/10.5555/citing",
            title: "Citing article",
            publication_year: 2024,
            authorships: [],
            primary_location: {},
          },
        ],
      });
    const openalex = new OpenAlexService();

    const result = await openalex.getCitationsAsync("10.5555/source", 1);

    expect(result.total_count).toBe(42);
    const citationCall = getSpy.mock.calls[1]!;
    expect(citationCall[1]).toMatchObject({
      filter: "cites:W123",
      per_page: 1,
    });
    expect(String(citationCall[1].select)).toContain("doi");
  });

  it("queries OpenAlex Sources with official pagination and chooses exact journal matches", async () => {
    const getJsonSpy = vi.spyOn(defaultApiClient, "getJson").mockResolvedValue({
      results: [
        {
          display_name: "Nature Reviews Genetics",
          summary_stats: {
            h_index: 400,
            "2yr_mean_citedness": 10,
            i10_index: 390,
          },
          cited_by_count: 1000,
          works_count: 200,
        },
        {
          display_name: "Nature",
          alternate_titles: ["Nature Journal"],
          summary_stats: {
            h_index: 1200,
            "2yr_mean_citedness": 45,
            i10_index: 1100,
          },
          cited_by_count: 500000,
          works_count: 10000,
        },
      ],
    });
    const openalexMetrics = new OpenAlexMetricsService();

    const result = await openalexMetrics.getJournalMetrics("Nature", false);

    const firstCall = getJsonSpy.mock.calls[0]!;
    expect(firstCall[0]).toBe("https://api.openalex.org/sources");
    expect(firstCall[1]).toMatchObject({
      search: "Nature",
      filter: "type:journal",
      per_page: 5,
    });
    expect(String(firstCall[1].select)).toContain("summary_stats");
    expect(result).toMatchObject({
      h_index: 1200,
      citation_rate: 45,
      cited_by_count: 500000,
      works_count: 10000,
      i10_index: 1100,
      source: "openalex",
    });
  });

  it("parses EasyScholar selected rankings and five-year impact factor", () => {
    const easyScholar = new EasyScholarService(30, {
      error: vi.fn(),
      warn: vi.fn(),
    });

    const result = (easyScholar as any).parseApiResponse("Nature", {
      code: 200,
      msg: "ok",
      data: {
        officialRank: {
          all: {
            sciif: "60.0",
            sci: "Q2",
          },
          select: {
            sciif: "64.8",
            sciif5: "72.1",
            sci: "Q1",
            jci: "5.2",
            sciUp: "1区",
          },
        },
      },
    });

    expect(result.success).toBe(true);
    expect(result.quality_metrics).toMatchObject({
      impact_factor: 64.8,
      five_year_impact_factor: 72.1,
      quartile: "Q1",
      jci: "5.2",
      cas_zone: "中科院一区",
    });
  });

  it("maps standard arXiv Atom entry fields produced by fast-xml-parser", () => {
    const arxiv = new ArxivSearchService({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    });

    const article = (arxiv as any).processArxivEntry({
      id: "http://arxiv.org/abs/2401.12345v1",
      title: "A Useful Preprint",
      summary: "This paper studies useful things.",
      published: "2024-01-15T12:30:00Z",
      author: [{ name: "Ada Lovelace" }, { name: "Grace Hopper" }],
      link: [
        {
          "@_rel": "alternate",
          "@_type": "text/html",
          "@_href": "http://arxiv.org/abs/2401.12345v1",
        },
        {
          "@_title": "pdf",
          "@_href": "http://arxiv.org/pdf/2401.12345v1",
        },
      ],
      "arxiv:primary_category": { "@_term": "cs.AI" },
    });

    expect(article).toMatchObject({
      arxiv_id: "2401.12345v1",
      title: "A Useful Preprint",
      authors: ["Ada Lovelace", "Grace Hopper"],
      category: "cs.AI",
      publication_date: "2024-01-15",
      abstract: "This paper studies useful things.",
      arxiv_link: "http://arxiv.org/abs/2401.12345v1",
      pdf_link: "http://arxiv.org/pdf/2401.12345v1",
    });
  });

  it("uses a conservative arXiv API rate-limit delay outside tests", () => {
    vi.stubEnv("NODE_ENV", "production");
    const arxiv = new ArxivSearchService({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    });

    expect((arxiv as any).resolveRateLimitDelayMs()).toBe(3000);

    vi.stubEnv("ARXIV_RATE_LIMIT_MS", "1250");
    expect((arxiv as any).resolveRateLimitDelayMs()).toBe(1250);
  });

  it("passes configured scholarly API identity parameters without hard-coded fake contacts", async () => {
    vi.stubEnv("OPENALEX_API_KEY", "openalex-test-key");
    vi.stubEnv("NCBI_EMAIL", "maintainer@example.org");
    vi.stubEnv("NCBI_API_KEY", "ncbi-test-key");
    vi.stubEnv("CROSSREF_MAILTO", "crossref@example.org");

    const openAlexGetSpy = vi.spyOn(defaultApiClient, "get").mockResolvedValue({
      meta: { count: 0 },
      results: [],
    });
    const openalex = new OpenAlexService();
    await openalex.searchWorksAsync("identity", 1);
    expect(openAlexGetSpy.mock.calls[0]![1]).toMatchObject({
      api_key: "openalex-test-key",
      per_page: 1,
    });
    expect(openAlexGetSpy.mock.calls[0]![2]).toMatchObject({
      "User-Agent": "Article-MCP/2.0",
    });
    expect(JSON.stringify(openAlexGetSpy.mock.calls[0]![2])).not.toContain("user@example.com");

    const getTextSpy = vi
      .spyOn(defaultApiClient, "getText")
      .mockResolvedValue(`<eSearchResult><IdList /></eSearchResult>`);
    const pubmed = new PubMedService({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      log: vi.fn(),
    } as unknown as Console);
    await pubmed.findPmidByDoiAsync("10.5555/identity");
    expect(getTextSpy.mock.calls[0]![1]).toMatchObject({
      tool: "article-mcp",
      email: "maintainer@example.org",
      api_key: "ncbi-test-key",
    });

    const crossrefGetSpy = vi.spyOn(defaultApiClient, "getJson").mockResolvedValue({
      message: {
        "total-results": 0,
        items: [],
      },
    });
    const crossref = new CrossRefService();
    await crossref.searchWorksAsync("identity", 1, false);
    expect(crossrefGetSpy.mock.calls[0]![0]).toBe("https://api.crossref.org/v1/works");
    expect(crossrefGetSpy.mock.calls[0]![1]).toMatchObject({
      mailto: "crossref@example.org",
    });
    expect(crossrefGetSpy.mock.calls[0]![2]).toMatchObject({
      "User-Agent": "Article-MCP/2.0 (mailto:crossref@example.org)",
    });
  });
});

/**
 * 封装 PubMed 与 PMC API，支持检索、详情、引用和全文解析。
 */
import { XMLParser } from "fast-xml-parser";

import { convertPmcXmlToMarkdown, htmlToText } from "./html_to_markdown.js";
import { CacheManager, RateLimiter } from "../middleware/index.js";
import type {
  ArticleInfo,
  ArticleSearchResult,
  CitingArticlesResult,
  FulltextResult,
  SimilarArticlesResult,
} from "../types/articles.js";
import { defaultApiClient } from "../utils/api_utils.js";
import {
  buildNcbiParams,
  buildSemanticScholarHeaders,
  normalizeDoiIdentifier,
} from "../utils/service_identity.js";
import { stdioSafeLogger } from "../utils/stdio_safe_logger.js";

type SearchResult = ArticleSearchResult;

const MONTH_MAP: Record<string, string> = {
  Jan: "01",
  Feb: "02",
  Mar: "03",
  Apr: "04",
  May: "05",
  Jun: "06",
  Jul: "07",
  Aug: "08",
  Sep: "09",
  Oct: "10",
  Nov: "11",
  Dec: "12",
};

const PMC_SECTION_MAPPING: Record<string, string[]> = {
  methods: ["methods", "methodology", "materials and methods", "materials"],
  introduction: ["introduction", "intro", "background"],
  results: ["results", "findings"],
  discussion: ["discussion", "conclusions"],
  conclusion: ["conclusion", "conclusions"],
  abstract: ["abstract", "summary"],
  references: ["references", "bibliography"],
  appendix: ["appendix", "supplementary"],
};

/**
 * PubMed 搜索与全文服务。
 */
export class PubMedService {
  private readonly baseUrl = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/";
  private readonly headers = { "User-Agent": "PubMedSearch/1.0" };
  private readonly cacheManager: CacheManager;
  private readonly rateLimiter: RateLimiter;
  private readonly parser: XMLParser;

  public constructor(private readonly logger: Console = stdioSafeLogger) {
    this.cacheManager = new CacheManager();
    this.rateLimiter = new RateLimiter(this.resolveRateLimitDelayMs());
    this.parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
    });
  }

  /**
   * 关键词搜索 PubMed。
   */
  public async searchAsync(
    keyword: string,
    email?: string,
    startDate?: string,
    endDate?: string,
    maxResults = 10,
    useCache = true,
  ): Promise<SearchResult> {
    const startTime = Date.now();
    const cacheKey = `pubmed_search_${keyword}_${startDate}_${endDate}_${maxResults}`;

    return this.cacheManager.getCachedOrFetch<SearchResult>(
      cacheKey,
      async () => {
        try {
          const term = this.buildTerm(keyword, startDate, endDate);
          const esearchParams: Record<string, any> = {
            ...buildNcbiParams(email),
            db: "pubmed",
            term,
            retmax: String(maxResults),
            retmode: "xml",
          };

          this.logger.info(`PubMed async ESearch: ${term}`);

          const esearchUrl = `${this.baseUrl}esearch.fcgi`;
          const esearchXmlString = await this.ncbiGetText(
            esearchUrl,
            esearchParams,
            this.headers,
            30000,
          );

          const esearchXml = this.parser.parse(esearchXmlString);
          const ids = this.toArray(this.nodeTextOrArray(esearchXml.eSearchResult?.IdList?.Id));
          if (!ids.length) {
            return {
              articles: [],
              message: "No related literature found",
              processing_time: (Date.now() - startTime) / 1000,
            };
          }

          const pmids = ids.slice(0, maxResults).map((id) => String(id));
          const efetchParams: Record<string, any> = {
            ...buildNcbiParams(email),
            db: "pubmed",
            id: pmids.join(","),
            retmode: "xml",
            rettype: "xml",
          };

          this.logger.info(`PubMed async EFetch ${pmids.length} articles`);

          const efetchUrl = `${this.baseUrl}efetch.fcgi`;
          const efetchXmlString = await this.ncbiGetText(
            efetchUrl,
            efetchParams,
            this.headers,
            30000,
          );

          const efetchXml = this.parser.parse(efetchXmlString);
          const articles: ArticleInfo[] = [];
          for (const art of this.toArray(efetchXml.PubmedArticleSet?.PubmedArticle)) {
            const info = this.processArticle(art);
            if (info) {
              articles.push(info);
            }
          }

          return {
            articles,
            message:
              articles.length > 0
                ? `Found ${articles.length} related articles`
                : "No related literature found",
            processing_time: (Date.now() - startTime) / 1000,
          };
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          return {
            articles: [],
            error: `Search failed: ${errorMsg}`,
            processing_time: (Date.now() - startTime) / 1000,
          };
        }
      },
      24,
      useCache,
    );
  }

  /**
   * 获取引用某 PMID 的文章。
   */
  public async getCitingArticlesAsync(
    pmid: string,
    email?: string,
    maxResults = 20,
  ): Promise<CitingArticlesResult> {
    const startTime = Date.now();

    try {
      if (!pmid || !/^\d+$/.test(pmid)) {
        return { citing_articles: [], error: "Invalid PMID" };
      }

      const ssUrl = `https://api.semanticscholar.org/graph/v1/paper/PMID:${pmid}/citations`;
      const ssParams = {
        fields:
          "citingPaper.paperId,citingPaper.title,citingPaper.year,citingPaper.authors,citingPaper.venue,citingPaper.externalIds,citingPaper.publicationDate",
        limit: maxResults,
      };

      this.logger.info(`Semantic Scholar query citations: ${ssUrl}`);
      const ssResponse = await defaultApiClient.getJson<any>(
        ssUrl,
        ssParams,
        buildSemanticScholarHeaders(),
        60000,
      );
      const ssItems = ssResponse?.data || [];
      if (!ssItems.length) {
        return {
          citing_articles: [],
          total_count: 0,
          message: "No citing articles found",
        };
      }

      const pmidList: string[] = [];
      const interimArticles: ArticleInfo[] = [];

      for (const item of ssItems) {
        const paper = item.citingPaper || item.paper || {};
        const extIds = paper.externalIds || {};
        const ssPmid = extIds.PubMed || extIds.PMID;

        if (ssPmid && /^\d+$/.test(String(ssPmid))) {
          pmidList.push(String(ssPmid));
          continue;
        }

        const doi = extIds.DOI;
        const arxivId = extIds.ArXiv;
        const ssPaperId = paper.paperId;
        const doiLink = doi ? `https://doi.org/${doi}` : undefined;
        const arxivLink = arxivId ? `https://arxiv.org/abs/${arxivId}` : undefined;
        const ssLink = ssPaperId ? `https://www.semanticscholar.org/paper/${ssPaperId}` : undefined;

        interimArticles.push({
          pmid: null,
          title: paper.title || "No title",
          authors: paper.authors?.map((a: any) => a.name) || [],
          journal_name: paper.venue || "Unknown journal",
          publication_date: paper.publicationDate || String(paper.year || ""),
          abstract: "",
          ...(doi ? { doi } : {}),
          ...(doiLink ? { doi_link: doiLink } : {}),
          ...(arxivId ? { arxiv_id: arxivId } : {}),
          ...(arxivLink ? { arxiv_link: arxivLink } : {}),
          ...(ssPaperId ? { semantic_scholar_id: ssPaperId } : {}),
          ...(ssLink ? { semantic_scholar_link: ssLink } : {}),
          ...(doiLink || arxivLink || ssLink
            ? { pmid_link: (doiLink || arxivLink || ssLink) as string }
            : {}),
        });
      }

      let citingArticles: ArticleInfo[] = [];
      if (pmidList.length > 0) {
        const efetchParams: Record<string, any> = {
          ...buildNcbiParams(email),
          db: "pubmed",
          id: pmidList.join(","),
          retmode: "xml",
          rettype: "xml",
        };

        const efetchUrl = `${this.baseUrl}efetch.fcgi`;
        const efetchXmlString = await this.ncbiGetText(
          efetchUrl,
          efetchParams,
          this.headers,
          60000,
        );

        const efetchXml = this.parser.parse(efetchXmlString);
        for (const art of this.toArray(efetchXml.PubmedArticleSet?.PubmedArticle)) {
          const info = this.processArticle(art);
          if (info) {
            citingArticles.push(info);
          }
        }
      }

      citingArticles = [...citingArticles, ...interimArticles];

      return {
        citing_articles: citingArticles,
        total_count: ssItems.length,
        message: `Retrieved ${citingArticles.length} citing articles (Semantic Scholar + PubMed)`,
        processing_time: (Date.now() - startTime) / 1000,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        citing_articles: [],
        error: `Failed to fetch citing articles: ${errorMsg}`,
      };
    }
  }

  /**
   * 获取某 PMID 引用的参考文献。
   */
  public async getReferencedArticlesAsync(
    pmid: string,
    email?: string,
    maxResults = 20,
  ): Promise<{ referenced_articles: ArticleInfo[]; total_count?: number; error?: string; message?: string }> {
    try {
      if (!pmid || !/^\d+$/.test(pmid)) {
        return { referenced_articles: [], error: "Invalid PMID" };
      }

      const elinkParams: Record<string, any> = {
        ...buildNcbiParams(email),
        dbfrom: "pubmed",
        db: "pubmed",
        id: pmid,
        linkname: "pubmed_pubmed_refs",
        retmode: "xml",
      };

      const elinkXmlString = await this.ncbiGetText(
        `${this.baseUrl}elink.fcgi`,
        elinkParams,
        this.headers,
        30000,
      );
      const elinkXml = this.parser.parse(elinkXmlString);
      const linkSetDb = this.toArray(elinkXml.eLinkResult?.LinkSet?.LinkSetDb)[0];
      const links = this.toArray(linkSetDb?.Link);
      const referencedPmids = links
        .map((link) => this.nodeText(link?.Id))
        .filter((id) => /^\d+$/.test(id))
        .slice(0, maxResults);

      if (!referencedPmids.length) {
        return {
          referenced_articles: [],
          total_count: 0,
          message: "No referenced articles found",
        };
      }

      const efetchParams: Record<string, any> = {
        ...buildNcbiParams(email),
        db: "pubmed",
        id: referencedPmids.join(","),
        retmode: "xml",
        rettype: "xml",
      };

      const efetchXmlString = await this.ncbiGetText(
        `${this.baseUrl}efetch.fcgi`,
        efetchParams,
        this.headers,
        60000,
      );
      const efetchXml = this.parser.parse(efetchXmlString);
      const referencedArticles: ArticleInfo[] = [];
      for (const art of this.toArray(efetchXml.PubmedArticleSet?.PubmedArticle)) {
        const info = this.processArticle(art);
        if (info) {
          referencedArticles.push(info);
        }
      }

      return {
        referenced_articles: referencedArticles,
        total_count: referencedPmids.length,
        message: `Retrieved ${referencedArticles.length} referenced articles`,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        referenced_articles: [],
        error: `Failed to fetch referenced articles: ${errorMsg}`,
      };
    }
  }

  /**
   * 通过 DOI 查找 PubMed PMID。
   */
  public async findPmidByDoiAsync(doi: string, email?: string): Promise<string | null> {
    try {
      const normalizedDoi = normalizeDoiIdentifier(doi);
      if (!normalizedDoi) {
        return null;
      }

      const params: Record<string, any> = {
        ...buildNcbiParams(email),
        db: "pubmed",
        term: `"${normalizedDoi}"[AID]`,
        retmax: "1",
        retmode: "xml",
      };

      const xmlString = await this.ncbiGetText(
        `${this.baseUrl}esearch.fcgi`,
        params,
        this.headers,
        30000,
      );
      const xml = this.parser.parse(xmlString);
      const ids = this.toArray(this.nodeTextOrArray(xml.eSearchResult?.IdList?.Id));
      const firstId = ids[0];
      return firstId ? String(firstId) : null;
    } catch (error) {
      this.logger.warn(`Failed to find PMID by DOI: ${error}`);
      return null;
    }
  }

  /**
   * 根据 PMID 获取相似文献。
   */
  public async getSimilarArticlesAsync(
    pmid: string,
    email?: string,
    maxResults = 20,
  ): Promise<SimilarArticlesResult> {
    try {
      if (!pmid || !/^\d+$/.test(pmid)) {
        return { similar_articles: [], error: "Invalid PMID" };
      }

      const original = await this.getArticleDetailsAsync(pmid, "pmid");
      const elinkParams: Record<string, any> = {
        ...buildNcbiParams(email),
        dbfrom: "pubmed",
        db: "pubmed",
        id: pmid,
        linkname: "pubmed_pubmed",
        retmode: "xml",
      };

      const elinkXmlString = await this.ncbiGetText(
        `${this.baseUrl}elink.fcgi`,
        elinkParams,
        this.headers,
        30000,
      );
      const elinkXml = this.parser.parse(elinkXmlString);
      const linkSetDb = this.toArray(elinkXml.eLinkResult?.LinkSet?.LinkSetDb)[0];
      const links = this.toArray(linkSetDb?.Link);
      const ids = links.map((link) => this.nodeText(link?.Id)).filter(Boolean);
      const similarPmids = ids
        .map((id) => String(id))
        .filter((id) => /^\d+$/.test(id) && id !== pmid)
        .slice(0, maxResults);

      if (!similarPmids.length) {
        return {
          original_article: original.article,
          similar_articles: [],
          total_similar_count: 0,
          retrieved_count: 0,
          message: "No similar articles found",
        };
      }

      const efetchParams: Record<string, any> = {
        ...buildNcbiParams(email),
        db: "pubmed",
        id: similarPmids.join(","),
        retmode: "xml",
        rettype: "xml",
      };

      const efetchXmlString = await this.ncbiGetText(
        `${this.baseUrl}efetch.fcgi`,
        efetchParams,
        this.headers,
        60000,
      );
      const efetchXml = this.parser.parse(efetchXmlString);
      const similarArticles: ArticleInfo[] = [];
      for (const art of this.toArray(efetchXml.PubmedArticleSet?.PubmedArticle)) {
        const info = this.processArticle(art);
        if (info) {
          similarArticles.push(info);
        }
      }

      return {
        original_article: original.article,
        similar_articles: similarArticles,
        total_similar_count: similarPmids.length,
        retrieved_count: similarArticles.length,
        message: `Retrieved ${similarArticles.length} similar articles`,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        similar_articles: [],
        error: `Failed to fetch similar articles: ${errorMsg}`,
      };
    }
  }

  /**
   * 获取 PMC 全文。
   */
  public async getPMCFulltextHtmlAsync(
    pmcId: string,
    sections?: string[],
  ): Promise<FulltextResult> {
    try {
      if (!pmcId || !pmcId.trim()) {
        return {
          pmc_id: null,
          fulltext_available: false,
          error: "PMCID is required to fetch fulltext",
        };
      }

      let normalizedPmcId = pmcId.trim();
      if (!normalizedPmcId.startsWith("PMC")) {
        normalizedPmcId = `PMC${normalizedPmcId}`;
      }

      const xmlUrl = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi";
      const params = {
        ...buildNcbiParams(),
        db: "pmc",
        id: normalizedPmcId,
        rettype: "xml",
        retmode: "xml",
      };

      this.logger.info(`Async requesting PMC fulltext: ${normalizedPmcId}`);
      const fulltextXml = await this.ncbiGetText(xmlUrl, params, undefined, 60000);

      if (!fulltextXml || !fulltextXml.trim()) {
        return {
          pmc_id: normalizedPmcId,
          fulltext_available: false,
          error: "PMC returned empty content",
        };
      }

      const normalizedSections = sections
        ?.map((section) => section.trim().toLowerCase())
        .filter(Boolean);
      const bodyMatch = fulltextXml.match(/<body[^>]*>(.*?)<\/body>/is);
      const bodyContent = bodyMatch?.[1] ?? fulltextXml;
      const sectionResult =
        sections === undefined
          ? null
          : normalizedSections && normalizedSections.length > 0
            ? this.extractSections(bodyContent, normalizedSections)
            : { xml: "", found: [] as string[] };
      const conversionXml = sections === undefined ? bodyContent : (sectionResult?.xml ?? "");
      const text = conversionXml ? (htmlToText(conversionXml) ?? "") : "";
      const markdown = conversionXml ? (convertPmcXmlToMarkdown(conversionXml) ?? "") : "";
      const result: FulltextResult = {
        pmc_id: normalizedPmcId,
        fulltext_xml: sections === undefined ? fulltextXml : (sectionResult?.xml ?? ""),
        fulltext_markdown: markdown,
        fulltext_text: text,
        fulltext_available: true,
      };

      if (sections !== undefined) {
        result.sections_requested = normalizedSections ?? [];
        result.sections_found = sectionResult?.found ?? [];
        result.sections_missing = (normalizedSections ?? []).filter(
          (section) => !(sectionResult?.found ?? []).includes(section),
        );
      }

      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        pmc_id: pmcId || null,
        fulltext_available: false,
        error: `Failed to fetch fulltext: ${errorMsg}`,
      };
    }
  }

  /**
   * 同步获取全文内容（向后兼容）。
   */
  public getPMCFulltextHtml(pmcId: string, sections?: string[]): FulltextResult {
    void sections;
    this.logger.warn("getPMCFulltextHtml() is sync and deprecated, use getPMCFulltextHtmlAsync()");
    return {
      pmc_id: pmcId || null,
      fulltext_available: false,
      error: "Use getPMCFulltextHtmlAsync() instead",
    };
  }

  /**
   * 获取参考文献的 PMC 详情。
   */
  public async getArticleDetailsAsync(
    identifier: string,
    idType = "pmid",
    includeFulltext = false,
  ): Promise<{ article: ArticleInfo | null; error?: string }> {
    try {
      const pmid = await this.resolvePmidAsync(identifier, idType);
      if (!pmid) {
        return {
          article: null,
          error: `No literature found with ${idType.toUpperCase()}=${identifier}`,
        };
      }

      const efetchParams = {
        ...buildNcbiParams(),
        db: "pubmed",
        id: pmid,
        retmode: "xml",
        rettype: "xml",
      };
      const efetchXmlString = await this.ncbiGetText(
        `${this.baseUrl}efetch.fcgi`,
        efetchParams,
        this.headers,
        30000,
      );
      const efetchXml = this.parser.parse(efetchXmlString);
      const articleNode = this.toArray(efetchXml.PubmedArticleSet?.PubmedArticle)[0];
      const articleInfo = articleNode ? this.processArticle(articleNode) : null;
      if (!articleInfo) {
        return { article: null, error: "Failed to process article information" };
      }

      if (includeFulltext && articleInfo.pmc_id) {
        const fulltext = await this.getPMCFulltextHtmlAsync(articleInfo.pmc_id);
        if (!fulltext.error) {
          (articleInfo as any).fulltext = fulltext;
        }
      }

      return { article: articleInfo };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return { article: null, error: `Failed to fetch article details: ${errorMsg}` };
    }
  }

  /**
   * 批量查询多个 DOI。
   */
  public async searchBatchDoiAsync(dois: string[]): Promise<any[]> {
    if (!dois.length) {
      return [];
    }

    try {
      this.logger.info(`Batch query ${dois.length} DOIs`);
      const pmids = (
        await Promise.all(dois.map((doi) => this.findPmidByDoiAsync(doi)))
      ).filter((pmid): pmid is string => Boolean(pmid));
      if (!pmids.length) {
        return [];
      }

      const efetchParams = {
        ...buildNcbiParams(),
        db: "pubmed",
        id: pmids.join(","),
        retmode: "xml",
        rettype: "xml",
      };
      const efetchXmlString = await this.ncbiGetText(
        `${this.baseUrl}efetch.fcgi`,
        efetchParams,
        this.headers,
        60000,
      );
      const efetchXml = this.parser.parse(efetchXmlString);
      const results = this.toArray(efetchXml.PubmedArticleSet?.PubmedArticle)
        .map((article) => this.processArticle(article))
        .filter((article): article is ArticleInfo => Boolean(article));
      this.logger.info(`Batch query returned ${results.length} results`);
      return results;
    } catch (e) {
      this.logger.error(`Batch query error: ${e}`);
      return [];
    }
  }

  /**
   * 通用详情入口。
   */
  public async fetch(
    identifier: string,
    idType = "pmid",
    mode = "sync",
    includeFulltext = false,
  ): Promise<{ article: ArticleInfo | null; error?: string }> {
    void mode;
    const startTime = Date.now();
    const result = await this.getArticleDetailsAsync(identifier, idType, includeFulltext);
    (result as any).processing_time = Math.round((Date.now() - startTime) / 10) / 100;
    return result;
  }

  private resolveRateLimitDelayMs(): number {
    const configured = Number(process.env.NCBI_RATE_LIMIT_MS);
    if (Number.isFinite(configured) && configured >= 0) {
      return configured;
    }

    return process.env.NODE_ENV === "test" ? 0 : 333;
  }

  private async ncbiGetText(
    url: string,
    params?: Record<string, unknown>,
    headers?: Record<string, string>,
    timeout?: number,
  ): Promise<string> {
    return this.rateLimiter.schedule(() => defaultApiClient.getText(url, params, headers, timeout));
  }

  private buildTerm(keyword: string, startDate?: string, endDate?: string): string {
    let term = keyword.trim();
    const dateFilter = this.formatDateRange(startDate || "", endDate || "");
    if (dateFilter) {
      term = `${term} AND ${dateFilter}`;
    }
    return term;
  }

  private formatDateRange(startDate: string, endDate: string): string {
    const parseDate = (d: string | undefined): Date | null => {
      if (!d) return null;

      const isoMatch = d.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      if (isoMatch) {
        const [, year, month, day] = isoMatch;
        if (year && month && day) {
          return new Date(`${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`);
        }
      }

      const slashMatch = d.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
      if (slashMatch) {
        const [, year, month, day] = slashMatch;
        if (year && month && day) {
          return new Date(`${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`);
        }
      }

      const compactMatch = d.match(/^(\d{4})(\d{2})(\d{2})$/);
      if (compactMatch) {
        const [, year, month, day] = compactMatch;
        if (year && month && day) {
          return new Date(`${year}-${month}-${day}`);
        }
      }

      return null;
    };

    let startDt = parseDate(startDate);
    let endDt = parseDate(endDate);

    if (!startDt && !endDt) {
      return "";
    }
    if (startDt && !endDt) {
      endDt = new Date();
    }
    if (endDt && !startDt) {
      startDt = new Date("1800-01-01");
    }
    if (startDt! > endDt!) {
      [startDt, endDt] = [endDt, startDt];
    }

    const formatDate = (d: Date) => d.toISOString().split("T")[0];
    return `(${formatDate(startDt!)}[PDAT] : ${formatDate(endDt!)}[PDAT])`;
  }

  private async resolvePmidAsync(identifier: string, idType: string): Promise<string | null> {
    const normalizedType = idType.toLowerCase();
    const normalizedIdentifier = identifier
      .replace(/^DOI:/i, "")
      .replace(/^PMID:/i, "")
      .replace(/^PMCID:/i, "")
      .trim();

    if (!normalizedIdentifier) {
      return null;
    }

    if (normalizedType === "pmid") {
      return /^\d+$/.test(normalizedIdentifier) ? normalizedIdentifier : null;
    }

    if (normalizedType === "doi") {
      return this.findPmidByDoiAsync(normalizeDoiIdentifier(normalizedIdentifier));
    }

    if (normalizedType === "pmcid") {
      const pmcid = normalizedIdentifier.toUpperCase().startsWith("PMC")
        ? normalizedIdentifier
        : `PMC${normalizedIdentifier}`;
      const ids = await this.searchPubmedIdsAsync(`${pmcid}[PMCID]`, 1);
      return ids[0] ?? null;
    }

    const ids = await this.searchPubmedIdsAsync(
      `${normalizedIdentifier}[${normalizedType.toUpperCase()}]`,
      1,
    );
    return ids[0] ?? null;
  }

  private async searchPubmedIdsAsync(term: string, retmax: number): Promise<string[]> {
    const params = {
      ...buildNcbiParams(),
      db: "pubmed",
      term,
      retmax: String(retmax),
      retmode: "xml",
    };
    const xmlString = await this.ncbiGetText(
      `${this.baseUrl}esearch.fcgi`,
      params,
      this.headers,
      30000,
    );
    const xml = this.parser.parse(xmlString);
    return this.toArray(this.nodeTextOrArray(xml.eSearchResult?.IdList?.Id)).map((id) =>
      String(id),
    );
  }

  private processArticle(article: any): ArticleInfo | null {
    try {
      const medline = article.MedlineCitation?.[0] ?? article.MedlineCitation;
      if (!medline) return null;

      const pmid = this.nodeText(medline.PMID);
      const articleElem = medline.Article?.[0] ?? medline.Article;
      if (!articleElem) return null;

      const title = this.nodeText(articleElem.ArticleTitle) || "No title";
      const authors: string[] = [];
      for (const author of this.toArray(
        articleElem.AuthorList?.[0]?.Author ?? articleElem.AuthorList?.Author,
      )) {
        const last = this.nodeText(author?.LastName);
        const fore = this.nodeText(author?.ForeName);
        const coll = this.nodeText(author?.CollectiveName);
        if (coll) {
          authors.push(coll);
        } else if (last || fore) {
          authors.push(`${fore} ${last}`.trim());
        }
      }

      const journalRaw =
        this.nodeText(articleElem.Journal?.[0]?.Title ?? articleElem.Journal?.Title) ||
        "Unknown journal";
      const journal = journalRaw.replace(/\s*\(.*?\)\s*/g, "").trim() || journalRaw;

      let pubDate = "Unknown date";
      const pubDateElem =
        articleElem.Journal?.[0]?.JournalIssue?.[0]?.PubDate?.[0] ??
        articleElem.Journal?.JournalIssue?.PubDate;
      if (pubDateElem) {
        const year = this.nodeText(pubDateElem.Year);
        const month = this.nodeText(pubDateElem.Month) || "01";
        const day = this.nodeText(pubDateElem.Day) || "01";
        const monthStr = MONTH_MAP[month] || month.padStart(2, "0");
        const dayStr = String(day).padStart(2, "0");
        if (year && /^\d+$/.test(year)) {
          pubDate = `${year}-${monthStr}-${dayStr}`;
        }
      }

      const abstractTextNodes = this.toArray(
        articleElem.Abstract?.[0]?.AbstractText ?? articleElem.Abstract?.AbstractText,
      );
      const abstract =
        abstractTextNodes
          .map((node) => this.nodeText(node).trim())
          .filter(Boolean)
          .join(" ") || "No abstract";

      let doi: string | undefined;
      let doiLink: string | undefined;
      let pmcId: string | undefined;
      let pmcLink: string | undefined;

      const articleIdList = this.toArray(
        article.PubmedData?.[0]?.ArticleIdList?.[0]?.ArticleId ??
          article.PubmedData?.ArticleIdList?.ArticleId,
      );
      for (const idElem of articleIdList) {
        const idType = idElem?.$?.IdType || idElem?.["@_IdType"];
        const idValue = this.nodeText(idElem);
        if (idType === "doi") {
          doi = idValue;
          doiLink = `https://doi.org/${doi}`;
        } else if (idType === "pmc") {
          pmcId = idValue;
          if (pmcId?.startsWith("PMC")) {
            pmcLink = `https://www.ncbi.nlm.nih.gov/pmc/articles/${pmcId}/`;
          }
        }
      }

      return {
        pmid: pmid || null,
        title,
        authors,
        journal_name: journal,
        publication_date: pubDate,
        abstract,
        ...(pmid ? { pmid_link: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` } : {}),
        ...(doi ? { doi } : {}),
        ...(doiLink ? { doi_link: doiLink } : {}),
        ...(pmcId ? { pmc_id: pmcId } : {}),
        ...(pmcLink ? { pmc_link: pmcLink } : {}),
      };
    } catch (error) {
      this.logger.warn(`Failed to parse article: ${error}`);
      return null;
    }
  }

  private toArray<T>(value: T | T[] | undefined | null): T[] {
    if (value === undefined || value === null) {
      return [];
    }
    return Array.isArray(value) ? value : [value];
  }

  private nodeText(value: unknown): string {
    if (typeof value === "string" || typeof value === "number") {
      return String(value);
    }
    if (Array.isArray(value)) {
      return value.length > 0 ? this.nodeText(value[0]) : "";
    }
    if (value && typeof value === "object") {
      const node = value as Record<string, unknown>;
      const text = node["#text"] ?? node._;
      if (typeof text === "string" || typeof text === "number") {
        return String(text);
      }
    }
    return "";
  }

  private nodeTextOrArray(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.nodeText(item)).filter(Boolean);
    }

    return this.nodeText(value);
  }

  private extractSections(
    bodyContent: string,
    requestedSections?: string[],
  ): { xml: string; found: string[] } {
    if (!requestedSections?.length) {
      return { xml: "", found: [] };
    }

    const found = new Set<string>();
    const matchedSections: string[] = [];
    const sectionPattern = /<sec\b[^>]*>([\s\S]*?)<\/sec>/gi;

    for (const match of bodyContent.matchAll(sectionPattern)) {
      const sectionXml = match[0];
      const title = this.normalizeSectionTitle(sectionXml);
      if (!title) {
        continue;
      }

      for (const requested of requestedSections) {
        const candidates = PMC_SECTION_MAPPING[requested] ?? [requested];
        if (candidates.some((candidate) => title.includes(candidate))) {
          found.add(requested);
          matchedSections.push(sectionXml);
          break;
        }
      }
    }

    return {
      xml: matchedSections.join("\n"),
      found: requestedSections.filter((requested) => found.has(requested)),
    };
  }

  private normalizeSectionTitle(sectionXml: string): string {
    const titleMatch = sectionXml.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    return titleMatch && titleMatch[1]
      ? (htmlToText(titleMatch[1]) ?? "").toLowerCase().replace(/\s+/g, " ")
      : "";
  }
}

/**
 * 创建 PubMed 服务实例。
 */
export function createPubMedService(logger?: Console): PubMedService {
  return new PubMedService(logger);
}


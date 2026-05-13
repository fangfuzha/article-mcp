import { CacheManager, RateLimiter } from "../middleware/index.js";
import { defaultApiClient } from "../utils/api_utils.js";

interface ArticleInfo {
  pmid: string;
  title: string;
  authors: string[];
  journal_name: string;
  publication_date: string;
  abstract: string;
  doi?: string;
  pmcid?: string;
  pmc_id?: string;
  cache_hit?: boolean;
}

interface SearchResult {
  articles: ArticleInfo[];
  total_count: number;
  error?: string;
  message?: string;
  cache_hit?: boolean;
}

interface ArticleDetailsResult {
  article: ArticleInfo | null;
  error?: string;
}

export class EuropePMCService {
  private baseUrl = "https://www.ebi.ac.uk/europepmc/webservices/rest/search";
  private detailUrl = "https://www.ebi.ac.uk/europepmc/webservices/rest/search";
  private referenceRootUrl = "https://www.ebi.ac.uk/europepmc/webservices/rest";
  private rateLimitDelay = 1000; // 1 second
  private headers = {
    "User-Agent": "Europe-PMC-MCP-Server/1.0",
    Accept: "application/json",
  };
  private searchSemaphoreCount = 0;
  private searchSemaphoreMax = 3;
  private cacheManager: CacheManager;
  private rateLimiter: RateLimiter;

  constructor(
    private logger: Console = console,
    private pubmedService?: any,
  ) {
    this.cacheManager = new CacheManager();
    this.rateLimiter = new RateLimiter(this.rateLimitDelay);
  }

  /**
   * 验证邮箱格式
   */
  private validateEmail(email: string): boolean {
    const pattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    return pattern.test(email);
  }

  /**
   * 解析日期字符串
   */
  private parseDate(dateStr: string): Date {
    const formats = [
      /^(\d{4})-(\d{1,2})-(\d{1,2})$/,
      /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/,
      /^(\d{1,2})-(\d{1,2})-(\d{4})$/,
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
    ];

    for (const format of formats) {
      const match = dateStr.match(format);
      if (match) {
        if ((match[3] ?? "").length === 4) {
          return new Date(
            `${match[3]}-${match[2]!.padStart(2, "0")}-${match[1]!.padStart(2, "0")}`,
          );
        } else {
          return new Date(
            `${match[1]}-${match[2]!.padStart(2, "0")}-${match[3]!.padStart(2, "0")}`,
          );
        }
      }
    }

    throw new Error(`Unable to parse date format: ${dateStr}`);
  }

  /**
   * 处理 Europe PMC 文献 JSON 信息
   */
  private processEuropePMCArticle(articleJson: any): ArticleInfo | null {
    try {
      const title = (articleJson.title || "No title").trim();
      const authorString = articleJson.authorString || "Unknown authors";
      const authors = authorString
        .split(",")
        .map((a: string) => a.trim())
        .filter((a: string) => a);

      const journalInfo = articleJson.journalInfo || {};
      const journalTitle = journalInfo.journal?.title || "Unknown journal";

      let publicationDate = articleJson.firstPublicationDate || "";
      if (!publicationDate) {
        const pubYear = journalInfo.yearOfPublication?.toString() || "";
        publicationDate = pubYear && /^\d+$/.test(pubYear) ? `${pubYear}-01-01` : "Unknown date";
      }

      let abstract = (articleJson.abstractText || "No abstract").trim();
      abstract = abstract.replace(/<[^<]+?>/g, "");
      abstract = abstract.replace(/\s+/g, " ").trim();

      return {
        pmid: articleJson.pmid || "N/A",
        title,
        authors,
        journal_name: journalTitle,
        publication_date: publicationDate,
        abstract,
        doi: articleJson.doi,
        pmcid: articleJson.pmcid,
      };
    } catch (e) {
      this.logger.error(`Error processing article JSON: ${e}`);
      return null;
    }
  }

  /**
   * 推断 Europe PMC references 接口可用的标识符类型。
   *
   * @param identifier 用户传入的 DOI、PMID 或 PMCID。
   * @returns 归一化后的标识符类型。
   */
  private inferReferenceIdentifierType(identifier: string): "doi" | "pmid" | "pmcid" {
    const normalized = identifier.trim();
    const upper = normalized.toUpperCase();

    if (upper.startsWith("PMCID:") || upper.startsWith("PMC")) {
      return "pmcid";
    }

    if (upper.startsWith("PMID:") || /^\d+$/.test(normalized)) {
      return "pmid";
    }

    return "doi";
  }

  /**
   * 去除常见标识符前缀。
   *
   * @param identifier 用户传入的标识符。
   * @returns 去除 DOI、PMID、PMCID 前缀后的标识符。
   */
  private stripIdentifierPrefix(identifier: string): string {
    return identifier
      .replace(/^DOI:/i, "")
      .replace(/^PMID:/i, "")
      .replace(/^PMCID:/i, "")
      .trim();
  }

  /**
   * 标准化 PMCID，确保传给 Europe PMC references 接口时带 PMC 前缀。
   *
   * @param identifier 用户传入的 PMCID。
   * @returns 带 PMC 前缀的 PMCID。
   */
  private normalizeReferencePmcid(identifier: string): string {
    const normalized = this.stripIdentifierPrefix(identifier);
    return normalized.toUpperCase().startsWith("PMC") ? normalized : `PMC${normalized}`;
  }

  /**
   * 从 Europe PMC references 记录中提取作者列表。
   *
   * @param referenceJson Europe PMC references 原始记录。
   * @returns 作者姓名列表。
   */
  private extractReferenceAuthors(referenceJson: any): string[] {
    const authorList = referenceJson.authorList?.author;
    if (Array.isArray(authorList)) {
      return authorList
        .map((author: any) => {
          if (typeof author === "string") {
            return author.trim();
          }

          const firstName = String(author.firstName || "").trim();
          const lastName = String(author.lastName || "").trim();
          return firstName && lastName ? `${firstName} ${lastName}` : lastName || firstName;
        })
        .filter(Boolean);
    }

    const authorString = String(referenceJson.authorString || referenceJson.authors || "").trim();
    return authorString
      ? authorString
          .split(/[;,]/)
          .map((author) => author.trim())
          .filter(Boolean)
      : [];
  }

  /**
   * 格式化 Europe PMC references 接口返回的参考文献记录。
   *
   * @param referenceJson Europe PMC references 原始记录。
   * @returns 工具层统一使用的参考文献记录。
   */
  private formatReferenceRecord(referenceJson: any): Record<string, any> {
    const referenceSource = String(referenceJson.source || "").toUpperCase();
    const referenceId = String(referenceJson.id || "").trim();
    const publicationYear = referenceJson.pubYear || referenceJson.year || "";

    return {
      title:
        referenceJson.title ||
        referenceJson.articleTitle ||
        referenceJson.citationTitle ||
        referenceJson.unstructured ||
        "",
      authors: this.extractReferenceAuthors(referenceJson),
      journal:
        referenceJson.journalTitle ||
        referenceJson.journalAbbreviation ||
        referenceJson.journal ||
        "",
      year: publicationYear,
      publication_date:
        referenceJson.firstPublicationDate || (publicationYear ? `${publicationYear}-01-01` : ""),
      doi: referenceJson.doi || referenceJson.DOI || "",
      pmid: referenceJson.pmid || (referenceSource === "MED" ? referenceId : ""),
      pmcid:
        referenceJson.pmcid ||
        referenceJson.pmc_id ||
        (referenceSource === "PMC" && referenceId ? this.normalizeReferencePmcid(referenceId) : ""),
      abstract: referenceJson.abstractText || referenceJson.abstract || "",
      volume: referenceJson.volume || "",
      issue: referenceJson.issue || "",
      pages: referenceJson.pageInfo || referenceJson.page || referenceJson.firstPage || "",
      source: "europe_pmc",
    };
  }

  /**
   * 将 DOI、PMID 或 PMCID 解析为 Europe PMC references endpoint 需要的 source/id。
   *
   * @param identifier 用户传入的文献标识符。
   * @param idType 用户指定或推断出的标识符类型。
   * @returns Europe PMC references endpoint 的 source/id，无法解析时返回 null。
   */
  private async resolveReferenceTarget(
    identifier: string,
    idType: string,
  ): Promise<{ source: string; id: string } | null> {
    const normalizedType =
      idType === "auto" ? this.inferReferenceIdentifierType(identifier) : idType.toLowerCase();
    const normalizedIdentifier = this.stripIdentifierPrefix(identifier);

    if (normalizedType === "pmid") {
      return { source: "MED", id: normalizedIdentifier };
    }

    if (normalizedType === "pmcid") {
      return { source: "PMC", id: this.normalizeReferencePmcid(normalizedIdentifier) };
    }

    const params = {
      query: `DOI:"${normalizedIdentifier}"`,
      format: "json",
      resultType: "core",
      pageSize: 1,
    };
    const data = await defaultApiClient.get<any>(this.baseUrl, params, this.headers, 60000);
    const article = data?.resultList?.result?.[0];

    if (!article) {
      return null;
    }

    const source = String(article.source || (article.pmid ? "MED" : article.pmcid ? "PMC" : ""));
    const targetId = String(article.id || article.pmid || article.pmcid || "").trim();

    if (!source || !targetId) {
      return null;
    }

    return {
      source: source.toUpperCase(),
      id: source.toUpperCase() === "PMC" ? this.normalizeReferencePmcid(targetId) : targetId,
    };
  }

  /**
   * 通过 Europe PMC references endpoint 获取参考文献。
   *
   * @param identifier DOI、PMID 或 PMCID。
   * @param idType 标识符类型，auto 时根据标识符格式推断。
   * @param maxResults 最大返回参考文献数量。
   * @returns 参考文献查询结果和解析后的 Europe PMC source/id。
   */
  async getReferencesAsync(
    identifier: string,
    idType: string = "auto",
    maxResults: number = 20,
  ): Promise<Record<string, any>> {
    const cacheKey = `europe_pmc_references_${idType}_${identifier}_${maxResults}`;

    return this.cacheManager.getCachedOrFetch(
      cacheKey,
      async () => {
        try {
          const target = await this.resolveReferenceTarget(identifier, idType);
          if (!target) {
            return {
              success: false,
              references: [],
              total_count: 0,
              source: "europe_pmc",
              error: `无法解析 Europe PMC references 标识符: ${identifier}`,
            };
          }

          const url = `${this.referenceRootUrl}/${target.source}/${encodeURIComponent(target.id)}/references`;
          const params = {
            format: "json",
            pageSize: maxResults,
          };

          const data = await defaultApiClient.get<any>(url, params, this.headers, 60000);
          const rawReferences = data?.referenceList?.reference || [];
          const references = rawReferences
            .slice(0, maxResults)
            .map((referenceJson: any) => this.formatReferenceRecord(referenceJson));

          return {
            success: true,
            references,
            total_count: Number(data?.hitCount ?? references.length),
            source: "europe_pmc",
            resolved_target: target,
            message: references.length
              ? `Europe PMC 返回 ${references.length} 条参考文献`
              : "Europe PMC 未返回参考文献",
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          this.logger.error(`Europe PMC 获取参考文献失败: ${errorMessage}`);
          return {
            success: false,
            references: [],
            total_count: 0,
            source: "europe_pmc",
            error: errorMessage,
          };
        }
      },
      24,
    );
  }

  /**
   * 构建查询参数
   */
  private buildQueryParams(
    keyword: string,
    startDate: string,
    endDate: string,
    maxResults: number,
    email?: string,
  ): Record<string, any> {
    let endDt = endDate ? this.parseDate(endDate) : new Date();
    let startDt = startDate
      ? this.parseDate(startDate)
      : new Date(endDt.getTime() - 3 * 365 * 24 * 60 * 60 * 1000);

    if (startDt > endDt) {
      throw new Error("Start date cannot be later than end date");
    }

    const startStr = startDt.toISOString().split("T")[0];
    const endStr = endDt.toISOString().split("T")[0];
    const dateFilter = `FIRST_PDATE:[${startStr} TO ${endStr}]`;
    const fullQuery = `(${keyword}) AND (${dateFilter})`;

    const params: Record<string, any> = {
      query: fullQuery,
      format: "json",
      pageSize: maxResults,
      resultType: "core",
      sort: "FIRST_PDATE_D desc",
    };

    if (email && this.validateEmail(email)) {
      params.email = email;
    }

    return params;
  }

  /**
   * 异步搜索 Europe PMC 文献数据库
   */
  async searchAsync(
    keyword: string,
    email?: string,
    startDate?: string,
    endDate?: string,
    maxResults: number = 10,
    useCache: boolean = true,
  ): Promise<SearchResult> {
    const cacheKey = `search_${keyword}_${startDate}_${endDate}_${maxResults}`;

    return this.cacheManager.getCachedOrFetch<SearchResult>(
      cacheKey,
      async () => {
        // Rate limiter
        await this.rateLimiter.schedule(async () => {
          this.logger.info(`Starting async search: ${keyword}`);
        });

        try {
          const params = this.buildQueryParams(
            keyword,
            startDate || "",
            endDate || "",
            maxResults,
            email,
          );

          const data = await defaultApiClient.get<any>(this.baseUrl, params, this.headers, 60000);

          const results = data?.resultList?.result || [];
          const hitCount = data?.hitCount || 0;

          if (!results.length) {
            return {
              message: "No related literature found",
              articles: [],
              total_count: 0,
            };
          }

          const articles: ArticleInfo[] = [];
          for (const articleJson of results) {
            const articleInfo = this.processEuropePMCArticle(articleJson);
            if (articleInfo) {
              articles.push(articleInfo);
              if (articles.length >= maxResults) {
                break;
              }
            }
          }

          return {
            articles,
            total_count: hitCount,
            message: `Found ${articles.length} related articles (total ${hitCount})`,
          };
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          return {
            error: `Search failed: ${errorMsg}`,
            articles: [],
            total_count: 0,
          };
        }
      },
      24,
      useCache,
    );
  }

  /**
   * 异步获取文献详情
   */
  async getArticleDetailsAsync(
    identifier: string,
    idType: string = "pmid",
    includeFulltext: boolean = false,
  ): Promise<ArticleDetailsResult> {
    const cacheKey = `article_${idType}_${identifier}`;

    return this.cacheManager.getCachedOrFetch<ArticleDetailsResult>(
      cacheKey,
      async () => {
        this.logger.info(`Async fetching article details: ${idType}=${identifier}`);

        const maxRetries = 3;
        for (let attempt = 0; attempt < maxRetries; attempt++) {
          try {
            let query = "";
            if (idType.toLowerCase() === "pmid") {
              query = `EXT_ID:${identifier}`;
            } else if (idType.toLowerCase() === "pmcid") {
              query = identifier.startsWith("PMC")
                ? `PMCID:${identifier}`
                : `PMCID:PMC${identifier}`;
            } else {
              query = `${idType.toUpperCase()}:${identifier}`;
            }

            const params = { query, format: "json", resultType: "core" };
            const data = await defaultApiClient.get<any>(
              this.detailUrl,
              params,
              this.headers,
              60000,
            );

            const results = data?.resultList?.result || [];

            if (!results.length) {
              return {
                error: `No literature found with ${idType.toUpperCase()}=${identifier}`,
                article: null,
              };
            }

            const articleInfo = this.processEuropePMCArticle(results[0]);

            if (includeFulltext && articleInfo?.pmcid && this.pubmedService) {
              try {
                const pmcId = articleInfo.pmcid;
                this.logger.info(`Fetching PMC fulltext: ${pmcId}`);
                const fulltextResult = await this.pubmedService.getPMCFulltextHtmlAsync(pmcId);
                if (!fulltextResult.error) {
                  (articleInfo as any).fulltext = {
                    html: fulltextResult.fulltext_html,
                    available: fulltextResult.fulltext_available || false,
                    title: fulltextResult.title,
                    authors: fulltextResult.authors,
                    abstract: fulltextResult.abstract,
                  };
                }
              } catch (e) {
                this.logger.error(`Error fetching PMC fulltext: ${e}`);
              }
            }

            await this.rateLimiter.schedule(async () => {});

            return articleInfo
              ? { article: articleInfo }
              : {
                  error: "Failed to process article information",
                  article: null,
                };
          } catch (e) {
            const error = e instanceof Error ? e.message : String(e);
            if (attempt < maxRetries - 1) {
              const delay = Math.pow(2, attempt) * 1000;
              await new Promise((resolve) => setTimeout(resolve, delay));
              continue;
            }
            return {
              error: `Failed to fetch article details: ${error}`,
              article: null,
            };
          }
        }

        return { error: `Failed after ${maxRetries} retries`, article: null };
      },
      24,
    );
  }

  /**
   * 批量查询多个 DOI
   */
  async searchBatchDoiAsync(dois: string[]): Promise<any[]> {
    if (!dois.length) {
      return [];
    }

    try {
      const doiQueries = dois.map((doi) => `DOI:"${doi}"`);
      const query = doiQueries.join(" OR ");

      const params = {
        query,
        format: "json",
        resultType: "core",
        pageSize: dois.length,
        cursorMark: "*",
      };

      this.logger.info(`Batch query ${dois.length} DOIs`);

      const data = await defaultApiClient.get<any>(this.baseUrl, params, this.headers, 60000);
      const results = data?.resultList?.result || [];
      this.logger.info(`Batch query returned ${results.length} results`);
      return results;
    } catch (e) {
      this.logger.error(`Batch query error: ${e}`);
      return [];
    }
  }

  /**
   * 统一获取详情接口
   */
  async fetch(
    identifier: string,
    idType: string = "pmid",
    mode: string = "sync",
    includeFulltext: boolean = false,
  ): Promise<ArticleDetailsResult> {
    const startTime = Date.now();
    void mode;

    const result = await this.getArticleDetailsAsync(identifier, idType, includeFulltext);

    const processingTime = (Date.now() - startTime) / 1000;
    (result as any).processing_time = Math.round(processingTime * 1000) / 1000;

    return result;
  }
}

/**
 * 创建 Europe PMC 服务实例
 */
export function createEuropePMCService(logger?: Console, pubmedService?: any): EuropePMCService {
  return new EuropePMCService(logger, pubmedService);
}

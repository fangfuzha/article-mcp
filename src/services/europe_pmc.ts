// @ts-nocheck
import { CacheManager, RateLimiter } from "../middleware/index.js";
import { defaultApiClient } from "../utils/api_utils";

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
  private rateLimitDelay = 1000; // 1 second
  private headers = {
    "User-Agent": "Europe-PMC-MCP-Server/1.0",
    Accept: "application/json",
  };
  private searchSemaphoreCount = 0;
  private searchSemaphoreMax = 3;
  private cacheManager: CacheManager;
  private rateLimiter: RateLimiter;
  private cache: Map<string, ArticleInfo> = new Map();
  private cacheExpiry: Map<string, number> = new Map();

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
        if (match[3].length === 4) {
          return new Date(`${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`);
        } else {
          return new Date(`${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`);
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
            error: undefined,
            message: `Found ${articles.length} related articles (total ${hitCount})`,
          };
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          return {
            error: `Search failed: ${errorMsg}`,
            articles: [],
            total_count: 0,
            message: undefined,
          };
        }
      },
      24,
      useCache,
    );
  }

  /**
   * 同步获取文献详情
   */
  getArticleDetailsSync(
    identifier: string,
    idType: string = "pmid",
    includeFulltext: boolean = false,
  ): ArticleDetailsResult {
    this.logger.info(`Fetching article details: ${idType}=${identifier}`);

    const fetchFromApi = (): ArticleDetailsResult => {
      const maxRetries = 3;
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          let query = "";
          if (idType.toLowerCase() === "pmid") {
            query = `EXT_ID:${identifier}`;
          } else if (idType.toLowerCase() === "pmcid") {
            query = identifier.startsWith("PMC") ? `PMCID:${identifier}` : `PMCID:PMC${identifier}`;
          } else {
            query = `${idType.toUpperCase()}:${identifier}`;
          }

          const params = { query, format: "json", resultType: "core" };

          const response = defaultApiClient.session.get(this.detailUrl, {
            params,
            headers: this.headers,
            timeout: 30000,
          });

          return response
            .then((res) => {
              const status = res.status;
              if (status === 429 || status === 503) {
                if (attempt < maxRetries - 1) {
                  throw new Error(`HTTP ${status}`);
                }
              }

              if (status !== 200) {
                return {
                  error: `API request failed: HTTP ${status}`,
                  article: null,
                };
              }

              const data = res.data;
              const results = data?.resultList?.result || [];

              if (!results.length) {
                return {
                  error: `No literature found with ${idType.toUpperCase()}=${identifier}`,
                  article: null,
                };
              }

              const articleInfo = this.processEuropePMCArticle(results[0]);
              return articleInfo
                ? { article: articleInfo, error: undefined }
                : {
                    error: "Failed to process article information",
                    article: null,
                  };
            })
            .catch((error) => {
              if (attempt < maxRetries - 1) {
                const delay = Math.pow(2, attempt) * 1000;
                return new Promise((resolve) =>
                  setTimeout(
                    () => resolve(this.getArticleDetailsSync(identifier, idType, includeFulltext)),
                    delay,
                  ),
                );
              }
              return {
                error: `Failed to fetch article details: ${error.message}`,
                article: null,
              };
            });
        } catch (e) {
          if (attempt < maxRetries - 1) {
            const delay = Math.pow(2, attempt) * 1000;
            // Sleep and retry
            return new Promise((resolve) =>
              setTimeout(
                () => resolve(this.getArticleDetailsSync(identifier, idType, includeFulltext)),
                delay,
              ),
            ) as any;
          }
          return { error: `Unexpected error: ${e}`, article: null };
        }
      }

      return { error: `Failed after ${maxRetries} retries`, article: null };
    };

    const cacheKey = `article_${idType}_${identifier}`;

    // Check cache synchronously
    const now = Date.now();
    if (this.cache.has(cacheKey) && this.cacheExpiry.has(cacheKey)) {
      const expiry = this.cacheExpiry.get(cacheKey)!;
      if (now < expiry) {
        return this.cache.get(cacheKey) as any;
      }
    }

    const result = fetchFromApi() as any;
    if (result.article) {
      this.cache.set(cacheKey, result.article);
      this.cacheExpiry.set(cacheKey, now + 24 * 60 * 60 * 1000);
    }

    return result;
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
              ? { article: articleInfo, error: undefined }
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

    const result =
      mode === "async"
        ? await this.getArticleDetailsAsync(identifier, idType, includeFulltext)
        : this.getArticleDetailsSync(identifier, idType, includeFulltext);

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

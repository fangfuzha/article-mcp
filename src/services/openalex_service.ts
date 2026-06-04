/**
 * 封装 OpenAlex Works API，用于文献搜索、DOI 详情查询和施引文献检索。
 */
import { defaultApiClient } from "../utils/api_utils.js";
import {
  addOpenAlexAuthParams,
  getOpenAlexApiKey,
  getOpenAlexMissingApiKeyMessage,
  normalizeDoiIdentifier,
} from "../utils/service_identity.js";
import { stdioSafeLogger } from "../utils/stdio_safe_logger.js";
import { CacheManager, RateLimiter } from "../middleware/index.js";

interface Author {
  display_name: string;
}

interface Authorship {
  author?: Author;
}

interface OpenAccessInfo {
  is_oa: boolean;
  oa_url?: string;
  oa_status?: string;
}

interface PrimaryLocation {
  doi?: string;
  source?: {
    display_name?: string;
  };
}

interface Work {
  title?: string;
  authorships?: Authorship[];
  doi?: string;
  publication_date?: string;
  publication_year?: number;
  primary_location?: PrimaryLocation;
  open_access?: OpenAccessInfo;
  id?: string;
}

type JsonRecord = Record<string, any>;

interface SearchWorkResponse {
  success: boolean;
  articles: JsonRecord[];
  total_count: number;
  source: string;
  error?: string;
}

interface WorkByDoiResponse {
  success: boolean;
  article: JsonRecord | null;
  source: string;
  error?: string;
}

interface CitationsResponse {
  success: boolean;
  citations: JsonRecord[];
  total_count: number;
  source: string;
  error?: string;
  openalex_id?: string;
}

const OPENALEX_WORK_SELECT =
  "id,doi,title,authorships,publication_date,publication_year,primary_location,open_access";

/**
 * OpenAlex 服务类
 */
export class OpenAlexService {
  private baseUrl = "https://api.openalex.org";
  private userAgent = "Article-MCP/2.0";
  private cacheManager: CacheManager;
  private rateLimiter: RateLimiter;

  constructor(private readonly logger: Pick<Console, "error" | "warn"> = stdioSafeLogger) {
    this.cacheManager = new CacheManager();
    this.rateLimiter = new RateLimiter(this.resolveRateLimitDelayMs());
  }

  /**
   * 异步搜索OpenAlex学术文献
   */
  async searchWorksAsync(
    query: string,
    maxResults: number = 10,
    filters?: JsonRecord,
    useCache: boolean = false,
  ): Promise<SearchWorkResponse> {
    const cacheKey = `openalex_search_${query}_${maxResults}`;

    return this.cacheManager.getCachedOrFetch<SearchWorkResponse>(
      cacheKey,
      async () => {
        try {
          if (!this.requireOpenAlexApiKey()) {
            return this.buildMissingApiKeySearchResponse();
          }

          const allArticles: JsonRecord[] = [];
          let totalCount = 0;
          let page = 1;
          const perPage = 200;

          while (allArticles.length < maxResults) {
            const remaining = maxResults - allArticles.length;
            const pageSize = Math.min(perPage, remaining);
            const url = `${this.baseUrl}/works`;
            const params: JsonRecord = addOpenAlexAuthParams({
              search: query,
              per_page: pageSize,
              page,
              select: OPENALEX_WORK_SELECT,
            });

            if (filters) {
              Object.assign(params, filters);
            }

            const headers = {
              "User-Agent": this.userAgent,
              Accept: "application/json",
            };

            const data = await this.openAlexGet<any>(url, params, headers);
            const results = data.results || [];
            totalCount = data.meta?.count || 0;

            if (!results.length) break;

            allArticles.push(...this.formatArticles(results));

            // 如果结果不足一页说明已经是最后一页
            if (results.length < perPage) break;
            page++;
          }

          return {
            success: true,
            articles: allArticles.slice(0, maxResults),
            total_count: totalCount,
            source: "openalex",
          };
        } catch (error) {
          this.logger.error(`OpenAlex异步搜索失败: ${error}`);
          return {
            success: false,
            articles: [],
            total_count: 0,
            source: "openalex",
            error: String(error),
          };
        }
      },
      24,
      useCache,
    );
  }

  /**
   * 异步通过DOI获取文献详情
   */
  async getWorkByDoiAsync(doi: string): Promise<WorkByDoiResponse> {
    try {
      const missingApiKeyMessage = this.missingApiKeyMessage();
      if (missingApiKeyMessage) {
        return {
          success: false,
          article: null,
          source: "openalex",
          error: missingApiKeyMessage,
        };
      }

      const work = await this.fetchWorkByDoiAsync(doi);
      if (work) {
        return {
          success: true,
          article: this.formatSingleArticle(work),
          source: "openalex",
        };
      }

      return {
        success: false,
        article: null,
        source: "openalex",
        error: "未找到相关文献",
      };
    } catch (error) {
      this.logger.error(`OpenAlex获取详情失败: ${error}`);
      return {
        success: false,
        article: null,
        source: "openalex",
        error: String(error),
      };
    }
  }

  /**
   * 过滤开放获取文献（纯数据处理）
   */
  filterOpenAccess(works: Work[]): Work[] {
    return works.filter((work) => work.open_access?.is_oa === true);
  }

  /**
   * 异步获取引用文献（自动分页，支持缓存）。
   */
  async getCitationsAsync(
    doi: string,
    maxResults: number = 20,
    useCache: boolean = false,
  ): Promise<CitationsResponse> {
    const cacheKey = `openalex_citations_${doi}_${maxResults}`;

    return this.cacheManager.getCachedOrFetch<CitationsResponse>(
      cacheKey,
      async () => {
        try {
          const missingApiKeyMessage = this.missingApiKeyMessage();
          if (missingApiKeyMessage) {
            return {
              success: false,
              citations: [],
              total_count: 0,
              source: "openalex",
              error: missingApiKeyMessage,
            };
          }

          const openalex_id = await this.findOpenAlexIdByDoiAsync(doi);
          if (!openalex_id) {
            this.logger.warn(`无法找到DOI ${doi} 对应的OpenAlex ID`);
            return {
              success: false,
              citations: [],
              total_count: 0,
              source: "openalex",
              error: `无法找到DOI ${doi} 对应的OpenAlex ID`,
            };
          }

          const allCitations: JsonRecord[] = [];
          let totalCount = 0;
          let page = 1;
          const perPage = 200;

          while (allCitations.length < maxResults) {
            const remaining = maxResults - allCitations.length;
            const pageSize = Math.min(perPage, remaining);
            const url = `${this.baseUrl}/works`;
            const params = addOpenAlexAuthParams({
              filter: `cites:W${openalex_id}`,
              per_page: pageSize,
              page,
              select: OPENALEX_WORK_SELECT,
            });

            const headers = {
              "User-Agent": this.userAgent,
              Accept: "application/json",
            };

            const data = await this.openAlexGet<any>(url, params, headers);
            const results = data.results || [];
            totalCount = data.meta?.count || 0;

            if (!results.length) break;

            allCitations.push(...this.formatArticles(results));

            if (results.length < perPage) break;
            page++;
          }

          return {
            success: true,
            citations: allCitations.slice(0, maxResults),
            total_count: totalCount,
            source: "openalex",
            openalex_id,
          };
        } catch (error) {
          this.logger.error(`OpenAlex获取引用文献失败: ${error}`);
          return {
            success: false,
            citations: [],
            total_count: 0,
            source: "openalex",
            error: String(error),
          };
        }
      },
      24,
      useCache,
    );
  }

  /**
   * 异步通过DOI查找OpenAlex Work ID
   */
  private async findOpenAlexIdByDoiAsync(doi: string): Promise<string | null> {
    try {
      const work = await this.fetchWorkByDoiAsync(doi, "id");
      const openalex_url = work?.id || "";
      return openalex_url.match(/\/W([^/?#]+)/)?.[1] ?? null;
    } catch (error) {
      this.logger.error(`通过DOI查找OpenAlex ID失败: ${error}`);
      return null;
    }
  }

  private async fetchWorkByDoiAsync(
    doi: string,
    select = OPENALEX_WORK_SELECT,
  ): Promise<Work | null> {
    const normalizedDoi = this.normalizeDoiForOpenAlex(doi);
    if (!normalizedDoi) {
      return null;
    }

    const url = `${this.baseUrl}/works/${normalizedDoi}`;
    const headers = {
      "User-Agent": this.userAgent,
      Accept: "application/json",
    };
    return this.openAlexGet<Work>(url, addOpenAlexAuthParams({ select }), headers);
  }

  private resolveRateLimitDelayMs(): number {
    const configured = Number(process.env.OPENALEX_RATE_LIMIT_MS);
    if (Number.isFinite(configured) && configured >= 0) {
      return configured;
    }

    return process.env.NODE_ENV === "test" ? 0 : 100;
  }

  private missingApiKeyMessage(): string | null {
    if (getOpenAlexApiKey()) {
      return null;
    }

    const message = getOpenAlexMissingApiKeyMessage();
    this.logger.warn(message);
    return message;
  }

  private requireOpenAlexApiKey(): boolean {
    return this.missingApiKeyMessage() === null;
  }

  private buildMissingApiKeySearchResponse(): SearchWorkResponse {
    return {
      success: false,
      articles: [],
      total_count: 0,
      source: "openalex",
      error: getOpenAlexMissingApiKeyMessage(),
    };
  }

  private async openAlexGet<T>(
    url: string,
    params?: Record<string, unknown>,
    headers?: Record<string, string>,
  ): Promise<T> {
    return this.rateLimiter.schedule(() => defaultApiClient.get<T>(url, params, headers));
  }

  private normalizeDoiForOpenAlex(doi: string): string {
    const trimmed = doi.trim();
    if (!trimmed) {
      return "";
    }

    const normalizedDoi = normalizeDoiIdentifier(trimmed);
    return normalizedDoi ? `https://doi.org/${normalizedDoi}` : "";
  }

  /**
   * 格式化文章列表（纯数据处理）
   */
  private formatArticles(items: Work[]): JsonRecord[] {
    return items.map((item) => this.formatSingleArticle(item));
  }

  /**
   * 格式化单篇文章（纯数据处理）
   */
  private formatSingleArticle(item: Work): JsonRecord {
    const authors: string[] = [];
    const authorships = item.authorships || [];
    for (const authorship of authorships) {
      const author = authorship?.author;
      if (author?.display_name) {
        authors.push(author.display_name);
      }
    }

    const primary_location = item.primary_location || ({} as PrimaryLocation);
    const source = primary_location.source || ({} as { display_name?: string });
    const open_access = item.open_access || ({} as OpenAccessInfo);

    return {
      title: item.title || "",
      authors,
      doi: item.doi || primary_location.doi,
      journal: source.display_name || "",
      publication_date: item.publication_date || String(item.publication_year || ""),
      open_access: {
        is_oa: open_access.is_oa || false,
        oa_url: open_access.oa_url || "",
        oa_status: open_access.oa_status || "",
      },
      source: "openalex",
      raw_data: item,
    };
  }
}

// @ts-nocheck
/**
 * OpenAlex API 服务 - 纯异步实现
 */

import { defaultApiClient } from "../utils/api_utils";

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
  publication_year?: number;
  primary_location?: PrimaryLocation;
  open_access?: OpenAccessInfo;
  id?: string;
}

interface SearchWorkResponse {
  success: boolean;
  articles: Record<string, any>[];
  total_count: number;
  source: string;
  error?: string;
}

interface WorkByDoiResponse {
  success: boolean;
  article: Record<string, any> | null;
  source: string;
  error?: string;
}

interface CitationsResponse {
  success: boolean;
  citations: Record<string, any>[];
  total_count: number;
  source: string;
  error?: string;
  openalex_id?: string;
}

/**
 * OpenAlex 服务类
 */
export class OpenAlexService {
  private baseUrl = "https://api.openalex.org";
  private userAgent = "Article-MCP/2.0-Async (mailto:user@example.com)";

  /**
   * 异步搜索OpenAlex学术文献
   */
  async searchWorksAsync(
    query: string,
    maxResults: number = 10,
    filters?: Record<string, any>,
  ): Promise<SearchWorkResponse> {
    try {
      const url = `${this.baseUrl}/works`;
      const params: Record<string, any> = {
        search: query,
        "per-page": maxResults,
        select: "id,title,authorships,publication_year,primary_location,open_access",
      };

      if (filters) {
        Object.assign(params, filters);
      }

      const headers = {
        "User-Agent": this.userAgent,
        Accept: "application/json",
      };

      const data = await defaultApiClient.get(url, params, headers);

      return {
        success: true,
        articles: this.formatArticles(data.results || []),
        total_count: data.meta?.count || 0,
        source: "openalex",
      };
    } catch (error) {
      console.error(`OpenAlex异步搜索失败: ${error}`);
      return {
        success: false,
        articles: [],
        total_count: 0,
        source: "openalex",
        error: String(error),
      };
    }
  }

  /**
   * 异步通过DOI获取文献详情
   */
  async getWorkByDoiAsync(doi: string): Promise<WorkByDoiResponse> {
    try {
      const url = `${this.baseUrl}/works`;
      const params = {
        filter: `doi:${doi}`,
        select: "id,title,authorships,publication_year,primary_location,open_access",
      };

      const headers = {
        "User-Agent": this.userAgent,
        Accept: "application/json",
      };

      const data = await defaultApiClient.get(url, params, headers);
      const results = data.results || [];

      if (results.length > 0) {
        return {
          success: true,
          article: this.formatSingleArticle(results[0]),
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
      console.error(`OpenAlex获取详情失败: ${error}`);
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
  filterOpenAccess(works: Record<string, any>[]): Record<string, any>[] {
    return works.filter((work) => work.open_access?.is_oa === true);
  }

  /**
   * 异步获取引用文献
   */
  async getCitationsAsync(doi: string, maxResults: number = 20): Promise<CitationsResponse> {
    try {
      const openalex_id = await this.findOpenAlexIdByDoiAsync(doi);
      if (!openalex_id) {
        console.warn(`无法找到DOI ${doi} 对应的OpenAlex ID`);
        return {
          success: false,
          citations: [],
          total_count: 0,
          source: "openalex",
          error: `无法找到DOI ${doi} 对应的OpenAlex ID`,
        };
      }

      const url = `${this.baseUrl}/works`;
      const params = {
        filter: `cites:W${openalex_id}`,
        "per-page": maxResults,
        select: "id,title,authorships,publication_year,primary_location,doi",
      };

      const headers = {
        "User-Agent": this.userAgent,
        Accept: "application/json",
      };

      const data = await defaultApiClient.get(url, params, headers);
      const citations = data.results || [];

      return {
        success: true,
        citations: this.formatArticles(citations),
        total_count: citations.length,
        source: "openalex",
        openalex_id,
      };
    } catch (error) {
      console.error(`OpenAlex获取引用文献失败: ${error}`);
      return {
        success: false,
        citations: [],
        total_count: 0,
        source: "openalex",
        error: String(error),
      };
    }
  }

  /**
   * 异步通过DOI查找OpenAlex Work ID
   */
  private async findOpenAlexIdByDoiAsync(doi: string): Promise<string | null> {
    try {
      const url = `${this.baseUrl}/works`;
      const params = {
        filter: `doi:${doi}`,
        select: "id",
        "per-page": 1,
      };

      const headers = {
        "User-Agent": this.userAgent,
        Accept: "application/json",
      };

      const data = await defaultApiClient.get(url, params, headers);
      const results = data.results || [];

      if (results.length > 0) {
        const openalex_url = results[0].id || "";
        if (openalex_url && openalex_url.includes("/W")) {
          return openalex_url.split("/W")[1].split("?")[0];
        }
      }

      return null;
    } catch (error) {
      console.error(`通过DOI查找OpenAlex ID失败: ${error}`);
      return null;
    }
  }

  /**
   * 格式化文章列表（纯数据处理）
   */
  private formatArticles(items: Work[]): Record<string, any>[] {
    return items.map((item) => this.formatSingleArticle(item));
  }

  /**
   * 格式化单篇文章（纯数据处理）
   */
  private formatSingleArticle(item: Work): Record<string, any> {
    const authors: string[] = [];
    const authorships = item.authorships || [];
    for (const authorship of authorships) {
      const author = authorship?.author;
      if (author?.display_name) {
        authors.push(author.display_name);
      }
    }

    const primary_location = item.primary_location || {};
    const source = primary_location.source || {};
    const open_access = item.open_access || {};

    return {
      title: item.title || "",
      authors,
      doi: primary_location.doi,
      journal: source.display_name || "",
      publication_date: String(item.publication_year || ""),
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


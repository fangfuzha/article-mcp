/**
 * 封装 Crossref API 的 DOI 解析、元数据查询与参考文献获取。
 */
type JsonValue = any;

import { defaultApiClient } from "../utils/api_utils.js";
import { CacheManager } from "../middleware/index.js";

/**
 * CrossRef 服务类
 */
export class CrossRefService {
  private baseUrl = "https://api.crossref.org";
  private cacheManager: CacheManager;

  constructor() {
    this.cacheManager = new CacheManager();
  }

  /**
   * 格式化单篇文章
   */
  private formatSingleArticle(item: Record<string, JsonValue>): Record<string, JsonValue> {
    const title = this.extractTitle(item.title || []);
    const authors = this.extractAuthors(item.author || []);

    return {
      title,
      authors,
      doi: item.DOI,
      journal: item["short-container-title"]
        ? Array.isArray(item["short-container-title"])
          ? item["short-container-title"][0]
          : item["short-container-title"]
        : "",
      publication_date: item.created?.["date-time"] || "",
      source: "crossref",
      raw_data: item,
    };
  }

  /**
   * 格式化文章列表
   */
  private formatArticles(items: Record<string, JsonValue>[]): Record<string, JsonValue>[] {
    return items.map((item) => this.formatSingleArticle(item));
  }

  /**
   * 提取标题
   */
  private extractTitle(titleList: unknown[]): string {
    return titleList && titleList.length > 0 ? String(titleList[0]) : "";
  }

  /**
   * 提取作者
   */
  private extractAuthors(authorList: Record<string, JsonValue>[]): string[] {
    const authors: string[] = [];
    for (const author of authorList || []) {
      if (!author) continue;
      if (author.given && author.family) {
        authors.push(`${author.given} ${author.family}`);
      } else if (author.name) {
        authors.push(author.name);
      }
    }
    return authors;
  }

  /**
   * 提取参考文献的作者
   */
  private extractRefAuthors(ref: Record<string, JsonValue>): string[] {
    const authors: string[] = [];
    const authorList = ref.author;
    if (Array.isArray(authorList)) {
      for (const author of authorList) {
        if (typeof author === "object") {
          if (author.given && author.family) {
            authors.push(`${author.given} ${author.family}`);
          } else if (author.family) {
            authors.push(author.family);
          } else if (author.name) {
            authors.push(author.name);
          }
        }
      }
    }
    return authors;
  }

  /**
   * 提取参考文献的年份
   */
  private extractRefYear(ref: Record<string, JsonValue>): string {
    if (ref.year) {
      return String(ref.year);
    }

    if (ref.created?.["date-parts"]?.[0]?.[0]) {
      return String(ref.created["date-parts"][0][0]);
    }

    if (ref.published?.["date-parts"]?.[0]?.[0]) {
      return String(ref.published["date-parts"][0][0]);
    }

    if (ref["published-print"]?.["date-parts"]?.[0]?.[0]) {
      return String(ref["published-print"]["date-parts"][0][0]);
    }

    return "";
  }

  /**
   * 格式化参考文献
   */
  private formatReferences(references: Record<string, any>[]): Record<string, any>[] {
    const formattedRefs: Record<string, any>[] = [];

    for (const ref of references || []) {
      if (!ref) continue;

      const formattedRef: Record<string, any> = {
        doi: ref.DOI,
        title: ref.unstructured || "",
        authors: this.extractRefAuthors(ref),
        year: this.extractRefYear(ref),
        journal: ref["journal-title"] || "",
        volume: ref.volume,
        issue: ref.issue,
        page: ref["first-page"],
        source: "crossref",
      };

      if (!formattedRef.title && ref["article-title"]) {
        formattedRef.title = ref["article-title"];
      }

      formattedRefs.push(formattedRef);
    }

    return formattedRefs;
  }

  /**
   * 异步搜索 CrossRef 学术文献
   */
  public async searchWorksAsync(
    query: string,
    maxResults: number = 10,
    useCache: boolean = true,
  ): Promise<Record<string, any>> {
    const cacheKey = `crossref_search_${query}_${maxResults}`;

    return this.cacheManager.getCachedOrFetch(
      cacheKey,
      async () => {
        try {
          const url = `${this.baseUrl}/works`;
          const params = {
            query,
            rows: maxResults,
            select: "title,author,DOI,created,member,short-container-title",
          };

          const data = await defaultApiClient.getJson<any>(url, params);
          const message = data.message || {};

          return {
            success: true,
            articles: this.formatArticles(message.items || []),
            total_count: message["total-results"] || 0,
            source: "crossref",
          };
        } catch (error: any) {
          console.error(`CrossRef 异步搜索失败: ${error.message}`);
          return {
            success: false,
            articles: [],
            total_count: 0,
            source: "crossref",
            error: error.message,
          };
        }
      },
      24,
      useCache,
    );
  }

  /**
   * 异步通过 DOI 获取文献详情
   */
  public async getWorkByDoiAsync(doi: string): Promise<Record<string, JsonValue>> {
    const cacheKey = `crossref_doi_${doi}`;

    return this.cacheManager.getCachedOrFetch(
      cacheKey,
      async () => {
        try {
          const encodedDoi = encodeURIComponent(doi).replace(/%2F/g, "/");
          const url = `${this.baseUrl}/works/${encodedDoi}`;

          const data = await defaultApiClient.getJson<any>(url);
          const article = data.message || {};

          return {
            success: true,
            article: this.formatSingleArticle(article),
            source: "crossref",
          };
        } catch (error: any) {
          console.error(`CrossRef 获取详情失败: ${error.message}`);
          return {
            success: false,
            article: null,
            source: "crossref",
            error: error.message,
          };
        }
      },
      24,
    );
  }

  /**
   * 异步获取参考文献列表
   */
  public async getReferencesAsync(
    doi: string,
    maxResults: number = 20,
  ): Promise<Record<string, any>> {
    const cacheKey = `crossref_references_${doi}_${maxResults}`;

    return this.cacheManager.getCachedOrFetch(
      cacheKey,
      async () => {
        try {
          const encodedDoi = encodeURIComponent(doi).replace(/%2F/g, "/");
          const url = `${this.baseUrl}/works/${encodedDoi}`;

          const data = await defaultApiClient.getJson<any>(url);
          const workData = data.message || {};
          const references = workData.reference || [];

          return {
            success: true,
            references: this.formatReferences(references.slice(0, maxResults)),
            total_count: references.length,
            source: "crossref",
          };
        } catch (error: any) {
          console.error(`CrossRef 获取参考文献失败: ${error.message}`);
          return {
            success: false,
            references: [],
            total_count: 0,
            source: "crossref",
            error: error.message,
          };
        }
      },
      24,
    );
  }
}

export const crossRefService = new CrossRefService();

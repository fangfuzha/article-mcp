// @ts-nocheck
/**
 * arXiv 文献搜索服务
 * 基于 arXiv API 的学术文献搜索功能
 */

import axios, { AxiosInstance } from "axios";
import axiosRetry from "axios-retry";
import { parseISO, format } from "date-fns";
import { XMLParser } from "fast-xml-parser";
import { CacheManager, RateLimiter } from "../middleware/index.js";

// Atom feed namespace
const ATOM_NS = "http://www.w3.org/2005/Atom";

/**
 * arXiv 搜索服务类
 */
export class ArxivSearchService {
  private session: AxiosInstance;
  private cacheManager: CacheManager;
  private rateLimiter: RateLimiter;
  private parser: XMLParser;
  private baseUrl = "http://export.arxiv.org/api/query?";

  constructor() {
    this.session = this.createRetrySession();
    this.cacheManager = new CacheManager();
    this.rateLimiter = new RateLimiter(1000); // 1秒延迟
    this.parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
    });
  }

  /**
   * 创建带重试策略的 axios 实例
   */
  private createRetrySession(): AxiosInstance {
    const instance = axios.create({
      timeout: 45000,
      headers: {
        "User-Agent": "Article-MCP/2.0",
        Accept: "application/atom+xml",
        "Accept-Encoding": "gzip, deflate",
      },
    });

    axiosRetry(instance, {
      retries: 5,
      retryDelay: (retryCount) => {
        return retryCount * 1000; // 指数退避
      },
      retryCondition: (error) => {
        return (
          axiosRetry.isNetworkOrIdempotentRequestError(error) ||
          (error.response && [429, 500, 502, 503, 504].includes(error.response.status))
        );
      },
    });

    return instance;
  }

  /**
   * 解析日期字符串
   */
  private parseDate(dateStr: string): Date {
    const direct = new Date(dateStr);
    if (!Number.isNaN(direct.getTime())) {
      return direct;
    }

    const compact = dateStr.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (compact) {
      const parsed = new Date(`${compact[1]}-${compact[2]}-${compact[3]}`);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed;
      }
    }

    throw new Error(`无法解析日期格式: ${dateStr}`);
  }

  /**
   * 处理单个 arXiv 条目
   */
  private processArxivEntry(entry: any): Record<string, any> | null {
    try {
      const xmlObj = entry as any;

      // 提取 arXiv ID
      const entryId = xmlObj[`${ATOM_NS}id`] || "";
      const arxivId = entryId.includes("/abs/") ? entryId.split("/abs/")[1] : "N/A";

      // 获取摘要页链接
      const links = xmlObj[`${ATOM_NS}link`] || [];
      const htmlLink = Array.isArray(links)
        ? links.find((l: any) => l["@_rel"] === "alternate" && l["@_type"] === "text/html")
        : links["@_rel"] === "alternate" && links["@_type"] === "text/html"
          ? links
          : null;

      const link = htmlLink?.["@_href"] || entryId;

      // 提取标题
      const title = (xmlObj[`${ATOM_NS}title`] || "无标题").trim();

      // 提取作者
      const authorElems = xmlObj[`${ATOM_NS}author`] || [];
      const authors = (Array.isArray(authorElems) ? authorElems : [authorElems])
        .map((author: any) => (author[`${ATOM_NS}name`] || "").trim())
        .filter((name: string) => name);

      // 提取发表日期
      const publishedStr = xmlObj[`${ATOM_NS}published`];
      let publicationDate = "日期未知";
      if (publishedStr) {
        try {
          const pubDate = parseISO(publishedStr);
          publicationDate = format(pubDate, "yyyy-MM-dd");
        } catch {
          console.warn(`无法解析发表日期: ${publishedStr}`);
        }
      }

      // 提取摘要
      const summary = (xmlObj[`${ATOM_NS}summary`] || "无摘要").trim();

      // 提取 arXiv 分类
      const primaryCategory = xmlObj["arxiv:primary_category"]?.["@_term"] || "N/A";

      // 提取 PDF 链接
      const pdfLink = Array.isArray(links)
        ? links.find((l: any) => l["@_title"] === "pdf")?.["@_href"]
        : htmlLink?.["@_href"];

      return {
        arxiv_id: arxivId,
        title,
        authors,
        category: primaryCategory,
        publication_date: publicationDate,
        abstract: summary,
        arxiv_link: link,
        pdf_link: pdfLink || null,
      };
    } catch (error) {
      console.warn(`处理 arXiv 条目时发生错误: ${error}`);
      return null;
    }
  }

  /**
   * 搜索 arXiv 文献数据库
   * @param keyword 搜索关键词
   * @param email 联系邮箱（可选）
   * @param startDate 开始日期，格式：YYYY-MM-DD
   * @param endDate 结束日期，格式：YYYY-MM-DD
   * @param maxResults 最大返回结果数量，默认10
   * @returns 包含搜索结果的对象
   */
  public async search(params: {
    keyword: string;
    email?: string;
    start_date?: string;
    end_date?: string;
    max_results?: number;
    use_cache?: boolean;
  }): Promise<Record<string, any>> {
    const { keyword, email, start_date, end_date, max_results = 10, use_cache = true } = params;

    // 验证关键词
    if (!keyword || !keyword.trim()) {
      return {
        articles: [],
        total_count: 0,
        message: "关键词不能为空",
        error: "关键词不能为空",
      };
    }

    // 验证最大结果数
    if (!Number.isInteger(max_results) || max_results < 1) {
      return {
        articles: [],
        total_count: 0,
        message: "max_results必须为大于等于1的整数",
        error: "max_results必须为大于等于1的整数",
      };
    }

    const cacheKey = `arxiv_${keyword}_${start_date}_${end_date}_${max_results}`;

    return this.cacheManager.getCachedOrFetch(
      cacheKey,
      async () => {
        return this.rateLimiter.schedule(async () => {
          try {
            // 构建基础查询
            const searchQueryParts: string[] = [`all:${keyword.trim()}`];

            // 处理日期参数
            if (start_date || end_date) {
              try {
                const endDt = end_date ? this.parseDate(end_date) : new Date();
                const startDt = start_date
                  ? this.parseDate(start_date)
                  : new Date(endDt.getFullYear() - 3, endDt.getMonth(), endDt.getDate());

                if (startDt > endDt) {
                  return {
                    articles: [],
                    total_count: 0,
                    message: "起始时间不能晚于终止时间",
                    error: "起始时间不能晚于终止时间",
                  };
                }

                // 格式化为arXiv日期范围查询条件
                const startStr = format(startDt, "yyyyMMdd") + "0000";
                const endStr = format(endDt, "yyyyMMdd") + "2359";
                const dateFilter = `submittedDate:[${startStr} TO ${endStr}]`;
                searchQueryParts.push(dateFilter);
              } catch (error: any) {
                return {
                  articles: [],
                  total_count: 0,
                  message: `日期参数错误: ${error.message}`,
                  error: `日期参数错误: ${error.message}`,
                };
              }
            }

            // 组合查询字符串
            const fullQuery = searchQueryParts.join(" AND ");
            const encodedQuery = encodeURIComponent(fullQuery);

            const articles: Record<string, any>[] = [];
            let startIndex = 0;
            const resultsPerPage = Math.min(100, max_results);

            console.log(`开始搜索 arXiv: ${keyword}`);

            while (articles.length < max_results) {
              const numToFetch = Math.min(resultsPerPage, max_results - articles.length);
              if (numToFetch <= 0) break;

              const url =
                `${this.baseUrl}search_query=${encodedQuery}` +
                `&start=${startIndex}` +
                `&max_results=${numToFetch}` +
                `&sortBy=submittedDate&sortOrder=descending`;

              const headers = {
                "User-Agent": email ? `Article-MCP/2.0 (contact: ${email})` : "Article-MCP/2.0",
              };

              try {
                const response = await this.session.get(url, { headers });

                const contentType = response.headers["content-type"] || "";
                if (!contentType.includes("application/atom+xml")) {
                  console.error(`意外的响应内容类型: ${contentType}`);
                  return {
                    articles: [],
                    total_count: 0,
                    message: "arXiv API 返回了非预期的内容",
                    error: "arXiv API 返回了非预期的内容",
                  };
                }

                const xmlData = this.parser.parse(response.data);

                const entries = xmlData?.feed?.entry || [];
                const entryArray = Array.isArray(entries) ? entries : [entries];

                if (!entryArray || entryArray.length === 0) {
                  console.info("arXiv API 返回了空结果页，停止获取");
                  break;
                }

                for (const entry of entryArray) {
                  if (articles.length >= max_results) break;
                  const articleInfo = this.processArxivEntry(entry);
                  if (articleInfo) {
                    articles.push(articleInfo);
                  }
                }

                startIndex += entryArray.length;

                if (entryArray.length < numToFetch) {
                  console.info("获取到的结果数少于请求数，认为是最后一页");
                  break;
                }
              } catch (error: any) {
                if (error.code === "ECONNABORTED" || error.message.includes("timeout")) {
                  return {
                    articles: [],
                    total_count: 0,
                    message: "请求 arXiv API 超时",
                    error: "请求 arXiv API 超时",
                  };
                }
                throw error;
              }
            }

            console.log(`成功获取 ${articles.length} 篇 arXiv 文献`);

            return {
              articles,
              total_count: articles.length,
              message:
                articles.length > 0
                  ? `找到 ${articles.length} 篇相关文献`
                  : "未找到与查询匹配的相关文献",
              error: null,
              search_info: {
                keyword,
                date_range: start_date || end_date ? `${start_date} 到 ${end_date}` : "无日期限制",
                max_results,
              },
            };
          } catch (error: any) {
            console.error(`arXiv 搜索失败: ${error.message}`);
            return {
              articles: [],
              total_count: 0,
              message: `网络请求错误: ${error.message}`,
              error: `网络请求错误: ${error.message}`,
            };
          }
        });
      },
      24,
      use_cache,
    );
  }
}

export const arxivSearchService = new ArxivSearchService();

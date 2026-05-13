/**
 * 文献基础数据模型。
 *
 * 字段名沿用 Python 版和 MCP 工具对外契约中的 snake_case 表示。
 */
export type ArticleInfo = {
  pmid?: string | null;
  pmid_link?: string;
  title: string;
  authors: string[];
  journal_name: string;
  publication_date: string;
  abstract: string;
  doi?: string;
  doi_link?: string;
  pmcid?: string;
  pmc_id?: string;
  pmc_link?: string;
  arxiv_id?: string;
  arxiv_link?: string;
  semantic_scholar_id?: string;
  semantic_scholar_link?: string;
  cache_hit?: boolean;
};

/**
 * 文献搜索结果模型。
 */
export type ArticleSearchResult = {
  articles: ArticleInfo[];
  total_count?: number;
  error?: string;
  message?: string;
  processing_time?: number;
  cache_hit?: boolean;
};

/**
 * 文献详情结果模型。
 */
export type ArticleDetailsResult = {
  article: ArticleInfo | null;
  error?: string;
};

/**
 * 引用本文的文章查询结果。
 */
export type CitingArticlesResult = {
  citing_articles: ArticleInfo[];
  total_count?: number;
  error?: string;
  message?: string;
  processing_time?: number;
};

/**
 * 相似文章查询结果。
 */
export type SimilarArticlesResult = {
  original_article?: ArticleInfo | null;
  similar_articles: ArticleInfo[];
  total_similar_count?: number;
  retrieved_count?: number;
  error?: string;
  message?: string;
};

/**
 * PMC 全文获取结果。
 */
export type FulltextResult = {
  pmc_id: string | null;
  fulltext_xml?: string;
  fulltext_markdown?: string;
  fulltext_text?: string;
  fulltext_available: boolean;
  sections_requested?: string[];
  sections_found?: string[];
  sections_missing?: string[];
  error?: string;
};

/**
 * 定义期刊质量、排名、OpenAlex 指标和缓存条目类型。
 */
export type QualityMetrics = {
  [key: string]: unknown;
  impact_factor?: number;
  five_year_impact_factor?: number;
  quartile?: string;
  jci?: string;
  cas_zone?: string;
  cas_zone_base?: string;
  cas_zone_small?: string;
  cas_zone_top?: string;
};

/**
 * 期刊排名信息。
 */
export type RankingInfo = {
  rank_in_category: number;
  total_journals_in_category: number;
  percentile: number;
  assessment_method: string;
  confidence: string;
};

/**
 * EasyScholar 期刊质量响应。
 */
export type JournalQualityResponse = {
  success: boolean;
  journal_name: string;
  quality_metrics: QualityMetrics;
  ranking_info: RankingInfo;
  data_source: string | null;
  error?: string;
};

/**
 * OpenAlex 期刊指标补充结果。
 */
export type OpenAlexJournalMetrics = {
  h_index?: number;
  citation_rate?: number;
  cited_by_count?: number;
  works_count?: number;
  i10_index?: number;
  source: "openalex";
};

/**
 * 期刊质量文件缓存条目。
 */
export type JournalQualityCacheEntry = {
  timestamp: number;
  data: Record<string, unknown>;
  openalexMetrics?: Record<string, unknown>;
};

/**
 * 通过 OpenAlex 获取期刊层面的引用、开放获取和主题指标。
 */
import { CacheManager } from "../middleware/index.js";
import type { OpenAlexJournalMetrics } from "../types/journals.js";
import { defaultApiClient } from "../utils/api_utils.js";
import { addOpenAlexAuthParams } from "../utils/service_identity.js";
import { stdioSafeLogger } from "../utils/stdio_safe_logger.js";

/**
 * OpenAlex 期刊指标补充服务。
 */
export class OpenAlexMetricsService {
  private readonly baseUrl = "https://api.openalex.org/sources";
  private readonly cacheManager = new CacheManager();

  constructor(private readonly logger: Pick<Console, "error" | "warn"> = stdioSafeLogger) {}

  /**
   * 获取单个期刊的 OpenAlex 指标。
   *
   * @param journalName 期刊名称。
   * @param useCache 是否使用 24 小时缓存。
   * @returns 期刊指标或 null。
   */
  public async getJournalMetrics(
    journalName: string,
    useCache = true,
  ): Promise<OpenAlexJournalMetrics | null> {
    const trimmedName = journalName.trim();
    if (!trimmedName) {
      return null;
    }

    const fetchMetrics = async (): Promise<OpenAlexJournalMetrics | null> => {
      const data = await defaultApiClient.getJson<any>(
        this.baseUrl,
        addOpenAlexAuthParams({
          search: trimmedName,
          filter: "type:journal",
          per_page: 5,
          select:
            "id,display_name,alternate_titles,issn_l,issn,summary_stats,cited_by_count,works_count,type",
        }),
      );

      const source = this.selectBestSource(data?.results || [], trimmedName);
      if (!source) {
        return null;
      }

      const summaryStats = source.summary_stats || {};
      return {
        h_index: summaryStats.h_index,
        citation_rate: summaryStats["2yr_mean_citedness"],
        cited_by_count: source.cited_by_count,
        works_count: source.works_count,
        i10_index: summaryStats.i10_index,
        source: "openalex",
      };
    };

    if (!useCache) {
      return fetchMetrics();
    }

    return this.cacheManager.getCachedOrFetch(
      `openalex_metrics_${trimmedName.toLowerCase()}`,
      fetchMetrics,
      24,
    );
  }

  private selectBestSource(sources: any[], journalName: string): any | null {
    if (!Array.isArray(sources) || !sources.length) {
      return null;
    }

    const normalizedJournalName = this.normalizeSourceName(journalName);
    return (
      sources.find(
        (source) => this.normalizeSourceName(source?.display_name) === normalizedJournalName,
      ) ??
      sources.find((source) =>
        (source?.alternate_titles || []).some(
          (title: unknown) => this.normalizeSourceName(title) === normalizedJournalName,
        ),
      ) ??
      sources[0]
    );
  }

  private normalizeSourceName(value: unknown): string {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/&/g, "and")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * 批量获取期刊指标。
   *
   * @param journalNames 期刊名称列表。
   * @param useCache 是否使用缓存。
   * @returns 指标列表。
   */
  public async batchGetJournalMetrics(
    journalNames: string[],
    useCache = true,
  ): Promise<Array<OpenAlexJournalMetrics | null>> {
    return Promise.all(
      journalNames.map((journalName) => this.getJournalMetrics(journalName, useCache)),
    );
  }
}

/**
 * 创建默认 OpenAlex 指标服务实例。
 *
 * @returns 新的 OpenAlexMetricsService。
 */
export function createOpenAlexMetricsService(): OpenAlexMetricsService {
  return new OpenAlexMetricsService();
}

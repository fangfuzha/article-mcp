/**
 * 对接 EasyScholar 接口以获取期刊分区、影响因子等质量指标。
 */
import axios, { AxiosError } from "axios";

import type { JournalQualityResponse, QualityMetrics, RankingInfo } from "../types/journals.js";

interface ApiResponse {
  code: number;
  msg: string;
  data?: {
    officialRank?: {
      all?: Record<string, unknown>;
    };
  };
}

/**
 * EasyScholar API 服务类
 */
export class EasyScholarService {
  private apiUrl = "https://www.easyscholar.cc/open/getPublicationRank";
  private apiKey: string | undefined;
  private timeout: number;
  private requestTimes: number[] = [];

  private readonly RATE_LIMIT_PER_SECOND = 2;

  private readonly FIELD_MAPPING: Record<string, string> = {
    sciif: "impact_factor",
    sci: "quartile",
    jci: "jci",
    sciUp: "cas_zone",
    sciBase: "cas_zone_base",
    sciUpSmall: "cas_zone_small",
    sciUpTop: "cas_zone_top",
  };

  constructor(
    timeout: number = 30,
    private readonly logger: Pick<Console, "error" | "warn"> = console,
  ) {
    this.timeout = timeout;
    this.apiKey = process.env.EASYSCHOLAR_SECRET_KEY;

    if (this.apiKey) {
      this.logger.error("EasyScholar API 密钥已配置");
    } else {
      this.logger.warn("EASYSCHOLAR_SECRET_KEY 未设置");
    }
  }

  /**
   * 获取期刊质量信息
   *
   * @param journal_name - 期刊名称
   * @param timeout - 请求超时时间（秒）
   * @returns 包含期刊质量指标的字典
   */
  async getJournalQuality(journal_name: string, timeout?: number): Promise<JournalQualityResponse> {
    if (!journal_name || !journal_name.trim()) {
      return {
        success: false,
        error: "期刊名称不能为空",
        journal_name,
        quality_metrics: {},
        ranking_info: {} as RankingInfo,
        data_source: null,
      };
    }

    if (!this.apiKey) {
      return {
        success: false,
        error:
          "EASYSCHOLAR_SECRET_KEY 环境变量未设置。请访问 https://www.easyscholar.cc 获取密钥，然后设置环境变量：export EASYSCHOLAR_SECRET_KEY=your_key_here",
        journal_name,
        quality_metrics: {},
        ranking_info: {} as RankingInfo,
        data_source: null,
      };
    }

    try {
      const result = await this.makeRequest(journal_name.trim());
      return result;
    } catch (error) {
      if (error instanceof Error && error.message.includes("timeout")) {
        return {
          success: false,
          error: `请求超时：超过 ${timeout || this.timeout} 秒未响应`,
          journal_name,
          quality_metrics: {},
          ranking_info: {} as RankingInfo,
          data_source: null,
        };
      }

      return {
        success: false,
        error: `未知错误: ${error instanceof Error ? error.message : String(error)}`,
        journal_name,
        quality_metrics: {},
        ranking_info: {} as RankingInfo,
        data_source: null,
      };
    }
  }

  /**
   * 批量获取期刊质量信息
   *
   * 注意：遵循速率限制，每秒最多2次请求
   *
   * @param journal_names - 期刊名称列表
   * @returns 期刊质量信息列表
   */
  async batchGetJournalQuality(journal_names: string[]): Promise<JournalQualityResponse[]> {
    const results: JournalQualityResponse[] = [];
    for (const journal_name of journal_names) {
      const result = await this.getJournalQuality(journal_name);
      results.push(result);
      // 速率限制：每次请求间隔 0.5 秒（每秒最多2次）
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return results;
  }

  /**
   * 发起 EasyScholar API 请求
   *
   * 官方 API 文档: https://www.easyscholar.cc/open/getPublicationRank
   *
   * @param journal_name - 期刊名称
   * @returns 包含期刊质量指标的字典
   */
  private async makeRequest(journal_name: string): Promise<JournalQualityResponse> {
    await this.enforceRateLimit();

    const params = {
      secretKey: this.apiKey,
      publicationName: journal_name,
    };

    const headers = {
      "User-Agent": "ArticleMCP/2.0",
    };

    try {
      const response = await axios.get<ApiResponse>(this.apiUrl, {
        params,
        headers,
        timeout: this.timeout * 1000,
      });

      const data = response.data;

      if (data.code !== 200) {
        const error_msg = data.msg || "未知错误";
        throw new Error(`API 错误: ${error_msg} (code: ${data.code})`);
      }

      return this.parseApiResponse(journal_name, data);
    } catch (error) {
      if (error instanceof AxiosError) {
        if (error.response?.status) {
          throw new Error(`API 返回状态码: ${error.response.status}`);
        }
        throw new Error(`网络请求失败: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * 解析 EasyScholar API 响应数据
   *
   * @param journal_name - 期刊名称
   * @param api_data - API 返回的原始数据
   * @returns 标准化的期刊质量数据
   */
  private parseApiResponse(journal_name: string, api_data: ApiResponse): JournalQualityResponse {
    const data = api_data.data || {};
    const official_rank = data.officialRank || {};
    const all_rank = official_rank.all || {};

    const quality_metrics: QualityMetrics = {};

    for (const [api_field, internal_field] of Object.entries(this.FIELD_MAPPING)) {
      if (api_field in all_rank) {
        let value: unknown = all_rank[api_field];

        if (internal_field === "impact_factor" && value != null) {
          const parsed = parseFloat(String(value));
          value = Number.isNaN(parsed) ? null : parsed;
        }

        if (value !== null && value !== undefined) {
          quality_metrics[internal_field] = value;
        }
      }
    }

    if (Object.keys(quality_metrics).length === 0) {
      return {
        success: false,
        error: `未找到期刊 '${journal_name}' 的质量信息`,
        journal_name,
        quality_metrics: {},
        ranking_info: {} as RankingInfo,
        data_source: null,
      };
    }

    if ("cas_zone" in quality_metrics) {
      quality_metrics.cas_zone = this.convertCasZone(quality_metrics.cas_zone as string);
    }

    const ranking_info = this.calculateRankingInfo(journal_name, quality_metrics);

    return {
      success: true,
      journal_name,
      quality_metrics,
      ranking_info,
      data_source: "easyscholar_api",
    };
  }

  /**
   * 强制执行速率限制
   */
  private async enforceRateLimit(): Promise<void> {
    const now = Date.now() / 1000;

    this.requestTimes = this.requestTimes.filter((t) => now - t < 1.0);

    if (this.requestTimes.length >= this.RATE_LIMIT_PER_SECOND) {
      const sleepTime = 1.0 - (now - (this.requestTimes[0] ?? now));
      if (sleepTime > 0) {
        await new Promise((resolve) => setTimeout(resolve, sleepTime * 1000));
        this.requestTimes = [];
      }
    }

    this.requestTimes.push(Date.now() / 1000);
  }

  /**
   * 转换中科院分区为中文格式
   *
   * @param zone_value - API 返回的分区值
   * @returns 中文格式的分区字符串
   */
  private convertCasZone(zone_value: string): string {
    if (!zone_value) {
      return "未知";
    }

    const zone_upper = zone_value.toUpperCase();
    const zone_mapping: Record<string, string> = {
      "1区": "中科院一区",
      "2区": "中科院二区",
      "3区": "中科院三区",
      "4区": "中科院四区",
      Q1: "中科院一区",
      Q2: "中科院二区",
      Q3: "中科院三区",
      Q4: "中科院四区",
    };

    return zone_mapping[zone_upper] || `中科院${zone_value}`;
  }

  /**
   * 计算期刊排名信息
   *
   * @param journal_name - 期刊名称
   * @param quality_metrics - 质量指标
   * @returns 排名信息字典
   */
  private calculateRankingInfo(journal_name: string, quality_metrics: QualityMetrics): RankingInfo {
    const impact_factor = (quality_metrics.impact_factor as number | undefined) || 0;
    const quartile = (quality_metrics.quartile as string) || "";

    let rank: number;
    let percentile: number;
    let confidence: string;

    if (quartile === "Q1" || impact_factor >= 5) {
      rank = 10;
      percentile = 95.0;
      confidence = "high";
    } else if (quartile === "Q2" || impact_factor >= 3) {
      rank = 80;
      percentile = 60.0;
      confidence = "medium";
    } else if (quartile === "Q3" || impact_factor >= 1) {
      rank = 150;
      percentile = 25.0;
      confidence = "low";
    } else {
      rank = 200;
      percentile = 10.0;
      confidence = "low";
    }

    return {
      rank_in_category: rank,
      total_journals_in_category: 200,
      percentile,
      assessment_method: "api_based",
      confidence,
    };
  }
}

/**
 * 创建 EasyScholar 服务实例
 *
 * @param timeout - 请求超时时间（秒）
 * @returns EasyScholarService 实例
 */
export function createEasyScholarService(timeout: number = 30): EasyScholarService {
  return new EasyScholarService(timeout);
}

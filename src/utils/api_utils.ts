/**
 * 提供带重试、超时和日志记录的统一 HTTP API 客户端。
 */
import axios from "axios";
import type { AxiosInstance, AxiosResponse } from "axios";
import axiosRetry from "axios-retry";

export class UnifiedAPIClient {
  public session: AxiosInstance;

  constructor() {
    this.session = axios.create({
      timeout: 30000,
      headers: {
        "User-Agent": "Article-MCP/2.0",
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
      },
    });

    // 统一重试策略
    axiosRetry(this.session, {
      retries: 3,
      retryDelay: (retryCount) => {
        return retryCount * 1000; // 简化的指数退避近似值
      },
      retryCondition: (error) => {
        return (
          axiosRetry.isNetworkOrIdempotentRequestError(error) ||
          (error.response ? [429, 500, 502, 503, 504].includes(error.response.status) : false)
        );
      },
    });
  }

  public async get<T = any>(
    url: string,
    params?: any,
    headers?: Record<string, string>,
    timeout?: number,
  ): Promise<T> {
    return this.getJson<T>(url, params, headers, timeout);
  }

  /**
   * 发送 GET 请求并返回解析后的 JSON 载荷。
   *
   * @param url 请求 URL。
   * @param params 查询参数。
   * @param headers 可选请求头。
   * @param timeout 可选超时时间，单位为毫秒。
   * @returns 解析后的 JSON 响应体。
   */
  public async getJson<T = any>(
    url: string,
    params?: any,
    headers?: Record<string, string>,
    timeout?: number,
  ): Promise<T> {
    const config: any = {
      params,
    };
    if (headers) {
      config.headers = { ...this.session.defaults.headers.common, ...headers };
    }
    if (timeout) {
      config.timeout = timeout;
    }
    const response: AxiosResponse<T> = await this.session.get(url, config);
    return response.data;
  }

  /**
   * 发送 GET 请求并以文本形式返回响应体。
   *
   * @param url 请求 URL。
   * @param params 查询参数。
   * @param headers 可选请求头。
   * @param timeout 可选超时时间，单位为毫秒。
   * @returns 文本形式的响应体。
   */
  public async getText(
    url: string,
    params?: any,
    headers?: Record<string, string>,
    timeout?: number,
  ): Promise<string> {
    const config: any = {
      params,
      responseType: "text",
    };
    if (headers) {
      config.headers = { ...this.session.defaults.headers.common, ...headers };
    }
    if (timeout) {
      config.timeout = timeout;
    }
    const response: AxiosResponse<string> = await this.session.get(url, config);
    return String(response.data);
  }
}

export const defaultApiClient = new UnifiedAPIClient();

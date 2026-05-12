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

    // Unified retry strategy
    axiosRetry(this.session, {
      retries: 3,
      retryDelay: (retryCount) => {
        return retryCount * 1000; // Simplified exponential backoff approximation
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
   * Sends a GET request and returns the parsed JSON payload.
   *
   * @param url Request URL.
   * @param params Query parameters.
   * @param headers Optional request headers.
   * @param timeout Optional timeout in milliseconds.
   * @returns Parsed JSON response body.
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
   * Sends a GET request and returns the response body as text.
   *
   * @param url Request URL.
   * @param params Query parameters.
   * @param headers Optional request headers.
   * @param timeout Optional timeout in milliseconds.
   * @returns Response body as text.
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

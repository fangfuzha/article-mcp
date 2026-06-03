/**
 * 定义工具执行管线、缓存、限流、日志、计时和错误边界中间件。
 */
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export type ToolExecutionContext = {
  toolName: string;
  arguments: unknown;
};

export type ToolNext = (context: ToolExecutionContext) => Promise<CallToolResult>;

export type ToolMiddleware = (
  context: ToolExecutionContext,
  next: ToolNext,
) => Promise<CallToolResult>;

export class CacheManager {
  private readonly cache = new Map<string, unknown>();
  private readonly cacheExpiry = new Map<string, number>();

  /**
   * 在缓存仍有效时返回缓存值，否则获取并写入新值。
   *
   * @param key 用于标识缓存值的缓存键。
   * @param fetchFunc 缓存未命中或过期时用于获取值的函数。
   * @param cacheDurationHours 缓存有效期，单位为小时。
   * @param useCache 是否读取和写入缓存。
   * @returns 获取到或缓存中的值；对象载荷会附带可选的 cache_hit 标记。
   */
  public async getCachedOrFetch<T>(
    key: string,
    fetchFunc: () => Promise<T>,
    cacheDurationHours = 24,
    useCache = true,
  ): Promise<T & { cache_hit?: boolean }> {
    if (!useCache) {
      const result = await fetchFunc();
      if (typeof result === "object" && result !== null) {
        return { ...(result as object), cache_hit: false } as T & {
          cache_hit?: boolean;
        };
      }

      return result as T & { cache_hit?: boolean };
    }

    const now = Date.now();
    let cacheHit = false;
    let result: unknown;

    if (this.cache.has(key) && this.cacheExpiry.has(key)) {
      if (now < this.cacheExpiry.get(key)!) {
        cacheHit = true;
        result = this.cache.get(key);
      } else {
        result = await fetchFunc();
        this.set(key, result, cacheDurationHours, now);
      }
    } else {
      result = await fetchFunc();
      this.set(key, result, cacheDurationHours, now);
    }

    if (typeof result === "object" && result !== null) {
      return { ...(result as object), cache_hit: cacheHit } as T & {
        cache_hit?: boolean;
      };
    }

    return result as T & { cache_hit?: boolean };
  }

  /**
   * 存储值及其过期时间戳。
   *
   * @param key 用于标识缓存值的缓存键。
   * @param value 要存储的值。
   * @param cacheDurationHours 缓存有效期，单位为小时。
   * @param now 用作过期基准的当前时间戳。
   */
  private set(key: string, value: unknown, cacheDurationHours: number, now: number): void {
    this.cache.set(key, value);
    this.cacheExpiry.set(key, now + cacheDurationHours * 60 * 60 * 1000);
  }
}

export class RateLimiter {
  private queue: Promise<void> = Promise.resolve();

  public constructor(private readonly delayMs: number) {}

  /**
   * 在此前已调度任务之后运行任务，并在下一个任务前强制等待。
   *
   * @param task 要在限速器下执行的任务。
   * @returns 任务执行结果。
   */
  public async schedule<T>(task: () => Promise<T>): Promise<T> {
    const resultPromise = this.queue.then(async () => {
      const result = await task();
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
      return result;
    });

    this.queue = resultPromise.then(
      () => undefined,
      (error: unknown) => {
        // 记录失败但继续处理后续任务，避免阻塞队列
        console.error(`[RateLimiter] 任务执行失败: ${error instanceof Error ? error.message : String(error)}`);
      },
    );

    return resultPromise;
  }
}

export class ToolExecutionPipeline {
  private readonly middleware: ToolMiddleware[];

  public constructor(middleware: ToolMiddleware[] = []) {
    this.middleware = [...middleware];
  }

  /**
   * 将中间件追加到执行链末尾。
   *
   * @param middleware 要添加的中间件。
   */
  public use(middleware: ToolMiddleware): void {
    this.middleware.push(middleware);
  }

  /**
   * 通过已配置的中间件链执行工具。
   *
   * @param toolName MCP 工具名称。
   * @param toolArguments 从客户端收到的原始工具参数。
   * @param handler 最终工具处理器。
   * @returns MCP 工具调用结果。
   */
  public async execute(
    toolName: string,
    toolArguments: unknown,
    handler: ToolNext,
  ): Promise<CallToolResult> {
    const initialContext: ToolExecutionContext = {
      toolName,
      arguments: toolArguments,
    };

    const dispatch = async (
      index: number,
      context: ToolExecutionContext,
    ): Promise<CallToolResult> => {
      const currentMiddleware = this.middleware[index];
      if (!currentMiddleware) {
        return handler(context);
      }

      return currentMiddleware(context, (nextContext) => dispatch(index + 1, nextContext));
    };

    return dispatch(0, initialContext);
  }
}

/**
 * 创建向工具响应注入 processing_time 和 timestamp 的中间件。
 *
 * Python 版 TimingMiddleware 自动为每个 dict 结果注入计时信息。
 * Node 版在 CallToolResult 的 content[0].text JSON 中注入相同字段。
 *
 * @returns 用于计时注入的工具中间件。
 */
export function createTimingMiddleware(): ToolMiddleware {
  return async (context, next) => {
    const startTime = Date.now();
    const result = await next(context);

    const processingTime = Date.now() - startTime;
    const timestamp = Math.floor(Date.now() / 1000);

    const updatedResult = injectTimingIntoResult(result, processingTime, timestamp);

    return updatedResult;
  };
}

/**
 * 向 CallToolResult 的第一段文本内容注入 processing_time 和 timestamp。
 *
 * @param result 处理器返回的原始 CallToolResult。
 * @param processingTime 处理耗时，单位为毫秒。
 * @param timestamp Unix 时间戳，单位为秒。
 * @returns 注入计时信息后的 CallToolResult。
 */
function injectTimingIntoResult(
  result: CallToolResult,
  processingTime: number,
  timestamp: number,
): CallToolResult {
  const structuredContent =
    typeof result.structuredContent === "object" && result.structuredContent !== null
      ? {
          ...(result.structuredContent as Record<string, unknown>),
          meta: {
            ...((result.structuredContent as Record<string, unknown>).meta as
              | Record<string, unknown>
              | undefined),
            processing_time_ms: processingTime,
            timestamp,
          },
        }
      : result.structuredContent;

  const content = result.content.map((item) => {
    if (item.type === "text") {
      try {
        const parsed = JSON.parse(item.text);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          if (
            "meta" in parsed &&
            typeof parsed.meta === "object" &&
            parsed.meta !== null &&
            !Array.isArray(parsed.meta)
          ) {
            parsed.meta = {
              ...(parsed.meta as Record<string, unknown>),
              processing_time_ms: processingTime,
              timestamp,
            };
          } else {
            parsed.processing_time_ms = processingTime;
            parsed.timestamp = timestamp;
          }
          return { ...item, text: JSON.stringify(parsed) };
        }
      } catch {
        // 非 JSON 内容不注入计时
      }
    }
    return item;
  });

  return { ...result, structuredContent, content };
}

/**
 * 创建将工具请求和响应记录到 stderr 的中间件。
 *
 * Python 版 LoggingMiddleware 记录请求方法、耗时和状态。
 * Node 版使用 console.error 写入 stderr 以避免污染 MCP stdio 协议通道。
 *
 * @returns 用于请求日志记录的工具中间件。
 */
export function createLoggingMiddleware(): ToolMiddleware {
  return async (context, next) => {
    const startTime = Date.now();

    try {
      const result = await next(context);
      const elapsed = Date.now() - startTime;

      if (result.isError) {
        console.error(`[MCP] ${context.toolName} 处理失败, 耗时 ${elapsed}ms`);
      } else {
        console.error(`[MCP] ${context.toolName} 处理成功, 耗时 ${elapsed}ms`);
      }

      return result;
    } catch (error) {
      const elapsed = Date.now() - startTime;
      console.error(
        `[MCP] ${context.toolName} 处理失败, 耗时 ${elapsed}ms, 错误: ${formatToolError(error)}`,
      );

      throw error;
    }
  };
}

/**
 * 将未知异常格式化为可读的工具错误文本。
 *
 * @param error 工具或解析器抛出的错误。
 * @returns 便于阅读的错误文本。
 */
export function formatToolError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

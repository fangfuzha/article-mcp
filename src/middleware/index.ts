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
   * Returns a cached value when it is still fresh, otherwise fetches and stores a new value.
   *
   * @param key Cache key used to identify the value.
   * @param fetchFunc Function used to fetch the value on cache miss or expiry.
   * @param cacheDurationHours Cache lifetime in hours.
   * @param useCache Whether to read from and write to the cache.
   * @returns The fetched or cached value with an optional cache_hit marker for object payloads.
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
   * Stores a value and its expiry timestamp.
   *
   * @param key Cache key used to identify the value.
   * @param value Value to store.
   * @param cacheDurationHours Cache lifetime in hours.
   * @param now Current timestamp used as expiry base.
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
   * Runs a task after all previously scheduled tasks and enforces a delay before the next task.
   *
   * @param task Task to execute under the limiter.
   * @returns The task result.
   */
  public async schedule<T>(task: () => Promise<T>): Promise<T> {
    const resultPromise = this.queue.then(async () => {
      const result = await task();
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
      return result;
    });

    this.queue = resultPromise.then(
      () => undefined,
      () => undefined,
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
   * Adds a middleware to the end of the execution chain.
   *
   * @param middleware Middleware to add.
   */
  public use(middleware: ToolMiddleware): void {
    this.middleware.push(middleware);
  }

  /**
   * Executes a tool through the configured middleware chain.
   *
   * @param toolName MCP tool name.
   * @param toolArguments Raw tool arguments received from the client.
   * @param handler Final tool handler.
   * @returns MCP tool call result.
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
 * Creates middleware that converts tool exceptions into MCP error tool results.
 *
 * @returns Tool middleware for exception boundaries.
 */
export function createErrorBoundaryMiddleware(): ToolMiddleware {
  return async (_context, next) => {
    try {
      return await next(_context);
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: formatToolError(error),
          },
        ],
        isError: true,
      };
    }
  };
}

/**
 * Creates middleware that injects processing_time and timestamp into tool responses.
 *
 * Python 版 TimingMiddleware 自动为每个 dict 结果注入计时信息。
 * Node 版在 CallToolResult 的 content[0].text JSON 中注入相同字段。
 *
 * @returns Tool middleware for timing injection.
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
 * Injects processing_time and timestamp into the first text content of a CallToolResult.
 *
 * @param result Original CallToolResult from the handler.
 * @param processingTime Processing time in milliseconds.
 * @param timestamp Unix timestamp in seconds.
 * @returns Updated CallToolResult with timing injected.
 */
function injectTimingIntoResult(
  result: CallToolResult,
  processingTime: number,
  timestamp: number,
): CallToolResult {
  const content = result.content.map((item) => {
    if (item.type === "text") {
      try {
        const parsed = JSON.parse(item.text);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          parsed.processing_time = processingTime;
          parsed.timestamp = timestamp;
          return { ...item, text: JSON.stringify(parsed) };
        }
      } catch {
        // 非 JSON 内容不注入计时
      }
    }
    return item;
  });

  return { ...result, content };
}

/**
 * Creates middleware that logs tool requests and responses to stderr.
 *
 * Python 版 LoggingMiddleware 记录请求方法、耗时和状态。
 * Node 版使用 console.error 写入 stderr 以避免污染 MCP stdio 协议通道。
 *
 * @returns Tool middleware for request logging.
 */
export function createLoggingMiddleware(): ToolMiddleware {
  return async (context, next) => {
    const startTime = Date.now();

    try {
      const result = await next(context);
      const elapsed = Date.now() - startTime;

      console.error(`[MCP] ${context.toolName} 处理成功, 耗时 ${elapsed}ms`);

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
 * Formats unknown exceptions into readable tool error text.
 *
 * @param error Error thrown by a tool or parser.
 * @returns Human-readable error text.
 */
export function formatToolError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

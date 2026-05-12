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

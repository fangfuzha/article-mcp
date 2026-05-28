/**
 * 日志和计时中间件
 *
 * 对应 Python 版 middleware/logging.py 中的 LoggingMiddleware 和 TimingMiddleware。
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { ToolExecutionContext, ToolMiddleware, ToolNext } from "./index.js";

/**
 * 创建日志中间件 - 记录工具调用的开始、成功和失败。
 *
 * @param logger 可选的日志记录器，默认使用 console。
 * @returns 日志中间件函数。
 */
export function createLoggingMiddleware(logger: Console = console): ToolMiddleware {
  return async (context: ToolExecutionContext, next: ToolNext): Promise<CallToolResult> => {
    const startTime = Date.now();

    logger.info(`[MCP] 开始处理 ${context.toolName}`);

    try {
      const result = await next(context);
      const processingTime = Date.now() - startTime;

      logger.info(`[MCP] ${context.toolName} 处理成功, 耗时 ${processingTime}ms`);
      return result;
    } catch (error) {
      const processingTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error(
        `[MCP] ${context.toolName} 处理失败, 耗时 ${processingTime}ms, 错误: ${errorMessage}`,
      );
      throw error;
    }
  };
}

/**
 * 创建计时中间件 - 自动添加性能统计信息。
 *
 * @returns 计时中间件函数。
 */
export function createTimingMiddleware(): ToolMiddleware {
  return async (context: ToolExecutionContext, next: ToolNext): Promise<CallToolResult> => {
    const startTime = Date.now();

    const result = await next(context);

    const processingTime = Date.now() - startTime;

    // 如果结果包含文本内容，尝试添加计时信息
    if (result.content && Array.isArray(result.content)) {
      for (const item of result.content) {
        if (item.type === "text" && typeof item.text === "string") {
          try {
            const parsed = JSON.parse(item.text);
            if (typeof parsed === "object" && parsed !== null) {
              parsed.processing_time = processingTime;
              parsed.timestamp = Date.now();
              item.text = JSON.stringify(parsed, null, 2);
            }
          } catch {
            // 非 JSON 文本，忽略
          }
        }
      }
    }

    return result;
  };
}

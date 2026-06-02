/**
 * MCP 标准错误处理中间件
 *
 * 对应 Python 版 middleware/__init__.py 中的 MCPErrorHandlingMiddleware。
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { ToolExecutionContext, ToolMiddleware, ToolNext } from "./index.js";
import { createStructuredErrorResult } from "../tools/result_format.js";

/**
 * 用户输入错误类型。
 */
const USER_INPUT_ERROR_TYPES = ["ValidationError", "TypeError", "RangeError", "SyntaxError"];

/**
 * 创建 MCP 标准错误处理中间件。
 *
 * 将未处理的异常转换为 MCP 标准错误格式。
 *
 * @param logger 可选的日志记录器，默认使用 console。
 * @returns 错误处理中间件函数。
 */
export function createMCPErrorHandlingMiddleware(logger: Console = console): ToolMiddleware {
  return async (context: ToolExecutionContext, next: ToolNext): Promise<CallToolResult> => {
    try {
      return await next(context);
    } catch (error) {
      // 如果已经是 MCP 标准错误格式，直接重新抛出
      if (isMcpError(error)) {
        throw error;
      }

      const errorName = error instanceof Error ? error.constructor.name : "UnknownError";
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error(`[MCP] Error in ${context.toolName}: ${errorName}: ${errorMessage}`);

      // 根据异常类型确定错误处理方式
      if (isUserInputError(error)) {
        // 用户输入错误，返回友好的错误信息
        return {
          ...createStructuredErrorResult(`输入错误: ${errorMessage}`),
          structuredContent: {
            success: false,
            data: null,
            meta: { error_type: errorName },
            error: `输入错误: ${errorMessage}`,
          },
          isError: true,
        };
      }

      // 系统错误，返回标准错误信息
      return {
        ...createStructuredErrorResult(`系统错误: ${errorName}: ${errorMessage}`),
        structuredContent: {
          success: false,
          data: null,
          meta: { error_type: errorName },
          error: `系统错误: ${errorName}: ${errorMessage}`,
        },
        isError: true,
      };
    }
  };
}

/**
 * 判断是否为 MCP 标准错误。
 */
function isMcpError(error: unknown): boolean {
  if (error instanceof Error) {
    return error.name === "McpError" || "code" in error;
  }
  return false;
}

/**
 * 判断是否为用户输入错误。
 */
function isUserInputError(error: unknown): boolean {
  if (error instanceof Error) {
    return USER_INPUT_ERROR_TYPES.includes(error.constructor.name);
  }
  return false;
}

/**
 * 标准错误包装器 - 用于工具函数。
 */
export class StandardErrorWrapper {
  /**
   * 包装工具函数以提供标准错误处理。
   */
  public static wrapToolFunction(
    toolFunc: (args: unknown) => Promise<CallToolResult>,
  ): (args: unknown) => Promise<CallToolResult> {
    return async (args: unknown) => {
      try {
        return await toolFunc(args);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorName = error instanceof Error ? error.constructor.name : "UnknownError";

        return {
          ...createStructuredErrorResult(`${errorName}: ${errorMessage}`),
          structuredContent: {
            success: false,
            data: null,
            meta: { error_type: errorName },
            error: `${errorName}: ${errorMessage}`,
          },
          isError: true,
        };
      }
    };
  }
}

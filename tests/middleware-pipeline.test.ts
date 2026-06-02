import { describe, expect, it, vi } from "vitest";

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { createMCPErrorHandlingMiddleware } from "../src/middleware/error_handling.js";
import {
  createErrorBoundaryMiddleware,
  createLoggingMiddleware,
  createTimingMiddleware,
  ToolExecutionPipeline,
  type ToolExecutionContext,
  type ToolNext,
} from "../src/middleware/index.js";

function makeTextResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

describe("TimingMiddleware", () => {
  it("注入 processing_time_ms 和 timestamp 到 JSON 文本结果", async () => {
    const middleware = createTimingMiddleware();
    const context: ToolExecutionContext = { toolName: "test_tool", arguments: {} };
    const handler: ToolNext = async () => makeTextResult(JSON.stringify({ success: true }));

    const result = await middleware(context, handler);
    const parsed = JSON.parse((result.content[0] as { type: "text"; text: string }).text);

    expect(parsed.success).toBe(true);
    expect(parsed.processing_time_ms).toBeTypeOf("number");
    expect(parsed.processing_time_ms).toBeGreaterThanOrEqual(0);
    expect(parsed.timestamp).toBeTypeOf("number");
    expect(parsed.timestamp).toBeGreaterThan(0);
  });

  it("非 JSON 文本结果不注入计时", async () => {
    const middleware = createTimingMiddleware();
    const context: ToolExecutionContext = { toolName: "test_tool", arguments: {} };
    const handler: ToolNext = async () => makeTextResult("纯文本结果");

    const result = await middleware(context, handler);
    expect((result.content[0] as { type: "text"; text: string }).text).toBe("纯文本结果");
  });
});

describe("LoggingMiddleware", () => {
  it("成功请求时记录日志到 stderr", async () => {
    const stderrSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const middleware = createLoggingMiddleware();
    const context: ToolExecutionContext = { toolName: "test_tool", arguments: {} };
    const handler: ToolNext = async () => makeTextResult(JSON.stringify({ ok: true }));

    await middleware(context, handler);

    expect(stderrSpy).toHaveBeenCalledOnce();
    expect(stderrSpy.mock.calls[0]?.[0]).toContain("test_tool");
    expect(stderrSpy.mock.calls[0]?.[0]).toContain("成功");

    stderrSpy.mockRestore();
  });

  it("失败请求时记录错误日志并重新抛出", async () => {
    const stderrSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const middleware = createLoggingMiddleware();
    const context: ToolExecutionContext = { toolName: "test_tool", arguments: {} };
    const handler: ToolNext = async () => {
      throw new Error("测试错误");
    };

    await expect(middleware(context, handler)).rejects.toThrow("测试错误");
    expect(stderrSpy).toHaveBeenCalledOnce();
    expect(stderrSpy.mock.calls[0]?.[0]).toContain("失败");

    stderrSpy.mockRestore();
  });
});

describe("ToolExecutionPipeline with middleware stack", () => {
  it("按 ErrorBoundary → Logging → Timing → Handler 顺序执行", async () => {
    const executionOrder: string[] = [];

    const pipeline = new ToolExecutionPipeline([
      createErrorBoundaryMiddleware(),
      createLoggingMiddleware(),
      createTimingMiddleware(),
    ]);

    const handler: ToolNext = async () => {
      executionOrder.push("handler");
      return makeTextResult(JSON.stringify({ result: "ok" }));
    };

    const result = await pipeline.execute("test_tool", { key: "value" }, handler);
    const parsed = JSON.parse((result.content[0] as { type: "text"; text: string }).text);

    expect(parsed.result).toBe("ok");
    expect(parsed.processing_time_ms).toBeTypeOf("number");
    expect(parsed.timestamp).toBeTypeOf("number");
  });

  it("错误边界中间件捕获异常并返回 MCP 错误结果", async () => {
    const pipeline = new ToolExecutionPipeline([createErrorBoundaryMiddleware()]);
    const handler: ToolNext = async () => {
      throw new Error("处理器内部错误");
    };

    const result = await pipeline.execute("test_tool", {}, handler);
    expect(result.isError).toBe(true);
    expect((result.content[0] as { type: "text"; text: string }).text).toContain("处理器内部错误");
  });

  it("生产中间件顺序会给结构化错误结果注入 timing metadata", async () => {
    const stderrSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const pipeline = new ToolExecutionPipeline([
      createLoggingMiddleware(),
      createTimingMiddleware(),
      createMCPErrorHandlingMiddleware(),
    ]);
    const handler: ToolNext = async () => {
      throw new Error("生产路径错误");
    };

    const result = await pipeline.execute("test_tool", {}, handler);
    const structuredContent = result.structuredContent as Record<string, any>;
    const meta = structuredContent.meta as Record<string, any>;

    expect(result.isError).toBe(true);
    expect(structuredContent.success).toBe(false);
    expect(structuredContent.error).toContain("生产路径错误");
    expect(meta.processing_time_ms).toBeTypeOf("number");
    expect(meta.timestamp).toBeTypeOf("number");
    expect(stderrSpy.mock.calls.at(-1)?.[0]).toContain("失败");

    stderrSpy.mockRestore();
  });
});

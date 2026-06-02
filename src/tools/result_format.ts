import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export type ArticleMcpStructuredEnvelope = {
  success: boolean;
  data: unknown;
  meta: Record<string, unknown>;
  warnings?: string[];
  error?: string | null;
};

type TextContent = {
  type: "text";
  text: string;
};

/**
 * 将结构化 envelope 与面向阅读的摘要文本封装为 MCP 工具结果。
 *
 * @param envelope 结构化结果载荷。
 * @param summary 面向人类/LLM 的摘要文本。
 * @param excerpts 可选的关键摘录列表。
 * @returns MCP 工具结果。
 */
export function createStructuredToolResult(
  envelope: ArticleMcpStructuredEnvelope,
  summary: string,
  excerpts: string[] = [],
): CallToolResult {
  const lines = [summary.trim()];

  const normalizedExcerpts = excerpts.map((excerpt) => excerpt.trim()).filter(Boolean);
  if (normalizedExcerpts.length) {
    lines.push("");
    lines.push("关键摘录:");
    lines.push(...normalizedExcerpts.map((excerpt) => `- ${excerpt}`));
  }

  const content: TextContent[] = [
    {
      type: "text",
      text: lines.join("\n"),
    },
  ];

  return {
    structuredContent: envelope as Record<string, unknown>,
    content,
  };
}

/**
 * 创建标准化的结构化错误工具结果。
 *
 * @param error 错误消息。
 * @param summary 面向人类/LLM 的摘要文本。
 * @returns MCP 工具结果。
 */
export function createStructuredErrorResult(error: string, summary?: string): CallToolResult {
  return createStructuredToolResult(
    {
      success: false,
      data: null,
      meta: {},
      error,
    },
    summary?.trim() || error,
  );
}
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it, vi } from "vitest";

import type { ArticleMcpServices } from "../src/services/container.js";
import { createToolHandlers } from "../src/tools/handlers.js";

/**
 * 解析工具文本结果。
 *
 * @param result MCP 工具返回值。
 * @returns 解析后的 JSON 对象。
 */
function parseTextResult(result: CallToolResult): Record<string, any> {
  if (result.structuredContent && typeof result.structuredContent === "object") {
    const structured = result.structuredContent as Record<string, any>;
    const data = structured.data && typeof structured.data === "object" ? structured.data : {};
    return {
      ...structured,
      ...data,
    };
  }

  const textContent = result.content.find((item) => item.type === "text");
  if (!textContent || textContent.type !== "text") {
    throw new Error("工具结果缺少文本内容");
  }

  return JSON.parse(textContent.text) as Record<string, any>;
}

/**
 * 创建仅用于期刊排序测试的服务容器。
 *
 * @returns 具备 get_journal_quality 所需依赖的服务容器。
 */
function createSortingServices(): ArticleMcpServices {
  const metricsByJournal: Record<string, Record<string, unknown>> = {
    "Journal A": { impact_factor: 8.2, quartile: "1区", jci: "3.5" },
    "Journal B": { impact_factor: 3.5, quartile: "2区", jci: "1.5" },
    "Journal C": { impact_factor: 1.8, quartile: "4区", jci: "0.8" },
    "Journal D": { impact_factor: 4.7, quartile: "Q1", jci: "2.1" },
    "Journal E": { impact_factor: 2.9, quartile: "Q3", jci: "1.2" },
    "Journal Missing": { quartile: "Q2" },
  };

  return {
    europePmc: {},
    pubmed: {},
    arxiv: {},
    crossref: {},
    referenceService: {},
    openalex: {},
    easyscholar: {
      getJournalQuality: vi.fn(async (journalName: string) => ({
        success: true,
        journal_name: journalName,
        quality_metrics: metricsByJournal[journalName] ?? {},
        ranking_info: {},
        data_source: "mock",
      })),
    },
    openalexMetrics: {
      getJournalMetrics: vi.fn(async () => null),
      batchGetJournalMetrics: vi.fn(async () => []),
    },
  } as unknown as ArticleMcpServices;
}

describe("journal quality sorting", () => {
  it("sorts journals by impact factor descending", async () => {
    const handlers = createToolHandlers(createSortingServices());
    const result = parseTextResult(
      await handlers.get_journal_quality!({
        journal_name: ["Journal B", "Journal A", "Journal C", "Journal D", "Journal E"],
        sort_by: "impact_factor",
        sort_order: "desc",
      }),
    );

    expect(
      result.journal_results.map((item: Record<string, unknown>) => item.journal_name),
    ).toEqual(["Journal A", "Journal D", "Journal B", "Journal E", "Journal C"]);
    expect(result.sort_info).toEqual({ field: "impact_factor", order: "desc" });
  });

  it("sorts journals by impact factor ascending", async () => {
    const handlers = createToolHandlers(createSortingServices());
    const result = parseTextResult(
      await handlers.get_journal_quality!({
        journal_name: ["Journal B", "Journal A", "Journal C", "Journal D", "Journal E"],
        sort_by: "impact_factor",
        sort_order: "asc",
      }),
    );

    expect(
      result.journal_results.map((item: Record<string, unknown>) => item.journal_name),
    ).toEqual(["Journal C", "Journal E", "Journal B", "Journal D", "Journal A"]);
  });

  it("sorts journals by quartile using both Chinese and Q1-Q4 labels", async () => {
    const handlers = createToolHandlers(createSortingServices());
    const result = parseTextResult(
      await handlers.get_journal_quality!({
        journal_name: ["Journal C", "Journal B", "Journal A", "Journal D", "Journal E"],
        sort_by: "quartile",
        sort_order: "desc",
      }),
    );

    expect(
      result.journal_results.map((item: Record<string, unknown>) => item.journal_name),
    ).toEqual(["Journal A", "Journal D", "Journal B", "Journal E", "Journal C"]);
  });

  it("sorts journals by JCI descending", async () => {
    const handlers = createToolHandlers(createSortingServices());
    const result = parseTextResult(
      await handlers.get_journal_quality!({
        journal_name: ["Journal C", "Journal B", "Journal A"],
        sort_by: "jci",
        sort_order: "desc",
      }),
    );

    expect(
      result.journal_results.map((item: Record<string, unknown>) => item.journal_name),
    ).toEqual(["Journal A", "Journal B", "Journal C"]);
  });

  it("places journals with missing metrics at the end", async () => {
    const handlers = createToolHandlers(createSortingServices());
    const result = parseTextResult(
      await handlers.get_journal_quality!({
        journal_name: ["Journal Missing", "Journal A", "Journal B"],
        sort_by: "impact_factor",
        sort_order: "desc",
      }),
    );

    expect(
      result.journal_results.map((item: Record<string, unknown>) => item.journal_name),
    ).toEqual(["Journal A", "Journal B", "Journal Missing"]);
  });

  it("returns batch results as a list when sorting is not requested", async () => {
    const handlers = createToolHandlers(createSortingServices());
    const result = parseTextResult(
      await handlers.get_journal_quality!({
        journal_name: ["Journal B", "Journal A", "Journal C"],
      }),
    );

    expect(
      result.journal_results.map((item: Record<string, unknown>) => item.journal_name),
    ).toEqual(["Journal B", "Journal A", "Journal C"]);
    expect(result.sort_info).toBeNull();
  });
});

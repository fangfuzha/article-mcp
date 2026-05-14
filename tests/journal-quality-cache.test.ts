import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it, vi } from "vitest";

import type { ArticleMcpServices } from "../src/services/container.js";
import { JournalQualityCache } from "../src/services/journal_quality_cache.js";
import { createToolHandlers } from "../src/tools/handlers.js";

/**
 * Parses the first text content item from a tool result.
 *
 * @param result MCP tool call result.
 * @returns Parsed JSON payload.
 */
function parseTextResult(result: CallToolResult): Record<string, unknown> {
  const textContent = result.content.find((item) => item.type === "text");
  if (!textContent || textContent.type !== "text") {
    throw new Error("工具结果缺少文本内容");
  }

  return JSON.parse(textContent.text) as Record<string, unknown>;
}

/**
 * Creates the minimal service container required by get_journal_quality tests.
 *
 * @returns Service stubs and call spies.
 */
function createJournalQualityServices(): {
  services: ArticleMcpServices;
  easyScholarSpy: ReturnType<typeof vi.fn>;
  openAlexMetricsSpy: ReturnType<typeof vi.fn>;
} {
  const easyScholarSpy = vi.fn(async (journalName: string) => ({
    success: true,
    journal_name: journalName,
    quality_metrics: {
      impact_factor: 64,
      quartile: "Q1",
      jci: "5",
    },
    ranking_info: {
      rank_in_category: 1,
      total_journals_in_category: 200,
      percentile: 99.5,
      assessment_method: "mock",
      confidence: "high",
    },
    data_source: "easyscholar_api",
  }));

  const openAlexMetricsSpy = vi.fn(async () => ({
    h_index: 100,
    cited_by_count: 5000,
    source: "openalex",
  }));

  const services = {
    europePmc: {},
    pubmed: {},
    arxiv: {},
    crossref: {},
    referenceService: {},
    openalex: {},
    easyscholar: {
      getJournalQuality: easyScholarSpy,
    },
    openalexMetrics: {
      getJournalMetrics: openAlexMetricsSpy,
      batchGetJournalMetrics: vi.fn(),
    },
  } as unknown as ArticleMcpServices;

  return { services, easyScholarSpy, openAlexMetricsSpy };
}

describe("JournalQualityCache", () => {
  it("merges cached EasyScholar and OpenAlex metrics", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "journal-quality-cache-"));
    const cache = new JournalQualityCache(cacheDir);

    await cache.set(
      "Nature",
      {
        journal_name: "Nature",
        quality_metrics: { impact_factor: 64, quartile: "Q1" },
        ranking_info: { rank_in_category: 1 },
        data_source: "easyscholar_api",
      },
      {
        h_index: 100,
        source: "openalex",
      },
    );

    const result = await cache.getMergedResult("Nature");

    expect(result?.quality_metrics).toMatchObject({
      impact_factor: 64,
      quartile: "Q1",
      h_index: 100,
    });
    expect(result?.data_source).toBe("easyscholar_api+openalex_cache");
    expect(result?.timestamp).toBeTypeOf("number");
  });

  it("reuses file cache across get_journal_quality handler invocations", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "journal-quality-handler-"));
    const cache = new JournalQualityCache(cacheDir);
    const { services, easyScholarSpy, openAlexMetricsSpy } = createJournalQualityServices();
    const handlers = createToolHandlers(services, undefined, cache);
    const getJournalQualityHandler = handlers.get_journal_quality;

    expect(getJournalQualityHandler).toBeTypeOf("function");

    const firstResult = parseTextResult(
      await getJournalQualityHandler!({
        journal_name: "Nature",
        include_metrics: ["impact_factor", "h_index"],
        use_cache: true,
      }),
    );
    const secondResult = parseTextResult(
      await getJournalQualityHandler!({
        journal_name: "Nature",
        include_metrics: ["impact_factor", "h_index"],
        use_cache: true,
      }),
    );

    expect(firstResult.quality_metrics).toMatchObject({ impact_factor: 64, h_index: 100 });
    expect(secondResult.quality_metrics).toMatchObject({ impact_factor: 64, h_index: 100 });
    expect(easyScholarSpy).toHaveBeenCalledTimes(1);
    expect(openAlexMetricsSpy).toHaveBeenCalledTimes(1);
  });

  it("falls back to OpenAlex metrics when EasyScholar is unavailable", async () => {
    const easyScholarSpy = vi.fn(async (journalName: string) => ({
      success: false,
      error: "EASYSCHOLAR_SECRET_KEY 环境变量未设置",
      journal_name: journalName,
      quality_metrics: {},
      ranking_info: {},
      data_source: null,
    }));
    const openAlexMetricsSpy = vi.fn(async () => ({
      h_index: 100,
      cited_by_count: 5000,
      source: "openalex",
    }));
    const services = {
      europePmc: {},
      pubmed: {},
      arxiv: {},
      crossref: {},
      referenceService: {},
      openalex: {},
      easyscholar: {
        getJournalQuality: easyScholarSpy,
      },
      openalexMetrics: {
        getJournalMetrics: openAlexMetricsSpy,
        batchGetJournalMetrics: vi.fn(),
      },
    } as unknown as ArticleMcpServices;

    const handlers = createToolHandlers(services);
    const result = parseTextResult(
      await handlers.get_journal_quality!({
        journal_name: "Nature",
        use_cache: false,
      }),
    );

    expect(result.quality_metrics).toEqual({
      h_index: 100,
      cited_by_count: 5000,
    });
    expect(result.data_source).toBe("openalex");
    expect(result.warning).toContain("OpenAlex");
    expect(easyScholarSpy).toHaveBeenCalledTimes(1);
    expect(openAlexMetricsSpy).toHaveBeenCalledTimes(1);
  });

  it("keeps all journals when many cache writes happen concurrently", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "journal-quality-concurrency-"));
    const cache = new JournalQualityCache(cacheDir);

    await Promise.all(
      Array.from({ length: 10 }, (_value, index) =>
        cache.set(`Journal ${index}`, {
          journal_name: `Journal ${index}`,
          quality_metrics: { impact_factor: 10 + index },
          ranking_info: {},
          data_source: "test",
        }),
      ),
    );

    const journals = await Promise.all(
      Array.from({ length: 10 }, (_value, index) => cache.getMergedResult(`Journal ${index}`)),
    );

    expect(journals.filter(Boolean)).toHaveLength(10);
    expect(journals[0]?.journal_name).toBe("Journal 0");
    expect(journals[9]?.journal_name).toBe("Journal 9");
  });
});

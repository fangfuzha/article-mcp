import { describe, expect, it, vi } from "vitest";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import {
  buildArticleRelationsResourceUri,
  parseArticleRelationsResourceUri,
  readArticleRelationsResource,
} from "../src/resources/article_relations.js";

function createToolResult(structuredContent: Record<string, unknown>): CallToolResult {
  return {
    structuredContent,
    content: [{ type: "text", text: "ok" }],
  };
}

describe("article relations resources", () => {
  it("builds relation resource URIs", () => {
    expect(
      buildArticleRelationsResourceUri({
        identifier: "10.1000/source",
        idType: "doi",
        relationTypes: ["references"],
        analysisType: "network",
        maxResults: 10,
        maxDepth: 2,
        sources: ["crossref"],
      }),
    ).toContain("article://relations/10.1000%2Fsource");
  });

  it("parses relation resource URIs", () => {
    const parsed = parseArticleRelationsResourceUri(
      new URL(
        "article://relations/10.1000%2Fsource?id_type=doi&relation_types=references,similar&analysis_type=network&max_results=10&max_depth=2&sources=crossref,openalex",
      ),
    );

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value).toMatchObject({
        identifier: "10.1000/source",
        id_type: "doi",
        relation_types: ["references", "similar"],
        analysis_type: "network",
        max_results: 10,
        max_depth: 2,
        sources: ["crossref", "openalex"],
      });
    }
  });

  it("reads relation resources by recomputing through the injected handler", async () => {
    const handler = vi.fn(async () =>
      createToolResult({
        success: true,
        data: {
          identifier: "10.1000/source",
          relations: [{ identifier: "10.1000/source", references: [{ title: "Ref A" }] }],
          statistics: { total_relations: 1 },
        },
        meta: {
          source: "test",
        },
        warnings: [],
        error: null,
      }),
    );

    const result = await readArticleRelationsResource(
      new URL(
        "article://relations/10.1000%2Fsource?id_type=doi&relation_types=references&analysis_type=basic&max_results=4&max_depth=1&sources=crossref",
      ),
      handler,
    );

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({
      identifier: "10.1000/source",
      id_type: "doi",
      relation_types: ["references"],
      analysis_type: "basic",
      max_results: 4,
      max_depth: 1,
      sources: ["crossref"],
    });
    expect(result.contents[0]).toMatchObject({
      mimeType: "application/json",
    });
    const content = result.contents[0] as { text?: string };
    expect(content.text).toContain('"total_relations": 1');
  });

  it("does not cache relation resource reads on the server", async () => {
    const handler = vi.fn(async () =>
      createToolResult({
        success: true,
        data: { relations: [], statistics: { total_relations: 0 } },
        meta: {},
        warnings: [],
        error: null,
      }),
    );
    const uri = new URL("article://relations/PMC123?id_type=pmcid&relation_types=similar");

    await readArticleRelationsResource(uri, handler);
    await readArticleRelationsResource(uri, handler);

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("returns structured JSON errors for invalid relation URIs", async () => {
    const handler = vi.fn(async () => createToolResult({}));
    const result = await readArticleRelationsResource(
      new URL("article://relations/?id_type=doi"),
      handler,
    );

    const content = result.contents[0] as { mimeType?: string; text?: string };
    expect(content.mimeType).toBe("application/json");
    expect(content.text).toContain("success");
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns structured JSON errors when relation recomputation fails", async () => {
    const handler = vi.fn(async () => {
      throw new Error("relation backend failed");
    });
    const result = await readArticleRelationsResource(
      new URL("article://relations/10.1000%2Fsource?id_type=doi"),
      handler,
    );

    const content = result.contents[0] as { mimeType?: string; text?: string };
    expect(content.mimeType).toBe("application/json");
    expect(content.text).toContain('"success": false');
    expect(content.text).toContain("relation backend failed");
  });
});

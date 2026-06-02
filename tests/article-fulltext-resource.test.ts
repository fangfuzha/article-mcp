import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";

import type { ArticleMcpServices } from "../src/services/container.js";
import {
  buildArticleFulltextResourceUri,
  parseArticleFulltextResourceUri,
  readArticleFulltextResource,
} from "../src/resources/article_fulltext.js";

function createMockServices(): ArticleMcpServices {
  return {
    europePmc: {} as any,
    pubmed: {
      getPMCFulltextHtmlAsync: vi.fn(async (pmcid: string, sections?: string[]) => ({
        pmc_id: pmcid,
        fulltext_xml: `<body><sec><title>Methods</title><p>${sections?.join(",") ?? "full"}</p></sec></body>`,
        fulltext_markdown: `## Methods\n\n${sections?.join(",") ?? "full"}`,
        fulltext_text: sections?.join(",") ?? "full",
        fulltext_available: true,
        sections_requested: sections,
        sections_found: sections ?? [],
        sections_missing: [],
      })),
    } as any,
    arxiv: {} as any,
    crossref: {} as any,
    referenceService: {} as any,
    openalex: {} as any,
    easyscholar: {} as any,
    openalexMetrics: {} as any,
  } as ArticleMcpServices;
}

describe("article fulltext resources", () => {
  it("builds semantic resource URIs", () => {
    expect(
      buildArticleFulltextResourceUri("123", {
        format: "markdown",
        sections: ["methods", "discussion"],
      }),
    ).toBe("article://fulltext/PMC123?format=markdown&sections=methods%2Cdiscussion");
  });

  it("parses resource URIs with query parameters", () => {
    const parsed = parseArticleFulltextResourceUri(
      new URL("article://fulltext/PMC123?format=text&sections=methods,discussion"),
    );

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value).toEqual({
        pmcid: "PMC123",
        format: "text",
        sections: ["methods", "discussion"],
      });
    }
  });

  it("reads fulltext resources without server-side caching", async () => {
    const services = createMockServices();
    const result = await readArticleFulltextResource(
      new URL("article://fulltext/PMC123?format=markdown&sections=methods"),
      services,
    );

    expect(services.pubmed.getPMCFulltextHtmlAsync).toHaveBeenCalledOnce();
    expect(result.contents[0]).toMatchObject({
      uri: "article://fulltext/PMC123?format=markdown&sections=methods",
      mimeType: "text/markdown",
      text: "## Methods\n\nmethods",
    });
  });

  it("returns the complete fulltext resource instead of another preview", async () => {
    const longText = `## Fulltext\n\n${"A".repeat(2500)}`;
    const services = createMockServices();
    services.pubmed.getPMCFulltextHtmlAsync = vi.fn(async () => ({
      pmc_id: "PMC123",
      fulltext_xml: "<body />",
      fulltext_markdown: longText,
      fulltext_text: longText,
      fulltext_available: true,
      sections_found: [],
      sections_missing: [],
    })) as any;

    const result = await readArticleFulltextResource(
      new URL("article://fulltext/PMC123?format=markdown"),
      services,
    );

    expect((result.contents[0] as { text?: string }).text).toBe(longText);
  });

  it("returns structured JSON errors when fulltext is unavailable", async () => {
    const services = createMockServices();
    services.pubmed.getPMCFulltextHtmlAsync = vi.fn(async () => ({
      pmc_id: "PMC123",
      fulltext_available: false,
      error: "No fulltext available",
    })) as any;

    const result = await readArticleFulltextResource(
      new URL("article://fulltext/PMC123?format=xml"),
      services,
    );

    const content = result.contents[0] as { mimeType?: string; text?: string };
    expect(content.mimeType).toBe("application/json");
    expect(content.text).toContain("No fulltext available");
    expect(content.text).toContain('"success": false');
  });

  it("returns structured JSON errors for unsupported resource formats", async () => {
    const services = createMockServices();
    const result = await readArticleFulltextResource(
      new URL("article://fulltext/PMC123?format=pdf"),
      services,
    );

    const content = result.contents[0] as { mimeType?: string; text?: string };
    expect(services.pubmed.getPMCFulltextHtmlAsync).not.toHaveBeenCalled();
    expect(content.mimeType).toBe("application/json");
    expect(content.text).toContain("不支持的全文资源格式");
    expect(content.text).toContain('"success": false');
  });

  it("returns structured JSON errors when fulltext fetching throws", async () => {
    const services = createMockServices();
    services.pubmed.getPMCFulltextHtmlAsync = vi.fn(async () => {
      throw new Error("PubMed request failed");
    }) as any;

    const result = await readArticleFulltextResource(
      new URL("article://fulltext/PMC123?format=text"),
      services,
    );

    const content = result.contents[0] as { mimeType?: string; text?: string };
    expect(content.mimeType).toBe("application/json");
    expect(content.text).toContain("PubMed request failed");
    expect(content.text).toContain('"success": false');
    expect(content.text).toContain('"pmcid": "PMC123"');
  });

  it("offers useful completions for template variables", async () => {
    const template = new ResourceTemplate(
      "article://fulltext/{pmcid}{?format,sections}",
      {
        list: async () => ({ resources: [] }),
        complete: {
          pmcid: async (value: string) => ["PMC1234567", "PMC7654321"].filter((item) => item.includes(value)),
        },
      },
    );

    await expect(template.completeCallback("pmcid")?.("PMC1")).resolves.toEqual([
      "PMC1234567",
    ]);
  });
});
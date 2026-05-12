import { afterEach, describe, expect, it, vi } from "vitest";

import { PubMedService } from "../src/services/pubmed_search.js";
import { defaultApiClient } from "../src/utils/api_utils.js";

const SAMPLE_PMC_XML = `<?xml version="1.0" encoding="UTF-8"?>
<pmc-articleset>
  <article>
    <article-meta>
      <article-title>Machine Learning in Healthcare: A Comprehensive Review</article-title>
    </article-meta>
    <abstract>
      <title>Abstract</title>
      <p>This study explores machine learning in healthcare.</p>
    </abstract>
    <body>
      <sec sec-type="intro">
        <title>Introduction</title>
        <p>Machine learning is transforming healthcare.</p>
      </sec>
      <sec sec-type="methods">
        <title>Methods</title>
        <p>We collected data from 1000 patients.</p>
      </sec>
    </body>
  </article>
</pmc-articleset>`;

const SAMPLE_PMC_XML_WITH_SECTIONS = `<?xml version="1.0" encoding="UTF-8"?>
<pmc-articleset>
  <article>
    <article-meta>
      <article-title>Machine Learning in Healthcare</article-title>
    </article-meta>
    <body>
      <sec sec-type="intro">
        <title>Introduction</title>
        <p>This is the introduction section.</p>
        <p>Machine learning is transforming healthcare.</p>
      </sec>
      <sec sec-type="methods">
        <title>Methods</title>
        <p>We collected data from 1000 patients.</p>
        <p>The study was approved by the ethics committee.</p>
      </sec>
      <sec sec-type="results">
        <title>Results</title>
        <p>Our model achieved 95% accuracy.</p>
      </sec>
      <sec sec-type="discussion">
        <title>Discussion</title>
        <p>The results demonstrate the potential of ML in healthcare.</p>
      </sec>
      <sec sec-type="conclusion">
        <title>Conclusion</title>
        <p>Further research is needed to validate these findings.</p>
      </sec>
    </body>
  </article>
</pmc-articleset>`;

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * 创建用于测试的 PubMed 服务实例。
 *
 * @returns 带静默 logger 的 PubMed 服务实例。
 */
function createPubMedService(): PubMedService {
  return new PubMedService({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    log: vi.fn(),
  } as unknown as Console);
}

/**
 * 模拟 PMC XML 请求返回值。
 *
 * @param xml 需要返回的 XML 文本。
 */
function mockPmcXml(xml: string): void {
  vi.spyOn(defaultApiClient, "getText").mockResolvedValue(xml);
}

describe("PubMed fulltext conversion", () => {
  it("returns three formats and excludes article metadata from markdown", async () => {
    mockPmcXml(SAMPLE_PMC_XML);
    const pubmed = createPubMedService();

    const result = await pubmed.getPMCFulltextHtmlAsync("PMC1234567");

    expect(result.pmc_id).toBe("PMC1234567");
    expect(result.fulltext_available).toBe(true);
    expect(result.fulltext_xml).toContain("<body>");
    expect(result.fulltext_markdown).toContain("## Introduction");
    expect(result.fulltext_markdown).toContain("## Methods");
    expect(result.fulltext_markdown).not.toContain(
      "Machine Learning in Healthcare: A Comprehensive Review",
    );
    expect(result.fulltext_markdown).not.toContain(
      "This study explores machine learning in healthcare.",
    );
    expect(result.fulltext_text).toContain("Machine learning is transforming healthcare.");
    expect(result.fulltext_text).not.toContain("<sec");
  });

  it("extracts a single requested section and reports section metadata", async () => {
    mockPmcXml(SAMPLE_PMC_XML_WITH_SECTIONS);
    const pubmed = createPubMedService();

    const result = await pubmed.getPMCFulltextHtmlAsync("PMC1234567", ["methods"]);

    expect(result.fulltext_markdown).toContain("## Methods");
    expect(result.fulltext_markdown).toContain("We collected data from 1000 patients.");
    expect(result.fulltext_markdown).not.toContain("## Introduction");
    expect(result.sections_requested).toEqual(["methods"]);
    expect(result.sections_found).toEqual(["methods"]);
    expect(result.sections_missing).toEqual([]);
  });

  it("returns empty content when requested sections do not exist", async () => {
    mockPmcXml(SAMPLE_PMC_XML_WITH_SECTIONS);
    const pubmed = createPubMedService();

    const result = await pubmed.getPMCFulltextHtmlAsync("PMC1234567", ["appendix"]);

    expect(result.fulltext_available).toBe(true);
    expect(result.fulltext_xml).toBe("");
    expect(result.fulltext_markdown).toBe("");
    expect(result.fulltext_text).toBe("");
    expect(result.sections_found).toEqual([]);
    expect(result.sections_missing).toEqual(["appendix"]);
  });

  it("returns all sections without section metadata when sections is undefined", async () => {
    mockPmcXml(SAMPLE_PMC_XML_WITH_SECTIONS);
    const pubmed = createPubMedService();

    const result = await pubmed.getPMCFulltextHtmlAsync("PMC1234567", undefined);

    expect(result.fulltext_markdown).toContain("## Introduction");
    expect(result.fulltext_markdown).toContain("## Methods");
    expect(result.fulltext_markdown).toContain("## Discussion");
    expect(result).not.toHaveProperty("sections_requested");
    expect(result).not.toHaveProperty("sections_found");
    expect(result).not.toHaveProperty("sections_missing");
  });

  it("treats an empty section list as an explicit request for empty content", async () => {
    mockPmcXml(SAMPLE_PMC_XML_WITH_SECTIONS);
    const pubmed = createPubMedService();

    const result = await pubmed.getPMCFulltextHtmlAsync("PMC1234567", []);

    expect(result.fulltext_available).toBe(true);
    expect(result.fulltext_xml).toBe("");
    expect(result.fulltext_markdown).toBe("");
    expect(result.fulltext_text).toBe("");
    expect(result.sections_requested).toEqual([]);
    expect(result.sections_found).toEqual([]);
    expect(result.sections_missing).toEqual([]);
  });
});

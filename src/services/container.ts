import { ArxivSearchService } from "./arxiv_search.js";
import { CrossRefService } from "./crossref_service.js";
import { EasyScholarService } from "./easyscholar_service.js";
import { EuropePMCService } from "./europe_pmc.js";
import { createOpenAlexMetricsService } from "./openalex_metrics_service.js";
import { OpenAlexService } from "./openalex_service.js";
import { PubMedService } from "./pubmed_search.js";

export type ArticleMcpServices = {
  europePmc: EuropePMCService;
  pubmed: PubMedService;
  arxiv: ArxivSearchService;
  crossref: CrossRefService;
  openalex: OpenAlexService;
  easyscholar: EasyScholarService;
  openalexMetrics: ReturnType<typeof createOpenAlexMetricsService>;
};

/**
 * Creates the default service container used by the tool layer.
 *
 * @returns Wired services mirroring the Python dependency graph.
 */
export function createArticleMcpServices(): ArticleMcpServices {
  const pubmed = new PubMedService();

  return {
    europePmc: new EuropePMCService(console, pubmed),
    pubmed,
    arxiv: new ArxivSearchService(),
    crossref: new CrossRefService(),
    openalex: new OpenAlexService(),
    easyscholar: new EasyScholarService(),
    openalexMetrics: createOpenAlexMetricsService(),
  };
}

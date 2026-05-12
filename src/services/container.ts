import { ArxivSearchService } from "./arxiv_search.js";
import { CrossRefService } from "./crossref_service.js";
import { EasyScholarService } from "./easyscholar_service.js";
import { EuropePMCService } from "./europe_pmc.js";
import { createOpenAlexMetricsService } from "./openalex_metrics_service.js";
import { OpenAlexService } from "./openalex_service.js";
import { PubMedService } from "./pubmed_search.js";
import { UnifiedReferenceService } from "./reference_service.js";

export type ArticleMcpServices = {
  europePmc: EuropePMCService;
  pubmed: PubMedService;
  arxiv: ArxivSearchService;
  crossref: CrossRefService;
  referenceService: UnifiedReferenceService;
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
  const europePmc = new EuropePMCService(console, pubmed);
  const crossref = new CrossRefService();

  return {
    europePmc,
    pubmed,
    arxiv: new ArxivSearchService(),
    crossref,
    referenceService: new UnifiedReferenceService({ europePmc, crossref, pubmed }),
    openalex: new OpenAlexService(),
    easyscholar: new EasyScholarService(),
    openalexMetrics: createOpenAlexMetricsService(),
  };
}

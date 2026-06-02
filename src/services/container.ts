import { ArxivSearchService } from "./arxiv_search.js";
import { CrossRefService } from "./crossref_service.js";
import { EasyScholarService } from "./easyscholar_service.js";
import { EuropePMCService } from "./europe_pmc.js";
import { createOpenAlexMetricsService } from "./openalex_metrics_service.js";
import { OpenAlexService } from "./openalex_service.js";
import { PubMedService } from "./pubmed_search.js";
import { UnifiedReferenceService } from "./reference_service.js";

const stdioSafeLogger = Object.assign(Object.create(console), {
  log: console.error.bind(console),
  info: console.error.bind(console),
}) as Console;

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
 * 创建工具层使用的默认服务容器。
 *
 * @returns 与 Python 依赖图保持一致的已装配服务。
 */
export function createArticleMcpServices(): ArticleMcpServices {
  const pubmed = new PubMedService(stdioSafeLogger);
  const europePmc = new EuropePMCService(stdioSafeLogger, pubmed);
  const crossref = new CrossRefService();

  return {
    europePmc,
    pubmed,
    arxiv: new ArxivSearchService(stdioSafeLogger),
    crossref,
    referenceService: new UnifiedReferenceService({ europePmc, crossref, pubmed }),
    openalex: new OpenAlexService(),
    easyscholar: new EasyScholarService(30, stdioSafeLogger),
    openalexMetrics: createOpenAlexMetricsService(),
  };
}

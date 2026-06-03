/**
 * 统一解析 DOI、PMID、PMCID，并汇总跨服务的文献关系查询。
 */
import { CrossRefService } from "./crossref_service.js";
import { EuropePMCService } from "./europe_pmc.js";
import { PubMedService } from "./pubmed_search.js";

export type ReferenceIdentifierType = "auto" | "doi" | "pmid" | "pmcid";

type ResolvedReferenceIdentifiers = {
  doi?: string;
  pmid?: string;
  pmcid?: string;
};

type ReferenceQueryOptions = {
  identifier: string;
  idType?: ReferenceIdentifierType;
  sources?: string[];
  maxResults?: number;
  includeMetadata?: boolean;
};

type ReferenceServiceDependencies = {
  europePmc: EuropePMCService;
  crossref: CrossRefService;
  pubmed: PubMedService;
};

/**
 * 统一参考文献服务，对齐 Python 版 reference_service 的编排职责。
 */
export class UnifiedReferenceService {
  private readonly defaultSources = ["europe_pmc", "crossref", "pubmed"];

  public constructor(
    private readonly services: ReferenceServiceDependencies,
    private readonly logger: Console = console,
  ) {}

  /**
   * 获取并编排多源参考文献结果。
   *
   * @param options 参考文献查询参数。
   * @returns 与工具层兼容的统一参考文献结果。
   */
  public async getReferencesAsync(
    options: ReferenceQueryOptions,
  ): Promise<Record<string, unknown>> {
    const startTime = Date.now();
    const identifier = options.identifier.trim();
    const idType = options.idType ?? "doi";
    const includeMetadata = options.includeMetadata ?? true;
    const maxResults = options.maxResults ?? 20;
    const normalizedIdType = idType === "auto" ? this.extractIdentifierType(identifier) : idType;

    if (!identifier) {
      return {
        success: false,
        error: "文献标识符不能为空",
        identifier,
        id_type: normalizedIdType,
        resolved_identifier: {},
        sources_used: [],
        references_by_source: {},
        merged_references: [],
        total_count: 0,
        processing_time: 0,
      };
    }

    const resolved = await this.resolveArticleIdentifiers(identifier, normalizedIdType);
    const doiIdentifier =
      resolved.doi ?? (normalizedIdType === "doi" ? this.stripIdentifierPrefix(identifier) : null);
    const pmidIdentifier =
      resolved.pmid ??
      (normalizedIdType === "pmid" ? this.stripIdentifierPrefix(identifier) : null);
    const sourceList = options.sources?.length ? options.sources : this.defaultSources;

    const referencesBySource: Record<string, unknown[]> = {};
    let crossrefReferences: unknown[] = [];
    let pubmedReferences: unknown[] = [];
    let europePmcReferences: unknown[] = [];

    if (sourceList.includes("crossref") && doiIdentifier) {
      crossrefReferences = await this.getReferencesCrossrefAsync(doiIdentifier, maxResults);
    }

    if (sourceList.includes("pubmed") && pmidIdentifier) {
      const result = await this.services.pubmed.getCitingArticlesAsync(
        pmidIdentifier,
        undefined,
        maxResults,
      );
      pubmedReferences = Array.isArray(result.citing_articles) ? result.citing_articles : [];
    }

    if (sourceList.includes("europe_pmc")) {
      const lookup = this.buildEuropePmcReferenceLookup(
        identifier,
        normalizedIdType,
        resolved,
        doiIdentifier,
      );
      const result = await this.services.europePmc.getReferencesAsync(
        lookup.identifier,
        lookup.idType,
        maxResults,
      );
      europePmcReferences = Array.isArray(result.references) ? result.references : [];
    }

    if (sourceList.includes("europe_pmc") && crossrefReferences.length) {
      const referenceDois = this.uniqueReferenceDois(crossrefReferences).slice(0, maxResults);
      const enrichedArticles = referenceDois.length
        ? await this.services.europePmc.searchBatchDoiAsync(referenceDois)
        : [];
      europePmcReferences = this.appendMissingReferences(
        europePmcReferences,
        enrichedArticles.map((article) => this.formatEuropePmcReference(article)),
      );
    }

    if (europePmcReferences.length) {
      referencesBySource.europe_pmc = europePmcReferences;
    }
    if (pubmedReferences.length) {
      referencesBySource.pubmed = pubmedReferences;
    }
    if (crossrefReferences.length) {
      referencesBySource.crossref = crossrefReferences;
    }

    const filteredReferencesBySource = includeMetadata
      ? referencesBySource
      : Object.fromEntries(
          Object.entries(referencesBySource).map(([source, references]) => [
            source,
            references.map((reference) => this.trimReferenceMetadata(reference)),
          ]),
        );
    const mergedReferences = this.mergeReferences(referencesBySource, includeMetadata).slice(
      0,
      maxResults,
    );

    return {
      success: mergedReferences.length > 0,
      identifier,
      id_type: normalizedIdType,
      resolved_identifier: resolved,
      sources_used: Object.keys(filteredReferencesBySource),
      references_by_source: filteredReferencesBySource,
      merged_references: mergedReferences,
      total_count: mergedReferences.length,
      processing_time: Math.round(((Date.now() - startTime) / 1000) * 100) / 100,
    };
  }

  /**
   * 对齐 Python 版 `get_references_by_doi_async` 的公开服务入口。
   *
   * @param doi 文献 DOI。
   * @param maxResults 最大结果数。
   * @param includeMetadata 是否包含详细元数据。
   * @returns 统一参考文献结果。
   */
  public async getReferencesByDoiAsync(
    doi: string,
    maxResults = 20,
    includeMetadata = true,
  ): Promise<Record<string, unknown>> {
    return this.getReferencesAsync({
      identifier: doi,
      idType: "doi",
      maxResults,
      includeMetadata,
      sources: this.defaultSources,
    });
  }

  /**
   * 对齐 Python 版 `get_references_crossref_async` 的公开服务入口。
   *
   * @param doi 文献 DOI。
   * @param maxResults 最大结果数。
   * @returns CrossRef 参考文献列表。
   */
  public async getReferencesCrossrefAsync(doi: string, maxResults = 20): Promise<unknown[]> {
    const result = await this.services.crossref.getReferencesAsync(doi, maxResults);
    return Array.isArray(result.references) ? result.references : [];
  }

  /**
   * 自动识别标识符类型。
   *
   * @param identifier 文献标识符。
   * @returns 识别后的标识符类型。
   */
  private extractIdentifierType(identifier: string): "doi" | "pmid" | "pmcid" {
    const normalized = identifier.trim();
    const upper = normalized.toUpperCase();
    if (upper.startsWith("PMC") || upper.startsWith("PMCID:")) {
      return "pmcid";
    }
    if (/^\d+$/.test(normalized) || upper.startsWith("PMID:")) {
      return "pmid";
    }
    return "doi";
  }

  /**
   * 解析 DOI、PMID、PMCID 之间的可用标识符。
   *
   * @param identifier 原始标识符。
   * @param idType 标识符类型。
   * @returns 当前文献可解析出的标识符集合。
   */
  private async resolveArticleIdentifiers(
    identifier: string,
    idType: "doi" | "pmid" | "pmcid",
  ): Promise<ResolvedReferenceIdentifiers> {
    const normalizedIdentifier = this.stripIdentifierPrefix(identifier);

    if (idType === "doi") {
      const pmid = await this.services.pubmed.findPmidByDoiAsync(normalizedIdentifier);
      return { doi: normalizedIdentifier, ...(pmid ? { pmid } : {}) };
    }

    const details = await this.services.europePmc.getArticleDetailsAsync(
      normalizedIdentifier,
      idType,
    );
    const article = this.isRecord(details.article) ? details.article : null;
    if (!article) {
      return idType === "pmid"
        ? { pmid: normalizedIdentifier }
        : { pmcid: this.normalizePmcid(normalizedIdentifier) ?? normalizedIdentifier };
    }

    return {
      ...(typeof article.doi === "string" ? { doi: article.doi } : {}),
      ...(typeof article.pmid === "string" ? { pmid: article.pmid } : {}),
      ...(typeof article.pmcid === "string"
        ? { pmcid: article.pmcid }
        : typeof article.pmc_id === "string"
          ? { pmcid: article.pmc_id }
          : {}),
    };
  }

  /**
   * 按当前最优路径选择 Europe PMC references endpoint 所需的标识符。
   *
   * @param originalIdentifier 工具调用传入的原始标识符。
   * @param idType 已归一化的标识符类型。
   * @param resolved 已解析出的标识符集合。
   * @param doiIdentifier 供 CrossRef 路径使用的 DOI。
   * @returns Europe PMC references 查询参数。
   */
  private buildEuropePmcReferenceLookup(
    originalIdentifier: string,
    idType: "doi" | "pmid" | "pmcid",
    resolved: ResolvedReferenceIdentifiers,
    doiIdentifier: string | null,
  ): { identifier: string; idType: "doi" | "pmid" | "pmcid" } {
    if (idType === "pmid") {
      return { identifier: this.stripIdentifierPrefix(originalIdentifier), idType: "pmid" };
    }

    if (idType === "pmcid") {
      return {
        identifier:
          this.normalizePmcid(originalIdentifier) ?? this.stripIdentifierPrefix(originalIdentifier),
        idType: "pmcid",
      };
    }

    if (resolved.pmid) {
      return { identifier: resolved.pmid, idType: "pmid" };
    }

    if (resolved.pmcid) {
      return { identifier: resolved.pmcid, idType: "pmcid" };
    }

    if (doiIdentifier) {
      return { identifier: doiIdentifier, idType: "doi" };
    }

    return { identifier: originalIdentifier, idType };
  }

  /**
   * 将 Europe PMC 批量 DOI 查询结果转换为标准参考文献结构。
   *
   * @param item Europe PMC 原始文章记录。
   * @returns 统一参考文献结构。
   */
  private formatEuropePmcReference(item: Record<string, unknown>): Record<string, unknown> {
    return {
      title: item.title,
      authors: item.authorString ? String(item.authorString).split(",") : [],
      journal: this.isRecord(item.journalInfo)
        ? (item.journalInfo.journal as Record<string, unknown> | undefined)?.title
        : undefined,
      publication_date: item.firstPublicationDate,
      doi: item.doi,
      pmid: item.pmid,
      pmcid: item.pmcid,
      abstract: item.abstractText,
      source: "europe_pmc",
    };
  }

  /**
   * 追加主列表中缺失的参考文献。
   *
   * @param primary 已有参考文献列表。
   * @param additions 需要补充的参考文献列表。
   * @returns 追加缺失项后的列表。
   */
  private appendMissingReferences(primary: unknown[], additions: unknown[]): unknown[] {
    const combined = [...primary];
    const seenKeys = new Set(
      primary
        .map((reference) => (this.isRecord(reference) ? this.referenceKey(reference) : null))
        .filter((key): key is string => Boolean(key)),
    );

    for (const addition of additions) {
      if (!this.isRecord(addition)) {
        combined.push(addition);
        continue;
      }

      const key = this.referenceKey(addition);
      if (key && seenKeys.has(key)) {
        continue;
      }

      if (key) {
        seenKeys.add(key);
      }
      combined.push(addition);
    }

    return combined;
  }

  /**
   * 在关闭详细元数据时裁剪额外字段。
   *
   * @param reference 任意上游来源的参考文献记录。
   * @returns 去除详细元数据后的记录。
   */
  private trimReferenceMetadata(reference: unknown): unknown {
    if (!this.isRecord(reference)) {
      return reference;
    }

    const { abstract, volume, issue, pages, page, publisher, ...rest } = reference;
    void abstract;
    void volume;
    void issue;
    void pages;
    void page;
    void publisher;
    return rest;
  }

  /**
   * 合并多源参考文献并按来源优先级去重。
   *
   * @param referencesBySource 各来源参考文献集合。
   * @param includeMetadata 是否保留详细元数据。
   * @returns 合并后的参考文献列表。
   */
  private mergeReferences(
    referencesBySource: Record<string, unknown[]>,
    includeMetadata: boolean,
  ): Array<Record<string, unknown>> {
    const mergedByKey = new Map<string, Record<string, unknown>>();
    const sourcePriority: Record<string, number> = { europe_pmc: 1, pubmed: 2, crossref: 3 };

    for (const [source, references] of Object.entries(referencesBySource)) {
      for (const rawReference of references) {
        const reference = this.isRecord(rawReference) ? rawReference : { value: rawReference };
        const doi = String(reference.doi ?? reference.DOI ?? "")
          .trim()
          .toLowerCase();
        const title = String(reference.title ?? "")
          .trim()
          .toLowerCase()
          .replace(/\s+/g, " ");
        const key = doi ? `doi:${doi}` : title ? `title:${title}` : `${source}:${mergedByKey.size}`;

        const standardReference: Record<string, unknown> = {
          title: reference.title ?? "",
          authors: reference.authors ?? [],
          journal: reference.journal ?? reference.journal_name ?? "",
          publication_date: reference.publication_date ?? reference.year ?? "",
          doi: reference.doi ?? reference.DOI ?? "",
          pmid: reference.pmid ?? "",
          pmcid: reference.pmcid ?? reference.pmc_id ?? "",
          source,
        };

        if (includeMetadata) {
          standardReference.abstract = reference.abstract ?? "";
          standardReference.volume = reference.volume ?? "";
          standardReference.issue = reference.issue ?? "";
          standardReference.pages = reference.pages ?? reference.page ?? "";
          standardReference.publisher = reference.publisher ?? "";
        }

        const existing = mergedByKey.get(key);
        const existingPriority =
          sourcePriority[String(existing?.source)] ?? Number.MAX_SAFE_INTEGER;
        const currentPriority = sourcePriority[source] ?? Number.MAX_SAFE_INTEGER;

        if (!existing || currentPriority < existingPriority) {
          mergedByKey.set(key, standardReference);
        }
      }
    }

    return Array.from(mergedByKey.values()).sort(
      (left, right) =>
        (sourcePriority[String(left.source)] ?? 4) - (sourcePriority[String(right.source)] ?? 4),
    );
  }

  /**
   * 提取唯一 DOI，保持首次出现顺序。
   *
   * @param references 上游参考文献记录。
   * @returns 去重后的 DOI 列表。
   */
  private uniqueReferenceDois(references: unknown[]): string[] {
    const seen = new Set<string>();
    const dois: string[] = [];

    for (const reference of references) {
      if (!this.isRecord(reference)) {
        continue;
      }

      const doi = String(reference.doi ?? reference.DOI ?? "").trim();
      const normalizedDoi = doi.toLowerCase();
      if (!doi || seen.has(normalizedDoi)) {
        continue;
      }

      seen.add(normalizedDoi);
      dois.push(doi);
    }

    return dois;
  }

  /**
   * 为参考文献生成稳定去重键。
   *
   * @param reference 任意来源的参考文献记录。
   * @returns 基于 DOI 或标题的去重键。
   */
  private referenceKey(reference: Record<string, unknown>): string | null {
    const doi = String(reference.doi ?? reference.DOI ?? "")
      .trim()
      .toLowerCase();
    if (doi) {
      return `doi:${doi}`;
    }

    const title = String(reference.title ?? "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
    return title ? `title:${title}` : null;
  }

  /**
   * 去除常见标识符前缀。
   *
   * @param identifier DOI、PMID 或 PMCID。
   * @returns 去除前缀后的标识符。
   */
  private stripIdentifierPrefix(identifier: string): string {
    return identifier
      .replace(/^DOI:/i, "")
      .replace(/^PMID:/i, "")
      .replace(/^PMCID:/i, "")
      .trim();
  }

  /**
   * 规范化 PMCID。
   *
   * @param pmcid 原始 PMCID。
   * @returns 标准化 PMCID；非法时返回 null。
   */
  private normalizePmcid(pmcid: string): string | null {
    const trimmed = pmcid.trim();
    if (!trimmed) {
      return null;
    }

    const normalized = trimmed.startsWith("PMC") ? trimmed : `PMC${trimmed}`;
    return /^PMC\d+$/i.test(normalized) ? normalized.toUpperCase() : null;
  }

  /**
   * 判断未知值是否为对象记录。
   *
   * @param value 任意值。
   * @returns 是否为非空对象记录。
   */
  private isRecord(value: unknown): value is Record<string, any> {
    return typeof value === "object" && value !== null;
  }
}

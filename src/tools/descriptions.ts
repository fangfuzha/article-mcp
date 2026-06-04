/**
 * 维护工具说明文案目录及默认中文描述导出。
 */
export type ToolDescriptionLanguage = "zh-CN" | "en";

export const TOOL_DESCRIPTION_CATALOG = {
  "zh-CN": {
    search_literature: `多源文献搜索工具。用于查找文献并获取 PMCID。

⚠️ 此工具只返回元数据（标题、作者、摘要、PMCID等），不包含全文内容。
   如需获取全文，请使用返回结果中的 pmcid 调用"文献全文"工具。

配置提示：OpenAlex 源需要 OPENALEX_API_KEY；未配置时 OpenAlex 源会失败，但 Europe PMC、PubMed、arXiv、CrossRef 等其他源仍会尽力返回。

搜索策略：
- comprehensive: 全面搜索，使用所有可用数据源（并集）
- fast: 快速搜索，只使用主要数据源（Europe PMC、PubMed）
- precise: 精确搜索，只使用权威数据源（PubMed、Europe PMC，交集）
- preprint: 预印本搜索（arXiv）

主要参数：
- keyword: 搜索关键词（必填）
- sources: 数据源列表（可选，默认根据搜索策略自动选择）
- max_results: 每个源的最大结果数（默认10，范围1-100）
- search_type: 搜索策略（默认comprehensive）
- use_cache: 是否使用24小时缓存（默认true）

返回数据包含：标题、作者、期刊、摘要、PMCID、DOI等元数据（不含全文）`,
    get_article_details: `获取文献全文工具。

前置条件：需要 PMCID 标识符
- 如果您有 PMCID（如 PMC1234567），直接使用此工具
- 如果您只有关键词或标题，请先使用"文献搜索"工具查找并获取 PMCID

主要参数：
- pmcid: PMCID 标识符（必填）：单个或列表[PMC1234567, PMC2345678, ...]
         批量模式最多支持20个 PMCID
- sections: 全文章节控制（可选，默认None获取全部章节）
            None → 获取全部章节（全文）
            ["conclusion", "discussion"] → 只获取指定章节
- format: 全文格式（可选，默认"markdown"）
            "markdown" → Markdown格式（推荐，适合AI处理）
            "xml" → 原始XML格式
            "text" → 纯文本格式

数据源：Europe PMC + PMC 全文数据库
返回数据包含标题、作者、摘要、期刊、发表日期和全文内容

全文功能：
- 按需获取指定格式（默认Markdown）
- 支持按章节提取（如方法、讨论、结论等）
- 优化性能，只转换请求的格式

批量返回结构：
{
    "total": 10,           # 总请求数
    "successful": 8,       # 成功获取数
    "failed": 2,           # 失败数
    "articles": [...],     # 成功的文章列表（含全文）
    "fulltext_stats": {    # 全文统计
        "has_pmcid": 8,    # 有 PMCID 数量
        "fulltext_fetched": 8  # 成功获取全文数量
    }
}

支持的章节名称：
- methods（方法）: methods, methodology, materials and methods
- introduction（引言）: introduction, intro, background
- results（结果）: results, findings
- discussion（讨论）: discussion
- conclusion（结论）: conclusion, conclusions
- abstract（摘要）: abstract, summary
- references（参考文献）: references, bibliography`,
    get_references: `获取参考文献工具。通过文献标识符获取其引用的参考文献列表，支持智能去重。

主要参数：
- identifier: 文献标识符（必填）：DOI、PMID、PMCID
- id_type: 标识符类型（默认doi）：auto/doi/pmid/pmcid
- sources: 数据源列表（默认["europe_pmc", "crossref", "pubmed"]）
- max_results: 最大参考文献数量（默认20，范围1-100）
- include_metadata: 是否包含详细元数据（默认true）

支持的数据源：Europe PMC、CrossRef、PubMed
去重规则：优先按DOI去重，其次按标题去重；按数据源优先级排序`,
    get_literature_relations: `文献关系分析工具。分析文献间的引用关系、相似文献和引用网络。

关系类型：
- references: 该文献引用的参考文献
- similar: 相似文献
- citing: 引用该文献的文献

Configuration note: citing tries OpenAlex and Europe PMC by default; when sources is provided, only supported citing sources from that list (openalex/europe_pmc) are used. OpenAlex requires OPENALEX_API_KEY, while Europe PMC can act as a fallback source.

主要参数：
- identifiers: 文献标识符（单个或列表）：DOI、PMID、PMCID
- id_type: 标识符类型（默认auto）：auto/doi/pmid/pmcid
- relation_types: 关系类型列表（默认全部）：["references", "similar", "citing"]
- max_results: 每种关系类型最大结果数（默认20，范围1-100）
- analysis_type: 分析类型（默认basic）：basic/comprehensive/network
- max_depth: 分析深度（默认1）

分析模式：
- 单个文献：传入单个标识符
- 批量分析：传入标识符列表 + analysis_type="basic"
- 网络分析：传入标识符列表 + analysis_type="network"`,
    get_journal_quality: `期刊质量评估工具。评估期刊的学术质量和影响力指标，集成 EasyScholar + OpenAlex 双数据源。

支持的指标：
EasyScholar 提供：impact_factor（影响因子）、five_year_impact_factor（5年影响因子）、quartile（SCI分区 Q1-Q4）、jci（JCI指数）、cas_zone（中科院分区）、cas_zone_top（TOP期刊标识）
OpenAlex 提供：h_index（h指数）、citation_rate（2年引用率）、cited_by_count（总引用数）、works_count（总文章数）、i10_index（i10指数）

配置提示：EasyScholar 指标需要 EASYSCHOLAR_SECRET_KEY；OpenAlex 指标需要 OPENALEX_API_KEY。缺少任一配置时会自动降级到可用数据源，可能返回空指标或警告。

主要参数：
- journal_name: 期刊名称（单个或列表）
- include_metrics: 返回的指标列表（默认["impact_factor", "quartile", "jci"]）
- use_cache: 是否使用24小时缓存（默认true）
- sort_by: 排序字段，仅批量查询有效（默认null）：impact_factor/quartile/jci
- sort_order: 排序顺序，仅批量查询有效（默认desc）：desc降序/asc升序

使用示例：单个期刊查询、批量期刊查询、批量查询并排序、指定返回指标`,
  },
  en: {
    search_literature: `Search academic literature across multiple sources and return PMCID metadata.

This tool returns metadata only, including title, authors, abstract, PMCID, DOI, and journal information. It does not return full text. To fetch full text, call get_article_details with a PMCID from the search result.

Search strategies:
- comprehensive: Search all available sources and merge by union.
- fast: Search the primary sources only, Europe PMC and PubMed.
- precise: Search authoritative sources, PubMed and Europe PMC, and merge by intersection.
- preprint: Search preprints from arXiv.

Configuration note: the OpenAlex source requires OPENALEX_API_KEY. Without it, OpenAlex fails clearly while Europe PMC, PubMed, arXiv, and CrossRef still return best-effort results.

Main parameters:
- keyword: Search keyword (required).
- sources: Optional source list; defaults are selected by search strategy.
- max_results: Maximum results per source, default 10, range 1-100.
- search_type: Search strategy, default comprehensive.
- use_cache: Whether to use the 24-hour cache, default true.`,
    get_article_details: `Fetch article full text by PMCID.

Prerequisite: a PMCID identifier is required. If you only have a keyword or title, use search_literature first and then call this tool with the returned PMCID.

Main parameters:
- pmcid: PMCID identifier, required. Accepts one PMCID or a list of up to 20 PMCIDs.
- sections: Full-text section selection. Use null to fetch all sections, or pass a string/list for specific sections.
- format: Full-text format, default markdown. Supported values are markdown, xml, and text.

Data sources: Europe PMC and the PMC full-text database. The result includes title, authors, abstract, journal, publication date, and full-text content when available.`,
    get_references: `Fetch references cited by an article identifier and deduplicate them intelligently.

Main parameters:
- identifier: Article identifier, required. Supports DOI, PMID, and PMCID.
- id_type: Identifier type, default doi. Supports auto, doi, pmid, and pmcid.
- sources: Source list, default Europe PMC, CrossRef, and PubMed.
- max_results: Maximum references to return, default 20, range 1-100.
- include_metadata: Whether to include detailed metadata, default true.

Supported sources: Europe PMC, CrossRef, and PubMed. References are deduplicated by DOI first, then by title, and sorted by source priority.`,
    get_literature_relations: `Analyze article relationships, including references, similar articles, citing articles, and citation networks.

Relation types:
- references: References cited by the article.
- similar: Similar articles.
- citing: Articles that cite the article.

Configuration note: citing relationships try OpenAlex and Europe PMC by default; when sources is provided, only supported citing sources from that list (openalex/europe_pmc) are used. OpenAlex requires OPENALEX_API_KEY, while Europe PMC can act as a fallback source.

Main parameters:
- identifiers: One identifier or a list of identifiers. Supports DOI, PMID, and PMCID.
- id_type: Identifier type, default auto. Supports auto, doi, pmid, and pmcid.
- relation_types: Relation type list, default references, similar, and citing.
- max_results: Maximum results per relation type, default 20, range 1-100.
- analysis_type: Analysis type, default basic. Supports basic, comprehensive, and network.
- max_depth: Analysis depth, default 1.`,
    get_journal_quality: `Evaluate journal quality and impact metrics with EasyScholar and OpenAlex.

Supported metrics:
- EasyScholar: impact_factor, five_year_impact_factor, quartile, jci, cas_zone, and cas_zone_top.
- OpenAlex: h_index, citation_rate, cited_by_count, works_count, and i10_index.

Configuration note: EasyScholar metrics require EASYSCHOLAR_SECRET_KEY, and OpenAlex metrics require OPENALEX_API_KEY. Missing keys degrade to whichever source is available and may return empty metrics or warnings.

Main parameters:
- journal_name: Journal name, single value or list.
- include_metrics: Metric list to return, default impact_factor, quartile, and jci.
- use_cache: Whether to use the 24-hour cache, default true.
- sort_by: Sort field for batch queries only, supports impact_factor, quartile, and jci.
- sort_order: Sort order for batch queries only, desc or asc.`,
  },
} as const;

export const SEARCH_LITERATURE_DESCRIPTION = TOOL_DESCRIPTION_CATALOG["zh-CN"].search_literature;
export const GET_ARTICLE_DETAILS_DESCRIPTION =
  TOOL_DESCRIPTION_CATALOG["zh-CN"].get_article_details;
export const GET_REFERENCES_DESCRIPTION = TOOL_DESCRIPTION_CATALOG["zh-CN"].get_references;
export const GET_LITERATURE_RELATIONS_DESCRIPTION =
  TOOL_DESCRIPTION_CATALOG["zh-CN"].get_literature_relations;
export const GET_JOURNAL_QUALITY_DESCRIPTION =
  TOOL_DESCRIPTION_CATALOG["zh-CN"].get_journal_quality;

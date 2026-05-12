# Node 迁移后续 TODO

## 当前结论

Python 到 Node 的迁移尚未完成。

已完成的是 Node.js + TypeScript 项目骨架、MCP stdio 入口、5 个核心工具注册、基础参数校验、主要数据源服务的初版迁移、构建与发布脚本、基础 MCP 合规检查。当前项目可以通过类型检查、Lint、构建、单元测试和工具清单级 MCP 合规检查。

未完成的是与 Python 版的行为等价、深层业务逻辑、资源接口、缓存语义、测试覆盖和类型质量。Node 版目前更接近“可运行的迁移版基础实现”，还不是“完整替代 Python 版”的状态。

## 已验证命令

- [x] `npm run typecheck`：执行 TypeScript 类型检查，已通过。
- [x] `npm run lint`：执行 ESLint 代码规范检查，已通过。
- [x] `npm test`：执行 Vitest 测试，已通过，覆盖工具定义、缓存中间件和工具处理器边界行为。
- [x] `npm run version:check`：检查 `package.json` 与 `src/index.ts` 版本一致性，已通过。
- [x] `npm run build`：执行 tsup 构建，已通过。
- [x] `npm run test:mcp`：启动编译后的 stdio MCP 服务并检查工具清单，已通过，得分 100/100。

## P0：迁移完成前必须补齐

- [ ] 补齐 `search_literature` 的 Python 版行为等价。
  - 当前 Node 处理器接受 `search_type` 和 `use_cache`，但未真正按策略切换数据源、结果数、合并策略和缓存开关。
  - 需要迁移 Python 版 `SEARCH_STRATEGIES`、并行搜索、`union/intersection` 合并、按 DOI 合并去重、简单排序和 `cache_hit` 语义。
  - 验收标准：`comprehensive`、`fast`、`precise`、`preprint` 四种策略输出与 Python 版语义一致，并有单元测试覆盖。
  - 进展：已在 Node 工具处理器中补入四种搜索策略、并行搜索、`union/intersection` 合并、按 DOI/标题去重和策略测试；已补齐 Europe PMC、PubMed、arXiv、CrossRef 搜索的 `use_cache=false` 绕过缓存语义、服务级 `cache_hit` 汇总和 Python 版源优先级排序。后续仍可继续补全全局搜索缓存与更多策略断言。

- [ ] 补齐 `get_article_details` 的全文格式与章节处理。
  - 当前 Node 处理器解析了 `sections` 和 `format`，但没有传给全文服务，也没有只返回指定格式内容。
  - `PubMedService.getPMCFulltextHtmlAsync()` 目前只是粗略剥离 XML 标签，`sections_found` 和 `sections_missing` 为空，未等价迁移 `html_to_markdown.py` 的转换能力。
  - 需要支持字符串化 PMCID 数组容错、PMCID 格式校验、最多 20 个 PMCID 的错误返回、并发限制、`fulltext_stats`、`processing_time`。
  - 验收标准：`markdown/xml/text` 三种格式、单章节、多章节、无全文、非法 PMCID、批量超过 20 个场景均有测试。
  - 进展：已支持字符串化 PMCID 数组、PMCID 归一化、20 个上限、`sections` 传递、`markdown/xml/text` 内容选择、`fulltext_stats` 和处理时间；已补齐非法 PMCID 失败计数、批量超限提前返回、`no_fulltext` 统计和对应测试；PubMed 全文服务已能按常见章节标题提取内容。仍需迁移 Python 版更完整的 HTML/XML 转 Markdown 能力。

- [ ] 补齐 `get_references` 的统一参考文献服务。
  - Python 版通过 `reference_service` 做 DOI 引用、CrossRef 引用、Europe PMC 引用、多源并发、智能去重和 `include_metadata` 控制。
  - 当前 Node 版直接调用 CrossRef/PubMed/Europe PMC，其中 Europe PMC 分支只是搜索 identifier，不等价于获取参考文献；`include_metadata` 未生效。
  - 需要迁移 `reference_service.py` 的核心逻辑，支持 DOI/PMID/PMCID 自动识别和转换路径。
  - 验收标准：DOI、PMID、PMCID 三类输入均可返回去重后的 `merged_references`，并能关闭详细元数据。
  - 进展：已补入 `id_type=auto` 识别、多源并发、参考文献按 DOI/标题去重、来源优先级排序和 `include_metadata=false` 字段裁剪测试；PMID/PMCID 输入会先通过 Europe PMC 解析 DOI，再进入 CrossRef 查询链路；CrossRef 参考文献 DOI 会批量查询 Europe PMC 补充摘要、PMID、PMCID 等元数据，并在去重时优先保留 Europe PMC 结果。仍需完整迁移 `reference_service.py`，尤其是真正的 Europe PMC references 接口。

- [ ] 补齐 `get_literature_relations` 的关系分析。
  - 当前 Node 版只返回 CrossRef references 和 OpenAlex citing，未实现 `similar`，也未按 `relation_types` 过滤。
  - `analysis_type=network/comprehensive`、`max_depth`、PMID/PMCID 到 DOI 转换、网络节点边和指标均未迁移。
  - 需要迁移 Python 版 `relation_tools.py` 和 `similar_articles.py` 的核心行为，或明确删减并同步文档。
  - 验收标准：`references`、`similar`、`citing` 可独立选择；批量与网络分析有稳定输出结构和测试。
  - 进展：已按 `relation_types` 控制 `references`、`citing`、`similar` 字段输出，并补测试；`similar` 已接入 PubMed E-utils 相似文献查询；DOI 会解析 PMID，PMID/PMCID 会解析 DOI；`analysis_type=network/comprehensive` 会返回基础 `network_data.nodes/edges/clusters`。仍需迁移 Python 版完整网络指标、聚类、`max_depth` 深度分析和更细的 PMID/PMCID 转 DOI 兜底链路。

- [ ] 补齐 `get_journal_quality` 的缓存、指标过滤和排序。
  - 当前 Node 版调用 EasyScholar 与 OpenAlex，但 `include_metrics` 只回显不筛选；`use_cache` 仅传给 OpenAlex，EasyScholar 没有缓存；`sort_by/sort_order` 未实现。
  - Python 版有文件缓存、批量排序、可用指标集合和缓存资源。
  - 验收标准：单期刊和批量期刊都按 `include_metrics` 过滤，批量排序正确，`use_cache=false` 能绕过缓存。
  - 进展：已实现 `include_metrics` 指标筛选、OpenAlex `use_cache` 传递、批量 `sort_by/sort_order` 排序和测试。EasyScholar 文件缓存及缓存资源仍未迁移。

## P1：协议与资源能力补齐

- [ ] 迁移 MCP resources。
  - Python 版提供 `config://version`、`config://status`、`config://tools`、`journals://{journal_name}/quality`、`stats://cache`。
  - Node 版当前没有资源注册。
  - 验收标准：MCP 客户端可列出并读取上述资源，合规脚本覆盖资源清单。

- [ ] 补齐配置加载能力。
  - Python 版有 `mcp_config.py`，支持从 MCP 客户端配置读取环境变量和默认配置。
  - Node 版当前主要依赖 `.env` 和 `process.env`。
  - 验收标准：文档明确 Node 版配置来源；如保留 Python 版能力，则实现等价配置读取。

- [ ] 统一缓存策略。
  - 当前 Node 版主要是进程内 `Map` 缓存，Python 版搜索和期刊质量有文件缓存及缓存统计。
  - 需要决定 Node 版是否继续使用文件缓存；如果使用，补齐 TTL、目录、并发安全和统计资源。
  - 验收标准：`use_cache` 在所有声明支持的工具中语义一致。

- [ ] 统一错误返回结构。
  - 当前多数服务吞掉异常并返回 `{ success: false, error }`，工具层又有 MCP error boundary。
  - 需要定义哪些错误作为工具正常结果，哪些作为 MCP `isError`。
  - 验收标准：非法参数、上游超时、无结果、鉴权缺失四类错误结构一致。

## P2：类型质量与代码整理

- [ ] 移除服务层 `// @ts-nocheck`。
  - 当前 `arxiv_search.ts`、`crossref_service.ts`、`easyscholar_service.ts`、`europe_pmc.ts`、`openalex_service.ts` 均关闭类型检查。
  - 需要逐个补类型、修 NodeNext `.js` 导入、消除隐式 `any` 和错误的同步/异步混用。
  - 验收标准：服务层无 `@ts-nocheck`，`npm run typecheck` 仍通过。

- [ ] 删除或重构明显的迁移残留。
  - `EuropePMCService.getArticleDetailsSync()` 内部实际返回 Promise，且被 `@ts-nocheck` 掩盖。
  - 多处注释仍使用英文或中英混杂；按项目要求，除专有名词外注释应使用中文。
  - 验收标准：无伪同步接口，注释风格统一。

- [ ] 抽出共享数据模型。
  - 多个服务重复定义 `ArticleInfo`、`SearchResult` 等结构，字段名不完全一致。
  - 需要建立 `src/types` 或服务内公共模型，统一 `pmcid/pmc_id`、`journal/journal_name`、`publication_date` 等字段。
  - 验收标准：工具层不需要为每个数据源写大量字段兼容逻辑。

- [ ] 控制 MCP stdio 日志。
  - 服务层大量使用 `console.log/info/warn/error`。stdio MCP 对 stdout 敏感，日志应避免污染协议通道。
  - 验收标准：普通日志走 stderr 或可注入 logger；stdout 只用于 MCP 协议。

## P3：测试与发布准备

- [ ] 迁移 Python 版核心单元测试。
  - 优先迁移 `test_article_tools_format_param.py`、`test_article_tools_pmcid_normalization.py`、`test_reference_tools_async.py`、`test_relation_tools_async.py`、`test_quality_tools_sorting.py`、`test_search_tools_improvements.py`。
  - 验收标准：Node 版至少覆盖五个工具的正常路径、参数容错、空结果和上游错误。

- [ ] 增加服务层 mock 测试。
  - 使用 `nock`、`msw` 或 axios mock，避免测试依赖真实外网。
  - 验收标准：Europe PMC、PubMed、arXiv、CrossRef、OpenAlex、EasyScholar 均有解析和错误处理测试。

- [ ] 增加真实 API 冒烟测试。
  - 与单元测试分离，默认不在 CI 必跑，可用环境变量开启。
  - 验收标准：能验证至少一个公开 PMCID、一个 DOI、一个关键词搜索和一个 OpenAlex 期刊指标。

- [ ] 扩展 MCP 合规脚本。
  - 当前只检查工具清单、annotations 和 schema。
  - 需要增加资源检查、代表性工具调用、错误调用、stdout 污染检测。
  - 验收标准：`npm run test:mcp` 能发现工具运行期结构错误，而不只是注册错误。

- [ ] 更新 README 与迁移计划状态。
  - README 当前仍写着“迁移版首页草稿”和“服务层与测试后续补齐”，这与部分服务已迁移但行为未等价的状态不够精确。
  - `MIGRATION_PLAN.md` 应改成带状态的迁移看板，或链接本 TODO。
  - 验收标准：用户能从 README 清楚知道当前 Node 版可用范围和未完成限制。

## 建议执行顺序

1. 先修五个工具处理器的行为等价，优先级为 `get_article_details`、`get_references`、`search_literature`、`get_literature_relations`、`get_journal_quality`。
2. 同步迁移对应 Python 测试，确保每补一个行为就有测试锁住。
3. 再补 MCP resources、缓存统计和配置能力。
4. 最后移除 `@ts-nocheck`、统一类型模型、更新 README 并准备 npm 发布。

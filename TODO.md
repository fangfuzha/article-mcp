# 迁移 TODO（按架构层组织）

## 当前结论

Python 到 Node 的**基础迁移已经完成**。当前 Node 版已经具备可运行的 MCP stdio 服务、5 个核心工具、资源注册、工程化脚本、测试和发布配置，可以作为 Python 版的可用替代实现。

当前 Node 版已通过 `typecheck`、`lint`、`build`、`vitest`、`version:check` 和 `test:mcp`，MCP 合规检查分数为 `100/100`。入口、工具层、资源层和工程化配套均已落地。

尚未完成的是与 Python 版的**外部行为严格对齐**。剩余工作主要集中在少量语义差异与服务层收口，例如：更多 `get_article_details` 回归测试、`get_references` 的补测、以及若干服务层清理项。

## 已验证命令

- [x] `npm run typecheck`：执行 TypeScript 类型检查，已通过。
- [x] `npm run lint`：执行 ESLint 代码规范检查，已通过。
- [x] `npm test`：执行 Vitest 测试，已通过。
- [x] `npm run version:check`：检查 `package.json` 与 `src/index.ts` 版本一致性，已通过。
- [x] `npm run build`：执行 tsup 构建，已通过。
- [x] `npm run test:mcp`：启动编译后的 stdio MCP 服务并检查工具清单，已通过，得分 100/100。
- [x] `npm run test:all`：执行完整工程化门禁（typecheck/lint/build/test/test:mcp），已通过。

---

## 1. Middleware Stack（架构必须对齐）

**Python 现状：** 三个中间件按序执行：MCPErrorHandling → Logging → Timing。TimingMiddleware 自动为每个 `dict` 结果注入 `processing_time` 和 `timestamp`。LoggingMiddleware 记录每个请求的耗时和状态。

**Node 现状：** 已实现 ErrorBoundary、Logging、Timing 三层中间件，并由 `ToolExecutionPipeline` 统一编排。

**对齐目标：** `ToolExecutionPipeline` 应先注册 TimingMiddleware，再通过 createLoggingMiddleware 记录请求日志，最后用 ErrorBoundaryMiddleware 兜底异常。每个工具结果应自动包含 `processing_time` 和 `timestamp`。

- [x] 补齐 `createTimingMiddleware`——在工具结果（`CallToolResult`）的 `content[0].text` JSON 对象中注入 `processing_time` 和 `timestamp`。
- [x] 补齐 `createLoggingMiddleware`——使用 `console.error`（stderr）记录请求方法、耗时和状态。
- [x] 验证：每个工具响应包含 `processing_time` 和 `timestamp`；stderr 有请求日志。

---

## 2. MCP Resources（协议层必须对齐）

**Python 现状：** 提供 5 个资源 URIs：`config://version`、`config://status`、`config://tools`、`journals://{journal_name}/quality`、`stats://cache`。

**Node 现状：** 已注册 `config://version`、`config://status`、`config://tools`、`stats://cache` 和 `journals://{journalName}/quality`，但 `journals://` 目前还没有接入 EasyScholar 文件缓存。

**对齐目标：** 使用 `@modelcontextprotocol/sdk` 的 `server.resource()` 或 `server.resourceTemplate()` 注册等价资源。

- [x] 注册 `config://version`——返回 `"0.2.2"`。
- [x] 注册 `config://status`——返回 `{ status, server, version, timestamp, supported_data_sources }`。
- [x] 注册 `config://tools`——返回工具列表（名称、描述、类别）。
- [x] 注册 `journals://{journal_name}/quality`——从共享文件缓存读取期刊质量；无缓存时返回基础提示。
- [x] 注册 `stats://cache`——统计缓存目录的文件数、大小、最近访问时间。
- [x] 验证：`npm run test:mcp` 能列出并读取上述资源。

---

## 3. 缓存层（Python SearchCache 文件缓存）

**Python 现状：** `SearchCache` 类（`search_tools.py`）使用 SHA256 哈希作为缓存键，24 小时 TTL，文件系统缓存存储在 `~/.article_mcp_cache/`。同时记录 `hits`/`misses` 统计供 `stats://cache` 资源使用。

**Node 现状：** 搜索链路和期刊质量链路都已经具备文件缓存；期刊质量缓存还加入了文件级并发保护。

**对齐目标：** 新增 `SearchCache`（`src/middleware/search_cache.ts`），支持 SHA256 键生成、文件存储、TTL 过期、命中/未命中统计。`stats://cache` 资源从中读取统计。

- [x] 实现 `SearchCache` 类（文件 I/O 使用 `fs/promises`）。
- [x] 集成到 `search_literature` 工具处理器的搜索路径。
- [x] 验证：搜索后文件出现在 `~/.article_mcp_cache/`；缓存命中时跳过 API 调用。

---

## 4. 工具层行为对齐（P0 剩余语义）

### 4.1 `search_literature`

**已对齐：** 四种搜索策略、并行搜索、union/intersection 合并、DOI/标题去重、源优先级排序、`use_cache=false` 绕过缓存、服务级 `cache_hit` 汇总。

**仍缺：** 暂无明确行为缺口；后续以补测回归为主。

- [x] 集成 `SearchCache` 到 `search_literature` 的搜索路径。
- [x] 迁移 Python `test_search_tools_improvements.py` 中与缓存/策略相关的测试。

### 4.2 `get_article_details`

**已对齐：** PMCID 归一化、20 个上限、并发限制 5、`fulltext_stats`、`sections` 参数传递、三种格式输出、非法 PMCID 统计、`no_fulltext` 统计、`sections=None`/空章节语义、`html_to_markdown` 独立模块。

**仍缺：** 复杂格式转换的基础能力已补齐；后续主要以扩充回归测试覆盖为主。

- [x] 提升 `convertPmcXmlToMarkdown` 的复杂结构转换（公式、表格、列表）。
- [ ] 迁移更多 Python `test_article_tools_format_param.py` 和 `test_article_tools_pmcid_normalization.py` 的测试。

### 4.3 `get_references`

**已对齐：** `UnifiedReferenceService` 编排标识符解析、多源并发、Europe PMC references endpoint、Europe PMC 批量元数据补全、DOI/标题去重、源排序、`include_metadata` 裁剪（含 `references_by_source`）。

**仍缺：** 暂无显著行为缺口。Python `reference_service.py` 的剩余编排逻辑已基本等价。

- [ ] 无新增行为改动——如有回归风险，补测即可。

### 4.4 `get_literature_relations`

**已对齐：** `relation_types` 独立选择、`references` 复用统一参考文献服务、`similar` 接入 PubMed E-utils、DOI/PMID/PMCID 互转、`network_data` 基础节点/边/聚类、`max_depth>1` 引用网络展开。

**仍缺：** 暂无明确行为缺口；后续可继续补更广的网络分析回归测试。

- [x] 补齐网络分析指标（中心度、引用强度等）和聚类算法。
- [x] 让 `max_depth` 也影响 `citing` 和 `similar` 分支。

### 4.5 `get_journal_quality`

**已对齐：** `include_metrics` 筛选、OpenAlex `use_cache` 传递、批量 `sort_by/sort_order` 排序。

**仍缺：** 暂无明确能力缺口；后续可以继续补更接近 Python 并发测试矩阵的回归测试。

- [x] 补齐 EasyScholar 文件缓存，与 `SearchCache` 共用缓存目录 `~/.article_mcp_cache/`。
- [x] 迁移 Python `test_quality_tools_sorting.py` 的测试。
- [x] 补齐期刊缓存文件级并发保护。

---

## 5. 类型质量与服务层清理

**Python 现状：** 纯动态类型（Python 无编译期类型检查），但服务层结构清晰、无未使用的同步伪接口。

**Node 现状：** `@ts-nocheck` 已移除，类型检查可通过；剩余问题主要是服务 API 清理和共享类型收敛。

- [x] 逐个移除 `@ts-nocheck`，补齐缺失类型、修复 NodeNext `.js` 导入、消除隐式 `any`。
- [ ] `EuropePMCService.getArticleDetailsSync()` 改为真正的异步方法或删除。
- [ ] 注释统一为中文（除专有名词外）。
- [ ] 抽出共享数据模型 `src/types/`，统一字段名。

---

## 6. 发布前收口

- [x] 更新 `src/index.ts` 中注册 resources。
- [x] `npm run test:mcp` 覆盖资源检查。
- [ ] 更新 `README.md` 精确说明 Node 版状态。
- [ ] 更新 `CHANGELOG.md`。
- [x] 确认版本号一致（`version:check`）。
- [x] `npm run build` 生产构建。
- [x] `npm run test:mcp` 满分通过。

## P3：测试与发布准备

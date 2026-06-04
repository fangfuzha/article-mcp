# Changelog

本文档记录 Article MCP Node 迁移版的主要变更。

**主要用途**：Article MCP Node 迁移版主要用于学术文献与科研论文检索分析，尤其服务医学、生命科学和跨学科科研工作流，同时支持 arXiv 等通用预印本来源。

## 0.3.0 - 2026-06-04

### 新增

- `EuropePMCService.getCitationsAsync`：通过 Europe PMC citations endpoint 获取施引文献，作为施引数据的备选来源。
- Semantic Scholar 施引结果新增 `citation_contexts`、`citation_intents`、`is_influential_citation` 字段，提供引用上下文。
- OpenAlex 搜索和施引查询支持 `maxResults > 200` 时自动分页（`per_page` 按需请求）。
- `OpenAlexService.getCitationsAsync` 新增 24 小时缓存支持。
- `search_literature` 新增 `failed_sources` 和 `invalid_sources` 字段，报告失败和无效的数据源。

### 修复

- 修复 arXiv 搜索 URL 缺少 `?search_query=` 分隔符的问题，真实请求现在对齐官方 API。
- MCP Tool annotations 的 `openWorldHint` 改为 `true`，准确表达工具会访问外部学术数据源。
- 业务失败结果现在设置 MCP `isError: true`，避免客户端把失败结果误判为成功调用。
- arXiv API 由 HTTP 改为 HTTPS，避免每次请求经过 301 重定向。
- arXiv 错误响应（`title="Error"`）不再被解析为有效文献条目。
- `search_literature` 单个数据源失败不再阻塞其他源，改为「尽力而为」语义。
- `get_journal_quality` 缓存命中时不再错误过滤掉 OpenAlex 指标。
- `search_literature` now honors the requested `max_results` up to the documented 1-100 range instead of silently applying lower strategy caps.
- Degraded search results with failed sources are no longer written to the aggregate 24-hour cache.
- Tool error envelopes now keep `structuredContent.data: null` compatible with per-tool MCP `outputSchema` declarations.
- `get_article_details` now returns complete full-text content in `fulltext.content` and keeps a bounded `fulltext.preview` for quick inspection.
- `get_literature_relations` now rejects empty identifier requests and honors `sources` for citing lookups across OpenAlex and Europe PMC.
- `get_journal_quality` now returns an explicit error when no EasyScholar or OpenAlex metrics are available.
- `CrossRefService`、`OpenAlexService`、`OpenAlexMetricsService` 改用注入的 stdio-safe logger，不再直接写 console。
- 修正多处 `error` 级别日志为 `info` 级别（正常操作日志）。

### 优化

- OpenAlex 相关服务在缺少 `OPENALEX_API_KEY` 时返回明确配置错误，并新增默认 100ms 限流。
- NCBI 请求默认限流会根据是否配置 API key 自动选择 100ms 或 333ms。
- `CacheManager` 增加 1000 条容量上限，超出时淘汰过期/最旧条目，防止长时间运行内存无界增长。
- `RateLimiter` 任务失败时也等待延迟（防止绕过限速），并新增队列积压告警。
- `SearchCache` 改为原子写入（写临时文件再 rename），防止并发读取损坏。
- `format`、`relation_types` 参数改用 Zod enum 校验，提前拦截无效输入。
- NCBI `tool` 参数与 npm 包名统一为 `article-mcp`。
- 修正多处模块注释，确保准确描述实际功能。
- README 全面改版，对齐 MCP 社区文档规范：新增适用范围、VS Code 配置、调试章节、使用示例和数据源能力矩阵。

### 验证

- `npm run test:all` 全部通过（91/91 测试，MCP 合规 100/100）。

## 0.2.6 - 2026-06-03

### 变更

- 工具输出改为统一的 `structuredContent` 包装，`content` 首段保留摘要和关键摘录，并附带结构化 JSON 备份以兼容旧客户端。
- 服务器保持 Tools-only 形态，不注册 MCP Resources 或 Prompts，以提升客户端兼容性。
- 全文和文献关系结果均通过 tool 的结构化结果直接返回。
- MCP 合规脚本增加 `outputSchema`、资源模板和真实工具调用 `structuredContent` 检查。
- 服务容器注入 stdio-safe logger，避免后台检索日志写入 stdout 污染 MCP 协议通道。
- 默认服务构造器和导出单例复用 stdio-safe logger，并增加回归测试覆盖。

### 验证

- `npm run test:all` 全部通过（82/82 测试，MCP 合规 100/100）。

## 0.2.5 - 2026-06-02

### 变更

- 更新 npm 发布说明并补齐 v0.2.5 版本元数据。

## 0.2.4 - 2026-05-28

### 变更

- 添加 `repository`、`homepage`、`bugs` 字段，npm 包页面将指向 GitHub 仓库。

## 0.2.3 - 2026-05-28

### 变更

- 移除 MCP Resources，仅保留 Tools。资源功能对当前使用场景价值有限，精简后更聚焦核心文献搜索能力。
- README 推荐使用 `npx article-mcp@latest` 确保获取最新版本。

### 验证

- `npm run test:all` 全部通过（65/65 测试，MCP 合规 100/100）。

## 0.2.2 - 2026-05-14

### 新增

- 新增基于 Node.js + TypeScript 的 stdio MCP 服务入口。
- 迁移 `search_literature`、`get_article_details`、`get_references`、`get_literature_relations` 和 `get_journal_quality` 五个核心工具。
- 注册 `config://version`、`config://status`、`config://tools`、`stats://cache` 和 `journals://{journalName}/quality` 五个 MCP 资源。
- 新增搜索文件缓存与期刊质量共享文件缓存，缓存目录为 `~/.article_mcp_cache/`。
- 新增中间件执行链，覆盖错误边界、请求日志和计时字段注入。
- 新增 Node 工程化脚本、Vitest 测试、MCP 合规检查脚本、CI 工作流和 npm 发布配置。
- 新增工具说明语言配置，默认中文，可通过 `ARTICLE_MCP_LANG=en` 切换为英文。

### 变更

- 使用 `McpServer` 和 `registerTool` 对齐新版 `@modelcontextprotocol/sdk` API。
- 将 Python 参考实现移动到 `reference/article-mcp/`，仓库根目录保留给 Node 迁移版。
- 增强 PMC 全文转换，支持更完整的 Markdown、XML 和 text 输出。
- 对齐 Python 版主要参数容错语义，包括 PMCID 归一化、sections 单值/数组输入和 format 友好错误。
- 抽取 `src/types/` 共享数据模型，统一文献和期刊相关字段定义。
- 将源码注释统一为中文，保留 MCP、API、stdio 等专有名词。

### 修复

- 修复 MCP array schema 缺少 `items` 导致客户端校验失败的问题。
- 修复工具名类型宽化导致的处理器索引类型问题。
- 修复期刊质量缓存工具与资源不共享的问题，并增加文件级并发保护。
- 删除 Europe PMC 服务中的同步伪接口，统一使用异步实现。

### 验证

- `npm run test:all` 覆盖 `typecheck`、`lint`、`build`、`test` 和 `test:mcp`。
- MCP 合规检查目标为 `100/100`。

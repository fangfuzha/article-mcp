# Changelog

本文档记录 Article MCP Node 迁移版的主要变更。

## 0.2.5 - 2026-06-02

### 变更

- 工具输出改为统一的 `structuredContent` 包装，`content` 仅保留摘要和关键摘录。
- 新增 `article://fulltext/{pmcid}?format={format}&sections={sections}` 全文资源，按需重取完整内容。
- 新增 `article://relations/{identifier}{?id_type,relation_types,analysis_type,max_results,max_depth,sources}` 文献关系资源，按需重算关系分析结果。
- 资源读取失败时返回结构化 JSON 错误，避免直接抛出裸异常。
- MCP 合规脚本增加 `outputSchema`、资源模板和真实工具调用 `structuredContent` 检查。

### 验证

- `npm run test:all` 全部通过（81/81 测试，MCP 合规 100/100）。

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

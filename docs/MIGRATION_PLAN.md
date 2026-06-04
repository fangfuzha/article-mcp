# Article MCP (Migrate to Node.js) 迁移计划表

基于原 Python 版本的 `article-mcp` 的模块拆分，我们将项目整体迁移至 Node.js 环境。推荐使用 **TypeScript** 辅以 **@modelcontextprotocol/sdk** 以最大限度保留原有的严谨性和架构形态。

**主要用途**：迁移后的 MCP 服务面向学术文献与科研论文检索分析，重点服务医学、生命科学和跨学科科研工作流，同时保留 arXiv 等通用预印本检索能力。

## 阶段一：项目初始化与基础设施搭建

1. **创建并初始化项目**
   - 初始化 `package.json`，启用 ES Modules (`"type": "module"`)。
   - 配置 `tsconfig.json`，目标环境推荐 `Node >= 18`。
   - 配置打包和检查工具：`esbuild` 或 `tsc` 用于构建，`eslint` / `prettier` 用于代码规范。
2. **核心依赖安装**
   - MCP官方SDK：`@modelcontextprotocol/sdk`
   - 参数校验：`zod` (对应 Python 中的 Pydantic 类型注解)
   - 网络请求：`axios` 或直接使用 Node 内置 `fetch`
   - 限流和并发控制：例如 `p-limit` 或自定义相关的限流器 (代替 Python中的异步并发与限流装饰器)
   - 环境变量管理：`dotenv`

## 阶段二：底层服务（Services & Middleware）迁移

_对应原仓库路径：`src/article_mcp/services/` 和 `src/article_mcp/middleware/`_

1. **数据源服务迁移**
   逐个将 Python `httpx`/`aiohttp` 异步请求改造为 Node 异步请求：
   - `Europe PMC Service`: 文献全问获取、摘要与参考文献检索。
   - `arXiv Service`: 预印本元数据获取。
   - `CrossRef Service`: 参考文献关系抓取。
   - `OpenAlex Service`: 学术图谱、期刊、作者查询。
   - `EasyScholar Service`: 学术期刊分区与质量指标。
   - `PubMed Service`: PubMed ID 转换与补充查询。
2. **中间件与拦截器**
   - **速率限制 (Rate Limiting)**：为各自的数据源实现队列限流机制（例如 Europe PMC 要求 `1 req/s`）。
   - **错误重试与容错机制**：实现 HTTP 调用的自动重试拦截。

## 阶段三：MCP 工具注册与主程序接入

_对应原仓库路径：`src/article_mcp/tools/`、`cli.py` 和 `__main__.py`_

1. **定义 MCP Method 与 Zod Schema**
   将原基于 `FastMCP` (@mcp.tool) 的装饰器迁移为官方 Node Server 的 `server.setRequestHandler`：
   - 编写 `search_literature` 对应的 Zod Schema 并注册 Handler。
   - 编写 `get_article_details` 工具，并重构参数容错逻辑 (如 string 转 array 问题)。
   - 编写 `get_references`、`get_literature_relations`、`get_journal_quality` 等工具。
2. **配置 StdIO 通信基座**
   - 使用 `StdioServerTransport` 对接 `Server`。
   - 实现生命周期管理与优雅退出逻辑。

## 阶段四：测试迁移与持续集成

_对应原仓库路径：`tests/`_

1. **单元测试环境搭建**
   - 引入 `vitest` 或 `jest` 及对应的网络 Mock 工具（如 `msw` 或 `nock`）。
2. **重写集成与服务测试**
   - 测试各类数据源在限流和错误返回值下是否按预期处理。
   - 检验 MCP Tool 调用 Schema 校验是否正常拦截异常参数。

## 阶段五：CLI 发布与文档更新

1. **配置 Bin 入口**
   - 在 `package.json` 中配置 `"bin": { "article-mcp": "dist/index.js" }`。
2. **打包并发布测试**
   - 修改 `README.md` 中的安装方式（从 `uvx article-mcp` 变为 `npx article-mcp` 或全局 npm 安装）。
   - 提供使用 npm / bun / pnpm 的 Claude Desktop 配置示例。

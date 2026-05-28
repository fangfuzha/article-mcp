# Article MCP 文献检索服务器

[中文](README.md) | [English](README.en.md)

> 基于 Node.js + TypeScript 的 Article MCP 迁移版本。
>
> **🙏 原始项目致敬**
>
> 本项目是对 [gqy20/article-mcp](https://github.com/gqy20/article-mcp) Python 版本的迁移实现。原项目采用 FastMCP 框架构建，感谢原作者的优秀设计与开源贡献。本版本保留了核心架构设计理念，将其适配至 Node.js + TypeScript 生态。

Article MCP 通过 MCP 协议为 Claude Desktop、Cherry Studio 和其他兼容客户端提供多源文献检索能力，聚合 Europe PMC、PubMed、arXiv、CrossRef、OpenAlex 与 EasyScholar 等数据源。

## 当前迁移状态

当前 Node 版以 Python `0.2.2` 为行为基线，基础迁移已经完成：stdio MCP 服务、5 个核心工具、文件缓存、工程化脚本、CI 工作流和发布配置均已落地。

已完成的对齐范围包括：工具输入 schema、只读工具标注、搜索缓存、期刊质量缓存、PMC 全文 Markdown/XML/text 输出、参考文献聚合、文献关系网络扩展，以及与 Python 版一致的主要参数容错行为。

当前发布前门禁以 `npm run test:all` 为准，覆盖 TypeScript 类型检查、ESLint、生产构建、Vitest 测试和 MCP stdio 合规检查。

## 核心能力

- 多源文献搜索
- 获取文献全文
- 获取参考文献
- 文献关系分析
- 期刊质量评估
- 基于 Zod 的输入校验
- 通过 stdio 对接 MCP 客户端
- 支持通过 `.env` 配置可选的 `EASYSCHOLAR_SECRET_KEY`
- 工具说明默认中文，可通过 `ARTICLE_MCP_LANG=en` 切换为英文

## 快速开始

### 环境要求

- Node.js 18 或更高版本
- npm 9 或更高版本

### 安装与启动

```bash
git clone https://github.com/gqy20/article-mcp.git
cd article-mcp
npm install
npm run build
npm start
```

### 开发模式

```bash
npm run dev
```

### 命令行方式

如果已经安装依赖，可以直接通过本地 CLI 启动：

```bash
npm start
```

也支持显式子命令：

```bash
npm start -- server
npm start -- info
```

包发布到 npm 后，也可以通过 `npx article-mcp@latest` 启动（推荐添加 `@latest` 确保使用最新版本）：

```bash
npx article-mcp@latest server
npx article-mcp@latest info
```

## 客户端配置

### Claude Desktop

本地开发时建议先执行 `npm run build`，然后使用编译后的入口：

```json
{
  "mcpServers": {
    "article-mcp": {
      "command": "node",
      "args": ["E:/path/to/article-mcp/dist/index.js"],
      "env": {
        "EASYSCHOLAR_SECRET_KEY": "your_key_here",
        "ARTICLE_MCP_LANG": "zh-CN"
      }
    }
  }
}
```

发布到 npm 后可改用包名启动（推荐添加 `@latest` 确保使用最新版本）：

```json
{
  "mcpServers": {
    "article-mcp": {
      "command": "npx",
      "args": ["article-mcp@latest"],
      "env": {
        "EASYSCHOLAR_SECRET_KEY": "your_key_here",
        "ARTICLE_MCP_LANG": "zh-CN"
      }
    }
  }
}
```

### Cherry Studio

```json
{
  "mcpServers": {
    "article-mcp": {
      "command": "npx",
      "args": ["article-mcp@latest"],
      "env": {
        "EASYSCHOLAR_SECRET_KEY": "your_key_here",
        "ARTICLE_MCP_LANG": "zh-CN"
      }
    }
  }
}
```

`EASYSCHOLAR_SECRET_KEY` 为可选项，但在期刊质量查询场景下建议配置，以获得更完整的指标结果。请访问 [EasyScholar](https://www.easyscholar.cc) 注册获取。

未配置该密钥、密钥无效，或 EasyScholar 服务暂时不可用时，`get_journal_quality` 不会整体失败，而是自动退化为 OpenAlex-only 模式：继续返回 `h_index`、`citation_rate`、`cited_by_count`、`works_count`、`i10_index` 等 OpenAlex 指标，并在返回结果的 `warning` 字段中说明降级原因。

### 工具说明语言

工具名、参数名和返回字段名保持稳定，不会随语言配置变化。工具标题、工具描述和参数说明默认使用中文；需要英文说明时，在 MCP client 配置中设置：

```json
{
  "env": {
    "ARTICLE_MCP_LANG": "en"
  }
}
```

支持的值：`zh-CN`（默认）和 `en`。切换后通常需要重启 MCP server 或重新连接客户端，因为部分客户端会缓存 `tools/list`。

## 工具概览

当前版本对外暴露 5 个只读工具：

| 工具名                     | 作用                                                         | 主要参数                                                                                                          |
| -------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `search_literature`        | 多源文献搜索                                                 | `keyword`, `sources`, `max_results`, `search_type`, `use_cache`                                                   |
| `get_article_details`      | 获取文献全文                                                 | `pmcid`, `sections`, `format`                                                                                     |
| `get_references`           | 获取参考文献                                                 | `identifier`, `id_type`, `sources`, `max_results`, `include_metadata`                                             |
| `get_literature_relations` | 文献关系分析                                                 | `identifier` / `identifiers`, `id_type`, `relation_types`, `max_results`, `sources`, `analysis_type`, `max_depth` |
| `get_journal_quality`      | 期刊质量评估（EasyScholar 不可用时自动退化为 OpenAlex-only） | `journal_name`, `include_metrics`, `use_cache`, `sort_by`, `sort_order`                                           |

## 缓存说明

搜索缓存与期刊质量缓存都存放在用户目录下的 `~/.article_mcp_cache/`。搜索缓存使用 SHA256 键和 24 小时 TTL；期刊质量缓存使用共享文件缓存，并带有文件级并发保护，供 `get_journal_quality` 工具使用。

## 数据源说明

### Europe PMC

- 内容：生物医学文献全文、摘要与参考文献
- 速率限制：约 1 req/s
- 用途：搜索、全文获取、参考文献检索

### PubMed

- 内容：生物医学文献摘要与补充元数据
- 速率限制：无严格限制
- 用途：搜索补充与结果校验

### arXiv

- 内容：预印本论文元数据
- 速率限制：按接口要求控制请求频率
- 用途：预印本搜索

### CrossRef

- 内容：跨出版社元数据与引用关系
- 速率限制：按官方接口策略控制
- 用途：参考文献与 DOI 关系查询

### OpenAlex

- 内容：开放学术图谱、作者、期刊与引用网络
- 速率限制：通常较宽松
- 用途：引用关系、h 指标与文章网络分析

### EasyScholar

- 内容：期刊分区与质量指标
- 速率限制：建议配置密钥后使用
- 用途：影响因子、分区、JCI 等指标评估

## 参数兼容说明

迁移版在参数处理上保留了较强的兼容性，便于不同 MCP 客户端直接调用：

- `get_article_details` 的 `pmcid` 支持单个值或列表
- `get_article_details` 的 `sections` 支持单个值、列表或空值
- `get_literature_relations` 同时兼容 `identifier` 与 `identifiers`
- `get_journal_quality` 的 `journal_name` 与 `include_metrics` 支持单值或列表

## 使用示例

### 搜索文献

```json
{
  "keyword": "machine learning",
  "max_results": 10,
  "search_type": "comprehensive"
}
```

### 指定数据源搜索

```json
{
  "keyword": "cancer",
  "sources": ["europe_pmc", "arxiv"]
}
```

### 获取文献全文

```json
{
  "pmcid": "PMC1234567",
  "format": "markdown"
}
```

### 仅获取指定章节

```json
{
  "pmcid": "PMC1234567",
  "sections": ["methods", "results"]
}
```

### 获取参考文献

```json
{
  "identifier": "10.1038/nature12373",
  "id_type": "doi",
  "max_results": 20
}
```

### 文献关系分析

```json
{
  "identifiers": "10.1038/nature12373",
  "relation_types": ["references", "similar"]
}
```

### 期刊质量评估

```json
{
  "journal_name": "Nature",
  "include_metrics": ["impact_factor", "quartile", "jci"]
}
```

如果未配置有效的 `EASYSCHOLAR_SECRET_KEY`，该工具会退化为 OpenAlex-only 模式。此时返回结果会包含 OpenAlex 指标，并在 `warning` 字段中说明 EasyScholar 不可用的原因。

## 开发说明

- 构建：`npm run build`
- 开发：`npm run dev`
- 运行：`npm start`
- 类型检查：`npm run typecheck`
- Lint：`npm run lint`
- 格式化检查：`npm run format:check`
- 单元/集成测试：`npm test`
- MCP 合规检查：`npm run test:mcp`
- 发布前完整检查：`npm run test:all`
- 版本一致性检查：`npm run version:check`
- CLI：`npx article-mcp`

工程化文件参考 Python 版补齐了 Node 对应实现：`.github/workflows/node-mcp-compliance.yml` 负责 CI 合规检查，`.github/workflows/publish.yml` 负责 tag 发布到 npm，`scripts/sync-version.ts` 负责版本同步，`scripts/test-mcp-compliance.ts` 负责 stdio MCP 合规检查。

项目使用 `@modelcontextprotocol/sdk`、`zod`、`axios`、`axios-retry`、`fast-xml-parser` 和 `dotenv` 作为基础依赖。

## 项目结构

```text
src/
  index.ts              # MCP server 入口
  middleware/           # 错误边界、日志、计时和搜索缓存
  services/             # 外部数据源与聚合服务
  tools/                # 工具定义、schema、注册和处理器
  types/                # 共享文献与期刊数据模型
scripts/                # 版本同步与 MCP 合规检查脚本
tests/                  # Vitest 回归测试
reference/article-mcp/  # Python 原项目参考实现
```

## 许可证

MIT License

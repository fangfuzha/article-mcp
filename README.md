# Article MCP 文献检索服务器

> 基于 Node.js + TypeScript 的 Article MCP 迁移版首页草稿。
> 当前仓库正在从 Python 版本迁移到 Node.js 版本，核心 MCP 入口、工具注册与参数校验已经搭建完成，服务层与测试会在后续版本继续补齐。

Article MCP 通过 MCP 协议为 Claude Desktop、Cherry Studio 和其他兼容客户端提供多源文献检索能力，聚合 Europe PMC、PubMed、arXiv、CrossRef、OpenAlex 与 EasyScholar 等数据源。

## 核心能力

- 多源文献搜索
- 获取文献全文
- 获取参考文献
- 文献关系分析
- 期刊质量评估
- 基于 Zod 的输入校验
- 通过 stdio 对接 MCP 客户端
- 支持通过 `.env` 配置可选的 `EASYSCHOLAR_SECRET_KEY`

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

如果已经安装依赖，也可以直接通过 CLI 启动：

```bash
npx article-mcp
```

## 客户端配置

### Claude Desktop

```json
{
  "mcpServers": {
    "article-mcp": {
      "command": "npx",
      "args": ["article-mcp"],
      "env": {
        "EASYSCHOLAR_SECRET_KEY": "your_key_here"
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
      "args": ["article-mcp"],
      "env": {
        "EASYSCHOLAR_SECRET_KEY": "your_key_here"
      }
    }
  }
}
```

`EASYSCHOLAR_SECRET_KEY` 为可选项，但在期刊质量查询场景下建议配置，以获得更完整的指标结果。

## 工具概览

当前版本对外暴露 5 个只读工具：

| 工具名                     | 作用         | 主要参数                                                                                                          |
| -------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------- |
| `search_literature`        | 多源文献搜索 | `keyword`, `sources`, `max_results`, `search_type`, `use_cache`                                                   |
| `get_article_details`      | 获取文献全文 | `pmcid`, `sections`, `format`                                                                                     |
| `get_references`           | 获取参考文献 | `identifier`, `id_type`, `sources`, `max_results`, `include_metadata`                                             |
| `get_literature_relations` | 文献关系分析 | `identifier` / `identifiers`, `id_type`, `relation_types`, `max_results`, `sources`, `analysis_type`, `max_depth` |
| `get_journal_quality`      | 期刊质量评估 | `journal_name`, `include_metrics`, `use_cache`, `sort_by`, `sort_order`                                           |

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

## 许可证

MIT License

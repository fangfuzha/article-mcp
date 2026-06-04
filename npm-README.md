# Article MCP

[![npm version](https://img.shields.io/npm/v/article-mcp.svg)](https://www.npmjs.com/package/article-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

基于 [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) 的学术文献搜索服务器。帮助 LLM 搜索、获取和分析多数据源学术文献。

**主要用途**：面向学术文献与科研论文检索分析，尤其适合医学、生命科学和跨学科科研场景；同时支持 arXiv 等通用科研预印本来源。

## 适用范围

- **学术写作辅助** — 查找最新研究文献作为引用来源
- **文献综述** — 跨多个学术数据库检索和分析文献
- **期刊质量评估** — 评估目标期刊的学术影响力（影响因子、分区等）
- **文献关系分析** — 构建引用网络、发现相似文献

支持 **6 个学术数据源**：Europe PMC、PubMed、arXiv、CrossRef、OpenAlex、Semantic Scholar。

## 快速开始

```bash
# 直接运行（推荐，自动获取最新版本）
npx article-mcp@latest

# 或全局安装
npm install -g article-mcp
article-mcp
```

### MCP 客户端配置

```json
{
  "mcpServers": {
    "article-mcp": {
      "command": "npx",
      "args": ["article-mcp@latest"],
      "env": {
        "OPENALEX_API_KEY": "your_openalex_key_here",
        "EASYSCHOLAR_SECRET_KEY": "your_easyscholar_key_here"
      }
    }
  }
}
```

## 可用工具

| 工具                       | 说明                                                                                                                             |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `search_literature`        | 多源文献搜索，4 种策略，自动去重排序；OpenAlex 源需要 `OPENALEX_API_KEY`                                                         |
| `get_article_details`      | 获取 PMC 全文（Markdown/XML/Text），批量 20 篇                                                                                   |
| `get_references`           | 参考文献列表，智能 DOI/标题去重                                                                                                  |
| `get_literature_relations` | Citation networks, citing papers, and similar papers; citing defaults to OpenAlex + Europe PMC and can be limited with `sources` |
| `get_journal_quality`      | 期刊质量指标（影响因子、分区、JCI、h 指数）；EasyScholar/OpenAlex 按 key 可用性降级                                              |

## 环境变量

| 变量                       | 必需                  | 获取地址/配置作用                                                       | 缺失后果                                            |
| -------------------------- | --------------------- | ----------------------------------------------------------------------- | --------------------------------------------------- |
| `OPENALEX_API_KEY`         | OpenAlex 相关能力需要 | [OpenAlex account](https://openalex.org/account)                        | OpenAlex 源失败；施引和 OpenAlex 期刊指标不可用     |
| `EASYSCHOLAR_SECRET_KEY`   | 期刊影响因子/分区需要 | [EasyScholar 开放平台](https://www.easyscholar.cc/console/user/open)    | 期刊质量只尝试 OpenAlex 指标，影响因子/分区可能为空 |
| `NCBI_EMAIL`               | 推荐                  | NCBI E-utilities 联系邮箱                                               | 仍可请求，但不利于 NCBI 联系和合规使用              |
| `NCBI_API_KEY`             | 可选                  | [NCBI API key](https://www.ncbi.nlm.nih.gov/account/settings/)          | PubMed/PMC 速率按 3 req/s 保守限制                  |
| `CROSSREF_MAILTO`          | 推荐                  | Crossref Polite Pool 邮箱                                               | 仍可请求，但不会进入 Polite Pool                    |
| `SEMANTIC_SCHOLAR_API_KEY` | 推荐                  | [Semantic Scholar API key](https://www.semanticscholar.org/product/api) | 施引上下文请求更容易受限                            |
| `OPENALEX_RATE_LIMIT_MS`   | 可选                  | OpenAlex 请求间隔覆盖值，默认 100ms                                     | 使用默认限流                                        |
| `ARXIV_RATE_LIMIT_MS`      | 可选                  | arXiv 请求间隔覆盖值，默认 3000ms                                       | 使用默认限流                                        |
| `EUROPE_PMC_RATE_LIMIT_MS` | 可选                  | Europe PMC 请求间隔覆盖值，默认 1000ms                                  | 使用默认限流                                        |
| `NCBI_RATE_LIMIT_MS`       | 可选                  | NCBI 请求间隔覆盖值；未设置时有 key 默认 100ms，无 key 默认 333ms       | 使用自动限流                                        |
| `ARTICLE_MCP_LANG`         | 可选                  | 工具说明语言：`zh-CN`（默认）或 `en`                                    | 使用中文工具说明                                    |

## 输出说明

- `structuredContent` 使用统一的 `{ success, data, meta, warnings, error }` 结构
- `content` 首段为可读摘要和关键摘录，次段为 JSON 备份以兼容旧客户端
- 服务器仅注册 Tools，不注册 Resources 或 Prompts
- `get_article_details` returns complete full text in `fulltext.content` plus a bounded `fulltext.preview`; `get_journal_quality` returns an error when no metrics are available

## 文档

完整文档见 [GitHub 仓库](https://github.com/fangfuzha/article-mcp)。

## 许可证

MIT © [fangfuzha](https://github.com/fangfuzha)

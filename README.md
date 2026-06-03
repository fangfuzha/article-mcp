# Article MCP

[![npm version](https://img.shields.io/npm/v/article-mcp.svg)](https://www.npmjs.com/package/article-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Article MCP 是一个基于 [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) 的学术文献搜索服务器，支持多数据源检索和分析。

## 功能特性

- 🔍 **多源文献搜索** - 支持 Europe PMC、PubMed、arXiv、CrossRef、OpenAlex
- 📄 **文献详情获取** - 获取全文内容，支持 Markdown/XML/Text 格式，结果由 tool 直接返回
- 📚 **参考文献获取** - 智能去重，多数据源合并
- 🔗 **文献关系分析** - 引用网络、相似文献发现，结果由 tool 直接返回
- 📊 **期刊质量评估** - 影响因子、分区、JCI 指标

## 快速开始

### 安装运行

```bash
# 直接运行（推荐）
npx article-mcp@latest

# 或全局安装
npm install -g article-mcp
article-mcp
```

### 客户端配置

在 MCP 客户端（如 Claude Desktop、Cursor 等）中添加：

```json
{
  "mcpServers": {
    "article-mcp": {
      "command": "npx",
      "args": ["article-mcp@latest"],
      "env": {
        "EASYSCHOLAR_SECRET_KEY": "your_key_here"
      }
    }
  }
}
```

## 可用工具

| 工具                       | 说明                                                  |
| -------------------------- | ----------------------------------------------------- |
| `search_literature`        | 多源文献搜索，自动去重排序                            |
| `get_article_details`      | 获取文献全文（支持批量），通过结构化结果直接返回全文预览 |
| `get_references`           | 获取参考文献列表                                      |
| `get_literature_relations` | 分析文献引用关系网络，直接返回关系和可选网络数据 |
| `get_journal_quality`      | 评估期刊质量指标                                      |

## 输出说明

- 工具返回的机器可读结果使用统一的 `structuredContent` 包装。
- `content` 的第一段文本保留摘要和关键摘录，后续文本段提供同一结构化结果的 JSON 备份以兼容旧 MCP 客户端。
- `get_article_details` 通过 tool 结构化结果直接返回全文预览、格式、章节匹配和截断信息。
- `get_literature_relations` 通过 tool 结构化结果直接返回引用、相似文献、施引文献和网络分析数据。

## 环境变量

| 变量                     | 说明                                                                                           |
| ------------------------ | ---------------------------------------------------------------------------------------------- |
| `EASYSCHOLAR_SECRET_KEY` | EasyScholar API 密钥（期刊质量评估），[点击获取](https://www.easyscholar.cc/console/user/open) |
| `OPENALEX_API_KEY`       | OpenAlex API key，用于认证请求。                                                               |
| `NCBI_EMAIL`             | NCBI E-utilities 请求中的联系邮箱。                                                            |
| `NCBI_API_KEY`           | 可选的 NCBI E-utilities API key。                                                              |
| `CROSSREF_MAILTO`        | Crossref REST API 请求中的联系邮箱，并用于 polite User-Agent。                                  |
| `ARXIV_RATE_LIMIT_MS`    | 可选的 arXiv API 请求间隔覆盖值；默认按官方建议使用 3000ms。                                    |
| `EUROPE_PMC_RATE_LIMIT_MS` | 可选的 Europe PMC API 请求间隔覆盖值；默认 1000ms。                                           |
| `SEMANTIC_SCHOLAR_API_KEY` | Semantic Scholar Graph API key，用于引用检索请求。                                           |
| `ARTICLE_MCP_LANG`       | 工具说明语言：`zh-CN`（默认）或 `en`                                                           |

## 许可证

MIT © [fangfuzha](https://github.com/fangfuzha)

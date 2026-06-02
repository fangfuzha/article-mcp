# Article MCP

[![npm version](https://img.shields.io/npm/v/article-mcp.svg)](https://www.npmjs.com/package/article-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Article MCP 是一个基于 [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) 的学术文献搜索服务器，支持多数据源检索和分析。

## 功能特性

- 🔍 **多源文献搜索** - 支持 Europe PMC、PubMed、arXiv、CrossRef、OpenAlex
- 📄 **文献详情获取** - 获取全文内容，支持 Markdown/XML/Text 格式，并提供 `article://fulltext/{pmcid}?format={format}&sections={sections}` 资源链接
- 📚 **参考文献获取** - 智能去重，多数据源合并
- 🔗 **文献关系分析** - 引用网络、相似文献发现，并提供 `article://relations/{identifier}{?id_type,relation_types,analysis_type,max_results,max_depth,sources}` 资源链接
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

| 工具                       | 说明                       |
| -------------------------- | -------------------------- |
| `search_literature`        | 多源文献搜索，自动去重排序 |
| `get_article_details`      | 获取文献全文（支持批量），全文可通过资源 URI 重新读取 |
| `get_references`           | 获取参考文献列表           |
| `get_literature_relations` | 分析文献引用关系网络，关系结果可通过资源 URI 重新计算 |
| `get_journal_quality`      | 评估期刊质量指标           |

## 输出说明

- 工具返回的机器可读结果使用统一的 `structuredContent` 包装。
- `content` 仅保留摘要和关键摘录，不再承载完整 JSON。
- `get_article_details` 的全文通过 `article://fulltext/{pmcid}?format={format}&sections={sections}` 资源按需读取；资源失败会返回结构化 JSON 错误。
- `get_literature_relations` 的关系分析通过 `article://relations/{identifier}{?id_type,relation_types,analysis_type,max_results,max_depth,sources}` 资源按需重算；资源失败会返回结构化 JSON 错误。

## 环境变量

| 变量                     | 说明                                                                                           |
| ------------------------ | ---------------------------------------------------------------------------------------------- |
| `EASYSCHOLAR_SECRET_KEY` | EasyScholar API 密钥（期刊质量评估），[点击获取](https://www.easyscholar.cc/console/user/open) |
| `ARTICLE_MCP_LANG`       | 工具说明语言：`zh-CN`（默认）或 `en`                                                           |

## 许可证

MIT © [fangfuzha](https://github.com/fangfuzha)

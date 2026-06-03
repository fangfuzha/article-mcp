# Article MCP

[![npm version](https://img.shields.io/npm/v/article-mcp.svg)](https://www.npmjs.com/package/article-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

基于 [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) 的学术文献搜索服务器。帮助 LLM 搜索、获取和分析多数据源学术文献。

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
        "EASYSCHOLAR_SECRET_KEY": "your_key_here"
      }
    }
  }
}
```

## 可用工具

| 工具 | 说明 |
|------|------|
| `search_literature` | 多源文献搜索，4 种策略，自动去重排序 |
| `get_article_details` | 获取 PMC 全文（Markdown/XML/Text），批量 20 篇 |
| `get_references` | 参考文献列表，智能 DOI/标题去重 |
| `get_literature_relations` | 引用网络、施引文献、相似文献分析 |
| `get_journal_quality` | 期刊质量指标（影响因子、分区、JCI、h 指数） |

## 环境变量

| 变量 | 必需 | 说明 |
|------|------|------|
| `EASYSCHOLAR_SECRET_KEY` | 期刊评估需要 | [EasyScholar API 密钥](https://www.easyscholar.cc/console/user/open) |
| `OPENALEX_API_KEY` | 可选 | OpenAlex 认证 |
| `NCBI_EMAIL` | 推荐 | NCBI E-utilities 联系邮箱 |
| `NCBI_API_KEY` | 可选 | NCBI API 密钥（提升速率上限） |
| `CROSSREF_MAILTO` | 推荐 | Crossref Polite Pool 邮箱 |
| `SEMANTIC_SCHOLAR_API_KEY` | 推荐 | Semantic Scholar API 密钥 |
| `ARTICLE_MCP_LANG` | 可选 | 语言：`zh-CN`（默认）或 `en` |

## 输出说明

- `structuredContent` 使用统一的 `{ success, data, meta, warnings, error }` 结构
- `content` 首段为可读摘要和关键摘录，次段为 JSON 备份以兼容旧客户端
- 服务器仅注册 Tools，不注册 Resources 或 Prompts

## 文档

完整文档见 [GitHub 仓库](https://github.com/fangfuzha/article-mcp)。

## 许可证

MIT © [fangfuzha](https://github.com/fangfuzha)

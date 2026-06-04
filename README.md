# Article MCP

[![npm version](https://img.shields.io/npm/v/article-mcp.svg)](https://www.npmjs.com/package/article-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

基于 [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) 的学术文献检索服务器。帮助 LLM 搜索、获取和分析多数据源学术文献。

**主要用途**：面向学术文献与科研论文检索分析，尤其适合医学、生命科学和跨学科科研场景；同时支持 arXiv 等通用科研预印本来源。

## 适用范围

适用于需要 LLM 进行以下操作的场景：

- **学术写作辅助** — 查找最新研究文献作为引用来源
- **文献综述** — 跨多个学术数据库检索和分析文献
- **期刊质量评估** — 评估目标期刊的学术影响力（影响因子、分区等）
- **文献关系分析** — 构建引用网络、发现相似文献

支持 **6 个学术数据源**：Europe PMC、PubMed、arXiv、CrossRef、OpenAlex、Semantic Scholar。

> **注意**: 本工具返回文献元数据（标题、作者、摘要、PMCID、DOI 等）。全文获取需通过 `get_article_details` 工具，且仅限 PMC 开放获取文章。

## 快速开始

**系统要求**: Node.js 18+

```bash
# 直接运行（推荐，自动获取最新版本）
npx article-mcp@latest

# 或全局安装
npm install -g article-mcp
article-mcp
```

### Claude Desktop 配置

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

### VS Code 配置

在 `.vscode/mcp.json` 中添加：

```json
{
  "servers": {
    "article-mcp": {
      "type": "stdio",
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

> **Windows 用户**: 如果遇到 `npx` 无法识别的问题，将 `"command"` 改为 `"cmd"`，`"args"` 改为 `["/c", "npx", "article-mcp@latest"]`。

## 功能特性

| 功能                | 工具                       | 说明                                                          |
| ------------------- | -------------------------- | ------------------------------------------------------------- |
| 🔍 **多源文献搜索** | `search_literature`        | 跨 5 个数据源并行搜索，支持 4 种搜索策略，自动去重排序        |
| 📄 **文献全文获取** | `get_article_details`      | 通过 PMCID 获取 PMC 全文（Markdown/XML/Text），支持批量 20 篇 |
| 📚 **参考文献获取** | `get_references`           | 多源获取参考文献列表，智能 DOI/标题去重，源优先级排序         |
| 🔗 **文献关系分析** | `get_literature_relations` | 引用网络、施引文献、相似文献，支持多深度网络分析              |
| 📊 **期刊质量评估** | `get_journal_quality`      | 影响因子、JCR 分区、JCI、中科院分区、h 指数等，双数据源互补   |

## 工具说明

### `search_literature` — 文献搜索

查找文献并获取 PMCID（不含全文）。如需全文，用返回的 PMCID 调用 `get_article_details`。

| 参数          | 类型     | 默认值          | 说明                                                                                           |
| ------------- | -------- | --------------- | ---------------------------------------------------------------------------------------------- |
| `keyword`     | string   | _必填_          | 搜索关键词                                                                                     |
| `search_type` | enum     | `comprehensive` | 搜索策略：`comprehensive`（全面）、`fast`（快速）、`precise`（精确交集）、`preprint`（预印本） |
| `sources`     | string[] | 按策略选择      | 数据源：`europe_pmc`、`pubmed`、`arxiv`、`crossref`、`openalex`                                |
| `max_results` | integer  | `10`            | 每个源的最大结果数，范围 1-100                                                                 |
| `use_cache`   | boolean  | `true`          | 是否使用 24 小时文件缓存                                                                       |

### `get_article_details` — 文献全文

通过 PMCID 获取全文内容。仅支持 PMC 开放获取文章。

Return shape: `fulltext.content` contains the complete body in the selected format, `fulltext.preview` is a 1200-character quick preview, and `fulltext.content_length` reports the complete body length.

| 参数       | 类型                       | 默认值     | 说明                                            |
| ---------- | -------------------------- | ---------- | ----------------------------------------------- |
| `pmcid`    | string \| string[]         | _必填_     | PMCID 标识符，批量最多 20 个                    |
| `format`   | enum                       | `markdown` | 全文格式：`markdown`、`xml`、`text`             |
| `sections` | string \| string[] \| null | `null`     | `null` 获取全部章节；传入章节名列表获取指定部分 |

### `get_references` — 参考文献

获取某文献引用的参考文献列表。

| 参数               | 类型     | 默认值                               | 说明                                       |
| ------------------ | -------- | ------------------------------------ | ------------------------------------------ |
| `identifier`       | string   | _必填_                               | DOI、PMID 或 PMCID                         |
| `id_type`          | enum     | `doi`                                | 标识符类型：`auto`、`doi`、`pmid`、`pmcid` |
| `max_results`      | integer  | `20`                                 | 最大参考文献数量，范围 1-100               |
| `sources`          | string[] | `["europe_pmc","crossref","pubmed"]` | 数据源                                     |
| `include_metadata` | boolean  | `true`                               | 是否包含详细元数据                         |

### `get_literature_relations` — 文献关系分析

分析文献间的引用关系、施引文献和相似文献。

Citing behavior: `citing` tries OpenAlex and Europe PMC by default. If `sources` is provided, only supported citing sources from that list (`openalex`, `europe_pmc`) are used. OpenAlex requires `OPENALEX_API_KEY`; Europe PMC acts as a fallback source.

| 参数             | 类型               | 默认值                              | 说明                                                            |
| ---------------- | ------------------ | ----------------------------------- | --------------------------------------------------------------- |
| `identifiers`    | string \| string[] | `null`                              | DOI、PMID 或 PMCID                                              |
| `id_type`        | enum               | `auto`                              | 标识符类型                                                      |
| `relation_types` | enum[]             | `["references","similar","citing"]` | 关系类型                                                        |
| `max_results`    | integer            | `20`                                | 每种关系最大结果数，范围 1-100                                  |
| `analysis_type`  | enum               | `basic`                             | `basic`（基本）、`comprehensive`（综合）、`network`（网络分析） |
| `max_depth`      | integer            | `1`                                 | 网络分析展开深度                                                |

### `get_journal_quality` — 期刊质量评估

集成 EasyScholar + OpenAlex 双数据源。

Failure behavior: if neither EasyScholar nor OpenAlex returns usable metrics, the tool returns `isError: true` with a clear error instead of a successful empty metric object.

| 参数              | 类型                       | 默认值 | 说明                                                       |
| ----------------- | -------------------------- | ------ | ---------------------------------------------------------- |
| `journal_name`    | string \| string[]         | _必填_ | 期刊名称                                                   |
| `include_metrics` | string \| string[] \| null | `null` | 返回指标：`impact_factor`、`quartile`、`jci`、`h_index` 等 |
| `sort_by`         | enum \| null               | `null` | 排序字段（批量查询）：`impact_factor`、`quartile`、`jci`   |
| `sort_order`      | enum                       | `desc` | `desc`（降序）或 `asc`（升序）                             |
| `use_cache`       | boolean                    | `true` | 是否使用 24 小时文件缓存                                   |

## 环境变量

| 变量                       | 必需                  | 获取地址/配置作用                                                                    | 缺失后果                                             |
| -------------------------- | --------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| `OPENALEX_API_KEY`         | OpenAlex 相关能力需要 | [OpenAlex account](https://openalex.org/account)，用于 OpenAlex 搜索、施引和期刊指标 | OpenAlex 源失败；`citing` 和 OpenAlex 期刊指标不可用 |
| `EASYSCHOLAR_SECRET_KEY`   | 期刊影响因子/分区需要 | [EasyScholar 开放平台](https://www.easyscholar.cc/console/user/open)                 | 期刊质量只尝试 OpenAlex 指标，影响因子/分区可能为空  |
| `NCBI_EMAIL`               | 推荐                  | NCBI E-utilities 联系邮箱                                                            | 仍可请求，但不利于 NCBI 联系和合规使用               |
| `NCBI_API_KEY`             | 可选                  | [NCBI API key](https://www.ncbi.nlm.nih.gov/account/settings/)                       | PubMed/PMC 速率按 3 req/s 保守限制                   |
| `CROSSREF_MAILTO`          | 推荐                  | Crossref Polite Pool 联系邮箱                                                        | 仍可请求，但不会进入 Polite Pool                     |
| `SEMANTIC_SCHOLAR_API_KEY` | 推荐                  | [Semantic Scholar API key](https://www.semanticscholar.org/product/api)              | 施引上下文请求更容易受限                             |
| `OPENALEX_RATE_LIMIT_MS`   | 可选                  | OpenAlex 请求间隔覆盖值，默认 100ms                                                  | 使用默认限流                                         |
| `ARXIV_RATE_LIMIT_MS`      | 可选                  | arXiv 请求间隔覆盖值，默认 3000ms                                                    | 使用默认限流                                         |
| `EUROPE_PMC_RATE_LIMIT_MS` | 可选                  | Europe PMC 请求间隔覆盖值，默认 1000ms                                               | 使用默认限流                                         |
| `NCBI_RATE_LIMIT_MS`       | 可选                  | NCBI 请求间隔覆盖值；未设置时有 key 默认 100ms，无 key 默认 333ms                    | 使用自动限流                                         |
| `ARTICLE_MCP_LANG`         | 可选                  | 工具说明语言：`zh-CN`（默认）或 `en`                                                 | 使用中文工具说明                                     |

## 使用示例

### 基本搜索流程

```
用户: 搜索 CRISPR 基因编辑的最新文献
LLM: 调用 search_literature(keyword="CRISPR gene editing", search_type="fast")
     → 返回 10 条结果的元数据（标题、作者、PMCID、摘要等）

用户: 获取第一篇文献的全文
LLM: 调用 get_article_details(pmcid="PMC1234567")
     → 返回全文内容（Markdown 格式）
```

### 期刊评估

```
用户: 查看 Nature 的影响因子
LLM: 调用 get_journal_quality(journal_name="Nature")
     → 返回 impact_factor、quartile、jci 等指标
```

### 批量期刊比较

```
用户: 比较 Nature、Science、Cell 的质量指标
LLM: 调用 get_journal_quality(
        journal_name=["Nature", "Science", "Cell"],
        sort_by="impact_factor"
      )
     → 按影响因子降序返回三本期刊的指标
```

## 数据源说明

| 数据源           | 搜索 | 详情 | 全文 | 参考文献 | 施引文献 | 相似文献 |
| ---------------- | :--: | :--: | :--: | :------: | :------: | :------: |
| Europe PMC       |  ✅  |  ✅  |  —   |    ✅    |    ✅    |    —     |
| PubMed           |  ✅  |  ✅  |  ✅  |    ✅    |    —     |    ✅    |
| arXiv            |  ✅  |  —   |  —   |    —     |    —     |    —     |
| Crossref         |  ✅  |  ✅  |  —   |    ✅    |    —     |    —     |
| OpenAlex         |  ✅  |  ✅  |  —   |    —     |    ✅    |    —     |
| Semantic Scholar |  —   |  —   |  —   |    —     |    ✅    |    —     |

## 输出说明

- `structuredContent` 使用统一的 `{ success, data, meta, warnings, error }` 结构
- `content` 首段为可读摘要和关键摘录，次段为同一结构化结果的 **JSON 备份** 以兼容旧 MCP 客户端
- 服务器只注册 Tools，不注册 Resources 或 Prompts，确保最大客户端兼容性

## 调试

使用 MCP Inspector 检查和调试工具调用：

```bash
# 启动 Inspector
npx @modelcontextprotocol/inspector node dist/index.js
```

日志输出到 **stderr**（不污染 stdout 协议通道）。在客户端日志中查看请求耗时和状态。

## 开发

```bash
npm install          # 安装依赖
npm run dev          # 开发模式（tsx 热重载）
npm run build        # 生产构建
npm test             # 运行 91 个 Vitest 测试
npm run test:mcp     # MCP 合规检查（目标: 100/100）
npm run test:all     # 完整门禁：version-check → typecheck → lint → build → test → test:mcp
```

## 许可证

MIT © [fangfuzha](https://github.com/fangfuzha)

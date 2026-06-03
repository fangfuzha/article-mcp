# Article MCP

[中文](README.md) | [English](README.en.md)

[![npm version](https://img.shields.io/npm/v/article-mcp.svg)](https://www.npmjs.com/package/article-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server for academic literature search. Enables LLMs to search, retrieve, and analyze scholarly articles across multiple data sources.

> Node.js + TypeScript migration from the original [Python implementation](https://github.com/gqy20/article-mcp).

## Use Cases

Ideal for LLM-driven workflows that require:

- **Academic writing support** — find recent research as citation sources
- **Literature review** — search and analyze papers across multiple scholarly databases
- **Journal quality assessment** — evaluate impact factors, quartiles, and other metrics
- **Citation network analysis** — build citation graphs, discover similar papers

Integrates **6 scholarly data sources**: Europe PMC, PubMed, arXiv, CrossRef, OpenAlex, and Semantic Scholar.

> **Note**: This tool returns metadata (titles, authors, abstracts, PMCID, DOIs). Full-text retrieval is available through `get_article_details` for PMC Open Access articles only.

## Quick Start

**Requirements**: Node.js 18+

```bash
# Run directly (recommended — always latest)
npx article-mcp@latest

# Or install globally
npm install -g article-mcp
article-mcp
```

### Claude Desktop

```json
{
  "mcpServers": {
    "article-mcp": {
      "command": "npx",
      "args": ["article-mcp@latest"],
      "env": {
        "EASYSCHOLAR_SECRET_KEY": "your_key_here",
        "ARTICLE_MCP_LANG": "en"
      }
    }
  }
}
```

### VS Code

In `.vscode/mcp.json`:

```json
{
  "servers": {
    "article-mcp": {
      "type": "stdio",
      "command": "npx",
      "args": ["article-mcp@latest"],
      "env": {
        "EASYSCHOLAR_SECRET_KEY": "your_key_here"
      }
    }
  }
}
```

> **Windows**: If `npx` is not found, use `"command": "cmd"` and `"args": ["/c", "npx", "article-mcp@latest"]`.

## Features

| Feature | Tool | Description |
|---------|------|-------------|
| 🔍 **Multi-source Search** | `search_literature` | Parallel search across 5 sources, 4 strategies, auto-dedup & ranking |
| 📄 **Full-text Retrieval** | `get_article_details` | PMC full-text via PMCID (Markdown/XML/Text), up to 20 batch |
| 📚 **References** | `get_references` | Multi-source reference lists, DOI/title dedup, source-priority ranking |
| 🔗 **Relation Analysis** | `get_literature_relations` | Citation networks, citing papers, similar papers, multi-depth expansion |
| 📊 **Journal Quality** | `get_journal_quality` | Impact factor, quartile, JCI, CAS zone, h-index, dual-source fallback |

## Tools Reference

### `search_literature` — Literature Search

Searches for articles and returns PMCID metadata. Use returned PMCID with `get_article_details` for full text.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `keyword` | string | *required* | Search query |
| `search_type` | enum | `comprehensive` | Strategy: `comprehensive`, `fast`, `precise`, `preprint` |
| `sources` | string[] | strategy-based | `europe_pmc`, `pubmed`, `arxiv`, `crossref`, `openalex` |
| `max_results` | integer | `10` | Max results per source |
| `use_cache` | boolean | `true` | Use 24-hour file cache |

### `get_article_details` — Full-text Retrieval

Fetches full-text content by PMCID. PMC Open Access articles only.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `pmcid` | string \| string[] | *required* | PMCID identifier(s), max 20 |
| `format` | enum | `markdown` | Output format: `markdown`, `xml`, `text` |
| `sections` | string \| string[] \| null | `null` | `null` = all sections; pass names for specific sections |

### `get_references` — Reference Retrieval

Gets the reference list of an article.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `identifier` | string | *required* | DOI, PMID, or PMCID |
| `id_type` | enum | `doi` | `auto`, `doi`, `pmid`, `pmcid` |
| `max_results` | integer | `20` | Max references to return |
| `sources` | string[] | `["europe_pmc","crossref","pubmed"]` | Data sources |
| `include_metadata` | boolean | `true` | Include detailed metadata |

### `get_literature_relations` — Relation Analysis

Analyzes reference, citing, and similar-article relationships.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `identifiers` | string \| string[] | `null` | DOI, PMID, or PMCID |
| `id_type` | enum | `auto` | Identifier type |
| `relation_types` | enum[] | `["references","similar","citing"]` | Relation types |
| `max_results` | integer | `20` | Max results per relation type |
| `analysis_type` | enum | `basic` | `basic`, `comprehensive`, `network` |
| `max_depth` | integer | `1` | Network expansion depth |

### `get_journal_quality` — Journal Quality

Dual data source: EasyScholar + OpenAlex with automatic fallback.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `journal_name` | string \| string[] | *required* | Journal name(s) |
| `include_metrics` | string \| string[] \| null | `null` | Metrics to return (auto-detect when null) |
| `sort_by` | enum \| null | `null` | Sort field for batch: `impact_factor`, `quartile`, `jci` |
| `sort_order` | enum | `desc` | `desc` or `asc` |
| `use_cache` | boolean | `true` | Use 24-hour file cache |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `EASYSCHOLAR_SECRET_KEY` | For journal eval | [EasyScholar API key](https://www.easyscholar.cc/console/user/open) |
| `OPENALEX_API_KEY` | Optional | OpenAlex authentication for higher rate limits |
| `NCBI_EMAIL` | Recommended | NCBI E-utilities contact email |
| `NCBI_API_KEY` | Optional | NCBI API key (raises limit to 10 req/s) |
| `CROSSREF_MAILTO` | Recommended | Crossref Polite Pool contact email |
| `SEMANTIC_SCHOLAR_API_KEY` | Recommended | Semantic Scholar API key |
| `ARXIV_RATE_LIMIT_MS` | Optional | arXiv request delay override (default 3000ms) |
| `EUROPE_PMC_RATE_LIMIT_MS` | Optional | Europe PMC request delay override (default 1000ms) |
| `ARTICLE_MCP_LANG` | Optional | Tool description language: `zh-CN` (default) or `en` |

## Usage Examples

### Basic Search → Full-text Flow

```
User: Search for recent CRISPR gene editing papers
LLM:  → search_literature(keyword="CRISPR gene editing", search_type="fast")
      ← 10 results with metadata (title, authors, PMCID, abstract, etc.)

User: Get the full text of the first paper
LLM:  → get_article_details(pmcid="PMC1234567")
      ← Full text in Markdown format
```

### Journal Evaluation

```
User: What's Nature's impact factor?
LLM:  → get_journal_quality(journal_name="Nature")
      ← impact_factor, quartile, jci, plus OpenAlex metrics
```

### Batch Journal Comparison

```
User: Compare Nature, Science, and Cell quality metrics
LLM:  → get_journal_quality(
          journal_name=["Nature", "Science", "Cell"],
          sort_by="impact_factor"
        )
      ← Three journals sorted by impact factor (descending)
```

### Citation Network Analysis

```
User: Show me papers that cite DOI 10.1038/nature12373
LLM:  → get_literature_relations(
          identifiers="10.1038/nature12373",
          relation_types=["citing"],
          analysis_type="network",
          max_depth=2
        )
      ← Citation network with nodes, edges, clusters, and centrality metrics
```

## Data Source Coverage

| Source | Search | Details | Full-text | References | Citing | Similar |
|--------|:------:|:-------:|:---------:|:----------:|:------:|:-------:|
| Europe PMC | ✅ | ✅ | — | ✅ | ✅ | — |
| PubMed | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| arXiv | ✅ | — | — | — | — | — |
| Crossref | ✅ | ✅ | — | ✅ | — | — |
| OpenAlex | ✅ | ✅ | — | — | ✅ | — |
| Semantic Scholar | — | — | — | — | ✅ | — |

## Output Contract

- `structuredContent` uses a unified `{ success, data, meta, warnings, error }` envelope
- `content` first block: human-readable summary and key excerpts
- `content` second block: **serialized JSON** backup for older MCP clients
- Server is **Tools-only** — no Resources or Prompts registered, for maximum client compatibility

## Caching

Both search and journal-quality caches are stored under `~/.article_mcp_cache/`:
- **Search cache**: SHA256-based keys, 24-hour TTL, atomic write (`.tmp` → rename)
- **Journal-quality cache**: Shared JSON file with file-level concurrency protection

## Debugging

Use the MCP Inspector to test and debug tool invocations:

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

All logging goes to **stderr** to keep stdout clean for MCP protocol communication. Check client logs for request timing and status.

## Development

```bash
npm install          # Install dependencies
npm run dev          # Development mode (tsx watch)
npm run build        # Production build (tsup)
npm test             # Run 91 Vitest tests
npm run test:mcp     # MCP compliance check (target: 100/100)
npm run test:all     # Full gate: version-check → typecheck → lint → build → test → test:mcp
```

## License

MIT © [fangfuzha](https://github.com/fangfuzha)

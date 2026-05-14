# Article MCP Literature Search Server

[中文](README.md) | [English](README.en.md)

> A Node.js + TypeScript migration of Article MCP.
>
> **Acknowledgement to the Original Project**
>
> This project is a migration of the Python implementation from [gqy20/article-mcp](https://github.com/gqy20/article-mcp). The original project is built with FastMCP. This version keeps the core architecture and adapts it to the Node.js + TypeScript ecosystem.

Article MCP provides multi-source literature retrieval over the MCP protocol for Claude Desktop, Cherry Studio, and other compatible clients. It integrates Europe PMC, PubMed, arXiv, CrossRef, OpenAlex, and EasyScholar.

## Migration Status

The current Node version uses Python `0.2.2` as its behavior baseline. The initial migration is complete, including the stdio MCP server, 5 core tools, 5 MCP resources, file-based caching, engineering scripts, CI workflows, and release configuration.

The aligned behavior currently covers tool input schemas, read-only tool annotations, resource registration, search caching, journal-quality caching, PMC full-text output in Markdown/XML/text, reference aggregation, literature relation network expansion, and major parameter compatibility with the Python version.

The release gate is `npm run test:all`, which covers TypeScript type checking, ESLint, production build, Vitest, and MCP stdio compliance checks.

## Core Capabilities

- Multi-source literature search
- Full-text article retrieval
- Reference retrieval
- Literature relation analysis
- Journal quality evaluation
- Input validation based on Zod
- MCP client integration over stdio
- Optional `.env` support for `EASYSCHOLAR_SECRET_KEY`
- Tool descriptions default to Chinese and can switch to English with `ARTICLE_MCP_LANG=en`

## Quick Start

### Requirements

- Node.js 18 or later
- npm 9 or later

### Install and Run

```bash
git clone https://github.com/gqy20/article-mcp.git
cd article-mcp
npm install
npm run build
npm start
```

### Development Mode

```bash
npm run dev
```

### CLI Usage

If dependencies are already installed, you can start the local CLI directly:

```bash
npm start
```

After publishing to npm, you can also launch it with `npx article-mcp`.

## Client Configuration

### Claude Desktop

For local development, run `npm run build` first and then use the compiled entry:

```json
{
  "mcpServers": {
    "article-mcp": {
      "command": "node",
      "args": ["E:/path/to/article-mcp/dist/index.js"],
      "env": {
        "EASYSCHOLAR_SECRET_KEY": "your_key_here",
        "ARTICLE_MCP_LANG": "en"
      }
    }
  }
}
```

After publishing to npm, you can switch to package-based startup:

```json
{
  "mcpServers": {
    "article-mcp": {
      "command": "npx",
      "args": ["article-mcp"],
      "env": {
        "EASYSCHOLAR_SECRET_KEY": "your_key_here",
        "ARTICLE_MCP_LANG": "en"
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
        "EASYSCHOLAR_SECRET_KEY": "your_key_here",
        "ARTICLE_MCP_LANG": "en"
      }
    }
  }
}
```

`EASYSCHOLAR_SECRET_KEY` is optional, but recommended for journal-quality queries if you want more complete metrics. You can register at [EasyScholar](https://www.easyscholar.cc) to obtain a key.

If the key is missing, invalid, or EasyScholar is temporarily unavailable, `get_journal_quality` does not fail as a whole. Instead, it automatically degrades to an OpenAlex-only mode and still returns `h_index`, `citation_rate`, `cited_by_count`, `works_count`, and `i10_index`, while explaining the downgrade reason in the `warning` field.

### Tool Description Language

Tool names, parameter names, and response field names remain stable regardless of language configuration. Tool titles, descriptions, and parameter hints default to Chinese. To switch them to English, set the following in your MCP client configuration:

```json
{
  "env": {
    "ARTICLE_MCP_LANG": "en"
  }
}
```

Supported values are `zh-CN` (default) and `en`. After switching, you usually need to restart the MCP server or reconnect the client because some clients cache `tools/list`.

## Tool Overview

The current version exposes 5 read-only tools:

| Tool                       | Purpose                                                                                          | Main Parameters                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `search_literature`        | Multi-source literature search                                                                   | `keyword`, `sources`, `max_results`, `search_type`, `use_cache`                                                   |
| `get_article_details`      | Full-text article retrieval                                                                      | `pmcid`, `sections`, `format`                                                                                     |
| `get_references`           | Reference retrieval                                                                              | `identifier`, `id_type`, `sources`, `max_results`, `include_metadata`                                             |
| `get_literature_relations` | Literature relation analysis                                                                     | `identifier` / `identifiers`, `id_type`, `relation_types`, `max_results`, `sources`, `analysis_type`, `max_depth` |
| `get_journal_quality`      | Journal quality evaluation with automatic OpenAlex-only fallback when EasyScholar is unavailable | `journal_name`, `include_metrics`, `use_cache`, `sort_by`, `sort_order`                                           |

## Resource Overview

The current version registers 5 MCP resources:

| Resource URI                       | Purpose                                                     |
| ---------------------------------- | ----------------------------------------------------------- |
| `config://version`                 | Returns the server version                                  |
| `config://status`                  | Returns service status and supported data sources           |
| `config://tools`                   | Returns the tool catalog and categories                     |
| `stats://cache`                    | Returns cache directory statistics                          |
| `journals://{journalName}/quality` | Reads cached journal-quality data for the specified journal |

## Cache Notes

Both search cache and journal-quality cache are stored under `~/.article_mcp_cache/`. Search cache uses SHA256-based keys with a 24-hour TTL. Journal-quality cache uses a shared file cache with file-level concurrency protection and is shared by the `get_journal_quality` tool and the `journals://{journalName}/quality` resource.

## Data Sources

### Europe PMC

- Content: biomedical full text, abstracts, and references
- Rate limit: about 1 req/s
- Usage: search, full-text retrieval, and reference lookup

### PubMed

- Content: biomedical abstracts and supplemental metadata
- Rate limit: no strict limit
- Usage: search enrichment and result validation

### arXiv

- Content: preprint metadata
- Rate limit: controlled according to API guidance
- Usage: preprint search

### CrossRef

- Content: cross-publisher metadata and citation relationships
- Rate limit: controlled according to the official API policy
- Usage: reference lookup and DOI relationship queries

### OpenAlex

- Content: open scholarly graph, authors, journals, and citation networks
- Rate limit: generally permissive
- Usage: citation relations, h-index metrics, and article network analysis

### EasyScholar

- Content: journal quartiles and quality metrics
- Rate limit: recommended to use with a configured key
- Usage: impact factor, quartile, JCI, and related journal evaluation metrics

## Parameter Compatibility

The migration keeps strong parameter compatibility so that different MCP clients can call the tools directly:

- `get_article_details.pmcid` supports a single value or a list
- `get_article_details.sections` supports a single value, a list, or null
- `get_literature_relations` supports both `identifier` and `identifiers`
- `get_journal_quality.journal_name` and `get_journal_quality.include_metrics` support single values or lists

## Examples

### Search Literature

```json
{
  "keyword": "machine learning",
  "max_results": 10,
  "search_type": "comprehensive"
}
```

### Search Specific Sources

```json
{
  "keyword": "cancer",
  "sources": ["europe_pmc", "arxiv"]
}
```

### Fetch Full Text

```json
{
  "pmcid": "PMC1234567",
  "format": "markdown"
}
```

### Fetch Selected Sections Only

```json
{
  "pmcid": "PMC1234567",
  "sections": ["methods", "results"]
}
```

### Get References

```json
{
  "identifier": "10.1038/nature12373",
  "id_type": "doi",
  "max_results": 20
}
```

### Analyze Literature Relations

```json
{
  "identifiers": "10.1038/nature12373",
  "relation_types": ["references", "similar"]
}
```

### Evaluate Journal Quality

```json
{
  "journal_name": "Nature",
  "include_metrics": ["impact_factor", "quartile", "jci"]
}
```

Without a valid `EASYSCHOLAR_SECRET_KEY`, this tool degrades to OpenAlex-only mode. In that case, the response includes OpenAlex metrics and explains the EasyScholar failure reason in the `warning` field.

## Development Notes

- Build: `npm run build`
- Dev: `npm run dev`
- Run: `npm start`
- Type check: `npm run typecheck`
- Lint: `npm run lint`
- Format check: `npm run format:check`
- Unit and integration tests: `npm test`
- MCP compliance check: `npm run test:mcp`
- Full pre-release check: `npm run test:all`
- Version consistency check: `npm run version:check`
- CLI: `npx article-mcp`

Engineering support files mirror the Python project with Node equivalents: `.github/workflows/node-mcp-compliance.yml` handles CI compliance checks, `.github/workflows/publish.yml` handles npm publishing from tags, `scripts/sync-version.ts` handles version synchronization, and `scripts/test-mcp-compliance.ts` performs stdio MCP compliance checks.

The project uses `@modelcontextprotocol/sdk`, `zod`, `axios`, `axios-retry`, `fast-xml-parser`, and `dotenv` as core dependencies.

## Project Structure

```text
src/
  index.ts              # MCP server entry
  middleware/           # Error boundaries, logging, timing, and search cache
  resources/            # MCP resource registration
  services/             # External data source and aggregation services
  tools/                # Tool definitions, schemas, registration, and handlers
  types/                # Shared literature and journal data models
scripts/                # Version sync and MCP compliance scripts
tests/                  # Vitest regression tests
reference/              # Reference implementation from the original Python project
```

## License

MIT License

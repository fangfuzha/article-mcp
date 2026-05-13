import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readdir, stat } from "fs/promises";
import { homedir } from "os";
import { join } from "path";

import { SERVER_NAME, SERVER_VERSION } from "../index.js";
import { JournalQualityCache } from "../services/journal_quality_cache.js";

const CACHE_DIR = join(homedir(), ".article_mcp_cache");

/**
 * 在 MCP 服务器上注册所有资源。
 *
 * 对应 Python 版 resources/config_resources.py 和 resources/journal_resources.py。
 *
 * @param server MCP server 实例。
 */
export function registerArticleMcpResources(server: McpServer): void {
  const journalQualityCache = new JournalQualityCache();

  // config://version —— 服务器版本
  server.registerResource(
    "config-version",
    "config://version",
    {
      title: "服务器版本信息",
      mimeType: "text/plain",
    },
    async () => ({
      contents: [{ uri: "config://version", text: SERVER_VERSION }],
    }),
  );

  // config://status —— 系统状态
  server.registerResource(
    "config-status",
    "config://status",
    {
      title: "系统状态",
      mimeType: "application/json",
    },
    async () => ({
      contents: [
        {
          uri: "config://status",
          text: JSON.stringify(
            {
              status: "running",
              server: SERVER_NAME,
              version: SERVER_VERSION,
              timestamp: Math.floor(Date.now() / 1000),
              supported_data_sources: ["europe_pmc", "pubmed", "arxiv", "crossref", "openalex"],
            },
            null,
            2,
          ),
        },
      ],
    }),
  );

  // config://tools —— 可用工具列表
  server.registerResource(
    "config-tools",
    "config://tools",
    {
      title: "可用工具列表",
      mimeType: "application/json",
    },
    async () => ({
      contents: [
        {
          uri: "config://tools",
          text: JSON.stringify(
            [
              {
                name: "search_literature",
                description:
                  "多源文献搜索工具 - 支持 Europe PMC, PubMed, arXiv, CrossRef, OpenAlex",
                category: "search",
              },
              {
                name: "get_article_details",
                description:
                  "获取文献详情 - 支持参数容错自动修正，数据源：Europe PMC, CrossRef, OpenAlex, arXiv, PubMed",
                category: "details",
              },
              {
                name: "get_references",
                description: "获取参考文献 - 数据源：Europe PMC, CrossRef, PubMed",
                category: "references",
              },
              {
                name: "get_literature_relations",
                description: "文献关系分析 - 数据源：Europe PMC, PubMed, CrossRef, OpenAlex",
                category: "analysis",
              },
              {
                name: "get_journal_quality",
                description: "期刊质量评估 - 数据源：EasyScholar, OpenAlex",
                category: "quality",
              },
            ],
            null,
            2,
          ),
        },
      ],
    }),
  );

  // journals://{journal_name}/quality —— 期刊质量缓存资源
  server.registerResource(
    "journal-quality",
    new ResourceTemplate("journals://{journalName}/quality", {
      list: async () => ({ resources: [] }),
    }),
    {
      title: "期刊质量缓存",
      mimeType: "application/json",
    },
    async (_uri, { journalName }) => {
      const journalNameStr = String(journalName);
      try {
        const cachedData = await journalQualityCache.getMergedResult(journalNameStr);
        if (cachedData) {
          return {
            contents: [
              {
                uri: `journals://${journalNameStr}/quality`,
                text: JSON.stringify(
                  {
                    journal_name: journalNameStr,
                    quality_metrics: cachedData.quality_metrics ?? {},
                    ranking_info: cachedData.ranking_info ?? {},
                    data_source: cachedData.data_source ?? "cache",
                    last_updated: cachedData.timestamp ?? null,
                    resource_type: "journal_quality",
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        return {
          contents: [
            {
              uri: `journals://${journalNameStr}/quality`,
              text: JSON.stringify(
                {
                  journal_name: journalNameStr,
                  quality_metrics: {},
                  ranking_info: {},
                  data_source: "none",
                  message: "No cached data available. Use get_journal_quality tool to fetch data.",
                  resource_type: "journal_quality",
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        return {
          contents: [
            {
              uri: `journals://${journalNameStr}/quality`,
              text: JSON.stringify(
                {
                  journal_name: journalNameStr,
                  error: error instanceof Error ? error.message : String(error),
                  resource_type: "journal_quality",
                },
                null,
                2,
              ),
            },
          ],
        };
      }
    },
  );

  // stats://cache —— 缓存统计信息
  server.registerResource(
    "stats-cache",
    "stats://cache",
    {
      title: "缓存统计信息",
      mimeType: "application/json",
    },
    async () => {
      try {
        let totalFiles = 0;
        let totalSize = 0;
        let newestTime = 0;

        try {
          const files = await readdir(CACHE_DIR);
          for (const file of files) {
            if (file.endsWith(".json")) {
              totalFiles++;
              const filePath = join(CACHE_DIR, file);
              const fileStat = await stat(filePath);
              totalSize += fileStat.size;
              newestTime = Math.max(newestTime, fileStat.mtimeMs);
            }
          }
        } catch {
          // 缓存目录不存在
        }

        return {
          contents: [
            {
              uri: "stats://cache",
              text: JSON.stringify(
                {
                  cache_enabled: true,
                  cache_dir: CACHE_DIR,
                  total_files: totalFiles,
                  total_size_mb: totalSize > 0 ? Number((totalSize / (1024 * 1024)).toFixed(2)) : 0,
                  last_accessed:
                    newestTime > 0
                      ? new Date(newestTime).toISOString().replace("T", " ").split(".")[0]
                      : null,
                  resource_type: "cache_stats",
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        return {
          contents: [
            {
              uri: "stats://cache",
              text: JSON.stringify(
                {
                  cache_enabled: false,
                  error: error instanceof Error ? error.message : String(error),
                  resource_type: "cache_stats",
                },
                null,
                2,
              ),
            },
          ],
        };
      }
    },
  );
}

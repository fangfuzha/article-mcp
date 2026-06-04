/**
 * 通过 stdio 客户端执行 MCP 协议兼容性冒烟检查并生成报告。
 */
import { access } from "node:fs/promises";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";

type ComplianceCheck = {
  name: string;
  passed: boolean;
  details: string;
};

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const reportPath = resolve(projectRoot, "scripts", "mcp-compliance-report.txt");
const expectedTools = [
  "search_literature",
  "get_article_details",
  "get_references",
  "get_literature_relations",
  "get_journal_quality",
];

async function listResourceTemplateUris(client: Client): Promise<string[]> {
  try {
    const templatesResult = await client.listResourceTemplates();
    return templatesResult.resourceTemplates.map((template) => template.uriTemplate);
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("Method not found") || error.message.includes("-32601"))
    ) {
      return [];
    }

    throw error;
  }
}

async function listResourceUris(client: Client): Promise<string[]> {
  try {
    const resourcesResult = await client.listResources();
    return resourcesResult.resources.map((resource) => resource.uri);
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("Method not found") || error.message.includes("-32601"))
    ) {
      return [];
    }

    throw error;
  }
}

async function listPromptNames(client: Client): Promise<string[]> {
  try {
    const promptsResult = await client.listPrompts();
    return promptsResult.prompts.map((prompt) => prompt.name);
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("Method not found") || error.message.includes("-32601"))
    ) {
      return [];
    }

    throw error;
  }
}

/**
 * 递归查找缺少 items 定义的数组 schema。
 *
 * @param value 要检查的 JSON schema 片段。
 * @param path 用于诊断的逻辑 schema 路径。
 * @param missing 缺少数组 items 定义的路径集合。
 */
function collectMissingArrayItems(value: unknown, path: string, missing: string[]): void {
  if (!value || typeof value !== "object") {
    return;
  }

  const schema = value as Record<string, unknown>;
  if (schema.type === "array" && !Object.prototype.hasOwnProperty.call(schema, "items")) {
    missing.push(path);
  }

  for (const [key, child] of Object.entries(schema)) {
    collectMissingArrayItems(child, `${path}.${key}`, missing);
  }
}

/**
 * 在 stdio 验证前确保已编译的 MCP 服务器存在。
 *
 * @returns 编译入口存在时完成的 Promise。
 */
async function ensureBuiltPackage(): Promise<void> {
  await access(resolve(projectRoot, "dist", "index.js"));
}

/**
 * 针对已编译服务器执行 MCP stdio 合规检查。
 *
 * @returns 合规检查结果和计算出的分数。
 */
async function runComplianceChecks(): Promise<{ checks: ComplianceCheck[]; score: number }> {
  await ensureBuiltPackage();

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/index.js"],
    cwd: projectRoot,
    stderr: "pipe",
  });
  const client = new Client({ name: "article-mcp-compliance", version: "1.0.0" });

  await client.connect(transport);

  try {
    const version = client.getServerVersion();
    const toolsResult = await client.listTools();
    const toolNames = toolsResult.tools.map((tool) => tool.name);
    const resourceUris = await listResourceUris(client);
    const resourceTemplateUris = await listResourceTemplateUris(client);
    const promptNames = await listPromptNames(client);
    const missingTools = expectedTools.filter((toolName) => !toolNames.includes(toolName));
    const missingArrayItems: string[] = [];
    const missingOutputSchemas = toolsResult.tools
      .filter((tool) => !tool.outputSchema)
      .map((tool) => tool.name);

    for (const tool of toolsResult.tools) {
      collectMissingArrayItems(tool.inputSchema, tool.name, missingArrayItems);
    }

    const structuredCallResult = await client.callTool(
      {
        name: "get_references",
        arguments: {
          identifier: "",
          id_type: "doi",
          sources: ["crossref"],
          max_results: 1,
        },
      },
      CallToolResultSchema,
    );

    const structuredContent = structuredCallResult.structuredContent as
      | Record<string, unknown>
      | undefined;
    const structuredMeta = structuredContent?.meta as Record<string, unknown> | undefined;

    const checks: ComplianceCheck[] = [
      {
        name: "server metadata",
        passed: version?.name === "article-mcp" && Boolean(version.version),
        details: JSON.stringify(version),
      },
      {
        name: "tool registration",
        passed: missingTools.length === 0 && toolsResult.tools.length === expectedTools.length,
        details: `registered=${toolNames.join(", ")}`,
      },
      {
        name: "tool annotations",
        passed: toolsResult.tools.every((tool) => Boolean(tool.annotations?.readOnlyHint)),
        details: "all tools expose readOnly annotations",
      },
      {
        name: "array schema items",
        passed: missingArrayItems.length === 0,
        details: missingArrayItems.length
          ? missingArrayItems.join(", ")
          : "all array schemas define items",
      },
      {
        name: "input schemas",
        passed: toolsResult.tools.every(
          (tool) => tool.inputSchema?.type === "object" && tool.inputSchema.properties,
        ),
        details: "all tools expose object input schemas",
      },
      {
        name: "output schemas",
        passed: missingOutputSchemas.length === 0,
        details: missingOutputSchemas.length
          ? `missing=${missingOutputSchemas.join(", ")}`
          : "all tools expose structured output schemas",
      },
      {
        name: "resource templates disabled",
        passed: resourceTemplateUris.length === 0,
        details: resourceTemplateUris.length
          ? `registered=${resourceTemplateUris.join(", ")}`
          : "no resource templates registered",
      },
      {
        name: "resources disabled",
        passed: resourceUris.length === 0,
        details: resourceUris.length
          ? `registered=${resourceUris.join(", ")}`
          : "no resources registered",
      },
      {
        name: "prompts disabled",
        passed: promptNames.length === 0,
        details: promptNames.length
          ? `registered=${promptNames.join(", ")}`
          : "no prompts registered",
      },
      {
        name: "structured call envelope",
        passed:
          structuredContent?.success === false &&
          Boolean(structuredContent.error) &&
          typeof structuredMeta?.processing_time_ms === "number" &&
          typeof structuredMeta?.timestamp === "number",
        details: JSON.stringify({
          success: structuredContent?.success,
          data: structuredContent?.data,
          hasError: Boolean(structuredContent?.error),
          processing_time_ms: structuredMeta?.processing_time_ms,
          timestamp: structuredMeta?.timestamp,
        }),
      },
    ];

    const score = Math.round((checks.filter((check) => check.passed).length / checks.length) * 100);
    return { checks, score };
  } finally {
    await client.close();
  }
}

/**
 * 写入便于阅读的合规报告。
 *
 * @param checks 单项合规检查结果。
 * @param score 总体合规分数。
 */
async function writeReport(checks: ComplianceCheck[], score: number): Promise<void> {
  const lines = [
    "Article MCP Node Compliance Report",
    `Overall score: ${score}/100`,
    "",
    ...checks.map((check) => `${check.passed ? "PASS" : "FAIL"} ${check.name}: ${check.details}`),
    "",
  ];

  await writeFile(reportPath, lines.join("\n"), "utf8");
  console.log(lines.join("\n"));
}

const { checks, score } = await runComplianceChecks();
await writeReport(checks, score);

if (checks.some((check) => !check.passed)) {
  process.exitCode = 1;
}

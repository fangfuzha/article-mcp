import { access } from "node:fs/promises";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

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
    const missingTools = expectedTools.filter((toolName) => !toolNames.includes(toolName));
    const missingArrayItems: string[] = [];

    for (const tool of toolsResult.tools) {
      collectMissingArrayItems(tool.inputSchema, tool.name, missingArrayItems);
    }

    // 检查资源注册
    let resourcesResult: { resources: Array<{ uri: string }> };
    let resourceTemplatesResult: { resourceTemplates: Array<{ uriTemplate: string }> };
    try {
      resourcesResult = await client.listResources();
    } catch {
      resourcesResult = { resources: [] };
    }
    try {
      resourceTemplatesResult = await client.listResourceTemplates();
    } catch {
      resourceTemplatesResult = { resourceTemplates: [] };
    }

    const resourceUris = resourcesResult.resources.map((r) => r.uri);
    const resourceTemplateUris = resourceTemplatesResult.resourceTemplates.map(
      (rt) => rt.uriTemplate,
    );
    const allResourceUris = [...resourceUris, ...resourceTemplateUris];
    const expectedResourceUris = [
      "config://version",
      "config://status",
      "config://tools",
      "stats://cache",
    ];
    const expectedResourceTemplates = ["journals://{journalName}/quality"];
    const missingResources = expectedResourceUris.filter((uri) => !allResourceUris.includes(uri));
    const missingResourceTemplates = expectedResourceTemplates.filter(
      (tmpl) => !allResourceUris.includes(tmpl),
    );

    const checks: ComplianceCheck[] = [
      {
        name: "server metadata",
        passed: version?.name === "Article MCP Server" && Boolean(version.version),
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
        name: "resource registration",
        passed: missingResources.length === 0 && missingResourceTemplates.length === 0,
        details:
          missingResources.length || missingResourceTemplates.length
            ? `missing: ${[...missingResources, ...missingResourceTemplates].join(", ")}`
            : `resources=${allResourceUris.join(", ")}`,
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

if (score < 80) {
  process.exitCode = 1;
}

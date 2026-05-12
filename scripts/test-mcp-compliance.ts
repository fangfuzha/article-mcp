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
 * Recursively finds array schemas that omit an items definition.
 *
 * @param value JSON schema fragment to inspect.
 * @param path Logical schema path for diagnostics.
 * @param missing Mutable collection of missing array item paths.
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
 * Ensures the compiled MCP server exists before stdio validation.
 *
 * @returns A promise that resolves when the compiled entrypoint is present.
 */
async function ensureBuiltPackage(): Promise<void> {
  await access(resolve(projectRoot, "dist", "index.js"));
}

/**
 * Runs MCP stdio compliance checks against the compiled server.
 *
 * @returns Compliance checks and calculated score.
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
    ];

    const score = Math.round((checks.filter((check) => check.passed).length / checks.length) * 100);
    return { checks, score };
  } finally {
    await client.close();
  }
}

/**
 * Writes a human-readable compliance report.
 *
 * @param checks Individual compliance checks.
 * @param score Overall compliance score.
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

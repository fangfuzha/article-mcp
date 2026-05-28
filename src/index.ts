#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { config } from "dotenv";

import { registerArticleMcpTools } from "./tools/index.js";

config();

export const SERVER_NAME = "Article MCP Server";
export const SERVER_VERSION = "0.2.5";
export const CORE_TOOL_NAMES = [
  "search_literature",
  "get_article_details",
  "get_references",
  "get_literature_relations",
  "get_journal_quality",
] as const;

export type CliCommand = "server" | "info";

export type ParsedCliArguments = {
  command: CliCommand;
};

type RunCliDependencies = {
  startServer?: () => Promise<void>;
  writeInfo?: (message: string) => void;
};

/**
 * 创建完成依赖装配的 Article MCP 服务器实例。
 *
 * @returns 已注册全部 Article MCP 工具的 MCP server。
 */
export function createArticleMcpServer(): McpServer {
  /// 创建 MCP 服务器实例
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  /// 注册工具
  registerArticleMcpTools(server);

  return server;
}

/**
 * 通过 stdio 传输启动 Article MCP 服务器。
 *
 * @returns 服务器连接到传输层后完成的 Promise。
 */
export async function startStdioServer(): Promise<void> {
  /// 创建服务器实例并注册工具与资源
  const server = createArticleMcpServer();
  /// 创建并连接 stdio 传输，开始监听工具调用请求
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Article MCP Server running on Node.js via stdio");
}

/**
 * 解析 CLI 参数。
 *
 * 空参数默认映射为 server，以保持现有 `node dist/index.js` 行为不变。
 *
 * @param argv 传入的 CLI 参数，不包含 node 与脚本路径。
 * @returns 规范化后的 CLI 命令。
 */
export function parseCliArguments(argv: string[]): ParsedCliArguments {
  const [firstArgument] = argv;

  if (!firstArgument || firstArgument === "server") {
    return { command: "server" };
  }

  if (firstArgument === "info") {
    return { command: "info" };
  }

  return { command: "server" };
}

/**
 * 格式化 CLI info 子命令输出。
 *
 * @returns 适合打印到标准输出的项目信息文本。
 */
export function formatServerInfo(): string {
  return [
    `${SERVER_NAME} v${SERVER_VERSION}`,
    "Node.js + TypeScript MCP migration focused on the stdio transport.",
    "Core tools:",
    ...CORE_TOOL_NAMES.map((toolName, index) => `${index + 1}. ${toolName}`),
  ].join("\n");
}

/**
 * 运行 CLI 命令。
 *
 * @param argv 传入的 CLI 参数，不包含 node 与脚本路径。
 * @param dependencies 便于测试替换的依赖。
 */
export async function runCli(
  argv: string[] = process.argv.slice(2),
  dependencies: RunCliDependencies = {},
): Promise<void> {
  const parsed = parseCliArguments(argv);
  const startServer = dependencies.startServer ?? startStdioServer;
  const writeInfo = dependencies.writeInfo ?? console.log;

  if (parsed.command === "info") {
    writeInfo(formatServerInfo());
    return;
  }

  await startServer();
}

/**
 * 判断当前模块是否作为 CLI 入口直接执行。
 *
 * @returns 直接执行时返回 true。
 */
function isDirectExecution(): boolean {
  const entryPath = process.argv[1];
  if (!entryPath) {
    return false;
  }

  return resolve(entryPath) === fileURLToPath(import.meta.url);
}

/**
 * 作为可执行入口运行 CLI。
 *
 * @returns CLI 执行完成后的 Promise。
 */
async function main(): Promise<void> {
  await runCli();
}

if (isDirectExecution()) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}

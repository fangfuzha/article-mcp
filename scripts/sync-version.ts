/**
 * 检查或同步 package.json 与 MCP 服务器入口中的版本号。
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const packageJsonPath = resolve(projectRoot, "package.json");
const indexPath = resolve(projectRoot, "src/index.ts");

type Command = "check" | "sync";

/**
 * 读取并解析项目 package 元数据。
 *
 * @returns 解析后的 package.json 内容。
 */
async function readPackageJson(): Promise<{ version: string }> {
  const content = await readFile(packageJsonPath, "utf8");
  return JSON.parse(content) as { version: string };
}

/**
 * 从 TypeScript 入口文件提取服务器版本常量。
 *
 * @returns 服务器版本字符串；未找到时返回 null。
 */
async function readServerVersion(): Promise<string | null> {
  const content = await readFile(indexPath, "utf8");
  const match = content.match(/SERVER_VERSION\s*=\s*["']([^"']+)["']/);
  return match?.[1] ?? null;
}

/**
 * 将服务器版本常量同步为 package.json 中的版本。
 *
 * @param version package.json 中的版本。
 * @returns 入口文件是否被修改。
 */
async function syncServerVersion(version: string): Promise<boolean> {
  const content = await readFile(indexPath, "utf8");
  const updated = content.replace(
    /SERVER_VERSION\s*=\s*["'][^"']+["']/,
    `SERVER_VERSION = "${version}"`,
  );

  if (updated === content) {
    return false;
  }

  await writeFile(indexPath, updated, "utf8");
  return true;
}

/**
 * 检查 package.json 与运行时服务器元数据是否使用同一版本。
 *
 * @returns 所有被检查版本一致时返回 true。
 */
async function checkVersion(): Promise<boolean> {
  const packageJson = await readPackageJson();
  const serverVersion = await readServerVersion();

  console.log(`package.json: ${packageJson.version}`);
  console.log(`src/index.ts: ${serverVersion ?? "missing"}`);

  return serverVersion === packageJson.version;
}

/**
 * 执行指定的版本命令。
 *
 * @param command 要执行的版本命令。
 * @returns 命令退出码。
 */
async function run(command: Command): Promise<number> {
  if (command === "check") {
    return (await checkVersion()) ? 0 : 1;
  }

  const packageJson = await readPackageJson();
  const changed = await syncServerVersion(packageJson.version);
  console.log(changed ? `synced version ${packageJson.version}` : "version already synced");
  return 0;
}

const command = process.argv[2] as Command | undefined;

if (command !== "check" && command !== "sync") {
  console.error("Usage: tsx scripts/sync-version.ts <check|sync>");
  process.exitCode = 1;
} else {
  process.exitCode = await run(command);
}

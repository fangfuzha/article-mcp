import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const packageJsonPath = resolve(projectRoot, "package.json");
const indexPath = resolve(projectRoot, "src/index.ts");

type Command = "check" | "sync";

/**
 * Reads and parses the project package metadata.
 *
 * @returns Parsed package.json content.
 */
async function readPackageJson(): Promise<{ version: string }> {
  const content = await readFile(packageJsonPath, "utf8");
  return JSON.parse(content) as { version: string };
}

/**
 * Extracts the server version constant from the TypeScript entrypoint.
 *
 * @returns Server version string or null when not found.
 */
async function readServerVersion(): Promise<string | null> {
  const content = await readFile(indexPath, "utf8");
  const match = content.match(/SERVER_VERSION\s*=\s*["']([^"']+)["']/);
  return match?.[1] ?? null;
}

/**
 * Synchronizes the server version constant from package.json.
 *
 * @param version Version from package.json.
 * @returns Whether the entrypoint was modified.
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
 * Checks whether package.json and runtime server metadata use the same version.
 *
 * @returns True when all checked versions match.
 */
async function checkVersion(): Promise<boolean> {
  const packageJson = await readPackageJson();
  const serverVersion = await readServerVersion();

  console.log(`package.json: ${packageJson.version}`);
  console.log(`src/index.ts: ${serverVersion ?? "missing"}`);

  return serverVersion === packageJson.version;
}

/**
 * Runs the requested version command.
 *
 * @param command Version command to run.
 * @returns Exit code for the command.
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

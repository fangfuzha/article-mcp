import { access, copyFile, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const source = resolve(projectRoot, "npm-README.md");
const target = resolve(projectRoot, "README.md");
const backup = resolve(projectRoot, ".README.repo-backup.md");
const command = process.argv[2] ?? "prepare";
const shouldBackup = !process.argv.includes("--no-backup");

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readNormalized(path: string): Promise<string> {
  return (await readFile(path, "utf8")).replace(/\r\n/g, "\n").trim();
}

/**
 * 将 npm 专用 README 复制为包内 README。
 *
 * 该脚本替代 shell `cp`，避免 Windows 本地 pack/publish 时因为命令不可用而失败；
 * 同时在本地 `postpack` 恢复仓库根 README，避免打包流程污染工作区文档。
 */
if (command === "restore") {
  if (!(await fileExists(backup))) {
    console.log("no README backup to restore");
    process.exit(0);
  }

  await copyFile(backup, target);
  await rm(backup, { force: true });
  console.log("restored repository README.md after packaging");
} else {
  if (shouldBackup) {
    if (await fileExists(backup)) {
      throw new Error(`README backup already exists: ${backup}`);
    }

    if ((await readNormalized(source)) === (await readNormalized(target))) {
      throw new Error(
        "README.md already matches npm-README.md; refusing to back up a packaged README",
      );
    }

    await copyFile(target, backup);
  }

  await copyFile(source, target);
  console.log("prepared npm README.md from npm-README.md");
}

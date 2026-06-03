/**
 * 持久化缓存期刊质量指标并处理过期、并发和降级读取。
 */
import { mkdir, open, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type { JournalQualityCacheEntry } from "../types/journals.js";

const DEFAULT_CACHE_DIR = join(homedir(), ".article_mcp_cache");
const JOURNAL_CACHE_FILE = "journal_quality.json";
const DEFAULT_TTL_MS = 86_400_000;

type JournalQualityCacheFile = {
  version: string;
  updatedAt: number;
  journals: Record<string, JournalQualityCacheEntry>;
};

/**
 * 期刊质量文件缓存。
 *
 * 对应 Python 版 quality_tools.py 中的单文件缓存语义，
 * 由 get_journal_quality 工具写入，journals:// 资源读取。
 */
export class JournalQualityCache {
  private readonly cacheDir: string;
  private readonly ttlMs: number;
  private readonly cacheFilePath: string;
  private readonly lockFilePath: string;

  public constructor(cacheDir?: string, ttlMs?: number) {
    this.cacheDir = cacheDir ?? DEFAULT_CACHE_DIR;
    this.ttlMs = ttlMs ?? DEFAULT_TTL_MS;
    this.cacheFilePath = join(this.cacheDir, JOURNAL_CACHE_FILE);
    this.lockFilePath = `${this.cacheFilePath}.lock`;
  }

  /**
   * 获取缓存目录。
   *
   * @returns 缓存目录路径。
   */
  public getCacheDir(): string {
    return this.cacheDir;
  }

  /**
   * 获取缓存文件路径。
   *
   * @returns 缓存文件完整路径。
   */
  public getCacheFilePath(): string {
    return this.cacheFilePath;
  }

  /**
   * 读取期刊缓存条目。
   *
   * @param journalName 期刊名称。
   * @returns 未过期的缓存条目；不存在或过期时返回 null。
   */
  public async get(journalName: string): Promise<JournalQualityCacheEntry | null> {
    const normalizedName = normalizeJournalName(journalName);
    if (!normalizedName) {
      return null;
    }

    const cacheFile = await this.withFileLock(() => this.readCacheFile());
    const entry = cacheFile.journals[normalizedName];
    if (!entry) {
      return null;
    }

    if (Date.now() - entry.timestamp > this.ttlMs) {
      return null;
    }

    return entry;
  }

  /**
   * 写入或覆盖期刊缓存条目。
   *
   * @param journalName 期刊名称。
   * @param data EasyScholar 结果主体。
   * @param openalexMetrics OpenAlex 增强指标。
   */
  public async set(
    journalName: string,
    data: Record<string, unknown>,
    openalexMetrics?: Record<string, unknown> | null,
  ): Promise<void> {
    const normalizedName = normalizeJournalName(journalName);
    if (!normalizedName) {
      return;
    }

    await mkdir(this.cacheDir, { recursive: true });
    await this.withFileLock(async () => {
      const cacheFile = await this.readCacheFile();

      cacheFile.journals[normalizedName] = {
        timestamp: Date.now(),
        data,
        ...(openalexMetrics ? { openalexMetrics } : {}),
      };
      cacheFile.updatedAt = Date.now();

      await writeFile(this.cacheFilePath, JSON.stringify(cacheFile, null, 2), {
        encoding: "utf-8",
      });
    });
  }

  /**
   * 将缓存条目还原为资源层和工具层可消费的统一结果。
   *
   * @param journalName 期刊名称。
   * @returns 合并 OpenAlex 指标后的缓存结果。
   */
  public async getMergedResult(journalName: string): Promise<Record<string, unknown> | null> {
    const entry = await this.get(journalName);
    if (!entry) {
      return null;
    }

    const merged = structuredClone(entry.data) as Record<string, unknown>;
    const qualityMetrics = isRecord(merged.quality_metrics) ? merged.quality_metrics : {};
    const openalexMetrics = isRecord(entry.openalexMetrics) ? entry.openalexMetrics : {};

    merged.quality_metrics = {
      ...qualityMetrics,
      ...openalexMetrics,
    };

    const originalSource = typeof merged.data_source === "string" ? merged.data_source : "cache";
    if (Object.keys(openalexMetrics).length > 0) {
      merged.data_source = `${originalSource}+openalex_cache`;
    }

    merged.timestamp = entry.timestamp;

    return merged;
  }

  /**
   * 读取缓存文件，如不存在则返回空结构。
   *
   * @returns 当前缓存文件对象。
   */
  private async readCacheFile(): Promise<JournalQualityCacheFile> {
    try {
      const content = await readFile(this.cacheFilePath, { encoding: "utf-8" });
      return JSON.parse(content) as JournalQualityCacheFile;
    } catch {
      return {
        version: "1.0",
        updatedAt: Date.now(),
        journals: {},
      };
    }
  }

  /**
   * 使用锁文件串行化缓存文件的读写，避免并发写入导致数据丢失。
   *
   * @param operation 需要在锁保护下执行的操作。
   * @returns 操作返回值。
   */
  private async withFileLock<T>(operation: () => Promise<T>): Promise<T> {
    await mkdir(this.cacheDir, { recursive: true });

    const startedAt = Date.now();
    while (true) {
      try {
        const handle = await open(this.lockFilePath, "wx");
        try {
          return await operation();
        } finally {
          await handle.close();
          await unlink(this.lockFilePath).catch(() => undefined);
        }
      } catch (error) {
        if (!isAlreadyExistsError(error)) {
          throw error;
        }

        if (Date.now() - startedAt > 5000) {
          throw new Error("获取期刊缓存文件锁超时");
        }

        await delay(20);
      }
    }
  }
}

function normalizeJournalName(journalName: string): string {
  return journalName.trim().toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isAlreadyExistsError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "EEXIST"
  );
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

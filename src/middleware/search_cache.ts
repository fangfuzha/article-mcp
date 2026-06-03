/**
 * 管理持久化搜索缓存的读写、命中判断和过期清理。
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_CACHE_DIR = join(homedir(), ".article_mcp_cache");
const DEFAULT_TTL_MS = 86_400_000; // 24 小时

/**
 * 文件搜索缓存管理器。
 *
 * 对应 Python 版 `SearchCache` 类，使用 SHA256 哈希作为缓存键，
 * 文件系统存储，24 小时 TTL。
 */
export class SearchCache {
  private readonly cacheDir: string;
  private readonly ttlMs: number;
  private hits = 0;
  private misses = 0;

  public constructor(cacheDir?: string, ttlMs?: number) {
    this.cacheDir = cacheDir ?? DEFAULT_CACHE_DIR;
    this.ttlMs = ttlMs ?? DEFAULT_TTL_MS;
  }

  /**
   * 确保缓存目录存在。
   */
  public async ensureDir(): Promise<void> {
    await mkdir(this.cacheDir, { recursive: true });
  }

  /**
   * 获取缓存目录路径。
   */
  public getCacheDir(): string {
    return this.cacheDir;
  }

  /**
   * 根据搜索参数生成缓存键。
   *
   * @param keyword 搜索关键词。
   * @param sources 数据源列表。
   * @param maxResults 每源最大结果数。
   * @returns SHA256 哈希的前 32 位。
   */
  public static generateKey(keyword: string, sources: string[], maxResults: number): string {
    const keyData = `${keyword}|${[...sources].sort().join(",")}|${maxResults}`;
    return createHash("sha256").update(keyData, "utf-8").digest("hex").slice(0, 32);
  }

  /**
   * 从缓存获取结果。
   *
   * @param cacheKey 缓存键。
   * @returns 缓存的结果对象，或 null（未命中/过期/损坏）。
   */
  public async get(cacheKey: string): Promise<Record<string, unknown> | null> {
    const cachePath = this.resolveCachePath(cacheKey);

    try {
      const content = await readFile(cachePath, { encoding: "utf-8" });
      const cacheData = JSON.parse(content) as {
        result: Record<string, unknown>;
        expiry_time: number;
      };

      if (Date.now() > cacheData.expiry_time) {
        await unlink(cachePath).catch(() => undefined);
        this.misses++;
        return null;
      }

      this.hits++;
      return cacheData.result;
    } catch {
      this.misses++;
      return null;
    }
  }

  /**
   * 保存结果到缓存。
   *
   * @param cacheKey 缓存键。
   * @param result 要缓存的结果对象。
   */
  public async set(cacheKey: string, result: Record<string, unknown>): Promise<void> {
    const cachePath = this.resolveCachePath(cacheKey);

    const cacheData = {
      result,
      expiry_time: Date.now() + this.ttlMs,
      cached_at: Date.now(),
    };

    await mkdir(this.resolveCacheDir(cacheKey), { recursive: true });
    await writeFile(cachePath, JSON.stringify(cacheData, null, 2), { encoding: "utf-8" });
  }

  /**
   * 获取缓存统计信息。
   */
  public getStats(): { hits: number; misses: number; total: number; hitRate: number } {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      total,
      hitRate: total > 0 ? Number((this.hits / total).toFixed(2)) : 0,
    };
  }

  /**
   * 获取缓存目录的统计信息（文件数、总大小、最新修改时间）。
   */
  public async getDiskStats(): Promise<{
    totalFiles: number;
    totalSizeBytes: number;
    newestMtime: number;
  }> {
    let totalFiles = 0;
    let totalSizeBytes = 0;
    let newestMtime = 0;

    try {
      const entries = await readdir(this.cacheDir, { recursive: true });
      for (const entry of entries) {
        const fullPath = join(this.cacheDir, entry);
        try {
          const entryStat = await stat(fullPath);
          if (entryStat.isFile() && entry.endsWith(".json")) {
            totalFiles++;
            totalSizeBytes += entryStat.size;
            newestMtime = Math.max(newestMtime, entryStat.mtimeMs);
          }
        } catch {
          // 跳过无法访问的文件
        }
      }
    } catch {
      // 缓存目录不存在
    }

    return { totalFiles, totalSizeBytes, newestMtime };
  }

  /**
   * 生成缓存文件的完整路径。
   */
  private resolveCachePath(cacheKey: string): string {
    return join(this.resolveCacheDir(cacheKey), `${cacheKey}.json`);
  }

  /**
   * 生成缓存文件所在子目录。
   */
  private resolveCacheDir(cacheKey: string): string {
    return join(this.cacheDir, cacheKey.slice(0, 2));
  }
}

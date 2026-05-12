import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SearchCache } from "../src/middleware/search_cache.js";

describe("SearchCache", () => {
  let cacheDir: string;
  let cache: SearchCache;

  beforeEach(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), "search-cache-test-"));
    cache = new SearchCache(cacheDir, 86_400_000);
    await cache.ensureDir();
  });

  afterEach(async () => {
    // 清理测试缓存目录由 OS 临时目录机制处理
  });

  it("生成一致的缓存键", () => {
    const key1 = SearchCache.generateKey("cancer", ["pubmed", "arxiv"], 10);
    const key2 = SearchCache.generateKey("cancer", ["arxiv", "pubmed"], 10);
    const key3 = SearchCache.generateKey("cancer", ["pubmed", "arxiv"], 20);

    expect(key1).toBe(key2); // 排序后应一致
    expect(key1).not.toBe(key3); // maxResults 不同应不同键
    expect(key1).toHaveLength(32); // SHA256 前 32 位
  });

  it("set 后 get 能返回缓存结果", async () => {
    const key = SearchCache.generateKey("test", ["source"], 5);
    const data = { articles: [{ title: "Test" }], total: 1 };

    await cache.set(key, data);
    const result = await cache.get(key);

    expect(result).toEqual(data);
  });

  it("未设置时返回 null", async () => {
    const result = await cache.get("nonexistent_key");
    expect(result).toBeNull();
  });

  it("过期缓存返回 null", async () => {
    const shortCache = new SearchCache(cacheDir, 0); // 0 TTL = 立即过期
    const key = SearchCache.generateKey("test", ["source"], 5);

    await shortCache.set(key, { articles: [] });
    await new Promise((resolve) => setTimeout(resolve, 10)); // 确保过期
    const result = await shortCache.get(key);

    expect(result).toBeNull();
  });

  it("写入缓存后磁盘文件存在且包含必要字段", async () => {
    const key = SearchCache.generateKey("cancer", ["pubmed"], 10);
    await cache.set(key, { articles: [{ title: "A" }], total: 1 });

    // 检查文件是否写入
    const filePath = join(cacheDir, key.slice(0, 2), `${key}.json`);
    const content = await readFile(filePath, { encoding: "utf-8" });
    const parsed = JSON.parse(content);

    expect(parsed.result).toBeDefined();
    expect(parsed.expiry_time).toBeGreaterThan(Date.now());
    expect(parsed.cached_at).toBeGreaterThan(0);
  });

  it("统计信息正确计数", async () => {
    const key = SearchCache.generateKey("test", ["a"], 5);

    // miss
    await cache.get(key);
    // miss
    await cache.get("other");
    // hit (after set)
    await cache.set(key, { value: 1 });
    await cache.get(key);

    const stats = cache.getStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(2);
    expect(stats.total).toBe(3);
    expect(stats.hitRate).toBeGreaterThan(0);
  });
});

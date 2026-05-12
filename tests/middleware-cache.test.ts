import { describe, expect, it } from "vitest";

import { CacheManager } from "../src/middleware/index.js";

describe("CacheManager", () => {
  it("bypasses cache reads and writes when disabled", async () => {
    const cache = new CacheManager();
    let calls = 0;

    const first = await cache.getCachedOrFetch("key", async () => ({ value: ++calls }));
    const cached = await cache.getCachedOrFetch("key", async () => ({ value: ++calls }));
    const bypassed = await cache.getCachedOrFetch(
      "key",
      async () => ({ value: ++calls }),
      24,
      false,
    );
    const afterBypass = await cache.getCachedOrFetch("key", async () => ({ value: ++calls }));

    expect(first).toEqual({ value: 1, cache_hit: false });
    expect(cached).toEqual({ value: 1, cache_hit: true });
    expect(bypassed).toEqual({ value: 2, cache_hit: false });
    expect(afterBypass).toEqual({ value: 1, cache_hit: true });
  });
});

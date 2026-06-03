/**
 * 验证精简配置状态资源只返回影响工具调用策略的信息。
 */
import { describe, expect, it } from "vitest";

import {
  buildConfigStatusPayload,
  readConfigStatusResource,
} from "../src/resources/config_status.js";

describe("config status resource", () => {
  it("reports API, cache, and capability status without duplicate MCP metadata", () => {
    const payload = buildConfigStatusPayload({ EASYSCHOLAR_SECRET_KEY: "secret" });

    expect(payload).toEqual({
      status: "running",
      api_configuration: {
        easyscholar_available: true,
      },
      cache: {
        search_cache_available: true,
        journal_quality_cache_available: true,
        ttl_hours: 24,
      },
      capabilities: {
        fulltext_resource_links: true,
        relation_resource_links: true,
        structured_tool_output: true,
        journal_quality_fallback: "openalex",
      },
    });
    expect(payload).not.toHaveProperty("server");
    expect(payload).not.toHaveProperty("tools");
    expect(payload).not.toHaveProperty("resources");
    expect(payload).not.toHaveProperty("runtime");
    expect(JSON.stringify(payload)).not.toContain("secret");
  });

  it("marks EasyScholar unavailable when no key is configured", () => {
    expect(buildConfigStatusPayload({}).api_configuration.easyscholar_available).toBe(false);
    expect(
      buildConfigStatusPayload({ EASYSCHOLAR_SECRET_KEY: "   " }).api_configuration
        .easyscholar_available,
    ).toBe(false);
  });

  it("reads config://status as JSON content", async () => {
    const result = await readConfigStatusResource(new URL("config://status"), {});
    const content = result.contents[0] as { uri?: string; mimeType?: string; text?: string };

    expect(content.uri).toBe("config://status");
    expect(content.mimeType).toBe("application/json");
    expect(JSON.parse(content.text ?? "{}")).toMatchObject({
      status: "running",
      api_configuration: {
        easyscholar_available: false,
      },
    });
  });
});

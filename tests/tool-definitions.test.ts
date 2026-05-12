import { describe, expect, it } from "vitest";

import { TOOL_DEFINITIONS } from "../src/tools/definitions.js";

const expectedToolNames = [
  "search_literature",
  "get_article_details",
  "get_references",
  "get_literature_relations",
  "get_journal_quality",
];

/**
 * Recursively collects JSON schema paths where an array misses `items`.
 *
 * @param value Schema fragment to inspect.
 * @param path Current path for error reporting.
 * @param missing Mutable collection of invalid paths.
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

describe("tool definitions", () => {
  it("registers the migrated Article MCP tool set", () => {
    expect(TOOL_DEFINITIONS.map((tool) => tool.name)).toEqual(expectedToolNames);
  });

  it("keeps all tools read-only and schema-backed", () => {
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.annotations?.readOnlyHint).toBe(true);
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema.properties).toBeTruthy();
    }
  });

  it("defines items for every array schema", () => {
    const missing: string[] = [];

    for (const tool of TOOL_DEFINITIONS) {
      collectMissingArrayItems(tool.inputSchema, tool.name, missing);
    }

    expect(missing).toEqual([]);
  });
});

/**
 * Guards README output-contract wording against drifting from the MCP tool result shape.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

async function readProjectFile(path: string): Promise<string> {
  return readFile(path, "utf8");
}

describe("documentation contract", () => {
  it("describes content as readable summary plus JSON fallback", async () => {
    const readme = await readProjectFile("README.md");
    const readmeEn = await readProjectFile("README.en.md");

    expect(readme).toContain("JSON 备份");
    expect(readmeEn).toContain("serialized JSON");
    expect(readme).not.toContain("资源 URI");
    expect(readmeEn).not.toContain("not the full JSON payload");
  });
});

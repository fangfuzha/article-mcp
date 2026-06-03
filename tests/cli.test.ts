/**
 * 验证 CLI 参数解析、服务器信息输出和启动分支。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SERVER_NAME,
  SERVER_VERSION,
  formatServerInfo,
  parseCliArguments,
  runCli,
} from "../src/index.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CLI entry", () => {
  it("parses no arguments as the default server command", () => {
    expect(parseCliArguments([])).toEqual({ command: "server" });
  });

  it("parses the info command", () => {
    expect(parseCliArguments(["info"])).toEqual({ command: "info" });
  });

  it("prints project information for the info command", async () => {
    const stdoutSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runCli(["info"]);

    expect(stdoutSpy).toHaveBeenCalledWith(formatServerInfo());
  });

  it("starts the stdio server for the explicit server command", async () => {
    const startServer = vi.fn(async () => undefined);

    await runCli(["server"], { startServer });

    expect(startServer).toHaveBeenCalledTimes(1);
  });

  it("starts the stdio server when no command is provided", async () => {
    const startServer = vi.fn(async () => undefined);

    await runCli([], { startServer });

    expect(startServer).toHaveBeenCalledTimes(1);
  });

  it("formats stable server information", () => {
    expect(formatServerInfo()).toContain(SERVER_NAME);
    expect(formatServerInfo()).toContain(SERVER_VERSION);
    expect(formatServerInfo()).toContain("search_literature");
    expect(formatServerInfo()).toContain("get_journal_quality");
  });
});

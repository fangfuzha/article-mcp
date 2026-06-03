/**
 * 验证 stdio 安全日志器不会向 stdout 输出日志。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("stdio safe logger", () => {
  it("redirects log and info calls to stderr", async () => {
    const stderrSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const stdoutLogSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const stdoutInfoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);

    const { stdioSafeLogger } = await import("../src/utils/stdio_safe_logger.js");

    stdioSafeLogger.log("log message");
    stdioSafeLogger.info("info message");

    expect(stderrSpy).toHaveBeenCalledWith("log message");
    expect(stderrSpy).toHaveBeenCalledWith("info message");
    expect(stdoutLogSpy).not.toHaveBeenCalled();
    expect(stdoutInfoSpy).not.toHaveBeenCalled();
  });
});

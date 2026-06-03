/**
 * 将日志输出重定向到 stderr，避免污染 MCP stdio 协议数据。
 */
export const stdioSafeLogger = Object.assign(Object.create(console), {
  // 重定向到 stderr，保持 stdout 纯净用于数据传输
  log: console.error.bind(console),
  info: console.error.bind(console),
}) as Console;

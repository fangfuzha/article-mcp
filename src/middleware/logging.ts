/**
 * 日志和计时中间件兼容导出。
 *
 * 真实实现位于 `middleware/index.ts`，这里仅保留旧导入路径，避免生产注册
 * 或外部调用继续拿到过时的 `processing_time` 文本注入逻辑。
 */

export { createLoggingMiddleware, createTimingMiddleware } from "./index.js";

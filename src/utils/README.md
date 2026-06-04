# utils 模块说明

该模块提供跨服务与工具复用的基础工具能力。

**主要用途**：沉淀学术文献与科研论文检索分析流程中的通用工具函数，保持各数据源和工具实现一致。

- 封装通用 API 调用辅助逻辑（如请求构建、响应处理）。
- 作为公共能力层，减少重复代码并保持实现一致性。

## 身份配置辅助

- `service_identity.ts` 统一读取 NCBI、OpenAlex、Crossref、Semantic Scholar 的身份配置。
- OpenAlex 缺少 `OPENALEX_API_KEY` 时返回明确配置错误，避免真实请求失败后才暴露 401/403。
- NCBI 未设置 `NCBI_RATE_LIMIT_MS` 时会根据 `NCBI_API_KEY` 自动选择默认限速：有 key 为 100ms，无 key 为 333ms。

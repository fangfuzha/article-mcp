# Article MCP Node 测试

Node 版测试分为两层：

**主要用途**：验证学术文献与科研论文检索分析型 MCP 服务的工具注册、协议兼容性和结构化输出稳定性。

- `tool-definitions.test.ts`: 快速校验工具清单、annotations 和 JSON Schema 结构。
- `npm run test:mcp`: 启动编译后的 stdio MCP 服务，验证客户端能正常获取服务器元数据和工具列表。

运行顺序建议：

```bash
npm run build
npm test
npm run test:mcp
```

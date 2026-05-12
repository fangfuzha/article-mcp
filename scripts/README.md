# Article MCP Node 工程脚本

本目录保存 Node 版迁移项目的工程化脚本，对应 Python 版 `reference/scripts/` 中的版本同步和 MCP 合规检查能力。

## 常用命令

```bash
npm run version:check
npm run version:sync
npm run test:mcp
npm run test:all
```

## 脚本说明

- `sync-version.ts`: 以 `package.json` 为版本权威源，检查或同步 `src/index.ts` 的服务器版本。
- `test-mcp-compliance.ts`: 构建项目后启动 stdio MCP 服务，验证服务器元数据、工具注册、annotations 和 JSON Schema 数组字段。

# Article MCP Node 工程脚本

本目录保存 Node 版迁移项目的工程化脚本，对应 Python 版 `reference/article-mcp/scripts/` 中的版本同步和 MCP 合规检查能力。

## 常用命令

```bash
npm run version:check
npm run version:sync
npm run test:mcp
npm run test:all
npm run prepare:readme
npm run restore:readme
npm run prepack
```

## 脚本说明

- `sync-version.ts`: 以 `package.json` 为版本权威源，检查或同步 `src/index.ts` 的服务器版本。
- `test-mcp-compliance.ts`: 构建项目后启动 stdio MCP 服务，验证服务器元数据、工具注册、annotations、输入/输出 schema、资源模板和真实工具调用的结构化输出；任一检查失败都会使命令失败。
- `prepare-package-readme.ts`: 跨平台复制 `npm-README.md` 为包内 `README.md`，并在 `postpack` 恢复仓库根 README；若检测到 README 已是 npm 版或备份已存在，会拒绝覆盖备份。

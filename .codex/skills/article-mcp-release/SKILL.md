---
name: article-mcp-release
description: Release article-mcp through the project's GitHub Actions npm publish workflow. Use when bumping versions, triggering tag-based publishes, monitoring the Publish Node Package workflow, or diagnosing npm release status for this repository.
---

# Article MCP Release

Use the GitHub Actions workflow, not local `npm publish`, as the primary release path. The workflow is `.github/workflows/publish.yml` and triggers on tags matching `v*`.

## Preconditions

- Worktree is clean before starting release prep: `git status --short`.
- `package.json`, `package-lock.json`, and `src/index.ts` versions must match.
- npm registry version is checked first: `npm view article-mcp version --json`.
- GitHub CLI should be authenticated with repo access: `gh auth status`.

## Patch Release Workflow

1. Bump without auto-tagging:
   - `npm version patch --no-git-tag-version`
   - For minor/major, use `minor` or `major` only when explicitly requested.
2. Sync runtime metadata:
   - `npm run version:sync`
   - `npm run format`
3. Validate:
   - `npm run test:all`
4. Commit version files:
   - `git add package.json package-lock.json src/index.ts`
   - `git commit -m "chore release <version>"`
5. Create and push tag:
   - `git tag v<version>`
   - `git push origin main`
   - `git push origin v<version>`
6. Monitor workflow:
   - `gh run list --workflow "Publish Node Package" --limit 5`
   - `gh run watch <run-id> --exit-status`
7. Verify registry:
   - `npm view article-mcp version --json`

## GitHub Push Notes

If SSH push fails but `gh auth status` is authenticated, this repository can use a local URL rewrite:

```powershell
git config --local url.https://github.com/.insteadOf git@github.com:
git push origin main
git push origin v<version>
```

Do not change global Git config for this. Keep the workaround local to the repository.

## Failure Handling

- If `npm view` already shows the target version, do not republish; verify tag/workflow state instead.
- If workflow fails, inspect logs with `gh run view <run-id> --log-failed`.
- If publish fails due `NPM_TOKEN`, the fix is in GitHub Actions environment/secret configuration, not local npm auth.
- Do not create a new tag for the same version after a failed run unless the previous tag was deleted intentionally.

# Release Checklist

Use this checklist before tagging and publishing a release.

## Preflight

- Confirm `README.md`, `CHANGELOG.md`, and examples match the released API.
- Confirm no API keys, access tokens, or production URLs are committed.
- Run `npm ci`.
- Run `npm run check`.
- Run `npm test`.
- Run `npm pack --dry-run`.
- Run production smoke only with an explicitly provided API key and a runtime-enabled template.

## Production Smoke

```bash
SANDBOX_RUN_INTEGRATION=1 \
SANDBOX_TEST_BASE_URL="${SEACLOUD_BASE_URL}" \
SANDBOX_TEST_API_KEY="${SEACLOUD_API_KEY}" \
SANDBOX_TEST_TEMPLATE_ID=tpl-base-dc11799b9f9f4f9e \
npm run test:integration
```

## Publish

- Update `package.json` version and `CHANGELOG.md`.
- Build with `npm run build`.
- For GitHub Actions publishing, add repository secret `NPM_TOKEN` and use `.github/workflows/publish.yml`.
  Secret name: `NPM_TOKEN`
  Repository: `SeaCloudAI/sandbox-node`
- Manual fallback: publish with `npm publish --access public`.
- Create and push a signed tag, for example `git tag -s v0.1.0 -m "v0.1.0"`.

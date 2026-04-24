# Sandbox Node SDK

TypeScript SDK for Sandbox control-plane, build-plane, and nano-executor CMD APIs.

## Install

```bash
npm install @seacloudai/sandbox
```

## Client Initialization

- unified gateway client: `new SandboxClient({ baseUrl, apiKey })`
- build plane via root client: `client.build`
- runtime helper: `sandbox.runtime` or `client.runtimeFromSandbox(sandbox)`

`control` and `build` use the gateway `baseUrl`. Runtime access is derived from sandbox create/detail/connect responses; callers should not hardcode runtime endpoints or tokens. Domain models and helpers are imported from their subpaths.

## Recommended Workflow

Most applications only need the root client:

1. Initialize `new SandboxClient({ baseUrl, apiKey })`.
2. Create, list, get, or connect sandboxes from the root client.
3. Keep working from the bound sandbox object:
   `reload()`, `logs()`, `pause()`, `refresh()`, `setTimeout()`, `connect()`, `delete()`.
4. When the sandbox exposes `envdUrl`, switch into runtime operations through `sandbox.runtime`.
5. Use `client.build` only for template/build workflows.

## Quick Start

### Control Plane

```ts
import { SandboxClient } from "@seacloudai/sandbox";

const client = new SandboxClient({
  baseUrl: "https://sandbox-gateway.cloud.seaart.ai",
  apiKey: process.env.SEACLOUD_API_KEY,
  timeoutMs: 180_000,
});

const sandbox = await client.createSandbox({
  templateID: "base",
  workspaceId: "node-sdk-demo",
  timeout: 1800,
  waitReady: true,
});

console.log(sandbox.sandboxID, sandbox.envdUrl);
if (sandbox.envdUrl) {
  console.log(sandbox.runtime.baseUrl);
}
```

### Bound Sandbox Workflow

```ts
const listed = await client.listSandboxes();

for (const sandbox of listed) {
  const detail = await sandbox.reload();
  console.log(detail.sandboxID, detail.status);
}
```

### Build Plane Through Root Client

```ts
import { SandboxClient } from "@seacloudai/sandbox";

const client = new SandboxClient({
  baseUrl: "https://sandbox-gateway.cloud.seaart.ai",
  apiKey: process.env.SEACLOUD_API_KEY,
});

const template = await client.build.createTemplate({
  name: "demo",
  visibility: "personal",
  image: "docker.io/library/alpine:3.20",
});

console.log(template.templateID, template.buildID);
```

### Runtime Helper

```ts
import { SandboxClient } from "@seacloudai/sandbox";

const client = new SandboxClient({
  baseUrl: "https://sandbox-gateway.cloud.seaart.ai",
  apiKey: process.env.SEACLOUD_API_KEY,
});

const created = await client.createSandbox({
  templateID: process.env.SANDBOX_EXAMPLE_TEMPLATE_ID,
  waitReady: true,
});

try {
  const runtime = created.runtime;

  await runtime.writeFile({
    path: "/root/workspace/hello.txt",
    data: new TextEncoder().encode("hello from node"),
  });

  const response = await runtime.readFile({ path: "/root/workspace/hello.txt" });
  console.log(await response.text());
} finally {
  await created.delete();
}
```

## Root Client First

For most integrations, stay on the root client as long as possible:

- initialize once with `new SandboxClient({ baseUrl, apiKey })`
- use `createSandbox`, `listSandboxes`, `getSandbox`, `connectSandbox`
- continue from the returned sandbox object with `reload()`, `logs()`, `pause()`, `refresh()`, `setTimeout()`, `connect()`, `delete()`
- only switch to runtime with `runtime` when you need file/process/stream operations
- use `client.build` only for template/build workflows

Low-level subpath modules remain available when you want direct stateless calls or need request/response types explicitly.

## API Surface

### Control Plane APIs

`SandboxClient` exposes control-plane methods directly and build-plane methods under `client.build`:

- system: `metrics`, `shutdown`
- sandboxes: `createSandbox`, `listSandboxes`, `getSandbox`, `deleteSandbox`
- sandbox operations: `getSandboxLogs`, `pauseSandbox`, `connectSandbox`, `setSandboxTimeout`, `refreshSandbox`, `sendHeartbeat`
- admin: `getPoolStatus`, `startRollingUpdate`, `getRollingUpdateStatus`, `cancelRollingUpdate`

Recommended root-client path:

- sandbox lifecycle: `createSandbox`, `listSandboxes`, `getSandbox`, `connectSandbox`
- follow-up control actions from the returned object: `reload()`, `logs()`, `pause()`, `refresh()`, `setTimeout()`, `connect()`, `delete()`
- runtime actions from objects that include `envdUrl`: `runtime`

Low-level direct methods like `deleteSandbox` and `getSandboxLogs` remain available on the root client when you want stateless calls.

### Build Plane Namespace

`client.build` exposes:

- system: `metrics`
- direct build: `directBuild`
- templates: `createTemplate`, `listTemplates`, `getTemplateByAlias`, `getTemplate`, `updateTemplate`, `deleteTemplate`
- builds: `createBuild`, `getBuildFile`, `rollbackTemplate`, `listBuilds`, `getBuild`, `getBuildStatus`, `getBuildLogs`

### Runtime Namespace

The object returned by `sandbox.runtime` or `client.runtimeFromSandbox(...)` exposes:

- system: `metrics`, `envs`, `configure`, `ports`
- proxy and file transfer: `proxy`, `download`, `filesContent`, `uploadBytes`, `uploadJson`, `uploadMultipart`, `writeBatch`, `composeFiles`, `readFile`, `writeFile`
- filesystem RPC: `listDir`, `stat`, `makeDir`, `remove`, `move`, `edit`
- watchers: `watchDir`, `createWatcher`, `getWatcherEvents`, `removeWatcher`
- process RPC: `start`, `connect`, `listProcesses`, `sendInput`, `sendSignal`, `closeStdin`, `update`, `streamInput`, `getResult`, `run`

Useful CMD helpers from `@seacloudai/sandbox/cmd`:

- `CmdRequestOptions`: username, signature, signature expiration, range, timeout, extra headers
- `ProcessStream` and `FilesystemWatchStream`: Connect-RPC stream readers
- `ConnectFrame`: low-level frame parser for `streamInput`

## Module Layout

- `@seacloudai/sandbox`: root `SandboxClient` and recommended entrypoint
- `@seacloudai/sandbox/control`: control-plane types and low-level service
- `@seacloudai/sandbox/build`: build-plane types and low-level service
- `@seacloudai/sandbox/cmd`: runtime types, streams, and low-level service
- `@seacloudai/sandbox/core`: shared errors and common response types

## Notes

- The gateway entrypoint only needs `baseUrl + apiKey`.
- Runtime access should be derived from sandbox response objects with `sandbox.runtime` or `runtimeFromSandbox(...)`.
- `createSandbox` and `getSandbox` return `envdUrl` and `envdAccessToken` when the sandbox exposes nano-executor APIs.
- Runtime file/process APIs require a template image that starts nano-executor and returns runtime access fields; if runtime APIs return `404`, verify the selected template supports CMD runtime routes.
- `timeoutMs` can be configured on `SandboxClient`; per-request runtime overrides are available in `CmdRequestOptions`.
- `waitReady: true` can take longer than the default timeout in production; pass `timeoutMs` to `new SandboxClient(...)` for long-wait workflows.
- HTTP errors are classified into typed errors such as `NotFoundError`, `RateLimitError`, and `ServerError`. Transport timeouts raise `RequestTimeoutError`.
- Sandbox timeout is validated to `0..86400`; refresh duration to `0..3600`.
- Build validation currently rejects unsupported `fromImageRegistry`, `force`, and per-step `args`/`force`.
- Some gateways do not expose `/admin/*` or `/build`; the integration suite skips those cases on `404`.

## Security

- Do not commit `SEACLOUD_API_KEY`, `envdAccessToken`, or sandbox access tokens.
- Treat runtime tokens as sandbox-scoped secrets. Prefer `sandbox.runtime` or `client.runtimeFromSandbox(...)` so response-scoped runtime access is not copied into configuration.
- Do not log raw API keys or runtime tokens. SDK errors may include response bodies, so avoid logging full error payloads in multi-tenant systems.
- The SDK does not construct tenant routing headers. Gateway routing context is derived from the API key.

## Production Smoke

Use production smoke tests only with explicitly provided credentials and disposable sandboxes:

```bash
SANDBOX_RUN_INTEGRATION=1 \
SANDBOX_TEST_BASE_URL=https://sandbox-gateway.cloud.seaart.ai \
SANDBOX_TEST_API_KEY=... \
SANDBOX_TEST_TEMPLATE_ID=tpl-base-dc11799b9f9f4f9e \
npm run test:integration
```

`tpl-base-dc11799b9f9f4f9e` is a known-good SeaCloudAI runtime template for validating CMD routes such as `listDir`, `readFile`, `writeFile`, and `run`.

## Scripts

```bash
npm run build
npm run check
npm test
```

## Integration Tests

```bash
SANDBOX_RUN_INTEGRATION=1 \
SANDBOX_TEST_BASE_URL=https://sandbox-gateway.cloud.seaart.ai \
SANDBOX_TEST_API_KEY=... \
SANDBOX_TEST_TEMPLATE_ID=... \
npm run test:integration
```

Use a runtime-enabled template for CMD integration coverage. For SeaCloudAI production smoke tests, `tpl-base-dc11799b9f9f4f9e` is a known-good runtime template.

## Release

- See `CHANGELOG.md` for release notes.
- See `RELEASE_CHECKLIST.md` before tagging or publishing a new version.

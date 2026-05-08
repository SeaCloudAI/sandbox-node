# Sandbox Node SDK

TypeScript SDK for Sandbox control-plane, build-plane, and nano-executor CMD APIs.

## Install

```bash
npm install @seacloudai/sandbox
```

## Entrypoints

Preferred public API:

- initialize once: `new SandboxClient({ baseUrl, apiKey, projectId? })`
- sandbox lifecycle through the root client: `client.create()`, `client.connect()`, `client.list()`
- sandbox runtime modules from the returned object: `sandbox.commands`, `sandbox.files`, `sandbox.git`, `sandbox.pty`
- template builder through the root client: `new Template()` plus `client.buildTemplate()`
- low-level build plane via `client.build`
- raw runtime helper: `client.runtimeFromSandbox(sandbox.raw)` or low-level sandbox instances returned by `createSandbox(...)` / `getSandbox(...)`

`control` and `build` use the gateway `baseUrl`. Runtime access is derived from sandbox create/detail/connect responses; callers should not hardcode runtime endpoints or tokens. `projectId` is an optional gateway routing header for project-scoped deployments.

## E2B Alignment

- Supported alignment target: sandbox lifecycle, files, commands, git, PTY, and the high-level template DSL are designed to follow the same public workflow as `e2b-docs/sdk`.
- Known unsupported area: snapshot APIs are not exposed because the underlying platform does not support them yet.
- Runtime compatibility note: the SDK normalizes a few runtime-specific quirks so the high-level behavior stays E2B-like, such as missing-process `kill()` results and PTY reconnect output framing.

## Environment

Use environment variables for gateway configuration in all examples and quick starts:

- `SEACLOUD_BASE_URL`: SeaCloudAI gateway entrypoint
- `SEACLOUD_API_KEY`: API key used for gateway routing and authentication
- `SEACLOUD_PROJECT_ID`: optional project routing key for project-scoped gateways
- `SEACLOUD_TEMPLATE_ID`: sandbox template identifier or official template type for your target environment

Set them once in your shell:

```bash
export SEACLOUD_BASE_URL="https://sandbox-gateway.cloud.seaart.ai"
export SEACLOUD_API_KEY="..."
export SEACLOUD_PROJECT_ID="project-..."
export SEACLOUD_TEMPLATE_ID="tpl-..."
```

Default production gateway:

```text
https://sandbox-gateway.cloud.seaart.ai
```

Use `SEACLOUD_TEMPLATE_ID` for production integrations. It can be either a concrete template ID such as `tpl-...` or a stable official template type such as `base`, `claude`, or `codex` when your environment publishes those official templates.

## Production Readiness

- Initialize one root client per process and reuse it.
- Treat every quick start as creating billable or quota-bound resources unless it explicitly cleans them up.
- Prefer explicit template references from configuration over hardcoded example values.
- In SeaCloudAI environments, prefer official template types such as `base`, `claude`, or `codex` when you want a stable platform-managed entrypoint.
- Use longer client timeouts for `waitReady` flows and image builds.
- Derive runtime access from sandbox responses instead of storing runtime endpoints or tokens in config.

## Compatibility

- Node.js: requires `>=18` as declared in `package.json`.
- API model: this SDK targets the unified SeaCloudAI sandbox gateway and keeps public template APIs limited to user-facing fields.
- Stability: operator/admin routes may exist on the gateway, but they are not part of the public SDK workflow described in this README.
- Retry model: treat create/delete/build operations as remote control-plane actions; add idempotency and retry policy in your application layer according to your workload.

## Quick Start

### Control Plane

```ts
import { SandboxClient } from "@seacloudai/sandbox";

const client = new SandboxClient({
  baseUrl: process.env.SEACLOUD_BASE_URL,
  apiKey: process.env.SEACLOUD_API_KEY,
  projectId: process.env.SEACLOUD_PROJECT_ID,
  timeoutMs: 180_000,
});

const sandbox = await client.create(process.env.SEACLOUD_TEMPLATE_ID, {
  timeout: 1800,
  waitReady: true,
});

try {
  console.log(sandbox.sandboxId, sandbox.sandboxDomain);
} finally {
  await sandbox.delete();
}
```

### Bound Sandbox Workflow

```ts
const client = new SandboxClient({
  baseUrl: process.env.SEACLOUD_BASE_URL,
  apiKey: process.env.SEACLOUD_API_KEY,
});
const listed = await client.list();

for (const sandbox of listed) {
  await sandbox.reload();
  console.log(sandbox.sandboxId, sandbox.status);
}
```

### Template Build

```ts
import { SandboxClient, Template, waitForFile } from "@seacloudai/sandbox";

const client = new SandboxClient({
  baseUrl: process.env.SEACLOUD_BASE_URL,
  apiKey: process.env.SEACLOUD_API_KEY,
  projectId: process.env.SEACLOUD_PROJECT_ID,
});

const built = await client.buildTemplate(
  new Template()
    .fromImage("docker.io/library/alpine:3.20")
    .runCmd("echo hello-from-node >/tmp/hello.txt")
    .setReadyCmd(waitForFile("/tmp/hello.txt")),
  "demo:v1",
);

console.log(built.templateID, built.buildID, built.status);
```

High-level template helpers currently include:

- lifecycle and status: `client.buildTemplate`, `client.buildTemplateInBackground`, `client.templateExists`, `client.templateAliasExists`, `client.getTemplateBuildStatus`, `client.listTemplates`, `client.getTemplate`, `client.deleteTemplate`
- serialization: `Template.toJSON`, `Template.toDockerfile`
- base images and registries: `fromDockerfile`, `fromBaseImage`, `fromNodeImage`, `fromPythonImage`, `fromBunImage`, `fromUbuntuImage`, `fromDebianImage`, `fromAWSRegistry`, `fromGCPRegistry`
- build-step helpers: `copy`, `copyItems`, `skipCache`, `aptInstall`, `gitClone`, `makeDir`, `makeSymlink`, `npmInstall`, `pipInstall`, `bunInstall`, `remove`, `rename`
- execution and config helpers: `runCmd`, `setEnvs`, `setWorkdir`, `setUser`, `setStartCmd`, `setReadyCmd`, `filesHash`
- supported local copy options: `forceUpload`, `mode`, `resolveSymlinks`
- supported command and path options: `runCmd(..., { user })`, `gitClone(..., { user })`, `makeDir(..., { user })`, `makeSymlink(..., { user })`, `remove(..., { user })`, `rename(..., { user })`
- intentionally not exposed yet: `copy(..., { user })`, MCP server helpers, and devcontainer helpers

### Runtime Modules

```ts
import { SandboxClient } from "@seacloudai/sandbox";

const client = new SandboxClient({
  baseUrl: process.env.SEACLOUD_BASE_URL,
  apiKey: process.env.SEACLOUD_API_KEY,
});

const sandbox = await client.create(process.env.SEACLOUD_TEMPLATE_ID, {
  waitReady: true,
});

try {
  await sandbox.files.write("/root/workspace/hello.txt", "hello from node");
  console.log(await sandbox.files.read("/root/workspace/hello.txt"));
  console.log(sandbox.getHost(3000));
} finally {
  await sandbox.delete();
}
```

Bound sandbox helpers currently include:

- lifecycle: `reload`, `connect`, `resume`, `getInfo`, `logs`, `pause`, `kill`, `delete`, `refresh`, `setTimeout`, `isRunning`
- runtime conveniences: `getMetrics`, `getHost`, `proxy`
- commands module: `run`, `exec`, `list`, `connect`, `kill`, `sendStdin`
- filesystem module: `exists`, `getInfo`, `list`, `makeDir`, `read`, `write`, `writeFiles`, `remove`, `rename`, `watchDir`
- git module: `clone`, `pull`, `checkout`, `status`
- pty module: `create`, `connect`, `kill`, `sendStdin`, `resize`

## Recommended Usage

For most integrations, prefer one root client per process:

- initialize once with `new SandboxClient({ baseUrl, apiKey, projectId? })`
- create sandboxes with `client.create(...)`
- continue through `sandbox.commands`, `sandbox.files`, `sandbox.git`, and `sandbox.pty`
- build templates with `new Template()` plus `client.buildTemplate(...)`

Low-level methods remain available when you need tighter request control:

- use `createSandbox`, `listSandboxes`, `getSandbox`, `connectSandbox`
- continue from the returned sandbox object with `reload()`, `connect()`, `resume()`, `getInfo()`, `getMetrics()`, `getHost()`, `logs()`, `pause()`, `refresh()`, `setTimeout()`, `kill()`, `delete()`, and `isRunning()`
- only switch to runtime with `runtime` when you need file/process/stream operations
- use `buildTemplate`, `buildTemplateInBackground`, `templateExists`, `getTemplateBuildStatus`, `listTemplates`, `getTemplate`, and `deleteTemplate` on the root client for bound template workflows
- use `client.build` only for raw template/build workflows
- use `templateBuild()` when you want a small E2B-style helper that compiles into `BuildRequest`

Low-level subpath modules remain available when you need direct request/response types or tighter transport control.

## API Surface

### Control Plane APIs

`SandboxClient` exposes control-plane methods directly and build-plane methods under `client.build`:

- system: `metrics`, `shutdown`
- sandboxes: `createSandbox`, `listSandboxes`, `getSandbox`, `deleteSandbox`
- sandbox operations: `getSandboxLogs`, `pauseSandbox`, `connectSandbox`, `setSandboxTimeout`, `refreshSandbox`, `sendHeartbeat`

Recommended root-client path:

- high-level lifecycle: `create`, `connect`, `list`
- template helpers: `buildTemplate`, `buildTemplateInBackground`, `templateExists`, `templateAliasExists`, `getTemplateBuildStatus`, `listTemplates`, `getTemplate`, `deleteTemplate`
- low-level lifecycle: `createSandbox`, `listSandboxes`, `getSandbox`, `connectSandbox`
- follow-up control actions from the returned object: `reload()`, `connect()`, `resume()`, `getInfo()`, `getMetrics()`, `getHost()`, `logs()`, `pause()`, `refresh()`, `setTimeout()`, `kill()`, `delete()`, `isRunning()`
- runtime actions from objects that include `envdUrl`: `runtime`

Low-level direct methods like `deleteSandbox` and `getSandboxLogs` remain available on the root client when you want explicit control-plane requests.

### Operator APIs

The root client also includes operator-oriented methods such as `getPoolStatus`, `startRollingUpdate`, `getRollingUpdateStatus`, and `cancelRollingUpdate`.

These routes are intended for platform operators, not normal application workloads. Keep them out of business-facing integrations unless you are explicitly building operational tooling.

### Template Facade

Preferred template path:

- `new Template()` for build DSL
- `client.buildTemplate(...)` and `client.buildTemplateInBackground(...)` for create + build + optional polling
- `client.listTemplates(...)`, `client.getTemplate(...)`, `client.deleteTemplate(...)`, `client.templateExists(...)`, `client.templateAliasExists(...)`, `client.getTemplateBuildStatus(...)` for bound lifecycle and status
- `Template.toJSON(...)`, `Template.toDockerfile(...)` for export helpers

Template builder conveniences include:

- base images and registries: `fromDockerfile`, `fromBaseImage`, `fromNodeImage`, `fromPythonImage`, `fromBunImage`, `fromUbuntuImage`, `fromDebianImage`, `fromAWSRegistry`, `fromGCPRegistry`
- file and command helpers: `copy`, `copyItems`, `skipCache`, `aptInstall`, `gitClone`, `makeDir`, `makeSymlink`, `npmInstall`, `pipInstall`, `bunInstall`, `remove`, `rename`, `runCmd`
- execution and config helpers: `setEnvs`, `setWorkdir`, `setUser`, `setStartCmd`, `setReadyCmd`, `filesHash`
- supported local copy options: `forceUpload`, `mode`, `resolveSymlinks`
- supported command and path options: `runCmd(..., { user })`, `gitClone(..., { user })`, `makeDir(..., { user })`, `makeSymlink(..., { user })`, `remove(..., { user })`, `rename(..., { user })`
- intentionally not exposed yet: `copy(..., { user })`, MCP server helpers, and devcontainer helpers

### Build Plane Namespace

Low-level `client.build` exposes:

- system: `metrics`
- direct build: `directBuild`
- templates: `createTemplate`, `listTemplates`, `getTemplateByAlias`, `resolveTemplateRef`, `getTemplate`, `updateTemplate`, `deleteTemplate`
- builds: `createBuild`, `getBuildFile`, `rollbackTemplate`, `listBuilds`, `getBuild`, `getBuildStatus`, `getBuildLogs`

The public template contract is split into three layers: top-level create fields (`name`, `tags`, `cpuCount`, `memoryMB`), SeaCloud template extensions under `extensions.seacloud` (`baseTemplateID`, `visibility`, `envs`, `storageType`, `storageSizeGB`), and build-only fields on `createBuild` (`fromImage`, `fromTemplate`, `steps`, `startCmd`, `readyCmd`, registry credentials, `filesHash`).
Public create/update calls reject legacy top-level write fields such as `alias`, `teamID`, and `public`.

For Node callers, the public write path and template read path now use different extension models on purpose:

- `createTemplate` / `updateTemplate` use `PublicTemplateExtensions`
- `ListedTemplate` / `TemplateResponse` keep the fuller `TemplateExtensions` shape returned by the service

This matches the current public builder API contract: request fields are intentionally narrower than response fields.

`createTemplate` and `updateTemplate` reject `visibility="official"` on public routes, including `extensions.seacloud.visibility === "official"`.

`createBuild` now follows the wire contract directly: callers pass top-level `filesHash` when needed, and the SDK returns the raw `202 {}` trigger response without adding helper fields.

`getTemplateByAlias` is a pure alias lookup endpoint. It should only be used with an actual published alias value.

`resolveTemplateRef` is the SeaCloud stable-ref lookup endpoint. It resolves a template by `templateID`, official template `type`, or visible alias.

## Resource Safety

- The quick starts are written for disposable resources and should be adapted before copy-pasting into production jobs.
- Prefer explicit cleanup with `await sandbox.delete()` and `await client.build.deleteTemplate(...)` when running probes, smoke tests, or CI.
- For long-lived workloads, move cleanup and timeout policy into your own lifecycle manager instead of relying on sample code defaults.

### Runtime Namespace

Low-level runtime objects returned by `client.runtimeFromSandbox(sandbox.raw)` or low-level sandbox instances expose:

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

- The gateway entrypoint always needs `baseUrl + apiKey`; project-scoped deployments can additionally set `projectId`.
- Runtime access should be derived from sandbox response objects with `client.runtimeFromSandbox(sandbox.raw)` or low-level sandbox instances.
- `createSandbox` and `getSandbox` return `envdUrl` and `envdAccessToken` when the sandbox exposes nano-executor APIs.
- Runtime file/process APIs require a template image that starts nano-executor and returns runtime access fields; if runtime APIs return `404`, verify the selected template supports CMD runtime routes.
- `timeoutMs` can be configured on `SandboxClient`; per-request runtime overrides are available in `CmdRequestOptions`.
- `waitReady: true` can take longer than the default timeout in production; pass `timeoutMs` to `new SandboxClient(...)` for long-wait workflows.
- HTTP errors are classified into typed errors such as `NotFoundError`, `RateLimitError`, and `ServerError`. Transport timeouts raise `RequestTimeoutError`.
- High-level `kill()` helpers send `SIGNAL_SIGKILL` and return `false` when the runtime reports a missing process through either `404` or `ESRCH`.
- PTY handles normalize reconnect output into `pty` even when the runtime emits the bytes through `stdout` / `stderr`.
- Sandbox timeout is validated to `0..86400`; refresh duration to `0..3600`.
- Build validation accepts E2B-style `COPY` / `ENV` / `RUN` / `WORKDIR` / `USER` steps, `force`, and structured `fromImageRegistry` credentials (`registry` / `aws` / `gcp`).
- Some gateways do not expose `/admin/*` or `/build`; the integration suite skips those cases on `404`.
- Some filesystem layouts reject watcher APIs entirely; the integration suite skips watcher coverage when the runtime reports that limitation.

## Security

- Do not commit `SEACLOUD_API_KEY`, `envdAccessToken`, or sandbox access tokens.
- Treat runtime tokens as sandbox-scoped secrets. Prefer `client.runtimeFromSandbox(sandbox.raw)` or low-level sandbox instances so response-scoped runtime access is not copied into configuration.
- Do not log raw API keys or runtime tokens. SDK errors may include response bodies, so avoid logging full error payloads in shared systems.
- Set `projectId` in `SandboxClient` when your gateway requires explicit project routing. The SDK sends it as `X-Project-ID`.

## Production Smoke

Use production smoke tests only with explicitly provided credentials and disposable sandboxes:

```bash
SANDBOX_RUN_INTEGRATION=1 \
SANDBOX_TEST_BASE_URL="${SEACLOUD_BASE_URL}" \
SANDBOX_TEST_API_KEY="${SEACLOUD_API_KEY}" \
SANDBOX_TEST_TEMPLATE_ID=tpl-base-dc11799b9f9f4f9e \
npm run test:integration
```

`tpl-base-dc11799b9f9f4f9e` is a known-good SeaCloudAI runtime template for validating CMD routes such as `listDir`, `readFile`, `writeFile`, and `run`.
You can also run the same disposable smoke flow from GitHub Actions with `.github/workflows/integration-smoke.yml` after setting the `SANDBOX_TEST_API_KEY` repository secret.

## Scripts

```bash
npm run build
npm run check
npm test
```

## Integration Tests

```bash
SANDBOX_RUN_INTEGRATION=1 \
SANDBOX_TEST_BASE_URL="${SEACLOUD_BASE_URL}" \
SANDBOX_TEST_API_KEY="${SEACLOUD_API_KEY}" \
SANDBOX_TEST_TEMPLATE_ID=... \
npm run test:integration
```

Use a runtime-enabled template for CMD integration coverage. For SeaCloudAI production smoke tests, `tpl-base-dc11799b9f9f4f9e` is a known-good runtime template.
The same smoke suite is available as a manual GitHub Actions dispatch in `.github/workflows/integration-smoke.yml`.

## Release

- See `CHANGELOG.md` for release notes.
- GitHub Actions can publish to npm through `.github/workflows/publish.yml`.
- See `RELEASE_CHECKLIST.md` before tagging or publishing a new version.

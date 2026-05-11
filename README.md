# Sandbox Node SDK

TypeScript SDK for Sandbox control-plane, build-plane, and nano-executor CMD APIs.

## Install

```bash
npm install @seacloudai/sandbox
```

## Entrypoints

Preferred public API:

- preferred sandbox entrypoint: `Sandbox.create(...)`
- additional sandbox lifecycle helpers: `Sandbox.connect(...)`, `Sandbox.list(...)`, `Sandbox.getInfo(...)`, `Sandbox.kill(...)`, `Sandbox.setTimeout(...)`
- sandbox runtime modules from the returned object: `sandbox.commands`, `sandbox.files`, `sandbox.git`, `sandbox.pty`
- preferred template entrypoint: `Template.build()`, `Template.buildInBackground()`, `Template.list()`, `Template.get()`, `Template.delete()`
- low-level transport modules: `@seacloudai/sandbox/control`, `@seacloudai/sandbox/build`, `@seacloudai/sandbox/cmd`

`control` and `build` use the gateway domain/base URL from env or explicit options. Runtime access is derived from sandbox create/detail/connect responses; callers should not hardcode runtime endpoints or tokens. `projectId` is an optional gateway routing header for project-scoped deployments.

## E2B Alignment

- Supported alignment target: sandbox lifecycle, files, commands, git, PTY, and the high-level template DSL are designed to follow the same public workflow as `e2b-docs/sdk`.
- Code interpreter alignment: `sandbox.runCode(...)` is available for `python`, `javascript`, `typescript`, `bash`, `r`, and `java`. Python results support `display(...)`, last-expression capture, tables, Matplotlib PNG/chart payloads, a persistent default execution context, and stateful `createCodeContext/listCodeContexts/restartCodeContext/removeCodeContext` helpers. Non-Python contexts use the same API surface but currently behave as stateless execution profiles.
- Known unsupported area: snapshot APIs are not exposed because the underlying platform does not support them yet.
- Known partial area: only Python contexts are stateful. Non-Python contexts still execute in isolated one-shot processes.
- Runtime compatibility note: the SDK normalizes a few runtime-specific quirks so the high-level behavior stays E2B-like, such as missing-process `kill()` results and PTY reconnect output framing.

## Environment

Use environment variables for gateway configuration in all examples and quick starts:

- `E2B_DOMAIN`: preferred gateway entrypoint
- `E2B_API_KEY`: preferred API key
- `SEACLOUD_PROJECT_ID`: optional project routing key for project-scoped gateways

Set them once in your shell:

```bash
export E2B_DOMAIN="https://sandbox-gateway.cloud.seaart.ai"
export E2B_API_KEY="..."
export SEACLOUD_PROJECT_ID="project-..."
```

Default production gateway:

```text
https://sandbox-gateway.cloud.seaart.ai
```

High-level `Sandbox.create(...)` defaults to the official `base` template when you do not pass a template explicitly. For production integrations, prefer passing a concrete template ID such as `tpl-...` or a stable official template type such as `base`, `code-interpreter`, `claude`, or `codex` when your environment publishes those official templates.

## Production Readiness

- Initialize environment variables once per process and reuse bound sandbox/template objects.
- Treat every quick start as creating billable or quota-bound resources unless it explicitly cleans them up.
- Prefer explicit template references from configuration over hardcoded example values.
- In SeaCloudAI environments, prefer official template types such as `base`, `code-interpreter`, `claude`, or `codex` when you want a stable platform-managed entrypoint.
- Template semantics matter: `base` is the minimal runtime template for lifecycle, files, commands, git, and PTY. It does not imply a multi-language execution environment. Use `code-interpreter` for `sandbox.runCode(...)`, and use agent-specific templates such as `claude` or `codex` when you need those CLIs preinstalled.
- Use longer SDK HTTP timeouts for `waitReady` flows and image builds.
- Derive runtime access from sandbox responses instead of storing runtime endpoints or tokens in config.

## Compatibility

- Node.js: requires `>=18` as declared in `package.json`.
- API model: this SDK targets the unified SeaCloudAI sandbox gateway and keeps public template APIs limited to user-facing fields.
- Stability: operator/admin routes may exist on the gateway, but they are not part of the public SDK workflow described in this README.
- Retry model: treat create/delete/build operations as remote control-plane actions; add idempotency and retry policy in your application layer according to your workload.
- Timeout semantics: public sandbox, command, PTY, git, and code-execution `timeout` values are in seconds. `requestTimeoutMs` is only the SDK HTTP request timeout in milliseconds.

## Quick Start

### Control Plane

```ts
import { Sandbox } from "@seacloudai/sandbox";

const sandbox = await Sandbox.create({
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
import { Sandbox } from "@seacloudai/sandbox";

const listed = await Sandbox.list();

for (const sandbox of listed) {
  console.log(sandbox.sandboxID, sandbox.state ?? sandbox.status);
}
```

### Template Build

```ts
import { Template, waitForFile } from "@seacloudai/sandbox";

const built = await Template.build(
  new Template()
    .fromImage("docker.io/library/alpine:3.20")
    .runCmd("echo hello-from-node >/tmp/hello.txt")
    .setReadyCmd(waitForFile("/tmp/hello.txt")),
  "demo:v1",
);

console.log(built.templateId, built.buildId);
```

High-level template helpers currently include:

- lifecycle and status: `Template.build`, `Template.buildInBackground`, `Template.exists`, `Template.getBuildStatus`, `Template.list`, `Template.get`, `Template.delete`
- serialization: `Template.toJSON`, `Template.toDockerfile`
- base images and registries: `fromDockerfile`, `fromBaseImage`, `fromNodeImage`, `fromPythonImage`, `fromBunImage`, `fromUbuntuImage`, `fromDebianImage`, `fromAWSRegistry`, `fromGCPRegistry`
- build-step helpers: `copy`, `copyItems`, `skipCache`, `aptInstall`, `gitClone`, `makeDir`, `makeSymlink`, `npmInstall`, `pipInstall`, `bunInstall`, `remove`, `rename`
- execution and config helpers: `runCmd`, `setEnvs`, `setWorkdir`, `setUser`, `setStartCmd`, `setReadyCmd`, `filesHash`
- supported local copy options: `forceUpload`, `mode`, `resolveSymlinks`, `user`
- supported command and path options: `runCmd(..., { user })`, `gitClone(..., { user })`, `makeDir(..., { user })`, `makeSymlink(..., { user })`, `remove(..., { user })`, `rename(..., { user })`
- intentionally not exposed yet: MCP server helpers and devcontainer helpers

### Runtime Modules

```ts
import { Sandbox } from "@seacloudai/sandbox";

const sandbox = await Sandbox.create("base", {
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

### Code Interpreter

Use a template that actually includes the code-interpreter environment here. In SeaCloudAI environments, prefer an official `code-interpreter` template or a concrete `tpl-code-interpreter-...` template ID. Do not use `base` for this example.

```ts
import { Sandbox } from "@seacloudai/sandbox";

const sandbox = await Sandbox.create("code-interpreter", {
  waitReady: true,
});

try {
  const execution = await sandbox.runCode(
    `
import pandas as pd

df = pd.DataFrame([{"name": "Ada", "score": 99}])
display(df)
99
    `,
    {
      onStdout: (chunk) => console.log("stdout:", chunk.line),
      onStderr: (chunk) => console.error("stderr:", chunk.line),
      onResult: (result) => console.log("result:", result),
    },
  );

  console.log(execution.text);
} finally {
  await sandbox.delete();
}
```

For Python, repeated `sandbox.runCode(...)` calls reuse the sandbox's default code context. You can create additional Python contexts with `createCodeContext(...)` when you need isolated state. For other languages, `createCodeContext(...)` returns a reusable execution profile that supplies default `language`, `cwd`, and `timeout` values, but each run still executes in a fresh one-shot process.

Bound sandbox helpers currently include:

- lifecycle: `reload`, `connect`, `resume`, `getInfo`, `logs`, `pause`, `kill`, `delete`, `refresh`, `setTimeout`, `isRunning`
  Static helpers: `Sandbox.getInfo`, `Sandbox.kill`, `Sandbox.setTimeout`
- runtime conveniences: `getMetrics`, `getHost`, `proxy`
- code interpreter: `runCode`, `createCodeContext`, `listCodeContexts`, `restartCodeContext`, `removeCodeContext`
- commands module: `run`, `exec`, `list`, `connect`, `kill`, `sendStdin`
- filesystem module: `exists`, `getInfo`, `list`, `makeDir`, `read`, `write`, `writeFiles`, `remove`, `rename`, `watchDir`
- git module: `clone`, `pull`, `checkout`, `status`
- pty module: `create`, `connect`, `kill`, `sendStdin`, `resize`

## Recommended Usage

For most integrations, prefer the env-first high-level flow:

- set `E2B_DOMAIN`, `E2B_API_KEY`, and optionally `SEACLOUD_PROJECT_ID`
- create sandboxes with `Sandbox.create(...)`
- continue through `sandbox.commands`, `sandbox.files`, `sandbox.git`, and `sandbox.pty`
- build templates with `Template.build(...)` and `Template.buildInBackground(...)`
- only drop to `@seacloudai/sandbox/control`, `@seacloudai/sandbox/build`, or `@seacloudai/sandbox/cmd` when you need transport-level request control

Low-level methods remain available when you need tighter request control:

- continue from the returned sandbox object with `reload()`, `connect()`, `resume()`, `getInfo()`, `getMetrics()`, `getHost()`, `logs()`, `pause()`, `refresh()`, `setTimeout()`, `kill()`, `delete()`, and `isRunning()`
- use `Template.build(...)`, `Template.buildInBackground(...)`, `Template.exists(...)`, `Template.getBuildStatus(...)`, `Template.list(...)`, `Template.get(...)`, and `Template.delete(...)` for the preferred template workflow
- use `SandboxControlService`, `SandboxBuildService`, and runtime service helpers from the subpath modules only for raw control/build/cmd workflows
- use `templateBuild()` when you want a small E2B-style helper that compiles into `BuildRequest`

Low-level subpath modules remain available when you need direct request/response types or tighter transport control.

## API Surface

### Control Plane APIs

- high-level lifecycle: `create`, `connect`, `list`
- follow-up control actions from the returned object: `reload()`, `connect()`, `resume()`, `getInfo()`, `getMetrics()`, `getHost()`, `logs()`, `pause()`, `refresh()`, `setTimeout()`, `kill()`, `delete()`, `isRunning()`
- low-level control module: `SandboxControlService` from `@seacloudai/sandbox/control`
- low-level service methods: `metrics`, `shutdown`, `createSandbox`, `listSandboxes`, `getSandbox`, `deleteSandbox`, `getSandboxLogs`, `pauseSandbox`, `connectSandbox`, `setSandboxTimeout`, `refreshSandbox`, `sendHeartbeat`

### Operator APIs

The low-level control service also includes operator-oriented methods such as `getPoolStatus`, `startRollingUpdate`, `getRollingUpdateStatus`, and `cancelRollingUpdate`.

These routes are intended for platform operators, not normal application workloads. Keep them out of business-facing integrations unless you are explicitly building operational tooling.

### Template Facade

Preferred template path:

- `new Template()` for build DSL
- `Template.build(...)` and `Template.buildInBackground(...)` for create + build + optional polling
- `Template.list(...)`, `Template.get(...)`, `Template.delete(...)`, `Template.exists(...)`, `Template.getBuildStatus(...)` for lifecycle and status
- `Template.toJSON(...)`, `Template.toDockerfile(...)` for export helpers

Template builder conveniences include:

- base images and registries: `fromDockerfile`, `fromBaseImage`, `fromNodeImage`, `fromPythonImage`, `fromBunImage`, `fromUbuntuImage`, `fromDebianImage`, `fromAWSRegistry`, `fromGCPRegistry`
- file and command helpers: `copy`, `copyItems`, `skipCache`, `aptInstall`, `gitClone`, `makeDir`, `makeSymlink`, `npmInstall`, `pipInstall`, `bunInstall`, `remove`, `rename`, `runCmd`
- execution and config helpers: `setEnvs`, `setWorkdir`, `setUser`, `setStartCmd`, `setReadyCmd`, `filesHash`
- supported local copy options: `forceUpload`, `mode`, `resolveSymlinks`, `user`
- supported command and path options: `runCmd(..., { user })`, `gitClone(..., { user })`, `makeDir(..., { user })`, `makeSymlink(..., { user })`, `remove(..., { user })`, `rename(..., { user })`
- intentionally not exposed yet: MCP server helpers and devcontainer helpers

### Build Plane Namespace

Low-level `SandboxBuildService` from `@seacloudai/sandbox/build` exposes:

- system: `metrics`
- direct build: `directBuild`
- templates: `createTemplate`, `listTemplates`, `getTemplateByAlias`, `resolveTemplateRef`, `getTemplate`, `updateTemplate`, `deleteTemplate`
- builds: `createBuild`, `getBuildFile`, `rollbackTemplate`, `listBuilds`, `getBuild`, `getBuildStatus`, `getBuildLogs`

The public template contract is split into three layers: top-level create fields (`name`, `tags`, `cpuCount`, `memoryMB`), template extensions under `extensions` (`baseTemplateID`, `visibility`, `envs`, `storageType`, `storageSizeGB`, `volumeMounts`), and build-only fields on `createBuild` (`fromImage`, `fromTemplate`, `steps`, `startCmd`, `readyCmd`, registry credentials, `filesHash`).
Runtime behavior defaults from the image source: templates inheriting SeaCloud base/runtime templates keep the managed runtime, while direct external images run as plain business containers. `startCmd` and `readyCmd` only provide startup and readiness commands on top of that default.
Public create/update calls reject legacy top-level write fields such as `alias`, `teamID`, and `public`.

For Node callers, the public write path and template read path now use different extension models on purpose:

- `createTemplate` / `updateTemplate` use `PublicTemplateExtensions`
- `ListedTemplate` / `TemplateResponse` keep the fuller `TemplateExtensions` shape returned by the service

This matches the current public builder API contract: request fields are intentionally narrower than response fields.

`createTemplate` and `updateTemplate` reject `visibility="official"` on public routes, including `extensions.visibility === "official"`.

`createBuild` now follows the wire contract directly: callers pass top-level `filesHash` when needed, and the SDK returns the raw `202 {}` trigger response without adding helper fields.

`getTemplateByAlias` is a pure alias lookup endpoint. It should only be used with an actual published alias value.

`resolveTemplateRef` is the SeaCloud stable-ref lookup endpoint. It resolves a template by `templateID`, official template `type`, or visible alias.

## Resource Safety

- The quick starts are written for disposable resources and should be adapted before copy-pasting into production jobs.
- Prefer explicit cleanup with `await sandbox.delete()` and `await Template.delete(...)` when running probes, smoke tests, or CI.
- For long-lived workloads, move cleanup and timeout policy into your own lifecycle manager instead of relying on sample code defaults.

### Runtime Namespace

Bound sandbox runtime modules and low-level CMD services expose:

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

- `@seacloudai/sandbox`: root high-level `Sandbox` / `Template` facade
- `@seacloudai/sandbox/control`: control-plane types and low-level service
- `@seacloudai/sandbox/build`: build-plane types and low-level service
- `@seacloudai/sandbox/cmd`: runtime types, streams, and low-level service
- `@seacloudai/sandbox/core`: shared errors and common response types

## Notes

- The gateway entrypoint always needs an API key. `baseUrl` can come from `E2B_DOMAIN`, and project-scoped deployments can additionally set `projectId`.
- Runtime access should be derived from bound sandbox objects or low-level sandbox instances.
- Low-level create/detail responses include `envdUrl` and `envdAccessToken` when the sandbox exposes nano-executor APIs.
- Runtime file/process APIs require a template image that starts nano-executor and returns runtime access fields; if runtime APIs return `404`, verify the selected template supports CMD runtime routes.
- High-level calls accept per-operation timeout settings; per-request runtime overrides are available in `CmdRequestOptions`.
- `waitReady: true` can take longer than the default timeout in production; pass a larger timeout on the high-level create/build call for long-wait workflows.
- HTTP errors are classified into typed errors such as `NotFoundError`, `RateLimitError`, and `ServerError`. Transport timeouts raise `RequestTimeoutError`.
- High-level `kill()` helpers send `SIGNAL_SIGKILL` and return `false` when the runtime reports a missing process through either `404` or `ESRCH`.
- PTY handles normalize reconnect output into `pty` even when the runtime emits the bytes through `stdout` / `stderr`.
- Sandbox timeout is validated to `0..86400`; refresh duration to `0..3600`.
- Build validation accepts E2B-style `COPY` / `ENV` / `RUN` / `WORKDIR` / `USER` steps, `force`, and structured `fromImageRegistry` credentials (`registry` / `aws` / `gcp`).
- Some gateways do not expose `/admin/*` or `/build`; the integration suite skips those cases on `404`.
- Some filesystem layouts reject watcher APIs entirely; the integration suite skips watcher coverage when the runtime reports that limitation.

## Security

- Do not commit `E2B_API_KEY`, `envdAccessToken`, or sandbox access tokens.
- Treat runtime tokens as sandbox-scoped secrets. Prefer bound sandbox objects or low-level sandbox instances so response-scoped runtime access is not copied into configuration.
- Do not log raw API keys or runtime tokens. SDK errors may include response bodies, so avoid logging full error payloads in shared systems.
- Set `SEACLOUD_PROJECT_ID` when your gateway requires explicit project routing. The SDK sends it as `X-Project-ID`.

## Production Smoke

Use production smoke tests only with explicitly provided credentials and disposable sandboxes:

```bash
SANDBOX_RUN_INTEGRATION=1 \
SANDBOX_TEST_BASE_URL="${E2B_DOMAIN}" \
SANDBOX_TEST_API_KEY="${E2B_API_KEY}" \
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
SANDBOX_TEST_BASE_URL="${E2B_DOMAIN}" \
SANDBOX_TEST_API_KEY="${E2B_API_KEY}" \
SANDBOX_TEST_TEMPLATE_ID=... \
npm run test:integration
```

Use a runtime-enabled template for CMD integration coverage. For SeaCloudAI production smoke tests, `tpl-base-dc11799b9f9f4f9e` is a known-good runtime template.
The same smoke suite is available as a manual GitHub Actions dispatch in `.github/workflows/integration-smoke.yml`.

## Release

- See `CHANGELOG.md` for release notes.
- GitHub Actions can publish to npm through `.github/workflows/publish.yml`.
- See `RELEASE_CHECKLIST.md` before tagging or publishing a new version.

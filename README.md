# Sandbox Node SDK

TypeScript SDK for Sandbox control-plane, build-plane, and nano-executor CMD APIs.

## Product Highlights

SeaCloudAI Sandbox gives you a cloud runtime for code execution, agent workflows, lightweight services, and custom template builds.

- **Start fast with official templates**: use `base` for files, commands, git, and PTY; use `code-interpreter` for multi-language code execution; use agent templates such as `claude` or `codex` when those environments are published.
- **Manage the full sandbox lifecycle**: create, connect, pause, resume, refresh timeout, inspect logs, and delete sandboxes through one SDK.
- **Run real workloads inside the sandbox**: write files, execute commands, start background services, open PTY sessions, and expose HTTP services with `sandbox.getHost(port)`.
- **Move from local code to reusable templates**: upload files to a running sandbox for quick iteration, then bake local code into a custom template with `Template.copy(...)`.
- **Use one workflow across languages**: Node, Python, and Go SDKs expose the same core sandbox, runtime, and template-building concepts.
- **Keep an E2B-style public workflow**: lifecycle, files, commands, PTY, code interpreter, and template helpers follow familiar E2B-style patterns while using SeaCloudAI gateway and runtime configuration.

## Install

```bash
npm install @seacloudai/sandbox
```

## Entrypoints

Preferred public API:

- preferred sandbox entrypoint: `Sandbox.create(...)`
- additional sandbox lifecycle helpers: `Sandbox.connect(...)`, `Sandbox.list(...)`, `Sandbox.getInfo(...)`, `Sandbox.getFullInfo(...)`, `Sandbox.pause(...)`, `Sandbox.kill(...)`, `Sandbox.setTimeout(...)`
- sandbox runtime modules from the returned object: `sandbox.commands`, `sandbox.files`, `sandbox.git`, `sandbox.pty`
- preferred template entrypoint: `Template()` / `new Template()` for the DSL, plus `Template.build()`, `Template.buildInBackground()`, `Template.list()`, `Template.get()`, `Template.delete()`
- low-level transport modules: `@seacloudai/sandbox/control`, `@seacloudai/sandbox/build`, `@seacloudai/sandbox/cmd`

High-level `Sandbox` / `Template` helpers read gateway config from `SEACLOUD_BASE_URL` / `SEACLOUD_API_KEY`. Low-level `control`, `build`, and `cmd` clients can still be initialized with explicit transport options when needed. Runtime access is derived from sandbox create/detail/connect responses; callers should not hardcode runtime endpoints or tokens.

## E2B Alignment

- Supported alignment target: sandbox lifecycle, files, commands, git, PTY, and the high-level template DSL are designed to follow the same public workflow as `e2b-docs/sdk`.
- Code interpreter alignment: `sandbox.runCode(...)` is available for `python`, `javascript`, `typescript`, `bash`, `r`, and `java`. Python results support `display(...)`, last-expression capture, tables, Matplotlib PNG/chart payloads, a persistent default execution context, and stateful `createCodeContext/listCodeContexts/restartCodeContext/removeCodeContext` helpers. Non-Python contexts use the same API surface but currently behave as stateless execution profiles.
- Known unsupported area: snapshot APIs are not exposed because the underlying platform does not support them yet.
- Known partial area: only Python contexts are stateful. Non-Python contexts still execute in isolated one-shot processes.
- Runtime normalization note: the SDK smooths a few runtime-specific quirks so the high-level behavior stays E2B-like, such as missing-process `kill()` results and PTY reconnect output framing.

## Environment

Use environment variables for gateway configuration in all examples and quick starts:

- `SEACLOUD_BASE_URL`: preferred gateway entrypoint
- `SEACLOUD_API_KEY`: preferred API key

Set them once in your shell:

```bash
export SEACLOUD_BASE_URL="https://sandbox-gateway.cloud.seaart.ai"
export SEACLOUD_API_KEY="..."
```

Default production gateway:

```text
https://sandbox-gateway.cloud.seaart.ai
```

High-level `Sandbox.create(...)` requires an explicit template reference. Pass a concrete template ID such as `tpl-...` or a stable official template type such as `base`, `code-interpreter`, `claude`, or `codex` when your environment publishes those official templates.

## From Zero To One

This section is the recommended path for first-time users. It starts from environment setup, then creates sandboxes from official templates, runs commands, exposes a frontend through `envdUrl`, and finally builds a reusable custom template from local code.

### 1. Configure Environment

```bash
export SEACLOUD_BASE_URL="https://sandbox-gateway.cloud.seaart.ai"
export SEACLOUD_API_KEY="..."
```

Run the examples from `packages/node`:

```bash
npm install
npm run build
node examples/zero-to-one.mjs
```

### 2. Create A Base Sandbox

Use `base` for normal sandbox lifecycle, files, commands, git, and PTY. It is the right starting point for command execution and filesystem work.

```ts
import { Sandbox } from "@seacloudai/sandbox";

const sandbox = await Sandbox.create("base", {
  timeout: 1800,
  waitReady: true,
});

try {
  console.log("sandbox", sandbox.sandboxId, sandbox.sandboxDomain);

  await sandbox.files.write("/root/workspace/hello.txt", "hello\n");
  console.log(await sandbox.files.read("/root/workspace/hello.txt"));

  const result = await sandbox.commands.run("sh", {
    args: ["-lc", "pwd && uname -a && ls -la /root/workspace"],
  });
  console.log(result.exitCode, result.stdout);
} finally {
  await sandbox.delete();
}
```

### 3. Pick Official Templates By Workload

| Workload | Template | Use it for |
| --- | --- | --- |
| Basic shell, files, git, PTY, and lightweight services | `base` | General sandbox lifecycle and filesystem/command workflows. |
| Multi-language code execution | `code-interpreter` | `sandbox.runCode(...)` for Python, JavaScript, TypeScript, Bash, R, and Java. Python contexts are stateful. |
| Agent CLI workflows | `claude` / `codex` | Environments where those official agent templates are published with the CLIs preinstalled. |
| Reproducible production workloads | `tpl-...` | A concrete custom or official template ID pinned from config. |

```ts
const codeSandbox = await Sandbox.create("code-interpreter", {
  waitReady: true,
});

try {
  const execution = await codeSandbox.runCode("x = 41\nx + 1");
  console.log(execution.text);
} finally {
  await codeSandbox.delete();
}
```

### 4. Manage Lifecycle

Lifecycle `timeout` values are seconds. Runtime command `timeoutMs` values are milliseconds.

```ts
const sandbox = await Sandbox.create("base", { timeout: 1800, waitReady: true });

const info = await sandbox.getInfo();
console.log(info.sandboxId, info.state);

await sandbox.setTimeout(3600);

const paused = await sandbox.pause();
console.log("paused", paused);

await sandbox.connect({ timeout: 1800 });
console.log("running", sandbox.isRunning());

await sandbox.delete();
```

### 5. Deploy A Frontend And Open It Through `envdUrl`

Use a template that has Python or Node available. `code-interpreter` is a convenient default for this static frontend example because it can run `python3 -m http.server`.

```ts
const app = await Sandbox.create("code-interpreter", {
  timeout: 1800,
  waitReady: true,
});

try {
  await app.files.makeDir("/root/workspace/frontend");
  await app.files.write(
    "/root/workspace/frontend/index.html",
    "<h1>Hello from sandbox</h1>",
  );

  await app.commands.run("python3", {
    args: ["-m", "http.server", "3000", "--bind", "0.0.0.0"],
    cwd: "/root/workspace/frontend",
    background: true,
  });

  console.log("open", app.getHost(3000));
} finally {
  await app.delete();
}
```

`getHost(3000)` derives a public proxy URL from the sandbox `envdUrl`. Keep `envdAccessToken` / `trafficAccessToken` private; they are sandbox-scoped secrets.

Service access notes:

- Bind HTTP services to `0.0.0.0`, not `127.0.0.1`, so the runtime proxy can reach them.
- Use `sandbox.getHost(port)` instead of constructing proxy URLs manually.
- If the URL does not open, check that the process is still running, the port matches, and the selected template exposes runtime access fields.

### 6. Upload Local Code Files

There are two common upload paths:

- Runtime upload to an existing sandbox: use `sandbox.files.write(...)` / `writeFiles(...)` when you want to place generated files into a running sandbox.
- Template build upload: use `Template.copy(...)` when you want local files or directories baked into a reusable template image.

Upload a local file into a running sandbox:

```ts
import { readFile } from "node:fs/promises";

const data = await readFile("./my-frontend/index.html");
await sandbox.files.write("/root/workspace/frontend/index.html", data);
```

Upload one local file into a template build:

```ts
new Template()
  .fromTemplate("base")
  .copy("./package.json", "/workspace/app/package.json", { forceUpload: true });
```

Upload a local directory recursively:

```ts
new Template()
  .fromTemplate("base")
  .copy("./my-frontend", "/workspace/frontend", {
    forceUpload: true,
    mode: 0o755,
    resolveSymlinks: true,
  });
```

The first argument is a local path on your machine. The second argument is the destination path inside the template filesystem. `forceUpload: true` is useful during development when the local files change frequently and you want the SDK to re-upload them instead of reusing a cached content hash.

### 7. Build Your Own Template From Local Code

This uploads a local directory into the build context with `copy(...)`, builds a new template, and sets a startup command for future sandboxes created from that template.

```ts
import { Template, waitForPort } from "@seacloudai/sandbox";

const built = await Template.build(
  new Template()
    .fromTemplate("base")
    .copy("./my-frontend", "/workspace/frontend", { forceUpload: true })
    .setStartCmd(
      "cd /workspace/frontend && python3 -m http.server 3000 --bind 0.0.0.0",
      waitForPort(3000),
    ),
  "my-frontend:v1",
  {
    wait: true,
    pollIntervalMs: 2_000,
    requestTimeoutMs: 180_000,
  },
);

console.log(built.templateId, built.buildId);
```

Create a sandbox from the new template:

```ts
const sandbox = await Sandbox.create(built.templateId, { waitReady: true });
console.log(sandbox.getHost(3000));
```

### 8. Recommended Production Flow

1. Prototype with an official template such as `base` or `code-interpreter`.
2. Upload local files to a running sandbox for fast iteration.
3. Move stable setup into `Template.copy(...)`, `runCmd(...)`, `setStartCmd(...)`, and `setReadyCmd(...)`.
4. Build and pin the resulting `tpl-...` value in application config.
5. Keep sandbox cleanup in `finally` blocks or a lifecycle manager, and set explicit lifecycle `timeout` values for each workload.

## Troubleshooting

- `401` / `403`: verify `SEACLOUD_API_KEY` and that the process sees the environment variable.
- Requests go to the wrong gateway: check `SEACLOUD_BASE_URL`; include the `https://` scheme.
- Runtime APIs return `404`: use a template that starts nano-executor and returns `envdUrl` / `envdAccessToken`.
- `waitReady` or builds time out: increase lifecycle `timeout` and SDK HTTP `requestTimeoutMs` for long starts or image builds.
- Frontend URL is unreachable: bind to `0.0.0.0`, confirm the port passed to `getHost(...)`, and inspect whether the background process exited.
- Build with local files fails: make sure `Template.copy(...)` points to an existing local path and use `forceUpload: true` while iterating.

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
- Timeout semantics: sandbox lifecycle uses E2B-style `timeout` seconds. Commands, PTY, git, and code execution helpers use `timeoutMs` milliseconds. `requestTimeoutMs` is only the SDK HTTP request timeout in milliseconds.

## Quick Start

### Control Plane

```ts
import { Sandbox } from "@seacloudai/sandbox";

const sandbox = await Sandbox.create({
  template: "base",
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
- execution and config helpers: `runCmd`, `setEnvs`, `setWorkdir`, `setUser`, `setStartCmd`, `setReadyCmd`
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

For Python, repeated `sandbox.runCode(...)` calls reuse the sandbox's default code context. You can create additional Python contexts with `createCodeContext(...)` when you need isolated state. For other languages, `createCodeContext(...)` returns a reusable execution profile that supplies default `language`, `cwd`, and `timeoutMs` values, but each run still executes in a fresh one-shot process.

Bound sandbox helpers currently include:

- lifecycle: `reload`, `connect`, `resume`, `getInfo`, `getFullInfo`, `logs`, `pause`, `kill`, `delete`, `refresh`, `setTimeout`, `isRunning`
  `pause()` returns `true` when a running sandbox is newly paused and `false` when it was already paused.
  `getInfo()` / `getFullInfo()` return normalized E2B-style sandbox info with `sandboxId`, `templateId`, `sandboxDomain`, `trafficAccessToken`, `startedAt`, `endAt`, and `state`.
  Lifecycle helpers accept `requestTimeoutMs` for SDK HTTP request timeout overrides.
  Static helpers: `Sandbox.getInfo`, `Sandbox.getFullInfo`, `Sandbox.pause`, `Sandbox.kill`, `Sandbox.setTimeout`
- runtime conveniences: `getMetrics`, `getHost`, `downloadUrl`, `uploadUrl`, `proxy`
- code interpreter: `runCode`, `createCodeContext`, `listCodeContexts`, `restartCodeContext`, `removeCodeContext`
- commands module: `run`, `exec`, `list`, `connect`, `kill`, `sendStdin`
  `run()` / `exec()` accept `timeoutMs`, `stdin`, `onStdout`, `onStderr`, and `user`; callbacks and open-stdin mode use the runtime streaming protocol.
  `connect(pid, { onStdout, onStderr })` attaches output callbacks to an existing process stream. `CommandHandle` exposes both `sendStdin(...)` and the E2B-style `sendInput(...)` alias.
- filesystem module: `exists`, `getInfo`, `list`, `makeDir`, `read`, `write`, `writeFiles`, `remove`, `rename`, `watchDir`
  `getInfo()` / `list()` / `rename()` return normalized entries with `type: "file" | "dir" | "symlink"` and `modifiedTime?: Date`.
  `write()` / `writeFiles()` return E2B-style `WriteInfo` objects with `name`, `path`, and `type`.
  File methods accept `user`; `makeDir()` returns `false` when the path already exists.
  `watchDir(path, onEvent, opts)` follows the E2B callback + handle flow and returns a `WatchHandle` with `stop()`. It also supports `user`, `timeoutMs`, and `onExit`.
- git module: `clone`, `pull`, `checkout`, `status`
- pty module: `create`, `connect`, `kill`, `sendStdin`, `sendInput`, `resize`
  `pty.connect(pid, { onStdout, onStderr })` attaches output callbacks when reconnecting to a PTY.

## Recommended Usage

For most integrations, prefer the env-first high-level flow:

- set `SEACLOUD_BASE_URL` and `SEACLOUD_API_KEY`
- create sandboxes with `Sandbox.create(...)`
- continue through `sandbox.commands`, `sandbox.files`, `sandbox.git`, and `sandbox.pty`
- build templates with `Template.build(...)` and `Template.buildInBackground(...)`
- only drop to `@seacloudai/sandbox/control`, `@seacloudai/sandbox/build`, or `@seacloudai/sandbox/cmd` when you need transport-level request control

Low-level methods remain available when you need tighter request control:

- continue from the returned sandbox object with `reload()`, `connect()`, `resume()`, `getInfo()`, `getFullInfo()`, `getMetrics()`, `getHost()`, `logs()`, `pause()`, `refresh()`, `setTimeout()`, `kill()`, `delete()`, and `isRunning()`
- use `Template.build(...)`, `Template.buildInBackground(...)`, `Template.exists(...)`, `Template.getBuildStatus(...)`, `Template.list(...)`, `Template.get(...)`, and `Template.delete(...)` for the preferred template workflow
- use `SandboxControlService`, `SandboxBuildService`, and runtime service helpers from the subpath modules only for raw control/build/cmd workflows
- use `templateBuild()` when you want a small E2B-style helper that compiles into `BuildRequest`

Low-level subpath modules remain available when you need direct request/response types or tighter transport control.

## API Surface

### Control Plane APIs

- high-level lifecycle: `create`, `connect`, `list`
- follow-up control actions from the returned object: `reload()`, `connect()`, `resume()`, `getInfo()`, `getFullInfo()`, `getMetrics()`, `getHost()`, `logs()`, `pause()`, `refresh()`, `setTimeout()`, `kill()`, `delete()`, `isRunning()`
- low-level control module: `SandboxControlService` from `@seacloudai/sandbox/control`
- low-level service methods: `metrics`, `shutdown`, `createSandbox`, `listSandboxes`, `getSandbox`, `deleteSandbox`, `getSandboxLogs`, `pauseSandbox`, `connectSandbox`, `setSandboxTimeout`, `refreshSandbox`, `sendHeartbeat`

### Operator APIs

The low-level control service also includes operator-oriented methods such as `getPoolStatus`, `startRollingUpdate`, `getRollingUpdateStatus`, and `cancelRollingUpdate`.

These routes are intended for platform operators, not normal application workloads. Keep them out of business-facing integrations unless you are explicitly building operational tooling.

### Template Facade

Preferred template path:

- `Template()` or `new Template()` for build DSL
- `Template.build(...)` and `Template.buildInBackground(...)` for create + build + optional polling
- `Template.list(...)`, `Template.get(...)`, `Template.delete(...)`, `Template.exists(...)`, `Template.getBuildStatus(...)` for lifecycle and status
- `Template.toJSON(...)`, `Template.toDockerfile(...)` for export helpers

Template builder conveniences include:

- base images and registries: `fromDockerfile`, `fromBaseImage`, `fromNodeImage`, `fromPythonImage`, `fromBunImage`, `fromUbuntuImage`, `fromDebianImage`, `fromAWSRegistry`, `fromGCPRegistry`
- file and command helpers: `copy`, `copyItems`, `skipCache`, `aptInstall`, `gitClone`, `makeDir`, `makeSymlink`, `npmInstall`, `pipInstall`, `bunInstall`, `remove`, `rename`, `runCmd`
- execution and config helpers: `setEnvs`, `setWorkdir`, `setUser`, `setStartCmd`, `setReadyCmd`
- supported local copy options: `forceUpload`, `mode`, `resolveSymlinks`, `user`
- supported command and path options: `runCmd(..., { user })`, `gitClone(..., { user })`, `makeDir(..., { user })`, `makeSymlink(..., { user })`, `remove(..., { user })`, `rename(..., { user })`
- intentionally not exposed yet: MCP server helpers and devcontainer helpers

### Build Plane Namespace

Low-level `SandboxBuildService` from `@seacloudai/sandbox/build` exposes:

- system: `metrics`
- templates: `createTemplate`, `listTemplates`, `getTemplateByAlias`, `resolveTemplateRef`, `getTemplate`, `updateTemplate`, `deleteTemplate`
- builds: `createBuild`, `getBuildFile`, `rollbackTemplate`, `listBuilds`, `getBuild`, `getBuildStatus`, `getBuildLogs`
- tags: `assignTemplateTags`, `deleteTemplateTags`, `listTemplateTags`

The public template contract is split into three layers: E2B create fields (`name`, `tags`, `cpuCount`, `memoryMB`), Atlas extension fields under `extensions` (`baseTemplateID`, `visibility`, `envs`, `storageType`, `storageSizeGB`, `volumeMounts`), E2B update field `public`, and build-only fields on `createBuild` (`fromImage`, `fromTemplate`, `steps`, `startCmd`, `readyCmd`, registry credentials, `steps[].filesHash`).
When `extensions.storageType="nfs"`, the public API still does not expose `nfsHostPath`; each `volumeMounts[i].name` is treated as the per-sandbox NFS subdirectory name under the inherited base template's NFS root, and `volumeMounts[i].path` is the container mount path. A mount named `workspace` becomes the primary workspace path.
Runtime behavior defaults from the image source: templates inheriting SeaCloud base/runtime templates keep the managed runtime, while direct external images run as plain business containers. `startCmd` and `readyCmd` only provide startup and readiness commands on top of that default.
Public create calls reject unsupported top-level write fields such as `alias` and `public`; public update calls only accept `public`.

For Node callers, the public write path and template read path now use different extension models on purpose:

- `createTemplate` uses `PublicTemplateExtensions`; `updateTemplate` uses `{ public?: boolean }`
- `ListedTemplate` / `TemplateResponse` follow the E2B response shape; Atlas platform internals are not returned on public reads

This matches the current public builder API contract: request fields are intentionally narrower than response fields.

`createTemplate` rejects `visibility="official"` on public routes, including `extensions.visibility === "official"`.

`createBuild` now follows the E2B wire contract directly: COPY contexts are passed through `steps[].filesHash`, and the SDK returns the raw `202 {}` trigger response without adding helper fields.

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

- `CmdRequestOptions`: username, signature, signature expiration, range, requestTimeoutMs, extra headers
- `ProcessStream` and `FilesystemWatchStream`: Connect-RPC stream readers
- `ConnectFrame`: low-level frame parser for `streamInput`

## Module Layout

- `@seacloudai/sandbox`: root high-level `Sandbox` / `Template` facade
- `@seacloudai/sandbox/control`: control-plane types and low-level service
- `@seacloudai/sandbox/build`: build-plane types and low-level service
- `@seacloudai/sandbox/cmd`: runtime types, streams, and low-level service
- `@seacloudai/sandbox/core`: shared errors and common response types

## Notes

- High-level helpers always read gateway auth and endpoint from `SEACLOUD_BASE_URL` / `SEACLOUD_API_KEY`. Only low-level transport clients should be initialized with explicit `baseUrl` / `apiKey`.
- Runtime access should be derived from bound sandbox objects or low-level sandbox instances.
- Low-level create/detail responses include `envdUrl` and `envdAccessToken` when the sandbox exposes nano-executor APIs.
- Runtime file/process APIs require a template image that starts nano-executor and returns runtime access fields; if runtime APIs return `404`, verify the selected template supports CMD runtime routes.
- Sandbox lifecycle helpers use `timeout` seconds; runtime helpers keep per-operation `timeoutMs` settings. Per-request runtime HTTP overrides are available in `CmdRequestOptions.requestTimeoutMs`.
- The bound sandbox exposes `trafficAccessToken` as an E2B-style alias of the runtime access token returned by the gateway.
- `waitReady: true` can take longer than the default lifecycle wait in production; pass a larger `timeout` on high-level create/connect calls for long-wait workflows.
- HTTP errors are classified into typed errors such as `NotFoundError`, `RateLimitError`, and `ServerError`. Transport timeouts raise `RequestTimeoutError`.
- High-level `kill()` helpers send `SIGNAL_SIGKILL` and return `false` when the runtime reports a missing process through either `404` or `ESRCH`.
- PTY handles normalize reconnect output into `pty` even when the runtime emits the bytes through `stdout` / `stderr`.
- Sandbox lifecycle timeout is validated to `0..86400` seconds; refresh duration to `0..3600` seconds.
- Build validation accepts E2B-style `COPY` / `ENV` / `RUN` / `WORKDIR` / `USER` steps, `force`, and structured `fromImageRegistry` credentials (`registry` / `aws` / `gcp`).
- Some gateways do not expose `/admin/*`; the integration suite skips those cases on `404`.
- Some filesystem layouts reject watcher APIs entirely; the integration suite skips watcher coverage when the runtime reports that limitation.

## Security

- Do not commit `SEACLOUD_API_KEY`, `envdAccessToken`, or sandbox access tokens.
- Treat runtime tokens as sandbox-scoped secrets. Prefer bound sandbox objects or low-level sandbox instances so response-scoped runtime access is not copied into configuration.
- Do not log raw API keys or runtime tokens. SDK errors may include response bodies, so avoid logging full error payloads in shared systems.

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

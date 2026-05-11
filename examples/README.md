# Node Examples

Build first so the examples can import from `dist/`.

```bash
npm run build
```

Shared env:

- `E2B_DOMAIN`
- `E2B_API_KEY`

Before running any example, export these variables once in your shell. Use the gateway entrypoint documented in the root `README.md`.

Example-specific inputs intentionally use the `SANDBOX_EXAMPLE_*` prefix so they do not collide with the production-oriented variables shown in the package root `README.md`.
Examples focus on the stable lifecycle, template, command, and PTY flows. Watcher APIs are covered in tests instead, because some sandbox filesystem layouts reject them entirely.

Recommended reading order:

1. `code-interpreter.mjs`: default Python context -> explicit Python context -> non-Python stateless `context`
2. `full-workflow.mjs`: pure high-level facade flow -> create a template -> trigger an E2B-style build -> wait for build -> start sandbox -> connect runtime -> run -> logs/metrics -> cleanup
3. `template-features.mjs`: `fromDockerfile` -> local `copy(..., { mode, resolveSymlinks, user })` -> `Template.buildInBackground()` -> `Template.getBuildStatus()` -> existence/detail
4. `control-sandbox.mjs`: `Sandbox.create()` -> reload -> cleanup
5. `cmd-smoke.mjs`: `Sandbox.create()` -> `files` / `commands` modules
6. `build-template.mjs`: minimal `Template.build()`

## Code Interpreter

This example focuses on the E2B-style code interpreter facade:

- repeated `sandbox.runCode(...)` calls sharing the default Python context
- explicit stateful Python contexts with `createCodeContext(...)`
- non-Python contexts acting as reusable execution profiles for `language`, `cwd`, and `timeout`
- requires a template that actually bundles the code-interpreter environment; `base` is not enough

Required env:

- `SANDBOX_EXAMPLE_TEMPLATE_ID`

Optional env:

- `SANDBOX_EXAMPLE_KEEP_RESOURCES=1`

```bash
node examples/code-interpreter.mjs
```

For SeaCloudAI environments, prefer an official `code-interpreter` template or a concrete `tpl-code-interpreter-...` template ID for this example.

## Full Workflow

This is the primary example when evaluating the SDK end to end:

- create a template
- trigger a build from a runtime-enabled image plus E2B-style steps
- wait for the build to finish
- inspect build status, build logs, and template detail
- start a sandbox from that template
- reload, fetch sandbox logs, connect, inspect runtime metrics, and run a command
- delete the sandbox and template unless `SANDBOX_EXAMPLE_KEEP_RESOURCES=1`

Required env:

- `SANDBOX_EXAMPLE_RUNTIME_BASE_IMAGE`

Optional env:

- `SANDBOX_EXAMPLE_KEEP_RESOURCES=1`

The source image must already be runtime-enabled for CMD APIs. The example build starts from that image and adds app-specific content under `/workspace` through a `RUN` step.

```bash
node examples/full-workflow.mjs
```

## Control Plane

This example shows the preferred workflow:

- call `Sandbox.create(...)` directly
- keep operating through the returned bound sandbox object
- reload once to show the bound-object workflow
- cleanup through the same object

Required env:

- `SANDBOX_EXAMPLE_TEMPLATE_ID`

Optional env:

- `SANDBOX_EXAMPLE_KEEP_RESOURCES=1`

```bash
node examples/control-sandbox.mjs
```

## Build Plane

Recommended path: the example uses `Template.build()`.
The flow shows the env-first high-level template workflow directly: template DSL -> build polling -> template detail -> cleanup.

Required env: none

Optional env:

- `SANDBOX_EXAMPLE_BUILD_IMAGE`
- `SANDBOX_EXAMPLE_KEEP_RESOURCES=1`

```bash
node examples/build-template.mjs
```

## Template Features

This example covers the supported template helpers that are not obvious from the minimal build flow:

- parse a Dockerfile from disk with `fromDockerfile`
- inspect the generated request with `Template.toJSON(...)` and `Template.toDockerfile(...)`
- add extra steps with `skipCache()` and `runCmd(..., { user })`
- upload a local symlink target with `copy(..., { mode, resolveSymlinks, user })`
- trigger `Template.buildInBackground(...)` and poll with `Template.getBuildStatus(...)`
- verify template existence with `Template.exists(...)` and inspect template detail with `Template.get(...)`

Required env: none

Optional env:

- `SANDBOX_EXAMPLE_BUILD_IMAGE`
- `SANDBOX_EXAMPLE_KEEP_RESOURCES=1`

```bash
node examples/template-features.mjs
```

## CMD Plane

Recommended path: the example uses `Sandbox.create(...)` and then stays on `files` / `commands`.
The selected template must include nano-executor runtime support; otherwise file/process/RPC calls can return `404`.
The flow stays minimal: write file -> read file -> list directory -> run command.
The example writes under `/root/workspace`, which is the writable sandbox workspace in the current SeaCloud runtime.

Required env:

- `SANDBOX_EXAMPLE_TEMPLATE_ID`

Optional env:

- `SANDBOX_EXAMPLE_KEEP_RESOURCES=1`

```bash
node examples/cmd-smoke.mjs
```

For SeaCloudAI production smoke tests, `tpl-base-dc11799b9f9f4f9e` is a known-good template for CMD/runtime examples such as this one. Use a `code-interpreter` template instead when you want to run `sandbox.runCode(...)`.

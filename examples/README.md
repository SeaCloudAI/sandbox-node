# Node Examples

Build first so the examples can import from `dist/`.

```bash
npm run build
```

Shared env:

- `SEACLOUD_BASE_URL`
- `SEACLOUD_API_KEY`

Before running any example, export these variables once in your shell. Use the gateway entrypoint documented in the root `README.md`.

Example-specific inputs intentionally use the `SANDBOX_EXAMPLE_*` prefix so they do not collide with the production-oriented variables shown in the package root `README.md`.
Examples focus on the stable lifecycle, template, command, and PTY flows. Watcher APIs are covered in tests instead, because some sandbox filesystem layouts reject them entirely.

Recommended reading order:

1. `full-workflow.mjs`: create a template -> trigger an E2B-style build -> wait for build -> start sandbox -> connect runtime -> run -> logs/metrics -> cleanup
2. `template-features.mjs`: `fromDockerfile` -> local `copy(..., { mode, resolveSymlinks })` -> `client.buildTemplateInBackground()` -> `client.getTemplateBuildStatus()` -> existence/detail
3. `control-sandbox.mjs`: `new SandboxClient(...)` -> `client.create()` -> reload -> cleanup
4. `cmd-smoke.mjs`: `new SandboxClient(...)` -> `client.create()` -> `files` / `commands` modules
5. `build-template.mjs`: minimal `new Template()` plus `client.buildTemplate()`

## Full Workflow

This is the primary example when evaluating the SDK end to end:

- create a template
- trigger a build from a runtime-enabled base image plus E2B-style steps
- wait for the build to finish
- inspect build status, build logs, and template detail
- start a sandbox from that template
- reload, fetch sandbox logs, connect, inspect runtime metrics, and run a command
- delete the sandbox and template unless `SANDBOX_EXAMPLE_KEEP_RESOURCES=1`

Required env:

- `SANDBOX_EXAMPLE_RUNTIME_BASE_IMAGE`

Optional env:

- `SANDBOX_EXAMPLE_KEEP_RESOURCES=1`

The base image must already be runtime-enabled for CMD APIs. The example build starts from that image and adds app-specific content under `/workspace` through a `RUN` step.

```bash
node examples/full-workflow.mjs
```

## Control Plane

This example shows the preferred workflow:

- initialize one `SandboxClient`
- create a sandbox through `client.create(...)`
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

Recommended path: the example uses `new Template()` plus `client.buildTemplate()`.
The flow shows the current client-first template workflow directly: template DSL -> build polling -> template detail -> cleanup.

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
- upload a local symlink target with `copy(..., { mode, resolveSymlinks })`
- initialize one `SandboxClient`
- trigger `client.buildTemplateInBackground(...)` and poll with `client.getTemplateBuildStatus(...)`
- verify template existence and inspect template detail

Required env: none

Optional env:

- `SANDBOX_EXAMPLE_BUILD_IMAGE`
- `SANDBOX_EXAMPLE_KEEP_RESOURCES=1`

```bash
node examples/template-features.mjs
```

## CMD Plane

Recommended path: the example uses `client.create(...)` and then stays on `files` / `commands`.
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

For SeaCloudAI production smoke tests, `tpl-base-dc11799b9f9f4f9e` is a known-good template to use when creating the runtime-enabled sandbox.

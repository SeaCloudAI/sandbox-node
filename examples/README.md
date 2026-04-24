# Node Examples

Build first so the examples can import from `dist/`.

```bash
npm run build
```

Shared env:

- `SEACLOUD_BASE_URL`
- `SEACLOUD_API_KEY`

Before running any example, export these variables once in your shell. Use the gateway entrypoint documented in the root `README.md`.

Recommended reading order:

1. `full-workflow.mjs`: create a template from a custom Dockerfile -> wait for build -> start sandbox -> connect runtime -> run -> logs/metrics -> cleanup
2. `control-sandbox.mjs`: root client -> create sandbox -> bound sandbox helpers -> cleanup
3. `cmd-smoke.mjs`: create a sandbox through the gateway, then write/read/list/run through runtime
4. `build-template.mjs`: template/build workflows through `client.build`

## Full Workflow

This is the primary example when evaluating the SDK end to end:

- create a template from a custom Dockerfile
- wait for the build to finish
- inspect build status, build logs, and template detail
- start a sandbox from that template
- reload, fetch sandbox logs, connect, inspect runtime metrics, and run a command
- delete the sandbox and template unless `SANDBOX_EXAMPLE_KEEP_RESOURCES=1`

Required env:

- `SANDBOX_EXAMPLE_RUNTIME_BASE_IMAGE`

Optional env:

- `SANDBOX_EXAMPLE_KEEP_RESOURCES=1`

The base image must already be runtime-enabled for CMD APIs. The example Dockerfile extends that image and adds app-specific content under `/workspace`.

```bash
node examples/full-workflow.mjs
```

## Control Plane

This example shows the preferred workflow:

- initialize the root `SandboxClient`
- create a sandbox from the root client
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

Recommended path: the example uses the root `SandboxClient` and `client.build`.
The flow stays minimal: create template with `name + image` -> fetch template -> cleanup.

Required env:

Optional env:

- `SANDBOX_EXAMPLE_BUILD_IMAGE`
- `SANDBOX_EXAMPLE_KEEP_RESOURCES=1`

```bash
node examples/build-template.mjs
```

## CMD Plane

Recommended path: the example uses the root `SandboxClient`, creates a sandbox through the gateway, then derives runtime access from the returned sandbox object.
The selected template must include nano-executor runtime support; otherwise file/process/RPC calls can return `404`.
The flow stays minimal: write file -> read file -> list directory -> run command.

Required env:

- `SANDBOX_EXAMPLE_TEMPLATE_ID`

Optional env:

- `SANDBOX_EXAMPLE_KEEP_RESOURCES=1`

```bash
node examples/cmd-smoke.mjs
```

For SeaCloudAI production smoke tests, `tpl-base-dc11799b9f9f4f9e` is a known-good template to use when creating the runtime-enabled sandbox.

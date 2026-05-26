import assert from "node:assert/strict";
import { mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CodeContext,
  CodeExecution,
  LogEntry,
  Sandbox,
  Template,
  waitForPort,
} from "../dist/index.js";
import { GatewayClient } from "../dist/gateway-client.js";
import { APIError, ValidationError } from "../dist/core/index.js";

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createGatewayClient(fetch) {
  return new GatewayClient({
    baseUrl: "https://sandbox-gateway.cloud.seaart.ai",
    apiKey: "unit-auth-value",
    fetch,
  });
}

test("unit: bound sandbox creates a sandbox and exposes runtime modules", async () => {
  const calls = [];
  const client = createGatewayClient(async (input, init) => {
      calls.push({ url: String(input), method: init.method, body: init.body });
      const url = new URL(String(input));
      if (url.pathname === "/api/v1/sandboxes") {
        assert.equal(init.method, "POST");
        assert.deepEqual(JSON.parse(init.body), { templateID: "base", waitReady: true });
        return jsonResponse(201, {
          sandboxID: "sb-1",
          templateID: "base",
          envdUrl: "https://runtime.cloud.seaart.ai/sb-1",
          envdAccessToken: "unit-runtime-auth",
          status: "running",
          state: "running",
        });
      }
      if (url.pathname === "/sb-1/run") {
        const headers = new Headers(init.headers);
        assert.equal(headers.get("X-Access-Token"), "unit-runtime-auth");
        assert.deepEqual(JSON.parse(init.body), { cmd: "echo hello" });
        return jsonResponse(200, {
          stdout: "hello\n",
          stderr: "",
          exit_code: 0,
          duration_ms: 3,
        });
      }
      if (url.pathname === "/sb-1/file" && url.searchParams.get("path") === "/tmp/hello.txt") {
        if (init.method === "POST") {
          const body = new Uint8Array(await new Response(init.body).arrayBuffer());
          assert.equal(new TextDecoder().decode(body), "hello from sandbox");
          return new Response(null, { status: 204 });
        }
        return new Response("hello from sandbox", { status: 200 });
      }
      throw new Error(`unexpected request: ${String(input)} ${init.method}`);
    });
  const sandbox = await client.create("base", { waitReady: true });

  assert.equal(sandbox.sandboxId, "sb-1");
  assert.equal(sandbox.sandboxDomain, "runtime.cloud.seaart.ai");
  assert.equal(sandbox.trafficAccessToken, "unit-runtime-auth");
  assert.equal(sandbox.getHost(3000), "https://runtime.cloud.seaart.ai/sb-1/proxy/3000/");
  assert.equal(sandbox.isRunning(), true);

  const result = await sandbox.commands.run("echo hello");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "hello\n");

  const execResult = await sandbox.commands.exec("echo hello");
  assert.equal(execResult.exitCode, 0);

  const writeInfo = await sandbox.files.write("/tmp/hello.txt", "hello from sandbox");
  const content = await sandbox.files.read("/tmp/hello.txt");
  assert.deepEqual(writeInfo, {
    name: "hello.txt",
    path: "/tmp/hello.txt",
    type: "file",
  });
  assert.equal(content, "hello from sandbox");
  assert.equal(calls.length, 5);
});

test("unit: high-level create requires templateID", async () => {
  const client = createGatewayClient(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/v1/sandboxes") {
        assert.deepEqual(JSON.parse(init.body), { templateID: "base", waitReady: true });
        return jsonResponse(201, {
          sandboxID: "sb-default",
          templateID: "base",
          envdUrl: "https://runtime.cloud.seaart.ai/sb-default",
          envdAccessToken: "unit-runtime-auth",
          status: "running",
          state: "running",
        });
      }
      throw new Error(`unexpected request: ${String(input)} ${init.method}`);
    });

  const sandbox = await client.create("base", { waitReady: true });
  assert.equal(sandbox.templateId, "base");
});

test("unit: sandbox file urls are signed from runtime access token", async () => {
  const client = createGatewayClient(async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/v1/sandboxes") {
      return jsonResponse(201, {
        sandboxID: "sb-url",
        templateID: "base",
        envdUrl: "https://runtime.cloud.seaart.ai/sb-url",
        envdAccessToken: "signed-secret",
        status: "running",
        state: "running",
      });
    }
    throw new Error(`unexpected request: ${String(input)} ${init?.method}`);
  });
  const sandbox = await client.create("base");

  const downloadURL = await sandbox.downloadUrl("/tmp/demo.txt", { user: "root", useSignatureExpiration: 3600 });
  const uploadURL = await sandbox.uploadUrl("/tmp/demo.txt", { user: "root" });
  const parsedDownload = new URL(downloadURL);
  const parsedUpload = new URL(uploadURL);

  assert.equal(parsedDownload.pathname, "/sb-url/files");
  assert.equal(parsedDownload.searchParams.get("path"), "/tmp/demo.txt");
  assert.equal(parsedDownload.searchParams.get("username"), "root");
  assert.equal(parsedDownload.searchParams.get("signature_expiration"), "3600");
  assert.match(parsedDownload.searchParams.get("signature"), /^v1_/);
  assert.equal(parsedUpload.pathname, "/sb-url/files");
  assert.equal(parsedUpload.searchParams.get("path"), "/tmp/demo.txt");
  assert.match(parsedUpload.searchParams.get("signature"), /^v1_/);
});

test("unit: bound sandbox exposes git helpers", async () => {
  const client = createGatewayClient(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/v1/sandboxes") {
        return jsonResponse(201, {
          sandboxID: "sb-git",
          templateID: "base",
          envdUrl: "https://runtime.cloud.seaart.ai/sb-git",
          envdAccessToken: "unit-runtime-auth",
          status: "running",
          state: "running",
        });
      }
      if (url.pathname === "/sb-git/run") {
        assert.deepEqual(JSON.parse(init.body), {
          cmd: "git",
          args: ["clone", "--branch", "main", "--depth", "1", "https://github.com/acme/repo.git", "/workspace/repo"],
        });
        return jsonResponse(200, {
          stdout: "ok\n",
          stderr: "",
          exit_code: 0,
          duration_ms: 5,
        });
      }
      throw new Error(`unexpected request: ${String(input)} ${init.method}`);
    });
  const sandbox = await client.create("base");

  const result = await sandbox.git.clone("https://github.com/acme/repo.git", "/workspace/repo", {
    branch: "main",
    depth: 1,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "ok\n");
});

test("unit: bound sandbox exposes filesystem, pty, proxy, and extra git helpers", async () => {
  const runCalls = [];
  const signalCalls = [];
  const client = createGatewayClient(async (input, init = {}) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/v1/sandboxes") {
        return jsonResponse(201, {
          sandboxID: "sb-ops",
          templateID: "base",
          envdUrl: "https://runtime.cloud.seaart.ai/sb-ops",
          envdAccessToken: "unit-runtime-auth",
          status: "running",
          state: "running",
        });
      }
      if (url.pathname === "/sb-ops/filesystem.Filesystem/Stat") {
        const request = JSON.parse(init.body);
        if (request.path === "/tmp/missing" || request.path === "/tmp/new") {
          return jsonResponse(404, { error: { message: "not found" } });
        }
        return jsonResponse(200, {
          entry: {
            name: "a.txt",
            path: request.path,
            type: "FILE_TYPE_FILE",
          },
        });
      }
      if (url.pathname === "/sb-ops/filesystem.Filesystem/ListDir") {
        assert.deepEqual(JSON.parse(init.body), { path: "/tmp", depth: 1 });
        return jsonResponse(200, {
          entries: [{ name: "a.txt", path: "/tmp/a.txt", type: "FILE_TYPE_FILE" }],
        });
      }
      if (url.pathname === "/sb-ops/filesystem.Filesystem/MakeDir") {
        assert.deepEqual(JSON.parse(init.body), { path: "/tmp/new" });
        return jsonResponse(200, { entry: { path: "/tmp/new", type: "FILE_TYPE_DIRECTORY" } });
      }
      if (url.pathname === "/sb-ops/filesystem.Filesystem/Remove") {
        assert.deepEqual(JSON.parse(init.body), { path: "/tmp/old" });
        return jsonResponse(200, {});
      }
      if (url.pathname === "/sb-ops/filesystem.Filesystem/Move") {
        assert.deepEqual(JSON.parse(init.body), { source: "/tmp/a.txt", destination: "/tmp/b.txt" });
        return jsonResponse(200, { entry: { path: "/tmp/b.txt", type: "FILE_TYPE_FILE" } });
      }
      if (url.pathname === "/sb-ops/filesystem.Filesystem/WatchDir") {
        assert.deepEqual(JSON.parse(init.body), { path: "/tmp", recursive: true });
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(connectFrame({ filesystem: { name: "a.txt", type: "EVENT_TYPE_WRITE" } }));
            controller.close();
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { "content-type": "application/connect+json" },
        });
      }
      if (url.pathname === "/sb-ops/process.Process/Start") {
        const request = JSON.parse(init.body);
        assert.equal(request.process.cmd, "bash");
        assert.deepEqual(request.pty, { size: { cols: 90, rows: 30 } });
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(connectFrame({ event: { start: { pid: 77 } } }));
            controller.close();
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { "content-type": "application/connect+json" },
        });
      }
      if (url.pathname === "/sb-ops/process.Process/Connect") {
        assert.deepEqual(JSON.parse(init.body), { process: { pid: 77 } });
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(connectFrame({ event: { start: { pid: 77 } } }));
            controller.close();
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { "content-type": "application/connect+json" },
        });
      }
      if (url.pathname === "/sb-ops/process.Process/Update") {
        assert.deepEqual(JSON.parse(init.body), {
          process: { pid: 77 },
          pty: { size: { cols: 100, rows: 40 } },
        });
        return jsonResponse(200, {});
      }
      if (url.pathname === "/sb-ops/process.Process/SendSignal") {
        const request = JSON.parse(init.body);
        signalCalls.push(request);
        if (request.process.pid === 404) {
          return jsonResponse(404, { error: { message: "not found" } });
        }
        if (request.process.pid === 405) {
          return jsonResponse(500, { message: "kill failed: ESRCH: No such process" });
        }
        return jsonResponse(200, {});
      }
      if (url.pathname === "/sb-ops/run") {
        runCalls.push(JSON.parse(init.body));
        return jsonResponse(200, {
          stdout: "ok\n",
          stderr: "",
          exit_code: 0,
          duration_ms: 1,
        });
      }
      if (url.pathname === "/sb-ops/proxy/8080/health") {
        return new Response("proxied", { status: 200 });
      }
      throw new Error(`unexpected request: ${String(input)} ${init.method}`);
    });
  const sandbox = await client.create("base");

  assert.equal(await sandbox.files.exists("/tmp/missing"), false);
  assert.equal(await sandbox.files.exists("/tmp/a.txt"), true);
  assert.equal((await sandbox.files.getInfo("/tmp/a.txt")).path, "/tmp/a.txt");
  assert.equal((await sandbox.files.getInfo("/tmp/a.txt")).type, "file");
  assert.equal((await sandbox.files.list("/tmp", { depth: 1 }))[0].path, "/tmp/a.txt");
  assert.equal((await sandbox.files.list("/tmp", { depth: 1 }))[0].type, "file");
  assert.equal(await sandbox.files.makeDir("/tmp/new"), true);
  assert.equal(await sandbox.files.makeDir("/tmp/a.txt"), false);
  await sandbox.files.remove("/tmp/old");
  assert.equal((await sandbox.files.rename("/tmp/a.txt", "/tmp/b.txt")).path, "/tmp/b.txt");
  assert.equal((await sandbox.files.rename("/tmp/a.txt", "/tmp/b.txt")).type, "file");
  const events = [];
  let stopWatch;
  const eventSeen = new Promise((resolve) => {
    sandbox.files.watchDir("/tmp", (event) => {
      events.push(event);
      resolve();
    }, { recursive: true }).then((watch) => {
      stopWatch = () => watch.stop();
    });
  });
  await eventSeen;
  await stopWatch();
  assert.deepEqual(events, [{ name: "a.txt", type: "write" }]);

  const created = await sandbox.pty.create("bash", { size: { cols: 90, rows: 30 } });
  const connected = await sandbox.pty.connect(77);
  await sandbox.pty.resize(77, { cols: 100, rows: 40 });
  assert.equal(created.pid, 77);
  assert.equal(connected.pid, 77);
  assert.equal(await sandbox.pty.kill(77), true);
  assert.equal(await sandbox.pty.kill(404), false);
  assert.equal(await sandbox.pty.kill(405), false);

  await sandbox.git.pull("/workspace/repo", { envs: { A: "1" }, timeoutMs: 5000 });
  await sandbox.git.checkout("main", "/workspace/repo");
  await sandbox.git.status("/workspace/repo");

  const proxy = await sandbox.proxy({ port: 8080, path: "/health" });
  assert.equal(await proxy.text(), "proxied");
  assert.deepEqual(runCalls, [
    { cmd: "git", args: ["pull"], cwd: "/workspace/repo", env: { A: "1" }, timeoutMs: 5000 },
    { cmd: "git", args: ["checkout", "main"], cwd: "/workspace/repo" },
    { cmd: "git", args: ["status"], cwd: "/workspace/repo" },
  ]);
  assert.deepEqual(signalCalls, [
    { process: { pid: 77 }, signal: "SIGNAL_SIGKILL" },
    { process: { pid: 404 }, signal: "SIGNAL_SIGKILL" },
    { process: { pid: 405 }, signal: "SIGNAL_SIGKILL" },
  ]);
});

test("unit: bound sandbox can list sandboxes before runtime is ready", async () => {
  const client = createGatewayClient(async (input) => {
      assert.equal(String(input), "https://sandbox-gateway.cloud.seaart.ai/api/v1/sandboxes");
      return jsonResponse(200, [{
        sandboxID: "sb-2",
        templateID: "base",
        status: "paused",
        state: "paused",
      }]);
    });
  const sandboxes = await client.list().nextItems();

  assert.equal(sandboxes.length, 1);
  assert.equal(sandboxes[0].sandboxID, "sb-2");
  assert.equal(sandboxes[0].state, "paused");
});

test("unit: bound sandbox exposes getInfo and resume helpers", async () => {
  let connectRequested = false;
  let getRequests = 0;
  const client = createGatewayClient(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/v1/sandboxes") {
        return jsonResponse(201, {
          sandboxID: "sb-3",
          templateID: "base",
          status: "paused",
          state: "paused",
        });
      }
      if (url.pathname === "/api/v1/sandboxes/sb-3" && init.method === "GET") {
        getRequests += 1;
        return jsonResponse(200, {
          sandboxID: "sb-3",
          templateID: "base",
          clientID: "user-1",
          envdUrl: "https://runtime.cloud.seaart.ai/sb-3",
          envdAccessToken: "runtime-token",
          status: "paused",
          state: "paused",
          cpuCount: 2,
          memoryMB: 1024,
          diskSizeMB: 2048,
          startedAt: "2026-01-01T00:00:00Z",
          endAt: "2026-01-01T01:00:00Z",
        });
      }
      if (url.pathname === "/api/v1/sandboxes/sb-3/connect" && init.method === "POST") {
        connectRequested = true;
        assert.deepEqual(JSON.parse(init.body), { timeout: 300 });
        return jsonResponse(200, {
          sandboxID: "sb-3",
          templateID: "base",
          clientID: "user-1",
          envdUrl: "https://runtime.cloud.seaart.ai/sb-3",
          envdAccessToken: "runtime-token",
          status: "running",
          state: "running",
          startedAt: "2026-01-01T00:00:00Z",
          endAt: "2026-01-01T01:00:00Z",
        });
      }
      throw new Error(`unexpected request: ${String(input)} ${init.method}`);
    });
  const sandbox = await client.create("base");

  const detail = await sandbox.getInfo();
  const fullInfo = await sandbox.getFullInfo();
  assert.equal(detail.state, "paused");
  assert.equal(fullInfo.state, "paused");
  assert.equal(getRequests, 2);
  assert.equal(sandbox.isRunning(), false);

  const resumed = await sandbox.resume();
  assert.equal(resumed, sandbox);
  assert.equal(connectRequested, true);
  assert.equal(sandbox.status, "running");
  assert.equal(sandbox.isRunning(), true);
});

test("unit: high-level lifecycle helpers allow zero-value TTL semantics", async () => {
  const calls = [];
  const client = createGatewayClient(async (input, init) => {
    const url = new URL(String(input));
    calls.push({ path: url.pathname, method: init.method, body: init.body ? JSON.parse(init.body) : null });
    if (url.pathname === "/api/v1/sandboxes/sb-zero/connect") {
      return jsonResponse(200, {
        sandboxID: "sb-zero",
        templateID: "base",
        status: "running",
        state: "running",
      });
    }
    if (url.pathname === "/api/v1/sandboxes/sb-zero/timeout") {
      return new Response(null, { status: 204 });
    }
    throw new Error(`unexpected request: ${String(input)} ${init.method}`);
  });

  const sandbox = await client.connect("sb-zero", { timeout: 0 });
  await sandbox.setTimeout(0);

  assert.deepEqual(calls, [
    { path: "/api/v1/sandboxes/sb-zero/connect", method: "POST", body: { timeout: 0 } },
    { path: "/api/v1/sandboxes/sb-zero/timeout", method: "POST", body: { timeout: 0 } },
  ]);
});

test("unit: bound sandbox runCode uses default python context and preserves execution state", async () => {
  const startCalls = [];
  const sendInputs = [];
  const stdout = [];
  const stderr = [];
  const results = [];
  const errors = [];

  const payload1 = "__SEACLOUD_CODE_CONTEXT__" + JSON.stringify({
    results: [{ text: "1", json: 1 }],
    logs: { stdout: ["hello\n"], stderr: [] },
    executionCount: 1,
  }) + "\n";
  const payload2 = "__SEACLOUD_CODE_CONTEXT__" + JSON.stringify({
    results: [{ text: "2", json: 2 }],
    logs: { stdout: [], stderr: ["warn\n"] },
    executionCount: 2,
  }) + "\n";

  const client = createGatewayClient(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/v1/sandboxes") {
        return jsonResponse(201, {
          sandboxID: "sb-code",
          templateID: "base",
          envdUrl: "https://runtime.cloud.seaart.ai/sb-code",
          envdAccessToken: "unit-runtime-auth",
          status: "running",
          state: "running",
        });
      }
      if (url.pathname === "/sb-code/file" && init.method === "POST") {
        return new Response(null, { status: 204 });
      }
      if (url.pathname === "/sb-code/process.Process/Start") {
        startCalls.push(JSON.parse(init.body));
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(connectFrame({ event: { start: { pid: 55 } } }));
            controller.enqueue(connectFrame({ event: { data: {
              stdout: Buffer.from(payload1).toString("base64"),
            } } }));
            controller.enqueue(connectFrame({ event: { data: {
              stdout: Buffer.from(payload2).toString("base64"),
            } } }));
            controller.close();
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { "content-type": "application/connect+json" },
        });
      }
      if (url.pathname === "/sb-code/process.Process/SendInput") {
        sendInputs.push(JSON.parse(init.body));
        return jsonResponse(200, {});
      }
      if (url.pathname === "/api/v1/sandboxes/sb-code" && init.method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected request: ${String(input)} ${init.method}`);
    });
  const sandbox = await client.create("base");

  const execution1 = await sandbox.runCode("x = 1\nprint('hello')\nx", {
    cwd: "/workspace",
    timeoutMs: 30000,
    onStdout: (chunk) => stdout.push(chunk),
    onStderr: (chunk) => stderr.push(chunk),
    onResult: (result) => results.push(result),
    onError: (error) => errors.push(error),
  });
  const execution2 = await sandbox.runCode("x + 1", {
    onStdout: (chunk) => stdout.push(chunk),
    onStderr: (chunk) => stderr.push(chunk),
    onResult: (result) => results.push(result),
    onError: (error) => errors.push(error),
  });

  assert.equal(execution1 instanceof CodeExecution, true);
  assert.equal(execution2.executionCount, 2);
  assert.equal(startCalls.length, 1);
  assert.equal(sendInputs.length, 2);
  assert.deepEqual(execution1.results, [{ text: "1", json: 1 }]);
  assert.deepEqual(execution2.results, [{ text: "2", json: 2 }]);
  assert.deepEqual(execution1.logs.stdout, ["hello\n"]);
  assert.deepEqual(execution2.logs.stderr, ["warn\n"]);
  assert.equal(stdout[0].line, "hello\n");
  assert.equal(stderr[0].line, "warn\n");
  assert.deepEqual(results, [{ text: "1", json: 1 }, { text: "2", json: 2 }]);
  assert.deepEqual(errors, []);
  assert.equal(startCalls[0].stdin, true);
  assert.match(startCalls[0].process.args[1], /\/root\/workspace\/\.seacloud-code-context-default\.py$/);
  await sandbox.delete();
});

test("unit: bound sandbox manages explicit python code contexts", async () => {
  let startCount = 0;
  const signalCalls = [];
  const removeCalls = [];
  const client = createGatewayClient(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/v1/sandboxes") {
        return jsonResponse(201, {
          sandboxID: "sb-context",
          templateID: "base",
          envdUrl: "https://runtime.cloud.seaart.ai/sb-context",
          envdAccessToken: "unit-runtime-auth",
          status: "running",
          state: "running",
        });
      }
      if (url.pathname === "/sb-context/file" && init.method === "POST") {
        return new Response(null, { status: 204 });
      }
      if (url.pathname === "/sb-context/process.Process/Start") {
        startCount += 1;
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(connectFrame({ event: { start: { pid: 60 + startCount } } }));
            controller.close();
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { "content-type": "application/connect+json" },
        });
      }
      if (url.pathname === "/sb-context/process.Process/SendSignal") {
        signalCalls.push(JSON.parse(init.body));
        return jsonResponse(200, {});
      }
      if (url.pathname === "/sb-context/filesystem.Filesystem/Remove") {
        removeCalls.push(JSON.parse(init.body).path);
        return jsonResponse(200, {});
      }
      if (url.pathname === "/api/v1/sandboxes/sb-context" && init.method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected request: ${String(input)} ${init.method}`);
    });
  const sandbox = await client.create("base");
  const context = await sandbox.createCodeContext({ cwd: "/workspace", language: "python", timeoutMs: 10000 });

  assert.equal(context instanceof CodeContext, true);
  assert.equal((await sandbox.listCodeContexts()).length, 1);
  await sandbox.restartCodeContext(context);
  await sandbox.removeCodeContext(context.contextId);

  assert.equal(startCount, 2);
  assert.equal(signalCalls.length, 2);
  assert.equal(removeCalls.length, 2);
  await sandbox.delete();
});

test("unit: non-python code contexts behave as stateless execution profiles", async () => {
  const removeCalls = [];
  const client = createGatewayClient(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/v1/sandboxes") {
        return jsonResponse(201, {
          sandboxID: "sb-stateless-context",
          templateID: "base",
          envdUrl: "https://runtime.cloud.seaart.ai/sb-stateless-context",
          envdAccessToken: "unit-runtime-auth",
          status: "running",
          state: "running",
        });
      }
      if (url.pathname === "/sb-stateless-context/file" && init.method === "POST") {
        return new Response(null, { status: 204 });
      }
      if (url.pathname === "/sb-stateless-context/process.Process/Start") {
        const request = JSON.parse(init.body);
        assert.equal(request.process.cmd, "bash");
        assert.equal(request.process.cwd, "/workspace/app");
        assert.equal(request.timeoutMs, 12000);
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(connectFrame({ event: { start: { pid: 88, cmdId: "cmd-bash" } } }));
            controller.enqueue(connectFrame({ event: { data: { stdout: Buffer.from("hi\n", "utf8").toString("base64") } } }));
            controller.enqueue(connectFrame({ event: { end: { exited: true, status: "exit status 0", error: null } } }));
            controller.close();
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { "content-type": "application/connect+json" },
        });
      }
      if (url.pathname === "/sb-stateless-context/filesystem.Filesystem/Remove") {
        removeCalls.push(JSON.parse(init.body).path);
        return jsonResponse(200, {});
      }
      if (url.pathname === "/api/v1/sandboxes/sb-stateless-context" && init.method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected request: ${String(input)} ${init.method}`);
    });

  const sandbox = await client.create("base");
  const context = await sandbox.createCodeContext({ cwd: "/workspace/app", language: "bash", timeoutMs: 12000 });
  const execution = await sandbox.runCode("echo hi", { context });

  assert.equal(context.language, "bash");
  assert.equal((await sandbox.listCodeContexts()).length, 1);
  assert.equal((await sandbox.restartCodeContext(context)).contextId, context.contextId);
  assert.equal(execution.text, "hi\n");
  await sandbox.removeCodeContext(context);
  assert.deepEqual(await sandbox.listCodeContexts(), []);
  assert.equal(removeCalls.length, 2);
  await sandbox.delete();
});

test("unit: client template workflow builds and polls until ready", async () => {
  const logs = [];
  const template = Template()
    .fromImage("docker.io/library/node:20")
    .runCmd("npm install")
    .setStartCmd("npm start", waitForPort(3000));

  const client = createGatewayClient(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/v1/templates" && init.method === "POST") {
        assert.deepEqual(JSON.parse(init.body), {
          name: "demo",
          tags: ["v1"],
          extensions: { baseTemplateID: "tpl-base-1" },
        });
        return jsonResponse(202, {
          templateID: "tpl-1",
          buildID: "server-build-id",
          public: false,
          names: ["demo"],
          tags: ["v1"],
          aliases: [],
        });
      }
      if (url.pathname === "/api/v1/templates/tpl-1/builds/build-") {
        throw new Error("unexpected exact build path");
      }
      if (url.pathname.startsWith("/api/v1/templates/tpl-1/builds/") && init.method === "POST") {
        const request = JSON.parse(init.body);
        assert.equal(request.fromImage, "docker.io/library/node:20");
        assert.equal(request.startCmd, "npm start");
        assert.match(request.readyCmd, /3000/);
        return jsonResponse(202, {});
      }
      if (url.pathname.startsWith("/api/v1/templates/tpl-1/builds/") && url.pathname.endsWith("/status")) {
        return jsonResponse(200, {
          buildID: "build-x",
          templateID: "tpl-1",
          status: "ready",
          logs: [],
          logEntries: [{
            timestamp: "2026-01-01T00:00:00Z",
            level: "info",
            step: "RUN",
            message: "installed dependencies",
          }],
          reason: null,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:02Z",
        });
      }
      if (url.pathname === "/api/v1/templates/tpl-1" && init.method === "GET") {
        return jsonResponse(200, {
          templateID: "tpl-1",
          buildID: "build-x",
          buildStatus: "ready",
          public: false,
          aliases: [],
          names: ["demo"],
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:02Z",
          spawnCount: 0,
          buildCount: 1,
        });
      }
      if (url.pathname.startsWith("/api/v1/templates/tpl-1/builds/") && init.method === "GET") {
        return jsonResponse(200, {
          buildID: "build-x",
          templateID: "tpl-1",
          status: "ready",
          image: "demo:v1",
          errorMessage: "",
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:02Z",
        });
      }
      throw new Error(`unexpected request: ${String(input)} ${init.method}`);
    });
  const built = await client.buildTemplate(template, "demo:v1", {
    baseTemplateID: "tpl-base-1",
    pollIntervalMs: 1,
    onBuildLogs: (entry) => logs.push(entry.toString()),
  });

  assert.equal(built.templateId, "tpl-1");
  assert.deepEqual(built.tags, ["v1"]);
  assert.equal(logs.some((line) => line.includes("installed dependencies")), true);
  assert.equal(logs[0] instanceof String, false);
  assert.equal(new LogEntry(new Date("2026-01-01T00:00:00Z"), "info", "hello").toString().includes("hello"), true);
});

test("unit: client.buildTemplateInBackground skips polling and returns building status", async () => {
  let statusRequested = false;
  const client = createGatewayClient(async (input, init) => {
        const url = new URL(String(input));
        if (url.pathname === "/api/v1/templates" && init.method === "POST") {
          return jsonResponse(202, {
            templateID: "tpl-bg",
            buildID: "server-build-id",
            public: false,
            names: ["demo"],
            tags: ["v2"],
            aliases: [],
          });
        }
        if (url.pathname.startsWith("/api/v1/templates/tpl-bg/builds/") && init.method === "POST") {
          return jsonResponse(202, {});
        }
        if (url.pathname.startsWith("/api/v1/templates/tpl-bg/builds/") && url.pathname.endsWith("/status")) {
          statusRequested = true;
          throw new Error("status should not be requested for background builds");
        }
        if (url.pathname === "/api/v1/templates/tpl-bg" && init.method === "GET") {
          return jsonResponse(200, {
            templateID: "tpl-bg",
            buildStatus: "building",
            public: false,
            aliases: [],
            names: ["demo"],
          });
        }
        throw new Error(`unexpected request: ${String(input)} ${init.method}`);
      });
  const built = await client.buildTemplateInBackground(
    new Template().fromImage("docker.io/library/node:20"),
    "demo:v2",
  );

  assert.equal(statusRequested, false);
  assert.equal(built.templateId, "tpl-bg");
  assert.equal(built.buildId.startsWith("build-"), true);
});

test("unit: Template static helpers use env-first gateway flow", async () => {
  const calls = [];
  const template = new Template().fromImage("docker.io/library/node:20");
  const previousDomain = process.env.SEACLOUD_BASE_URL;
  const previousAPIKey = process.env.SEACLOUD_API_KEY;
  process.env.SEACLOUD_BASE_URL = "https://sandbox-gateway.cloud.seaart.ai";
  process.env.SEACLOUD_API_KEY = "unit-auth-value";

  try {
    const built = await Template.build(
      template,
      "demo:v1",
      {
        pollIntervalMs: 1,
        fetch: async (input, init) => {
          const url = new URL(String(input));
          calls.push({ path: url.pathname, method: init.method, query: url.search });
          if (url.pathname === "/api/v1/templates" && init.method === "POST") {
            return jsonResponse(202, {
              templateID: "tpl-static",
              buildID: "server-build-id",
              public: false,
              names: ["demo"],
              tags: ["v1"],
              aliases: [],
            });
          }
          if (url.pathname.startsWith("/api/v1/templates/tpl-static/builds/") && init.method === "POST") {
            return jsonResponse(202, {});
          }
          if (url.pathname.startsWith("/api/v1/templates/tpl-static/builds/") && url.pathname.endsWith("/status")) {
            return jsonResponse(200, {
              buildID: "build-1",
              templateID: "tpl-static",
              status: "ready",
              logs: [],
              logEntries: [],
            });
          }
          if (url.pathname === "/api/v1/templates/tpl-static" && init.method === "GET") {
            return jsonResponse(200, {
              templateID: "tpl-static",
              buildStatus: "ready",
              public: false,
              aliases: [],
              names: ["demo"],
            });
          }
          if (url.pathname.startsWith("/api/v1/templates/tpl-static/builds/") && init.method === "GET") {
            return jsonResponse(200, {
              buildID: "build-1",
              templateID: "tpl-static",
              status: "ready",
              image: "demo:v1",
            });
          }
          if (url.pathname === "/api/v1/templates" && init.method === "GET") {
            return jsonResponse(200, [{
              templateID: "tpl-static",
              buildStatus: "ready",
              public: false,
              aliases: [],
              names: ["demo"],
            }]);
          }
          if (url.pathname === "/api/v1/templates/resolve/demo" && init.method === "GET") {
            return jsonResponse(200, { templateID: "tpl-static", public: false });
          }
          if (url.pathname === "/api/v1/templates/tpl-static" && init.method === "DELETE") {
            return new Response(null, { status: 204 });
          }
          throw new Error(`unexpected request: ${String(input)} ${init.method}`);
        },
      },
    );

    const listed = await Template.list({
      fetch: async (input, init) => {
        const url = new URL(String(input));
        calls.push({ path: url.pathname, method: init.method, query: url.search });
        return jsonResponse(200, [{
          templateID: "tpl-static",
          buildStatus: "ready",
          public: false,
          aliases: [],
          names: ["demo"],
        }]);
      },
    });

    const detail = await Template.get("demo", {
      fetch: async (input, init) => {
        const url = new URL(String(input));
        calls.push({ path: url.pathname, method: init.method, query: url.search });
        if (url.pathname === "/api/v1/templates/resolve/demo") {
          return jsonResponse(200, { templateID: "tpl-static", public: false });
        }
        return jsonResponse(200, {
          templateID: "tpl-static",
          buildStatus: "ready",
          public: false,
          aliases: [],
          names: ["demo"],
        });
      },
    });

    const exists = await Template.exists("demo", {
      fetch: async (input) => {
        const url = new URL(String(input));
        calls.push({ path: url.pathname, method: "GET", query: url.search });
        return jsonResponse(200, { templateID: "tpl-static", public: false });
      },
    });

    await Template.delete("demo", {
      fetch: async (input, init) => {
        const url = new URL(String(input));
        calls.push({ path: url.pathname, method: init.method, query: url.search });
        if (url.pathname === "/api/v1/templates/resolve/demo") {
          return jsonResponse(200, { templateID: "tpl-static", public: false });
        }
        return new Response(null, { status: 204 });
      },
    });

    const status = await Template.getBuildStatus(
      { templateId: "tpl-static", buildId: "build-1" },
      {
        pollIntervalMs: 1,
        logsOffset: 0,
        limit: 100,
        level: "info",
        fetch: async (input, init) => {
          const url = new URL(String(input));
          calls.push({ path: url.pathname, method: init.method, query: url.search });
          return jsonResponse(200, {
            buildID: "build-1",
            templateID: "tpl-static",
            status: "ready",
            logs: [],
            logEntries: [],
          });
        },
      },
    );

    assert.equal(built.templateId, "tpl-static");
    assert.equal(listed.length, 1);
    assert.equal(detail.templateID, "tpl-static");
    assert.equal(exists, true);
    assert.equal(status.status, "ready");
    assert.equal(status.templateId, "tpl-static");
    assert.equal(status.buildId, "build-1");
    assert.equal(status.templateId, "tpl-static");
    assert.equal(status.buildId, "build-1");
  } finally {
    if (previousDomain === undefined) {
      delete process.env.SEACLOUD_BASE_URL;
    } else {
      process.env.SEACLOUD_BASE_URL = previousDomain;
    }
    if (previousAPIKey === undefined) {
      delete process.env.SEACLOUD_API_KEY;
    } else {
      process.env.SEACLOUD_API_KEY = previousAPIKey;
    }
  }
});

test("unit: Template tag helpers use build tag endpoints", async () => {
  const previousDomain = process.env.SEACLOUD_BASE_URL;
  const previousAPIKey = process.env.SEACLOUD_API_KEY;
  process.env.SEACLOUD_BASE_URL = "https://sandbox-gateway.cloud.seaart.ai";
  process.env.SEACLOUD_API_KEY = "unit-auth-value";
  const calls = [];
  const fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({ path: url.pathname, method: init.method, body: init.body ? JSON.parse(init.body) : undefined });
    if (url.pathname === "/api/v1/templates/resolve/demo" && init.method === "GET") {
      return jsonResponse(200, { templateID: "tpl-tags", public: false });
    }
    if (url.pathname === "/api/v1/templates/tags" && init.method === "POST") {
      return jsonResponse(201, { buildID: "build-1", tags: ["v1", "stable", "prod"] });
    }
    if (url.pathname === "/api/v1/templates/tpl-tags/tags" && init.method === "GET") {
      return jsonResponse(200, [
        { buildID: "build-1", createdAt: "2026-01-01T00:01:00Z", tag: "v1" },
        { buildID: "build-1", createdAt: "2026-01-01T00:01:00Z", tag: "stable" },
      ]);
    }
    if (url.pathname === "/api/v1/templates/tags" && init.method === "DELETE") {
      return new Response(null, { status: 204 });
    }
    throw new Error(`unexpected request: ${String(input)} ${init.method}`);
  };

  try {
    const assigned = await Template.assignTags("demo:v1", ["stable", "prod"], { fetch });
    const tags = await Template.getTags("tpl-tags", { fetch });
    await Template.removeTags("demo", "stable", { fetch });

    assert.deepEqual(assigned, { buildId: "build-1", tags: ["v1", "stable", "prod"] });
    assert.deepEqual(tags, [
      { buildId: "build-1", createdAt: new Date("2026-01-01T00:01:00Z"), tag: "v1" },
      { buildId: "build-1", createdAt: new Date("2026-01-01T00:01:00Z"), tag: "stable" },
    ]);
    assert.deepEqual(calls.filter((call) => call.path === "/api/v1/templates/tags").map((call) => call.method), ["POST", "DELETE"]);
  } finally {
    if (previousDomain === undefined) {
      delete process.env.SEACLOUD_BASE_URL;
    } else {
      process.env.SEACLOUD_BASE_URL = previousDomain;
    }
    if (previousAPIKey === undefined) {
      delete process.env.SEACLOUD_API_KEY;
    } else {
      process.env.SEACLOUD_API_KEY = previousAPIKey;
    }
  }
});

test("unit: client.buildTemplate forwards high-level build options and dedupes tags", async () => {
  const client = createGatewayClient(async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/v1/templates" && init.method === "POST") {
      assert.deepEqual(JSON.parse(init.body), {
        name: "demo",
        tags: ["v1", "latest"],
        cpuCount: 2,
        memoryMB: 1024,
        extensions: {
          baseTemplateID: "tpl-base-1",
          envs: { NODE_ENV: "production" },
          volumeMounts: [{ name: "workspace", path: "/agent-workspace", storageType: "nfs", nfsHostPath: "/mnt/prod-sandbox-nfs-filesystem01" }],
          workdir: "/agent-workspace",
        },
      });
      return jsonResponse(202, {
        templateID: "tpl-options",
        buildID: "server-build-id",
        public: false,
        names: ["demo"],
        tags: ["v1", "latest"],
        aliases: [],
      });
    }
    if (url.pathname.startsWith("/api/v1/templates/tpl-options/builds/") && init.method === "POST") {
      return jsonResponse(202, {});
    }
    if (url.pathname.startsWith("/api/v1/templates/tpl-options/builds/") && url.pathname.endsWith("/status")) {
      assert.equal(url.searchParams.get("logsOffset"), "0");
      assert.equal(url.searchParams.get("limit"), "100");
      return jsonResponse(200, {
        buildID: "build-x",
        templateID: "tpl-options",
        status: "ready",
        logs: [],
        logEntries: [],
      });
    }
    if (url.pathname === "/api/v1/templates/tpl-options" && init.method === "GET") {
      return jsonResponse(200, {
        templateID: "tpl-options",
        buildID: "build-x",
        buildStatus: "ready",
        public: false,
        aliases: [],
        names: ["demo"],
      });
    }
    if (url.pathname.startsWith("/api/v1/templates/tpl-options/builds/") && init.method === "GET") {
      return jsonResponse(200, {
        buildID: "build-x",
        templateID: "tpl-options",
        status: "ready",
        image: "demo:v1",
      });
    }
    throw new Error(`unexpected request: ${String(input)} ${init.method}`);
  });

  const built = await client.buildTemplate(
    new Template().fromImage("docker.io/library/node:20"),
    {
      name: "demo:v1",
      tags: ["v1", "latest"],
      cpuCount: 2,
      memoryMB: 1024,
      baseTemplateID: "tpl-base-1",
      envs: { NODE_ENV: "production" },
      volumeMounts: [{ name: "workspace", path: "/agent-workspace", storageType: "nfs", nfsHostPath: "/mnt/prod-sandbox-nfs-filesystem01" }],
      workdir: "/agent-workspace",
      pollIntervalMs: 1,
    },
  );

  assert.equal(built.templateId, "tpl-options");
  assert.deepEqual(built.tags, ["v1", "latest"]);
  assert.equal(typeof built.buildId, "string");
});

test("unit: client template management helpers match E2B-style APIs", async () => {
  const calls = [];
  const client = createGatewayClient(async (input, init) => {
        const url = new URL(String(input));
        calls.push({ path: url.pathname, method: init.method, body: init.body });
        if (url.pathname === "/api/v1/templates/resolve/demo" && init.method === "GET") {
          return jsonResponse(200, { templateID: "tpl-1", public: false });
        }
        if (url.pathname === "/api/v1/templates/tpl-1" && init.method === "GET") {
          return jsonResponse(200, { templateID: "tpl-1", buildStatus: "ready", public: false, aliases: [], names: ["demo"] });
        }
        if (url.pathname === "/api/v1/templates/tpl-1/builds/build-1/status" && init.method === "GET") {
          return jsonResponse(200, { buildID: "build-1", templateID: "tpl-1", status: "ready", logs: [], logEntries: [] });
        }
        throw new Error(`unexpected request: ${String(input)} ${init.method}`);
      });
  const status = await client.getTemplateBuildStatus({ templateId: "tpl-1", buildId: "build-1" });
  const exists = await client.templateExists("demo");
  assert.equal(status.status, "ready");
  assert.equal(exists, true);
  assert.equal(calls[0].path, "/api/v1/templates/tpl-1/builds/build-1/status");
});

test("unit: client template helpers handle existence and build-status option forwarding", async () => {
  const buildStatusCalls = [];
  const missingClient = createGatewayClient(async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/v1/templates/resolve/missing" && init.method === "GET") {
      return jsonResponse(404, { error: { message: "not found" } });
    }
    throw new Error(`unexpected request: ${String(input)} ${init.method}`);
  });
  const errorClient = createGatewayClient(async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/v1/templates/resolve/broken" && init.method === "GET") {
      return jsonResponse(500, { error: { message: "boom" } });
    }
    if (url.pathname === "/api/v1/templates/tpl-direct/builds/build-2/status" && init.method === "GET") {
      buildStatusCalls.push(url.search);
      assert.equal(url.searchParams.get("logsOffset"), "0");
      assert.equal(url.searchParams.get("limit"), "100");
      assert.equal(url.searchParams.get("level"), "info");
      return jsonResponse(200, {
        buildID: "build-2",
        templateID: "tpl-direct",
        status: "ready",
        logs: [],
        logEntries: [],
      });
    }
    throw new Error(`unexpected request: ${String(input)} ${init.method}`);
  });

  assert.equal(await missingClient.templateExists("missing"), false);
  await assert.rejects(errorClient.templateExists("broken"), APIError);
  await assert.rejects(errorClient.getTemplateBuildStatus({ templateId: " ", buildId: "build-2" }), ValidationError);

  const status = await errorClient.getTemplateBuildStatus(
    { templateId: "tpl-direct", buildId: "build-2" },
    { logsOffset: 0, limit: 100, level: "info" },
  );

  assert.equal(status.status, "ready");
  assert.equal(status.templateId, "tpl-direct");
  assert.equal(status.buildId, "build-2");
  assert.equal(buildStatusCalls.length, 1);
});

test("unit: client list/get/delete template helpers forward facade options", async () => {
  const calls = [];
  const client = createGatewayClient(async (input, init) => {
    const url = new URL(String(input));
    calls.push({ path: url.pathname, search: url.search, method: init.method });
    if (url.pathname === "/api/v1/templates" && init.method === "GET") {
      assert.equal(url.searchParams.get("visibility"), "team");
      assert.equal(url.searchParams.has("teamID"), false);
      assert.equal(url.searchParams.get("limit"), "20");
      assert.equal(url.searchParams.get("offset"), "40");
      return jsonResponse(200, [{ templateID: "tpl-direct" }]);
    }
    if (url.pathname === "/api/v1/templates/tpl-direct" && init.method === "GET") {
      assert.equal(url.searchParams.get("limit"), "10");
      assert.equal(url.searchParams.get("nextToken"), "build-1");
      return jsonResponse(200, { templateID: "tpl-direct", buildStatus: "ready", public: false, aliases: [], names: ["demo"] });
    }
    if (url.pathname === "/api/v1/templates/resolve/demo" && init.method === "GET") {
      return jsonResponse(200, { templateID: "tpl-delete", public: false });
    }
    if (url.pathname === "/api/v1/templates/tpl-delete" && init.method === "DELETE") {
      return new Response(null, { status: 204 });
    }
    throw new Error(`unexpected request: ${String(input)} ${init.method}`);
  });

  const listed = await client.listTemplates({ visibility: "team", limit: 20, offset: 40 });
  const detail = await client.getTemplate("tpl-direct", { limit: 10, nextToken: "build-1" });
  await client.deleteTemplate("demo");

  assert.equal(listed.length, 1);
  assert.equal(detail.templateID, "tpl-direct");
  assert.equal(calls.some((call) => call.path === "/api/v1/templates/resolve/tpl-direct"), false);
});

test("unit: template builder includes E2B-style helper steps", () => {
  const request = new Template()
    .aptInstall(["git", "curl"], { noInstallRecommends: true })
    .gitClone("https://github.com/acme/repo.git", "/app/repo", {
      branch: "main",
      depth: 1,
      user: "root",
    })
    .makeDir(["/app/logs", "/app/cache"], { mode: 0o755, user: "root" })
    .makeSymlink("/usr/bin/python3", "/usr/bin/python", { force: true })
    .npmInstall(["tsx"], { g: true })
    .pipInstall("numpy", { g: false })
    .bunInstall(["prettier"], { dev: true })
    .setWorkdir("/app/repo")
    .setUser("root")
    .request();

  assert.equal(request.steps.length, 10);
  assert.match(request.steps[0].args[0], /apt-get/);
  assert.match(request.steps[0].args[0], /--no-install-recommends/);
  assert.match(request.steps[1].args[0], /git/);
  assert.match(request.steps[1].args[0], /--branch/);
  assert.match(request.steps[2].args[0], /mkdir/);
  assert.match(request.steps[3].args[0], /mkdir/);
  assert.match(request.steps[4].args[0], /ln/);
  assert.match(request.steps[5].args[0], /npm/);
  assert.match(request.steps[6].args[0], /pip/);
  assert.match(request.steps[7].args[0], /bun/);
  assert.deepEqual(request.steps[8], { type: "WORKDIR", args: ["/app/repo"], force: undefined });
  assert.deepEqual(request.steps[9], { type: "USER", args: ["root"], force: undefined });
});

test("unit: template builder supports skipCache, copyItems, remove, and rename", () => {
  const request = new Template()
    .skipCache()
    .copyItems([{ src: "package.json", dest: "/app/", filesHash: "a".repeat(64), user: "app" }])
    .remove("/tmp/cache", { recursive: true, force: true, user: "root" })
    .rename("/tmp/old.txt", "/tmp/new.txt", { user: "root" })
    .request();

  assert.equal(request.steps.length, 4);
  assert.equal(request.steps[0].type, "COPY");
  assert.equal(request.steps[0].force, true);
  assert.match(request.steps[1].args[0], /chown/);
  assert.match(request.steps[1].args[0], /app/);
  assert.equal(request.steps[1].force, true);
  assert.match(request.steps[2].args[0], /rm/);
  assert.equal(request.steps[2].force, true);
  assert.match(request.steps[3].args[0], /mv/);
  assert.equal(request.steps[3].force, true);
});

test("unit: template builder supports runCmd user and COPY tar options", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "sandbox-node-copy-options-"));
  const source = path.join(root, "hello.txt");
  const link = path.join(root, "hello-link.txt");
  await writeFile(source, "hello copy\n");
  await symlink(source, link);

  const runRequest = new Template()
    .runCmd("apt-get install vim", { user: "root" })
    .request();
  const defaultRequest = JSON.parse(await Template.toJSON(
    new Template().fromBaseImage().copy(link, "/app/"),
  ));
  const modeRequest = JSON.parse(await Template.toJSON(
    new Template().fromBaseImage().copy(link, "/app/", { mode: 0o600 }),
  ));
  const resolvedRequest = JSON.parse(await Template.toJSON(
    new Template().fromBaseImage().copy(link, "/app/", { resolveSymlinks: true }),
  ));

  assert.match(runRequest.steps[0].args[0], /su -s \/bin\/sh/);
  assert.notEqual(defaultRequest.steps[0].filesHash, modeRequest.steps[0].filesHash);
  assert.notEqual(defaultRequest.steps[0].filesHash, resolvedRequest.steps[0].filesHash);
});

test("unit: Template image helpers and serialization align with E2B-style APIs", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "sandbox-node-json-"));
  const source = path.join(root, "hello.txt");
  await writeFile(source, "hello copy\n");

  const template = new Template()
    .fromNodeImage("24")
    .copy(source, "/app/")
    .setEnvs({ NODE_ENV: "production" })
    .setStartCmd("node server.js", waitForPort(3000));

  const jsonText = await Template.toJSON(template);
  const request = JSON.parse(jsonText);
  const dockerfile = Template.toDockerfile(
    new Template()
      .fromPythonImage("3.12")
      .runCmd("pip install numpy")
      .setWorkdir("/app")
      .setUser("root"),
  );

  assert.equal(request.fromImage, "node:24");
  assert.match(request.steps[0].filesHash, /^[a-f0-9]{64}$/);
  assert.equal(request.startCmd, "node server.js");
  assert.match(dockerfile, /^FROM python:3\.12/m);
  assert.match(dockerfile, /^RUN \["sh", "-lc", "pip install numpy"\]/m);
  assert.match(dockerfile, /^WORKDIR \/app/m);
  assert.match(dockerfile, /^USER root/m);

  const registryRequest = new Template()
    .fromImage("example.com/acme/app:latest", { username: "robot", password: "secret" })
    .request();
  assert.equal(registryRequest.fromImageRegistry.type, "registry");

  const awsRequest = new Template()
    .fromAWSRegistry("123.dkr.ecr.us-west-2.amazonaws.com/app:latest", {
      accessKeyId: "AKIA",
      secretAccessKey: "secret",
      region: "us-west-2",
    })
    .request();
  assert.equal(awsRequest.fromImageRegistry.type, "aws");

  const gcpRequest = new Template()
    .fromGCPRegistry("gcr.io/acme/app:latest", {
      serviceAccountJSON: { project_id: "acme" },
    })
    .request();
  assert.equal(gcpRequest.fromImageRegistry.type, "gcp");
});

test("unit: Template.toDockerfile JSON-escapes multiline RUN commands", () => {
  const dockerfile = Template.toDockerfile(
    new Template()
      .fromImage("alpine:3.20")
      .runCmd('printf "hello\n" > /tmp/hello.txt'),
  );

  assert.match(dockerfile, /^RUN \["sh", "-lc", "printf \\"hello\\n\\" > \/tmp\/hello\.txt"\]/m);
  assert.equal(dockerfile.includes('\n" > /tmp/hello.txt'), false);
});

test("unit: template builder parses Dockerfiles from inline content and file paths", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "sandbox-node-dockerfile-"));
  const source = path.join(root, "package.json");
  const dockerfilePath = path.join(root, "Dockerfile");
  await writeFile(source, '{"name":"demo"}\n');
  await writeFile(dockerfilePath, "FROM node:20\nCOPY package.json /app/\nCMD [\"node\", \"server.js\"]\n");

  const inlineRequest = new Template()
    .fromDockerfile([
      "FROM python:3.12",
      "ENV APP_ENV=prod LOG_LEVEL=debug",
      "RUN pip install numpy",
      "WORKDIR /app",
      "USER root",
      "CMD [\"python\", \"app.py\"]",
    ].join("\n"))
    .request();
  const fileRequest = JSON.parse(await Template.toJSON(new Template().fromDockerfile(dockerfilePath)));

  assert.equal(inlineRequest.fromImage, "python:3.12");
  assert.deepEqual(inlineRequest.steps[0], { type: "ENV", args: ["APP_ENV", "prod"] });
  assert.deepEqual(inlineRequest.steps[1], { type: "ENV", args: ["LOG_LEVEL", "debug"] });
  assert.match(inlineRequest.steps[2].args[0], /pip install numpy/);
  assert.deepEqual(inlineRequest.steps[3], { type: "WORKDIR", args: ["/app"], force: undefined });
  assert.deepEqual(inlineRequest.steps[4], { type: "USER", args: ["root"], force: undefined });
  assert.equal(inlineRequest.startCmd, "'python' 'app.py'");
  assert.equal(fileRequest.fromImage, "node:20");
  assert.equal(fileRequest.steps[0].type, "COPY");
  assert.match(fileRequest.steps[0].filesHash, /^[a-f0-9]{64}$/);
  assert.equal(fileRequest.startCmd, "'node' 'server.js'");
});

test("unit: template builder rejects unsupported Dockerfile instructions", () => {
  assert.throws(
    () => new Template().fromDockerfile("FROM node:20\nENTRYPOINT [\"node\"]\n"),
    /unsupported Dockerfile instruction: ENTRYPOINT/,
  );
});

test("unit: client.buildTemplate auto-uploads local COPY sources", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "sandbox-node-copy-"));
  const source = path.join(root, "hello.txt");
  await writeFile(source, "hello copy\n");

  const uploads = [];
  let copiedStep;
  const client = createGatewayClient(async (input, init) => {
        if (String(input).startsWith("https://upload.example/")) {
          uploads.push({
            url: String(input),
            method: init.method,
            headers: init.headers,
            body: new Uint8Array(await new Response(init.body).arrayBuffer()),
          });
          return new Response(null, { status: 200 });
        }

        const url = new URL(String(input));
        if (url.pathname === "/api/v1/templates" && init.method === "POST") {
          return jsonResponse(202, { templateID: "tpl-copy", buildID: "build-copy", names: ["demo"], tags: ["auto-copy"], aliases: [], public: false });
        }
        if (url.pathname.includes("/files/") && init.method === "GET") {
          return jsonResponse(200, { present: false, url: `https://upload.example${url.pathname}`, maxContextBytes: 104857600 });
        }
        if (url.pathname.startsWith("/api/v1/templates/tpl-copy/builds/") && init.method === "POST") {
          const body = JSON.parse(init.body);
          copiedStep = body.steps;
          assert.match(body.steps[0].filesHash, /^[a-f0-9]{64}$/);
          return jsonResponse(202, {});
        }
        if (url.pathname.startsWith("/api/v1/templates/tpl-copy/builds/") && url.pathname.endsWith("/status")) {
          return jsonResponse(200, { buildID: "build-copy", templateID: "tpl-copy", status: "ready", logs: [], logEntries: [] });
        }
        if (url.pathname === "/api/v1/templates/tpl-copy" && init.method === "GET") {
          return jsonResponse(200, { templateID: "tpl-copy", buildStatus: "ready", public: false, aliases: [], names: ["demo"] });
        }
        if (url.pathname.startsWith("/api/v1/templates/tpl-copy/builds/") && init.method === "GET") {
          return jsonResponse(200, { buildID: "build-copy", templateID: "tpl-copy", status: "ready" });
        }
        throw new Error(`unexpected request: ${String(input)} ${init.method}`);
      });
  await client.buildTemplate(
    new Template()
      .fromImage("docker.io/library/alpine:3.20")
      .copy(source, "/app/", { user: "app" }),
    "demo:auto-copy",
    { pollIntervalMs: 1 },
  );

  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].method, "PUT");
  assert.equal(uploads[0].headers["Content-Type"], "application/x-tar");
  assert.equal(uploads[0].headers["x-goog-content-length-range"], "0,104857600");
  assert.equal(uploads[0].body[0], 0x1f);
  assert.equal(uploads[0].body[1], 0x8b);
  assert.equal(copiedStep[0].args[1], "/app/");
  assert.equal(copiedStep[0].args[0], "hello.txt");
  assert.equal(copiedStep[1].type, "RUN");
  assert.match(copiedStep[1].args[0], /chown/);
  assert.match(copiedStep[1].args[0], /app/);
});

test("unit: filesystem helper supports writeFiles batch helper", async () => {
  const client = createGatewayClient(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/v1/sandboxes") {
        return jsonResponse(201, {
          sandboxID: "sb-files",
          templateID: "base",
          envdUrl: "https://runtime.cloud.seaart.ai/sb-files",
          envdAccessToken: "unit-runtime-auth",
          status: "running",
          state: "running",
        });
      }
      if (url.pathname === "/sb-files/files/batch") {
        return jsonResponse(200, {
          files: [
            { path: "/tmp/a.txt", bytes_written: 1 },
            { path: "/tmp/b.txt", bytes_written: 2 },
          ],
        });
      }
      throw new Error(`unexpected request: ${String(input)} ${init.method}`);
    });
  const sandbox = await client.create("base");

  const written = await sandbox.files.writeFiles([
    { path: "/tmp/a.txt", content: "a" },
    { path: "/tmp/b.txt", content: "bb" },
  ]);

  assert.deepEqual(written, [
    { name: "a.txt", path: "/tmp/a.txt", type: "file" },
    { name: "b.txt", path: "/tmp/b.txt", type: "file" },
  ]);
});

test("unit: command and pty handles encode stdin and decode streamed output", async () => {
  const inputCalls = [];
  const client = createGatewayClient(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/v1/sandboxes") {
        return jsonResponse(201, {
          sandboxID: "sb-handle",
          templateID: "base",
          envdUrl: "https://runtime.cloud.seaart.ai/sb-handle",
          envdAccessToken: "unit-runtime-auth",
          status: "running",
          state: "running",
        });
      }
      if (url.pathname === "/sb-handle/process.Process/Start") {
        const request = JSON.parse(init.body);
        const cmd = request.process.cmd;
        const stream = new ReadableStream({
          start(controller) {
            if (cmd === "cat") {
              controller.enqueue(connectFrame({ event: { start: { pid: 41, cmdId: "cmd-bg" } } }));
              controller.enqueue(connectFrame({ event: { data: { stdout: Buffer.from("live\n").toString("base64") } } }));
              controller.enqueue(connectFrame({ event: { end: { exited: true, status: "exited", error: null } } }));
            } else {
              controller.enqueue(connectFrame({ event: { start: { pid: 42, cmdId: "cmd-pty" } } }));
              controller.enqueue(connectFrame({ event: { data: { stdout: Buffer.from("shell$ ").toString("base64") } } }));
              controller.enqueue(connectFrame({ event: { end: { exited: true, status: "exited", error: null } } }));
            }
            controller.close();
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { "content-type": "application/connect+json" },
        });
      }
      if (url.pathname === "/sb-handle/process.Process/SendInput") {
        inputCalls.push(JSON.parse(init.body));
        return jsonResponse(200, {});
      }
      if (url.pathname === "/sb-handle/process.Process/Connect") {
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(connectFrame({ event: { start: { pid: 41, cmdId: "cmd-bg" } } }));
            controller.enqueue(connectFrame({ event: { data: { stdout: Buffer.from("connected\n").toString("base64") } } }));
            controller.enqueue(connectFrame({ event: { end: { exited: true, status: "exited", error: null } } }));
            controller.close();
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { "content-type": "application/connect+json" },
        });
      }
      if (url.pathname === "/sb-handle/process.Process/GetResult") {
        const request = JSON.parse(init.body);
        if (request.cmdId === "cmd-bg") {
          return jsonResponse(200, { exitCode: 0, stdout: "ping\n", stderr: "", startedAtUnix: 1 });
        }
        return jsonResponse(200, { exitCode: 0, stdout: "", stderr: "", startedAtUnix: 1 });
      }
      throw new Error(`unexpected request: ${String(input)} ${init.method}`);
    });
  const sandbox = await client.create("base");

  const handle = await sandbox.commands.run("cat", { background: true });
  await handle.sendStdin("ping\n");
  const waited = await handle.wait();
  const stdoutChunks = [];
  const streamed = await sandbox.commands.run("cat", {
    stdin: false,
    onStdout: (chunk) => stdoutChunks.push(chunk),
  });
  const connectChunks = [];
  const connected = await sandbox.commands.connect(41, {
    onStdout: (chunk) => connectChunks.push(chunk),
  });
  await connected.wait();

  const ptyHandle = await sandbox.pty.create("bash");
  await ptyHandle.sendInput("ls\n");
  const ptyWaited = await ptyHandle.wait();

  assert.equal(waited.stdout, "ping\n");
  assert.equal(streamed.stdout, "ping\n");
  assert.deepEqual(stdoutChunks, ["live\n"]);
  assert.deepEqual(connectChunks, ["connected\n"]);
  assert.equal(ptyWaited.pty, "shell$ ");
  assert.deepEqual(inputCalls, [
    { process: { pid: 41 }, input: { stdin: Buffer.from("ping\n").toString("base64") } },
    { process: { pid: 42 }, input: { pty: Buffer.from("ls\n").toString("base64") } },
  ]);
});

test("unit: commands and pty accept timeout and user options", async () => {
  const runCalls = [];
  const startCalls = [];
  const client = createGatewayClient(async (input, init = {}) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/v1/sandboxes") {
        return jsonResponse(201, {
          sandboxID: "sb-user",
          templateID: "base",
          envdUrl: "https://runtime.cloud.seaart.ai/sb-user",
          envdAccessToken: "unit-runtime-auth",
          status: "running",
          state: "running",
        });
      }
      if (url.pathname === "/sb-user/run") {
        runCalls.push(JSON.parse(init.body));
        return jsonResponse(200, { stdout: "ok\n", stderr: "", exit_code: 0, duration_ms: 1 });
      }
      if (url.pathname === "/sb-user/process.Process/Start") {
        startCalls.push(JSON.parse(init.body));
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(connectFrame({ event: { start: { pid: 99 } } }));
            controller.close();
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { "content-type": "application/connect+json" },
        });
      }
      throw new Error(`unexpected request: ${String(input)} ${init.method}`);
    });
  const sandbox = await client.create("base");

  await sandbox.commands.run("echo", { args: ["hello"], timeoutMs: 2000, user: "app" });
  await sandbox.pty.create("bash", { timeoutMs: 3000, user: "root" });

  assert.equal(runCalls[0].timeoutMs, 2000);
  assert.equal(runCalls[0].cmd, "sh");
  assert.match(runCalls[0].args[1], /su -s \/bin\/sh 'app'/);
  assert.equal(startCalls[0].timeoutMs, 3000);
  assert.equal(startCalls[0].process.cmd, "sh");
  assert.match(startCalls[0].process.args[1], /su -s \/bin\/sh 'root'/);
});

test("unit: pause returns boolean and sandbox timeout uses seconds", async () => {
  const calls = [];
  const fetchImpl = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/v1/sandboxes/sb-pause" && init.method === "GET") {
      return jsonResponse(200, {
        templateID: "base",
        sandboxID: "sb-pause",
        envdUrl: "https://runtime.cloud.seaart.ai/sb-pause",
        envdAccessToken: "unit-runtime-auth",
        status: "running",
        state: "running",
      });
    }
    if (url.pathname === "/api/v1/sandboxes/sb-pause/pause" && init.method === "POST") {
      calls.push({ path: url.pathname, method: init.method });
      return new Response(null, { status: 204 });
    }
    if (url.pathname === "/api/v1/sandboxes" && init.method === "POST") {
      return jsonResponse(201, {
        templateID: "base",
        sandboxID: "sb-pause",
        envdUrl: "https://runtime.cloud.seaart.ai/sb-pause",
        envdAccessToken: "unit-runtime-auth",
        status: "running",
        state: "running",
      });
    }
    if (url.pathname === "/sb-pause/run") {
      calls.push({ path: url.pathname, method: init.method, body: JSON.parse(init.body) });
      return jsonResponse(200, { stdout: "ok\n", stderr: "", exit_code: 0, duration_ms: 1 });
    }
    if (url.pathname === "/sb-pause/process.Process/Start") {
      calls.push({ path: url.pathname, method: init.method, body: JSON.parse(init.body) });
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(connectFrame({ event: { start: { pid: 1 } } }));
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "content-type": "application/connect+json" },
      });
    }
    if (url.pathname === "/api/v1/sandboxes/sb-pause/timeout" && init.method === "POST") {
      calls.push({ path: url.pathname, method: init.method, body: JSON.parse(init.body) });
      return new Response(null, { status: 204 });
    }
    throw new Error(`unexpected request: ${String(input)} ${init.method}`);
  };
  const client = createGatewayClient(fetchImpl);
  const previousDomain = process.env.SEACLOUD_BASE_URL;
  const previousAPIKey = process.env.SEACLOUD_API_KEY;
  process.env.SEACLOUD_BASE_URL = "https://sandbox-gateway.cloud.seaart.ai";
  process.env.SEACLOUD_API_KEY = "unit-auth-value";

  try {
    assert.equal(await Sandbox.pause("sb-pause", { fetch: fetchImpl }), true);
    const sandbox = await client.create("base");
    assert.equal(await sandbox.pause(), true);
    assert.equal(await sandbox.pause(), false);

    await sandbox.commands.run("echo", { timeoutMs: 1500 });
    await sandbox.pty.create("bash", { timeoutMs: 2500 });
    await sandbox.setTimeout(1500);

    assert.equal(calls.find((call) => call.path === "/sb-pause/run")?.body.timeoutMs, 1500);
    assert.equal(calls.find((call) => call.path === "/sb-pause/process.Process/Start")?.body.timeoutMs, 2500);
    assert.equal(calls.find((call) => call.path === "/api/v1/sandboxes/sb-pause/timeout")?.body.timeout, 1500);
  } finally {
    process.env.SEACLOUD_BASE_URL = previousDomain;
    process.env.SEACLOUD_API_KEY = previousAPIKey;
  }
});

function connectFrame(payload) {
  const json = Buffer.from(JSON.stringify(payload));
  const header = Buffer.alloc(5);
  header.writeUInt8(0, 0);
  header.writeUInt32BE(json.length, 1);
  return new Uint8Array(Buffer.concat([header, json]));
}

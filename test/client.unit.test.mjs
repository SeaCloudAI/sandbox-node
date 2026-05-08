import assert from "node:assert/strict";
import test from "node:test";

import { SandboxClient, Template } from "../dist/index.js";
import {
  APIError,
  NotFoundError,
  RequestTimeoutError,
  ValidationError,
} from "../dist/core/index.js";

function createClient(handler) {
  return new SandboxClient({
    baseUrl: "https://sandbox-gateway.cloud.seaart.ai",
    apiKey: "unit-auth-value",
    fetch: handler,
  });
}

function createTenantClient(handler) {
  return new SandboxClient({
    baseUrl: "https://sandbox-gateway.cloud.seaart.ai",
    apiKey: "unit-auth-value",
    projectId: "project-1",
    fetch: handler,
  });
}

function createCmdService(handler) {
  return createClient(async () => jsonResponse(200, {})).cmd({
    baseUrl: "https://sandbox-gateway.cloud.seaart.ai",
    accessToken: "unit-runtime-auth",
    fetch: handler,
  });
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("unit: system endpoints", async (t) => {
  await t.test("metrics returns text", async () => {
    const client = createClient(async () => new Response("metric 1\n", { status: 200 }));
    const response = await client.metrics();
    assert.equal(response, "metric 1\n");
  });

  await t.test("shutdown returns message", async () => {
    const client = createClient(async () => jsonResponse(200, { message: "shutdown initiated" }));
    const response = await client.shutdown();
    assert.equal(response.message, "shutdown initiated");
  });
});

test("unit: sandbox request encoding", async (t) => {
  await t.test("create sandbox sends headers and body", async () => {
    const client = createTenantClient(async (input, init) => {
      assert.equal(String(input), "https://sandbox-gateway.cloud.seaart.ai/api/v1/sandboxes");
      assert.equal(init.method, "POST");
      const headers = new Headers(init.headers);
      assert.equal(headers.get("Content-Type"), "application/json");
      assert.equal(headers.get("X-Project-ID"), "project-1");
      assert.deepEqual(JSON.parse(init.body), { templateID: "tpl", waitReady: true });
      return jsonResponse(201, {
        sandboxID: "sb-1",
        envdUrl: "https://sandbox-gateway.cloud.seaart.ai",
        envdAccessToken: "unit-runtime-auth",
        activatedAt: "2026-01-01T00:00:05Z",
      });
    });

    const response = await client.createSandbox({ templateID: "tpl", waitReady: true });
    assert.equal(response.sandboxID, "sb-1");
    assert.equal(response.activatedAt, "2026-01-01T00:00:05Z");
    assert.equal(response.runtime.baseUrl, "https://sandbox-gateway.cloud.seaart.ai");
  });

  await t.test("create sandbox allows missing templateID", async () => {
    const client = createTenantClient(async (input, init) => {
      assert.equal(String(input), "https://sandbox-gateway.cloud.seaart.ai/api/v1/sandboxes");
      assert.deepEqual(JSON.parse(init.body), { waitReady: false });
      return jsonResponse(201, { sandboxID: "sb-2" });
    });

    const response = await client.createSandbox({ waitReady: false });
    assert.equal(response.sandboxID, "sb-2");
  });

  await t.test("list sandboxes encodes all query params", async () => {
    const client = createClient(async (input) => {
      const url = new URL(String(input));
      assert.equal(url.pathname, "/api/v1/sandboxes");
      assert.equal(url.searchParams.get("metadata"), "app=prod&team=core");
      assert.deepEqual(url.searchParams.getAll("state"), ["running", "paused"]);
      assert.equal(url.searchParams.get("limit"), "10");
      assert.equal(url.searchParams.get("nextToken"), "MQ");
      return jsonResponse(200, []);
    });

    const response = await client.listSandboxes({
      metadata: { app: "prod", team: "core" },
      state: ["running", "paused"],
      limit: 10,
      nextToken: "MQ",
    });
    assert.equal(Array.isArray(response), true);
    assert.equal(response.length, 0);
  });

  await t.test("sandbox lifecycle endpoints use expected paths", async () => {
    const calls = [];
    const client = createClient(async (input, init) => {
      calls.push({
        url: String(input),
        method: init.method,
        rawBody: init.body,
        body: typeof init.body === "string" ? JSON.parse(init.body) : null,
      });
      const url = String(input);
      if (url.endsWith("/connect")) {
        return jsonResponse(201, {
          sandboxID: "sb-1",
          envdUrl: "https://sandbox-gateway.cloud.seaart.ai",
          envdAccessToken: "unit-runtime-auth",
        });
      }
      if (url.endsWith("/heartbeat")) {
        return jsonResponse(200, {
          code: 0,
          message: "success",
          data: { received: true, status: "healthy" },
          request_id: "req-1",
        });
      }
      if (url.endsWith("/logs?cursor=0&limit=10&direction=forward&level=info&search=health")) {
        return jsonResponse(200, { logs: [] });
      }
      if (init.method === "DELETE" || url.endsWith("/pause") || url.endsWith("/timeout") || url.endsWith("/refreshes")) {
        return new Response(null, { status: 204 });
      }
      return jsonResponse(200, {
        sandboxID: "sb-1",
        envdUrl: "https://sandbox-gateway.cloud.seaart.ai",
        envdAccessToken: "unit-runtime-auth",
        activatedAt: "2026-01-01T00:00:10Z",
      });
    });

    const detail = await client.getSandbox("sb-1");
    await client.getSandboxLogs("sb-1", {
      cursor: 0,
      limit: 10,
      direction: "forward",
      level: "info",
      search: "health",
    });
    await client.pauseSandbox("sb-1");
    const connected = await client.connectSandbox("sb-1", { timeout: 1200 });
    await client.setSandboxTimeout("sb-1", { timeout: 1200 });
    await client.refreshSandbox("sb-1", { duration: 60 });
    await client.refreshSandbox("sb-1");
    const heartbeat = await client.sendHeartbeat("sb-1", { status: "healthy" });
    await client.deleteSandbox("sb-1");

    assert.equal(connected.statusCode, 201);
    assert.equal(detail.activatedAt, "2026-01-01T00:00:10Z");
    assert.equal(heartbeat.requestId, "req-1");
    assert.equal(calls[0].url, "https://sandbox-gateway.cloud.seaart.ai/api/v1/sandboxes/sb-1");
    assert.equal(calls.at(-1).method, "DELETE");
    assert.equal(connected.sandbox.runtime.accessToken, "unit-runtime-auth");
    assert.equal(calls.find((call) => call.url.endsWith("/pause")).rawBody, undefined);
    assert.deepEqual(calls.find((call) => call.url.endsWith("/refreshes") && call.body)?.body, { duration: 60 });
    assert.equal(
      calls.filter((call) => call.url.endsWith("/refreshes")).find((call) => call.rawBody === undefined).method,
      "POST",
    );
  });

  await t.test("admin control endpoints use expected paths and shapes", async () => {
    const calls = [];
    const client = createClient(async (input, init) => {
      calls.push({ url: String(input), method: init.method, body: init.body ? JSON.parse(init.body) : null });
      const url = new URL(String(input));
      if (url.pathname === "/admin/pool/status") {
        return jsonResponse(200, {
          code: 0,
          data: { total: 10, warm: 2, active: 3, creating: 1, stopped: 1, deleting: 1, deleted: 2, utilization: 0.5 },
          request_id: "req-pool",
        });
      }
      if (url.pathname === "/admin/rolling/start") {
        return jsonResponse(200, {
          code: 0,
          data: { phase: "running", progress: 0.25, warm_total: 4, warm_updated: 1, duration: "10s" },
          request_id: "req-start",
        });
      }
      if (url.pathname === "/admin/rolling/status") {
        return jsonResponse(200, {
          code: 0,
          data: { phase: "running", progress: 0.5, warm_total: 4, warm_updated: 2, duration: "20s" },
          request_id: "req-status",
        });
      }
      if (url.pathname === "/admin/rolling/cancel") {
        return jsonResponse(200, {
          code: 0,
          data: { phase: "cancelled", progress: 0.5, warm_total: 4, warm_updated: 2, duration: "21s" },
          request_id: "req-cancel",
        });
      }
      throw new Error(`unexpected request: ${String(input)} ${init.method}`);
    });

    const pool = await client.getPoolStatus();
    const started = await client.startRollingUpdate({ templateId: "tpl-1" });
    const status = await client.getRollingUpdateStatus();
    const cancelled = await client.cancelRollingUpdate();

    assert.equal(pool.requestId, "req-pool");
    assert.equal(started.requestId, "req-start");
    assert.equal(status.requestId, "req-status");
    assert.equal(cancelled.requestId, "req-cancel");
    assert.deepEqual(calls.map((call) => [new URL(call.url).pathname, call.method]), [
      ["/admin/pool/status", "GET"],
      ["/admin/rolling/start", "POST"],
      ["/admin/rolling/status", "GET"],
      ["/admin/rolling/cancel", "POST"],
    ]);
    assert.deepEqual(calls[1].body, { templateId: "tpl-1" });
    await assert.rejects(client.startRollingUpdate({ templateId: " " }), ValidationError);
  });

  await t.test("build namespace reuses gateway configuration", async () => {
    const client = createTenantClient(async (input, init) => {
      assert.equal(String(input), "https://sandbox-gateway.cloud.seaart.ai/api/v1/templates");
      assert.equal(init.method, "POST");
      const headers = new Headers(init.headers);
      assert.equal(headers.get("X-Project-ID"), "project-1");
      assert.deepEqual(JSON.parse(init.body), {
        name: "demo",
        tags: ["base"],
        cpuCount: 2,
        memoryMB: 1024,
      });
      return jsonResponse(202, { templateID: "tpl-1", buildID: "build-1", names: ["demo"], tags: [], aliases: [], public: false });
    });

    const response = await client.build.createTemplate({
      name: "demo",
      tags: ["base"],
      cpuCount: 2,
      memoryMB: 1024,
    });
    assert.equal(response.templateID, "tpl-1");
  });

  await t.test("runtimeFromSandbox derives envd configuration", async () => {
    const client = createClient(async () => jsonResponse(200, {}));
    const runtime = client.runtimeFromSandbox({
      envdUrl: "https://sandbox-gateway.cloud.seaart.ai",
      envdAccessToken: "unit-runtime-auth",
    });

    assert.equal(runtime.baseUrl, "https://sandbox-gateway.cloud.seaart.ai");
    assert.equal(runtime.accessToken, "unit-runtime-auth");
  });

  await t.test("runtime system requests include access token", async () => {
    const client = createClient(async () => jsonResponse(200, {}));
    const runtime = client.runtime({
      baseUrl: "https://sandbox-gateway.cloud.seaart.ai",
      accessToken: "unit-runtime-auth",
      fetch: async (_input, init) => {
        const headers = new Headers(init.headers);
        assert.equal(headers.get("X-Access-Token"), "unit-runtime-auth");
        return jsonResponse(200, {});
      },
    });

    await runtime.metrics();
  });

  await t.test("bound sandbox helpers reuse original client", async () => {
    const calls = [];
    const client = createClient(async (input, init) => {
      calls.push({ url: String(input), method: init.method });
      if (String(input).endsWith("/api/v1/sandboxes")) {
        return jsonResponse(201, {
          sandboxID: "sb-1",
          envdUrl: "https://sandbox-gateway.cloud.seaart.ai",
          envdAccessToken: "unit-runtime-auth",
        });
      }
      if (String(input).endsWith("/logs")) {
        return jsonResponse(200, { logs: [] });
      }
      return jsonResponse(200, {
        sandboxID: "sb-1",
        envdUrl: "https://sandbox-gateway.cloud.seaart.ai",
        envdAccessToken: "unit-runtime-auth",
      });
    });

    const sandbox = await client.createSandbox({ templateID: "tpl" });
    const detail = await sandbox.reload();
    await sandbox.logs();

    assert.equal(detail.sandboxID, "sb-1");
    assert.equal(calls[1].url, "https://sandbox-gateway.cloud.seaart.ai/api/v1/sandboxes/sb-1");
    assert.equal(calls[2].url, "https://sandbox-gateway.cloud.seaart.ai/api/v1/sandboxes/sb-1/logs");
  });

  await t.test("high-level client create reuses stored gateway config", async () => {
    const calls = [];
    const client = createClient(async (input, init) => {
      calls.push({ url: String(input), method: init.method, body: init.body ? JSON.parse(init.body) : null });
      if (String(input).endsWith("/api/v1/sandboxes")) {
        return jsonResponse(201, {
          sandboxID: "sb-high",
          envdUrl: "https://sandbox-gateway.cloud.seaart.ai",
          envdAccessToken: "unit-runtime-auth",
          status: "running",
        });
      }
      return jsonResponse(200, {
        sandboxID: "sb-high",
        envdUrl: "https://sandbox-gateway.cloud.seaart.ai",
        envdAccessToken: "unit-runtime-auth",
        status: "running",
      });
    });

    const sandbox = await client.create("tpl", { waitReady: true });
    const info = await sandbox.getInfo();

    assert.equal(sandbox.sandboxID, "sb-high");
    assert.equal(typeof sandbox.getHost(3000), "string");
    assert.equal(info.sandboxID, "sb-high");
    assert.deepEqual(calls[0].body, { templateID: "tpl", waitReady: true });
    assert.equal(calls[1].url, "https://sandbox-gateway.cloud.seaart.ai/api/v1/sandboxes/sb-high");
  });

  await t.test("listed sandboxes are returned as bound handles", async () => {
    const calls = [];
    const client = createClient(async (input, init) => {
      calls.push(String(input));
      if (String(input).includes("/logs")) {
        return jsonResponse(200, { logs: [] });
      }
      if (String(input).endsWith("/api/v1/sandboxes")) {
        if (init.method === "GET") {
          return jsonResponse(200, [{ sandboxID: "sb-1", clientID: "u1", envdVersion: "v1", status: "running" }]);
        }
        return jsonResponse(201, {
          sandboxID: "sb-1",
          envdUrl: "https://sandbox-gateway.cloud.seaart.ai",
          envdAccessToken: "unit-runtime-auth",
        });
      }
      return jsonResponse(200, {
        sandboxID: "sb-1",
        envdUrl: "https://sandbox-gateway.cloud.seaart.ai",
        envdAccessToken: "unit-runtime-auth",
      });
    });

    const listed = await client.listSandboxes();
    assert.equal(listed[0].sandboxID, "sb-1");
    const detail = await listed[0].reload();
    await listed[0].logs();
    assert.equal(detail.runtime.baseUrl, "https://sandbox-gateway.cloud.seaart.ai");
    assert.equal(calls[1], "https://sandbox-gateway.cloud.seaart.ai/api/v1/sandboxes/sb-1");
    assert.equal(calls[2], "https://sandbox-gateway.cloud.seaart.ai/api/v1/sandboxes/sb-1/logs");
  });
});

test("unit: validations and errors", async (t) => {
  const client = createClient(async () => jsonResponse(200, {}));

  await t.test("logs validation rejects bad params", async () => {
    await assert.rejects(
      client.getSandboxLogs("sb", { limit: 1001 }),
      ValidationError,
    );
    await assert.rejects(
      client.getSandboxLogs("sb", { direction: "sideways" }),
      ValidationError,
    );
  });

  await t.test("boundary values are accepted for lifecycle and logs params", async () => {
    const calls = [];
    const boundaryClient = createClient(async (input, init) => {
      calls.push({ url: String(input), method: init.method, body: init.body ? JSON.parse(init.body) : null });
      if (String(input).includes("/logs")) {
        return jsonResponse(200, { logs: [] });
      }
      if (String(input).endsWith("/connect")) {
        return jsonResponse(200, { sandboxID: "sb" });
      }
      if (String(input).endsWith("/heartbeat")) {
        return jsonResponse(200, {
          code: 0,
          message: "success",
          data: { received: true, status: "healthy" },
          request_id: "req-boundary",
        });
      }
      return new Response(null, { status: 204 });
    });

    await boundaryClient.getSandboxLogs("sb", {
      cursor: 0,
      limit: 1000,
      direction: "backward",
      search: "x".repeat(256),
    });
    await boundaryClient.connectSandbox("sb", { timeout: 0 });
    await boundaryClient.setSandboxTimeout("sb", { timeout: 86400 });
    await boundaryClient.refreshSandbox("sb", { duration: 0 });
    await boundaryClient.refreshSandbox("sb", { duration: 3600 });
    await boundaryClient.sendHeartbeat("sb", { status: "healthy" });

    assert.equal(calls.length, 6);
    assert.deepEqual(calls.find((call) => call.url.endsWith("/connect"))?.body, { timeout: 0 });
    assert.deepEqual(calls.find((call) => call.url.endsWith("/timeout"))?.body, { timeout: 86400 });
  });

  await t.test("timeout, refresh and heartbeat validations reject bad params", async () => {
    await assert.rejects(
      client.connectSandbox("sb", { timeout: -1 }),
      ValidationError,
    );
    await assert.rejects(
      client.setSandboxTimeout("sb", { timeout: 86401 }),
      ValidationError,
    );
    await assert.rejects(
      client.refreshSandbox("sb", { duration: 3601 }),
      ValidationError,
    );
    await assert.rejects(
      client.sendHeartbeat("sb", { status: "bad" }),
      ValidationError,
    );
  });

  await t.test("empty sandbox ids are rejected across lifecycle helpers", async () => {
    await assert.rejects(client.getSandbox(" "), ValidationError);
    await assert.rejects(client.pauseSandbox(" "), ValidationError);
    await assert.rejects(client.connectSandbox(" ", { timeout: 1 }), ValidationError);
    await assert.rejects(client.setSandboxTimeout(" ", { timeout: 1 }), ValidationError);
    await assert.rejects(client.refreshSandbox(" ", { duration: 1 }), ValidationError);
    await assert.rejects(client.sendHeartbeat(" ", { status: "healthy" }), ValidationError);
  });

  await t.test("api errors are decoded", async () => {
    const errorClient = createClient(async () => new Response(
      JSON.stringify({ code: 404, message: "Not found" }),
      { status: 404, headers: { "content-type": "application/json" } },
    ));

    await assert.rejects(errorClient.getSandbox("sb"), (error) => {
      assert.ok(error instanceof APIError);
      assert.ok(error instanceof NotFoundError);
      assert.equal(error.kind, "not_found");
      assert.equal(error.retryable, false);
      return true;
    });
  });

  await t.test("api errors accept string detail", async () => {
    const errorClient = createClient(async () => jsonResponse(404, { error: "not found" }));

    await assert.rejects(errorClient.getSandbox("sb"), (error) => {
      assert.ok(error instanceof NotFoundError);
      assert.equal(error.message, "not found");
      assert.equal(error.statusCode, 404);
      return true;
    });
  });

  await t.test("request timeout surfaces a typed error", async () => {
    const client = new SandboxClient({
      baseUrl: "https://sandbox-gateway.cloud.seaart.ai",
      apiKey: "unit-auth-value",
      timeoutMs: 1,
      fetch: async (_input, init) => new Promise((_, reject) => {
        init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
      }),
    });

    await assert.rejects(client.metrics(), RequestTimeoutError);
  });
});

test("unit: high-level template helpers on client", async (t) => {
  await t.test("buildTemplate uses stored build service config", async () => {
    const calls = [];
    const client = createTenantClient(async (input, init) => {
      calls.push({
        url: String(input),
        method: init.method,
        body: init.body ? JSON.parse(init.body) : null,
        headers: new Headers(init.headers),
      });
      const url = String(input);
      if (url.endsWith("/api/v1/templates")) {
        return jsonResponse(202, { templateID: "tpl-1", buildID: "build-1", names: ["demo"], tags: [], aliases: [], public: false });
      }
      if (url.includes("/builds/") && init.method === "POST") {
        return jsonResponse(202, { buildID: "build-1", status: "building" });
      }
      if (url.includes("/status")) {
        return jsonResponse(200, { status: "ready", logEntries: [] });
      }
      if (url.includes("/builds/") && init.method === "GET") {
        return jsonResponse(200, { buildID: "build-1", status: "ready" });
      }
      return jsonResponse(200, {
        templateID: "tpl-1",
        names: ["demo"],
        tags: ["v1"],
        aliases: [],
        public: false,
      });
    });

    const template = new Template().fromBaseImage().runCmd("echo hello");
    const built = await client.buildTemplate(template, "demo:v1", { cpuCount: 2 });

    assert.equal(built.templateID, "tpl-1");
    assert.equal(calls[0].url, "https://sandbox-gateway.cloud.seaart.ai/api/v1/templates");
    assert.equal(calls[0].headers.get("X-Project-ID"), "project-1");
    assert.deepEqual(calls[0].body, { name: "demo", tags: ["v1"], cpuCount: 2 });
  });
});

test("unit: cmd sdk", async (t) => {
  await t.test("listDir sets connect headers and basic auth", async () => {
    const cmd = createCmdService(async (input, init) => {
      assert.equal(String(input), "https://sandbox-gateway.cloud.seaart.ai/filesystem.Filesystem/ListDir");
      assert.equal(init.method, "POST");
      const headers = new Headers(init.headers);
      assert.equal(headers.get("Connect-Protocol-Version"), "1");
      assert.equal(headers.get("X-Access-Token"), "unit-runtime-auth");
      assert.equal(headers.get("Authorization"), `Basic ${Buffer.from("sandbox:").toString("base64")}`);
      assert.deepEqual(JSON.parse(init.body), { path: "/tmp" });
      return jsonResponse(200, { entries: [] });
    });

    const response = await cmd.listDir({ path: "/tmp" }, { username: "sandbox" });
    assert.deepEqual(response.entries, []);
  });

  await t.test("download uses query username and range", async () => {
    const cmd = createCmdService(async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.pathname, "/files");
      assert.equal(url.searchParams.get("path"), "~/hello.txt");
      assert.equal(url.searchParams.get("username"), "sandbox");
      const headers = new Headers(init.headers);
      assert.equal(headers.get("Range"), "bytes=0-3");
      return new Response("hell", { status: 206 });
    });

    const response = await cmd.download(
      { path: "~/hello.txt" },
      { username: "sandbox", range: "bytes=0-3" },
    );
    assert.equal(await response.text(), "hell");
  });

  await t.test("envs, configure, and ports use expected runtime paths", async () => {
    const calls = [];
    const cmd = createCmdService(async (input, init) => {
      const url = new URL(String(input));
      calls.push({ path: url.pathname, method: init.method, body: init.body ? JSON.parse(init.body) : null });
      if (url.pathname === "/envs") {
        return jsonResponse(200, { NODE_ENV: "production" });
      }
      if (url.pathname === "/configure") {
        return new Response(null, { status: 204 });
      }
      if (url.pathname === "/ports") {
        return jsonResponse(200, [{ port: 3000, protocol: "tcp", address: "127.0.0.1" }]);
      }
      throw new Error(`unexpected request: ${String(input)} ${init.method}`);
    });

    const envs = await cmd.envs();
    await cmd.configure({ envs: { A: "1" } });
    const ports = await cmd.ports();

    assert.deepEqual(envs, { NODE_ENV: "production" });
    assert.deepEqual(ports, [{ port: 3000, protocol: "tcp", address: "127.0.0.1" }]);
    assert.deepEqual(calls, [
      { path: "/envs", method: "GET", body: null },
      { path: "/configure", method: "POST", body: { envs: { A: "1" } } },
      { path: "/ports", method: "GET", body: null },
    ]);
  });

  await t.test("watcher management helpers encode requests", async () => {
    const cmd = createCmdService(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/filesystem.Filesystem/CreateWatcher") {
        assert.deepEqual(JSON.parse(init.body), { path: "/tmp", recursive: true });
        return jsonResponse(200, { watcherId: "watch-1" });
      }
      if (url.pathname === "/filesystem.Filesystem/GetWatcherEvents") {
        assert.deepEqual(JSON.parse(init.body), { watcherId: "watch-1", limit: 10 });
        return jsonResponse(200, { events: [{ name: "a.txt", type: "EVENT_TYPE_WRITE" }] });
      }
      if (url.pathname === "/filesystem.Filesystem/RemoveWatcher") {
        assert.deepEqual(JSON.parse(init.body), { watcherId: "watch-1" });
        return jsonResponse(200, {});
      }
      throw new Error(`unexpected request: ${String(input)} ${init.method}`);
    });

    const watcher = await cmd.createWatcher({ path: "/tmp", recursive: true });
    const events = await cmd.getWatcherEvents({ watcherId: watcher.watcherId, limit: 10 });
    await cmd.removeWatcher({ watcherId: watcher.watcherId });

    assert.equal(watcher.watcherId, "watch-1");
    assert.deepEqual(events.events, [{ name: "a.txt", type: "EVENT_TYPE_WRITE" }]);
    await assert.rejects(cmd.getWatcherEvents({ watcherId: " " }), ValidationError);
    await assert.rejects(cmd.removeWatcher({ watcherId: " " }), ValidationError);
  });

  await t.test("uploadMultipart and composeFiles encode file requests", async () => {
    const cmd = createCmdService(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/files" && init.method === "POST") {
        assert.equal(url.searchParams.get("path"), "/tmp");
        const form = await new Response(init.body).formData();
        const file = form.get("file");
        assert.equal(file.name, "hello.txt");
        assert.equal(await file.text(), "hello");
        return jsonResponse(200, [{ path: "/tmp/hello.txt", name: "hello.txt", type: "file" }]);
      }
      if (url.pathname === "/files/compose" && init.method === "POST") {
        const headers = new Headers(init.headers);
        assert.equal(headers.get("Content-Type"), "application/json");
        assert.deepEqual(JSON.parse(init.body), {
          source_paths: ["/tmp/a.txt", "/tmp/b.txt"],
          destination: "/tmp/out.txt",
        });
        return jsonResponse(200, { path: "/tmp/out.txt", name: "out.txt", type: "file" });
      }
      if (url.pathname === "/files/batch" && init.method === "POST") {
        const headers = new Headers(init.headers);
        assert.equal(headers.get("Content-Type"), "application/json");
        assert.deepEqual(JSON.parse(init.body), {
          files: [{ path: "/tmp/a.txt", content: "A" }],
        });
        return jsonResponse(200, { files: [{ path: "/tmp/a.txt", bytes_written: 1 }] });
      }
      throw new Error(`unexpected request: ${String(input)} ${init.method}`);
    });

    const uploaded = await cmd.uploadMultipart({
      path: "/tmp",
      parts: [{ data: new TextEncoder().encode("hello"), fileName: "hello.txt" }],
    });
    const batch = await cmd.writeBatch({
      files: [{ path: "/tmp/a.txt", content: "A" }],
    });
    const composed = await cmd.composeFiles({
      source_paths: ["/tmp/a.txt", "/tmp/b.txt"],
      destination: "/tmp/out.txt",
    });

    assert.deepEqual(uploaded, [{ path: "/tmp/hello.txt", name: "hello.txt", type: "file" }]);
    assert.deepEqual(batch, { files: [{ path: "/tmp/a.txt", bytes_written: 1 }] });
    assert.deepEqual(composed, { path: "/tmp/out.txt", name: "out.txt", type: "file" });
    await assert.rejects(cmd.uploadMultipart({ parts: [] }), ValidationError);
  });

  await t.test("filesContent, uploadBytes, uploadJson, and edit encode expected requests", async () => {
    const cmd = createCmdService(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/files/content") {
        assert.equal(url.searchParams.get("path"), "/tmp/a.txt");
        assert.equal(url.searchParams.get("max_tokens"), "32");
        return jsonResponse(200, { type: "text", content: "hello", truncated: false });
      }
      if (url.pathname === "/files" && init.method === "POST") {
        if (url.searchParams.get("path")) {
          assert.equal(url.searchParams.get("path"), "/tmp/a.txt");
          const headers = new Headers(init.headers);
          assert.equal(headers.get("Content-Encoding"), "gzip");
          const body = new Uint8Array(await new Response(init.body).arrayBuffer());
          assert.equal(body[0], 0x1f);
          assert.equal(body[1], 0x8b);
          return jsonResponse(200, [{ path: "/tmp/a.txt", name: "a.txt", type: "file" }]);
        }
        assert.deepEqual(JSON.parse(init.body), { path: "/tmp/b.txt", content: "hello" });
        return jsonResponse(200, [{ path: "/tmp/b.txt", name: "b.txt", type: "file" }]);
      }
      if (url.pathname === "/filesystem.Filesystem/Edit") {
        assert.deepEqual(JSON.parse(init.body), { path: "/tmp/a.txt", oldText: "a", newText: "b" });
        return jsonResponse(200, { message: "ok" });
      }
      throw new Error(`unexpected request: ${String(input)} ${init.method}`);
    });

    const content = await cmd.filesContent({ path: "/tmp/a.txt", maxTokens: 32 });
    const uploaded = await cmd.uploadBytes({ path: "/tmp/a.txt", data: new TextEncoder().encode("hello"), gzipCompress: true });
    const uploadedJson = await cmd.uploadJson({ path: "/tmp/b.txt", content: "hello" });
    const edited = await cmd.edit({ path: "/tmp/a.txt", oldText: "a", newText: "b" });

    assert.deepEqual(content, { type: "text", content: "hello", truncated: false });
    assert.deepEqual(uploaded, [{ path: "/tmp/a.txt", name: "a.txt", type: "file" }]);
    assert.deepEqual(uploadedJson, [{ path: "/tmp/b.txt", name: "b.txt", type: "file" }]);
    assert.deepEqual(edited, { message: "ok" });
  });

  await t.test("process and path validations reject invalid cmd inputs", async () => {
    const cmd = createCmdService(async () => jsonResponse(200, {}));

    await assert.rejects(cmd.createWatcher({ path: " " }), ValidationError);
    await assert.rejects(cmd.filesContent({ path: " " }), ValidationError);
    await assert.rejects(cmd.uploadJson({ path: " " }), ValidationError);
    await assert.rejects(cmd.edit({ path: " ", oldText: "a", newText: "b" }), ValidationError);
    await assert.rejects(cmd.streamInput([]), ValidationError);
    await assert.rejects(cmd.sendInput({ process: {}, input: { stdin: "" } }), ValidationError);
    await assert.rejects(cmd.sendInput({ process: { pid: 1, tag: "x" }, input: { stdin: "x" } }), ValidationError);
    await assert.rejects(cmd.sendSignal({ process: {} , signal: "SIGNAL_SIGKILL" }), ValidationError);
    await assert.rejects(cmd.closeStdin({ process: {} }), ValidationError);
    await assert.rejects(cmd.getResult({ cmdId: " " }), ValidationError);
  });

  await t.test("process stream parses connect frames", async () => {
    const cmd = createCmdService(async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(connectFrame({ event: { start: { pid: 1234, cmdId: "cmd-1" } } }));
          controller.enqueue(connectFrame({ event: { data: { stdout: Buffer.from("hello\n").toString("base64") } } }));
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "content-type": "application/connect+json" },
      });
    });

    const stream = await cmd.start({ process: { cmd: "echo", args: ["hello"] } });
    const first = await stream.next();
    const second = await stream.next();
    await stream.close();

    assert.equal(first.event.start.cmdId, "cmd-1");
    assert.ok(second.event.data.stdout);
  });

  await t.test("watchDir skips keepalive frames and stops on end stream", async () => {
    const cmd = createCmdService(async () => {
      const first = connectFrame({ filesystem: { type: "EVENT_TYPE_WRITE", name: "a.txt" } });
      const end = emptyConnectFrame(0x02);
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(emptyConnectFrame());
          controller.enqueue(first.slice(0, 3));
          controller.enqueue(first.slice(3));
          controller.enqueue(end);
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "content-type": "application/connect+json" },
      });
    });

    const stream = await cmd.watchDir({ path: "/tmp", recursive: true });
    const first = await stream.next();
    const second = await stream.next();
    await stream.close();

    assert.deepEqual(first, { filesystem: { type: "EVENT_TYPE_WRITE", name: "a.txt" } });
    assert.equal(second, null);
  });

  await t.test("streamInput encodes connect frames", async () => {
    const cmd = createCmdService(async (input, init) => {
      assert.equal(String(input), "https://sandbox-gateway.cloud.seaart.ai/process.Process/StreamInput");
      const body = new Uint8Array(await new Response(init.body).arrayBuffer());
      const frames = decodeFrames(body);
      assert.equal(frames.length, 2);
      assert.match(new TextDecoder().decode(frames[0].payload), /"pid":42/);
      assert.match(new TextDecoder().decode(frames[1].payload), /"stdin":"aGVsbG8="/);
      return new Response(connectFrame({}), {
        status: 200,
        headers: { "content-type": "application/connect+json" },
      });
    });

    const frame = await cmd.streamInput([
      { start: { process: { pid: 42 } } },
      { data: { input: { stdin: Buffer.from("hello").toString("base64") } } },
    ]);
    assert.ok(frame);
  });

  await t.test("streamInput returns raw end frame when upstream closes immediately", async () => {
    const cmd = createCmdService(async () => new Response(emptyConnectFrame(0x02), {
      status: 200,
      headers: { "content-type": "application/connect+json" },
    }));

    const frame = await cmd.streamInput([{ keepalive: {} }]);
    assert.equal(frame.flags, 0x02);
    assert.equal(frame.payload.byteLength, 0);
  });

  await t.test("proxy passes through non-2xx responses", async () => {
    const cmd = createCmdService(async () => new Response("upstream failed", { status: 502 }));
    const response = await cmd.proxy({ port: 8080, path: "/health" });
    assert.equal(response.status, 502);
    assert.equal(await response.text(), "upstream failed");
  });

  await t.test("baseUrl path prefix is preserved", async () => {
    const cmd = createClient(async () => jsonResponse(200, {})).cmd({
      baseUrl: "https://sandbox-gateway.cloud.seaart.ai/sandbox/sb-1",
      fetch: async (input) => {
        assert.equal(String(input), "https://sandbox-gateway.cloud.seaart.ai/sandbox/sb-1/run");
        return jsonResponse(200, { stdout: "ok", stderr: "", exit_code: 0, duration_ms: 1 });
      },
    });

    const response = await cmd.run({ cmd: "echo" });
    assert.equal(response.stdout, "ok");
  });
});

function connectFrame(payload) {
  const json = Buffer.from(JSON.stringify(payload));
  const header = Buffer.alloc(5);
  header.writeUInt8(0, 0);
  header.writeUInt32BE(json.length, 1);
  return new Uint8Array(Buffer.concat([header, json]));
}

function emptyConnectFrame(flags = 0) {
  const header = Buffer.alloc(5);
  header.writeUInt8(flags, 0);
  header.writeUInt32BE(0, 1);
  return new Uint8Array(header);
}

function decodeFrames(bytes) {
  const frames = [];
  let offset = 0;
  while (offset < bytes.length) {
    const flags = bytes[offset];
    const size = new DataView(bytes.buffer, bytes.byteOffset + offset + 1, 4).getUint32(0, false);
    const payload = bytes.slice(offset + 5, offset + 5 + size);
    frames.push({ flags, payload });
    offset += 5 + size;
  }
  return frames;
}

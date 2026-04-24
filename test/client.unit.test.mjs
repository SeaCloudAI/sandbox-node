import assert from "node:assert/strict";
import test from "node:test";

import { SandboxClient } from "../dist/index.js";
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
    const client = createClient(async (input, init) => {
      assert.equal(String(input), "https://sandbox-gateway.cloud.seaart.ai/api/v1/sandboxes");
      assert.equal(init.method, "POST");
      const headers = new Headers(init.headers);
      assert.equal(headers.get("Content-Type"), "application/json");
      assert.deepEqual(JSON.parse(init.body), { templateID: "tpl", waitReady: true });
      return jsonResponse(201, {
        sandboxID: "sb-1",
        envdUrl: "https://sandbox-gateway.cloud.seaart.ai",
        envdAccessToken: "unit-runtime-auth",
      });
    });

    const response = await client.createSandbox({ templateID: "tpl", waitReady: true });
    assert.equal(response.sandboxID, "sb-1");
    assert.equal(response.runtime.baseUrl, "https://sandbox-gateway.cloud.seaart.ai");
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
      calls.push({ url: String(input), method: init.method, body: init.body ? JSON.parse(init.body) : null });
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
      });
    });

    await client.getSandbox("sb-1");
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
    assert.equal(heartbeat.requestId, "req-1");
    assert.equal(calls[0].url, "https://sandbox-gateway.cloud.seaart.ai/api/v1/sandboxes/sb-1");
    assert.equal(calls.at(-1).method, "DELETE");
    assert.equal(connected.sandbox.runtime.accessToken, "unit-runtime-auth");
  });

  await t.test("build namespace reuses gateway configuration", async () => {
    const client = createClient(async (input, init) => {
      assert.equal(String(input), "https://sandbox-gateway.cloud.seaart.ai/api/v1/templates");
      assert.equal(init.method, "POST");
      assert.deepEqual(JSON.parse(init.body), { name: "demo", image: "docker.io/library/alpine:3.20" });
      return jsonResponse(202, { templateID: "tpl-1", buildID: "build-1", names: ["demo"], tags: [], aliases: [], public: false });
    });

    const response = await client.build.createTemplate({ name: "demo", image: "docker.io/library/alpine:3.20" });
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

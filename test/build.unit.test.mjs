import assert from "node:assert/strict";
import test from "node:test";

import { SandboxClient } from "../dist/index.js";
import { APIError, ValidationError } from "../dist/core/index.js";

function createService(handler) {
  return new SandboxClient({
    baseUrl: "https://sandbox-gateway.cloud.seaart.ai",
    apiKey: "unit-auth-value",
    fetch: handler,
  }).build;
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("unit: build system endpoints", async (t) => {
  await t.test("metrics returns text", async () => {
    const service = createService(async () => new Response("metric 1\n", { status: 200 }));
    const response = await service.metrics();
    assert.equal(response, "metric 1\n");
  });

  await t.test("direct build does not send auth headers", async () => {
    const service = createService(async (input, init) => {
      assert.equal(String(input), "https://sandbox-gateway.cloud.seaart.ai/build");
      const headers = new Headers(init.headers);
      assert.equal(headers.get("X-Namespace-ID"), null);
      assert.equal(headers.get("Content-Type"), "application/json");
      assert.deepEqual(JSON.parse(init.body), {
        project: "proj",
        image: "app",
        tag: "v1",
        dockerfile: "FROM alpine:3.20",
      });
      return jsonResponse(202, {
        templateID: "tpl-1",
        buildID: "build-1",
        imageFullName: "example-image:v1",
      });
    });

    const response = await service.directBuild({
      project: "proj",
      image: "app",
      tag: "v1",
      dockerfile: "FROM alpine:3.20",
    });
    assert.equal(response.templateID, "tpl-1");
  });
});

test("unit: build template endpoints", async (t) => {
  await t.test("create/list/get/update/delete encode expected headers and params", async () => {
    const calls = [];
    const service = createService(async (input, init) => {
      const url = new URL(String(input));
      const headers = new Headers(init.headers);
      calls.push({ url: String(input), method: init.method, headers });

      if (url.pathname === "/api/v1/templates" && init.method === "POST") {
        assert.deepEqual(JSON.parse(init.body), {
          name: "demo",
          visibility: "personal",
          image: "docker.io/library/alpine:3.20",
          cpuCount: 2,
          envs: { APP_ENV: "test" },
        });
        return jsonResponse(202, {
          templateID: "tpl-1",
          buildID: "build-1",
          public: false,
          names: ["user/demo"],
          tags: ["v1"],
          aliases: ["demo"],
        });
      }
      if (url.pathname === "/api/v1/templates" && init.method === "GET") {
        assert.equal(url.searchParams.get("visibility"), "team");
        assert.equal(url.searchParams.get("teamID"), "team-1");
        assert.equal(url.searchParams.get("limit"), "20");
        assert.equal(url.searchParams.get("offset"), "40");
        return jsonResponse(200, []);
      }
      if (url.pathname === "/api/v1/templates/aliases/demo") {
        return jsonResponse(200, { templateID: "tpl-1", public: false });
      }
      if (url.pathname === "/api/v1/templates/tpl-1" && init.method === "GET") {
        assert.equal(url.searchParams.get("limit"), "10");
        assert.equal(url.searchParams.get("nextToken"), "build-1");
        return jsonResponse(200, {
          templateID: "tpl-1",
          buildID: "build-2",
          buildStatus: "ready",
          public: false,
          names: ["user/demo"],
          aliases: ["demo"],
          tags: ["v1"],
          name: "demo",
          visibility: "personal",
          image: "example-image:v1",
          imageSource: "dockerfile",
          envdVersion: "sandbox-builder-v1",
          cpuCount: 2,
          memoryMB: 1024,
          diskSizeMB: 5120,
          createdBy: { id: "user", email: "test-user" },
          createdByID: "user",
          projectID: "proj-1",
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:01:00Z",
          lastSpawnedAt: "2026-01-01T00:02:00Z",
          spawnCount: 3,
          buildCount: 4,
          storageType: "ephemeral",
          ttlSeconds: 300,
          port: 9000,
          startCmd: "npm start",
          readyCmd: "test-ready-command",
          builds: [{
            buildID: "build-2",
            templateID: "tpl-1",
            status: "ready",
            image: "example-image:v1",
            errorMessage: "",
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:02:00Z",
            finishedAt: "2026-01-01T00:02:00Z",
          }],
          nextToken: "build-next",
        });
      }
      if (url.pathname === "/api/v1/templates/tpl-1" && init.method === "PATCH") {
        return jsonResponse(200, { names: ["user/demo-2"] });
      }
      if (url.pathname === "/api/v1/templates/tpl-1" && init.method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected request: ${String(input)} ${init.method}`);
    });

    const created = await service.createTemplate({
      name: "demo",
      visibility: "personal",
      image: "docker.io/library/alpine:3.20",
      cpuCount: 2,
      envs: { APP_ENV: "test" },
    });
    const listed = await service.listTemplates({
      visibility: "team",
      teamID: "team-1",
      limit: 20,
      offset: 40,
    });
    const aliased = await service.getTemplateByAlias("demo");
    const detail = await service.getTemplate("tpl-1", {
      limit: 10,
      nextToken: "build-1",
    });
    const updated = await service.updateTemplate("tpl-1", { name: "demo-2" });
    await service.deleteTemplate("tpl-1");

    assert.equal(created.templateID, "tpl-1");
    assert.deepEqual(listed, []);
    assert.equal(aliased.templateID, "tpl-1");
    assert.equal(detail.templateID, "tpl-1");
    assert.equal(detail.imageSource, "dockerfile");
    assert.equal(detail.createdBy.email, "test-user");
    assert.equal(detail.builds[0].status, "ready");
    assert.equal(detail.nextToken, "build-next");
    assert.deepEqual(updated.names, ["user/demo-2"]);
    assert.equal(calls.at(-1).method, "DELETE");
  });
});

test("unit: build request encoding and validation", async (t) => {
  await t.test("create build marks compat empty object response", async () => {
    const service = createService(async (input, init) => {
      assert.equal(String(input), "https://sandbox-gateway.cloud.seaart.ai/api/v1/templates/tpl-1/builds");
      assert.equal(init.method, "POST");
      assert.deepEqual(JSON.parse(init.body), { buildID: "build-abc", fromTemplate: "base" });
      return jsonResponse(202, {});
    });

    const response = await service.createBuild("tpl-1", { buildID: "build-abc", fromTemplate: "base" });
    assert.equal(response.empty, true);
  });

  await t.test("create build supports native response and omits body for empty request", async () => {
    const service = createService(async (input, init) => {
      assert.equal(String(input), "https://sandbox-gateway.cloud.seaart.ai/api/v1/templates/tpl-1/builds");
      assert.equal(init.body, undefined);
      const headers = new Headers(init.headers);
      assert.equal(headers.get("Content-Type"), null);
      return jsonResponse(202, {
        buildID: "build-1",
        templateID: "tpl-1",
        status: "uploaded",
        image: "example-image:v1",
        errorMessage: "",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:01Z",
        finishedAt: "2026-01-01T00:00:02Z",
      });
    });

    const response = await service.createBuild("tpl-1");
    assert.equal(response.empty, false);
    assert.equal(response.buildID, "build-1");
    assert.equal(response.status, "uploaded");
  });

  await t.test("create build encodes supported fields", async () => {
    const service = createService(async (_input, init) => {
      assert.deepEqual(JSON.parse(init.body), {
        fromImage: "docker.io/library/node:20",
        filesHash: "a".repeat(64),
        steps: [{ type: "files", filesHash: "a".repeat(64) }],
        startCmd: "npm start",
        readyCmd: "test-ready-command",
      });
      return jsonResponse(202, {});
    });

    const response = await service.createBuild("tpl-1", {
      fromImage: "docker.io/library/node:20",
      filesHash: "a".repeat(64),
      steps: [{ type: "files", filesHash: "a".repeat(64) }],
      startCmd: "npm start",
      readyCmd: "test-ready-command",
    });
    assert.equal(response.empty, true);
  });

  await t.test("status/logs/build endpoints support anonymous polling and normalize logEntries", async () => {
    const service = createService(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/status")) {
        assert.equal(url.searchParams.get("logsOffset"), "5");
        assert.equal(url.searchParams.get("limit"), "10");
        return jsonResponse(200, {
          buildID: "build-1",
          templateID: "tpl-1",
          status: "building",
          logs: [{
            timestamp: "2026-01-01T00:00:00Z",
            level: "info",
            step: "build",
            message: "building image",
          }],
          reason: null,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:01Z",
        });
      }
      if (url.pathname.endsWith("/logs")) {
        assert.equal(url.searchParams.get("cursor"), "0");
        assert.equal(url.searchParams.get("source"), "persistent");
        return jsonResponse(200, { logs: [] });
      }
      if (url.pathname.endsWith("/builds/build-1")) {
        return jsonResponse(200, { buildID: "build-1", templateID: "tpl-1", status: "ready" });
      }
      if (url.pathname.endsWith("/builds")) {
        return jsonResponse(200, { builds: [], total: 0 });
      }
      throw new Error(`unexpected request: ${String(input)}`);
    });

    const history = await service.listBuilds("tpl-1");
    const build = await service.getBuild("tpl-1", "build-1");
    const status = await service.getBuildStatus("tpl-1", "build-1", { logsOffset: 5, limit: 10 });
    const logs = await service.getBuildLogs("tpl-1", "build-1", {
      cursor: 0,
      limit: 10,
      direction: "forward",
      level: "info",
      source: "persistent",
    });

    assert.equal(history.total, 0);
    assert.equal(build.buildID, "build-1");
    assert.equal(status.logEntries[0].message, "building image");
    assert.deepEqual(logs.logs, []);
  });

  await t.test("status prefers explicit logEntries when both are present", async () => {
    const service = createService(async () => jsonResponse(200, {
      buildID: "build-1",
      templateID: "tpl-1",
      status: "building",
      logs: ["raw-line"],
      logEntries: [{
        timestamp: "2026-01-01T00:00:00Z",
        level: "info",
        step: "build",
        message: "structured log",
      }],
      reason: "queued",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:01Z",
    }));

    const response = await service.getBuildStatus("tpl-1", "build-1");
    assert.deepEqual(response.logs, ["raw-line"]);
    assert.equal(response.logEntries[0].message, "structured log");
  });

  await t.test("rollback and getBuildFile encode requests", async () => {
    const service = createService(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/rollback")) {
        return jsonResponse(200, { templateID: "tpl-1" });
      }
      if (url.pathname.includes("/files/")) {
        if (url.pathname.endsWith("/" + "a".repeat(64))) {
          return jsonResponse(200, { present: false, url: "https://sandbox-gateway.cloud.seaart.ai" });
        }
        return jsonResponse(200, { present: true });
      }
      throw new Error(`unexpected request: ${String(input)}`);
    });

    const rolled = await service.rollbackTemplate("tpl-1", { buildID: "build-1" });
    const file = await service.getBuildFile("tpl-1", "a".repeat(64));
    const existing = await service.getBuildFile("tpl-1", "b".repeat(64));

    assert.equal(rolled.templateID, "tpl-1");
    assert.equal(file.present, false);
    assert.equal(existing.present, true);
  });

  await t.test("validations reject unsupported build fields and bad params", async () => {
    const service = createService(async () => jsonResponse(200, {}));

    await assert.rejects(
      service.createBuild("tpl-1", { fromImageRegistry: "docker.io/node:20" }),
      ValidationError,
    );
    await assert.rejects(
      service.createBuild("tpl-1", {
        steps: [{ type: "files", filesHash: "a".repeat(64), args: ["x"] }],
      }),
      ValidationError,
    );
    await assert.rejects(
      service.createBuild("tpl-1", {
        buildID: "Build-Uppercase",
      }),
      ValidationError,
    );
    await assert.rejects(
      service.createBuild("tpl-1", {
        filesHash: "bad",
      }),
      ValidationError,
    );
    await assert.rejects(
      service.createBuild("tpl-1", {
        filesHash: "a".repeat(64),
        steps: [{ type: "files", filesHash: "b".repeat(64) }],
      }),
      ValidationError,
    );
    await assert.rejects(
      service.getBuildStatus("tpl-1", "build-1", { limit: 101 }),
      ValidationError,
    );
    await assert.rejects(
      service.getBuildLogs("tpl-1", "build-1", { source: "invalid" }),
      ValidationError,
    );
    await assert.rejects(
      service.listTemplates({ limit: 101 }),
      ValidationError,
    );
    await assert.rejects(
      service.listTemplates({ offset: -1 }),
      ValidationError,
    );
    await assert.rejects(
      service.getTemplate("tpl-1", { limit: 101 }),
      ValidationError,
    );
    await assert.rejects(
      service.getTemplateByAlias(" "),
      ValidationError,
    );
    await assert.rejects(
      service.getBuildFile("tpl-1", "bad"),
      ValidationError,
    );
  });

  await t.test("api errors are decoded", async () => {
    const service = createService(async () => new Response(
      JSON.stringify({
        code: 400,
        message: "validation failed",
        error: { code: "INVALID_HASH", details: "hash must be sha256" },
        request_id: "req-build-1",
      }),
      { status: 400, headers: { "content-type": "application/json" } },
    ));

    await assert.rejects(
      service.getBuildFile("tpl-1", "a".repeat(64)),
      (error) => {
        assert.ok(error instanceof APIError);
        assert.equal(error.requestId, "req-build-1");
        return true;
      },
    );
  });
});

import assert from "node:assert/strict";
import test from "node:test";

import { SandboxClient, TemplateBuildBuilder, templateBuild } from "../dist/index.js";
import { APIError, ValidationError } from "../dist/core/index.js";

function createService(handler) {
  return new SandboxClient({
    baseUrl: "https://sandbox-gateway.cloud.seaart.ai",
    apiKey: "unit-auth-value",
    projectId: "project-1",
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
      assert.equal(headers.get("X-Project-ID"), "project-1");
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
          tags: ["v1"],
          cpuCount: 2,
          memoryMB: 1024,
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
      if (url.pathname === "/api/v1/templates/aliases/tpl-1") {
        return jsonResponse(200, { templateID: "tpl-1", public: false });
      }
      if (url.pathname === "/api/v1/templates/resolve/base") {
        return jsonResponse(200, { templateID: "tpl-1", public: false });
      }
      if (url.pathname === "/api/v1/templates/tpl-1" && init.method === "GET") {
        assert.equal(url.searchParams.get("limit"), "10");
        assert.equal(url.searchParams.get("nextToken"), "build-1");
        return jsonResponse(200, {
          templateID: "tpl-1",
          buildID: "build-2",
          buildStatus: "ready",
          cpuCount: 2,
          memoryMB: 1024,
          diskSizeMB: 5120,
          public: false,
          names: ["user/demo"],
          aliases: ["demo"],
          createdBy: { id: "user-1", email: "user@example.com" },
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:01:00Z",
          lastSpawnedAt: "2026-01-01T00:02:00Z",
          spawnCount: 3,
          buildCount: 4,
          envdVersion: "sandbox-builder-v1",
          visibility: "personal",
          image: "harbor.example/demo:latest",
          storageType: "nfs",
          startCmd: "npm start",
          readyCmd: "test -f /tmp/ready",
          cloudsinkURL: "https://cloudsink.internal",
          builds: [{
            buildID: "build-2",
            status: "ready",
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:02:00Z",
            finishedAt: "2026-01-01T00:02:00Z",
            cpuCount: 2,
            memoryMB: 1024,
            diskSizeMB: 5120,
            envdVersion: "sandbox-builder-v1",
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
      tags: ["v1"],
      cpuCount: 2,
      memoryMB: 1024,
    });
    const listed = await service.listTemplates({
      visibility: "team",
      teamID: "team-1",
      limit: 20,
      offset: 40,
    });
    const aliased = await service.getTemplateByAlias("tpl-1");
    const resolved = await service.resolveTemplateRef("base");
    const detail = await service.getTemplate("tpl-1", {
      limit: 10,
      nextToken: "build-1",
    });
    const updated = await service.updateTemplate("tpl-1", {
      extensions: { seacloud: { envs: { SDK_TEST: "1" } } },
    });
    await service.deleteTemplate("tpl-1");

    assert.equal(created.templateID, "tpl-1");
    assert.deepEqual(listed, []);
    assert.equal(aliased.templateID, "tpl-1");
    assert.equal(resolved.templateID, "tpl-1");
    assert.equal(detail.templateID, "tpl-1");
    assert.equal(detail.buildID, "build-2");
    assert.equal(detail.buildStatus, "ready");
    assert.equal(detail.cpuCount, 2);
    assert.equal(detail.createdBy.email, "user@example.com");
    assert.equal(detail.visibility, "personal");
    assert.equal(detail.storageType, "nfs");
    assert.equal(detail.startCmd, "npm start");
    assert.equal(detail.readyCmd, "test -f /tmp/ready");
    assert.equal(detail.cloudsinkURL, "https://cloudsink.internal");
    assert.equal(detail.builds[0].status, "ready");
    assert.equal(detail.builds[0].memoryMB, 1024);
    assert.equal(detail.nextToken, "build-next");
    assert.deepEqual(updated.names, ["user/demo-2"]);
    assert.equal(calls.at(-1).method, "DELETE");
  });
});

test("unit: template build builder encodes requests", async (t) => {
  await t.test("chain helper expands into a BuildRequest", async () => {
    const request = templateBuild()
      .fromImage("docker.io/library/node:20")
      .fromImageRegistry({
        type: "registry",
        username: "robot",
        password: "secret",
      })
      .force()
      .copy("package.json", "/app/package.json", "a".repeat(64), { force: true })
      .run("npm ci")
      .env({ NODE_ENV: "production", PORT: "3000" })
      .workdir("/app")
      .user("node")
      .startCmd("npm start")
      .readyCmd("test-ready-command")
      .filesHash("b".repeat(64))
      .toRequest();

    assert.equal(request.fromImage, "docker.io/library/node:20");
    assert.equal(request.force, true);
    assert.equal(request.fromImageRegistry.username, "robot");
    assert.deepEqual(request.steps[0], {
      type: "COPY",
      args: ["package.json", "/app/package.json"],
      filesHash: "a".repeat(64),
      force: true,
    });
    assert.deepEqual(request.steps[2], {
      type: "ENV",
      args: ["NODE_ENV", "production", "PORT", "3000"],
    });
    assert.equal(request.startCmd, "npm start");
    assert.equal(request.readyCmd, "test-ready-command");
  });

  await t.test("toRequest returns a defensive copy", async () => {
    const builder = new TemplateBuildBuilder()
      .fromImage("docker.io/library/alpine:3.20")
      .copy("src", "/dst", "a".repeat(64))
      .env("NODE_ENV", "production");

    const request = builder.toRequest();
    request.fromImage = "changed";
    request.steps[0].args[0] = "mutated";

    const next = builder.toRequest();
    assert.equal(next.fromImage, "docker.io/library/alpine:3.20");
    assert.equal(next.steps[0].args[0], "src");
  });
});

test("unit: build request encoding and validation", async (t) => {
  await t.test("create build returns the raw empty object response", async () => {
    const service = createService(async (input, init) => {
      assert.equal(String(input), "https://sandbox-gateway.cloud.seaart.ai/api/v1/templates/tpl-1/builds/build-abc");
      assert.equal(init.method, "POST");
      assert.deepEqual(JSON.parse(init.body), { fromTemplate: "base" });
      return jsonResponse(202, {});
    });

    const response = await service.createBuild("tpl-1", "build-abc", { fromTemplate: "base" });
    assert.deepEqual(response, {});
  });

  await t.test("create build omits body for empty request and expects empty response", async () => {
    const service = createService(async (input, init) => {
      assert.equal(String(input), "https://sandbox-gateway.cloud.seaart.ai/api/v1/templates/tpl-1/builds/build-empty");
      assert.equal(init.body, undefined);
      const headers = new Headers(init.headers);
      assert.equal(headers.get("Content-Type"), null);
      return jsonResponse(202, {});
    });

    const response = await service.createBuild("tpl-1", "build-empty");
    assert.deepEqual(response, {});
  });

  await t.test("create build encodes supported fields", async () => {
    const service = createService(async (_input, init) => {
      assert.deepEqual(JSON.parse(init.body), {
        fromImage: "docker.io/library/node:20",
        filesHash: "a".repeat(64),
        fromImageRegistry: {
          type: "registry",
          username: "robot",
          password: "secret",
        },
        steps: [
          { type: "COPY", filesHash: "a".repeat(64), args: ["package.json", "/app/package.json"] },
          { type: "RUN", args: ["npm install"] },
          { type: "ENV", args: ["NODE_ENV", "production"] },
        ],
        startCmd: "npm start",
        readyCmd: "test-ready-command",
      });
      return jsonResponse(202, {});
    });

    const response = await service.createBuild("tpl-1", "build-encoded", {
      fromImage: "docker.io/library/node:20",
      filesHash: "a".repeat(64),
      fromImageRegistry: {
        type: "registry",
        username: "robot",
        password: "secret",
      },
      steps: [
        { type: "COPY", filesHash: "a".repeat(64), args: ["package.json", "/app/package.json"] },
        { type: "RUN", args: ["npm install"] },
        { type: "ENV", args: ["NODE_ENV", "production"] },
      ],
      startCmd: "npm start",
      readyCmd: "test-ready-command",
    });
    assert.deepEqual(response, {});
  });

  await t.test("status/logs/build endpoints support anonymous polling", async () => {
    const service = createService(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/status")) {
        assert.equal(url.searchParams.get("logsOffset"), "5");
        assert.equal(url.searchParams.get("limit"), "10");
        return jsonResponse(200, {
          buildID: "build-1",
          templateID: "tpl-1",
          status: "building",
          logs: ["raw-line"],
          logEntries: [{
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
    assert.deepEqual(status.logs, ["raw-line"]);
    assert.deepEqual(logs.logs, []);
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
    const createAcceptingService = createService(async () => jsonResponse(202, {}));
    const updateAcceptingService = createService(async () => jsonResponse(200, { names: ["user/demo"] }));

    await assert.rejects(
      service.createBuild("tpl-1", "build-test", { fromImageRegistry: "docker.io/node:20" }),
      ValidationError,
    );
    await assert.rejects(
      service.createBuild("tpl-1", "build-test", {
        steps: [{ type: "COPY", filesHash: "a".repeat(64), args: ["x"] }],
      }),
      ValidationError,
    );
    await assert.rejects(
      service.createBuild("tpl-1", "build-test", {
        steps: [{ type: "ENV", args: ["NODE_ENV"] }],
      }),
      ValidationError,
    );
    await assert.rejects(
      service.createBuild("tpl-1", "Build-Uppercase"),
      ValidationError,
    );
    await assert.rejects(
      service.createBuild("tpl-1", "build-test", {
        buildID: "build-body",
      }),
      ValidationError,
    );
    await assert.rejects(
      service.createBuild("tpl-1", "build-test", {
        extensions: {
          seacloud: {
            filesHash: "bad",
          },
        },
      }),
      ValidationError,
    );
    await assert.rejects(
      service.createBuild("tpl-1", "build-test", {
        force: "yes",
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
    await assert.rejects(
      service.createTemplate({
        name: "official-template",
        visibility: "official",
      }),
      /template field visibility is not supported by the public SDK/,
    );
    await assert.doesNotReject(
      createAcceptingService.createTemplate({
        name: "demo",
        extensions: {
          seacloud: {
            baseTemplateID: "tpl-base-1",
            visibility: "team",
          },
        },
      }),
    );
    await assert.rejects(
      service.createTemplate({
        name: "demo",
        extensions: {
          seacloud: {
            visibility: "official",
          },
        },
      }),
      /extensions\.seacloud\.visibility=official is not supported by the public SDK/,
    );
    await assert.rejects(
      service.updateTemplate("tpl-1", {
        visibility: "official",
      }),
      /template field visibility is not supported by the public SDK/,
    );
    await assert.doesNotReject(
      updateAcceptingService.updateTemplate("tpl-1", {
        extensions: {
          seacloud: {
            baseTemplateID: "tpl-base-2",
            storageType: "persistent",
          },
        },
      }),
    );
    await assert.rejects(
      service.updateTemplate("tpl-1", {
        extensions: {
          seacloud: {
            visibility: "official",
          },
        },
      }),
      /extensions\.seacloud\.visibility=official is not supported by the public SDK/,
    );
    await assert.rejects(
      service.createTemplate({
        name: "demo",
        type: "base",
      }),
      /template field type is not supported by the public SDK/,
    );
  });

  await t.test("boundary values are accepted for template and build queries", async () => {
    const calls = [];
    const buildID = "build-".padEnd(63, "a");
    const service = createService(async (input, init) => {
      const url = new URL(String(input));
      calls.push(String(input));
      if (url.pathname === "/api/v1/templates") {
        return jsonResponse(200, []);
      }
      if (url.pathname === "/api/v1/templates/resolve/base") {
        return jsonResponse(200, { templateID: "tpl-base" });
      }
      if (url.pathname === "/api/v1/templates/aliases/demo") {
        return jsonResponse(200, { templateID: "tpl-1" });
      }
      if (url.pathname === "/api/v1/templates/tpl-1") {
        return jsonResponse(200, { templateID: "tpl-1" });
      }
      if (url.pathname.endsWith("/status")) {
        return jsonResponse(200, { buildID: "b", templateID: "tpl-1", status: "building", logs: [], logEntries: [] });
      }
      if (url.pathname.endsWith("/logs")) {
        return jsonResponse(200, { logs: [] });
      }
      if (url.pathname.includes("/files/")) {
        return jsonResponse(200, { present: true });
      }
      if (url.pathname.endsWith(`/builds/${buildID}`)) {
        return jsonResponse(202, {});
      }
      throw new Error(`unexpected request: ${String(input)} ${init.method}`);
    });

    await service.listTemplates({ limit: 100, offset: 0 });
    await service.getTemplateByAlias("demo");
    await service.resolveTemplateRef("base");
    await service.getTemplate("tpl-1", { limit: 100, nextToken: "" });
    await service.createBuild("tpl-1", buildID);
    await service.getBuildStatus("tpl-1", "build-1", { logsOffset: 0, limit: 100 });
    await service.getBuildLogs("tpl-1", "build-1", { cursor: 0, limit: 100, direction: "backward", source: "temporary" });
    await service.getBuildFile("tpl-1", "a".repeat(64));

    assert.equal(calls.length, 8);
  });

  await t.test("empty template and build identifiers are rejected", async () => {
    const service = createService(async () => jsonResponse(200, {}));

    await assert.rejects(service.getTemplate(" "), ValidationError);
    await assert.rejects(service.updateTemplate(" ", {}), ValidationError);
    await assert.rejects(service.deleteTemplate(" "), ValidationError);
    await assert.rejects(service.getTemplateByAlias(" "), ValidationError);
    await assert.rejects(service.resolveTemplateRef(" "), ValidationError);
    await assert.rejects(service.createBuild(" ", "build-1"), ValidationError);
    await assert.rejects(service.createBuild("tpl-1", " "), ValidationError);
    await assert.rejects(service.getBuild(" ", "build-1"), ValidationError);
    await assert.rejects(service.getBuild("tpl-1", " "), ValidationError);
    await assert.rejects(service.getBuildStatus(" ", "build-1"), ValidationError);
    await assert.rejects(service.getBuildLogs("tpl-1", " "), ValidationError);
    await assert.rejects(service.listBuilds(" "), ValidationError);
    await assert.rejects(service.getBuildFile(" ", "a".repeat(64)), ValidationError);
    await assert.rejects(service.getBuildFile("tpl-1", " "), ValidationError);
    await assert.rejects(service.rollbackTemplate(" ", { buildID: "build-1" }), ValidationError);
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

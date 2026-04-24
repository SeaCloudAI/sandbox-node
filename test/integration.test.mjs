import assert from "node:assert/strict";
import test from "node:test";

import { SandboxClient } from "../dist/index.js";

const shouldRun = process.env.SANDBOX_RUN_INTEGRATION === "1";

function integrationConfig() {
  const baseUrl = process.env.SANDBOX_TEST_BASE_URL ?? "";
  const apiKey = process.env.SANDBOX_TEST_API_KEY ?? "";
  const templateID = process.env.SANDBOX_TEST_TEMPLATE_ID ?? "";
  const buildImage = process.env.SANDBOX_TEST_BUILD_IMAGE ?? "docker.io/library/alpine:3.20";

  if (!baseUrl || !apiKey) {
    throw new Error("integration test env is incomplete");
  }

  return {
    client: new SandboxClient({ baseUrl, apiKey }),
    templateID,
    buildImage,
  };
}

test("control plane integration", { skip: !shouldRun }, async (t) => {
  const { client, templateID } = integrationConfig();

  await t.test("list sandboxes", async () => {
    const response = await client.listSandboxes({ limit: 10 });
    assert.ok(Array.isArray(response));
  });

  await t.test("pool status", async () => {
    try {
      const response = await client.getPoolStatus();
      assert.ok(response.total >= 0);
    } catch (error) {
      if (error?.statusCode === 404) {
        t.skip("admin pool status is not exposed by this gateway");
        return;
      }
      throw error;
    }
  });

  await t.test("rolling status", async () => {
    try {
      const response = await client.getRollingUpdateStatus();
      assert.ok(response.phase);
    } catch (error) {
      if (error?.statusCode === 404) {
        t.skip("admin rolling status is not exposed by this gateway");
        return;
      }
      throw error;
    }
  });

  await t.test("sandbox lifecycle", { skip: !templateID }, async () => {
    const workspaceId = `node-sdk-test-${Date.now()}`;
    const created = await client.createSandbox({
      templateID,
      workspaceId,
      timeout: 1800,
      waitReady: true,
    });

    const sandboxID = created.sandboxID;
    assert.ok(sandboxID);

    try {
      const detail = await client.getSandbox(sandboxID);
      assert.equal(detail.sandboxID, sandboxID);

      const heartbeat = await client.sendHeartbeat(sandboxID, { status: "healthy" });
      assert.equal(heartbeat.received, true);

      await client.setSandboxTimeout(sandboxID, { timeout: 1200 });
      await client.refreshSandbox(sandboxID, { duration: 60 });

      const logs = await client.getSandboxLogs(sandboxID, { limit: 10 });
      assert.ok(Array.isArray(logs.logs));

      await client.pauseSandbox(sandboxID);

      const connected = await client.connectSandbox(sandboxID, { timeout: 1200 });
      assert.ok([200, 201].includes(connected.statusCode));
    } finally {
      try {
        await client.deleteSandbox(sandboxID);
      } catch (error) {
        if (error?.statusCode !== 404) {
          throw error;
        }
      }
    }
  });
});

test("cmd integration", { skip: !shouldRun }, async (t) => {
  const { client, templateID } = integrationConfig();
  const workspaceRoot = process.env.SANDBOX_TEST_SANDBOX_ROOT ?? "/root/workspace";

  await t.test("nano-executor smoke", { skip: !templateID }, async () => {
    const workspaceId = `node-cmd-sdk-test-${Date.now()}`;
    const created = await client.createSandbox({
      templateID,
      workspaceId,
      timeout: 1800,
      waitReady: true,
    });
    const sandboxID = created.sandboxID;
    assert.ok(sandboxID);

    try {
      if (!created.envdUrl) {
        t.skip("sandbox did not return envdUrl");
        return;
      }

      const cmd = client.runtimeFromSandbox(created);

      const filePath = `${workspaceRoot.replace(/\/+$/, "")}/node-cmd-sdk.txt`;
      const upload = await cmd.uploadBytes({ path: filePath, data: Buffer.from("node-cmd") });
      assert.ok(Array.isArray(upload));
      const fileResp = await cmd.download({ path: filePath });
      assert.equal(await fileResp.text(), "node-cmd");

      const content = await cmd.filesContent({ path: filePath });
      assert.equal(content.type, "text");
      assert.equal(content.content, "node-cmd");

      const list = await cmd.listDir({ path: workspaceRoot, depth: 1 });
      assert.ok(Array.isArray(list.entries));

      const process = await cmd.start({
        process: { cmd: "cat" },
        tag: "node-cmd-test",
      });
      try {
        const startFrame = await process.next();
        assert.ok(startFrame?.event?.start?.cmdId);
        await cmd.sendInput({
          process: { tag: "node-cmd-test" },
          input: { stdin: Buffer.from("ping\n").toString("base64") },
        });
        await cmd.closeStdin({ process: { tag: "node-cmd-test" } });

        let sawOutput = false;
        let sawEnd = false;
        for (let i = 0; i < 10; i += 1) {
          const frame = await process.next();
          if (!frame) {
            break;
          }
          if ("data" in frame.event && frame.event.data?.stdout) {
            const output = Buffer.from(frame.event.data.stdout, "base64").toString("utf8");
            if (output.includes("ping")) {
              sawOutput = true;
            }
          }
          if ("end" in frame.event && frame.event.end) {
            sawEnd = true;
            break;
          }
        }
        assert.equal(sawOutput, true);
        assert.equal(sawEnd, true);
      } finally {
        await process.close();
      }
    } finally {
      try {
        await client.deleteSandbox(sandboxID);
      } catch (error) {
        if (error?.statusCode !== 404) {
          throw error;
        }
      }
    }
  });
});

test("build plane integration", { skip: !shouldRun }, async (t) => {
  const { client, buildImage } = integrationConfig();
  const build = client.build;

  await t.test("direct build anonymous polling", async () => {
    let direct;
    try {
      direct = await build.directBuild({
        project: "sdk-build-integration",
        image: "node-direct-build",
        tag: `t${Date.now()}`,
        dockerfile: "FROM alpine:3.20\nRUN echo direct-build-test >/tmp/direct-build.txt\n",
      });
    } catch (error) {
      if (error?.statusCode === 404) {
        t.skip("direct build endpoint is not exposed by this gateway");
        return;
      }
      throw error;
    }
    assert.ok(direct.templateID);
    assert.ok(direct.buildID);
    assert.ok(direct.imageFullName);

    try {
      const status = await waitForBuildReady(build, direct.templateID, direct.buildID);
      assert.equal(status.status, "ready");

      const build = await build.getBuild(direct.templateID, direct.buildID);
      assert.equal(build.buildID, direct.buildID);

      const logs = await build.getBuildLogs(direct.templateID, direct.buildID, { limit: 10 });
      assert.ok(Array.isArray(logs.logs));
    } finally {
      try {
        await build.deleteTemplate(direct.templateID);
      } catch (error) {
        if (error?.statusCode !== 404) {
          throw error;
        }
      }
    }
  });

  await t.test("template lifecycle", async () => {
    const name = `node-build-sdk-${Date.now()}`;
    const created = await build.createTemplate({
      name,
      visibility: "personal",
      image: buildImage,
    });
    assert.ok(created.templateID);

    const templateID = created.templateID;
    const buildID = created.buildID;

    try {
      const listed = await build.listTemplates({ limit: 20 });
      assert.ok(Array.isArray(listed));

      const aliased = await build.getTemplateByAlias(templateID);
      assert.equal(aliased.templateID, templateID);

      const detail = await build.getTemplate(templateID, { limit: 10 });
      assert.equal(detail.templateID, templateID);

      const updated = await build.updateTemplate(templateID, { name: `${name}-updated` });
      assert.ok(updated.names.length > 0);

      const file = await build.getBuildFile(templateID, "a".repeat(64));
      assert.equal(typeof file.present, "boolean");

      const history = await build.listBuilds(templateID);
      assert.ok(history.total >= 0);

      if (buildID) {
        const buildDetail = await build.getBuild(templateID, buildID);
        assert.equal(buildDetail.buildID, buildID);

        const status = await build.getBuildStatus(templateID, buildID, { limit: 10 });
        assert.equal(status.buildID, buildID);

        const logs = await build.getBuildLogs(templateID, buildID, { limit: 10 });
        assert.ok(Array.isArray(logs.logs));

        const rolled = await build.rollbackTemplate(templateID, { buildID });
        assert.equal(rolled.templateID, templateID);
      }
    } finally {
      try {
        await build.deleteTemplate(templateID);
      } catch (error) {
        if (error?.statusCode !== 404) {
          throw error;
        }
      }
    }
  });
});

async function waitForBuildReady(build, templateID, buildID) {
  const deadline = Date.now() + 3 * 60_000;
  let last;
  while (Date.now() < deadline) {
    const status = await build.getBuildStatus(templateID, buildID, { limit: 20 });
    last = status;
    if (status.status === "ready") {
      return status;
    }
    if (status.status === "error") {
      throw new Error(`build failed: ${JSON.stringify(status)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`build did not complete before deadline: ${JSON.stringify(last)}`);
}

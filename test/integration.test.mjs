import assert from "node:assert/strict";
import test from "node:test";

import { GatewayClient } from "../dist/gateway-client.js";

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
    client: new GatewayClient({ baseUrl, apiKey }),
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
    const created = await client.createSandbox({
      templateID,
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
      await client.refreshSandbox(sandboxID);

      const logs = await client.getSandboxLogs(sandboxID, { limit: 10 });
      assert.ok(Array.isArray(logs.logs));

      await client.pauseSandbox(sandboxID);

      const connected = await client.connectSandbox(sandboxID, { timeout: 1200 });
      assert.ok([200, 201].includes(connected.statusCode));

      if (connected.sandbox.envdUrl) {
        const runtime = client.runtimeFromSandbox(connected.sandbox);
        const result = await runtime.run({
          cmd: "sh",
          args: ["-lc", "echo resumed-node"],
        });
        assert.equal(result.exit_code, 0);
        assert.match(result.stdout, /resumed-node/);
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

test("cmd integration", { skip: !shouldRun }, async (t) => {
  const { client, templateID } = integrationConfig();
  const workspaceRoot = process.env.SANDBOX_TEST_SANDBOX_ROOT ?? "/root/workspace";

  await t.test("high-level facade smoke", { skip: !templateID }, async () => {
    const sandbox = await client.create(templateID, {
      timeout: 1800,
      waitReady: true,
    });

    try {
      const result = await sandbox.commands.run("sh", {
        args: ["-lc", "echo facade-node"],
      });
      assert.equal(result.exitCode, 0);
      assert.match(result.stdout, /facade-node/);

      const filePath = `${workspaceRoot.replace(/\/+$/, "")}/node-facade-sdk.txt`;
      await sandbox.files.write(filePath, "node-facade");
      const content = await sandbox.files.read(filePath);
      assert.equal(content, "node-facade");
      assert.equal(await sandbox.files.exists(filePath), true);

      const ptyHandle = await sandbox.pty.create("sh", {
        args: ["-lc", 'printf "ready\\n"; IFS= read line; printf "got:%s\\n" "$line"'],
        size: { cols: 90, rows: 30 },
      });
      await sandbox.pty.resize(ptyHandle.pid, { cols: 100, rows: 40 });
      await ptyHandle.sendStdin("ping\n");
      const ptyResult = await ptyHandle.wait();
      assert.match(ptyResult.pty, /ready/);
      assert.match(ptyResult.pty, /got:ping/);

      const commandHandle = await sandbox.commands.run("sh", {
        args: ["-lc", 'IFS= read line; printf "cmd:%s\\n" "$line"'],
        background: true,
      });
      const connectedCommand = await sandbox.commands.connect(commandHandle.pid);
      await connectedCommand.sendStdin("pong\n");
      const connectedCommandResult = await connectedCommand.wait();
      assert.match(connectedCommandResult.stdout, /cmd:pong/);

      const longRunningCommand = await sandbox.commands.run("sh", {
        args: ["-lc", "sleep 30"],
        background: true,
      });
      assert.equal(await sandbox.commands.kill(longRunningCommand.pid), true);
      assert.equal(await sandbox.commands.kill(longRunningCommand.pid), false);

      const ptySource = await sandbox.pty.create("sh", {
        args: ["-lc", 'IFS= read line; printf "pty:%s\\n" "$line"'],
      });
      const connectedPty = await sandbox.pty.connect(ptySource.pid);
      await connectedPty.sendStdin("echoed\n");
      const connectedPtyResult = await connectedPty.wait();
      assert.match(connectedPtyResult.pty, /pty:echoed/);

      const longRunningPty = await sandbox.pty.create("sh", {
        args: ["-lc", "sleep 30"],
      });
      assert.equal(await sandbox.pty.kill(longRunningPty.pid), true);
      assert.equal(await sandbox.pty.kill(longRunningPty.pid), false);
    } finally {
      try {
        await sandbox.delete();
      } catch (error) {
        if (error?.statusCode !== 404) {
          throw error;
        }
      }
    }
  });

  await t.test("nano-executor smoke", { skip: !templateID }, async () => {
    const created = await client.createSandbox({
      templateID,
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

      const baseDir = `${workspaceRoot.replace(/\/+$/, "")}/node-cmd-${Date.now()}`;
      await cmd.makeDir({ path: baseDir });
      const jsonPath = `${baseDir}/json.txt`;
      const gzipPath = `${baseDir}/gzip.txt`;
      const movedPath = `${baseDir}/moved.txt`;
      const batchAPath = `${baseDir}/batch-a.txt`;
      const batchBPath = `${baseDir}/batch-b.txt`;
      const composedPath = `${baseDir}/joined.txt`;

      await cmd.uploadJson({ path: jsonPath, content: "alpha" });
      await cmd.edit({ path: jsonPath, oldText: "alpha", newText: "beta" });
      await cmd.uploadBytes({ path: gzipPath, data: Buffer.from("gzip-node"), gzipCompress: true });
      await cmd.move({ source: jsonPath, destination: movedPath });
      const batch = await cmd.writeBatch({
        files: [
          { path: batchAPath, content: "A" },
          { path: batchBPath, content: "B" },
        ],
      });
      assert.equal(batch.files.length, 2);
      const gzipText = await waitForDownloadedText(cmd, gzipPath);
      assert.equal(gzipText, "gzip-node");
      await cmd.composeFiles({
        source_paths: [movedPath, gzipPath],
        destination: composedPath,
      });
      const composedText = await waitForDownloadedText(cmd, composedPath);
      assert.match(composedText, /beta/);
      assert.match(composedText, /gzip-node/);

      const list = await cmd.listDir({ path: baseDir, depth: 1 });
      assert.ok(Array.isArray(list.entries));
      assert.ok(list.entries.some((entry) => entry.path === composedPath));
      assert.equal(list.entries.some((entry) => entry.path === gzipPath), false);
      assert.equal(list.entries.some((entry) => entry.path === movedPath), false);
      await cmd.remove({ path: composedPath });

      const watchRoot = "/tmp";
      const watchFileName = `node-watch-${Date.now()}.txt`;
      let watcher;
      try {
        watcher = await cmd.createWatcher({ path: watchRoot });
      } catch (error) {
        if (isWatcherUnsupported(error)) {
          t.skip("watcher is not supported by this sandbox filesystem layout");
          return;
        }
        throw error;
      }
      try {
        await cmd.uploadBytes({
          path: `${watchRoot}/${watchFileName}`,
          data: Buffer.from("watch-node"),
        });
        const events = await waitForWatcherEvent(cmd, watcher.watcherId, watchFileName);
        assert.ok(events.some((event) => event.name === watchFileName));
      } finally {
        await cmd.removeWatcher({ watcherId: watcher.watcherId });
      }

      const process = await cmd.start({
        process: { cmd: "cat" },
        tag: "node-cmd-test",
      });
      try {
        const startFrame = await process.next();
        assert.ok(startFrame?.event?.start?.cmdId);
        const pid = startFrame.event.start.pid;
        const cmdId = startFrame.event.start.cmdId;
        const processList = await cmd.listProcesses();
        assert.ok(processList.processes.some((item) => item.pid === pid));
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
        const result = await cmd.getResult({ cmdId });
        assert.equal(result.exitCode, 0);
        assert.match(result.stdout, /ping/);
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

  await t.test("template lifecycle", async () => {
    const name = `node-build-sdk-${Date.now()}`;
    const created = await build.createTemplate({
      name,
    });
    assert.ok(created.templateID);

    const templateID = created.templateID;
    let buildID = created.buildID;

    if (!buildID) {
      const requestedBuildID = `build-${Date.now().toString(16)}`;
      const triggered = await build.createBuild(templateID, requestedBuildID, { fromImage: buildImage });
      assert.deepEqual(triggered, {});
      buildID = requestedBuildID;
    }

    try {
      const listed = await build.listTemplates({ limit: 20 });
      assert.ok(Array.isArray(listed));

      const aliased = await build.getTemplateByAlias(name);
      assert.equal(aliased.templateID, templateID);

      const resolved = await build.resolveTemplateRef(templateID);
      assert.equal(resolved.templateID, templateID);

      const detail = await build.getTemplate(templateID, { limit: 10 });
      assert.equal(detail.templateID, templateID);

      const updated = await build.updateTemplate(templateID, {
        extensions: { seacloud: { envs: { SDK_TEST: "1" } } },
      });
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

async function waitForWatcherEvent(cmd, watcherId, fileName) {
  for (let i = 0; i < 12; i += 1) {
    const response = await cmd.getWatcherEvents({ watcherId, limit: 20 });
    if (response.events.some((event) => event.name === fileName)) {
      return response.events;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return [];
}

async function waitForDownloadedText(cmd, path) {
  for (let i = 0; i < 8; i += 1) {
    try {
      const response = await cmd.download({ path });
      return await response.text();
    } catch (error) {
      if (error?.statusCode !== 404 || i === 7) {
        throw error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`timed out waiting for file ${path}`);
}

function isWatcherUnsupported(error) {
  const message = String(error?.message ?? "");
  return message.includes("network filesystem") || message.includes("outside allowed directory");
}

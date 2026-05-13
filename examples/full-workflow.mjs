import {
  Sandbox,
  Template,
  defaultBuildLogger,
} from "../dist/index.js";

mustEnv("SEACLOUD_API_KEY");
const runtimeBaseImage = mustEnv("SANDBOX_EXAMPLE_RUNTIME_BASE_IMAGE");
const keepResources = envEnabled("SANDBOX_EXAMPLE_KEEP_RESOURCES");

const templateName = `node-full-workflow-${Date.now()}`;
let templateID = "";
let buildID = "";

let createdSandbox;
let buildLogCount = 0;

try {
  const built = await Template.build(
    new Template()
      .fromImage(runtimeBaseImage)
      .runCmd("mkdir -p /workspace && printf 'hello from node full workflow\\n' >/workspace/built-by-template.txt")
      .setReadyCmd("test -f /workspace/built-by-template.txt"),
    templateName,
    {
      wait: true,
      pollIntervalMs: 2_000,
      onBuildLogs(entry) {
        buildLogCount += 1;
        defaultBuildLogger()(entry);
      },
      requestTimeoutMs: 180_000,
    },
  );
  buildID = built.buildId;
  console.log("build started:", built.templateId, built.buildId);

  const buildStatus = await Template.getBuildStatus(
    { templateId: built.templateId, buildId: built.buildId },
    { limit: 20 },
  );
  console.log("build ready:", buildStatus.templateId, buildStatus.buildId, buildStatus.status);
  console.log("build logs:", buildLogCount, latestBuildLog(buildStatus));

  const templateDetail = await Template.get(built.templateId);
  templateID = built.templateId;
  console.log(
    "template detail:",
    templateDetail.templateID,
    templateDetail.builds?.length ?? 0,
    templateDetail.extensions?.imageSource,
  );

  createdSandbox = await Sandbox.create(built.templateId, {
    timeout: 1800,
    waitReady: true,
  });
  console.log("sandbox created:", createdSandbox.sandboxId, createdSandbox.status);

  const sandboxDetail = await createdSandbox.reload();
  console.log("sandbox detail:", sandboxDetail.state, sandboxDetail.status);

  try {
    const sandboxLogs = await sandboxDetail.logs({ limit: 10, direction: "forward" });
    console.log("sandbox logs:", sandboxLogs.logs.length, latestSandboxLog(sandboxLogs));
  } catch (error) {
    console.log("sandbox logs warning:", formatError(error));
  }

  const connected = await sandboxDetail.connect({ timeout: 1800 });
  console.log("sandbox connected:", connected.sandboxId, connected.status);

  try {
    const runtimeMetrics = await connected.getMetrics();
    console.log(
      "runtime metrics:",
      `cpu=${runtimeMetrics.cpu_used_pct}`,
      `mem=${runtimeMetrics.mem_used_mib}/${runtimeMetrics.mem_total_mib}`,
      `disk=${runtimeMetrics.disk_used}/${runtimeMetrics.disk_total}`,
    );
  } catch (error) {
    console.log("runtime metrics warning:", formatError(error));
  }

  const listing = await connected.files.list("/workspace");
  console.log("workspace entries:", listing.length);

  const run = await connected.commands.run("sh", {
    args: ["-lc", "cat /workspace/built-by-template.txt && echo workflow-ok"],
  });
  console.log("run result:", run.exitCode, JSON.stringify(run.stdout), JSON.stringify(run.stderr));

  if (keepResources) {
    console.log("kept resources:", templateID, createdSandbox.sandboxId);
  }
} finally {
  if (!keepResources && createdSandbox) {
    try {
      await createdSandbox.delete();
      console.log("deleted sandbox:", createdSandbox.sandboxId);
    } catch (error) {
      console.log("delete sandbox warning:", formatError(error));
    }
  }
  if (!keepResources) {
    try {
      await Template.delete(templateID);
      console.log("deleted template:", templateID);
    } catch (error) {
      console.log("delete template warning:", formatError(error));
    }
  }
}

function mustEnv(name) {
  const value = (process.env[name] ?? "").trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function envEnabled(name) {
  return ["1", "true", "yes"].includes((process.env[name] ?? "").trim().toLowerCase());
}

function latestBuildLog(buildStatus) {
  if (buildStatus.logEntries?.length > 0) {
    return buildStatus.logEntries.at(-1).message;
  }
  if (buildStatus.logs?.length > 0) {
    return buildStatus.logs.at(-1);
  }
  return "";
}

function latestSandboxLog(logs) {
  if (logs.logs.length === 0) {
    return "";
  }
  return logs.logs.at(-1).message;
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

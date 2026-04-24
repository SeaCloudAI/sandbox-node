import { SandboxClient } from "../dist/index.js";

const baseUrl = mustEnv("SEACLOUD_BASE_URL");
const apiKey = mustEnv("SEACLOUD_API_KEY");
const runtimeBaseImage = mustEnv("SANDBOX_EXAMPLE_RUNTIME_BASE_IMAGE");
const keepResources = envEnabled("SANDBOX_EXAMPLE_KEEP_RESOURCES");

const client = new SandboxClient({
  baseUrl,
  apiKey,
  timeoutMs: 180_000,
});

await logMetricLine("control", () => client.metrics());
await logMetricLine("build", () => client.build.metrics());

const templateName = `node-full-workflow-${Date.now()}`;
const createdTemplate = await client.build.createTemplate({
  name: templateName,
  visibility: "personal",
  dockerfile: dockerfile(runtimeBaseImage),
});

const templateID = createdTemplate.templateID;
let buildID = createdTemplate.buildID ?? "";
console.log("template created:", templateID, buildID);

let createdSandbox;

try {
  if (!buildID) {
    buildID = (await client.build.getTemplate(templateID)).buildID ?? "";
  }
  if (!buildID) {
    throw new Error("buildID is empty");
  }

  const buildStatus = await waitForBuildReady(client, templateID, buildID);
  console.log("build ready:", templateID, buildID, buildStatus.status);

  const buildDetail = await client.build.getBuild(templateID, buildID);
  console.log("build detail:", buildDetail.status, buildDetail.image);

  try {
    const buildLogs = await client.build.getBuildLogs(templateID, buildID, {
      limit: 10,
      direction: "forward",
      source: "persistent",
    });
    console.log("build logs:", buildLogs.logs.length, latestBuildLog(buildLogs, buildStatus));
  } catch (error) {
    console.log("build logs warning:", formatError(error));
  }

  const templateDetail = await client.build.getTemplate(templateID);
  console.log("template detail:", templateDetail.name, templateDetail.imageSource, templateDetail.buildStatus);

  createdSandbox = await client.createSandbox({
    templateID,
    timeout: 1800,
    waitReady: true,
  });
  console.log("sandbox created:", createdSandbox.sandboxID, createdSandbox.status);

  const sandboxDetail = await createdSandbox.reload();
  console.log("sandbox detail:", sandboxDetail.state, sandboxDetail.status);

  try {
    const sandboxLogs = await sandboxDetail.logs({ limit: 10, direction: "forward" });
    console.log("sandbox logs:", sandboxLogs.logs.length, latestSandboxLog(sandboxLogs));
  } catch (error) {
    console.log("sandbox logs warning:", formatError(error));
  }

  const connected = await sandboxDetail.connect({ timeout: 1800 });
  console.log("sandbox connected:", connected.statusCode, connected.sandbox.sandboxID);

  const runtime = connected.sandbox.runtime;

  try {
    const runtimeMetrics = await runtime.metrics();
    console.log(
      "runtime metrics:",
      `cpu=${runtimeMetrics.cpu_used_pct}`,
      `mem=${runtimeMetrics.mem_used_mib}/${runtimeMetrics.mem_total_mib}`,
      `disk=${runtimeMetrics.disk_used}/${runtimeMetrics.disk_total}`,
    );
  } catch (error) {
    console.log("runtime metrics warning:", formatError(error));
  }

  const listing = await runtime.listDir({ path: "/workspace" });
  console.log("workspace entries:", listing.entries.length);

  const run = await runtime.run({
    cmd: "sh",
    args: ["-lc", "cat /workspace/built-by-template.txt && echo workflow-ok"],
  });
  console.log("run result:", run.exit_code, JSON.stringify(run.stdout), JSON.stringify(run.stderr));

  if (keepResources) {
    console.log("kept resources:", templateID, createdSandbox.sandboxID);
  }
} finally {
  if (!keepResources && createdSandbox) {
    try {
      await createdSandbox.delete();
      console.log("deleted sandbox:", createdSandbox.sandboxID);
    } catch (error) {
      console.log("delete sandbox warning:", formatError(error));
    }
  }
  if (!keepResources) {
    try {
      await client.build.deleteTemplate(templateID);
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

function dockerfile(runtimeBaseImage) {
  return [
    `FROM ${runtimeBaseImage}`,
    "RUN mkdir -p /workspace && printf 'hello from node full workflow\\n' >/workspace/built-by-template.txt",
    "",
  ].join("\n");
}

function firstNonEmptyLine(text) {
  for (const line of String(text).split("\n")) {
    const trimmed = line.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return "";
}

async function logMetricLine(name, fn) {
  try {
    console.log(`${name} metrics:`, firstNonEmptyLine(await fn()));
  } catch (error) {
    console.log(`${name} metrics warning:`, formatError(error));
  }
}

function latestBuildLog(buildLogs, buildStatus) {
  if (buildLogs.logs.length > 0) {
    return buildLogs.logs.at(-1).message;
  }
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

async function waitForBuildReady(client, templateID, buildID) {
  const deadline = Date.now() + 3 * 60_000;
  let last;

  while (Date.now() < deadline) {
    const status = await client.build.getBuildStatus(templateID, buildID, { limit: 20 });
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

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

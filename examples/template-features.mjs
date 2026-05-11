import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

import { Template } from "../dist/index.js";

const TERMINAL_BUILD_STATUSES = new Set(["ready", "failed", "error", "cancelled"]);

mustEnv("E2B_API_KEY");
const image = (process.env.SANDBOX_EXAMPLE_BUILD_IMAGE ?? "").trim() || "docker.io/library/alpine:3.20";
const keepResources = envEnabled("SANDBOX_EXAMPLE_KEEP_RESOURCES");

const templateName = `node-template-features-${Date.now()}:v1`;

let tempRoot = "";
let templateID = "";

try {
  tempRoot = await mkdtemp(path.join(tmpdir(), "sandbox-node-template-features-"));
  const dockerfilePath = await prepareDockerfileFixture(tempRoot, image);
  const linkedFile = path.join(tempRoot, "artifact-link.txt");

  const template = new Template()
    .fromDockerfile(dockerfilePath)
    .skipCache()
    .runCmd("printf 'extra build step from node template features\\n' >/workspace/extra-step.txt", { user: "root" })
    .copy(linkedFile, "/workspace/copied-link.txt", {
      mode: 0o600,
      resolveSymlinks: true,
      user: "root",
    });

  const request = JSON.parse(await Template.toJSON(template));
  console.log("template request:", request.fromImage, request.steps?.length ?? 0, request.startCmd ?? "");
  console.log("dockerfile preview:", dockerfilePreview(Template.toDockerfile(template)));

  const built = await Template.buildInBackground(template, templateName);
  templateID = built.templateId;
  console.log("build started:", built.templateId, built.buildId);

  const buildStatus = await waitForBuild(built.templateId, built.buildId);
  console.log("build finished:", buildStatus.status, latestBuildLog(buildStatus));
  if (buildStatus.status !== "ready") {
    throw new Error(`template build did not succeed: ${buildStatus.status}`);
  }

  const exists = await Template.exists(templateID);
  console.log("template exists:", exists);

  const detail = await Template.get(templateID);
  console.log("template detail:", detail.templateID, detail.buildStatus, (detail.names ?? []).join(","));

  if (keepResources) {
    console.log("kept template:", templateID);
  }
} finally {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
  }
  if (!keepResources && templateID) {
    try {
      await Template.delete(templateID);
      console.log("deleted template:", templateID);
    } catch (error) {
      console.log("delete template warning:", formatError(error));
    }
  }
}

async function prepareDockerfileFixture(root, image) {
  const source = path.join(root, "artifact.txt");
  const link = path.join(root, "artifact-link.txt");
  const dockerfilePath = path.join(root, "Dockerfile");

  await writeFile(source, "hello from node template features\n");
  await symlink(source, link);
  await writeFile(
    dockerfilePath,
    [
      `FROM ${image}`,
      "WORKDIR /workspace",
      "COPY ./artifact.txt /workspace/from-dockerfile.txt",
      'CMD ["sleep", "infinity"]',
      "",
    ].join("\n"),
  );

  return dockerfilePath;
}

async function waitForBuild(templateID, buildID) {
  let logsOffset = 0;
  for (;;) {
    const status = await Template.getBuildStatus({ templateId: templateID, buildId: buildID }, { logsOffset, limit: 100 });

    for (const entry of status.logEntries ?? []) {
      console.log("build log:", entry.level, entry.step, entry.message);
    }
    logsOffset += status.logEntries?.length ?? 0;

    if (TERMINAL_BUILD_STATUSES.has(status.status)) {
      return status;
    }

    await sleep(2_000);
  }
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

function dockerfilePreview(dockerfile) {
  return dockerfile.split("\n").slice(0, 4).join(" | ");
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

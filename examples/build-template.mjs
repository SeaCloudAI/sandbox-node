import { SandboxClient, templateBuild } from "../dist/index.js";
const baseUrl = (process.env.SEACLOUD_BASE_URL ?? "").trim();
if (!baseUrl) {
  throw new Error("SEACLOUD_BASE_URL is required");
}

const apiKey = (process.env.SEACLOUD_API_KEY ?? "").trim();
if (!apiKey) {
  throw new Error("SEACLOUD_API_KEY is required");
}

const image = (process.env.SANDBOX_EXAMPLE_BUILD_IMAGE ?? "").trim() || "docker.io/library/alpine:3.20";
const keepResources = ["1", "true", "yes"].includes((process.env.SANDBOX_EXAMPLE_KEEP_RESOURCES ?? "").trim().toLowerCase());

const client = new SandboxClient({ baseUrl, apiKey });
const alias = `node-build-example-${Date.now()}`;

const created = await client.build.createTemplate({
  name: alias,
  alias,
});

const aliased = await client.build.getTemplateByAlias(alias);
const resolved = await client.build.resolveTemplateRef(alias);

const requestedBuildID = `build-${Date.now().toString(16)}`;
await client.build.createBuild(
  created.templateID,
  requestedBuildID,
  templateBuild()
    .fromImage(image)
    .run("echo 'hello from node build example' >/tmp/built-by-node-example.txt")
    .toRequest(),
);

console.log(
  "created template:",
  created.templateID,
  "alias=",
  alias,
  "aliasLookup=",
  aliased.templateID,
  "resolved=",
  resolved.templateID,
);
console.log("triggered build:", requestedBuildID);

try {
  const buildStatus = await waitForBuildReady(client, created.templateID, requestedBuildID);
  const buildDetail = await client.build.getBuild(created.templateID, requestedBuildID);
  const history = await client.build.listBuilds(created.templateID);
  const detail = await client.build.getTemplate(created.templateID);
  console.log(
    "template detail:",
    detail.templateID,
    detail.builds?.length ?? 0,
    detail.extensions?.seacloud?.visibility,
    buildStatus.status,
    buildDetail.image,
    history.total,
  );
} finally {
  if (!keepResources) {
    await client.build.deleteTemplate(created.templateID);
    console.log("deleted template:", created.templateID);
  }
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

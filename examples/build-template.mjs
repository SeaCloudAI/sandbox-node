import { SandboxClient, Template, defaultBuildLogger, waitForFile } from "../dist/index.js";
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

const name = `node-build-example-${Date.now()}:v1`;
const built = await client.buildTemplate(
  new Template()
    .fromImage(image)
    .runCmd("echo 'hello from node build example' >/tmp/built-by-node-example.txt")
    .setReadyCmd(waitForFile("/tmp/built-by-node-example.txt")),
  name,
  {
    onBuildLogs: defaultBuildLogger(),
  },
);

try {
  const detail = built.template;
  console.log(
    "template detail:",
    detail.templateID,
    detail.builds?.length ?? 0,
    detail.extensions?.seacloud?.visibility,
    built.status,
    built.build?.image,
    built.buildID,
  );
} finally {
  if (!keepResources) {
    await client.deleteTemplate(built.templateID);
    console.log("deleted template:", built.templateID);
  }
}

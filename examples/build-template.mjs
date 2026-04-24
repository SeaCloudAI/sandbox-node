import { SandboxClient } from "../dist/index.js";
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

const created = await client.build.createTemplate({
  name: `node-build-example-${Date.now()}`,
  image,
});

console.log("created template:", created.templateID, created.buildID, created.names);

try {
  const detail = await client.build.getTemplate(created.templateID);
  console.log("template detail:", detail.templateID, detail.image, detail.visibility);
} finally {
  if (!keepResources) {
    await client.build.deleteTemplate(created.templateID);
    console.log("deleted template:", created.templateID);
  }
}

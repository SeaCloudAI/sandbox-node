import { Template, defaultBuildLogger, waitForFile } from "../dist/index.js";
if (!(process.env.E2B_API_KEY ?? "").trim()) {
  throw new Error("E2B_API_KEY is required");
}

const image = (process.env.SANDBOX_EXAMPLE_BUILD_IMAGE ?? "").trim() || "docker.io/library/alpine:3.20";
const keepResources = ["1", "true", "yes"].includes((process.env.SANDBOX_EXAMPLE_KEEP_RESOURCES ?? "").trim().toLowerCase());

const name = `node-build-example-${Date.now()}:v1`;
const built = await Template.build(
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
  const status = await Template.getBuildStatus({ templateId: built.templateId, buildId: built.buildId }, { limit: 10 });
  const detail = await Template.get(built.templateId);
  console.log(
    "template detail:",
    detail.templateID,
    detail.builds?.length ?? 0,
    detail.extensions?.visibility,
    status.status,
    built.buildId,
  );
} finally {
  if (!keepResources) {
    await Template.delete(built.templateId);
    console.log("deleted template:", built.templateId);
  }
}

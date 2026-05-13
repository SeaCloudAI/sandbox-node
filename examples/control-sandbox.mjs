import { Sandbox } from "../dist/index.js";
if (!(process.env.SEACLOUD_API_KEY ?? "").trim()) {
  throw new Error("SEACLOUD_API_KEY is required");
}

const templateID = (process.env.SANDBOX_EXAMPLE_TEMPLATE_ID ?? "").trim();
if (!templateID) {
  throw new Error("SANDBOX_EXAMPLE_TEMPLATE_ID is required");
}

const keepResources = ["1", "true", "yes"].includes((process.env.SANDBOX_EXAMPLE_KEEP_RESOURCES ?? "").trim().toLowerCase());

const created = await Sandbox.create(templateID, {
  timeout: 1800,
  waitReady: true,
});

console.log("created sandbox:", created.sandboxId, created.status, created.envdUrl);
if (created.sandboxDomain) {
  console.log("sandbox domain:", created.sandboxDomain);
}

try {
  await created.reload();
  console.log("sandbox detail:", created.sandboxId, created.state, created.status);
} finally {
  if (!keepResources) {
    await created.delete();
    console.log("deleted sandbox:", created.sandboxId);
  }
}

import { SandboxClient } from "../dist/index.js";
const baseUrl = (process.env.SEACLOUD_BASE_URL ?? "").trim();
if (!baseUrl) {
  throw new Error("SEACLOUD_BASE_URL is required");
}

const apiKey = (process.env.SEACLOUD_API_KEY ?? "").trim();
if (!apiKey) {
  throw new Error("SEACLOUD_API_KEY is required");
}

const templateID = (process.env.SANDBOX_EXAMPLE_TEMPLATE_ID ?? "").trim();
if (!templateID) {
  throw new Error("SANDBOX_EXAMPLE_TEMPLATE_ID is required");
}

const keepResources = ["1", "true", "yes"].includes((process.env.SANDBOX_EXAMPLE_KEEP_RESOURCES ?? "").trim().toLowerCase());

const client = new SandboxClient({ baseUrl, apiKey });

const created = await client.createSandbox({
  templateID,
  workspaceId: `node-example-${Date.now()}`,
  timeout: 1800,
  waitReady: true,
});

console.log("created sandbox:", created.sandboxID, created.status, created.envdUrl);
if (created.envdUrl) {
  console.log("bound runtime baseUrl:", created.runtime.baseUrl);
}

try {
  const detail = await created.reload();
  console.log("sandbox detail:", detail.sandboxID, detail.state, detail.status);

  const heartbeat = await client.sendHeartbeat(created.sandboxID, { status: "healthy" });
  console.log("heartbeat:", heartbeat.received, heartbeat.status, heartbeat.requestId);
} finally {
  if (!keepResources) {
    await created.delete();
    console.log("deleted sandbox:", created.sandboxID);
  }
}

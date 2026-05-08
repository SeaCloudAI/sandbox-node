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
const root = "/root/workspace";

const client = new SandboxClient({
  baseUrl,
  apiKey,
});

const created = await client.create(templateID, {
  timeout: 1800,
  waitReady: true,
});

try {
  const filePath = `${root}/node-cmd-example.txt`;

  await created.files.write(filePath, "hello from node example");

  const file = await created.files.read(filePath);
  console.log("file content:", file);

  const listing = await created.files.list(root);
  console.log("directory entries:", listing.length);

  const run = await created.commands.run("sh", {
    args: ["-lc", `cat ${filePath}`],
  });
  console.log("run result:", run.exitCode, JSON.stringify(run.stdout));

} finally {
  if (!keepResources) {
    await created.delete();
  }
}

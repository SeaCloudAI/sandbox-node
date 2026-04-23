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
const root = ((process.env.SANDBOX_EXAMPLE_SANDBOX_ROOT ?? "").trim() || "/root/workspace").replace(/\/+$/, "");

const client = new SandboxClient({ baseUrl, apiKey });

const created = await client.createSandbox({
  templateID,
  timeout: 1800,
  waitReady: true,
});

try {
  const runtime = created.runtime;
  const filePath = `${root}/node-cmd-example.txt`;

  await runtime.writeFile({
    path: filePath,
    data: new TextEncoder().encode("hello from node example"),
  });

  const file = await runtime.readFile({ path: filePath });
  console.log("file content:", await file.text());

  const listing = await runtime.listDir({ path: root, depth: 1 });
  console.log("directory entries:", listing.entries.length);

  const run = await runtime.run({
    cmd: "sh",
    args: ["-lc", `cat ${filePath}`],
  });
  console.log("run result:", run.exit_code, JSON.stringify(run.stdout));

  const stream = await runtime.start({
    process: { cmd: "cat" },
    tag: `node-cmd-example-${Date.now()}`,
  });

  try {
    const firstFrame = await stream.next();
    console.log("stream started:", firstFrame?.event?.start?.pid, firstFrame?.event?.start?.cmdId);
  } finally {
    await stream.close();
  }
} finally {
  if (!keepResources) {
    await created.delete();
  }
}

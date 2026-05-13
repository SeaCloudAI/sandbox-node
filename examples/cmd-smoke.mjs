import { Sandbox } from "../dist/index.js";
if (!(process.env.SEACLOUD_API_KEY ?? "").trim()) {
  throw new Error("SEACLOUD_API_KEY is required");
}

const templateID = (process.env.SANDBOX_EXAMPLE_TEMPLATE_ID ?? "").trim();
if (!templateID) {
  throw new Error("SANDBOX_EXAMPLE_TEMPLATE_ID is required");
}

const keepResources = ["1", "true", "yes"].includes((process.env.SANDBOX_EXAMPLE_KEEP_RESOURCES ?? "").trim().toLowerCase());
const root = "/root/workspace";

const created = await Sandbox.create(templateID, {
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

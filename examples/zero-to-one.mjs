import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Sandbox, Template, waitForPort } from "../dist/index.js";

mustEnv("SEACLOUD_API_KEY");

const baseTemplate = env("SANDBOX_EXAMPLE_BASE_TEMPLATE", "base");
const codeTemplate = env("SANDBOX_EXAMPLE_CODE_TEMPLATE", "code-interpreter");
const frontendTemplate = env("SANDBOX_EXAMPLE_FRONTEND_TEMPLATE", codeTemplate);
const keepResources = envEnabled("SANDBOX_EXAMPLE_KEEP_RESOURCES");

let baseSandbox;
let frontendSandbox;
let builtTemplateId = "";
let tempAppDir = "";

try {
  baseSandbox = await Sandbox.create(baseTemplate, {
    timeout: 1800,
    waitReady: true,
  });
  console.log("base sandbox:", baseSandbox.sandboxId, baseSandbox.sandboxDomain);

  await baseSandbox.files.write("/root/workspace/hello.txt", "hello from a sandbox\n");
  const hello = await baseSandbox.files.read("/root/workspace/hello.txt");
  console.log("file read:", String(hello).trim());

  const command = await baseSandbox.commands.run("sh", {
    args: ["-lc", "pwd && uname -a && ls -la /root/workspace"],
  });
  console.log("command exit:", command.exitCode);
  console.log(command.stdout.trim());

  await baseSandbox.setTimeout(1800);
  console.log("is running:", baseSandbox.isRunning());

  const paused = await baseSandbox.pause();
  console.log("paused:", paused);
  await baseSandbox.connect({ timeout: 1800 });
  console.log("resumed:", baseSandbox.isRunning());

  const codeSandbox = await Sandbox.create(codeTemplate, {
    timeout: 1800,
    waitReady: true,
  });
  try {
    const result = await codeSandbox.runCode("x = 41\nx + 1");
    console.log("code interpreter result:", result.text);
  } finally {
    if (!keepResources) {
      await codeSandbox.delete();
    }
  }

  frontendSandbox = await Sandbox.create(frontendTemplate, {
    timeout: 1800,
    waitReady: true,
  });
  await frontendSandbox.files.makeDir("/root/workspace/frontend");
  await frontendSandbox.files.write("/root/workspace/frontend/index.html", frontendHTML("runtime frontend"));
  await frontendSandbox.commands.run("python3", {
    args: ["-m", "http.server", "3000", "--bind", "0.0.0.0"],
    cwd: "/root/workspace/frontend",
    background: true,
    onStdout: (chunk) => process.stdout.write(chunk),
    onStderr: (chunk) => process.stderr.write(chunk),
  });
  console.log("frontend url:", frontendSandbox.getHost(3000));

  tempAppDir = await mkdtemp(join(tmpdir(), "sandbox-frontend-"));
  await writeFile(join(tempAppDir, "index.html"), frontendHTML("template frontend"));

  const built = await Template.build(
    new Template()
      .fromTemplate(baseTemplate)
      .copy(tempAppDir, "/workspace/frontend", { forceUpload: true })
      .setStartCmd(
        "cd /workspace/frontend && python3 -m http.server 3000 --bind 0.0.0.0",
        waitForPort(3000),
      ),
    `node-local-frontend-${Date.now()}:v1`,
    {
      wait: true,
      pollIntervalMs: 2_000,
      requestTimeoutMs: 180_000,
    },
  );
  builtTemplateId = built.templateId;
  console.log("built template:", built.templateId, built.buildId);

  if (keepResources) {
    console.log("kept resources:", {
      baseSandbox: baseSandbox.sandboxId,
      frontendSandbox: frontendSandbox.sandboxId,
      builtTemplateId,
    });
  }
} finally {
  if (tempAppDir) {
    await rm(tempAppDir, { recursive: true, force: true });
  }
  if (!keepResources && frontendSandbox) {
    await frontendSandbox.delete();
  }
  if (!keepResources && baseSandbox) {
    await baseSandbox.delete();
  }
  if (!keepResources && builtTemplateId) {
    await Template.delete(builtTemplateId);
  }
}

function frontendHTML(title) {
  return `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>${title}</title></head>
  <body>
    <h1>${title}</h1>
    <p>Served from a SeaCloudAI sandbox.</p>
  </body>
</html>
`;
}

function env(name, fallback) {
  return (process.env[name] ?? "").trim() || fallback;
}

function mustEnv(name) {
  const value = env(name, "");
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function envEnabled(name) {
  return ["1", "true", "yes"].includes(env(name, "").toLowerCase());
}

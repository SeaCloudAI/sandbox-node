import { Sandbox } from "../dist/index.js";

mustEnv("SEACLOUD_API_KEY");
const templateID = mustEnv("SANDBOX_EXAMPLE_TEMPLATE_ID");
const keepResources = envEnabled("SANDBOX_EXAMPLE_KEEP_RESOURCES");
if (looksLikeBaseTemplate(templateID)) {
  console.log("warning: code-interpreter.mjs expects a code-interpreter template; base is usually not enough");
}

let sandbox;

try {
  sandbox = await Sandbox.create(templateID, {
    timeout: 1800,
    waitReady: true,
  });
  console.log("sandbox created:", sandbox.sandboxId, sandbox.status);

  const python1 = await sandbox.runCode("x = 41\nx");
  const python2 = await sandbox.runCode("x + 1");
  console.log("default python context:", python1.text, "->", python2.text);

  const pythonContext = await sandbox.createCodeContext({
    language: "python",
    cwd: "/workspace",
    timeoutMs: 30_000,
  });
  await sandbox.runCode("name = 'node-sdk'", { context: pythonContext });
  const pythonIsolated = await sandbox.runCode("name.upper()", { context: pythonContext });
  console.log("explicit python context:", pythonIsolated.text);

  const bashContext = await sandbox.createCodeContext({
    language: "bash",
    cwd: "/workspace",
    timeoutMs: 10_000,
  });
  const bashRun = await sandbox.runCode("pwd && echo bash-ok", { context: bashContext });
  console.log("bash profile output:", JSON.stringify(bashRun.logs.stdout));

  const contexts = await sandbox.listCodeContexts();
  console.log("contexts:", contexts.map((context) => ({
    contextId: context.contextId,
    language: context.language,
    cwd: context.cwd,
  })));

  await sandbox.restartCodeContext(pythonContext);
  await sandbox.removeCodeContext(bashContext);
  await sandbox.removeCodeContext(pythonContext);
} finally {
  if (!keepResources && sandbox) {
    await sandbox.delete().catch((error) => {
      console.log("delete sandbox warning:", formatError(error));
    });
  }
}

function mustEnv(name) {
  const value = (process.env[name] ?? "").trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function envEnabled(name) {
  return ["1", "true", "yes"].includes((process.env[name] ?? "").trim().toLowerCase());
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

function looksLikeBaseTemplate(value) {
  const normalized = value.trim().toLowerCase();
  return normalized === "base" || normalized.startsWith("tpl-base");
}

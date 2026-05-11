import { randomUUID } from "node:crypto";

import type { FileRequest, UploadBytesRequest } from "./cmd/index.js";
import { APIError, ConfigurationError, NotFoundError } from "./core/errors.js";
import type { SandboxRuntime } from "./runtime.js";

export interface CodeOutputChunk {
  error: boolean;
  line: string;
  timestamp: number;
}

export interface CodeExecutionError {
  name?: string;
  message: string;
  traceback?: string;
}

export interface CodeExecutionResult {
  text?: string;
  png?: string;
  chart?: Record<string, unknown>;
  json?: unknown;
}

export interface CodeExecutionLogs {
  stdout: string[];
  stderr: string[];
}

export interface CodeContextCreateOptions {
  cwd?: string;
  language?: string;
  timeout?: number;
}

export class CodeContext {
  readonly contextId: string;
  readonly cwd?: string;
  readonly language: string;
  readonly timeout?: number;

  constructor(options: {
    contextId?: string;
    cwd?: string;
    language?: string;
    timeout?: number;
  } = {}) {
    this.contextId = options.contextId ?? randomUUID();
    this.cwd = options.cwd;
    this.language = normalizeLanguage(options.language);
    this.timeout = options.timeout;
  }
}

export interface RunCodeOptions {
  language?: string;
  cwd?: string;
  timeout?: number;
  envs?: Record<string, string>;
  context?: CodeContext;
  onStdout?: (chunk: CodeOutputChunk) => void;
  onStderr?: (chunk: CodeOutputChunk) => void;
  onResult?: (result: CodeExecutionResult) => void;
  onResults?: (result: CodeExecutionResult) => void;
  onError?: (error: CodeExecutionError) => void;
}

export class CodeExecution {
  readonly results: CodeExecutionResult[];
  readonly logs: CodeExecutionLogs;
  readonly error?: CodeExecutionError;
  readonly executionCount: number;

  constructor(options: {
    results?: CodeExecutionResult[];
    logs?: Partial<CodeExecutionLogs>;
    error?: CodeExecutionError;
    executionCount?: number;
  } = {}) {
    this.results = options.results ? [...options.results] : [];
    this.logs = {
      stdout: options.logs?.stdout ? [...options.logs.stdout] : [],
      stderr: options.logs?.stderr ? [...options.logs.stderr] : [],
    };
    this.error = options.error;
    this.executionCount = options.executionCount ?? 1;
  }

  get text(): string {
    const textResults = this.results
      .map((result) => result.text)
      .filter((value): value is string => typeof value === "string" && value.length > 0);
    if (textResults.length > 0) {
      return textResults.join("\n");
    }
    return [...this.logs.stdout, ...this.logs.stderr].join("");
  }

  toJSON(): {
    results: CodeExecutionResult[];
    logs: CodeExecutionLogs;
    error?: CodeExecutionError;
    executionCount: number;
  } {
    return {
      results: [...this.results],
      logs: {
        stdout: [...this.logs.stdout],
        stderr: [...this.logs.stderr],
      },
      error: this.error ? { ...this.error } : undefined,
      executionCount: this.executionCount,
    };
  }
}

type LanguageSpec = {
  extension: string;
  command: string;
  args: (scriptPath: string) => string[];
  buildSource: (code: string, resultPath: string) => string;
  resultFile: boolean;
};

type CodeContextPayload = {
  results?: CodeExecutionResult[];
  logs?: Partial<CodeExecutionLogs>;
  error?: CodeExecutionError;
  executionCount?: number;
};

type RunCodeCallbacks = Pick<RunCodeOptions, "onStdout" | "onStderr" | "onError"> & {
  onResult?: (result: CodeExecutionResult) => void;
};

const codeFileBase = "/root/workspace/.seacloud-code-interpreter";
const contextFileBase = "/root/workspace/.seacloud-code-context";
const contextPayloadPrefix = "__SEACLOUD_CODE_CONTEXT__";

export async function runCodeWithRuntime(
  runtime: SandboxRuntime,
  code: string,
  options: RunCodeOptions = {},
): Promise<CodeExecution> {
  if (!code.trim()) {
    throw new ConfigurationError("code is required");
  }

  const spec = languageSpec(options.language);
  const id = randomUUID();
  const scriptPath = `${codeFileBase}-${id}${spec.extension}`;
  const resultPath = `${codeFileBase}-${id}.result.json`;

  await runtime.writeFile({
    path: scriptPath,
    data: new TextEncoder().encode(spec.buildSource(code, resultPath)),
  } satisfies UploadBytesRequest);

  const process: {
    cmd: string;
    args: string[];
    envs?: Record<string, string>;
    cwd?: string;
  } = {
    cmd: spec.command,
    args: spec.args(scriptPath),
  };
  if (options.envs) {
    process.envs = options.envs;
  }
  if (options.cwd) {
    process.cwd = options.cwd;
  }

  const stream = await runtime.start({
    process,
    timeout: options.timeout,
  });

  let cmdId = "";
  const streamedStdout: string[] = [];
  const streamedStderr: string[] = [];
  let endEvent: { exited?: boolean; status?: string; error?: string | null } | undefined;
  const callbacks = resolveCallbacks(options);

  try {
    for (;;) {
      const frame = await stream.next();
      if (!frame) {
        break;
      }
      if ("start" in frame.event) {
        cmdId = frame.event.start.cmdId ?? "";
        continue;
      }
      if ("data" in frame.event) {
        const now = Date.now() * 1000;
        const stdoutChunk = decodeStreamData(frame.event.data.stdout);
        const stderrChunk = decodeStreamData(frame.event.data.stderr);
        if (stdoutChunk) {
          streamedStdout.push(stdoutChunk);
          callbacks.onStdout?.({ error: false, line: stdoutChunk, timestamp: now });
        }
        if (stderrChunk) {
          streamedStderr.push(stderrChunk);
          callbacks.onStderr?.({ error: true, line: stderrChunk, timestamp: now });
        }
      }
      if ("end" in frame.event) {
        endEvent = frame.event.end;
        break;
      }
    }

    const result = cmdId && spec.resultFile
      ? await getResultWithRetry(runtime, cmdId)
      : {
        stdout: streamedStdout.join(""),
        stderr: streamedStderr.join(""),
        exitCode: exitCodeFromEndEvent(endEvent),
        error: endEvent?.error ?? undefined,
      };

    const payload = spec.resultFile
      ? await readResultPayload(runtime, resultPath)
      : { results: [] as CodeExecutionResult[], error: undefined as CodeExecutionError | undefined };

    const error = payload.error ?? buildExecutionError(
      result.exitCode,
      result.stderr,
      "error" in result ? result.error : undefined,
    );
    if (error) {
      callbacks.onError?.(error);
    }
    for (const item of payload.results) {
      callbacks.onResult?.(item);
    }

    return new CodeExecution({
      results: payload.results,
      logs: {
        stdout: splitLogLines(result.stdout ?? streamedStdout.join("")),
        stderr: splitLogLines(result.stderr ?? streamedStderr.join("")),
      },
      error,
      executionCount: 1,
    });
  } finally {
    await Promise.allSettled([
      runtime.remove({ path: scriptPath }),
      runtime.remove({ path: resultPath }),
    ]);
    await stream.close();
  }
}

export class PythonCodeContextManager {
  readonly #runtime: SandboxRuntime;
  readonly #contexts = new Map<string, PythonCodeContextSession>();
  #defaultContext?: PythonCodeContextSession;

  constructor(runtime: SandboxRuntime) {
    this.#runtime = runtime;
  }

  async runDefault(code: string, options: RunCodeOptions = {}): Promise<CodeExecution> {
    const context = this.#defaultContext ?? new PythonCodeContextSession(this.#runtime, new CodeContext({
      contextId: "default",
      cwd: options.cwd,
      language: options.language,
      timeout: options.timeout,
    }), true);
    this.#defaultContext = context;
    return context.execute(code, options);
  }

  async createContext(options: CodeContextCreateOptions = {}): Promise<CodeContext> {
    const context = new CodeContext(options);
    if (!isPythonLanguage(context.language)) {
      throw new ConfigurationError("code contexts currently support python only");
    }
    const session = new PythonCodeContextSession(this.#runtime, context);
    this.#contexts.set(context.contextId, session);
    await session.ensureStarted();
    return session.context;
  }

  listContexts(): CodeContext[] {
    return [...this.#contexts.values()].map((session) => session.context);
  }

  async restartContext(contextOrId: string | CodeContext): Promise<CodeContext> {
    const session = this.resolveContext(contextOrId);
    await session.restart();
    return session.context;
  }

  async removeContext(contextOrId: string | CodeContext): Promise<void> {
    const session = this.resolveContext(contextOrId);
    this.#contexts.delete(session.context.contextId);
    await session.close();
  }

  async runInContext(context: CodeContext, code: string, options: RunCodeOptions = {}): Promise<CodeExecution> {
    return this.resolveContext(context).execute(code, options);
  }

  async closeAll(): Promise<void> {
    const sessions = [...this.#contexts.values()];
    this.#contexts.clear();
    await Promise.allSettled(sessions.map((session) => session.close()));
    if (this.#defaultContext) {
      const session = this.#defaultContext;
      this.#defaultContext = undefined;
      await session.close().catch(() => undefined);
    }
  }

  resolveContext(contextOrId: string | CodeContext): PythonCodeContextSession {
    const contextId = typeof contextOrId === "string" ? contextOrId : contextOrId.contextId;
    const session = this.#contexts.get(contextId);
    if (!session) {
      throw new NotFoundError({ statusCode: 404, message: `code context not found: ${contextId}` });
    }
    return session;
  }
}

class PythonCodeContextSession {
  readonly #runtime: SandboxRuntime;
  readonly #defaultContext: boolean;
  context: CodeContext;
  #scriptPath = "";
  #pid = 0;
  #buffer = "";
  #stream?: Awaited<ReturnType<SandboxRuntime["start"]>>;
  #sequence: Promise<void> = Promise.resolve();
  #closed = false;

  constructor(runtime: SandboxRuntime, context: CodeContext, defaultContext = false) {
    this.#runtime = runtime;
    this.context = context;
    this.#defaultContext = defaultContext;
  }

  async ensureStarted(): Promise<void> {
    if (this.#stream) {
      return;
    }
    await this.start();
  }

  async execute(code: string, options: RunCodeOptions = {}): Promise<CodeExecution> {
    if (!code.trim()) {
      throw new ConfigurationError("code is required");
    }
    return this.enqueue(async () => {
      await this.ensureStarted();
      const callbacks = resolveCallbacks(options);
      const cwd = options.cwd ?? this.context.cwd;
      const timeout = options.timeout ?? this.context.timeout;
      const language = normalizeLanguage(options.language ?? this.context.language);
      if (!isPythonLanguage(language)) {
        throw new ConfigurationError("code contexts currently support python only");
      }

      await this.#runtime.sendInput({
        process: { pid: this.#pid },
        input: {
          stdin: encodeStreamData(`${JSON.stringify({
            code: Buffer.from(code, "utf8").toString("base64"),
            cwd,
            timeout,
          })}\n`),
        },
      });

      return this.readExecutionPayload(callbacks);
    });
  }

  async restart(): Promise<void> {
    await this.enqueue(async () => {
      await this.close();
      this.#closed = false;
      await this.start();
    });
  }

  async close(): Promise<void> {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    const stream = this.#stream;
    this.#stream = undefined;
    if (this.#pid) {
      try {
        await this.#runtime.sendSignal({ process: { pid: this.#pid }, signal: "SIGNAL_SIGKILL" });
      } catch (error) {
        if (!isMissingProcessError(error)) {
          throw error;
        }
      }
    }
    if (this.#scriptPath) {
      await this.#runtime.remove({ path: this.#scriptPath }).catch(() => undefined);
      this.#scriptPath = "";
    }
    this.#pid = 0;
    if (stream) {
      await stream.close();
    }
  }

  async start(): Promise<void> {
    const id = this.#defaultContext ? "default" : this.context.contextId;
    this.#scriptPath = `${contextFileBase}-${id}.py`;
    await this.#runtime.writeFile({
      path: this.#scriptPath,
      data: new TextEncoder().encode(buildPythonContextServer()),
    } satisfies UploadBytesRequest);
    const process: {
      cmd: string;
      args: string[];
      cwd?: string;
    } = {
      cmd: "python3",
      args: ["-u", this.#scriptPath],
    };
    if (this.context.cwd) {
      process.cwd = this.context.cwd;
    }

    this.#stream = await this.#runtime.start({
      process,
      stdin: true,
      timeout: this.context.timeout,
    });
    for (;;) {
      const frame = await this.#stream.next();
      if (!frame) {
        throw new ConfigurationError("code context stream ended before start frame");
      }
      if ("start" in frame.event) {
        this.#pid = frame.event.start.pid;
        break;
      }
    }
  }

  async readExecutionPayload(callbacks: RunCodeCallbacks): Promise<CodeExecution> {
    const stream = this.#stream;
    if (!stream) {
      throw new APIError({ statusCode: 500, message: "code context stream closed" });
    }
    for (;;) {
      const newline = this.#buffer.indexOf("\n");
      if (newline >= 0) {
        const line = this.#buffer.slice(0, newline);
        this.#buffer = this.#buffer.slice(newline + 1);
        if (!line.startsWith(contextPayloadPrefix)) {
          continue;
        }
        const payload = JSON.parse(line.slice(contextPayloadPrefix.length)) as CodeContextPayload;
        const execution = codeExecutionFromPayload(payload);
        emitCallbacks(execution, callbacks);
        return execution;
      }
      const frame = await stream.next();
      if (!frame) {
        throw new APIError({ statusCode: 500, message: "code context stream closed" });
      }
      if ("data" in frame.event) {
        this.#buffer += decodeStreamData(frame.event.data.stdout);
        const stderr = decodeStreamData(frame.event.data.stderr);
        if (stderr.trim()) {
          throw new APIError({
            statusCode: 500,
            message: firstNonEmptyLine(stderr) || "code context execution failed",
          });
        }
      }
      if ("end" in frame.event) {
        throw new APIError({ statusCode: 500, message: "code context stream closed" });
      }
    }
  }

  async enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.#sequence;
    let release!: () => void;
    this.#sequence = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

function languageSpec(language?: string): LanguageSpec {
  const normalized = normalizeLanguage(language);
  switch (normalized) {
    case "python":
    case "py":
      return {
        extension: ".py",
        command: "python3",
        args: (scriptPath) => ["-u", scriptPath],
        buildSource: buildPythonWrapper,
        resultFile: true,
      };
    case "javascript":
    case "js":
      return {
        extension: ".mjs",
        command: "node",
        args: (scriptPath) => [scriptPath],
        buildSource: (code) => code,
        resultFile: false,
      };
    case "typescript":
    case "ts":
      return {
        extension: ".ts",
        command: "tsx",
        args: (scriptPath) => [scriptPath],
        buildSource: (code) => code,
        resultFile: false,
      };
    case "bash":
    case "sh":
      return {
        extension: ".sh",
        command: "bash",
        args: (scriptPath) => [scriptPath],
        buildSource: (code) => code,
        resultFile: false,
      };
    case "r":
      return {
        extension: ".R",
        command: "Rscript",
        args: (scriptPath) => [scriptPath],
        buildSource: (code) => code,
        resultFile: false,
      };
    case "java":
      return {
        extension: ".jsh",
        command: "jshell",
        args: (scriptPath) => ["--execution", "local", scriptPath],
        buildSource: (code) => code,
        resultFile: false,
      };
    default:
      throw new ConfigurationError(`unsupported code language: ${language}`);
  }
}

function normalizeLanguage(language?: string): string {
  return (language ?? "python").trim().toLowerCase();
}

export function isPythonLanguage(language?: string): boolean {
  const normalized = normalizeLanguage(language);
  return normalized === "python" || normalized === "py";
}

export async function getResultWithRetry(
  runtime: SandboxRuntime,
  cmdId: string,
  attempts = 40,
  delayMs = 50,
): Promise<{ stdout: string; stderr: string; exitCode: number; error?: string }> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await runtime.getResult({ cmdId });
    } catch (error) {
      if (!(error instanceof NotFoundError)) {
        throw error;
      }
      const message = String(error.message || "").toLowerCase();
      if (!message.includes("process not found") && !message.includes("not finished")) {
        throw error;
      }
      lastError = error;
      if (attempt === attempts - 1) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError instanceof Error ? lastError : new APIError({ statusCode: 404, message: "process not found or not finished" });
}

function exitCodeFromEndEvent(endEvent?: { exited?: boolean; status?: string; error?: string | null }): number {
  const status = String(endEvent?.status ?? "");
  const match = status.match(/exit status (\d+)/i);
  if (match) {
    return Number.parseInt(match[1] || "0", 10);
  }
  if (endEvent?.error) {
    return 1;
  }
  if (endEvent?.exited === false) {
    return 1;
  }
  return 0;
}

function resolveCallbacks(options: RunCodeOptions): RunCodeCallbacks {
  return {
    onStdout: options.onStdout,
    onStderr: options.onStderr,
    onError: options.onError,
    onResult: options.onResult ?? options.onResults,
  };
}

function emitCallbacks(execution: CodeExecution, callbacks: RunCodeCallbacks): void {
  let timestamp = Date.now() * 1000;
  for (const line of execution.logs.stdout) {
    callbacks.onStdout?.({ error: false, line, timestamp });
    timestamp += 1;
  }
  for (const line of execution.logs.stderr) {
    callbacks.onStderr?.({ error: true, line, timestamp });
    timestamp += 1;
  }
  for (const result of execution.results) {
    callbacks.onResult?.(result);
  }
  if (execution.error) {
    callbacks.onError?.(execution.error);
  }
}

function codeExecutionFromPayload(payload: CodeContextPayload): CodeExecution {
  return new CodeExecution({
    results: Array.isArray(payload.results) ? payload.results : [],
    logs: {
      stdout: Array.isArray(payload.logs?.stdout) ? payload.logs.stdout : [],
      stderr: Array.isArray(payload.logs?.stderr) ? payload.logs.stderr : [],
    },
    error: payload.error,
    executionCount: payload.executionCount ?? 1,
  });
}

function buildExecutionError(exitCode: number | undefined, stderr: string, runtimeError?: string): CodeExecutionError | undefined {
  if ((exitCode ?? 0) === 0 && !runtimeError) {
    return undefined;
  }
  const message = firstNonEmptyLine(runtimeError || stderr) || `code execution failed with exit code ${exitCode ?? 1}`;
  return { message };
}

async function readResultPayload(
  runtime: SandboxRuntime,
  path: string,
): Promise<{ results: CodeExecutionResult[]; error?: CodeExecutionError }> {
  try {
    const response = await runtime.readFile({ path } satisfies FileRequest);
    const body = await response.text();
    if (!body.trim()) {
      return { results: [] };
    }
    const parsed = JSON.parse(body) as {
      results?: CodeExecutionResult[];
      error?: CodeExecutionError;
    };
    return {
      results: Array.isArray(parsed.results) ? parsed.results : [],
      error: parsed.error,
    };
  } catch {
    return { results: [] };
  }
}

function splitLogLines(value: string): string[] {
  if (!value) {
    return [];
  }
  const lines = value.match(/[^\n]*\n|[^\n]+$/g);
  return lines ? [...lines] : [value];
}

function firstNonEmptyLine(value: string): string {
  for (const line of value.split("\n")) {
    const trimmed = line.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return "";
}

function decodeStreamData(value?: string): string {
  if (!value) {
    return "";
  }
  return Buffer.from(value, "base64").toString("utf8");
}

function encodeStreamData(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

function isMissingProcessError(error: unknown): boolean {
  if (error instanceof NotFoundError) {
    return true;
  }
  if (!(error instanceof APIError)) {
    return false;
  }
  const message = [error.message, error.detail, error.body].join(" ").toLowerCase();
  return message.includes("no such process") || message.includes("esrch");
}

function buildPythonWrapper(code: string, resultPath: string): string {
  const encodedCode = Buffer.from(code, "utf8").toString("base64");
  return String.raw`import ast
import base64
import io
import json
import os
import traceback

os.environ.setdefault("MPLBACKEND", "Agg")

RESULT_PATH = ${JSON.stringify(resultPath)}
USER_CODE = base64.b64decode(${JSON.stringify(encodedCode)}).decode("utf-8")
payload = {"results": [], "error": None}


def _write_payload():
    with open(RESULT_PATH, "w", encoding="utf-8") as handle:
        json.dump(payload, handle)


${pythonResultHelpers()}

namespace = {"__name__": "__main__", "display": display, "_emit_result": _emit_result}
_install_matplotlib_hook()

try:
    tree = ast.parse(USER_CODE, filename="<seacloud-code>", mode="exec")
    if tree.body and isinstance(tree.body[-1], ast.Expr):
        last_value = tree.body[-1].value
        tree.body[-1] = ast.Assign(
            targets=[ast.Name(id="__seacloud_last_result", ctx=ast.Store())],
            value=last_value,
        )
        tree.body.append(
            ast.Expr(
                value=ast.Call(
                    func=ast.Name(id="_emit_result", ctx=ast.Load()),
                    args=[ast.Name(id="__seacloud_last_result", ctx=ast.Load())],
                    keywords=[],
                )
            )
        )
    ast.fix_missing_locations(tree)
    exec(compile(tree, "<seacloud-code>", "exec"), namespace, namespace)
except Exception as exc:
    payload["error"] = {
        "name": exc.__class__.__name__,
        "message": str(exc),
        "traceback": traceback.format_exc(),
    }
    _write_payload()
    raise
else:
    _write_payload()
`;
}

function buildPythonContextServer(): string {
  return String.raw`import ast
import base64
import contextlib
import io
import json
import os
import sys
import traceback

os.environ.setdefault("MPLBACKEND", "Agg")

SENTINEL = ${JSON.stringify(contextPayloadPrefix)}
namespace = {"__name__": "__main__"}
execution_count = 0


def _split_log_lines(value):
    if not value:
        return []
    return value.splitlines(True) or [value]


${pythonResultHelpers()}

while True:
    line = sys.stdin.readline()
    if not line:
        break
    request = json.loads(line)
    user_code = base64.b64decode(request["code"]).decode("utf-8")
    cwd = request.get("cwd")
    payload = {
        "results": [],
        "logs": {"stdout": [], "stderr": []},
        "error": None,
        "executionCount": execution_count + 1,
    }
    namespace["display"] = display
    namespace["_emit_result"] = _emit_result
    stdout_buffer = io.StringIO()
    stderr_buffer = io.StringIO()
    previous_cwd = os.getcwd()
    try:
        if cwd:
            os.chdir(cwd)
        globals()["payload"] = payload
        globals()["_install_matplotlib_hook"]()
        with contextlib.redirect_stdout(stdout_buffer), contextlib.redirect_stderr(stderr_buffer):
            tree = ast.parse(user_code, filename="<seacloud-context>", mode="exec")
            if tree.body and isinstance(tree.body[-1], ast.Expr):
                last_value = tree.body[-1].value
                tree.body[-1] = ast.Assign(
                    targets=[ast.Name(id="__seacloud_last_result", ctx=ast.Store())],
                    value=last_value,
                )
                tree.body.append(
                    ast.Expr(
                        value=ast.Call(
                            func=ast.Name(id="_emit_result", ctx=ast.Load()),
                            args=[ast.Name(id="__seacloud_last_result", ctx=ast.Load())],
                            keywords=[],
                        )
                    )
                )
            ast.fix_missing_locations(tree)
            execution_count += 1
            payload["executionCount"] = execution_count
            exec(compile(tree, "<seacloud-context>", "exec"), namespace, namespace)
    except Exception as exc:
        payload["error"] = {
            "name": exc.__class__.__name__,
            "message": str(exc),
            "traceback": traceback.format_exc(),
        }
    finally:
        if cwd:
            os.chdir(previous_cwd)
    payload["logs"]["stdout"] = _split_log_lines(stdout_buffer.getvalue())
    payload["logs"]["stderr"] = _split_log_lines(stderr_buffer.getvalue())
    sys.stdout.write(SENTINEL + json.dumps(payload) + "\n")
    sys.stdout.flush()
`;
}

function pythonResultHelpers(): string {
  return String.raw`def _chart_payload(figure):
    chart = {
        "type": "unknown",
        "title": None,
        "x_label": None,
        "y_label": None,
        "x_unit": None,
        "y_unit": None,
        "elements": [],
    }
    axes = figure.axes[0] if getattr(figure, "axes", None) else None
    if axes is None:
        return chart
    chart["title"] = axes.get_title() or None
    chart["x_label"] = axes.get_xlabel() or None
    chart["y_label"] = axes.get_ylabel() or None

    if getattr(axes, "containers", None):
        chart["type"] = "bar"
        for container in axes.containers:
            label = container.get_label()
            for patch in getattr(container, "patches", []):
                chart["elements"].append({
                    "label": str(getattr(patch, "get_x", lambda: 0)() + getattr(patch, "get_width", lambda: 0)() / 2),
                    "group": None if label == "_nolegend_" else label,
                    "value": float(getattr(patch, "get_height", lambda: 0)()),
                })
        tick_labels = [tick.get_text() for tick in axes.get_xticklabels()]
        for index, tick in enumerate(tick_labels):
            if index < len(chart["elements"]) and tick:
                chart["elements"][index]["label"] = tick
        return chart

    if getattr(axes, "lines", None):
        chart["type"] = "line"
        for line in axes.lines:
            group = line.get_label()
            x_values = list(line.get_xdata())
            y_values = list(line.get_ydata())
            for x_value, y_value in zip(x_values, y_values):
                chart["elements"].append({
                    "label": str(x_value),
                    "group": None if group == "_nolegend_" else group,
                    "value": float(y_value),
                })
        return chart

    if getattr(axes, "collections", None):
        chart["type"] = "scatter"
        for collection in axes.collections:
            offsets = getattr(collection, "get_offsets", lambda: [])()
            for point in offsets:
                try:
                    x_value = float(point[0])
                    y_value = float(point[1])
                except Exception:
                    continue
                chart["elements"].append({
                    "label": str(x_value),
                    "group": None,
                    "value": y_value,
                })
        return chart

    return chart


def _emit_result(value):
    if value is None:
        return

    try:
        import matplotlib.figure

        if isinstance(value, matplotlib.figure.Figure):
            buffer = io.BytesIO()
            value.savefig(buffer, format="png", bbox_inches="tight")
            payload["results"].append({
                "png": base64.b64encode(buffer.getvalue()).decode("ascii"),
                "chart": _chart_payload(value),
            })
            return
    except Exception:
        pass

    try:
        from PIL import Image

        if isinstance(value, Image.Image):
            buffer = io.BytesIO()
            value.save(buffer, format="PNG")
            payload["results"].append({
                "png": base64.b64encode(buffer.getvalue()).decode("ascii"),
            })
            return
    except Exception:
        pass

    try:
        import pandas as pd

        if isinstance(value, pd.DataFrame):
            payload["results"].append({
                "text": value.to_string(),
                "json": value.to_dict(orient="records"),
            })
            return
    except Exception:
        pass

    if isinstance(value, (str, int, float, bool, list, dict)):
        payload["results"].append({
            "text": value if isinstance(value, str) else repr(value),
            "json": value,
        })
        return

    payload["results"].append({"text": repr(value)})


def display(*values):
    for value in values:
        _emit_result(value)


def _install_matplotlib_hook():
    try:
        import matplotlib._pylab_helpers
        import matplotlib.pyplot as plt

        def _patched_show(*args, **kwargs):
            managers = matplotlib._pylab_helpers.Gcf.get_all_fig_managers()
            for manager in managers:
                figure = getattr(getattr(manager, "canvas", None), "figure", None)
                if figure is not None:
                    _emit_result(figure)
            plt.close("all")
            return None

        plt.show = _patched_show
    except Exception:
        pass`;
}

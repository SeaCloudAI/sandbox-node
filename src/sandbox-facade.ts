import { createHash } from "node:crypto";
import { GatewayClient } from "./gateway-client.js";
import type {
  CmdRequestOptions,
  EntryInfo as RawEntryInfo,
  FilesystemEvent as RawFilesystemEvent,
  ProcessInfo,
  ProcessStream,
  ProxyRequest,
  PtySize,
} from "./cmd/index.js";
import type { CodeContextCreateOptions, CodeExecution, RunCodeOptions } from "./code-interpreter.js";
import { CodeContext, PythonCodeContextManager, getResultWithRetry, isPythonLanguage, runCodeWithRuntime } from "./code-interpreter.js";
import { resolveGatewayOptions } from "./config.js";
import type {
  ConnectSandboxRequest,
  ListSandboxesParams,
  RefreshSandboxRequest,
  SandboxDetail,
  SandboxLogsParams,
  SandboxLogsResponse,
  TimeoutRequest,
} from "./control/index.js";
import type { ClientOptions } from "./core/transport.js";
import { APIError, ConfigurationError, NotFoundError } from "./core/errors.js";
import type { SandboxRuntime } from "./runtime.js";
import type { ListedSandboxInstance, SandboxDetailInstance } from "./sandbox.js";

type HighLevelClientOptions = {
  fetch?: ClientOptions["fetch"];
  requestTimeoutMs?: number;
  debug?: ClientOptions["debug"];
  logger?: ClientOptions["logger"];
};

export interface SandboxCreateOptions {
  fetch?: ClientOptions["fetch"];
  requestTimeoutMs?: number;
  debug?: ClientOptions["debug"];
  logger?: ClientOptions["logger"];
  template: string;
  timeout?: number;
  autoPause?: boolean;
  metadata?: Record<string, string>;
  envs?: Record<string, string>;
  waitReady?: boolean;
}

type SandboxCreateOverrides = Omit<SandboxCreateOptions, "template">;

export interface SandboxConnectOptions {
  fetch?: ClientOptions["fetch"];
  requestTimeoutMs?: number;
  debug?: ClientOptions["debug"];
  logger?: ClientOptions["logger"];
  timeout?: number;
}

export interface SandboxUrlOptions {
  user?: string;
  useSignatureExpiration?: number;
}

export interface SandboxListOptions extends ListSandboxesParams {
  fetch?: ClientOptions["fetch"];
  requestTimeoutMs?: number;
  debug?: ClientOptions["debug"];
  logger?: ClientOptions["logger"];
}

const SANDBOX_LIST_LIMIT_DEFAULT = 100;
const SANDBOX_LIST_LIMIT_MAX = 100;

export interface CommandStartOptions extends CmdRequestOptions {
  args?: string[];
  envs?: Record<string, string>;
  cwd?: string;
  timeoutMs?: number;
  stdin?: boolean | string;
  background?: boolean;
  user?: string;
  onStdout?: (data: string) => void | Promise<void>;
  onStderr?: (data: string) => void | Promise<void>;
}

export interface CommandConnectOptions extends CmdRequestOptions {
  onStdout?: (data: string) => void | Promise<void>;
  onStderr?: (data: string) => void | Promise<void>;
}

export interface PtyCreateOptions extends CmdRequestOptions {
  args?: string[];
  envs?: Record<string, string>;
  cwd?: string;
  timeoutMs?: number;
  size?: PtySize;
  user?: string;
}

export interface GitCommandOptions {
  cwd?: string;
  envs?: Record<string, string>;
  timeoutMs?: number;
  user?: string;
}

export interface GitCloneOptions extends GitCommandOptions {
  branch?: string;
  depth?: number;
}

export interface WriteFileInput {
  path: string;
  data?: string | Uint8Array | ArrayBuffer | ArrayBufferView | Blob | ReadableStream<Uint8Array>;
  content?: string;
}

export type FileType = "file" | "dir" | "symlink";

export type FilesystemEventType = "create" | "write" | "remove" | "rename" | "chmod";

export interface EntryInfo {
  name: string;
  type: FileType;
  path: string;
  size: number;
  mode: number;
  permissions: string;
  owner: string;
  group: string;
  modifiedTime?: Date;
  symlinkTarget?: string;
}

export interface FilesystemEvent {
  name: string;
  type: FilesystemEventType;
}

export interface WriteInfo {
  name: string;
  path: string;
  type?: FileType;
}

export type FilesystemRequestOptions = CmdRequestOptions & { user?: string };
export type FilesystemListOptions = FilesystemRequestOptions & { depth?: number };
export type WatchDirOptions = FilesystemRequestOptions & {
  recursive?: boolean;
  timeoutMs?: number;
  onExit?: (error?: Error) => void | Promise<void>;
};

export class WatchHandle {
  readonly #stop: () => Promise<void>;

  constructor(stop: () => Promise<void>) {
    this.#stop = stop;
  }

  stop(): Promise<void> {
    return this.#stop();
  }
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  error?: string;
}

type SandboxData = {
  sandboxID: string;
  templateID?: string;
  alias?: string;
  envdUrl?: string | null;
  envdAccessToken?: string | null;
  cpuCount?: number;
  memoryMB?: number;
  metadata?: Record<string, string>;
  status?: string;
  state?: string;
  startedAt?: string;
  activatedAt?: string | null;
  endAt?: string;
};

export interface SandboxInfo {
  sandboxId: string;
  templateId?: string;
  sandboxDomain?: string;
  startedAt?: Date;
  endAt?: Date;
  state: string;
  metadata?: Record<string, string>;
  name?: string;
  cpuCount?: number;
  memoryMB?: number;
  envdAccessToken?: string;
}

class CommandHandle {
  readonly #runtime: SandboxRuntime;
  readonly #stream: ProcessStream;
  readonly #pty: boolean;
  readonly #cmdId?: string;
  readonly pid: number;

  constructor(options: {
    runtime: SandboxRuntime;
    stream: ProcessStream;
    pid: number;
    cmdId?: string;
    pty?: boolean;
    onStdout?: (data: string) => void | Promise<void>;
    onStderr?: (data: string) => void | Promise<void>;
  }) {
    this.#runtime = options.runtime;
    this.#stream = options.stream;
    this.#cmdId = options.cmdId;
    this.#pty = options.pty ?? false;
    this.#onStdout = options.onStdout;
    this.#onStderr = options.onStderr;
    this.pid = options.pid;
  }

  readonly #onStdout?: (data: string) => void | Promise<void>;
  readonly #onStderr?: (data: string) => void | Promise<void>;

  async sendStdin(data: string | Uint8Array): Promise<void> {
    const text = typeof data === "string" ? data : new TextDecoder().decode(data);
    await this.#runtime.sendInput({
      process: { pid: this.pid },
      input: this.#pty ? { pty: encodeStreamData(text) } : { stdin: encodeStreamData(text) },
    });
  }

  async sendInput(data: string | Uint8Array): Promise<void> {
    return this.sendStdin(data);
  }

  async kill(): Promise<boolean> {
    try {
      await this.#runtime.sendSignal({ process: { pid: this.pid }, signal: "SIGNAL_SIGKILL" });
      return true;
    } catch (error) {
      if (isMissingProcessError(error)) {
        return false;
      }
      throw error;
    }
  }

  async wait(): Promise<Partial<CommandResult> & { stdout: string; stderr: string; pty: string }> {
    let stdout = "";
    let stderr = "";
    let pty = "";

    for (;;) {
      const frame = await this.#stream.next();
      if (!frame) {
        break;
      }
      if ("data" in frame.event) {
        const stdoutChunk = decodeStreamData(frame.event.data.stdout);
        const stderrChunk = decodeStreamData(frame.event.data.stderr);
        const ptyChunk = decodeStreamData(frame.event.data.pty);
        stdout += stdoutChunk;
        stderr += stderrChunk;
        pty += ptyChunk;
        if (stdoutChunk) {
          await this.#onStdout?.(stdoutChunk);
        }
        if (stderrChunk) {
          await this.#onStderr?.(stderrChunk);
        }
        // Some runtimes stream PTY reconnect output through stdout/stderr instead of pty.
        if (this.#pty && !ptyChunk) {
          pty += stdoutChunk + stderrChunk;
        }
      }
      if ("end" in frame.event) {
        break;
      }
    }

    if (!this.#cmdId) {
      return { stdout, stderr, pty };
    }

    const result = await getResultWithRetry(this.#runtime, this.#cmdId);
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      pty,
      exitCode: result.exitCode,
    };
  }
}

class Commands {
  readonly #runtime: () => SandboxRuntime;

  constructor(runtime: () => SandboxRuntime) {
    this.#runtime = runtime;
  }

  async run(
    cmd: string,
    options: CommandStartOptions = {},
  ): Promise<CommandResult | CommandHandle> {
    if (options.background || options.onStdout || options.onStderr || typeof options.stdin === "boolean") {
      const runtime = this.#runtime();
      const execution = buildCommandExecution(cmd, options.args, options.user);
      const stream = await runtime.start({
        process: {
          cmd: execution.cmd,
          ...(execution.args?.length ? { args: execution.args } : {}),
          envs: options.envs,
          cwd: options.cwd ?? null,
        },
        timeoutMs: normalizeRuntimeTimeoutMilliseconds(options),
        stdin: options.stdin !== false,
      }, normalizeCmdRequestOptions(options));
      const started = await expectStartFrame(stream);
      const handle = new CommandHandle({
        runtime,
        stream,
        pid: started.pid,
        cmdId: started.cmdId,
        onStdout: options.onStdout,
        onStderr: options.onStderr,
      });
      if (typeof options.stdin === "string") {
        await handle.sendStdin(options.stdin);
      }
      if (options.background) {
        return handle;
      }
      const waited = await handle.wait();
      return {
        stdout: waited.stdout,
        stderr: waited.stderr,
        exitCode: waited.exitCode ?? 0,
        durationMs: 0,
      };
    }

    const stdin = typeof options.stdin === "string" ? options.stdin : undefined;

    const execution = buildCommandExecution(cmd, options.args, options.user);
    const result = await this.#runtime().run({
      cmd: execution.cmd,
      ...(execution.args?.length ? { args: execution.args } : {}),
      cwd: options.cwd,
      env: options.envs,
      timeoutMs: normalizeRuntimeTimeoutMilliseconds(options),
      stdin,
    }, normalizeCmdRequestOptions(options));
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exit_code,
      durationMs: result.duration_ms,
      error: result.error,
    };
  }

  async exec(
    cmd: string,
    options: CommandStartOptions = {},
  ): Promise<CommandResult | CommandHandle> {
    return this.run(cmd, options);
  }

  async list(options: CmdRequestOptions = {}): Promise<ProcessInfo[]> {
    return (await this.#runtime().listProcesses(options)).processes;
  }

  async connect(pid: number, options: CommandConnectOptions = {}): Promise<CommandHandle> {
    const runtime = this.#runtime();
    const stream = await runtime.connect({ process: { pid } }, options);
    const started = await expectStartFrame(stream);
    return new CommandHandle({
      runtime,
      stream,
      pid: started.pid,
      cmdId: started.cmdId,
      onStdout: options.onStdout,
      onStderr: options.onStderr,
    });
  }

  async kill(pid: number, options: CmdRequestOptions = {}): Promise<boolean> {
    try {
      await this.#runtime().sendSignal({ process: { pid }, signal: "SIGNAL_SIGKILL" }, options);
      return true;
    } catch (error) {
      if (isMissingProcessError(error)) {
        return false;
      }
      throw error;
    }
  }

  async sendStdin(pid: number, data: string | Uint8Array, options: CmdRequestOptions = {}): Promise<void> {
    const text = typeof data === "string" ? data : new TextDecoder().decode(data);
    await this.#runtime().sendInput({ process: { pid }, input: { stdin: encodeStreamData(text) } }, options);
  }
}

class Filesystem {
  readonly #runtime: () => SandboxRuntime;

  constructor(runtime: () => SandboxRuntime) {
    this.#runtime = runtime;
  }

  async exists(path: string, options: FilesystemRequestOptions = {}): Promise<boolean> {
    try {
      await this.#runtime().stat({ path }, normalizeFilesystemRequestOptions(options));
      return true;
    } catch (error) {
      if (isMissingProcessError(error)) {
        return false;
      }
      throw error;
    }
  }

  async getInfo(path: string, options: FilesystemRequestOptions = {}): Promise<EntryInfo> {
    return normalizeEntryInfo((await this.#runtime().stat({ path }, normalizeFilesystemRequestOptions(options))).entry);
  }

  async list(path: string, options: FilesystemListOptions = {}): Promise<EntryInfo[]> {
    return (await this.#runtime().listDir({ path, depth: options.depth }, normalizeFilesystemRequestOptions(options))).entries.map(normalizeEntryInfo);
  }

  async makeDir(path: string, options: FilesystemRequestOptions = {}): Promise<boolean> {
    if (await this.exists(path, options)) {
      return false;
    }
    await this.#runtime().makeDir({ path }, normalizeFilesystemRequestOptions(options));
    return true;
  }

  async read(
    path: string,
    options: FilesystemRequestOptions & { format?: "text" | "bytes" | "blob" | "stream" } = {},
  ): Promise<string | Uint8Array | Blob | ReadableStream<Uint8Array>> {
    const response = await this.#runtime().readFile({ path }, normalizeFilesystemRequestOptions(options));
    switch (options.format) {
      case "bytes":
        return new Uint8Array(await response.arrayBuffer());
      case "blob":
        return response.blob();
      case "stream":
        if (!response.body) {
          throw new ConfigurationError("response body is empty");
        }
        return response.body;
      default:
        return response.text();
    }
  }

  async write(
    pathOrFiles: string | WriteFileInput[],
    dataOrOptions?: string | Uint8Array | ArrayBuffer | ArrayBufferView | Blob | ReadableStream<Uint8Array> | FilesystemRequestOptions,
    maybeOptions: FilesystemRequestOptions = {},
  ): Promise<WriteInfo | WriteInfo[]> {
    if (typeof pathOrFiles !== "string") {
      const response = await this.#runtime().writeBatch({
        files: await Promise.all(pathOrFiles.map(async (file) => ({
          path: file.path,
          data: encodeBase64(await normalizeWriteBytes(file.data ?? file.content)),
        }))),
      }, normalizeFilesystemRequestOptions(dataOrOptions as FilesystemRequestOptions | undefined));
      return response.files.map((file) => normalizeWriteInfo(file.path));
    }

    const data = dataOrOptions as string | Uint8Array | ArrayBuffer | ArrayBufferView | Blob | ReadableStream<Uint8Array>;
    const options = maybeOptions;
    const bytes = await normalizeWriteBytes(data);
    await this.#runtime().writeFile({ path: pathOrFiles, data: bytes }, normalizeFilesystemRequestOptions(options));
    return normalizeWriteInfo(pathOrFiles);
  }

  async writeFiles(
    files: WriteFileInput[],
    options: FilesystemRequestOptions = {},
  ): Promise<WriteInfo[]> {
    return this.write(files, options) as Promise<WriteInfo[]>;
  }

  async remove(path: string, options: FilesystemRequestOptions = {}): Promise<void> {
    await this.#runtime().remove({ path }, normalizeFilesystemRequestOptions(options));
  }

  async rename(oldPath: string, newPath: string, options: FilesystemRequestOptions = {}): Promise<EntryInfo> {
    return normalizeEntryInfo((await this.#runtime().move({ source: oldPath, destination: newPath }, normalizeFilesystemRequestOptions(options))).entry);
  }

  async watchDir(
    path: string,
    onEvent: (event: FilesystemEvent) => void | Promise<void>,
    options: WatchDirOptions = {},
  ): Promise<WatchHandle> {
    const stream = await this.#runtime().watchDir({ path, recursive: options.recursive }, normalizeFilesystemRequestOptions(options));
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (options.timeoutMs !== undefined) {
      if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 0) {
        throw new ConfigurationError("timeoutMs must be a non-negative number");
      }
      if (options.timeoutMs > 0) {
        timer = setTimeout(() => {
          void stream.close();
        }, Math.floor(options.timeoutMs));
      }
    }
    const pump = (async () => {
      let exitError: Error | undefined;
      try {
        for (;;) {
          const frame = await stream.next();
          if (!frame) {
            return;
          }
          if (!frame.filesystem) {
            continue;
          }
          await onEvent(normalizeFilesystemEvent(frame.filesystem));
        }
      } catch (error) {
        if (!stopped) {
          exitError = error instanceof Error ? error : new Error(String(error));
        }
      } finally {
        if (timer) {
          clearTimeout(timer);
        }
        if (!stopped) {
          await options.onExit?.(exitError);
        }
      }
    })();
    return new WatchHandle(async () => {
      if (stopped) {
        return;
      }
      stopped = true;
      await stream.close();
      await pump.catch(() => {});
    });
  }
}

class Pty {
  readonly #runtime: () => SandboxRuntime;

  constructor(runtime: () => SandboxRuntime) {
    this.#runtime = runtime;
  }

  async create(command: string, options: PtyCreateOptions = {}): Promise<CommandHandle> {
    const runtime = this.#runtime();
    const execution = buildCommandExecution(command, options.args, options.user);
    const stream = await runtime.start({
      process: {
          cmd: execution.cmd,
          ...(execution.args?.length ? { args: execution.args } : {}),
          envs: options.envs,
          cwd: options.cwd ?? null,
        },
      timeoutMs: normalizeRuntimeTimeoutMilliseconds(options),
      stdin: true,
      pty: { size: options.size ?? { cols: 80, rows: 24 } },
    }, normalizeCmdRequestOptions(options));
    const started = await expectStartFrame(stream);
    return new CommandHandle({
      runtime,
      stream,
      pid: started.pid,
      cmdId: started.cmdId,
      pty: true,
    });
  }

  async connect(pid: number, options: CommandConnectOptions = {}): Promise<CommandHandle> {
    const runtime = this.#runtime();
    const stream = await runtime.connect({ process: { pid } }, options);
    const started = await expectStartFrame(stream);
    return new CommandHandle({
      runtime,
      stream,
      pid: started.pid,
      cmdId: started.cmdId,
      pty: true,
      onStdout: options.onStdout,
      onStderr: options.onStderr,
    });
  }

  async kill(pid: number, options: CmdRequestOptions = {}): Promise<boolean> {
    try {
      await this.#runtime().sendSignal({ process: { pid }, signal: "SIGNAL_SIGKILL" }, options);
      return true;
    } catch (error) {
      if (isMissingProcessError(error)) {
        return false;
      }
      throw error;
    }
  }

  async sendStdin(pid: number, data: string | Uint8Array, options: CmdRequestOptions = {}): Promise<void> {
    const text = typeof data === "string" ? data : new TextDecoder().decode(data);
    await this.#runtime().sendInput({ process: { pid }, input: { pty: encodeStreamData(text) } }, options);
  }

  async sendInput(pid: number, data: string | Uint8Array, options: CmdRequestOptions = {}): Promise<void> {
    return this.sendStdin(pid, data, options);
  }

  async resize(pid: number, size: PtySize, options: CmdRequestOptions = {}): Promise<void> {
    await this.#runtime().update({ process: { pid }, pty: { size } }, options);
  }
}

class Git {
  readonly #commands: Commands;

  constructor(commands: Commands) {
    this.#commands = commands;
  }

  async clone(repoUrl: string, path?: string, options: GitCloneOptions = {}): Promise<CommandResult> {
    const args: string[] = [];
    if (options.branch) {
      args.push("--branch", options.branch);
    }
    if (options.depth !== undefined) {
      args.push("--depth", String(options.depth));
    }
    args.push(repoUrl);
    if (path) {
      args.push(path);
    }
    return this.#run("clone", args, options);
  }

  async pull(path?: string, options: GitCommandOptions = {}): Promise<CommandResult> {
    return this.#run("pull", [], { ...options, cwd: path ?? options.cwd });
  }

  async checkout(ref: string, path?: string, options: GitCommandOptions = {}): Promise<CommandResult> {
    return this.#run("checkout", [ref], { ...options, cwd: path ?? options.cwd });
  }

  async status(path?: string, options: GitCommandOptions = {}): Promise<CommandResult> {
    return this.#run("status", [], { ...options, cwd: path ?? options.cwd });
  }

  async #run(subcommand: string, args: string[], options: GitCommandOptions): Promise<CommandResult> {
    const command = buildGitExecution(subcommand, args, options.user);
    return this.#commands.run(command.cmd, {
      args: command.args,
      cwd: options.cwd,
      envs: options.envs,
      timeoutMs: options.timeoutMs,
    }) as Promise<CommandResult>;
  }
}

export class Sandbox {
  static async create(template: string, options?: SandboxCreateOverrides): Promise<Sandbox>;
  static async create(options: SandboxCreateOptions): Promise<Sandbox>;
  static async create(
    templateOrOptions: string | SandboxCreateOptions,
    maybeOptions: SandboxCreateOverrides = {},
  ): Promise<Sandbox> {
    const { clientOptions, body } = normalizeSandboxCreateArgs(templateOrOptions, maybeOptions);
    const client = new GatewayClient(resolveGatewayOptions(clientOptions));
    return new Sandbox(client, await client.createSandbox(body));
  }

  static async connect(
    sandboxId: string,
    options: SandboxConnectOptions = {},
  ): Promise<Sandbox> {
    assertNoHighLevelGatewayConfig(options as Record<string, unknown>);
    const client = new GatewayClient(resolveGatewayOptions(options));
    return client.connect(sandboxId, { timeout: normalizeConnectTimeoutSeconds(options) });
  }

  static list(options: SandboxListOptions = {}): SandboxPaginator {
    assertNoHighLevelGatewayConfig(options as Record<string, unknown>);
    const client = new GatewayClient(resolveGatewayOptions(options));
    return client.list(options);
  }

  static async getInfo(
    sandboxId: string,
    options: HighLevelClientOptions = {},
  ): Promise<SandboxInfo> {
    assertNoHighLevelGatewayConfig(options as Record<string, unknown>);
    const client = new GatewayClient(resolveGatewayOptions(options));
    return normalizeSandboxInfo(await client.getSandbox(sandboxId));
  }

  static async getFullInfo(
    sandboxId: string,
    options: HighLevelClientOptions = {},
  ): Promise<SandboxInfo> {
    assertNoHighLevelGatewayConfig(options as Record<string, unknown>);
    const client = new GatewayClient(resolveGatewayOptions(options));
    return normalizeSandboxInfo(await client.getSandbox(sandboxId));
  }

  static async kill(
    sandboxId: string,
    options: HighLevelClientOptions = {},
  ): Promise<boolean> {
    assertNoHighLevelGatewayConfig(options as Record<string, unknown>);
    const client = new GatewayClient(resolveGatewayOptions(options));
    try {
      await client.deleteSandbox(sandboxId);
      return true;
    } catch (error) {
      if (error instanceof NotFoundError) {
        return false;
      }
      throw error;
    }
  }

  static async pause(
    sandboxId: string,
    options: HighLevelClientOptions = {},
  ): Promise<boolean> {
    assertNoHighLevelGatewayConfig(options as Record<string, unknown>);
    const client = new GatewayClient(resolveGatewayOptions(options));
    const detail = await client.getSandbox(sandboxId);
    if (isPausedSandboxState(detail.state, detail.status)) {
      return false;
    }
    await client.pauseSandbox(sandboxId);
    return true;
  }

  static async setTimeout(
    sandboxId: string,
    timeout: number,
    options: HighLevelClientOptions = {},
  ): Promise<void> {
    assertNoHighLevelGatewayConfig(options as Record<string, unknown>);
    const client = new GatewayClient(resolveGatewayOptions(options));
    await client.setSandboxTimeout(sandboxId, { timeout: normalizeLifecycleTimeoutSeconds(timeout) });
  }

  readonly #client: GatewayClient;
  #data: SandboxData;
  #codeContexts?: PythonCodeContextManager;
  readonly #statelessCodeContexts = new Map<string, CodeContext>();
  readonly commands: Commands;
  readonly files: Filesystem;
  readonly git: Git;
  readonly pty: Pty;

  constructor(client: GatewayClient, data: SandboxData) {
    this.#client = client;
    this.#data = { ...data };
    this.commands = new Commands(() => this.#runtime());
    this.files = new Filesystem(() => this.#runtime());
    this.git = new Git(this.commands);
    this.pty = new Pty(() => this.#runtime());
  }

  get sandboxId(): string {
    return this.#data.sandboxID;
  }

  get sandboxDomain(): string {
    const raw = this.#data.envdUrl?.trim() ?? "";
    if (!raw) {
      return "";
    }
    return new URL(raw).host;
  }

  get templateId(): string | undefined {
    return this.#data.templateID;
  }

  get envdUrl(): string | null | undefined {
    return this.#data.envdUrl;
  }

  get envdAccessToken(): string | null | undefined {
    return this.#data.envdAccessToken;
  }

  get trafficAccessToken(): string | null | undefined {
    return this.#data.envdAccessToken;
  }

  get status(): string | undefined {
    return this.#data.status;
  }

  get state(): string | undefined {
    return this.#data.state;
  }

  get raw(): SandboxData {
    return { ...this.#data };
  }

  async reload(options: HighLevelClientOptions = {}): Promise<Sandbox> {
    const detail = await this.#client.getSandbox(this.sandboxId, { requestTimeoutMs: options.requestTimeoutMs });
    this.#data = { ...detail };
    return this;
  }

  async connect(options: SandboxConnectOptions = {}): Promise<Sandbox> {
    const response = await this.#client.connectSandbox(
      this.sandboxId,
      { timeout: normalizeConnectTimeoutSeconds(options) } satisfies ConnectSandboxRequest,
      { requestTimeoutMs: options.requestTimeoutMs },
    );
    this.#data = { ...response.sandbox };
    return this;
  }

  async resume(options: SandboxConnectOptions = {}): Promise<Sandbox> {
    return this.connect(options);
  }

  async getInfo(options: HighLevelClientOptions = {}): Promise<SandboxInfo> {
    const detail = await this.#client.getSandbox(this.sandboxId, { requestTimeoutMs: options.requestTimeoutMs });
    this.#data = { ...detail };
    return normalizeSandboxInfo(detail);
  }

  async getFullInfo(options: HighLevelClientOptions = {}): Promise<SandboxInfo> {
    const detail = await this.#client.getSandbox(this.sandboxId, { requestTimeoutMs: options.requestTimeoutMs });
    this.#data = { ...detail };
    return normalizeSandboxInfo(detail);
  }

  async getMetrics(): Promise<Awaited<ReturnType<SandboxRuntime["metrics"]>>> {
    return this.#runtime().metrics();
  }

  async runCode(code: string, options: RunCodeOptions = {}): Promise<CodeExecution> {
    if (options.context) {
      if (!isPythonLanguage(options.context.language)) {
        return runCodeWithRuntime(this.#runtime(), code, {
          ...options,
          language: options.language ?? options.context.language,
          cwd: options.cwd ?? options.context.cwd,
          timeoutMs: options.timeoutMs ?? options.context.timeoutMs,
        });
      }
      return this.#codeContextManager().runInContext(options.context, code, options);
    }
    if (isPythonLanguage(options.language)) {
      return this.#codeContextManager().runDefault(code, options);
    }
    return runCodeWithRuntime(this.#runtime(), code, options);
  }

  async createCodeContext(options: CodeContextCreateOptions = {}): Promise<CodeContext> {
    if (!isPythonLanguage(options.language)) {
      const context = new CodeContext(options);
      this.#statelessCodeContexts.set(context.contextId, context);
      return context;
    }
    return this.#codeContextManager().createContext(options);
  }

  async listCodeContexts(): Promise<CodeContext[]> {
    return [
      ...this.#statelessCodeContexts.values(),
      ...(this.#codeContexts ? this.#codeContexts.listContexts() : []),
    ];
  }

  async restartCodeContext(contextOrId: string | CodeContext): Promise<CodeContext> {
    const contextId = typeof contextOrId === "string" ? contextOrId : contextOrId.contextId;
    const stateless = this.#statelessCodeContexts.get(contextId);
    if (stateless) {
      return stateless;
    }
    return this.#codeContextManager().restartContext(contextOrId);
  }

  async removeCodeContext(contextOrId: string | CodeContext): Promise<void> {
    const contextId = typeof contextOrId === "string" ? contextOrId : contextOrId.contextId;
    if (this.#statelessCodeContexts.delete(contextId)) {
      return;
    }
    await this.#codeContextManager().removeContext(contextOrId);
  }

  getHost(port: number): string {
    if (!Number.isInteger(port) || port <= 0) {
      throw new ConfigurationError("port must be a positive integer");
    }
    return joinURLPath(this.#runtime().baseUrl, `/proxy/${port}/`);
  }

  async downloadUrl(path: string, options: SandboxUrlOptions = {}): Promise<string> {
    return buildSandboxFileURL(this.#runtime().baseUrl, this.#data.envdAccessToken, path, "read", options);
  }

  async uploadUrl(path?: string, options: SandboxUrlOptions = {}): Promise<string> {
    return buildSandboxFileURL(this.#runtime().baseUrl, this.#data.envdAccessToken, path, "write", options);
  }

  async logs(params: SandboxLogsParams = {}, options: HighLevelClientOptions = {}): Promise<SandboxLogsResponse> {
    return this.#client.getSandboxLogs(this.sandboxId, params, { requestTimeoutMs: options.requestTimeoutMs });
  }

  async pause(options: HighLevelClientOptions = {}): Promise<boolean> {
    if (isPausedSandboxState(this.#data.state, this.#data.status)) {
      return false;
    }
    await this.#client.pauseSandbox(this.sandboxId, { requestTimeoutMs: options.requestTimeoutMs });
    this.#data = { ...this.#data, state: "paused", status: "paused" };
    return true;
  }

  async kill(options: HighLevelClientOptions = {}): Promise<boolean> {
    this.#statelessCodeContexts.clear();
    if (this.#codeContexts) {
      await this.#codeContexts.closeAll();
    }
    try {
      await this.#client.deleteSandbox(this.sandboxId, { requestTimeoutMs: options.requestTimeoutMs });
      return true;
    } catch (error) {
      if (error instanceof NotFoundError) {
        return false;
      }
      throw error;
    }
  }

  async delete(options: HighLevelClientOptions = {}): Promise<void> {
    await this.kill(options);
  }

  async refresh(body?: RefreshSandboxRequest, options: HighLevelClientOptions = {}): Promise<void> {
    await this.#client.refreshSandbox(this.sandboxId, body, { requestTimeoutMs: options.requestTimeoutMs });
  }

  async setTimeout(timeout: number, options: HighLevelClientOptions = {}): Promise<void> {
    await this.#client.setSandboxTimeout(this.sandboxId, {
      timeout: normalizeLifecycleTimeoutSeconds(timeout),
    } satisfies TimeoutRequest, { requestTimeoutMs: options.requestTimeoutMs });
  }

  isRunning(): boolean {
    return !["paused", "stopped", "deleted"].includes((this.#data.state ?? this.#data.status ?? "").toLowerCase());
  }

  async proxy(request: ProxyRequest): Promise<Response> {
    return this.#runtime().proxy(request);
  }

  #runtime(): SandboxRuntime {
    return this.#client.runtimeFromSandbox({
      envdUrl: this.#data.envdUrl ?? null,
      envdAccessToken: this.#data.envdAccessToken ?? null,
    });
  }

  #codeContextManager(): PythonCodeContextManager {
    this.#codeContexts ??= new PythonCodeContextManager(this.#runtime());
    return this.#codeContexts;
  }
}

export class SandboxPaginator implements AsyncIterable<ListedSandboxInstance> {
  readonly #fetchPage: (options: ListSandboxesParams) => Promise<ListedSandboxInstance[]>;
  readonly #baseOptions: ListSandboxesParams;
  #offset: number;
  #done = false;

  constructor(
    fetchPage: (options: ListSandboxesParams) => Promise<ListedSandboxInstance[]>,
    options: ListSandboxesParams = {},
  ) {
    this.#fetchPage = fetchPage;
    this.#baseOptions = { ...options };
    this.#offset = decodeSandboxListNextToken(options.nextToken);
  }

  hasNextPage(): boolean {
    return !this.#done;
  }

  async nextItems(): Promise<ListedSandboxInstance[]> {
    if (this.#done) {
      return [];
    }
    const limit = resolveSandboxListLimit(this.#baseOptions.limit);
    const pageOptions: ListSandboxesParams = {
      ...this.#baseOptions,
      nextToken: encodeSandboxListNextToken(this.#offset),
    };
    if (this.#baseOptions.limit !== undefined) {
      pageOptions.limit = limit;
    }
    const items = await this.#fetchPage(pageOptions);
    this.#offset += items.length;
    if (items.length < limit) {
      this.#done = true;
    }
    return items;
  }

  async getNextPage(): Promise<ListedSandboxInstance[]> {
    return this.nextItems();
  }

  async *[Symbol.asyncIterator](): AsyncIterator<ListedSandboxInstance> {
    while (this.hasNextPage()) {
      const items = await this.nextItems();
      if (items.length === 0) {
        break;
      }
      for (const item of items) {
        yield item;
      }
    }
  }
}

async function expectStartFrame(stream: ProcessStream): Promise<{ pid: number; cmdId?: string }> {
  for (;;) {
    const frame = await stream.next();
    if (!frame) {
      throw new ConfigurationError("process stream ended before start frame");
    }
    if ("start" in frame.event) {
      return { pid: frame.event.start.pid, cmdId: frame.event.start.cmdId };
    }
  }
}

function encodeBase64(data: Uint8Array): string {
  let binary = "";
  for (const byte of data) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function encodeStreamData(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

function decodeStreamData(value?: string): string {
  if (!value) {
    return "";
  }
  return Buffer.from(value, "base64").toString("utf8");
}

function buildGitExecution(
  subcommand: string,
  args: string[],
  user?: string,
): { cmd: string; args: string[] } {
  const gitArgs = [subcommand, ...args];
  if (!user) {
    return { cmd: "git", args: gitArgs };
  }
  return {
    cmd: "sh",
    args: [
      "-lc",
      `su -s /bin/sh ${shellQuote(user)} -c ${shellQuote(shellJoin(["git", ...gitArgs]))}`,
    ],
  };
}

function buildCommandExecution(
  command: string,
  args?: string[],
  user?: string,
): { cmd: string; args?: string[] } {
  const commandArgs = args ?? [];
  if (!user) {
    return commandArgs.length > 0 ? { cmd: command, args: commandArgs } : { cmd: command };
  }
  return {
    cmd: "sh",
    args: [
      "-lc",
      `su -s /bin/sh ${shellQuote(user)} -c ${shellQuote(shellJoin([command, ...commandArgs]))}`,
    ],
  };
}

function joinURLPath(baseUrl: string, path: string): string {
  const base = new URL(baseUrl);
  const basePath = base.pathname.replace(/\/+$/, "");
  const suffix = path.replace(/^\/+/, "");
  base.pathname = basePath ? `${basePath}/${suffix}` : `/${suffix}`;
  base.search = "";
  base.hash = "";
  return base.toString();
}

function normalizeSandboxCreateArgs(
  templateOrOptions: string | SandboxCreateOptions,
  maybeOptions: SandboxCreateOverrides,
): {
  clientOptions: HighLevelClientOptions;
  body: {
    templateID: string;
    timeout?: number;
    autoPause?: boolean;
    metadata?: Record<string, string>;
    envVars?: Record<string, string>;
    waitReady?: boolean;
  };
} {
  if (typeof templateOrOptions === "string") {
    const source = { ...maybeOptions, template: templateOrOptions };
    assertNoHighLevelGatewayConfig(source);
    return {
      clientOptions: {
        fetch: source.fetch,
        requestTimeoutMs: source.requestTimeoutMs,
        debug: source.debug,
        logger: source.logger,
      },
      body: normalizeSandboxCreateBody(source),
    };
  }
  const source = { ...templateOrOptions };
  assertNoHighLevelGatewayConfig(source);
  return {
    clientOptions: {
      fetch: source.fetch,
      requestTimeoutMs: source.requestTimeoutMs,
      debug: source.debug,
      logger: source.logger,
    },
    body: normalizeSandboxCreateBody(source),
  };
}

function normalizeSandboxCreateBody(
  source: SandboxCreateOptions,
): {
  templateID: string;
  timeout?: number;
  autoPause?: boolean;
  metadata?: Record<string, string>;
  envVars?: Record<string, string>;
  waitReady?: boolean;
} {
  rejectUnsupportedSandboxCreateFields(source as unknown as Record<string, unknown>);
  const templateID = typeof source.template === "string" && source.template.trim() ? source.template.trim() : undefined;
  if (templateID === undefined) {
    throw new ConfigurationError("templateID is required");
  }
  const timeout = source.timeout === undefined
    ? undefined
    : normalizeLifecycleTimeoutSeconds(source.timeout);
  return {
    templateID,
    timeout,
    autoPause: source.autoPause,
    metadata: source.metadata,
    envVars: source.envs,
    waitReady: source.waitReady,
  };
}

function rejectUnsupportedSandboxCreateFields(source: Record<string, unknown>): void {
  for (const key of ["autoResume", "secure", "allow_internet_access", "network", "mcp", "volumeMounts"]) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      throw new ConfigurationError(`${key} is not supported`);
    }
  }
}

function normalizeConnectTimeoutSeconds(options: { timeout?: number }): number {
  if (options.timeout === undefined) {
    return 300;
  }
  return normalizeLifecycleTimeoutSeconds(options.timeout);
}

function normalizeSandboxInfo(data: SandboxData): SandboxInfo {
  return {
    sandboxId: data.sandboxID,
    templateId: data.templateID,
    sandboxDomain: normalizeSandboxDomain(data.envdUrl),
    startedAt: data.startedAt ? new Date(data.startedAt) : undefined,
    endAt: data.endAt ? new Date(data.endAt) : undefined,
    state: (data.state ?? data.status ?? "").toLowerCase(),
    metadata: data.metadata,
    name: data.alias,
    cpuCount: data.cpuCount,
    memoryMB: data.memoryMB,
    envdAccessToken: data.envdAccessToken ?? undefined,
  };
}

function normalizeEntryInfo(entry: RawEntryInfo): EntryInfo {
  return {
    name: entry.name,
    type: normalizeFileType(entry.type),
    path: entry.path,
    size: entry.size,
    mode: entry.mode,
    permissions: entry.permissions,
    owner: entry.owner,
    group: entry.group,
    modifiedTime: entry.modifiedTime ? new Date(entry.modifiedTime) : undefined,
    symlinkTarget: entry.symlinkTarget ?? undefined,
  };
}

function normalizeWriteInfo(filePath: string): WriteInfo {
  return {
    name: filePath.replace(/\/+$/g, "").split("/").pop() ?? "",
    path: filePath,
    type: "file",
  };
}

function normalizeFilesystemEvent(event: RawFilesystemEvent): FilesystemEvent {
  return {
    name: event.name,
    type: normalizeFilesystemEventType(event.type),
  };
}

function normalizeFileType(type: string): FileType {
  switch (type) {
    case "FILE_TYPE_DIRECTORY":
      return "dir";
    case "FILE_TYPE_SYMLINK":
      return "symlink";
    case "FILE_TYPE_FILE":
    default:
      return "file";
  }
}

function normalizeFilesystemEventType(type: string): FilesystemEventType {
  switch (type) {
    case "EVENT_TYPE_CREATE":
      return "create";
    case "EVENT_TYPE_REMOVE":
      return "remove";
    case "EVENT_TYPE_RENAME":
      return "rename";
    case "EVENT_TYPE_CHMOD":
      return "chmod";
    case "EVENT_TYPE_WRITE":
    default:
      return "write";
  }
}

function normalizeSandboxDomain(envdUrl?: string | null): string | undefined {
  const raw = envdUrl?.trim() ?? "";
  if (!raw) {
    return undefined;
  }
  return new URL(raw).host;
}

function normalizeRuntimeTimeoutMilliseconds(options: { timeoutMs?: number }): number | undefined {
  if (options.timeoutMs === undefined) {
    return undefined;
  }
  return normalizePositiveTimeoutMilliseconds(options.timeoutMs);
}

function normalizeLifecycleTimeoutSeconds(timeout: number): number {
  if (!Number.isFinite(timeout) || timeout < 0) {
    throw new ConfigurationError("timeout must be a non-negative number");
  }
  return Math.floor(timeout);
}

function resolveSandboxListLimit(limit?: number): number {
  if (limit === undefined) {
    return SANDBOX_LIST_LIMIT_DEFAULT;
  }
  if (!Number.isInteger(limit) || limit <= 0 || limit > SANDBOX_LIST_LIMIT_MAX) {
    throw new ConfigurationError(`limit must be an integer between 1 and ${SANDBOX_LIST_LIMIT_MAX}`);
  }
  return limit;
}

function encodeSandboxListNextToken(offset: number): string | undefined {
  if (offset <= 0) {
    return undefined;
  }
  return Buffer.from(String(offset), "utf8").toString("base64url");
}

function decodeSandboxListNextToken(nextToken?: string): number {
  const token = nextToken?.trim() ?? "";
  if (!token) {
    return 0;
  }
  try {
    const value = Number.parseInt(Buffer.from(token, "base64url").toString("utf8"), 10);
    if (!Number.isInteger(value) || value < 0) {
      throw new Error("invalid");
    }
    return value;
  } catch {
    throw new ConfigurationError("nextToken must be a valid sandbox list cursor");
  }
}

function normalizePositiveTimeoutMilliseconds(timeoutMs: number): number {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new ConfigurationError("timeoutMs must be a positive number");
  }
  return Math.floor(timeoutMs);
}

function normalizeCmdRequestOptions(options: CmdRequestOptions): CmdRequestOptions {
  return {
    username: options.username,
    signature: options.signature,
    signatureExpiration: options.signatureExpiration,
    range: options.range,
    headers: options.headers,
    requestTimeoutMs: options.requestTimeoutMs,
    signal: options.signal,
  };
}

function normalizeFilesystemRequestOptions(options: FilesystemRequestOptions | undefined): CmdRequestOptions {
  if (!options) {
    return {};
  }
  const normalized = normalizeCmdRequestOptions(options);
  if (options.user?.trim()) {
    normalized.username = options.user.trim();
  }
  return normalized;
}

function assertNoHighLevelGatewayConfig(source: Record<string, unknown>): void {
  for (const key of ["baseUrl", "apiKey", "projectId", "domain"]) {
    if (source[key] !== undefined) {
      throw new ConfigurationError(`${key} is not supported on high-level Sandbox helpers; use SEACLOUD_BASE_URL/SEACLOUD_API_KEY env vars`);
    }
  }
}

function shellJoin(args: string[]): string {
  return args.map((arg) => shellQuote(arg)).join(" ");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function isPausedSandboxState(state?: string, status?: string): boolean {
  return [state, status].some((value) => value?.toLowerCase() === "paused");
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

async function normalizeWriteBytes(
  data: string | Uint8Array | ArrayBuffer | ArrayBufferView | Blob | ReadableStream<Uint8Array> | undefined,
): Promise<Uint8Array> {
  if (data === undefined) {
    throw new ConfigurationError("data is required");
  }
  if (typeof data === "string") {
    return new TextEncoder().encode(data);
  }
  if (data instanceof Uint8Array) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (data instanceof Blob) {
    return new Uint8Array(await data.arrayBuffer());
  }
  return new Uint8Array(await new Response(data).arrayBuffer());
}

function buildSandboxFileURL(
  runtimeBaseURL: string,
  accessToken: string | null | undefined,
  filePath: string | undefined,
  operation: "read" | "write",
  options: SandboxUrlOptions,
): string {
  const url = new URL(joinURLPath(runtimeBaseURL, "/files"));
  if (filePath?.trim()) {
    url.searchParams.set("path", filePath.trim());
  }
  const username = options.user?.trim() ?? "";
  if (username) {
    url.searchParams.set("username", username);
  }
  const expiration = normalizeOptionalSignatureExpiration(options.useSignatureExpiration);
  const secret = accessToken?.trim() ?? "";
  if (secret) {
    if (expiration !== undefined) {
      url.searchParams.set("signature_expiration", String(expiration));
    }
    url.searchParams.set("signature", signSandboxFileURL(filePath?.trim() ?? "", operation, username, secret, expiration));
  }
  return url.toString();
}

function normalizeOptionalSignatureExpiration(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new ConfigurationError("useSignatureExpiration must be a positive integer");
  }
  return value;
}

function signSandboxFileURL(
  filePath: string,
  operation: "read" | "write",
  username: string,
  secret: string,
  expiration?: number,
): string {
  const raw = expiration === undefined
    ? `${filePath}:${operation}:${username}:${secret}`
    : `${filePath}:${operation}:${username}:${secret}:${expiration}`;
  const digest = createHash("sha256").update(raw).digest("base64").replace(/=+$/g, "");
  return `v1_${digest}`;
}

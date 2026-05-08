import { SandboxClient } from "./client.js";
import type {
  CmdRequestOptions,
  EntryInfo,
  FilesystemWatchStream,
  ProcessInfo,
  ProcessStream,
  ProxyRequest,
  PtySize,
} from "./cmd/index.js";
import type { GatewayOptions } from "./config.js";
import type {
  ConnectSandboxRequest,
  ListSandboxesParams,
  RefreshSandboxRequest,
  SandboxDetail,
  SandboxLogsParams,
  SandboxLogsResponse,
  TimeoutRequest,
} from "./control/index.js";
import { APIError, ConfigurationError, NotFoundError } from "./core/errors.js";
import type { SandboxRuntime } from "./runtime.js";

export interface SandboxCreateOptions extends GatewayOptions {
  template?: string;
  templateID?: string;
  workspaceId?: string;
  timeout?: number;
  metadata?: Record<string, string>;
  envVars?: Record<string, string>;
  volumeMounts?: Array<{ name: string; path: string }>;
  waitReady?: boolean;
}

export interface SandboxConnectOptions extends GatewayOptions {
  timeout?: number;
}

export interface SandboxListOptions extends GatewayOptions, ListSandboxesParams {}

export interface CommandStartOptions extends CmdRequestOptions {
  args?: string[];
  envs?: Record<string, string>;
  cwd?: string;
  timeout?: number;
  stdin?: string;
  background?: boolean;
}

export interface PtyCreateOptions extends CmdRequestOptions {
  args?: string[];
  envs?: Record<string, string>;
  cwd?: string;
  timeout?: number;
  size?: PtySize;
}

export interface GitCommandOptions {
  cwd?: string;
  envs?: Record<string, string>;
  timeout?: number;
  user?: string;
}

export interface GitCloneOptions extends GitCommandOptions {
  branch?: string;
  depth?: number;
}

export interface WriteFileInput {
  path: string;
  data?: Uint8Array;
  content?: string;
}

export interface WriteInfo {
  path: string;
  bytesWritten: number;
  bytes_written: number;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  exit_code: number;
  durationMs: number;
  duration_ms: number;
  error?: string;
}

type SandboxData = {
  sandboxID: string;
  templateID?: string;
  envdUrl?: string | null;
  envdAccessToken?: string | null;
  trafficAccessToken?: string | null;
  status?: string;
  state?: string;
  startedAt?: string;
  activatedAt?: string | null;
  endAt?: string;
};

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
  }) {
    this.#runtime = options.runtime;
    this.#stream = options.stream;
    this.#cmdId = options.cmdId;
    this.#pty = options.pty ?? false;
    this.pid = options.pid;
  }

  async sendStdin(data: string | Uint8Array): Promise<void> {
    const text = typeof data === "string" ? data : new TextDecoder().decode(data);
    await this.#runtime.sendInput({
      process: { pid: this.pid },
      input: this.#pty ? { pty: encodeStreamData(text) } : { stdin: encodeStreamData(text) },
    });
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

    const result = await this.#runtime.getResult({ cmdId: this.#cmdId });
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
    if (options.background) {
      const runtime = this.#runtime();
      const stream = await runtime.start({
        process: {
          cmd,
          args: options.args,
          envs: options.envs,
          cwd: options.cwd ?? null,
        },
        timeout: options.timeout,
        stdin: true,
      }, options);
      const started = await expectStartFrame(stream);
      const handle = new CommandHandle({
        runtime,
        stream,
        pid: started.pid,
        cmdId: started.cmdId,
      });
      if (options.stdin) {
        await handle.sendStdin(options.stdin);
      }
      return handle;
    }

    const result = await this.#runtime().run({
      cmd,
      args: options.args,
      cwd: options.cwd,
      env: options.envs,
      timeout: options.timeout,
      stdin: options.stdin,
    }, options);
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exit_code,
      exit_code: result.exit_code,
      durationMs: result.duration_ms,
      duration_ms: result.duration_ms,
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

  async connect(pid: number, options: CmdRequestOptions = {}): Promise<CommandHandle> {
    const runtime = this.#runtime();
    const stream = await runtime.connect({ process: { pid } }, options);
    const started = await expectStartFrame(stream);
    return new CommandHandle({
      runtime,
      stream,
      pid: started.pid,
      cmdId: started.cmdId,
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

  async exists(path: string, options: CmdRequestOptions = {}): Promise<boolean> {
    try {
      await this.#runtime().stat({ path }, options);
      return true;
    } catch (error) {
      if (isMissingProcessError(error)) {
        return false;
      }
      throw error;
    }
  }

  async getInfo(path: string, options: CmdRequestOptions = {}): Promise<EntryInfo> {
    return (await this.#runtime().stat({ path }, options)).entry;
  }

  async list(path: string, options: CmdRequestOptions & { depth?: number } = {}): Promise<EntryInfo[]> {
    return (await this.#runtime().listDir({ path, depth: options.depth }, options)).entries;
  }

  async makeDir(path: string, options: CmdRequestOptions = {}): Promise<boolean> {
    await this.#runtime().makeDir({ path }, options);
    return true;
  }

  async read(
    path: string,
    options: CmdRequestOptions & { format?: "text" | "bytes" | "blob" | "stream" } = {},
  ): Promise<string | Uint8Array | Blob | ReadableStream<Uint8Array>> {
    const response = await this.#runtime().readFile({ path }, options);
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
    dataOrOptions?: string | Uint8Array | CmdRequestOptions,
    maybeOptions: CmdRequestOptions = {},
  ): Promise<WriteInfo | WriteInfo[]> {
    if (typeof pathOrFiles !== "string") {
      const response = await this.#runtime().writeBatch({
        files: pathOrFiles.map((file) => ({
          path: file.path,
          content: file.content,
          data: file.data ? encodeBase64(file.data) : undefined,
        })),
      }, dataOrOptions as CmdRequestOptions | undefined);
      return response.files.map((file) => ({
        path: file.path,
        bytesWritten: file.bytes_written,
        bytes_written: file.bytes_written,
      }));
    }

    const data = dataOrOptions as string | Uint8Array;
    const options = maybeOptions;
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
    await this.#runtime().writeFile({ path: pathOrFiles, data: bytes }, options);
    return {
      path: pathOrFiles,
      bytesWritten: bytes.byteLength,
      bytes_written: bytes.byteLength,
    };
  }

  async writeFiles(
    files: WriteFileInput[],
    options: CmdRequestOptions = {},
  ): Promise<WriteInfo[]> {
    return this.write(files, options) as Promise<WriteInfo[]>;
  }

  async remove(path: string, options: CmdRequestOptions = {}): Promise<void> {
    await this.#runtime().remove({ path }, options);
  }

  async rename(oldPath: string, newPath: string, options: CmdRequestOptions = {}): Promise<EntryInfo> {
    return (await this.#runtime().move({ source: oldPath, destination: newPath }, options)).entry;
  }

  async watchDir(
    path: string,
    options: CmdRequestOptions & { recursive?: boolean } = {},
  ): Promise<FilesystemWatchStream> {
    return this.#runtime().watchDir({ path, recursive: options.recursive }, options);
  }
}

class Pty {
  readonly #runtime: () => SandboxRuntime;

  constructor(runtime: () => SandboxRuntime) {
    this.#runtime = runtime;
  }

  async create(command: string, options: PtyCreateOptions = {}): Promise<CommandHandle> {
    const runtime = this.#runtime();
    const stream = await runtime.start({
      process: {
        cmd: command,
        args: options.args,
        envs: options.envs,
        cwd: options.cwd ?? null,
      },
      timeout: options.timeout,
      stdin: true,
      pty: { size: options.size ?? { cols: 80, rows: 24 } },
    }, options);
    const started = await expectStartFrame(stream);
    return new CommandHandle({
      runtime,
      stream,
      pid: started.pid,
      cmdId: started.cmdId,
      pty: true,
    });
  }

  async connect(pid: number, options: CmdRequestOptions = {}): Promise<CommandHandle> {
    const runtime = this.#runtime();
    const stream = await runtime.connect({ process: { pid } }, options);
    const started = await expectStartFrame(stream);
    return new CommandHandle({
      runtime,
      stream,
      pid: started.pid,
      cmdId: started.cmdId,
      pty: true,
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
      timeout: options.timeout,
    }) as Promise<CommandResult>;
  }
}

export class Sandbox {
  readonly #client: SandboxClient;
  #data: SandboxData;
  readonly commands: Commands;
  readonly files: Filesystem;
  readonly git: Git;
  readonly pty: Pty;

  constructor(client: SandboxClient, data: SandboxData) {
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

  get sandboxID(): string {
    return this.#data.sandboxID;
  }

  get sandboxDomain(): string {
    const raw = this.#data.envdUrl?.trim() ?? "";
    if (!raw) {
      return "";
    }
    return new URL(raw).host;
  }

  get trafficAccessToken(): string | undefined {
    return this.#data.trafficAccessToken ?? undefined;
  }

  get templateID(): string | undefined {
    return this.#data.templateID;
  }

  get envdUrl(): string | null | undefined {
    return this.#data.envdUrl;
  }

  get envdAccessToken(): string | null | undefined {
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

  async reload(): Promise<Sandbox> {
    const detail = await this.#client.getSandbox(this.sandboxId);
    this.#data = { ...detail };
    return this;
  }

  async connect(options: SandboxConnectOptions = {}): Promise<Sandbox> {
    const response = await this.#client.connectSandbox(this.sandboxId, {
      timeout: options.timeout ?? 300,
    } satisfies ConnectSandboxRequest);
    this.#data = { ...response.sandbox };
    return this;
  }

  async resume(options: SandboxConnectOptions = {}): Promise<Sandbox> {
    return this.connect(options);
  }

  async getInfo(): Promise<SandboxDetail> {
    const detail = await this.#client.getSandbox(this.sandboxId);
    this.#data = { ...detail };
    return detail;
  }

  async getMetrics(): Promise<Awaited<ReturnType<SandboxRuntime["metrics"]>>> {
    return this.#runtime().metrics();
  }

  getHost(port: number): string {
    if (!Number.isInteger(port) || port <= 0) {
      throw new ConfigurationError("port must be a positive integer");
    }
    return joinURLPath(this.#runtime().baseUrl, `/proxy/${port}/`);
  }

  async logs(params: SandboxLogsParams = {}): Promise<SandboxLogsResponse> {
    return this.#client.getSandboxLogs(this.sandboxId, params);
  }

  async pause(): Promise<void> {
    await this.#client.pauseSandbox(this.sandboxId);
  }

  async kill(): Promise<void> {
    await this.#client.deleteSandbox(this.sandboxId);
  }

  async delete(): Promise<void> {
    await this.kill();
  }

  async refresh(body?: RefreshSandboxRequest): Promise<void> {
    await this.#client.refreshSandbox(this.sandboxId, body);
  }

  async setTimeout(timeoutOrBody: number | TimeoutRequest): Promise<void> {
    const body = typeof timeoutOrBody === "number"
      ? { timeout: timeoutOrBody }
      : timeoutOrBody;
    await this.#client.setSandboxTimeout(this.sandboxId, body);
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

function joinURLPath(baseUrl: string, path: string): string {
  const base = new URL(baseUrl);
  const basePath = base.pathname.replace(/\/+$/, "");
  const suffix = path.replace(/^\/+/, "");
  base.pathname = basePath ? `${basePath}/${suffix}` : `/${suffix}`;
  base.search = "";
  base.hash = "";
  return base.toString();
}

function shellJoin(args: string[]): string {
  return args.map((arg) => shellQuote(arg)).join(" ");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
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

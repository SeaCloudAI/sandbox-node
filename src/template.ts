import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { lstat, readFile, readdir, readlink, stat } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { SandboxBuildService } from "./build/service.js";
import { TemplateBuildBuilder } from "./build/builder.js";
import type {
  BuildLogEntry,
  BuildRequest,
  BuildStatusResponse,
  GenericRegistryConfig,
  GetTemplateParams,
  ListTemplatesParams,
  TemplateCreateRequest,
  TemplateResponse,
} from "./build/types.js";
import { resolveGatewayOptions } from "./config.js";
import type { ClientOptions } from "./core/transport.js";
import { ConfigurationError, NotFoundError, ValidationError } from "./core/errors.js";

const TERMINAL_BUILD_STATUSES = new Set(["ready", "failed", "error", "cancelled"]);
const LOG_LEVEL_ORDER = ["debug", "info", "warn", "error"] as const;
const AUTO_COPY_PREFIX = "__auto_copy__:";

/**
 * Options for local sources copied into a template build.
 */
export interface TemplateCopyOptions {
  filesHash?: string;
  forceUpload?: boolean;
  mode?: number;
  resolveSymlinks?: boolean;
  user?: string;
}

export interface TemplateCopyItem extends TemplateCopyOptions {
  src: string | string[];
  dest: string;
}

export interface ImageCredentials {
  username: string;
  password: string;
}

export interface AWSRegistryCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}

export interface GCPRegistryCredentials {
  serviceAccountJSON: string | Record<string, unknown>;
}

/**
 * Options for RUN-style template helper commands.
 */
export interface TemplateCommandOptions {
  force?: boolean;
  user?: string;
}

export interface TemplatePathOptions extends TemplateCommandOptions {
  user?: string;
}

export interface TemplateRemoveOptions extends TemplatePathOptions {
  recursive?: boolean;
}

export interface TemplateRenameOptions extends TemplatePathOptions {}

export interface AptInstallOptions extends TemplateCommandOptions {
  noInstallRecommends?: boolean;
}

export interface GitCloneOptions extends TemplateCommandOptions {
  branch?: string;
  depth?: number;
  user?: string;
}

export interface MakeDirOptions extends TemplatePathOptions {
  mode?: number;
}

export interface MakeSymlinkOptions extends TemplatePathOptions {}

export interface NpmInstallOptions extends TemplateCommandOptions {
  dev?: boolean;
  g?: boolean;
}

export interface PipInstallOptions extends TemplateCommandOptions {
  g?: boolean;
}

export interface BunInstallOptions extends TemplateCommandOptions {
  dev?: boolean;
  g?: boolean;
}

export interface TemplateBuildOptions {
  fetch?: ClientOptions["fetch"];
  requestTimeoutMs?: number;
  tags?: string[];
  baseTemplateID?: string;
  cpuCount?: number;
  memoryMB?: number;
  wait?: boolean;
  pollIntervalMs?: number;
  onBuildLogs?: (entry: LogEntry) => void;
}

export interface TemplateBuildInfo {
  templateId: string;
  buildId: string;
  name: string;
  tags: string[];
  alias?: string;
}

export interface TemplateBuildStatusInfo extends Omit<BuildStatusResponse, "buildID" | "templateID"> {
  buildId: string;
  templateId: string;
}

export interface TemplateGetBuildStatusOptions {
  fetch?: ClientOptions["fetch"];
  requestTimeoutMs?: number;
  logsOffset?: number;
  limit?: number;
  level?: string;
}

type HighLevelClientOptions = {
  fetch?: ClientOptions["fetch"];
  requestTimeoutMs?: number;
};
type BoundTemplateBuildOptions = Omit<TemplateBuildOptions, "fetch" | "requestTimeoutMs">;
type BoundTemplateGetBuildStatusOptions = Omit<TemplateGetBuildStatusOptions, "fetch" | "requestTimeoutMs">;

export class ReadyCmd {
  readonly #cmd: string;

  constructor(cmd: string) {
    this.#cmd = cmd;
  }

  getCmd(): string {
    return this.#cmd;
  }
}

export type LogEntryLevel = "debug" | "info" | "warn" | "error";

export class LogEntry {
  readonly timestamp: Date;
  readonly level: LogEntryLevel;
  readonly message: string;

  constructor(timestamp: Date, level: LogEntryLevel, message: string) {
    this.timestamp = timestamp;
    this.level = level;
    this.message = message;
  }

  toString(): string {
    return `[${this.timestamp.toISOString()}] ${this.level.toUpperCase()} ${this.message}`;
  }
}

export class LogEntryStart extends LogEntry {
  constructor(timestamp: Date, message: string) {
    super(timestamp, "info", message);
  }
}

export class LogEntryEnd extends LogEntry {
  constructor(timestamp: Date, message: string) {
    super(timestamp, "info", message);
  }
}

/**
 * High-level template builder with E2B-style helpers.
 */
export class Template {
  readonly #builder = new TemplateBuildBuilder();
  readonly #autoCopies = new Map<string, { src: string; forceUpload: boolean; mode?: number; resolveSymlinks?: boolean }>();
  #skipCache = false;

  static async build(
    template: Template,
    nameOrOptions: string | (TemplateBuildOptions & { name: string }),
    maybeOptions: TemplateBuildOptions = {},
  ): Promise<TemplateBuildInfo> {
    const { clientOptions, name, options } = normalizeStaticTemplateBuildArgs(nameOrOptions, maybeOptions);
    return buildTemplateWithService(
      new SandboxBuildService(resolveGatewayOptions(clientOptions)),
      template,
      name,
      options,
    );
  }

  static async buildInBackground(
    template: Template,
    nameOrOptions: string | (TemplateBuildOptions & { name: string }),
    maybeOptions: TemplateBuildOptions = {},
  ): Promise<TemplateBuildInfo> {
    const { clientOptions, name, options } = normalizeStaticTemplateBuildArgs(nameOrOptions, maybeOptions);
    return buildTemplateWithService(
      new SandboxBuildService(resolveGatewayOptions(clientOptions)),
      template,
      name,
      { ...options, wait: false },
    );
  }

  static async list(options: ListTemplatesParams & HighLevelClientOptions = {}): Promise<TemplateResponse[]> {
    assertNoHighLevelGatewayConfig(options as Record<string, unknown>);
    const { fetch, requestTimeoutMs, ...params } = options;
    return listTemplatesWithService(new SandboxBuildService(resolveGatewayOptions({ fetch, requestTimeoutMs })), params);
  }

  static async get(ref: string, options: GetTemplateParams & HighLevelClientOptions = {}): Promise<TemplateResponse> {
    assertNoHighLevelGatewayConfig(options as Record<string, unknown>);
    const { fetch, requestTimeoutMs, ...params } = options;
    return getTemplateWithService(new SandboxBuildService(resolveGatewayOptions({ fetch, requestTimeoutMs })), ref, params);
  }

  static async delete(ref: string, options: HighLevelClientOptions = {}): Promise<void> {
    assertNoHighLevelGatewayConfig(options as Record<string, unknown>);
    await deleteTemplateWithService(new SandboxBuildService(resolveGatewayOptions(options)), ref);
  }

  static async exists(ref: string, options: HighLevelClientOptions = {}): Promise<boolean> {
    assertNoHighLevelGatewayConfig(options as Record<string, unknown>);
    return templateExistsWithService(new SandboxBuildService(resolveGatewayOptions(options)), ref);
  }

  static async getBuildStatus(
    data: { buildId?: string; templateId?: string },
    options: TemplateGetBuildStatusOptions = {},
  ): Promise<TemplateBuildStatusInfo> {
    assertNoHighLevelGatewayConfig(options as Record<string, unknown>);
    const { fetch, requestTimeoutMs, ...params } = options;
    return getTemplateBuildStatusWithService(
      new SandboxBuildService(resolveGatewayOptions({ fetch, requestTimeoutMs })),
      data,
      params,
    );
  }

  fromImage(image: string, credentials?: ImageCredentials): this {
    this.#builder.fromImage(image);
    if (credentials) {
      this.#builder.fromImageRegistry({
        type: "registry",
        username: credentials.username,
        password: credentials.password,
      } satisfies GenericRegistryConfig);
    }
    return this;
  }

  fromBaseImage(): this {
    return this.fromImage("e2bdev/base:latest");
  }

  fromNodeImage(variant = "lts"): this {
    return this.fromImage(`node:${variant}`);
  }

  fromPythonImage(version = "3"): this {
    return this.fromImage(`python:${version}`);
  }

  fromBunImage(variant = "latest"): this {
    return this.fromImage(`oven/bun:${variant}`);
  }

  fromUbuntuImage(variant = "latest"): this {
    return this.fromImage(`ubuntu:${variant}`);
  }

  fromDebianImage(variant = "stable"): this {
    return this.fromImage(`debian:${variant}`);
  }

  fromAWSRegistry(image: string, credentials: AWSRegistryCredentials): this {
    this.#builder.fromImage(image);
    this.#builder.fromImageRegistry({
      type: "aws",
      awsAccessKeyId: credentials.accessKeyId,
      awsSecretAccessKey: credentials.secretAccessKey,
      awsRegion: credentials.region,
    });
    return this;
  }

  fromGCPRegistry(image: string, credentials: GCPRegistryCredentials): this {
    this.#builder.fromImage(image);
    this.#builder.fromImageRegistry({
      type: "gcp",
      serviceAccountJson: typeof credentials.serviceAccountJSON === "string"
        ? credentials.serviceAccountJSON
        : JSON.stringify(credentials.serviceAccountJSON),
    });
    return this;
  }

  fromTemplate(template: string): this {
    this.#builder.fromTemplate(template);
    return this;
  }

  /**
   * Parse a supported Dockerfile subset into template build steps.
   */
  fromDockerfile(dockerfileContentOrPath: string): this {
    const { content, contextDir } = resolveDockerfileInput(dockerfileContentOrPath);
    let seenFrom = false;
    for (const { instruction, value } of parseDockerfileInstructions(content)) {
      switch (instruction) {
        case "FROM": {
          if (seenFrom) {
            throw new ValidationError("Dockerfile multi-stage builds are not supported");
          }
          const tokens = tokenizeShellLike(value);
          if (tokens.length !== 1) {
            throw new ValidationError("FROM only supports a single base image");
          }
          this.fromImage(tokens[0]);
          seenFrom = true;
          break;
        }
        case "RUN":
          ensureDockerfileBaseImage(seenFrom);
          this.runCmd(requireDockerfileValue(instruction, value));
          break;
        case "ENV": {
          ensureDockerfileBaseImage(seenFrom);
          for (const [name, envValue] of parseDockerfileEnv(value)) {
            this.#builder.env(name, envValue);
          }
          break;
        }
        case "WORKDIR":
          ensureDockerfileBaseImage(seenFrom);
          this.setWorkdir(requireDockerfileValue(instruction, value));
          break;
        case "USER":
          ensureDockerfileBaseImage(seenFrom);
          this.setUser(requireDockerfileValue(instruction, value));
          break;
        case "COPY": {
          ensureDockerfileBaseImage(seenFrom);
          const { sources, dest } = parseDockerfileCopy(value);
          for (const source of sources) {
            this.copy(resolveDockerfileCopyPath(source, contextDir), dest);
          }
          break;
        }
        case "CMD":
          ensureDockerfileBaseImage(seenFrom);
          this.#builder.startCmd(parseDockerfileCmd(value));
          break;
        default:
          throw new ValidationError(`unsupported Dockerfile instruction: ${instruction}`);
      }
    }
    if (!seenFrom) {
      throw new ValidationError("Dockerfile must include a FROM instruction");
    }
    return this;
  }

  /**
   * Copy one or more local sources into the template build context.
   */
  copy(src: string | string[], dest: string, options: TemplateCopyOptions = {}): this {
    const sources = Array.isArray(src) ? src : [src];
    for (const source of sources) {
      const filesHash = options.filesHash ?? this.#registerAutoCopy(source, options);
      this.#builder.copy(source, dest, filesHash, { force: this.#stepForce() });
      if (options.user?.trim()) {
        this.#builder.run(buildCopyOwnershipCommand(dest, options.user), { force: this.#stepForce() });
      }
    }
    return this;
  }

  copyItems(items: TemplateCopyItem[]): this {
    for (const item of items) {
      this.copy(item.src, item.dest, item);
    }
    return this;
  }

  /**
   * Add one or more RUN steps, optionally wrapped to execute as a specific user.
   */
  runCmd(commandOrCommands: string | string[], options: TemplateCommandOptions = {}): this {
    const commands = Array.isArray(commandOrCommands) ? commandOrCommands : [commandOrCommands];
    for (const command of commands) {
      this.#builder.run(maybeRunAsUser(command, options.user), { force: this.#stepForce(options.force) });
    }
    return this;
  }

  aptInstall(packages: string | string[], options: AptInstallOptions = {}): this {
    const names = normalizeTemplateItems(packages, "package");
    return this.runCmd(buildAptInstallCommand(names, options), { force: options.force });
  }

  gitClone(repoUrl: string, path?: string, options: GitCloneOptions = {}): this {
    return this.runCmd(buildGitCloneCommand(repoUrl, path, options), { force: options.force });
  }

  makeDir(pathOrPaths: string | string[], options: MakeDirOptions = {}): this {
    const paths = normalizeTemplateItems(pathOrPaths, "path");
    for (const path of paths) {
      this.runCmd(buildMakeDirCommand(path, options), { force: options.force });
    }
    return this;
  }

  makeSymlink(src: string, dest: string, options: MakeSymlinkOptions = {}): this {
    return this.runCmd(buildMakeSymlinkCommand(src, dest, options), { force: options.force });
  }

  npmInstall(packages?: string | string[], options: NpmInstallOptions = {}): this {
    return this.runCmd(buildNpmInstallCommand(packages, options), { force: options.force });
  }

  pipInstall(packages?: string | string[], options: PipInstallOptions = {}): this {
    return this.runCmd(buildPipInstallCommand(packages, options), { force: options.force });
  }

  bunInstall(packages?: string | string[], options: BunInstallOptions = {}): this {
    return this.runCmd(buildBunInstallCommand(packages, options), { force: options.force });
  }

  setEnvs(envs: Record<string, string>): this {
    this.#builder.env(envs);
    return this;
  }

  setWorkdir(path: string, options: TemplateCommandOptions = {}): this {
    this.#builder.workdir(path, { force: this.#stepForce(options.force) });
    return this;
  }

  setUser(user: string, options: TemplateCommandOptions = {}): this {
    this.#builder.user(user, { force: this.#stepForce(options.force) });
    return this;
  }

  remove(pathOrPaths: string | string[], options: TemplateRemoveOptions = {}): this {
    const paths = normalizeTemplateItems(pathOrPaths, "path");
    for (const target of paths) {
      this.runCmd(buildRemoveCommand(target, options), { force: options.force });
    }
    return this;
  }

  rename(src: string, dest: string, options: TemplateRenameOptions = {}): this {
    return this.runCmd(buildRenameCommand(src, dest, options), { force: options.force });
  }

  skipCache(): this {
    this.#skipCache = true;
    return this;
  }

  setStartCmd(startCommand: string, readyCommand: string | ReadyCmd): this {
    this.#builder.startCmd(startCommand);
    return this.setReadyCmd(readyCommand);
  }

  setReadyCmd(readyCommand: string | ReadyCmd): this {
    this.#builder.readyCmd(toReadyCommand(readyCommand));
    return this;
  }

  filesHash(filesHash: string): this {
    this.#builder.filesHash(filesHash);
    return this;
  }

  request(): BuildRequest {
    const request = this.#builder.toRequest();
    for (const step of request.steps ?? []) {
      if (step.type === "COPY" && step.filesHash?.startsWith(AUTO_COPY_PREFIX)) {
        throw new ValidationError("copy steps without filesHash require Template.build()");
      }
    }
    return request;
  }

  async buildWithService(
    service: SandboxBuildService,
    name: string,
    options: BoundTemplateBuildOptions = {},
  ): Promise<TemplateBuildInfo> {
    const { name: templateName, tags: parsedTags } = parseTemplateName(name);
    const tags = dedupeStrings([...parsedTags, ...(options.tags ?? [])]);

    const created = await service.createTemplate({
      name: templateName,
      tags,
      cpuCount: options.cpuCount,
      memoryMB: options.memoryMB,
      extensions: options.baseTemplateID?.trim()
        ? { baseTemplateID: options.baseTemplateID.trim() }
        : undefined,
    } satisfies TemplateCreateRequest);

    const buildID = createBuildID();
    const request = await resolveTemplateRequest(
      this.#builder.toRequest(),
      this.#autoCopies,
      created.templateID,
      service,
      service.getFetch(),
    );
    if (options.onBuildLogs) {
      options.onBuildLogs(new LogEntryStart(new Date(), `Starting build ${buildID}`));
    }
    await service.createBuild(created.templateID, buildID, request);

    const wait = options.wait ?? true;
    if (!wait) {
      return {
        templateId: created.templateID,
        buildId: buildID,
        name: templateName,
        tags,
        alias: created.aliases?.[0],
      };
    }

    let logsOffset = 0;
    let status: BuildStatusResponse | undefined;
    for (;;) {
      status = await service.getBuildStatus(created.templateID, buildID, { logsOffset, limit: 100 });
      logsOffset += emitBuildLogs(status.logEntries ?? [], options.onBuildLogs);
      if (TERMINAL_BUILD_STATUSES.has(status.status)) {
        break;
      }
      await sleep(options.pollIntervalMs ?? 1_000);
    }

    if (options.onBuildLogs) {
      options.onBuildLogs(new LogEntryEnd(new Date(), `Build ${buildID} finished with status ${status.status}`));
    }

    return {
      templateId: created.templateID,
      buildId: buildID,
      name: templateName,
      tags,
      alias: created.aliases?.[0],
    };
  }

  static async toJSON(template: Template, computeHashes = true): Promise<string> {
    const request = await template.#serializeRequest(computeHashes);
    return JSON.stringify(request, null, 2);
  }

  /**
   * Convert the currently supported template subset into a Dockerfile string.
   */
  static toDockerfile(template: Template): string {
    const request = template.#builder.toRequest();
    if (request.fromTemplate) {
      throw new ValidationError("templates based on other templates cannot be converted to Dockerfile");
    }
    if (!request.fromImage?.trim()) {
      throw new ValidationError("template must define a base image to convert to Dockerfile");
    }
    const lines = [`FROM ${request.fromImage}`];
    for (const step of request.steps ?? []) {
      switch (step.type) {
        case "COPY":
          if ((step.args?.length ?? 0) >= 2) {
            const args = step.args ?? [];
            lines.push(`COPY ${args[0]} ${args[1]}`);
          }
          break;
        case "RUN":
          if (step.args?.[0]) {
            lines.push(`RUN ${step.args[0]}`);
          }
          break;
        case "ENV":
          lines.push(...dockerfileEnvLines(step.args ?? []));
          break;
        case "WORKDIR":
          if (step.args?.[0]) {
            lines.push(`WORKDIR ${step.args[0]}`);
          }
          break;
        case "USER":
          if (step.args?.[0]) {
            lines.push(`USER ${step.args[0]}`);
          }
          break;
      }
    }
    if (request.startCmd?.trim()) {
      lines.push(`CMD ["sh", "-lc", ${JSON.stringify(request.startCmd)}]`);
    }
    if (request.readyCmd?.trim()) {
      lines.push(`# Ready command: ${request.readyCmd}`);
    }
    return `${lines.join("\n")}\n`;
  }

  #registerAutoCopy(source: string, options: TemplateCopyOptions): string {
    const token = `${AUTO_COPY_PREFIX}${this.#autoCopies.size + 1}`;
    this.#autoCopies.set(token, {
      src: source,
      forceUpload: options.forceUpload ?? false,
      mode: options.mode,
      resolveSymlinks: options.resolveSymlinks,
    });
    return token;
  }

  #stepForce(force?: boolean): boolean | undefined {
    return force ?? (this.#skipCache ? true : undefined);
  }

  async #serializeRequest(computeHashes: boolean): Promise<BuildRequest> {
    const request = this.#builder.toRequest();
    if (!computeHashes) {
      return request;
    }
    const steps = request.steps ? request.steps.map((step: NonNullable<BuildRequest["steps"]>[number]) => ({ ...step, args: step.args ? [...step.args] : [] })) : [];
    for (const step of steps) {
      if (step.type !== "COPY" || !step.filesHash?.startsWith(AUTO_COPY_PREFIX)) {
        continue;
      }
      const copy = this.#autoCopies.get(step.filesHash);
      if (!copy) {
        throw new ValidationError(`unknown copy token ${step.filesHash}`);
      }
      const archivePath = normalizeArchiveSource(copy.src);
      step.filesHash = sha256Hex(await packTemplateSource(copy.src, archivePath, copy));
    }
    return { ...request, steps };
  }
}

export function defaultBuildLogger(
  options: { minLevel?: LogEntryLevel } = {},
): (entry: LogEntry) => void {
  const minLevel = options.minLevel ?? "info";
  const minIndex = LOG_LEVEL_ORDER.indexOf(minLevel);
  return (entry: LogEntry) => {
    if (LOG_LEVEL_ORDER.indexOf(entry.level) < minIndex) {
      return;
    }
    console.log(entry.toString());
  };
}

export function waitForFile(filename: string): ReadyCmd {
  return new ReadyCmd(`test -f ${shellQuote(filename)}`);
}

export function waitForPort(port: number): ReadyCmd {
  if (!Number.isInteger(port) || port <= 0) {
    throw new ValidationError("port must be a positive integer");
  }
  return new ReadyCmd(`sh -lc "ss -ltn | grep -q ':${port} '"`);
}

export function waitForProcess(processName: string): ReadyCmd {
  return new ReadyCmd(`pgrep -f ${shellQuote(processName)} >/dev/null`);
}

export function waitForTimeout(timeout: number): ReadyCmd {
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new ValidationError("timeout must be a positive number");
  }
  return new ReadyCmd(`sleep ${Math.ceil(timeout)}`);
}

export function waitForURL(url: string, statusCode = 200): ReadyCmd {
  if (!url.trim()) {
    throw new ValidationError("url is required");
  }
  return new ReadyCmd(
    `test "$(curl -o /dev/null -s -w '%{http_code}' ${shellQuote(url)})" = "${statusCode}"`,
  );
}

function emitBuildLogs(
  entries: BuildLogEntry[],
  onBuildLogs: ((entry: LogEntry) => void) | undefined,
): number {
  if (!onBuildLogs) {
    return entries.length;
  }
  for (const entry of entries) {
    onBuildLogs(
      new LogEntry(
        new Date(entry.timestamp),
        normalizeLogLevel(entry.level),
        `${entry.step}: ${entry.message}`,
      ),
    );
  }
  return entries.length;
}

export async function buildTemplateWithService(
  service: SandboxBuildService,
  template: Template,
  name: string,
  options: BoundTemplateBuildOptions = {},
): Promise<TemplateBuildInfo> {
  return template.buildWithService(service, name, options);
}

export async function templateExistsWithService(
  service: SandboxBuildService,
  ref: string,
): Promise<boolean> {
  try {
    await getTemplateWithService(service, ref);
    return true;
  } catch (error) {
    if (error instanceof NotFoundError) {
      return false;
    }
    throw error;
  }
}

export async function getTemplateBuildStatusWithService(
  service: SandboxBuildService,
  data: { buildId?: string; templateId?: string },
  options: BoundTemplateGetBuildStatusOptions = {},
): Promise<TemplateBuildStatusInfo> {
  const templateID = (data.templateId ?? "").trim();
  const buildID = (data.buildId ?? "").trim();
  if (!templateID) {
    throw new ValidationError("templateId is required");
  }
  if (!buildID) {
    throw new ValidationError("buildId is required");
  }
  const status = await service.getBuildStatus(templateID, buildID, {
    logsOffset: options.logsOffset,
    limit: options.limit,
    level: options.level,
  });
  return {
    ...status,
    buildId: status.buildID,
    templateId: status.templateID,
  };
}

export async function listTemplatesWithService(
  service: SandboxBuildService,
  params: ListTemplatesParams = {},
): Promise<TemplateResponse[]> {
  const templates = await service.listTemplates(params);
  return templates.map((item) => item as TemplateResponse);
}

export async function getTemplateWithService(
  service: SandboxBuildService,
  ref: string,
  params: GetTemplateParams = {},
): Promise<TemplateResponse> {
  const templateID = await resolveTemplateRefID(service, ref);
  return service.getTemplate(templateID, params);
}

export async function deleteTemplateWithService(
  service: SandboxBuildService,
  ref: string,
): Promise<void> {
  await service.deleteTemplate(await resolveTemplateRefID(service, ref));
}

function normalizeStaticTemplateBuildArgs(
  nameOrOptions: string | (TemplateBuildOptions & { name: string }),
  maybeOptions: TemplateBuildOptions,
): {
  clientOptions: HighLevelClientOptions;
  name: string;
  options: BoundTemplateBuildOptions;
} {
  if (typeof nameOrOptions === "string") {
    assertNoHighLevelGatewayConfig(maybeOptions as Record<string, unknown>);
    const { fetch, requestTimeoutMs, ...options } = maybeOptions;
    return {
      clientOptions: { fetch, requestTimeoutMs },
      name: nameOrOptions,
      options,
    };
  }
  const source = { ...nameOrOptions };
  assertNoHighLevelGatewayConfig(source as Record<string, unknown>);
  const { name, ...rest } = source;
  const { fetch, requestTimeoutMs, ...options } = rest;
  return {
    clientOptions: { fetch, requestTimeoutMs },
    name,
    options,
  };
}

function assertNoHighLevelGatewayConfig(source: Record<string, unknown>): void {
  for (const key of ["baseUrl", "apiKey", "projectId", "domain"]) {
    if (source[key] !== undefined) {
      throw new ConfigurationError(`${key} is not supported on high-level Template helpers; use E2B_DOMAIN/E2B_API_KEY env vars`);
    }
  }
}

function normalizeLogLevel(level: string): LogEntryLevel {
  switch (level) {
    case "debug":
    case "warn":
    case "error":
      return level;
    default:
      return "info";
  }
}

function toReadyCommand(command: string | ReadyCmd): string {
  return typeof command === "string" ? command : command.getCmd();
}

function normalizeTemplateItems(values: string | string[], label: string): string[] {
  const items = (Array.isArray(values) ? values : [values]).map((value) => value.trim()).filter(Boolean);
  if (items.length === 0) {
    throw new ValidationError(`${label} is required`);
  }
  return items;
}

function normalizeOptionalTemplateItems(values?: string | string[]): string[] {
  if (values === undefined) {
    return [];
  }
  return normalizeTemplateItems(values, "value");
}

function buildAptInstallCommand(
  packages: string[],
  options: AptInstallOptions,
): string {
  const installArgs = ["apt-get", "install", "-y"];
  if (options.noInstallRecommends) {
    installArgs.push("--no-install-recommends");
  }
  installArgs.push(...packages);
  return `${shellJoin(["apt-get", "update"])} && DEBIAN_FRONTEND=noninteractive ${shellJoin(installArgs)}`;
}

function buildGitCloneCommand(
  repoUrl: string,
  path: string | undefined,
  options: GitCloneOptions,
): string {
  const trimmedUrl = repoUrl.trim();
  if (!trimmedUrl) {
    throw new ValidationError("repo url is required");
  }
  const args = ["git", "clone"];
  if (options.branch) {
    args.push("--branch", options.branch);
  }
  if (options.depth !== undefined) {
    args.push("--depth", String(options.depth));
  }
  args.push(trimmedUrl);
  if (path?.trim()) {
    args.push(path.trim());
  }
  const command = shellJoin(args);
  if (!options.user) {
    return command;
  }
  return `su -s /bin/sh ${shellQuote(options.user)} -c ${shellQuote(command)}`;
}

function buildMakeDirCommand(path: string, options: MakeDirOptions): string {
  const args = ["mkdir", "-p"];
  if (options.mode !== undefined) {
    args.push("-m", formatFileMode(options.mode));
  }
  args.push(path);
  return maybeRunAsUser(shellJoin(args), options.user);
}

function buildCopyOwnershipCommand(path: string, user: string): string {
  return shellJoin(["chown", "-R", requireNonEmpty(user, "user"), requireNonEmpty(path, "dest")]);
}

function buildMakeSymlinkCommand(src: string, dest: string, options: MakeSymlinkOptions): string {
  const args = ["ln", "-s"];
  if (options.force) {
    args.push("-f");
  }
  args.push(src, dest);
  return maybeRunAsUser(shellJoin(args), options.user);
}

function buildRemoveCommand(path: string, options: TemplateRemoveOptions): string {
  const args = ["rm"];
  if (options.recursive) {
    args.push("-r");
  }
  if (options.force) {
    args.push("-f");
  }
  args.push(path);
  return maybeRunAsUser(shellJoin(args), options.user);
}

function buildRenameCommand(src: string, dest: string, options: TemplateRenameOptions): string {
  const args = ["mv"];
  if (options.force) {
    args.push("-f");
  }
  args.push(src, dest);
  return maybeRunAsUser(shellJoin(args), options.user);
}

function dockerfileEnvLines(args: string[]): string[] {
  const lines: string[] = [];
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1] ?? "";
    if (name) {
      lines.push(`ENV ${name}=${JSON.stringify(value)}`);
    }
  }
  return lines;
}

function buildNpmInstallCommand(packages: string | string[] | undefined, options: NpmInstallOptions): string {
  const args = ["npm", "install"];
  if (options.dev) {
    args.push("--save-dev");
  }
  if (options.g) {
    args.push("-g");
  }
  const names = normalizeOptionalTemplateItems(packages);
  if (names.length > 0) {
    args.push(...names);
  }
  return shellJoin(args);
}

function buildPipInstallCommand(packages: string | string[] | undefined, options: PipInstallOptions): string {
  const args = ["pip", "install"];
  if (options.g === false) {
    args.push("--user");
  }
  const names = normalizeOptionalTemplateItems(packages);
  if (names.length > 0) {
    args.push(...names);
  } else {
    args.push(".");
  }
  return shellJoin(args);
}

function buildBunInstallCommand(packages: string | string[] | undefined, options: BunInstallOptions): string {
  const args = ["bun", "install"];
  if (options.dev) {
    args.push("--dev");
  }
  if (options.g) {
    args.push("-g");
  }
  const names = normalizeOptionalTemplateItems(packages);
  if (names.length > 0) {
    args.push(...names);
  }
  return shellJoin(args);
}

function resolveDockerfileInput(dockerfileContentOrPath: string): { content: string; contextDir: string | undefined } {
  const raw = dockerfileContentOrPath;
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new ValidationError("dockerfile content or path is required");
  }
  const resolvedPath = path.resolve(trimmed);
  if (!trimmed.includes("\n") && existsSync(resolvedPath)) {
    return {
      content: readFileSync(resolvedPath, "utf8"),
      contextDir: path.dirname(resolvedPath),
    };
  }
  return { content: raw, contextDir: undefined };
}

function parseDockerfileInstructions(content: string): Array<{ instruction: string; value: string }> {
  return joinDockerfileLines(content)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const match = /^([A-Za-z]+)\s*(.*)$/.exec(line);
      if (!match) {
        throw new ValidationError(`invalid Dockerfile instruction: ${line}`);
      }
      return {
        instruction: match[1].toUpperCase(),
        value: match[2] ?? "",
      };
    });
}

function joinDockerfileLines(content: string): string[] {
  const lines: string[] = [];
  let current = "";
  for (const rawLine of content.split(/\r?\n/)) {
    const trimmedRight = rawLine.replace(/\s+$/, "");
    if (trimmedRight.endsWith("\\")) {
      current += `${trimmedRight.slice(0, -1)} `;
      continue;
    }
    current += trimmedRight;
    lines.push(current);
    current = "";
  }
  if (current.trim()) {
    lines.push(current);
  }
  return lines;
}

function ensureDockerfileBaseImage(seenFrom: boolean): void {
  if (!seenFrom) {
    throw new ValidationError("Dockerfile instructions must appear after FROM");
  }
}

function requireDockerfileValue(instruction: string, value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new ValidationError(`${instruction} requires a value`);
  }
  return trimmed;
}

function parseDockerfileEnv(value: string): Array<[string, string]> {
  const trimmed = requireDockerfileValue("ENV", value);
  const tokens = tokenizeShellLike(trimmed);
  if (tokens.length === 0) {
    throw new ValidationError("ENV requires at least one variable");
  }
  if (tokens.some((token) => token.includes("="))) {
    return tokens.map((token) => {
      const separator = token.indexOf("=");
      if (separator <= 0) {
        throw new ValidationError(`invalid ENV assignment: ${token}`);
      }
      return [token.slice(0, separator), token.slice(separator + 1)] satisfies [string, string];
    });
  }
  if (tokens.length < 2) {
    throw new ValidationError("ENV requires a key and value");
  }
  return [[tokens[0], stripMatchingQuotes(trimmed.slice(trimmed.indexOf(tokens[1])))]];
}

function parseDockerfileCopy(value: string): { sources: string[]; dest: string } {
  const trimmed = requireDockerfileValue("COPY", value);
  if (trimmed.startsWith("--")) {
    throw new ValidationError("COPY flags are not supported");
  }
  if (trimmed.startsWith("[")) {
    let items: unknown;
    try {
      items = JSON.parse(trimmed);
    } catch (error) {
      throw new ValidationError(`invalid COPY JSON array: ${(error as Error).message}`);
    }
    if (!Array.isArray(items) || items.length < 2 || items.some((item) => typeof item !== "string" || !item.trim())) {
      throw new ValidationError("COPY JSON array must contain at least one source and one destination");
    }
    const values = items.map((item) => String(item).trim());
    return { sources: values.slice(0, -1), dest: values[values.length - 1] };
  }
  const tokens = tokenizeShellLike(trimmed);
  if (tokens.length < 2) {
    throw new ValidationError("COPY requires at least one source and one destination");
  }
  if (tokens.some((token) => token.startsWith("--"))) {
    throw new ValidationError("COPY flags are not supported");
  }
  return { sources: tokens.slice(0, -1), dest: tokens[tokens.length - 1] };
}

function parseDockerfileCmd(value: string): string {
  const trimmed = requireDockerfileValue("CMD", value);
  if (!trimmed.startsWith("[")) {
    return trimmed;
  }
  let items: unknown;
  try {
    items = JSON.parse(trimmed);
  } catch (error) {
    throw new ValidationError(`invalid CMD JSON array: ${(error as Error).message}`);
  }
  if (!Array.isArray(items) || items.length === 0 || items.some((item) => typeof item !== "string")) {
    throw new ValidationError("CMD JSON array must contain one or more strings");
  }
  return shellJoin(items.map((item) => String(item)));
}

function resolveDockerfileCopyPath(source: string, contextDir: string | undefined): string {
  if (!contextDir || path.isAbsolute(source)) {
    return source;
  }
  return path.resolve(contextDir, source);
}

function tokenizeShellLike(value: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | "\"" | "" = "";
  let escaping = false;

  for (const char of value) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }
    if (char === "\\" && quote !== "'") {
      escaping = true;
      continue;
    }
    if ((char === "'" || char === "\"")) {
      if (!quote) {
        quote = char;
        continue;
      }
      if (quote === char) {
        quote = "";
        continue;
      }
    }
    if (!quote && /\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (escaping || quote) {
    throw new ValidationError("unterminated Dockerfile quoted value");
  }
  if (current) {
    tokens.push(current);
  }
  return tokens;
}

function stripMatchingQuotes(value: string): string {
  if (value.length >= 2 && ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'")))) {
    return value.slice(1, -1);
  }
  return value;
}

async function resolveTemplateRequest(
  request: BuildRequest,
  autoCopies: Map<string, { src: string; forceUpload: boolean; mode?: number; resolveSymlinks?: boolean }>,
  templateID: string,
  service: SandboxBuildService,
  fetchImpl: typeof fetch | undefined,
): Promise<BuildRequest> {
  const steps = request.steps ? request.steps.map((step) => ({ ...step, args: step.args ? [...step.args] : [] })) : [];
  const uploaded = new Set<string>();
  for (const step of steps) {
    if (step.type !== "COPY" || !step.filesHash?.startsWith(AUTO_COPY_PREFIX)) {
      continue;
    }
    const copy = autoCopies.get(step.filesHash);
    if (!copy) {
      throw new ValidationError(`unknown copy token ${step.filesHash}`);
    }
    const archivePath = normalizeArchiveSource(copy.src);
    if (step.args?.length) {
      step.args[0] = archivePath;
    }
    const tarBytes = await packTemplateSource(copy.src, archivePath, copy);
    const hash = sha256Hex(tarBytes);
    if (!uploaded.has(hash)) {
      const file = await service.getBuildFile(templateID, hash);
      if (!file.present || copy.forceUpload) {
        if (!file.url?.trim()) {
          throw new ValidationError(`build file upload URL is missing for hash ${hash}`);
        }
        await uploadBuildFile(file.url, tarBytes, fetchImpl);
      }
      uploaded.add(hash);
    }
    step.filesHash = hash;
  }
  return { ...request, steps };
}

async function packTemplateSource(
  source: string,
  archivePath: string,
  options: { mode?: number; resolveSymlinks?: boolean } = {},
): Promise<Uint8Array> {
  const normalizedSource = path.resolve(source);
  const chunks: Uint8Array[] = [];
  await appendTarEntry(chunks, normalizedSource, archivePath, options);
  chunks.push(new Uint8Array(1024));
  return gzipSync(concatBytes(chunks));
}

async function appendTarEntry(
  chunks: Uint8Array[],
  diskPath: string,
  archivePath: string,
  options: { mode?: number; resolveSymlinks?: boolean },
): Promise<void> {
  const entryStat = options.resolveSymlinks ? await stat(diskPath) : await lstat(diskPath);
  const normalizedArchivePath = archivePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalizedArchivePath) {
    throw new ValidationError("copy source path must not resolve to an empty archive path");
  }
  const entryMode = options.mode ?? (entryStat.mode & 0o777);

  if (entryStat.isDirectory()) {
    chunks.push(createTarHeader({
      name: ensureTrailingSlash(normalizedArchivePath),
      mode: entryMode,
      size: 0,
      type: "5",
    }));
    const entries = (await readdir(diskPath)).sort((a: string, b: string) => a.localeCompare(b));
    for (const entry of entries) {
      await appendTarEntry(
        chunks,
        path.join(diskPath, entry),
        path.posix.join(normalizedArchivePath, entry),
        options,
      );
    }
    return;
  }

  if (entryStat.isSymbolicLink()) {
    chunks.push(createTarHeader({
      name: normalizedArchivePath,
      mode: entryMode,
      size: 0,
      type: "2",
      linkname: await readlink(diskPath),
    }));
    return;
  }

  if (!entryStat.isFile()) {
    throw new ValidationError(`unsupported copy source type for ${diskPath}`);
  }

  const data = new Uint8Array(await readFile(diskPath));
  chunks.push(createTarHeader({
    name: normalizedArchivePath,
    mode: entryMode,
    size: data.byteLength,
    type: "0",
  }));
  chunks.push(data);
  const padding = (512 - (data.byteLength % 512)) % 512;
  if (padding > 0) {
    chunks.push(new Uint8Array(padding));
  }
}

function createTarHeader(input: {
  name: string;
  mode: number;
  size: number;
  type: "0" | "2" | "5";
  linkname?: string;
}): Uint8Array {
  const buffer = new Uint8Array(512);
  writeTarString(buffer, 0, 100, input.name);
  writeTarOctal(buffer, 100, 8, input.mode);
  writeTarOctal(buffer, 108, 8, 0);
  writeTarOctal(buffer, 116, 8, 0);
  writeTarOctal(buffer, 124, 12, input.size);
  writeTarOctal(buffer, 136, 12, 0);
  writeTarSpaces(buffer, 148, 8);
  buffer[156] = input.type.charCodeAt(0);
  writeTarString(buffer, 157, 100, input.linkname ?? "");
  writeTarString(buffer, 257, 6, "ustar");
  writeTarString(buffer, 263, 2, "00");
  writeTarString(buffer, 265, 32, "root");
  writeTarString(buffer, 297, 32, "root");
  let checksum = 0;
  for (const byte of buffer) {
    checksum += byte;
  }
  writeTarOctal(buffer, 148, 8, checksum);
  return buffer;
}

function writeTarString(buffer: Uint8Array, offset: number, length: number, value: string): void {
  const bytes = new TextEncoder().encode(value);
  buffer.set(bytes.subarray(0, Math.max(0, length)), offset);
}

function writeTarSpaces(buffer: Uint8Array, offset: number, length: number): void {
  buffer.fill(0x20, offset, offset + length);
}

function writeTarOctal(buffer: Uint8Array, offset: number, length: number, value: number): void {
  const encoded = value.toString(8).padStart(length - 2, "0");
  writeTarString(buffer, offset, length, `${encoded}\0 `);
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function sha256Hex(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function normalizeArchiveSource(source: string): string {
  const trimmed = source.trim();
  if (!trimmed) {
    throw new ValidationError("copy source path is required");
  }
  if (path.isAbsolute(trimmed)) {
    return path.basename(trimmed);
  }
  const normalized = trimmed.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
  return normalized || path.basename(trimmed);
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

async function uploadBuildFile(
  rawUrl: string,
  data: Uint8Array,
  fetchImpl: typeof fetch | undefined,
): Promise<void> {
  const response = await (fetchImpl ?? globalThis.fetch)(rawUrl, {
    method: "PUT",
    headers: { "Content-Type": "application/x-tar" },
    body: data as unknown as ArrayBuffer,
  });
  if (!response.ok) {
    throw new ValidationError(`build file upload failed with status ${response.status}`);
  }
}

async function resolveTemplateRefID(service: SandboxBuildService, ref: string): Promise<string> {
  const trimmed = ref.trim();
  if (!trimmed) {
    throw new ValidationError("template ref is required");
  }
  if (trimmed.startsWith("tpl-")) {
    return trimmed;
  }
  return (await service.resolveTemplateRef(trimmed)).templateID;
}

function requireNonEmpty(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new ValidationError(`${label} is required`);
  }
  return trimmed;
}

function parseTemplateName(name: string): { name: string; tags: string[] } {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new ValidationError("template name is required");
  }
  const parts = trimmed.split(":");
  if (parts.length === 1) {
    return { name: trimmed, tags: [] };
  }
  const tag = parts.pop()?.trim();
  const baseName = parts.join(":").trim();
  if (!baseName || !tag) {
    throw new ValidationError("template name must be in name or name:tag format");
  }
  return { name: baseName, tags: [tag] };
}

function createBuildID(): string {
  return `build-${Date.now().toString(16)}`;
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim()))];
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function shellJoin(args: string[]): string {
  return args.map((arg) => shellQuote(arg)).join(" ");
}

function maybeRunAsUser(command: string, user?: string): string {
  if (!user) {
    return command;
  }
  return `su -s /bin/sh ${shellQuote(user)} -c ${shellQuote(command)}`;
}

function formatFileMode(mode: number): string {
  if (!Number.isInteger(mode) || mode < 0) {
    throw new ValidationError("mode must be a non-negative integer");
  }
  return mode.toString(8);
}

function sleep(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, timeoutMs));
}

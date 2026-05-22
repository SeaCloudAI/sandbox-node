import type {
  ConnectSandboxRequest,
  ControlRequestOptions,
  ListSandboxesParams,
  ListedSandbox,
  Sandbox as ControlSandbox,
  SandboxDetail,
  NewSandboxRequest,
} from "./control/types.js";
import type {
  GetTemplateParams,
  ListTemplatesParams,
  TemplateResponse,
} from "./build/types.js";
import { SandboxControlService } from "./control/service.js";
import { SandboxBuildService } from "./build/service.js";
import { SandboxCommandService } from "./cmd/service.js";
import type { CmdOptions } from "./cmd/types.js";
import type { ClientOptions } from "./core/transport.js";
import { ConfigurationError } from "./core/errors.js";
import { SandboxRuntime } from "./runtime.js";
import {
  Sandbox as SandboxFacade,
  SandboxPaginator,
  type SandboxConnectOptions,
  type SandboxCreateOptions,
  type SandboxListOptions,
} from "./sandbox-facade.js";
import {
  bindSandbox,
  bindSandboxDetail,
  bindListedSandbox,
  type BoundConnectSandboxResponse,
  type ListedSandboxInstance,
  type SandboxDetailInstance,
  type SandboxInstance,
} from "./sandbox.js";
import {
  assignTemplateTagsWithService,
  buildTemplateWithService,
  deleteTemplateWithService,
  getTemplateTagsWithService,
  getTemplateBuildStatusWithService,
  getTemplateWithService,
  listTemplatesWithService,
  removeTemplateTagsWithService,
  templateExistsWithService,
  type Template,
  type TemplateBuildInfo,
  type TemplateBuildStatusInfo,
  type TemplateBuildOptions,
  type TemplateGetBuildStatusOptions,
  type TemplateTag,
  type TemplateTagInfo,
} from "./template.js";

type SandboxCommandTarget = Pick<ControlSandbox | SandboxDetail, "envdUrl" | "envdAccessToken">;
type BoundSandboxCreateOptions = Omit<SandboxCreateOptions, "fetch" | "requestTimeoutMs" | "debug" | "logger">;
type BoundSandboxCreateOverrides = Omit<BoundSandboxCreateOptions, "template">;
type BoundSandboxConnectOptions = Omit<SandboxConnectOptions, "fetch" | "requestTimeoutMs" | "debug" | "logger">;
type BoundSandboxListOptions = Omit<SandboxListOptions, "fetch" | "requestTimeoutMs" | "debug" | "logger">;
type BoundTemplateBuildOptions = Omit<TemplateBuildOptions, "fetch" | "requestTimeoutMs" | "debug" | "logger">;
type BoundTemplateGetBuildStatusOptions = Omit<TemplateGetBuildStatusOptions, "fetch" | "requestTimeoutMs" | "debug" | "logger">;
type BoundTemplateGetOptions = GetTemplateParams;

export class GatewayClient extends SandboxControlService {
  readonly build: SandboxBuildService;
  readonly #fetchImpl: typeof fetch | undefined;
  readonly #debug: boolean;
  readonly #logger: ClientOptions["logger"] | undefined;

  constructor(options: ClientOptions) {
    super(options);
    this.build = new SandboxBuildService(options);
    this.#fetchImpl = options.fetch;
    this.#debug = options.debug ?? false;
    this.#logger = options.logger;
  }

  override async createSandbox(body: NewSandboxRequest, options: ControlRequestOptions = {}): Promise<SandboxInstance> {
    return bindSandbox(this, await super.createSandbox(body, options));
  }

  override async getSandbox(sandboxID: string, options: ControlRequestOptions = {}): Promise<SandboxDetailInstance> {
    return bindSandboxDetail(this, await super.getSandbox(sandboxID, options));
  }

  override async listSandboxes(params: ListSandboxesParams = {}, options: ControlRequestOptions = {}): Promise<ListedSandboxInstance[]> {
    const sandboxes = await super.listSandboxes(params, options);
    return sandboxes.map((sandbox: ListedSandbox) => bindListedSandbox(this, sandbox));
  }

  override async connectSandbox(
    sandboxID: string,
    body: ConnectSandboxRequest,
    options: ControlRequestOptions = {},
  ): Promise<BoundConnectSandboxResponse> {
    const response = await super.connectSandbox(sandboxID, body, options);
    return {
      statusCode: response.statusCode,
      sandbox: bindSandbox(this, response.sandbox),
    };
  }

  cmd(options: CmdOptions): SandboxCommandService {
    return new SandboxCommandService({
      ...options,
      fetch: options.fetch ?? this.#fetchImpl,
      debug: options.debug ?? this.#debug,
      logger: options.logger ?? this.#logger,
    });
  }

  runtime(options: CmdOptions): SandboxRuntime {
    return new SandboxRuntime({
      baseUrl: options.baseUrl,
      accessToken: options.accessToken,
      fetch: options.fetch ?? this.#fetchImpl,
      timeoutMs: options.timeoutMs ?? this.timeoutMs,
      debug: options.debug ?? this.#debug,
      logger: options.logger ?? this.#logger,
    });
  }

  cmdFromSandbox(
    target: SandboxCommandTarget,
    options: Omit<CmdOptions, "baseUrl" | "accessToken"> = {},
  ): SandboxCommandService {
    return this.runtimeFromSandbox(target, options);
  }

  runtimeFromSandbox(
    target: SandboxCommandTarget,
    options: Omit<CmdOptions, "baseUrl" | "accessToken"> = {},
  ): SandboxRuntime {
    const baseUrl = target.envdUrl?.trim() ?? "";
    if (!baseUrl) {
      throw new ConfigurationError("envdUrl is required");
    }

    return new SandboxRuntime({
      ...options,
      baseUrl,
      accessToken: target.envdAccessToken ?? "",
      fetch: options.fetch ?? this.#fetchImpl,
      timeoutMs: options.timeoutMs ?? this.timeoutMs,
      debug: options.debug ?? this.#debug,
      logger: options.logger ?? this.#logger,
    });
  }

  async create(template: string, options?: BoundSandboxCreateOverrides): Promise<SandboxFacade>;
  async create(options: BoundSandboxCreateOptions): Promise<SandboxFacade>;
  async create(
    templateOrOptions: string | BoundSandboxCreateOptions,
    maybeOptions: BoundSandboxCreateOverrides = {},
  ): Promise<SandboxFacade> {
    const created = await this.createSandbox(normalizeCreateBody(templateOrOptions, maybeOptions));
    return new SandboxFacade(this, created);
  }

  async connect(
    sandboxID: string,
    options: BoundSandboxConnectOptions & ControlRequestOptions = {},
  ): Promise<SandboxFacade> {
    const response = await this.connectSandbox(
      sandboxID,
      { timeout: normalizeConnectTimeoutSeconds(options.timeout) },
      { requestTimeoutMs: options.requestTimeoutMs },
    );
    return new SandboxFacade(this, response.sandbox);
  }

  list(options: BoundSandboxListOptions = {}): SandboxPaginator {
    return new SandboxPaginator((params) => this.listSandboxes(params), options);
  }

  async buildTemplate(
    template: Template,
    nameOrOptions: string | (BoundTemplateBuildOptions & { name: string }),
    maybeOptions: BoundTemplateBuildOptions = {},
  ): Promise<TemplateBuildInfo> {
    const { name, options } = normalizeTemplateBuildArgs(nameOrOptions, maybeOptions);
    return buildTemplateWithService(this.build, template, name, options);
  }

  async buildTemplateInBackground(
    template: Template,
    nameOrOptions: string | (BoundTemplateBuildOptions & { name: string }),
    maybeOptions: BoundTemplateBuildOptions = {},
  ): Promise<TemplateBuildInfo> {
    const { name, options } = normalizeTemplateBuildArgs(nameOrOptions, maybeOptions);
    return buildTemplateWithService(this.build, template, name, { ...options, wait: false });
  }

  async templateExists(ref: string): Promise<boolean> {
    return templateExistsWithService(this.build, ref);
  }

  async getTemplateBuildStatus(
    data: { buildId?: string; templateId?: string },
    options: BoundTemplateGetBuildStatusOptions = {},
  ): Promise<TemplateBuildStatusInfo> {
    return getTemplateBuildStatusWithService(this.build, data, options);
  }

  async listTemplates(params: ListTemplatesParams = {}): Promise<TemplateResponse[]> {
    return listTemplatesWithService(this.build, params);
  }

  async getTemplate(ref: string, options: BoundTemplateGetOptions = {}): Promise<TemplateResponse> {
    return getTemplateWithService(this.build, ref, options);
  }

  async deleteTemplate(ref: string): Promise<void> {
    await deleteTemplateWithService(this.build, ref);
  }

  async assignTemplateTags(targetName: string, tags: string | string[]): Promise<TemplateTagInfo> {
    return assignTemplateTagsWithService(this.build, targetName, tags);
  }

  async getTemplateTags(templateId: string): Promise<TemplateTag[]> {
    return getTemplateTagsWithService(this.build, templateId);
  }

  async removeTemplateTags(name: string, tags: string | string[]): Promise<void> {
    await removeTemplateTagsWithService(this.build, name, tags);
  }
}

function normalizeCreateBody(
  templateOrOptions: string | BoundSandboxCreateOptions,
  maybeOptions: BoundSandboxCreateOverrides,
): {
  templateID: string;
  timeout?: number;
  autoPause?: boolean;
  metadata?: Record<string, string>;
  envVars?: Record<string, string>;
  waitReady?: boolean;
} {
  if (typeof templateOrOptions === "string") {
    return filterCreateBody({ ...maybeOptions, template: templateOrOptions });
  }
  const source = { ...templateOrOptions };
  return filterCreateBody(source);
}

function filterCreateBody(
  source: BoundSandboxCreateOptions,
): {
  templateID: string;
  timeout?: number;
  autoPause?: boolean;
  metadata?: Record<string, string>;
  envVars?: Record<string, string>;
  waitReady?: boolean;
} {
  rejectUnsupportedCreateFields(source as unknown as Record<string, unknown>);
  const templateID = typeof source.template === "string" && source.template.trim() ? source.template.trim() : undefined;
  if (templateID === undefined) {
    throw new ConfigurationError("templateID is required");
  }
  const timeout = source.timeout === undefined ? undefined : normalizeLifecycleTimeoutSeconds(source.timeout);
  return {
    templateID,
    timeout,
    autoPause: source.autoPause,
    metadata: source.metadata,
    envVars: source.envs,
    waitReady: source.waitReady,
  };
}

function rejectUnsupportedCreateFields(source: Record<string, unknown>): void {
  for (const key of ["autoResume", "secure", "allow_internet_access", "network", "mcp", "volumeMounts"]) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      throw new ConfigurationError(`${key} is not supported`);
    }
  }
}

function normalizeTemplateBuildArgs(
  nameOrOptions: string | (BoundTemplateBuildOptions & { name: string }),
  maybeOptions: BoundTemplateBuildOptions,
): { name: string; options: BoundTemplateBuildOptions } {
  if (typeof nameOrOptions === "string") {
    return { name: nameOrOptions, options: maybeOptions };
  }
  return { name: nameOrOptions.name, options: nameOrOptions };
}

function normalizeConnectTimeoutSeconds(timeout?: number): number {
  if (timeout === undefined) {
    return 300;
  }
  return normalizeLifecycleTimeoutSeconds(timeout);
}

function normalizeLifecycleTimeoutSeconds(timeout: number): number {
  if (!Number.isFinite(timeout) || timeout < 0) {
    throw new ConfigurationError("timeout must be a non-negative number");
  }
  return Math.floor(timeout);
}

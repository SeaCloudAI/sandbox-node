import type {
  ConnectSandboxRequest,
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
  buildTemplateWithService,
  deleteTemplateWithService,
  getTemplateBuildStatusWithService,
  getTemplateWithService,
  listTemplatesWithService,
  templateExistsWithService,
  type Template,
  type TemplateBuildInfo,
  type TemplateBuildStatusInfo,
  type TemplateBuildOptions,
  type TemplateGetBuildStatusOptions,
} from "./template.js";

type SandboxCommandTarget = Pick<ControlSandbox | SandboxDetail, "envdUrl" | "envdAccessToken">;
type BoundSandboxCreateOptions = Omit<SandboxCreateOptions, "fetch" | "requestTimeoutMs">;
type BoundSandboxConnectOptions = Omit<SandboxConnectOptions, "fetch" | "requestTimeoutMs">;
type BoundSandboxListOptions = Omit<SandboxListOptions, "fetch" | "requestTimeoutMs">;
type BoundTemplateBuildOptions = Omit<TemplateBuildOptions, "fetch" | "requestTimeoutMs">;
type BoundTemplateGetBuildStatusOptions = Omit<TemplateGetBuildStatusOptions, "fetch" | "requestTimeoutMs">;
type BoundTemplateGetOptions = GetTemplateParams;

export class GatewayClient extends SandboxControlService {
  readonly build: SandboxBuildService;
  readonly #fetchImpl: typeof fetch | undefined;

  constructor(options: ClientOptions) {
    super(options);
    this.build = new SandboxBuildService(options);
    this.#fetchImpl = options.fetch;
  }

  override async createSandbox(body: NewSandboxRequest): Promise<SandboxInstance> {
    return bindSandbox(this, await super.createSandbox(body));
  }

  override async getSandbox(sandboxID: string): Promise<SandboxDetailInstance> {
    return bindSandboxDetail(this, await super.getSandbox(sandboxID));
  }

  override async listSandboxes(params: ListSandboxesParams = {}): Promise<ListedSandboxInstance[]> {
    const sandboxes = await super.listSandboxes(params);
    return sandboxes.map((sandbox: ListedSandbox) => bindListedSandbox(this, sandbox));
  }

  override async connectSandbox(
    sandboxID: string,
    body: ConnectSandboxRequest,
  ): Promise<BoundConnectSandboxResponse> {
    const response = await super.connectSandbox(sandboxID, body);
    return {
      statusCode: response.statusCode,
      sandbox: bindSandbox(this, response.sandbox),
    };
  }

  cmd(options: CmdOptions): SandboxCommandService {
    return new SandboxCommandService({
      ...options,
      fetch: options.fetch ?? this.#fetchImpl,
    });
  }

  runtime(options: CmdOptions): SandboxRuntime {
    return new SandboxRuntime({
      baseUrl: options.baseUrl,
      accessToken: options.accessToken,
      fetch: options.fetch ?? this.#fetchImpl,
      timeoutMs: options.timeoutMs ?? this.timeoutMs,
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
    });
  }

  async create(
    templateOrOptions: string | BoundSandboxCreateOptions = {},
    maybeOptions: BoundSandboxCreateOptions = {},
  ): Promise<SandboxFacade> {
    const created = await this.createSandbox(normalizeCreateBody(templateOrOptions, maybeOptions));
    return new SandboxFacade(this, created);
  }

  async connect(
    sandboxID: string,
    options: BoundSandboxConnectOptions = {},
  ): Promise<SandboxFacade> {
    const response = await this.connectSandbox(sandboxID, { timeout: normalizeConnectTimeoutSeconds(options.timeout) });
    return new SandboxFacade(this, response.sandbox);
  }

  async list(options: BoundSandboxListOptions = {}): Promise<ListedSandboxInstance[]> {
    return this.listSandboxes(options);
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
}

function normalizeCreateBody(
  templateOrOptions: string | BoundSandboxCreateOptions,
  maybeOptions: BoundSandboxCreateOptions,
): {
  templateID?: string;
  timeout?: number;
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
  templateID?: string;
  timeout?: number;
  metadata?: Record<string, string>;
  envVars?: Record<string, string>;
  waitReady?: boolean;
} {
  const templateID = typeof source.template === "string" && source.template.trim() ? source.template.trim() : undefined;
  const timeout = source.timeout === undefined ? undefined : normalizeLifecycleTimeoutSeconds(source.timeout);
  return {
    templateID,
    timeout,
    metadata: source.metadata,
    envVars: source.envs,
    waitReady: source.waitReady,
  };
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
  return Math.ceil(timeout);
}

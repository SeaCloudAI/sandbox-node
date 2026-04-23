import type {
  ConnectSandboxRequest,
  ListSandboxesParams,
  ListedSandbox,
  Sandbox,
  SandboxDetail,
  NewSandboxRequest,
} from "./control/types.js";
import { SandboxControlService } from "./control/service.js";
import { SandboxBuildService } from "./build/service.js";
import { SandboxCommandService } from "./cmd/service.js";
import type { CmdOptions } from "./cmd/types.js";
import type { ClientOptions } from "./core/transport.js";
import { ConfigurationError } from "./core/errors.js";
import { SandboxRuntime } from "./runtime.js";
import {
  bindSandbox,
  bindSandboxDetail,
  bindListedSandbox,
  type BoundConnectSandboxResponse,
  type ListedSandboxInstance,
  type SandboxDetailInstance,
  type SandboxInstance,
} from "./sandbox.js";

type SandboxCommandTarget = Pick<Sandbox | SandboxDetail, "envdUrl" | "envdAccessToken">;

export class SandboxClient extends SandboxControlService {
  readonly build: SandboxBuildService;

  constructor(options: ClientOptions) {
    super(options);
    this.build = new SandboxBuildService(options);
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
    return new SandboxCommandService(options);
  }

  runtime(options: CmdOptions): SandboxRuntime {
    return new SandboxRuntime({
      baseUrl: options.baseUrl,
      accessToken: options.accessToken,
      fetch: options.fetch,
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
      timeoutMs: options.timeoutMs ?? this.timeoutMs,
    });
  }
}

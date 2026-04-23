import type { SandboxClient } from "./client.js";
import { ConfigurationError } from "./core/errors.js";
import type {
  ConnectSandboxRequest,
  ConnectSandboxResponse,
  ListedSandbox,
  RefreshSandboxRequest,
  Sandbox,
  SandboxDetail,
  SandboxLogsParams,
  SandboxLogsResponse,
  TimeoutRequest,
} from "./control/types.js";
import type { SandboxRuntime } from "./runtime.js";

type SandboxBindingClient = Pick<
  SandboxClient,
  | "runtimeFromSandbox"
  | "getSandbox"
  | "getSandboxLogs"
  | "pauseSandbox"
  | "deleteSandbox"
  | "refreshSandbox"
  | "setSandboxTimeout"
  | "connectSandbox"
>;

class BoundSandbox {
  readonly #client: SandboxBindingClient;
  #runtime?: SandboxRuntime;

  constructor(client: SandboxBindingClient) {
    this.#client = client;
  }

  get runtime(): SandboxRuntime {
    const target = this.runtimeTarget();
    if (!target?.envdUrl?.trim()) {
      throw new ConfigurationError("envdUrl is required");
    }
    this.#runtime ??= this.#client.runtimeFromSandbox(target);
    return this.#runtime;
  }

  async reload(): Promise<SandboxDetailInstance> {
    return this.#client.getSandbox(this.data().sandboxID);
  }

  async logs(params: SandboxLogsParams = {}): Promise<SandboxLogsResponse> {
    return this.#client.getSandboxLogs(this.data().sandboxID, params);
  }

  async pause(): Promise<void> {
    await this.#client.pauseSandbox(this.data().sandboxID);
  }

  async delete(): Promise<void> {
    await this.#client.deleteSandbox(this.data().sandboxID);
  }

  async refresh(body?: RefreshSandboxRequest): Promise<void> {
    await this.#client.refreshSandbox(this.data().sandboxID, body);
  }

  async setTimeout(body: TimeoutRequest): Promise<void> {
    await this.#client.setSandboxTimeout(this.data().sandboxID, body);
  }

  async connect(body: ConnectSandboxRequest): Promise<BoundConnectSandboxResponse> {
    return this.#client.connectSandbox(this.data().sandboxID, body);
  }

  private data(): Sandbox | SandboxDetail | ListedSandbox {
    return this as unknown as Sandbox | SandboxDetail | ListedSandbox;
  }

  private runtimeTarget(): Sandbox | SandboxDetail | null {
    const target = this.data();
    if (!("envdUrl" in target)) {
      return null;
    }
    return target;
  }
}

export type SandboxInstance = BoundSandbox & Sandbox;
export type SandboxDetailInstance = BoundSandbox & SandboxDetail;
export type ListedSandboxInstance = BoundSandbox & ListedSandbox;
export interface BoundConnectSandboxResponse extends Omit<ConnectSandboxResponse, "sandbox"> {
  sandbox: SandboxInstance;
}

export function bindSandbox(
  client: SandboxBindingClient,
  sandbox: Sandbox,
): SandboxInstance {
  return Object.assign(new BoundSandbox(client), sandbox) as SandboxInstance;
}

export function bindSandboxDetail(
  client: SandboxBindingClient,
  sandbox: SandboxDetail,
): SandboxDetailInstance {
  return Object.assign(new BoundSandbox(client), sandbox) as SandboxDetailInstance;
}

export function bindListedSandbox(
  client: SandboxBindingClient,
  sandbox: ListedSandbox,
): ListedSandboxInstance {
  return Object.assign(new BoundSandbox(client), sandbox) as ListedSandboxInstance;
}

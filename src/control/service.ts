import { APIError, ValidationError } from "../core/errors.js";
import { BaseTransport } from "../core/transport.js";
import type {
  ConnectSandboxRequest,
  ConnectSandboxResponse,
  HeartbeatRequest,
  HeartbeatResponse,
  ListSandboxesParams,
  ListedSandbox,
  NewSandboxRequest,
  PoolStatus,
  RefreshSandboxRequest,
  RollingStartRequest,
  RollingUpdateStatus,
  Sandbox,
  SandboxDetail,
  SandboxLogsParams,
  SandboxLogsResponse,
  TimeoutRequest,
  WrappedResponse,
} from "./types.js";

export class SandboxControlService extends BaseTransport {
  async createSandbox(body: NewSandboxRequest): Promise<Sandbox> {
    if (!body.templateID.trim()) {
      throw new ValidationError("templateID is required");
    }

    return this.requestJson<Sandbox>(
      "/api/v1/sandboxes",
      {
        method: "POST",
        headers: this.buildJSONHeaders(),
        body: JSON.stringify(body),
      },
      [201],
    );
  }

  async listSandboxes(params: ListSandboxesParams = {}): Promise<ListedSandbox[]> {
    const path = withQuery("/api/v1/sandboxes", encodeListParams(params));
    return this.requestJson<ListedSandbox[]>(path, {
      method: "GET",
    });
  }

  async getSandbox(sandboxID: string): Promise<SandboxDetail> {
    this.requireSandboxID(sandboxID);

    return this.requestJson<SandboxDetail>(`/api/v1/sandboxes/${encodeURIComponent(sandboxID)}`, {
      method: "GET",
    });
  }

  async deleteSandbox(sandboxID: string): Promise<void> {
    this.requireSandboxID(sandboxID);

    await this.requestEmpty(
      `/api/v1/sandboxes/${encodeURIComponent(sandboxID)}`,
      { method: "DELETE" },
      [204],
    );
  }

  async getSandboxLogs(
    sandboxID: string,
    params: SandboxLogsParams = {},
  ): Promise<SandboxLogsResponse> {
    this.requireSandboxID(sandboxID);
    this.validateLogsParams(params);

    const path = withQuery(
      `/api/v1/sandboxes/${encodeURIComponent(sandboxID)}/logs`,
      encodeLogsParams(params),
    );
    return this.requestJson<SandboxLogsResponse>(path, {
      method: "GET",
    });
  }

  async pauseSandbox(sandboxID: string): Promise<void> {
    this.requireSandboxID(sandboxID);

    await this.requestEmpty(
      `/api/v1/sandboxes/${encodeURIComponent(sandboxID)}/pause`,
      { method: "POST" },
      [204],
    );
  }

  async connectSandbox(
    sandboxID: string,
    body: ConnectSandboxRequest,
  ): Promise<ConnectSandboxResponse> {
    this.requireSandboxID(sandboxID);
    this.validateTimeout(body.timeout, "connect timeout");

    const response = await this.request(`/api/v1/sandboxes/${encodeURIComponent(sandboxID)}/connect`, {
      method: "POST",
      headers: this.buildJSONHeaders(),
      body: JSON.stringify(body),
    });
    if (![200, 201].includes(response.status)) {
      throw await APIError.fromResponse(response);
    }

    const sandbox = (await response.json()) as Sandbox;
    return { statusCode: response.status, sandbox };
  }

  async setSandboxTimeout(sandboxID: string, body: TimeoutRequest): Promise<void> {
    this.requireSandboxID(sandboxID);
    this.validateTimeout(body.timeout, "timeout");

    await this.requestEmpty(
      `/api/v1/sandboxes/${encodeURIComponent(sandboxID)}/timeout`,
      {
        method: "POST",
        headers: this.buildJSONHeaders(),
        body: JSON.stringify(body),
      },
      [204],
    );
  }

  async refreshSandbox(
    sandboxID: string,
    body?: RefreshSandboxRequest,
  ): Promise<void> {
    this.requireSandboxID(sandboxID);
    this.validateRefreshDuration(body?.duration);

    await this.requestEmpty(
      `/api/v1/sandboxes/${encodeURIComponent(sandboxID)}/refreshes`,
      {
        method: "POST",
        headers: body === undefined ? undefined : this.buildJSONHeaders(),
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      [204],
    );
  }

  async sendHeartbeat(
    sandboxID: string,
    body: HeartbeatRequest,
  ): Promise<HeartbeatResponse> {
    this.requireSandboxID(sandboxID);
    this.validateHeartbeatStatus(body.status);

    const wrapped = await this.requestJson<WrappedResponse<Omit<HeartbeatResponse, "requestId">>>(
      `/api/v1/sandboxes/${encodeURIComponent(sandboxID)}/heartbeat`,
      {
        method: "POST",
        headers: this.buildJSONHeaders(),
        body: JSON.stringify(body),
      },
    );
    return { ...wrapped.data, requestId: wrapped.request_id };
  }

  async getPoolStatus(): Promise<PoolStatus> {
    const wrapped = await this.requestJson<WrappedResponse<Omit<PoolStatus, "requestId">>>(
      "/admin/pool/status",
      { method: "GET" },
    );
    return { ...wrapped.data, requestId: wrapped.request_id };
  }

  async startRollingUpdate(body: RollingStartRequest): Promise<RollingUpdateStatus> {
    if (!body.templateId.trim()) {
      throw new ValidationError("templateId is required");
    }

    const wrapped = await this.requestJson<WrappedResponse<Omit<RollingUpdateStatus, "requestId">>>(
      "/admin/rolling/start",
      {
        method: "POST",
        headers: this.buildJSONHeaders(),
        body: JSON.stringify(body),
      },
    );
    return { ...wrapped.data, requestId: wrapped.request_id };
  }

  async getRollingUpdateStatus(): Promise<RollingUpdateStatus> {
    const wrapped = await this.requestJson<WrappedResponse<Omit<RollingUpdateStatus, "requestId">>>(
      "/admin/rolling/status",
      { method: "GET" },
    );
    return { ...wrapped.data, requestId: wrapped.request_id };
  }

  async cancelRollingUpdate(): Promise<RollingUpdateStatus> {
    const wrapped = await this.requestJson<WrappedResponse<Omit<RollingUpdateStatus, "requestId">>>(
      "/admin/rolling/cancel",
      { method: "POST" },
    );
    return { ...wrapped.data, requestId: wrapped.request_id };
  }

  private requireSandboxID(sandboxID: string): void {
    if (!sandboxID.trim()) {
      throw new ValidationError("sandboxID is required");
    }
  }

  private validateTimeout(timeout: number, field: string): void {
    if (!Number.isInteger(timeout) || timeout < 0 || timeout > 86400) {
      throw new ValidationError(`${field} must be an integer between 0 and 86400`);
    }
  }

  private validateRefreshDuration(duration: number | undefined): void {
    if (duration === undefined) {
      return;
    }
    if (!Number.isInteger(duration) || duration < 0 || duration > 3600) {
      throw new ValidationError("refresh duration must be an integer between 0 and 3600");
    }
  }

  private validateHeartbeatStatus(status: string): void {
    if (!["starting", "healthy", "error"].includes(status.trim())) {
      throw new ValidationError("heartbeat status must be one of starting, healthy, error");
    }
  }

  private validateLogsParams(params: SandboxLogsParams): void {
    if (params.cursor !== undefined && (!Number.isInteger(params.cursor) || params.cursor < 0)) {
      throw new ValidationError("logs cursor must be a non-negative integer");
    }
    if (params.limit !== undefined && (!Number.isInteger(params.limit) || params.limit < 0 || params.limit > 1000)) {
      throw new ValidationError("logs limit must be an integer between 0 and 1000");
    }
    if (params.direction !== undefined) {
      const direction = params.direction.trim();
      if (direction && direction !== "forward" && direction !== "backward") {
        throw new ValidationError('logs direction must be "forward" or "backward"');
      }
    }
    if (params.search !== undefined && params.search.length > 256) {
      throw new ValidationError("logs search must be at most 256 characters");
    }
  }

  private buildJSONHeaders(): Headers {
    return this.buildHeaders({ "Content-Type": "application/json" });
  }
}

function withQuery(path: string, query: URLSearchParams): string {
  const suffix = query.toString();
  return suffix ? `${path}?${suffix}` : path;
}

function encodeListParams(params: ListSandboxesParams): URLSearchParams {
  const query = new URLSearchParams();
  if (params.metadata && Object.keys(params.metadata).length > 0) {
    const metadata = new URLSearchParams();
    for (const [key, value] of Object.entries(params.metadata)) {
      metadata.set(key, value);
    }
    query.set("metadata", metadata.toString());
  }
  for (const state of params.state ?? []) {
    const value = state.trim();
    if (value) {
      query.append("state", value);
    }
  }
  if (params.limit !== undefined) {
    query.set("limit", String(params.limit));
  }
  if (params.nextToken?.trim()) {
    query.set("nextToken", params.nextToken.trim());
  }
  return query;
}

function encodeLogsParams(params: SandboxLogsParams): URLSearchParams {
  const query = new URLSearchParams();
  if (params.cursor !== undefined) {
    query.set("cursor", String(params.cursor));
  }
  if (params.limit !== undefined) {
    query.set("limit", String(params.limit));
  }
  if (params.direction?.trim()) {
    query.set("direction", params.direction.trim());
  }
  if (params.level?.trim()) {
    query.set("level", params.level.trim());
  }
  if (params.search?.trim()) {
    query.set("search", params.search.trim());
  }
  return query;
}

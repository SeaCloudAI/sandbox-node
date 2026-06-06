import { APIError, ValidationError } from "../core/errors.js";
import { BaseTransport } from "../core/transport.js";
import type {
  ConnectSandboxRequest,
  ConnectSandboxResponse,
  ControlRequestOptions,
  DeleteWebhookResponse,
  HeartbeatRequest,
  HeartbeatResponse,
  LifecycleWebhook,
  LifecycleWebhookCreateRequest,
  LifecycleWebhookDelivery,
  LifecycleWebhookUpdateRequest,
  ListSandboxEventsParams,
  ListSandboxesParams,
  ListWebhookDeliveriesParams,
  ListedSandbox,
  MaxTeamMetric,
  NewVolumeRequest,
  NewSandboxRequest,
  PoolStatus,
  RefreshSandboxRequest,
  RollingStartRequest,
  RollingUpdateStatus,
  Sandbox,
  SandboxDetail,
  SandboxesPage,
  SandboxLifecycleEvent,
  SandboxMetricSnapshot,
  SandboxMetricsParams,
  SandboxMetricsResponse,
  ObservabilitySummary,
  SandboxLogsParams,
  SandboxLogsResponse,
  Team,
  TeamMetric,
  TeamMetricsMaxParams,
  TeamMetricsParams,
  TimeoutRequest,
  Volume,
  VolumeAndToken,
  WrappedResponse,
} from "./types.js";

export class SandboxControlService extends BaseTransport {
  async createSandbox(body: NewSandboxRequest, options: ControlRequestOptions = {}): Promise<Sandbox> {
    rejectUnsupportedCreateFields(body as unknown as Record<string, unknown>);

    return this.requestJson<Sandbox>(
      this.apiPath("/sandboxes"),
      {
        method: "POST",
        headers: this.buildJSONHeaders(),
        body: JSON.stringify(body),
      },
      [201],
      options.requestTimeoutMs,
    );
  }

  async listSandboxEvents(params: ListSandboxEventsParams = {}, options: ControlRequestOptions = {}): Promise<SandboxLifecycleEvent[]> {
    const path = withQuery(this.apiPath("/events/sandboxes"), encodeEventsParams(params));
    return this.requestJson<SandboxLifecycleEvent[]>(path, { method: "GET" }, [200], options.requestTimeoutMs);
  }

  async listSandboxEventsBySandbox(
    sandboxID: string,
    params: ListSandboxEventsParams = {},
    options: ControlRequestOptions = {},
  ): Promise<SandboxLifecycleEvent[]> {
    this.requireSandboxID(sandboxID);
    const path = withQuery(this.apiPath(`/events/sandboxes/${encodeURIComponent(sandboxID)}`), encodeEventsParams(params));
    return this.requestJson<SandboxLifecycleEvent[]>(path, { method: "GET" }, [200], options.requestTimeoutMs);
  }

  async createWebhook(body: LifecycleWebhookCreateRequest, options: ControlRequestOptions = {}): Promise<LifecycleWebhook> {
    return this.requestJson<LifecycleWebhook>(
      this.apiPath("/events/webhooks"),
      {
        method: "POST",
        headers: this.buildJSONHeaders(),
        body: JSON.stringify(body),
      },
      [201],
      options.requestTimeoutMs,
    );
  }

  async listWebhooks(options: ControlRequestOptions = {}): Promise<LifecycleWebhook[]> {
    return this.requestJson<LifecycleWebhook[]>(this.apiPath("/events/webhooks"), { method: "GET" }, [200], options.requestTimeoutMs);
  }

  async getWebhook(webhookID: string, options: ControlRequestOptions = {}): Promise<LifecycleWebhook> {
    requireNonEmpty(webhookID, "webhookID");
    return this.requestJson<LifecycleWebhook>(
      this.apiPath(`/events/webhooks/${encodeURIComponent(webhookID)}`),
      { method: "GET" },
      [200],
      options.requestTimeoutMs,
    );
  }

  async updateWebhook(
    webhookID: string,
    body: LifecycleWebhookUpdateRequest,
    options: ControlRequestOptions = {},
  ): Promise<LifecycleWebhook> {
    requireNonEmpty(webhookID, "webhookID");
    return this.requestJson<LifecycleWebhook>(
      this.apiPath(`/events/webhooks/${encodeURIComponent(webhookID)}`),
      {
        method: "PATCH",
        headers: this.buildJSONHeaders(),
        body: JSON.stringify(body),
      },
      [200],
      options.requestTimeoutMs,
    );
  }

  async deleteWebhook(webhookID: string, options: ControlRequestOptions = {}): Promise<DeleteWebhookResponse> {
    requireNonEmpty(webhookID, "webhookID");
    return this.requestJson<DeleteWebhookResponse>(
      this.apiPath(`/events/webhooks/${encodeURIComponent(webhookID)}`),
      { method: "DELETE" },
      [200],
      options.requestTimeoutMs,
    );
  }

  async listWebhookDeliveries(
    params: ListWebhookDeliveriesParams = {},
    options: ControlRequestOptions = {},
  ): Promise<LifecycleWebhookDelivery[]> {
    const path = withQuery(this.apiPath("/events/webhook-deliveries"), encodeDeliveryParams(params));
    return this.requestJson<LifecycleWebhookDelivery[]>(path, { method: "GET" }, [200], options.requestTimeoutMs);
  }

  async listWebhookDeliveriesByWebhook(
    webhookID: string,
    params: ListWebhookDeliveriesParams = {},
    options: ControlRequestOptions = {},
  ): Promise<LifecycleWebhookDelivery[]> {
    requireNonEmpty(webhookID, "webhookID");
    const path = withQuery(
      this.apiPath(`/events/webhooks/${encodeURIComponent(webhookID)}/deliveries`),
      encodeDeliveryParams(params),
    );
    return this.requestJson<LifecycleWebhookDelivery[]>(path, { method: "GET" }, [200], options.requestTimeoutMs);
  }

  async replayWebhookDelivery(deliveryID: string, options: ControlRequestOptions = {}): Promise<LifecycleWebhookDelivery> {
    requireNonEmpty(deliveryID, "deliveryID");
    return this.requestJson<LifecycleWebhookDelivery>(
      this.apiPath(`/events/webhook-deliveries/${encodeURIComponent(deliveryID)}/replay`),
      { method: "POST" },
      [202],
      options.requestTimeoutMs,
    );
  }

  async listVolumes(options: ControlRequestOptions = {}): Promise<Volume[]> {
    return this.requestJson<Volume[]>(this.apiPath("/volumes"), { method: "GET" }, [200], options.requestTimeoutMs);
  }

  async createVolume(body: NewVolumeRequest, options: ControlRequestOptions = {}): Promise<VolumeAndToken> {
    return this.requestJson<VolumeAndToken>(
      this.apiPath("/volumes"),
      {
        method: "POST",
        headers: this.buildJSONHeaders(),
        body: JSON.stringify(body),
      },
      [201],
      options.requestTimeoutMs,
    );
  }

  async getVolume(volumeID: string, options: ControlRequestOptions = {}): Promise<VolumeAndToken> {
    requireNonEmpty(volumeID, "volumeID");
    return this.requestJson<VolumeAndToken>(
      this.apiPath(`/volumes/${encodeURIComponent(volumeID)}`),
      { method: "GET" },
      [200],
      options.requestTimeoutMs,
    );
  }

  async deleteVolume(volumeID: string, options: ControlRequestOptions = {}): Promise<void> {
    requireNonEmpty(volumeID, "volumeID");
    await this.requestEmpty(
      this.apiPath(`/volumes/${encodeURIComponent(volumeID)}`),
      { method: "DELETE" },
      [204],
      options.requestTimeoutMs,
    );
  }

  async listTeams(options: ControlRequestOptions = {}): Promise<Team[]> {
    return this.requestJson<Team[]>(this.apiPath("/teams"), { method: "GET" }, [200], options.requestTimeoutMs);
  }

  async getTeamMetrics(teamID: string, params: TeamMetricsParams = {}, options: ControlRequestOptions = {}): Promise<TeamMetric[]> {
    requireNonEmpty(teamID, "teamID");
    const path = withQuery(this.apiPath(`/teams/${encodeURIComponent(teamID)}/metrics`), encodeTeamMetricsParams(params));
    return this.requestJson<TeamMetric[]>(path, { method: "GET" }, [200], options.requestTimeoutMs);
  }

  async getTeamMetricsMax(
    teamID: string,
    params: TeamMetricsMaxParams,
    options: ControlRequestOptions = {},
  ): Promise<MaxTeamMetric> {
    requireNonEmpty(teamID, "teamID");
    const path = withQuery(this.apiPath(`/teams/${encodeURIComponent(teamID)}/metrics/max`), encodeTeamMetricsMaxParams(params));
    return this.requestJson<MaxTeamMetric>(path, { method: "GET" }, [200], options.requestTimeoutMs);
  }

  async listSandboxes(params: ListSandboxesParams = {}, options: ControlRequestOptions = {}): Promise<ListedSandbox[]> {
    return (await this.listSandboxesPage(params, options)).items;
  }

  async listSandboxesPage(params: ListSandboxesParams = {}, options: ControlRequestOptions = {}): Promise<SandboxesPage> {
    const path = withQuery(this.apiPath("/sandboxes"), encodeListParams(params));
    const response = await this.request(path, {
      method: "GET",
    }, options.requestTimeoutMs);
    if (response.status !== 200) {
      throw await APIError.fromResponse(response);
    }
    return {
      items: (await response.json()) as ListedSandbox[],
      nextToken: response.headers.get("X-Next-Token") ?? "",
      hasNext: response.headers.get("X-Has-Next")?.toLowerCase() === "true",
    };
  }

  async getSandbox(sandboxID: string, options: ControlRequestOptions = {}): Promise<SandboxDetail> {
    this.requireSandboxID(sandboxID);

    return this.requestJson<SandboxDetail>(this.apiPath(`/sandboxes/${encodeURIComponent(sandboxID)}`), {
      method: "GET",
    }, [200], options.requestTimeoutMs);
  }

  async getSandboxMetrics(sandboxID: string, options: ControlRequestOptions = {}): Promise<SandboxMetricSnapshot> {
    this.requireSandboxID(sandboxID);

    return this.requestJson<SandboxMetricSnapshot>(
      this.apiPath(`/sandboxes/${encodeURIComponent(sandboxID)}/metrics`),
      { method: "GET" },
      [200],
      options.requestTimeoutMs,
    );
  }

  async listSandboxMetrics(params: SandboxMetricsParams = {}, options: ControlRequestOptions = {}): Promise<SandboxMetricsResponse> {
    const path = withQuery(this.apiPath("/sandboxes/metrics"), encodeMetricsParams(params));
    return this.requestJson<SandboxMetricsResponse>(path, {
      method: "GET",
    }, [200], options.requestTimeoutMs);
  }

  async getObservabilitySummary(options: ControlRequestOptions = {}): Promise<ObservabilitySummary> {
    return this.requestJson<ObservabilitySummary>(this.apiPath("/observability/summary"), {
      method: "GET",
    }, [200], options.requestTimeoutMs);
  }

  async deleteSandbox(sandboxID: string, options: ControlRequestOptions = {}): Promise<void> {
    this.requireSandboxID(sandboxID);

    await this.requestEmpty(
      this.apiPath(`/sandboxes/${encodeURIComponent(sandboxID)}`),
      { method: "DELETE" },
      [204],
      options.requestTimeoutMs,
    );
  }

  async getSandboxLogs(
    sandboxID: string,
    params: SandboxLogsParams = {},
    options: ControlRequestOptions = {},
  ): Promise<SandboxLogsResponse> {
    this.requireSandboxID(sandboxID);
    this.validateLogsParams(params);

    const path = withQuery(
      this.apiPath(`/sandboxes/${encodeURIComponent(sandboxID)}/logs`),
      encodeLogsParams(params),
    );
    return this.requestJson<SandboxLogsResponse>(path, {
      method: "GET",
    }, [200], options.requestTimeoutMs);
  }

  async pauseSandbox(sandboxID: string, options: ControlRequestOptions = {}): Promise<void> {
    this.requireSandboxID(sandboxID);

    await this.requestEmpty(
      this.apiPath(`/sandboxes/${encodeURIComponent(sandboxID)}/pause`),
      { method: "POST" },
      [204],
      options.requestTimeoutMs,
    );
  }

  async connectSandbox(
    sandboxID: string,
    body: ConnectSandboxRequest,
    options: ControlRequestOptions = {},
  ): Promise<ConnectSandboxResponse> {
    this.requireSandboxID(sandboxID);
    this.validateTimeoutSeconds(body.timeout, "connect timeout");

    const response = await this.request(this.apiPath(`/sandboxes/${encodeURIComponent(sandboxID)}/connect`), {
      method: "POST",
      headers: this.buildJSONHeaders(),
      body: JSON.stringify(body),
    }, options.requestTimeoutMs);
    if (![200, 201].includes(response.status)) {
      throw await APIError.fromResponse(response);
    }

    const sandbox = (await response.json()) as Sandbox;
    return { statusCode: response.status, sandbox };
  }

  async setSandboxTimeout(sandboxID: string, body: TimeoutRequest, options: ControlRequestOptions = {}): Promise<void> {
    this.requireSandboxID(sandboxID);
    this.validateTimeoutSeconds(body.timeout, "timeout");

    await this.requestEmpty(
      this.apiPath(`/sandboxes/${encodeURIComponent(sandboxID)}/timeout`),
      {
        method: "POST",
        headers: this.buildJSONHeaders(),
        body: JSON.stringify(body),
      },
      [204],
      options.requestTimeoutMs,
    );
  }

  async refreshSandbox(
    sandboxID: string,
    body?: RefreshSandboxRequest,
    options: ControlRequestOptions = {},
  ): Promise<void> {
    this.requireSandboxID(sandboxID);
    this.validateRefreshDuration(body?.duration);

    await this.requestEmpty(
      this.apiPath(`/sandboxes/${encodeURIComponent(sandboxID)}/refreshes`),
      {
        method: "POST",
        headers: body === undefined ? undefined : this.buildJSONHeaders(),
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      [204],
      options.requestTimeoutMs,
    );
  }

  async sendHeartbeat(
    sandboxID: string,
    body: HeartbeatRequest,
  ): Promise<HeartbeatResponse> {
    this.requireSandboxID(sandboxID);
    this.validateHeartbeatStatus(body.status);

    const wrapped = await this.requestJson<WrappedResponse<Omit<HeartbeatResponse, "requestId">>>(
      this.apiPath(`/sandboxes/${encodeURIComponent(sandboxID)}/heartbeat`),
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

  private validateTimeoutSeconds(timeout: number, field: string): void {
    if (!Number.isInteger(timeout) || timeout < 0 || timeout > 86_400) {
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

function rejectUnsupportedCreateFields(source: Record<string, unknown>): void {
  for (const key of ["secure", "mcp", "volume_mounts"]) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      throw new ValidationError(`${key} is not supported`);
    }
  }
}

function requireNonEmpty(value: string, field: string): void {
  if (!value.trim()) {
    throw new ValidationError(`${field} is required`);
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

function encodeEventsParams(params: ListSandboxEventsParams): URLSearchParams {
  const query = new URLSearchParams();
  if (params.offset !== undefined) {
    query.set("offset", String(params.offset));
  }
  if (params.limit !== undefined) {
    query.set("limit", String(params.limit));
  }
  if (params.orderAsc !== undefined) {
    query.set("orderAsc", String(params.orderAsc));
  }
  for (const type of params.types ?? []) {
    const value = type.trim();
    if (value) {
      query.append("types", value);
    }
  }
  return query;
}

function encodeDeliveryParams(params: ListWebhookDeliveriesParams): URLSearchParams {
  const query = new URLSearchParams();
  if (params.offset !== undefined) {
    query.set("offset", String(params.offset));
  }
  if (params.limit !== undefined) {
    query.set("limit", String(params.limit));
  }
  if (params.orderAsc !== undefined) {
    query.set("orderAsc", String(params.orderAsc));
  }
  if (params.webhookID?.trim()) {
    query.set("webhookID", params.webhookID.trim());
  }
  if (params.eventID?.trim()) {
    query.set("eventID", params.eventID.trim());
  }
  if (params.status?.trim()) {
    query.set("status", params.status.trim());
  }
  return query;
}

function encodeMetricsParams(params: SandboxMetricsParams): URLSearchParams {
  const query = new URLSearchParams();
  const ids = (params.sandboxIDs ?? [])
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  if (ids.length > 0) {
    query.set("sandbox_ids", ids.join(","));
  }
  if (params.limit !== undefined) {
    query.set("limit", String(params.limit));
  }
  return query;
}

function encodeTeamMetricsParams(params: TeamMetricsParams): URLSearchParams {
  const query = new URLSearchParams();
  if (params.start !== undefined) {
    query.set("start", String(params.start));
  }
  if (params.end !== undefined) {
    query.set("end", String(params.end));
  }
  return query;
}

function encodeTeamMetricsMaxParams(params: TeamMetricsMaxParams): URLSearchParams {
  const query = encodeTeamMetricsParams(params);
  if (params.metric.trim()) {
    query.set("metric", params.metric.trim());
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

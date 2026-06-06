import type { ErrorDetail } from "../core/types.js";

export interface VolumeMount {
  name: string;
  path: string;
}

export interface NewSandboxRequest {
  templateID?: string;
  timeout?: number;
  autoPause?: boolean;
  autoResume?: boolean;
  allowInternetAccess?: boolean;
  metadata?: Record<string, string>;
  envVars?: Record<string, string>;
  waitReady?: boolean;
  network?: SandboxNetworkPolicy;
  volumeMounts?: VolumeMount[];
}

export interface SandboxNetworkPolicy {
  allowPublicTraffic?: boolean;
  allowInternetAccess?: boolean;
  allowOut?: string[];
  denyOut?: string[];
}

export interface ControlRequestOptions {
  requestTimeoutMs?: number;
}

export interface SandboxLifecycle {
  onTimeout: "kill" | "pause";
  autoResume?: boolean;
}

export interface SandboxLifecycleEvent {
  version: string;
  id: string;
  type: string;
  eventData?: Record<string, unknown> | null;
  sandboxBuildId?: string;
  sandboxExecutionId?: string;
  sandboxId: string;
  sandboxTeamId: string;
  sandboxTemplateId?: string;
  timestamp: string;
}

export interface ListSandboxEventsParams {
  offset?: number;
  limit?: number;
  orderAsc?: boolean;
  types?: string[];
}

export interface WebhookRetryPolicy {
  maxAttempts: number;
  delaySeconds?: number[];
  deadLetterEnabled?: boolean;
}

export interface LifecycleWebhook {
  id: string;
  teamId: string;
  name: string;
  createdAt: string;
  updatedAt?: string;
  enabled: boolean;
  url: string;
  events: string[];
  retryPolicy?: WebhookRetryPolicy;
  deadLetterUrl?: string;
}

export interface LifecycleWebhookCreateRequest {
  name: string;
  url: string;
  enabled?: boolean;
  events: string[];
  signatureSecret: string;
  retryPolicy?: WebhookRetryPolicy;
  deadLetterUrl?: string;
}

export interface LifecycleWebhookUpdateRequest {
  name?: string;
  url?: string;
  enabled?: boolean;
  events?: string[];
  signatureSecret?: string;
  retryPolicy?: WebhookRetryPolicy;
  deadLetterUrl?: string;
}

export interface DeleteWebhookResponse {
  deleted: boolean;
}

export interface LifecycleWebhookDelivery {
  id: string;
  eventId: string;
  webhookId: string;
  namespaceId: string;
  teamId: string;
  url: string;
  status: string;
  httpStatus?: number;
  attempts: number;
  maxAttempts?: number;
  error?: string;
  deadLetterUrl?: string;
  deadLetterError?: string;
  createdAt: string;
  lastAttemptAt?: string;
  nextAttemptAt?: string;
  deliveredAt?: string;
}

export interface ListWebhookDeliveriesParams {
  offset?: number;
  limit?: number;
  orderAsc?: boolean;
  webhookID?: string;
  eventID?: string;
  status?: string;
}

export interface Volume {
  volumeID: string;
  name: string;
}

export interface VolumeAndToken {
  volumeID: string;
  name: string;
  token: string;
}

export interface NewVolumeRequest {
  name: string;
}

export interface Team {
  teamID: string;
  name: string;
  apiKey: string;
  isDefault: boolean;
}

export interface TeamMetric {
  timestamp: string;
  timestampUnix: number;
  concurrentSandboxes: number;
  sandboxStartRate: number;
}

export interface MaxTeamMetric {
  timestamp: string;
  timestampUnix: number;
  value: number;
}

export interface TeamMetricsParams {
  start?: number;
  end?: number;
}

export interface TeamMetricsMaxParams extends TeamMetricsParams {
  metric: string;
}

export interface SandboxTimelineEvent {
  phase: string;
  status: "completed" | "in_progress" | "failed" | string;
  timestamp: string;
  message?: string;
}

export interface SandboxDiagnostic {
  reason: string;
  message: string;
  recommendation?: string;
}

export interface Sandbox {
  templateID: string;
  sandboxID: string;
  alias?: string;
  clientID: string;
  envdAccessToken: string | null;
  envdUrl: string | null;
  status: string;
  state?: string;
  startedAt: string;
  activatedAt?: string | null;
  endAt: string;
  timeline?: SandboxTimelineEvent[];
  diagnostic?: SandboxDiagnostic;
  network?: SandboxNetworkPolicy;
}

export interface SandboxDetail {
  templateID: string;
  alias?: string;
  sandboxID: string;
  clientID: string;
  startedAt: string;
  endAt: string;
  envdAccessToken: string | null;
  envdUrl: string | null;
  cpuCount: number;
  memoryMB: number;
  diskSizeMB: number;
  metadata?: Record<string, string>;
  status: string;
  state?: string;
  lifecycle: SandboxLifecycle;
  volumeMounts?: VolumeMount[];
  activatedAt?: string | null;
  timeline?: SandboxTimelineEvent[];
  diagnostic?: SandboxDiagnostic;
  network?: SandboxNetworkPolicy;
}

export interface ListedSandbox {
  templateID: string;
  alias?: string;
  sandboxID: string;
  clientID: string;
  startedAt: string;
  endAt: string;
  cpuCount: number;
  memoryMB: number;
  diskSizeMB: number;
  metadata?: Record<string, string>;
  status: string;
  state?: string;
  volumeMounts?: VolumeMount[];
  activatedAt?: string | null;
  timeline?: SandboxTimelineEvent[];
  diagnostic?: SandboxDiagnostic;
  network?: SandboxNetworkPolicy;
}

export interface ListSandboxesParams {
  metadata?: Record<string, string>;
  state?: string[];
  limit?: number;
  nextToken?: string;
}

export interface SandboxesPage {
  items: ListedSandbox[];
  nextToken: string;
  hasNext: boolean;
}

export interface SandboxMetricSnapshot {
  sandboxID: string;
  collectedAt: string;
  error?: string;
  load1?: number | null;
  load5?: number | null;
  load15?: number | null;
  cpuUserRate?: number | null;
  cpuSystemRate?: number | null;
  cpuIOWaitRate?: number | null;
  cpuStealRate?: number | null;
  memoryAvailableBytes?: number | null;
  memoryUsagePercent?: number | null;
  swapTotalBytes?: number | null;
  swapFreeBytes?: number | null;
  swapCachedBytes?: number | null;
  diskReadOpsPerSecond?: number | null;
  diskWriteOpsPerSecond?: number | null;
  diskReadBytesPerSecond?: number | null;
  diskWriteBytesPerSecond?: number | null;
  networkRecvBytesPerSecond?: number | null;
  networkSentBytesPerSecond?: number | null;
  networkRecvPacketsPerSecond?: number | null;
  networkSentPacketsPerSecond?: number | null;
  networkRecvErrorsPerSecond?: number | null;
  networkSentErrorsPerSecond?: number | null;
  networkRecvDropsPerSecond?: number | null;
  networkSentDropsPerSecond?: number | null;
  taskCurrent?: number | null;
  taskMax?: number | null;
}

export interface SandboxMetricsParams {
  sandboxIDs?: string[];
  limit?: number;
}

export interface SandboxMetricsResponse {
  collectedAt: string;
  items: SandboxMetricSnapshot[];
  sandboxes: Record<string, SandboxMetricSnapshot>;
}

export interface UsageLimitValue {
  limit: number;
  used: number;
  remaining: number;
  resetAt?: string;
  enforced: boolean;
}

export interface UsageLimitScope {
  id?: string;
  usage?: Record<string, number>;
  limits?: Record<string, UsageLimitValue>;
}

export interface SandboxUsageLimits {
  resource: "sandboxes" | string;
  unlimited?: boolean;
  user?: UsageLimitScope;
  project?: UsageLimitScope;
  runtime?: {
    maxRuntimeSeconds?: number;
  };
}

export interface TemplateUsageLimits {
  resource: "templates" | string;
  unlimited?: boolean;
  user?: UsageLimitScope;
  project?: UsageLimitScope;
  resources?: {
    maxTemplateCPU?: number;
    maxTemplateMemoryMB?: number;
    maxTemplateStorageGB?: number;
  };
}

export interface ObservabilitySignal {
  status: "available" | "unavailable" | string;
  message?: string;
}

export interface ObservabilityCheck {
  status: "warning" | "exhausted" | string;
  scope: "user" | "project" | string;
  resource: string;
  metric: string;
  used: number;
  limit: number;
  remaining: number;
  message: string;
  usageEndpoint: string;
}

export interface ObservabilityAction {
  status: "unavailable" | "review" | "limit_reached" | string;
  scope?: "user" | "project" | string;
  resource?: string;
  message: string;
  endpoint?: string;
}

export interface ObservabilitySummary {
  status: "ok" | "degraded" | string;
  projectID?: string;
  userID?: string;
  usage?: {
    sandboxes?: SandboxUsageLimits;
    templates?: TemplateUsageLimits;
  };
  availability: Record<string, ObservabilitySignal>;
  checks: ObservabilityCheck[];
  actions: ObservabilityAction[];
  endpoints: {
    sandboxUsage: string;
    templateUsage: string;
    sandboxDetail?: string;
    sandboxMetrics?: string;
    sandboxLogs: string;
    buildStatus?: string;
    buildLogs: string;
  };
}

export interface SandboxLogsParams {
  cursor?: number;
  limit?: number;
  direction?: string;
  level?: string;
  search?: string;
}

export interface SandboxLogEntry {
  timestamp: string;
  message: string;
  level: string;
  fields: Record<string, string>;
}

export interface LogDiagnostic {
  reason: "filters_applied" | "cursor_window_empty" | "no_logs_yet" | string;
  message: string;
}

export interface SandboxLogsResponse {
  logs: SandboxLogEntry[];
  nextCursor?: number;
  hasMore?: boolean;
  query?: {
    sandboxID?: string;
    direction?: string;
    limit?: number;
    level?: string;
    search?: string;
  };
  diagnostic?: LogDiagnostic;
}

export interface ConnectSandboxRequest {
  timeout: number;
}

export interface ConnectSandboxResponse {
  statusCode: number;
  sandbox: Sandbox;
}

export interface TimeoutRequest {
  timeout: number;
}

export interface RefreshSandboxRequest {
  duration?: number;
}

export interface HeartbeatRequest {
  status: string;
}

export interface HeartbeatResponse {
  received: boolean;
  status: string;
  requestId?: string;
}

export interface PoolStatus {
  total: number;
  warm: number;
  active: number;
  creating: number;
  stopped: number;
  deleting: number;
  deleted: number;
  utilization: number;
  requestId?: string;
}

export interface RollingStartRequest {
  templateId: string;
}

export interface RollingUpdateStatus {
  phase: string;
  progress: number;
  warm_total: number;
  warm_updated: number;
  started_at?: string | null;
  completed_at?: string | null;
  duration?: string;
  requestId?: string;
}

export interface WrappedResponse<T> {
  code: number;
  message: string;
  data: T;
  error?: ErrorDetail;
  request_id?: string;
}

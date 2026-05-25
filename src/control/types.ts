import type { ErrorDetail } from "../core/types.js";

export interface VolumeMount {
  name: string;
  path: string;
}

export interface NewSandboxRequest {
  templateID: string;
  timeout?: number;
  autoPause?: boolean;
  metadata?: Record<string, string>;
  envVars?: Record<string, string>;
  waitReady?: boolean;
}

export interface ControlRequestOptions {
  requestTimeoutMs?: number;
}

export interface SandboxLifecycle {
  onTimeout: "kill" | "pause";
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
}

export interface ListSandboxesParams {
  metadata?: Record<string, string>;
  state?: string[];
  limit?: number;
  nextToken?: string;
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

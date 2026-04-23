import type { ErrorDetail } from "../core/types.js";

export interface VolumeMount {
  name: string;
  path: string;
}

export interface NewSandboxRequest {
  templateID: string;
  workspaceId?: string;
  timeout?: number;
  metadata?: Record<string, string>;
  envVars?: Record<string, string>;
  volumeMounts?: VolumeMount[];
  waitReady?: boolean;
}

export interface Sandbox {
  templateID: string;
  sandboxID: string;
  alias?: string;
  clientID: string;
  envdVersion: string;
  envdAccessToken: string | null;
  envdUrl: string | null;
  trafficAccessToken: string | null;
  namespace?: string;
  status: string;
  state?: string;
  startedAt: string;
  endAt: string;
}

export interface SandboxDetail {
  templateID: string;
  alias?: string;
  sandboxID: string;
  clientID: string;
  startedAt: string;
  endAt: string;
  envdVersion: string;
  envdAccessToken: string | null;
  envdUrl: string | null;
  cpuCount: number;
  memoryMB: number;
  diskSizeMB: number;
  metadata?: Record<string, string>;
  status: string;
  state?: string;
  volumeMounts?: VolumeMount[];
  namespace?: string;
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
  envdVersion: string;
  volumeMounts?: VolumeMount[];
}

export interface ListSandboxesParams {
  metadata?: Record<string, string>;
  state?: string[];
  limit?: number;
  nextToken?: string;
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

export interface SandboxLogsResponse {
  logs: SandboxLogEntry[];
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

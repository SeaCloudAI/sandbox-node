import { APIError, ConfigurationError, RequestTimeoutError } from "./errors.js";
import type { ShutdownResponse } from "./types.js";
import { SDK_VERSION } from "../version.js";
import { resolveGatewayApiKey, resolveGatewayBaseUrl, resolveGatewayNamespaceId, resolveGatewayProjectId, resolveGatewayUserId } from "../config.js";

export type SDKDiagnosticEventType = "request" | "response" | "error";

export interface SDKDiagnosticEvent {
  type: SDKDiagnosticEventType;
  method: string;
  path: string;
  requestId: string;
  status?: number;
  durationMs?: number;
  error?: string;
  errorKind?: string;
  retryable?: boolean;
}

export type SDKLogger = (event: SDKDiagnosticEvent) => void;

export interface ClientOptions {
  baseUrl?: string;
  apiKey?: string;
  namespaceId?: string;
  userId?: string;
  projectId?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  debug?: boolean;
  logger?: SDKLogger;
}

export class BaseTransport {
  readonly baseUrl: string;
  readonly defaultHeaders: Readonly<Record<string, string>>;
  protected readonly timeoutMs: number | undefined;

  protected readonly fetchImpl: typeof fetch;
  protected readonly debug: boolean;
  protected readonly logger: SDKLogger | undefined;

  constructor(options: ClientOptions) {
    const baseUrl = resolveGatewayBaseUrl(options.baseUrl).trim().replace(/\/+$/, "");
    const apiKey = resolveGatewayApiKey(options.apiKey).trim();
    const namespaceId = (resolveGatewayNamespaceId(options.namespaceId) ?? "").trim() || undefined;
    const userId = (resolveGatewayUserId(options.userId) ?? "").trim() || undefined;
    const projectId = (resolveGatewayProjectId(options.projectId) ?? "").trim() || undefined;

    if (!baseUrl) {
      throw new ConfigurationError("baseUrl is required");
    }
    if (!apiKey) {
      throw new ConfigurationError("apiKey is required");
    }

    this.baseUrl = baseUrl;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.timeoutMs = normalizeTimeoutMs(options.timeoutMs);
    this.debug = options.debug ?? false;
    this.logger = options.logger;
    this.defaultHeaders = Object.freeze({
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
      "User-Agent": `seacloudai-sandbox-node/${SDK_VERSION}`,
      "X-API-Key": apiKey,
      ...(namespaceId ? { "X-Namespace-ID": namespaceId } : {}),
      ...(userId ? { "X-User-ID": userId } : {}),
      ...(projectId ? { "X-Project-ID": projectId } : {}),
    });
  }

  async metrics(): Promise<string> {
    const response = await this.request("/metrics", { method: "GET" });
    if (!response.ok) {
      throw await APIError.fromResponse(response);
    }
    return response.text();
  }

  async shutdown(): Promise<ShutdownResponse> {
    return this.requestJson<ShutdownResponse>("/shutdown", { method: "POST" });
  }

  protected buildUrl(path: string): string {
    const suffix = path.trim().replace(/^\/+/, "");
    return new URL(suffix, `${this.baseUrl}/`).toString();
  }

  protected apiPath(path: string): string {
    const suffix = path.trim();
    return suffix.startsWith("/") ? suffix : `/${suffix}`;
  }

  protected buildHeaders(headers: HeadersInit = {}): Headers {
    const merged = new Headers(this.defaultHeaders);
    new Headers(headers).forEach((value, key) => {
      merged.set(key, value);
    });
    return merged;
  }

  protected async request(path: string, init: RequestInit = {}, requestTimeoutMs?: number): Promise<Response> {
    const requestState = createRequestState(init.signal, normalizeTimeoutMs(requestTimeoutMs) ?? this.timeoutMs);
    const url = this.buildUrl(path);
    const headers = this.buildHeaders(init.headers);
    const requestId = ensureRequestID(headers);
    const method = (init.method ?? "GET").toUpperCase();
    const safePath = sanitizeDiagnosticPath(url);
    const started = Date.now();
    this.emitDiagnostic({ type: "request", method, path: safePath, requestId });

    try {
      const response = await this.fetchImpl(url, {
        ...init,
        headers,
        signal: requestState.signal,
      });
      this.emitDiagnostic({
        type: "response",
        method,
        path: safePath,
        requestId,
        status: response.status,
        durationMs: Date.now() - started,
      });
      return response;
    } catch (error) {
      const durationMs = Date.now() - started;
      if (requestState.didTimeout()) {
        const timeoutError = new RequestTimeoutError(requestState.timeoutMs, { cause: error });
        this.emitDiagnostic({
          type: "error",
          method,
          path: safePath,
          requestId,
          durationMs,
          error: timeoutError.message,
          errorKind: "timeout",
          retryable: true,
        });
        throw timeoutError;
      }
      this.emitDiagnostic({
        type: "error",
        method,
        path: safePath,
        requestId,
        durationMs,
        error: sanitizeDiagnosticError(error instanceof Error ? error.message : String(error)),
      });
      throw error;
    } finally {
      requestState.cleanup();
    }
  }

  protected async requestJson<T>(
    path: string,
    init: RequestInit = {},
    expectedStatuses: number[] = [200],
    requestTimeoutMs?: number,
  ): Promise<T> {
    const response = await this.request(path, init, requestTimeoutMs);
    if (!expectedStatuses.includes(response.status)) {
      const error = await APIError.fromResponse(response);
      this.emitAPIError(path, init.method, error);
      throw error;
    }
    return (await response.json()) as T;
  }

  protected async requestEmpty(
    path: string,
    init: RequestInit,
    expectedStatuses: number[],
    requestTimeoutMs?: number,
  ): Promise<void> {
    const response = await this.request(path, init, requestTimeoutMs);
    if (!expectedStatuses.includes(response.status)) {
      const error = await APIError.fromResponse(response);
      this.emitAPIError(path, init.method, error);
      throw error;
    }
  }

  protected getFetchImpl(): typeof fetch {
    return this.fetchImpl;
  }

  protected emitDiagnostic(event: SDKDiagnosticEvent): void {
    if (this.logger) {
      try {
        this.logger(event);
      } catch {
        // Diagnostics must never change request behavior.
      }
      return;
    }
    if (this.debug) {
      const parts = [
        `type=${event.type}`,
        `method=${event.method}`,
        `path=${event.path}`,
        `request_id=${event.requestId}`,
        event.status === undefined ? "" : `status=${event.status}`,
        event.durationMs === undefined ? "" : `duration_ms=${event.durationMs}`,
        event.errorKind ? `error_kind=${event.errorKind}` : "",
        event.retryable === undefined ? "" : `retryable=${event.retryable}`,
        event.error ? `error=${event.error}` : "",
      ].filter(Boolean);
      console.debug(`[seacloudai-sandbox] ${parts.join(" ")}`);
    }
  }

  private emitAPIError(path: string, method: string | undefined, error: APIError): void {
    this.emitDiagnostic({
      type: "error",
      method: (method ?? "GET").toUpperCase(),
      path: sanitizeDiagnosticPath(this.buildUrl(path)),
      requestId: error.requestId ?? "",
      status: error.statusCode,
      error: sanitizeDiagnosticError(error.message),
      errorKind: error.kind,
      retryable: error.retryable,
    });
  }
}

function normalizeTimeoutMs(timeoutMs: number | undefined): number | undefined {
  if (timeoutMs === undefined) {
    return undefined;
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new ConfigurationError("timeoutMs must be a positive number");
  }
  return Math.floor(timeoutMs);
}

function ensureRequestID(headers: Headers): string {
  const existing = headers.get("X-Request-ID")?.trim();
  if (existing) {
    return existing;
  }
  const generated = generateRequestID();
  headers.set("X-Request-ID", generated);
  return generated;
}

function generateRequestID(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `sdk-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function sanitizeDiagnosticPath(value: string): string {
  const url = new URL(value);
  for (const key of [...url.searchParams.keys()]) {
    if (isSensitiveQueryKey(key)) {
      url.searchParams.set(key, "<redacted>");
    }
  }
  return `${url.pathname}${url.search}`;
}

function sanitizeDiagnosticError(value: string): string {
  return value.replace(/https?:\/\/[^\s"'<>]+/g, (match) => {
    try {
      return sanitizeDiagnosticPath(match);
    } catch {
      return "<redacted-url>";
    }
  });
}

function isSensitiveQueryKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return normalized.includes("token") || normalized.includes("signature") || normalized === "api_key";
}

function createRequestState(signal: AbortSignal | null | undefined, timeoutMs: number | undefined) {
  if (timeoutMs === undefined) {
    return {
      signal,
      timeoutMs: 0,
      didTimeout: () => false,
      cleanup: () => undefined,
    };
  }

  const controller = new AbortController();
  let timedOut = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const abortFromSignal = () => controller.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) {
      abortFromSignal();
    } else {
      signal.addEventListener("abort", abortFromSignal, { once: true });
    }
  }

  timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error(`request timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  return {
    signal: controller.signal,
    timeoutMs,
    didTimeout: () => timedOut,
    cleanup: () => {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
      if (signal) {
        signal.removeEventListener("abort", abortFromSignal);
      }
    },
  };
}

import type { ErrorDetail } from "./types.js";

interface RawErrorResponse {
  code?: number;
  message?: string;
  request_id?: string;
  error?: ErrorDetail;
}

export class SandboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxError";
  }
}

export class TransportError extends SandboxError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "TransportError";
    if (options?.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

export class RequestTimeoutError extends TransportError {
  readonly timeoutMs: number;

  constructor(timeoutMs: number, options?: { cause?: unknown }) {
    super(`request timed out after ${timeoutMs}ms`, options);
    this.name = "RequestTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

export class ConfigurationError extends SandboxError {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

export class ValidationError extends SandboxError {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class APIError extends SandboxError {
  readonly statusCode: number;
  readonly code?: number;
  readonly requestId?: string;
  readonly detail?: ErrorDetail;
  readonly body: string;
  readonly kind: APIErrorKind;

  constructor(options: {
    statusCode: number;
    message: string;
    code?: number;
    requestId?: string;
    detail?: ErrorDetail;
    body?: string;
    kind?: APIErrorKind;
  }) {
    super(detailMessage(options.detail) || options.message || `HTTP ${options.statusCode}`);
    this.name = "APIError";
    this.statusCode = options.statusCode;
    this.code = options.code;
    this.requestId = options.requestId;
    this.detail = options.detail;
    this.body = options.body ?? "";
    this.kind = options.kind ?? classifyAPIError(options.statusCode);
  }

  get retryable(): boolean {
    return this.kind === "rate_limit" || this.kind === "timeout" || this.kind === "server";
  }

  static async fromResponse(response: Response): Promise<APIError> {
    const body = await response.text();
    let parsed: RawErrorResponse | null = null;

    if (body) {
      try {
        parsed = JSON.parse(body) as RawErrorResponse;
      } catch {
        parsed = null;
      }
    }

    return createAPIError({
      statusCode: response.status,
      message: parsed?.message || response.statusText || `HTTP ${response.status}`,
      code: parsed?.code,
      requestId: parsed?.request_id,
      detail: parsed?.error,
      body,
    });
  }
}

export type APIErrorKind =
  | "authentication"
  | "permission"
  | "not_found"
  | "conflict"
  | "rate_limit"
  | "timeout"
  | "server"
  | "unknown";

export class AuthenticationError extends APIError {
  constructor(options: ConstructorParameters<typeof APIError>[0]) {
    super({ ...options, kind: "authentication" });
    this.name = "AuthenticationError";
  }
}

export class PermissionError extends APIError {
  constructor(options: ConstructorParameters<typeof APIError>[0]) {
    super({ ...options, kind: "permission" });
    this.name = "PermissionError";
  }
}

export class NotFoundError extends APIError {
  constructor(options: ConstructorParameters<typeof APIError>[0]) {
    super({ ...options, kind: "not_found" });
    this.name = "NotFoundError";
  }
}

export class ConflictError extends APIError {
  constructor(options: ConstructorParameters<typeof APIError>[0]) {
    super({ ...options, kind: "conflict" });
    this.name = "ConflictError";
  }
}

export class RateLimitError extends APIError {
  constructor(options: ConstructorParameters<typeof APIError>[0]) {
    super({ ...options, kind: "rate_limit" });
    this.name = "RateLimitError";
  }
}

export class TimeoutAPIError extends APIError {
  constructor(options: ConstructorParameters<typeof APIError>[0]) {
    super({ ...options, kind: "timeout" });
    this.name = "TimeoutAPIError";
  }
}

export class ServerError extends APIError {
  constructor(options: ConstructorParameters<typeof APIError>[0]) {
    super({ ...options, kind: "server" });
    this.name = "ServerError";
  }
}

function createAPIError(options: ConstructorParameters<typeof APIError>[0]): APIError {
  switch (classifyAPIError(options.statusCode)) {
    case "authentication":
      return new AuthenticationError(options);
    case "permission":
      return new PermissionError(options);
    case "not_found":
      return new NotFoundError(options);
    case "conflict":
      return new ConflictError(options);
    case "rate_limit":
      return new RateLimitError(options);
    case "timeout":
      return new TimeoutAPIError(options);
    case "server":
      return new ServerError(options);
    default:
      return new APIError(options);
  }
}

function classifyAPIError(statusCode: number): APIErrorKind {
  switch (statusCode) {
    case 401:
      return "authentication";
    case 403:
      return "permission";
    case 404:
      return "not_found";
    case 408:
      return "timeout";
    case 409:
      return "conflict";
    case 429:
      return "rate_limit";
    default:
      return statusCode >= 500 ? "server" : "unknown";
  }
}

function detailMessage(detail: ErrorDetail | undefined): string {
  // Runtime routes may return {"error": "not found"} instead of the standard error object.
  if (typeof detail === "string") {
    return detail;
  }
  return detail?.details || detail?.message || "";
}

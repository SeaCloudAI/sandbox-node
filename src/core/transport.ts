import { APIError, ConfigurationError, RequestTimeoutError } from "./errors.js";
import type { ShutdownResponse } from "./types.js";
import { SDK_VERSION } from "../version.js";

export interface ClientOptions {
  baseUrl: string;
  apiKey: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export class BaseTransport {
  readonly baseUrl: string;
  readonly defaultHeaders: Readonly<Record<string, string>>;
  protected readonly timeoutMs: number | undefined;

  private readonly fetchImpl: typeof fetch;

  constructor(options: ClientOptions) {
    const baseUrl = options.baseUrl.trim().replace(/\/+$/, "");
    const apiKey = options.apiKey.trim();

    if (!baseUrl) {
      throw new ConfigurationError("baseUrl is required");
    }
    if (!apiKey) {
      throw new ConfigurationError("apiKey is required");
    }

    this.baseUrl = baseUrl;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.timeoutMs = normalizeTimeoutMs(options.timeoutMs);
    this.defaultHeaders = Object.freeze({
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
      "User-Agent": `seacloudai-sandbox-node/${SDK_VERSION}`,
      "X-API-Key": apiKey,
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
    const normalizedPath = path.trim().startsWith("/")
      ? path.trim()
      : `/${path.trim() || ""}`;
    return new URL(normalizedPath || "/", `${this.baseUrl}/`).toString();
  }

  protected buildHeaders(headers: HeadersInit = {}): Headers {
    const merged = new Headers(this.defaultHeaders);
    new Headers(headers).forEach((value, key) => {
      merged.set(key, value);
    });
    return merged;
  }

  protected async request(path: string, init: RequestInit = {}): Promise<Response> {
    const requestState = createRequestState(init.signal, this.timeoutMs);

    try {
      return await this.fetchImpl(this.buildUrl(path), {
        ...init,
        headers: this.buildHeaders(init.headers),
        signal: requestState.signal,
      });
    } catch (error) {
      if (requestState.didTimeout()) {
        throw new RequestTimeoutError(requestState.timeoutMs, { cause: error });
      }
      throw error;
    } finally {
      requestState.cleanup();
    }
  }

  protected async requestJson<T>(
    path: string,
    init: RequestInit = {},
    expectedStatuses: number[] = [200],
  ): Promise<T> {
    const response = await this.request(path, init);
    if (!expectedStatuses.includes(response.status)) {
      throw await APIError.fromResponse(response);
    }
    return (await response.json()) as T;
  }

  protected async requestEmpty(
    path: string,
    init: RequestInit,
    expectedStatuses: number[],
  ): Promise<void> {
    const response = await this.request(path, init);
    if (!expectedStatuses.includes(response.status)) {
      throw await APIError.fromResponse(response);
    }
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

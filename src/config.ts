import type { ClientOptions } from "./core/transport.js";

const DEFAULT_BASE_URL = "https://sandbox-gateway.cloud.seaart.ai";
const processEnv = (
  globalThis as typeof globalThis & {
    process?: {
      env?: Record<string, string | undefined>;
    };
  }
).process?.env ?? {};

export interface GatewayOptions {
  baseUrl?: string;
  apiKey?: string;
  projectId?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export function resolveGatewayOptions(options: GatewayOptions = {}): ClientOptions {
  return {
    baseUrl: options.baseUrl ?? processEnv.SEACLOUD_BASE_URL ?? DEFAULT_BASE_URL,
    apiKey: options.apiKey ?? processEnv.SEACLOUD_API_KEY ?? "",
    projectId: options.projectId ?? processEnv.SEACLOUD_PROJECT_ID,
    fetch: options.fetch,
    timeoutMs: options.timeoutMs,
  };
}

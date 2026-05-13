import type { ClientOptions } from "./core/transport.js";

export const DEFAULT_BASE_URL = "https://sandbox-gateway.cloud.seaart.ai";
const processEnv = (
  globalThis as typeof globalThis & {
    process?: {
      env?: Record<string, string | undefined>;
    };
  }
).process?.env ?? {};

export interface GatewayOptions {
  domain?: string;
  apiKey?: string;
  projectId?: string;
  fetch?: typeof fetch;
  requestTimeoutMs?: number;
  baseUrl?: string;
}

export function resolveGatewayBaseUrl(baseUrl?: string, domain?: string): string {
  const explicit = baseUrl?.trim();
  if (explicit) {
    return explicit;
  }
  const explicitDomain = domain?.trim();
  if (explicitDomain) {
    return normalizeDomain(explicitDomain);
  }
  const envDomain = processEnv.SEACLOUD_BASE_URL?.trim();
  if (envDomain) {
    return normalizeDomain(envDomain);
  }
  return DEFAULT_BASE_URL;
}

export function resolveGatewayApiKey(apiKey?: string): string {
  return apiKey ?? processEnv.SEACLOUD_API_KEY ?? "";
}

export function resolveGatewayProjectId(projectId?: string): string | undefined {
  return projectId;
}

export function pickGatewayOptions(source: GatewayOptions): GatewayOptions {
  return {
    domain: source.domain,
    baseUrl: source.baseUrl,
    apiKey: source.apiKey,
    projectId: source.projectId,
    fetch: source.fetch,
    requestTimeoutMs: source.requestTimeoutMs,
  };
}

export function resolveGatewayOptions(options: GatewayOptions = {}): ClientOptions {
  return {
    baseUrl: resolveGatewayBaseUrl(options.baseUrl, options.domain),
    apiKey: resolveGatewayApiKey(options.apiKey),
    projectId: resolveGatewayProjectId(options.projectId),
    fetch: options.fetch,
    timeoutMs: options.requestTimeoutMs,
  };
}

function normalizeDomain(value: string): string {
  if (/^https?:\/\//i.test(value)) {
    return value;
  }
  return `https://${value}`;
}

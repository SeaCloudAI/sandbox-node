import type { ClientOptions } from "./core/transport.js";

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
  namespaceId?: string;
  userId?: string;
  projectId?: string;
  fetch?: typeof fetch;
  requestTimeoutMs?: number;
  baseUrl?: string;
  debug?: ClientOptions["debug"];
  logger?: ClientOptions["logger"];
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
  return "";
}

export function resolveGatewayApiKey(apiKey?: string): string {
  return apiKey ?? processEnv.SEACLOUD_API_KEY ?? "";
}

export function resolveGatewayProjectId(projectId?: string): string | undefined {
  return projectId;
}

export function resolveGatewayNamespaceId(namespaceId?: string): string | undefined {
  return namespaceId;
}

export function resolveGatewayUserId(userId?: string): string | undefined {
  return userId;
}

export function pickGatewayOptions(source: GatewayOptions): GatewayOptions {
  return {
    domain: source.domain,
    baseUrl: source.baseUrl,
    apiKey: source.apiKey,
    namespaceId: source.namespaceId,
    userId: source.userId,
    projectId: source.projectId,
    fetch: source.fetch,
    requestTimeoutMs: source.requestTimeoutMs,
    debug: source.debug,
    logger: source.logger,
  };
}

export function resolveGatewayOptions(options: GatewayOptions = {}): ClientOptions {
  return {
    baseUrl: resolveGatewayBaseUrl(options.baseUrl, options.domain),
    apiKey: resolveGatewayApiKey(options.apiKey),
    namespaceId: resolveGatewayNamespaceId(options.namespaceId),
    userId: resolveGatewayUserId(options.userId),
    projectId: resolveGatewayProjectId(options.projectId),
    fetch: options.fetch,
    timeoutMs: options.requestTimeoutMs,
    debug: options.debug,
    logger: options.logger,
  };
}

function normalizeDomain(value: string): string {
  if (/^https?:\/\//i.test(value)) {
    return value;
  }
  return `https://${value}`;
}

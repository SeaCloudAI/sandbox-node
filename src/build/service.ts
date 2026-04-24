import { APIError, ValidationError } from "../core/errors.js";
import { BaseTransport } from "../core/transport.js";
import type {
  BuildHistoryResponse,
  BuildLogsParams,
  BuildLogsResponse,
  BuildRequest,
  BuildResponse,
  BuildStatusParams,
  BuildStatusResponse,
  BuildTriggerResponse,
  DirectBuildRequest,
  DirectBuildResponse,
  FilePresenceResponse,
  GetTemplateParams,
  ListTemplatesParams,
  ListedTemplate,
  RollbackRequest,
  TemplateAliasResponse,
  TemplateCreateRequest,
  TemplateCreateResponse,
  TemplateResponse,
  TemplateUpdateRequest,
  TemplateUpdateResponse,
} from "./types.js";

const DNS_LABEL_RE = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
const SHA256_RE = /^[a-f0-9]{64}$/;
const TEMPLATE_REQUEST_FIELDS = new Set([
  "name",
  "visibility",
  "baseTemplateID",
  "dockerfile",
  "image",
  "envs",
  "cpuCount",
  "memoryMB",
  "diskSizeMB",
  "ttlSeconds",
  "port",
  "startCmd",
  "readyCmd",
]);

export class SandboxBuildService extends BaseTransport {
  async metrics(): Promise<string> {
    return super.metrics();
  }

  async directBuild(body: DirectBuildRequest): Promise<DirectBuildResponse> {
    if (!body) {
      throw new ValidationError("direct build request is required");
    }
    return this.requestJson<DirectBuildResponse>(
      "/build",
      {
        method: "POST",
        headers: this.buildHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(body),
      },
      [202],
    );
  }

  async createTemplate(body: TemplateCreateRequest = {}): Promise<TemplateCreateResponse> {
    this.validateTemplateBody(body);
    return this.requestJson<TemplateCreateResponse>(
      "/api/v1/templates",
      {
        method: "POST",
        headers: this.buildJSONHeaders(),
        body: JSON.stringify(body),
      },
      [202],
    );
  }

  async listTemplates(params: ListTemplatesParams = {}): Promise<ListedTemplate[]> {
    this.validateListTemplatesParams(params);
    const path = withQuery("/api/v1/templates", encodeListTemplatesParams(params));
    return this.requestJson<ListedTemplate[]>(path, {
      method: "GET",
    });
  }

  async getTemplateByAlias(alias: string): Promise<TemplateAliasResponse> {
    if (!alias.trim()) {
      throw new ValidationError("alias is required");
    }
    return this.requestJson<TemplateAliasResponse>(
      `/api/v1/templates/aliases/${encodeURIComponent(alias)}`,
      { method: "GET" },
    );
  }

  async getTemplate(
    templateID: string,
    params: GetTemplateParams = {},
  ): Promise<TemplateResponse> {
    this.requireTemplateID(templateID);
    this.validateGetTemplateParams(params);
    const path = withQuery(`/api/v1/templates/${encodeURIComponent(templateID)}`, encodeGetTemplateParams(params));
    return this.requestJson<TemplateResponse>(path, { method: "GET" });
  }

  async updateTemplate(
    templateID: string,
    body: TemplateUpdateRequest = {},
  ): Promise<TemplateUpdateResponse> {
    this.requireTemplateID(templateID);
    this.validateTemplateBody(body);
    return this.requestJson<TemplateUpdateResponse>(
      `/api/v1/templates/${encodeURIComponent(templateID)}`,
      {
        method: "PATCH",
        headers: this.buildJSONHeaders(),
        body: JSON.stringify(body),
      },
    );
  }

  async deleteTemplate(templateID: string): Promise<void> {
    this.requireTemplateID(templateID);
    await this.requestEmpty(
      `/api/v1/templates/${encodeURIComponent(templateID)}`,
      { method: "DELETE" },
      [204],
    );
  }

  async createBuild(
    templateID: string,
    body?: BuildRequest,
  ): Promise<BuildTriggerResponse> {
    this.requireTemplateID(templateID);
    this.validateBuildRequest(body);
    const payload = body && !isEmptyBuildRequest(body) ? JSON.stringify(body) : undefined;
    const response = await this.request(
      `/api/v1/templates/${encodeURIComponent(templateID)}/builds`,
      {
        method: "POST",
        headers: payload === undefined ? undefined : this.buildJSONHeaders(),
        body: payload,
      },
    );
    if (response.status !== 202) {
      throw await APIError.fromResponse(response);
    }
    const parsed = (await response.json()) as Partial<BuildResponse>;
    return {
      ...parsed,
      empty: Object.keys(parsed).length === 0,
    };
  }

  async getBuildFile(
    templateID: string,
    hash: string,
  ): Promise<FilePresenceResponse> {
    this.requireTemplateID(templateID);
    this.requireHash(hash);
    return this.requestJson<FilePresenceResponse>(
      `/api/v1/templates/${encodeURIComponent(templateID)}/files/${encodeURIComponent(hash)}`,
      { method: "GET" },
    );
  }

  async rollbackTemplate(
    templateID: string,
    body: RollbackRequest,
  ): Promise<TemplateResponse> {
    this.requireTemplateID(templateID);
    if (!body?.buildID?.trim()) {
      throw new ValidationError("buildID is required");
    }
    return this.requestJson<TemplateResponse>(
      `/api/v1/templates/${encodeURIComponent(templateID)}/rollback`,
      {
        method: "POST",
        headers: this.buildJSONHeaders(),
        body: JSON.stringify(body),
      },
    );
  }

  async listBuilds(templateID: string): Promise<BuildHistoryResponse> {
    this.requireTemplateID(templateID);
    return this.requestJson<BuildHistoryResponse>(
      `/api/v1/templates/${encodeURIComponent(templateID)}/builds`,
      { method: "GET" },
    );
  }

  async getBuild(templateID: string, buildID: string): Promise<BuildResponse> {
    this.requireTemplateID(templateID);
    this.requireBuildID(buildID);
    return this.requestJson<BuildResponse>(
      `/api/v1/templates/${encodeURIComponent(templateID)}/builds/${encodeURIComponent(buildID)}`,
      { method: "GET" },
    );
  }

  async getBuildStatus(
    templateID: string,
    buildID: string,
    params: BuildStatusParams = {},
  ): Promise<BuildStatusResponse> {
    this.requireTemplateID(templateID);
    this.requireBuildID(buildID);
    this.validateBuildStatusParams(params);
    const path = withQuery(
      `/api/v1/templates/${encodeURIComponent(templateID)}/builds/${encodeURIComponent(buildID)}/status`,
      encodeBuildStatusParams(params),
    );
    const parsed = await this.requestJson<Record<string, unknown>>(path, { method: "GET" });
    return normalizeBuildStatusResponse(parsed);
  }

  async getBuildLogs(
    templateID: string,
    buildID: string,
    params: BuildLogsParams = {},
  ): Promise<BuildLogsResponse> {
    this.requireTemplateID(templateID);
    this.requireBuildID(buildID);
    this.validateBuildLogsParams(params);
    const path = withQuery(
      `/api/v1/templates/${encodeURIComponent(templateID)}/builds/${encodeURIComponent(buildID)}/logs`,
      encodeBuildLogsParams(params),
    );
    return this.requestJson<BuildLogsResponse>(path, { method: "GET" });
  }

  private buildJSONHeaders(): Headers {
    return this.buildHeaders({ "Content-Type": "application/json" });
  }

  private requireTemplateID(templateID: string): void {
    if (!templateID.trim()) {
      throw new ValidationError("templateID is required");
    }
  }

  private requireBuildID(buildID: string): void {
    if (!buildID.trim()) {
      throw new ValidationError("buildID is required");
    }
  }

  private requireHash(hash: string): void {
    if (!hash.trim()) {
      throw new ValidationError("hash is required");
    }
    if (!SHA256_RE.test(hash)) {
      throw new ValidationError("hash must be a 64-character lowercase hex SHA256");
    }
  }

  private validateListTemplatesParams(params: ListTemplatesParams): void {
    if (params.limit !== undefined && (!Number.isInteger(params.limit) || params.limit < 0 || params.limit > 100)) {
      throw new ValidationError("template list limit must be an integer between 0 and 100");
    }
    if (params.offset !== undefined && (!Number.isInteger(params.offset) || params.offset < 0)) {
      throw new ValidationError("template list offset must be a non-negative integer");
    }
  }

  private validateGetTemplateParams(params: GetTemplateParams): void {
    if (params.limit !== undefined && (!Number.isInteger(params.limit) || params.limit < 0 || params.limit > 100)) {
      throw new ValidationError("template build history limit must be an integer between 0 and 100");
    }
  }

  private validateTemplateBody(body: object): void {
    const payload = body as Record<string, unknown>;
    for (const key of Object.keys(payload)) {
      if (!TEMPLATE_REQUEST_FIELDS.has(key)) {
        throw new ValidationError(`template field ${key} is not supported by the public SDK`);
      }
    }
    if (typeof payload.visibility === "string" && payload.visibility.trim().toLowerCase() === "official") {
      throw new ValidationError("official templates are not supported by the public SDK");
    }
  }

  private validateBuildRequest(body: BuildRequest | undefined): void {
    if (!body) {
      return;
    }
    if (body.buildID !== undefined) {
      const buildID = body.buildID.trim();
      if (!buildID || buildID.length > 63 || !DNS_LABEL_RE.test(buildID)) {
        throw new ValidationError("buildID must be a lowercase DNS label up to 63 characters");
      }
    }
    if (body.filesHash !== undefined && !SHA256_RE.test(body.filesHash)) {
      throw new ValidationError("filesHash must be a 64-character lowercase hex SHA256");
    }
    if (body.fromImageRegistry?.trim()) {
      throw new ValidationError("fromImageRegistry is not supported yet");
    }
    if (body.force !== undefined) {
      throw new ValidationError("force rebuild is not supported yet");
    }

    const hashes = new Set<string>();
    if (body.filesHash) {
      hashes.add(body.filesHash);
    }

    for (const [index, step] of (body.steps ?? []).entries()) {
      const stepType = step.type?.trim() ?? "";
      if (!stepType) {
        throw new ValidationError(`steps[${index}].type is required`);
      }
      if (!["files", "context"].includes(stepType)) {
        throw new ValidationError(`steps[${index}].type must be files or context`);
      }
      if (!step.filesHash?.trim()) {
        throw new ValidationError(`steps[${index}].filesHash is required`);
      }
      if (!SHA256_RE.test(step.filesHash)) {
        throw new ValidationError(`steps[${index}].filesHash must be a 64-character lowercase hex SHA256`);
      }
      if (step.args?.length) {
        throw new ValidationError(`steps[${index}].args is not supported yet`);
      }
      if (step.force !== undefined) {
        throw new ValidationError(`steps[${index}].force is not supported yet`);
      }
      hashes.add(step.filesHash);
    }

    if (hashes.size > 1) {
      throw new ValidationError("multiple different filesHash values are not supported yet");
    }
  }

  private validateBuildStatusParams(params: BuildStatusParams): void {
    if (params.logsOffset !== undefined && (!Number.isInteger(params.logsOffset) || params.logsOffset < 0)) {
      throw new ValidationError("build logsOffset must be a non-negative integer");
    }
    if (params.limit !== undefined && (!Number.isInteger(params.limit) || params.limit < 0 || params.limit > 100)) {
      throw new ValidationError("build status limit must be an integer between 0 and 100");
    }
  }

  private validateBuildLogsParams(params: BuildLogsParams): void {
    if (params.cursor !== undefined && (!Number.isInteger(params.cursor) || params.cursor < 0)) {
      throw new ValidationError("build logs cursor must be a non-negative integer");
    }
    if (params.limit !== undefined && (!Number.isInteger(params.limit) || params.limit < 0 || params.limit > 100)) {
      throw new ValidationError("build logs limit must be an integer between 0 and 100");
    }
    if (params.direction !== undefined && !["forward", "backward"].includes(params.direction)) {
      throw new ValidationError('build logs direction must be "forward" or "backward"');
    }
    if (params.source !== undefined && !["temporary", "persistent"].includes(params.source)) {
      throw new ValidationError('build logs source must be "temporary" or "persistent"');
    }
  }
}

function withQuery(path: string, query: URLSearchParams): string {
  const suffix = query.toString();
  return suffix ? `${path}?${suffix}` : path;
}

function encodeListTemplatesParams(params: ListTemplatesParams): URLSearchParams {
  const query = new URLSearchParams();
  if (params.visibility?.trim()) {
    query.set("visibility", params.visibility.trim());
  }
  if (params.teamID?.trim()) {
    query.set("teamID", params.teamID.trim());
  }
  if (params.limit !== undefined) {
    query.set("limit", String(params.limit));
  }
  if (params.offset !== undefined) {
    query.set("offset", String(params.offset));
  }
  return query;
}

function encodeGetTemplateParams(params: GetTemplateParams): URLSearchParams {
  const query = new URLSearchParams();
  if (params.limit !== undefined) {
    query.set("limit", String(params.limit));
  }
  if (params.nextToken?.trim()) {
    query.set("nextToken", params.nextToken.trim());
  }
  return query;
}

function encodeBuildStatusParams(params: BuildStatusParams): URLSearchParams {
  const query = new URLSearchParams();
  if (params.logsOffset !== undefined) {
    query.set("logsOffset", String(params.logsOffset));
  }
  if (params.limit !== undefined) {
    query.set("limit", String(params.limit));
  }
  if (params.level?.trim()) {
    query.set("level", params.level.trim());
  }
  return query;
}

function encodeBuildLogsParams(params: BuildLogsParams): URLSearchParams {
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
  if (params.source?.trim()) {
    query.set("source", params.source.trim());
  }
  return query;
}

function isEmptyBuildRequest(body: BuildRequest): boolean {
  return !body.buildID?.trim()
    && !body.fromTemplate?.trim()
    && !body.fromImage?.trim()
    && !body.fromImageRegistry?.trim()
    && body.force === undefined
    && (body.steps?.length ?? 0) === 0
    && !body.filesHash?.trim()
    && !body.startCmd?.trim()
    && !body.readyCmd?.trim();
}

function normalizeBuildStatusResponse(raw: Record<string, unknown>): BuildStatusResponse {
  const rawLogs = Array.isArray(raw.logs) ? raw.logs : [];
  const rawLogEntries = Array.isArray(raw.logEntries) ? raw.logEntries : [];
  const logEntries = rawLogEntries.length > 0
    ? rawLogEntries
    : rawLogs.filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null);

  return {
    buildID: String(raw.buildID ?? ""),
    templateID: String(raw.templateID ?? ""),
    status: String(raw.status ?? ""),
    logs: rawLogs.filter((entry): entry is string => typeof entry === "string"),
    logEntries: logEntries.map((entry) => ({
      timestamp: String(entry.timestamp ?? ""),
      level: String(entry.level ?? ""),
      step: String(entry.step ?? ""),
      message: String(entry.message ?? ""),
    })),
    reason: raw.reason,
    createdAt: String(raw.createdAt ?? ""),
    updatedAt: String(raw.updatedAt ?? ""),
  };
}

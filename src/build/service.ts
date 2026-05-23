import { ValidationError } from "../core/errors.js";
import { BaseTransport } from "../core/transport.js";
import type {
  AssignedTemplateTags,
  AssignTemplateTagsRequest,
  BuildHistoryResponse,
  BuildLogsParams,
  BuildLogsResponse,
  BuildRequest,
  BuildResponse,
  BuildStatusParams,
  BuildStatusResponse,
  BuildTriggerResponse,
  DeleteTemplateTagsRequest,
  FilePresenceResponse,
  GetTemplateParams,
  ListTemplatesParams,
  ListedTemplate,
  RollbackRequest,
  TemplateAliasResponse,
  TemplateCreateRequest,
  TemplateCreateResponse,
  TemplateResponse,
  TemplateTag,
  TemplateUpdateRequest,
  TemplateUpdateResponse,
} from "./types.js";

const DNS_LABEL_RE = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
const SHA256_RE = /^[a-f0-9]{64}$/;
const TEMPLATE_CREATE_FIELDS = new Set([
  "name",
  "tags",
  "cpuCount",
  "memoryMB",
  "extensions",
]);

const TEMPLATE_UPDATE_FIELDS = new Set([
  "public",
]);
const BUILD_REQUEST_FIELDS = new Set([
  "fromTemplate",
  "fromImage",
  "fromImageRegistry",
  "force",
  "steps",
  "startCmd",
  "readyCmd",
]);

export class SandboxBuildService extends BaseTransport {
  getFetch(): typeof fetch {
    return this.getFetchImpl();
  }

  async metrics(): Promise<string> {
    return super.metrics();
  }

  async createTemplate(body: TemplateCreateRequest = {}): Promise<TemplateCreateResponse> {
    this.validateTemplateCreateBody(body);
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

  async resolveTemplateRef(ref: string): Promise<TemplateAliasResponse> {
    if (!ref.trim()) {
      throw new ValidationError("ref is required");
    }
    return this.requestJson<TemplateAliasResponse>(
      `/api/v1/templates/resolve/${encodeURIComponent(ref)}`,
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
    this.validateTemplateUpdateBody(body);
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
    buildID: string,
    body?: BuildRequest,
  ): Promise<BuildTriggerResponse> {
    this.requireTemplateID(templateID);
    this.requireBuildID(buildID);
    this.validateClientBuildID(buildID);
    this.validateBuildRequest(body);
    const payload = body && !isEmptyBuildRequest(body) ? JSON.stringify(body) : undefined;
    return this.requestJson<BuildTriggerResponse>(
      `/api/v1/templates/${encodeURIComponent(templateID)}/builds/${encodeURIComponent(buildID)}`,
      {
        method: "POST",
        headers: payload === undefined ? undefined : this.buildJSONHeaders(),
        body: payload,
      },
      [202],
    );
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
    return this.requestJson<BuildStatusResponse>(path, { method: "GET" });
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

  async assignTemplateTags(body: AssignTemplateTagsRequest): Promise<AssignedTemplateTags> {
    this.validateAssignTemplateTagsBody(body);
    return this.requestJson<AssignedTemplateTags>(
      "/api/v1/templates/tags",
      {
        method: "POST",
        headers: this.buildJSONHeaders(),
        body: JSON.stringify(body),
      },
      [201],
    );
  }

  async deleteTemplateTags(body: DeleteTemplateTagsRequest): Promise<void> {
    this.validateDeleteTemplateTagsBody(body);
    await this.requestEmpty(
      "/api/v1/templates/tags",
      {
        method: "DELETE",
        headers: this.buildJSONHeaders(),
        body: JSON.stringify(body),
      },
      [204],
    );
  }

  async listTemplateTags(templateID: string): Promise<TemplateTag[]> {
    this.requireTemplateID(templateID);
    return this.requestJson<TemplateTag[]>(
      `/api/v1/templates/${encodeURIComponent(templateID)}/tags`,
      { method: "GET" },
    );
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

  private validateClientBuildID(buildID: string): void {
    const trimmed = buildID.trim();
    if (trimmed.length > 63 || !DNS_LABEL_RE.test(trimmed)) {
      throw new ValidationError("buildID must be a lowercase DNS label up to 63 characters");
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

  private validateTemplateCreateBody(body: object): void {
    const payload = body as Record<string, unknown>;
    for (const key of Object.keys(payload)) {
      if (!TEMPLATE_CREATE_FIELDS.has(key)) {
        throw new ValidationError(`template field ${key} is not supported by the public SDK`);
      }
    }
    if (payload.extensions !== undefined) {
      validateTemplateExtensions(payload.extensions);
    }
  }

  private validateTemplateUpdateBody(body: object): void {
    const payload = body as Record<string, unknown>;
    for (const key of Object.keys(payload)) {
      if (!TEMPLATE_UPDATE_FIELDS.has(key)) {
        throw new ValidationError(`template field ${key} is not supported by the public SDK`);
      }
    }
    if (payload.public !== undefined && typeof payload.public !== "boolean") {
      throw new ValidationError("public must be a boolean");
    }
  }

  private validateAssignTemplateTagsBody(body: AssignTemplateTagsRequest): void {
    if (!body?.target?.trim()) {
      throw new ValidationError("target is required");
    }
    this.validateTags(body.tags);
  }

  private validateDeleteTemplateTagsBody(body: DeleteTemplateTagsRequest): void {
    if (!body?.name?.trim()) {
      throw new ValidationError("name is required");
    }
    this.validateTags(body.tags);
  }

  private validateTags(tags: string[]): void {
    if (!Array.isArray(tags) || tags.map((tag) => tag.trim()).filter(Boolean).length === 0) {
      throw new ValidationError("tags are required");
    }
  }

  private validateBuildRequest(body: BuildRequest | undefined): void {
    if (!body) {
      return;
    }
    for (const key of Object.keys(body as Record<string, unknown>)) {
      if (!BUILD_REQUEST_FIELDS.has(key)) {
        throw new ValidationError(`build field ${key} is not supported by the public SDK`);
      }
    }
    if (Object.prototype.hasOwnProperty.call(body, "buildID")) {
      throw new ValidationError("buildID must be provided in the createBuild path, not in body");
    }
    if (body.force !== undefined && typeof body.force !== "boolean") {
      throw new ValidationError("force must be a boolean");
    }
    if (body.fromImageRegistry !== undefined) {
      validateRegistryConfig(body.fromImageRegistry);
    }

    for (const [index, step] of (body.steps ?? []).entries()) {
      const stepType = step.type?.trim().toUpperCase() ?? "";
      if (!stepType) {
        throw new ValidationError(`steps[${index}].type is required`);
      }
      switch (stepType) {
        case "COPY":
          if (!step.filesHash?.trim()) {
            throw new ValidationError(`steps[${index}].filesHash is required for COPY`);
          }
          if (!SHA256_RE.test(step.filesHash)) {
            throw new ValidationError(`steps[${index}].filesHash must be a 64-character lowercase hex SHA256`);
          }
          if ((step.args?.length ?? 0) < 2) {
            throw new ValidationError(`steps[${index}].args must include src and dest for COPY`);
          }
          break;
        case "ENV":
          if ((step.args?.length ?? 0) === 0 || (step.args?.length ?? 0) % 2 !== 0) {
            throw new ValidationError(`steps[${index}].args must contain ENV key/value pairs`);
          }
          break;
        case "RUN":
        case "WORKDIR":
        case "USER":
          if (!step.args?.[0]?.trim()) {
            throw new ValidationError(`steps[${index}].args must include the ${stepType} value`);
          }
          break;
        default:
          throw new ValidationError(`steps[${index}].type must be one of COPY, ENV, RUN, WORKDIR, USER`);
      }
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
  }
}

function validateRegistryConfig(config: unknown): void {
  if (typeof config !== "object" || config === null) {
    throw new ValidationError("fromImageRegistry must be an object");
  }
  const payload = config as Record<string, unknown>;
  const type = typeof payload.type === "string" ? payload.type.trim() : "";
  if (!type) {
    throw new ValidationError("fromImageRegistry.type is required");
  }
  switch (type) {
    case "registry":
      if (!String(payload.username ?? "").trim() || !String(payload.password ?? "").trim()) {
        throw new ValidationError("fromImageRegistry registry config requires username and password");
      }
      return;
    case "aws":
      if (!String(payload.awsAccessKeyId ?? "").trim() || !String(payload.awsSecretAccessKey ?? "").trim() || !String(payload.awsRegion ?? "").trim()) {
        throw new ValidationError("fromImageRegistry aws config requires awsAccessKeyId, awsSecretAccessKey, and awsRegion");
      }
      return;
    case "gcp":
      if (!String(payload.serviceAccountJson ?? "").trim()) {
        throw new ValidationError("fromImageRegistry gcp config requires serviceAccountJson");
      }
      return;
    default:
      throw new ValidationError(`fromImageRegistry.type ${JSON.stringify(type)} is not supported`);
  }
}

function validateTemplateExtensions(extensions: unknown): void {
  if (typeof extensions !== "object" || extensions === null) {
    throw new ValidationError("extensions must be an object");
  }
  const payload = extensions as Record<string, unknown>;
  const allowed = new Set(["baseTemplateID", "visibility", "envs", "volumeMounts", "workdir"]);
  for (const key of Object.keys(payload)) {
    if (!allowed.has(key)) {
      throw new ValidationError(`template extension field ${key} is not supported by the public SDK`);
    }
  }
  if (String(payload.visibility ?? "").trim() === "official") {
    throw new ValidationError("extensions.visibility=official is not supported by the public SDK");
  }
  if (payload.workdir !== undefined && !String(payload.workdir).trim().startsWith("/")) {
    throw new ValidationError("extensions.workdir must be an absolute path");
  }
  if (payload.volumeMounts !== undefined) {
    if (!Array.isArray(payload.volumeMounts)) {
      throw new ValidationError("extensions.volumeMounts must be an array");
    }
    for (const [index, item] of payload.volumeMounts.entries()) {
      if (typeof item !== "object" || item === null) {
        throw new ValidationError(`extensions.volumeMounts[${index}] must be an object`);
      }
      const mount = item as Record<string, unknown>;
      if (!String(mount.name ?? "").trim() || !String(mount.path ?? "").trim()) {
        throw new ValidationError(`extensions.volumeMounts[${index}] requires name and path`);
      }
      if (!String(mount.path ?? "").trim().startsWith("/")) {
        throw new ValidationError(`extensions.volumeMounts[${index}].path must be an absolute path`);
      }
      if (!String(mount.storageType ?? "").trim()) {
        throw new ValidationError(`extensions.volumeMounts[${index}].storageType is required`);
      }
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
  return query;
}

function isEmptyBuildRequest(body: BuildRequest): boolean {
  return !body.fromTemplate?.trim()
    && !body.fromImage?.trim()
    && body.fromImageRegistry === undefined
    && body.force === undefined
    && (body.steps?.length ?? 0) === 0
    && !body.startCmd?.trim()
    && !body.readyCmd?.trim();
}

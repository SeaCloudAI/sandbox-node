export interface DirectBuildRequest {
  project: string;
  image: string;
  tag: string;
  dockerfile: string;
}

export interface DirectBuildResponse {
  templateID: string;
  buildID: string;
  imageFullName: string;
}

export interface TemplateCreateRequest {
  name?: string;
  alias?: string;
  visibility?: string;
  public?: boolean;
  type?: string;
  version?: string;
  dockerfile?: string;
  image?: string;
  tags?: string[];
  envs?: Record<string, string>;
  cpuCount?: number;
  memoryMB?: number;
  diskSizeMB?: number;
  envdVersion?: string;
  storageType?: string;
  ttlSeconds?: number;
  port?: number;
  startCmd?: string;
  readyCmd?: string;
}

export interface TemplateCreateResponse {
  templateID: string;
  buildID: string;
  public: boolean;
  names: string[];
  tags: string[];
  aliases: string[];
}

export interface TemplateUpdateResponse {
  names: string[];
}

export interface ListTemplatesParams {
  visibility?: string;
  teamID?: string;
  limit?: number;
  offset?: number;
}

export interface GetTemplateParams {
  limit?: number;
  nextToken?: string;
}

export interface TemplateAliasResponse {
  templateID: string;
  public: boolean;
}

export interface TemplateUser {
  id: string;
  email?: string;
}

export interface ListedTemplate {
  templateID: string;
  buildID: string;
  buildStatus: string;
  public: boolean;
  names: string[];
  aliases: string[];
  createdBy?: TemplateUser | null;
}

export interface BuildResponse {
  buildID: string;
  templateID: string;
  status: string;
  image: string;
  errorMessage: string;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string | null;
}

export interface TemplateResponse {
  templateID: string;
  buildID: string;
  buildStatus: string;
  public: boolean;
  names: string[];
  aliases: string[];
  tags: string[];
  name: string;
  visibility: string;
  image: string;
  imageSource: string;
  envdVersion: string;
  cpuCount: number;
  memoryMB: number;
  diskSizeMB: number;
  createdBy?: TemplateUser | null;
  createdByID: string;
  projectID: string;
  createdAt: string;
  updatedAt: string;
  lastSpawnedAt?: string | null;
  spawnCount: number;
  buildCount: number;
  storageType: string;
  ttlSeconds: number;
  port: number;
  startCmd: string;
  readyCmd: string;
  builds?: BuildResponse[];
  nextToken?: string;
}

export interface BuildStep {
  type?: string;
  filesHash?: string;
  args?: string[];
  force?: boolean;
}

export interface BuildRequest {
  buildID?: string;
  fromTemplate?: string;
  fromImage?: string;
  fromImageRegistry?: string;
  force?: boolean;
  steps?: BuildStep[];
  filesHash?: string;
  startCmd?: string;
  readyCmd?: string;
}

export interface BuildTriggerResponse extends Partial<BuildResponse> {
  empty: boolean;
}

export interface FilePresenceResponse {
  present: boolean;
  url?: string;
}

export interface RollbackRequest {
  buildID: string;
}

export interface BuildHistoryResponse {
  builds: BuildResponse[];
  total: number;
}

export interface BuildStatusParams {
  logsOffset?: number;
  limit?: number;
  level?: string;
}

export interface BuildLogEntry {
  timestamp: string;
  level: string;
  step: string;
  message: string;
}

export interface BuildStatusResponse {
  buildID: string;
  templateID: string;
  status: string;
  logs: string[];
  logEntries: BuildLogEntry[];
  reason: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface BuildLogsParams {
  cursor?: number;
  limit?: number;
  direction?: "forward" | "backward";
  level?: string;
  source?: "temporary" | "persistent";
}

export interface BuildLogsResponse {
  logs: BuildLogEntry[];
}

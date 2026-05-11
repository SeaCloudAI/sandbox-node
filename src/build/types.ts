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

export interface TemplateVolumeMount {
  name: string;
  path: string;
}

export interface PublicTemplateExtensions {
  baseTemplateID?: string;
  visibility?: string;
  envs?: Record<string, string>;
  storageType?: string;
  storageSizeGB?: number;
  volumeMounts?: TemplateVolumeMount[];
}

export interface TemplateExtensions {
  baseTemplateID?: string;
  visibility?: string;
  envs?: Record<string, string>;
  storageType?: string;
  storageSizeGB?: number;
  volumeMounts?: TemplateVolumeMount[];
  image?: string;
  imageSource?: string;
  projectID?: string;
  ttlSeconds?: number;
  port?: number;
  runtimeMode?: string;
  startCmd?: string;
  readyCmd?: string;
}

export interface TemplateCreateRequest {
  name?: string;
  tags?: string[];
  cpuCount?: number;
  memoryMB?: number;
  extensions?: PublicTemplateExtensions;
}

export interface TemplateUpdateRequest {
  extensions?: PublicTemplateExtensions;
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

export interface TemplateToleration {
  key: string;
  operator: string;
  value?: string;
  effect: string;
}

export interface TemplateDNSOption {
  name: string;
  value?: string;
}

export interface ListedTemplate {
  templateID: string;
  buildID?: string;
  cpuCount: number;
  memoryMB: number;
  diskSizeMB: number;
  buildStatus: string;
  public: boolean;
  names: string[];
  aliases: string[];
  createdAt: string;
  updatedAt: string;
  createdBy?: TemplateUser | null;
  lastSpawnedAt?: string | null;
  spawnCount: number;
  buildCount: number;
  envdVersion?: string;
  extensions?: TemplateExtensions;
}

export interface TemplateBuild {
  buildID: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string | null;
  cpuCount: number;
  memoryMB: number;
  diskSizeMB: number;
  envdVersion?: string;
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
  buildID?: string;
  buildStatus?: string;
  cpuCount?: number;
  memoryMB?: number;
  diskSizeMB?: number;
  public: boolean;
  aliases: string[];
  names: string[];
  createdBy?: TemplateUser | null;
  createdAt: string;
  updatedAt: string;
  lastSpawnedAt?: string | null;
  spawnCount: number;
  buildCount?: number;
  envdVersion?: string;
  builds?: TemplateBuild[];
  nextToken?: string;
  type?: string;
  version?: string;
  name?: string;
  visibility?: string;
  baseTemplateID?: string;
  image?: string;
  imageSource?: string;
  projectID?: string;
  storageType?: string;
  storageSizeGB?: number;
  storageClass?: string;
  emptyDirSizeLimit?: string;
  emptyDirMedium?: string;
  objectBucket?: string;
  objectKeyPrefix?: string;
  workspaceID?: string;
  nfsHostPath?: string;
  cpuLimitRatio?: number;
  memoryLimitRatio?: number;
  namespace?: string;
  location?: string;
  envdBaseDomain?: string;
  runtimeClassName?: string;
  tolerations?: TemplateToleration[];
  imagePullSecrets?: string[];
  imagePullPolicy?: string;
  dnsPolicy?: string;
  dnsNameservers?: string[];
  dnsSearches?: string[];
  dnsOptions?: TemplateDNSOption[];
  port?: number;
  labels?: Record<string, string>;
  ttlSeconds?: number;
  daemonImage?: string;
  cloudsinkURL?: string;
  sandboxRoot?: string;
  probeTargets?: string;
  probeIntervalSecs?: number;
  probeTimeoutSecs?: number;
  gatewayURL?: string;
  heartbeatIntervalSecs?: number;
  runtimeMode?: string;
  startCmd?: string;
  readyCmd?: string;
  extensions?: TemplateExtensions;
}

export interface BuildStep {
  type?: string;
  filesHash?: string;
  args?: string[];
  force?: boolean;
}

export interface GenericRegistryConfig {
  type: "registry";
  username: string;
  password: string;
}

export interface AWSRegistryConfig {
  type: "aws";
  awsAccessKeyId: string;
  awsSecretAccessKey: string;
  awsRegion: string;
}

export interface GCPRegistryConfig {
  type: "gcp";
  serviceAccountJson: string;
}

export type RegistryConfig = GenericRegistryConfig | AWSRegistryConfig | GCPRegistryConfig;

export interface BuildRequest {
  fromTemplate?: string;
  fromImage?: string;
  fromImageRegistry?: RegistryConfig;
  force?: boolean;
  steps?: BuildStep[];
  filesHash?: string;
  runtimeMode?: string;
  startCmd?: string;
  readyCmd?: string;
}

export type BuildTriggerResponse = Record<string, never>;

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

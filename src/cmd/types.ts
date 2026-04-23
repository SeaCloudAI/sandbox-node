export type FileType =
  | "FILE_TYPE_UNSPECIFIED"
  | "FILE_TYPE_FILE"
  | "FILE_TYPE_DIRECTORY"
  | "FILE_TYPE_SYMLINK";

export type EventType =
  | "EVENT_TYPE_UNSPECIFIED"
  | "EVENT_TYPE_CREATE"
  | "EVENT_TYPE_WRITE"
  | "EVENT_TYPE_REMOVE"
  | "EVENT_TYPE_RENAME"
  | "EVENT_TYPE_CHMOD";

export type RestEntryType = "file" | "directory";

export interface CmdOptions {
  baseUrl: string;
  accessToken?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export interface CmdRequestOptions {
  username?: string;
  signature?: string;
  signatureExpiration?: number;
  range?: string;
  headers?: HeadersInit;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface EntryInfo {
  name: string;
  type: FileType;
  path: string;
  size: number;
  mode: number;
  permissions: string;
  owner: string;
  group: string;
  modifiedTime: string;
  symlinkTarget?: string | null;
}

export interface FilesystemEvent {
  name: string;
  type: EventType;
}

export interface ProcessSelector {
  pid?: number;
  tag?: string;
}

export interface ProcessInput {
  stdin?: string;
  pty?: string;
}

export interface ProcessConfig {
  cmd: string;
  args?: string[];
  envs?: Record<string, string>;
  cwd?: string | null;
}

export interface PtySize {
  cols: number;
  rows: number;
}

export interface PtyConfig {
  size: PtySize;
}

export interface ListDirRequest {
  path: string;
  depth?: number;
}

export interface ListDirResponse {
  entries: EntryInfo[];
}

export interface StatRequest {
  path: string;
}

export interface StatResponse {
  entry: EntryInfo;
}

export interface MakeDirRequest {
  path: string;
}

export interface MakeDirResponse {
  entry: EntryInfo;
}

export interface RemoveRequest {
  path: string;
}

export interface MoveRequest {
  source: string;
  destination: string;
}

export interface MoveResponse {
  entry: EntryInfo;
}

export interface FsEditRequest {
  path: string;
  oldText: string;
  newText: string;
}

export interface FsEditResponse {
  message: string;
}

export interface WatchDirRequest {
  path: string;
  recursive?: boolean;
}

export interface FilesystemWatchFrame {
  start?: Record<string, never>;
  keepalive?: Record<string, never>;
  filesystem?: FilesystemEvent;
}

export interface CreateWatcherRequest {
  path: string;
  recursive?: boolean;
}

export interface CreateWatcherResponse {
  watcherId: string;
}

export interface GetWatcherEventsRequest {
  watcherId: string;
  limit?: number;
}

export interface GetWatcherEventsResponse {
  events: FilesystemEvent[];
}

export interface RemoveWatcherRequest {
  watcherId: string;
}

export interface ProcessStartRequest {
  process: ProcessConfig;
  timeout?: number | null;
  tag?: string;
  stdin?: boolean;
  pty?: PtyConfig;
}

export interface ConnectRequest {
  process: ProcessSelector;
}

export interface SendInputRequest {
  process: ProcessSelector;
  input: ProcessInput;
}

export interface SendSignalRequest {
  process: ProcessSelector;
  signal: string;
}

export interface CloseStdinRequest {
  process: ProcessSelector;
}

export interface UpdateRequest {
  process: ProcessSelector;
  pty: PtyConfig;
}

export interface ProcessInfo {
  pid: number;
  config: ProcessConfig;
  tag?: string;
  cmdId?: string;
}

export interface ProcessListResponse {
  processes: ProcessInfo[];
}

export interface GetResultRequest {
  cmdId: string;
}

export interface GetResultResponse {
  exitCode: number;
  stdout: string;
  stderr: string;
  startedAtUnix: number;
}

export type ProcessEvent =
  | { start: { pid: number; cmdId: string } }
  | { data: { stdout?: string; stderr?: string; pty?: string } }
  | { end: { exited: boolean; status: string; error: string | null } }
  | { keepalive: Record<string, never> };

export interface ProcessStreamFrame {
  event: ProcessEvent;
}

export type StreamInputFrame =
  | { start: { process: ProcessSelector } }
  | { data: { input: ProcessInput } }
  | { keepalive: Record<string, never> };

export interface RestEntryInfo {
  path: string;
  name: string;
  type: RestEntryType;
}

export interface WriteFileEntry {
  path: string;
  content?: string;
  data?: string;
  mode?: number;
}

export interface WriteFilesRequest {
  files: WriteFileEntry[];
}

export interface WriteFilesBatchResponse {
  files: Array<{ path: string; bytes_written: number }>;
}

export interface ComposeFilesRequest {
  source_paths: string[];
  destination: string;
}

export type FilesContentResponse =
  | { type: "text"; content: string; truncated: boolean }
  | { type: "image"; mime_type: string; data: string };

export interface PortEntry {
  port: number;
  protocol: string;
  address: string;
  pid?: number;
  process_name?: string;
}

export interface MetricsResponse {
  ts: number;
  cpu_count: number;
  cpu_used_pct: number;
  mem_total: number;
  mem_used: number;
  mem_total_mib: number;
  mem_used_mib: number;
  mem_cache: number;
  disk_used: number;
  disk_total: number;
}

export interface ConfigureRequest {
  envs?: Record<string, string>;
}

export interface AgentRunRequest {
  cmd: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
  stdin?: string;
}

export interface AgentRunResponse {
  stdout: string;
  stderr: string;
  exit_code: number;
  duration_ms: number;
  error?: string;
}

export interface DownloadRequest {
  path: string;
}

export interface FilesContentRequest {
  path: string;
  maxTokens?: number;
}

export interface UploadBytesRequest {
  path: string;
  data: Uint8Array;
  gzipCompress?: boolean;
}

export interface MultipartFile {
  fieldName?: string;
  fileName?: string;
  contentType?: string;
  data: Uint8Array;
}

export interface UploadMultipartRequest {
  path?: string;
  parts: MultipartFile[];
}

export interface FileRequest {
  path: string;
}

export interface ProxyRequest {
  method?: string;
  port: number;
  path?: string;
  body?: BodyInit | null;
  headers?: HeadersInit;
}

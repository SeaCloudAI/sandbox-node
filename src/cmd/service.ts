import {
  APIError,
  ConfigurationError,
  RequestTimeoutError,
  ValidationError,
} from "../core/errors.js";
import { SDK_VERSION } from "../version.js";
import type {
  AgentRunRequest,
  AgentRunResponse,
  CmdOptions,
  CmdRequestOptions,
  ComposeFilesRequest,
  ConfigureRequest,
  ConnectRequest,
  CreateWatcherRequest,
  CreateWatcherResponse,
  DownloadRequest,
  FileRequest,
  FilesContentRequest,
  FilesContentResponse,
  FilesystemWatchFrame,
  FsEditRequest,
  FsEditResponse,
  GetResultRequest,
  GetResultResponse,
  GetWatcherEventsRequest,
  GetWatcherEventsResponse,
  ListDirRequest,
  ListDirResponse,
  MakeDirRequest,
  MakeDirResponse,
  MetricsResponse,
  MoveRequest,
  MoveResponse,
  PortEntry,
  ProcessInput,
  ProcessListResponse,
  ProcessSelector,
  ProcessStartRequest,
  ProcessStreamFrame,
  ProxyRequest,
  RemoveRequest,
  RemoveWatcherRequest,
  RestEntryInfo,
  SendInputRequest,
  SendSignalRequest,
  StatRequest,
  StatResponse,
  StreamInputFrame,
  UpdateRequest,
  UploadBytesRequest,
  UploadMultipartRequest,
  WriteFileEntry,
  WriteFilesBatchResponse,
  WriteFilesRequest,
  WatchDirRequest,
} from "./types.js";

const CONNECT_PROTOCOL_VERSION = "1";
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export class ConnectFrame {
  constructor(
    readonly flags: number,
    readonly payload: Uint8Array,
  ) {}

  isEnd(): boolean {
    return (this.flags & 0x02) !== 0;
  }

  json<T>(): T {
    return JSON.parse(textDecoder.decode(this.payload)) as T;
  }
}

class ConnectReader {
  readonly response: Response;
  #reader: ReadableStreamDefaultReader<Uint8Array<ArrayBufferLike>>;
  #buffer = new Uint8Array(0);

  constructor(response: Response) {
    if (!response.body) {
      throw new ValidationError("response body is empty");
    }
    this.response = response;
    this.#reader = response.body.getReader();
  }

  async close(): Promise<void> {
    try {
      await this.#reader.cancel();
    } catch {
      return;
    }
  }

  async nextFrame(): Promise<ConnectFrame | null> {
    const header = await this.#readExact(5);
    if (!header) {
      return null;
    }
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
    const length = view.getUint32(1, false);
    const payload = (await this.#readExact(length)) ?? new Uint8Array(0);
    return new ConnectFrame(header[0] ?? 0, payload);
  }

  async nextJson<T>(): Promise<T | null> {
    for (;;) {
      const frame = await this.nextFrame();
      if (!frame) {
        return null;
      }
      if (frame.payload.byteLength === 0) {
        if (frame.isEnd()) {
          return null;
        }
        continue;
      }
      return frame.json<T>();
    }
  }

  async #readExact(length: number): Promise<Uint8Array | null> {
    if (length === 0) {
      return new Uint8Array(0);
    }

    while (this.#buffer.byteLength < length) {
      const { value, done } = await this.#reader.read();
      if (done) {
        if (this.#buffer.byteLength === 0) {
          return null;
        }
        throw new Error("unexpected end of connect stream");
      }
      if (value && value.byteLength > 0) {
        const merged = new Uint8Array(this.#buffer.byteLength + value.byteLength);
        merged.set(this.#buffer, 0);
        merged.set(value, this.#buffer.byteLength);
        this.#buffer = merged;
      }
    }

    const chunk = this.#buffer.slice(0, length);
    this.#buffer = this.#buffer.slice(length);
    return chunk;
  }
}

export class ProcessStream {
  readonly #reader: ConnectReader;

  constructor(response: Response) {
    this.#reader = new ConnectReader(response);
  }

  get response(): Response {
    return this.#reader.response;
  }

  close(): Promise<void> {
    return this.#reader.close();
  }

  next(): Promise<ProcessStreamFrame | null> {
    return this.#reader.nextJson<ProcessStreamFrame>();
  }
}

export class FilesystemWatchStream {
  readonly #reader: ConnectReader;

  constructor(response: Response) {
    this.#reader = new ConnectReader(response);
  }

  get response(): Response {
    return this.#reader.response;
  }

  close(): Promise<void> {
    return this.#reader.close();
  }

  next(): Promise<FilesystemWatchFrame | null> {
    return this.#reader.nextJson<FilesystemWatchFrame>();
  }
}

export class SandboxCommandService {
  readonly baseUrl: string;
  readonly accessToken: string;
  readonly timeoutMs: number | undefined;

  #fetchImpl: typeof fetch;

  constructor(options: CmdOptions) {
    const baseUrl = options.baseUrl.trim().replace(/\/+$/, "");
    if (!baseUrl) {
      throw new ConfigurationError("baseUrl is required");
    }

    this.baseUrl = baseUrl;
    this.accessToken = (options.accessToken ?? "").trim();
    this.timeoutMs = normalizeTimeoutMs(options.timeoutMs);
    this.#fetchImpl = options.fetch ?? globalThis.fetch;
  }

  async metrics(): Promise<MetricsResponse> {
    return this.#requestJson<MetricsResponse>("/metrics", { method: "GET" });
  }

  async envs(): Promise<Record<string, string>> {
    return this.#requestJson<Record<string, string>>("/envs", { method: "GET" });
  }

  async configure(body: ConfigureRequest = {}): Promise<void> {
    await this.#requestEmpty("/configure", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }, [204]);
  }

  async ports(): Promise<PortEntry[]> {
    return this.#requestJson<PortEntry[]>("/ports", { method: "GET" });
  }

  async proxy(request: ProxyRequest): Promise<Response> {
    if (!request || !Number.isInteger(request.port) || request.port <= 0) {
      throw new ValidationError("port must be a positive integer");
    }
    const path = this.#proxyPath(request.port, request.path);
    return this.#request(path, {
      method: request.method ?? "GET",
      headers: this.#buildHeaders(request.headers),
      body: request.body ?? null,
    }, request);
  }

  async download(request: DownloadRequest, options: CmdRequestOptions = {}): Promise<Response> {
    const query = this.#fileQuery(request.path, options);
    const headers = new Headers(options.headers);
    if (options.range?.trim()) {
      headers.set("Range", options.range.trim());
    }
    const response = await this.#request(`/files?${query.toString()}`, {
      method: "GET",
      headers: this.#buildHeaders(headers, "*/*"),
    }, options);
    if (![200, 206].includes(response.status)) {
      throw await APIError.fromResponse(response);
    }
    return response;
  }

  async filesContent(request: FilesContentRequest, options: CmdRequestOptions = {}): Promise<FilesContentResponse> {
    const query = this.#fileQuery(request.path, options);
    if (request.maxTokens !== undefined) {
      query.set("max_tokens", String(request.maxTokens));
    }
    return this.#requestJson<FilesContentResponse>(`/files/content?${query.toString()}`, { method: "GET" }, [200], options);
  }

  async uploadBytes(request: UploadBytesRequest, options: CmdRequestOptions = {}): Promise<RestEntryInfo[]> {
    const query = this.#fileQuery(request.path, options);
    let body = request.data;
    const headers = new Headers(options.headers);
    headers.set("Content-Type", "application/octet-stream");
    if (request.gzipCompress) {
      body = await gzipMaybe(request.data);
      headers.set("Content-Encoding", "gzip");
    }
    return this.#requestJson<RestEntryInfo[]>(`/files?${query.toString()}`, {
      method: "POST",
      headers: this.#buildHeaders(headers),
      body: toArrayBuffer(body),
    }, [200], options);
  }

  async uploadJson(entry: WriteFileEntry, options: CmdRequestOptions = {}): Promise<RestEntryInfo[]> {
    if (!entry.path?.trim()) {
      throw new ValidationError("path is required");
    }
    const query = this.#queryFromOptions(options);
    const suffix = query.size ? `?${query.toString()}` : "";
    return this.#requestJson<RestEntryInfo[]>(`/files${suffix}`, {
      method: "POST",
      headers: this.#buildHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(entry),
    }, [200], options);
  }

  async uploadMultipart(request: UploadMultipartRequest, options: CmdRequestOptions = {}): Promise<RestEntryInfo[]> {
    if (!request.parts.length) {
      throw new ValidationError("multipart upload requires at least one part");
    }
    const query = request.path?.trim()
      ? this.#fileQuery(request.path, options)
      : this.#queryFromOptions(options);
    const formData = new FormData();
    for (const [index, part] of request.parts.entries()) {
      const fieldName = part.fieldName?.trim() || "file";
      const fileName = part.fileName?.trim();
      const blob = new Blob([toArrayBuffer(part.data)], {
        type: part.contentType?.trim() || "application/octet-stream",
      });
      if (fileName) {
        formData.append(fieldName, blob, fileName);
      } else {
        formData.append(fieldName, blob);
      }
      if (index < 0) {
        throw new ValidationError("invalid multipart part index");
      }
    }
    return this.#requestJson<RestEntryInfo[]>(`/files?${query.toString()}`, {
      method: "POST",
      headers: this.#buildHeaders(options.headers),
      body: formData,
    }, [200], options);
  }

  async writeBatch(request: WriteFilesRequest, options: CmdRequestOptions = {}): Promise<WriteFilesBatchResponse> {
    return this.#requestJson<WriteFilesBatchResponse>("/files/batch", {
      method: "POST",
      headers: this.#buildHeaders(options.headers, "application/json"),
      body: JSON.stringify(request),
    }, [200], options);
  }

  async composeFiles(request: ComposeFilesRequest, options: CmdRequestOptions = {}): Promise<RestEntryInfo> {
    return this.#requestJson<RestEntryInfo>("/files/compose", {
      method: "POST",
      headers: this.#buildHeaders(options.headers, "application/json"),
      body: JSON.stringify(request),
    }, [200], options);
  }

  async listDir(request: ListDirRequest, options: CmdRequestOptions = {}): Promise<ListDirResponse> {
    this.#requirePath(request.path);
    return this.#connectJson<ListDirResponse>("/filesystem.Filesystem/ListDir", request, options);
  }

  async stat(request: StatRequest, options: CmdRequestOptions = {}): Promise<StatResponse> {
    this.#requirePath(request.path);
    return this.#connectJson<StatResponse>("/filesystem.Filesystem/Stat", request, options);
  }

  async makeDir(request: MakeDirRequest, options: CmdRequestOptions = {}): Promise<MakeDirResponse> {
    this.#requirePath(request.path);
    return this.#connectJson<MakeDirResponse>("/filesystem.Filesystem/MakeDir", request, options);
  }

  async remove(request: RemoveRequest, options: CmdRequestOptions = {}): Promise<void> {
    this.#requirePath(request.path);
    await this.#connectEmpty("/filesystem.Filesystem/Remove", request, options);
  }

  async move(request: MoveRequest, options: CmdRequestOptions = {}): Promise<MoveResponse> {
    this.#requirePath(request.source);
    this.#requirePath(request.destination);
    return this.#connectJson<MoveResponse>("/filesystem.Filesystem/Move", request, options);
  }

  async edit(request: FsEditRequest, options: CmdRequestOptions = {}): Promise<FsEditResponse> {
    this.#requirePath(request.path);
    return this.#connectJson<FsEditResponse>("/filesystem.Filesystem/Edit", request, options);
  }

  async watchDir(request: WatchDirRequest, options: CmdRequestOptions = {}): Promise<FilesystemWatchStream> {
    this.#requirePath(request.path);
    const response = await this.#request("/filesystem.Filesystem/WatchDir", {
      method: "POST",
      headers: this.#connectHeaders(options, true),
      body: JSON.stringify(request),
    }, options);
    if (response.status !== 200) {
      throw await APIError.fromResponse(response);
    }
    return new FilesystemWatchStream(response);
  }

  async createWatcher(request: CreateWatcherRequest, options: CmdRequestOptions = {}): Promise<CreateWatcherResponse> {
    this.#requirePath(request.path);
    return this.#connectJson<CreateWatcherResponse>("/filesystem.Filesystem/CreateWatcher", request, options);
  }

  async getWatcherEvents(
    request: GetWatcherEventsRequest,
    options: CmdRequestOptions = {},
  ): Promise<GetWatcherEventsResponse> {
    if (!request.watcherId?.trim()) {
      throw new ValidationError("watcherId is required");
    }
    return this.#connectJson<GetWatcherEventsResponse>("/filesystem.Filesystem/GetWatcherEvents", request, options);
  }

  async removeWatcher(request: RemoveWatcherRequest, options: CmdRequestOptions = {}): Promise<void> {
    if (!request.watcherId?.trim()) {
      throw new ValidationError("watcherId is required");
    }
    await this.#connectEmpty("/filesystem.Filesystem/RemoveWatcher", request, options);
  }

  async start(request: ProcessStartRequest, options: CmdRequestOptions = {}): Promise<ProcessStream> {
    if (!request.process?.cmd?.trim()) {
      throw new ValidationError("cmd is required");
    }
    const response = await this.#request("/process.Process/Start", {
      method: "POST",
      headers: this.#connectHeaders(options, true, "application/connect+json"),
      body: JSON.stringify(request),
    }, options);
    if (response.status !== 200) {
      throw await APIError.fromResponse(response);
    }
    return new ProcessStream(response);
  }

  async connect(request: ConnectRequest, options: CmdRequestOptions = {}): Promise<ProcessStream> {
    this.#validateSelector(request.process);
    const response = await this.#request("/process.Process/Connect", {
      method: "POST",
      headers: this.#connectHeaders(options, true, "application/connect+json"),
      body: JSON.stringify(request),
    }, options);
    if (response.status !== 200) {
      throw await APIError.fromResponse(response);
    }
    return new ProcessStream(response);
  }

  async listProcesses(options: CmdRequestOptions = {}): Promise<ProcessListResponse> {
    return this.#connectJson<ProcessListResponse>("/process.Process/List", {}, options);
  }

  async sendInput(request: SendInputRequest, options: CmdRequestOptions = {}): Promise<void> {
    this.#validateSelector(request.process);
    this.#validateInput(request.input);
    await this.#connectEmpty("/process.Process/SendInput", request, options);
  }

  async sendSignal(request: SendSignalRequest, options: CmdRequestOptions = {}): Promise<void> {
    this.#validateSelector(request.process);
    await this.#connectEmpty("/process.Process/SendSignal", request, options);
  }

  async closeStdin(request: { process: ProcessSelector }, options: CmdRequestOptions = {}): Promise<void> {
    this.#validateSelector(request.process);
    await this.#connectEmpty("/process.Process/CloseStdin", request, options);
  }

  async update(request: UpdateRequest, options: CmdRequestOptions = {}): Promise<void> {
    this.#validateSelector(request.process);
    if (!request.pty) {
      throw new ValidationError("pty is required");
    }
    await this.#connectEmpty("/process.Process/Update", request, options);
  }

  async streamInput(frames: StreamInputFrame[], options: CmdRequestOptions = {}): Promise<ConnectFrame | null> {
    if (!frames.length) {
      throw new ValidationError("stream input requires at least one frame");
    }
    const body = encodeConnectFrames(frames);
    const response = await this.#request("/process.Process/StreamInput", {
      method: "POST",
      headers: this.#connectHeaders(options, true, "application/connect+json"),
      body: toArrayBuffer(body),
    }, options);
    if (response.status !== 200) {
      throw await APIError.fromResponse(response);
    }
    const reader = new ConnectReader(response);
    try {
      return await reader.nextFrame();
    } finally {
      await reader.close();
    }
  }

  async getResult(request: GetResultRequest, options: CmdRequestOptions = {}): Promise<GetResultResponse> {
    if (!request.cmdId?.trim()) {
      throw new ValidationError("cmdId is required");
    }
    return this.#connectJson<GetResultResponse>("/process.Process/GetResult", request, options);
  }

  async run(request: AgentRunRequest, options: CmdRequestOptions = {}): Promise<AgentRunResponse> {
    if (!request.cmd?.trim()) {
      throw new ValidationError("cmd is required");
    }
    return this.#requestJson<AgentRunResponse>("/run", {
      method: "POST",
      headers: this.#basicHeaders(options, "application/json"),
      body: JSON.stringify(request),
    }, [200], options);
  }

  async readFile(request: FileRequest, options: CmdRequestOptions = {}): Promise<Response> {
    const query = this.#fileQuery(request.path, options);
    const response = await this.#request(`/file?${query.toString()}`, {
      method: "GET",
      headers: this.#buildHeaders(options.headers, "*/*"),
    }, options);
    if (response.status !== 200) {
      throw await APIError.fromResponse(response);
    }
    return response;
  }

  async writeFile(request: UploadBytesRequest, options: CmdRequestOptions = {}): Promise<void> {
    const query = this.#fileQuery(request.path, options);
    let body = request.data;
    const headers = new Headers(options.headers);
    headers.set("Content-Type", "application/octet-stream");
    if (request.gzipCompress) {
      body = await gzipMaybe(request.data);
      headers.set("Content-Encoding", "gzip");
    }
    await this.#requestEmpty(`/file?${query.toString()}`, {
      method: "POST",
      headers: this.#buildHeaders(headers),
      body: toArrayBuffer(body),
    }, [204], options);
  }

  #requirePath(path: string): void {
    if (!path?.trim()) {
      throw new ValidationError("path is required");
    }
  }

  #validateSelector(selector: ProcessSelector): void {
    const hasPid = selector.pid !== undefined;
    const hasTag = Boolean(selector.tag?.trim());
    if (!hasPid && !hasTag) {
      throw new ValidationError("process selector requires pid or tag");
    }
    if (hasPid && hasTag) {
      throw new ValidationError("process selector requires exactly one of pid or tag");
    }
  }

  #validateInput(input: ProcessInput): void {
    if (!input.stdin?.trim() && !input.pty?.trim()) {
      throw new ValidationError("process input requires stdin or pty");
    }
  }

  #buildUrl(path: string): string {
    const trimmed = path.trim() || "/";
    const queryIndex = trimmed.indexOf("?");
    const rawPath = queryIndex >= 0 ? trimmed.slice(0, queryIndex) : trimmed;
    const rawQuery = queryIndex >= 0 ? trimmed.slice(queryIndex + 1) : "";
    const normalizedPath = rawPath.startsWith("/") ? rawPath : `/${rawPath || ""}`;
    const base = new URL(this.baseUrl);
    const basePath = base.pathname.replace(/\/+$/, "");
    const reqPath = normalizedPath.replace(/^\/+/, "");
    base.pathname = basePath ? `${basePath}/${reqPath}` : `/${reqPath}`;
    base.search = rawQuery ? `?${rawQuery}` : "";
    base.hash = "";
    return base.toString();
  }

  #buildHeaders(headers: HeadersInit = {}, accept = "application/json"): Headers {
    const merged = new Headers();
    if (accept) {
      merged.set("Accept", accept);
    }
    merged.set("User-Agent", `seacloudai-sandbox-node-cmd/${SDK_VERSION}`);
    if (this.accessToken) {
      merged.set("X-Access-Token", this.accessToken);
    }
    new Headers(headers).forEach((value, key) => {
      merged.set(key, value);
    });
    return merged;
  }

  #basicHeaders(options: CmdRequestOptions, contentType?: string): Headers {
    const headers = this.#buildHeaders(options.headers);
    if (contentType) {
      headers.set("Content-Type", contentType);
    }
    if (options.username?.trim() && !headers.has("Authorization")) {
      headers.set("Authorization", `Basic ${toBase64(`${options.username.trim()}:`)}`);
    }
    return headers;
  }

  #connectHeaders(options: CmdRequestOptions, basicAuth: boolean, contentType = "application/json"): Headers {
    const headers = this.#buildHeaders(options.headers, "application/json");
    headers.set("Connect-Protocol-Version", CONNECT_PROTOCOL_VERSION);
    headers.set("Content-Type", contentType);
    if (basicAuth && options.username?.trim() && !headers.has("Authorization")) {
      headers.set("Authorization", `Basic ${toBase64(`${options.username.trim()}:`)}`);
    }
    return headers;
  }

  #queryFromOptions(options: CmdRequestOptions): URLSearchParams {
    const query = new URLSearchParams();
    if (options.username?.trim()) {
      query.set("username", options.username.trim());
    }
    if (options.signature?.trim()) {
      query.set("signature", options.signature.trim());
    }
    if (options.signatureExpiration !== undefined) {
      query.set("signature_expiration", String(options.signatureExpiration));
    }
    return query;
  }

  #fileQuery(path: string, options: CmdRequestOptions): URLSearchParams {
    this.#requirePath(path);
    const query = this.#queryFromOptions(options);
    query.set("path", path);
    return query;
  }

  #proxyPath(port: number, path = ""): string {
    const suffix = path.trim().replace(/^\/+/, "");
    return suffix ? `/proxy/${port}/${suffix}` : `/proxy/${port}/`;
  }

  async #request(path: string, init: RequestInit, options?: CmdRequestOptions): Promise<Response> {
    const requestState = createRequestState(options?.signal, options?.timeoutMs ?? this.timeoutMs);

    try {
      return await this.#fetchImpl(this.#buildUrl(path), {
        ...init,
        // System routes like /metrics still require X-Access-Token when runtime auth is enabled.
        headers: this.#buildHeaders(init.headers),
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

  async #requestJson<T>(
    path: string,
    init: RequestInit,
    expectedStatuses: number[] = [200],
    options?: CmdRequestOptions,
  ): Promise<T> {
    const response = await this.#request(path, init, options);
    if (!expectedStatuses.includes(response.status)) {
      throw await APIError.fromResponse(response);
    }
    return (await response.json()) as T;
  }

  async #requestEmpty(
    path: string,
    init: RequestInit,
    expectedStatuses: number[] = [204],
    options?: CmdRequestOptions,
  ): Promise<void> {
    const response = await this.#request(path, init, options);
    if (!expectedStatuses.includes(response.status)) {
      throw await APIError.fromResponse(response);
    }
    await response.arrayBuffer();
  }

  async #connectJson<T>(path: string, body: unknown, options: CmdRequestOptions): Promise<T> {
    return this.#requestJson<T>(path, {
      method: "POST",
      headers: this.#connectHeaders(options, true),
      body: JSON.stringify(body),
    }, [200], options);
  }

  async #connectEmpty(path: string, body: unknown, options: CmdRequestOptions): Promise<void> {
    await this.#requestEmpty(path, {
      method: "POST",
      headers: this.#connectHeaders(options, true),
      body: JSON.stringify(body),
    }, [200], options);
  }
}

function encodeConnectFrames(frames: StreamInputFrame[]): Uint8Array {
  const chunks = frames.map((frame) => {
    const payload = textEncoder.encode(JSON.stringify(frame));
    const out = new Uint8Array(5 + payload.byteLength);
    const view = new DataView(out.buffer);
    view.setUint8(0, 0);
    view.setUint32(1, payload.byteLength, false);
    out.set(payload, 5);
    return out;
  });
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

function toBase64(value: string): string {
  if (typeof btoa === "function") {
    return btoa(value);
  }
  let binary = "";
  for (const byte of textEncoder.encode(value)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

async function gzipMaybe(data: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === "undefined") {
    return data;
  }
  const stream = new Blob([toArrayBuffer(data)]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  return new Uint8Array(data).buffer;
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

function createRequestState(signal: AbortSignal | undefined, timeoutMs: number | undefined) {
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

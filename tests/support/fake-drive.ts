type FakeBody = string | Uint8Array | Blob | undefined;

export interface FakeDriveRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: FakeBody;
}

export interface FakeDriveResponse {
  status: number;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
}

interface FakeDriveFile {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  appProperties: Record<string, string>;
  content: Uint8Array;
  version: number;
  modifiedTime: string;
}

interface UploadSession {
  existingFileId?: string;
  expectedLength: number;
  received: Uint8Array;
  completedFileId?: string;
  metadata: {
    name: string;
    mimeType: string;
    parents?: string[];
    appProperties?: Record<string, string>;
  };
}

interface FailureRule {
  status: number;
  reason?: string;
  matches: (request: FakeDriveRequest) => boolean;
}

interface DelayRule {
  matches: (request: FakeDriveRequest) => boolean;
  wait: Promise<void>;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function responseJson(value: unknown, status = 200): FakeDriveResponse {
  return {
    status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  };
}

async function bodyBytes(body: FakeBody) {
  if (!body) return new Uint8Array();
  if (typeof body === 'string') return encoder.encode(body);
  if (body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
  return body;
}

function parseMultipart(body: Uint8Array, contentType: string) {
  const boundary = /boundary=([^;]+)/
    .exec(contentType)?.[1]
    ?.trim()
    .replace(/^"|"$/g, '');
  if (!boundary) throw new Error('Missing multipart boundary');
  const parts = decoder
    .decode(body)
    .split(`--${boundary}`)
    .map((part) => part.trim())
    .filter((part) => part && part !== '--');
  if (parts.length !== 2) throw new Error('Unexpected multipart body');
  return parts.map((part) => {
    const crlfSeparator = part.indexOf('\r\n\r\n');
    const separator = crlfSeparator >= 0 ? crlfSeparator : part.indexOf('\n\n');
    const separatorLength = crlfSeparator >= 0 ? 4 : 2;
    if (separator < 0) throw new Error('Missing multipart part headers');
    return JSON.parse(
      part.slice(separator + separatorLength).trim(),
    ) as unknown;
  }) as [
    {
      name: string;
      mimeType: string;
      parents?: string[];
      appProperties?: Record<string, string>;
    },
    unknown,
  ];
}

export class FakeDrive {
  private readonly files = new Map<string, FakeDriveFile>();
  private readonly sessions = new Map<string, UploadSession>();
  private nextId = 1;
  private readonly failures: FailureRule[] = [];
  private readonly delays: DelayRule[] = [];
  private interruptedUploadBytes: number | null = null;
  private raceWriterId: string | null = null;
  readonly requests: FakeDriveRequest[] = [];

  failNext(status: number, reason?: string) {
    this.failNextMatching(() => true, status, reason);
  }

  failNextMatching(
    matches: FailureRule['matches'],
    status: number,
    reason?: string,
  ) {
    this.failures.push({ matches, status, reason });
  }

  delayNextMatching(matches: DelayRule['matches']) {
    let release: () => void = () => void 0;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.delays.push({ matches, wait });
    return release;
  }

  interruptNextUploadAfter(byteCount: number) {
    this.interruptedUploadBytes = byteCount;
  }

  raceNextManifestCommit(writerDeviceId = 'racing-device') {
    this.raceWriterId = writerDeviceId;
  }

  deleteFirstWithRole(role: string) {
    const file = this.filesWithRole(role)[0];
    return file ? this.files.delete(file.id) : false;
  }

  duplicateFirstWithRole(role: string) {
    const source = this.filesWithRole(role)[0];
    if (!source) throw new Error(`No fake ${role} file`);
    const duplicate = this.createFile({
      name: source.name,
      mimeType: source.mimeType,
      parents: [...source.parents],
      appProperties: { ...source.appProperties },
    });
    duplicate.content = source.content.slice();
    return duplicate.id;
  }

  filesWithRole(role: string) {
    return [...this.files.values()].filter(
      (file) => file.appProperties.scranbookRole === role,
    );
  }

  manifestJson() {
    const manifest = this.filesWithRole('manifest')[0];
    return manifest
      ? (JSON.parse(decoder.decode(manifest.content)) as Record<
          string,
          unknown
        >)
      : null;
  }

  replaceManifest(value: unknown) {
    const manifest = this.filesWithRole('manifest')[0];
    if (!manifest) throw new Error('No fake manifest');
    manifest.content = encoder.encode(JSON.stringify(value));
    this.touch(manifest);
  }

  async fetch(input: RequestInfo | URL, init: RequestInit = {}) {
    const url =
      typeof input === 'string' || input instanceof URL
        ? String(input)
        : input.url;
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    const body = await bodyBytes(init.body as FakeBody);
    const result = await this.handle({
      url,
      method: init.method,
      headers,
      body,
    });
    const responseBody =
      typeof result.body === 'string'
        ? result.body
        : result.body
          ? (result.body.buffer.slice(
              result.body.byteOffset,
              result.body.byteOffset + result.body.byteLength,
            ) as ArrayBuffer)
          : null;
    return new Response(responseBody, {
      status: result.status,
      headers: result.headers,
    });
  }

  async handle(request: FakeDriveRequest): Promise<FakeDriveResponse> {
    this.requests.push({ ...request });
    const delayIndex = this.delays.findIndex((rule) => rule.matches(request));
    if (delayIndex >= 0) {
      const [delay] = this.delays.splice(delayIndex, 1);
      await delay.wait;
    }
    const failureIndex = this.failures.findIndex((rule) =>
      rule.matches(request),
    );
    if (failureIndex >= 0) {
      const [failure] = this.failures.splice(failureIndex, 1);
      return responseJson(
        {
          error: {
            code: failure.status,
            errors: failure.reason ? [{ reason: failure.reason }] : [],
          },
        },
        failure.status,
      );
    }
    const headers = new Headers(request.headers);
    if (headers.get('authorization') !== 'Bearer mock-drive-token') {
      return responseJson({ error: { code: 401 } }, 401);
    }
    const url = new URL(request.url);
    const method = request.method ?? 'GET';
    const body = await bodyBytes(request.body);

    if (url.pathname.startsWith('/upload/session/')) {
      return this.handleSession(url.pathname.split('/').at(-1)!, headers, body);
    }
    if (url.pathname.startsWith('/upload/drive/v3/files')) {
      return this.handleUpload(url, method, headers, body);
    }
    if (url.pathname === '/drive/v3/files' && method === 'GET') {
      return this.listFiles(url.searchParams.get('q') ?? '');
    }
    if (url.pathname === '/drive/v3/files' && method === 'POST') {
      const metadata = JSON.parse(decoder.decode(body)) as {
        name: string;
        mimeType: string;
        parents?: string[];
        appProperties?: Record<string, string>;
      };
      return responseJson(this.publicFile(this.createFile(metadata)));
    }
    const fileId = url.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/)?.[1];
    if (fileId) {
      const file = this.files.get(decodeURIComponent(fileId));
      if (!file) return responseJson({ error: { code: 404 } }, 404);
      if (method === 'DELETE') {
        this.files.delete(file.id);
        return { status: 204 };
      }
      if (url.searchParams.get('alt') === 'media') {
        return {
          status: 200,
          headers: { 'Content-Type': file.mimeType },
          body: file.content,
        };
      }
      return responseJson(this.publicFile(file));
    }
    return responseJson({ error: { code: 404 } }, 404);
  }

  private async handleUpload(
    url: URL,
    method: string,
    headers: Headers,
    body: Uint8Array,
  ) {
    const existingFileId = url.pathname.match(
      /^\/upload\/drive\/v3\/files\/([^/]+)$/,
    )?.[1];
    const uploadType = url.searchParams.get('uploadType');
    if (uploadType === 'resumable') {
      const sessionId = `session-${this.nextId++}`;
      this.sessions.set(sessionId, {
        existingFileId: existingFileId
          ? decodeURIComponent(existingFileId)
          : undefined,
        metadata: JSON.parse(decoder.decode(body)) as UploadSession['metadata'],
        expectedLength: Number(headers.get('x-upload-content-length') ?? 0),
        received: new Uint8Array(),
      });
      return {
        status: 200,
        headers: {
          Location: `https://www.googleapis.com/upload/session/${sessionId}`,
        },
      };
    }
    if (uploadType === 'multipart') {
      const [metadata, content] = parseMultipart(
        body,
        headers.get('content-type') ?? '',
      );
      const contentBytes = encoder.encode(JSON.stringify(content));
      const existing = existingFileId
        ? this.files.get(decodeURIComponent(existingFileId))
        : undefined;
      const file = existing ?? this.createFile(metadata);
      if (existing) {
        existing.name = metadata.name;
        existing.mimeType = metadata.mimeType;
        existing.appProperties = {
          ...existing.appProperties,
          ...metadata.appProperties,
        };
        this.touch(existing);
      }
      file.content = contentBytes;
      if (!existing) this.touch(file);
      const committedResponse = this.publicFile(file);
      if (
        this.raceWriterId &&
        metadata.appProperties?.scranbookRole === 'manifest'
      ) {
        const manifest = JSON.parse(decoder.decode(file.content)) as Record<
          string,
          unknown
        >;
        manifest.writerDeviceId = this.raceWriterId;
        manifest.commitId = `raced-${this.nextId++}`;
        file.content = encoder.encode(JSON.stringify(manifest));
        this.touch(file);
        this.raceWriterId = null;
      }
      return responseJson(committedResponse);
    }
    return responseJson({ error: { code: 400 } }, 400);
  }

  private handleSession(sessionId: string, headers: Headers, body: Uint8Array) {
    const session = this.sessions.get(sessionId);
    if (!session) return responseJson({ error: { code: 404 } }, 404);
    if (headers.get('content-range')?.startsWith('bytes */')) {
      if (session.completedFileId) {
        const completed = this.files.get(session.completedFileId);
        return completed
          ? responseJson(this.publicFile(completed))
          : responseJson({ error: { code: 404 } }, 404);
      }
      return this.incompleteSessionResponse(session.received.length);
    }

    const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(
      headers.get('content-range') ?? '',
    );
    if (!range || Number(range[1]) !== session.received.length) {
      return responseJson({ error: { code: 400 } }, 400);
    }
    if (Number(range[3]) !== session.expectedLength) {
      return responseJson({ error: { code: 400 } }, 400);
    }
    if (this.interruptedUploadBytes !== null) {
      const accepted = body.slice(0, this.interruptedUploadBytes);
      session.received = this.joinBytes(session.received, accepted);
      this.interruptedUploadBytes = null;
      return responseJson({ error: { code: 503 } }, 503);
    }
    session.received = this.joinBytes(session.received, body);
    if (session.received.length < session.expectedLength) {
      return this.incompleteSessionResponse(session.received.length);
    }
    if (session.received.length > session.expectedLength) {
      return responseJson({ error: { code: 400 } }, 400);
    }
    const existing = session.existingFileId
      ? this.files.get(session.existingFileId)
      : undefined;
    const file = existing ?? this.createFile(session.metadata);
    if (existing) {
      existing.name = session.metadata.name;
      existing.mimeType = session.metadata.mimeType;
      existing.appProperties = {
        ...existing.appProperties,
        ...session.metadata.appProperties,
      };
    }
    file.content = session.received;
    this.touch(file);
    session.completedFileId = file.id;
    return responseJson(this.publicFile(file));
  }

  private incompleteSessionResponse(receivedLength: number): FakeDriveResponse {
    return {
      status: 308,
      headers:
        receivedLength > 0 ? { Range: `bytes=0-${receivedLength - 1}` } : {},
    };
  }

  private joinBytes(left: Uint8Array, right: Uint8Array) {
    const joined = new Uint8Array(left.length + right.length);
    joined.set(left);
    joined.set(right, left.length);
    return joined;
  }

  private listFiles(query: string) {
    const role = /scranbookRole' and value='([^']+)'/.exec(query)?.[1];
    const parent = /'([^']+)' in parents/.exec(query)?.[1];
    const files = [...this.files.values()].filter(
      (file) =>
        (!role || file.appProperties.scranbookRole === role) &&
        (!parent || file.parents.includes(parent)),
    );
    return responseJson({ files: files.map((file) => this.publicFile(file)) });
  }

  private createFile(metadata: {
    name: string;
    mimeType: string;
    parents?: string[];
    appProperties?: Record<string, string>;
  }) {
    const id = `file-${this.nextId++}`;
    const file: FakeDriveFile = {
      id,
      name: metadata.name,
      mimeType: metadata.mimeType,
      parents: metadata.parents ?? [],
      appProperties: metadata.appProperties ?? {},
      content: new Uint8Array(),
      version: 1,
      modifiedTime: new Date().toISOString(),
    };
    this.files.set(id, file);
    return file;
  }

  private touch(file: FakeDriveFile) {
    file.version += 1;
    file.modifiedTime = new Date().toISOString();
  }

  private publicFile(file: FakeDriveFile) {
    return {
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      version: String(file.version),
      modifiedTime: file.modifiedTime,
      webViewLink: `https://drive.google.com/drive/folders/${file.id}`,
      parents: file.parents,
    };
  }
}

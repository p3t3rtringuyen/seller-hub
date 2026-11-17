import { createHash, createHmac } from "node:crypto";

// Raw landing (ADR-0008 decision 4): downloaded documents are written to object storage BEFORE parsing, and a
// resumed run parses from there instead of asking Amazon again. The bucket lifecycle (35 days, D64) deletes them.

export interface ObjectStore {
  put(key: string, body: Uint8Array, contentType?: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
}

export class MemoryObjectStore implements ObjectStore {
  readonly objects = new Map<string, Uint8Array>();
  async put(key: string, body: Uint8Array): Promise<void> {
    this.objects.set(key, body);
  }
  async get(key: string): Promise<Uint8Array | null> {
    return this.objects.get(key) ?? null;
  }
}

export interface S3Options {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  fetchImpl?: typeof fetch;
}

const sha256Hex = (data: Uint8Array | string): string =>
  createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string): Buffer =>
  createHmac("sha256", key).update(data).digest();

/**
 * Minimal S3 client (path-style, SigV4, PUT and GET object) for MinIO and AWS. Written here so the worker needs
 * no AWS SDK; swap the SDK in behind `ObjectStore` if multipart upload is ever needed.
 */
export class S3ObjectStore implements ObjectStore {
  private readonly doFetch: typeof fetch;
  constructor(private readonly o: S3Options) {
    this.doFetch = o.fetchImpl ?? fetch;
  }

  private async request(
    method: "PUT" | "GET",
    key: string,
    body?: Uint8Array,
    contentType?: string,
  ): Promise<Response> {
    const url = new URL(
      `${this.o.endpoint.replace(/\/$/, "")}/${this.o.bucket}${key ? `/${key.split("/").map(encodeURIComponent).join("/")}` : ""}`,
    );
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
    const date = amzDate.slice(0, 8);
    const payloadHash = sha256Hex(body ?? "");
    const headers: Record<string, string> = {
      host: url.host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    };
    if (contentType) headers["content-type"] = contentType;
    const names = Object.keys(headers).sort();
    const canonical = [
      method,
      url.pathname,
      "",
      ...names.map((n) => `${n}:${headers[n]}`),
      "",
      names.join(";"),
      payloadHash,
    ].join("\n");
    const scope = `${date}/${this.o.region}/s3/aws4_request`;
    const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonical)].join("\n");
    const kSigning = hmac(
      hmac(hmac(hmac(`AWS4${this.o.secretKey}`, date), this.o.region), "s3"),
      "aws4_request",
    );
    const signature = createHmac("sha256", kSigning).update(toSign).digest("hex");
    const sendHeaders: Record<string, string> = {
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      authorization: `AWS4-HMAC-SHA256 Credential=${this.o.accessKey}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`,
    };
    if (contentType) sendHeaders["content-type"] = contentType;
    return this.doFetch(url, {
      method,
      headers: sendHeaders,
      ...(body ? { body: body as never } : {}),
    });
  }

  /** Creates the bucket when it does not exist (dev MinIO starts empty). Safe to call at every start. */
  async ensureBucket(): Promise<void> {
    const res = await this.request("PUT", "");
    if (!res.ok && res.status !== 409)
      throw new Error(`creating the bucket failed with ${res.status}`);
  }

  async put(key: string, body: Uint8Array, contentType?: string): Promise<void> {
    const res = await this.request("PUT", key, body, contentType);
    if (!res.ok) throw new Error(`object store PUT failed with ${res.status}`);
  }

  async get(key: string): Promise<Uint8Array | null> {
    const res = await this.request("GET", key);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`object store GET failed with ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }
}

/** `raw/{tenant}/{sellerAccount}/{syncKey}/{yyyy}/{mm}/{dd}/{runId}/{part}` (ADR-0008 decision 4). */
export function rawObjectKey(p: {
  tenantId: string;
  sellerAccountId: string;
  syncKey: string;
  at: Date;
  runId: string;
  part: number;
}): string {
  const y = p.at.getUTCFullYear();
  const m = String(p.at.getUTCMonth() + 1).padStart(2, "0");
  const d = String(p.at.getUTCDate()).padStart(2, "0");
  return `raw/${p.tenantId}/${p.sellerAccountId}/${p.syncKey}/${y}/${m}/${d}/${p.runId}/${p.part}`;
}

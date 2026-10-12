import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { File, Storage } from "@google-cloud/storage";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  canAccessObject,
  setObjectAclPolicy,
  type ObjectAclPolicy,
  ObjectPermission,
} from "./objectAcl";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";
const R2_ENV_KEYS = [
  "R2_ACCOUNT_ID",
  "R2_BUCKET_NAME",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
] as const;

type R2Environment = {
  accountId: string;
  bucketName: string;
  accessKeyId: string;
  secretAccessKey: string;
};

type ObjectMetadata = {
  size?: number;
  contentType?: string;
};

class R2ObjectEntityFile {
  constructor(
    private readonly client: S3Client,
    private readonly bucketName: string,
    private readonly key: string,
  ) {}

  async getMetadata(): Promise<[ObjectMetadata]> {
    const response = await this.client.send(new HeadObjectCommand({
      Bucket: this.bucketName,
      Key: this.key,
    }));
    return [{
      size: response.ContentLength,
      contentType: response.ContentType,
    }];
  }

  async download(): Promise<[Buffer]> {
    const response = await this.client.send(new GetObjectCommand({
      Bucket: this.bucketName,
      Key: this.key,
    }));
    if (!response.Body) throw new ObjectNotFoundError();
    return [Buffer.from(await response.Body.transformToByteArray())];
  }
}

export const objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: "json",
        subject_token_field_name: "access_token",
      },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
  }
}

export class ObjectStorageService {
  private r2Client: S3Client | null = null;

  getUploadMode(): "direct" | "server" {
    return this.getBackend() === "r2" ? "server" : "direct";
  }

  async saveObjectEntityFile(buffer: Buffer, contentType: string): Promise<string> {
    const objectName = `uploads/${randomUUID()}`;
    if (this.getBackend() === "r2") {
      const { bucketName } = this.getR2Environment();
      await this.getR2Client().send(new PutObjectCommand({
        Bucket: bucketName,
        Key: objectName,
        Body: buffer,
        ContentType: contentType,
        CacheControl: "private, max-age=300",
      }));
      return `/objects/${objectName}`;
    }

    const { bucketName, objectName: gcsObjectName } = parseObjectPath(
      `${this.getPrivateObjectDir()}/${objectName}`,
    );
    await objectStorageClient.bucket(bucketName).file(gcsObjectName).save(buffer, {
      resumable: false,
      metadata: { contentType },
    });
    return `/objects/${objectName}`;
  }

  getPrivateObjectDir(): string {
    const directory = process.env.PRIVATE_OBJECT_DIR?.trim() || "";
    if (!directory) throw new Error("Private object storage is not configured.");
    return directory;
  }

  async getObjectEntityUploadURL(): Promise<string> {
    if (this.getBackend() !== "replit") {
      throw new Error("Use the authenticated server upload route for this storage provider.");
    }
    const { bucketName, objectName } = parseObjectPath(
      `${this.getPrivateObjectDir()}/uploads/${randomUUID()}`,
    );
    return signObjectURL({ bucketName, objectName, method: "PUT", ttlSec: 900 });
  }

  normalizeObjectEntityPath(rawPath: string): string {
    if (!rawPath.startsWith("https://storage.googleapis.com/")) return rawPath;
    const pathname = new URL(rawPath).pathname;
    let privateDir = this.getPrivateObjectDir();
    if (!privateDir.endsWith("/")) privateDir += "/";
    if (!pathname.startsWith(privateDir)) return pathname;
    return `/objects/${pathname.slice(privateDir.length)}`;
  }

  async getObjectEntityFile(objectPath: string): Promise<File | R2ObjectEntityFile> {
    const objectNameFromPath = objectKeyFromPath(objectPath);
    if (this.getBackend() === "r2") {
      const { bucketName } = this.getR2Environment();
      const file = new R2ObjectEntityFile(this.getR2Client(), bucketName, objectNameFromPath);
      try {
        await file.getMetadata();
      } catch (error) {
        if (isObjectNotFound(error)) throw new ObjectNotFoundError();
        throw error;
      }
      return file;
    }

    const { bucketName, objectName } = parseObjectPath(
      `${this.getPrivateObjectDir()}/${objectNameFromPath}`,
    );
    const file = objectStorageClient.bucket(bucketName).file(objectName);
    const [exists] = await file.exists();
    if (!exists) throw new ObjectNotFoundError();
    return file;
  }

  async copyObjectEntityFile(objectPath: string): Promise<string> {
    const source = await this.getObjectEntityFile(objectPath);
    const relativePath = `uploads/${randomUUID()}`;
    if (source instanceof R2ObjectEntityFile) {
      const { bucketName } = this.getR2Environment();
      const [metadata] = await source.getMetadata();
      const [buffer] = await source.download();
      await this.getR2Client().send(new PutObjectCommand({
        Bucket: bucketName,
        Key: relativePath,
        Body: buffer,
        ...(metadata.contentType ? { ContentType: metadata.contentType } : {}),
        CacheControl: "private, max-age=300",
      }));
      return `/objects/${relativePath}`;
    }

    const { bucketName, objectName } = parseObjectPath(
      `${this.getPrivateObjectDir()}/${relativePath}`,
    );
    await source.copy(objectStorageClient.bucket(bucketName).file(objectName));
    return `/objects/${relativePath}`;
  }

  async deleteObjectEntityFile(objectPath: string): Promise<void> {
    if (this.getBackend() === "r2") {
      const { bucketName } = this.getR2Environment();
      await this.getR2Client().send(new DeleteObjectCommand({
        Bucket: bucketName,
        Key: objectKeyFromPath(objectPath),
      }));
      return;
    }
    const file = await this.getObjectEntityFile(objectPath);
    if (!(file instanceof File)) throw new ObjectNotFoundError();
    await file.delete();
  }

  async downloadObject(file: File | R2ObjectEntityFile): Promise<Response> {
    if (file instanceof R2ObjectEntityFile) {
      const [[metadata], [buffer]] = await Promise.all([file.getMetadata(), file.download()]);
      return new Response(new Uint8Array(buffer), {
        headers: {
          "Content-Type": metadata.contentType || "application/octet-stream",
          "Cache-Control": "private, max-age=300",
          ...(metadata.size !== undefined ? { "Content-Length": String(metadata.size) } : {}),
        },
      });
    }
    const [metadata] = await file.getMetadata();
    const nodeStream = file.createReadStream();
    return new Response(Readable.toWeb(nodeStream) as ReadableStream, {
      headers: {
        "Content-Type": String(metadata.contentType || "application/octet-stream"),
        "Cache-Control": "private, max-age=300",
        ...(metadata.size ? { "Content-Length": String(metadata.size) } : {}),
      },
    });
  }

  async trySetObjectEntityAclPolicy(
    objectPath: string,
    aclPolicy: ObjectAclPolicy,
  ): Promise<void> {
    const file = await this.getObjectEntityFile(objectPath);
    if (!(file instanceof File)) {
      throw new Error("Object ACL policies are not supported by Cloudflare R2.");
    }
    await setObjectAclPolicy(file, aclPolicy);
  }

  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: File;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    return canAccessObject({
      userId,
      objectFile,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }

  private getBackend(): "r2" | "replit" {
    const providedKeys = R2_ENV_KEYS.filter((key) => Boolean(process.env[key]?.trim()));
    if (providedKeys.length === R2_ENV_KEYS.length) return "r2";
    if (providedKeys.length > 0) {
      const missing = R2_ENV_KEYS.filter((key) => !process.env[key]?.trim());
      throw new ObjectStorageConfigurationError(
        `Configure the missing Cloudflare R2 settings: ${missing.join(", ")}.`,
      );
    }
    if (process.env.DYNO || process.env.HEROKU_APP_NAME) {
      throw new ObjectStorageConfigurationError(
        "Configure Cloudflare R2 in Heroku before uploading files.",
      );
    }
    return "replit";
  }

  private getR2Environment(): R2Environment {
    const accountId = process.env.R2_ACCOUNT_ID?.trim();
    const bucketName = process.env.R2_BUCKET_NAME?.trim();
    const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
    if (!accountId || !bucketName || !accessKeyId || !secretAccessKey) {
      throw new ObjectStorageConfigurationError(
        "Configure R2_ACCOUNT_ID, R2_BUCKET_NAME, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY.",
      );
    }
    return { accountId, bucketName, accessKeyId, secretAccessKey };
  }

  private getR2Client(): S3Client {
    if (this.r2Client) return this.r2Client;
    const { accountId, accessKeyId, secretAccessKey } = this.getR2Environment();
    this.r2Client = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
    });
    return this.r2Client;
  }
}

export class ObjectStorageConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ObjectStorageConfigurationError";
  }
}

function parseObjectPath(path: string): { bucketName: string; objectName: string } {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const parts = normalized.split("/");
  const bucketName = parts[1];
  const objectName = parts.slice(2).join("/");
  if (!bucketName || !objectName) throw new Error("Invalid object storage path.");
  return { bucketName, objectName };
}

function objectKeyFromPath(objectPath: string): string {
  if (!objectPath.startsWith("/objects/")) throw new ObjectNotFoundError();
  const key = objectPath.slice("/objects/".length);
  if (!key || key.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new ObjectNotFoundError();
  }
  return key;
}

function isObjectNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return candidate.$metadata?.httpStatusCode === 404
    || candidate.name === "NotFound"
    || candidate.name === "NoSuchKey";
}

async function signObjectURL({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  ttlSec: number;
}): Promise<string> {
  const response = await fetch(`${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bucket_name: bucketName,
      object_name: objectName,
      method,
      expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Could not create an object upload URL (${response.status}).`);
  }
  const payload = await response.json() as { signed_url?: string };
  if (!payload.signed_url) throw new Error("Object storage returned no upload URL.");
  return payload.signed_url;
}

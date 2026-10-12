import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { File, Storage } from "@google-cloud/storage";
import {
  canAccessObject,
  setObjectAclPolicy,
  type ObjectAclPolicy,
  ObjectPermission,
} from "./objectAcl";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

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
  getPrivateObjectDir(): string {
    const directory = process.env.PRIVATE_OBJECT_DIR?.trim() || "";
    if (!directory) throw new Error("Private object storage is not configured.");
    return directory;
  }

  async getObjectEntityUploadURL(): Promise<string> {
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

  async getObjectEntityFile(objectPath: string): Promise<File> {
    if (!objectPath.startsWith("/objects/")) throw new ObjectNotFoundError();
    const objectNameFromPath = objectPath.slice("/objects/".length);
    if (!objectNameFromPath || objectNameFromPath.split("/").includes("..")) {
      throw new ObjectNotFoundError();
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
    const { bucketName, objectName } = parseObjectPath(
      `${this.getPrivateObjectDir()}/${relativePath}`,
    );
    await source.copy(objectStorageClient.bucket(bucketName).file(objectName));
    return `/objects/${relativePath}`;
  }

  async deleteObjectEntityFile(objectPath: string): Promise<void> {
    const file = await this.getObjectEntityFile(objectPath);
    await file.delete();
  }

  async downloadObject(file: File): Promise<Response> {
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
    await setObjectAclPolicy(await this.getObjectEntityFile(objectPath), aclPolicy);
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
}

function parseObjectPath(path: string): { bucketName: string; objectName: string } {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const parts = normalized.split("/");
  const bucketName = parts[1];
  const objectName = parts.slice(2).join("/");
  if (!bucketName || !objectName) throw new Error("Invalid object storage path.");
  return { bucketName, objectName };
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

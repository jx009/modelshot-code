import COS from "cos-nodejs-sdk-v5";
import { randomUUID } from "node:crypto";
import { requireCosCredentials } from "./cos-config.js";
import { AppError } from "../../http.js";

export function cosStorage(config, client) {
  requireCosCredentials(config);
  // Only official bucket endpoints. A configurable arbitrary endpoint would let
  // credentials or server-side requests be redirected to an untrusted host.
  client ||= new COS({ SecretId: config.secretId, SecretKey: config.secretKey, Protocol: "https:", Timeout: 15000 });
  const base = { Bucket: config.bucket, Region: config.region };
  return {
    async put(key, bytes, contentType) {
      return client.putObject({ ...base, Key: key, Body: bytes, ContentLength: bytes.length, ContentType: contentType, ACL: "private", CacheControl: `private, max-age=${config.signedUrlSeconds}`, ContentDisposition: "inline" });
    },
    async get(key, etag) { return Buffer.from((await client.getObject({ ...base, Key: key, ...(etag ? { IfMatch: etag } : {}) })).Body); },
    async head(key) { return (await client.headObject({ ...base, Key: key })).headers; },
    async copy(source, key, etag, contentType) {
      return client.putObjectCopy({ ...base, Key: key, CopySource: `${config.bucket}.cos.${config.region}.myqcloud.com/${source.split("/").map(encodeURIComponent).join("/")}`,
        CopySourceIfMatch: etag, MetadataDirective: "Replaced", ContentType: contentType, ACL: "private", CacheControl: "private, max-age=300" });
    },
    signedUpload(key, contentType, bytes) {
      return new Promise((resolve, reject) => client.getObjectUrl({ ...base, Key: key, Method: "PUT", Sign: true, Protocol: "https:", Expires: 900,
        Headers: { "content-type": contentType, "content-length": String(bytes) } }, (error, result) => error ? reject(error) : resolve(result.Url)));
    },
    async delete(key) { await client.deleteObject({ ...base, Key: key }); },
    async assertPrivateBucket() {
      const acl = await client.getBucketAcl(base);
      if ((acl.ACL && acl.ACL !== "private") || (acl.Grants || []).some(g => /AllUsers|AuthenticatedUsers/i.test(g.Grantee?.URI || ""))) throw new AppError("COS_BUCKET_PUBLIC");
    },
    signedUrl(key, seconds = config.signedUrlSeconds, download = false) {
      return new Promise((resolve, reject) => client.getObjectUrl({ ...base, Key: key, Sign: true, Protocol: "https:", Expires: seconds,
        ...(download ? { Query: { "response-content-disposition": "attachment" } } : {}) }, (error, result) => error ? reject(error) : resolve(result.Url)));
    },
  };
}

export function cosError(error) {
  if (error instanceof AppError) return error;
  const code = error?.code || error?.error?.Code;
  const codes = { AccessDenied: "COS_ACCESS_DENIED", SignatureDoesNotMatch: "COS_INVALID_SIGNATURE", InvalidAccessKeyId: "COS_INVALID_KEY", NoSuchBucket: "COS_BUCKET_NOT_FOUND", RequestTimeTooSkewed: "COS_CLOCK_SKEW" };
  return new AppError(codes[code] || "COS_CONNECTION_FAILED", 400, true);
}

export async function testCosConnection(config, store = cosStorage(config)) {
  const key = `${config.prefix}/diagnostics/${randomUUID()}.txt`;
  const bytes = Buffer.from("letaidraw-private-storage-test");
  await store.assertPrivateBucket();
  try {
    await store.put(key, bytes, "text/plain");
    if (!(await store.get(key)).equals(bytes)) throw new AppError("COS_READ_MISMATCH");
  } finally {
    // A delete-permission failure must make the test fail too.
    await store.delete(key);
  }
  // One tiny persistent probe per prefix enables a real browser CORS/decode test.
  const probe = `${config.prefix}/diagnostics/browser-probe.png`;
  await store.put(probe, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWP4//8/AAX+Av5Y8msOAAAAAElFTkSuQmCC", "base64"), "image/png");
  return { ok: true, probeUrl: await store.signedUrl(probe, 60) };
}

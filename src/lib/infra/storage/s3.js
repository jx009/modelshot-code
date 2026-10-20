import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadBucketCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { primaryCos, cosObjectKey } from "./cos-primary.js";
import { getCosConfig } from "./cos-config.js";
import { cosStorage } from "./cos.js";
import { imageTransfers } from "../concurrency.js";

let storage;
export function objectStorage() {
  if (storage) return storage;
  const bucket = process.env.S3_BUCKET;
  if (!bucket || !process.env.S3_ACCESS_KEY_ID || !process.env.S3_SECRET_ACCESS_KEY) throw new Error("Object storage is not configured");
  const client = new S3Client({
    endpoint: process.env.S3_ENDPOINT || undefined,
    region: process.env.S3_REGION || "us-east-1",
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY },
  });
  storage = {
    async health() { await client.send(new HeadBucketCommand({ Bucket: bucket }), { abortSignal: AbortSignal.timeout(3000) }); },
    async list(cursor) { return client.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: cursor, MaxKeys: 500 }), { abortSignal: AbortSignal.timeout(10000) }); },
    async put(key, body, contentType) {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }), { abortSignal: AbortSignal.timeout(30_000) });
    },
    async putImage(key, body, contentType) {
      const config = await getCosConfig();
      if (config.enabled) {
        const target = `${config.prefix}/originals/${key}`;
        try {
          await imageTransfers.run(() => cosStorage(config).put(target, body, contentType));
          return cosObjectKey(config, target);
        } catch { console.warn(JSON.stringify({ code: "COS_PRIMARY_WRITE_FALLBACK" })); }
      }
      // Keep a successfully generated result even if COS is temporarily unavailable.
      await this.put(key, body, contentType);
      return key;
    },
    async get(key) {
      const primary = await primaryCos(key);
      if (primary) return imageTransfers.run(() => primary.store.get(primary.key));
      try {
        const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: AbortSignal.timeout(30_000) });
        return Buffer.from(await response.Body.transformToByteArray());
      } catch (error) {
        if (error.name !== "NoSuchKey" && error.$metadata?.httpStatusCode !== 404) throw error;
        if (!/^[^/]+\/original\/[^/]+$/.test(key)) throw error;
        // Recover a model result uploaded to COS just before a database failure.
        const config = await getCosConfig();
        if (!config.enabled) throw error;
        try { return await imageTransfers.run(() => cosStorage(config).get(`${config.prefix}/originals/${key}`)); }
        catch (cosError) {
          if (cosError.code === "NoSuchKey" || cosError.statusCode === 404) throw error;
          throw cosError;
        }
      }
    },
    async getOptional(key) {
      try { return await this.get(key); }
      catch (error) { if (error.name === "NoSuchKey" || error.code === "NoSuchKey" || error.$metadata?.httpStatusCode === 404) return null; throw error; }
    },
    async stream(key, range, signal) {
      const primary = await primaryCos(key);
      if (primary) {
        const response = await fetch(await primary.store.signedUrl(primary.key), { signal, headers: range ? { Range: range } : {} });
        if (!response.ok) throw new Error("COS_READ_FAILED");
        return response.body;
      }
      const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key, ...(range ? { Range: range } : {}) }), { abortSignal: signal });
      return response.Body.transformToWebStream();
    },
    async delete(key) {
      const primary = await primaryCos(key);
      if (primary) return primary.store.delete(primary.key);
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
  return storage;
}

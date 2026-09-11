import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadBucketCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";

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
    async get(key) {
      const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: AbortSignal.timeout(30_000) });
      return Buffer.from(await response.Body.transformToByteArray());
    },
    async delete(key) { await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })); },
  };
  return storage;
}

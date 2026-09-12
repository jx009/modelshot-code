/**
 * 部署期一次性脚本：确保私有 bucket 存在。
 * 复用应用镜像里已安装的 @aws-sdk/client-s3，不额外拉取 mc 镜像。
 * 幂等：bucket 已存在时正常退出。
 */
import { S3Client, CreateBucketCommand } from "@aws-sdk/client-s3";

const bucket = process.env.S3_BUCKET;
if (!bucket) throw new Error("S3_BUCKET is required");

const client = new S3Client({
  endpoint: process.env.S3_ENDPOINT || undefined,
  region: process.env.S3_REGION || "us-east-1",
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
});

try {
  await client.send(new CreateBucketCommand({ Bucket: bucket }));
  console.log(`created private bucket ${bucket}`);
} catch (error) {
  if (["BucketAlreadyOwnedByYou", "BucketAlreadyExists"].includes(error.name)) {
    console.log(`bucket ${bucket} already exists`);
  } else {
    throw error;
  }
} finally {
  client.destroy();
}

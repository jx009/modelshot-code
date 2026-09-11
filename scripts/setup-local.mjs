import { readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { parse } from "dotenv";

async function initializeEnvironment() {
  const template = await readFile(new URL("../.env.example", import.meta.url), "utf8");
  const values = parse(template);
  values.NEXTAUTH_SECRET = randomBytes(32).toString("hex");
  values.ENCRYPTION_KEY = randomBytes(32).toString("hex");
  const contents = Object.entries(values).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join("\n") + "\n";
  try {
    await writeFile(".env", contents, { flag: "wx", mode: 0o600 });
    console.log("Created .env with independent local secrets.");
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    console.log("Keeping existing .env.");
  }
  const actual = parse(await readFile(".env", "utf8"));
  for (const field of ["DATABASE_URL", "DIRECT_URL"]) {
    const url = new URL(process.env[field] || actual[field]);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.pathname !== "/modelshot") {
      throw new Error(`${field} is not the local modelshot database. Use explicit migration commands for other environments.`);
    }
  }
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", timeout: 300_000 });
  if (result.error || result.status !== 0) throw new Error(`Local setup failed at ${command} ${args.join(" ")}`);
}

await initializeEnvironment();
run("docker", ["compose", "up", "-d", "--wait"]);
run(process.execPath, ["node_modules/prisma/build/index.js", "generate"]);
run(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"]);
const values = parse(await readFile(".env", "utf8"));
const { S3Client, CreateBucketCommand } = await import("@aws-sdk/client-s3");
const storage = new S3Client({ endpoint: values.S3_ENDPOINT, region: values.S3_REGION, forcePathStyle: true, credentials: { accessKeyId: values.S3_ACCESS_KEY_ID, secretAccessKey: values.S3_SECRET_ACCESS_KEY } });
try { await storage.send(new CreateBucketCommand({ Bucket: values.S3_BUCKET })); }
catch (error) { if (!["BucketAlreadyOwnedByYou", "BucketAlreadyExists"].includes(error.name)) throw error; }
finally { storage.destroy(); }
console.log("Local database ready. Run npm run dev; read test emails at http://127.0.0.1:58025.");

export function validateEnvironment(env = process.env) {
  const missing = ["DATABASE_URL", "REDIS_URL", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "NEXTAUTH_URL"].filter(key => !env[key]);
  if (!env.NEXTAUTH_SECRET || env.NEXTAUTH_SECRET.length < 32) missing.push("NEXTAUTH_SECRET");
  if (!/^[a-f0-9]{64}$/i.test(env.ENCRYPTION_KEY || "")) missing.push("ENCRYPTION_KEY");
  if (missing.length) throw new Error(`Invalid environment: ${missing.join(", ")}`);
  return true;
}

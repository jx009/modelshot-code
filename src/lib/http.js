import { randomUUID } from "node:crypto";

export class AppError extends Error {
  constructor(code, status = 400, retryable = false) {
    super(code);
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

export function errorResponse(error) {
  const traceId = randomUUID();
  const known = error instanceof AppError;
  if (!known) console.error(JSON.stringify({ traceId, code: "INTERNAL_ERROR", type: error?.name }));
  const code = known ? error.code : "INTERNAL_ERROR";
  return Response.json({ code, error: code, message: code, retryable: known ? error.retryable : true, traceId }, {
    status: known ? error.status : 500,
  });
}

export function sameOrigin(request) {
  const origin = request.headers.get("origin");
  const expected = new URL(process.env.NEXTAUTH_URL || request.url).origin;
  if ((origin && origin !== expected) || request.headers.get("sec-fetch-site") === "cross-site") {
    throw new AppError("CROSS_ORIGIN_REQUEST", 403);
  }
}

export async function readBytes(request, limit) {
  if (Number(request.headers.get("content-length")) > limit) throw new AppError("PAYLOAD_TOO_LARGE", 413);
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new AppError("PAYLOAD_TOO_LARGE", 413);
      }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}

export async function readJson(request, schema, limit = 32_768) {
  sameOrigin(request);
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new AppError("JSON_REQUIRED", 415);
  const bytes = await readBytes(request, limit);
  let value;
  try { value = JSON.parse(bytes.toString("utf8")); } catch { throw new AppError("INVALID_JSON"); }
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError("INVALID_INPUT");
  return result.data;
}

export function clientAddress(request) {
  // Only a proxy which overwrites this header may enable forwarded address trust.
  return process.env.TRUST_PROXY === "true"
    ? (request.headers.get("x-forwarded-for")?.split(",")[0]?.trim().slice(0, 64) || "unknown")
    : "shared";
}

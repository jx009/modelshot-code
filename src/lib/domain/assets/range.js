import { AppError } from "../../http.js";

export function byteRange(header, length) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || !match[1] && !match[2]) throw new AppError("INVALID_RANGE", 416);
  const start = match[1] ? Number(match[1]) : Math.max(0, length - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(Number(match[2]), length - 1) : length - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= length) throw new AppError("INVALID_RANGE", 416);
  return { start, end };
}

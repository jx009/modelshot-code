import { encryptSecret, decryptSecret } from "../../crypto.js";
import { AppError } from "../../http.js";

// Bind inspected duration to the uploaded asset; client edits cannot bypass audio limits.
export function videoMediaProof(userId, id, info) {
  return encryptSecret(JSON.stringify({ purpose: "video-media", userId, id, type: info.type, duration: info.duration }));
}

export function assertVideoMedia(userId, media) {
  if (media.type === "image") return;
  try {
    const value = JSON.parse(decryptSecret(media.proof));
    if (value.purpose !== "video-media" || value.userId !== userId || value.id !== media.id || value.type !== media.type || value.duration !== media.duration) throw new Error("Invalid media");
  } catch { throw new AppError("VIDEO_MEDIA_INVALID", 422); }
}

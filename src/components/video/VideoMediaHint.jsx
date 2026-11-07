export const VIDEO_MEDIA_ACCEPT = "image/png,image/jpeg,image/webp,.mp4,.mov,.mp3,.wav,.m4a,.aac,.flac,.ogg";

export default function VideoMediaHint({ offer, zh }) {
  if (!offer?.mediaLimits) return null;
  return <small className="cr-creation-note">{offer.referenceMode === "first_frame"
    ? zh ? "按顺序添加首帧、尾帧，尾帧可选。此模式不接受参考视频或音频。" : "Add the first frame, then an optional last frame."
    : zh ? `参考素材上限：${offer.mediaLimits.image || 0} 张图片、${offer.mediaLimits.video || 0} 段视频、${offer.mediaLimits.audio || 0} 段音频。音频每段至少 1.8 秒，合计最多 30 秒。` : `References: up to ${offer.mediaLimits.image || 0} images, ${offer.mediaLimits.video || 0} videos, ${offer.mediaLimits.audio || 0} audio clips. Audio: at least 1.8s each, 30s total.`}</small>;
}

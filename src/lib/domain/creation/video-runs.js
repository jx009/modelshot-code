import { AppError } from "../../http.js";
import { videoShotSchema } from "../../creation/contracts/video-runs.js";
import { studioConfig, capabilities } from "../studio/providers.js";
import { videoInputError } from "../../video/model-protocols.js";
import { selectVideoVariant } from "../../video/variants.js";

// 旧版“逐镜生成视频”运行只保留重新报价，用于继续或重试已存在的运行；新运行使用分镜成片。
export async function priceVideoShots(steps, _provider, db) {
  const costs = [], providers = [], channels = new Map();
  for (const step of steps) {
    const shot = videoShotSchema.parse(step.params);
    if (!channels.has(shot.provider)) { const config = await studioConfig(db, shot.provider, "video", "video"); channels.set(shot.provider, { config, caps: await capabilities(db, config) }); }
    const { config, caps } = channels.get(shot.provider), tool = caps.tools.find(tool => tool.id === "video");
    if (!tool?.available) throw new AppError(tool?.reason || "TOOL_UNAVAILABLE", 503);
    if (!shot.params.prompt && !config.videoOptions?.promptOptional) throw new AppError("PROMPT_REQUIRED", 422);
    const error = videoInputError(config.videoOptions, { ...shot.params, hasImage: shot.params.media?.some(item => item.type === "image") });
    if (error) throw new AppError(error, 422);
    const selected = selectVideoVariant(config.videoOptions, shot.params.videoVariant);
    costs.push(selected.variant?.creditCost ?? tool.cost);
    providers.push(config.videoProvider || null);
  }
  return { costs, providers };
}

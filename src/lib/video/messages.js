const messages = {
  CREATION_WORKER_UNAVAILABLE: ["分镜任务服务暂时离线，计划已保留，请稍后重试。", "The storyboard worker is offline. Your plan is preserved; retry later."],
  CREATION_BUDGET_EXCEEDED: ["当前报价超过总预算，请调整预算后继续。", "The current quote exceeds the budget. Adjust the budget to continue."],
  CREATION_USER_QUEUE_FULL: ["已有创作计划进行中，请完成或停止该计划后继续。", "Another creation plan is active. Complete or stop it before continuing."],
  CREATION_RUN_CHANGED: ["计划进度已更新，请等待刷新后再操作。", "The plan changed. Wait for progress to refresh before continuing."],
  MOTION_SCENE_CHANGED: ["原镜头已被修改或删除，未覆盖新内容。可将此结果作为新片段加入工程。", "The original shot changed or was removed. Add this result as a new clip instead."],
  VIDEO_VARIANT_REQUIRED: ["请选择当前模型已支持的清晰度与声音组合。", "Choose a supported quality and audio combination."],
  VIDEO_VARIANT_UNSUPPORTED: ["上一模型的规格已保留，请选择当前模型支持的组合。", "Previous settings were preserved. Choose a combination supported by this model."],
  VIDEO_SUBMISSION_UNCONFIRMED: ["上次提交结果尚未确认，请恢复原任务后再提交新草稿。", "Recover the unconfirmed submission before submitting a new draft."],
  VIDEO_REPLACE_ONE_FILE: ["替换素材时一次请选择一个文件。", "Choose one file to replace this reference."],
  VIDEO_REPLACE_TYPE_MISMATCH: ["请使用相同类型的文件替换素材。", "Replace this reference with the same media type."],
  VIDEO_MEDIA_IN_USE: ["分镜正在使用此素材，请先在分镜中替换或移除。", "This media is used by the composition. Replace or remove it there first."],
  CREATION_NOT_ENABLED: ["当前账号暂未开放视频创作。", "Video creation is not enabled for this account."],
  TOOL_DISABLED: ["视频生成工具已停用，请管理员在工具配置中启用后刷新状态。", "Video generation is disabled. Ask an administrator to enable the tool, then refresh status."],
  VIDEO_ORIGIN_CHANGED: ["视频来源关联不一致，未覆盖原项目。请保留草稿并重新打开项目。", "The video source link does not match. Keep your draft and reopen the project."],
  WORKER_UNAVAILABLE: ["生成服务暂时离线，草稿会保留，请稍后重试。", "Generation is temporarily offline. Your draft is preserved."],
  SERVICE_NOT_CONFIGURED: ["尚未配置可用的视频模型。", "No video model is configured."],
  PROVIDER_CAPABILITY_UNSUPPORTED: ["所选模型暂不可用，请重新选择。", "The selected model is unavailable. Choose another model."],
  VIDEO_DURATION_UNSUPPORTED: ["当前模型不支持此时长，请重新选择。", "Choose a duration supported by this model."],
  VIDEO_RATIO_UNSUPPORTED: ["当前模型不支持此画幅，请重新选择。", "Choose an aspect ratio supported by this model."],
  VIDEO_REFERENCE_REQUIRED: ["请添加当前模型需要的参考素材。", "Add the references required by this model."],
  VIDEO_REFERENCE_UNSUPPORTED: ["当前模型不接收参考素材，请更换模型或移除素材。", "This model does not accept references. Change the model or remove the media."],
  VIDEO_REFERENCE_ROLE_UNSUPPORTED: ["素材用途不匹配，请重新分配用途或更换模型。", "Reference roles do not match. Reassign roles or choose another model."],
  VIDEO_FRAME_ORDER_INVALID: ["请先设置首帧，再设置尾帧，每个位置只能使用一张图片。", "Set one first frame before adding one last frame."],
  VIDEO_MEDIA_LIMIT: ["素材数量超出当前模型限制，请调整素材或更换模型。", "References exceed this model’s limits. Adjust media or choose another model."],
  VIDEO_AUDIO_DURATION_INVALID: ["音频每段至少 1.8 秒，合计不超过 30 秒。", "Audio must be at least 1.8s per clip and at most 30s in total."],
  VIDEO_FIELDS_INVALID: ["附加参数不适用于当前模型，请确认后清除。", "Extra settings are incompatible with this model. Review and clear them."],
  VIDEO_FIELDS_REQUIRED: ["请选择原视频或补齐当前模型所需的创作参数。", "Choose an original video or complete the required settings."],
  VIDEO_SOURCE_NOT_FOUND: ["原作品不可用，请选择同一视频服务账号下、接口兼容的已完成视频。", "Choose a completed video with a compatible API on the same upstream account."],
  VIDEO_MEDIA_CHANGED: ["素材已在另一处修改，请重新打开项目。", "Media changed elsewhere. Reopen the project."],
  VIDEO_MEDIA_INVALID: ["无法读取这段媒体，请检查文件或稍后重试。", "Could not read this media. Check the file or retry later."],
  VIDEO_MEDIA_TOO_LARGE: ["素材超出此操作的文件大小限制。", "The media file exceeds this operation’s size limit."],
  VIDEO_TOO_LONG: ["分镜最多 40 段，总长不能超过 180 秒。", "A composition supports up to 40 scenes and 180 seconds."],
  MOTION_TRIM_INVALID: ["片段时长或裁剪范围不符合分镜要求。", "The clip duration or trim does not fit the composition."],
  MOTION_RENDER_UNAVAILABLE: ["媒体处理服务暂不可用，原视频已保留。", "Media processing is unavailable. Your original video is preserved."],
  MOTION_RENDER_BUSY: ["媒体处理服务正在忙，请稍后重试。", "Media processing is busy. Try again shortly."],
  DOCUMENT_VERSION_CONFLICT: ["项目已在另一处更新，请重新打开后继续。", "The project changed elsewhere. Reopen it to continue."],
  DOCUMENT_NOT_FOUND: ["项目已删除或不可访问。", "The project was deleted or is unavailable."],
  PRICE_CHANGED: ["价格已更新，请查看新报价后重新提交。", "The price changed. Review the updated quote before submitting."],
  REQUEST_TIMEOUT: ["请求超时，输入已保留，请重试。", "The request timed out. Your input is preserved; retry."],
  INSUFFICIENT_CREDITS: ["积分不足，请查看余额。", "Insufficient credits. Check your balance."],
};

export function videoMessage(code, zh = true) {
  return messages[code]?.[zh ? 0 : 1] || (zh ? "操作暂未完成，输入已保留，请稍后重试。" : "The operation could not finish. Your input is preserved; retry later.");
}

const planStates = {
  queued: ["等待开始", "Queued"], running: ["正在生成", "Generating"],
  blocked: ["等待前一镜头", "Waiting for previous shot"], ready: ["准备提交", "Ready"],
  succeeded: ["已完成", "Completed"], failed: ["执行失败", "Failed"],
  awaiting_budget: ["等待确认预算", "Awaiting budget"], awaiting_input: ["等待处理", "Needs attention"],
  cancelling: ["正在停止后续镜头", "Stopping remaining shots"], cancelled: ["已停止", "Stopped"],
};
export function videoPlanStatus(status, zh = true) {
  return planStates[status]?.[zh ? 0 : 1] || (zh ? "正在同步状态" : "Syncing status");
}

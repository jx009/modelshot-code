# GPT-Best 视频适配范围

文档入口：https://gpt-best.apifox.cn/doc-5824160 ，本次按 2026-11-07 读取的公开接口说明实现。先完成吱吱鼠适配，再增加本协议；二者配置独立。

## 配置

后台「模型配置 → 视频模型 → 新增模型」选择「GPT-Best · 视频生成」，Base URL 填账号实际 API 域名，不能填 Apifox 文档域名。支持根域名或带 `/v1` 的前缀，生成和查询路径由接口选项确定。填写该账号实际可用的完整模型 ID 和密钥，每个模型独立配置时长、文生 / 图生能力和积分。

选择「GPT-Best 视频接口」，根据对应文档选择统一格式或原生格式。可配置附加 JSON 参数，例如 `{"resolution":"480p","generate_audio":true}`；万相原生的分辨率应写在 `parameters` 内。动态的模型、提示词、时长、比例和上传素材会覆盖相应字段，其他嵌套配置保留。附加配置不允许密钥、授权头、token 或原型键，不向普通用户公开配置正文。

模板、镜头、原任务 ID 等会在创作参数中显示独立输入框，也可由管理员配置默认值。Remix、Luma 延长及可灵视频 ID 只能引用当前账号、当前通道已成功生成的作品。视频结果的「任务信息」可复制任务和视频 ID。

## 已实现的生成链路

以下均包含请求体转换、任务 ID 保存、异步查询、状态转换和结果取回；没有用同一个请求格式替代所有协议。

| 系列 | 生成方式 | 查询与取回 |
| --- | --- | --- |
| 统一格式 | Veo、Wan、Grok、Seedance 1 / 2、Sora 2、故事板、角色 | `/v2/videos/generations/{id}`，解析 `data.output/outputs` |
| 标准 Videos | Sora 表单、Remix、Grok 1.5 表单、MiniMax H3 表单、Veo Omni 多文件表单、Wan 3 JSON | `/v1/videos/{id}`，URL 或带认证的 `/content` |
| Higgsfield | generate、speech、ads；模板字段可配置或填写 | POST feed，解析 jobs/result |
| PixVerse | 文生、图生 | GET feed 的 task_id 查询参数 |
| Luma | generations、generations_sync、extend | generations/{id}，解析 video.url/download_url |
| Runway | 官方 image_to_video；简化 generate、video2video、Act Two、Aleph | 官方 tasks 或 POST feed；官方请求带版本头 |
| Pika | 文生 / 图生 / 视频输入及特效参数 | feed/{id}，解析 videos[].resultUrl |
| MiniMax | 文生、首帧、首尾帧 | query/video_generation；成功后再 files/retrieve |
| Vidu | text2video、img2video、reference2video、start-end2video | tasks/{id}/creations |
| Seedance 原生 | 文本和图像 / 视频 / 音频 content | contents/generations/tasks/{id}，同时支持对象和数组结果 |
| Grok XAI 原生 | 文生、图生、多图参考、编辑、延长 | videos/{request_id}，解析 video.url |
| 万相原生 | 文生、首帧、首尾帧、多图、动作迁移、换人、AnimateAnyone、S2V、EMO、LivePortrait、Emoji、通用编辑、VideoRetalk、风格重绘 | `/qwen/api/v1/tasks/{id}`，提交带异步头 |
| 可灵原生 | 文生、首尾帧、多图、Omni、动作控制、视频延长、数字人、音频对口型、特效 | 对应视频接口查询；lip-sync 查询 advanced-lip-sync |

参考素材沿用吱吱鼠的临时授权链接和所有权校验。普通原生接口接收 URL；标准 Sora 输入 PNG 文件，Veo Omni 接收多个真实文件，总量限制 100 MiB、最多七项。参考音视频上传需要现有 tools 的媒体检测服务。任务轮询每 30 秒执行一次，不在查询失败后重新提交生成；下载结果继续使用已有 HTTPS、地址校验、大小限制和 MP4 校验。

## 未计为完整兼容的条目

- 清影 `/cogvideox/v4`：公开文档的请求与响应 schema、示例均为空，不能据此确认参数和结果契约，暂不提供可选通道。
- 新版可灵 3.0 / Turbo / Omni：生成文档存在，但通用 `/kling/tasks` 查询位于「123、未开放」，状态 developing，且写成带 JSON body 的 GET。暂不冒用旧版查询接口；旧版可灵仍按其已公布协议处理。
- 可灵多模态选区编辑：多处生成 / 选区接口 schema 复制了文生视频字段，无法确认完整选区工作流。暂不提供选区编辑入口。
- 原生 EMO / Emoji 需要当前图片检测出的 `face_bbox`、`ext_bbox`，AnimateAnyone 需要有效 `template_id`。缺失时在预留积分前拒绝；本次未实现人脸检测和动作模板生成的交互流程，不会套用虚构的检测结果。
- 角色创建、素材上传管理、模板 / 音色列表、检测、批量查询等辅助 API 不作为视频生成模型暴露。角色、模板、素材 ID 可通过文档规定的附加参数传入；本次不新增供应商资源管理界面。
- Sora Chat Completions 是同步文本中返回视频链接，缺少可恢复的视频任务 ID；本次使用同文档中的异步 Sora 接口，没有将 chat completion ID 作为视频任务 ID。
- 文档标注「开发接入请勿对接」的旧 Luma 兼容接口不作为正常选项；Luma 查询路径中的 `/BASE_URL` 占位符未拼入实际请求。
- 部分旧例子返回 HTTP 视频地址；下载器继续要求 HTTPS，不为旧例子放开内网或明文下载。

上表表示代码链路已实现，不代表所有型号已在线验证。各型号实际开放权限、参数组合和时长仍以供应商账号及该型号说明为准。

## 验证与上线

本地仅按仓库 AGENTS.md 执行改动文件 ESLint 和 diff 检查；已补充协议请求、查询方法、任务 ID、状态、取文件、凭据保护、素材限制和临时链接回归用例，未运行测试、构建或真实付费请求。需在 CI / 资源充足的环境执行这些用例；更新 web、worker、tools 后配置真实通道验证。没有数据库迁移，也没有自动启用、自动收费或推送部署。

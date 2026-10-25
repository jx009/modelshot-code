# PPT 模型接口 524 诊断与流式接收

## 线上证据

用户提供的 creation-language 日志中，两条 slides.page 请求于 2026-10-25 18:49:52 UTC 失败（北京时间 2026-10-26 02:49:52）：

- `6d91ed3b-540e-4b66-9c32-2184da4003b7`：`LANGUAGE_PROVIDER_UNAVAILABLE`，HTTP 524。
- `3d2d294f-78c1-44db-88f4-9c11ab1c4b90`：同上。

这次确认的是语言请求收到 HTTP 524，不是此前泛化的结果格式错误。日志未含请求起始时间或网关响应头，不能据此确定精确等待秒数、是哪个代理发出了 524、是否因为并发或供应商负载，也不能反推更早三次失败的原因。

Cloudflare 官方对 524 的解释是代理已连接源站，但读响应或写请求超时。当前文档的读超时默认值为 125 秒，写超时也可能返回同一码；本次缺少响应体，不能直接认定是哪一种。

参考：https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-524/

## 针对性调整

- 仅 `slides.page` 改用 Chat Completions 的 `stream: true`，增量收取 `delta.content`；其他创作调用保持既有方式。完整生成前不发布任何局部 HTML，仍通过既有结果和安全校验。
- 保留两页并发、SDK 的 `maxRetries: 0` 和现有 180 秒总执行上限。若代理在中途提前断开，单纯增加本地超时无法延长它自己的期限。
- 必须收到 `finish_reason: stop`；拒绝截断、拒答、工具调用或超限结果。收取完成或失败均释放流；调用方取消时不接受 SDK 可能返回的前缀。
- 不自动降级并再次调用非流式接口，不重复已提交的付费请求。兼容接口若不支持流式，需要调整该通道；不会偷偷重发。
- HTTP 504/524 映射为 `LANGUAGE_PROVIDER_GATEWAY_TIMEOUT`，页面提供明确中文提示。
- 错误日志增加 requestMode、elapsedMs、firstChunkMs（如有）、chunksReceived、contentBytes。不记录提示词、正文、推理内容、接口地址或认证信息。

参考：https://developers.openai.com/api/docs/guides/streaming-responses

## 边界与验证

流式能提前接收输出，但不保证解决供应商侧排队、长时间无首包、代理缓冲或其他上游故障。如果仍然 524，需结合新增诊断和供应商网关日志继续查。网站自身是否经过 Cloudflare 不能说明模型 API 地址的代理配置。

补充流式分片、终止标记、拒答、取消、大小上限、524 分类和禁止重复请求的回归用例。遵循 AGENTS.md，仅运行改动文件 ESLint 和 git diff --check；不运行测试套件、构建、服务或真实付费调用。本轮没有推送或部署。

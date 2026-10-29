# 生图渠道配置

后台「模型配置 → 生图模型 → 新增模型」支持以下原生协议，均使用服务端保存的加密 API Key，无需新增环境变量或数据库迁移。

| 渠道 | 配置预设 | 模型 | 默认 Base URL |
| --- | --- | --- | --- |
| 阿里百炼 | 阿里百炼 · Qwen 生成与编辑 | `qwen-image-2.0-pro` | `https://dashscope.aliyuncs.com` |
| 火山方舟 | 火山方舟 · Seedream | 填写已开通的 Seedream 模型 ID 或 Endpoint ID | `https://ark.cn-beijing.volces.com/api/v3` |
| MiniMax | MiniMax · Image-01 文生图 | `image-01` | `https://api.minimax.cn/v1` |

保存并启用后，模型通过现有工作区能力接口进入生图模型列表，并使用配置的单次积分及分辨率加价。支持设置默认模型。API Key、实际模型 ID 和上游地址不会通过用户的模型列表暴露。

## 协议与能力

- 阿里沿用 DashScope 原生多模态接口 `POST /api/v1/services/aigc/multimodal-generation/generation`，不是 OpenAI Images 接口。编辑专用 Qwen 预设仍用于工具渠道，不进入公开生图列表。
- 火山沿用方舟原生 `POST /images/generations`。显式低于现有适配器最小像素数的尺寸会被拒绝；旧项目尺寸保留原有自动提升行为。
- MiniMax 使用原生 `POST /v1/image_generation`，Bearer 鉴权，单次生成一张，解析 `data.image_base64`，兼容通过安全下载器读取 `data.image_urls`。
- MiniMax 本次仅接入 `image-01` 文生图，不接入 `image-01-live`、主体参考生图或图像编辑，不会把参考图静默丢弃。界面不提供工具或语言用途，服务端也拒绝不匹配的配置。
- MiniMax 宽、高各需在 512–2048 像素之间且为 8 的倍数。现有三种旧尺寸可用，`1:1@2K` 可用，`16:9@2K`、`8:1@1K`、所有 4K 不可用。不支持的尺寸在任务预扣积分前拒绝，不会静默降分辨率。
- MiniMax 提示词必须非空且最多 1500 字符，在任务预扣积分前检查，不自动截断。上游 HTTP 200 中的非零 `base_resp.status_code` 也作为失败处理，不会误存为成功结果。
- MiniMax 地址可填写域名、带 `/v1` 的前缀，或完整 `/v1/image_generation` 地址；也可配置可信代理地址。不同地区的密钥应配对应的服务地址。

后台「测试功能」会真实调用上游并产生费用；部署后使用自己的密钥手动验证。此改动没有执行真实供应商调用。

## 验证

新增 `tests/unit/image-provider-adapters.test.mjs` 覆盖三个原生协议、MiniMax 业务错误/空结果/尺寸拒绝、模型列表和编辑能力隔离；后台交互覆盖位于 `tests/unit/admin-providers-loading.test.jsx`。

按服务器资源约定，本地仅做改动文件的静态校验，不运行测试套件、构建或开发服务。以下命令交由 CI 或资源充足的环境执行：

```sh
npx vitest run --project unit tests/unit/image-provider-adapters.test.mjs tests/unit/admin-providers-loading.test.jsx tests/unit/studio-cloud.test.mjs tests/unit/studio-routing.test.mjs tests/unit/image-size.test.mjs
```

## 官方协议参考

- 阿里 Qwen 图像 API：`https://help.aliyun.com/zh/model-studio/qwen-image-api`
- MiniMax 文生图 OpenAPI：`https://platform.minimaxi.com/docs/api-reference/image-generation-t2i.md`

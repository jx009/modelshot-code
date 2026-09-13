# ModelShot

面向电商卖家、品牌和视觉团队的 AI 商品视觉生产 Agent。用户上传商品与参考素材，用自然语言描述目标；系统自动拆解主图、详情页、营销海报、参考图复刻、商品精修或服装试穿任务，展示完整生产计划与报价，经确认后批量生成、逐图质检并按用途导出。

当前交付范围为 V1 开发候选版本。真实供应商效果、支付、OAuth、云部署与商业授权验收仍按约定延期，详见 [延期验收清单](docs/real-environment-acceptance.md)。

## 本地启动

需要 Node.js 22.23.2（见 `.nvmrc`）、npm 10.9.2、Python 3.11、Docker Desktop/Linux containers。

```bash
npm ci
npm run setup:local
npm run db:seed
npm run dev
```

另开一个终端启动持久任务 Worker：

```bash
npm run worker
```

工作台：http://127.0.0.1:3000/zh/studio 。邮件捕获：http://127.0.0.1:58025 。

`setup:local` 生成本地随机密钥并建立数据库、Redis、私有 bucket 和版本化迁移，不覆盖已有环境文件或清空开发数据。种子只启用实际存在图片的模特预设，支持上传自己的模特素材。供应商须配置有效凭据后才能生成，开发页面不使用假结果。

| 服务 | 回环端口 |
| --- | --- |
| PostgreSQL | 55432 |
| Redis | 56379 |
| S3 / 控制台 | 59000 / 59001 |
| SMTP / 邮件控制台 | 51025 / 58025 |

## 已实现的工作流

- 对话式商品简报：用户用自然语言持续补充目标、平台、风格和限制，Agent 自动识别意图并形成可确认的生产计划，无需搭建 Dify 或 ComfyUI 节点。
- 电商上新套图、商城主图、多屏详情页、营销海报裂变、参考图复刻和商品精修；服装模特套图与单张试穿作为专项工作流保留。
- 商品主图与细节、风格、版式、场景参考图分工明确；商品事实只来自用户确认内容，参考图不覆盖商品身份。
- 邮箱身份与 Google OAuth 接线，供应商密钥仅由管理员统一配置并由 Worker 在服务端读取。
- 私有素材、项目/SKU 草稿、版本冲突保留与配置复用。
- 服务端报价、原子预留、按产物结算、取消、租约恢复和未知结果对账。
- 不可变参数快照、能力校验、精确像素交付、独立 QA/元数据步骤、人工复查。
- 图库服务端分页与跨页选择、异步 ZIP、CSV/JSON 清单、失败重试与过期重建。
- 统一 USD 价格目录、支付事件收件箱、订阅周期与变更、退款/争议和佣金调整。
- 账户账单及素材管理、后台权限与审计、任务/支付异常处理、存活及就绪探针。

支付、自动 QA 和 C2PA 默认禁用，通过对应真实验收后再启用。原生 C2PA 为可选依赖，缺失时默认无签名构建仍可运行，显式启用时会拒绝缺失原生包或证书的配置。

## 验证

```bash
npx playwright install chromium
npx prisma generate
npm run test:acceptance
npm run test:recovery
npm run test:capacity
npm run check:dependencies
```

验收使用独立 `modelshot_test`、Redis database 1、测试 bucket、3100 端口 Web 和 3199 端口本地供应商，启动实际 Worker。测试不调用真实付费供应商。浏览器测试会清空专用测试库，禁止放入需保留的数据；不会清空开发库。

单项命令为 `test:unit`、`test:integration`、`test:e2e`。浏览器报告在 `playwright-report/`，截图、审计、恢复和容量报告在 `test-results/`。GitHub Actions 执行相同开发验收流程。

## 架构与运维

push 到 main 或 v* tag 会触发多架构 Docker 镜像构建并推送 Docker Hub。首次使用需配置 `DOCKERHUB_USERNAME`、`DOCKERHUB_TOKEN` Secrets，以及指向已创建仓库的 `DOCKERHUB_IMAGE` Variable。标签、签名及 Web/Worker 启动方式见 [Docker 发布说明](docs/docker-publishing.md)。

Next.js / React / next-intl + Prisma / PostgreSQL 模块化单体，BullMQ / Redis 独立 Worker，私有 S3 兼容存储。PostgreSQL 保存任务、预留、账本、支付事件和 Outbox；队列可由数据库重建。

- `src/lib/domain/`：身份、素材、生成、支付和运维规则。
- `src/lib/infra/`：队列、存储和环境检查。
- `src/workers/`：调度、执行、恢复与清理。
- `prisma/migrations/`：空库可重放的结构迁移。
- `tests/`：单元、真实本地服务集成、浏览器与故障夹具。

[开发方案](docs/development-plan.md) · [开发记录](docs/development-progress.md) · [运行与恢复手册](docs/operations.md) · [延期验收清单](docs/real-environment-acceptance.md)

生产构建使用 `npm run build`、`npm start` 及独立 `npm run worker`。部署前应用迁移，不使用 `db push` 替代正式迁移。`npm run infra:down` 停止本项目容器并保留数据卷。

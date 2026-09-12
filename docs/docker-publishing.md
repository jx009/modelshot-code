# Docker 镜像发布

参考 `new-api-new` 的发布流程：AMD64/ARM64 原生 runner 分别构建和推送，合并多架构 manifest，附 SBOM、构建来源和 Cosign 无密钥签名。此流程只发布镜像，不会自动重启服务器。

## GitHub 配置

在本仓库 Settings → Secrets and variables → Actions 设置：

| 类型 | 名称 | 值 |
| --- | --- | --- |
| Secret | `DOCKERHUB_USERNAME` | 有权推送的 Docker Hub 用户名 |
| Secret | `DOCKERHUB_TOKEN` | Docker Hub Access Token，需要目标仓库写权限 |
| Variable | `DOCKERHUB_IMAGE` | 必填，Docker Hub 中已经创建且 Token 有写权限的完整仓库名，如 `your-docker-id/modelshot` |

用户名/Token 不会从参考项目复制，也不提交到源代码。Docker Hub 用户名经常与 GitHub 仓库所有者不同，因此不再自动猜测命名空间。先在 Docker Hub 创建目标仓库，再让 `DOCKERHUB_IMAGE` 与其 `namespace/repository` 完全一致；组织仓库填写组织命名空间，并确保 Token 所属账号有该组织仓库的写权限。prepare 阶段会向 Docker Registry 请求目标仓库的 push scope，在实际构建前明确拦截仓库不存在、命名空间错误或无写权限的情况。

## 触发与标签

- push 到 `main`：自动发布 `latest`、`main`、`sha-<完整提交 SHA>`。
- push `v*` Git tag：自动发布原 tag 及 `sha-<完整提交 SHA>`，不会用预发布 tag 覆盖 `latest`。
- Actions 手动 Run workflow：构建界面选择的分支/ref，发布相应 ref 和 SHA 标签；仅 main 更新 latest。
- Pull request 不发布镜像；既有开发验收 workflow 继续独立运行。镜像发布与开发验收并行，不表示验收成功后才发布。

每次运行先写带 SHA/run ID/attempt 的架构临时标签，两个架构成功后合并公共标签，避免混合两次运行的架构镜像。不同架构缓存独立，最终标签可用于 x86_64 和 ARM64 主机。Actions summary 可查看镜像 digest；生产建议固定 `sha256` digest 部署。

## 运行

同一镜像支持 Web、Worker、迁移和运维命令。部署环境文件需自行提供数据库、Redis、私有 S3、登录地址及随机密钥。容器中的 localhost 指容器自身，应使用 Docker 网络服务名或实际服务地址。不要将本地 `.env` 打进镜像。

```bash
# 发布前执行一次，使用专用迁移数据库账号。
docker run --rm --env-file .env.production yourname/modelshot:latest migrate

docker run -d --name modelshot-web --restart unless-stopped \
  --env-file .env.production -p 3000:3000 yourname/modelshot:latest

docker run -d --name modelshot-worker --restart unless-stopped \
  --env-file .env.production --stop-timeout 180 yourname/modelshot:latest worker

docker run --rm --env-file .env.production yourname/modelshot:latest ops status
```

Web 与 Worker 需要相同的存储和密钥配置，Worker 必须独立运行。镜像以非 root 用户执行，不内置数据库或 Redis，也不在每个 Web 副本启动时自动迁移。`/api/health` 为 Web 存活，`/api/ready` 还检查外部服务和 Worker 心跳。

## 本地构建

```bash
docker build -t modelshot:local .
docker run --rm modelshot:local node --version
docker run --rm modelshot:local node node_modules/prisma/build/index.js version
```

镜像包含 Next.js 生产构建、生产依赖、Worker 和迁移文件。Prisma CLI 保留为生产依赖，以便发布时执行同版本迁移。`.dockerignore` 排除环境密钥、用户公开上传旧目录、IDE 文件和测试产物。默认官方 Node Debian slim 基础镜像，也可通过 `--build-arg NODE_IMAGE=...` 指定受信任的等价 Node 22 镜像。

发布镜像固定为无 C2PA 签名构建，设置 `C2PA_ENABLED=1` 会在启动时明确拒绝，避免 Web 与 Worker 签名行为不一致。真实签名仍需专门构建与验收。Docker 镜像的 Cosign 签名属于软件供应链签名，与生成图片的 C2PA 无关。

## 本地验证记录（2026-09-11）

- workflow 通过 actionlint，入口脚本通过 shell 语法检查。
- Linux AMD64 镜像在无数据库连接、无部署密钥的构建环境中成功生成；管理后台鉴权在请求阶段执行，避免打包依赖数据库。
- 容器以 UID 1000 运行；Sharp 图片处理、Prisma 7.10.0 CLI、迁移检查和 `ops status` 均通过。
- 独立 Web/Worker 容器连接本地测试数据库、Redis 与 MinIO 后，中英文工作台、`/api/health`、`/api/ready`、匿名 session 均返回 200；匿名后台访问返回登录重定向。
- 检查确认运行镜像没有 `.env`、`.env.local`、`.git` 或 `public/uploads`。测试后已移除临时 Web/Worker 容器。

本机 Docker Hub 镜像加速器不可用，因此本地验证通过 `NODE_IMAGE` 使用官方 Node 在 Amazon ECR Public 的等价镜像，并传入本机 HTTP/HTTPS 代理构建参数；发布 workflow 仍使用 Docker Hub 官方 Node 镜像。ARM64 构建、Docker Hub 实际推送与 Cosign 签名需由 GitHub Actions 在配置 Secrets 后验证，本地结果不代表这些远端步骤已成功。

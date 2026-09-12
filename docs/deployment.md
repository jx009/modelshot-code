# 服务器部署

对应 `compose.prod.yaml` + `.env.production.example`。本地开发继续用 `compose.yaml`，两套编排文件互不影响。

## 文件

| 文件 | 作用 |
| --- | --- |
| `compose.prod.yaml` | 生产编排：PostgreSQL、Redis、MinIO、一次性迁移、Web、Worker 和运维工具 |
| `.env.production.example` | 变量模板，复制成 `.env.production` 后填写，不进版本库 |
| `docker/create-bucket.mjs` | 创建私有 bucket 的一次性脚本，用镜像里已有的 `@aws-sdk` |

## 前置

服务器需要 Docker Engine 24+ 和 Compose v2，至少 2 核 4G、20G 可用磁盘；镜像构建阶段要能拉取 npm 包。不需要在服务器上装 Node。

## 1. 准备代码与变量

```bash
git clone <仓库地址> modelshot && cd modelshot
cp .env.production.example .env.production

# 四个密码各自独立生成，只用 hex，因为会被拼进连接串
openssl rand -hex 24   # POSTGRES_PASSWORD
openssl rand -hex 24   # STORAGE_ROOT_PASSWORD
openssl rand -hex 32   # NEXTAUTH_SECRET
openssl rand -hex 32   # ENCRYPTION_KEY
```

`ENCRYPTION_KEY` 必须是 64 位小写 hex，长度不对 `/api/ready` 会一直 503。

模板里**必须改**的只有下面四项，其余留空不影响启动：

| 变量 | 不改会怎样 |
| --- | --- |
| `PUBLIC_URL` | 留成 `example.com` 会让所有 POST 接口返回 403。`readJson` 会调用 `sameOrigin`，拿 `NEXTAUTH_URL` 当期望 origin 和浏览器实际 origin 比对，对不上就抛 `CROSS_ORIGIN_REQUEST`。登录、注册、提交生成全部失败。 |
| `SMTP_HOST` + `SMTP_FROM` | 注册强制要求 6 位邮箱验证码，验证码只能走 SMTP 发送。不配就无法注册账号 → 无法创建 root → 后台进不去。`SMTP_PORT=587` 表示 STARTTLS，用 465 才是隐式 TLS（`secure` 由端口自动判断）。内网 relay 允许匿名投递时可留空 `SMTP_USER` / `SMTP_PASS`。 |
| `BIND_ADDR` | 默认 `127.0.0.1` 只允许宿主机访问，必须在前面挂 Nginx/Caddy。不打算装反代就改 `0.0.0.0`。 |
| `TRUST_PROXY` | 只有前面确实挂着会覆盖 `X-Forwarded-For` 的反代时才留 `true`。否则客户端可以伪造这个头，`clientAddress()` 会采信，限流和审计记录里的 IP 全是假的。裸跑公网请改 `false`。 |

`DATABASE_URL`、`REDIS_URL`、`S3_*` 不在模板里：它们由 `POSTGRES_*` / `STORAGE_*` 在编排文件里推导，避免同一份密码写两处导致对不上。

### 还没买域名时先跑起来

`PUBLIC_URL` 必须和浏览器地址栏的 origin 完全一致（含端口），所以没域名也能跑，用公网 IP 顶替：

```ini
PUBLIC_URL=http://服务器公网IP:3000
TRUST_PROXY=false
BIND_ADDR=0.0.0.0
```

改 `BIND_ADDR=0.0.0.0` 之后记得放通云服务器安全组的 3000 端口，否则外网访问不到。

这个组合能正常注册、登录、上传和生成，但有三个代价：**没有 HTTPS**（登录密码明文传输，仅适合上线前自测）、**Google 登录用不了**（Google 要求重定向地址是 HTTPS）、**支付回调不可用**（`PAYMENTS_ENABLED` 本来就是 0）。建议同时限制安全组只放通你自己的 IP。

买到域名并配好 TLS 之后，改成下面三行再重启容器即可，不需要重新构建镜像：

```ini
PUBLIC_URL=https://你的域名
TRUST_PROXY=true
BIND_ADDR=127.0.0.1
```

换地址会让已有登录会话失效，需要重新登录，这是预期行为。

不想买域名又要立刻上 HTTPS，可以用 Caddy 加 `sslip.io` / `nip.io` 这类把 IP 编码进主机名的通配 DNS，Caddy 能自动签发 Let's Encrypt 证书。但这依赖第三方 DNS 服务、有速率限制，只当临时方案，不要用于正式运营。注意 `PUBLIC_URL` 需要跟着写成 `https://<编码后的IP>.sslip.io`。

## 2. 启动

必须带 `--env-file`，Compose 的变量替换读的是它，不是项目里的 `.env`：

```bash
docker compose --env-file .env.production -f compose.prod.yaml up -d --build
docker compose --env-file .env.production -f compose.prod.yaml ps
```

想省参数可以在服务器 shell 里导出：

```bash
export COMPOSE_FILE=compose.prod.yaml COMPOSE_ENV_FILES=.env.production
```

本文档后续命令都省略了 `-f compose.prod.yaml --env-file .env.production`；没导出上面两个变量的话请自行补上，漏了 `--env-file` 会拿不到数据库和存储密码。

启动顺序由依赖条件保证：`postgres` / `redis` / `storage` 健康 → `storage-init` 建 bucket → `migrate` 应用迁移并成功退出 → `web` 和 `worker` 启动。`migrate` 是独立一次性服务，不会在每个 Web 副本里自动跑迁移，也不会用 `db push` 顶替正式迁移。

## 3. 首次初始化

```bash
# 供应商、预设模特、场景、提示词模板（幂等，可重复执行）
docker compose --profile tools run --rm seed
```

浏览器注册第一个账号，然后提权为 root：

```bash
docker compose --profile tools run --rm admin you@example.com --role=root
```

`make-admin.js` 随镜像发布（Dockerfile 里连同 `scripts/ops.mjs` 一起复制），所以拉镜像部署时服务器上不需要源码。提权命令的参数会作为 CMD 透传给镜像的 `entrypoint`，直接跑即可。

如果镜像还不包含该脚本（`Cannot find module '/app/scripts/make-admin.js'`），说明用的是旧镜像，可以先用数据库直接改角色的等价写法：

```bash
docker compose --env-file .env.production -f compose.prod.yaml exec -T postgres \
  psql -U modelshot -d modelshot -c "UPDATE \"User\" SET role='root' WHERE email='you@example.com';"
```

**不要**给 admin 服务挂载 `./scripts/make-admin.js`：宿主机路径不存在时 Docker 会创建一个同名空目录，反过来把镜像里的文件遮住。

## 4. 反向代理与 HTTPS

Web 默认只绑 `127.0.0.1:3000`，由宿主机 Nginx/Caddy 终止 TLS 再转发。反代要透传 `Host`、`X-Forwarded-For`、`X-Forwarded-Proto`，并把 `PUBLIC_URL` 设为对外域名、`TRUST_PROXY=true`。不想装反代就把 `BIND_ADDR` 改成 `0.0.0.0`，但这样没有 TLS，登录 Cookie 和支付回调都不安全，不建议长期这么跑。

不要在 `PUBLIC_URL` 里带结尾斜杠或容器端口。

## 5. 验证

```bash
curl -s http://127.0.0.1:3000/api/health    # Web 存活
curl -s http://127.0.0.1:3000/api/ready     # 配置、数据库、Redis、私有存储、Worker 心跳
```

`/api/ready` 会检查 60 秒内的 Worker 心跳，只启动 Web 不启动 Worker 时它会返回 503，这是预期行为。就绪失败不会返回内部连接信息。

## 日常运维

```bash
# 运维状态：队列积压、最老等待、Outbox 延迟、未知结果、长期预留、支付错误、Worker 心跳
docker compose --profile tools run --rm ops ops status
docker compose --profile tools run --rm ops ops reconcile   # 账务对账，失败退出码 1
docker compose --profile tools run --rm ops ops recover     # Redis 丢失或 Worker 中断后恢复调度
docker compose --profile tools run --rm ops ops cleanup     # 清理已标记删除且过期的对象
```

升级：拉新代码后 `up -d --build`，迁移会自动重新执行。发布版本建议固定镜像 digest，不要用浮动 tag。

备份：`postgres-data`、`storage-data` 两个卷必须作为一套可恢复资源一起备份，并单独保管 `.env.production` 里的 `NEXTAUTH_SECRET` 和 `ENCRYPTION_KEY` —— 密钥丢了，已加密的供应商凭据无法还原。

停止与销毁：

```bash
docker compose --env-file .env.production -f compose.prod.yaml down      # 保留数据卷
docker compose --env-file .env.production -f compose.prod.yaml down -v   # 连数据一起删，谨慎
```

## 已知限制

- `NEXT_PUBLIC_SITE_URL` 影响 `sitemap.js` / `robots.js`，这两个在构建期读取，目前 Dockerfile 没有暴露对应构建参数，站内会回落到默认域名。需要自定义时得给 Dockerfile 加一个 build arg。
- Redis 未设密码，仅靠 Compose 内部网络隔离，端口不对宿主机开放。要求更高可自行加 `--requirepass` 并同步改 `REDIS_URL`。
- 发布镜像固定为无 C2PA 签名构建，`C2PA_ENABLED=1` 会在启动时被入口脚本拒绝，真实签名需要另有专门构建与验收。
- 支付（`PAYMENTS_ENABLED`）、自动 QA（`QA_ENABLED`）默认关闭，通过各自真实验收后再打开。

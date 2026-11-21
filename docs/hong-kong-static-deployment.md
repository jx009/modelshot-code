# 香港入口：DNS 分流与反代

海外用户通过香港节点访问，国内用户直连国内源站。两者共用同一个域名 `www.letaidraw.cn`，由 DNSPod 分线路解析决定去向。

```text
www.letaidraw.cn
├─ 大陆用户  → 114.132.181.241（国内源站，直连，不经跨境）
└─ 海外用户  → 43.161.195.225（香港 Nginx 反代 → 回源国内源站）
```

香港不运行 Next.js、数据库和存储，只做反向代理和静态资源本地读取。应用本身始终在国内源站执行。

## 为什么必须共用一个域名

不是图省事，是代码和协议层面的硬约束：

- `src/lib/request-origins.js` 只信任 `NEXTAUTH_URL` 及其 `www`/裸域别名，其他域名必须写进 `ALLOWED_ORIGINS`，否则所有写入接口返回 `CROSS_ORIGIN_REQUEST`。
- NextAuth v4 的会话 Cookie 是 host-only（不设 `domain`），且带 `www` 与不带 `www` 是两个独立 Cookie。换域名意味着重新登录。
- `NEXTAUTH_URL` 只能有一个值，Google OAuth 回调、Stripe 回跳、视频参考资源的绝对 URL 都由它拼出。

因此香港节点必须使用与国内源站完全相同的 `server_name`。**不要**为海外单独申请域名。

## DNS 分流配置

DNSPod 记录（`www` 与 `@` 各一组）：

| 主机记录 | 线路 | 记录值 | 说明 |
| --- | --- | --- | --- |
| `@` / `www` | 默认 | 国内源站 IP | 未命中任何线路时的兜底，**必须留在国内** |
| `@` / `www` | 境外 | 香港 IP | 海外流量入口 |

线路名称以账号实际提供的为准。若只有「默认 / 港澳台 / 亚洲 / 欧洲 / 北美…」这类细分线路，则把「境外」以及各细分线路逐条指向香港，仅「默认」保留国内 IP。

**「默认」指向国内是刻意设计的降级方向。** 分线路解析依据的是递归解析器的归属地，无法保证 100% 准确；故意配反的代价是海外用户打不开（红色证书警告或超时），配成现在的方向，最坏情况只是国内用户绕道香港变慢，仍然可用。

TTL 建议 `300`。设成 `600` 会让切换 IP 后的生效窗口延长到 10 分钟。

### 已知局限

- 解析器是否携带 EDNS Client Subnet 决定判断精度。`1.1.1.1` 不携带 ECS，按解析器所在地判断，通常仍落到境外线。
- 海外用户手动把 DNS 设成国内 DNS、或企业内网 DNS 走国内出口时，会拿到国内 IP 并访问国内源站。这部分流量极小，不做额外处理。

### 验证

```bash
# 境外视角
curl -s "https://dns.google/resolve?name=www.letaidraw.cn&type=A" -H "accept: application/dns-json"
```

应返回香港 IP。国内视角用运营商 DNS 查询应返回国内 IP。

## 香港 Nginx 配置

配置位于香港服务器的站点配置文件（宝塔：`/www/server/panel/vhost/nginx/html_www.letaidraw.cn.conf`），版本库不持有线上副本。以下为完整内容。

顶部三块属于 `http {}` 上下文，宝塔的 vhost 文件本身就在 `http {}` 内，可直接写在这里：

```nginx
upstream letaidraw_cn_origin {
    server 114.132.181.241:443;
    keepalive 32;
}

map $http_upgrade $letaidraw_connection_upgrade {
    default upgrade;
    ''      close;
}

proxy_cache_path /www/server/nginx/proxy_cache/letaidraw_cn_static
    levels=1:2 keys_zone=letaidraw_hk_cn_static:32m
    max_size=2g inactive=30d use_temp_path=off;
```

区名与目录必须与 `www.letaidraw.com` 站点使用的 `letaidraw_hk_static` 区分。`proxy_cache_path` 的区名全局唯一，重名会直接导致 `nginx -t` 失败：

```text
[emerg] the size 20971520 of shared memory zone "letaidraw_hk_static"
conflicts with already declared size 33554432 in .../html_www.letaidraw.com.conf:14
```

`map` 变量同样加了前缀，避免与其他站点的同名 map 冲突。

`server` 块的关键部分：

```nginx
server {
    listen 80;
    listen 443 ssl;
    listen 443 quic;
    listen [::]:443 ssl;
    listen [::]:443 quic;
    http2 on;
    http3 on;
    listen [::]:80;
    server_name www.letaidraw.cn letaidraw.cn;
    root /www/wwwroot/www.letaidraw.cn;

    include /www/server/panel/vhost/nginx/extension/letaidraw.cn/*.conf;
    include /www/server/panel/vhost/nginx/well-known/letaidraw.cn.conf;

    # 80 → 443，保留 .well-known 例外供证书验证
    set $isRedcert 1;
    if ($server_port != 443) { set $isRedcert 2; }
    if ( $uri ~ /\.well-known/ ) { set $isRedcert 1; }
    if ($isRedcert != 1) {
        rewrite ^(/.*)$ https://$host$1 permanent;
    }

    ssl_certificate     /www/server/panel/vhost/cert/letaidraw.cn/fullchain.pem;
    ssl_certificate_key /www/server/panel/vhost/cert/letaidraw.cn/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;   # 不含 TLSv1.1，已被主流浏览器拒绝
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;
    ssl_early_data on;                # 见下方「已知风险」
    quic_retry on;
    quic_gso on;
    add_header Strict-Transport-Security "max-age=31536000";
    add_header Alt-Svc 'h3=":443"; ma=86400';

    include /www/server/panel/vhost/rewrite/html_letaidraw.cn.conf;

    # 静态资源：本地磁盘优先，缺失回源
    location ^~ /_next/static/ {
        root /www/wwwroot/www.letaidraw.com;    # 复用 .com 站点的发布目录
        try_files $uri @letaidraw_static_origin;
        add_header Cache-Control "public, max-age=31536000, immutable";
        add_header X-HK-Entry "1" always;
        add_header X-HK-Static "local" always;
        add_header Alt-Svc 'h3=":443"; ma=86400' always;
        access_log off;
    }

    location @letaidraw_static_origin {
        proxy_pass https://letaidraw_cn_origin;
        proxy_ssl_server_name on;
        proxy_ssl_name www.letaidraw.cn;
        proxy_set_header Host www.letaidraw.cn;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_buffering on;
        proxy_cache letaidraw_hk_cn_static;
        proxy_cache_key "$host$request_uri";
        proxy_cache_valid 200 30d;
        proxy_cache_lock on;
        add_header X-HK-Entry "1" always;
        add_header X-HK-Static "origin" always;
        add_header X-HK-Cache $upstream_cache_status always;
        add_header Alt-Svc 'h3=":443"; ma=86400' always;
    }

    # SSE：必须关缓冲，否则事件会攒到最后一次性吐出
    location ^~ /api/studio/events {
        proxy_pass https://letaidraw_cn_origin;
        proxy_ssl_server_name on;
        proxy_ssl_name www.letaidraw.cn;
        proxy_set_header Host www.letaidraw.cn;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        add_header X-HK-Entry "1" always;
        add_header X-Accel-Buffering no always;
    }

    location ^~ /api/creation/runs/ { /* 同上 */ }

    # 其余 API（含 Stripe webhook）：绝不缓存
    location ^~ /api/ {
        proxy_pass https://letaidraw_cn_origin;
        proxy_ssl_server_name on;
        proxy_ssl_name www.letaidraw.cn;
        proxy_set_header Host www.letaidraw.cn;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_request_buffering on;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
        add_header X-HK-Entry "1" always;
    }

    location / {
        proxy_pass https://letaidraw_cn_origin;
        proxy_ssl_server_name on;
        proxy_ssl_name www.letaidraw.cn;
        proxy_set_header Host www.letaidraw.cn;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $letaidraw_connection_upgrade;
        proxy_http_version 1.1;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
        add_header X-HK-Entry "1" always;
    }
}
```

`/api/creation/runs/` 与 `/api/studio/events` 规则完全一致，作用对象是创作任务的事件流。

### 配置要点

- **回源地址填 IP，不填域名。** 填 `www.letaidraw.cn` 会被 DNS 分流解析回香港自己，形成自反代死循环。
- **只能回源 `443`。** 国内源站的应用端口 `5000` 不对外监听，香港直连会失败。
- **`add_header` 不继承。** server 块一旦有 `add_header`，子块里必须重新声明；每个 proxy location 都重复写了 `X-HK-Entry` 和 `Alt-Svc` 就是为此。
- **`proxy_ssl_name` 必须显式指定。** 国内源站证书是 `CN=letaidraw.cn`（Let's Encrypt），用 IP 回源时 SNI 默认会是 IP 地址，导致证书校验失败。
- **静态资源 `root` 指向 `www.letaidraw.com`**，复用现有 CI 发布目录，上传链路无需改动。若要独立目录，需同步修改 `.github/workflows/docker-build.yml` 中的香港目标路径。

### 已知风险

`ssl_early_data on` 保留自宝塔默认配置。它开启 TLS 0-RTT，**带副作用的 POST 可以被重放**。本站有支付与积分扣减，若无明确的性能理由，建议改为 `ssl_early_data off;`。

## 国内源站必须同步的配置

这三项不改，香港反代会出现 403、502 或限流误伤。

| 变量 | 值 | 不改的后果 |
| --- | --- | --- |
| `TRUST_PROXY` | `true` | 源站看到的客户端 IP 全是香港服务器地址，**所有海外用户共享同一套限流额度** |
| `PUBLIC_URL` | `https://www.letaidraw.cn` | 必须与浏览器地址栏 origin 完全一致，否则写入接口返回 `CROSS_ORIGIN_REQUEST` |
| `NEXTAUTH_URL` | `https://www.letaidraw.cn` | OAuth 回调与支付回跳地址错误 |

同时确认国内 Nginx 的 `server_name` 显式包含 `www.letaidraw.cn`：

```bash
grep -rn "server_name" /www/server/panel/vhost/nginx/*.conf | grep letai
```

香港回源时携带 `Host: www.letaidraw.cn`，未匹配会落到错误的虚拟主机，表现为 404 或证书域名不符。

改完重启 Web 与 Worker：

```bash
docker compose --env-file .env.production -f compose.prod.yaml up -d web worker
```

### 不要开启全局 proxy_cache

`/www/server/nginx/conf/proxy.conf` 中的 `proxy_cache cache_one;` 必须保持注释。Next.js 预渲染页发送 `Cache-Control: s-maxage=31536000`，Nginx 会按 `Accept-Encoding` 分别缓存多份副本，导致部署后浏览器持续拿到旧构建（curl 却是新的）。香港节点的缓存策略由 `letaidraw_hk_cn_static` 精确限定在 `/_next/static/`，不要另外放开。

香港机器的 `/www/server/nginx/conf/proxy.conf` 同样要确认为注释状态。

## 验证清单

在线验证（用 `openssl s_client` 或 `curl --resolve` 指定 IP，避开本机 DNS）：

```bash
# 证书必须是正式证书
openssl s_client -connect 43.161.195.225:443 -servername www.letaidraw.cn </dev/null 2>&1 \
  | grep -E "subject=|Verify return code"
# 期望：subject=CN=letaidraw.cn，Verify return code: 0 (ok)

# 页面与反代标记
printf 'GET /en HTTP/1.1\r\nHost: www.letaidraw.cn\r\nConnection: close\r\n\r\n' \
  | openssl s_client -connect 43.161.195.225:443 -servername www.letaidraw.cn -tls1_3 -quiet 2>/dev/null \
  | grep -iE "^HTTP/|x-hk"
# 期望：HTTP/1.1 200 OK + X-HK-Entry: 1

# 静态资源读本地
# 期望：200 + X-HK-Static: local，且 Content-Length 与源站一致

# API 回源
# 期望：/api/ready 返回 200 {"status":"ready"}

# SSE 规则命中（未登录时 401 属正常）
# 期望：X-Accel-Buffering: no
```

浏览器手动验证（无法脚本化）：

- 登录成功，会话在分流后依然有效。
- 图片生成完整走通，跨境链路超时足够。
- 生成状态逐条推送，而非最后一次性出现。

### 本机 curl 的坑

Windows 版 curl 使用 Schannel 后端，与部分服务器加密套件协商会失败（`exit code 35`，`code=000`），而 `openssl` 握手完全正常。判定时以 `openssl s_client` 为准，不要据此认为服务器故障。

## 香港静态资源发布

静态资源只发布到香港节点，由 `HK_STATIC_DEPLOY_ENABLED=true` 启用；上传成功后才会推进 `latest`/`main`/SHA 标签。国内节点不参与静态资源发布。

1. 构建并签名 amd64/arm64 镜像；用本次唯一 `BUILD_TAG` 拉取两个架构的镜像。
2. 从镜像提取 `/app/.next/static`，以及 `/app/public/studio`、`/app/public/inspiration` 中允许发布的图片。**不二次构建**，确保与对应镜像一致。
3. 校验镜像中的部署标识和资源前缀，将两个架构分别放入 `releases/<BUILD_TAG>-<arch>/_next/static/`，再合并上传。
4. 上传到香港 `/www/wwwroot/.letaidraw-static-staging/<BUILD_TAG>/static`，暂存目录不在网站目录内。
5. 完整检查与现有资源的内容冲突。新文件写完后通过同文件系统硬链接原子发布到 `/www/wwwroot/www.letaidraw.com/_next/static`。
6. 发布成功后才能更新正式镜像标签（latest/main/SHA）。上传失败时现有正式标签不变。

**线上资源不删除、不覆盖、不整体替换目录。** 已有文件不改内容或修改时间，不使用 rsync `--delete` / `--inplace`。暂存目录在成功后清理；失败时保留以便排查。

同步 Next.js 构建产物和上述两个公开目录中的 `.webp`、`.png`、`.jpg`、`.jpeg`、`.avif` 图片；不上传 HTML、`.next/server`、源代码、密钥、JSON 元数据或用户图片。页面与 API 始终在源站执行。

### Next.js 清单冲突与版本隔离

Next.js 16.2+ 设置 `deploymentId` 后固定使用 `build-TfctsWXpff2fKS` 作为 BUILD_ID，它并不是一次发布的唯一目录。把所有版本合并进同一目录会触发 `_ssgManifest.js` 内容冲突。

现在保留 `NEXT_DEPLOYMENT_ID=<BUILD_TAG>` 的版本检查，并用 `NEXT_STATIC_ASSET_NAMESPACE=<BUILD_TAG>-<arch>` 隔离每个镜像的资源：

```text
/_next/static/releases/build-<sha>-<run>-<attempt>-amd64/_next/static/build-TfctsWXpff2fKS/_ssgManifest.js
```

源站仅将**当前镜像自己的前缀**重写回其 `.next/static`，支持香港缺失文件时回源，不会把旧版本请求误映射到当前清单。

**重跑规则**：新流程在 prepare 中生成并输出 BUILD_TAG，构建、香港上传和镜像合并统一使用该输出。「Re-run failed jobs」会复用成功 prepare 的原始标签，可重试失败上传而不重建镜像；「Re-run all jobs」会生成新的发布标识。要主动重建已发布过静态资源的镜像，同样应重跑全部 job。

### GitHub 配置

仓库 Settings → Secrets and variables → Actions。

Secrets：

| 名称 | 内容 |
| --- | --- |
| `HK_SERVER_HOST` | 香港 IP 或 SSH 主机名（不带协议、端口） |
| `HK_SERVER_USER` | SSH 用户 |
| `HK_SERVER_SSH_KEY` | 专用、无交互口令的 SSH 私钥；公钥放香港该账号的 authorized_keys |
| `HK_SERVER_KNOWN_HOSTS` | 已核验的香港 SSH 主机公钥记录，格式同 known_hosts；非 22 端口用 `[主机]:端口` |

Variables：

| 名称 | 值 |
| --- | --- |
| `HK_STATIC_DEPLOY_ENABLED` | 配好 Secrets 和 Nginx 后设置 `true`；未配置时跳过香港上传 |
| `HK_SERVER_PORT` | SSH 端口，默认 `22` |
| `HK_STATIC_BWLIMIT_KIB` | rsync 上传速率上限，单位 KiB/s；默认 `0` 不限速 |

在香港服务器可信终端运行 `cat /etc/ssh/ssh_host_ed25519_key.pub` 获取**公钥**，前面加主机名与空格组成 known_hosts 记录。只复制 `.pub` 公钥，不复制服务器主机私钥，也不要直接信任未核验的 `ssh-keyscan` 结果。

香港需安装 Python 3.8+ 和 rsync，放通 GitHub runner 到 SSH 端口。发布账号需要对以下两个目录有写权限：

```text
/www/wwwroot/.letaidraw-static-staging
/www/wwwroot/www.letaidraw.com/_next/static
```

按实际发布账号设置权限，不要递归修改整个网站的所有权。发布目录使用普通目录，不使用软链接。发布流程不需要 Nginx 重载权限。

### SSH / rsync 断线恢复

上传脚本分阶段记录准备、rsync、发布脚本上传和最终发布。每阶段遇到可识别的连接中断或传输超时，最多执行 4 次，间隔 10、20、40 秒；权限、主机密钥、磁盘空间和不可变资源冲突不会自动重试。SSH 保活等待窗口约 120 秒，rsync 无 I/O 超时为 180 秒；整个 CI job 仍受 25 分钟上限约束。

rsync 将不完整文件保留在本次 `${BUILD_TAG}/partials`，与待发布的 `static` 目录分开，避免半文件进入网站目录。一次运行内重试复用同一暂存目录，并校验已经传输的文件。跨运行尝试不承诺续传。

脚本不会在香港构建应用、重启服务或修改 SSH 服务配置。

## 证书

两个节点都必须持有 `www.letaidraw.cn` 的有效证书。

`.cn` 域名在香港必须使用 **DNS-01 验证**。分流生效后，Let's Encrypt 从海外发起文件验证时会被解析到香港自己，而香港此时若无正式证书则验证失败，形成死锁。宝塔的 Let's Encrypt 面板选择 DNS 验证或 DNS API 即可；国内节点已是 `_dnsauth` TXT 模式。

当前香港证书：Let's Encrypt `YR2`，SAN 含 `letaidraw.cn` 与 `www.letaidraw.cn`。宝塔新建站点时会先塞入一张自签证书（有效期到 2036 年），必须换掉，否则海外用户会看到全屏证书警告。

## 公开页面 HTML 微缓存（适用于 `.com` 站点）

`docker/nginx/hk-page-cache.conf` 与 `hk-static-locations.conf`、`hk-public-image-*.conf` 属于香港上另一个站点 `www.letaidraw.com` 的配置，与本文件的 `.cn` 站点相互独立，不要混用。`.cn` 站点的页面直接回源国内源站，未启用 HTML 微缓存。

若日后需要为 `.cn` 站点启用页面缓存，注意缓存区名不能与 `letaidraw_hk_cn_static` 或 `letaidraw_hk_static` 重名，且只应缓存完整文档请求，`RSC` / `Next-Router-*` 预取请求必须回源。

## 撤销

1. 删除 DNSPod 的「境外」记录，全部流量回到大陆源站。
2. 等待 TTL 过期（`300` 秒即 5 分钟）。
3. 香港站点可保留待用，或删除站点释放端口。
4. 国内源站 `TRUST_PROXY` 若不再有反代，改回 `false`，避免客户端伪造 `X-Forwarded-For`。

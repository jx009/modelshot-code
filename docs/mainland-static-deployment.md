# 国内入口的静态资源发布

现有 `.github/workflows/docker-build.yml` 同时支持香港和中国大陆节点，不新增独立构建流程。国内 Nginx 本地提供 JS、CSS、字体及随构建发布的公开图片，页面 HTML、RSC、API、登录、SSE、图片优化和私有素材仍由美国 Next.js 服务处理。这不是静态导出整个 Next.js 网站。

## GitHub 配置

仓库 Settings → Secrets and variables → Actions，新增以下 Secrets：

| 名称 | 内容 |
| --- | --- |
| `CN_SERVER_HOST` | 国内服务器 IPv4 或 SSH 主机名，不带协议或端口 |
| `CN_SERVER_USER` | 专用 SSH 发布账号 |
| `CN_SERVER_SSH_KEY` | 该账号的 SSH 私钥，无交互口令；对应公钥配置在服务器 authorized_keys |
| `CN_SERVER_KNOWN_HOSTS` | 从可信服务器终端核验的 SSH 主机公钥记录；非 22 端口格式为 `[主机]:端口 ssh-ed25519 AAAA...` |

新增以下 Variables：

| 名称 | 值 |
| --- | --- |
| `CN_STATIC_DEPLOY_ENABLED` | 完成服务器准备和 Nginx 配置后设置 `true`，默认跳过国内上传 |
| `CN_SERVER_PORT` | 可选，默认 `22` |
| `CN_STATIC_BWLIMIT_KIB` | 可选，rsync 上传速率 KiB/s，默认 `0` 不限速，例如 `2048` |

国内和香港的开关、凭据彼此独立。香港仍使用原来的 `HK_*` 配置；可以同时启用，也可以在确认香港不再承接流量后关闭香港开关。国内缺少凭据会报错，不会借用香港凭据。

通过可信终端在国内服务器运行 `cat /etc/ssh/ssh_host_ed25519_key.pub`，在输出前面加主机名/IP 和空格，组成 known_hosts 记录。只复制 `.pub` 公钥，不复制服务器主机私钥。

## 国内服务器一次性准备

国内服务器需要 Nginx、Python 3.8+、rsync，允许 GitHub runner 连接配置的 SSH 端口。无需 Node.js、Docker、数据库或本地构建。

与香港使用相同的固定目录布局（不同服务器的目录互不影响）：

```text
/www/wwwroot/.letaidraw-static-staging
/www/wwwroot/www.letaidraw.com/_next/static
```

创建以上目录，赋予发布账号写权限，Nginx 用户需要有读取文件和遍历父目录的权限。目录不能是软链接。不要递归修改整个站点的所有权。暂存目录在网站根目录之外，Action 只清理本次成功发布的暂存目录，不删除线上旧资源。

## 宝塔反代配置

仅添加全站反代还不够：必须让静态请求先读取上面的本地目录。

1. 在国内宝塔添加 `www.letaidraw.com` 反代，目标固定为美国源站地址，并配置访问域名的 HTTPS 证书。源站地址不能解析回国内入口。
2. 将 `docker/nginx/cn-public-image-map.conf` 放在 Nginx 的 `http {}` 内、`server {}` 外。
3. 在 `http {}` 内配置美国源站 upstream。下面的地址是示例，必须替换成美国真实 IP：

   ```nginx
   upstream letaidraw_us_origin {
       server 203.0.113.10:443;
   }
   ```

4. 将以下设置放在入口站点的 `server {}` 层，让静态回源 location 也能继承。假设美国 HTTPS 证书和虚拟主机使用 `www.letaidraw.com`；实际不同则替换为实际源站域名。CA 路径示例适用于 Debian/Ubuntu，其他发行版需改成有效的系统 CA bundle：

   ```nginx
   proxy_set_header Host www.letaidraw.com;
   proxy_set_header X-Real-IP $remote_addr;
   proxy_set_header X-Forwarded-For $remote_addr;
   proxy_set_header X-Forwarded-Proto $scheme;
   proxy_ssl_server_name on;
   proxy_ssl_name www.letaidraw.com;
   proxy_ssl_verify on;
   proxy_ssl_trusted_certificate /etc/ssl/certs/ca-certificates.crt;
   ```

5. 将 `docker/nginx/cn-static-locations.conf` 放在同一 `server {}` 内。替换任何已有的 `/_next/static/` 规则，公开图片的正则 location 放在通用图片正则规则之前。保留全站 `location /` 到美国的反代，以及登录、WebSocket、SSE 设置；如果面板生成的是 `location ^~ /`，需改为普通 `location /` 才能匹配公开图片正则。不要同时包含香港和国内的静态 location。
6. 这些片段使用固定站点根目录，不依赖面板的默认根目录；无需额外定义 Nginx 缓存区。缺失文件回源，回源不写共享缓存；本地命中的版本化资源才允许 immutable 缓存。
7. 备份线上配置后，检查成功才重载：

   ```bash
   /www/server/nginx/sbin/nginx -t && /www/server/nginx/sbin/nginx -s reload
   ```

仓库里的 Nginx 文件是配置片段，Action 不会自动修改宝塔站点配置、证书、DNS，也不需要 Nginx 重载权限。公网域名使用大陆入口需先满足服务商备案及接入要求。

## 发布与切换

1. 在 GitHub 配好 `CN_*`，启用 `CN_STATIC_DEPLOY_ENABLED=true`。
2. 推送包含此次修改的 main，或在 main 手动运行原有 `Publish Docker image (Multi-arch)`。
3. `publish_cn_static` 从本次 amd64/arm64 镜像提取静态资源，校验部署标识和资源路径后上传；复用香港原有的增量、防覆盖、SSH 主机校验及断线重试机制。
4. **所有已启用节点上传成功后**，才更新正式镜像标签。任何一个启用节点失败都会阻止标签推进；关闭的节点允许跳过。上传只在 main 运行，标签发布沿用原有行为，不自动同步到入口节点，不能把未同步的标签直接用于生产切换。
5. 正式镜像发布成功后，按现有方式更新美国应用。上传的资源必须与运行的镜像来自同一次工作流；不要使用临时 build 标签提前上线。
6. 用当前页面实际请求的 JS/CSS URL 验证国内节点，再将域名解析切换到国内服务器；已有 AAAA 记录也需检查。香港可继续保留作为备用。

首次启用不会补齐全部历史版本，但当前构建的两个架构都会上传。旧版本本地缺失时仅尝试回源，美国源站已不保留的旧资源不能凭空恢复。保留所有已上传版本，不自动清理。

需要重试时选 **Re-run all jobs**，不要只重跑失败的上传 job：`BUILD_TAG` 含 `run_attempt`，只重跑失败 job 不会重新生成对应镜像。

## 验证

拿浏览器 Network 中当前真实 JS/CSS 地址，在 DNS 切换前也可以指定国内 IP 检查（替换示例 IP 和资源路径）：

```bash
curl --resolve www.letaidraw.com:443:国内IP -I 'https://www.letaidraw.com/_next/static/releases/实际版本/_next/static/实际文件.js'
```

- 应看到 `200`、`X-CN-Static: local`，证明从国内磁盘读取。
- 带本次 `dpl=build-...` 的公开 studio/inspiration 图片应看到 `X-CN-Public: local`。
- 无版本或本地缺失的公开图片走美国回源，返回 `X-CN-Static: origin`，不能带 immutable 缓存。
- 验证登录、刷新页面、生成及 SSE 及时返回。不要给 `/api/`、用户素材、登录响应设置共享缓存。
- 检查上一发布的 JS/CSS 仍可读取，并监控磁盘空间。

本地按 AGENTS.md 仅做静态检查；部署脚本的模拟 SSH/rsync 测试由现有 CI 执行，实际网络上传、Nginx 配置生效和性能需要上线验证。

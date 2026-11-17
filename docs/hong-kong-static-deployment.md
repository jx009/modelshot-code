# 香港入口的静态资源发布

静态资源只发布到香港节点，由 `HK_STATIC_DEPLOY_ENABLED=true` 启用；上传成功后才会推进 `latest`/`main`/SHA 标签。国内节点不参与静态资源发布。

美国运行 Next.js Web、Worker、数据库与存储，香港 Nginx 作为 `www.letaidraw.com` 的入口。
反代是否完成仍需验证：DNS 指向香港、美国 `PUBLIC_URL=https://www.letaidraw.com`、登录和生成成功、SSE 及时返回。

## 发布内容与顺序

`.github/workflows/docker-build.yml` 增加 `publish_hk_static`。仅 main 分支且开启开关时发布，包括 main 的手动运行。

1. 构建并签名 amd64/arm64 镜像；用本次唯一 `BUILD_TAG` 拉取两个架构的镜像。
2. 从镜像提取 `/app/.next/static`，以及 `/app/public/studio`、`/app/public/inspiration` 中允许发布的图片。不二次构建，确保与对应美国镜像一致。
3. 校验镜像中的部署标识和资源前缀，将两个架构分别放入 `releases/<BUILD_TAG>-<arch>/_next/static/`，再合并上传。前端构建时已写入相同的资源路径。
4. 上传到香港 `/www/wwwroot/.letaidraw-static-staging/<BUILD_TAG>/static`，暂存目录不在网站目录内。
5. 完整检查与现有资源的内容冲突。新文件写完后通过同文件系统硬链接原子发布到 `/www/wwwroot/www.letaidraw.com/_next/static`。
6. 发布成功后才能更新正式镜像标签（latest/main/SHA）。上传失败时现有正式标签不变；临时构建标签已经存在，不要用它提前部署美国。

**线上资源不删除、不覆盖、不整体替换目录。** 已有文件不改内容或修改时间，不使用 rsync `--delete` / `--inplace`。暂存目录在成功后清理；失败时保留以便排查。发布确认成功后如果清理连接失败，只警告暂存目录清理未确认，不把已完成的发布改判为失败。

同步 Next.js 构建产物和上述两个公开目录中的 `.webp`、`.png`、`.jpg`、`.jpeg`、`.avif` 图片；不上传 HTML、`.next/server`、源代码、密钥、JSON 元数据或用户图片。公开图片位于 `/_next/static/public-releases/<BUILD_TAG>/studio/` 和 `inspiration/`，固定文件名也按发布隔离，不覆盖旧版本。页面/API 继续在源站执行。

### Next.js 清单冲突与版本隔离

Next.js 16.2+ 设置 `deploymentId` 后会固定使用 `build-TfctsWXpff2fKS` 作为 BUILD_ID；它并不是一次发布的唯一目录。清单内容随路由等变化，但 `?dpl=...` 不会让 Nginx 本地磁盘自动读取不同文件，所以把所有版本直接合并进同一目录会触发 `_ssgManifest.js` 内容冲突。仅设置 `generateBuildId` 无效；关闭冲突检查或覆盖旧文件也会破坏已有页面。

现在保留 `NEXT_DEPLOYMENT_ID=<BUILD_TAG>` 的版本检查，并用 `NEXT_STATIC_ASSET_NAMESPACE=<BUILD_TAG>-<arch>` 隔离每个镜像的资源。比如浏览器请求：

```text
/_next/static/releases/build-<sha>-<run>-<attempt>-amd64/_next/static/build-TfctsWXpff2fKS/_ssgManifest.js
```

对应香港磁盘路径仍在现有 `/_next/static/` 目录内，无须为此新增 Nginx location。美国应用仅将**当前镜像自己的前缀**重写回其 `.next/static`，支持香港缺失文件时回源和直接访问美国；不会把旧版本请求误映射到当前清单。两个架构也各用自己的路径，避免构建差异冲突。提取时读取的 `required-server-files.json` 只用于校验，绝不放入公开上传目录。

首次修复必须运行**包含修复提交的新工作流，完成全部构建与发布**。旧提交的工作流仍在每个 job 中重新计算 `run_attempt`，只重跑失败上传会寻找不存在的镜像；旧运行请选择 “Re-run all jobs”。新流程在 prepare 中生成并输出 BUILD_TAG，构建、香港/国内上传和镜像合并统一使用该输出：新流程的 “Re-run failed jobs” 会复用成功 prepare 的原始标签，可以重试失败上传而不重建镜像。“Re-run all jobs” 会重新运行 prepare，生成新的发布标识。若要主动重建已经发布过静态资源的镜像，也应重跑全部 job，不单独重跑已成功的构建 job，避免同一资源路径出现不同内容。

## GitHub 配置

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
| `HK_STATIC_DEPLOY_ENABLED` | 配好上述 Secrets 和 Nginx 后设置 `true`；未配置时跳过香港上传 |
| `HK_SERVER_PORT` | SSH 端口，默认 `22` |
| `HK_STATIC_BWLIMIT_KIB` | rsync 上传速率上限，单位 KiB/s；默认 `0` 不限速。需要减轻小服务器带宽压力时可设为 `2048` |

在香港服务器可信终端运行 `cat /etc/ssh/ssh_host_ed25519_key.pub` 获取**公钥**，将输出前面加 `HK_SERVER_HOST` 对应的 IP/主机名及空格，组成 known_hosts 记录。例如 `203.0.113.10 ssh-ed25519 AAAA...`。非默认端口为 `[203.0.113.10]:2222 ssh-ed25519 AAAA...`。不要复制不带 `.pub` 的服务器主机私钥，也不要将未核验的 ssh-keyscan 结果直接信任。

香港安装 Python 3.8+ 和 rsync，放通 GitHub runner 到 SSH 端口。发布账号需要对以下两个目录有写权限，Nginx 用户需要能够读取正式目录：

```text
/www/wwwroot/.letaidraw-static-staging
/www/wwwroot/www.letaidraw.com/_next/static
```

按实际发布账号设置这两个目录的权限，不要递归修改整个网站的所有权。发布目录使用普通目录，不使用软链接。发布流程不需要 Nginx 重载权限。

### SSH / rsync 断线恢复

上传脚本分阶段记录准备、rsync、发布脚本上传和最终发布。每阶段遇到可识别的连接中断或传输超时，最多执行 4 次，间隔 10、20、40 秒；权限、主机密钥、磁盘空间和不可变资源冲突不会自动重试。SSH 保活等待窗口约 120 秒，rsync 无 I/O 超时为 180 秒；整个 CI job 仍受 25 分钟上限约束。

rsync 将不完整文件保留在本次 `${BUILD_TAG}/partials`，与待发布的 `static` 目录分开，避免半文件进入网站目录。一次运行内重试复用同一暂存目录，并校验已经传输的文件。GitHub 的新运行尝试会产生不同 BUILD_TAG，不承诺跨工作流尝试续传。

看到 Python 版本和 rsync 路径之后再出现 `Timeout, server ... not responding`，说明初始检查已通过，但后续 SSH 会话未收到响应。该日志不能单独区分线路抖动、机器繁忙或 SSH 服务异常。重试耗尽后仍阻止正式标签前进；不要绕过香港资源发布直接更新美国镜像。脚本不会在香港构建应用、重启服务或修改 SSH 服务配置。

## 香港 Nginx 的一次性修改

此前的 `/_next/static/` 仅代理回美国，上传文件不会自动变成本地读取。

用 `docker/nginx/hk-static-locations.conf` 中的两个 location 替换原有 `location ^~ /_next/static/`。保持 server 中现有 `proxy_set_header`、源站证书校验、超时等设置，以及 http 中的 `letaidraw_us_origin` upstream、`letaidraw_hk_static` 缓存区定义。

它会先读取网站目录的 `/_next/static/...`；找不到时回源美国，避免尚未同步时全站资源 404。其他页面和接口仍由原来的 `location /` 反代。

```bash
/www/server/nginx/sbin/nginx -t
/www/server/nginx/sbin/nginx -s reload
```

只在检查成功后重载。开启 GitHub Variable 后，在 main 手动运行 Publish Docker image，成功后再更新美国镜像。

## 公开页面 HTML 微缓存（一次性修改）

静态资源本地化之后，页面 HTML 仍从美国回源：中国网络访问首页实测首字节约 7.9 秒，且响应未压缩。首页、定价页和作品详情页由 Next.js 预渲染，内容与登录态无关，可以安全地在香港缓存。

配置在 `docker/nginx/hk-page-cache.conf`，分三部分：

1. **http 层**：新增缓存区 `letaidraw_hk_pages` 和判定 RSC 请求的 `map`，与现有 upstream 同级。先创建目录 `/www/server/nginx/proxy_cache/letaidraw_pages` 并交给 Nginx 运行用户。
2. **server 层**：把文件中注释掉的 `location ~ ^/(zh|en)...` 取消注释，放在 `location /` 之前。只匹配 `/zh`、`/en`、`/pricing`、`/explore/<slug>`，其余路径行为不变。
3. **压缩**：开启 gzip；已编译 brotli 模块时一并开启。

行为说明：

- 只缓存完整文档请求，RSC 与预取请求（带 `RSC`、`Next-Router-*` 请求头）直接回源，不会把 RSC 载荷当成 HTML 返回。
- 带 `Set-Cookie` 的响应不进缓存，这是 Nginx 默认行为，**不要**加 `proxy_ignore_headers Set-Cookie`。
- 缓存 60 秒，过期后先返回旧页面、后台刷新；美国源站故障时继续返回旧页面。
- 发布新版本后，最长 60 秒内旧 HTML 仍引用上一版资源路径。由于香港静态资源按 `BUILD_TAG` 隔离且从不删除，旧页面仍可正常加载。
- 管理端修改灵感库后，页面最长约 5 分钟生效（Next.js ISR 300 秒 + 香港 60 秒）。

验证：

```bash
curl -sI https://www.letaidraw.com/zh | grep -i "x-hk-page-cache\|content-encoding"
```

第二次请求应看到 `X-HK-Page-Cache: HIT` 与 `content-encoding: gzip`（或 `br`），首字节应降到数百毫秒以内。带 `RSC: 1` 请求头的请求应显示 `BYPASS`。

若此前观察到"内容已下载完但连接 60 秒不结束"，开启缓存后由 Nginx 直接返回带长度的完整响应，可一并消除；若仍复现，检查该 location 是否继承了 `proxy_buffering off`。

## 验证与维护

### 公开图片的一次性 Nginx 配置

此步骤与 JS/CSS 的 location 独立。只改仓库文件不会自动改变线上 Nginx。

1. 备份香港实际站点配置 `html_www.letaidraw.com.conf`。
2. 将 `docker/nginx/hk-public-image-map.conf` 的内容放入该文件的 `server {}` **外部**，与现有 `upstream` 同级（http 上下文）。
3. 将 `docker/nginx/hk-public-image-locations.conf` 的内容放入 `server {}` 内。保留隐藏文件拦截规则、现有静态资源规则和 `location /`。如果有其他匹配图片的正则 location，将本规则放在那些规则之前。
4. 执行 `nginx -t`，仅成功后平滑重载。无需重启应用；随后按正常流程发布包含此改动的新镜像和香港静态资源。

例如 `/studio/scene-03.webp?dpl=build-abc-123-1` 会读取：

```text
/www/wwwroot/www.letaidraw.com/_next/static/public-releases/build-abc-123-1/studio/scene-03.webp
```

只有合法的版本号才能选择本地目录；无版本、版本无效或本地缺失时仍回源，且回源兜底不写共享缓存、不下发 immutable。不要创建 `_unversioned` 发布目录。这样不会把当前源站图片永久缓存成旧版本。命中本地图片时返回 `X-HK-Public: local`，并允许浏览器长期缓存；兜底为 `X-HK-Public: origin`。正式发布的 build 标识和现有客户端 `dpl` 参数相匹配。

`/_next/image` 仍由源站优化图片；本改动不在香港启动图片处理，也不改用户图片 `/api/assets/`、登录或生成接口的缓存策略。旧发布如果没有同步图片会继续走兜底；新版本发布后才会逐步受益。

撤销时先删除公开图片的两个 location，再删除 map，并在配置检查通过后重载。保留已发布文件，不删除现有 JS/CSS 规则，不影响源站兜底。

### 验证清单

- 浏览器关闭本地缓存，查看实际 JS/CSS 响应的 `X-HK-Static: local`，确认文件来自香港磁盘。
- 对带当前 `dpl` 的 `/studio/scene-03.webp` 和 `/inspiration/generated/*.webp` 检查 `X-HK-Public: local`。确认无 `dpl` 或未知版本仍可回源，且响应没有 immutable。
- 更新后请求上一版本的 JS/CSS，仍应返回 200；同路径内容不允许变化。
- 新版本同步失败，不删除旧版本资源、不更新正式镜像标签；修复后重新运行工作流。
- 不同发布、不同架构可各自保留同名清单；同一发布和架构中同路径内容变化仍会明确失败，不会覆盖。
- 保留旧资源会占用磁盘，需要监控空间；没有自动清理策略。后续清理须结合活跃版本和回滚窗口单独实施。
- 此方案避免静态资源被替换引起的缺失，不保证仍运行旧代码的浏览器与所有新后端协议兼容。
- 本地测试可验证不可覆盖发布与 Nginx 读取/回源；真实 SSH 上传需配置仓库 Secrets 后验证。

# 香港入口的静态资源发布

美国运行 Next.js Web、Worker、数据库与存储，香港 Nginx 作为 `www.letaidraw.com` 的入口。
反代是否完成仍需验证：DNS 指向香港、美国 `PUBLIC_URL=https://www.letaidraw.com`、登录和生成成功、SSE 及时返回。

## 发布内容与顺序

`.github/workflows/docker-build.yml` 增加 `publish_hk_static`。仅 main 分支且开启开关时发布，包括 main 的手动运行。

1. 构建并签名 amd64/arm64 镜像；用本次唯一 `BUILD_TAG` 拉取两个架构的镜像。
2. 从镜像提取 `/app/.next/static`。不二次构建，确保与对应美国镜像一致。
3. 校验镜像中的部署标识和资源前缀，将两个架构分别放入 `releases/<BUILD_TAG>-<arch>/_next/static/`，再合并上传。前端构建时已写入相同的资源路径。
4. 上传到香港 `/www/wwwroot/.letaidraw-static-staging/<BUILD_TAG>/static`，暂存目录不在网站目录内。
5. 完整检查与现有资源的内容冲突。新文件写完后通过同文件系统硬链接原子发布到 `/www/wwwroot/www.letaidraw.com/_next/static`。
6. 发布成功后才能更新正式镜像标签（latest/main/SHA）。上传失败时现有正式标签不变；临时构建标签已经存在，不要用它提前部署美国。

**线上资源不删除、不覆盖、不整体替换目录。** 已有文件不改内容或修改时间，不使用 rsync `--delete` / `--inplace`。暂存目录在成功后清理；失败时保留以便排查。

只同步 Next.js 构建产物，不上传 HTML、`.next/server`、源代码、密钥或用户图片。`public/` 中可能有固定名称且会变化的资源，继续走反代，避免“禁止覆盖”导致它们永远不更新。页面/API 继续美国执行。

### Next.js 清单冲突与版本隔离

Next.js 16.2+ 设置 `deploymentId` 后会固定使用 `build-TfctsWXpff2fKS` 作为 BUILD_ID；它并不是一次发布的唯一目录。清单内容随路由等变化，但 `?dpl=...` 不会让 Nginx 本地磁盘自动读取不同文件，所以把所有版本直接合并进同一目录会触发 `_ssgManifest.js` 内容冲突。仅设置 `generateBuildId` 无效；关闭冲突检查或覆盖旧文件也会破坏已有页面。

现在保留 `NEXT_DEPLOYMENT_ID=<BUILD_TAG>` 的版本检查，并用 `NEXT_STATIC_ASSET_NAMESPACE=<BUILD_TAG>-<arch>` 隔离每个镜像的资源。比如浏览器请求：

```text
/_next/static/releases/build-<sha>-<run>-<attempt>-amd64/_next/static/build-TfctsWXpff2fKS/_ssgManifest.js
```

对应香港磁盘路径仍在现有 `/_next/static/` 目录内，无须为此新增 Nginx location。美国应用仅将**当前镜像自己的前缀**重写回其 `.next/static`，支持香港缺失文件时回源和直接访问美国；不会把旧版本请求误映射到当前清单。两个架构也各用自己的路径，避免构建差异冲突。提取时读取的 `required-server-files.json` 只用于校验，绝不放入公开上传目录。

首次修复必须运行**包含修复提交的新工作流，完成全部构建与发布**。不要重跑旧提交的失败上传步骤，也不需要删除香港旧资源或关闭防覆盖保护。GitHub 的 “Re-run failed jobs” 会改变 `run_attempt` 却跳过已经成功的构建，可能找不到当前 attempt 的镜像；需要重试时请选择 “Re-run all jobs”。

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

在香港服务器可信终端运行 `cat /etc/ssh/ssh_host_ed25519_key.pub` 获取**公钥**，将输出前面加 `HK_SERVER_HOST` 对应的 IP/主机名及空格，组成 known_hosts 记录。例如 `203.0.113.10 ssh-ed25519 AAAA...`。非默认端口为 `[203.0.113.10]:2222 ssh-ed25519 AAAA...`。不要复制不带 `.pub` 的服务器主机私钥，也不要将未核验的 ssh-keyscan 结果直接信任。

香港安装 Python 3.8+ 和 rsync，放通 GitHub runner 到 SSH 端口。发布账号需要对以下两个目录有写权限，Nginx 用户需要能够读取正式目录：

```text
/www/wwwroot/.letaidraw-static-staging
/www/wwwroot/www.letaidraw.com/_next/static
```

按实际发布账号设置这两个目录的权限，不要递归修改整个网站的所有权。发布目录使用普通目录，不使用软链接。发布流程不需要 Nginx 重载权限。

## 香港 Nginx 的一次性修改

此前的 `/_next/static/` 仅代理回美国，上传文件不会自动变成本地读取。

用 `docker/nginx/hk-static-locations.conf` 中的两个 location 替换原有 `location ^~ /_next/static/`。保持 server 中现有 `proxy_set_header`、源站证书校验、超时等设置，以及 http 中的 `letaidraw_us_origin` upstream、`letaidraw_hk_static` 缓存区定义。

它会先读取网站目录的 `/_next/static/...`；找不到时回源美国，避免尚未同步时全站资源 404。其他页面和接口仍由原来的 `location /` 反代。

```bash
/www/server/nginx/sbin/nginx -t
/www/server/nginx/sbin/nginx -s reload
```

只在检查成功后重载。开启 GitHub Variable 后，在 main 手动运行 Publish Docker image，成功后再更新美国镜像。

## 验证与维护

- 浏览器关闭本地缓存，查看实际 JS/CSS 响应的 `X-HK-Static: local`，确认文件来自香港磁盘。
- 更新后请求上一版本的 JS/CSS，仍应返回 200；同路径内容不允许变化。
- 新版本同步失败，不删除旧版本资源、不更新正式镜像标签；修复后重新运行工作流。
- 不同发布、不同架构可各自保留同名清单；同一发布和架构中同路径内容变化仍会明确失败，不会覆盖。
- 保留旧资源会占用磁盘，需要监控空间；没有自动清理策略。后续清理须结合活跃版本和回滚窗口单独实施。
- 此方案避免静态资源被替换引起的缺失，不保证仍运行旧代码的浏览器与所有新后端协议兼容。
- 本地测试可验证不可覆盖发布与 Nginx 读取/回源；真实 SSH 上传需配置仓库 Secrets 后验证。

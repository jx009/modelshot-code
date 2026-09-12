# 演示素材初始化

演示素材用于验证注册、素材库、模特/场景选择、生成提交和导出链路，不用于评价生成质量，也不能当作客户商品素材。

## 包含内容

- 8 张 ModelShot 自制的无真实身份数字模特图，覆盖现有性别、体型和展示分类。
- 6 张场景图：2 张自制影棚背景，4 张经 Wikimedia Commons 核验为 CC0 的城市、室内、公园和海滩图片。
- 5 张服装图，来自 The Metropolitan Museum of Art Open Access，作品 API 标记为 Public Domain，图片以 CC0 提供。

完整的作者、来源页面、许可证、原始下载地址和 SHA-256 记录在 `scripts/demo-assets.manifest.json`。服装图随镜像发布，初始化不依赖服务器访问外部图片站点；写入后仍是用户私有 S3 对象。

## 服务器执行

先在网页注册测试账号。升级到包含演示素材的新镜像并完成迁移后执行：

```bash
docker compose --env-file .env.production -f compose.prod.yaml \
  --profile tools run --rm demo-seed --user-email=you@example.com
```

命令会先验证 14 张公共预设和 5 张服装的校验值，再更新公共预设，并将服装放进指定账号的素材库。它可以重复执行；每个账号各自得到一套稳定 ID，不会重复插入，也不会共享私有对象。

只检查镜像内素材而不写数据库或 S3：

```bash
docker compose --env-file .env.production -f compose.prod.yaml \
  --profile tools run --rm demo-seed --verify-only
```

源码环境也可以运行：

```bash
npm run seed:demo -- --user-email=you@example.com
npm run check:demo-assets
```

## 授权边界

素材清单中的 CC0 状态是初始化集制作时从 The Met API 和 Wikimedia Commons 文件页核验的结果。数字模特不对应真人，因此没有第三方肖像授权问题。正式上线前仍应换成已签署模特授权、与目标市场和商品匹配的生产素材；演示集不构成对任何商标、文化语境或商品适用性的保证。

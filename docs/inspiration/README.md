# 来塔AI：灵感库与后台策展

## 2026-11-05 多风格首页展示

### 线上缺图与首屏聚集修复

线上 `/api/inspiration` 实际返回 39 张旧图，缺少 `cocoa-lux`。原先仅完整默认图库自动升级，导致这个已策展图库遗漏全部 12 张新作，尽管新 WebP 在线上已可访问。升级逻辑现改为对旧版非空图库补入缺失的新作，保留原有删除、隐藏、编辑及顺序，不复原旧作品；通过 ID 与内置封面双重去重，最多 200 张。已导入并策展过的第三版新图子集继续保留，第四版保存后的删除不会再自动补入。空图库保持为空。线上这份配置更新后应为 51 张，而非重新恢复 52 张。

前台缓存命名空间同步更新，避免继续复用旧 39 张快照。12 张新作置于展示序列开头，采用显式列从左到右向最短列填入，取代 CSS 整列填充；2/3/4/5 列的第一屏均先展示新作。同系列跑鞋、饮品、人物封面、社团和建筑展板按主题分组分散，相似变体不再聚集到多个列首。图片仍完整展示原生比例。新增对应的配置升级、主题间隔及浏览器首行布局回归用例，按仓库要求未在本机执行测试套件。

通过用户指定的 CallyouAI `/codex/images/generations` 接口，以请求模型名 `gpt-image-2.5`、质量 `medium` 实际生成 12 张独立作品，默认图库由 40 张扩充到 52 张。使用 imagegen 技能的 fallback CLI；不推断第三方内部模型路由，也不将生成作品宣称为实拍或真实手工制品。

这批覆盖水墨巨龙、深海纸雕、金线凤凰刺绣、像素未来港口、鲸鱼雕版、黏土小行星、电影胶片列车、蓝晒水母、动态炭笔、瓶中生态、巨猫水粉绘本和沙漠光之殿。每个方向一张，不以同主题的换色和相似构图扩充数量。12 张均检查了构图、材质表现及缩略图辨识度。

完整提示词在 `diverse-style-prompts.json`，请求与实际尺寸、文件路径、SHA-256 和发布大小在 `diverse-generation-manifest.json`。原始 PNG 留在本地 `output/imagegen/inspiration-diverse/`，已排除 Git；发布 WebP 位于 `public/inspiration/generated/`，带内容摘要版本号，共约 5.81 MiB，不裁切、不拉伸、不放大。总览预览在 `artifacts/inspiration/diverse-contact-sheet.jpg`。API 密钥未写入项目文件。

未配置图库直接使用 52 张默认作品。旧版策展图库按上述修复规则补入本批新作；后台也可点击「导入多风格炫技精选」后保存发布，同 ID 或同内置图片不会重复添加，也不会重新启用已有隐藏项。保存后的配置使用 `catalogVersion: 4`，后续删除新图不会被自动补回。

按仓库资源限制，仅做改动文件静态检查及素材完整性核对；未运行构建、测试套件或开发服务。

## 新增撞色设计精选

本批次保留原有 20 件作品，新增 20 件高饱和、极繁排版作品，默认图库扩充至 40 件。新作排在前面，覆盖人物撞色封面、黑巧饮品广告、社团视觉全案、建筑概念展板、未来跑鞋广告五组，每组四个设计方向。新图片通过用户指定的 CallyouAI 接口、`gpt-image-2.5` 模型生成，没有挪用参考图或复制旧图凑数。

每个方向分别生成两张候选，保留原始响应和 PNG，再人工挑选。请求比例包括 3:4、9:16、1:1、16:9；请求长边或方形边长为 2048。上游实际返回尺寸可能低于请求值，发布时记录真实尺寸，不拉伸、不裁切、不以插值放大冒充高分辨率成品。生成参数与逐图选择记录见 `vibrant-generation-manifest.json`。

原始候选保留在本地 `output/imagegen/inspiration-2026/`，此目录已排除 Git；发布版为带内容摘要版本号的 WebP。API 密钥不进入源码、清单或图片元数据。生成时使用原始请求模型名作记录，不推断第三方接口内部实际调用的模型。

已知细字限制：`club-festival` 右下应用样机、`sneaker-editorial` 右侧刻度旁仍有少量乱码，不能视为有效文案。前者的局部清理请求未完整返回，因此没有冒充修复成功；发布保留选中的原版，候选和未完成响应继续留档。20 张新增 WebP 合计约 8.2 MiB。

### 创作配方与实际图片

- `size` 记录发布图片真实像素尺寸，用于图片占位和原图比例展示。
- `generationSize` 使用已有的比例/分辨率选择格式，例如 `3:4@2K`，仅作为“以此创作”的初稿设置；能否生成取决于用户选择的模型。
- `outputCount: 2` 带入画布，每组两张挑构图。参数未放进提示词的 `--ar` 指令中。
- 完整提示词仍可复制和复用，中文主标题保持短而准确。修改基于选中的原图并保留原始文件，长图放大检查细字；实际执行的细字清理会记录在逐图清单中，不把独立生成的候选伪称为局部编辑前后对照。
- 建筑平面、剖面和分析小图仅为概念表达，不作为施工图。

### 已有部署的更新

没有保存图库配置的部署直接读取 40 件默认作品。若数据库保存的是完整且未改动的旧 20 件默认作品，则安全升级至新图库并保留原布局；已隐藏、删除、改写、重排或使用上传图片的策展配置不会被覆盖。

已有自定义图库可在后台「灵感管理」点击「导入撞色设计精选」，补齐本批缺失作品，再检查预览并「保存并发布」。已有同 ID 或同内置图片的条目不会重复添加，也不会被重新启用。保存时记录 `catalogVersion: 2`，防止随后手动删除新作品时再次自动补回。空图库仍保持为空。

### 轻量验证

新增 `tests/unit/inspiration-catalog.test.mjs` 覆盖数量、原作品保留、多比例配方、原生尺寸、旧默认升级与策展保护；更新集成测试的默认数量。按服务器资源限制，不在本机运行测试套件、构建、依赖安装或开发服务。可在 CI/资源充足环境运行：

```sh
npx vitest run --project unit tests/unit/inspiration-catalog.test.mjs tests/unit/inspiration-prompts.test.mjs
npx vitest run --project integration tests/integration/inspiration.test.mjs
```

## 原批次交付记录

20 个完整提示词、20 张实际调用 `gpt-image-2.5-flare` 生成的图片，替换首页和独立灵感页的默认案例。分类包含漫画叙事、创意海报、产品广告、人像时尚、艺术插画、3D 实验、空间场景。没有复制参考网站的图片，也没有使用源仓库的示例图片。

生成接口为用户指定的 `https://api.callyouai.com/codex/images/generations`，模型 `gpt-image-2.5-flare`、质量 `medium`，通过 imagegen 技能的 CLI fallback 实际调用。首页与灵感列表仅展示图片，移除卡片下的标题、分类与编号；标题只用于后台检索及详情信息。用户指定的撑伞女孩与猫双格原图已恢复，使用原来的完整构图和提示词。新生成的竖版漫画退出默认精选，旧版本文件保留以兼容已有配置。最终精选 **9 张方图 + 7 张竖图 + 4 张横图**。方图保留原批次的优秀作品；另外 12 张针对竖版漫画、时尚封面、产品叙事、旅行海报及横向场景重新编写提示词并生成，实际返回尺寸全部为请求的 `1024x1536` / `1536x1024`。未将方图裁切、拉伸或加边冒充其他比例。新批次 2 张初次失败，漫画重试成功，旅行海报简化提示词后成功。

发布文件转换为质量 90 的 WebP，保留完整构图，总计约 5.22 MB。旧方图中部分供应商返回 `1254x1254`，此前等比缩为 `1024x1024`。原始 PNG 保留在本地 `output/imagegen/inspiration/` 和 `output/imagegen/inspiration-native/`，不进入 Git；部署图片位于 `public/inspiration/generated/`。

逐图生成参数、实际返回尺寸、发布文件大小与 SHA-256 见 [generation-manifest.json](generation-manifest.json)。完整改编提示词见 `src/lib/inspiration/defaults.js`，前台作品详情也可查看、复制并以此创作。原始生成模型作为作品参数展示；复用时由用户在画布选择本站可用模型，不会假装已经配置此模型，也不会在打开案例时扣费生成。

## 管理员操作

入口：后台 → **灵感管理**（`/zh/admin/inspiration`），admin/root 均可使用。

1. 从已完成的站内生成记录选取图片，可搜索提示词、用户、任务 ID，分页查看；会带入原始提示词与模型。也支持直接上传 PNG、JPEG、WebP。
2. 新案例默认是草稿。填写标题、分类、说明、完整提示词，可补充英文内容和来源署名，勾选“发布到前台”。提示词最多 4000 字符，与画布接收上限一致。
3. 列表上/下移调整顺序。默认采用自然瀑布流：所有图片按真实原图比例完整展示，列宽一致，底边自然错落，不强制对齐，也不让个别图片突然跨列放大。桌面支持 3/4/5 列，间距 8–40 px；手机 2 列。另提供完整展示图片的等高网格（contain，不裁切）。已移除强制拼排、封面比例与裁切焦点控件。后台选图及上传自动选择最接近原图方向的创作尺寸，修改配方尺寸不会改变封面。
4. 使用下方预览确认后点“保存并发布”。首页和灵感页在进入页面、重新获得焦点、每 60 秒读取最新配置。详情在请求时读取当前配置。
5. 可隐藏、删除，最多 200 件案例。删除只移出灵感库，不删除原用户资产。支持保存空列表，空列表不会自动恢复 20 个默认案例。

## 数据与发布行为

- 内置图片 URL 带内容摘要版本号，替换作品后不会继续命中旧方图的缩略图缓存。
- 默认数据：`src/lib/inspiration/defaults.js`。仅数据库中没有灵感库配置时启用，不需要手动导入或数据库迁移。
- 保存位置：`SystemConfig.key = inspiration_gallery_v1`，保存顺序、布局、全部内容及封面引用。通用设置 API 无法绕过专用接口修改这项配置。
- 前台：`GET /api/inspiration` 返回已发布条目；资产图通过 `GET /api/inspiration/{caseId}/image` 输出，仅允许有效、已发布且已建立引用的图片。此接口不能直接按任意用户 asset ID 取图。被选为封面的用户图片会成为公开作品，因此新增先落为草稿供管理员检查。
- 后台：`GET/PATCH /api/admin/inspiration`，服务端检查管理员角色、来源、字段及有效图片，记录审计，使用幂等键与版本摘要防止重复发布和覆盖别人修改。
- 引用保护：发布或草稿中的资产均建立 `AssetReference(kind=inspiration)`；与用户删除、存储清理采用相同用户锁，避免选取与删除的竞态。删除案例释放该引用，不影响其他库/项目引用。图库锁先于管理员与素材用户锁取得，避免不同管理员相互引用素材时死锁。
- 前台不会先渲染内置默认再覆盖数据库内容，防止删除或隐藏的默认作品短暂重新出现。初次读取失败显示重试入口；已有内容刷新失败保留当前内容。
- “以此创作”：`POST /api/studio/cases` 创建用户的独立画布，带入完整提示词、尺寸、单张参数。新的文生图案例不把示例封面错误地当成参考图。保留旧电商案例路由以兼容既有入口。
- API 密钥只在执行生成的进程环境中使用，没有写入代码、清单、配置默认值或文档。运行网站不依赖该临时生成密钥。

## 提示词来源与改编署名

本次整理的是下列 3 个公开提示词仓库中的 20 个创作方向，并非所有互联网提示词的镜像。每张作品详情包含具体案例链接、原作者、来源仓库、许可名称与改编说明。

| 来源仓库 | 仓库标示许可 | 使用方式 |
| --- | --- | --- |
| [jamez-bondos/awesome-gpt4o-images](https://github.com/jamez-bondos/awesome-gpt4o-images) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)，© 2025 Jamez Bondos；各提示词作者单独署名 | 18 个方向，重新设计主题、文案、构图及材质描述 |
| [PicoTrex/Awesome-Nano-Banana-images](https://github.com/PicoTrex/Awesome-Nano-Banana-images) | [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0) | 分镜叙事，署名 @GeminiApp |
| [YouMind-OpenLab/awesome-nano-banana-pro-prompts](https://github.com/YouMind-OpenLab/awesome-nano-banana-pro-prompts) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)，© 2025 YouMind OpenLab | 浮世绘现代场景，署名 VoxcatAI |

许可原文随附于 [licenses/](licenses/)。以上许可名称说明来源仓库的标示；仓库收录的第三方原文仍以各自来源声明为准。这批素材未搬运其第三方示例图片。改编保留创作方法，重新撰写主体、情节、版式、文字、配色及约束，避免直接沿用既有品牌和影视角色。

本项目中的新图片由本次模型调用生成；来源仓库不为本产品背书。若继续分发这些改编提示词，应保留来源链接、作者与改编说明及相应许可文本。

## 验证

```sh
npm run lint
npm run check:design
npm run check:i18n
npx vitest run --project integration tests/integration/inspiration.test.mjs tests/integration/announcements.test.mjs
npm run build
npx playwright test tests/e2e/inspiration.spec.mjs
```

后端覆盖默认 20 图及实际文件、保存空库、顺序布局、公开/隐藏、引用保护、解除引用、不可用素材回滚、审计与幂等、过期版本、多管理员互相引用图片并发发布。浏览器覆盖桌面/手机分类搜索、详情提示词、管理排序布局、生成记录重复搜索、选取和发布、匿名读取发布封面、创建画布并核对提示词、删除与保留原图。浏览器验证使用独立本地测试数据库与存储，不产生额外付费生成。

## 逐图索引

| 作品 | 方向 / 原生尺寸 | 来源案例 / 原作者 |
| --- | --- | --- |
| 雨停之前 | manga · 1024x1024 | [awesome-gpt4o-images](https://github.com/jamez-bondos/awesome-gpt4o-images#cases-40) · @hellokaton |
| 一口夏日 | commerce · 1024x1024 | [awesome-gpt4o-images](https://github.com/jamez-bondos/awesome-gpt4o-images#cases-100) · @azed_ai |
| 开往夏夜的列车 | manga · 1536x1024 | [awesome-gpt4o-images](https://github.com/jamez-bondos/awesome-gpt4o-images#cases-76) · photis (Sora) |
| 玻璃引力 | threeD · 1024x1024 | [awesome-gpt4o-images](https://github.com/jamez-bondos/awesome-gpt4o-images#cases-93) · @egeberkina |
| 木版画里的未来 | illustration · 1024x1536 | [awesome-nano-banana-pro-prompts](https://github.com/YouMind-OpenLab/awesome-nano-banana-pro-prompts#no-9-edo-period-ukiyo-e-reinterpretation-of-a-modern-scene) · VoxcatAI |
| 丝绸的另一种形状 | threeD · 1024x1024 | [awesome-gpt4o-images](https://github.com/jamez-bondos/awesome-gpt4o-images#cases-66) · @ZHO_ZHO_ZHO |
| 光落在沉默之间 | fashion · 1024x1536 | [awesome-gpt4o-images](https://github.com/jamez-bondos/awesome-gpt4o-images#cases-99) · @ZHO_ZHO_ZHO |
| 一座掌心夜市 | space · 1024x1024 | [awesome-gpt4o-images](https://github.com/jamez-bondos/awesome-gpt4o-images#cases-71) · terry623 |
| 春茶的层次 | commerce · 1024x1536 | [awesome-gpt4o-images](https://github.com/jamez-bondos/awesome-gpt4o-images#cases-38) · @dotey |
| 城市的另一面 | poster · 1024x1536 | [awesome-gpt4o-images](https://github.com/jamez-bondos/awesome-gpt4o-images#cases-59) · @michaelrabone |
| 纸上的秘密花园 | illustration · 1024x1024 | [awesome-gpt4o-images](https://github.com/jamez-bondos/awesome-gpt4o-images#cases-52) · @egeberkina |
| 一件春天的衣服 | fashion · 1024x1536 | [awesome-gpt4o-images](https://github.com/jamez-bondos/awesome-gpt4o-images#cases-49) · @dotey |
| 把海装进口袋 | commerce · 1536x1024 | [awesome-gpt4o-images](https://github.com/jamez-bondos/awesome-gpt4o-images#cases-65) · @madpencil_ |
| 云端咖啡馆 | space · 1536x1024 | [awesome-gpt4o-images](https://github.com/jamez-bondos/awesome-gpt4o-images#cases-56) · @dotey |
| 黄铜游梦 | threeD · 1024x1024 | [awesome-gpt4o-images](https://github.com/jamez-bondos/awesome-gpt4o-images#cases-64) · @f-is-h |
| 山河在心里 | fashion · 1024x1536 | [awesome-gpt4o-images](https://github.com/jamez-bondos/awesome-gpt4o-images#cases-86) · rezzycheck (Sora) |
| 月亮也需要晚安 | illustration · 1536x1024 | [awesome-gpt4o-images](https://github.com/jamez-bondos/awesome-gpt4o-images#cases-39) · @dotey |
| 口袋里的小伙伴 | threeD · 1024x1024 | [awesome-gpt4o-images](https://github.com/jamez-bondos/awesome-gpt4o-images#cases-97) · @ZHO_ZHO_ZHO |
| 午夜之后的线索 | manga · 1024x1024 | [Awesome-Nano-Banana-images](https://github.com/PicoTrex/Awesome-Nano-Banana-images/blob/main/README.md) · @GeminiApp |
| 声音的柔软形状 | poster · 1024x1536 | [awesome-gpt4o-images](https://github.com/jamez-bondos/awesome-gpt4o-images#cases-37) · @aziz4ai（案例标题） / @op7418（图片署名） |

`soft-sound` 的源仓库案例标题与图片署名存在不一致，保留两者并注明位置，没有将其推断为同一作者。

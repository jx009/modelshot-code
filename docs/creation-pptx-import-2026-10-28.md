# PPTX 导入与 Cheso 实际操作记录（2026-10-28）

## 浏览器观察

在用户的 Edge 浏览器中，使用其已上传的《粮安天下籽籽同心——10分钟主题微课课件(1).pptx》，只发送一次获准的最小修改请求：封面副标题字号稍大、增加字距，其余页面保持原样。

- 附件约 11.1 MiB；上传后最初仅显示附件。发送修改请求后，页面显示解析文档、PPT 工具、查看和修改页面的步骤。
- 文件列表保留原始附件，另外生成 .vppt 与素材文件夹，结果有 13 页。
- 页面回复称封面副标题从 37.3 调到 41 px，字距 2.5 px，保留 18 张图片。未逐页比对，不能将回复当作完整保真证据。
- 实际进入编辑并双击副标题，看到文字选区与 41 字号工具栏，证明结果中的该段文字仍可编辑。没有再手动修改或发送第二次 AI 请求。
- 账号积分由 1260 变为 1142，界面净变化 118。
- 截图：artifacts/cheso-ppt-import-edit-20261028.png。浏览器结果保留供用户查看。

以上为可观察工作流，不代表掌握 Cheso 的私有转换器或提示词。

## 本项目调整

- PPT 工作区支持拖入一个 PPTX；对话框附件旁增加导入入口，导入进度不再依赖文件树展开。
- 前端、HTTP、存储读取、ZIP 入口与隔离子进程统一 PPTX 32 MiB 限额；DOCX/XLSX 和参考资料提取维持原有 4 MiB。
- 显示上传、等待转换、转换中、成功和失败，保留原件下载；成功自动刷新并打开副本。转换期间开始其他编辑时不抢占当前文件，可手动打开。
- 文本与图片转换到既有 HTML 幻灯片编辑器；给源段落和文字 run 分配编辑标识。打开后可直接编辑，也可选中页面使用现有 AI 编辑入口。导入本身不调用付费模型。
- 素材从最多 16 个提高到 128 个独立包内资源；重复图片复用，数量超限明确失败，不静默跳过。现有每页 20 个资源约束仍有效。
- JPEG 照片经校验后仍输出 JPEG，避免全部膨胀为 PNG；PNG/SVG 等由隔离解码器归一化。
- 修复可选图表标题等节点缺失导致的异常；补充裁切、基本透明度/线性渐变、无边框、文本内边距、垂直对齐、行距、字距和整数页面尺寸。
- 心跳协议升为 office-import-3，拒绝旧 Worker 接收新规格文件。

## 部署

Web 与导入 Worker 必须升级到同一版本；只更新 Web 不够。Web 环境配置 CREATION_OFFICE_IMPORT_ENABLED=true。PPT 导入不需要 CREATION_NATIVE_OFFICE_ENABLED；DOCX/XLSX 原有门控不变。

已有独立导出服务：继续使用 compose.creation-export.yaml，重建并更新其专用镜像，不要再启动同一队列的另一个不同能力 Worker。

没有独立导出服务：compose.prod.yaml 增加可选 office-import profile，复用本次应用镜像，但在单独非 root、只读、限额容器中运行。仅在发布并检查服务器资源后由运维执行：

```sh
docker compose --env-file .env.production -f compose.prod.yaml --profile office-import up -d --no-build creation-export
docker compose --env-file .env.production -f compose.prod.yaml up -d --no-build web
docker compose --env-file .env.production -f compose.prod.yaml logs --no-color --tail=100 creation-export
```

此基础 Worker 不宣告 HTML/PDF 光栅化能力；如需相关导出，使用现有专用导出镜像方案。默认 up 不会启动新服务。以上命令本次未执行。

## 边界与验证

用户选择仅静态校验；未运行测试、构建、安装依赖、开发服务、Docker 或本地样本转换，未推送。为 CI 增加拖入、大小边界、Worker 版本、编辑期间完成、超 16 图、资源去重、图表缺省项、可编辑文本标识和裁切样式用例。

本轮 15 个代码/测试文件的限定 ESLint 通过；新增 CSS 的 PostCSS 解析、生产 Compose 的 YAML 解析及 profile/隔离环境配置核对、git diff --check 通过。这些静态结果不替代运行验收，CI 尚未执行本次未推送的改动。

样本仅做只读 ZIP/图片元数据检查：11,630,042 字节、13 页、18 个媒体文件（另有目录项），最大文件约 3.3 MiB。不能据此声称本项目已成功转换此样本。

仍有兼容性限制：旧 .ppt 不支持；组内对象、母版/占位符继承、主题字体/颜色、复杂绘图、动画等未完整覆盖，部分仅保留在原件；每页 20 个资源、展开总量 32 MiB、单 ZIP 项 8 MiB、32 MiB 转换媒体、单图 1600 万像素、30 秒子进程预算仍保留。导入副本不是原 OOXML 的无损回写，不宣称任意 PPT 完全一致或达到 Cheso 同等性能。

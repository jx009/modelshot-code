# 创作功能开放权限

管理员页面：**系统设置 → 创作功能开放权限**。root 修改开关后点击「保存创作权限」，按现有管理操作流程填写原因。普通管理员可查看，不能修改。

- 关闭：仅状态正常的 root 可进入、使用该功能。
- 开启：状态正常的已登录用户均可进入、使用。
- 普通用户进入模块，需要同时开启「创作工作台」和对应模块。AI 生成还需要开启「AI 创作任务」。图片画布的创作任务只依赖任务开关。
- root 仅绕过这七项开放权限，不绕过资源归属、积分、Worker 就绪状态和其他功能开关。

七项对应环境变量：`CREATION_WORKSPACE_ENABLED`、`CREATION_RUNS_ENABLED`、`CREATION_POSTER_ENABLED`、`CREATION_SLIDES_ENABLED`、`CREATION_DOCUMENT_ENABLED`、`CREATION_SHEET_ENABLED`、`CREATION_WEB_ENABLED`。

未保存时沿用各环境变量默认值；保存后使用 SystemConfig 的 `creation_access` 配置，不需要数据库迁移或重启。接口逐次读取最新配置，已打开页面刷新后更新入口。原有正在执行的 Worker 任务不因开放权限关闭而被强行终止，用户仍可取消自己的在途任务。

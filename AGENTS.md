## 服务器资源限制

- 当前服务器资源很小，默认只做轻量、限定到改动文件的静态代码校验。
- 未经用户本次明确许可，不运行构建、测试套件、依赖安装，也不启动开发服务或测试基础设施。
- 不并行运行校验任务；避免全仓扫描和其他高 CPU、高内存操作。
- 需要构建或运行测试时，说明待验证项，交由 CI 或资源充足的环境执行。

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

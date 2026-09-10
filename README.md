# ModelShot

AI 服装模特图工坊 —— 面向电商卖家的专业模特上身图生成 SaaS。

上传服装平铺图，选择模特 / 场景 / 平台尺寸，一键批量生成可商用、可过审的模特上身图。

## 技术栈

- **框架**：Next.js (App Router) + React
- **数据库**：PostgreSQL + Prisma
- **认证**：NextAuth（Google OAuth + API Key）
- **支付**：Stripe（积分制）
- **AI**：多模型可插拔 Adapter 层（OpenAI gpt-image / Gemini / FASHN.ai，后台可配置）

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量
cp .env.example .env   # 填入数据库连接串、OAuth、API Key

# 3. 推送数据库 Schema
npx prisma db push

# 4. 启动开发服务器
npm run dev
```

## 目录结构（核心）

```
src/
├── app/            # 页面 + API 路由
│   ├── api/        # tryon / tryons / upload / checkout / webhook
│   ├── gallery/    # 生成结果画廊
│   └── pricing/    # 定价页
├── components/     # UI 组件
└── lib/            # config / auth / prisma / services
prisma/             # schema + seed
```

## 开发计划

参见开发方案文档：模型 Adapter 层 → Prompt 模板引擎 → QA Pipeline → 合规元数据 → Admin 后台。
"# modelshot-code" 

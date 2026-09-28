import createNextIntlPlugin from "next-intl/plugin";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.js");

const signingEnabled = process.env.C2PA_ENABLED === "1" && process.env.C2PA_DISABLED !== "1";
if (signingEnabled) {
  if (!process.env.C2PA_CERT_PATH || !process.env.C2PA_KEY_PATH) {
    throw new Error("C2PA signing requires certificate and key paths before building.");
  }
  try { createRequire(import.meta.url).resolve("c2pa-node"); }
  catch { throw new Error("C2PA is enabled but its optional native dependency is not installed."); }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  // c2pa-node 含 napi 原生二进制，不能打包进 ESM chunk，需作为外部依赖
  serverExternalPackages: signingEnabled ? ["c2pa-node"] : [],

  // 优化 chunk 分割，减少首屏加载体积
  experimental: {
    optimizePackageImports: ["lucide-react", "framer-motion"],
  },

  turbopack: {
    resolveAlias: signingEnabled ? {} : { "c2pa-node": "./src/lib/c2pa-disabled.js" },
  },

  webpack(config, { isServer }) {
    if (!signingEnabled) config.resolve.alias["c2pa-node"] = fileURLToPath(new URL("./src/lib/c2pa-disabled.js", import.meta.url));

    // 客户端优化：标记大型库为异步加载
    if (!isServer) {
      config.optimization = config.optimization || {};
      config.optimization.splitChunks = {
        ...config.optimization.splitChunks,
        cacheGroups: {
          ...config.optimization.splitChunks?.cacheGroups,
          // 将 Konva 单独打包成独立 chunk
          konva: {
            test: /[\\/]node_modules[\\/](konva|react-konva)[\\/]/,
            name: "konva",
            chunks: "async",
            priority: 10,
          },
          // 将大型 UI 库单独打包
          uiLibs: {
            test: /[\\/]node_modules[\\/](framer-motion|lucide-react)[\\/]/,
            name: "ui-libs",
            chunks: "async",
            priority: 9,
          },
        },
      };
    }

    return config;
  },
};

export default withNextIntl(nextConfig);

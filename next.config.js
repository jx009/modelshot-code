import createNextIntlPlugin from "next-intl/plugin";
import { createRequire } from "node:module";
import { deploymentAssetConfig } from "./src/lib/deployment-assets.mjs";

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
  ...deploymentAssetConfig(),
  // c2pa-node 含 napi 原生二进制，不能打包进 ESM chunk，需作为外部依赖
  serverExternalPackages: signingEnabled ? ["c2pa-node"] : [],

  // 自动记忆化组件与 hooks；项目已开启 react-hooks 的编译器规则（refs / purity /
  // immutability 等）并通过 lint，代码满足编译器前提。
  reactCompiler: true,

  experimental: {
    optimizePackageImports: ["lucide-react"],
    // Reuse recently visited page shells on this browser. User data is still
    // loaded through authenticated APIs; this is not shared server caching.
    staleTimes: { dynamic: 30, static: 300 },
  },

  turbopack: {
    resolveAlias: signingEnabled ? {} : { "c2pa-node": "./src/lib/c2pa-disabled.js" },
  },
};

export default withNextIntl(nextConfig);

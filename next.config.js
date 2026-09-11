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
  turbopack: {
    resolveAlias: signingEnabled ? {} : { "c2pa-node": "./src/lib/c2pa-disabled.js" },
  },
  webpack(config) {
    if (!signingEnabled) config.resolve.alias["c2pa-node"] = fileURLToPath(new URL("./src/lib/c2pa-disabled.js", import.meta.url));
    return config;
  },
};

export default withNextIntl(nextConfig);

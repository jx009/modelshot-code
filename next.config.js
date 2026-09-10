import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.js");

/** @type {import('next').NextConfig} */
const nextConfig = {
  // c2pa-node 含 napi 原生二进制，不能打包进 ESM chunk，需作为外部依赖
  serverExternalPackages: ["c2pa-node"],
};

export default withNextIntl(nextConfig);

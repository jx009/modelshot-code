// Next 16.2+ reuses BUILD_ID when deploymentId is enabled. A query string
// cannot isolate files on the HK filesystem, so give each image its own path.
export function deploymentAssetConfig(env = process.env) {
  const deploymentId = env.NEXT_DEPLOYMENT_ID || undefined;
  const namespace = env.NEXT_STATIC_ASSET_NAMESPACE || deploymentId;
  if (!namespace) return {};
  if (!deploymentId || !/^[a-zA-Z0-9_-]{1,160}$/.test(namespace)) {
    throw new Error("Static asset namespace requires a deployment ID and a safe path segment.");
  }
  // Keep the prefix under the existing HK Nginx /_next/static/ location.
  const assetPrefix = `/_next/static/releases/${namespace}`;
  return {
    deploymentId,
    assetPrefix,
    async rewrites() {
      return {
        // Only this image's namespace can fall back to this origin. Never
        // serve current files under an old release's immutable URL.
        beforeFiles: [{
          source: `${assetPrefix}/_next/static/:path*`,
          destination: "/_next/static/:path*",
        }],
        afterFiles: [],
        fallback: [],
      };
    },
  };
}

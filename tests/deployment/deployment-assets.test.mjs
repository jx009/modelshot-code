import assert from "node:assert/strict";
import { test } from "node:test";
import { deploymentAssetConfig } from "../../src/lib/deployment-assets.mjs";

test("unversioned local development keeps default asset URLs", () => {
  assert.deepEqual(deploymentAssetConfig({}), {});
});

test("the same deployment has separate URL namespaces per architecture", async () => {
  const deploymentId = "build-abc-123-1";
  const configs = ["amd64", "arm64"].map((arch) => deploymentAssetConfig({
    NEXT_DEPLOYMENT_ID: deploymentId,
    NEXT_STATIC_ASSET_NAMESPACE: `${deploymentId}-${arch}`,
  }));
  assert.notEqual(configs[0].assetPrefix, configs[1].assetPrefix);
  for (const config of configs) {
    assert.equal(config.deploymentId, deploymentId);
    assert.ok(config.assetPrefix.startsWith("/_next/static/releases/"));
    assert.deepEqual(await config.rewrites(), {
      beforeFiles: [{
        source: `${config.assetPrefix}/_next/static/:path*`,
        destination: "/_next/static/:path*",
      }],
      afterFiles: [],
      fallback: [],
    });
  }
});

test("the next release has a new path even though Next reuses BUILD_ID", () => {
  const first = deploymentAssetConfig({ NEXT_DEPLOYMENT_ID: "build-abc-123-1" });
  const second = deploymentAssetConfig({ NEXT_DEPLOYMENT_ID: "build-abc-123-2" });
  assert.notEqual(first.assetPrefix, second.assetPrefix);
});

test("invalid namespaces fail before generating routes", () => {
  for (const namespace of ["../escape", "/absolute", "a/b", "a?b", "a:b", "a".repeat(161)]) {
    assert.throws(() => deploymentAssetConfig({
      NEXT_DEPLOYMENT_ID: "build-abc-123-1", NEXT_STATIC_ASSET_NAMESPACE: namespace,
    }), /safe path segment/);
  }
  assert.throws(() => deploymentAssetConfig({ NEXT_STATIC_ASSET_NAMESPACE: "orphan" }), /deployment ID/);
});

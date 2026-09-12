import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { transformWithOxc } from "vite";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  plugins: [{
    name: "jsx-in-source-js",
    enforce: "pre",
    async transform(code, id) {
      if (!/[/\\]src[/\\].*\.js$/.test(id)) return null;
      const result = await transformWithOxc(code, id, { lang: "jsx", jsx: { runtime: "automatic" } });
      return { code: result.code, map: result.map };
    },
  }],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/unit/**/*.test.{js,jsx,mjs}"],
          clearMocks: true,
          restoreMocks: true,
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.mjs"],
          globalSetup: ["./tests/support/migrate.mjs"],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});

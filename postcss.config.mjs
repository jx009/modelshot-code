import { fileURLToPath } from "node:url";

const config = {
  plugins: {
    [fileURLToPath(new URL("./scripts/postcss/univer-isolation.cjs", import.meta.url))]: {},
    "@tailwindcss/postcss": {},
  },
};

export default config;

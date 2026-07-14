import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const localGuoAssetsAvailable = existsSync(resolve(process.cwd(), "public/local-assets/guo-3d-assets"));

export default defineConfig({
  base: "./",
  assetsInclude: ["**/*.fbx", "**/*.obj"],
  plugins: [react()],
  define: {
    __LOCAL_GUO_ASSETS_AVAILABLE__: JSON.stringify(localGuoAssetsAvailable),
  },
  test: {
    environment: "jsdom",
    globals: true,
    pool: "threads",
    maxWorkers: 1,
    setupFiles: "./src/test/setup.ts",
  },
});

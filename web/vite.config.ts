import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { parseChangelog } from "./src/lib/release";

const webDir = dirname(fileURLToPath(import.meta.url));
const localVersion = readFileSync(resolve(webDir, "../VERSION"), "utf8").trim() || "dev";
const localChangelog = readFileSync(resolve(webDir, "../CHANGELOG.md"), "utf8");
const localGuoAssetsAvailable = existsSync(resolve(webDir, "public/local-assets/guo-3d-assets"));

export default defineConfig({
    plugins: [react()],
    server: {
        proxy: {
            "/api/v3/tts": {
                target: "https://openspeech.bytedance.com",
                changeOrigin: true,
                secure: true,
            },
            "/api/proxy/voicebox": {
                target: "http://127.0.0.1:17493",
                changeOrigin: true,
                rewrite: (requestPath) => requestPath.replace(/^\/api\/proxy\/voicebox/, ""),
            },
            "/api/proxy/meaicc/pricing": {
                target: "https://api.meaicc.com",
                changeOrigin: true,
                secure: true,
                rewrite: () => "/api/pricing",
            },
        },
    },
    resolve: {
        alias: {
            "@": resolve(webDir, "src"),
        },
    },
    define: {
        __APP_VERSION__: JSON.stringify(localVersion),
        __APP_RELEASES__: JSON.stringify(parseChangelog(localChangelog)),
        __LOCAL_GUO_ASSETS_AVAILABLE__: JSON.stringify(localGuoAssetsAvailable),
    },
});

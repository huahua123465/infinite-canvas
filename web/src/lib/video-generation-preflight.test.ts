import { describe, expect, it } from "vitest";

import { defaultConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import { validateVideoGenerationParameters } from "./video-generation-preflight";

describe("validateVideoGenerationParameters", () => {
    it("allows five local Base64 images for fixed-resolution Cangyuan Seedance", () => {
        const model = "seedance-2.0-720p";
        const references: ReferenceImage[] = Array.from({ length: 5 }, (_, index) => ({ id: `${index}`, name: `reference-${index + 1}.png`, type: "image/png", dataUrl: "data:image/png;base64,AA==" }));
        const issues = validateVideoGenerationParameters({
            config: {
                ...defaultConfig,
                baseUrl: "https://ai.cangyuansuanli.cn/v1",
                apiFormat: "cangyuan",
                channels: [{ id: "cangyuan", name: "沧元算力", baseUrl: "https://ai.cangyuansuanli.cn/v1", apiKey: "test", apiFormat: "cangyuan", models: [model] }],
                model,
                videoModel: model,
                videoSeconds: "8",
                vquality: "720p",
                size: "16:9",
            },
            prompt: "@image1 的人物参考 @image2 到 @image5 的造型生成视频",
            references,
            videoReferences: [],
            audioReferences: [],
        });

        expect(issues.filter((issue) => issue.level === "blocked")).toEqual([]);
    });
});

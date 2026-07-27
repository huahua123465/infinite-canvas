import { describe, expect, it } from "vitest";

import { defaultConfig, encodeChannelModel } from "@/stores/use-config-store";
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

    it("blocks the fifth image before a Cangyuan 720p reference-video request reaches videos-4", () => {
        const model = "seedance-2.0-720p";
        const requestModel = encodeChannelModel("cangyuan", model);
        const references: ReferenceImage[] = Array.from({ length: 5 }, (_, index) => ({ id: `${index}`, name: `reference-${index + 1}.png`, type: "image/png", dataUrl: "data:image/png;base64,AA==" }));
        const issues = validateVideoGenerationParameters({
            config: {
                ...defaultConfig,
                baseUrl: "https://example.com/v1",
                apiFormat: "openai",
                channels: [
                    { id: "other", name: "其他渠道", baseUrl: "https://example.com/v1", apiKey: "test", apiFormat: "openai", models: [model] },
                    { id: "cangyuan", name: "沧元算力", baseUrl: "https://ai.cangyuansuanli.cn/v1", apiKey: "test", apiFormat: "cangyuan", models: [model] },
                ],
                model: requestModel,
                videoModel: requestModel,
                videoSeconds: "8",
                vquality: "720p",
                size: "16:9",
            },
            prompt: "@image1 到 @image5 参考 @video1 的动作生成视频",
            references,
            videoReferences: [{ id: "video", name: "video.mp4", type: "video/mp4", url: "blob:local-video", storageKey: "video:local", width: 1280, height: 720, durationMs: 8_000 }],
            audioReferences: [],
        });

        expect(issues.find((issue) => issue.code === "seedance_images")?.message).toBe("当前线路最多支持 4 张参考图，请移除多余图片");
    });

    it("allows a local Cangyuan Seedance video for automatic temporary publishing", () => {
        const model = "seedance-2.0";
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
            prompt: "参考@image1的人物和@video1的动作生成视频",
            references: [{ id: "image", name: "image.png", type: "image/png", dataUrl: "data:image/png;base64,AA==" }],
            videoReferences: [{ id: "video", name: "video.mp4", type: "video/mp4", url: "blob:local-video", storageKey: "video:local", width: 1280, height: 720, durationMs: 8_000 }],
            audioReferences: [],
        });

        expect(issues.filter((issue) => issue.level === "blocked")).toEqual([]);
    });
});

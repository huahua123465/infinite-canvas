import { describe, expect, it } from "vitest";

import { isCangyuanSeedanceFramePair, videoReferenceLimits } from "./video-model-capabilities";

describe("Cangyuan public video model reference limits", () => {
    it.each([
        ["seedance-2.0", 4, 3, 1],
        ["seedance-2.0-fast", 4, 3, 1],
        ["seedance-2.0-mini", 4, 3, 1],
        ["seedance-2.0-mini-8s", 4, 3, 1],
        ["seedance-2.0-480p", 9, 3, 3],
        ["seedance-2.0-720p", 9, 3, 3],
        ["seedance-2.0-1080p", 9, 3, 3],
        ["seedance-2.0-4k", 9, 3, 3],
        ["seedance-2.0-fast-480p", 9, 3, 3],
        ["seedance-2.0-fast-720p", 9, 3, 3],
        ["seedance-2.0-mini-480p", 9, 3, 3],
        ["seedance-2.0-mini-720p", 9, 3, 3],
        ["sd5-seedance-2.0", 9, 3, 3],
        ["sd5-seedance-2.0-fast", 9, 3, 3],
        ["omni-fast", 5, 0, 0],
        ["omni-fast-no-water", 5, 0, 0],
        ["omni-v2v", 0, 1, 0],
        ["omni-v2v-no-water", 0, 1, 0],
        ["sora-2", 1, 0, 0],
        ["sora-2-pro", 1, 0, 0],
    ] as Array<[string, number, number, number]>)("%s exposes %i image / %i video / %i audio references", (model, images, videos, audios) => {
        expect(videoReferenceLimits(model)).toEqual({ images, videos, audios });
    });
});

describe("Cangyuan Seedance reference mode", () => {
    const firstFrame = { id: "first", name: "first.png", type: "image/png", dataUrl: "data:image/png;base64,AA==", videoReferenceRole: "firstFrame" as const };
    const lastFrame = { id: "last", name: "last.png", type: "image/png", dataUrl: "data:image/png;base64,AA==", videoReferenceRole: "lastFrame" as const };

    it("uses frame-pair fields only for an exclusive first/last pair", () => {
        expect(isCangyuanSeedanceFramePair([firstFrame, lastFrame], 0, 0)).toBe(true);
    });

    it("keeps all images in full-reference mode when a reference video is present", () => {
        expect(isCangyuanSeedanceFramePair([firstFrame, lastFrame], 1, 0)).toBe(false);
    });
});

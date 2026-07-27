import { describe, expect, it } from "vitest";

import { videoReferenceLimits } from "./video-model-capabilities";

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

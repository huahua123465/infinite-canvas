import { describe, expect, it } from "vitest";

import { documentedModelPricingNames, formatModelPricing, modelPricingReferenceLimits } from "./model-pricing";

describe("MEAICC model catalog metadata", () => {
    it.each([
        ["9 图 / 3 视频 / 3 音频 / 原生真人", 9, 3, 3],
        ["4 图 / 3 视频 / 1 音频 / 原生真人", 4, 3, 1],
        ["9 图 / 3 视频 / 0 音频 / 原生真人", 9, 3, 0],
    ])("parses %s", (description, images, videos, audios) => {
        expect(modelPricingReferenceLimits({ description })).toEqual({ images, videos, audios });
    });

    it("formats per-generation prices in the provider currency", () => {
        expect(formatModelPricing({ model_price: 3, quota_type: 1 }, undefined, "$")).toEqual({
            label: "$3/次",
            unitLabel: undefined,
            title: "$3/次",
        });
    });

    it("lists documented marketplace models independently from /v1/models aliases", () => {
        expect(documentedModelPricingNames({
            "sd-2-c3": { model_name: "sd-2-c3", model_price: 2, description: "9 图 / 3 视频 / 3 音频 / 原生真人" },
            alias: { model_name: "seedance-2.0", model_price: 2 },
            "sd-2-c2": { model_name: "sd-2-c2", model_price: 2.5, description: "9 图 / 3 视频 / 3 音频 / 后台过真人" },
        })).toEqual(["sd-2-c2", "sd-2-c3"]);
    });
});

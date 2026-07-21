import { CANGYUAN_SD5_SEEDANCE_REFERENCE_LIMITS, CANGYUAN_SD5_SEEDANCE_REFERENCE_TOTAL_LIMIT, isCangyuanSd5SeedanceModel, seedanceModelFixedResolution } from "@/lib/seedance-video";
import { modelOptionName, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";

export type VideoReferenceLimits = Readonly<{
    images: number;
    videos: number;
    audios: number;
}>;

const SEEDANCE_STANDARD_REFERENCE_LIMITS: VideoReferenceLimits = { images: 4, videos: 3, audios: 1 };
const SEEDANCE_FIXED_REFERENCE_LIMITS: VideoReferenceLimits = { images: 9, videos: 3, audios: 3 };
const GROK_VIDEO_REFERENCE_LIMITS: VideoReferenceLimits = { images: 7, videos: 1, audios: 0 };
const GROK_VIDEO_15_REFERENCE_LIMITS: VideoReferenceLimits = { images: 1, videos: 0, audios: 0 };
const OMNI_IMAGE_REFERENCE_LIMITS: VideoReferenceLimits = { images: 5, videos: 0, audios: 0 };
const OMNI_VIDEO_REFERENCE_LIMITS: VideoReferenceLimits = { images: 0, videos: 1, audios: 0 };
const SORA_VIDEO_REFERENCE_LIMITS: VideoReferenceLimits = { images: 1, videos: 0, audios: 0 };
const VEO_VIDEO_REFERENCE_LIMITS: VideoReferenceLimits = { images: 2, videos: 0, audios: 0 };
const VEO_REFERENCE_VIDEO_LIMITS: VideoReferenceLimits = { images: 3, videos: 0, audios: 0 };

export function videoReferenceLimits(model: string) {
    const name = modelOptionName(model).toLowerCase();
    if (isCangyuanSd5SeedanceModel(name)) return CANGYUAN_SD5_SEEDANCE_REFERENCE_LIMITS;
    if (name.startsWith("seedance-2.0")) return seedanceModelFixedResolution(name) ? SEEDANCE_FIXED_REFERENCE_LIMITS : SEEDANCE_STANDARD_REFERENCE_LIMITS;
    if (name.startsWith("grok-video-1.5")) return GROK_VIDEO_15_REFERENCE_LIMITS;
    if (name.startsWith("grok-video")) return GROK_VIDEO_REFERENCE_LIMITS;
    if (name === "omni-fast" || name === "omni-fast-no-water") return OMNI_IMAGE_REFERENCE_LIMITS;
    if (name === "omni-v2v" || name === "omni-v2v-no-water") return OMNI_VIDEO_REFERENCE_LIMITS;
    if (name === "sora-2" || name === "sora-2-pro" || name === "sora2") return SORA_VIDEO_REFERENCE_LIMITS;
    if (isVeoVideoModel(name)) return isVeoReferenceVideoModel(name) ? VEO_REFERENCE_VIDEO_LIMITS : VEO_VIDEO_REFERENCE_LIMITS;
    return null;
}

export function isOmniImageVideoModel(model: string) {
    const name = modelOptionName(model).toLowerCase();
    return name === "omni-fast" || name === "omni-fast-no-water";
}

export function isOmniVideoToVideoModel(model: string) {
    const name = modelOptionName(model).toLowerCase();
    return name === "omni-v2v" || name === "omni-v2v-no-water";
}

export function isSoraVideoModel(model: string) {
    const name = modelOptionName(model).toLowerCase();
    return name === "sora-2" || name === "sora-2-pro" || name === "sora2";
}

export function isVeoVideoModel(model: string) {
    const name = modelOptionName(model).toLowerCase();
    return name === "veo-3-1" || name === "veo-3-1-fast" || name === "veo-3-1-ref";
}

export function isVeoReferenceVideoModel(model: string) {
    return modelOptionName(model).toLowerCase() === "veo-3-1-ref";
}

export function videoReferenceLimitsLabel(model: string) {
    const limits = videoReferenceLimits(model);
    return limits ? `${limits.images}·${limits.videos}·${limits.audios}` : "待核对";
}

export function videoReferenceLimitsTitle(model: string) {
    const limits = videoReferenceLimits(model);
    return limits ? `参考素材上限：图片 ${limits.images} 张 · 视频 ${limits.videos} 条 · 音频 ${limits.audios} 条${isCangyuanSd5SeedanceModel(model) ? ` · 合计 ${CANGYUAN_SD5_SEEDANCE_REFERENCE_TOTAL_LIMIT} 个` : ""}` : "该模型的参考素材上限尚未完成官方文档核对";
}

export function cangyuanSeedanceFixedResolution(config: AiConfig, selectedModel = config.model || config.videoModel) {
    const model = modelOptionName(selectedModel);
    const fixedResolution = seedanceModelFixedResolution(model);
    if (!fixedResolution) return "";
    const requestConfig = resolveModelRequestConfig(config, selectedModel);
    return requestConfig.apiFormat === "cangyuan" || requestConfig.baseUrl.toLowerCase().includes("ai.cangyuansuanli.cn") ? fixedResolution : "";
}

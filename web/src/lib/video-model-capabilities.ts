import { CANGYUAN_SD5_SEEDANCE_REFERENCE_LIMITS, CANGYUAN_SD5_SEEDANCE_REFERENCE_TOTAL_LIMIT, isCangyuanSd5SeedanceModel, seedanceModelFixedResolution } from "@/lib/seedance-video";
import { modelOptionName, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";

export type VideoReferenceLimits = Readonly<{
    images: number;
    videos: number;
    audios: number;
}>;

export type VideoReferenceCapability = Readonly<{
    limits: VideoReferenceLimits;
    documentedLimits: VideoReferenceLimits;
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
const CANGYUAN_VIDEO_ROUTE_IMAGE_LIMITS: Record<string, number> = {
    "seedance-2.0-720p": 4,
    "seedance-2.0-mini-720p": 4,
};

// Mirrors the public-model referenceLimits exposed by Cangyuan's VIDEO pricing metadata.
const CANGYUAN_PUBLIC_VIDEO_REFERENCE_LIMITS: Record<string, VideoReferenceLimits> = {
    "seedance-2.0": SEEDANCE_STANDARD_REFERENCE_LIMITS,
    "seedance-2.0-fast": SEEDANCE_STANDARD_REFERENCE_LIMITS,
    "seedance-2.0-mini": SEEDANCE_STANDARD_REFERENCE_LIMITS,
    "seedance-2.0-mini-8s": SEEDANCE_STANDARD_REFERENCE_LIMITS,
    "seedance-2.0-480p": SEEDANCE_FIXED_REFERENCE_LIMITS,
    "seedance-2.0-720p": SEEDANCE_FIXED_REFERENCE_LIMITS,
    "seedance-2.0-1080p": SEEDANCE_FIXED_REFERENCE_LIMITS,
    "seedance-2.0-4k": SEEDANCE_FIXED_REFERENCE_LIMITS,
    "seedance-2.0-fast-480p": SEEDANCE_FIXED_REFERENCE_LIMITS,
    "seedance-2.0-fast-720p": SEEDANCE_FIXED_REFERENCE_LIMITS,
    "seedance-2.0-mini-480p": SEEDANCE_FIXED_REFERENCE_LIMITS,
    "seedance-2.0-mini-720p": SEEDANCE_FIXED_REFERENCE_LIMITS,
    "sd5-seedance-2.0": CANGYUAN_SD5_SEEDANCE_REFERENCE_LIMITS,
    "sd5-seedance-2.0-fast": CANGYUAN_SD5_SEEDANCE_REFERENCE_LIMITS,
    "omni-fast": OMNI_IMAGE_REFERENCE_LIMITS,
    "omni-fast-no-water": OMNI_IMAGE_REFERENCE_LIMITS,
    "omni-v2v": OMNI_VIDEO_REFERENCE_LIMITS,
    "omni-v2v-no-water": OMNI_VIDEO_REFERENCE_LIMITS,
    "sora-2": SORA_VIDEO_REFERENCE_LIMITS,
    "sora-2-pro": SORA_VIDEO_REFERENCE_LIMITS,
};

export function videoReferenceCapability(model: string): VideoReferenceCapability | null {
    const name = modelOptionName(model).toLowerCase();
    let documentedLimits = CANGYUAN_PUBLIC_VIDEO_REFERENCE_LIMITS[name] || null;
    if (!documentedLimits && isCangyuanSd5SeedanceModel(name)) documentedLimits = CANGYUAN_SD5_SEEDANCE_REFERENCE_LIMITS;
    else if (!documentedLimits && name.startsWith("seedance-2.0")) documentedLimits = seedanceModelFixedResolution(name) ? SEEDANCE_FIXED_REFERENCE_LIMITS : SEEDANCE_STANDARD_REFERENCE_LIMITS;
    else if (!documentedLimits && name.startsWith("grok-video-1.5")) documentedLimits = GROK_VIDEO_15_REFERENCE_LIMITS;
    else if (!documentedLimits && name.startsWith("grok-video")) documentedLimits = GROK_VIDEO_REFERENCE_LIMITS;
    else if (!documentedLimits && name === "sora2") documentedLimits = SORA_VIDEO_REFERENCE_LIMITS;
    else if (!documentedLimits && isVeoVideoModel(name)) documentedLimits = isVeoReferenceVideoModel(name) ? VEO_REFERENCE_VIDEO_LIMITS : VEO_VIDEO_REFERENCE_LIMITS;
    if (!documentedLimits) return null;
    return { documentedLimits, limits: documentedLimits };
}

export function videoReferenceLimits(model: string) {
    return videoReferenceCapability(model)?.limits || null;
}

export function cangyuanEffectiveVideoReferenceLimits(model: string, videoReferenceCount: number) {
    const documented = videoReferenceLimits(model);
    if (!documented || !videoReferenceCount) return documented;
    const routeImageLimit = CANGYUAN_VIDEO_ROUTE_IMAGE_LIMITS[modelOptionName(model).toLowerCase()];
    return routeImageLimit ? { ...documented, images: Math.min(documented.images, routeImageLimit) } : documented;
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
    const capability = videoReferenceCapability(model);
    if (!capability) return "待核对";
    return `${capability.limits.images}·${capability.limits.videos}·${capability.limits.audios}`;
}

export function videoReferenceLimitsTitle(model: string) {
    const capability = videoReferenceCapability(model);
    if (!capability) return "该模型的参考素材上限尚未完成官方文档核对";
    return `参考素材上限：图片 ${capability.limits.images} 张 · 视频 ${capability.limits.videos} 条 · 音频 ${capability.limits.audios} 条${isCangyuanSd5SeedanceModel(model) ? ` · 合计 ${CANGYUAN_SD5_SEEDANCE_REFERENCE_TOTAL_LIMIT} 个` : ""}`;
}

export function cangyuanSeedanceFixedResolution(config: AiConfig, selectedModel = config.model || config.videoModel) {
    const model = modelOptionName(selectedModel);
    const fixedResolution = seedanceModelFixedResolution(model);
    if (!fixedResolution) return "";
    const requestConfig = resolveModelRequestConfig(config, selectedModel);
    return requestConfig.apiFormat === "cangyuan" || requestConfig.baseUrl.toLowerCase().includes("ai.cangyuansuanli.cn") ? fixedResolution : "";
}

export function isCangyuanSeedanceFramePair(
    references: ReferenceImage[],
    videoReferenceCount: number,
    audioReferenceCount: number,
) {
    return references.length === 2
        && !videoReferenceCount
        && !audioReferenceCount
        && references.some((item) => item.videoReferenceRole === "firstFrame")
        && references.some((item) => item.videoReferenceRole === "lastFrame");
}

import { CANGYUAN_SD5_SEEDANCE_REFERENCE_LIMITS, CANGYUAN_SD5_SEEDANCE_REFERENCE_TOTAL_LIMIT, isCangyuanSd5SeedanceModel, seedanceModelFixedResolution } from "@/lib/seedance-video";
import { modelOptionName, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";

export type VideoReferenceLimits = Readonly<{
    images: number;
    videos: number;
    audios: number;
}>;

export type VideoReferenceCapability = Readonly<{
    limits: VideoReferenceLimits;
    documentedLimits: VideoReferenceLimits;
    route?: string;
    routeImageLimit?: number;
}>;

type VideoReferenceContext = {
    config?: AiConfig;
    videoCount?: number;
    audioCount?: number;
};

const SEEDANCE_STANDARD_REFERENCE_LIMITS: VideoReferenceLimits = { images: 4, videos: 3, audios: 1 };
const SEEDANCE_FIXED_REFERENCE_LIMITS: VideoReferenceLimits = { images: 9, videos: 3, audios: 3 };
const CANGYUAN_FIXED_VIDEO_ROUTE_LIMITS: Record<string, { route: string; images: number }> = {
    "seedance-2.0-720p": { route: "videos-4", images: 4 },
};
const GROK_VIDEO_REFERENCE_LIMITS: VideoReferenceLimits = { images: 7, videos: 1, audios: 0 };
const GROK_VIDEO_15_REFERENCE_LIMITS: VideoReferenceLimits = { images: 1, videos: 0, audios: 0 };
const OMNI_IMAGE_REFERENCE_LIMITS: VideoReferenceLimits = { images: 5, videos: 0, audios: 0 };
const OMNI_VIDEO_REFERENCE_LIMITS: VideoReferenceLimits = { images: 0, videos: 1, audios: 0 };
const SORA_VIDEO_REFERENCE_LIMITS: VideoReferenceLimits = { images: 1, videos: 0, audios: 0 };
const VEO_VIDEO_REFERENCE_LIMITS: VideoReferenceLimits = { images: 2, videos: 0, audios: 0 };
const VEO_REFERENCE_VIDEO_LIMITS: VideoReferenceLimits = { images: 3, videos: 0, audios: 0 };

export function videoReferenceCapability(model: string, context: VideoReferenceContext = {}): VideoReferenceCapability | null {
    const name = modelOptionName(model).toLowerCase();
    let documentedLimits: VideoReferenceLimits | null = null;
    if (isCangyuanSd5SeedanceModel(name)) documentedLimits = CANGYUAN_SD5_SEEDANCE_REFERENCE_LIMITS;
    else if (name.startsWith("seedance-2.0")) documentedLimits = seedanceModelFixedResolution(name) ? SEEDANCE_FIXED_REFERENCE_LIMITS : SEEDANCE_STANDARD_REFERENCE_LIMITS;
    else if (name.startsWith("grok-video-1.5")) documentedLimits = GROK_VIDEO_15_REFERENCE_LIMITS;
    else if (name.startsWith("grok-video")) documentedLimits = GROK_VIDEO_REFERENCE_LIMITS;
    else if (name === "omni-fast" || name === "omni-fast-no-water") documentedLimits = OMNI_IMAGE_REFERENCE_LIMITS;
    else if (name === "omni-v2v" || name === "omni-v2v-no-water") documentedLimits = OMNI_VIDEO_REFERENCE_LIMITS;
    else if (name === "sora-2" || name === "sora-2-pro" || name === "sora2") documentedLimits = SORA_VIDEO_REFERENCE_LIMITS;
    else if (isVeoVideoModel(name)) documentedLimits = isVeoReferenceVideoModel(name) ? VEO_REFERENCE_VIDEO_LIMITS : VEO_VIDEO_REFERENCE_LIMITS;
    if (!documentedLimits) return null;

    const routeLimit = isCangyuanModel(context.config, model) ? CANGYUAN_FIXED_VIDEO_ROUTE_LIMITS[name] : undefined;
    const useVideoRouteLimit = Boolean(routeLimit && context.videoCount);
    return {
        documentedLimits,
        limits: useVideoRouteLimit ? { ...documentedLimits, images: routeLimit.images } : documentedLimits,
        ...(routeLimit ? { route: routeLimit.route, routeImageLimit: routeLimit.images } : {}),
    };
}

export function videoReferenceLimits(model: string, context: VideoReferenceContext = {}) {
    return videoReferenceCapability(model, context)?.limits || null;
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

export function videoReferenceLimitsLabel(model: string, config?: AiConfig) {
    const capability = videoReferenceCapability(model, { config });
    if (!capability) return "待核对";
    const imageLabel = capability.routeImageLimit ? `${capability.documentedLimits.images}/视频${capability.routeImageLimit}` : capability.limits.images;
    return `${imageLabel}·${capability.limits.videos}·${capability.limits.audios}`;
}

export function videoReferenceLimitsTitle(model: string, config?: AiConfig) {
    const capability = videoReferenceCapability(model, { config });
    if (!capability) return "该模型的参考素材上限尚未完成官方文档核对";
    const routeHint = capability.routeImageLimit ? `；平台单模型说明为图片 ${capability.documentedLimits.images} 张，但当前 ${capability.route} 参考视频线路最多接受 ${capability.routeImageLimit} 张图` : "";
    return `参考素材上限：图片 ${capability.documentedLimits.images} 张 · 视频 ${capability.limits.videos} 条 · 音频 ${capability.limits.audios} 条${isCangyuanSd5SeedanceModel(model) ? ` · 合计 ${CANGYUAN_SD5_SEEDANCE_REFERENCE_TOTAL_LIMIT} 个` : ""}${routeHint}`;
}

export function cangyuanSeedanceFixedResolution(config: AiConfig, selectedModel = config.model || config.videoModel) {
    const model = modelOptionName(selectedModel);
    const fixedResolution = seedanceModelFixedResolution(model);
    if (!fixedResolution) return "";
    const requestConfig = resolveModelRequestConfig(config, selectedModel);
    return requestConfig.apiFormat === "cangyuan" || requestConfig.baseUrl.toLowerCase().includes("ai.cangyuansuanli.cn") ? fixedResolution : "";
}

function isCangyuanModel(config: AiConfig | undefined, model: string) {
    if (!config) return false;
    const requestConfig = resolveModelRequestConfig(config, model);
    return requestConfig.apiFormat === "cangyuan" || requestConfig.baseUrl.toLowerCase().includes("ai.cangyuansuanli.cn");
}

import { seedanceModelFixedResolution } from "@/lib/seedance-video";
import { modelOptionName, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";

export type VideoReferenceLimits = Readonly<{
    images: number;
    videos: number;
    audios: number;
}>;

const SEEDANCE_VIDEO_REFERENCE_LIMITS: VideoReferenceLimits = { images: 4, videos: 3, audios: 1 };
const GROK_VIDEO_REFERENCE_LIMITS: VideoReferenceLimits = { images: 7, videos: 1, audios: 0 };
const GROK_VIDEO_15_REFERENCE_LIMITS: VideoReferenceLimits = { images: 1, videos: 0, audios: 0 };
const SORA_VIDEO_REFERENCE_LIMITS: VideoReferenceLimits = { images: 1, videos: 0, audios: 0 };

export function videoReferenceLimits(model: string) {
    const name = modelOptionName(model).toLowerCase();
    if (name.startsWith("seedance-2.0")) return SEEDANCE_VIDEO_REFERENCE_LIMITS;
    if (name.startsWith("grok-video-1.5")) return GROK_VIDEO_15_REFERENCE_LIMITS;
    if (name.startsWith("grok-video")) return GROK_VIDEO_REFERENCE_LIMITS;
    if (name === "sora-2") return SORA_VIDEO_REFERENCE_LIMITS;
    return null;
}

export function videoReferenceLimitsLabel(model: string) {
    const limits = videoReferenceLimits(model);
    return limits ? `${limits.images}·${limits.videos}·${limits.audios}` : "待核对";
}

export function videoReferenceLimitsTitle(model: string) {
    const limits = videoReferenceLimits(model);
    return limits ? `参考素材上限：图片 ${limits.images} 张 · 视频 ${limits.videos} 条 · 音频 ${limits.audios} 条` : "该模型的参考素材上限尚未完成官方文档核对";
}

export function cangyuanSeedanceFixedResolution(config: AiConfig, selectedModel = config.model || config.videoModel) {
    const model = modelOptionName(selectedModel);
    const fixedResolution = seedanceModelFixedResolution(model);
    if (!fixedResolution) return "";
    const requestConfig = resolveModelRequestConfig(config, selectedModel);
    return requestConfig.apiFormat === "cangyuan" || requestConfig.baseUrl.toLowerCase().includes("ai.cangyuansuanli.cn") ? fixedResolution : "";
}

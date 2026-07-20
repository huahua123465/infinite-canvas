import { decodeChannelModel, modelOptionName, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

export const SEEDANCE_REFERENCE_LIMITS = {
    images: 4,
    videos: 3,
    audios: 1,
    imageMaxBytes: 30 * 1024 * 1024,
    videoMaxBytes: 50 * 1024 * 1024,
    audioMaxBytes: 15 * 1024 * 1024,
};

export const CANGYUAN_SD5_SEEDANCE_REFERENCE_LIMITS = {
    images: 9,
    videos: 3,
    audios: 3,
} as const;

export const CANGYUAN_SD5_SEEDANCE_REFERENCE_TOTAL_LIMIT = 12;

export function isCangyuanSd5SeedanceModel(model: string) {
    const name = modelOptionName(model).toLowerCase();
    return name === "sd5-seedance-2.0" || name === "sd5-seedance-2.0-fast";
}

export function isSeedanceMini8sModel(model: string) {
    return modelOptionName(model).toLowerCase() === "seedance-2.0-mini-8s";
}

export const seedanceResolutionOptions = [
    { value: "480p", label: "480p" },
    { value: "720p", label: "720p" },
    { value: "1080p", label: "1080p" },
    { value: "4k", label: "4K" },
] as const;

export const seedanceRatioOptions = [
    { value: "16:9", label: "横屏" },
    { value: "9:16", label: "竖屏" },
    { value: "1:1", label: "方形" },
    { value: "4:3", label: "标准横屏" },
    { value: "3:4", label: "标准竖屏" },
    { value: "21:9", label: "宽银幕" },
    { value: "adaptive", label: "自适应" },
] as const;

export const seedanceDurationOptions = [-1, 4, 5, 6, 8, 10, 12, 15] as const;

const seedancePixels = {
    "480p": {
        "16:9": "864x496",
        "4:3": "752x560",
        "1:1": "640x640",
        "3:4": "560x752",
        "9:16": "496x864",
        "21:9": "992x432",
    },
    "720p": {
        "16:9": "1280x720",
        "4:3": "1112x834",
        "1:1": "960x960",
        "3:4": "834x1112",
        "9:16": "720x1280",
        "21:9": "1470x630",
    },
    "1080p": {
        "16:9": "1920x1080",
        "4:3": "1664x1248",
        "1:1": "1440x1440",
        "3:4": "1248x1664",
        "9:16": "1080x1920",
        "21:9": "2206x946",
    },
    "4k": {
        "16:9": "3840x2160",
        "4:3": "3328x2496",
        "1:1": "2880x2880",
        "3:4": "2496x3328",
        "9:16": "2160x3840",
        "21:9": "4412x1892",
    },
} as const;

export function isSeedanceVideoConfig(config: AiConfig | Pick<AiConfig, "model" | "videoModel" | "baseUrl" | "apiFormat">) {
    const requestConfig = "channels" in config ? resolveModelRequestConfig(config, config.model || config.videoModel) : config;
    return isSeedanceVideoModel(modelOptionName(requestConfig.model || requestConfig.videoModel)) || isArkVideoBaseUrl(requestConfig.baseUrl);
}

export function isSeedanceVideoModel(model: string) {
    const value = model.toLowerCase();
    return value.includes("seedance") || value.includes("doubao-seedance");
}

export function isSeedanceFastModel(model: string) {
    const value = model.toLowerCase();
    return isSeedanceVideoModel(value) && value.includes("fast");
}

export function seedanceModelFixedResolution(model: string) {
    const value = modelOptionName(model).toLowerCase();
    const match = value.match(/(?:^|[-_])(480p|720p|1080p|4k)(?:$|[-_])/);
    return match?.[1] || "";
}

export function seedanceResolutionLabel(value: string) {
    return value.toLowerCase() === "4k" ? "4K" : value;
}

export function findSeedanceModelOptionByResolution(config: Pick<AiConfig, "models" | "videoModels">, currentModel: string, resolution: string) {
    const target = normalizeResolutionToken(resolution).toLowerCase();
    const currentName = modelOptionName(currentModel).toLowerCase();
    const currentChannelId = decodeChannelModel(currentModel)?.channelId || "";
    const baseName = stripSeedanceResolutionSuffix(currentName);
    const candidates = [...config.videoModels, ...config.models];
    return candidates.find((model) => {
        const decoded = decodeChannelModel(model);
        if (currentChannelId && decoded?.channelId !== currentChannelId) return false;
        const name = modelOptionName(model).toLowerCase();
        return stripSeedanceResolutionSuffix(name) === baseName && seedanceModelFixedResolution(name) === target;
    });
}

export function isArkPlanBaseUrl(baseUrl: string) {
    return baseUrl.toLowerCase().includes("ark.cn-beijing.volces.com/api/plan/v3") || baseUrl.toLowerCase().includes("/api/plan/v3");
}

export function isArkVideoBaseUrl(baseUrl: string) {
    const lowerBaseUrl = baseUrl.toLowerCase();
    return lowerBaseUrl.includes("ark.cn-beijing.volces.com/api/v3") || isArkPlanBaseUrl(baseUrl);
}

export function normalizeSeedanceResolution(value: string, model = "") {
    const fixedResolution = seedanceModelFixedResolution(model);
    if (fixedResolution) return fixedResolution;
    const normalized = normalizeResolutionToken(value);
    if (isSeedanceFastModel(model) && normalized === "1080p") return "720p";
    return seedanceResolutionOptions.some((item) => item.value === normalized) ? normalized : "720p";
}

export function normalizeSeedanceApiResolution(value: string, model = "") {
    return normalizeSeedanceResolution(value, model).toUpperCase();
}

export function normalizeResolutionToken(value: string) {
    if (value === "low") return "480p";
    if (value === "auto" || value === "high" || value === "medium") return "720p";
    const raw = String(value || "").toLowerCase();
    if (raw === "4k") return "4k";
    const resolution = raw.replace(/p$/i, "") || "720";
    return `${resolution}p`;
}

export function normalizeSeedanceDuration(value: string) {
    if (String(value).trim() === "-1") return -1;
    const seconds = Math.floor(Number(value) || 5);
    return Math.max(4, Math.min(15, seconds));
}

export function normalizeSeedanceRatio(value: string) {
    if (!value || value === "auto" || value === "adaptive") return "adaptive";
    if (seedanceRatioOptions.some((item) => item.value === value)) return value;
    const match = value.match(/^(\d+)x(\d+)$/);
    if (!match) return "adaptive";
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!width || !height) return "adaptive";
    const ratio = width / height;
    const options = [
        ["16:9", 16 / 9],
        ["4:3", 4 / 3],
        ["1:1", 1],
        ["3:4", 3 / 4],
        ["9:16", 9 / 16],
        ["21:9", 21 / 9],
    ] as const;
    return options.reduce((best, item) => (Math.abs(item[1] - ratio) < Math.abs(best[1] - ratio) ? item : best), options[0])[0];
}

export function seedancePixelLabel(resolution: string, ratio: string) {
    const normalizedResolution = normalizeSeedanceResolution(resolution) as keyof typeof seedancePixels;
    const normalizedRatio = normalizeSeedanceRatio(ratio) as keyof (typeof seedancePixels)[typeof normalizedResolution] | "adaptive";
    if (normalizedRatio === "adaptive") return "自动匹配";
    return seedancePixels[normalizedResolution][normalizedRatio] || "";
}

function stripSeedanceResolutionSuffix(value: string) {
    return value.replace(/[-_](480p|720p|1080p|4k)$/i, "");
}

export function boolConfig(value: string | undefined, fallback: boolean) {
    if (value === "true") return true;
    if (value === "false") return false;
    return fallback;
}

export function seedanceReferenceLabel(kind: "image" | "video" | "audio", index: number) {
    if (kind === "image") return `图片${index + 1}`;
    if (kind === "video") return `视频${index + 1}`;
    return `音频${index + 1}`;
}

export function buildSeedancePromptText(prompt: string, images: ReferenceImage[], videos: ReferenceVideo[], audios: ReferenceAudio[]) {
    const mappings = [
        ...images.map((item, index) => `${seedanceReferenceLabel("image", index)} = ${seedanceReferenceName(item.name)}`),
        ...videos.map((item, index) => `${seedanceReferenceLabel("video", index)} = ${seedanceReferenceName(item.name)}`),
        ...audios.map((item, index) => `${seedanceReferenceLabel("audio", index)} = ${seedanceReferenceName(item.name)}`),
    ];
    const text = prompt.trim();
    if (!mappings.length) return text;
    return `参考素材映射：${mappings.join("；")}。提示词中的 @资产名 与这里的图片、视频、音频编号一一对应，每个素材只控制对应主体、场景、道具、动作或声音。\n\n${text}`;
}

function seedanceReferenceName(name: string) {
    return name.replace(/\.(?:png|jpe?g|webp|gif|mp4|mov|webm|mp3|wav|m4a|aac)$/i, "").trim() || "未命名素材";
}

export function seedanceVideoReferenceError(videos: ReferenceVideo[], minDurationMs = 4_000) {
    let totalDurationMs = 0;
    for (let index = 0; index < videos.length; index += 1) {
        const video = videos[index];
        const label = seedanceReferenceLabel("video", index);
        if (video.bytes && video.bytes > SEEDANCE_REFERENCE_LIMITS.videoMaxBytes) return `${label} 超过 50MB，请压缩后再上传`;
        if (video.durationMs) {
            if (video.durationMs < minDurationMs || video.durationMs > 15000) return `${label} 时长需要在 ${minDurationMs / 1000}-15 秒之间`;
            totalDurationMs += video.durationMs;
        }
        if (video.width && video.height) {
            if (Math.min(video.width, video.height) < 720 || Math.max(video.width, video.height) > 2160) return `${label} 每边分辨率需要在 720-2160px 之间`;
        }
    }
    if (totalDurationMs > 15000) return "Seedance 参考视频总时长不能超过 15 秒";
    return "";
}

export const seedanceVideoReferenceHint = "参考视频需为 mp4/mov，H.264/H.265，FPS 24-60；人物参考图应严格保持当前项目指定的真人写实、动画、漫画、3D 或其他视觉风格。";

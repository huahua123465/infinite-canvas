import { CANGYUAN_SD5_SEEDANCE_REFERENCE_TOTAL_LIMIT, isCangyuanSd5SeedanceModel, isSeedanceMini8sModel, seedanceModelFixedResolution } from "@/lib/seedance-video";
import { dataUrlToFile } from "@/lib/image-utils";
import { cangyuanEffectiveVideoReferenceLimits, isOmniImageVideoModel, isOmniVideoToVideoModel, isSoraVideoModel, isVeoVideoModel, videoReferenceLimits } from "@/lib/video-model-capabilities";
import { imageToDataUrl } from "@/services/image-storage";
import { modelOptionName, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

export type VideoPreflightIssue = {
    code: string;
    level: "warning" | "blocked";
    message: string;
    suggestion: string;
};

export type VideoPreflightInput = {
    config: AiConfig;
    prompt: string;
    references: ReferenceImage[];
    videoReferences: ReferenceVideo[];
    audioReferences: ReferenceAudio[];
};

export type VideoPreflightResult = {
    status: "passed" | "warning" | "blocked";
    issues: VideoPreflightIssue[];
};

const seedanceRatios = new Set(["16:9", "9:16", "1:1", "21:9", "3:4", "4:3"]);
const grokDurations = new Set([4, 6, 8, 10, 12, 15]);

export async function inspectVideoGenerationInput(input: VideoPreflightInput): Promise<VideoPreflightResult> {
    const issues = validateVideoGenerationParameters(input);
    if (typeof document !== "undefined" && input.references.length) {
        const model = modelOptionName(input.config.model || input.config.videoModel).trim().toLowerCase();
        const imageIssues = await Promise.all(input.references.map((reference, index) => inspectReferenceImage(reference, index, input.config.size, model)));
        issues.push(...imageIssues.flat());
    }
    return summarizeIssues(issues);
}

export function assertVideoGenerationParameters(input: VideoPreflightInput) {
    const blocked = validateVideoGenerationParameters(input).filter((issue) => issue.level === "blocked");
    if (blocked.length) throw new Error(blocked.map((issue) => issue.message).join("；"));
}

export function validateVideoGenerationParameters(input: VideoPreflightInput) {
    const issues: VideoPreflightIssue[] = [];
    const selectedModel = input.config.model || input.config.videoModel;
    const model = modelOptionName(selectedModel).trim().toLowerCase();
    const prompt = input.prompt.trim();
    const duration = normalizedDuration(input.config.videoSeconds);
    const ratio = normalizedRatio(input.config.size);
    const resolution = normalizedResolution(input.config.vquality);
    const requestConfig = resolveModelRequestConfig(input.config, selectedModel);
    const isCangyuan = requestConfig.apiFormat === "cangyuan" || requestConfig.baseUrl.toLowerCase().includes("ai.cangyuansuanli.cn");
    if (!prompt) issues.push(blocked("prompt_empty", "视频提示词不能为空", "请填写视频内容、动作和镜头描述。"));
    if (/@(?:image|图片)\d+/i.test(prompt) && !input.references.length) issues.push(blocked("prompt_image_reference_missing", "提示词引用了图片，但实际没有提交参考图", "请确认参考图从输入端连入视频节点后再生成。"));
    if (/@(?:video|视频)\d+/i.test(prompt) && !input.videoReferences.length) issues.push(blocked("prompt_video_reference_missing", "提示词引用了视频，但实际没有提交参考视频", "请确认参考视频从输入端连入视频节点后再生成。"));
    if (/@(?:audio|音频)\d+/i.test(prompt) && !input.audioReferences.length) issues.push(blocked("prompt_audio_reference_missing", "提示词引用了音频，但实际没有提交参考音频", "请确认参考音频从输入端连入视频节点后再生成。"));
    const maxPromptLength = model.startsWith("grok-video") ? 4096 : isSoraVideoModel(model) || isVeoVideoModel(model) || isCangyuanSd5SeedanceModel(model) ? 1200 : 5000;
    if (prompt.length > maxPromptLength) issues.push(blocked("prompt_too_long", `当前模型提示词不能超过 ${maxPromptLength} 个字符`, "请精简提示词后再生成。"));

    if (isCangyuanSd5SeedanceModel(model)) {
        const limits = videoReferenceLimits(model)!;
        if (duration < 4 || duration > 15) issues.push(blocked("sd5_seedance_duration", "沧元 SD5 Seedance 视频时长必须为 4-15 秒", "请修改当前镜头时长"));
        if (!["16:9", "9:16"].includes(ratio)) issues.push(blocked("sd5_seedance_ratio", "沧元 SD5 Seedance 仅支持 16:9 或 9:16", "请选择横屏或竖屏"));
        if (!["480p", "720p"].includes(resolution)) issues.push(blocked("sd5_seedance_resolution", "沧元 SD5 Seedance 仅支持 480p 或 720p", "请选择 480p 或 720p"));
        if (input.references.length > limits.images) issues.push(blocked("sd5_seedance_images", `当前模型参考图不能超过 ${limits.images} 张`, "请移除多余参考图"));
        if (input.videoReferences.length > limits.videos) issues.push(blocked("sd5_seedance_videos", `当前模型参考视频不能超过 ${limits.videos} 条`, "请移除多余参考视频"));
        if (input.audioReferences.length > limits.audios) issues.push(blocked("sd5_seedance_audios", `当前模型参考音频不能超过 ${limits.audios} 条`, "请移除多余参考音频"));
        if (input.references.length + input.videoReferences.length + input.audioReferences.length > CANGYUAN_SD5_SEEDANCE_REFERENCE_TOTAL_LIMIT) issues.push(blocked("sd5_seedance_total_references", `SD5 Seedance 三类参考素材合计不能超过 ${CANGYUAN_SD5_SEEDANCE_REFERENCE_TOTAL_LIMIT} 个`, "请移除多余参考素材"));
        let totalVideoDuration = 0;
        input.videoReferences.forEach((item, index) => {
            if (item.durationMs && (item.durationMs < 1_000 || item.durationMs > 15_000)) issues.push(blocked(`sd5_seedance_video_${index}`, `参考视频 ${index + 1} 单条时长必须为 1-15 秒`, "请裁剪或更换参考视频"));
            totalVideoDuration += item.durationMs || 0;
        });
        if (totalVideoDuration > 45_000) issues.push(blocked("sd5_seedance_video_duration", "参考视频总时长不能超过 45 秒", "请裁剪或移除参考视频"));
        input.audioReferences.forEach((item, index) => {
            if (!isHttpsReferenceUrl(item.url)) issues.push(blocked(`sd5_seedance_audio_url_${index}`, `参考音频 ${index + 1} 必须使用公网 HTTPS URL`, "请先上传到可公开访问的 HTTPS 地址"));
            if (item.durationMs && item.durationMs > 15_000) issues.push(blocked(`sd5_seedance_audio_${index}`, `参考音频 ${index + 1} 不能超过 15 秒`, "请裁剪或更换参考音频"));
        });
    } else if (model.startsWith("seedance-2.0")) {
        const fixedResolution = seedanceModelFixedResolution(model);
        const limits = isCangyuan ? cangyuanEffectiveVideoReferenceLimits(selectedModel, input.videoReferences.length)! : videoReferenceLimits(selectedModel)!;
        const minReferenceVideoMs = fixedResolution ? 2_000 : 4_000;
        const maxDuration = isSeedanceMini8sModel(model) ? 8 : 15;
        if (duration < 4 || duration > maxDuration) issues.push(blocked("seedance_duration", `当前 Seedance 模型时长必须为 4–${maxDuration} 秒`, "请修改当前镜头时长。"));
        if (!seedanceRatios.has(ratio)) issues.push(blocked("seedance_ratio", `Seedance 不支持当前画幅 ${ratio}`, "请选择 16:9、9:16、1:1、21:9、3:4 或 4:3。"));
        if (input.references.length > limits.images) issues.push(blocked("seedance_images", isCangyuan && input.videoReferences.length && limits.images < videoReferenceLimits(selectedModel)!.images ? `当前沧元 VIDEO 混合参考线路最多支持 ${limits.images} 张参考图` : `当前 Seedance 模型参考图不能超过 ${limits.images} 张`, "请移除多余参考图，系统不会静默丢弃或重排已连接素材。"));
        if (input.videoReferences.length > limits.videos) issues.push(blocked("seedance_videos", `当前 Seedance 模型参考视频不能超过 ${limits.videos} 条`, "请移除多余参考视频。"));
        if (input.audioReferences.length > limits.audios) issues.push(blocked("seedance_audios", `当前 Seedance 模型参考音频不能超过 ${limits.audios} 条`, "请移除多余参考音频。"));
        if ((input.videoReferences.length || input.audioReferences.length) && !input.references.length) issues.push(blocked("seedance_primary_image", "参考视频或音频必须同时提供主参考图", "请添加至少一张参考图。"));
        const totalVideoDuration = input.videoReferences.reduce((total, item) => total + (item.durationMs || 0), 0);
        if (totalVideoDuration > 15_000) issues.push(blocked("seedance_video_duration", "Seedance 参考视频总时长不能超过 15 秒", "请裁短或移除参考视频。"));
        input.videoReferences.forEach((item, index) => {
            if (item.durationMs && (item.durationMs < minReferenceVideoMs || item.durationMs > 15_000)) issues.push(blocked(`seedance_video_${index}`, `参考视频 ${index + 1} 必须为 ${minReferenceVideoMs / 1000}–15 秒`, "请更换或裁剪参考视频。"));
            const minSize = fixedResolution ? 300 : 720;
            const maxSize = fixedResolution ? 6000 : 2160;
            if (item.width && item.height && (Math.min(item.width, item.height) < minSize || Math.max(item.width, item.height) > maxSize)) issues.push(blocked(`seedance_video_size_${index}`, `参考视频 ${index + 1} 每边分辨率必须在 ${minSize}–${maxSize} px 范围内`, "请调整参考视频分辨率。"));
            if (fixedResolution && item.width && item.height && (item.width / item.height < 0.4 || item.width / item.height > 2.5)) issues.push(blocked(`seedance_video_ratio_${index}`, `参考视频 ${index + 1} 宽高比必须在 0.4–2.5 范围内`, "请裁剪或更换参考视频。"));
        });
        input.audioReferences.forEach((item, index) => {
            if (isCangyuan && !isHttpsReferenceUrl(item.url)) issues.push(blocked(`seedance_audio_url_${index}`, `参考音频 ${index + 1} 必须使用公网 HTTPS URL`, "沧元该模型不支持直接上传本地参考音频，请先换成可公开访问的 HTTPS 地址。"));
            if (item.durationMs && item.durationMs > 15_000) issues.push(blocked(`seedance_audio_duration_${index}`, `参考音频 ${index + 1} 不能超过 15 秒`, "请裁短参考音频。"));
        });
        const standardModel = !fixedResolution;
        if (standardModel && !["480p", "720p"].includes(resolution)) issues.push(blocked("seedance_resolution", "当前 Seedance 标准模型仅支持 480p/720p", "请修改分辨率或切换固定分辨率模型。"));
        if (fixedResolution && resolution !== fixedResolution) issues.push(warning("seedance_fixed_resolution", `当前模型固定输出 ${fixedResolution}，设置中的 ${resolution} 不会生效`, "生成时会以模型档位为准。"));
    }

    if (isOmniImageVideoModel(model)) {
        const limits = videoReferenceLimits(model)!;
        if (input.references.length > limits.images) issues.push(blocked("omni_images", `当前 Omni 模型参考图不能超过 ${limits.images} 张`, "请移除多余参考图。"));
        if (input.videoReferences.length || input.audioReferences.length) issues.push(blocked("omni_media", "当前 Omni 模型只支持参考图，不支持参考视频或参考音频", "请移除参考视频和参考音频。"));
        if (!["16:9", "9:16"].includes(ratio)) issues.push(blocked("omni_ratio", "当前 Omni 模型只支持 16:9 或 9:16", "请选择横屏或竖屏。"));
    }

    if (isOmniVideoToVideoModel(model)) {
        if (input.videoReferences.length !== 1 || input.references.length || input.audioReferences.length) issues.push(blocked("omni_v2v_references", "Omni V2V 必须且只能提供 1 条源视频，不支持参考图或参考音频", "请只保留一条源视频。"));
        if (!["16:9", "9:16"].includes(ratio)) issues.push(blocked("omni_v2v_ratio", "Omni V2V 只支持 16:9 或 9:16", "请选择横屏或竖屏。"));
        const sourceVideo = input.videoReferences[0];
        if (sourceVideo?.bytes && sourceVideo.bytes > 5 * 1024 * 1024) issues.push(blocked("omni_v2v_video_size", "Omni V2V 本地源视频不能超过 5MB", "请压缩或裁剪源视频后重试。"));
    }

    if (isSoraVideoModel(model)) {
        if (![4, 8, 12].includes(duration)) issues.push(blocked("sora_duration", "Sora 2 视频时长只能选择 4、8 或 12 秒", "请修改当前视频时长。"));
        if (!["16:9", "9:16"].includes(ratio)) issues.push(blocked("sora_ratio", "Sora 2 只支持 16:9 或 9:16", "请选择横屏或竖屏。"));
        if (input.references.length > 1) issues.push(blocked("sora_images", "Sora 2 最多支持 1 张帧参考图", "请移除多余参考图。"));
        if (input.videoReferences.length || input.audioReferences.length) issues.push(blocked("sora_media", "Sora 2 不支持参考视频或参考音频", "请只保留提示词和最多一张帧参考图。"));
    }

    if (isVeoVideoModel(model)) {
        const limits = videoReferenceLimits(model)!;
        if (![4, 6, 8].includes(duration)) issues.push(blocked("veo_duration", "Veo 3.1 视频时长只能选择 4、6 或 8 秒", "请修改当前视频时长。"));
        if (!["16:9", "9:16"].includes(ratio)) issues.push(blocked("veo_ratio", "Veo 3.1 只支持 16:9 或 9:16", "请选择横屏或竖屏。"));
        if (!["720p", "1080p"].includes(resolution)) issues.push(blocked("veo_resolution", "Veo 3.1 只支持 720p 或 1080p", "请修改视频分辨率。"));
        if (input.references.length > limits.images) issues.push(blocked("veo_images", `当前 Veo 模型最多支持 ${limits.images} 张参考图`, "请移除多余参考图。"));
        if (input.videoReferences.length || input.audioReferences.length) issues.push(blocked("veo_media", "Veo 3.1 不支持参考视频或参考音频", "请只保留提示词和参考图。"));
    }

    if (model.startsWith("grok-video")) {
        if (!grokDurations.has(duration)) issues.push(blocked("grok_duration", "Grok 视频时长只能选择 4、6、8、10、12 或 15 秒", "请修改视频时长。"));
        if (input.audioReferences.length) issues.push(blocked("grok_audio", "Grok 视频暂不支持参考音频", "请移除参考音频。"));
        if (model.includes("1.5") && (input.references.length !== 1 || input.videoReferences.length || input.audioReferences.length)) issues.push(blocked("grok_15_references", "grok-video-1.5 必须且只能连接 1 张参考图", "请移除其他参考素材。"));
        if (!model.includes("1.5") && input.references.length > 7) issues.push(blocked("grok_images", "grok-video 最多支持 7 张参考图", "请移除多余参考图。"));
        if (input.references.length > 1 && duration > 10) issues.push(blocked("grok_multi_duration", "Grok 多参考图模式最长 10 秒", "请把时长调整为 10 秒以内。"));
        if (!["16:9", "9:16"].includes(ratio)) issues.push(warning("grok_ratio_normalized", `当前前端会把 ${ratio} 归一为 16:9`, "如需保持画幅，请改选 16:9 或 9:16。"));
    }
    return issues;
}

async function inspectReferenceImage(reference: ReferenceImage, index: number, targetSize: string, model: string) {
    const label = `参考图 ${index + 1}`;
    try {
        const dataUrl = await imageToDataUrl(reference);
        if (!dataUrl) return [blocked(`image_missing_${index}`, `${label} 无法读取`, "请重新选择参考图。")];
        const imageBytes = dataUrlToFile({ ...reference, dataUrl }).size;
        if (isOmniImageVideoModel(model) && imageBytes > 5 * 1024 * 1024) return [blocked(`omni_image_size_${index}`, `${label} 超过 Omni 单图 5MB 上限`, "请压缩图片后重试。")];
        if ((isSoraVideoModel(model) || isVeoVideoModel(model) || isCangyuanSd5SeedanceModel(model)) && imageBytes > 10 * 1024 * 1024) return [blocked(`video_image_size_${index}`, `${label} 超过当前视频模型单图 10MB 上限`, "请压缩图片后重试。")];
        if (model.startsWith("seedance-2.0") && imageBytes > 30 * 1024 * 1024) return [blocked(`seedance_image_size_${index}`, `${label} 超过当前 Seedance 模型单图 30MB 上限`, "请压缩图片后重试。")];
        const image = await loadImage(dataUrl);
        const issues: VideoPreflightIssue[] = [];
        const shortSide = Math.min(image.naturalWidth, image.naturalHeight);
        const fixedResolution = seedanceModelFixedResolution(model);
        if (fixedResolution && (shortSide < 300 || Math.max(image.naturalWidth, image.naturalHeight) > 4000)) issues.push(blocked(`seedance_image_dimensions_${index}`, `${label} 每边至少 300 px 且长边不能超过 4000 px`, "请调整参考图尺寸。"));
        if (fixedResolution && (image.naturalWidth / image.naturalHeight < 0.4 || image.naturalWidth / image.naturalHeight > 2.5)) issues.push(blocked(`seedance_image_aspect_${index}`, `${label} 宽高比必须在 0.4–2.5 范围内`, "请裁剪或更换参考图。"));
        if (shortSide < 256) issues.push(blocked(`image_too_small_${index}`, `${label} 分辨率过低（${image.naturalWidth}×${image.naturalHeight}）`, "请使用短边至少 256 px 的图片。"));
        else if (shortSide < 720) issues.push(warning(`image_small_${index}`, `${label} 清晰度较低（${image.naturalWidth}×${image.naturalHeight}）`, "建议使用短边 720 px 以上的图片。"));
        const targetRatio = parseRatio(targetSize);
        if (targetRatio) {
            const imageRatio = image.naturalWidth / image.naturalHeight;
            if (Math.max(imageRatio / targetRatio, targetRatio / imageRatio) > 1.8) issues.push(warning(`image_ratio_${index}`, `${label} 与目标视频画幅差异较大`, "生成时主体可能被明显裁切。"));
        }
        issues.push(...sampleImage(image, index, label));
        return issues;
    } catch {
        const source = reference.dataUrl || "";
        if (/^https?:\/\//i.test(source) && !reference.storageKey) return [warning(`image_remote_${index}`, `${label} 无法在浏览器本地完成检查`, "仍可提交公网图片，由视频平台继续读取。")];
        return [blocked(`image_decode_${index}`, `${label} 无法解码或读取`, "请重新上传有效的 PNG、JPEG 或 WebP 图片。")];
    }
}

function sampleImage(image: HTMLImageElement, index: number, label: string) {
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 32;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return [];
    context.drawImage(image, 0, 0, 32, 32);
    const pixels = context.getImageData(0, 0, 32, 32).data;
    let transparent = 0;
    let count = 0;
    let sum = 0;
    let squareSum = 0;
    for (let offset = 0; offset < pixels.length; offset += 4) {
        if (pixels[offset + 3] < 24) {
            transparent += 1;
            continue;
        }
        const luminance = pixels[offset] * 0.2126 + pixels[offset + 1] * 0.7152 + pixels[offset + 2] * 0.0722;
        sum += luminance;
        squareSum += luminance * luminance;
        count += 1;
    }
    const transparentRatio = transparent / (pixels.length / 4);
    if (transparentRatio > 0.95 || !count) return [blocked(`image_transparent_${index}`, `${label} 几乎完全透明`, "请使用有明确可见内容的图片。")];
    const issues: VideoPreflightIssue[] = [];
    if (transparentRatio > 0.6) issues.push(warning(`image_transparency_${index}`, `${label} 大部分区域透明`, "建议换成背景和主体完整的图片。"));
    const variance = squareSum / count - (sum / count) ** 2;
    if (variance < 25) issues.push(warning(`image_solid_${index}`, `${label} 接近纯色或没有明显明暗变化`, "这类图片容易被视频平台拒绝。"));
    else if (variance < 120) issues.push(warning(`image_contrast_${index}`, `${label} 对比度较低`, "建议提高主体与背景的区分度。"));
    return issues;
}

function loadImage(source: string) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = source;
    });
}

function normalizedDuration(value: string) {
    const duration = Math.floor(Number(value));
    return duration === -1 || !Number.isFinite(duration) ? 5 : duration;
}

function normalizedResolution(value: string) {
    const resolution = String(value || "720p").toLowerCase().replace(/^high$|^medium$|^auto$/, "720p").replace(/^low$/, "480p");
    return /^\d+$/.test(resolution) ? `${resolution}p` : resolution;
}

function normalizedRatio(value: string) {
    if (value === "adaptive" || value === "auto") return "16:9";
    if (/^\d+:\d+$/.test(value || "")) return value;
    const ratio = parseRatio(value);
    if (!ratio) return "16:9";
    return ratio < 1 ? "9:16" : "16:9";
}

function isHttpsReferenceUrl(value: string) {
    return /^https:\/\//i.test(value || "");
}

function parseRatio(value: string) {
    const ratioMatch = String(value || "").match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
    if (ratioMatch) return Number(ratioMatch[1]) / Number(ratioMatch[2]);
    const sizeMatch = String(value || "").match(/^(\d+)x(\d+)$/i);
    return sizeMatch ? Number(sizeMatch[1]) / Number(sizeMatch[2]) : 0;
}

function summarizeIssues(issues: VideoPreflightIssue[]): VideoPreflightResult {
    return { status: issues.some((issue) => issue.level === "blocked") ? "blocked" : issues.length ? "warning" : "passed", issues };
}

function blocked(code: string, message: string, suggestion: string): VideoPreflightIssue {
    return { code, level: "blocked", message, suggestion };
}

function warning(code: string, message: string, suggestion: string): VideoPreflightIssue {
    return { code, level: "warning", message, suggestion };
}

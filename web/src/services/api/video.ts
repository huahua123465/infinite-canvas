import axios from "axios";
import { nanoid } from "nanoid";

import { dataUrlToFile } from "@/lib/image-utils";
import { assertVideoGenerationParameters } from "@/lib/video-generation-preflight";
import { isOmniImageVideoModel, isOmniVideoToVideoModel, isSoraVideoModel, isVeoReferenceVideoModel, isVeoVideoModel, videoReferenceLimits } from "@/lib/video-model-capabilities";
import { getMediaBlob, uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { deleteTemporaryReferenceVideos, isTemporaryReferenceVideoUrl, publishReferenceVideo } from "@/services/media-publish";
import { imageToDataUrl } from "@/services/image-storage";
import { boolConfig, buildSeedancePromptText, isCangyuanSd5SeedanceModel, isSeedanceVideoConfig, normalizeSeedanceApiResolution, normalizeSeedanceDuration, normalizeSeedanceRatio, seedanceModelFixedResolution, seedanceVideoReferenceError, CANGYUAN_SD5_SEEDANCE_REFERENCE_LIMITS, CANGYUAN_SD5_SEEDANCE_REFERENCE_TOTAL_LIMIT, SEEDANCE_REFERENCE_LIMITS } from "@/lib/seedance-video";
import { useAgentStore } from "@/stores/use-agent-store";
import { buildApiUrl, modelOptionName, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import { runModelScript } from "@/services/api/model-script-runtime";
import { resolveModelScript } from "@/stores/use-model-script-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo, VideoRequestReferenceSummary, VideoRequestSummary } from "@/types/media";

type VideoResponseData = {
    id?: string;
    task_id?: string;
    progress?: number | string;
    status?: string;
    state?: string;
    url?: string;
    result_url?: string;
    video_url?: string;
    content?: { video_url?: string; url?: string } | null;
    error?: { code?: string; message?: string } | string | null;
    error_code?: string;
    message?: string;
    fail_reason?: string;
    video?: { url?: string };
    raw_data?: { video_url?: string; url?: string };
};
type VideoResponse = {
    id?: string;
    task_id?: string;
    status?: string;
    state?: string;
    progress?: number | string;
    error?: { code?: string; message?: string };
    error_code?: string;
    message?: string;
    fail_reason?: string;
    url?: string;
    result_url?: string;
    video_url?: string;
    content?: { video_url?: string; url?: string } | null;
    video?: { url?: string };
    raw_data?: { video_url?: string; url?: string };
    data?: VideoResponseData[] | VideoResponseData;
};
type ApiVideoEnvelope = { code?: number | string; data?: VideoResponse | null; msg?: string; message?: string; error?: { message?: string } };
type ApiVideoResponse = VideoResponse | ApiVideoEnvelope;
type SeedanceTask = {
    id: string;
    status?: "queued" | "running" | "succeeded" | "completed" | "failed" | "cancelled" | "expired";
    error?: { code?: string; message?: string } | null;
    content?: { video_url?: string; url?: string; last_frame_url?: string } | null;
    url?: string;
    result_url?: string;
    video_url?: string;
};
type SeedancePayload = {
    model: string;
    content: Array<Record<string, unknown>>;
    ratio: string;
    resolution: string;
    duration: number;
    generate_audio: boolean;
    watermark: boolean;
};
type ApiEnvelope<T> = T | { code?: number | string; data?: T | null; msg?: string; message?: string; error?: { message?: string } };

export type VideoGenerationResult = { blob?: Blob; url?: string; mimeType?: string };
export type VideoGenerationTask = {
    id: string;
    provider: "openai" | "seedance" | "cangyuan" | "script";
    model: string;
    cangyuanEndpoint?: "videos" | "video-generations";
    requestMethod?: "POST";
    requestUrl?: string;
    requestModel?: string;
    requestFields?: string[];
    requestSummary?: VideoRequestSummary;
    temporaryReferenceUrls?: string[];
};
export type VideoGenerationProgress = { percent: number; text: string; stage: "uploading-references" | "submitting" | "submitted" | "queued" | "running" | "saving" | "failed"; providerStatus?: string };
export type VideoFailureKind = "input_invalid" | "policy_rejected" | "service_busy" | "upstream_rejected" | "timeout" | "network" | "unknown";
export type VideoFailureInfo = { kind: VideoFailureKind; label: string; advice: string };
type RequestOptions = { signal?: AbortSignal; onProgress?: (progress: VideoGenerationProgress) => void; onTaskCreated?: (task: VideoGenerationTask) => void };
export type VideoGenerationTaskState =
    | { status: "pending"; providerStatus?: string; progress?: number }
    | { status: "completed"; result: VideoGenerationResult; providerStatus?: string; progress?: number }
    | { status: "failed"; error: string; providerStatus?: string; progress?: number };

const VIDEO_ACTIVE_WAIT_MS = 5 * 60 * 1000;
const VIDEO_MAX_WAIT_MS = 30 * 60 * 1000;
const VIDEO_BACKGROUND_POLL_MS = 30 * 1000;
const VIDEO_BUSY_RETRY_MS = 30 * 1000;
const VIDEO_POLL_RETRY_LIMIT = 3;
const modelScriptVideoResults = new Map<string, VideoGenerationResult>();

function aiApiUrl(config: AiConfig, path: string) {
    return buildApiUrl(config.baseUrl, path);
}

function aiHeaders(config: AiConfig, contentType?: string) {
    return {
        Authorization: `Bearer ${config.apiKey}`,
        ...(contentType ? { "Content-Type": contentType } : {}),
    };
}

export async function requestVideoGeneration(config: AiConfig, prompt: string, references: ReferenceImage[] = [], videoReferences: ReferenceVideo[] = [], audioReferences: ReferenceAudio[] = [], options?: RequestOptions): Promise<VideoGenerationResult> {
    let busyRetryCount = 0;
    while (true) {
        const model = modelOptionName((config.model || config.videoModel).trim());
        options?.onProgress?.({ percent: 8, text: `正在提交视频任务：${model}`, stage: "submitting" });
        try {
            const task = await createVideoGenerationTask(config, prompt, references, videoReferences, audioReferences, options);
            options?.onTaskCreated?.(task);
            return await resumeVideoGenerationTask(config, task, options);
        } catch (error) {
            const message = error instanceof Error ? error.message : "视频生成失败";
            if (classifyVideoFailure(message).kind !== "service_busy" || busyRetryCount >= 1) throw error;
            busyRetryCount += 1;
            options?.onProgress?.({ percent: 16, text: "生成服务繁忙，30 秒后自动重试一次，可随时停止", stage: "queued", providerStatus: "retry_wait" });
            await delay(VIDEO_BUSY_RETRY_MS, options?.signal);
        }
    }
}

export async function resumeVideoGenerationTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationResult> {
    options?.onProgress?.({ percent: 16, text: `视频任务已创建：${modelOptionName(task.model)} · ${task.id}`, stage: "submitted" });
    const delayMs = task.provider === "seedance" ? 30000 : task.provider === "cangyuan" ? 5000 : 2500;
    const startedAt = Date.now();
    let pollRetryCount = 0;
    for (let attempt = 0; Date.now() - startedAt < VIDEO_MAX_WAIT_MS; attempt += 1) {
        if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        let state: VideoGenerationTaskState;
        try {
            state = await pollVideoGenerationTask(config, task, options);
            pollRetryCount = 0;
        } catch (error) {
            if (options?.signal?.aborted || !isRetryableVideoPollError(error) || pollRetryCount >= VIDEO_POLL_RETRY_LIMIT) throw error;
            pollRetryCount += 1;
            const message = error instanceof Error ? error.message : "视频任务查询失败";
            options?.onProgress?.({ percent: 18, text: `任务查询暂时中断，正在重试（${pollRetryCount}/${VIDEO_POLL_RETRY_LIMIT}）：${message}`, stage: "queued", providerStatus: "poll_retry" });
            await delay(delayMs, options?.signal);
            continue;
        }
        if (state.status === "completed") {
            options?.onProgress?.({ percent: 96, text: "视频已生成，正在保存到画布", stage: "saving", providerStatus: state.providerStatus });
            await deleteTemporaryReferenceVideos(task.temporaryReferenceUrls || []);
            return state.result;
        }
        if (state.status === "failed") {
            options?.onProgress?.({ percent: 98, text: state.error, stage: "failed", providerStatus: state.providerStatus });
            await deleteTemporaryReferenceVideos(task.temporaryReferenceUrls || []);
            throw new Error(state.error);
        }
        const background = Date.now() - startedAt >= VIDEO_ACTIVE_WAIT_MS;
        options?.onProgress?.(background ? { percent: 95, text: `任务仍在处理中，已转为后台查询：${task.id}`, stage: "running", providerStatus: state.providerStatus } : videoPollingProgress(task.provider, state.providerStatus, attempt, state.progress));
        await delay(background ? VIDEO_BACKGROUND_POLL_MS : delayMs, options?.signal);
    }
    throw new Error(`视频任务长时间未完成，已保留任务 ID：${task.id}，可稍后查询原任务`);
}

export function classifyVideoFailure(message: string): VideoFailureInfo {
    const value = String(message || "").toLowerCase();
    if (/no_account|服务繁忙|service busy|server busy|temporarily unavailable|资源不足|429|限流/.test(value)) return { kind: "service_busy", label: "服务繁忙", advice: "系统会自动等待后重试一次；仍失败时建议稍后再试。" };
    if (/纯色|无明显主体|分辨率过低|不适合生成视频|invalid image|image quality|low resolution/.test(value)) return { kind: "input_invalid", label: "参考图不适合", advice: "请更换主体清晰、分辨率更高的参考图后重新生成。" };
    if (/内容策略|内容审查|策略拦截|敏感|违禁|审核拒绝|policy|moderation|safety|sensitive|real person|真人人脸|真人/.test(value)) return { kind: "policy_rejected", label: "内容策略拦截", advice: "原任务已被平台终止，查询不会改变结果。请先移除真人正脸、版权 IP 或敏感题材，换用更中性的提示词或非写实参考图后再创建新任务。" };
    if (/leonardo|upstream.*reject|上游.*拒绝|无任何输出|no output/.test(value)) return { kind: "upstream_rejected", label: "上游拒绝", advice: "请调整提示词或参考图；必要时手动切换到其他明确支持的模型。" };
    if (/timeout|超时|expired|长时间未完成/.test(value)) return { kind: "timeout", label: "任务等待超时", advice: "任务 ID 已保留，请优先查询原任务，不要直接重复提交。" };
    if (/network error|网络|failed to fetch|查询失败|视频地址.*(?:下载失败|不可播放|已失效)|视频下载结果为空|connection|cors/.test(value)) return { kind: "network", label: "视频结果未接回", advice: "请使用原任务 ID 继续查询，避免重新提交任务。" };
    return { kind: "unknown", label: "生成失败", advice: "请查看原始错误，调整模型、参考素材或提示词后再试。" };
}

export async function createVideoGenerationTask(config: AiConfig, prompt: string, references: ReferenceImage[] = [], videoReferences: ReferenceVideo[] = [], audioReferences: ReferenceAudio[] = [], options?: RequestOptions): Promise<VideoGenerationTask> {
    const selectedModel = (config.model || config.videoModel).trim();
    const requestConfig = resolveModelRequestConfig(config, selectedModel);
    const script = await resolveModelScript("video", selectedModel);
    if (script) {
        if (videoReferences.length || audioReferences.length) throw new Error("自定义视频调用脚本目前只接收提示词和参考图，请移除参考视频或参考音频");
        return createModelScriptVideoTask(requestConfig, selectedModel, script, prompt, references, options);
    }
    assertVideoGenerationParameters({ config, prompt, references, videoReferences, audioReferences });
    assertVideoConfig(requestConfig, requestConfig.model);
    if (requestConfig.apiFormat === "cangyuan" || isCangyuanSeedanceVideoRequest(requestConfig, selectedModel)) {
        return createCangyuanVideoTask(requestConfig, selectedModel, prompt, references, videoReferences, audioReferences, options);
    }
    if (isSeedanceVideoConfig(requestConfig)) {
        return createSeedanceTask(requestConfig, selectedModel, prompt, references, videoReferences, audioReferences, options);
    }
    if (videoReferences.length || audioReferences.length) {
        throw new Error("当前视频接口不支持参考视频或参考音频，请切换到 Seedance 2.0 / 火山 Agent Plan 模型，或移除参考素材");
    }
    return createOpenAIVideoTask(requestConfig, selectedModel, prompt, references, options);
}

export async function pollVideoGenerationTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    if (task.provider === "script") {
        const result = modelScriptVideoResults.get(task.id);
        if (!result) return { status: "failed", error: "自定义视频调用脚本结果已失效，请重新生成" };
        modelScriptVideoResults.delete(task.id);
        return { status: "completed", result, providerStatus: "completed" };
    }
    const requestConfig = resolveModelRequestConfig(config, task.model);
    assertVideoConfig(requestConfig, requestConfig.model);
    if (task.provider === "cangyuan") return pollCangyuanVideoTask(requestConfig, task, options);
    return task.provider === "seedance" ? pollSeedanceTask(requestConfig, task, options) : pollOpenAIVideoTask(requestConfig, task, options);
}

export async function storeGeneratedVideo(result: VideoGenerationResult): Promise<UploadedFile> {
    if (result.blob) return uploadMediaFile(result.blob, "video");
    if (result.url) {
        try {
            return await uploadMediaFile(result.url, "video");
        } catch {
            return { url: result.url, storageKey: "", bytes: 0, mimeType: result.mimeType || "video/mp4" };
        }
    }
    throw new Error("视频接口没有返回可播放的视频");
}

async function createModelScriptVideoTask(config: AiConfig, model: string, script: string, prompt: string, references: ReferenceImage[], options?: RequestOptions): Promise<VideoGenerationTask> {
    if (!model.trim()) throw new Error("请先配置视频模型");
    if (!config.baseUrl.trim()) throw new Error("请先配置 Base URL");
    if (!config.apiKey.trim()) throw new Error("请先配置 API Key");
    options?.onProgress?.({ percent: 18, text: "正在执行自定义视频调用脚本", stage: "running", providerStatus: "script" });
    const images = await Promise.all(references.map((image) => imageToDataUrl(image)));
    const result = normalizeModelScriptVideo(
        await runModelScript({
            capability: "video",
            script,
            config,
            prompt,
            images,
            params: {
                seconds: normalizeVideoSeconds(config.videoSeconds),
                size: normalizeVideoSize(config.size),
                resolution: normalizeVideoResolution(config.vquality),
                ratio: config.size,
                generateAudio: boolConfig(config.videoGenerateAudio, true),
                watermark: boolConfig(config.videoWatermark, false),
            },
            signal: options?.signal,
        }),
    );
    const id = `script-${nanoid()}`;
    modelScriptVideoResults.set(id, result);
    return { id, provider: "script", model };
}

function normalizeModelScriptVideo(result: unknown): VideoGenerationResult {
    if (result instanceof Blob) return { blob: result };
    if (typeof result === "string" && result.trim()) return { url: result.trim(), mimeType: "video/mp4" };
    if (result && typeof result === "object") {
        const record = result as Record<string, unknown>;
        if (record.blob instanceof Blob) return { blob: record.blob };
        const url = [record.url, record.video_url, record.result_url].find((value) => typeof value === "string" && value.trim()) as string | undefined;
        if (url) return { url, mimeType: typeof record.mimeType === "string" ? record.mimeType : "video/mp4" };
    }
    throw new Error("模型调用脚本没有返回视频");
}

async function createOpenAIVideoTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], options?: RequestOptions): Promise<VideoGenerationTask> {
    const body = new FormData();
    const requestModel = modelOptionName(model);
    const normalizedSize = normalizeVideoSize(config.size);
    body.append("model", requestModel);
    body.append("prompt", prompt);
    body.append("seconds", normalizeVideoSeconds(config.videoSeconds));
    if (normalizedSize) body.append("size", normalizedSize);
    body.append("resolution_name", normalizeVideoResolution(config.vquality));
    body.append("preset", "normal");
    const files = await Promise.all(references.slice(0, 7).map(async (image) => dataUrlToFile({ ...image, dataUrl: await imageToDataUrl(image) })));
    files.forEach((file) => body.append("input_reference[]", file));
    try {
        const requestUrl = aiApiUrl(config, "/videos");
        const created = unwrapVideoResponse((await axios.post<ApiVideoResponse>(requestUrl, body, { headers: aiHeaders(config), signal: options?.signal })).data);
        if (!created.id) throw new Error("视频接口没有返回任务 ID");
        return { id: created.id, provider: "openai", model, requestMethod: "POST", requestUrl, requestModel, requestFields: ["model", "prompt", "seconds", ...(normalizedSize ? ["size"] : []), "resolution_name", "preset", ...(files.length ? ["input_reference[]"] : [])] };
    } catch (error) {
        throw new Error(readAxiosError(error, "视频任务创建失败"));
    }
}

async function pollOpenAIVideoTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        const video = unwrapVideoResponse((await axios.get<ApiVideoResponse>(aiApiUrl(config, `/videos/${task.id}`), { headers: aiHeaders(config), signal: options?.signal })).data);
        const url = videoResultUrl(video);
        if (url) return { status: "completed", result: await videoResultFromUrl(url, options), providerStatus: video.status };
        if (video.status === "completed") {
            options?.onProgress?.({ percent: 90, text: "视频任务完成，正在下载视频", stage: "saving", providerStatus: video.status });
            const content = await axios.get<Blob>(aiApiUrl(config, `/videos/${task.id}/content`), { headers: aiHeaders(config), responseType: "blob", signal: options?.signal });
            await assertVideoBlob(content.data);
            return { status: "completed", result: { blob: content.data }, providerStatus: video.status };
        }
        if (video.status === "failed" || video.status === "cancelled") return { status: "failed", error: video.error?.message || "视频生成失败", providerStatus: video.status };
        return { status: "pending", providerStatus: video.status };
    } catch (error) {
        throw new Error(readAxiosError(error, "视频任务查询失败"));
    }
}

async function createCangyuanVideoTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[], options?: RequestOptions): Promise<VideoGenerationTask> {
    if (isCangyuanGrokVideoModel(model)) {
        return createCangyuanGrokVideoTask(config, model, prompt, references, videoReferences, audioReferences, options);
    }
    if (isSoraVideoModel(model)) return createCangyuanSoraVideoTask(config, model, prompt, references, videoReferences, audioReferences, options);
    if (isOmniImageVideoModel(model)) return references.length <= 1
        ? createCangyuanOmniSingleImageTask(config, model, prompt, references, videoReferences, audioReferences, options)
        : createCangyuanOmniImageTask(config, model, prompt, references, videoReferences, audioReferences, options);
    if (isOmniVideoToVideoModel(model)) return createCangyuanOmniVideoTask(config, model, prompt, references, videoReferences, audioReferences, options);
    if (isVeoVideoModel(model)) return createCangyuanVeoVideoTask(config, model, prompt, references, videoReferences, audioReferences, options);
    if (isCangyuanSd5SeedanceModel(model)) return createCangyuanSd5SeedanceVideoTask(config, model, prompt, references, videoReferences, audioReferences, options);
    const limits = videoReferenceLimits(model) || SEEDANCE_REFERENCE_LIMITS;
    const modelName = cangyuanSeedanceMiniModelName(model);
    const fixedResolution = seedanceModelFixedResolution(modelName);
    if (references.length > limits.images) throw new Error(`${modelName} 参考图不能超过 ${limits.images} 张`);
    if (videoReferences.length > limits.videos) throw new Error(`${modelName} 参考视频不能超过 ${limits.videos} 条`);
    if (audioReferences.length > limits.audios) throw new Error(`${modelName} 参考音频不能超过 ${limits.audios} 条`);
    if ((videoReferences.length || audioReferences.length) && !references.length) {
        throw new Error("沧元算力视频参考视频/音频必须同时提供至少 1 张主参考图");
    }
    assertSeedanceVideoReferences(videoReferences, fixedResolution ? 2_000 : 4_000, fixedResolution ? { minSize: 300, maxSize: 6000, minAspectRatio: 0.4, maxAspectRatio: 2.5 } : undefined);
    assertSeedanceAudioReferences(audioReferences);
    const limitedReferences = references.slice(0, limits.images);
    const firstFrameIndex = limitedReferences.findIndex((image) => image.videoReferenceRole === "firstFrame");
    const requestReferences = firstFrameIndex > 0 ? [limitedReferences[firstFrameIndex], ...limitedReferences.filter((_, index) => index !== firstFrameIndex)] : limitedReferences;
    const imageUrls = await Promise.all(requestReferences.map((image) => resolveSeedanceImageUrl(config, image)));
    const requestPrompt = buildCangyuanSeedanceMiniPrompt(prompt, requestReferences, videoReferences, audioReferences);
    if (requestPrompt.length > 5000) throw new Error(`${modelName} 最终视频提示词不能超过 5000 个字符，请精简提示词或参考素材名称`);
    const selectedVideos = videoReferences.slice(0, limits.videos);
    if (selectedVideos.some((item) => !isPublicMediaUrl(item.url))) options?.onProgress?.({ percent: 4, text: `正在临时发布 ${selectedVideos.filter((item) => !isPublicMediaUrl(item.url)).length} 条本地参考视频，生成结束后自动删除`, stage: "uploading-references" });
    const referenceVideos = await publishCangyuanReferenceVideos(selectedVideos, options?.signal);
    const referenceAudios = audioReferences.slice(0, limits.audios).map((item, index) => resolveCangyuanHttpsReferenceUrl(item.url, `参考音频 ${index + 1}`));
    const hasFirstFrame = firstFrameIndex >= 0;
    const requiresPrimaryImage = hasFirstFrame || Boolean(referenceVideos.length || referenceAudios.length);
    const primaryImageUrl = requiresPrimaryImage ? imageUrls[0] || "" : "";
    const referenceImageUrls = requiresPrimaryImage ? imageUrls.slice(1) : imageUrls;
    try {
        const requestUrl = aiApiUrl(config, "/videos");
        let created: VideoResponse;
        let requestFields: string[];
        const useMultipartImage = hasFirstFrame && imageUrls.length === 1 && imageUrls[0].startsWith("data:") && !referenceVideos.length && !referenceAudios.length;
        if (useMultipartImage) {
            const body = new FormData();
            body.set("model", modelName);
            body.set("prompt", requestPrompt);
            body.set("aspect_ratio", normalizeCangyuanVideoRatio(config.size));
            body.set("duration", String(normalizeCangyuanVideoDuration(config.videoSeconds)));
            if (!fixedResolution) {
                body.set("resolution", normalizeCangyuanSeedanceResolution(config.vquality));
                body.set("audio", String(boolConfig(config.videoGenerateAudio, true)));
            }
            body.append("image", dataUrlToFile({ ...requestReferences[0], dataUrl: imageUrls[0] }), requestReferences[0].name || "reference.png");
            referenceVideos.forEach((url) => body.append("reference_videos", url));
            referenceAudios.forEach((url) => body.append("reference_audios", url));
            created = unwrapVideoResponse((await axios.post<ApiVideoResponse>(requestUrl, body, { headers: aiHeaders(config), signal: options?.signal })).data);
            requestFields = ["model", "prompt", "aspect_ratio", "duration", ...(!fixedResolution ? ["resolution", "audio"] : []), "image"];
        } else {
            const payload = {
                model: modelName,
                prompt: requestPrompt,
                aspect_ratio: normalizeCangyuanVideoRatio(config.size),
                duration: normalizeCangyuanVideoDuration(config.videoSeconds),
                ...(!fixedResolution ? { resolution: normalizeCangyuanSeedanceResolution(config.vquality), audio: boolConfig(config.videoGenerateAudio, true) } : {}),
                ...(fixedResolution && primaryImageUrl ? { image_url: primaryImageUrl } : {}),
                ...(fixedResolution && referenceImageUrls.length ? { reference_image_urls: referenceImageUrls } : {}),
                ...(!fixedResolution && primaryImageUrl ? { image_url: primaryImageUrl } : {}),
                ...(!fixedResolution && referenceImageUrls.length ? { reference_image_urls: referenceImageUrls } : {}),
                ...(referenceVideos.length ? { reference_videos: referenceVideos } : {}),
                ...(referenceAudios.length ? { reference_audios: referenceAudios } : {}),
            };
            created = unwrapVideoResponse((await axios.post<ApiVideoResponse>(requestUrl, payload, { headers: aiHeaders(config, "application/json"), signal: options?.signal })).data);
            requestFields = Object.keys(payload);
        }
        const taskId = cangyuanVideoTaskId(created);
        if (!taskId) throw new Error("视频接口没有返回任务 ID");
        const requestSummary = await buildVideoRequestSummary(
            modelName,
            requestPrompt,
            {
                aspectRatio: normalizeCangyuanVideoRatio(config.size),
                duration: normalizeCangyuanVideoDuration(config.videoSeconds),
                ...(fixedResolution ? { fixedResolution } : { resolution: normalizeCangyuanSeedanceResolution(config.vquality), generateAudio: boolConfig(config.videoGenerateAudio, true) }),
                transport: useMultipartImage ? "multipart" : "json",
            },
            requestReferences,
            videoReferences,
            audioReferences,
        );
        return { id: taskId, provider: "cangyuan", model, cangyuanEndpoint: "videos", requestMethod: "POST", requestUrl, requestModel: modelName, requestFields, requestSummary, temporaryReferenceUrls: referenceVideos.filter(isTemporaryReferenceVideoUrl) };
    } catch (error) {
        await deleteTemporaryReferenceVideos(referenceVideos.filter(isTemporaryReferenceVideoUrl));
        throw new Error(readAxiosError(error, "视频任务创建失败"));
    }
}

function buildCangyuanSeedanceMiniPrompt(prompt: string, images: ReferenceImage[], videos: ReferenceVideo[], audios: ReferenceAudio[]) {
    return buildCangyuanSeedancePrompt(prompt, images, videos, audios);
}

function cangyuanSeedanceMiniModelName(model: string) {
    const name = modelOptionName(model);
    return /^seedance-2\.0-mini(?:-8s)?$/i.test(name) ? "seedance-2.0-mini" : name;
}

async function createCangyuanSd5SeedanceVideoTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[], options?: RequestOptions): Promise<VideoGenerationTask> {
    const modelName = modelOptionName(model);
    const limits = CANGYUAN_SD5_SEEDANCE_REFERENCE_LIMITS;
    if (references.length > limits.images) throw new Error(`${modelName} 参考图不能超过 ${limits.images} 张`);
    if (videoReferences.length > limits.videos) throw new Error(`${modelName} 参考视频不能超过 ${limits.videos} 条`);
    if (audioReferences.length > limits.audios) throw new Error(`${modelName} 参考音频不能超过 ${limits.audios} 条`);
    if (references.length + videoReferences.length + audioReferences.length > CANGYUAN_SD5_SEEDANCE_REFERENCE_TOTAL_LIMIT) throw new Error(`${modelName} 三类参考素材合计不能超过 ${CANGYUAN_SD5_SEEDANCE_REFERENCE_TOTAL_LIMIT} 个`);
    const imageUrls = await Promise.all(references.slice(0, limits.images).map((image) => resolveSeedanceImageUrl(config, image)));
    const requestPrompt = buildCangyuanSd5SeedancePrompt(prompt, references, videoReferences, audioReferences);
    if (requestPrompt.length > 1200) throw new Error(`${modelName} 视频提示词不能超过 1200 个字符，请精简提示词或参考素材名称`);
    const selectedVideos = videoReferences.slice(0, limits.videos);
    if (selectedVideos.some((item) => !isPublicMediaUrl(item.url))) options?.onProgress?.({ percent: 4, text: `正在临时发布 ${selectedVideos.filter((item) => !isPublicMediaUrl(item.url)).length} 条本地参考视频，生成结束后自动删除`, stage: "uploading-references" });
    const referenceVideos = await publishCangyuanReferenceVideos(selectedVideos, options?.signal);
    const referenceAudios = audioReferences.slice(0, limits.audios).map((item, index) => resolveCangyuanHttpsReferenceUrl(item.url, `参考音频 ${index + 1}`));
    const payload = {
        model: modelName,
        prompt: requestPrompt,
        duration: normalizeCangyuanVideoDuration(config.videoSeconds),
        aspect_ratio: normalizeCangyuanVideoRatio(config.size) === "9:16" ? "9:16" : "16:9",
        generate_audio: boolConfig(config.videoGenerateAudio, true),
        resolution: normalizeCangyuanSeedanceResolution(config.vquality),
        ...(imageUrls.length || referenceVideos.length || referenceAudios.length ? { reference_mode: "media" } : {}),
        ...(imageUrls.length ? { images: imageUrls } : {}),
        ...(referenceVideos.length ? { reference_videos: referenceVideos } : {}),
        ...(referenceAudios.length ? { reference_audios: referenceAudios } : {}),
    };
    try {
        const requestUrl = aiApiUrl(config, "/videos");
        const created = unwrapVideoResponse((await axios.post<ApiVideoResponse>(requestUrl, payload, { headers: aiHeaders(config, "application/json"), signal: options?.signal })).data);
        const taskId = cangyuanVideoTaskId(created);
        if (!taskId) throw new Error("SD5 Seedance 视频接口没有返回任务 ID");
        const requestSummary = await buildVideoRequestSummary(
            payload.model,
            requestPrompt,
            { duration: payload.duration, aspectRatio: payload.aspect_ratio, generateAudio: payload.generate_audio, resolution: payload.resolution, referenceMode: payload.reference_mode || "none" },
            references.slice(0, limits.images),
            videoReferences.slice(0, limits.videos),
            audioReferences.slice(0, limits.audios),
        );
        return { id: taskId, provider: "cangyuan", model, cangyuanEndpoint: "videos", requestMethod: "POST", requestUrl, requestModel: payload.model, requestFields: Object.keys(payload), requestSummary, temporaryReferenceUrls: referenceVideos.filter(isTemporaryReferenceVideoUrl) };
    } catch (error) {
        await deleteTemporaryReferenceVideos(referenceVideos.filter(isTemporaryReferenceVideoUrl));
        throw new Error(readAxiosError(error, "SD5 Seedance 视频任务创建失败", modelName));
    }
}

function buildCangyuanSd5SeedancePrompt(prompt: string, images: ReferenceImage[], videos: ReferenceVideo[], audios: ReferenceAudio[]) {
    return buildCangyuanSeedancePrompt(prompt, images, videos, audios);
}

function buildCangyuanSeedancePrompt(prompt: string, images: ReferenceImage[], videos: ReferenceVideo[], audios: ReferenceAudio[]) {
    let text = prompt.trim()
        .replace(/@?(?:图片|image)(\d+)/gi, "@image$1")
        .replace(/@?(?:视频|video)(\d+)/gi, "@video$1")
        .replace(/@?(?:音频|audio)(\d+)/gi, "@audio$1");
    [
        { prefix: "image", items: images },
        { prefix: "video", items: videos },
        { prefix: "audio", items: audios },
    ].forEach(({ prefix, items }) => {
        items.forEach((item, index) => {
            referenceNameAliases(item.name).forEach((name) => {
                text = text.replace(new RegExp(escapeRegExp(name), "gi"), `@${prefix}${index + 1}`);
            });
        });
    });
    const labels = [...images.map((_, index) => `@image${index + 1}`), ...videos.map((_, index) => `@video${index + 1}`), ...audios.map((_, index) => `@audio${index + 1}`)];
    const missing = labels.filter((label) => !new RegExp(`${label}(?!\\d)`, "i").test(text));
    const bindings = [
        ...images.map((item, index) => `@image${index + 1}=${referenceDisplayName(item.name, index)}（${referenceImageBindingDescription(item)}）`),
        ...videos.map((item, index) => `@video${index + 1}=${referenceDisplayName(item.name, index)}（仅参考动作与运镜）`),
        ...audios.map((item, index) => `@audio${index + 1}=${referenceDisplayName(item.name, index)}（仅参考声音与节奏）`),
    ];
    return bindings.length ? `参考素材绑定（顺序与实际上传数组一致）：${bindings.join("；")}。${missing.length ? `已绑定但正文未点名：${missing.join("、")}。` : ""}\n\n${text}` : text;
}

function referenceImageBindingDescription(image: ReferenceImage) {
    const role = referenceImageSemanticRole(image);
    if (role === "firstFrame") return "首帧参考，锁定起始构图、人物站位与画面状态";
    if (role === "lastFrame") return "尾帧参考，锁定结束构图、人物站位与画面状态";
    if (role === "scene") return "场景空间参考，锁定地点结构、陈设、材质与光线，不控制人物身份";
    if (role === "prop") return "关键道具参考，锁定道具外观、材质、尺寸与使用连续性，不控制人物身份";
    if (role === "character") return "人物参考，锁定对应人物的身份、脸部、发型、服装、年龄状态与画风";
    return "素材参考，仅锁定该素材对应主体的外观、材质与画风，不控制人物身份";
}

function referenceImageSemanticRole(image: ReferenceImage): VideoRequestReferenceSummary["role"] {
    if (image.videoReferenceRole === "firstFrame") return "firstFrame";
    if (image.videoReferenceRole === "lastFrame") return "lastFrame";
    if (image.videoReferenceRole === "sceneLock") return "scene";
    if (image.referenceKind) return image.referenceKind;
    const name = referenceDisplayName(image.name, 0);
    if (/(道具|襁褓|婴儿篮|摇篮|竹篮|行李|信件|钥匙|武器|佩剑|刀具|手枪|手机|书本|雨伞|箱子|杯子|桌椅|器具)/i.test(name)) return "prop";
    if (/(场景|空间|室内|室外|卧房|卧室|客厅|厨房|房间|木屋|山村|街道|庭院|店铺|教室|医院|办公室|山林|海边|多角度锁定图)/i.test(name)) return "scene";
    if (/(人物|角色|主角|配角|婴儿|幼儿|男孩|女孩|少年|少女|青年|中年|老年|出生时|幼年时|少年时|青年时|中年时|老年时)/i.test(name)) return "character";
    return "reference";
}

async function buildVideoRequestSummary(
    model: string,
    prompt: string,
    parameters: VideoRequestSummary["parameters"],
    images: ReferenceImage[],
    videos: ReferenceVideo[],
    audios: ReferenceAudio[],
): VideoRequestSummary {
    const imageSummaries: VideoRequestReferenceSummary[] = images.map((item, index) => ({
        order: index + 1,
        mediaType: "image",
        name: referenceDisplayName(item.name, index),
        role: referenceImageSemanticRole(item),
        mimeType: item.type || undefined,
        source: referenceSource(item.storageKey, item.url || item.dataUrl),
        bytes: dataUrlByteLength(item.dataUrl),
    }));
    const videoSummaries: VideoRequestReferenceSummary[] = videos.map((item, index) => ({
        order: imageSummaries.length + index + 1,
        mediaType: "video",
        name: referenceDisplayName(item.name, index),
        role: "reference",
        mimeType: item.type || undefined,
        source: referenceSource(item.storageKey, item.url),
        bytes: item.bytes,
        width: item.width,
        height: item.height,
        durationMs: item.durationMs,
    }));
    const audioSummaries: VideoRequestReferenceSummary[] = audios.map((item, index) => ({
        order: imageSummaries.length + videoSummaries.length + index + 1,
        mediaType: "audio",
        name: referenceDisplayName(item.name, index),
        role: "reference",
        mimeType: item.type || undefined,
        source: referenceSource(item.storageKey, item.url),
        durationMs: item.durationMs,
    }));
    let promptSha256 = "unavailable";
    try {
        if (globalThis.crypto?.subtle) promptSha256 = Array.from(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(prompt)))).map((value) => value.toString(16).padStart(2, "0")).join("");
    } catch {
        // Request diagnostics must never invalidate an already-created provider task.
    }
    return { model, promptLength: prompt.length, promptSha256, parameters, references: [...imageSummaries, ...videoSummaries, ...audioSummaries] };
}

function referenceSource(storageKey: string | undefined, value: string | undefined): VideoRequestReferenceSummary["source"] {
    if (storageKey) return "stored";
    if (value?.startsWith("data:")) return "inline";
    if (value && /^(?:https?:)?\/\//i.test(value)) return "remote";
    return "unknown";
}

function dataUrlByteLength(value: string) {
    if (!value.startsWith("data:")) return undefined;
    const commaIndex = value.indexOf(",");
    if (commaIndex < 0) return undefined;
    const content = value.slice(commaIndex + 1);
    if (!value.slice(0, commaIndex).includes(";base64")) {
        try {
            return new TextEncoder().encode(decodeURIComponent(content)).byteLength;
        } catch {
            return new TextEncoder().encode(content).byteLength;
        }
    }
    return Math.max(0, Math.floor((content.length * 3) / 4) - (content.endsWith("==") ? 2 : content.endsWith("=") ? 1 : 0));
}

function referenceDisplayName(name: string, index: number) {
    return name.replace(/\.(png|jpe?g|webp|gif|mp4|mov|mp3|wav|m4a)$/i, "").trim() || `素材${index + 1}`;
}

function referenceNameAliases(name: string) {
    const aliases = new Set<string>();
    let value = name.trim();
    while (value) {
        aliases.add(value);
        const next = value.replace(/\.(?:png|jpe?g|webp|gif|mp4|mov|webm|mp3|wav|m4a|aac)$/i, "");
        if (next === value) break;
        value = next;
    }
    return Array.from(aliases)
        .filter((alias) => alias.length >= 3 && !/^(?:image|video|audio|图片|视频|音频)\d*$/i.test(alias))
        .sort((left, right) => right.length - left.length);
}

function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function createCangyuanVeoVideoTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[], options?: RequestOptions): Promise<VideoGenerationTask> {
    const modelName = modelOptionName(model);
    const limits = videoReferenceLimits(modelName)!;
    if (references.length > limits.images) throw new Error(`${modelName} 参考图不能超过 ${limits.images} 张`);
    if (videoReferences.length || audioReferences.length) throw new Error(`${modelName} 不支持参考视频或参考音频`);
    const images = await Promise.all(references.slice(0, limits.images).map((image) => resolveSeedanceImageUrl(config, image)));
    const payload = {
        model: modelName,
        prompt,
        duration: normalizeCangyuanVeoDuration(config.videoSeconds),
        aspect_ratio: normalizeCangyuanOmniRatio(config.size),
        generate_audio: boolConfig(config.videoGenerateAudio, true),
        resolution: normalizeCangyuanVeoResolution(config.vquality),
        reference_mode: isVeoReferenceVideoModel(modelName) ? "image" : "frame",
        ...(images.length ? { images } : {}),
    };
    try {
        const requestUrl = aiApiUrl(config, "/videos");
        const created = unwrapVideoResponse((await axios.post<ApiVideoResponse>(requestUrl, payload, { headers: aiHeaders(config, "application/json"), signal: options?.signal })).data);
        const taskId = cangyuanVideoTaskId(created);
        if (!taskId) throw new Error("Veo 视频接口没有返回任务 ID");
        return { id: taskId, provider: "cangyuan", model, cangyuanEndpoint: "videos", requestMethod: "POST", requestUrl, requestModel: payload.model, requestFields: Object.keys(payload) };
    } catch (error) {
        throw new Error(readAxiosError(error, "Veo 视频任务创建失败", modelName));
    }
}

async function createCangyuanSoraVideoTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[], options?: RequestOptions): Promise<VideoGenerationTask> {
    const modelName = modelOptionName(model);
    if (references.length > 1) throw new Error(`${modelName} 最多支持 1 张帧参考图`);
    if (videoReferences.length || audioReferences.length) throw new Error(`${modelName} 不支持参考视频或参考音频`);
    const images = await Promise.all(references.slice(0, 1).map((image) => resolveSeedanceImageUrl(config, image)));
    const payload = {
        model: modelName,
        prompt,
        duration: normalizeCangyuanVideoDuration(config.videoSeconds),
        aspect_ratio: normalizeCangyuanOmniRatio(config.size),
        generate_audio: boolConfig(config.videoGenerateAudio, true),
        ...(images.length ? { reference_mode: "frame", images } : {}),
    };
    try {
        const requestUrl = aiApiUrl(config, "/videos");
        const created = unwrapVideoResponse((await axios.post<ApiVideoResponse>(requestUrl, payload, { headers: aiHeaders(config, "application/json"), signal: options?.signal })).data);
        const taskId = cangyuanVideoTaskId(created);
        if (!taskId) throw new Error("Sora 视频接口没有返回任务 ID");
        return { id: taskId, provider: "cangyuan", model, cangyuanEndpoint: "videos", requestMethod: "POST", requestUrl, requestModel: payload.model, requestFields: Object.keys(payload) };
    } catch (error) {
        throw new Error(readAxiosError(error, "Sora 视频任务创建失败", modelName));
    }
}

async function createCangyuanOmniSingleImageTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[], options?: RequestOptions): Promise<VideoGenerationTask> {
    const modelName = modelOptionName(model);
    if (videoReferences.length || audioReferences.length) throw new Error(`${modelName} 只支持参考图，不支持参考视频或参考音频`);
    const imageUrl = references.length ? await resolveSeedanceImageUrl(config, references[0]) : "";
    const payload = { model: modelName, prompt, aspect_ratio: normalizeCangyuanOmniRatio(config.size), ...(imageUrl ? { image_url: imageUrl } : {}) };
    try {
        const requestUrl = aiApiUrl(config, "/videos");
        const created = unwrapVideoResponse((await axios.post<ApiVideoResponse>(requestUrl, payload, { headers: aiHeaders(config, "application/json"), signal: options?.signal })).data);
        const taskId = cangyuanVideoTaskId(created);
        if (!taskId) throw new Error("Omni 视频接口没有返回任务 ID");
        return { id: taskId, provider: "cangyuan", model, cangyuanEndpoint: "videos", requestMethod: "POST", requestUrl, requestModel: modelName, requestFields: Object.keys(payload) };
    } catch (error) {
        throw new Error(readAxiosError(error, "Omni 视频任务创建失败"));
    }
}

async function createCangyuanOmniImageTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[], options?: RequestOptions): Promise<VideoGenerationTask> {
    const limits = videoReferenceLimits(model)!;
    const modelName = modelOptionName(model);
    if (references.length > limits.images) throw new Error(`${modelName} 参考图不能超过 ${limits.images} 张`);
    if (videoReferences.length || audioReferences.length) throw new Error(`${modelName} 只支持参考图，不支持参考视频或参考音频`);
    const body = new FormData();
    body.set("model", modelName);
    body.set("prompt", prompt);
    body.set("aspect_ratio", normalizeCangyuanOmniRatio(config.size));
    const files = await Promise.all(references.map(async (image) => dataUrlToFile({ ...image, dataUrl: await imageToDataUrl(image) })));
    const oversizedIndex = files.findIndex((file) => file.size > 5 * 1024 * 1024);
    if (oversizedIndex >= 0) throw new Error(`参考图 ${oversizedIndex + 1} 超过 ${modelName} 单图 5MB 上限`);
    files.forEach((file) => body.append("input_reference", file));
    try {
        const requestUrl = aiApiUrl(config, "/videos");
        const created = unwrapVideoResponse((await axios.post<ApiVideoResponse>(requestUrl, body, { headers: aiHeaders(config), signal: options?.signal })).data);
        const taskId = cangyuanVideoTaskId(created);
        if (!taskId) throw new Error("Omni 视频接口没有返回任务 ID");
        return { id: taskId, provider: "cangyuan", model, cangyuanEndpoint: "videos", requestMethod: "POST", requestUrl, requestModel: modelName, requestFields: ["model", "prompt", "aspect_ratio", ...(files.length ? ["input_reference"] : [])] };
    } catch (error) {
        throw new Error(readAxiosError(error, "Omni 视频任务创建失败"));
    }
}

async function createCangyuanOmniVideoTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[], options?: RequestOptions): Promise<VideoGenerationTask> {
    const modelName = modelOptionName(model);
    if (references.length || audioReferences.length || videoReferences.length !== 1) throw new Error(`${modelName} 必须且只能提供 1 条源视频，不支持参考图或参考音频`);
    const requestUrl = aiApiUrl(config, "/videos");
    try {
        let created: VideoResponse;
        let requestFields: string[];
        if (isPublicMediaUrl(videoReferences[0].url)) {
            const payload = { model: modelName, prompt, aspect_ratio: normalizeCangyuanOmniRatio(config.size), video_url: videoReferences[0].url };
            created = unwrapVideoResponse((await axios.post<ApiVideoResponse>(requestUrl, payload, { headers: aiHeaders(config, "application/json"), signal: options?.signal })).data);
            requestFields = Object.keys(payload);
        } else {
            const body = new FormData();
            body.set("model", modelName);
            body.set("prompt", prompt);
            body.set("aspect_ratio", normalizeCangyuanOmniRatio(config.size));
            body.set("input_video", await referenceVideoFile(videoReferences[0]), videoReferences[0].name || "reference.mp4");
            created = unwrapVideoResponse((await axios.post<ApiVideoResponse>(requestUrl, body, { headers: aiHeaders(config), signal: options?.signal })).data);
            requestFields = ["model", "prompt", "aspect_ratio", "input_video"];
        }
        const taskId = cangyuanVideoTaskId(created);
        if (!taskId) throw new Error("Omni V2V 视频接口没有返回任务 ID");
        return { id: taskId, provider: "cangyuan", model, cangyuanEndpoint: "videos", requestMethod: "POST", requestUrl, requestModel: modelName, requestFields };
    } catch (error) {
        throw new Error(readAxiosError(error, "Omni V2V 视频任务创建失败"));
    }
}

async function referenceVideoFile(video: ReferenceVideo) {
    const stored = video.storageKey ? await getMediaBlob(video.storageKey) : null;
    const blob = stored || (video.url?.startsWith("blob:") || video.url?.startsWith("data:") ? await (await fetch(video.url)).blob() : null);
    if (!blob) throw new Error("源视频无法读取，请重新上传后再生成");
    if (blob.size > 5 * 1024 * 1024) throw new Error("Omni V2V 源视频不能超过 5MB");
    return blob;
}

async function createCangyuanGrokVideoTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[], options?: RequestOptions): Promise<VideoGenerationTask> {
    if (audioReferences.length) throw new Error("沧元 Grok 视频模型暂不支持音频参考，请移除音频后重试");
    const modelName = modelOptionName(model);
    const isGrok15 = modelName.toLowerCase().includes("grok-video-1.5");
    if (isGrok15 && (references.length !== 1 || videoReferences.length)) throw new Error("grok-video-1.5 必须且只能连接 1 张参考图，不支持纯文生或视频参考");
    if (!isGrok15 && references.length > 7) throw new Error("grok-video 最多支持 7 张参考图");
    const imageUrls = await Promise.all(references.slice(0, 7).map((image) => resolveSeedanceImageUrl(config, image)));
    const videoUrl = videoReferences[0] ? await resolveSeedanceVideoUrl(videoReferences[0]) : "";
    const duration = normalizeCangyuanVideoDuration(config.videoSeconds);
    const payload = {
        model: modelName,
        prompt: buildSeedancePromptText(prompt, references, videoReferences, []),
        seconds: duration,
        duration,
        aspect_ratio: normalizeCangyuanGrokRatio(config.size),
        resolution: normalizeCangyuanGrokResolution(config.vquality),
        ...(imageUrls.length ? { image_urls: imageUrls } : {}),
        ...(videoUrl ? { video_url: videoUrl } : {}),
    };
    try {
        const requestUrl = aiApiUrl(config, "/video/generations");
        const created = unwrapVideoResponse((await axios.post<ApiVideoResponse>(requestUrl, payload, { headers: aiHeaders(config, "application/json"), signal: options?.signal })).data);
        const taskId = cangyuanVideoTaskId(created);
        if (!taskId) throw new Error("Grok 视频接口没有返回任务 ID");
        return { id: taskId, provider: "cangyuan", model, cangyuanEndpoint: "video-generations", requestMethod: "POST", requestUrl, requestModel: payload.model, requestFields: Object.keys(payload) };
    } catch (error) {
        throw new Error(readAxiosError(error, "Grok 视频任务创建失败"));
    }
}

async function pollCangyuanVideoTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        const video = unwrapVideoResponse((await axios.get<ApiVideoResponse>(aiApiUrl(config, cangyuanVideoTaskPath(task)), { headers: aiHeaders(config), signal: options?.signal })).data);
        const providerStatus = cangyuanVideoStatus(video);
        const progress = cangyuanVideoProgress(video);
        if (isCangyuanVideoCompleted(providerStatus)) {
            const url = cangyuanVideoUrl(video);
            if (task.cangyuanEndpoint === "video-generations") {
                if (url) return { status: "completed", result: await videoResultFromUrl(url, options), providerStatus, progress };
                return { status: "failed", error: "Grok 视频任务完成但没有返回视频 URL", providerStatus, progress };
            }
            const result = await cangyuanVideoResult(config, task, url, options);
            return { status: "completed", result, providerStatus, progress };
        }
        if (isCangyuanVideoFailed(providerStatus)) return { status: "failed", error: cangyuanVideoError(video), providerStatus, progress };
        return { status: "pending", providerStatus: providerStatus || "in_progress", progress };
    } catch (error) {
        throw new Error(readAxiosError(error, "视频任务查询失败"));
    }
}

async function createSeedanceTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[], options?: RequestOptions): Promise<VideoGenerationTask> {
    if (audioReferences.length && !references.length && !videoReferences.length) {
        throw new Error("Seedance 参考音频不能单独使用，请同时添加参考图或参考视频");
    }
    assertSeedanceVideoReferences(videoReferences);
    assertSeedanceAudioReferences(audioReferences);
    const content = await buildSeedanceContent(config, prompt, references, videoReferences, audioReferences);
    if (!content.length) throw new Error("请输入视频提示词，或连接参考图片/视频/音频");
    const payload = buildSeedancePayload(config, model, content);

    try {
        const requestUrl = seedanceApiUrl(config);
        const created = unwrapSeedanceTask((await axios.post<ApiEnvelope<SeedanceTask>>(requestUrl, payload, { headers: aiHeaders(config, "application/json"), signal: options?.signal })).data);
        if (!created.id) throw new Error("Seedance 接口没有返回任务 ID");
        return { id: created.id, provider: "seedance", model, requestMethod: "POST", requestUrl, requestModel: payload.model, requestFields: Object.keys(payload) };
    } catch (error) {
        throw new Error(readAxiosError(error, "Seedance 任务创建失败"));
    }
}

async function pollSeedanceTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        const state = unwrapSeedanceTask((await axios.get<ApiEnvelope<SeedanceTask>>(seedanceApiUrl(config, task.id), { headers: aiHeaders(config), signal: options?.signal })).data);
        if (state.status === "succeeded" || state.status === "completed") {
            const url = videoResultUrl(state);
            if (!url) return { status: "failed", error: "Seedance 任务成功但没有返回视频 URL", providerStatus: state.status };
            options?.onProgress?.({ percent: 90, text: "Seedance 任务成功，正在下载视频", stage: "saving", providerStatus: state.status });
            return { status: "completed", result: await videoResultFromUrl(url, options), providerStatus: state.status };
        }
        if (state.status === "failed" || state.status === "cancelled" || state.status === "expired") return { status: "failed", error: normalizeVideoErrorMessage(state.error?.message || `Seedance 视频生成${state.status === "expired" ? "超时" : "失败"}`), providerStatus: state.status };
        return { status: "pending", providerStatus: state.status || "running" };
    } catch (error) {
        throw new Error(readAxiosError(error, "Seedance 任务查询失败"));
    }
}

function buildSeedancePayload(config: AiConfig, model: string, content: Array<Record<string, unknown>>): SeedancePayload {
    const modelName = modelOptionName(model);
    return {
        model: modelName,
        content,
        ratio: normalizeSeedanceRatio(config.size),
        resolution: normalizeSeedanceApiResolution(config.vquality, modelName),
        duration: normalizeSeedanceDuration(config.videoSeconds),
        generate_audio: boolConfig(config.videoGenerateAudio, true),
        watermark: boolConfig(config.videoWatermark, false),
    };
}

function assertSeedanceVideoReferences(videoReferences: ReferenceVideo[], minDurationMs = 4_000, bounds?: { minSize?: number; maxSize?: number; minAspectRatio?: number; maxAspectRatio?: number }) {
    const error = seedanceVideoReferenceError(videoReferences, minDurationMs, bounds);
    if (error) throw new Error(error);
}

function assertSeedanceAudioReferences(audioReferences: ReferenceAudio[]) {
    for (const audio of audioReferences) {
        if (!audio.durationMs) continue;
        if (audio.durationMs > 15000) throw new Error("Seedance 参考音频单个时长不能超过 15 秒");
    }
}

function seedanceApiUrl(config: AiConfig, taskId?: string) {
    return buildApiUrl(config.baseUrl, `/contents/generations/tasks${taskId ? `/${encodeURIComponent(taskId)}` : ""}`);
}

async function buildSeedanceContent(config: AiConfig, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[]) {
    const content: Array<Record<string, unknown>> = [];
    const text = buildSeedancePromptText(prompt, references, videoReferences, audioReferences);
    if (text) content.push({ type: "text", text });
    for (const image of references.slice(0, SEEDANCE_REFERENCE_LIMITS.images)) {
        content.push({ type: "image_url", image_url: { url: await resolveSeedanceImageUrl(config, image) }, role: "reference_image" });
    }
    for (const video of videoReferences.slice(0, SEEDANCE_REFERENCE_LIMITS.videos)) {
        content.push({ type: "video_url", video_url: { url: await resolveSeedanceVideoUrl(video) }, role: "reference_video" });
    }
    for (const audio of audioReferences.slice(0, SEEDANCE_REFERENCE_LIMITS.audios)) {
        content.push({ type: "audio_url", audio_url: { url: await resolveSeedanceAudioUrl(audio) }, role: "reference_audio" });
    }
    return content;
}

async function resolveSeedanceImageUrl(config: AiConfig, image: ReferenceImage) {
    const directUrl = image.url || image.dataUrl;
    if (isPublicMediaUrl(directUrl)) return directUrl;
    const dataUrl = await imageToDataUrl(image);
    if (!dataUrl) throw new Error("参考图读取失败，请换一张图片或重新上传");
    return dataUrl;
}

async function resolveSeedanceVideoUrl(video: ReferenceVideo) {
    if (isPublicMediaUrl(video.url)) return video.url;
    let blob: Blob | null = null;
    if (video.storageKey) blob = await getMediaBlob(video.storageKey);
    if (!blob && video.url?.startsWith("blob:")) blob = await (await fetch(video.url)).blob();
    if (!blob) throw new Error("参考视频必须是公网 URL，或本地已保存的视频");
    return blobToDataUrl(blob);
}

async function resolveSeedanceAudioUrl(audio: ReferenceAudio) {
    if (isPublicMediaUrl(audio.url)) return audio.url;
    let blob: Blob | null = null;
    if (audio.storageKey) blob = await getMediaBlob(audio.storageKey);
    if (!blob && audio.url?.startsWith("blob:")) blob = await (await fetch(audio.url)).blob();
    if (!blob) throw new Error("参考音频必须是公网 URL，或本地已保存的音频");
    return blobToDataUrl(blob);
}

async function videoResultFromUrl(url: string, options?: RequestOptions): Promise<VideoGenerationResult> {
    let downloadError: unknown;
    try {
        const response = await axios.get<Blob>(url, { responseType: "blob", signal: options?.signal });
        await assertVideoBlob(response.data);
        return { blob: response.data };
    } catch (error) {
        if (axios.isCancel(error) || options?.signal?.aborted) throw error;
        downloadError = error;
        const blob = await downloadVideoViaAgent(url, options).catch(() => null);
        if (blob) return { blob };
        try {
            await assertPlayableVideoSource(url, options?.signal);
            return { url, mimeType: "video/mp4" };
        } catch (playbackError) {
            if (playbackError instanceof DOMException && playbackError.name === "AbortError") throw playbackError;
            const status = axios.isAxiosError(downloadError) ? downloadError.response?.status : undefined;
            throw new Error(`平台任务已完成，但返回的视频地址${status ? `下载失败（${status}）` : "无法下载且不可播放"}。任务 ID 已保留，请点击“查询原任务”；不要直接重新生成，以免重复扣费。\n\n结果地址：${url}`);
        }
    }
}

async function downloadVideoViaAgent(url: string, options?: RequestOptions) {
    const agent = useAgentStore.getState();
    const endpoint = agent.url.trim().replace(/\/$/, "");
    const token = agent.token.trim();
    if (!endpoint || !token || !isPublicMediaUrl(url)) return null;
    const response = await axios.post<Blob>(`${endpoint}/api/proxy/media/download?token=${encodeURIComponent(token)}`, { url }, { headers: { "Content-Type": "application/json" }, responseType: "blob", signal: options?.signal });
    await assertVideoBlob(response.data);
    return response.data;
}

function assertVideoConfig(config: AiConfig, model: string) {
    if (!model) throw new Error("请先配置视频模型");
    if (!config.baseUrl.trim()) throw new Error("请先配置 Base URL");
    if (!config.apiKey.trim()) throw new Error("请先配置 API Key");
    if (config.apiFormat === "gemini") throw new Error("Gemini 调用格式暂不支持视频生成，请使用 OpenAI 或方舟 Ark 渠道");
}

function normalizeVideoSeconds(value: string) {
    const seconds = Math.floor(Number(value) || 6);
    return String(Math.max(1, Math.min(20, seconds)));
}

function normalizeVideoSize(value: string) {
    if (value === "auto") return null;
    const size = value || "1280x720";
    if (/^\d+x\d+$/.test(size)) return size;
    const ratioSizes: Record<string, string> = {
        "16:9": "1280x720",
        "9:16": "720x1280",
        "4:3": "1024x768",
        "3:4": "768x1024",
        "1:1": "1024x1024",
        "21:9": "1344x576",
        "2:3": "832x1248",
    };
    return ratioSizes[size] || "1280x720";
}

function normalizeVideoResolution(value: string) {
    if (value === "low") return "480p";
    if (value === "auto" || value === "high" || value === "medium") return "720p";
    const resolution = value.replace(/p$/i, "") || "720";
    return `${resolution}p`;
}

function normalizeCangyuanVideoRatio(value: string) {
    const ratio = normalizeSeedanceRatio(value);
    return ratio === "adaptive" ? "16:9" : ratio;
}

function normalizeCangyuanVideoDuration(value: string) {
    const duration = normalizeSeedanceDuration(value);
    return duration === -1 ? 5 : duration;
}

function normalizeCangyuanOmniRatio(value: string) {
    return normalizeCangyuanVideoRatio(value) === "9:16" ? "9:16" : "16:9";
}

function normalizeCangyuanSeedanceResolution(value: string) {
    return normalizeVideoResolution(value).toLowerCase() === "480p" ? "480p" : "720p";
}

function normalizeCangyuanVeoDuration(value: string) {
    const duration = normalizeCangyuanVideoDuration(value);
    return [4, 6, 8].includes(duration) ? duration : 8;
}

function normalizeCangyuanVeoResolution(value: string) {
    return normalizeVideoResolution(value).toLowerCase() === "720p" ? "720p" : "1080p";
}

function isCangyuanGrokVideoModel(model: string) {
    return modelOptionName(model).toLowerCase().startsWith("grok-video");
}

function isCangyuanSeedanceVideoRequest(config: AiConfig, model: string) {
    const baseUrl = config.baseUrl.toLowerCase();
    const modelName = modelOptionName(model).toLowerCase();
    return baseUrl.includes("ai.cangyuansuanli.cn") && (modelName.startsWith("seedance-2.0") || isCangyuanSd5SeedanceModel(modelName) || isVeoVideoModel(modelName));
}

function normalizeCangyuanGrokRatio(value: string) {
    const ratio = normalizeCangyuanVideoRatio(value);
    return ratio === "9:16" ? "9:16" : "16:9";
}

function normalizeCangyuanGrokResolution(value: string) {
    const resolution = normalizeVideoResolution(value).toLowerCase();
    return resolution === "480p" ? "480p" : "720p";
}

function cangyuanVideoTaskPath(task: VideoGenerationTask) {
    return task.cangyuanEndpoint === "video-generations" ? `/video/generations/${encodeURIComponent(task.id)}` : `/videos/${encodeURIComponent(task.id)}`;
}

function cangyuanVideoTaskId(video: VideoResponse) {
    const nested = Array.isArray(video.data) ? video.data : video.data ? [video.data] : [];
    // Admin-shaped responses may include a numeric record ID before the public task ID.
    const candidates: unknown[] = [video.id, video.task_id, ...nested.flatMap((item) => [item.id, item.task_id])];
    const ids = candidates.filter((value): value is string => typeof value === "string" && Boolean(value.trim())).map((value) => value.trim());
    return ids.find((value) => /^task_/i.test(value)) || ids[0] || "";
}

async function cangyuanVideoResult(config: AiConfig, task: VideoGenerationTask, resultUrl: string | undefined, options?: RequestOptions): Promise<VideoGenerationResult> {
    try {
        const content = await axios.get<Blob>(aiApiUrl(config, `/videos/${encodeURIComponent(task.id)}/content`), { headers: aiHeaders(config), responseType: "blob", signal: options?.signal });
        await assertVideoBlob(content.data);
        return { blob: content.data };
    } catch (error) {
        if (axios.isCancel(error) || options?.signal?.aborted) throw error;
        if (resultUrl) return videoResultFromUrl(resultUrl, options);
        throw error;
    }
}

function cangyuanVideoStatus(video: VideoResponse) {
    const nested = Array.isArray(video.data) ? video.data : video.data ? [video.data] : [];
    const nestedStatus = nested.map((item) => stringValue(item.status) || stringValue(item.state)).find(Boolean);
    return (nestedStatus || stringValue(video.status) || stringValue(video.state)).toLowerCase();
}

function isCangyuanVideoCompleted(status: string) {
    return ["completed", "complete", "success", "succeeded", "done"].includes(status);
}

function isCangyuanVideoFailed(status: string) {
    return ["failed", "failure", "fail", "error", "cancelled", "canceled", "expired", "timeout"].includes(status);
}

function cangyuanVideoProgress(video: VideoResponse) {
    const nestedProgress = !Array.isArray(video.data) ? video.data?.progress : undefined;
    return normalizeProgress(video.progress ?? nestedProgress);
}

function cangyuanVideoUrl(video: VideoResponse) {
    if (videoResultUrl(video)) return videoResultUrl(video);
    if (video.video_url) return video.video_url;
    if (video.video?.url) return video.video.url;
    if (video.raw_data?.video_url || video.raw_data?.url) return video.raw_data.video_url || video.raw_data.url;
    if (Array.isArray(video.data)) {
        const item = video.data.find((value) => videoResultUrl(value) || value.video_url || value.video?.url || value.raw_data?.video_url || value.raw_data?.url || value.url);
        return (item ? videoResultUrl(item) : "") || item?.video_url || item?.video?.url || item?.raw_data?.video_url || item?.raw_data?.url || item?.url;
    }
    return (video.data ? videoResultUrl(video.data) : "") || video.data?.video_url || video.data?.video?.url || video.data?.raw_data?.video_url || video.data?.raw_data?.url || video.data?.url;
}

function cangyuanVideoError(video: VideoResponse) {
    const details = collectVideoErrorDetails(video);
    const code = details.codes[0];
    if (code?.toUpperCase() === "GENERATION_FAILED") {
        return "上游已接单并进入生成阶段，但未返回可定位的具体失败原因（provider code: GENERATION_FAILED）。请保留任务 ID 与请求摘要后重试；若重复失败，再据此排查素材、提示词或上游服务。";
    }
    return [details.messages[0] || "视频生成失败", code ? `provider code: ${code}` : ""].filter(Boolean).join("；");
}

function normalizeProgress(value: unknown) {
    const numberValue = typeof value === "number" ? value : typeof value === "string" ? Number.parseFloat(value.replace("%", "")) : NaN;
    return Number.isFinite(numberValue) ? Math.max(0, Math.min(100, numberValue)) : undefined;
}

function unwrapVideoResponse(payload: ApiVideoResponse): VideoResponse {
    if (!payload) throw new Error("接口没有返回视频任务");
    if (isApiVideoEnvelope(payload)) {
        if (payload.code !== 0 && payload.code !== "0") throw new Error(payload.msg || payload.message || payload.error?.message || "请求失败");
        if (!payload.data) throw new Error("接口没有返回视频任务");
        return payload.data;
    }
    return payload;
}

function isApiVideoEnvelope(payload: ApiVideoResponse): payload is ApiVideoEnvelope {
    return "code" in payload && payload.code !== undefined;
}

function unwrapSeedanceTask(payload: ApiEnvelope<SeedanceTask>) {
    return unwrapEnvelope(payload, "Seedance 接口没有返回任务");
}

function unwrapEnvelope<T>(payload: ApiEnvelope<T>, emptyMessage: string): T {
    if (!payload) throw new Error(emptyMessage);
    if (typeof payload === "object" && "code" in payload && payload.code !== undefined) {
        if (payload.code === "0") {
            if (!payload.data) throw new Error(emptyMessage);
            return payload.data;
        }
        if (payload.code !== 0) throw new Error(payload.msg || payload.message || payload.error?.message || "请求失败");
        if (!payload.data) throw new Error(emptyMessage);
        return payload.data;
    }
    return payload as T;
}

function videoResultUrl(payload: VideoResponse | VideoResponseData | SeedanceTask) {
    return [payload.video_url, payload.result_url, payload.url, payload.content?.video_url, payload.content?.url].find((url) => typeof url === "string" && (isPublicMediaUrl(url) || /\.mp4(\?|#|$)/i.test(url)));
}

function readAxiosError(error: unknown, fallback: string, model = "") {
    if (axios.isCancel(error)) return "请求已取消";
    if (axios.isAxiosError(error)) {
        const responseData = error.response?.data;
        return normalizeVideoErrorMessage(extractErrorMessage(responseData) || statusMessage(error.response?.status, fallback), model);
    }
    if (error instanceof DOMException && error.name === "AbortError") return "请求已取消";
    return normalizeVideoErrorMessage(error instanceof Error ? error.message : fallback, model);
}

function videoPollingProgress(provider: VideoGenerationTask["provider"], status: string | undefined, attempt: number, progress?: number): VideoGenerationProgress {
    const normalized = status || "running";
    if (provider === "cangyuan" && Number.isFinite(progress)) {
        const percent = Math.max(16, Math.min(95, Math.round(progress!)));
        if (normalized === "queued") {
            return { percent, text: `沧元视频任务排队中，当前进度 ${percent}%`, stage: "queued", providerStatus: normalized };
        }
        return { percent, text: `沧元视频任务生成中，当前进度 ${percent}%`, stage: "running", providerStatus: normalized };
    }
    if (normalized === "queued") {
        return { percent: Math.min(35, 22 + attempt * 2), text: provider === "seedance" ? "Seedance 任务排队中，正在等待调度" : "视频任务排队中", stage: "queued", providerStatus: normalized };
    }
    if (normalized === "running" || normalized === "in_progress" || normalized === "processing") {
        return { percent: Math.min(86, 42 + attempt * 3), text: provider === "seedance" ? "Seedance 任务生成中，正在按 30 秒间隔查询" : "视频任务生成中", stage: "running", providerStatus: normalized };
    }
    return { percent: Math.min(72, 30 + attempt * 3), text: "视频任务处理中，正在查询最新状态", stage: "running", providerStatus: normalized };
}

function extractErrorMessage(payload: unknown) {
    if (!payload) return "";
    if (typeof payload === "string") return payload;
    if (typeof payload !== "object") return String(payload);
    const details = collectVideoErrorDetails(payload);
    if (details.messages.length || details.codes.length) return [...details.messages.slice(0, 1), ...details.codes.slice(0, 1)].join("；");
    return `接口返回参数错误：${safeJsonPreview(payload)}`;
}

function collectVideoErrorDetails(payload: unknown, depth = 0): { messages: string[]; codes: string[] } {
    if (!payload || depth > 4) return { messages: [], codes: [] };
    if (typeof payload === "string") return { messages: [payload], codes: [] };
    if (typeof payload !== "object") return { messages: [], codes: [] };
    if (Array.isArray(payload)) return mergeVideoErrorDetails(payload.map((item) => collectVideoErrorDetails(item, depth + 1)));
    const record = payload as Record<string, unknown>;
    const nested = mergeVideoErrorDetails([collectVideoErrorDetails(record.data, depth + 1), collectVideoErrorDetails(record.error, depth + 1)]);
    const messages = [
        ...nested.messages,
        stringValue(record.fail_reason),
        stringValue(record.msg),
        stringValue(record.message),
        stringValue(record.detail),
        nonUrlMessage(record.result_url),
    ].filter(Boolean);
    const codes = [...nested.codes, stringValue(record.error_code), stringValue(record.code), stringValue(record.type)].filter(Boolean);
    return { messages: [...new Set(messages)], codes: [...new Set(codes)] };
}

function mergeVideoErrorDetails(items: Array<{ messages: string[]; codes: string[] }>) {
    return {
        messages: items.flatMap((item) => item.messages),
        codes: items.flatMap((item) => item.codes),
    };
}

function nonUrlMessage(value: unknown) {
    const message = stringValue(value);
    return message && !/^(?:https?:|data:|blob:)/i.test(message) ? message : "";
}

function stringValue(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim() : "";
}

function safeJsonPreview(value: unknown) {
    try {
        return JSON.stringify(value).slice(0, 800);
    } catch {
        return String(value);
    }
}

function normalizeVideoErrorMessage(message: string, model = "") {
    if (/real person/i.test(message) || /真人人脸|真人/.test(message)) {
        return `方舟拒绝了这次参考图：输入图片可能包含真人或真人脸部。即使图片是 AI 生成，只要画面高度写实、接近真人演员定妆照，也可能触发真人脸风控。请在“编辑参考”里换成更明显的二次元、3D 卡通或非真人虚拟角色参考图。\n\n原始错误：${message}`;
    }
    if (/input\.media|aspect_ratio|\bratio\b|parameters\.(resolution|duration|generate_audio|watermark)|resolution|duration|generate_audio|watermark/i.test(message)) {
        if (isSoraVideoModel(model)) {
            return `当前视频参数与沧元 Sora 2 接口不匹配。Sora 2 仅支持 4/8/12 秒、16:9 或 9:16，不接收 resolution；参考图最多 1 张，且不支持参考视频或参考音频。\n\n原始错误：${message}`;
        }
        if (isVeoVideoModel(model)) {
            return `当前视频参数与沧元 Veo 3.1 接口不匹配。Veo 3.1 仅支持 4/6/8 秒、16:9 或 9:16、720p/1080p；标准/fast 最多 2 张首尾帧图，ref 最多 3 张素材参考图，且不支持参考视频或参考音频。\n\n原始错误：${message}`;
        }
        return `当前模型、Endpoint 或视频参数与 Seedance 2.0 REST 接口不匹配。请确认视频模型使用官方 Seedance Model ID（例如 doubao-seedance-2-0-260128），Base URL 为 https://ark.cn-beijing.volces.com/api/v3，并使用官方支持的比例、时长和 480P/720P/1080P 分辨率。\n\n原始错误：${message}`;
    }
    return message;
}

function isRetryableVideoPollError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error || "");
    return /network error|failed to fetch|cors|timeout|查询失败（(?:404|408|425|429|5\d\d)）|请求被限流|额度不足|connection|econn/i.test(message);
}

function statusMessage(status: number | undefined, fallback: string) {
    if (status === 401 || status === 403) return "鉴权失败，请检查 API Key、套餐权限或模型权限";
    if (status === 429) return "请求被限流或额度不足，请稍后重试";
    return status ? `${fallback}（${status}）` : fallback;
}

async function assertVideoBlob(blob: Blob) {
    if (!blob.size) throw new Error("视频下载结果为空文件");
    if (blob.type.includes("json")) {
        let payload: { code?: number; msg?: string; error?: { message?: string } };
        try {
            payload = JSON.parse(await blob.text()) as { code?: number; msg?: string; error?: { message?: string } };
        } catch {
            throw new Error("视频下载接口返回了无效 JSON");
        }
        if (typeof payload.code === "number" && payload.code !== 0) throw new Error(payload.msg || "视频下载失败");
        if (payload.error?.message) throw new Error(payload.error.message);
        throw new Error(payload.msg || "视频下载接口没有返回视频文件");
    }
    if (typeof document === "undefined") return;
    const url = URL.createObjectURL(blob);
    try {
        await assertPlayableVideoSource(url);
    } finally {
        URL.revokeObjectURL(url);
    }
}

function assertPlayableVideoSource(src: string, signal?: AbortSignal) {
    if (typeof document === "undefined") return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
        const video = document.createElement("video");
        const finish = (error?: Error | DOMException) => {
            clearTimeout(timer);
            signal?.removeEventListener("abort", abort);
            video.onloadedmetadata = null;
            video.onerror = null;
            video.removeAttribute("src");
            video.load();
            error ? reject(error) : resolve();
        };
        const abort = () => finish(new DOMException("Aborted", "AbortError"));
        const timer = window.setTimeout(() => finish(new Error("读取视频信息超时")), 15_000);
        video.preload = "metadata";
        video.muted = true;
        video.onloadedmetadata = () => (video.videoWidth > 0 && video.videoHeight > 0 && video.duration > 0 ? finish() : finish(new Error("视频没有可播放内容")));
        video.onerror = () => finish(new Error("浏览器无法解码视频"));
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) return abort();
        video.src = src;
        video.load();
    });
}

function isPublicMediaUrl(value: string) {
    return /^https?:\/\//i.test(value || "");
}

function resolveCangyuanHttpsReferenceUrl(value: string, label: string) {
    if (/^https:\/\//i.test(value || "")) return value;
    throw new Error(`${label}已本地上传，但当前沧元 Seedance 只能读取公网 HTTPS URL；需要图片与视频同时参考时请先上传视频到公网，只需单条本地视频重绘时可改用 omni-v2v`);
}

async function publishCangyuanReferenceVideos(videos: ReferenceVideo[], signal?: AbortSignal) {
    const settled = await Promise.allSettled(videos.map((video) => publishReferenceVideo(video, signal)));
    const urls = settled.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
    const failed = settled.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (!failed) return urls;
    await deleteTemporaryReferenceVideos(urls.filter(isTemporaryReferenceVideoUrl));
    throw failed.reason;
}

function delay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
        }
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener(
            "abort",
            () => {
                clearTimeout(timer);
                reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
        );
    });
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("读取本地素材失败"));
        reader.readAsDataURL(blob);
    });
}

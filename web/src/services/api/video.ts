import axios from "axios";

import { dataUrlToFile } from "@/lib/image-utils";
import { getMediaBlob, uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { imageToDataUrl } from "@/services/image-storage";
import { boolConfig, buildSeedancePromptText, isSeedanceVideoConfig, normalizeSeedanceApiResolution, normalizeSeedanceDuration, normalizeSeedanceRatio, seedanceVideoReferenceError, SEEDANCE_REFERENCE_LIMITS } from "@/lib/seedance-video";
import { useCanvasAgentStore } from "@/stores/canvas/use-canvas-agent-store";
import { buildApiUrl, modelOptionName, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

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
    url?: string;
    result_url?: string;
    video_url?: string;
    content?: { video_url?: string; url?: string } | null;
    video?: { url?: string };
    raw_data?: { video_url?: string; url?: string };
    data?: VideoResponseData[] | VideoResponseData;
};
type ApiVideoResponse = VideoResponse | { code?: number | string; data?: VideoResponse | null; msg?: string; message?: string; error?: { message?: string } };
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
export type VideoGenerationTask = { id: string; provider: "openai" | "seedance" | "cangyuan"; model: string; cangyuanEndpoint?: "videos" | "video-generations" };
export type VideoGenerationProgress = { percent: number; text: string; stage: "submitting" | "submitted" | "queued" | "running" | "saving" | "failed"; providerStatus?: string };
type RequestOptions = { signal?: AbortSignal; onProgress?: (progress: VideoGenerationProgress) => void; onTaskCreated?: (task: VideoGenerationTask) => void };
export type VideoGenerationTaskState =
    | { status: "pending"; providerStatus?: string; progress?: number }
    | { status: "completed"; result: VideoGenerationResult; providerStatus?: string; progress?: number }
    | { status: "failed"; error: string; providerStatus?: string; progress?: number };

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
    options?.onProgress?.({ percent: 8, text: "正在提交视频任务", stage: "submitting" });
    const task = await createVideoGenerationTask(config, prompt, references, videoReferences, audioReferences, options);
    options?.onTaskCreated?.(task);
    return resumeVideoGenerationTask(config, task, options);
}

export async function resumeVideoGenerationTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationResult> {
    options?.onProgress?.({ percent: 16, text: task.provider === "seedance" ? `视频任务已创建，等待方舟返回任务状态：${task.id}` : `视频任务已创建，等待接口处理：${task.id}`, stage: "submitted" });
    const delayMs = task.provider === "seedance" ? 30000 : task.provider === "cangyuan" ? 5000 : 2500;
    for (let attempt = 0; attempt < 120; attempt += 1) {
        if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const state = await pollVideoGenerationTask(config, task, options);
        if (state.status === "completed") {
            options?.onProgress?.({ percent: 96, text: "视频已生成，正在保存到画布", stage: "saving", providerStatus: state.providerStatus });
            return state.result;
        }
        if (state.status === "failed") {
            options?.onProgress?.({ percent: 100, text: state.error, stage: "failed", providerStatus: state.providerStatus });
            throw new Error(state.error);
        }
        options?.onProgress?.(videoPollingProgress(task.provider, state.providerStatus, attempt, state.progress));
        if (attempt === 119) throw new Error(`${task.provider === "seedance" ? "Seedance " : ""}视频生成超时，请稍后重试`);
        await delay(delayMs, options?.signal);
    }
    throw new Error("视频生成超时，请稍后重试");
}

export async function createVideoGenerationTask(config: AiConfig, prompt: string, references: ReferenceImage[] = [], videoReferences: ReferenceVideo[] = [], audioReferences: ReferenceAudio[] = [], options?: RequestOptions): Promise<VideoGenerationTask> {
    const selectedModel = (config.model || config.videoModel).trim();
    const requestConfig = resolveModelRequestConfig(config, selectedModel);
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

async function createOpenAIVideoTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], options?: RequestOptions): Promise<VideoGenerationTask> {
    const body = new FormData();
    body.append("model", modelOptionName(model));
    body.append("prompt", prompt);
    body.append("seconds", normalizeVideoSeconds(config.videoSeconds));
    if (normalizeVideoSize(config.size)) body.append("size", normalizeVideoSize(config.size)!);
    body.append("resolution_name", normalizeVideoResolution(config.vquality));
    body.append("preset", "normal");
    const files = await Promise.all(references.slice(0, 7).map(async (image) => dataUrlToFile({ ...image, dataUrl: await imageToDataUrl(image) })));
    files.forEach((file) => body.append("input_reference[]", file));
    try {
        const created = unwrapVideoResponse((await axios.post<ApiVideoResponse>(aiApiUrl(config, "/videos"), body, { headers: aiHeaders(config), signal: options?.signal })).data);
        if (!created.id) throw new Error("视频接口没有返回任务 ID");
        return { id: created.id, provider: "openai", model };
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
    if ((videoReferences.length || audioReferences.length) && !references.length) {
        throw new Error("沧元算力视频参考视频/音频必须同时提供至少 1 张主参考图");
    }
    assertSeedanceVideoReferences(videoReferences);
    assertSeedanceAudioReferences(audioReferences);
    const imageUrls = await Promise.all(references.slice(0, 4).map((image) => resolveSeedanceImageUrl(config, image)));
    const referenceVideos = await Promise.all(videoReferences.slice(0, SEEDANCE_REFERENCE_LIMITS.videos).map(resolveSeedanceVideoUrl));
    const referenceAudios = await Promise.all(audioReferences.slice(0, 1).map(resolveSeedanceAudioUrl));
    const primaryImageUrl = imageUrls[0] || "";
    const extraImageUrls = imageUrls.slice(1);
    const payload = {
        model: modelOptionName(model),
        prompt: buildSeedancePromptText(prompt, references, videoReferences, audioReferences),
        aspect_ratio: normalizeCangyuanVideoRatio(config.size),
        duration: normalizeCangyuanVideoDuration(config.videoSeconds),
        resolution: normalizeCangyuanSeedanceResolution(config.vquality),
        audio: boolConfig(config.videoGenerateAudio, true),
        ...(primaryImageUrl ? { image_url: primaryImageUrl } : {}),
        ...(extraImageUrls.length ? { reference_image_urls: extraImageUrls } : {}),
        ...(referenceVideos.length ? { reference_videos: referenceVideos } : {}),
        ...(referenceAudios.length ? { reference_audios: referenceAudios } : {}),
    };
    try {
        const created = unwrapVideoResponse((await axios.post<ApiVideoResponse>(aiApiUrl(config, "/videos"), payload, { headers: aiHeaders(config, "application/json"), signal: options?.signal })).data);
        const taskId = cangyuanVideoTaskId(created);
        if (!taskId) throw new Error("视频接口没有返回任务 ID");
        return { id: taskId, provider: "cangyuan", model, cangyuanEndpoint: "videos" };
    } catch (error) {
        throw new Error(readAxiosError(error, "视频任务创建失败"));
    }
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
        const created = unwrapVideoResponse((await axios.post<ApiVideoResponse>(aiApiUrl(config, "/video/generations"), payload, { headers: aiHeaders(config, "application/json"), signal: options?.signal })).data);
        const taskId = cangyuanVideoTaskId(created);
        if (!taskId) throw new Error("Grok 视频接口没有返回任务 ID");
        return { id: taskId, provider: "cangyuan", model, cangyuanEndpoint: "video-generations" };
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
            if (url) return { status: "completed", result: await videoResultFromUrl(url, options), providerStatus, progress };
            if (task.cangyuanEndpoint === "video-generations") return { status: "failed", error: "Grok 视频任务完成但没有返回视频 URL", providerStatus, progress };
            const content = await axios.get<Blob>(aiApiUrl(config, `/videos/${task.id}/content`), { headers: aiHeaders(config), responseType: "blob", signal: options?.signal });
            await assertVideoBlob(content.data);
            return { status: "completed", result: { blob: content.data }, providerStatus, progress };
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
        const created = unwrapSeedanceTask((await axios.post<ApiEnvelope<SeedanceTask>>(seedanceApiUrl(config), payload, { headers: aiHeaders(config, "application/json"), signal: options?.signal })).data);
        if (!created.id) throw new Error("Seedance 接口没有返回任务 ID");
        return { id: created.id, provider: "seedance", model };
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

function assertSeedanceVideoReferences(videoReferences: ReferenceVideo[]) {
    const error = seedanceVideoReferenceError(videoReferences);
    if (error) throw new Error(error);
    let total = 0;
    for (const video of videoReferences) {
        if (!video.durationMs) continue;
        if (video.durationMs < 2000 || video.durationMs > 15000) throw new Error("Seedance 参考视频单个时长需要在 2-15 秒之间");
        total += video.durationMs;
    }
    if (total > 15000) throw new Error("Seedance 参考视频总时长不能超过 15 秒");
}

function assertSeedanceAudioReferences(audioReferences: ReferenceAudio[]) {
    let total = 0;
    for (const audio of audioReferences) {
        if (!audio.durationMs) continue;
        if (audio.durationMs < 2000 || audio.durationMs > 15000) throw new Error("Seedance 参考音频单个时长需要在 2-15 秒之间");
        total += audio.durationMs;
    }
    if (total > 15000) throw new Error("Seedance 参考音频总时长不能超过 15 秒");
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
    try {
        const response = await axios.get<Blob>(url, { responseType: "blob", signal: options?.signal });
        await assertVideoBlob(response.data);
        return { blob: response.data };
    } catch (error) {
        if (axios.isCancel(error) || options?.signal?.aborted) throw error;
        const blob = await downloadVideoViaAgent(url, options).catch(() => null);
        if (blob) return { blob };
        return { url, mimeType: "video/mp4" };
    }
}

async function downloadVideoViaAgent(url: string, options?: RequestOptions) {
    const agent = useCanvasAgentStore.getState();
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

function normalizeCangyuanSeedanceResolution(value: string) {
    return normalizeVideoResolution(value).toLowerCase() === "480p" ? "480p" : "720p";
}

function isCangyuanGrokVideoModel(model: string) {
    return modelOptionName(model).toLowerCase().startsWith("grok-video");
}

function isCangyuanSeedanceVideoRequest(config: AiConfig, model: string) {
    const baseUrl = config.baseUrl.toLowerCase();
    const modelName = modelOptionName(model).toLowerCase();
    return baseUrl.includes("ai.cangyuansuanli.cn") && modelName.startsWith("seedance-2.0");
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
    if (video.id) return video.id;
    if (video.task_id) return video.task_id;
    if (!Array.isArray(video.data)) return video.data?.id || video.data?.task_id || "";
    return video.data.find((item) => item.id || item.task_id)?.id || video.data.find((item) => item.id || item.task_id)?.task_id || "";
}

function cangyuanVideoStatus(video: VideoResponse) {
    const nestedStatus = !Array.isArray(video.data) ? stringValue(video.data?.status) || stringValue(video.data?.state) : "";
    return (video.status || video.state || nestedStatus).toLowerCase();
}

function isCangyuanVideoCompleted(status: string) {
    return ["completed", "complete", "success", "succeeded", "done"].includes(status);
}

function isCangyuanVideoFailed(status: string) {
    return ["failed", "fail", "error", "cancelled", "canceled", "expired", "timeout"].includes(status);
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
    const message = stringValue(video.error?.message) || stringValue(video.message);
    const code = stringValue(video.error_code) || stringValue(video.error?.code);
    return [message || "视频生成失败", code].filter(Boolean).join("：");
}

function normalizeProgress(value: unknown) {
    const numberValue = typeof value === "number" ? value : typeof value === "string" ? Number.parseFloat(value.replace("%", "")) : NaN;
    return Number.isFinite(numberValue) ? Math.max(0, Math.min(100, numberValue)) : undefined;
}

function unwrapVideoResponse(payload: ApiVideoResponse) {
    return unwrapEnvelope(payload, "接口没有返回视频任务");
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

function readAxiosError(error: unknown, fallback: string) {
    if (axios.isCancel(error)) return "请求已取消";
    if (axios.isAxiosError(error)) {
        const responseData = error.response?.data;
        return normalizeVideoErrorMessage(extractErrorMessage(responseData) || statusMessage(error.response?.status, fallback));
    }
    if (error instanceof DOMException && error.name === "AbortError") return "请求已取消";
    return normalizeVideoErrorMessage(error instanceof Error ? error.message : fallback);
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
    const record = payload as Record<string, unknown>;
    const directMessage = stringValue(record.msg) || stringValue(record.message) || stringValue(record.detail);
    if (directMessage) return directMessage;
    const errorValue = record.error;
    if (typeof errorValue === "string") return errorValue;
    if (errorValue && typeof errorValue === "object") {
        const errorRecord = errorValue as Record<string, unknown>;
        const parts = [stringValue(errorRecord.message), stringValue(errorRecord.code), stringValue(errorRecord.param), stringValue(errorRecord.type)].filter(Boolean);
        if (parts.length) return parts.join("；");
    }
    return `接口返回参数错误：${safeJsonPreview(payload)}`;
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

function normalizeVideoErrorMessage(message: string) {
    if (/real person/i.test(message) || /真人人脸|真人/.test(message)) {
        return `方舟拒绝了这次参考图：输入图片可能包含真人或真人脸部。即使图片是 AI 生成，只要画面高度写实、接近真人演员定妆照，也可能触发真人脸风控。请在“编辑参考”里换成更明显的二次元、3D 卡通或非真人虚拟角色参考图。\n\n原始错误：${message}`;
    }
    if (/input\.media|aspect_ratio|\bratio\b|parameters\.(resolution|duration|generate_audio|watermark)|resolution|duration|generate_audio|watermark/i.test(message)) {
        return `当前模型、Endpoint 或视频参数与 Seedance 2.0 REST 接口不匹配。请确认视频模型使用官方 Seedance Model ID（例如 doubao-seedance-2-0-260128），Base URL 为 https://ark.cn-beijing.volces.com/api/v3，并使用官方支持的比例、时长和 480P/720P/1080P 分辨率。\n\n原始错误：${message}`;
    }
    return message;
}

function statusMessage(status: number | undefined, fallback: string) {
    if (status === 401 || status === 403) return "鉴权失败，请检查 API Key、套餐权限或模型权限";
    if (status === 429) return "请求被限流或额度不足，请稍后重试";
    return status ? `${fallback}（${status}）` : fallback;
}

async function assertVideoBlob(blob: Blob) {
    if (!blob.type.includes("json")) return;
    let payload: { code?: number; msg?: string; error?: { message?: string } };
    try {
        payload = JSON.parse(await blob.text()) as { code?: number; msg?: string; error?: { message?: string } };
    } catch {
        return;
    }
    if (typeof payload.code === "number" && payload.code !== 0) throw new Error(payload.msg || "视频下载失败");
    if (payload.error?.message) throw new Error(payload.error.message);
}

function isPublicMediaUrl(value: string) {
    return /^https?:\/\//i.test(value || "");
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

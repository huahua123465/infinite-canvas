import axios from "axios";
import localforage from "localforage";

import { audioMimeType, normalizeAudioFormatValue, normalizeAudioSpeedValue, normalizeAudioVoiceValue, normalizeVolcengineSpeakerValue, suggestVolcengineSpeakerForText } from "@/lib/audio-generation";
import { resolveAudioProvider } from "@/lib/audio-provider";
import { getMediaBlob, resolveMediaUrl, uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { runModelScript } from "@/services/api/model-script-runtime";
import { buildApiUrl, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import { resolveModelScript } from "@/stores/use-model-script-store";
import type { ReferenceAudio } from "@/types/media";

type VoiceboxGenerationSource = { voiceboxGenerationId: string; voiceboxProfileId: string; voiceboxProfileName: string; voiceboxEngine?: string };
type RequestOptions = { signal?: AbortSignal; referenceAudios?: ReferenceAudio[]; promptText?: string; seed?: number; candidateCount?: number; onVoiceboxGeneration?: (source: VoiceboxGenerationSource) => void };
export type StoredAudioFile = UploadedFile & Partial<VoiceboxGenerationSource> & { cacheKey: string; cacheHit?: "local" | "shared" };
export type VoiceboxProfile = { id: string; name: string; description?: string | null; language: string; voice_type?: "cloned" | "preset" | "designed"; preset_engine?: string | null; preset_voice_id?: string | null; default_engine?: string | null; sample_count?: number };
type AudioCacheRecord = { storageKey: string; bytes: number; mimeType: string; durationMs?: number; createdAt: number };
type SharedAudioCacheEntry = { key: string; url: string; bytes?: number; mimeType?: string; durationMs?: number };
export type VolcengineVoiceCloneStatus = 0 | 1 | 2 | 3 | 4;
export type VolcengineVoiceCloneModelStatus = { model_type?: number; demo_audio?: string };
export type VolcengineVoiceCloneRecord = {
    id: string;
    name: string;
    speakerId: string;
    customSpeakerId?: string;
    status?: VolcengineVoiceCloneStatus;
    language?: number;
    sampleText?: string;
    demoText?: string;
    demoAudioUrl?: string;
    demoAudioStorageKey?: string;
    sourceAudioStorageKey?: string;
    createdAt: number;
    updatedAt: number;
    speakerStatus?: VolcengineVoiceCloneModelStatus[];
};
export type VolcengineVoiceCloneInput = {
    file: File;
    name?: string;
    speakerId?: string;
    customSpeakerId?: string;
    text?: string;
    demoText?: string;
    language?: number;
    enableAudioDenoise?: boolean;
};
type VolcengineVoiceCloneResponse = {
    code?: number;
    message?: string;
    available_training_times?: number;
    create_time?: number;
    language?: number;
    speaker_id?: string;
    status?: VolcengineVoiceCloneStatus;
    speaker_status?: VolcengineVoiceCloneModelStatus[];
};
type VoiceboxGeneration = { id: string; status?: string; error?: string | null; duration?: number | null; engine?: string | null };
type VoiceboxGenerationSettings = { max_chunk_chars?: number; crossfade_ms?: number; normalize_audio?: boolean };

const audioCacheStore = localforage.createInstance({ name: "infinite-canvas", storeName: "audio_generation_cache" });
const voiceCloneStore = localforage.createInstance({ name: "infinite-canvas", storeName: "volcengine_voice_clones" });
const sharedPreviewManifestUrl = "/audio/voice-previews/manifest.json";
let sharedPreviewManifest: Promise<Map<string, SharedAudioCacheEntry>> | null = null;

function aiApiUrl(config: AiConfig, path: string) {
    return buildApiUrl(config.baseUrl, path);
}

function aiHeaders(config: AiConfig) {
    return {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
    };
}

export async function requestAudioGeneration(config: AiConfig, prompt: string, options?: RequestOptions): Promise<Blob> {
    const selectedModel = config.model || config.audioModel;
    let requestConfig = resolveModelRequestConfig(config, selectedModel);
    let model = requestConfig.model.trim();
    const script = await resolveModelScript("audio", selectedModel);
    if (script) {
        if (!model) throw new Error("请先配置音频模型");
        if (!requestConfig.baseUrl.trim()) throw new Error("请先配置 Base URL");
        if (!requestConfig.apiKey.trim()) throw new Error("请先配置 API Key");
        const format = normalizeAudioFormatValue(config.audioFormat);
        const referenceAudios = await Promise.all((options?.referenceAudios || []).map((audio) => referenceAudioDataUrl(audio, options?.signal)));
        try {
            const result = await runModelScript({
                capability: "audio",
                script,
                config: requestConfig,
                prompt,
                params: {
                    voice: normalizeAudioVoiceValue(config.audioVoice),
                    format,
                    speed: normalizeAudioSpeedValue(config.audioSpeed),
                    instructions: config.audioInstructions.trim(),
                    referenceAudios,
                    promptText: options?.promptText?.trim() || "",
                    seed: options?.seed,
                    candidateCount: options?.candidateCount,
                },
                signal: options?.signal,
            });
            const audio = await normalizeModelScriptAudio(result, format, options?.signal);
            await assertAudioBlob(audio);
            return audio;
        } catch (error) {
            throw new Error(await readAxiosError(error, "音频生成失败"));
        }
    }
    const selectedProvider = resolveAudioProvider(requestConfig, model);
    if (selectedProvider.kind !== "voxcpm" && selectedProvider.kind !== "voicebox" && normalizeVolcengineSpeakerValue(config.audioVoice) && !isVolcengineSpeechConfig(requestConfig, model)) {
        const volcengineModel = findVolcengineAudioModel(config);
        if (volcengineModel) {
            requestConfig = resolveModelRequestConfig(config, volcengineModel);
            model = requestConfig.model.trim();
        }
    }
    assertAudioConfig(requestConfig, model);
    if (isVolcengineSpeechConfig(requestConfig, model)) return requestVolcengineSpeech(requestConfig, model, prompt, options);
    if (resolveAudioProvider(requestConfig, model).kind === "voxcpm") return requestVoxCPMSpeech(requestConfig, model, prompt, options);
    if (resolveAudioProvider(requestConfig, model).kind === "voicebox") return requestVoiceboxSpeech(requestConfig, prompt, options);
    const format = normalizeAudioFormatValue(config.audioFormat);
    const instructions = config.audioInstructions.trim();

    try {
        const response = await axios.post<Blob>(
            aiApiUrl(requestConfig, "/audio/speech"),
            {
                model,
                input: prompt,
                voice: normalizeAudioVoiceValue(config.audioVoice),
                response_format: format,
                speed: Number(normalizeAudioSpeedValue(config.audioSpeed)),
                ...(instructions ? { instructions } : {}),
            },
            { headers: aiHeaders(requestConfig), responseType: "blob", signal: options?.signal },
        );
        await assertAudioBlob(response.data);
        return response.data.type.startsWith("audio/") ? response.data : new Blob([response.data], { type: audioMimeType(format) });
    } catch (error) {
        throw new Error(await readAxiosError(error, "音频生成失败"));
    }
}

export async function listVoiceboxProfiles(config: AiConfig, signal?: AbortSignal) {
    const selectedModel = resolveAudioProvider(config, config.model).kind === "voicebox" ? config.model : config.audioModel || config.model;
    const requestConfig = resolveModelRequestConfig(config, selectedModel);
    const profiles = await requestVoicebox<VoiceboxProfile[]>(requestConfig, "/profiles", { signal });
    return Array.isArray(profiles) ? profiles : [];
}

async function requestVoiceboxSpeech(config: AiConfig, text: string, options?: RequestOptions): Promise<Blob> {
    const profileId = config.audioVoice.trim();
    if (!profileId) throw new Error("请先选择 Voicebox 声音档案");
    if (options?.referenceAudios?.length) throw new Error("Voicebox 不接受单次请求参考音频，请先在 Voicebox 页面把样本加入声音档案");
    let generationId = "";
    try {
        const [profile, settings] = await Promise.all([
            requestVoicebox<VoiceboxProfile>(config, `/profiles/${encodeURIComponent(profileId)}`, { signal: options?.signal }),
            requestVoicebox<VoiceboxGenerationSettings>(config, "/settings/generation", { signal: options?.signal }),
        ]);
        const engine = profile.preset_engine || profile.default_engine || null;
        const generation = await requestVoicebox<VoiceboxGeneration>(config, "/generate", {
            method: "POST",
            payload: {
                profile_id: profile.id,
                text,
                language: voiceboxLanguage(text),
                seed: options?.seed,
                engine,
                model_size: "1.7B",
                instruct: config.audioInstructions.trim().slice(0, 500) || null,
                max_chunk_chars: settings.max_chunk_chars ?? 800,
                crossfade_ms: settings.crossfade_ms ?? 50,
                normalize: settings.normalize_audio ?? true,
            },
            signal: options?.signal,
        });
        generationId = generation.id;
        if (!generationId) throw new Error("Voicebox 没有返回生成任务 ID");
        options?.onVoiceboxGeneration?.({ voiceboxGenerationId: generationId, voiceboxProfileId: profile.id, voiceboxProfileName: profile.name, voiceboxEngine: generation.engine || engine || undefined });
        let status = generation.status || "generating";
        while (!["completed", "failed"].includes(status)) {
            await abortableDelay(1000, options?.signal);
            const current = await requestVoicebox<VoiceboxGeneration>(config, `/history/${encodeURIComponent(generationId)}`, { signal: options?.signal });
            status = current.status || "generating";
            if (status === "failed") throw new Error(current.error || "Voicebox 音频生成失败");
        }
        if (status === "failed") throw new Error(generation.error || "Voicebox 音频生成失败");
        const audio = await requestVoicebox<Blob>(config, `/audio/${encodeURIComponent(generationId)}`, { responseType: "blob", signal: options?.signal });
        await assertAudioBlob(audio);
        return audio.type.startsWith("audio/") ? audio : new Blob([audio], { type: "audio/wav" });
    } catch (error) {
        if (options?.signal?.aborted) {
            if (generationId) void requestVoicebox(config, `/generate/${encodeURIComponent(generationId)}/cancel`, { method: "POST" }).catch(() => undefined);
            throw new Error("请求已取消");
        }
        throw new Error(await readAxiosError(error, "Voicebox 音频生成失败"));
    }
}

async function requestVoxCPMSpeech(config: AiConfig, model: string, text: string, options?: RequestOptions): Promise<Blob> {
    const reference = options?.referenceAudios?.[0];
    const targetPitchHz = reference ? null : voxCpmTargetPitchHz(config.audioInstructions);
    try {
        const response = await axios.post<Blob>(
            aiApiUrl(config, "/audio/speech"),
            {
                model,
                input: text,
                voice: "default",
                response_format: "wav",
                speed: Number(normalizeAudioSpeedValue(config.audioSpeed)),
                ...(config.audioInstructions.trim() ? { instructions: config.audioInstructions.trim() } : {}),
                ...(reference ? { reference_audio: await referenceAudioDataUrl(reference, options?.signal) } : {}),
                ...(reference && options?.promptText?.trim() ? { prompt_text: options.promptText.trim() } : {}),
                ...(options?.seed ? { seed: options.seed } : {}),
                ...(targetPitchHz ? { candidate_count: options?.candidateCount || 3, target_pitch_hz: targetPitchHz } : {}),
            },
            { headers: aiHeaders(config), responseType: "blob", signal: options?.signal },
        );
        await assertAudioBlob(response.data);
        return response.data.type.startsWith("audio/") ? response.data : new Blob([response.data], { type: "audio/wav" });
    } catch (error) {
        throw new Error(await readAxiosError(error, "VoxCPM 音频生成失败"));
    }
}

async function referenceAudioDataUrl(reference: ReferenceAudio, signal?: AbortSignal) {
    let blob = reference.storageKey ? await getMediaBlob(reference.storageKey) : null;
    if (!blob && reference.url?.startsWith("data:audio/")) return reference.url;
    if (!blob && reference.url) {
        const response = await fetch(reference.url, { signal });
        if (response.ok) blob = await response.blob();
    }
    if (!blob) throw new Error("VoxCPM 参考音频不可用");
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(reader.error || new Error("读取 VoxCPM 参考音频失败"));
        reader.readAsDataURL(blob);
    });
}

type VoiceboxRequestOptions = { method?: "GET" | "POST"; payload?: object; responseType?: "json" | "blob"; signal?: AbortSignal };

async function requestVoicebox<T>(config: AiConfig, path: string, options: VoiceboxRequestOptions = {}): Promise<T> {
    const method = options.method || "GET";
    const agentUrl = voiceboxAgentProxyUrl();
    if (agentUrl) {
        try {
            const response = await axios.post<T>(agentUrl, { baseUrl: config.baseUrl, path, method, payload: options.payload }, { responseType: options.responseType, signal: options.signal });
            return response.data;
        } catch (error) {
            if (options.signal?.aborted || !axios.isAxiosError(error) || error.response) throw error;
        }
    }
    const url = voiceboxDevProxyUrl(config.baseUrl, path) || voiceboxApiUrl(config.baseUrl, path);
    const response = await axios.request<T>({ url, method, data: options.payload, responseType: options.responseType, signal: options.signal });
    return response.data;
}

function voiceboxApiUrl(baseUrl: string, path: string) {
    const base = baseUrl.trim().replace(/\/+$/, "").replace(/\/v1$/i, "");
    return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

function voiceboxAgentProxyUrl() {
    if (typeof window === "undefined") return "";
    try {
        const endpoint = (localStorage.getItem("canvas-agent-url") || "").trim().replace(/\/+$/, "");
        const token = (localStorage.getItem("canvas-agent-token") || "").trim();
        return endpoint && token ? `${endpoint}/api/proxy/voicebox?token=${encodeURIComponent(token)}` : "";
    } catch {
        return "";
    }
}

function voiceboxDevProxyUrl(baseUrl: string, path: string) {
    if (typeof window === "undefined" || !import.meta.env.DEV) return "";
    try {
        const target = new URL(baseUrl);
        if (target.port !== "17493" || !["localhost", "127.0.0.1", "::1"].includes(target.hostname)) return "";
        if (!["localhost", "127.0.0.1", "::1"].includes(window.location.hostname)) return "";
        return `/api/proxy/voicebox${path.startsWith("/") ? path : `/${path}`}`;
    } catch {
        return "";
    }
}

function voiceboxLanguage(text: string) {
    if (/[\u3040-\u30ff]/.test(text)) return "ja";
    if (/[\uac00-\ud7af]/.test(text)) return "ko";
    if (/[\u4e00-\u9fff]/.test(text)) return "zh";
    return "en";
}

function abortableDelay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
        const timer = window.setTimeout(resolve, ms);
        signal?.addEventListener("abort", () => {
            window.clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
        }, { once: true });
    });
}

async function requestVolcengineSpeech(config: AiConfig, resourceId: string, text: string, options?: RequestOptions): Promise<Blob> {
    const format = normalizeVolcengineAudioFormat(config.audioFormat);
    const speaker = normalizeVolcengineSpeakerValue(config.audioVoice) || suggestVolcengineSpeakerForText(`${config.audioInstructions}\n${text}`).value;
    const normalizedResourceId = normalizeVolcengineResourceId(resourceId, speaker);
    const requests = volcengineSpeechRequests(config.baseUrl);
    const payload = {
        user: { uid: "infinite-canvas" },
        event: 100,
        req_params: {
            text,
            speaker,
            audio_params: {
                format,
                sample_rate: 24000,
                bit_rate: 128000,
                speech_rate: volcengineSpeechRate(config.audioSpeed),
            },
            additions: JSON.stringify({ disable_markdown_filter: true }),
        },
    };
    let lastError: unknown;
    for (const request of requests) {
        try {
            const response = await axios.post<Blob>(
                request.url,
                request.viaAgent ? { baseUrl: config.baseUrl, apiKey: config.apiKey, resourceId: normalizedResourceId, payload } : payload,
                {
                    headers: request.viaAgent ? { "Content-Type": "application/json" } : volcengineSpeechHeaders(config.apiKey, normalizedResourceId),
                    responseType: "blob",
                    signal: options?.signal,
                },
            );
            const audio = await normalizeVolcengineAudioBlob(response.data, format);
            await assertAudioBlob(audio);
            return audio;
        } catch (error) {
            lastError = withVolcengineSpeechContext(error, normalizedResourceId, speaker);
            if (!shouldTryNextVolcengineRequest(error, request)) break;
        }
    }
    throw new Error(await readAxiosError(lastError, requests[0]?.viaAgent ? "火山语音合成本地代理失败" : "火山语音合成失败"));
}

function withVolcengineSpeechContext(error: unknown, resourceId: string, speaker: string) {
    if (!(error instanceof Error) || !/resource ID is mismatched with speaker related resource/i.test(error.message)) return error;
    return new Error(`${error.message}。当前音频模型资源是 ${resourceId}，但 speaker 是 ${speaker}，两者不属于同一套火山语音资源；请使用当前服务详情音色列表里的 Voice_type，或切换到该 speaker 对应的资源模型。`);
}

export async function listVolcengineVoiceClones(): Promise<VolcengineVoiceCloneRecord[]> {
    const items: VolcengineVoiceCloneRecord[] = [];
    await voiceCloneStore.iterate<VolcengineVoiceCloneRecord, void>((value) => {
        if (value?.speakerId) items.push(value);
    });
    const hydrated = await Promise.all(
        items.map(async (item) => ({
            ...item,
            demoAudioUrl: item.demoAudioStorageKey ? await resolveMediaUrl(item.demoAudioStorageKey, item.demoAudioUrl) : item.demoAudioUrl,
        })),
    );
    return hydrated.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function requestVolcengineVoiceClone(config: AiConfig, input: VolcengineVoiceCloneInput, options?: RequestOptions): Promise<VolcengineVoiceCloneRecord> {
    const requestConfig = resolveVolcengineAudioRequestConfig(config);
    assertAudioConfig(requestConfig, requestConfig.model || "seed-icl-2.0");
    const customSpeakerId = normalizeCustomSpeakerId(input.customSpeakerId || `custom_zh_${Date.now().toString(36)}`);
    const audio = await fileToBase64Audio(input.file);
    const payload = {
        speaker_id: input.speakerId?.trim() || "custom_speaker_id",
        custom_speaker_id: input.speakerId?.trim() ? undefined : customSpeakerId,
        audio,
        ...(input.text?.trim() ? { text: input.text.trim() } : {}),
        language: input.language ?? 0,
        extra_params: {
            voice_clone_denoise_model_id: "",
            ...(input.demoText?.trim() ? { demo_text: input.demoText.trim() } : {}),
            ...(typeof input.enableAudioDenoise === "boolean" ? { enable_audio_denoise: input.enableAudioDenoise } : {}),
        },
    };
    const response = await requestVolcengineJson<VolcengineVoiceCloneResponse>(requestConfig, "/api/v3/tts/voice_clone", payload, options);
    const speakerId = response.speaker_id || input.speakerId?.trim() || customSpeakerId;
    const sourceAudio = await uploadMediaFile(input.file, "voice-clone-source");
    const record = await storeVolcengineVoiceClone({
        id: speakerId,
        name: input.name?.trim() || input.file.name.replace(/\.[^.]+$/, "") || speakerId,
        speakerId,
        customSpeakerId: input.speakerId?.trim() ? undefined : customSpeakerId,
        status: response.status,
        language: response.language ?? input.language ?? 0,
        sampleText: input.text?.trim(),
        demoText: input.demoText?.trim(),
        sourceAudioStorageKey: sourceAudio.storageKey,
        speakerStatus: response.speaker_status,
        createdAt: response.create_time || Date.now(),
        updatedAt: Date.now(),
    });
    return saveVoiceCloneDemoAudio(record, options);
}

export async function requestVolcengineVoiceCloneStatus(config: AiConfig, record: VolcengineVoiceCloneRecord, options?: RequestOptions): Promise<VolcengineVoiceCloneRecord> {
    const requestConfig = resolveVolcengineAudioRequestConfig(config);
    assertAudioConfig(requestConfig, requestConfig.model || "seed-icl-2.0");
    const payload = record.customSpeakerId ? { speaker_id: "custom_speaker_id", custom_speaker_id: record.customSpeakerId } : { speaker_id: record.speakerId };
    const response = await requestVolcengineJson<VolcengineVoiceCloneResponse>(requestConfig, "/api/v3/tts/get_voice", payload, options);
    const next = await storeVolcengineVoiceClone({
        ...record,
        speakerId: response.speaker_id || record.speakerId,
        status: response.status,
        language: response.language ?? record.language,
        speakerStatus: response.speaker_status,
        updatedAt: Date.now(),
    });
    return saveVoiceCloneDemoAudio(next, options);
}

async function storeVolcengineVoiceClone(record: VolcengineVoiceCloneRecord) {
    await voiceCloneStore.setItem(record.id, record);
    return record;
}

async function saveVoiceCloneDemoAudio(record: VolcengineVoiceCloneRecord, options?: RequestOptions) {
    const demoAudio = record.speakerStatus?.find((item) => item.demo_audio)?.demo_audio;
    if (!demoAudio || record.demoAudioStorageKey) return record;
    try {
        const proxyUrl = mediaDownloadAgentProxyUrl();
        if (!proxyUrl) throw new Error("missing local media proxy");
        const response = await axios.post<Blob>(
            proxyUrl,
            { url: demoAudio },
            { headers: { "Content-Type": "application/json" }, responseType: "blob", signal: options?.signal },
        );
        const audio = await storeGeneratedAudio(response.data, "mp3");
        return storeVolcengineVoiceClone({ ...record, demoAudioUrl: audio.url, demoAudioStorageKey: audio.storageKey, updatedAt: Date.now() });
    } catch {
        return storeVolcengineVoiceClone({ ...record, demoAudioUrl: demoAudio, updatedAt: Date.now() });
    }
}

export async function storeGeneratedAudio(blob: Blob, format = "mp3"): Promise<UploadedFile> {
    const audio = blob.type.startsWith("audio/") ? blob : new Blob([blob], { type: audioMimeType(format) });
    return uploadMediaFile(audio, "audio");
}

export async function requestStoredAudioGeneration(config: AiConfig, prompt: string, options?: RequestOptions): Promise<StoredAudioFile> {
    const selectedModel = config.model || config.audioModel;
    const script = await resolveModelScript("audio", selectedModel);
    const cacheKey = await audioGenerationCacheKey(config, prompt, options, script);
    const provider = resolveAudioProvider(config, config.model || config.audioModel);
    const alwaysGenerate = provider.kind === "voicebox";
    if (!alwaysGenerate) {
        const cached = await readLocalAudioCache(cacheKey);
        if (cached) return { ...cached, cacheKey, cacheHit: "local" };
    }
    const format = provider.kind === "voxcpm" || provider.kind === "voicebox" ? "wav" : config.audioFormat;
    const shared = alwaysGenerate || script || options?.referenceAudios?.length ? null : await readSharedAudioCache(cacheKey, format);
    if (shared) return { ...shared, cacheKey, cacheHit: "shared" };
    let voiceboxSource: VoiceboxGenerationSource | undefined;
    const audio = await storeGeneratedAudio(await requestAudioGeneration(config, prompt, { ...options, onVoiceboxGeneration: (source) => { voiceboxSource = source; options?.onVoiceboxGeneration?.(source); } }), format);
    if (!alwaysGenerate) await writeLocalAudioCache(cacheKey, audio);
    return { ...audio, cacheKey, ...(voiceboxSource || {}) };
}

async function readLocalAudioCache(cacheKey: string): Promise<UploadedFile | null> {
    const record = await audioCacheStore.getItem<AudioCacheRecord>(cacheKey);
    if (!record?.storageKey) return null;
    const blob = await getMediaBlob(record.storageKey);
    if (!blob) {
        await audioCacheStore.removeItem(cacheKey);
        return null;
    }
    const url = await resolveMediaUrl(record.storageKey, "");
    return { url, storageKey: record.storageKey, bytes: record.bytes || blob.size, mimeType: record.mimeType || blob.type || "audio/mpeg", durationMs: record.durationMs };
}

async function readSharedAudioCache(cacheKey: string, format: string): Promise<UploadedFile | null> {
    const manifest = await loadSharedAudioCacheManifest();
    const entry = manifest.get(cacheKey);
    if (!entry?.url) return null;
    const response = await fetch(entry.url);
    if (!response.ok) return null;
    const type = entry.mimeType || response.headers.get("Content-Type") || audioMimeType(format);
    const blob = new Blob([await response.arrayBuffer()], { type });
    const audio = await storeGeneratedAudio(blob, format);
    await writeLocalAudioCache(cacheKey, audio);
    return { ...audio, bytes: entry.bytes || audio.bytes, mimeType: entry.mimeType || audio.mimeType, durationMs: entry.durationMs || audio.durationMs };
}

async function writeLocalAudioCache(cacheKey: string, audio: UploadedFile) {
    await audioCacheStore.setItem<AudioCacheRecord>(cacheKey, {
        storageKey: audio.storageKey,
        bytes: audio.bytes,
        mimeType: audio.mimeType,
        durationMs: audio.durationMs,
        createdAt: Date.now(),
    });
}

async function loadSharedAudioCacheManifest() {
    if (!sharedPreviewManifest) {
        sharedPreviewManifest = fetch(sharedPreviewManifestUrl)
            .then((response) => (response.ok ? response.json() : []))
            .then((items: SharedAudioCacheEntry[]) => new Map((Array.isArray(items) ? items : []).filter((item) => item.key && item.url).map((item) => [item.key, { ...item, url: normalizeSharedAudioUrl(item.url) }])))
            .catch(() => new Map<string, SharedAudioCacheEntry>());
    }
    return sharedPreviewManifest;
}

function normalizeSharedAudioUrl(url: string) {
    if (/^https?:\/\//i.test(url) || url.startsWith("/")) return url;
    return `/audio/voice-previews/${url.replace(/^\/+/, "")}`;
}

async function audioGenerationCacheKey(config: AiConfig, prompt: string, options?: RequestOptions, script = "") {
    let requestConfig = resolveModelRequestConfig(config, config.model || config.audioModel);
    const selectedProvider = resolveAudioProvider(requestConfig, requestConfig.model);
    if (!script && selectedProvider.kind !== "voxcpm" && selectedProvider.kind !== "voicebox" && normalizeVolcengineSpeakerValue(requestConfig.audioVoice) && !isVolcengineSpeechConfig(requestConfig, requestConfig.model.trim())) {
        const volcengineModel = findVolcengineAudioModel(config);
        if (volcengineModel) requestConfig = resolveModelRequestConfig(config, volcengineModel);
    }
    const provider = resolveAudioProvider(requestConfig, requestConfig.model);
    const voice = provider.kind === "voxcpm" ? "default" : provider.kind === "voicebox" ? requestConfig.audioVoice.trim() : normalizeAudioVoiceValue(requestConfig.audioVoice);
    const model = isVolcengineSpeechConfig(requestConfig, requestConfig.model.trim()) ? normalizeVolcengineResourceId(requestConfig.model, voice) : requestConfig.model.trim();
    const payload = JSON.stringify({
        v: 3,
        baseUrl: requestConfig.baseUrl.trim().replace(/\/+$/, ""),
        model,
        voice,
        format: provider.kind === "voxcpm" || provider.kind === "voicebox" ? "wav" : normalizeAudioFormatValue(requestConfig.audioFormat),
        speed: provider.kind === "voicebox" ? null : normalizeAudioSpeedValue(requestConfig.audioSpeed),
        instructions: requestConfig.audioInstructions.trim(),
        prompt: prompt.trim(),
        referenceAudios: (options?.referenceAudios || []).map((audio) => ({ id: audio.id, storageKey: audio.storageKey, url: audio.url, durationMs: audio.durationMs })),
        promptText: options?.promptText?.trim() || "",
        seed: options?.seed || null,
        candidateCount: options?.candidateCount || null,
        targetPitchHz: provider.kind === "voxcpm" ? voxCpmTargetPitchHz(requestConfig.audioInstructions) : null,
        script,
    });
    return `audio-preview:${await sha256(payload)}`;
}

async function normalizeModelScriptAudio(result: unknown, format: string, signal?: AbortSignal) {
    if (result instanceof Blob) return result.type.startsWith("audio/") ? result : new Blob([result], { type: audioMimeType(format) });
    let source = "";
    if (typeof result === "string") source = result.trim();
    else if (result && typeof result === "object") {
        const record = result as Record<string, unknown>;
        source = [record.b64_json, record.data, record.url].find((value) => typeof value === "string" && value.trim()) as string | undefined || "";
    }
    if (!source) throw new Error("模型调用脚本没有返回音频");
    const url = source.startsWith("data:") || /^https?:/i.test(source) ? source : `data:${audioMimeType(format)};base64,${source}`;
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`模型调用脚本返回的音频无法读取（${response.status}）`);
    const blob = await response.blob();
    return blob.type.startsWith("audio/") ? blob : new Blob([blob], { type: audioMimeType(format) });
}

function voxCpmTargetPitchHz(instructions: string) {
    const text = instructions.trim();
    if (/女婴/.test(text)) return 320;
    if (/男婴/.test(text)) return 290;
    if (/婴儿|宝宝|襁褓/.test(text)) return 305;
    if (/女孩|女童/.test(text)) return 255;
    if (/男孩|男童/.test(text)) return 225;
    if (/少女/.test(text)) return 220;
    if (/少年|变声期/.test(text)) return 160;
    if (/老年中国女性|老年女性/.test(text)) return 175;
    if (/中年中国女性|中年女性/.test(text)) return 185;
    if (/年轻中国女性|成年中国女性|年轻女性|成年女性/.test(text)) return 205;
    if (/老年中国男性|老年男性/.test(text)) return 105;
    if (/中年中国男性|中年男性/.test(text)) return 110;
    if (/年轻中国男性|成年中国男性|年轻男性|成年男性/.test(text)) return 120;
    return null;
}

async function sha256(value: string) {
    if (typeof crypto !== "undefined" && crypto.subtle) {
        const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
        return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
    }
    return btoa(unescape(encodeURIComponent(value))).replace(/[+/=]/g, "").slice(0, 96);
}

function assertAudioConfig(config: AiConfig, model: string) {
    if (!model) throw new Error("请先配置音频模型");
    if (!config.baseUrl.trim()) throw new Error("请先配置 Base URL");
    if (!config.apiKey.trim()) throw new Error("请先配置 API Key");
    if (config.apiFormat === "gemini") throw new Error("Gemini 调用格式暂不支持音频生成，请使用 OpenAI 格式渠道");
}

function isVolcengineSpeechConfig(config: AiConfig, model: string) {
    return /openspeech\.bytedance\.com/i.test(config.baseUrl) || /^seed-(tts|icl)-/i.test(model);
}

function findVolcengineAudioModel(config: AiConfig) {
    const candidates = Array.from(new Set([config.audioModel, ...config.audioModels, ...config.models].filter(Boolean)));
    const matched = candidates.find((candidate) => {
        const requestConfig = resolveModelRequestConfig(config, candidate);
        return isVolcengineSpeechConfig(requestConfig, requestConfig.model.trim());
    });
    if (matched) return matched;
    const channel = config.channels.find((item) => /openspeech\.bytedance\.com/i.test(item.baseUrl) && item.models.length);
    const model = channel?.models.find((item) => /^seed-(tts|icl)-/i.test(item)) || channel?.models[0];
    return channel && model ? `${channel.id}::${model}` : "";
}

function resolveVolcengineAudioRequestConfig(config: AiConfig) {
    const volcengineModel = findVolcengineAudioModel(config);
    return resolveModelRequestConfig(config, volcengineModel || config.audioModel || config.model);
}

async function requestVolcengineJson<T>(config: AiConfig, path: string, payload: object, options?: RequestOptions): Promise<T> {
    const requests = volcengineJsonRequests(config.baseUrl, path);
    let lastError: unknown;
    for (const request of requests) {
        try {
            const response = await axios.post<T>(
                request.url,
                request.viaAgent ? { baseUrl: config.baseUrl, apiKey: config.apiKey, path, payload } : payload,
                {
                    headers: request.viaAgent ? { "Content-Type": "application/json" } : volcengineJsonHeaders(config.apiKey),
                    signal: options?.signal,
                },
            );
            return response.data;
        } catch (error) {
            lastError = error;
            if (!shouldTryNextVolcengineRequest(error, request)) break;
        }
    }
    throw new Error(await readAxiosError(lastError, requests[0]?.viaAgent ? "火山语音本地代理请求失败" : "火山语音请求失败"));
}

function volcengineJsonRequests(baseUrl: string, path: string): VolcengineSpeechRequest[] {
    const agentPath = path.includes("get_voice") ? "get-voice" : "voice-clone";
    const agentUrl = volcengineAgentProxyUrl(agentPath);
    const directUrl = volcengineDevProxyUrl(volcengineApiUrl(baseUrl, path)) || volcengineApiUrl(baseUrl, path);
    return [
        ...(agentUrl ? [{ url: agentUrl, viaAgent: true }] : []),
        { url: directUrl, viaAgent: false },
    ];
}

function volcengineApiUrl(baseUrl: string, path: string) {
    const base = baseUrl.trim().replace(/\/+$/, "") || "https://openspeech.bytedance.com";
    return `${base.replace(/\/api\/v3\/tts(?:\/.*)?$/i, "")}${path}`;
}

function volcengineSpeechUrl(baseUrl: string) {
    const base = baseUrl.trim().replace(/\/+$/, "") || "https://openspeech.bytedance.com";
    if (/\/api\/v3\/tts\/unidirectional$/i.test(base)) return base;
    return `${base.replace(/\/api\/v3\/tts(?:\/.*)?$/i, "")}/api/v3/tts/unidirectional`;
}

type VolcengineSpeechRequest = { url: string; viaAgent: boolean };

function volcengineSpeechRequests(baseUrl: string): VolcengineSpeechRequest[] {
    const agentUrl = volcengineAgentProxyUrl();
    const directUrl = volcengineDevProxyUrl(volcengineSpeechUrl(baseUrl)) || volcengineSpeechUrl(baseUrl);
    return [
        ...(agentUrl ? [{ url: agentUrl, viaAgent: true }] : []),
        { url: directUrl, viaAgent: false },
    ];
}

function shouldTryNextVolcengineRequest(error: unknown, request: VolcengineSpeechRequest) {
    if (!request.viaAgent || axios.isCancel(error)) return false;
    if (!axios.isAxiosError(error)) return false;
    return error.response?.status === 404 || error.response?.status === 405;
}

function volcengineSpeechHeaders(apiKey: string, resourceId: string) {
    const legacy = parseVolcengineLegacyAuth(apiKey);
    if (legacy) {
        return {
            "Content-Type": "application/json",
            "X-Api-App-Id": legacy.appId,
            "X-Api-Access-Key": legacy.accessToken,
            "X-Api-Connect-Id": nanoConnectId(),
            "X-Api-Resource-Id": resourceId,
        };
    }
    return {
        "Content-Type": "application/json",
        "X-Api-Key": apiKey,
        "X-Api-Connect-Id": nanoConnectId(),
        "X-Api-Resource-Id": resourceId,
    };
}

function parseVolcengineLegacyAuth(value: string) {
    const source = value.trim();
    if (!source) return null;
    if (source.startsWith("{")) {
        try {
            const payload = JSON.parse(source) as { appId?: string; app_id?: string; accessToken?: string; access_token?: string; accessKey?: string; access_key?: string };
            const appId = (payload.appId || payload.app_id || "").trim();
            const accessToken = (payload.accessToken || payload.access_token || payload.accessKey || payload.access_key || "").trim();
            return appId && accessToken ? { appId, accessToken } : null;
        } catch {
            return null;
        }
    }
    const parts = source.split(/[|,\s]+/).map((item) => item.trim()).filter(Boolean);
    return parts.length >= 2 && /^\d{6,}$/.test(parts[0]) ? { appId: parts[0], accessToken: parts[1] } : null;
}

function volcengineAgentProxyUrl(proxyPath = "tts") {
    if (typeof window === "undefined") return "";
    try {
        const endpoint = (localStorage.getItem("canvas-agent-url") || "").trim().replace(/\/+$/, "");
        const token = (localStorage.getItem("canvas-agent-token") || "").trim();
        return endpoint && token ? `${endpoint}/api/proxy/volcengine/${proxyPath}?token=${encodeURIComponent(token)}` : "";
    } catch {
        return "";
    }
}

function mediaDownloadAgentProxyUrl() {
    if (typeof window === "undefined") return "";
    try {
        const endpoint = (localStorage.getItem("canvas-agent-url") || "").trim().replace(/\/+$/, "");
        const token = (localStorage.getItem("canvas-agent-token") || "").trim();
        return endpoint && token ? `${endpoint}/api/proxy/media/download?token=${encodeURIComponent(token)}` : "";
    } catch {
        return "";
    }
}

function volcengineDevProxyUrl(targetUrl: string) {
    if (typeof window === "undefined") return "";
    if (!import.meta.env.DEV) return "";
    try {
        const target = new URL(targetUrl);
        if (!/openspeech\.bytedance\.com$/i.test(target.hostname)) return "";
        if (!["localhost", "127.0.0.1", "::1"].includes(window.location.hostname)) return "";
        return `${target.pathname}${target.search}`;
    } catch {
        return "";
    }
}

function normalizeVolcengineResourceId(value: string, speaker = "") {
    const inferred = inferVolcengineResourceIdFromSpeaker(speaker);
    if (inferred) return inferred;
    const resourceId = value.trim();
    if (/^tts-seedtts2/i.test(resourceId) || /seedtts2/i.test(resourceId)) return "seed-tts-2.0";
    if (/^tts-seedicl2/i.test(resourceId) || /seedicl2/i.test(resourceId)) return "seed-icl-2.0";
    if (/^(seed-(tts|icl)-|volc\.service_type\.)/i.test(resourceId)) return resourceId;
    return "seed-tts-2.0";
}

function inferVolcengineResourceIdFromSpeaker(value: string) {
    const speaker = value.trim().toLowerCase();
    if (!speaker) return "";
    if (/(^s_|^icl_|^custom_|_icl_|clone|voiceclone)/i.test(speaker)) return "seed-icl-2.0";
    if (/_uranus_bigtts$/i.test(speaker)) return "seed-tts-2.0";
    return "";
}

function volcengineJsonHeaders(apiKey: string) {
    const legacy = parseVolcengineLegacyAuth(apiKey);
    if (legacy) {
        return {
            "Content-Type": "application/json",
            "X-Api-App-Key": legacy.appId,
            "X-Api-App-Id": legacy.appId,
            "X-Api-Access-Key": legacy.accessToken,
            "X-Api-Request-Id": nanoConnectId(),
        };
    }
    return {
        "Content-Type": "application/json",
        "X-Api-Key": apiKey,
        "X-Api-Request-Id": nanoConnectId(),
    };
}

async function fileToBase64Audio(file: File) {
    const data = await blobToBase64(file);
    return { data, format: audioFileFormat(file) };
}

function blobToBase64(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || "").replace(/^data:[^;]+;base64,/, ""));
        reader.onerror = () => reject(reader.error || new Error("读取音频失败"));
        reader.readAsDataURL(blob);
    });
}

function audioFileFormat(file: File) {
    const name = file.name.toLowerCase();
    if (name.endsWith(".wav")) return "wav";
    if (name.endsWith(".ogg")) return "ogg";
    if (name.endsWith(".m4a")) return "m4a";
    if (name.endsWith(".aac")) return "aac";
    if (name.endsWith(".pcm")) return "pcm";
    return "mp3";
}

function normalizeCustomSpeakerId(value: string) {
    const source = value.trim().replace(/[^a-zA-Z0-9_-]/g, "_");
    const prefixed = /^[a-zA-Z]/.test(source) ? source : `custom_${source}`;
    return prefixed.replace(/[-_]+$/g, "").slice(0, 256).padEnd(8, "0");
}

function nanoConnectId() {
    return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeVolcengineAudioFormat(value: string) {
    const format = normalizeAudioFormatValue(value);
    if (format === "opus") return "ogg_opus";
    if (format === "pcm") return "pcm";
    return "mp3";
}

function volcengineSpeechRate(value: string) {
    const speed = Number(normalizeAudioSpeedValue(value));
    return Math.max(-50, Math.min(100, Math.round((speed - 1) * 100)));
}

async function normalizeVolcengineAudioBlob(blob: Blob, format: string) {
    const mimeType = audioMimeType(format);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (looksLikeAudioFile(bytes)) return new Blob([Uint8Array.from(bytes)], { type: blob.type.startsWith("audio/") ? blob.type : mimeType });
    const chunks = extractVolcengineAudioChunks(bytes);
    if (chunks.length) return new Blob(chunks.map((chunk) => Uint8Array.from(chunk)), { type: mimeType });
    const jsonChunks = extractVolcengineJsonAudioChunks(bytes);
    if (jsonChunks.length) return new Blob(jsonChunks.map((chunk) => Uint8Array.from(chunk)), { type: mimeType });
    return blob.type.startsWith("audio/") ? blob : new Blob([Uint8Array.from(bytes)], { type: mimeType });
}

function looksLikeAudioFile(bytes: Uint8Array) {
    if (bytes.length < 4) return false;
    const text = ascii(bytes, 0, 4);
    if (text === "ID3" || text === "OggS") return true;
    if (text === "RIFF" && ascii(bytes, 8, 4) === "WAVE") return true;
    return bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
}

function extractVolcengineAudioChunks(bytes: Uint8Array) {
    const chunks: Uint8Array[] = [];
    let offset = 0;
    while (offset + 4 <= bytes.length) {
        const version = bytes[offset] >> 4;
        const headerSize = (bytes[offset] & 0x0f) * 4;
        const messageType = bytes[offset + 1] >> 4;
        const flags = bytes[offset + 1] & 0x0f;
        if (version !== 1 || headerSize < 4 || offset + headerSize > bytes.length) break;
        let cursor = offset + headerSize;
        if (messageType === 0x0b) {
            if (!flags) {
                offset = cursor;
                continue;
            }
            if (cursor + 8 > bytes.length) break;
            cursor += 4;
            const payloadSize = readInt32(bytes, cursor);
            cursor += 4;
            if (!validPayloadRange(bytes, cursor, payloadSize)) break;
            chunks.push(bytes.slice(cursor, cursor + payloadSize));
            offset = cursor + payloadSize;
            continue;
        }
        if (messageType === 0x0f) {
            if (cursor + 8 > bytes.length) break;
            cursor += 4;
            const payloadSize = readInt32(bytes, cursor);
            cursor += 4 + Math.max(0, payloadSize);
            offset = Math.min(cursor, bytes.length);
            continue;
        }
        if (cursor + 4 > bytes.length) break;
        const payloadSize = readInt32(bytes, cursor);
        cursor += 4;
        if (!validPayloadRange(bytes, cursor, payloadSize)) break;
        offset = cursor + payloadSize;
    }
    return chunks;
}

type VolcengineChunkPayload = {
    code?: number | string;
    status_code?: number | string;
    msg?: string;
    message?: string;
    error?: { code?: number | string; message?: string };
    data?: string;
};

function extractVolcengineJsonAudioChunks(bytes: Uint8Array) {
    const text = new TextDecoder().decode(bytes).trim();
    if (!text || !text.includes("{")) return [];
    const chunks: Uint8Array[] = [];
    const payloads = parseJsonObjects(text);
    for (const payload of payloads) {
        const code = Number(payload.code ?? payload.status_code ?? payload.error?.code ?? 0);
        const message = payload.msg || payload.message || payload.error?.message;
        if (Number.isFinite(code) && code !== 0 && code !== 20000000) throw new Error([code, message].filter(Boolean).join("：") || "火山语音合成失败");
        const audio = typeof payload.data === "string" ? decodeBase64AudioChunk(payload.data) : null;
        if (audio?.length) chunks.push(audio);
    }
    if (payloads.length && !chunks.length) throw new Error("火山语音合成未返回音频数据");
    return chunks;
}

function parseJsonObjects(text: string) {
    const objects: VolcengineChunkPayload[] = [];
    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim().replace(/^data:\s*/i, "");
        if (!line || line === "[DONE]") continue;
        try {
            const payload = JSON.parse(line) as VolcengineChunkPayload;
            if (payload && typeof payload === "object") objects.push(payload);
        } catch {
            // Fall back to balanced JSON scanning below.
        }
    }
    if (objects.length) return objects;

    let start = -1;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        if (inString) {
            if (escaped) {
                escaped = false;
                continue;
            }
            if (char === "\\") {
                escaped = true;
                continue;
            }
            if (char === "\"") inString = false;
            continue;
        }
        if (char === "\"") {
            inString = true;
            continue;
        }
        if (char === "{") {
            if (depth === 0) start = index;
            depth += 1;
            continue;
        }
        if (char !== "}" || depth === 0) continue;
        depth -= 1;
        if (depth === 0 && start >= 0) {
            try {
                const payload = JSON.parse(text.slice(start, index + 1)) as VolcengineChunkPayload;
                if (payload && typeof payload === "object") objects.push(payload);
            } catch {
                // Ignore non-JSON chunks.
            }
            start = -1;
        }
    }
    return objects;
}

function decodeBase64AudioChunk(value: string) {
    const source = value.trim().replace(/^data:audio\/[^;]+;base64,/i, "").replace(/\s+/g, "");
    if (source.length < 8 || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(source)) return null;
    const normalized = source.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
    try {
        const binary = atob(padded);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
        return bytes;
    } catch {
        return null;
    }
}

function validPayloadRange(bytes: Uint8Array, start: number, size: number) {
    return Number.isFinite(size) && size >= 0 && start + size <= bytes.length;
}

function readInt32(bytes: Uint8Array, offset: number) {
    return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function ascii(bytes: Uint8Array, start: number, length: number) {
    if (start + length > bytes.length) return "";
    return String.fromCharCode(...bytes.slice(start, start + length));
}

async function assertAudioBlob(blob: Blob) {
    if (!blob.type.includes("json")) return;
    let payload: { code?: number; msg?: string; error?: { message?: string } };
    try {
        payload = JSON.parse(await blob.text()) as { code?: number; msg?: string; error?: { message?: string } };
    } catch {
        return;
    }
    if (typeof payload.code === "number" && payload.code !== 0) throw new Error(payload.msg || "音频生成失败");
    if (payload.error?.message) throw new Error(payload.error.message);
}

async function readAxiosError(error: unknown, fallback: string) {
    if (axios.isCancel(error)) return "请求已取消";
    if (axios.isAxiosError<{ error?: { message?: string }; msg?: string; detail?: string; code?: number }>(error)) {
        if (!error.response) {
            const message = error.message || fallback;
            if (/network error/i.test(message) && fallback.includes("本地代理")) return "火山语音合成本地代理没有响应，请确认 Infinite Canvas Agent 正在运行并已连接；如果刚更新代码，请重启本地 Agent 后再试。";
            if (/network error/i.test(message) && fallback.includes("火山")) return "火山语音合成请求没有收到服务响应（Network Error）。通常是浏览器直连 OpenSpeech 被 CORS 或网络策略拦截；请打开浏览器控制台 Network/Console 查看是否有 CORS 报错。";
            return message;
        }
        const responseData = error.response?.data;
        const message = await extractAxiosErrorMessage(responseData);
        const logId = error.response?.headers?.["x-tt-logid"] || error.response?.headers?.["x-tt-log-id"];
        const detail = message || statusMessage(error.response?.status, fallback);
        return logId ? `${detail}（火山 logid: ${logId}）` : detail;
    }
    return error instanceof Error ? error.message : fallback;
}

async function extractAxiosErrorMessage(data: unknown) {
    if (!data) return "";
    if (data instanceof Blob) {
        const text = await data.text();
        return extractAxiosErrorMessageFromText(text);
    }
    if (typeof data === "string") return extractAxiosErrorMessageFromText(data);
    if (typeof data === "object") {
        return extractAxiosErrorMessageFromObject(data);
    }
    return "";
}

function extractAxiosErrorMessageFromObject(data: object) {
    const payload = data as { message?: string; msg?: string; detail?: string; code?: string | number; error?: string | { message?: string; code?: string | number } };
    const nestedError = typeof payload.error === "object" ? payload.error : undefined;
    const code = payload.code || nestedError?.code;
    const message = payload.detail || payload.msg || payload.message || (typeof payload.error === "string" ? payload.error : nestedError?.message);
    return [code, message].filter(Boolean).join("：");
}

function extractAxiosErrorMessageFromText(text: string) {
    const source = text.trim();
    if (!source) return "";
    try {
        const payload = JSON.parse(source) as object;
        return typeof payload === "object" && payload ? extractAxiosErrorMessageFromObject(payload) : source.slice(0, 300);
    } catch {
        return source.slice(0, 300);
    }
}

function statusMessage(status: number | undefined, fallback: string) {
    if (status === 401 || status === 403) return "鉴权失败，请检查 API Key、套餐权限或模型权限";
    if (status === 429) return "请求被限流或额度不足，请稍后重试";
    return status ? `${fallback}（${status}）` : fallback;
}

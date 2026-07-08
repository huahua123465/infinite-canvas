import axios from "axios";
import localforage from "localforage";

import { audioMimeType, normalizeAudioFormatValue, normalizeAudioSpeedValue, normalizeAudioVoiceValue, normalizeVolcengineSpeakerValue, suggestVolcengineSpeakerForText } from "@/lib/audio-generation";
import { getMediaBlob, resolveMediaUrl, uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { buildApiUrl, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";

type RequestOptions = { signal?: AbortSignal };
export type StoredAudioFile = UploadedFile & { cacheKey: string; cacheHit?: "local" | "shared" };
type AudioCacheRecord = { storageKey: string; bytes: number; mimeType: string; durationMs?: number; createdAt: number };
type SharedAudioCacheEntry = { key: string; url: string; bytes?: number; mimeType?: string; durationMs?: number };

const audioCacheStore = localforage.createInstance({ name: "infinite-canvas", storeName: "audio_generation_cache" });
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
    let requestConfig = resolveModelRequestConfig(config, config.model || config.audioModel);
    let model = requestConfig.model.trim();
    if (normalizeVolcengineSpeakerValue(config.audioVoice) && !isVolcengineSpeechConfig(requestConfig, model)) {
        const volcengineModel = findVolcengineAudioModel(config);
        if (volcengineModel) {
            requestConfig = resolveModelRequestConfig(config, volcengineModel);
            model = requestConfig.model.trim();
        }
    }
    assertAudioConfig(requestConfig, model);
    if (isVolcengineSpeechConfig(requestConfig, model)) return requestVolcengineSpeech(requestConfig, model, prompt, options);
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

export async function storeGeneratedAudio(blob: Blob, format = "mp3"): Promise<UploadedFile> {
    const audio = blob.type.startsWith("audio/") ? blob : new Blob([blob], { type: audioMimeType(format) });
    return uploadMediaFile(audio, "audio");
}

export async function requestStoredAudioGeneration(config: AiConfig, prompt: string, options?: RequestOptions): Promise<StoredAudioFile> {
    const cacheKey = await audioGenerationCacheKey(config, prompt);
    const cached = await readLocalAudioCache(cacheKey);
    if (cached) return { ...cached, cacheKey, cacheHit: "local" };
    const shared = await readSharedAudioCache(cacheKey, config.audioFormat);
    if (shared) return { ...shared, cacheKey, cacheHit: "shared" };
    const audio = await storeGeneratedAudio(await requestAudioGeneration(config, prompt, options), config.audioFormat);
    await writeLocalAudioCache(cacheKey, audio);
    return { ...audio, cacheKey };
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

async function audioGenerationCacheKey(config: AiConfig, prompt: string) {
    let requestConfig = resolveModelRequestConfig(config, config.model || config.audioModel);
    if (normalizeVolcengineSpeakerValue(requestConfig.audioVoice) && !isVolcengineSpeechConfig(requestConfig, requestConfig.model.trim())) {
        const volcengineModel = findVolcengineAudioModel(config);
        if (volcengineModel) requestConfig = resolveModelRequestConfig(config, volcengineModel);
    }
    const payload = JSON.stringify({
        v: 1,
        baseUrl: requestConfig.baseUrl.trim().replace(/\/+$/, ""),
        model: requestConfig.model.trim(),
        voice: normalizeAudioVoiceValue(requestConfig.audioVoice),
        format: normalizeAudioFormatValue(requestConfig.audioFormat),
        speed: normalizeAudioSpeedValue(requestConfig.audioSpeed),
        instructions: requestConfig.audioInstructions.trim(),
        prompt: prompt.trim(),
    });
    return `audio-preview:${await sha256(payload)}`;
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

function volcengineAgentProxyUrl() {
    if (typeof window === "undefined") return "";
    try {
        const endpoint = (localStorage.getItem("canvas-agent-url") || "").trim().replace(/\/+$/, "");
        const token = (localStorage.getItem("canvas-agent-token") || "").trim();
        return endpoint && token ? `${endpoint}/api/proxy/volcengine/tts?token=${encodeURIComponent(token)}` : "";
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
    if (/(^s_|_icl_|clone|voiceclone)/i.test(speaker)) return "seed-icl-2.0";
    if (/_uranus_bigtts$/i.test(speaker)) return "seed-tts-2.0";
    return "";
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
    if (looksLikeAudioFile(bytes)) return new Blob([bytes], { type: blob.type.startsWith("audio/") ? blob.type : mimeType });
    const chunks = extractVolcengineAudioChunks(bytes);
    if (chunks.length) return new Blob(chunks, { type: mimeType });
    const jsonChunks = extractVolcengineJsonAudioChunks(bytes);
    if (jsonChunks.length) return new Blob(jsonChunks, { type: mimeType });
    return blob.type.startsWith("audio/") ? blob : new Blob([bytes], { type: mimeType });
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
    if (axios.isAxiosError<{ error?: { message?: string }; msg?: string; code?: number }>(error)) {
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
    const payload = data as { message?: string; msg?: string; code?: string | number; error?: { message?: string; code?: string | number } };
    const code = payload.code || payload.error?.code;
    const message = payload.msg || payload.message || payload.error?.message;
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

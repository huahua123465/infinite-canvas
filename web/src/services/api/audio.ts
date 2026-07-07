import axios from "axios";

import { audioMimeType, normalizeAudioFormatValue, normalizeAudioSpeedValue, normalizeAudioVoiceValue, normalizeVolcengineSpeakerValue } from "@/lib/audio-generation";
import { uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { buildApiUrl, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";

type RequestOptions = { signal?: AbortSignal };

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
    const requestConfig = resolveModelRequestConfig(config, config.model || config.audioModel);
    const model = requestConfig.model.trim();
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
        throw new Error(readAxiosError(error, "音频生成失败"));
    }
}

async function requestVolcengineSpeech(config: AiConfig, resourceId: string, text: string, options?: RequestOptions): Promise<Blob> {
    const format = normalizeVolcengineAudioFormat(config.audioFormat);
    const speaker = normalizeVolcengineSpeakerValue(config.audioVoice);
    if (!speaker) throw new Error("火山语音合成必须填写有效 speaker ID，不能使用 OpenAI voice（如 alloy、coral、onyx）。请在角色声音里填写对应的火山音色 ID，例如 zh_female_cancan_mars_bigtts。");
    const response = await axios.post<Blob>(
        volcengineSpeechUrl(config.baseUrl),
        {
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
        },
        {
            headers: {
                "Content-Type": "application/json",
                "X-Api-Key": config.apiKey,
                "X-Api-Resource-Id": resourceId || "seed-tts-2.0",
            },
            responseType: "blob",
            signal: options?.signal,
        },
    ).catch((error) => {
        throw new Error(readAxiosError(error, "火山语音合成失败"));
    });
    await assertAudioBlob(response.data);
    return response.data.type.startsWith("audio/") ? response.data : new Blob([response.data], { type: audioMimeType(format) });
}

export async function storeGeneratedAudio(blob: Blob, format = "mp3"): Promise<UploadedFile> {
    const audio = blob.type.startsWith("audio/") ? blob : new Blob([blob], { type: audioMimeType(format) });
    return uploadMediaFile(audio, "audio");
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

function volcengineSpeechUrl(baseUrl: string) {
    const base = baseUrl.trim().replace(/\/+$/, "") || "https://openspeech.bytedance.com";
    if (/\/api\/v3\/tts\/unidirectional$/i.test(base)) return base;
    return `${base.replace(/\/api\/v3\/tts(?:\/.*)?$/i, "")}/api/v3/tts/unidirectional`;
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

function readAxiosError(error: unknown, fallback: string) {
    if (axios.isCancel(error)) return "请求已取消";
    if (axios.isAxiosError<{ error?: { message?: string }; msg?: string; code?: number }>(error)) {
        const responseData = error.response?.data;
        return responseData?.msg || responseData?.error?.message || statusMessage(error.response?.status, fallback);
    }
    return error instanceof Error ? error.message : fallback;
}

function statusMessage(status: number | undefined, fallback: string) {
    if (status === 401 || status === 403) return "鉴权失败，请检查 API Key、套餐权限或模型权限";
    if (status === 429) return "请求被限流或额度不足，请稍后重试";
    return status ? `${fallback}（${status}）` : fallback;
}

import { audioVoiceOptions, normalizeAudioVoiceValue, normalizeVolcengineSpeakerValue, volcengineVoiceOptions } from "@/lib/audio-generation";
import { modelOptionName, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";

export type AudioProviderKind = "openai" | "volcengine" | "unsupported";

export type AudioProviderInfo = {
    kind: AudioProviderKind;
    label: string;
    model: string;
    baseUrl: string;
};

export const DEFAULT_VOLCENGINE_SPEAKER = volcengineVoiceOptions[0]?.value || "zh_female_cancan_uranus_bigtts";

export function resolveAudioProvider(config: AiConfig, modelValue = config.model || config.audioModel): AudioProviderInfo {
    const requestConfig = resolveModelRequestConfig(config, modelValue || config.audioModel || config.model);
    const model = modelOptionName(modelValue || requestConfig.model || config.audioModel || config.model).trim();
    const baseUrl = requestConfig.baseUrl.trim();
    if (/openspeech\.bytedance\.com/i.test(baseUrl) || /^seed-(tts|icl)-/i.test(model)) return { kind: "volcengine", label: "火山 OpenSpeech", model, baseUrl };
    if (requestConfig.apiFormat === "gemini") return { kind: "unsupported", label: "暂不支持音频", model, baseUrl };
    return { kind: "openai", label: "OpenAI TTS", model, baseUrl };
}

export function isVolcengineAudioProvider(config: AiConfig, modelValue = config.model || config.audioModel) {
    return resolveAudioProvider(config, modelValue).kind === "volcengine";
}

export function normalizeAudioVoiceForProvider(config: AiConfig, modelValue: string, voice = config.audioVoice) {
    const provider = resolveAudioProvider(config, modelValue);
    if (provider.kind === "volcengine") return normalizeVolcengineSpeakerValue(voice) || DEFAULT_VOLCENGINE_SPEAKER;
    if (audioVoiceOptions.some((item) => item.value === voice.trim().toLowerCase())) return normalizeAudioVoiceValue(voice);
    return "alloy";
}

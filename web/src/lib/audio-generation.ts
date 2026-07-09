import { VOLCENGINE_VOICE_OPTIONS } from "@/lib/volcengine-voices";

export const audioVoiceOptions = [
    { value: "alloy", label: "Alloy" },
    { value: "ash", label: "Ash" },
    { value: "ballad", label: "Ballad" },
    { value: "coral", label: "Coral" },
    { value: "echo", label: "Echo" },
    { value: "fable", label: "Fable" },
    { value: "nova", label: "Nova" },
    { value: "onyx", label: "Onyx" },
    { value: "sage", label: "Sage" },
    { value: "shimmer", label: "Shimmer" },
    { value: "verse", label: "Verse" },
    { value: "marin", label: "Marin" },
    { value: "cedar", label: "Cedar" },
];

const defaultAudioVoice = "alloy";
const openAiAudioVoiceValues = new Set(audioVoiceOptions.map((item) => item.value));

export type VolcengineVoiceOption = {
    value: string;
    label: string;
    gender: "female" | "male";
    age: "young" | "adult" | "old";
    tone: string;
    tags: string[];
};

export const volcengineVoiceOptions: VolcengineVoiceOption[] = VOLCENGINE_VOICE_OPTIONS;

export const audioFormatOptions = [
    { value: "mp3", label: "MP3" },
    { value: "wav", label: "WAV" },
    { value: "opus", label: "Opus" },
    { value: "aac", label: "AAC" },
    { value: "flac", label: "FLAC" },
    { value: "pcm", label: "PCM" },
];

export function normalizeAudioVoiceValue(value: string) {
    return value.trim() || defaultAudioVoice;
}

export function isOpenAiAudioVoiceValue(value: string) {
    return openAiAudioVoiceValues.has(value.trim().toLowerCase());
}

export function normalizeVolcengineSpeakerValue(value: string) {
    const speaker = value.trim();
    if (!speaker || isOpenAiAudioVoiceValue(speaker)) return "";
    return speaker;
}

export function volcengineVoiceLabel(value: string) {
    const voice = volcengineVoiceOptions.find((item) => item.value === value.trim());
    return voice ? `${voice.label} · ${voice.value}` : value;
}

export function suggestVolcengineSpeakerForText(text: string) {
    const source = text.toLowerCase();
    const gender = /父|爸爸|爹|叔|伯|爷|公|丈夫|男人|男性|男/.test(source) ? "male" : /母|妈妈|娘|婶|姨|奶|婆|妻|女人|女性|女/.test(source) ? "female" : "female";
    const age = /老人|老年|年迈|花甲|古稀|爷爷|奶奶|外公|外婆|阿婆|阿公|白发/.test(source) ? "old" : /年轻|少年|少女|青年|女孩|女儿|儿子|孩子|妹妹|弟弟/.test(source) ? "young" : "adult";
    if (gender === "male" && age === "young") return volcengineVoiceOptions.find((item) => item.value === "zh_male_shaonianzixin_uranus_bigtts") || volcengineVoiceOptions[0];
    if (gender === "male" && /霸总|总裁|强势|高冷|傲娇/.test(source)) return volcengineVoiceOptions.find((item) => item.value === "zh_male_aojiaobazong_uranus_bigtts") || volcengineVoiceOptions[0];
    if (gender === "male") return volcengineVoiceOptions.find((item) => item.value === "zh_male_shenyeboke_uranus_bigtts") || volcengineVoiceOptions[0];
    if (age === "old") return volcengineVoiceOptions.find((item) => item.value === "zh_female_popo_uranus_bigtts") || volcengineVoiceOptions[0];
    if (age === "young" && /撒娇|学妹|少女|甜|可爱/.test(source)) return volcengineVoiceOptions.find((item) => item.value === "zh_female_sajiaoxuemei_uranus_bigtts") || volcengineVoiceOptions[0];
    if (age === "young") return volcengineVoiceOptions.find((item) => item.value === "zh_female_linjianvhai_uranus_bigtts") || volcengineVoiceOptions[0];
    if (/亲切|妈妈|母亲|温柔|生活感|口语|方言/.test(source)) return volcengineVoiceOptions.find((item) => item.value === "zh_female_wenroumama_uranus_bigtts") || volcengineVoiceOptions[0];
    return volcengineVoiceOptions[0];
}

export function normalizeAudioFormatValue(value: string) {
    return audioFormatOptions.some((item) => item.value === value) ? value : "mp3";
}

export function normalizeAudioSpeedValue(value: string) {
    const speed = Number(value);
    if (!Number.isFinite(speed)) return "1";
    return String(Math.max(0.25, Math.min(4, Number(speed.toFixed(2)))));
}

export function audioVoiceLabel(value: string) {
    const voice = normalizeAudioVoiceValue(value);
    return audioVoiceOptions.find((item) => item.value === voice)?.label || voice;
}

export function audioFormatLabel(value: string) {
    const format = normalizeAudioFormatValue(value);
    return audioFormatOptions.find((item) => item.value === format)?.label || format;
}

export function audioSpeedLabel(value: string) {
    return `${normalizeAudioSpeedValue(value)}x`;
}

export function audioMimeType(format: string) {
    if (format === "wav") return "audio/wav";
    if (format === "opus" || format === "ogg_opus") return "audio/ogg";
    if (format === "aac") return "audio/aac";
    if (format === "flac") return "audio/flac";
    if (format === "pcm") return "audio/pcm";
    return "audio/mpeg";
}

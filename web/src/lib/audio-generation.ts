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

export const volcengineVoiceOptions: VolcengineVoiceOption[] = [
    { value: "zh_female_cancan_mars_bigtts", label: "灿灿女声 2.0", gender: "female", age: "adult", tone: "自然温和、清晰稳定", tags: ["女声", "成年", "温和", "旁白"] },
    { value: "zh_female_shuangkuaisisi_moon_bigtts", label: "爽快思思 2.0", gender: "female", age: "young", tone: "明快、有活力", tags: ["女声", "年轻", "活泼", "清亮"] },
    { value: "zh_female_xiaohe_uranus_bigtts", label: "小荷女声 2.0", gender: "female", age: "young", tone: "柔和、干净", tags: ["女声", "年轻", "柔和", "少女"] },
    { value: "zh_female_vv_uranus_bigtts", label: "VV 女声 2.0", gender: "female", age: "adult", tone: "亲切、有口语感", tags: ["女声", "成年", "亲切", "方言"] },
    { value: "zh_male_ahu_conversation_wvae_bigtts", label: "阿虎男声 2.0", gender: "male", age: "adult", tone: "成熟、口语、偏低", tags: ["男声", "成年", "父亲", "沉稳"] },
];

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
    if (gender === "male") return volcengineVoiceOptions.find((item) => item.value === "zh_male_ahu_conversation_wvae_bigtts") || volcengineVoiceOptions[0];
    if (age === "young" && /活泼|开朗|快乐|爽快|明快|元气|调皮/.test(source)) return volcengineVoiceOptions.find((item) => item.value === "zh_female_shuangkuaisisi_moon_bigtts") || volcengineVoiceOptions[0];
    if (age === "young") return volcengineVoiceOptions.find((item) => item.value === "zh_female_xiaohe_uranus_bigtts") || volcengineVoiceOptions[0];
    if (/亲切|妈妈|母亲|温柔|生活感|口语|方言/.test(source)) return volcengineVoiceOptions.find((item) => item.value === "zh_female_vv_uranus_bigtts") || volcengineVoiceOptions[0];
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

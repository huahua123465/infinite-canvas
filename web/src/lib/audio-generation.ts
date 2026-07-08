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
    { value: "zh_female_cancan_uranus_bigtts", label: "知性灿灿 2.0", gender: "female", age: "adult", tone: "角色扮演、知性女声", tags: ["女声", "成年", "角色", "知性"] },
    { value: "zh_female_sajiaoxuemei_uranus_bigtts", label: "撒娇学妹 2.0", gender: "female", age: "young", tone: "角色扮演、年轻甜美", tags: ["女声", "年轻", "撒娇", "少女"] },
    { value: "zh_female_meilinvyou_uranus_bigtts", label: "魅力女友 2.0", gender: "female", age: "adult", tone: "通用场景、自然亲近", tags: ["女声", "成年", "女友", "温和"] },
    { value: "zh_female_tianmeixiaoyuan_uranus_bigtts", label: "甜美小源 2.0", gender: "female", age: "young", tone: "通用场景、甜美清亮", tags: ["女声", "年轻", "甜美"] },
    { value: "zh_female_tianmeitaozi_uranus_bigtts", label: "甜美桃子 2.0", gender: "female", age: "young", tone: "通用场景、轻快甜美", tags: ["女声", "年轻", "甜美"] },
    { value: "zh_female_qingxinnvsheng_uranus_bigtts", label: "清新女声 2.0", gender: "female", age: "adult", tone: "通用场景、清新干净", tags: ["女声", "清新", "旁白"] },
    { value: "zh_female_linjianvhai_uranus_bigtts", label: "邻家女孩 2.0", gender: "female", age: "young", tone: "通用场景、生活感", tags: ["女声", "年轻", "生活感"] },
    { value: "zh_female_wenroumama_uranus_bigtts", label: "温柔妈妈 2.0", gender: "female", age: "adult", tone: "通用场景、温柔母亲感", tags: ["女声", "母亲", "温柔"] },
    { value: "zh_female_gaolengyujie_uranus_bigtts", label: "高冷御姐 2.0", gender: "female", age: "adult", tone: "通用场景、高冷成熟", tags: ["女声", "成年", "御姐"] },
    { value: "zh_female_popo_uranus_bigtts", label: "婆婆 2.0", gender: "female", age: "old", tone: "通用场景、长辈口吻", tags: ["女声", "老人", "长辈"] },
    { value: "zh_female_gufengshaoyu_uranus_bigtts", label: "古风少御 2.0", gender: "female", age: "young", tone: "角色扮演、古风少御", tags: ["女声", "年轻", "古风"] },
    { value: "zh_female_linxiao_uranus_bigtts", label: "林潇 2.0", gender: "female", age: "young", tone: "角色扮演、抖音同款", tags: ["女声", "年轻", "角色"] },
    { value: "zh_male_shaonianzixin_uranus_bigtts", label: "少年梓辛 2.0", gender: "male", age: "young", tone: "通用场景、清爽少年", tags: ["男声", "年轻", "少年"] },
    { value: "zh_male_shenyeboke_uranus_bigtts", label: "深夜播客 2.0", gender: "male", age: "adult", tone: "通用场景、低沉口语", tags: ["男声", "成年", "沉稳", "播客"] },
    { value: "zh_male_qingcang_uranus_bigtts", label: "擎苍 2.0", gender: "male", age: "adult", tone: "角色扮演、番茄小说同款", tags: ["男声", "成年", "角色", "小说"] },
    { value: "zh_male_ruyaqingnian_uranus_bigtts", label: "儒雅青年 2.0", gender: "male", age: "adult", tone: "通用场景、儒雅青年", tags: ["男声", "成年", "儒雅"] },
    { value: "zh_male_aojiaobazong_uranus_bigtts", label: "傲娇霸总 2.0", gender: "male", age: "adult", tone: "通用场景、霸总感", tags: ["男声", "成年", "霸总"] },
    { value: "zh_male_naiqimengwa_uranus_bigtts", label: "奶气萌娃 2.0", gender: "male", age: "young", tone: "通用场景、儿童萌娃", tags: ["男声", "儿童", "萌娃"] },
    { value: "zh_male_xuanyijieshuo_uranus_bigtts", label: "悬疑解说 2.0", gender: "male", age: "adult", tone: "有声阅读、悬疑解说", tags: ["男声", "成年", "解说"] },
    { value: "zh_male_yuanboxiaoshu_uranus_bigtts", label: "渊博小叔 2.0", gender: "male", age: "adult", tone: "通用场景、成熟知识感", tags: ["男声", "成年", "小叔"] },
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

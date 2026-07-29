export type PromptAssistantPresetId = "face_outfit" | "modern_outfit" | "clean_pollution" | "vertical_916" | "character_consistency" | "storyboard_boost" | "scene360_lock" | "negative_lock";

export type PromptAssistantPreset = {
    id: PromptAssistantPresetId;
    label: string;
    description: string;
    apply: (prompt: string) => string;
};

const FACE_OUTFIT_RULE = [
    "基于参考图进行人物换装与发型现代化编辑。",
    "必须严格保留同一个人物的脸部特征：脸型轮廓、下颌线、五官比例、眼型、鼻梁、嘴唇、脸颊结构、皮肤质感、年龄感、头部朝向、侧脸角度和原图光影气质。",
    "不要换脸，不要改变脸部骨相，不要变成另一位人物。",
].join("\n");

const MODERN_OUTFIT_RULE = [
    "仅修改服装和发型为现代都市风格：高级感白衬衫、短款针织开衫、羊绒大衣、极简吊带或干净通勤穿搭均可。",
    "古代发髻、盘发、发簪、发冠、古风发饰必须改为现代自然发型，可为中分、微偏分、自然披散长发或低马尾。",
    "整体保持写实电影感、柔和光影、浅景深、干净高级。",
].join("\n");

const CHARACTER_CONSISTENCY_RULE = [
    "角色一致性要求：同一脸型、同一五官比例、同一发色发量、同一年龄感、同一气质，禁止生成多个不同人物。",
    "保持面部清晰，眼神、鼻梁、嘴唇和下颌线稳定，不要欧美化、二次元化、幼态化或网红脸化。",
].join("\n");

const VERTICAL_916_RULE = "9:16竖屏构图，人物或场景主体居中，适合手机短剧/漫剧画幅，不要横屏，不要宽银幕。";

const NEGATIVE_RULE = "禁止：古装、汉服、仙侠服、戏服、古代发型、发簪、发冠、盘发、夸张首饰、厚重妆容、改变脸型、改变五官、换脸、欧美脸、二次元、多人、文字、水印、logo、拼图、分屏、九宫格。";

const STORYBOARD_RULE = [
    "分镜增强：明确镜头景别、角色动作、情绪、光影、空间关系和画面焦点。",
    "单张画面只表达一个镜头，不要拼图，不要多视角同屏，不要把不同时间动作塞进同一画面。",
    "保持角色与场景连续性，画面应像一帧可直接进入短剧分镜的电影剧照。",
].join("\n");

const SCENE360_RULE = [
    "Scene360视角锁定：只生成当前指定单一视角，不要九宫格，不要多视图拼接，不要split screen。",
    "保持同一空间结构、墙面、地面、门窗、家具、材质、光源位置一致。",
    "如果是front/top/back/left/right/45度视角，镜头角度必须严格服从该视角，不要混入其他视角。",
].join("\n");

export const PROMPT_ASSISTANT_PRESETS: PromptAssistantPreset[] = [
    { id: "face_outfit", label: "保脸换装", description: "锁脸型五官，只换服装/发型", apply: (prompt) => appendPrompt(prompt, FACE_OUTFIT_RULE) },
    { id: "modern_outfit", label: "现代穿搭", description: "去古风，改现代都市造型", apply: (prompt) => appendPrompt(prompt, MODERN_OUTFIT_RULE) },
    { id: "clean_pollution", label: "去污染词", description: "清除分屏/多视角污染", apply: sanitizePromptPollution },
    { id: "vertical_916", label: "统一9:16", description: "改为竖屏手机画幅", apply: (prompt) => appendPrompt(sanitizeAspectRatio(prompt), VERTICAL_916_RULE) },
    { id: "character_consistency", label: "角色一致性", description: "强化同一角色约束", apply: (prompt) => appendPrompt(prompt, CHARACTER_CONSISTENCY_RULE) },
    { id: "storyboard_boost", label: "分镜增强", description: "增强镜头/动作/情绪", apply: (prompt) => appendPrompt(prompt, STORYBOARD_RULE) },
    { id: "scene360_lock", label: "Scene360锁定", description: "单视角空间一致", apply: (prompt) => appendPrompt(sanitizePromptPollution(prompt), SCENE360_RULE) },
    { id: "negative_lock", label: "禁改脸/水印", description: "追加常用负面约束", apply: (prompt) => appendPrompt(prompt, NEGATIVE_RULE) },
];

export function applyPromptPreset(prompt: string, presetId: PromptAssistantPresetId) {
    const preset = PROMPT_ASSISTANT_PRESETS.find((item) => item.id === presetId);
    return preset ? normalizePrompt(preset.apply(prompt)) : prompt;
}

export function buildPromptAssistantInstruction(prompt: string, requirement: string) {
    return [
        "你是专业AI生图提示词编辑器。请基于当前提示词和用户修改要求，输出一段可直接用于图像生成/图像编辑的最终提示词。",
        "只输出最终提示词正文，不要解释，不要Markdown，不要标题。",
        "必须保留当前提示词中明确要求保留的角色身份、脸型、五官、场景连续性和视角约束。",
        "若用户要求保脸/换装/现代化，必须强调不换脸、不改脸型、不改变五官比例。",
        "必须清除2x2 split screen grid、multi-view、top-left/top-right/bottom-left/bottom-right、九宫格、拼图、分屏等污染词，除非用户明确要求拼图。",
        "默认输出9:16竖屏构图。",
        "",
        "当前提示词：",
        prompt.trim() || "（无）",
        "",
        "用户修改要求：",
        requirement.trim() || "优化为更清晰、稳定、可直接生图的提示词。",
    ].join("\n");
}

export function buildCinemaDnaPromptInstruction(prompt: string, skillContent: string) {
    return [
        "你是 Cinema DNA 图片导演。严格按照下方技能规则，把用户当前提示词改写成一段可直接提交给图片模型的最终提示词。",
        "只输出最终提示词正文，不要解释、分析、标题、Markdown 或评分。",
        "保持用户明确指定的主体、人物身份、参考图绑定、@图片/@image 引用、画幅和修改目标；技能只增强电影判断、构图、视线流量、真实摄影、综合色和反 CG 约束。",
        "用户要求单张图片时只输出单张提示词，不要擅自改成三联画；用户明确要求三联画时才规划三张独立镜头。",
        "",
        "【Cinema DNA 技能规则】",
        skillContent.trim(),
        "",
        "【用户当前提示词】",
        prompt.trim(),
    ].join("\n");
}

export function buildStoryboardProjectSettingsInstruction(prompt: string, requirement: string, storySource: string) {
    return [
        "你是影视项目导演设定助手。请根据连接剧本的真实内容和用户追加要求，生成一份跨全片统一、可直接粘贴到 Script 节点的项目设定。",
        "只输出【可编辑项目设定】正文，不要解释、分析、Markdown 表格、分镜、资产清单或复制使用说明。",
        "必须忠实原故事事实、人物关系、时间顺序和结果；根据剧本证据判断题材、时代、地域、人物年龄阶段、情绪底色和声音策略。",
        "用户明确指定的画风、视角、色调、镜头节奏、对白旁白、配乐音效、字幕和视频规格优先；未指定项目填写“根据剧本自动判断”，不要擅自添加强风格。",
        "敏感事实只能改变视觉呈现方式，不能改变事实结果。角色跨年龄或身体状态变化时必须使用独立时期资产。",
        "固定输出格式如下，所有字段必须保留；字段名使用纯文本行首，不要添加加粗、列表符号、序号或标题井号：",
        "",
        "【可编辑项目设定】",
        "",
        "叙事原则：",
        "视觉风格：",
        "叙事视角：",
        "色调与光影：",
        "人物一致性：",
        "场景一致性：",
        "镜头与节奏：",
        "对白与旁白：",
        "配乐与音效：",
        "字幕与屏幕文字：",
        "安全表达：",
        "画面约束：",
        "视频规格：",
        "",
        "【当前项目设定】",
        prompt.trim() || "（使用通用默认设定）",
        "",
        "【用户追加要求】",
        requirement.trim() || "保持自动判断。",
        "",
        "【连接剧本】",
        storySource.trim() || "（未读取到连接剧本，不得编造具体故事设定）",
    ].join("\n");
}

export function sanitizePromptPollution(prompt: string) {
    return normalizePrompt(
        prompt
            .replace(/\(?\s*2x2\s+split\s+screen\s+grid\s*\)?\s*,?/gi, "")
            .replace(/\(?\s*split\s*screen\s*\)?\s*,?/gi, "")
            .replace(/\(?\s*multi[-\s]?view\s*:?\s*[\d.]*\)?\s*,?/gi, "")
            .replace(/top-left\s+is\s+front\s+view\s*,?/gi, "")
            .replace(/top-right\s+is\s+top[-\s]?down\s+view\s*,?/gi, "")
            .replace(/bottom-left\s+is\s+left\s+side\s+view\s*,?/gi, "")
            .replace(/bottom-right\s+is\s+right\s+side\s+view\s*,?/gi, "")
            .replace(/九宫格|拼图|分屏|多视角同屏/g, "")
            .replace(/--ar\s+\d+\s*:\s*\d+/gi, ""),
    );
}

export function sanitizeAspectRatio(prompt: string) {
    return normalizePrompt(prompt.replace(/--ar\s+\d+\s*:\s*\d+/gi, "").replace(/\b(?:16:9|4:3|3:2|1:1)\b/g, "9:16"));
}

export function appendPrompt(prompt: string, addition: string) {
    const base = prompt.trim();
    const next = addition.trim();
    if (!base) return next;
    if (base.includes(next)) return base;
    return `${base}\n\n${next}`;
}

export function normalizePrompt(prompt: string) {
    return prompt
        .replace(/[ \t]+/g, " ")
        .replace(/\s*,\s*,+/g, ", ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

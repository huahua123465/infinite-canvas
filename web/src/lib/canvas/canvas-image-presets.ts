import type { CanvasNodeMetadata } from "@/types/canvas";
import type { NodeGenerationInput } from "@/components/canvas/canvas-node-generation";

export type CanvasImagePresetId = "multi_view_grid" | "character_sheet" | "scene_sheet" | "character_three_view";

type CanvasImagePresetDefinition = {
    id: CanvasImagePresetId;
    label: string;
    title: string;
    size: string;
    template: string;
    disableAutoMultiView?: boolean;
};

const REFERENCE_TOKEN_PATTERN = /@\[node:[^\]]+\]/g;

export const canvasImagePresetOptions: Array<{ value: CanvasImagePresetId; label: string }> = [
    { value: "multi_view_grid", label: "多机位九宫格" },
    { value: "character_sheet", label: "角色设定图" },
    { value: "scene_sheet", label: "场景设定图" },
    { value: "character_three_view", label: "角色三视图" },
];

const presetDefinitions: Record<CanvasImagePresetId, CanvasImagePresetDefinition> = {
    multi_view_grid: {
        id: "multi_view_grid",
        label: "多机位九宫格",
        title: "多机位九宫格",
        size: "16:9",
        disableAutoMultiView: true,
        template: [
            "生成一张 3x3 九宫格多机位参考图，九个画面必须是同一主体、同一服装或同一场景，只改变镜头机位与景别，不要生成九个不同的人或九个不同场景。",
            "画面要求像电影分镜板，九格边界明确，构图稳定，风格统一，适合后续挑图做分镜参考。",
            "镜头顺序建议包含：正面中景、正面近景、正面全景、左侧 45 度、右侧 45 度、侧面特写、俯视、高机位广角、背面或反打视角。",
            "不要单张大图，不要 2x2 四宫格，不要自由拼贴，不要文字、水印、logo。",
        ].join("\n"),
    },
    character_sheet: {
        id: "character_sheet",
        label: "角色设定图",
        title: "角色设定图",
        size: "16:9",
        template: [
            "请以附图中的人物/角色作为最重要参考，制作一张能看出是同一人物/同一角色的角色设定图。",
            "如果附图是实写风格，则保持实写风格；如果是插画/动画/漫画/3D/变形风格，则维持其画风、线条、涂法、质感、变形程度。请勿擅自改为实写、插画或其他画风。",
            "目的不是用于个人简介，而是用于角色制作、AI 图像生成、模型固定的视觉资料。无需添加姓名、年龄、性格、爱好、说明文等个人简介元素。图内文字仅限于用简短的中文标签标注各面板，请勿使用英文或其他语言标注。",
            "图像形式：16:9 的横长单幅图。白色至浅灰色背景。高分辨率。以细线条或方框整理成易读的角色设定图风格布局。",
            "最重要条件：请忠实再现原图的面部、眼睛、眉毛、鼻子、嘴巴、轮廓、发型、发色、皮肤或涂法的质感、体型、氛围、服装的印象。请勿改为其他人/其他角色。禁止过度美化、简化、体型变更、面部重塑。原图中出现的一次性小物件、食物、背景、姿势、手持物品，除非对角色设定有必要，否则请排除。",
            "服装：如果原图的服装明确，则保持不变。如果无法看清全身，则以原图氛围相符的自然服装进行补充。正面、侧面、背面请统一使用相同的服装、发型、体型。请避免过度暴露、内衣、泳装、性感服装。",
            "纳入内容：【全身】正面、侧面、背面；【脸部特写】正面、侧脸、斜侧 45 度；【表情】平常、微笑、呵呵笑、认真、惊讶、害羞、思考中、苦恼脸；【脸部部件】眼睛、眉毛、鼻子、嘴巴、耳朵、轮廓、皮肤、质感；【头发细节】刘海、侧发、后发、发丝流动；【其他角度】斜左、斜右、从上、从下、后脑部。",
            "布局：作为资料要易读，留出整齐的空白，以方框整理各项内容。请勿做成杂志简介风、简历风、海报风。请勿加入长篇说明，仅用中文的简短标签。",
            "负面指定：其他人、其他角色、面部改变、画风改变、擅自实写化、擅自动画化、发型变更、发色变更、服装不统一、体型变更、过度美化、过度简化、简介文、姓名、年龄、性格、爱好、英文标签、其他语言标签、长篇说明、文字乱码、难读文字、粗糙布局、低分辨率、面部扭曲、奇怪的眼睛、手部崩坏、指部崩坏、重复的脸、性感服装、内衣、泳装、不必要的小物件、嘴里含食物、随机物体、杂乱背景。",
            "如果画面中生成任何文字，必须全部使用清晰、可读的中文。",
        ].join("\n"),
    },
    scene_sheet: {
        id: "scene_sheet",
        label: "场景设定图",
        title: "场景设定图",
        size: "16:9",
        template: [
            "生成一张场景设定图。",
            "场景名：请填写。",
            "用途：作为后续人物合成、分镜和视频生成的统一场景底图。",
            "画面要求：单一场景空镜，不出现人物、不出现手部、不出现对白字幕和水印；要清楚交代前景、中景、背景、出入口、灯光、墙面、地面、桌椅和关键道具的位置。",
            "风格要求：真实材质、真实透视、真实光影，画面干净，方便后续连续复用。",
        ].join("\n"),
    },
    character_three_view: {
        id: "character_three_view",
        label: "角色三视图",
        title: "角色三视图",
        size: "9:16",
        template: [
            "生成同一角色三视图。",
            "角色名：请填写。",
            "身份/年龄感：请填写。",
            "采用竖版三段式或清晰分栏，展示正面、侧面、背面三视图。",
            "三视图必须保持同一发型、同一服装、同一道具、同一体型比例，白色或浅灰背景，适合角色设计定版。",
            "不要文字、水印、logo，不要多个不同角色。",
        ].join("\n"),
    },
};

export function getImagePresetDefinition(presetId: CanvasImagePresetId) {
    return presetDefinitions[presetId];
}

export function buildImagePresetPatch(presetId: CanvasImagePresetId, currentMetadata?: CanvasNodeMetadata, inputs: NodeGenerationInput[] = []): Partial<CanvasNodeMetadata> {
    const preset = presetDefinitions[presetId];
    const references = buildReferenceBlock(currentMetadata, inputs);
    const composerContent = [references, preset.template].filter(Boolean).join("\n\n");
    return {
        imagePreset: preset.id,
        composerContent,
        prompt: composerContent,
        size: preset.size,
        count: 1,
        disableAutoMultiView: Boolean(preset.disableAutoMultiView),
        enableMultiViewGrid: false,
    };
}

function buildReferenceBlock(currentMetadata: CanvasNodeMetadata | undefined, inputs: NodeGenerationInput[]) {
    const tokens = extractReferenceTokens(currentMetadata, inputs);
    if (!tokens.length) return "";
    return `已连接参考素材：${tokens.join(" ")}`;
}

function extractReferenceTokens(currentMetadata: CanvasNodeMetadata | undefined, inputs: NodeGenerationInput[]) {
    const unique = new Set<string>();
    for (const text of [currentMetadata?.composerContent, currentMetadata?.prompt]) {
        for (const match of text?.match(REFERENCE_TOKEN_PATTERN) || []) unique.add(match);
    }
    if (!unique.size) {
        for (const input of inputs) unique.add(`@[node:${input.nodeId}]`);
    }
    return Array.from(unique);
}

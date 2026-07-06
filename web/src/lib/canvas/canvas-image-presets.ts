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
            "生成一张 16:9 电影感角色身份板，效果必须接近参考示例：深色艺术书页面、金色/米白中文信息文字、细线分区边框、主图 + 多角度 + 剪影 + 表情 + 细节特写 + 身份信息。",
            "如果已有参考图，严格沿用参考图中的同一人物脸型、发型、服装、气质和标志物，不要变成另一个人；如果没有参考图，则按输入人物描述生成。",
            "版式：左侧为角色标题和身份文字区，中左为同一角色的大幅全身/半身主视觉，右侧上方为“角度展示”6格，包含正面、侧身、转身回望、动作姿态、仰拍或低角度、背影。",
            "右侧中部为“剪影展示”3个黑色剪影；右侧中部/下方为“表情特写”3格；底部为“细节特写”3到4格，展示发丝、服装纹理、皮肤毛孔、标志道具等。",
            "左侧和右下角要有设计好的中文身份信息：名称、身份、情绪、标志、角色设定。文字要像设定集排版的一部分，清晰但不要喧宾夺主。",
            "整体风格：真人写实摄影风，电影感光影，真实皮肤纹理和毛孔，真实服装/道具材质，背景有氛围但不抢主体。",
            "禁止：普通照片拼贴、白底证件照排版、时尚杂志写真、随机乱码文字、水印、logo、多个不同角色、动漫、插画、过度磨皮、塑料皮肤。",
            "可按下面变量继续补充：角色名、身份、情绪、标志、发型、服装、场景、细节特写重点。",
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

import { nanoid } from "nanoid";

import { CanvasNodeType, type CanvasNodeData, type CanvasNodeMetadata, type Position } from "@/types/canvas";

type MangaCharacter = {
    name: string;
    role: string;
    prompts: {
        portrait: string;
        threeView: string;
        expressionSheet: string;
    };
};

type PromptTask = {
    id: string;
    title: string;
    prompt: string;
    size: "9:16" | "16:9";
    x: number;
    y: number;
};

const CARD_FIELD_LABELS = ["核心人设", "视觉锚点", "AI标签组", "情绪表情库", "可复制人物图提示词", "image", "人物立绘", "人物三视图", "人物表情表", "midjourney_image", "midjourney_three_view"];

export function buildMangaCharacterPromptNodes({
    text,
    center,
    model,
    quality,
}: {
    text: string;
    center: Position;
    model: string;
    quality: string;
}) {
    const characters = parseMangaCharacterCard(text);
    const tasks = characters.flatMap((character, row) => buildPromptTasks(character, row));

    const nodes: CanvasNodeData[] = tasks.map((task) => {
        const metadata: CanvasNodeMetadata = {
            generationMode: "image",
            generationType: "generation",
            model,
            quality,
            size: task.size,
            count: 1,
            composerContent: task.prompt,
            prompt: task.prompt,
            status: "idle",
            disableAutoMultiView: true,
        };
        return {
            id: task.id,
            type: CanvasNodeType.Config,
            title: task.title,
            position: {
                x: center.x + task.x,
                y: center.y + task.y,
            },
            width: 340,
            height: 240,
            metadata,
        };
    });

    return { characters, nodes };
}

function parseMangaCharacterCard(text: string): MangaCharacter[] {
    const jsonCharacters = parseJsonCharacters(text);
    if (jsonCharacters.length) return jsonCharacters;
    return parseTextCharacters(text);
}

function parseJsonCharacters(text: string): MangaCharacter[] {
    const data = safeJson(text);
    if (!data || !Array.isArray(data.characters)) return [];

    return data.characters
        .map((character: Record<string, unknown>, index: number) => {
            const prompts = asRecord(character.copy_ready_image_prompts) || asRecord(character.prompts) || {};
            const name = clean(character.name) || `角色${index + 1}`;
            const role = clean(character.role);
            return {
                name,
                role,
                prompts: {
                    portrait: clean(prompts.image) || clean(prompts.portrait) || fallbackPrompt(name, role, "portrait"),
                    threeView: clean(prompts["人物三视图"]) || clean(prompts.three_view) || fallbackPrompt(name, role, "threeView"),
                    expressionSheet: clean(prompts["人物表情表"]) || clean(prompts.expression_sheet) || fallbackPrompt(name, role, "expressionSheet"),
                },
            };
        })
        .filter((character: MangaCharacter) => character.prompts.portrait || character.prompts.threeView || character.prompts.expressionSheet);
}

function parseTextCharacters(text: string): MangaCharacter[] {
    const normalized = `\n${text.trim()}`;
    const blocks = normalized.split(/\n(?=角色\s*\d+\s*[：:])/g);

    return blocks
        .map((block, index) => {
            const header = block.match(/角色\s*\d+\s*[：:]\s*([^\n（(]+)(?:[（(]([^）)]+)[）)])?/);
            if (!header) return null;
            const name = clean(header[1]) || `角色${index + 1}`;
            const role = clean(header[2]);
            return {
                name,
                role,
                prompts: {
                    portrait: fieldAfter(block, ["image", "人物立绘"]) || fallbackPrompt(name, role, "portrait"),
                    threeView: fieldAfter(block, ["人物三视图"]) || fallbackPrompt(name, role, "threeView"),
                    expressionSheet: fieldAfter(block, ["人物表情表"]) || fallbackPrompt(name, role, "expressionSheet"),
                },
            };
        })
        .filter(Boolean) as MangaCharacter[];
}

function buildPromptTasks(character: MangaCharacter, row: number): PromptTask[] {
    const roleSuffix = character.role ? `（${character.role}）` : "";
    const y = row * 300;
    const prompt = buildCharacterSheetPrompt(character);
    const tasks: PromptTask[] = [
        {
            id: `manga-prompt-${nanoid()}`,
            title: `${character.name}${roleSuffix}_角色设定图`,
            prompt,
            size: "9:16",
            x: -170,
            y,
        },
    ];
    return tasks.filter((task) => task.prompt);
}

function buildCharacterSheetPrompt(character: MangaCharacter) {
    return [
        `生成一张单个人物角色设定图，角色名：${character.name}${character.role ? `，身份：${character.role}` : ""}。`,
        "画面布局必须是横向角色设定表：左侧占约35%画面为脸部高清大特写，右侧占约65%画面为同一人物三视图。",
        "左侧脸部特写要求：正脸，五官清楚，眼睛、眉毛、鼻梁、嘴唇、脸型、胡须/妆容/皱纹等细节清晰；耳朵完整可见，不要被头发或帽子完全遮挡；头发边缘、发际线、头饰或帽冠结构完整；表情符合角色气质。",
        "右侧三视图要求：同一角色同一套服装，同一发型和标志物，正面、侧面、背面三个人物全身并列站姿；比例准确，服装纹样、腰带、鞋履、袖口、背部细节都清楚。",
        "最终画风必须严格继承下方人物立绘参考信息、三视图参考信息和表情气质参考中的视觉风格，不要自行改成其他风格。若参考信息没有明确视觉风格，默认使用仿真人短剧感：真人演员定妆照、真实皮肤纹理、真实毛孔、真实面部骨相、真实发丝、真实布料、影视剧照光影、非CG、非动漫、非3D建模。无论是仿真人、国漫、3D动漫、二次元、厚涂漫画或写实电影感，都要保持同一角色、同一服装、同一发型、同一标志物和同一画风。白色或浅灰纯背景，人物一致性强，禁止文字、水印、logo、字幕，禁止生成多个不同角色。若为仿真人短剧感，禁止动漫、二次元、3D动漫、游戏建模、CG娃娃脸、塑料皮肤、手办感、韩漫脸、插画感。",
        "",
        "人物立绘参考信息：",
        character.prompts.portrait,
        "",
        "三视图参考信息：",
        character.prompts.threeView,
        "",
        character.prompts.expressionSheet ? `表情气质参考：${character.prompts.expressionSheet}` : "",
    ]
        .filter(Boolean)
        .join("\n");
}

function fieldAfter(block: string, labels: string[]) {
    for (const label of labels) {
        const stop = CARD_FIELD_LABELS.filter((item) => item !== label).map(escapeRegExp).join("|");
        const pattern = new RegExp(`(?:^|\\n)\\s*${escapeRegExp(label)}\\s*[：:]\\s*([\\s\\S]*?)(?=\\n\\s*(?:${stop})\\s*[：:]|\\n\\s*角色\\s*\\d+\\s*[：:]|$)`);
        const match = block.match(pattern);
        const value = clean(match?.[1]);
        if (value) return value;
    }
    return "";
}

function fallbackPrompt(name: string, role: string, kind: "portrait" | "threeView" | "expressionSheet") {
    const photorealLock = "默认仿真人短剧感，真人演员定妆照，真实皮肤纹理，真实毛孔，真实面部骨相，真实发丝，真实布料，影视剧照光影，非CG、非动漫、非3D建模，不要二次元、不要3D动漫、不要游戏建模、不要塑料皮肤、不要手办感、不要韩漫脸。";
    if (kind === "threeView") return `生成同一角色三视图，角色名${name}，身份定位${role}，正面、侧面、背面三栏并列，同一发型、同一服装、同一标志物，白色或浅灰背景，角色设计保持一致，${photorealLock} 禁止文字水印，禁止生成多个不同角色。`;
    if (kind === "expressionSheet") return `生成同一角色表情表，角色名${name}，身份定位${role}，头像或半身五宫格，包含冷静、愤怒、震惊、冷笑、含泪五种表情，保持同一脸型、发型、服装和项目视觉风格，白色或浅灰背景，${photorealLock} 禁止文字水印，禁止生成多个不同角色。`;
    return `生成一张人物立绘，角色名${name}，身份定位${role}，竖版单人全身，角色居中站立，服装、发型、五官和标志物清晰，${photorealLock} 适合作为后续分镜参考图，禁止文字水印，禁止生成多个不同角色。`;
}

function safeJson(text: string) {
    const trimmed = text.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
        return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
        return null;
    }
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function clean(value: unknown) {
    return String(value || "").trim();
}

function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

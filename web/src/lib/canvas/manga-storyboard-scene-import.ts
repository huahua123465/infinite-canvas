import { nanoid } from "nanoid";

import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type CanvasNodeMetadata, type Position } from "@/types/canvas";

type SceneViewRole = "front" | "top" | "left" | "right" | "back";

type MangaScene = {
    id: string;
    title: string;
    raw: string;
    scenePrompt?: string;
    negativePrompt?: string;
};

type SceneTask = {
    id: string;
    title: string;
    prompt: string;
    x: number;
    y: number;
    width: number;
    height: number;
    sceneGroupId: string;
    viewRole: SceneViewRole;
    requiredViewRoles?: Array<"front" | "top">;
};

type AngleSpec = {
    key: "top" | "left" | "right" | "back";
    label: string;
    x: number;
    y: number;
};

const ANGLE_SPECS: AngleSpec[] = [
    { key: "top", label: "Top-down View", x: 0, y: -170 },
    { key: "back", label: "Back / Reverse View", x: 360, y: -170 },
    { key: "left", label: "Left Side View", x: 0, y: 110 },
    { key: "right", label: "Right Side View", x: 360, y: 110 },
];

const SCENE_PROMPT_LABELS = [
    "scene_prompt",
    "场景主视图提示词",
    "分镜头场景提示词",
    "场景提示词",
    "场景图主视图提示词",
    "场景图提示词",
    "场景空镜提示词",
    "环境图提示词",
    "主视图提示词",
];

export function buildMangaScenePromptNodes({
    text,
    fileName,
    center,
    model,
    quality,
}: {
    text: string;
    fileName?: string;
    center: Position;
    model: string;
    quality: string;
}) {
    const episodeLabel = episodeFromFileName(fileName || "") || episodeFromText(text);
    const scenes = parseMangaScenes(text);
    const nodeBundles = scenes.map((scene, index) =>
        buildSceneNodeBundle({
            scene,
            index,
            episodeLabel,
            center,
            model,
            quality,
        }),
    );

    const nodes: CanvasNodeData[] = nodeBundles.flatMap((bundle) => bundle.nodes);
    const connections: CanvasConnection[] = nodeBundles.flatMap((bundle) => bundle.connections);

    return { scenes, nodes, connections };
}

function parseMangaScenes(text: string): MangaScene[] {
    const normalized = text.replace(/\r\n/g, "\n").trim();
    if (!normalized) return [];

    const jsonScenes = parseJsonScenes(normalized);
    if (jsonScenes.length) return jsonScenes;

    const headings = findSceneHeadings(normalized);
    if (!headings.length) {
        return [
            {
                id: "Scene01",
                title: "Scene01",
                raw: normalized,
                scenePrompt: extractScenePromptSource(normalized),
            },
        ];
    }

    return headings.map((heading, index) => {
        const next = headings[index + 1]?.index ?? normalized.length;
        const raw = normalized.slice(heading.index, next).trim();
        return {
            id: heading.id,
            title: cleanTitle(heading.heading, heading.id),
            raw,
            scenePrompt: extractScenePromptSource(raw),
        };
    });
}

function parseJsonScenes(text: string): MangaScene[] {
    const data = safeJson(text);
    if (!data) return [];

    const candidates = findShotScenePromptArrays(data);
    const scenes: MangaScene[] = [];
    candidates.flatMap((items) => items).forEach((item, index) => {
        if (!item || typeof item !== "object") return;
        const record = item as Record<string, unknown>;
        const id = clean(record.shot_id) || clean(record.id) || clean(record.scene_ref) || `Scene${String(index + 1).padStart(2, "0")}`;
        const title = clean(record.scene_name) || clean(record.title) || clean(record.space_summary) || id;
        const prompt = clean(record.scene_prompt) || clean(record.prompt) || buildPromptFromJsonRecord(record);
        if (!prompt && !Object.keys(record).length) return;
        scenes.push({
            id,
            title,
            raw: JSON.stringify(record, null, 2),
            scenePrompt: prompt,
            negativePrompt: clean(record.negative_prompt),
        });
    });
    return scenes;
}

function buildSceneNodeBundle({
    scene,
    index,
    episodeLabel,
    center,
    model,
    quality,
}: {
    scene: MangaScene;
    index: number;
    episodeLabel: string;
    center: Position;
    model: string;
    quality: string;
}) {
    const groupColumn = index % 2;
    const groupRow = Math.floor(index / 2);
    const sceneGroupId = `scene-group-${nanoid()}`;
    const baseX = groupColumn * 1360 - 680;
    const baseY = groupRow * 720;
    const lockNode = createSceneLockNode(scene, episodeLabel, sceneGroupId, { x: center.x + baseX, y: center.y + baseY + 130 });
    const frontTask = buildFrontSceneTask(scene, episodeLabel, sceneGroupId, baseX + 450, baseY + 160);
    const angleTasks = ANGLE_SPECS.map((angle) =>
        buildAngleSceneTask(scene, episodeLabel, sceneGroupId, frontTask, angle, baseX + 870 + angle.x, baseY + angle.y + 180),
    );
    const configNodes = [frontTask, ...angleTasks].map((task) =>
        createConfigNode(
            task,
            {
                x: center.x + task.x,
                y: center.y + task.y,
            },
            model,
            quality,
        ),
    );

    const frontConfigNode = configNodes[0];
    const topConfigNode = configNodes[1];
    const sideConfigNodes = configNodes.slice(2);
    const connections: CanvasConnection[] = [
        ...configNodes.map((node) => ({
            id: nanoid(),
            fromNodeId: lockNode.id,
            toNodeId: node.id,
        })),
        ...configNodes.slice(1).map((node) => ({
            id: nanoid(),
            fromNodeId: frontConfigNode.id,
            toNodeId: node.id,
        })),
        ...sideConfigNodes.map((node) => ({
            id: nanoid(),
            fromNodeId: topConfigNode.id,
            toNodeId: node.id,
        })),
    ];

    return { nodes: [lockNode, ...configNodes], connections };
}

function createSceneLockNode(scene: MangaScene, episodeLabel: string, sceneGroupId: string, position: Position): CanvasNodeData {
    const content = buildSceneLockText(scene);
    return {
        id: `manga-scene-lock-${nanoid()}`,
        type: CanvasNodeType.Text,
        title: `${episodeLabel ? `${episodeLabel}_` : ""}${scene.id}_Scene Lock`,
        position,
        width: 390,
        height: 320,
        metadata: {
            content,
            prompt: content,
            status: "success",
            fontSize: 13,
            sceneViewRole: "lock",
            sceneGroupId,
        },
    };
}

function buildFrontSceneTask(scene: MangaScene, episodeLabel: string, sceneGroupId: string, x: number, y: number): SceneTask {
    return {
        id: `manga-scene-front-${nanoid()}`,
        title: `${episodeLabel ? `${episodeLabel}_` : ""}${scene.id}_Front View`,
        prompt: buildFrontScenePrompt(scene),
        x,
        y,
        width: 390,
        height: 260,
        sceneGroupId,
        viewRole: "front",
    };
}

function buildAngleSceneTask(
    scene: MangaScene,
    episodeLabel: string,
    sceneGroupId: string,
    frontTask: SceneTask,
    angle: AngleSpec,
    x: number,
    y: number,
): SceneTask {
    return {
        id: `manga-scene-${angle.key}-${nanoid()}`,
        title: `${episodeLabel ? `${episodeLabel}_` : ""}${scene.id}_${angle.label}`,
        prompt: buildAnglePrompt(scene, frontTask.prompt, angle),
        x,
        y,
        width: 330,
        height: 230,
        sceneGroupId,
        viewRole: angle.key,
        requiredViewRoles: angle.key === "top" ? ["front"] : ["front", "top"],
    };
}

function createConfigNode(task: SceneTask, position: Position, model: string, quality: string): CanvasNodeData {
    const metadata: CanvasNodeMetadata = {
        generationMode: "image",
        generationType: "generation",
        model,
        quality,
        size: "9:16",
        count: 1,
        composerContent: task.prompt,
        prompt: task.prompt,
        status: "idle",
        sceneViewRole: task.viewRole,
        sceneGroupId: task.sceneGroupId,
        requiredSceneViewRoles: task.requiredViewRoles,
    };

    return {
        id: task.id,
        type: CanvasNodeType.Config,
        title: task.title,
        position,
        width: task.width,
        height: task.height,
        metadata,
    };
}

function buildSceneLockText(scene: MangaScene) {
    const source = sanitizeSingleViewPrompt(scene.scenePrompt || extractScenePromptSource(scene.raw));
    return [
        `SCENE LOCK CARD: ${scene.id} ${scene.title}`,
        "",
        "This text is the single source of truth for every generated view of this scene.",
        "Keep the same location, architecture, object list, object positions, materials, color palette, lighting direction, and atmosphere in every view.",
        "Do not add new doors, windows, furniture, plants, props, wall decorations, lamps, or layout changes unless they are explicitly present in this lock card.",
        "Do not remove or relocate key objects. Only the camera/view angle may change.",
        "",
        "Original scene prompt:",
        trimForPrompt(source, 1600),
        "",
        scene.negativePrompt ? `Negative constraints: ${scene.negativePrompt}` : "Negative constraints: no people, no characters, no hands, no captions, no text, no watermark, no logo, no random extra props, no layout drift.",
    ].join("\n");
}

function buildFrontScenePrompt(scene: MangaScene) {
    return [
        `Generate the FRONT VIEW master image for scene ${scene.id}: ${scene.title}.`,
        "Use the connected SCENE LOCK CARD as the authoritative scene identity.",
        "Environment-only shot. No people, no characters, no hands, no subtitles, no visible text, no watermark, no logo.",
        "Camera: straight-on front view, stable eye-level composition, no oblique angle, no top-down view, no side view, no wide-angle distortion.",
        "Priority: make the architecture and object positions readable. Show the key walls, openings, large furniture, practical lights, floor boundaries, and depth layers clearly.",
        "Visual style should remain photorealistic / live-action set reference unless the scene lock card explicitly says otherwise.",
        "This front view will become the visual anchor for all later top/side views, so preserve a clear and complete spatial identity.",
        "",
        buildSceneLockText(scene),
    ].join("\n");
}

function buildAnglePrompt(scene: MangaScene, frontPrompt: string, angle: AngleSpec) {
    const camera =
        angle.key === "top"
            ? "true orthographic top-down floor plan, camera looking straight down at 90 degrees, ceiling removed, no perspective depth"
            : angle.key === "back"
              ? "orthographic reverse/back view, camera rotated 180 degrees from the front view, looking at the opposite wall"
              : `orthographic ${angle.key} side elevation, camera rotated exactly 90 degrees from the front view`;
    const referenceRule =
        angle.key === "top"
            ? "Reference image rule: use the connected front-view image only for style, materials, lighting mood, object identity, and scale. Do not copy the front camera angle."
            : "Reference image rule: use the connected front-view image for style and object identity, and the connected top-down image for layout and object positions. Do not copy either reference camera angle.";

    return [
        `Generate the ${angle.label.toUpperCase()} derived scene image for ${scene.id}: ${scene.title}.`,
        "Use the connected SCENE LOCK CARD as the authoritative scene identity.",
        "Environment-only shot. No people, no characters, no hands, no subtitles, no visible text, no watermark, no logo.",
        `Camera: ${camera}.`,
        referenceRule,
        "Keep the same location, architecture, object list, object positions, materials, color palette, lighting direction, and atmosphere.",
        "Do not add new doors, windows, furniture, plants, props, wall decorations, lamps, or layout changes unless explicitly present in the lock card.",
        "This is a single-view image, not a collage, not a split-screen grid, not a multi-view sheet.",
        "",
        "Sanitized front-view anchor prompt:",
        trimForPrompt(sanitizeSingleViewPrompt(frontPrompt), 900),
        "",
        buildSceneLockText(scene),
    ].join("\n");
}

function findShotScenePromptArrays(value: unknown): Array<Array<unknown>> {
    if (!value || typeof value !== "object") return [];
    if (Array.isArray(value)) return [];

    const record = value as Record<string, unknown>;
    const direct = record.shot_scene_prompts;
    const result: Array<Array<unknown>> = Array.isArray(direct) ? [direct] : [];

    for (const child of Object.values(record)) {
        if (child && typeof child === "object") {
            result.push(...findShotScenePromptArrays(child));
        }
    }
    return result;
}

function buildPromptFromJsonRecord(record: Record<string, unknown>) {
    const lines = [
        clean(record.visual_style) ? `visual_style: ${clean(record.visual_style)}` : "",
        clean(record.visual_mood) ? `visual_mood: ${sanitizeSingleViewPrompt(clean(record.visual_mood))}` : "",
        clean(record.space_summary),
        clean(record.time),
        clean(record.interior_exterior),
        arrayText(record.visual_elements),
        clean(record.lighting),
        clean(record.camera),
        clean(record.shot_purpose),
    ].filter(Boolean);
    return lines.join("\n");
}

function sanitizeSingleViewPrompt(text: string) {
    return text
        .replace(/\(?\s*2x2\s+split\s+screen\s+grid\s*,?\s*/gi, "")
        .replace(/\(?\s*multi-view\s*:\s*[\d.]+\)?\s*,?\s*/gi, "")
        .replace(/4\s+different\s+angles\s+of\s+the\s+same\s+scene\s*,?\s*/gi, "")
        .replace(/top-left\s+is\s+front\s+view\s*,?\s*/gi, "")
        .replace(/top-right\s+is\s+top-down\s+view\s*,?\s*/gi, "")
        .replace(/bottom-left\s+is\s+left\s+side\s+view\s*,?\s*/gi, "")
        .replace(/bottom-right\s+is\s+right\s+side\s+view\s*,?\s*/gi, "")
        .replace(/\s*,\s*,+/g, ", ")
        .replace(/,\s*([。；;])/g, "$1")
        .replace(/\s{2,}/g, " ")
        .trim();
}

function findSceneHeadings(text: string) {
    const headings: Array<{ id: string; index: number; heading: string }> = [];
    const lines = text.split("\n");
    let offset = 0;

    for (const line of lines) {
        const heading = line.trim();
        const id = sceneIdFromHeadingLine(heading);
        if (id) {
            headings.push({
                id,
                index: offset + line.search(/\S/),
                heading,
            });
        }
        offset += line.length + 1;
    }

    const seen = new Set<string>();
    return headings.filter((heading) => {
        const key = `${heading.id}-${heading.index}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function sceneIdFromHeadingLine(line: string) {
    if (!line) return "";
    if (/^(对应剧本场次|场景名称|镜头目的|画面类型|人物策略|时间|空间|空间概述|关键环境元素|光影|镜头|负面约束)\s*[:：]/.test(line)) return "";

    const matches = Array.from(line.matchAll(/(^|[^\d])([1-9]\d{0,2}-[1-9]\d{0,2}(?:-\d{2,3})?)(?!\d)/g));
    for (const match of matches) {
        const id = match[2];
        const start = (match.index || 0) + match[1].length;
        const nextChar = line[start + id.length] || "";
        if (/^[sS秒]/.test(nextChar)) continue;

        const prefix = line.slice(0, start).trim();
        const idNearStart = start <= 24;
        const hasSceneKeyword = /(?:场景|镜头|分镜|编号|scene|shot)/i.test(line);
        const looksLikeMarkdownHeading = /^#{1,6}\s*/.test(line);
        const looksLikePlainSceneHeading = idNearStart && line.length <= 100;
        const looksLikeBracketHeading = /[【\[][^【\[]*$/.test(prefix) || /[】\]]\s*$/.test(prefix);

        if (hasSceneKeyword || looksLikeMarkdownHeading || looksLikePlainSceneHeading || looksLikeBracketHeading) {
            return id;
        }
    }

    const simple = line.match(/^(?:场景|scene)\s*([0-9]{1,3})/i);
    return simple ? `Scene${simple[1].padStart(2, "0")}` : "";
}

function extractScenePromptSource(raw: string) {
    const explicit = pickSection(raw, SCENE_PROMPT_LABELS);
    if (explicit) return explicit;

    const sceneInfo = pickSection(raw, ["[场景设定]", "【场景设定】", "场景设定", "场景描述", "环境描述"]);
    const lightingInfo = pickSection(raw, ["[光影与氛围]", "【光影与氛围】", "光影与氛围", "光影氛围"]);
    const mainViewInfo = collectSceneDescriptionLines(raw);
    const source = [sceneInfo, lightingInfo, mainViewInfo].filter(Boolean).join("\n");
    return source || raw;
}

function collectSceneDescriptionLines(raw: string) {
    const lines = raw
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    const useful: string[] = [];

    for (const line of lines) {
        if (!/(视觉风格|统一视觉风格|画面|构图|背景|环境|空间|光影|氛围|室内|室外|房间|窗|灯|墙|门|床|桌|椅|柜|地面|走廊|大厅|基地|办公室|废墟|城市|街道)/.test(line)) continue;
        if (/(台词|对白|对应剧本|动作表情|站位|调度|可复制.*AI提示词|Seedance|视频|配音|字幕|BGM|音效)/i.test(line)) continue;
        useful.push(stripSceneLineLabel(line));
        if (useful.join("\n").length > 1200) break;
    }

    return useful.join("\n");
}

function stripSceneLineLabel(line: string) {
    return line.replace(/^(视觉风格|统一视觉风格|画面|构图|背景|环境|空间|光影氛围|光影与氛围|场景设定|场景描述)\s*[:：]\s*/, "");
}

function pickSection(text: string, labels: string[]) {
    for (const label of labels) {
        const escaped = escapeRegExp(label);
        const pattern = new RegExp(`${escaped}\\s*[:：]?\\s*\\n([\\s\\S]*?)(?=\\n\\s*(?:\\[[^\\]]+\\]|【[^】]+】|[\\u4e00-\\u9fa5_a-zA-Z]{2,24}\\s*[:：])|$)`, "i");
        const match = text.match(pattern);
        if (match?.[1]?.trim()) return `${label}\n${match[1].trim()}`;
    }
    return "";
}

function cleanTitle(heading: string, id: string) {
    return (
        heading
            .replace(/^#+\s*/, "")
            .replace(/[【】]/g, "")
            .replace(id, "")
            .replace(/^[\s:：\-_.,，。]+/, "")
            .trim() || id
    );
}

function episodeFromFileName(fileName: string) {
    const match = fileName.match(/第\s*0*(\d+)\s*集/);
    return match ? `第${match[1].padStart(2, "0")}集` : "";
}

function episodeFromText(text: string) {
    const match = text.match(/第\s*0*(\d+)\s*集/);
    return match ? `第${match[1].padStart(2, "0")}集` : "";
}

function trimForPrompt(value: string, maxLength: number) {
    const trimmed = value.trim();
    return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}\n...` : trimmed;
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

function clean(value: unknown): string {
    if (Array.isArray(value)) return value.map(clean).filter(Boolean).join(", ");
    return String(value || "").trim();
}

function arrayText(value: unknown) {
    return Array.isArray(value) ? value.map(clean).filter(Boolean).join("\n") : clean(value);
}

function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

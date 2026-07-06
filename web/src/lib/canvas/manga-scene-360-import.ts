import { nanoid } from "nanoid";

import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type CanvasNodeMetadata, type Position } from "@/types/canvas";

type SceneViewRole = "front_left_45" | "front" | "front_right_45" | "left" | "top" | "right" | "back_left_45" | "back" | "back_right_45";

type Scene360Object = {
    name: string;
    position?: string;
    visible_in?: string[];
};

type Scene360 = {
    id: string;
    title: string;
    raw: string;
    styleLock: string;
    globalLayout: string;
    frontWall: string;
    backWall: string;
    leftWall: string;
    rightWall: string;
    frontLeft45: string;
    frontRight45: string;
    backLeft45: string;
    backRight45: string;
    floorPlan: string;
    fixedObjects: Scene360Object[];
    negativeLock: string;
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
    key: SceneViewRole;
    label: string;
    x: number;
    y: number;
};

const ANGLE_SPECS: AngleSpec[] = [
    { key: "front_left_45", label: "Front-Left 45 View", x: 0, y: 0 },
    { key: "front", label: "Front View", x: 330, y: 0 },
    { key: "front_right_45", label: "Front-Right 45 View", x: 660, y: 0 },
    { key: "left", label: "Left Side View", x: 0, y: 250 },
    { key: "top", label: "Top-down View", x: 330, y: 250 },
    { key: "right", label: "Right Side View", x: 660, y: 250 },
    { key: "back_left_45", label: "Back-Left 45 View", x: 0, y: 500 },
    { key: "back", label: "Back / Reverse View", x: 330, y: 500 },
    { key: "back_right_45", label: "Back-Right 45 View", x: 660, y: 500 },
];

export function buildScene360PromptNodes({
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
    const scenes = parseScene360Text(text, fileName);
    const bundles = scenes.map((scene, index) => buildSceneBundle(scene, index, center, model, quality));
    return {
        scenes,
        nodes: bundles.flatMap((bundle) => bundle.nodes),
        connections: bundles.flatMap((bundle) => bundle.connections),
    };
}

function parseScene360Text(text: string, fileName?: string): Scene360[] {
    const data = safeJson(text);
    if (data) {
        const record = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
        const items: unknown[] = Array.isArray(data) ? data : Array.isArray(record?.scenes) ? record.scenes : Array.isArray(record?.scene_360_locks) ? record.scene_360_locks : [data];
        if (!items.length || isScene360DiagnosticPayload(data)) return [];
        const scenes = items.map((item, index) => normalizeScene360(item, index)).filter((scene): scene is Scene360 => Boolean(scene));
        if (scenes.length) return scenes;
        return [];
    }

    if (isScene360DiagnosticText(text)) return [];
    const title = fileName?.replace(/\.[^.]+$/, "") || "Scene360";
    return [
        {
            id: "Scene360-01",
            title,
            raw: text,
            styleLock: "",
            globalLayout: text,
            frontWall: "",
            backWall: "",
            leftWall: "",
            rightWall: "",
            frontLeft45: "",
            frontRight45: "",
            backLeft45: "",
            backRight45: "",
            floorPlan: text,
            fixedObjects: [],
            negativeLock: "no people, no characters, no text, no watermark, no logo, no random extra objects, no layout drift",
        },
    ];
}

function normalizeScene360(value: unknown, index: number): Scene360 | null {
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    const id = pickString(record, ["scene_id", "id", "scene_ref"]) || `Scene360-${String(index + 1).padStart(2, "0")}`;
    const title = pickString(record, ["scene_name", "title", "space_summary"]) || id;
    const fixedObjectsRaw = record.fixed_objects || record.objects || record.props || [];
    const fixedObjects = Array.isArray(fixedObjectsRaw)
        ? fixedObjectsRaw.map((item) => normalizeObject(item)).filter((item): item is Scene360Object => Boolean(item))
        : [];
    const scene: Scene360 = {
        id,
        title,
        raw: JSON.stringify(value, null, 2),
        styleLock: sanitizeSingleViewPrompt(pickString(record, ["style_lock", "visual_style", "style", "visual_mood"])),
        globalLayout: sanitizeSingleViewPrompt(pickString(record, ["global_layout", "layout", "space_summary", "scene_prompt", "prompt"])),
        frontWall: sanitizeSingleViewPrompt(pickString(record, ["front_wall", "frontWall", "front_view", "frontView", "main_view", "mainView", "主视图", "正视图"])),
        backWall: sanitizeSingleViewPrompt(pickString(record, ["back_wall", "backWall", "reverse_wall", "reverseWall", "opposite_wall", "oppositeWall", "back_view", "backView", "背面视图", "后视图"])),
        leftWall: sanitizeSingleViewPrompt(pickString(record, ["left_wall", "leftWall", "left_view", "leftView", "左视图"])),
        rightWall: sanitizeSingleViewPrompt(pickString(record, ["right_wall", "rightWall", "right_view", "rightView", "右视图"])),
        frontLeft45: sanitizeSingleViewPrompt(pickString(record, ["front_left_45", "frontLeft45", "front_left_view", "frontLeftView", "front_left_diagonal", "frontLeftDiagonal", "left_front_45", "左前45度"])),
        frontRight45: sanitizeSingleViewPrompt(pickString(record, ["front_right_45", "frontRight45", "front_right_view", "frontRightView", "front_right_diagonal", "frontRightDiagonal", "right_front_45", "右前45度"])),
        backLeft45: sanitizeSingleViewPrompt(pickString(record, ["back_left_45", "backLeft45", "back_left_view", "backLeftView", "back_left_diagonal", "backLeftDiagonal", "left_back_45", "左后45度"])),
        backRight45: sanitizeSingleViewPrompt(pickString(record, ["back_right_45", "backRight45", "back_right_view", "backRightView", "back_right_diagonal", "backRightDiagonal", "right_back_45", "右后45度"])),
        floorPlan: sanitizeSingleViewPrompt(pickString(record, ["floor_plan", "top_down_layout", "spatial_layout", "plan"])),
        fixedObjects,
        negativeLock: sanitizeSingleViewPrompt(pickString(record, ["negative_lock", "negative_prompt", "constraints"])) || "no people, no characters, no text, no watermark, no logo, no random extra objects, no layout drift",
    };
    return scene.globalLayout || scene.floorPlan || scene.frontWall || scene.fixedObjects.length ? scene : null;
}

function isScene360DiagnosticPayload(data: unknown) {
    if (!data || typeof data !== "object" || Array.isArray(data)) return false;
    const record = data as Record<string, unknown>;
    const locks = record.scene_360_locks;
    const diagnosis = typeof record.diagnosis === "string" ? record.diagnosis : "";
    return Array.isArray(locks) && locks.length === 0 && /no scene_360_locks|did not output the scene 360 lock contract/i.test(diagnosis);
}

function isScene360DiagnosticText(text: string) {
    return /scene_360_locks\s*:\s*\[\s*\]/i.test(text) && /did not output the scene 360 lock contract|no scene_360_locks/i.test(text);
}

function normalizeObject(value: unknown): Scene360Object | null {
    if (typeof value === "string") return { name: value };
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    const name = pickString(record, ["name", "object", "item", "label"]);
    if (!name) return null;
    return {
        name,
        position: pickString(record, ["position", "location", "placement"]),
        visible_in: Array.isArray(record.visible_in) ? record.visible_in.map((item) => String(item)) : undefined,
    };
}

function buildSceneBundle(scene: Scene360, index: number, center: Position, model: string, quality: string) {
    const groupColumn = index % 2;
    const groupRow = Math.floor(index / 2);
    const sceneGroupId = `scene-360-${nanoid()}`;
    const baseX = groupColumn * 1760 - 860;
    const baseY = groupRow * 980 - 340;
    const lockNode = createLockNode(scene, sceneGroupId, { x: center.x + baseX, y: center.y + baseY + 230 });
    const tasks = ANGLE_SPECS.map((angle) => (angle.key === "front" ? buildFrontTask(scene, sceneGroupId, baseX + 470 + angle.x, baseY + angle.y) : buildAngleTask(scene, sceneGroupId, angle, baseX + 470 + angle.x, baseY + angle.y)));
    const configNodes = tasks.map((task) => createConfigNode(task, { x: center.x + task.x, y: center.y + task.y }, model, quality));

    const frontConfig = configNodes.find((node) => node.metadata?.sceneViewRole === "front");
    const topConfig = configNodes.find((node) => node.metadata?.sceneViewRole === "top");
    const topDependentConfigs = topConfig ? [topConfig] : [];
    const orbitConfigs = configNodes.filter((node) => node.metadata?.sceneViewRole !== "front" && node.metadata?.sceneViewRole !== "top");
    const connections: CanvasConnection[] = [
        ...configNodes.map((node) => ({ id: nanoid(), fromNodeId: lockNode.id, toNodeId: node.id })),
        // Only the top-down node receives the front image. Orbit views rely on the top-down image
        // plus the text lock, otherwise image-edit models tend to copy the front camera angle.
        ...(frontConfig ? topDependentConfigs.map((node) => ({ id: nanoid(), fromNodeId: frontConfig.id, toNodeId: node.id })) : []),
        ...(topConfig ? orbitConfigs.map((node) => ({ id: nanoid(), fromNodeId: topConfig.id, toNodeId: node.id })) : []),
    ];

    return { nodes: [lockNode, ...configNodes], connections };
}

function createLockNode(scene: Scene360, sceneGroupId: string, position: Position): CanvasNodeData {
    const content = sceneLockText(scene);
    return {
        id: `scene-360-lock-${nanoid()}`,
        type: CanvasNodeType.Text,
        title: `${scene.id}_Scene 360 Lock`,
        position,
        width: 400,
        height: 520,
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

function buildFrontTask(scene: Scene360, sceneGroupId: string, x: number, y: number): SceneTask {
    return {
        id: `scene-360-front-${nanoid()}`,
        title: `${scene.id}_Front View`,
        prompt: [
            `Generate FRONT VIEW for ${scene.id}: ${scene.title}.`,
            "Use the connected Scene 360 Lock as the absolute source of truth.",
            "VIEW ROLE: FRONT VIEW ONLY.",
            "Camera: straight-on front view, stable eye-level composition, looking directly at the front_wall.",
            "Hard view lock: no top-down view, no back/reverse view, no left side view, no right side view, no diagonal angle, no 3/4 perspective.",
            "Visible direction contract:",
            directionContractText(scene, "front"),
            sharedPromptRules(scene),
        ].join("\n\n"),
        x,
        y,
        width: 300,
        height: 220,
        sceneGroupId,
        viewRole: "front",
    };
}

function buildAngleTask(scene: Scene360, sceneGroupId: string, angle: AngleSpec, x: number, y: number): SceneTask {
    const wallText = directionContractText(scene, angle.key);
    const camera =
        angle.key === "top"
            ? "true orthographic top-down floor plan, camera looking straight down at 90 degrees, ceiling removed, no perspective depth"
            : angle.key === "back"
              ? "orthographic reverse/back view, camera rotated 180 degrees from the front view, looking at the back_wall/opposite side"
              : angle.key === "left" || angle.key === "right"
                ? `orthographic ${angle.key} side elevation, camera rotated exactly 90 degrees from the front view, looking directly at the ${angle.key}_wall`
                : diagonalCamera(angle.key);
    const referenceRule =
        angle.key === "top"
            ? "Reference image rule: reference image 1 is the front-view reference. Use reference image 1 only for style, materials, lighting mood, and object identity. Do not copy reference image 1 camera angle or composition."
            : "Reference image rule: reference image 1 is the top-down/floor-plan reference. Use reference image 1 only for object placement, scale, paths, and fixed-object locations. Use the Scene 360 Lock text for style, materials, lighting, and wall details. Do not copy reference image 1 camera angle; convert the floor plan into the requested eye-level camera view. Do not use or imitate any front-view image composition.";

    return {
        id: `scene-360-${angle.key}-${nanoid()}`,
        title: `${scene.id}_${angle.label}`,
        prompt: [
            `Generate ${angle.label.toUpperCase()} for ${scene.id}: ${scene.title}.`,
            `VIEW ROLE: ${viewRoleInstruction(angle.key)}`,
            referenceRule,
            `Camera: ${camera}.`,
            viewExclusionRule(angle.key),
            "Visible direction contract:",
            wallText,
            sharedPromptRules(scene),
        ].join("\n\n"),
        x,
        y,
        width: 300,
        height: 220,
        sceneGroupId,
        viewRole: angle.key,
        requiredViewRoles: angle.key === "top" ? ["front"] : ["top"],
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

function sceneLockText(scene: Scene360) {
    return [
        `SCENE 360 LOCK: ${scene.id} ${scene.title}`,
        `style_lock: ${scene.styleLock || "photorealistic, consistent materials, consistent lighting and color"}`,
        `global_layout: ${scene.globalLayout}`,
        `floor_plan: ${scene.floorPlan}`,
        `front_wall: ${scene.frontWall}`,
        `front_left_45: ${scene.frontLeft45}`,
        `front_right_45: ${scene.frontRight45}`,
        `back_wall: ${scene.backWall}`,
        `back_left_45: ${scene.backLeft45}`,
        `back_right_45: ${scene.backRight45}`,
        `left_wall: ${scene.leftWall}`,
        `right_wall: ${scene.rightWall}`,
        fixedObjectText(scene),
        `negative_lock: ${scene.negativeLock}`,
        "",
        "Hard rule: every view must describe the same place. Do not add, remove, or relocate fixed objects. Only the camera direction changes.",
    ]
        .filter(Boolean)
        .join("\n");
}

function sharedPromptRules(scene: Scene360) {
    return [
        "Environment-only image. No people, no characters, no hands, no subtitles, no visible text, no watermark, no logo.",
        "Keep the same location, architecture, object positions, materials, lighting direction, color palette, and atmosphere in every view.",
        "Do not invent new doors, windows, furniture, plants, decorations, lamps, props, or layout changes.",
        "Only the camera direction changes. If a reference image conflicts with the requested camera direction, obey the requested VIEW ROLE and ignore the reference camera angle.",
        fixedObjectText(scene),
        `Negative constraints: ${scene.negativeLock}`,
    ]
        .filter(Boolean)
        .join("\n");
}

function directionContractText(scene: Scene360, role: SceneViewRole) {
    const direct = viewContractText(scene, role);
    if (direct) return direct;
    return [
        `Field missing for ${role}. Reconstruct this exact view from the full Scene 360 Lock instead of drawing an empty wall.`,
        scene.globalLayout ? `global_layout: ${scene.globalLayout}` : "",
        scene.floorPlan ? `floor_plan: ${scene.floorPlan}` : "",
        fixedObjectText(scene),
    ]
        .filter(Boolean)
        .join("\n");
}

function viewRoleInstruction(role: SceneViewRole) {
    if (role === "top") return "TOP-DOWN VIEW ONLY, orthographic floor plan from directly above.";
    if (role === "back") return "BACK / REVERSE VIEW ONLY, 180-degree opposite of the front view.";
    if (role === "left") return "LEFT SIDE VIEW ONLY, 90-degree left elevation relative to the front view.";
    if (role === "right") return "RIGHT SIDE VIEW ONLY, 90-degree right elevation relative to the front view.";
    if (role === "front_left_45") return "FRONT-LEFT 45-DEGREE VIEW ONLY, diagonal camera between front and left.";
    if (role === "front_right_45") return "FRONT-RIGHT 45-DEGREE VIEW ONLY, diagonal camera between front and right.";
    if (role === "back_left_45") return "BACK-LEFT 45-DEGREE VIEW ONLY, diagonal camera between back and left.";
    if (role === "back_right_45") return "BACK-RIGHT 45-DEGREE VIEW ONLY, diagonal camera between back and right.";
    return "FRONT VIEW ONLY.";
}

function viewExclusionRule(role: SceneViewRole) {
    if (role === "top") return "Forbidden: front-view perspective, eye-level camera, side elevation, reverse view, sofa-facing cinematic composition, diagonal view, 3/4 room view.";
    if (role === "back") return "Forbidden: same viewpoint as reference image 1, front view, top-down view, left side view, right side view, diagonal view, 3/4 room view. The visible wall/area must be back_wall.";
    if (role === "left") return "Forbidden: same viewpoint as reference image 1, front view, top-down view, back/reverse view, right side view, diagonal view, 3/4 room view. The visible wall/area must be left_wall.";
    if (role === "right") return "Forbidden: same viewpoint as reference image 1, front view, top-down view, back/reverse view, left side view, diagonal view, 3/4 room view. The visible wall/area must be right_wall.";
    if (role === "front_left_45") return "Forbidden: same viewpoint as reference image 1, pure front view, pure left side view, top-down view, back view. The camera must be exactly halfway between front_wall and left_wall.";
    if (role === "front_right_45") return "Forbidden: same viewpoint as reference image 1, pure front view, pure right side view, top-down view, back view. The camera must be exactly halfway between front_wall and right_wall.";
    if (role === "back_left_45") return "Forbidden: same viewpoint as reference image 1, front view, pure back view, pure left side view, top-down view. The camera must be exactly halfway between back_wall and left_wall.";
    if (role === "back_right_45") return "Forbidden: same viewpoint as reference image 1, front view, pure back view, pure right side view, top-down view. The camera must be exactly halfway between back_wall and right_wall.";
    return "Forbidden: top-down view, back/reverse view, left side view, right side view, diagonal view, 3/4 room view.";
}

function viewContractText(scene: Scene360, role: SceneViewRole) {
    if (role === "top") return scene.floorPlan;
    if (role === "back") return scene.backWall;
    if (role === "left") return scene.leftWall;
    if (role === "right") return scene.rightWall;
    if (role === "front_left_45") return scene.frontLeft45 || combineDiagonal(scene.frontWall, scene.leftWall, "front_wall and left_wall");
    if (role === "front_right_45") return scene.frontRight45 || combineDiagonal(scene.frontWall, scene.rightWall, "front_wall and right_wall");
    if (role === "back_left_45") return scene.backLeft45 || combineDiagonal(scene.backWall, scene.leftWall, "back_wall and left_wall");
    if (role === "back_right_45") return scene.backRight45 || combineDiagonal(scene.backWall, scene.rightWall, "back_wall and right_wall");
    return scene.frontWall;
}

function combineDiagonal(first: string, second: string, label: string) {
    return `Use a 45-degree diagonal composition between ${label}. First side: ${first || "not specified"}. Second side: ${second || "not specified"}.`;
}

function diagonalCamera(role: SceneViewRole) {
    if (role === "front_left_45") return "45-degree diagonal front-left view, camera rotated 45 degrees left from the front view, showing both front_wall and left_wall";
    if (role === "front_right_45") return "45-degree diagonal front-right view, camera rotated 45 degrees right from the front view, showing both front_wall and right_wall";
    if (role === "back_left_45") return "45-degree diagonal back-left view, camera rotated between the back/reverse view and left side view, showing both back_wall and left_wall";
    if (role === "back_right_45") return "45-degree diagonal back-right view, camera rotated between the back/reverse view and right side view, showing both back_wall and right_wall";
    return "stable view";
}

function fixedObjectText(scene: Scene360) {
    if (!scene.fixedObjects.length) return "";
    return [
        "fixed_objects:",
        ...scene.fixedObjects.map((item) => {
            const visible = item.visible_in?.length ? `; visible_in: ${item.visible_in.join(", ")}` : "";
            return `- ${item.name}${item.position ? `: ${item.position}` : ""}${visible}`;
        }),
    ].join("\n");
}

function pickString(record: Record<string, unknown>, keys: string[]) {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === "string" && value.trim()) return value.trim();
        if (Array.isArray(value)) {
            const joined = value.map((item) => (typeof item === "string" ? item : JSON.stringify(item))).join("\n");
            if (joined.trim()) return joined.trim();
        }
    }
    return "";
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

function safeJson(text: string) {
    const trimmed = text.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    try {
        return JSON.parse(trimmed);
    } catch {
        const start = trimmed.indexOf("{");
        const end = trimmed.lastIndexOf("}");
        if (start < 0 || end <= start) return null;
        try {
            return JSON.parse(trimmed.slice(start, end + 1));
        } catch {
            return null;
        }
    }
}

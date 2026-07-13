import type { StoryboardShotPlan, StoryboardShotTransition, StoryboardSourceBeat } from "@/types/canvas";

export const STORYBOARD_BEAT_BATCH_SIZE = 10;
const STORYBOARD_SOURCE_CHUNK_SIZE = 1800;

export type PlannedStoryboardShot = {
    row: string[];
    plan: StoryboardShotPlan;
};

export function storyboardJsonRepairPrompt(content: string) {
    return `你是 JSON 修复器。下面是另一个模型返回的分镜规划 JSON，其中可能存在缺少逗号、引号未闭合、字符串内双引号未转义、Markdown 代码围栏或 JSON 前后混入解释文字等问题。

只修复 JSON 语法，不得增删、改写或重新生成任何故事事实、镜头、字段和值。只输出修复后的合法 JSON，不要 Markdown，不要解释。

【待修复内容】
${content}`;
}

export function parseStoryboardSourceBeats(content: string): StoryboardSourceBeat[] {
    const data = parseJson(content) as { beats?: unknown[] } | unknown[];
    const records = Array.isArray(data) ? data : data.beats;
    if (!Array.isArray(records)) return [];
    return records.flatMap((value, index) => {
        if (!value || typeof value !== "object") return [];
        const item = value as Record<string, unknown>;
        const sourceText = text(item.sourceText);
        const event = text(item.event);
        if (!sourceText || !event) return [];
        const treatment = text(item.treatment);
        return [{
            id: text(item.id) || `B${String(index + 1).padStart(3, "0")}`,
            sourceText,
            phase: text(item.phase),
            timeStage: text(item.timeStage),
            location: text(item.location),
            characters: stringList(item.characters),
            event,
            emotion: text(item.emotion),
            treatment: treatment === "symbolic" || treatment === "voiceover" ? treatment : "direct",
        }];
    });
}

export function parsePlannedStoryboardShots(content: string): PlannedStoryboardShot[] {
    const data = parseJson(content) as { shots?: unknown[] } | unknown[];
    const records = Array.isArray(data) ? data : data.shots;
    if (!Array.isArray(records)) return [];
    return records.flatMap((value) => {
        if (!value || typeof value !== "object") return [];
        const item = value as Record<string, unknown>;
        const row = ["", text(item.duration) || "8s", text(item.visual), text(item.shotSize), text(item.lighting), text(item.dialogue), text(item.sound), text(item.camera), text(item.imagePrompt)];
        if (!row[2]) return [];
        const transition = text(item.transition) as StoryboardShotTransition;
        return [{
            row,
            plan: {
                sourceBeatIds: stringList(item.sourceBeatIds),
                continuityGroupId: text(item.continuityGroupId),
                timeStage: text(item.timeStage),
                startState: text(item.startState),
                endState: text(item.endState),
                transition: ["continue", "cut", "montage", "time-jump"].includes(transition) ? transition : "cut",
                usePreviousTailFrame: item.usePreviousTailFrame === true,
            },
        }];
    });
}

export function storyboardBeatBatches(beats: StoryboardSourceBeat[]) {
    const batches: StoryboardSourceBeat[][] = [];
    for (let index = 0; index < beats.length; index += STORYBOARD_BEAT_BATCH_SIZE) batches.push(beats.slice(index, index + STORYBOARD_BEAT_BATCH_SIZE));
    return batches;
}

export function storyboardSourceChunks(source: string) {
    const units = source.split(/\n{2,}/).flatMap((paragraph) => paragraph.length <= STORYBOARD_SOURCE_CHUNK_SIZE ? [paragraph] : paragraph.split(/(?<=[。！？!?；;])/)).map((item) => item.trim()).filter(Boolean);
    const chunks: string[] = [];
    for (const unit of units) {
        const current = chunks.at(-1);
        if (current && current.length + unit.length + 1 <= STORYBOARD_SOURCE_CHUNK_SIZE) chunks[chunks.length - 1] = `${current}\n${unit}`;
        else if (unit.length <= STORYBOARD_SOURCE_CHUNK_SIZE) chunks.push(unit);
        else for (let index = 0; index < unit.length; index += STORYBOARD_SOURCE_CHUNK_SIZE) chunks.push(unit.slice(index, index + STORYBOARD_SOURCE_CHUNK_SIZE));
    }
    return chunks;
}

export function storyboardCoverage(beats: StoryboardSourceBeat[], shots: PlannedStoryboardShot[]) {
    const coveredIds = new Set(shots.flatMap((shot) => shot.plan.sourceBeatIds));
    const missingBeatIds = beats.map((beat) => beat.id).filter((id) => !coveredIds.has(id));
    return { covered: beats.length - missingBeatIds.length, total: beats.length, missingBeatIds };
}

export function plannedShotsForBeats(shots: PlannedStoryboardShot[], beats: StoryboardSourceBeat[]) {
    const allowedIds = new Set(beats.map((beat) => beat.id));
    return shots.flatMap((shot) => {
        const sourceBeatIds = shot.plan.sourceBeatIds.filter((id) => allowedIds.has(id));
        return sourceBeatIds.length ? [{ ...shot, plan: { ...shot.plan, sourceBeatIds } }] : [];
    });
}

function parseJson(content: string): unknown {
    const start = content.search(/[\[{]/);
    const end = Math.max(content.lastIndexOf("]"), content.lastIndexOf("}"));
    if (start < 0 || end <= start) throw new Error("模型没有返回可解析的故事规划 JSON");
    return JSON.parse(content.slice(start, end + 1));
}

function text(value: unknown) {
    return typeof value === "string" ? value.trim() : value === undefined || value === null ? "" : String(value).trim();
}

function stringList(value: unknown) {
    return Array.isArray(value) ? value.map(text).filter(Boolean) : text(value).split(/[、,，]/).map((item) => item.trim()).filter(Boolean);
}

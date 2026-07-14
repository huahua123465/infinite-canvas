import type { StoryboardChapter, StoryboardProductionMode, StoryboardProductionScope, StoryboardShotPlan, StoryboardShotTransition, StoryboardSourceBeat } from "@/types/canvas";

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
        const row = ["", text(item.duration) || "12s", text(item.visual), text(item.shotSize), text(item.lighting), text(item.dialogue), text(item.sound), text(item.camera), text(item.imagePrompt)];
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
                motionPriority: Math.max(1, Math.min(5, Number(item.motionPriority) || 3)),
            },
        }];
    });
}

export function planStoryboardProduction(shots: PlannedStoryboardShot[], beats: StoryboardSourceBeat[], mode: StoryboardProductionMode, customBudget?: number, episodeDurationSeconds = 90, scope: StoryboardProductionScope = "series") {
    const beatById = new Map(beats.map((beat) => [beat.id, beat]));
    const chapters: StoryboardChapter[] = [];
    let currentChapter: StoryboardChapter | undefined;
    const episodeSeconds = Math.max(60, Math.min(300, Number(episodeDurationSeconds) || 90));
    const targetClipCount = storyboardEpisodeClipTarget(mode, episodeSeconds, customBudget);
    const segments = shots.reduce<number[][]>((items, shot, index) => {
        const previous = shots[index - 1]?.plan;
        const continues = Boolean(previous && shot.plan.continuityGroupId && previous.continuityGroupId === shot.plan.continuityGroupId && shot.plan.transition === "continue");
        if (!continues) items.push([]);
        items.at(-1)?.push(index);
        return items;
    }, []);
    segments.forEach((indexes) => {
        const segmentDuration = indexes.reduce((total, index) => total + storyboardClipDuration(shots[index].row[1]), 0);
        const firstShot = shots[indexes[0]];
        const beat = beatById.get(firstShot.plan.sourceBeatIds[0]);
        if (!currentChapter || (scope === "series" && currentChapter.shotIndexes.length > 0 && (currentChapter.durationSeconds || 0) + segmentDuration > episodeSeconds)) {
            const episodeNumber = chapters.length + 1;
            const phase = (beat?.phase || beat?.timeStage || "故事推进").trim();
            currentChapter = { id: `E${String(episodeNumber).padStart(2, "0")}`, title: scope === "single" ? `单集 · ${phase}` : `第 ${episodeNumber} 集 · ${phase}`, shotIndexes: [], durationSeconds: 0, targetClipCount };
            chapters.push(currentChapter);
        }
        const chapter = currentChapter;
        indexes.forEach((index) => {
            const shot = shots[index];
            chapter.shotIndexes.push(index);
            shot.plan.chapterId = chapter.id;
            shot.plan.chapterTitle = chapter.title;
            shot.plan.renderMode = "video";
        });
        chapter.durationSeconds = (chapter.durationSeconds || 0) + segmentDuration;
    });
    shots.forEach((shot, index) => {
        const previous = shots[index - 1]?.plan;
        shot.plan.usePreviousTailFrame = Boolean(shot.plan.renderMode === "video" && previous?.renderMode === "video" && shot.plan.continuityGroupId && previous.chapterId === shot.plan.chapterId && previous.continuityGroupId === shot.plan.continuityGroupId && shot.plan.transition === "continue");
    });
    return { shots, chapters, videoCount: shots.length, stillCount: 0 };
}

export function storyboardEpisodeClipTarget(mode: StoryboardProductionMode, episodeDurationSeconds = 90, customBudget?: number) {
    const seconds = Math.max(60, Math.min(300, Number(episodeDurationSeconds) || 90));
    const requested = mode === "economy" ? Math.ceil(seconds / 15) : mode === "detailed" ? Math.ceil(seconds / 9) : mode === "custom" ? Number(customBudget) || Math.ceil(seconds / 12) : Math.ceil(seconds / 12);
    return Math.max(2, Math.min(30, requested));
}

export function storyboardEpisodeClipRange(mode: StoryboardProductionMode, episodeDurationSeconds = 90, customBudget?: number) {
    const target = storyboardEpisodeClipTarget(mode, episodeDurationSeconds, customBudget);
    if (mode === "custom") return { min: target, max: target };
    return { min: Math.max(2, target - 2), max: mode === "economy" ? target : target + (mode === "detailed" ? 2 : 1) };
}

export function storyboardSingleEpisodeBeatTarget(mode: StoryboardProductionMode, episodeDurationSeconds = 90, customBudget?: number) {
    const clips = storyboardEpisodeClipTarget(mode, episodeDurationSeconds, customBudget);
    return Math.max(6, Math.min(30, clips * 3));
}

export function storyboardPlanningConfigKey(scope: StoryboardProductionScope, mode: StoryboardProductionMode, episodeDurationSeconds = 90, customBudget?: number) {
    return `${scope}/${mode}/${Math.max(60, Math.min(300, Number(episodeDurationSeconds) || 90))}/${mode === "custom" ? Number(customBudget) || 8 : "auto"}`;
}

export function storyboardClipPlanInstruction(scope: StoryboardProductionScope, mode: StoryboardProductionMode, episodeDurationSeconds = 90, customBudget?: number) {
    const seconds = Math.max(60, Math.min(300, Number(episodeDurationSeconds) || 90));
    const target = storyboardEpisodeClipTarget(mode, seconds, customBudget);
    const clipSeconds = Math.max(8, Math.min(15, Math.round(seconds / target)));
    if (scope === "single") return `这是整篇故事的单集浓缩生产：只生成 1 集，总时长约 ${seconds} 秒，必须输出约 ${target} 个视频片段，每个片段约 ${clipSeconds} 秒。当前输入已经浓缩为核心事实，每个片段合并覆盖 2-4 个相邻核心事实，用旁白、蒙太奇和直接动作形成完整起承转合；跨度较长时允许在一个片段内用蒙太奇表现时间推进，但首帧只锁定开场时空，转折必须清楚。不得重新扩写成多集，不得为一句旁白或一个微小动作单独拆片段。`;
    return `按漫剧单集生产规划：每集约 ${seconds} 秒，目标约 ${target} 个视频片段，每个片段约 ${clipSeconds} 秒。一个片段必须合并覆盖 2-4 个时间、地点和人物状态相容的相邻事实；旁白、背景交代和情绪停留可与同场景动作合并，不得再按一事实一片段拆分。`;
}

function storyboardClipDuration(value?: string) {
    return Math.max(5, Math.min(15, Number(value?.match(/\d+(?:\.\d+)?/)?.[0]) || 12));
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

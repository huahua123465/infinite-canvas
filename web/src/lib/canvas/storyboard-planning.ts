import type { StoryboardChapter, StoryboardDramaturgyPhase, StoryboardDramaturgyPlan, StoryboardProductionMode, StoryboardProductionScope, StoryboardShotPlan, StoryboardShotTransition, StoryboardSourceBeat } from "@/types/canvas";

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

export function parseStoryboardDramaturgyPlan(content: string, beats: StoryboardSourceBeat[]): StoryboardDramaturgyPlan {
    const item = parseJson(content) as Record<string, unknown>;
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("模型没有返回可用的剧作总纲 JSON");
    const logline = text(item.logline);
    const coreConflict = text(item.coreConflict);
    if (!logline || !coreConflict) throw new Error("剧作总纲缺少一句话故事或核心冲突");
    const allowedIds = new Set(beats.map((beat) => beat.id));
    const ids = (value: unknown) => stringList(value).filter((id) => allowedIds.has(id));
    const opening = item.openingHook && typeof item.openingHook === "object" ? item.openingHook as Record<string, unknown> : {};
    const format = text(item.format);
    const rhythmRecords = Array.isArray(item.rhythmPlan) ? item.rhythmPlan : [];
    const rhythmPlan = rhythmRecords.flatMap((value): StoryboardDramaturgyPhase[] => {
        if (!value || typeof value !== "object") return [];
        const phaseItem = value as Record<string, unknown>;
        const phase = normalizeDramaturgyPhase(phaseItem.phase);
        const sourceBeatIds = ids(phaseItem.sourceBeatIds);
        if (!sourceBeatIds.length) return [];
        return [{ phase, sourceBeatIds, plotRhythm: normalizePlotRhythm(phaseItem.plotRhythm), emotionRhythm: normalizeEmotionRhythm(phaseItem.emotionRhythm), purpose: text(phaseItem.purpose) }];
    });
    const fallbackOpeningIds = beats[0] ? [beats[0].id] : [];
    return {
        format: format === "biography" || format === "concept" || format === "series" ? format : "narrative",
        logline,
        protagonist: text(item.protagonist) || beats.flatMap((beat) => beat.characters)[0] || "当前故事主体",
        want: text(item.want),
        need: text(item.need),
        coreConflict,
        openingHook: { description: text(opening.description) || beats[0]?.event || "从第一个可见事实建立故事", sourceBeatIds: ids(opening.sourceBeatIds).length ? ids(opening.sourceBeatIds) : fallbackOpeningIds },
        incitingBeatIds: ids(item.incitingBeatIds),
        turningBeatIds: ids(item.turningBeatIds),
        climaxBeatIds: ids(item.climaxBeatIds),
        endingBeatIds: ids(item.endingBeatIds),
        arcSummary: text(item.arcSummary),
        rhythmPlan,
        visualMotifs: stringList(item.visualMotifs).slice(0, 5),
        dialoguePrinciples: stringList(item.dialoguePrinciples).slice(0, 5),
        warnings: stringList(item.warnings).slice(0, 5),
    };
}

export function storyboardDramaturgyQualityIssues(plan: StoryboardDramaturgyPlan, beats: StoryboardSourceBeat[]) {
    const beatOrder = new Map(beats.map((beat, index) => [beat.id, index]));
    const structuralGroups = [plan.incitingBeatIds, plan.turningBeatIds, plan.climaxBeatIds, plan.endingBeatIds].filter((ids) => ids.length);
    const causalOrderBroken = structuralGroups.some((ids, index) => {
        if (!index) return false;
        const previous = structuralGroups[index - 1].map((id) => beatOrder.get(id) ?? Number.MAX_SAFE_INTEGER);
        const current = ids.map((id) => beatOrder.get(id) ?? Number.MAX_SAFE_INTEGER);
        return Math.max(...previous) > Math.min(...current);
    });
    return [
        !plan.want ? "缺少主角可见的外在目标" : "",
        !plan.need ? "缺少有事实边界的内在变化" : "",
        !plan.turningBeatIds.length ? "缺少关键转折事实" : "",
        !plan.climaxBeatIds.length ? "缺少高潮事实" : "",
        !plan.endingBeatIds.length ? "缺少结局事实" : "",
        !plan.arcSummary ? "缺少起点到终点的人物变化" : "",
        plan.rhythmPlan.length < 3 ? "双轨节奏阶段少于3个" : "",
        !plan.dialoguePrinciples.length ? "缺少对白旁白原则" : "",
        causalOrderBroken ? "激励、转折、高潮或结局的事实顺序倒置" : "",
    ].filter(Boolean);
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
                visualBeatIds: stringList(item.visualBeatIds),
                voiceoverBeatIds: stringList(item.voiceoverBeatIds),
                continuityGroupId: text(item.continuityGroupId),
                timeStage: text(item.timeStage),
                startState: text(item.startState),
                endState: text(item.endState),
                transition: ["continue", "cut", "montage", "time-jump"].includes(transition) ? transition : "cut",
                usePreviousTailFrame: item.usePreviousTailFrame === true,
                motionPriority: Math.max(1, Math.min(5, Number(item.motionPriority) || 3)),
                dramaticFunction: normalizeDramaturgyPhase(item.dramaticFunction),
                goal: text(item.goal),
                obstacle: text(item.obstacle),
                stakes: text(item.stakes),
                tactic: text(item.tactic),
                actionBeats: stringList(item.actionBeats).slice(0, 4),
                obstacleReaction: text(item.obstacleReaction),
                turningAction: text(item.turningAction),
                result: text(item.result),
                plotRhythm: normalizePlotRhythm(item.plotRhythm),
                emotionRhythm: normalizeEmotionRhythm(item.emotionRhythm),
                valueShift: text(item.valueShift),
            },
        }];
    });
}

export function storyboardShotQualityIssues(shots: PlannedStoryboardShot[]) {
    return shots.flatMap((shot, index) => {
        const plan = shot.plan;
        const abstractAction = [plan.tactic || "", ...(plan.actionBeats || []), plan.obstacleReaction || "", plan.turningAction || "", plan.result || ""].some((value) => /意识到|明白|感到|陷入沉思|局势(?:恶化|升级)|关系(?:缓和|恶化)|情绪变化|做出决定/.test(value));
        const issues = [
            plan.visualBeatIds?.length !== 1 ? "主要可见事实不是1个" : "",
            !plan.goal ? "缺少当前可见目标" : "",
            !plan.obstacle ? "缺少可见阻力或压力" : "",
            !plan.stakes ? "缺少失败代价" : "",
            !plan.tactic ? "缺少人物采取的具体策略" : "",
            (plan.actionBeats?.length || 0) < 2 ? "动作节拍少于2个" : "",
            !plan.obstacleReaction ? "缺少阻力反作用" : "",
            !plan.turningAction ? "缺少改变场面方向的动作转折" : "",
            !plan.result ? "缺少可见结果" : "",
            !plan.valueShift ? "缺少价值变化" : "",
            !plan.startState || !plan.endState ? "缺少明确起止状态" : "",
            abstractAction ? "动作仍使用不可拍摄的心理或概括表达" : "",
        ].filter(Boolean);
        return issues.length ? [`片段${index + 1}：${issues.join("、")}`] : [];
    });
}

export function planStoryboardProduction(shots: PlannedStoryboardShot[], beats: StoryboardSourceBeat[], mode: StoryboardProductionMode, customBudget?: number, episodeDurationSeconds = 90, scope: StoryboardProductionScope = "series", targetChapterCount?: number) {
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
    const requestedChapterCount = scope === "series" ? Math.max(1, Math.min(30, Number(targetChapterCount) || 0)) : 1;
    const chapterCount = requestedChapterCount ? Math.min(requestedChapterCount, segments.length) : 0;
    const totalDuration = segments.reduce((total, indexes) => total + indexes.reduce((sum, index) => sum + storyboardClipDuration(shots[index].row[1]), 0), 0);
    segments.forEach((indexes, segmentIndex) => {
        const segmentDuration = indexes.reduce((total, index) => total + storyboardClipDuration(shots[index].row[1]), 0);
        const firstShot = shots[indexes[0]];
        const beat = beatById.get(firstShot.plan.sourceBeatIds[0]);
        const remainingSegments = segments.length - segmentIndex;
        const remainingChapters = chapterCount ? chapterCount - chapters.length : 0;
        const targetDuration = chapterCount ? totalDuration / chapterCount : episodeSeconds;
        const shouldStartChapter = !currentChapter || (scope === "series" && currentChapter.shotIndexes.length > 0 && (chapterCount
            ? chapters.length < chapterCount && ((currentChapter.durationSeconds || 0) >= targetDuration || remainingSegments === remainingChapters)
            : (currentChapter.durationSeconds || 0) + segmentDuration > episodeSeconds));
        if (shouldStartChapter) {
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
    return { min: target, max: target };
}

export function storyboardSingleEpisodeBeatTarget(mode: StoryboardProductionMode, episodeDurationSeconds = 90, customBudget?: number) {
    const clips = storyboardEpisodeClipTarget(mode, episodeDurationSeconds, customBudget);
    return Math.max(6, Math.min(30, clips * 3));
}

export function storyboardPlanningConfigKey(scope: StoryboardProductionScope, mode: StoryboardProductionMode, episodeDurationSeconds = 90, customBudget?: number, targetChapterCount?: number) {
    return `scene-contract-v3/${scope}/${mode}/${Math.max(60, Math.min(300, Number(episodeDurationSeconds) || 90))}/${mode === "custom" ? Number(customBudget) || 8 : "auto"}/${scope === "series" ? Math.max(1, Math.min(30, Number(targetChapterCount) || 8)) : 1}`;
}

export function storyboardClipPlanInstruction(scope: StoryboardProductionScope, mode: StoryboardProductionMode, episodeDurationSeconds = 90, customBudget?: number, targetChapterCount?: number) {
    const seconds = Math.max(60, Math.min(300, Number(episodeDurationSeconds) || 90));
    const target = storyboardEpisodeClipTarget(mode, seconds, customBudget);
    const clipSeconds = Math.max(8, Math.min(15, Math.round(seconds / target)));
    if (scope === "single") return `这是整篇故事的单集浓缩生产：只生成 1 集，总时长约 ${seconds} 秒，动态视频预算固定为 ${target} 个片段，每个片段约 ${clipSeconds} 秒。不得因为跨地点或事实较多而增加片段数；每个片段只选择 1 个同地点、同人物时期的主要可见事实，其余相邻背景事实只能由旁白承载且不得要求画面切换。无法放入预算的次要细节继续浓缩，不得重新扩写成多集或把多个地点塞进同一视频。`;
    const chapters = Math.max(1, Math.min(30, Number(targetChapterCount) || 8));
    return `这是完整系列生产，目标拆为约 ${chapters} 集；每集约 ${seconds} 秒，动态视频预算固定为约 ${target} 个片段，每个片段约 ${clipSeconds} 秒。按年代、地点、人物身体状态和关键转折划分章节，不得机械平均截断连续事件。每个片段只选择 1 个同地点、同人物时期的主要可见事实；相邻背景事实可由旁白承载，但不得要求画面切换到另一地点或人物时期，也不得按一事实一片段无限拆分。`;
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

export function storyboardSpeechParts(value: string) {
    const text = value.trim();
    const quotedDialogues = Array.from(text.matchAll(/[“"]([^”"]+)[”"]/g)).map((item) => item[1].trim()).filter(Boolean);
    const labelledDialogues = Array.from(text.matchAll(/(?:对白|台词)\s*[：:]\s*([^。；\n]+)/g)).map((item) => item[1].trim()).filter(Boolean);
    const dialogues = Array.from(new Set([...quotedDialogues, ...labelledDialogues]));
    const narrationMatch = text.match(/(?:旁白|VO)\s*[：:]\s*([\s\S]*?)(?=(?:对白|台词)\s*[：:]|$)/i);
    const narration = (narrationMatch?.[1] || (/(?:对白|台词)\s*[：:]/.test(text) || dialogues.length ? "" : text))
        .replace(/[“"][^”"]+[”"]/g, "")
        .replace(/^(?:旁白|VO)\s*[：:]\s*/i, "")
        .trim();
    return { narration, dialogues };
}

export function plannedShotsForBeats(shots: PlannedStoryboardShot[], beats: StoryboardSourceBeat[]) {
    const allowedIds = new Set(beats.map((beat) => beat.id));
    return shots.flatMap((shot) => {
        const sourceBeatIds = shot.plan.sourceBeatIds.filter((id) => allowedIds.has(id));
        if (!sourceBeatIds.length) return [];
        const visualBeatIds = (shot.plan.visualBeatIds || []).filter((id) => sourceBeatIds.includes(id)).slice(0, 1);
        const resolvedVisualBeatIds = visualBeatIds.length ? visualBeatIds : sourceBeatIds.slice(0, 1);
        const voiceoverBeatIds = (shot.plan.voiceoverBeatIds || []).filter((id) => sourceBeatIds.includes(id) && !resolvedVisualBeatIds.includes(id));
        return [{ ...shot, plan: { ...shot.plan, sourceBeatIds, visualBeatIds: resolvedVisualBeatIds, voiceoverBeatIds: voiceoverBeatIds.length ? voiceoverBeatIds : sourceBeatIds.filter((id) => !resolvedVisualBeatIds.includes(id)) } }];
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

function normalizeDramaturgyPhase(value: unknown): StoryboardDramaturgyPhase["phase"] {
    const phase = text(value);
    return phase === "setup" || phase === "inciting" || phase === "escalation" || phase === "turn" || phase === "climax" || phase === "resolution" ? phase : "escalation";
}

function normalizePlotRhythm(value: unknown): StoryboardDramaturgyPhase["plotRhythm"] {
    const rhythm = text(value);
    return rhythm === "loose" || rhythm === "tight" ? rhythm : "medium";
}

function normalizeEmotionRhythm(value: unknown): StoryboardDramaturgyPhase["emotionRhythm"] {
    const rhythm = text(value);
    return rhythm === "light" || rhythm === "heavy" ? rhythm : "medium";
}

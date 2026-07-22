import type { StoryboardChapter, StoryboardDramaturgyPhase, StoryboardDramaturgyPlan, StoryboardProductionScope, StoryboardShotPlan, StoryboardShotTransition, StoryboardSourceBeat } from "@/types/canvas";

export const STORYBOARD_BEAT_BATCH_SIZE = 20;
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
        const row = ["", "15s", text(item.visual), text(item.shotSize), text(item.lighting), text(item.dialogue), text(item.sound), text(item.camera), text(item.imagePrompt)];
        if (!row[2]) return [];
        const transition = text(item.transition) as StoryboardShotTransition;
        return [{
            row,
            plan: {
                shotId: text(item.shotId),
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
                actionBeats: stringList(item.actionBeats),
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
        const issues = storyboardShotQualityIssuesForShot(shot);
        return issues.length ? [`片段${index + 1}：${issues.join("、")}`] : [];
    });
}

export function storyboardShotQualityIssuesForShot(shot: PlannedStoryboardShot) {
    const plan = shot.plan;
    const narrationLength = Array.from(storyboardSpeechParts(shot.row[5] || "").narration.replace(/[^\u3400-\u9fffA-Za-z0-9]/g, "")).length;
    const abstractAction = [plan.tactic || "", ...(plan.actionBeats || []), plan.obstacleReaction || "", plan.turningAction || "", plan.result || ""].some((value) => /意识到|明白|感到|陷入沉思|局势(?:恶化|升级)|关系(?:缓和|恶化)|情绪变化|做出决定/.test(value));
    return [
        plan.visualBeatIds?.length !== 1 ? "主要可见事实不是1个" : "",
        !plan.goal ? "缺少当前可见目标" : "",
        !plan.obstacle ? "缺少可见阻力或压力" : "",
        !plan.stakes ? "缺少失败代价" : "",
        !plan.tactic ? "缺少人物采取的具体策略" : "",
        (plan.actionBeats?.length || 0) < 2 ? "动作节拍少于2个" : "",
        (plan.actionBeats?.length || 0) > 3 ? "动作节拍超过3个" : "",
        narrationLength > 48 ? `旁白超过48字（当前${narrationLength}字）` : "",
        !plan.obstacleReaction ? "缺少阻力反作用" : "",
        !plan.turningAction ? "缺少改变场面方向的动作转折" : "",
        !plan.result ? "缺少可见结果" : "",
        !plan.valueShift ? "缺少价值变化" : "",
        !plan.startState || !plan.endState ? "缺少明确起止状态" : "",
        abstractAction ? "动作仍使用不可拍摄的心理或概括表达" : "",
    ].filter(Boolean);
}

export function planStoryboardProduction(shots: PlannedStoryboardShot[], beats: StoryboardSourceBeat[], scope: StoryboardProductionScope = "series") {
    const beatById = new Map(beats.map((beat) => [beat.id, beat]));
    const chapters: StoryboardChapter[] = [];
    let currentChapter: StoryboardChapter | undefined;
    const segments = shots.reduce<number[][]>((items, shot, index) => {
        const previous = shots[index - 1]?.plan;
        const continues = Boolean(previous && shot.plan.continuityGroupId && previous.continuityGroupId === shot.plan.continuityGroupId && shot.plan.transition === "continue");
        if (!continues) items.push([]);
        items.at(-1)?.push(index);
        return items;
    }, []);
    const segmentVideoCounts = segments.map((indexes) => indexes.filter((index) => shots[index].plan.renderMode !== "still").length);
    const remainingVideoCounts = segmentVideoCounts.map((_, index) => segmentVideoCounts.slice(index).reduce((total, count) => total + count, 0));
    let previousBoundary: StoryboardNaturalChapterBoundary | undefined;
    segments.forEach((indexes, segmentIndex) => {
        const firstShot = shots[indexes[0]];
        const beat = beatById.get(firstShot.plan.visualBeatIds?.[0] || firstShot.plan.sourceBeatIds[0]);
        const boundary = storyboardNaturalChapterBoundary(firstShot, beat);
        const currentVideoCount = currentChapter?.shotIndexes.filter((index) => shots[index].plan.renderMode === "video").length || 0;
        const canStartChapter = currentVideoCount >= 4 && remainingVideoCounts[segmentIndex] >= 4 && chapters.length < 10 && (chapters.length < 9 || remainingVideoCounts[segmentIndex] <= 7);
        const shouldStartChapter = !currentChapter || (scope === "series" && canStartChapter && (storyboardStartsNaturalChapter(previousBoundary, boundary) || currentVideoCount + segmentVideoCounts[segmentIndex] > 7));
        if (shouldStartChapter) {
            const episodeNumber = chapters.length + 1;
            const phase = boundary.lifeStage || (beat?.phase || "故事推进").trim();
            currentChapter = { id: `E${String(episodeNumber).padStart(2, "0")}`, title: scope === "single" ? `单集 · ${phase}` : `第 ${episodeNumber} 集 · ${phase}`, shotIndexes: [], durationSeconds: 0, targetClipCount: 0 };
            chapters.push(currentChapter);
        }
        const chapter = currentChapter;
        if (!chapter) return;
        indexes.forEach((index) => {
            const shot = shots[index];
            shot.row[1] = "15s";
            chapter.shotIndexes.push(index);
            shot.plan.chapterId = chapter.id;
            shot.plan.chapterTitle = chapter.title;
            if (shot.plan.renderMode !== "still") shot.plan.renderMode = "video";
        });
        const chapterVideoCount = chapter.shotIndexes.filter((index) => shots[index].plan.renderMode === "video").length;
        chapter.durationSeconds = chapterVideoCount * 15;
        chapter.targetClipCount = chapterVideoCount;
        previousBoundary = boundary;
    });
    shots.forEach((shot, index) => {
        const previous = shots[index - 1]?.plan;
        shot.plan.usePreviousTailFrame = Boolean(shot.plan.renderMode === "video" && previous?.renderMode === "video" && shot.plan.continuityGroupId && previous.chapterId === shot.plan.chapterId && previous.continuityGroupId === shot.plan.continuityGroupId && shot.plan.transition === "continue");
    });
    return { shots, chapters, videoCount: shots.filter((shot) => shot.plan.renderMode === "video").length, stillCount: shots.filter((shot) => shot.plan.renderMode === "still").length };
}

export function storyboardSingleEpisodeBeatTarget() {
    return 18;
}

export function storyboardPlanningConfigKey(scope: StoryboardProductionScope) {
    return `scene-contract-v5/${scope}/global-budget/natural-chapters/15s`;
}

export function storyboardTotalClipTarget(factCount: number) {
    return Math.max(2, Math.min(300, Math.ceil(Math.max(1, factCount) / 5)));
}

export function storyboardBatchClipTargets(batches: StoryboardSourceBeat[][], totalTarget: number) {
    const totalFacts = batches.reduce((total, batch) => total + batch.length, 0);
    let remainingFacts = totalFacts;
    let remainingTarget = totalTarget;
    return batches.map((batch, index) => {
        const remainingBatches = batches.length - index - 1;
        const target = index === batches.length - 1 ? remainingTarget : Math.max(1, Math.min(remainingTarget - remainingBatches, Math.round((remainingTarget * batch.length) / Math.max(1, remainingFacts))));
        remainingFacts -= batch.length;
        remainingTarget -= target;
        return target;
    });
}

export function storyboardClipPlanInstruction(scope: StoryboardProductionScope, totalTarget?: number) {
    const clipRule = "每个动态片段固定15秒，只允许1个主要可见事实、1个地点和1个人物时期；使用2-3个因果相承的物理动作节拍与1个主运镜，0-3秒建立场景，3-9秒推进动作，9-12秒形成反作用或可见结果，12-15秒只保持稳定落点。旁白目标36-45个汉字，硬上限48个汉字。相邻背景事实只有在同地点、同人物时期且不要求第二段可见剧情时才能由旁白承载。";
    const budgetRule = totalTarget ? `完整生产的动态视频总预算严格为${totalTarget}个，必须通过把同地点、同人物时期的非主要事实放入voiceoverBeatIds覆盖，不能增加镜头突破预算。` : "";
    if (scope === "single") return `这是整篇故事的单集浓缩生产。${budgetRule}${clipRule}无法放入的次要细节继续浓缩，不得把多个地点、人物时期或主要事件硬塞进同一视频。`;
    return `这是完整故事生产。${budgetRule}${clipRule}章节只按童年、青年、成家、中年、晚年、身后等宽泛人生阶段，以及迁徙、婚姻、重大损失、身体状态不可逆变化和高潮/结局等强转折划分；不得因任意phase、timeStage文案或地点小变化切章，也不得按一事实一片段无限拆分。`;
}

type StoryboardNaturalChapterBoundary = { lifeStage: string; majorTransition: string; dramaticFunction: StoryboardShotPlan["dramaticFunction"]; transition: StoryboardShotTransition };

function storyboardNaturalChapterBoundary(shot: PlannedStoryboardShot, beat?: StoryboardSourceBeat): StoryboardNaturalChapterBoundary {
    const evidence = `${beat?.sourceText || ""} ${beat?.event || ""} ${shot.plan.goal || ""} ${shot.plan.result || ""}`;
    return {
        lifeStage: storyboardBroadLifeStage(`${shot.plan.timeStage || ""} ${beat?.timeStage || ""} ${beat?.phase || ""}`),
        majorTransition: evidence.match(/迁徙|远行|逃荒|离婚|结婚|再婚|丧女|丧子|去世|离世|死亡|下葬|失去[^，。；]{0,8}亲人|残疾加重|瘫痪|萎缩|精神崩溃|住院/)?.[0] || "",
        dramaticFunction: shot.plan.dramaticFunction,
        transition: shot.plan.transition,
    };
}

function storyboardStartsNaturalChapter(previous: StoryboardNaturalChapterBoundary | undefined, current: StoryboardNaturalChapterBoundary) {
    if (!previous) return true;
    if (current.lifeStage && previous.lifeStage && current.lifeStage !== previous.lifeStage) return true;
    if (current.majorTransition && current.majorTransition !== previous.majorTransition) return true;
    return current.dramaticFunction !== previous.dramaticFunction && (current.dramaticFunction === "climax" || current.dramaticFunction === "resolution");
}

function storyboardBroadLifeStage(value: string) {
    if (/身后|下葬|墓|去世后|离世后/.test(value)) return "身后";
    if (/晚年|老年|暮年|临终|去世|离世/.test(value)) return "晚年";
    if (/中年|养育子女|孩子上学|家庭重担/.test(value)) return "中年";
    if (/成家|婚后|结婚|再婚|孕期|育儿|生育/.test(value)) return "成家";
    if (/青年|年轻|成年|务工|离家/.test(value)) return "青年";
    if (/少年|青春期|学生时期/.test(value)) return "少年";
    if (/出生|婴儿|幼年|童年|儿时|孩童/.test(value)) return "童年";
    return "";
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
        const voiceoverBeatIds = Array.from(new Set((shot.plan.voiceoverBeatIds || []).filter((id) => sourceBeatIds.includes(id) && !resolvedVisualBeatIds.includes(id))));
        const missingVoiceoverBeatIds = sourceBeatIds.filter((id) => !resolvedVisualBeatIds.includes(id) && !voiceoverBeatIds.includes(id));
        return [{ ...shot, plan: { ...shot.plan, sourceBeatIds, visualBeatIds: resolvedVisualBeatIds, voiceoverBeatIds: [...voiceoverBeatIds, ...missingVoiceoverBeatIds] } }];
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

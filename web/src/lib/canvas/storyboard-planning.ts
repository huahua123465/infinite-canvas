import type { StoryboardChapter, StoryboardDramaturgyPhase, StoryboardDramaturgyPlan, StoryboardProductionScope, StoryboardShotParticipant, StoryboardShotPlan, StoryboardShotTransition, StoryboardSourceBeat, StoryboardTypedActionBeat } from "@/types/canvas";
import { jsonrepair } from "jsonrepair";

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
    const requiresCharacterArc = plan.format !== "concept";
    return [
        requiresCharacterArc && !plan.want ? "缺少主角可见的外在目标" : "",
        requiresCharacterArc && !plan.need ? "缺少有事实边界的内在变化" : "",
        !plan.turningBeatIds.length ? "缺少关键转折事实" : "",
        requiresCharacterArc && !plan.climaxBeatIds.length ? "缺少高潮事实" : "",
        !plan.endingBeatIds.length ? "缺少结局事实" : "",
        requiresCharacterArc && !plan.arcSummary ? "缺少起点到终点的人物变化" : "",
        plan.rhythmPlan.length < 3 ? "双轨节奏阶段少于3个" : "",
        !plan.dialoguePrinciples.length ? "缺少对白旁白原则" : "",
        causalOrderBroken ? "激励、转折、高潮或结局的事实顺序倒置" : "",
    ].filter(Boolean);
}

export function storyboardDurationSeconds(value?: string | number, fallback = 15) {
    const parsed = typeof value === "number" ? value : Number(String(value || "").match(/\d+(?:\.\d+)?/)?.[0]);
    return Number.isFinite(parsed) && parsed >= 4 ? Math.round(parsed * 10) / 10 : fallback;
}

function formatStoryboardSecond(value: number) { return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(1))); }

export function storyboardTimelineRanges(value?: string | number): Array<[number, number]> {
    const duration = storyboardDurationSeconds(value);
    if (duration === 15) return [[0, 3], [3, 9], [9, 12], [12, 15]];
    if (duration <= 4) return [[0, 1], [1, 2], [2, 3], [3, duration]];
    const first = Math.min(Math.max(1, Math.round(duration * .2)), duration - 3);
    const second = Math.min(Math.max(first + 1, Math.round(duration * .6)), duration - 2);
    const third = Math.min(Math.max(second + 1, Math.round(duration * .8)), duration - 1);
    return [[0, first], [first, second], [second, third], [third, duration]];
}

export function storyboardTimelineRangeLabels(value?: string | number) { return storyboardTimelineRanges(value).map(([start, end]) => `${formatStoryboardSecond(start)}-${formatStoryboardSecond(end)}秒`); }

export function storyboardTimelineInstruction(value?: string | number) {
    const duration = storyboardDurationSeconds(value);
    const labels = storyboardTimelineRangeLabels(duration);
    return `每条片段固定${formatStoryboardSecond(duration)}秒，duration 必须写 "${formatStoryboardSecond(duration)}s"，visual 必须逐行使用“${labels[0]}：”“${labels[1]}：”“${labels[2]}：”“${labels[3]}：”四段。`;
}

export function parsePlannedStoryboardShots(content: string, durationSeconds = 15): PlannedStoryboardShot[] {
    const data = parseJson(content) as { shots?: unknown[] } | unknown[];
    const records = Array.isArray(data) ? data : data.shots;
    if (!Array.isArray(records)) return [];
    return records.flatMap((value) => {
        if (!value || typeof value !== "object") return [];
        const item = value as Record<string, unknown>;
        const row = ["", `${formatStoryboardSecond(storyboardDurationSeconds(durationSeconds))}s`, text(item.visual), text(item.shotSize), text(item.lighting), text(item.dialogue), text(item.sound), text(item.camera), text(item.imagePrompt)];
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
                participants: parseShotParticipants(item.participants),
                typedActionBeats: parseTypedActionBeats(item.typedActionBeats),
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

export function parseStoryboardShotQualityRepair(content: string, current?: PlannedStoryboardShot): PlannedStoryboardShot {
    let data: unknown;
    try {
        data = parseJson(content);
    } catch (error) {
        throw new SyntaxError(error instanceof Error ? error.message : "修正响应不是合法 JSON");
    }
    if (!data || typeof data !== "object") throw new Error("修正响应根路径必须是对象或数组");
    const rootRecord = Array.isArray(data) ? undefined : data as Record<string, unknown>;
    const hasShots = Boolean(rootRecord && Object.prototype.hasOwnProperty.call(rootRecord, "shots"));
    if (hasShots && !Array.isArray(rootRecord?.shots)) throw new Error("修正响应 shots 必须是数组");
    const shots = Array.isArray(data) ? data : hasShots ? rootRecord?.shots as unknown[] : [data];
    if (shots.length !== 1) throw new Error(`修正响应 shots 必须且只能包含1项（当前${shots.length}项）`);
    const item = shots[0];
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("修正响应 shots[0] 必须是对象");
    const record = item as Record<string, unknown>;
    const rowSource = record.row;
    const rowRecord = rowSource && typeof rowSource === "object" && !Array.isArray(rowSource) ? rowSource as Record<string, unknown> : record;
    const markdownRow = typeof rowSource === "string" ? rowSource.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.includes("|") && !/^\|?\s*:?-+/.test(line)).map((line) => line.replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim())).find((cells) => cells.length >= 3 && !/镜号|时长|画面描述/.test(cells.join(""))) : undefined;
    const arrayRow = Array.isArray(rowSource) ? rowSource : markdownRow;
    const rowKeys = [["shotNumber", "镜号"], ["duration", "时长"], ["visual", "画面描述", "画面"], ["shotSize", "景别"], ["lighting", "光线"], ["dialogue", "对白旁白", "对白"], ["sound", "声音"], ["camera", "运镜"], ["imagePrompt", "首帧提示词"]];
    const row = rowKeys.map((keys, index) => {
        const objectKey = [String(index), ...keys].find((key) => Object.prototype.hasOwnProperty.call(rowRecord, key));
        const supplied = arrayRow ? index < arrayRow.length : Boolean(objectKey);
        const value = arrayRow ? text(arrayRow[index]) : objectKey ? text(rowRecord[objectKey]) : "";
        return index < 2 && current ? current.row[index] || "" : supplied ? value : current?.row[index] || "";
    });
    if (!row[2]) throw new Error("修正响应 shots[0].row[2] 缺少画面描述");
    if (record.plan !== undefined && (!record.plan || typeof record.plan !== "object" || Array.isArray(record.plan))) throw new Error("修正响应 shots[0].plan 必须是对象");
    const rawPlan = record.plan && typeof record.plan === "object" ? record.plan as Record<string, unknown> : record;
    const has = (field: string) => Object.prototype.hasOwnProperty.call(rawPlan, field);
    const mergedText = (field: keyof StoryboardShotPlan) => {
        if (has(String(field)) && typeof rawPlan[String(field)] !== "string") throw new Error(`修正响应 shots[0].plan.${String(field)} 必须是字符串`);
        const value = has(String(field)) ? text(rawPlan[String(field)]) : text(current?.plan[field]);
        if (!value) throw new Error(`修正响应 shots[0].plan.${field} 缺失或为空`);
        return value;
    };
    const immutableList = (field: "sourceBeatIds" | "visualBeatIds" | "voiceoverBeatIds") => current ? [...(current.plan[field] || [])] : stringList(rawPlan[field]);
    const sourceBeatIds = immutableList("sourceBeatIds");
    if (!sourceBeatIds.length) throw new Error("修正响应 shots[0].plan.sourceBeatIds 必须是非空列表");
    const visualBeatIds = immutableList("visualBeatIds");
    if (visualBeatIds.length !== 1) throw new Error("修正响应 shots[0].plan.visualBeatIds 必须且只能包含1项");
    if (has("actionBeats") && !Array.isArray(rawPlan.actionBeats)) throw new Error("修正响应 shots[0].plan.actionBeats 必须是数组");
    const actionBeats = has("actionBeats") ? stringList(rawPlan.actionBeats) : [...(current?.plan.actionBeats || [])];
    if (actionBeats.length < 2 || actionBeats.length > 3) throw new Error("修正响应 shots[0].plan.actionBeats 必须包含2-3项");
    if (has("participants") && !Array.isArray(rawPlan.participants)) throw new Error("修正响应 shots[0].plan.participants 必须是数组");
    const rawParticipants = has("participants") ? rawPlan.participants as unknown[] : current?.plan.participants || [];
    rawParticipants.forEach((value, index) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`修正响应 shots[0].plan.participants[${index}] 必须是对象`);
        const participant = value as Record<string, unknown>;
        if (!text(participant.name)) throw new Error(`修正响应 shots[0].plan.participants[${index}].name 缺失或为空`);
        if (!["actor", "patient"].includes(text(participant.role))) throw new Error(`修正响应 shots[0].plan.participants[${index}].role 必须是 actor 或 patient`);
        if (participant.lifeStage !== undefined && typeof participant.lifeStage !== "string") throw new Error(`修正响应 shots[0].plan.participants[${index}].lifeStage 必须是字符串`);
        if (participant.sourceBeatIds !== undefined && !Array.isArray(participant.sourceBeatIds)) throw new Error(`修正响应 shots[0].plan.participants[${index}].sourceBeatIds 必须是数组`);
    });
    const currentParticipantByName = new Map((current?.plan.participants || []).map((participant) => [participant.name, participant]));
    const participants = parseShotParticipants(rawParticipants).map((participant) => {
        const previous = currentParticipantByName.get(participant.name);
        return { ...participant, lifeStage: participant.lifeStage || previous?.lifeStage, sourceBeatIds: participant.sourceBeatIds.length ? participant.sourceBeatIds : [...(previous?.sourceBeatIds || [])] };
    });
    if (!participants.length) throw new Error("修正响应 shots[0].plan.participants 缺少合法参与者");
    const participantWithoutFacts = participants.find((participant) => !participant.sourceBeatIds.length);
    if (participantWithoutFacts) throw new Error(`修正响应新增参与者“${participantWithoutFacts.name}”缺少 sourceBeatIds，不能从原镜头继承`);
    if (has("typedActionBeats") && !Array.isArray(rawPlan.typedActionBeats)) throw new Error("修正响应 shots[0].plan.typedActionBeats 必须是数组");
    const rawTypedActionBeats = has("typedActionBeats") ? rawPlan.typedActionBeats as unknown[] : current?.plan.typedActionBeats || [];
    rawTypedActionBeats.forEach((value, index) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`修正响应 shots[0].plan.typedActionBeats[${index}] 必须是对象`);
        const beat = value as Record<string, unknown>;
        ["actor", "action", "patient", "result"].forEach((field) => {
            if (!text(beat[field])) throw new Error(`修正响应 shots[0].plan.typedActionBeats[${index}].${field} 缺失或为空`);
        });
    });
    const typedActionBeats = parseTypedActionBeats(rawTypedActionBeats);
    if (typedActionBeats.length !== actionBeats.length) throw new Error("修正响应 shots[0].plan.typedActionBeats 必须与 actionBeats 逐项对应");
    const transition = text(rawPlan.transition) as StoryboardShotTransition;
    return {
        row,
        plan: {
            ...current?.plan,
            ...(rawPlan as unknown as StoryboardShotPlan),
            shotId: current?.plan.shotId || text(rawPlan.shotId),
            sourceBeatIds,
            visualBeatIds,
            voiceoverBeatIds: immutableList("voiceoverBeatIds"),
            continuityGroupId: current?.plan.continuityGroupId || text(rawPlan.continuityGroupId),
            timeStage: current?.plan.timeStage || text(rawPlan.timeStage),
            chapterId: current?.plan.chapterId,
            chapterTitle: current?.plan.chapterTitle,
            startState: mergedText("startState"),
            endState: mergedText("endState"),
            transition: current?.plan.transition || (["continue", "cut", "montage", "time-jump"].includes(transition) ? transition : "cut"),
            usePreviousTailFrame: current?.plan.usePreviousTailFrame ?? rawPlan.usePreviousTailFrame === true,
            motionPriority: current?.plan.motionPriority || Math.max(1, Math.min(5, Number(rawPlan.motionPriority) || 3)),
            dramaticFunction: current?.plan.dramaticFunction || normalizeDramaturgyPhase(rawPlan.dramaticFunction),
            goal: mergedText("goal"),
            obstacle: mergedText("obstacle"),
            stakes: mergedText("stakes"),
            tactic: mergedText("tactic"),
            actionBeats,
            participants,
            typedActionBeats,
            obstacleReaction: mergedText("obstacleReaction"),
            turningAction: mergedText("turningAction"),
            result: mergedText("result"),
            plotRhythm: current?.plan.plotRhythm || normalizePlotRhythm(rawPlan.plotRhythm),
            emotionRhythm: current?.plan.emotionRhythm || normalizeEmotionRhythm(rawPlan.emotionRhythm),
            valueShift: mergedText("valueShift"),
        },
    };
}

export function storyboardShotQualityIssues(shots: PlannedStoryboardShot[]) {
    return shots.flatMap((shot, index) => {
        const issues = storyboardShotQualityIssuesForShot(shot);
        return issues.length ? [`片段${index + 1}：${issues.join("、")}`] : [];
    });
}

const BODY_PART_PATTERN = /头|脸|眼|目光|肩|臂|手|掌|指|腰|背|腿|膝|脚|足|身体|身躯|姿态|重心|步伐|脚步|转身|侧身|俯身|起身/;
const CAMERA_PHRASE_PATTERN = /(?:镜头|运镜|摄影机|摄像机|机位|画面)\s*(?:向前|向后|向左|向右|上升|下降)?\s*(?:推近|拉远|摇摄|移动|平移|跟拍|跟随|升降)|(?:镜头|画面)中/g;
const ABSTRACT_PHRASE_PATTERN = /(?:意识到|明白|感到|陷入沉思|内心|心理|情绪变化|做出决定)|(?:观察|注视|凝视|等待)(?:前方|四周|对方|远处)?(?:并|且|然后|随后)?/g;
const STATIC_PHRASE_PATTERN = /(?:(?:头|脸|眼|肩|臂|手|掌|指|腰|背|腿|膝|脚|足|身体|身躯|姿态)?(?:保持|维持)(?:身体|姿态)?(?:不动|静止)|身体(?:不动|静止))|站着(?=(?:观察|注视|凝视|等待|$))/g;
const NON_EXECUTABLE_STATE_PATTERN = /意识到|明白|感到|陷入沉思|内心|心理|情绪|观察|注视|凝视|等待|疲惫|乏力|发麻|麻木|疼痛|酸痛|僵硬|保持(?:身体|姿态)?(?:不动|静止)|维持(?:身体|姿态)?(?:不动|静止)|身体(?:不动|静止)/g;
const EXECUTABLE_SUBJECT_PATTERN = /头部|脸部|眼睛|目光|肩膀|手臂|手掌|手指|腰部|背部|双腿|左腿|右腿|膝盖|脚掌|脚步|头|脸|眼|肩|臂|手|掌|指|腰|背|腿|膝|脚|足|身体|身躯|姿态|重心|步伐/g;
const POSITION_STATE_PATTERN = /(?:处于|位于|站在|坐在|躺在|停在|留在|存在于)([^，,。；;！!？?]*)$/;
const PURE_POSITION_PATTERN = /^(?:(?:在|朝|向|面向|朝向|靠着?|贴着?|摆在|放置于))?(?:桌(?:上|边)?|墙(?:上|边)?|地(?:上|面)?|门(?:前|边)?|窗(?:前|边)?|前方|后方|左侧|右侧|上方|下方|旁边|附近|原地|前|后|左|右|上|下|旁|边|内|外|中)$/;

function storyboardIsPureNonExecutableState(value: string, beat: StoryboardTypedActionBeat) {
    const positionTail = value.match(POSITION_STATE_PATTERN)?.[1] || "";
    if (positionTail && !BODY_PART_PATTERN.test(positionTail)) {
        if (!beat.prop || !positionTail.includes(beat.prop)) return true;
        if (/^(?:旁|边|内|外|中|上|下|前|后|左|右|附近|原地|位置)$/.test(positionTail.replaceAll(beat.prop, "").trim())) return true;
    }
    let residue = value
        .replace(CAMERA_PHRASE_PATTERN, "")
        .replace(NON_EXECUTABLE_STATE_PATTERN, "")
        .replaceAll(beat.actor, "")
        .replaceAll(beat.patient, "");
    if (beat.prop) residue = residue.replaceAll(beat.prop, "");
    residue = residue
        .replace(EXECUTABLE_SUBJECT_PATTERN, "")
        .replace(/(?:仍然|依然|继续|只是|仅仅|并且|同时|随后|然后|的|着|了|对|与|和|被|由)/g, "")
        .replace(/[^\u3400-\u9fffA-Za-z0-9]/g, "")
        .trim();
    return !residue || PURE_POSITION_PATTERN.test(residue);
}

export function storyboardActionBeatSegmentIndex(beatCount: number, beatIndex: number) {
    return beatCount === 2 && beatIndex === 1 ? 2 : Math.min(beatIndex, 2);
}

export function storyboardActionHasEvidence(content: string, beat: StoryboardTypedActionBeat) {
    const compact = (value: string) => value.replace(/[\s，,。；;！!？?、：:]/g, "");
    const normalizedContent = compact(content);
    const resultBodyPart = (beat.result || "").match(BODY_PART_PATTERN)?.[0];
    const actorBound = normalizedContent.includes(compact(beat.actor));
    const targetBound = beat.prop ? normalizedContent.includes(compact(beat.prop)) : normalizedContent.includes(compact(beat.patient)) || Boolean(resultBodyPart && normalizedContent.includes(compact(resultBodyPart)));
    const executableClause = content.split(/[，,。；;！!？?]/).map((clause) => clause.trim()).filter(Boolean).some((clause) => {
        const normalizedClause = compact(clause);
        const clauseTracksBeat = normalizedClause.includes(compact(beat.actor)) || normalizedClause.includes(compact(beat.patient)) || Boolean(beat.prop && normalizedClause.includes(compact(beat.prop)));
        const actionText = clause.replace(CAMERA_PHRASE_PATTERN, "").replace(ABSTRACT_PHRASE_PATTERN, "").replace(STATIC_PHRASE_PATTERN, "").trim();
        return clauseTracksBeat && Boolean(actionText) && !storyboardIsPureNonExecutableState(actionText, beat);
    });
    return actorBound && targetBound && executableClause && !storyboardIsPureNonExecutableState(beat.action, beat);
}

function storyboardVisualTimelineSegments(value: string) {
    return Array.from(value.matchAll(/(?:^|\n)\s*(\d+(?:\.\d+)?)\s*[-—–~至]\s*(\d+(?:\.\d+)?)\s*秒\s*[：:]\s*([^\n]+)/g)).map((item) => ({ start: Number(item[1]), end: Number(item[2]), content: item[3].trim() }));
}

function storyboardVisualTimelineHasExpectedStructure(value: string, durationSeconds: number) {
    const segments = storyboardVisualTimelineSegments(value);
    const expected = storyboardTimelineRanges(durationSeconds);
    return segments.length === 4 && segments.every((segment, index) => segment.start === expected[index][0] && segment.end === expected[index][1]);
}

function storyboardVisualTimelineIssue(value: string, plan: StoryboardShotPlan, durationSeconds: number) {
    const segments = storyboardVisualTimelineSegments(value);
    if (!storyboardVisualTimelineHasExpectedStructure(value, durationSeconds)) return `画面描述缺少${storyboardTimelineRangeLabels(durationSeconds).join("、")}四段详细时间轴`;
    const beats = plan.typedActionBeats || [];
    const actionMismatchIndex = beats.findIndex((beat, index) => !storyboardActionHasEvidence(segments[storyboardActionBeatSegmentIndex(beats.length, index)]?.content || "", beat));
    if (actionMismatchIndex >= 0) return `画面描述第${actionMismatchIndex + 1}段没有展开对应类型化动作节拍`;
    if (!/稳定|保持|停住|静止|落点|不再|维持/.test(segments[3].content)) return `画面描述${storyboardTimelineRangeLabels(durationSeconds)[3]}缺少结果保持和稳定落点`;
    return "";
}

export function normalizeStoryboardShotTimeline(shot: PlannedStoryboardShot): PlannedStoryboardShot {
    const duration = storyboardDurationSeconds(shot.row[1]);
    if (!storyboardVisualTimelineIssue(shot.row[2] || "", shot.plan, duration)) return shot;
    const beats = shot.plan.typedActionBeats || [];
    if (beats.length < 2 || beats.length > 3 || beats.length !== shot.plan.actionBeats?.length) return shot;
    if (beats.some((beat) => !beat.actor.trim() || !beat.action.trim() || !beat.patient.trim() || !beat.result?.trim())) return shot;
    const finalResult = shot.plan.result?.trim() || beats.at(-1)?.result?.trim() || "";
    const endState = shot.plan.endState?.trim() || "";
    if (!finalResult || !endState) return shot;
    const bridge = shot.plan.obstacleReaction?.trim() || "";
    if (beats.length === 2 && !bridge) return shot;
    const describeBeat = (beat: StoryboardTypedActionBeat) => beat.prop ? `${beat.actor}使用${beat.prop}${beat.action}${beat.patient}` : `${beat.actor}${beat.action}${beat.patient}`;
    const lastBeat = beats.at(-1)!;
    const labels = storyboardTimelineRangeLabels(duration);
    const rebuilt = [
        `${labels[0]}：同一场景内确认既有站位，同时${describeBeat(beats[0])}，形成物理结果：${beats[0].result}。`,
        beats[2]
            ? `${labels[1]}：承接上一拍结果，${describeBeat(beats[1])}，形成物理结果：${beats[1].result}。`
            : `${labels[1]}：保持第一拍已经形成的${beats[0].result}，承受既有阻力反作用：${bridge}。`,
        beats[2]
            ? `${labels[2]}：承接已有反作用完成动作转折，${describeBeat(beats[2])}；可见结果：${finalResult}。`
            : `${labels[2]}：${describeBeat(lastBeat)}，形成物理结果：${lastBeat.result}；可见结果：${finalResult}。`,
        `${labels[3]}：保持${finalResult}与${endState}，人物姿态和场景结构稳定不变，停在当前结果落点，画面不再增加新动作。`,
    ];
    const originalVisual = shot.row[2] || "";
    const originalSegments = storyboardVisualTimelineSegments(originalVisual);
    const expectedStructure = storyboardVisualTimelineHasExpectedStructure(originalVisual, duration);
    const segmentLines = expectedStructure
        ? originalSegments.map((segment, index) => `${segment.start}-${segment.end}秒：${segment.content}`)
        : [...rebuilt];
    if (expectedStructure) {
        beats.forEach((beat, index) => {
            const segmentIndex = storyboardActionBeatSegmentIndex(beats.length, index);
            if (!storyboardActionHasEvidence(originalSegments[segmentIndex]?.content || "", beat)) segmentLines[segmentIndex] = rebuilt[segmentIndex];
        });
        if (!/稳定|保持|停住|静止|落点|不再|维持/.test(originalSegments[3]?.content || "")) segmentLines[3] = rebuilt[3];
    }
    const visual = segmentLines.join("\n");
    const candidate = { row: shot.row.map((cell, index) => index === 2 ? visual : cell), plan: { ...shot.plan } };
    return storyboardVisualTimelineIssue(visual, shot.plan, duration) ? shot : candidate;
}

export function storyboardShotQualityAssessmentForShot(shot: PlannedStoryboardShot) {
    const plan = shot.plan;
    const narrationLength = Array.from(storyboardSpeechParts(shot.row[5] || "").narration.replace(/[^\u3400-\u9fffA-Za-z0-9]/g, "")).length;
    const abstractAction = [plan.tactic || "", ...(plan.actionBeats || []), plan.obstacleReaction || "", plan.turningAction || "", plan.result || ""].some((value) => /意识到|明白|感到|陷入沉思|局势(?:恶化|升级)|关系(?:缓和|恶化)|情绪变化|做出决定/.test(value));
    const actors = new Set((plan.participants || []).filter((item) => item.role === "actor").map((item) => item.name));
    const participantByName = new Map((plan.participants || []).map((item) => [item.name, item]));
    const humanRoleRequired = Boolean(plan.participants?.length) || /人物|角色|婴儿|新生儿|宝宝|幼儿|少年|少女|青年|成年|老人|童年|出生时|年轻时期/.test(`${plan.timeStage} ${shot.row[2]} ${shot.row[5]}`);
    const unboundActor = (plan.typedActionBeats || []).some((item) => !actors.has(item.actor));
    const ungroundedActor = (plan.participants || []).some((item) => item.role === "actor" && (!item.sourceBeatIds.length || item.sourceBeatIds.some((id) => !plan.sourceBeatIds.includes(id))));
    const unboundHumanPatient = (plan.typedActionBeats || []).some((item) => participantByName.has(item.patient) && participantByName.get(item.patient)?.role !== "patient");
    const infantActor = (plan.participants || []).find((item) => item.role === "actor" && /出生|新生儿|婴儿|宝宝|襁褓|幼儿/.test(`${item.name} ${item.lifeStage || ""}`));
    const infantCareAction = Boolean(infantActor && (plan.typedActionBeats || []).some((item) => item.actor === infantActor.name && /抱起|抱住|托住|喂养|喂奶|换尿布|照料|照护|护理|包裹|拢紧|整理襁褓|调整包裹|安置|穿衣|擦洗/.test(item.action)));
    const duration = storyboardDurationSeconds(shot.row[1]);
    const visualTimelineIssue = storyboardVisualTimelineIssue(shot.row[2] || "", plan, duration);
    const actionCountMismatch = (plan.actionBeats?.length || 0) !== (plan.typedActionBeats?.length || 0);
    const typedActionMissingResult = (plan.typedActionBeats || []).some((item) => !item.result?.trim());
    const blockers = [
        plan.visualBeatIds?.length !== 1 ? "主要可见事实不是1个" : "",
        !plan.goal ? "缺少当前可见目标" : "",
        !plan.obstacle ? "缺少可见阻力或压力" : "",
        !plan.stakes ? "缺少失败代价" : "",
        !plan.tactic ? "缺少人物采取的具体策略" : "",
        (plan.actionBeats?.length || 0) < 2 ? "动作节拍少于2个" : "",
        humanRoleRequired && !actors.size ? "缺少明确动作执行者 actor" : "",
        (plan.typedActionBeats?.length || 0) < 2 ? "类型化动作节拍少于2个" : "",
        actionCountMismatch ? "动作节拍与类型化动作节拍没有逐项对应" : "",
        typedActionMissingResult ? "类型化动作节拍缺少具体物理结果" : "",
        humanRoleRequired && ungroundedActor ? "类型化动作节拍的执行者未绑定当前事实" : "",
        humanRoleRequired && unboundActor ? "类型化动作节拍的执行者未标记 actor 职责" : "",
        humanRoleRequired && unboundHumanPatient ? "类型化动作节拍命中的人物承受者未绑定 patient 职责" : "",
        humanRoleRequired && infantCareAction ? "婴儿/幼儿不能作为成人照护动作的执行者" : "",
        narrationLength > Math.max(16, Math.round(duration * 3.2)) ? `旁白超过${Math.max(16, Math.round(duration * 3.2))}字（当前${narrationLength}字）` : "",
        !plan.result ? "缺少可见结果" : "",
        !plan.valueShift ? "缺少价值变化" : "",
        !plan.startState || !plan.endState ? "缺少明确起止状态" : "",
        visualTimelineIssue,
    ].filter(Boolean);
    const warnings = [
        (plan.actionBeats?.length || 0) > 3 ? "动作节拍超过3个" : "",
        (plan.typedActionBeats?.length || 0) > 3 ? "类型化动作节拍超过3个" : "",
        !plan.obstacleReaction ? "缺少阻力反作用" : "",
        !plan.turningAction ? "缺少改变场面方向的动作转折" : "",
        abstractAction ? "动作仍使用不可拍摄的心理或概括表达" : "",
    ].filter(Boolean);
    return { blockers, warnings };
}

/** Only deterministic factual blockers belong in the persisted qualityError field. */
export function storyboardShotQualityIssuesForShot(shot: PlannedStoryboardShot) {
    return storyboardShotQualityAssessmentForShot(shot).blockers;
}

export function storyboardShotQualityWarningsForShot(shot: PlannedStoryboardShot) {
    return storyboardShotQualityAssessmentForShot(shot).warnings;
}

function parseShotParticipants(value: unknown): StoryboardShotParticipant[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item): StoryboardShotParticipant[] => {
        if (!item || typeof item !== "object") return [];
        const record = item as Record<string, unknown>;
        const name = text(record.name);
        const role = text(record.role);
        if (!name || (role !== "actor" && role !== "patient")) return [];
        return [{ name, role, lifeStage: text(record.lifeStage) || undefined, sourceBeatIds: stringList(record.sourceBeatIds) }];
    });
}

function parseTypedActionBeats(value: unknown): StoryboardTypedActionBeat[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item): StoryboardTypedActionBeat[] => {
        if (!item || typeof item !== "object") return [];
        const record = item as Record<string, unknown>;
        const actor = text(record.actor);
        const action = text(record.action);
        const patient = text(record.patient);
        if (!actor || !action || !patient) return [];
        return [{ actor, action, patient, prop: text(record.prop) || undefined, result: text(record.result) || undefined }];
    });
}

export function planStoryboardProduction(shots: PlannedStoryboardShot[], beats: StoryboardSourceBeat[], scope: StoryboardProductionScope = "series", durationSeconds = 15) {
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
        const canStartChapter = currentVideoCount >= 8 && remainingVideoCounts[segmentIndex] >= 8 && chapters.length < 10 && (chapters.length < 9 || remainingVideoCounts[segmentIndex] <= 12);
        const shouldStartChapter = !currentChapter || (scope === "series" && canStartChapter && (storyboardStartsNaturalChapter(previousBoundary, boundary) || currentVideoCount + segmentVideoCounts[segmentIndex] > 12));
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
            shot.row[1] = `${formatStoryboardSecond(storyboardDurationSeconds(durationSeconds))}s`;
            chapter.shotIndexes.push(index);
            shot.plan.chapterId = chapter.id;
            shot.plan.chapterTitle = chapter.title;
            if (shot.plan.renderMode !== "still") shot.plan.renderMode = "video";
        });
        const chapterVideoCount = chapter.shotIndexes.filter((index) => shots[index].plan.renderMode === "video").length;
        chapter.durationSeconds = chapterVideoCount * storyboardDurationSeconds(durationSeconds);
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

export function storyboardPlanningConfigKey(scope: StoryboardProductionScope, durationSeconds = 15) {
    return `scene-contract-v6/${scope}/episode-budget-8-12/natural-chapters/${formatStoryboardSecond(storyboardDurationSeconds(durationSeconds))}s`;
}

export function storyboardTotalClipTarget(factCount: number) {
    return Math.max(2, Math.min(300, Math.ceil(Math.max(1, factCount) / 3)));
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

export function storyboardClipPlanInstruction(scope: StoryboardProductionScope, totalTarget?: number, durationSeconds = 15) {
    const duration = storyboardDurationSeconds(durationSeconds);
    const clipRule = `${storyboardTimelineInstruction(duration)}只允许1个主要可见事实、1个地点和1个人物时期；使用2-3个因果相承的物理动作节拍与1个主运镜。第一步画面描述的前三段必须写清执行者、身体部位或道具、动作对象与物理结果。旁白不超过${Math.max(16, Math.round(duration * 3.2))}个汉字。`;
    const budgetRule = totalTarget ? `完整生产的动态视频总预算严格为${totalTarget}个，必须通过把同地点、同人物时期的非主要事实放入voiceoverBeatIds覆盖，不能增加镜头突破预算。` : "";
    if (scope === "single") return `这是整篇故事的单集浓缩生产。${budgetRule}${clipRule}无法放入的次要细节继续浓缩，不得把多个地点、人物时期或主要事件硬塞进同一视频。`;
    return `这是完整故事生产。${budgetRule}${clipRule}每集优先安排8-12个动态片段，并在固定预算内形成建置、推进、转折与稳定结尾；章节只按童年、青年、成家、中年、晚年、身后等宽泛人生阶段，以及迁徙、婚姻、重大损失、身体状态不可逆变化和高潮/结局等强转折划分；不得因任意phase、timeStage文案或地点小变化切章，也不得按一事实一片段无限拆分。`;
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
    const source = content.slice(start, end + 1);
    try {
        return JSON.parse(source);
    } catch {
        return JSON.parse(jsonrepair(source));
    }
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

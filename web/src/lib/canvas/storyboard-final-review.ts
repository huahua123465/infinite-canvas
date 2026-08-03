import type {
    StoryboardDramaturgyPlan,
    StoryboardFinalReview,
    StoryboardFinalReviewDimension,
    StoryboardFinalReviewDimensionKey,
    StoryboardFinalReviewFinding,
    StoryboardFinalReviewIssue,
    StoryboardFinalReviewScoreCap,
    StoryboardProductionGateSummary,
    StoryboardShotPlan,
    StoryboardSourceBeat,
} from "@/types/canvas";
import { parsePlannedStoryboardShots, storyboardShotQualityIssuesForShot, storyboardSpeechParts, type PlannedStoryboardShot } from "@/lib/canvas/storyboard-planning";

export const STORYBOARD_FINAL_REVIEW_DIMENSIONS: ReadonlyArray<{ key: StoryboardFinalReviewDimensionKey; label: string; weight: number }> = [
    { key: "factSelection", label: "事实忠实与取舍", weight: 10 },
    { key: "structure", label: "整体结构与因果推进", weight: 12 },
    { key: "characterArc", label: "人物目标、选择与弧光", weight: 12 },
    { key: "sceneAction", label: "场景冲突与戏剧动作", weight: 12 },
    { key: "pacing", label: "节奏、悬念与信息分配", weight: 10 },
    { key: "audiovisual", label: "视听叙事能力", weight: 10 },
    { key: "dialogueNarration", label: "对白与旁白质量", weight: 8 },
    { key: "continuityPayoff", label: "连续性、伏笔与回收", weight: 8 },
    { key: "audienceValue", label: "观众共情与情绪价值", weight: 10 },
    { key: "commercialDifferentiation", label: "差异化与商业吸引力", weight: 8 },
];

export type StoryboardFinalReviewInput = {
    beats: StoryboardSourceBeat[];
    dramaturgy?: StoryboardDramaturgyPlan;
    rows: string[][];
    shotPlans: Array<StoryboardShotPlan | undefined>;
};

export type StoryboardFinalReviewerInput = {
    contract: "storyboard-final-review/v1";
    scoringRule: string;
    dimensions: typeof STORYBOARD_FINAL_REVIEW_DIMENSIONS;
    productionGate: StoryboardProductionGateSummary;
    deterministicFindings: StoryboardFinalReviewFinding[];
    dramaturgy?: StoryboardDramaturgyPlan;
    beats: StoryboardSourceBeat[];
    shots: Array<{ shotIndex: number; visual: string; dialogueNarration: string; plan?: StoryboardShotPlan }>;
};

const compact = (value: unknown) => String(value || "").trim();
const unique = <T,>(values: T[]) => Array.from(new Set(values));
const chineseLength = (value: string) => Array.from(value.replace(/\s|[，。！？、：；“”‘’（）《》,.!?:;'"()\[\]]/g, "")).length;
const visibleActionPattern = /推|拉|抓|握|放|抬|落|走|跑|转身|回头|打开|关闭|递|接|撕|撞|敲|跨|蹬|跪|站起|坐下|抱|牵|掀|取出|写|擦|点燃|熄灭/;
const costPattern = /代价|失去|失败|来不及|危险|死亡|离开|错过|暴露|受伤|惩罚|牺牲|破裂|被拒|无法|不能|再也/;

export function summarizeStoryboardProductionGate(input: StoryboardFinalReviewInput): StoryboardProductionGateSummary {
    const blockedShotIndexes = input.shotPlans.flatMap((plan, index) => plan?.qualityError ? [index] : []);
    const missingPlans = input.rows.flatMap((_, index) => input.shotPlans[index] ? [] : [index]);
    const reasons = [
        blockedShotIndexes.length ? `${blockedShotIndexes.length} 个镜头未通过生产合同` : "",
        missingPlans.length ? `${missingPlans.length} 个镜头缺少场景卡` : "",
        !input.beats.length ? "缺少可追溯事实" : "",
        !input.dramaturgy ? "缺少剧作总纲" : "",
    ].filter(Boolean);
    return {
        passed: reasons.length === 0,
        totalShots: input.rows.length,
        dynamicShots: input.shotPlans.filter((plan) => Boolean(plan) && plan?.renderMode !== "still").length,
        blockedShotIndexes: unique([...blockedShotIndexes, ...missingPlans]),
        reasons,
    };
}

export function auditStoryboardFinalReview(input: StoryboardFinalReviewInput): StoryboardFinalReviewFinding[] {
    const findings: StoryboardFinalReviewFinding[] = [];
    const add = (finding: StoryboardFinalReviewFinding) => findings.push(finding);
    const firstVisual = compact(input.rows[0]?.[2]);
    const openingPlan = input.shotPlans[0];
    const openingHasAction = visibleActionPattern.test(`${firstVisual} ${openingPlan?.typedActionBeats?.map((item) => item.action).join(" ") || ""}`);
    const openingHasProblem = Boolean(compact(openingPlan?.obstacle));
    if (!openingHasAction || !openingHasProblem) {
        add(finding("opening-weak", "P1", "opening", "开场缺少可见问题或动作", [firstVisual || "首镜画面为空"], openingPlan?.sourceBeatIds || [], [0], !openingHasAction && !openingHasProblem ? cap("opening-cap", 79, "开场没有建立可见问题或动作", [firstVisual || "首镜画面为空"], openingPlan?.sourceBeatIds || [], [0]) : undefined));
    }

    for (let index = 0; index <= input.shotPlans.length - 3; index += 1) {
        const group = input.shotPlans.slice(index, index + 3);
        if (group.every(Boolean) && new Set(group.map((plan) => `${plan?.plotRhythm}|${plan?.emotionRhythm}`)).size === 1) {
            add(finding(`rhythm-repeat-${index}`, "P1", "rhythm", "连续三镜情节与情绪节奏相同", [`镜头 ${index + 1}-${index + 3} 均为 ${group[0]?.plotRhythm || "未标注"}/${group[0]?.emotionRhythm || "未标注"}`], unique(group.flatMap((plan) => plan?.sourceBeatIds || [])), [index, index + 1, index + 2]));
        }
    }

    const climaxIndexes = input.shotPlans.flatMap((plan, index) => plan?.dramaticFunction === "climax" ? [index] : []);
    const climaxBeatIds = input.dramaturgy?.climaxBeatIds || [];
    if (!climaxIndexes.length || !climaxBeatIds.length) add(finding("climax-missing", "P0", "climax", "缺少明确高潮", ["总纲或镜头中没有可定位的高潮"], climaxBeatIds, climaxIndexes, cap("climax-cap", 69, "高潮缺少行动兑现", ["没有明确高潮镜头或高潮事实"], climaxBeatIds, climaxIndexes)));
    else if (climaxIndexes.length > Math.max(2, Math.ceil(input.rows.length * .2))) add(finding("climax-multiple", "P1", "climax", "高潮镜头过多，峰值被摊薄", [`${input.rows.length} 镜中有 ${climaxIndexes.length} 镜标记为高潮`], climaxBeatIds, climaxIndexes));
    else if (climaxIndexes[0] < input.rows.length * .5 || climaxIndexes[climaxIndexes.length - 1] > input.rows.length * .95) add(finding("climax-position", "P1", "climax", "高潮位置明显偏离后段峰值", [`高潮位于第 ${climaxIndexes[0] + 1} 镜，共 ${input.rows.length} 镜`], climaxBeatIds, climaxIndexes));
    if (climaxIndexes.length && !climaxIndexes.some((index) => {
        const plan = input.shotPlans[index];
        return Boolean(plan?.typedActionBeats?.length && compact(plan.result) && visibleActionPattern.test(`${input.rows[index]?.[2] || ""} ${plan.typedActionBeats.map((item) => item.action).join(" ")}`));
    })) add(finding("climax-action-missing", "P0", "climax", "高潮只有说明，缺少可见行动兑现", ["高潮镜头没有同时提供可执行动作与可见结果"], climaxBeatIds, climaxIndexes, cap("climax-cap", 69, "高潮只有旁白总结，没有行动兑现", ["高潮镜头缺少可执行动作或可见结果"], climaxBeatIds, climaxIndexes)));

    const protagonist = compact(input.dramaturgy?.protagonist);
    const protagonistActions = input.shotPlans.flatMap((plan) => plan?.typedActionBeats?.filter((item) => !protagonist || item.actor.includes(protagonist) || protagonist.includes(item.actor)) || []);
    const costs = input.shotPlans.flatMap((plan) => [plan?.stakes || "", plan?.result || ""]).filter((value) => costPattern.test(value));
    if (!protagonistActions.length || !costs.length) add(finding("agency-cost-missing", "P1", "agency", "主角主动行动或失败代价不足", [`主角可定位动作 ${protagonistActions.length} 项，明确代价 ${costs.length} 项`], [], input.shotPlans.map((_, index) => index), cap("agency-cap", 74, "主角缺少明确选择和代价", [`主角可定位动作 ${protagonistActions.length} 项，明确代价 ${costs.length} 项`], [], [])));

    const narrationCounts = input.rows.map((row) => chineseLength((row[5] || "").replace(/(?:对白|台词)\s*[：:][^\n]*/g, "")));
    const narrationHeavy = narrationCounts.flatMap((count, index) => count > 48 ? [index] : []);
    if (narrationHeavy.length >= Math.max(2, Math.ceil(input.rows.length * .35))) add(finding("narration-heavy", "P1", "narration", "旁白密度偏高", [`${narrationHeavy.length}/${input.rows.length} 个镜头旁白超过约 48 字`], unique(narrationHeavy.flatMap((index) => input.shotPlans[index]?.voiceoverBeatIds || [])), narrationHeavy));

    const signatures = input.rows.map((row, index) => signalSignature(`${row[2] || ""} ${input.shotPlans[index]?.actionBeats?.join(" ") || ""}`));
    for (let index = 0; index <= signatures.length - 3; index += 1) {
        if (signatures[index] && signatures[index] === signatures[index + 1] && signatures[index] === signatures[index + 2]) add(finding(`visual-repeat-${index}`, "P2", "repetition", "连续镜头出现重复视觉或动作信号", [`镜头 ${index + 1}-${index + 3} 重复：${signatures[index]}`], unique(input.shotPlans.slice(index, index + 3).flatMap((plan) => plan?.sourceBeatIds || [])), [index, index + 1, index + 2]));
    }

    const endingIndexes = input.shotPlans.flatMap((plan, index) => plan?.dramaticFunction === "resolution" ? [index] : []);
    const lastPlan = input.shotPlans.at(-1);
    const endingEvidence = `${lastPlan?.result || ""} ${lastPlan?.valueShift || ""} ${lastPlan?.endState || ""}`;
    if (!endingIndexes.length || chineseLength(endingEvidence) < 12 || compact(lastPlan?.startState) === compact(lastPlan?.endState)) add(finding("ending-payoff-weak", "P1", "ending", "结尾回收或状态变化不足", [endingEvidence || "结尾缺少结果、价值变化与结束状态"], input.dramaturgy?.endingBeatIds || [], [Math.max(0, input.rows.length - 1)]));
    return findings;
}

export function buildStoryboardFinalReviewerInput(input: StoryboardFinalReviewInput): StoryboardFinalReviewerInput {
    return {
        contract: "storyboard-final-review/v1",
        scoringRule: "仅依据提供的事实与镜头评价；不得虚构。十维各按0-100评分，总分由程序按权重计算；确定性发现是证据，不等同于审美结论。",
        dimensions: STORYBOARD_FINAL_REVIEW_DIMENSIONS,
        productionGate: summarizeStoryboardProductionGate(input),
        deterministicFindings: auditStoryboardFinalReview(input),
        dramaturgy: input.dramaturgy,
        beats: input.beats,
        shots: input.rows.map((row, shotIndex) => ({ shotIndex, visual: row[2] || "", dialogueNarration: row[5] || "", plan: input.shotPlans[shotIndex] })),
    };
}

export function storyboardFinalReviewContextKey(input: StoryboardFinalReviewInput) {
    const source = JSON.stringify(buildStoryboardFinalReviewerInput(input));
    let hash = 2166136261;
    for (let index = 0; index < source.length; index += 1) hash = Math.imul(hash ^ source.charCodeAt(index), 16777619);
    return `storyboard-final-review/v1:${(hash >>> 0).toString(36)}`;
}

export function parseStoryboardFinalReview(content: string | unknown, input: StoryboardFinalReviewInput, metadata: { model: string; reviewedAt?: number }): StoryboardFinalReview {
    const data = typeof content === "string" ? JSON.parse(content.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "").trim()) : content;
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("终审模型没有返回可用的 JSON 对象");
    const item = data as Record<string, unknown>;
    const dimensionRecords = Array.isArray(item.dimensions) ? item.dimensions : [];
    const returnedKeys = dimensionRecords.flatMap((value) => value && typeof value === "object" ? [compact((value as Record<string, unknown>).key)] : []);
    if (dimensionRecords.length !== STORYBOARD_FINAL_REVIEW_DIMENSIONS.length || new Set(returnedKeys).size !== STORYBOARD_FINAL_REVIEW_DIMENSIONS.length || STORYBOARD_FINAL_REVIEW_DIMENSIONS.some((definition) => !returnedKeys.includes(definition.key))) throw new Error("终审模型没有完整返回十个唯一评分维度");
    const dimensions: StoryboardFinalReviewDimension[] = STORYBOARD_FINAL_REVIEW_DIMENSIONS.map((definition) => {
        const record = dimensionRecords.find((value) => value && typeof value === "object" && (value as Record<string, unknown>).key === definition.key) as Record<string, unknown> | undefined;
        if (record?.score === null || compact(record?.score) === "" || !Number.isFinite(Number(record?.score))) throw new Error(`终审维度 ${definition.label} 缺少有效分数`);
        return { ...definition, score: clampScore(record?.score), rationale: compact(record?.rationale) || "模型未提供该维度说明" };
    });
    const allowedBeatIds = new Set(input.beats.map((beat) => beat.id));
    const issues = (Array.isArray(item.issues) ? item.issues : []).flatMap((value, index): StoryboardFinalReviewIssue[] => {
        if (!value || typeof value !== "object") return [];
        const issue = value as Record<string, unknown>;
        const severity = issue.severity === "P0" || issue.severity === "P2" ? issue.severity : "P1";
        return [{
            id: compact(issue.id) || `review-issue-${index + 1}`,
            severity,
            title: compact(issue.title) || "未命名问题",
            description: compact(issue.description),
            suggestion: compact(issue.suggestion),
            dimensionKeys: stringArray(issue.dimensionKeys).filter(isDimensionKey),
            beatIds: stringArray(issue.beatIds).filter((id) => allowedBeatIds.has(id)),
            shotIndexes: numberArray(issue.shotIndexes).filter((shotIndex) => shotIndex >= 0 && shotIndex < input.rows.length),
        }];
    });
    const deterministicFindings = auditStoryboardFinalReview(input);
    const scoreCaps = uniqueCaps(deterministicFindings.flatMap((finding) => finding.scoreCap ? [finding.scoreCap] : []));
    const rawScore = roundScore(dimensions.reduce((sum, dimension) => sum + dimension.score * dimension.weight / 100, 0));
    const totalScore = Math.min(rawScore, ...scoreCaps.map((scoreCap) => scoreCap.maxScore));
    return {
        contextKey: storyboardFinalReviewContextKey(input), model: metadata.model, reviewedAt: metadata.reviewedAt || Date.now(), dimensions, rawScore, totalScore,
        grade: totalScore >= 85 ? "可进入商业成片打磨" : totalScore >= 75 ? "建议制作" : totalScore >= 60 ? "可生产但需改稿" : "不建议制作",
        summary: compact(item.summary), issues, deterministicFindings, scoreCaps, productionGate: summarizeStoryboardProductionGate(input),
    };
}

function finding(id: string, severity: "P0" | "P1" | "P2", category: StoryboardFinalReviewFinding["category"], title: string, evidence: string[], beatIds: string[], shotIndexes: number[], scoreCap?: StoryboardFinalReviewScoreCap): StoryboardFinalReviewFinding {
    return { id, severity, category, title, evidence: evidence.filter(Boolean), beatIds: unique(beatIds), shotIndexes: unique(shotIndexes), scoreCap };
}
function cap(id: string, maxScore: number, reason: string, evidence: string[], beatIds: string[], shotIndexes: number[]): StoryboardFinalReviewScoreCap { return { id, maxScore, reason, evidence, beatIds: unique(beatIds), shotIndexes: unique(shotIndexes) }; }
function signalSignature(value: string) { return unique((value.match(/推|拉|抓|握|放|抬|落|走|跑|转身|回头|打开|关闭|递|接|撕|撞|敲|跨|蹬|跪|站起|坐下|抱|牵|海|雨|门|窗|镜|火|信|照片|道路|背影/g) || [])).sort().join("+"); }
function clampScore(value: unknown) { const score = Number(value); return Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : 0; }
function roundScore(value: number) { return Math.round(value * 10) / 10; }
function stringArray(value: unknown) { return Array.isArray(value) ? value.map(compact).filter(Boolean) : []; }
function numberArray(value: unknown) { return Array.isArray(value) ? value.map(Number).filter(Number.isInteger) : []; }
function isDimensionKey(value: string): value is StoryboardFinalReviewDimensionKey { return STORYBOARD_FINAL_REVIEW_DIMENSIONS.some((item) => item.key === value); }
function uniqueCaps(values: StoryboardFinalReviewScoreCap[]) { return Array.from(new Map(values.map((value) => [value.id, value])).values()); }

export type StoryboardFinalReviewOptimizationIssue = Pick<StoryboardFinalReviewIssue, "id" | "severity" | "title" | "description" | "suggestion" | "dimensionKeys" | "beatIds" | "shotIndexes">;
export type StoryboardFinalReviewOptimizationInput = {
    contract: "storyboard-final-review-optimization/v1";
    instruction: string;
    shotCount: number;
    shotOrder: number[];
    lockedNarrationChapterIds: string[];
    lockedFields: string[];
    issues: StoryboardFinalReviewOptimizationIssue[];
    dramaturgy?: StoryboardDramaturgyPlan;
    beats: StoryboardSourceBeat[];
    shots: Array<{ shotIndex: number; editable: boolean; narrationLocked: boolean; row: string[]; plan?: StoryboardShotPlan }>;
};
export type StoryboardFinalReviewOptimizationSuccess = { shotIndex: number; row: string[]; plan: StoryboardShotPlan };
export type StoryboardFinalReviewOptimizationFailure = { shotIndex: number; reason: string };
export type StoryboardFinalReviewOptimizationResult = {
    successes: StoryboardFinalReviewOptimizationSuccess[];
    failures: StoryboardFinalReviewOptimizationFailure[];
    ignoredShotIndexes: number[];
};

const optimizationLockedFields = [
    "shotIndex", "sourceBeatIds", "visualBeatIds", "voiceoverBeatIds", "chapterId", "timeStage", "continuityGroupId",
    "transition", "renderMode", "usePreviousTailFrame",
];

/** Selects only located P1/P2 review issues. P0 production failures must use the production repair path. */
export function selectStoryboardFinalReviewOptimizationIssues(
    review: StoryboardFinalReview,
    shotCount: number,
    issueIds?: string[],
): StoryboardFinalReviewOptimizationIssue[] {
    const selectedIds = issueIds?.length ? new Set(issueIds) : undefined;
    const reviewerIssues: StoryboardFinalReviewOptimizationIssue[] = review.issues;
    const deterministicIssues: StoryboardFinalReviewOptimizationIssue[] = review.deterministicFindings.map((issue) => ({
        id: issue.id, severity: issue.severity, title: issue.title, description: issue.evidence.join("；"),
        suggestion: "仅在现有事实边界内定点调整相关镜头，消除该项全片审美问题。", dimensionKeys: [], beatIds: issue.beatIds, shotIndexes: issue.shotIndexes,
    }));
    return Array.from(new Map([...reviewerIssues, ...deterministicIssues].map((issue) => [issue.id, issue])).values()).flatMap((issue) => {
        if (issue.severity === "P0" || selectedIds && !selectedIds.has(issue.id)) return [];
        const shotIndexes = unique(issue.shotIndexes.filter((index) => Number.isInteger(index) && index >= 0 && index < shotCount));
        return shotIndexes.length ? [{ ...issue, beatIds: unique(issue.beatIds), shotIndexes }] : [];
    });
}

export function buildStoryboardFinalReviewOptimizationInput(
    input: StoryboardFinalReviewInput,
    review: StoryboardFinalReview,
    issueIds?: string[],
    lockedNarrationChapterIds: string[] = [],
): StoryboardFinalReviewOptimizationInput {
    const issues = selectStoryboardFinalReviewOptimizationIssues(review, input.rows.length, issueIds);
    const targetIndexes = new Set(issues.flatMap((issue) => issue.shotIndexes));
    const contextIndexes = new Set<number>();
    targetIndexes.forEach((index) => [index - 1, index, index + 1].forEach((value) => {
        if (value >= 0 && value < input.rows.length) contextIndexes.add(value);
    }));
    const relevantBeatIds = new Set([
        ...issues.flatMap((issue) => issue.beatIds),
        ...Array.from(contextIndexes).flatMap((index) => input.shotPlans[index]?.sourceBeatIds || []),
    ]);
    return {
        contract: "storyboard-final-review-optimization/v1",
        instruction: "只优化 editable=true 的现有镜头，并按 shotIndex 返回。不得新增、删除、合并、拆分或重排镜头，不得虚构事实、事实 ID、人物、关系、地点、道具、对白或结局。participants 的姓名、角色、人物时期和来源事实必须原样保留；narrationLocked=true 时对白旁白列必须逐字保留，其他镜头也只能保留或删减已有对白，不得新增或改写台词。输出 shots 数组；每项包含 shotIndex、九列字段 visual/shotSize/lighting/dialogue/sound/camera/imagePrompt（时长固定15s）及完整场景卡字段。所有 lockedFields 必须原样返回。相邻镜头只用于连续性参考，不得返回。",
        shotCount: input.rows.length,
        shotOrder: input.rows.map((_, index) => index),
        lockedNarrationChapterIds: unique(lockedNarrationChapterIds),
        lockedFields: optimizationLockedFields,
        issues,
        dramaturgy: input.dramaturgy,
        beats: input.beats.filter((beat) => relevantBeatIds.has(beat.id)),
        shots: Array.from(contextIndexes).sort((a, b) => a - b).map((shotIndex) => ({
            shotIndex,
            editable: targetIndexes.has(shotIndex),
            narrationLocked: Boolean(input.shotPlans[shotIndex]?.chapterId && lockedNarrationChapterIds.includes(input.shotPlans[shotIndex]?.chapterId || "")),
            row: [...input.rows[shotIndex]],
            plan: input.shotPlans[shotIndex],
        })),
    };
}

/** Strict, per-shot parser. One invalid model item never discards other valid optimized shots. */
export function parseStoryboardFinalReviewOptimization(
    content: string | unknown,
    input: StoryboardFinalReviewInput,
    optimizationInput: StoryboardFinalReviewOptimizationInput,
): StoryboardFinalReviewOptimizationResult {
    let data: unknown;
    try {
        data = typeof content === "string" ? JSON.parse(content.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "").trim()) : content;
    } catch (error) {
        return { successes: [], failures: optimizationInput.issues.flatMap((issue) => issue.shotIndexes).filter((value, index, values) => values.indexOf(value) === index).map((shotIndex) => ({ shotIndex, reason: `优化结果不是合法 JSON：${error instanceof Error ? error.message : String(error)}` })), ignoredShotIndexes: [] };
    }
    const records = Array.isArray(data) ? data : data && typeof data === "object" && Array.isArray((data as { shots?: unknown }).shots) ? (data as { shots: unknown[] }).shots : [];
    const targets = unique(optimizationInput.issues.flatMap((issue) => issue.shotIndexes));
    const targetSet = new Set(targets);
    const seen = new Set<number>();
    const successes: StoryboardFinalReviewOptimizationSuccess[] = [];
    const failures: StoryboardFinalReviewOptimizationFailure[] = [];
    const ignoredShotIndexes: number[] = [];
    records.forEach((record) => {
        const raw = record && typeof record === "object" ? record as Record<string, unknown> : undefined;
        const shotIndex = Number(raw?.shotIndex);
        if (!Number.isInteger(shotIndex) || !targetSet.has(shotIndex)) {
            if (Number.isInteger(shotIndex)) ignoredShotIndexes.push(shotIndex);
            return;
        }
        if (seen.has(shotIndex)) {
            failures.push({ shotIndex, reason: "同一目标镜头返回了多次" });
            return;
        }
        seen.add(shotIndex);
        const originalPlan = input.shotPlans[shotIndex];
        if (!originalPlan) {
            failures.push({ shotIndex, reason: "原镜头缺少场景卡，必须先修复生产问题" });
            return;
        }
        const lockedMismatch = optimizationLockedFields.some((field) => field !== "shotIndex" && !sameLockedValue(raw[field], originalPlan[field as keyof StoryboardShotPlan]));
        if (lockedMismatch) {
            failures.push({ shotIndex, reason: "模型修改或遗漏了锁定字段" });
            return;
        }
        let parsed: PlannedStoryboardShot | undefined;
        try { parsed = parsePlannedStoryboardShots(JSON.stringify([raw]))[0]; } catch { parsed = undefined; }
        if (!parsed) {
            failures.push({ shotIndex, reason: "模型没有返回完整可解析的九列镜头与场景卡" });
            return;
        }
        parsed.plan = { ...parsed.plan, ...pickLockedPlan(originalPlan) };
        const originalParticipants = participantIdentity(originalPlan);
        if (participantIdentity(parsed.plan) !== originalParticipants) {
            failures.push({ shotIndex, reason: "模型修改了锁定的人物身份、时期、角色或来源事实" });
            return;
        }
        const originalSpeech = storyboardSpeechParts(input.rows[shotIndex]?.[5] || "");
        const optimizedSpeech = storyboardSpeechParts(parsed.row[5] || "");
        if (optimizedSpeech.dialogues.some((dialogue) => !originalSpeech.dialogues.some((original) => original.includes(dialogue)))) {
            failures.push({ shotIndex, reason: "模型新增或改写了原镜头中不存在的对白" });
            return;
        }
        if (originalPlan.chapterId && optimizationInput.lockedNarrationChapterIds.includes(originalPlan.chapterId) && parsed.row[5] !== input.rows[shotIndex]?.[5]) {
            failures.push({ shotIndex, reason: "本章旁白已经人工锁定，必须逐字保留对白旁白列" });
            return;
        }
        const allowedBeatIds = new Set(input.beats.map((beat) => beat.id));
        const returnedBeatIds = [
            ...parsed.plan.sourceBeatIds, ...(parsed.plan.visualBeatIds || []), ...(parsed.plan.voiceoverBeatIds || []),
            ...(parsed.plan.participants || []).flatMap((participant) => participant.sourceBeatIds || []),
        ];
        if (returnedBeatIds.some((id) => !allowedBeatIds.has(id))) {
            failures.push({ shotIndex, reason: "模型返回了来源中不存在的事实 ID" });
            return;
        }
        const qualityIssues = storyboardShotQualityIssuesForShot(parsed);
        if (qualityIssues.length) {
            failures.push({ shotIndex, reason: qualityIssues.join("；") });
            return;
        }
        successes.push({ shotIndex, row: parsed.row, plan: parsed.plan });
    });
    targets.filter((shotIndex) => !seen.has(shotIndex)).forEach((shotIndex) => failures.push({ shotIndex, reason: "模型未返回该目标镜头" }));
    const failedIndexes = new Set(failures.map((item) => item.shotIndex));
    return { successes: successes.filter((item) => !failedIndexes.has(item.shotIndex)), failures, ignoredShotIndexes: unique(ignoredShotIndexes) };
}

function sameLockedValue(actual: unknown, expected: unknown) {
    if (Array.isArray(expected)) return Array.isArray(actual) && actual.length === expected.length && actual.every((value, index) => value === expected[index]);
    return actual === expected;
}

function pickLockedPlan(plan: StoryboardShotPlan): Partial<StoryboardShotPlan> {
    return {
        sourceBeatIds: [...plan.sourceBeatIds], visualBeatIds: [...(plan.visualBeatIds || [])], voiceoverBeatIds: [...(plan.voiceoverBeatIds || [])],
        chapterId: plan.chapterId, timeStage: plan.timeStage, continuityGroupId: plan.continuityGroupId, transition: plan.transition,
        renderMode: plan.renderMode, usePreviousTailFrame: plan.usePreviousTailFrame,
    };
}

function participantIdentity(plan: StoryboardShotPlan) {
    return JSON.stringify((plan.participants || []).map((participant) => ({
        name: participant.name,
        role: participant.role,
        lifeStage: participant.lifeStage || "",
        sourceBeatIds: [...(participant.sourceBeatIds || [])],
    })).sort((left, right) => `${left.name}|${left.role}|${left.lifeStage}|${left.sourceBeatIds.join(",")}`.localeCompare(`${right.name}|${right.role}|${right.lifeStage}|${right.sourceBeatIds.join(",")}`)));
}

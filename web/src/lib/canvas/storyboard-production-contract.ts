import { storyboardActionBeatSegmentIndex, storyboardSpeechParts } from "@/lib/canvas/storyboard-planning";
import type {
    StoryboardAsset,
    StoryboardAssetKind,
    StoryboardPromptDetail,
    StoryboardShotParticipant,
    StoryboardShotPlan,
    StoryboardShotRenderMode,
    StoryboardSourceBeat,
    StoryboardDramaturgyPlan,
    StoryboardTypedActionBeat,
    StoryboardVideoReference,
} from "@/types/canvas";

export type StoryboardProductionContractStage = "planning" | "assets" | "prompt" | "draft" | "submit";
export type StoryboardProductionIssueLevel = "blocked" | "warning";
export type StoryboardProductionAssetRole = "characterIdentity" | "sceneSpace" | "propContinuity" | "supplementalReference" | "firstFrame" | "lastFrame";

export type StoryboardProductionIssue = {
    code: string;
    level: StoryboardProductionIssueLevel;
    message: string;
    field?: string;
};

export type StoryboardProductionAssetBinding = {
    mention: string;
    referenceIndex: number;
    role: StoryboardProductionAssetRole;
    assetId?: string;
    name?: string;
    baseName?: string;
    kind?: StoryboardAssetKind;
    lifeStage?: string;
};

export type StoryboardProductionSpeechCue = {
    type: "dialogue" | "voiceover" | "ambient";
    text: string;
};

export type StoryboardProductionContract = {
    format?: StoryboardDramaturgyPlan["format"];
    sourceBeatIds: string[];
    sourceBeats: StoryboardSourceBeat[];
    missingSourceBeatIds: string[];
    visualFactId?: string;
    visualFact?: StoryboardSourceBeat;
    location: string;
    timeStage: string;
    timeStages: string[];
    participants: StoryboardShotParticipant[];
    sceneAsset?: StoryboardProductionAssetBinding;
    propAssets: StoryboardProductionAssetBinding[];
    assets: StoryboardProductionAssetBinding[];
    actionBeats: StoryboardTypedActionBeat[];
    untypedActionBeats: string[];
    startState: string;
    endState: string;
    result: string;
    speechCues: StoryboardProductionSpeechCue[];
    duration: number;
    renderMode: StoryboardShotRenderMode;
    continuity: {
        groupId: string;
        transition: StoryboardShotPlan["transition"];
        usePreviousTailFrame: boolean;
    };
    sceneCard: Pick<StoryboardShotPlan, "goal" | "obstacle" | "stakes" | "tactic" | "obstacleReaction" | "turningAction" | "valueShift">;
    assetMentions: string[];
    orderedReferenceMentions: string[];
    hasExplicitReferenceOrder: boolean;
    videoMotionPrompt: string;
};

export type StoryboardProductionContractInput = {
    sourceBeats: StoryboardSourceBeat[];
    format?: StoryboardDramaturgyPlan["format"];
    shotPlan?: StoryboardShotPlan;
    row: string[];
    assets?: StoryboardAsset[];
    promptDetail?: StoryboardPromptDetail;
    orderedReferences?: StoryboardVideoReference[];
};

export type StoryboardProductionContractValidation = {
    status: "blocked" | "warning" | "passed";
    issues: StoryboardProductionIssue[];
};

export function assembleStoryboardProductionContract(input: StoryboardProductionContractInput): StoryboardProductionContract {
    const plan = input.shotPlan;
    const beatById = new Map(input.sourceBeats.map((beat) => [beat.id, beat]));
    const sourceBeatIds = unique(plan?.sourceBeatIds || []);
    const sourceBeats = sourceBeatIds.map((id) => beatById.get(id)).filter((beat): beat is StoryboardSourceBeat => Boolean(beat));
    const missingSourceBeatIds = sourceBeatIds.filter((id) => !beatById.has(id));
    const visualFactId = plan?.visualBeatIds?.length === 1 ? plan.visualBeatIds[0] : undefined;
    const visualFact = visualFactId ? beatById.get(visualFactId) : undefined;
    const references = input.orderedReferences || (input.promptDetail?.assetMentionLinks || []).map((link) => ({ ...link, role: link.kind === "scene" ? "sceneLock" : "reference" } satisfies StoryboardVideoReference));
    const assetById = new Map((input.assets || []).map((asset) => [asset.id, asset]));
    const assetByMention = new Map((input.assets || []).map((asset) => [mention(asset.name), asset]));
    const bindings = references.map((reference, referenceIndex) => productionAssetBinding(reference, referenceIndex, assetById, assetByMention));
    const speech = storyboardSpeechParts(input.row[5] || "");
    const speechCues: StoryboardProductionSpeechCue[] = [
        ...speech.dialogues.map((text) => ({ type: "dialogue" as const, text })),
        ...(speech.narration ? [{ type: "voiceover" as const, text: speech.narration }] : []),
        ...(input.row[6]?.trim() ? [{ type: "ambient" as const, text: input.row[6].trim() }] : []),
    ];
    return {
        sourceBeatIds,
        format: input.format,
        sourceBeats,
        missingSourceBeatIds,
        visualFactId,
        visualFact,
        location: visualFact?.location.trim() || "",
        timeStage: plan?.timeStage?.trim() || visualFact?.timeStage.trim() || "",
        timeStages: mergeKnownCharacterAgeStages(plan?.timeStage || "", visualFact?.timeStage || ""),
        participants: plan?.participants || [],
        sceneAsset: bindings.find((binding) => binding.role === "sceneSpace"),
        propAssets: bindings.filter((binding) => binding.role === "propContinuity"),
        assets: bindings,
        actionBeats: plan?.typedActionBeats || [],
        untypedActionBeats: plan?.actionBeats || [],
        startState: plan?.startState?.trim() || "",
        endState: plan?.endState?.trim() || "",
        result: plan?.result?.trim() || "",
        speechCues,
        duration: parseDuration(input.row[1]),
        renderMode: plan?.renderMode || "video",
        continuity: { groupId: plan?.continuityGroupId?.trim() || "", transition: plan?.transition || "cut", usePreviousTailFrame: plan?.usePreviousTailFrame === true },
        sceneCard: { goal: plan?.goal, obstacle: plan?.obstacle, stakes: plan?.stakes, tactic: plan?.tactic, obstacleReaction: plan?.obstacleReaction, turningAction: plan?.turningAction, valueShift: plan?.valueShift },
        assetMentions: unique((input.promptDetail?.assetMentions || []).map(mention).filter(Boolean)),
        orderedReferenceMentions: bindings.filter((binding) => binding.assetId || binding.kind).map((binding) => binding.mention),
        hasExplicitReferenceOrder: Boolean(input.orderedReferences),
        videoMotionPrompt: input.promptDetail?.videoMotionPrompt?.trim() || "",
    };
}

export function validateStoryboardProductionContract(contract: StoryboardProductionContract, stage: StoryboardProductionContractStage): StoryboardProductionContractValidation {
    const issues: StoryboardProductionIssue[] = [];
    const add = (code: string, level: StoryboardProductionIssueLevel, message: string, field?: string) => issues.push({ code, level, message, field });
    const block = (code: string, message: string, field?: string) => add(code, "blocked", message, field);
    const warn = (code: string, message: string, field?: string) => add(code, "warning", message, field);
    const video = contract.renderMode === "video";

    if (!contract.sourceBeatIds.length) block("source_fact_missing", "镜头没有绑定任何事实 ID", "sourceBeatIds");
    if (contract.missingSourceBeatIds.length) block("source_fact_unknown", `镜头引用了不存在的事实 ID：${contract.missingSourceBeatIds.join("、")}`, "sourceBeatIds");
    if (video && !contract.visualFactId) block("visual_fact_count", "动态镜头必须且只能绑定一个主要可见事实", "visualBeatIds");
    if (contract.visualFactId && !contract.sourceBeatIds.includes(contract.visualFactId)) block("visual_fact_outside_source", "主要可见事实不在镜头事实 ID 中", "visualBeatIds");
    if (contract.visualFactId && !contract.visualFact) block("visual_fact_unknown", `主要可见事实不存在：${contract.visualFactId}`, "visualBeatIds");
    if (video && !contract.location) block("location_missing", "主要可见事实缺少地点", "location");
    const hasHumanRole = contract.assets.some((asset) => asset.kind === "character") || Boolean(contract.visualFact?.characters.length) || contract.participants.some((participant) => /人物|角色|婴儿|新生儿|宝宝|幼儿|少年|少女|青年|成人|老人/.test(`${participant.name} ${participant.lifeStage || ""}`));
    if (video && hasHumanRole && !contract.timeStage) block("character_stage_missing", "包含人物的动态镜头缺少唯一人物时期", "timeStage");
    if (video && contract.format !== "concept" && contract.timeStages.length > 1) block("multiple_time_stages", `单个动态镜头包含多个故事时期：${contract.timeStages.join("、")}`, "timeStage");
    const characterStages = new Map<string, string[][]>();
    contract.participants.forEach((item) => addCharacterStage(characterStages, item.name, item.lifeStage));
    contract.assets.filter((item) => item.kind === "character").forEach((item) => addCharacterStage(characterStages, item.baseName || item.name || "", item.lifeStage));
    for (const [name, evidenceStages] of characterStages) {
        const sharedStages = evidenceStages.reduce((shared, stages, index) => index ? shared.filter((stage) => stages.includes(stage)) : stages, [] as string[]);
        if (evidenceStages.length > 1 && !sharedStages.length) block("multiple_character_stages", `人物“${name}”在同一镜头绑定了多个年龄/时期：${unique(evidenceStages.map((stages) => stages.join("/"))).join("、")}`, "participants");
    }
    if (!contract.duration) block("duration_missing", "镜头时长无效或缺失", "duration");
    if (!contract.continuity.groupId) warn("continuity_group_missing", "镜头没有连续性分组，后续片段无法可靠承接", "continuityGroupId");

    if (video) validateSceneCard(contract, block);
    if (video && hasHumanRole) validateParticipants(contract, block);
    if (video && atLeast(stage, "assets")) validateAssets(contract, block);
    if (video && atLeast(stage, "prompt")) validateFinalPrompt(contract, block);
    if (stage === "planning" && !contract.participants.length) warn("production_roles_pending", "第一步尚未形成明确的动作执行者和承受者", "participants");

    return { status: issues.some((issue) => issue.level === "blocked") ? "blocked" : issues.length ? "warning" : "passed", issues };
}

export function auditStoryboardProductionContract(input: StoryboardProductionContractInput, stage: StoryboardProductionContractStage) {
    const contract = assembleStoryboardProductionContract(input);
    return { contract, ...validateStoryboardProductionContract(contract, stage) };
}

function validateSceneCard(contract: StoryboardProductionContract, block: (code: string, message: string, field?: string) => void) {
    const required: Array<[keyof StoryboardProductionContract["sceneCard"], string]> = [
        ["goal", "当前目标"], ["obstacle", "可见阻力"], ["stakes", "失败代价"], ["tactic", "人物策略"],
        ["obstacleReaction", "阻力反作用"], ["turningAction", "动作转折"], ["valueShift", "价值变化"],
    ];
    required.forEach(([field, label]) => {
        if (!contract.sceneCard[field]?.trim()) block(`scene_card_${field}_missing`, `场景卡缺少${label}`, field);
    });
    if (!contract.startState) block("scene_card_start_missing", "场景卡缺少起始状态", "startState");
    if (!contract.endState) block("scene_card_end_missing", "场景卡缺少结束状态", "endState");
    if (!contract.result) block("scene_card_result_missing", "场景卡缺少可见结果", "result");
    if (contract.untypedActionBeats.length < 2 || contract.untypedActionBeats.length > 3) block("scene_card_action_count", "场景卡必须包含 2-3 个因果动作节拍", "actionBeats");
    if (contract.actionBeats.length < 2 || contract.actionBeats.length > 3) block("typed_action_count", "生产契约必须包含 2-3 个类型化动作节拍", "typedActionBeats");
}

function validateParticipants(contract: StoryboardProductionContract, block: (code: string, message: string, field?: string) => void) {
    const actors = new Set(contract.participants.filter((item) => item.role === "actor").map((item) => storyboardCharacterBaseName(item.name)).filter(Boolean));
    const participantNames = new Set(contract.participants.map((item) => storyboardCharacterBaseName(item.name)).filter(Boolean));
    const patients = new Set(contract.participants.filter((item) => item.role === "patient").map((item) => storyboardCharacterBaseName(item.name)).filter(Boolean));
    const factualCharacters = new Set(contract.sourceBeats.flatMap((beat) => beat.characters).map(storyboardCharacterBaseName).filter(Boolean));
    if (!actors.size) block("actor_missing", "动态镜头缺少明确的动作执行者", "participants");
    contract.participants.forEach((participant, index) => {
        if (!participant.name.trim()) block("participant_name_missing", `参与者 ${index + 1} 缺少名称`, "participants");
        if (!participant.sourceBeatIds.length || participant.sourceBeatIds.some((id) => !contract.sourceBeatIds.includes(id))) block("participant_fact_ungrounded", `参与者“${participant.name || index + 1}”没有完整绑定当前镜头事实 ID`, "participants");
    });
    contract.actionBeats.forEach((beat, index) => {
        const actorBaseName = storyboardCharacterBaseName(beat.actor);
        if (!actors.has(actorBaseName)) block("action_actor_unbound", `动作节拍 ${index + 1} 的执行者“${beat.actor}”未绑定 actor 职责`, "typedActionBeats");
        if (factualCharacters.size && !factualCharacters.has(actorBaseName)) block("action_actor_ungrounded", `动作节拍 ${index + 1} 的执行者“${beat.actor}”不是当前事实中的人物`, "typedActionBeats");
        const patientBaseName = storyboardCharacterBaseName(beat.patient);
        if ((participantNames.has(patientBaseName) || factualCharacters.has(patientBaseName)) && !patients.has(patientBaseName)) block("action_patient_unbound", `动作节拍 ${index + 1} 命中的人物承受者“${beat.patient}”未绑定 patient 职责`, "typedActionBeats");
        if (!beat.action.trim()) block("action_missing", `动作节拍 ${index + 1} 缺少可见物理动作`, "typedActionBeats");
        const actor = contract.participants.find((item) => storyboardCharacterBaseName(item.name) === actorBaseName && item.role === "actor");
        const actorAssets = contract.assets.filter((item) => item.kind === "character" && storyboardCharacterBaseName(item.baseName || item.name || "") === actorBaseName);
        if (actor && (isInfant(`${actor.name} ${actor.lifeStage || ""}`) || actorAssets.some((item) => isInfant(`${item.name} ${item.lifeStage || ""}`))) && isAdultCareAction(beat.action)) block("infant_adult_care_action", `婴儿参与者“${actor.name}”不能执行成人照护动作：${beat.action}`, "typedActionBeats");
    });
}

export function storyboardCharacterBaseName(value: string) {
    return value.trim()
        .replace(/^(?:(?:\d{1,3}|[零〇一二两三四五六七八九十百]{1,5})岁(?:时期|阶段|时)?的?)/u, "")
        .replace(/^(?:新生儿|婴儿|幼儿|童年|少年|少女|青年|年轻|成年|中年|晚年|老年)[时期阶段的\s·：:-]*/u, "")
        .replace(/[\s·：:-]*(?:新生儿|婴儿|幼儿|童年|少年|少女|青年|年轻|成年|中年|晚年|老年)(?:时期|阶段)?$/u, "")
        .trim();
}

function validateAssets(contract: StoryboardProductionContract, block: (code: string, message: string, field?: string) => void) {
    if (!contract.assets.length) {
        if (contract.assetMentions.length) block("references_missing", "提示词声明了参考资产，但当前镜头尚未形成有序参考素材列表", "orderedReferences");
        return;
    }
    contract.assets.forEach((asset, index) => {
        if (["characterIdentity", "sceneSpace", "propContinuity"].includes(asset.role) && (!asset.assetId || !asset.kind || !asset.name)) block("asset_reference_unknown", `参考位 ${index + 1} 未绑定已知资产：${asset.mention}`, "orderedReferences");
        if (!assetRoleMatchesKind(asset.role, asset.kind)) block("asset_role_kind_mismatch", `参考位 ${index + 1} 的资产职责 ${asset.role} 与类型 ${asset.kind || "未知"} 不一致`, "orderedReferences");
    });
    const scenes = contract.assets.filter((asset) => asset.role === "sceneSpace");
    if (!scenes.length && contract.assets.some((asset) => asset.role === "characterIdentity" || asset.role === "propContinuity")) block("scene_asset_missing", "绑定人物或道具的动态镜头必须同时绑定唯一场景空间参考", "orderedReferences");
    if (scenes.length > 1) block("multiple_scene_assets", "动态镜头只能绑定一个场景空间参考", "orderedReferences");
    if (contract.propAssets.length > 1) block("multiple_prop_assets", "普通动态镜头最多绑定一个关键道具参考", "orderedReferences");
}

function validateFinalPrompt(contract: StoryboardProductionContract, block: (code: string, message: string, field?: string) => void) {
    if (!contract.videoMotionPrompt) {
        block("final_prompt_missing", "动态镜头缺少最终视频运动提示词", "videoMotionPrompt");
        return;
    }
    if (!contract.hasExplicitReferenceOrder) block("ordered_references_missing", "最终校验缺少实际有序参考数组", "orderedReferences");
    if (!sameList(contract.assetMentions, contract.orderedReferenceMentions)) block("asset_reference_order_mismatch", `提示词资产顺序与实际参考数组不一致：${contract.assetMentions.join("、") || "无"} / ${contract.orderedReferenceMentions.join("、") || "无"}`, "assetMentions");
    const segments = parseTimeline(contract.videoMotionPrompt);
    if (segments.length !== 4) {
        block("timeline_segment_count", "最终提示词必须包含四段式秒级画面时间轴", "videoMotionPrompt");
        return;
    }
    const continuous = segments[0].start === 0 && segments.at(-1)?.end === contract.duration && segments.every((segment, index) => segment.end > segment.start && (!index || segment.start === segments[index - 1].end));
    if (!continuous) block("timeline_coverage_invalid", `四段时间轴必须从 0 秒连续覆盖到 ${contract.duration} 秒`, "videoMotionPrompt");
    const expected15s = [[0, 3], [3, 9], [9, 12], [12, 15]];
    if (contract.duration === 15 && segments.some((segment, index) => segment.start !== expected15s[index][0] || segment.end !== expected15s[index][1])) block("timeline_15s_ranges_invalid", "15 秒镜头必须使用 0-3、3-9、9-12、12-15 秒四段时间轴", "videoMotionPrompt");
    if (!/稳定|保持|停住|静止|落点|不再/.test(segments.at(-1)?.content || "")) block("timeline_final_unstable", "最后一段必须保持已形成的结果，不得引入新剧情", "videoMotionPrompt");
    const timelineText = segments.map((segment) => segment.content).join("\n");
    const participantNames = new Set(contract.participants.map((participant) => storyboardCharacterBaseName(participant.name)));
    const propNames = new Set(contract.actionBeats.map((beat) => beat.prop).filter((name): name is string => Boolean(name)));
    contract.assets.filter((asset) =>
        (asset.role === "characterIdentity" && participantNames.has(storyboardCharacterBaseName(asset.baseName || asset.name || "")))
        || (asset.role === "propContinuity" && (propNames.has(asset.name || "") || Array.from(propNames).some((name) => Boolean(asset.name?.includes(name))))),
    ).forEach((asset) => {
        const matchingBeatIndexes = contract.actionBeats.flatMap((beat, index) => {
            const assetCharacterName = storyboardCharacterBaseName(asset.baseName || asset.name || "");
            const characterMatch = asset.role === "characterIdentity" && [beat.actor, beat.patient].some((name) => storyboardCharacterBaseName(name) === assetCharacterName);
            const propMatch = asset.role === "propContinuity" && Boolean(beat.prop && (beat.prop === asset.name || Boolean(asset.name?.includes(beat.prop))));
            return characterMatch || propMatch ? [storyboardActionBeatSegmentIndex(contract.actionBeats.length, index)] : [];
        });
        const targetSegments = matchingBeatIndexes.length ? Array.from(new Set(matchingBeatIndexes)).map((index) => segments[index]?.content || "") : [timelineText];
        if (!targetSegments.every((segment) => hasExactMention(segment, asset.mention))) block("asset_missing_from_action_timeline", `${asset.mention}只声明了参考职责，没有在每个实际参与的动作时间段中使用`, "videoMotionPrompt");
    });
    const startFrame = contract.videoMotionPrompt.match(/【起始画面】([\s\S]*?)【\d+秒时间轴】/)?.[1] || "";
    contract.assets.filter((asset) => asset.role === "sceneSpace").forEach((asset) => {
        if (!hasExactMention(`${startFrame}\n${segments[0]?.content || ""}`, asset.mention)) block("scene_missing_from_opening", `${asset.mention}必须出现在起始画面或首段建场动作中`, "videoMotionPrompt");
    });
}

function productionAssetBinding(reference: StoryboardVideoReference, referenceIndex: number, assetById: Map<string, StoryboardAsset>, assetByMention: Map<string, StoryboardAsset>): StoryboardProductionAssetBinding {
    const normalizedMention = mention(reference.mention || reference.name);
    const asset = (reference.assetId ? assetById.get(reference.assetId) : undefined) || assetByMention.get(normalizedMention);
    const kind = asset?.kind || reference.kind;
    return {
        mention: normalizedMention,
        referenceIndex,
        role: reference.role === "firstFrame" ? "firstFrame" : reference.role === "lastFrame" ? "lastFrame" : reference.role === "sceneLock" ? "sceneSpace" : kind === "character" ? "characterIdentity" : kind === "scene" ? "sceneSpace" : kind === "prop" ? "propContinuity" : "supplementalReference",
        assetId: asset?.id || reference.assetId,
        name: asset?.name || reference.name,
        baseName: asset?.baseName,
        kind,
        lifeStage: asset?.lifeStage,
    };
}

function assetRoleMatchesKind(role: StoryboardProductionAssetRole, kind?: StoryboardAssetKind) {
    if (role === "firstFrame" || role === "lastFrame" || role === "supplementalReference") return true;
    return role === "characterIdentity" ? kind === "character" : role === "sceneSpace" ? kind === "scene" : kind === "prop";
}

function parseTimeline(prompt: string) {
    const body = prompt.match(/【\d+(?:\.\d+)?秒时间轴】([\s\S]*?)【镜头运动】/)?.[1] || prompt;
    return Array.from(body.matchAll(/(?:^|\n)\s*(\d+(?:\.\d+)?)\s*[-—–~至]\s*(\d+(?:\.\d+)?)\s*秒\s*[：:]([^\n]+)/g)).map((item) => ({ start: Number(item[1]), end: Number(item[2]), content: item[3].trim() }));
}

function isInfant(value: string) {
    return /出生|新生儿|婴儿|宝宝|襁褓|幼儿/.test(value);
}

function isAdultCareAction(value: string) {
    return /抱起|抱住|托住|喂养|喂奶|换尿布|照料|照护|护理|包裹|拢紧|整理襁褓|调整包裹|安置|放入婴儿篮|穿衣|擦洗/.test(value);
}

function parseDuration(value?: string) {
    const duration = Number(String(value || "").match(/\d+(?:\.\d+)?/)?.[0]);
    return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

function mention(value: string) {
    const name = value.trim().replace(/^@+/, "");
    return name ? `@${name}` : "";
}

function hasExactMention(text: string, value: string) {
    const escaped = mention(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return Boolean(escaped && new RegExp(`${escaped}(?=$|[\\s，,、。；;：:）)】\\]])`).test(text));
}

function unique(values: string[]) {
    return Array.from(new Set(values));
}

function normalizeTimeStage(value: string) {
    return value.trim().replace(/\s+/g, "").replace(/(?:时期|阶段|时候)$/, "");
}

function sameList(first: string[], second: string[]) {
    return first.length === second.length && first.every((value, index) => value === second[index]);
}

function addCharacterStage(groups: Map<string, string[][]>, name: string, stage?: string) {
    const normalizedName = storyboardCharacterBaseName(name);
    if (!normalizedName || !stage?.trim()) return;
    const normalizedStage = normalizeTimeStage(stage);
    const candidates = normalizeKnownCharacterAgeStages(normalizedStage);
    groups.set(normalizedName, [...(groups.get(normalizedName) || []), candidates.length ? candidates : [normalizedStage]]);
}

function normalizeKnownCharacterAgeStages(value: string) {
    const stage = normalizeTimeStage(value);
    const age = parseCharacterAge(stage);
    if (age !== undefined) {
        const [minAge, maxAge] = Array.isArray(age) ? age : [age, age];
        const ranges: Array<[number, number, string]> = [[0, 2, "婴儿"], [3, 11, "年少"], [12, 17, "少年"], [18, 39, "青年"], [40, 59, "中年"], [60, 120, "晚年"]];
        return ranges.filter(([min, max]) => maxAge >= min && minAge <= max).map(([, , label]) => label);
    }
    if (/出生|新生|婴儿|宝宝|襁褓/.test(stage)) return ["婴儿"];
    if (/童年|年少|儿童|幼年|年幼|孩童|幼儿|儿时/.test(stage)) return ["年少"];
    if (/少年|少女|青春期/.test(stage)) return ["少年"];
    if (/青年|年轻/.test(stage)) return ["青年"];
    if (/中年|壮年/.test(stage)) return ["中年"];
    if (/老年|晚年|年老/.test(stage)) return ["晚年"];
    if (/成年|成人/.test(stage)) return ["成年"];
    return [];
}

function mergeKnownCharacterAgeStages(firstValue: string, secondValue: string) {
    const first = normalizeKnownCharacterAgeStages(firstValue);
    const second = normalizeKnownCharacterAgeStages(secondValue);
    if (!first.length) return second.length ? [second.join("/")] : [];
    if (!second.length) return [first.join("/")];
    const shared = first.filter((stage) => second.includes(stage));
    return shared.length ? [shared.join("/")] : unique([...first, ...second]);
}

function parseCharacterAge(value: string) {
    const arabicAge = value.match(/(?:^|\D)(\d{1,3})岁/)?.[1];
    if (arabicAge !== undefined) {
        const age = Number(arabicAge);
        return validCharacterAge(age) ? age : undefined;
    }
    const chineseAge = value.match(/(?:^|[^零〇一二两三四五六七八九十百])([零〇一二两三四五六七八九十百]{1,5})岁/)?.[1];
    if (!chineseAge) return undefined;
    const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
    const hundredAge = chineseAge.match(/^一百(?:零([一二两三四五六七八九])|([一二两三四五六七八九])十([一二两三四五六七八九])?)?$/);
    if (hundredAge) {
        const age = 100 + (hundredAge[1] ? digits[hundredAge[1]] : hundredAge[2] ? digits[hundredAge[2]] * 10 + (digits[hundredAge[3]] || 0) : 0);
        return validCharacterAge(age) ? age : undefined;
    }
    const rangePatterns: Array<[RegExp, (match: RegExpMatchArray) => [number, number]]> = [
        [/^([一二两三四五六七八九])([一二两三四五六七八九])$/, (match) => [digits[match[1]], digits[match[2]]]],
        [/^十([一二两三四五六七八九])([一二两三四五六七八九])$/, (match) => [10 + digits[match[1]], 10 + digits[match[2]]]],
        [/^([一二两三四五六七八九])十([一二两三四五六七八九])([一二两三四五六七八九])$/, (match) => [digits[match[1]] * 10 + digits[match[2]], digits[match[1]] * 10 + digits[match[3]]]],
        [/^([一二两三四五六七八九])([一二两三四五六七八九])十$/, (match) => [digits[match[1]] * 10, digits[match[2]] * 10]],
    ];
    for (const [pattern, toRange] of rangePatterns) {
        const match = chineseAge.match(pattern);
        if (match) return normalizeCharacterAgeRange(...toRange(match));
    }
    const exact = chineseAge.match(/^十([一二两三四五六七八九])?$/)
        ? 10 + (digits[chineseAge.slice(1)] || 0)
        : chineseAge.match(/^([一二两三四五六七八九])十([一二两三四五六七八九])?$/)
            ? digits[chineseAge[0]] * 10 + (digits[chineseAge.slice(2)] || 0)
            : digits[chineseAge];
    return validCharacterAge(exact) ? exact : undefined;
}

function normalizeCharacterAgeRange(first: number, second: number): [number, number] | undefined {
    if (!validCharacterAge(first) || !validCharacterAge(second)) return undefined;
    return [Math.min(first, second), Math.max(first, second)];
}

function validCharacterAge(age: number) {
    return Number.isFinite(age) && age >= 0 && age <= 120;
}

function atLeast(stage: StoryboardProductionContractStage, expected: StoryboardProductionContractStage) {
    return ["planning", "assets", "prompt", "draft", "submit"].indexOf(stage) >= ["planning", "assets", "prompt", "draft", "submit"].indexOf(expected);
}

import { storyboardSpeechParts } from "@/lib/canvas/storyboard-planning";
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
        timeStages: unique([plan?.timeStage || "", ...sourceBeats.map((beat) => beat.timeStage)].map((value) => value.trim()).filter(Boolean)),
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
    const hasHumanRole = contract.assets.some((asset) => asset.kind === "character") || contract.sourceBeats.some((beat) => beat.characters.length > 0) || contract.participants.some((participant) => /人物|角色|婴儿|新生儿|宝宝|幼儿|少年|少女|青年|成人|老人/.test(`${participant.name} ${participant.lifeStage || ""}`));
    if (video && hasHumanRole && !contract.timeStage) block("character_stage_missing", "包含人物的动态镜头缺少唯一人物时期", "timeStage");
    const locations = unique(contract.sourceBeats.map((beat) => beat.location.trim()).filter(Boolean));
    if (video && locations.length > 1) block("multiple_locations", `单个动态镜头包含多个地点：${locations.join("、")}`, "sourceBeatIds");
    if (video && contract.format !== "concept" && contract.timeStages.length > 1) block("multiple_time_stages", `单个动态镜头包含多个故事时期：${contract.timeStages.join("、")}`, "timeStage");
    const characterStages = new Map<string, Set<string>>();
    contract.participants.forEach((item) => addCharacterStage(characterStages, item.name, item.lifeStage));
    contract.assets.filter((item) => item.kind === "character").forEach((item) => addCharacterStage(characterStages, item.baseName || item.name || "", item.lifeStage));
    for (const [name, values] of characterStages) {
        if (values.size > 1) block("multiple_character_stages", `人物“${name}”在同一镜头绑定了多个年龄/时期：${Array.from(values).join("、")}`, "participants");
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
    if (contract.untypedActionBeats.length < 2 || contract.untypedActionBeats.length > 4) block("scene_card_action_count", "场景卡必须包含 2-4 个因果动作节拍", "actionBeats");
    if (contract.actionBeats.length < 2 || contract.actionBeats.length > 4) block("typed_action_count", "生产契约必须包含 2-4 个类型化动作节拍", "typedActionBeats");
}

function validateParticipants(contract: StoryboardProductionContract, block: (code: string, message: string, field?: string) => void) {
    const actors = new Set(contract.participants.filter((item) => item.role === "actor").map((item) => item.name.trim()).filter(Boolean));
    const patients = new Set(contract.participants.filter((item) => item.role === "patient").map((item) => item.name.trim()).filter(Boolean));
    if (!actors.size) block("actor_missing", "动态镜头缺少明确的动作执行者", "participants");
    if (!patients.size) block("patient_missing", "动态镜头缺少明确的动作承受者", "participants");
    contract.participants.forEach((participant, index) => {
        if (!participant.name.trim()) block("participant_name_missing", `参与者 ${index + 1} 缺少名称`, "participants");
        if (!participant.sourceBeatIds.length || participant.sourceBeatIds.some((id) => !contract.sourceBeatIds.includes(id))) block("participant_fact_ungrounded", `参与者“${participant.name || index + 1}”没有完整绑定当前镜头事实 ID`, "participants");
    });
    contract.actionBeats.forEach((beat, index) => {
        if (!actors.has(beat.actor.trim())) block("action_actor_unbound", `动作节拍 ${index + 1} 的执行者“${beat.actor}”未绑定 actor 职责`, "typedActionBeats");
        if (!patients.has(beat.patient.trim())) block("action_patient_unbound", `动作节拍 ${index + 1} 的承受者“${beat.patient}”未绑定 patient 职责`, "typedActionBeats");
        if (!beat.action.trim()) block("action_missing", `动作节拍 ${index + 1} 缺少可见物理动作`, "typedActionBeats");
        const actor = contract.participants.find((item) => item.name === beat.actor && item.role === "actor");
        const actorAssets = contract.assets.filter((item) => item.kind === "character" && (item.name === beat.actor || item.baseName === beat.actor));
        if (actor && (isInfant(`${actor.name} ${actor.lifeStage || ""}`) || actorAssets.some((item) => isInfant(`${item.name} ${item.lifeStage || ""}`))) && isAdultCareAction(beat.action)) block("infant_adult_care_action", `婴儿参与者“${actor.name}”不能执行成人照护动作：${beat.action}`, "typedActionBeats");
    });
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

function unique(values: string[]) {
    return Array.from(new Set(values));
}

function sameList(first: string[], second: string[]) {
    return first.length === second.length && first.every((value, index) => value === second[index]);
}

function addCharacterStage(groups: Map<string, Set<string>>, name: string, stage?: string) {
    if (!name.trim() || !stage?.trim()) return;
    groups.set(name.trim(), new Set([...(groups.get(name.trim()) || []), stage.trim()]));
}

function atLeast(stage: StoryboardProductionContractStage, expected: StoryboardProductionContractStage) {
    return ["planning", "assets", "prompt", "draft", "submit"].indexOf(stage) >= ["planning", "assets", "prompt", "draft", "submit"].indexOf(expected);
}

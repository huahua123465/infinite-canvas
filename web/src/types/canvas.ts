export type Position = {
    x: number;
    y: number;
};

export type ViewportTransform = {
    x: number;
    y: number;
    k: number;
};

export enum CanvasNodeType {
    Image = "image",
    Text = "text",
    Config = "config",
    Video = "video",
    Audio = "audio",
    Group = "group",
    Script = "script",
    Workspace = "workspace",
}

export type CanvasNodeTypeId = CanvasNodeType | (string & {});

export type CanvasNodeStatus = "idle" | "success" | "loading" | "error";
export type CanvasGenerationMode = "text" | "image" | "video" | "audio";
export type CanvasImageGenerationType = "generation" | "edit";
export type StoryboardAssetKind = "character" | "scene" | "prop";
export type StoryboardStep = "shots" | "assets" | "prompts";
export type StoryboardShotTransition = "continue" | "cut" | "montage" | "time-jump";
export type StoryboardProductionMode = "economy" | "documentary" | "detailed" | "custom";
export type StoryboardProductionScope = "single" | "series";
export type StoryboardShotRenderMode = "video" | "still";
export type StoryboardPromptSource = "skill" | "builtin" | "fallback";
export const STORYBOARD_PROMPT_SOURCE_TEXT: Record<StoryboardPromptSource, string> = { skill: "技能包生成", builtin: "内置规则", fallback: "安全兜底" };
export type SceneViewRole = "lock" | "front_left_45" | "front" | "front_right_45" | "left" | "top" | "right" | "back_left_45" | "back" | "back_right_45";
export type CanvasVideoFrameRole = "first" | "last";

export type StoryboardVoiceCandidate = {
    id: string;
    url?: string;
    storageKey?: string;
    durationMs?: number;
    cacheKey?: string;
    cacheHit?: "local" | "shared";
};

export type StoryboardAsset = {
    id: string;
    kind: StoryboardAssetKind;
    name: string;
    baseName?: string;
    lifeStage?: string;
    description: string;
    prompt: string;
    imageUrl?: string;
    storageKey?: string;
    status?: CanvasNodeStatus;
    errorDetails?: string;
    sceneSheetUrl?: string;
    sceneSheetStorageKey?: string;
    sceneSheetStatus?: CanvasNodeStatus;
    sceneSheetError?: string;
    voicePrompt?: string;
    voiceAudioUrl?: string;
    voiceAudioStorageKey?: string;
    voiceAudioDurationMs?: number;
    voiceAudioStatus?: CanvasNodeStatus;
    voiceAudioError?: string;
    voiceSpeaker?: string;
    voiceAudioVoice?: string;
    voiceAudioSpeed?: string;
    voiceAudioInstructions?: string;
    voiceAudioCacheKey?: string;
    voiceAudioCacheHit?: "local" | "shared";
    voiceAudioCandidates?: StoryboardVoiceCandidate[];
    voiceAudioSelectedCandidateId?: string;
    voiceSampleText?: string;
    chapterIds?: string[];
};

export type StoryboardAssetMentionLink = {
    mention: string;
    name: string;
    status: "bound" | "missing";
    assetId?: string;
    nodeId?: string;
    kind?: StoryboardAssetKind;
    source?: "node" | "script" | "asset";
    url?: string;
};

export type StoryboardVideoReferenceRole = "reference" | "sceneLock" | "firstFrame" | "lastFrame";
export const STORYBOARD_VIDEO_PROMPT_PREVIEW_EVENT = "infinite-canvas:storyboard-video-prompt-preview";

export type StoryboardVideoReference = StoryboardAssetMentionLink & {
    url?: string;
    storageKey?: string;
    role?: StoryboardVideoReferenceRole;
    sceneGroupId?: string;
    sceneViewRole?: SceneViewRole;
    source?: "script" | "asset" | "node";
};

export type StoryboardAudioReference = StoryboardAssetMentionLink & {
    url?: string;
    storageKey?: string;
    durationMs?: number;
    role?: "voiceLock" | "audioReference";
    source?: "script" | "asset" | "node";
};

export type StoryboardPromptDetail = {
    storyboardPrompt: string;
    videoMotionPrompt: string;
    assetMentions?: string[];
    assetMentionLinks?: StoryboardAssetMentionLink[];
    promptSource?: StoryboardPromptSource;
    promptSkillRoot?: string;
};

export type StoryboardSourceBeat = {
    id: string;
    sourceText: string;
    phase: string;
    timeStage: string;
    location: string;
    characters: string[];
    event: string;
    emotion: string;
    treatment: "direct" | "symbolic" | "voiceover";
};

export type StoryboardDramaturgyPhase = {
    phase: "setup" | "inciting" | "escalation" | "turn" | "climax" | "resolution";
    sourceBeatIds: string[];
    plotRhythm: "loose" | "medium" | "tight";
    emotionRhythm: "light" | "medium" | "heavy";
    purpose: string;
};

export type StoryboardDramaturgyPlan = {
    format: "biography" | "narrative" | "concept" | "series";
    logline: string;
    protagonist: string;
    want: string;
    need: string;
    coreConflict: string;
    openingHook: { description: string; sourceBeatIds: string[] };
    incitingBeatIds: string[];
    turningBeatIds: string[];
    climaxBeatIds: string[];
    endingBeatIds: string[];
    arcSummary: string;
    rhythmPlan: StoryboardDramaturgyPhase[];
    visualMotifs: string[];
    dialoguePrinciples: string[];
    warnings: string[];
};

export type StoryboardShotPlan = {
    sourceBeatIds: string[];
    visualBeatIds?: string[];
    voiceoverBeatIds?: string[];
    continuityGroupId: string;
    timeStage: string;
    startState: string;
    endState: string;
    transition: StoryboardShotTransition;
    usePreviousTailFrame: boolean;
    chapterId?: string;
    chapterTitle?: string;
    renderMode?: StoryboardShotRenderMode;
    motionPriority?: number;
    dramaticFunction?: StoryboardDramaturgyPhase["phase"];
    goal?: string;
    obstacle?: string;
    stakes?: string;
    tactic?: string;
    actionBeats?: string[];
    obstacleReaction?: string;
    turningAction?: string;
    result?: string;
    plotRhythm?: StoryboardDramaturgyPhase["plotRhythm"];
    emotionRhythm?: StoryboardDramaturgyPhase["emotionRhythm"];
    valueShift?: string;
};

export type StoryboardChapter = {
    id: string;
    title: string;
    shotIndexes: number[];
    durationSeconds?: number;
    targetClipCount?: number;
};

export type StoryboardPlanningProgress = {
    percent: number;
    text: string;
};

export type StoryboardPlanningCheckpoint = {
    sourceText: string;
    completedSourceChunks: number;
    completedShotBatches: number;
    beats: StoryboardSourceBeat[];
    shots: Array<{ row: string[]; plan: StoryboardShotPlan }>;
    condensed?: boolean;
    originalBeatCount?: number;
    dramaturgyPlan?: StoryboardDramaturgyPlan;
    dramaturgySource?: "skill" | "builtin";
    dramaturgySkillRoot?: string;
};

export type StoryboardAssetProgress = {
    percent: number;
    text: string;
};

export type StoryboardAssetBatchProgress = {
    status: "running" | "interrupted" | "stopped" | "completed";
    total: number;
    completed: number;
    failed: number;
};

export type VideoGenerationProgress = {
    percent: number;
    text: string;
    stage?: "submitting" | "submitted" | "queued" | "running" | "saving" | "failed";
    providerStatus?: string;
};

export type CanvasNodeMetadata = {
    content?: string;
    storyboardSourceText?: string;
    storyboardRows?: string[][];
    storyboardSourceBeats?: StoryboardSourceBeat[];
    storyboardDramaturgyPlan?: StoryboardDramaturgyPlan;
    storyboardDramaturgySource?: "skill" | "builtin";
    storyboardDramaturgySkillRoot?: string;
    storyboardShotPlans?: Record<string, StoryboardShotPlan>;
    storyboardPlanningProgress?: StoryboardPlanningProgress;
    storyboardPlanningCheckpoint?: StoryboardPlanningCheckpoint;
    storyboardCoverage?: { covered: number; total: number; missingBeatIds: string[] };
    storyboardProductionMode?: StoryboardProductionMode;
    storyboardProductionScope?: StoryboardProductionScope;
    storyboardCustomVideoBudget?: number;
    storyboardEpisodeDurationSeconds?: number;
    storyboardPlanningConfigKey?: string;
    storyboardOriginalBeatCount?: number;
    storyboardActiveChapterId?: string;
    storyboardChapters?: StoryboardChapter[];
    storyboardPlanningErrorStage?: string;
    storyboardPlanningRawResponse?: string;
    storyboardStep?: StoryboardStep;
    storyboardAssetStyle?: string;
    storyboardAssetError?: string;
    storyboardAssetProgress?: StoryboardAssetProgress;
    storyboardAssetBatchProgress?: StoryboardAssetBatchProgress;
    storyboardAssets?: StoryboardAsset[];
    storyboardPreparedChapterIds?: string[];
    storyboardAssetNodeIds?: Record<string, string>;
    storyboardAssetMentionNodeIds?: Record<string, string>;
    storyboardPromptDetails?: Record<string, StoryboardPromptDetail>;
    storyboardPromptErrors?: Record<string, string>;
    storyboardPromptSource?: StoryboardPromptSource;
    storyboardPromptSkillRoot?: string;
    storyboardSourceNodeId?: string;
    storyboardChapterId?: string;
    storyboardAssetId?: string;
    storyboardAssetKind?: StoryboardAssetKind;
    storyboardAssetName?: string;
    storyboardRowIndex?: number;
    storyboardAssetMentions?: string[];
    storyboardAssetMentionLinks?: StoryboardAssetMentionLink[];
    storyboardAssetReferenceNodeIds?: string[];
    storyboardVideoReferences?: StoryboardVideoReference[];
    storyboardVideoAudioReferences?: StoryboardAudioReference[];
    storyboardVideoFinalPrompt?: string;
    storyboardVideoDraftNodeId?: string;
    storyboardVideoVariantIndex?: number;
    storyboardVideoLatestResultNodeId?: string;
    storyboardVideoResultNodeIds?: string[];
    storyboardVideoTailFrameUrl?: string;
    storyboardVideoTailFrameStorageKey?: string;
    videoFrameSourceNodeId?: string;
    videoFrameSourceStorageKey?: string;
    videoFrameRole?: CanvasVideoFrameRole;
    storyboardVideoConfigCustomized?: boolean;
    videoGenerationProgress?: VideoGenerationProgress;
    videoTaskId?: string;
    videoTaskProvider?: "openai" | "seedance" | "cangyuan";
    videoTaskModel?: string;
    videoTaskEndpoint?: "videos" | "video-generations";
    videoTaskSubmittedAt?: string;
    videoTaskRequestMethod?: "POST";
    videoTaskRequestUrl?: string;
    videoTaskRequestModel?: string;
    videoTaskRequestFields?: string[];
    workspaceKind?: "storyboard-character-assets" | "storyboard-scene-assets" | "storyboard-prop-assets" | "storyboard-videos" | "character-references";
    workspaceSourceNodeId?: string;
    workspaceStoryboardChapterId?: string;
    workspaceChildNodeIds?: string[];
    workspaceTitle?: string;
    characterReferenceRole?: string;
    characterReferenceDescription?: string;
    characterReferenceVariantPrompts?: string[];
    characterReferenceVariantTitles?: string[];
    composerContent?: string;
    prompt?: string;
    promptAssistantPendingPrompt?: string;
    promptAssistantStatus?: "loading" | "success" | "error";
    promptAssistantError?: string;
    promptAssistantRequestId?: string;
    status?: CanvasNodeStatus;
    errorDetails?: string;
    fontSize?: number;
    generationMode?: CanvasGenerationMode;
    generationType?: CanvasImageGenerationType;
    model?: string;
    size?: string;
    quality?: string;
    count?: number;
    seconds?: string;
    vquality?: string;
    generateAudio?: string;
    watermark?: string;
    audioVoice?: string;
    audioFormat?: string;
    audioSpeed?: string;
    audioInstructions?: string;
    references?: string[];
    naturalWidth?: number;
    naturalHeight?: number;
    freeResize?: boolean;
    isBatchRoot?: boolean;
    batchRootId?: string;
    batchChildIds?: string[];
    groupId?: string;
    batchUsesReferenceImages?: boolean;
    primaryImageId?: string;
    imageBatchExpanded?: boolean;
    storageKey?: string;
    mimeType?: string;
    bytes?: number;
    durationMs?: number;
    sourcePrompt?: string;
    imagePreset?: "multi_view_grid" | "character_sheet" | "scene_sheet" | "character_three_view";
    enableMultiViewGrid?: boolean;
    disableAutoMultiView?: boolean;
    multiViewRole?: "grid" | "front" | "top" | "left" | "right";
    multiViewSourceNodeId?: string;
    sceneViewRole?: SceneViewRole;
    sceneGroupId?: string;
    requiredSceneViewRoles?: Array<"front" | "top">;
    [key: string]: unknown;
};

export type CanvasNodeData = {
    id: string;
    type: CanvasNodeTypeId;
    title: string;
    position: Position;
    width: number;
    height: number;
    metadata?: CanvasNodeMetadata;
};

export type CanvasConnection = {
    id: string;
    fromNodeId: string;
    toNodeId: string;
};

export type CanvasAssistantReference = {
    id: string;
    type: CanvasNodeTypeId;
    title: string;
    dataUrl?: string;
    storageKey?: string;
    text?: string;
};

export type CanvasAssistantImage = {
    id: string;
    dataUrl: string;
    storageKey?: string;
    prompt: string;
};

export type CanvasAssistantMessage = {
    id: string;
    role: "user" | "assistant" | "system" | "tool" | "error";
    title?: string;
    text: string;
    meta?: string;
    detail?: unknown;
    references?: CanvasAssistantReference[];
};

export type CanvasAssistantSession = {
    id: string;
    title: string;
    messages: CanvasAssistantMessage[];
    createdAt: string;
    updatedAt: string;
};

export type ConnectionHandle = {
    nodeId: string;
    handleType: "source" | "target";
};

export type SelectionBox = {
    startWorldX: number;
    startWorldY: number;
    currentWorldX: number;
    currentWorldY: number;
    additive: boolean;
    initialSelectedNodeIds: string[];
};

export type ContextMenuState =
    | {
          type: "canvas";
          x: number;
          y: number;
          position: Position;
      }
    | {
          type: "node";
          x: number;
          y: number;
          nodeId: string;
      }
    | {
          type: "connection";
          x: number;
          y: number;
          connectionId: string;
      };

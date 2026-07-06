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
    Script = "script",
    Workspace = "workspace",
}

export type CanvasNodeStatus = "idle" | "success" | "loading" | "error";
export type CanvasGenerationMode = "text" | "image" | "video" | "audio";
export type CanvasImageGenerationType = "generation" | "edit";
export type StoryboardAssetKind = "character" | "scene" | "prop";
export type StoryboardStep = "shots" | "assets" | "prompts";
export type SceneViewRole = "lock" | "front_left_45" | "front" | "front_right_45" | "left" | "top" | "right" | "back_left_45" | "back" | "back_right_45";

export type StoryboardAsset = {
    id: string;
    kind: StoryboardAssetKind;
    name: string;
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
};

export type StoryboardAssetProgress = {
    percent: number;
    text: string;
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
    storyboardStep?: StoryboardStep;
    storyboardAssetStyle?: string;
    storyboardAssetError?: string;
    storyboardAssetProgress?: StoryboardAssetProgress;
    storyboardAssets?: StoryboardAsset[];
    storyboardAssetNodeIds?: Record<string, string>;
    storyboardAssetMentionNodeIds?: Record<string, string>;
    storyboardPromptDetails?: Record<string, StoryboardPromptDetail>;
    storyboardSourceNodeId?: string;
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
    storyboardVideoTailFrameUrl?: string;
    storyboardVideoTailFrameStorageKey?: string;
    videoGenerationProgress?: VideoGenerationProgress;
    workspaceKind?: "storyboard-assets" | "storyboard-videos" | "character-references";
    workspaceSourceNodeId?: string;
    workspaceChildNodeIds?: string[];
    workspaceTitle?: string;
    characterReferenceRole?: string;
    characterReferenceDescription?: string;
    characterReferenceVariantPrompts?: string[];
    characterReferenceVariantTitles?: string[];
    composerContent?: string;
    prompt?: string;
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
};

export type CanvasNodeData = {
    id: string;
    type: CanvasNodeType;
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
    type: CanvasNodeType;
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

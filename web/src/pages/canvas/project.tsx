import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent as ReactChangeEvent, DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { BookOpen, Bot, Clapperboard, Download, FileInput, FileText, FolderOpen, Grid2x2, Group, Hand, Home, ImageIcon, Images, List, Menu, Move, Music2, PanelLeftClose, PanelLeftOpen, Plus, Puzzle, Redo2, Settings2, Trash2, Type, Undo2, Upload, Video, X } from "lucide-react";
import { saveAs } from "file-saver";

import { requestEdit, requestGeneration, requestImageQuestion, type AiTextMessage } from "@/services/api/image";
import { requestStoredAudioGeneration, type StoredAudioFile } from "@/services/api/audio";
import { separateVideoAudio } from "@/services/audio-separation";
import { requestVideoGeneration, resumeVideoGenerationTask, storeGeneratedVideo, type VideoGenerationTask } from "@/services/api/video";
import { DOCS_URL } from "@/constant/env";
import { decodeChannelModel, defaultConfig, resolveModelRequestConfig, selectableModelsByCapability, type AiConfig, type ModelCapability, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { imageToDataUrl, resolveImageUrl, uploadImage, type UploadedImage } from "@/services/image-storage";
import { getMediaBlob, resolveMediaUrl, uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { nanoid } from "nanoid";
import { getDataUrlByteSize, readImageMeta } from "@/lib/image-utils";
import { canvasThemes, type CanvasBackgroundMode } from "@/lib/canvas-theme";
import { UserStatusActions } from "@/components/layout/user-status-actions";
import { useAssetStore } from "@/stores/use-asset-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useVideoGenerationPreflight } from "@/hooks/use-video-generation-preflight";
import { cropDataUrl, splitDataUrl, upscaleDataUrl } from "@/lib/canvas/canvas-image-data";
import { MULTI_VIEW_NODE_SPECS, prepareMultiViewPrompt, type MultiViewNodeType } from "@/lib/canvas/canvas-multi-view";
import { buildMangaCharacterPromptNodes } from "@/lib/canvas/manga-character-card-import";
import { buildScene360PromptNodes } from "@/lib/canvas/manga-scene-360-import";
import { buildMangaScenePromptNodes } from "@/lib/canvas/manga-storyboard-scene-import";
import { buildCinemaDnaPromptInstruction, buildPromptAssistantInstruction, buildStoryboardProjectSettingsInstruction } from "@/lib/canvas/prompt-assistant";
import { inferStoryboardCharacterLifeStage, storyboardAssetImagePrompt } from "@/lib/canvas/storyboard-asset-prompt";
import { parsePlannedStoryboardShots, parseStoryboardDramaturgyPlan, parseStoryboardSourceBeats, plannedShotsForBeats, planStoryboardProduction, storyboardBatchClipTargets, storyboardBeatBatches, storyboardClipPlanInstruction, storyboardCoverage, storyboardDramaturgyQualityIssues, storyboardJsonRepairPrompt, storyboardPlanningConfigKey, storyboardShotQualityIssuesForShot, storyboardSingleEpisodeBeatTarget, storyboardSourceChunks, storyboardSpeechParts, storyboardTotalClipTarget, type PlannedStoryboardShot } from "@/lib/canvas/storyboard-planning";
import { auditStoryboardProductionContract, type StoryboardProductionContractStage } from "@/lib/canvas/storyboard-production-contract";
import { fitNodeSize, nodeSizeFromRatio } from "@/lib/canvas/canvas-node-size";
import { buildImagePresetPatch, type CanvasImagePresetId } from "@/lib/canvas/canvas-image-presets";
import { setLastDirectorDeskCanvasId } from "@/lib/canvas/director-desk-routing";
import { App, Button, Dropdown, Modal, Tooltip } from "antd";
import { NODE_DEFAULT_SIZE, getNodeSpec } from "@/constant/canvas";
import { ActiveConnectionPath, ConnectionPath } from "@/components/canvas/canvas-connections";
import { CanvasConfigComposer } from "@/components/canvas/canvas-config-composer";
import { CanvasConfigNodePanel } from "@/components/canvas/canvas-config-node-panel";
import { CanvasNodeContextMenu, type CanvasContextMenuAction } from "@/components/canvas/canvas-context-menu";
import { CanvasNodeAngleDialog, type CanvasImageAngleParams } from "@/components/canvas/canvas-node-angle-dialog";
import { CanvasNodeCropDialog, type CanvasImageCropRect } from "@/components/canvas/canvas-node-crop-dialog";
import { CanvasNodeMaskEditDialog, type CanvasImageMaskEditPayload } from "@/components/canvas/canvas-node-mask-edit-dialog";
import { CanvasNodeSplitDialog, type CanvasImageSplitParams } from "@/components/canvas/canvas-node-split-dialog";
import { CanvasNodeUpscaleDialog, type CanvasImageUpscaleParams } from "@/components/canvas/canvas-node-upscale-dialog";
import { buildNodeGenerationContext, buildNodeGenerationInputs, buildNodeResponseMessages, hydrateNodeGenerationContext, type NodeGenerationInput } from "@/components/canvas/canvas-node-generation";
import { CanvasNodeHoverToolbar, CanvasNodeInfoModal } from "@/components/canvas/canvas-node-hover-toolbar";
import { CanvasPluginErrorBoundary } from "@/components/canvas/canvas-plugin-error-boundary";
import { CanvasPluginManagerModal } from "@/components/canvas/canvas-plugin-manager-modal";
import { CanvasPromptAssistantDialog, mergePromptForNode, promptPatchForNode, readNodePrompt } from "@/components/canvas/canvas-prompt-assistant-dialog";
import { CanvasScriptNodeDialog } from "@/components/canvas/canvas-script-node-dialog";
import { InfiniteCanvas } from "@/components/canvas/infinite-canvas";
import { Minimap } from "@/components/canvas/canvas-mini-map";
import { CanvasNode, type StoryboardImportPreview } from "@/components/canvas/canvas-node";
import { CanvasNodePromptPanel, type CanvasNodeGenerationMode } from "@/components/canvas/canvas-node-prompt-panel";
import { CanvasToolbar } from "@/components/canvas/canvas-toolbar";
import { AssetPickerModal, type InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import { CanvasSidePanel } from "@/components/canvas/canvas-side-panel";
import { CanvasZoomControls } from "@/components/canvas/canvas-zoom-controls";
import { useAgentStore } from "@/stores/use-agent-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useCanvasSidePanelStore } from "@/stores/use-canvas-side-panel-store";
import { exportCanvasProjects } from "@/lib/canvas/canvas-export";
import { applyCanvasAgentOps, type CanvasAgentOp, type CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import { buildNodeMentionReferences } from "@/lib/canvas/canvas-resource-references";
import { getNodeDefinition, getPluginNodeSpec, isBuiltinNodeType, listNodeDefinitions, useNodeRegistryVersion } from "@/lib/canvas/node-registry";
import { buildNodeContext } from "@/lib/canvas/plugin-node-context";
import { ensurePluginsLoaded } from "@/lib/canvas/plugin-loader";
import {
    CanvasNodeType,
    STORYBOARD_VIDEO_PROMPT_PREVIEW_EVENT,
    type CanvasAssistantImage,
    type CanvasAssistantSession,
    type CanvasConnection,
    type CanvasImageGenerationType,
    type CanvasNodeData,
    type CanvasNodeMetadata,
    type CanvasNodeTypeId,
    type CanvasVideoFrameRole,
    type StoryboardAsset,
    type StoryboardAssetKind,
    type StoryboardAudioReference,
    type StoryboardDramaturgyPlan,
    type StoryboardPromptDetail,
    type StoryboardShotPlan,
    type StoryboardSourceBeat,
    type StoryboardVideoReference,
    type StoryboardVoiceCandidate,
    type ConnectionHandle,
    type ContextMenuState,
    type Position,
    type SelectionBox,
    type ViewportTransform,
} from "@/types/canvas";
import type { CanvasNodeToolbarItem, CanvasPluginAi, CanvasPluginHost } from "@/types/canvas-plugin";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio } from "@/types/media";

type CanvasClipboard = {
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
};

type StoryboardRowsUpdater = string[][] | ((rows: string[][]) => string[][]);

type PendingConnectionCreate = {
    connection: ConnectionHandle;
    position: Position;
};

type ConnectionCreateKind = CanvasNodeTypeId;

type ConnectionDropTarget = {
    nodeId: string | null;
    isNearNode: boolean;
};

type CanvasHistoryEntry = Pick<CanvasClipboard, "nodes" | "connections"> & {
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
};

type CanvasGenerationRequest = {
    targetNodeId: string;
    originNodeId: string;
    runningNodeId: string;
    controller: AbortController;
};

type CharacterReferenceVariant = {
    id: string;
    title: string;
    target: string;
};

const VIDEO_NODE_MAX_WIDTH = 420;
const VIDEO_NODE_MAX_HEIGHT = 420;
const CONNECTION_HANDLE_HIT_RADIUS = 40;
const CONNECTION_NODE_HIT_PADDING = 32;
const NODE_STATUS_IDLE = "idle" as const;
const NODE_STATUS_LOADING = "loading" as const;
const NODE_STATUS_SUCCESS = "success" as const;
const NODE_STATUS_ERROR = "error" as const;
const CHARACTER_REFERENCE_VARIANTS: CharacterReferenceVariant[] = [
    { id: "front-full", title: "正面全身", target: "正面站姿全身参考图，角色直视镜头，双臂自然放松，完整展示脸、发型、体型、鞋子和整套服装。" },
    { id: "three-quarter-full", title: "3/4侧全身", target: "三分之四侧身全身参考图，身体转向约45度，脸部仍清晰可见，完整展示侧面轮廓和服装比例。" },
    { id: "side-half", title: "侧面半身", target: "标准侧面半身参考图，从头到腰部，突出脸部侧面、发型轮廓、肩颈和上半身服装结构。" },
    { id: "bust-close", title: "近景胸像", target: "胸像近景参考图，脸部和发型占主要画面，表情自然，保留原角色五官、妆容、材质和画风。" },
    { id: "expression-action", title: "表情动作", target: "轻微动作或表情参考图，可以是抬手、回头或微笑，动作自然，不改变角色身份、服装和画风。" },
    { id: "clothing-detail", title: "服装细节", target: "服装细节参考图，聚焦上衣、领口、袖口、腰部配饰、鞋子或纹理材质，保持与主视图完全同一套服装。" },
];
const STORYBOARD_ASSET_BATCH_CONCURRENCY = 3;
const STORYBOARD_ASSET_LIMIT = 60;
const STORYBOARD_ASSET_GRID_COLUMNS = 3;
const STORYBOARD_ROW_LIMIT = 300;
const STORYBOARD_VIDEO_GRID_COLUMNS = 5;
const STORYBOARD_WORKSPACE_GAP = 160;
const STORYBOARD_WORKSPACE_TOP_OFFSET = -40;
const STORYBOARD_ASSET_KINDS: StoryboardAssetKind[] = ["character", "scene", "prop"];
const STORYBOARD_ASSET_WORKSPACE_KIND: Record<StoryboardAssetKind, "storyboard-character-assets" | "storyboard-scene-assets" | "storyboard-prop-assets"> = {
    character: "storyboard-character-assets",
    scene: "storyboard-scene-assets",
    prop: "storyboard-prop-assets",
};
const STORYBOARD_SCRIPT_PRESET = `【可编辑项目设定】

叙事原则：忠实连接剧本的原始事实、人物关系、事件顺序和情绪变化，不编造冲突剧情。
视觉风格：根据剧本的题材、时代、地域和情绪自动判断；若剧本另有明确画风要求，以剧本要求为准。
叙事视角：默认第三人称客观叙事；若剧本明确要求第一人称、POV、访谈或其他视角，以剧本要求为准。
色调与光影：根据故事阶段和情绪自动判断，保持光源方向、色温与时代环境合理。
人物一致性：同一人物在相同年龄与状态下保持脸型、发型、体态、服装和身份特征一致；年龄或身体状态变化时使用独立时期资产。
场景一致性：同一连续场景保持空间结构、陈设、光源方向、天气和时间推进一致；跨时间或地点时明确新起场景。
镜头与节奏：根据剧情自动选择景别、单一主运镜和节奏；每镜只表现一个主要可见事件。
对白与旁白：使用剧本语言，优先保留关键原话；没有必要时不强加对白。
配乐与音效：环境音、动作音和配乐服务当前情绪，不盖过对白。
字幕与屏幕文字：默认不生成；剧本明确要求时才允许字幕、章节标题、日期或地点文字。
安全表达：敏感事实可以使用克制、象征化的视觉方式，但不得改变事实结果或制造相反含义。
画面约束：除非剧本明确要求，否则保持无字幕、无文字、无 Logo、无水印。
视频规格：画幅、分辨率、单镜时长和是否生成声音优先使用 Script 节点当前视频设置。

【AI定制说明】

将本模板完整复制给 AI，并在“用户追加要求”中写入想要的效果。AI负责把零散要求整理成可直接粘回 Script 节点的完整项目设定，不生成分镜。

可定制项目：
- 视觉风格：写实电影、纪实、动画、漫画、水墨、黏土、定格、2.5D、3D、皮克斯式动画质感等。
- 叙事视角：第三人称、第一人称 POV、主观回忆、访谈、伪纪录片、旁观视角等。
- 色调与光影：冷暖色、饱和度、胶片质感、自然光、低调光、高调光、年代影像等。
- 镜头与节奏：舒缓、克制、快节奏、手持纪实、固定机位、长镜头、蒙太奇等。
- 对白与旁白：对白为主、第一人称旁白、第三人称旁白、少对白、无对白等。
- 配乐与音效：配乐类型、环境声强度、是否弱化配乐、是否突出对白等。
- 字幕与文字：无字幕，或允许对白字幕、章节标题、日期、地点等指定文字。
- 视频规格：画幅、分辨率、单镜时长、是否生成声音；未填写时沿用节点设置。

【用户追加要求】

在这里写入你想要的效果；没有特别要求时填写“保持自动判断”。

【交给 AI 的任务】

根据上面的基础设定和用户追加要求，补全一份跨全片统一、可以直接执行的项目导演设定。不得修改原故事事实，不得生成分镜、资产清单、Markdown 表格、解释或分析。只输出下面的格式，所有字段都必须保留；用户未指定的字段填写“根据剧本自动判断”。

【AI 最终输出格式】

【可编辑项目设定】

叙事原则：
视觉风格：
叙事视角：
色调与光影：
人物一致性：
场景一致性：
镜头与节奏：
对白与旁白：
配乐与音效：
字幕与屏幕文字：
安全表达：
画面约束：
视频规格：`;
const STORYBOARD_FACT_EXTRACTION_PROMPT = `你是长篇人物传记与叙事故事的事实拆解编辑。请把输入原文逐句拆成不可再合并的故事事实，供后续自动生成完整视频分镜。

只输出 JSON，不要 Markdown，不要解释：
{"beats":[{"id":"B001","sourceText":"原文直接证据","phase":"故事阶段","timeStage":"人物年龄或时期","location":"地点","characters":["人物"],"event":"单一事实或情绪转折","emotion":"可见情绪","treatment":"direct|symbolic|voiceover"}]}

固定规则：
1. 按原文顺序逐句扫描。不同时间、地点、人物状态、动作、遭遇、决定、对白、因果结果或情绪转折必须拆成不同 beat。
2. 不做摘要，不按固定总数压缩；长篇人物传记通常应拆出数十个 beat，宁可细分，不得删掉支撑人物经历的事实。
3. sourceText 必须引用或紧贴原文，event 只能陈述一个事实，不得把“丧失亲人、灾年、离婚、迁徙”等多个事件合成一项。
4. 无法直接拍摄的思想、时代说明和总结也要保留，treatment 使用 voiceover；敏感经历保留事实，画面需要克制象征时使用 symbolic。
5. 安全表达只能改变视觉呈现，不能改变事实含义，尤其不得把死亡、离别、疾病或伤害改写成相反结果。
6. id 从 B001 连续编号，输出前逐句回查原文，补齐遗漏事实。`;
const STORYBOARD_DRAMATURGY_PROMPT = `你是服务于 AI 短剧生产的总编剧。请根据完整事实列表生成一份可追溯的“剧作总纲”，用于约束后续单集浓缩、10-15 秒片段、资产和视频提示词。

只输出 JSON，不要 Markdown，不要解释：
{"format":"biography|narrative|concept|series","logline":"一句话故事","protagonist":"主角","want":"外在行动目标","need":"保守推断的内在变化","coreConflict":"目标与阻碍","openingHook":{"description":"由开头事实支持的可见钩子","sourceBeatIds":["B001"]},"incitingBeatIds":["B002"],"turningBeatIds":["B004"],"climaxBeatIds":["B008"],"endingBeatIds":["B010"],"arcSummary":"起始状态→压力与选择→变化后的结束状态","rhythmPlan":[{"phase":"setup|inciting|escalation|turn|climax|resolution","sourceBeatIds":["B001"],"plotRhythm":"loose|medium|tight","emotionRhythm":"light|medium|heavy","purpose":"本阶段改变什么"}],"visualMotifs":["原文已有的可见母题"],"dialoguePrinciples":["对白旁白原则"],"warnings":["证据不足或生产风险"]}

固定规则：
1. 所有 sourceBeatIds 必须来自事实列表；总纲只能决定如何选择、强调和组织事实，不得创造原文没有的人物、关系、地点、道具、对白、冲突或结局。
2. 自动判断人物传记、叙事故事、概念短片或连续故事。人物传记保持时间和因果顺序；不得为了钩子擅自把结局搬到开头。
3. logline 必须写清具体人物、处境、目标/压力和变化，不得只写抽象主题。
4. openingHook 使用开头可用事实设计一个摄影机能拍到的动作、物件、空间关系或声音；不能依赖解释性旁白才能成立。
5. Want/Need 是剧作解释而不是新事实；证据不足时保守描述，并写入 warnings。
6. 找出激励、转折、高潮和结局的事实证据；保持因果顺序，高潮必须是原文真实存在的关键选择、损失、发现、对抗或不可逆变化。
7. rhythmPlan 同时规划情节节奏和情感节奏，避免所有阶段都紧且重；把最高综合强度留给原文支持的高潮。
8. visualMotifs 只能选原文中已经存在、可反复出现的物件、动作、空间、光线或声音，不得虚构象征物。
9. dialoguePrinciples 要求口语化、少解释、优先原文原话或旁白证据；不得编造煽情独白。
10. 输出前自检 ID、事实、时间顺序、可拍摄性和节奏对比。`;
const STORYBOARD_SINGLE_EPISODE_CONDENSE_PROMPT = `你是漫剧单集编剧。请把完整故事事实浓缩为一集短片所需的核心事实，允许舍弃支线和重复信息，但不得改写关键因果、人物关系、重大转折和结局。

只输出 JSON，不要 Markdown，不要解释：
{"beats":[{"id":"C001","sourceText":"由原文事实提炼的证据摘要","phase":"故事阶段","timeStage":"人物年龄或时期","location":"地点","characters":["人物"],"event":"这一集必须保留的核心事件","emotion":"可见情绪","treatment":"direct|symbolic|voiceover"}]}

固定规则：
1. 按原故事顺序形成清楚的开场、推进、转折、高潮和结尾，不得只选择开头或平均抽样。
2. 优先保留主角身份、核心困境、关键选择、主要因果、情绪转折和结局；背景资料、重复遭遇和次要人物可合并为旁白或蒙太奇。
3. 每个核心事实只承载一个明确叙事功能，可综合多个相邻原始事实，但不得虚构原文没有的事件。
4. sourceText 要写清由哪些原始事实综合而来，event 必须适合后续转成可见动作、旁白配画或蒙太奇。
5. 核心事实数量必须服从固定视频预算：每个视频只选择 1 个主要可见事实，同地点、同人物时期的相邻背景事实可由旁白承载；跨地点、跨人物时期或独立动作不得硬塞进同一视频，也不得通过增加视频数突破预算。
6. 开头优先选择原文前段中最有视觉张力的动作、物件、空间或声音作为钩子，不得擅自倒叙结局；中段必须有递进压力和明确转折，最高强度留给原文支持的高潮，结尾展示变化后的稳定状态。
7. 只保留摄影机能拍到或声音能表达的事件；抽象心理改写为动作、姿态、视线、关系或环境变化，但不得改变事实。
8. 兼顾情节节奏与情感节奏，避免所有核心事实都保持同一强度；呼吸段必须承担关系、信息或情绪变化，不能成为空镜填充。
9. 对白和旁白优先使用原文原话或证据摘要，避免解释主题、说教和虚构煽情独白。
10. id 从 C001 连续编号，数量必须服从本次目标。`;
const STORYBOARD_PLANNED_SHOTS_PROMPT = `你是漫剧单集导演。请把给定故事事实按原文顺序合并为可直接生成的 15 秒视频片段。

只输出 JSON，不要 Markdown，不要解释：
{"shots":[{"sourceBeatIds":["B001","B002"],"visualBeatIds":["B002"],"voiceoverBeatIds":["B001"],"continuityGroupId":"G001","timeStage":"童年时期","duration":"15s","dramaticFunction":"setup|inciting|escalation|turn|climax|resolution","goal":"当前可见目标","obstacle":"当前可见阻碍或压力","stakes":"失败会造成的具体损失或恶化","tactic":"人物为达成目标采取的具体物理策略","participants":[{"name":"动作执行者","role":"actor","lifeStage":"成年时期","sourceBeatIds":["B002"]},{"name":"动作承受者","role":"patient","lifeStage":"出生时","sourceBeatIds":["B002"]}],"actionBeats":["执行者用身体部位或道具启动动作并形成第一个物理变化","阻力作用后执行者调整身体或物体继续推进","执行者完成动作转折并形成片尾可见结果"],"typedActionBeats":[{"actor":"动作执行者","action":"写清身体部位或物体如何移动并作用于对象","patient":"动作承受者","prop":"可选道具名","result":"第一拍完成后的具体物理状态变化"},{"actor":"动作执行者","action":"写清承接首拍结果后的身体或物体动作","patient":"动作承受者","prop":"可选道具名","result":"第二拍完成后的具体物理状态变化"},{"actor":"动作执行者","action":"写清阻力作用后的动作转折","patient":"动作承受者","prop":"可选道具名","result":"第三拍形成的片尾可见结果"}],"obstacleReaction":"阻力如何对人物动作产生可见反作用","turningAction":"改变场面方向的关键物理动作","result":"片段结束时可见结果","plotRhythm":"loose|medium|tight","emotionRhythm":"light|medium|heavy","valueShift":"开始价值→结束价值","visual":"0-3秒：建立同一场景与站位，同时执行第一拍，写清执行者、身体部位或道具、动作对象和第一个物理结果。\n3-9秒：承接第一拍结果推进第二拍，写清动作方向、幅度、速度或受力变化。\n9-12秒：阻力产生反作用，执行动作转折并明确写出可见结果。\n12-15秒：只保持已经形成的结果和稳定落点，不增加新动作或剧情。","shotSize":"中景","lighting":"光影氛围","dialogue":"对白旁白","sound":"音效","camera":"单一主运镜","imagePrompt":"首帧画面提示词","startState":"片段开始时人物和空间状态","endState":"片段结束时人物和空间状态","transition":"continue|cut|montage|time-jump","usePreviousTailFrame":false,"motionPriority":3}]}

固定规则：
1. 每个事实 id 必须且只需被至少一条 shot 的 sourceBeatIds 引用；事实完整性通过 sourceBeatIds 追踪，不等于一事实一镜。
2. 每条片段必须把 sourceBeatIds 明确分成 visualBeatIds 和 voiceoverBeatIds：visualBeatIds 只能有 1 个主要可见事实，决定唯一地点、人物时期、画面动作和资产；其余事实放入 voiceoverBeatIds，只能作为旁白背景，不得要求画面切换地点、时期或另演一段剧情。
3. 每条片段必须继承剧作总纲中的戏剧功能，并形成完整场景卡：goal 是人物此刻想完成的可见目标；obstacle 是同场可见阻力或压力；stakes 是失败后会发生的具体损失、延误或关系恶化；tactic 是人物采取的物理策略。participants 必须把每个动作参与者标为 actor 或 patient，并用 sourceBeatIds 绑定当前事实；画外成年人双手也必须作为明确 actor，不能凭空写“一双手”。actionBeats 是唯一可执行动作链，按顺序只写 2-3 个动作；typedActionBeats 与其逐项对应，每项固定写 actor、action、patient、可选 prop 和必填 result。action 必须写清身体部位或物体、移动或操作方式、作用对象，result 必须写清接触、位移、姿态、物体状态或空间关系发生的物理变化。婴儿、幼儿或被照护者只能作为 patient，不得承担包裹、喂养、安置等成人照护动作。第2拍承担阻力反作用，第3拍承担动作转折并导向 result；只有2拍时由第2拍同时完成反作用、转折和结果。obstacleReaction 与 turningAction 只说明对应节拍的剧作功能，不得扩成额外动作。result 与 valueShift 写清可见结果和价值变化。没有直接冲突的建置或呼吸片段可以使用环境压力、时间限制或关系张力，不得虚构冲突。
4. actionBeats 必须使用能拍摄的物理动词，不能写“意识到、感到、陷入沉思、局势恶化、情绪变化、做出决定”等心理或概括词；“木杖落地、人物前行、动作继续”等短标签不合格，必须展开为谁用哪个身体部位或道具、以什么方向/幅度/速度作用于什么对象、造成什么物理结果。前一动作的结果必须触发后一动作，turningAction 必须实际改变人物姿态、物件状态、空间关系、信息掌握或行动结果。visual 必须按发生顺序写出这条动作链和可见结果，不得只写环境、情绪或主题概述；删除本片段后不能让前后故事完全不受影响。
5. 每条片段固定15秒，visual 必须逐行使用“0-3秒：”“3-9秒：”“9-12秒：”“12-15秒：”四段。0-3秒在建立同一场景和站位的同时执行 actionBeats 第一拍，不能只写“建立场景”；3-9秒承接首拍物理结果推进第二拍；9-12秒表现阻力反作用、动作转折并明确写出可见结果；12-15秒只保持 result、endState 与 valueShift 的稳定落点，不得出现新人物、新地点、新道具、新事件或新动作。每段写1-2句可执行描述，前三段都写清执行者、身体部位或物体、动作、对象和物理变化，不能用短标签代替；visual 必须复用对应 typedActionBeats 中的 participants.name、prop、核心物理动词和 result 关键词，不得换成无法追踪的同义概述。第一步只写人物时期、场景和道具的语义名称，不提前虚构 @资产名；visual、dialogue、sound 和 camera 必须使用同一组时间段，一个片段只使用一个主运镜。visualBeatIds 对应的旁白必须与同段可见证据直接对应，voiceoverBeatIds 只能补充与当前人物、地点和动作有明确因果关系的背景事实，不得要求画面重演该背景。
6. 同一时间、地点、人物时期且动作直接相承时使用相同 continuityGroupId、transition=continue，并让后一条 startState 精确承接前一条 endState。
7. 时间、地点、人物年龄或身体状态变化时新建 continuityGroupId，transition 使用 cut 或 time-jump，usePreviousTailFrame=false；不得为了凑片段强行合并不同时空。
8. 只有同一连续性组内的直接续动作才允许 usePreviousTailFrame=true；首条 shot 必须为 false。
9. 对白旁白优先保留原文第一人称叙述和关键原话；15秒旁白目标36-45个汉字，硬上限48个汉字。无法直接拍摄的事实可由 VO 承载，但画面仍保持 visualBeatIds 的同一地点和动作，不得用蒙太奇偷塞第二个场景。
10. 敏感事实采用克制、明确、不误导的象征画面，例如空摇篮、熄灭的灯、叠好的衣物；不得用一个仍然健康存在的主体替代已经失去的主体。
11. imagePrompt 写片段静态首帧，包含准确时期的人物、场景、构图、光线和关键道具；不得把多个时空塞进同一首帧。
12. motionPriority 使用 1-5：强动作、关键冲突和情绪高潮为 5；普通生活动作约为 3；空镜、说明和主要由旁白承载的内容为 1。
13. plotRhythm 与 emotionRhythm 要有张弛对比，最高综合强度留给高潮；相邻三个片段不得无依据地全部使用 tight+heavy。
14. 所有动作、情绪和价值变化都必须能由摄影机或声音表现，不写“她意识到、他明白了”等不可见心理结论。
15. sourceBeatIds 必须等于 visualBeatIds 与 voiceoverBeatIds 的并集，三者都只能引用本批事实；保持事实顺序和固定视频预算，不得通过增加片段数解决过载。输出前逐项检查目标、阻力、代价、策略、participants、actionBeats 与 typedActionBeats 的逐项对应、阻力反作用、动作转折、结果、价值变化和起止状态；每个动作必须有已绑定的 actor 与 patient，任一为空或职责冲突都先重写，再检查本批所有 id 均已覆盖。`;
const STORYBOARD_SCREENSHOT_IMPORT_PROMPT = `请识别截图里的分镜脚本表格，并只输出 Markdown 表格。

表格列必须严格为：
| 镜号 | 时长 | 画面描述 | 景别 | 光影氛围 | 对白旁白 | 音效 | 运镜 | 分镜画面提示词 |

要求：只提取截图中能看清的行；看不清的单元格留空；不要解释，不要标题。`;
const STORYBOARD_TEXT_IMPORT_PROMPT = `请把下面的文本整理成分镜脚本 Markdown 表格。

表格列必须严格为：
| 镜号 | 时长 | 画面描述 | 景别 | 光影氛围 | 对白旁白 | 音效 | 运镜 | 分镜画面提示词 |

要求：
1. 如果文本里包含【整体要求/导演提示词】、风格、视角、输出规则等约束，必须把这些约束作为最高优先级执行，并贯穿到每个镜头。
2. 如果文本里已有分镜表格就按原内容整理；如果是普通剧本文本，就拆成可拍摄分镜。
3. 当整体要求指定第一人称、POV、固定画风或镜头限制时，画面描述、运镜和分镜画面提示词都必须继承，不要退回第三人称旁观视角或其他画风。
4. 只输出 Markdown 表格，不要解释，不要标题。`;
const STORYBOARD_COLUMNS = ["镜号", "时长", "画面描述", "景别", "光影氛围", "对白旁白", "音效", "运镜", "分镜画面提示词"];
const ASSET_KIND_TEXT: Record<StoryboardAssetKind, string> = { character: "人物", scene: "场景", prop: "道具" };
const STORYBOARD_FINAL_PROMPT_PROMPT = `你是漫剧片段与 Seedance 2.0 视频导演提示词专家。请按 seedance-20 技能包的专业导演工作流，把单个 10-15 秒生产片段、第二步资产和全局风格整合成第三步“合成提示词”。你的任务不是把第一步画面描述改写得更华丽，而是把已锁定的场景卡翻译成模型可以执行的动作、镜头和声音指令。

只输出 JSON，不要 Markdown，不要解释。

JSON 格式必须为：
{
  "storyboardPrompt": "分镜提示词，用于首帧图/分镜图生成",
  "videoMotionPrompt": "视频运动提示词，用于视频模型理解动作和镜头运动",
  "assetMentions": ["@人物名", "@场景名", "@道具名"]
}

videoMotionPrompt 必须严格按以下模板输出，栏目名称和顺序不得改变；方括号小节是视频导演执行信息，不是解释性标题：
【生成规格】
[视频约束]
当前片段时长、单一连续镜头、画幅/分辨率、生成声音；严格保留已锁定台词或旁白，不增加、不删减，不生成字幕、文字、Logo 或水印。
【参考资产绑定】
[场景设定]
唯一场景资产及其空间职责。
[人物设定]
逐个列出当前可见人物的 @资产名、叙事身份、年龄/时期和动作职责；被抱持者、婴儿、道具必须明确对象关系。
[道具设定]
逐个列出当前动作实际使用的 @道具资产名、外观连续性职责、持握/接触方式和作用对象；没有关键道具时明确写“无”。
[站位设定]
逐个写清人物相对位置、面向方向、与场景/道具的关系。
【叙事目标】
只写当前片段一个主要可见事实、失败代价、策略、阻力反作用、动作转折和可见结果。
【起始画面】
写清起始构图、人物/物体位置、姿态和光线。
【N秒时间轴】
[画面时序]
0-N 秒必须是四段连续时间；0-3秒建立场景和站位的同时执行第一拍，不能只写建场；每段写清“谁 + 身体部位/物体 + 动作 + 对象 + 物理结果”，前三段必须按顺序继承第一步详细动作时间轴，最后 1-2 秒只保留结果和稳定落点。
【镜头运动】
只指定一个主运镜，写清起幅、速度、主体关系和落幅。
【光线与画面质感】
[光影与氛围]
写清主光源、方向、色温、材质、时代和画风。
【声音时间轴】
写全程环境声、动作音效、台词/旁白精确时间；台词用 { }，音效用 < >，音乐用（ ）。
【连续性与稳定约束】
保持人物身份、服装、年龄状态、场景结构、道具位置和镜头运动稳定。

要求：
1. 先判断本片段的生成模式：无资产时按 T2V 写完整画面；有角色/场景/道具资产时按 R2V/I2V 思路写，明确每个 @资产名 的作用是角色身份、场景空间、道具或首帧参考，不要让参考资产互相抢控制权。
2. 按 Seedance 2.0 导演公式组织：主体 + 主叙事目标 + 2-3 个顺序动作节拍 + 场景 + 单一主运镜 + 物理光源/风格 + 音频 + 稳定约束。主体和起始动作必须放在前半句，避免模型抓错重点。
3. storyboardPrompt 用于首帧图/分镜图，只写静态可见画面：构图、主体外观、环境、光影、道具、静态表情和画风，不要把它写成视频动作脚本。
4. videoMotionPrompt 用于视频模型，必须严格按以下栏目依次输出：【生成规格】【参考资产绑定】【叙事目标】【起始画面】【N秒时间轴】【镜头运动】【光线与画面质感】【声音时间轴】【连续性与稳定约束】。N 必须等于当前片段时长，正文控制在 2000 字以内。
5. 【15秒时间轴】固定写 0-3、3-9、9-12、12-15 秒四段，中间不得留空、重叠或超出总时长；四段只能推进 visualBeatIds 对应的同一地点、同一人物时期和同一动作链，依次承担空间/站位建立并执行第一拍、承接首拍结果推进第二拍、反作用/动作转折与可见结果、稳定落点。9-12秒段必须用“可见结果：”明确写出动作造成的物理结果，最后3秒只保持这一结果，不新增人物、地点、道具、事件或转场。【声音时间轴】使用相同分段；visualBeatIds 对应的旁白必须与同段可见动作对齐，voiceoverBeatIds 只作为背景旁白，不得为了“对应”而虚构第二地点、人物、道具或事件。
6. 每个片段只围绕 visualBeatIds 的一个主要可见事实和一个叙事目标；voiceoverBeatIds 只能补充不要求新画面的背景事实。必须继承本片段剧作字段中的 dramaticFunction、goal、obstacle、stakes、tactic、actionBeats、result、plotRhythm、emotionRhythm 和 valueShift；四段时间轴只执行 actionBeats 的2-3拍因果链。obstacleReaction 与 turningAction 只用于理解第2拍和第3拍的功能，不得作为额外动作再次写入时间轴。不得把 voiceoverBeatIds 重新演成第二段剧情，不得使用蒙太奇跨越多个地点或人物时期。
7. 动作用 physical verbs 写清楚演员/物体、力度、速度、幅度、身体部位、物理后果和终点，例如手指攥紧衣角、肩膀微颤后松开、脚步踩进泥水并停住。每个动作必须包含“谁的哪个身体部位/物体 + 做什么 + 造成什么可见变化”，禁止只写“情绪增强、关系恶化、气氛紧张”。
8. 情绪不要只写“悲伤/愤怒/紧张”等抽象词，要外化为身体细节，例如低头、肩膀微颤、眼神闪躲、手指攥紧衣角、胸口起伏。
9. 一个片段只指定一种主要运镜，并写清起幅、速度、主体关系和落幅；内部节拍可用固定机位切景别或轻微推拉，但不要同时要求推拉摇移、无人机、环绕和手持。
10. 有对白时用 {台词} 表示；旁白逐行使用“起止秒 VO：内容”；有音效时用 <音效> 表示；有背景音乐时用（音乐描述）表示。15秒旁白目标36-45个汉字，硬上限48个汉字；对白要短，唇形镜头优先锁定机位或轻微推镜。旁白涉及 voiceoverBeatIds 的背景事实时，只作为画外信息保留原文，必须明确“画面继续执行当前 visualBeatIds 动作”，不得把背景事实改写成画面动作。
11. 除非分镜明确要求字幕或屏幕文字，否则加入保持无字幕、不要生成文字、不要生成 Logo、不要生成水印等约束；不要使用负面提示词语法，只用自然语言约束。
12. 根据 visualBeatIds 从资产列表里选择真正相关的人物、场景、道具；普通片段最多绑定 1 个主要场景资产。画面中可见的角色必须选择准确年龄/时期资产；提到但没有资产的姐姐、弟弟、老师等人物只能作为画外声音、背影或不露脸手部，不得生成可识别新面孔。只有纯空镜或明确无人物资产的 T2V 片段才允许不选择角色资产；不要为了“全面”引用所有资产。
13. assetMentions 只能包含第二步资产清单里真实存在的 @资产名；两个提示词里如果使用资产，也必须显式写出同一个 @资产名。
14. @资产名必须严格使用“第二步资产清单”里出现的原始名称，不要改写、不要补充括号、不要使用别名；资产名后如果要继续描述动作、时期或场景，必须用空格或标点隔开，例如写“@白秋妹·年轻时期 走入院落”，不要把资产名和后续动作粘连。
15. 如果同一人物存在多个年龄/时期资产，必须根据当前镜头内容选择精确状态的资产，例如年轻时期镜头只用 @白秋妹·年轻时期，成年时期镜头只用 @白秋妹·成年时期；不要用一个状态资产代表另一个年龄，也不要同时引用同一人物多个年龄状态，除非镜头明确是回忆对照或同框设定。
16. 有参考资产时，不要反复重描述资产已经可见的脸、服装、场景和道具细节；重点写参考资产没有表达清楚的运动、时间、镜头、光线变化、声音和保持不变的内容。
17. 角色画风必须继承【可编辑项目设定】和资产参考：项目要求写实、真人或纪实时，使用真人演员与真实摄影质感；项目要求动画、漫画、2.5D、3D、水墨等风格时，严格保持对应媒介。不得擅自把写实改成动漫，也不得把动漫改成真人；保持同一角色的脸型、发型、体态、服装和画风一致，不要在提示词中写任何素材 URI 或内部 ID。
18. 如果整体要求指定第一人称主观视角，storyboardPrompt 和 videoMotionPrompt 都必须明确写入“第一人称主观视角 POV”，只能通过手、脚、衣袖、手持物、影子、倒影等第一人称可见元素表现“我”，不要写成旁观者镜头。
19. 如果上下文里有上一片段/下一片段，当前片段需要自然承接人物站位、光线、场景结构和情绪，不要突变角色外观、场景布局或画风。
20. 不要编造与剧本、分镜、资产冲突的新人物、新地点或新道具；如果信息不足，选择保守、可拍摄、低歧义的表达。
21. “本片段事实与连续性计划”是事实约束：保留全部 sourceBeatIds 的事实追溯，但画面只能执行 visualSourceBeats / visualBeatIds；voiceoverSourceBeats / voiceoverBeatIds 只由锁定旁白承载，不得转成可见人物、地点、道具或动作。动作从 startState 到 endState；transition=continue 时只承接上一片段结束状态，cut/time-jump 时明确新起场景，不得为了连续而混合两个时期。
22. 如素材包含不适合直观呈现的脆弱处境，只调整视觉表达：使用朴素服装、空镜、灯光变化、遗留物件、人物克制反应等间接画面，保留原始因果和关系变化，不得改写成相反结果。
23. 四段时间轴必须分别写出：空间/站位确认并执行 actionBeats 第一拍、承接首拍结果推进第二拍、阻力反作用/第三拍与“可见结果：”、稳定落点。第一步“画面描述”里的四段详细动作是已锁定执行合同，第三步不得把它压缩回“建立场景、人物前行、动作继续”等短标签，不得遗漏、重排或另写一套动作；只允许在不改变物理因果的前提下补充第二步精确 @资产名、身体部位、运动参数、镜头和声音。obstacleReaction 与 turningAction 只解释动作链中对应节拍的功能，不得追加为第4、第5个动作；第四段只保持 result/endState，不能添加新剧情。
24. 【声音时间轴】必须同时写全程环境声、动作音效、对白或旁白的精确起止段；生成声音默认开启，除非当前视频设置明确写了关闭。VO 只允许使用第一步已提供的旁白原文，不得把导演说明、同步要求、栏目名或资产绑定说明写成声音。先锁定 visualBeatIds 的可见动作，再安排 voiceoverBeatIds 的背景旁白；背景旁白不能反向改变画面地点、人物时期或动作链。
25. videoMotionPrompt 必须在九个主栏目内部使用以下导演脚本小节，并且小节内容只服务当前镜头：
【生成规格】下写[视频约束]；【参考资产绑定】下写[场景设定]、[人物设定]、[道具设定]、[站位设定]；【N秒时间轴】下写[画面时序]；【光线与画面质感】下写[光影与氛围]。小节不重复整段资产描述，而是明确资产职责、站位、起始状态、动作顺序和可见结果。
26. [人物设定] 必须逐个写出当前画面可见人物的精确资产、叙事身份和可执行职责，例如“@角色A：接生人，负责托住并移动@角色B”；婴儿、被抱持者、被放置物体不能只写成泛称，必须绑定准确资产或明确说明为无资产的不可识别局部。
27. [道具设定] 必须使用第二步清单中的精确 @道具资产名并说明谁以何种方式使用它；[站位设定] 必须写清人物相对位置、面向方向、主体与道具的空间关系；[画面时序] 每一段都必须回答“谁在什么位置用哪个身体部位或道具对什么对象做什么，产生什么物理变化”，禁止只写情绪、氛围或抽象叙事。0-3秒必须出现唯一 @场景资产；每个已绑定且实际可见的 @人物资产必须出现在其动作段，每个已绑定的 @道具资产必须出现在实际使用段，不能只在 assetMentions 或参考资产绑定栏目声明后改用裸名、代词或泛称。
28. 同一人物本名存在多个年龄/时期资产时，当前镜头只能选择一个时期；除非事实明确要求回忆对照或同框，不得同时把两个时期资产写成同一种人物身份参考。资产名称含“出生、婴儿、新生儿、幼年”等状态时，必须明确其为被抱持/被照护对象，不得让其承担成人动作。
29. 资产、道具、场景和人物关系必须来自当前片段事实与第二步资产清单；不得把“新成员用品”等抽象词当作可执行道具，信息不足时使用资产清单中最具体的已知名称或省略该动作，不得编造新道具。
30. 输出前执行保守自检：是否只有一个主要场景资产、一个人物时期、一个主动作和一个主运镜；0-3秒是否已经执行第一拍而非只有建场；第一步四段详细动作是否逐段继承；每句 VO 是否与同时间段可见动作对应；VO 是否超过 N×4 个汉字；最后 1-2 秒是否只稳定停留；资产是否真实存在；每个已绑定人物/道具是否在实际参与段使用精确 @资产名；声音是否明确；是否存在同一人物多个时期冲突；每个主要动作是否有执行者、对象和物理结果。任一不满足都先重写再输出。`;
const STORYBOARD_ASSET_PROMPT = `你是短剧资产规划师。请根据原始剧本和分镜表，提炼第二步“准备资产”需要的统一资产。

只输出 JSON，不要 Markdown，不要解释。

JSON 格式必须为：
{
  "style": "全局视觉风格，一句话到两句话",
  "assets": [
    { "kind": "character", "name": "角色名·年龄状态", "baseName": "角色本名", "lifeStage": "年龄或时期状态", "description": "该年龄状态的角色形象描述", "prompt": "可直接用于生成该年龄状态角色设定图的中文提示词" },
    { "kind": "scene", "name": "场景名", "description": "场景描述", "prompt": "可直接用于生成场景设定图的中文提示词" },
    { "kind": "prop", "name": "道具名", "description": "道具描述", "prompt": "可直接用于生成道具设定图的中文提示词" }
  ]
}

要求：
1. 只保留后续分镜最需要统一的角色、场景、道具，不要泛滥。
2. 角色优先提炼姓名、年龄状态、体型、穿着、气质、情绪基调。
3. 场景优先提炼时代、空间、光线、陈设、地域质感。
4. 道具优先提炼剧情里反复出现或情绪关键的物件。
5. 剧作总纲只用于提高资产优先级：主角、高潮所需时期、反复出现的核心场景和原文已有视觉母题优先准备；不得把 Want、Need、隐喻或 warnings 直接变成原文没有的角色、场景或道具。
6. style 和每个 prompt 必须继承原始剧本或补充要求里的整体风格、画风、视角和禁忌；例如要求皮克斯动画电影风、3D 渲染、温暖柔和色彩时，资产提示词必须以这些风格词开头，不要改成写实纪实、真实摄影、真人电影感或其他风格。
7. 输入若包含“镜头时期索引”，必须按 timeStage 为反复出现的同一人物拆分独立时期资产，名称使用“人物名·时期”，不得让年少、青年、成年、晚年共用一张角色图。
8. 资产必须覆盖完整分镜，不得只读取前几个镜头；同一场景跨镜复用时只建一个场景资产，不同地点或时代布局必须拆开。
9. prompt 要能直接用于生图，包含画风、主体、构图、光影、材质和一致性要求。
10. scene 类型必须是纯场景空镜，只写环境、空间、陈设、光线、时代和地域质感，prompt 必须明确“不出现人物、不出现角色、不出现人脸、不出现手部、无人入镜”。
11. prop 类型必须是纯道具静物图，只写物件本身、材质、磨损、摆放环境和光影，prompt 必须明确“不出现人物、不出现角色、不出现人脸、不出现手部、无人持握”。遗照、照片、证件、奖状等必须作为道具静物呈现，可以出现照片/证件里的图像内容，但现场画面不能出现真实人物。
12. 同一人物如果在剧本或分镜中出现不同年龄、时期、身份状态或造型阶段，必须拆成多个 character 资产；不要把年少、青年、成年、老年等多个状态塞进一张角色资产图。命名必须能区分状态，例如“白秋妹·年少时期”“白秋妹·成年时期”“哥哥·年少时期”“哥哥·成年时期”。baseName 保留同一人物本名，lifeStage 写该资产唯一对应的年龄/时期。
13. 每个 character prompt 只能描述一个角色的一个年龄状态，必须明确“单一角色设定图、只展示该年龄状态、不要出现其他年龄版本、不要出现同一人物成长时间线、不要出现多人合照”。如果需要表现同一角色的多个角度，只能是同一年龄状态的正面、侧面、背面、半身和表情参考。
14. 角色资产图格式统一为横向角色设定图：干净背景，单一角色，同一脸型、发型、体型、服装、配色和画风；包含正面全身主视图，并可包含侧面、背面、半身头像和表情小参考；不要剧情场景、不要分镜画面、不要文字标注、Logo、水印或边框。
15. 角色资产安全表达只调整敏感细节，不得改变项目画风：统一使用“年少时期角色/年少时期女性角色”“行动不便”“身形单薄”“朴素旧衣”“旧布鞋”“生活艰难”等中性视觉表达；不要加入刺激性经历、具体诊断、冲突过程或伤害细节，也不要因此强制改成虚拟、动画或漫画角色。
16. 不要编造与剧本冲突的人物关系和物件。`;
const IMAGE_PROMPT_REVERSE_PRESET = `请根据参考图片反推一段适合用于 AI 生图的提示词。

要求：
1. 只输出提示词正文，不要解释。
2. 覆盖主体、构图、风格、光线、色彩、材质、镜头和氛围。
3. 尽量写成可直接用于生图模型的完整提示词。`;

type Seedance20SkillContext = {
    root?: string;
    files?: Array<{ path: string; content: string }>;
};

type StoryboardFinalPromptInstruction = {
    content: string;
    source: NonNullable<StoryboardPromptDetail["promptSource"]>;
    skillRoot?: string;
};

type StoryboardDramaturgyInstruction = {
    content: string;
    source: "skill" | "builtin";
    skillRoot?: string;
};

const SEEDANCE_20_COMPOSE_SECTIONS: Record<string, string[]> = {
    "skills/seedance-prompt/SKILL.md": ["Director Formula", "Mode Gate", "Prompt Build Process", "Compression Rules"],
    "skills/seedance-camera/SKILL.md": ["Camera Contract", "Move Selection", "Continuity Rules", "Conflict Rule"],
    "skills/seedance-motion/SKILL.md": ["Motion Contract", "Timing Pattern", "Reference Motion Rules", "Stability Rules"],
    "skills/seedance-characters/SKILL.md": ["Character Contract", "Multi-Character Blocking", "Hand and Face Stability"],
    "skills/seedance-audio/SKILL.md": ["Core Rules", "Sound Layer Pattern", "Multi-Character Dialogue", "Failure Fixes"],
    "skills/seedance-antislop/SKILL.md": ["Visibility Test", "Rewrite Pass", "Do Not Over-Correct"],
    "references/reference-workflow.md": ["Asset Role Map", "Rules", "Role Examples", "Template"],
    "references/storytelling-framework.md": ["Useful Clip Beats", "Beat Formula", "Micro-Story Checklist"],
};

async function buildStoryboardFinalPromptInstruction(): Promise<StoryboardFinalPromptInstruction> {
    const context = await loadSeedance20SkillContext();
    if (!context?.files?.length) return { content: STORYBOARD_FINAL_PROMPT_PROMPT, source: "builtin" };
    const packageRules = context.files
        .map((file) => {
            const sections = SEEDANCE_20_COMPOSE_SECTIONS[file.path]?.map((heading) => markdownSecondLevelSection(file.content, heading)).filter(Boolean) || [];
            return sections.length ? `--- ${file.path} ---\n${sections.join("\n\n")}` : "";
        })
        .filter(Boolean);
    if (!packageRules.length) return { content: STORYBOARD_FINAL_PROMPT_PROMPT, source: "builtin" };
    return { content: [
        STORYBOARD_FINAL_PROMPT_PROMPT,
        "【运行时读取的 seedance-20 技能包】",
        "下面规则由本地 seedance-2.0-5.3.0/seedance-2.0-5.3.0 技能包实时读取，只保留当前第三步需要的导演规则。必须遵循导演公式、资产角色映射、单一主运镜、动作起止、角色一致性、声音分层、去空话和短片节奏；若与上方 JSON 格式冲突，仍保持上方 JSON 格式。",
        context.root ? `技能包路径：${context.root}` : "",
        ...packageRules,
    ]
        .filter(Boolean)
        .join("\n\n"), source: "skill", skillRoot: context.root };
}

function markdownSecondLevelSection(content: string, heading: string) {
    const lines = content.split(/\r?\n/);
    const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
    if (start < 0) return "";
    const next = lines.findIndex((line, index) => index > start && /^##\s+/.test(line));
    return lines.slice(start, next < 0 ? lines.length : next).join("\n").trim();
}

async function loadSeedance20SkillContext(): Promise<Seedance20SkillContext | null> {
    if (typeof window === "undefined") return null;
    try {
        const endpoint = (localStorage.getItem("canvas-agent-url") || "http://127.0.0.1:17371").trim().replace(/\/+$/, "");
        const token = (localStorage.getItem("canvas-agent-token") || "").trim();
        if (!endpoint || !token) return null;
        const response = await fetch(`${endpoint}/api/skills/seedance-20/context?token=${encodeURIComponent(token)}`);
        if (!response.ok) return null;
        const data = (await response.json()) as { ok?: boolean } & Seedance20SkillContext;
        return data.ok && data.files?.length ? data : null;
    } catch {
        return null;
    }
}

async function loadCinemaDnaSkillContext(): Promise<Seedance20SkillContext | null> {
    if (typeof window === "undefined") return null;
    try {
        const endpoint = (localStorage.getItem("canvas-agent-url") || "http://127.0.0.1:17371").trim().replace(/\/+$/, "");
        const token = (localStorage.getItem("canvas-agent-token") || "").trim();
        if (!endpoint || !token) return null;
        const response = await fetch(`${endpoint}/api/skills/cinema-dna/context?token=${encodeURIComponent(token)}`);
        if (!response.ok) return null;
        const data = (await response.json()) as { ok?: boolean } & Seedance20SkillContext;
        return data.ok && data.files?.length ? data : null;
    } catch {
        return null;
    }
}

function createCanvasNode(type: CanvasNodeTypeId, position: Position, metadata?: CanvasNodeMetadata): CanvasNodeData {
    const spec = isBuiltinNodeType(type) ? getNodeSpec(type) : getPluginNodeSpec(type);
    if (!spec) throw new Error(`节点类型 ${type} 未注册`);
    const id = `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    return {
        id,
        type,
        title: spec.title,
        position: {
            x: position.x - spec.width / 2,
            y: position.y - spec.height / 2,
        },
        width: spec.width,
        height: spec.height,
        metadata: { ...spec.metadata, ...metadata },
    };
}

export default function CanvasPage() {
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    if (!mounted) return <CanvasRefreshShell />;

    return <InfiniteCanvasPage />;
}

function CanvasRefreshShell() {
    return (
        <main className="relative h-full min-h-0 overflow-hidden bg-background text-foreground">
            <div
                className="absolute inset-0 opacity-60"
                style={{
                    backgroundImage: "radial-gradient(circle, var(--border) 1px, transparent 1px)",
                    backgroundSize: "28px 28px",
                }}
            />

            <div className="absolute bottom-5 left-1/2 z-50 flex h-14 -translate-x-1/2 items-center gap-1 rounded-xl border px-2 shadow-lg backdrop-blur" style={{ background: "var(--background)", borderColor: "var(--border)" }} aria-hidden="true">
                {Array.from({ length: 7 }).map((_, index) => (
                    <div key={index} className="size-8 rounded-md bg-current opacity-10" />
                ))}
            </div>

            <div className="absolute bottom-24 left-6 z-50 h-40 w-[240px] rounded-lg border shadow-2xl backdrop-blur-sm" style={{ background: "var(--background)", borderColor: "var(--border)" }} aria-hidden="true">
                <div className="absolute left-7 top-7 h-5 w-12 rounded-sm bg-current opacity-10" />
                <div className="absolute left-28 top-16 h-6 w-16 rounded-sm bg-current opacity-10" />
                <div className="absolute bottom-7 left-16 h-8 w-20 rounded-sm bg-current opacity-10" />
                <div className="absolute inset-5 rounded border border-current opacity-15" />
            </div>

            <div className="absolute bottom-5 left-5 z-50 flex h-14 w-[260px] items-center gap-2 rounded-xl border px-2 shadow-lg backdrop-blur" style={{ background: "var(--background)", borderColor: "var(--border)" }} aria-hidden="true">
                <div className="size-8 rounded-md bg-current opacity-10" />
                <div className="size-8 rounded-md bg-current opacity-10" />
                <div className="h-1 flex-1 rounded-full bg-current opacity-10" />
                <div className="h-4 w-10 rounded bg-current opacity-10" />
                <div className="size-8 rounded-md bg-current opacity-10" />
            </div>
        </main>
    );
}

function ConnectionCreateMenu({ pending, onCreate, onClose }: { pending: PendingConnectionCreate; onCreate: (type: ConnectionCreateKind) => void; onClose: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    useNodeRegistryVersion((state) => state.version);
    const extensionDefinitions = listNodeDefinitions().filter((definition) => definition.showInCreateMenu !== false);
    return (
        <div
            className="absolute z-[120] w-[300px] rounded-[18px] border p-3 shadow-2xl backdrop-blur"
            data-connection-create-menu
            style={{ left: pending.position.x, top: pending.position.y, background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-sm font-medium" style={{ color: theme.node.muted }}>
                    引用该节点生成
                </span>
                <button type="button" className="grid size-7 place-items-center rounded-lg text-base opacity-55 transition hover:bg-white/10 hover:opacity-100" onClick={onClose} aria-label="关闭">
                    ×
                </button>
            </div>
            <div className="thin-scrollbar grid max-h-[70vh] gap-1 overflow-y-auto">
                {extensionDefinitions.map((definition) => <ConnectionCreateOption key={definition.type} theme={theme} icon={definition.icon || <Puzzle className="size-5" />} title={definition.title} description={definition.description} onClick={() => onCreate(definition.type)} />)}
                <ConnectionCreateOption theme={theme} icon={<List className="size-5" />} title="文本生成" description="脚本、广告词、品牌文案" onClick={() => onCreate(CanvasNodeType.Text)} />
                <ConnectionCreateOption theme={theme} icon={<ImageIcon className="size-5" />} title="图片生成" onClick={() => onCreate(CanvasNodeType.Image)} />
                <ConnectionCreateOption theme={theme} icon={<Video className="size-5" />} title="视频生成" onClick={() => onCreate(CanvasNodeType.Video)} />
                <ConnectionCreateOption theme={theme} icon={<Music2 className="size-5" />} title="音频参考" onClick={() => onCreate(CanvasNodeType.Audio)} />
                <ConnectionCreateOption theme={theme} icon={<Settings2 className="size-5" />} title="配置节点" description="模型、尺寸、数量和输入顺序" onClick={() => onCreate(CanvasNodeType.Config)} />
            </div>
        </div>
    );
}

function ConnectionCreateOption({ theme, icon, title, description, onClick }: { theme: (typeof canvasThemes)[keyof typeof canvasThemes]; icon: React.ReactNode; title: string; description?: string; onClick?: () => void }) {
    return (
        <button type="button" className="flex h-16 w-full cursor-pointer items-center gap-3 rounded-2xl px-3 text-left transition" style={{ color: theme.node.text }} onClick={onClick} onMouseEnter={(event) => (event.currentTarget.style.background = theme.node.fill)} onMouseLeave={(event) => (event.currentTarget.style.background = "transparent")}>
            <span className="grid size-11 shrink-0 place-items-center rounded-xl" style={{ background: theme.node.fill, color: theme.node.muted }}>
                {icon}
            </span>
            <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-base font-semibold leading-5">{title}</span>
                {description ? <span className="mt-1 block truncate text-sm" style={{ color: theme.node.muted }}>{description}</span> : null}
            </span>
        </button>
    );
}

function NodeCreateMenu({ position, onCreate, onClose }: { position: Position; onCreate: (type: CanvasNodeTypeId) => void; onClose: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    useNodeRegistryVersion((state) => state.version);
    const extensionDefinitions = listNodeDefinitions().filter((definition) => definition.showInCreateMenu !== false);
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;
    useEffect(() => {
        const close = () => onCloseRef.current();
        window.addEventListener("pointerdown", close);
        return () => window.removeEventListener("pointerdown", close);
    }, []);
    return (
        <div className="absolute z-[120] w-[300px] rounded-[18px] border p-3 shadow-2xl backdrop-blur" data-canvas-no-zoom style={{ left: position.x, top: position.y, background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text }} onPointerDown={(event) => event.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-sm font-medium" style={{ color: theme.node.muted }}>选择节点</span>
                <button type="button" className="grid size-7 place-items-center rounded-lg opacity-55 transition hover:opacity-100" onClick={onClose} aria-label="关闭"><X className="size-4" /></button>
            </div>
            <div className="thin-scrollbar grid max-h-[70vh] gap-1 overflow-y-auto">
                {extensionDefinitions.map((definition) => <ConnectionCreateOption key={definition.type} theme={theme} icon={definition.icon || <Puzzle className="size-5" />} title={definition.title} description={definition.description} onClick={() => onCreate(definition.type)} />)}
                <ConnectionCreateOption theme={theme} icon={<List className="size-5" />} title="文本" onClick={() => onCreate(CanvasNodeType.Text)} />
                <ConnectionCreateOption theme={theme} icon={<ImageIcon className="size-5" />} title="图片" onClick={() => onCreate(CanvasNodeType.Image)} />
                <ConnectionCreateOption theme={theme} icon={<Video className="size-5" />} title="视频" onClick={() => onCreate(CanvasNodeType.Video)} />
                <ConnectionCreateOption theme={theme} icon={<Music2 className="size-5" />} title="音频" onClick={() => onCreate(CanvasNodeType.Audio)} />
                <ConnectionCreateOption theme={theme} icon={<Settings2 className="size-5" />} title="生成配置" onClick={() => onCreate(CanvasNodeType.Config)} />
                <ConnectionCreateOption theme={theme} icon={<Group className="size-5" />} title="组" onClick={() => onCreate(CanvasNodeType.Group)} />
            </div>
        </div>
    );
}

function InfiniteCanvasPage() {
    const { message, modal } = App.useApp();
    const confirmVideoGeneration = useVideoGenerationPreflight();
    const params = useParams<{ id: string }>();
    const navigate = useNavigate();
    useEffect(() => {
        void ensurePluginsLoaded().catch((error) => console.error("[plugin] 初始化失败", error));
    }, []);
    const [searchParams] = useSearchParams();
    const projectId = params.id || "";
    const localAgentConnected = useAgentStore((state) => state.connected);
    const localAgentActivity = useAgentStore((state) => state.activity);
    const localAgentEnabled = useAgentStore((state) => state.enabled);
    const agentPanelOpen = useAgentStore((state) => state.panelOpen);
    const toggleAgentPanel = useAgentStore((state) => state.togglePanel);
    const openAgentPanel = useAgentStore((state) => state.openPanel);
    const setAgentState = useAgentStore((state) => state.setAgentState);
    const setAgentCanvasContext = useAgentStore((state) => state.setCanvasContext);
    const containerRef = useRef<HTMLDivElement>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const mangaCardInputRef = useRef<HTMLInputElement>(null);
    const mangaStoryboardInputRef = useRef<HTMLInputElement>(null);
    const scene360InputRef = useRef<HTMLInputElement>(null);
    const uploadTargetRef = useRef<{ nodeId?: string; position?: Position } | null>(null);
    const clipboardRef = useRef<CanvasClipboard | null>(null);
    const historyRef = useRef<{ past: CanvasHistoryEntry[]; future: CanvasHistoryEntry[] }>({ past: [], future: [] });
    const lastHistoryRef = useRef<CanvasHistoryEntry | null>(null);
    const historyCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const viewportSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const applyingHistoryRef = useRef(false);
    const historyPausedRef = useRef(false);
    const didInitialCenterRef = useRef(false);
    const rafRef = useRef<number | null>(null);
    const toolbarHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const nodeDraggingRef = useRef(false);
    const dragRef = useRef<{
        isDraggingNode: boolean;
        hasMoved: boolean;
        startX: number;
        startY: number;
        initialSelectedNodes: { id: string; x: number; y: number }[];
    }>({
        isDraggingNode: false,
        hasMoved: false,
        startX: 0,
        startY: 0,
        initialSelectedNodes: [],
    });

    const config = useConfigStore((state) => state.config);
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const addAsset = useAssetStore((state) => state.addAsset);
    const cleanupAssetImages = useAssetStore((state) => state.cleanupImages);
    const hydrated = useCanvasStore((state) => state.hydrated);
    const createProject = useCanvasStore((state) => state.createProject);
    const openProject = useCanvasStore((state) => state.openProject);
    const updateProject = useCanvasStore((state) => state.updateProject);
    const renameProject = useCanvasStore((state) => state.renameProject);
    const deleteProjects = useCanvasStore((state) => state.deleteProjects);
    const currentProject = useCanvasStore((state) => state.projects.find((project) => project.id === projectId));
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [nodes, setNodes] = useState<CanvasNodeData[]>([]);
    const [connections, setConnections] = useState<CanvasConnection[]>([]);
    const [chatSessions, setChatSessions] = useState<CanvasAssistantSession[]>([]);
    const [activeChatId, setActiveChatId] = useState<string | null>(null);
    const [viewport, setViewport] = useState<ViewportTransform>({ x: 0, y: 0, k: 1 });
    const [size, setSize] = useState({ width: 1200, height: 720 });
    const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
    const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
    const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
    const [connectingParams, setConnectingParams] = useState<ConnectionHandle | null>(null);
    const [connectionTargetNodeId, setConnectionTargetNodeId] = useState<string | null>(null);
    const [pendingConnectionCreate, setPendingConnectionCreate] = useState<PendingConnectionCreate | null>(null);
    const [mouseWorld, setMouseWorld] = useState<Position>({ x: 0, y: 0 });
    const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    const [nodeCreatePosition, setNodeCreatePosition] = useState<Position | null>(null);
    const [runningNodeId, setRunningNodeId] = useState<string | null>(null);
    const [audioSeparatingNodeIds, setAudioSeparatingNodeIds] = useState<Set<string>>(new Set());
    const [isMiniMapOpen, setIsMiniMapOpen] = useState(false);
    const [backgroundMode, setBackgroundMode] = useState<CanvasBackgroundMode>("lines");
    const [showImageInfo, setShowImageInfo] = useState(false);
    const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const [projectLoaded, setProjectLoaded] = useState(false);
    const [toolbarNodeId, setToolbarNodeId] = useState<string | null>(null);
    const [nodeImageSettingsOpen, setNodeImageSettingsOpen] = useState(false);
    const [dialogNodeId, setDialogNodeId] = useState<string | null>(null);
    const [promptAssistantNodeId, setPromptAssistantNodeId] = useState<string | null>(null);
    const [promptAssistantLoading, setPromptAssistantLoading] = useState(false);
    const [promptAssistantModel, setPromptAssistantModel] = useState("");
    const [storyboardActionKey, setStoryboardActionKey] = useState<string | null>(null);
    const [storyboardPromptProgress, setStoryboardPromptProgress] = useState<{ current: number; total: number; phase: string; attempt?: number; status: "running" | "completed" | "paused" | "error" } | undefined>();
    const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
    const [editRequestNonce, setEditRequestNonce] = useState(0);
    const [infoNodeId, setInfoNodeId] = useState<string | null>(null);
    const [cropNodeId, setCropNodeId] = useState<string | null>(null);
    const [maskEditNodeId, setMaskEditNodeId] = useState<string | null>(null);
    const [splitNodeId, setSplitNodeId] = useState<string | null>(null);
    const [upscaleNodeId, setUpscaleNodeId] = useState<string | null>(null);
    const [superResolveNodeId, setSuperResolveNodeId] = useState<string | null>(null);
    const [angleNodeId, setAngleNodeId] = useState<string | null>(null);
    const [previewNodeId, setPreviewNodeId] = useState<string | null>(null);
    const [scriptNodeId, setScriptNodeId] = useState<string | null>(null);
    const [agentUndoSnapshot, setAgentUndoSnapshot] = useState<CanvasAgentSnapshot | null>(null);
    const [titleEditing, setTitleEditing] = useState(false);
    const [titleDraft, setTitleDraft] = useState("");
    const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });
    const [collapsingBatchIds, setCollapsingBatchIds] = useState<Set<string>>(new Set());
    const [openingBatchIds, setOpeningBatchIds] = useState<Set<string>>(new Set());
    const [isNodeDragging, setIsNodeDragging] = useState(false);
    const [dropTargetGroupId, setDropTargetGroupId] = useState<string | null>(null);

    const openToonflow = useCallback(async () => {
        const endpoint = (localStorage.getItem("canvas-agent-url") || "http://127.0.0.1:17371").trim().replace(/\/+$/, "");
        const token = (localStorage.getItem("canvas-agent-token") || "").trim();
        if (!token) {
            message.error("请先连接本地 Canvas Agent，再打开 ToonFlow");
            return;
        }
        const closeLoading = message.loading("正在打开 ToonFlow...", 0);
        try {
            const response = await fetch(`${endpoint}/api/apps/toonflow/open?token=${encodeURIComponent(token)}`, { method: "POST" });
            const data = (await response.json()) as { ok?: boolean; message?: string; error?: string };
            if (!response.ok || !data.ok) throw new Error(data.error || "ToonFlow 启动失败");
            message.success(data.message || "正在打开 ToonFlow");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "ToonFlow 启动失败");
        } finally {
            closeLoading();
        }
    }, [message]);

    const nodesRef = useRef(nodes);
    const connectionsRef = useRef(connections);
    const selectedNodeIdsRef = useRef(selectedNodeIds);
    const viewportRef = useRef(viewport);
    const generateNodeRef = useRef<((nodeId: string, mode: CanvasNodeGenerationMode, prompt: string, options?: { useCurrentImageAsReference?: boolean }) => Promise<void>) | null>(null);
    const connectingParamsRef = useRef(connectingParams);
    const connectionTargetNodeIdRef = useRef(connectionTargetNodeId);
    const selectionBoxRef = useRef(selectionBox);
    const pendingConnectionCreateRef = useRef(pendingConnectionCreate);
    const generationRequestsRef = useRef(new Map<string, CanvasGenerationRequest>());
    const generationBatchControllersRef = useRef(new Map<string, AbortController>());
    const recoveringVideoTasksRef = useRef(new Map<string, AbortController>());
    const tailFrameBackfillRef = useRef(new Set<string>());
    const videoFrameExtractionRef = useRef(new Set<string>());
    const promptAssistantRequestSeqRef = useRef(0);

    const createHistoryEntry = useCallback(
        (): CanvasHistoryEntry => ({
            nodes: nodesRef.current,
            connections: connectionsRef.current,
            chatSessions,
            activeChatId,
            backgroundMode,
            showImageInfo,
        }),
        [activeChatId, backgroundMode, chatSessions, showImageInfo],
    );

    const cleanupCanvasFiles = useCallback(
        (extra?: unknown) => {
            cleanupAssetImages({ extra, history: historyRef.current, lastHistory: lastHistoryRef.current });
        },
        [cleanupAssetImages],
    );

    const startGenerationRequest = useCallback((targetNodeId: string, originNodeId: string, runningId = originNodeId, controller = new AbortController()) => {
        const previous = generationRequestsRef.current.get(targetNodeId);
        if (previous?.controller !== controller) previous?.controller.abort();
        generationRequestsRef.current.set(targetNodeId, { targetNodeId, originNodeId, runningNodeId: runningId, controller });
        return controller;
    }, []);

    const finishGenerationRequest = useCallback((targetNodeId: string, controller: AbortController) => {
        const request = generationRequestsRef.current.get(targetNodeId);
        if (request?.controller === controller) generationRequestsRef.current.delete(targetNodeId);
    }, []);

    const stopGenerationByTargetId = useCallback((targetNodeId: string) => {
        const request = generationRequestsRef.current.get(targetNodeId);
        if (!request) return false;
        request.controller.abort();
        generationRequestsRef.current.delete(targetNodeId);
        return true;
    }, []);

    const stopGenerationByRunningId = useCallback((runningId: string) => {
        const affectedNodeIds = new Set<string>();
        generationBatchControllersRef.current.get(runningId)?.abort();
        generationBatchControllersRef.current.delete(runningId);
        generationRequestsRef.current.forEach((request) => {
            if (request.runningNodeId !== runningId) return;
            request.controller.abort();
            generationRequestsRef.current.delete(request.targetNodeId);
            affectedNodeIds.add(request.targetNodeId);
            affectedNodeIds.add(request.originNodeId);
        });
        setRunningNodeId((current) => (current === runningId ? null : current));
        if (!affectedNodeIds.size) return;
        setNodes((prev) =>
            prev.map((node) =>
                affectedNodeIds.has(node.id) && node.metadata?.status === NODE_STATUS_LOADING
                    ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_IDLE, errorDetails: undefined } }
                    : node,
            ),
        );
    }, []);

    const confirmStopGeneration = useCallback(
        (nodeId: string) => {
            modal.confirm({
                title: "停止生成？",
                content: "当前生成请求会被中断，已经生成完成的内容会保留。",
                okText: "停止",
                cancelText: "继续生成",
                okButtonProps: { danger: true },
                onOk: () => stopGenerationByRunningId(nodeId),
            });
        },
        [modal, stopGenerationByRunningId],
    );

    useEffect(() => {
        if (!hydrated) return;
        setProjectLoaded(false);
        const project = openProject(projectId);
        if (!project) {
            navigate("/canvas");
            return;
        }
        setLastDirectorDeskCanvasId(projectId);

        const restore = async () => {
            const restoredNodes = await hydrateCanvasImages(resetInterruptedGeneration(project.nodes));
            const restoredSessions = await hydrateAssistantImages(project.chatSessions || []);
            setNodes(restoredNodes);
            setConnections(project.connections);
            setChatSessions(restoredSessions);
            setActiveChatId(project.activeChatId || null);
            setBackgroundMode(project.backgroundMode);
            setShowImageInfo(project.showImageInfo || false);
            setViewport(project.viewport);
            historyRef.current = { past: [], future: [] };
            if (historyCommitTimerRef.current) {
                clearTimeout(historyCommitTimerRef.current);
                historyCommitTimerRef.current = null;
            }
            lastHistoryRef.current = {
                nodes: restoredNodes,
                connections: project.connections,
                chatSessions: restoredSessions,
                activeChatId: project.activeChatId || null,
                backgroundMode: project.backgroundMode,
                showImageInfo: project.showImageInfo || false,
            };
            setHistoryState({ canUndo: false, canRedo: false });
            setProjectLoaded(true);
        };
        void restore();
    }, [hydrated, openProject, projectId, navigate]);

    useEffect(() => {
        if (!projectLoaded) return;
        setAgentState({ activeThreadId: "", messages: [], tokenUsage: null, pendingTool: null, pendingApprovals: [] });
    }, [projectId, projectLoaded, setAgentState]);

    useEffect(() => {
        if (!projectLoaded || !["new", "recent", "choose"].includes(searchParams.get("mode") || "") || searchParams.has("agentUrl")) return;
        openAgentPanel();
    }, [openAgentPanel, projectLoaded, searchParams]);

    useEffect(() => {
        if (!projectLoaded || applyingHistoryRef.current || historyPausedRef.current) return;
        const next = createHistoryEntry();
        const previous = lastHistoryRef.current;
        if (previous?.nodes === next.nodes && previous.connections === next.connections && previous.chatSessions === next.chatSessions && previous.activeChatId === next.activeChatId && previous.backgroundMode === next.backgroundMode && previous.showImageInfo === next.showImageInfo) return;

        if (historyCommitTimerRef.current) clearTimeout(historyCommitTimerRef.current);
        historyCommitTimerRef.current = setTimeout(() => {
            const current = createHistoryEntry();
            const last = lastHistoryRef.current;
            if (!last) return;
            historyRef.current.past = [...historyRef.current.past.slice(-49), last];
            historyRef.current.future = [];
            setHistoryState({ canUndo: true, canRedo: false });
            lastHistoryRef.current = current;
            historyCommitTimerRef.current = null;
        }, 180);

        return () => {
            if (historyCommitTimerRef.current) {
                clearTimeout(historyCommitTimerRef.current);
                historyCommitTimerRef.current = null;
            }
        };
    }, [activeChatId, backgroundMode, chatSessions, connections, createHistoryEntry, nodes, projectLoaded, showImageInfo]);

    useEffect(() => {
        if (!projectLoaded || historyPausedRef.current) return;
        updateProject(projectId, { nodes, connections, chatSessions, activeChatId, backgroundMode, showImageInfo });
    }, [activeChatId, backgroundMode, chatSessions, connections, nodes, projectId, projectLoaded, showImageInfo, updateProject]);

    useEffect(() => {
        if (!dialogNodeId) setNodeImageSettingsOpen(false);
    }, [dialogNodeId]);

    useEffect(() => {
        if (!projectLoaded) return;
        if (viewportSaveTimerRef.current) clearTimeout(viewportSaveTimerRef.current);
        viewportSaveTimerRef.current = setTimeout(() => {
            updateProject(projectId, { viewport: viewportRef.current });
            viewportSaveTimerRef.current = null;
        }, 500);
        return () => {
            if (viewportSaveTimerRef.current) clearTimeout(viewportSaveTimerRef.current);
        };
    }, [projectId, projectLoaded, updateProject, viewport]);

    useLayoutEffect(() => {
        nodesRef.current = nodes;
        connectionsRef.current = connections;
        selectedNodeIdsRef.current = selectedNodeIds;
        viewportRef.current = viewport;
        connectingParamsRef.current = connectingParams;
        connectionTargetNodeIdRef.current = connectionTargetNodeId;
        pendingConnectionCreateRef.current = pendingConnectionCreate;
    }, [nodes, connections, selectedNodeIds, viewport, connectingParams, connectionTargetNodeId, pendingConnectionCreate]);

    useLayoutEffect(() => {
        selectionBoxRef.current = selectionBox;
    }, [selectionBox]);

    useEffect(() => {
        if (!projectLoaded) return;
        const recoveries: Array<{ taskId: string; nodeId: string; controller: AbortController }> = [];
        nodesRef.current
            .filter((node) => shouldRecoverVideoTask(node))
            .forEach((node) => {
                const taskId = node.metadata!.videoTaskId!;
                if (recoveringVideoTasksRef.current.has(taskId)) return;
                const generationConfig = buildGenerationConfig(effectiveConfig, node, "video");
                if (node.metadata?.videoTaskModel) {
                    generationConfig.model = node.metadata.videoTaskModel;
                    generationConfig.videoModel = node.metadata.videoTaskModel;
                }
                const task = videoTaskFromMetadata(node.metadata, generationConfig);
                if (!task || !isAiConfigReady(generationConfig, task.model)) {
                    setNodes((prev) =>
                        prev.map((item) =>
                            item.id === node.id
                                ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails: task ? "原视频任务仍在平台，但当前模型渠道配置不完整。请完成配置后查询原任务。" : "原视频任务信息不完整，请核对任务 ID、模型和平台后再查询。" } }
                                : item,
                        ),
                    );
                    return;
                }

                const controller = startGenerationRequest(node.id, node.id, node.id);
                recoveringVideoTasksRef.current.set(taskId, controller);
                recoveries.push({ taskId, nodeId: node.id, controller });
                setNodes((prev) =>
                    prev.map((item) =>
                        item.id === node.id
                            ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_LOADING, errorDetails: undefined, videoGenerationProgress: { percent: 16, text: `正在恢复平台任务：${taskId}`, stage: "submitted" } } }
                            : item,
                    ),
                );

                void (async () => {
                    try {
                        const video = await storeGeneratedVideo(
                            await resumeVideoGenerationTask(generationConfig, task, {
                                signal: controller.signal,
                                onProgress: (progress) => setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, videoGenerationProgress: progress } } : item))),
                            }),
                        );
                        const tailFrame = await extractVideoLastFrame(video).catch(() => null);
                        setNodes((prev) => applyCompletedVideoToExistingNode(prev, node.id, video, tailFrame, generationConfig, node.metadata?.storyboardVideoFinalPrompt || node.metadata?.prompt || ""));
                    } catch (error) {
                        if (isGenerationCanceled(error)) return;
                        const errorDetails = error instanceof Error ? error.message : "原视频任务查询失败";
                        setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails } } : item)));
                    } finally {
                        finishGenerationRequest(node.id, controller);
                        if (recoveringVideoTasksRef.current.get(taskId) === controller) recoveringVideoTasksRef.current.delete(taskId);
                    }
                })();
            });

        return () => {
            recoveries.forEach(({ taskId, nodeId, controller }) => {
                if (recoveringVideoTasksRef.current.get(taskId) !== controller) return;
                controller.abort();
                finishGenerationRequest(nodeId, controller);
                recoveringVideoTasksRef.current.delete(taskId);
            });
        };
    }, [effectiveConfig, finishGenerationRequest, isAiConfigReady, projectId, projectLoaded, startGenerationRequest]);

    useEffect(() => {
        if (!projectLoaded) return;
        const targets = nodes.filter((node) => shouldBackfillStoryboardTailFrame(node, tailFrameBackfillRef.current, nodes, connections));
        targets.forEach((node) => {
            tailFrameBackfillRef.current.add(node.id);
            void extractVideoLastFrame({
                url: node.metadata?.content || "",
                storageKey: node.metadata?.storageKey || "",
                width: node.metadata?.naturalWidth || node.width,
                height: node.metadata?.naturalHeight || node.height,
                bytes: node.metadata?.bytes || 0,
                mimeType: node.metadata?.mimeType || "video/mp4",
                durationMs: node.metadata?.durationMs,
            })
                .then((tailFrame) => {
                    if (!tailFrame) return;
                    setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, ...storyboardTailFrameMetadata(tailFrame) } } : item)));
                })
                .catch(() => undefined);
        });
    }, [connections, nodes, projectLoaded]);

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        const updateSize = () => {
            const rect = el.getBoundingClientRect();
            setSize({ width: rect.width, height: rect.height });
            if (!didInitialCenterRef.current) {
                didInitialCenterRef.current = true;
                setViewport({ x: rect.width / 2, y: rect.height / 2, k: 1 });
            }
        };

        updateSize();
        const resizeObserver = new ResizeObserver(updateSize);
        resizeObserver.observe(el);
        return () => resizeObserver.disconnect();
    }, []);

    const screenToCanvas = useCallback((clientX: number, clientY: number) => {
        const rect = containerRef.current?.getBoundingClientRect();
        const currentViewport = viewportRef.current;
        const localX = clientX - (rect?.left || 0);
        const localY = clientY - (rect?.top || 0);

        return {
            x: (localX - currentViewport.x) / currentViewport.k,
            y: (localY - currentViewport.y) / currentViewport.k,
        };
    }, []);

    const getCanvasCenter = useCallback(() => {
        const rect = containerRef.current?.getBoundingClientRect();
        return screenToCanvas((rect?.left || 0) + (rect?.width || size.width) / 2, (rect?.top || 0) + (rect?.height || size.height) / 2);
    }, [screenToCanvas, size.height, size.width]);

    const setConnecting = useCallback((next: ConnectionHandle | null) => {
        connectingParamsRef.current = next;
        setConnectingParams(next);
        if (!next) {
            connectionTargetNodeIdRef.current = null;
            setConnectionTargetNodeId(null);
        }
    }, []);

    const keepNodeToolbar = useCallback(
        (nodeId: string) => {
            if (nodeDraggingRef.current || nodeImageSettingsOpen) return;
            if (toolbarHideTimerRef.current) {
                clearTimeout(toolbarHideTimerRef.current);
                toolbarHideTimerRef.current = null;
            }
            setToolbarNodeId(nodeId);
        },
        [nodeImageSettingsOpen],
    );

    const hideNodeToolbar = useCallback(() => {
        if (toolbarHideTimerRef.current) clearTimeout(toolbarHideTimerRef.current);
        toolbarHideTimerRef.current = setTimeout(() => {
            setToolbarNodeId(null);
            toolbarHideTimerRef.current = null;
        }, 120);
    }, []);

    const connectNodes = useCallback(
        (current: ConnectionHandle, targetNodeId: string) => {
            if (current.nodeId === targetNodeId) return;

            const connection = normalizeConnection(current.nodeId, targetNodeId, nodesRef.current, current.handleType);
            if (!connection) {
                message.warning("配置节点之间不能连接");
                return;
            }
            const { fromNodeId, toNodeId } = connection;
            const exists = connectionsRef.current.some((conn) => conn.fromNodeId === fromNodeId && conn.toNodeId === toNodeId);
            if (!exists) {
                setConnections((prev) => [...prev, { id: `conn-${Date.now()}`, fromNodeId, toNodeId }]);
            }
            setContextMenu(null);
        },
        [message],
    );

    const createConnectedNode = useCallback(
        (type: ConnectionCreateKind, pending: PendingConnectionCreate) => {
            const metadata =
                type === CanvasNodeType.Config
                    ? { model: effectiveConfig.imageModel || effectiveConfig.model, size: effectiveConfig.size, count: getGenerationCount(effectiveConfig.canvasImageCount || effectiveConfig.count) }
                    : undefined;
            const newNode = createCanvasNode(type, pending.position, metadata);
            const connection = normalizeConnection(pending.connection.nodeId, newNode.id, [...nodesRef.current, newNode], pending.connection.handleType);
            if (!connection) {
                message.warning("配置节点之间不能连接");
                return;
            }
            const nextNodes = [...nodesRef.current, newNode];
            const nextConnections = [...connectionsRef.current, { id: nanoid(), ...connection }];
            nodesRef.current = nextNodes;
            connectionsRef.current = nextConnections;
            setNodes(nextNodes);
            setConnections(nextConnections);
            setSelectedNodeIds(new Set([newNode.id]));
            setSelectedConnectionId(null);
            const definition = getNodeDefinition(type);
            if (!definition?.hidePanel && (definition?.Panel || definition?.useBuiltinPanel || (!definition && type !== CanvasNodeType.Text && type !== CanvasNodeType.Audio))) setDialogNodeId(newNode.id);
            setPendingConnectionCreate(null);
            setConnecting(null);
        },
        [effectiveConfig.canvasImageCount, effectiveConfig.count, effectiveConfig.imageModel, effectiveConfig.model, effectiveConfig.size, message, setConnecting],
    );

    const cancelPendingConnectionCreate = useCallback(() => {
        setPendingConnectionCreate(null);
        setConnecting(null);
    }, [setConnecting]);

    const getConnectionDropTarget = useCallback(
        (clientX: number, clientY: number, current: ConnectionHandle): ConnectionDropTarget => {
            const world = screenToCanvas(clientX, clientY);
            const scale = Math.max(viewportRef.current.k, 0.05);
            const padding = CONNECTION_NODE_HIT_PADDING / scale;
            const handleRadius = CONNECTION_HANDLE_HIT_RADIUS / scale;
            let isNearNode = false;
            let bestNodeId: string | null = null;
            let bestPriority = Number.POSITIVE_INFINITY;

            [...nodesRef.current]
                .filter((node) => !isHiddenCanvasNode(node, nodesRef.current))
                .reverse()
                .forEach((node) => {
                    const anchor = getConnectionTargetAnchor(node, current);
                    const dx = world.x - anchor.x;
                    const dy = world.y - anchor.y;
                    const hitsHandle = dx * dx + dy * dy <= handleRadius * handleRadius;
                    const hitsInside = world.x >= node.position.x && world.x <= node.position.x + node.width && world.y >= node.position.y && world.y <= node.position.y + node.height;
                    const hitsExpanded = world.x >= node.position.x - padding && world.x <= node.position.x + node.width + padding && world.y >= node.position.y - padding && world.y <= node.position.y + node.height + padding;

                    if (!hitsHandle && !hitsInside && !hitsExpanded) return;
                    isNearNode = true;
                    if (node.id === current.nodeId || !normalizeConnection(current.nodeId, node.id, nodesRef.current, current.handleType)) return;

                    const priority = hitsInside ? 0 : hitsHandle ? 1 : 2;
                    if (priority < bestPriority) {
                        bestNodeId = node.id;
                        bestPriority = priority;
                    }
                });

            return { nodeId: bestNodeId, isNearNode };
        },
        [screenToCanvas],
    );

    const visibleNodes = useMemo(() => {
        const padding = 280;
        const rect = containerRef.current?.getBoundingClientRect();
        const width = rect?.width || size.width;
        const height = rect?.height || size.height;
        const viewLeft = -viewport.x / viewport.k - padding;
        const viewTop = -viewport.y / viewport.k - padding;
        const viewRight = viewLeft + width / viewport.k + padding * 2;
        const viewBottom = viewTop + height / viewport.k + padding * 2;

        return nodes
            .filter((node) => !isHiddenCanvasNode(node, nodes, collapsingBatchIds) && node.position.x + node.width > viewLeft && node.position.x < viewRight && node.position.y + node.height > viewTop && node.position.y < viewBottom)
            .sort((a, b) => (a.type === CanvasNodeType.Workspace ? -1 : 0) - (b.type === CanvasNodeType.Workspace ? -1 : 0));
    }, [collapsingBatchIds, nodes, size.height, size.width, viewport.k, viewport.x, viewport.y]);
    const minimapNodes = useMemo(() => nodes.filter((node) => !isHiddenCanvasNode(node, nodes)), [nodes]);

    const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
    const toolbarNode = toolbarNodeId ? nodeById.get(toolbarNodeId) || null : null;
    const infoNode = infoNodeId ? nodeById.get(infoNodeId) || null : null;
    const cropNode = cropNodeId ? nodeById.get(cropNodeId) || null : null;
    const maskEditNode = maskEditNodeId ? nodeById.get(maskEditNodeId) || null : null;
    const splitNode = splitNodeId ? nodeById.get(splitNodeId) || null : null;
    const upscaleNode = upscaleNodeId ? nodeById.get(upscaleNodeId) || null : null;
    const superResolveNode = superResolveNodeId ? nodeById.get(superResolveNodeId) || null : null;
    const angleNode = angleNodeId ? nodeById.get(angleNodeId) || null : null;
    const previewNode = previewNodeId ? nodeById.get(previewNodeId) || null : null;
    const promptAssistantNode = promptAssistantNodeId ? nodeById.get(promptAssistantNodeId) || null : null;
    const scriptNode = scriptNodeId ? nodeById.get(scriptNodeId) || null : null;
    const scriptVideoCounts = useMemo(() => storyboardVideoCountsForScript(scriptNode, nodes), [nodes, scriptNode]);
    const hasMultipleSelectedNodes = selectedNodeIds.size > 1;
    const activeNodeId = hasMultipleSelectedNodes ? null : hoveredNodeId || (selectedNodeIds.size === 1 ? Array.from(selectedNodeIds)[0] : null);
    const selectedCharacterReferenceSourceNode = useMemo(() => {
        if (selectedNodeIds.size !== 1) return null;
        const node = nodeById.get(Array.from(selectedNodeIds)[0]);
        return node?.type === CanvasNodeType.Image && node.metadata?.content ? node : null;
    }, [nodeById, selectedNodeIds]);
    const batchChildCountById = useMemo(() => {
        const map = new Map<string, number>();
        nodes.forEach((node) => {
            if (node.metadata?.isBatchRoot) map.set(node.id, node.metadata.batchChildIds?.length || 0);
        });
        return map;
    }, [nodes]);
    const groupChildCountById = useMemo(() => {
        const map = new Map<string, number>();
        nodes.forEach((node) => {
            const groupId = node.metadata?.groupId;
            if (groupId) map.set(groupId, (map.get(groupId) || 0) + 1);
        });
        return map;
    }, [nodes]);
    const storyboardVideoResultsByDraftId = useMemo(() => {
        const map = new Map<string, CanvasNodeData[]>();
        nodes.forEach((node) => {
            const draftId = node.metadata?.storyboardVideoDraftNodeId;
            if (!draftId) return;
            const results = map.get(draftId) || [];
            results.push(node);
            map.set(draftId, results);
        });
        map.forEach((results) => results.sort((a, b) => (b.metadata?.storyboardVideoVariantIndex || 0) - (a.metadata?.storyboardVideoVariantIndex || 0)));
        return map;
    }, [nodes]);
    const batchMotionById = useMemo(() => {
        const map = new Map<string, { x: number; y: number; index: number }>();
        nodes.forEach((node) => {
            const rootId = node.metadata?.batchRootId;
            if (!rootId) return;
            const root = nodeById.get(rootId);
            const index = root?.metadata?.batchChildIds?.indexOf(node.id) ?? 0;
            const stackX = root ? root.position.x + 34 + index * 14 : node.position.x;
            const stackY = root ? root.position.y + 14 + index * 8 : node.position.y;
            map.set(node.id, { x: stackX - node.position.x, y: stackY - node.position.y, index: Math.max(index, 0) });
        });
        return map;
    }, [nodeById, nodes]);
    const relatedHighlight = useMemo(() => {
        const nodeIds = new Set<string>();
        const connectionIds = new Set<string>();

        if (!activeNodeId) return { nodeIds, connectionIds };

        nodeIds.add(activeNodeId);
        connections.forEach((connection) => {
            if (connection.fromNodeId !== activeNodeId && connection.toNodeId !== activeNodeId) return;
            connectionIds.add(connection.id);
            nodeIds.add(connection.fromNodeId);
            nodeIds.add(connection.toNodeId);
        });

        return { nodeIds, connectionIds };
    }, [activeNodeId, connections]);

    const configInputsById = useMemo(() => {
        const map = new Map<string, NodeGenerationInput[]>();
        nodes.forEach((node) => {
            if (node.type !== CanvasNodeType.Config) return;
            map.set(node.id, buildNodeGenerationInputs(node.id, nodes, connections));
        });
        return map;
    }, [connections, nodes]);
    const resourceContextNodeId = dialogNodeId || activeNodeId;
    const mentionReferencesByNodeId = useMemo(() => {
        const map = new Map<string, ReturnType<typeof buildNodeMentionReferences>>();
        nodes.forEach((node) => map.set(node.id, buildNodeMentionReferences(node, nodes, connections)));
        return map;
    }, [connections, nodes]);
    const agentSnapshot = useMemo<CanvasAgentSnapshot>(
        () => ({ projectId, title: currentProject?.title || "未命名画布", nodes, connections, selectedNodeIds: Array.from(selectedNodeIds), viewport }),
        [connections, currentProject?.title, nodes, projectId, selectedNodeIds, viewport],
    );
    const applyAgentOps = useCallback(
        (ops?: CanvasAgentOp[]) => {
            const safeOps = Array.isArray(ops) ? ops.filter((op) => op?.type) : [];
            const before = { projectId, title: currentProject?.title || "未命名画布", nodes: nodesRef.current, connections: connectionsRef.current, selectedNodeIds: Array.from(selectedNodeIdsRef.current), viewport: viewportRef.current };
            const generationOps = safeOps.filter((op): op is Extract<CanvasAgentOp, { type: "run_generation" }> => op.type === "run_generation" && Boolean(op.nodeId));
            const next = applyCanvasAgentOps(before, safeOps.filter((op) => op.type !== "run_generation"));
            nodesRef.current = next.nodes;
            connectionsRef.current = next.connections;
            selectedNodeIdsRef.current = new Set(next.selectedNodeIds);
            viewportRef.current = next.viewport;
            setAgentUndoSnapshot(before);
            setNodes(next.nodes);
            setConnections(next.connections);
            setSelectedNodeIds(new Set(next.selectedNodeIds));
            setSelectedConnectionId(null);
            setViewport(next.viewport);
            setContextMenu(null);
            if (generationOps.length) {
                queueMicrotask(() =>
                    generationOps.forEach((op) => {
                        const target = nodesRef.current.find((node) => node.id === op.nodeId);
                        const prompt = op.prompt?.trim() ? op.prompt : target?.metadata?.composerContent ?? target?.metadata?.prompt ?? "";
                        void generateNodeRef.current?.(op.nodeId, op.mode || target?.metadata?.generationMode || "image", prompt);
                    }),
                );
            }
            return { ...next, projectId, title: currentProject?.title || "未命名画布" };
        },
        [currentProject?.title, projectId],
    );
    const undoAgentOps = useCallback(() => {
        if (!agentUndoSnapshot) return null;
        nodesRef.current = agentUndoSnapshot.nodes;
        connectionsRef.current = agentUndoSnapshot.connections;
        selectedNodeIdsRef.current = new Set(agentUndoSnapshot.selectedNodeIds);
        viewportRef.current = agentUndoSnapshot.viewport;
        setNodes(agentUndoSnapshot.nodes);
        setConnections(agentUndoSnapshot.connections);
        setSelectedNodeIds(new Set(agentUndoSnapshot.selectedNodeIds));
        setSelectedConnectionId(null);
        setViewport(agentUndoSnapshot.viewport);
        setContextMenu(null);
        setAgentUndoSnapshot(null);
        return { ...agentUndoSnapshot, projectId, title: currentProject?.title || "未命名画布" };
    }, [agentUndoSnapshot, currentProject?.title, projectId]);

    useEffect(() => {
        setAgentCanvasContext({ snapshot: agentSnapshot, applyOps: applyAgentOps, undoOps: undoAgentOps, canUndo: Boolean(agentUndoSnapshot) });
        return () => setAgentCanvasContext(null);
    }, [agentSnapshot, applyAgentOps, agentUndoSnapshot, setAgentCanvasContext, undoAgentOps]);
    const createNode = useCallback(
        (type: CanvasNodeTypeId, position?: Position) => {
            const targetPosition = position || getCanvasCenter();
            const configMetadata: CanvasNodeMetadata | undefined =
                type === CanvasNodeType.Config
                    ? {
                          model: effectiveConfig.imageModel || effectiveConfig.model,
                          size: effectiveConfig.size,
                          count: getGenerationCount(effectiveConfig.canvasImageCount || effectiveConfig.count),
                      }
                    : type === CanvasNodeType.Script
                      ? { content: "", prompt: STORYBOARD_SCRIPT_PRESET, status: NODE_STATUS_IDLE, fontSize: 12, storyboardRows: [], storyboardProductionScope: "series", seconds: "15", model: effectiveConfig.textModel || effectiveConfig.model }
                      : undefined;
            const newNode = createCanvasNode(type, targetPosition, configMetadata);

            setNodes((prev) => [...prev, newNode]);
            setSelectedNodeIds(new Set([newNode.id]));
            setSelectedConnectionId(null);
            const definition = getNodeDefinition(type);
            if (!definition?.hidePanel && (definition?.Panel || definition?.useBuiltinPanel || (!definition && type !== CanvasNodeType.Text && type !== CanvasNodeType.Audio))) setDialogNodeId(newNode.id);
        },
        [effectiveConfig.canvasImageCount, effectiveConfig.count, effectiveConfig.imageModel, effectiveConfig.model, effectiveConfig.size, effectiveConfig.textModel, getCanvasCenter],
    );

    const createCharacterReferenceCardNode = useCallback(
        (sourceNode: CanvasNodeData) => {
            if (sourceNode.type !== CanvasNodeType.Image || !sourceNode.metadata?.content) {
                message.warning("请先选中或上传一张人物照片");
                return;
            }
            const spec = getNodeSpec(CanvasNodeType.Config);
            const variantPrompts = CHARACTER_REFERENCE_VARIANTS.map((variant) => buildCharacterReferencePrompt(variant, ""));
            const configNode = createCanvasNode(
                CanvasNodeType.Config,
                {
                    x: sourceNode.position.x + sourceNode.width + 96 + spec.width / 2,
                    y: sourceNode.position.y + sourceNode.height / 2,
                },
                {
                    generationMode: "image",
                    model: effectiveConfig.imageModel || effectiveConfig.model,
                    quality: effectiveConfig.quality,
                    size: "2:3",
                    count: variantPrompts.length,
                    prompt: "基于左侧人物照片生成方舟私域虚拟人像素材库所需的角色基准图。保持同一张脸、同一发型、同一体型、同一套服装和同一画风。",
                    status: NODE_STATUS_IDLE,
                    disableAutoMultiView: true,
                    characterReferenceVariantPrompts: variantPrompts,
                    characterReferenceVariantTitles: CHARACTER_REFERENCE_VARIANTS.map((variant) => variant.title),
                },
            );
            const connection = { id: nanoid(), fromNodeId: sourceNode.id, toNodeId: configNode.id };
            setNodes((prev) => [...prev, configNode]);
            setConnections((prev) => addUniqueConnections(prev, [connection]));
            setSelectedNodeIds(new Set([configNode.id]));
            setSelectedConnectionId(null);
            setDialogNodeId(configNode.id);
            message.success("已创建角色卡生图配置，点击节点里的“开始生成”即可生成基准图");
        },
        [effectiveConfig.imageModel, effectiveConfig.model, effectiveConfig.quality, message],
    );

    const handleMangaCardImportRequest = useCallback(() => {
        if (selectedCharacterReferenceSourceNode) {
            createCharacterReferenceCardNode(selectedCharacterReferenceSourceNode);
            return;
        }
        mangaCardInputRef.current?.click();
    }, [createCharacterReferenceCardNode, selectedCharacterReferenceSourceNode]);

    const handleMangaStoryboardImportRequest = useCallback(() => {
        mangaStoryboardInputRef.current?.click();
    }, []);

    const handleScene360ImportRequest = useCallback(() => {
        scene360InputRef.current?.click();
    }, []);

    const handleMangaCardInputChange = useCallback(
        async (event: ReactChangeEvent<HTMLInputElement>) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            try {
                if (file.type.startsWith("image/")) {
                    const image = await uploadImage(file);
                    const imageSize = fitNodeSize(image.width, image.height);
                    const center = getCanvasCenter();
                    const imageNode: CanvasNodeData = {
                        id: `image-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                        type: CanvasNodeType.Image,
                        title: file.name,
                        position: { x: center.x - imageSize.width - 260, y: center.y - imageSize.height / 2 },
                        width: imageSize.width,
                        height: imageSize.height,
                        metadata: imageMetadata(image),
                    };
                    setNodes((prev) => [...prev, imageNode]);
                    createCharacterReferenceCardNode(imageNode);
                    return;
                }
                const text = await file.text();
                const { characters, nodes: importedNodes } = buildMangaCharacterPromptNodes({
                    text,
                    center: getCanvasCenter(),
                    model: effectiveConfig.imageModel || effectiveConfig.model,
                    quality: effectiveConfig.quality,
                });
                if (!importedNodes.length) {
                    message.warning("未识别到可导入的角色卡提示词");
                    return;
                }
                setNodes((prev) => [...prev, ...importedNodes]);
                setSelectedNodeIds(new Set(importedNodes.map((node) => node.id)));
                setSelectedConnectionId(null);
                setDialogNodeId(importedNodes[0]?.id || null);
                message.success(`已导入 ${characters.length} 个角色，生成 ${importedNodes.length} 个生图节点`);
            } catch (error) {
                message.error(error instanceof Error ? error.message : "角色卡导入失败");
            }
        },
        [createCharacterReferenceCardNode, effectiveConfig.imageModel, effectiveConfig.model, effectiveConfig.quality, getCanvasCenter, message],
    );

    const handleMangaStoryboardInputChange = useCallback(
        async (event: ReactChangeEvent<HTMLInputElement>) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            try {
                const text = await file.text();
                const { scenes, nodes: importedNodes, connections: importedConnections } = buildMangaScenePromptNodes({
                    text,
                    fileName: file.name,
                    center: getCanvasCenter(),
                    model: effectiveConfig.imageModel || effectiveConfig.model,
                    quality: effectiveConfig.quality,
                });
                if (!importedNodes.length) {
                    message.warning("未识别到可导入的分镜场景提示词");
                    return;
                }
                setNodes((prev) => [...prev, ...importedNodes]);
                setConnections((prev) => [...prev, ...importedConnections]);
                setSelectedNodeIds(new Set(importedNodes.map((node) => node.id)));
                setSelectedConnectionId(null);
                setDialogNodeId(importedNodes[0]?.id || null);
                message.success(`已导入 ${scenes.length} 个场景，生成 ${importedNodes.length} 个场景图节点`);
            } catch (error) {
                message.error(error instanceof Error ? error.message : "分镜导入失败");
            }
        },
        [effectiveConfig.imageModel, effectiveConfig.model, effectiveConfig.quality, getCanvasCenter, message],
    );

    const handleScene360InputChange = useCallback(
        async (event: ReactChangeEvent<HTMLInputElement>) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            try {
                const text = await file.text();
                const { scenes, nodes: importedNodes, connections: importedConnections } = buildScene360PromptNodes({
                    text,
                    fileName: file.name,
                    center: getCanvasCenter(),
                    model: effectiveConfig.imageModel || effectiveConfig.model,
                    quality: effectiveConfig.quality,
                });
                if (!importedNodes.length) {
                    message.warning("未识别到可导入的 Scene360 场景锁定 JSON");
                    return;
                }
                setNodes((prev) => [...prev, ...importedNodes]);
                setConnections((prev) => [...prev, ...importedConnections]);
                setSelectedNodeIds(new Set(importedNodes.map((node) => node.id)));
                setSelectedConnectionId(null);
                setDialogNodeId(importedNodes[0]?.id || null);
                message.success(`已导入 ${scenes.length} 个360场景，生成 ${importedNodes.length} 个节点`);
            } catch (error) {
                message.error(error instanceof Error ? error.message : "Scene360 导入失败");
            }
        },
        [effectiveConfig.imageModel, effectiveConfig.model, effectiveConfig.quality, getCanvasCenter, message],
    );

    const deleteNodes = useCallback(
        (ids: Set<string>) => {
            if (!ids.size) return;
            const allIds = new Set(ids);
            nodesRef.current.forEach((node) => {
                if (ids.has(node.id)) node.metadata?.batchChildIds?.forEach((childId) => allIds.add(childId));
                if (ids.has(node.id)) node.metadata?.workspaceChildNodeIds?.forEach((childId) => allIds.add(childId));
                if (node.metadata?.storyboardSeriesRootNodeId && ids.has(node.metadata.storyboardSeriesRootNodeId)) allIds.add(node.id);
            });
            setNodes((prev) => {
                const next = prev.filter((node) => !allIds.has(node.id));
                return next.map((node) => {
                    const groupId = node.metadata?.groupId;
                    if (groupId && allIds.has(groupId)) return { ...node, metadata: { ...node.metadata, groupId: undefined } };
                    const childIds = node.metadata?.batchChildIds?.filter((childId) => !allIds.has(childId));
                    if (!node.metadata?.isBatchRoot || childIds?.length === node.metadata.batchChildIds?.length) return node;
                    const primaryImageId = childIds?.includes(node.metadata.primaryImageId || "") ? node.metadata.primaryImageId : childIds?.[0];
                    const primaryNode = next.find((item) => item.id === primaryImageId);
                    return {
                        ...node,
                        metadata: {
                            ...node.metadata,
                            batchChildIds: childIds,
                            primaryImageId,
                            content: primaryNode?.metadata?.content || node.metadata.content,
                            naturalWidth: primaryNode?.metadata?.naturalWidth || node.metadata.naturalWidth,
                            naturalHeight: primaryNode?.metadata?.naturalHeight || node.metadata.naturalHeight,
                        },
                    };
                });
            });
            setConnections((prev) => prev.filter((conn) => !allIds.has(conn.fromNodeId) && !allIds.has(conn.toNodeId)));
            setSelectedNodeIds(new Set());
            setSelectedConnectionId(null);
            setHoveredNodeId((current) => (current && allIds.has(current) ? null : current));
            setToolbarNodeId((current) => (current && allIds.has(current) ? null : current));
            setDialogNodeId((current) => (current && allIds.has(current) ? null : current));
            setEditingNodeId((current) => (current && allIds.has(current) ? null : current));
            setInfoNodeId((current) => (current && allIds.has(current) ? null : current));
            setCropNodeId((current) => (current && allIds.has(current) ? null : current));
            setMaskEditNodeId((current) => (current && allIds.has(current) ? null : current));
            setAngleNodeId((current) => (current && allIds.has(current) ? null : current));
            setPreviewNodeId((current) => (current && allIds.has(current) ? null : current));
            setRunningNodeId((current) => (current && allIds.has(current) ? null : current));
            setContextMenu((current) => (current?.type === "node" && allIds.has(current.nodeId) ? null : current));
            cleanupCanvasFiles({ projectId, nodes: nodesRef.current.filter((node) => !allIds.has(node.id)), chatSessions });
        },
        [chatSessions, cleanupCanvasFiles, projectId],
    );

    const deleteConnection = useCallback((connectionId: string) => {
        setConnections((prev) => prev.filter((conn) => conn.id !== connectionId));
        setSelectedConnectionId((current) => (current === connectionId ? null : current));
        setContextMenu((current) => (current?.type === "connection" && current.connectionId === connectionId ? null : current));
    }, []);

    const deselectCanvas = useCallback(() => {
        cancelPendingConnectionCreate();
        setSelectedNodeIds(new Set());
        setSelectedConnectionId(null);
        setContextMenu(null);
        setSelectionBox(null);
        setHoveredNodeId(null);
        setToolbarNodeId(null);
        setDialogNodeId(null);
        setEditingNodeId(null);
    }, [cancelPendingConnectionCreate]);

    const clearCanvas = useCallback(() => {
        setNodes([]);
        setConnections([]);
        setInfoNodeId(null);
        setCropNodeId(null);
        setMaskEditNodeId(null);
        setAngleNodeId(null);
        setPreviewNodeId(null);
        setRunningNodeId(null);
        deselectCanvas();
        setClearConfirmOpen(false);
        cleanupCanvasFiles({ projectId, nodes: [], chatSessions: [] });
    }, [cleanupCanvasFiles, deselectCanvas, projectId]);

    const duplicateNode = useCallback((nodeId: string) => {
        const source = nodesRef.current.find((node) => node.id === nodeId);
        if (!source) return;

        const id = `${source.type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const next: CanvasNodeData = {
            ...source,
            id,
            title: `${source.title} Copy`,
            position: { x: source.position.x + 36, y: source.position.y + 36 },
        };

        setNodes((prev) => [...prev, next]);
        setSelectedNodeIds(new Set([id]));
        setSelectedConnectionId(null);
        if (next.type !== CanvasNodeType.Group) setDialogNodeId(id);
    }, []);

    const copySelectedNodes = useCallback(() => {
        const selectedIds = selectedNodeIdsRef.current;
        if (!selectedIds.size) return;

        const copiedNodes = nodesRef.current
            .filter((node) => selectedIds.has(node.id))
            .map((node) => ({
                ...node,
                position: { ...node.position },
                metadata: node.metadata ? { ...node.metadata } : undefined,
            }));

        if (!copiedNodes.length) return;

        clipboardRef.current = {
            nodes: copiedNodes,
            connections: connectionsRef.current.filter((connection) => selectedIds.has(connection.fromNodeId) && selectedIds.has(connection.toNodeId)).map((connection) => ({ ...connection })),
        };
    }, []);

    const pasteCopiedNodes = useCallback((targetPosition?: Position) => {
        const clipboard = clipboardRef.current;
        if (!clipboard?.nodes.length) return false;

        const center = targetPosition || getCanvasCenter();
        const bounds = clipboard.nodes.reduce(
            (acc, node) => ({
                left: Math.min(acc.left, node.position.x),
                top: Math.min(acc.top, node.position.y),
                right: Math.max(acc.right, node.position.x + node.width),
                bottom: Math.max(acc.bottom, node.position.y + node.height),
            }),
            { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
        );
        const dx = center.x - (bounds.left + bounds.right) / 2;
        const dy = center.y - (bounds.top + bounds.bottom) / 2;
        const idMap = new Map<string, string>();
        const nextNodes = clipboard.nodes.map((node, index) => {
            const id = `${node.type}-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`;
            idMap.set(node.id, id);
            return {
                ...node,
                id,
                title: node.title.endsWith(" Copy") ? node.title : `${node.title} Copy`,
                position: {
                    x: node.position.x + dx,
                    y: node.position.y + dy,
                },
                metadata: node.metadata ? { ...node.metadata } : undefined,
            };
        });

        const pastedNodes = nextNodes.map((node) => {
            const groupId = node.metadata?.groupId;
            if (!groupId) return node;
            return { ...node, metadata: { ...node.metadata, groupId: idMap.get(groupId) } };
        });

        const nextConnections = clipboard.connections.flatMap((connection, index) => {
            const fromNodeId = idMap.get(connection.fromNodeId);
            const toNodeId = idMap.get(connection.toNodeId);
            if (!fromNodeId || !toNodeId) return [];
            return [
                {
                    ...connection,
                    id: `conn-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
                    fromNodeId,
                    toNodeId,
                },
            ];
        });

        setNodes((prev) => [...prev, ...pastedNodes]);
        setConnections((prev) => [...prev, ...nextConnections]);
        setSelectedNodeIds(new Set(pastedNodes.map((node) => node.id)));
        setSelectedConnectionId(null);
        setContextMenu(null);
        setDialogNodeId(pastedNodes[0]?.type === CanvasNodeType.Group ? null : pastedNodes[0]?.id || null);
        return true;
    }, [getCanvasCenter]);

    const resetViewport = useCallback(() => {
        setViewport({ x: size.width / 2, y: size.height / 2, k: 1 });
        setContextMenu(null);
    }, [size.height, size.width]);

    const focusNode = useCallback(
        (nodeId: string) => {
            const node = nodesRef.current.find((item) => item.id === nodeId);
            if (!node) return;
            const worldX = node.position.x + node.width / 2;
            const worldY = node.position.y + node.height / 2;
            const scale = Math.min(Math.max(Math.min((size.width * 0.6) / node.width, (size.height * 0.6) / node.height), 0.05), 1.5);
            setViewport({ x: size.width / 2 - worldX * scale, y: size.height / 2 - worldY * scale, k: scale });
            setSelectedNodeIds(new Set([nodeId]));
            setSelectedConnectionId(null);
            setToolbarNodeId(null);
            setContextMenu(null);
        },
        [size.height, size.width],
    );

    const setZoomScale = useCallback(
        (scale: number) => {
            const nextScale = Math.min(Math.max(scale, 0.05), 5);
            setViewport((prev) => ({
                x: size.width / 2 - ((size.width / 2 - prev.x) / prev.k) * nextScale,
                y: size.height / 2 - ((size.height / 2 - prev.y) / prev.k) * nextScale,
                k: nextScale,
            }));
            setContextMenu(null);
        },
        [size.height, size.width],
    );

    const applyHistory = useCallback((entry: CanvasHistoryEntry) => {
        if (historyCommitTimerRef.current) {
            clearTimeout(historyCommitTimerRef.current);
            historyCommitTimerRef.current = null;
        }
        applyingHistoryRef.current = true;
        setNodes(entry.nodes);
        setConnections(entry.connections);
        setChatSessions(entry.chatSessions);
        setActiveChatId(entry.activeChatId);
        setBackgroundMode(entry.backgroundMode);
        setShowImageInfo(entry.showImageInfo);
        setSelectedNodeIds(new Set());
        setSelectedConnectionId(null);
        setContextMenu(null);
        setTimeout(() => {
            lastHistoryRef.current = entry;
            applyingHistoryRef.current = false;
            setHistoryState({ canUndo: historyRef.current.past.length > 0, canRedo: historyRef.current.future.length > 0 });
        });
    }, []);

    const undoCanvas = useCallback(() => {
        const previous = historyRef.current.past.pop();
        const current = lastHistoryRef.current;
        if (!previous || !current) return;
        historyRef.current.future.push(current);
        applyHistory(previous);
    }, [applyHistory]);

    const redoCanvas = useCallback(() => {
        const next = historyRef.current.future.pop();
        const current = lastHistoryRef.current;
        if (!next || !current) return;
        historyRef.current.past.push(current);
        applyHistory(next);
    }, [applyHistory]);

    const createAndOpenProject = useCallback(() => {
        const id = createProject(`无限画布 ${useCanvasStore.getState().projects.length + 1}`);
        navigate(`/canvas/${id}`);
    }, [createProject, navigate]);

    const deleteCurrentProject = useCallback(() => {
        deleteProjects([projectId]);
        cleanupAssetImages();
        navigate("/canvas");
    }, [cleanupAssetImages, deleteProjects, projectId, navigate]);

    const exportCurrentProject = useCallback(async () => {
        const project = useCanvasStore.getState().projects.find((item) => item.id === projectId);
        if (!project) return message.error("未找到当前画布");
        const hide = message.loading("正在导出当前画布…", 0);
        try {
            await exportCanvasProjects([project], project.title || "无限画布");
            message.success("已导出当前画布");
        } catch (error) {
            console.error(error);
            message.error("导出失败，请重试");
        } finally {
            hide();
        }
    }, [message, projectId]);

    const handleCanvasMouseDown = useCallback(
        (event: ReactPointerEvent<HTMLDivElement>) => {
            setContextMenu(null);
            setNodeCreatePosition(null);
            if (pendingConnectionCreateRef.current) cancelPendingConnectionCreate();
            if (event.button !== 0) return;

            if (!event.ctrlKey && !event.metaKey) {
                setSelectionBox(null);
                setSelectedNodeIds(new Set());
                setSelectedConnectionId(null);
                return;
            }

            const world = screenToCanvas(event.clientX, event.clientY);
            const nextSelectionBox = {
                startWorldX: world.x,
                startWorldY: world.y,
                currentWorldX: world.x,
                currentWorldY: world.y,
                additive: event.shiftKey,
                initialSelectedNodeIds: event.shiftKey ? Array.from(selectedNodeIdsRef.current) : [],
            };
            selectionBoxRef.current = nextSelectionBox;
            setSelectionBox(nextSelectionBox);
            if (!event.shiftKey) {
                setSelectedNodeIds(new Set());
            }

            setSelectedConnectionId(null);
        },
        [cancelPendingConnectionCreate, screenToCanvas],
    );

    const handleNodeMouseDown = useCallback((event: ReactMouseEvent, nodeId: string) => {
        event.stopPropagation();
        setContextMenu(null);
        setHoveredNodeId(null);
        setSelectedConnectionId(null);

        const currentSelected = selectedNodeIdsRef.current;
        const currentNodes = nodesRef.current;
        const nextSelected = new Set(currentSelected);

        if (event.shiftKey || event.metaKey || event.ctrlKey) {
            if (nextSelected.has(nodeId)) {
                nextSelected.delete(nodeId);
            } else {
                nextSelected.add(nodeId);
            }
        } else if (!nextSelected.has(nodeId)) {
            nextSelected.clear();
            nextSelected.add(nodeId);
        }

        setSelectedNodeIds(nextSelected);
        setToolbarNodeId(nextSelected.size === 1 && nextSelected.has(nodeId) ? nodeId : null);
        const dragIds = new Set(nextSelected);
        currentNodes.forEach((node) => {
            if (nextSelected.has(node.id)) node.metadata?.batchChildIds?.forEach((childId) => dragIds.add(childId));
            if (nextSelected.has(node.id)) node.metadata?.workspaceChildNodeIds?.forEach((childId) => dragIds.add(childId));
            if (nextSelected.has(node.id) && node.type === CanvasNodeType.Group) {
                currentNodes.forEach((child) => {
                    if (child.metadata?.groupId === node.id) dragIds.add(child.id);
                });
            }
        });
        dragRef.current = {
            isDraggingNode: true,
            hasMoved: false,
            startX: event.clientX,
            startY: event.clientY,
            initialSelectedNodes: currentNodes.filter((node) => dragIds.has(node.id)).map((node) => ({ id: node.id, x: node.position.x, y: node.position.y })),
        };
        historyPausedRef.current = true;
        nodeDraggingRef.current = true;
        setIsNodeDragging(true);
    }, []);

    const finishNodeDrag = useCallback((clientX?: number, clientY?: number) => {
        if (rafRef.current) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        }
        if (!dragRef.current.isDraggingNode) return;

        const wasClick = !dragRef.current.hasMoved && dragRef.current.initialSelectedNodes.length === 1;
        const clickedNodeId = dragRef.current.initialSelectedNodes[0]?.id;
        const currentViewport = viewportRef.current;
        const dx = clientX == null ? 0 : (clientX - dragRef.current.startX) / currentViewport.k;
        const dy = clientY == null ? 0 : (clientY - dragRef.current.startY) / currentViewport.k;
        const initialPositions = dragRef.current.initialSelectedNodes;

        historyPausedRef.current = false;
        nodeDraggingRef.current = false;
        setIsNodeDragging(false);
        setDropTargetGroupId(null);
        if (dragRef.current.hasMoved && clientX != null && clientY != null) {
            const movedIds = new Set(initialPositions.map((item) => item.id));
            setNodes((prev) => {
                const moved = prev.map((node) => {
                    const initial = initialPositions.find((item) => item.id === node.id);
                    if (!initial) return node;
                    return { ...node, position: { x: initial.x + dx, y: initial.y + dy } };
                });
                const targetGroup = findGroupDropTarget(movedIds, moved);
                if (targetGroup) return snapNodesIntoGroup(movedIds, moved, targetGroup);
                return moved.map((node) => {
                    if (!movedIds.has(node.id) || node.type === CanvasNodeType.Group || node.type === CanvasNodeType.Workspace) return node;
                    const groupId = findContainingGroupId(node, moved);
                    if (node.metadata?.groupId === groupId) return node;
                    return { ...node, metadata: { ...node.metadata, groupId } };
                });
            });
        }

        dragRef.current.isDraggingNode = false;
        dragRef.current.hasMoved = false;
        dragRef.current.initialSelectedNodes = [];
        if (wasClick && clickedNodeId) {
            const clickedNode = nodesRef.current.find((node) => node.id === clickedNodeId);
            if (clickedNode?.type === CanvasNodeType.Text) {
                setDialogNodeId((current) => (current === clickedNodeId ? current : null));
            } else if (clickedNode?.type === CanvasNodeType.Workspace || clickedNode?.type === CanvasNodeType.Group) {
                setDialogNodeId(null);
            } else {
                setDialogNodeId(clickedNodeId);
            }
        }
    }, []);

    const handleGlobalMouseMove = useCallback(
        (event: MouseEvent) => {
            const currentViewport = viewportRef.current;

            if (dragRef.current.isDraggingNode) {
                const dx = (event.clientX - dragRef.current.startX) / currentViewport.k;
                const dy = (event.clientY - dragRef.current.startY) / currentViewport.k;
                const initialPositions = dragRef.current.initialSelectedNodes;
                if (Math.abs(event.clientX - dragRef.current.startX) > 3 || Math.abs(event.clientY - dragRef.current.startY) > 3) {
                    dragRef.current.hasMoved = true;
                }

                const movedIds = new Set(initialPositions.map((item) => item.id));
                const previewNodes = nodesRef.current.map((node) => {
                    const initial = initialPositions.find((item) => item.id === node.id);
                    return initial ? { ...node, position: { x: initial.x + dx, y: initial.y + dy } } : node;
                });
                setDropTargetGroupId(findGroupDropTarget(movedIds, previewNodes)?.id || null);

                if (rafRef.current) cancelAnimationFrame(rafRef.current);
                rafRef.current = requestAnimationFrame(() => {
                    setNodes((prev) =>
                        prev.map((node) => {
                            const initial = initialPositions.find((item) => item.id === node.id);
                            return initial ? { ...node, position: { x: initial.x + dx, y: initial.y + dy } } : node;
                        }),
                    );
                    rafRef.current = null;
                });
                return;
            }

            if (connectingParamsRef.current && !pendingConnectionCreateRef.current) {
                const dropTarget = getConnectionDropTarget(event.clientX, event.clientY, connectingParamsRef.current);
                connectionTargetNodeIdRef.current = dropTarget.nodeId;
                setConnectionTargetNodeId(dropTarget.nodeId);
                setMouseWorld(screenToCanvas(event.clientX, event.clientY));
            }
        },
        [finishNodeDrag, getConnectionDropTarget, screenToCanvas],
    );

    const handleGlobalPointerMove = useCallback(
        (event: PointerEvent) => {
            const currentSelection = selectionBoxRef.current;
            if (!currentSelection) return;

            if (event.buttons === 0) {
                selectionBoxRef.current = null;
                setSelectionBox(null);
                return;
            }

            const world = screenToCanvas(event.clientX, event.clientY);
            const rectX = Math.min(currentSelection.startWorldX, world.x);
            const rectY = Math.min(currentSelection.startWorldY, world.y);
            const rectW = Math.abs(world.x - currentSelection.startWorldX);
            const rectH = Math.abs(world.y - currentSelection.startWorldY);
            const nextSelected = new Set<string>(currentSelection.additive ? currentSelection.initialSelectedNodeIds : []);

            nodesRef.current
                .filter((node) => !isHiddenCanvasNode(node, nodesRef.current))
                .forEach((node) => {
                    const intersects = rectX < node.position.x + node.width && rectX + rectW > node.position.x && rectY < node.position.y + node.height && rectY + rectH > node.position.y;

                    if (intersects) nextSelected.add(node.id);
                });

            const nextSelectionBox = { ...currentSelection, currentWorldX: world.x, currentWorldY: world.y };
            selectionBoxRef.current = nextSelectionBox;
            setSelectionBox(nextSelectionBox);
            setSelectedNodeIds(nextSelected);
        },
        [screenToCanvas],
    );

    const handleGlobalMouseUp = useCallback(
        (event: MouseEvent) => {
            finishNodeDrag(event.clientX, event.clientY);

            selectionBoxRef.current = null;
            setSelectionBox(null);

            if (pendingConnectionCreateRef.current) return;

            const currentConnection = connectingParamsRef.current;
            if (currentConnection) {
                const dropTarget = getConnectionDropTarget(event.clientX, event.clientY, currentConnection);
                if (dropTarget.nodeId) {
                    connectNodes(currentConnection, dropTarget.nodeId);
                    setConnecting(null);
                } else if (dropTarget.isNearNode) {
                    setConnecting(null);
                } else {
                    setMouseWorld(screenToCanvas(event.clientX, event.clientY));
                    setPendingConnectionCreate({ connection: currentConnection, position: screenToCanvas(event.clientX, event.clientY) });
                }
            }
        },
        [connectNodes, finishNodeDrag, getConnectionDropTarget, screenToCanvas, setConnecting],
    );

    useEffect(() => {
        const handlePointerUp = (event: PointerEvent) => finishNodeDrag(event.clientX, event.clientY);
        const cancelNodeDrag = () => finishNodeDrag();
        window.addEventListener("mousemove", handleGlobalMouseMove);
        window.addEventListener("mouseup", handleGlobalMouseUp);
        window.addEventListener("pointerup", handlePointerUp);
        window.addEventListener("pointercancel", cancelNodeDrag);
        window.addEventListener("blur", cancelNodeDrag);
        window.addEventListener("pointermove", handleGlobalPointerMove);
        return () => {
            window.removeEventListener("mousemove", handleGlobalMouseMove);
            window.removeEventListener("mouseup", handleGlobalMouseUp);
            window.removeEventListener("pointerup", handlePointerUp);
            window.removeEventListener("pointercancel", cancelNodeDrag);
            window.removeEventListener("blur", cancelNodeDrag);
            window.removeEventListener("pointermove", handleGlobalPointerMove);
        };
    }, [finishNodeDrag, handleGlobalMouseMove, handleGlobalMouseUp, handleGlobalPointerMove]);

    const createImageFileNode = useCallback(async (file: File, position: Position) => {
        const image = await uploadImage(file);
        const size = fitNodeSize(image.width, image.height);
        const id = `image-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const newNode: CanvasNodeData = {
            id,
            type: CanvasNodeType.Image,
            title: file.name,
            position: { x: position.x - size.width / 2, y: position.y - size.height / 2 },
            width: size.width,
            height: size.height,
            metadata: imageMetadata(image),
        };

        setNodes((prev) => [...prev, newNode]);
        setSelectedNodeIds(new Set([id]));
        setSelectedConnectionId(null);
        setDialogNodeId(id);
    }, []);

    const createVideoFileNode = useCallback(async (file: File, position: Position) => {
        const video = await uploadMediaFile(file, "video");
        const size = fitNodeSize(video.width || 1280, video.height || 720, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
        const id = `video-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        setNodes((prev) => [
            ...prev,
            {
                id,
                type: CanvasNodeType.Video,
                title: file.name,
                position: { x: position.x - size.width / 2, y: position.y - size.height / 2 },
                width: size.width,
                height: size.height,
                metadata: videoMetadata(video),
            },
        ]);
        setSelectedNodeIds(new Set([id]));
        setSelectedConnectionId(null);
        setDialogNodeId(id);
    }, []);

    const createAudioFileNode = useCallback(async (file: File, position: Position) => {
        const audio = await uploadMediaFile(file, "audio");
        const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Audio];
        const id = `audio-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        setNodes((prev) => [
            ...prev,
            {
                id,
                type: CanvasNodeType.Audio,
                title: file.name,
                position: { x: position.x - spec.width / 2, y: position.y - spec.height / 2 },
                width: spec.width,
                height: spec.height,
                metadata: audioMetadata(audio),
            },
        ]);
        setSelectedNodeIds(new Set([id]));
        setSelectedConnectionId(null);
    }, []);

    const createTextNodeFromClipboard = useCallback(
        (text: string, targetPosition?: Position) => {
            const trimmed = text.trim();
            if (!trimmed) return false;

            const node = {
                ...createCanvasNode(CanvasNodeType.Text, targetPosition || getCanvasCenter(), { content: trimmed, status: NODE_STATUS_SUCCESS }),
                title: trimmed.slice(0, 32) || "剪切板文本",
            };

            setNodes((prev) => [...prev, node]);
            setSelectedNodeIds(new Set([node.id]));
            setSelectedConnectionId(null);
            setContextMenu(null);
            setDialogNodeId(node.id);
            return true;
        },
        [getCanvasCenter],
    );

    const pasteSystemClipboard = useCallback(async (targetPosition?: Position) => {
        if (!navigator.clipboard) return;

        try {
            const items = await navigator.clipboard.read();
            const imageItem = items.find((item) => item.types.some((type) => type.startsWith("image/")));
            if (imageItem) {
                const imageType = imageItem.types.find((type) => type.startsWith("image/"));
                if (!imageType) return;
                const blob = await imageItem.getType(imageType);
                const file = new File([blob], "clipboard-image.png", { type: imageType });
                void createImageFileNode(file, targetPosition || getCanvasCenter());
                message.success("已从剪切板添加图片");
                return;
            }
        } catch (error) {
            if (!isClipboardPermissionError(error)) throw error;
        }

        try {
            const text = await navigator.clipboard.readText();
            if (createTextNodeFromClipboard(text, targetPosition)) message.success("已从剪切板添加文本");
        } catch (error) {
            if (isClipboardPermissionError(error)) message.warning("浏览器拒绝读取剪切板，请使用拖拽/上传或先授权剪切板权限");
            else throw error;
        }
    }, [createImageFileNode, createTextNodeFromClipboard, getCanvasCenter, message]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            const target = event.target instanceof Element ? event.target : null;
            if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement || target?.closest("[contenteditable='true'],[data-canvas-no-zoom]")) return;

            const key = event.key.toLowerCase();
            const isModifierShortcut = event.metaKey || event.ctrlKey;

            if (isModifierShortcut && !event.altKey && key === "z") {
                event.preventDefault();
                if (event.shiftKey) redoCanvas();
                else undoCanvas();
                return;
            }

            if (isModifierShortcut && !event.altKey && key === "y") {
                event.preventDefault();
                redoCanvas();
                return;
            }

            if (isModifierShortcut && !event.altKey && key === "a") {
                event.preventDefault();
                setSelectedNodeIds(new Set(nodesRef.current.map((node) => node.id)));
                setSelectedConnectionId(null);
                setContextMenu(null);
                setNodeCreatePosition(null);
                setSelectionBox(null);
                return;
            }

            if (isModifierShortcut && !event.altKey && key === "c") {
                event.preventDefault();
                copySelectedNodes();
                return;
            }

            if (isModifierShortcut && !event.altKey && key === "v") {
                event.preventDefault();
                if (!pasteCopiedNodes()) void pasteSystemClipboard();
                return;
            }

            if (event.key === "Delete" || event.key === "Backspace") {
                if (selectedNodeIdsRef.current.size) {
                    deleteNodes(new Set(selectedNodeIdsRef.current));
                } else if (selectedConnectionId) {
                    deleteConnection(selectedConnectionId);
                }
            }

            if (event.key === "Escape") {
                setSelectedNodeIds(new Set());
                setSelectedConnectionId(null);
                setContextMenu(null);
                setSelectionBox(null);
                setConnecting(null);
                setHoveredNodeId(null);
                setToolbarNodeId(null);
                setDialogNodeId(null);
                setEditingNodeId(null);
                setInfoNodeId(null);
                setCropNodeId(null);
                setMaskEditNodeId(null);
                setPendingConnectionCreate(null);
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [copySelectedNodes, deleteConnection, deleteNodes, pasteCopiedNodes, pasteSystemClipboard, redoCanvas, selectedConnectionId, setConnecting, undoCanvas]);

    const handleConnectStart = useCallback(
        (event: ReactMouseEvent, nodeId: string, handleType: "source" | "target") => {
            event.stopPropagation();
            setMouseWorld(screenToCanvas(event.clientX, event.clientY));
            setConnecting({ nodeId, handleType });
            connectionTargetNodeIdRef.current = null;
            setConnectionTargetNodeId(null);
            setSelectedConnectionId(null);
        },
        [screenToCanvas, setConnecting],
    );

    const handleNodeResize = useCallback((nodeId: string, width: number, height: number, position?: Position) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, width, height, position: position || node.position } : node)));
    }, []);

    const toggleNodeFreeResize = useCallback((nodeId: string) => {
        setNodes((prev) =>
            prev.map((node) => {
                if (node.id !== nodeId) return node;
                const freeResize = !node.metadata?.freeResize;
                if (freeResize || node.type !== CanvasNodeType.Image) return { ...node, metadata: { ...node.metadata, freeResize } };
                const ratio = (node.metadata?.naturalWidth || node.width) / (node.metadata?.naturalHeight || node.height || 1);
                const height = node.width / ratio;
                return { ...node, height, position: { x: node.position.x, y: node.position.y + node.height / 2 - height / 2 }, metadata: { ...node.metadata, freeResize } };
            }),
        );
    }, []);

    const handleNodeContentChange = useCallback((nodeId: string, content: string, storyboardRows?: string[][]) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, content, ...(storyboardRows ? { storyboardRows } : {}) } } : node)));
    }, []);

    const handleNodeTitleChange = useCallback((nodeId: string, title: string) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, title } : node)));
    }, []);

    const handleNodeMetadataChange = useCallback((nodeId: string, patch: Partial<CanvasNodeMetadata>) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, ...patch } } : node)));
    }, []);

    const openStoryboardScriptNode = useCallback((node: CanvasNodeData) => {
        const rootId = node.metadata?.storyboardSeriesRootNodeId;
        if (!rootId) {
            setScriptNodeId(node.id);
            return;
        }
        const root = nodesRef.current.find((item) => item.id === rootId);
        if (!root) {
            message.error("系列主节点已不存在，无法打开本章");
            return;
        }
        const chapterId = node.metadata?.storyboardSeriesChapterId;
        if (chapterId) setNodes((prev) => prev.map((item) => (item.id === rootId ? { ...item, metadata: { ...item.metadata, storyboardActiveChapterId: chapterId } } : item)));
        setScriptNodeId(rootId);
    }, [message]);

    const createStoryboardChapterNodes = useCallback((node: CanvasNodeData) => {
        const root = node.metadata?.storyboardSeriesRootNodeId ? nodesRef.current.find((item) => item.id === node.metadata?.storyboardSeriesRootNodeId) : node;
        const chapters = root?.metadata?.storyboardChapters || [];
        if (!root || root.metadata?.storyboardProductionScope !== "series" || !chapters.length) {
            message.warning("请先完成故事拆分并生成章节");
            return;
        }
        const existing = nodesRef.current.filter((item) => item.metadata?.storyboardSeriesRootNodeId === root.id);
        const existingByChapter = new Map(existing.map((item) => [item.metadata?.storyboardSeriesChapterId, item]));
        const validChapterIds = new Set(chapters.map((chapter) => chapter.id));
        const staleIds = new Set(existing.filter((item) => !item.metadata?.storyboardSeriesChapterId || !validChapterIds.has(item.metadata.storyboardSeriesChapterId)).map((item) => item.id));
        const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Script];
        const columns = Math.min(4, chapters.length);
        const startX = root.position.x;
        const startY = root.position.y + root.height + 96;
        const proxies = chapters.map((chapter, index) => {
            const current = existingByChapter.get(chapter.id);
            const column = index % columns;
            const row = Math.floor(index / columns);
            const created = current || createCanvasNode(CanvasNodeType.Script, {
                x: startX + column * (spec.width + 54) + spec.width / 2,
                y: startY + row * (spec.height + 72) + spec.height / 2,
            }, {});
            return {
                ...created,
                title: chapter.title,
                metadata: {
                    ...created.metadata,
                    storyboardSeriesRootNodeId: root.id,
                    storyboardSeriesChapterId: chapter.id,
                    storyboardProductionScope: "series" as const,
                    storyboardActiveChapterId: chapter.id,
                    storyboardChapters: [chapter],
                    storyboardStep: root.metadata?.storyboardStep || "shots",
                    status: NODE_STATUS_SUCCESS,
                },
            };
        });
        const proxyById = new Map(proxies.map((item) => [item.id, item]));
        const chapterNodeIds = Object.fromEntries(chapters.map((chapter, index) => [chapter.id, proxies[index].id]));
        setNodes((prev) => {
            const updated = prev.filter((item) => !staleIds.has(item.id)).map((item) => item.id === root.id
                ? { ...item, metadata: { ...item.metadata, storyboardSeriesChapterNodeIds: chapterNodeIds } }
                : proxyById.get(item.id) || item);
            const currentIds = new Set(updated.map((item) => item.id));
            return [...updated, ...proxies.filter((item) => !currentIds.has(item.id))];
        });
        setConnections((prev) => addUniqueConnections(prev.filter((connection) => !staleIds.has(connection.fromNodeId) && !staleIds.has(connection.toNodeId)), proxies.map((proxy) => ({ id: nanoid(), fromNodeId: root.id, toNodeId: proxy.id }))));
        message.success(`已在画布同步 ${chapters.length} 个章节 Script 节点，共用系列主节点资产`);
    }, [message]);

    const setStoryboardNarrationLocked = useCallback((nodeId: string, chapterId: string, locked: boolean) => {
        setNodes((prev) => prev.map((node) => {
            if (node.id !== nodeId) return node;
            const current = new Set(node.metadata?.storyboardLockedNarrationChapterIds || []);
            if (locked) current.add(chapterId);
            else current.delete(chapterId);
            return { ...node, metadata: { ...node.metadata, storyboardLockedNarrationChapterIds: Array.from(current) } };
        }));
    }, []);

    const updateStoryboardRows = useCallback((nodeId: string, rows: StoryboardRowsUpdater) => {
        setNodes((prev) =>
            prev.map((node) => {
                if (node.id !== nodeId) return node;
                const currentRows = parseStoryboardRows(node.metadata?.storyboardRows);
                const normalized = renumberStoryboardRowsForCanvas(typeof rows === "function" ? rows(currentRows) : rows);
                const structuralChange = normalized.length !== currentRows.length;
                return {
                    ...node,
                    metadata: {
                        ...node.metadata,
                        content: storyboardRowsToMarkdownForCanvas(normalized),
                        storyboardRows: [STORYBOARD_COLUMNS, ...normalized],
                        storyboardStep: "shots",
                        ...(structuralChange ? {
                            storyboardPlanningConfigKey: undefined,
                            storyboardPlanningCheckpoint: undefined,
                            storyboardShotPlans: undefined,
                            storyboardCoverage: undefined,
                            storyboardChapters: undefined,
                            storyboardActiveChapterId: undefined,
                            storyboardDramaturgyPlan: undefined,
                            storyboardDramaturgySource: undefined,
                            storyboardDramaturgySkillRoot: undefined,
                        } : {}),
                        storyboardPromptDetails: undefined,
                        storyboardPromptErrors: undefined,
                        storyboardPromptRawResponses: undefined,
                        storyboardLockedNarrationChapterIds: [],
                    },
                };
            }),
        );
    }, []);

    const updateStoryboardAsset = useCallback((nodeId: string, assetId: string, patch: Partial<StoryboardAsset>) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, storyboardAssets: (node.metadata?.storyboardAssets || []).map((asset) => (asset.id === assetId ? { ...asset, ...patch } : asset)) } } : node)));
    }, []);

    const updateStoryboardShotPlan = useCallback((nodeId: string, rowIndex: number, patch: Partial<StoryboardShotPlan>) => {
        setNodes((prev) => prev.map((node) => {
            if (node.id !== nodeId) return node;
            const current = node.metadata?.storyboardShotPlans?.[String(rowIndex)];
            if (!current) return node;
            const chapterId = current.chapterId;
            const locked = new Set(node.metadata?.storyboardLockedNarrationChapterIds || []);
            if (chapterId) locked.delete(chapterId);
            const currentWasFailed = Boolean(current.qualityError);
            const qualityChecked = Object.prototype.hasOwnProperty.call(patch, "qualityError");
            const qualityError = qualityChecked ? patch.qualityError : current.qualityError;
            const plans = { ...(node.metadata?.storyboardShotPlans || {}), [String(rowIndex)]: { ...current, ...patch, qualityError, renderMode: qualityError ? "still" as const : patch.renderMode ?? current.renderMode, usePreviousTailFrame: qualityError ? false : patch.usePreviousTailFrame ?? current.usePreviousTailFrame } };
            const validityChanged = currentWasFailed !== Boolean(qualityError) || current.renderMode !== plans[String(rowIndex)].renderMode;
            if (validityChanged) {
                const previous = plans[String(rowIndex - 1)];
                const restored = plans[String(rowIndex)];
                const canUseTail = (plan?: StoryboardShotPlan, prior?: StoryboardShotPlan) => Boolean(plan?.renderMode === "video" && prior?.renderMode === "video" && plan.chapterId && plan.chapterId === prior.chapterId && plan.continuityGroupId && plan.continuityGroupId === prior.continuityGroupId && plan.transition === "continue");
                plans[String(rowIndex)] = { ...restored, usePreviousTailFrame: canUseTail(restored, previous) };
                const next = plans[String(rowIndex + 1)];
                if (next) plans[String(rowIndex + 1)] = { ...next, usePreviousTailFrame: canUseTail(next, plans[String(rowIndex)]) };
            }
            const promptDetails = { ...(node.metadata?.storyboardPromptDetails || {}) };
            const promptErrors = { ...(node.metadata?.storyboardPromptErrors || {}) };
            const promptRawResponses = { ...(node.metadata?.storyboardPromptRawResponses || {}) };
            delete promptDetails[String(rowIndex)];
            delete promptErrors[String(rowIndex)];
            delete promptRawResponses[String(rowIndex)];
            const remainingQualityErrors = Object.values(plans).filter((plan) => Boolean(plan.qualityError)).length;
            return { ...node, metadata: { ...node.metadata, storyboardShotPlans: plans, storyboardPromptDetails: promptDetails, storyboardPromptErrors: promptErrors, storyboardPromptRawResponses: promptRawResponses, storyboardLockedNarrationChapterIds: Array.from(locked), storyboardPlanningErrorStage: remainingQualityErrors ? `部分场景卡待人工修正（${remainingQualityErrors}项）` : undefined, storyboardPlanningRawResponse: remainingQualityErrors ? node.metadata?.storyboardPlanningRawResponse : undefined } };
        }));
    }, []);

    const repairStoryboardShots = useCallback(async (node: CanvasNodeData, requestedIndexes?: number[]) => {
        const scriptNode = nodesRef.current.find((item) => item.id === node.id) || node;
        const rows = parseStoryboardRows(scriptNode.metadata?.storyboardRows);
        const plans = scriptNode.metadata?.storyboardShotPlans || {};
        const rowIndexes = (requestedIndexes?.length ? requestedIndexes : storyboardActiveRowIndexes(scriptNode, rows)).filter((index) => Boolean(rows[index] && plans[String(index)]?.qualityError));
        if (!rowIndexes.length) return;
        const generationConfig = { ...buildGenerationConfig(effectiveConfig, scriptNode, "text"), model: scriptNode.metadata?.model || effectiveConfig.textModel || effectiveConfig.model };
        if (!isAiConfigReady(generationConfig, generationConfig.model)) {
            openConfigDialog(true);
            return;
        }
        const controller = startGenerationRequest(scriptNode.id, scriptNode.id, scriptNode.id);
        let repairedCount = 0;
        const failed: string[] = [];
        try {
            for (let itemIndex = 0; itemIndex < rowIndexes.length; itemIndex += 1) {
                const rowIndex = rowIndexes[itemIndex];
                const row = rows[rowIndex];
                const plan = plans[String(rowIndex)];
                setStoryboardActionKey(rowIndexes.length > 1 ? `shot-fix:all:${itemIndex + 1}:${rowIndexes.length}` : `shot-fix:${rowIndex}`);
                const shotController = createLinkedAbortController(controller);
                let timedOut = false;
                const timeoutId = setTimeout(() => {
                    timedOut = true;
                    shotController.abort();
                }, STORYBOARD_SHOT_REPAIR_TIMEOUT_MS);
                try {
                    const repaired = await requestStoryboardShotQualityRepair(generationConfig, scriptNode, row, plan, shotController.signal);
                    updateStoryboardRows(scriptNode.id, (currentRows) => currentRows.map((item, index) => index === rowIndex ? repaired.row : item));
                    updateStoryboardShotPlan(scriptNode.id, rowIndex, { ...repaired.plan, qualityError: undefined, renderMode: "video" });
                    repairedCount += 1;
                } catch (error) {
                    if (timedOut) {
                        failed.push(`镜${row[0] || rowIndex + 1}：模型请求超过${STORYBOARD_SHOT_REPAIR_TIMEOUT_MS / 1000}秒，已跳过`);
                        continue;
                    }
                    if (isGenerationCanceled(error)) throw error;
                    failed.push(`镜${row[0] || rowIndex + 1}：${error instanceof Error ? error.message : "修正失败"}`);
                } finally {
                    clearTimeout(timeoutId);
                }
            }
            if (failed.length) message.warning(`自动修正完成：成功 ${repairedCount} 项，失败 ${failed.length} 项；失败项已保留`, 6);
            else message.success(`已自动修正 ${repairedCount} 项并恢复为动态视频`);
        } catch (error) {
            if (isGenerationCanceled(error)) message.info(`自动修正已暂停，已保留成功的 ${repairedCount} 项`);
            else message.error(error instanceof Error ? `自动修正失败：${error.message}` : "自动修正失败");
        } finally {
            finishGenerationRequest(scriptNode.id, controller);
            setStoryboardActionKey(null);
        }
    }, [effectiveConfig, finishGenerationRequest, isAiConfigReady, message, openConfigDialog, startGenerationRequest, updateStoryboardRows, updateStoryboardShotPlan]);

    const stopStoryboardShotRepair = useCallback((node: CanvasNodeData) => {
        if (!storyboardActionKey?.startsWith("shot-fix:")) return;
        stopGenerationByRunningId(node.id);
        setStoryboardActionKey(null);
        message.info("已暂停自动修正，已保留成功项");
    }, [message, storyboardActionKey, stopGenerationByRunningId]);

    const deleteStoryboardAsset = useCallback((nodeId: string, assetId: string) => {
        setNodes((prev) => prev.map((node) => {
            if (node.id !== nodeId) return node;
            const assetNodeIds = Object.fromEntries(Object.entries(node.metadata?.storyboardAssetNodeIds || {}).filter(([id]) => id !== assetId));
            return { ...node, metadata: { ...node.metadata, storyboardAssets: (node.metadata?.storyboardAssets || []).filter((asset) => asset.id !== assetId), storyboardAssetNodeIds: assetNodeIds } };
        }));
    }, []);

    const updateStoryboardPromptDetail = useCallback((nodeId: string, rowIndex: number, detail: StoryboardPromptDetail, prepared = false) => {
        setNodes((prev) => {
            const scriptNode = prev.find((node) => node.id === nodeId);
            if (!scriptNode) return prev;
            const rows = parseStoryboardRows(scriptNode.metadata?.storyboardRows).map((row) => [...row]);
            const linkedDetail = prepared ? detail : linkStoryboardPromptAssets(scriptNode, completeStoryboardPromptDetailAssets(scriptNode, rows, rowIndex, detail), prev);
            try {
                const duration = storyboardVideoPromptDurationSeconds(scriptNode, rows[rowIndex]);
                assertStoryboardVideoPromptFormat(linkedDetail.videoMotionPrompt, duration, linkedDetail, scriptNode.metadata?.storyboardAssets || [], storyboardExpectedSpeechForRow(scriptNode, rows, rowIndex), storyboardAllowsMultipleCharacterStagesForRow(scriptNode, rows, rowIndex), scriptNode.metadata?.storyboardShotPlans?.[String(rowIndex)]);
                assertStoryboardPromptActionCoverage(linkedDetail.videoMotionPrompt, scriptNode.metadata?.storyboardShotPlans?.[String(rowIndex)], rows[rowIndex]?.[2]);
                assertStoryboardProductionContractReady(scriptNode, rows, rowIndex, linkedDetail, storyboardContractReferencesForDetail(linkedDetail, scriptNode.metadata?.storyboardAssets || []), "prompt");
            } catch (error) {
                const reason = error instanceof Error ? error.message : "分镜生产契约校验失败";
                return prev.map((node) => node.id === nodeId ? { ...node, metadata: { ...node.metadata, storyboardPromptErrors: { ...(node.metadata?.storyboardPromptErrors || {}), [String(rowIndex)]: reason } } } : node);
            }
            if (rows[rowIndex]) rows[rowIndex][8] = linkedDetail.storyboardPrompt || linkedDetail.videoMotionPrompt;
            const normalized = renumberStoryboardRowsForCanvas(rows);
            const nextScriptNode = {
                ...scriptNode,
                metadata: {
                    ...scriptNode.metadata,
                    content: storyboardRowsToMarkdownForCanvas(normalized),
                    storyboardRows: [STORYBOARD_COLUMNS, ...normalized],
                    storyboardStep: "prompts" as const,
                    storyboardPromptDetails: {
                        ...(scriptNode.metadata?.storyboardPromptDetails || {}),
                        [String(rowIndex)]: linkedDetail,
                    },
                    storyboardPromptErrors: Object.fromEntries(Object.entries(scriptNode.metadata?.storyboardPromptErrors || {}).filter(([key]) => key !== String(rowIndex))),
                },
            };
            const syncedAssetPatch = {
                storyboardAssetMentions: linkedDetail.assetMentions || [],
                storyboardAssetMentionLinks: linkedDetail.assetMentionLinks || [],
                storyboardPromptSource: linkedDetail.promptSource,
                storyboardPromptSkillRoot: linkedDetail.promptSkillRoot,
            };
            return prev.map((node) => {
                if (node.id === nodeId) return nextScriptNode;
                if (node.type !== CanvasNodeType.Video || node.metadata?.storyboardSourceNodeId !== nodeId || node.metadata.storyboardRowIndex !== rowIndex || node.metadata.content || node.metadata.storyboardVideoDraftNodeId) return node;
                const basePrompt = (linkedDetail.videoMotionPrompt || linkedDetail.storyboardPrompt || "").trim();
                if (node.metadata.storyboardVideoFinalPromptCustomized) return { ...node, metadata: { ...node.metadata, ...syncedAssetPatch, prompt: basePrompt } };
                const references = node.metadata.storyboardVideoReferences || [];
                const audioReferences = node.metadata.storyboardVideoAudioReferences || [];
                const finalPrompt = storyboardVideoFinalPromptWithAudio(storyboardVideoFinalPrompt(basePrompt, references), audioReferences);
                return { ...node, metadata: { ...node.metadata, ...syncedAssetPatch, prompt: basePrompt, storyboardVideoFinalPrompt: finalPrompt } };
            });
        });
    }, []);

    const updateStoryboardPromptError = useCallback((nodeId: string, rowIndex: number, error: string) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, storyboardPromptErrors: { ...(node.metadata?.storyboardPromptErrors || {}), [String(rowIndex)]: error } } } : node)));
    }, []);

    const updateStoryboardPromptRawResponse = useCallback((nodeId: string, rowIndex: number, draft: { response: string; contextKey: string }) => {
        setNodes((prev) => prev.map((node) => node.id === nodeId ? { ...node, metadata: { ...node.metadata, storyboardPromptRawResponses: { ...(node.metadata?.storyboardPromptRawResponses || {}), [String(rowIndex)]: draft } } } : node));
    }, []);

    const updateStoryboardModel = useCallback((nodeId: string, model: string) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, model } } : node)));
    }, []);

    const generateStoryboardShotsFromInputs = useCallback(
        async (node: CanvasNodeData) => {
            const storedScriptNode = nodesRef.current.find((item) => item.id === node.id) || node;
            const scriptNode = withCurrentStoryboardDirectorPreset(storedScriptNode);
            if (scriptNode !== storedScriptNode) setNodes((prev) => prev.map((item) => (item.id === scriptNode.id ? scriptNode : item)));
            const textInputs = buildNodeGenerationInputs(scriptNode.id, nodesRef.current, connectionsRef.current).filter((input) => input.type === "text" && input.text?.trim());
            const directorInstruction = storyboardDirectorInstructionForNode(scriptNode);
            const connectedSourceText = textInputs.map((input) => `【${input.title || "剧本文本"}】\n${input.text?.trim() || ""}`).join("\n\n").trim();
            const sourceText =
                [
                    directorInstruction ? `【整体要求/导演提示词】\n${directorInstruction}` : "",
                    connectedSourceText,
                ]
                    .filter(Boolean)
                    .join("\n\n")
                    .trim() || storyboardSourceTextForNode(scriptNode);
            const storyText = connectedSourceText || sourceText;
            const videoSettingsPatch = storyboardVideoSettingsFallbackPatch(scriptNode, sourceText);
            const productionScope = scriptNode.metadata?.storyboardProductionScope || "series";
            const planningConfigKey = storyboardPlanningConfigKey(productionScope);
            const planningCheckpointKey = `${storyText}\n\n【生产配置】${planningConfigKey}`;
            if (!sourceText) {
                message.warning("请先把剧本文本节点连接到脚本节点");
                return;
            }
            const generationConfig = { ...buildGenerationConfig(effectiveConfig, scriptNode, "text"), model: scriptNode.metadata?.model || effectiveConfig.textModel || effectiveConfig.model };
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                return;
            }
            setRunningNodeId(scriptNode.id);
            const controller = startGenerationRequest(scriptNode.id, scriptNode.id, scriptNode.id);
            setStoryboardActionKey("shots:generate");
            const updatePlanningProgress = (percent: number, text: string) => {
                setNodes((prev) => prev.map((item) => (item.id === scriptNode.id ? { ...item, metadata: { ...item.metadata, ...videoSettingsPatch, status: NODE_STATUS_LOADING, errorDetails: undefined, storyboardStep: "shots", storyboardSourceText: sourceText, storyboardPlanningProgress: { percent, text } } } : item)));
            };
            updatePlanningProgress(5, "逐句提取故事事实");
            const storedCheckpoint = scriptNode.metadata?.storyboardPlanningCheckpoint;
            const checkpoint = storedCheckpoint?.sourceText === planningCheckpointKey ? storedCheckpoint : undefined;
            const checkpointHasDramaturgy = Boolean(checkpoint?.dramaturgyPlan);
            let dramaturgyPlan = checkpoint?.dramaturgyPlan;
            let dramaturgySource = checkpoint?.dramaturgySource;
            let dramaturgySkillRoot = checkpoint?.dramaturgySkillRoot;
            const saveCheckpoint = (completedSourceChunks: number, completedShotBatches: number, beats: StoryboardSourceBeat[], shots: PlannedStoryboardShot[], condensed: boolean, originalBeatCount: number) => {
                setNodes((prev) => prev.map((item) => (item.id === scriptNode.id ? { ...item, metadata: { ...item.metadata, storyboardPlanningCheckpoint: { sourceText: planningCheckpointKey, completedSourceChunks, completedShotBatches, beats: beats.map((beat) => ({ ...beat, characters: [...beat.characters] })), shots: shots.map((shot) => ({ row: [...shot.row], plan: { ...shot.plan, sourceBeatIds: [...shot.plan.sourceBeatIds], visualBeatIds: shot.plan.visualBeatIds ? [...shot.plan.visualBeatIds] : undefined, voiceoverBeatIds: shot.plan.voiceoverBeatIds ? [...shot.plan.voiceoverBeatIds] : undefined, actionBeats: shot.plan.actionBeats ? [...shot.plan.actionBeats] : undefined, participants: shot.plan.participants?.map((participant) => ({ ...participant, sourceBeatIds: [...participant.sourceBeatIds] })), typedActionBeats: shot.plan.typedActionBeats?.map((beat) => ({ ...beat })) } })), condensed, originalBeatCount, dramaturgyPlan, dramaturgySource, dramaturgySkillRoot } } } : item)));
            };
            let failedStage = "";
            let failedRawResponse = "";
            type ShotQualityError = { stage: string; item: number; error: string; rawResponse: string };
            const storedShotQualityErrors: ShotQualityError[] = (() => {
                if (!checkpoint) return [];
                try {
                    const stored = JSON.parse(scriptNode.metadata?.storyboardPlanningRawResponse || "[]");
                    return Array.isArray(stored) ? stored.filter((item): item is ShotQualityError => typeof item?.stage === "string" && typeof item?.item === "number" && typeof item?.error === "string" && typeof item?.rawResponse === "string") : [];
                } catch {
                    return [];
                }
            })();
            const restoredShotQualityErrors: ShotQualityError[] = checkpoint?.shots.flatMap((shot, index) => {
                if (shot.plan.renderMode !== "still") return [];
                const error = shot.plan.qualityError || "该场景卡仍标记为静态待修正";
                return [storedShotQualityErrors.find((item) => item.error === error) || { stage: "断点恢复", item: index + 1, error, rawResponse: "" }];
            }) || [];
            const restoredBatchQualityErrors = checkpoint ? storedShotQualityErrors.filter((item) => item.item === 0 && Number(item.stage.match(/镜头批次 (\d+)\//)?.[1] || 0) <= (checkpoint.completedShotBatches || 0)) : [];
            const shotQualityErrors: ShotQualityError[] = [...restoredShotQualityErrors, ...restoredBatchQualityErrors];
            const syncShotQualityErrors = () => {
                setNodes((prev) => prev.map((item) => item.id === scriptNode.id ? { ...item, metadata: { ...item.metadata, storyboardPlanningErrorStage: shotQualityErrors.length ? `部分场景卡待人工修正（${shotQualityErrors.length}项）` : undefined, storyboardPlanningRawResponse: shotQualityErrors.length ? JSON.stringify(shotQualityErrors) : undefined } } : item));
            };
            const saveShotQualityError = (error: ShotQualityError) => {
                shotQualityErrors.push(error);
                syncShotQualityErrors();
            };
            const parsePlanningAnswer = async <T,>(answer: string, stage: string, parser: (content: string) => T) => {
                try {
                    return parser(answer);
                } catch {
                    updatePlanningProgress(5, `${stage}返回格式异常，正在自动修复 JSON`);
                    let repaired = "";
                    try {
                        repaired = await requestImageQuestion(generationConfig, [{ role: "user", content: storyboardJsonRepairPrompt(answer) }], () => {}, { signal: controller.signal });
                        return parser(repaired);
                    } catch (error) {
                        if (isGenerationCanceled(error)) throw error;
                        failedStage = stage;
                        failedRawResponse = repaired || answer;
                        const reason = error instanceof Error ? error.message : "未知 JSON 错误";
                        throw new Error(`${stage}解析失败，已自动修复一次但仍不是合法 JSON：${reason}`);
                    }
                }
            };
            const parseShotsWithQualityRetry = async (answer: string, source: string, stage: string, progress: number) => {
                const parsed = await parsePlanningAnswer(answer, stage, parsePlannedStoryboardShots);
                const invalidIndexes = parsed.map((shot, index) => storyboardShotQualityIssuesForShot(shot).length ? index : -1).filter((index) => index >= 0);
                if (!invalidIndexes.length) return parsed;
                updatePlanningProgress(progress, `${stage}有 ${invalidIndexes.length} 个场景卡待逐项修正`);
                for (const index of invalidIndexes) {
                    const original = parsed[index];
                    const issues = storyboardShotQualityIssuesForShot(original);
                    const qualitySource = [
                        source,
                        `【首次模型返回JSON】\n${answer}`,
                        `【解析后的当前shots】\n${JSON.stringify({ shots: parsed })}`,
                        `【只修正第${index + 1}项】\n当前问题：${issues.join("、")}\n只就地修正这一项，其他项、事实ID、顺序、主要可见事实、人物时期、连续性组和转场不得改变。participants 必须明确当前事实支持的 actor/patient；画外成年人双手也要作为 actor，婴儿/幼儿只能作为 patient。actionBeats 是唯一可执行动作链，只写2-3拍；typedActionBeats 与其逐项对应并明确 actor、action、patient、可选 prop 和必填 result，action 写清身体部位或物体、运动方式、作用对象，result 写清物理状态变化。visual 必须逐行重写为0-3、3-9、9-12、12-15秒四段，每段1-2句；0-3秒建场同时执行第一拍，3-9秒承接推进，9-12秒表现反作用/转折和可见结果，12-15秒只保持结果与稳定落点，禁止短动作标签；逐段复用对应 typedActionBeats 的参与者名、道具名、核心物理动词和结果关键词，不做失去追踪关系的同义改写。第一步只使用语义人物/场景/道具名，不生成 @资产名。obstacleReaction 与 turningAction 只是功能说明，不得扩成额外动作。只输出 {"shots":[修正后的这一项]}。`,
                    ].join("\n\n");
                    let qualityAnswer = "";
                    try {
                        qualityAnswer = await requestImageQuestion(generationConfig, [{ role: "user", content: qualitySource }], () => {}, { signal: controller.signal });
                        let repaired: PlannedStoryboardShot[];
                        try {
                            repaired = parsePlannedStoryboardShots(qualityAnswer);
                        } catch {
                            const repairedJson = await requestImageQuestion(generationConfig, [{ role: "user", content: storyboardJsonRepairPrompt(qualityAnswer) }], () => {}, { signal: controller.signal });
                            qualityAnswer = repairedJson;
                            repaired = parsePlannedStoryboardShots(repairedJson);
                        }
                        const candidate = repaired[0];
                        if (!candidate) throw new Error("模型没有返回修正后的单条场景卡");
                        candidate.plan = {
                            ...candidate.plan,
                            sourceBeatIds: [...original.plan.sourceBeatIds],
                            visualBeatIds: original.plan.visualBeatIds ? [...original.plan.visualBeatIds] : undefined,
                            voiceoverBeatIds: original.plan.voiceoverBeatIds ? [...original.plan.voiceoverBeatIds] : undefined,
                            continuityGroupId: original.plan.continuityGroupId,
                            timeStage: original.plan.timeStage,
                            transition: original.plan.transition,
                            usePreviousTailFrame: original.plan.usePreviousTailFrame,
                        };
                        const repairedIssues = storyboardShotQualityIssuesForShot(candidate);
                        if (repairedIssues.length) throw new Error(repairedIssues.join("、"));
                        parsed[index] = candidate;
                    } catch (error) {
                        if (isGenerationCanceled(error)) throw error;
                        const errorText = error instanceof Error ? error.message : issues.join("、");
                        original.plan.renderMode = "still";
                        original.plan.usePreviousTailFrame = false;
                        original.plan.qualityError = errorText;
                        saveShotQualityError({ stage, item: index + 1, error: errorText, rawResponse: qualityAnswer || answer });
                    }
                }
                return parsed;
            };
            try {
                const sourceChunks = storyboardSourceChunks(storyText);
                const beats: StoryboardSourceBeat[] = checkpoint?.beats.map((beat) => ({ ...beat, characters: [...beat.characters] })) || [];
                let originalBeatCount = checkpoint?.originalBeatCount || beats.length;
                let beatsCondensed = productionScope === "series" || Boolean(checkpoint?.condensed);
                const completedSourceChunks = Math.min(checkpoint?.completedSourceChunks || 0, sourceChunks.length);
                if (completedSourceChunks) updatePlanningProgress(5 + Math.round((completedSourceChunks / sourceChunks.length) * 15), `从断点继续：已完成 ${completedSourceChunks}/${sourceChunks.length} 段原文`);
                for (let chunkIndex = completedSourceChunks; chunkIndex < sourceChunks.length; chunkIndex += 1) {
                    const beatAnswer = await requestImageQuestion(generationConfig, [{ role: "user", content: `${STORYBOARD_FACT_EXTRACTION_PROMPT}\n\n这是原文第 ${chunkIndex + 1}/${sourceChunks.length} 段，只提取本段事实。\n\n【原始故事片段】\n${sourceChunks[chunkIndex]}` }], () => {}, { signal: controller.signal });
                    const parsedBeats = await parsePlanningAnswer(beatAnswer, `事实提取 ${chunkIndex + 1}/${sourceChunks.length}`, parseStoryboardSourceBeats);
                    const chunkBeats = parsedBeats.map((beat, index) => ({ ...beat, id: `B${String(beats.length + index + 1).padStart(3, "0")}` }));
                    beats.push(...chunkBeats);
                    originalBeatCount = beats.length;
                    saveCheckpoint(chunkIndex + 1, 0, beats, [], beatsCondensed, originalBeatCount);
                    updatePlanningProgress(5 + Math.round(((chunkIndex + 1) / sourceChunks.length) * 15), `已分析 ${chunkIndex + 1}/${sourceChunks.length} 段原文，提取 ${beats.length} 个事实`);
                }
                if (!beats.length) throw new Error("没有从原文提取到故事事实");
                if (productionScope === "single" && !beatsCondensed) {
                    originalBeatCount = beats.length;
                    const coreBeatTarget = storyboardSingleEpisodeBeatTarget();
                    updatePlanningProgress(22, `正在把 ${originalBeatCount} 个事实浓缩为 ${coreBeatTarget} 个单集核心事实`);
                    const condensedAnswer = await requestImageQuestion(generationConfig, [{ role: "user", content: `${STORYBOARD_SINGLE_EPISODE_CONDENSE_PROMPT}\n\n每个动态片段固定15秒。\n核心事实目标：严格输出 ${coreBeatTarget} 个\n\n【完整故事事实】\n${JSON.stringify(beats)}` }], () => {}, { signal: controller.signal });
                    const condensedBeats = await parsePlanningAnswer(condensedAnswer, "单集核心事实浓缩", parseStoryboardSourceBeats);
                    if (condensedBeats.length < 6) throw new Error("单集浓缩返回的核心事实不足 6 个");
                    beats.splice(0, beats.length, ...condensedBeats.slice(0, coreBeatTarget).map((beat, index) => ({ ...beat, id: `C${String(index + 1).padStart(3, "0")}` })));
                    beatsCondensed = true;
                    saveCheckpoint(sourceChunks.length, 0, beats, [], true, originalBeatCount);
                } else if (productionScope === "series") {
                    originalBeatCount = beats.length;
                }
                const totalClipTarget = storyboardTotalClipTarget(beats.length);
                const clipPlanInstruction = storyboardClipPlanInstruction(productionScope, totalClipTarget);
                if (!dramaturgyPlan) {
                    updatePlanningProgress(26, `正在用 ${beats.length} 个${productionScope === "single" ? "核心" : "完整"}事实建立剧作总纲`);
                    const dramaturgyInstruction = await buildStoryboardDramaturgyInstruction();
                    const dramaturgyRequestSource = `${dramaturgyInstruction.content}\n\n制作范围：${productionScope === "single" ? "单集浓缩" : "完整故事自然拆章"}，动态视频总预算严格为${totalClipTarget}个，每个片段固定15秒。\n\n【完整事实列表】\n${JSON.stringify(beats)}`;
                    const dramaturgyAnswer = await requestImageQuestion(generationConfig, [{ role: "user", content: dramaturgyRequestSource }], () => {}, { signal: controller.signal });
                    dramaturgyPlan = await parsePlanningAnswer(dramaturgyAnswer, "剧作总纲", (content) => parseStoryboardDramaturgyPlan(content, beats));
                    let dramaturgyIssues = storyboardDramaturgyQualityIssues(dramaturgyPlan, beats);
                    if (dramaturgyIssues.length) {
                        updatePlanningProgress(28, "剧作总纲缺少完整人物变化或因果节奏，正在有限重写");
                        const dramaturgyQualitySource = `${dramaturgyRequestSource}\n\n【剧作总纲质量修正】\n上次输出存在以下问题：\n${dramaturgyIssues.join("\n")}\n保持事实 ID、人物关系、时间顺序和结局不变，只补齐有事实支持的外在目标、内在变化、关键转折、高潮、结局、人物弧线、双轨节奏和对白旁白原则；不得新增冲突、台词、道具、地点或事件。`;
                        const qualityAnswer = await requestImageQuestion(generationConfig, [{ role: "user", content: dramaturgyQualitySource }], () => {}, { signal: controller.signal });
                        dramaturgyPlan = await parsePlanningAnswer(qualityAnswer, "剧作总纲质量修正", (content) => parseStoryboardDramaturgyPlan(content, beats));
                        dramaturgyIssues = storyboardDramaturgyQualityIssues(dramaturgyPlan, beats);
                        if (dramaturgyIssues.length) {
                            failedStage = "剧作总纲质量";
                            failedRawResponse = qualityAnswer;
                            throw new Error(`剧作总纲仍未通过编剧质量门槛：${dramaturgyIssues.join("、")}`);
                        }
                    }
                    dramaturgySource = dramaturgyInstruction.source;
                    dramaturgySkillRoot = dramaturgyInstruction.skillRoot;
                    saveCheckpoint(sourceChunks.length, 0, beats, [], beatsCondensed, originalBeatCount);
                }
                updatePlanningProgress(30, `剧作总纲已锁定，${beats.length} 个事实将规划为 ${totalClipTarget} 个动态片段`);
                let plannedShots: PlannedStoryboardShot[] = checkpointHasDramaturgy ? checkpoint?.shots.map((shot) => ({ row: [...shot.row], plan: { ...shot.plan, sourceBeatIds: [...shot.plan.sourceBeatIds], visualBeatIds: shot.plan.visualBeatIds ? [...shot.plan.visualBeatIds] : undefined, voiceoverBeatIds: shot.plan.voiceoverBeatIds ? [...shot.plan.voiceoverBeatIds] : undefined, actionBeats: shot.plan.actionBeats ? [...shot.plan.actionBeats] : undefined, participants: shot.plan.participants?.map((participant) => ({ ...participant, sourceBeatIds: [...participant.sourceBeatIds] })), typedActionBeats: shot.plan.typedActionBeats?.map((beat) => ({ ...beat })) } })) || [] : [];
                const batches = productionScope === "single" ? [beats] : storyboardBeatBatches(beats);
                const batchClipTargets = storyboardBatchClipTargets(batches, totalClipTarget);
                let completedShotBatches = checkpointHasDramaturgy ? Math.min(checkpoint?.completedShotBatches || 0, batches.length) : 0;
                const retryBatchIndex = restoredBatchQualityErrors.reduce<number | undefined>((earliest, error) => {
                    const batchIndex = Number(error.stage.match(/镜头批次 (\d+)\//)?.[1] || 0) - 1;
                    return batchIndex >= 0 && (earliest === undefined || batchIndex < earliest) ? batchIndex : earliest;
                }, undefined);
                if (retryBatchIndex !== undefined && retryBatchIndex < completedShotBatches) {
                    const retryBeatIds = new Set(batches.slice(retryBatchIndex).flatMap((batch) => batch.map((beat) => beat.id)));
                    const discardedShots = plannedShots.filter((shot) => shot.plan.sourceBeatIds.some((id) => retryBeatIds.has(id)));
                    const discardedQualityErrorCounts = discardedShots.reduce((counts, shot) => {
                        if (shot.plan.qualityError) counts.set(shot.plan.qualityError, (counts.get(shot.plan.qualityError) || 0) + 1);
                        return counts;
                    }, new Map<string, number>());
                    plannedShots = plannedShots.filter((shot) => !shot.plan.sourceBeatIds.some((id) => retryBeatIds.has(id)));
                    completedShotBatches = retryBatchIndex;
                    for (let index = shotQualityErrors.length - 1; index >= 0; index -= 1) {
                        const errorText = shotQualityErrors[index].error;
                        const errorBatchIndex = Number(shotQualityErrors[index].stage.match(/镜头批次 (\d+)\//)?.[1] || 0) - 1;
                        const discardedErrorCount = discardedQualityErrorCounts.get(errorText) || 0;
                        if (shotQualityErrors[index].item === 0 && errorBatchIndex >= retryBatchIndex) shotQualityErrors.splice(index, 1);
                        else if (discardedErrorCount) {
                            shotQualityErrors.splice(index, 1);
                            discardedQualityErrorCounts.set(errorText, discardedErrorCount - 1);
                        }
                    }
                    syncShotQualityErrors();
                    saveCheckpoint(sourceChunks.length, completedShotBatches, beats, plannedShots, beatsCondensed, originalBeatCount);
                }
                if (completedShotBatches) updatePlanningProgress(20 + Math.round((completedShotBatches / batches.length) * 60), `从断点继续：已完成 ${completedShotBatches}/${batches.length} 批镜头`);
                for (let batchIndex = completedShotBatches; batchIndex < batches.length; batchIndex += 1) {
                    const previous = [...plannedShots].reverse().find((shot) => shot.plan.renderMode !== "still")?.plan;
                    const batchTarget = batchClipTargets[batchIndex];
                    const shotSource = buildStoryboardShotBatchSource(storyText, batches[batchIndex], batchIndex, previous, false, directorInstruction, clipPlanInstruction, dramaturgyPlan, batchTarget);
                    const answer = await requestImageQuestion(
                        generationConfig,
                        [{ role: "user", content: shotSource }],
                        () => {},
                        { signal: controller.signal },
                    );
                    const batchErrorStart = shotQualityErrors.length;
                    const parsedShots = await parseShotsWithQualityRetry(answer, shotSource, `镜头批次 ${batchIndex + 1}/${batches.length}`, 68);
                    const initialErrorEnd = shotQualityErrors.length;
                    const initialDynamicShots = plannedShotsForBeats(parsedShots.filter((shot) => shot.plan.renderMode !== "still"), batches[batchIndex]);
                    const initialStillShots = plannedShotsForBeats(parsedShots.filter((shot) => shot.plan.renderMode === "still"), batches[batchIndex]);
                    const initialDynamicCoverage = storyboardCoverage(batches[batchIndex], initialDynamicShots);
                    let batchShots = [...initialDynamicShots, ...initialStillShots];
                    if (initialDynamicShots.length === batchTarget && !initialDynamicCoverage.missingBeatIds.length && initialStillShots.length) {
                        batchShots = initialDynamicShots;
                        shotQualityErrors.splice(batchErrorStart);
                        syncShotQualityErrors();
                    } else if (initialDynamicShots.length !== batchTarget || initialDynamicCoverage.missingBeatIds.length) {
                        updatePlanningProgress(72, `第 ${batchIndex + 1} 批正在定点修正为 ${batchTarget} 个片段并补齐事实引用`);
                        const countRepairSource = `${shotSource}\n\n【首次模型返回JSON】\n${answer}\n\n【逐项质量修正后的当前shots】\n${JSON.stringify({ shots: parsedShots })}\n\n【定点数量与覆盖修正】\n当前有 ${initialStillShots.length} 个质量失败的still行会由系统另行保留，它们不计动态配额，也不能承担事实覆盖。当前有效动态shots为 ${initialDynamicShots.length} 个，遗漏动态事实ID：${initialDynamicCoverage.missingBeatIds.join("、") || "无"}。保持本批事实、顺序、人物时期和连续性不变，重新输出严格 ${batchTarget} 个全部可作为动态视频的shots；必须由这些动态shots覆盖所有本批事实ID，每个shot只有1个visualBeatId，其余同场背景事实放voiceoverBeatIds。不要返回上述still错误行，只输出完整动态replacement JSON。`;
                        try {
                            const countRepairAnswer = await requestImageQuestion(generationConfig, [{ role: "user", content: countRepairSource }], () => {}, { signal: controller.signal });
                            const replacementShots = await parseShotsWithQualityRetry(countRepairAnswer, countRepairSource, `镜头批次 ${batchIndex + 1}/${batches.length} 数量修正`, 74);
                            const replacementDynamicShots = plannedShotsForBeats(replacementShots.filter((shot) => shot.plan.renderMode !== "still"), batches[batchIndex]);
                            const replacementStillShots = plannedShotsForBeats(replacementShots.filter((shot) => shot.plan.renderMode === "still"), batches[batchIndex]);
                            const replacementDynamicCoverage = storyboardCoverage(batches[batchIndex], replacementDynamicShots);
                            if (!replacementStillShots.length && replacementDynamicShots.length === batchTarget && !replacementDynamicCoverage.missingBeatIds.length) {
                                batchShots = replacementDynamicShots;
                                shotQualityErrors.splice(batchErrorStart);
                            } else {
                                shotQualityErrors.splice(initialErrorEnd);
                                if (!initialStillShots.length && initialErrorEnd === batchErrorStart) shotQualityErrors.push({ stage: `镜头批次 ${batchIndex + 1}/${batches.length} 数量修正`, item: 0, error: `replacement 未完整通过：动态 ${replacementDynamicShots.length}/${batchTarget}，still ${replacementStillShots.length}，遗漏事实 ${replacementDynamicCoverage.missingBeatIds.join("、") || "无"}`, rawResponse: answer });
                            }
                        } catch (error) {
                            if (isGenerationCanceled(error)) throw error;
                            shotQualityErrors.splice(initialErrorEnd);
                            if (!initialStillShots.length && initialErrorEnd === batchErrorStart) shotQualityErrors.push({ stage: `镜头批次 ${batchIndex + 1}/${batches.length} 数量修正`, item: 0, error: `replacement 请求或解析失败：${error instanceof Error ? error.message : "未知错误"}；首次动态 ${initialDynamicShots.length}/${batchTarget}，遗漏事实 ${initialDynamicCoverage.missingBeatIds.join("、") || "无"}`, rawResponse: answer });
                        }
                        syncShotQualityErrors();
                    }
                    if (batchShots.filter((shot) => shot.plan.renderMode !== "still").length > batchTarget) {
                        shotQualityErrors.splice(batchErrorStart);
                        syncShotQualityErrors();
                        saveCheckpoint(sourceChunks.length, batchIndex, beats, plannedShots, beatsCondensed, originalBeatCount);
                        throw new Error(`第 ${batchIndex + 1} 批动态片段超过 ${batchTarget} 个预算，本批未写入断点，请重新执行`);
                    }
                    plannedShots.push(...batchShots);
                    saveCheckpoint(sourceChunks.length, batchIndex + 1, beats, plannedShots, beatsCondensed, originalBeatCount);
                    updatePlanningProgress(20 + Math.round(((batchIndex + 1) / batches.length) * 60), `已完成 ${batchIndex + 1}/${batches.length} 批，共 ${plannedShots.length} 个生产片段`);
                }
                const dynamicPlannedShots = plannedShots.filter((shot) => shot.plan.renderMode !== "still");
                const coverage = storyboardCoverage(beats, plannedShots);
                if (coverage.missingBeatIds.length) throw new Error(`仍有 ${coverage.missingBeatIds.length} 个原文事实未生成镜头：${coverage.missingBeatIds.join("、")}`);
                const dynamicCoverage = storyboardCoverage(beats, dynamicPlannedShots);
                if (dynamicPlannedShots.length > totalClipTarget) throw new Error(`动态片段不得超过 ${totalClipTarget} 个全局预算，实际得到 ${dynamicPlannedShots.length} 个`);
                if (!shotQualityErrors.length && dynamicCoverage.missingBeatIds.length) throw new Error(`仍有 ${dynamicCoverage.missingBeatIds.length} 个原文事实未进入动态镜头：${dynamicCoverage.missingBeatIds.join("、")}`);
                if (!shotQualityErrors.length && dynamicPlannedShots.length !== totalClipTarget) throw new Error(`完整规划必须得到 ${totalClipTarget} 个动态片段，实际得到 ${dynamicPlannedShots.length} 个`);
                if (plannedShots.length > STORYBOARD_ROW_LIMIT) throw new Error(`完整故事需要 ${plannedShots.length} 个片段，超过当前 ${STORYBOARD_ROW_LIMIT} 镜安全上限，请拆成上下集`);
                const beatOrder = new Map(beats.map((beat, index) => [beat.id, index]));
                plannedShots.sort((first, second) => Math.min(...first.plan.sourceBeatIds.map((id) => beatOrder.get(id) ?? Number.MAX_SAFE_INTEGER)) - Math.min(...second.plan.sourceBeatIds.map((id) => beatOrder.get(id) ?? Number.MAX_SAFE_INTEGER)));
                const production = planStoryboardProduction(plannedShots, beats, productionScope);
                const normalized = renumberStoryboardRowsForCanvas(production.shots.map((item) => item.row));
                const shotPlans = Object.fromEntries(production.shots.map((item, index) => [String(index), item.plan]));
                updatePlanningProgress(96, productionScope === "single" ? "单集核心事实覆盖通过，写入生产片段" : "完整事实覆盖通过，写入分集片段");
                setNodes((prev) =>
                    prev.map((item) =>
                        item.id === scriptNode.id
                            ? {
                                  ...item,
                                  metadata: {
                                      ...item.metadata,
                                      content: storyboardRowsToMarkdownForCanvas(normalized),
                                      storyboardRows: [STORYBOARD_COLUMNS, ...normalized],
                                      storyboardStep: "shots",
                                      storyboardSourceText: sourceText,
                                      storyboardSourceBeats: beats,
                                      storyboardDramaturgyPlan: dramaturgyPlan,
                                      storyboardDramaturgySource: dramaturgySource,
                                      storyboardDramaturgySkillRoot: dramaturgySkillRoot,
                    storyboardShotPlans: Object.fromEntries(production.shots.map((item, index) => [String(index), { ...item.plan, shotId: item.plan.shotId || `S${String(index + 1).padStart(3, "0")}` }])),
                                      storyboardCoverage: coverage,
                                      storyboardProductionScope: productionScope,
                                      seconds: "15",
                                       storyboardPlanningConfigKey: planningConfigKey,
                                      storyboardOriginalBeatCount: originalBeatCount,
                                      storyboardActiveChapterId: production.chapters[0]?.id,
                                       storyboardChapters: production.chapters,
                                       storyboardLockedNarrationChapterIds: [],
                                      storyboardPlanningProgress: undefined,
                                      storyboardPlanningCheckpoint: undefined,
                                      storyboardPlanningErrorStage: shotQualityErrors.length ? `部分场景卡待人工修正（${shotQualityErrors.length}项）` : undefined,
                                      storyboardPlanningRawResponse: shotQualityErrors.length ? JSON.stringify(shotQualityErrors) : undefined,
                                      storyboardAssets: (item.metadata?.storyboardAssets || []).map((asset) => ({ ...asset, chapterIds: [] })),
                                      storyboardPreparedChapterIds: [],
                                      storyboardAssetProgress: undefined,
                                      storyboardAssetBatchProgress: undefined,
                                      storyboardAssetError: undefined,
                                      storyboardPromptDetails: {},
                                      storyboardPromptErrors: {},
                                      storyboardPromptRawResponses: {},
                                      ...videoSettingsPatch,
                                      status: NODE_STATUS_SUCCESS,
                                      errorDetails: undefined,
                                  },
                              }
                            : item,
                    ),
                );
                const planningSummary = productionScope === "single" ? `已将 ${originalBeatCount} 个事实浓缩为 ${coverage.total} 个核心事实，规划 1 集、${production.videoCount} 个动态视频` : `已覆盖 ${coverage.total} 个故事事实，规划 ${production.chapters.length} 集、${production.videoCount} 个动态视频`;
                if (shotQualityErrors.length) message.warning(`${planningSummary}；${shotQualityErrors.length} 个场景卡待修正，已标记为静态且不计入视频费用`);
                else message.success(planningSummary);
            } catch (error) {
                if (isGenerationCanceled(error)) {
                    message.info("已停止完整分镜生成，当前断点已保留");
                    setNodes((prev) => prev.map((item) => (item.id === scriptNode.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_IDLE, errorDetails: undefined, storyboardPlanningProgress: undefined } } : item)));
                    return;
                }
                const errorDetails = error instanceof Error ? error.message : "生成镜头失败";
                message.error(errorDetails);
                setNodes((prev) => prev.map((item) => (item.id === scriptNode.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails, storyboardPlanningProgress: undefined, storyboardPlanningErrorStage: failedStage || (shotQualityErrors.length ? `部分场景卡待人工修正（${shotQualityErrors.length}项）` : undefined), storyboardPlanningRawResponse: failedRawResponse || (shotQualityErrors.length ? JSON.stringify(shotQualityErrors) : undefined) } } : item)));
            } finally {
                finishGenerationRequest(scriptNode.id, controller);
                setStoryboardActionKey(null);
                setRunningNodeId((current) => (current === scriptNode.id ? null : current));
            }
        },
        [effectiveConfig, finishGenerationRequest, isAiConfigReady, message, openConfigDialog, startGenerationRequest],
    );

    const prepareStoryboardAssets = useCallback(
        async (node: CanvasNodeData) => {
            const scriptNode = withStoryboardVideoSettings(node);
            if (scriptNode !== node) setNodes((prev) => prev.map((item) => (item.id === scriptNode.id ? scriptNode : item)));
            const rows = parseStoryboardRows(scriptNode.metadata?.storyboardRows);
            const activeIndexes = storyboardActiveRowIndexes(scriptNode, rows);
            const episodeRows = activeIndexes.map((index) => rows[index]);
            if (!episodeRows.length) {
                message.warning("请先生成或填写分镜表");
                return;
            }
            const generationConfig = { ...buildGenerationConfig(effectiveConfig, scriptNode, "text"), model: scriptNode.metadata?.model || effectiveConfig.textModel || effectiveConfig.model };
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                return;
            }
            setStoryboardActionKey("asset:prepare");
            const updateProgress = (percent: number, text: string) => {
                setNodes((prev) => prev.map((item) => (item.id === scriptNode.id ? { ...item, metadata: { ...item.metadata, storyboardStep: "assets", storyboardAssetError: undefined, storyboardAssetProgress: { percent, text } } } : item)));
            };
            updateProgress(8, "整理剧本与分镜");
            try {
                updateProgress(18, "压缩资产识别输入");
                const activeBeatIds = new Set(activeIndexes.flatMap((index) => scriptNode.metadata?.storyboardShotPlans?.[String(index)]?.sourceBeatIds || []));
                const activeBeats = (scriptNode.metadata?.storyboardSourceBeats || []).filter((beat) => activeBeatIds.has(beat.id));
                const activeEpisodeId = scriptNode.metadata?.storyboardActiveChapterId || scriptNode.metadata?.storyboardChapters?.[0]?.id;
                const activeEpisodeTitle = scriptNode.metadata?.storyboardChapters?.find((episode) => episode.id === activeEpisodeId)?.title || "当前集";
                let source = storyboardAssetPlanningSource(scriptNode, activeEpisodeTitle, activeBeats, episodeRows, activeIndexes);
                updateProgress(28, "提交资产识别请求");
                const requestAssets = (requestSource: string) => {
                    let hasDelta = false;
                    return requestImageQuestion(generationConfig, [{ role: "user", content: `${STORYBOARD_ASSET_PROMPT}\n\n${requestSource}` }], () => {
                        if (hasDelta) return;
                        hasDelta = true;
                        updateProgress(70, "模型返回中，整理角色与场景");
                    });
                };
                let answer: string;
                try {
                    answer = await requestAssets(source);
                } catch (error) {
                    if (!isSafetyGenerationError(error)) throw error;
                    updateProgress(48, "内容审核拦截，使用严格安全摘要重试");
                    source = storyboardAssetPlanningSource(scriptNode, activeEpisodeTitle, activeBeats, episodeRows, activeIndexes, true);
                    answer = await requestAssets(source);
                }
                updateProgress(86, "解析角色、场景和道具");
                const parsed = alignStoryboardAssetsWithSourceStyle(parseStoryboardAssetAnswer(answer), source);
                const mergedAssets = mergeStoryboardEpisodeAssets(scriptNode.metadata?.storyboardAssets || [], parsed.assets, activeEpisodeId);
                updateProgress(96, "写入资产卡片");
                setNodes((prev) =>
                    prev.map((item) =>
                        item.id === scriptNode.id
                            ? {
                                  ...item,
                                  metadata: {
                                      ...item.metadata,
                                      ...scriptNode.metadata,
                                      storyboardStep: "assets",
                                      storyboardAssetStyle: parsed.style,
                                      storyboardAssetError: undefined,
                                      storyboardAssetProgress: undefined,
                                      storyboardAssets: mergedAssets,
                                      storyboardPreparedChapterIds: Array.from(new Set([...(item.metadata?.storyboardPreparedChapterIds || []), ...(activeEpisodeId ? [activeEpisodeId] : [])])),
                                  },
                              }
                            : item,
                    ),
                );
                message.success(`当前集资产已识别，项目资产库共 ${mergedAssets.length} 个`);
            } catch (error) {
                const errorMessage = friendlyGenerationError(error, "识别资产失败");
                setNodes((prev) => prev.map((item) => (item.id === scriptNode.id ? { ...item, metadata: { ...item.metadata, ...scriptNode.metadata, storyboardStep: "assets", storyboardAssetError: errorMessage, storyboardAssetProgress: undefined } } : item)));
                message.error(errorMessage);
            } finally {
                setStoryboardActionKey(null);
            }
        },
        [effectiveConfig, isAiConfigReady, message, openConfigDialog],
    );

    const uploadStoryboardAssetImage = useCallback(
        async (nodeId: string, assetId: string, file: File) => {
            setStoryboardActionKey(`asset:${assetId}`);
            try {
                updateStoryboardAsset(nodeId, assetId, { status: NODE_STATUS_LOADING, errorDetails: undefined });
                const uploaded = await uploadImage(file);
                updateStoryboardAsset(nodeId, assetId, { imageUrl: uploaded.url, storageKey: uploaded.storageKey, status: NODE_STATUS_SUCCESS, errorDetails: undefined });
                message.success("资产图已上传");
            } catch (error) {
                updateStoryboardAsset(nodeId, assetId, { status: NODE_STATUS_ERROR, errorDetails: error instanceof Error ? error.message : "上传资产图失败" });
                message.error(error instanceof Error ? error.message : "上传资产图失败");
            } finally {
                setStoryboardActionKey(null);
            }
        },
        [message, updateStoryboardAsset],
    );

    const generateStoryboardAssetImage = useCallback(
        async (node: CanvasNodeData, assetId: string) => {
            const scriptNode = withStoryboardVideoSettings(node);
            if (scriptNode !== node) setNodes((prev) => prev.map((item) => (item.id === scriptNode.id ? scriptNode : item)));
            const asset = scriptNode.metadata?.storyboardAssets?.find((item) => item.id === assetId);
            const hasReferenceImage = Boolean(asset?.kind === "character" && (asset.imageUrl || asset.storageKey));
            const prompt = storyboardAssetImagePrompt(asset, { hasReferenceImage });
            if (!asset || !prompt) {
                message.warning("请先填写资产提示词");
                return;
            }
            const generationConfig = { ...buildGenerationConfig(effectiveConfig, scriptNode, "image"), model: effectiveConfig.imageModel || effectiveConfig.model, count: "1", ...(asset.kind === "character" ? { size: "16:9" } : {}) };
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                return;
            }
            setStoryboardActionKey(`asset:${assetId}`);
            updateStoryboardAsset(scriptNode.id, assetId, { status: NODE_STATUS_LOADING, errorDetails: undefined });
            const targetId = `storyboard-asset:${scriptNode.id}:${assetId}`;
            const controller = startGenerationRequest(targetId, scriptNode.id, scriptNode.id);
            try {
                const reference = hasReferenceImage ? await storyboardAssetReferenceImage(asset) : null;
                if (hasReferenceImage && !reference) throw new Error("无法读取当前角色参考图，请重新上传后再生成");
                const image = await (reference
                    ? requestEdit(generationConfig, prompt, [reference], undefined, { signal: controller.signal })
                    : requestGeneration(generationConfig, prompt, { signal: controller.signal })
                ).then((items) => items[0]);
                const uploaded = await uploadImage(image.dataUrl);
                updateStoryboardAsset(scriptNode.id, assetId, { imageUrl: uploaded.url, storageKey: uploaded.storageKey, status: NODE_STATUS_SUCCESS, errorDetails: undefined });
                message.success("资产图已生成");
            } catch (error) {
                if (isGenerationCanceled(error)) {
                    updateStoryboardAsset(scriptNode.id, assetId, { status: NODE_STATUS_IDLE, errorDetails: undefined });
                    return;
                }
                const errorDetails = friendlyGenerationError(error, "生成资产图失败");
                updateStoryboardAsset(scriptNode.id, assetId, { status: NODE_STATUS_ERROR, errorDetails });
                message.error(errorDetails);
            } finally {
                finishGenerationRequest(targetId, controller);
                setStoryboardActionKey(null);
            }
        },
        [effectiveConfig, finishGenerationRequest, isAiConfigReady, message, openConfigDialog, startGenerationRequest, updateStoryboardAsset],
    );

    const generateStoryboardSceneSheet = useCallback(
        async (node: CanvasNodeData, assetId: string) => {
            const scriptNode = withStoryboardVideoSettings(node);
            if (scriptNode !== node) setNodes((prev) => prev.map((item) => (item.id === scriptNode.id ? scriptNode : item)));
            const asset = scriptNode.metadata?.storyboardAssets?.find((item) => item.id === assetId);
            if (!asset || asset.kind !== "scene") {
                message.warning("只有场景资产可以生成多角度锁定图");
                return;
            }
            const prompt = storyboardSceneSheetPrompt(asset);
            if (!prompt) {
                message.warning("请先填写场景提示词");
                return;
            }
            const generationConfig = { ...buildGenerationConfig(effectiveConfig, scriptNode, "image"), model: effectiveConfig.imageModel || effectiveConfig.model, count: "1", size: "16:9" };
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                return;
            }
            setStoryboardActionKey(`asset-sheet:${assetId}`);
            updateStoryboardAsset(scriptNode.id, assetId, { sceneSheetUrl: undefined, sceneSheetStorageKey: undefined, sceneSheetStatus: NODE_STATUS_LOADING, sceneSheetError: undefined });
            const targetId = `storyboard-scene-sheet:${scriptNode.id}:${assetId}`;
            const controller = startGenerationRequest(targetId, scriptNode.id, scriptNode.id);
            try {
                const image = await requestGeneration(generationConfig, prompt, { signal: controller.signal }).then((items) => items[0]);
                const uploaded = await uploadImage(image.dataUrl);
                updateStoryboardAsset(scriptNode.id, assetId, { sceneSheetUrl: uploaded.url, sceneSheetStorageKey: uploaded.storageKey, sceneSheetStatus: NODE_STATUS_SUCCESS, sceneSheetError: undefined });
                const sceneSheetReference = storyboardSceneSheetVideoReference(asset, uploaded);
                if (sceneSheetReference) {
                    setNodes((prev) =>
                        prev.map((item) =>
                            item.type === CanvasNodeType.Video && item.metadata?.storyboardSourceNodeId === scriptNode.id && !item.metadata.content && !item.metadata.storyboardVideoDraftNodeId && storyboardPromptDetailUsesAsset(scriptNode, item.metadata.storyboardRowIndex, asset)
                                ? { ...item, metadata: { ...item.metadata, storyboardVideoReferences: mergeStoryboardVideoReferences(item.metadata.storyboardVideoReferences || [], sceneSheetReference) } }
                                : item,
                        ),
                    );
                }
                message.success("场景多角度锁定图已生成");
            } catch (error) {
                if (isGenerationCanceled(error)) {
                    updateStoryboardAsset(scriptNode.id, assetId, { sceneSheetStatus: NODE_STATUS_IDLE, sceneSheetError: undefined });
                    return;
                }
                const errorDetails = friendlyGenerationError(error, "生成场景多角度锁定图失败");
                updateStoryboardAsset(scriptNode.id, assetId, { sceneSheetStatus: NODE_STATUS_ERROR, sceneSheetError: errorDetails });
                message.error(errorDetails);
            } finally {
                finishGenerationRequest(targetId, controller);
                setStoryboardActionKey(null);
            }
        },
        [effectiveConfig, finishGenerationRequest, isAiConfigReady, message, openConfigDialog, startGenerationRequest, updateStoryboardAsset],
    );

    const batchGenerateStoryboardSceneSheets = useCallback(
        async (node: CanvasNodeData) => {
            const scriptNode = withStoryboardVideoSettings(node);
            if (scriptNode !== node) setNodes((prev) => prev.map((item) => (item.id === scriptNode.id ? scriptNode : item)));
            const assets = storyboardActiveAssets(scriptNode).filter((asset) => asset.kind === "scene" && !asset.sceneSheetUrl && !asset.sceneSheetStorageKey);
            if (!assets.length) {
                message.info("没有需要生成的多角度锁定图");
                return;
            }
            const generationConfig = { ...buildGenerationConfig(effectiveConfig, scriptNode, "image"), model: effectiveConfig.imageModel || effectiveConfig.model, count: "1", size: "16:9" };
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                return;
            }
            setStoryboardActionKey("asset-sheet:all");
            let stopped = false;
            const batchController = new AbortController();
            generationBatchControllersRef.current.set(scriptNode.id, batchController);
            try {
                await runLimited(assets, STORYBOARD_ASSET_BATCH_CONCURRENCY, async (asset) => {
                    if (batchController.signal.aborted) {
                        stopped = true;
                        return;
                    }
                    const prompt = storyboardSceneSheetPrompt(asset);
                    if (!prompt) {
                        updateStoryboardAsset(scriptNode.id, asset.id, { sceneSheetStatus: NODE_STATUS_ERROR, sceneSheetError: "请先填写场景提示词" });
                        return;
                    }
                    const targetId = `storyboard-scene-sheet:${scriptNode.id}:${asset.id}`;
                    const controller = startGenerationRequest(targetId, scriptNode.id, scriptNode.id, createLinkedAbortController(batchController));
                    updateStoryboardAsset(scriptNode.id, asset.id, { sceneSheetUrl: undefined, sceneSheetStorageKey: undefined, sceneSheetStatus: NODE_STATUS_LOADING, sceneSheetError: undefined });
                    try {
                        const image = await requestGeneration(generationConfig, prompt, { signal: controller.signal }).then((items) => items[0]);
                        const uploaded = await uploadImage(image.dataUrl);
                        updateStoryboardAsset(scriptNode.id, asset.id, { sceneSheetUrl: uploaded.url, sceneSheetStorageKey: uploaded.storageKey, sceneSheetStatus: NODE_STATUS_SUCCESS, sceneSheetError: undefined });
                        const sceneSheetReference = storyboardSceneSheetVideoReference(asset, uploaded);
                        if (sceneSheetReference) {
                            setNodes((prev) =>
                                prev.map((item) =>
                                    item.type === CanvasNodeType.Video && item.metadata?.storyboardSourceNodeId === scriptNode.id && !item.metadata.content && !item.metadata.storyboardVideoDraftNodeId && storyboardPromptDetailUsesAsset(scriptNode, item.metadata.storyboardRowIndex, asset)
                                        ? { ...item, metadata: { ...item.metadata, storyboardVideoReferences: mergeStoryboardVideoReferences(item.metadata.storyboardVideoReferences || [], sceneSheetReference) } }
                                        : item,
                                ),
                            );
                        }
                    } catch (error) {
                        if (isGenerationCanceled(error)) {
                            stopped = true;
                            updateStoryboardAsset(scriptNode.id, asset.id, { sceneSheetStatus: NODE_STATUS_IDLE, sceneSheetError: undefined });
                            return;
                        }
                        updateStoryboardAsset(scriptNode.id, asset.id, { sceneSheetStatus: NODE_STATUS_ERROR, sceneSheetError: friendlyGenerationError(error, "生成场景多角度锁定图失败") });
                    } finally {
                        finishGenerationRequest(targetId, controller);
                    }
                });
                if (!stopped && !batchController.signal.aborted) message.success("场景多角度锁定图批量生成完成");
            } finally {
                generationBatchControllersRef.current.delete(scriptNode.id);
                setStoryboardActionKey(null);
            }
        },
        [effectiveConfig, finishGenerationRequest, isAiConfigReady, message, openConfigDialog, startGenerationRequest, updateStoryboardAsset],
    );

    const stopStoryboardSceneSheetGeneration = useCallback(
        (node: CanvasNodeData, assetId: string) => {
            stopGenerationByTargetId(`storyboard-scene-sheet:${node.id}:${assetId}`);
            updateStoryboardAsset(node.id, assetId, { sceneSheetStatus: NODE_STATUS_IDLE, sceneSheetError: undefined });
            if (storyboardActionKey === `asset-sheet:${assetId}`) setStoryboardActionKey(null);
            message.info("已暂停当前多角度锁定图生成");
        },
        [message, stopGenerationByTargetId, storyboardActionKey, updateStoryboardAsset],
    );

    const stopStoryboardSceneSheetGenerationBatch = useCallback(
        (node: CanvasNodeData) => {
            stopGenerationByRunningId(node.id);
            setStoryboardActionKey(null);
            setNodes((prev) =>
                prev.map((item) =>
                    item.id === node.id
                        ? {
                              ...item,
                              metadata: {
                                  ...item.metadata,
                                  storyboardAssets: (item.metadata?.storyboardAssets || []).map((asset) => (asset.sceneSheetStatus === NODE_STATUS_LOADING ? { ...asset, sceneSheetStatus: NODE_STATUS_IDLE, sceneSheetError: undefined } : asset)),
                              },
                          }
                        : item,
                ),
            );
            message.info("已暂停全部多角度锁定图生成");
        },
        [message, stopGenerationByRunningId],
    );

    const syncStoryboardAssetVoiceReference = useCallback((scriptNode: CanvasNodeData, asset: StoryboardAsset, audio: { url?: string; storageKey?: string; durationMs?: number }) => {
        const voiceReference = storyboardAssetVoiceAudioReference(asset, audio);
        if (!voiceReference) return;
        setNodes((prev) =>
            prev.map((item) =>
                item.type === CanvasNodeType.Video && item.metadata?.storyboardSourceNodeId === scriptNode.id && !item.metadata.content && !item.metadata.storyboardVideoDraftNodeId
                    ? (() => {
                          const current = (item.metadata.storyboardVideoAudioReferences || []).filter((reference) => reference.role !== "voiceLock" || reference.assetId !== asset.id);
                          const audioReferences = storyboardPromptDetailUsesCharacterVoice(scriptNode, item.metadata.storyboardRowIndex, asset) ? mergeStoryboardAudioReferences(current, voiceReference) : current;
                          const visualPrompt = item.metadata.storyboardVideoFinalPrompt || storyboardVideoFinalPrompt(item.metadata.prompt || "", item.metadata.storyboardVideoReferences || []);
                          return { ...item, metadata: { ...item.metadata, storyboardVideoAudioReferences: audioReferences, storyboardVideoFinalPrompt: storyboardVideoFinalPromptWithAudio(visualPrompt, audioReferences) } };
                      })()
                    : item,
            ),
        );
    }, [setNodes]);

    const generateStoryboardAssetVoice = useCallback(
        async (node: CanvasNodeData, assetId: string) => {
            const scriptNode = withStoryboardVideoSettings(node);
            if (scriptNode !== node) setNodes((prev) => prev.map((item) => (item.id === scriptNode.id ? scriptNode : item)));
            const asset = scriptNode.metadata?.storyboardAssets?.find((item) => item.id === assetId);
            if (!asset || asset.kind !== "character") {
                message.warning("只有角色资产可以生成声音");
                return;
            }
            const audioModel = effectiveConfig.audioModel || defaultConfig.audioModel;
            const generationConfig = { ...buildGenerationConfig(effectiveConfig, undefined, "audio"), model: audioModel, audioModel, count: "1" };
            const baseVoiceProfile = storyboardAssetVoiceProfile(asset, scriptNode.metadata?.storyboardAssetStyle, generationConfig);
            const sampleText = storyboardAssetVoiceSampleText(asset, baseVoiceProfile, scriptNode);
            const voiceProfile = { ...baseVoiceProfile, sampleText };
            const voicePrompt = storyboardAssetVoicePrompt(asset, scriptNode.metadata?.storyboardAssetStyle, voiceProfile);
            if (!voicePrompt || !sampleText) {
                message.warning("请先填写角色描述或提示词");
                return;
            }
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                return;
            }
            setStoryboardActionKey(`asset-voice:${assetId}`);
            const audioVoice = asset.voiceAudioVoice || generationConfig.audioVoice;
            updateStoryboardAsset(scriptNode.id, assetId, { voicePrompt, voiceAudioStatus: NODE_STATUS_LOADING, voiceAudioError: undefined, voiceAudioVoice: audioVoice, voiceAudioSpeed: voiceProfile.speed, voiceAudioInstructions: voicePrompt, voiceSampleText: sampleText });
            const targetId = `storyboard-asset-voice:${scriptNode.id}:${assetId}`;
            const controller = startGenerationRequest(targetId, scriptNode.id, scriptNode.id);
            try {
                const audioConfig = { ...generationConfig, audioVoice, audioSpeed: voiceProfile.speed, audioInstructions: voicePrompt };
                const candidates: StoryboardVoiceCandidate[] = [];
                const failures: Error[] = [];
                for (let index = 0; index < 3; index += 1) {
                    try {
                        const audio = await requestStoredAudioGeneration(audioConfig, sampleText, { signal: controller.signal, seed: Math.floor(Math.random() * 2_147_483_646) + 1, candidateCount: 1 });
                        candidates.push({ id: nanoid(), url: audio.url, storageKey: audio.storageKey, durationMs: audio.durationMs, cacheKey: audio.cacheKey, cacheHit: audio.cacheHit });
                    } catch (error) {
                        if (isGenerationCanceled(error)) throw error;
                        failures.push(error instanceof Error ? error : new Error("声音候选生成失败"));
                    }
                }
                if (!candidates.length) throw failures[0] || new Error("声音候选生成失败");
                const selected = candidates[0];
                updateStoryboardAsset(scriptNode.id, assetId, { voicePrompt, voiceAudioUrl: selected.url, voiceAudioStorageKey: selected.storageKey, voiceAudioDurationMs: selected.durationMs, voiceAudioStatus: NODE_STATUS_SUCCESS, voiceAudioError: undefined, voiceAudioVoice: audioVoice, voiceAudioSpeed: voiceProfile.speed, voiceAudioInstructions: voicePrompt, voiceAudioCacheKey: selected.cacheKey, voiceAudioCacheHit: selected.cacheHit, voiceAudioCandidates: candidates, voiceAudioSelectedCandidateId: selected.id, voiceSampleText: sampleText });
                syncStoryboardAssetVoiceReference(scriptNode, asset, selected);
                if (failures.length) message.warning(`已生成 ${candidates.length} 个声音候选，另有 ${failures.length} 个失败，可重新生成补齐`);
                else message.success("已生成 3 个声音候选，可以试听选择");
            } catch (error) {
                if (isGenerationCanceled(error)) {
                    updateStoryboardAsset(scriptNode.id, assetId, { voiceAudioStatus: NODE_STATUS_IDLE, voiceAudioError: undefined });
                    return;
                }
                const errorDetails = friendlyGenerationError(error, "生成角色声音失败");
                updateStoryboardAsset(scriptNode.id, assetId, { voiceAudioStatus: NODE_STATUS_ERROR, voiceAudioError: errorDetails });
                message.error(errorDetails);
            } finally {
                finishGenerationRequest(targetId, controller);
                setStoryboardActionKey(null);
            }
        },
        [effectiveConfig, finishGenerationRequest, isAiConfigReady, message, openConfigDialog, startGenerationRequest, syncStoryboardAssetVoiceReference, updateStoryboardAsset],
    );

    const selectStoryboardAssetVoice = useCallback(
        (node: CanvasNodeData, assetId: string, candidateId: string) => {
            const scriptNode = withStoryboardVideoSettings(node);
            const asset = scriptNode.metadata?.storyboardAssets?.find((item) => item.id === assetId);
            const candidate = asset?.voiceAudioCandidates?.find((item) => item.id === candidateId);
            if (!asset || !candidate) return;
            updateStoryboardAsset(scriptNode.id, assetId, { voiceAudioUrl: candidate.url, voiceAudioStorageKey: candidate.storageKey, voiceAudioDurationMs: candidate.durationMs, voiceAudioStatus: NODE_STATUS_SUCCESS, voiceAudioError: undefined, voiceAudioCacheKey: candidate.cacheKey, voiceAudioCacheHit: candidate.cacheHit, voiceAudioSelectedCandidateId: candidate.id });
            syncStoryboardAssetVoiceReference(scriptNode, asset, candidate);
            message.success(`已选择 ${asset.name || "角色"} 的声音候选`);
        },
        [message, syncStoryboardAssetVoiceReference, updateStoryboardAsset],
    );

    const batchGenerateStoryboardAssets = useCallback(
        async (node: CanvasNodeData) => {
            const scriptNode = withStoryboardVideoSettings(node);
            if (scriptNode !== node) setNodes((prev) => prev.map((item) => (item.id === scriptNode.id ? scriptNode : item)));
            const activeEpisodeId = scriptNode.metadata?.storyboardActiveChapterId || scriptNode.metadata?.storyboardChapters?.[0]?.id;
            const episodeAssets = storyboardAssetsForEpisode(scriptNode, activeEpisodeId);
            const assets = episodeAssets.filter((asset) => !storyboardAssetReady(asset));
            if (!assets.length) {
                message.info("没有需要生成的资产图");
                return;
            }
            const generationConfig = { ...buildGenerationConfig(effectiveConfig, scriptNode, "image"), model: effectiveConfig.imageModel || effectiveConfig.model, count: "1" };
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                return;
            }
            setStoryboardActionKey("asset:all");
            setNodes((prev) => prev.map((item) => (item.id === scriptNode.id ? { ...item, metadata: { ...item.metadata, storyboardAssetBatchProgress: { status: "running", total: episodeAssets.length, completed: episodeAssets.filter(storyboardAssetReady).length, failed: 0 } } } : item)));
            let stopped = false;
            let failedCount = 0;
            const batchController = new AbortController();
            try {
                await runLimited(assets, STORYBOARD_ASSET_BATCH_CONCURRENCY, async (asset) => {
                    if (batchController.signal.aborted) {
                        stopped = true;
                        return;
                    }
                    const prompt = storyboardAssetImagePrompt(asset);
                    if (!prompt) return;
                    const assetConfig = asset.kind === "character" ? { ...generationConfig, size: "16:9" } : generationConfig;
                    const targetId = `storyboard-asset:${scriptNode.id}:${asset.id}`;
                    const controller = startGenerationRequest(targetId, scriptNode.id, scriptNode.id, batchController);
                    updateStoryboardAsset(scriptNode.id, asset.id, { status: NODE_STATUS_LOADING, errorDetails: undefined });
                    try {
                        const image = await requestGeneration(assetConfig, prompt, { signal: controller.signal }).then((items) => items[0]);
                        const uploaded = await uploadImage(image.dataUrl);
                        updateStoryboardAsset(scriptNode.id, asset.id, { imageUrl: uploaded.url, storageKey: uploaded.storageKey, status: NODE_STATUS_SUCCESS, errorDetails: undefined });
                        setNodes((prev) => prev.map((item) => (item.id === scriptNode.id && item.metadata?.storyboardAssetBatchProgress ? { ...item, metadata: { ...item.metadata, storyboardAssetBatchProgress: { ...item.metadata.storyboardAssetBatchProgress, completed: item.metadata.storyboardAssetBatchProgress.completed + 1 } } } : item)));
                    } catch (error) {
                        if (isGenerationCanceled(error)) {
                            stopped = true;
                            updateStoryboardAsset(scriptNode.id, asset.id, { status: NODE_STATUS_IDLE, errorDetails: undefined });
                            return;
                        }
                        failedCount += 1;
                        updateStoryboardAsset(scriptNode.id, asset.id, { status: NODE_STATUS_ERROR, errorDetails: friendlyGenerationError(error, "生成资产图失败") });
                        setNodes((prev) => prev.map((item) => (item.id === scriptNode.id && item.metadata?.storyboardAssetBatchProgress ? { ...item, metadata: { ...item.metadata, storyboardAssetBatchProgress: { ...item.metadata.storyboardAssetBatchProgress, failed: item.metadata.storyboardAssetBatchProgress.failed + 1 } } } : item)));
                    } finally {
                        finishGenerationRequest(targetId, controller);
                    }
                });
                if (!stopped && !batchController.signal.aborted) {
                    if (failedCount) message.warning(`本轮生成完成，${failedCount} 个资产失败，可点击继续生成剩余资产`);
                    else message.success("资产图批量生成完成");
                }
            } finally {
                setNodes((prev) => prev.map((item) => {
                    if (item.id !== scriptNode.id || !item.metadata?.storyboardAssetBatchProgress) return item;
                    const currentAssets = storyboardAssetsForEpisode(item, activeEpisodeId);
                    const completed = currentAssets.filter(storyboardAssetReady).length;
                    const failed = currentAssets.filter((asset) => asset.status === NODE_STATUS_ERROR).length;
                    const status = completed === currentAssets.length ? "completed" : stopped || batchController.signal.aborted ? "stopped" : "interrupted";
                    return { ...item, metadata: { ...item.metadata, storyboardAssetBatchProgress: { status, total: currentAssets.length, completed, failed } } };
                }));
                setStoryboardActionKey(null);
            }
        },
        [effectiveConfig, finishGenerationRequest, isAiConfigReady, message, openConfigDialog, startGenerationRequest, updateStoryboardAsset],
    );

    const stopStoryboardAssetGeneration = useCallback(
        (node: CanvasNodeData) => {
            stopGenerationByRunningId(node.id);
            setStoryboardActionKey(null);
            setNodes((prev) =>
                prev.map((item) =>
                    item.id === node.id
                        ? {
                              ...item,
                              metadata: {
                                  ...item.metadata,
                                  storyboardAssets: (item.metadata?.storyboardAssets || []).map((asset) => ({
                                      ...asset,
                                      ...(asset.status === NODE_STATUS_LOADING ? { status: NODE_STATUS_IDLE, errorDetails: undefined } : {}),
                                      ...(asset.sceneSheetStatus === NODE_STATUS_LOADING ? { sceneSheetStatus: NODE_STATUS_IDLE, sceneSheetError: undefined } : {}),
                                      ...(asset.voiceAudioStatus === NODE_STATUS_LOADING ? { voiceAudioStatus: NODE_STATUS_IDLE, voiceAudioError: undefined } : {}),
                                  })),
                                  storyboardAssetBatchProgress: {
                                      status: "stopped",
                                      total: storyboardActiveAssets(item).length,
                                      completed: storyboardActiveAssets(item).filter(storyboardAssetReady).length,
                                      failed: storyboardActiveAssets(item).filter((asset) => asset.status === NODE_STATUS_ERROR).length,
                                  },
                              },
                          }
                        : item,
                ),
            );
            message.info("已停止生成");
        },
        [message, stopGenerationByRunningId],
    );

    const exportStoryboardAssetsToCanvas = useCallback(
        async (node: CanvasNodeData) => {
            const scriptNode = withStoryboardVideoSettings(node);
            if (scriptNode !== node) setNodes((prev) => prev.map((item) => (item.id === scriptNode.id ? scriptNode : item)));
            const allAssets = scriptNode.metadata?.storyboardAssets || [];
            const activeEpisodeId = scriptNode.metadata?.storyboardActiveChapterId || scriptNode.metadata?.storyboardChapters?.[0]?.id;
            const episodeAssets = storyboardAssetsForEpisode(scriptNode, activeEpisodeId);
            if (!episodeAssets.length) {
                message.warning("请先打开脚本节点完成第二步资产准备");
                setScriptNodeId(scriptNode.id);
                return;
            }
            const missingCount = episodeAssets.filter((asset) => !storyboardAssetReady(asset)).length;
            if (missingCount) {
                message.warning(`当前集还有 ${missingCount} 个资产未准备完成，请在第二步生成或上传后再导出`);
                setScriptNodeId(scriptNode.id);
                return;
            }
            const assets = allAssets.filter(storyboardAssetReady);
            const generationConfig = { ...buildGenerationConfig(effectiveConfig, scriptNode, "image"), model: effectiveConfig.imageModel || effectiveConfig.model, count: "1" };
            const imageConfig = storyboardNodeSize(CanvasNodeType.Image, generationConfig.size);
            const nextAssets = allAssets.map((asset) => ({ ...asset }));
            const assetNodeIds = { ...(scriptNode.metadata?.storyboardAssetNodeIds || {}) };
            const mentionNodeIds = { ...(scriptNode.metadata?.storyboardAssetMentionNodeIds || {}) };
            const exportedNodes: CanvasNodeData[] = [];
            const existingWorkspaces = Object.fromEntries(
                STORYBOARD_ASSET_KINDS.map((kind) => [kind, nodesRef.current.find((item) => item.metadata?.workspaceKind === STORYBOARD_ASSET_WORKSPACE_KIND[kind] && item.metadata.workspaceSourceNodeId === scriptNode.id)]),
            ) as Record<StoryboardAssetKind, CanvasNodeData | undefined>;
            const defaultWorkspacePositions = defaultStoryboardAssetWorkspacePositions(scriptNode, assets, imageConfig);
            const workspacePositions = defaultWorkspacePositions;
            const exportedCountByKind: Record<StoryboardAssetKind, number> = { character: 0, scene: 0, prop: 0 };
            setStoryboardActionKey("asset:export");
            const messageKey = `storyboard-assets-export:${scriptNode.id}`;
            message.open({ key: messageKey, type: "loading", content: "正在导出已生成资产到画布", duration: 0 });
            try {
                for (const asset of assets) {
                    const prompt = storyboardAssetImagePrompt(asset);
                    let content = asset.imageUrl || "";
                    if (!content && asset.storageKey) content = await resolveImageUrl(asset.storageKey, "");
                    if (!content) continue;
                    const existingNode = nodesRef.current.find((item) => item.id === assetNodeIds[asset.id]) || nodesRef.current.find((item) => item.metadata?.storyboardSourceNodeId === scriptNode.id && item.metadata?.storyboardAssetId === asset.id);
                    const existingId = existingNode?.id || nanoid();
                    assetNodeIds[asset.id] = existingId;
                    mentionNodeIds[`@${asset.name}`] = existingId;
                    const sceneGroupId = asset.kind === "scene" ? `storyboard-scene:${scriptNode.id}:${asset.id}` : undefined;
                    const workspacePosition = workspacePositions[asset.kind];
                    const kindIndex = exportedCountByKind[asset.kind]++;
                    const position = { x: workspacePosition.x + 36 + (kindIndex % STORYBOARD_ASSET_GRID_COLUMNS) * (imageConfig.width + 34), y: workspacePosition.y + 86 + Math.floor(kindIndex / STORYBOARD_ASSET_GRID_COLUMNS) * (imageConfig.height + 74) };
                    const assetNode: CanvasNodeData = {
                        id: existingId,
                        type: CanvasNodeType.Image,
                        title: `${ASSET_KIND_TEXT[asset.kind]}｜${asset.name}`,
                        position,
                        width: imageConfig.width,
                        height: imageConfig.height,
                        metadata: {
                            content,
                            storageKey: asset.storageKey,
                            status: NODE_STATUS_SUCCESS,
                            prompt: prompt || asset.prompt || asset.description,
                            generationType: "generation",
                            model: generationConfig.model,
                            size: generationConfig.size,
                            quality: generationConfig.quality,
                            count: 1,
                            storyboardSourceNodeId: scriptNode.id,
                            storyboardAssetId: asset.id,
                            storyboardAssetKind: asset.kind,
                            storyboardAssetName: asset.name,
                            sceneGroupId,
                            sceneViewRole: asset.kind === "scene" ? "lock" : undefined,
                        },
                    };
                    exportedNodes.push(assetNode);
                }
                if (!exportedNodes.length) {
                    message.warning("没有可导出的资产图");
                    return;
                }
                const workspaceNodes = STORYBOARD_ASSET_KINDS.flatMap((kind) => {
                    const childNodes = exportedNodes.filter((item) => item.metadata?.storyboardAssetKind === kind);
                    if (!childNodes.length) return [];
                    const existingWorkspace = existingWorkspaces[kind];
                    const relayoutWorkspace = existingWorkspace ? { ...existingWorkspace, position: workspacePositions[kind], width: 0, height: 0 } : undefined;
                    return [buildStoryboardWorkspaceNode(relayoutWorkspace, existingWorkspace?.id || `storyboard-assets:${scriptNode.id}:${kind}`, scriptNode, childNodes, workspacePositions[kind], STORYBOARD_ASSET_WORKSPACE_KIND[kind])];
                });
                const exportedById = new Map(exportedNodes.map((item) => [item.id, item]));
                const referenceLookupNodes = [...nodesRef.current.map((item) => exportedById.get(item.id) || item), ...exportedNodes.filter((item) => !nodesRef.current.some((node) => node.id === item.id))];
                const currentScriptNode = referenceLookupNodes.find((item) => item.id === scriptNode.id) || scriptNode;
                const updatedScriptNode = { ...currentScriptNode, metadata: { ...currentScriptNode.metadata, ...scriptNode.metadata, storyboardAssets: nextAssets, storyboardAssetNodeIds: assetNodeIds, storyboardAssetMentionNodeIds: mentionNodeIds } };
                const scriptLookupNodes = referenceLookupNodes.map((item) => item.id === scriptNode.id ? updatedScriptNode : item);
                const relinkedScriptNode = { ...updatedScriptNode, metadata: { ...updatedScriptNode.metadata, storyboardPromptDetails: relinkStoryboardPromptDetails(updatedScriptNode, scriptLookupNodes) } };
                const relinkLookupNodes = scriptLookupNodes.map((item) => item.id === scriptNode.id ? relinkedScriptNode : item);
                const refreshedDraftNodes = relinkLookupNodes
                    .filter((item) => isStoryboardVideoDraftNode(item) && item.metadata?.storyboardSourceNodeId === scriptNode.id)
                    .map((item) => refreshStoryboardVideoDraftReferences(item, relinkedScriptNode, relinkLookupNodes, connectionsRef.current));
                const refreshedDraftById = new Map(refreshedDraftNodes.map((item) => [item.id, item]));
                const refreshedReferenceCounts = { character: 0, scene: 0, prop: 0 };
                refreshedDraftNodes.flatMap((item) => item.metadata?.storyboardVideoReferences || []).forEach((reference) => { if (reference.kind) refreshedReferenceCounts[reference.kind] += 1; });
                setNodes((prev) => {
                    const exportedById = new Map([...workspaceNodes, ...exportedNodes].map((item) => [item.id, item]));
                    const nextWorkspaceIds = new Set(workspaceNodes.map((item) => item.id));
                    const updated = prev.filter((item) => !isStoryboardAssetWorkspace(item) || item.metadata?.workspaceSourceNodeId !== scriptNode.id || nextWorkspaceIds.has(item.id)).map((item) => {
                        if (item.id === scriptNode.id) return relinkedScriptNode;
                        if (refreshedDraftById.has(item.id)) return refreshedDraftById.get(item.id) || item;
                        return exportedById.get(item.id) || item;
                    });
                    const existingIds = new Set(updated.map((item) => item.id));
                    return relayoutStoryboardVideoWorkspacesAfterAssets([...updated, ...[...workspaceNodes, ...exportedNodes].filter((item) => !existingIds.has(item.id))], scriptNode.id, workspaceNodes);
                });
                setConnections((prev) => {
                    const workspaceIds = new Set(nodesRef.current.filter((item) => isStoryboardAssetWorkspace(item) && item.metadata?.workspaceSourceNodeId === scriptNode.id).map((item) => item.id));
                    const next = [...workspaceNodes.map((workspaceNode) => ({ id: nanoid(), fromNodeId: scriptNode.id, toNodeId: workspaceNode.id })), ...exportedNodes.map((assetNode) => ({ id: nanoid(), fromNodeId: scriptNode.id, toNodeId: assetNode.id }))];
                    const base = addUniqueConnections(prev.filter((connection) => !workspaceIds.has(connection.fromNodeId) && !workspaceIds.has(connection.toNodeId)), next);
                    return refreshedDraftNodes.reduce((current, draftNode) => syncStoryboardVideoReferenceConnections(current, draftNode.id, draftNode.metadata?.storyboardVideoReferences || [], relinkLookupNodes), base);
                });
                message.success({ key: messageKey, content: `已更新角色、场景、道具工作区，共包含 ${exportedNodes.length} 个已生成资产节点${refreshedDraftNodes.length ? `，并同步 ${refreshedDraftNodes.length} 个视频草稿：人物 ${refreshedReferenceCounts.character}、场景 ${refreshedReferenceCounts.scene}、道具 ${refreshedReferenceCounts.prop}` : ""}` });
            } catch (error) {
                message.error({ key: messageKey, content: error instanceof Error ? error.message : "导出资产失败" });
            } finally {
                setStoryboardActionKey(null);
            }
        },
        [effectiveConfig, message],
    );

    const composeStoryboardFinalPrompt = useCallback(
        async (node: CanvasNodeData, rowIndex?: number, replaceExisting = false) => {
            const scriptNode = nodesRef.current.find((item) => item.id === node.id) || node;
            const rows = parseStoryboardRows(scriptNode.metadata?.storyboardRows);
            const targetChapterId = rowIndex === undefined ? scriptNode.metadata?.storyboardActiveChapterId || scriptNode.metadata?.storyboardChapters?.[0]?.id : scriptNode.metadata?.storyboardShotPlans?.[String(rowIndex)]?.chapterId;
            if (scriptNode.metadata?.storyboardProductionScope === "series" && targetChapterId && !scriptNode.metadata?.storyboardLockedNarrationChapterIds?.includes(targetChapterId)) {
                message.warning("请先在第一步检查并锁定本章旁白主稿，再合成提示词");
                return;
            }
            const dynamicIndexes = storyboardActiveRowIndexes(scriptNode, rows).filter((index) => scriptNode.metadata?.storyboardShotPlans?.[String(index)]?.renderMode !== "still");
            const indexes = rowIndex === undefined
                ? dynamicIndexes.filter((index) => replaceExisting || !scriptNode.metadata?.storyboardPromptDetails?.[String(index)]?.videoMotionPrompt?.trim() || scriptNode.metadata?.storyboardPromptDetails?.[String(index)]?.promptSource === "fallback" || Boolean(scriptNode.metadata?.storyboardPromptErrors?.[String(index)]))
                : [rowIndex];
            if (!indexes.length) return message.info(dynamicIndexes.length ? "当前集视频片段提示词已全部合成" : "当前集没有动态视频片段");
            const generationConfig = { ...buildGenerationConfig(effectiveConfig, scriptNode, "text"), model: scriptNode.metadata?.model || effectiveConfig.textModel || effectiveConfig.model };
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                return;
            }
            setStoryboardActionKey(rowIndex === undefined ? "prompt:all" : `prompt:${rowIndex}`);
            setStoryboardPromptProgress({ current: 0, total: indexes.length, phase: "准备读取导演规则", status: "running" });
            setRunningNodeId(scriptNode.id);
            const targetId = `storyboard-prompts:${scriptNode.id}`;
            const controller = startGenerationRequest(targetId, scriptNode.id, scriptNode.id);
            let completed = 0;
            let failed = 0;
            try {
                const promptInstruction = await buildStoryboardFinalPromptInstruction();
                for (const index of indexes) {
                    const currentIndex = indexes.indexOf(index) + 1;
                    setStoryboardPromptProgress({ current: currentIndex, total: indexes.length, phase: "准备当前片段", status: "running" });
                    let detail: StoryboardPromptDetail | null = null;
                    let lastError = "合成提示词失败";
                    const prepareModelAnswer = (answer: string) => {
                        const parsed = parseStoryboardPromptDetailAnswer(answer, scriptNode.metadata?.storyboardAssets || []);
                        setStoryboardPromptProgress({ current: currentIndex, total: indexes.length, phase: "本地校正模型结果（不请求模型）", status: "running" });
                        return prepareStoryboardPromptDetailForSave(scriptNode, rows, index, { ...parsed, videoMotionPrompt: normalizeStoryboardVideoPromptLayout(parsed.videoMotionPrompt, storyboardVideoPromptDurationSeconds(scriptNode, rows[index])) }, nodesRef.current, true);
                    };
                    const source = buildStoryboardPromptComposeSource(scriptNode, rows, index);
                    const contextKey = await storyboardPromptComposeContextKey(`${generationConfig.model}\n${promptInstruction.content}\n${source}`);
                    const savedDraft = scriptNode.metadata?.storyboardPromptRawResponses?.[String(index)];
                    const savedAnswer = !replaceExisting && scriptNode.metadata?.storyboardPromptErrors?.[String(index)] && savedDraft?.contextKey === contextKey ? savedDraft.response.trim() : "";
                    const hasSavedAnswer = Boolean(savedAnswer);
                    if (savedAnswer) {
                        try {
                            setStoryboardPromptProgress({ current: currentIndex, total: indexes.length, phase: "重新校正已付费模型结果（不请求模型）", status: "running" });
                            detail = prepareModelAnswer(savedAnswer);
                        } catch (error) {
                            lastError = error instanceof Error ? error.message : "已保存模型结果仍未通过本地校正";
                        }
                    }
                    if (!detail && !hasSavedAnswer) {
                        try {
                            setStoryboardPromptProgress({ current: currentIndex, total: indexes.length, phase: "请求文本模型（本镜仅一次）", attempt: 1, status: "running" });
                            const answer = await requestImageQuestion(generationConfig, [{ role: "user", content: `${promptInstruction.content}\n\n${source}` }], () => {}, { signal: controller.signal });
                            updateStoryboardPromptRawResponse(scriptNode.id, index, { response: answer, contextKey });
                            detail = prepareModelAnswer(answer);
                        } catch (error) {
                            if (isGenerationCanceled(error)) throw error;
                            lastError = `模型合成结果本地校正后仍未通过：${error instanceof Error ? error.message : friendlyGenerationError(error, "模型返回的提示词无法解析或校验")}（本镜未再次调用文本模型，原始响应已保留）`;
                            detail = null;
                        }
                    }
                    if (detail) {
                        setStoryboardPromptProgress({ current: currentIndex, total: indexes.length, phase: "保存当前片段", status: "running" });
                        updateStoryboardPromptDetail(scriptNode.id, index, detail.promptSource ? detail : { ...detail, promptSource: promptInstruction.source, promptSkillRoot: promptInstruction.skillRoot }, true);
                        completed += 1;
                    } else {
                        failed += 1;
                        updateStoryboardPromptError(scriptNode.id, index, lastError);
                    }
                }
                if (failed) message.warning(`本轮完成 ${completed} 个模型提示词，${failed} 个模型结果校正后仍未通过，未使用本地替代提示词；原始响应已保存，同一上下文再次执行只做免费校正，需主动重新合成或上下文变化才请求模型`);
                else message.success(rowIndex === undefined ? `${replaceExisting ? "已重新合成" : "已合成"}当前集 ${completed} 个视频片段提示词` : "合成提示词已生成");
                setStoryboardPromptProgress({ current: indexes.length, total: indexes.length, phase: failed ? `完成，失败 ${failed} 个` : "全部完成", status: failed ? "error" : "completed" });
            } catch (error) {
                if (isGenerationCanceled(error)) {
                    message.info(`已暂停合成，本轮完成 ${completed} 个，已生成结果均已保留`);
                    setStoryboardPromptProgress({ current: completed, total: indexes.length, phase: "已暂停，已保留已完成结果", status: "paused" });
                } else {
                    message.error(friendlyGenerationError(error, completed ? `合成中断，本轮已保留 ${completed} 个结果` : "合成提示词失败"));
                    setStoryboardPromptProgress({ current: completed, total: indexes.length, phase: "发生错误；再次执行会先免费重校正已保存结果", status: "error" });
                }
            } finally {
                finishGenerationRequest(targetId, controller);
                setRunningNodeId(null);
                setStoryboardActionKey(null);
            }
        },
        [effectiveConfig, finishGenerationRequest, isAiConfigReady, message, openConfigDialog, startGenerationRequest, updateStoryboardPromptDetail, updateStoryboardPromptError, updateStoryboardPromptRawResponse],
    );

    const stopStoryboardPromptGeneration = useCallback(
        (node: CanvasNodeData) => {
            stopGenerationByRunningId(node.id);
            setStoryboardPromptProgress((current) => current ? { ...current, phase: "正在暂停，等待当前请求结束", status: "paused" } : current);
            setStoryboardActionKey(null);
        },
        [stopGenerationByRunningId],
    );

    const generateStoryboardImage = useCallback(
        async (node: CanvasNodeData, rowIndex: number) => {
            const scriptNode = withStoryboardVideoSettings(node);
            if (scriptNode !== node) setNodes((prev) => prev.map((item) => (item.id === scriptNode.id ? scriptNode : item)));
            const row = parseStoryboardRows(scriptNode.metadata?.storyboardRows)[rowIndex];
            const promptDetail = scriptNode.metadata?.storyboardPromptDetails?.[String(rowIndex)];
            if (promptDetail?.promptSource === "fallback") {
                message.warning("这是旧版本地兜底提示词，请先重新调用模型合成此片段");
                return;
            }
            const basePrompt = safetyNeutralStoryboardPrompt(promptDetail?.storyboardPrompt?.trim() || row?.[8]?.trim() || row?.[2]?.trim() || "");
            if (!row || !basePrompt) {
                message.warning("请先填写分镜画面提示词或合成提示词");
                return;
            }
            const assetReferenceImages = storyboardFirstFrameAssetReferences(scriptNode, rowIndex, nodesRef.current);
            const plannedTailFrame = Boolean(scriptNode.metadata?.storyboardShotPlans?.[String(rowIndex)]?.usePreviousTailFrame);
            const previousTailFrame = plannedTailFrame ? previousStoryboardTailFrameReference(scriptNode.id, rowIndex, nodesRef.current, connectionsRef.current) : null;
            const tailFrameImages = previousTailFrame ? await resolveStoryboardVideoReferences([previousTailFrame]) : [];
            const referenceImages = [...tailFrameImages, ...assetReferenceImages].slice(0, 6);
            if (!referenceImages.length) {
                message.warning("请先生成或上传当前镜头匹配的人物、场景或道具资产图片");
                return;
            }
            const prompt = `${basePrompt}\n\n${previousTailFrame ? "第一张参考图是上一镜尾帧，必须精确承接其中的人物站位、动作终点、场景结构和光线。" : ""}其余参考图只用于锁定当前镜头的人物身份、服装、场景结构和道具外观。输出单张完整首帧，不生成分屏、拼图、多宫格、设定图或多角度展示。`;
            const generationConfig = { ...buildGenerationConfig(effectiveConfig, scriptNode, "image"), model: effectiveConfig.imageModel || effectiveConfig.model, count: "1" };
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                return;
            }
            const imageConfig = storyboardNodeSize(CanvasNodeType.Image, generationConfig.size);
            const childId = nanoid();
            const x = scriptNode.position.x + scriptNode.width + 96 + (rowIndex % 3) * (imageConfig.width + 32);
            const y = scriptNode.position.y + Math.floor(rowIndex / 3) * (imageConfig.height + 42);
            const metadata = buildImageGenerationMetadata("edit", generationConfig, 1, referenceImages);
            const frameMetadata: Partial<CanvasNodeMetadata> = {
                storyboardSourceNodeId: scriptNode.id,
                storyboardChapterId: scriptNode.metadata?.storyboardShotPlans?.[String(rowIndex)]?.chapterId,
                storyboardRowIndex: rowIndex,
                videoFrameRole: "first",
            };
            setStoryboardActionKey(`image:${rowIndex}`);
            setNodes((prev) => [...prev, { id: childId, type: CanvasNodeType.Image, title: `分镜图 ${row[0] || rowIndex + 1}`, position: { x, y }, width: imageConfig.width, height: imageConfig.height, metadata: { prompt, status: NODE_STATUS_LOADING, ...metadata, ...frameMetadata } }]);
            setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: scriptNode.id, toNodeId: childId }]);
            const controller = startGenerationRequest(childId, scriptNode.id, childId);
            try {
                const image = await requestEdit(generationConfig, prompt, referenceImages, undefined, { signal: controller.signal }).then((items) => items[0]);
                const uploaded = await uploadImage(image.dataUrl);
                const size = fitNodeSize(uploaded.width, uploaded.height, imageConfig.width, imageConfig.height);
                const firstFrame = storyboardGeneratedFirstFrameReference(rowIndex, childId, uploaded);
                setNodes((prev) => prev.map((item) => {
                    if (item.id === childId) return { ...item, width: size.width, height: size.height, metadata: { ...item.metadata, ...imageMetadata(uploaded), prompt, ...metadata, ...frameMetadata } };
                    if (!isStoryboardVideoDraftNode(item) || item.metadata?.storyboardSourceNodeId !== scriptNode.id || item.metadata.storyboardRowIndex !== rowIndex) return item;
                    const references = storyboardPrioritizedVideoReferences(mergeStoryboardVideoReferences(item.metadata.storyboardVideoReferences || [], firstFrame));
                    const storedPrompt = item.metadata.storyboardVideoFinalPrompt || item.metadata.prompt || "";
                    return { ...item, metadata: { ...item.metadata, ...storyboardVideoVisualReferencePatch(storedPrompt, references, item.metadata.storyboardVideoAudioReferences) } };
                }));
                const draft = nodesRef.current.find((item) => isStoryboardVideoDraftNode(item) && item.metadata?.storyboardSourceNodeId === scriptNode.id && item.metadata.storyboardRowIndex === rowIndex);
                if (draft) setConnections((prev) => syncStoryboardVideoReferenceConnections(prev, draft.id, storyboardPrioritizedVideoReferences(mergeStoryboardVideoReferences(draft.metadata?.storyboardVideoReferences || [], firstFrame)), nodesRef.current, childId));
            } catch (error) {
                if (!isGenerationCanceled(error)) setNodes((prev) => prev.map((item) => (item.id === childId ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails: friendlyGenerationError(error, "生成分镜图失败") } } : item)));
            } finally {
                finishGenerationRequest(childId, controller);
                setStoryboardActionKey(null);
            }
        },
        [effectiveConfig, finishGenerationRequest, isAiConfigReady, message, openConfigDialog, startGenerationRequest],
    );

    const generateStoryboardVideo = useCallback(
        async (node: CanvasNodeData, rowIndex: number) => {
            let scriptNode = nodesRef.current.find((item) => item.id === node.id) || node;
            const videoSettingsPatch = storyboardVideoSettingsFallbackPatch(scriptNode, storyboardSourceTextForNode(scriptNode));
            if (Object.keys(videoSettingsPatch).length) {
                scriptNode = { ...scriptNode, metadata: { ...scriptNode.metadata, ...videoSettingsPatch } };
                setNodes((prev) => prev.map((item) => (item.id === scriptNode.id ? { ...item, metadata: { ...item.metadata, ...videoSettingsPatch } } : item)));
            }
            const row = parseStoryboardRows(scriptNode.metadata?.storyboardRows)[rowIndex];
            const detail = storyboardCompletedPromptDetailForRow(scriptNode, rowIndex);
            const prompt = safetyNeutralStoryboardPrompt(detail?.videoMotionPrompt?.trim() || "", true);
            if (!row || !prompt) {
                message.warning("请先到第三步合成视频运动提示词");
                return;
            }
            const requestedMentions = storyboardAssetMentionsForPrompt(detail);
            const assetReferences = storyboardVideoAssetReferences(scriptNode, rowIndex, nodesRef.current);
            const missingMentions = requestedMentions.filter((mention) => !assetReferences.some((item) => item.mention === mention || item.mention.startsWith(`${mention}-`)));
            if (missingMentions.length) {
                message.warning(`请先生成或上传本镜头必要资产：${missingMentions.join("、")}`);
                return;
            }
            const generationConfig = { ...buildGenerationConfig(effectiveConfig, scriptNode, "video"), model: effectiveConfig.videoModel || effectiveConfig.model, count: "1" };
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                return;
            }
            const spec = storyboardNodeSize(CanvasNodeType.Video, generationConfig.size);
            const activeEpisodeId = scriptNode.metadata?.storyboardActiveChapterId || scriptNode.metadata?.storyboardChapters?.[0]?.id;
            const existingWorkspace = nodesRef.current.find((item) => item.metadata?.workspaceKind === "storyboard-videos" && item.metadata.workspaceSourceNodeId === scriptNode.id && item.metadata.workspaceStoryboardChapterId === activeEpisodeId);
            const workspaceId = existingWorkspace?.id || `storyboard-videos:${scriptNode.id}:${activeEpisodeId || "all"}`;
            const workspacePosition = existingWorkspace?.position || defaultStoryboardVideoWorkspacePosition(scriptNode, nodesRef.current);
            const draftNode = buildStoryboardVideoDraftNode(scriptNode, row, rowIndex, rowIndex, spec, generationConfig, workspacePosition, nodesRef.current, connectionsRef.current);
            try {
                assertStoryboardVideoNodeProductionReady(scriptNode, draftNode, "draft");
            } catch (error) {
                const reason = error instanceof Error ? error.message : "分镜生产契约校验失败";
                updateStoryboardPromptError(scriptNode.id, rowIndex, reason);
                message.error(reason);
                return;
            }
            const existingDraftNodes = nodesRef.current.filter((item) => item.type === CanvasNodeType.Video && item.id !== draftNode.id && item.metadata?.storyboardSourceNodeId === scriptNode.id && item.metadata.storyboardChapterId === activeEpisodeId && item.metadata.storyboardRowIndex !== undefined && !item.metadata.content && !item.metadata.storyboardVideoDraftNodeId);
            const workspaceNode = buildStoryboardWorkspaceNode(existingWorkspace, workspaceId, scriptNode, [...existingDraftNodes, draftNode], workspacePosition, "storyboard-videos", activeEpisodeId);
            setStoryboardActionKey(`video:${rowIndex}`);
            setNodes((prev) => {
                const draftById = new Map([workspaceNode, draftNode].map((item) => [item.id, item]));
                const updated = prev.map((item) => draftById.get(item.id) || item);
                const existingIds = new Set(prev.map((item) => item.id));
                return [...updated, ...[workspaceNode, draftNode].filter((item) => !existingIds.has(item.id))];
            });
            setConnections((prev) => addUniqueConnections(syncStoryboardVideoReferenceConnections(prev, draftNode.id, draftNode.metadata?.storyboardVideoReferences || [], nodesRef.current), [{ id: nanoid(), fromNodeId: scriptNode.id, toNodeId: workspaceNode.id }]));
            setStoryboardActionKey(null);
            setScriptNodeId(null);
            window.setTimeout(() => window.dispatchEvent(new CustomEvent(STORYBOARD_VIDEO_PROMPT_PREVIEW_EVENT, { detail: draftNode.id })), 120);
            message.success(`已创建待审核视频节点，已绑定 ${draftNode.metadata?.storyboardVideoReferences?.length || 0} 条视觉参考，请确认最终提示词后生成`);
        },
        [effectiveConfig, isAiConfigReady, message, openConfigDialog, updateStoryboardPromptError],
    );

    const batchGenerateStoryboardImages = useCallback(
        async (node: CanvasNodeData) => {
            const rows = parseStoryboardRows(node.metadata?.storyboardRows);
            const indexes = storyboardActiveRowIndexes(node, rows).filter((index) => node.metadata?.storyboardPromptDetails?.[String(index)]?.storyboardPrompt?.trim() || rows[index]?.[8]?.trim());
            if (!indexes.length) {
                message.warning("请先填写分镜画面提示词或合成提示词");
                return;
            }
            setStoryboardActionKey("image:all");
            for (const index of indexes) await generateStoryboardImage(node, index);
            setStoryboardActionKey(null);
        },
        [generateStoryboardImage, message],
    );

    const batchGenerateStoryboardVideos = useCallback(
        async (node: CanvasNodeData) => {
            let scriptNode = nodesRef.current.find((item) => item.id === node.id) || node;
            const videoSettingsPatch = storyboardVideoSettingsFallbackPatch(scriptNode, storyboardSourceTextForNode(scriptNode));
            if (Object.keys(videoSettingsPatch).length) {
                scriptNode = { ...scriptNode, metadata: { ...scriptNode.metadata, ...videoSettingsPatch } };
                setNodes((prev) => prev.map((item) => (item.id === scriptNode.id ? { ...item, metadata: { ...item.metadata, ...videoSettingsPatch } } : item)));
            }
            const rows = parseStoryboardRows(scriptNode.metadata?.storyboardRows);
            const activeIndexes = storyboardVideoDraftRowIndexes(scriptNode, rows);
            const indexes = activeIndexes;
            if (!indexes.length) {
                message.warning("当前集没有可用的视频片段，请先合成当前集提示词");
                return;
            }
            const generationConfig = { ...buildGenerationConfig(effectiveConfig, scriptNode, "video"), model: effectiveConfig.videoModel || effectiveConfig.model, count: "1" };
            const spec = storyboardNodeSize(CanvasNodeType.Video, generationConfig.size);
            const activeEpisodeId = scriptNode.metadata?.storyboardActiveChapterId || scriptNode.metadata?.storyboardChapters?.[0]?.id;
            const existingWorkspace = nodesRef.current.find((item) => item.metadata?.workspaceKind === "storyboard-videos" && item.metadata.workspaceSourceNodeId === scriptNode.id && item.metadata.workspaceStoryboardChapterId === activeEpisodeId);
            const workspaceId = existingWorkspace?.id || `storyboard-videos:${scriptNode.id}:${activeEpisodeId || "all"}`;
            const workspacePosition = existingWorkspace?.position || defaultStoryboardVideoWorkspacePosition(scriptNode, nodesRef.current);
            const failedDrafts: Record<string, string> = {};
            const existingDrafts = nodesRef.current.filter((item) => isStoryboardVideoDraftNode(item) && item.metadata?.storyboardSourceNodeId === scriptNode.id && item.metadata.storyboardChapterId === activeEpisodeId);
            const occupiedDrafts = [...existingDrafts];
            const videoNodes = indexes.flatMap((rowIndex, order) => {
                const hasExistingDraft = existingDrafts.some((item) => item.metadata?.storyboardRowIndex === rowIndex);
                const draft = buildStoryboardVideoDraftNode(scriptNode, rows[rowIndex], rowIndex, hasExistingDraft ? order : storyboardNextVideoDraftGridOrder(occupiedDrafts, workspacePosition, spec), spec, generationConfig, workspacePosition, nodesRef.current, connectionsRef.current);
                try {
                    assertStoryboardVideoNodeProductionReady(scriptNode, draft, "draft");
                    if (!hasExistingDraft) occupiedDrafts.push(draft);
                    return [draft];
                } catch (error) {
                    failedDrafts[String(rowIndex)] = error instanceof Error ? error.message : "分镜生产契约校验失败";
                    return [];
                }
            });
            if (Object.keys(failedDrafts).length) {
                setNodes((prev) => prev.map((item) => item.id === scriptNode.id ? { ...item, metadata: { ...item.metadata, storyboardPromptErrors: { ...(item.metadata?.storyboardPromptErrors || {}), ...failedDrafts } } } : item));
            }
            if (!videoNodes.length) {
                message.warning("当前集视频草稿均未通过生产契约校验，请先修正第三步提示词");
                return;
            }
            const linkedAssetCount = videoNodes.reduce((total, videoNode) => total + (videoNode.metadata?.storyboardVideoReferences?.length || storyboardVideoAssetReferenceNodes(videoNode, nodesRef.current).length), 0);
            const activeIndexSet = new Set(indexes);
            const existingResults = nodesRef.current.filter((item) => item.type === CanvasNodeType.Video && Boolean(item.metadata?.storyboardVideoDraftNodeId) && item.metadata?.storyboardSourceNodeId === scriptNode.id && item.metadata.storyboardChapterId === activeEpisodeId && activeIndexSet.has(item.metadata.storyboardRowIndex ?? -1));
            const workspaceNode = buildStoryboardWorkspaceNode(existingWorkspace, workspaceId, scriptNode, [...videoNodes, ...existingResults], workspacePosition, "storyboard-videos", activeEpisodeId);
            setNodes((prev) => {
                const draftById = new Map([workspaceNode, ...videoNodes].map((item) => [item.id, item]));
                const updated = prev.map((item) => draftById.get(item.id) || item);
                const existingIds = new Set(prev.map((item) => item.id));
                return [...updated, ...[workspaceNode, ...videoNodes].filter((item) => !existingIds.has(item.id))];
            });
            setConnections((prev) => {
                const synced = videoNodes.reduce((current, videoNode) => syncStoryboardVideoReferenceConnections(current, videoNode.id, videoNode.metadata?.storyboardVideoReferences || [], nodesRef.current), prev);
                return addUniqueConnections(synced, [{ id: nanoid(), fromNodeId: scriptNode.id, toNodeId: workspaceNode.id }]);
            });
            if (!linkedAssetCount) message.info("视频工作区已搭建；如需资产参考，请先确认资产工作区已生成");
            const episodeTitle = scriptNode.metadata?.storyboardChapters?.find((episode) => episode.id === scriptNode.metadata?.storyboardActiveChapterId)?.title || "当前集";
            message.success(`已搭建${episodeTitle}视频工作区：${videoNodes.length} 条 × 15 秒，已绑定 ${linkedAssetCount} 条视觉参考`);
        },
        [effectiveConfig, message],
    );

    const storyboardVideoWorkspaceSyncKey = useMemo(() => {
        const workspaceSourceIds = new Set(nodes.filter((item) => item.metadata?.workspaceKind === "storyboard-videos").map((item) => item.metadata?.workspaceSourceNodeId).filter(Boolean));
        return nodes.flatMap((item) => {
            if (item.type === CanvasNodeType.Workspace && item.metadata?.workspaceKind === "storyboard-videos") return [`workspace:${item.id}:${item.metadata.workspaceSourceNodeId || ""}:${item.metadata.workspaceStoryboardChapterId || ""}`];
            if (item.type === CanvasNodeType.Script && workspaceSourceIds.has(item.id)) return [`script:${item.id}:${JSON.stringify(item.metadata?.storyboardShotPlans || {})}:${JSON.stringify(item.metadata?.storyboardPromptDetails || {})}:${JSON.stringify(item.metadata?.storyboardPromptErrors || {})}`];
            if (isStoryboardVideoDraftNode(item)) return [`draft:${item.id}:${item.metadata?.storyboardRowIndex}`];
            if (item.metadata?.storyboardVideoDraftNodeId) return [`result:${item.id}:${item.metadata.storyboardVideoDraftNodeId}`];
            return [];
        }).join("|");
    }, [nodes]);

    useEffect(() => {
        if (!projectLoaded) return;
        const currentNodes = nodesRef.current;
        const additions: CanvasNodeData[] = [];
        const workspaceUpdates = new Map<string, CanvasNodeData>();
        const scriptUpdates = new Map<string, CanvasNodeData>();
        currentNodes.filter((item) => item.type === CanvasNodeType.Workspace && item.metadata?.workspaceKind === "storyboard-videos").forEach((workspace) => {
            let scriptNode = scriptUpdates.get(workspace.metadata?.workspaceSourceNodeId || "") || currentNodes.find((item) => item.id === workspace.metadata?.workspaceSourceNodeId && item.type === CanvasNodeType.Script);
            if (!scriptNode) return;
            let rows = parseStoryboardRows(scriptNode.metadata?.storyboardRows);
            const indexes = storyboardVideoDraftCandidateRowIndexes(scriptNode, rows);
            const chapterId = workspace.metadata?.workspaceStoryboardChapterId;
            const existingDrafts = [...currentNodes, ...additions].filter((item) => isStoryboardVideoDraftNode(item) && item.metadata?.storyboardSourceNodeId === scriptNode.id && item.metadata.storyboardChapterId === chapterId);
            const existingRows = new Set(existingDrafts.map((item) => item.metadata?.storyboardRowIndex));
            const missingIndexes = indexes.filter((rowIndex) => scriptNode.metadata?.storyboardShotPlans?.[String(rowIndex)]?.chapterId === chapterId && !existingRows.has(rowIndex));
            if (!missingIndexes.length) return;
            const generationConfig = { ...buildGenerationConfig(effectiveConfig, scriptNode, "video"), model: effectiveConfig.videoModel || effectiveConfig.model, count: "1" };
            const spec = storyboardNodeSize(CanvasNodeType.Video, generationConfig.size);
            const occupiedDrafts = [...existingDrafts];
            const drafts = missingIndexes.flatMap((rowIndex) => {
                const sourceDetail = scriptNode.metadata?.storyboardPromptDetails?.[String(rowIndex)];
                if (!sourceDetail) return [];
                try {
                    const detail = prepareStoryboardPromptDetailForSave(scriptNode, rows, rowIndex, sourceDetail, currentNodes, true);
                    const nextRows = rows.map((row) => [...row]);
                    if (nextRows[rowIndex]) nextRows[rowIndex][8] = detail.storyboardPrompt || detail.videoMotionPrompt;
                    const normalizedRows = renumberStoryboardRowsForCanvas(nextRows);
                    const promptErrors = { ...(scriptNode.metadata?.storyboardPromptErrors || {}) };
                    delete promptErrors[String(rowIndex)];
                    const preparedScriptNode: CanvasNodeData = {
                        ...scriptNode,
                        metadata: {
                            ...scriptNode.metadata,
                            content: storyboardRowsToMarkdownForCanvas(normalizedRows),
                            storyboardRows: [STORYBOARD_COLUMNS, ...normalizedRows],
                            storyboardStep: "prompts",
                            storyboardPromptDetails: { ...(scriptNode.metadata?.storyboardPromptDetails || {}), [String(rowIndex)]: detail },
                            storyboardPromptErrors: promptErrors,
                        },
                    };
                    const draft = buildStoryboardVideoDraftNode(preparedScriptNode, normalizedRows[rowIndex], rowIndex, storyboardNextVideoDraftGridOrder(occupiedDrafts, workspace.position, spec), spec, generationConfig, workspace.position, currentNodes, connectionsRef.current);
                    assertStoryboardVideoNodeProductionReady(preparedScriptNode, draft, "draft");
                    scriptNode = preparedScriptNode;
                    rows = normalizedRows;
                    scriptUpdates.set(scriptNode.id, scriptNode);
                    occupiedDrafts.push(draft);
                    return [draft];
                } catch (error) {
                    scriptNode = { ...scriptNode, metadata: { ...scriptNode.metadata, storyboardPromptErrors: { ...(scriptNode.metadata?.storyboardPromptErrors || {}), [String(rowIndex)]: error instanceof Error ? error.message : "分镜生产契约校验失败" } } };
                    scriptUpdates.set(scriptNode.id, scriptNode);
                    return [];
                }
            });
            if (!drafts.length) return;
            additions.push(...drafts);
            const activeIndexSet = new Set(storyboardVideoDraftRowIndexes(scriptNode, rows));
            const results = currentNodes.filter((item) => item.type === CanvasNodeType.Video && Boolean(item.metadata?.storyboardVideoDraftNodeId) && item.metadata?.storyboardSourceNodeId === scriptNode.id && item.metadata.storyboardChapterId === chapterId && activeIndexSet.has(item.metadata.storyboardRowIndex ?? -1));
            workspaceUpdates.set(workspace.id, buildStoryboardWorkspaceNode(workspace, workspace.id, scriptNode, [...existingDrafts, ...drafts, ...results], workspace.position, "storyboard-videos", chapterId));
        });
        if (!additions.length && !scriptUpdates.size) return;
        setNodes((prev) => {
            const existingIds = new Set(prev.map((item) => item.id));
            return [...prev.map((item) => {
                const scriptUpdate = scriptUpdates.get(item.id);
                if (scriptUpdate) return scriptUpdate;
                return workspaceUpdates.get(item.id) || item;
            }), ...additions.filter((item) => !existingIds.has(item.id))];
        });
        if (additions.length) setConnections((prev) => additions.reduce((current, draft) => syncStoryboardVideoReferenceConnections(current, draft.id, draft.metadata?.storyboardVideoReferences || [], currentNodes), prev));
    }, [effectiveConfig, projectLoaded, storyboardVideoWorkspaceSyncKey]);

    const importStoryboardScreenshot = useCallback(
        async (node: CanvasNodeData, file: File, model?: string): Promise<StoryboardImportPreview | null> => {
            const generationConfig = { ...buildGenerationConfig(effectiveConfig, undefined, "text"), ...(model?.trim() ? { model: model.trim() } : {}) };
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                return null;
            }
            try {
                message.loading({ content: "正在识别文件", key: `storyboard-${node.id}` });
                const isTextFile = isStoryboardTextFile(file);
                const answer = isTextFile ? await storyboardAnswerFromTextFile(generationConfig, file) : await storyboardAnswerFromImageFile(generationConfig, file);
                const parsedRows = parseStoryboardLoose(answer);
                const importedRows = stripStoryboardHeader(parsedRows);
                if (!importedRows.length) {
                    message.warning({ content: "没有识别到可导入的分镜表格", key: `storyboard-${node.id}` });
                    return { rows: [], raw: answer, model: generationConfig.model };
                }
                message.success({ content: `已识别 ${importedRows.length} 行分镜`, key: `storyboard-${node.id}` });
                return { rows: importedRows, raw: answer, model: generationConfig.model };
            } catch (error) {
                const raw = error instanceof Error ? error.message : "截图识别失败";
                message.error({ content: raw, key: `storyboard-${node.id}` });
                return { rows: [], raw, model: generationConfig.model };
            }
        },
        [effectiveConfig, isAiConfigReady, message, openConfigDialog],
    );

    const toggleBatchExpanded = useCallback((nodeId: string) => {
        const isExpanded = Boolean(nodesRef.current.find((node) => node.id === nodeId)?.metadata?.imageBatchExpanded);
        if (isExpanded) {
            setCollapsingBatchIds((prev) => new Set(prev).add(nodeId));
            window.setTimeout(() => {
                setCollapsingBatchIds((prev) => {
                    const next = new Set(prev);
                    next.delete(nodeId);
                    return next;
                });
            }, 320);
        } else {
            setOpeningBatchIds((prev) => new Set(prev).add(nodeId));
            window.setTimeout(() => {
                setOpeningBatchIds((prev) => {
                    const next = new Set(prev);
                    next.delete(nodeId);
                    return next;
                });
            }, 260);
        }
        setNodes((prev) =>
            prev.map((node) => {
                if (node.id !== nodeId) return node;
                return { ...node, metadata: { ...node.metadata, imageBatchExpanded: !node.metadata?.imageBatchExpanded } };
            }),
        );
    }, []);

    const setBatchPrimary = useCallback((child: CanvasNodeData) => {
        const rootId = child.metadata?.batchRootId;
        if (!rootId || !child.metadata?.content) return;
        setNodes((prev) =>
            prev.map((node) =>
                node.id === rootId
                    ? {
                          ...node,
                          width: child.width,
                          height: child.height,
                          metadata: {
                              ...node.metadata,
                              content: child.metadata?.content,
                              primaryImageId: child.id,
                              naturalWidth: child.metadata?.naturalWidth,
                              naturalHeight: child.metadata?.naturalHeight,
                              freeResize: child.metadata?.freeResize,
                          },
                      }
                    : node,
            ),
        );
    }, []);

    const openTextEditor = useCallback((node: CanvasNodeData) => {
        if (node.type !== CanvasNodeType.Text) return;
        setSelectedNodeIds(new Set([node.id]));
        setSelectedConnectionId(null);
        setDialogNodeId(node.id);
        setEditingNodeId(node.id);
        setEditRequestNonce((value) => value + 1);
    }, []);

    const openNodePromptPanel = useCallback((node: CanvasNodeData) => {
        setSelectedNodeIds(new Set([node.id]));
        setSelectedConnectionId(null);
        setToolbarNodeId(null);
        setDialogNodeId(node.id);
    }, []);

    const handleNodePromptChange = useCallback((nodeId: string, prompt: string) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, prompt } } : node)));
    }, []);

    const handleConfigNodeChange = useCallback((nodeId: string, patch: Partial<CanvasNodeMetadata>) => {
        const currentNode = nodesRef.current.find((node) => node.id === nodeId);
        if (currentNode && isStoryboardVideoDraftNode(currentNode) && patch.storyboardVideoFinalPrompt !== undefined) {
            const scriptNode = nodesRef.current.find((node) => node.id === currentNode.metadata?.storyboardSourceNodeId);
            if (scriptNode) {
                try {
                    assertStoryboardVideoNodeProductionReady(scriptNode, applyNodeConfigPatch(currentNode, patch), "draft");
                } catch (error) {
                    const reason = error instanceof Error ? error.message : "分镜生产契约校验失败";
                    setNodes((prev) => prev.map((node) => node.id === scriptNode.id ? { ...node, metadata: { ...node.metadata, storyboardPromptErrors: { ...(node.metadata?.storyboardPromptErrors || {}), [String(currentNode.metadata?.storyboardRowIndex)]: reason } } } : node));
                    message.error(reason);
                    return;
                }
            }
        }
        setNodes((prev) => {
            const sourceNode = prev.find((node) => node.id === nodeId);
            if (!sourceNode) return prev;
            const nextSourceNode = applyNodeConfigPatch(sourceNode, patch);
            const videoSettingsPatch = storyboardVideoSettingsOnlyPatch(patch);
            const syncStoryboardDrafts = sourceNode.type === CanvasNodeType.Script && Object.keys(videoSettingsPatch).length > 0;
            const storyboardRows = syncStoryboardDrafts ? parseStoryboardRows(nextSourceNode.metadata?.storyboardRows) : [];
            return prev.map((node) => {
                if (node.id === nodeId) return nextSourceNode;
                if (!syncStoryboardDrafts || node.type !== CanvasNodeType.Video || node.metadata?.storyboardSourceNodeId !== nodeId || node.metadata?.content || node.metadata?.storyboardVideoDraftNodeId || node.metadata?.storyboardVideoConfigCustomized) return node;
                const row = storyboardRows[node.metadata.storyboardRowIndex ?? -1];
                const draftPatch = videoSettingsPatch.seconds === undefined ? videoSettingsPatch : { ...videoSettingsPatch, seconds: storyboardVideoSecondsForRow(videoSettingsPatch.seconds, row) };
                return applyNodeConfigPatch(node, draftPatch);
            });
        });
    }, [message]);

    const openPromptAssistant = useCallback((node: CanvasNodeData) => {
        setPromptAssistantNodeId(node.id);
        setPromptAssistantModel((current) => current || effectiveConfig.textModel || effectiveConfig.model);
        setToolbarNodeId(null);
        setDialogNodeId((current) => (current === node.id ? current : current));
    }, [effectiveConfig.model, effectiveConfig.textModel]);

    const applyPromptAssistantResult = useCallback(
        (node: CanvasNodeData, prompt: string, mode: "replace" | "append" | "text") => {
            const text = prompt.trim();
            if (!text) return;
            if (mode === "text") {
                const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Text];
                const textNode = createCanvasNode(CanvasNodeType.Text, { x: node.position.x + node.width / 2, y: node.position.y + node.height + 88 + spec.height / 2 }, { content: text, prompt: text, status: NODE_STATUS_SUCCESS, fontSize: 14 });
                setNodes((prev) => [...prev.map((item) => (item.id === node.id ? applyNodeConfigPatch(item, clearPromptAssistantPendingPatch()) : item)), textNode]);
                setSelectedNodeIds(new Set([textNode.id]));
                setSelectedConnectionId(null);
                setDialogNodeId(textNode.id);
                message.success("已新建提示词文本节点");
                return;
            }
            const nextPrompt = mergePromptForNode(node, text, mode);
            setNodes((prev) => prev.map((item) => (item.id === node.id ? applyNodeConfigPatch(item, { ...promptPatchForNode(item, nextPrompt), ...clearPromptAssistantPendingPatch() }) : item)));
            setDialogNodeId(node.id);
            message.success(mode === "append" ? "已追加到当前提示词" : "已替换当前提示词");
        },
        [message],
    );

    const applyPendingPromptAssistantResult = useCallback(
        (node: CanvasNodeData, mode: "replace" | "append") => {
            const prompt = node.metadata?.promptAssistantPendingPrompt?.trim();
            if (prompt) applyPromptAssistantResult(node, prompt, mode);
        },
        [applyPromptAssistantResult],
    );

    const discardPromptAssistantPending = useCallback(
        (nodeId: string) => {
            setNodes((prev) => prev.map((node) => (node.id === nodeId ? applyNodeConfigPatch(node, clearPromptAssistantPendingPatch()) : node)));
            message.success("已忽略AI优化结果");
        },
        [message],
    );

    const rewritePromptWithAi = useCallback(
        async (node: CanvasNodeData, prompt: string, requirement: string, selectedModel?: string, skill?: "cinema-dna") => {
            const model = selectedModel || promptAssistantModel || effectiveConfig.textModel || effectiveConfig.model;
            const requestConfig = { ...effectiveConfig, model };
            if (!isAiConfigReady(requestConfig, model)) {
                openConfigDialog(true);
                throw new Error("请先在右上角配置里设置文本模型、API Base 和 API Key");
            }
            const requestId = String(++promptAssistantRequestSeqRef.current);
            const storySource = node.type === CanvasNodeType.Script
                ? buildNodeGenerationInputs(node.id, nodesRef.current, connectionsRef.current)
                      .filter((input) => input.type === "text" && input.text?.trim())
                      .map((input) => `【${input.title || "剧本文本"}】\n${input.text?.trim() || ""}`)
                      .join("\n\n")
                : "";
            if (node.type === CanvasNodeType.Script && !storySource) throw new Error("没有读取到连接剧本，请先把文本节点连接到 Script 节点");
            const cinemaDnaContext = skill === "cinema-dna" ? await loadCinemaDnaSkillContext() : null;
            if (skill === "cinema-dna" && !cinemaDnaContext?.files?.length) throw new Error("未读取到 Cinema DNA 技能，请确认本地 Canvas Agent 已重启");
            const instruction = skill === "cinema-dna"
                ? buildCinemaDnaPromptInstruction(prompt || readNodePrompt(node), cinemaDnaContext!.files!.map((file) => file.content).join("\n\n"))
                : node.type === CanvasNodeType.Script
                ? buildStoryboardProjectSettingsInstruction(storyboardDirectorInstructionForNode(node), requirement, storySource)
                : buildPromptAssistantInstruction(prompt || readNodePrompt(node), requirement);
            setNodes((prev) =>
                prev.map((item) =>
                    item.id === node.id
                        ? applyNodeConfigPatch(item, { promptAssistantStatus: "loading", promptAssistantRequestId: requestId, promptAssistantPendingPrompt: "", promptAssistantError: undefined })
                        : item,
                ),
            );
            const textMessages: AiTextMessage[] = [
                {
                    role: "user" as const,
                    content: instruction,
                },
            ];
            let messages = textMessages;
            if (node.type === CanvasNodeType.Image && node.metadata?.content) {
                try {
                    const dataUrl = await imageToDataUrl({ url: node.metadata.content, storageKey: node.metadata.storageKey });
                    if (dataUrl) {
                        messages = [{
                            role: "user",
                            content: [
                                { type: "text" as const, text: instruction },
                                { type: "image_url" as const, image_url: { url: dataUrl } },
                            ],
                        }];
                    }
                } catch {
                    // If image hydration fails, still rewrite from the prompt text.
                }
            }
            setPromptAssistantLoading(true);
            try {
                let output = "";
                const run = (input: AiTextMessage[]) =>
                    requestImageQuestion(requestConfig, input, (text) => {
                        output = text;
                    });
                let result: string;
                try {
                    result = await run(messages);
                } catch (error) {
                    if (messages === textMessages) throw error;
                    output = "";
                    result = await run(textMessages);
                }
                const rawPrompt = (result || output).trim();
                const nextPrompt = node.type === CanvasNodeType.Script ? parseStoryboardProjectSettingsAnswer(rawPrompt) : rawPrompt;
                if (!nextPrompt) throw new Error("AI 未返回有效提示词");
                setNodes((prev) =>
                    prev.map((item) =>
                        item.id === node.id && item.metadata?.promptAssistantRequestId === requestId
                            ? applyNodeConfigPatch(item, { promptAssistantStatus: "success", promptAssistantPendingPrompt: nextPrompt, promptAssistantError: undefined, promptAssistantRequestId: undefined })
                            : item,
                    ),
                );
                return nextPrompt;
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : "AI 优化失败";
                setNodes((prev) =>
                    prev.map((item) =>
                        item.id === node.id && item.metadata?.promptAssistantRequestId === requestId
                            ? applyNodeConfigPatch(item, { promptAssistantStatus: "error", promptAssistantError: errorMessage, promptAssistantRequestId: undefined })
                            : item,
                    ),
                );
                throw error;
            } finally {
                setPromptAssistantLoading(false);
            }
        },
        [effectiveConfig, isAiConfigReady, openConfigDialog, promptAssistantModel],
    );

    const rewritePromptWithCinemaDna = useCallback(
        (node: CanvasNodeData) => {
            const prompt = readNodePrompt(node).trim();
            if (!prompt) return message.warning("请先输入要生成的图片内容");
            void rewritePromptWithAi(node, prompt, "", undefined, "cinema-dna")
                .then(() => message.success("Cinema DNA 已生成电影化提示词，请选择替换或追加"))
                .catch((error) => message.error(error instanceof Error ? error.message : "Cinema DNA 优化失败"));
        },
        [message, rewritePromptWithAi],
    );

    const downloadNodeImage = useCallback(
        (node: CanvasNodeData) => {
            if (node.type !== CanvasNodeType.Image && node.type !== CanvasNodeType.Video && node.type !== CanvasNodeType.Audio) return;
            if (!node.metadata?.content) return message.error(node.type === CanvasNodeType.Video ? "没有可下载的视频" : node.type === CanvasNodeType.Audio ? "没有可下载的音频" : "没有可下载的图片");

            const fileName = `canvas-${node.type}-${node.id}.${node.type === CanvasNodeType.Video ? "mp4" : node.type === CanvasNodeType.Audio ? audioExtension(node.metadata.mimeType) : imageExtension(node.metadata.content)}`;
            try {
                saveAs(node.metadata.content, fileName);
                message.success({ content: `已开始下载：${fileName}`, key: `download-${node.id}` });
            } catch (error) {
                message.error(error instanceof Error ? error.message : "下载失败");
            }
        },
        [message],
    );

    const separateNodeAudio = useCallback(
        async (node: CanvasNodeData) => {
            if (node.type !== CanvasNodeType.Video || !node.metadata?.content || audioSeparatingNodeIds.has(node.id)) return;
            const messageKey = `separate-audio-${node.id}`;
            setAudioSeparatingNodeIds((current) => new Set(current).add(node.id));
            try {
                const video = node.metadata.storageKey ? await getMediaBlob(node.metadata.storageKey) : await fetch(node.metadata.content).then((response) => response.blob());
                if (!video) throw new Error("当前视频文件已丢失，无法分离音频");
                const result = await separateVideoAudio(video, `${node.title || "video"}.mp4`, ({ percent, text }) => message.open({ key: messageKey, type: "loading", content: `${text} ${percent}%`, duration: 0 }));
                const [vocals, instrumental] = await Promise.all([uploadMediaFile(result.vocals, "audio"), uploadMediaFile(result.instrumental, "audio")]);
                const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Audio];
                const gap = 20;
                const startX = node.position.x + node.width + 96;
                const startY = node.position.y + (node.height - spec.height * 2 - gap) / 2;
                const vocalsId = nanoid();
                const instrumentalId = nanoid();
                setNodes((current) => [
                    ...current,
                    { id: vocalsId, type: CanvasNodeType.Audio, title: `${node.title || "视频"} - 人声`, position: { x: startX, y: startY }, width: spec.width, height: spec.height, metadata: audioMetadata(vocals) },
                    { id: instrumentalId, type: CanvasNodeType.Audio, title: `${node.title || "视频"} - 背景音乐`, position: { x: startX, y: startY + spec.height + gap }, width: spec.width, height: spec.height, metadata: audioMetadata(instrumental) },
                ]);
                setConnections((current) => [
                    ...current,
                    { id: nanoid(), fromNodeId: node.id, toNodeId: vocalsId },
                    { id: nanoid(), fromNodeId: node.id, toNodeId: instrumentalId },
                ]);
                setSelectedNodeIds(new Set([vocalsId, instrumentalId]));
                setSelectedConnectionId(null);
                message.success({ key: messageKey, content: "已分离人声和背景音乐", duration: 2 });
            } catch (error) {
                message.error({ key: messageKey, content: error instanceof Error ? error.message : "音频分离失败", duration: 6 });
            } finally {
                setAudioSeparatingNodeIds((current) => {
                    const next = new Set(current);
                    next.delete(node.id);
                    return next;
                });
            }
        },
        [audioSeparatingNodeIds, message],
    );

    const showVideoFrame = useCallback(
        async (node: CanvasNodeData, role: CanvasVideoFrameRole) => {
            if (node.type !== CanvasNodeType.Video || !node.metadata?.content) return message.error("当前视频为空，无法提取画面");
            const label = role === "first" ? "首帧" : "尾帧";
            const extractionKey = `${node.id}:${role}`;
            if (videoFrameExtractionRef.current.has(extractionKey)) return;
            const existing = nodesRef.current.find((item) => item.type === CanvasNodeType.Image && item.metadata?.videoFrameSourceNodeId === node.id && item.metadata.videoFrameRole === role);
            if (existing?.metadata?.content && node.metadata.storageKey && existing.metadata.videoFrameSourceStorageKey === node.metadata.storageKey) {
                const slot = role === "first" ? 0 : 1;
                setNodes((current) =>
                    current.map((item) =>
                        item.id === existing.id
                            ? { ...item, position: { x: node.position.x + node.width + 96 + slot * (item.width + 20), y: node.position.y + node.height / 2 - item.height / 2 } }
                            : item,
                    ),
                );
                setSelectedNodeIds(new Set([existing.id]));
                setSelectedConnectionId(null);
                return message.success(`已在视频右侧显示${label}`);
            }

            videoFrameExtractionRef.current.add(extractionKey);
            const messageKey = `video-frame-${extractionKey}`;
            message.open({ key: messageKey, type: "loading", content: `正在提取视频${label}`, duration: 0 });
            try {
                const frame = await extractVideoFrame(
                    {
                        url: node.metadata.content,
                        storageKey: node.metadata.storageKey || "",
                        bytes: node.metadata.bytes || 0,
                        mimeType: node.metadata.mimeType || "video/mp4",
                        width: node.metadata.naturalWidth,
                        height: node.metadata.naturalHeight,
                        durationMs: node.metadata.durationMs,
                    },
                    role,
                );
                if (!frame) throw new Error(`视频${label}提取失败`);
                const size = fitNodeSize(frame.width, frame.height);
                const frameNodeId = existing?.id || `image-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                const title = `${node.title || "视频"} - ${label}`;
                const slot = role === "first" ? 0 : 1;
                const metadata: CanvasNodeMetadata = { ...imageMetadata(frame), videoFrameSourceNodeId: node.id, videoFrameSourceStorageKey: node.metadata.storageKey, videoFrameRole: role };
                setNodes((current) => {
                    const hasFrameNode = current.some((item) => item.id === frameNodeId);
                    const next = current.map((item) => {
                        if (item.id === node.id && role === "last") return { ...item, metadata: { ...item.metadata, ...storyboardTailFrameMetadata(frame) } };
                        if (item.id !== frameNodeId) return item;
                        return {
                            ...item,
                            title,
                            position: { x: item.position.x + item.width / 2 - size.width / 2, y: item.position.y + item.height / 2 - size.height / 2 },
                            width: size.width,
                            height: size.height,
                            metadata: { ...item.metadata, ...metadata },
                        };
                    });
                    if (hasFrameNode) return next;
                    return [
                        ...next,
                        {
                            id: frameNodeId,
                            type: CanvasNodeType.Image,
                            title,
                            position: { x: node.position.x + node.width + 96 + slot * (size.width + 20), y: node.position.y + node.height / 2 - size.height / 2 },
                            width: size.width,
                            height: size.height,
                            metadata,
                        },
                    ];
                });
                setSelectedNodeIds(new Set([frameNodeId]));
                setSelectedConnectionId(null);
                message.success({ key: messageKey, content: `已在视频右侧显示${label}`, duration: 2 });
            } catch (error) {
                message.error({ key: messageKey, content: error instanceof Error ? error.message : `视频${label}提取失败`, duration: 6 });
            } finally {
                videoFrameExtractionRef.current.delete(extractionKey);
            }
        },
        [message],
    );

    const saveNodeAsset = useCallback(
        async (node: CanvasNodeData) => {
            if (node.type === CanvasNodeType.Text) {
                const content = node.metadata?.content?.trim();
                if (!content) return message.error("没有可保存的文本");
                addAsset({ kind: "text", title: node.metadata?.prompt?.slice(0, 24) || "画布文本", coverUrl: "", tags: [], source: "Canvas", data: { content }, metadata: { source: "canvas", nodeId: node.id } });
                message.success("已加入我的素材");
                return;
            }
            if (node.type === CanvasNodeType.Video) {
                if (!node.metadata?.content) return message.error("没有可保存的视频");
                addAsset({ kind: "video", title: node.metadata?.prompt?.slice(0, 24) || "画布视频", coverUrl: "", tags: [], source: "Canvas", data: { url: node.metadata.content, storageKey: node.metadata.storageKey, width: node.width, height: node.height, bytes: node.metadata.bytes || 0, mimeType: node.metadata.mimeType || "video/mp4" }, metadata: { source: "canvas", nodeId: node.id, prompt: node.metadata?.prompt } });
                message.success("已加入我的素材");
                return;
            }
            if (!node.metadata?.content) return message.error("没有可保存的图片");
            const dataUrl = node.metadata.storageKey ? "" : node.metadata.content;
            addAsset({
                kind: "image",
                title: node.metadata?.prompt?.slice(0, 24) || "画布图片",
                coverUrl: node.metadata.content,
                tags: [],
                source: "Canvas",
                data: {
                    dataUrl,
                    storageKey: node.metadata.storageKey,
                    width: node.metadata.naturalWidth || node.width,
                    height: node.metadata.naturalHeight || node.height,
                    bytes: node.metadata.bytes || getDataUrlByteSize(dataUrl),
                    mimeType: node.metadata.mimeType || "image/png",
                },
                metadata: { source: "canvas", nodeId: node.id, prompt: node.metadata?.prompt },
            });
            message.success("已加入我的素材");
        },
        [addAsset, message],
    );

    const createImageReversePromptNodes = useCallback(
        (node: CanvasNodeData) => {
            if (node.type !== CanvasNodeType.Image || !node.metadata?.content) {
                message.warning("图片节点为空，无法反推提示词");
                return;
            }

            const gap = 96;
            const textSpec = NODE_DEFAULT_SIZE[CanvasNodeType.Text];
            const configSpec = NODE_DEFAULT_SIZE[CanvasNodeType.Config];
            const centerY = node.position.y + node.height / 2;
            const textNode = {
                ...createCanvasNode(
                    CanvasNodeType.Text,
                    { x: node.position.x + node.width + gap + textSpec.width / 2, y: centerY },
                    { content: IMAGE_PROMPT_REVERSE_PRESET, prompt: IMAGE_PROMPT_REVERSE_PRESET, status: NODE_STATUS_SUCCESS, fontSize: 14 },
                ),
                title: "反推提示词",
            };
            const configNode = {
                ...createCanvasNode(
                    CanvasNodeType.Config,
                    { x: textNode.position.x + textNode.width + gap + configSpec.width / 2, y: centerY },
                    {
                        generationMode: "text",
                        model: effectiveConfig.textModel || effectiveConfig.model || defaultConfig.textModel,
                        count: 1,
                        composerContent: `参考图片：@[node:${node.id}]\n任务说明：@[node:${textNode.id}]`,
                    },
                ),
                title: "反推提示词配置",
            };

            setNodes((prev) => [...prev, textNode, configNode]);
            setConnections((prev) => [
                ...prev,
                { id: nanoid(), fromNodeId: node.id, toNodeId: configNode.id },
                { id: nanoid(), fromNodeId: textNode.id, toNodeId: configNode.id },
            ]);
            setSelectedNodeIds(new Set([configNode.id]));
            setSelectedConnectionId(null);
            setDialogNodeId(configNode.id);
            setContextMenu(null);
        },
        [effectiveConfig.model, effectiveConfig.textModel, message],
    );

    const createImagePresetConfigNode = useCallback(
        (node: CanvasNodeData, preset: CanvasImagePresetId) => {
            if (node.type !== CanvasNodeType.Image || !node.metadata?.content) {
                message.warning("图片节点为空，无法创建预设");
                return;
            }
            const gap = 96;
            const configSpec = NODE_DEFAULT_SIZE[CanvasNodeType.Config];
            const centerY = node.position.y + node.height / 2;
            const configNode = {
                ...createCanvasNode(
                    CanvasNodeType.Config,
                    { x: node.position.x + node.width + gap + configSpec.width / 2, y: centerY },
                    {
                        generationMode: "image",
                        model: effectiveConfig.imageModel || effectiveConfig.model || defaultConfig.model,
                        quality: effectiveConfig.quality,
                        ...buildImagePresetPatch(preset, node.metadata, [{ nodeId: node.id, type: "image", title: node.title, image: { id: node.id, name: `${node.title || node.id}.png`, type: node.metadata.mimeType || "image/png", dataUrl: node.metadata.content, storageKey: node.metadata.storageKey } }]),
                    },
                ),
                title: "九宫格预设",
            };
            setNodes((prev) => [...prev, configNode]);
            setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: configNode.id }]);
            setSelectedNodeIds(new Set([configNode.id]));
            setSelectedConnectionId(null);
            setDialogNodeId(configNode.id);
            setContextMenu(null);
            message.success("已创建预设配置节点");
        },
        [effectiveConfig.imageModel, effectiveConfig.model, effectiveConfig.quality, message],
    );

    const cropImageNode = useCallback(async (node: CanvasNodeData, crop: CanvasImageCropRect) => {
        if (!node.metadata?.content) return;
        const cropped = await cropDataUrl(node.metadata.content, crop);
        const image = await uploadImage(cropped);
        const width = Math.min(node.width, Math.max(220, image.width));
        const childId = nanoid();
        const child: CanvasNodeData = {
            id: childId,
            type: CanvasNodeType.Image,
            title: "Cropped Image",
            position: { x: node.position.x + node.width + 96, y: node.position.y },
            width,
            height: width * (image.height / image.width),
            metadata: {
                ...imageMetadata(image),
                prompt: node.metadata?.prompt,
            },
        };
        setNodes((prev) => [...prev, child]);
        setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
        setSelectedNodeIds(new Set([childId]));
        setDialogNodeId(childId);
        setCropNodeId(null);
    }, []);

    const splitImageNode = useCallback(
        async (node: CanvasNodeData, params: CanvasImageSplitParams) => {
            if (!node.metadata?.content) return;
            setSplitNodeId(null);
            const pieces = await splitDataUrl(node.metadata.content, params);
            const gap = 16;
            const cellWidth = node.width / params.columns;
            const cellHeight = node.height / params.rows;
            const startX = node.position.x + node.width + 96;
            const startY = node.position.y;
            const childNodes = await Promise.all(
                pieces.map(async (piece) => {
                    const image = await uploadImage(piece.dataUrl);
                    const id = nanoid();
                    return {
                        id,
                        type: CanvasNodeType.Image,
                        title: `${node.title || "图片"} ${piece.row + 1}-${piece.column + 1}`,
                        position: { x: startX + piece.column * (cellWidth + gap), y: startY + piece.row * (cellHeight + gap) },
                        width: cellWidth,
                        height: cellHeight,
                        metadata: {
                            ...imageMetadata(image),
                            prompt: node.metadata?.prompt,
                        },
                    } satisfies CanvasNodeData;
                }),
            );
            setNodes((prev) => [...prev, ...childNodes]);
            setConnections((prev) => [...prev, ...childNodes.map((child) => ({ id: nanoid(), fromNodeId: node.id, toNodeId: child.id }))]);
            setSelectedNodeIds(new Set(childNodes.map((child) => child.id)));
            setSelectedConnectionId(null);
            setDialogNodeId(null);
            message.success(`已切分为 ${childNodes.length} 个子节点`);
        },
        [message],
    );

    const maskEditImageNode = useCallback(
        async (node: CanvasNodeData, payload: CanvasImageMaskEditPayload) => {
            if (!node.metadata?.content) return;
            const generationConfig = { ...buildGenerationConfig(effectiveConfig, node, "image"), count: "1", size: node.metadata?.size || "auto" };
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                return;
            }
            const userPrompt = payload.prompt.trim();
            const prompt = `只修改蒙版透明区域，其他区域保持不变。${userPrompt}`;
            const childId = nanoid();
            const source = { id: node.id, name: `${node.title || node.id}.png`, type: node.metadata.mimeType || "image/png", dataUrl: node.metadata.content, storageKey: node.metadata.storageKey };
            const generationMetadata = buildImageGenerationMetadata("edit", generationConfig, 1, [source]);
            setMaskEditNodeId(null);
            setRunningNodeId(childId);
            setNodes((prev) => [
                ...prev,
                {
                    id: childId,
                    type: CanvasNodeType.Image,
                    title: userPrompt.slice(0, 32) || "局部编辑结果",
                    position: { x: node.position.x + node.width + 96, y: node.position.y },
                    width: node.width,
                    height: node.height,
                    metadata: { prompt, status: NODE_STATUS_LOADING, ...generationMetadata },
                },
            ]);
            setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
            setSelectedNodeIds(new Set([childId]));
            setSelectedConnectionId(null);
            setDialogNodeId(childId);
            const controller = startGenerationRequest(childId, node.id, childId);
            try {
                const image = await requestEdit(generationConfig, prompt, [source], { id: `${node.id}-mask`, name: "mask.png", type: "image/png", dataUrl: payload.maskDataUrl }, { signal: controller.signal }).then((items) => items[0]);
                const uploaded = await uploadImage(image.dataUrl);
                const size = fitNodeSize(uploaded.width, uploaded.height, node.width, node.height);
                setNodes((prev) => prev.map((item) => (item.id === childId ? { ...item, width: size.width, height: size.height, metadata: { ...item.metadata, ...imageMetadata(uploaded), prompt, ...generationMetadata } } : item)));
            } catch (error) {
                if (isGenerationCanceled(error)) return;
                const errorDetails = error instanceof Error ? error.message : "局部修改失败";
                message.error(errorDetails);
                setNodes((prev) => prev.map((item) => (item.id === childId ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails } } : item)));
            } finally {
                finishGenerationRequest(childId, controller);
                setRunningNodeId(null);
            }
        },
        [effectiveConfig, finishGenerationRequest, isAiConfigReady, message, openConfigDialog, startGenerationRequest],
    );

    const upscaleImageNode = useCallback(async (node: CanvasNodeData, params: CanvasImageUpscaleParams) => {
        if (!node.metadata?.content) return;
        setUpscaleNodeId(null);
        const upscaled = await upscaleDataUrl(node.metadata.content, params);
        const image = await uploadImage(upscaled);
        const size = fitNodeSize(image.width, image.height);
        const childId = nanoid();
        const child: CanvasNodeData = {
            id: childId,
            type: CanvasNodeType.Image,
            title: "Upscaled Image",
            position: { x: node.position.x + node.width + 96, y: node.position.y },
            width: size.width,
            height: size.height,
            metadata: {
                ...imageMetadata(image),
                prompt: node.metadata?.prompt,
            },
        };
        setNodes((prev) => [...prev, child]);
        setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
        setSelectedNodeIds(new Set([childId]));
        setDialogNodeId(childId);
    }, []);

    const generateAngleNode = useCallback(
        async (node: CanvasNodeData, params: CanvasImageAngleParams) => {
            if (!node.metadata?.content) return;
            const generationConfig = { ...buildGenerationConfig(effectiveConfig, node, "image"), count: "1" };
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                return;
            }
            const childId = nanoid();
            const imageConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
            const title = buildAngleLabel(params);
            const prompt = buildAnglePrompt(params);
            const generationMetadata = buildImageGenerationMetadata("edit", generationConfig, 1, [
                { id: node.id, name: `${node.title || node.id}.png`, type: node.metadata.mimeType || "image/png", dataUrl: node.metadata.content, storageKey: node.metadata.storageKey },
            ]);
            setAngleNodeId(null);
            setRunningNodeId(childId);
            setNodes((prev) => [
                ...prev,
                {
                    id: childId,
                    type: CanvasNodeType.Image,
                    title,
                    position: { x: node.position.x + node.width + 96, y: node.position.y },
                    width: imageConfig.width,
                    height: imageConfig.height,
                    metadata: { prompt, status: NODE_STATUS_LOADING, ...generationMetadata },
                },
            ]);
            setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
            setSelectedNodeIds(new Set([childId]));
            setDialogNodeId(childId);
            const controller = startGenerationRequest(childId, node.id, childId);
            try {
                const image = await requestEdit(generationConfig, prompt, [{ id: node.id, name: `${node.title || node.id}.png`, type: node.metadata.mimeType || "image/png", dataUrl: node.metadata.content, storageKey: node.metadata.storageKey }], undefined, { signal: controller.signal }).then(
                    (items) => items[0],
                );
                const uploaded = await uploadImage(image.dataUrl);
                const size = fitNodeSize(uploaded.width, uploaded.height, imageConfig.width, imageConfig.height);
                setNodes((prev) => prev.map((item) => (item.id === childId ? { ...item, width: size.width, height: size.height, metadata: { ...item.metadata, ...imageMetadata(uploaded), prompt, ...generationMetadata } } : item)));
            } catch (error) {
                if (isGenerationCanceled(error)) return;
                const errorDetails = friendlyGenerationError(error, "生成失败");
                setNodes((prev) => prev.map((item) => (item.id === childId ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails } } : item)));
            } finally {
                finishGenerationRequest(childId, controller);
                setRunningNodeId(null);
            }
        },
        [effectiveConfig, finishGenerationRequest, openConfigDialog, startGenerationRequest],
    );

    const handleFontSizeChange = useCallback((nodeId: string, fontSize: number) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, fontSize } } : node)));
    }, []);

    const handleUploadRequest = useCallback((nodeId?: string, position?: Position) => {
        uploadTargetRef.current = { nodeId, position };
        imageInputRef.current?.click();
    }, []);

    const handleImageInputChange = useCallback(
        async (event: ReactChangeEvent<HTMLInputElement>) => {
            const file = event.target.files?.[0];
            const target = uploadTargetRef.current;
            if (!file || (!file.type.startsWith("image/") && !file.type.startsWith("video/") && !isAudioFile(file))) return;

            if (target?.nodeId) {
                if (isAudioFile(file)) {
                    const audio = await uploadMediaFile(file, "audio");
                    const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Audio];
                    setNodes((prev) => prev.map((node) => (node.id === target.nodeId ? { ...node, type: CanvasNodeType.Audio, title: file.name, position: { x: node.position.x + node.width / 2 - spec.width / 2, y: node.position.y + node.height / 2 - spec.height / 2 }, width: spec.width, height: spec.height, metadata: { ...node.metadata, ...audioMetadata(audio), errorDetails: undefined } } : node)));
                    setSelectedNodeIds(new Set([target.nodeId]));
                    setSelectedConnectionId(null);
                    uploadTargetRef.current = null;
                    event.target.value = "";
                    return;
                }
                if (file.type.startsWith("video/")) {
                    const video = await uploadMediaFile(file, "video");
                    const nextSize = fitNodeSize(video.width || 1280, video.height || 720, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                    setNodes((prev) => prev.map((node) => (node.id === target.nodeId ? { ...node, type: CanvasNodeType.Video, title: file.name, position: { x: node.position.x + node.width / 2 - nextSize.width / 2, y: node.position.y + node.height / 2 - nextSize.height / 2 }, width: nextSize.width, height: nextSize.height, metadata: { ...node.metadata, ...videoMetadata(video), errorDetails: undefined } } : node)));
                    setSelectedNodeIds(new Set([target.nodeId]));
                    setSelectedConnectionId(null);
                    setDialogNodeId(target.nodeId);
                    uploadTargetRef.current = null;
                    event.target.value = "";
                    return;
                }
                const image = await uploadImage(file);
                const size = fitNodeSize(image.width, image.height);
                setNodes((prev) =>
                    prev.map((node) =>
                        node.id === target.nodeId
                            ? {
                                  ...node,
                                  type: CanvasNodeType.Image,
                                  title: file.name,
                                  width: size.width,
                                  height: size.height,
                                  metadata: {
                                      ...node.metadata,
                                      ...imageMetadata(image),
                                      errorDetails: undefined,
                                      freeResize: false,
                                      isBatchRoot: undefined,
                                      batchRootId: undefined,
                                      batchChildIds: undefined,
                                      batchUsesReferenceImages: undefined,
                                      generationType: undefined,
                                      model: undefined,
                                      size: undefined,
                                      quality: undefined,
                                      count: undefined,
                                      references: undefined,
                                      primaryImageId: undefined,
                                      imageBatchExpanded: undefined,
                                  },
                              }
                            : node,
                    ),
                );
                setSelectedNodeIds(new Set([target.nodeId]));
                setSelectedConnectionId(null);
                setDialogNodeId(target.nodeId);
            } else {
                const position = target?.position || screenToCanvas((containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2, (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2);
                void (isAudioFile(file) ? createAudioFileNode(file, position) : file.type.startsWith("video/") ? createVideoFileNode(file, position) : createImageFileNode(file, position));
            }

            uploadTargetRef.current = null;
            event.target.value = "";
        },
        [createAudioFileNode, createImageFileNode, createVideoFileNode, screenToCanvas, size.height, size.width],
    );

    const handleDrop = useCallback(
        (event: ReactDragEvent<HTMLDivElement>) => {
            event.preventDefault();
            const file = Array.from(event.dataTransfer.files).find((item) => item.type.startsWith("image/") || item.type.startsWith("video/") || isAudioFile(item));
            if (!file) return;

            const pos = screenToCanvas(event.clientX, event.clientY);
            void (isAudioFile(file) ? createAudioFileNode(file, pos) : file.type.startsWith("video/") ? createVideoFileNode(file, pos) : createImageFileNode(file, pos));
        },
        [createAudioFileNode, createImageFileNode, createVideoFileNode, screenToCanvas],
    );

    const startTitleEditing = useCallback(() => {
        setTitleDraft(currentProject?.title || "未命名画布");
        setTitleEditing(true);
    }, [currentProject?.title]);

    const finishTitleEditing = useCallback(() => {
        const nextTitle = titleDraft.trim();
        if (nextTitle) renameProject(projectId, nextTitle);
        setTitleEditing(false);
    }, [projectId, renameProject, titleDraft]);

    const preventCanvasContextMenu = useCallback((event: ReactMouseEvent) => {
        const target = event.target as HTMLElement;
        if (target.closest("[data-node-id],[data-connection-id],[data-connection-create-menu],.ant-modal,.ant-popover,.ant-dropdown,.ant-select-dropdown")) return;
        event.preventDefault();
        setContextMenu({ type: "canvas", x: event.clientX, y: event.clientY, position: screenToCanvas(event.clientX, event.clientY) });
    }, [screenToCanvas]);

    const canvasContextMenuActions = useMemo<CanvasContextMenuAction[]>(() => {
        if (contextMenu?.type !== "canvas") return [];
        const position = contextMenu.position;
        const selectedNode = selectedNodeIds.size === 1 ? nodeById.get(Array.from(selectedNodeIds)[0]) || null : null;
        const canSaveAsset = Boolean(
            selectedNode &&
                ((selectedNode.type === CanvasNodeType.Text && selectedNode.metadata?.content?.trim()) ||
                    ((selectedNode.type === CanvasNodeType.Image || selectedNode.type === CanvasNodeType.Video) && selectedNode.metadata?.content)),
        );
        return [
            { id: "upload", label: "上传", onClick: () => handleUploadRequest(undefined, position) },
            { id: "save-asset", label: "保存到我的资产", disabled: !canSaveAsset, onClick: () => selectedNode && void saveNodeAsset(selectedNode) },
            {
                id: "add-node",
                label: "添加节点",
                onClick: () => undefined,
                children: [
                    { id: "add-text", label: "文本", icon: <Type className="size-4" />, onClick: () => createNode(CanvasNodeType.Text, position) },
                    { id: "add-script", label: "Script", icon: <FileText className="size-4" />, onClick: () => createNode(CanvasNodeType.Script, position) },
                    { id: "add-image", label: "图片", icon: <ImageIcon className="size-4" />, onClick: () => createNode(CanvasNodeType.Image, position) },
                    { id: "add-video", label: "视频", icon: <Video className="size-4" />, onClick: () => createNode(CanvasNodeType.Video, position) },
                    { id: "add-audio", label: "音频", icon: <Music2 className="size-4" />, onClick: () => createNode(CanvasNodeType.Audio, position) },
                    { id: "add-config", label: "生成配置", icon: <Settings2 className="size-4" />, onClick: () => createNode(CanvasNodeType.Config, position) },
                    { id: "import-card", label: "导入角色卡", icon: <FileInput className="size-4" />, dividerBefore: true, onClick: handleMangaCardImportRequest },
                    { id: "import-storyboard", label: "导入分镜", icon: <FileInput className="size-4" />, onClick: handleMangaStoryboardImportRequest },
                    { id: "import-scene-360", label: "导入360场景", icon: <Grid2x2 className="size-4" />, onClick: handleScene360ImportRequest },
                    { id: "upload-media", label: "上传素材", icon: <Upload className="size-4" />, onClick: () => handleUploadRequest(undefined, position) },
                    { id: "open-assets", label: "我的素材", icon: <FolderOpen className="size-4" />, dividerBefore: true, onClick: () => setAssetPickerOpen(true) },
                    {
                        id: "open-director-desk",
                        label: "3D导演台",
                        icon: <Clapperboard className="size-4" />,
                        onClick: () => {
                            setLastDirectorDeskCanvasId(projectId);
                            navigate(`/director-desk?canvasId=${encodeURIComponent(projectId)}&returnTo=${encodeURIComponent(`/canvas/${projectId}`)}`);
                        },
                    },
                ],
            },
            { id: "undo", label: "撤销", shortcut: "⌘Z", disabled: !historyState.canUndo, dividerBefore: true, onClick: undoCanvas },
            { id: "redo", label: "重做", shortcut: "⇧⌘Z", disabled: !historyState.canRedo, onClick: redoCanvas },
            {
                id: "paste",
                label: "粘贴",
                shortcut: "⌘V",
                dividerBefore: true,
                onClick: () => {
                    if (!pasteCopiedNodes(position)) void pasteSystemClipboard(position);
                },
            },
        ];
    }, [contextMenu, createNode, handleMangaCardImportRequest, handleMangaStoryboardImportRequest, handleScene360ImportRequest, handleUploadRequest, historyState.canRedo, historyState.canUndo, navigate, nodeById, pasteCopiedNodes, pasteSystemClipboard, projectId, redoCanvas, saveNodeAsset, selectedNodeIds, undoCanvas]);

    const handleGenerateNode = useCallback(
        async (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string, options?: { useCurrentImageAsReference?: boolean }) => {
            const sourceNode = nodesRef.current.find((node) => node.id === nodeId);
            if (sourceNode?.type === CanvasNodeType.Script) {
                await generateStoryboardShotsFromInputs(sourceNode);
                return;
            }
            const generationConfig = buildGenerationConfig(effectiveConfig, sourceNode, mode);
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                return;
            }

            const builtinPanel = sourceNode ? getNodeDefinition(sourceNode.type)?.useBuiltinPanel : undefined;
            if (sourceNode && builtinPanel?.writeBackToSelf && builtinPanel.mode === "image") {
                const scene = prompt.trim();
                if (!scene) return;
                setRunningNodeId(nodeId);
                const controller = startGenerationRequest(nodeId, nodeId, nodeId);
                setNodes((current) => current.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, prompt: scene, status: NODE_STATUS_LOADING, errorDetails: undefined } } : node)));
                try {
                    const fullPrompt = `${builtinPanel.promptPrefix || ""}${scene}`;
                    const references = connectionsRef.current
                        .filter((connection) => connection.toNodeId === nodeId)
                        .map((connection) => nodesRef.current.find((node) => node.id === connection.fromNodeId))
                        .filter((node): node is CanvasNodeData => Boolean(node?.metadata?.content && node.type !== sourceNode.type))
                        .map((node) => ({ id: node.id, name: `${node.title || node.id}.png`, type: node.metadata?.mimeType || "image/png", dataUrl: node.metadata?.content || "", storageKey: node.metadata?.storageKey }));
                    const image = references.length
                        ? await requestEdit({ ...generationConfig, count: "1" }, fullPrompt, references, undefined, { signal: controller.signal }).then((items) => items[0])
                        : await requestGeneration({ ...generationConfig, count: "1" }, fullPrompt, { signal: controller.signal }).then((items) => items[0]);
                    const uploaded = await uploadImage(image.dataUrl);
                    setNodes((current) => current.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, ...imageMetadata(uploaded), prompt: scene, model: generationConfig.model, status: NODE_STATUS_SUCCESS, errorDetails: undefined } } : node)));
                    setDialogNodeId(null);
                } catch (error) {
                    if (!isGenerationCanceled(error)) {
                        const errorDetails = error instanceof Error ? error.message : "生成失败";
                        message.error(errorDetails);
                        setNodes((current) => current.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, errorDetails } } : node)));
                    }
                } finally {
                    finishGenerationRequest(nodeId, controller);
                    setRunningNodeId(null);
                }
                return;
            }

            setRunningNodeId(nodeId);
            const runController = startGenerationRequest(nodeId, nodeId, nodeId);
            const sourceTextContent = sourceNode?.type === CanvasNodeType.Text ? sourceNode.metadata?.content?.trim() || "" : "";
            const editingTextNode = mode === "text" && sourceNode?.type === CanvasNodeType.Text && Boolean(sourceTextContent);
            const basePrompt = prompt;
            const generationContext = await hydrateNodeGenerationContext(
                buildNodeGenerationContext(nodeId, nodesRef.current, connectionsRef.current, editingTextNode ? `请根据要求修改以下文本。\n\n原文：\n${sourceTextContent}\n\n修改要求：\n${prompt}` : basePrompt),
            );
            const effectivePrompt = generationContext.prompt.trim();
            if (runController.signal.aborted) {
                finishGenerationRequest(nodeId, runController);
                setRunningNodeId(null);
                return;
            }
            let videoConfirmation: Awaited<ReturnType<typeof confirmVideoGeneration>> = false;
            if (mode === "video") {
                videoConfirmation = await confirmVideoGeneration({ config: generationConfig, prompt: effectivePrompt, references: generationContext.referenceImages, videoReferences: generationContext.referenceVideos, audioReferences: generationContext.referenceAudios });
                if (!videoConfirmation || runController.signal.aborted) {
                    finishGenerationRequest(nodeId, runController);
                    setRunningNodeId(null);
                    return;
                }
            }
            const generatingFromCompletedVideo = mode === "video" && sourceNode?.type === CanvasNodeType.Video && Boolean(sourceNode.metadata?.content);
            const markSourceStatus = sourceNode?.type !== CanvasNodeType.Image && !generatingFromCompletedVideo && !editingTextNode;
            const statusPrompt = sourceNode?.type === CanvasNodeType.Config ? effectivePrompt : prompt;
            if (!effectivePrompt && (mode === "text" || mode === "audio")) {
                finishGenerationRequest(nodeId, runController);
                setRunningNodeId(null);
                return;
            }
            let pendingChildIds: string[] = [];
            if (markSourceStatus) setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, prompt: statusPrompt, status: NODE_STATUS_LOADING, errorDetails: undefined } } : node)));

            try {
                if (mode === "image") {
                    const isConfigNode = sourceNode?.type === CanvasNodeType.Config;
                    const isImageNode = sourceNode?.type === CanvasNodeType.Image;
                    const isEmptyImageNode = isImageNode && !sourceNode?.metadata?.content;
                    const shouldUseCurrentImageAsReference = Boolean(options?.useCurrentImageAsReference || (isImageNode && sourceNode?.metadata?.content && !sourceNode.metadata?.generationType));
                    let restoredReferenceImages: ReferenceImage[] | undefined;
                    if (isImageNode && sourceNode?.metadata?.generationType && !options?.useCurrentImageAsReference) {
                        const restored = await resolveMetadataReferences(sourceNode.metadata);
                        if (restored === null) {
                            message.error("原始参考图已丢失，无法重新生成；可以点“续修”改为基于当前图继续修改");
                            finishGenerationRequest(nodeId, runController);
                            setRunningNodeId(null);
                            return;
                        }
                        restoredReferenceImages = restored;
                    }
                    const sourceReference =
                        shouldUseCurrentImageAsReference && sourceNode?.metadata?.content
                            ? [{ id: sourceNode.id, name: `${sourceNode.title || sourceNode.id}.png`, type: sourceNode.metadata.mimeType || "image/png", dataUrl: sourceNode.metadata.content, storageKey: sourceNode.metadata.storageKey }]
                            : [];
                    const referenceImages = restoredReferenceImages !== undefined ? restoredReferenceImages : sourceReference.length ? sourceReference : generationContext.referenceImages;
                    const generationType = referenceImages.length ? ("edit" as const) : ("generation" as const);
                    const useMultiViewGrid = generationType === "generation" && shouldUseMultiViewGrid(effectivePrompt, sourceNode?.metadata);
                    const characterReferencePrompts = isConfigNode ? (sourceNode.metadata?.characterReferenceVariantPrompts || []).map((item) => item.trim()).filter(Boolean) : [];
                    const characterReferenceTitles = isConfigNode ? sourceNode.metadata?.characterReferenceVariantTitles || [] : [];
                    const baseRequestPrompt = useMultiViewGrid ? prepareMultiViewPrompt(effectivePrompt) : characterReferencePrompts[0] || effectivePrompt;
                    const requestPrompt = baseRequestPrompt;
                    const requestPrompts = characterReferencePrompts.length ? characterReferencePrompts : [requestPrompt];
                    const requestConfig = useMultiViewGrid ? { ...generationConfig, count: "1", size: "16:9" } : generationConfig;
                    const count = useMultiViewGrid ? 1 : characterReferencePrompts.length || getGenerationCount(generationConfig.count);
                    const generationMetadata = buildImageGenerationMetadata(generationType, requestConfig, count, referenceImages);
                    const parentConfig = NODE_DEFAULT_SIZE[isConfigNode ? CanvasNodeType.Config : isImageNode ? CanvasNodeType.Image : CanvasNodeType.Text];
                    const imageConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
                    const parentPosition = sourceNode?.position || { x: 0, y: 0 };
                    const gap = 96;
                    const rowGap = 36;
                    const rootId = isEmptyImageNode ? nodeId : nanoid();
                    const childIds = count > 1 ? Array.from({ length: count }, () => nanoid()) : [];
                    const targetIds = count > 1 ? childIds : [rootId];
                    pendingChildIds = isEmptyImageNode ? childIds : [rootId, ...childIds];
                    const sceneViewTitle = sourceNode?.metadata?.storyboardAssetName && sourceNode.metadata.sceneViewRole ? storyboardSceneViewMention(sourceNode.metadata.storyboardAssetName, sourceNode.metadata.sceneViewRole).replace(/^@/, "") : "";
                    const rootNode: CanvasNodeData = {
                        id: rootId,
                        type: CanvasNodeType.Image,
                        title: sceneViewTitle || characterReferenceTitles[0] || effectivePrompt.slice(0, 32) || "Generated Image",
                        position: {
                            x: isEmptyImageNode ? parentPosition.x : parentPosition.x + parentConfig.width + gap,
                            y: parentPosition.y + parentConfig.height / 2 - imageConfig.height / 2,
                        },
                        width: isEmptyImageNode ? sourceNode?.width || imageConfig.width : imageConfig.width,
                        height: isEmptyImageNode ? sourceNode?.height || imageConfig.height : imageConfig.height,
                        metadata: {
                            prompt: requestPrompts[0] || requestPrompt,
                            sourcePrompt: useMultiViewGrid ? effectivePrompt : undefined,
                            multiViewRole: useMultiViewGrid ? "grid" : undefined,
                            sceneViewRole: sourceNode?.metadata?.sceneViewRole,
                            sceneGroupId: sourceNode?.metadata?.sceneGroupId,
                            storyboardSourceNodeId: sourceNode?.metadata?.storyboardSourceNodeId,
                            storyboardAssetId: sourceNode?.metadata?.storyboardAssetId,
                            storyboardAssetKind: sourceNode?.metadata?.storyboardAssetKind,
                            storyboardAssetName: sourceNode?.metadata?.storyboardAssetName,
                            status: NODE_STATUS_LOADING,
                            isBatchRoot: count > 1,
                            batchChildIds: count > 1 ? childIds : undefined,
                            batchUsesReferenceImages: referenceImages.length > 0,
                            ...generationMetadata,
                            imageBatchExpanded: count > 1 ? true : undefined,
                        },
                    };
                    const childNodes: CanvasNodeData[] = childIds.map((id, index) => ({
                        id,
                        type: CanvasNodeType.Image,
                        title: sceneViewTitle || characterReferenceTitles[index] || effectivePrompt.slice(0, 32) || "Generated Image",
                        position: {
                            x: rootNode.position.x + rootNode.width + 120 + (index % 2) * (imageConfig.width + 36),
                            y: rootNode.position.y + Math.floor(index / 2) * (imageConfig.height + rowGap),
                        },
                        width: imageConfig.width,
                        height: imageConfig.height,
                        metadata: {
                            prompt: requestPrompts[index] || requestPrompt,
                            sourcePrompt: useMultiViewGrid ? effectivePrompt : undefined,
                            sceneViewRole: sourceNode?.metadata?.sceneViewRole,
                            sceneGroupId: sourceNode?.metadata?.sceneGroupId,
                            storyboardSourceNodeId: sourceNode?.metadata?.storyboardSourceNodeId,
                            storyboardAssetId: sourceNode?.metadata?.storyboardAssetId,
                            storyboardAssetKind: sourceNode?.metadata?.storyboardAssetKind,
                            storyboardAssetName: sourceNode?.metadata?.storyboardAssetName,
                            status: NODE_STATUS_LOADING,
                            batchRootId: count > 1 ? rootId : undefined,
                            characterReferenceRole: characterReferenceTitles[index],
                            ...generationMetadata,
                        },
                    }));
                    const restoredReferenceSourceNodes = restoredReferenceImages?.length ? findReferenceSourceNodes(sourceNode?.metadata?.references || [], nodesRef.current) : [];
                    const shouldConnectCurrentNode = !isImageNode || shouldUseCurrentImageAsReference || !sourceNode?.metadata?.generationType;
                    const rootInputConnections = isEmptyImageNode
                        ? []
                        : restoredReferenceSourceNodes.length
                          ? restoredReferenceSourceNodes.map((referenceNode) => ({ id: nanoid(), fromNodeId: referenceNode.id, toNodeId: rootId }))
                          : shouldConnectCurrentNode
                            ? [{ id: nanoid(), fromNodeId: nodeId, toNodeId: rootId }]
                            : [];
                    const batchConnections = [...rootInputConnections, ...childIds.map((childId) => ({ id: nanoid(), fromNodeId: rootId, toNodeId: childId }))];

                    setNodes((prev) => [
                        ...prev.map((node) =>
                            node.id === nodeId
                                ? isConfigNode
                                    ? {
                                          ...node,
                                          metadata: { ...node.metadata, prompt: requestPrompt, sourcePrompt: useMultiViewGrid ? effectivePrompt : undefined, sceneViewRole: sourceNode?.metadata?.sceneViewRole, sceneGroupId: sourceNode?.metadata?.sceneGroupId, status: NODE_STATUS_LOADING, errorDetails: undefined },
                                      }
                                    : isEmptyImageNode
                                      ? {
                                            ...node,
                                            position: rootNode.position,
                                            width: rootNode.width,
                                            height: rootNode.height,
                                            title: rootNode.title,
                                            metadata: { ...node.metadata, ...rootNode.metadata, errorDetails: undefined },
                                        }
                                      : isImageNode
                                        ? {
                                              ...node,
                                              metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS, errorDetails: undefined },
                                          }
                                        : {
                                              ...node,
                                              type: CanvasNodeType.Text,
                                              title: prompt.slice(0, 32) || "Prompt",
                                              width: parentConfig.width,
                                              height: parentConfig.height,
                                              metadata: { ...node.metadata, content: prompt, prompt, status: NODE_STATUS_SUCCESS, fontSize: 14, errorDetails: undefined },
                                          }
                                : node,
                        ),
                        ...(isEmptyImageNode ? [] : [rootNode]),
                        ...childNodes,
                    ]);
                    setConnections((prev) => [...prev, ...batchConnections]);
                    setSelectedNodeIds(new Set([nodeId]));
                    setSelectedConnectionId(null);
                    setDialogNodeId(nodeId);

                    const controller = runController;
                    if (useMultiViewGrid) {
                        startGenerationRequest(rootId, nodeId, nodeId, controller);
                        try {
                            const image = await requestGeneration(requestConfig, requestPrompt, { signal: controller.signal }).then((items) => items[0]);
                            const uploaded = await uploadImage(image.dataUrl);
                            const imageSize = fitNodeSize(uploaded.width, uploaded.height, imageConfig.width, imageConfig.height);
                            const rootCenter = { x: rootNode.position.x + rootNode.width / 2, y: rootNode.position.y + rootNode.height / 2 };
                            const renderedRootNode = {
                                ...rootNode,
                                position: { x: rootCenter.x - imageSize.width / 2, y: rootCenter.y - imageSize.height / 2 },
                                width: imageSize.width,
                                height: imageSize.height,
                                metadata: { ...rootNode.metadata, ...imageMetadata(uploaded), status: NODE_STATUS_SUCCESS, errorDetails: undefined },
                            };
                            const viewNodes: CanvasNodeData[] = await Promise.all(
                                MULTI_VIEW_NODE_SPECS.map(async (spec) => ({
                                    id: nanoid(),
                                    type: CanvasNodeType.Image,
                                    title: `${renderedRootNode.title}_${spec.label}`,
                                    position: {
                                        x: renderedRootNode.position.x + renderedRootNode.width + 72 + spec.x,
                                        y: renderedRootNode.position.y + spec.y,
                                    },
                                    width: spec.width,
                                    height: spec.height,
                                    metadata: {
                                        ...imageMetadata(uploaded),
                                        content: await cropDataUrl(uploaded.url, spec.crop),
                                        prompt: effectivePrompt,
                                        sourcePrompt: effectivePrompt,
                                        status: NODE_STATUS_SUCCESS,
                                        multiViewRole: spec.key as MultiViewNodeType,
                                        multiViewSourceNodeId: renderedRootNode.id,
                                        primaryImageId: renderedRootNode.id,
                                        naturalWidth: spec.width,
                                        naturalHeight: spec.height,
                                    },
                                })),
                            );
                            setNodes((prev) => [...prev.map((node) => (node.id === rootId ? renderedRootNode : node.id === nodeId && isConfigNode ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS, errorDetails: undefined } } : node)), ...viewNodes]);
                            setConnections((prev) => [...prev, ...viewNodes.map((viewNode) => ({ id: nanoid(), fromNodeId: renderedRootNode.id, toNodeId: viewNode.id }))]);
                        } finally {
                            finishGenerationRequest(rootId, controller);
                        }
                        return;
                    }

                    targetIds.forEach((targetId) => startGenerationRequest(targetId, nodeId, nodeId, controller));
                    if (count > 1) startGenerationRequest(rootId, nodeId, nodeId, controller);
                    let hasSuccess = false;
                    let hasFailure = false;
                    let lastErrorDetails = "";
                    await Promise.all(
                        targetIds.map(async (targetId, index) => {
                            try {
                                let image;
                                const targetPrompt = requestPrompts[index] || requestPrompt;
                                try {
                                    image = referenceImages.length
                                        ? await requestEdit({ ...requestConfig, count: "1" }, targetPrompt, referenceImages, undefined, { signal: controller.signal }).then((items) => items[0])
                                        : await requestGeneration({ ...requestConfig, count: "1" }, targetPrompt, { signal: controller.signal }).then((items) => items[0]);
                                } catch (error) {
                                    if (!referenceImages.length || sourceNode?.metadata?.imagePreset !== "character_sheet" || isGenerationCanceled(error)) throw error;
                                    image = await requestGeneration({ ...requestConfig, count: "1" }, targetPrompt, { signal: controller.signal }).then((items) => items[0]);
                                }
                                const uploaded = await uploadImage(image.dataUrl);
                                const imageSize = fitNodeSize(uploaded.width, uploaded.height, imageConfig.width, imageConfig.height);
                                setNodes((prev) => {
                                    const root = prev.find((node) => node.id === rootId);
                                    return prev.map((node) => {
                                        if (node.id !== targetId && node.id !== rootId) return node;
                                        const center = { x: node.position.x + node.width / 2, y: node.position.y + node.height / 2 };
                                        if (node.id === rootId && (targetId === rootId || !root?.metadata?.primaryImageId))
                                            return {
                                                ...node,
                                                position: { x: center.x - imageSize.width / 2, y: center.y - imageSize.height / 2 },
                                                width: imageSize.width,
                                                height: imageSize.height,
                                                metadata: { ...node.metadata, ...imageMetadata(uploaded), prompt: targetPrompt, sourcePrompt: useMultiViewGrid ? effectivePrompt : undefined, sceneViewRole: sourceNode?.metadata?.sceneViewRole, sceneGroupId: sourceNode?.metadata?.sceneGroupId, primaryImageId: targetId },
                                            };
                                        if (node.id === targetId)
                                            return {
                                                ...node,
                                                position: { x: center.x - imageSize.width / 2, y: center.y - imageSize.height / 2 },
                                                width: imageSize.width,
                                                height: imageSize.height,
                                                metadata: { ...node.metadata, ...imageMetadata(uploaded), prompt: targetPrompt, sourcePrompt: useMultiViewGrid ? effectivePrompt : undefined, sceneViewRole: sourceNode?.metadata?.sceneViewRole, sceneGroupId: sourceNode?.metadata?.sceneGroupId },
                                            };
                                        return node;
                                    });
                                });
                                hasSuccess = true;
                                if (isConfigNode) setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS, errorDetails: undefined } } : node)));
                                return true;
                            } catch (error) {
                                if (isGenerationCanceled(error)) return false;
                                const errorDetails = error instanceof Error ? error.message : "生成失败";
                                hasFailure = true;
                                lastErrorDetails = errorDetails;
                                setNodes((prev) => prev.map((node) => (node.id === targetId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, errorDetails } } : node)));
                            } finally {
                                finishGenerationRequest(targetId, controller);
                            }
                            return false;
                        }),
                    );
                    if (count > 1) finishGenerationRequest(rootId, controller);
                    if (controller.signal.aborted) {
                        setNodes((prev) => prev.map((node) => (node.id === nodeId && isConfigNode && node.metadata?.status === NODE_STATUS_LOADING ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_IDLE, errorDetails: undefined } } : node)));
                        return;
                    }
                    if (hasFailure) message.error(hasSuccess ? "部分图片生成失败" : lastErrorDetails || "全部图片生成失败");
                    setNodes((prev) =>
                        prev.map((node) =>
                            node.id === nodeId && isConfigNode
                                ? { ...node, metadata: { ...node.metadata, status: hasSuccess ? NODE_STATUS_SUCCESS : NODE_STATUS_ERROR, errorDetails: hasSuccess ? undefined : lastErrorDetails || "全部图片生成失败" } }
                                : node.id === nodeId && isEmptyImageNode
                                  ? { ...node, metadata: { ...node.metadata, status: hasSuccess ? NODE_STATUS_SUCCESS : NODE_STATUS_ERROR, errorDetails: hasSuccess ? undefined : lastErrorDetails || "全部图片生成失败" } }
                                  : node.id === rootId && !hasSuccess
                                    ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, errorDetails: lastErrorDetails || "全部图片生成失败" } }
                                    : node,
                        ),
                    );
                    return;
                }

                if (mode === "video") {
                    const spec = nodeSizeFromRatio(generationConfig.size, NODE_DEFAULT_SIZE[CanvasNodeType.Video].width, NODE_DEFAULT_SIZE[CanvasNodeType.Video].height) || NODE_DEFAULT_SIZE[CanvasNodeType.Video];
                    const isEmptyVideoNode = sourceNode?.type === CanvasNodeType.Video && !sourceNode.metadata?.content;
                    const videoReferenceImages = generationContext.referenceImages;
                    const videoId = isEmptyVideoNode ? nodeId : nanoid();
                    const parent = sourceNode?.position || { x: 0, y: 0 };
                    const videoNode: CanvasNodeData = {
                        id: videoId,
                        type: CanvasNodeType.Video,
                        title: effectivePrompt.slice(0, 32) || "Generated Video",
                        position: isEmptyVideoNode ? sourceNode.position : { x: parent.x + (sourceNode?.width || spec.width) + 96, y: parent.y },
                        width: isEmptyVideoNode ? sourceNode.width : spec.width,
                        height: isEmptyVideoNode ? sourceNode.height : spec.height,
                        metadata: { prompt: effectivePrompt, status: NODE_STATUS_LOADING, model: generationConfig.model, size: generationConfig.size, seconds: generationConfig.videoSeconds, vquality: generationConfig.vquality, generateAudio: generationConfig.videoGenerateAudio, watermark: generationConfig.videoWatermark, references: generationReferenceUrls({ ...generationContext, referenceImages: videoReferenceImages }), videoGenerationProgress: initialVideoGenerationProgress() },
                    };
                    pendingChildIds = [videoId];
                    setNodes((prev) => (isEmptyVideoNode ? prev.map((node) => (node.id === nodeId ? { ...node, ...videoNode } : node)) : [...prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS } } : node)), videoNode]));
                    if (!isEmptyVideoNode) setConnections((prev) => addUniqueConnections(prev, nextVideoInputConnections(sourceNode, videoId, prev)));
                    const controller = startGenerationRequest(videoId, nodeId, nodeId, runController);
                    try {
                        const video = await storeGeneratedVideo(
                            await requestVideoGeneration(generationConfig, effectivePrompt, videoReferenceImages, generationContext.referenceVideos, generationContext.referenceAudios, {
                                signal: controller.signal,
                                apimartAvatarMode: videoConfirmation?.apimartAvatarMode,
                                apimartOmniElements: videoConfirmation?.apimartOmniElements,
                                onTaskCreated: (task) => setNodes((prev) => prev.map((node) => (node.id === videoId ? { ...node, metadata: { ...node.metadata, ...videoTaskMetadata(task) } } : node))),
                                onProgress: (progress) => setNodes((prev) => prev.map((node) => (node.id === videoId ? { ...node, metadata: { ...node.metadata, videoGenerationProgress: progress } } : node))),
                            }),
                        );
                        const videoSize = fitNodeSize(video.width || spec.width, video.height || spec.height, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                        setNodes((prev) => prev.map((node) => (node.id === videoId ? { ...node, width: videoSize.width, height: videoSize.height, position: { x: node.position.x + node.width / 2 - videoSize.width / 2, y: node.position.y + node.height / 2 - videoSize.height / 2 }, metadata: { ...node.metadata, ...videoMetadata(video), prompt: effectivePrompt, model: generationConfig.model, size: generationConfig.size, seconds: generationConfig.videoSeconds, vquality: generationConfig.vquality, generateAudio: generationConfig.videoGenerateAudio, watermark: generationConfig.videoWatermark, references: generationReferenceUrls({ ...generationContext, referenceImages: videoReferenceImages }), videoGenerationProgress: undefined } } : node)));
                    } finally {
                        finishGenerationRequest(videoId, controller);
                    }
                    return;
                }

                if (mode === "audio") {
                    const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Audio];
                    const isEmptyAudioNode = sourceNode?.type === CanvasNodeType.Audio && !sourceNode.metadata?.content;
                    const audioId = isEmptyAudioNode ? nodeId : nanoid();
                    const parent = sourceNode?.position || { x: 0, y: 0 };
                    const audioNode: CanvasNodeData = {
                        id: audioId,
                        type: CanvasNodeType.Audio,
                        title: effectivePrompt.slice(0, 32) || "Generated Audio",
                        position: isEmptyAudioNode ? sourceNode.position : { x: parent.x + (sourceNode?.width || spec.width) + 96, y: parent.y + ((sourceNode?.height || spec.height) - spec.height) / 2 },
                        width: isEmptyAudioNode ? sourceNode.width : spec.width,
                        height: isEmptyAudioNode ? sourceNode.height : spec.height,
                        metadata: { prompt: effectivePrompt, status: NODE_STATUS_LOADING, ...buildAudioGenerationMetadata(generationConfig) },
                    };
                    pendingChildIds = [audioId];
                    setNodes((prev) => (isEmptyAudioNode ? prev.map((node) => (node.id === nodeId ? { ...node, ...audioNode } : node)) : [...prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS } } : node)), audioNode]));
                    if (!isEmptyAudioNode) setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: nodeId, toNodeId: audioId }]);
                    const controller = startGenerationRequest(audioId, nodeId, nodeId, runController);
                    try {
                        const audio = await requestStoredAudioGeneration(generationConfig, effectivePrompt, { signal: controller.signal, referenceAudios: generationContext.referenceAudios });
                        setNodes((prev) => prev.map((node) => (node.id === audioId ? { ...node, metadata: { ...node.metadata, ...audioMetadata(audio), prompt: effectivePrompt, ...buildAudioGenerationMetadata(generationConfig) } } : node)));
                    } finally {
                        finishGenerationRequest(audioId, controller);
                    }
                    return;
                }

                let streamed = "";
                const isConfigNode = sourceNode?.type === CanvasNodeType.Config;
                const textCount = isConfigNode ? getGenerationCount(generationConfig.count) : 1;
                const parentConfig = NODE_DEFAULT_SIZE[isConfigNode ? CanvasNodeType.Config : CanvasNodeType.Text];
                const textConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Text];
                const parentPosition = sourceNode?.position || { x: 0, y: 0 };
                const childIds = isConfigNode || editingTextNode ? Array.from({ length: textCount }, () => nanoid()) : [];
                pendingChildIds = childIds;
                if (isConfigNode || editingTextNode) {
                    const childNodes: CanvasNodeData[] = childIds.map((id, index) => ({
                        id,
                        type: CanvasNodeType.Text,
                        title: effectivePrompt.slice(0, 32) || "Generated Text",
                        position: {
                            x: parentPosition.x + parentConfig.width + 96,
                            y: parentPosition.y + parentConfig.height / 2 - textConfig.height / 2 + (index - (textCount - 1) / 2) * (textConfig.height + 36),
                        },
                        width: textConfig.width,
                        height: textConfig.height,
                        metadata: { prompt: effectivePrompt, status: NODE_STATUS_LOADING, fontSize: 14 },
                    }));
                    setNodes((prev) => [...prev.map((node) => (node.id === nodeId && isConfigNode ? { ...node, metadata: { ...node.metadata, prompt: effectivePrompt, status: NODE_STATUS_LOADING, errorDetails: undefined } } : node)), ...childNodes]);
                    setConnections((prev) => [...prev, ...childIds.map((childId) => ({ id: nanoid(), fromNodeId: nodeId, toNodeId: childId }))]);
                }

                const controller = runController;
                const textTargetIds = childIds.length ? childIds : [nodeId];
                textTargetIds.forEach((targetNodeId) => startGenerationRequest(targetNodeId, nodeId, nodeId, controller));
                const answers = await Promise.all(
                    textTargetIds.map((targetNodeId) => {
                        let localStreamed = "";
                        return requestImageQuestion(generationConfig, buildNodeResponseMessages({ ...generationContext, prompt: effectivePrompt }), (text) => {
                            localStreamed = text;
                            streamed = text;
                            if (isConfigNode) return;
                            setNodes((prev) => prev.map((node) => (node.id === targetNodeId ? { ...node, type: CanvasNodeType.Text, metadata: { ...node.metadata, content: text, status: NODE_STATUS_LOADING } } : node)));
                        }, { signal: controller.signal }).then((answer) => ({ nodeId: targetNodeId, content: answer || localStreamed })).finally(() => finishGenerationRequest(targetNodeId, controller));
                    }),
                );
                if (controller.signal.aborted) return;
                const answerByNodeId = new Map(answers.map((item) => [item.nodeId, item.content]));
                setNodes((prev) =>
                    prev.map((node) => {
                        const content = answerByNodeId.get(node.id) || streamed;
                        const storyboardRows = node.metadata?.storyboardRows ? parseStoryboardTable(content) : undefined;
                        if (childIds.includes(node.id)) return { ...node, metadata: { ...node.metadata, content, status: NODE_STATUS_SUCCESS, ...(storyboardRows ? { storyboardRows } : {}) } };
                        if (node.id === nodeId && isConfigNode) return { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS } };
                        if (node.id === nodeId && !editingTextNode)
                            return {
                                ...node,
                                type: node.type === CanvasNodeType.Script ? CanvasNodeType.Script : CanvasNodeType.Text,
                                title: node.type === CanvasNodeType.Script ? node.title || "脚本节点" : prompt.slice(0, 32) || "Generated Text",
                                metadata: { ...node.metadata, content, status: NODE_STATUS_SUCCESS, ...(storyboardRows ? { storyboardRows } : {}) },
                            };
                        return node;
                    }),
                );
            } catch (error) {
                if (isGenerationCanceled(error)) return;
                const errorDetails = error instanceof Error ? error.message : "生成失败";
                message.error(errorDetails);
                setNodes((prev) =>
                    prev.map((node) => (node.id === nodeId || pendingChildIds.includes(node.id) ? (node.id === nodeId && !markSourceStatus ? node : { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, errorDetails } }) : node)),
                );
            } finally {
                finishGenerationRequest(nodeId, runController);
                setRunningNodeId(null);
            }
        },
        [confirmVideoGeneration, effectiveConfig, finishGenerationRequest, generateStoryboardShotsFromInputs, isAiConfigReady, message, openConfigDialog, startGenerationRequest],
    );
    useEffect(() => {
        generateNodeRef.current = handleGenerateNode;
    }, [handleGenerateNode]);

    const handleRetryNode = useCallback(
        async (node: CanvasNodeData, patch?: Partial<CanvasNodeMetadata>) => {
            if (patch) {
                const nextNodes = nodesRef.current.map((item) => (item.id === node.id ? applyNodeConfigPatch(item, patch) : item));
                nodesRef.current = nextNodes;
                setNodes(nextNodes);
                node = nextNodes.find((item) => item.id === node.id) || applyNodeConfigPatch(node, patch);
            }
            const shouldResumeVideoTask = node.type === CanvasNodeType.Video && Boolean(patch?.videoTaskId);
            const sourceNode = findRetrySourceNode(node.id, nodesRef.current, connectionsRef.current) || node;
            const batchRoot = node.metadata?.batchRootId ? nodesRef.current.find((item) => item.id === node.metadata?.batchRootId) : null;
            const savedImageMetadata = node.type === CanvasNodeType.Image ? { ...batchRoot?.metadata, ...node.metadata } : undefined;
            const hasSavedImageMetadata = Boolean(savedImageMetadata?.generationType);
            const generationConfig =
                hasSavedImageMetadata && savedImageMetadata
                    ? {
                          ...effectiveConfig,
                          model: savedImageMetadata.model || effectiveConfig.imageModel || effectiveConfig.model,
                          quality: savedImageMetadata.quality || effectiveConfig.quality,
                          size: savedImageMetadata.size || effectiveConfig.size,
                          background: savedImageMetadata.background ?? effectiveConfig.background,
                          count: "1",
                      }
                    : { ...buildGenerationConfig(effectiveConfig, node.type === CanvasNodeType.Video ? node : sourceNode, node.type === CanvasNodeType.Text || node.type === CanvasNodeType.Script ? "text" : node.type === CanvasNodeType.Video ? "video" : node.type === CanvasNodeType.Audio ? "audio" : "image"), count: "1" };
            if (shouldResumeVideoTask && node.metadata?.videoTaskModel) {
                generationConfig.model = node.metadata.videoTaskModel;
                generationConfig.videoModel = node.metadata.videoTaskModel;
            }
            if (node.type === CanvasNodeType.Video && (node.metadata?.seconds === "-1" || generationConfig.videoSeconds === "-1")) {
                const rowSeconds = storyboardVideoRowSeconds(node, nodesRef.current);
                if (!rowSeconds) {
                    message.warning("当前镜头没有读取到分镜时长，请先检查分镜表时长");
                    return;
                }
                generationConfig.videoSeconds = rowSeconds;
            }
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                return;
            }

            const existingVideoTask = shouldResumeVideoTask ? videoTaskFromMetadata(node.metadata, generationConfig) : null;
            const storyboardVideoFinalPrompt = node.type === CanvasNodeType.Video ? node.metadata?.storyboardVideoFinalPrompt?.trim() || "" : "";
            const savedVideoPrompt = node.type === CanvasNodeType.Video ? storyboardVideoFinalPrompt || node.metadata?.prompt?.trim() || "" : "";
            const context = hasSavedImageMetadata || existingVideoTask ? null : await hydrateNodeGenerationContext(buildNodeGenerationContext(sourceNode.id, nodesRef.current, connectionsRef.current, sourceNode.metadata?.prompt || node.metadata?.prompt || ""));
            // Keep the exact prompt submitted by the failed video node; context is still rebuilt for references.
            const prompt = (savedImageMetadata?.prompt || savedVideoPrompt || context?.prompt || "").trim();
            if (!existingVideoTask && !prompt && !storyboardVideoFinalPrompt) {
                message.warning("找不到提示词，无法重试");
                return;
            }
            const generationType = savedImageMetadata?.generationType;
            const useReferenceImages = generationType ? generationType === "edit" : Boolean(context?.referenceImages.length);
            const storyboardVideoReferences = node.type === CanvasNodeType.Video ? await resolveStoryboardVideoReferences(node.metadata?.storyboardVideoReferences) : [];
            const storyboardVideoAudioReferences = node.type === CanvasNodeType.Video ? await resolveStoryboardVideoAudioReferences(node.metadata?.storyboardVideoAudioReferences) : [];
            const storyboardVideoFramePrompt = node.type === CanvasNodeType.Video ? storyboardVideoFrameContinuityPrompt(node.metadata?.storyboardVideoReferences) : "";
            const storyboardVideoAudioPrompt = node.type === CanvasNodeType.Video ? storyboardVideoAudioContinuityPrompt(node.metadata?.storyboardVideoAudioReferences) : "";
            const retryReferenceImages: ReferenceImage[] | null =
                hasSavedImageMetadata && savedImageMetadata ? await resolveMetadataReferences(savedImageMetadata) : useReferenceImages ? (context?.referenceImages.length ? context.referenceImages : sourceNodeReferenceImages(batchRoot || sourceNode)) : [];
            if (useReferenceImages && !retryReferenceImages) {
                message.error("参考图片已丢失，无法继续重试");
                setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails: "参考图片已丢失，无法继续重试" } } : item)));
                return;
            }
            const retryImages: ReferenceImage[] = storyboardVideoReferences.length ? storyboardVideoReferences : retryReferenceImages || [];
            const retryAudios: ReferenceAudio[] = storyboardVideoAudioReferences.length ? storyboardVideoAudioReferences : context?.referenceAudios || [];
            const storyboardDraftVideo = isStoryboardVideoDraftNode(node);
            const videoPrompt = node.type === CanvasNodeType.Video ? storyboardVideoFinalPrompt || [prompt, storyboardVideoFramePrompt, storyboardVideoAudioPrompt].filter(Boolean).join("\n\n") : "";
            if (node.type === CanvasNodeType.Video && node.metadata?.storyboardSourceNodeId && node.metadata.storyboardRowIndex !== undefined) {
                const scriptNode = nodesRef.current.find((item) => item.id === node.metadata?.storyboardSourceNodeId);
                if (scriptNode) {
                    try {
                        assertStoryboardVideoNodeProductionReady(scriptNode, { ...node, metadata: { ...node.metadata, storyboardVideoFinalPrompt: videoPrompt } }, "submit");
                    } catch (error) {
                        const reason = error instanceof Error ? error.message : "分镜生产契约校验失败";
                        setNodes((prev) => prev.map((item) => item.id === scriptNode.id ? { ...item, metadata: { ...item.metadata, storyboardPromptErrors: { ...(item.metadata?.storyboardPromptErrors || {}), [String(node.metadata?.storyboardRowIndex)]: reason } } } : item.id === node.id ? { ...item, metadata: { ...item.metadata, errorDetails: reason } } : item));
                        message.error(reason);
                        return;
                    }
                }
            }
            let videoConfirmation: Awaited<ReturnType<typeof confirmVideoGeneration>> = false;
            if (node.type === CanvasNodeType.Video && !existingVideoTask) {
                videoConfirmation = await confirmVideoGeneration({ config: generationConfig, prompt: videoPrompt, references: retryImages, videoReferences: context?.referenceVideos || [], audioReferences: retryAudios, apimartOmniElements: node.metadata?.videoTaskApimartOmniElements });
                if (!videoConfirmation) return;
                const nextNodes = nodesRef.current.map((item) => (item.id === node.id ? applyNodeConfigPatch(item, clearVideoTaskMetadataPatch()) : item));
                nodesRef.current = nextNodes;
                setNodes(nextNodes);
                node = nextNodes.find((item) => item.id === node.id) || applyNodeConfigPatch(node, clearVideoTaskMetadataPatch());
            }
            let generationTargetNode = node;
            let generationTargetId = node.id;
            let generationRunningId = node.id;
            if (storyboardDraftVideo) {
                generationTargetNode = buildStoryboardVideoResultNode(node, generationConfig, videoPrompt, nodesRef.current);
                generationTargetId = generationTargetNode.id;
                generationRunningId = generationTargetId;
                setNodes((prev) => upsertStoryboardVideoResultNode(prev, node, generationTargetNode));
                setConnections((prev) =>
                    addUniqueConnections(prev, [
                        { id: nanoid(), fromNodeId: node.id, toNodeId: generationTargetId },
                        ...storyboardVideoAssetReferenceNodes(node, nodesRef.current).map((assetNode) => ({ id: nanoid(), fromNodeId: assetNode.id, toNodeId: generationTargetId })),
                    ]),
                );
            } else {
                setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_LOADING, errorDetails: undefined, videoGenerationProgress: node.type === CanvasNodeType.Video ? initialVideoGenerationProgress() : item.metadata?.videoGenerationProgress } } : item)));
            }

            setRunningNodeId(generationRunningId);
            const controller = startGenerationRequest(generationTargetId, sourceNode.id, generationRunningId);

            try {
                if (node.type === CanvasNodeType.Text || node.type === CanvasNodeType.Script) {
                    if (!context) return;
                    let streamed = "";
                    const answer = await requestImageQuestion(generationConfig, buildNodeResponseMessages({ ...context, prompt }), (text) => {
                        streamed = text;
                        setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, type: node.type, metadata: { ...item.metadata, content: text, status: NODE_STATUS_LOADING } } : item)));
                    }, { signal: controller.signal });
                    const content = answer || streamed;
                    const storyboardRows = node.type === CanvasNodeType.Script ? parseStoryboardTable(content) : undefined;
                    setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, type: node.type, metadata: { ...item.metadata, content, prompt, status: NODE_STATUS_SUCCESS, ...(storyboardRows ? { storyboardRows } : {}) } } : item)));
                    return;
                }
                if (node.type === CanvasNodeType.Video) {
                    const existingTask = existingVideoTask ? videoTaskFromMetadata(generationTargetNode.metadata, generationConfig) || existingVideoTask : null;
                    const video = await storeGeneratedVideo(
                        await (existingTask
                            ? resumeVideoGenerationTask(generationConfig, existingTask, {
                                  signal: controller.signal,
                                  onProgress: (progress) => setNodes((prev) => prev.map((item) => (item.id === generationTargetId ? { ...item, metadata: { ...item.metadata, videoGenerationProgress: progress } } : item))),
                              })
                            : requestVideoGeneration(generationConfig, videoPrompt, retryImages, context?.referenceVideos || [], retryAudios, {
                                  signal: controller.signal,
                                  apimartAvatarMode: videoConfirmation?.apimartAvatarMode,
                                  apimartOmniElements: videoConfirmation?.apimartOmniElements,
                                  onTaskCreated: (task) => setNodes((prev) => prev.map((item) => (item.id === generationTargetId ? { ...item, metadata: { ...item.metadata, ...videoTaskMetadata(task) } } : item))),
                                  onProgress: (progress) => setNodes((prev) => prev.map((item) => (item.id === generationTargetId ? { ...item, metadata: { ...item.metadata, videoGenerationProgress: progress } } : item))),
                              })),
                    );
                    const videoSize = fitNodeSize(video.width || generationTargetNode.width, video.height || generationTargetNode.height, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                    const tailFrame = await extractVideoLastFrame(video).catch(() => null);
                    if (storyboardDraftVideo) {
                        const completedResult: CanvasNodeData = {
                            ...generationTargetNode,
                            position: { x: generationTargetNode.position.x + generationTargetNode.width / 2 - videoSize.width / 2, y: generationTargetNode.position.y },
                            width: videoSize.width,
                            height: videoSize.height,
                            metadata: { ...generationTargetNode.metadata, ...videoMetadata(video), ...storyboardTailFrameMetadata(tailFrame), prompt: videoPrompt, storyboardVideoFinalPrompt: videoPrompt, model: generationConfig.model, size: generationConfig.size, seconds: generationConfig.videoSeconds, vquality: generationConfig.vquality, generateAudio: generationConfig.videoGenerateAudio, watermark: generationConfig.videoWatermark, videoGenerationProgress: undefined },
                        };
                        setNodes((prev) =>
                            applyStoryboardTailFrameToNextVideo(
                                upsertStoryboardVideoResultNode(prev, node, completedResult),
                                node.metadata?.storyboardSourceNodeId,
                                node.metadata?.storyboardRowIndex,
                                tailFrame,
                                completedResult.metadata?.storyboardVideoVariantIndex,
                                completedResult.id,
                            ),
                        );
                        const nextDraft = nodesRef.current.find((item) => isStoryboardVideoDraftNode(item) && item.metadata?.storyboardSourceNodeId === node.metadata?.storyboardSourceNodeId && item.metadata.storyboardRowIndex === (node.metadata?.storyboardRowIndex ?? -2) + 1);
                        if (nextDraft && tailFrame && storyboardUsesPreviousTailFrame(nodesRef.current, node.metadata?.storyboardSourceNodeId, nextDraft.metadata?.storyboardRowIndex)) {
                            const tailReference = storyboardTailFrameReference(node.metadata?.storyboardRowIndex || 0, tailFrame, completedResult.metadata?.storyboardVideoVariantIndex, completedResult.id);
                            const references = storyboardPrioritizedVideoReferences(mergeStoryboardVideoReferences(nextDraft.metadata?.storyboardVideoReferences || [], tailReference), storyboardGeneratedFirstFrameUsesReference(node.metadata?.storyboardSourceNodeId || "", nextDraft.metadata?.storyboardRowIndex || 0, tailReference, nodesRef.current));
                            setConnections((prev) => syncStoryboardVideoReferenceConnections(prev, nextDraft.id, references, nodesRef.current));
                        }
                        message.success("已生成一版视频");
                        return;
                    }
                    setNodes((prev) => applyCompletedVideoToExistingNode(prev, node.id, video, tailFrame, generationConfig, prompt));
                    return;
                }
                if (node.type === CanvasNodeType.Audio) {
                    const audio = await requestStoredAudioGeneration(generationConfig, prompt, { signal: controller.signal, referenceAudios: retryAudios });
                    setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, ...audioMetadata(audio), prompt, ...buildAudioGenerationMetadata(generationConfig) } } : item)));
                    return;
                }

                const image = useReferenceImages ? await requestEdit(generationConfig, prompt, retryImages, undefined, { signal: controller.signal }).then((items) => items[0]) : await requestGeneration(generationConfig, prompt, { signal: controller.signal }).then((items) => items[0]);
                const uploadedImage = await uploadImage(image.dataUrl);
                const imageConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
                const imageSize = fitNodeSize(uploadedImage.width, uploadedImage.height, imageConfig.width, imageConfig.height);
                const generationMetadata = savedImageMetadata?.generationType
                    ? { generationType: savedImageMetadata.generationType, model: generationConfig.model, size: generationConfig.size, quality: generationConfig.quality, ...(generationConfig.background ? { background: generationConfig.background } : {}), count: savedImageMetadata.count || 1, references: savedImageMetadata.references }
                    : buildImageGenerationMetadata(useReferenceImages ? "edit" : "generation", generationConfig, 1, retryImages);
                setNodes((prev) =>
                    prev.map((item) =>
                        item.id === node.id
                            ? {
                                  ...item,
                                  type: CanvasNodeType.Image,
                                  width: imageSize.width,
                                  height: imageSize.height,
                                  metadata: { ...item.metadata, ...imageMetadata(uploadedImage), prompt, ...generationMetadata },
                              }
                            : item,
                    ),
                );
            } catch (error) {
                if (isGenerationCanceled(error)) return;
                const errorDetails = error instanceof Error ? error.message : "生成失败";
                message.error(errorDetails);
                setNodes((prev) => prev.map((item) => (item.id === generationTargetId ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails } } : item)));
            } finally {
                finishGenerationRequest(generationTargetId, controller);
                setRunningNodeId((current) => (current === generationRunningId ? null : current));
            }
        },
        [confirmVideoGeneration, effectiveConfig, finishGenerationRequest, isAiConfigReady, message, openConfigDialog, startGenerationRequest],
    );

    const generateImageFromTextNode = useCallback(
        (node: CanvasNodeData) => {
            const prompt = (node.metadata?.content || node.metadata?.prompt || "").trim();
            if (!prompt) {
                message.warning("文本节点为空，无法生图");
                return;
            }
            const sourceNode = nodesRef.current.find((item) => item.id === node.id);
            if (!sourceNode) return;
            const nodeSize = getNodeSpec(CanvasNodeType.Config);
            const configNode = createCanvasNode(
                CanvasNodeType.Config,
                {
                    x: sourceNode.position.x + sourceNode.width + 96 + nodeSize.width / 2,
                    y: sourceNode.position.y + sourceNode.height / 2,
                },
                {
                    prompt: "",
                    model: effectiveConfig.imageModel || effectiveConfig.model,
                    size: effectiveConfig.size,
                    count: getGenerationCount(effectiveConfig.canvasImageCount || effectiveConfig.count),
                },
            );
            const connection = { id: nanoid(), fromNodeId: sourceNode.id, toNodeId: configNode.id };
            const nextNodes = nodesRef.current.map((item) => (item.id === sourceNode.id ? { ...item, metadata: { ...item.metadata, content: prompt, prompt, status: NODE_STATUS_SUCCESS } } : item)).concat(configNode);
            const nextConnections = [...connectionsRef.current, connection];
            nodesRef.current = nextNodes;
            connectionsRef.current = nextConnections;
            setNodes(nextNodes);
            setConnections(nextConnections);
            setSelectedNodeIds(new Set([configNode.id]));
            setSelectedConnectionId(null);
            setDialogNodeId(configNode.id);
        },
        [effectiveConfig.canvasImageCount, effectiveConfig.count, effectiveConfig.imageModel, effectiveConfig.model, effectiveConfig.size, message],
    );

    const insertAssistantImage = useCallback(
        async (image: CanvasAssistantImage) => {
            const storedImage = image.storageKey ? { url: image.dataUrl, storageKey: image.storageKey, width: 1, height: 1, bytes: 0, mimeType: "image/png" } : await uploadImage(image.dataUrl);
            const meta = storedImage.width === 1 && storedImage.height === 1 ? await readImageMeta(storedImage.url) : storedImage;
            const config = fitNodeSize(meta.width, meta.height);
            const center = screenToCanvas((containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2, (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2);
            const id = `image-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            const node: CanvasNodeData = {
                id,
                type: CanvasNodeType.Image,
                title: image.prompt.slice(0, 32) || "Generated Image",
                position: { x: center.x - config.width / 2, y: center.y - config.height / 2 },
                width: config.width,
                height: config.height,
                metadata: { ...imageMetadata({ ...storedImage, width: meta.width, height: meta.height }), prompt: image.prompt },
            };

            setNodes((prev) => [...prev, node]);
            setSelectedNodeIds(new Set([id]));
            setSelectedConnectionId(null);
            setDialogNodeId(id);
        },
        [screenToCanvas, size.height, size.width],
    );

    const insertAssistantText = useCallback(
        (text: string, title?: string) => {
            const center = screenToCanvas((containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2, (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2);
            const node = {
                ...createCanvasNode(CanvasNodeType.Text, center, { content: text, status: NODE_STATUS_SUCCESS }),
                title: title || text.slice(0, 32) || "Assistant Text",
            };

            setNodes((prev) => [...prev, node]);
            setSelectedNodeIds(new Set([node.id]));
            setSelectedConnectionId(null);
        },
        [screenToCanvas, size.height, size.width],
    );

    const handleAssetInsert = useCallback(
        (payload: InsertAssetPayload) => {
            if (payload.kind === "text") {
                insertAssistantText(payload.content, payload.title);
            } else if (payload.kind === "video") {
                const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Video];
                const center = screenToCanvas((containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2, (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2);
                const id = `video-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                const nextSize = fitNodeSize(payload.width || spec.width, payload.height || spec.height, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                setNodes((prev) => [...prev, { id, type: CanvasNodeType.Video, title: payload.title, position: { x: center.x - nextSize.width / 2, y: center.y - nextSize.height / 2 }, width: nextSize.width, height: nextSize.height, metadata: { content: payload.url, storageKey: payload.storageKey, status: NODE_STATUS_SUCCESS, naturalWidth: payload.width, naturalHeight: payload.height } }]);
                setSelectedNodeIds(new Set([id]));
            } else {
                insertAssistantImage({ id: `asset-${Date.now()}`, prompt: payload.title, dataUrl: payload.dataUrl, storageKey: payload.storageKey });
            }
            setAssetPickerOpen(false);
        },
        [insertAssistantImage, insertAssistantText, screenToCanvas, size.height, size.width],
    );

    const nodeRegistryVersion = useNodeRegistryVersion((state) => state.version);
    const pluginAi = useMemo<CanvasPluginAi>(() => {
        const toReferences = (references?: string[]): ReferenceImage[] => (references || []).filter(Boolean).map((src, index) => ({ id: `plugin-ref-${index}`, name: `ref-${index}.png`, type: "image/png", dataUrl: src }));
        const ensureReady = (config: AiConfig) => {
            if (isAiConfigReady(config, config.model)) return;
            openConfigDialog(true);
            throw new Error("AI 配置未就绪，请先配置模型与密钥");
        };
        return {
            generateImage: async (prompt, options) => {
                const config = { ...buildGenerationConfig(effectiveConfig, undefined, "image"), count: String(options?.count || 1), ...(options?.model ? { model: options.model } : {}), ...(options?.size ? { size: options.size } : {}) };
                ensureReady(config);
                const references = toReferences(options?.references);
                const items = references.length ? await requestEdit(config, prompt, references, undefined, { signal: options?.signal }) : await requestGeneration(config, prompt, { signal: options?.signal });
                return { images: items.map((item) => item.dataUrl) };
            },
            generateVideo: async (prompt, options) => {
                const config = { ...buildGenerationConfig(effectiveConfig, undefined, "video"), ...(options?.model ? { model: options.model } : {}), ...(options?.size ? { size: options.size } : {}), ...(options?.seconds ? { videoSeconds: options.seconds } : {}) };
                ensureReady(config);
                const file = await storeGeneratedVideo(await requestVideoGeneration(config, prompt, toReferences(options?.references), [], [], { signal: options?.signal }));
                return { url: file.url, mimeType: file.mimeType, width: file.width, height: file.height, durationMs: file.durationMs };
            },
            generateText: async (prompt, options) => {
                const config = { ...buildGenerationConfig(effectiveConfig, undefined, "text"), ...(options?.model ? { model: options.model } : {}) };
                ensureReady(config);
                const messages: AiTextMessage[] = [...(options?.system ? [{ role: "system" as const, content: options.system }] : []), { role: "user" as const, content: prompt }];
                const text = await requestImageQuestion(config, messages, (delta) => options?.onDelta?.(delta), { signal: options?.signal });
                return { text };
            },
            listModels: (capability) => selectableModelsByCapability(effectiveConfig, capability as ModelCapability | undefined).map((value) => ({ value, label: decodeChannelModel(value)?.model || value })),
            defaultModel: (capability) => buildGenerationConfig(effectiveConfig, undefined, capability).model,
        };
    }, [effectiveConfig, isAiConfigReady, openConfigDialog]);

    const pluginHost = useMemo<CanvasPluginHost>(
        () => ({
            getNode: (id) => nodesRef.current.find((node) => node.id === id) || null,
            getNodes: () => [...nodesRef.current],
            getConnections: () => [...connectionsRef.current],
            getUpstream: (nodeId) => connectionsRef.current.filter((connection) => connection.toNodeId === nodeId).flatMap((connection) => nodesRef.current.filter((node) => node.id === connection.fromNodeId)),
            getDownstream: (nodeId) => connectionsRef.current.filter((connection) => connection.fromNodeId === nodeId).flatMap((connection) => nodesRef.current.filter((node) => node.id === connection.toNodeId)),
            updateNode: (nodeId, patch) =>
                setNodes((current) => {
                    const next = current.map((node) => (node.id === nodeId ? { ...node, ...patch } : node));
                    nodesRef.current = next;
                    return next;
                }),
            updateMetadata: (nodeId, patch) =>
                setNodes((current) => {
                    const next = current.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, ...patch } } : node));
                    nodesRef.current = next;
                    return next;
                }),
            applyOps: (ops) => void applyAgentOps(ops),
            ai: pluginAi,
            openPanel: (nodeId) => setDialogNodeId(nodeId),
            closePanel: () => setDialogNodeId(null),
        }),
        [applyAgentOps, pluginAi],
    );
    const pluginToolbarTools = useMemo<CanvasNodeToolbarItem[]>(() => {
        if (!toolbarNode) return [];
        const definition = getNodeDefinition(toolbarNode.type);
        if (!definition) return [];
        try {
            const tools = (definition.toolbar?.(buildNodeContext(pluginHost, toolbarNode, theme, viewport.k, true)) || []).map((item) => ({
                ...item,
                onClick: () => {
                    try {
                        item.onClick();
                    } catch (error) {
                        console.error(`[plugin] 工具栏操作失败: ${toolbarNode.type}`, error);
                    }
                },
            }));
            if (!definition.interactionToggle || !toolbarNode.metadata?.content || definition.forceInteractive?.(toolbarNode)) return tools;
            const interactive = Boolean(toolbarNode.metadata?.interactive);
            return [
                {
                    id: "node-interaction-toggle",
                    title: interactive ? "切换为移动节点" : "切换为操作节点内容",
                    label: interactive ? "移动" : "交互",
                    icon: interactive ? <Move className="size-4" /> : <Hand className="size-4" />,
                    active: interactive,
                    onClick: () => pluginHost.updateMetadata(toolbarNode.id, { interactive: !interactive }),
                },
                ...tools,
            ];
        } catch (error) {
            console.error(`[plugin] 工具栏创建失败: ${toolbarNode.type}`, error);
            return [];
        }
    }, [nodeRegistryVersion, pluginHost, theme, toolbarNode, viewport.k]);

    const renderPluginPanel = useCallback(
        (node: CanvasNodeData) => {
            const definition = getNodeDefinition(node.type);
            if (!definition?.Panel) return null;
            const PluginPanel = definition.Panel;
            return (
                <CanvasPluginErrorBoundary resetKey={`${node.id}:${nodeRegistryVersion}:panel`} theme={theme}>
                    <PluginPanel ctx={buildNodeContext(pluginHost, node, theme, viewportRef.current.k)} onClose={() => setDialogNodeId(null)} />
                </CanvasPluginErrorBoundary>
            );
        },
        [nodeRegistryVersion, pluginHost, theme],
    );

    if (!projectLoaded) return <CanvasRefreshShell />;

    return (
        <main className="flex h-full min-h-0 overflow-hidden" style={{ background: theme.canvas.background, color: theme.node.text }}>
            <CanvasSidePanel nodes={nodes} selectedNodeIds={selectedNodeIds} onFocusNode={focusNode} onPreviewNode={setPreviewNodeId} onInsertAsset={handleAssetInsert} />
            <section className="relative min-w-0 flex-1 overflow-hidden">
                <CanvasTopBar
                    title={currentProject?.title || "未命名画布"}
                    titleDraft={titleDraft}
                    isTitleEditing={titleEditing}
                    onTitleDraftChange={setTitleDraft}
                    onStartTitleEditing={startTitleEditing}
                    onFinishTitleEditing={finishTitleEditing}
                    onCancelTitleEditing={() => setTitleEditing(false)}
                    canUndo={historyState.canUndo}
                    canRedo={historyState.canRedo}
                    onHome={() => navigate("/")}
                    onProjects={() => navigate("/canvas")}
                    onCreateProject={createAndOpenProject}
                    onDeleteProject={deleteCurrentProject}
                    onExportProject={exportCurrentProject}
                    onImportImage={() => handleUploadRequest()}
                    onUndo={undoCanvas}
                    onRedo={redoCanvas}
                    agentOpen={agentPanelOpen}
                    compactAgentStatus={{ connected: localAgentConnected, enabled: localAgentEnabled, activity: localAgentActivity }}
                    onToggleAgent={toggleAgentPanel}
                />

                <InfiniteCanvas
                    containerRef={containerRef}
                    viewport={viewport}
                    backgroundMode={backgroundMode}
                    onViewportChange={(next) => {
                        setViewport(next);
                        setContextMenu(null);
                    }}
                    onCanvasMouseDown={handleCanvasMouseDown}
                    onCanvasDeselect={deselectCanvas}
                    onCanvasDoubleClick={(event) => {
                        setContextMenu(null);
                        setNodeCreatePosition(screenToCanvas(event.clientX, event.clientY));
                    }}
                    onContextMenu={preventCanvasContextMenu}
                    onDrop={handleDrop}
                >
                    <svg className="absolute left-0 top-0 h-[10000px] w-[10000px] overflow-visible" style={{ pointerEvents: "none", transform: "translateZ(0)", zIndex: 0 }}>
                        {connections
                            .filter((connection) => {
                                const from = nodeById.get(connection.fromNodeId);
                                const to = nodeById.get(connection.toNodeId);
                                return Boolean(from && to && !isWorkspaceChildConnection(connection, from, to) && !isHiddenCanvasConnectionEndpoint(from, nodes) && !isHiddenCanvasConnectionEndpoint(to, nodes));
                            })
                            .map((connection) => {
                                const from = nodeById.get(connection.fromNodeId);
                                const to = nodeById.get(connection.toNodeId);
                                if (!from || !to) return null;

                                return (
                                    <ConnectionPath
                                        key={connection.id}
                                        connection={connection}
                                        from={from}
                                        to={to}
                                        active={selectedConnectionId === connection.id || relatedHighlight.connectionIds.has(connection.id)}
                                        onSelect={() => {
                                            setSelectedConnectionId(connection.id);
                                            setSelectedNodeIds(new Set());
                                            setContextMenu(null);
                                        }}
                                        onContextMenu={(event) => {
                                            setSelectedConnectionId(connection.id);
                                            setSelectedNodeIds(new Set());
                                            setContextMenu({ type: "connection", x: event.clientX, y: event.clientY, connectionId: connection.id });
                                        }}
                                    />
                                );
                            })}
                        {connectingParams ? <ActiveConnectionPath node={nodeById.get(connectingParams.nodeId)} handle={connectingParams} mouseWorld={mouseWorld} target={connectionTargetNodeId ? nodeById.get(connectionTargetNodeId) : undefined} /> : null}
                    </svg>

                    {visibleNodes.map((node) => (
                        <CanvasNode
                            key={node.id}
                            data={node}
                            scale={viewport.k}
                            isSelected={selectedNodeIds.has(node.id)}
                            isRelated={relatedHighlight.nodeIds.has(node.id)}
                            isFocusRelated={activeNodeId === node.id}
                            isConnectionTarget={connectionTargetNodeId === node.id}
                            isConnecting={Boolean(connectingParams)}
                            editRequestNonce={editingNodeId === node.id ? editRequestNonce : 0}
                            showPanel={dialogNodeId === node.id && !selectionBox}
                            batchCount={batchChildCountById.get(node.id) || 0}
                            groupChildCount={groupChildCountById.get(node.id) || 0}
                            isGroupDropTarget={dropTargetGroupId === node.id}
                            batchExpanded={Boolean(node.metadata?.imageBatchExpanded)}
                            batchClosing={Boolean(node.metadata?.batchRootId && collapsingBatchIds.has(node.metadata.batchRootId))}
                            batchOpening={openingBatchIds.has(node.id)}
                            batchRecovering={collapsingBatchIds.has(node.id)}
                            batchMotion={batchMotionById.get(node.id)}
                            showImageInfo={showImageInfo}
                            mentionReferences={mentionReferencesByNodeId.get(node.id) || []}
                            storyboardReferenceAssets={storyboardReferenceAssetsForNode(node, nodes, connections)}
                            storyboardVideoResults={storyboardVideoResultsByDraftId.get(node.id) || []}
                            storyboardDurationSeconds={storyboardVideoRowSeconds(node, nodes)}
                            pluginHost={pluginHost}
                            renderPanel={(panelNode) =>
                                renderPluginPanel(panelNode) || ((isBuiltinNodeType(panelNode.type) || Boolean(getNodeDefinition(panelNode.type)?.useBuiltinPanel)) ? (panelNode.type === CanvasNodeType.Config ? (
                                    <CanvasConfigComposer
                                        value={panelNode.metadata?.composerContent ?? panelNode.metadata?.prompt ?? ""}
                                        inputs={configInputsById.get(panelNode.id) || []}
                                        onChange={(composerContent) => handleConfigNodeChange(panelNode.id, { composerContent })}
                                        onClose={() => setDialogNodeId(null)}
                                    />
                                ) : (
                                    <CanvasNodePromptPanel
                                        node={panelNode}
                                        modeOverride={getNodeDefinition(panelNode.type)?.useBuiltinPanel?.mode}
                                        isRunning={runningNodeId === panelNode.id}
                                        mentionReferences={mentionReferencesByNodeId.get(panelNode.id) || []}
                                        onPromptChange={handleNodePromptChange}
                                        onConfigChange={handleConfigNodeChange}
                                        onGenerate={(nodeId, mode, prompt, options) => {
                                            const target = nodesRef.current.find((item) => item.id === nodeId);
                                            if (target?.type === CanvasNodeType.Script) {
                                                void generateStoryboardShotsFromInputs(target);
                                                return;
                                            }
                                            void handleGenerateNode(nodeId, mode, prompt, options);
                                        }}
                                        onStop={confirmStopGeneration}
                                        onPromptAssistant={openPromptAssistant}
                                        onCinemaDna={rewritePromptWithCinemaDna}
                                        onApplyPromptAssistantPending={applyPendingPromptAssistantResult}
                                        onDiscardPromptAssistantPending={discardPromptAssistantPending}
                                        onImageSettingsOpenChange={(open) => {
                                            setNodeImageSettingsOpen(open);
                                            if (open) setToolbarNodeId(null);
                                        }}
                                    />
                                )) : null)
                            }
                            renderNodeContent={(contentNode) => (
                                <CanvasConfigNodePanel
                                    node={contentNode}
                                    isRunning={runningNodeId === contentNode.id}
                                    inputSummary={getInputSummary(configInputsById.get(contentNode.id) || [])}
                                    onConfigChange={handleConfigNodeChange}
                                    onComposerToggle={() => setDialogNodeId((current) => (current === contentNode.id ? null : contentNode.id))}
                                    onStop={confirmStopGeneration}
                                    onGenerate={(nodeId) => {
                                        const target = nodesRef.current.find((item) => item.id === nodeId);
                                        void handleGenerateNode(nodeId, target?.metadata?.generationMode || "image", target?.metadata?.composerContent ?? target?.metadata?.prompt ?? "");
                                    }}
                                />
                            )}
                            onMouseDown={handleNodeMouseDown}
                            onHoverStart={(nodeId) => {
                                if (nodeDraggingRef.current) return;
                                setHoveredNodeId(nodeId);
                            }}
                            onHoverEnd={(nodeId) => {
                                setHoveredNodeId((current) => (current === nodeId ? null : current));
                            }}
                            onConnectStart={handleConnectStart}
                            onResize={handleNodeResize}
                            onMetadataChange={handleNodeMetadataChange}
                            onContentChange={handleNodeContentChange}
                            onTitleChange={handleNodeTitleChange}
                            onStoryboardScreenshotImport={importStoryboardScreenshot}
                            onToggleBatch={toggleBatchExpanded}
                            onSetBatchPrimary={setBatchPrimary}
                            onRetry={(node, patch) => void (node.type === CanvasNodeType.Script ? generateStoryboardShotsFromInputs(node) : handleRetryNode(node, patch))}
                            onEditPrompt={openNodePromptPanel}
                            onGenerateImage={generateImageFromTextNode}
                            onOpenScript={openStoryboardScriptNode}
                            onViewImage={(node) => setPreviewNodeId(node.id)}
                            onContextMenu={(event, id) => {
                                event.preventDefault();
                                event.stopPropagation();
                                setContextMenu({ type: "node", x: event.clientX, y: event.clientY, nodeId: id });
                            }}
                        />
                    ))}

                    {selectionBox ? (
                        <div
                            className="pointer-events-none absolute z-[100] border"
                            style={{
                                left: Math.min(selectionBox.startWorldX, selectionBox.currentWorldX),
                                top: Math.min(selectionBox.startWorldY, selectionBox.currentWorldY),
                                width: Math.abs(selectionBox.currentWorldX - selectionBox.startWorldX),
                                height: Math.abs(selectionBox.currentWorldY - selectionBox.startWorldY),
                                borderColor: theme.canvas.selectionStroke,
                                background: theme.canvas.selectionFill,
                            }}
                        />
                    ) : null}
                    {pendingConnectionCreate ? <ConnectionCreateMenu pending={pendingConnectionCreate} onCreate={(type) => createConnectedNode(type, pendingConnectionCreate)} onClose={cancelPendingConnectionCreate} /> : null}
                    {nodeCreatePosition ? (
                        <NodeCreateMenu
                            position={nodeCreatePosition}
                            onCreate={(type) => {
                                createNode(type, nodeCreatePosition);
                                setNodeCreatePosition(null);
                            }}
                            onClose={() => setNodeCreatePosition(null)}
                        />
                    ) : null}
                </InfiniteCanvas>

                <CanvasNodeHoverToolbar
                    node={isNodeDragging || nodeImageSettingsOpen ? null : toolbarNode}
                    viewport={viewport}
                    extraTools={pluginToolbarTools}
                    onKeep={keepNodeToolbar}
                    onLeave={hideNodeToolbar}
                    onInfo={(node) => setInfoNodeId(node.id)}
                    onEditText={openTextEditor}
                    onDecreaseFont={(node) => handleFontSizeChange(node.id, Math.max(10, (node.metadata?.fontSize || 14) - 2))}
                    onIncreaseFont={(node) => handleFontSizeChange(node.id, Math.min(32, (node.metadata?.fontSize || 14) + 2))}
                    onToggleDialog={(node) => setDialogNodeId((current) => (current === node.id ? null : node.id))}
                    onGenerateImage={generateImageFromTextNode}
                    onUpload={(node) => handleUploadRequest(node.id)}
                    onDownload={downloadNodeImage}
                    onShowVideoFrame={(node, role) => void showVideoFrame(node, role)}
                    onSeparateAudio={(node) => void separateNodeAudio(node)}
                    separatingAudio={Boolean(toolbarNode && audioSeparatingNodeIds.has(toolbarNode.id))}
                    onSaveAsset={(node) => void saveNodeAsset(node)}
                    onOpenPreset={(node, preset) => createImagePresetConfigNode(node, preset)}
                    onMaskEdit={(node) => setMaskEditNodeId(node.id)}
                    onCrop={(node) => setCropNodeId(node.id)}
                    onSplit={(node) => setSplitNodeId(node.id)}
                    onUpscale={(node) => setUpscaleNodeId(node.id)}
                    onSuperResolve={(node) => setSuperResolveNodeId(node.id)}
                    onAngle={(node) => setAngleNodeId(node.id)}
                    onViewImage={(node) => setPreviewNodeId(node.id)}
                    onPromptAssistant={openPromptAssistant}
                    onReversePrompt={createImageReversePromptNodes}
                    onExportScriptAssets={(node) => void exportStoryboardAssetsToCanvas(node)}
                    onBatchGenerateScriptVideos={(node) => void batchGenerateStoryboardVideos(node)}
                    onRetry={(node) => void (node.type === CanvasNodeType.Script ? generateStoryboardShotsFromInputs(node) : handleRetryNode(node))}
                    onToggleFreeResize={(node) => toggleNodeFreeResize(node.id)}
                    onDelete={(node) => deleteNodes(new Set([node.id]))}
                />

                <CanvasPromptAssistantDialog
                    node={promptAssistantNode}
                    open={Boolean(promptAssistantNode)}
                    loading={promptAssistantLoading}
                    config={effectiveConfig}
                    selectedModel={promptAssistantModel || effectiveConfig.textModel || effectiveConfig.model}
                    onClose={() => setPromptAssistantNodeId(null)}
                    onModelChange={setPromptAssistantModel}
                    onMissingConfig={() => openConfigDialog(true)}
                    onApply={applyPromptAssistantResult}
                    onAiRewrite={rewritePromptWithAi}
                />

                <CanvasToolbar
                    selectedCount={selectedNodeIds.size}
                    canUndo={historyState.canUndo}
                    canRedo={historyState.canRedo}
                    backgroundMode={backgroundMode}
                    showImageInfo={showImageInfo}
                    onAddImage={() => createNode(CanvasNodeType.Image)}
                    onAddVideo={() => createNode(CanvasNodeType.Video)}
                    onAddAudio={() => createNode(CanvasNodeType.Audio)}
                    onAddText={() => createNode(CanvasNodeType.Text)}
                    onAddScript={() => createNode(CanvasNodeType.Script)}
                    onAddConfig={() => createNode(CanvasNodeType.Config)}
                    onAddGroup={() => createNode(CanvasNodeType.Group)}
                    onAddExtensionNode={(type) => createNode(type)}
                    onImportMangaCard={handleMangaCardImportRequest}
                    onImportMangaStoryboard={handleMangaStoryboardImportRequest}
                    onImportScene360={handleScene360ImportRequest}
                    onUndo={undoCanvas}
                    onRedo={redoCanvas}
                    onUpload={() => handleUploadRequest()}
                    onDelete={() => deleteNodes(new Set(selectedNodeIds))}
                    onClear={() => setClearConfirmOpen(true)}
                    onDeselect={deselectCanvas}
                    onBackgroundModeChange={setBackgroundMode}
                    onShowImageInfoChange={setShowImageInfo}
                    onOpenMyAssets={() => {
                        setAssetPickerOpen(true);
                    }}
                    onOpenDirectorDesk={() => {
                        setLastDirectorDeskCanvasId(projectId);
                        navigate(`/director-desk?canvasId=${encodeURIComponent(projectId)}&returnTo=${encodeURIComponent(`/canvas/${projectId}`)}`);
                    }}
                    onOpenToonflow={openToonflow}
                />

                {isMiniMapOpen ? <Minimap nodes={minimapNodes} viewport={viewport} viewportSize={size} onViewportChange={setViewport} /> : null}

                <CanvasZoomControls scale={viewport.k} onScaleChange={setZoomScale} onReset={resetViewport} isMiniMapOpen={isMiniMapOpen} onToggleMiniMap={() => setIsMiniMapOpen((value) => !value)} />

                {contextMenu ? (
                    <CanvasNodeContextMenu
                        menu={contextMenu}
                        canvasActions={canvasContextMenuActions}
                        onClose={() => setContextMenu(null)}
                        onDuplicate={() => {
                            if (contextMenu.type !== "node") return;
                            duplicateNode(contextMenu.nodeId);
                            setContextMenu(null);
                        }}
                        onDelete={() => {
                            if (contextMenu.type === "node") {
                                deleteNodes(new Set([contextMenu.nodeId]));
                            } else if (contextMenu.type === "connection") {
                                deleteConnection(contextMenu.connectionId);
                            }
                            setContextMenu(null);
                        }}
                    />
                ) : null}

                <input ref={imageInputRef} type="file" accept="image/*,video/*,audio/mpeg,audio/wav,audio/x-wav,.mp3,.wav" className="hidden" onChange={handleImageInputChange} />
                <input ref={mangaCardInputRef} type="file" accept="image/*,.txt,.json,text/plain,application/json" className="hidden" onChange={handleMangaCardInputChange} />
                <input ref={mangaStoryboardInputRef} type="file" accept=".txt,.json,text/plain,application/json" className="hidden" onChange={handleMangaStoryboardInputChange} />
                <input ref={scene360InputRef} type="file" accept=".txt,.json,text/plain,application/json" className="hidden" onChange={handleScene360InputChange} />

                <CanvasNodeInfoModal node={infoNode} open={Boolean(infoNode)} onClose={() => setInfoNodeId(null)} />

                <CanvasScriptNodeDialog
                    node={scriptNode ? alignStoryboardNodeAssetsWithCurrentStyle(scriptNode) : null}
                    open={Boolean(scriptNode)}
                    actionKey={storyboardActionKey}
                    promptProgress={storyboardPromptProgress}
                    onClose={() => setScriptNodeId(null)}
                    onRowsChange={updateStoryboardRows}
                    onPrepareAssets={(node) => void prepareStoryboardAssets(node)}
                    onUpdateAsset={updateStoryboardAsset}
                    onDeleteAsset={deleteStoryboardAsset}
                    onUploadAssetImage={(nodeId, assetId, file) => void uploadStoryboardAssetImage(nodeId, assetId, file)}
                    onGenerateAssetImage={(node, assetId) => void generateStoryboardAssetImage(node, assetId)}
                    onGenerateSceneSheet={(node, assetId) => void generateStoryboardSceneSheet(node, assetId)}
                    onStopSceneSheet={stopStoryboardSceneSheetGeneration}
                    onBatchGenerateSceneSheets={(node) => void batchGenerateStoryboardSceneSheets(node)}
                    onStopSceneSheets={stopStoryboardSceneSheetGenerationBatch}
                    onGenerateAssetVoice={(node, assetId) => void generateStoryboardAssetVoice(node, assetId)}
                    onSelectAssetVoice={selectStoryboardAssetVoice}
                    onBatchGenerateAssets={(node) => void batchGenerateStoryboardAssets(node)}
                    onStopAssetGeneration={stopStoryboardAssetGeneration}
                    onGenerateShotsFromInputs={(node) => void generateStoryboardShotsFromInputs(node)}
                    onRepairShot={(node, rowIndex) => void repairStoryboardShots(node, [rowIndex])}
                    onRepairAllShots={(node) => void repairStoryboardShots(node)}
                    onStopShotRepair={stopStoryboardShotRepair}
                    onComposeFinalPrompt={(node, rowIndex, replaceExisting) => void composeStoryboardFinalPrompt(node, rowIndex, replaceExisting)}
                    onStopPromptGeneration={stopStoryboardPromptGeneration}
                    onPromptDetailChange={updateStoryboardPromptDetail}
                    onModelChange={updateStoryboardModel}
                    onGenerateImage={(node, rowIndex) => void generateStoryboardImage(node, rowIndex)}
                    onGenerateVideo={(node, rowIndex) => void generateStoryboardVideo(node, rowIndex)}
                    onBatchGenerateVideos={(node) => void batchGenerateStoryboardVideos(node)}
                    onActiveEpisodeChange={(nodeId, episodeId) => handleConfigNodeChange(nodeId, { storyboardActiveChapterId: episodeId })}
                    onCreateChapterNodes={createStoryboardChapterNodes}
                    onNarrationLockChange={setStoryboardNarrationLocked}
                    onShotPlanChange={updateStoryboardShotPlan}
                    videoDraftCount={scriptVideoCounts.draftCount}
                    videoResultCount={scriptVideoCounts.resultCount}
                    config={effectiveConfig}
                />

                {cropNode?.metadata?.content ? <CanvasNodeCropDialog dataUrl={cropNode.metadata.content} open={Boolean(cropNode)} onClose={() => setCropNodeId(null)} onConfirm={(crop) => void cropImageNode(cropNode!, crop)} /> : null}

                {maskEditNode?.metadata?.content ? <CanvasNodeMaskEditDialog dataUrl={maskEditNode.metadata.content} open={Boolean(maskEditNode)} onClose={() => setMaskEditNodeId(null)} onConfirm={(payload) => void maskEditImageNode(maskEditNode!, payload)} /> : null}

                {splitNode?.metadata?.content ? <CanvasNodeSplitDialog dataUrl={splitNode.metadata.content} open={Boolean(splitNode)} onClose={() => setSplitNodeId(null)} onConfirm={(params) => void splitImageNode(splitNode!, params)} /> : null}

                {upscaleNode?.metadata?.content ? <CanvasNodeUpscaleDialog dataUrl={upscaleNode.metadata.content} open={Boolean(upscaleNode)} onClose={() => setUpscaleNodeId(null)} onConfirm={(params) => void upscaleImageNode(upscaleNode!, params)} /> : null}

                <Modal title="AI 超分" open={Boolean(superResolveNode?.metadata?.content)} centered footer={null} onCancel={() => setSuperResolveNodeId(null)}>
                    <div className="py-8 text-center text-base font-medium">暂未实现</div>
                </Modal>

                {angleNode?.metadata?.content ? <CanvasNodeAngleDialog dataUrl={angleNode.metadata.content} open={Boolean(angleNode)} onClose={() => setAngleNodeId(null)} onConfirm={(params) => void generateAngleNode(angleNode!, params)} /> : null}

                <Modal
                    title="图片详情"
                    open={Boolean(previewNode?.metadata?.content)}
                    centered
                    onCancel={() => setPreviewNodeId(null)}
                    footer={null}
                    width="auto"
                    styles={{ body: { padding: 0, display: "flex", justifyContent: "center", alignItems: "center", maxHeight: "80vh" } }}
                >
                    {previewNode?.metadata?.content ? (
                        <img
                            src={previewNode.metadata.content}
                            alt={previewNode.title || "图片"}
                            style={{ maxWidth: "100%", maxHeight: "80vh", objectFit: "contain" }}
                        />
                    ) : null}
                </Modal>

                <Modal
                    title="清空画布？"
                    open={clearConfirmOpen}
                    centered
                    onCancel={() => setClearConfirmOpen(false)}
                    footer={
                        <>
                            <Button onClick={() => setClearConfirmOpen(false)}>取消</Button>
                            <Button danger type="primary" onClick={clearCanvas}>
                                清空
                            </Button>
                        </>
                    }
                >
                    <p className="text-sm opacity-60">这会删除当前画布上的所有节点和连线。</p>
                </Modal>

                <AssetPickerModal open={assetPickerOpen} onInsert={handleAssetInsert} onClose={() => setAssetPickerOpen(false)} />
            </section>
        </main>
    );
}

function CanvasTopBar({
    title,
    titleDraft,
    isTitleEditing,
    onTitleDraftChange,
    onStartTitleEditing,
    onFinishTitleEditing,
    onCancelTitleEditing,
    canUndo,
    canRedo,
    onHome,
    onProjects,
    onCreateProject,
    onDeleteProject,
    onExportProject,
    onImportImage,
    onUndo,
    onRedo,
    agentOpen,
    compactAgentStatus,
    onToggleAgent,
}: {
    title: string;
    titleDraft: string;
    isTitleEditing: boolean;
    onTitleDraftChange: (value: string) => void;
    onStartTitleEditing: () => void;
    onFinishTitleEditing: () => void;
    onCancelTitleEditing: () => void;
    canUndo: boolean;
    canRedo: boolean;
    onHome: () => void;
    onProjects: () => void;
    onCreateProject: () => void;
    onDeleteProject: () => void;
    onExportProject: () => void;
    onImportImage: () => void;
    onUndo: () => void;
    onRedo: () => void;
    agentOpen: boolean;
    compactAgentStatus?: { connected: boolean; enabled: boolean; activity: string };
    onToggleAgent: () => void;
}) {
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];
    const titleRef = useRef<HTMLDivElement>(null);
    const [shortcutsOpen, setShortcutsOpen] = useState(false);
    const [pluginManagerOpen, setPluginManagerOpen] = useState(false);
    const sidePanelOpen = useCanvasSidePanelStore((state) => state.panelOpen);
    const toggleSidePanel = useCanvasSidePanelStore((state) => state.togglePanel);

    useEffect(() => {
        if (!isTitleEditing) return;
        const close = (event: PointerEvent) => {
            const target = event.target;
            if (target instanceof Element && (target.closest("[data-canvas-no-zoom]") || target.closest(".ant-modal-root"))) return;
            if (!titleRef.current?.contains(target as Node)) onFinishTitleEditing();
        };
        document.addEventListener("pointerdown", close, true);
        return () => document.removeEventListener("pointerdown", close, true);
    }, [isTitleEditing, onFinishTitleEditing]);

    return (
        <>
            <div className="pointer-events-none absolute left-0 right-0 top-0 z-50 flex h-16 items-center justify-between px-4">
                <div className="pointer-events-auto flex min-w-0 items-center gap-2">
                    <Tooltip title={sidePanelOpen ? "收起面板" : "展开面板"}>
                        <button type="button" onClick={toggleSidePanel} aria-label={sidePanelOpen ? "收起面板" : "展开面板"} className="grid size-7 place-items-center transition hover:opacity-70" style={{ color: theme.node.text }}>
                            {sidePanelOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
                        </button>
                    </Tooltip>
                    <Dropdown
                        trigger={["click"]}
                        menu={{
                            items: [
                                { key: "home", icon: <Home className="size-4" />, label: "主页", onClick: onHome },
                                { key: "docs", icon: <BookOpen className="size-4" />, label: "文档", onClick: () => window.open(DOCS_URL, "_blank", "noopener,noreferrer") },
                                { key: "projects", icon: <Images className="size-4" />, label: "我的画布", onClick: onProjects },
                                { type: "divider" },
                                { key: "new", icon: <Plus className="size-4" />, label: "新建画布", onClick: onCreateProject },
                                { key: "delete", danger: true, icon: <Trash2 className="size-4" />, label: "删除当前画布", onClick: onDeleteProject },
                                { type: "divider" },
                                { key: "import", icon: <Upload className="size-4" />, label: "导入素材", onClick: onImportImage },
                                { key: "export", icon: <Download className="size-4" />, label: "导出当前画布", onClick: onExportProject },
                                { type: "divider" },
                                { key: "undo", disabled: !canUndo, icon: <Undo2 className="size-4" />, label: <MenuLabel text="撤销" shortcut="⌘ Z" />, onClick: onUndo },
                                { key: "redo", disabled: !canRedo, icon: <Redo2 className="size-4" />, label: <MenuLabel text="重做" shortcut="⌘ ⇧ Z / ⌘ Y" />, onClick: onRedo },
                            ],
                        }}
                    >
                        <button type="button" className="grid size-9 place-items-center rounded-full transition hover:bg-black/5 dark:hover:bg-white/10" style={{ color: theme.node.text }} aria-label="打开画布菜单">
                            <Menu className="size-5" />
                        </button>
                    </Dropdown>

                    <div ref={titleRef} className="flex min-w-0 items-center gap-2">
                        {isTitleEditing ? (
                            <input
                                autoFocus
                                value={titleDraft}
                                onChange={(event) => onTitleDraftChange(event.target.value)}
                                onBlur={onFinishTitleEditing}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") onFinishTitleEditing();
                                    if (event.key === "Escape") onCancelTitleEditing();
                                }}
                                className="max-w-[280px] bg-transparent p-0 text-left text-lg font-semibold tracking-normal outline-none"
                                style={{ color: theme.node.text }}
                            />
                        ) : (
                            <button
                                type="button"
                                className="max-w-[280px] truncate border-b border-dashed border-transparent text-left text-lg font-semibold tracking-normal transition hover:border-current"
                                onDoubleClick={onStartTitleEditing}
                                title="双击修改画布名称"
                            >
                                {title}
                            </button>
                        )}
                    </div>
                </div>

                <div className="pointer-events-auto flex items-center gap-1.5">
                    {compactAgentStatus ? <CompactAgentStatus status={compactAgentStatus} onClick={onToggleAgent} /> : null}
                    <button type="button" className="grid size-7 place-items-center transition hover:opacity-70" style={{ color: theme.node.text }} onClick={() => setPluginManagerOpen(true)} aria-label="节点插件" title="节点插件">
                        <Puzzle className="size-4" />
                    </button>
                    <UserStatusActions
                        variant="canvas"
                        onOpenShortcuts={() => setShortcutsOpen(true)}
                    />
                    <span className="h-6 w-px" style={{ background: theme.toolbar.border }} />
                    <Button
                        type="text"
                        className="!h-10 !rounded-xl !px-3 !font-medium"
                        style={{ background: agentOpen ? theme.toolbar.activeBg : theme.toolbar.panel, color: theme.node.text, boxShadow: "0 10px 30px rgba(28,25,23,.10)" }}
                        icon={<Bot className="size-4" />}
                        onClick={onToggleAgent}
                    >
                        Agent
                    </Button>
                </div>
            </div>
            <Modal title="快捷键" open={shortcutsOpen} onCancel={() => setShortcutsOpen(false)} footer={null} centered>
                <div className="space-y-2 border-t pt-4 text-sm" style={{ borderColor: theme.node.stroke }}>
                    <Shortcut keys={["拖动画布"]} value="平移视图" />
                    <Shortcut keys={["滚轮"]} value="缩放画布" />
                    <Shortcut keys={["缩放滑杆"]} value="精确调整缩放" />
                    <Shortcut keys={["Ctrl / Cmd", "拖动"]} value="框选多个节点" />
                    <Shortcut keys={["Shift / Ctrl / Cmd", "点击"]} value="追加选择节点" />
                    <Shortcut keys={["Ctrl / Cmd", "A"]} value="全选节点" />
                    <Shortcut keys={["Ctrl / Cmd", "C / V"]} value="复制 / 粘贴节点，或粘贴剪切板文本/图片" />
                    <Shortcut keys={["Ctrl / Cmd", "Z"]} value="撤销" />
                    <Shortcut keys={["Ctrl / Cmd", "Shift", "Z"]} value="重做" />
                    <Shortcut keys={["Ctrl / Cmd", "Y"]} value="重做" />
                    <Shortcut keys={["Delete / Backspace"]} value="删除选中" />
                    <Shortcut keys={["Esc"]} value="取消选择并关闭浮层" />
                    <Shortcut keys={["拖入图片/视频/音频"]} value="上传到画布" />
                </div>
            </Modal>
            <CanvasPluginManagerModal open={pluginManagerOpen} onClose={() => setPluginManagerOpen(false)} />
        </>
    );
}

function MenuLabel({ text, shortcut }: { text: string; shortcut: string }) {
    return (
        <span className="flex min-w-36 items-center justify-between gap-8">
            <span>{text}</span>
            <span className="text-xs opacity-45">{shortcut}</span>
        </span>
    );
}

function CompactAgentStatus({ status, onClick }: { status: { connected: boolean; enabled: boolean; activity: string }; onClick: () => void }) {
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];
    const label = status.connected ? "已连接到本地 Codex" : status.enabled ? status.activity || "连接中" : "正在连接本地 Codex";
    const dotColor = status.connected ? "#22c55e" : status.enabled ? "#f59e0b" : theme.node.muted;
    return (
        <button
            type="button"
            className="flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-medium transition hover:opacity-85"
            style={{ background: theme.toolbar.panel, color: theme.node.text, boxShadow: "0 10px 30px rgba(28,25,23,.10)" }}
            onClick={onClick}
            title="打开本地 Codex 面板"
        >
            <span className="size-2 rounded-full" style={{ background: dotColor }} />
            <span className="max-w-[180px] truncate">{label}</span>
        </button>
    );
}

function Shortcut({ keys, value }: { keys: string[]; value: string }) {
    return (
        <div className="grid grid-cols-[minmax(0,1fr)_120px] items-center gap-6 rounded-lg px-1 py-1.5">
            <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                {keys.map((key, index) => (
                    <span key={`${key}-${index}`} className="flex items-center gap-1.5">
                        {index ? <span className="text-xs opacity-35">+</span> : null}
                        <kbd
                            className="min-w-9 rounded-md border px-2.5 py-1.5 text-center text-xs font-medium leading-none shadow-[inset_0_-1px_0_rgba(0,0,0,.08),0_1px_2px_rgba(0,0,0,.06)]"
                            style={{ borderColor: "rgba(120,113,108,.28)", background: "linear-gradient(#fff, rgba(245,245,244,.92))", color: "rgb(68,64,60)" }}
                        >
                            {key}
                        </kbd>
                    </span>
                ))}
            </span>
            <span className="text-right text-sm opacity-55">{value}</span>
        </div>
    );
}

function imageExtension(dataUrl: string) {
    return dataUrl.match(/^data:image[/]([^;]+)/)?.[1] || dataUrl.match(/image[/]([^;]+)/)?.[1] || "png";
}

function audioExtension(mimeType?: string) {
    if (mimeType?.includes("wav")) return "wav";
    if (mimeType?.includes("opus")) return "opus";
    if (mimeType?.includes("aac")) return "aac";
    if (mimeType?.includes("flac")) return "flac";
    if (mimeType?.includes("pcm")) return "pcm";
    return "mp3";
}

function imageMetadata(image: UploadedImage): CanvasNodeMetadata {
    return { content: image.url, storageKey: image.storageKey, status: "success", naturalWidth: image.width, naturalHeight: image.height, bytes: image.bytes, mimeType: image.mimeType };
}

function videoMetadata(video: UploadedFile): CanvasNodeMetadata {
    return { content: video.url, storageKey: video.storageKey, status: "success", naturalWidth: video.width, naturalHeight: video.height, bytes: video.bytes, mimeType: video.mimeType || "video/mp4", durationMs: video.durationMs };
}

async function buildStoryboardDramaturgyInstruction(): Promise<StoryboardDramaturgyInstruction> {
    const context = await loadScreenwritingSkillContext();
    if (!context?.files?.length) return { content: STORYBOARD_DRAMATURGY_PROMPT, source: "builtin" };
    return {
        content: [
            STORYBOARD_DRAMATURGY_PROMPT,
            "【运行时读取的项目编剧技能包】",
            "下面规则由项目专用 infinite-canvas-screenwriting skill 实时读取。它只增强剧作判断，不得改变上方 JSON 契约、原文事实、三步审核流程或生成边界。",
            context.root ? `技能包路径：${context.root}` : "",
            ...context.files.map((file) => `--- ${file.path} ---\n${file.content}`),
        ].filter(Boolean).join("\n\n"),
        source: "skill",
        skillRoot: context.root,
    };
}

async function loadScreenwritingSkillContext(): Promise<Seedance20SkillContext | null> {
    if (typeof window === "undefined") return null;
    try {
        const endpoint = (localStorage.getItem("canvas-agent-url") || "http://127.0.0.1:17371").trim().replace(/\/+$/, "");
        const token = (localStorage.getItem("canvas-agent-token") || "").trim();
        if (!endpoint || !token) return null;
        const response = await fetch(`${endpoint}/api/skills/screenwriting/context?token=${encodeURIComponent(token)}`);
        if (!response.ok) return null;
        const data = (await response.json()) as { ok?: boolean } & Seedance20SkillContext;
        return data.ok && data.files?.length ? data : null;
    } catch {
        return null;
    }
}

function applyCompletedVideoToExistingNode(nodes: CanvasNodeData[], nodeId: string, video: UploadedFile, tailFrame: UploadedImage | null, config: AiConfig, prompt: string) {
    const target = nodes.find((node) => node.id === nodeId);
    if (!target) return nodes;
    const videoSize = fitNodeSize(video.width || target.width, video.height || target.height, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
    const completed = nodes.map((node) =>
        node.id === nodeId
            ? {
                  ...node,
                  width: videoSize.width,
                  height: videoSize.height,
                  position: { x: node.position.x + node.width / 2 - videoSize.width / 2, y: node.position.y + node.height / 2 - videoSize.height / 2 },
                  metadata: { ...node.metadata, ...videoMetadata(video), ...storyboardTailFrameMetadata(tailFrame), prompt, model: config.model, size: config.size, seconds: config.videoSeconds, vquality: config.vquality, generateAudio: config.videoGenerateAudio, watermark: config.videoWatermark, videoGenerationProgress: undefined, errorDetails: undefined },
              }
            : node,
    );
    return applyStoryboardTailFrameToNextVideo(completed, target.metadata?.storyboardSourceNodeId, target.metadata?.storyboardRowIndex, tailFrame, target.metadata?.storyboardVideoVariantIndex, target.id);
}

function initialVideoGenerationProgress(): CanvasNodeMetadata["videoGenerationProgress"] {
    return { percent: 8, text: "正在提交视频任务", stage: "submitting" };
}

function clearVideoTaskMetadataPatch(): Partial<CanvasNodeMetadata> {
    return {
        videoTaskId: undefined,
        videoTaskProvider: undefined,
        videoTaskModel: undefined,
        videoTaskEndpoint: undefined,
        videoTaskSubmittedAt: undefined,
        videoTaskRequestMethod: undefined,
        videoTaskRequestUrl: undefined,
        videoTaskRequestModel: undefined,
        videoTaskRequestFields: undefined,
        videoTaskRequestSummary: undefined,
        videoTaskApimartOmniElements: undefined,
        videoGenerationProgress: undefined,
    };
}

function videoTaskMetadata(task: VideoGenerationTask): Partial<CanvasNodeMetadata> {
    return {
        videoTaskId: task.id,
        videoTaskProvider: task.provider,
        videoTaskModel: task.model,
        videoTaskEndpoint: task.cangyuanEndpoint,
        videoTaskSubmittedAt: new Date().toISOString(),
        videoTaskRequestMethod: task.requestMethod,
        videoTaskRequestUrl: task.requestUrl,
        videoTaskRequestModel: task.requestModel,
        videoTaskRequestFields: task.requestFields,
        videoTaskRequestSummary: task.requestSummary,
        videoTaskApimartOmniElements: task.apimartOmniElements,
    };
}

function videoTaskFromMetadata(metadata?: CanvasNodeMetadata, config?: AiConfig): VideoGenerationTask | null {
    if (!metadata?.videoTaskId) return null;
    const model = metadata.videoTaskModel || metadata.model || config?.model || config?.videoModel;
    if (!model) return null;
    const provider = metadata.videoTaskProvider || videoTaskProviderFromConfig(config, model);
    if (!provider) return null;
    return {
        id: metadata.videoTaskId,
        provider,
        model,
        cangyuanEndpoint: provider === "cangyuan" ? metadata.videoTaskEndpoint || cangyuanTaskEndpointFromModel(model) : undefined,
        requestMethod: metadata.videoTaskRequestMethod,
        requestUrl: metadata.videoTaskRequestUrl,
        requestModel: metadata.videoTaskRequestModel,
        requestFields: metadata.videoTaskRequestFields,
        requestSummary: metadata.videoTaskRequestSummary,
        apimartOmniElements: metadata.videoTaskApimartOmniElements,
    };
}

function videoTaskProviderFromConfig(config: AiConfig | undefined, model: string): VideoGenerationTask["provider"] | null {
    if (!config) return null;
    const requestConfig = resolveModelRequestConfig(config, model);
    if (requestConfig.apiFormat === "cangyuan") return "cangyuan";
    if (requestConfig.apiFormat === "ark") return "seedance";
    if (requestConfig.apiFormat === "top-image") return "top-image";
    if (requestConfig.apiFormat === "apimart") return "apimart";
    return "openai";
}

function cangyuanTaskEndpointFromModel(model: string): VideoGenerationTask["cangyuanEndpoint"] {
    return model.toLowerCase().includes("grok-video") ? "video-generations" : "videos";
}

function storyboardTailFrameMetadata(image: UploadedImage | null): Partial<CanvasNodeMetadata> {
    if (!image) return {};
    return { storyboardVideoTailFrameUrl: image.url, storyboardVideoTailFrameStorageKey: image.storageKey };
}

function shouldBackfillStoryboardTailFrame(node: CanvasNodeData, pending: Set<string>, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    return (
        node.type === CanvasNodeType.Video &&
        Boolean(node.metadata?.content || node.metadata?.storageKey) &&
        isStoryboardLinkedVideo(node, nodes, connections) &&
        !node.metadata?.storyboardVideoTailFrameUrl &&
        !node.metadata?.storyboardVideoTailFrameStorageKey &&
        !pending.has(node.id)
    );
}

function isStoryboardLinkedVideo(node: CanvasNodeData, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    if (node.metadata?.storyboardSourceNodeId && node.metadata.storyboardRowIndex !== undefined) return true;
    if (node.metadata?.storyboardVideoDraftNodeId) return true;
    if (storyboardVideoWorkspaceForNode(node.id, nodes)) return true;
    return connections.some((connection) => {
        if (connection.toNodeId !== node.id) return false;
        const source = nodes.find((item) => item.id === connection.fromNodeId);
        return Boolean(source && isStoryboardVideoDraftNode(source));
    });
}

async function extractVideoFrame(videoFile: UploadedFile, role: CanvasVideoFrameRole): Promise<UploadedImage | null> {
    const url = await resolveMediaUrl(videoFile.storageKey, videoFile.url);
    if (!url) return null;
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    const label = role === "first" ? "首帧" : "尾帧";
    const loaded = new Promise<void>((resolve, reject) => {
        video.onloadeddata = () => resolve();
        video.onerror = () => reject(new Error(`视频${label}读取失败`));
    });
    video.src = url;
    await loaded;
    const duration = Number.isFinite(video.duration) ? video.duration : (videoFile.durationMs || 0) / 1000;
    const targetTime = role === "first" ? 0 : Math.max(0, duration - 0.08);
    if (targetTime > 0) {
        await new Promise<void>((resolve, reject) => {
            video.onseeked = () => resolve();
            video.onerror = () => reject(new Error(`视频${label}定位失败`));
            video.currentTime = targetTime;
        });
    }
    const width = video.videoWidth || videoFile.width || 1280;
    const height = video.videoHeight || videoFile.height || 720;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error(`视频${label}提取失败`);
    context.drawImage(video, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    return blob ? uploadImage(blob) : null;
}

async function extractVideoLastFrame(videoFile: UploadedFile): Promise<UploadedImage | null> {
    return extractVideoFrame(videoFile, "last");
}

function audioMetadata(audio: UploadedFile | StoredAudioFile): CanvasNodeMetadata {
    const source = audio as Partial<StoredAudioFile>;
    return { content: audio.url, storageKey: audio.storageKey, status: "success", bytes: audio.bytes, mimeType: audio.mimeType || "audio/mpeg", durationMs: audio.durationMs, voiceboxProfileId: source.voiceboxProfileId, voiceboxProfileName: source.voiceboxProfileName, voiceboxGenerationId: source.voiceboxGenerationId, voiceboxEngine: source.voiceboxEngine };
}

function buildImageGenerationMetadata(type: CanvasImageGenerationType, config: AiConfig, count: number, references: ReferenceImage[]): CanvasNodeMetadata {
    return {
        generationType: type,
        model: config.model,
        size: config.size,
        quality: config.quality,
        ...(config.background ? { background: config.background } : {}),
        count,
        references: references.map(referenceUrl).filter((url): url is string => Boolean(url)),
    };
}

function buildAudioGenerationMetadata(config: AiConfig): CanvasNodeMetadata {
    return {
        model: config.model,
        audioVoice: config.audioVoice,
        audioFormat: config.audioFormat,
        audioSpeed: config.audioSpeed,
        audioInstructions: config.audioInstructions,
    };
}

function referenceUrl(image: ReferenceImage) {
    return image.storageKey || image.url || (!image.dataUrl.startsWith("data:") ? image.dataUrl : undefined);
}

function generationReferenceUrls(context: { referenceImages: ReferenceImage[]; referenceVideos: Array<{ storageKey?: string; url?: string }>; referenceAudios?: Array<{ storageKey?: string; url?: string }> }) {
    return [
        ...context.referenceImages.map(referenceUrl).filter((url): url is string => Boolean(url)),
        ...context.referenceVideos.map((video) => video.storageKey || video.url).filter((url): url is string => Boolean(url)),
        ...(context.referenceAudios || []).map((audio) => audio.storageKey || audio.url).filter((url): url is string => Boolean(url)),
    ];
}

function findReferenceSourceNodes(referenceUrls: string[], nodes: CanvasNodeData[]) {
    if (!referenceUrls.length) return [];
    const referenceSet = new Set(referenceUrls);
    const seen = new Set<string>();
    return nodes.filter((node) => {
        if (seen.has(node.id) || node.type !== CanvasNodeType.Image || !node.metadata?.content) return false;
        const imageRef = sourceNodeReferenceImages(node)[0];
        const candidates = [imageRef ? referenceUrl(imageRef) : undefined, node.metadata.storageKey, node.metadata.content && !node.metadata.content.startsWith("data:") ? node.metadata.content : undefined].filter(Boolean);
        const matched = candidates.some((item) => referenceSet.has(item as string));
        if (matched) seen.add(node.id);
        return matched;
    });
}

async function resolveMetadataReferences(metadata: CanvasNodeMetadata) {
    if (metadata.generationType !== "edit") return [];
    if (!metadata.references?.length) return null;
    const references = await Promise.all(
        metadata.references.map(async (url, index) => {
            const dataUrl = url.startsWith("image:") ? await resolveImageUrl(url, "") : url;
            return dataUrl ? { id: `${index}`, name: `reference-${index}.png`, type: "image/png", dataUrl, storageKey: url.startsWith("image:") ? url : undefined } : null;
        }),
    );
    return references.every(Boolean) ? (references as ReferenceImage[]) : null;
}

async function resolveStoryboardVideoReferences(references?: StoryboardVideoReference[]): Promise<ReferenceImage[]> {
    if (!references?.length) return [];
    const items = await Promise.all(
        sortStoryboardVideoReferences(references).map(async (reference, index): Promise<ReferenceImage | null> => {
            const source = reference.storageKey || reference.url || "";
            const dataUrl = source.startsWith("image:") ? await resolveImageUrl(source, "") : source;
            return dataUrl ? { id: reference.assetId || reference.nodeId || `${index}`, name: `${reference.mention || reference.name || `reference-${index}`}.png`, type: "image/png", dataUrl, url: dataUrl, storageKey: reference.storageKey, videoReferenceRole: reference.role || "reference", referenceKind: reference.kind } : null;
        }),
    );
    return items.filter((item): item is ReferenceImage => Boolean(item));
}

function storyboardVideoFrameContinuityPrompt(references?: StoryboardVideoReference[], prompt?: string) {
    if (!references?.length) return "";
    const relevantReferences = prompt?.trim() ? references.filter((item) => prompt.includes(item.mention) || item.role === "firstFrame" || item.role === "sceneLock" || item.role === "lastFrame") : references;
    const firstFrames = relevantReferences.filter((item) => item.role === "firstFrame");
    const sceneLocks = relevantReferences.filter((item) => item.role === "sceneLock");
    const subjectReferences = relevantReferences.filter((item) => (item.role || "reference") === "reference");
    const lastFrames = relevantReferences.filter((item) => item.role === "lastFrame");
    if (!firstFrames.length && !sceneLocks.length && !subjectReferences.length && !lastFrames.length) return "";
    return [
        firstFrames.length ? `- 以首帧参考图作为视频开始时的画面、角色站位、场景光线和构图基础：${firstFrames.map((item) => item.mention).join("、")}` : "",
        sceneLocks.length ? `- 以场景锁定参考图统一同一地点的空间结构、门窗位置、材质、道具摆放、光线方向和时代质感：${sceneLocks.map((item) => item.mention).join("、")}；如果参考图是多角度 sheet，只用于理解空间关系，不要生成分屏、拼图或多宫格画面。` : "",
        subjectReferences.length ? `- 以主体参考图锁定对应角色的脸型、发型、年龄状态、体态、服装和画风，以及关键道具外观：${subjectReferences.map((item) => item.mention).join("、")}；每张图只控制对应主体，不要混合身份或互换外观。` : "",
        lastFrames.length ? `- 视频动作和镜头运动需要自然过渡到尾帧参考图对应的结束状态：${lastFrames.map((item) => item.mention).join("、")}` : "",
        "- 保持人物身份、服装、场景、光影和空间关系连续；同一镜头只使用一个主运镜，换角度时不要重塑场景结构。",
    ]
        .filter(Boolean)
        .join("\n");
}

function sortStoryboardVideoReferences(references: StoryboardVideoReference[]) {
    const order = { firstFrame: 0, sceneLock: 1, reference: 2, lastFrame: 3 };
    return [...references].sort((a, b) => order[a.role || "reference"] - order[b.role || "reference"]);
}

async function hydrateCanvasImages(nodes: CanvasNodeData[]) {
    return Promise.all(
        nodes.map(async (node) => {
            const content = node.metadata?.content;
            const storyboardAssets = node.metadata?.storyboardAssets?.length
                ? await Promise.all(
                      node.metadata.storyboardAssets.map(async (asset) => ({
                          ...asset,
                          imageUrl: await resolveImageUrl(asset.storageKey, asset.imageUrl),
                          voiceAudioUrl: await resolveMediaUrl(asset.voiceAudioStorageKey, asset.voiceAudioUrl),
                          voiceAudioCandidates: asset.voiceAudioCandidates?.length
                              ? await Promise.all(asset.voiceAudioCandidates.map(async (candidate) => ({ ...candidate, url: await resolveMediaUrl(candidate.storageKey, candidate.url) })))
                              : asset.voiceAudioCandidates,
                      })),
                  )
                : undefined;
            const metadata = storyboardAssets ? { ...node.metadata, storyboardAssets } : node.metadata;
            if ((node.type === CanvasNodeType.Video || node.type === CanvasNodeType.Audio) && node.metadata?.storageKey) return { ...node, metadata: { ...node.metadata, content: await resolveMediaUrl(node.metadata.storageKey, content) } };
            if (node.type !== CanvasNodeType.Image || !content) return metadata === node.metadata ? node : { ...node, metadata };
            if (node.metadata?.storageKey) return { ...node, metadata: { ...metadata, content: await resolveImageUrl(node.metadata.storageKey, content) } };
            if (!content.startsWith("data:image/")) return metadata === node.metadata ? node : { ...node, metadata };
            return { ...node, metadata: { ...metadata, ...imageMetadata(await uploadImage(content)) } };
        }),
    );
}

async function hydrateAssistantImages(sessions: CanvasAssistantSession[]) {
    const hydrateItem = async <T extends { dataUrl?: string; storageKey?: string }>(item: T) => {
        if (item.storageKey) return { ...item, dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl) };
        if (item.dataUrl?.startsWith("data:image/")) {
            const image = await uploadImage(item.dataUrl);
            return { ...item, dataUrl: image.url, storageKey: image.storageKey };
        }
        return item;
    };
    return Promise.all(
        sessions.map(async (session) => ({
            ...session,
            messages: await Promise.all(
                session.messages.map(async (message) => ({
                    ...message,
                    references: await Promise.all((message.references || []).map(hydrateItem)),
                })),
            ),
        })),
    );
}

function getGenerationCount(count: string) {
    return Math.max(1, Math.min(15, Math.floor(Math.abs(Number(count)) || 1)));
}

function storyboardVideoSettingsPatchFromText(text: string): Partial<CanvasNodeMetadata> {
    const source = storyboardVideoSettingsSource(text);
    if (!source) return {};
    const patch: Partial<CanvasNodeMetadata> = {};
    const resolution = parseStoryboardVideoResolution(source);
    const ratio = parseStoryboardVideoRatio(source);
    const seconds = parseStoryboardVideoSeconds(source);
    const generateAudio = parseStoryboardVideoBoolean(source, /(生成声音|生成音频|generate_audio|audio)/i);
    const watermark = parseStoryboardVideoBoolean(source, /(水印|watermark)/i);
    if (resolution) patch.vquality = resolution;
    if (ratio) patch.size = ratio;
    if (seconds) patch.seconds = seconds;
    if (generateAudio !== undefined) patch.generateAudio = String(generateAudio);
    if (watermark !== undefined) patch.watermark = String(watermark);
    return patch;
}

function storyboardVideoSettingsOnlyPatch(patch: Partial<CanvasNodeMetadata>): Partial<CanvasNodeMetadata> {
    const settings: Partial<CanvasNodeMetadata> = {};
    if (patch.size !== undefined) settings.size = patch.size;
    if (patch.vquality !== undefined) settings.vquality = patch.vquality;
    if (patch.seconds !== undefined) settings.seconds = patch.seconds;
    if (patch.generateAudio !== undefined) settings.generateAudio = patch.generateAudio;
    if (patch.watermark !== undefined) settings.watermark = patch.watermark;
    return settings;
}

function storyboardVideoSettingsFallbackPatch(node: CanvasNodeData, text: string): Partial<CanvasNodeMetadata> {
    const parsed = storyboardVideoSettingsPatchFromText(text);
    const patch: Partial<CanvasNodeMetadata> = {};
    if (!node.metadata?.size && parsed.size) patch.size = parsed.size;
    if (!node.metadata?.vquality && parsed.vquality) patch.vquality = parsed.vquality;
    if (!node.metadata?.seconds && parsed.seconds) patch.seconds = parsed.seconds;
    if (!node.metadata?.generateAudio) patch.generateAudio = parsed.generateAudio === undefined ? "true" : parsed.generateAudio;
    if (!node.metadata?.watermark && parsed.watermark) patch.watermark = parsed.watermark;
    return patch;
}

function withStoryboardVideoSettings(node: CanvasNodeData): CanvasNodeData {
    const patch = storyboardVideoSettingsFallbackPatch(node, storyboardSourceTextForNode(node));
    return Object.keys(patch).length ? { ...node, metadata: { ...node.metadata, ...patch } } : node;
}

function storyboardNodeSize(type: CanvasNodeType.Image | CanvasNodeType.Video, size?: string) {
    const spec = NODE_DEFAULT_SIZE[type];
    return size ? nodeSizeFromRatio(size, spec.width, spec.height) || spec : spec;
}

function storyboardVideoSettingsSource(text: string) {
    const lines = (text || "").split(/\r?\n/);
    const chunks: string[] = [];
    const headerPattern = /(视频生成设置|视频设置|视频参数|视频规格|生成视频设置|video\s*(settings?|config|params?|parameters?)?\s*[:：])/i;
    const inlinePattern = /(视频|video|seedance).*(分辨率|清晰度|比例|尺寸|时长|秒数|resolution|aspect|ratio|duration)/i;
    lines.forEach((line, index) => {
        if (!headerPattern.test(line) && !inlinePattern.test(line)) return;
        chunks.push(lines.slice(index, index + 8).join("\n"));
    });
    return chunks.join("\n").trim();
}

function parseStoryboardVideoResolution(source: string) {
    const match = source.match(/\b(480|720|1080)\s*p\b/i) || source.match(/(?:分辨率|清晰度|resolution)[^\d]*(480|720|1080)/i);
    return match ? `${match[1]}p` : "";
}

function parseStoryboardVideoRatio(source: string) {
    const compact = source.replace(/\s+/g, "");
    const ratioMatch = compact.match(/(21:9|16:9|9:16|4:3|3:4|1:1)/);
    if (ratioMatch) return ratioMatch[1];
    const sizeMatch = compact.match(/(\d{3,4})[x×*](\d{3,4})/i);
    if (sizeMatch) return ratioFromDimensions(Number(sizeMatch[1]), Number(sizeMatch[2]));
    if (/自适应|adaptive/i.test(source)) return "adaptive";
    if (/标准横屏/.test(source)) return "4:3";
    if (/标准竖屏/.test(source)) return "3:4";
    if (/宽银幕|超宽|cinema|widescreen/i.test(source)) return "21:9";
    if (/方形|正方形|square/i.test(source)) return "1:1";
    if (/竖屏|竖版|portrait/i.test(source)) return "9:16";
    if (/横屏|横版|landscape/i.test(source)) return "16:9";
    return "";
}

function ratioFromDimensions(width: number, height: number) {
    if (!width || !height) return "";
    const ratio = width / height;
    const options = [
        ["16:9", 16 / 9],
        ["4:3", 4 / 3],
        ["1:1", 1],
        ["3:4", 3 / 4],
        ["9:16", 9 / 16],
        ["21:9", 21 / 9],
    ] as const;
    return options.reduce((best, item) => (Math.abs(item[1] - ratio) < Math.abs(best[1] - ratio) ? item : best), options[0])[0];
}

function parseStoryboardVideoSeconds(source: string) {
    if (/(智能|auto|adaptive)/i.test(source) && /(时长|秒数|duration)/i.test(source)) return "-1";
    const labeled = source.match(/(?:时长|秒数|duration)[^\d-]*(1[0-5]|[4-9])\s*(?:s|秒)?/i);
    const compact = source.match(/\b(1[0-5]|[4-9])\s*(?:s|秒)\b/i);
    return labeled?.[1] || compact?.[1] || "";
}

function parseStoryboardVideoBoolean(source: string, keyPattern: RegExp) {
    const line = source
        .split(/\r?\n|[，,；;]/)
        .find((item) => keyPattern.test(item));
    if (!line) return undefined;
    if (/(false|off|关闭|不要|不生成|无|否)/i.test(line)) return false;
    if (/(true|on|开启|打开|生成|需要|是)/i.test(line)) return true;
    return undefined;
}

function applyNodeConfigPatch(node: CanvasNodeData, patch: Partial<CanvasNodeData["metadata"]>) {
    const safePatch = patch || {};
    const next = { ...node, metadata: { ...node.metadata, ...safePatch } };
    const spec = node.type === CanvasNodeType.Video ? NODE_DEFAULT_SIZE[CanvasNodeType.Video] : NODE_DEFAULT_SIZE[CanvasNodeType.Image];
    const size = typeof safePatch.size === "string" && !node.metadata?.content ? nodeSizeFromRatio(safePatch.size, spec.width, spec.height) : null;
    return size && (node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video) ? { ...next, ...size, position: { x: node.position.x + node.width / 2 - size.width / 2, y: node.position.y + node.height / 2 - size.height / 2 } } : next;
}

function clearPromptAssistantPendingPatch(): Partial<CanvasNodeMetadata> {
    return {
        promptAssistantPendingPrompt: "",
        promptAssistantStatus: undefined,
        promptAssistantError: undefined,
        promptAssistantRequestId: undefined,
    };
}

function getConnectionTargetAnchor(node: CanvasNodeData, current: ConnectionHandle) {
    return {
        x: current.handleType === "source" ? node.position.x : node.position.x + node.width,
        y: node.position.y + node.height / 2,
    };
}

function findGroupDropTarget(movedIds: Set<string>, nodes: CanvasNodeData[]) {
    if (nodes.some((node) => movedIds.has(node.id) && (node.type === CanvasNodeType.Group || node.type === CanvasNodeType.Workspace))) return null;
    const movingNodes = nodes.filter((node) => movedIds.has(node.id) && node.type !== CanvasNodeType.Group && node.type !== CanvasNodeType.Workspace);
    if (!movingNodes.length) return null;
    return (
        [...nodes]
            .reverse()
            .find((group) => {
                if (group.type !== CanvasNodeType.Group || movedIds.has(group.id)) return false;
                return movingNodes.some((node) => {
                    const centerX = node.position.x + node.width / 2;
                    const centerY = node.position.y + node.height / 2;
                    return centerX >= group.position.x && centerX <= group.position.x + group.width && centerY >= group.position.y && centerY <= group.position.y + group.height;
                });
            }) || null
    );
}

function snapNodesIntoGroup(movedIds: Set<string>, nodes: CanvasNodeData[], group: CanvasNodeData) {
    const movingNodes = nodes.filter((node) => movedIds.has(node.id) && node.type !== CanvasNodeType.Group && node.type !== CanvasNodeType.Workspace);
    if (!movingNodes.length) return nodes;
    const pad = 24;
    const bounds = nodeBounds(movingNodes);
    const left = group.position.x + pad;
    const top = group.position.y + pad;
    const right = group.position.x + group.width - pad;
    const bottom = group.position.y + group.height - pad;
    const dx = bounds.right - bounds.left > right - left ? left - bounds.left : bounds.left < left ? left - bounds.left : bounds.right > right ? right - bounds.right : 0;
    const dy = bounds.bottom - bounds.top > bottom - top ? top - bounds.top : bounds.top < top ? top - bounds.top : bounds.bottom > bottom ? bottom - bounds.bottom : 0;
    return nodes.map((node) => {
        if (!movedIds.has(node.id) || node.type === CanvasNodeType.Group || node.type === CanvasNodeType.Workspace) return node;
        return { ...node, position: { x: node.position.x + dx, y: node.position.y + dy }, metadata: { ...node.metadata, groupId: group.id } };
    });
}

function nodeBounds(nodes: CanvasNodeData[]) {
    return nodes.reduce(
        (acc, node) => ({ left: Math.min(acc.left, node.position.x), top: Math.min(acc.top, node.position.y), right: Math.max(acc.right, node.position.x + node.width), bottom: Math.max(acc.bottom, node.position.y + node.height) }),
        { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
    );
}

function findContainingGroupId(node: CanvasNodeData, nodes: CanvasNodeData[]) {
    const centerX = node.position.x + node.width / 2;
    const centerY = node.position.y + node.height / 2;
    return [...nodes].reverse().find((group) => group.type === CanvasNodeType.Group && group.id !== node.id && centerX >= group.position.x && centerX <= group.position.x + group.width && centerY >= group.position.y && centerY <= group.position.y + group.height)?.id || undefined;
}

function normalizeConnection(firstNodeId: string, secondNodeId: string, nodes: CanvasNodeData[], firstHandleType: "source" | "target") {
    const first = nodes.find((node) => node.id === firstNodeId);
    const second = nodes.find((node) => node.id === secondNodeId);
    if (!first || !second || first.id === second.id) return null;
    if (first.type === CanvasNodeType.Group || second.type === CanvasNodeType.Group) return null;
    if (first.type === CanvasNodeType.Config && second.type === CanvasNodeType.Config) return null;
    if (second.type === CanvasNodeType.Config) return { fromNodeId: first.id, toNodeId: second.id };
    if (first.type === CanvasNodeType.Config && firstHandleType === "target") return { fromNodeId: second.id, toNodeId: first.id };
    if (first.type === CanvasNodeType.Config) return { fromNodeId: first.id, toNodeId: second.id };
    if (firstHandleType === "target") return { fromNodeId: second.id, toNodeId: first.id };
    return { fromNodeId: first.id, toNodeId: second.id };
}

function getInputSummary(inputs: NodeGenerationInput[]) {
    return {
        textCount: inputs.filter((input) => input.type === "text").length,
        imageCount: inputs.filter((input) => input.type === "image").length,
        videoCount: inputs.filter((input) => input.type === "video").length,
        audioCount: inputs.filter((input) => input.type === "audio").length,
    };
}

function buildGenerationConfig(config: AiConfig, node: CanvasNodeData | undefined, mode: CanvasNodeGenerationMode): AiConfig {
    const defaultModel = mode === "image" ? config.imageModel : mode === "video" ? config.videoModel : mode === "audio" ? config.audioModel : config.textModel;
    const model = node?.metadata?.model || defaultModel || (mode === "audio" ? defaultConfig.audioModel : config.model || defaultConfig.model);
    return {
        ...config,
        model,
        ...(mode === "video" ? { videoModel: model } : {}),
        quality: node?.metadata?.quality || config.quality || defaultConfig.quality,
        size: node?.metadata?.size || config.size || defaultConfig.size,
        background: node?.metadata?.background ?? config.background ?? defaultConfig.background,
        videoSeconds: node?.metadata?.seconds || config.videoSeconds || defaultConfig.videoSeconds,
        vquality: node?.metadata?.vquality || config.vquality || defaultConfig.vquality,
        videoGenerateAudio: node?.metadata?.generateAudio || config.videoGenerateAudio || defaultConfig.videoGenerateAudio,
        videoWatermark: node?.metadata?.watermark || config.videoWatermark || defaultConfig.videoWatermark,
        audioVoice: node?.metadata?.audioVoice || config.audioVoice || defaultConfig.audioVoice,
        audioFormat: node?.metadata?.audioFormat || config.audioFormat || defaultConfig.audioFormat,
        audioSpeed: node?.metadata?.audioSpeed || config.audioSpeed || defaultConfig.audioSpeed,
        audioInstructions: node?.metadata?.audioInstructions || config.audioInstructions || defaultConfig.audioInstructions,
        count: String(node?.metadata?.count || (mode === "image" ? config.canvasImageCount || config.count : config.count) || defaultConfig.count),
    };
}

function resetInterruptedGeneration(nodes: CanvasNodeData[]): CanvasNodeData[] {
    return nodes.map((node) => {
        const hasInterruptedAssets = node.type === CanvasNodeType.Script && (node.metadata?.storyboardAssets || []).some((asset) => asset.status === NODE_STATUS_LOADING);
        if (node.type === CanvasNodeType.Script && node.metadata && (node.metadata.storyboardAssetBatchProgress?.status === "running" || hasInterruptedAssets)) {
            const assets = (node.metadata.storyboardAssets || []).map((asset) => asset.status === NODE_STATUS_LOADING ? { ...asset, status: NODE_STATUS_IDLE, errorDetails: undefined } : asset);
            const completed = assets.filter(storyboardAssetReady).length;
            const failed = assets.filter((asset) => asset.status === NODE_STATUS_ERROR).length;
            return { ...node, metadata: { ...node.metadata, storyboardAssets: assets, storyboardAssetBatchProgress: { status: "interrupted" as const, total: assets.length, completed, failed } } };
        }
        if (node.metadata?.status !== NODE_STATUS_LOADING) return node;
        if (node.type === CanvasNodeType.Video && node.metadata.videoTaskId && !node.metadata.content) {
            return { ...node, metadata: { ...node.metadata, status: NODE_STATUS_LOADING, errorDetails: "页面刷新中断了结果接收，正在查询原任务。", videoGenerationProgress: { percent: 16, text: `正在恢复平台任务：${node.metadata.videoTaskId}`, stage: "submitted" as const } } };
        }
        return { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, errorDetails: "页面刷新后生成已中断，请重新生成。" } };
    });
}

function shouldRecoverVideoTask(node: CanvasNodeData) {
    return node.type === CanvasNodeType.Video && Boolean(node.metadata?.videoTaskId) && !node.metadata?.content && (node.metadata?.status === NODE_STATUS_LOADING || node.metadata?.status === NODE_STATUS_ERROR);
}

function isGenerationCanceled(error: unknown) {
    return error instanceof Error && (error.message === "请求已取消" || error.name === "AbortError");
}

function isClipboardPermissionError(error: unknown) {
    return error instanceof DOMException ? error.name === "NotAllowedError" || error.name === "SecurityError" : /clipboard|permission|notallowed|denied/i.test(String(error));
}

function findRetrySourceNode(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const queue = connections.filter((connection) => connection.toNodeId === nodeId).map((connection) => connection.fromNodeId);
    const visited = new Set<string>();
    while (queue.length) {
        const id = queue.shift()!;
        if (visited.has(id)) continue;
        visited.add(id);
        const node = nodes.find((item) => item.id === id);
        if (node?.type === CanvasNodeType.Config) return node;
        connections.filter((connection) => connection.toNodeId === id).forEach((connection) => queue.push(connection.fromNodeId));
    }
    return null;
}

function sourceNodeReferenceImages(node: CanvasNodeData | null) {
    if (!node || node.type !== CanvasNodeType.Image || !node.metadata?.content) return [];
    return [
        {
            id: node.id,
            name: `${node.title || node.id}.png`,
            type: node.metadata.mimeType || "image/png",
            dataUrl: node.metadata.content,
            storageKey: node.metadata.storageKey,
        },
    ];
}

function isAudioFile(file: File) {
    return file.type.startsWith("audio/") || /\.(mp3|wav)$/i.test(file.name);
}

function isHiddenBatchChild(node: CanvasNodeData, nodes: CanvasNodeData[], collapsingBatchIds?: Set<string>) {
    const rootId = node.metadata?.batchRootId;
    if (!rootId) return false;
    const root = nodes.find((item) => item.id === rootId);
    if (root && collapsingBatchIds?.has(rootId)) return false;
    return Boolean(root && !root.metadata?.imageBatchExpanded);
}

function isHiddenStoryboardVideoResult(node: CanvasNodeData, nodes: CanvasNodeData[]) {
    const draftId = node.metadata?.storyboardVideoDraftNodeId;
    if (!draftId) return false;
    const draft = nodes.find((item) => item.id === draftId);
    const latestId = draft?.metadata?.storyboardVideoLatestResultNodeId;
    return Boolean(latestId && nodes.some((item) => item.id === latestId) && latestId !== node.id);
}

function isHiddenCanvasNode(node: CanvasNodeData, nodes: CanvasNodeData[], collapsingBatchIds?: Set<string>) {
    return isHiddenBatchChild(node, nodes, collapsingBatchIds) || isHiddenStoryboardVideoResult(node, nodes);
}

function isHiddenBatchConnectionEndpoint(node: CanvasNodeData, nodes: CanvasNodeData[]) {
    const rootId = node.metadata?.batchRootId;
    if (!rootId) return false;
    const root = nodes.find((item) => item.id === rootId);
    return Boolean(root && !root.metadata?.imageBatchExpanded);
}

function isHiddenCanvasConnectionEndpoint(node: CanvasNodeData, nodes: CanvasNodeData[]) {
    return isHiddenBatchConnectionEndpoint(node, nodes) || isHiddenStoryboardVideoResult(node, nodes);
}

function isWorkspaceChildConnection(connection: CanvasConnection, from: CanvasNodeData, to: CanvasNodeData) {
    return from.type === CanvasNodeType.Workspace && connection.fromNodeId === from.id && from.metadata?.workspaceChildNodeIds?.includes(to.id);
}

function addUniqueConnections(current: CanvasConnection[], next: CanvasConnection[]) {
    const existing = new Set(current.map((connection) => `${connection.fromNodeId}->${connection.toNodeId}`));
    const additions = next.filter((connection) => {
        const key = `${connection.fromNodeId}->${connection.toNodeId}`;
        if (existing.has(key)) return false;
        existing.add(key);
        return true;
    });
    return additions.length ? [...current, ...additions] : current;
}

function nextVideoInputConnections(sourceNode: CanvasNodeData | undefined, targetNodeId: string, connections: CanvasConnection[]) {
    if (!sourceNode) return [];
    const incoming = sourceNode.type === CanvasNodeType.Video && sourceNode.metadata?.content ? connections.filter((connection) => connection.toNodeId === sourceNode.id) : [];
    const sourceIds = incoming.length ? incoming.map((connection) => connection.fromNodeId) : [sourceNode.id];
    return sourceIds.map((fromNodeId) => ({ id: nanoid(), fromNodeId, toNodeId: targetNodeId }));
}

function shouldUseMultiViewGrid(prompt: string, metadata?: CanvasNodeData["metadata"]) {
    if (metadata?.disableAutoMultiView || metadata?.sceneViewRole) return false;
    if (metadata?.enableMultiViewGrid) return true;
    return /\b(?:2x2|split screen|multi[-\s]?view|four views?|4\s*(?:views?|angles?))\b|四宫格|四视图|多视图|分屏|拼图/i.test(prompt);
}

function parseStoryboardTable(content: string) {
    const rows = content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.includes("|"))
        .map((line) => line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim()));
    return rows.filter((row) => row.length >= 9 && !isStoryboardDividerRow(row)).slice(0, STORYBOARD_ROW_LIMIT);
}

function parseStoryboardLoose(content: string) {
    const jsonRows = parseStoryboardJson(content);
    if (jsonRows.length) return jsonRows;

    const tableRows = parseStoryboardTable(content);
    if (tableRows.length) return tableRows;

    const delimitedRows = content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => (line.includes("\t") ? line.split("\t") : parseCsvLine(line)).map((cell) => cell.trim()))
        .filter((row) => row.length >= 3);
    if (delimitedRows.some((row) => row.length >= 9)) return delimitedRows.map(normalizeStoryboardImportRow).slice(0, STORYBOARD_ROW_LIMIT);

    return parseStoryboardColonBlocks(content).slice(0, STORYBOARD_ROW_LIMIT);
}

function stripStoryboardHeader(rows: string[][]) {
    return rows.filter((row, index) => !isStoryboardDividerRow(row) && !(index === 0 && isStoryboardHeaderRow(row))).map(normalizeStoryboardImportRow).slice(0, STORYBOARD_ROW_LIMIT);
}

function normalizeStoryboardImportRow(row: string[]) {
    return STORYBOARD_COLUMNS.map((_, index) => row[index] || "");
}

function isStoryboardHeaderRow(row: string[]) {
    const joined = row.join("|");
    return joined.includes("镜号") || joined.includes("画面描述") || joined.includes("分镜画面提示词") || joined.includes("最终提示词");
}

function isStoryboardDividerRow(row: string[]) {
    return row.every((cell) => /^:?-{2,}:?$/.test(cell.trim()));
}

function parseCsvLine(line: string) {
    const cells: string[] = [];
    let cell = "";
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
        const char = line[index];
        const next = line[index + 1];
        if (char === '"' && quoted && next === '"') {
            cell += '"';
            index += 1;
        } else if (char === '"') {
            quoted = !quoted;
        } else if (char === "," && !quoted) {
            cells.push(cell);
            cell = "";
        } else {
            cell += char;
        }
    }
    cells.push(cell);
    return cells.length > 1 ? cells : [line];
}

function parseStoryboardJson(content: string) {
    const start = content.search(/[\[{]/);
    if (start < 0) return [];
    const end = Math.max(content.lastIndexOf("]"), content.lastIndexOf("}"));
    if (end <= start) return [];
    try {
        const data = JSON.parse(content.slice(start, end + 1));
        const list = Array.isArray(data) ? data : data.rows || data.storyboard || data.storyboards || data.shots || data.items;
        if (!Array.isArray(list)) return [];
        return list
            .map((item) => {
                if (Array.isArray(item)) return item.map(String);
                if (!item || typeof item !== "object") return [];
                const record = item as Record<string, unknown>;
                return STORYBOARD_COLUMNS.map((column) => String(record[column] ?? record[column.replace(/\s/g, "")] ?? ""));
            })
            .filter((row) => row.some(Boolean));
    } catch {
        return [];
    }
}

function parseStoryboardColonBlocks(content: string) {
    const keyToIndex: Record<string, number> = {
        镜号: 0,
        镜头: 0,
        序号: 0,
        时长: 1,
        时间: 1,
        画面描述: 2,
        画面: 2,
        内容: 2,
        景别: 3,
        光影氛围: 4,
        光影: 4,
        氛围: 4,
        对白旁白: 5,
        对白: 5,
        旁白: 5,
        台词: 5,
        音效: 6,
        声音: 6,
        运镜: 7,
        镜头运动: 7,
        分镜画面提示词: 8,
        画面提示词: 8,
        分镜提示词: 8,
        最终提示词: 8,
        提示词: 8,
        生图提示词: 8,
    };
    const rows: string[][] = [];
    let current = normalizeStoryboardImportRow([]);
    const push = () => {
        if (current.some((cell, index) => index > 0 && cell.trim())) rows.push(current);
        current = normalizeStoryboardImportRow([]);
    };

    content.split(/\r?\n/).forEach((rawLine) => {
        const line = rawLine.trim().replace(/^[-*]\s*/, "");
        if (!line) {
            push();
            return;
        }
        const match = line.match(/^([^:：]{1,12})[:：]\s*(.*)$/);
        if (!match) return;
        const key = match[1].replace(/[\\/]/g, "").trim();
        const colIndex = keyToIndex[key];
        if (colIndex === undefined) return;
        if (colIndex === 0 && current.some((cell, index) => index > 0 && cell.trim())) push();
        current[colIndex] = match[2].trim();
    });
    push();
    return rows;
}

function parseStoryboardRows(rows?: string[][]) {
    const source = rows?.length ? rows : [];
    return source[0]?.join("|").includes("镜号") ? source.slice(1) : source;
}

function storyboardActiveRowIndexes(node: CanvasNodeData, rows: string[][]) {
    const activeEpisodeId = node.metadata?.storyboardActiveChapterId || node.metadata?.storyboardChapters?.[0]?.id;
    if (!activeEpisodeId) return rows.map((_, index) => index);
    return rows.map((_, index) => index).filter((index) => node.metadata?.storyboardShotPlans?.[String(index)]?.chapterId === activeEpisodeId);
}

function storyboardActiveAssets(node: CanvasNodeData) {
    return storyboardAssetsForEpisode(node, node.metadata?.storyboardActiveChapterId || node.metadata?.storyboardChapters?.[0]?.id);
}

function storyboardAssetsForEpisode(node: CanvasNodeData, episodeId?: string) {
    return (node.metadata?.storyboardAssets || []).filter((asset) => !episodeId || asset.chapterIds === undefined || asset.chapterIds.includes(episodeId));
}

function storyboardPromptCandidateAssets(assets: StoryboardAsset[], chapterId?: string) {
    const episodeAssets = assets.filter((asset) => !chapterId || asset.chapterIds === undefined || asset.chapterIds.includes(chapterId));
    const episodeAssetIds = new Set(episodeAssets.map((asset) => asset.id));
    return [...episodeAssets, ...assets.filter((asset) => asset.kind === "prop" && !episodeAssetIds.has(asset.id))];
}

async function runLimited<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (nextIndex < items.length) {
            const item = items[nextIndex++];
            await worker(item);
        }
    });
    await Promise.all(workers);
}

function createLinkedAbortController(parent: AbortController) {
    const controller = new AbortController();
    if (parent.signal.aborted) {
        controller.abort();
    } else {
        parent.signal.addEventListener("abort", () => controller.abort(), { once: true });
    }
    return controller;
}

async function storyboardAssetReferenceImage(asset: StoryboardAsset): Promise<ReferenceImage | null> {
    if (!asset.imageUrl && !asset.storageKey) return null;
    const dataUrl = await imageToDataUrl({ url: asset.imageUrl, storageKey: asset.storageKey });
    if (!dataUrl) return null;
    return {
        id: asset.id,
        name: `${asset.name || "asset"}.png`,
        type: "image/png",
        dataUrl,
        url: asset.imageUrl,
        storageKey: asset.storageKey,
    };
}

function storyboardAssetSceneSheetReference(asset: StoryboardAsset): ReferenceImage | null {
    const source = asset.sceneSheetUrl || asset.sceneSheetStorageKey || "";
    if (!source) return null;
    return {
        id: `${asset.id}:scene-sheet`,
        name: `${asset.name || "scene"}-scene-sheet.png`,
        type: "image/png",
        dataUrl: source,
        url: source,
        storageKey: asset.sceneSheetStorageKey,
        referenceKind: "scene",
    };
}

function storyboardSceneSheetVideoReference(asset: StoryboardAsset, image?: Pick<UploadedImage, "url" | "storageKey">): StoryboardVideoReference | null {
    const url = image?.url || asset.sceneSheetUrl || "";
    const storageKey = image?.storageKey || asset.sceneSheetStorageKey;
    if (!url && !storageKey) return null;
    return {
        mention: `@${asset.name}-多角度锁定图`,
        name: `${asset.name}-多角度锁定图`,
        status: "bound",
        assetId: asset.id,
        kind: "scene",
        url,
        storageKey,
        role: "sceneLock",
        sceneViewRole: "lock",
        source: "script",
    };
}

function storyboardAssetVoiceAudioReference(asset: StoryboardAsset, audio?: { url?: string; storageKey?: string; durationMs?: number }): StoryboardAudioReference | null {
    const url = audio?.url || asset.voiceAudioUrl || "";
    const storageKey = audio?.storageKey || asset.voiceAudioStorageKey;
    if (!url && !storageKey) return null;
    return {
        mention: `@${asset.name}-声音设定`,
        name: `${asset.name}-声音设定`,
        status: "bound",
        assetId: asset.id,
        kind: "character",
        url,
        storageKey,
        durationMs: audio?.durationMs || asset.voiceAudioDurationMs,
        role: "voiceLock",
        source: "script",
    };
}

type StoryboardAssetVoiceProfile = {
    age: string;
    gender: string;
    role: string;
    speed: string;
    instructions: string;
    sampleText: string;
};

function storyboardAssetVoiceProfile(asset: StoryboardAsset, style: string | undefined, config: AiConfig): StoryboardAssetVoiceProfile {
    const identity = [asset.baseName, asset.name, asset.lifeStage].filter(Boolean).join("，");
    const source = [asset.baseName, asset.name, asset.lifeStage, asset.description, asset.prompt].filter(Boolean).join("，");
    const identityGender = storyboardAssetVoiceGender(identity);
    const gender = identityGender === "neutral" ? storyboardAssetVoiceGender(source) : identityGender;
    const identityAge = storyboardAssetVoiceAge(identity);
    const age = identityAge === "adult" && !/成年|父亲|母亲|爸爸|妈妈/.test(identity) ? storyboardAssetVoiceAge(source) : identityAge;
    const role = storyboardAssetVoiceRole(source, age);
    const years = storyboardAssetVoiceAgeYears(source);
    const speed = storyboardAssetVoiceSpeed(age, role, config.audioSpeed);
    const demographic = storyboardAssetVoiceDemographic(gender, age, years);
    const trait = storyboardAssetVoiceTrait(gender, age, role);
    const personality = storyboardAssetVoicePersonality(source);
    const accent = storyboardAssetVoiceAccent(source);
    const performance = storyboardAssetVoiceProjectStyle(style);
    const sampleText = storyboardAssetVoiceSampleTextForProfile(gender, age, role);
    const instructions = [demographic, trait, personality, accent, performance, "自然口语，气息真实，不要播音腔，只朗读输入台词"].filter(Boolean).join("，");
    return { age, gender, role, speed, instructions, sampleText };
}

function storyboardAssetVoicePrompt(asset: StoryboardAsset, style?: string, profile?: StoryboardAssetVoiceProfile) {
    return profile?.instructions || storyboardAssetVoiceProfile(asset, style, defaultConfig).instructions;
}

function storyboardAssetVoiceSampleText(asset: StoryboardAsset, profile?: StoryboardAssetVoiceProfile, scriptNode?: CanvasNodeData) {
    if (profile?.age === "baby") return profile.sampleText;
    const scripted = scriptNode ? storyboardAssetScriptDialogueSampleText(scriptNode, asset) : "";
    if (scripted) return scripted;
    if (profile?.sampleText) return profile.sampleText;
    const source = [asset.description, asset.prompt].join("\n");
    const quoted = source.match(/[“"{｛]([^”"}｝]{4,40})[”"}｝]/)?.[1]?.trim();
    if (quoted) return quoted;
    const age = storyboardAssetVoiceAge(source);
    return storyboardAssetVoiceSampleTextForProfile(storyboardAssetVoiceGender(source), age, storyboardAssetVoiceRole(source, age));
}

function storyboardAssetScriptDialogueSampleText(scriptNode: CanvasNodeData, asset: StoryboardAsset) {
    const rows = scriptNode.metadata?.storyboardRows || [];
    if (!rows.length) return "";
    const names = Array.from(new Set([asset.baseName, asset.name, asset.name ? `@${asset.name}` : "", ...asset.name.split(/[·、，,\s/]+/)].map((item) => item?.trim() || "").filter((item) => item.length >= 2)));
    const candidates: string[] = [];
    rows.forEach((row) => {
        const dialogueSource = row[5] || "";
        if (!names.some((name) => dialogueSource.includes(name))) return;
        const dialogue = storyboardCleanVoiceDialogue(dialogueSource, names);
        if (dialogue) candidates.push(dialogue);
    });
    return compactStoryboardVoiceSample(candidates.join(" "));
}

function storyboardCleanVoiceDialogue(text: string, names: string[]) {
    const source = text
        .replace(/<[^>]+>/g, " ")
        .replace(/（[^）]*(?:音乐|音效|环境音|字幕|无对白)[^）]*）/g, " ")
        .replace(/\([^)]*(?:音乐|音效|环境音|字幕|无对白)[^)]*\)/g, " ")
        .trim();
    if (!source || /^(无|无对白|空|none|n\/a)$/i.test(source)) return "";
    const quoted = Array.from(source.matchAll(/[“"{｛]([^”"}｝]{4,80})[”"}｝]/g)).map((match) => match[1].trim());
    if (quoted.length) return compactStoryboardVoiceSample(quoted.join(" "));
    const namePattern = names.map(escapeRegExp).join("|");
    const matched = namePattern ? source.match(new RegExp(`(?:${namePattern})\\s*[：:，,]?\\s*([^。！？!?；;\\n]{4,80})`)) : null;
    const withoutSpeaker = (matched?.[1] || source).replace(/^[^：:\n]{1,12}[：:]/, "").trim();
    return compactStoryboardVoiceSample(withoutSpeaker);
}

function compactStoryboardVoiceSample(text: string) {
    const normalized = text.replace(/\s+/g, " ").replace(/^[：:，,。；;、\s]+/, "").trim();
    if (normalized.length <= 48) return normalized;
    return `${normalized.slice(0, 48).replace(/[，,、；;：:。！？!?]*$/, "")}。`;
}

function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function storyboardAssetVoiceGender(source: string) {
    if (/父亲|爸爸|爹|哥哥|弟弟|兄长|叔叔|伯父|爷爷|外公|阿公|丈夫|男孩|男童|儿子|男人|男性/.test(source)) return "male";
    if (/母亲|妈妈|娘|姐姐|妹妹|姊|婶婶|阿姨|奶奶|外婆|阿婆|妻子|女孩|女童|女儿|少女|女人|女性|妹/.test(source)) return "female";
    return "neutral";
}

function storyboardAssetVoiceAge(source: string) {
    const years = storyboardAssetVoiceAgeYears(source);
    if (years !== null) {
        if (years <= 2) return "baby";
        if (years <= 12) return "child";
        if (years <= 17) return "teen";
        if (years <= 30) return "young";
        if (years <= 55) return "adult";
        if (years <= 69) return "middle";
        return "old";
    }
    if (/婴儿|新生儿|宝宝|襁褓|幼儿/.test(source)) return "baby";
    if (/儿童|孩子|小孩|小男孩|小女孩|男童|女童|童年|年幼|小学|学龄/.test(source)) return "child";
    if (/少年|少女|青春期|初中|中学/.test(source)) return "teen";
    if (/老人|老年|年迈|晚年|暮年|花甲|古稀|爷爷|奶奶|外公|外婆|阿婆|阿公|老父|老母|白发/.test(source)) return "old";
    if (/中年|壮年/.test(source)) return "middle";
    if (/父亲|母亲|爸爸|妈妈|家中父亲|家中母亲|成年/.test(source)) return "adult";
    if (/年轻|青年|女儿|儿子|妹妹|弟弟/.test(source)) return "young";
    return "adult";
}

function storyboardAssetVoiceRole(source: string, age: string) {
    if (age === "baby") return "baby";
    if (age === "child" || age === "teen") return "child";
    if (/爸爸|爹|家中父亲|父亲/.test(source)) return "father";
    if (/妈妈|娘|家中母亲|母亲/.test(source)) return "mother";
    if (/老人|老年|爷爷|奶奶|外公|外婆|阿婆|阿公/.test(source)) return "elder";
    return "default";
}

function storyboardAssetVoiceAgeYears(source: string) {
    const arabic = source.match(/(?:^|[^\d])(\d{1,2})\s*岁/)?.[1];
    if (arabic) return Number(arabic);
    const chinese = source.match(/([零〇一二两三四五六七八九十]{1,3})\s*岁/)?.[1];
    if (!chinese) return null;
    const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
    if (!chinese.includes("十")) return digits[chinese] ?? null;
    const [tens, ones] = chinese.split("十");
    return (tens ? digits[tens] ?? 0 : 1) * 10 + (ones ? digits[ones] ?? 0 : 0);
}

function storyboardAssetVoiceSpeed(age: string, role: string, currentSpeed: string) {
    const speed = Number(currentSpeed);
    const base = Number.isFinite(speed) && speed > 0 ? speed : 1;
    if (role === "baby" || age === "baby") return String(Math.max(base, 1.1));
    if (role === "child" || age === "child") return String(Math.max(base, 1.05));
    if (role === "elder" || age === "old") return String(Math.min(base, 0.9));
    if (role === "father" || role === "mother") return String(Math.min(base, 0.95));
    if (age === "young") return String(Math.max(base, 1.05));
    return String(base);
}

function storyboardAssetVoiceTrait(gender: string, age: string, role: string) {
    if (role === "baby") return "稚嫩轻软的咿呀声，短促自然，不使用成人腔调";
    if (role === "child") return gender === "female" ? "声音稚嫩清亮，气息较轻，保留真实童声" : gender === "male" ? "声音稚嫩自然，音高略高，保留真实童声" : "声音稚嫩自然，音高偏高，保留真实童声";
    if (role === "father") return "声音低沉略粗粝，语速偏慢，克制可靠";
    if (role === "mother") return "声音温和柔韧，气息柔和，情绪含蓄";
    if (role === "elder" || age === "old") return gender === "female" ? "声音偏轻略哑，气息稍弱，语速缓慢" : "声音低哑沧桑，气息较沉，语速缓慢";
    if (age === "teen") return gender === "female" ? "声音清亮稚嫩，情绪真实，不使用成年腔调" : "声音处于少年变声期，自然清晰，不刻意低沉";
    if (gender === "female" && age === "young") return "声音清亮自然，气息轻，情绪真诚";
    if (gender === "male" && age === "young") return "声音年轻自然，清晰有活力，不刻意低沉";
    if (gender === "female") return "声音自然温和，气息稳定，情绪细腻克制";
    if (gender === "male") return "声音自然偏低，气息稳定，情绪克制可信";
    return "自然中文口语音色，年龄感清晰，气息稳定";
}

function storyboardAssetVoicePersonality(source: string) {
    return [
        /坚韧|倔强|不屈|顽强|早熟/.test(source) ? "内心坚韧、表达克制" : "",
        /疲惫|劳累|沧桑|工地|重活|贫困|艰难/.test(source) ? "带轻微劳作后的疲惫感" : "",
        /温柔|善良|慈爱|关怀|体贴/.test(source) ? "语气温和有陪伴感" : "",
        /严肃|威严|强势|冷静/.test(source) ? "表达沉稳、重音明确" : "",
        /胆怯|害怕|内向|沉默|拘谨/.test(source) ? "略显谨慎和犹豫" : "",
    ]
        .filter(Boolean)
        .slice(0, 2)
        .join("，");
}

function storyboardAssetVoiceDemographic(gender: string, age: string, years: number | null) {
    const genderLabel = gender === "female" ? "女性" : gender === "male" ? "男性" : "角色";
    if (years !== null) {
        if (years <= 2) return `${years}岁左右中国${gender === "female" ? "女婴" : gender === "male" ? "男婴" : "婴儿"}`;
        if (years <= 12) return `${years}岁左右中国${gender === "female" ? "女孩" : gender === "male" ? "男孩" : "儿童"}`;
        if (years <= 17) return `${years}岁左右中国${gender === "female" ? "少女" : gender === "male" ? "少年" : "青少年"}`;
        return `${years}岁左右中国${genderLabel}`;
    }
    if (age === "baby") return `中国${gender === "female" ? "女婴" : gender === "male" ? "男婴" : "婴儿"}`;
    if (age === "child") return `中国${gender === "female" ? "女孩童声" : gender === "male" ? "男孩童声" : "儿童声"}`;
    if (age === "teen") return `中国${gender === "female" ? "少女" : gender === "male" ? "少年" : "青少年"}`;
    if (age === "young") return `年轻中国${genderLabel}`;
    if (age === "middle") return `中年中国${genderLabel}`;
    if (age === "old") return `老年中国${genderLabel}`;
    return `成年中国${genderLabel}`;
}

function storyboardAssetVoiceAccent(source: string) {
    if (/重庆|四川|成都|酉阳|贵州|云南/.test(source)) return "带轻微西南地区口音";
    if (/湖南|湘西|长沙/.test(source)) return "带轻微湖南口音";
    if (/东北|辽宁|吉林|黑龙江/.test(source)) return "带轻微东北口音";
    if (/广东|广州|粤语/.test(source)) return "带轻微粤语区普通话口音";
    if (/河南/.test(source)) return "带轻微河南口音";
    if (/陕西|西安/.test(source)) return "带轻微陕西口音";
    if (/山东/.test(source)) return "带轻微山东口音";
    if (/天津/.test(source)) return "带轻微天津口音";
    if (/福建|闽南/.test(source)) return "带轻微闽南地区口音";
    return "普通话自然";
}

function storyboardAssetVoiceProjectStyle(style?: string) {
    if (!style) return "";
    if (/纪实|写实|现实|纪录片/.test(style)) return "纪实克制的表演";
    if (/喜剧|轻松|明快/.test(style)) return "轻松自然的表演";
    if (/悬疑|压抑|沉重/.test(style)) return "低调克制的表演";
    if (/动画|漫画|卡通/.test(style)) return "表现力清晰但不过度夸张";
    return "情绪自然不过度表演";
}

function storyboardAssetVoiceSampleTextForProfile(gender: string, age: string, role: string) {
    if (role === "baby" || age === "baby") return "啊……咿呀，咿呀。";
    if (role === "child" || age === "child") return "我会认真记住的。虽然还有一点害怕，但我想自己再试一次。";
    if (role === "father") return "先别急，听我把话说完。天再难，也得把家里的人照看好，我们一步一步来。";
    if (role === "mother") return "我知道你心里苦，可日子还得往前走。先稳住，把眼前这件事慢慢做好。";
    if (role === "elder" || age === "old") return "我这一辈子见过不少风浪，眼下先别慌，稳住脚步，再往前走。";
    if (gender === "female" && age === "young") return "我会记住你说的话。就算有点害怕，我也想再试一次，慢慢把事情做好。";
    if (gender === "female") return "我明白你的意思。先把心放稳，眼前这一步走好了，后面的路才有办法。";
    if (gender === "male") return "这件事我明白了。先把眼前的问题处理好，剩下的我们慢慢想办法。";
    return "我知道了，我们继续吧。先把眼前这一步做好，后面的事情再慢慢解决。";
}

function storyboardSceneSheetPrompt(asset: StoryboardAsset) {
    const source = safetyNeutralStoryboardPrompt(asset.prompt.trim() || asset.description.trim());
    if (!source) return "";
    return [
        "为同一个场景生成一张多角度空间锁定参考图。整体必须是横向 16:9 宽画布，宽明显大于高，画面铺满整张图，不要竖版长图、海报比例、居中窄图、黑边或大面积留白。",
        "版式固定为 3 列 x 2 行的横向拼版：上排 3 个等宽横向小图，下排 3 个等宽横向小图；每个分区都要填满自己的格子，不要做成 2 列 x 3 行。",
        "六个分区依次呈现不同机位：主视图、正面、左侧、右侧、俯视空间布局、背面/反向视角；这些机位名称只用于理解构图，不要画进图片里。",
        "每个分区必须是同一个地点，只改变相机方向；保持建筑结构、门窗位置、墙面/地面材质、道具摆放、光线方向、色调、年代质感完全一致。",
        "绝对不要在任何分区里添加视角标签、英文角标、中文角标、标题、说明字、左下角文字、字幕、Logo、水印或边框装饰；不要出现 MAIN VIEW、FRONT VIEW、LEFT SIDE VIEW、RIGHT SIDE VIEW、TOP-DOWN VIEW、REAR VIEW 等文字。",
        "画面中不要出现人物、角色、人脸、手部、路人；不要添加新家具、新门窗、新装饰物，不要改变布局。",
        "这张图只作为视频模型理解空间关系的参考图，不是最终视频画面。",
        `原始场景设定：${source}`,
    ].join("\n");
}

function safetyNeutralStoryboardPrompt(text: string, preserveLines = false) {
    const protectedMentions: string[] = [];
    const protectedText = text.replace(/@([^\s@，,、。；;：:）)】\]]+)/g, (mention) => {
        protectedMentions.push(mention);
        return `__STORYBOARD_ASSET_${protectedMentions.length - 1}__`;
    });
    const neutral = protectedText
        .replace(/十[几来]岁|未成年(?:人)?/g, "年轻")
        .replace(/小女孩|幼女|儿童|小孩/g, "年轻角色")
        .replace(/少女/g, "年轻女性角色")
        .replace(/左腿残疾|左腿明显不便|腿部残疾|残疾|残废|瘸(?:腿)?|跛脚|断腿/g, "行动不便")
        .replace(/瘦小|瘦弱|营养不良/g, "身形单薄")
        .replace(/破旧|破烂|衣衫褴褛/g, "朴素旧衣")
        .replace(/草鞋/g, "旧布鞋")
        .replace(/受虐|虐待|伤痕|血迹|流血|伤口/g, "生活艰难")
        .replace(/痛苦|苦难|可怜/g, "克制坚韧")
        .replace(/__STORYBOARD_ASSET_(\d+)__/g, (_, index: string) => protectedMentions[Number(index)] || "");
    return (preserveLines ? neutral.replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n") : neutral.replace(/\s+/g, " ")).trim();
}

function storyboardSafetyComposeText(text: string, strict = false) {
    const protectedMentions: string[] = [];
    const protectedText = text.replace(/@([^\s@，,、。；;：:）)】\]]+)/g, (mention) => {
        protectedMentions.push(mention);
        return `__STORYBOARD_ASSET_${protectedMentions.length - 1}__`;
    });
    const neutral = safetyNeutralStoryboardPrompt(protectedText)
        .replace(/婴儿|新生儿|宝宝/g, "家庭新成员")
        .replace(/丧女之痛|丧子之痛|丧亲之痛|失去(?:女儿|儿子|孩子|亲人)/g, "经历永久离别")
        .replace(/夭折|早逝|病逝|死亡|去世/g, "离世")
        .replace(/癌症|重病|绝症/g, "健康困境")
        .replace(/肿包|病态|病痛|病症/g, "身体不适");
    const result = strict
        ? neutral
              .replace(/年轻女性角色|年轻角色/g, "年少时期角色")
              .replace(/出生|诞生|分娩|生产/g, "家庭迎来新成员")
              .replace(/离世|永久离别|病故|身亡|死去|死于|没能活下来|不在人世/g, "亲人离世")
              .replace(/丧母|丧父|丧偶|孤儿/g, "失去亲人的家庭处境")
              .replace(/受伤|生病|高烧|手术|急救/g, "身体不适并接受照护")
              .replace(/住院|诊所|医院|病床|病房/g, "室内照护空间")
              .replace(/挨打|殴打|打骂|欺凌|推倒|踢打|家暴/g, "家庭冲突")
              .replace(/怀孕|孕妇/g, "家庭准备迎接新成员")
               .replace(/幼年|年幼|孩童|童年/g, "年少时期")
              .replace(/行动不便|左腿不便|瘫痪/g, "行动受限")
              .replace(/身体不适|健康困境|脑瘤|肿瘤|癌症/g, "长期身体不适")
              .replace(/不想活(?:了)?|轻生|自杀|寻死/g, "情绪陷入低谷")
              .replace(/痛苦|悲痛|绝望|苦难|受害/g, "沉重克制的情绪")
        : neutral;
    return result.replace(/__STORYBOARD_ASSET_(\d+)__/g, (_, index: string) => protectedMentions[Number(index)] || "");
}

function friendlyGenerationError(error: unknown, fallback: string) {
    const raw = error instanceof Error ? error.message : fallback;
    if (!isSafetyGenerationError(error)) return raw;
    const requestId = raw.match(/request id[:：]\s*([^)。；;\s]+)/i)?.[1];
    return `请求被安全系统拦截，请检查提示词或参考图是否包含未成年人、伤残、血腥、受害或极端困境等敏感描述${requestId ? `（request id: ${requestId}）` : ""}`;
}

function isSafetyGenerationError(error: unknown) {
    const raw = error instanceof Error ? error.message : String(error || "");
    return /safety system|rejected by the safety|content policy|content review|moderation|内容审查|内容安全|安全系统/i.test(raw);
}

type ResolvedStoryboardReference = { mention: string; node?: CanvasNodeData; reference: ReferenceImage; source?: StoryboardVideoReference["source"]; assetId?: string; kind?: StoryboardAssetKind; sceneGroupId?: string; sceneViewRole?: StoryboardVideoReference["sceneViewRole"] };

function storyboardVideoAssetReferences(scriptNode: CanvasNodeData, rowIndex: number, nodes: CanvasNodeData[]) {
    const detail = storyboardCompletedPromptDetailForRow(scriptNode, rowIndex);
    const assets = scriptNode.metadata?.storyboardAssets || [];
    const knownMentions = new Set(assets.map((asset) => `@${asset.name}`));
    const mentions = Array.from(new Set((detail?.assetMentions || []).map(normalizeAssetMention).filter((mention) => knownMentions.has(mention))));
    const mentionNodeIds = scriptNode.metadata?.storyboardAssetMentionNodeIds || {};
    const assetNodeIds = scriptNode.metadata?.storyboardAssetNodeIds || {};
    const assetByName = new Map(assets.map((asset) => [`@${asset.name}`, asset]));
    const resolved = new Map<string, ResolvedStoryboardReference>();
    const linkByMention = new Map(storyboardPromptAssetLinks(detail).map((link) => [link.mention, link]));
    for (const mention of mentions) {
        const asset = assetByName.get(mention);
        const nodeId = linkByMention.get(mention)?.nodeId || mentionNodeIds[mention] || (asset ? assetNodeIds[asset.id] : "");
        const assetNode = nodes.find((node) => node.id === nodeId) || nodes.find((node) => node.metadata?.storyboardSourceNodeId === scriptNode.id && node.metadata?.storyboardAssetName && mention === `@${node.metadata.storyboardAssetName}`);
        const sceneSheetReference = asset?.kind === "scene" ? storyboardAssetSceneSheetReference(asset) : null;
        if (asset && sceneSheetReference) {
            resolved.set(`scene-sheet:${asset.id}`, {
                mention: `@${asset.name}-多角度锁定图`,
                node: assetNode,
                reference: sceneSheetReference,
                source: "script",
                assetId: asset.id,
                kind: "scene",
                sceneViewRole: "lock",
            });
            continue;
        }
        const reference = referenceImageFromCanvasNode(assetNode);
        if (assetNode && reference) {
            resolved.set(assetNode.id, {
                mention,
                node: assetNode,
                reference,
                assetId: asset?.id,
                kind: asset?.kind || assetNode.metadata?.storyboardAssetKind,
                sceneGroupId: assetNode.metadata?.sceneGroupId,
                sceneViewRole: assetNode.metadata?.sceneViewRole,
            });
        }
    }
    storyboardSceneContinuityAssetReferences(scriptNode, resolved, nodes).forEach((item) => {
        if (resolved.size < 9 && !resolved.has(item.node?.id || item.mention)) resolved.set(item.node?.id || item.mention, item);
    });
    return Array.from(resolved.values()).slice(0, 9);
}

function storyboardFirstFrameAssetReferences(scriptNode: CanvasNodeData, rowIndex: number, nodes: CanvasNodeData[]) {
    const resolved = storyboardVideoAssetReferences(scriptNode, rowIndex, nodes);
    const characters = resolved.filter((item) => item.kind === "character");
    const sceneCandidates = resolved.filter((item) => item.kind === "scene");
    const scene = sceneCandidates.find((item) => item.sceneViewRole === "lock") || sceneCandidates[0];
    const props = resolved.filter((item) => item.kind === "prop");
    const seen = new Set<string>();
    return [...characters, scene, ...props]
        .filter((item): item is ResolvedStoryboardReference => Boolean(item))
        .map((item) => item.reference)
        .filter((reference) => {
            const key = reference.storageKey || reference.dataUrl || reference.id;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .slice(0, 6);
}

function storyboardVideoAudioReferences(scriptNode: CanvasNodeData, rowIndex: number) {
    const assets = scriptNode.metadata?.storyboardAssets || [];
    return assets
        .filter((asset) => storyboardPromptDetailUsesCharacterVoice(scriptNode, rowIndex, asset))
        .map((asset) => storyboardAssetVoiceAudioReference(asset))
        .filter((item): item is StoryboardAudioReference => Boolean(item))
        .slice(0, 3);
}

function mergeStoryboardAudioReferences(base: StoryboardAudioReference[], extra: StoryboardAudioReference) {
    return [extra, ...base.filter((item) => item.mention !== extra.mention)];
}

function mergeStoryboardAudioReferenceList(base: StoryboardAudioReference[], extras: StoryboardAudioReference[]) {
    return extras.reduce((current, item) => mergeStoryboardAudioReferences(current, item), base);
}

async function resolveStoryboardVideoAudioReferences(references?: StoryboardAudioReference[]): Promise<ReferenceAudio[]> {
    if (!references?.length) return [];
    const items = await Promise.all(
        references.map(async (reference, index): Promise<ReferenceAudio | null> => {
            const source = reference.storageKey || reference.url || "";
            const url = source.startsWith("audio:") ? await resolveMediaUrl(source, "") : source;
            return url ? { id: reference.assetId || `${index}`, name: `${reference.mention || reference.name || `audio-${index}`}.mp3`, type: "audio/mpeg", url, storageKey: reference.storageKey, durationMs: reference.durationMs } : null;
        }),
    );
    return items.filter((item): item is ReferenceAudio => Boolean(item));
}

function storyboardVideoFinalPromptWithAudio(prompt: string, audioReferences?: StoryboardAudioReference[]) {
    const voicePrompt = storyboardVideoAudioContinuityPrompt(audioReferences);
    if (!voicePrompt) return prompt;
    const base = stripStoryboardVideoAudioContinuityPrompt(prompt);
    const marker = "【声音时间轴】";
    return base.includes(marker) ? base.replace(marker, `${marker}\n${voicePrompt}`).trim() : `${base}\n\n${voicePrompt}`.trim();
}

function storyboardVideoFinalPrompt(prompt: string, references: StoryboardVideoReference[]) {
    const basePrompt = stripStoryboardVideoFrameContinuityPrompt(prompt);
    const continuityPrompt = storyboardVideoFrameContinuityPrompt(references, basePrompt);
    if (!continuityPrompt) return basePrompt;
    const marker = "【连续性与稳定约束】";
    return basePrompt.includes(marker) ? basePrompt.replace(marker, `${marker}\n${continuityPrompt}`).trim() : `${basePrompt}\n\n${continuityPrompt}`.trim();
}

function storyboardReferenceBindingLine(reference: StoryboardVideoReference) {
    if (reference.role === "firstFrame") return `- ${reference.mention}：起始画面参考，锁定首帧构图、人物站位、动作起点、场景结构和光线。`;
    if (reference.role === "lastFrame") return `- ${reference.mention}：结束画面参考，当前动作和运镜自然落到该构图。`;
    if (reference.kind === "scene") return `- ${reference.mention}：唯一场景空间参考，锁定地点结构、陈设、材质和光线，不生成分屏或多宫格。`;
    if (reference.kind === "character") return `- ${reference.mention}：人物身份参考，锁定该时期的脸型、年龄、发型、体态、服装和画风。`;
    if (reference.kind === "prop") return `- ${reference.mention}：关键道具参考，锁定外观、材质、尺寸和使用连续性。`;
    return `- ${reference.mention}：视觉参考素材，只控制与当前镜头对应的主体或画面连续性。`;
}

function stripStoryboardReferenceBindingLines(prompt: string) {
    return prompt
        .split("\n")
        .filter((line) => !/^\s*-\s*@.*(?:起始画面参考|结束画面参考|唯一场景空间参考|人物身份参考|关键道具参考|视觉参考素材)/.test(line))
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

function insertStoryboardReferenceBindings(prompt: string, marker: string, references: StoryboardVideoReference[]) {
    if (!references.length) return prompt;
    const squareMarker = `[${marker.replace(/[【】]/g, "")}]`;
    const actualMarker = prompt.includes(marker) ? marker : prompt.includes(squareMarker) ? squareMarker : marker;
    const markerIndex = prompt.indexOf(actualMarker);
    const nextMarkerIndex = markerIndex < 0 ? -1 : prompt.slice(markerIndex + actualMarker.length).search(/\n(?:【[^】]+】|\[[^\]]+\])/);
    const section = markerIndex < 0 ? "" : prompt.slice(markerIndex, nextMarkerIndex < 0 ? undefined : markerIndex + actualMarker.length + nextMarkerIndex);
    const missing = references.filter((reference) => !section.includes(reference.mention));
    if (!missing.length) return prompt;
    const lines = missing.map(storyboardReferenceBindingLine).join("\n");
    if (markerIndex >= 0) return prompt.replace(actualMarker, `${actualMarker}\n${lines}`);
    const bindingMarker = prompt.includes("[参考资产绑定]") ? "[参考资产绑定]" : "【参考资产绑定】";
    return prompt.includes(bindingMarker) ? prompt.replace(bindingMarker, `${bindingMarker}\n${lines}`) : `${bindingMarker}\n${lines}\n\n${prompt}`.trim();
}

function storyboardVideoPromptWithBoundReferences(basePrompt: string, references: StoryboardVideoReference[], knownAssetMentions: string[] = []) {
    let prompt = stripStoryboardReferenceBindingLines(basePrompt);
    const selectedMentions = new Set(references.map((reference) => reference.mention));
    const sceneAliases = new Map(
        references
            .filter((reference) => reference.kind === "scene" && reference.mention.endsWith("-多角度锁定图"))
            .map((reference) => [reference.mention.replace(/-多角度锁定图$/, ""), reference.mention]),
    );
    Array.from(sceneAliases.entries()).sort((first, second) => second[0].length - first[0].length).forEach(([baseMention, selectedMention]) => {
        prompt = prompt.replace(new RegExp(`${escapeRegExp(baseMention)}(?!-多角度锁定图)`, "g"), selectedMention);
    });
    Array.from(new Set([...knownAssetMentions, ...sceneAliases.keys()]))
        .sort((first, second) => second.length - first.length)
        .forEach((mention) => {
            if (!selectedMentions.has(mention) && !sceneAliases.has(mention)) prompt = prompt.replace(new RegExp(escapeRegExp(mention), "g"), mention.replace(/^@/, ""));
        });
    prompt = insertStoryboardReferenceBindings(prompt, "【场景设定】", references.filter((reference) => reference.kind === "scene"));
    prompt = insertStoryboardReferenceBindings(prompt, "【人物设定】", references.filter((reference) => reference.kind === "character"));
    prompt = insertStoryboardReferenceBindings(prompt, "【道具设定】", references.filter((reference) => reference.kind === "prop"));
    prompt = insertStoryboardReferenceBindings(prompt, "【起始画面】", references.filter((reference) => reference.role === "firstFrame"));
    prompt = insertStoryboardReferenceBindings(prompt, "【连续性与稳定约束】", references.filter((reference) => reference.role === "lastFrame"));
    return insertStoryboardReferenceBindings(prompt, "【参考资产绑定】", references.filter((reference) => !reference.kind && reference.role !== "firstFrame" && reference.role !== "lastFrame"));
}

function storyboardVideoAudioContinuityPrompt(references?: StoryboardAudioReference[]) {
    const voiceLocks = (references || []).filter((item) => item.role === "voiceLock");
    if (!voiceLocks.length) return "";
    return [
        `- 参考角色声音样本锁定音色、年龄感、气息、语速和情绪强度：${voiceLocks.map((item) => item.mention).join("、")}。`,
        "- 同一角色在不同镜头中不要突然改变音色、口音、语速或情绪强度；背景音乐和环境音不要盖过对白。",
    ].join("\n");
}

function stripStoryboardVideoAudioContinuityPrompt(text: string) {
    return text
        .replace(/\n{0,2}视频声音一致性要求：[\s\S]*?(?=\n{2,}\S|$)/g, "")
        .split("\n")
        .filter((line) => !/^\s*-\s*(?:参考角色声音样本锁定音色|同一角色在不同镜头中不要突然改变音色)/.test(line))
        .join("\n")
        .trim();
}

function stripStoryboardVideoFrameContinuityPrompt(text: string) {
    return text
        .split(/\n\n视频连续性要求：/)[0]
        .split("\n")
        .filter((line) => !/^\s*-\s*(?:以首帧参考图|以场景锁定参考图|以主体参考图|视频动作和镜头运动需要自然过渡到尾帧参考图|保持人物身份、服装、场景、光影和空间关系连续)/.test(line))
        .join("\n")
        .trim();
}

function storyboardPromptDetailUsesAsset(scriptNode: CanvasNodeData, rowIndex: number | undefined, asset: StoryboardAsset) {
    if (rowIndex === undefined) return false;
    const detail = storyboardCompletedPromptDetailForRow(scriptNode, rowIndex);
    const promptText = `${detail?.storyboardPrompt || ""}\n${detail?.videoMotionPrompt || ""}`;
    const mention = `@${asset.name}`;
    return storyboardAssetMentionsForPrompt(detail).some((item) => item === mention || item.startsWith(`${mention}-`)) || promptText.includes(mention) || promptText.includes(asset.name);
}

function storyboardPromptDetailUsesCharacterVoice(scriptNode: CanvasNodeData, rowIndex: number | undefined, asset: StoryboardAsset) {
    if (asset.kind !== "character" || rowIndex === undefined || !storyboardPromptDetailUsesAsset(scriptNode, rowIndex, asset)) return false;
    const dialogue = parseStoryboardRows(scriptNode.metadata?.storyboardRows)[rowIndex]?.[5]?.trim() || "";
    return Boolean(dialogue && [asset.name, asset.baseName].filter(Boolean).some((name) => dialogue.includes(String(name))));
}

function storyboardCompletedPromptDetailForRow(scriptNode: CanvasNodeData, rowIndex: number) {
    const detail = scriptNode.metadata?.storyboardPromptDetails?.[String(rowIndex)];
    if (!detail || detail.promptSource === "fallback") return undefined;
    return completeStoryboardPromptDetailAssets(scriptNode, parseStoryboardRows(scriptNode.metadata?.storyboardRows), rowIndex, detail);
}

function storyboardVideoDraftRowIndexes(scriptNode: CanvasNodeData, rows: string[][]) {
    const promptErrors = scriptNode.metadata?.storyboardPromptErrors || {};
    return storyboardVideoDraftCandidateRowIndexes(scriptNode, rows).filter((index) => !promptErrors[String(index)]);
}

function storyboardVideoDraftCandidateRowIndexes(scriptNode: CanvasNodeData, rows: string[][]) {
    const plans = scriptNode.metadata?.storyboardShotPlans || {};
    const promptDetails = scriptNode.metadata?.storyboardPromptDetails || {};
    return storyboardActiveRowIndexes(scriptNode, rows).filter((index) => plans[String(index)]?.renderMode !== "still" && promptDetails[String(index)]?.videoMotionPrompt?.trim() && promptDetails[String(index)]?.promptSource !== "fallback");
}

function storyboardSceneContinuityAssetReferences(scriptNode: CanvasNodeData, current: Map<string, ResolvedStoryboardReference>, nodes: CanvasNodeData[]): ResolvedStoryboardReference[] {
    const sceneGroups = new Set(Array.from(current.values()).filter((item) => item.kind === "scene" && item.sceneGroupId).map((item) => item.sceneGroupId || ""));
    if (!sceneGroups.size) return [];
    const currentNodeIds = new Set(Array.from(current.values()).map((item) => item.node?.id).filter(Boolean));
    return nodes
        .filter((node) => node.type === CanvasNodeType.Image && node.metadata?.sceneGroupId && sceneGroups.has(node.metadata.sceneGroupId) && !currentNodeIds.has(node.id) && (node.metadata.content || node.metadata.storageKey))
        .map((node): ResolvedStoryboardReference | null => {
            const reference = referenceImageFromCanvasNode(node);
            if (!reference) return null;
            return {
                mention: storyboardSceneViewMention(node.metadata?.storyboardAssetName || node.title, node.metadata?.sceneViewRole),
                node,
                reference,
                source: node.metadata?.storyboardSourceNodeId === scriptNode.id ? "script" : "node",
                kind: "scene" as const,
                sceneGroupId: node.metadata?.sceneGroupId,
                sceneViewRole: node.metadata?.sceneViewRole,
            };
        })
        .filter((item): item is ResolvedStoryboardReference => item !== null)
        .sort((a, b) => sceneViewSortWeight(a.sceneViewRole) - sceneViewSortWeight(b.sceneViewRole));
}

function sceneViewSortWeight(role?: StoryboardVideoReference["sceneViewRole"]) {
    const order: Record<NonNullable<StoryboardVideoReference["sceneViewRole"]>, number> = {
        lock: 0,
        front: 1,
        front_left_45: 2,
        front_right_45: 3,
        left: 4,
        right: 5,
        top: 6,
        back_left_45: 7,
        back: 8,
        back_right_45: 9,
    };
    return role ? order[role] : 20;
}

function storyboardReferenceAssetsForNode(node: CanvasNodeData, nodes: CanvasNodeData[], connections: CanvasConnection[]): StoryboardVideoReference[] {
    if (node.type !== CanvasNodeType.Video || !node.metadata?.storyboardSourceNodeId) return [];
    const sourceId = node.metadata.storyboardSourceNodeId;
    const scriptNode = nodes.find((item) => item.id === sourceId);
    const references = new Map<string, StoryboardVideoReference>();
    const rowIndex = node.metadata.storyboardRowIndex;
    const previousDraft = rowIndex !== undefined ? nodes.find((item) => isStoryboardVideoDraftNode(item) && item.metadata?.storyboardSourceNodeId === sourceId && item.metadata.storyboardRowIndex === rowIndex - 1) : undefined;

    const generatedFirstFrame = rowIndex !== undefined ? storyboardGeneratedFirstFrameForRow(sourceId, rowIndex, nodes) : null;
    if (generatedFirstFrame) references.set(generatedFirstFrame.mention, generatedFirstFrame);

    if (rowIndex !== undefined && rowIndex > 0) {
        nodes
            .filter((item) => isPreviousStoryboardVideoResult(item, previousDraft, sourceId, rowIndex - 1, nodes, connections) && (item.metadata?.storyboardVideoTailFrameStorageKey || item.metadata?.storyboardVideoTailFrameUrl))
            .sort((a, b) => (b.metadata?.storyboardVideoVariantIndex || 0) - (a.metadata?.storyboardVideoVariantIndex || 0))
            .forEach((item) => {
                const name = `第 ${rowIndex} 镜${item.metadata?.storyboardVideoVariantIndex ? ` v${item.metadata.storyboardVideoVariantIndex}` : ""} 尾帧`;
                const mention = `@${name}`;
                references.set(mention, {
                    mention,
                    name,
                    status: "bound",
                    nodeId: item.id,
                    url: item.metadata?.storyboardVideoTailFrameUrl,
                    storageKey: item.metadata?.storyboardVideoTailFrameStorageKey,
                    role: "firstFrame",
                    source: "script",
                });
            });
    }

    nodes.forEach((item) => {
        const name = item.metadata?.storyboardAssetName;
        if (item.type !== CanvasNodeType.Image || item.metadata?.storyboardSourceNodeId !== sourceId || !name || (!item.metadata.content && !item.metadata.storageKey)) return;
        const mention = storyboardSceneViewMention(name, item.metadata.sceneViewRole);
        references.set(mention, {
            mention,
            name: mention.replace(/^@/, ""),
            status: "bound",
            nodeId: item.id,
            kind: item.metadata.storyboardAssetKind,
            url: item.metadata.content,
            storageKey: item.metadata.storageKey,
            role: item.metadata.storyboardAssetKind === "scene" ? "sceneLock" : "reference",
            sceneGroupId: item.metadata.sceneGroupId,
            sceneViewRole: item.metadata.sceneViewRole,
            source: "script",
        });
    });

    scriptNode?.metadata?.storyboardAssets?.forEach((asset) => {
        const sceneSheetReference = asset.kind === "scene" ? storyboardSceneSheetVideoReference(asset) : null;
        if (sceneSheetReference) references.set(sceneSheetReference.mention, sceneSheetReference);
        if (!asset.imageUrl && !asset.storageKey) return;
        const mention = `@${asset.name}`;
        if (references.has(mention)) return;
        references.set(mention, {
            mention,
            name: asset.name,
            status: "bound",
            assetId: asset.id,
            kind: asset.kind,
            url: asset.imageUrl,
            storageKey: asset.storageKey,
            role: asset.kind === "scene" ? "sceneLock" : "reference",
            source: "script",
        });
    });

    return Array.from(references.values());
}

function storyboardSceneViewMention(name: string, role?: StoryboardVideoReference["sceneViewRole"]) {
    const base = name.trim().replace(/^@+/, "");
    if (!base) return "";
    if (!role || role === "lock") return `@${base}`;
    return `@${base}-${storyboardSceneViewLabel(role)}`;
}

function storyboardSceneViewLabel(role: NonNullable<StoryboardVideoReference["sceneViewRole"]>) {
    if (role === "front") return "正面";
    if (role === "left") return "左侧";
    if (role === "right") return "右侧";
    if (role === "top") return "俯视";
    if (role === "back") return "背面";
    if (role === "front_left_45") return "左前45度";
    if (role === "front_right_45") return "右前45度";
    if (role === "back_left_45") return "左后45度";
    if (role === "back_right_45") return "右后45度";
    return "场景锁定";
}

function isPreviousStoryboardVideoResult(node: CanvasNodeData, previousDraft: CanvasNodeData | undefined, sourceId: string, previousRowIndex: number, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    if (node.type !== CanvasNodeType.Video || (!node.metadata?.content && !node.metadata?.storageKey)) return false;
    if (node.metadata?.storyboardSourceNodeId === sourceId && node.metadata.storyboardRowIndex === previousRowIndex) return true;
    if (previousDraft && connections.some((connection) => connection.fromNodeId === previousDraft.id && connection.toNodeId === node.id)) return true;
    const inferredDraft = inferStoryboardVideoResultDraft(node, sourceId, nodes);
    return Boolean(inferredDraft && inferredDraft.metadata?.storyboardRowIndex === previousRowIndex);
}

function storyboardVideoWorkspaceForNode(nodeId: string, nodes: CanvasNodeData[]) {
    const target = nodes.find((node) => node.id === nodeId);
    return nodes.find((node) => node.type === CanvasNodeType.Workspace && node.metadata?.workspaceKind === "storyboard-videos" && (node.metadata.workspaceChildNodeIds?.includes(nodeId) || Boolean(target && isNodeInsideWorkspace(target, node))));
}

function inferStoryboardVideoResultDraft(node: CanvasNodeData, sourceId: string, nodes: CanvasNodeData[]) {
    const workspace = storyboardVideoWorkspaceForNode(node.id, nodes);
    if (!workspace || workspace.metadata?.workspaceSourceNodeId !== sourceId) return null;
    const drafts = nodes.filter((item) => isStoryboardVideoDraftNode(item) && item.metadata?.storyboardSourceNodeId === sourceId);
    if (!drafts.length) return null;
    const centerY = node.position.y + node.height / 2;
    const centerX = node.position.x + node.width / 2;
    return drafts
        .filter((draft) => centerX >= draft.position.x + draft.width * 0.6)
        .sort((a, b) => {
            const aY = Math.abs(centerY - (a.position.y + a.height / 2));
            const bY = Math.abs(centerY - (b.position.y + b.height / 2));
            if (Math.abs(aY - bY) > 24) return aY - bY;
            return Math.abs(centerX - (a.position.x + a.width)) - Math.abs(centerX - (b.position.x + b.width));
        })[0] || null;
}

function isNodeInsideWorkspace(node: CanvasNodeData, workspace: CanvasNodeData) {
    const centerX = node.position.x + node.width / 2;
    const centerY = node.position.y + node.height / 2;
    return centerX >= workspace.position.x && centerX <= workspace.position.x + workspace.width && centerY >= workspace.position.y && centerY <= workspace.position.y + workspace.height;
}

function storyboardVideoReferencesFromAssetReferences(assetReferences: ReturnType<typeof storyboardVideoAssetReferences>): StoryboardVideoReference[] {
    return assetReferences.map((item) => ({
        mention: item.mention,
        name: item.mention.replace(/^@/, ""),
        status: "bound",
        assetId: item.assetId,
        nodeId: item.node?.id,
        kind: item.kind,
        url: item.reference.url || item.reference.dataUrl,
        storageKey: item.reference.storageKey,
        role: item.kind === "scene" ? "sceneLock" : "reference",
        sceneGroupId: item.sceneGroupId,
        sceneViewRole: item.sceneViewRole,
        source: item.source || (item.node ? "script" : "asset"),
    }));
}

function storyboardTailFrameReference(previousRowIndex: number, image: Pick<UploadedImage, "url" | "storageKey">, variantIndex?: number, nodeId?: string): StoryboardVideoReference {
    const name = `第 ${previousRowIndex + 1} 镜${variantIndex ? ` v${variantIndex}` : ""} 尾帧`;
    return {
        mention: `@${name}`,
        name,
        status: "bound",
        nodeId,
        url: image.url,
        storageKey: image.storageKey,
        role: "firstFrame",
        source: "script",
    };
}

function previousStoryboardTailFrameReference(sourceNodeId: string, rowIndex: number, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    if (rowIndex <= 0) return null;
    const previousDraft = nodes.find((node) => isStoryboardVideoDraftNode(node) && node.metadata?.storyboardSourceNodeId === sourceNodeId && node.metadata.storyboardRowIndex === rowIndex - 1);
    const candidates = nodes.filter((node) => isPreviousStoryboardVideoResult(node, previousDraft, sourceNodeId, rowIndex - 1, nodes, connections) && (node.metadata?.storyboardVideoTailFrameStorageKey || node.metadata?.storyboardVideoTailFrameUrl));
    const previous = candidates.find((node) => node.id === previousDraft?.metadata?.storyboardVideoLatestResultNodeId) || [...candidates].sort((a, b) => (b.metadata?.storyboardVideoVariantIndex || 0) - (a.metadata?.storyboardVideoVariantIndex || 0))[0];
    if (!previous?.metadata?.storyboardVideoTailFrameStorageKey && !previous?.metadata?.storyboardVideoTailFrameUrl) return null;
    return storyboardTailFrameReference(rowIndex - 1, { url: previous.metadata.storyboardVideoTailFrameUrl || "", storageKey: previous.metadata.storyboardVideoTailFrameStorageKey || "" }, previous.metadata.storyboardVideoVariantIndex, previous.id);
}

function isStoryboardVideoDraftNode(node: CanvasNodeData) {
    return node.type === CanvasNodeType.Video && Boolean(node.metadata?.storyboardSourceNodeId) && node.metadata?.storyboardRowIndex !== undefined && !node.metadata?.content && !node.metadata?.storyboardVideoDraftNodeId;
}

function storyboardVideoCountsForScript(scriptNode: CanvasNodeData | null, nodes: CanvasNodeData[]) {
    if (!scriptNode) return { draftCount: 0, resultCount: 0 };
    const chapterId = scriptNode.metadata?.storyboardActiveChapterId || scriptNode.metadata?.storyboardChapters?.[0]?.id;
    const related = nodes.filter((node) => node.type === CanvasNodeType.Video && node.metadata?.storyboardSourceNodeId === scriptNode.id && (!chapterId || node.metadata.storyboardChapterId === chapterId));
    return {
        draftCount: new Set(related.filter(isStoryboardVideoDraftNode).map((node) => node.metadata?.storyboardRowIndex)).size,
        resultCount: new Set(related.filter((node) => Boolean(node.metadata?.storyboardVideoDraftNodeId && node.metadata.content)).map((node) => node.metadata?.storyboardRowIndex)).size,
    };
}

function buildStoryboardVideoResultNode(draft: CanvasNodeData, config: AiConfig, prompt: string, nodes: CanvasNodeData[]): CanvasNodeData {
    const variantIndex = nodes.filter((node) => node.metadata?.storyboardVideoDraftNodeId === draft.id).length + 1;
    const position = {
        x: draft.position.x,
        y: draft.position.y - Math.min(52, draft.height * 0.18),
    };
    return {
        id: `storyboard-video-result-${draft.id}-${nanoid()}`,
        type: CanvasNodeType.Video,
        title: `${draft.title || `第 ${(draft.metadata?.storyboardRowIndex || 0) + 1} 镜视频`} v${variantIndex}`,
        position,
        width: draft.width,
        height: draft.height,
        metadata: {
            ...draft.metadata,
            content: undefined,
            storageKey: undefined,
            naturalWidth: undefined,
            naturalHeight: undefined,
            bytes: undefined,
            mimeType: undefined,
            durationMs: undefined,
            status: NODE_STATUS_LOADING,
            errorDetails: undefined,
            videoGenerationProgress: initialVideoGenerationProgress(),
            prompt,
            storyboardVideoFinalPrompt: prompt,
            storyboardVideoDraftNodeId: draft.id,
            storyboardVideoVariantIndex: variantIndex,
            model: config.model,
            size: config.size,
            seconds: config.videoSeconds,
            vquality: config.vquality,
            generateAudio: config.videoGenerateAudio,
            watermark: config.videoWatermark,
        },
    };
}

function upsertStoryboardVideoResultNode(nodes: CanvasNodeData[], draft: CanvasNodeData, result: CanvasNodeData) {
    let hasResult = false;
    const next = nodes.map((node) => {
        if (node.id === draft.id) {
            const resultIds = Array.from(new Set([...(node.metadata?.storyboardVideoResultNodeIds || []), result.id]));
            return {
                ...node,
                metadata: {
                    ...node.metadata,
                    status: NODE_STATUS_IDLE,
                    errorDetails: undefined,
                    videoGenerationProgress: undefined,
                    storyboardVideoLatestResultNodeId: result.id,
                    storyboardVideoResultNodeIds: resultIds,
                },
            };
        }
        if (node.id === result.id) {
            hasResult = true;
            return result;
        }
        if (node.type === CanvasNodeType.Workspace && node.metadata?.workspaceKind === "storyboard-videos" && node.metadata.workspaceSourceNodeId === draft.metadata?.storyboardSourceNodeId && node.metadata.workspaceStoryboardChapterId === draft.metadata?.storyboardChapterId) {
            const childIds = Array.from(new Set([...(node.metadata.workspaceChildNodeIds || []), result.id]));
            const size = storyboardVideoWorkspaceSize(node, nodes, draft, result);
            return {
                ...node,
                width: size.width,
                height: size.height,
                metadata: { ...node.metadata, workspaceChildNodeIds: childIds },
            };
        }
        return node;
    });
    return hasResult ? next : [...next, result];
}

function storyboardVideoWorkspaceSize(workspace: CanvasNodeData, nodes: CanvasNodeData[], draft: CanvasNodeData, result: CanvasNodeData) {
    const sourceId = draft.metadata?.storyboardSourceNodeId;
    const itemById = new Map<string, CanvasNodeData>();
    nodes.forEach((node) => {
        if (node.type !== CanvasNodeType.Video || node.metadata?.storyboardSourceNodeId !== sourceId) return;
        const resultDraftId = node.metadata?.storyboardVideoDraftNodeId;
        if (!resultDraftId) {
            itemById.set(node.id, node);
            return;
        }
        const resultDraft = resultDraftId === draft.id ? draft : nodes.find((item) => item.id === resultDraftId);
        if (resultDraftId === draft.id) return;
        if (resultDraft?.metadata?.storyboardVideoLatestResultNodeId === node.id) itemById.set(node.id, node);
    });
    itemById.set(result.id, result);
    const bounds = Array.from(itemById.values()).reduce(
        (box, item) => ({
            right: Math.max(box.right, item.position.x + item.width),
            bottom: Math.max(box.bottom, item.position.y + item.height),
        }),
        { right: workspace.position.x + NODE_DEFAULT_SIZE[CanvasNodeType.Workspace].width, bottom: workspace.position.y + NODE_DEFAULT_SIZE[CanvasNodeType.Workspace].height },
    );
    return {
        width: Math.max(NODE_DEFAULT_SIZE[CanvasNodeType.Workspace].width, bounds.right - workspace.position.x + 36),
        height: Math.max(NODE_DEFAULT_SIZE[CanvasNodeType.Workspace].height, bounds.bottom - workspace.position.y + 36),
    };
}

function mergeStoryboardVideoReferences(base: StoryboardVideoReference[], extra?: StoryboardVideoReference | null) {
    if (!extra) return base;
    const next = base.filter((item) => item.mention !== extra.mention);
    return [extra, ...next];
}

function mergeStoryboardVideoReferenceList(base: StoryboardVideoReference[], extras: StoryboardVideoReference[]) {
    return extras.reduce((current, item) => mergeStoryboardVideoReferences(current, item), base);
}

function mergeStoryboardAutomaticVideoReferences(existing: StoryboardVideoReference[], automatic: StoryboardVideoReference[]) {
    const preserved = existing.filter((item) => item.role === "firstFrame" || item.role === "lastFrame" || item.source === "asset" || item.source === "node");
    return mergeStoryboardVideoReferenceList(automatic, preserved);
}

function storyboardGeneratedFirstFrameReference(rowIndex: number, nodeId: string, image: Pick<UploadedImage, "url" | "storageKey">): StoryboardVideoReference {
    const name = `第 ${rowIndex + 1} 镜合成首帧`;
    return { mention: `@${name}`, name, status: "bound", nodeId, url: image.url, storageKey: image.storageKey, role: "firstFrame", source: "script" };
}

function storyboardGeneratedFirstFrameForRow(sourceNodeId: string, rowIndex: number, nodes: CanvasNodeData[]) {
    const node = [...nodes].reverse().find((item) => item.type === CanvasNodeType.Image && item.metadata?.storyboardSourceNodeId === sourceNodeId && item.metadata.storyboardRowIndex === rowIndex && item.metadata.videoFrameRole === "first" && (item.metadata.content || item.metadata.storageKey));
    if (!node) return null;
    return storyboardGeneratedFirstFrameReference(rowIndex, node.id, { url: node.metadata.content, storageKey: node.metadata.storageKey });
}

function storyboardPrioritizedVideoReferences(references: StoryboardVideoReference[], preferGeneratedFirstFrame = true) {
    const explicit = references.filter((item) => item.source === "asset" || item.source === "node" || item.role === "lastFrame");
    const explicitFirstFrame = explicit.find((item) => item.role === "firstFrame");
    const generatedFirstFrame = references.find((item) => item.role === "firstFrame" && item.name?.includes("合成首帧"));
    const firstFrame = explicitFirstFrame || (preferGeneratedFirstFrame ? generatedFirstFrame || references.find((item) => item.role === "firstFrame") : references.find((item) => item.role === "firstFrame") || generatedFirstFrame);
    const pinned = explicit.filter((item) => item !== explicitFirstFrame);
    const identity = pinned.some((item) => item.kind === "character") ? undefined : references.find((item) => item.kind === "character" && item.role !== "firstFrame" && !explicit.includes(item));
    const scenes = references.filter((item) => item.kind === "scene" && item.role !== "firstFrame" && !explicit.includes(item));
    const scene = pinned.some((item) => item.kind === "scene") ? undefined : scenes.find((item) => item.sceneViewRole === "lock") || scenes[0];
    const prop = pinned.some((item) => item.kind === "prop") ? undefined : references.find((item) => item.kind === "prop" && item.role !== "firstFrame" && !explicit.includes(item));
    return [firstFrame, ...pinned, identity, scene, prop]
        .filter((item, index, items): item is StoryboardVideoReference => Boolean(item && items.findIndex((candidate) => candidate?.mention === item.mention) === index))
        .slice(0, 9);
}

function storyboardGeneratedFirstFrameUsesReference(sourceNodeId: string, rowIndex: number, reference: StoryboardVideoReference, nodes: CanvasNodeData[]) {
    const frame = [...nodes].reverse().find((item) => item.type === CanvasNodeType.Image && item.metadata?.storyboardSourceNodeId === sourceNodeId && item.metadata.storyboardRowIndex === rowIndex && item.metadata.videoFrameRole === "first");
    const target = reference.storageKey || reference.url;
    return Boolean(target && frame?.metadata?.references?.includes(target));
}

function storyboardVideoVisualReferencePatch(basePrompt: string, references: StoryboardVideoReference[], audioReferences?: StoryboardAudioReference[], knownAssetMentions?: string[]): Partial<CanvasNodeMetadata> {
    const alignedPrompt = storyboardVideoPromptWithBoundReferences(basePrompt, references, knownAssetMentions);
    return {
        references: references.map((item) => item.storageKey || item.url).filter((url): url is string => Boolean(url)),
        storyboardAssetReferenceNodeIds: references.map((item) => item.nodeId).filter((id): id is string => Boolean(id)),
        storyboardVideoReferences: references,
        storyboardVideoFinalPrompt: storyboardVideoFinalPromptWithAudio(storyboardVideoFinalPrompt(alignedPrompt, references), audioReferences),
    };
}

function syncStoryboardVideoReferenceConnections(connections: CanvasConnection[], draftNodeId: string, references: StoryboardVideoReference[], nodes: CanvasNodeData[], extraImageNodeId?: string) {
    const desiredNodeIds = new Set(references.map((item) => item.nodeId).filter((id): id is string => Boolean(id)));
    const referenceSourceNodeIds = new Set([...nodes.filter((item) => item.type === CanvasNodeType.Image || (item.type === CanvasNodeType.Video && Boolean(item.metadata?.storyboardVideoDraftNodeId))).map((item) => item.id), ...(extraImageNodeId ? [extraImageNodeId] : [])]);
    const retained = connections.filter((connection) => connection.toNodeId !== draftNodeId || !referenceSourceNodeIds.has(connection.fromNodeId) || desiredNodeIds.has(connection.fromNodeId));
    return addUniqueConnections(retained, Array.from(desiredNodeIds).map((nodeId) => ({ id: nanoid(), fromNodeId: nodeId, toNodeId: draftNodeId })));
}

function parseStoryboardRowSeconds(row?: string[]) {
    const value = row?.[1]?.trim() || "";
    return value.match(/^(1[0-5]|[4-9])\s*(?:s|秒)?$/i)?.[1] || parseStoryboardVideoSeconds(value);
}

function storyboardVideoRowSeconds(node: CanvasNodeData, nodes: CanvasNodeData[]) {
    if (node.type !== CanvasNodeType.Video || !node.metadata?.storyboardSourceNodeId || node.metadata.storyboardRowIndex === undefined) return "";
    const scriptNode = nodes.find((item) => item.id === node.metadata?.storyboardSourceNodeId);
    return parseStoryboardRowSeconds(parseStoryboardRows(scriptNode?.metadata?.storyboardRows)[node.metadata.storyboardRowIndex]);
}

function storyboardVideoSecondsForRow(templateSeconds: string | undefined, row?: string[]) {
    const seconds = String(templateSeconds || "").trim();
    if (seconds === "-1") return parseStoryboardRowSeconds(row) || "-1";
    return seconds || parseStoryboardRowSeconds(row) || "-1";
}

function applyStoryboardTailFrameToNextVideo(nodes: CanvasNodeData[], sourceNodeId: string | undefined, rowIndex: number | undefined, tailFrame: UploadedImage | null, variantIndex?: number, resultNodeId?: string) {
    if (!sourceNodeId || rowIndex === undefined || !tailFrame) return nodes;
    if (!storyboardUsesPreviousTailFrame(nodes, sourceNodeId, rowIndex + 1)) return nodes;
    const reference = storyboardTailFrameReference(rowIndex, tailFrame, variantIndex, resultNodeId);
    return nodes.map((node) => {
        if (node.type !== CanvasNodeType.Video || node.metadata?.storyboardSourceNodeId !== sourceNodeId || node.metadata.storyboardRowIndex !== rowIndex + 1 || node.metadata.content || node.metadata.storyboardVideoDraftNodeId) return node;
        const current = node.metadata.storyboardVideoReferences || [];
        const references = storyboardPrioritizedVideoReferences(mergeStoryboardVideoReferences(current, reference), storyboardGeneratedFirstFrameUsesReference(sourceNodeId, rowIndex + 1, reference, nodes));
        return { ...node, metadata: { ...node.metadata, ...storyboardVideoVisualReferencePatch(node.metadata.storyboardVideoFinalPrompt || node.metadata.prompt || "", references, node.metadata.storyboardVideoAudioReferences) } };
    });
}

function storyboardUsesPreviousTailFrame(nodes: CanvasNodeData[], sourceNodeId: string | undefined, rowIndex: number | undefined) {
    if (!sourceNodeId || rowIndex === undefined) return false;
    return Boolean(nodes.find((node) => node.id === sourceNodeId)?.metadata?.storyboardShotPlans?.[String(rowIndex)]?.usePreviousTailFrame);
}

function refreshStoryboardVideoDraftReferences(videoNode: CanvasNodeData, scriptNode: CanvasNodeData, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const rowIndex = videoNode.metadata?.storyboardRowIndex;
    if (rowIndex === undefined) return videoNode;
    const detail = storyboardCompletedPromptDetailForRow(scriptNode, rowIndex);
    const assetReferences = storyboardVideoAssetReferences(scriptNode, rowIndex, nodes);
    const automaticReferences = storyboardVideoReferencesFromAssetReferences(assetReferences);
    const plannedTailFrame = Boolean(scriptNode.metadata?.storyboardShotPlans?.[String(rowIndex)]?.usePreviousTailFrame);
    const existingReferences = plannedTailFrame ? videoNode.metadata?.storyboardVideoReferences || [] : (videoNode.metadata?.storyboardVideoReferences || []).filter((item) => item.role !== "firstFrame");
    const baseReferences = mergeStoryboardAutomaticVideoReferences(existingReferences, automaticReferences);
    const previousTailFrame = plannedTailFrame ? previousStoryboardTailFrameReference(scriptNode.id, rowIndex, nodes, connections) : null;
    const generatedFirstFrame = storyboardGeneratedFirstFrameForRow(scriptNode.id, rowIndex, nodes);
    const generatedUsesTailFrame = !previousTailFrame || storyboardGeneratedFirstFrameUsesReference(scriptNode.id, rowIndex, previousTailFrame, nodes);
    const references = storyboardPrioritizedVideoReferences(mergeStoryboardVideoReferences(mergeStoryboardVideoReferences(baseReferences, previousTailFrame), generatedFirstFrame), generatedUsesTailFrame);
    const basePrompt = videoNode.metadata?.storyboardVideoFinalPrompt || videoNode.metadata?.prompt || detail?.videoMotionPrompt || "";
    const linkedDetail = detail ? linkStoryboardPromptAssets(scriptNode, detail, nodes) : undefined;
    return {
        ...videoNode,
        metadata: {
            ...videoNode.metadata,
            ...storyboardVideoVisualReferencePatch(basePrompt, references, videoNode.metadata?.storyboardVideoAudioReferences, detail?.assetMentions),
            storyboardAssetMentions: assetReferences.map((item) => item.mention),
            storyboardAssetMentionLinks: linkedDetail?.assetMentionLinks || [],
        },
    };
}

function storyboardNextVideoDraftGridOrder(existingDrafts: CanvasNodeData[], workspacePosition: Position, spec: { width: number; height: number }) {
    let order = existingDrafts.length;
    while (true) {
        const x = workspacePosition.x + 36 + (order % STORYBOARD_VIDEO_GRID_COLUMNS) * (spec.width + 34);
        const y = workspacePosition.y + 86 + Math.floor(order / STORYBOARD_VIDEO_GRID_COLUMNS) * (spec.height + 74);
        if (!existingDrafts.some((draft) => Math.abs(draft.position.x - x) < spec.width * 0.5 && Math.abs(draft.position.y - y) < spec.height * 0.5)) return order;
        order += 1;
    }
}

function buildStoryboardVideoDraftNode(scriptNode: CanvasNodeData, row: string[], rowIndex: number, order: number, spec: { width: number; height: number }, generationConfig: AiConfig, workspacePosition: Position, nodes: CanvasNodeData[], connections: CanvasConnection[]): CanvasNodeData {
    const existing = nodes.find((node) => node.metadata?.storyboardSourceNodeId === scriptNode.id && node.metadata?.storyboardRowIndex === rowIndex && node.type === CanvasNodeType.Video && !node.metadata?.content && !node.metadata?.storyboardVideoDraftNodeId);
    const draftId = existing?.id || `storyboard-video-${scriptNode.id}-${rowIndex}`;
    const existingResults = nodes.filter((node) => node.metadata?.storyboardVideoDraftNodeId === draftId);
    const latestResult = [...existingResults].sort((a, b) => (b.metadata?.storyboardVideoVariantIndex || 0) - (a.metadata?.storyboardVideoVariantIndex || 0))[0];
    const detail = storyboardCompletedPromptDetailForRow(scriptNode, rowIndex);
    const sanitizedPrompt = safetyNeutralStoryboardPrompt(detail?.videoMotionPrompt?.trim() || row?.[8]?.trim() || row?.[2]?.trim() || "", true);
    const prompt = normalizeStoryboardModelPromptSpeech(scriptNode, parseStoryboardRows(scriptNode.metadata?.storyboardRows), rowIndex, sanitizedPrompt, storyboardVideoPromptDurationSeconds(scriptNode, row));
    const assetReferences = storyboardVideoAssetReferences(scriptNode, rowIndex, nodes);
    const audioReferences = storyboardVideoAudioReferences(scriptNode, rowIndex);
    const assetMentionLinks = detail ? linkStoryboardPromptAssets(scriptNode, detail, nodes).assetMentionLinks || [] : [];
    const autoVideoReferences = storyboardVideoReferencesFromAssetReferences(assetReferences);
    const plannedTailFrame = Boolean(scriptNode.metadata?.storyboardShotPlans?.[String(rowIndex)]?.usePreviousTailFrame);
    const existingVideoReferences = plannedTailFrame ? existing?.metadata?.storyboardVideoReferences || [] : (existing?.metadata?.storyboardVideoReferences || []).filter((item) => item.role !== "firstFrame");
    const baseVideoReferences = mergeStoryboardAutomaticVideoReferences(existingVideoReferences, autoVideoReferences);
    const preservedAudioReferences = (existing?.metadata?.storyboardVideoAudioReferences || []).filter((item) => item.source !== "script" || item.role !== "voiceLock");
    const baseAudioReferences = mergeStoryboardAudioReferenceList(preservedAudioReferences, audioReferences);
    const previousTailFrame = plannedTailFrame ? previousStoryboardTailFrameReference(scriptNode.id, rowIndex, nodes, connections) : null;
    const generatedFirstFrame = storyboardGeneratedFirstFrameForRow(scriptNode.id, rowIndex, nodes);
    const generatedUsesTailFrame = !previousTailFrame || storyboardGeneratedFirstFrameUsesReference(scriptNode.id, rowIndex, previousTailFrame, nodes);
    const finalVideoReferences = storyboardPrioritizedVideoReferences(mergeStoryboardVideoReferences(mergeStoryboardVideoReferences(baseVideoReferences, previousTailFrame), generatedFirstFrame), generatedUsesTailFrame);
    const customConfig = existing?.metadata?.storyboardVideoConfigCustomized ? existing.metadata : undefined;
    const videoModel = customConfig?.model || generationConfig.model;
    const videoSize = customConfig?.size || generationConfig.size;
    const videoSeconds = customConfig?.seconds || storyboardVideoSecondsForRow(generationConfig.videoSeconds, row);
    const videoQuality = customConfig?.vquality || generationConfig.vquality;
    const videoGenerateAudio = customConfig?.generateAudio ?? generationConfig.videoGenerateAudio ?? "true";
    const videoWatermark = customConfig?.watermark || generationConfig.videoWatermark;
    const existingFinalPrompt = existing?.metadata?.storyboardVideoFinalPrompt?.trim() || "";
    const existingBasePrompt = existing?.metadata?.prompt?.trim() || "";
    const finalPromptBase = (existing?.metadata?.storyboardVideoFinalPromptCustomized || existingBasePrompt === prompt) && existingFinalPrompt
        ? existingFinalPrompt
        : prompt;
    const visualReferencePatch = storyboardVideoVisualReferencePatch(finalPromptBase, finalVideoReferences, baseAudioReferences, detail?.assetMentions);
    return {
        id: draftId,
        type: CanvasNodeType.Video,
        title: `分镜视频 ${row?.[0] || rowIndex + 1}`,
        position: existing?.position || { x: workspacePosition.x + 36 + (order % STORYBOARD_VIDEO_GRID_COLUMNS) * (spec.width + 34), y: workspacePosition.y + 86 + Math.floor(order / STORYBOARD_VIDEO_GRID_COLUMNS) * (spec.height + 74) },
        width: existing?.width || spec.width,
        height: existing?.height || spec.height,
        metadata: {
            ...existing?.metadata,
            prompt,
            status: NODE_STATUS_IDLE,
            model: videoModel,
            size: videoSize,
            seconds: videoSeconds,
            vquality: videoQuality,
            generateAudio: videoGenerateAudio,
            watermark: videoWatermark,
            ...visualReferencePatch,
            storyboardSourceNodeId: scriptNode.id,
            storyboardChapterId: scriptNode.metadata?.storyboardShotPlans?.[String(rowIndex)]?.chapterId,
            storyboardRowIndex: rowIndex,
            storyboardAssetMentions: assetReferences.map((item) => item.mention),
            storyboardAssetMentionLinks: assetMentionLinks,
            storyboardVideoAudioReferences: baseAudioReferences,
            storyboardPromptSource: detail?.promptSource,
            storyboardPromptSkillRoot: detail?.promptSkillRoot,
            storyboardVideoLatestResultNodeId: existing?.metadata?.storyboardVideoLatestResultNodeId || latestResult?.id,
            storyboardVideoResultNodeIds: Array.from(new Set([...(existing?.metadata?.storyboardVideoResultNodeIds || []), ...existingResults.map((item) => item.id)])),
        },
    };
}

function storyboardVideoAssetReferenceNodes(videoNode: CanvasNodeData, nodes: CanvasNodeData[]) {
    const sourceId = videoNode.metadata?.storyboardSourceNodeId;
    const selectedNodeIds = (videoNode.metadata?.storyboardVideoReferences || []).map((item) => item.nodeId).filter((id): id is string => Boolean(id));
    const nodeIds = Array.from(new Set(selectedNodeIds.length ? selectedNodeIds : videoNode.metadata?.storyboardAssetReferenceNodeIds || []));
    if (nodeIds.length) return nodeIds.map((nodeId) => nodes.find((node) => node.id === nodeId)).filter((node): node is CanvasNodeData => Boolean(node));
    const mentions = videoNode.metadata?.storyboardAssetMentions || [];
    return nodes.filter((node) => node.type === CanvasNodeType.Image && node.metadata?.storyboardSourceNodeId === sourceId && node.metadata?.storyboardAssetName && mentions.includes(`@${node.metadata.storyboardAssetName}`));
}

function defaultStoryboardAssetWorkspacePositions(sourceNode: CanvasNodeData, assets: StoryboardAsset[], spec: { width: number; height: number }): Record<StoryboardAssetKind, Position> {
    const positions = {} as Record<StoryboardAssetKind, Position>;
    let x = sourceNode.position.x + sourceNode.width + 96;
    const y = sourceNode.position.y + STORYBOARD_WORKSPACE_TOP_OFFSET;
    for (const kind of STORYBOARD_ASSET_KINDS) {
        const count = assets.filter((asset) => asset.kind === kind).length;
        positions[kind] = { x, y };
        if (count) x += estimateStoryboardGridWorkspaceWidth(count, spec, STORYBOARD_ASSET_GRID_COLUMNS) + STORYBOARD_WORKSPACE_GAP;
    }
    return positions;
}

function defaultStoryboardVideoWorkspacePosition(sourceNode: CanvasNodeData, nodes: CanvasNodeData[]): Position {
    const videoWorkspaces = nodes.filter((node) => node.metadata?.workspaceKind === "storyboard-videos" && node.metadata.workspaceSourceNodeId === sourceNode.id).sort((a, b) => a.position.y - b.position.y);
    const previousEpisode = videoWorkspaces.at(-1);
    if (previousEpisode) return { x: previousEpisode.position.x, y: previousEpisode.position.y + previousEpisode.height + STORYBOARD_WORKSPACE_GAP };
    const assetSpec = storyboardNodeSize(CanvasNodeType.Image, sourceNode.metadata?.size);
    const assetWorkspaces = nodes.filter((node) => isStoryboardAssetWorkspace(node) && node.metadata?.workspaceSourceNodeId === sourceNode.id);
    if (assetWorkspaces.length) {
        return {
            x: Math.max(...assetWorkspaces.map((workspace) => workspace.position.x + workspace.width)) + STORYBOARD_WORKSPACE_GAP,
            y: Math.min(...assetWorkspaces.map((workspace) => workspace.position.y)),
        };
    }
    const assets = sourceNode.metadata?.storyboardAssets || [];
    const fallbackPositions = defaultStoryboardAssetWorkspacePositions(sourceNode, assets, assetSpec);
    const populatedKinds = STORYBOARD_ASSET_KINDS.filter((kind) => assets.some((asset) => asset.kind === kind));
    const assetRight = populatedKinds.length ? Math.max(...populatedKinds.map((kind) => fallbackPositions[kind].x + estimateStoryboardGridWorkspaceWidth(assets.filter((asset) => asset.kind === kind).length, assetSpec, STORYBOARD_ASSET_GRID_COLUMNS))) : sourceNode.position.x + sourceNode.width + 96;
    return { x: assetRight + STORYBOARD_WORKSPACE_GAP, y: fallbackPositions.character.y };
}

function estimateStoryboardGridWorkspaceWidth(count: number, spec: { width: number; height: number }, maxColumns: number) {
    const columns = Math.min(maxColumns, Math.max(count, 1));
    return 36 + columns * spec.width + Math.max(columns - 1, 0) * 34 + 36;
}

function estimateStoryboardGridWorkspaceHeight(count: number, spec: { width: number; height: number }, maxColumns: number) {
    const rows = Math.ceil(Math.max(count, 1) / maxColumns);
    return 86 + rows * spec.height + Math.max(rows - 1, 0) * 74 + 36;
}

function isStoryboardAssetWorkspace(node: CanvasNodeData) {
    return String(node.metadata?.workspaceKind) === "storyboard-assets" || STORYBOARD_ASSET_KINDS.some((kind) => node.metadata?.workspaceKind === STORYBOARD_ASSET_WORKSPACE_KIND[kind]);
}

function relayoutStoryboardVideoWorkspacesAfterAssets(nodes: CanvasNodeData[], sourceNodeId: string, assetWorkspaces: CanvasNodeData[]) {
    if (!assetWorkspaces.length) return nodes;
    const videoWorkspaces = nodes.filter((node) => node.metadata?.workspaceKind === "storyboard-videos" && node.metadata.workspaceSourceNodeId === sourceNodeId).sort((a, b) => a.position.y - b.position.y);
    if (!videoWorkspaces.length) return nodes;
    const x = Math.max(...assetWorkspaces.map((workspace) => workspace.position.x + workspace.width)) + STORYBOARD_WORKSPACE_GAP;
    let y = Math.min(...assetWorkspaces.map((workspace) => workspace.position.y));
    const moved = new Map<string, CanvasNodeData>();
    for (const workspace of videoWorkspaces) {
        const dx = x - workspace.position.x;
        const dy = y - workspace.position.y;
        const childIds = new Set(workspace.metadata?.workspaceChildNodeIds || []);
        moved.set(workspace.id, { ...workspace, position: { x, y } });
        nodes.forEach((node) => {
            if (moved.has(node.id) || node.id === workspace.id) return;
            const isStoryboardVideo = node.type === CanvasNodeType.Video && node.metadata?.storyboardSourceNodeId === sourceNodeId;
            if (!childIds.has(node.id) && !(isStoryboardVideo && isNodeInsideWorkspace(node, workspace))) return;
            moved.set(node.id, { ...node, position: { x: node.position.x + dx, y: node.position.y + dy } });
        });
        y += workspace.height + STORYBOARD_WORKSPACE_GAP;
    }
    return nodes.map((node) => moved.get(node.id) || node);
}

function buildStoryboardWorkspaceNode(existing: CanvasNodeData | undefined, id: string, sourceNode: CanvasNodeData, childNodes: CanvasNodeData[], position: Position, kind: "storyboard-character-assets" | "storyboard-scene-assets" | "storyboard-prop-assets" | "storyboard-videos", storyboardChapterId?: string): CanvasNodeData {
    const workspacePosition = existing?.position || position;
    const bounds = childNodes.reduce(
        (box, child) => ({
            left: Math.min(box.left, child.position.x),
            top: Math.min(box.top, child.position.y),
            right: Math.max(box.right, child.position.x + child.width),
            bottom: Math.max(box.bottom, child.position.y + child.height),
        }),
        { left: workspacePosition.x, top: workspacePosition.y, right: workspacePosition.x + NODE_DEFAULT_SIZE[CanvasNodeType.Workspace].width, bottom: workspacePosition.y + NODE_DEFAULT_SIZE[CanvasNodeType.Workspace].height },
    );
    const padding = 36;
    const episodeTitle = sourceNode.metadata?.storyboardChapters?.find((episode) => episode.id === storyboardChapterId)?.title;
    const assetKind = STORYBOARD_ASSET_KINDS.find((item) => STORYBOARD_ASSET_WORKSPACE_KIND[item] === kind);
    const title = assetKind ? `${assetKind === "character" ? "角色" : ASSET_KIND_TEXT[assetKind]}资产｜${sourceNode.title || "脚本节点"}` : `视频工作区｜${episodeTitle || sourceNode.title || "脚本节点"}`;
    return {
        id,
        type: CanvasNodeType.Workspace,
        title,
        position: workspacePosition,
        width: Math.max(existing?.width || 0, bounds.right - workspacePosition.x + padding),
        height: Math.max(existing?.height || 0, bounds.bottom - workspacePosition.y + padding),
        metadata: {
            ...existing?.metadata,
            status: NODE_STATUS_IDLE,
            workspaceKind: kind,
            workspaceSourceNodeId: sourceNode.id,
            workspaceStoryboardChapterId: storyboardChapterId,
            workspaceChildNodeIds: childNodes.map((child) => child.id),
            workspaceTitle: title,
        },
    };
}

function buildCharacterReferencePrompt(variant: CharacterReferenceVariant, description: string) {
    const detail = description.trim() || "以参考图为准，不额外改变角色设定。";
    return [
        "基于参考图生成同一个虚拟角色的素材库基准图。",
        "必须保持同一张脸、同一发型、同一体型、同一套服装、同一服装配色、同一画风和同一材质表现。",
        "不要改变年龄、性别、脸型、发色、服装款式、服装颜色、画面风格；不要出现多人；不要添加文字、水印、边框或拼贴排版。",
        `角色补充：${detail}`,
        `目标画面：${variant.target}`,
        "画面主体完整清晰，背景简洁干净，适合后续作为角色资产图、首帧图或视频参考图。",
    ].join("\n");
}

function storyboardAssetMentionsForPrompt(detail?: StoryboardPromptDetail) {
    const explicit = detail?.assetMentions || [];
    const text = `${detail?.storyboardPrompt || ""}\n${detail?.videoMotionPrompt || ""}`;
    const inline = Array.from(text.matchAll(/@([^\s@，,、。；;：:）)】\]]+)/g)).map((match) => `@${match[1].trim()}`);
    return Array.from(new Set([...explicit, ...inline].map(normalizeAssetMention).filter(Boolean)));
}

function storyboardAssetMentionsForKnownAssets(detail: StoryboardPromptDetail, assets: StoryboardAsset[]) {
    const text = `${detail.storyboardPrompt || ""}\n${detail.videoMotionPrompt || ""}`;
    const knownMentions = [...assets].sort((first, second) => second.name.length - first.name.length).filter((asset) => storyboardPromptContainsExactAssetMention(text, asset.name)).map((asset) => `@${asset.name}`);
    const explicit = (detail.assetMentions || []).map((mention) => matchKnownAssetMention(mention, assets)).filter(Boolean);
    return Array.from(new Set([...explicit, ...knownMentions]));
}

function matchKnownAssetMention(mention: string, assets: StoryboardAsset[]) {
    const normalized = normalizeAssetMention(mention);
    return assets.map((asset) => `@${asset.name}`).find((assetMention) => normalized === assetMention) || "";
}

function storyboardPromptContainsExactAssetMention(text: string, assetName: string) {
    return new RegExp(`${escapeRegExp(`@${assetName}`)}(?=$|[\\s，,、。；;：:）)】\\]])`).test(text);
}

function storyboardPromptAssetLinks(detail?: StoryboardPromptDetail) {
    return detail?.assetMentionLinks?.length ? detail.assetMentionLinks : [];
}

function linkStoryboardPromptAssets(scriptNode: CanvasNodeData, detail: StoryboardPromptDetail, nodes: CanvasNodeData[]): StoryboardPromptDetail {
    const assets = scriptNode.metadata?.storyboardAssets || [];
    const mentionNodeIds = scriptNode.metadata?.storyboardAssetMentionNodeIds || {};
    const assetNodeIds = scriptNode.metadata?.storyboardAssetNodeIds || {};
    const assetByMention = new Map(assets.map((asset) => [normalizeAssetMention(asset.name), asset]));
    const mentions = storyboardAssetMentionsForKnownAssets(detail, assets);
    const links = mentions.map((mention) => {
        const asset = assetByMention.get(mention);
        const nodeId = mentionNodeIds[mention] || (asset ? assetNodeIds[asset.id] : "");
        const assetNode = nodes.find((node) => node.id === nodeId) || nodes.find((node) => node.metadata?.storyboardSourceNodeId === scriptNode.id && node.metadata?.storyboardAssetName && mention === normalizeAssetMention(String(node.metadata.storyboardAssetName)));
        return {
            mention,
            name: asset?.name || mention.replace(/^@/, ""),
            status: assetNode ? "bound" : "missing",
            assetId: asset?.id,
            nodeId: assetNode?.id,
            kind: asset?.kind,
            source: assetNode ? "node" : undefined,
        } satisfies NonNullable<StoryboardPromptDetail["assetMentionLinks"]>[number];
    });
    return { ...detail, assetMentions: mentions, assetMentionLinks: links };
}

function relinkStoryboardPromptDetails(scriptNode: CanvasNodeData, nodes: CanvasNodeData[]) {
    const details = scriptNode.metadata?.storyboardPromptDetails || {};
    return Object.fromEntries(Object.entries(details).map(([rowIndex, detail]) => [rowIndex, linkStoryboardPromptAssets(scriptNode, detail, nodes)]));
}

function referenceImageFromCanvasNode(node?: CanvasNodeData | null): ReferenceImage | null {
    if (!node || node.type !== CanvasNodeType.Image || !node.metadata?.content) return null;
    return {
        id: node.id,
        name: `${node.title || node.id}.png`,
        type: node.metadata.mimeType || "image/png",
        dataUrl: node.metadata.content,
        url: node.metadata.content,
        storageKey: node.metadata.storageKey,
        referenceKind: node.metadata.storyboardAssetKind,
    };
}

function storyboardAssetReady(asset: Pick<StoryboardAsset, "imageUrl" | "storageKey">) {
    return Boolean(asset.imageUrl || asset.storageKey);
}

async function storyboardPromptComposeContextKey(value: string) {
    if (!globalThis.crypto?.subtle) return value;
    const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest)).map((item) => item.toString(16).padStart(2, "0")).join("");
}


function buildStoryboardPromptComposeSource(node: CanvasNodeData, rows: string[][], rowIndex: number, strictSafety = false) {
    const row = rows[rowIndex] || [];
    const shotPlan = node.metadata?.storyboardShotPlans?.[String(rowIndex)];
    const episodeAssets = storyboardPromptCandidateAssets(node.metadata?.storyboardAssets || [], shotPlan?.chapterId);
    const beatById = new Map((node.metadata?.storyboardSourceBeats || []).map((beat) => [beat.id, beat]));
    const sourceBeats = shotPlan?.sourceBeatIds.map((id) => beatById.get(id)).filter((beat): beat is StoryboardSourceBeat => Boolean(beat)) || [];
    const visualSourceBeats = storyboardVisualSourceBeats(sourceBeats, shotPlan);
    const voiceoverIds = new Set(shotPlan?.voiceoverBeatIds || []);
    const voiceoverSourceBeats = sourceBeats.filter((beat) => voiceoverIds.has(beat.id));
    const assets = storyboardSingleScenePromptAssets(storyboardRelevantPromptAssets(episodeAssets, visualSourceBeats, row, shotPlan), visualSourceBeats).filter((asset) => !strictSafety || !storyboardAssetHasSafetyRisk(asset));
    const assetLines = assets.length ? assets.map((asset) => storyboardPromptAssetLine(asset, strictSafety)).join("\n") : "本片段不传入角色或场景资产，请使用环境、道具、家庭成员反应或间接画面呈现，并在 assetMentions 里返回空数组。";
    const contextRows = strictSafety ? "" : [rowIndex - 1, rowIndex + 1].filter((index) => index >= 0 && index < rows.length).map((index) => {
        const adjacentPlan = node.metadata?.storyboardShotPlans?.[String(index)];
        return JSON.stringify({ relation: index < rowIndex ? "上一片段" : "下一片段", continuityGroupId: adjacentPlan?.continuityGroupId, transition: adjacentPlan?.transition, endState: index < rowIndex ? adjacentPlan?.endState : undefined, startState: index > rowIndex ? adjacentPlan?.startState : undefined });
    }).join("\n");
    const safeBeat = (beat: StoryboardSourceBeat) =>
        strictSafety
            ? { id: beat.id, phase: storyboardSafetyComposeText(beat.phase, true), timeStage: storyboardSafetyComposeText(beat.timeStage, true), location: storyboardSafetyComposeText(beat.location, true), event: storyboardSafetyComposeText(beat.event, true), emotion: storyboardSafetyComposeText(beat.emotion, true), treatment: beat.treatment }
            : { ...beat, sourceText: storyboardSafetyComposeText(beat.sourceText), event: storyboardSafetyComposeText(beat.event), emotion: storyboardSafetyComposeText(beat.emotion) };
    const safeVisualSourceBeats = visualSourceBeats.map(safeBeat);
    const safeVoiceoverSourceBeats = voiceoverSourceBeats.map(safeBeat);
    const safeShotPlan = shotPlan ? { ...shotPlan, timeStage: storyboardSafetyComposeText(shotPlan.timeStage, strictSafety), startState: storyboardSafetyComposeText(shotPlan.startState, strictSafety), endState: storyboardSafetyComposeText(shotPlan.endState, strictSafety), chapterTitle: storyboardSafetyComposeText(shotPlan.chapterTitle || "", strictSafety) || undefined, goal: storyboardSafetyComposeText(shotPlan.goal || "", strictSafety), obstacle: storyboardSafetyComposeText(shotPlan.obstacle || "", strictSafety), stakes: storyboardSafetyComposeText(shotPlan.stakes || "", strictSafety), tactic: storyboardSafetyComposeText(shotPlan.tactic || "", strictSafety), actionBeats: shotPlan.actionBeats?.map((item) => storyboardSafetyComposeText(item, strictSafety)), obstacleReaction: storyboardSafetyComposeText(shotPlan.obstacleReaction || "", strictSafety), turningAction: storyboardSafetyComposeText(shotPlan.turningAction || "", strictSafety), result: storyboardSafetyComposeText(shotPlan.result || "", strictSafety), valueShift: storyboardSafetyComposeText(shotPlan.valueShift || "", strictSafety) } : undefined;
    const safeRow = row.map((cell, index) => (strictSafety && ![0, 1, 2, 3, 4, 6, 7].includes(index) ? "" : storyboardSafetyComposeText(cell, strictSafety)));
    const currentRowLines = STORYBOARD_COLUMNS.map((column, colIndex) => (safeRow[colIndex] ? `${column}: ${safeRow[colIndex]}` : "")).filter(Boolean);
    const directorInstruction = storyboardDirectorInstructionForNode(node);
    const dramaturgyContext = storyboardDramaturgyContext(node, shotPlan?.sourceBeatIds);
    return [
        directorInstruction ? `整体要求/导演提示词：\n${storyboardSafetyComposeText(directorInstruction, strictSafety)}` : "",
        node.metadata?.storyboardAssetStyle ? `全局风格：\n${storyboardSafetyComposeText(node.metadata.storyboardAssetStyle, strictSafety)}` : "",
        dramaturgyContext ? `本片段剧作约束：\n${storyboardSafetyComposeText(JSON.stringify(dramaturgyContext), strictSafety)}\n剧作约束决定动作和节奏，不得覆盖事实与连续性计划。` : "",
        safeShotPlan ? `本片段事实与连续性计划：\n${JSON.stringify({ visualSourceBeats: safeVisualSourceBeats, voiceoverSourceBeats: safeVoiceoverSourceBeats, ...safeShotPlan })}\n画面只执行 visualSourceBeats；voiceoverSourceBeats 只进入锁定旁白，绝不改变当前画面的地点、人物时期、资产和动作链。` : "",
        buildSeedanceStoryboardPromptContext(node, rowIndex, assets),
        strictSafety ? "保守呈现要求：采用适合大众观看的间接画面，以环境变化、空镜、遗留物件、家庭成员的克制反应和旁白蒙太奇承载情节；保留因果与前后状态，不补写新的事件。" : "",
        shotPlan?.chapterId && node.metadata?.storyboardLockedNarrationChapterIds?.includes(shotPlan.chapterId) ? "本章旁白已经人工锁定：当前片段“对白旁白”中的 VO 必须逐字保留，只允许安排起止秒数，不得总结、扩写、改写或加入导演说明。" : "",
        `当前片段：\n${currentRowLines.join("\n")}`,
        contextRows ? `前后片段连续性边界（只承接起止状态，不得复制相邻剧情）：\n${contextRows}` : "",
        `第二步资产清单：\n${assetLines}`,
    ]
        .filter(Boolean)
        .join("\n\n");
}


function storyboardVideoPromptDurationSeconds(node: CanvasNodeData, row: string[]) {
    void node;
    void row;
    return 15;
}


const STORYBOARD_SHOT_REPAIR_TIMEOUT_MS = 90_000;

function repairStoryboardStableLanding(row: string[], plan: StoryboardShotPlan, issues: string[]): PlannedStoryboardShot | null {
    if (!issues.some((issue) => /12-15秒/.test(issue))) return null;
    const landing = [plan.result, plan.endState].filter(Boolean).join("；");
    if (!landing) return null;
    const nextRow = [...row];
    const lines = (nextRow[2] || "").split(/\r?\n/);
    const landingIndex = lines.findIndex((line) => /^\s*12\s*[-—–~至]\s*15\s*秒\s*[：:]/.test(line));
    const stableText = `保持${landing}，人物姿态和场景结构稳定不变，停在当前结果落点，画面不再增加新动作。`;
    if (landingIndex >= 0) {
        const prefix = lines[landingIndex].match(/^\s*12\s*[-—–~至]\s*15\s*秒\s*[：:]/)?.[0] || "12-15秒：";
        lines[landingIndex] = `${prefix}${stableText}`;
    } else if (lines.length === 3) {
        lines.push(`12-15秒：${stableText}`);
    } else {
        return null;
    }
    nextRow[2] = lines.join("\n");
    return { row: nextRow, plan: { ...plan, qualityError: undefined, renderMode: "video" } };
}

async function requestStoryboardShotQualityRepair(config: AiConfig, node: CanvasNodeData, row: string[], plan: StoryboardShotPlan, signal: AbortSignal): Promise<PlannedStoryboardShot> {
    let currentRow = [...row];
    let currentPlan = plan;
    let issues = storyboardShotQualityIssuesForShot({ row: currentRow, plan: currentPlan });
    if (!issues.length) return { row: [...row], plan: { ...plan, qualityError: undefined, renderMode: "video" } };
    const stableLandingRepair = repairStoryboardStableLanding(currentRow, currentPlan, issues);
    if (stableLandingRepair) {
        const repairedIssues = storyboardShotQualityIssuesForShot(stableLandingRepair);
        if (!repairedIssues.length) return stableLandingRepair;
        currentRow = stableLandingRepair.row;
        currentPlan = stableLandingRepair.plan;
        issues = repairedIssues;
    }
    const facts = (node.metadata?.storyboardSourceBeats || []).filter((beat) => currentPlan.sourceBeatIds.includes(beat.id));
    if (issues.every((issue) => issue.startsWith("旁白超过48字"))) {
        const answer = await requestImageQuestion(config, [{ role: "user", content: [
            "你是中文短剧旁白编辑。只压缩当前镜头旁白，不修改画面动作、事实、人物关系、叙事视角和情感落点，也不得新增原文没有的信息。",
            "删除秒数标签、重复的“旁白：”前缀和导演说明；改写为1-2句自然、完整、可朗读的中文旁白，目标36-45个汉字，硬上限48个汉字。",
            "只输出合法JSON：{\"dialogue\":\"压缩后的旁白\"}，不要输出解释或Markdown。",
            `【当前事实】\n${JSON.stringify(facts)}`,
            `【当前画面】\n${currentRow[2] || ""}`,
            `【需要压缩的对白旁白】\n${currentRow[5] || ""}`,
        ].join("\n\n") }], () => {}, { signal });
        const narration = storyboardNarrationWithinBudget(parseStoryboardNarrationRepairAnswer(answer), 15);
        if (!narration) throw new Error("模型没有返回可用旁白");
        const repaired = { row: currentRow.map((cell, index) => index === 5 ? narration : cell), plan: { ...currentPlan, qualityError: undefined, renderMode: "video" as const } };
        const repairedIssues = storyboardShotQualityIssuesForShot(repaired);
        if (repairedIssues.length) throw new Error(repairedIssues.join("、"));
        return repaired;
    }
    const immutableRules = "保持 sourceBeatIds、visualBeatIds、voiceoverBeatIds、镜头顺序、人物时期、连续性组、章节、转场和时长不变；只修正当前问题，不增加人物、关系、对白、地点、道具、冲突或结局。participants 必须明确 actor/patient；actionBeats 只写2-3拍，typedActionBeats 与其逐项对应并包含物理结果。visual 必须逐行写0-3、3-9、9-12、12-15秒四段详细动作；前三段写清执行者、身体部位或道具、动作对象和物理变化，12-15秒只保持已形成结果与稳定落点。对白旁白不得带秒数或导演说明，旁白不超过48字。";
    let retryIssues = issues;
    for (let attempt = 0; attempt < 2; attempt += 1) {
        const answer = await requestImageQuestion(config, [{ role: "user", content: [
            "你是写实传记短剧的分镜校对。根据当前事实和质量错误，只重写这一条生产片段。",
            immutableRules,
            `【当前事实】\n${JSON.stringify(facts)}`,
            `【当前问题】\n${retryIssues.join("、")}`,
            `【当前片段JSON】\n${JSON.stringify({ shots: [{ row: currentRow, plan: currentPlan }] })}`,
            "只输出合法JSON：{\"shots\":[修正后的这一项]}，不要输出解释或Markdown。",
        ].join("\n\n") }], () => {}, { signal });
        let parsed: PlannedStoryboardShot[];
        try {
            parsed = parsePlannedStoryboardShots(answer);
        } catch {
            const repairedJson = await requestImageQuestion(config, [{ role: "user", content: storyboardJsonRepairPrompt(answer) }], () => {}, { signal });
            parsed = parsePlannedStoryboardShots(repairedJson);
        }
        const candidate = parsed[0];
        if (!candidate) throw new Error("模型没有返回修正后的场景卡");
        const repaired: PlannedStoryboardShot = {
            row: candidate.row.map((cell, index) => index === 0 ? currentRow[0] : index === 1 ? currentRow[1] : cell),
            plan: {
                ...candidate.plan,
                shotId: currentPlan.shotId,
                sourceBeatIds: [...currentPlan.sourceBeatIds],
                visualBeatIds: currentPlan.visualBeatIds ? [...currentPlan.visualBeatIds] : undefined,
                voiceoverBeatIds: currentPlan.voiceoverBeatIds ? [...currentPlan.voiceoverBeatIds] : undefined,
                continuityGroupId: currentPlan.continuityGroupId,
                timeStage: currentPlan.timeStage,
                chapterId: currentPlan.chapterId,
                chapterTitle: currentPlan.chapterTitle,
                transition: currentPlan.transition,
                usePreviousTailFrame: currentPlan.usePreviousTailFrame,
                dramaticFunction: currentPlan.dramaticFunction,
                plotRhythm: currentPlan.plotRhythm,
                emotionRhythm: currentPlan.emotionRhythm,
                motionPriority: currentPlan.motionPriority,
                qualityError: undefined,
                renderMode: "video",
            },
        };
        retryIssues = storyboardShotQualityIssuesForShot(repaired);
        if (!retryIssues.length) return repaired;
    }
    throw new Error(retryIssues.join("、"));
}

function storyboardNarrationWithinBudget(value: string, duration: number) {
    const text = value.replace(/(?:^|\s)\d+(?:\.\d+)?\s*[-—–~至]\s*\d+(?:\.\d+)?\s*(?:秒|s)\s*(?:VO)?\s*[：:]?/gi, " ").replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
    const limit = Math.min(45, Math.max(16, Math.round(duration * 3.75)));
    if (Array.from(text).length <= limit) return text;
    const sentences = text.split(/(?<=[。！？!?；;])/).map((item) => item.trim()).filter(Boolean);
    let result = "";
    for (const sentence of sentences) {
        if (Array.from(result + sentence).length > limit) break;
        result += sentence;
    }
    return result || Array.from(text).slice(0, limit).join("");
}

function parseStoryboardNarrationRepairAnswer(answer: string) {
    const start = answer.indexOf("{");
    const end = answer.lastIndexOf("}");
    let value = "";
    if (start >= 0 && end <= start) return "";
    if (start >= 0 && end > start) {
        try {
            const parsed = JSON.parse(answer.slice(start, end + 1)) as { dialogue?: unknown };
            if (typeof parsed.dialogue === "string") value = parsed.dialogue;
        } catch {
            return "";
        }
    }
    return (value || answer)
        .replace(/^```(?:json|text)?\s*/i, "")
        .replace(/```$/i, "")
        .replace(/\d+(?:\.\d+)?\s*[-—–~至]\s*\d+(?:\.\d+)?\s*秒\s*[：:]?\s*/g, " ")
        .replace(/(?:旁白|VO)\s*[：:]\s*/gi, " ")
        .replace(/^[“"]|[”"]$/g, "")
        .replace(/\s+/g, "")
        .trim();
}

function storyboardVisualSourceBeats(sourceBeats: StoryboardSourceBeat[], shotPlan?: StoryboardShotPlan) {
    const visualIds = new Set(shotPlan?.visualBeatIds?.length ? shotPlan.visualBeatIds : sourceBeats.slice(0, 1).map((beat) => beat.id));
    const visual = sourceBeats.filter((beat) => visualIds.has(beat.id));
    return visual.length ? visual : sourceBeats.slice(0, 1);
}

function completeStoryboardPromptDetailAssets(node: CanvasNodeData, rows: string[][], rowIndex: number, detail: StoryboardPromptDetail) {
    const assets = node.metadata?.storyboardAssets || [];
    const normalized = normalizeStoryboardPromptDetailAssets(detail, assets);
    const shotPlan = node.metadata?.storyboardShotPlans?.[String(rowIndex)];
    const beatById = new Map((node.metadata?.storyboardSourceBeats || []).map((beat) => [beat.id, beat]));
    const sourceBeats = shotPlan?.sourceBeatIds.map((id) => beatById.get(id)).filter((beat): beat is StoryboardSourceBeat => Boolean(beat)) || [];
    const episodeAssets = storyboardPromptCandidateAssets(assets, shotPlan?.chapterId);
    const visualSourceBeats = storyboardVisualSourceBeats(sourceBeats, shotPlan);
    const relevant = storyboardRelevantPromptAssets(episodeAssets, visualSourceBeats, rows[rowIndex] || [], shotPlan);
    const characterNames = new Set<string>();
    const allowsMultiStageSamePerson = storyboardAllowsMultipleCharacterStages(visualSourceBeats, rows[rowIndex] || [], shotPlan);
    const requiredCharacters = relevant.filter((asset) => {
        if (asset.kind !== "character") return false;
        const name = asset.baseName || asset.name;
        if (characterNames.has(name) && !allowsMultiStageSamePerson) return false;
        characterNames.add(name);
        return true;
    });
    const scene = relevant.find((asset) => asset.kind === "scene");
    const prop = relevant.find((asset) => asset.kind === "prop");
    const required = [...requiredCharacters, scene, prop].filter((asset): asset is StoryboardAsset => Boolean(asset));
    const assetMentions = required.map((asset) => `@${asset.name}`);
    const boundAssets = assetMentions.map((mention) => assets.find((asset) => `@${asset.name}` === mention)).filter((asset): asset is StoryboardAsset => Boolean(asset));
    const selectedMentions = new Set(assetMentions);
    const removeUnselectedAssets = (prompt: string) => assets.reduce((result, asset) => {
        if (selectedMentions.has(`@${asset.name}`)) return result;
        const replacement = asset.kind === "character" ? asset.baseName || "当前人物" : asset.kind === "scene" ? "当前场景" : "当前道具";
        return result.replace(new RegExp(escapeRegExp(`@${asset.name}`), "g"), replacement);
    }, prompt);
    const cleanedStoryboardPrompt = removeUnselectedAssets(normalized.storyboardPrompt);
    const cleanedVideoMotionPrompt = removeUnselectedAssets(normalized.videoMotionPrompt);
    const storyboardPrompt = boundAssets.filter((asset) => !cleanedStoryboardPrompt.includes(`@${asset.name}`)).length
        ? `参考资产绑定：${boundAssets.map((asset) => `@${asset.name} ${storyboardAssetRoleHint(asset)}`).join("；")}\n\n${cleanedStoryboardPrompt}`.trim()
        : cleanedStoryboardPrompt;
    const videoReferences = boundAssets.map((asset): StoryboardVideoReference => ({ mention: `@${asset.name}`, name: asset.name, status: "bound", assetId: asset.id, kind: asset.kind, role: asset.kind === "scene" ? "sceneLock" : "reference", source: "script" }));
    return { ...normalized, storyboardPrompt, videoMotionPrompt: storyboardVideoPromptWithBoundReferences(cleanedVideoMotionPrompt, videoReferences, assets.map((asset) => `@${asset.name}`)), assetMentions };
}

function normalizeStoryboardModelPromptDetail(node: CanvasNodeData, rows: string[][], rowIndex: number, detail: StoryboardPromptDetail) {
    const duration = storyboardVideoPromptDurationSeconds(node, rows[rowIndex] || []);
    const withLockedSpeech = (videoMotionPrompt: string) => ({ ...detail, videoMotionPrompt: normalizeStoryboardModelPromptSpeech(node, rows, rowIndex, videoMotionPrompt, duration) });
    const plan = node.metadata?.storyboardShotPlans?.[String(rowIndex)];
    if (!plan) return withLockedSpeech(detail.videoMotionPrompt);
    const assets = (node.metadata?.storyboardAssets || []).filter((asset) => detail.assetMentions?.includes(`@${asset.name}`));
    const timelinePattern = new RegExp(`(【${duration}秒时间轴】)([\\s\\S]*?)(?=【镜头运动】)`);
    const timeline = detail.videoMotionPrompt.match(timelinePattern)?.[2];
    if (!timeline) return withLockedSpeech(detail.videoMotionPrompt);
    const segmentLines = timeline.split("\n");
    const segmentIndexes = segmentLines.flatMap((line, lineIndex) => /^\s*\d+(?:\.\d+)?\s*[-—–~至]\s*\d+(?:\.\d+)?\s*秒\s*[：:]/.test(line) ? [lineIndex] : []);
    if (segmentIndexes.length !== 4) return withLockedSpeech(detail.videoMotionPrompt);
    const participantNames = new Set((plan.participants || []).map((participant) => participant.name));
    const actionPropNames = new Set((plan.typedActionBeats || []).map((beat) => beat.prop).filter((name): name is string => Boolean(name)));
    const matchingSegments = (asset: StoryboardAsset) => (plan.typedActionBeats || []).flatMap((beat, beatIndex) => {
        const characterMatch = asset.kind === "character" && [beat.actor, beat.patient].some((name) => name === asset.name || name === asset.baseName);
        const propMatch = asset.kind === "prop" && Boolean(beat.prop && (beat.prop === asset.name || asset.name.includes(beat.prop)));
        return characterMatch || propMatch ? [Math.min(beatIndex, 2)] : [];
    });
    const mentionsForSegment = (segmentIndex: number) => assets.filter((asset) => {
        if (asset.kind === "scene") return segmentIndex === 0;
        const eligible = asset.kind === "character"
            ? participantNames.has(asset.name) || participantNames.has(asset.baseName || asset.name)
            : asset.kind === "prop" && (actionPropNames.has(asset.name) || Array.from(actionPropNames).some((name) => asset.name.includes(name)));
        if (!eligible) return false;
        const matches = matchingSegments(asset);
        return matches.length ? matches.includes(Math.min(segmentIndex, 2)) && segmentIndex < 3 : true;
    }).map((asset) => `@${asset.name}`);
    segmentIndexes.forEach((lineIndex, segmentIndex) => {
        const match = segmentLines[lineIndex].match(/^\s*(\d+(?:\.\d+)?)\s*[-—–~至]\s*(\d+(?:\.\d+)?)\s*秒\s*[：:]\s*(.*)$/);
        if (!match) return;
        const mentions = mentionsForSegment(segmentIndex);
        const missingMentions = mentions.filter((mention) => !match[3].includes(mention));
        let content = `${missingMentions.length ? `本段使用${missingMentions.join("、")}；` : ""}${match[3]}`;
        if (segmentIndex === 2 && plan.result?.trim() && !content.includes(`可见结果：${plan.result.trim()}`)) content = `可见结果：${plan.result.trim()}；${content}`;
        if (segmentIndex === 3) {
            const landing = [plan.result, plan.endState].filter(Boolean).join("；") || "当前动作结果";
            content = `画面保持在已形成的结果：${landing}；${mentions.length ? `${mentions.join("、")}的` : ""}人物姿态、物体位置和场景结构稳定不变，镜头停在当前结果落点，不再增加新动作、人物、地点、道具或剧情。`;
        }
        segmentLines[lineIndex] = `${match[1]}-${match[2]}秒：${content}`;
    });
    const videoMotionPrompt = detail.videoMotionPrompt.replace(timelinePattern, (_, marker: string) => `${marker}${segmentLines.join("\n")}`);
    return withLockedSpeech(videoMotionPrompt);
}

function normalizeStoryboardModelPromptSpeech(node: CanvasNodeData, rows: string[][], rowIndex: number, prompt: string, duration: number) {
    const locked = storyboardExpectedSpeechForRow(node, rows, rowIndex);
    if (!locked) return prompt;
    const ranges = duration === 15 ? [[0, 3], [3, 9], [9, 12]] : [[0, Math.max(1, Math.round(duration * 0.2))], [Math.max(1, Math.round(duration * 0.2)), Math.max(2, Math.round(duration * 0.6))], [Math.max(2, Math.round(duration * 0.6)), Math.max(3, Math.round(duration * 0.8))]];
    const narrationParts = splitStoryboardLockedNarration(locked.narration, ranges.map(([start, end]) => end - start));
    const sound = (rows[rowIndex]?.[6] || "现场环境声与当前动作音效").split(/[。；;]/)[0].trim();
    const lines = [
        `0-${duration}秒：<${sound}>。`,
        ...narrationParts.map((part, index) => part ? `${ranges[index][0]}-${ranges[index][1]}秒 VO：${part}` : ""),
        locked.dialogues.length ? `${ranges[2][0]}-${ranges[2][1]}秒 对白：${locked.dialogues.map((item) => `{${item}}`).join("；")}` : "",
    ].filter(Boolean);
    const marker = "【声音时间轴】";
    const endMarker = "【连续性与稳定约束】";
    const start = prompt.indexOf(marker);
    const end = start >= 0 ? prompt.indexOf(endMarker, start + marker.length) : -1;
    if (start < 0 || end < 0) return prompt;
    return `${prompt.slice(0, start)}${marker}\n${lines.join("\n")}\n${prompt.slice(end)}`;
}

function splitStoryboardLockedNarration(value: string, weights: number[]) {
    const remaining = Array.from(value || "");
    const totalWeight = weights.reduce((total, weight) => total + weight, 0);
    return weights.map((weight, index) => {
        if (!remaining.length) return "";
        if (index === weights.length - 1) return remaining.splice(0).join("");
        const target = Math.max(1, Math.round((remaining.length * weight) / Math.max(1, totalWeight - weights.slice(0, index).reduce((total, item) => total + item, 0))));
        const sample = remaining.slice(0, target).join("");
        const punctuation = Math.max(sample.lastIndexOf("。"), sample.lastIndexOf("；"), sample.lastIndexOf("，"));
        return remaining.splice(0, punctuation >= Math.floor(target * 0.6) ? punctuation + 1 : target).join("");
    });
}

function requiredAssetPriority(asset: StoryboardAsset) {
    return (asset.sceneSheetUrl || asset.sceneSheetStorageKey ? 2 : 0) + (asset.imageUrl || asset.storageKey ? 1 : 0);
}

function storyboardAssetRoleHint(asset: StoryboardAsset) {
    if (asset.kind === "scene") return "唯一场景空间参考，只控制地点结构、陈设、环境和光线关系，不承担人物身份。";
    if (asset.kind === "prop") return "核心道具参考，只控制外观、材质、尺寸、摆放位置和使用连续性。";
    const state = `${asset.name} ${asset.lifeStage || ""}`;
    if (/(出生|婴儿|新生儿|宝宝|幼儿|幼年)/.test(state)) return "被抱持或被照护的婴儿/幼年人物主体，只控制该年龄状态的外观，不执行成人动作。";
    return "当前镜头可见人物主体，负责执行场景卡中的主要动作；只控制脸型、年龄状态、发型、体态、服装和画风。";
}

function storyboardSceneMatchFragments(value: string) {
    const ignored = new Set(["画面", "场景", "人物", "镜头", "光线", "自然", "真实", "生活", "环境", "保持", "当前", "主体", "参考", "空间", "结构", "材质", "风格"]);
    const fragments = value.match(/[\u3400-\u9fffA-Za-z0-9]+/g) || [];
    return new Set(fragments.flatMap((fragment) => Array.from({ length: Math.max(0, fragment.length - 1) }, (_, index) => fragment.slice(index, index + 2))).filter((fragment) => !ignored.has(fragment)));
}

function storyboardTimelineHasExecutableAction(timeline: string, plan?: StoryboardShotPlan) {
    const segments = Array.from(timeline.matchAll(/(?:^|\n)\s*(\d+(?:\.\d+)?)\s*[-—–~至]\s*(\d+(?:\.\d+)?)\s*秒\s*[：:]([^\n]+)/g)).map((item) => item[3].trim()).slice(0, 3);
    const bodyOrPropTerms = ["右手", "左手", "双手", "手指", "手掌", "手腕", "手臂", "肩膀", "右腿", "左腿", "双腿", "膝盖", "脚掌", "脚趾", "脚步", "后背", "背部", "腰", "身体", "头部", "脸", "眼睛", "目光", "嘴唇", "木杖", ...(plan?.typedActionBeats || []).map((beat) => beat.prop || "")].filter(Boolean);
    const physicalActionTerms = ["牵", "跨", "蹬", "拉", "握", "撑", "迈", "跪", "转身", "抬", "压", "推", "托", "抱", "放入", "放下", "放到", "放进", "拿", "捡", "拾", "护", "扶", "攥", "抓", "踩", "踏", "弯腰", "伸手", "伸腿", "收回", "收紧", "起身", "站起", "坐下", "蹲下", "走", "跑", "移动", "挪动", "靠近", "转向", "拄", "贴", "递", "塞", "敷", "嚼"];
    return segments.flatMap((segment) => segment.split(/[，。；;！!？?]/).map((clause) => clause.trim()).filter(Boolean))
        .filter((clause) => !(/(?:镜头|运镜|摄像机|机位)/.test(clause) && /(?:推近|拉远|移动|横移|转动|跟拍|摇镜|升降)/.test(clause)))
        .filter((clause) => !/(?:保持不动|保持静止|没有移动|不再移动|不移动|未移动|停止动作|动作不变)/.test(clause))
        .some((clause) => bodyOrPropTerms.some((term) => clause.includes(term)) && physicalActionTerms.some((term) => clause.includes(term)));
}

function storyboardSceneFallbackScore(asset: StoryboardAsset, locations: string[], visualText: string) {
    const assetText = [asset.name, asset.description, asset.prompt].filter(Boolean).join(" ");
    const assetFragments = storyboardSceneMatchFragments(assetText);
    const overlap = (value: string) => Array.from(storyboardSceneMatchFragments(value)).filter((fragment) => assetFragments.has(fragment)).length;
    return locations.reduce((total, location) => total + overlap(location) * 6, 0) + overlap(visualText) * 2;
}

function storyboardPropMatchScore(asset: StoryboardAsset, visualText: string, actionText: string) {
    const assetNameFragments = storyboardSceneMatchFragments(asset.name);
    const assetDetailFragments = storyboardSceneMatchFragments(`${asset.description} ${asset.prompt}`);
    const scoreEvidence = (value: string, weight: number) => {
        const fragments = storyboardSceneMatchFragments(value);
        const nameOverlap = Array.from(fragments).filter((fragment) => assetNameFragments.has(fragment)).length;
        const detailOverlap = Array.from(fragments).filter((fragment) => assetDetailFragments.has(fragment)).length;
        if (!value.includes(asset.name) && nameOverlap === 0) return 0;
        return (value.includes(asset.name) ? 12 : 0) + nameOverlap * weight + Math.min(detailOverlap, 4);
    };
    return scoreEvidence(visualText, 4) + scoreEvidence(actionText, 6);
}

function storyboardLifeStageKey(value?: string) {
    const stage = String(value || "").replace(/\s+/g, "").replace(/(?:时期|阶段|时候)$/, "");
    if (/出生|新生|婴儿|襁褓/.test(stage)) return "婴儿";
    if (/童年|年少|儿童|幼年/.test(stage)) return "年少";
    if (/少年/.test(stage)) return "少年";
    if (/青年|年轻/.test(stage)) return "青年";
    if (/中年/.test(stage)) return "中年";
    if (/老年|晚年|年老/.test(stage)) return "晚年";
    if (/成年|成人/.test(stage)) return "成年";
    return stage;
}

function storyboardRelevantPromptAssets(assets: StoryboardAsset[], sourceBeats: StoryboardSourceBeat[], row: string[], shotPlan?: StoryboardShotPlan) {
    const participants = shotPlan?.participants || [];
    const evidence = [row[2], row[3], row[4], row[7], row[8], shotPlan?.timeStage, shotPlan?.goal, shotPlan?.tactic, shotPlan?.actionBeats?.join(" "), shotPlan?.result, ...participants.flatMap((participant) => [participant.name, participant.lifeStage]), ...sourceBeats.flatMap((beat) => [beat.location, beat.timeStage, beat.event, ...beat.characters])].filter(Boolean).join(" ");
    const propVisualText = [row[2], row[8], ...sourceBeats.flatMap((beat) => [beat.sourceText, beat.event])].filter(Boolean).join(" ");
    const propActionText = [shotPlan?.goal, shotPlan?.tactic, shotPlan?.actionBeats?.join(" "), shotPlan?.obstacleReaction, shotPlan?.turningAction, shotPlan?.result].filter(Boolean).join(" ");
    const currentStages = [shotPlan?.timeStage, ...participants.map((participant) => participant.lifeStage), ...sourceBeats.map((beat) => beat.timeStage)].filter((stage): stage is string => Boolean(stage));
    const characters = new Set([...sourceBeats.flatMap((beat) => beat.characters), ...participants.map((participant) => participant.name)]);
    const locations = sourceBeats.map((beat) => beat.location).filter(Boolean);
    const ranked = assets
        .map((asset) => {
            const identityMatch = asset.kind === "character" && [asset.name, asset.baseName].filter(Boolean).some((name) => evidence.includes(String(name)) || Array.from(characters).some((character) => String(name).includes(character) || character.includes(String(name))));
            const sceneMatch = asset.kind === "scene" && (evidence.includes(asset.name) || locations.some((location) => asset.name.includes(location) || location.includes(asset.name) || asset.description.includes(location)));
            const propScore = asset.kind === "prop" ? storyboardPropMatchScore(asset, propVisualText, propActionText) : 0;
            const lifeStage = asset.lifeStage;
            const participant = asset.kind === "character" ? participants.find((item) => item.name === asset.name || item.name === asset.baseName) : undefined;
            const assetStage = storyboardLifeStageKey(lifeStage);
            const participantStage = storyboardLifeStageKey(participant?.lifeStage);
            const stageMatch = asset.kind === "character" && Boolean(lifeStage && (evidence.includes(lifeStage) || currentStages.some((stage) => storyboardLifeStageKey(stage) === assetStage)));
            const stageScore = asset.kind !== "character" ? 0 : participantStage && assetStage ? participantStage === assetStage ? 10 : -12 : stageMatch ? 5 : lifeStage ? 0 : 1;
            const matchScore = (identityMatch ? 4 : 0) + (sceneMatch ? 3 : 0) + propScore;
            return { asset, score: matchScore ? matchScore + stageScore + requiredAssetPriority(asset) : 0 };
        })
        .filter((item) => item.score > 1)
        .sort((first, second) => second.score - first.score)
        .map((item) => item.asset);
    const matchedScene = ranked.find((asset) => asset.kind === "scene");
    const fallbackScene = assets
        .filter((asset) => asset.kind === "scene")
        .map((asset) => ({ asset, score: storyboardSceneFallbackScore(asset, locations, row[2] || "") }))
        .filter((item) => item.score > 0)
        .sort((first, second) => second.score - first.score || requiredAssetPriority(second.asset) - requiredAssetPriority(first.asset))[0]?.asset;
    const primaryScene = matchedScene || fallbackScene;
    const primaryProp = ranked.find((asset) => asset.kind === "prop");
    const selectedCharacterBases = new Set<string>();
    const allowsMultiStageSamePerson = storyboardAllowsMultipleCharacterStages(sourceBeats, row, shotPlan);
    const selectedCharacters = ranked
        .filter((asset) => {
            if (asset.kind !== "character") return false;
            if (allowsMultiStageSamePerson) return true;
            const baseName = asset.baseName || asset.name;
            if (selectedCharacterBases.has(baseName)) return false;
            selectedCharacterBases.add(baseName);
            return true;
        })
        .slice(0, 6 - Number(Boolean(primaryScene)) - Number(Boolean(primaryProp)));
    return [...selectedCharacters, primaryScene, primaryProp].filter((asset): asset is StoryboardAsset => Boolean(asset));
}

function storyboardAllowsMultipleCharacterStagesForRow(node: CanvasNodeData, rows: string[][], rowIndex: number) {
    const shotPlan = node.metadata?.storyboardShotPlans?.[String(rowIndex)];
    const beatById = new Map((node.metadata?.storyboardSourceBeats || []).map((beat) => [beat.id, beat]));
    const sourceBeats = shotPlan?.sourceBeatIds.map((id) => beatById.get(id)).filter((beat): beat is StoryboardSourceBeat => Boolean(beat)) || [];
    return storyboardAllowsMultipleCharacterStages(storyboardVisualSourceBeats(sourceBeats, shotPlan), rows[rowIndex] || [], shotPlan);
}

function storyboardAllowsMultipleCharacterStages(sourceBeats: StoryboardSourceBeat[], row: string[], shotPlan?: StoryboardShotPlan) {
    const evidence = [row[2], shotPlan?.timeStage, shotPlan?.goal, shotPlan?.actionBeats?.join(" "), shotPlan?.result, ...sourceBeats.flatMap((beat) => [beat.timeStage, beat.event, beat.emotion, ...beat.characters])].filter(Boolean).join(" ");
    return /(回忆对照|今昔对照|成长对照|出生与成长.{0,8}(?:对照|同框|同时可见)|同一人物.{0,16}(?:同框|同时可见)|(?:不同年龄|不同阶段|多个时期|多时期).{0,16}(?:对照|同框|同时可见)|(?:同框|同时可见).{0,16}(?:不同年龄|不同阶段|多个时期|多时期))/.test(evidence);
}

function storyboardSingleScenePromptAssets(assets: StoryboardAsset[], sourceBeats: StoryboardSourceBeat[]) {
    const locations = sourceBeats.map((beat) => beat.location).filter(Boolean);
    const scenes = assets.filter((asset) => asset.kind === "scene");
    const primaryScene = scenes.find((asset) => locations.some((location) => asset.name.includes(location) || location.includes(asset.name) || asset.description.includes(location))) || scenes[0];
    return assets.filter((asset) => asset.kind !== "scene" || asset.id === primaryScene?.id);
}

function storyboardAssetHasSafetyRisk(asset: StoryboardAsset) {
    return /婴儿|新生儿|宝宝|儿童|小孩|幼女|未成年|童年|残疾|残废|瘸|跛|断腿|瘫痪|夭折|早逝|病逝|死亡|去世|丧女|丧子|伤口|血迹|受虐|虐待|癌症|重病|绝症|高烧|病床|手术/.test([asset.name, asset.lifeStage, asset.description, asset.prompt].filter(Boolean).join(" "));
}

function storyboardPromptAssetLine(asset: StoryboardAsset, strictSafety = false) {
    const state = asset.kind === "character" ? [asset.baseName ? `本名：${asset.baseName}` : "", asset.lifeStage ? `状态：${storyboardSafetyComposeText(asset.lifeStage, strictSafety)}` : ""].filter(Boolean).join("，") : "";
    const description = `${storyboardAssetRoleHint(asset)} ${strictSafety ? "保持参考图中的身份、年龄状态、体态、服装和画风，不要重绘成其他角色。" : storyboardSafetyComposeText(asset.description || asset.prompt || "无描述")}`;
    return `- @${asset.name}｜${ASSET_KIND_TEXT[asset.kind]}${state ? `｜${state}` : ""}｜${description}`;
}

function buildSeedanceStoryboardPromptContext(node: CanvasNodeData, rowIndex: number, assets: StoryboardAsset[]) {
    const settings = [
        node.metadata?.size ? `画幅/比例：${node.metadata.size}` : "",
        node.metadata?.seconds ? `视频时长：${node.metadata.seconds}s` : "",
        node.metadata?.vquality ? `清晰度：${node.metadata.vquality}` : "",
        `生成声音：${node.metadata?.generateAudio === "false" ? "关闭" : "开启"}`,
        node.metadata?.watermark ? `水印设置：${node.metadata.watermark}` : "",
    ].filter(Boolean);
    const assetNames = assets.map((asset) => `@${asset.name}`).join("、") || "无";
    return [
        "Seedance 第三步合成上下文：",
        `- 当前是第 ${rowIndex + 1} 个视频片段，只为这一片段生成首帧提示词和视频运动提示词。`,
        "- videoMotionPrompt 要写成可直接给 Seedance 2.0 使用的中文导演指令，优先描述运动、镜头、光线、声音和稳定约束。",
        "- 不要把全部资产都塞进提示词；只选择本片段真正出现或需要绑定首帧/参考图的资产。",
        "- 资产名必须从已知资产中选择，不能编造，不能输出素材 ID、URL 或 storageKey。",
        "- 同一人物如有多个年龄/时期资产，必须按当前片段精确选择对应状态，不要用一个状态替代另一个状态。",
        "- 默认减少抽卡风险：主体绑定清楚、动作低歧义、一个主运镜、无字幕、无文字、无 Logo、无水印、人物身份和画风稳定。",
        `- 可用资产：${assetNames}`,
        settings.length ? `- 视频设置：${settings.join("；")}` : "",
    ]
        .filter(Boolean)
        .join("\n");
}

function parseStoryboardPromptDetailAnswer(content: string, assets: StoryboardAsset[] = []): StoryboardPromptDetail {
    const data = parseJsonObject(content) as Record<string, unknown>;
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("模型没有返回可用的提示词 JSON");
    const storyboardPrompt = safetyNeutralStoryboardPrompt(readStringField(data, ["storyboardPrompt", "分镜提示词", "imagePrompt", "prompt"]).trim());
    const videoMotionPrompt = safetyNeutralStoryboardPrompt(readStringField(data, ["videoMotionPrompt", "视频运动提示词", "videoPrompt", "motionPrompt"]).trim(), true);
    const mentionValue = data.assetMentions ?? data.assets ?? data["资产引用"];
    const assetMentions = (Array.isArray(mentionValue) ? mentionValue.map((item) => String(item || "")) : typeof mentionValue === "string" ? mentionValue.split(/[，,、\n]/) : []).map(normalizeAssetMention).filter(Boolean);
    if (!storyboardPrompt && !videoMotionPrompt) throw new Error("模型没有返回分镜提示词或视频运动提示词");
    return normalizeStoryboardPromptDetailAssets({ storyboardPrompt: storyboardPrompt || videoMotionPrompt, videoMotionPrompt: videoMotionPrompt || storyboardPrompt, assetMentions: Array.from(new Set(assetMentions)) }, assets);
}

function assertStoryboardVideoPromptFormat(prompt: string, duration: number, detail?: StoryboardPromptDetail, assets: StoryboardAsset[] = [], expectedSpeech?: ReturnType<typeof storyboardSpeechParts>, allowsMultipleCharacterStages = false, plan?: StoryboardShotPlan) {
    const sections = ["生成规格", "参考资产绑定", "叙事目标", "起始画面", `${duration}秒时间轴`, "镜头运动", "光线与画面质感", "声音时间轴", "连续性与稳定约束"];
    const missing = sections.filter((section) => !prompt.includes(`【${section}】`));
    if (missing.length) throw new Error(`视频运动提示词格式不完整：缺少${missing.join("、")}`);
    if (sections.some((section, index) => index > 0 && prompt.indexOf(`【${section}】`) <= prompt.indexOf(`【${sections[index - 1]}】`))) throw new Error("视频运动提示词格式不完整：栏目顺序不符合导演提示词模板");
    const directorSubsections = ["视频约束", "场景设定", "人物设定", "道具设定", "站位设定", "画面时序", "光影与氛围"];
    const missingSubsections = directorSubsections.filter((section) => !prompt.includes(`[${section}]`) && !prompt.includes(`【${section}】`));
    if (missingSubsections.length) throw new Error(`视频运动提示词格式不完整：导演脚本缺少${missingSubsections.join("、")}`);
    if (prompt.length > 2000) throw new Error("视频运动提示词格式不完整：正文超过2000字，需要压缩重复描述");
    const timeline = prompt.match(new RegExp(`【${duration}秒时间轴】([\\s\\S]*?)【镜头运动】`))?.[1] || "";
    const ranges = Array.from(timeline.matchAll(/(?:^|\n)\s*(\d+(?:\.\d+)?)\s*[-—–~至]\s*(\d+(?:\.\d+)?)\s*秒\s*[：:]/g)).map((item) => [Number(item[1]), Number(item[2])]);
    if (ranges.length !== 4 || ranges[0][0] !== 0 || ranges[ranges.length - 1][1] !== duration || ranges.some(([start, end], index) => end <= start || (index > 0 && start !== ranges[index - 1][1]))) {
        throw new Error(`视频运动提示词格式不完整：${duration}秒时间轴必须由4段连续时间组成，并从0秒精确覆盖到${duration}秒`);
    }
    if (duration === 15 && ranges.some(([start, end], index) => start !== [[0, 3], [3, 9], [9, 12], [12, 15]][index][0] || end !== [[0, 3], [3, 9], [9, 12], [12, 15]][index][1])) throw new Error("视频运动提示词格式不完整：15秒时间轴必须固定为0-3、3-9、9-12、12-15秒");
    const soundTimeline = prompt.match(/【声音时间轴】([\s\S]*?)【连续性与稳定约束】/)?.[1] || "";
    if (!new RegExp(`(?:^|\\n)\\s*0\\s*[-—–~至]\\s*${duration}\\s*秒\\s*[：:]`).test(soundTimeline)) throw new Error(`视频运动提示词格式不完整：声音时间轴必须用0-${duration}秒标明全程环境声或无声状态`);
    const voiceLines = Array.from(soundTimeline.matchAll(/(?:^|\n)\s*(\d+(?:\.\d+)?)\s*[-—–~至]\s*(\d+(?:\.\d+)?)\s*秒\s*VO\s*[：:]\s*([^\n]+)/gi));
    if (/与同时间段可见动作同步|可见动作同步|导演指令|声音时间轴/.test(voiceLines.map((item) => item[3]).join("\n"))) throw new Error("视频运动提示词格式不完整：旁白包含内部导演指令");
    const voiceLength = voiceLines.reduce((total, item) => total + Array.from(item[3].replace(/[^\u3400-\u9fffA-Za-z0-9]/g, "")).length, 0);
    const voiceLimit = duration === 15 ? 48 : Math.max(16, Math.round(duration * 3.2));
    if (voiceLength > voiceLimit) throw new Error(`视频运动提示词格式不完整：${duration}秒旁白共${voiceLength}字，超过自然语速上限${voiceLimit}字`);
    const normalizeSpeech = (value: string) => value.replace(/[^\u3400-\u9fffA-Za-z0-9]/g, "");
    if (expectedSpeech?.narration && normalizeSpeech(voiceLines.map((item) => item[3]).join("")) !== normalizeSpeech(expectedSpeech.narration)) throw new Error("视频运动提示词格式不完整：模型改写或遗漏了已锁定旁白");
    const dialogueLines = Array.from(soundTimeline.matchAll(/\{([^}]+)\}/g)).map((item) => item[1]);
    if (expectedSpeech?.dialogues.length && normalizeSpeech(dialogueLines.join("")) !== normalizeSpeech(expectedSpeech.dialogues.join(""))) throw new Error("视频运动提示词格式不完整：模型改写或遗漏了已锁定对白");
    if (voiceLines.some((item) => !ranges.some(([start, end]) => start === Number(item[1]) && end === Number(item[2])))) throw new Error("视频运动提示词格式不完整：每句VO的起止时间必须与画面时间轴对应分段完全一致");
    const finalRange = ranges.at(-1);
    const finalLine = finalRange ? timeline.match(new RegExp(`(?:^|\\n)\\s*${finalRange[0]}\\s*[-—–~至]\\s*${finalRange[1]}\\s*秒\\s*[：:]([^\\n]+)`))?.[1] || "" : "";
    if (!/稳定|保持|停住|静止|落点|不再/.test(finalLine)) throw new Error("视频运动提示词格式不完整：最后3秒必须只保持稳定落点，不得继续增加剧情");
    const sceneMentions = assets.filter((asset) => asset.kind === "scene" && ((detail?.assetMentions || []).includes(`@${asset.name}`) || prompt.includes(`@${asset.name}`)));
    if (new Set(sceneMentions.map((asset) => asset.id)).size > 1) throw new Error("视频运动提示词格式不完整：普通片段最多只能绑定一个主要场景资产");
    assertStoryboardAssetRoleConsistency(prompt, detail, assets, allowsMultipleCharacterStages, plan);
}

function assertStoryboardAssetRoleConsistency(prompt: string, detail: StoryboardPromptDetail | undefined, assets: StoryboardAsset[], allowsMultipleCharacterStages: boolean, plan?: StoryboardShotPlan) {
    const mentions = new Set([...(detail?.assetMentions || []), ...assets.filter((asset) => prompt.includes(`@${asset.name}`)).map((asset) => `@${asset.name}`)]);
    const participantNames = new Set((plan?.participants || []).map((participant) => participant.name));
    const actionPropNames = new Set((plan?.typedActionBeats || []).map((beat) => beat.prop).filter((name): name is string => Boolean(name)));
    const characterAssets = assets.filter((asset) => asset.kind === "character" && mentions.has(`@${asset.name}`) && (!plan || participantNames.has(asset.name) || participantNames.has(asset.baseName || asset.name)));
    const byBaseName = new Map<string, StoryboardAsset[]>();
    characterAssets.forEach((asset) => {
        const baseName = asset.baseName || asset.name;
        byBaseName.set(baseName, [...(byBaseName.get(baseName) || []), asset]);
    });
    for (const [baseName, candidates] of byBaseName) {
        const stages = new Set(candidates.map((asset) => asset.lifeStage || asset.name));
        if (stages.size > 1 && !allowsMultipleCharacterStages) {
            throw new Error(`视频运动提示词格式不完整：人物“${baseName}”同时绑定了多个年龄/时期资产，当前镜头必须只选择一个时期`);
        }
    }
    const infantAssets = characterAssets.filter((asset) => /(出生|婴儿|新生儿|宝宝|幼儿|幼年)/.test(`${asset.name} ${asset.lifeStage || ""}`));
    infantAssets.forEach((asset) => {
        const mention = `@${asset.name}`;
        if (!new RegExp(`${escapeRegExp(mention)}[^\n]{0,120}(?:婴儿|新生儿|宝宝|被抱|被照护|被放置|被安置)`).test(prompt)) {
            throw new Error(`视频运动提示词格式不完整：${mention}必须明确作为婴儿/被照护对象绑定，不能只写成人物身份参考`);
        }
    });
    const timeline = prompt.match(/【\d+秒时间轴】([\s\S]*?)【镜头运动】/)?.[1] || "";
    const startFrame = prompt.match(/【起始画面】([\s\S]*?)【\d+秒时间轴】/)?.[1] || "";
    const propAssets = assets.filter((asset) => asset.kind === "prop" && mentions.has(`@${asset.name}`) && (!plan || actionPropNames.has(asset.name) || Array.from(actionPropNames).some((name) => asset.name.includes(name))));
    const sceneAssets = assets.filter((asset) => asset.kind === "scene" && mentions.has(`@${asset.name}`));
    const timelineSegments = Array.from(timeline.matchAll(/(?:^|\n)\s*(\d+(?:\.\d+)?)\s*[-—–~至]\s*(\d+(?:\.\d+)?)\s*秒\s*[：:]([^\n]+)/g)).map((item) => item[3].trim());
    [...characterAssets, ...propAssets].forEach((asset) => {
        const matchingBeatIndexes = (plan?.typedActionBeats || []).flatMap((beat, index) => {
            const characterMatch = asset.kind === "character" && [asset.name, asset.baseName || asset.name].some((name) => [beat.actor, beat.patient].includes(name));
            const propMatch = asset.kind === "prop" && Boolean(beat.prop && (asset.name === beat.prop || asset.name.includes(beat.prop)));
            return characterMatch || propMatch ? [Math.min(index, 2)] : [];
        });
        const targetSegments = matchingBeatIndexes.length ? Array.from(new Set(matchingBeatIndexes)).map((index) => timelineSegments[index] || "") : timelineSegments;
        if (!targetSegments.every((segment) => segment.includes(`@${asset.name}`))) throw new Error(`视频运动提示词格式不完整：@${asset.name}只声明了参考职责，没有在每个实际参与的动作时间段中使用`);
    });
    sceneAssets.forEach((asset) => {
        if (!`${startFrame}\n${timelineSegments[0] || ""}`.includes(`@${asset.name}`)) throw new Error(`视频运动提示词格式不完整：@${asset.name}必须出现在起始画面或0-3秒建场动作中`);
    });
    if (characterAssets.length && !storyboardTimelineHasExecutableAction(timeline, plan)) {
        throw new Error("视频运动提示词格式不完整：画面时序缺少可执行的身体部位、站位或物理动作");
    }
}

function assertStoryboardPromptActionCoverage(prompt: string, plan?: StoryboardShotPlan, firstStepVisual = "") {
    if (!plan) return;
    const timeline = prompt.match(/【\d+秒时间轴】([\s\S]*?)【镜头运动】/)?.[1] || "";
    const segments = Array.from(timeline.matchAll(/(?:^|\n)\s*(\d+(?:\.\d+)?)\s*[-—–~至]\s*(\d+(?:\.\d+)?)\s*秒\s*[：:]([^\n]+)/g)).map((item) => ({ start: Number(item[1]), end: Number(item[2]), content: item[3].trim() }));
    if (segments.length !== 4) throw new Error("视频运动提示词格式不完整：动作时间轴必须保持四段结构");
    const actionSegments = segments.filter((segment) => (segment.start === 3 && segment.end === 9) || (segment.start === 9 && segment.end === 12));
    if (actionSegments.length !== 2 || actionSegments.some((segment) => !segment.content)) throw new Error("视频运动提示词格式不完整：3-9秒和9-12秒必须分别承载动作链前后段");
    const openingSegment = segments[0]?.content || "";
    if (!openingSegment || /^(?:以?.{0,8})?(?:建立|展示|交代)(?:当前)?(?:场景|环境|空间|站位)[，。；]?$/.test(openingSegment) || Array.from(openingSegment.replace(/[^\u3400-\u9fffA-Za-z0-9]/g, "")).length < 24) throw new Error("视频运动提示词格式不完整：0-3秒必须在建场同时执行第一拍详细物理动作，不能只有场景说明");
    (plan.typedActionBeats || []).forEach((beat, index) => {
        const actual = storyboardSceneMatchFragments(segments[Math.min(index, 2)]?.content || "");
        const actionRequired = storyboardSceneMatchFragments(beat.action);
        const resultRequired = storyboardSceneMatchFragments(beat.result || "");
        const actionOverlap = Array.from(actionRequired).filter((item) => actual.has(item)).length;
        const resultOverlap = Array.from(resultRequired).filter((item) => actual.has(item)).length;
        if (actionOverlap < Math.min(2, actionRequired.size) || resultOverlap < Math.min(1, resultRequired.size)) throw new Error(`视频运动提示词格式不完整：第${index + 1}段没有继承场景卡对应动作与物理结果`);
    });
    const firstStepSegments = Array.from(firstStepVisual.matchAll(/(?:^|\n)\s*(\d+(?:\.\d+)?)\s*[-—–~至]\s*(\d+(?:\.\d+)?)\s*秒\s*[：:]([^\n]+)/g)).map((item) => item[3].trim());
    if (firstStepSegments.length === 4) firstStepSegments.slice(0, 3).forEach((content, index) => {
        const beat = plan.typedActionBeats?.[Math.min(index, Math.max(0, (plan.typedActionBeats?.length || 1) - 1))];
        const traceLabels = [...(plan.participants || []).map((participant) => participant.name), beat?.prop || ""].filter(Boolean);
        const stripLabels = (value: string) => traceLabels.reduce((result, label) => result.split(label).join(""), value);
        const required = storyboardSceneMatchFragments(stripLabels(content));
        const actual = storyboardSceneMatchFragments(stripLabels(segments[index]?.content || ""));
        if (Array.from(required).filter((item) => actual.has(item)).length < Math.min(2, required.size)) throw new Error(`视频运动提示词格式不完整：第${index + 1}段没有继承第一步对应时间段的详细动作`);
    });
    if (!plan.result?.trim() || !actionSegments[1].content.includes("可见结果")) throw new Error("视频运动提示词格式不完整：9-12秒必须用“可见结果”标记场景卡结果");
    const finalSegment = segments[3]?.content || "";
    if (!/稳定|保持|停住|静止|落点|不再/.test(finalSegment)) throw new Error("视频运动提示词格式不完整：12-15秒必须保持结果稳定落点");
}

function assertStoryboardProductionContractReady(
    node: CanvasNodeData,
    rows: string[][],
    rowIndex: number,
    detail: StoryboardPromptDetail,
    orderedReferences: StoryboardVideoReference[],
    stage: StoryboardProductionContractStage,
) {
    const audit = auditStoryboardProductionContract({
        sourceBeats: node.metadata?.storyboardSourceBeats || [],
        format: node.metadata?.storyboardDramaturgyPlan?.format,
        shotPlan: node.metadata?.storyboardShotPlans?.[String(rowIndex)],
        row: rows[rowIndex] || [],
        assets: node.metadata?.storyboardAssets || [],
        promptDetail: detail,
        orderedReferences,
    }, stage);
    const blocked = audit.issues.filter((issue) => issue.level === "blocked");
    if (blocked.length) throw new Error(`分镜生产契约未通过：${blocked.map((issue) => issue.message).join("；")}`);
    return audit;
}

function prepareStoryboardPromptDetailForSave(node: CanvasNodeData, rows: string[][], rowIndex: number, source: StoryboardPromptDetail, nodes: CanvasNodeData[], normalizeModelOutput = false) {
    let detail = completeStoryboardPromptDetailAssets(node, rows, rowIndex, source);
    if (normalizeModelOutput) detail = normalizeStoryboardModelPromptDetail(node, rows, rowIndex, detail);
    detail = linkStoryboardPromptAssets(node, detail, nodes);
    const duration = storyboardVideoPromptDurationSeconds(node, rows[rowIndex] || []);
    assertStoryboardVideoPromptFormat(detail.videoMotionPrompt, duration, detail, node.metadata?.storyboardAssets || [], storyboardExpectedSpeechForRow(node, rows, rowIndex), storyboardAllowsMultipleCharacterStagesForRow(node, rows, rowIndex), node.metadata?.storyboardShotPlans?.[String(rowIndex)]);
    assertStoryboardPromptActionCoverage(detail.videoMotionPrompt, node.metadata?.storyboardShotPlans?.[String(rowIndex)], rows[rowIndex]?.[2]);
    assertStoryboardProductionContractReady(node, rows, rowIndex, detail, storyboardContractReferencesForDetail(detail, node.metadata?.storyboardAssets || []), "prompt");
    return detail;
}

function assertStoryboardVideoNodeProductionReady(scriptNode: CanvasNodeData, videoNode: CanvasNodeData, stage: "draft" | "submit") {
    const rowIndex = videoNode.metadata?.storyboardRowIndex;
    if (rowIndex === undefined) throw new Error("分镜生产契约未通过：视频节点缺少分镜序号");
    const rows = parseStoryboardRows(scriptNode.metadata?.storyboardRows);
    const sourceDetail = storyboardCompletedPromptDetailForRow(scriptNode, rowIndex);
    const references = videoNode.metadata?.storyboardVideoReferences || [];
    const finalPrompt = videoNode.metadata?.storyboardVideoFinalPrompt?.trim() || videoNode.metadata?.prompt?.trim() || "";
    const detail: StoryboardPromptDetail = {
        ...(sourceDetail || { storyboardPrompt: finalPrompt, videoMotionPrompt: finalPrompt }),
        storyboardPrompt: sourceDetail?.storyboardPrompt || finalPrompt,
        videoMotionPrompt: finalPrompt,
        assetMentions: references.filter((reference) => reference.assetId || reference.kind).map((reference) => normalizeAssetMention(reference.mention)),
    };
    const duration = storyboardVideoPromptDurationSeconds(scriptNode, rows[rowIndex] || []);
    assertStoryboardVideoPromptFormat(finalPrompt, duration, detail, scriptNode.metadata?.storyboardAssets || [], storyboardExpectedSpeechForRow(scriptNode, rows, rowIndex), storyboardAllowsMultipleCharacterStagesForRow(scriptNode, rows, rowIndex), scriptNode.metadata?.storyboardShotPlans?.[String(rowIndex)]);
    assertStoryboardPromptActionCoverage(finalPrompt, scriptNode.metadata?.storyboardShotPlans?.[String(rowIndex)], rows[rowIndex]?.[2]);
    return assertStoryboardProductionContractReady(scriptNode, rows, rowIndex, detail, references, stage);
}

function storyboardContractReferencesForDetail(detail: StoryboardPromptDetail, assets: StoryboardAsset[]) {
    const linkByMention = new Map((detail.assetMentionLinks || []).map((link) => [link.mention, link]));
    return (detail.assetMentions || []).flatMap((mention): StoryboardVideoReference[] => {
        const asset = assets.find((item) => `@${item.name}` === mention);
        const link = linkByMention.get(mention);
        if (!asset && !link) return [];
        return [{
            mention,
            name: asset?.name || link?.name || mention.replace(/^@/, ""),
            status: link?.status || "bound",
            assetId: asset?.id || link?.assetId,
            nodeId: link?.nodeId,
            kind: asset?.kind || link?.kind,
            source: link?.source || "script",
            role: (asset?.kind || link?.kind) === "scene" ? "sceneLock" : "reference",
        }];
    });
}

function storyboardLockedSpeechForRow(node: CanvasNodeData, rows: string[][], rowIndex: number) {
    const chapterId = node.metadata?.storyboardShotPlans?.[String(rowIndex)]?.chapterId;
    if (!chapterId || !node.metadata?.storyboardLockedNarrationChapterIds?.includes(chapterId)) return undefined;
    const speech = storyboardSpeechParts(rows[rowIndex]?.[5] || "");
    const clean = (value: string) => value
        .replace(/(?:^|\n)\s*\d+(?:\.\d+)?\s*[-—–~至]\s*\d+(?:\.\d+)?\s*秒\s*[：:]?\s*/g, " ")
        .replace(/(?:旁白|VO)\s*[：:]\s*/gi, " ")
        .replace(/\s+/g, "")
        .trim();
    return { narration: clean(speech.narration), dialogues: speech.dialogues.map(clean).filter(Boolean) };
}

function storyboardExpectedSpeechForRow(node: CanvasNodeData, rows: string[][], rowIndex: number) {
    return String(node.metadata?.generateAudio ?? "true") === "false" ? undefined : storyboardLockedSpeechForRow(node, rows, rowIndex);
}

function normalizeStoryboardVideoPromptLayout(prompt: string, duration: number) {
    const sections = ["生成规格", "参考资产绑定", "叙事目标", "起始画面", `${duration}秒时间轴`, "镜头运动", "光线与画面质感", "声音时间轴", "连续性与稳定约束"];
    let result = prompt.trim();
    sections.forEach((section) => {
        result = result.replace(new RegExp(`\\s*【${section}】\\s*`), `\n\n【${section}】\n`);
    });
    return result.replace(/\s+(?=\d+(?:\.\d+)?\s*[-—–~至]\s*\d+(?:\.\d+)?\s*秒\s*[：:])/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function normalizeStoryboardPromptDetailAssets(detail: StoryboardPromptDetail, assets: StoryboardAsset[]): StoryboardPromptDetail {
    if (!assets.length) return { ...detail, assetMentions: [] };
    const knownMentions = assets.map((asset) => normalizeAssetMention(asset.name));
    const text = `${detail.storyboardPrompt}\n${detail.videoMotionPrompt}`;
    const explicit = (detail.assetMentions || []).map((mention) => matchKnownAssetMention(mention, assets) || normalizeAssetMention(mention));
    const inline = knownMentions.filter((mention) => storyboardPromptContainsExactAssetMention(text, mention.replace(/^@/, "")));
    const assetMentions = Array.from(new Set([...explicit, ...inline].filter((mention) => knownMentions.includes(mention))));
    return { ...detail, assetMentions };
}

function normalizeAssetMention(value: string) {
    const name = value.trim().replace(/^@+/, "");
    return name ? `@${name}` : "";
}

function storyboardSourceTextForNode(node: CanvasNodeData) {
    const sourceText = node.metadata?.storyboardSourceText?.trim();
    const prompt = storyboardDirectorInstructionForNode(node);
    if (sourceText && prompt && !sourceText.includes(prompt)) return `【整体要求/导演提示词】\n${prompt}\n\n${sourceText}`;
    if (sourceText) return sourceText;
    if (prompt) return prompt;
    if (!node.metadata?.storyboardRows?.length) return node.metadata?.content?.trim() || "";
    return "";
}

function storyboardDirectorInstructionForNode(node: CanvasNodeData) {
    const prompt = node.metadata?.prompt?.trim();
    const source = prompt || STORYBOARD_SCRIPT_PRESET;
    const match = source.match(/^【可编辑项目设定】\s*([\s\S]*?)(?=\n【AI定制说明】|$)/);
    return match ? `【可编辑项目设定】\n\n${match[1].trim()}` : source;
}

function parseStoryboardProjectSettingsAnswer(content: string) {
    const clean = content.replace(/^```\w*\s*/i, "").replace(/```\s*$/i, "").trim();
    const match = clean.match(/【可编辑项目设定】\s*([\s\S]*?)(?=\n【[^】]+】|$)/);
    if (!match) throw new Error("AI 没有按要求返回【可编辑项目设定】");
    const body = match[1]
        .replace(/\*\*|__|`/g, "")
        .replace(/^\s*(?:#{1,6}\s*|[-+*>]\s+|\d+[.、)]\s*)/gm, "")
        .trim();
    const requiredFields = ["叙事原则", "视觉风格", "叙事视角", "色调与光影", "人物一致性", "场景一致性", "镜头与节奏", "对白与旁白", "配乐与音效", "字幕与屏幕文字", "安全表达", "画面约束", "视频规格"];
    const missing = requiredFields.filter((field) => !new RegExp(`(?:^|\\n)\\s*${field}\\s*[：:]`).test(body));
    if (missing.length) throw new Error(`AI 返回的项目设定缺少：${missing.join("、")}`);
    return `【可编辑项目设定】\n\n${body}`;
}

function withCurrentStoryboardDirectorPreset(node: CanvasNodeData) {
    const prompt = node.metadata?.prompt?.trim() || "";
    const legacyOutputPrompt = /只输出\s*Markdown\s*表格|表格列必须严格为/.test(prompt);
    const previousGenericPreset = prompt.startsWith("【可编辑项目设定】") && prompt.includes("镜头拆分、原文覆盖检查、结构化输出、资产时期规划和连续性规则由工作流自动处理") && !prompt.includes("【AI定制说明】");
    if (!legacyOutputPrompt && !previousGenericPreset) return node;
    return { ...node, metadata: { ...node.metadata, prompt: STORYBOARD_SCRIPT_PRESET } };
}

function buildStoryboardShotBatchSource(sourceText: string, beats: StoryboardSourceBeat[], batchIndex: number, previous?: StoryboardShotPlan, repair = false, directorInstruction = "", clipPlanInstruction = "", dramaturgyPlan?: StoryboardDramaturgyPlan, targetShotCount?: number) {
    const batchPrefix = `G${String(batchIndex + 1).padStart(2, "0")}`;
    return [
        STORYBOARD_PLANNED_SHOTS_PROMPT,
        clipPlanInstruction,
        targetShotCount ? `【本批精确预算】\n本批必须严格输出 ${targetShotCount} 个shots，不多不少；${beats.length}个事实ID必须全部出现在这${targetShotCount}个shots的sourceBeatIds中，每个shot只选1个visualBeatId，其余事实放voiceoverBeatIds。` : "",
        dramaturgyPlan ? `【全片剧作总纲】\n${JSON.stringify(dramaturgyPlan)}\n总纲只决定戏剧功能、节奏和视觉强调，不得覆盖本批事实或创造新剧情。` : "",
        directorInstruction ? `【整体要求/导演提示词】\n${directorInstruction}` : "",
        repair ? "这是覆盖检查发现的遗漏事实补镜。只补这些事实，不重写已有镜头；新镜头默认切镜，不要假装与不相邻镜头连续。" : `这是第 ${batchIndex + 1} 批。新连续性组使用 ${batchPrefix} 开头的编号；只有第一条与上一批确实同场景、同人物时期且动作直接相承时，才可复用上一批最后的 continuityGroupId。`,
        previous ? `【上一批最后状态】\n${JSON.stringify(previous)}` : "【上一批最后状态】\n无，这是故事首批。",
        `【本批必须全部覆盖的事实】\n${JSON.stringify(beats)}`,
        `【原始故事，仅用于核对语境，不得跳过本批事实】\n${sourceText}`,
    ].join("\n\n");
}

function parseStoryboardAssetAnswer(content: string): { style: string; assets: StoryboardAsset[] } {
    const data = parseJsonObject(content) as Record<string, unknown> | unknown[];
    const records = collectStoryboardAssetRecords(data);
    if (!records.length) throw new Error("模型没有返回可用的资产 JSON");
    const assets = records
        .map(({ item, kind }, index) => normalizeStoryboardAsset(item, index, kind))
        .filter((asset): asset is StoryboardAsset => Boolean(asset))
        .slice(0, STORYBOARD_ASSET_LIMIT);
    if (!assets.length) throw new Error("没有识别到角色、场景或道具资产");
    return { style: !Array.isArray(data) && typeof data.style === "string" ? data.style.trim() : "", assets };
}

function alignStoryboardAssetsWithSourceStyle(parsed: { style: string; assets: StoryboardAsset[] }, source: string): { style: string; assets: StoryboardAsset[] } {
    const style = storyboardExplicitStyleForSource(source);
    if (!style) return parsed;
    const cleanConflictStyle = (value: string) =>
        value
            .replace(/[^，。；\n]*(?:写实电影感|写实风格|写实纪实|真实摄影|真人电影感|纪实摄影|农村纪实风)[^，。；\n]*[，,]?/g, "")
            .replace(/\s+/g, " ")
            .replace(/^，+|，+$/g, "")
            .trim();
    const withStyle = (value: string) => {
        const clean = cleanConflictStyle(value);
        if (!clean) return style;
        return clean.includes(style) ? clean : `${style}，${clean}`;
    };
    return {
        style,
        assets: parsed.assets.map((asset) => ({
            ...asset,
            prompt: withStyle(asset.prompt || asset.description),
        })),
    };
}

function alignStoryboardNodeAssetsWithCurrentStyle(node: CanvasNodeData): CanvasNodeData {
    const assets = node.metadata?.storyboardAssets || [];
    if (!assets.length && !node.metadata?.storyboardAssetStyle) return node;
    const aligned = alignStoryboardAssetsWithSourceStyle({ style: node.metadata?.storyboardAssetStyle || "", assets }, storyboardSourceTextForNode(node));
    if (aligned.style === node.metadata?.storyboardAssetStyle && aligned.assets === assets) return node;
    return {
        ...node,
        metadata: {
            ...node.metadata,
            storyboardAssetStyle: aligned.style,
            storyboardAssets: aligned.assets,
        },
    };
}

function storyboardExplicitStyleForSource(source: string) {
    const styleLine = source.match(/(?:视觉风格|整体风格)\s*[：:]\s*([^\n]+)/)?.[1] || "";
    return styleLine.trim();
}

function collectStoryboardAssetRecords(data: Record<string, unknown> | unknown[]): Array<{ item: unknown; kind?: StoryboardAssetKind }> {
    if (Array.isArray(data)) return data.map((item) => ({ item }));
    if (!data || typeof data !== "object") return [];
    const direct = Array.isArray(data.assets) ? data.assets.map((item) => ({ item })) : [];
    const grouped = [
        ...readAssetGroup(data, "characters", "character"),
        ...readAssetGroup(data, "角色", "character"),
        ...readAssetGroup(data, "scenes", "scene"),
        ...readAssetGroup(data, "场景", "scene"),
        ...readAssetGroup(data, "props", "prop"),
        ...readAssetGroup(data, "道具", "prop"),
    ];
    return [...direct, ...grouped];
}

function readAssetGroup(data: Record<string, unknown>, key: string, kind: StoryboardAssetKind): Array<{ item: unknown; kind: StoryboardAssetKind }> {
    const value = data[key];
    return Array.isArray(value) ? value.map((item) => ({ item, kind })) : [];
}

function normalizeStoryboardAsset(item: unknown, index: number, fallbackKind?: StoryboardAssetKind): StoryboardAsset | null {
    if (!item || typeof item !== "object") return null;
    const record = item as Record<string, unknown>;
    const kind = normalizeStoryboardAssetKind(record.kind) || fallbackKind || null;
    const name = readStringField(record, ["name", "名称", "角色名", "场景名", "道具名", "title"]).trim();
    if (!kind || !name) return null;
    const description = safetyNeutralStoryboardPrompt(readStringField(record, ["description", "描述", "角色描述", "场景描述", "道具描述", "detail"]).trim());
    const prompt = safetyNeutralStoryboardPrompt(readStringField(record, ["prompt", "提示词", "生成提示词", "imagePrompt", "生图提示词"]).trim() || description);
    const baseName = kind === "character" ? readStringField(record, ["baseName", "本名", "角色本名", "人物本名"]).trim() : "";
    const lifeStage = kind === "character" ? readStringField(record, ["lifeStage", "年龄状态", "时期", "阶段", "state", "ageStage"]).trim() : "";
    const base = { id: `asset-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 6)}`, kind, name, baseName: baseName || undefined, lifeStage: lifeStage || inferStoryboardCharacterLifeStage({ name, description, prompt }), description, prompt, status: NODE_STATUS_IDLE };
    return base;
}

function normalizeStoryboardAssetKind(value: unknown): StoryboardAssetKind | null {
    if (value === "scene" || value === "场景") return "scene";
    if (value === "prop" || value === "props" || value === "道具") return "prop";
    if (value === "character" || value === "characters" || value === "role" || value === "角色" || value === "人物") return "character";
    return null;
}

function readStringField(record: Record<string, unknown>, keys: string[]) {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === "string") return value;
    }
    return "";
}

function parseJsonObject(content: string) {
    const trimmed = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    try {
        return JSON.parse(trimmed);
    } catch {
        const start = trimmed.indexOf("{");
        const end = trimmed.lastIndexOf("}");
        if (start < 0 || end <= start) throw new Error("模型返回内容不是合法 JSON");
        return JSON.parse(trimmed.slice(start, end + 1));
    }
}

function renumberStoryboardRowsForCanvas(rows: string[][]) {
    return rows.map((row, index) => STORYBOARD_COLUMNS.map((_, colIndex) => (colIndex === 0 ? String(index + 1).padStart(2, "0") : row[colIndex] || "")));
}

function storyboardRowsToMarkdownForCanvas(rows: string[][]) {
    return [`| ${STORYBOARD_COLUMNS.join(" | ")} |`, `| ${STORYBOARD_COLUMNS.map(() => "---").join(" | ")} |`, ...rows.map((row) => `| ${STORYBOARD_COLUMNS.map((_, index) => (row[index] || "").replace(/\n/g, " ")).join(" | ")} |`)].join("\n");
}

function storyboardAssetPlanningSource(node: CanvasNodeData, episodeTitle: string, beats: StoryboardSourceBeat[], rows: string[][], rowIndexes: number[], strict = false) {
    const safeBeats = beats.map((beat) => ({
        id: beat.id,
        phase: storyboardAssetSafetyText(beat.phase, strict),
        timeStage: storyboardAssetSafetyText(beat.timeStage, strict),
        location: storyboardAssetSafetyText(beat.location, strict),
        characters: beat.characters.map((character) => storyboardAssetSafetyText(character, strict)),
        event: storyboardAssetSafetyText(beat.event, strict),
        emotion: storyboardAssetSafetyText(beat.emotion, strict),
        treatment: beat.treatment,
    }));
    return [
        `当前生产集：${storyboardAssetSafetyText(episodeTitle, strict)}`,
        node.metadata?.storyboardDramaturgyPlan ? `当前集剧作总纲（只用于资产优先级，不得据此虚构资产）：\n${storyboardAssetSafetyText(JSON.stringify(storyboardDramaturgyContext(node, beats.map((beat) => beat.id))), strict)}` : "",
        safeBeats.length ? `当前集故事事实（安全摘要）：\n${JSON.stringify(safeBeats)}` : "",
        `当前集精简片段表（安全摘要）：\n${storyboardAssetRowsToMarkdownForCanvas(rows, strict)}`,
        storyboardAssetPlanningIndex(node, rowIndexes, strict),
    ]
        .filter(Boolean)
        .join("\n\n");
}

function storyboardDramaturgyContext(node: CanvasNodeData, sourceBeatIds?: string[]) {
    const plan = node.metadata?.storyboardDramaturgyPlan;
    if (!plan) return null;
    const activeIds = sourceBeatIds?.length ? new Set(sourceBeatIds) : null;
    const intersects = (ids: string[]) => !activeIds || ids.some((id) => activeIds.has(id));
    return {
        format: plan.format,
        logline: plan.logline,
        protagonist: plan.protagonist,
        want: plan.want,
        need: plan.need,
        coreConflict: plan.coreConflict,
        openingHook: intersects(plan.openingHook.sourceBeatIds) ? plan.openingHook : undefined,
        arcSummary: plan.arcSummary,
        rhythmPlan: plan.rhythmPlan.filter((phase) => intersects(phase.sourceBeatIds)),
        visualMotifs: plan.visualMotifs,
        dialoguePrinciples: plan.dialoguePrinciples,
    };
}

function storyboardAssetSafetyText(text: string, strict = false) {
    const safe = storyboardSafetyComposeText(text)
        .replace(/婴儿|新生儿|宝宝/g, "家庭新成员")
        .replace(/怀孕|孕期|孕妇|分娩|生产/g, "家庭准备迎接新成员")
        .replace(/童年|幼年|年幼|孩童/g, "年少时期")
        .replace(/住院|诊所|医院|病床|病房/g, "室内照护空间")
        .replace(/死亡|去世|夭折|早逝|病逝/g, "亲人离世")
        .replace(/受伤|生病|高烧|手术|急救/g, "身体不适并接受照护");
    return strict
        ? safe
              .replace(/行动不便|左腿不便|行动受限/g, "行动受限")
              .replace(/身体不适|健康困境/g, "长期身体不适")
        : safe;
}

function storyboardAssetRowsToMarkdownForCanvas(rows: string[][], strict = false) {
    const columns = [
        ["镜号", 0],
        ["画面描述", 2],
        ["景别", 3],
        ["对白旁白", 5],
        ["音效", 6],
        ["运镜", 7],
    ] as const;
    return [`| ${columns.map(([title]) => title).join(" | ")} |`, `| ${columns.map(() => "---").join(" | ")} |`, ...rows.map((row) => `| ${columns.map(([, index]) => compactStoryboardAssetCell(index === 0 ? row[index] || "" : storyboardAssetSafetyText(row[index] || "", strict))).join(" | ")} |`)].join("\n");
}

function storyboardAssetPlanningIndex(node: CanvasNodeData, rowIndexes?: number[], strict = false) {
    const plans = node.metadata?.storyboardShotPlans || {};
    const beats = new Map((node.metadata?.storyboardSourceBeats || []).map((beat) => [beat.id, beat]));
    const included = rowIndexes ? new Set(rowIndexes.map(String)) : null;
    const index = Object.entries(plans).filter(([rowIndex]) => !included || included.has(rowIndex)).map(([rowIndex, plan]) => ({
        shot: Number(rowIndex) + 1,
        timeStage: storyboardAssetSafetyText(plan.timeStage, strict),
        continuityGroupId: plan.continuityGroupId,
        characters: Array.from(new Set(plan.sourceBeatIds.flatMap((id) => (beats.get(id)?.characters || []).map((character) => storyboardAssetSafetyText(character, strict))))),
        location: Array.from(new Set(plan.sourceBeatIds.map((id) => storyboardAssetSafetyText(beats.get(id)?.location || "", strict)).filter(Boolean))),
    }));
    return index.length ? `镜头时期索引：\n${JSON.stringify(index)}` : "";
}

function mergeStoryboardEpisodeAssets(existing: StoryboardAsset[], incoming: StoryboardAsset[], episodeId?: string) {
    const byKey = new Map(existing.map((asset) => [`${asset.kind}:${asset.name}`, asset]));
    incoming.forEach((asset) => {
        const current = byKey.get(`${asset.kind}:${asset.name}`);
        const chapterIds = Array.from(new Set([...(current?.chapterIds || []), ...(episodeId ? [episodeId] : [])]));
        byKey.set(`${asset.kind}:${asset.name}`, current ? { ...asset, ...current, chapterIds } : { ...asset, chapterIds });
    });
    return Array.from(byKey.values());
}

function compactStoryboardAssetCell(value: string) {
    const text = value.replace(/\s+/g, " ").trim();
    return text.length > 160 ? `${text.slice(0, 160)}...` : text;
}

function fileToDataUrl(file: File) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(reader.error || new Error("读取截图失败"));
        reader.readAsDataURL(file);
    });
}

function readTextFile(file: File) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(reader.error || new Error("读取文本失败"));
        reader.readAsText(file, "utf-8");
    });
}

function isStoryboardTextFile(file: File) {
    return /^text\//.test(file.type) || file.type === "application/json" || /\.(txt|md|markdown|csv|json)$/i.test(file.name);
}

async function storyboardAnswerFromImageFile(config: AiConfig, file: File) {
    const dataUrl = await fileToDataUrl(file);
    return requestImageQuestion(config, [{ role: "user", content: [{ type: "text", text: STORYBOARD_SCREENSHOT_IMPORT_PROMPT }, { type: "image_url", image_url: { url: dataUrl } }] }], () => {});
}

async function storyboardAnswerFromTextFile(config: AiConfig, file: File) {
    const text = await readTextFile(file);
    const parsed = parseStoryboardLoose(text);
    if (stripStoryboardHeader(parsed).length) return text;
    return requestImageQuestion(config, [{ role: "user", content: `${STORYBOARD_TEXT_IMPORT_PROMPT}\n\n${text}` }], () => {});
}

function buildAngleLabel(params: CanvasImageAngleParams) {
    const horizontal = params.horizontalAngle === 0 ? "正面视角" : params.horizontalAngle > 0 ? `向右旋转 ${params.horizontalAngle} 度` : `向左旋转 ${Math.abs(params.horizontalAngle)} 度`;
    const pitch = params.pitchAngle === 0 ? "水平视角" : params.pitchAngle > 0 ? `俯视 ${params.pitchAngle} 度` : `仰视 ${Math.abs(params.pitchAngle)} 度`;
    return `AI 多角度：${horizontal}，${pitch}，镜头距离 ${params.cameraDistance.toFixed(1)}，${params.wideAngle ? "广角" : "标准"}镜头`;
}

function buildAnglePrompt(params: CanvasImageAngleParams) {
    return `基于参考图重新生成同一主体的新视角，保持主体、颜色、材质和画面风格一致，不要只做透视变形。${buildAngleLabel(params)}。`;
}

"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent as ReactChangeEvent, DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { BookOpen, Bot, Home, ImageIcon, Images, List, Menu, Music2, Plus, Redo2, Settings2, Trash2, Undo2, Upload, Video } from "lucide-react";
import { saveAs } from "file-saver";

import { requestEdit, requestGeneration, requestImageQuestion, type AiTextMessage } from "@/services/api/image";
import { requestAudioGeneration, storeGeneratedAudio } from "@/services/api/audio";
import { requestVideoGeneration, storeGeneratedVideo } from "@/services/api/video";
import { DOCS_URL } from "@/constant/env";
import { defaultConfig, type AiConfig, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { imageToDataUrl, resolveImageUrl, uploadImage, type UploadedImage } from "@/services/image-storage";
import { resolveMediaUrl, uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { nanoid } from "nanoid";
import { getDataUrlByteSize, readImageMeta } from "@/lib/image-utils";
import { canvasThemes, type CanvasBackgroundMode } from "@/lib/canvas-theme";
import { UserStatusActions } from "@/components/layout/user-status-actions";
import { useAssetStore } from "@/stores/use-asset-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { cropDataUrl, splitDataUrl, upscaleDataUrl } from "../utils/canvas-image-data";
import { MULTI_VIEW_NODE_SPECS, prepareMultiViewPrompt, type MultiViewNodeType } from "../utils/canvas-multi-view";
import { buildMangaCharacterPromptNodes } from "../utils/manga-character-card-import";
import { buildScene360PromptNodes } from "../utils/manga-scene-360-import";
import { buildMangaScenePromptNodes } from "../utils/manga-storyboard-scene-import";
import { buildPromptAssistantInstruction } from "../utils/prompt-assistant";
import { fitNodeSize, nodeSizeFromRatio } from "../utils/canvas-node-size";
import { buildImagePresetPatch, type CanvasImagePresetId } from "../utils/canvas-image-presets";
import { App, Button, Dropdown, Modal } from "antd";
import { NODE_DEFAULT_SIZE, getNodeSpec } from "../constants";
import { ActiveConnectionPath, ConnectionPath } from "../components/canvas-connections";
import { CanvasConfigComposer } from "../components/canvas-config-composer";
import { CanvasConfigNodePanel } from "../components/canvas-config-node-panel";
import { CANVAS_AGENT_PANEL_MOTION_MS, CanvasAssistantPanel } from "../components/canvas-assistant-panel";
import { CanvasNodeContextMenu } from "../components/canvas-context-menu";
import { CanvasNodeAngleDialog, type CanvasImageAngleParams } from "../components/canvas-node-angle-dialog";
import { CanvasNodeCropDialog, type CanvasImageCropRect } from "../components/canvas-node-crop-dialog";
import { CanvasNodeMaskEditDialog, type CanvasImageMaskEditPayload } from "../components/canvas-node-mask-edit-dialog";
import { CanvasNodeSplitDialog, type CanvasImageSplitParams } from "../components/canvas-node-split-dialog";
import { CanvasNodeUpscaleDialog, type CanvasImageUpscaleParams } from "../components/canvas-node-upscale-dialog";
import { buildNodeGenerationContext, buildNodeGenerationInputs, buildNodeResponseMessages, hydrateNodeGenerationContext, type NodeGenerationInput } from "../components/canvas-node-generation";
import { CanvasNodeHoverToolbar, CanvasNodeInfoModal } from "../components/canvas-node-hover-toolbar";
import { CanvasPromptAssistantDialog, mergePromptForNode, promptPatchForNode, readNodePrompt } from "../components/canvas-prompt-assistant-dialog";
import { CanvasScriptNodeDialog } from "../components/canvas-script-node-dialog";
import { InfiniteCanvas } from "../components/infinite-canvas";
import { Minimap } from "../components/canvas-mini-map";
import { CanvasNode, type StoryboardImportPreview } from "../components/canvas-node";
import { CanvasNodePromptPanel, type CanvasNodeGenerationMode } from "../components/canvas-node-prompt-panel";
import { CanvasToolbar } from "../components/canvas-toolbar";
import { AssetPickerModal, type InsertAssetPayload } from "../components/asset-picker-modal";
import { CanvasZoomControls } from "../components/canvas-zoom-controls";
import { CanvasLocalAgentPanel } from "../components/canvas-local-agent-panel";
import { useCanvasAgentStore } from "../stores/use-canvas-agent-store";
import { useCanvasStore } from "../stores/use-canvas-store";
import { applyCanvasAgentOps, type CanvasAgentOp, type CanvasAgentSnapshot } from "../utils/canvas-agent-ops";
import { buildCanvasResourceReferences, buildNodeMentionReferences } from "../utils/canvas-resource-references";
import type { CanvasAgentMode } from "../components/canvas-agent-chat-ui";
import {
    CanvasNodeType,
    type CanvasAssistantImage,
    type CanvasAssistantSession,
    type CanvasConnection,
    type CanvasImageGenerationType,
    type CanvasNodeData,
    type CanvasNodeMetadata,
    type StoryboardAsset,
    type StoryboardAssetKind,
    type StoryboardPromptDetail,
    type StoryboardVideoReference,
    type ConnectionHandle,
    type ContextMenuState,
    type Position,
    type SelectionBox,
    type ViewportTransform,
} from "../types";
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

type ConnectionCreateKind = CanvasNodeType.Image | CanvasNodeType.Text | CanvasNodeType.Config | CanvasNodeType.Video | CanvasNodeType.Audio | CanvasNodeType.Script;

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
const STORYBOARD_ASSET_GRID_COLUMNS = 3;
const STORYBOARD_ROW_LIMIT = 120;
const STORYBOARD_VIDEO_GRID_COLUMNS = 5;
const STORYBOARD_WORKSPACE_GAP = 160;
const STORYBOARD_WORKSPACE_TOP_OFFSET = -40;
const STORYBOARD_SCRIPT_PRESET = `你是短视频分镜导演。请把下面连接的剧本拆成可拍摄、可生成视频的分镜脚本。

只输出 Markdown 表格，不要解释，不要标题。

表格列必须严格为：
| 镜号 | 时长 | 画面描述 | 景别 | 光影氛围 | 对白旁白 | 音效 | 运镜 | 最终提示词 |

要求：
1. 按剧情长度和节奏拆分镜头，短剧本默认 9 到 15 个镜头，长剧本可以超过 30 个镜头，不要为了固定数量删减关键剧情。
2. 每个镜头时长用 5s、8s、10s、12s 这类格式。
3. 画面描述要具体到人物动作、环境、表情和关键物件。
4. 景别填写远景/全景/中景/近景/特写/空镜等。
5. 对白旁白优先提炼原文里的第一人称旁白，可适当压缩。
6. 音效写环境声、动作声、音乐情绪。
7. 运镜写固定机位、推镜、跟拍、摇镜、手持轻晃等。
8. 最终提示词用于后续视频/图片生成，要把人物、场景、动作、情绪、镜头、光影写完整。
9. 不要编造与剧本冲突的新剧情。`;
const STORYBOARD_SCREENSHOT_IMPORT_PROMPT = `请识别截图里的分镜脚本表格，并只输出 Markdown 表格。

表格列必须严格为：
| 镜号 | 时长 | 画面描述 | 景别 | 光影氛围 | 对白旁白 | 音效 | 运镜 | 最终提示词 |

要求：只提取截图中能看清的行；看不清的单元格留空；不要解释，不要标题。`;
const STORYBOARD_TEXT_IMPORT_PROMPT = `请把下面的文本整理成分镜脚本 Markdown 表格。

表格列必须严格为：
| 镜号 | 时长 | 画面描述 | 景别 | 光影氛围 | 对白旁白 | 音效 | 运镜 | 最终提示词 |

要求：如果文本里已有分镜表格就按原内容整理；如果是普通剧本文本，就拆成可拍摄分镜；只输出 Markdown 表格，不要解释，不要标题。`;
const STORYBOARD_COLUMNS = ["镜号", "时长", "画面描述", "景别", "光影氛围", "对白旁白", "音效", "运镜", "最终提示词"];
const ASSET_KIND_TEXT: Record<StoryboardAssetKind, string> = { character: "人物", scene: "场景", prop: "道具" };
const STORYBOARD_FINAL_PROMPT_PROMPT = `你是短剧分镜与视频运动提示词专家。请把单个镜头、第二步资产和全局风格整合成第三步“合成提示词”。

只输出 JSON，不要 Markdown，不要解释。

JSON 格式必须为：
{
  "storyboardPrompt": "分镜提示词，用于首帧图/分镜图生成",
  "videoMotionPrompt": "视频运动提示词，用于视频模型理解动作和镜头运动",
  "assetMentions": ["@人物名", "@场景名", "@道具名"]
}

要求：
1. storyboardPrompt 必须综合画面描述、景别、光影、对白旁白、音效、运镜、全局风格和相关资产。
2. videoMotionPrompt 必须按自然语言清楚写出：起始状态、动作过程、结束状态、镜头运动、情绪/节奏、音效/对白。
3. 根据镜头内容从资产列表里选择真正相关的人物、场景、道具，并在两个提示词里显式使用 @资产名。
4. @资产名必须严格使用“第二步资产清单”里出现的原始名称，不要改写、不要补充括号、不要使用别名。
5. 不要把原文机械粘贴到视频运动提示词里，要整理成视频模型能执行的运动说明。
6. 不要编造与剧本、分镜、资产冲突的新人物、新地点或新道具。`;
const STORYBOARD_ASSET_PROMPT = `你是短剧资产规划师。请根据原始剧本和分镜表，提炼第二步“准备资产”需要的统一资产。

只输出 JSON，不要 Markdown，不要解释。

JSON 格式必须为：
{
  "style": "全局视觉风格，一句话到两句话",
  "assets": [
    { "kind": "character", "name": "角色名", "description": "角色形象描述", "prompt": "可直接用于生成角色设定图的中文提示词" },
    { "kind": "scene", "name": "场景名", "description": "场景描述", "prompt": "可直接用于生成场景设定图的中文提示词" },
    { "kind": "prop", "name": "道具名", "description": "道具描述", "prompt": "可直接用于生成道具设定图的中文提示词" }
  ]
}

要求：
1. 只保留后续分镜最需要统一的角色、场景、道具，不要泛滥。
2. 角色优先提炼姓名、年龄、体型、穿着、气质、情绪基调。
3. 场景优先提炼时代、空间、光线、陈设、地域质感。
4. 道具优先提炼剧情里反复出现或情绪关键的物件。
5. prompt 要能直接用于生图，包含画风、主体、构图、光影、材质和一致性要求。
6. scene 类型必须是纯场景空镜，只写环境、空间、陈设、光线、时代和地域质感，prompt 必须明确“不出现人物、不出现角色、不出现人脸、不出现手部、无人入镜”。
7. prop 类型必须是纯道具静物图，只写物件本身、材质、磨损、摆放环境和光影，prompt 必须明确“不出现人物、不出现角色、不出现人脸、不出现手部、无人持握”。遗照、照片、证件、奖状等必须作为道具静物呈现，可以出现照片/证件里的图像内容，但现场画面不能出现真实人物。
8. 不要编造与剧本冲突的人物关系和物件。`;
const IMAGE_PROMPT_REVERSE_PRESET = `请根据参考图片反推一段适合用于 AI 生图的提示词。

要求：
1. 只输出提示词正文，不要解释。
2. 覆盖主体、构图、风格、光线、色彩、材质、镜头和氛围。
3. 尽量写成可直接用于生图模型的完整提示词。`;

function createCanvasNode(type: CanvasNodeType, position: Position, metadata?: CanvasNodeMetadata): CanvasNodeData {
    const spec = getNodeSpec(type);
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
            <div className="grid gap-1">
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

function InfiniteCanvasPage() {
    const { message, modal } = App.useApp();
    const params = useParams<{ id: string }>();
    const router = useRouter();
    const searchParams = useSearchParams();
    const projectId = params.id;
    const localAgentConnected = useCanvasAgentStore((state) => state.connected);
    const localAgentActivity = useCanvasAgentStore((state) => state.activity);
    const localAgentEnabled = useCanvasAgentStore((state) => state.enabled);
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
    const [runningNodeId, setRunningNodeId] = useState<string | null>(null);
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
    const [assistantCollapsed, setAssistantCollapsed] = useState(true);
    const [assistantMounted, setAssistantMounted] = useState(false);
    const [assistantClosing, setAssistantClosing] = useState(false);
    const [agentMode, setAgentMode] = useState<CanvasAgentMode>("online");
    const [agentUndoSnapshot, setAgentUndoSnapshot] = useState<CanvasAgentSnapshot | null>(null);
    const codexAutoConnect = ["new", "recent", "choose"].includes(searchParams.get("mode") || "");
    const codexCompactAgent = codexAutoConnect && searchParams.has("agentUrl");
    const [titleEditing, setTitleEditing] = useState(false);
    const [titleDraft, setTitleDraft] = useState("");
    const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });
    const [collapsingBatchIds, setCollapsingBatchIds] = useState<Set<string>>(new Set());
    const [openingBatchIds, setOpeningBatchIds] = useState<Set<string>>(new Set());
    const [isNodeDragging, setIsNodeDragging] = useState(false);

    const nodesRef = useRef(nodes);
    const connectionsRef = useRef(connections);
    const selectedNodeIdsRef = useRef(selectedNodeIds);
    const viewportRef = useRef(viewport);
    const generateNodeRef = useRef<((nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => Promise<void>) | null>(null);
    const connectingParamsRef = useRef(connectingParams);
    const connectionTargetNodeIdRef = useRef(connectionTargetNodeId);
    const selectionBoxRef = useRef(selectionBox);
    const agentCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingConnectionCreateRef = useRef(pendingConnectionCreate);
    const generationRequestsRef = useRef(new Map<string, CanvasGenerationRequest>());

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

    const stopGenerationByRunningId = useCallback((runningId: string) => {
        const affectedNodeIds = new Set<string>();
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
            router.replace("/canvas");
            return;
        }

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
    }, [hydrated, openProject, projectId, router]);

    useEffect(() => {
        if (!projectLoaded || !["new", "recent", "choose"].includes(searchParams.get("mode") || "")) return;
        if (searchParams.has("agentUrl")) {
            setAgentMode("local");
            return;
        }
        openAgent("local");
    }, [projectLoaded, searchParams]);

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

    useEffect(
        () => () => {
            if (agentCloseTimerRef.current) clearTimeout(agentCloseTimerRef.current);
        },
        [],
    );

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
            if (type !== CanvasNodeType.Text && type !== CanvasNodeType.Audio) setDialogNodeId(newNode.id);
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
                .filter((node) => !isHiddenBatchChild(node, nodesRef.current))
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
            .filter((node) => !isHiddenBatchChild(node, nodes, collapsingBatchIds) && node.position.x + node.width > viewLeft && node.position.x < viewRight && node.position.y + node.height > viewTop && node.position.y < viewBottom)
            .sort((a, b) => (a.type === CanvasNodeType.Workspace ? -1 : 0) - (b.type === CanvasNodeType.Workspace ? -1 : 0));
    }, [collapsingBatchIds, nodes, size.height, size.width, viewport.k, viewport.x, viewport.y]);

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
    const hasMultipleSelectedNodes = selectedNodeIds.size > 1;
    const activeNodeId = hasMultipleSelectedNodes ? null : toolbarNodeId || hoveredNodeId || (selectedNodeIds.size === 1 ? Array.from(selectedNodeIds)[0] : null);
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
    const canvasResourceReferences = useMemo(() => buildCanvasResourceReferences(nodes, connections, resourceContextNodeId), [connections, nodes, resourceContextNodeId]);
    const resourceReferenceByNodeId = useMemo(() => new Map(canvasResourceReferences.map((reference) => [reference.nodeId, reference])), [canvasResourceReferences]);
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
    const createNode = useCallback(
        (type: CanvasNodeType, position?: Position) => {
            const targetPosition = position || getCanvasCenter();
            const configMetadata =
                type === CanvasNodeType.Config
                    ? {
                          model: effectiveConfig.imageModel || effectiveConfig.model,
                          size: effectiveConfig.size,
                          count: getGenerationCount(effectiveConfig.canvasImageCount || effectiveConfig.count),
                      }
                    : type === CanvasNodeType.Script
                      ? { content: "", prompt: STORYBOARD_SCRIPT_PRESET, status: NODE_STATUS_IDLE, fontSize: 12, storyboardRows: [], model: effectiveConfig.textModel || effectiveConfig.model }
                      : undefined;
            const newNode = createCanvasNode(type, targetPosition, configMetadata);

            setNodes((prev) => [...prev, newNode]);
            setSelectedNodeIds(new Set([newNode.id]));
            setSelectedConnectionId(null);
            if (type !== CanvasNodeType.Text && type !== CanvasNodeType.Audio) setDialogNodeId(newNode.id);
        },
        [effectiveConfig.canvasImageCount, effectiveConfig.count, effectiveConfig.imageModel, effectiveConfig.model, effectiveConfig.size, getCanvasCenter],
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
            });
            setNodes((prev) => {
                const next = prev.filter((node) => !allIds.has(node.id));
                return next.map((node) => {
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
        setDialogNodeId(id);
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

    const pasteCopiedNodes = useCallback(() => {
        const clipboard = clipboardRef.current;
        if (!clipboard?.nodes.length) return false;

        const center = getCanvasCenter();
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

        setNodes((prev) => [...prev, ...nextNodes]);
        setConnections((prev) => [...prev, ...nextConnections]);
        setSelectedNodeIds(new Set(nextNodes.map((node) => node.id)));
        setSelectedConnectionId(null);
        setContextMenu(null);
        setDialogNodeId(nextNodes[0]?.id || null);
        return true;
    }, [getCanvasCenter]);

    const resetViewport = useCallback(() => {
        setViewport({ x: size.width / 2, y: size.height / 2, k: 1 });
        setContextMenu(null);
    }, [size.height, size.width]);

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
        router.push(`/canvas/${id}`);
    }, [createProject, router]);

    const deleteCurrentProject = useCallback(() => {
        deleteProjects([projectId]);
        cleanupAssetImages();
        router.push("/canvas");
    }, [cleanupAssetImages, deleteProjects, projectId, router]);

    const handleCanvasMouseDown = useCallback(
        (event: ReactPointerEvent<HTMLDivElement>) => {
            setContextMenu(null);
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
        if (dragRef.current.hasMoved && clientX != null && clientY != null) {
            setNodes((prev) =>
                prev.map((node) => {
                    const initial = initialPositions.find((item) => item.id === node.id);
                    if (!initial) return node;
                    return { ...node, position: { x: initial.x + dx, y: initial.y + dy } };
                }),
            );
        }

        dragRef.current.isDraggingNode = false;
        dragRef.current.hasMoved = false;
        dragRef.current.initialSelectedNodes = [];
        if (wasClick && clickedNodeId) {
            const clickedNode = nodesRef.current.find((node) => node.id === clickedNodeId);
            if (clickedNode?.type === CanvasNodeType.Text) {
                setDialogNodeId((current) => (current === clickedNodeId ? current : null));
            } else if (clickedNode?.type === CanvasNodeType.Workspace) {
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
                .filter((node) => !isHiddenBatchChild(node, nodesRef.current))
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
        (text: string) => {
            const trimmed = text.trim();
            if (!trimmed) return false;

            const node = {
                ...createCanvasNode(CanvasNodeType.Text, getCanvasCenter(), { content: trimmed, status: NODE_STATUS_SUCCESS }),
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

    const pasteSystemClipboard = useCallback(async () => {
        if (!navigator.clipboard) return;

        try {
            const items = await navigator.clipboard.read();
            const imageItem = items.find((item) => item.types.some((type) => type.startsWith("image/")));
            if (imageItem) {
                const imageType = imageItem.types.find((type) => type.startsWith("image/"));
                if (!imageType) return;
                const blob = await imageItem.getType(imageType);
                const file = new File([blob], "clipboard-image.png", { type: imageType });
                void createImageFileNode(file, getCanvasCenter());
                message.success("已从剪切板添加图片");
                return;
            }
        } catch (error) {
            if (!isClipboardPermissionError(error)) throw error;
        }

        try {
            const text = await navigator.clipboard.readText();
            if (createTextNodeFromClipboard(text)) message.success("已从剪切板添加文本");
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

    const handleNodeMetadataChange = useCallback((nodeId: string, patch: Partial<CanvasNodeMetadata>) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, ...patch } } : node)));
    }, []);

    const updateStoryboardRows = useCallback((nodeId: string, rows: StoryboardRowsUpdater) => {
        setNodes((prev) =>
            prev.map((node) => {
                if (node.id !== nodeId) return node;
                const currentRows = parseStoryboardRows(node.metadata?.storyboardRows);
                const normalized = renumberStoryboardRowsForCanvas(typeof rows === "function" ? rows(currentRows) : rows);
                return {
                    ...node,
                    metadata: {
                        ...node.metadata,
                        content: storyboardRowsToMarkdownForCanvas(normalized),
                        storyboardRows: [STORYBOARD_COLUMNS, ...normalized],
                        storyboardStep: "shots",
                    },
                };
            }),
        );
    }, []);

    const updateStoryboardAsset = useCallback((nodeId: string, assetId: string, patch: Partial<StoryboardAsset>) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, storyboardAssets: (node.metadata?.storyboardAssets || []).map((asset) => (asset.id === assetId ? { ...asset, ...patch } : asset)) } } : node)));
    }, []);

    const updateStoryboardPromptDetail = useCallback((nodeId: string, rowIndex: number, detail: StoryboardPromptDetail) => {
        setNodes((prev) =>
            prev.map((node) => {
                if (node.id !== nodeId) return node;
                const linkedDetail = linkStoryboardPromptAssets(node, detail, prev);
                const rows = parseStoryboardRows(node.metadata?.storyboardRows).map((row) => [...row]);
                if (rows[rowIndex]) rows[rowIndex][8] = linkedDetail.storyboardPrompt || linkedDetail.videoMotionPrompt;
                const normalized = renumberStoryboardRowsForCanvas(rows);
                return {
                    ...node,
                    metadata: {
                        ...node.metadata,
                        content: storyboardRowsToMarkdownForCanvas(normalized),
                        storyboardRows: [STORYBOARD_COLUMNS, ...normalized],
                        storyboardStep: "prompts",
                        storyboardPromptDetails: {
                            ...(node.metadata?.storyboardPromptDetails || {}),
                            [String(rowIndex)]: linkedDetail,
                        },
                    },
                };
            }),
        );
    }, []);

    const updateStoryboardModel = useCallback((nodeId: string, model: string) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, model } } : node)));
    }, []);

    const generateStoryboardShotsFromInputs = useCallback(
        async (node: CanvasNodeData) => {
            const scriptNode = nodesRef.current.find((item) => item.id === node.id) || node;
            const textInputs = buildNodeGenerationInputs(scriptNode.id, nodesRef.current, connectionsRef.current).filter((input) => input.type === "text" && input.text?.trim());
            const sourceText = textInputs.map((input) => `【${input.title || "剧本文本"}】\n${input.text?.trim() || ""}`).join("\n\n").trim() || storyboardSourceTextForNode(scriptNode);
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
            setStoryboardActionKey("shots:generate");
            setNodes((prev) => prev.map((item) => (item.id === scriptNode.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_LOADING, errorDetails: undefined, storyboardStep: "shots", storyboardSourceText: sourceText } } : item)));
            try {
                const answer = await requestImageQuestion(generationConfig, [{ role: "user", content: `${STORYBOARD_TEXT_IMPORT_PROMPT}\n\n${sourceText}` }], () => {});
                const rows = stripStoryboardHeader(parseStoryboardLoose(answer));
                if (!rows.length) throw new Error("没有生成可用的分镜表");
                const normalized = renumberStoryboardRowsForCanvas(rows);
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
                                      status: NODE_STATUS_SUCCESS,
                                      errorDetails: undefined,
                                  },
                              }
                            : item,
                    ),
                );
                message.success(`已生成 ${normalized.length} 个镜头`);
            } catch (error) {
                const errorDetails = error instanceof Error ? error.message : "生成镜头失败";
                message.error(errorDetails);
                setNodes((prev) => prev.map((item) => (item.id === scriptNode.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails } } : item)));
            } finally {
                setStoryboardActionKey(null);
                setRunningNodeId((current) => (current === scriptNode.id ? null : current));
            }
        },
        [effectiveConfig, isAiConfigReady, message, openConfigDialog],
    );

    const prepareStoryboardAssets = useCallback(
        async (node: CanvasNodeData) => {
            const rows = parseStoryboardRows(node.metadata?.storyboardRows);
            if (!rows.length) {
                message.warning("请先生成或填写分镜表");
                return;
            }
            const generationConfig = { ...buildGenerationConfig(effectiveConfig, node, "text"), model: node.metadata?.model || effectiveConfig.textModel || effectiveConfig.model };
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                return;
            }
            setStoryboardActionKey("asset:prepare");
            setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, storyboardStep: "assets", storyboardAssetError: undefined } } : item)));
            try {
                const source = [
                    storyboardSourceTextForNode(node) ? `原始剧本或补充要求：\n${storyboardSourceTextForNode(node)}` : "",
                    `分镜表：\n${storyboardRowsToMarkdownForCanvas(rows)}`,
                ]
                    .filter(Boolean)
                    .join("\n\n");
                const answer = await requestImageQuestion(generationConfig, [{ role: "user", content: `${STORYBOARD_ASSET_PROMPT}\n\n${source}` }], () => {});
                const parsed = parseStoryboardAssetAnswer(answer);
                setNodes((prev) =>
                    prev.map((item) =>
                        item.id === node.id
                            ? {
                                  ...item,
                                  metadata: {
                                      ...item.metadata,
                                      storyboardStep: "assets",
                                      storyboardAssetStyle: parsed.style,
                                      storyboardAssetError: undefined,
                                      storyboardAssets: parsed.assets,
                                  },
                              }
                            : item,
                    ),
                );
                message.success("资产已识别");
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : "识别资产失败";
                setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, storyboardStep: "assets", storyboardAssetError: errorMessage } } : item)));
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
            const asset = node.metadata?.storyboardAssets?.find((item) => item.id === assetId);
            const prompt = storyboardAssetImagePrompt(asset);
            if (!asset || !prompt) {
                message.warning("请先填写资产提示词");
                return;
            }
            const generationConfig = { ...buildGenerationConfig(effectiveConfig, node, "image"), model: effectiveConfig.imageModel || effectiveConfig.model, count: "1" };
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                return;
            }
            setStoryboardActionKey(`asset:${assetId}`);
            updateStoryboardAsset(node.id, assetId, { status: NODE_STATUS_LOADING, errorDetails: undefined });
            try {
                const image = await requestGeneration(generationConfig, prompt).then((items) => items[0]);
                const uploaded = await uploadImage(image.dataUrl);
                updateStoryboardAsset(node.id, assetId, { imageUrl: uploaded.url, storageKey: uploaded.storageKey, status: NODE_STATUS_SUCCESS, errorDetails: undefined });
                message.success("资产图已生成");
            } catch (error) {
                updateStoryboardAsset(node.id, assetId, { status: NODE_STATUS_ERROR, errorDetails: error instanceof Error ? error.message : "生成资产图失败" });
                message.error(error instanceof Error ? error.message : "生成资产图失败");
            } finally {
                setStoryboardActionKey(null);
            }
        },
        [effectiveConfig, isAiConfigReady, message, openConfigDialog, updateStoryboardAsset],
    );

    const batchGenerateStoryboardAssets = useCallback(
        async (node: CanvasNodeData) => {
            const assets = (node.metadata?.storyboardAssets || []).filter((asset) => !asset.imageUrl && !asset.storageKey);
            if (!assets.length) {
                message.info("没有需要生成的资产图");
                return;
            }
            const generationConfig = { ...buildGenerationConfig(effectiveConfig, node, "image"), model: effectiveConfig.imageModel || effectiveConfig.model, count: "1" };
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                return;
            }
            setStoryboardActionKey("asset:all");
            try {
                await runLimited(assets, STORYBOARD_ASSET_BATCH_CONCURRENCY, async (asset) => {
                    const prompt = storyboardAssetImagePrompt(asset);
                    if (!prompt) return;
                    updateStoryboardAsset(node.id, asset.id, { status: NODE_STATUS_LOADING, errorDetails: undefined });
                    try {
                        const image = await requestGeneration(generationConfig, prompt).then((items) => items[0]);
                        const uploaded = await uploadImage(image.dataUrl);
                        updateStoryboardAsset(node.id, asset.id, { imageUrl: uploaded.url, storageKey: uploaded.storageKey, status: NODE_STATUS_SUCCESS, errorDetails: undefined });
                    } catch (error) {
                        updateStoryboardAsset(node.id, asset.id, { status: NODE_STATUS_ERROR, errorDetails: error instanceof Error ? error.message : "生成资产图失败" });
                    }
                });
                message.success("资产图批量生成完成");
            } finally {
                setStoryboardActionKey(null);
            }
        },
        [effectiveConfig, isAiConfigReady, message, openConfigDialog, updateStoryboardAsset],
    );

    const exportStoryboardAssetsToCanvas = useCallback(
        async (node: CanvasNodeData) => {
            const assets = node.metadata?.storyboardAssets || [];
            if (!assets.length) {
                message.warning("请先打开脚本节点完成第二步资产准备");
                setScriptNodeId(node.id);
                return;
            }
            const generationConfig = { ...buildGenerationConfig(effectiveConfig, node, "image"), model: effectiveConfig.imageModel || effectiveConfig.model, count: "1" };
            if (assets.some((asset) => !asset.imageUrl && !asset.storageKey) && !isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                return;
            }
            const imageConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
            const nextAssets = assets.map((asset) => ({ ...asset }));
            const assetNodeIds = { ...(node.metadata?.storyboardAssetNodeIds || {}) };
            const mentionNodeIds = { ...(node.metadata?.storyboardAssetMentionNodeIds || {}) };
            const exportedNodes: CanvasNodeData[] = [];
            const existingWorkspace = nodesRef.current.find((item) => item.metadata?.workspaceKind === "storyboard-assets" && item.metadata.workspaceSourceNodeId === node.id);
            const workspaceId = existingWorkspace?.id || nanoid();
            const workspacePosition = existingWorkspace?.position || defaultStoryboardAssetWorkspacePosition(node);
            setStoryboardActionKey("asset:export");
            try {
                for (let index = 0; index < nextAssets.length; index += 1) {
                    const asset = nextAssets[index];
                    const prompt = storyboardAssetImagePrompt(asset);
                    let uploaded: UploadedImage | null = null;
                    let content = asset.imageUrl || "";
                    if (!content && asset.storageKey) content = await resolveImageUrl(asset.storageKey, "");
                    if (!content && prompt) {
                        updateStoryboardAsset(node.id, asset.id, { status: NODE_STATUS_LOADING, errorDetails: undefined });
                        const image = await requestGeneration(generationConfig, prompt).then((items) => items[0]);
                        uploaded = await uploadImage(image.dataUrl);
                        content = uploaded.url;
                        nextAssets[index] = { ...asset, imageUrl: uploaded.url, storageKey: uploaded.storageKey, status: NODE_STATUS_SUCCESS, errorDetails: undefined };
                        updateStoryboardAsset(node.id, asset.id, { imageUrl: uploaded.url, storageKey: uploaded.storageKey, status: NODE_STATUS_SUCCESS, errorDetails: undefined });
                    }
                    if (!content) continue;
                    const existingNode = nodesRef.current.find((item) => item.id === assetNodeIds[asset.id]) || nodesRef.current.find((item) => item.metadata?.storyboardSourceNodeId === node.id && item.metadata?.storyboardAssetId === asset.id);
                    const existingId = existingNode?.id || nanoid();
                    assetNodeIds[asset.id] = existingId;
                    mentionNodeIds[`@${asset.name}`] = existingId;
                    const size = uploaded ? fitNodeSize(uploaded.width, uploaded.height, imageConfig.width, imageConfig.height) : imageConfig;
                    const position = existingNode?.position || { x: workspacePosition.x + 36 + (index % STORYBOARD_ASSET_GRID_COLUMNS) * (imageConfig.width + 34), y: workspacePosition.y + 86 + Math.floor(index / STORYBOARD_ASSET_GRID_COLUMNS) * (imageConfig.height + 74) };
                    exportedNodes.push({
                        id: existingId,
                        type: CanvasNodeType.Image,
                        title: `${ASSET_KIND_TEXT[asset.kind]}｜${asset.name}`,
                        position,
                        width: size.width,
                        height: size.height,
                        metadata: {
                            ...(uploaded ? imageMetadata(uploaded) : { content, storageKey: asset.storageKey, status: NODE_STATUS_SUCCESS }),
                            prompt: prompt || asset.prompt || asset.description,
                            generationType: "generation",
                            model: generationConfig.model,
                            size: generationConfig.size,
                            quality: generationConfig.quality,
                            count: 1,
                            storyboardSourceNodeId: node.id,
                            storyboardAssetId: asset.id,
                            storyboardAssetKind: asset.kind,
                            storyboardAssetName: asset.name,
                        },
                    });
                }
                if (!exportedNodes.length) {
                    message.warning("没有可导出的资产图");
                    return;
                }
                const workspaceNode = buildStoryboardWorkspaceNode(existingWorkspace, workspaceId, node, exportedNodes, workspacePosition, "storyboard-assets");
                setNodes((prev) => {
                    const lookupNodes = [...prev, ...exportedNodes];
                    const exportedById = new Map([workspaceNode, ...exportedNodes].map((item) => [item.id, item]));
                    const updated = prev.map((item) => {
                        if (item.id === node.id) {
                            const updatedScriptNode = { ...item, metadata: { ...item.metadata, storyboardAssets: nextAssets, storyboardAssetNodeIds: assetNodeIds, storyboardAssetMentionNodeIds: mentionNodeIds } };
                            const promptDetails = relinkStoryboardPromptDetails(updatedScriptNode, lookupNodes);
                            return { ...updatedScriptNode, metadata: { ...updatedScriptNode.metadata, storyboardPromptDetails: promptDetails } };
                        }
                        return exportedById.get(item.id) || item;
                    });
                    const existingIds = new Set(prev.map((item) => item.id));
                    return [...updated, ...[workspaceNode, ...exportedNodes].filter((item) => !existingIds.has(item.id))];
                });
                setConnections((prev) => {
                    const next = [{ id: nanoid(), fromNodeId: node.id, toNodeId: workspaceNode.id }, ...exportedNodes.map((assetNode) => ({ id: nanoid(), fromNodeId: node.id, toNodeId: assetNode.id }))];
                    return addUniqueConnections(prev, next);
                });
                message.success(`已搭建资产工作区，包含 ${exportedNodes.length} 个资产节点`);
            } catch (error) {
                message.error(error instanceof Error ? error.message : "导出资产失败");
            } finally {
                setStoryboardActionKey(null);
            }
        },
        [effectiveConfig, isAiConfigReady, message, openConfigDialog, updateStoryboardAsset],
    );

    const composeStoryboardFinalPrompt = useCallback(
        async (node: CanvasNodeData, rowIndex?: number) => {
            const rows = parseStoryboardRows(node.metadata?.storyboardRows);
            const indexes = rowIndex === undefined ? rows.map((_, index) => index) : [rowIndex];
            if (!indexes.length) return message.info("没有需要合成的最终提示词");
            const generationConfig = { ...buildGenerationConfig(effectiveConfig, node, "text"), model: node.metadata?.model || effectiveConfig.textModel || effectiveConfig.model };
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                return;
            }
            setStoryboardActionKey(rowIndex === undefined ? "prompt:all" : `prompt:${rowIndex}`);
            try {
                for (const index of indexes) {
                    const source = buildStoryboardPromptComposeSource(node, rows, index);
                    const answer = await requestImageQuestion(generationConfig, [{ role: "user", content: `${STORYBOARD_FINAL_PROMPT_PROMPT}\n\n${source}` }], () => {});
                    updateStoryboardPromptDetail(node.id, index, parseStoryboardPromptDetailAnswer(answer));
                }
                message.success(rowIndex === undefined ? "最终提示词已批量合成" : "最终提示词已合成");
            } catch (error) {
                message.error(error instanceof Error ? error.message : "合成最终提示词失败");
            } finally {
                setStoryboardActionKey(null);
            }
        },
        [effectiveConfig, isAiConfigReady, message, openConfigDialog, updateStoryboardPromptDetail],
    );

    const generateStoryboardImage = useCallback(
        async (node: CanvasNodeData, rowIndex: number) => {
            const row = parseStoryboardRows(node.metadata?.storyboardRows)[rowIndex];
            const prompt = node.metadata?.storyboardPromptDetails?.[String(rowIndex)]?.storyboardPrompt?.trim() || row?.[8]?.trim() || row?.[2]?.trim();
            if (!row || !prompt) {
                message.warning("请先填写或合成最终提示词");
                return;
            }
            const generationConfig = { ...buildGenerationConfig(effectiveConfig, node, "image"), model: effectiveConfig.imageModel || effectiveConfig.model, count: "1" };
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                return;
            }
            const imageConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
            const childId = nanoid();
            const x = node.position.x + node.width + 96 + (rowIndex % 3) * (imageConfig.width + 32);
            const y = node.position.y + Math.floor(rowIndex / 3) * (imageConfig.height + 42);
            const metadata = buildImageGenerationMetadata("generation", generationConfig, 1, []);
            setStoryboardActionKey(`image:${rowIndex}`);
            setNodes((prev) => [...prev, { id: childId, type: CanvasNodeType.Image, title: `分镜图 ${row[0] || rowIndex + 1}`, position: { x, y }, width: imageConfig.width, height: imageConfig.height, metadata: { prompt, status: NODE_STATUS_LOADING, ...metadata } }]);
            setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
            const controller = startGenerationRequest(childId, node.id, childId);
            try {
                const image = await requestGeneration(generationConfig, prompt, { signal: controller.signal }).then((items) => items[0]);
                const uploaded = await uploadImage(image.dataUrl);
                const size = fitNodeSize(uploaded.width, uploaded.height, imageConfig.width, imageConfig.height);
                setNodes((prev) => prev.map((item) => (item.id === childId ? { ...item, width: size.width, height: size.height, metadata: { ...item.metadata, ...imageMetadata(uploaded), prompt, ...metadata } } : item)));
            } catch (error) {
                if (!isGenerationCanceled(error)) setNodes((prev) => prev.map((item) => (item.id === childId ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails: error instanceof Error ? error.message : "生成分镜图失败" } } : item)));
            } finally {
                finishGenerationRequest(childId, controller);
                setStoryboardActionKey(null);
            }
        },
        [effectiveConfig, finishGenerationRequest, isAiConfigReady, message, openConfigDialog, startGenerationRequest],
    );

    const generateStoryboardVideo = useCallback(
        async (node: CanvasNodeData, rowIndex: number) => {
            const scriptNode = nodesRef.current.find((item) => item.id === node.id) || node;
            const row = parseStoryboardRows(scriptNode.metadata?.storyboardRows)[rowIndex];
            const detail = scriptNode.metadata?.storyboardPromptDetails?.[String(rowIndex)];
            const prompt = detail?.videoMotionPrompt?.trim() || row?.[8]?.trim() || row?.[2]?.trim();
            if (!row || !prompt) {
                message.warning("请先填写或合成最终提示词");
                return;
            }
            const requestedMentions = storyboardAssetMentionsForPrompt(detail);
            const assetReferences = storyboardVideoAssetReferences(scriptNode, rowIndex, nodesRef.current);
            if (requestedMentions.length && !assetReferences.length) {
                message.warning("请先在脚本节点上批量生成资产，再生成引用资产的视频");
                return;
            }
            const generationConfig = { ...buildGenerationConfig(effectiveConfig, scriptNode, "video"), model: effectiveConfig.videoModel || effectiveConfig.model, count: "1" };
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                return;
            }
            const spec = nodeSizeFromRatio(generationConfig.size, NODE_DEFAULT_SIZE[CanvasNodeType.Video].width, NODE_DEFAULT_SIZE[CanvasNodeType.Video].height) || NODE_DEFAULT_SIZE[CanvasNodeType.Video];
            const childId = nanoid();
            const x = scriptNode.position.x + scriptNode.width + 96 + (rowIndex % 3) * (spec.width + 32);
            const y = scriptNode.position.y + Math.floor(rowIndex / 3) * (spec.height + 42);
            setStoryboardActionKey(`video:${rowIndex}`);
            const referenceUrls = assetReferences.map((item) => referenceUrl(item.reference)).filter((url): url is string => Boolean(url));
            const assetMentionLinks = detail ? linkStoryboardPromptAssets(scriptNode, detail, nodesRef.current).assetMentionLinks || [] : [];
            const assetReferenceNodeIds = assetReferences.map((item) => item.node.id);
            const storyboardVideoReferences = storyboardVideoReferencesFromAssetReferences(assetReferences);
            setNodes((prev) => [...prev, { id: childId, type: CanvasNodeType.Video, title: `分镜视频 ${row[0] || rowIndex + 1}`, position: { x, y }, width: spec.width, height: spec.height, metadata: { prompt, status: NODE_STATUS_LOADING, model: generationConfig.model, size: generationConfig.size, seconds: generationConfig.videoSeconds, vquality: generationConfig.vquality, generateAudio: generationConfig.videoGenerateAudio, watermark: generationConfig.videoWatermark, references: referenceUrls, storyboardSourceNodeId: scriptNode.id, storyboardRowIndex: rowIndex, storyboardAssetMentions: assetReferences.map((item) => item.mention), storyboardAssetMentionLinks: assetMentionLinks, storyboardAssetReferenceNodeIds: assetReferenceNodeIds, storyboardVideoReferences } }]);
            setConnections((prev) => addUniqueConnections(prev, [{ id: nanoid(), fromNodeId: scriptNode.id, toNodeId: childId }, ...assetReferences.map((item) => ({ id: nanoid(), fromNodeId: item.node.id, toNodeId: childId }))]));
            const controller = startGenerationRequest(childId, scriptNode.id, childId);
            try {
                const video = await storeGeneratedVideo(await requestVideoGeneration(generationConfig, prompt, assetReferences.map((item) => item.reference), [], [], { signal: controller.signal }));
                const size = fitNodeSize(video.width || spec.width, video.height || spec.height, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                setNodes((prev) => prev.map((item) => (item.id === childId ? { ...item, width: size.width, height: size.height, metadata: { ...item.metadata, ...videoMetadata(video), prompt, model: generationConfig.model, size: generationConfig.size, seconds: generationConfig.videoSeconds, vquality: generationConfig.vquality, generateAudio: generationConfig.videoGenerateAudio, watermark: generationConfig.videoWatermark, references: referenceUrls, storyboardSourceNodeId: scriptNode.id, storyboardRowIndex: rowIndex, storyboardAssetMentions: assetReferences.map((item) => item.mention), storyboardAssetMentionLinks: assetMentionLinks, storyboardAssetReferenceNodeIds: assetReferenceNodeIds, storyboardVideoReferences } } : item)));
            } catch (error) {
                if (!isGenerationCanceled(error)) setNodes((prev) => prev.map((item) => (item.id === childId ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails: error instanceof Error ? error.message : "生成视频失败" } } : item)));
            } finally {
                finishGenerationRequest(childId, controller);
                setStoryboardActionKey(null);
            }
        },
        [effectiveConfig, finishGenerationRequest, isAiConfigReady, message, openConfigDialog, startGenerationRequest],
    );

    const batchGenerateStoryboardImages = useCallback(
        async (node: CanvasNodeData) => {
            const rows = parseStoryboardRows(node.metadata?.storyboardRows);
            const indexes = rows.map((row, index) => (row[8]?.trim() ? index : -1)).filter((index) => index >= 0);
            if (!indexes.length) {
                message.warning("请先合成最终提示词");
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
            const scriptNode = nodesRef.current.find((item) => item.id === node.id) || node;
            const rows = parseStoryboardRows(scriptNode.metadata?.storyboardRows);
            const indexes = rows.map((_, index) => (scriptNode.metadata?.storyboardPromptDetails?.[String(index)]?.videoMotionPrompt?.trim() ? index : -1)).filter((index) => index >= 0);
            if (!indexes.length) {
                message.warning("请先合成视频运动提示词");
                return;
            }
            const generationConfig = { ...buildGenerationConfig(effectiveConfig, scriptNode, "video"), model: effectiveConfig.videoModel || effectiveConfig.model, count: "1" };
            const spec = nodeSizeFromRatio(generationConfig.size, NODE_DEFAULT_SIZE[CanvasNodeType.Video].width, NODE_DEFAULT_SIZE[CanvasNodeType.Video].height) || NODE_DEFAULT_SIZE[CanvasNodeType.Video];
            const existingWorkspace = nodesRef.current.find((item) => item.metadata?.workspaceKind === "storyboard-videos" && item.metadata.workspaceSourceNodeId === scriptNode.id);
            const workspaceId = existingWorkspace?.id || nanoid();
            const workspacePosition = existingWorkspace?.position || defaultStoryboardVideoWorkspacePosition(scriptNode, nodesRef.current);
            const videoNodes = indexes.map((rowIndex, order) => buildStoryboardVideoDraftNode(scriptNode, rows[rowIndex], rowIndex, order, spec, generationConfig, workspacePosition, nodesRef.current));
            const linkedAssetCount = videoNodes.reduce((total, videoNode) => total + storyboardVideoAssetReferenceNodes(videoNode, nodesRef.current).length, 0);
            const workspaceNode = buildStoryboardWorkspaceNode(existingWorkspace, workspaceId, scriptNode, videoNodes, workspacePosition, "storyboard-videos");
            setNodes((prev) => {
                const draftById = new Map([workspaceNode, ...videoNodes].map((item) => [item.id, item]));
                const updated = prev.map((item) => draftById.get(item.id) || item);
                const existingIds = new Set(prev.map((item) => item.id));
                return [...updated, ...[workspaceNode, ...videoNodes].filter((item) => !existingIds.has(item.id))];
            });
            setConnections((prev) =>
                addUniqueConnections(prev, [
                    { id: nanoid(), fromNodeId: scriptNode.id, toNodeId: workspaceNode.id },
                    ...videoNodes.flatMap((videoNode) => storyboardVideoAssetReferenceNodes(videoNode, nodesRef.current).map((assetNode) => ({ id: nanoid(), fromNodeId: assetNode.id, toNodeId: videoNode.id }))),
                ]),
            );
            if (!linkedAssetCount) message.info("视频工作区已搭建；如需资产参考，请先确认资产工作区已生成");
            message.success(`已搭建视频工作区，包含 ${videoNodes.length} 个待审核视频节点`);
        },
        [effectiveConfig, message],
    );

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

    const handleNodePromptChange = useCallback((nodeId: string, prompt: string) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, prompt } } : node)));
    }, []);

    const handleConfigNodeChange = useCallback((nodeId: string, patch: Partial<CanvasNodeData["metadata"]>) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? applyNodeConfigPatch(node, patch) : node)));
    }, []);

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
                setNodes((prev) => [...prev, textNode]);
                setSelectedNodeIds(new Set([textNode.id]));
                setSelectedConnectionId(null);
                setDialogNodeId(textNode.id);
                message.success("已新建提示词文本节点");
                return;
            }
            const nextPrompt = mergePromptForNode(node, text, mode);
            setNodes((prev) => prev.map((item) => (item.id === node.id ? applyNodeConfigPatch(item, promptPatchForNode(item, nextPrompt)) : item)));
            setDialogNodeId(node.id);
            message.success(mode === "append" ? "已追加到当前提示词" : "已替换当前提示词");
        },
        [message],
    );

    const rewritePromptWithAi = useCallback(
        async (node: CanvasNodeData, prompt: string, requirement: string, selectedModel?: string) => {
            const model = selectedModel || promptAssistantModel || effectiveConfig.textModel || effectiveConfig.model;
            const requestConfig = { ...effectiveConfig, model };
            if (!isAiConfigReady(requestConfig, model)) {
                openConfigDialog(true);
                throw new Error("请先在右上角配置里设置文本模型、API Base 和 API Key");
            }
            const instruction = buildPromptAssistantInstruction(prompt || readNodePrompt(node), requirement);
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
                return (result || output).trim();
            } finally {
                setPromptAssistantLoading(false);
            }
        },
        [effectiveConfig, isAiConfigReady, openConfigDialog, promptAssistantModel],
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
                const errorDetails = error instanceof Error ? error.message : "生成失败";
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

    const pasteAssistantImage = useCallback(
        (file: File) => {
            const position = screenToCanvas((containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2, (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2);
            void createImageFileNode(file, position);
            message.success("已从剪切板添加图片");
        },
        [createImageFileNode, message, screenToCanvas, size.height, size.width],
    );

    const handleAssistantSessionsChange = useCallback((sessions: CanvasAssistantSession[], activeId: string | null) => {
        setChatSessions(sessions);
        setActiveChatId(activeId);
    }, []);

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
        if ((event.target as HTMLElement).closest("[data-node-id]")) return;
        event.preventDefault();
        setContextMenu(null);
    }, []);

    const handleGenerateNode = useCallback(
        async (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => {
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

            setRunningNodeId(nodeId);
            const runController = startGenerationRequest(nodeId, nodeId, nodeId);
            const sourceTextContent = sourceNode?.type === CanvasNodeType.Text ? sourceNode.metadata?.content?.trim() || "" : "";
            const editingTextNode = mode === "text" && sourceNode?.type === CanvasNodeType.Text && Boolean(sourceTextContent);
            const basePrompt = sourceNode?.type === CanvasNodeType.Script ? prompt.trim() || sourceNode.metadata?.prompt || STORYBOARD_SCRIPT_PRESET : prompt;
            const generationContext = await hydrateNodeGenerationContext(
                buildNodeGenerationContext(nodeId, nodesRef.current, connectionsRef.current, editingTextNode ? `请根据要求修改以下文本。\n\n原文：\n${sourceTextContent}\n\n修改要求：\n${prompt}` : basePrompt),
            );
            const effectivePrompt = generationContext.prompt.trim();
            if (runController.signal.aborted) {
                finishGenerationRequest(nodeId, runController);
                setRunningNodeId(null);
                return;
            }
            const markSourceStatus = sourceNode?.type !== CanvasNodeType.Image && !editingTextNode;
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
                    const sourceReference =
                        isImageNode && sourceNode?.metadata?.content
                            ? [{ id: sourceNode.id, name: `${sourceNode.title || sourceNode.id}.png`, type: sourceNode.metadata.mimeType || "image/png", dataUrl: sourceNode.metadata.content, storageKey: sourceNode.metadata.storageKey }]
                            : [];
                    const referenceImages = sourceReference.length ? sourceReference : generationContext.referenceImages;
                    const generationType = referenceImages.length ? ("edit" as const) : ("generation" as const);
                    const useMultiViewGrid = generationType === "generation" && shouldUseMultiViewGrid(effectivePrompt, sourceNode?.metadata);
                    const characterReferencePrompts = isConfigNode ? (sourceNode.metadata?.characterReferenceVariantPrompts || []).map((item) => item.trim()).filter(Boolean) : [];
                    const characterReferenceTitles = isConfigNode ? sourceNode.metadata?.characterReferenceVariantTitles || [] : [];
                    const requestPrompt = useMultiViewGrid ? prepareMultiViewPrompt(effectivePrompt) : characterReferencePrompts[0] || effectivePrompt;
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
                    const rootNode: CanvasNodeData = {
                        id: rootId,
                        type: CanvasNodeType.Image,
                        title: characterReferenceTitles[0] || effectivePrompt.slice(0, 32) || "Generated Image",
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
                        title: characterReferenceTitles[index] || effectivePrompt.slice(0, 32) || "Generated Image",
                        position: {
                            x: rootNode.position.x + rootNode.width + 120 + (index % 2) * (imageConfig.width + 36),
                            y: rootNode.position.y + Math.floor(index / 2) * (imageConfig.height + rowGap),
                        },
                        width: imageConfig.width,
                        height: imageConfig.height,
                        metadata: { prompt: requestPrompts[index] || requestPrompt, sourcePrompt: useMultiViewGrid ? effectivePrompt : undefined, sceneViewRole: sourceNode?.metadata?.sceneViewRole, sceneGroupId: sourceNode?.metadata?.sceneGroupId, status: NODE_STATUS_LOADING, batchRootId: count > 1 ? rootId : undefined, characterReferenceRole: characterReferenceTitles[index], ...generationMetadata },
                    }));
                    const batchConnections = [...(isEmptyImageNode ? [] : [{ id: nanoid(), fromNodeId: nodeId, toNodeId: rootId }]), ...childIds.map((childId) => ({ id: nanoid(), fromNodeId: rootId, toNodeId: childId }))];

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
                    const videoId = isEmptyVideoNode ? nodeId : nanoid();
                    const parent = sourceNode?.position || { x: 0, y: 0 };
                    const videoNode: CanvasNodeData = {
                        id: videoId,
                        type: CanvasNodeType.Video,
                        title: effectivePrompt.slice(0, 32) || "Generated Video",
                        position: isEmptyVideoNode ? sourceNode.position : { x: parent.x + (sourceNode?.width || spec.width) + 96, y: parent.y },
                        width: isEmptyVideoNode ? sourceNode.width : spec.width,
                        height: isEmptyVideoNode ? sourceNode.height : spec.height,
                        metadata: { prompt: effectivePrompt, status: NODE_STATUS_LOADING, model: generationConfig.model, size: generationConfig.size, seconds: generationConfig.videoSeconds, vquality: generationConfig.vquality, generateAudio: generationConfig.videoGenerateAudio, watermark: generationConfig.videoWatermark, references: generationReferenceUrls(generationContext) },
                    };
                    pendingChildIds = [videoId];
                    setNodes((prev) => (isEmptyVideoNode ? prev.map((node) => (node.id === nodeId ? { ...node, ...videoNode } : node)) : [...prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS } } : node)), videoNode]));
                    if (!isEmptyVideoNode) setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: nodeId, toNodeId: videoId }]);
                    const controller = startGenerationRequest(videoId, nodeId, nodeId, runController);
                    try {
                        const video = await storeGeneratedVideo(await requestVideoGeneration(generationConfig, effectivePrompt, generationContext.referenceImages, generationContext.referenceVideos, generationContext.referenceAudios, { signal: controller.signal }));
                        const videoSize = fitNodeSize(video.width || spec.width, video.height || spec.height, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                        setNodes((prev) => prev.map((node) => (node.id === videoId ? { ...node, width: videoSize.width, height: videoSize.height, position: { x: node.position.x + node.width / 2 - videoSize.width / 2, y: node.position.y + node.height / 2 - videoSize.height / 2 }, metadata: { ...node.metadata, ...videoMetadata(video), prompt: effectivePrompt, model: generationConfig.model, size: generationConfig.size, seconds: generationConfig.videoSeconds, vquality: generationConfig.vquality, generateAudio: generationConfig.videoGenerateAudio, watermark: generationConfig.videoWatermark, references: generationReferenceUrls(generationContext) } } : node)));
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
                        const audio = await storeGeneratedAudio(await requestAudioGeneration(generationConfig, effectivePrompt, { signal: controller.signal }), generationConfig.audioFormat);
                        setNodes((prev) => prev.map((node) => (node.id === audioId ? { ...node, metadata: { ...node.metadata, ...audioMetadata(audio), prompt: effectivePrompt, ...buildAudioGenerationMetadata(generationConfig) } } : node)));
                    } finally {
                        finishGenerationRequest(audioId, controller);
                    }
                    return;
                }

                let streamed = "";
                const isConfigNode = sourceNode?.type === CanvasNodeType.Config;
                const textCount = isConfigNode ? getGenerationCount(generationConfig.count) : 1;
                const parentConfig = NODE_DEFAULT_SIZE[isConfigNode ? CanvasNodeType.Config : sourceNode?.type === CanvasNodeType.Script ? CanvasNodeType.Script : CanvasNodeType.Text];
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
        [effectiveConfig, finishGenerationRequest, generateStoryboardShotsFromInputs, isAiConfigReady, message, openConfigDialog, startGenerationRequest],
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
                          count: "1",
                      }
                    : { ...buildGenerationConfig(effectiveConfig, sourceNode, node.type === CanvasNodeType.Text || node.type === CanvasNodeType.Script ? "text" : node.type === CanvasNodeType.Video ? "video" : node.type === CanvasNodeType.Audio ? "audio" : "image"), count: "1" };
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                return;
            }

            const context = hasSavedImageMetadata ? null : await hydrateNodeGenerationContext(buildNodeGenerationContext(sourceNode.id, nodesRef.current, connectionsRef.current, sourceNode.metadata?.prompt || node.metadata?.prompt || ""));
            const prompt = (savedImageMetadata?.prompt || context?.prompt || "").trim();
            const storyboardVideoFinalPrompt = node.type === CanvasNodeType.Video ? node.metadata?.storyboardVideoFinalPrompt?.trim() || "" : "";
            if (!prompt && !storyboardVideoFinalPrompt) {
                message.warning("找不到提示词，无法重试");
                return;
            }
            const generationType = savedImageMetadata?.generationType;
            const useReferenceImages = generationType ? generationType === "edit" : Boolean(context?.referenceImages.length);
            const storyboardVideoReferences = node.type === CanvasNodeType.Video ? await resolveStoryboardVideoReferences(node.metadata?.storyboardVideoReferences) : [];
            const storyboardVideoFramePrompt = node.type === CanvasNodeType.Video ? storyboardVideoFrameContinuityPrompt(node.metadata?.storyboardVideoReferences) : "";
            const retryReferenceImages =
                hasSavedImageMetadata && savedImageMetadata ? await resolveMetadataReferences(savedImageMetadata) : useReferenceImages ? (context?.referenceImages.length ? context.referenceImages : sourceNodeReferenceImages(batchRoot || sourceNode)) : [];
            if (useReferenceImages && !retryReferenceImages) {
                message.error("参考图片已丢失，无法继续重试");
                setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails: "参考图片已丢失，无法继续重试" } } : item)));
                return;
            }
            const retryImages = storyboardVideoReferences.length ? storyboardVideoReferences : retryReferenceImages || [];

            setRunningNodeId(node.id);
            setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_LOADING, errorDetails: undefined } } : item)));
            const controller = startGenerationRequest(node.id, sourceNode.id, node.id);

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
                    const videoPrompt = storyboardVideoFinalPrompt || (storyboardVideoFramePrompt ? `${prompt}\n\n${storyboardVideoFramePrompt}` : prompt);
                    const video = await storeGeneratedVideo(await requestVideoGeneration(generationConfig, videoPrompt, retryImages, context?.referenceVideos || [], context?.referenceAudios || [], { signal: controller.signal }));
                    const videoSize = fitNodeSize(video.width || node.width, video.height || node.height, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                    setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, width: videoSize.width, height: videoSize.height, position: { x: item.position.x + item.width / 2 - videoSize.width / 2, y: item.position.y + item.height / 2 - videoSize.height / 2 }, metadata: { ...item.metadata, ...videoMetadata(video), prompt, model: generationConfig.model, size: generationConfig.size, seconds: generationConfig.videoSeconds, vquality: generationConfig.vquality, generateAudio: generationConfig.videoGenerateAudio, watermark: generationConfig.videoWatermark } } : item)));
                    return;
                }
                if (node.type === CanvasNodeType.Audio) {
                    const audio = await storeGeneratedAudio(await requestAudioGeneration(generationConfig, prompt, { signal: controller.signal }), generationConfig.audioFormat);
                    setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, ...audioMetadata(audio), prompt, ...buildAudioGenerationMetadata(generationConfig) } } : item)));
                    return;
                }

                const image = useReferenceImages ? await requestEdit(generationConfig, prompt, retryImages, undefined, { signal: controller.signal }).then((items) => items[0]) : await requestGeneration(generationConfig, prompt, { signal: controller.signal }).then((items) => items[0]);
                const uploadedImage = await uploadImage(image.dataUrl);
                const imageConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
                const imageSize = fitNodeSize(uploadedImage.width, uploadedImage.height, imageConfig.width, imageConfig.height);
                const generationMetadata = savedImageMetadata?.generationType
                    ? { generationType: savedImageMetadata.generationType, model: generationConfig.model, size: generationConfig.size, quality: generationConfig.quality, count: savedImageMetadata.count || 1, references: savedImageMetadata.references }
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
                setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails } } : item)));
            } finally {
                finishGenerationRequest(node.id, controller);
                setRunningNodeId(null);
            }
        },
        [effectiveConfig, finishGenerationRequest, isAiConfigReady, message, openConfigDialog, startGenerationRequest],
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
        (text: string) => {
            const center = screenToCanvas((containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2, (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2);
            const node = {
                ...createCanvasNode(CanvasNodeType.Text, center, { content: text, status: NODE_STATUS_SUCCESS }),
                title: text.slice(0, 32) || "Assistant Text",
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
                insertAssistantText(payload.content);
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

    const assistantOpen = assistantMounted && !assistantCollapsed;
    const openAgent = (mode: CanvasAgentMode = agentMode) => {
        if (agentCloseTimerRef.current) {
            clearTimeout(agentCloseTimerRef.current);
            agentCloseTimerRef.current = null;
        }
        setAgentMode(mode);
        setAssistantMounted(true);
        setAssistantClosing(false);
        setAssistantCollapsed(false);
    };
    const closeAgent = () => {
        if (!assistantMounted || assistantClosing) return;
        setAssistantCollapsed(true);
        setAssistantClosing(true);
        agentCloseTimerRef.current = setTimeout(() => {
            agentCloseTimerRef.current = null;
            setAssistantMounted(false);
            setAssistantClosing(false);
        }, CANVAS_AGENT_PANEL_MOTION_MS);
    };

    if (!projectLoaded) return <CanvasRefreshShell />;

    return (
        <main className="flex h-full min-h-0 overflow-hidden" style={{ background: theme.canvas.background, color: theme.node.text }}>
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
                    onHome={() => router.push("/")}
                    onProjects={() => router.push("/canvas")}
                    onCreateProject={createAndOpenProject}
                    onDeleteProject={deleteCurrentProject}
                    onImportImage={() => handleUploadRequest()}
                    onUndo={undoCanvas}
                    onRedo={redoCanvas}
                    agentOpen={assistantOpen}
                    compactAgentStatus={codexCompactAgent ? { connected: localAgentConnected, enabled: localAgentEnabled, activity: localAgentActivity } : undefined}
                    onToggleAgent={() => (assistantOpen ? closeAgent() : openAgent())}
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
                    onContextMenu={preventCanvasContextMenu}
                    onDrop={handleDrop}
                >
                    <svg className="absolute left-0 top-0 h-[10000px] w-[10000px] overflow-visible" style={{ pointerEvents: "none", transform: "translateZ(0)", zIndex: 0 }}>
                        {connections
                            .filter((connection) => {
                                const from = nodeById.get(connection.fromNodeId);
                                const to = nodeById.get(connection.toNodeId);
                                return Boolean(from && to && !isWorkspaceChildConnection(connection, from, to) && !isHiddenBatchConnectionEndpoint(from, nodes) && !isHiddenBatchConnectionEndpoint(to, nodes));
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
                            batchExpanded={Boolean(node.metadata?.imageBatchExpanded)}
                            batchClosing={Boolean(node.metadata?.batchRootId && collapsingBatchIds.has(node.metadata.batchRootId))}
                            batchOpening={openingBatchIds.has(node.id)}
                            batchRecovering={collapsingBatchIds.has(node.id)}
                            batchMotion={batchMotionById.get(node.id)}
                            showImageInfo={showImageInfo}
                            resourceLabel={resourceReferenceByNodeId.get(node.id)}
                            mentionReferences={mentionReferencesByNodeId.get(node.id) || []}
                            storyboardReferenceAssets={storyboardReferenceAssetsForNode(node, nodes)}
                            renderPanel={(panelNode) =>
                                panelNode.type === CanvasNodeType.Config ? (
                                    <CanvasConfigComposer
                                        value={panelNode.metadata?.composerContent ?? panelNode.metadata?.prompt ?? ""}
                                        inputs={configInputsById.get(panelNode.id) || []}
                                        onChange={(composerContent) => handleConfigNodeChange(panelNode.id, { composerContent })}
                                        onClose={() => setDialogNodeId(null)}
                                    />
                                ) : (
                                    <CanvasNodePromptPanel
                                        node={panelNode}
                                        isRunning={runningNodeId === panelNode.id}
                                        mentionReferences={mentionReferencesByNodeId.get(panelNode.id) || []}
                                        onPromptChange={handleNodePromptChange}
                                        onConfigChange={handleConfigNodeChange}
                                        onGenerate={handleGenerateNode}
                                        onStop={confirmStopGeneration}
                                        onPromptAssistant={openPromptAssistant}
                                        onImageSettingsOpenChange={(open) => {
                                            setNodeImageSettingsOpen(open);
                                            if (open) setToolbarNodeId(null);
                                        }}
                                    />
                                )
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
                            onStoryboardScreenshotImport={importStoryboardScreenshot}
                            onToggleBatch={toggleBatchExpanded}
                            onSetBatchPrimary={setBatchPrimary}
                            onRetry={(node, patch) => void handleRetryNode(node, patch)}
                            onGenerateImage={generateImageFromTextNode}
                            onOpenScript={(node) => setScriptNodeId(node.id)}
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
                </InfiniteCanvas>

                <CanvasNodeHoverToolbar
                    node={isNodeDragging || nodeImageSettingsOpen ? null : toolbarNode}
                    viewport={viewport}
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
                    onRetry={(node) => void handleRetryNode(node)}
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
                />

                {isMiniMapOpen ? <Minimap nodes={nodes} viewport={viewport} viewportSize={size} onViewportChange={setViewport} /> : null}

                <CanvasZoomControls scale={viewport.k} onScaleChange={setZoomScale} onReset={resetViewport} isMiniMapOpen={isMiniMapOpen} onToggleMiniMap={() => setIsMiniMapOpen((value) => !value)} />

                {contextMenu ? (
                    <CanvasNodeContextMenu
                        menu={contextMenu}
                        onClose={() => setContextMenu(null)}
                        onDuplicate={() => {
                            if (contextMenu.type !== "node") return;
                            duplicateNode(contextMenu.nodeId);
                            setContextMenu(null);
                        }}
                        onDelete={() => {
                            if (contextMenu.type === "node") {
                                deleteNodes(new Set([contextMenu.nodeId]));
                            } else {
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
                    node={scriptNode}
                    open={Boolean(scriptNode)}
                    actionKey={storyboardActionKey}
                    onClose={() => setScriptNodeId(null)}
                    onRowsChange={updateStoryboardRows}
                    onPrepareAssets={(node) => void prepareStoryboardAssets(node)}
                    onUpdateAsset={updateStoryboardAsset}
                    onUploadAssetImage={(nodeId, assetId, file) => void uploadStoryboardAssetImage(nodeId, assetId, file)}
                    onGenerateAssetImage={(node, assetId) => void generateStoryboardAssetImage(node, assetId)}
                    onBatchGenerateAssets={(node) => void batchGenerateStoryboardAssets(node)}
                    onGenerateShotsFromInputs={(node) => void generateStoryboardShotsFromInputs(node)}
                    onComposeFinalPrompt={(node, rowIndex) => void composeStoryboardFinalPrompt(node, rowIndex)}
                    onPromptDetailChange={updateStoryboardPromptDetail}
                    onModelChange={updateStoryboardModel}
                    onGenerateImage={(node, rowIndex) => void generateStoryboardImage(node, rowIndex)}
                    onGenerateVideo={(node, rowIndex) => void generateStoryboardVideo(node, rowIndex)}
                    onBatchGenerateVideos={(node) => void batchGenerateStoryboardVideos(node)}
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
                {codexCompactAgent && !assistantMounted ? <CanvasLocalAgentPanel headless snapshot={agentSnapshot} canUndoOps={Boolean(agentUndoSnapshot)} onApplyOps={applyAgentOps} onUndoOps={undoAgentOps} autoConnect={codexAutoConnect} /> : null}
            </section>
            {assistantMounted ? (
                <CanvasAssistantPanel
                    nodes={nodes}
                    selectedNodeIds={selectedNodeIds}
                    snapshot={agentSnapshot}
                    sessions={chatSessions}
                    activeSessionId={activeChatId}
                    onSelectNodeIds={setSelectedNodeIds}
                    onSessionsChange={handleAssistantSessionsChange}
                    onApplyOps={applyAgentOps}
                    canUndoOps={Boolean(agentUndoSnapshot)}
                    onUndoOps={undoAgentOps}
                    onPasteImage={pasteAssistantImage}
                    agentMode={agentMode}
                    onAgentModeChange={setAgentMode}
                    autoConnectLocal={codexAutoConnect}
                    closing={assistantClosing}
                    onCollapse={closeAgent}
                />
            ) : null}
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
                <div className="pointer-events-auto flex min-w-0 items-center gap-3">
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

function audioMetadata(audio: UploadedFile): CanvasNodeMetadata {
    return { content: audio.url, storageKey: audio.storageKey, status: "success", bytes: audio.bytes, mimeType: audio.mimeType || "audio/mpeg", durationMs: audio.durationMs };
}

function buildImageGenerationMetadata(type: CanvasImageGenerationType, config: AiConfig, count: number, references: ReferenceImage[]): CanvasNodeMetadata {
    return {
        generationType: type,
        model: config.model,
        size: config.size,
        quality: config.quality,
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

async function resolveStoryboardVideoReferences(references?: StoryboardVideoReference[]) {
    if (!references?.length) return [];
    const items = await Promise.all(
        sortStoryboardVideoReferences(references).map(async (reference, index) => {
            const source = reference.storageKey || reference.url || "";
            const dataUrl = source.startsWith("image:") ? await resolveImageUrl(source, "") : source;
            return dataUrl ? { id: reference.assetId || reference.nodeId || `${index}`, name: `${reference.name || reference.mention || `reference-${index}`}.png`, type: "image/png", dataUrl, url: dataUrl, storageKey: reference.storageKey } : null;
        }),
    );
    return items.filter((item): item is ReferenceImage => Boolean(item));
}

function storyboardVideoFrameContinuityPrompt(references?: StoryboardVideoReference[]) {
    if (!references?.length) return "";
    const firstFrames = references.filter((item) => item.role === "firstFrame");
    const lastFrames = references.filter((item) => item.role === "lastFrame");
    if (!firstFrames.length && !lastFrames.length) return "";
    return [
        "视频连续性要求：",
        firstFrames.length ? `- 以首帧参考图作为视频开始时的画面、角色站位、场景光线和构图基础：${firstFrames.map((item) => item.mention).join("、")}` : "",
        lastFrames.length ? `- 视频动作和镜头运动需要自然过渡到尾帧参考图对应的结束状态：${lastFrames.map((item) => item.mention).join("、")}` : "",
        "- 保持人物身份、服装、场景、光影和空间关系连续，不要突然切换角色外观或场景结构。",
    ]
        .filter(Boolean)
        .join("\n");
}

function sortStoryboardVideoReferences(references: StoryboardVideoReference[]) {
    const order = { firstFrame: 0, reference: 1, lastFrame: 2 };
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

function applyNodeConfigPatch(node: CanvasNodeData, patch: Partial<CanvasNodeData["metadata"]>) {
    const safePatch = patch || {};
    const next = { ...node, metadata: { ...node.metadata, ...safePatch } };
    const spec = node.type === CanvasNodeType.Video ? NODE_DEFAULT_SIZE[CanvasNodeType.Video] : NODE_DEFAULT_SIZE[CanvasNodeType.Image];
    const size = typeof safePatch.size === "string" && !node.metadata?.content ? nodeSizeFromRatio(safePatch.size, spec.width, spec.height) : null;
    return size && (node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video) ? { ...next, ...size, position: { x: node.position.x + node.width / 2 - size.width / 2, y: node.position.y + node.height / 2 - size.height / 2 } } : next;
}

function getConnectionTargetAnchor(node: CanvasNodeData, current: ConnectionHandle) {
    return {
        x: current.handleType === "source" ? node.position.x : node.position.x + node.width,
        y: node.position.y + node.height / 2,
    };
}

function normalizeConnection(firstNodeId: string, secondNodeId: string, nodes: CanvasNodeData[], firstHandleType: "source" | "target") {
    const first = nodes.find((node) => node.id === firstNodeId);
    const second = nodes.find((node) => node.id === secondNodeId);
    if (!first || !second || first.id === second.id) return null;
    if (first.type === CanvasNodeType.Config && second.type === CanvasNodeType.Config) return null;
    if (second.type === CanvasNodeType.Config) return { fromNodeId: first.id, toNodeId: second.id };
    if (first.type === CanvasNodeType.Config && firstHandleType === "target") return { fromNodeId: second.id, toNodeId: first.id };
    if (first.type === CanvasNodeType.Config) return { fromNodeId: first.id, toNodeId: second.id };
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
    return {
        ...config,
        model: node?.metadata?.model || defaultModel || (mode === "audio" ? defaultConfig.audioModel : config.model || defaultConfig.model),
        quality: node?.metadata?.quality || config.quality || defaultConfig.quality,
        size: node?.metadata?.size || config.size || defaultConfig.size,
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

function resetInterruptedGeneration(nodes: CanvasNodeData[]) {
    return nodes.map((node) => (node.metadata?.status === "loading" ? { ...node, metadata: { ...node.metadata, status: "error" as const, errorDetails: "页面刷新后生成已中断，请重新生成。" } } : node));
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

function isHiddenBatchConnectionEndpoint(node: CanvasNodeData, nodes: CanvasNodeData[]) {
    const rootId = node.metadata?.batchRootId;
    if (!rootId) return false;
    const root = nodes.find((item) => item.id === rootId);
    return Boolean(root && !root.metadata?.imageBatchExpanded);
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
    return joined.includes("镜号") || joined.includes("画面描述") || joined.includes("最终提示词");
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

function storyboardAssetImagePrompt(asset?: StoryboardAsset) {
    if (!asset) return "";
    const prompt = asset.prompt.trim() || asset.description.trim();
    if (!prompt) return "";
    if (asset.kind === "scene") {
        return `${prompt}\n\n资产类型：纯场景空镜。画面中禁止出现人物、角色、人脸、身体、手部、背影、剪影、路人或任何活人；只呈现场景空间、环境陈设、道具位置、光线、材质和地域时代质感。`;
    }
    if (asset.kind === "prop") {
        return `${prompt}\n\n资产类型：纯道具静物。画面中禁止出现人物、角色、人脸、身体、手部、背影、剪影或任何人持握；只呈现道具本身及其材质、磨损、摆放环境和光影。若道具是遗照、照片、证件或奖状，可以呈现道具内部的照片/证件内容，但现场画面不能出现真实人物。`;
    }
    return prompt;
}

function storyboardVideoAssetReferences(scriptNode: CanvasNodeData, rowIndex: number, nodes: CanvasNodeData[]) {
    const detail = scriptNode.metadata?.storyboardPromptDetails?.[String(rowIndex)];
    const promptText = `${detail?.storyboardPrompt || ""}\n${detail?.videoMotionPrompt || ""}`;
    const assets = scriptNode.metadata?.storyboardAssets || [];
    const mentions = Array.from(new Set([...storyboardAssetMentionsForPrompt(detail), ...assets.filter((asset) => promptText.includes(`@${asset.name}`) || promptText.includes(asset.name)).map((asset) => `@${asset.name}`)]));
    const mentionNodeIds = scriptNode.metadata?.storyboardAssetMentionNodeIds || {};
    const assetNodeIds = scriptNode.metadata?.storyboardAssetNodeIds || {};
    const assetByName = new Map(assets.map((asset) => [`@${asset.name}`, asset]));
    const resolved = new Map<string, { mention: string; node: CanvasNodeData; reference: ReferenceImage }>();
    for (const link of storyboardPromptAssetLinks(detail)) {
        if (link.status !== "bound" || !link.nodeId) continue;
        const assetNode = nodes.find((node) => node.id === link.nodeId);
        const reference = referenceImageFromCanvasNode(assetNode);
        if (assetNode && reference) resolved.set(assetNode.id, { mention: link.mention, node: assetNode, reference });
    }
    for (const mention of mentions) {
        const asset = assetByName.get(mention);
        const nodeId = mentionNodeIds[mention] || (asset ? assetNodeIds[asset.id] : "");
        const assetNode = nodes.find((node) => node.id === nodeId) || nodes.find((node) => node.metadata?.storyboardSourceNodeId === scriptNode.id && node.metadata?.storyboardAssetName && mention === `@${node.metadata.storyboardAssetName}`);
        const reference = referenceImageFromCanvasNode(assetNode);
        if (assetNode && reference) resolved.set(assetNode.id, { mention, node: assetNode, reference });
    }
    return Array.from(resolved.values()).slice(0, 9);
}

function storyboardReferenceAssetsForNode(node: CanvasNodeData, nodes: CanvasNodeData[]): StoryboardVideoReference[] {
    if (node.type !== CanvasNodeType.Video || !node.metadata?.storyboardSourceNodeId) return [];
    const sourceId = node.metadata.storyboardSourceNodeId;
    const scriptNode = nodes.find((item) => item.id === sourceId);
    const references = new Map<string, StoryboardVideoReference>();

    nodes.forEach((item) => {
        const name = item.metadata?.storyboardAssetName;
        if (item.type !== CanvasNodeType.Image || item.metadata?.storyboardSourceNodeId !== sourceId || !name || (!item.metadata.content && !item.metadata.storageKey)) return;
        const mention = `@${name}`;
        references.set(mention, {
            mention,
            name,
            status: "bound",
            nodeId: item.id,
            kind: item.metadata.storyboardAssetKind,
            url: item.metadata.content,
            storageKey: item.metadata.storageKey,
            role: "reference",
            source: "script",
        });
    });

    scriptNode?.metadata?.storyboardAssets?.forEach((asset) => {
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
            role: "reference",
            source: "script",
        });
    });

    return Array.from(references.values());
}

function storyboardVideoReferencesFromAssetReferences(assetReferences: ReturnType<typeof storyboardVideoAssetReferences>): StoryboardVideoReference[] {
    return assetReferences.map((item) => ({
        mention: item.mention,
        name: item.mention.replace(/^@/, ""),
        status: "bound",
        nodeId: item.node.id,
        url: item.reference.url || item.reference.dataUrl,
        storageKey: item.reference.storageKey,
        role: "reference",
        source: "script",
    }));
}

function buildStoryboardVideoDraftNode(scriptNode: CanvasNodeData, row: string[], rowIndex: number, order: number, spec: { width: number; height: number }, generationConfig: AiConfig, workspacePosition: Position, nodes: CanvasNodeData[]): CanvasNodeData {
    const existing = nodes.find((node) => node.metadata?.storyboardSourceNodeId === scriptNode.id && node.metadata?.storyboardRowIndex === rowIndex && node.type === CanvasNodeType.Video && !node.metadata?.content);
    const detail = scriptNode.metadata?.storyboardPromptDetails?.[String(rowIndex)];
    const prompt = detail?.videoMotionPrompt?.trim() || row?.[8]?.trim() || row?.[2]?.trim() || "";
    const assetReferences = storyboardVideoAssetReferences(scriptNode, rowIndex, nodes);
    const referenceUrls = assetReferences.map((item) => referenceUrl(item.reference)).filter((url): url is string => Boolean(url));
    const assetMentionLinks = detail ? linkStoryboardPromptAssets(scriptNode, detail, nodes).assetMentionLinks || [] : [];
    return {
        id: existing?.id || `storyboard-video-${scriptNode.id}-${rowIndex}`,
        type: CanvasNodeType.Video,
        title: `分镜视频 ${row?.[0] || rowIndex + 1}`,
        position: existing?.position || { x: workspacePosition.x + 36 + (order % STORYBOARD_VIDEO_GRID_COLUMNS) * (spec.width + 34), y: workspacePosition.y + 86 + Math.floor(order / STORYBOARD_VIDEO_GRID_COLUMNS) * (spec.height + 74) },
        width: existing?.width || spec.width,
        height: existing?.height || spec.height,
        metadata: {
            ...existing?.metadata,
            prompt,
            status: NODE_STATUS_IDLE,
            model: generationConfig.model,
            size: generationConfig.size,
            seconds: generationConfig.videoSeconds,
            vquality: generationConfig.vquality,
            generateAudio: generationConfig.videoGenerateAudio,
            watermark: generationConfig.videoWatermark,
            references: referenceUrls,
            storyboardSourceNodeId: scriptNode.id,
            storyboardRowIndex: rowIndex,
            storyboardAssetMentions: assetReferences.map((item) => item.mention),
            storyboardAssetMentionLinks: assetMentionLinks,
            storyboardAssetReferenceNodeIds: assetReferences.map((item) => item.node.id),
            storyboardVideoReferences: storyboardVideoReferencesFromAssetReferences(assetReferences),
        },
    };
}

function storyboardVideoAssetReferenceNodes(videoNode: CanvasNodeData, nodes: CanvasNodeData[]) {
    const sourceId = videoNode.metadata?.storyboardSourceNodeId;
    const nodeIds = videoNode.metadata?.storyboardAssetReferenceNodeIds || [];
    if (nodeIds.length) return nodeIds.map((nodeId) => nodes.find((node) => node.id === nodeId)).filter((node): node is CanvasNodeData => Boolean(node));
    const mentions = videoNode.metadata?.storyboardAssetMentions || [];
    return nodes.filter((node) => node.type === CanvasNodeType.Image && node.metadata?.storyboardSourceNodeId === sourceId && node.metadata?.storyboardAssetName && mentions.includes(`@${node.metadata.storyboardAssetName}`));
}

function defaultStoryboardAssetWorkspacePosition(sourceNode: CanvasNodeData): Position {
    return { x: sourceNode.position.x + sourceNode.width + 96, y: sourceNode.position.y + STORYBOARD_WORKSPACE_TOP_OFFSET };
}

function defaultStoryboardVideoWorkspacePosition(sourceNode: CanvasNodeData, nodes: CanvasNodeData[]): Position {
    const assetWorkspace = nodes.find((node) => node.metadata?.workspaceKind === "storyboard-assets" && node.metadata.workspaceSourceNodeId === sourceNode.id);
    const assetPosition = assetWorkspace?.position || defaultStoryboardAssetWorkspacePosition(sourceNode);
    const assetWidth = assetWorkspace?.width || estimateStoryboardGridWorkspaceWidth(sourceNode.metadata?.storyboardAssets?.length || STORYBOARD_ASSET_GRID_COLUMNS, NODE_DEFAULT_SIZE[CanvasNodeType.Image], STORYBOARD_ASSET_GRID_COLUMNS);
    return { x: assetPosition.x + assetWidth + STORYBOARD_WORKSPACE_GAP, y: assetPosition.y };
}

function estimateStoryboardGridWorkspaceWidth(count: number, spec: { width: number; height: number }, maxColumns: number) {
    const columns = Math.min(maxColumns, Math.max(count, 1));
    return 36 + columns * spec.width + Math.max(columns - 1, 0) * 34 + 36;
}

function buildStoryboardWorkspaceNode(existing: CanvasNodeData | undefined, id: string, sourceNode: CanvasNodeData, childNodes: CanvasNodeData[], position: Position, kind: "storyboard-assets" | "storyboard-videos"): CanvasNodeData {
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
    const title = kind === "storyboard-assets" ? `资产工作区｜${sourceNode.title || "脚本节点"}` : `视频工作区｜${sourceNode.title || "脚本节点"}`;
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
        "画面主体完整清晰，背景简洁干净，适合后续作为官方素材库上传的角色参考图。",
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
    const knownMentions = assets.filter((asset) => text.includes(`@${asset.name}`) || text.includes(asset.name)).map((asset) => `@${asset.name}`);
    const explicit = (detail.assetMentions || []).map((mention) => matchKnownAssetMention(mention, assets) || normalizeAssetMention(mention));
    return Array.from(new Set([...knownMentions, ...explicit].map(normalizeAssetMention).filter(Boolean)));
}

function matchKnownAssetMention(mention: string, assets: StoryboardAsset[]) {
    const normalized = normalizeAssetMention(mention);
    return assets.map((asset) => `@${asset.name}`).find((assetMention) => normalized === assetMention || normalized.startsWith(assetMention)) || "";
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
    };
}

function buildStoryboardPromptComposeSource(node: CanvasNodeData, rows: string[][], rowIndex: number) {
    const row = rows[rowIndex] || [];
    const assets = node.metadata?.storyboardAssets || [];
    const assetLines = assets.length
        ? assets.map((asset) => `- @${asset.name}｜${ASSET_KIND_TEXT[asset.kind]}｜${asset.description || asset.prompt || "无描述"}`).join("\n")
        : "暂无资产，请只根据镜头内容提炼，并在 assetMentions 里返回空数组。";
    const contextStart = Math.max(0, rowIndex - 1);
    const contextRows = rows
        .slice(contextStart, Math.min(rows.length, rowIndex + 2))
        .map((item, offset) => `${contextStart + offset === rowIndex ? "当前镜头" : "相邻镜头"}：${storyboardRowSummary(item)}`)
        .join("\n");
    return [
        storyboardSourceTextForNode(node) ? `原始剧本或补充要求：\n${storyboardSourceTextForNode(node)}` : "",
        node.metadata?.storyboardAssetStyle ? `全局风格：\n${node.metadata.storyboardAssetStyle}` : "",
        `当前镜头：\n${STORYBOARD_COLUMNS.map((column, colIndex) => `${column}: ${row[colIndex] || ""}`).join("\n")}`,
        contextRows ? `前后镜头上下文：\n${contextRows}` : "",
        `第二步资产清单：\n${assetLines}`,
    ]
        .filter(Boolean)
        .join("\n\n");
}

function storyboardRowSummary(row: string[]) {
    return `镜号 ${row[0] || ""}，画面：${row[2] || ""}，对白：${row[5] || ""}，运镜：${row[7] || ""}`;
}

function parseStoryboardPromptDetailAnswer(content: string): StoryboardPromptDetail {
    const data = parseJsonObject(content) as Record<string, unknown>;
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("模型没有返回可用的提示词 JSON");
    const storyboardPrompt = readStringField(data, ["storyboardPrompt", "分镜提示词", "imagePrompt", "prompt"]).trim();
    const videoMotionPrompt = readStringField(data, ["videoMotionPrompt", "视频运动提示词", "videoPrompt", "motionPrompt"]).trim();
    const mentionValue = data.assetMentions ?? data.assets ?? data["资产引用"];
    const assetMentions = (Array.isArray(mentionValue) ? mentionValue.map((item) => String(item || "")) : typeof mentionValue === "string" ? mentionValue.split(/[，,、\n]/) : []).map(normalizeAssetMention).filter(Boolean);
    if (!storyboardPrompt && !videoMotionPrompt) throw new Error("模型没有返回分镜提示词或视频运动提示词");
    return { storyboardPrompt: storyboardPrompt || videoMotionPrompt, videoMotionPrompt: videoMotionPrompt || storyboardPrompt, assetMentions: Array.from(new Set(assetMentions)) };
}

function normalizeAssetMention(value: string) {
    const name = value.trim().replace(/^@+/, "");
    return name ? `@${name}` : "";
}

function storyboardSourceTextForNode(node: CanvasNodeData) {
    const sourceText = node.metadata?.storyboardSourceText?.trim();
    if (sourceText) return sourceText;
    const prompt = node.metadata?.prompt?.trim();
    if (prompt && prompt !== STORYBOARD_SCRIPT_PRESET) return prompt;
    if (!node.metadata?.storyboardRows?.length) return node.metadata?.content?.trim() || "";
    return "";
}

function parseStoryboardAssetAnswer(content: string): { style: string; assets: StoryboardAsset[] } {
    const data = parseJsonObject(content) as Record<string, unknown> | unknown[];
    const records = collectStoryboardAssetRecords(data);
    if (!records.length) throw new Error("模型没有返回可用的资产 JSON");
    const assets = records
        .map(({ item, kind }, index) => normalizeStoryboardAsset(item, index, kind))
        .filter((asset): asset is StoryboardAsset => Boolean(asset))
        .slice(0, 30);
    if (!assets.length) throw new Error("没有识别到角色、场景或道具资产");
    return { style: !Array.isArray(data) && typeof data.style === "string" ? data.style.trim() : "", assets };
}

function collectStoryboardAssetRecords(data: Record<string, unknown> | unknown[]) {
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

function readAssetGroup(data: Record<string, unknown>, key: string, kind: StoryboardAssetKind) {
    const value = data[key];
    return Array.isArray(value) ? value.map((item) => ({ item, kind })) : [];
}

function normalizeStoryboardAsset(item: unknown, index: number, fallbackKind?: StoryboardAssetKind): StoryboardAsset | null {
    if (!item || typeof item !== "object") return null;
    const record = item as Record<string, unknown>;
    const kind = normalizeStoryboardAssetKind(record.kind) || fallbackKind || null;
    const name = readStringField(record, ["name", "名称", "角色名", "场景名", "道具名", "title"]).trim();
    if (!kind || !name) return null;
    const description = readStringField(record, ["description", "描述", "角色描述", "场景描述", "道具描述", "detail"]).trim();
    const prompt = readStringField(record, ["prompt", "提示词", "生成提示词", "imagePrompt", "生图提示词"]).trim() || description;
    return { id: `asset-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 6)}`, kind, name, description, prompt, status: NODE_STATUS_IDLE };
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

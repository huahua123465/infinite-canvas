import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Alert, Button, Empty, Input, Modal } from "antd";
import { AlertTriangle, ArrowUp, Boxes, ChevronRight, Copy, Expand, FileText, Group, Image as ImageIcon, Music2, Pencil, Puzzle, RefreshCw, Star, Trash2, Video, X } from "lucide-react";

import { ModelPicker } from "@/components/model-picker";
import { CreditSymbol, requestCreditCost } from "@/constant/credits";
import { canvasThemes } from "@/lib/canvas-theme";
import { getNodeDefinition, useNodeRegistryVersion } from "@/lib/canvas/node-registry";
import { buildNodeContext } from "@/lib/canvas/plugin-node-context";
import { storyboardPlanningConfigKey } from "@/lib/canvas/storyboard-planning";
import { formatBytes } from "@/lib/image-utils";
import { isSeedanceMini8sModel, seedanceModelFixedResolution } from "@/lib/seedance-video";
import { isOmniImageVideoModel, isOmniVideoToVideoModel, isSoraVideoModel, isVeoVideoModel } from "@/lib/video-model-capabilities";
import { resolveImageUrl } from "@/services/image-storage";
import { classifyVideoFailure } from "@/services/api/video";
import { defaultConfig, modelOptionLabel, modelOptionName, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { useAssetStore, type ImageAsset } from "@/stores/use-asset-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useCopyText } from "@/hooks/use-copy-text";
import { CanvasVideoSettingsPopover } from "./canvas-video-settings-popover";
import { CanvasResourceMentionTextarea } from "./canvas-resource-mention-textarea";
import { CanvasNodeType, STORYBOARD_PROMPT_SOURCE_TEXT, STORYBOARD_VIDEO_PROMPT_PREVIEW_EVENT, type CanvasNodeData, type CanvasNodeMetadata, type Position, type StoryboardAssetMentionLink, type StoryboardAudioReference, type StoryboardVideoReference, type StoryboardVideoReferenceRole } from "@/types/canvas";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import type { CanvasNodeContext, CanvasPluginHost } from "@/types/canvas-plugin";
import { CanvasPluginErrorBoundary } from "./canvas-plugin-error-boundary";

type ResizeCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";
const selectionBlue = "#2f80ff";
const PLUGIN_INTERACTIVE_SELECTOR = "button, input, textarea, select, a, iframe, canvas, [contenteditable], [role=button], [data-canvas-no-drag]";
const STORYBOARD_VIDEO_REFERENCE_ROLE_TEXT: Record<StoryboardVideoReferenceRole, string> = { firstFrame: "首帧", sceneLock: "场景锁定", reference: "参考", lastFrame: "尾帧" };
const STORYBOARD_VIDEO_REFERENCE_ROLE_ORDER: Record<StoryboardVideoReferenceRole, number> = { firstFrame: 0, sceneLock: 1, reference: 2, lastFrame: 3 };
export type StoryboardImportPreview = { rows: string[][]; raw: string; model: string };

type CanvasNodeProps = {
    data: CanvasNodeData;
    scale: number;
    isSelected: boolean;
    isRelated: boolean;
    isFocusRelated: boolean;
    isConnectionTarget: boolean;
    isConnecting: boolean;
    editRequestNonce?: number;
    showPanel: boolean;
    showImageInfo: boolean;
    mentionReferences?: CanvasResourceReference[];
    storyboardReferenceAssets?: StoryboardVideoReference[];
    storyboardVideoResults?: CanvasNodeData[];
    storyboardDurationSeconds?: string;
    pluginHost?: CanvasPluginHost;
    renderPanel?: (node: CanvasNodeData) => ReactNode;
    renderNodeContent?: (node: CanvasNodeData) => ReactNode;
    batchCount?: number;
    groupChildCount?: number;
    isGroupDropTarget?: boolean;
    batchExpanded?: boolean;
    batchClosing?: boolean;
    batchOpening?: boolean;
    batchRecovering?: boolean;
    batchMotion?: { x: number; y: number; index: number };
    onMouseDown: (event: React.MouseEvent, nodeId: string) => void;
    onHoverStart: (nodeId: string) => void;
    onHoverEnd: (nodeId: string) => void;
    onConnectStart: (event: React.MouseEvent, nodeId: string, handleType: "source" | "target") => void;
    onResize: (nodeId: string, width: number, height: number, position?: Position) => void;
    onMetadataChange: (nodeId: string, patch: Partial<CanvasNodeMetadata>) => void;
    onContentChange: (nodeId: string, content: string, storyboardRows?: string[][]) => void;
    onTitleChange: (nodeId: string, title: string) => void;
    onStoryboardScreenshotImport?: (node: CanvasNodeData, file: File, model?: string) => Promise<StoryboardImportPreview | null>;
    onToggleBatch?: (nodeId: string) => void;
    onSetBatchPrimary?: (node: CanvasNodeData) => void;
    onRetry?: (node: CanvasNodeData, patch?: Partial<CanvasNodeMetadata>) => void;
    onEditPrompt?: (node: CanvasNodeData) => void;
    onGenerateImage?: (node: CanvasNodeData) => void;
    onOpenScript?: (node: CanvasNodeData) => void;
    onViewImage?: (node: CanvasNodeData) => void;
    onContextMenu: (event: React.MouseEvent, nodeId: string) => void;
};

type NodeContentRendererProps = {
    node: CanvasNodeData;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    isEditingContent: boolean;
    textareaRef: React.RefObject<HTMLTextAreaElement | null>;
    isBatchRoot: boolean;
    batchCount: number;
    batchExpanded: boolean;
    batchOpening: boolean;
    batchRecovering: boolean;
    renderNodeContent?: (node: CanvasNodeData) => ReactNode;
    onContentChange: (nodeId: string, content: string, storyboardRows?: string[][]) => void;
    onMetadataChange: (nodeId: string, patch: Partial<CanvasNodeMetadata>) => void;
    onStoryboardScreenshotImport?: (node: CanvasNodeData, file: File, model?: string) => Promise<StoryboardImportPreview | null>;
    onStopEditing: () => void;
    mentionReferences: CanvasResourceReference[];
    storyboardReferenceAssets: StoryboardVideoReference[];
    storyboardVideoResults: CanvasNodeData[];
    storyboardDurationSeconds?: string;
    pluginContext?: CanvasNodeContext | null;
    pluginResetKey?: string;
    onRetry?: (node: CanvasNodeData, patch?: Partial<CanvasNodeMetadata>) => void;
    onEditPrompt?: (node: CanvasNodeData) => void;
    onGenerateImage?: (node: CanvasNodeData) => void;
    onOpenScript?: (node: CanvasNodeData) => void;
    onToggleBatch?: () => void;
    onSetBatchPrimary?: () => void;
    groupChildCount: number;
};

export const CanvasNode = React.memo(function CanvasNode({
    data,
    scale,
    isSelected,
    isRelated,
    isFocusRelated,
    isConnectionTarget,
    isConnecting,
    editRequestNonce = 0,
    showPanel,
    showImageInfo,
    mentionReferences = [],
    storyboardReferenceAssets = [],
    storyboardVideoResults = [],
    storyboardDurationSeconds,
    pluginHost,
    renderPanel,
    renderNodeContent,
    batchCount = 0,
    groupChildCount = 0,
    isGroupDropTarget = false,
    batchExpanded = false,
    batchClosing = false,
    batchOpening = false,
    batchRecovering = false,
    batchMotion,
    onMouseDown,
    onHoverStart,
    onHoverEnd,
    onConnectStart,
    onResize,
    onMetadataChange,
    onContentChange,
    onTitleChange,
    onStoryboardScreenshotImport,
    onToggleBatch,
    onSetBatchPrimary,
    onRetry,
    onEditPrompt,
    onGenerateImage,
    onOpenScript,
    onViewImage,
    onContextMenu,
}: CanvasNodeProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const registryVersion = useNodeRegistryVersion((state) => state.version);
    const definition = getNodeDefinition(data.type);
    const pluginContext = useMemo(() => (definition && pluginHost ? buildNodeContext(pluginHost, data, theme, scale, isSelected) : null), [data, definition, isSelected, pluginHost, registryVersion, scale, theme]);
    const [hovered, setHovered] = useState(false);
    const [isEditingContent, setIsEditingContent] = useState(false);
    const [isEditingTitle, setIsEditingTitle] = useState(false);
    const [titleDraft, setTitleDraft] = useState(data.title || "");
    const hasImageContent = data.type === CanvasNodeType.Image && Boolean(data.metadata?.content);
    const hasVideoContent = data.type === CanvasNodeType.Video && Boolean(data.metadata?.content);
    const hasAudioContent = data.type === CanvasNodeType.Audio && Boolean(data.metadata?.content);
    const isGroup = data.type === CanvasNodeType.Group;
    const isWorkspace = data.type === CanvasNodeType.Workspace;
    const isBatchRoot = data.type === CanvasNodeType.Image && Boolean(data.metadata?.isBatchRoot) && batchCount > 1;
    const supportsInteractionToggle = Boolean(definition?.interactionToggle);
    const forceInteractive = supportsInteractionToggle ? Boolean(definition?.forceInteractive?.(data)) : false;
    const contentInteractive = !supportsInteractionToggle || forceInteractive || !data.metadata?.content ? true : Boolean(data.metadata?.interactive);
    const isBatchChild = data.type === CanvasNodeType.Image && Boolean(data.metadata?.batchRootId);
    const transparentBg = Boolean(definition?.transparentBackground);
    const isActive = isConnectionTarget || isSelected || isFocusRelated;
    const imageBorderColor = isActive ? selectionBlue : isRelated && !isBatchChild ? theme.node.muted : "transparent";
    const nodeLayerClass = isWorkspace ? "z-0" : isGroup ? "z-[5]" : isSelected ? "z-50" : "z-10";
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const titleInputRef = useRef<HTMLInputElement>(null);
    const resizeRef = useRef({
        isResizing: false,
        corner: "bottom-right" as ResizeCorner,
        startX: 0,
        startY: 0,
        startLeft: 0,
        startTop: 0,
        startWidth: 0,
        startHeight: 0,
        keepRatio: false,
        ratio: 1,
    });

    useEffect(() => {
        setTitleDraft(data.title || "");
    }, [data.title]);

    useEffect(() => {
        if (!isEditingTitle) return;
        titleInputRef.current?.focus();
        titleInputRef.current?.select();
    }, [isEditingTitle]);

    const finishTitleEditing = useCallback(() => {
        const title = titleDraft.trim() || data.title || "未命名节点";
        setTitleDraft(title);
        setIsEditingTitle(false);
        if (title !== data.title) onTitleChange(data.id, title);
    }, [data.id, data.title, onTitleChange, titleDraft]);

    useEffect(() => {
        if (!isEditingTitle) return;
        const handleOutsidePointerDown = (event: PointerEvent) => {
            const target = event.target;
            if (target instanceof Node && titleInputRef.current?.contains(target)) return;
            finishTitleEditing();
        };
        window.addEventListener("pointerdown", handleOutsidePointerDown, true);
        return () => window.removeEventListener("pointerdown", handleOutsidePointerDown, true);
    }, [finishTitleEditing, isEditingTitle]);

    useEffect(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;

        const handleWheel = (event: WheelEvent) => event.stopPropagation();
        textarea.addEventListener("wheel", handleWheel, { passive: false });
        return () => textarea.removeEventListener("wheel", handleWheel);
    }, [data.type, isEditingContent]);

    useEffect(() => {
        if (!isEditingContent) return;
        const textarea = textareaRef.current;
        textarea?.focus();
        textarea?.setSelectionRange(textarea.value.length, textarea.value.length);
    }, [isEditingContent]);

    useEffect(() => {
        if (!editRequestNonce || data.type !== CanvasNodeType.Text) return;
        setIsEditingContent(true);
    }, [data.type, editRequestNonce]);

    useEffect(() => {
        if (!isEditingContent) return;

        const handleOutsidePointerDown = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) return;
            if (isEditingContent && textareaRef.current?.contains(target)) return;

            setIsEditingContent(false);
        };

        window.addEventListener("pointerdown", handleOutsidePointerDown, true);
        return () => window.removeEventListener("pointerdown", handleOutsidePointerDown, true);
    }, [isEditingContent]);

    const handleResizeMove = useCallback(
        (event: MouseEvent) => {
            if (!resizeRef.current.isResizing) return;

            const dx = (event.clientX - resizeRef.current.startX) / scale;
            const dy = (event.clientY - resizeRef.current.startY) / scale;
            const minWidth = 220;
            const minHeight = 160;
            const startRight = resizeRef.current.startLeft + resizeRef.current.startWidth;
            const startBottom = resizeRef.current.startTop + resizeRef.current.startHeight;
            const fromLeft = resizeRef.current.corner.includes("left");
            const fromTop = resizeRef.current.corner.includes("top");
            const rawWidth = Math.max(minWidth, resizeRef.current.startWidth + (fromLeft ? -dx : dx));
            const rawHeight = Math.max(minHeight, resizeRef.current.startHeight + (fromTop ? -dy : dy));
            let width = rawWidth;
            let height = rawHeight;
            if (resizeRef.current.keepRatio) {
                const ratio = resizeRef.current.ratio;
                if (Math.abs(dx) >= Math.abs(dy)) {
                    height = width / ratio;
                } else {
                    width = height * ratio;
                }
                if (height < minHeight) {
                    height = minHeight;
                    width = height * ratio;
                }
                if (width < minWidth) {
                    width = minWidth;
                    height = width / ratio;
                }
            }

            onResize(data.id, width, height, {
                x: fromLeft ? startRight - width : resizeRef.current.startLeft,
                y: fromTop ? startBottom - height : resizeRef.current.startTop,
            });
        },
        [data.id, onResize, scale],
    );

    const handleResizeUp = useCallback(() => {
        resizeRef.current.isResizing = false;
        window.removeEventListener("mousemove", handleResizeMove);
        window.removeEventListener("mouseup", handleResizeUp);
    }, [handleResizeMove]);

    const handleResizeMouseDown = (event: React.MouseEvent, corner: ResizeCorner) => {
        event.stopPropagation();
        event.preventDefault();
        resizeRef.current = {
            isResizing: true,
            corner,
            startX: event.clientX,
            startY: event.clientY,
            startLeft: data.position.x,
            startTop: data.position.y,
            startWidth: data.width,
            startHeight: data.height,
            keepRatio: pluginKeepAspectRatio(definition, data) ?? ((data.type === CanvasNodeType.Image && !data.metadata?.freeResize) || data.type === CanvasNodeType.Video),
            ratio: (data.metadata?.naturalWidth || data.width) / (data.metadata?.naturalHeight || data.height || 1),
        };
        window.addEventListener("mousemove", handleResizeMove);
        window.addEventListener("mouseup", handleResizeUp);
    };

    useEffect(() => {
        return () => {
            window.removeEventListener("mousemove", handleResizeMove);
            window.removeEventListener("mouseup", handleResizeUp);
        };
    }, [handleResizeMove, handleResizeUp]);

    return (
        <div
            data-node-id={data.id}
            className={`node-element absolute flex select-none flex-col transition-shadow duration-200 ${nodeLayerClass}`}
            style={{
                transform: `translate(${data.position.x}px, ${data.position.y}px)`,
                width: data.width,
                height: data.height,
                transition: "box-shadow 200ms ease",
                contain: "layout style",
            }}
            onMouseEnter={() => {
                setHovered(true);
                onHoverStart(data.id);
            }}
            onMouseLeave={() => {
                setHovered(false);
                onHoverEnd(data.id);
            }}
            onContextMenu={(event) => onContextMenu(event, data.id)}
        >
            {(isSelected || hovered || isEditingTitle) ? <div className="absolute left-3 top-[-28px] z-[65] max-w-[calc(100%-24px)]" onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
                {isEditingTitle ? (
                    <input
                        ref={titleInputRef}
                        value={titleDraft}
                        maxLength={64}
                        className="h-6 max-w-full border-0 border-b border-dashed bg-transparent px-0 text-left text-xs font-medium outline-none"
                        style={{ borderColor: theme.node.muted, color: theme.node.text }}
                        onChange={(event) => setTitleDraft(event.target.value)}
                        onBlur={finishTitleEditing}
                        onKeyDown={(event) => {
                            if (event.key === "Enter") finishTitleEditing();
                            if (event.key === "Escape") {
                                setTitleDraft(data.title || "");
                                setIsEditingTitle(false);
                            }
                        }}
                    />
                ) : (
                    <button
                        type="button"
                        className="block max-w-full truncate border-b border-dashed border-transparent px-0 py-0.5 text-left text-xs font-medium opacity-75 transition hover:border-current hover:opacity-100"
                        style={{ color: theme.node.text }}
                        title="双击修改节点名称"
                        onDoubleClick={(event) => {
                            event.stopPropagation();
                            setIsEditingTitle(true);
                        }}
                    >
                        {data.title || "未命名节点"}
                    </button>
                )}
            </div> : null}

            <div
                className="relative h-full w-full overflow-visible rounded-3xl border-2"
                style={{
                    background: isWorkspace ? "transparent" : isGroup ? `${theme.toolbar.panel}66` : hasImageContent || hasVideoContent || transparentBg ? "transparent" : theme.node.fill,
                    borderColor: isGroup ? (isGroupDropTarget || isActive ? selectionBlue : theme.node.stroke) : hasImageContent ? imageBorderColor : isActive ? selectionBlue : isRelated ? theme.node.muted : transparentBg ? "transparent" : theme.node.stroke,
                    borderStyle: isGroup ? "dashed" : "solid",
                    boxShadow: isWorkspace ? `inset 0 0 0 1px ${theme.node.stroke}66` : isGroupDropTarget ? `0 0 0 2px ${selectionBlue}66, inset 0 0 0 999px ${selectionBlue}10` : isActive ? `0 0 0 1px ${selectionBlue}55` : isRelated && !isBatchChild ? `0 0 0 1px ${theme.node.muted}55, 0 18px 48px rgba(0,0,0,.14)` : undefined,
                }}
                onMouseDown={(event) => onMouseDown(event, data.id)}
                onDoubleClick={(event) => {
                    if (isBatchRoot) {
                        event.stopPropagation();
                        onToggleBatch?.(data.id);
                        return;
                    }
                    if (definition?.onDoubleClick && pluginContext) {
                        try {
                            if (definition.onDoubleClick(pluginContext)) event.stopPropagation();
                        } catch (error) {
                            console.error(`[plugin] 双击处理失败: ${data.type}`, error);
                        }
                        return;
                    }
                    if (definition && !isPluginInteractiveTarget(event.target)) {
                        const editButton = event.currentTarget.querySelector<HTMLButtonElement>('button[title="编辑"], button[title="编辑源码"]');
                        if (editButton) {
                            event.stopPropagation();
                            editButton.click();
                            return;
                        }
                    }
                    if (data.type === CanvasNodeType.Image && hasImageContent) {
                        event.stopPropagation();
                        onViewImage?.(data);
                        return;
                    }
                    if (data.type === CanvasNodeType.Script) {
                        event.stopPropagation();
                        onOpenScript?.(data);
                        return;
                    }
                    if (data.type !== CanvasNodeType.Text) return;
                    event.stopPropagation();
                    setIsEditingContent(true);
                }}
            >
                <div
                    className={`relative flex h-full min-h-0 w-full items-center justify-center rounded-[inherit] ${isBatchRoot ? "overflow-visible" : "overflow-hidden"}`}
                    onMouseDownCapture={(event) => {
                        if (!definition || event.button !== 0 || isPluginInteractiveTarget(event.target)) return;
                        event.stopPropagation();
                        onMouseDown(event, data.id);
                    }}
                    style={
                        {
                            background: isWorkspace || isGroup ? "transparent" : hasImageContent || hasVideoContent || transparentBg ? "transparent" : theme.node.fill,
                            pointerEvents: contentInteractive ? undefined : "none",
                            "--batch-from-x": `${batchMotion?.x || 0}px`,
                            "--batch-from-y": `${batchMotion?.y || 0}px`,
                            "--batch-from-rotate": `${6 + (batchMotion?.index || 0) * 4}deg`,
                            animation: data.metadata?.batchRootId ? (batchClosing ? "canvas-batch-child-out 260ms cubic-bezier(.4,0,.2,1) both" : "canvas-batch-child-in 340ms cubic-bezier(.2,.85,.18,1) both") : undefined,
                            animationDelay: data.metadata?.batchRootId ? `${batchClosing ? 0 : 45 + (batchMotion?.index || 0) * 24}ms` : undefined,
                        } as React.CSSProperties
                    }
                >
                    <NodeContent
                        node={data}
                        theme={theme}
                        isEditingContent={isEditingContent}
                        textareaRef={textareaRef}
                        isBatchRoot={isBatchRoot}
                        batchCount={batchCount}
                        batchExpanded={batchExpanded}
                        batchOpening={batchOpening}
                        batchRecovering={batchRecovering}
                        renderNodeContent={renderNodeContent}
                        mentionReferences={mentionReferences}
                        storyboardReferenceAssets={storyboardReferenceAssets}
                        storyboardVideoResults={storyboardVideoResults}
                        storyboardDurationSeconds={storyboardDurationSeconds}
                        pluginContext={pluginContext}
                        pluginResetKey={`${data.id}:${registryVersion}`}
                        onContentChange={onContentChange}
                        onMetadataChange={onMetadataChange}
                        onStoryboardScreenshotImport={onStoryboardScreenshotImport}
                        onStopEditing={() => setIsEditingContent(false)}
                        onRetry={onRetry}
                        onEditPrompt={onEditPrompt}
                        onGenerateImage={onGenerateImage}
                        onOpenScript={onOpenScript}
                        onToggleBatch={() => onToggleBatch?.(data.id)}
                        onSetBatchPrimary={() => onSetBatchPrimary?.(data)}
                        groupChildCount={groupChildCount}
                    />
                </div>

                {showImageInfo && hasImageContent ? <ImageInfoBar node={data} /> : null}
                {!isWorkspace && !isGroup && !hasImageContent && !hasVideoContent && !hasAudioContent ? <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12" style={{ background: `linear-gradient(to top, ${theme.canvas.background}66, transparent)` }} /> : null}

                <ResizeHandle corner="top-left" onMouseDown={handleResizeMouseDown} />
                <ResizeHandle corner="top-right" onMouseDown={handleResizeMouseDown} />
                <ResizeHandle corner="bottom-left" onMouseDown={handleResizeMouseDown} />
                <ResizeHandle corner="bottom-right" onMouseDown={handleResizeMouseDown} />
            </div>

            {!isWorkspace && !isGroup ? <ConnectionHandleDot side="left" visible={hovered || isSelected || isConnecting} onMouseDown={(event) => onConnectStart(event, data.id, "target")} /> : null}
            {!isWorkspace && !isGroup ? <ConnectionHandleDot side="right" visible={(definition?.hasSourceHandle ?? true) && data.type !== CanvasNodeType.Config && (hovered || isSelected || isConnecting)} onMouseDown={(event) => onConnectStart(event, data.id, "source")} /> : null}

            {showPanel && renderPanel ? <div className="absolute left-1/2 top-full z-[70] w-[500px] -translate-x-1/2 pt-4">{renderPanel(data)}</div> : null}
        </div>
    );
});

function NodeContent(props: NodeContentRendererProps) {
    if (props.node.type === CanvasNodeType.Config && props.renderNodeContent) return props.renderNodeContent(props.node);
    if (props.isBatchRoot) return <ImageNodeContent {...props} />;
    if (props.node.type === CanvasNodeType.Video && !props.node.metadata?.content) {
        return <VideoNodeContent {...props} />;
    }
    if (props.node.metadata?.status === "loading") return <LoadingContent node={props.node} theme={props.theme} />;
    if (props.node.metadata?.status === "error") return <ErrorContent node={props.node} theme={props.theme} onRetry={props.onRetry} onEditPrompt={props.onEditPrompt} />;

    const Renderer = nodeContentRenderers[props.node.type as CanvasNodeType];
    if (Renderer) return <Renderer {...props} />;
    const definition = getNodeDefinition(props.node.type);
    if (definition?.Content && props.pluginContext) {
        const PluginContent = definition.Content;
        return (
            <CanvasPluginErrorBoundary resetKey={props.pluginResetKey || props.node.id} theme={props.theme}>
                <PluginContent ctx={props.pluginContext} />
            </CanvasPluginErrorBoundary>
        );
    }
    return <MissingPluginContent theme={props.theme} type={props.node.type} />;
}

const nodeContentRenderers = {
    [CanvasNodeType.Text]: TextContent,
    [CanvasNodeType.Image]: ImageNodeContent,
    [CanvasNodeType.Config]: EmptyImageContent,
    [CanvasNodeType.Video]: VideoNodeContent,
    [CanvasNodeType.Audio]: AudioNodeContent,
    [CanvasNodeType.Group]: GroupNodeContent,
    [CanvasNodeType.Script]: ScriptNodeContent,
    [CanvasNodeType.Workspace]: WorkspaceNodeContent,
} satisfies Record<CanvasNodeType, (props: NodeContentRendererProps) => ReactNode>;

function GroupNodeContent({ theme, groupChildCount }: NodeContentRendererProps) {
    return (
        <div className="pointer-events-none flex h-full w-full flex-col p-4">
            <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: theme.node.text }}>
                <span className="grid size-8 place-items-center rounded-xl" style={{ background: theme.toolbar.activeBg, color: theme.node.muted }}>
                    <Group className="size-4" />
                </span>
                <span>组</span>
                <span className="ml-auto rounded-full px-2 py-1 text-[11px] font-medium" style={{ background: theme.node.fill, color: theme.node.muted }}>
                    {groupChildCount} 个节点
                </span>
            </div>
            <div className="mt-3 flex-1 rounded-2xl border border-dashed" style={{ borderColor: theme.node.stroke, background: `${theme.node.fill}55` }} />
        </div>
    );
}

function LoadingContent({ node, theme }: Pick<NodeContentRendererProps, "node" | "theme">) {
    const progress = node.metadata?.storyboardPlanningProgress;
    if (node.type === CanvasNodeType.Script && progress) {
        return (
            <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-8 text-center" style={{ color: theme.node.text }}>
                <div className="size-8 animate-spin rounded-full border-2" style={{ borderColor: theme.node.stroke, borderTopColor: theme.node.activeStroke }} />
                <div className="text-sm font-medium">{progress.text}</div>
                <div className="h-1.5 w-full max-w-64 overflow-hidden rounded-full" style={{ background: theme.node.stroke }}>
                    <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${Math.max(0, Math.min(100, progress.percent))}%`, background: theme.node.activeStroke }} />
                </div>
                <div className="text-xs tabular-nums" style={{ color: theme.node.muted }}>{progress.percent}% · 长篇故事会分批处理，请保持页面打开</div>
            </div>
        );
    }
    return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3" style={{ color: theme.node.activeStroke }}>
            <div className="size-10 animate-spin rounded-full border-2" style={{ borderColor: theme.node.stroke, borderTopColor: theme.node.activeStroke }} />
            <span className="text-[10px] tracking-[0.2em]">生成中</span>
        </div>
    );
}

function ErrorContent({ node, theme, onRetry, onEditPrompt }: Pick<NodeContentRendererProps, "node" | "theme" | "onRetry" | "onEditPrompt">) {
    return (
        <div className="flex max-w-[260px] flex-col items-center gap-3 px-5 text-center">
            <div className="text-xs leading-5 text-red-300">{node.metadata?.errorDetails || "生成失败"}</div>
            <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                    type="button"
                    className="inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition hover:scale-[1.02]"
                    style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
                    onClick={(event) => {
                        event.stopPropagation();
                        onEditPrompt?.(node);
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                >
                    <Pencil className="size-3.5" />
                    修改提示词
                </button>
                <button
                    type="button"
                    className="inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition hover:scale-[1.02]"
                    style={{ background: theme.node.fill, borderColor: theme.toolbar.border, color: theme.node.text }}
                    onClick={(event) => {
                        event.stopPropagation();
                        onRetry?.(node);
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                >
                    <RefreshCw className="size-3.5" />
                    直接重试
                </button>
            </div>
        </div>
    );
}

function MissingPluginContent({ theme, type }: Pick<NodeContentRendererProps, "theme"> & { type: string }) {
    return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center" style={{ color: theme.node.placeholder }}>
            <Puzzle className="size-7 opacity-40" />
            <span className="text-sm">缺少插件</span>
            <span className="text-[11px] opacity-70">节点类型“{type}”的插件未安装或未启用</span>
        </div>
    );
}

function pluginKeepAspectRatio(definition: ReturnType<typeof getNodeDefinition>, node: CanvasNodeData) {
    if (!definition?.keepAspectRatio) return undefined;
    try {
        return definition.keepAspectRatio(node);
    } catch (error) {
        console.error(`[plugin] 节点比例规则失败: ${node.type}`, error);
        return undefined;
    }
}

function isPluginInteractiveTarget(target: EventTarget | null) {
    return target instanceof Element && Boolean(target.closest(PLUGIN_INTERACTIVE_SELECTOR));
}

function TextContent({ node, theme, isEditingContent, textareaRef, mentionReferences, onContentChange, onStopEditing, onGenerateImage }: NodeContentRendererProps) {
    if (node.metadata?.storyboardRows) return <StoryboardTableContent node={node} onContentChange={onContentChange} />;

    const fontSize = node.metadata?.fontSize || 14;
    const textStyle = { fontSize: `${fontSize}px`, lineHeight: `${Math.round(fontSize * 1.65)}px`, color: theme.node.text, boxSizing: "border-box" } as React.CSSProperties;

    return (
        <div className="box-border flex h-full min-h-0 w-full flex-col overflow-hidden pt-8">
            <button
                type="button"
                className="absolute right-3 top-3 z-20 inline-flex h-8 items-center gap-1 rounded-full border px-2.5 text-xs font-medium opacity-85 backdrop-blur-md transition hover:scale-[1.02] hover:opacity-100"
                style={{ background: `${theme.toolbar.panel}dd`, borderColor: theme.node.stroke, color: theme.node.text }}
                onClick={(event) => {
                    event.stopPropagation();
                    onGenerateImage?.(node);
                }}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                title="用文本生图"
                aria-label="用文本生图"
            >
                <ImageIcon className="size-3.5" />
                生图
            </button>
            {isEditingContent ? (
                <CanvasResourceMentionTextarea
                    ref={textareaRef}
                    containerClassName="min-h-0 flex-1 w-full"
                    className="thin-scrollbar block h-full min-h-0 w-full resize-none overflow-y-auto whitespace-pre-wrap break-words border-none bg-transparent pl-4 pr-14 pt-0 pb-4 m-0 font-mono outline-none select-text appearance-none"
                    style={textStyle}
                    value={node.metadata?.content || ""}
                    references={mentionReferences}
                    highlightLabels={false}
                    onChange={(value) => onContentChange(node.id, value)}
                    onBlur={onStopEditing}
                    onKeyDown={(event) => {
                        if (event.key === "Escape") onStopEditing();
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                    onWheel={(event) => event.stopPropagation()}
                    data-canvas-scrollable="true"
                />
            ) : (
                <div
                    className="thin-scrollbar block min-h-0 flex-1 w-full overflow-y-auto whitespace-pre-wrap break-words bg-transparent pl-4 pr-14 pt-0 pb-4 font-mono"
                    style={textStyle}
                    data-canvas-scrollable="true"
                    onWheel={(event) => {
                        event.stopPropagation();
                        event.preventDefault();
                        event.currentTarget.scrollTop += event.deltaY;
                    }}
                >
                    {node.metadata?.content || <span style={{ color: theme.node.placeholder }}>双击编辑文字</span>}
                </div>
            )}
        </div>
    );
}

const STORYBOARD_COLUMNS = ["镜号", "时长", "画面描述", "景别", "光影氛围", "对白旁白", "音效", "运镜", "最终提示词"];
const STORYBOARD_COL_WIDTHS = [64, 70, 300, 76, 210, 260, 180, 190, 250];
const STORYBOARD_ROW_LIMIT = 300;

function StoryboardTableContent({ node, onContentChange, onStoryboardScreenshotImport }: Pick<NodeContentRendererProps, "node" | "onContentChange" | "onStoryboardScreenshotImport">) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const importDialogRef = useRef<HTMLDivElement>(null);
    const pasteTextRef = useRef<HTMLTextAreaElement>(null);
    const [importOpen, setImportOpen] = useState(false);
    const [importingScreenshot, setImportingScreenshot] = useState(false);
    const [importError, setImportError] = useState("");
    const [importPreview, setImportPreview] = useState<StoryboardImportPreview | null>(null);
    const [importModel, setImportModel] = useState("");
    const bodyRows = normalizeStoryboardRows(node.metadata?.storyboardRows);
    const saveRows = (rows: string[][]) => onContentChange(node.id, storyboardRowsToMarkdown(rows), [STORYBOARD_COLUMNS, ...renumberStoryboardRows(rows)]);
    const updateCell = (rowIndex: number, colIndex: number, value: string) => {
        const nextRows = bodyRows.map((row) => [...row]);
        nextRows[rowIndex][colIndex] = value;
        saveRows(nextRows);
    };
    const deleteRow = (rowIndex: number) => saveRows(bodyRows.filter((_, index) => index !== rowIndex));
    const importText = (text: string) => {
        const value = text.trim();
        if (!value) return;
        if (pasteTextRef.current) pasteTextRef.current.value = "";
        void importScreenshot(new File([value], "clipboard-storyboard.txt", { type: "text/plain" }));
    };
    const importScreenshot = async (file?: File) => {
        if (!file) return;
        setImportError("");
        setImportPreview(null);
        setImportingScreenshot(true);
        const preview = await onStoryboardScreenshotImport?.(node, file, importModel || undefined);
        setImportingScreenshot(false);
        if (preview) {
            setImportPreview(preview);
            setImportModel(preview.model);
        }
        if (!preview?.rows.length) {
            setImportError("没有识别到可导入的分镜行。下面会显示模型原始返回，方便判断。");
        }
    };
    const handlePaste = (event: React.ClipboardEvent) => {
        if (!importOpen) return;
        const target = event.target;
        if ((target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) && !target.dataset.storyboardPasteZone) return;
        const file =
            Array.from(event.clipboardData.files).find((item) => item.type.startsWith("image/")) ||
            Array.from(event.clipboardData.items)
                .filter((item) => item.type.startsWith("image/"))
                .map((item) => item.getAsFile())
                .find((item): item is File => Boolean(item));
        const text = event.clipboardData.getData("text/plain").trim();
        if (!file && !text) return;
        event.preventDefault();
        if (file) void importScreenshot(file);
        else importText(text);
    };
    const openImportDialog = (event: React.MouseEvent) => {
        event.stopPropagation();
        setImportPreview(null);
        setImportError("");
        setImportOpen(true);
    };
    const confirmImportPreview = () => {
        if (!importPreview?.rows.length) return;
        const nextRows = [...bodyRows, ...importPreview.rows];
        saveRows(nextRows);
        setImportOpen(false);
        setImportPreview(null);
        setImportError("");
    };
    useEffect(() => {
        if (importOpen) importDialogRef.current?.focus();
    }, [importOpen]);

    return (
        <div className="h-full w-full overflow-hidden rounded-[inherit] bg-[#141414] text-[#e7e2d6]" onPaste={handlePaste}>
            <div className="flex h-12 cursor-move items-center border-b border-[#303030] bg-[#0e0e0e] px-5">
                <div className="text-sm font-semibold">分镜脚本</div>
                <button
                    type="button"
                    className="ml-4 rounded-md border border-[#3a3a3a] bg-[#202020] px-3 py-1 text-xs text-[#f1f1f1] hover:bg-[#2b2b2b]"
                    onClick={openImportDialog}
                    onMouseDown={(event) => event.stopPropagation()}
                    data-canvas-no-zoom
                >
                    添加脚本
                </button>
                <button
                    type="button"
                    className="ml-2 rounded-md border border-[#3a3a3a] bg-[#202020] px-3 py-1 text-xs text-[#f1f1f1] hover:bg-[#2b2b2b]"
                    onClick={openImportDialog}
                    onMouseDown={(event) => event.stopPropagation()}
                    data-canvas-no-zoom
                >
                    粘贴截图
                </button>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,.txt,.md,.markdown,.csv,text/plain,text/markdown,text/csv"
                    className="hidden"
                    onChange={(event) => {
                        void importScreenshot(event.target.files?.[0]);
                        event.currentTarget.value = "";
                    }}
                />
                <div className="ml-auto text-xs text-[#9c9c9c]">{bodyRows.length}/9 镜头 · 拖这里移动</div>
            </div>
            <div
                className="thin-scrollbar h-[calc(100%-48px)] overflow-auto"
                data-canvas-no-zoom
                data-storyboard-scroll
                onWheelCapture={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) event.currentTarget.scrollLeft += event.deltaY || event.deltaX;
                    else event.currentTarget.scrollTop += event.deltaY;
                }}
            >
                <table className="min-w-[1720px] border-collapse text-left text-[11px]">
                    <thead className="sticky top-0 z-20 bg-[#1f1f1f] text-[#9c9c9c]">
                        <tr>
                            {STORYBOARD_COLUMNS.map((column, index) => (
                                <th key={column} className={`${index === 0 ? "sticky left-0 z-30 bg-[#1f1f1f]" : ""} border-b border-r border-[#343434] px-2 py-2 font-medium`} style={{ width: STORYBOARD_COL_WIDTHS[index] }}>
                                    {column}
                                </th>
                            ))}
                            <th className="w-20 border-b border-[#343434] px-3 py-3 font-medium">操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        {bodyRows.map((row, rowIndex) => (
                            <tr key={rowIndex} className={rowIndex === 0 ? "bg-[#2b2b2b]" : "bg-[#151515]"}>
                                {STORYBOARD_COLUMNS.map((_, colIndex) => (
                                    <td key={colIndex} className={`${colIndex === 0 ? rowIndex === 0 ? "sticky left-0 z-10 bg-[#2b2b2b]" : "sticky left-0 z-10 bg-[#151515]" : ""} border-b border-r border-[#303030] align-top`}>
                                        <textarea
                                            className={`block w-full resize-none bg-transparent px-2 py-2 leading-[18px] outline-none ${colIndex < 2 ? "text-center font-semibold" : ""}`}
                                            style={{ minHeight: 76, color: colIndex === 8 ? "#a0a0a0" : "#f1f1f1" }}
                                            value={row[colIndex] || ""}
                                            onChange={(event) => updateCell(rowIndex, colIndex, event.target.value)}
                                            onPaste={handlePaste}
                                            onWheel={(event) => {
                                                event.preventDefault();
                                                event.stopPropagation();
                                                const scroller = event.currentTarget.closest<HTMLElement>("[data-storyboard-scroll]");
                                                if (!scroller) return;
                                                if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) scroller.scrollLeft += event.deltaY || event.deltaX;
                                                else scroller.scrollTop += event.deltaY;
                                            }}
                                            onMouseDown={(event) => event.stopPropagation()}
                                            onPointerDown={(event) => event.stopPropagation()}
                                        />
                                    </td>
                                ))}
                                <td className="border-b border-[#303030] px-3 py-3 text-center">
                                    <button
                                        type="button"
                                        className="rounded border border-[#3a3a3a] px-2 py-1 text-[11px] text-[#ff8c8c] hover:bg-[#2a1a1a]"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            deleteRow(rowIndex);
                                        }}
                                        onMouseDown={(event) => event.stopPropagation()}
                                    >
                                        删除
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {importOpen ? (
                <div className="absolute inset-0 z-[80] grid place-items-center bg-black/55 outline-none" tabIndex={0} data-canvas-no-zoom onMouseDown={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()} onPaste={handlePaste}>
                    <div className="w-[560px] rounded-xl border border-[#3a3a3a] bg-[#181818] p-4 shadow-2xl">
                        <div className="mb-3 flex items-center justify-between">
                            <div className="text-sm font-semibold">导入分镜截图</div>
                            <button type="button" className="text-sm text-[#9c9c9c]" onClick={() => setImportOpen(false)}>×</button>
                        </div>
                        <div ref={importDialogRef} tabIndex={0} className="rounded-lg border border-dashed border-[#4a4a4a] bg-[#101010] p-5 text-center text-xs text-[#bdbdbd] outline-none focus:border-[#2f80ff]">
                            <div>{importingScreenshot ? "已收到文件，正在识别..." : "截图后在这里按 Ctrl+V，或选择图片/TXT/MD/CSV 文件，识别后先预览"}</div>
                            {importError ? <div className="mt-3 text-[#ff8c8c]">{importError}</div> : null}
                            <label className="mt-3 block text-left text-[#9c9c9c]">
                                当前识别模型
                                <input className="mt-1 block w-full rounded border border-[#3a3a3a] bg-[#151515] px-2 py-1 text-[#f1f1f1] outline-none" value={importModel} onChange={(event) => setImportModel(event.target.value)} placeholder="留空使用当前文本模型" />
                            </label>
                            <textarea
                                ref={pasteTextRef}
                                data-storyboard-paste-zone
                                className="mt-3 block h-20 w-full resize-none rounded border border-[#3a3a3a] bg-[#151515] px-2 py-2 text-left text-[#f1f1f1] outline-none placeholder:text-[#6f6f6f]"
                                onMouseDown={(event) => event.stopPropagation()}
                                placeholder="也可以把 CSV、Tab 表格、JSON、中文冒号列表粘贴到这里"
                            />
                            <button type="button" className="mt-2 rounded-md border border-[#3a3a3a] px-3 py-1 text-[#f1f1f1] disabled:opacity-45" disabled={importingScreenshot} onClick={() => importText(pasteTextRef.current?.value || "")}>识别文本</button>
                            <button type="button" className="mt-3 rounded-md border border-[#3a3a3a] px-3 py-1 text-[#f1f1f1] disabled:opacity-45" disabled={importingScreenshot} onClick={() => fileInputRef.current?.click()}>选择图片/文本</button>
                        </div>
                        {importPreview ? (
                            <div className="mt-3 rounded-lg border border-[#343434] bg-[#101010] p-3 text-xs">
                                <div className="mb-2 text-[#bdbdbd]">{importPreview.rows.length ? `识别到 ${importPreview.rows.length} 行，确认后追加` : "没有解析出行，请看原始返回"}</div>
                                {importPreview.rows.length ? (
                                    <div className="thin-scrollbar max-h-32 overflow-auto">
                                        <table className="w-full border-collapse">
                                            <tbody>
                                                {importPreview.rows.slice(0, 5).map((row, index) => (
                                                    <tr key={index}>
                                                        <td className="border border-[#333] px-2 py-1 text-[#f1f1f1]">{row[0]}</td>
                                                        <td className="border border-[#333] px-2 py-1 text-[#f1f1f1]">{row[2] || row[1]}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                ) : null}
                                <details className="mt-2 text-[#9c9c9c]">
                                    <summary>模型原始返回前 300 字</summary>
                                    <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap rounded bg-black/30 p-2">{importPreview.raw.slice(0, 300)}</pre>
                                </details>
                            </div>
                        ) : null}
                        <div className="mt-4 flex justify-end gap-2">
                            <button type="button" className="rounded-md border border-[#3a3a3a] px-3 py-1 text-xs" onClick={() => setImportOpen(false)}>取消</button>
                            <button type="button" className="rounded-md bg-[#2f80ff] px-3 py-1 text-xs text-white disabled:opacity-45" disabled={!importPreview?.rows.length} onClick={confirmImportPreview}>确认追加</button>
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    );
}

function normalizeStoryboardRows(rows?: string[][]) {
    const source = rows?.length ? rows : [STORYBOARD_COLUMNS, ...Array.from({ length: 9 }, (_, index) => [`${index + 1}`, "5s", "", "", "", "", "", "", ""])];
    const body = source[0]?.join("|").includes("镜号") ? source.slice(1) : source;
    return renumberStoryboardRows(body.map((row, index) => STORYBOARD_COLUMNS.map((_, colIndex) => row[colIndex] || (colIndex === 0 ? `${index + 1}` : colIndex === 1 ? "5s" : ""))).slice(0, STORYBOARD_ROW_LIMIT));
}

function renumberStoryboardRows(rows: string[][]) {
    return rows.map((row, index) => STORYBOARD_COLUMNS.map((_, colIndex) => (colIndex === 0 ? String(index + 1).padStart(2, "0") : row[colIndex] || "")));
}

function storyboardRowsToMarkdown(rows: string[][]) {
    return [`| ${STORYBOARD_COLUMNS.join(" | ")} |`, `| ${STORYBOARD_COLUMNS.map(() => "---").join(" | ")} |`, ...rows.map((row) => `| ${STORYBOARD_COLUMNS.map((_, index) => (row[index] || "").replace(/\n/g, " ")).join(" | ")} |`)].join("\n");
}

function ImageNodeContent(props: NodeContentRendererProps) {
    if (!props.node.metadata?.content && props.isBatchRoot) {
        const content =
            props.node.metadata?.status === "loading" ? (
                <LoadingContent node={props.node} theme={props.theme} />
            ) : props.node.metadata?.status === "error" ? (
                <ErrorContent node={props.node} theme={props.theme} onRetry={props.onRetry} onEditPrompt={props.onEditPrompt} />
            ) : (
                <EmptyImageContent {...props} isBatchRoot={false} />
            );
        return (
            <BatchFrame batchCount={props.batchCount} batchExpanded={props.batchExpanded} batchOpening={props.batchOpening} batchRecovering={props.batchRecovering} onToggleBatch={props.onToggleBatch}>
                {content}
            </BatchFrame>
        );
    }
    if (!props.node.metadata?.content) return <EmptyImageContent {...props} />;

    return (
        <ImageContent
            node={props.node}
            isBatchRoot={props.isBatchRoot}
            batchCount={props.batchCount}
            batchExpanded={props.batchExpanded}
            batchOpening={props.batchOpening}
            batchRecovering={props.batchRecovering}
            onToggleBatch={props.onToggleBatch}
            onSetBatchPrimary={props.onSetBatchPrimary}
        />
    );
}

function EmptyImageContent({ theme, isBatchRoot, batchCount, batchExpanded, batchOpening, batchRecovering, onToggleBatch }: NodeContentRendererProps) {
    const content = (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3" style={{ color: theme.node.placeholder }}>
            <div className="flex size-14 items-center justify-center rounded-2xl" style={{ background: theme.toolbar.activeBg }}>
                <ImageIcon className="size-6 opacity-30" />
            </div>
            <span className="text-[10px] tracking-[0.18em] opacity-50">空图片节点</span>
        </div>
    );
    if (isBatchRoot)
        return (
            <BatchFrame batchCount={batchCount} batchExpanded={batchExpanded} batchOpening={batchOpening} batchRecovering={batchRecovering} onToggleBatch={onToggleBatch}>
                {content}
            </BatchFrame>
        );
    return content;
}

function VideoNodeContent({ node, theme, storyboardReferenceAssets, storyboardVideoResults, storyboardDurationSeconds, onMetadataChange, onRetry }: NodeContentRendererProps) {
    const globalConfig = useEffectiveConfig();
    const copyText = useCopyText();
    const [referenceEditorOpen, setReferenceEditorOpen] = useState(false);
    const [promptPreviewOpen, setPromptPreviewOpen] = useState(false);
    const [videoHistoryOpen, setVideoHistoryOpen] = useState(false);
    const isStoryboardVideo = node.metadata?.storyboardSourceNodeId && node.metadata?.storyboardRowIndex !== undefined;
    const isLoading = node.metadata?.status === "loading";
    const isError = node.metadata?.status === "error";
    const videoProgress = node.metadata?.videoGenerationProgress;
    const videoTaskId = node.metadata?.videoTaskId;
    const submittedModel = node.metadata?.videoTaskModel || node.metadata?.model || "";
    const submittedModelLabel = submittedModel ? modelOptionLabel(globalConfig, submittedModel) : "";
    const submittedModelCaption = videoTaskId ? "请求模型" : "当前生成模型";
    const requestAudit = buildVideoRequestAudit(node.metadata);
    const requestAuditPanel = requestAudit ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-[10px]" style={{ borderColor: theme.node.stroke, background: `${selectionBlue}08` }}>
            <div className="min-w-0 space-y-0.5 opacity-70">
                <div className="truncate font-mono" title={`${requestAudit.method} ${requestAudit.url}`}>请求：{requestAudit.method} {requestAudit.shortUrl}</div>
                <div className="truncate" title={`${requestAudit.model} · ${requestAudit.route} · ${requestAudit.submittedAt}`}>模型：{requestAudit.model} · 路由：{requestAudit.route}{requestAudit.submittedAt ? ` · ${requestAudit.submittedAt}` : ""}</div>
            </div>
            <button type="button" className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-1 hover:bg-white/10" title="复制视频请求信息" data-canvas-no-zoom onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); copyText(requestAudit.copyText, "视频请求信息已复制"); }}>
                <Copy className="size-3" />
                复制
            </button>
        </div>
    ) : null;
    const failureInfo = classifyVideoFailure(node.metadata?.errorDetails || "视频生成失败");
    const canQueryOriginalTask = Boolean(videoTaskId && ["timeout", "network", "unknown"].includes(failureInfo.kind));
    const [taskRecoveryOpen, setTaskRecoveryOpen] = useState(false);
    const [manualVideoTaskId, setManualVideoTaskId] = useState(videoTaskId || "");

    const openTaskRecovery = useCallback(() => {
        setManualVideoTaskId(videoTaskId || "");
        setTaskRecoveryOpen(true);
    }, [videoTaskId]);
    const submitTaskRecovery = useCallback(() => {
        const taskId = manualVideoTaskId.trim();
        if (!taskId) return;
        setTaskRecoveryOpen(false);
        onRetry?.(node, videoTaskQueryPatch(node, taskId));
    }, [manualVideoTaskId, node, onRetry]);
    const taskRecoveryModal = (
        <VideoTaskRecoveryModal
            open={taskRecoveryOpen}
            taskId={manualVideoTaskId}
            onChange={setManualVideoTaskId}
            onClose={() => setTaskRecoveryOpen(false)}
            onSubmit={submitTaskRecovery}
        />
    );

    useEffect(() => {
        const openPromptPreview = (event: Event) => {
            if ((event as CustomEvent<string>).detail === node.id) setPromptPreviewOpen(true);
        };
        window.addEventListener(STORYBOARD_VIDEO_PROMPT_PREVIEW_EVENT, openPromptPreview);
        return () => window.removeEventListener(STORYBOARD_VIDEO_PROMPT_PREVIEW_EVENT, openPromptPreview);
    }, [node.id]);

    if (!node.metadata?.content) {
        if (isStoryboardVideo) {
            const assetLinks = storyboardVideoAssetLinks(node);
            const assetPreviews = storyboardVideoAssetPreviews(node, assetLinks);
            const firstFrameSource = storyboardFirstFrameSourceText(assetPreviews);
            const sceneLockCount = assetPreviews.filter((item) => item.role === "sceneLock").length;
            const continuityText = firstFrameSource ? `首帧来自 ${firstFrameSource}` : (node.metadata?.storyboardRowIndex || 0) > 0 ? "未接入上一镜尾帧" : "";
            const boundCount = node.metadata?.storyboardAssetReferenceNodeIds?.length || assetLinks.filter((link) => link.status === "bound").length || 0;
            const missingCount = assetLinks.filter((link) => link.status === "missing").length;
            const statusText = isLoading ? videoGenerationStatusText(videoProgress) : isError ? "生成失败" : "待审核";
            const helperText = isError
                ? node.metadata?.errorDetails || "视频生成失败，请检查模型、参考图和提示词后重试"
                : isLoading
                  ? videoProgress?.text || "方舟视频任务会按官方示例每 30 秒查询一次，长时间停留在生成中通常是上游仍在排队或处理。"
                  : boundCount
                    ? `已绑定 ${boundCount} 个资产${missingCount ? `，${missingCount} 个未绑定` : ""}`
                    : missingCount
                      ? `${missingCount} 个资产未绑定，生成时不会传入图片`
                      : "未绑定资产";
            return (
                <div className="flex h-full w-full flex-col gap-3 overflow-hidden p-4 text-left" style={{ background: theme.node.fill, color: theme.node.text }}>
                    <div className="flex items-center justify-between gap-2">
                        <span className="rounded-full border px-2 py-0.5 text-[11px] font-semibold" style={{ borderColor: theme.node.stroke }}>
                            第 {(node.metadata?.storyboardRowIndex || 0) + 1} 镜
                        </span>
                        <span className="text-[11px] opacity-55">{statusText}</span>
                    </div>
                    <div className="min-h-0 flex-1 overflow-hidden rounded-lg border px-3 py-2.5" style={{ borderColor: theme.node.stroke, background: `${selectionBlue}08` }}>
                        <div className="line-clamp-4 whitespace-pre-wrap text-xs leading-5 opacity-90">{renderStoryboardPromptMentions(node.metadata?.prompt || "等待写入视频提示词", assetLinks, theme)}</div>
                        {isLoading ? <div className="mt-3"><VideoGenerationProgressBar progress={videoProgress} theme={theme} /></div> : null}
                        {isError ? <StoryboardVideoErrorSummary text={helperText} theme={theme} /> : null}
                    </div>
                    <div className="space-y-2">
                        <StoryboardAssetPreviewStrip items={assetPreviews} />
                        {sceneLockCount ? <div className="inline-flex w-fit rounded bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">场景锁定 {sceneLockCount} 张</div> : null}
                        {continuityText ? <div className={`inline-flex w-fit rounded px-2 py-0.5 text-[10px] font-semibold ${firstFrameSource ? "bg-blue-500/15 text-blue-300" : "bg-amber-500/15 text-amber-300"}`}>{continuityText}</div> : null}
                        {submittedModelLabel ? <div className="truncate text-[10px] opacity-55" title={submittedModelLabel}>{submittedModelCaption}：{submittedModelLabel}</div> : null}
                        {requestAuditPanel}
                        <div className="flex items-center justify-between gap-3 text-[11px] opacity-65">
                            <span className="min-w-0 truncate">{isError ? failureInfo.advice : helperText}</span>
                            <div className="flex shrink-0 items-center gap-1.5">
                                {storyboardVideoResults.length ? (
                                    <button type="button" className="rounded px-1.5 py-0.5 font-semibold text-[#2f80ff] hover:bg-white/10" data-canvas-no-zoom onMouseDown={(event) => event.stopPropagation()} onClick={() => setVideoHistoryOpen(true)}>
                                        所有视频 {storyboardVideoResults.length}
                                    </button>
                                ) : null}
                                <button type="button" className="rounded px-1.5 py-0.5 hover:bg-white/10" data-canvas-no-zoom onMouseDown={(event) => event.stopPropagation()} onClick={() => setPromptPreviewOpen(true)}>
                                    查看提示词
                                </button>
                                <button type="button" className="rounded px-1.5 py-0.5 hover:bg-white/10" data-canvas-no-zoom onMouseDown={(event) => event.stopPropagation()} onClick={() => setReferenceEditorOpen(true)}>
                                    编辑参考
                                </button>
                                {videoTaskId ? <span className="max-w-[180px] truncate rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px]" title={videoTaskId}>{videoTaskId}</span> : null}
                                {isError && canQueryOriginalTask ? (
                                    <button
                                        type="button"
                                        className="rounded px-1.5 py-0.5 hover:bg-white/10"
                                        data-canvas-no-zoom
                                        onMouseDown={(event) => event.stopPropagation()}
                                        onClick={() => onRetry?.(node, videoTaskQueryPatch(node))}
                                    >
                                        查询原任务
                                    </button>
                                ) : null}
                                {isError ? (
                                    <button type="button" className="rounded px-1.5 py-0.5 font-semibold text-[#2f80ff] hover:bg-white/10" data-canvas-no-zoom onMouseDown={(event) => event.stopPropagation()} onClick={() => onRetry?.(node)}>
                                        {failureInfo.kind === "policy_rejected" ? "修改后重试" : "重新生成"}
                                    </button>
                                ) : null}
                                {isError && !videoTaskId ? (
                                    <button type="button" className="rounded px-1.5 py-0.5 hover:bg-white/10" data-canvas-no-zoom onMouseDown={(event) => event.stopPropagation()} onClick={openTaskRecovery}>
                                        填写任务ID
                                    </button>
                                ) : null}
                            </div>
                        </div>
                        <StoryboardVideoPromptPreviewModal
                            node={node}
                            open={promptPreviewOpen}
                            references={assetPreviews}
                            scriptReferences={storyboardReferenceAssets}
                            storyboardDurationSeconds={storyboardDurationSeconds}
                            assetLinks={assetLinks}
                            theme={theme}
                            onClose={() => setPromptPreviewOpen(false)}
                            onConfigChange={(patch) => onMetadataChange(node.id, patch)}
                            onGenerate={(patch) => onRetry?.(node, patch)}
                        />
                        <StoryboardVideoHistoryModal node={node} open={videoHistoryOpen} results={storyboardVideoResults} theme={theme} onClose={() => setVideoHistoryOpen(false)} />
                        <StoryboardVideoReferenceEditor node={node} open={referenceEditorOpen} references={assetPreviews} scriptReferences={storyboardReferenceAssets} onClose={() => setReferenceEditorOpen(false)} onSave={(references) => onMetadataChange(node.id, storyboardVideoReferenceSavePatch(node, references))} />
                        {taskRecoveryModal}
                    </div>
                </div>
            );
        }
        if (isLoading) {
            return (
                <div className="flex h-full w-full flex-col justify-center gap-4 p-5" style={{ background: theme.node.fill, color: theme.node.text }}>
                    <div className="flex items-center gap-2">
                        <Video className="size-5 opacity-55" />
                        <span className="text-sm font-semibold">{videoGenerationStatusText(videoProgress)}</span>
                    </div>
                    <VideoGenerationProgressBar progress={videoProgress} theme={theme} />
                    {submittedModelLabel ? <div className="truncate text-[10px] opacity-55" title={submittedModelLabel}>{submittedModelCaption}：{submittedModelLabel}</div> : null}
                    {videoTaskId ? <div className="truncate font-mono text-[10px] opacity-55" title={videoTaskId}>任务ID：{videoTaskId}</div> : null}
                    {requestAuditPanel}
                    {!videoTaskId ? (
                        <button
                            type="button"
                            className="inline-flex h-8 w-fit items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition hover:scale-[1.02]"
                            style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
                            onClick={(event) => {
                                event.stopPropagation();
                                openTaskRecovery();
                            }}
                            onMouseDown={(event) => event.stopPropagation()}
                        >
                            填写任务ID查询
                        </button>
                    ) : null}
                    {taskRecoveryModal}
                </div>
            );
        }
        if (isError) {
            return (
                <div className="flex h-full w-full flex-col justify-center gap-3 p-5" style={{ background: theme.node.fill, color: theme.node.text }}>
                    <div className="flex items-center gap-2 text-red-300">
                        <AlertTriangle className="size-4" />
                        <span className="text-sm font-semibold">{failureInfo.kind === "network" ? "生成未接回" : "生成失败"}</span>
                    </div>
                    <div className="line-clamp-4 text-xs leading-5 opacity-75">{node.metadata?.errorDetails || "视频生成中断，可用任务 ID 查询平台结果。"}</div>
                    <div className="text-[11px] opacity-55">{failureInfo.label}：{failureInfo.advice}</div>
                    {submittedModelLabel ? <div className="truncate text-[10px] opacity-55" title={submittedModelLabel}>{submittedModelCaption}：{submittedModelLabel}</div> : null}
                    {videoTaskId ? <div className="truncate font-mono text-[10px] opacity-55" title={videoTaskId}>任务ID：{videoTaskId}</div> : null}
                    {requestAuditPanel}
                    <div className="flex flex-wrap gap-2">
                        {canQueryOriginalTask ? (
                            <button type="button" className="inline-flex h-8 w-fit items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition hover:scale-[1.02]" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }} onClick={(event) => { event.stopPropagation(); onRetry?.(node, videoTaskQueryPatch(node)); }} onMouseDown={(event) => event.stopPropagation()}>
                                <RefreshCw className="size-3.5" />
                                查询原任务
                            </button>
                        ) : null}
                        <button type="button" className="inline-flex h-8 w-fit items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition hover:scale-[1.02]" style={{ background: theme.node.fill, borderColor: theme.toolbar.border, color: theme.node.text }} onClick={(event) => { event.stopPropagation(); onRetry?.(node); }} onMouseDown={(event) => event.stopPropagation()}>
                            <Video className="size-3.5" />
                            {failureInfo.kind === "policy_rejected" ? "修改后重新生成" : "重新生成"}
                        </button>
                    </div>
                    {!videoTaskId ? (
                        <button
                            type="button"
                            className="inline-flex h-8 w-fit items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition hover:scale-[1.02]"
                            style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
                            onClick={(event) => {
                                event.stopPropagation();
                                openTaskRecovery();
                            }}
                            onMouseDown={(event) => event.stopPropagation()}
                        >
                            填写任务ID
                        </button>
                    ) : null}
                    {taskRecoveryModal}
                </div>
            );
        }
        return (
            <div className="flex h-full w-full flex-col items-center justify-center gap-3" style={{ color: theme.node.placeholder }}>
                <Video className="size-7 opacity-35" />
                <span className="text-sm">空视频节点</span>
                <button type="button" className="rounded px-2 py-1 text-xs hover:bg-white/10" data-canvas-no-zoom onMouseDown={(event) => event.stopPropagation()} onClick={openTaskRecovery}>
                    填写任务ID恢复
                </button>
                {taskRecoveryModal}
            </div>
        );
    }
    return <video src={node.metadata.content} controls className="h-full w-full rounded-[18px] bg-black object-contain" data-canvas-no-zoom />;
}

function VideoTaskRecoveryModal({ open, taskId, onChange, onClose, onSubmit }: { open: boolean; taskId: string; onChange: (value: string) => void; onClose: () => void; onSubmit: () => void }) {
    return (
        <Modal title={<CanvasModalTitle title="查询视频任务" onClose={onClose} />} open={open} onCancel={onClose} footer={null} width={460} destroyOnHidden closable={false} modalRender={renderCanvasModal}>
            <div className="space-y-3">
                <div className="text-xs leading-5 opacity-65">平台已显示成功但画布没有接回时，粘贴平台任务 ID 查询已有结果，不会重新提交生成任务。</div>
                <Input autoFocus value={taskId} placeholder="例如 task_xxx" onChange={(event) => onChange(event.target.value)} onPressEnter={onSubmit} />
                <div className="flex justify-end gap-2">
                    <Button onClick={onClose}>取消</Button>
                    <Button type="primary" disabled={!taskId.trim()} onClick={onSubmit}>
                        查询结果
                    </Button>
                </div>
            </div>
        </Modal>
    );
}

function StoryboardVideoHistoryModal({ node, open, results, theme, onClose }: { node: CanvasNodeData; open: boolean; results: CanvasNodeData[]; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; onClose: () => void }) {
    const latestId = node.metadata?.storyboardVideoLatestResultNodeId;
    const sorted = [...results].sort((a, b) => (b.metadata?.storyboardVideoVariantIndex || 0) - (a.metadata?.storyboardVideoVariantIndex || 0));
    useStoryboardModalOutsideClose(open, onClose);
    return (
        <Modal title={<CanvasModalTitle title={`第 ${(node.metadata?.storyboardRowIndex || 0) + 1} 镜所有视频`} onClose={onClose} />} open={open} onCancel={onClose} footer={null} width={860} destroyOnHidden closable={false} modalRender={renderCanvasModal}>
            {sorted.length ? (
                <div className="grid max-h-[68vh] grid-cols-1 gap-3 overflow-y-auto pr-1 md:grid-cols-2">
                    {sorted.map((item) => {
                        const isLatest = item.id === latestId;
                        return (
                            <div key={item.id} className="overflow-hidden rounded-lg border" style={{ borderColor: isLatest ? selectionBlue : theme.node.stroke, background: theme.node.fill, color: theme.node.text }}>
                                <div className="relative aspect-video bg-black">
                                    {item.metadata?.content ? <video src={item.metadata.content} controls className="h-full w-full object-contain" data-canvas-no-zoom /> : <div className="flex h-full items-center justify-center text-xs text-stone-400">{item.metadata?.status === "loading" ? "生成中" : "暂无视频"}</div>}
                                    {isLatest ? <span className="absolute left-2 top-2 rounded bg-[#2f80ff] px-2 py-0.5 text-[10px] font-semibold text-white">最新</span> : null}
                                </div>
                                <div className="space-y-1 px-3 py-2 text-xs">
                                    <div className="flex items-center justify-between gap-3">
                                        <span className="font-semibold">版本 {item.metadata?.storyboardVideoVariantIndex || "-"}</span>
                                        <span className="opacity-55">{item.metadata?.model || "未记录模型"}</span>
                                    </div>
                                    <div className="line-clamp-2 opacity-65">{item.metadata?.storyboardVideoFinalPrompt || item.metadata?.prompt || "暂无提示词"}</div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无视频版本" />
            )}
        </Modal>
    );
}

function StoryboardVideoErrorSummary({ text, theme }: { text: string; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    const failure = classifyVideoFailure(text);
    return (
        <div className="mt-3 flex min-h-0 gap-2 rounded-lg border px-2.5 py-2 text-[11px] leading-5 text-red-200" style={{ borderColor: "rgba(248, 113, 113, .35)", background: "rgba(248, 113, 113, .12)", boxShadow: `inset 0 0 0 1px ${theme.node.fill}` }}>
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <div className="min-w-0">
                <div className="font-semibold">{failure.label}</div>
                <div className="line-clamp-5 whitespace-pre-wrap" title={text}>
                    {text}
                </div>
                <div className="mt-1 opacity-75">{failure.advice}</div>
            </div>
        </div>
    );
}

function videoTaskQueryPatch(node: CanvasNodeData, taskId = node.metadata?.videoTaskId || ""): Partial<CanvasNodeMetadata> {
    return {
        videoTaskId: taskId,
        videoTaskProvider: node.metadata?.videoTaskProvider,
        videoTaskModel: node.metadata?.videoTaskModel || node.metadata?.model,
        videoTaskEndpoint: node.metadata?.videoTaskEndpoint,
        status: "loading",
        errorDetails: undefined,
        videoGenerationProgress: undefined,
    };
}

function buildVideoRequestAudit(metadata?: CanvasNodeMetadata) {
    if (!metadata?.videoTaskId) return null;
    const method = metadata.videoTaskRequestMethod || "POST";
    const url = metadata.videoTaskRequestUrl || fallbackVideoTaskRequestUrl(metadata);
    const model = metadata.videoTaskRequestModel || modelOptionName(metadata.videoTaskModel || metadata.model || "") || "未记录";
    const route = metadata.videoTaskProvider === "cangyuan" ? "沧元视频" : metadata.videoTaskProvider === "seedance" ? "方舟 Seedance" : "OpenAI 兼容视频";
    const submittedAt = formatVideoTaskSubmittedAt(metadata.videoTaskSubmittedAt);
    const fields = metadata.videoTaskRequestFields?.join(", ") || "未记录（旧任务）";
    return {
        method,
        url,
        shortUrl: shortVideoTaskRequestUrl(url),
        model,
        route,
        submittedAt,
        copyText: [`任务 ID：${metadata.videoTaskId}`, `提交时间：${submittedAt || "未记录"}`, `前端路由：${route}`, `请求：${method} ${url}`, `请求模型：${model}`, `请求字段：${fields}`].join("\n"),
    };
}

function fallbackVideoTaskRequestUrl(metadata: CanvasNodeMetadata) {
    if (metadata.videoTaskProvider === "seedance") return "/api/v3/contents/generations/tasks";
    return metadata.videoTaskEndpoint === "video-generations" ? "/v1/video/generations" : "/v1/videos";
}

function shortVideoTaskRequestUrl(value: string) {
    try {
        return new URL(value).pathname;
    } catch {
        return value;
    }
}

function formatVideoTaskSubmittedAt(value?: string) {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

function VideoGenerationProgressBar({ progress, theme }: { progress?: CanvasNodeMetadata["videoGenerationProgress"]; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    const percent = Math.max(8, Math.min(98, Math.round(progress?.percent || 8)));
    return (
        <div className="space-y-1.5 rounded-lg border px-2.5 py-2" style={{ borderColor: theme.node.stroke, background: `${selectionBlue}10` }}>
            <div className="flex items-center justify-between gap-3 text-[11px]">
                <span className="min-w-0 truncate font-semibold">{progress?.text || "正在提交视频任务"}</span>
                <span className="shrink-0 tabular-nums opacity-70">{percent}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full" style={{ background: `${selectionBlue}22` }}>
                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${percent}%`, background: selectionBlue }} />
            </div>
            <div className="text-[10px] opacity-55">{progress?.providerStatus ? `接口状态：${videoProviderStatusLabel(progress.providerStatus)}` : "阶段进度，非接口真实百分比"}</div>
        </div>
    );
}

function videoGenerationStatusText(progress?: CanvasNodeMetadata["videoGenerationProgress"]) {
    if (progress?.stage === "queued") return "排队中";
    if (progress?.stage === "saving") return "保存中";
    if (progress?.stage === "failed") return "生成失败";
    if (progress?.providerStatus) return videoProviderStatusLabel(progress.providerStatus);
    return "生成中";
}

function videoProviderStatusLabel(status: string) {
    if (status === "retry_wait") return "等待自动重试";
    if (status === "poll_retry") return "查询中断，正在重试";
    if (status === "queued") return "排队中";
    if (status === "running" || status === "in_progress" || status === "processing") return "生成中";
    if (status === "succeeded" || status === "completed") return "已完成";
    if (status === "failed") return "失败";
    if (status === "cancelled") return "已取消";
    if (status === "expired") return "已超时";
    return status;
}

function storyboardVideoAssetLinks(node: CanvasNodeData): StoryboardAssetMentionLink[] {
    const custom = node.metadata?.storyboardVideoReferences || [];
    if (custom.length) return custom;
    const links = node.metadata?.storyboardAssetMentionLinks || [];
    if (links.length) return links;
    return (node.metadata?.storyboardAssetMentions || []).map((mention) => ({
        mention,
        name: mention.replace(/^@/, ""),
        status: "bound" as const,
    }));
}

function storyboardVideoAssetPreviews(node: CanvasNodeData, links: StoryboardAssetMentionLink[]): StoryboardVideoReference[] {
    const custom = node.metadata?.storyboardVideoReferences || [];
    if (custom.length) return custom;
    const references = (node.metadata?.references || []).filter(Boolean);
    if (!links.length) return references.map((url, index) => ({ mention: `参考资产 ${index + 1}`, name: `参考资产 ${index + 1}`, status: "bound" as const, role: "reference" as const, url }));
    let referenceIndex = 0;
    return links.map((link) => {
        const url = link.status === "bound" ? references[referenceIndex++] : undefined;
        return { ...link, role: "reference" as const, storageKey: url?.startsWith("image:") ? url : undefined, url: url?.startsWith("image:") ? undefined : url };
    });
}

function renderStoryboardPromptMentions(text: string, links: StoryboardAssetMentionLink[], theme: (typeof canvasThemes)[keyof typeof canvasThemes]) {
    const mentions = Array.from(new Set([...links.map((link) => link.mention), ...Array.from(text.matchAll(/@([^\s@，,、。；;：:）)】\]]+)/g)).map((match) => `@${match[1]}`)])).filter(Boolean).sort((a, b) => b.length - a.length);
    if (!mentions.length) return text;
    const linkByMention = new Map(links.map((link) => [link.mention, link]));
    const parts: ReactNode[] = [];
    let index = 0;
    while (index < text.length) {
        const next = mentions
            .map((mention) => ({ mention, at: text.indexOf(mention, index) }))
            .filter((item) => item.at >= 0)
            .sort((a, b) => a.at - b.at || b.mention.length - a.mention.length)[0];
        if (!next) {
            parts.push(text.slice(index));
            break;
        }
        if (next.at > index) parts.push(text.slice(index, next.at));
        parts.push(<StoryboardAssetChip key={`${next.mention}-${next.at}`} link={linkByMention.get(next.mention) || { mention: next.mention, name: next.mention.replace(/^@/, ""), status: "missing" }} inline theme={theme} />);
        index = next.at + next.mention.length;
    }
    return parts;
}

function StoryboardAssetChip({ link, inline, compact, theme }: { link: StoryboardAssetMentionLink; inline?: boolean; compact?: boolean; theme?: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    const bound = link.status === "bound";
    return (
        <span
            title={bound ? `已绑定到资产节点：${link.name}` : "未绑定，请先生成资产或检查名称"}
            className={`inline-flex max-w-full items-center rounded-md border font-semibold ${inline ? "mx-0.5 translate-y-[-1px] align-baseline" : ""} ${compact ? "px-1.5 py-0.5 text-[10px] leading-4" : "px-2 py-0.5 text-[11px] leading-5"}`}
            style={{
                borderColor: bound ? selectionBlue : "#f59e0b",
                background: bound ? `${selectionBlue}22` : "rgba(245, 158, 11, .14)",
                color: bound ? selectionBlue : "#fbbf24",
                boxShadow: inline && bound ? `0 0 0 1px ${theme?.node.fill || "transparent"}` : undefined,
            }}
        >
            <span className="truncate">{link.mention}</span>
            {!inline ? <span className="ml-1 opacity-70">{bound ? "已绑定" : "未绑定"}</span> : null}
        </span>
    );
}

function StoryboardAssetPreviewStrip({ items }: { items: StoryboardVideoReference[] }) {
    if (!items.length) return <span className="text-[11px] opacity-55">未引用资产</span>;
    const ordered = sortStoryboardVideoReferences(items);
    return (
        <div className="space-y-1.5">
            <div className="text-[10px] font-semibold tracking-[0.14em] opacity-50">参考资产</div>
            <div className="flex gap-1.5 overflow-hidden">
                {ordered.slice(0, 5).map((item) => (
                    <div key={item.mention} title={storyboardReferenceTitle(item)} className="group relative h-12 w-12 shrink-0 overflow-hidden rounded-lg border" style={{ borderColor: item.status === "bound" ? storyboardReferenceRoleColor(item.role) : "#f59e0b", background: item.status === "bound" ? `${selectionBlue}1a` : "rgba(245, 158, 11, .12)" }}>
                        {item.url || item.storageKey ? <StoryboardAssetPreviewImage src={item.storageKey || item.url || ""} alt={item.name || item.mention} /> : <div className="flex h-full w-full items-center justify-center px-1 text-center text-[10px] leading-3 text-amber-200">未绑定</div>}
                        <div className={`absolute left-0.5 top-0.5 rounded px-1 text-[9px] font-semibold text-white ${storyboardReferenceRoleBadgeClass(item.role)}`}>{STORYBOARD_VIDEO_REFERENCE_ROLE_TEXT[item.role || "reference"]}</div>
                        <div className="absolute inset-x-0 bottom-0 truncate bg-black/70 px-1 py-0.5 text-[9px] font-semibold text-white">{item.mention}</div>
                    </div>
                ))}
                {items.length > 5 ? <div className="flex h-12 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 text-[10px] opacity-60">+{items.length - 5}</div> : null}
            </div>
        </div>
    );
}

function storyboardReferenceRoleColor(role?: StoryboardVideoReferenceRole) {
    if (role === "firstFrame") return "#38bdf8";
    if (role === "sceneLock") return "#22c55e";
    if (role === "lastFrame") return "#a855f7";
    return selectionBlue;
}

function storyboardReferenceRoleBadgeClass(role?: StoryboardVideoReferenceRole) {
    if (role === "firstFrame") return "bg-sky-500/90";
    if (role === "sceneLock") return "bg-emerald-500/90";
    if (role === "lastFrame") return "bg-fuchsia-500/90";
    return "bg-black/70";
}

function storyboardFirstFrameSourceText(items: StoryboardVideoReference[]) {
    const firstFrame = sortStoryboardVideoReferences(items).find((item) => item.role === "firstFrame" && item.mention.includes("尾帧"));
    return firstFrame ? firstFrame.mention.replace(/^@/, "") : "";
}

function storyboardReferenceTitle(item: StoryboardVideoReference) {
    const role = STORYBOARD_VIDEO_REFERENCE_ROLE_TEXT[item.role || "reference"];
    const status = item.status === "bound" ? "已绑定" : "未绑定";
    return `${role}｜${item.mention} ${status}${item.role === "firstFrame" && item.mention.includes("尾帧") ? "，将作为本镜头起始画面" : ""}${item.role === "sceneLock" ? "，用于锁定同一地点的空间结构和光线" : ""}`;
}

function storyboardReferenceStatusText(item: StoryboardVideoReference) {
    if (item.status !== "bound") return "未绑定，生成时不会传入图片";
    if (item.role === "firstFrame" && item.mention.includes("尾帧")) return `作为首帧传入：${item.mention.replace(/^@/, "")}`;
    if (item.role === "firstFrame") return "已作为首帧参考图传入";
    if (item.role === "sceneLock") return "已作为场景锁定参考图传入";
    if (item.role === "lastFrame") return "已作为尾帧参考图传入";
    return "已作为参考图传入";
}

function isStoryboardTailFrameReference(item: StoryboardVideoReference) {
    return item.role === "firstFrame" && item.mention.includes("尾帧");
}

function StoryboardAssetPreviewImage({ src, alt }: { src: string; alt: string }) {
    const [resolvedSrc, setResolvedSrc] = useState(src.startsWith("image:") ? "" : src);

    useEffect(() => {
        let cancelled = false;
        if (!src.startsWith("image:")) {
            setResolvedSrc(src);
            return;
        }
        void resolveImageUrl(src, "").then((url) => {
            if (!cancelled) setResolvedSrc(url);
        });
        return () => {
            cancelled = true;
        };
    }, [src]);

    if (!resolvedSrc) return <div className="flex h-full w-full items-center justify-center text-[10px] text-white/50">加载中</div>;
    return <img src={resolvedSrc} alt={alt} className="h-full w-full object-cover" />;
}

function CanvasModalTitle({ title, onClose }: { title: string; onClose: () => void }) {
    return (
        <div className="flex items-center justify-between gap-3">
            <span className="min-w-0 truncate">{title}</span>
            <button
                type="button"
                className="grid size-8 shrink-0 place-items-center rounded-lg text-stone-400 transition hover:bg-white/10 hover:text-white"
                aria-label="关闭"
                data-canvas-no-zoom
                onPointerDown={(event) => {
                    event.stopPropagation();
                }}
                onMouseDown={(event) => {
                    event.stopPropagation();
                }}
                onClick={(event) => {
                    event.stopPropagation();
                    onClose();
                }}
            >
                <X className="size-4" />
            </button>
        </div>
    );
}

function isCanvasModalInnerTarget(target: EventTarget | null) {
    if (!(target instanceof Element)) return false;
    return Boolean(target.closest(".ant-modal, .ant-select-dropdown, .ant-dropdown, .ant-picker-dropdown, .ant-popover, [data-canvas-resource-mention-menu='true']"));
}

function useStoryboardModalOutsideClose(open: boolean, onClose: () => void) {
    useEffect(() => {
        if (!open) return;
        const handlePointerDown = (event: PointerEvent) => {
            if (!isCanvasModalInnerTarget(event.target)) onClose();
        };
        document.addEventListener("pointerdown", handlePointerDown, true);
        return () => document.removeEventListener("pointerdown", handlePointerDown, true);
    }, [open, onClose]);
}

function renderCanvasModal(modal: ReactNode) {
    const stop = (event: React.SyntheticEvent) => event.stopPropagation();
    return (
        <div data-canvas-no-zoom onPointerDown={stop} onMouseDown={stop} onClick={stop} onWheel={stop}>
            {modal}
        </div>
    );
}

function StoryboardVideoPromptPreviewModal({
    node,
    open,
    references,
    scriptReferences,
    storyboardDurationSeconds,
    assetLinks,
    theme,
    onClose,
    onConfigChange,
    onGenerate,
}: {
    node: CanvasNodeData;
    open: boolean;
    references: StoryboardVideoReference[];
    scriptReferences: StoryboardVideoReference[];
    storyboardDurationSeconds?: string;
    assetLinks: StoryboardAssetMentionLink[];
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    onClose: () => void;
    onConfigChange: (patch: Partial<CanvasNodeMetadata>) => void;
    onGenerate: (patch: Partial<CanvasNodeMetadata>) => void;
}) {
    useStoryboardModalOutsideClose(open, onClose);
    const globalConfig = useEffectiveConfig();
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const assets = useAssetStore((state) => state.assets);
    const imageAssets = assets.filter((asset): asset is ImageAsset => asset.kind === "image");
    const prompt = node.metadata?.prompt || "";
    const audioReferences = node.metadata?.storyboardVideoAudioReferences || [];
    const audioContinuityPrompt = storyboardVideoAudioContinuityPrompt(audioReferences);
    const autoFinalPrompt = storyboardVideoFinalPrompt(prompt, references, audioReferences);
    const storedFinalPrompt = node.metadata?.storyboardVideoFinalPrompt || "";
    const migratedFinalPrompt = storedFinalPrompt ? storyboardVideoFinalPrompt(stripStoryboardVideoAudioContinuityPrompt(stripStoryboardVideoFrameContinuityPrompt(storedFinalPrompt)), references, audioReferences) : autoFinalPrompt;
    const [draftConfig, setDraftConfig] = useState(() => buildStoryboardVideoNodeConfig(globalConfig, node));
    const draftConfigRef = useRef(draftConfig);
    const [draftFinalPrompt, setDraftFinalPrompt] = useState(migratedFinalPrompt);
    const [draftReferences, setDraftReferences] = useState<StoryboardVideoReference[]>(() => references);
    const [promptExpanded, setPromptExpanded] = useState(false);
    const referenceCandidates = storyboardReferenceAssetCandidates(references, scriptReferences, imageAssets);
    const continuityPrompt = storyboardVideoFrameContinuityPrompt(draftReferences, draftFinalPrompt);
    const draftAssetLinks = draftReferences.map(storyboardReferenceToMentionLink);
    const orderedReferences = sortStoryboardVideoReferences(draftReferences);
    const modalFirstFrameSource = storyboardFirstFrameSourceText(draftReferences);
    const mentionReferences = storyboardReferencesToCanvasResources([...referenceCandidates, ...draftReferences]);
    const missingContextReferences = storyboardMissingContextReferences(draftFinalPrompt, draftReferences, referenceCandidates);
    const credits = requestCreditCost({ channelMode: draftConfig.channelMode, model: draftConfig.model, count: 1 });
    const [saveHint, setSaveHint] = useState("");
    const [modalContentElement, setModalContentElement] = useState<HTMLDivElement | null>(null);
    const saveHintTimerRef = useRef<number | null>(null);
    const finalPromptTextareaRef = useRef<HTMLTextAreaElement | null>(null);
    const followsStoryboardDuration = draftConfig.videoSeconds === "-1";
    const currentVideoSeconds = followsStoryboardDuration ? storyboardDurationSeconds : draftConfig.videoSeconds || globalConfig.videoSeconds || defaultConfig.videoSeconds;

    useEffect(() => {
        if (!open) return;
        const nextConfig = buildStoryboardVideoNodeConfig(globalConfig, node);
        draftConfigRef.current = nextConfig;
        setDraftConfig(nextConfig);
        const stored = node.metadata?.storyboardVideoFinalPrompt || "";
        const migrated = stored ? storyboardVideoFinalPrompt(stripStoryboardVideoAudioContinuityPrompt(stripStoryboardVideoFrameContinuityPrompt(stored)), references, audioReferences) : storyboardVideoFinalPrompt(node.metadata?.prompt || "", references, audioReferences);
        setDraftFinalPrompt(migrated);
        if (migrated !== stored && migrated.trim()) onConfigChange(storyboardVideoConfigPatch(nextConfig, prompt, migrated));
        setDraftReferences(references);
        setSaveHint("");
    }, [open, node.id]);

    useEffect(() => {
        return () => {
            if (saveHintTimerRef.current) window.clearTimeout(saveHintTimerRef.current);
        };
    }, []);

    const markAutoSaved = () => {
        setSaveHint("已自动保存");
        if (saveHintTimerRef.current) window.clearTimeout(saveHintTimerRef.current);
        saveHintTimerRef.current = window.setTimeout(() => setSaveHint(""), 1800);
    };

    const saveDraft = (config: AiConfig, finalPrompt: string, nextReferences = draftReferences, configCustomized = false, finalPromptCustomized = false) => {
        onConfigChange({ ...storyboardVideoReferencePatch(nextReferences), ...storyboardVideoConfigPatch(config, prompt, finalPrompt.trim()), ...(configCustomized ? { storyboardVideoConfigCustomized: true } : {}), ...(finalPromptCustomized ? { storyboardVideoFinalPromptCustomized: true } : {}) });
        markAutoSaved();
    };

    const updateDraftConfig = (patch: Partial<AiConfig>) => {
        setDraftConfig((current) => {
            const next = { ...current, ...patch };
            draftConfigRef.current = next;
            saveDraft(next, draftFinalPrompt, draftReferences, true);
            return next;
        });
    };

    const updateDraftModel = (model: string) => {
        if (isOmniImageVideoModel(model) || isOmniVideoToVideoModel(model)) {
            updateDraftConfig({ model, vquality: "720p", videoSeconds: "10", size: "16:9" });
            return;
        }
        if (isSoraVideoModel(model)) {
            updateDraftConfig({ model, videoSeconds: "8", size: "16:9" });
            return;
        }
        if (isVeoVideoModel(model)) {
            updateDraftConfig({ model, vquality: "1080p", videoSeconds: "8", size: "16:9" });
            return;
        }
        if (isSeedanceMini8sModel(model)) {
            updateDraftConfig({ model, vquality: "720p", videoSeconds: "8" });
            return;
        }
        const fixedResolution = seedanceModelFixedResolution(model);
        updateDraftConfig(fixedResolution ? { model, vquality: fixedResolution } : { model });
    };

    const updateDraftFinalPrompt = (value: string) => {
        setDraftFinalPrompt(value);
        saveDraft(draftConfig, value, draftReferences, false, true);
    };

    const toggleReference = (reference: StoryboardVideoReference) => {
        const selected = draftReferences.some((item) => item.mention === reference.mention);
        const nextReferences = selected ? draftReferences.filter((item) => item.mention !== reference.mention) : dedupeStoryboardReferences([...draftReferences, { ...storyboardPinnedReference(reference), role: reference.role || "reference", status: "bound" }]);
        setDraftReferences(nextReferences);
        let nextPrompt = draftFinalPrompt;
        const textarea = finalPromptTextareaRef.current;
        const start = textarea?.selectionStart ?? draftFinalPrompt.length;
        const end = textarea?.selectionEnd ?? start;
        const inserted = !selected && !draftFinalPrompt.includes(reference.mention) ? insertStoryboardMention(draftFinalPrompt, reference.mention, start, end) : null;
        if (inserted) nextPrompt = inserted.value;
        nextPrompt = storyboardVideoFinalPrompt(stripStoryboardVideoAudioContinuityPrompt(stripStoryboardVideoFrameContinuityPrompt(nextPrompt)), nextReferences, audioReferences);
        setDraftFinalPrompt(nextPrompt);
        saveDraft(draftConfig, nextPrompt, nextReferences);
        if (inserted) requestAnimationFrame(() => {
            finalPromptTextareaRef.current?.focus();
            finalPromptTextareaRef.current?.setSelectionRange(inserted.cursor, inserted.cursor);
        });
    };

    const generate = () => {
        const patch = { ...storyboardVideoReferencePatch(draftReferences), ...storyboardVideoConfigPatch(draftConfigRef.current, prompt, draftFinalPrompt.trim()) };
        onConfigChange(patch);
        onGenerate(patch);
        onClose();
    };

    return (
        <Modal
            className="storyboard-video-prompt-modal"
            title={<CanvasModalTitle title={`第 ${(node.metadata?.storyboardRowIndex || 0) + 1} 镜最终提交提示词`} onClose={onClose} />}
            open={open}
            onCancel={onClose}
            footer={null}
            mask={{ closable: true }}
            keyboard
            width={900}
            centered
            destroyOnHidden
            closable={false}
            modalRender={renderCanvasModal}
            styles={{
                wrapper: { overflow: "hidden" },
                container: { height: "min(92dvh, 900px)", display: "flex", flexDirection: "column" },
                header: { flex: "none" },
                body: { minHeight: 0, flex: 1, display: "flex", flexDirection: "column" },
            }}
        >
            <div ref={setModalContentElement} className="flex min-h-0 flex-1 flex-col" data-canvas-no-zoom onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
                <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto pb-4 pr-2">
                    <div className="space-y-5">
                        <div className="rounded-xl border border-blue-500/25 bg-blue-500/10 px-3 py-2 text-xs leading-5 text-blue-600 dark:text-blue-200">
                            卡片上方只是截断预览；点击这里的“生成视频”时，以本页最终提交提示词和下方参考图数组为准。@ 名称用于绑定和识别资产，传给模型时会变成参考图 + 文本提示词。
                        </div>
                        {node.metadata?.storyboardPromptSource ? <div title={node.metadata.storyboardPromptSkillRoot || STORYBOARD_PROMPT_SOURCE_TEXT[node.metadata.storyboardPromptSource]} className={`rounded-xl border px-3 py-2 text-xs leading-5 ${node.metadata.storyboardPromptSource === "skill" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200" : node.metadata.storyboardPromptSource === "fallback" ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-200" : "border-stone-300 bg-stone-100 text-stone-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300"}`}>提示词来源：<span className="font-semibold">{STORYBOARD_PROMPT_SOURCE_TEXT[node.metadata.storyboardPromptSource]}</span>{node.metadata.storyboardPromptSource === "fallback" ? "，建议检查内容安全改写后再生成视频。" : ""}</div> : null}
                        <div className={`rounded-xl border px-3 py-2 text-xs leading-5 ${modalFirstFrameSource ? "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-200" : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-200"}`}>
                            {modalFirstFrameSource ? `当前首帧来自：${modalFirstFrameSource}` : (node.metadata?.storyboardRowIndex || 0) > 0 ? "当前未接入上一镜尾帧，可在“编辑参考”里手动添加上一镜尾帧。" : "第一镜通常不需要接入上一镜尾帧。"}
                        </div>
                <section className="rounded-xl border border-stone-200 bg-stone-50 p-3 dark:border-stone-700 dark:bg-stone-950/60">
                    <div className="mb-2 flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold">视频生成设置</div>
                        <span className={`text-xs ${saveHint ? "text-blue-500 dark:text-blue-300" : "text-stone-500"}`}>{saveHint || "修改会自动保存"}</span>
                    </div>
                    <div className="mb-2 rounded-xl border border-sky-500/20 bg-sky-500/5 px-3 py-2 text-xs leading-5 text-sky-700 dark:text-sky-200">
                        当前镜头时长：<span className="font-semibold">{currentVideoSeconds ? `${currentVideoSeconds}s` : "未读取到分镜时长"}</span>；{followsStoryboardDuration ? "来自分镜表当前镜头。" : "使用当前固定时长。"}
                    </div>
                    <div className="mb-2 text-[11px] text-stone-500 dark:text-stone-400">点击生成后会先在本地检查模型参数和参考素材，不调用额外 AI 接口。</div>
                    <div className="flex flex-wrap items-center gap-2">
                        <ModelPicker config={draftConfig} value={draftConfig.model} capability="video" estimateSeconds={currentVideoSeconds || defaultConfig.videoSeconds} className="!h-9 !min-w-[190px] !max-w-[260px]" onChange={updateDraftModel} onMissingConfig={() => openConfigDialog(true)} />
                        <CanvasVideoSettingsPopover
                            config={draftConfig}
                            placement="bottomLeft"
                            buttonClassName="!h-9 !min-w-[190px] !max-w-[260px] !justify-start !rounded-full !px-3"
                            smartDurationLabel={currentVideoSeconds ? `按分镜 ${currentVideoSeconds}s` : "按分镜"}
                            smartDurationHint={currentVideoSeconds ? `当前镜头按分镜表使用 ${currentVideoSeconds}s` : "当前镜头未读取到分镜时长"}
                            onConfigChange={(key, value) => updateDraftConfig({ [key]: value } as Partial<AiConfig>)}
                            onModelChange={updateDraftModel}
                            portalContainer={modalContentElement}
                        />
                    </div>
                </section>
                <section>
                    <div className="mb-2 flex items-center justify-between">
                        <div className="text-sm font-semibold">参考资产</div>
                        <span className="text-xs text-stone-500">本次实际提交 {orderedReferences.length} 张 · 首帧 → 场景锁定 → 参考 → 尾帧</span>
                    </div>
                    {orderedReferences.length ? (
                        <div className="grid grid-cols-3 gap-3">
                            {orderedReferences.map((item, index) => (
                                <div key={`${item.mention}-${index}`} className="overflow-hidden rounded-xl border border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-900">
                                    <div className="relative aspect-[4/3] bg-stone-100 dark:bg-stone-800">
                                        {item.url || item.storageKey ? <StoryboardAssetPreviewImage src={item.storageKey || item.url || ""} alt={item.name || item.mention} /> : <div className="flex h-full items-center justify-center text-xs text-amber-500">未绑定图片</div>}
                                        <div className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-semibold text-white ${storyboardReferenceRoleBadgeClass(item.role)}`}>{STORYBOARD_VIDEO_REFERENCE_ROLE_TEXT[item.role || "reference"]}</div>
                                    </div>
                                    <div className="space-y-1 px-2 py-2 text-xs">
                                        <div className="truncate font-semibold">{item.mention}</div>
                                        <div className="truncate text-stone-500">{storyboardReferenceStatusText(item)}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前没有实际提交的参考资产" />
                    )}
                    {missingContextReferences.length ? <div className="mt-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-700 dark:text-amber-200">提示词中可能还引用了未加入本镜头的角色或场景：{missingContextReferences.map((item) => item.mention).join("、")}。建议从下方补充；也可以继续生成，并在提交前确认风险。</div> : null}
                </section>
                {continuityPrompt ? (
                    <section>
                        <div className="mb-2 text-sm font-semibold">首尾帧连续性补充</div>
                        <PromptPreviewBox>{renderStoryboardPromptMentions(continuityPrompt, assetLinks, theme)}</PromptPreviewBox>
                    </section>
                ) : null}
                {audioContinuityPrompt ? (
                    <section>
                        <div className="mb-2 text-sm font-semibold">声音一致性补充</div>
                        <div className="grid gap-2">
                            {audioReferences.map((item) => (
                                <div key={item.mention} className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 px-3 py-2 text-xs">
                                    <div className="mb-1 font-semibold text-cyan-700 dark:text-cyan-200">{item.mention}</div>
                                    {item.url || item.storageKey ? <audio src={item.url || item.storageKey} controls className="h-8 w-full" /> : <div className="text-amber-500">声音样本未绑定</div>}
                                </div>
                            ))}
                            <PromptPreviewBox>{renderStoryboardPromptMentions(audioContinuityPrompt, assetLinks, theme)}</PromptPreviewBox>
                        </div>
                    </section>
                ) : null}
                <section>
                    <div className="mb-2 flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold">最终提交提示词</div>
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-stone-500">文字与参考图独立保存，删除 @ 名称不会移除已选图片</span>
                            <Button type="text" size="small" icon={<Expand className="size-3.5" />} onClick={() => setPromptExpanded(true)}>放大查看</Button>
                        </div>
                    </div>
                    <StoryboardPromptAssetPicker references={referenceCandidates} selected={draftReferences} theme={theme} onToggle={toggleReference} />
                    <CanvasResourceMentionTextarea
                        ref={finalPromptTextareaRef}
                        value={draftFinalPrompt}
                        references={mentionReferences}
                        onChange={updateDraftFinalPrompt}
                        highlightLabels={false}
                        className="thin-scrollbar h-40 w-full resize-y rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs leading-5 text-stone-700 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-stone-700 dark:bg-stone-950/60 dark:text-stone-200"
                        placeholder="请输入最终提交给视频模型的提示词"
                        data-canvas-no-zoom
                        onPointerDown={(event) => event.stopPropagation()}
                        onMouseDown={(event) => event.stopPropagation()}
                        onWheel={(event) => event.stopPropagation()}
                    />
                    <div className="mt-2 flex flex-wrap gap-1.5">
                        {draftAssetLinks.length ? draftAssetLinks.map((link) => <StoryboardAssetChip key={link.mention} link={link} compact theme={theme} />) : <span className="text-xs text-stone-500">暂未识别到 @ 资产</span>}
                    </div>
                </section>
                    </div>
                </div>
                <div className="flex shrink-0 items-center justify-between gap-4 border-t border-stone-200 pt-4 dark:border-stone-800">
                    <span className={`text-xs ${missingContextReferences.length ? "text-amber-600 dark:text-amber-300" : "text-stone-500"}`}>{missingContextReferences.length ? "存在参考资产提醒；点击后仍会执行生成前检查。" : "点击生成后会关闭确认页，并把视频结果写回当前待审核节点。"}</span>
                    <Button type="primary" className="!h-10 !rounded-full !px-4" disabled={!draftFinalPrompt.trim()} onClick={generate}>
                        <span className="flex items-center gap-1.5">
                            <span className="inline-flex items-center gap-1 text-xs font-medium tabular-nums">
                                <CreditSymbol />
                                {credits.toLocaleString()}
                            </span>
                            <span>生成视频</span>
                            <ArrowUp className="size-4" />
                        </span>
                    </Button>
                </div>
            </div>
            <Modal
                open={promptExpanded}
                title="最终提交提示词预览"
                onCancel={() => setPromptExpanded(false)}
                footer={null}
                width={980}
                centered
                destroyOnHidden
                styles={{ body: { maxHeight: "72vh", overflowY: "auto" } }}
            >
                <div className="whitespace-pre-wrap text-sm leading-7 text-stone-700 dark:text-stone-200">
                    {draftFinalPrompt ? renderStoryboardPromptMentions(draftFinalPrompt, draftAssetLinks, theme) : <span className="text-stone-400">暂无最终提示词</span>}
                </div>
                <div className="mt-4 flex flex-wrap gap-1.5 border-t border-stone-200 pt-3 dark:border-stone-700">
                    {draftAssetLinks.length ? draftAssetLinks.map((link) => <StoryboardAssetChip key={link.mention} link={link} compact theme={theme} />) : <span className="text-xs text-stone-500">暂未识别到 @ 资产</span>}
                </div>
            </Modal>
        </Modal>
    );
}

function PromptPreviewBox({ children, emptyText = "暂无内容" }: { children?: ReactNode; emptyText?: string }) {
    return <div className="max-h-52 overflow-auto whitespace-pre-wrap rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs leading-5 text-stone-700 dark:border-stone-700 dark:bg-stone-950/60 dark:text-stone-200">{children || <span className="text-stone-400">{emptyText}</span>}</div>;
}

function StoryboardPromptAssetPicker({ references, selected, theme, onToggle }: { references: StoryboardVideoReference[]; selected: StoryboardVideoReference[]; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; onToggle: (reference: StoryboardVideoReference) => void }) {
    const options = sortStoryboardVideoReferences(references).filter((reference) => reference.mention);
    const selectedMentions = new Set(selected.map((reference) => reference.mention));
    return (
        <div className="mb-2 rounded-xl border px-3 py-2" style={{ borderColor: `${selectionBlue}33`, background: `${selectionBlue}0d` }}>
            <div className="mb-2 flex items-center justify-between gap-3">
                <div className="text-xs font-semibold" style={{ color: theme.node.text }}>
                    本镜头可用资产
                </div>
                <div className="text-[11px] text-stone-500">未加入的资产不会提交给视频模型</div>
            </div>
            {options.length ? (
                <div className="thin-scrollbar flex max-h-32 gap-2 overflow-x-auto pb-1">
                    {options.map((reference) => {
                        const active = selectedMentions.has(reference.mention);
                        return <button
                            key={`${reference.source || "reference"}-${reference.assetId || reference.nodeId || reference.mention}`}
                            type="button"
                            className="flex w-40 shrink-0 items-center gap-2 rounded-lg border px-2 py-2 text-left text-xs transition hover:border-blue-400 hover:bg-blue-500/10"
                            style={{ borderColor: active ? selectionBlue : theme.node.stroke, background: active ? `${selectionBlue}1a` : theme.node.fill, color: theme.node.text }}
                            title={`${active ? "移除" : "加入"} ${reference.mention}`}
                            onPointerDown={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                            }}
                            onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                onToggle(reference);
                            }}
                        >
                            <span className="relative size-11 shrink-0 overflow-hidden rounded-lg bg-black/10">
                                {reference.url || reference.storageKey ? <StoryboardAssetPreviewImage src={reference.storageKey || reference.url || ""} alt={reference.name || reference.mention} /> : <span className="grid size-full place-items-center"><ImageIcon className="size-4 opacity-55" /></span>}
                                <span className={`absolute bottom-0 left-0 right-0 py-0.5 text-center text-[9px] font-semibold text-white ${active ? "bg-blue-500" : "bg-black/45"}`}>{active ? "已加入" : "未加入"}</span>
                            </span>
                            <span className="min-w-0 flex-1">
                                <span className="block truncate font-semibold">{reference.mention}</span>
                                <span className="mt-0.5 block truncate opacity-60">{storyboardReferenceOptionLabel(reference)}</span>
                            </span>
                        </button>;
                    })}
                </div>
            ) : (
                <div className="rounded-lg border border-dashed border-stone-300 px-3 py-3 text-center text-xs text-stone-500 dark:border-stone-700">当前剧本还没有可引用资产</div>
            )}
        </div>
    );
}

function insertStoryboardMention(value: string, mention: string, selectionStart: number, selectionEnd: number) {
    const label = normalizeStoryboardMention(mention);
    if (!label) return { value, cursor: selectionEnd };
    const prefix = value.slice(0, selectionStart);
    const match = /(^|\s)@([^\s@]*)$/.exec(prefix);
    const replaceStart = match ? match.index + match[1].length : selectionStart;
    const before = value.slice(0, replaceStart);
    const after = value.slice(selectionEnd);
    const insertText = `${before && !/\s$/.test(before) ? " " : ""}${label} `;
    const next = `${before}${insertText}${after}`;
    return { value: next, cursor: before.length + insertText.length };
}

function storyboardReferenceOptionLabel(reference: StoryboardVideoReference) {
    const source = reference.source === "script" ? "剧本资产" : reference.source === "asset" ? "我的素材" : reference.source === "node" ? "画布节点" : "参考资产";
    const role = STORYBOARD_VIDEO_REFERENCE_ROLE_TEXT[reference.role || "reference"];
    return `${source} · ${role}`;
}

function storyboardPinnedReference(reference: StoryboardVideoReference): StoryboardVideoReference {
    return reference.source === "script" && reference.nodeId ? { ...reference, source: "node" } : reference;
}

function storyboardReferenceAssetCandidates(references: StoryboardVideoReference[], scriptReferences: StoryboardVideoReference[], imageAssets: ImageAsset[]) {
    const materialReferences = imageAssets
        .map((asset) => ({
            mention: normalizeStoryboardMention(asset.title),
            name: asset.title,
            status: "bound" as const,
            assetId: asset.id,
            url: asset.data.dataUrl,
            storageKey: asset.data.storageKey,
            source: "asset" as const,
        }));
    return dedupeStoryboardReferences([...references, ...scriptReferences, ...materialReferences]);
}

function storyboardMissingContextReferences(prompt: string, selected: StoryboardVideoReference[], candidates: StoryboardVideoReference[]) {
    const selectedKeys = new Set(selected.map(storyboardReferenceContextKey));
    const selectedBaseKeys = new Set(selected.map(storyboardReferenceBaseKey));
    const missingKeys = new Set<string>();
    return candidates.filter((reference) => {
        if (reference.kind !== "character" && reference.kind !== "scene") return false;
        const key = storyboardReferenceContextKey(reference);
        if (selectedKeys.has(key) || missingKeys.has(key)) return false;
        const name = (reference.name || reference.mention).replace(/^@/, "");
        const explicitMentioned = prompt.includes(reference.mention);
        const baseName = storyboardReferenceBaseKey(reference);
        if (!explicitMentioned && selectedBaseKeys.has(baseName)) return false;
        if (!explicitMentioned && !prompt.includes(name) && (baseName.length < 2 || !prompt.includes(baseName))) return false;
        missingKeys.add(key);
        return true;
    });
}

function storyboardReferenceContextKey(reference: StoryboardVideoReference) {
    const name = (reference.name || reference.mention).replace(/^@/, "");
    return (name.split(/[（(]/)[0]?.trim() || name).replace(/-(?:多角度锁定图|正面|左侧|右侧|俯视|背面|左前45度|右前45度|左后45度|右后45度)$/, "");
}

function storyboardReferenceBaseKey(reference: StoryboardVideoReference) {
    return storyboardReferenceContextKey(reference).replace(/[·-](?:婴幼儿|年少|童年|少年|青年|年轻|成年|中年|老年|晚年)(?:时期|阶段)?$/, "");
}

function dedupeStoryboardReferences(references: StoryboardVideoReference[]) {
    const seen = new Set<string>();
    return references.filter((reference) => {
        const mention = reference.mention;
        if (!mention || seen.has(mention)) return false;
        seen.add(mention);
        return true;
    });
}

function storyboardReferenceToMentionLink(reference: StoryboardVideoReference): StoryboardAssetMentionLink {
    return {
        mention: reference.mention,
        name: reference.name || reference.mention.replace(/^@/, ""),
        status: reference.status,
        assetId: reference.assetId,
        nodeId: reference.nodeId,
        kind: reference.kind,
    };
}

function storyboardReferencesToCanvasResources(references: StoryboardVideoReference[]): CanvasResourceReference[] {
    return references.map((reference, index) => ({
        id: reference.assetId || reference.nodeId || reference.mention || `storyboard-reference-${index}`,
        nodeId: reference.nodeId || reference.assetId || reference.mention || `storyboard-reference-${index}`,
        kind: "image",
        label: reference.mention,
        title: reference.name || reference.mention.replace(/^@/, ""),
        previewUrl: reference.storageKey || reference.url,
        active: Boolean(reference.mention),
    }));
}

function buildStoryboardVideoNodeConfig(globalConfig: AiConfig, node: CanvasNodeData): AiConfig {
    return {
        ...globalConfig,
        model: node.metadata?.model || globalConfig.videoModel || globalConfig.model || defaultConfig.videoModel,
        size: node.metadata?.size || globalConfig.size || defaultConfig.size,
        videoSeconds: node.metadata?.seconds || globalConfig.videoSeconds || defaultConfig.videoSeconds,
        vquality: node.metadata?.vquality || globalConfig.vquality || defaultConfig.vquality,
        videoGenerateAudio: node.metadata?.generateAudio || globalConfig.videoGenerateAudio || defaultConfig.videoGenerateAudio,
        videoWatermark: node.metadata?.watermark || globalConfig.videoWatermark || defaultConfig.videoWatermark,
    };
}

function storyboardVideoConfigPatch(config: AiConfig, prompt: string, finalPrompt: string): Partial<CanvasNodeMetadata> {
    return {
        prompt,
        storyboardVideoFinalPrompt: finalPrompt,
        model: config.model,
        size: config.size,
        seconds: config.videoSeconds,
        vquality: config.vquality,
        generateAudio: config.videoGenerateAudio,
        watermark: config.videoWatermark,
    };
}

function storyboardVideoFinalPrompt(prompt: string, references: StoryboardVideoReference[], audioReferences?: StoryboardAudioReference[]) {
    const basePrompt = stripStoryboardVideoFrameContinuityPrompt(prompt);
    const continuityPrompt = storyboardVideoFrameContinuityPrompt(references, basePrompt);
    const audioPrompt = storyboardVideoAudioContinuityPrompt(audioReferences);
    const additions = [continuityPrompt, audioPrompt].filter(Boolean).join("\n");
    if (!additions) return basePrompt;
    const marker = "【连续性与稳定约束】";
    return basePrompt.includes(marker) ? basePrompt.replace(marker, `${marker}\n${additions}`).trim() : `${basePrompt}\n\n${additions}`.trim();
}

function storyboardVideoAudioContinuityPrompt(references?: StoryboardAudioReference[]) {
    const voiceLocks = (references || []).filter((item) => item.role === "voiceLock");
    if (!voiceLocks.length) return "";
    return [
        `- 参考角色声音样本锁定音色、年龄感、气息、语速和情绪强度：${voiceLocks.map((item) => item.mention).join("、")}。`,
        "- 同一角色在不同镜头中不要突然改变音色、口音、语速或情绪强度；背景音乐和环境音不要盖过对白。",
    ].join("\n");
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

function StoryboardVideoReferenceEditor({ node, open, references, scriptReferences, onClose, onSave }: { node: CanvasNodeData; open: boolean; references: StoryboardVideoReference[]; scriptReferences: StoryboardVideoReference[]; onClose: () => void; onSave: (references: StoryboardVideoReference[]) => void }) {
    useStoryboardModalOutsideClose(open, onClose);
    const assets = useAssetStore((state) => state.assets);
    const imageAssets = assets.filter((asset): asset is ImageAsset => asset.kind === "image");
    const [draft, setDraft] = useState<StoryboardVideoReference[]>(references);
    const tailFrameReferences = scriptReferences.filter(isStoryboardTailFrameReference);
    const scriptAssetReferences = scriptReferences.filter((item) => !isStoryboardTailFrameReference(item));
    const activeTailFrame = sortStoryboardVideoReferences(draft).find(isStoryboardTailFrameReference);

    useEffect(() => {
        if (open) setDraft(references);
    }, [open, node.id]);

    const updateMention = (index: number, value: string) => {
        setDraft((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, mention: normalizeStoryboardMention(value), name: value.replace(/^@+/, "").trim() || item.name } : item)));
    };
    const updateRole = (index: number, role: StoryboardVideoReferenceRole) => {
        setDraft((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, role } : item)));
    };
    const addReference = (reference: StoryboardVideoReference, role: StoryboardVideoReferenceRole) => {
        setDraft((current) => {
            const mention = uniqueStoryboardMention(normalizeStoryboardMention(reference.mention || reference.name), current);
            return [...current, { ...storyboardPinnedReference(reference), mention, name: mention.replace(/^@/, ""), role, status: "bound" }];
        });
    };
    const setFirstFrameReference = (reference: StoryboardVideoReference) => {
        setDraft((current) => {
            const next = current.filter((item) => !isStoryboardTailFrameReference(item));
            const mention = normalizeStoryboardMention(reference.mention || reference.name);
            return [...next, { ...reference, mention, name: mention.replace(/^@/, ""), role: "firstFrame", status: "bound" }];
        });
    };
    const clearTailFrameReference = () => {
        setDraft((current) => current.filter((item) => !isStoryboardTailFrameReference(item)));
    };
    const addAsset = (asset: ImageAsset, role: StoryboardVideoReferenceRole) => {
        addReference({ mention: normalizeStoryboardMention(asset.title), name: asset.title, status: "bound", assetId: asset.id, url: asset.data.dataUrl, storageKey: asset.data.storageKey, source: "asset" }, role);
    };

    return (
        <Modal
            className="storyboard-video-reference-modal"
            title={<CanvasModalTitle title={`第 ${(node.metadata?.storyboardRowIndex || 0) + 1} 镜参考资产`} onClose={onClose} />}
            open={open}
            onCancel={onClose}
            footer={null}
            mask={{ closable: true }}
            keyboard
            width={860}
            destroyOnHidden
            closable={false}
            modalRender={renderCanvasModal}
        >
            <div className="space-y-5" data-canvas-no-zoom onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
                <Alert
                    showIcon
                    type="warning"
                    message="参考图风格需与整体要求一致"
                    description="如果脚本节点要求写实真人短剧，角色和场景参考图应保持真实人物与现实光影；如果平台因高写实人脸拒绝生成，再改用更明显的虚拟角色或降低真人脸细节。"
                />
                <section className="rounded-xl border border-stone-200 p-3 dark:border-stone-700">
                    <div className="mb-2 flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold">连续性首帧</div>
                        <span className={`text-xs ${activeTailFrame ? "text-sky-500" : "text-stone-500"}`}>{activeTailFrame ? `当前：${activeTailFrame.mention.replace(/^@/, "")}` : "未接入上一镜尾帧"}</span>
                    </div>
                    {tailFrameReferences.length ? (
                        <div className="grid grid-cols-2 gap-3">
                            {tailFrameReferences.map((item) => {
                                const active = activeTailFrame?.mention === item.mention;
                                return (
                                    <div key={item.mention} className={`overflow-hidden rounded-lg border ${active ? "border-sky-400" : "border-stone-200 dark:border-stone-700"}`}>
                                        <div className="relative aspect-[4/3] bg-stone-100 dark:bg-stone-800">{item.url || item.storageKey ? <StoryboardAssetPreviewImage src={item.storageKey || item.url || ""} alt={item.name || item.mention} /> : null}</div>
                                        <div className="space-y-2 px-2 py-2 text-xs">
                                            <div className="truncate font-semibold">{item.mention}</div>
                                            <div className="flex gap-1.5">
                                                <Button size="small" type={active ? "primary" : "default"} onClick={() => setFirstFrameReference(item)}>
                                                    {active ? "已设为首帧" : "设为首帧"}
                                                </Button>
                                                {active ? <Button size="small" onClick={clearTailFrameReference}>移除</Button> : null}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="上一镜还没有可用尾帧；生成上一镜视频后会自动截取，旧视频放在同一视频工作区内也会尝试识别" />
                    )}
                </section>
                <section>
                    <div className="mb-2 text-sm font-semibold">当前参考图</div>
                    {draft.length ? (
                        <div className="grid grid-cols-2 gap-3">
                            {draft.map((item, index) => (
                                <div key={`${item.mention}-${index}`} className="flex gap-3 rounded-xl border border-stone-200 p-2 dark:border-stone-700">
                                    <div className="size-16 shrink-0 overflow-hidden rounded-lg bg-stone-100 dark:bg-stone-800">{item.url || item.storageKey ? <StoryboardAssetPreviewImage src={item.storageKey || item.url || ""} alt={item.name || item.mention} /> : null}</div>
                                    <div className="min-w-0 flex-1 space-y-2">
                                        <Input size="small" value={item.mention} onChange={(event) => updateMention(index, event.target.value)} />
                                        <div className="flex items-center gap-2">
                                            <StoryboardReferenceRoleButtons value={item.role || "reference"} onChange={(role) => updateRole(index, role)} />
                                            <Button size="small" danger icon={<Trash2 className="size-3.5" />} onClick={() => setDraft((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
                                                删除
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有参考资产" />
                    )}
                </section>
                <section>
                    <div className="mb-2 flex items-center justify-between">
                        <div className="text-sm font-semibold">从当前剧本资产添加</div>
                        <span className="text-xs text-stone-500">优先使用脚本节点已生成或导出的资产图</span>
                    </div>
                    {scriptAssetReferences.length ? (
                        <ReferenceSourceGrid items={scriptAssetReferences} onAdd={addReference} />
                    ) : (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前剧本还没有可用资产图，请先准备或导出资产" />
                    )}
                </section>
                <section>
                    <div className="mb-2 flex items-center justify-between">
                        <div className="text-sm font-semibold">从我的图片素材添加</div>
                        <span className="text-xs text-stone-500">点击素材会加入本镜头参考图</span>
                    </div>
                    {imageAssets.length ? (
                        <div className="grid max-h-64 grid-cols-4 gap-3 overflow-auto pr-1">
                            {imageAssets.map((asset) => (
                                <div key={asset.id} className="group overflow-hidden rounded-lg border border-stone-200 bg-white text-left transition hover:border-blue-500 dark:border-stone-700 dark:bg-stone-900">
                                    <img src={asset.coverUrl || asset.data.dataUrl} alt={asset.title} className="aspect-[4/3] w-full object-cover" />
                                    <div className="px-2 py-1.5 text-xs font-semibold">
                                        <span className="truncate">{asset.title}</span>
                                        <div className="mt-1 flex gap-1">
                                            {Object.entries(STORYBOARD_VIDEO_REFERENCE_ROLE_TEXT).map(([role, label]) => (
                                                <button key={role} type="button" className="rounded border border-blue-500/40 px-1.5 py-0.5 text-[10px] text-blue-500 hover:bg-blue-500/10" onClick={() => addAsset(asset, role as StoryboardVideoReferenceRole)}>
                                                    {label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="我的素材里还没有图片" />
                    )}
                </section>
                <div className="flex justify-end gap-2">
                    <Button onClick={onClose}>取消</Button>
                    <Button type="primary" onClick={() => { onSave(draft); onClose(); }}>
                        保存参考资产
                    </Button>
                </div>
            </div>
        </Modal>
    );
}

function StoryboardReferenceRoleButtons({ value, onChange }: { value: StoryboardVideoReferenceRole; onChange: (role: StoryboardVideoReferenceRole) => void }) {
    return (
        <div className="flex rounded-lg border border-stone-300 p-0.5 dark:border-stone-700">
            {Object.entries(STORYBOARD_VIDEO_REFERENCE_ROLE_TEXT).map(([role, label]) => {
                const active = value === role;
                return (
                    <button
                        key={role}
                        type="button"
                        className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold transition ${active ? "bg-blue-500 text-white" : "text-stone-500 hover:bg-blue-500/10 hover:text-blue-500"}`}
                        onClick={() => onChange(role as StoryboardVideoReferenceRole)}
                    >
                        {label}
                    </button>
                );
            })}
        </div>
    );
}

function ReferenceSourceGrid({ items, onAdd }: { items: StoryboardVideoReference[]; onAdd: (reference: StoryboardVideoReference, role: StoryboardVideoReferenceRole) => void }) {
    return (
        <div className="grid max-h-64 grid-cols-4 gap-3 overflow-auto pr-1">
            {items.map((item) => (
                <div key={`${item.source || "script"}-${item.assetId || item.nodeId || item.mention}`} className="overflow-hidden rounded-lg border border-stone-200 bg-white text-left transition hover:border-blue-500 dark:border-stone-700 dark:bg-stone-900">
                    <div className="aspect-[4/3] w-full bg-stone-100 dark:bg-stone-800">{item.url || item.storageKey ? <StoryboardAssetPreviewImage src={item.storageKey || item.url || ""} alt={item.name || item.mention} /> : null}</div>
                    <div className="px-2 py-1.5 text-xs font-semibold">
                        <span className="truncate">{item.mention}</span>
                        <div className="mt-1 flex gap-1">
                            {Object.entries(STORYBOARD_VIDEO_REFERENCE_ROLE_TEXT).map(([role, label]) => (
                                <button key={role} type="button" className="rounded border border-blue-500/40 px-1.5 py-0.5 text-[10px] text-blue-500 hover:bg-blue-500/10" onClick={() => onAdd(item, role as StoryboardVideoReferenceRole)}>
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}

function storyboardVideoReferencePatch(references: StoryboardVideoReference[]): Partial<CanvasNodeMetadata> {
    const next = references.map((item) => ({ ...item, mention: normalizeStoryboardMention(item.mention), name: item.name || item.mention.replace(/^@/, ""), status: item.status || ("bound" as const) })).filter((item) => item.mention);
    return {
        storyboardVideoReferences: next,
        storyboardAssetMentions: next.map((item) => item.mention),
        storyboardAssetMentionLinks: next.map(({ mention, name, status, assetId, nodeId, kind }) => ({ mention, name, status, assetId, nodeId, kind })),
        storyboardAssetReferenceNodeIds: next.map((item) => item.nodeId).filter((id): id is string => Boolean(id)),
        references: next.map((item) => item.storageKey || item.url).filter((url): url is string => Boolean(url)),
    };
}

function storyboardVideoReferenceSavePatch(node: CanvasNodeData, references: StoryboardVideoReference[]): Partial<CanvasNodeMetadata> {
    const patch = storyboardVideoReferencePatch(references);
    const basePrompt = stripStoryboardVideoAudioContinuityPrompt(stripStoryboardVideoFrameContinuityPrompt(node.metadata?.storyboardVideoFinalPrompt || node.metadata?.prompt || ""));
    return { ...patch, storyboardVideoFinalPrompt: storyboardVideoFinalPrompt(basePrompt, patch.storyboardVideoReferences || [], node.metadata?.storyboardVideoAudioReferences) };
}

function stripStoryboardVideoFrameContinuityPrompt(prompt: string) {
    return prompt
        .split(/\n\n视频连续性要求：/)[0]
        .split("\n")
        .filter((line) => !/^\s*-\s*(?:以首帧参考图|以场景锁定参考图|以主体参考图|视频动作和镜头运动需要自然过渡到尾帧参考图|保持人物身份、服装、场景、光影和空间关系连续)/.test(line))
        .join("\n")
        .trim();
}

function stripStoryboardVideoAudioContinuityPrompt(prompt: string) {
    return prompt.split(/\n\n视频声音一致性要求：/)[0].trim();
}

function normalizeStoryboardMention(value: string) {
    const name = value.trim().replace(/^@+/, "");
    return name ? `@${name}` : "";
}

function uniqueStoryboardMention(mention: string, current: StoryboardVideoReference[]) {
    if (!current.some((item) => item.mention === mention)) return mention;
    const name = mention.replace(/^@/, "");
    let index = 2;
    while (current.some((item) => item.mention === `@${name}${index}`)) index += 1;
    return `@${name}${index}`;
}

function sortStoryboardVideoReferences(references: StoryboardVideoReference[]) {
    return [...references].sort((a, b) => STORYBOARD_VIDEO_REFERENCE_ROLE_ORDER[a.role || "reference"] - STORYBOARD_VIDEO_REFERENCE_ROLE_ORDER[b.role || "reference"]);
}

function AudioNodeContent({ node, theme }: NodeContentRendererProps) {
    if (!node.metadata?.content)
        return (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2" style={{ color: theme.node.placeholder }}>
                <Music2 className="size-7 opacity-35" />
                <span className="text-sm">空音频节点</span>
            </div>
        );
    return (
        <div className="flex h-full w-full flex-col justify-center gap-3 px-4" style={{ background: theme.node.fill, color: theme.node.text }}>
            <div className="flex min-w-0 items-center gap-2 text-sm opacity-70">
                <Music2 className="size-4 shrink-0" />
                <span className="truncate">{node.title || "音频"}</span>
                {node.metadata?.voiceboxProfileName ? <span className="ml-auto shrink-0 text-xs">{node.metadata.voiceboxProfileName}</span> : null}
            </div>
            <audio src={node.metadata.content} controls className="w-full" data-canvas-no-zoom />
        </div>
    );
}

function ScriptNodeContent({ node, theme, onOpenScript }: NodeContentRendererProps) {
    if (node.metadata?.storyboardSeriesRootNodeId) {
        const chapter = node.metadata?.storyboardChapters?.[0];
        return (
            <div className="flex h-full w-full flex-col justify-between p-5 text-center" style={{ background: theme.node.fill, color: theme.node.text }}>
                <div className="flex items-center gap-2 text-left text-sm font-medium opacity-80">
                    <FileText className="size-4" />
                    <span className="min-w-0 truncate">{node.title || chapter?.title || "章节脚本"}</span>
                </div>
                <div className="flex flex-1 flex-col items-center justify-center gap-4">
                    <div className="flex size-12 items-center justify-center rounded-2xl border" style={{ borderColor: theme.node.stroke, background: theme.node.panel }}>
                        <FileText className="size-6 opacity-55" />
                    </div>
                    <div className="text-sm font-semibold">{chapter?.title || "系列章节"}</div>
                    <div className="text-xs opacity-60">{chapter?.shotIndexes.length || 0} 个片段 · 约 {Math.round(chapter?.durationSeconds || 0)} 秒</div>
                    <div className="text-[11px] opacity-45">引用系列主节点事实、旁白与共享资产</div>
                </div>
                <button type="button" className="h-9 rounded-lg text-sm font-medium transition hover:scale-[1.01]" style={{ background: theme.toolbar.activeBg, color: theme.toolbar.activeText }} onClick={(event) => { event.stopPropagation(); onOpenScript?.(node); }} onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
                    打开本章制作 →
                </button>
            </div>
        );
    }
    const rows = normalizeStoryboardRows(node.metadata?.storyboardRows);
    const activeEpisodeId = node.metadata?.storyboardActiveChapterId || node.metadata?.storyboardChapters?.[0]?.id;
    const assets = (node.metadata?.storyboardAssets || []).filter((asset) => !activeEpisodeId || asset.chapterIds === undefined || asset.chapterIds.includes(activeEpisodeId));
    const promptDetails = node.metadata?.storyboardPromptDetails || {};
    const filledRows = rows.filter((row) => row.some((cell, index) => index > 1 && cell.trim())).length;
    const productionScope = node.metadata?.storyboardProductionScope || "series";
    const planningConfigKey = storyboardPlanningConfigKey(productionScope);
    const planningStale = Boolean(rows.length && node.metadata?.storyboardSourceBeats?.length && node.metadata?.storyboardPlanningConfigKey !== planningConfigKey);
    const isReady = filledRows > 0 && !planningStale;
    const readyAssets = assets.filter((asset) => asset.imageUrl || asset.storageKey).length;
    const assetsDone = !planningStale && assets.length > 0 && readyAssets === assets.length;
    const dynamicIndexes = rows.map((_, index) => index).filter((index) => node.metadata?.storyboardShotPlans?.[String(index)]?.renderMode !== "still");
    const promptCount = dynamicIndexes.filter((index) => {
        const detail = promptDetails[String(index)];
        return detail?.videoMotionPrompt?.trim();
    }).length;
    const promptsDone = !planningStale && dynamicIndexes.length > 0 && promptCount === dynamicIndexes.length;
    const episodeCount = node.metadata?.storyboardChapters?.length || 1;
    const statusText = planningStale ? "生产配置已变更，请重新规划片段" : promptsDone ? `${promptCount} 个视频片段提示词已合成` : promptCount ? `${promptCount}/${dynamicIndexes.length} 个视频片段提示词已合成` : assets.length ? `${readyAssets}/${assets.length} 个资产已准备` : filledRows ? `${episodeCount} 集 / ${dynamicIndexes.length} 个视频片段` : "生成后在大表格中确认片段";

    return (
        <div className="flex h-full w-full flex-col justify-between p-5 text-center" style={{ background: theme.node.fill, color: theme.node.text }}>
            <div className="flex items-center gap-2 text-left text-sm font-medium opacity-80">
                <FileText className="size-4" />
                <span className="min-w-0 truncate">{node.title || "脚本节点"}</span>
            </div>
            <div className="flex flex-1 flex-col items-center justify-center gap-5">
                <div className="flex size-12 items-center justify-center rounded-2xl border" style={{ borderColor: theme.node.stroke, background: theme.node.panel }}>
                    <FileText className="size-6 opacity-55" />
                </div>
                <div className="grid w-full max-w-[250px] grid-cols-[1fr_1fr_1fr] items-start gap-2 text-[11px]">
                    <ScriptStep active done={isReady} index="1" label="确认片段" />
                    <ScriptStep active={isReady || assets.length > 0} done={assetsDone} index="2" label="准备资产" />
                    <ScriptStep active={assetsDone || promptCount > 0} done={promptsDone} index="3" label="合成提示词" />
                </div>
                <div className="text-xs opacity-60">{statusText}</div>
            </div>
            <button
                type="button"
                className="h-9 rounded-lg text-sm font-medium transition hover:scale-[1.01]"
                style={{ background: theme.toolbar.activeBg, color: theme.toolbar.activeText }}
                onClick={(event) => {
                    event.stopPropagation();
                    onOpenScript?.(node);
                }}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
            >
                打开脚本节点 →
            </button>
        </div>
    );
}

function ScriptStep({ index, label, active, done }: { index: string; label: string; active?: boolean; done?: boolean }) {
    return (
        <div className={`flex flex-col items-center gap-1 ${active ? "opacity-100" : "opacity-45"}`}>
            <span className={`grid size-6 place-items-center rounded-full border text-[11px] font-semibold ${done ? "bg-white text-black" : ""}`}>{index}</span>
            <span className="whitespace-nowrap">{label}</span>
        </div>
    );
}

function WorkspaceNodeContent({ node, theme }: NodeContentRendererProps) {
    const childCount = node.metadata?.workspaceChildNodeIds?.length || 0;
    const workspaceLabel = String(node.metadata?.workspaceKind) === "storyboard-assets"
        ? "资产工作区"
        : node.metadata?.workspaceKind === "storyboard-character-assets"
          ? "角色资产"
          : node.metadata?.workspaceKind === "storyboard-scene-assets"
            ? "场景资产"
            : node.metadata?.workspaceKind === "storyboard-prop-assets"
              ? "道具资产"
              : node.metadata?.workspaceKind === "character-references"
                ? "角色基准图"
                : "视频工作区";
    return (
        <div
            className="pointer-events-none flex h-full w-full flex-col rounded-3xl border border-dashed px-5 py-4"
            style={{
                background: `${theme.node.panel}33`,
                borderColor: `${theme.node.stroke}99`,
                color: theme.node.text,
                backdropFilter: "blur(1px)",
            }}
        >
            <div className="flex items-center justify-between text-left">
                <div className="flex min-w-0 items-center gap-2">
                    <Boxes className="size-4 shrink-0 opacity-70" />
                    <span className="truncate text-sm font-semibold">{node.metadata?.workspaceTitle || node.title || "工作区"}</span>
                </div>
                <span className="rounded-full border px-2 py-0.5 text-[11px] opacity-70" style={{ borderColor: theme.node.stroke }}>
                    {workspaceLabel} · {childCount}
                </span>
            </div>
            <div className="mt-auto text-left text-[11px] opacity-55">拖动背景板可整体移动内部节点</div>
        </div>
    );
}

function ImageContent({
    node,
    isBatchRoot,
    batchCount,
    batchExpanded,
    batchOpening,
    batchRecovering,
    onToggleBatch,
    onSetBatchPrimary,
}: {
    node: CanvasNodeData;
    isBatchRoot: boolean;
    batchCount: number;
    batchExpanded: boolean;
    batchOpening: boolean;
    batchRecovering: boolean;
    onToggleBatch?: () => void;
    onSetBatchPrimary?: () => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const isBatchChild = Boolean(node.metadata?.batchRootId);

    return (
        <BatchFrame batchCount={isBatchRoot ? batchCount : 0} batchExpanded={batchExpanded} batchOpening={batchOpening} batchRecovering={batchRecovering} onToggleBatch={onToggleBatch}>
            <div className="h-full w-full overflow-hidden rounded-3xl">
                <img
                    src={node.metadata!.content!}
                    alt={node.title}
                    draggable={false}
                    onDragStart={(event) => event.preventDefault()}
                    className={`pointer-events-none block h-full w-full select-none ${node.metadata?.freeResize ? "object-fill" : "object-contain"}`}
                />
            </div>
            {isBatchRoot ? (
                <button
                    type="button"
                    className="absolute right-2.5 top-2.5 z-30 flex h-8 items-center justify-center gap-1 rounded-full border px-2.5 text-xs font-semibold shadow-[0_6px_18px_rgba(15,23,42,.10)] backdrop-blur-md transition hover:scale-[1.02]"
                    style={{ background: `${theme.toolbar.panel}d9`, borderColor: `${theme.toolbar.border}cc`, color: theme.node.text }}
                    aria-label={batchExpanded ? "图片组已展开" : "图片组已收起"}
                    onClick={(event) => {
                        event.stopPropagation();
                        onToggleBatch?.();
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                >
                    <span className="leading-none text-[#2f80ff]">{batchCount}</span>
                    <ChevronRight className={`size-3.5 opacity-55 transition-transform ${batchExpanded ? "rotate-90" : ""}`} />
                </button>
            ) : null}
            {isBatchChild ? (
                <button
                    type="button"
                    className="absolute right-3 top-3 z-30 flex h-9 items-center gap-1.5 rounded-xl border px-2.5 text-xs font-medium opacity-0 shadow-[0_8px_20px_rgba(68,64,60,.13)] backdrop-blur-md transition group-hover/batch:opacity-100 hover:scale-[1.02]"
                    style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
                    onClick={(event) => {
                        event.stopPropagation();
                        onSetBatchPrimary?.();
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                >
                    <Star className="size-3.5 text-[#2f80ff]" />
                    设为主图
                </button>
            ) : null}
        </BatchFrame>
    );
}

function ImageInfoBar({ node }: { node: CanvasNodeData }) {
    const width = Math.round(node.metadata?.naturalWidth || node.width);
    const height = Math.round(node.metadata?.naturalHeight || node.height);
    const size = formatBytes(node.metadata?.bytes || 0);
    return (
        <div className="pointer-events-none absolute bottom-3 right-3 z-40 max-w-[calc(100%-24px)]">
            <span className="max-w-full truncate rounded-md bg-black/55 px-2 py-1 text-[11px] font-medium leading-none text-white backdrop-blur-sm">
                {width} x {height}
                {size ? ` · ${size}` : ""}
            </span>
        </div>
    );
}

function BatchFrame({ batchCount, batchExpanded, batchOpening, batchRecovering, onToggleBatch, children }: { batchCount: number; batchExpanded: boolean; batchOpening: boolean; batchRecovering: boolean; onToggleBatch?: () => void; children: ReactNode }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const isBatchRoot = batchCount > 1;
    return (
        <div
            className="group/batch relative h-full w-full overflow-visible"
            onDoubleClick={
                isBatchRoot
                    ? (event) => {
                          event.stopPropagation();
                          onToggleBatch?.();
                      }
                    : undefined
            }
        >
            {isBatchRoot ? (
                <div className="pointer-events-none absolute inset-0 overflow-visible">
                    {Array.from({ length: Math.min(batchCount - 1, 5) }).map((_, index) => (
                        <div
                            key={index}
                            className="absolute rounded-[inherit] border shadow-[0_14px_34px_rgba(68,64,60,.16)] transition-all duration-300 group-hover/batch:translate-x-2"
                            style={{
                                inset: 0,
                                background: `linear-gradient(135deg, ${theme.node.panel}, ${theme.node.fill})`,
                                borderColor: theme.node.stroke,
                                opacity: batchExpanded && !batchOpening ? 0.34 : 1,
                                transform:
                                    batchOpening || batchRecovering ? `translate(${54 + index * 22}px, ${20 + index * 12}px) rotate(${8 + index * 5}deg) scale(.98)` : `translate(${34 + index * 18}px, ${14 + index * 10}px) rotate(${6 + index * 4}deg)`,
                                zIndex: -index - 1,
                            }}
                        />
                    ))}
                </div>
            ) : null}
            {children}
        </div>
    );
}
function ResizeHandle({ corner, onMouseDown }: { corner: ResizeCorner; onMouseDown: (event: React.MouseEvent, corner: ResizeCorner) => void }) {
    const positionClass = {
        "top-left": "-left-[14px] -top-[14px] cursor-nwse-resize",
        "top-right": "-right-[14px] -top-[14px] cursor-nesw-resize",
        "bottom-left": "-bottom-[14px] -left-[14px] cursor-nesw-resize",
        "bottom-right": "-bottom-[14px] -right-[14px] cursor-nwse-resize",
    }[corner];

    return <div className={`absolute z-50 size-7 ${positionClass}`} onMouseDown={(event) => onMouseDown(event, corner)} />;
}

function ConnectionHandleDot({ side, visible, onMouseDown }: { side: "left" | "right"; visible: boolean; onMouseDown: (event: React.MouseEvent) => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <div
            className={`absolute top-1/2 z-30 flex size-12 -translate-y-1/2 cursor-crosshair items-center justify-center transition-opacity duration-150 ${
                side === "left" ? "-left-6" : "-right-6"
            } ${visible ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"}`}
            onMouseDown={onMouseDown}
        >
            <div className="size-3 rounded-full border-2 transition-all hover:scale-125" style={{ background: theme.node.panel, borderColor: theme.node.muted }} />
        </div>
    );
}

"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Alert, Button, Empty, Input, Modal } from "antd";
import { ArrowUp, Boxes, ChevronRight, FileText, Image as ImageIcon, Music2, RefreshCw, Star, Trash2, Video, X } from "lucide-react";

import { ModelPicker } from "@/components/model-picker";
import { CreditSymbol, requestCreditCost } from "@/constant/credits";
import { canvasThemes } from "@/lib/canvas-theme";
import { formatBytes } from "@/lib/image-utils";
import { resolveImageUrl } from "@/services/image-storage";
import { defaultConfig, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { useAssetStore, type ImageAsset } from "@/stores/use-asset-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasVideoSettingsPopover } from "./canvas-video-settings-popover";
import { CanvasResourceMentionTextarea } from "./canvas-resource-mention-textarea";
import { CanvasNodeType, STORYBOARD_VIDEO_PROMPT_PREVIEW_EVENT, type CanvasNodeData, type CanvasNodeMetadata, type Position, type StoryboardAssetMentionLink, type StoryboardVideoReference, type StoryboardVideoReferenceRole } from "../types";
import type { CanvasResourceReference } from "../utils/canvas-resource-references";

type ResizeCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";
const selectionBlue = "#2f80ff";
const STORYBOARD_VIDEO_REFERENCE_ROLE_TEXT: Record<StoryboardVideoReferenceRole, string> = { firstFrame: "首帧", reference: "参考", lastFrame: "尾帧" };
const STORYBOARD_VIDEO_REFERENCE_ROLE_ORDER: Record<StoryboardVideoReferenceRole, number> = { firstFrame: 0, reference: 1, lastFrame: 2 };
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
    resourceLabel?: CanvasResourceReference;
    mentionReferences?: CanvasResourceReference[];
    storyboardReferenceAssets?: StoryboardVideoReference[];
    renderPanel?: (node: CanvasNodeData) => ReactNode;
    renderNodeContent?: (node: CanvasNodeData) => ReactNode;
    batchCount?: number;
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
    onStoryboardScreenshotImport?: (node: CanvasNodeData, file: File, model?: string) => Promise<StoryboardImportPreview | null>;
    onToggleBatch?: (nodeId: string) => void;
    onSetBatchPrimary?: (node: CanvasNodeData) => void;
    onRetry?: (node: CanvasNodeData, patch?: Partial<CanvasNodeMetadata>) => void;
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
    onRetry?: (node: CanvasNodeData, patch?: Partial<CanvasNodeMetadata>) => void;
    onGenerateImage?: (node: CanvasNodeData) => void;
    onOpenScript?: (node: CanvasNodeData) => void;
    onToggleBatch?: () => void;
    onSetBatchPrimary?: () => void;
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
    resourceLabel,
    mentionReferences = [],
    storyboardReferenceAssets = [],
    renderPanel,
    renderNodeContent,
    batchCount = 0,
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
    onStoryboardScreenshotImport,
    onToggleBatch,
    onSetBatchPrimary,
    onRetry,
    onGenerateImage,
    onOpenScript,
    onViewImage,
    onContextMenu,
}: CanvasNodeProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [hovered, setHovered] = useState(false);
    const [isEditingContent, setIsEditingContent] = useState(false);
    const hasImageContent = data.type === CanvasNodeType.Image && Boolean(data.metadata?.content);
    const hasVideoContent = data.type === CanvasNodeType.Video && Boolean(data.metadata?.content);
    const hasAudioContent = data.type === CanvasNodeType.Audio && Boolean(data.metadata?.content);
    const isWorkspace = data.type === CanvasNodeType.Workspace;
    const isBatchRoot = data.type === CanvasNodeType.Image && Boolean(data.metadata?.isBatchRoot) && batchCount > 1;
    const isBatchChild = data.type === CanvasNodeType.Image && Boolean(data.metadata?.batchRootId);
    const isActive = isConnectionTarget || isSelected || isFocusRelated;
    const imageBorderColor = isActive ? selectionBlue : isRelated && !isBatchChild ? theme.node.muted : "transparent";
    const nodeLayerClass = isWorkspace ? "z-0" : isSelected ? "z-50" : "z-10";
    const textareaRef = useRef<HTMLTextAreaElement>(null);
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
            keepRatio: (data.type === CanvasNodeType.Image && !data.metadata?.freeResize) || data.type === CanvasNodeType.Video,
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
            <div
                className="relative h-full w-full overflow-visible rounded-3xl border-2"
                style={{
                    background: isWorkspace ? "transparent" : hasImageContent || hasVideoContent ? "transparent" : theme.node.fill,
                    borderColor: hasImageContent ? imageBorderColor : isActive ? selectionBlue : isRelated ? theme.node.muted : theme.node.stroke,
                    boxShadow: isWorkspace ? `inset 0 0 0 1px ${theme.node.stroke}66` : isActive ? `0 0 0 1px ${selectionBlue}55` : isRelated && !isBatchChild ? `0 0 0 1px ${theme.node.muted}55, 0 18px 48px rgba(0,0,0,.14)` : undefined,
                }}
                onMouseDown={(event) => onMouseDown(event, data.id)}
                onDoubleClick={(event) => {
                    if (isBatchRoot) {
                        event.stopPropagation();
                        onToggleBatch?.(data.id);
                        return;
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
                    className={`relative flex h-full w-full items-center justify-center rounded-[inherit] ${isBatchRoot ? "overflow-visible" : "overflow-hidden"}`}
                    style={
                        {
                            background: isWorkspace ? "transparent" : hasImageContent || hasVideoContent ? "transparent" : theme.node.fill,
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
                        onContentChange={onContentChange}
                        onMetadataChange={onMetadataChange}
                        onStoryboardScreenshotImport={onStoryboardScreenshotImport}
                        onStopEditing={() => setIsEditingContent(false)}
                        onRetry={onRetry}
                        onGenerateImage={onGenerateImage}
                        onOpenScript={onOpenScript}
                        onToggleBatch={() => onToggleBatch?.(data.id)}
                        onSetBatchPrimary={() => onSetBatchPrimary?.(data)}
                    />
                </div>

                {showImageInfo && hasImageContent ? <ImageInfoBar node={data} /> : null}
                {resourceLabel ? <ResourceLabelBadge reference={resourceLabel} /> : null}

                {!isWorkspace && !hasImageContent && !hasVideoContent && !hasAudioContent ? <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12" style={{ background: `linear-gradient(to top, ${theme.canvas.background}66, transparent)` }} /> : null}

                <ResizeHandle corner="top-left" onMouseDown={handleResizeMouseDown} />
                <ResizeHandle corner="top-right" onMouseDown={handleResizeMouseDown} />
                <ResizeHandle corner="bottom-left" onMouseDown={handleResizeMouseDown} />
                <ResizeHandle corner="bottom-right" onMouseDown={handleResizeMouseDown} />
            </div>

            {!isWorkspace ? <ConnectionHandleDot side="left" visible={hovered || isSelected || isConnecting} onMouseDown={(event) => onConnectStart(event, data.id, "target")} /> : null}
            {!isWorkspace ? <ConnectionHandleDot side="right" visible={data.type !== CanvasNodeType.Config && (hovered || isSelected || isConnecting)} onMouseDown={(event) => onConnectStart(event, data.id, "source")} /> : null}

            {showPanel && renderPanel ? <div className="absolute left-1/2 top-full z-[70] w-[500px] -translate-x-1/2 pt-4">{renderPanel(data)}</div> : null}
        </div>
    );
});

function NodeContent(props: NodeContentRendererProps) {
    if (props.node.type === CanvasNodeType.Config && props.renderNodeContent) return props.renderNodeContent(props.node);
    if (props.isBatchRoot) return <ImageNodeContent {...props} />;
    if (props.node.type === CanvasNodeType.Video && props.node.metadata?.storyboardSourceNodeId && props.node.metadata?.storyboardRowIndex !== undefined && !props.node.metadata?.content) {
        return <VideoNodeContent {...props} />;
    }
    if (props.node.metadata?.status === "loading") return <LoadingContent theme={props.theme} />;
    if (props.node.metadata?.status === "error") return <ErrorContent node={props.node} theme={props.theme} onRetry={props.onRetry} />;

    const Renderer = nodeContentRenderers[props.node.type];
    return Renderer ? <Renderer {...props} /> : <UnknownNodeContent theme={props.theme} />;
}

const nodeContentRenderers = {
    [CanvasNodeType.Text]: TextContent,
    [CanvasNodeType.Image]: ImageNodeContent,
    [CanvasNodeType.Config]: EmptyImageContent,
    [CanvasNodeType.Video]: VideoNodeContent,
    [CanvasNodeType.Audio]: AudioNodeContent,
    [CanvasNodeType.Script]: ScriptNodeContent,
    [CanvasNodeType.Workspace]: WorkspaceNodeContent,
} satisfies Record<CanvasNodeType, (props: NodeContentRendererProps) => ReactNode>;

function LoadingContent({ theme }: Pick<NodeContentRendererProps, "theme">) {
    return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3" style={{ color: theme.node.activeStroke }}>
            <div className="size-10 animate-spin rounded-full border-2" style={{ borderColor: theme.node.stroke, borderTopColor: theme.node.activeStroke }} />
            <span className="text-[10px] tracking-[0.2em]">生成中</span>
        </div>
    );
}

function ErrorContent({ node, theme, onRetry }: Pick<NodeContentRendererProps, "node" | "theme" | "onRetry">) {
    return (
        <div className="flex max-w-[260px] flex-col items-center gap-3 px-5 text-center">
            <div className="text-xs leading-5 text-red-300">{node.metadata?.errorDetails || "生成失败"}</div>
            <button
                type="button"
                className="inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition hover:scale-[1.02]"
                style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
                onClick={(event) => {
                    event.stopPropagation();
                    onRetry?.(node);
                }}
                onMouseDown={(event) => event.stopPropagation()}
            >
                <RefreshCw className="size-3.5" />
                重试
            </button>
        </div>
    );
}

function UnknownNodeContent({ theme }: Pick<NodeContentRendererProps, "theme">) {
    return (
        <div className="flex h-full w-full items-center justify-center text-sm" style={{ color: theme.node.placeholder }}>
            未知节点
        </div>
    );
}

function TextContent({ node, theme, isEditingContent, textareaRef, mentionReferences, onContentChange, onStopEditing, onGenerateImage }: NodeContentRendererProps) {
    if (node.metadata?.storyboardRows) return <StoryboardTableContent node={node} onContentChange={onContentChange} />;

    const fontSize = node.metadata?.fontSize || 14;
    const textStyle = { fontSize: `${fontSize}px`, lineHeight: `${Math.round(fontSize * 1.65)}px`, color: theme.node.text, boxSizing: "border-box" } as React.CSSProperties;

    return (
        <div className="flex h-full w-full flex-col overflow-hidden pt-8">
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
                    className="thin-scrollbar block h-full w-full resize-none overflow-y-auto whitespace-pre-wrap break-words border-none bg-transparent pl-4 pr-14 pt-0 pb-4 m-0 font-mono outline-none select-text appearance-none"
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
                />
            ) : (
                <div
                    className="thin-scrollbar block h-full w-full overflow-y-auto whitespace-pre-wrap break-words bg-transparent pl-4 pr-14 pt-0 pb-4 font-mono"
                    style={textStyle}
                    onWheel={(event) => event.stopPropagation()}
                >
                    {node.metadata?.content || <span style={{ color: theme.node.placeholder }}>双击编辑文字</span>}
                </div>
            )}
        </div>
    );
}

const STORYBOARD_COLUMNS = ["镜号", "时长", "画面描述", "景别", "光影氛围", "对白旁白", "音效", "运镜", "最终提示词"];
const STORYBOARD_COL_WIDTHS = [64, 70, 300, 76, 210, 260, 180, 190, 250];
const STORYBOARD_ROW_LIMIT = 120;

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

function ResourceLabelBadge({ reference }: { reference: CanvasResourceReference }) {
    return (
        <span className={`pointer-events-none absolute right-2 top-2 z-30 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${reference.active ? "bg-[#2f80ff] text-white shadow-sm" : "bg-black/35 text-white/75"}`}>
            {reference.label}
        </span>
    );
}

function ImageNodeContent(props: NodeContentRendererProps) {
    if (!props.node.metadata?.content && props.isBatchRoot) {
        const content =
            props.node.metadata?.status === "loading" ? (
                <LoadingContent theme={props.theme} />
            ) : props.node.metadata?.status === "error" ? (
                <ErrorContent node={props.node} theme={props.theme} onRetry={props.onRetry} />
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

function VideoNodeContent({ node, theme, storyboardReferenceAssets, onMetadataChange, onRetry }: NodeContentRendererProps) {
    const [referenceEditorOpen, setReferenceEditorOpen] = useState(false);
    const [promptPreviewOpen, setPromptPreviewOpen] = useState(false);
    const isStoryboardVideo = node.metadata?.storyboardSourceNodeId && node.metadata?.storyboardRowIndex !== undefined;
    const isLoading = node.metadata?.status === "loading";
    const isError = node.metadata?.status === "error";

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
            const boundCount = node.metadata?.storyboardAssetReferenceNodeIds?.length || assetLinks.filter((link) => link.status === "bound").length || 0;
            const missingCount = assetLinks.filter((link) => link.status === "missing").length;
            const statusText = isLoading ? "生成中" : isError ? "生成失败" : "待审核";
            const helperText = isError
                ? node.metadata?.errorDetails || "视频生成失败，请检查模型、参考图和提示词后重试"
                : isLoading
                  ? "方舟视频任务会按官方示例每 30 秒查询一次，长时间停留在生成中通常是上游仍在排队或处理。"
                  : boundCount
                    ? `已绑定 ${boundCount} 个资产${missingCount ? `，${missingCount} 个未绑定` : ""}`
                    : missingCount
                      ? `${missingCount} 个资产未绑定，生成时不会传入图片`
                      : "未绑定资产";
            return (
                <div className="flex h-full w-full flex-col gap-3 p-4 text-left" style={{ background: theme.node.fill, color: theme.node.text }}>
                    <div className="flex items-center justify-between gap-2">
                        <span className="rounded-full border px-2 py-0.5 text-[11px] font-semibold" style={{ borderColor: theme.node.stroke }}>
                            第 {(node.metadata?.storyboardRowIndex || 0) + 1} 镜
                        </span>
                        <span className="text-[11px] opacity-55">{statusText}</span>
                    </div>
                    <div className="line-clamp-3 whitespace-pre-wrap text-xs leading-5 opacity-90">{renderStoryboardPromptMentions(node.metadata?.prompt || "等待写入视频提示词", assetLinks, theme)}</div>
                    <div className="mt-auto space-y-2">
                        <StoryboardAssetPreviewStrip items={assetPreviews} />
                        <div className="flex items-center justify-between text-[11px] opacity-60">
                            <span className="line-clamp-2 max-w-[55%] whitespace-pre-wrap">{helperText}</span>
                            <div className="flex items-center gap-1.5">
                                <button type="button" className="rounded px-1.5 py-0.5 hover:bg-white/10" data-canvas-no-zoom onMouseDown={(event) => event.stopPropagation()} onClick={() => setPromptPreviewOpen(true)}>
                                    查看提示词
                                </button>
                                <button type="button" className="rounded px-1.5 py-0.5 hover:bg-white/10" data-canvas-no-zoom onMouseDown={(event) => event.stopPropagation()} onClick={() => setReferenceEditorOpen(true)}>
                                    编辑参考
                                </button>
                                {isError ? (
                                    <button
                                        type="button"
                                        className="rounded px-1.5 py-0.5 hover:bg-white/10"
                                        data-canvas-no-zoom
                                        onMouseDown={(event) => event.stopPropagation()}
                                        onClick={() => onRetry?.(node)}
                                    >
                                        重试
                                    </button>
                                ) : null}
                            </div>
                        </div>
                        <StoryboardVideoPromptPreviewModal
                            node={node}
                            open={promptPreviewOpen}
                            references={assetPreviews}
                            scriptReferences={storyboardReferenceAssets}
                            assetLinks={assetLinks}
                            theme={theme}
                            onClose={() => setPromptPreviewOpen(false)}
                            onConfigChange={(patch) => onMetadataChange(node.id, patch)}
                            onGenerate={(patch) => onRetry?.(node, patch)}
                        />
                        <StoryboardVideoReferenceEditor node={node} open={referenceEditorOpen} references={assetPreviews} scriptReferences={storyboardReferenceAssets} onClose={() => setReferenceEditorOpen(false)} onSave={(references) => onMetadataChange(node.id, storyboardVideoReferencePatch(references))} />
                    </div>
                </div>
            );
        }
        return (
            <div className="flex h-full w-full flex-col items-center justify-center gap-3" style={{ color: theme.node.placeholder }}>
                <Video className="size-7 opacity-35" />
                <span className="text-sm">空视频节点</span>
            </div>
        );
    }
    return <video src={node.metadata.content} controls className="h-full w-full rounded-[18px] bg-black object-contain" data-canvas-no-zoom />;
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

function storyboardVideoAssetPreviews(node: CanvasNodeData, links: StoryboardAssetMentionLink[]) {
    const custom = node.metadata?.storyboardVideoReferences || [];
    if (custom.length) return custom;
    const references = (node.metadata?.references || []).filter(Boolean);
    if (!links.length) return references.map((url, index) => ({ mention: `参考资产 ${index + 1}`, name: `参考资产 ${index + 1}`, status: "bound" as const, url }));
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
                    <div key={item.mention} title={item.status === "bound" ? `${item.mention} 已绑定` : `${item.mention} 未绑定`} className="group relative h-12 w-12 shrink-0 overflow-hidden rounded-lg border" style={{ borderColor: item.status === "bound" ? selectionBlue : "#f59e0b", background: item.status === "bound" ? `${selectionBlue}1a` : "rgba(245, 158, 11, .12)" }}>
                        {item.url || item.storageKey ? <StoryboardAssetPreviewImage src={item.storageKey || item.url || ""} alt={item.name || item.mention} /> : <div className="flex h-full w-full items-center justify-center px-1 text-center text-[10px] leading-3 text-amber-200">未绑定</div>}
                        <div className="absolute left-0.5 top-0.5 rounded bg-black/70 px-1 text-[9px] font-semibold text-white">{STORYBOARD_VIDEO_REFERENCE_ROLE_TEXT[item.role || "reference"].slice(0, 1)}</div>
                        <div className="absolute inset-x-0 bottom-0 truncate bg-black/70 px-1 py-0.5 text-[9px] font-semibold text-white">{item.mention}</div>
                    </div>
                ))}
                {items.length > 5 ? <div className="flex h-12 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 text-[10px] opacity-60">+{items.length - 5}</div> : null}
            </div>
        </div>
    );
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
    assetLinks: StoryboardAssetMentionLink[];
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    onClose: () => void;
    onConfigChange: (patch: Partial<CanvasNodeMetadata>) => void;
    onGenerate: (patch: Partial<CanvasNodeMetadata>) => void;
}) {
    const globalConfig = useEffectiveConfig();
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const assets = useAssetStore((state) => state.assets);
    const imageAssets = assets.filter((asset): asset is ImageAsset => asset.kind === "image");
    const prompt = node.metadata?.prompt || "";
    const continuityPrompt = storyboardVideoFrameContinuityPrompt(references);
    const autoFinalPrompt = storyboardVideoFinalPrompt(prompt, references);
    const referencesKey = references.map((item) => `${item.mention}:${item.role || "reference"}:${item.status}:${item.storageKey || item.url || ""}`).join("|");
    const [draftConfig, setDraftConfig] = useState(() => buildStoryboardVideoNodeConfig(globalConfig, node));
    const [draftFinalPrompt, setDraftFinalPrompt] = useState(node.metadata?.storyboardVideoFinalPrompt || autoFinalPrompt);
    const referenceCandidates = storyboardReferenceAssetCandidates(references, scriptReferences, imageAssets);
    const draftReferences = storyboardVideoReferencesFromPrompt(draftFinalPrompt, references, referenceCandidates);
    const draftAssetLinks = draftReferences.map(storyboardReferenceToMentionLink);
    const orderedReferences = sortStoryboardVideoReferences(draftReferences);
    const mentionReferences = storyboardReferencesToCanvasResources([...referenceCandidates, ...draftReferences]);
    const credits = requestCreditCost({ channelMode: draftConfig.channelMode, model: draftConfig.model, count: 1 });

    useEffect(() => {
        if (!open) return;
        setDraftConfig(buildStoryboardVideoNodeConfig(globalConfig, node));
        setDraftFinalPrompt(node.metadata?.storyboardVideoFinalPrompt || storyboardVideoFinalPrompt(node.metadata?.prompt || "", references));
    }, [globalConfig, node.id, node.metadata?.prompt, node.metadata?.storyboardVideoFinalPrompt, open, referencesKey]);

    const updateDraftConfig = (patch: Partial<AiConfig>) => {
        setDraftConfig((current) => ({ ...current, ...patch }));
    };
    const generate = () => {
        const patch = { ...storyboardVideoReferencePatch(draftReferences), ...storyboardVideoConfigPatch(draftConfig, prompt, draftFinalPrompt.trim()) };
        onConfigChange(patch);
        onGenerate(patch);
        onClose();
    };

    return (
        <Modal
            className="storyboard-video-prompt-modal"
            title={<CanvasModalTitle title={`第 ${(node.metadata?.storyboardRowIndex || 0) + 1} 镜最终生成提示词`} onClose={onClose} />}
            open={open}
            onCancel={onClose}
            footer={null}
            mask={{ closable: true }}
            keyboard
            width={900}
            destroyOnHidden
            closable={false}
            modalRender={renderCanvasModal}
        >
            <div className="space-y-5" data-canvas-no-zoom onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
                <div className="rounded-xl border border-blue-500/25 bg-blue-500/10 px-3 py-2 text-xs leading-5 text-blue-600 dark:text-blue-200">
                    卡片上方只是截断预览；点击这里的“生成视频”时，以本页最终生成提示词和下方参考图数组为准。@ 名称用于绑定和识别资产，传给模型时会变成参考图 + 文本提示词。
                </div>
                <section className="rounded-xl border border-stone-200 bg-stone-50 p-3 dark:border-stone-700 dark:bg-stone-950/60">
                    <div className="mb-2 text-sm font-semibold">视频生成设置</div>
                    <div className="flex flex-wrap items-center gap-2">
                        <ModelPicker config={draftConfig} value={draftConfig.model} capability="video" className="!h-9 !min-w-[190px] !max-w-[260px]" onChange={(model) => updateDraftConfig({ model })} onMissingConfig={() => openConfigDialog(true)} />
                        <CanvasVideoSettingsPopover
                            config={draftConfig}
                            placement="bottomLeft"
                            buttonClassName="!h-9 !min-w-[190px] !max-w-[260px] !justify-start !rounded-full !px-3"
                            onConfigChange={(key, value) => updateDraftConfig({ [key]: value } as Partial<AiConfig>)}
                        />
                    </div>
                </section>
                <section>
                    <div className="mb-2 text-sm font-semibold">原始视频运动提示词</div>
                    <div className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs leading-5 text-stone-500 dark:border-stone-700 dark:bg-stone-950/60 dark:text-stone-400">
                        原始提示词已作为初稿填入下方；请直接修改“最终生成提示词”，视频生成只以下方内容为准。
                    </div>
                </section>
                <section>
                    <div className="mb-2 flex items-center justify-between">
                        <div className="text-sm font-semibold">参考资产</div>
                        <span className="text-xs text-stone-500">顺序：首帧 → 参考 → 尾帧</span>
                    </div>
                    {orderedReferences.length ? (
                        <div className="grid grid-cols-3 gap-3">
                            {orderedReferences.map((item, index) => (
                                <div key={`${item.mention}-${index}`} className="overflow-hidden rounded-xl border border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-900">
                                    <div className="relative aspect-[4/3] bg-stone-100 dark:bg-stone-800">
                                        {item.url || item.storageKey ? <StoryboardAssetPreviewImage src={item.storageKey || item.url || ""} alt={item.name || item.mention} /> : <div className="flex h-full items-center justify-center text-xs text-amber-500">未绑定图片</div>}
                                        <div className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-semibold text-white">{STORYBOARD_VIDEO_REFERENCE_ROLE_TEXT[item.role || "reference"]}</div>
                                    </div>
                                    <div className="space-y-1 px-2 py-2 text-xs">
                                        <div className="truncate font-semibold">{item.mention}</div>
                                        <div className="truncate text-stone-500">{item.status === "bound" ? "已作为参考图传入" : "未绑定，生成时不会传入图片"}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前没有参考资产" />
                    )}
                </section>
                {continuityPrompt ? (
                    <section>
                        <div className="mb-2 text-sm font-semibold">首尾帧连续性补充</div>
                        <PromptPreviewBox>{renderStoryboardPromptMentions(continuityPrompt, assetLinks, theme)}</PromptPreviewBox>
                    </section>
                ) : null}
                <section>
                    <div className="mb-2 flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold">最终生成提示词</div>
                        <span className="text-xs text-stone-500">可手动修改，@ 资产会自动尝试绑定到参考图</span>
                    </div>
                    <CanvasResourceMentionTextarea
                        value={draftFinalPrompt}
                        references={mentionReferences}
                        onChange={setDraftFinalPrompt}
                        className="thin-scrollbar h-40 w-full resize-y rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs leading-5 text-stone-700 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-stone-700 dark:bg-stone-950/60 dark:text-stone-200"
                        placeholder="请输入最终发送给视频模型的提示词"
                        data-canvas-no-zoom
                        onPointerDown={(event) => event.stopPropagation()}
                        onMouseDown={(event) => event.stopPropagation()}
                        onWheel={(event) => event.stopPropagation()}
                    />
                    <div className="mt-2 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs leading-5 text-stone-700 dark:border-stone-700 dark:bg-stone-950/60 dark:text-stone-200">
                        <div className="mb-1 text-[11px] font-semibold text-stone-500">高亮预览</div>
                        <div className="whitespace-pre-wrap">{draftFinalPrompt ? renderStoryboardPromptMentions(draftFinalPrompt, draftAssetLinks, theme) : <span className="text-stone-400">暂无最终提示词</span>}</div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                        {draftAssetLinks.length ? draftAssetLinks.map((link) => <StoryboardAssetChip key={link.mention} link={link} compact theme={theme} />) : <span className="text-xs text-stone-500">暂未识别到 @ 资产</span>}
                    </div>
                </section>
                <div className="flex items-center justify-between border-t border-stone-200 pt-4 dark:border-stone-800">
                    <span className="text-xs text-stone-500">点击生成后会关闭确认页，并把视频结果写回当前待审核节点。</span>
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
        </Modal>
    );
}

function PromptPreviewBox({ children, emptyText = "暂无内容" }: { children?: ReactNode; emptyText?: string }) {
    return <div className="max-h-52 overflow-auto whitespace-pre-wrap rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs leading-5 text-stone-700 dark:border-stone-700 dark:bg-stone-950/60 dark:text-stone-200">{children || <span className="text-stone-400">{emptyText}</span>}</div>;
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

function storyboardVideoReferencesFromPrompt(prompt: string, current: StoryboardVideoReference[], candidates: StoryboardVideoReference[]) {
    const mentions = storyboardPromptMentions(prompt);
    if (!mentions.length) return current;
    const candidateByMention = new Map(candidates.map((item) => [item.mention, item]));
    const currentByMention = new Map(current.map((item) => [item.mention, item]));
    return mentions.map((mention) => {
        const matched = currentByMention.get(mention) || candidateByMention.get(mention);
        if (matched) return { ...matched, mention, name: matched.name || mention.replace(/^@/, ""), role: matched.role || "reference", status: matched.status || ("bound" as const) };
        return { mention, name: mention.replace(/^@/, ""), role: "reference" as const, status: "missing" as const };
    });
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

function storyboardPromptMentions(text: string) {
    return Array.from(new Set(Array.from(text.matchAll(/@([^\s@，、。；;：:,.!?！？()[\]{}]+)/g)).map((match) => normalizeStoryboardMention(match[1])))).filter(Boolean);
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

function storyboardVideoFinalPrompt(prompt: string, references: StoryboardVideoReference[]) {
    const continuityPrompt = storyboardVideoFrameContinuityPrompt(references);
    return continuityPrompt ? `${prompt}\n\n${continuityPrompt}`.trim() : prompt;
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

function StoryboardVideoReferenceEditor({ node, open, references, scriptReferences, onClose, onSave }: { node: CanvasNodeData; open: boolean; references: StoryboardVideoReference[]; scriptReferences: StoryboardVideoReference[]; onClose: () => void; onSave: (references: StoryboardVideoReference[]) => void }) {
    const assets = useAssetStore((state) => state.assets);
    const imageAssets = assets.filter((asset): asset is ImageAsset => asset.kind === "image");
    const [draft, setDraft] = useState<StoryboardVideoReference[]>(references);

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
            return [...current, { ...reference, mention, name: mention.replace(/^@/, ""), role, status: "bound" }];
        });
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
                    message="方舟 Seedance 对真人脸参考图限制较严"
                    description="AI 生成图如果高度写实、像真人演员定妆照，也可能被识别为真人脸并拒绝生成。建议换成更明显的二次元、3D 卡通、非真人虚拟角色，或使用方舟授权素材。"
                />
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
                    {scriptReferences.length ? (
                        <ReferenceSourceGrid items={scriptReferences} onAdd={addReference} />
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
            </div>
            <audio src={node.metadata.content} controls className="w-full" data-canvas-no-zoom />
        </div>
    );
}

function ScriptNodeContent({ node, theme, onOpenScript }: NodeContentRendererProps) {
    const rows = normalizeStoryboardRows(node.metadata?.storyboardRows);
    const assets = node.metadata?.storyboardAssets || [];
    const promptDetails = node.metadata?.storyboardPromptDetails || {};
    const filledRows = rows.filter((row) => row.some((cell, index) => index > 1 && cell.trim())).length;
    const isReady = filledRows > 0;
    const readyAssets = assets.filter((asset) => asset.imageUrl || asset.storageKey).length;
    const assetsDone = assets.length > 0 && readyAssets === assets.length;
    const promptCount = rows.filter((_, index) => {
        const detail = promptDetails[String(index)];
        return detail?.storyboardPrompt?.trim() || detail?.videoMotionPrompt?.trim();
    }).length;
    const promptsDone = promptCount === rows.length && rows.length > 0;
    const statusText = promptsDone ? `${promptCount} 个提示词已合成` : assets.length ? `${readyAssets}/${assets.length} 个资产已准备` : filledRows ? `${filledRows} 个镜头已生成` : "生成后在大表格中确认镜头";

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
                    <ScriptStep active done={isReady} index="1" label="确认镜头" />
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
    const workspaceLabel = node.metadata?.workspaceKind === "storyboard-assets" ? "资产工作区" : node.metadata?.workspaceKind === "character-references" ? "角色基准图" : "视频工作区";
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

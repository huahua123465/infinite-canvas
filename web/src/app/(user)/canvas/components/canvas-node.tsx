"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Boxes, ChevronRight, FileText, Image as ImageIcon, Music2, RefreshCw, Star, Video } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { formatBytes } from "@/lib/image-utils";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasResourceMentionTextarea } from "./canvas-resource-mention-textarea";
import { CanvasNodeType, type CanvasNodeData, type Position } from "../types";
import type { CanvasResourceReference } from "../utils/canvas-resource-references";

type ResizeCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";
const selectionBlue = "#2f80ff";
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
    onContentChange: (nodeId: string, content: string, storyboardRows?: string[][]) => void;
    onStoryboardScreenshotImport?: (node: CanvasNodeData, file: File, model?: string) => Promise<StoryboardImportPreview | null>;
    onToggleBatch?: (nodeId: string) => void;
    onSetBatchPrimary?: (node: CanvasNodeData) => void;
    onRetry?: (node: CanvasNodeData) => void;
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
    onStoryboardScreenshotImport?: (node: CanvasNodeData, file: File, model?: string) => Promise<StoryboardImportPreview | null>;
    onStopEditing: () => void;
    mentionReferences: CanvasResourceReference[];
    onRetry?: (node: CanvasNodeData) => void;
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
            className={`node-element absolute flex select-none flex-col transition-shadow duration-200 ${isSelected ? "z-50" : "z-10"}`}
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
                        onContentChange={onContentChange}
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

            <ConnectionHandleDot side="left" visible={hovered || isSelected || isConnecting} onMouseDown={(event) => onConnectStart(event, data.id, "target")} />
            <ConnectionHandleDot side="right" visible={data.type !== CanvasNodeType.Config && (hovered || isSelected || isConnecting)} onMouseDown={(event) => onConnectStart(event, data.id, "source")} />

            {showPanel && renderPanel ? <div className="absolute left-1/2 top-full z-[70] w-[500px] -translate-x-1/2 pt-4">{renderPanel(data)}</div> : null}
        </div>
    );
});

function NodeContent(props: NodeContentRendererProps) {
    if (props.node.type === CanvasNodeType.Config && props.renderNodeContent) return props.renderNodeContent(props.node);
    if (props.isBatchRoot) return <ImageNodeContent {...props} />;
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
    return renumberStoryboardRows(body.map((row, index) => STORYBOARD_COLUMNS.map((_, colIndex) => row[colIndex] || (colIndex === 0 ? `${index + 1}` : colIndex === 1 ? "5s" : ""))).slice(0, 30));
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

function VideoNodeContent({ node, theme }: NodeContentRendererProps) {
    if (!node.metadata?.content)
        return (
            <div className="flex h-full w-full flex-col items-center justify-center gap-3" style={{ color: theme.node.placeholder }}>
                <Video className="size-7 opacity-35" />
                <span className="text-sm">空视频节点</span>
            </div>
        );
    return <video src={node.metadata.content} controls className="h-full w-full rounded-[18px] bg-black object-contain" data-canvas-no-zoom />;
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
    const filledRows = rows.filter((row) => row.some((cell, index) => index > 1 && cell.trim())).length;
    const isReady = filledRows > 0;

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
                    <ScriptStep active={isReady} index="2" label="准备资产" />
                    <ScriptStep active={isReady} index="3" label="合成提示词" />
                </div>
                <div className="text-xs opacity-60">{filledRows ? `${filledRows} 个镜头已生成` : "生成后在大表格中确认镜头"}</div>
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
    const isAssetWorkspace = node.metadata?.workspaceKind === "storyboard-assets";
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
                    {isAssetWorkspace ? "资产工作区" : "视频工作区"} · {childCount}
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

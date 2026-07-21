import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUp, Clipboard, ImagePlus, LoaderCircle, Maximize2, Minimize2, Plus, Replace, Sparkles, Square, X } from "lucide-react";
import { App, Button, InputNumber, Select } from "antd";

import { ModelPicker } from "@/components/model-picker";
import { defaultConfig, modelOptionName, resolveModelRequestConfig, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { CreditSymbol, requestCreditCost } from "@/constant/credits";
import { normalizeAudioVoiceForProvider } from "@/lib/audio-provider";
import { canvasThemes } from "@/lib/canvas-theme";
import { isSeedanceMini8sModel, seedanceModelFixedResolution } from "@/lib/seedance-video";
import { isOmniImageVideoModel, isOmniVideoToVideoModel, isSoraVideoModel, isVeoVideoModel } from "@/lib/video-model-capabilities";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasImageSettingsPopover } from "./canvas-image-settings-popover";
import { CanvasPromptLibrary } from "./canvas-prompt-library";
import { CanvasAudioSettingsPopover, type CanvasAudioSettingKey } from "./canvas-audio-settings-popover";
import { CanvasPromptChipInput } from "./canvas-prompt-chip-input";
import { CanvasVideoSettingsPopover } from "./canvas-video-settings-popover";
import { CanvasNodeType, STORYBOARD_VIDEO_PROMPT_PREVIEW_EVENT, type CanvasGenerationMode, type CanvasNodeData, type CanvasNodeMetadata, type StoryboardProductionMode, type StoryboardProductionScope } from "@/types/canvas";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";

export type CanvasNodeGenerationMode = CanvasGenerationMode;

type CanvasNodePromptPanelProps = {
    node: CanvasNodeData;
    isRunning: boolean;
    onPromptChange: (nodeId: string, prompt: string) => void;
    onConfigChange: (nodeId: string, patch: Partial<CanvasNodeMetadata>) => void;
    onGenerate: (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string, options?: { useCurrentImageAsReference?: boolean }) => void;
    onStop: (nodeId: string) => void;
    mentionReferences?: CanvasResourceReference[];
    onImageSettingsOpenChange?: (open: boolean) => void;
    onPromptAssistant?: (node: CanvasNodeData) => void;
    onApplyPromptAssistantPending?: (node: CanvasNodeData, mode: "append" | "replace") => void;
    onDiscardPromptAssistantPending?: (nodeId: string) => void;
    modeOverride?: CanvasNodeGenerationMode;
};

export function CanvasNodePromptPanel({ node, isRunning, onPromptChange, onConfigChange, onGenerate, onStop, mentionReferences = [], onImageSettingsOpenChange, onPromptAssistant, onApplyPromptAssistantPending, onDiscardPromptAssistantPending, modeOverride }: CanvasNodePromptPanelProps) {
    const { message } = App.useApp();
    const globalConfig = useEffectiveConfig();
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const updateGlobalConfig = useConfigStore((state) => state.updateConfig);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const mode = modeOverride ?? defaultMode(node.type);
    const config = buildNodeConfig(globalConfig, node, mode);
    const hasTextContent = node.type === CanvasNodeType.Text && Boolean(node.metadata?.content?.trim());
    const isScriptNode = node.type === CanvasNodeType.Script;
    const scriptVideoConfig = isScriptNode ? buildScriptVideoConfig(globalConfig, node) : null;
    const productionScope = node.metadata?.storyboardProductionScope || "single";
    const productionMode = node.metadata?.storyboardProductionMode || "documentary";
    const isStoryboardVideo = node.type === CanvasNodeType.Video && Boolean(node.metadata?.storyboardSourceNodeId) && node.metadata?.storyboardRowIndex !== undefined;
    const hasImageContent = node.type === CanvasNodeType.Image && Boolean(node.metadata?.content);
    const panelRef = useRef<HTMLDivElement | null>(null);
    const [prompt, setPrompt] = useState(hasTextContent ? "" : node.metadata?.prompt || "");
    const [promptExpanded, setPromptExpanded] = useState(false);
    const [promptComposerOpen, setPromptComposerOpen] = useState(false);
    const promptEditorHeight = promptExpanded ? 220 : 96;
    const credits = requestCreditCost({ channelMode: config.channelMode, model: config.model, count: mode === "image" ? config.count : 1 });
    const updateModel = (model: string) => onConfigChange(node.id, mode === "video" ? videoModelPatch(model) : mode === "audio" ? audioModelPatch(config, model) : { model });
    const useApiReferenceLabels = mode === "video" && isCangyuanSeedanceConfig(config);
    const promptMentionReferences = useMemo(() => (useApiReferenceLabels ? mentionReferences.map(toCangyuanReferenceLabel) : mentionReferences), [mentionReferences, useApiReferenceLabels]);
    const activeImageReferences = promptMentionReferences.filter((item) => item.kind === "image" && item.active);
    const mentionedImageLabels = activeImageReferences.filter((item) => promptIncludesReferenceLabel(prompt, item.label)).map((item) => item.label);
    const promptAssistantPendingPrompt = node.metadata?.promptAssistantPendingPrompt?.trim() || "";
    const promptAssistantStatus = node.metadata?.promptAssistantStatus;
    const canUseCurrentImageAsReference = mode === "image" && node.type === CanvasNodeType.Image && Boolean(node.metadata?.content && node.metadata?.generationType);

    useEffect(() => {
        setPrompt(hasTextContent ? "" : node.metadata?.prompt || "");
        setPromptExpanded(false);
        setPromptComposerOpen(false);
    }, [hasTextContent, node.id]);

    useEffect(() => {
        const nextPrompt = hasTextContent ? "" : node.metadata?.prompt || "";
        setPrompt((current) => (current === nextPrompt ? current : nextPrompt));
    }, [hasTextContent, node.metadata?.prompt]);

    const updatePrompt = (value: string) => {
        setPrompt(value);
        if (!hasTextContent) onPromptChange(node.id, value);
    };

    useEffect(() => {
        if (!useApiReferenceLabels) return;
        const nextPrompt = normalizeCangyuanReferenceMentions(prompt);
        if (nextPrompt === prompt) return;
        setPrompt(nextPrompt);
        if (!hasTextContent) onPromptChange(node.id, nextPrompt);
    }, [hasTextContent, node.id, onPromptChange, prompt, useApiReferenceLabels]);

    const submit = () => {
        const text = prompt.trim();
        if ((!text && !isScriptNode) || isRunning) return;
        if (isStoryboardVideo) {
            window.dispatchEvent(new CustomEvent(STORYBOARD_VIDEO_PROMPT_PREVIEW_EVENT, { detail: node.id }));
            return;
        }
        onGenerate(node.id, mode, text);
        setPrompt("");
    };

    const collapsePromptEditorIfFocusLeft = () => {
        window.setTimeout(() => {
            const activeElement = document.activeElement;
            if (activeElement && panelRef.current?.contains(activeElement)) return;
            setPromptExpanded(false);
        }, 0);
    };

    if (isStoryboardVideo) return null;

    const renderPromptTextarea = (large = false) => (
        <CanvasPromptChipInput
            value={prompt}
            references={promptMentionReferences}
            onChange={updatePrompt}
            onSubmit={submit}
            onFocus={() => setPromptExpanded(true)}
            onBlur={collapsePromptEditorIfFocusLeft}
            onWheel={(event) => {
                event.stopPropagation();
                if (!promptExpanded && !large) return;
                const target = event.currentTarget;
                if (target.scrollHeight <= target.clientHeight) return;
                event.preventDefault();
                target.scrollTop += event.deltaY;
            }}
            onPointerDown={(event) => event.stopPropagation()}
            className={`thin-scrollbar w-full min-h-0 cursor-text resize-none rounded-xl px-3 py-2 text-sm leading-5 outline-none ${large ? "h-full" : "pr-10 transition-[height] duration-150"}`}
            style={{ background: "transparent", color: theme.node.text, caretColor: theme.toolbar.activeText, height: large ? "100%" : promptEditorHeight, maxHeight: large ? "100%" : 220, overflowY: large || promptExpanded ? "auto" : "hidden" }}
            placeholder={isScriptNode ? "脚本节点会优先读取连入的剧本文本；这里可留空，点击规划分集片段" : promptPlaceholder(mode, hasImageContent, hasTextContent)}
        />
    );

    const renderReferenceHint = () => (
        <>
            {mode === "image" && activeImageReferences.length ? (
                <div className="mt-1.5 text-[11px] opacity-60">
                    将传入参考图：{activeImageReferences.map((item) => item.label).join("、")}
                    {mentionedImageLabels.length ? `；已 @ 引用：${mentionedImageLabels.join("、")}` : "；输入 @ 可点选图片标签来指定描述对象"}
                </div>
            ) : null}
            {mode === "video" && activeImageReferences.length ? <div className="mt-1.5 text-[11px] opacity-60">主参考图：@{activeImageReferences[0].label}。第一张连入或 @ 引用的图片会作为视频主视觉参考。</div> : null}
        </>
    );

    const copyPromptAssistantPending = () => {
        if (!promptAssistantPendingPrompt) return;
        void navigator.clipboard?.writeText(promptAssistantPendingPrompt).then(
            () => message.success("已复制AI优化结果"),
            () => message.error("复制失败"),
        );
    };

    const renderPromptAssistantPending = () => {
        if (promptAssistantStatus === "loading") {
            return (
                <div className="mt-2 flex items-center gap-2 rounded-xl border px-3 py-2 text-xs" style={{ background: theme.node.fill, borderColor: theme.node.stroke, color: theme.node.muted }}>
                    <LoaderCircle className="size-3.5 animate-spin" />
                    <span>AI正在优化提示词，关闭弹窗也会继续完成。</span>
                </div>
            );
        }
        if (promptAssistantStatus === "error" && node.metadata?.promptAssistantError) {
            return (
                <div className="mt-2 rounded-xl border px-3 py-2 text-xs" style={{ background: theme.node.fill, borderColor: theme.node.stroke, color: theme.node.muted }}>
                    <div className="flex items-start justify-between gap-2">
                        <span className="leading-5">AI优化失败：{node.metadata.promptAssistantError}</span>
                        <Button size="small" type="text" className="!h-7 !px-2" icon={<X className="size-3.5" />} onClick={() => onDiscardPromptAssistantPending?.(node.id)}>
                            忽略
                        </Button>
                    </div>
                </div>
            );
        }
        if (!promptAssistantPendingPrompt) return null;
        return (
            <div className="mt-2 rounded-xl border px-3 py-2 text-xs" style={{ background: theme.node.fill, borderColor: theme.node.stroke, color: theme.node.text }}>
                <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="font-medium">AI优化结果待处理</span>
                    <Button size="small" type="text" className="!h-7 !px-2" icon={<X className="size-3.5" />} onClick={() => onDiscardPromptAssistantPending?.(node.id)}>
                        忽略
                    </Button>
                </div>
                <div className="thin-scrollbar max-h-16 overflow-auto whitespace-pre-wrap leading-5 opacity-75">{promptAssistantPendingPrompt}</div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                    <Button size="small" icon={<Plus className="size-3.5" />} onClick={() => onApplyPromptAssistantPending?.(node, "append")}>
                        追加到尾部
                    </Button>
                    <Button size="small" icon={<Replace className="size-3.5" />} onClick={() => onApplyPromptAssistantPending?.(node, "replace")}>
                        替换
                    </Button>
                    <Button size="small" icon={<Clipboard className="size-3.5" />} onClick={copyPromptAssistantPending}>
                        复制
                    </Button>
                </div>
            </div>
        );
    };

    const renderPromptControls = () => (
        <div className="mt-2 flex min-w-0 flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                {isScriptNode ? null : <CanvasPromptLibrary onSelect={updatePrompt} />}
                {onPromptAssistant ? (
                    <Button className="!h-10 shrink-0 !rounded-full !px-3" icon={<Sparkles className="size-4" />} onClick={() => onPromptAssistant(node)}>
                        {isScriptNode ? "AI生成项目设定" : "AI改提示词"}
                    </Button>
                ) : null}
                {mode === "image" ? (
                    <>
                        <ModelPicker config={config} value={config.model} onChange={updateModel} capability="image" className="!h-10 !min-w-[130px] !max-w-[170px] flex-1" onMissingConfig={() => openConfigDialog(true)} />
                        <CanvasImageSettingsPopover
                            config={config}
                            placement="topLeft"
                            buttonClassName="!h-10 !min-w-[130px] !max-w-[170px] !justify-start !rounded-full !px-3"
                            onConfigChange={(key, value) => onConfigChange(node.id, key === "count" ? { count: Number(value) || 1 } : { [key]: value })}
                            onMissingConfig={() => openConfigDialog(true)}
                            onOpenChange={onImageSettingsOpenChange}
                        />
                    </>
                ) : mode === "video" ? (
                    <>
                        <ModelPicker config={config} value={config.model} onChange={updateModel} capability="video" estimateSeconds={config.videoSeconds} className="!h-10 !min-w-[130px] !max-w-[170px] flex-1" onMissingConfig={() => openConfigDialog(true)} />
                        <CanvasVideoSettingsPopover config={config} buttonClassName="!h-10 !min-w-[130px] !max-w-[170px] !justify-start !rounded-full !px-3" onConfigChange={(key, value) => onConfigChange(node.id, videoConfigPatch(key, value))} onModelChange={(model) => onConfigChange(node.id, videoModelPatch(model))} />
                    </>
                ) : mode === "audio" ? (
                    <>
                        <ModelPicker config={config} value={config.model} onChange={updateModel} capability="audio" className="!h-10 !min-w-[130px] !max-w-[170px] flex-1" onMissingConfig={() => openConfigDialog(true)} />
                        <CanvasAudioSettingsPopover config={config} buttonClassName="!h-10 !min-w-[130px] !max-w-[170px] !justify-start !rounded-full !px-3" onConfigChange={(key, value) => onConfigChange(node.id, audioConfigPatch(key, value))} />
                    </>
                ) : (
                    <>
                        {isScriptNode ? (
                            <>
                                <Select value={productionScope} className="min-w-[150px]" options={STORYBOARD_PRODUCTION_SCOPE_OPTIONS} onChange={(value: StoryboardProductionScope) => onConfigChange(node.id, { storyboardProductionScope: value })} />
                                <Select
                                    value={productionMode}
                                    className="min-w-[190px]"
                                    options={STORYBOARD_PRODUCTION_MODE_OPTIONS}
                                    onChange={(value: StoryboardProductionMode) => onConfigChange(node.id, { storyboardProductionMode: value })}
                                />
                                <InputNumber min={60} max={300} step={30} value={node.metadata?.storyboardEpisodeDurationSeconds || 90} className="!w-28" addonAfter="秒/集" onChange={(value) => onConfigChange(node.id, { storyboardEpisodeDurationSeconds: Number(value) || 90 })} />
                                {productionMode === "custom" ? (
                                    <InputNumber min={2} max={30} value={node.metadata?.storyboardCustomVideoBudget || 8} className="!w-32" addonAfter="片段/集" onChange={(value) => onConfigChange(node.id, { storyboardCustomVideoBudget: Number(value) || 8 })} />
                                ) : null}
                            </>
                        ) : null}
                        <ModelPicker config={config} value={config.model} onChange={updateModel} capability="text" className="!h-10 !min-w-[130px] !max-w-[170px] flex-1" onMissingConfig={() => openConfigDialog(true)} />
                        {scriptVideoConfig ? (
                            <CanvasVideoSettingsPopover
                                config={scriptVideoConfig}
                                buttonClassName="!h-10 !min-w-[96px] !max-w-[118px] !justify-start !rounded-full !px-3"
                                smartDurationLabel="按分镜"
                                smartDurationHint="后续视频将按分镜表逐镜读取时长"
                                onConfigChange={(key, value) => onConfigChange(node.id, videoConfigPatch(key, value))}
                                onModelChange={(model) => updateGlobalConfig("videoModel", model)}
                            />
                        ) : null}
                    </>
                )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
                {canUseCurrentImageAsReference && !isRunning ? (
                    <Button className="!h-10 !rounded-full !px-3" icon={<ImagePlus className="size-4" />} disabled={!prompt.trim()} title="基于当前结果图继续图生图修改" onClick={() => onGenerate(node.id, mode, prompt.trim(), { useCurrentImageAsReference: true })}>
                        续修
                    </Button>
                ) : null}
                <Button
                    type="primary"
                    className="!h-10 !min-w-16 !rounded-full !px-3"
                    danger={isRunning}
                    disabled={!isRunning && !prompt.trim() && !isScriptNode}
                    onClick={() => (isRunning ? onStop(node.id) : submit())}
                    aria-label={isRunning ? "停止生成" : "生成"}
                    title={canUseCurrentImageAsReference ? "重新生成一版，优先使用原始参考图" : undefined}
                >
                    <span className="flex items-center gap-1.5">
                        {isRunning ? (
                            <>
                                <LoaderCircle className="size-4 animate-spin" />
                                <Square className="size-3.5 fill-current" />
                                <span className="text-xs font-medium">停止</span>
                            </>
                        ) : (
                            <>
                                <span className="inline-flex items-center gap-1 text-xs font-medium tabular-nums">
                                    <CreditSymbol />
                                    {credits.toLocaleString()}
                                </span>
                                <ArrowUp className="size-4" />
                            </>
                        )}
                    </span>
                </Button>
            </div>
        </div>
    );

    return (
        <>
            <div
                ref={panelRef}
                className="relative max-h-[min(70vh,640px)] overflow-hidden rounded-2xl border p-3 shadow-2xl backdrop-blur"
                style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                onWheel={(event) => event.stopPropagation()}
            >
                <Button type="text" className="!absolute !right-4 !top-4 z-10 !grid !size-8 !place-items-center !rounded-lg !p-0" style={{ color: theme.node.muted }} title="放大编辑提示词" icon={<Maximize2 className="size-4" />} onClick={() => setPromptComposerOpen(true)} />
                {renderPromptTextarea()}
                {renderReferenceHint()}
                {renderPromptAssistantPending()}
                {renderPromptControls()}
            </div>
            {promptComposerOpen
                ? createPortal(
                    <div className="fixed inset-0 z-[1100] bg-black/25 backdrop-blur-[1px]" data-canvas-no-zoom onPointerDown={() => setPromptComposerOpen(false)} onWheel={(event) => event.stopPropagation()}>
                        <div
                            className="absolute left-1/2 top-1/2 flex h-[min(76vh,680px)] w-[min(760px,calc(100vw-48px))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border p-3 shadow-2xl"
                            style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
                            onMouseDown={(event) => event.stopPropagation()}
                            onPointerDown={(event) => event.stopPropagation()}
                            onWheel={(event) => event.stopPropagation()}
                        >
                            <Button type="text" className="!absolute !right-4 !top-4 z-10 !grid !size-8 !place-items-center !rounded-lg !p-0" style={{ color: theme.node.muted }} title="收起提示词编辑器" icon={<Minimize2 className="size-4" />} onClick={() => setPromptComposerOpen(false)} />
                            <div className="min-h-0 flex-1 overflow-hidden pr-10">
                                {renderPromptTextarea(true)}
                            </div>
                            {renderReferenceHint()}
                            {renderPromptAssistantPending()}
                            {renderPromptControls()}
                        </div>
                    </div>,
                    document.body,
                )
                : null}
        </>
    );
}

const STORYBOARD_PRODUCTION_MODE_OPTIONS = [
    { value: "economy", label: "节省成本（每集约4-6片段）" },
    { value: "documentary", label: "标准漫剧（每集约6-9片段）" },
    { value: "detailed", label: "细拍漫剧（每集约8-12片段）" },
    { value: "custom", label: "自定义" },
];

const STORYBOARD_PRODUCTION_SCOPE_OPTIONS = [
    { value: "single", label: "单集浓缩（推荐）" },
    { value: "series", label: "完整系列" },
];

function defaultMode(type: CanvasNodeData["type"]): CanvasNodeGenerationMode {
    return type === CanvasNodeType.Text || type === CanvasNodeType.Script ? "text" : type === CanvasNodeType.Video ? "video" : type === CanvasNodeType.Audio ? "audio" : "image";
}

function buildNodeConfig(globalConfig: AiConfig, node: CanvasNodeData, mode: CanvasNodeGenerationMode): AiConfig {
    const defaultModel = mode === "image" ? globalConfig.imageModel : mode === "video" ? globalConfig.videoModel : mode === "audio" ? globalConfig.audioModel : globalConfig.textModel;
    return {
        ...globalConfig,
        model: node.metadata?.model || defaultModel || (mode === "audio" ? defaultConfig.audioModel : globalConfig.model || defaultConfig.model),
        quality: node.metadata?.quality || globalConfig.quality || defaultConfig.quality,
        size: node.metadata?.size || globalConfig.size || defaultConfig.size,
        background: node.metadata?.background ?? globalConfig.background ?? defaultConfig.background,
        videoSeconds: node.metadata?.seconds || globalConfig.videoSeconds || defaultConfig.videoSeconds,
        vquality: node.metadata?.vquality || globalConfig.vquality || defaultConfig.vquality,
        videoGenerateAudio: node.metadata?.generateAudio || globalConfig.videoGenerateAudio || defaultConfig.videoGenerateAudio,
        videoWatermark: node.metadata?.watermark || globalConfig.videoWatermark || defaultConfig.videoWatermark,
        audioVoice: node.metadata?.audioVoice || globalConfig.audioVoice || defaultConfig.audioVoice,
        audioFormat: node.metadata?.audioFormat || globalConfig.audioFormat || defaultConfig.audioFormat,
        audioSpeed: node.metadata?.audioSpeed || globalConfig.audioSpeed || defaultConfig.audioSpeed,
        audioInstructions: node.metadata?.audioInstructions || globalConfig.audioInstructions || defaultConfig.audioInstructions,
        count: String(node.metadata?.count || (mode === "image" ? globalConfig.canvasImageCount || globalConfig.count : globalConfig.count) || defaultConfig.count),
    };
}

function buildScriptVideoConfig(globalConfig: AiConfig, node: CanvasNodeData): AiConfig {
    const config = buildNodeConfig(globalConfig, node, "video");
    const model = globalConfig.videoModel || globalConfig.model || defaultConfig.videoModel;
    return { ...config, model, videoModel: model };
}

function promptPlaceholder(mode: CanvasNodeGenerationMode, hasImageContent: boolean, hasTextContent: boolean) {
    if (mode === "video") return "描述要生成的视频内容";
    if (mode === "audio") return "描述要生成的音频内容";
    if (mode === "image") return hasImageContent ? "请输入你想要把这张图修改成什么" : "描述要生成的图片内容";
    return hasTextContent ? "请输入你想要将本段文本修改成什么" : "请输入你想要生成的文本内容";
}

function estimatePromptEditorHeight(prompt: string) {
    const visualLines = (prompt || "").split(/\r?\n/).reduce((total, line) => total + Math.max(1, Math.ceil(line.length / 42)), 0);
    return Math.min(560, Math.max(260, visualLines * 22 + 36));
}

function promptIncludesReferenceLabel(prompt: string, label: string) {
    return new RegExp(`(^|\\s|[，,。；;：:、])${escapeRegExp(label)}(?!\\d)`).test(prompt);
}

function isCangyuanSeedanceConfig(config: AiConfig) {
    const requestConfig = resolveModelRequestConfig(config, config.model || config.videoModel);
    return modelOptionName(requestConfig.model).toLowerCase().includes("seedance") && (requestConfig.apiFormat === "cangyuan" || requestConfig.baseUrl.toLowerCase().includes("ai.cangyuansuanli.cn"));
}

function toCangyuanReferenceLabel(reference: CanvasResourceReference): CanvasResourceReference {
    const prefixes = { image: "image", video: "video", audio: "audio" } as const;
    if (reference.kind === "text") return reference;
    const index = reference.label.match(/(\d+)$/)?.[1];
    return index ? { ...reference, label: `${prefixes[reference.kind]}${index}` } : reference;
}

function normalizeCangyuanReferenceMentions(prompt: string) {
    return prompt
        .replace(/@?(?:图片|image)(\d+)/gi, "@image$1")
        .replace(/@?(?:视频|video)(\d+)/gi, "@video$1")
        .replace(/@?(?:音频|audio)(\d+)/gi, "@audio$1");
}

function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function videoConfigPatch(key: keyof AiConfig, value: string) {
    if (key === "videoSeconds") return { seconds: value };
    if (key === "videoGenerateAudio") return { generateAudio: value };
    if (key === "videoWatermark") return { watermark: value };
    return { [key]: value };
}

function videoModelPatch(model: string) {
    if (isOmniImageVideoModel(model) || isOmniVideoToVideoModel(model)) return { model, vquality: "720p", seconds: "10", size: "16:9" };
    if (isSoraVideoModel(model)) return { model, seconds: "8", size: "16:9" };
    if (isVeoVideoModel(model)) return { model, vquality: "1080p", seconds: "8", size: "16:9" };
    if (isSeedanceMini8sModel(model)) return { model, vquality: "720p", seconds: "8" };
    const fixedResolution = seedanceModelFixedResolution(model);
    return fixedResolution ? { model, vquality: fixedResolution } : { model };
}

function audioModelPatch(config: AiConfig, model: string) {
    return { model, audioVoice: normalizeAudioVoiceForProvider(config, model) };
}

function audioConfigPatch(key: CanvasAudioSettingKey, value: string) {
    if (key === "audioVoice") return { audioVoice: value };
    if (key === "audioFormat") return { audioFormat: value };
    if (key === "audioSpeed") return { audioSpeed: value };
    return { audioInstructions: value };
}

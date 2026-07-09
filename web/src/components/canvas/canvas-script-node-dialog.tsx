import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, Dropdown, Input, Modal, Select } from "antd";
import { Copy, Ellipsis, Image as ImageIcon, LoaderCircle, Maximize2, Plus, Sparkles, Square, Upload, Video, Volume2, X } from "lucide-react";

import { ModelPicker } from "@/components/model-picker";
import { VolcengineVoiceLibraryModal } from "@/components/volcengine-voice-library-modal";
import { audioVoiceOptions, suggestVolcengineSpeakerForText, volcengineVoiceOptions } from "@/lib/audio-generation";
import { normalizeAudioVoiceForProvider, resolveAudioProvider } from "@/lib/audio-provider";
import { modelOptionLabel, useConfigStore, type AiConfig } from "@/stores/use-config-store";
import type { CanvasNodeData, StoryboardAsset, StoryboardAssetKind, StoryboardAssetMentionLink, StoryboardAssetProgress, StoryboardPromptDetail } from "@/types/canvas";

const COLUMNS = ["镜号", "时长", "画面描述", "景别", "光影氛围", "对白旁白", "音效", "运镜", "分镜画面提示词"];
const COL_WIDTHS = [64, 70, 300, 86, 220, 260, 190, 210, 270];
const STORYBOARD_ROW_LIMIT = 120;
type ScriptDialogView = "shots" | "assets" | "prompts";
type StoryboardRowsUpdater = string[][] | ((rows: string[][]) => string[][]);
type ShotImportMode = "auto" | "append" | "insert";
const ASSET_KIND_LABEL: Record<StoryboardAssetKind, string> = { character: "角色", scene: "场景", prop: "道具" };
const ASSET_SECTIONS: Array<{ kind: StoryboardAssetKind; title: string }> = [
    { kind: "character", title: "角色" },
    { kind: "scene", title: "场景" },
    { kind: "prop", title: "道具" },
];
function storyboardAssetReady(asset: Pick<StoryboardAsset, "imageUrl" | "storageKey">) {
    return Boolean(asset.imageUrl || asset.storageKey);
}

type CanvasScriptNodeDialogProps = {
    node: CanvasNodeData | null;
    open: boolean;
    actionKey?: string | null;
    onClose: () => void;
    onRowsChange: (nodeId: string, rows: StoryboardRowsUpdater) => void;
    onPrepareAssets: (node: CanvasNodeData) => void;
    onUpdateAsset: (nodeId: string, assetId: string, patch: Partial<StoryboardAsset>) => void;
    onUploadAssetImage: (nodeId: string, assetId: string, file: File) => void;
    onGenerateAssetImage: (node: CanvasNodeData, assetId: string) => void;
    onGenerateSceneSheet: (node: CanvasNodeData, assetId: string) => void;
    onStopSceneSheet: (node: CanvasNodeData, assetId: string) => void;
    onBatchGenerateSceneSheets: (node: CanvasNodeData) => void;
    onStopSceneSheets: (node: CanvasNodeData) => void;
    onGenerateAssetVoice: (node: CanvasNodeData, assetId: string) => void;
    onBatchGenerateAssets: (node: CanvasNodeData) => void;
    onStopAssetGeneration: (node: CanvasNodeData) => void;
    onGenerateShotsFromInputs: (node: CanvasNodeData) => void;
    onComposeFinalPrompt: (node: CanvasNodeData, rowIndex?: number) => void;
    onPromptDetailChange: (nodeId: string, rowIndex: number, detail: StoryboardPromptDetail) => void;
    onModelChange: (nodeId: string, model: string) => void;
    onGenerateImage: (node: CanvasNodeData, rowIndex: number) => void;
    onGenerateVideo: (node: CanvasNodeData, rowIndex: number) => void;
    onBatchGenerateVideos: (node: CanvasNodeData) => void;
    config: AiConfig;
};

export function CanvasScriptNodeDialog({ node, open, actionKey, onClose, onRowsChange, onPrepareAssets, onUpdateAsset, onUploadAssetImage, onGenerateAssetImage, onGenerateSceneSheet, onStopSceneSheet, onBatchGenerateSceneSheets, onStopSceneSheets, onGenerateAssetVoice, onBatchGenerateAssets, onStopAssetGeneration, onGenerateShotsFromInputs, onComposeFinalPrompt, onPromptDetailChange, onModelChange, onGenerateImage, onGenerateVideo, config }: CanvasScriptNodeDialogProps) {
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const rows = normalizeRows(node?.metadata?.storyboardRows);
    const assets = node?.metadata?.storyboardAssets || [];
    const style = node?.metadata?.storyboardAssetStyle || "";
    const assetError = node?.metadata?.storyboardAssetError || "";
    const promptDetails = node?.metadata?.storyboardPromptDetails || {};
    const filledCount = rows.filter((row) => row.some((cell, index) => index > 1 && cell.trim())).length;
    const promptCount = rows.filter((_, index) => hasComposedPrompt(promptDetails[String(index)])).length;
    const videoPromptCount = rows.filter((_, index) => hasVideoPrompt(promptDetails[String(index)])).length;
    const readyAssets = assets.filter(storyboardAssetReady).length;
    const missingAssets = assets.length - readyAssets;
    const preparingAssets = actionKey === "asset:prepare";
    const generatingAssets = actionKey === "asset:all" || actionKey === "asset-sheet:all" || assets.some((asset) => asset.status === "loading" || asset.sceneSheetStatus === "loading");
    const hasPartialAssets = readyAssets > 0 && missingAssets > 0;
    const [view, setView] = useState<ScriptDialogView>(node?.metadata?.storyboardStep === "assets" ? "assets" : node?.metadata?.storyboardStep === "prompts" ? "prompts" : "shots");
    const [editingAssetId, setEditingAssetId] = useState<string | null>(null);
    const [previewSceneSheetAssetId, setPreviewSceneSheetAssetId] = useState<string | null>(null);
    const [promptEditorRowIndex, setPromptEditorRowIndex] = useState<number | null>(null);
    const [shotImportOpen, setShotImportOpen] = useState(false);
    const uploadInputRef = useRef<HTMLInputElement>(null);
    const editingAsset = assets.find((asset) => asset.id === editingAssetId) || null;
    const previewSceneSheetAsset = assets.find((asset) => asset.id === previewSceneSheetAssetId) || null;
    const editingAssetHasImage = Boolean(editingAsset?.imageUrl || editingAsset?.storageKey);
    const editingAssetGenerating = Boolean(editingAsset && (actionKey === `asset:${editingAsset.id}` || editingAsset.status === "loading"));
    const assetActionBusy = Boolean(actionKey?.startsWith("asset:") && actionKey !== `asset:${editingAsset?.id}`);
    const promptEditorRow = promptEditorRowIndex === null ? null : rows[promptEditorRowIndex] || null;
    const promptEditorDetail = promptEditorRowIndex === null ? null : promptDetails[String(promptEditorRowIndex)] || null;
    const editingAssetVoiceSuggestion = useMemo(() => (editingAsset ? suggestVolcengineSpeakerForText([editingAsset.name, editingAsset.description, editingAsset.prompt, editingAsset.voicePrompt].filter(Boolean).join("\n")) : null), [editingAsset]);

    useEffect(() => {
        if (!node) return;
        setView(node.metadata?.storyboardStep === "assets" ? "assets" : node.metadata?.storyboardStep === "prompts" ? "prompts" : "shots");
    }, [node?.id, node?.metadata?.storyboardStep]);

    useEffect(() => {
        setEditingAssetId(null);
        setPromptEditorRowIndex(null);
    }, [node?.id]);

    useEffect(() => {
        if (editingAssetId && !assets.some((asset) => asset.id === editingAssetId)) setEditingAssetId(null);
    }, [assets, editingAssetId]);

    useEffect(() => {
        if (!node || view !== "assets" || assets.length || actionKey === "asset:prepare" || node.metadata?.storyboardAssetError) return;
        onPrepareAssets(node);
    }, [actionKey, assets.length, node, onPrepareAssets, view]);

    const groupedAssets = useMemo(() => Object.fromEntries(ASSET_SECTIONS.map(({ kind }) => [kind, assets.filter((asset) => asset.kind === kind)])) as Record<StoryboardAssetKind, StoryboardAsset[]>, [assets]);

    const saveRows = (nextRows: StoryboardRowsUpdater) => {
        if (!node) return;
        onRowsChange(node.id, (currentRows) => {
            const baseRows = normalizeRows(currentRows);
            const updatedRows = typeof nextRows === "function" ? nextRows(baseRows) : nextRows;
            return renumberRows(updatedRows);
        });
    };

    const updateCell = (rowIndex: number, colIndex: number, value: string) => {
        saveRows((currentRows) => {
            const nextRows = currentRows.map((row) => [...row]);
            if (nextRows[rowIndex]) nextRows[rowIndex][colIndex] = value;
            return nextRows;
        });
    };

    const addRow = () => saveRows((currentRows) => [...currentRows, [`${currentRows.length + 1}`, "5s", "", "", "", "", "", "", ""]]);
    const deleteRow = (rowIndex: number) => saveRows((currentRows) => currentRows.filter((_, index) => index !== rowIndex));
    const importRows = (importedRows: string[][], mode: ShotImportMode, insertAfter: number) => {
        saveRows((currentRows) => mergeImportedRows(currentRows, importedRows, mode, insertAfter));
        setView("shots");
        setShotImportOpen(false);
    };

    const openAssets = () => {
        if (!node) return;
        if (!assets.length) onPrepareAssets(node);
        setView("assets");
    };

    const openPrompts = () => {
        if (!node || !rows.length) return;
        setView("prompts");
    };

    const uploadEditingAsset = (file?: File) => {
        if (!node || !editingAsset || !file) return;
        onUploadAssetImage(node.id, editingAsset.id, file);
    };

    const clearEditingAssetImage = () => {
        if (!node || !editingAsset) return;
        onUpdateAsset(node.id, editingAsset.id, { imageUrl: undefined, storageKey: undefined, status: "idle", errorDetails: undefined });
    };

    return (
        <Modal
            className="canvas-script-node-dialog"
            open={open && Boolean(node)}
            footer={null}
            closable={false}
            onCancel={onClose}
            width="100vw"
            centered
            styles={{
                mask: { background: "rgba(0,0,0,.72)" },
                content: { height: "100vh", padding: 0, borderRadius: 0, background: "#101010", overflow: "hidden" },
                body: { height: "100%" },
            } as any}
        >
            {node ? (
                <div className="flex h-full flex-col bg-[#101010] text-[#f1f1f1]">
                    <div className="sticky top-0 z-30 flex min-h-20 shrink-0 items-center gap-6 border-b border-[#303030] bg-[#070707] px-8 py-3 shadow-[0_10px_28px_rgba(0,0,0,.35)]">
                        <div className="grid min-w-0 flex-1 grid-cols-3 items-center gap-6">
                            <Step index="1" title="确认镜头" detail={`${filledCount}/${rows.length} 镜头待校对`} active={view === "shots"} done={filledCount > 0} onClick={() => setView("shots")} />
                            <Step index="2" title="准备资产" detail={`${readyAssets}/${assets.length || 0} 已生成，还差 ${Math.max(missingAssets, 0)} 个`} active={view === "assets"} done={assets.length > 0 && readyAssets === assets.length} onClick={openAssets} />
                            <Step index="3" title="合成提示词" detail={`${promptCount}/${rows.length} 已合成`} active={view === "prompts"} done={promptCount === rows.length && rows.length > 0} onClick={openPrompts} />
                        </div>
                        {view === "assets" ? (
                            <AssetPrepToolbar
                                node={node}
                                actionKey={actionKey}
                                assets={assets}
                                groupedAssets={groupedAssets}
                                missingCount={missingAssets}
                                preparing={preparingAssets}
                                generatingAssets={generatingAssets}
                                hasPartialAssets={hasPartialAssets}
                                readyAssets={readyAssets}
                                onPrepareAssets={onPrepareAssets}
                                onBatchGenerateAssets={onBatchGenerateAssets}
                                onStopAssetGeneration={onStopAssetGeneration}
                            />
                        ) : null}
                        {view === "prompts" ? (
                            <PromptStepToolbar node={node} rows={rows} actionKey={actionKey} videoPromptCount={videoPromptCount} onComposeFinalPrompt={onComposeFinalPrompt} />
                        ) : null}
                        <Button type="text" className="!size-10 !shrink-0 !rounded-md !text-[#d8d8d8] hover:!bg-white/10" title="关闭" icon={<X className="size-5" />} onClick={onClose} />
                    </div>
                    {view === "assets" ? (
                        <AssetPrepView
                            node={node}
                            actionKey={actionKey}
                            assets={assets}
                            groupedAssets={groupedAssets}
                            style={style}
                            error={assetError}
                            onPrepareAssets={onPrepareAssets}
                            onSelectAsset={setEditingAssetId}
                            onGenerateAssetImage={onGenerateAssetImage}
                            onGenerateSceneSheet={onGenerateSceneSheet}
                            onStopSceneSheet={onStopSceneSheet}
                            onBatchGenerateSceneSheets={onBatchGenerateSceneSheets}
                            onStopSceneSheets={onStopSceneSheets}
                            onGenerateAssetVoice={onGenerateAssetVoice}
                            onPreviewSceneSheet={setPreviewSceneSheetAssetId}
                        />
                    ) : view === "prompts" ? (
                        <PromptComposeView
                            node={node}
                            rows={rows}
                            actionKey={actionKey}
                            promptDetails={promptDetails}
                            config={config}
                            model={node.metadata?.model || config.textModel || config.model}
                            onModelChange={(model) => onModelChange(node.id, model)}
                            onOpenPrompt={setPromptEditorRowIndex}
                            onComposeFinalPrompt={onComposeFinalPrompt}
                            onAddRow={addRow}
                            onOpenImport={() => setShotImportOpen(true)}
                            onGenerateImage={onGenerateImage}
                            onGenerateVideo={onGenerateVideo}
                            promptCount={promptCount}
                        />
                    ) : (
                        <ShotsTable node={node} rows={rows} actionKey={actionKey} promptDetails={promptDetails} onUpdateCell={updateCell} onDeleteRow={deleteRow} onAddRow={addRow} onOpenImport={() => setShotImportOpen(true)} onGenerateShotsFromInputs={onGenerateShotsFromInputs} onOpenPrompt={setPromptEditorRowIndex} onGenerateImage={onGenerateImage} onGenerateVideo={onGenerateVideo} onOpenAssets={openAssets} promptCount={promptCount} />
                    )}
                    <ShotImportModal open={shotImportOpen} rowCount={rows.length} onClose={() => setShotImportOpen(false)} onImport={importRows} />
                    {promptEditorRow && promptEditorRowIndex !== null ? (
                        <PromptComposeModal
                            node={node}
                            row={promptEditorRow}
                            rowIndex={promptEditorRowIndex}
                            detail={promptEditorDetail}
                            config={config}
                            actionKey={actionKey}
                            model={node.metadata?.model || config.textModel || config.model}
                            onModelChange={(model) => onModelChange(node.id, model)}
                            onSave={(detail) => onPromptDetailChange(node.id, promptEditorRowIndex, detail)}
                            onRegenerate={() => onComposeFinalPrompt(node, promptEditorRowIndex)}
                            onGenerateImage={() => onGenerateImage(node, promptEditorRowIndex)}
                            onGenerateVideo={() => onGenerateVideo(node, promptEditorRowIndex)}
                            onClose={() => setPromptEditorRowIndex(null)}
                        />
                    ) : null}
                    {previewSceneSheetAsset?.sceneSheetUrl ? (
                        <Modal open centered footer={null} width="90vw" closeIcon={<X className="size-5" />} onCancel={() => setPreviewSceneSheetAssetId(null)} styles={{ content: { background: "#151515", padding: 0, overflow: "hidden" }, body: { padding: 0 } }}>
                            <div className="flex h-[85vh] flex-col bg-[#151515]">
                                <div className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-[#2e2e2e] px-5 pr-12">
                                    <div className="min-w-0">
                                        <div className="truncate text-sm font-semibold text-[#f1f1f1]">{previewSceneSheetAsset.name} 多角度锁定图</div>
                                        <div className="text-xs text-[#8b8b8b]">用于检查同一场景不同机位的一致性</div>
                                    </div>
                                    <Button type="primary" icon={<Sparkles className="size-4" />} disabled={Boolean(actionKey && actionKey !== `asset-sheet:${previewSceneSheetAsset.id}`)} onClick={() => node && onGenerateSceneSheet(node, previewSceneSheetAsset.id)}>
                                        重做多角度锁定图
                                    </Button>
                                </div>
                                <div className="grid min-h-0 flex-1 place-items-center bg-black/70 p-4">
                                    <img src={previewSceneSheetAsset.sceneSheetUrl} alt={`${previewSceneSheetAsset.name} 多角度锁定图`} className="max-h-full max-w-full object-contain" />
                                </div>
                            </div>
                        </Modal>
                    ) : null}
                    {editingAsset ? (
                        <div className="absolute inset-0 z-40 bg-transparent" onClick={() => setEditingAssetId(null)}>
                            <div className="absolute inset-y-0 right-0 flex w-[490px] flex-col border-l border-[#303030] bg-[#242424] shadow-[-18px_0_50px_rgba(0,0,0,.45)]" onClick={(event) => event.stopPropagation()}>
                                <div className="flex h-16 items-center justify-between gap-3 border-b border-[#353535] px-5 pr-12">
                                    <div className="flex min-w-0 items-center gap-3">
                                        <div className="shrink-0 text-sm font-semibold">编辑{ASSET_KIND_LABEL[editingAsset.kind]}</div>
                                        {editingAssetGenerating ? (
                                            <Button size="small" danger icon={<Square className="size-3.5" />} onClick={() => onStopAssetGeneration(node)}>
                                                暂停
                                            </Button>
                                        ) : (
                                            <Button size="small" type="primary" icon={<Sparkles className="size-3.5" />} disabled={assetActionBusy} onClick={() => onGenerateAssetImage(node, editingAsset.id)}>
                                                {editingAssetHasImage ? "重生成图" : "生成图"}
                                            </Button>
                                        )}
                                    </div>
                                    <Button type="text" className="!size-9 !rounded-md !text-[#e8e8e8]" title="关闭编辑面板" icon={<X className="size-4" />} onClick={() => setEditingAssetId(null)} />
                                </div>
                                <div className="thin-scrollbar min-h-0 flex-1 overflow-auto px-5 py-4">
                                    <div className="mb-4 text-xs font-semibold text-[#f0f0f0]">{ASSET_KIND_LABEL[editingAsset.kind]}形象</div>
                                    <button className="relative mb-3 grid aspect-[4/3] w-full place-items-center overflow-hidden rounded-lg border border-dashed border-[#565656] bg-[#2d2d2d] text-xs text-[#979797]" onClick={() => uploadInputRef.current?.click()}>
                                        {editingAsset.imageUrl ? <img src={editingAsset.imageUrl} alt={editingAsset.name} className="size-full object-cover" /> : editingAsset.status === "loading" ? <LoaderCircle className="size-7 animate-spin" /> : <span className="flex flex-col items-center gap-2"><Plus className="size-7" />生成或上传{ASSET_KIND_LABEL[editingAsset.kind]}图</span>}
                                        <Dropdown
                                            trigger={["click"]}
                                            menu={{
                                                items: [
                                                    { key: "generate", label: editingAssetHasImage ? "重新生成图片" : "生成图片", icon: <Sparkles className="size-3.5" /> },
                                                    { key: "upload", label: "上传图片", icon: <Upload className="size-3.5" /> },
                                                    ...(editingAssetHasImage ? [{ key: "clear", label: "清除当前图片", danger: true }] : []),
                                                ],
                                                onClick: ({ key, domEvent }) => {
                                                    domEvent.stopPropagation();
                                                    if (key === "generate") onGenerateAssetImage(node, editingAsset.id);
                                                    if (key === "upload") uploadInputRef.current?.click();
                                                    if (key === "clear") clearEditingAssetImage();
                                                },
                                            }}
                                        >
                                            <span className="absolute right-3 top-3 grid size-8 place-items-center rounded bg-[#111] text-[#f1f1f1]" onClick={(event) => event.stopPropagation()}>
                                                <Ellipsis className="size-4" />
                                            </span>
                                        </Dropdown>
                                    </button>
                                    <div className="mb-5 flex items-center gap-2">
                                        {editingAssetHasImage ? (
                                            <Button danger onClick={clearEditingAssetImage}>
                                                清除图片
                                            </Button>
                                        ) : null}
                                        <Button className="flex-1" onClick={() => uploadInputRef.current?.click()}>
                                            上传图片
                                        </Button>
                                        {editingAssetGenerating ? (
                                            <Button className="flex-1" danger icon={<Square className="size-4" />} onClick={() => onStopAssetGeneration(node)}>
                                                暂停生成
                                            </Button>
                                        ) : (
                                            <Button className="flex-1" type="primary" icon={<Sparkles className="size-4" />} disabled={assetActionBusy} onClick={() => onGenerateAssetImage(node, editingAsset.id)}>
                                                {editingAssetHasImage ? "重新生成图片" : "生成图片"}
                                            </Button>
                                        )}
                                    </div>
                                    <input ref={uploadInputRef} type="file" accept="image/*" className="hidden" onChange={(event) => uploadEditingAsset(event.target.files?.[0])} />
                                    <AssetEditorField label={`${ASSET_KIND_LABEL[editingAsset.kind]}名称`} value={editingAsset.name} onChange={(value) => onUpdateAsset(node.id, editingAsset.id, { name: value })} />
                                    {editingAsset.kind === "character" ? (
                                        <div className="mb-4 grid grid-cols-2 gap-3">
                                            <AssetEditorField label="角色本名" value={editingAsset.baseName || ""} placeholder="例如 白秋妹" onChange={(value) => onUpdateAsset(node.id, editingAsset.id, { baseName: value })} />
                                            <AssetEditorField label="年龄/时期状态" value={editingAsset.lifeStage || ""} placeholder="例如 年轻时期" onChange={(value) => onUpdateAsset(node.id, editingAsset.id, { lifeStage: value })} />
                                        </div>
                                    ) : null}
                                    <AssetEditorField label={`${ASSET_KIND_LABEL[editingAsset.kind]}描述`} value={editingAsset.description} textarea onChange={(value) => onUpdateAsset(node.id, editingAsset.id, { description: value })} />
                                    <AssetEditorField label="生成提示词" value={editingAsset.prompt} textarea tall onChange={(value) => onUpdateAsset(node.id, editingAsset.id, { prompt: value })} />
                                    {editingAsset.kind === "character" ? (
                                        <div className="mt-4 rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3">
                                            <div className="mb-2 flex items-center justify-between gap-3">
                                                <div className="flex items-center gap-1.5 text-xs font-semibold text-cyan-100"><Volume2 className="size-4" />角色声音</div>
                                                <Button size="small" icon={editingAsset.voiceAudioStatus === "loading" ? <LoaderCircle className="size-3.5 animate-spin" /> : <Volume2 className="size-3.5" />} disabled={Boolean(actionKey && actionKey !== `asset-voice:${editingAsset.id}`)} onClick={() => onGenerateAssetVoice(node, editingAsset.id)}>
                                                    {editingAsset.voiceAudioUrl || editingAsset.voiceAudioStorageKey ? "重做声音" : "生成试听"}
                                                </Button>
                                            </div>
                                            <AssetVoiceModelField
                                                config={config}
                                                onChange={(model) => {
                                                    updateConfig("audioModel", model);
                                                    updateConfig("audioVoice", normalizeAudioVoiceForProvider(config, model));
                                                }}
                                            />
                                            <AssetVoiceSpeakerField asset={editingAsset} config={config} suggestion={editingAssetVoiceSuggestion} onChange={(value) => onUpdateAsset(node.id, editingAsset.id, { voiceSpeaker: value })} />
                                            <AssetEditorField label="试听台词" value={editingAsset.voiceSampleText || ""} textarea onChange={(value) => onUpdateAsset(node.id, editingAsset.id, { voiceSampleText: value })} />
                                            <AssetEditorField label="声音提示词" value={editingAsset.voicePrompt || ""} textarea onChange={(value) => onUpdateAsset(node.id, editingAsset.id, { voicePrompt: value })} />
                                            {editingAsset.voiceAudioUrl || editingAsset.voiceAudioStorageKey ? <audio src={editingAsset.voiceAudioUrl || editingAsset.voiceAudioStorageKey} controls className="mt-3 h-9 w-full" /> : <div className="mt-2 text-xs leading-5 text-cyan-100/70">生成后可在这里试听；后续视频会把这段声音作为角色音色参考。</div>}
                                            <div className="mt-2 flex items-start gap-2 text-xs leading-5 text-cyan-100/60">
                                                <span className="min-w-0 flex-1">{editingAsset.voiceAudioCacheHit === "shared" ? "已命中仓库共享试听缓存，本次不会重新请求语音 API。" : editingAsset.voiceAudioCacheHit === "local" ? "已命中本地试听缓存，本次不会重新请求语音 API。" : "首次生成会请求语音 API；同一模型、音色、语速、提示词和试听台词会自动复用缓存。"}</span>
                                                {editingAsset.voiceAudioCacheKey ? (
                                                    <Button size="small" type="text" className="!h-6 !px-1.5 !text-cyan-100/75" icon={<Copy className="size-3.5" />} onClick={() => void navigator.clipboard?.writeText(editingAsset.voiceAudioCacheKey || "")}>
                                                        缓存 Key
                                                    </Button>
                                                ) : null}
                                            </div>
                                            {editingAsset.voiceAudioError ? <div className="mt-3 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">{editingAsset.voiceAudioError}</div> : null}
                                        </div>
                                    ) : null}
                                    {editingAsset.errorDetails ? <div className="mt-3 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">{editingAsset.errorDetails}</div> : null}
                                </div>
                                <div className="flex h-16 items-center justify-end gap-2 border-t border-[#353535] px-5">
                                    {editingAssetHasImage ? (
                                        <Button danger onClick={clearEditingAssetImage}>
                                            清除图片
                                        </Button>
                                    ) : null}
                                    <Button onClick={() => uploadInputRef.current?.click()}>上传图片</Button>
                                    {editingAssetGenerating ? (
                                        <Button danger icon={<Square className="size-4" />} onClick={() => onStopAssetGeneration(node)}>
                                            暂停生成
                                        </Button>
                                    ) : (
                                        <Button type="primary" icon={<Sparkles className="size-4" />} disabled={assetActionBusy} onClick={() => onGenerateAssetImage(node, editingAsset.id)}>
                                            {editingAssetHasImage ? "重新生成图片" : "生成图片"}
                                        </Button>
                                    )}
                                </div>
                            </div>
                        </div>
                    ) : null}
                </div>
            ) : null}
        </Modal>
    );
}

function ShotsTable({ node, rows, actionKey, promptDetails, onUpdateCell, onDeleteRow, onAddRow, onOpenImport, onGenerateShotsFromInputs, onOpenPrompt, onGenerateImage, onGenerateVideo, onOpenAssets, promptCount }: { node: CanvasNodeData; rows: string[][]; actionKey?: string | null; promptDetails: Record<string, StoryboardPromptDetail>; onUpdateCell: (rowIndex: number, colIndex: number, value: string) => void; onDeleteRow: (rowIndex: number) => void; onAddRow: () => void; onOpenImport: () => void; onGenerateShotsFromInputs: (node: CanvasNodeData) => void; onOpenPrompt: (rowIndex: number) => void; onGenerateImage: (node: CanvasNodeData, rowIndex: number) => void; onGenerateVideo: (node: CanvasNodeData, rowIndex: number) => void; onOpenAssets: () => void; promptCount: number }) {
    const generatingShots = actionKey === "shots:generate";
    return (
        <>
            <div className="thin-scrollbar min-h-0 flex-1 overflow-auto">
                <table className="min-w-[1880px] border-collapse text-left text-[12px]">
                    <thead className="sticky top-0 z-20 bg-[#1f1f1f] text-[#b5b5b5]">
                        <tr>
                            {COLUMNS.map((column, index) => (
                                <th key={column} className={`${index === 0 ? "sticky left-0 z-30 bg-[#1f1f1f]" : ""} border-b border-r border-[#343434] px-3 py-3 font-medium`} style={{ width: COL_WIDTHS[index] }}>
                                    {column}
                                </th>
                            ))}
                            <th className="w-44 border-b border-[#343434] px-3 py-3 font-medium">操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row, rowIndex) => (
                            <tr key={rowIndex} className={rowIndex % 2 ? "bg-[#202020]" : "bg-[#151515]"}>
                                {COLUMNS.map((_, colIndex) => {
                                    const detail = promptDetails[String(rowIndex)];
                                    return (
                                        <td key={colIndex} className={`${colIndex === 0 ? `sticky left-0 z-10 ${rowIndex % 2 ? "bg-[#202020]" : "bg-[#151515]"}` : ""} border-b border-r border-[#303030] align-top`}>
                                            {colIndex === 8 ? (
                                                <button className="block min-h-[78px] w-full px-3 py-3 text-left leading-5 text-[#bdbdbd] outline-none transition hover:bg-white/5" onClick={() => onOpenPrompt(rowIndex)}>
                                                    <span className="line-clamp-3">{detail?.storyboardPrompt || row[colIndex] || "点击打开合成提示词"}</span>
                                                    {detail?.videoMotionPrompt ? <span className="mt-2 inline-flex rounded bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-200">已生成视频运动提示词</span> : null}
                                                </button>
                                            ) : (
                                                <textarea className={`block w-full resize-none bg-transparent px-3 py-3 leading-5 outline-none ${colIndex < 2 ? "text-center font-semibold" : ""}`} style={{ minHeight: 78, color: "#f1f1f1" }} value={row[colIndex] || ""} onChange={(event) => onUpdateCell(rowIndex, colIndex, event.target.value)} />
                                            )}
                                        </td>
                                    );
                                })}
                                <td className="border-b border-[#303030] px-3 py-3">
                                    <div className="flex items-center justify-center gap-1.5">
                                        <RowActionButton loading={actionKey === `prompt:${rowIndex}`} icon={<Sparkles className="size-3.5" />} title="打开合成提示词" onClick={() => onOpenPrompt(rowIndex)} />
                                        <RowActionButton loading={actionKey === `image:${rowIndex}`} icon={<ImageIcon className="size-3.5" />} title="生成分镜图" onClick={() => onGenerateImage(node, rowIndex)} />
                                        <RowActionButton loading={actionKey === `video:${rowIndex}`} icon={<Video className="size-3.5" />} title="生成视频" onClick={() => onGenerateVideo(node, rowIndex)} />
                                        <Dropdown
                                            trigger={["click"]}
                                            menu={{
                                                items: [
                                                    { key: "copy", label: "复制当前提示词", icon: <Copy className="size-3.5" /> },
                                                    { key: "delete", label: "删除镜头", danger: true },
                                                ],
                                                onClick: ({ key }) => {
                                                    if (key === "copy") void navigator.clipboard?.writeText(promptTextForCopy(promptDetails[String(rowIndex)], row[8] || ""));
                                                    if (key === "delete") onDeleteRow(rowIndex);
                                                },
                                            }}
                                        >
                                            <Button size="small" type="text" className="!text-[#d8d8d8]" icon={<Ellipsis className="size-4" />} />
                                        </Dropdown>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <div className="sticky bottom-0 z-30 flex h-16 shrink-0 items-center justify-between border-t border-[#303030] bg-[#121212] px-8 shadow-[0_-10px_28px_rgba(0,0,0,.35)]">
                <div className="flex items-center gap-2">
                    <Button icon={<Plus className="size-4" />} type="text" className="!text-[#f1f1f1]" onClick={onAddRow}>
                    添加镜头
                    </Button>
                    <Button icon={<Upload className="size-4" />} type="text" className="!text-[#f1f1f1]" disabled={actionKey !== null} onClick={onOpenImport}>
                        导入镜头
                    </Button>
                    <Button className="!h-10 !rounded-lg !px-6" disabled={actionKey !== null} icon={generatingShots ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />} onClick={() => onGenerateShotsFromInputs(node)}>
                        从连接剧本生成镜头
                    </Button>
                    {!rows.some((row) => row.some((cell, index) => index > 1 && cell.trim())) ? <span className="text-xs text-[#8f8f8f]">把剧本文本节点连到脚本节点后，点击这里生成分镜表。</span> : null}
                </div>
                <Button type="primary" className="!h-10 !rounded-lg !px-8" disabled={!promptCount || actionKey !== null} onClick={onOpenAssets}>
                    下一步：准备资产
                </Button>
            </div>
        </>
    );
}

function PromptComposeView({ node, rows, actionKey, promptDetails, config, model, onModelChange, onOpenPrompt, onComposeFinalPrompt, onAddRow, onOpenImport, onGenerateImage, onGenerateVideo, promptCount }: { node: CanvasNodeData; rows: string[][]; actionKey?: string | null; promptDetails: Record<string, StoryboardPromptDetail>; config: AiConfig; model: string; onModelChange: (model: string) => void; onOpenPrompt: (rowIndex: number) => void; onComposeFinalPrompt: (node: CanvasNodeData, rowIndex?: number) => void; onAddRow: () => void; onOpenImport: () => void; onGenerateImage: (node: CanvasNodeData, rowIndex: number) => void; onGenerateVideo: (node: CanvasNodeData, rowIndex: number) => void; promptCount: number }) {
    return (
        <>
            <div className="thin-scrollbar min-h-0 flex-1 overflow-auto">
                <table className="min-w-[1820px] border-collapse text-left text-[12px]">
                    <thead className="sticky top-0 z-20 bg-[#1f1f1f] text-[#b5b5b5]">
                        <tr>
                            {COLUMNS.slice(0, 8).map((column, index) => (
                                <th key={column} className={`${index === 0 ? "sticky left-0 z-30 bg-[#1f1f1f]" : ""} border-b border-r border-[#343434] px-3 py-3 font-medium`} style={{ width: COL_WIDTHS[index] }}>
                                    {column}
                                </th>
                            ))}
                            <th className="w-[310px] border-b border-r border-[#343434] px-3 py-3 font-medium">合成结果</th>
                            <th className="w-24 border-b border-[#343434] px-3 py-3 text-center font-medium">操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row, rowIndex) => {
                            const detail = promptDetails[String(rowIndex)];
                            const hasPrompt = Boolean(detail?.storyboardPrompt?.trim());
                            const boundCount = detail?.assetMentionLinks?.filter((link) => link.status === "bound").length || 0;
                            const missingCount = detail?.assetMentionLinks?.filter((link) => link.status === "missing").length || 0;
                            return (
                                <tr key={rowIndex} className={rowIndex % 2 ? "bg-[#202020]" : "bg-[#151515]"}>
                                    {COLUMNS.slice(0, 8).map((_, colIndex) => (
                                        <td key={colIndex} className={`${colIndex === 0 ? `sticky left-0 z-10 ${rowIndex % 2 ? "bg-[#202020]" : "bg-[#151515]"}` : ""} border-b border-r border-[#303030] align-top`}>
                                            <div className={`max-h-24 overflow-hidden px-3 py-3 leading-5 ${colIndex < 2 ? "text-center font-semibold" : "text-[#ececec]"}`}>{row[colIndex] || "-"}</div>
                                        </td>
                                    ))}
                                    <td className="border-b border-r border-[#303030] align-top">
                                        <button className="block min-h-24 w-full px-3 py-3 text-left leading-5 outline-none transition hover:bg-white/5" onClick={() => onOpenPrompt(rowIndex)}>
                                            {hasPrompt ? (
                                                <>
                                                    <span className="line-clamp-3 text-[#e7e7e7]">{detail?.storyboardPrompt}</span>
                                                    <span className="mt-2 flex flex-wrap gap-1.5">
                                                        {detail?.videoMotionPrompt ? <span className="inline-flex rounded bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-200">已生成视频运动提示词</span> : null}
                                                        {boundCount ? <span className="inline-flex rounded bg-cyan-500/15 px-2 py-0.5 text-[11px] font-semibold text-cyan-100">已绑定 {boundCount} 个资产</span> : null}
                                                        {missingCount ? <span className="inline-flex rounded bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-100">未绑定 {missingCount} 个</span> : null}
                                                    </span>
                                                </>
                                            ) : (
                                                <span className="text-[#858585]">待生成提示词</span>
                                            )}
                                        </button>
                                    </td>
                                    <td className="border-b border-[#303030] px-3 py-3 text-center">
                                        <Dropdown
                                            trigger={["click"]}
                                            menu={{
                                                items: [
                                                    { key: "open", label: "打开合成提示词", icon: <Sparkles className="size-3.5" /> },
                                                    { key: "compose", label: hasPrompt ? "重新合成此镜头" : "合成此镜头", icon: <Sparkles className="size-3.5" /> },
                                                    { key: "copy", label: "复制提示词", icon: <Copy className="size-3.5" />, disabled: !hasPrompt },
                                                    { key: "image", label: "生成分镜图", icon: <ImageIcon className="size-3.5" />, disabled: !hasPrompt },
                                                    { key: "video", label: "生成视频", icon: <Video className="size-3.5" />, disabled: !detail?.videoMotionPrompt?.trim() },
                                                ],
                                                onClick: ({ key }) => {
                                                    if (key === "open") onOpenPrompt(rowIndex);
                                                    if (key === "compose") onComposeFinalPrompt(node, rowIndex);
                                                    if (key === "copy") void navigator.clipboard?.writeText(promptTextForCopy(detail, row[8] || ""));
                                                    if (key === "image") onGenerateImage(node, rowIndex);
                                                    if (key === "video") onGenerateVideo(node, rowIndex);
                                                },
                                            }}
                                        >
                                            <Button size="small" type="text" className="!text-[#d8d8d8]" disabled={actionKey === `prompt:${rowIndex}`} icon={actionKey === `prompt:${rowIndex}` ? <LoaderCircle className="size-4 animate-spin" /> : <Ellipsis className="size-4" />} />
                                        </Dropdown>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            <div className="sticky bottom-0 z-30 flex h-16 shrink-0 items-center justify-between border-t border-[#303030] bg-[#121212] px-8 shadow-[0_-10px_28px_rgba(0,0,0,.35)]">
                <div className="flex items-center gap-3">
                    <Button icon={<Plus className="size-4" />} type="text" className="!text-[#f1f1f1]" disabled={actionKey !== null} onClick={onAddRow}>
                        添加镜头
                    </Button>
                    <Button icon={<Upload className="size-4" />} type="text" className="!text-[#f1f1f1]" disabled={actionKey !== null} onClick={onOpenImport}>
                        导入镜头
                    </Button>
                    <div className="text-xs text-[#bcbcbc]">{promptCount}/{rows.length} 已合成，支持逐镜头单独重写，也可以批量重写全部镜头。</div>
                </div>
                <div className="flex items-center gap-2">
                    <ModelPicker config={config} value={model} capability="text" className="!h-10 !rounded-lg !border-[#444] !bg-[#242424] !text-[#f4f4f4]" onChange={onModelChange} />
                </div>
            </div>
        </>
    );
}

function PromptComposeModal({ node, row, rowIndex, detail, config, model, actionKey, onModelChange, onSave, onRegenerate, onGenerateImage, onGenerateVideo, onClose }: { node: CanvasNodeData; row: string[]; rowIndex: number; detail: StoryboardPromptDetail | null; config: AiConfig; model: string; actionKey?: string | null; onModelChange: (model: string) => void; onSave: (detail: StoryboardPromptDetail) => void; onRegenerate: () => void; onGenerateImage: () => void; onGenerateVideo: () => void; onClose: () => void }) {
    const [draft, setDraft] = useState<StoryboardPromptDetail>(() => initialPromptDetail(detail, row));
    const loading = actionKey === `prompt:${rowIndex}` || actionKey === "prompt:all";

    useEffect(() => {
        setDraft(initialPromptDetail(detail, row));
    }, [detail, row, rowIndex]);

    const updateDraft = (patch: Partial<StoryboardPromptDetail>) => setDraft((current) => ({ ...current, ...patch }));
    const mentions = draft.assetMentions || [];
    const mentionLinks = draft.assetMentionLinks || [];

    return (
        <Modal
            className="canvas-script-prompt-modal"
            open
            footer={null}
            closeIcon={<X className="size-5" />}
            onCancel={onClose}
            width={980}
            centered
            styles={{
                mask: { background: "rgba(0,0,0,.42)" },
                content: { padding: 0, borderRadius: 12, background: "#1c1c1c", overflow: "hidden", boxShadow: "0 28px 90px rgba(0,0,0,.58)" },
                body: { maxHeight: "min(88vh, 820px)", overflow: "hidden" },
            } as any}
        >
            <div className="flex max-h-[min(88vh,820px)] flex-col text-[#f3f3f3]">
                <div className="flex items-center justify-between border-b border-[#343434] bg-[#151515] px-6 py-4 pr-12">
                    <div className="min-w-0">
                        <div className="text-base font-semibold">第 {row[0] || rowIndex + 1} 镜：合成提示词</div>
                        <div className="mt-1 truncate text-xs text-[#9f9f9f]">{row[2] || node.title}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                        <ModelPicker config={config} value={model} capability="text" className="!h-9 !rounded-lg !border-[#444] !bg-[#242424] !text-[#f4f4f4]" onChange={onModelChange} />
                        <Button className="!h-9 !rounded-lg" icon={loading ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />} disabled={loading || actionKey !== null} onClick={onRegenerate}>
                            重新合成
                        </Button>
                    </div>
                </div>
                <div className="thin-scrollbar min-h-0 flex-1 overflow-auto px-6 py-5">
                    <AssetMentionStrip mentions={mentions} links={mentionLinks} />
                    <PromptBlock
                        title="分镜提示词"
                        hint="用于首帧图、分镜图和画面生成"
                        value={draft.storyboardPrompt}
                        mentions={mentions}
                        links={mentionLinks}
                        onChange={(storyboardPrompt) => updateDraft({ storyboardPrompt })}
                    />
                    <PromptBlock
                        title="视频运动提示词"
                        hint="用于待审核视频节点的运动初稿；最终发送内容在视频节点确认页确认"
                        value={draft.videoMotionPrompt}
                        mentions={mentions}
                        links={mentionLinks}
                        tall
                        onChange={(videoMotionPrompt) => updateDraft({ videoMotionPrompt })}
                    />
                </div>
                <div className="flex h-16 items-center justify-between border-t border-[#343434] bg-[#151515] px-6">
                    <div className="flex items-center gap-2">
                        <Button onClick={() => void navigator.clipboard?.writeText(draft.storyboardPrompt || "")} icon={<Copy className="size-4" />}>复制分镜提示词</Button>
                        <Button onClick={() => void navigator.clipboard?.writeText(draft.videoMotionPrompt || "")} icon={<Copy className="size-4" />}>复制视频运动提示词</Button>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button disabled={!draft.storyboardPrompt.trim()} icon={<ImageIcon className="size-4" />} onClick={onGenerateImage}>生成分镜图</Button>
                        <Button disabled={!draft.videoMotionPrompt.trim()} icon={<Video className="size-4" />} onClick={onGenerateVideo}>生成视频</Button>
                        <Button type="primary" className="!h-10 !rounded-lg !px-7" onClick={() => onSave({ ...draft, assetMentions: mentions.map((item) => item.trim()).filter(Boolean) })}>保存并绑定</Button>
                    </div>
                </div>
            </div>
        </Modal>
    );
}

function AssetMentionStrip({ mentions, links }: { mentions: string[]; links: NonNullable<StoryboardPromptDetail["assetMentionLinks"]> }) {
    if (!mentions.length) return <div className="mb-4 rounded-lg border border-[#3a3a3a] bg-[#202020] px-4 py-3 text-xs text-[#9f9f9f]">重新合成后会自动 @ 人物、场景、道具；保存时会校验是否真的绑定到画布资产节点。</div>;
    const linkByMention = new Map(links.map((link) => [link.mention, link]));
    return (
        <div className="mb-4 rounded-xl border border-[#343434] bg-[#202020] px-4 py-3">
            <div className="mb-2 text-xs font-semibold text-[#d8d8d8]">本镜头引用资产</div>
            <div className="flex flex-wrap gap-2">
                {mentions.map((mention) => <PromptAssetChip key={mention} link={linkByMention.get(mention) || { mention, name: mention.replace(/^@/, ""), status: "missing" }} />)}
            </div>
        </div>
    );
}

function PromptBlock({ title, hint, value, mentions, links, tall, onChange }: { title: string; hint: string; value: string; mentions: string[]; links: NonNullable<StoryboardPromptDetail["assetMentionLinks"]>; tall?: boolean; onChange: (value: string) => void }) {
    return (
        <section className="mb-5 rounded-lg border border-[#363636] bg-[#202020]">
            <div className="flex items-center justify-between border-b border-[#343434] px-4 py-3">
                <div className="text-sm font-semibold text-[#f4f4f4]">{title}</div>
                <div className="text-xs text-[#8f8f8f]">{hint}</div>
            </div>
            <textarea className={`block w-full resize-none bg-transparent px-4 py-4 text-sm leading-7 text-[#ededed] outline-none ${tall ? "h-72" : "h-44"}`} value={value} onChange={(event) => onChange(event.target.value)} />
            <div className="border-t border-[#343434] px-4 py-3">
                <div className="mb-2 text-[11px] font-semibold text-[#9f9f9f]">高亮预览</div>
                <div className="min-h-10 whitespace-pre-wrap rounded-lg bg-black/20 px-3 py-2 text-xs leading-6 text-[#dcdcdc]">
                    {value.trim() ? renderPromptMentionPreview(value, mentions, links) : "这里会显示 @资产 的高亮效果，方便确认视频模型会拿到哪些参考资产。"}
                </div>
            </div>
        </section>
    );
}

function renderPromptMentionPreview(text: string, mentions: string[], links: StoryboardAssetMentionLink[]) {
    const allMentions = Array.from(new Set([...mentions, ...Array.from(text.matchAll(/@([^\s@，,、。；;：:）)】\]]+)/g)).map((match) => `@${match[1]}`)])).filter(Boolean).sort((a, b) => b.length - a.length);
    if (!allMentions.length) return text;
    const linkByMention = new Map(links.map((link) => [link.mention, link]));
    const parts: ReactNode[] = [];
    let index = 0;
    while (index < text.length) {
        const next = allMentions
            .map((mention) => ({ mention, at: text.indexOf(mention, index) }))
            .filter((item) => item.at >= 0)
            .sort((a, b) => a.at - b.at || b.mention.length - a.mention.length)[0];
        if (!next) {
            parts.push(text.slice(index));
            break;
        }
        if (next.at > index) parts.push(text.slice(index, next.at));
        parts.push(<PromptAssetChip key={`${next.mention}-${next.at}`} link={linkByMention.get(next.mention) || { mention: next.mention, name: next.mention.replace(/^@/, ""), status: "missing" }} inline />);
        index = next.at + next.mention.length;
    }
    return parts;
}

function PromptAssetChip({ link, inline }: { link: StoryboardAssetMentionLink; inline?: boolean }) {
    const bound = link.status === "bound";
    const title = bound ? `已绑定到资产节点：${link.name}` : "未绑定，请先批量生成或上传资产图，并检查资产名称";
    return (
        <span
            title={title}
            className={`inline-flex max-w-full items-center rounded-md border font-semibold ${inline ? "mx-1 translate-y-[-1px] align-baseline px-2 py-0.5 text-[11px]" : "px-3 py-1 text-xs"}`}
            style={{
                borderColor: bound ? "#2f80ff" : "#f59e0b",
                background: bound ? "rgba(47, 128, 255, .16)" : "rgba(245, 158, 11, .14)",
                color: bound ? "#79b2ff" : "#fbbf24",
            }}
        >
            <span className="truncate">{link.mention}</span>
            {!inline ? <span className="ml-1 opacity-70">{bound ? "已绑定" : "未绑定"}</span> : null}
        </span>
    );
}

function ShotImportModal({ open, rowCount, onClose, onImport }: { open: boolean; rowCount: number; onClose: () => void; onImport: (rows: string[][], mode: ShotImportMode, insertAfter: number) => void }) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [text, setText] = useState("");
    const [mode, setMode] = useState<ShotImportMode>("auto");
    const [insertAfter, setInsertAfter] = useState(String(rowCount));
    const parsedRows = useMemo(() => parseImportedRows(text), [text]);

    useEffect(() => {
        if (!open) return;
        setText("");
        setMode("auto");
        setInsertAfter(String(rowCount));
    }, [open, rowCount]);

    const readFile = async (file?: File) => {
        if (!file) return;
        setText(await file.text());
    };

    return (
        <Modal
            className="canvas-script-import-modal"
            open={open}
            title={<span className="text-[#f1f1f1]">导入镜头</span>}
            centered
            width={900}
            onCancel={onClose}
            footer={[
                <Button key="cancel" onClick={onClose}>
                    取消
                </Button>,
                <Button key="import" type="primary" disabled={!parsedRows.length} onClick={() => onImport(parsedRows, mode, Number(insertAfter) || rowCount)}>
                    导入 {parsedRows.length || ""} 个镜头
                </Button>,
            ]}
            styles={{ mask: { background: "rgba(0,0,0,.62)" }, content: { background: "#171717", color: "#f1f1f1" }, header: { background: "#171717" } } as any}
        >
            <div className="space-y-4 text-[#f1f1f1]">
                <div className="flex flex-wrap items-center gap-3">
                    <Button icon={<Upload className="size-4" />} onClick={() => fileInputRef.current?.click()}>
                        选择 TXT / MD / CSV
                    </Button>
                    <input ref={fileInputRef} type="file" accept=".txt,.md,.csv,.tsv,text/plain,text/markdown,text/csv" className="hidden" onChange={(event) => void readFile(event.target.files?.[0])} />
                    <select className="h-9 rounded-md border border-[#3a3a3a] bg-[#252525] px-3 text-sm text-[#f1f1f1] outline-none" value={mode} onChange={(event) => setMode(event.target.value as ShotImportMode)}>
                        <option value="auto">按镜号归位</option>
                        <option value="append">追加到末尾</option>
                        <option value="insert">插入到指定镜头后</option>
                    </select>
                    {mode === "insert" ? (
                        <label className="flex items-center gap-2 text-xs text-[#bcbcbc]">
                            插入到第
                            <input className="h-9 w-20 rounded-md border border-[#3a3a3a] bg-[#252525] px-2 text-center text-sm text-[#f1f1f1] outline-none" value={insertAfter} onChange={(event) => setInsertAfter(event.target.value.replace(/\D/g, ""))} />
                            镜后
                        </label>
                    ) : null}
                    <span className="text-xs text-[#9c9c9c]">可粘贴 Markdown 表格、CSV/TSV，或按“镜号：/画面描述：”分段。</span>
                </div>
                <textarea
                    className="thin-scrollbar h-64 w-full resize-none rounded-lg border border-[#343434] bg-[#101010] px-3 py-3 text-xs leading-5 text-[#f1f1f1] outline-none focus:border-[#777]"
                    placeholder={`| 镜号 | 时长 | 画面描述 | 景别 | 光影氛围 | 对白旁白 | 音效 | 运镜 | 分镜画面提示词 |\n| 35 | 5s | ... | 中景 | ... | ... | ... | 推进 | ... |`}
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                />
                <div className="rounded-lg border border-[#303030] bg-[#101010] p-3">
                    <div className="mb-2 text-xs font-semibold text-[#d8d8d8]">识别预览：{parsedRows.length ? `${parsedRows.length} 个镜头` : "未识别到镜头"}</div>
                    {parsedRows.length ? (
                        <div className="thin-scrollbar max-h-44 overflow-auto text-xs text-[#bdbdbd]">
                            {parsedRows.slice(0, 8).map((row, index) => (
                                <div key={index} className="grid grid-cols-[54px_62px_1fr] gap-2 border-t border-[#282828] py-2 first:border-t-0">
                                    <span className="text-center font-semibold text-[#f1f1f1]">{row[0] || index + 1}</span>
                                    <span>{row[1] || "5s"}</span>
                                    <span className="line-clamp-2">{row[2] || row[8] || "-"}</span>
                                </div>
                            ))}
                            {parsedRows.length > 8 ? <div className="pt-2 text-[#8f8f8f]">还有 {parsedRows.length - 8} 个镜头...</div> : null}
                        </div>
                    ) : (
                        <div className="text-xs text-[#8f8f8f]">请粘贴外部分镜文本，系统会转换成当前 9 列格式。</div>
                    )}
                </div>
            </div>
        </Modal>
    );
}

function initialPromptDetail(detail: StoryboardPromptDetail | null, row: string[]): StoryboardPromptDetail {
    return detail || { storyboardPrompt: row[8] || "", videoMotionPrompt: "", assetMentions: [] };
}

function hasComposedPrompt(detail?: StoryboardPromptDetail) {
    return Boolean(detail?.storyboardPrompt?.trim() || detail?.videoMotionPrompt?.trim());
}

function hasVideoPrompt(detail?: StoryboardPromptDetail) {
    return Boolean(detail?.videoMotionPrompt?.trim());
}

function promptTextForCopy(detail: StoryboardPromptDetail | undefined, fallback: string) {
    if (!detail) return fallback;
    return [`分镜提示词：\n${detail.storyboardPrompt || fallback}`, detail.videoMotionPrompt ? `视频运动提示词：\n${detail.videoMotionPrompt}` : "", detail.assetMentions?.length ? `资产引用：${detail.assetMentions.join("、")}` : ""].filter(Boolean).join("\n\n");
}

function AssetPrepView({ node, actionKey, assets, groupedAssets, style, error, onPrepareAssets, onSelectAsset, onGenerateAssetImage, onGenerateSceneSheet, onStopSceneSheet, onBatchGenerateSceneSheets, onStopSceneSheets, onGenerateAssetVoice, onPreviewSceneSheet }: { node: CanvasNodeData; actionKey?: string | null; assets: StoryboardAsset[]; groupedAssets: Record<StoryboardAssetKind, StoryboardAsset[]>; style: string; error: string; onPrepareAssets: (node: CanvasNodeData) => void; onSelectAsset: (assetId: string) => void; onGenerateAssetImage: (node: CanvasNodeData, assetId: string) => void; onGenerateSceneSheet: (node: CanvasNodeData, assetId: string) => void; onStopSceneSheet: (node: CanvasNodeData, assetId: string) => void; onBatchGenerateSceneSheets: (node: CanvasNodeData) => void; onStopSceneSheets: (node: CanvasNodeData) => void; onGenerateAssetVoice: (node: CanvasNodeData, assetId: string) => void; onPreviewSceneSheet: (assetId: string) => void }) {
    const preparing = actionKey === "asset:prepare";
    const progress = node.metadata?.storyboardAssetProgress;
    return (
        <div className="thin-scrollbar min-h-0 flex-1 overflow-auto px-8 py-5">
            <div className="mb-5 flex items-start gap-2 text-sm leading-7 text-[#d6d6d6]">
                <span className="rounded bg-cyan-500/20 px-2 py-0.5 text-xs font-semibold text-cyan-200">全局风格</span>
                <span>{preparing ? "正在根据剧本和分镜提炼统一视觉风格..." : style || "等待模型根据剧本和分镜提炼统一视觉风格。"}</span>
            </div>
            {preparing || progress ? <AssetRecognitionProgress progress={progress} /> : null}
            {error ? <div className="mb-5 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">识别失败：{error}</div> : null}
            {ASSET_SECTIONS.map(({ kind, title }) => (
                <section key={kind} className="mb-7">
                    <div className="mb-3 flex min-h-8 items-center gap-3">
                        <div className="text-sm font-semibold text-[#ededed]">{title}</div>
                        {kind === "scene" && groupedAssets.scene.length ? <BatchSceneSheetButton node={node} actionKey={actionKey} scenes={groupedAssets.scene} onBatchGenerateSceneSheets={onBatchGenerateSceneSheets} onStopSceneSheets={onStopSceneSheets} /> : null}
                    </div>
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-4">
                        {groupedAssets[kind].map((asset) => (
                            <AssetCard key={asset.id} asset={asset} actionKey={actionKey} onSelect={() => onSelectAsset(asset.id)} onGenerate={() => onGenerateAssetImage(node, asset.id)} onGenerateSceneSheet={() => onGenerateSceneSheet(node, asset.id)} onStopSceneSheet={() => onStopSceneSheet(node, asset.id)} onGenerateAssetVoice={() => onGenerateAssetVoice(node, asset.id)} onPreviewSceneSheet={() => onPreviewSceneSheet(asset.id)} />
                        ))}
                        <button className="grid min-h-[178px] place-items-center rounded-lg border border-dashed border-[#3d3d3d] bg-[#151515] text-[#7f7f7f]" disabled={preparing} onClick={() => onPrepareAssets(node)}>
                            <span className="flex flex-col items-center gap-2 text-xs">{preparing ? <LoaderCircle className="size-6 animate-spin" /> : <Plus className="size-6" />}{assets.length ? "重新识别资产" : "开始识别资产"}</span>
                        </button>
                    </div>
                </section>
            ))}
        </div>
    );
}

function BatchSceneSheetButton({ node, actionKey, scenes, onBatchGenerateSceneSheets, onStopSceneSheets }: { node: CanvasNodeData; actionKey?: string | null; scenes: StoryboardAsset[]; onBatchGenerateSceneSheets: (node: CanvasNodeData) => void; onStopSceneSheets: (node: CanvasNodeData) => void }) {
    const missing = scenes.filter((asset) => !asset.sceneSheetUrl && !asset.sceneSheetStorageKey).length;
    const running = actionKey === "asset-sheet:all";
    return (
        <button
            type="button"
            className={`inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md border px-3 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${running ? "border-red-400/35 bg-red-500/10 text-red-100 hover:border-red-300/55 hover:bg-red-500/15" : "border-emerald-400/25 bg-emerald-500/10 text-emerald-100 hover:border-emerald-300/45 hover:bg-emerald-500/15"}`}
            disabled={!running && (!missing || Boolean(actionKey && actionKey !== "asset-sheet:all"))}
            onClick={() => (running ? onStopSceneSheets(node) : onBatchGenerateSceneSheets(node))}
        >
            {running ? <Square className="size-3.5" /> : <Sparkles className="size-3.5" />}
            {running ? "一键暂停全部" : missing ? `一键生成全部多角度锁定图（剩 ${missing}）` : "多角度锁定图已完成"}
        </button>
    );
}

function AssetPrepToolbar({ node, actionKey, assets, groupedAssets, missingCount, preparing, generatingAssets, hasPartialAssets, readyAssets, onPrepareAssets, onBatchGenerateAssets, onStopAssetGeneration }: { node: CanvasNodeData; actionKey?: string | null; assets: StoryboardAsset[]; groupedAssets: Record<StoryboardAssetKind, StoryboardAsset[]>; missingCount: number; preparing: boolean; generatingAssets: boolean; hasPartialAssets: boolean; readyAssets: number; onPrepareAssets: (node: CanvasNodeData) => void; onBatchGenerateAssets: (node: CanvasNodeData) => void; onStopAssetGeneration: (node: CanvasNodeData) => void }) {
    return (
        <div className="flex shrink-0 items-center gap-4">
            <div className="max-w-[430px] text-right text-xs leading-5 text-[#c6c6c6]">
                {generatingAssets ? "正在生成资产；可以随时暂停，已完成的会保留。" : `检测到 ${groupedAssets.character.length} 个角色、${groupedAssets.scene.length} 个场景、${groupedAssets.prop.length} 个道具，其中 ${Math.max(missingCount, 0)} 个还没有可用参考。`}
            </div>
            <div className="flex items-center gap-2">
                <Button disabled={actionKey !== null} icon={preparing ? <LoaderCircle className="size-4 animate-spin" /> : undefined} onClick={() => onPrepareAssets(node)}>
                    {assets.length ? "重新识别" : "开始识别"}
                </Button>
                {generatingAssets ? (
                    <Button danger className="!h-10 !rounded-lg !px-8" icon={<Square className="size-4" />} onClick={() => onStopAssetGeneration(node)}>
                        暂停生成
                    </Button>
                ) : (
                    <Button type="primary" className="!h-10 !rounded-lg !px-8" icon={<Sparkles className="size-4" />} disabled={!assets.length || readyAssets === assets.length || actionKey !== null} onClick={() => onBatchGenerateAssets(node)}>
                        {hasPartialAssets ? "继续生成剩余资产" : "一键生成所有资产"}
                    </Button>
                )}
            </div>
        </div>
    );
}

function PromptStepToolbar({ node, rows, actionKey, videoPromptCount, onComposeFinalPrompt }: { node: CanvasNodeData; rows: string[][]; actionKey?: string | null; videoPromptCount: number; onComposeFinalPrompt: (node: CanvasNodeData, rowIndex?: number) => void }) {
    return (
        <div className="flex shrink-0 items-center gap-4">
            <Button type="primary" className="!h-10 !rounded-lg !px-7" disabled={!rows.length || actionKey !== null} icon={actionKey === "prompt:all" ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />} onClick={() => onComposeFinalPrompt(node)}>
                批量合成提示词
            </Button>
            <div className="text-sm font-semibold">{videoPromptCount}/{rows.length} 完成后可批量生视频</div>
        </div>
    );
}

function AssetRecognitionProgress({ progress }: { progress?: StoryboardAssetProgress }) {
    const percent = Math.max(6, Math.min(98, Math.round(progress?.percent || 12)));
    return (
        <div className="mb-5 rounded-xl border border-cyan-400/20 bg-[#122225] px-4 py-3">
            <div className="mb-2 flex items-center justify-between gap-3 text-xs">
                <span className="font-semibold text-cyan-100">{progress?.text || "准备识别资产"}</span>
                <span className="tabular-nums text-cyan-200/80">{percent}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-cyan-300 transition-all duration-500" style={{ width: `${percent}%` }} />
            </div>
        </div>
    );
}

function AssetCard({ asset, actionKey, onSelect, onGenerate, onGenerateSceneSheet, onStopSceneSheet, onGenerateAssetVoice, onPreviewSceneSheet }: { asset: StoryboardAsset; actionKey?: string | null; onSelect: () => void; onGenerate: () => void; onGenerateSceneSheet: () => void; onStopSceneSheet: () => void; onGenerateAssetVoice: () => void; onPreviewSceneSheet: () => void }) {
    const loading = actionKey === `asset:${asset.id}` || asset.status === "loading";
    const hasImage = Boolean(asset.imageUrl || asset.storageKey);
    const sheetLoading = actionKey === `asset-sheet:${asset.id}` || asset.sceneSheetStatus === "loading";
    const hasSceneSheet = Boolean(asset.sceneSheetUrl || asset.sceneSheetStorageKey);
    const voiceLoading = actionKey === `asset-voice:${asset.id}` || asset.voiceAudioStatus === "loading";
    const hasVoice = Boolean(asset.voiceAudioUrl || asset.voiceAudioStorageKey);
    const characterState = characterAssetStateText(asset);
    return (
        <div
            className="group min-w-0 cursor-pointer text-left"
            role="button"
            tabIndex={0}
            onClick={onSelect}
            onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect();
                }
            }}
        >
            <div className="relative mb-2 grid aspect-[16/9] place-items-center overflow-hidden rounded-lg border border-dashed border-[#3f3f3f] bg-[#111] text-xs text-[#818181] transition group-hover:border-[#6a6a6a]">
                {asset.imageUrl ? <img src={asset.imageUrl} alt={asset.name} className="size-full object-cover" /> : loading ? <LoaderCircle className="size-6 animate-spin" /> : `生成或上传${ASSET_KIND_LABEL[asset.kind]}图`}
                <span
                    className="absolute right-2 top-2 grid size-7 place-items-center rounded bg-[#050505]/85 text-[#f1f1f1] opacity-0 transition group-hover:opacity-100"
                    title={hasImage ? "重新生成" : "生成图片"}
                    onClick={(event) => {
                        event.stopPropagation();
                        onGenerate();
                    }}
                >
                    <Sparkles className="size-3.5" />
                </span>
            </div>
            {asset.kind === "scene" ? (
                <div className="mb-2 overflow-hidden rounded-lg border border-emerald-500/20 bg-emerald-500/5">
                    {hasSceneSheet ? (
                        <div
                            className="relative aspect-[16/9] bg-black"
                            onClick={(event) => {
                                event.stopPropagation();
                                if (asset.sceneSheetUrl) onPreviewSceneSheet();
                            }}
                        >
                            {asset.sceneSheetUrl ? <img src={asset.sceneSheetUrl} alt={`${asset.name} 多角度锁定图`} className="size-full object-contain" /> : <div className="grid size-full place-items-center text-[11px] text-emerald-200">多角度已锁定</div>}
                            <span className="absolute left-2 top-2 rounded bg-emerald-500/90 px-1.5 py-0.5 text-[10px] font-semibold text-white">多角度</span>
                            {asset.sceneSheetUrl ? <span className="absolute right-2 top-2 grid size-7 place-items-center rounded bg-black/75 text-white"><Maximize2 className="size-3.5" /></span> : null}
                        </div>
                    ) : (
                        <div className="grid min-h-16 place-items-center px-3 py-3 text-center text-[11px] leading-5 text-emerald-200/80">生成一张多角度锁定图，视频阶段用于理解同一地点不同机位</div>
                    )}
                    <button
                        type="button"
                        className={`flex h-8 w-full items-center justify-center gap-1.5 border-t text-[11px] font-semibold hover:bg-emerald-500/10 disabled:opacity-60 ${sheetLoading ? "border-red-500/15 text-red-100 hover:bg-red-500/10" : "border-emerald-500/15 text-emerald-200"}`}
                        disabled={!sheetLoading && Boolean(actionKey && actionKey !== `asset-sheet:${asset.id}`)}
                        onClick={(event) => {
                            event.stopPropagation();
                            if (sheetLoading) {
                                onStopSceneSheet();
                            } else {
                                onGenerateSceneSheet();
                            }
                        }}
                    >
                        {sheetLoading ? <Square className="size-3.5" /> : <Sparkles className="size-3.5" />}
                        {sheetLoading ? "暂停生成" : hasSceneSheet ? "重做多角度锁定图" : "生成多角度锁定图"}
                    </button>
                    {asset.sceneSheetError ? <div className="border-t border-red-500/20 px-2 py-1.5 text-[11px] leading-4 text-red-200">{asset.sceneSheetError}</div> : null}
                </div>
            ) : null}
            {asset.kind === "character" ? (
                <div className="mb-2 overflow-hidden rounded-lg border border-cyan-500/20 bg-cyan-500/5">
                    <div className="px-2.5 py-2">
                        <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-cyan-100"><Volume2 className="size-3.5" />角色声音</div>
                        {hasVoice ? (
                            <audio src={asset.voiceAudioUrl || asset.voiceAudioStorageKey} controls className="h-8 w-full" onClick={(event) => event.stopPropagation()} />
                        ) : (
                            <div className="text-[11px] leading-5 text-cyan-100/75">生成一段试听声音，后续视频会用它锁定角色音色</div>
                        )}
                    </div>
                    <button
                        type="button"
                        className="flex h-8 w-full items-center justify-center gap-1.5 border-t border-cyan-500/15 text-[11px] font-semibold text-cyan-100 hover:bg-cyan-500/10 disabled:opacity-60"
                        disabled={Boolean(actionKey && actionKey !== `asset-voice:${asset.id}`)}
                        onClick={(event) => {
                            event.stopPropagation();
                            onGenerateAssetVoice();
                        }}
                    >
                        {voiceLoading ? <LoaderCircle className="size-3.5 animate-spin" /> : <Volume2 className="size-3.5" />}
                        {hasVoice ? "重做角色声音" : "生成角色声音"}
                    </button>
                    {asset.voiceAudioError ? <div className="border-t border-red-500/20 px-2 py-1.5 text-[11px] leading-4 text-red-200">{asset.voiceAudioError}</div> : null}
                </div>
            ) : null}
            <div className="flex min-w-0 items-center gap-2">
                <div className="truncate text-sm font-semibold text-[#e8e8e8]">{asset.name || `未命名${ASSET_KIND_LABEL[asset.kind]}`}</div>
                {characterState ? <span className="shrink-0 rounded bg-cyan-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-100">{characterState}</span> : null}
            </div>
            <div className="mt-1 line-clamp-2 text-xs leading-5 text-[#8f8f8f]">{asset.description || asset.prompt || "点击补充描述与提示词"}</div>
        </div>
    );
}

function characterAssetStateText(asset: StoryboardAsset) {
    if (asset.kind !== "character") return "";
    return [asset.baseName, asset.lifeStage].filter(Boolean).join(" · ");
}

function AssetVoiceModelField({ config, onChange }: { config: AiConfig; onChange: (model: string) => void }) {
    const provider = resolveAudioProvider(config, config.audioModel || config.model);
    return (
        <div className="mb-4 rounded-lg border border-cyan-500/15 bg-black/10 p-2.5">
            <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[#f0f0f0]">音频模型</span>
                <span className="min-w-0 truncate text-[11px] text-cyan-100/70">
                    {provider.label} · {config.audioModel ? modelOptionLabel(config, config.audioModel) : "未选择"}
                </span>
            </div>
            <ModelPicker config={config} value={config.audioModel} capability="audio" className="!h-9 !w-full !max-w-full !rounded-lg !border-[#3f5358] !bg-[#26363a] !px-3 !text-cyan-50" fullWidth placeholder="选择生成角色声音的模型" onChange={onChange} />
        </div>
    );
}

function AssetVoiceSpeakerField({ asset, config, suggestion, onChange }: { asset: StoryboardAsset; config: AiConfig; suggestion: (typeof volcengineVoiceOptions)[number] | null; onChange: (value: string) => void }) {
    const [libraryOpen, setLibraryOpen] = useState(false);
    const provider = resolveAudioProvider(config, config.audioModel || config.model);
    const options = volcengineVoiceOptions.map((item) => ({
        value: item.value,
        label: `${item.label} · ${item.tone}`,
        searchText: [item.label, item.value, item.tone, ...item.tags].join(" "),
    }));
    const recommended = suggestion ? `${suggestion.label} · ${suggestion.value}` : "";
    const handleSpeakerChange = (value: string | string[]) => {
        const rawValue = Array.isArray(value) ? value[value.length - 1] || "" : value;
        onChange(normalizeSpeakerInput(rawValue));
    };
    if (provider.kind === "openai") {
        const currentVoice = audioVoiceOptions.find((item) => item.value === config.audioVoice)?.label || config.audioVoice || "alloy";
        return (
            <div className="mb-4 rounded-lg border border-cyan-500/15 bg-black/10 px-3 py-2 text-xs leading-5 text-cyan-100/65">
                当前是 OpenAI TTS，将使用全局 OpenAI voice：{currentVoice}。火山 Voice_type 和音色库只在火山 OpenSpeech 模型下显示。
            </div>
        );
    }
    if (provider.kind === "unsupported") {
        return <div className="mb-4 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs leading-5 text-red-100">当前音频模型暂不支持角色声音生成，请切换到 OpenAI TTS 或火山 OpenSpeech。</div>;
    }
    return (
        <div className="mb-4">
            <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[#f0f0f0]">声音 / speaker ID</span>
                <span className="flex items-center gap-1.5">
                    <Button size="small" type="text" className="!h-7 !px-2 !text-cyan-100" icon={<Volume2 className="size-3.5" />} onClick={() => setLibraryOpen(true)}>
                        打开音色库
                    </Button>
                    {suggestion ? (
                        <Button size="small" type="text" className="!h-7 !px-2 !text-cyan-100" onClick={() => onChange(suggestion.value)}>
                            自动填入推荐
                        </Button>
                    ) : null}
                </span>
            </div>
            <Select
                allowClear
                mode="tags"
                showSearch
                className="w-full"
                popupMatchSelectWidth={false}
                value={asset.voiceSpeaker ? [asset.voiceSpeaker] : []}
                placeholder={recommended || "粘贴官方 Voice_type，或选择内置火山音色"}
                options={options}
                optionFilterProp="searchText"
                maxCount={1}
                tokenSeparators={[",", "，", "\n", "\t"]}
                onChange={handleSpeakerChange}
                onBlur={() => handleSpeakerChange(asset.voiceSpeaker || "")}
            />
            <div className="mt-2 text-xs leading-5 text-cyan-100/60">请粘贴音色库里的 Voice_type，例如 zh_female_meilinvyou_uranus_bigtts；复制时出现空格会自动转成下划线。</div>
            {suggestion ? <div className="mt-2 truncate text-xs text-cyan-100/70">推荐：{recommended}</div> : null}
            <VolcengineVoiceLibraryModal open={libraryOpen} config={config} currentSpeaker={asset.voiceSpeaker || ""} roleName={asset.name} onClose={() => setLibraryOpen(false)} onSelect={(value) => onChange(value)} />
        </div>
    );
}

function normalizeSpeakerInput(value: string) {
    return value.trim().replace(/\s+/g, "_");
}

function AssetEditorField({ label, value, textarea, tall, placeholder, onChange }: { label: string; value: string; textarea?: boolean; tall?: boolean; placeholder?: string; onChange: (value: string) => void }) {
    return (
        <label className="mb-4 block">
            <span className="mb-2 block text-xs font-semibold text-[#f0f0f0]">{label}</span>
            {textarea ? <textarea className={`block w-full resize-none rounded-lg border border-[#383838] bg-[#303030] px-3 py-3 text-sm leading-6 text-[#f5f5f5] outline-none focus:border-[#777] ${tall ? "h-56" : "h-28"}`} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /> : <input className="block h-10 w-full rounded-lg border border-[#383838] bg-[#303030] px-3 text-sm text-[#f5f5f5] outline-none focus:border-[#777]" value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />}
        </label>
    );
}

function RowActionButton({ icon, title, loading, onClick }: { icon: ReactNode; title: string; loading: boolean; onClick: () => void }) {
    return <Button size="small" type="text" className="!text-[#d8d8d8]" title={title} disabled={loading} icon={loading ? <LoaderCircle className="size-3.5 animate-spin" /> : icon} onClick={onClick} />;
}

function Step({ index, title, detail, active, done, onClick }: { index: string; title: string; detail: string; active?: boolean; done?: boolean; onClick?: () => void }) {
    return (
        <button className={`flex min-w-0 items-center gap-3 text-left ${active || done ? "opacity-100" : "opacity-55"}`} onClick={onClick}>
            <span className={`grid size-9 shrink-0 place-items-center rounded-full border-2 text-sm font-semibold ${active || done ? "border-white" : "border-[#6b6b6b]"}`}>{index}</span>
            <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{title}</span>
                <span className="block truncate text-xs text-[#9c9c9c]">{detail}</span>
            </span>
        </button>
    );
}

function normalizeRows(rows?: string[][]) {
    const source = rows?.length ? rows : [COLUMNS, ...Array.from({ length: 9 }, (_, index) => [`${index + 1}`, "5s", "", "", "", "", "", "", ""])];
    const body = source[0]?.join("|").includes("镜号") ? source.slice(1) : source;
    return renumberRows(body.map((row, index) => COLUMNS.map((_, colIndex) => row[colIndex] || (colIndex === 0 ? `${index + 1}` : colIndex === 1 ? "5s" : ""))).slice(0, STORYBOARD_ROW_LIMIT));
}

function renumberRows(rows: string[][]) {
    return rows.map((row, index) => COLUMNS.map((_, colIndex) => (colIndex === 0 ? String(index + 1) : row[colIndex] || "")));
}

function mergeImportedRows(currentRows: string[][], importedRows: string[][], mode: ShotImportMode, insertAfter: number) {
    const nextRows = currentRows.map((row) => [...row]);
    const rowsToImport = importedRows.map(normalizeImportRow).filter((row) => row.some((cell, index) => index > 1 && cell.trim()));
    if (!rowsToImport.length) return nextRows;
    if (mode === "append") return [...nextRows, ...rowsToImport].slice(0, STORYBOARD_ROW_LIMIT);
    if (mode === "insert") {
        const index = Math.min(Math.max(insertAfter, 0), nextRows.length);
        return [...nextRows.slice(0, index), ...rowsToImport, ...nextRows.slice(index)].slice(0, STORYBOARD_ROW_LIMIT);
    }
    if (!rowsToImport.some((row) => shotNumber(row[0]) > 0)) return [...nextRows, ...rowsToImport].slice(0, STORYBOARD_ROW_LIMIT);
    rowsToImport.forEach((row) => {
        const index = shotNumber(row[0]) - 1;
        if (index < 0 || index >= STORYBOARD_ROW_LIMIT) return;
        while (nextRows.length <= index) nextRows.push([`${nextRows.length + 1}`, "5s", "", "", "", "", "", "", ""]);
        nextRows[index] = row;
    });
    return nextRows.slice(0, STORYBOARD_ROW_LIMIT);
}

function parseImportedRows(text: string) {
    const content = text.trim();
    if (!content) return [];
    const tableRows = parseImportedTableRows(content);
    if (tableRows.length) return tableRows;
    const delimitedRows = parseImportedDelimitedRows(content);
    if (delimitedRows.length) return delimitedRows;
    const blockRows = parseImportedBlocks(content);
    if (blockRows.length) return blockRows;
    return content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line, index) => normalizeImportRow([String(index + 1), "5s", line]));
}

function parseImportedTableRows(content: string) {
    const rows = content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.includes("|"))
        .map((line) => line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim()))
        .filter((row) => !isDividerRow(row) && !isImportHeaderRow(row));
    return rows.filter((row) => row.length >= 3).map(normalizeImportRow).slice(0, STORYBOARD_ROW_LIMIT);
}

function parseImportedDelimitedRows(content: string) {
    const rows = content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => (line.includes("\t") ? line.split("\t") : parseCsvLine(line)).map((cell) => cell.trim()))
        .filter((row) => row.length >= 3 && !isImportHeaderRow(row));
    return rows.some((row) => row.length >= 5 || shotNumber(row[0]) > 0) ? rows.map(normalizeImportRow).slice(0, STORYBOARD_ROW_LIMIT) : [];
}

function parseImportedBlocks(content: string) {
    const blocks = splitImportBlocks(content);
    return blocks.map(parseImportBlock).filter((row) => row.some((cell, index) => index > 1 && cell.trim())).slice(0, STORYBOARD_ROW_LIMIT);
}

function splitImportBlocks(content: string) {
    const blocks: string[][] = [];
    let current: string[] = [];
    content.split(/\r?\n/).forEach((rawLine) => {
        const line = rawLine.trim();
        if (!line) {
            if (current.length) blocks.push(current);
            current = [];
            return;
        }
        if (current.length && /^(?:镜头|镜号|shot)\s*[#：: -]*\d+/i.test(line)) {
            blocks.push(current);
            current = [];
        }
        current.push(line);
    });
    if (current.length) blocks.push(current);
    return blocks;
}

function parseImportBlock(lines: string[]) {
    const row = ["", "5s", "", "", "", "", "", "", ""];
    lines.forEach((line) => {
        const heading = line.match(/^(?:镜头|镜号|shot)\s*[#：: -]*(\d+)/i);
        if (heading) row[0] = heading[1];
        const matched = line.match(/^([^:：]+)[:：]\s*(.*)$/);
        if (!matched) return;
        const key = matched[1].trim();
        const value = matched[2].trim();
        const colIndex = importColumnIndex(key);
        if (colIndex >= 0) row[colIndex] = value;
    });
    if (!row[2]) {
        const plain = lines.filter((line) => !/^([^:：]+)[:：]/.test(line) && !/^(?:镜头|镜号|shot)\s*[#：: -]*\d+/i.test(line)).join(" ");
        row[2] = plain;
    }
    return normalizeImportRow(row);
}

function normalizeImportRow(row: string[]) {
    const normalized = COLUMNS.map((_, index) => row[index] || "");
    normalized[0] = shotNumber(normalized[0]) ? String(shotNumber(normalized[0])) : normalized[0];
    if (!normalized[1]) normalized[1] = "5s";
    return normalized;
}

function importColumnIndex(key: string) {
    if (/^(镜号|镜头|序号|shot)$/i.test(key)) return 0;
    if (/时长|时间|duration/i.test(key)) return 1;
    if (/画面|描述|内容|scene|visual/i.test(key)) return 2;
    if (/景别|景深|shot size/i.test(key)) return 3;
    if (/光影|氛围|灯光|lighting/i.test(key)) return 4;
    if (/对白|旁白|台词|dialogue|voice/i.test(key)) return 5;
    if (/音效|声音|sound/i.test(key)) return 6;
    if (/运镜|镜头运动|camera/i.test(key)) return 7;
    if (/最终|提示词|prompt/i.test(key)) return 8;
    return -1;
}

function isImportHeaderRow(row: string[]) {
    const joined = row.join("|");
    return joined.includes("镜号") || joined.includes("画面描述") || joined.includes("分镜画面提示词") || joined.includes("最终提示词");
}

function isDividerRow(row: string[]) {
    return row.every((cell) => /^:?-{2,}:?$/.test(cell.trim()));
}

function shotNumber(value: string) {
    return Number(value.match(/\d+/)?.[0] || 0);
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

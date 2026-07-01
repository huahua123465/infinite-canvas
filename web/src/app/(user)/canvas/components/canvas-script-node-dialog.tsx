"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, Dropdown, Modal } from "antd";
import { Copy, Ellipsis, Image as ImageIcon, LoaderCircle, Plus, Sparkles, Upload, Video, X } from "lucide-react";

import { ModelPicker } from "@/components/model-picker";
import type { AiConfig } from "@/stores/use-config-store";
import type { CanvasNodeData, StoryboardAsset, StoryboardAssetKind, StoryboardPromptDetail } from "../types";

const COLUMNS = ["镜号", "时长", "画面描述", "景别", "光影氛围", "对白旁白", "音效", "运镜", "最终提示词"];
const COL_WIDTHS = [64, 70, 300, 86, 220, 260, 190, 210, 270];
type ScriptDialogView = "shots" | "assets" | "prompts";
const ASSET_KIND_LABEL: Record<StoryboardAssetKind, string> = { character: "角色", scene: "场景", prop: "道具" };
const ASSET_SECTIONS: Array<{ kind: StoryboardAssetKind; title: string }> = [
    { kind: "character", title: "角色" },
    { kind: "scene", title: "场景" },
    { kind: "prop", title: "道具" },
];

type CanvasScriptNodeDialogProps = {
    node: CanvasNodeData | null;
    open: boolean;
    actionKey?: string | null;
    onClose: () => void;
    onRowsChange: (nodeId: string, content: string, rows: string[][]) => void;
    onPrepareAssets: (node: CanvasNodeData) => void;
    onUpdateAsset: (nodeId: string, assetId: string, patch: Partial<StoryboardAsset>) => void;
    onUploadAssetImage: (nodeId: string, assetId: string, file: File) => void;
    onGenerateAssetImage: (node: CanvasNodeData, assetId: string) => void;
    onBatchGenerateAssets: (node: CanvasNodeData) => void;
    onComposeFinalPrompt: (node: CanvasNodeData, rowIndex?: number) => void;
    onPromptDetailChange: (nodeId: string, rowIndex: number, detail: StoryboardPromptDetail) => void;
    onModelChange: (nodeId: string, model: string) => void;
    onGenerateImage: (node: CanvasNodeData, rowIndex: number) => void;
    onGenerateVideo: (node: CanvasNodeData, rowIndex: number) => void;
    onBatchGenerateVideos: (node: CanvasNodeData) => void;
    config: AiConfig;
};

export function CanvasScriptNodeDialog({ node, open, actionKey, onClose, onRowsChange, onPrepareAssets, onUpdateAsset, onUploadAssetImage, onGenerateAssetImage, onBatchGenerateAssets, onComposeFinalPrompt, onPromptDetailChange, onModelChange, onGenerateImage, onGenerateVideo, onBatchGenerateVideos, config }: CanvasScriptNodeDialogProps) {
    const rows = normalizeRows(node?.metadata?.storyboardRows);
    const assets = node?.metadata?.storyboardAssets || [];
    const style = node?.metadata?.storyboardAssetStyle || "";
    const assetError = node?.metadata?.storyboardAssetError || "";
    const promptDetails = node?.metadata?.storyboardPromptDetails || {};
    const filledCount = rows.filter((row) => row.some((cell, index) => index > 1 && cell.trim())).length;
    const promptCount = rows.filter((row, index) => promptDetails[String(index)]?.storyboardPrompt?.trim() || row[8]?.trim()).length;
    const readyAssets = assets.filter((asset) => asset.imageUrl || asset.storageKey).length;
    const [view, setView] = useState<ScriptDialogView>(node?.metadata?.storyboardStep === "assets" ? "assets" : node?.metadata?.storyboardStep === "prompts" ? "prompts" : "shots");
    const [editingAssetId, setEditingAssetId] = useState<string | null>(null);
    const [promptEditorRowIndex, setPromptEditorRowIndex] = useState<number | null>(null);
    const uploadInputRef = useRef<HTMLInputElement>(null);
    const editingAsset = assets.find((asset) => asset.id === editingAssetId) || null;
    const promptEditorRow = promptEditorRowIndex === null ? null : rows[promptEditorRowIndex] || null;
    const promptEditorDetail = promptEditorRowIndex === null ? null : promptDetails[String(promptEditorRowIndex)] || null;

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

    const saveRows = (nextRows: string[][]) => {
        if (!node) return;
        const normalized = renumberRows(nextRows);
        onRowsChange(node.id, rowsToMarkdown(normalized), [COLUMNS, ...normalized]);
    };

    const updateCell = (rowIndex: number, colIndex: number, value: string) => {
        const nextRows = rows.map((row) => [...row]);
        nextRows[rowIndex][colIndex] = value;
        saveRows(nextRows);
    };

    const addRow = () => saveRows([...rows, [`${rows.length + 1}`, "5s", "", "", "", "", "", "", ""]]);
    const deleteRow = (rowIndex: number) => saveRows(rows.filter((_, index) => index !== rowIndex));

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

    return (
        <Modal
            className="canvas-script-node-dialog"
            open={open && Boolean(node)}
            footer={null}
            closeIcon={editingAsset ? null : <X className="size-5" />}
            onCancel={onClose}
            width="100vw"
            centered
            styles={{
                mask: { background: "rgba(0,0,0,.72)" },
                content: { height: "100vh", padding: 0, borderRadius: 0, background: "#101010", overflow: "hidden" },
                body: { height: "100%" },
            }}
        >
            {node ? (
                <div className="flex h-full flex-col bg-[#101010] text-[#f1f1f1]">
                    <div className="grid h-20 grid-cols-[1fr_1fr_1fr_auto] items-center gap-6 border-b border-[#303030] bg-[#070707] px-8">
                        <Step index="1" title="确认镜头" detail={`${filledCount}/${rows.length} 镜头待校对`} active={view === "shots"} done={filledCount > 0} onClick={() => setView("shots")} />
                        <Step index="2" title="准备资产" detail={`${readyAssets}/${assets.length || 0} 已生成，还差 ${Math.max(assets.length - readyAssets, 0)} 个`} active={view === "assets"} done={assets.length > 0 && readyAssets === assets.length} onClick={openAssets} />
                        <Step index="3" title="合成提示词" detail={`${promptCount}/${rows.length} 已合成`} active={view === "prompts"} done={promptCount === rows.length && rows.length > 0} onClick={openPrompts} />
                        <div className="text-sm font-semibold">{promptCount}/{rows.length} 完成后可批量生视频</div>
                    </div>
                    {view === "assets" ? (
                        <AssetPrepView
                            node={node}
                            actionKey={actionKey}
                            assets={assets}
                            groupedAssets={groupedAssets}
                            style={style}
                            error={assetError}
                            readyAssets={readyAssets}
                            onPrepareAssets={onPrepareAssets}
                            onSelectAsset={setEditingAssetId}
                            onGenerateAssetImage={onGenerateAssetImage}
                            onBatchGenerateAssets={onBatchGenerateAssets}
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
                            onGenerateImage={onGenerateImage}
                            onGenerateVideo={onGenerateVideo}
                            onBatchGenerateVideos={onBatchGenerateVideos}
                            promptCount={promptCount}
                        />
                    ) : (
                        <ShotsTable node={node} rows={rows} actionKey={actionKey} promptDetails={promptDetails} onUpdateCell={updateCell} onDeleteRow={deleteRow} onAddRow={addRow} onComposeFinalPrompt={onComposeFinalPrompt} onOpenPrompt={setPromptEditorRowIndex} onGenerateImage={onGenerateImage} onGenerateVideo={onGenerateVideo} onOpenAssets={openAssets} promptCount={promptCount} />
                    )}
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
                    {editingAsset ? (
                        <div className="absolute inset-0 z-40 bg-transparent" onClick={() => setEditingAssetId(null)}>
                            <div className="absolute inset-y-0 right-0 flex w-[490px] flex-col border-l border-[#303030] bg-[#242424] shadow-[-18px_0_50px_rgba(0,0,0,.45)]" onClick={(event) => event.stopPropagation()}>
                                <div className="flex h-16 items-center justify-between border-b border-[#353535] px-5 pr-12">
                                    <div className="text-sm font-semibold">编辑{ASSET_KIND_LABEL[editingAsset.kind]}</div>
                                    <Button type="text" className="!size-9 !rounded-md !text-[#e8e8e8]" title="关闭编辑面板" icon={<X className="size-4" />} onClick={() => setEditingAssetId(null)} />
                                </div>
                                <div className="thin-scrollbar min-h-0 flex-1 overflow-auto px-5 py-4">
                                    <div className="mb-4 text-xs font-semibold text-[#f0f0f0]">{ASSET_KIND_LABEL[editingAsset.kind]}形象</div>
                                    <button className="relative mb-5 grid aspect-[4/3] w-full place-items-center overflow-hidden rounded-lg border border-dashed border-[#565656] bg-[#2d2d2d] text-xs text-[#979797]" onClick={() => uploadInputRef.current?.click()}>
                                        {editingAsset.imageUrl ? <img src={editingAsset.imageUrl} alt={editingAsset.name} className="size-full object-cover" /> : editingAsset.status === "loading" ? <LoaderCircle className="size-7 animate-spin" /> : <span className="flex flex-col items-center gap-2"><Plus className="size-7" />生成或上传{ASSET_KIND_LABEL[editingAsset.kind]}图</span>}
                                        <Dropdown
                                            trigger={["click"]}
                                            menu={{
                                                items: [
                                                    { key: "generate", label: "生成图片", icon: <Sparkles className="size-3.5" /> },
                                                    { key: "upload", label: "上传图片", icon: <Upload className="size-3.5" /> },
                                                ],
                                                onClick: ({ key, domEvent }) => {
                                                    domEvent.stopPropagation();
                                                    if (key === "generate") onGenerateAssetImage(node, editingAsset.id);
                                                    if (key === "upload") uploadInputRef.current?.click();
                                                },
                                            }}
                                        >
                                            <span className="absolute right-3 top-3 grid size-8 place-items-center rounded bg-[#111] text-[#f1f1f1]" onClick={(event) => event.stopPropagation()}>
                                                <Ellipsis className="size-4" />
                                            </span>
                                        </Dropdown>
                                    </button>
                                    <input ref={uploadInputRef} type="file" accept="image/*" className="hidden" onChange={(event) => uploadEditingAsset(event.target.files?.[0])} />
                                    <AssetEditorField label={`${ASSET_KIND_LABEL[editingAsset.kind]}名称`} value={editingAsset.name} onChange={(value) => onUpdateAsset(node.id, editingAsset.id, { name: value })} />
                                    <AssetEditorField label={`${ASSET_KIND_LABEL[editingAsset.kind]}描述`} value={editingAsset.description} textarea onChange={(value) => onUpdateAsset(node.id, editingAsset.id, { description: value })} />
                                    <AssetEditorField label="生成提示词" value={editingAsset.prompt} textarea tall onChange={(value) => onUpdateAsset(node.id, editingAsset.id, { prompt: value })} />
                                    {editingAsset.errorDetails ? <div className="mt-3 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">{editingAsset.errorDetails}</div> : null}
                                </div>
                                <div className="flex h-16 items-center justify-end gap-2 border-t border-[#353535] px-5">
                                    <Button onClick={() => uploadInputRef.current?.click()}>上传图片</Button>
                                    <Button type="primary" icon={actionKey === `asset:${editingAsset.id}` ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />} disabled={actionKey !== null} onClick={() => onGenerateAssetImage(node, editingAsset.id)}>
                                        生成图片
                                    </Button>
                                </div>
                            </div>
                        </div>
                    ) : null}
                </div>
            ) : null}
        </Modal>
    );
}

function ShotsTable({ node, rows, actionKey, promptDetails, onUpdateCell, onDeleteRow, onAddRow, onComposeFinalPrompt, onOpenPrompt, onGenerateImage, onGenerateVideo, onOpenAssets, promptCount }: { node: CanvasNodeData; rows: string[][]; actionKey?: string | null; promptDetails: Record<string, StoryboardPromptDetail>; onUpdateCell: (rowIndex: number, colIndex: number, value: string) => void; onDeleteRow: (rowIndex: number) => void; onAddRow: () => void; onComposeFinalPrompt: (node: CanvasNodeData, rowIndex?: number) => void; onOpenPrompt: (rowIndex: number) => void; onGenerateImage: (node: CanvasNodeData, rowIndex: number) => void; onGenerateVideo: (node: CanvasNodeData, rowIndex: number) => void; onOpenAssets: () => void; promptCount: number }) {
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
                                                    { key: "copy", label: "复制最终提示词", icon: <Copy className="size-3.5" /> },
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
            <div className="flex h-16 items-center justify-between border-t border-[#303030] bg-[#121212] px-8">
                <Button icon={<Plus className="size-4" />} type="text" className="!text-[#f1f1f1]" onClick={onAddRow}>
                    添加镜头
                </Button>
                <Button type="primary" className="!h-10 !rounded-lg !px-8" disabled={!promptCount || actionKey !== null} onClick={onOpenAssets}>
                    下一步：准备资产
                </Button>
                <Button className="!h-10 !rounded-lg !px-8" disabled={!rows.length || actionKey !== null} icon={actionKey === "prompt:all" ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />} onClick={() => onComposeFinalPrompt(node)}>
                    批量合成提示词
                </Button>
            </div>
        </>
    );
}

function PromptComposeView({ node, rows, actionKey, promptDetails, config, model, onModelChange, onOpenPrompt, onComposeFinalPrompt, onGenerateImage, onGenerateVideo, onBatchGenerateVideos, promptCount }: { node: CanvasNodeData; rows: string[][]; actionKey?: string | null; promptDetails: Record<string, StoryboardPromptDetail>; config: AiConfig; model: string; onModelChange: (model: string) => void; onOpenPrompt: (rowIndex: number) => void; onComposeFinalPrompt: (node: CanvasNodeData, rowIndex?: number) => void; onGenerateImage: (node: CanvasNodeData, rowIndex: number) => void; onGenerateVideo: (node: CanvasNodeData, rowIndex: number) => void; onBatchGenerateVideos: (node: CanvasNodeData) => void; promptCount: number }) {
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
                            <th className="w-[310px] border-b border-r border-[#343434] px-3 py-3 font-medium">最终提示词</th>
                            <th className="w-24 border-b border-[#343434] px-3 py-3 text-center font-medium">操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row, rowIndex) => {
                            const detail = promptDetails[String(rowIndex)];
                            const hasPrompt = Boolean(detail?.storyboardPrompt?.trim());
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
                                                    {detail?.videoMotionPrompt ? <span className="mt-2 inline-flex rounded bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-200">已生成视频运动提示词</span> : null}
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
            <div className="flex h-16 items-center justify-between border-t border-[#303030] bg-[#121212] px-8">
                <div className="text-xs text-[#bcbcbc]">{promptCount}/{rows.length} 已合成，支持逐镜头单独重写，也可以批量重写全部镜头。</div>
                <div className="flex items-center gap-2">
                    <ModelPicker config={config} value={model} capability="text" className="!h-10 !rounded-lg !border-[#444] !bg-[#242424] !text-[#f4f4f4]" onChange={onModelChange} />
                    <Button className="!h-10 !rounded-lg !px-8" disabled={!promptCount || actionKey !== null} icon={actionKey === "video:all" ? <LoaderCircle className="size-4 animate-spin" /> : <Video className="size-4" />} onClick={() => onBatchGenerateVideos(node)}>
                        批量生成视频
                    </Button>
                    <Button type="primary" className="!h-10 !rounded-lg !px-8" disabled={!rows.length || actionKey !== null} icon={actionKey === "prompt:all" ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />} onClick={() => onComposeFinalPrompt(node)}>
                        批量合成提示词
                    </Button>
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
            }}
        >
            <div className="flex max-h-[min(88vh,820px)] flex-col text-[#f3f3f3]">
                <div className="flex items-center justify-between border-b border-[#343434] bg-[#151515] px-6 py-4 pr-12">
                    <div className="min-w-0">
                        <div className="text-base font-semibold">第 {row[0] || rowIndex + 1} 镜：最终提示词</div>
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
                    <div className="mb-4 flex flex-wrap gap-2">
                        {mentions.length ? mentions.map((mention) => <span key={mention} className="rounded-full border border-cyan-400/25 bg-cyan-400/10 px-3 py-1 text-xs font-semibold text-cyan-100">{mention}</span>) : <span className="rounded-full border border-[#444] bg-[#252525] px-3 py-1 text-xs text-[#9f9f9f]">重新合成后会自动 @ 人物、场景、道具</span>}
                    </div>
                    <PromptBlock
                        title="分镜提示词"
                        hint="用于首帧图、分镜图和画面生成"
                        value={draft.storyboardPrompt}
                        onChange={(storyboardPrompt) => updateDraft({ storyboardPrompt })}
                    />
                    <PromptBlock
                        title="视频运动提示词"
                        hint="用于视频模型理解起始状态、动作过程、结束状态、镜头运动、情绪节奏与声音"
                        value={draft.videoMotionPrompt}
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
                        <Button type="primary" className="!h-10 !rounded-lg !px-7" onClick={() => onSave({ ...draft, assetMentions: mentions.map((item) => item.trim()).filter(Boolean) })}>保存</Button>
                    </div>
                </div>
            </div>
        </Modal>
    );
}

function PromptBlock({ title, hint, value, tall, onChange }: { title: string; hint: string; value: string; tall?: boolean; onChange: (value: string) => void }) {
    return (
        <section className="mb-5 rounded-lg border border-[#363636] bg-[#202020]">
            <div className="flex items-center justify-between border-b border-[#343434] px-4 py-3">
                <div className="text-sm font-semibold text-[#f4f4f4]">{title}</div>
                <div className="text-xs text-[#8f8f8f]">{hint}</div>
            </div>
            <textarea className={`block w-full resize-none bg-transparent px-4 py-4 text-sm leading-7 text-[#ededed] outline-none ${tall ? "h-72" : "h-44"}`} value={value} onChange={(event) => onChange(event.target.value)} />
        </section>
    );
}

function initialPromptDetail(detail: StoryboardPromptDetail | null, row: string[]): StoryboardPromptDetail {
    return detail || { storyboardPrompt: row[8] || "", videoMotionPrompt: "", assetMentions: [] };
}

function promptTextForCopy(detail: StoryboardPromptDetail | undefined, fallback: string) {
    if (!detail) return fallback;
    return [`分镜提示词：\n${detail.storyboardPrompt || fallback}`, detail.videoMotionPrompt ? `视频运动提示词：\n${detail.videoMotionPrompt}` : "", detail.assetMentions?.length ? `资产引用：${detail.assetMentions.join("、")}` : ""].filter(Boolean).join("\n\n");
}

function AssetPrepView({ node, actionKey, assets, groupedAssets, style, error, readyAssets, onPrepareAssets, onSelectAsset, onGenerateAssetImage, onBatchGenerateAssets }: { node: CanvasNodeData; actionKey?: string | null; assets: StoryboardAsset[]; groupedAssets: Record<StoryboardAssetKind, StoryboardAsset[]>; style: string; error: string; readyAssets: number; onPrepareAssets: (node: CanvasNodeData) => void; onSelectAsset: (assetId: string) => void; onGenerateAssetImage: (node: CanvasNodeData, assetId: string) => void; onBatchGenerateAssets: (node: CanvasNodeData) => void }) {
    const missingCount = assets.length - readyAssets;
    const preparing = actionKey === "asset:prepare";
    return (
        <>
            <div className="thin-scrollbar min-h-0 flex-1 overflow-auto px-8 py-5">
                <div className="mb-5 flex items-start gap-2 text-sm leading-7 text-[#d6d6d6]">
                    <span className="rounded bg-cyan-500/20 px-2 py-0.5 text-xs font-semibold text-cyan-200">全局风格</span>
                    <span>{preparing ? "正在根据剧本和分镜提炼统一视觉风格..." : style || "等待模型根据剧本和分镜提炼统一视觉风格。"}</span>
                </div>
                {error ? <div className="mb-5 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">识别失败：{error}</div> : null}
                {ASSET_SECTIONS.map(({ kind, title }) => (
                    <section key={kind} className="mb-7">
                        <div className="mb-3 text-sm font-semibold text-[#ededed]">{title}</div>
                        <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-4">
                            {groupedAssets[kind].map((asset) => (
                                <AssetCard key={asset.id} asset={asset} actionKey={actionKey} onSelect={() => onSelectAsset(asset.id)} onGenerate={() => onGenerateAssetImage(node, asset.id)} />
                            ))}
                            <button className="grid min-h-[178px] place-items-center rounded-lg border border-dashed border-[#3d3d3d] bg-[#151515] text-[#7f7f7f]" disabled={preparing} onClick={() => onPrepareAssets(node)}>
                                <span className="flex flex-col items-center gap-2 text-xs">{preparing ? <LoaderCircle className="size-6 animate-spin" /> : <Plus className="size-6" />}{assets.length ? "重新识别资产" : "开始识别资产"}</span>
                            </button>
                        </div>
                    </section>
                ))}
            </div>
            <div className="flex h-16 items-center justify-between border-t border-[#303030] bg-[#202020] px-8">
                <div className="text-xs text-[#c6c6c6]">检测到 {groupedAssets.character.length} 个角色、{groupedAssets.scene.length} 个场景、{groupedAssets.prop.length} 个道具，其中 {Math.max(missingCount, 0)} 个没有设定图，您可以手动上传或 AI 批量生成</div>
                <div className="flex items-center gap-2">
                    <Button disabled={actionKey !== null} icon={preparing ? <LoaderCircle className="size-4 animate-spin" /> : undefined} onClick={() => onPrepareAssets(node)}>
                        {assets.length ? "重新识别" : "开始识别"}
                    </Button>
                    <Button type="primary" className="!h-10 !rounded-lg !px-8" icon={actionKey === "asset:all" ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />} disabled={!assets.length || readyAssets === assets.length || actionKey !== null} onClick={() => onBatchGenerateAssets(node)}>
                        一键生成所有资产
                    </Button>
                </div>
            </div>
        </>
    );
}

function AssetCard({ asset, actionKey, onSelect, onGenerate }: { asset: StoryboardAsset; actionKey?: string | null; onSelect: () => void; onGenerate: () => void }) {
    const loading = actionKey === `asset:${asset.id}` || asset.status === "loading";
    return (
        <button className="group min-w-0 text-left" onClick={onSelect}>
            <div className="relative mb-2 grid aspect-[16/9] place-items-center overflow-hidden rounded-lg border border-dashed border-[#3f3f3f] bg-[#111] text-xs text-[#818181] transition group-hover:border-[#6a6a6a]">
                {asset.imageUrl ? <img src={asset.imageUrl} alt={asset.name} className="size-full object-cover" /> : loading ? <LoaderCircle className="size-6 animate-spin" /> : `生成或上传${ASSET_KIND_LABEL[asset.kind]}图`}
                <span
                    className="absolute right-2 top-2 grid size-7 place-items-center rounded bg-[#050505]/85 text-[#f1f1f1] opacity-0 transition group-hover:opacity-100"
                    onClick={(event) => {
                        event.stopPropagation();
                        onGenerate();
                    }}
                >
                    <Sparkles className="size-3.5" />
                </span>
            </div>
            <div className="truncate text-sm font-semibold text-[#e8e8e8]">{asset.name || `未命名${ASSET_KIND_LABEL[asset.kind]}`}</div>
            <div className="mt-1 line-clamp-2 text-xs leading-5 text-[#8f8f8f]">{asset.description || asset.prompt || "点击补充描述与提示词"}</div>
        </button>
    );
}

function AssetEditorField({ label, value, textarea, tall, onChange }: { label: string; value: string; textarea?: boolean; tall?: boolean; onChange: (value: string) => void }) {
    return (
        <label className="mb-4 block">
            <span className="mb-2 block text-xs font-semibold text-[#f0f0f0]">{label}</span>
            {textarea ? <textarea className={`block w-full resize-none rounded-lg border border-[#383838] bg-[#303030] px-3 py-3 text-sm leading-6 text-[#f5f5f5] outline-none focus:border-[#777] ${tall ? "h-56" : "h-28"}`} value={value} onChange={(event) => onChange(event.target.value)} /> : <input className="block h-10 w-full rounded-lg border border-[#383838] bg-[#303030] px-3 text-sm text-[#f5f5f5] outline-none focus:border-[#777]" value={value} onChange={(event) => onChange(event.target.value)} />}
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
    return renumberRows(body.map((row, index) => COLUMNS.map((_, colIndex) => row[colIndex] || (colIndex === 0 ? `${index + 1}` : colIndex === 1 ? "5s" : ""))).slice(0, 60));
}

function renumberRows(rows: string[][]) {
    return rows.map((row, index) => COLUMNS.map((_, colIndex) => (colIndex === 0 ? String(index + 1) : row[colIndex] || "")));
}

function rowsToMarkdown(rows: string[][]) {
    return [`| ${COLUMNS.join(" | ")} |`, `| ${COLUMNS.map(() => "---").join(" | ")} |`, ...rows.map((row) => `| ${COLUMNS.map((_, index) => (row[index] || "").replace(/\n/g, " ")).join(" | ")} |`)].join("\n");
}

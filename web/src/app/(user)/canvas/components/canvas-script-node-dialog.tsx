"use client";

import type { ReactNode } from "react";
import { Button, Dropdown, Modal } from "antd";
import { Copy, Ellipsis, Film, Image as ImageIcon, LoaderCircle, Plus, Sparkles, Video, X } from "lucide-react";

import type { CanvasNodeData } from "../types";

const COLUMNS = ["镜号", "时长", "画面描述", "景别", "光影氛围", "对白旁白", "音效", "运镜", "最终提示词"];
const COL_WIDTHS = [64, 70, 300, 86, 220, 260, 190, 210, 270];

type CanvasScriptNodeDialogProps = {
    node: CanvasNodeData | null;
    open: boolean;
    actionKey?: string | null;
    onClose: () => void;
    onRowsChange: (nodeId: string, content: string, rows: string[][]) => void;
    onComposeFinalPrompt: (node: CanvasNodeData, rowIndex?: number) => void;
    onGenerateImage: (node: CanvasNodeData, rowIndex: number) => void;
    onGenerateVideo: (node: CanvasNodeData, rowIndex: number) => void;
    onBatchGenerateImages: (node: CanvasNodeData) => void;
    onBatchGenerateVideos: (node: CanvasNodeData) => void;
};

export function CanvasScriptNodeDialog({ node, open, actionKey, onClose, onRowsChange, onComposeFinalPrompt, onGenerateImage, onGenerateVideo, onBatchGenerateImages, onBatchGenerateVideos }: CanvasScriptNodeDialogProps) {
    const rows = normalizeRows(node?.metadata?.storyboardRows);
    const filledCount = rows.filter((row) => row.some((cell, index) => index > 1 && cell.trim())).length;
    const promptCount = rows.filter((row) => row[8]?.trim()).length;

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

    return (
        <Modal
            className="canvas-script-node-dialog"
            open={open && Boolean(node)}
            footer={null}
            closeIcon={<X className="size-5" />}
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
                        <Step index="1" title="确认镜头" detail={`${filledCount}/${rows.length} 镜头待校对`} active />
                        <Step index="2" title="准备资产" detail="可批量生成分镜图" active={promptCount > 0} />
                        <Step index="3" title="合成提示词" detail={`${promptCount}/${rows.length} 已合成`} active={promptCount > 0} />
                        <div className="text-sm font-semibold">{filledCount}/{rows.length} 完成后可批量生视频</div>
                    </div>
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
                                        {COLUMNS.map((_, colIndex) => (
                                            <td key={colIndex} className={`${colIndex === 0 ? `sticky left-0 z-10 ${rowIndex % 2 ? "bg-[#202020]" : "bg-[#151515]"}` : ""} border-b border-r border-[#303030] align-top`}>
                                                <textarea
                                                    className={`block w-full resize-none bg-transparent px-3 py-3 leading-5 outline-none ${colIndex < 2 ? "text-center font-semibold" : ""}`}
                                                    style={{ minHeight: 78, color: colIndex === 8 ? "#bdbdbd" : "#f1f1f1" }}
                                                    value={row[colIndex] || ""}
                                                    onChange={(event) => updateCell(rowIndex, colIndex, event.target.value)}
                                                />
                                            </td>
                                        ))}
                                        <td className="border-b border-[#303030] px-3 py-3">
                                            <div className="flex items-center justify-center gap-1.5">
                                                <RowActionButton loading={actionKey === `prompt:${rowIndex}`} icon={<Sparkles className="size-3.5" />} title="合成最终提示词" onClick={() => node && onComposeFinalPrompt(node, rowIndex)} />
                                                <RowActionButton loading={actionKey === `image:${rowIndex}`} icon={<ImageIcon className="size-3.5" />} title="生成分镜图" onClick={() => node && onGenerateImage(node, rowIndex)} />
                                                <RowActionButton loading={actionKey === `video:${rowIndex}`} icon={<Video className="size-3.5" />} title="生成视频" onClick={() => node && onGenerateVideo(node, rowIndex)} />
                                                <Dropdown
                                                    trigger={["click"]}
                                                    menu={{
                                                        items: [
                                                            { key: "copy", label: "复制最终提示词", icon: <Copy className="size-3.5" /> },
                                                            { key: "delete", label: "删除镜头", danger: true },
                                                        ],
                                                        onClick: ({ key }) => {
                                                            if (key === "copy") void navigator.clipboard?.writeText(row[8] || "");
                                                            if (key === "delete") deleteRow(rowIndex);
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
                        <Button icon={<Plus className="size-4" />} type="text" className="!text-[#f1f1f1]" onClick={addRow}>
                            添加镜头
                        </Button>
                        <div className="flex items-center gap-2">
                            <Button icon={actionKey === "prompt:all" ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />} className="!h-10 !rounded-lg" disabled={!node || actionKey !== null} onClick={() => node && onComposeFinalPrompt(node)}>
                                批量合成提示词
                            </Button>
                            <Button icon={actionKey === "image:all" ? <LoaderCircle className="size-4 animate-spin" /> : <ImageIcon className="size-4" />} className="!h-10 !rounded-lg" disabled={!node || actionKey !== null} onClick={() => node && onBatchGenerateImages(node)}>
                                批量生成分镜图
                            </Button>
                            <Button icon={actionKey === "video:all" ? <LoaderCircle className="size-4 animate-spin" /> : <Film className="size-4" />} className="!h-10 !rounded-lg" disabled={!node || actionKey !== null} onClick={() => node && onBatchGenerateVideos(node)}>
                                批量生成视频
                            </Button>
                        </div>
                        <Button type="primary" className="!h-10 !rounded-lg !px-8" disabled={!promptCount}>
                            下一步：准备资产
                        </Button>
                    </div>
                </div>
            ) : null}
        </Modal>
    );
}

function RowActionButton({ icon, title, loading, onClick }: { icon: ReactNode; title: string; loading: boolean; onClick: () => void }) {
    return (
        <Button size="small" type="text" className="!text-[#d8d8d8]" title={title} disabled={loading} icon={loading ? <LoaderCircle className="size-3.5 animate-spin" /> : icon} onClick={onClick} />
    );
}

function Step({ index, title, detail, active }: { index: string; title: string; detail: string; active?: boolean }) {
    return (
        <div className={`flex min-w-0 items-center gap-3 ${active ? "opacity-100" : "opacity-55"}`}>
            <span className={`grid size-9 shrink-0 place-items-center rounded-full border-2 text-sm font-semibold ${active ? "border-white" : "border-[#6b6b6b]"}`}>{index}</span>
            <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{title}</div>
                <div className="truncate text-xs text-[#9c9c9c]">{detail}</div>
            </div>
        </div>
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

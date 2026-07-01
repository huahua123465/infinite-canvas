"use client";

import { Button, Modal } from "antd";
import { Plus, X } from "lucide-react";

import type { CanvasNodeData } from "../types";

const COLUMNS = ["镜号", "时长", "画面描述", "景别", "光影氛围", "对白旁白", "音效", "运镜", "最终提示词"];
const COL_WIDTHS = [64, 70, 300, 86, 220, 260, 190, 210, 270];

type CanvasScriptNodeDialogProps = {
    node: CanvasNodeData | null;
    open: boolean;
    onClose: () => void;
    onRowsChange: (nodeId: string, content: string, rows: string[][]) => void;
};

export function CanvasScriptNodeDialog({ node, open, onClose, onRowsChange }: CanvasScriptNodeDialogProps) {
    const rows = normalizeRows(node?.metadata?.storyboardRows);
    const filledCount = rows.filter((row) => row.some((cell, index) => index > 1 && cell.trim())).length;

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
                        <Step index="2" title="准备资产" detail={`0/${rows.length} 已生成`} />
                        <Step index="3" title="合成提示词" detail={`0/${rows.length} 已合成`} />
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
                                    <th className="w-24 border-b border-[#343434] px-3 py-3 font-medium">操作</th>
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
                                        <td className="border-b border-[#303030] px-3 py-3 text-center">
                                            <Button size="small" danger ghost onClick={() => deleteRow(rowIndex)}>
                                                删除
                                            </Button>
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
                        <Button type="primary" className="!h-10 !rounded-lg !px-8">
                            下一步：准备资产
                        </Button>
                    </div>
                </div>
            ) : null}
        </Modal>
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

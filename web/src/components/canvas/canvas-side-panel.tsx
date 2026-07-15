import { useDeferredValue, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Input, Select } from "antd";
import { Boxes, ChevronRight, Clapperboard, FileText, Image as ImageIcon, Layers3, Music2, PanelLeftClose, PanelLeftOpen, Puzzle, Search, Settings2, Type, Video } from "lucide-react";

import { canvasThemes, type CanvasTheme } from "@/lib/canvas-theme";
import { getNodeDefinition, isBuiltinNodeType, useNodeRegistryVersion } from "@/lib/canvas/node-registry";
import { cn } from "@/lib/utils";
import { useAssetStore, type Asset, type AssetKind } from "@/stores/use-asset-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

import type { InsertAssetPayload } from "./asset-picker-modal";

type PanelTab = "canvas" | "assets";
type NodeFilter = "all" | "plugin" | CanvasNodeType;
type NodeIcon = typeof ImageIcon;

type Props = {
    nodes: CanvasNodeData[];
    selectedNodeIds: Set<string>;
    onFocusNode: (nodeId: string) => void;
    onInsertAsset: (payload: InsertAssetPayload) => void;
};

const NODE_TYPE_META: Record<CanvasNodeType, { label: string; icon: NodeIcon }> = {
    [CanvasNodeType.Image]: { label: "图片", icon: ImageIcon },
    [CanvasNodeType.Video]: { label: "视频", icon: Video },
    [CanvasNodeType.Audio]: { label: "音频", icon: Music2 },
    [CanvasNodeType.Text]: { label: "文本", icon: Type },
    [CanvasNodeType.Config]: { label: "配置", icon: Settings2 },
    [CanvasNodeType.Script]: { label: "Script", icon: Clapperboard },
    [CanvasNodeType.Group]: { label: "分组", icon: Layers3 },
    [CanvasNodeType.Workspace]: { label: "工作区", icon: Boxes },
};

const NODE_FILTER_OPTIONS: { label: string; value: NodeFilter }[] = [
    { label: "全部", value: "all" },
    ...Object.entries(NODE_TYPE_META).map(([value, item]) => ({ label: item.label, value: value as CanvasNodeType })),
    { label: "插件", value: "plugin" },
];

const STATUS_COLOR: Record<string, string> = {
    success: "#22c55e",
    loading: "#f59e0b",
    error: "#ef4444",
};

const ASSET_GROUPS: { kind: AssetKind; label: string; icon: NodeIcon }[] = [
    { kind: "image", label: "图片素材", icon: ImageIcon },
    { kind: "video", label: "视频素材", icon: Video },
    { kind: "text", label: "文本素材", icon: FileText },
];

export function CanvasSidePanel({ nodes, selectedNodeIds, onFocusNode, onInsertAsset }: Props) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [open, setOpen] = useState(true);
    const [tab, setTab] = useState<PanelTab>("canvas");

    if (!open) {
        return (
            <aside className="flex h-full w-12 shrink-0 justify-center border-r pt-3" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border }} data-canvas-no-zoom>
                <button
                    type="button"
                    className="grid size-8 place-items-center rounded-lg transition hover:opacity-70"
                    style={{ color: theme.node.text }}
                    onClick={() => setOpen(true)}
                    title="展开画布导航"
                    aria-label="展开画布导航"
                    aria-expanded={false}
                >
                    <PanelLeftOpen className="size-4" />
                </button>
            </aside>
        );
    }

    return (
        <aside className="flex h-full w-72 shrink-0 flex-col overflow-hidden border-r" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }} data-canvas-no-zoom>
            <div className="flex items-center gap-1 px-3 pb-2 pt-3">
                <TabButton label="画布" active={tab === "canvas"} theme={theme} onClick={() => setTab("canvas")} />
                <TabButton label="素材" active={tab === "assets"} theme={theme} onClick={() => setTab("assets")} />
                <button
                    type="button"
                    className="ml-auto grid size-8 place-items-center rounded-lg transition hover:opacity-70"
                    style={{ color: theme.node.muted }}
                    onClick={() => setOpen(false)}
                    title="收起画布导航"
                    aria-label="收起画布导航"
                    aria-expanded={true}
                >
                    <PanelLeftClose className="size-4" />
                </button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
                {tab === "canvas" ? <CanvasNodesTab nodes={nodes} selectedNodeIds={selectedNodeIds} onFocusNode={onFocusNode} theme={theme} /> : <CanvasAssetsTab onInsert={onInsertAsset} theme={theme} />}
            </div>
        </aside>
    );
}

function TabButton({ label, active, theme, onClick }: { label: string; active: boolean; theme: CanvasTheme; onClick: () => void }) {
    return (
        <button type="button" onClick={onClick} className="rounded-lg px-3 py-1.5 text-sm font-semibold transition hover:opacity-90" style={{ background: active ? theme.toolbar.activeBg : "transparent", color: active ? theme.toolbar.activeText : theme.node.muted }}>
            {label}
        </button>
    );
}

function CanvasNodesTab({ nodes, selectedNodeIds, onFocusNode, theme }: { nodes: CanvasNodeData[]; selectedNodeIds: Set<string>; onFocusNode: (nodeId: string) => void; theme: CanvasTheme }) {
    useNodeRegistryVersion((state) => state.version);
    const [keyword, setKeyword] = useState("");
    const [typeFilter, setTypeFilter] = useState<NodeFilter>("all");
    const deferredKeyword = useDeferredValue(keyword.trim().toLowerCase());

    const filtered = useMemo(
        () =>
            nodes.filter((node) => {
                const matchesType = typeFilter === "all" || (typeFilter === "plugin" ? !isBuiltinNodeType(node.type) : node.type === typeFilter);
                if (!matchesType || !deferredKeyword) return matchesType;
                const definition = getNodeDefinition(node.type);
                return [node.title, node.type, definition?.title, node.metadata?.content, node.metadata?.prompt].filter(Boolean).join(" ").toLowerCase().includes(deferredKeyword);
            }),
        [deferredKeyword, nodes, typeFilter],
    );

    return (
        <div className="flex h-full flex-col">
            <div className="flex items-center gap-2 px-3 pb-2 pt-1">
                <span className="text-xs font-medium" style={{ color: theme.node.muted }}>
                    画布元素
                </span>
                <span className="text-xs opacity-40">{filtered.length}</span>
                <Select<NodeFilter> size="small" variant="borderless" className="ml-auto w-24" value={typeFilter} onChange={setTypeFilter} options={NODE_FILTER_OPTIONS} />
            </div>
            <div className="px-3 pb-2.5">
                <Input size="small" allowClear prefix={<Search className="size-3.5" style={{ color: theme.node.muted }} />} placeholder="搜索节点" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
                {filtered.length ? (
                    <div className="space-y-1">
                        {filtered.map((node) => (
                            <NodeItem key={node.id} node={node} active={selectedNodeIds.has(node.id)} theme={theme} onClick={() => onFocusNode(node.id)} />
                        ))}
                    </div>
                ) : (
                    <PanelEmpty title={nodes.length ? "没有匹配的节点" : "画布暂无节点"} theme={theme} />
                )}
            </div>
        </div>
    );
}

function NodeItem({ node, active, theme, onClick }: { node: CanvasNodeData; active: boolean; theme: CanvasTheme; onClick: () => void }) {
    const definition = getNodeDefinition(node.type);
    const builtin = isBuiltinNodeType(node.type) ? NODE_TYPE_META[node.type] : null;
    const Icon = builtin?.icon;
    const icon: ReactNode = Icon ? <Icon className="size-4" /> : definition?.icon || <Puzzle className="size-4" />;
    const preview = nodePreviewText(node, definition?.description || definition?.title || builtin?.label || node.type);

    return (
        <button
            type="button"
            onClick={onClick}
            className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:opacity-90"
            style={{ background: active ? theme.toolbar.activeBg : "transparent", contentVisibility: "auto", containIntrinsicSize: "56px" }}
        >
            <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-md [&>svg]:size-4" style={{ background: theme.node.fill, color: theme.node.label }}>
                {node.type === CanvasNodeType.Image && node.metadata?.content ? <img src={node.metadata.content} alt="" className="size-full object-cover" /> : icon}
            </span>
            <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium leading-5">{node.title || definition?.title || builtin?.label || "未命名节点"}</span>
                <span className="block truncate text-xs leading-4" style={{ color: theme.node.muted }}>
                    {preview}
                </span>
            </span>
            {node.metadata?.status && node.metadata.status !== "idle" ? <span className="size-1.5 shrink-0 rounded-full" style={{ background: STATUS_COLOR[node.metadata.status] || theme.node.faint }} /> : null}
        </button>
    );
}

function nodePreviewText(node: CanvasNodeData, fallback: string) {
    if (node.type === CanvasNodeType.Text || node.type === CanvasNodeType.Script) return node.metadata?.content || node.metadata?.prompt || fallback;
    if (node.type === CanvasNodeType.Config) return node.metadata?.composerContent || node.metadata?.prompt || node.metadata?.model || fallback;
    if (!isBuiltinNodeType(node.type)) return node.metadata?.content || node.metadata?.prompt || fallback;
    return fallback;
}

function CanvasAssetsTab({ onInsert, theme }: { onInsert: (payload: InsertAssetPayload) => void; theme: CanvasTheme }) {
    const assets = useAssetStore((state) => state.assets);
    const hydrated = useAssetStore((state) => state.hydrated);
    const [keyword, setKeyword] = useState("");
    const [tagFilter, setTagFilter] = useState("all");
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
    const deferredKeyword = useDeferredValue(keyword.trim().toLowerCase());
    const allTags = useMemo(() => Array.from(new Set(assets.flatMap((asset) => asset.tags || []))).slice(0, 12), [assets]);
    const groups = useMemo(
        () =>
            ASSET_GROUPS.map((group) => ({
                ...group,
                items: assets.filter((asset) => (tagFilter === "all" || asset.tags.includes(tagFilter)) && (!deferredKeyword || [asset.title, ...asset.tags].join(" ").toLowerCase().includes(deferredKeyword)) && asset.kind === group.kind),
            })).filter((group) => group.items.length),
        [assets, deferredKeyword, tagFilter],
    );

    return (
        <div className="flex h-full flex-col">
            <div className="px-3 pb-2">
                <Input size="small" allowClear prefix={<Search className="size-3.5" style={{ color: theme.node.muted }} />} placeholder="搜索素材" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
            </div>
            {allTags.length ? (
                <div className="flex gap-1.5 overflow-x-auto px-3 pb-2">
                    {["all", ...allTags].map((tag) => (
                        <button key={tag} type="button" onClick={() => setTagFilter(tag)} className="shrink-0 rounded-md px-2 py-1 text-[11px] font-medium transition" style={{ background: tagFilter === tag ? theme.toolbar.activeBg : "transparent", color: tagFilter === tag ? theme.toolbar.activeText : theme.node.muted }}>
                            {tag === "all" ? "全部" : tag}
                        </button>
                    ))}
                </div>
            ) : null}
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
                {!hydrated ? (
                    <PanelEmpty title="正在读取本地素材" theme={theme} />
                ) : groups.length ? (
                    <div className="space-y-1">
                        {groups.map((group) => {
                            const isCollapsed = collapsed[group.kind];
                            return (
                                <div key={group.kind}>
                                    <button type="button" onClick={() => setCollapsed((current) => ({ ...current, [group.kind]: !current[group.kind] }))} className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-2 text-left text-xs font-semibold transition hover:opacity-75" style={{ color: theme.node.label }}>
                                        <ChevronRight className={cn("size-3.5 transition-transform", !isCollapsed && "rotate-90")} />
                                        <group.icon className="size-3.5" />
                                        <span>{group.label}</span>
                                        <span className="opacity-45">{group.items.length}</span>
                                    </button>
                                    {isCollapsed ? null : (
                                        <div className="grid grid-cols-2 gap-2 px-1 pb-2">
                                            {group.items.map((asset) => (
                                                <AssetCard key={asset.id} asset={asset} theme={theme} onClick={() => onInsert(buildInsertPayload(asset))} />
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <PanelEmpty title={assets.length ? "没有匹配的素材" : "暂无本地素材"} theme={theme} />
                )}
            </div>
        </div>
    );
}

function AssetCard({ asset, theme, onClick }: { asset: Asset; theme: CanvasTheme; onClick: () => void }) {
    const cover = asset.coverUrl || (asset.kind === "image" ? asset.data.dataUrl : "");
    const preview = asset.kind === "text" ? asset.data.content : "";
    return (
        <button type="button" onClick={onClick} className="group overflow-hidden rounded-lg border text-left transition hover:opacity-85" style={{ borderColor: theme.node.stroke, background: theme.node.panel, contentVisibility: "auto", containIntrinsicSize: "120px" }}>
            {cover ? <img src={cover} alt="" className="aspect-square w-full object-cover" /> : <div className="flex aspect-square items-center justify-center p-2 text-center text-[11px] leading-4" style={{ background: theme.node.fill, color: theme.node.muted }}>{preview || asset.title}</div>}
            <div className="truncate px-2 py-1.5 text-[11px] font-medium">{asset.title}</div>
        </button>
    );
}

function buildInsertPayload(asset: Asset): InsertAssetPayload {
    if (asset.kind === "text") return { kind: "text", content: asset.data.content, title: asset.title };
    if (asset.kind === "video") return { kind: "video", url: asset.data.url, storageKey: asset.data.storageKey, title: asset.title, width: asset.data.width, height: asset.data.height };
    return { kind: "image", dataUrl: asset.data.dataUrl, storageKey: asset.data.storageKey, title: asset.title };
}

function PanelEmpty({ title, theme }: { title: string; theme: CanvasTheme }) {
    return <div className="px-4 pt-16 text-center text-sm" style={{ color: theme.node.faint }}>{title}</div>;
}

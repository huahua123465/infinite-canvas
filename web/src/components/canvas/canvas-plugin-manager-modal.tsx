import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { App, Button, Input, Modal, Popconfirm, Switch, Tabs } from "antd";
import { AlertTriangle, Download, Puzzle, RefreshCw, Trash2 } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { installPluginFromUrl, setPluginEnabled, uninstallPlugin, updatePlugin } from "@/lib/canvas/plugin-loader";
import { fetchOfficialPlugins, type OfficialPluginEntry } from "@/lib/canvas/plugin-registry";
import { usePluginStore, type InstalledPlugin } from "@/stores/canvas/use-plugin-store";
import { useThemeStore } from "@/stores/use-theme-store";

export function CanvasPluginManagerModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const plugins = usePluginStore((state) => state.plugins);
    const { message } = App.useApp();
    const [url, setUrl] = useState("");
    const [installing, setInstalling] = useState(false);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [official, setOfficial] = useState<OfficialPluginEntry[]>([]);
    const [officialError, setOfficialError] = useState<string | null>(null);
    const [loadingOfficial, setLoadingOfficial] = useState(false);

    const installedById = useMemo(() => new Map(plugins.map((item) => [item.id, item])), [plugins]);
    const localPlugins = useMemo(() => plugins.filter((item) => item.local), [plugins]);
    const thirdPartyPlugins = useMemo(() => plugins.filter((item) => !item.local && !item.official), [plugins]);

    const loadOfficial = useCallback(async () => {
        setLoadingOfficial(true);
        setOfficialError(null);
        try {
            setOfficial(await fetchOfficialPlugins());
        } catch (error) {
            setOfficialError(error instanceof Error ? error.message : String(error));
        } finally {
            setLoadingOfficial(false);
        }
    }, []);

    useEffect(() => {
        if (open && !official.length && !loadingOfficial && !officialError) void loadOfficial();
    }, [loadOfficial, loadingOfficial, official.length, officialError, open]);

    const installUrl = async () => {
        if (!url.trim()) return;
        setInstalling(true);
        try {
            const plugin = await installPluginFromUrl(url.trim());
            message.success(`已安装插件 ${plugin.name}`);
            setUrl("");
        } catch (error) {
            message.error(`安装失败：${error instanceof Error ? error.message : String(error)}`);
        } finally {
            setInstalling(false);
        }
    };

    const installOfficial = async (entry: OfficialPluginEntry) => {
        setBusyId(entry.id);
        try {
            const plugin = await installPluginFromUrl(entry.url, { official: true });
            message.success(`已安装 ${plugin.name}`);
        } catch (error) {
            message.error(`安装失败：${error instanceof Error ? error.message : String(error)}`);
        } finally {
            setBusyId(null);
        }
    };

    const runAction = async (record: InstalledPlugin, action: () => Promise<void>, success: string) => {
        setBusyId(record.id);
        try {
            await action();
            message.success(success);
        } catch (error) {
            message.error(error instanceof Error ? error.message : String(error));
        } finally {
            setBusyId(null);
        }
    };

    const controls = (record: InstalledPlugin) => (
        <>
            <Switch size="small" checked={record.enabled} loading={busyId === record.id} onChange={(enabled) => runAction(record, () => setPluginEnabled(record, enabled), enabled ? "已启用" : "已禁用")} />
            {!record.local ? (
                <>
                    <Button type="text" size="small" icon={<RefreshCw className="size-4" />} loading={busyId === record.id} title="从来源更新" onClick={() => runAction(record, async () => void (await updatePlugin(record)), "已更新")} />
                    <Popconfirm title="卸载该插件？" okText="卸载" cancelText="取消" onConfirm={() => uninstallPlugin(record.id)}>
                        <Button type="text" size="small" danger icon={<Trash2 className="size-4" />} title="卸载" />
                    </Popconfirm>
                </>
            ) : null}
        </>
    );

    const row = (key: string, icon: ReactNode, name: string, version: string, description: string | undefined, action: ReactNode) => (
        <div key={key} className="flex items-center gap-3 rounded-xl border px-3 py-2.5" style={{ borderColor: theme.node.stroke, background: theme.node.fill }}>
            <span className="grid size-9 shrink-0 place-items-center rounded-lg text-base" style={{ background: theme.toolbar.activeBg, color: theme.node.muted }}>{icon}</span>
            <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2 text-sm font-medium" style={{ color: theme.node.text }}>
                    <span className="truncate">{name}</span>
                    <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px]" style={{ background: theme.toolbar.activeBg, color: theme.node.muted }}>v{version}</span>
                </div>
                {description ? <div className="mt-0.5 truncate text-xs" style={{ color: theme.node.muted }}>{description}</div> : null}
            </div>
            {action}
        </div>
    );

    const empty = (text: string) => <div className="py-10 text-center text-sm" style={{ color: theme.node.muted }}>{text}</div>;
    const officialTab = officialError ? (
        <div className="space-y-3">
            <div className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>加载失败：{officialError}</div>
            <Button type="text" size="small" icon={<RefreshCw className="size-4" />} onClick={loadOfficial}>重新加载</Button>
        </div>
    ) : loadingOfficial && !official.length ? empty("正在获取官方插件…") : official.length ? (
        <div className="thin-scrollbar max-h-[46vh] space-y-2 overflow-auto">
            {official.map((entry) => {
                const record = installedById.get(entry.id);
                return row(entry.id, entry.icon || <Puzzle className="size-4" />, entry.name, entry.version, entry.description, record ? controls(record) : <Button type="primary" size="small" icon={<Download className="size-4" />} loading={busyId === entry.id} onClick={() => installOfficial(entry)}>安装</Button>);
            })}
        </div>
    ) : empty("暂无官方插件");
    const localTab = <div className="thin-scrollbar max-h-[52vh] space-y-2 overflow-auto">{localPlugins.map((record) => row(record.id, <Puzzle className="size-4" />, record.name, record.version, record.description || record.url, controls(record)))}</div>;
    const thirdPartyTab = (
        <div className="space-y-3">
            <div className="flex gap-2">
                <Input placeholder="输入插件 JS 文件 URL" value={url} onChange={(event) => setUrl(event.target.value)} onPressEnter={installUrl} allowClear />
                <Button type="primary" loading={installing} icon={<Puzzle className="size-4" />} onClick={installUrl}>安装</Button>
            </div>
            <div className="thin-scrollbar max-h-[42vh] space-y-2 overflow-auto">{thirdPartyPlugins.length ? thirdPartyPlugins.map((record) => row(record.id, <Puzzle className="size-4" />, record.name, record.version, record.description || record.url, controls(record))) : empty("还没有安装第三方插件")}</div>
        </div>
    );

    const items = [
        { key: "official", label: "官方插件", children: officialTab },
        ...(localPlugins.length ? [{ key: "local", label: "本地插件", children: localTab }] : []),
        { key: "third", label: "第三方插件", children: thirdPartyTab },
    ];

    return (
        <Modal title="节点插件" open={open} onCancel={onClose} footer={null} centered width={640}>
            <div className="space-y-3">
                <div className="flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-5" style={{ borderColor: "#f59e0b55", background: "#f59e0b14", color: theme.node.text }}>
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
                    <span>插件代码会在当前页面内直接执行，可访问本地数据（包含 AI API Key）。请仅安装你信任来源的插件。</span>
                </div>
                <Tabs defaultActiveKey="official" items={items} />
            </div>
        </Modal>
    );
}

import { registerNodeDefinitions, unregisterPluginNodes } from "@/lib/canvas/node-registry";
import { getPluginRuntime } from "@/lib/canvas/plugin-runtime";
import { usePluginStore, type InstalledPlugin } from "@/stores/canvas/use-plugin-store";
import type { CanvasPlugin, CanvasPluginFactory } from "@/types/canvas-plugin";

const cleanups = new Map<string, () => void>();

function normalizePluginUrl(value: string) {
    const url = new URL(value, window.location.href);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("插件地址只支持 HTTP 或 HTTPS");
    return url.href;
}

function normalizeBundledPluginUrl(value: string) {
    const url = new URL(value, window.location.href);
    if (url.origin !== window.location.origin || !url.pathname.startsWith("/plugins/")) throw new Error("内置插件只能从当前站点的 /plugins/ 目录加载");
    return url.href;
}

async function evaluatePluginSource(source: string): Promise<CanvasPlugin> {
    const runtime = getPluginRuntime();
    const blobUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    try {
        return readPluginModule(await import(/* @vite-ignore */ blobUrl), runtime);
    } finally {
        URL.revokeObjectURL(blobUrl);
    }
}

async function evaluatePluginUrl(inputUrl: string): Promise<CanvasPlugin> {
    const runtime = getPluginRuntime();
    const url = new URL(normalizeBundledPluginUrl(inputUrl));
    url.searchParams.set("plugin_t", String(Date.now()));
    return readPluginModule(await import(/* @vite-ignore */ url.href), runtime);
}

function readPluginModule(module: unknown, runtime = getPluginRuntime()) {
    const value = module as { default?: unknown; plugin?: unknown };
    const exported = value.default ?? value.plugin;
    const plugin = typeof exported === "function" ? (exported as CanvasPluginFactory)(runtime) : exported;
    assertPlugin(plugin);
    return plugin;
}

function assertPlugin(plugin: unknown): asserts plugin is CanvasPlugin {
    const value = plugin as Partial<CanvasPlugin> | null;
    if (!value || typeof value !== "object") throw new Error("插件未导出有效对象");
    if (!value.id || !/^[a-z0-9][a-z0-9._-]*$/i.test(value.id)) throw new Error("插件缺少有效 id");
    if (!Array.isArray(value.nodes) || !value.nodes.length) throw new Error("插件至少需要声明一个节点");
    if (value.nodes.some((node) => !node?.type || !node.defaultSize?.width || !node.defaultSize?.height)) throw new Error("插件包含无效节点定义");
}

export function activatePlugin(plugin: CanvasPlugin) {
    const runtime = getPluginRuntime();
    const disposers: Array<() => void> = [];
    try {
        registerNodeDefinitions(plugin.nodes, plugin.id);
        if (plugin.css) disposers.push(runtime.injectCSS(plugin.css, plugin.id));
        const cleanup = plugin.setup?.(runtime);
        if (typeof cleanup === "function") disposers.push(cleanup);
        cleanups.set(plugin.id, () =>
            disposers.splice(0).reverse().forEach((dispose) => {
                try {
                    dispose();
                } catch (error) {
                    console.error(`[plugin] 清理失败: ${plugin.id}`, error);
                }
            }),
        );
    } catch (error) {
        disposers.splice(0).reverse().forEach((dispose) => dispose());
        unregisterPluginNodes(plugin.id);
        throw error;
    }
}

export function deactivatePlugin(pluginId: string) {
    try {
        cleanups.get(pluginId)?.();
    } finally {
        cleanups.delete(pluginId);
        unregisterPluginNodes(pluginId);
    }
}

async function fetchPluginSource(url: string) {
    const response = await fetch(normalizePluginUrl(url), { cache: "no-store" });
    if (!response.ok) throw new Error(`插件下载失败（HTTP ${response.status}）`);
    return response.text();
}

async function restorePlugin(record?: InstalledPlugin) {
    if (!record?.enabled) return;
    try {
        activatePlugin(await loadInstalledPlugin(record));
    } catch (error) {
        console.error(`[plugin] 恢复旧版本失败: ${record.id}`, error);
    }
}

export async function installPluginFromUrl(inputUrl: string, options?: { official?: boolean; bundled?: boolean; expectedId?: string }) {
    const url = normalizePluginUrl(inputUrl);
    const source = options?.bundled ? "" : await fetchPluginSource(url);
    const plugin = options?.bundled ? await evaluatePluginUrl(url) : await evaluatePluginSource(source);
    if (options?.expectedId && plugin.id !== options.expectedId) throw new Error(`插件更新后的 id 必须保持为 ${options.expectedId}`);
    const previous = usePluginStore.getState().plugins.find((item) => item.id === plugin.id);
    deactivatePlugin(plugin.id);
    try {
        activatePlugin(plugin);
    } catch (error) {
        await restorePlugin(previous);
        throw error;
    }
    usePluginStore.getState().upsert({ id: plugin.id, name: plugin.name || plugin.id, version: plugin.version || "0.0.0", description: plugin.description, url, source, enabled: true, official: options?.official, bundled: options?.bundled });
    return plugin;
}

export async function updatePlugin(record: InstalledPlugin) {
    return installPluginFromUrl(record.url, { official: record.official, bundled: record.bundled, expectedId: record.id });
}

export async function setPluginEnabled(record: InstalledPlugin, enabled: boolean) {
    if (!enabled) {
        deactivatePlugin(record.id);
        usePluginStore.getState().setEnabled(record.id, false);
        return;
    }
    const plugin = await loadInstalledPlugin(record);
    if (plugin.id !== record.id) throw new Error(`插件 id 已变化，预期 ${record.id}，实际 ${plugin.id}`);
    deactivatePlugin(record.id);
    activatePlugin(plugin);
    usePluginStore.getState().setEnabled(record.id, true);
}

export function uninstallPlugin(id: string) {
    deactivatePlugin(id);
    usePluginStore.getState().remove(id);
}

let loaded = false;

export async function ensurePluginsLoaded() {
    if (loaded) return;
    loaded = true;
    try {
        getPluginRuntime();
        await usePluginStore.persist.rehydrate();
        await discoverLocalPlugins();
        for (const record of usePluginStore.getState().plugins.filter((item) => item.enabled)) {
            try {
                activatePlugin(await loadInstalledPlugin(record));
            } catch (error) {
                console.error(`[plugin] 加载失败: ${record.id}`, error);
            }
        }
        await loadDevelopmentPlugins();
    } catch (error) {
        loaded = false;
        throw error;
    }
}

async function loadInstalledPlugin(record: InstalledPlugin) {
    if (record.bundled) return evaluatePluginUrl(record.url);
    const source = record.local ? await fetchPluginSource(record.url) : record.source;
    return evaluatePluginSource(source);
}

async function discoverLocalPlugins() {
    try {
        const response = await fetch("/plugins/index.json", { cache: "no-store" });
        if (!response.ok) return;
        const urls = (await response.json()) as unknown;
        if (!Array.isArray(urls)) return;
        for (const value of urls) {
            if (typeof value !== "string") continue;
            try {
                const url = normalizePluginUrl(value);
                const source = await fetchPluginSource(url);
                const plugin = await evaluatePluginSource(source);
                if (usePluginStore.getState().plugins.some((item) => item.id === plugin.id)) continue;
                usePluginStore.getState().upsert({ id: plugin.id, name: plugin.name || plugin.id, version: plugin.version || "0.0.0", description: plugin.description, url, source, enabled: false, local: true });
            } catch (error) {
                console.error(`[plugin] 本地插件发现失败: ${String(value)}`, error);
            }
        }
    } catch {
        return;
    }
}

async function loadDevelopmentPlugins() {
    const urls = String(import.meta.env.VITE_DEV_PLUGINS || "").split(",").map((item) => item.trim()).filter(Boolean);
    for (const value of urls) {
        try {
            const source = await fetchPluginSource(value);
            const plugin = await evaluatePluginSource(source);
            deactivatePlugin(plugin.id);
            activatePlugin(plugin);
        } catch (error) {
            console.error(`[plugin] 开发插件加载失败: ${value}`, error);
        }
    }
}

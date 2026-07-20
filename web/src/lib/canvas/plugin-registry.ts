import { PLUGIN_REGISTRY_URL } from "@/constant/env";

export type OfficialPluginEntry = {
    id: string;
    name: string;
    version: string;
    description?: string;
    icon?: string;
    url: string;
};

export type BundledPluginEntry = OfficialPluginEntry;

type RawEntry = Partial<OfficialPluginEntry> & { entry?: string };
type RawManifest = { plugins?: RawEntry[] };

export async function fetchOfficialPlugins(registryUrl = PLUGIN_REGISTRY_URL): Promise<OfficialPluginEntry[]> {
    const manifestUrl = new URL(registryUrl, window.location.href).toString();
    const response = await fetch(manifestUrl, { cache: "no-store", headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`官方插件列表加载失败（HTTP ${response.status}）`);
    const manifest = (await response.json()) as RawManifest;
    return (Array.isArray(manifest.plugins) ? manifest.plugins : []).flatMap((entry) => {
        if (!entry.id || (!entry.entry && !entry.url)) return [];
        return [{ id: entry.id, name: entry.name || entry.id, version: entry.version || "0.0.0", description: entry.description, icon: entry.icon, url: new URL(entry.url || entry.entry!, manifestUrl).toString() }];
    });
}

export async function fetchBundledPlugins(catalogUrl = "/plugins/catalog.json"): Promise<BundledPluginEntry[]> {
    const manifestUrl = new URL(catalogUrl, window.location.href).toString();
    const response = await fetch(manifestUrl, { cache: "no-store", headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`内置插件列表加载失败（HTTP ${response.status}）`);
    const manifest = (await response.json()) as RawManifest;
    return (Array.isArray(manifest.plugins) ? manifest.plugins : []).flatMap((entry) => {
        if (!entry.id || (!entry.entry && !entry.url)) return [];
        return [{ id: entry.id, name: entry.name || entry.id, version: entry.version || "0.0.0", description: entry.description, icon: entry.icon, url: new URL(entry.url || entry.entry!, manifestUrl).toString() }];
    });
}

function compareSemver(a: string, b: string) {
    const parse = (value: string) => value.split(".").map((part) => parseInt(part, 10) || 0);
    const [left, right] = [parse(a), parse(b)];
    for (let index = 0; index < 3; index += 1) {
        const difference = (left[index] || 0) - (right[index] || 0);
        if (difference) return difference;
    }
    return 0;
}

export function hasUpgrade(installedVersion: string, remoteVersion: string) {
    return compareSemver(remoteVersion, installedVersion) > 0;
}

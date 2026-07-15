import type { NavigateFunction } from "react-router-dom";

import { imageAspectOptions, imageQualityOptions } from "@/components/image-settings-panel";
import { videoResolutionOptions, videoSecondOptions, videoSizeOptions } from "@/components/video-settings-panel";
import { fetchPrompts } from "@/services/api/prompts";
import { uploadImage } from "@/services/image-storage";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useAssetStore } from "@/stores/use-asset-store";
import { modelOptionLabel, modelOptionName, normalizeModelOptionValue, useConfigStore } from "@/stores/use-config-store";
import { useWorkbenchAgentStore } from "@/stores/use-workbench-agent-store";

export const SITE_TOOL_NAMES = ["canvas_list_projects", "workbench_image_get_config", "workbench_image_generate", "workbench_video_get_config", "workbench_video_generate", "prompts_search", "assets_list", "assets_add"] as const;
export type SiteToolName = (typeof SITE_TOOL_NAMES)[number];

export const SITE_TOOL_LABELS: Record<SiteToolName, string> = {
    canvas_list_projects: "画布列表",
    workbench_image_get_config: "生图配置",
    workbench_image_generate: "生图工作台生成",
    workbench_video_get_config: "视频配置",
    workbench_video_generate: "视频创作台生成",
    prompts_search: "搜索提示词",
    assets_list: "素材列表",
    assets_add: "添加素材",
};

export function isSiteTool(name: string): name is SiteToolName {
    return SITE_TOOL_NAMES.includes(name as SiteToolName);
}

export async function runSiteTool(name: SiteToolName, input: Record<string, unknown>, navigate: NavigateFunction): Promise<unknown> {
    if (name === "canvas_list_projects") return listCanvasProjects(input);
    if (name === "workbench_image_get_config") return imageConfig();
    if (name === "workbench_image_generate") return runImageWorkbench(input, navigate);
    if (name === "workbench_video_get_config") return videoConfig();
    if (name === "workbench_video_generate") return runVideoWorkbench(input, navigate);
    if (name === "prompts_search") return searchPrompts(input);
    if (name === "assets_list") return listAssets(input);
    if (name === "assets_add") return addAsset(input);
    throw new Error(`未知工具：${name}`);
}

function listCanvasProjects(input: Record<string, unknown>) {
    const { projects, hydrated } = useCanvasStore.getState();
    if (!hydrated) throw new Error("画布还在加载中，请稍后重试");
    const keyword = String(input.keyword || "").trim().toLowerCase();
    const filtered = keyword ? projects.filter((project) => project.title.toLowerCase().includes(keyword)) : projects;
    const page = pageSlice(input, filtered.length, 20);
    return {
        total: filtered.length,
        page: page.page,
        pageSize: page.pageSize,
        items: filtered.slice(page.start, page.end).map((project) => ({ id: project.id, title: project.title, createdAt: project.createdAt, updatedAt: project.updatedAt, nodeCount: project.nodes.length, connectionCount: project.connections.length })),
        hint: "用 site_navigate 跳转 /canvas/{id} 打开对应画布",
    };
}

function imageConfig() {
    const { config } = useConfigStore.getState();
    const model = config.imageModel || config.model;
    return {
        current: { model, modelName: modelOptionName(model), quality: config.quality || "auto", size: config.size || "1:1", count: config.count || "1" },
        models: config.imageModels.map((value) => ({ value, label: modelOptionLabel(config, value) })),
        qualityOptions: imageQualityOptions,
        sizeOptions: imageAspectOptions,
        countRange: { min: 1, max: 15 },
    };
}

function runImageWorkbench(input: Record<string, unknown>, navigate: NavigateFunction) {
    const store = useConfigStore.getState();
    const applied: Record<string, unknown> = {};
    if (typeof input.model === "string" && input.model.trim()) {
        const value = normalizeModelOptionValue(input.model, store.config.channels) || input.model;
        store.updateConfig("imageModel", value);
        applied.model = value;
    }
    for (const key of ["quality", "size"] as const) {
        if (typeof input[key] === "string" && input[key].trim()) {
            store.updateConfig(key, input[key]);
            applied[key] = input[key];
        }
    }
    if (input.count != null) {
        const count = String(Math.max(1, Math.min(15, Math.floor(Number(input.count)) || 1)));
        store.updateConfig("count", count);
        applied.count = count;
    }
    const prompt = typeof input.prompt === "string" ? input.prompt : undefined;
    const run = input.run !== false;
    navigate("/image");
    useWorkbenchAgentStore.getState().dispatchImage({ prompt, run });
    return { ok: true, navigated: "/image", prompt, run, applied, note: run ? "已跳转生图工作台并触发生成，结果请稍后在工作台查看" : "已跳转生图工作台并填入参数，未触发生成" };
}

function videoConfig() {
    const { config } = useConfigStore.getState();
    const model = config.videoModel || config.model;
    return {
        current: { model, modelName: modelOptionName(model), size: config.size || "16:9", seconds: config.videoSeconds || "6", resolution: config.vquality || "720", generateAudio: config.videoGenerateAudio !== "false", watermark: config.videoWatermark === "true" },
        models: config.videoModels.map((value) => ({ value, label: modelOptionLabel(config, value) })),
        sizeOptions: videoSizeOptions,
        secondsOptions: videoSecondOptions,
        resolutionOptions: videoResolutionOptions,
    };
}

function runVideoWorkbench(input: Record<string, unknown>, navigate: NavigateFunction) {
    const store = useConfigStore.getState();
    const applied: Record<string, unknown> = {};
    if (typeof input.model === "string" && input.model.trim()) {
        const value = normalizeModelOptionValue(input.model, store.config.channels) || input.model;
        store.updateConfig("videoModel", value);
        applied.model = value;
    }
    const fields = { size: "size", seconds: "videoSeconds", resolution: "vquality" } as const;
    Object.entries(fields).forEach(([inputKey, configKey]) => {
        const value = input[inputKey];
        if (typeof value === "string" && value.trim()) {
            store.updateConfig(configKey, value);
            applied[inputKey] = value;
        }
    });
    if (typeof input.generateAudio === "boolean") {
        store.updateConfig("videoGenerateAudio", String(input.generateAudio));
        applied.generateAudio = input.generateAudio;
    }
    if (typeof input.watermark === "boolean") {
        store.updateConfig("videoWatermark", String(input.watermark));
        applied.watermark = input.watermark;
    }
    const prompt = typeof input.prompt === "string" ? input.prompt : undefined;
    const run = input.run !== false;
    navigate("/video");
    useWorkbenchAgentStore.getState().dispatchVideo({ prompt, run });
    return { ok: true, navigated: "/video", prompt, run, applied, note: run ? "已跳转视频创作台并触发生成，结果请稍后在工作台查看" : "已跳转视频创作台并填入参数，未触发生成" };
}

async function searchPrompts(input: Record<string, unknown>) {
    const page = Math.max(1, Math.floor(Number(input.page)) || 1);
    const pageSize = Math.max(1, Math.min(50, Math.floor(Number(input.pageSize)) || 20));
    const tags = Array.isArray(input.tags) ? input.tags.filter((tag): tag is string => typeof tag === "string") : [];
    const result = await fetchPrompts({ keyword: String(input.keyword || ""), category: String(input.category || "全部"), tag: tags, page, pageSize });
    return { total: result.total, page, pageSize, categories: result.categories, tags: result.tags.slice(0, 60), items: result.items.map((item) => ({ id: item.id, title: item.title, prompt: item.prompt, category: item.category, tags: item.tags, coverUrl: item.coverUrl, githubUrl: item.githubUrl })) };
}

function listAssets(input: Record<string, unknown>) {
    const { assets, hydrated } = useAssetStore.getState();
    if (!hydrated) throw new Error("素材还在加载中，请稍后重试");
    const kind = input.kind === "text" || input.kind === "image" || input.kind === "video" ? input.kind : "all";
    const keyword = String(input.keyword || "").trim().toLowerCase();
    const filtered = assets.filter((asset) => (kind === "all" || asset.kind === kind) && (!keyword || [asset.title, asset.note, asset.source, ...asset.tags].filter(Boolean).join(" ").toLowerCase().includes(keyword)));
    const page = pageSlice(input, filtered.length, 20);
    return { total: filtered.length, page: page.page, pageSize: page.pageSize, items: filtered.slice(page.start, page.end).map((asset) => ({ id: asset.id, kind: asset.kind, title: asset.title, tags: asset.tags, source: asset.source, note: asset.note, createdAt: asset.createdAt, updatedAt: asset.updatedAt, coverUrl: asset.coverUrl || undefined, content: asset.kind === "text" ? asset.data.content : undefined })) };
}

async function addAsset(input: Record<string, unknown>) {
    const title = String(input.title || "").trim();
    if (!title) throw new Error("请提供素材标题 title");
    const tags = Array.isArray(input.tags) ? input.tags.filter((tag): tag is string => typeof tag === "string") : [];
    const source = typeof input.source === "string" ? input.source : "Agent";
    const note = typeof input.note === "string" ? input.note : undefined;
    const store = useAssetStore.getState();
    if (input.kind === "text") {
        const content = String(input.content || "").trim();
        if (!content) throw new Error("kind=text 时需要 content");
        return { ok: true, id: store.addAsset({ kind: "text", title, coverUrl: "", tags, source, note, data: { content } }), kind: "text" };
    }
    if (input.kind === "image") {
        const imageUrl = String(input.imageUrl || "").trim();
        if (!imageUrl) throw new Error("kind=image 时需要 imageUrl");
        const image = await uploadImage(imageUrl).catch(() => { throw new Error("无法读取图片，请使用 dataURL 或允许跨域访问的地址"); });
        return { ok: true, id: store.addAsset({ kind: "image", title, coverUrl: image.url, tags, source, note, data: { dataUrl: image.url, storageKey: image.storageKey, width: image.width, height: image.height, bytes: image.bytes, mimeType: image.mimeType } }), kind: "image" };
    }
    throw new Error("assets_add 仅支持 text 或 image");
}

function pageSlice(input: Record<string, unknown>, total: number, defaultSize: number) {
    const pageSize = Math.max(1, Math.min(100, Math.floor(Number(input.pageSize)) || defaultSize));
    const page = Math.min(Math.max(1, Math.ceil(total / pageSize)), Math.max(1, Math.floor(Number(input.page)) || 1));
    const start = (page - 1) * pageSize;
    return { page, pageSize, start, end: start + pageSize };
}

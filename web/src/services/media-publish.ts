import localforage from "localforage";

import { getMediaBlob } from "@/services/file-storage";
import { imageToDataUrl } from "@/services/image-storage";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceVideo } from "@/types/media";

type PublishedMedia = { url: string; expiresAt: number };
type TemporaryUploadResponse = { success?: boolean; error?: string; files?: Array<{ id?: string; name?: string; url?: string; expiryTime?: number }> };

const cache = localforage.createInstance({ name: "infinite-canvas", storeName: "published_media" });
const TEMP_UPLOAD_URL = "https://tempfile.org/api/upload/local";
const TEMP_MEDIA_ORIGIN = "https://tempfile.org";
const DEFAULT_CACHE_MS = 45 * 60 * 1000;

export async function publishReferenceVideo(video: ReferenceVideo, signal?: AbortSignal) {
    if (/^https:\/\//i.test(video.url || "")) return video.url;
    const stored = video.storageKey ? await getMediaBlob(video.storageKey) : null;
    const blob = stored || (video.url?.startsWith("blob:") || video.url?.startsWith("data:") ? await (await fetch(video.url, { signal })).blob() : null);
    if (!blob) throw new Error(`参考视频“${video.name}”本地文件无法读取，请重新上传`);
    return publishTemporaryMedia(blob, video.name || "reference.mp4", video.storageKey, "video/", signal);
}

export async function publishReferenceImage(image: ReferenceImage, signal?: AbortSignal) {
    const directUrl = image.url || image.dataUrl;
    if (/^https:\/\//i.test(directUrl || "")) return directUrl;
    const dataUrl = await imageToDataUrl(image);
    if (!dataUrl) throw new Error(`参考图片“${image.name}”本地文件无法读取，请重新上传`);
    const blob = await (await fetch(dataUrl, { signal })).blob();
    return publishTemporaryMedia(blob, image.name || "reference.png", image.storageKey, "image/", signal);
}

async function publishTemporaryMedia(blob: Blob, name: string, storageKey: string | undefined, expectedType: "video/" | "image/", signal?: AbortSignal) {
    const cacheKey = storageKey ? `v3:${TEMP_UPLOAD_URL}:${storageKey}` : "";
    const cached = cacheKey ? await cache.getItem<PublishedMedia>(cacheKey) : null;
    if (cached?.url && cached.expiresAt > Date.now() + 10 * 60 * 1000) return cached.url;

    if (blob.size > 100 * 1024 * 1024) throw new Error(`参考素材“${name}”超过临时中转的 100MB 上限，请压缩后重试`);

    const body = new FormData();
    body.append("files", blob, name);
    body.append("expiryHours", "1");
    const response = await fetch(TEMP_UPLOAD_URL, {
        method: "POST",
        body,
        signal,
    });
    const payload = (await response.json().catch(() => null)) as TemporaryUploadResponse | null;
    if (!response.ok) throw new Error(`参考视频临时发布失败（HTTP ${response.status}）：${uploadError(payload) || response.statusText}`);

    const published = normalizeTemporaryUpload(payload, name);
    if (!published) throw new Error("临时中转没有返回可公开访问的 HTTPS 素材地址");
    try {
        await assertPublishedMediaUrl(published.url, expectedType, signal);
    } catch (error) {
        await deleteTemporaryReferenceMedia([published.url]);
        throw error;
    }
    if (cacheKey) await cache.setItem(cacheKey, published);
    return published.url;
}

export async function deleteTemporaryReferenceMedia(urls: string[]) {
    try {
        const temporaryUrls = new Set(urls.filter(isTemporaryReferenceMediaUrl));
        const ids = Array.from(new Set(Array.from(temporaryUrls).map(temporaryMediaId).filter(Boolean)));
        await Promise.allSettled(ids.map((id) => fetch(`${TEMP_MEDIA_ORIGIN}/api/file/${id}`, { method: "DELETE", signal: AbortSignal.timeout(5000) })));
        const expiredCacheKeys: string[] = [];
        await cache.iterate<PublishedMedia, void>((item, key) => {
            if (temporaryUrls.has(item.url)) expiredCacheKeys.push(key);
        });
        await Promise.allSettled(expiredCacheKeys.map((key) => cache.removeItem(key)));
    } catch {
        // 临时文件仍会由服务端的一小时生命周期兜底删除，清理失败不应覆盖视频任务结果。
    }
}

export function isTemporaryReferenceMediaUrl(value: string) {
    return Boolean(temporaryMediaId(value));
}

function normalizeTemporaryUpload(payload: TemporaryUploadResponse | null, fallbackName: string): PublishedMedia | null {
    const file = payload?.success ? payload.files?.[0] : null;
    if (!file?.id) return null;
    const fileName = encodeURIComponent(file.name?.trim() || fallbackName);
    return {
        url: `${TEMP_MEDIA_ORIGIN}/${encodeURIComponent(file.id)}/download#${fileName}`,
        expiresAt: typeof file.expiryTime === "number" ? file.expiryTime : Date.now() + DEFAULT_CACHE_MS,
    };
}

async function assertPublishedMediaUrl(url: string, expectedType: "video/" | "image/", signal?: AbortSignal) {
    const response = await fetch(url, { method: "HEAD", signal });
    if (!response.ok) throw new Error(`参考素材临时地址不可读取（HTTP ${response.status}），未创建付费视频任务`);
    const contentType = response.headers.get("content-type")?.toLowerCase() || "";
    if (!contentType.startsWith(expectedType)) throw new Error(`参考素材临时地址返回了错误类型 ${contentType || "unknown"}，未创建付费视频任务`);
}

function temporaryMediaId(value: string) {
    const match = /^https:\/\/tempfile\.org\/([^/]+)\/download(?:[?#]|$)/i.exec(value);
    try {
        return match?.[1] ? decodeURIComponent(match[1]) : "";
    } catch {
        return "";
    }
}

function uploadError(payload: TemporaryUploadResponse | null) {
    if (typeof payload?.error === "string") return payload.error;
    return payload ? JSON.stringify(payload) : "";
}

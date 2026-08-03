import localforage from "localforage";

import { getMediaBlob } from "@/services/file-storage";
import { imageToDataUrl } from "@/services/image-storage";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

type PublishedMedia = { url: string; expiresAt: number };
type TemporaryUploadResponse = { success?: boolean; error?: string; files?: Array<{ id?: string; name?: string; url?: string; expiryTime?: number }> };

const cache = localforage.createInstance({ name: "infinite-canvas", storeName: "published_media" });
const TEMP_UPLOAD_URL = "https://tempfile.org/api/upload/local";
const TEMP_MEDIA_ORIGIN = "https://tempfile.org";
const LOCAL_MEDIA_SERVICE_URL = "http://127.0.0.1:17372";
const DEFAULT_CACHE_MS = 45 * 60 * 1000;

export async function publishReferenceVideo(video: ReferenceVideo, signal?: AbortSignal, normalize = false) {
    if (/^https:\/\//i.test(video.url || "")) return video.url;
    const sourceName = video.name || "reference";
    const publishName = normalize ? `${sourceName.replace(/\.[a-z0-9]+$/i, "")}.mp4` : sourceName;
    const uploadName = normalizedUploadName(publishName, normalize ? "video/mp4" : "", "video/");
    const cached = video.storageKey ? await cache.getItem<PublishedMedia>(publishedMediaCacheKey(video.storageKey, uploadName)) : null;
    if (cached?.url && cached.expiresAt > Date.now() + 10 * 60 * 1000) return cached.url;
    const stored = video.storageKey ? await getMediaBlob(video.storageKey) : null;
    const blob = stored || (video.url?.startsWith("blob:") || video.url?.startsWith("data:") ? await (await fetch(video.url, { signal })).blob() : null);
    if (!blob) throw new Error(`参考视频“${video.name}”本地文件无法读取，请重新上传；尚未创建付费视频任务`);
    const publishedBlob = normalize ? await normalizeReferenceVideo(blob, signal) : blob;
    return publishTemporaryMedia(publishedBlob, publishName, video.storageKey, "video/", signal);
}

export async function publishReferenceImage(image: ReferenceImage, signal?: AbortSignal) {
    const directUrl = image.url || image.dataUrl;
    if (/^https:\/\//i.test(directUrl || "")) return directUrl;
    const dataUrl = await imageToDataUrl(image);
    if (!dataUrl) throw new Error(`参考图片“${image.name}”本地文件无法读取，请重新上传；尚未创建付费视频任务`);
    let blob: Blob;
    try {
        blob = await (await fetch(dataUrl, { signal })).blob();
    } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        throw new Error(`参考图片“${image.name}”本地文件读取失败，尚未创建付费视频任务`);
    }
    return publishTemporaryMedia(blob, image.name || "reference.png", image.storageKey, "image/", signal);
}

export async function publishReferenceAudio(audio: ReferenceAudio, signal?: AbortSignal) {
    if (/^https:\/\//i.test(audio.url || "")) return audio.url;
    const stored = audio.storageKey ? await getMediaBlob(audio.storageKey) : null;
    const blob = stored || (audio.url?.startsWith("blob:") || audio.url?.startsWith("data:") ? await (await fetch(audio.url, { signal })).blob() : null);
    if (!blob) throw new Error(`参考音频“${audio.name}”本地文件无法读取，请重新上传；尚未创建付费视频任务`);
    return publishTemporaryMedia(blob, audio.name || "reference.mp3", audio.storageKey, "audio/", signal);
}

async function publishTemporaryMedia(blob: Blob, name: string, storageKey: string | undefined, expectedType: "video/" | "image/" | "audio/", signal?: AbortSignal) {
    const mediaLabel = expectedType === "video/" ? "参考视频" : expectedType === "audio/" ? "参考音频" : "参考图片";
    const uploadName = normalizedUploadName(name, blob.type, expectedType);
    const cacheKey = storageKey ? publishedMediaCacheKey(storageKey, uploadName) : "";
    const cached = cacheKey ? await cache.getItem<PublishedMedia>(cacheKey) : null;
    if (cached?.url && cached.expiresAt > Date.now() + 10 * 60 * 1000) return cached.url;

    if (blob.size > 100 * 1024 * 1024) throw new Error(`${mediaLabel}“${name}”超过临时中转的 100MB 上限，请压缩后重试；尚未创建付费视频任务`);

    const body = new FormData();
    body.append("files", blob, uploadName);
    body.append("expiryHours", "1");
    let response: Response;
    try {
        response = await fetch(TEMP_UPLOAD_URL, {
            method: "POST",
            body,
            signal,
        });
    } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        throw new Error(`${mediaLabel}临时发布请求失败，尚未创建付费视频任务：${error instanceof Error ? error.message : "网络请求中断"}`);
    }
    const payload = (await response.json().catch(() => null)) as TemporaryUploadResponse | null;
    if (!response.ok) throw new Error(`${mediaLabel}临时发布失败（HTTP ${response.status}），尚未创建付费视频任务：${uploadError(payload) || response.statusText}`);

    const published = normalizeTemporaryUpload(payload, uploadName);
    if (!published) throw new Error(`${mediaLabel}临时中转没有返回可公开访问的 HTTPS 地址，尚未创建付费视频任务`);
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
    const fileName = file.name?.trim() || fallbackName;
    return {
        url: `${TEMP_MEDIA_ORIGIN}/${encodeURIComponent(file.id)}/download?filename=${encodeURIComponent(fileName)}`,
        expiresAt: typeof file.expiryTime === "number" ? file.expiryTime : Date.now() + DEFAULT_CACHE_MS,
    };
}

function publishedMediaCacheKey(storageKey: string, uploadName: string) {
    return `v5:${TEMP_UPLOAD_URL}:${storageKey}:${uploadName}`;
}

async function normalizeReferenceVideo(blob: Blob, signal?: AbortSignal) {
    let response: Response;
    try {
        response = await fetch(`${LOCAL_MEDIA_SERVICE_URL}/normalize-video`, {
            method: "POST",
            headers: { "Content-Type": blob.type || "video/mp4", "X-Filename": "reference-video.mp4" },
            body: blob,
            signal,
        });
    } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        throw new Error("本地视频标准化服务未就绪，请重新运行 start-web.bat 后再试；尚未创建付费视频任务");
    }
    if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error || `本地参考视频标准化失败（HTTP ${response.status}），尚未创建付费视频任务`);
    }
    const normalized = await response.blob();
    if (!normalized.size) throw new Error("本地参考视频标准化结果为空，尚未创建付费视频任务");
    return new Blob([normalized], { type: "video/mp4" });
}

function normalizedUploadName(name: string, mimeType: string, expectedType: "video/" | "image/" | "audio/") {
    const extension = expectedType === "video/"
        ? mimeType === "video/webm" ? "webm" : mimeType === "video/quicktime" ? "mov" : "mp4"
        : expectedType === "audio/"
          ? mimeType === "audio/wav" || mimeType === "audio/x-wav" ? "wav" : mimeType === "audio/mp4" ? "m4a" : "mp3"
        : mimeType === "image/jpeg" ? "jpg" : mimeType === "image/webp" ? "webp" : "png";
    const baseName = name.trim().replace(/\.[a-z0-9]+$/i, "") || (expectedType === "video/" ? "reference" : expectedType === "audio/" ? "audio" : "image");
    return `${baseName}.${extension}`;
}

async function assertPublishedMediaUrl(url: string, expectedType: "video/" | "image/" | "audio/", signal?: AbortSignal) {
    const mediaLabel = expectedType === "video/" ? "参考视频" : expectedType === "audio/" ? "参考音频" : "参考图片";
    let response: Response;
    try {
        response = await fetch(url, { method: "HEAD", signal });
    } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        throw new Error(`${mediaLabel}临时地址校验失败，尚未创建付费视频任务：${error instanceof Error ? error.message : "网络请求中断"}`);
    }
    if (!response.ok) throw new Error(`${mediaLabel}临时地址不可读取（HTTP ${response.status}），尚未创建付费视频任务`);
    const contentType = response.headers.get("content-type")?.toLowerCase() || "";
    if (!contentType.startsWith(expectedType)) throw new Error(`${mediaLabel}临时地址返回了错误类型 ${contentType || "unknown"}，尚未创建付费视频任务`);
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

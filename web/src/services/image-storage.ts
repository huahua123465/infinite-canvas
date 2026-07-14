import axios from "axios";
import localforage from "localforage";

import { nanoid } from "nanoid";
import { readImageMeta } from "@/lib/image-utils";
import { useCanvasAgentStore } from "@/stores/canvas/use-canvas-agent-store";

export type UploadedImage = {
    url: string;
    storageKey: string;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
};

const store = localforage.createInstance({ name: "infinite-canvas", storeName: "image_files" });
const objectUrls = new Map<string, string>();

export async function uploadImage(input: string | Blob): Promise<UploadedImage> {
    const blob = typeof input === "string" ? await downloadImage(input) : input;
    const storageKey = `image:${nanoid()}`;
    await store.setItem(storageKey, blob);
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    const meta = await readImageMeta(url);
    return { url, storageKey, width: meta.width, height: meta.height, bytes: blob.size, mimeType: blob.type || meta.mimeType };
}

async function downloadImage(url: string) {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`图片下载失败：${response.status}`);
        const blob = await response.blob();
        assertImageBlob(blob);
        return blob;
    } catch (error) {
        if (!/^https?:\/\//i.test(url)) throw error;
        const blob = await downloadImageViaAgent(url).catch(() => null);
        if (blob) return blob;
        throw new Error(`图片已生成，但浏览器和本地 Canvas Agent 都无法下载结果。结果地址：${url}`);
    }
}

async function downloadImageViaAgent(url: string) {
    const agent = useCanvasAgentStore.getState();
    const endpoint = agent.url.trim().replace(/\/$/, "");
    const token = agent.token.trim();
    if (!endpoint || !token) return null;
    const response = await axios.post<Blob>(`${endpoint}/api/proxy/media/download?token=${encodeURIComponent(token)}`, { url }, { headers: { "Content-Type": "application/json" }, responseType: "blob" });
    assertImageBlob(response.data);
    return response.data;
}

function assertImageBlob(blob: Blob) {
    if (!blob.size) throw new Error("图片结果为空");
    if (blob.type && !blob.type.startsWith("image/") && blob.type !== "application/octet-stream") throw new Error("远程地址没有返回图片");
}

export async function resolveImageUrl(storageKey?: string, fallback = "") {
    if (!storageKey) return fallback;
    const cached = objectUrls.get(storageKey);
    if (cached) return cached;
    const blob = await store.getItem<Blob>(storageKey);
    if (!blob) return fallback;
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function getImageBlob(storageKey: string) {
    return store.getItem<Blob>(storageKey);
}

export async function setImageBlob(storageKey: string, blob: Blob) {
    await store.setItem(storageKey, blob);
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function imageToDataUrl(image: { url?: string; dataUrl?: string; storageKey?: string }) {
    const url = image.dataUrl || (await resolveImageUrl(image.storageKey, image.url || ""));
    if (!url || url.startsWith("data:")) return url;
    return blobToDataUrl(await (await fetch(url)).blob());
}

export async function deleteStoredImages(keys: Iterable<string>) {
    await Promise.all(
        Array.from(new Set(keys)).map(async (key) => {
            const url = objectUrls.get(key);
            if (url) URL.revokeObjectURL(url);
            objectUrls.delete(key);
            await store.removeItem(key);
        }),
    );
}

export async function cleanupUnusedImages(usedData: unknown) {
    const usedKeys = collectImageStorageKeys(usedData);
    const unused: string[] = [];
    await store.iterate((_value, key) => {
        if (!usedKeys.has(key)) unused.push(key);
    });
    await deleteStoredImages(unused);
}

export function collectImageStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return keys;
    if ("storageKey" in value && typeof value.storageKey === "string" && value.storageKey.startsWith("image:")) keys.add(value.storageKey);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectImageStorageKeys(child, keys)) : collectImageStorageKeys(item, keys)));
    return keys;
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("读取图片失败"));
        reader.readAsDataURL(blob);
    });
}

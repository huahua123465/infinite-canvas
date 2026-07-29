import localforage from "localforage";

export type ApimartAvatarAsset = { taskId: string; assetUrl: string; updatedAt: number };

const store = localforage.createInstance({ name: "infinite-canvas", storeName: "apimart_avatar_assets" });

export function apimartAvatarCacheKey(channelId: string, sourceKey: string) {
    return `${channelId}:${sourceKey}`;
}

export function getApimartAvatarAsset(key: string) {
    return store.getItem<ApimartAvatarAsset>(key);
}

export function setApimartAvatarAsset(key: string, asset: ApimartAvatarAsset) {
    return store.setItem(key, asset);
}

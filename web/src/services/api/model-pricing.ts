import axios from "axios";

export type ModelPricingItem = {
    model_name?: string;
    model_price?: number | string;
    billing_mode?: string;
    request_unit?: string;
    description?: string;
    tags?: string | string[];
    quota_type?: number;
};

export type ModelPricingIndex = Record<string, ModelPricingItem>;

type PricingResponse = {
    data?: ModelPricingItem[];
};

const pricingRequests = new Map<string, Promise<ModelPricingIndex>>();
const pricingIndexes = new Map<string, ModelPricingIndex>();

const pricingAliases: Record<string, string[]> = {
    sora2: ["openai-sora2"],
    "sora-2": ["openai-sora2"],
};

export function cangyuanPricingKey(baseUrl: string) {
    return cangyuanPricingOrigin(baseUrl).toLowerCase();
}

export async function fetchCangyuanModelPricing(baseUrl: string) {
    return fetchModelPricing(baseUrl).catch(() => ({} as ModelPricingIndex));
}

export function fetchModelPricing(baseUrl: string) {
    const key = cangyuanPricingKey(baseUrl);
    if (!key) return Promise.resolve({} as ModelPricingIndex);
    const cached = pricingRequests.get(key);
    if (cached) return cached;
    const request = requestPricing(key).then((response) => {
        const index = indexPricingItems(response.data.data || []);
        pricingIndexes.set(key, index);
        return index;
    });
    pricingRequests.set(key, request);
    void request.catch(() => {
        if (pricingRequests.get(key) === request) pricingRequests.delete(key);
    });
    return request;
}

async function requestPricing(baseUrl: string) {
    if (!isMeaiccPricingOrigin(baseUrl)) return axios.get<PricingResponse>(`${baseUrl}/api/pricing`);
    const agentUrl = meaiccAgentPricingUrl();
    if (agentUrl) {
        try {
            return await axios.get<PricingResponse>(agentUrl);
        } catch (error) {
            if (!axios.isAxiosError(error) || (error.response?.status !== 404 && error.response?.status !== 405)) throw error;
        }
    }
    return axios.get<PricingResponse>("/api/proxy/meaicc/pricing");
}

function isMeaiccPricingOrigin(baseUrl: string) {
    try {
        return new URL(baseUrl).hostname.toLowerCase() === "api.meaicc.com";
    } catch {
        return false;
    }
}

function meaiccAgentPricingUrl() {
    if (typeof localStorage === "undefined") return "";
    const endpoint = (localStorage.getItem("canvas-agent-url") || "").trim().replace(/\/+$/, "");
    const token = (localStorage.getItem("canvas-agent-token") || "").trim();
    return endpoint && token ? `${endpoint}/api/proxy/meaicc/pricing?token=${encodeURIComponent(token)}` : "";
}

export function invalidateCangyuanModelPricing(baseUrl: string) {
    const key = cangyuanPricingKey(baseUrl);
    pricingRequests.delete(key);
    pricingIndexes.delete(key);
}

export function cachedModelPricing(baseUrl: string) {
    return pricingIndexes.get(cangyuanPricingKey(baseUrl));
}

export function findModelPricing(index: ModelPricingIndex | undefined, model: string) {
    if (!index) return undefined;
    const name = normalizePricingName(model);
    return index[name] || pricingAliases[name]?.map((alias) => index[alias]).find(Boolean);
}

export function formatModelPricing(item: ModelPricingItem | undefined, estimateSeconds?: string | number, currency = "¥") {
    const price = Number(item?.model_price);
    if (!Number.isFinite(price) || price <= 0) return null;
    const perSecond = isPerSecondPricing(item);
    const unit = perSecond ? "秒" : priceUnit(item);
    const unitText = `${currency}${formatMoney(price)}/${unit}`;
    const seconds = Number(estimateSeconds);
    if (perSecond && Number.isFinite(seconds) && seconds > 0) {
        return { label: `约${currency}${formatMoney(price * seconds)}`, unitLabel: `${unitText}`, title: `${unitText}，按 ${seconds}s 估算` };
    }
    return { label: unitText, unitLabel: undefined, title: unitText };
}

export function modelPricingReferenceLimits(item: ModelPricingItem | undefined) {
    const match = /(\d+)\s*图\s*\/\s*(\d+)\s*视频\s*\/\s*(\d+)\s*音频/.exec(item?.description || "");
    return match ? { images: Number(match[1]), videos: Number(match[2]), audios: Number(match[3]) } : null;
}

export function documentedModelPricingNames(index: ModelPricingIndex) {
    return Object.values(index)
        .filter((item) => Number(item.model_price) > 0 && Boolean(modelPricingReferenceLimits(item)))
        .map((item) => item.model_name?.trim() || "")
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
}

function indexPricingItems(items: ModelPricingItem[]) {
    return items.reduce<ModelPricingIndex>((index, item) => {
        const key = normalizePricingName(item.model_name || "");
        if (key) index[key] = item;
        return index;
    }, {});
}

function normalizePricingName(value: string) {
    return value.trim().toLowerCase();
}

function isPerSecondPricing(item?: ModelPricingItem) {
    return item?.billing_mode === "per_second" || item?.request_unit === "second";
}

function priceUnit(item?: ModelPricingItem) {
    const tags = Array.isArray(item?.tags) ? item?.tags.join(",") : item?.tags || "";
    const lowerTags = tags.toLowerCase();
    if (lowerTags.includes("video")) return "条";
    if (lowerTags.includes("image")) return "张";
    if (item?.request_unit === "generation") return "次";
    return "次";
}

function formatMoney(value: number) {
    return value.toFixed(value < 1 ? 4 : 2).replace(/\.?0+$/, "");
}

function cangyuanPricingOrigin(baseUrl: string) {
    const value = baseUrl.trim().replace(/\/+$/, "");
    if (!value) return "";
    try {
        const url = new URL(value);
        const normalizedPath = url.pathname.replace(/\/+$/, "");
        const path = normalizedPath.replace(/\/v1$/i, "");
        url.pathname = path || "/";
        url.search = "";
        url.hash = "";
        return url.toString().replace(/\/+$/, "");
    } catch {
        return value.replace(/\/v1$/i, "");
    }
}

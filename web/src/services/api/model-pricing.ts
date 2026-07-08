import axios from "axios";

export type ModelPricingItem = {
    model_name?: string;
    model_price?: number | string;
    billing_mode?: string;
    request_unit?: string;
    description?: string;
    tags?: string | string[];
};

export type ModelPricingIndex = Record<string, ModelPricingItem>;

type PricingResponse = {
    data?: ModelPricingItem[];
};

const pricingRequests = new Map<string, Promise<ModelPricingIndex>>();

const pricingAliases: Record<string, string[]> = {
    sora2: ["openai-sora2"],
    "sora-2": ["openai-sora2"],
};

export function cangyuanPricingKey(baseUrl: string) {
    return cangyuanPricingOrigin(baseUrl).toLowerCase();
}

export async function fetchCangyuanModelPricing(baseUrl: string) {
    const key = cangyuanPricingKey(baseUrl);
    if (!key) return {};
    const cached = pricingRequests.get(key);
    if (cached) return cached;
    const request: Promise<ModelPricingIndex> = axios
        .get<PricingResponse>(`${key}/api/pricing`)
        .then((response) => indexPricingItems(response.data.data || []))
        .catch(() => ({} as ModelPricingIndex));
    pricingRequests.set(key, request);
    return request;
}

export function findModelPricing(index: ModelPricingIndex | undefined, model: string) {
    if (!index) return undefined;
    const name = normalizePricingName(model);
    return index[name] || pricingAliases[name]?.map((alias) => index[alias]).find(Boolean);
}

export function formatModelPricing(item: ModelPricingItem | undefined, estimateSeconds?: string | number) {
    const price = Number(item?.model_price);
    if (!Number.isFinite(price) || price <= 0) return null;
    const perSecond = isPerSecondPricing(item);
    const unit = perSecond ? "秒" : priceUnit(item);
    const unitText = `¥${formatMoney(price)}/${unit}`;
    const seconds = Number(estimateSeconds);
    if (perSecond && Number.isFinite(seconds) && seconds > 0) {
        return { label: `约¥${formatMoney(price * seconds)}`, title: `${unitText}，按 ${seconds}s 估算` };
    }
    return { label: unitText, title: unitText };
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

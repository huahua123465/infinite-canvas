export type ApimartModelInfo = {
    capability: "image" | "video";
    price: string;
    priceTitle: string;
    references?: { images: number; videos: number; audios: number };
};

type ApimartSeedancePrice = { regular: number; uploadedVideo: number };
const APIMART_VIDEO_CREDITS_PER_SECOND: Record<string, number> = {
    "kling-v3-motion-control": 1.0288,
};

const APIMART_SEEDANCE_PRICES: Record<string, Partial<Record<"480p" | "720p" | "1080p" | "4k", ApimartSeedancePrice>>> = {
    "doubao-seedance-2.0": {
        "480p": { regular: 0.66, uploadedVideo: 0.4 },
        "720p": { regular: 1.42, uploadedVideo: 0.8584 },
        "1080p": { regular: 3.544, uploadedVideo: 2.1568 },
        "4k": { regular: 7.22, uploadedVideo: 4.4432 },
    },
    "doubao-seedance-2.0-fast": {
        "480p": { regular: 0.5312, uploadedVideo: 0.316 },
        "720p": { regular: 1.1416, uploadedVideo: 0.684 },
    },
    "doubao-seedance-2.0-mini": {
        "480p": { regular: 0.2632, uploadedVideo: 0.1608 },
        "720p": { regular: 0.5712, uploadedVideo: 0.3456 },
    },
};

export const APIMART_MODEL_CATALOG: Record<string, ApimartModelInfo> = {
    "gpt-image-2": { capability: "image", price: "实时价", priceTitle: "APIMart 按分辨率与质量计费，请以账户价格页为准" },
    "gemini-3.1-flash-image-preview": { capability: "image", price: "实时价", priceTitle: "APIMart 按输出规格计费，请以账户价格页为准", references: { images: 14, videos: 0, audios: 0 } },
    "seedream-5.0-pro": { capability: "image", price: "实时价", priceTitle: "APIMart 按输出规格计费，请以账户价格页为准", references: { images: 10, videos: 0, audios: 0 } },
    "wan2.7-image": { capability: "image", price: "¥0.20/张", priceTitle: "APIMart 文档价格：成功生成 ¥0.20/张", references: { images: 9, videos: 0, audios: 0 } },
    "wan2.7-image-pro": { capability: "image", price: "¥0.50/张", priceTitle: "APIMart 文档价格：成功生成 ¥0.50/张", references: { images: 9, videos: 0, audios: 0 } },
    "gemini-3-pro-image-preview": { capability: "image", price: "实时价", priceTitle: "APIMart 按输出规格计费，请以账户价格页为准" },
    "gemini-3.1-flash-image-lite": { capability: "image", price: "实时价", priceTitle: "APIMart 按输出规格计费，请以账户价格页为准", references: { images: 14, videos: 0, audios: 0 } },
    "gpt-image-1": { capability: "image", price: "实时价", priceTitle: "APIMart 按质量与输出规格计费，请以账户价格页为准", references: { images: 15, videos: 0, audios: 0 } },
    "gpt-image-1.5": { capability: "image", price: "实时价", priceTitle: "APIMart 按质量与输出规格计费，请以账户价格页为准", references: { images: 15, videos: 0, audios: 0 } },
    "gpt-image-2-official": { capability: "image", price: "实时价", priceTitle: "APIMart 官方线路按 Token、分辨率与质量计费，请以账户价格页为准" },
    "grok-imagine-1.5-image": { capability: "image", price: "实时价", priceTitle: "APIMart 按任务计费，请以账户价格页为准", references: { images: 1, videos: 0, audios: 0 } },
    "imagen-4.0": { capability: "image", price: "实时价", priceTitle: "APIMart 按任务计费，请以账户价格页为准", references: { images: 0, videos: 0, audios: 0 } },
    "qwen-image-2.0": { capability: "image", price: "实时价", priceTitle: "APIMart 按任务与输出张数计费，请以账户价格页为准" },
    "z-image-turbo": { capability: "image", price: "实时价", priceTitle: "APIMart 按任务计费，请以账户价格页为准" },
    "seedream-4.0": { capability: "image", price: "实时价", priceTitle: "APIMart 按任务计费，请以账户价格页为准" },
    "seedream-4.5": { capability: "image", price: "实时价", priceTitle: "APIMart 按任务计费，请以账户价格页为准" },
    "seedream-5.0-lite": { capability: "image", price: "实时价", priceTitle: "APIMart 按任务与输出规格计费，请以账户价格页为准" },
    "doubao-seedance-2.0": { capability: "video", price: "实时价", priceTitle: "APIMart 按分辨率、输入模式和秒数计费，请以账户价格页为准", references: { images: 9, videos: 3, audios: 3 } },
    "doubao-seedance-2.0-fast": { capability: "video", price: "实时价", priceTitle: "APIMart 按分辨率、输入模式和秒数计费，请以账户价格页为准", references: { images: 9, videos: 3, audios: 3 } },
    "doubao-seedance-2.0-mini": { capability: "video", price: "实时价", priceTitle: "APIMart 价格页已列出该型号，但当前单模型 API 文档未公布参考素材数量上限" },
    "kling-v3-motion-control": { capability: "video", price: "1.0288 Credits/秒", priceTitle: "必须且只能提交 1 张人物图与 1 条动作视频；按参考视频实际时长计费", references: { images: 1, videos: 1, audios: 0 } },
    "gemini-omni-flash-preview": { capability: "video", price: "$0.088/秒", priceTitle: "APIMart 模型广场公示价格；实际费用以账户结算为准" },
    "kling-3.0-turbo": { capability: "video", price: "$0.1144/秒", priceTitle: "APIMart 模型广场公示价格；实际费用以账户结算为准", references: { images: 1, videos: 0, audios: 0 } },
    "pixverse-v6": { capability: "video", price: "$0.024/秒", priceTitle: "APIMart 模型广场公示价格；实际费用以账户结算为准" },
    "Omni-Flash-Ext": { capability: "video", price: "$0.35/次", priceTitle: "APIMart 模型广场公示价格；实际费用以账户结算为准", references: { images: 3, videos: 0, audios: 0 } },
    "skyreels-v4-fast": { capability: "video", price: "$0.064/秒", priceTitle: "APIMart 模型广场公示价格；实际费用以账户结算为准" },
    "wan2.7": { capability: "video", price: "$0.0664/秒", priceTitle: "APIMart 模型广场公示价格；实际费用以账户结算为准", references: { images: 1, videos: 1, audios: 1 } },
    "viduq3": { capability: "video", price: "$0.08/秒", priceTitle: "APIMart 模型广场公示价格；实际费用以账户结算为准" },
    "wan2.5-preview": { capability: "video", price: "$0.0336/秒", priceTitle: "APIMart 模型广场公示价格；实际费用以账户结算为准", references: { images: 1, videos: 0, audios: 0 } },
    "kling-v3-omni": { capability: "video", price: "$0.0672/秒", priceTitle: "APIMart 模型广场公示价格；实际费用以账户结算为准" },
    "grok-imagine-1.5-video-ext": { capability: "video", price: "$0.0068/秒", priceTitle: "APIMart 模型广场公示价格；实际费用以账户结算为准", references: { images: 1, videos: 0, audios: 0 } },
    "kling-video-o1": { capability: "video", price: "$0.0672/秒", priceTitle: "APIMart 模型广场公示价格；实际费用以账户结算为准" },
    "MiniMax-Hailuo-2.3": { capability: "video", price: "$0.0488/秒", priceTitle: "APIMart 模型广场公示价格；实际费用以账户结算为准", references: { images: 1, videos: 0, audios: 0 } },
    "kling-v2-6": { capability: "video", price: "$0.0368/秒", priceTitle: "APIMart 模型广场公示价格；实际费用以账户结算为准", references: { images: 2, videos: 0, audios: 0 } },
    "doubao-seedance-1-5-pro": { capability: "video", price: "$0.0204/秒", priceTitle: "APIMart 模型广场公示价格；实际费用以账户结算为准", references: { images: 2, videos: 0, audios: 0 } },
    "wan2.6": { capability: "video", price: "$0.05/秒", priceTitle: "APIMart 模型广场公示价格；实际费用以账户结算为准", references: { images: 1, videos: 0, audios: 0 } },
    "MiniMax-Hailuo-02": { capability: "video", price: "$0.08/秒", priceTitle: "APIMart 模型广场公示价格；实际费用以账户结算为准", references: { images: 1, videos: 0, audios: 0 } },
    "doubao-seedance-1-0-pro-quality": { capability: "video", price: "$0.0204/秒", priceTitle: "APIMart 模型广场公示价格；实际费用以账户结算为准", references: { images: 2, videos: 0, audios: 0 } },
    "sora-2-pro": { capability: "video", price: "$0.60/秒", priceTitle: "APIMart 模型广场公示价格；实际费用以账户结算为准", references: { images: 1, videos: 0, audios: 0 } },
    "veo3.1-fast": { capability: "video", price: "$0.14/次", priceTitle: "APIMart 模型广场公示起始价格；不同档位以账户结算为准", references: { images: 2, videos: 0, audios: 0 } },
    "sora-2": { capability: "video", price: "$0.08/秒", priceTitle: "APIMart 模型广场公示价格；实际费用以账户结算为准", references: { images: 1, videos: 0, audios: 0 } },
};

export const APIMART_MODELS = ["doubao-seedance-2.0", "doubao-seedance-2.0-fast", "doubao-seedance-2.0-mini", "kling-v3-motion-control"];

export function apimartModelInfo(model: string) {
    const name = model.toLowerCase();
    return Object.entries(APIMART_MODEL_CATALOG).find(([id]) => id.toLowerCase() === name)?.[1];
}

export function apimartSeedancePricing(model: string, resolution: string, generationSeconds?: string | number, referenceVideoSeconds = 0) {
    const prices = APIMART_SEEDANCE_PRICES[model.toLowerCase()];
    if (!prices) {
        const unitPrice = APIMART_VIDEO_CREDITS_PER_SECOND[model.toLowerCase()];
        if (!unitPrice) return null;
        if (model.toLowerCase().includes("motion-control") && resolution.toLowerCase() === "pro") {
            return {
                price: "Pro 实时结算",
                title: "Pro 为高质量模式，APIMart 当前公开单模型文档未给出独立 Credits 单价，请以任务实际结算为准。",
            };
        }
        const selectedSeconds = model.toLowerCase().includes("motion-control")
            ? referenceVideoSeconds || Math.max(0, Number(generationSeconds) || 0)
            : referenceVideoSeconds ? Math.min(referenceVideoSeconds, 15) : Math.max(0, Number(generationSeconds) || 0);
        const total = selectedSeconds ? `${formatCredits(unitPrice * selectedSeconds)} Credits` : `${unitPrice} Credits/秒`;
        return {
            price: `≈${total}`,
            uploadedVideoPrice: `${unitPrice} Credits/秒`,
            title: `${unitPrice} Credits/秒。${model.toLowerCase().includes("motion-control") ? "按参考视频实际时长计费" : referenceVideoSeconds ? "视频编辑按源视频时长计费，超过 15 秒按前 15 秒计算" : "按生成时长计费"}${selectedSeconds ? `：${unitPrice} × ${selectedSeconds}秒 = ${total}` : "；读取到素材时长后显示预计总积分"}。`,
        };
    }
    const normalized = normalizeResolution(resolution);
    const selected = prices[normalized] || prices["720p"] || prices["480p"];
    if (!selected) return null;
    const duration = Math.max(0, Number(generationSeconds) || 0);
    const referenceDuration = Math.max(0, referenceVideoSeconds);
    const regularTotal = duration ? `${formatCredits(selected.regular * duration)} Credits` : `${selected.regular} Credits/秒`;
    const uploadedTotal = duration && referenceDuration ? `${formatCredits(selected.uploadedVideo * (duration + referenceDuration))} Credits` : `${selected.uploadedVideo} Credits/秒`;
    const details = Object.entries(prices)
        .map(([quality, price]) => `${quality.toUpperCase()}：普通 ${price?.regular} Credits/秒；含参考视频 ${price?.uploadedVideo} Credits/秒`)
        .join("\n");
    return {
        price: `${normalized.toUpperCase()}≈${regularTotal}`,
        uploadedVideoPrice: `含视频≈${uploadedTotal}`,
        title: `${details}\n当前普通模式：${selected.regular} × ${duration || "生成"}秒${duration ? ` = ${regularTotal}` : ""}。\n含参考视频按“参考视频时长＋生成视频时长”计费${referenceDuration ? `：${selected.uploadedVideo} × (${referenceDuration}＋${duration})秒 = ${uploadedTotal}` : "；连接的视频读取到时长后显示预计总积分"}。`,
    };
}

function formatCredits(value: number) {
    return Number(value.toFixed(4)).toString();
}

function normalizeResolution(value: string): "480p" | "720p" | "1080p" | "4k" {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized === "480" || normalized === "480p" || normalized === "low") return "480p";
    if (normalized === "1080" || normalized === "1080p") return "1080p";
    if (normalized === "4k" || normalized === "2160" || normalized === "2160p") return "4k";
    return "720p";
}

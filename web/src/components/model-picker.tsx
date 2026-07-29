import { useEffect, useMemo, useState } from "react";
import { Select, type SelectProps } from "antd";
import { Cpu } from "lucide-react";

import { cn } from "@/lib/utils";
import { videoReferenceLimitsLabel, videoReferenceLimitsTitle } from "@/lib/video-model-capabilities";
import { cangyuanPricingKey, fetchCangyuanModelPricing, findModelPricing, formatModelPricing, type ModelPricingIndex } from "@/services/api/model-pricing";
import { modelOptionLabel, modelOptionName, resolveModelChannel, selectableModelsByCapability, type AiConfig, type ModelCapability } from "@/stores/use-config-store";
import { apimartModelInfo, apimartSeedancePricing } from "@/lib/apimart-model-catalog";

type ModelPickerProps = {
    config: AiConfig;
    value?: string;
    onChange: (model: string) => void;
    capability?: ModelCapability;
    className?: string;
    fullWidth?: boolean;
    placeholder?: string;
    estimateSeconds?: string | number;
    estimateReferenceVideoSeconds?: number;
    onMissingConfig?: () => void;
};

export function ModelPicker({ config, value, onChange, capability, className, fullWidth = false, placeholder = "选择模型", estimateSeconds, estimateReferenceVideoSeconds = 0, onMissingConfig }: ModelPickerProps) {
    const [pricingByBaseUrl, setPricingByBaseUrl] = useState<Record<string, ModelPricingIndex>>({});
    const options = useMemo(() => Array.from(new Set([...(config.channelMode === "local" && !capability ? [value] : []), ...selectableModelsByCapability(config, capability)].filter((model): model is string => Boolean(model)))), [capability, config, value]);
    const pricingKeys = useMemo(
        () =>
            Array.from(
                new Set(
                    options
                        .map((model) => resolveModelChannel(config, model))
                        .filter((channel) => channel.apiFormat === "cangyuan")
                        .map((channel) => cangyuanPricingKey(channel.baseUrl))
                        .filter(Boolean),
                ),
            ),
        [config, options],
    );
    const selectOptions = useMemo<NonNullable<SelectProps<string>["options"]>>(
        () =>
            options.map((model) => {
                const channel = resolveModelChannel(config, model);
                const apimart = channel.apiFormat === "apimart" ? apimartModelInfo(modelOptionName(model)) : null;
                const apimartPricing = channel.apiFormat === "apimart" ? apimartSeedancePricing(modelOptionName(model), config.vquality, estimateSeconds, estimateReferenceVideoSeconds) : null;
                const pricing = channel.apiFormat === "cangyuan" ? formatModelPricing(findModelPricing(pricingByBaseUrl[cangyuanPricingKey(channel.baseUrl)], modelOptionName(model)), estimateSeconds) : null;
                return { value: model, label: <ModelLabel config={config} model={model} capability={capability} price={apimartPricing?.price || apimart?.price || pricing?.label} unitPrice={apimartPricing?.uploadedVideoPrice || pricing?.unitLabel} priceTitle={apimartPricing?.title || apimart?.priceTitle || pricing?.title} referenceLabel={apimart ? (apimart.references ? `${apimart.references.images}·${apimart.references.videos}·${apimart.references.audios}` : "待核对") : undefined} /> };
            }),
        [capability, config, estimateReferenceVideoSeconds, estimateSeconds, options, pricingByBaseUrl],
    );
    const pricingOptionsKey = options.join("\n");
    const current = value || "";
    const showApimartVideoGuide = capability === "video" && options.some((model) => resolveModelChannel(config, model).apiFormat === "apimart");

    useEffect(() => {
        if (!pricingKeys.length) return;
        let cancelled = false;
        void Promise.all(pricingKeys.map(async (key) => [key, await fetchCangyuanModelPricing(key)] as const)).then((entries) => {
            if (cancelled || !entries.length) return;
            setPricingByBaseUrl((currentPricing) => ({ ...currentPricing, ...Object.fromEntries(entries) }));
        });
        return () => {
            cancelled = true;
        };
    }, [pricingKeys, pricingOptionsKey]);

    return (
        <Select
            data-canvas-no-zoom
            className={cn(fullWidth ? "w-full min-w-0" : "min-w-36", className)}
            classNames={{ popup: { root: "z-[1200]" } }}
            styles={{ popup: { root: { zIndex: 1700 } } }}
            popupMatchSelectWidth={false}
            value={current || undefined}
            placeholder={placeholder}
            options={selectOptions.length ? selectOptions : [{ value: "__empty__", label: emptyModelLabel(config, capability), disabled: true }]}
            popupRender={(menu) => showApimartVideoGuide ? <><ApimartVideoModelGuide generationSeconds={estimateSeconds} referenceVideoSeconds={estimateReferenceVideoSeconds} />{menu}</> : menu}
            onOpenChange={(open) => {
                if (open && !options.length && config.channelMode === "local") onMissingConfig?.();
            }}
            onMouseDown={(event) => event.stopPropagation()}
            onChange={onChange}
        />
    );
}

function ApimartVideoModelGuide({ generationSeconds, referenceVideoSeconds }: { generationSeconds?: string | number; referenceVideoSeconds: number }) {
    const seconds = Math.max(0, Number(generationSeconds) || 0);
    const referenceSeconds = Math.max(0, referenceVideoSeconds);
    return (
        <div className="m-1 mb-2 rounded-lg border border-sky-200 bg-sky-50/90 px-3 py-2 text-xs leading-5 text-slate-700 dark:border-sky-900/70 dark:bg-sky-950/70 dark:text-sky-100" onMouseDown={(event) => event.stopPropagation()}>
            <details>
                <summary className="cursor-pointer select-none font-semibold">APIMart 视频模型怎么选？参考时长与计费说明</summary>
                <div className="mt-2 max-w-[620px] space-y-2">
                    <div>
                        <div className="font-semibold">没有参考视频</div>
                        <div>Mini 成本最低；Fast 兼顾速度与效果；标准版支持更高分辨率。费用＝生成秒数 × 普通单价。</div>
                    </div>
                    <div>
                        <div className="font-semibold">Seedance 连接参考视频</div>
                        <div>最多 3 条，总时长需大于 1.8 秒且小于 15.2 秒，参考视频不可出现真人。费用＝（参考视频总时长＋生成时长）× 含视频单价。</div>
                        <div>720P 单价：标准版普通 1.42 / 含视频 0.8584；Fast 普通 1.1416 / 含视频 0.684；Mini 普通 0.5712 / 含视频 0.3456 Credits/秒。</div>
                    </div>
                    <div>
                        <div className="font-semibold">Kling v3 Motion Control</div>
                        <div>用于 1 张人物图模仿 1 条动作视频，不能纯文生视频。当前以人物图片朝向为主，参考视频必须 3–10 秒；输出时长跟随参考视频。</div>
                        <div>std：1.0288 Credits/秒，速度与质量均衡；pro：质量更高、通常更慢，公开文档未给独立单价，按实时结算显示。</div>
                    </div>
                    <div className="rounded-md bg-black/[0.04] px-2 py-1 dark:bg-white/[0.06]">
                        当前估算输入：生成 {seconds || "未读取"} 秒{referenceSeconds ? `，参考视频 ${formatGuideNumber(referenceSeconds)} 秒` : "，未读取到参考视频时长"}。
                    </div>
                    <div className="opacity-70">选择建议：无参考视频选 Seedance；非真人多素材优先 Fast；真人动作迁移选 Kling v3。</div>
                </div>
            </details>
        </div>
    );
}

function formatGuideNumber(value: number) {
    return Number(value.toFixed(2)).toString();
}

function emptyModelLabel(config: AiConfig, capability?: ModelCapability) {
    const label = capability === "image" ? "生图" : capability === "video" ? "视频" : capability === "text" ? "文本" : capability === "audio" ? "音频" : "";
    if (capability && config.models.length) return "请先在上方配置可选模型";
    return config.models.length ? `暂无匹配的${label}模型` : "请先到配置里添加渠道和模型";
}

function ModelLabel({ config, model, capability, price, unitPrice, priceTitle, referenceLabel }: { config: AiConfig; model: string; capability?: ModelCapability; price?: string; unitPrice?: string; priceTitle?: string; referenceLabel?: string }) {
    const showReferenceLimits = capability === "video" || Boolean(referenceLabel);
    return (
        <span className="flex min-w-0 items-center gap-2">
            <ModelIcon model={model} />
            <span className="min-w-0 truncate">{modelOptionLabel(config, model)}</span>
            {showReferenceLimits ? (
                <span title={`${referenceLabel ? `参考素材上限：${referenceLabel}` : videoReferenceLimitsTitle(model)}；顺序为 图片·视频·音频`} className="shrink-0 rounded border border-sky-200 bg-sky-50 px-1.5 text-[11px] font-medium leading-5 text-sky-700 dark:border-sky-900/70 dark:bg-sky-950/40 dark:text-sky-200">
                    {referenceLabel || videoReferenceLimitsLabel(model)}
                </span>
            ) : null}
            {price ? (
                <span className="flex shrink-0 items-center gap-1">
                    {unitPrice ? <span title={priceTitle} className="rounded border border-cyan-200 bg-cyan-50 px-1.5 text-[11px] font-medium leading-5 text-cyan-700 dark:border-cyan-900/70 dark:bg-cyan-950/40 dark:text-cyan-200">{unitPrice}</span> : null}
                    <span title={priceTitle} className="rounded border border-emerald-200 bg-emerald-50 px-1.5 text-[11px] font-medium leading-5 text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-200">{price}</span>
                </span>
            ) : null}
        </span>
    );
}

function ModelIcon({ model }: { model: string }) {
    const icon = resolveModelIcon(modelOptionName(model));
    return icon ? <img src={icon} alt="" className="size-4 shrink-0 dark:invert" /> : <Cpu className="size-4 shrink-0 opacity-70" />;
}

function resolveModelIcon(model: string) {
    const name = model.toLowerCase();
    if (name.includes("claude") || name.includes("anthropic")) return "/icons/claude.svg";
    if (name.includes("gemini") || name.includes("google")) return "/icons/gemini.svg";
    if (name.includes("gpt") || name.includes("openai")) return "/icons/openai.svg";
    if (name.includes("grok")) return "/icons/grok.svg";
    if (name.includes("deepseek")) return "/icons/deepseek.svg";
    if (name.includes("glm")) return "/icons/glm.svg";
    return "";
}

import { useEffect, useMemo, useState } from "react";
import { Select, type SelectProps } from "antd";
import { Cpu } from "lucide-react";

import { cn } from "@/lib/utils";
import { cangyuanPricingKey, fetchCangyuanModelPricing, findModelPricing, formatModelPricing, type ModelPricingIndex } from "@/services/api/model-pricing";
import { modelOptionLabel, modelOptionName, resolveModelChannel, selectableModelsByCapability, type AiConfig, type ModelCapability } from "@/stores/use-config-store";

type ModelPickerProps = {
    config: AiConfig;
    value?: string;
    onChange: (model: string) => void;
    capability?: ModelCapability;
    className?: string;
    fullWidth?: boolean;
    placeholder?: string;
    estimateSeconds?: string | number;
    onMissingConfig?: () => void;
};

export function ModelPicker({ config, value, onChange, capability, className, fullWidth = false, placeholder = "选择模型", estimateSeconds, onMissingConfig }: ModelPickerProps) {
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
                const pricing = channel.apiFormat === "cangyuan" ? formatModelPricing(findModelPricing(pricingByBaseUrl[cangyuanPricingKey(channel.baseUrl)], modelOptionName(model)), estimateSeconds) : null;
                return { value: model, label: <ModelLabel config={config} model={model} price={pricing?.label} priceTitle={pricing?.title} /> };
            }),
        [config, estimateSeconds, options, pricingByBaseUrl],
    );
    const current = value || "";

    useEffect(() => {
        if (!pricingKeys.length) return;
        const missingKeys = pricingKeys.filter((key) => !pricingByBaseUrl[key]);
        if (!missingKeys.length) return;
        let cancelled = false;
        void Promise.all(missingKeys.map(async (key) => [key, await fetchCangyuanModelPricing(key)] as const)).then((entries) => {
            if (cancelled || !entries.length) return;
            setPricingByBaseUrl((currentPricing) => ({ ...currentPricing, ...Object.fromEntries(entries) }));
        });
        return () => {
            cancelled = true;
        };
    }, [pricingByBaseUrl, pricingKeys]);

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
            onOpenChange={(open) => {
                if (open && !options.length && config.channelMode === "local") onMissingConfig?.();
            }}
            onMouseDown={(event) => event.stopPropagation()}
            onChange={onChange}
        />
    );
}

function emptyModelLabel(config: AiConfig, capability?: ModelCapability) {
    const label = capability === "image" ? "生图" : capability === "video" ? "视频" : capability === "text" ? "文本" : capability === "audio" ? "音频" : "";
    if (capability && config.models.length) return "请先在上方配置可选模型";
    return config.models.length ? `暂无匹配的${label}模型` : "请先到配置里添加渠道和模型";
}

function ModelLabel({ config, model, price, priceTitle }: { config: AiConfig; model: string; price?: string; priceTitle?: string }) {
    return (
        <span className="flex min-w-0 items-center gap-2">
            <ModelIcon model={model} />
            <span className="min-w-0 truncate">{modelOptionLabel(config, model)}</span>
            {price ? (
                <span title={priceTitle} className="shrink-0 rounded border border-emerald-200 bg-emerald-50 px-1.5 text-[11px] font-medium leading-5 text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-200">
                    {price}
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

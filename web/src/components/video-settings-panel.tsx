import { type ReactNode } from "react";
import { Switch } from "antd";

import { ImageSettingsTheme } from "@/components/image-settings-panel";
import { boolConfig, findSeedanceModelOptionByResolution, isCangyuanSd5SeedanceModel, isSeedanceFastModel, isSeedanceMini8sModel, isSeedanceVideoConfig, isSeedanceVideoModel, normalizeSeedanceDuration, normalizeSeedanceRatio, normalizeSeedanceResolution, seedanceDurationOptions, seedanceModelFixedResolution, seedancePixelLabel, seedanceRatioOptions, seedanceResolutionLabel, seedanceResolutionOptions } from "@/lib/seedance-video";
import { type CanvasTheme } from "@/lib/canvas-theme";
import { isOmniImageVideoModel, isSoraVideoModel, isVeoReferenceVideoModel, isVeoVideoModel } from "@/lib/video-model-capabilities";
import { modelOptionName, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";

const resolutionOptions = [
    { value: "720", label: "720p" },
    { value: "480", label: "480p" },
];

const cangyuanSeedanceStandardResolutionOptions = [
    { value: "480p", label: "480p" },
    { value: "720p", label: "720p" },
];

const sizeOptions = [
    { value: "1280x720", label: "横屏", width: 1280, height: 720 },
    { value: "720x1280", label: "竖屏", width: 720, height: 1280 },
    { value: "1024x1024", label: "方形", width: 1024, height: 1024 },
    { value: "1792x1024", label: "宽屏", width: 1792, height: 1024 },
    { value: "1024x1792", label: "长图", width: 1024, height: 1792 },
    { value: "auto", label: "auto", width: 0, height: 0 },
];

const secondOptions = [6, 10, 12, 16, 20];

export const videoResolutionOptions = resolutionOptions.map((item) => ({ value: item.value, label: item.label }));
export const videoSizeOptions = sizeOptions.map((item) => ({ value: item.value, label: item.label }));
export const videoSecondOptions = secondOptions.map((value) => String(value));

type VideoSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: "vquality" | "size" | "videoSeconds" | "videoGenerateAudio" | "videoWatermark", value: string) => void;
    onModelChange?: (model: string) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    className?: string;
    smartDurationLabel?: string;
    smartDurationHint?: string;
};

export function VideoSettingsPanel({ config, onConfigChange, onModelChange, theme, showTitle = true, className = "w-[320px] space-y-4 rounded-2xl px-1 py-0.5", smartDurationLabel = "智能", smartDurationHint = "由模型智能决定视频时长" }: VideoSettingsPanelProps) {
    if (isOmniImageVideoModel(config.model || config.videoModel)) {
        return <OmniVideoSettingsPanel config={config} onConfigChange={onConfigChange} theme={theme} showTitle={showTitle} className={className} />;
    }
    if (isSoraVideoModel(config.model || config.videoModel)) {
        return <SoraVideoSettingsPanel config={config} onConfigChange={onConfigChange} theme={theme} showTitle={showTitle} className={className} />;
    }
    if (isVeoVideoModel(config.model || config.videoModel)) {
        return <VeoVideoSettingsPanel config={config} onConfigChange={onConfigChange} theme={theme} showTitle={showTitle} className={className} />;
    }
    if (isSeedanceVideoConfig(config)) {
        return <SeedanceVideoSettingsPanel config={config} onConfigChange={onConfigChange} onModelChange={onModelChange} theme={theme} showTitle={showTitle} className={className} smartDurationLabel={smartDurationLabel} smartDurationHint={smartDurationHint} />;
    }

    const seconds = config.videoSeconds || "6";
    const size = normalizeVideoSizeValue(config.size);
    const dimensions = readSizeDimensions(size);
    const resolution = normalizeVideoResolutionValue(config.vquality);
    const updateDimension = (key: "width" | "height", value: number | null) => {
        const next = Math.max(1, Math.floor(value || dimensions[key] || 720));
        onConfigChange("size", `${key === "width" ? next : dimensions.width}x${key === "height" ? next : dimensions.height}`);
    };

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-lg font-semibold">视频设置</div> : null}
                <SettingGroup title="清晰度" color={theme.node.muted}>
                    <div className="grid grid-cols-3 gap-2.5">
                        {resolutionOptions.map((item) => (
                            <OptionPill key={item.value} selected={resolution === item.value} theme={theme} onClick={() => onConfigChange("vquality", item.value)}>
                                {item.label}
                            </OptionPill>
                        ))}
                        <ResolutionInput value={resolution} theme={theme} onChange={(value) => onConfigChange("vquality", value)} />
                    </div>
                </SettingGroup>
                <SettingGroup title="尺寸" color={theme.node.muted}>
                    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2.5">
                        <DimensionInput prefix="W" value={dimensions.width} disabled={size === "auto"} theme={theme} onChange={(value) => updateDimension("width", value)} />
                        <span className="text-lg opacity-45">↔</span>
                        <DimensionInput prefix="H" value={dimensions.height} disabled={size === "auto"} theme={theme} onChange={(value) => updateDimension("height", value)} />
                    </div>
                    <div className="grid grid-cols-3 gap-2.5">
                        {sizeOptions.map((item) => (
                            <button
                                key={item.value}
                                type="button"
                                className="flex h-[78px] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border bg-transparent text-sm transition hover:opacity-80"
                                style={{ borderColor: size === item.value ? theme.node.text : theme.node.stroke, color: theme.node.text }}
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={() => onConfigChange("size", item.value)}
                            >
                                <SizePreview width={item.width} height={item.height} color={theme.node.text} />
                                <span>{item.label}</span>
                                {item.value === "auto" ? null : (
                                    <span className="text-[11px] leading-none opacity-55">
                                        {item.value}
                                    </span>
                                )}
                            </button>
                        ))}
                    </div>
                </SettingGroup>
                <SettingGroup title="秒数" color={theme.node.muted}>
                    <div className="grid grid-cols-3 gap-2.5">
                        {secondOptions.map((value) => (
                            <OptionPill key={value} selected={seconds === String(value)} theme={theme} onClick={() => onConfigChange("videoSeconds", String(value))}>
                                {value}s
                            </OptionPill>
                        ))}
                        <NumberInput value={seconds} min={1} max={20} theme={theme} onChange={(value) => onConfigChange("videoSeconds", value)} />
                    </div>
                </SettingGroup>
            </div>
        </ImageSettingsTheme>
    );
}

function SeedanceVideoSettingsPanel({ config, onConfigChange, onModelChange, theme, showTitle, className, smartDurationLabel, smartDurationHint }: VideoSettingsPanelProps) {
    const selectedModel = config.model || config.videoModel;
    const model = modelOptionName(selectedModel);
    const isCangyuanStandard = isCangyuanSeedanceStandardModel(config, selectedModel);
    const isCangyuanSd5 = isCangyuanSd5SeedanceModel(model);
    const rawResolution = normalizeSeedanceResolution(config.vquality, model);
    const resolution = (isCangyuanStandard || isCangyuanSd5) && !["480p", "720p"].includes(rawResolution) ? "720p" : rawResolution;
    const fixedResolution = seedanceModelFixedResolution(model);
    const ratio = normalizeSeedanceRatio(config.size);
    const duration = normalizeSeedanceDuration(config.videoSeconds);
    const generateAudio = boolConfig(config.videoGenerateAudio, true);
    const watermark = boolConfig(config.videoWatermark, false);
    const maxDuration = isSeedanceMini8sModel(model) ? 8 : 15;
    const availableDurationOptions = seedanceDurationOptions.filter((value) => value === -1 || value <= maxDuration);
    const availableResolutionOptions = isCangyuanStandard || isCangyuanSd5 ? cangyuanSeedanceStandardResolutionOptions : seedanceResolutionOptions;
    const availableRatioOptions = isCangyuanSd5 ? seedanceRatioOptions.filter((item) => item.value === "16:9" || item.value === "9:16") : seedanceRatioOptions;
    const updateResolution = (value: string) => {
        const matchedModel = findSeedanceModelOptionByResolution(config, selectedModel, value);
        if (matchedModel && matchedModel !== selectedModel) onModelChange?.(matchedModel);
        if (!fixedResolution || matchedModel) onConfigChange("vquality", value);
    };

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-lg font-semibold">视频设置</div> : null}
                <SettingGroup title="分辨率" color={theme.node.muted}>
                    <div className="grid grid-cols-4 gap-2.5">
                        {availableResolutionOptions.map((item) => {
                            const switchTarget = findSeedanceModelOptionByResolution(config, selectedModel, item.value);
                            const lockedMismatch = Boolean(fixedResolution && item.value !== resolution && !switchTarget);
                            const disabled = lockedMismatch || (!fixedResolution && item.value === "1080p" && isSeedanceFastModel(model));
                            return (
                                <OptionPill key={item.value} selected={resolution === item.value} disabled={disabled} theme={theme} onClick={() => updateResolution(item.value)}>
                                    {item.label}
                                </OptionPill>
                            );
                        })}
                    </div>
                    {fixedResolution ? <div className="text-[11px] leading-4 opacity-55">当前分辨率由模型档位锁定：{seedanceResolutionLabel(resolution)}；切换到可用档位会自动更换同系列模型。</div> : null}
                    {!fixedResolution && isSeedanceFastModel(model) ? <div className="text-[11px] leading-4 opacity-55">fast 模型不支持 1080p，会自动使用 720p。</div> : null}
                </SettingGroup>
                <SettingGroup title="比例" color={theme.node.muted}>
                    <div className="grid grid-cols-3 gap-2.5">
                        {availableRatioOptions.map((item) => (
                            <button
                                key={item.value}
                                type="button"
                                className="flex h-[68px] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border bg-transparent px-1 text-sm transition hover:opacity-80"
                                style={{ borderColor: ratio === item.value ? theme.node.text : theme.node.stroke, color: theme.node.text }}
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={() => onConfigChange("size", item.value)}
                            >
                                <SizePreview width={ratioPreview(item.value).width} height={ratioPreview(item.value).height} color={theme.node.text} />
                                <span>{item.label}</span>
                                <span className="text-[10px] leading-none opacity-55">{item.value === "adaptive" ? "adaptive" : seedancePixelLabel(resolution, item.value)}</span>
                            </button>
                        ))}
                    </div>
                </SettingGroup>
                <SettingGroup title="时长" color={theme.node.muted}>
                    <div className="grid grid-cols-4 gap-2.5">
                        {availableDurationOptions.map((value) => (
                            <OptionPill key={value} selected={duration === value} theme={theme} onClick={() => onConfigChange("videoSeconds", String(value))}>
                                {value === -1 ? smartDurationLabel : `${value}s`}
                            </OptionPill>
                        ))}
                    </div>
                    {duration === -1 ? <div className="text-[11px] leading-4 opacity-55">{smartDurationHint}</div> : <NumberInput value={String(duration)} min={4} max={maxDuration} theme={theme} onChange={(value) => onConfigChange("videoSeconds", value)} />}
                </SettingGroup>
                <SettingGroup title="输出" color={theme.node.muted}>
                    <div className="grid gap-2 rounded-xl border p-2.5" style={{ borderColor: theme.node.stroke }}>
                        <SwitchRow label="生成声音" checked={generateAudio} theme={theme} onChange={(checked) => onConfigChange("videoGenerateAudio", String(checked))} />
                        {isCangyuanSd5 ? null : <SwitchRow label="添加水印" checked={watermark} theme={theme} onChange={(checked) => onConfigChange("videoWatermark", String(checked))} />}
                    </div>
                </SettingGroup>
            </div>
        </ImageSettingsTheme>
    );
}

function OmniVideoSettingsPanel({ config, onConfigChange, theme, showTitle, className }: VideoSettingsPanelProps) {
    const ratio = normalizeSeedanceRatio(config.size) === "9:16" ? "9:16" : "16:9";
    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-lg font-semibold">视频设置</div> : null}
                <SettingGroup title="固定规格" color={theme.node.muted}>
                    <div className="rounded-xl border px-3 py-2 text-sm" style={{ borderColor: theme.node.stroke }}>720p · 约 10 秒 · 最多 5 张参考图（单张 ≤5MB）</div>
                </SettingGroup>
                <SettingGroup title="比例" color={theme.node.muted}>
                    <div className="grid grid-cols-2 gap-2.5">
                        {[{ value: "16:9", label: "横屏" }, { value: "9:16", label: "竖屏" }].map((item) => (
                            <button key={item.value} type="button" className="flex h-[68px] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border bg-transparent text-sm transition hover:opacity-80" style={{ borderColor: ratio === item.value ? theme.node.text : theme.node.stroke, color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()} onClick={() => onConfigChange("size", item.value)}>
                                <SizePreview width={ratioPreview(item.value).width} height={ratioPreview(item.value).height} color={theme.node.text} />
                                <span>{item.label}</span>
                                <span className="text-[10px] leading-none opacity-55">{item.value}</span>
                            </button>
                        ))}
                    </div>
                </SettingGroup>
            </div>
        </ImageSettingsTheme>
    );
}

function SoraVideoSettingsPanel({ config, onConfigChange, theme, showTitle, className }: VideoSettingsPanelProps) {
    const ratio = normalizeSeedanceRatio(config.size) === "9:16" ? "9:16" : "16:9";
    const duration = Number(config.videoSeconds) || 8;
    const generateAudio = boolConfig(config.videoGenerateAudio, true);
    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-lg font-semibold">视频设置</div> : null}
                <SettingGroup title="模型规格" color={theme.node.muted}>
                    <div className="rounded-xl border px-3 py-2 text-sm" style={{ borderColor: theme.node.stroke }}>平台自适应清晰度 · 最多 1 张帧参考图</div>
                </SettingGroup>
                <SettingGroup title="比例" color={theme.node.muted}>
                    <div className="grid grid-cols-2 gap-2.5">
                        {[{ value: "16:9", label: "横屏" }, { value: "9:16", label: "竖屏" }].map((item) => (
                            <OptionPill key={item.value} selected={ratio === item.value} theme={theme} onClick={() => onConfigChange("size", item.value)}>
                                {item.label} · {item.value}
                            </OptionPill>
                        ))}
                    </div>
                </SettingGroup>
                <SettingGroup title="时长" color={theme.node.muted}>
                    <div className="grid grid-cols-3 gap-2.5">
                        {[4, 8, 12].map((value) => (
                            <OptionPill key={value} selected={duration === value} theme={theme} onClick={() => onConfigChange("videoSeconds", String(value))}>
                                {value}s
                            </OptionPill>
                        ))}
                    </div>
                </SettingGroup>
                <SettingGroup title="输出" color={theme.node.muted}>
                    <div className="grid gap-2 rounded-xl border p-2.5" style={{ borderColor: theme.node.stroke }}>
                        <SwitchRow label="生成声音" checked={generateAudio} theme={theme} onChange={(checked) => onConfigChange("videoGenerateAudio", String(checked))} />
                    </div>
                </SettingGroup>
            </div>
        </ImageSettingsTheme>
    );
}

function VeoVideoSettingsPanel({ config, onConfigChange, theme, showTitle, className }: VideoSettingsPanelProps) {
    const model = config.model || config.videoModel;
    const ratio = normalizeSeedanceRatio(config.size) === "9:16" ? "9:16" : "16:9";
    const duration = Number(config.videoSeconds) || 8;
    const resolution = ["720p", "1080p"].includes(config.vquality.toLowerCase()) ? config.vquality.toLowerCase() : "1080p";
    const generateAudio = boolConfig(config.videoGenerateAudio, true);
    const imageLimit = isVeoReferenceVideoModel(model) ? 3 : 2;
    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-lg font-semibold">视频设置</div> : null}
                <SettingGroup title="分辨率" color={theme.node.muted}>
                    <div className="grid grid-cols-2 gap-2.5">
                        {["720p", "1080p"].map((value) => <OptionPill key={value} selected={resolution === value} theme={theme} onClick={() => onConfigChange("vquality", value)}>{value}</OptionPill>)}
                    </div>
                    <div className="text-[11px] leading-4 opacity-55">最多 {imageLimit} 张{isVeoReferenceVideoModel(model) ? "主体或素材" : "首尾帧"}参考图，不支持参考视频或音频。</div>
                </SettingGroup>
                <SettingGroup title="比例" color={theme.node.muted}>
                    <div className="grid grid-cols-2 gap-2.5">
                        {["16:9", "9:16"].map((value) => <OptionPill key={value} selected={ratio === value} theme={theme} onClick={() => onConfigChange("size", value)}>{value === "16:9" ? "横屏" : "竖屏"} · {value}</OptionPill>)}
                    </div>
                </SettingGroup>
                <SettingGroup title="时长" color={theme.node.muted}>
                    <div className="grid grid-cols-3 gap-2.5">
                        {[4, 6, 8].map((value) => <OptionPill key={value} selected={duration === value} theme={theme} onClick={() => onConfigChange("videoSeconds", String(value))}>{value}s</OptionPill>)}
                    </div>
                </SettingGroup>
                <SettingGroup title="输出" color={theme.node.muted}>
                    <div className="grid gap-2 rounded-xl border p-2.5" style={{ borderColor: theme.node.stroke }}>
                        <SwitchRow label="生成声音" checked={generateAudio} theme={theme} onChange={(checked) => onConfigChange("videoGenerateAudio", String(checked))} />
                    </div>
                </SettingGroup>
            </div>
        </ImageSettingsTheme>
    );
}

function isCangyuanSeedanceStandardModel(config: AiConfig, model: string) {
    const requestConfig = resolveModelRequestConfig(config, model);
    const name = modelOptionName(model).toLowerCase();
    const baseUrl = requestConfig.baseUrl.toLowerCase();
    return (requestConfig.apiFormat === "cangyuan" || baseUrl.includes("ai.cangyuansuanli.cn")) && name.startsWith("seedance-2.0") && !seedanceModelFixedResolution(name);
}

export function videoResolutionLabel(value: string, model = "", config?: AiConfig) {
    const modelName = modelOptionName(model);
    if (isOmniImageVideoModel(modelName)) return "720p";
    if (isSoraVideoModel(modelName)) return "模型自适应";
    if (isVeoVideoModel(modelName)) return ["720", "1080"].includes(normalizeVideoResolutionValue(value)) ? `${normalizeVideoResolutionValue(value)}p` : "1080p";
    if (isSeedanceVideoModel(modelName)) {
        const resolution = normalizeSeedanceResolution(value, modelName);
        return seedanceResolutionLabel(config && isCangyuanSeedanceStandardModel(config, model) && resolution !== "480p" ? "720p" : resolution);
    }
    const resolution = normalizeVideoResolutionValue(value);
    return resolution === "4k" ? "4K" : `${resolution}p`;
}

export function videoSizeLabel(value: string) {
    const ratio = normalizeSeedanceRatio(value);
    if (value === "adaptive" || value === "auto") return "自适应";
    if (ratio === value) return seedanceRatioOptions.find((item) => item.value === ratio)?.label || ratio;
    const size = normalizeVideoSizeValue(value);
    return sizeOptions.find((item) => item.value === size)?.label || size;
}

export function videoSecondsLabel(value: string, model = "") {
    if (isOmniImageVideoModel(model)) return "约10s";
    if (String(value).trim() === "-1") return "智能";
    return `${value || "6"}s`;
}

export function normalizeVideoSizeValue(value: string) {
    if (value === "auto") return "auto";
    if (/^\d+x\d+$/.test(value || "")) return value;
    return ["9:16", "2:3", "3:4"].includes(value) ? "720x1280" : "1280x720";
}

export function normalizeVideoResolutionValue(value: string) {
    const raw = String(value || "").trim().toLowerCase();
    if (raw === "4k") return "4k";
    if (raw === "480p" || raw === "low") return "480";
    if (raw === "720p" || raw === "auto" || raw === "high" || raw === "medium") return "720";
    return raw.replace(/p$/i, "") || "720";
}

function OptionPill({ selected, disabled = false, theme, onClick, children }: { selected: boolean; disabled?: boolean; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button type="button" disabled={disabled} className="h-9 cursor-pointer rounded-full border px-2 text-sm transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-35" style={{ background: "transparent", borderColor: selected ? theme.node.text : theme.node.stroke, color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()} onClick={onClick}>
            {children}
        </button>
    );
}

function SettingGroup({ title, color, children }: { title: string; color: string; children: ReactNode }) {
    return (
        <div className="space-y-2.5">
            <div className="text-xs font-medium" style={{ color }}>
                {title}
            </div>
            {children}
        </div>
    );
}

function ResolutionInput({ value, theme, onChange }: { value: string; theme: CanvasTheme; onChange: (value: string) => void }) {
    return (
        <label className="flex h-9 overflow-hidden rounded-full border text-sm" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>
            <input type="number" min={1} className="min-w-0 flex-1 bg-transparent px-3 text-center outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" value={value} onChange={(event) => onChange(event.target.value)} onMouseDown={(event) => event.stopPropagation()} />
            <span className="grid w-7 place-items-center pr-1" style={{ color: theme.node.muted }}>
                p
            </span>
        </label>
    );
}

function DimensionInput({ prefix, value, disabled, theme, onChange }: { prefix: string; value: number; disabled: boolean; theme: CanvasTheme; onChange: (value: number | null) => void }) {
    return (
        <label className="flex h-9 overflow-hidden rounded-xl text-sm" style={{ background: theme.node.fill, color: theme.node.text, opacity: disabled ? 0.55 : 1 }}>
            <span className="grid w-9 place-items-center" style={{ color: theme.node.muted }}>
                {prefix}
            </span>
            <input type="number" min={1} disabled={disabled} className="min-w-0 flex-1 bg-transparent px-2 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" value={value || ""} onChange={(event) => onChange(Number(event.target.value) || null)} onMouseDown={(event) => event.stopPropagation()} />
        </label>
    );
}

function NumberInput({ value, min, max, theme, onChange }: { value: string; min: number; max: number; theme: CanvasTheme; onChange: (value: string) => void }) {
    return <input type="number" min={min} max={max} className="h-9 rounded-full border bg-transparent px-3 text-center text-sm outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" style={{ borderColor: theme.node.stroke, color: theme.node.text, WebkitTextFillColor: theme.node.text }} value={value} onChange={(event) => onChange(event.target.value)} onMouseDown={(event) => event.stopPropagation()} />;
}

function SizePreview({ width, height, color }: { width: number; height: number; color: string }) {
    if (!width || !height) return null;
    const longSide = Math.max(width, height);
    const previewWidth = Math.max(10, Math.round((width / longSide) * 26));
    const previewHeight = Math.max(10, Math.round((height / longSide) * 26));
    return <span className="rounded-[3px] border-2" style={{ width: previewWidth, height: previewHeight, borderColor: color }} />;
}

function ratioPreview(ratio: string) {
    if (ratio === "9:16") return { width: 9, height: 16 };
    if (ratio === "1:1") return { width: 1, height: 1 };
    if (ratio === "4:3") return { width: 4, height: 3 };
    if (ratio === "3:4") return { width: 3, height: 4 };
    if (ratio === "21:9") return { width: 21, height: 9 };
    if (ratio === "adaptive") return { width: 0, height: 0 };
    return { width: 16, height: 9 };
}

function SwitchRow({ label, checked, theme, onChange }: { label: string; checked: boolean; theme: CanvasTheme; onChange: (checked: boolean) => void }) {
    return (
        <div className="flex h-8 items-center justify-between gap-3">
            <span className="text-sm" style={{ color: theme.node.text }}>
                {label}
            </span>
            <span onMouseDown={(event) => event.stopPropagation()}>
                <Switch size="small" checked={checked} onChange={onChange} />
            </span>
        </div>
    );
}

function readSizeDimensions(size: string) {
    if (size === "auto") return { width: 0, height: 0 };
    const match = size.match(/^(\d+)x(\d+)$/);
    return { width: Number(match?.[1]) || 1280, height: Number(match?.[2]) || 720 };
}

import { useEffect, useState, type HTMLAttributes, type ReactNode } from "react";

import { ImageSettingsTheme } from "@/components/image-settings-panel";
import { VolcengineVoiceCloneModal } from "@/components/volcengine-voice-clone-modal";
import { VolcengineVoiceLibraryModal } from "@/components/volcengine-voice-library-modal";
import { VoiceboxProfileSelect } from "@/components/voicebox-profile-select";
import { audioFormatOptions, audioSpeedLabel, audioVoiceOptions, normalizeAudioFormatValue, normalizeAudioSpeedValue, normalizeAudioVoiceValue, normalizeVolcengineSpeakerValue, volcengineVoiceLabel } from "@/lib/audio-generation";
import { DEFAULT_VOLCENGINE_SPEAKER, normalizeAudioVoiceForProvider, resolveAudioProvider } from "@/lib/audio-provider";
import { type CanvasTheme } from "@/lib/canvas-theme";
import type { AiConfig } from "@/stores/use-config-store";

const speedOptions = ["0.75", "1", "1.25", "1.5"];

type AudioSettingKey = "audioVoice" | "audioFormat" | "audioSpeed" | "audioInstructions";

type AudioSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: AudioSettingKey, value: string) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    className?: string;
    titleDragHandleProps?: HTMLAttributes<HTMLDivElement>;
};

export function AudioSettingsPanel({ config, onConfigChange, theme, showTitle = true, className = "w-[320px] space-y-4 rounded-2xl px-1 py-0.5", titleDragHandleProps }: AudioSettingsPanelProps) {
    const [voiceLibraryOpen, setVoiceLibraryOpen] = useState(false);
    const [voiceCloneOpen, setVoiceCloneOpen] = useState(false);
    const [voxcpmStatus, setVoxcpmStatus] = useState<"checking" | "offline" | "ready" | "loaded">("checking");
    const modelValue = config.model || config.audioModel;
    const provider = resolveAudioProvider(config, modelValue);
    const isVolcengine = provider.kind === "volcengine";
    const isVoxCPM = provider.kind === "voxcpm";
    const isVoicebox = provider.kind === "voicebox";
    const voice = provider.kind === "openai" ? normalizeAudioVoiceForProvider(config, modelValue) : normalizeAudioVoiceValue(config.audioVoice);
    const format = normalizeAudioFormatValue(config.audioFormat);
    const speed = normalizeAudioSpeedValue(config.audioSpeed);
    const volcengineSpeaker = normalizeVolcengineSpeakerValue(config.audioVoice) || DEFAULT_VOLCENGINE_SPEAKER;

    useEffect(() => {
        if (!isVoxCPM) return;
        const controller = new AbortController();
        setVoxcpmStatus("checking");
        fetch(`${provider.baseUrl.replace(/\/v1\/?$/i, "")}/health`, { signal: controller.signal })
            .then((response) => response.ok ? response.json() as Promise<{ loaded?: boolean }> : Promise.reject())
            .then((result) => setVoxcpmStatus(result.loaded ? "loaded" : "ready"))
            .catch(() => {
                if (!controller.signal.aborted) setVoxcpmStatus("offline");
            });
        return () => controller.abort();
    }, [isVoxCPM, provider.baseUrl]);

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? (
                    <div {...titleDragHandleProps} className={titleDragHandleProps?.className}>
                        <div className="text-lg font-semibold">音频设置</div>
                        <div className="mt-1 text-xs" style={{ color: theme.node.muted }}>
                            当前服务：{provider.label}
                        </div>
                    </div>
                ) : null}
                <SettingGroup title={isVolcengine ? "火山音色 / Voice_type" : isVoxCPM ? "VoxCPM 生成方式" : isVoicebox ? "Voicebox 声音档案" : "OpenAI 声音"} color={theme.node.muted}>
                    {provider.kind === "unsupported" ? (
                        <div className="rounded-lg border px-3 py-2 text-xs leading-5" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>
                            当前音频模型暂不支持生成，请切换到 OpenAI TTS 或火山 OpenSpeech 模型。
                        </div>
                    ) : isVolcengine ? (
                        <>
                            <div className="rounded-lg border px-3 py-2 text-xs leading-5" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>
                                {volcengineVoiceLabel(volcengineSpeaker)}
                            </div>
                            <div className="flex gap-2">
                                <input
                                    className="h-9 min-w-0 flex-1 rounded-full border bg-transparent px-3 text-sm outline-none"
                                    style={{ borderColor: theme.node.stroke, color: theme.node.text, WebkitTextFillColor: theme.node.text }}
                                    value={config.audioVoice || ""}
                                    placeholder="例如 zh_female_meilinvyou_uranus_bigtts"
                                    onChange={(event) => onConfigChange("audioVoice", event.target.value)}
                                    onBlur={(event) => onConfigChange("audioVoice", normalizeVolcengineSpeakerValue(event.target.value) || DEFAULT_VOLCENGINE_SPEAKER)}
                                    onMouseDown={(event) => event.stopPropagation()}
                                />
                                <button type="button" className="h-9 shrink-0 cursor-pointer rounded-full border px-3 text-sm transition hover:opacity-80" style={{ borderColor: theme.node.stroke, color: theme.node.text }} onClick={() => setVoiceLibraryOpen(true)} onMouseDown={(event) => event.stopPropagation()}>
                                    音色库
                                </button>
                            </div>
                            <button type="button" className="h-9 w-full cursor-pointer rounded-full border px-3 text-sm transition hover:opacity-80" style={{ borderColor: theme.node.stroke, color: theme.node.text }} onClick={() => setVoiceCloneOpen(true)} onMouseDown={(event) => event.stopPropagation()}>
                                声音复刻 / 上传自己的声音
                            </button>
                            <div className="text-xs leading-5" style={{ color: theme.node.muted }}>
                                试听会调用当前火山语音 API，成功后会写入缓存。
                            </div>
                        </>
                    ) : isVoicebox ? (
                        <div className="space-y-2.5">
                            <VoiceboxProfileSelect config={config} value={config.audioVoice || ""} onChange={(value) => onConfigChange("audioVoice", value)} />
                            <div className="text-xs leading-5" style={{ color: theme.node.muted }}>
                                克隆样本、预设音色和默认效果在 Voicebox 独立页面管理；画布保存声音档案 ID 并复用生成结果。
                            </div>
                        </div>
                    ) : isVoxCPM ? (
                        <div className="space-y-2.5">
                            <div className="flex items-center gap-2 text-xs" style={{ color: theme.node.muted }}>
                                <span className="size-1.5 rounded-full" style={{ background: voxcpmStatus === "offline" ? theme.node.faint : voxcpmStatus === "checking" ? theme.node.muted : theme.node.activeStroke }} />
                                {voxcpmStatus === "offline" ? "本地服务未运行" : voxcpmStatus === "loaded" ? "本地服务可用 · 模型已加载" : voxcpmStatus === "ready" ? "本地服务可用 · 首次生成时加载模型" : "正在检查本地服务"}
                            </div>
                            <div className="divide-y border-y text-sm" style={{ borderColor: theme.node.stroke }}>
                                <div className="flex h-10 items-center justify-between">
                                    <span>音色设计</span>
                                    <span className="text-xs" style={{ color: theme.node.muted }}>无参考音频</span>
                                </div>
                                <div className="flex h-10 items-center justify-between">
                                    <span>参考克隆</span>
                                    <span className="text-xs" style={{ color: theme.node.muted }}>上游音频自动启用</span>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <>
                            <div className="grid grid-cols-3 gap-2.5">
                                {audioVoiceOptions.map((item) => (
                                    <OptionPill key={item.value} selected={voice === item.value} theme={theme} onClick={() => onConfigChange("audioVoice", item.value)}>
                                        {item.label}
                                    </OptionPill>
                                ))}
                            </div>
                            <div className="text-xs leading-5" style={{ color: theme.node.muted }}>
                                OpenAI TTS 使用官方 voice 生成；切换到火山模型后才会显示 Voice_type 和火山音色库。
                            </div>
                        </>
                    )}
                </SettingGroup>
                <SettingGroup title="格式" color={theme.node.muted}>
                    {isVoxCPM || isVoicebox ? (
                        <OptionPill selected theme={theme} onClick={() => onConfigChange("audioFormat", "wav")}>WAV{isVoxCPM ? " 48 kHz" : ""}</OptionPill>
                    ) : (
                        <div className="grid grid-cols-3 gap-2.5">
                            {audioFormatOptions.map((item) => (
                                <OptionPill key={item.value} selected={format === item.value} theme={theme} onClick={() => onConfigChange("audioFormat", item.value)}>
                                    {item.label}
                                </OptionPill>
                            ))}
                        </div>
                    )}
                </SettingGroup>
                {isVoicebox ? null : (
                    <SettingGroup title="语速" color={theme.node.muted}>
                        <div className="grid grid-cols-4 gap-2.5">
                            {speedOptions.map((value) => (
                                <OptionPill key={value} selected={speed === value} theme={theme} onClick={() => onConfigChange("audioSpeed", value)}>
                                    {audioSpeedLabel(value)}
                                </OptionPill>
                            ))}
                        </div>
                        <input
                            type="number"
                            min={0.25}
                            max={4}
                            step={0.05}
                            className="h-9 w-full rounded-full border bg-transparent px-3 text-center text-sm outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                            style={{ borderColor: theme.node.stroke, color: theme.node.text, WebkitTextFillColor: theme.node.text }}
                            value={config.audioSpeed || "1"}
                            onChange={(event) => onConfigChange("audioSpeed", event.target.value)}
                            onBlur={(event) => onConfigChange("audioSpeed", normalizeAudioSpeedValue(event.target.value))}
                            onMouseDown={(event) => event.stopPropagation()}
                        />
                    </SettingGroup>
                )}
                <SettingGroup title={isVoxCPM ? "音色与表演指令" : isVoicebox ? "Voicebox 表演指令" : "声音指令"} color={theme.node.muted}>
                    <textarea
                        value={config.audioInstructions || ""}
                        placeholder="例如：自然、温暖、适合旁白。"
                        className="thin-scrollbar h-20 w-full resize-none rounded-xl border bg-transparent px-3 py-2 text-sm leading-5 outline-none"
                        style={{ borderColor: theme.node.stroke, color: theme.node.text }}
                        onChange={(event) => onConfigChange("audioInstructions", event.target.value)}
                        onMouseDown={(event) => event.stopPropagation()}
                    />
                </SettingGroup>
                <VolcengineVoiceLibraryModal open={voiceLibraryOpen} config={config} modelValue={modelValue} currentSpeaker={volcengineSpeaker} onClose={() => setVoiceLibraryOpen(false)} onSelect={(value) => onConfigChange("audioVoice", value)} />
                <VolcengineVoiceCloneModal open={voiceCloneOpen} config={config} currentSpeaker={config.audioVoice || ""} onClose={() => setVoiceCloneOpen(false)} onSelect={(value) => onConfigChange("audioVoice", value)} />
            </div>
        </ImageSettingsTheme>
    );
}

function OptionPill({ selected, theme, onClick, children }: { selected: boolean; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button type="button" className="h-9 cursor-pointer rounded-full border px-2 text-sm transition hover:opacity-80" style={{ background: "transparent", borderColor: selected ? theme.node.text : theme.node.stroke, color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()} onClick={onClick}>
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
